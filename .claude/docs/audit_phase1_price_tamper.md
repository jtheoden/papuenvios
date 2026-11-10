# Auditoria de Fase 1: manipulacion de precios (price tamper) y plan de parches

- Fecha: 2026-10-17. Base: `origin/main` @ `aa8d5f25` (fase 0b). Produccion: proyecto `qcwnlbpultscerwdnzbm`.
- Alcance: SOLO LECTURA. Todas las consultas a produccion fueron `SELECT` (MCP `supabase-papuenvios` / `execute_sql`). No se ejecuto ninguna escritura, ningun ataque real, ni se uso la BD local del harness.
- Insumos: `panel_strategy_final.json`, `report_margin.json`, `report_rates.json` (scratchpad de la sesion).
- Convencion: `[V]` = verificado en produccion o en codigo con evidencia; `[NV]` = no verificado / inferido (se dice por que).

---

## 0. Resumen ejecutivo

1. **Confirmado**: ningun precio, total ni importe de remesa lo valida el servidor al insertar. Las policies `orders_insert` / `order_items_insert` / `users can insert remittances` solo verifican propiedad (`user_id = auth.uid()`), y no existen `create_order` / `create_remittance`.
2. **Matiz importante respecto al hallazgo previo**: SI existen triggers `guard_*` de produccion (migraciones `20261013170000`, `20261014110000`, `20261014160000`). Bloquean: status/payment_status forzados en INSERT, columnas "solo staff", y TODO cambio de columnas de dinero en UPDATE por el dueno. Es decir, **el vector abierto es el INSERT inicial** (no el UPDATE posterior). El INSERT es suficiente para el ataque.
3. **Lo mas grave es la remesa**: el cliente fija `exchange_rate`, `commission_*`, `amount_sent` y `amount_to_deliver` de forma independiente; la unica CHECK de dinero en `remittances` es `delivery_cost >= 0`. Un `amount_to_deliver` inflado se traduce en entrega de efectivo en destino (perdida sin techo). No hay validacion de `min_amount/max_amount` del tipo en el servidor.
4. **Pedidos**: `orders.total_amount`/`subtotal`/`discount_amount`/`shipping_cost`/`tax_amount` sin CHECK alguno. `order_items.unit_price` solo `> 0` (0.01 pasa). Se pueden anadir `order_items` DESPUES de crear el pedido mientras este `pending` y sin reserva (`guard_order_items_insert` lo permite), por lo que items y total pueden divergir.
5. **Control compensatorio real pero insuficiente**: la validacion de pago Zelle es manual; el admin compara el comprobante contra `total_amount`. Un total manipulado a la baja coincide con un pago bajo, asi que **la revision manual NO mitiga la manipulacion de precio** (solo detecta pagos que no coinciden con el total declarado).
6. **Evidencia historica**: no se encontro evidencia de explotacion en los datos actuales (31 pedidos, 24 remesas), pero **no se puede descartar** por falta de historico de precios (ver seccion 1.8).
7. **Propuesta**: "Fase 1.5 parches rapidos" aditiva y reversible (CHECKs + 3 triggers BEFORE INSERT + endurecer 2 policies + tabla admin-only de banderas), con 0 violaciones preexistentes verificadas para los CHECKs propuestos. No reemplaza F4a.

---

## 1. Verificacion en produccion (SELECT only)

### 1.1 Inventario de tablas relevantes `[V]`

Query: `select relname, relkind, relrowsecurity, ... from pg_class ... where relname ~ '(order|remit|cart|offer|...)'`.

- Con RLS: `orders` (11 triggers), `order_items` (1), `remittances` (6), `remittance_status_history`, `order_status_history`, `order_stock_allocations`, `shopping_carts`, `cart_items`, `offers`, `offer_items`, `offer_usage`, `category_discounts`, `inventory` (6 triggers), `inventory_movements`, `payment_quotes`, `payment_reviews`, `payment_methods`, `exchange_rates`, `remittance_types`, `shipping_zones`.
- Vista `order_analytics` (sin RLS; ya cubierta en fase 0b).
- Tablas `_bak_*_20261014` con RLS (respaldos del despliegue de stock).
- **No existen** `create_order`, `create_remittance` (query a `pg_proc` por nombre: sin resultados).
- Realtime (`pg_publication_tables`, `supabase_realtime`): solo `orders` y `remittances`. Implicacion: cualquier columna nueva de "banderas" en esas tablas seria visible al dueno via realtime/REST. Las banderas deben ir en tabla admin-only aparte.

### 1.2 Policies de INSERT/UPDATE `[V]`

Query: `select tablename, policyname, cmd, roles, qual, with_check from pg_policies where tablename in (...)`.

| Tabla | cmd | Policy | Condicion | Observacion |
|---|---|---|---|---|
| `orders` | INSERT | `orders_insert` | `user_id = auth.uid()` | Solo propiedad. Sin validacion de dinero. |
| `orders` | UPDATE | `orders_update` | USING `user_id = auth.uid() OR is_admin_user()`, sin WITH CHECK | Permite cualquier columna a nivel policy; la limita el trigger `guard_orders_owner_update`. |
| `order_items` | INSERT | `order_items_insert` | `EXISTS orders o WHERE o.id=order_id AND o.user_id=auth.uid()` | Solo propiedad del pedido padre. |
| `order_items` | UPDATE/DELETE | (ninguna) | RLS deniega | GRANT UPDATE/DELETE existe pero sin policy: bloqueado `[V]`. |
| `remittances` | INSERT | `users can insert remittances` | `user_id = current_user_id()` (= `auth.uid()`, definicion verificada) | Solo propiedad. |
| `remittances` | UPDATE | `users can update own remittances` | USING/CHECK `user_id = current_user_id()` | Limitado por `guard_remittance_owner_update`. |
| `remittance_status_history` | INSERT | `rsh_insert` | **`true`** | Cualquier autenticado inserta historial para CUALQUIER remesa (si pasa la FK). Ver T-18. |
| `order_status_history` | INSERT | `osh_insert_owner_or_admin` | pedido propio o admin | El dueno puede fabricar filas arbitrarias de historial de su pedido (el trigger `audit_order_status` ya registra los reales). |
| `offer_usage` | INSERT | `offer_usage_insert_own` | `user_id = auth.uid()` | Uso de oferta autoinformado. |
| `offers` | SELECT | `offers_select_authenticated` | **`true`** | Cualquier autenticado ve TODAS las ofertas (inactivas/vencidas/codigos). |
| `category_discounts` | SELECT | `authenticated users can view discounts` | `true` | Visible; el calculo es del cliente. |
| `cart_items` / `shopping_carts` | ALL | por dueno | | `cart_items`: GRANT solo `SELECT` para `authenticated` `[V]` (las policies INSERT/UPDATE son inertes). El carrito en BD no es una superficie de precio (columnas de `cart_items` no auditadas `[NV]`). |
| `user_profiles` | UPDATE | `users_can_update_own_profile` + trigger `guard_user_profiles_privileged_columns` | role/is_enabled solo super_admin | Verificado el trigger: bloquea auto-escalada. Importante porque `is_admin_user()` hace bypass de TODOS los guards de dinero. |

