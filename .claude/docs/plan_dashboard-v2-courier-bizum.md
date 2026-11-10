# Plan: Dashboard v2 — mensajería (costo efectivo, acumulaciones, pagos) y Bizum (cobros por método)

Estado: PLAN (solo lectura de código y BD). Nada implementado, nada aplicado, sin commit/push. Fecha: 2026-10-27. Base: origin/main `d1c4f46b`.
Evidencia: `archivo:línea` del worktree o resultado de SELECT agregado a prod (sin PII; MCP supabase-papuenvios, 2026-10-27). Lo que NO pude verificar está marcado **[NV]**.
Fuentes leídas: `plan_courier-management-module.md`, `plan_courier-cost-per-order.md` (solo existencia), `plan_remittance-courier-spread-model.md` (solo búsqueda de salario), `plan_bizum-payment-method.md`, sección mensajería/Bizum de `TRACKING_PROGRESS.md`, migraciones `courier_*`/`bizum_*`, tests `DashboardPage.*.test.jsx` y `dashboardMetrics.test.js`.

---

## 0. Alcance real (leer primero)

**Hoy NO se puede mostrar "todo" lo pedido.** No es una decisión de diseño: faltan piezas de trabajo previo que no existen en producción. Este plan entrega lo que sí es posible (F1, F2 solo pedidos, F3 parcial) y deja lo demás bloqueado hasta que se construya su prerrequisito:

| Pedido | Bloqueo (verificado) | Qué haría falta | Tamaño estimado |
|---|---|---|---|
| Bizum en **remesas** | `remittances` no tiene columnas Bizum: solo `payment_method` (SELECT a `information_schema` en prod, 2026-10-27); 29/29 Zelle. Falta el slice **S5b**. | Migración: columnas `payment_currency/amount/usd_reference/fx_rate/fx_rate_id/quote_id/concept_code/bizum_account_id` + CHECKs `NOT VALID`+`VALIDATE` + trigger de sellado para remesas + RPC de creación server-side (depende de F4a "precio calculado en servidor", `TRACKING_PROGRESS.md:177`) + front de checkout + tests de concurrencia. | L (2-3 PR, migraciones + front) |
| **Conciliación** (validado sin referencia, importe distinto) | Nadie escribe `decision`, `received_amount`, `bank_reference` en `payment_reviews` (`…s5a…sql:31`: "Decision columns are for slice S6; no RPC writes them yet"); la tabla solo se llena cuando hay banderas. Falta el slice **S6**. | RPC admin de validar/rechazar pago Bizum que escriba esos campos (con unicidad de referencia normalizada ya indexada), modal de validación consciente del método, tests. | M-L (1-2 PR, 1 migración) |
| **Spread EUR** (ingreso por spread) | El sellado congela solo `effective_rate`; no la tasa media ni el spread (`…s5a…sql:~340-348`; `fx_rate_id` es procedencia sin FK y `exchange_rates` se edita in situ). Imposible reconstruirlo para operaciones futuras sin cambiar el sellado, e imposible para las pasadas. | Congelar `payment_fx_mid_rate` y `payment_spread_pct` (columnas nuevas NULL en `orders`, y en `remittances` tras S5b) y **`CREATE OR REPLACE` de `seal_bizum_payment`** (función DEFINER viva) partiendo del `prosrc` de **PRODUCCIÓN** (difiere del repo solo en 2 líneas de comentarios; lógica idéntica, verificado en `TRACKING_PROGRESS.md:370`), con test que compare md5 de columnas existentes. Solo aplica a Bizum nuevo. | M (1 migración + tests de sellado) |
| **Salario** de mensajero | No existen `courier_salary_*` en prod. Falta **M5** (`plan_courier-management-module.md` §3c), no escrita. Además 0 mensajeros. | Migración M5: planes, acumulaciones de período, RPC de cierre idempotente, pago vía `courier_payments`; luego línea de Dashboard. | L (1 migración grande + front + tests) |

Consecuencia: el entregable inmediato es F1 (mensajería completa salvo salario), F2 (cobros por método para pedidos) y F3 (revisiones pendientes y huérfanas). Además, **Bizum no puede recibir pedidos hoy por un bloqueo operativo de tasa y cuentas** (ver B0).

---

## 1. Estado actual (qué hay y qué no)

### 1.1 Datos reales hoy en prod (SELECT agregados)

| Objeto | Resultado |
|---|---|
| Migraciones del módulo mensajería | APLICADAS: `20261026135340 couriers_and_payment_types`, `…135536 delivery_assignments_and_accruals`, `…135615 courier_payments_and_report` (`list_migrations`). Los encabezados del repo dicen "PREPARED, NOT APPLIED" (`…20261031110000…sql:2`): están desactualizados. |
| Migraciones Bizum | APLICADAS: s3, s4, s5a (+checks), central_fx_rate. Bizum sigue `available = false` (`…bizum_s5a_quotes_and_order_sealing.sql:4-5`). |
| `couriers` / `messenger_payment_types` / `delivery_assignments` / `courier_payments` | 0 / 0 / 0 / 0 |
| `courier_accruals` | 3 filas, todas `calculated/delivery`, las 3 con `amount_usd` NULL (sin regla), entregadas 2026-10-26 |
| `courier_margin_settings` | `remittance` y `order` con target/warning/critical = NULL (sin umbrales) |
| `v_effective_courier_cost` | pedidos: 5 filas, todas `is_estimated=true` y `amount_usd` NULL; remesas: 3 filas, igual. Es decir, HOY todo costo es desconocido. |
| Entregadas sin acumulación (pre-módulo, sin backfill) | 24 operaciones (pedidos+remesas `delivered/completed`) |
| Pedidos | 33, todos `payment_method='zelle'`, `payment_status='validated'`; estados: processing 3, dispatched 8, delivered 3, completed 19 |
| Remesas | 29, todas `payment_method='zelle'`; USD→CUP 26, USD→USD 3 |
| Bizum | `bizum_accounts` 0, `payment_quotes` 0, `payment_reviews` 0; tasas activas EUR→USD, USD→EUR, USD→CUP, CUP→USD |
| Tablas de salario (`courier_salary_*`) | NO existen (lista de relaciones `courier*`/`messenger*` de prod) |
| `payment_ledger` (propuesto en `plan_bizum…§3.4`) | NO existe (`to_regclass` = NULL). Los totales por método salen de `orders`/`remittances`. |

