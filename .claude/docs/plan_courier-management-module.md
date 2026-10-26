# Plan: Modulo "Gestion de mensajeria" (mensajeros, tipos de pago de mensajero, acumulaciones, reportes)

Estado: DISENO. Nada implementado, nada aplicado a Supabase, sin commit/push. Base: origin/main efa76fb5 (#129). Lecturas a prod: solo agregados, sin PII (2026-10-26).
Este documento es AUTOCONTENIDO: reemplaza la seccion 11 de `plan_remittance-courier-spread-model.md` (vive en un worktree no versionado) y la parte `courier_rates` de ese plan. Las secciones 9-10 de ese plan (cargo fijo por tramo <= 50 USD en la comision) NO cambian y no se tocan aqui.

## 0. Requisito

Spec del cliente (6 bloques: remesas con 3 modalidades, combos, salarios, integracion contable, reportes, todo editable con vigencia futura) + propuesta del dueno: tabla `messenger_payment_types` configurable por admin/super_admin, por zona y monto; cada tipo se asocia a remesa, pedido o ambos y opcionalmente a un mensajero registrado; modo dual (con o sin mensajeros registrados); vista de control.

## 1. Evidencia: que existe y que no (archivo:linea, prod agregado)

| Tema | Hallazgo |
|---|---|
| Mensajero | NO existe entidad. Solo `order_courier_costs` y `remittance_courier_costs` coinciden con "courier" (information_schema prod). Roles: user 39, super_admin 3, admin 2 (plan previo 11.1). |
| Costo actual | Snapshot por operacion AL CREAR, USD, copiado de `shipping_zones.transport_cost`: `20261019140000_order_courier_costs.sql`, `20261027100000_remittance_courier_costs.sql:49-60` (PK = operacion, `amount_usd` NULL = desconocido, RLS `is_admin_user()`, sin DML de API). Prod: 2 filas pedidos, 1 remesas. |
| C1 | `transport_cost` sigue legible por anon; contrato B preparado (`supabase/contract/20261016160100_phase0b_contract_revoke_cost_columns.sql`), no aplicado. |
| Entrega | Pedido: `order_mark_delivered` -> `_order_transition`, `dispatched -> delivered`, escribe `delivered_at` (`20261024110000_order_transition_rpcs.sql:32,137,211-213`); luego `complete: delivered -> completed` (`:33,138`). Remesa: `confirm_delivery`, `processing -> delivered` (`20261024110100_...sql:25,186`); `complete` (`:26,113`). Ninguna accion REGRESA desde delivered/completed (solo `reopen`, que es de pedidos cancelados, `20261025110000:73,99`). => la "reversion" de una acumulacion no es un evento automatico: es una accion admin explicita (void). |
| Quien entrego | `remittances.delivered_by` existe y esta vacio (0/5); `orders.dispatched_by` es el ADMIN que despacho; `orders` no tiene `delivered_by` (plan previo 11.1; columnas de `orders` verificadas en prod: `dispatched_by, delivered_at, delivery_proof_url, shipping_zone_id`). |
| Zonas/municipios | UNA tabla: `shipping_zones(province_name, municipality_name, shipping_cost, transport_cost, free_shipping, delivery_days, is_active...)` (columnas en prod). 26 filas, no hay tabla `municipios`. |
| Combo | Concepto de catalogo: `combo_products` (`base_total_price, profit_margin, final_price, shipping_free, shipping_discount_percent...`) y `combo_items` (`20241001000000_complete_schema.sql:149,180`). Carrito: `cartItemType.js:4-14` (combo = `type:'combo'` o lleva `products`). En pedidos: `order_items.item_type IN ('product','combo')`; ojo, 1 linea combo esta etiquetada 'product' (`20261019100000_phase15_s3_order_items_guard.sql:64-66,183-192`; el guard acepta combo-como-product). `unit_price` congelado en la linea, con piso 0.5*final_price. |
| Caja / libro | NO hay libro de caja ni saldos CUP. Lo mas parecido: `financial_audit_log` (8 filas; bitacora de cambios de columnas, no libro), `zelle_transaction_history` (columnas `amount, status, zelle_account_id...`, sin columna de moneda, solo Zelle/USD), `payment_fx_rates` (Bizum EUR) y el `inventory ledger` (`20261014200000_product_delete_safety_and_ledger.sql:2,37`) que es de STOCK, no de dinero. |
| Ganancia | `computeHeadline`: `netIncome = orderProfit + commission + delivery_charge - remittanceCourierCost` (`dashboardMetrics.js:253-260`). El costo de mensajeria de PEDIDOS NO entra al netIncome: solo aparece como tarjeta aparte (`computeCourierCostTotals`, `:145-156`). Costo de remesas se fecha por `payment_validated_at` (`:196-208`), no por entrega. |
| Admin helpers | `is_admin_user()` = rol IN ('admin','super_admin') AND `is_enabled` (`20260210000001_security_hardening.sql:720-735`). Cierra la duda del plan previo: la policy admin-only basta con `is_admin_user()`. Existe tambien `is_manager()` (`:741`), uso no verificado. |
| Pantallas | Settings tiene pestanas propias (`SettingsPage.jsx:345`); la bandeja diaria es `AdminWorkTabs` (patron en `design_refunds-admin-ux.md`: tablist, `?tab=`, `CountBadge`, 44 px). |

### Volumen real (prod, 2026-10-26)
- Remesas entregadas/completadas: **5** (684.30 USD enviados en total). Pedidos entregados/completados: **19** de 33. Mensajeros registrados: **0**.
- Combos en catalogo: 16 (activos 16; precio final min/prom/max = 25.42 / 87.96 / 276.08; **5 con precio >= 80**). Pedidos con linea combo: **8**, de los cuales **2 entregados**; lineas combo con precio de catalogo >= 80: **1**.
- Todos los pedidos (33/33) usan UN solo `currency_id` y `payment_currency` NULL. El modelo EUR/Bizum existe pero ningun pedido lo usa aun (no se verifico que `currency_id` sea USD, solo que es uniforme).
- Orden de magnitud del gasto: a 200 CUP/entrega (~0.25 USD a 810) las 24 entregas historicas costarian ~6 USD. El valor del modulo hoy es de CONTROL y de estar listo para crecer, no de importes.

## 2. Evaluacion critica de la spec y de la propuesta

### 2.1 Contradicciones / ambiguedades (no se pueden implementar sin respuesta)
1. **"1 CUP por USD" vs "200 CUP por entrega"** (audio/WhatsApp previo, plan 9.1): en una remesa de 100 USD, 1 CUP/USD = 100 CUP; 200 CUP fijos = el doble. Coinciden solo en S=200. ¿Son alternativas por mensajero, o reemplaza una a la otra? ¿Que significa "USD entregado": `amount_sent` (nominal) o el equivalente (`amount_sent - comision`)? Diferencia de 2.4%.
2. **Base del porcentaje**: "importe nominal" (USD) vs "equivalente entregado en CUP". Tras convertir a CUP son casi lo mismo (CUP = USD_netos x tasa), pero NO existe base CUP para el tipo USD->USD cash (`remittance_types` USD 105/4.76%): para ese tipo la base "CUP entregado" no esta definida => la regla debe validar tipo/moneda.
3. **"Porcentaje" en el plan previo era "% de la ganancia (comision)"**; aqui el cliente dice porcentaje de importe. Son tres bases distintas (nominal, entregado, comision). Hay que elegir una lista cerrada y que el cliente confirme cual usa.
4. **Combo / "precio minimo"**: ¿es el `unit_price` congelado de la linea o el `final_price` vivo? ¿por unidad o por linea (cantidad > 1)? ¿antes o despues de descuento/envio? Propuesta: `order_items.unit_price` congelado, por unidad, sin envio. 1500 CUP ~ 1.85 USD a 810 sobre un combo de 80 USD (~2.3%): comparable con la comision de remesas, no es desproporcionado.
5. **"Comision distinta para combos bajo el minimo"** + "ajuste por zona": ¿se suma a la tarifa por entrega del pedido o la reemplaza? Propuesta: UNA sola regla ganadora por componente (ver 3.3); la entrega del pedido y cada combo son componentes distintos.
6. **Salario fijo "en lugar de comisiones"**: ¿el mensajero asalariado cobra 0 por entrega? ¿tambien por combos? Y: ¿el salario es costo del periodo (no de una operacion)?
7. **Moneda**: "registrar en CUP y convertir si el pedido esta en USD" - hoy remesas y pedidos son USD; la conversion es CUP->USD (no al reves). Tasa: remesa = tasa efectiva congelada de la remesa (830*(1-2.4096%) = 810); pedido = `exchange_rates` USD->CUP vigente (830). Son DOS tasas distintas para el mismo mensajero => decision del dueno (ND-J del plan previo, sigue abierta).

### 2.2 Doble conteo (el riesgo central)
| Fuente | Riesgo | Mitigacion |
|---|---|---|
| `*_courier_costs.amount_usd` (estimado por zona al crear) + nueva acumulacion al entregar | Mismo gasto contado dos veces | UNA funcion/vista de **costo efectivo por operacion**: si existe acumulacion (no void) -> su `amount_usd`; si no, el snapshot como ESTIMADO. El Dashboard lee solo ese costo efectivo, nunca ambas fuentes. |
| `shipping_zones.transport_cost` y `shipping_cost` (cargo cobrado al cliente) | `shipping_cost` es INGRESO (pass-through), `transport_cost` costo; no confundir con el pago al mensajero | El modulo NUNCA lee ni escribe `shipping_cost`; `transport_cost` queda solo como estimado heredado hasta que existan reglas, luego contrato B. |
| Mensajero asalariado | Salario del periodo + snapshot por zona/regla por entrega = doble | Acumulacion de la entrega con `covered_by_salary = true` y `amount = 0` => costo efectivo 0 para la operacion; el salario entra UNA vez como costo de periodo (fase 3). |
| Comision de remesa (ingreso) vs pago al mensajero | Si el cargo por tramo (<=50 USD, plan 10) se calcula para cubrir al mensajero y ademas el % del mensajero se resta de la comision, parece doble ajuste | No lo es: el cargo por tramo es INGRESO (comision), el pago es COSTO. El margen = comision_total - costo efectivo. Solo hay que no "restar el costo de la comision" al calcular la comision. |
| Fecha | Dashboard fecha costo de remesas por `payment_validated_at`; acumulaciones por `delivered_at` | Dashboard: el costo efectivo se une por id de operacion y conserva la fecha de la OPERACION (como hoy). Los reportes del modulo usan `delivered_at`. Se documenta que ambas vistas pueden diferir por entregas que cruzan el limite del periodo. |

### 2.3 Veredicto por componente de la spec
| # | Componente | Veredicto | Razon |
|---|---|---|---|
| 1a | Remesa: fijo en CUP por entrega | **Construir ahora** | El dato que el cliente ya dio (200 CUP). |
| 1b | Remesa: por cada USD entregado | **Construir ahora** (barato) | Una multiplicacion tipada; base cerrada por enum. Pero esperar a Q1 para la base. |
| 1c | Remesa: porcentaje con base elegible | **Construir ahora, base limitada** a `nominal_usd`, `delivered_cup`, `commission_usd` | Enum cerrado; validacion por tipo de remesa/moneda. |
| 2 | Combos (umbral, tramos, zona) | **Diferir a fase 2** | Volumen: 2 pedidos entregados con combo, 1 linea >= 80 USD. Ademas faltan 3 respuestas (2.1.4-5). El esquema lo reserva (enum + componente) sin logica. |
| 3 | Salarios diario/semanal/mensual | **Diferir a fase 3**, modelado como costo de PERIODO | No son por entrega; 0 mensajeros registrados; no hay con quien validarlo. |
| 4a | Gasto de mensajeria asociado a pedido/remesa/mensajero con estados | **Construir ahora** | Es la acumulacion (`courier_accruals`). |
| 4b | "Descontar del saldo de caja correspondiente" | **RECHAZAR / diferir** | No existe libro de caja ni saldos (ver seccion 1). Prometerlo implicaria disenar un ledger multimoneda. Se entrega "marcar pagado" con referencia y fecha; si luego hay caja, `courier_payments` es el punto de enlace. |
| 4c | "Proteger el % de ganancia en el precio de venta" | **RECHAZAR el ajuste automatico; ofrecer reporte** | Precio de pedido = costo base + margen (`financialSettingsService`, f8 `20261013150000_f8_profit_margin_settings.sql`); comision de remesa es % publicado que el cliente NO quiere subir (plan 9.1). Auto-ajustar precios por un costo de entrega contradice ambos. Entrega: KPI "margen neto despues de mensajeria" y un simulador de punto de equilibrio en la vista. |
| 4d | Evitar descontar dos veces | **Construir ahora** | Costo efectivo unico (2.2). |
| 4e | Estados calculada / pendiente de pago / pagada | **Construir ahora, simplificado** | Ver 3.5: almacenar `calculated | paid | void`; "pendiente de pago" = calculated sin pago. Un cuarto estado "aprobada" solo si el dueno quiere un paso de revision. |
| 5 | Reportes por mensajero y periodo | **Construir ahora** (una RPC agregada) | Entregas, importes de remesas, combos (fase 2), comisiones generadas, pagado, pendiente, total. |
| 6 | Editable; nuevas tarifas solo a futuro | **Construir ahora** | Versionado append-only + snapshot de la regla en cada acumulacion. |

### 2.4 Critica de la propuesta `messenger_payment_types`
Correcta en lo esencial (una tabla de reglas, alcance remesa|pedido|ambos, mensajero opcional). Cuidados:
- **Es un motor de reglas disfrazado.** Se acepta SOLO como tipos de calculo enumerados con parametros tipados en columnas (no JSON libre, no expresiones, no `eval`, no SQL dinamico). Un metodo nuevo = migracion + test.
- **`applies_to = 'both'`** solo es valido para metodos que tienen sentido en ambos (`fixed_cup`). `per_usd_delivered` y `percent_of_base` solo remesa; `combo_threshold` solo pedido. CHECK en la tabla.
- **Una sola regla gana por (operacion, componente)**; no se apilan reglas (apilar = doble conteo silencioso y resultados dificiles de explicar). Si el dueno quiere "fijo + %", es un metodo explicito `fixed_plus_percent` (dos parametros tipados) en vez de dos reglas.
- **Complejidad vs valor**: 5 remesas entregadas. Se recomienda lanzar con 2-3 reglas en total (p. ej. remesa general 200 CUP; pedido general X CUP) y que todo lo demas sea configuracion posterior, no codigo.

### 2.5 Seguridad
- Todo admin-only: RLS ON, `REVOKE ALL FROM PUBLIC, anon, authenticated`, `GRANT SELECT TO authenticated` + policy `(SELECT is_admin_user())`; ningun INSERT/UPDATE/DELETE de API. El cliente (aunque sea dueno de la operacion) no lee nada y NO se agregan columnas de mensajero/costo a `orders` ni `remittances` (el dueno de la fila lee todas sus columnas).
- Escritura solo por RPC SECURITY DEFINER, `search_path = public, pg_temp`, primera linea: `auth.uid()` no nulo y `is_admin_user()` re-verificado (cubre admin deshabilitado); `pg_advisory_xact_lock(hashtext('courier_rules'))`; auditoria en `financial_audit_log` (registrar tablas en `financial_audit_columns`, patron plan previo 10.2; no re-leido linea a linea).
- Datos personales de terceros (nombre, telefono del mensajero): solo admin; no en Realtime ni correos/WhatsApp al cliente.
- Sin formulas: cada metodo es una rama CASE cerrada con parametros `numeric` con CHECK (>= 0, porcentaje <= 100, tope de cordura por entrega, p. ej. `fee <= 20000 CUP`).
- Cerrar C1: este modulo **no** cierra C1 por si solo; lo habilita. Una vez que las reglas reemplazan a `transport_cost` como fuente del costo (la funcion de estimado puede seguir leyendolo como DEFINER), se puede aplicar el contrato B tras observacion.

## 3. Arquitectura recomendada por FASES

### 3.1 Principios
1. **Registro de entrega separado del calculo.** NO se modifican `_order_transition` ni `_remittance_transition` (funciones grandes, reemplazadas varias veces; riesgo de pisar #124). Todo cuelga de un trigger `AFTER UPDATE OF status` en `orders` y `remittances`.
2. **Una acumulacion por entrega**, idempotente (UNIQUE) y congelada.
3. **El costo efectivo por operacion es una sola cosa** (acumulacion si existe, snapshot-estimado si no).
4. **Nunca bloquear una entrega** por contabilidad (el trigger traga errores con WARNING, igual que `snapshot_remittance_courier_cost`) y se compensa con deteccion de huecos (3.4).
5. Sin backfill: las 19 entregas de pedidos y 5 de remesas ya realizadas quedan con su estimado (decision conservadora; backfill opcional ND).

### 3.2 Modelo de datos (Fase 1)
**`couriers`** (admin-only): `id uuid pk`, `name text NOT NULL` (unico entre activos por `lower(btrim(name))`), `phone text NULL`, `notes text NULL`, `pay_mode text NOT NULL DEFAULT 'per_delivery' CHECK IN ('per_delivery','salary')`, `is_active`, `created_by`, `created_at`. No es usuario de la app, sin login ni rol nuevo. Modo dual: no registrar nada = todo se paga con reglas generales y `courier_id` NULL.

**`messenger_payment_types`** (admin-only, versionada append-only):
| columna | regla |
|---|---|
| `id`, `code text`, `name text` | `code` identifica la "linea" de versiones; `name` visible |
| `applies_to` | CHECK IN ('remittance','order','both') |
| `method` | CHECK IN ('fixed_cup','per_usd_delivered','percent_of_base','fixed_plus_percent','combo_threshold') (los dos ultimos se crean vacios hasta fase 2; `fixed_plus_percent` solo si se pide) |
| parametros tipados | `fixed_cup numeric(12,2)`, `cup_per_usd numeric(12,4)`, `percent numeric(6,3) CHECK 0..100`, `percent_base text CHECK IN ('nominal_usd','delivered_cup','commission_usd')`, `usd_basis text CHECK IN ('sent','sent_minus_commission')`, `combo_min_usd`, `combo_fixed_cup`, `combo_below_min_cup` (fase 2) |
| alcance | `courier_id uuid NULL` (NULL = cualquiera), `shipping_zone_id uuid NULL` (cualquiera), `remittance_type_id uuid NULL`, `amount_from/amount_to numeric(12,2) NULL` (tramo sobre el monto USD enviado, intervalo (a,b] como los tramos del plan 10.2; solo remesa) |
| vigencia | `valid_from`, `valid_to NULL`, `is_active`, `created_by` |
| CHECKs | metodo x parametros requeridos (p. ej. `fixed_cup` exige `fixed_cup IS NOT NULL`, el resto NULL); metodo x `applies_to`; `percent_base='delivered_cup'` exige tipo con moneda CUP (validado en la RPC); `fee <= 20000 CUP`; `amount_to > amount_from` |

**Precedencia determinista** (`_courier_rule_resolve(kind, courier_id, zone_id, type_id, amount, component, at)` STABLE): entre filas activas y vigentes cuyo `applies_to` incluye el tipo de operacion y cuyo metodo pertenece al componente, gana la de mayor especificidad por tupla lexicografica `(courier_id NOT NULL, shipping_zone_id NOT NULL, remittance_type_id NOT NULL, tramo NOT NULL)` y, a igualdad, la de `valid_from` mas reciente, luego `id`. Como la RPC impide solapes bajo el lock, el empate a igual especificidad es imposible (el orden final es defensa en profundidad). Sin regla => la acumulacion SE CREA con `amount_cup/usd = NULL` (desconocido, nunca 0; `margin_status='unknown'` persiste, el costo efectivo cae al snapshot-estimado y el backfill/correccion puede rellenarla despues). Asi "sin tarifa" es una bandera persistida.

**Validacion anti-solape** (en `admin_set_messenger_payment_type`, bajo `pg_advisory_xact_lock`): para el mismo `(component, applies_to expandido, courier, zone, type)` los tramos de monto vigentes no se intersectan. btree_gist NO esta instalado (consultado en el plan previo), por eso va en la RPC y no en un EXCLUDE.

**`delivery_assignments`** (admin-only): `(source_kind 'order'|'remittance', source_id)` PK, `courier_id NOT NULL`, `assigned_by`, `assigned_at`. Se escribe solo por RPC `admin_assign_delivery_courier(kind, id, courier_id)` que RECHAZA operaciones ya entregadas (el monto se congela al entregar: una regla especifica del mensajero no se aplicaria despues; para eso existe void + ajuste). **El modal de entrega asigna PRIMERO y llama a la transicion DESPUES** (dos llamadas encadenadas; si la asignacion falla no se entrega). Reemplaza el cambio de columnas en los snapshots existentes del plan previo: no se tocan los triggers/tablas que ya funcionan.

**`courier_accruals`** (admin-only): 
`id`, `source_kind`, `source_id`, `component text CHECK IN ('delivery','combo','adjustment')`, indice unico PARCIAL `UNIQUE(source_kind, source_id, component) WHERE component <> 'adjustment'` (combos: una fila agregada por orden con `units`; los ajustes pueden ser varios; el `ON CONFLICT` del trigger repite el predicado), `courier_id NULL`, `rule_id NULL` (NULL = sin regla), `rule_snapshot jsonb NOT NULL` (copia de los parametros tipados y de las entradas usadas: amount_sent, commission, units, etc.), `amount_cup numeric(12,2)`, `fx_used numeric(12,4)`, `amount_usd numeric(12,2)`, `status CHECK IN ('calculated','paid','void')`, `covered_by_salary bool`, `payment_id NULL`, `delivered_at`, `created_at`, `voided_by/void_reason`. CHECK montos NULL o >= 0 (salvo `adjustment`). Columnas de margen: `margin_usd`, `margin_pct`, `margin_status`, `acked_by`, `acked_at` (3b).
Conversion: `amount_usd = round(amount_cup / fx_used, 2)`; remesa: `fx_used = round(exchange_rate * (1 - commission_percentage/100), 4)` de la propia remesa; pedido: tasa activa USD->CUP de `exchange_rates` al entregar. Se guardan CUP y USD y la tasa: no hay recalculo posterior.

**`courier_payments`** (fase 1b): `id`, `courier_id`, `amount_cup` (= suma de las acumulaciones incluidas, calculada en servidor), `method text`, `reference text`, `paid_at`, `paid_by`, `notes`. Una acumulacion pertenece a lo sumo a un pago. Sin pagos parciales de una acumulacion (un ajuste negativo cubre diferencias).

**Costo efectivo** (`v_effective_courier_cost` o funcion): por operacion = acumulacion no void (suma de componentes) si existe, si no `amount_usd` del snapshot con marca `estimated`. Vista SECURITY INVOKER sobre tablas admin-only: un no-admin ve vacio.

### 3.3 Calculo (por metodo, todo en servidor)
- `fixed_cup`: `amount_cup = fixed_cup`.
- `per_usd_delivered`: `amount_cup = round(cup_per_usd * base_usd, 2)`, `base_usd = amount_sent` o `amount_sent - commission_total` segun `usd_basis`.
- `percent_of_base`: `nominal_usd`: `usd = round(percent/100 * amount_sent,2)`, `cup = round(usd*fx,2)`; `delivered_cup`: `cup = round(percent/100 * amount_to_deliver, 2)`; `commission_usd`: `usd = round(percent/100 * commission_total, 2)`, `cup = round(usd*fx,2)`. El redondeo es half-up a 2 dp como el resto de las RPC; `amount_usd` se deriva de lo almacenado.
- `combo_threshold` (fase 2): por cada unidad de linea combo con `unit_price >= combo_min_usd` => `combo_fixed_cup`; bajo el minimo => `combo_below_min_cup` (NULL = 0 pero se registra); deteccion de combo reutiliza la clasificacion existente (`item_type='combo'` O `item_id` en `combo_products`, por la linea mal etiquetada).
- Alerta, no bloqueo: si `amount_usd > commission_total` de la remesa se marca `negative_margin` en el snapshot y se cuenta en el reporte.

### 3.4 Trigger al entregar, idempotencia y reversion
- `AFTER UPDATE OF status ON remittances/orders FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'delivered')`, SECURITY DEFINER. Lee la asignacion (si no hay: `courier_id NULL`), resuelve regla, inserta con `ON CONFLICT (source_kind, source_id, component) WHERE component <> 'adjustment' DO NOTHING`. Si el mensajero es `salary`: inserta con `amount 0`, `covered_by_salary = true` (para conteo de entregas y costo efectivo 0).
- Errores: se capturan con `EXCEPTION WHEN OTHERS` => WARNING (la entrega nunca falla). Compensacion: RPC `admin_list_deliveries_without_accrual(from,to)` y `admin_backfill_missing_accruals(from)` idempotente (marca `rule_snapshot.source = 'late'`; usa la regla vigente AHORA, no la de la fecha de entrega: documentado).
- Reversion: no hay regreso de `delivered` por RPC (seccion 1), asi que no hay disparo automatico. Acciones admin: `admin_void_accrual(id, reason)` (solo no pagadas; reason 10-500 chars); `admin_adjust_accrual(...)` crea una fila `adjustment` (puede ser negativa) para corregir una acumulacion YA pagada; pagada => solo super_admin. Cambiar `courier_id` de una acumulacion no pagada = `admin_reassign_accrual(id, courier_id, reason)` y NO recalcula el monto (el monto es el congelado; para otro monto: void + ajuste).
- Concurrencia: UNIQUE garantiza una acumulacion por entrega aun con doble disparo; las RPC de reglas serializan con el advisory lock; una entrega concurrente con una edicion de regla usa la regla visible en su snapshot (READ COMMITTED; aceptado y probado).

### 3.5 Estados
Almacenados: `calculated` (generada, adeudada = "pendiente de pago"), `paid` (con `payment_id`), `void`. La UI muestra "Calculada / Pendiente de pago / Pagada / Anulada" derivando "pendiente" = calculated sin pago. Un estado "aprobada/pendiente" separado solo se agrega si el dueno quiere revisar antes de liquidar (ND-M).

### 3.6 Vista admin
Ubicacion: **pestana "Mensajeria" en Settings** (`SettingsPage.jsx:345`), con sub-pestanas siguiendo el patron de `AdminWorkTabs` (tablist ARIA, `?tab=`, roving tabindex, targets 44 px, `CountBadge` con sr-only; ver `design_refunds-admin-ux.md`): **Mensajeros** | **Tipos de pago** | **Por pagar / Pagos** | **Reportes**. La bandeja diaria (`AdminWorkTabs`) NO recibe una pestana nueva (no es trabajo diario; YAGNI), solo un `CountBadge` en la sub-pestana "Por pagar".
- **Tipos de pago**: tabla (nombre, aplica a, metodo, parametros legibles, mensajero, zona, tramo, vigente desde, estado), formulario con campos dependientes del metodo (solo se muestran los parametros del metodo), vista previa "100 USD -> X CUP -> Y USD" usando el helper JS gemelo, aviso "aplica solo a entregas nuevas", historial de versiones. Errores de RPC mapeados a i18n.
- **En el flujo de entrega** (modal de confirmar entrega en bandeja de remesas y pedidos): selector opcional "Quien entrego" (aviso si se deja vacio; obligatorio cuando haya 2+ mensajeros activos, ND-I). No verificado el estado actual de esos modales (ver 6).
- **Por pagar**: acumulaciones `calculated` por mensajero, seleccion multiple, "Registrar pago" (metodo, referencia, fecha) => `courier_payments`; rechaza doble pago.
- **Reportes** (RPC `admin_courier_report(p_from, p_to, p_courier_id)`, SECURITY DEFINER, agregados): por mensajero y periodo (por `delivered_at`): entregas (remesa/pedido), importe de remesas entregadas (USD), combos entregados (fase 2), comisiones generadas (CUP y USD), pagado, pendiente, anulado, total de gasto de mensajeria, entregas sin tarifa, entregas sin acumulacion, acumulaciones con `negative_margin`.
- **Dashboard**: `dashboardMetrics` consume el COSTO EFECTIVO; para pedidos el headline usa la formula de ND-N, identica a `_operation_margin` => cambio de numero visible, comunicarlo y probarlo con fixtures.
- i18n ES/EN (`couriers.*`, `courierPayments.*`). Mobile-first, AA.

### 3.7 Fases
| Fase | Entra | Se difiere / rechaza |
|---|---|---|
| **0** | Respuestas del cliente (seccion 5); sin codigo | - |
| **1** | M1 couriers + `messenger_payment_types` (fixed_cup, per_usd_delivered, percent_of_base) + resolver + RPCs + auditoria; M2 asignacion + acumulaciones + trigger + void/adjust/reassign + costo efectivo; M3 pagos + RPC de reportes; front: servicios, pestana Mensajeria, selector en entrega, Dashboard con costo efectivo | combos, salarios, `fixed_plus_percent` (salvo que se pida), backfill |
| **2** (tras Q combos) | metodo `combo_threshold` + componente `combo` en el trigger de pedidos + reporte de combos | ajuste automatico de precio del combo |
| **3** (opcional por mensajero registrado; ver 3c) | `courier_salary_plans` + `courier_salary_accruals` (cierre perezoso idempotente por RPC) + linea de periodo en Dashboard | prorrateo del salario por operacion (falsea el costo por operacion), pg_cron, modo aditivo |
| **Rechazado** | descontar de saldo de caja; ajustar automaticamente el precio de venta; formulas/expresiones libres; reglas apiladas; edicion in situ de reglas o acumulaciones | - |

### 3.8 Etapas TDD (una etapa = una rama/PR; test rojo primero; rollback `_down.sql`; harness `src/tests/concurrency/`; nada a prod sin "dale" separado)
| # | Timestamp | Contenido | Tests primero |
|---|---|---|---|
| T0 | - | Vectores dorados `src/tests/fixtures/courierAccrualVectors.json` (por metodo, S=20/50/100/765, tasas 810/830, redondeo) + helper JS puro gemelo | JS == SQL |
| M1 | `20261031100000_couriers_and_payment_types.sql` | tablas, CHECKs, RLS/GRANT, `_courier_rule_resolve`, RPCs `admin_upsert_courier`, `admin_set_messenger_payment_type`, `admin_deactivate_messenger_payment_type`, auditoria | anon/auth/cliente sin SELECT ni DML; admin y super_admin ok; admin deshabilitado rechazado; CHECK metodo x parametros y metodo x applies_to; solape; versionado; precedencia (courier+zona > courier > zona > tipo > general); tramos (a,b]; sin regla => NULL; una sola regla gana |
| M2 | `20261031110000_delivery_assignments_and_accruals.sql` | asignacion, `courier_accruals`, trigger al entregar (ordenes y remesas), funciones void/adjust/reassign, costo efectivo, deteccion/backfill de huecos | entrega con y sin foto (#124) crea la misma acumulacion; sin mensajero => NULL; doble disparo => 1 fila; falla interna no impide la entrega; cambiar regla despues no altera la acumulacion; asalariado => covered_by_salary y costo efectivo 0; void de pagada rechazado; ajuste negativo; costo efectivo no suma snapshot + acumulacion; cliente dueno no lee nada; `guard_status_via_rpc`, `guard_remittance_money_columns` y suites existentes de courier costs siguen verdes |
| M3 | `20261031120000_courier_payments_and_report.sql` | `courier_payments`, `admin_register_courier_payment`, `admin_courier_report` | no doble pago; monto = suma servidor; permisos; agregados correctos; sin ids de cliente |
| F1 | front | servicios + pestana + selector + Dashboard | Vitest (helper gemelo, servicio, `dashboardMetrics` con acumulacion/estimado/sin tarifa), Testing Library (formularios dependientes del metodo, 320/375/768, foco/aria), e2e "admin crea tipo -> asigna -> entrega -> acumulacion -> paga -> cliente no ve nada" |
| M4 (fase 2) | `20261101100000_combo_component.sql` | `combo_threshold` + componente combo | umbral inclusivo/exclusivo, linea mal etiquetada, cantidad > 1, bajo el minimo, zona |
| M5 (fase 3) | `20261101110000_courier_salaries.sql` | planes, acumulaciones de periodo, cierre, prorrateo | ver 3c.6 |
| C | contrato B (C1) | tras 48 h de observacion y con reglas cargadas | `phase0bContract.test.js` |
Orden: M1 -> M2 -> M3 -> F1 -> cargar mensajeros/tipos -> C; fases 2 y 3 despues. Mientras no haya reglas todo se comporta como hoy (el estimado por zona sigue siendo el costo efectivo).

## 3b. Margen neto unico y alertas de ganancia en riesgo (ampliacion del dueno)

### 3b.1 Evaluacion honesta
"Conectar TODOS los calculos porcentuales" es el enfoque equivocado: hay calculos que ve el cliente (comision %, cargo por tramo, descuentos de oferta, `calcForward/calcReverse`) y esos NO deben depender de un umbral interno ni alertar en vivo al cliente. Lo correcto es lo contrario: **un solo calculo de margen, de solo lectura, alimentado por snapshots**, y que todo lo demas (simulador, entrega, Dashboard) lo CONSULTE. Nada se "engancha" a los calculos existentes; el margen se deriva de lo ya congelado.
Volumen: 5 remesas entregadas; con 2.125% sobre ~114 USD el margen es ~2.4 USD por remesa. El valor es preventivo (que una regla mal tecleada no deje la remesa en perdida), no operativo diario: por eso alertas minimas y sin ruido.

### 3b.2 Fuente unica de verdad
- **Funcion pura** `_operation_margin(kind, amount_base, income_usd, cost_usd NULL)` IMMUTABLE y gemelo JS `computeOperationMargin` (mismos vectores dorados, T0). Salida: `margin_usd`, `margin_pct` (sobre `amount_sent` en remesas; sobre `subtotal` de pedido), `status IN ('ok','warning','critical','unknown')`.
  - Remesa: `income = commission_total + delivery_cost` (la comision YA incluye el cargo por tramo del plan 10, no se suma de nuevo); `cost` = costo efectivo (3.2). `margin_pct = (income - cost) / amount_sent`.
  - Pedido (ND-N): `income = orderProfit (sin envio, como el Dashboard) + shipping_cost cobrado`; `cost` = costo efectivo; misma formula que el headline. Base = `subtotal`.
  - **`cost` NULL (sin acumulacion ni snapshot con monto) => `unknown`, nunca 0** (igual que hoy con `amount_usd` NULL). El Dashboard cuenta "desconocidos" aparte.
- **Umbrales configurables**: `courier_margin_settings` o filas en `system_config` (patron del kill switch S2): `remittance_margin_target_pct` (2.125), `warning_pct`, `critical_pct` (p. ej. critico < 0, aviso < objetivo), mas equivalentes de pedido. Editables por admin/super_admin SOLO via RPC con auditoria; CHECK `critical <= warning <= target`. No son datos del cliente (admin-only RLS).
- **RPC** `admin_operation_margin(kind, id)` y `admin_margin_report(from, to, level)`: SECURITY DEFINER, `is_admin_user()` re-verificado, solo agregados e ids de operacion (sin PII).

### 3b.3 Donde se evalua (tres puntos, una funcion)
1. **Al configurar** (Fase 1, barato): el simulador de la pestana "Tipos de pago" (y, en el futuro, el de tramos del plan 10) llama al helper JS gemelo con los vectores S=20/50/100/765 y muestra "esta regla deja X% en 50 USD, por debajo del objetivo 2.125%" con icono+texto (no solo color). Es aviso, NO bloqueo (ND-7 del plan previo: no bloquear). Sin consultas a prod: usa la comision del tipo de remesa vigente y la regla en edicion.
2. **Al entregar** (Fase 1, dentro del trigger de M2): al insertar la acumulacion se calcula el margen con la funcion pura y se PERSISTE `margin_status`, `margin_pct` y `margin_usd` en `courier_accruals` (columnas NULLables; `unknown` si falta costo o ingreso). Persistir > recalcular en cada lectura: el dashboard/lista no recalcula N operaciones, la bandera conserva el criterio del momento de la entrega (umbrales cambian a futuro, historial no; viven en M1, creados antes del trigger de M2), y se evita doble calculo con otra definicion. Costo: si despues se anula/ajusta la acumulacion o cambian umbrales, la RPC `admin_recompute_margin_flags(from)` re-evalua (idempotente) y void/adjust actualizan la fila en la misma transaccion.
3. **Dashboard** (Fase 1 el KPI y lista; Fase 2 refinamientos): KPI "Margen neto %" por ventana y contador/lista "operaciones bajo umbral" (id, fecha, margen) y "margen desconocido", leyendo la bandera persistida y, para operaciones sin acumulacion, el calculo con snapshot-estimado (marcado "estimado"). Reutiliza el patron de alerta del Resumen (`DashboardPage.jsx:438-454`).

### 3b.4 Notificacion sin spam
- **Canal**: tarjeta de alerta en Dashboard Resumen + `CountBadge` en la sub-pestana "Reportes" de Mensajeria (patron `AdminWorkTabs`, ver `design_refunds-admin-ux.md`). **No** se suma al badge del avatar (`Header.jsx:86-108`, que significa "tengo trabajo accionable"; una operacion ya entregada con margen bajo no tiene accion inmediata): evita diluirlo. Si el dueno lo pide, solo nivel `critical` y no reconocido.
- **Agrupar**: una sola tarjeta con conteos por nivel y por periodo; la lista expandible, no una notificacion por operacion. Sin emails/WhatsApp (Fase 1).
- **Reconocer/descartar**: `admin_ack_margin_flags(ids, note)` guarda `acked_by/acked_at`; las reconocidas salen del contador (no del historico ni del KPI).
- **Histeresis**: la bandera de una operacion se fija una vez (no oscila: es snapshot). La alarma agregada ("margen de la ventana bajo objetivo") usa dos umbrales: entra en alerta < `warning_pct`, sale al superar `warning_pct + 0.25 pp` (parametro) y solo se evalua con >= N operaciones (parametro, p. ej. 5) para no alarmar por una remesa suelta; con 5 remesas entregadas el contador de la ventana mensual no es estadistico: se muestra el numero pero la alarma agregada se mantiene apagada hasta alcanzar N.
- **Fatiga**: niveles = ok / aviso / critico; solo critico y "desconocido recurrente" generan tarjeta destacada; aviso aparece en la lista sin color de alarma.

### 3b.5 Riesgos y que NO conectar
- **Doble conteo**: el margen usa el costo EFECTIVO unico (3.2) y el ingreso `commission_total` (que ya incluye tramo y override, y esta neto de descuentos). No restar el pago del mensajero de la comision al calcularla; el margen es ingreso menos costo, una sola resta.
- **Desconocido != cero**: sin tarifa o sin ingreso => `unknown`, se cuenta aparte y puede ser el hallazgo mas util (regla faltante).
- **Salario**: operacion `covered_by_salary` tiene costo 0 por operacion y su margen NO incluye el salario (costo de periodo, Fase 3); el KPI global debe avisar "no incluye salarios" hasta Fase 3 o se infla.
- **Margen sobre base distinta**: remesa = sobre monto enviado (objetivo 2.125% del cliente); pedido = sobre subtotal. No promediar ambos en un solo %; mostrar dos KPI.
- **Redondeo**: comparaciones sobre centavos ya redondeados (`round(...,2)`), tolerancia 0.005 para no marcar por residuos.
- **No conectar**: (a) nada que el cliente vea: comision %, cargo por tramo, tasa, descuentos, desglose del checkout, correos/WhatsApp (no mostrar margen, umbral ni alerta); (b) no bloquear creacion de remesas/pedidos ni entregas por margen bajo; (c) no modificar automaticamente comisiones/precios/tarifas al detectar riesgo (rechazado, 2.3-4c); (d) no recalcular margen en cada lectura del cliente ni exponerlo en `orders`/`remittances` (el dueno de la fila leeria las columnas); (e) no enganchar `calcForward/calcReverse` ni `_remittance_quote`.
- **Umbral 2.125%**: es un objetivo del cliente (plan previo, Q-c: aun no se confirma si es por remesa de 100 USD o promedio). Con comision 2.41% y mensajera 200 CUP el margen en S=100 es 2.16% y en S=20 sin cargo por tramo 1.15%: con el umbral por operacion, TODAS las remesas chicas saldrian en aviso si no se carga el cargo por tramo del plan 10. Hay que confirmar la semantica (por operacion vs promedio) antes de fijar niveles por defecto; hasta entonces el default es `critical < 0`, `warning < objetivo` solo para el KPI agregado, no por operacion.

### 3b.6 Fases
| Fase | Entra | Difiere |
|---|---|---|
| 1 | funcion pura + gemelo JS + vectores (T0), umbrales configurables (RPC + auditoria), simulador de la pestana Tipos de pago, bandera persistida en la acumulacion (M2), KPI y lista en Dashboard, ack | notificacion por email/WhatsApp, badge del avatar, histeresis fina |
| 2 | margenes de pedidos con combos (junto al componente combo), recompute masivo con UI | - |
| 3 | margen que incluya salarios de periodo | - |
Etapas: se agregan a T0 (vectores de margen), a M2 (columnas `margin_*`, `acked_*` + test: la bandera se escribe en el mismo INSERT, `unknown` sin costo, no cambia al editar una regla despues), los umbrales y su RPC de edicion (`courier_margin_settings`, RLS admin-only, auditoria) entran en **M1** (antes del trigger de M2, que los necesita al persistir `margin_status`); las RPC de reporte, ack y recompute entran en **M3**; F1 (simulador, KPI, tarjeta). Tests primero: `unknown` != 0; umbral inclusivo/exclusivo con tolerancia 0.005; remesa con delivery_cost; pedido sin snapshot; cliente no lee; un no-admin a las RPC recibe 42501; histeresis y N minimo del agregado.

## 3c. Salario periodico OPCIONAL por mensajero registrado (precision del dueno; reemplaza el esbozo de salarios de 3.7)

### 3c.1 Modelo
- Solo aplica a mensajeros REGISTRADOS (`couriers`); una entrega sin mensajero asignado nunca genera salario. Apagado por defecto; lo activa admin/super_admin por mensajero.
- `couriers.pay_mode` ('per_delivery' default | 'salary') mas **`courier_salary_plans`** (admin-only, versionada append-only): `courier_id NOT NULL`, `frequency CHECK IN ('daily','weekly','monthly')`, `amount_cup numeric(12,2) CHECK >= 0` (+ tope de cordura), `valid_from`, `valid_to NULL`, `is_active`, `created_by`. Un solo plan vigente por mensajero: la RPC cierra el vigente e inserta el nuevo bajo `pg_advisory_xact_lock`, sin solape. `admin_set_courier_salary(courier_id, frequency, amount_cup, valid_from)` y `admin_disable_courier_salary(courier_id, valid_to)`: rol re-verificado, auditoria, aplican a periodos FUTUROS (los generados no se reescriben).
- Semana lunes-domingo, mes calendario, zona horaria del negocio (la de `getBusinessWindows`, `dashboardMetrics.js`; una sola, a confirmar).

### 3c.2 Excluye o suma: recomendacion = EXCLUYE
Con salario activo el mensajero NO cobra reglas por entrega ni por combo ("salarios fijos EN LUGAR de comisiones"; sumar ambos es la via normal de pagar dos veces). El trigger de entrega (3.4) consulta el plan vigente en la FECHA DE ENTREGA; si existe, inserta la acumulacion con `covered_by_salary = true`, `amount = 0` (cuenta la entrega) y NO resuelve reglas. Nunca doble pago: (a) indice unico parcial por entrega (3.2); (b) CHECK `covered_by_salary => amount_cup = 0`; (c) el salario es otra tabla y se paga una sola vez por `payment_id`; (d) test: una entrega cubierta jamas aparece en "por pagar". Variante aditiva (salario + bono) = ND-U, no se construye.

### 3c.3 Generacion de periodos
- **Recomendacion: generacion perezosa e idempotente; NO pg_cron al inicio.** El coordinador indica que pg_cron 1.6.4 esta instalado en prod (no lo consulte yo). Un job anade una pieza operativa que falla en silencio y con 0 mensajeros no tiene carga. RPC `admin_close_courier_salary_periods(p_until date)` (SECURITY DEFINER, `is_admin_user()`): genera las acumulaciones de periodos COMPLETADOS (`period_end <= p_until`) aun no generadas, por cada mensajero con plan vigente en ese periodo; se llama al abrir "Por pagar" y con boton. Idempotencia: `UNIQUE(courier_id, period_start, period_end)` + `ON CONFLICT DO NOTHING` (cierre doble o concurrente = una fila). Si despues hace falta automatismo, el mismo RPC se llama desde un pg_cron diario (migracion aparte, sin cambiar logica; ND-V).
- El periodo abierto no genera fila: la vista lo muestra como "devengado a hoy (estimado)".
- **Prorrateo** al activar/desactivar/cambiar importe a mitad de periodo: `round(amount_plan * dias_cubiertos / dias_del_periodo, 2)` por tramo de plan (hasta N tramos en `rule_snapshot.segments`); no aplica a diario (ND-W: alternativa sin prorrateo, el plan vigente al cierre paga el periodo entero).
- **Si no trabajo**: se devenga igual (es fijo); el admin lo anula con motivo (`admin_void_salary_accrual`) o ajusta con una fila `adjustment`. El reporte lista "periodos con 0 entregas" para hacerlo visible (ND-X).

### 3c.4 Contabilidad honesta
- El salario es gasto de PERIODO, no costo de una operacion. El margen por operacion de una entrega cubierta = ingreso - 0, con `margin_basis = 'excl_salary'` (la lista y el KPI por operacion dicen que NO incluye salarios; nunca `unknown` por esto).
- Dashboard: linea aparte "Salarios de mensajeria" por ventana (fecha contable `period_end`, ND-Y), restada UNA vez en el neto del periodo; KPI de margen neto del periodo = (ingresos - costos por operacion - salarios devengados) / base. **No se prorratea por entrega**: una entrega de 20 USD cargaria un porcentaje arbitrario segun cuantas entregas hubo esa semana, y mezclaria periodos.
- Sin doble costo: las operaciones `covered_by_salary` tienen costo efectivo 0 (se IGNORA su snapshot por zona; si no, saldria estimado + salario). El KPI agregado indica "incluye / no incluye salarios".

### 3c.5 Estados y pago
`courier_salary_accruals`: `id`, `courier_id`, `period_start`, `period_end`, `frequency`, `amount_cup`, `fx_used` (tasa activa USD->CUP al CERRAR el periodo), `amount_usd`, `status CHECK IN ('calculated','paid','void')`, `payment_id NULL`, `rule_snapshot jsonb`, `created_at`, `voided_by/void_reason`. "Pendiente de pago" = calculated sin `payment_id`; "pagada" = con pago. Reutiliza `courier_payments` (metodo, referencia, fecha) de M3: un pago puede incluir acumulaciones por entrega y salariales del mismo mensajero; cada acumulacion en un solo pago, sin pagos parciales (ajuste negativo para diferencias). Anular/ajustar una pagada: solo super_admin (ND-L).

### 3c.6 Fase
**Fase 3, despues de la 1** (0 mensajeros hoy; no hay con quien validar). La compuerta `covered_by_salary` del trigger ya entra y se prueba en fase 1 con un plan simulado en test, asi activar salarios no toca el flujo de entrega. Entra en M5 (`20261101110000_courier_salaries.sql`): planes, acumulaciones, RPC de cierre, prorrateo, linea del Dashboard y pago. Si el dueno quiere salarios desde el dia 1 es la unica pieza adelantable a fase 1b, sin dependencias nuevas.
Tests M5: un periodo por mensajero (cierre doble y concurrente); prorrateo (activar/desactivar/cambio de importe); sin solape de planes; salario excluye reglas; `covered_by_salary => 0`; costo efectivo 0 sin sumar snapshot; periodo abierto sin fila; anulacion con motivo; permisos admin vs super_admin; cliente no lee; pago unico.
- **ND-U** aditivo (salario + bono): reco NO. **ND-V** pg_cron: reco no al inicio. **ND-W** prorrateo por dias: reco SI. **ND-X** devengar sin entregas: reco SI con aviso y anulable. **ND-Y** fecha contable `period_end`.

## 4. Decisiones ND
- **ND-I** asignar mensajero: opcional con aviso; obligatorio si hay 2+ activos. 
- **ND-J** tasa de conversion en pedidos: 830 (activa) o 810 (efectiva de remesa). Reco: la de cada flujo, ya definida arriba, salvo que el dueno quiera una sola.
- **ND-K** pagos: reco incluir `courier_payments` desde fase 1 (barato; sin ello "pagada" no tiene evidencia).
- **ND-L** quien edita: admin + super_admin (reglas, mensajeros, pagos); anular/ajustar acumulaciones pagadas solo super_admin.
- **ND-M** estado "aprobada" intermedio: reco NO.
- **ND-N** formula UNICA para pedidos (margen y Dashboard): hoy `orderProfit` EXCLUYE el envio (pass-through: `computeOrderCosts` = ingresos - envio - ganancia, `dashboardMetrics.js:263-266`; `computeHeadline` solo suma `orderProfit`, `:253-256`) y el costo de mensajeria de pedidos no se resta. Reco: tratar el envio como las remesas tratan `delivery_cost`: `neto pedido = orderProfit + shipping_cost cobrado - costo efectivo`, igual en el margen Y en el headline, solo para pedidos con costo conocido (si es `unknown`, no se suma ni el envio ni el costo: se cuenta aparte). Alternativa: dejar ambos fuera (margen pedido = orderProfit) y mantener la tarjeta aparte actual. Es un CAMBIO de definicion del Dashboard y debe comunicarse; nunca restar el costo sin sumar el envio cobrado.
- **ND-O** una regla por componente, sin apilar: reco SI.
- **ND-P** backfill de las 24 entregas ya hechas: reco NO (quedan con estimado).
- **ND-Q** alcance por provincia (ademas de zona/municipio): reco NO por ahora; la zona ya es la fila provincia+municipio.
- **ND-R** umbral 2.125%: ¿por operacion o promedio? Reco: promedio/ventana para el aviso agregado; por operacion solo `critical < 0`.
- **ND-S** alertas solo en Dashboard + sub-pestana (no badge del avatar). Reco SI.
- **ND-T** persistir la bandera en la acumulacion (reco) vs recalcular al leer.
- Salarios: ND-U..ND-Y en 3c.

## 5. Preguntas minimas al cliente (en orden de bloqueo)
1. Remesas: ¿"1 CUP por cada USD" reemplaza los 200 CUP por entrega o es otra modalidad (por mensajero)? ¿USD entregado = lo enviado o lo enviado menos comision?
2. ¿Cuantos mensajeros hay hoy y cobran distinto? ¿Todos cobran por entrega o alguno tiene salario?
3. Pedidos: ¿se paga una tarifa por entrega (cuanto, por zona)? ¿Los mismos mensajeros reparten remesas y pedidos?
4. ¿Se paga en el momento o se liquida por semana/mes (para saber si "por pagar" es una vista de trabajo)?
5. Combos (fase 2): ¿"precio minimo" es el precio del combo en el pedido, por unidad? ¿1500 CUP aplica a cada unidad? ¿El combo bajo el minimo cobra algo?
6. ¿El objetivo 2.125% se mide por cada remesa o sobre el total del periodo? ¿Aviso tambien para pedidos (que % objetivo)?
7. Salarios (opcionales): ¿que mensajeros tendrian salario, de cuanto y con que frecuencia? ¿el salario REEMPLAZA lo que cobran por entrega? ¿se paga aunque no trabaje?

## 6. Lo que NO verifique
- No ejecute tests ni migraciones; nada aplicado a prod. No probe el SQL propuesto.
- No lei linea a linea los modales de confirmar entrega (`AdminRemittancesInbox`, `AdminOrdersTab`, `UserPanel`) ni `SettingsPage.jsx` mas alla de ubicar `tabs` (`:345`).
- No re-lei `financial_audit_log`/`financial_audit_columns` ni `exchange_rates` en esta sesion (se asumen los patrones del plan previo); el numero de filas de `financial_audit_log` (8) es de prod.
- No confirme que el `currency_id` uniforme de pedidos sea USD; no hay pedidos EUR/Bizum para probar la conversion.
- No verifique el uso real de `is_manager()` ni si hay otros caminos que cambien `status` a delivered (se leyeron `_order_transition` y `_remittance_transition` solo en las lineas citadas; `guard_status_via_rpc` los restringe, segun plan previo).
- Las cifras de volumen son de 33 pedidos y 27 remesas: no hay base estadistica.