### 1.3 GRANTs `[V]`

`information_schema.role_table_grants` / `column_privileges`:

- `authenticated` tiene `INSERT, UPDATE, DELETE, SELECT` a nivel de TABLA en `orders` (51 columnas), `order_items` (14), `remittances` (53). Las listas de `column_privileges` devuelven todas las columnas (privilegio de tabla, no de columna). Por tanto **REVOKE de columna sin REVOKE de tabla previo es un no-op** (leccion ya registrada por el panel).
- `anon`: sin INSERT/UPDATE en estas tablas.
- Columnas escribibles por el cliente en `orders` (todas): incluyen `total_amount`, `subtotal`, `discount_amount`, `shipping_cost`, `tax_amount`, `currency_id`, `offer_id`, `order_number`, `created_at`, `updated_at`, `payment_*` (columnas Bizum), `stock_*`.

### 1.4 Triggers que recalculan o validan algo hoy `[V]`

(`pg_trigger` + `pg_get_functiondef`)

**orders**
- `guard_orders_owner_insert` (BEFORE INSERT): si el invocador NO es `postgres/service_role/supabase_admin`, ni `auth.uid() IS NULL`, ni admin/super_admin: exige `user_id = auth.uid()`, `status = 'pending'`, `payment_status = 'pending'`, y rechaza 14 columnas "solo staff" no nulas (`validated_*`, `rejection_reason`, `delivered_at`, `tracking_number`, `admin_notes`, etc.). **No toca dinero.**
- `guard_orders_stock_columns` (BEFORE INSERT): fuerza `stock_managed=true`, `stock_reserved=false`, `stock_reserved_at=NULL` para no-staff.
- `guard_payment_method_enabled` (BEFORE INSERT): `payment_method_allowed(NEW.payment_method,'orders')`; toma `pg_advisory_xact_lock_shared(hashtext('payment_methods'))`.
- `guard_reset_lock_orders` (BEFORE INSERT): lock compartido `platform_reset`.
- `trigger_set_order_number` (BEFORE INSERT): asigna `order_number` SOLO si es NULL (el cliente lo envia, ver 2.1).
- `seal_bizum_payment` (BEFORE INSERT WHEN `payment_method='bizum'`): exige quote del mismo usuario, no consumida, `NEW.total_amount = quote.usd_amount`, moneda USD, y sobrescribe `payment_*` desde la quote. **La quote la crea `create_bizum_quote(p_usd)` con `p_usd` que elige el cliente** `[V]` -> el sello ata el pago a un total que el propio cliente eligio.
- `guard_orders_owner_update` (BEFORE UPDATE): para no-staff solo permite cambiar `payment_proof_url, payment_reference, payment_status, rejection_reason, status, updated_at` con una maquina de estados cerrada (pending->cancelled si no validado; cancelled->pending reabrir; pending/rejected->proof_uploaded).
- `guard_bizum_quote_immutable` (BEFORE UPDATE WHEN bizum): congela `payment_*`.
- `audit_order_status`, `release_stock_on_order_cancel`, `trigger_update_orders_updated_at`.
- Orden de disparo: los BEFORE INSERT se ejecutan en orden alfabetico de nombre: `guard_order...` < `guard_orders_stock_columns` < `guard_payment_method_enabled` < `guard_reset_lock_orders` < `seal_bizum_payment` < `trigger_set_order_number`. Cualquier trigger nuevo que normalice dinero debe ordenarse antes de `seal_bizum_payment` (p. ej. prefijo `guard_`).

**order_items**
- `guard_order_items_insert` (BEFORE INSERT): para no-staff exige que el pedido padre este `pending` y `NOT stock_reserved` (`FOR SHARE`). **No valida precio/cantidad/tipo.**
- CHECKs: `positive_prices` (`unit_price > 0 AND total_price > 0`), `positive_quantity` (`quantity > 0`). `quantity` es `integer` (decimales rechazados por tipo). Sin tope superior de cantidad. `item_type` sin CHECK (en datos: solo `product` 142 y `combo` 4).

**remittances**
- `guard_remittance_owner_insert`: `status='payment_pending'`, `payment_validated` no TRUE, 14 columnas staff en NULL. **No valida `user_id` explicitamente (lo hace la policy) ni dinero.**
- `guard_payment_method_enabled`, `guard_reset_lock_remittances`, `trigger_generate_remittance_number` (solo si NULL), `audit_remittance_status`.
- `guard_remittance_owner_update`: allow-list `payment_proof_*, payer_phone, updated_at, status, cancelled_*`; todo lo demas debe permanecer igual. Cubre el vector de UPDATE de dinero.
- **No existe trigger `seal`/recalculo para remesas** (tampoco para Bizum en remesas; hoy `payment_methods.bizum` tiene `available=false, enabled_for_orders=false, enabled_for_remittances=false` `[V]`).

**inventory / stock** (relevante a sobreventa)
- `guard_inventory_reserved_edit` impide editar `reserved_quantity` salvo desde las RPC de stock (`app.stock_rpc='on'`) o roles de servicio.
- `reserve_order_inventory(p_order_id)` (SECURITY DEFINER, owner o admin): toma las necesidades desde `order_items` (server-side), bloquea inventario con orden global y `FOR UPDATE`, reserva FEFO, cap de reservas abiertas por cliente (default 5). Si no hay stock cancela el pedido. `consume_order_inventory` (solo admin) reserva si no estaba reservado.
- `_order_stock_needs`: clasifica items `product`/`combo` contra catalogo; otros -> `invalid` -> el pedido se cancela.

### 1.5 CHECK constraints `[V]`

- `orders`: solo checks de Bizum/Zelle/payment_method/payer_phone. **Sin CHECK en `total_amount`, `subtotal`, `discount_amount`, `shipping_cost`, `tax_amount`** (aceptan negativos y valores arbitrarios). `orders_order_number_key` UNIQUE.
- `remittances`: `delivery_cost >= 0`, `payment_method IN ('zelle','bizum')`, `payer_phone` length. **Sin CHECK en `amount_sent`, `amount_to_deliver`, `exchange_rate`, `commission_*`, `discount_amount`**. Precisiones: `exchange_rate numeric(12,4)`, `commission_percentage numeric(5,2)`, importes `numeric(12,2)`; `currency_sent/currency_delivered` son `varchar` libres (sin FK).
- `order_items`: ver arriba.

### 1.6 Que columnas controla hoy el cliente al insertar `[V]` (codigo en `origin/main`)

**Pedido** (`src/lib/orderService.js` `createOrder`, invocado desde `src/components/CartPage.jsx` ~L820):