### 1.2 Qué muestra hoy el Dashboard

- **Carga** (`DashboardPage.jsx:172-175`): `orders` (con `payment_method`, `shipping_cost`, `shipping_zone_id`), `remittances` y `zelle_transaction_history` por `fetchAllRows` (paginado de 1000, `fetchAllRows.js`). Estadísticas se recalculan cada 30 s y por realtime (`:299-321`).
- **¿El `netIncome` de PEDIDOS usa costo efectivo o snapshot legado? Ninguno de los dos: el costo de mensajería de pedidos NO entra al neto.** `computeHeadline` (`dashboardMetrics.js:253-260`) = `orderProfit + comisión + cargo de entrega − costo de mensajería de REMESAS`; no recibe parámetro de costo de pedidos. La tarjeta de pedidos (`computeCourierCostTotals`, `:145-155`; UI `DashboardPage.jsx:896-962`) es informativa aparte. Coincide con `plan_courier-management-module.md:22`. Además `orderProfit` excluye el envío (`estimateOrderProfit`, `:320-346`), por lo que el envío cobrado al cliente tampoco suma en el neto: es "pass-through" sin costo ni ingreso.
- **El costo de REMESAS sí entra al neto, y viene del costo efectivo**: `courierCostService.js:16,50-56` lee `v_effective_courier_cost` (una cifra por operación: acumulación conocida, si no snapshot legado estimado; `…110000.sql:308-328`) y cae a las tablas legadas SOLO si la vista no existe (códigos `42P01/PGRST205`, `:17,54-55`). No hay doble conteo. Límite: el servicio selecciona solo `amount_usd` (`:30`), **no lee `is_estimated`**: el Dashboard no distingue "devengado real" de "estimado por zona".
- **Fecha del costo**: la operación conserva su fecha contable (pedido `validated_at`, remesa `payment_validated_at`, `dashboardMetrics.js:98,196-207`), no `delivered_at` de la acumulación.
- **Moneda**: todo el Dashboard financiero es USD; el servicio asume USD ("shortcut" `DashboardPage.jsx:364-366`). `courier_accruals.amount_cup` y `courier_payments.amount_cup` (CUP) no se muestran.
- **Tarjeta de margen** (`CourierMarginCard.jsx:79-107`): cuatro contadores del mes (`critical`, `warning`, `unknown`, `unknownAmount`) desde `admin_courier_report`; se oculta sin módulo o sin umbrales (`:88`) — hoy oculta, porque los umbrales están en NULL. Bug menor: `getMarginSummary` calcula el mes con zona LOCAL del navegador (`courierService.js:124-125`), mientras el resto del Dashboard usa `America/New_York` (`dashboardMetrics.js:28,64-81`).
- **Medios de pago**: `paymentMethodBreakdown` (`dashboardMetrics.js:112-118`) agrupa por `payment_method` TODOS los pedidos con estado activo (no exige `payment_status='validated'`, no usa ventana: "histórico, todos los pedidos activos", `ES.json:881`), suma `total_amount` (que es USD), solo super_admin (`DashboardPage.jsx:588`), **solo pedidos** (las remesas no entran). Un pedido Bizum aparecería automáticamente como clave `bizum` con su total USD, pero SIN su monto EUR ni su tasa. No suma monedas distintas (todo es `total_amount` USD; para Bizum el sellado exige `currency_id`=USD y copia `payment_usd_reference` del `usd_amount` de la cotización: `…s5a_quotes_and_order_sealing.sql:~320-345`).
- **Zelle**: `computeZelleTotals` (`dashboardMetrics.js:242-245`) suma `zelle_transaction_history` validado (USD) por `transaction_date`. Un pedido Bizum no tiene `zelle_account_id` (CHECK `orders_bizum_coherence`, verificado en prod), y según `plan_bizum…§1` el sync a esa tabla se omite sin cuenta Zelle **[NV: no localicé la línea en el código actual; verificar al implementar F2]**.
- **No existe hoy en el Dashboard**: tipos de pago de mensajero, acumulaciones/pagos/por pagar, desglose por mensajero, costo estimado vs real, umbrales (solo contadores), cobros Bizum, revisiones (`payment_reviews`), pedidos huérfanos de cotización, salario. Tests existentes cubren solo lo ya construido (`DashboardPage.courierCost`, `.financials`, `dashboardMetrics.test.js`).

### 1.3 Qué ya existe en BD para leer (sin migración)