`order_number` (generado en cliente por `generateOrderNumber()`), `user_id`, `order_type`, `status` (`pending`), `subtotal`, `discount_amount`, `shipping_cost`, `tax_amount`, `total_amount` (todos `roundMoney` en cliente), `currency_id` (`currencies.find(selectedCurrency)` = moneda de VISUALIZACION elegida; `[NV]` si en la practica es siempre USD: los 31 pedidos son USD, pero el codigo toma la moneda seleccionada), `shipping_address`, `recipient_info`, `delivery_instructions`, `payment_method` (`zelle`), `payment_status` (`pending`), `payment_reference`, `payment_proof_url`, `payer_phone`, `shipping_zone_id` (`shippingZones.find(z => z.province_name === recipientDetails.province)`: la zona de PROVINCIA, no la del municipio), `zelle_account_id`, `notes`, `offer_id`.

Items: `order_id`, `item_type`, `item_id`, `item_name_es`, `item_name_en`, `quantity`, `unit_price`, `total_price` (de `cartLines`, redondeo a centavo), `inventory_id`, `remittance_amount`, `exchange_rate`, `recipient_data`.

Despues: `reserve_order_inventory` (RPC), `recordOfferUsage` (INSERT directo a `offer_usage`), `uploadPaymentProof` (UPDATE de `payment_proof_url/payment_reference/payment_status`), `order_status_history` (INSERT directo en 4 sitios de `orderService`).

**Remesa** (`src/lib/remittanceService.js` `createRemittance` ~L843, llamado desde `SendRemittancePage.jsx` ~L592):

`user_id`, `remittance_type_id`, `amount_sent` (float crudo del input), `delivery_cost`, `shipping_zone_id`, `exchange_rate`, `commission_percentage`, `commission_fixed`, `commission_total`, `amount_to_deliver`, `currency_sent`, `currency_delivered`, `recipient_name/phone/address/province/municipality/id_number`, `delivery_notes`, `status` (`payment_pending`), `zelle_account_id`, opcionales `recipient_bank_account_id`, `recipient_id`, `recipient_address_id`, `offer_id`, `discount_amount`. No envia: `payment_method` (default `zelle`), `remittance_number` (lo asigna el trigger), `payer_phone`.

El calculo (`calculateRemittance`) corre en el cliente leyendo `remittance_types` y aplicando: tasa = `type.exchange_rate` si > 0, si no `exchange_rates`, si no 1; comision = `amount*pct/100 + fixed`; descuento de oferta sobre la comision; `amountToDeliver = (amount - effectiveCommission) * rate` (sin redondeo; Postgres redondea a 2 decimales). Existe ademas el modo inverso (`calculateReverseRemittance`), por lo que `amount_sent` puede ser un valor derivado de un monto deseado.

### 1.7 RPCs existentes de dinero (accesibles a `authenticated`) `[V]`

`recalculate_remittance_at_current_rate(uuid)` (SECURITY DEFINER; owner/admin; solo `payment_pending/payment_rejected`): usa la MISMA precedencia que el cliente (tasa del tipo si > 0, si no `exchange_rates`), recalcula comision y `amount_to_deliver = (amount_sent - comm_total_sin_redondear)*rate`. **Ignora `discount_amount`** (puede pisar un descuento aplicado). Es util como referencia de formula para el trigger de remesas, pero no para vectores dorados de redondeo (ver D-04). `create_bizum_quote(p_usd)`, `reserve_order_inventory`, `consume_order_inventory` (admin), `calculate_order_total` (INVOKER, ejecutable por `anon`, inocua: solo calcula).

### 1.8 Auditoria de datos (existe manipulacion previa?) `[V]` con la limitacion indicada

| Verificacion | Resultado |
|---|---|
| `order_items` totales: 146 lineas (142 product, 4 combo) | 12 lineas apuntan a productos ya inexistentes |
| `unit_price` vs `final_price` actual del catalogo | ratio min 0.906 / max 1.109; **0 lineas por debajo de 0.9** del precio actual; 49 por debajo del actual (cambios de precio legitimos o deriva) |
| `total_price` vs `round(unit_price*quantity,2)` | 32 lineas difieren; maxima diferencia 0.11 (27 u x 0.55); todas con fecha <= 2026-10-13: es redondeo de `unit` no redondeado x qty (previo al fix de redondeo en centavo), no manipulacion |
| Pedidos con `subtotal != sum(items)` | 11 de 31, todos por +-0.01 |
| Pedidos con `total != subtotal - descuento + envio + impuesto` | 0 |
| Pedidos con `total_amount <= 0`, `discount > subtotal`, `shipping < 0` | 0 |
| Remesas con `amount_sent<=0`, `amount_to_deliver<=0`, `rate<=0`, `commission_total<0` | 0 |
| Remesas fuera de `min/max_amount` del tipo; moneda distinta a la del tipo | 0 / 0 |
| Remesas con `amount_to_deliver > (amount_sent - commission_total)*rate + rate` | 0 |
| Pedidos con `offer_id` | 0 (hoy 3 ofertas, 0 activas, 0 filas en `offer_usage`); 3 pedidos con descuento >0 provienen de la categoria de usuario (1 categoria habilitada) |

**Verificacion verbatim de las cotas propuestas** `[V]` (una sola consulta `SELECT` con los predicados exactos de P1/P2, ver 3.3): 0 violaciones en `orders` (31 filas; ademas 0 filas con `discount_amount`, `shipping_cost` o `tax_amount` NULL), 0 en `remittances` (24 filas; 0 `discount_amount` NULL) para `amount_sent>0 AND amount_to_deliver>0 AND exchange_rate>0 AND commission_total>=0 AND commission_fixed>=0 AND commission_percentage BETWEEN 0 AND 100 AND COALESCE(discount_amount,0)>=0`, 0 en `order_items` para `abs(total_price - unit_price*quantity) <= 0.005*quantity + 0.01`. `max(order_items.quantity)` actual = 27 (el tope propuesto de 1000 deja margen amplio; el valor lo decide el duenio).

**Predicado P3 (a)-(f) contra las 24 remesas, con la configuracion ACTUAL de `remittance_types`** `[V]`: (a) moneda/tipo y (b) limites min/max: 24/24 pasan; (c) tasa <= tasa resuelta: 24/24 pasan (todas las historicas son <= 800 y las de mismo-moneda valen 1); (d) piso de comision: **22/24 pasan; fallan REM-2026-001111 y 001113** (USD->USD, `commission_total` 3.00 vs piso 4.90 = 103 x 4.7619%). El tipo no se modifico desde 2025-10-14 (`updated_at`), asi que NO es configuracion historica: esas filas las genero una version anterior del cliente (comision plana de 3.00 en mismo-moneda), distinta de la formula actual (`amount*pct/100`). Del mismo modo, las tasas 690-790 y porcentajes 2.53-2.90 de remesas CUP anteriores al 2026-10-16 no coinciden con el tipo (800 / 2.5%) y las filas del 16-17 de octubre si: la logica del cliente cambio recientemente (precedencia "tasa del tipo primero"). Consecuencia: (d) no debe bloquear en la primera release (un bundle cacheado o una formula previa del cliente produciria falsos positivos en el flujo USD->USD vivo); **(d) pasa a modo flag-only** y solo (a),(b),(c),(e) y los CHECKs bloquean.