| Fuente | Quién lee (RLS/GRANT) | Qué da | Límite |
|---|---|---|---|
| `v_effective_courier_cost` (security_invoker) | `authenticated` + RLS admin de las tablas base (`…110000.sql:330-331`) | costo USD por operación + `is_estimated` + `recorded_at` | sin mensajero, sin CUP |
| `admin_courier_report(from,to,courier)` | RPC DEFINER, `_courier_require_admin` (admin o super_admin) (`…120000.sql:139-183`) | por mensajero (por `delivered_at`): entregas, devengado CUP/USD, pagado CUP, pendiente CUP, anulado, desconocidos, conteos de margen | **no** da `paid_usd`/`pending_usd`; no desglosa por tipo de pago/regla; `accrued_usd` ignora NULL (subestima si hay desconocidos: se cuentan aparte en `unknown_amount_count`) |
| `courier_accruals` (SELECT admin) | `is_admin_user()` incluye `admin` y `super_admin` (def. de `is_admin_user`, prod) | filas por operación, `rule_snapshot` (código de regla), `margin_*` | `listAccruals` limita a 500 sin paginar (`courierService.js:88-91`) |
| `courier_payments` (SELECT admin, inmutable) | admin | pagos con método/fecha/monto CUP/USD | sin RPC agregada |
| `messenger_payment_types`, `couriers`, `courier_margin_settings` | admin (SELECT) | reglas versionadas, mensajeros, umbrales | — |
| `orders.payment_*` Bizum (8 columnas) | admin lee `orders` por RLS | método, moneda, monto nativo, USD de referencia congelado, tasa efectiva congelada, cuenta, código | solo PEDIDOS: `remittances` NO tiene `payment_currency/amount/usd_reference/fx_rate` (information_schema prod: solo `payment_method`); es el slice S5b, "no iniciado" (`TRACKING_PROGRESS.md:177`) |
| `payment_reviews` (SELECT admin) | admin o super_admin | `flags` (`quote_expired`, `quote_rate_moved`), `decision` ∈ pending/validated/rejected, `expected_amount`, `received_amount`, `bank_reference` | **solo se inserta cuando hay flags** (`…s5a…sql:355-358`); "no RPC writes decisions yet" (slice S6, `:31`). Sin S6 no hay estado "validado/rechazado" ni referencia bancaria que conciliar. |
| `admin_list_orphan_quotes()` | admin (`…s5a…sql:575-602`) | cotizaciones con prueba subida y sin pedido | firma exacta a confirmar al implementar |

---

## 2. Inventario de brechas por tarjeta/métrica

Leyenda de fuente: **V** = vista/tabla existente, **R** = RPC existente, **N** = RPC/vista nueva necesaria.

### 2.1 Mensajería (F1)

| # | Tarjeta / métrica | Fuente | Hace falta | Nota |
|---|---|---|---|---|
| M1 | Costo efectivo por operación, separando **devengado** vs **estimado por zona** | V (`v_effective_courier_cost.is_estimated`) | solo front: agregar `is_estimated` al `select` (`courierCostService.js:30`) y al Map | cero migración |
| M2 | Neto de PEDIDOS con costo de mensajería | V + front | cambiar `computeHeadline` (nuevo parámetro `orderCourierCost` y `orderShippingCharged`); **bajo flag** | decisión del dueño Q1 |
| M3 | Costo en el neto: "desconocido" visible (no 0) | front | contador de operaciones sin costo en la línea del neto | ya existe el patrón (`Unrecorded`/`MissingRow`) |
| M4 | Obligación con mensajeros: **por pagar** (CUP y USD), **pagado**, **anulado**, desconocidos | N: `admin_dashboard_courier_summary(p_from,p_to)` | `admin_courier_report` no trae USD pagado/pendiente | agregados en servidor; ver §4 F1 |
| M5 | **Por mensajero** (tabla: entregas, devengado, pagado, pendiente, "sin mensajero asignado") | R (`admin_courier_report`) | ninguna para CUP; USD vía M4 | `courier_id NULL` = "sin mensajero" (modo dual) |
| M6 | **Por tipo de pago de mensajero** (código de regla, versión): entregas y monto | N (mismo RPC de M4; agrupa por `rule_snapshot->>'code'`) | el código vive en `rule_snapshot jsonb` (M2 §tabla): confirmar clave exacta **[NV]** | alternativa `rule_id` → join `messenger_payment_types.code`; preferible (FK real) |
| M7 | Pagos de mensajería del período (por `paid_at`: monto, método, cantidad) | N (mismo RPC, segundo bloque) o V directa (`courier_payments` es chica) | — | métodos de pago libres (texto), sin PII (`reference` no se devuelve) |
| M8 | Margen: contadores warning/critical/unknown + "umbrales sin configurar" (hoy tarjeta oculta) | R (`getMarginSummary`) | corregir zona horaria (usar `getBusinessWindows`); mostrar CTA cuando faltan umbrales | hoy 0 umbrales ⇒ no se ve nada |
| M9 | Umbrales vigentes (target/warning/critical por tipo) | V (`courier_margin_settings`) vía `getMarginSettings` | front | solo lectura; edición ya existe en Settings |
| M10 | Cobertura: entregas sin acumulación (24 históricas) y acumulaciones con monto desconocido (3) | R (`admin_list_deliveries_without_accrual`, `unknown_amount_count`) | front | **no** ejecutar backfill desde el Dashboard (reprecia con tasa/regla de hoy) |
| M11 | Mensajeros / tipos de pago activos (contadores) y estado vacío guiado | V | front | prod: 0 y 0 ⇒ estado vacío con enlace a Settings |
| M12 | Salario de período (fase 3) | — | **no existe en BD** (`courier_salary_*` ausentes) | ver F4 |

### 2.2 Bizum / cobros por método (F2, F3)