**Lectura honesta**: ninguna fila actual viola las cotas que propongo, y no hay lineas groseramente baratas. **Pero** (a) no existe historial de precios ni de tasas por fecha, asi que "unit_price menor al actual" no distingue manipulacion de cambio legitimo; (b) las tasas almacenadas en remesas (690-800 CUP/USD) difieren de la tasa actual del tipo (800) y no se puede comprobar si fueron las vigentes ese dia; (c) la comision almacenada como porcentaje (2.5-2.9%) tampoco coincide con el tipo actual, y muchas remesas estan en modo inverso (montos redondos: 74000, 108000), por lo que ese desvio **no es evidencia de manipulacion**. Veredicto: "sin evidencia hallada, no se puede descartar" `[NV]` (requiere auditar `activity_logs`/historial de tasas, fuera de este SELECT).

**Hallazgo abierto de envio** `[NV]`: 31 de 31 pedidos tienen `shipping_cost` distinto al `shipping_zones.shipping_cost` actual de su `shipping_zone_id` (por ejemplo `shipping_cost = 0.00` con zona de 20.00 no gratuita, ultimas 8 ordenes incluyendo octubre). Hipotesis sin verificar: el cliente guarda la zona de provincia (`find(z => z.province_name === ...)`) mientras el costo viene de la zona de municipio (`getShippingZoneForLocation` con prioridad municipio > provincia), y/o `setShippingCost(0)` en los estados "no disponible". No se clasifica como manipulacion ni como bug hasta leer `calculateShippingCost` end-to-end con datos reales. Relevancia para F4a: el payload del RPC debe llevar provincia Y municipio, no un `shipping_zone_id`.

---

## 2. Matriz de ataques

Escala: Severidad (critico/alto/medio), Probabilidad (alta/media/baja = facilidad + incentivo), Impacto $ (descripcion), Mitigado hoy (si/parcial/no con evidencia).

Requisito de atacante comun: cuenta autenticada normal + PostgREST publico (`/rest/v1/...` con la anon key y su JWT). Los pasos son descripciones de request, no se ejecutaron.

| ID | Ataque / request | Sev. | Prob. | Impacto $ | Mitigado hoy |
|---|---|---|---|---|---|
| **T-01** | `POST /rest/v1/order_items` con `unit_price=0.01, total_price=0.01, quantity=1` para un producto de 50 USD (tras crear `orders` con `total_amount=0.01`). | Critico | Alta | Pedido de cualquier valor por centavos; el pago Zelle del atacante coincide con su propio total. | **No**: solo `unit_price>0`. |
| **T-02** | `POST /rest/v1/orders` con `total_amount=-50`, `subtotal=-50`, o `total_amount=0.01` con items caros. | Critico | Alta | Total arbitrario/negativo; riesgo en conciliacion y en reembolsos/saldos. | **No** (0 CHECK en `orders`). |
| **T-03** | Crear pedido valido (`total=100`), luego `POST /order_items` adicional (pedido sigue `pending` y sin reserva) con items de mucho valor, o items que no suman el total. | Alto | Media | Mercancia > pagado. | **Parcial**: `guard_order_items_insert` obliga `pending` y no reservado, pero permite insertar items sin limite hasta que se llame a `reserve_order_inventory`; no hay reconciliacion items vs total. |
| **T-04** | Cantidad negativa / decimal / enorme: `quantity=-1`, `quantity=1.5`, `quantity=2000000000`. | Medio | Baja | Negativa y decimal: ninguno. Enorme: la reserva falla por `insufficient_stock` y cancela; riesgo de desbordar `numeric(12,2)`/DoS de reserva. | **Si** para negativa (`positive_quantity`) y decimal (`integer`, error 22P02); **parcial** para enorme (sin tope; bloquea al propio atacante). |
| **T-05** | `discount_amount` arbitrario (p. ej. igual a `subtotal`) con `offer_id=NULL` o con oferta inactiva; o descuento de categoria de usuario inflado. | Alto | Alta | Descuento hasta el 100% del subtotal. | **No** (el calculo de oferta y de categoria es 100% cliente). |
| **T-06** | Reuso/manipulacion de ofertas: leer todas las ofertas (`offers_select_authenticated` = true), usar un codigo inactivo/vencido (`offer_id` solo tiene FK), saltarse `max_usage_global/per_user` (la verificacion es una consulta del cliente a `offer_usage`; el INSERT de uso es opcional), carrera entre pedidos. En remesa: `offer_id` + `discount_amount` -> comision 0. | Alto (cuando haya ofertas activas) | Media | Descuentos ilimitados. Hoy 0 ofertas activas, 0 pedidos con oferta: **exposicion actual baja, latente**. | **No**. |
| **T-07** | Remesa: `POST /remittances` con `amount_sent=100`, `exchange_rate=800`, `amount_to_deliver=780000` (x10). | **Critico** | Alta | Entrega de efectivo en destino por el monto inflado; perdida sin techo por remesa. | **No**: ni CHECK ni trigger. (La revision admin podria notar el desvio solo si compara contra el tipo). |
| **T-08** | Remesa con `exchange_rate` propia (p. ej. 2000) y `amount_to_deliver = amount*2000`. | Critico | Alta | Idem T-07. | **No**. |
| **T-09** | Remesa con `commission_percentage=0, commission_fixed=0, commission_total=0` (o `commission_total` negativa para inflar `amount_to_deliver`). | Alto | Alta | Pierde la comision (margen del negocio) o infla entrega. | **No** (sin CHECK de signo). |
| **T-10** | Remesa con `amount_sent` fuera de `min/max_amount` del tipo, `amount_sent<=0`, o `currency_sent`/`currency_delivered` distintos a los del tipo (texto libre). | Alto | Media | Evade topes por operacion; incoherencia de moneda en el pago. | **No** (min/max solo en `calculateRemittance` del cliente). |
| **T-11** | `delivery_cost=0` en entrega en efectivo (o `shipping_zone_id` de otra zona). | Medio | Alta | Pierde el costo de envio de la remesa. | **Parcial** (`delivery_cost >= 0`). |
| **T-12** | `status`/`payment_status`/`payment_validated` forzados en INSERT (`status='processing'`, `payment_status='validated'`). | Critico si fuera posible | -- | Pedido/remesa "pagados" sin pago. | **Si** (`guard_orders_owner_insert`, `guard_remittance_owner_insert`, ver 1.4). Pruebas existentes: `ordersOwnerGuardsMigration.test.js`. |
| **T-13** | `PATCH /orders?id=eq.X {total_amount:1}` o `PATCH /remittances?... {amount_to_deliver:...}` tras crear. | Critico si fuera posible | -- | Cambio de dinero post-creacion. | **Si** (allow-lists en `guard_*_owner_update`). Prueba existente: `remittanceService.noClientMoneyUpdate.test.js`. |
| **T-14** | IDOR: insertar `orders`/`remittances` con `user_id` de otro; insertar `order_items` en pedido ajeno. | Alto | -- | Suplantacion. | **Si** (policy + guard exigen `auth.uid()`). **Parcial** para FKs cruzadas en remesa: `recipient_id`, `recipient_bank_account_id`, `recipient_address_id`, `zelle_account_id`, `offer_id` solo tienen FK, sin chequeo de propiedad `[NV]` (RLS de `recipients`/`recipient_*` no auditada aqui). |
| **T-15** | Carreras: doble envio (sin clave de idempotencia), dos pedidos simultaneos que agotan `max_usage` de oferta, limite Zelle (consultivo) esquivado. | Medio | Media | Duplicados; uso excedido de ofertas. | **Parcial**: reservas de stock serializadas (locks); `order_number` UNIQUE evita colision pero el cliente lo genera; sin idempotencia, sin conteo atomico de oferta. |
| **T-16** | Sobreventa/reserva: no llamar `reserve_order_inventory`; items con `item_id` inexistente; `item_type` falso; cantidad > stock; acaparar reservas con varias cuentas. | Medio | Baja | Sobreventa. | **Si en lo esencial**: `consume_order_inventory` (admin, al validar pago) reserva si faltaba; `invalid_item` e `insufficient_stock` cancelan; tope de 5 reservas abiertas por cliente (multi-cuenta lo esquiva: **parcial**). |
| **T-17** | Mass assignment en PostgREST: enviar cualquiera de las 51/53 columnas con la anon key; en particular `order_number`/`remittance_number` propios (colision/suplantacion de numero), `created_at`/`updated_at`, `tax_amount` negativo, `currency_id` de otra moneda con montos USD, `payment_reference`, `recipient_data`, `item_name_*` (nombres falsos vs `item_id` barato). | Medio-Alto | Media | Confusion de despacho/contabilidad. `currency_id` = riesgo de interpretar 276 "CUP". | **Parcial**: columnas staff y estado cubiertas; el resto abierto. `created_at` solo se usa como respaldo de `stock_reserved_at` en la expiracion (impacto bajo). |
| **T-18** | Falsificar historial: `POST /remittance_status_history` (`rsh_insert` = true) sobre remesa ajena; o filas arbitrarias en `order_status_history` de pedido propio. | Medio | Media | Contamina la auditoria y los flujos que lean el historial. | **No**. |
| **T-19** | Bizum (latente): `create_bizum_quote(p_usd=0.01)` + pedido `total_amount=0.01`. | Alto cuando se habilite | Alta (si se habilita) | El EUR a pagar sale del `p_usd` elegido. | **No** para el valor; Bizum esta deshabilitado en `payment_methods` `[V]`. Remesas Bizum: no hay trigger `seal` -> abierto cuando se habilite. |
| **T-20** | Realtime: ver banderas de integridad en filas propias si se anadieran columnas. | Medio | -- | Fuga de la logica antifraude. | Evitable con tabla admin-only (diseno). |