| # | Tarjeta / métrica | Fuente | Hace falta | Nota |
|---|---|---|---|---|
| B1 | Cobros **por método** (Zelle vs Bizum): cantidad, total USD congelado, ventana diaria/mensual/anual | N: `admin_dashboard_payments_by_method(p_from,p_to)` | RPC agregada (hoy el desglose es histórico y sin `payment_status`) | pedidos validados, `validated_at` en ventana |
| B2 | Bizum en moneda nativa (EUR) **y** USD congelado | N (mismo RPC): `sum(payment_amount)` por `payment_currency`, `sum(payment_usd_reference)` | — | nunca convertir con tasa viva; no sumar EUR+USD en un mismo total |
| B3 | Tasa efectiva media ponderada congelada (`payment_fx_rate`) | N (mismo RPC) | informativa | derivada: `sum(payment_amount)/sum(payment_usd_reference)` |
| B4 | Remesas por método | N (rama futura) | **imposible hoy**: `remittances` no tiene columnas Bizum (S5b no iniciado); prod 29/29 Zelle | solo mostrar "Zelle" + nota "Bizum en remesas: no disponible aún" |
| B5 | Efecto en ganancia/comisión | front | el neto de pedidos se calcula en USD (`total_amount`); Bizum no lo altera. El **spread EUR** (`default_spread_pct`) **no se puede reconstruir**: el sellado congela `effective_rate` pero no la tasa media ni el spread (`…s5a…sql:~340-348`, `fx_rate_id` es solo procedencia sin FK; `exchange_rates` se edita in situ, `central_fx_rate` header) | no inventar "ingreso por spread"; Q3 |
| B6 | Revisiones pendientes (`payment_reviews`): por bandera (`quote_expired`, `quote_rate_moved`), antigüedad del más viejo | N (RPC pequeña) o V directa (tabla chica, solo conteos) | RLS ya permite SELECT admin | hoy 0 filas |
| B7 | Cotizaciones huérfanas (pagó y no hay pedido) | R (`admin_list_orphan_quotes`) | front: solo contador | alerta operativa |
| B8 | Cuentas Bizum activas / sin cuentas (bloquea activar) | V (`bizum_accounts`, admin ALL) | front | prod: 0 |
| B9 | Conciliación (validado sin referencia bancaria; pagos tardíos; importe distinto) | — | **bloqueada por S6**: `received_amount`/`bank_reference`/`decision` no se escriben aún (`…s5a…sql:31`) | F3 solo entrega B6/B7; conciliación real = Q4 + S6 |
| B10 | Equivalente USD de Bizum cuando falta el congelado | front | mostrar "—" (regla ya fijada en `plan_bizum…§9.6`) | CHECK `orders_bizum_coherence` garantiza `payment_usd_reference > 0` en Bizum |

---

## 3. Riesgos y precauciones

1. **Números históricos que cambian** (comunicarlo en UI y en TRACKING):
   - M2 cambia el **neto** de pedidos: pasa a restar el costo y, para no subestimar, a sumar el envío cobrado (`plan_courier-management-module.md` ND-N). Hoy el efecto es 0 porque los 5 costos de pedidos son NULL; aparecerá al configurar reglas. Se entrega **detrás de flag, con "antes / después" lado a lado** durante un período de conciliación y una nota "incluye costo de mensajería de pedidos desde <fecha de activación>".
   - B1 cambia el desglose por método: pasa de "histórico, todos los activos, cualquier `payment_status`" a "validados por ventana". El número histórico del desglose cambia aun sin Bizum: etiquetar y conservar el viejo bajo flag.
   - `admin_backfill_missing_accruals` / `admin_recalculate_accrual` usan regla y tasa de AHORA (`…110000.sql:24-25`): re-preciar 24 entregas históricas cambiaría el costo pasado. El Dashboard solo informa; el backfill queda en Settings con su confirmación.
2. **Doble conteo del costo**: la vista garantiza UNA cifra por operación (`…110000.sql:308-328`); el Dashboard NO debe leer jamás `order_courier_costs`/`remittance_courier_costs` junto a la vista (ya cumplido, `courierCostService.js:9-10`). Separar en UI dos conceptos que no se suman: **Costo (P&L, USD, por fecha de la operación)** vs **Obligación con mensajeros (CUP/USD, por `delivered_at`/`paid_at`)**. Una operación con acumulación de monto desconocido y snapshot usa el snapshot estimado en el P&L pero cuenta como "desconocido" en la obligación: mostrar ambos conteos. Mensajero asalariado (fase 3): `covered_by_salary` ⇒ costo 0 en la operación y el salario entra UNA vez como costo de período (`plan_courier-management-module.md:48,227`).
3. **Mezcla de monedas**: mensajería en CUP con equivalente USD (`fx_used` congelado); Bizum EUR con USD congelado (`payment_usd_reference`, `payment_fx_rate`). Reglas: (a) cada monto con su moneda y símbolo; (b) totales "≈ USD" solo con campos congelados; (c) CUP y USD de mensajería no se suman entre sí; (d) `amount_usd` NULL ⇒ "—" y contador de desconocidos, jamás 0 (`pending_amount_usd` ya advierte que "no es total adeudado", `TRACKING_PROGRESS.md:308`). Los pagos a mensajeros solo se registran en CUP con `amount_usd` opcional.
4. **Paginación y límites PostgREST**: PostgREST corta en ~1000 filas sin error (`fetchAllRows.js:1-8`). Las lecturas nuevas deben ser: RPC agregadas (devuelven <100 filas) o `fetchAllRows` con `.order()` estable. No usar `listAccruals` (límite 500, sin paginar) para totales. El Dashboard ya trae TODOS los pedidos/remesas cada 30 s (`:172-173`): no agregar más filas crudas; los agregados nuevos van en servidor. Las RPC se llaman con `p_from/p_to` calculados por `getBusinessWindows()` (una sola definición de zona horaria) — no reimplementar la zona en SQL.
5. **RLS/GRANT y quién ve qué**: las tablas de mensajería son SELECT para `is_admin_user()` = admin **y** super_admin (def. en prod; `…100000.sql:106-110`). El Dashboard financiero, en cambio, está tras `isSuperAdmin` (`DashboardPage.jsx:466,554,588,630,679`): es una restricción de **UI**, no de seguridad (un admin ya puede leer `orders`/`remittances` por API). Decisión: RPC nuevas con `_courier_require_admin()` (misma barrera que `admin_courier_report`); la tarjeta se muestra solo a super_admin igual que las demás. Si el dueño quiere que el admin NO vea márgenes ni salarios, el RPC de neto/salario debe exigir `is_super_admin()` (Q5). Pagos a mensajeros ya son visibles a admin en Settings > Mensajería > Por pagar/Reportes.
6. **Degradación si la RPC/vista no existe**: patrón existente `read()` de `courierService.js:35-44` (códigos `42P01/42883/PGRST202/PGRST205`, reintento a 5 min, sin toast ni log). Cada tarjeta nueva tiene 4 estados: cargando / vacío guiado / no disponible (módulo ausente) / error ("no disponible", nunca ceros: `courierCostService.js:9-10`). Front desplegable ANTES que las migraciones.
7. **Rendimiento**: en prod las tablas son diminutas (33/29/3), así que `EXPLAIN` en prod no informa. Obligatorio antes de aplicar: `EXPLAIN (ANALYZE, BUFFERS)` de cada RPC nueva en una rama/BD local con datos sintéticos (`generate_series`, 50k pedidos, 20k acumulaciones). Índices existentes: `courier_accruals_courier_delivered_idx (courier_id, delivered_at)`, `courier_accruals_status_idx` (`pg_indexes` prod); `orders` NO tiene índice por `validated_at` ni `payment_method` (lista de índices de `orders` en prod). Si el plan muestra Seq Scan costoso, migración aditiva `CREATE INDEX IF NOT EXISTS` parcial (`… (validated_at) WHERE payment_status='validated'`). No optimizar antes de medir.
8. **Privacidad**: las RPC devuelven solo agregados y códigos (sin `reference`, `notes`, teléfonos, nombres de clientes ni ids de operación; sí `courier_name`, ya expuesto por `admin_courier_report`). `payment_reviews.bank_reference` y `payer_phone_norm` **no** se seleccionan. Contadores y antigüedad, nada más. CSV (si se agrega) reutiliza el escape de fórmulas existente (`courierRules`).
9. **Fechas**: el P&L usa la fecha de la operación (validación de pago) igual que ingresos; "por mensajero/por pagar" usa `delivered_at`; pagos usan `paid_at`. Una entrega que cruza el límite de mes aparece en meses distintos en cada vista: rotular cada tarjeta con su base de fecha ("por fecha de entrega", "por fecha de pago", "por fecha de validación"). Ventanas de calendario `America/New_York` (`dashboardMetrics.js:28`).
10. **Flag por etapas (mecanismo concreto)**: `localStorage` por navegador, clave `papuenvios.dashboardV2`, valor `"1"`; lectura/escritura siempre en `try/catch` (si falla, se asume OFF). Solo super_admin: el interruptor "Vista ampliada (beta)" se renderiza únicamente si `isSuperAdmin`, en el encabezado del Dashboard (y se duplica un enlace en Settings > Mensajería). **Apagado por defecto.** Se prende marcando el interruptor (recarga el estado del componente, sin recargar página); se apaga igual. Sin variable de entorno (no exige redeploy), sin migración, sin tabla. Consecuencia asumida: es por navegador/dispositivo, no global; pasar a ON por defecto para todos es un cambio de una línea cuando el dueño lo apruebe. Un hook `useDashboardV2Flag()` es el único punto de lectura (testeable con `localStorage` simulado y con acceso bloqueado). Bizum sigue protegido por su propio `available=false` en servidor.
11. **Datos de producción intocables**: todo es lectura. Cero DML sobre tablas existentes. RPC `STABLE`, `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` + `GRANT EXECUTE … TO authenticated` (patrón `…120000.sql:179-188`), rol re-verificado dentro.
12. **Test existentes frágiles**: los mocks del Dashboard tratan la vista como ausente por defecto (`TRACKING_PROGRESS.md:343`); los tests nuevos deben mockear las RPC nuevas como ausentes por defecto para no romper `DashboardPage.*.test.jsx`.
13. **`admin_backfill_missing_accruals` NO se ejecuta sobre las 24 entregas previas al módulo mientras no existan tipos de pago de mensajero** (hoy 0). Sin regla crearía 24 acumulaciones con `amount_usd` NULL (inútiles y que ensucian "desconocidos"), y con reglas futuras repricearía el pasado con la regla y la tasa de ahora. **Hecho verificado (`pg_get_viewdef`, 2026-10-27)**: `v_effective_courier_cost` usa `CASE WHEN delivery_known THEN usd_sum ELSE estimate_usd END`; una acumulación con monto NULL deja `delivery_known=false`, así que NO pisa el snapshot legado y `is_estimated` queda como hoy. No hay regresión viva; la precaución es de higiene y de no repreciar. El Dashboard nunca invoca el backfill.
14. **Seguimiento rápido (NO arreglar en este plan)**: `getMarginSummary` calcula el mes con la zona local del navegador (`courierService.js:124-125`) en vez de `America/New_York`. Se corrige dentro de F1 solo al tocar ese archivo; hoy queda anotado como bug menor.
15. **Tamaño de componente**: `DashboardPage.jsx` ya tiene 1092 líneas. Las tarjetas nuevas van en archivos nuevos (`src/components/admin/dashboard/…`), y la lógica en `dashboardMetrics.js` (puro) + `dashboardV2Service.js` (I/O). No crecer el componente grande.

---

## 4. Diseño propuesto por fases

Cada fase = una rama/PR, test rojo primero (TDD), un solo push al final tras verificación (preferencia del dueño). Las migraciones se aplican a prod solo con "dale" aparte, después del deploy del front.

### F1 — Mensajería (costo efectivo, por pagar, por mensajero, margen)

**Migración aditiva `M-D1`** (nombre sugerido `2026110xxxxxx_dashboard_courier_summary.sql`, solo funciones, sin tablas ni columnas):
- `admin_dashboard_courier_summary(p_from timestamptz, p_to timestamptz)` → `RETURNS jsonb` (o `TABLE`) en 3 bloques, todos filtrados por `delivered_at ∈ [p_from,p_to)` salvo pagos (`paid_at`):
  1. `by_courier`: `courier_id`, `courier_name`, entregas, `accrued_cup`, `accrued_usd`, `paid_cup`, `paid_usd`, `pending_cup`, `pending_usd`, `unknown_amount_count` (no suma NULL como 0).
  2. `by_rule`: código/versión de regla (vía `rule_id` → `messenger_payment_types.code`), entregas, `accrued_cup`, `accrued_usd`, desconocidos.
  3. `payments`: cantidad y suma `amount_cup`/`amount_usd` de `courier_payments` por `paid_at` en la ventana.