---

## 3. Mitigaciones por ataque: parche inmediato (1.5) vs F4a

### 3.1 Principio: lo que NO se puede hacer en un trigger de `orders`

`createOrder` hace **dos requests PostgREST separados** (INSERT `orders` y despues INSERT `order_items`), es decir dos transacciones; al insertar el pedido aun no existen los items. Por eso:

- Un trigger `BEFORE INSERT ON orders` solo puede validar **coherencia interna del pedido** (cotas y `total = subtotal - descuento + envio + impuesto`); no puede recalcular el total desde los items.
- La validacion de precios va **por linea** (`BEFORE INSERT ON order_items`) y la reconciliacion items-vs-total va en los puntos de estrangulamiento que ya existen: `reserve_order_inventory` (el cliente lo llama justo despues de insertar items) y `consume_order_inventory`/`_reserve_order_locked` (el admin lo ejecuta al validar el pago, y reserva si faltaba; asi **no llamar a reserve no escapa del chequeo**). Antes de agregar logica en `_reserve_order_locked` hay que enumerar todos sus invocadores (`reserve_order_inventory`, `consume_order_inventory`; verificar que no haya otros `[NV]`).
- Los CHECK sobre `orders` / `remittances` son atomicos por fila y no tienen este problema.

### 3.1b Seguridad ante NULL (obligatorio en la implementacion)

`orders.discount_amount`, `shipping_cost` y `tax_amount` y `remittances.discount_amount` son NULLables. Un CHECK cuyo predicado evalua a NULL **pasa**, por lo que `tax_amount = NULL` convertiria `total_amount = round(subtotal - discount + shipping + tax, 2)` en NULL (CHECK satisfecho) y solo quedaria `total_amount > 0`. Reglas: todos los CHECKs usan `COALESCE(col, 0)`; hoy hay 0 filas con NULL `[V]`, por lo que ademas se puede anadir `SET NOT NULL` a esas 4 columnas (default 0 ya existe). En los triggers plpgsql se usa `IF (cond) IS NOT TRUE THEN RAISE ...` (nunca `IF NOT cond`), para que un NULL se rechace en vez de saltarse la validacion.

### 3.2 Tabla de mitigaciones