- Gate `PERFORM public._courier_require_admin()`; agregados en servidor; sin ids de operación ni notas.
- **No** se modifica `admin_courier_report` (cambiar `RETURNS TABLE` exigiría DROP; evitamos tocar lo aplicado).
- Rollback: `supabase/rollbacks/…_dashboard_courier_summary_down.sql` = `DROP FUNCTION IF EXISTS …` (sin datos que perder).

**Front**:
- `courierCostService.js`: devolver también `isEstimated` por operación (Map con `{amount, estimated}` o un segundo Map; mantener compatibilidad de `firstRecordedAt`).
- `dashboardMetrics.js` (puro): `computeHeadline` acepta `orderCourierCost`, `orderShippingCharged` (opcionales; ausentes ⇒ comportamiento actual byte a byte); nuevas `computeCourierCostSplit` (estimado vs devengado vs desconocido por ventana); `summarizeCourierObligations(rows)`.
- `courierService.js`: `getDashboardCourierSummary({from,to})` con `read()` (degrada); corregir `getMarginSummary` para usar ventana del negocio.
- Tarjetas (archivos nuevos): "Costo de mensajería (P&L)" con estimado/devengado/desconocido; "Obligación con mensajeros" (por pagar / pagado / desconocidos, CUP y USD, rotulada por fecha de entrega); "Por mensajero" (tabla; fila "Sin mensajero asignado"); "Por tipo de pago"; "Pagos del período"; margen (contadores + umbrales o CTA a Settings); estados vacíos (0 mensajeros, 0 tipos de pago) con enlace a la pestaña Mensajería.
- Todo bajo el flag (§3.10). Neto de pedidos con costo: tras el flag y con comparación "antes / después".

**Tests (fixtures sintéticos, TDD)**:
- `dashboardMetrics.test.js`: (a) `computeHeadline` sin parámetros nuevos == resultado actual (regresión); (b) con costo de pedidos conocido resta costo y suma envío cobrado; (c) costo NULL no es 0 y se cuenta como desconocido; (d) operación en acumulación + snapshot ⇒ una sola cifra (el Map ya trae la vista); (e) mensajero asalariado con costo 0 no duplica; (f) ventanas ET con entrega a 23:59:59 ET.
- `DashboardPage.courierV2.test.jsx` (nuevo): flag off ⇒ DOM idéntico al actual; flag on ⇒ tarjetas; RPC ausente ⇒ "no disponible" sin romper; RPC con error ⇒ no ceros; sin mensajeros ⇒ estado vacío; CUP y USD con símbolo correcto y sin sumarse; paginación (>1000 operaciones) en lectura del costo.
- Test de BD (patrón `src/tests/concurrency/` + `courierTestKit.js`): la RPC rechaza no-admin (42501), no devuelve PII, `unknown_amount_count` correcto con acumulación NULL, agrupa `courier_id NULL`, y conteos/md5 de tablas existentes idénticos antes y después (`courierMigrationsDataSafety.test.js` como modelo).

**Criterios de aceptación**: flag OFF ⇒ ningún número cambia (diff de snapshots vacío); flag ON con datos actuales (todo NULL) ⇒ "desconocido: 8" y neto igual al actual; con una regla de prueba en entorno local ⇒ por pagar = suma de acumulaciones `calculated`; ningún cero fabricado; `npm run test` verde; `EXPLAIN` documentado.
**Rollback**: apagar flag (instantáneo) / revert del front / `DROP FUNCTION`. **Tamaño**: migración ~120 líneas SQL; front ~500 líneas + ~400 de tests; 1 PR, M-L.

### F2 — Bizum / cobros por método

Depende solo de columnas que YA existen en `orders`. Remesas: sin Bizum hasta S5b.

**Migración aditiva `M-D2`**: `admin_dashboard_payments_by_method(p_from timestamptz, p_to timestamptz)` → filas `(payment_method, payment_currency, ops, native_total, usd_total)`:
- Filtro: `status` en `ACTIVE_ORDER_STATUSES` (processing/dispatched/delivered/completed, `dashboardMetrics.js:18`), `payment_status='validated'`, `validated_at ∈ ventana`.
- Zelle: `native_total = usd_total = sum(total_amount)`, moneda 'USD'. Bizum: `native_total = sum(payment_amount)` (EUR), `usd_total = sum(payment_usd_reference)`. Nunca consulta `exchange_rates`.
- `_courier_require_admin()` equivalente (`is_admin_user()`); STABLE; sin datos de cliente.
- Rollback: `DROP FUNCTION`.
- Opcional si EXPLAIN lo exige: índice parcial por `validated_at` (§3.7).

**Front**: `getPaymentsByMethod({from,to})` con `read()`; tarjeta "Cobros por método" (diario/mensual/anual): fila Zelle (USD) y fila Bizum (EUR + "≈ USD congelado" + tasa efectiva media), total global SOLO en USD congelado y rotulado "≈"; si `usd_total` falta ⇒ "—"; estado "Bizum no activo" mientras `bizum_accounts`=0 / sin pedidos. Mantener el desglose histórico viejo bajo flag-off. Nota fija: "Remesas: solo Zelle por ahora".
**Tests**: RPC con fixtures (3 Zelle + 2 Bizum EUR con tasas distintas; verificar `sum(payment_usd_reference)` y que NO se recalcula con tasa viva cambiando `exchange_rates` en el test); mezcla EUR+USD nunca en un mismo total; ventana ET; pedido `pending`/`rejected` excluido; orden Bizum cancelado excluido; DOM con flag off intacto; degradación sin RPC.
**Criterios**: con datos de prod actuales (33 Zelle, 0 Bizum) la tarjeta suma lo mismo que el total de pedidos validados de la ventana (conciliable con `computeOrderTotals`); fila Bizum aparece solo si hay ops. **Rollback**: flag / `DROP FUNCTION`. **Tamaño**: M-D2 ~80 líneas SQL, front ~250 + tests ~250; S-M.

### F3 — Revisiones y señales operativas de Bizum (conciliación limitada)