| ID | Parche minimo (Fase 1.5) | Ubicacion | Queda para F4a |
|---|---|---|---|
| T-01 | Trigger `guard_order_items_pricing` BEFORE INSERT: para no-staff, `item_type IN ('product','combo')`; el item debe existir en catalogo; `unit_price >= 0.5 * final_price_catalogo` (piso, no igualdad, por deriva legitima 0.906-1.109 y por conversion de moneda; todos los productos son USD hoy `[V]`, ver riesgo R-4); CHECK `abs(total_price - unit_price*quantity) <= 0.005*quantity + 0.01`; CHECK `quantity <= 1000` (tope a confirmar con el duenio). | Trigger + 2 CHECKs en `order_items` | Precio exacto desde catalogo (`unit_price` NO viene del cliente), moneda, combos. |
| T-02 | CHECKs `orders`: `total_amount > 0`, `subtotal > 0`, `tax_amount >= 0`, `shipping_cost >= 0`, `discount_amount >= 0 AND discount_amount <= subtotal`, y `total_amount = round(subtotal - discount_amount + shipping_cost + tax_amount, 2)`. **0 filas violan hoy** `[V]` (se pueden crear validadas, sin `NOT VALID`). | CHECK en `orders` | Total calculado en servidor. |
| T-03 | En `reserve_order_inventory` y `_reserve_order_locked` (solo ruta no-staff y admin al consumir): comparar `sum(order_items.total_price)` contra `orders.subtotal` (tolerancia `0.01 + 0.01*n_lineas`) y `subtotal` contra `sum(piso catalogo)`; **modo "flag"** (insertar en tabla admin-only `price_integrity_flags`) una release, despues "block". En modo block: la **cancelacion con `rejection_reason='price_mismatch'` solo ocurre en la reserva previa al pago** (wrapper `reserve_order_inventory`, que ya cancela por `insufficient_stock`); en la ruta `consume_order_inventory` (pago ya `validated`) `_reserve_order_locked` devuelve `ok:false` y se registra la bandera, **nunca se cancela** un pedido pagado. Ademas limitar `INSERT order_items` a pedidos con 0 reservas ya existente. | Funcion SECURITY DEFINER existente + tabla nueva | Items+total creados en la misma transaccion (RPC). |
| T-04 | Cubierto salvo tope (T-01, `quantity <= 1000`). | CHECK | -- |
| T-05 | Cubierto en parte por T-02 (descuento <= subtotal). Resto (que el descuento corresponda a oferta/categoria) exige replicar las reglas: F4a. | -- | Descuento calculado en servidor (oferta + categoria + piso/apilado). |
| T-06 | Trigger BEFORE INSERT en `orders` y `remittances` cuando `offer_id IS NOT NULL`: oferta `is_active`, dentro de ventana, `min_purchase_amount <= subtotal`, conteo `offer_usage` < limites (conteo sin lock: mejor esfuerzo). Opcional: quitar `offers_select_authenticated` (la policy publica de ofertas activas ya cubre a los autenticados). | Trigger + policy | Reglas completas (tipo %, fijo, `max_discount_amount`, `applies_to`, apilado, uso atomico). |
| T-07/T-08/T-09/T-10 | Trigger `guard_remittance_pricing` BEFORE INSERT (no-staff): (a) `currency_sent = type.currency_code`, `currency_delivered = type.delivery_currency`, tipo activo; (b) `type.min_amount <= amount_sent <= type.max_amount`; (c) tasa resuelta con esta precedencia exacta: **si `currency_sent = currency_delivered` -> la tasa debe ser 1** (los tipos USD->USD tienen `exchange_rate = 105` en la tabla `[V]`: sin esta rama un cliente podria enviar 105 y obtener ~105x), si no tasa del tipo si > 0, si no `exchange_rates`, si no 1 (igual que el cliente y que `recalculate_remittance_at_current_rate`); `exchange_rate <= tasa_resuelta * 1.0005`; (d) **solo bandera**, no bloquea en la primera release: `commission_total >= max(0, amount_sent*type.pct/100 + type.fixed - discount_amount) - 0.01` (ver 1.8: falla en 2 filas USD->USD historicas); (e) `amount_to_deliver <= (amount_sent - commission_total) * exchange_rate + exchange_rate` (cota que cubre el modo inverso, cuyo `amount_to_deliver` redondo puede quedar por debajo del directo); (f) `discount_amount` solo con oferta valida y <= comision bruta. Mas CHECKs: `amount_sent > 0`, `amount_to_deliver > 0`, `exchange_rate > 0`, `commission_total >= 0`, `commission_fixed >= 0`, `0 <= commission_percentage <= 100`, `discount_amount >= 0` (**0 violaciones hoy** `[V]`). | Trigger + CHECKs en `remittances` | Calculo completo en `create_remittance`, `quote_id` con expiracion, `cost_rate` y spread. |
| T-11 | En el trigger anterior: si `type.delivery_method='cash'`, `delivery_cost >= zona.shipping_cost` (zona = provincia/municipio con la misma prioridad que `getShippingZoneForLocation`; `[NV]` hasta cerrar el hallazgo de envio 1.8). Si no se cierra a tiempo, dejar solo `delivery_cost >= 0` (ya existe). | Trigger | RPC con provincia+municipio. |
| T-12/T-13/T-14 | Sin cambios (ya mitigados). Agregar prueba de regresion contra el RPC futuro. Cerrar IDOR por FKs: trigger que valide propiedad de `recipient_id`, `recipient_bank_account_id`, `recipient_address_id` (`[NV]` hasta leer sus RLS). | Trigger | Re-implementar guards explicitamente en el RPC (M2 del panel). |
| T-15 | Parche: indice UNIQUE parcial para evitar duplicados exactos recientes es fragil; **dejar para F4a** (`idempotency_key uuid` UNIQUE por usuario + `pg_advisory_xact_lock` por usuario/oferta). | -- | Idempotencia y concurrencia en RPC. |
| T-16 | Sin cambios. Opcional: bajar `stock_max_open_reservations` por defecto; ya configurable por super_admin. | -- | -- |
| T-17 | Triggers anteriores cubren dinero. Para `order_number`/`remittance_number`: en INSERT no-staff sobrescribir con el generado (`NEW.order_number := generate_order_number()`), requiere que el cliente deje de enviarlo o se ignore (compatible: se sobrescribe). Fijar `created_at/updated_at := now()` en INSERT no-staff. `item_name_*` y `currency_id`: ver R-5. REVOKE de columnas: **no** se recomienda en 1.5 (ver D-06). | Trigger | Lista blanca de campos en RPC. |
| T-18 | `rsh_insert`: `WITH CHECK (EXISTS (SELECT 1 FROM remittances r WHERE r.id = remittance_id AND (r.user_id = auth.uid() OR is_admin_user())))`. El cliente solo inserta historial en `remittanceService.js:1323` (propias/admin) `[V]`. `osh_insert_owner_or_admin`: aceptar el riesgo bajo (los cambios reales ya los registra el trigger `audit_order_status`) o eliminar los 4 INSERT directos de `orderService.js` y la policy para no-admin en F4a. | Policy | Historial solo desde triggers/RPC. |
| T-19 | No habilitar Bizum antes de que **S5b use `create_order`** (que calcula `usd_amount` desde items) en vez de otra ruta de INSERT directo; replicar `seal` para remesas. | -- | S5b sobre F4a. |
| T-20 | Banderas en tabla admin-only sin GRANT, fuera de `supabase_realtime` (misma regla del panel para snapshots de costo). | Diseno | -- |

### 3.3 Propuesta: "Fase 1.5 parches rapidos" (aditiva y reversible)

Una migracion `supabase/migrations/<ts>_phase1_5_price_guards.sql` + `supabase/rollbacks/<ts>_down.sql` (fuera de `migrations/`), cada parche autonomo y con `ALTER ... DROP CONSTRAINT / DROP TRIGGER` simetrico:

| Parche | Contenido | Riesgo de regresion | Tamano |
|---|---|---|---|
| **P1** | CHECKs `orders` y `remittances` (T-02, T-07/09/10 parte aritmetica). Sin `NOT VALID` (0 violaciones hoy). | Muy bajo: el cliente ya redondea y envia montos positivos. Rompe solo si hay remesas con comision negativa por oferta mal calculada (`effectiveCommission = max(0, ...)` ya lo evita). | S |
| **P2** | `guard_order_items_pricing` (piso 50% del catalogo, tipos permitidos, CHECK de total de linea con tolerancia, tope de cantidad). | Bajo-medio: un cambio de precio legitimo mayor al 50% o un producto en otra moneda base (hoy 100% USD) bloquearia el checkout; combos se comparan con `combo_products.final_price`. Mitigacion: modo `warn` (insertar bandera sin bloquear) durante una release. | M |
| **P3** | `guard_remittance_pricing` (T-07..T-11 con tolerancias; (a),(b),(c) con rama mismo-moneda=1,(e) bloquean; (d) solo bandera). | Medio: el unico escenario de falsos positivos es que el admin cambie la tasa del tipo entre que el cliente la ve y confirma (entonces la tasa del cliente `>` vigente se rechaza con `rate_changed`; hay que mostrar mensaje y refrescar). Mitigacion: tolerancia 0.05% y rechazo solo si favorece al cliente. | M |
| **P4** | Reconciliacion items-vs-total en `reserve_order_inventory`/`_reserve_order_locked`, **solo en modo flag** (tabla `price_integrity_flags`, admin-only, sin GRANT, fuera de realtime). | Bajo en modo flag. Pasar a block solo tras N dias sin falsos positivos. | M |
| **P5** | Policy `rsh_insert` con propiedad; opcional quitar `offers_select_authenticated`; `offer_id` valido (T-06) como trigger minimo. | Bajo; `offers_select_authenticated` puede romper la lectura de ofertas inactivas asociadas a pedidos antiguos (verificar consumidores antes). | S |