**Migración**: ninguna obligatoria. `payment_reviews` y `admin_list_orphan_quotes` ya son legibles por admin. (Opcional `M-D3`: `admin_dashboard_payment_review_summary()` si se prefiere no depender de SELECT directo; con 0 filas no se justifica aún — decidirlo al llegar.)
**Front**: tarjeta "Revisiones de pago": pendientes por bandera (`quote_expired`, `quote_rate_moved`), antigüedad del más viejo, contador de cotizaciones huérfanas; enlace al pedido. Sin `bank_reference` ni teléfono. Contador "cuentas Bizum activas".
**Conciliación real** (validado sin referencia, importe recibido ≠ esperado): **diferida a S6** (nadie escribe `decision/received_amount/bank_reference`, `…s5a…sql:31`). Aquí solo se deja la tarjeta lista para consumir esos campos (`expected_amount` vs `received_amount`) cuando existan.
**Tests**: conteos por bandera con filas sintéticas insertadas en el entorno de test; huérfanas; vacío/ausente/error; sin PII en el JSON devuelto.
**Criterios**: con 0 revisiones la tarjeta muestra estado vacío; con filas sintéticas cuenta bien por bandera. **Rollback**: flag / revert. **Tamaño**: front ~150 + tests ~150; S.

### F4 — Salario de mensajero (solo si el dueño lo confirma)

No existe nada en BD (§1.1). Es costo de **período**, no de operación (`plan_courier-management-module.md:227`): línea "Salarios de mensajería" por ventana, restada UNA vez, sin prorrateo; el KPI de neto avisa "incluye / no incluye salarios". Requiere primero la migración M5 del módulo (`courier_salary_plans`, `courier_salary_accruals`; planificada, no escrita) y mensajeros registrados (hoy 0). **Este plan no la diseña en SQL**: F4 queda condicionada a (a) que el cliente confirme usar salarios y (b) que M5 esté aplicada. Entrega mínima cuando aplique: lectura de `courier_salary_accruals` por `period_end` con el mismo `read()` degradable, una línea en la tarjeta de P&L, test de "operación cubierta = costo 0, salario una vez". Hasta entonces la tarjeta de margen debe decir "no incluye salarios" (`plan_courier-management-module.md:195`). **Tamaño**: front ~120 + tests ~150, tras M5.

---

## B0 — Desbloqueo del ajuste de pago Bizum (backlog, prioridad alta)

Diagnóstico verificado el 2026-10-27 por SELECT en producción (solo lectura):
- Moneda EUR activa. Par **USD→EUR activo** con tasa 0.892861 y `effective_date` 2026-10-16 (≈280 h de antigüedad); **EUR→USD** 1.119995 (inverso consistente).
- `_payment_fx_latest()` (`20261016120000_bizum_central_fx_rate.sql`) exige par DIRECTO USD→EUR activo, tasa en banda 0.5–1.5 y edad < `bizum_settings.fx_block_hours` (96 h; aviso desde 24 h), medida por `effective_date` (tocar `updated_at` no la refresca). Con 280 h el estado es `blocked`: `create_bizum_quote` falla con `payment_fx_unavailable` y la tarjeta de Settings muestra bloqueado.
- `bizum_accounts` está vacía: aunque la tasa estuviera al día no habría nada que ofrecer.
- El par USD→CUP está en 136 h (no afecta a Bizum; muestra el mismo patrón de envejecimiento).

Enfoque:
- **(a) Inmediato y operativo — acción del admin/dueño, NO la hacemos nosotros (no se inventan tasas en producción)**: cargar en Settings una tasa USD→EUR vigente con `effective_date` de hoy y crear al menos una cuenta Bizum activa; verificar con `get_payment_fx_status` como admin que pasa a `ok`.
- **(b) Robustez — decisión del dueño**: subir `fx_block_hours` (editable con `set_bizum_settings`; p. ej. 168 h) o aceptar recarga cada < 96 h; derivar USD→EUR del inverso EUR→USD cuando solo exista el inverso; alerta proactiva en Dashboard/Settings cuando el estado sea `warn`/`blocked`, con "edad de la tasa" y enlace a donde cargarla. Actualización automática desde fuente externa solo si el dueño lo pide (Edge Function + cron; YAGNI hoy).
- **(c) UX**: la tarjeta explica la causa exacta (edad de la tasa vs límite; cuenta faltante) y la acción siguiente.
- **(d) Tests**: fixtures de edad de tasa en el borde 24 h / 96 h y de ausencia de cuenta.

**NO verificado**: lo que ve exactamente el usuario en pantalla, y si existe algún otro bloqueo en el front además del estado FX y las cuentas. Relación con este plan: la tarjeta de Dashboard de F2/F3 puede reutilizar el estado FX para mostrar "Bizum bloqueado: tasa de N h" (solo lectura de `get_payment_fx_status`).

---

## 5. Decisiones del dueño (2026-10-27) y preguntas

**El dueño aprobó las 6 recomendaciones tal como figuran abajo (Q1–Q6 = respuesta "Recomendado").** Efecto: el neto de pedidos resta el costo y suma el envío cobrado (bajo flag, con "antes/después"); el costo se fecha por la operación; sin spread de Bizum ahora; sin conciliación antes de S6; costos/márgenes/por pagar solo super_admin (RPC con `is_super_admin()`); F4 (salarios) fuera del alcance actual.

### Preguntas originales y recomendación aprobada