**Lo que NO entra en 1.5**: REVOKE de INSERT/UPDATE (exige RPC y modo sombra, panel), igualdad exacta de precio, idempotencia, replica de reglas de oferta, calculo de envio.

**Recomendacion**: ejecutar P1 -> P2(warn) -> P3 -> P4(flag) -> P5. P1+P3 cierran el vector de mayor perdida (remesas) y el de `total` arbitrario con coste bajo. Si el duenio solo aprueba una cosa antes de F4a: **P1 + P3**.

---

## 4. Abogado del diablo (objeciones a este plan)

| # | Objecion | Veredicto | Mitigacion |
|---|---|---|---|
| D-01 | El flujo Zelle/Bizum S5a sella orders via trigger (`seal_bizum_payment`); un trigger nuevo podria pisarlo o ejecutarse despues. | Valida. | Prefijo `guard_` para ejecutar ANTES de `seal_bizum_payment` (orden alfabetico `[V]`); prueba que Bizum (en rama de prueba) sigue sellando; los CHECK no interfieren (`orders_bizum_coherence` ya exige importes > 0). |
| D-02 | Transacciones: `createOrder` son dos requests; un trigger no ve los items. | Valida y ya incorporada. | Validacion por linea + reconciliacion en reserve/consume (3.1). F4a elimina el problema con una sola transaccion. |
| D-03 | Piso del 50% es un tope laxo: permite 50% de descuento ilegitimo. | Valida. | Es red de seguridad contra el abuso grosero (0.01 vs 50). El control exacto es F4a; el modo flag de P4 registra desvios >2% para revision. |
| D-04 | Redondeo: el contrato del panel (`round((amount_sent - commission_total)*rate,2)`) difiere del comportamiento actual (comision NO redondeada: ej. (765 - 19.125) x 800 = 596700 vs 596696 con comision redondeada). | Valida, **no resuelta**. | En 1.5 la cota tiene tolerancia de 1 unidad de la moneda enviada. Para F4a el contrato de redondeo es DECISION DEL DUENIO y los vectores dorados deben extraerse del codigo actual, no de la formula teorica. |
| D-05 | Modo inverso: `amount_sent` derivado de un monto deseado; recalcular hacia delante cambiaria lo cotizado. | Valida. | El trigger es una COTA SUPERIOR (no recalcula ni reescribe); permite menor entrega, nunca mayor. |
| D-06 | REVOKE de columnas en INSERT daria defensa en profundidad. | Parcialmente valida. | Con GRANT a nivel de tabla, requiere `REVOKE INSERT` + `GRANT INSERT(lista)`; el cliente envia `order_number` y usa `.select()` (RETURNING *), y los triggers `guard_*` ya cubren las columnas staff. Costo/regresion > beneficio; se pospone a F4a (cuando se hace REVOKE total de INSERT). |
| D-07 | Ofertas: replicar reglas en trigger duplica logica que F4a reescribira. | Valida. | 1.5 solo valida existencia/actividad/ventana/limites (trivial); la formula completa queda para F4a. Hoy hay 0 ofertas activas, bajo el riesgo si se retrasa. |
| D-08 | Multi-moneda: precios del catalogo en otra moneda base y `currency_id` del pedido = moneda de visualizacion. | Valida, `[NV]`. | Hoy los 53 productos con `base_currency_id` asignado son USD y los 31 pedidos son USD (el resto de productos no tiene moneda asignada `[NV]`). Si una orden puede salir en EUR con montos USD, P2/P3 no se ven afectados, pero hay que decidir si `orders.currency_id` se fija a USD en el servidor (Bizum ya lo exige). Pregunta abierta Q-3. |
| D-09 | Reset de plataforma (`execute_platform_reset`) borra `offer_usage, orders, remittances, ...` y todo trigger nuevo toma `guard_platform_reset_lock`? | Parcialmente valida. | Los triggers nuevos no escriben en tablas que el reset deba vaciar, salvo `price_integrity_flags`: incluir su limpieza (`DELETE ... WHERE true`) en la lista del reset (la funcion es de super_admin; es un cambio de funcion SECURITY DEFINER y exige `dale`). No se debe anadir FK desde banderas a `orders` sin `ON DELETE CASCADE`. |
| D-10 | Realtime: nuevas columnas/filas podrian filtrarse a los duenios. | Valida. | Banderas en tabla separada sin GRANT, no incluida en `supabase_realtime`; test que verifique la publicacion (mismo patron que FLAW-01). |
| D-11 | Tests existentes: ~15 tests unitarios con mocks no detectan rechazos del servidor; CHECKs/triggers nuevos no se ven. | Valida. | Pruebas de BD (SQL) por rol (anon/cliente/admin) sobre clon; ampliar `ordersOwnerGuardsMigration.test.js` con casos de precio; test de contrato de columnas que el cliente envia (seccion 1.6) para detectar nuevos campos. |
| D-12 | Rollback: un CHECK validado no se "apaga" con facilidad si bloquea ventas legitimas en produccion. | Valida. | Cada CHECK/trigger tiene `DROP` simetrico probado up/down/up en clon; P2/P4 empiezan en `warn/flag` controlado por una fila de `system_config` (kill switch editable por super_admin sin migracion). |
| D-13 | Falsos positivos por cambio de tasa/precio entre carga y confirmacion. | Valida. | Rechazo solo si favorece al cliente y supera la tolerancia; mensaje `rate_changed`/`price_changed` y recarga (UX ya existe para estas condiciones en tests `CartPage.rateUnavailable`). |
| D-14 | Gestion de admin: el admin hace bypass de todos los guards (`is_admin_user()`); un admin comprometido o un cliente con rol admin elude 1.5. | Valida y fuera de alcance. | `guard_user_profiles_privileged_columns` evita la auto-escalada `[V]`. El bypass de admin es intencional (carga manual); F4a debe seguir permitiendo ruta admin explicita. |
| D-15 | El hallazgo de envio podria significar que el negocio cobra envio por otra via (D2) y mi validacion lo rompe. | Valida `[NV]`. | No se propone validar `shipping_cost` en 1.5 hasta cerrar el hallazgo; solo `>= 0`. |
| D-16 | `calculate_order_total` y `recalculate_remittance_at_current_rate` ya existen: por que no reutilizarlas? | Parcialmente. | `calculate_order_total` no cubre items ni ofertas; `recalculate_...` ignora `discount_amount`. Sirven como referencia, no como autoridad. |

---

## 5. Plan por slices (TDD)

Regla del repo: prueba que falla -> implementar -> refactor; cada migracion remota requiere su propio "dale"; commits solo si se piden.