1. **Neto de pedidos**: ¿el neto debe restar el costo del mensajero **y** sumar el envío cobrado al cliente (diferencia = ganancia/pérdida de logística), o solo restar el costo? Hoy el envío no suma ni el costo resta (`dashboardMetrics.js:253-260`). Cambia la fórmula de F1 y los números históricos. **Recomendado: restar el costo y sumar el envío cobrado** (la diferencia de logística es ganancia o pérdida real; solo restar subestima el neto), bajo flag y con "antes / después".
2. **Base de fecha del costo en el neto**: ¿fecha de la operación (validación de pago, como los ingresos — recomendado, mantiene el criterio actual) o fecha de entrega (`delivered_at`)? Decide si el costo de una entrega de fin de mes cae en el mes del ingreso o en el siguiente. **Recomendado: fecha de la operación** (consistente con los ingresos y con lo que ya hace el Dashboard); "por mensajero/por pagar" sigue por fecha de entrega, rotulado.
3. **Spread de Bizum**: el cliente paga EUR con spread (`default_spread_pct` 1,5 %), pero ese spread no queda congelado (solo `effective_rate`). ¿Quieres que el Dashboard muestre un "ingreso por spread"? Habría que congelar tasa media y spread en el sellado (migración sobre lo ya aplicado, otro frente) o no mostrarlo. Mientras tanto el dashboard no lo afirma. **Recomendado: no mostrarlo ahora**; si el dueño lo quiere, hacerlo como trabajo aparte (M de §0) que implica `CREATE OR REPLACE` de `seal_bizum_payment` (función DEFINER viva) partiendo del `prosrc` de PRODUCCIÓN, que difiere del repo solo en 2 líneas de comentarios (lógica idéntica, verificado), y aplica solo a Bizum nuevo.
4. **Conciliación Bizum**: ¿quieres que el Dashboard muestre "validados sin referencia bancaria / importe distinto" aun antes de S6? Requiere construir S6 (RPC que escribe `decision`, `received_amount`, `bank_reference`); si no, F3 queda solo con revisiones pendientes y huérfanas. **Recomendado: no antes de S6**; F3 se queda con revisiones pendientes y huérfanas, y S6 se agenda cuando se active Bizum de verdad (después de B0).
5. **Visibilidad**: ¿el rol `admin` (no super) debe ver costos/márgenes/por pagar de mensajería en el Dashboard? Hoy todo el bloque financiero es solo super_admin en la UI, pero a nivel BD un admin puede leer esas tablas. Si la respuesta es "no", las RPC de neto/margen se endurecen con `is_super_admin()`. **Recomendado: solo super_admin ve costos, márgenes y por pagar en el Dashboard** (igual que hoy en la UI) y las RPC de neto/margen exigen `is_super_admin()`; la gestión operativa de mensajeros sigue visible para admin en Settings.
6. **Salarios (F4)**: ¿se van a usar salarios fijos de mensajero en el corto plazo? Hoy hay 0 mensajeros y 0 tipos de pago configurados; si la respuesta es "no pronto", F4 se descarta del alcance. **Recomendado: descartar F4 del alcance actual** y reabrirlo cuando exista al menos un mensajero registrado que cobre salario.

---

## 6. Qué NO se hace (YAGNI)

- No se crea `payment_ledger` ni se reescribe el Dashboard para leer de un libro (propuesta de `plan_bizum…§3.4`, no existe en prod); los agregados salen de `orders` con una RPC.
- No se modifica `admin_courier_report`, `v_effective_courier_cost`, triggers ni tablas existentes. No se hace backfill ni recálculo desde el Dashboard.
- No hay Bizum en remesas (falta S5b) ni conciliación bancaria (falta S6) ni gráficos de tendencia ni exportes nuevos.
- No se reconstruye un spread EUR ni se convierte nada con tasa viva.
- No hay tabla/flag de servidor para el rollout (flag de cliente + `available=false` de Bizum bastan).
- No se prorratea salario por entrega; no hay alertas por email/WhatsApp ni badge de avatar (decisión previa del módulo, `plan_courier-management-module.md:186`).
- No se agrega el costo de combos (fase 2 del módulo) ni `fixed_plus_percent`.
- No se refactoriza `DashboardPage.jsx` más allá de montar componentes nuevos.

---

## 7. Orden de despliegue (respetando "datos de producción intocables")

1. **Front F1 (flag OFF por defecto)** → PR, review fresca, un solo push. Degrada sin las RPC nuevas (`read()`); con flag OFF el DOM y los números son idénticos a los actuales (test de regresión). Verificar en Vercel preview.
2. **Migración M-D1** (solo funciones; solo lectura): ensayar en rama/BD local con `EXPLAIN` y los tests de BD; aplicar a prod únicamente con un "dale" explícito y separado. Rollback = `DROP FUNCTION`. Antes y después: conteos y md5 de tablas existentes idénticos (baseline: 33 pedidos, 29 remesas).
3. **Activar flag** solo para super_admin, comparar "antes / después" con el dueño durante un período de conciliación; comunicar el cambio de neto y del desglose. Luego decidir ON por defecto.
4. **F2**: front con flag → migración M-D2 (con "dale") → verificar que la suma de Zelle de la tarjeta == total de pedidos validados de la ventana. Bizum permanece apagado en el servidor; la tarjeta muestra "no activo" hasta que se creen cuentas y se encienda `available`.
5. **F3**: solo front (más, opcionalmente, M-D3 con "dale").
6. **F4**: únicamente después de decisión del dueño (Q6) y de que M5 del módulo exista y esté aplicada.
7. Cierre de cada fase: Engram + `codegraph sync` + `TRACKING_PROGRESS.md` (se anexa) + corregir los encabezados "PREPARED, NOT APPLIED" de las migraciones de mensajería (docs, sin tocar SQL aplicado) para que no confundan al próximo agente.

## 8. Lo que NO verifiqué

- La clave exacta de la regla dentro de `rule_snapshot` (usar `rule_id` → `messenger_payment_types.code`).
- Si el sync a `zelle_transaction_history` realmente se omite en pedidos Bizum (documentado en `plan_bizum…§1`, no localizado en el código actual).
- Firma exacta de `admin_list_orphan_quotes()` y de `get_bizum_settings` (dónde vive el interruptor `available`).
- `EXPLAIN` con volumen (prod es diminuta; debe hacerse con datos sintéticos antes de aplicar).
- Render real 320-1280 px de las tarjetas nuevas (pendiente de cada PR).