### 5.1 Fase 1.5 (parches)

| Slice | Contenido (prueba primero) | Depende de | Tamano | Requiere dale |
|---|---|---|---|---|
| S0 | Sonda de paridad de grants/policies/ACL de funciones (SELECT) como test cero, fijada contra produccion. Verificar que las 0 violaciones siguen siendo 0 el dia de aplicar. | Contrato de columnas B de la fase 0b aplicado o al menos no solapado (no tocan las mismas tablas: 0b toca `products/combo_products/product_categories/inventory/shipping_zones/remittance_services/order_analytics`) | S | SELECT en prod |
| S1 | RED: 10 casos SQL por rol que hoy PASAN y deben fallar (T-02, T-07, T-09). GREEN: P1 (CHECKs). | S0 | S | Aplicar migracion |
| S2 | RED: `guard_remittance_pricing` (matriz de 20 vectores, incluidos los 24 reales de produccion como "debe pasar" y el modo inverso). GREEN: P3. | S1 | M | Aplicar migracion |
| S3 | RED: `guard_order_items_pricing` en modo warn; tabla `price_integrity_flags` admin-only + kill switch `system_config`. GREEN: P2+P4 flag. | S1 | M | Aplicar migracion; incluir la tabla en la lista de `execute_platform_reset` (otro dale) |
| S4 | P5: policies `rsh_insert`, ofertas, `offer_id` valido. Test de lectura de ofertas en pedidos antiguos. | S1 | S | Aplicar migracion |
| S5 | Observacion >= 1 release: `price_integrity_flags` vs trafico real; decidir paso a block. | S2,S3 | -- | Decision del duenio |

Orden recomendado: S0 -> S1 -> S2 -> S3 -> S4 -> S5. Total estimado: ~4-6 dias de trabajo efectivo.

### 5.2 F4a (precio autoritativo en servidor)

| Slice | Contenido (prueba primero) | Depende de | Tamano | Requiere dale |
|---|---|---|---|---|
| A0 | Contrato de redondeo firmado por el duenio y vectores dorados (>= 200) extraidos de las funciones puras actuales (`cartPricing`, `remittanceCalculations`, `calculateRemittance`) incluyendo modo inverso, ofertas, combos, envio provincia/municipio. | Decision duenio (D-04) | M | Si (contrato) |
| A1 | `create_order(p_items jsonb, p_shipping jsonb, p_offer_code, p_payment_method, p_payer_phone, ... , p_idempotency_key uuid)` SECURITY DEFINER, `search_path`, `REVOKE ... FROM PUBLIC, anon`; re-implementa guards (`auth.uid()` no nulo, `user_id` forzado, estados `pending`, lista blanca de campos, `stock_reserved=false`), calcula precios desde catalogo con `FOR SHARE`, total y reserva dentro de la misma transaccion; columna `idempotency_key` nueva con UNIQUE (user_id, key). RED: cada guard del 1.4 contra el RPC; golden vectors; concurrencia. | A0, 1.5 S1 | L | Si (migracion) |
| A2 | `create_remittance(p_type_id, p_amount | p_desired_receive, p_mode, ...)` mas `quote_id` con expiracion; calcula tasa/comision/descuento en servidor. | A0, A1 (patron) | L | Si |
| A3 | Modo sombra: el servidor calcula y registra discrepancias contra el cliente (reusa `price_integrity_flags`), cliente sigue siendo autoritativo. Criterio: 0 discrepancias en trafico real. | A1, A2, 1.5 S3 | M | Si |
| A4 | Cambio del front tras feature flag (`createOrder`/`createRemittance` -> RPC); retirar el envio de `order_number`/`unit_price`. | A3 | M | Si (deploy) |
| A5 | `REVOKE INSERT ON orders, order_items, remittances FROM authenticated` solo tras N dias sin INSERT directo en logs. **UPDATE no puede revocarse por completo**: el dueno lo usa hoy para subir comprobante, cancelar y reabrir (`guard_*_owner_update`). Opciones: `REVOKE UPDATE` + `GRANT UPDATE (<columnas de la allow-list: payment_proof_url, payment_reference, payment_status, rejection_reason, status, updated_at en orders; payment_proof_*, payer_phone, status, cancelled_* en remittances>)`, o mover esas acciones a RPCs antes de A5. Rollback `GRANT` + `CREATE POLICY` probado. | A4 + observacion | S | Si (accion destructiva de permisos) |

Dependencias externas: **Bizum S5b debe construirse sobre `create_order` (A1)**, no sobre un INSERT directo; si S5b se adelanta, reintroduce T-19. **Contrato B de la fase 0b** (REVOKE de columnas de costo) no choca con 1.5, pero A1/A2 deben leer precios con las columnas publicas (`final_price`) o con RPCs SECURITY DEFINER que no dependan de columnas revocadas; coordinar el orden de despliegue (0b antes de A1).

---

## 6. Preguntas abiertas (max. 5, con recomendacion por defecto)

1. **Contrato de redondeo y comision (D-04)**: `amount_to_deliver` con comision SIN redondear (como hoy) o redondeada a 2 decimales (propuesta del panel)? *Por defecto*: igualar el comportamiento actual (sin redondear) y documentar la diferencia de hasta 4 CUP; cambiarlo solo con aviso a operaciones.
2. **Aplicar P1+P3 antes de F4a?** *Por defecto*: si, P1 y P3 inmediatamente (menor riesgo, cierra la perdida mayor); P2/P4 en modo warn/flag.
3. **`orders.currency_id`**: fijar USD en el servidor (hoy 31/31 son USD y Bizum lo exige) o permitir la moneda de visualizacion? *Por defecto*: fijar USD en el servidor en F4a; en 1.5 no tocarlo.
4. **Envio**: explicar el 31/31 de `shipping_cost` distinto a la zona (posible regla "pass-through" o zona de provincia vs municipio). *Por defecto*: no validar `shipping_cost` en 1.5 hasta cerrarlo; en F4a el payload lleva provincia+municipio.
5. **Ofertas**: mantener `offers_select_authenticated` (todas las ofertas visibles) o cerrar a "activas + admin"? *Por defecto*: cerrar (la policy publica de activas ya cubre al cliente), tras verificar los consumidores de ofertas en pedidos historicos.

---

## 7. No verificado

- Historial de precios/tasas por fecha (no existe en BD): no se puede probar ausencia de manipulacion pasada.
- RLS de `recipients`, `recipient_bank_accounts`, `recipient_addresses` (IDOR por FKs cruzadas, T-14).
- Columnas de `cart_items` / `shopping_carts` (se asume que el carrito persistido no contiene precios).
- Si `_reserve_order_locked` tiene invocadores ademas de `reserve_order_inventory` y `consume_order_inventory`.
- Explicacion exacta del desfase de `shipping_cost` (hallazgo abierto 1.8).
- Edge Functions (`notify-order`, etc.): no se leyeron con el fin de validar dinero.
- No se ejecuto ningun ataque ni escritura; las cotas propuestas se contrastaron solo contra los datos actuales (31 pedidos / 24 remesas).
