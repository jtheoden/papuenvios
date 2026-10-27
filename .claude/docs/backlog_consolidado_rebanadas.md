# Backlog consolidado de PapuEnvios en rebanadas verticales (tablero único verificado)

Fecha: 2026-10-27. Base: `origin/main` `d1c4f46b` (#139). Documento de CONCILIACIÓN: solo lectura de código/git/GitHub y SELECT en prod (sin PII). No implementa, no commitea, no pushea, no aplica migraciones.
Convención de evidencia: **HECHO** lleva commit/PR/SELECT; **SIN VERIFICAR** = no comprobado; **[NV]** = detalle puntual no comprobado. Prod (SELECT 2026-10-27): 33 pedidos, 29 remesas, 0 `bizum_accounts`, 0 `couriers`, 0 `refund_requests`. Regla de oro: datos reales, solo cambios aditivos y reversibles.

## 0. Cómo se usa (modelo híbrido Outcome + Vertical Slice)

1. El **OUTCOME** (una frase medible para el usuario o el negocio) define el porqué y la aceptación; la **REBANADA vertical** (BD aditiva si hace falta + RPC + front + tests TDD + verificación + rollback) es la unidad de entrega.
2. Cada rebanada lleva: Outcome, Requisitos R1..Rn (trazables a observación del cliente, decisión del dueño o hallazgo de seguridad), Meta/indicador y cómo se verifica EN PRODUCCIÓN, Riesgo si NO se hace, y Señal de terminado.
3. "Terminado" = outcome verificado en prod con la consulta/prueba indicada, no código mergeado.
4. Se ejecuta una rebanada por rama desde `origin/main` fresco; TDD (test rojo primero); un solo push tras verificación exhaustiva.
5. Aprobaciones por rebanada: commit / push / PR (por rama), merge, y **aplicar migración = "dale" aparte** (después del deploy del front cuando el front degrade sin la RPC).
6. Quién: **A** = agente, **D** = dueño (acción operativa), **DEC** = decisión pendiente del dueño. Las rebanadas bloqueadas se marcan **BLOQUEADA** y se listan en §6.

## 1. Conciliación de las 12 observaciones del cliente (fuente A)

Evidencia global: PR #56 "Release: observaciones del cliente (PR-00..PR-11)" MERGED 2026-10-14 (squash; cuerpo del PR enumera el contenido) + SELECT `list_migrations` en prod. El bloque `backlog_client-observations_tracking-block.md` dice "nada implementado": está **desactualizado** (anterior al release).

| ID | PR plan | Obs. | Estado verificado | Evidencia |
|---|---|---|---|---|
| A-01 | PR-01 GRANT `redact_pii_jsonb` + `activity_logs` admin-only | #4 | HECHO (BD) / parcial UI | migraciones `20261013130848 pr01_restrict_activity_logs_select_admin` y `…130913 pr01_fix_sec07_redact_fn_grant` en prod; "confirmar en UI que aparezcan logs de remesas" SIN VERIFICAR |
| A-02 | PR-00 carrito cobra `final_price` | #9/#11 | HECHO | #56; `src/lib/cartPricing.js` (`getCatalogProductPrice`), test `CartPage.pricing.test.jsx` |
| A-03 | PR-02 vaciar carrito | #7 | HECHO | #56; `CartPage.clearCart.test.jsx` |
| A-04 | PR-03 moneda del precio base | #1,#8,#10 | **PENDIENTE** | `src/lib/productPricing.js` NO existe en main; el cuerpo de #56 no lo lista; `git log --grep PR-03` vacío |
| A-05 | PR-04 aviso admin por enlace manual | #4 | HECHO | #56 ("PR-04/05"); `NotifyAdminWhatsAppButton.test.jsx` |
| A-06 | PR-05 teléfono destinatario + municipio | #2 | HECHO | #56; `OrderDetailsModal.recipient.test.jsx` |
| A-07 | PR-06a teléfono pagador remesas | #3 | HECHO | #56; migración `20261013152559 add_payer_phone` en prod |
| A-08 | PR-06b teléfono pagador pedidos | #3 | HECHO | #56; `OrderDetailsModal.payerPhone.test.jsx`, `PaymentProofForm.payerPhone.test.jsx` |
| A-09 | PR-07 márgenes globales en BD | #9 | HECHO | #56; `20261013152755 f8_profit_margin_settings`; `SettingsContext.margins.test.jsx` |
| A-10 | PR-08 regla municipio⇒provincia | #12 | HECHO | #56; #126 `ProvinceSelector` (oculta tarifa); `ProvinceSelector.test.jsx` |
| A-11 | PR-09 costo de entrega en remesas | #6 | HECHO | #56; `20261013152818 remittances_delivery_cost` |
| A-12 | PR-10 Zelle visibilidad email/teléfono | #5 | HECHO | #56; `20261013162847 zelle_accounts_visibility_flags`, `src/lib/zelleVisibility.js` |
| A-13 | PR-11 margen por categoría | #11 | HECHO | #56; `ProductContext.categoryMargin.test.jsx` |
| A-14 | F4-C aviso server-side | #4 | CERRADO por decisión D1 (enlace manual) | plan §0 |

Conteo fuente A (14 filas): **HECHO 11 + 1 parcial (A-01 solo falta confirmar UI) / PENDIENTE 1 (A-04) / CERRADO 1**.

Trabajo posterior ya hecho (NO se duplica; mergeado y aplicado): atomic stock (#67), Bizum S0–S5a + FX central (#79–#93), fase 0a/0b/1.5 de seguridad (#84,#94,#104,#108), deshabilitar usuarios (#110), auditoría financiera (#114), comprobantes privados (#117), Edge Functions (#118), CI mínima (#116), ola 4–6 remesas (#122–#124), comisión (#128–#130), cola de devoluciones R4 (#132), mensajería fase 1 (#133), R5 DB (#134), self-dealing (#135), guard de dinero orders (#136), R5 front (#138), fix auth deadlock (#139). PR abiertos sin merge: #63 (advertencia combo, abierta), #2 (codex legado, abierta), #140 (plan dashboard v2, docs).

## 2. Resumen de rebanadas (tablero)

Orden = valor del outcome × riesgo × dependencias. Tamaño: S <150 líneas, M 150–400, L >400.

| # | Rebanada | Outcome (resumen) | Estado | Quién | Tamaño | Riesgo prod | Depende de |
|---|---|---|---|---|---|---|---|
| 1 | RB-01 Cierre de brechas de dinero residuales | Un admin/cliente no puede reasignar dueño ni cambiar método/cuenta/cotización de pago por API | PENDIENTE | A | M | Bajo (triggers aditivos) | — |
| 2 | RB-02 R5 leftovers | La v1 de resolución de reembolsos no se puede llamar; sin huérfanos de storage | PARCIAL | A (+D para "dale") | S–M | Bajo | — |
| 3 | RB-03 Desbloqueo Bizum (B0) | Un cliente puede pagar con Bizum con tasa vigente y cuenta activa | BLOQUEADA por acción del dueño | D + A (UX/alerta) | S (A) | Bajo | D: tasa y cuenta; A: RB-17 |
| 4 | RB-04 UI 320 px + accesibilidad | Se usa todo el sitio a 320 px sin scroll horizontal y con contraste AA | PENDIENTE | A | L (partir en 3 PR) | Bajo | — |
| 5 | RB-05 Dashboard v2 F1 mensajería | El super_admin ve costo real de mensajería, por pagar y margen sin cálculo manual | PLAN aprobado, sin código | A | L | Bajo (flag OFF + funciones) | Operativo: cargar mensajeros/tipos |
| 6 | RB-06 Dashboard v2 F2 cobros por método | El super_admin ve cobros Zelle vs Bizum por ventana, EUR y USD congelado | PLAN | A | M | Bajo | RB-05 (flag/infra), RB-03 para ver datos Bizum |
| 7 | RB-07 Dashboard v2 F3 revisiones | El admin ve revisiones de pago pendientes y cotizaciones huérfanas | PLAN | A | S | Bajo | RB-06 |
| 8 | RB-08 Catálogo CUP/USD (PR-03) | El vendedor carga precios en CUP o USD sin error ni 0.01 USD silencioso | PENDIENTE (parte DEC) | A + D (texto del error #1) | M | Bajo | — |
| 9 | RB-09 Playwright a CI + specs de roles | Los flujos por rol se verifican solos en cada PR | PENDIENTE | A + DEC | M–L | Nulo (no toca prod) | DEC-5 |
| 10 | RB-10 Higiene del repo y worktrees | Repo sin drift de migraciones ni trabajo vivo olvidado | PENDIENTE | A + D | S | Nulo | — |
| 11 | RB-11 AuthContext carreras (seguimiento) | Sin estado de sesión desordenado en cambios rápidos | PENDIENTE | A | S | Bajo | — |
| 12 | RB-12 Tiers de comisión de remesas | Remesas < 50 USD cobran la entrega 0.50 USD según regla del dueño | BLOQUEADA DEC | A tras DEC | M | Medio (dinero) | DEC-1 |
| 13 | RB-13 Mensajería fases 2–3 (M4 combos, M5 salario) | Combos/salarios en costo de mensajería | BLOQUEADA (DEC-2) | A tras DEC | L | Medio | 0 mensajeros hoy |
| 14 | RB-14 Bizum S5b (remesas) y S6 (conciliación) | Remesas por Bizum y conciliación bancaria | BLOQUEADA (RB-03 + activación) | A | L | Medio-alto | RB-03 operativo, DEC-3 |
| 0 | RB-18 Drift de migraciones repo vs prod (prioritaria) | El repo reconstruye la BD de prod sin perder endurecimientos de seguridad | PENDIENTE (equivalencia verificada) | A + D (aprobar PR) | S | Nulo (solo archivos) | — |
| 15 | RB-17 Sistema único de tasa y valor real | Toda pantalla con tasa o valor convertido usa el mismo componente, fuente, estados, redondeo y formato | PENDIENTE | A | M | Bajo (front, sin BD) | — (la usan RB-16 y RB-03) |
| 15 | RB-16 Referencia de tasa en pestaña Zelle | El admin ve en Settings > Pagos > Zelle la tasa USD→CUP vigente, fuente, fecha y edad (solo lectura) | PENDIENTE (parte DEC-9) | A | S | Nulo (solo lectura, sin BD) | RB-17 |
| 16 | RB-15 Tareas del dueño | Secretos rotados, historial decidido, texto legal §9 | D | D | — | Alto si no se hace | — |

Paralelizable sin tocar los mismos archivos: RB-18 (solo migraciones/tests) ∥ RB-01 (solo migraciones + tests de concurrencia) ∥ RB-02 (`refundService`/migración revoke) ∥ RB-04 (CSS/JSX de vistas) ∥ RB-09 (solo `src/tests/e2e`, CI). RB-17 → RB-16 → RB-03 R2/R3 son secuenciales (mismos archivos `settings/` y `numberFormat.js`). RB-05→RB-06→RB-07 son secuenciales (mismo `DashboardPage.jsx`/`dashboardMetrics.js`). RB-08 toca `VendorInventoryTab.jsx` (independiente de las demás). RB-10 y RB-11 son independientes.

## 3. Rebanadas (detalle)

### RB-01 — Cierre de brechas de dinero residuales (self-dealing y columnas de pedidos)

- **Outcome**: Ningún usuario autenticado puede, por API directa (PostgREST), mover una operación a otro dueño ni alterar método de pago, cuenta Zelle/Bizum o cotización de un pedido existente; verificable con una sonda por rol que devuelve 4xx/exception en cada intento.
- **Estado verificado**: PENDIENTE. Evidencia: SELECT en prod del código de las funciones `guard_orders_money_columns`, `guard_orders_owner_update`, `guard_remittance_money_columns`: ninguna menciona `payment_method`, `zelle_account_id`, `bizum_account_id` ni `payment_quote_id` (regexp sobre `prosrc`, 2026-10-27). Triggers vivos en `orders`: `guard_orders_money_columns`, `guard_orders_owner_update`, `trg_orders_admin_self_dealing` (sin trigger específico de `user_id`). El mapeo de qué roles pueden reasignar `user_id` es SIN VERIFICAR [NV: requiere sonda por rol, no ejecutada en esta conciliación].
- **Requisitos**:
  - R1 (hallazgo seguridad, plan self-dealing #135): trigger `BEFORE UPDATE OF user_id` en `orders` y `remittances` que rechace cambio para `authenticated`/`anon` (permite service_role/DEFINER).
  - R2 (hallazgo; guard #136 cubre solo dinero): extender el guard a `payment_method`, `zelle_account_id`, `bizum_account_id`, `payment_quote_id` (inmutables salvo vía RPC definida; en estado no `pending`).
  - R3 (SIN VERIFICAR): INSERT de operación propia con precio arbitrario por un admin (plan `plan_admin-self-dealing-guard.md`, brechas residuales).
  - R4 (SIN VERIFICAR): recalcular remesa con tasa vigente por el dueño (RPC `recalculate` de #122): definir si la ventana es aceptable.
  - R5 (diseño): persistir los intentos bloqueados (hoy la excepción revierte el INSERT del log): usar el patrón de evento fail-open usado en `refund_request_events`.
  - R6 (DEC-6/acción D): segunda cuenta de admin como contrapeso operativo.
- **Meta e indicador / verificación en prod**: sonda (rol anon, cliente, admin) con `PATCH` sobre `user_id` y las 4 columnas → todas rechazadas; `SELECT count(*)` de `orders`/`remittances` y md5 de columnas de dinero idénticos antes y después (baseline 33/29).
- **Riesgo si NO se hace**: un admin comprometido o un cliente malicioso puede redirigir pagos/cuentas Zelle y falsear el método; fraude directo con dinero real.
- **Señal de terminado**: sonda 6/6 rechazada en prod + test de concurrencia verde + registro en `TRACKING_PROGRESS.md`.
- **Dependencias**: ninguna. **Quién**: A. **Tamaño**: M (2 migraciones aditivas + rollback + tests de concurrencia). **Riesgo prod**: bajo; el front actual no escribe esas columnas post-creación [NV: verificar con rg antes]. **Aprobaciones**: commit/push/PR por rama; merge; "dale" por cada migración.

### RB-02 — R5 leftovers (reembolsos)

- **Outcome**: El único camino para resolver un reembolso es la RPC v2 (con comprobante y separación de funciones), y el storage de comprobantes queda sin objetos huérfanos.
- **Estado verificado**: PARCIAL.
  - Hecho: R5 DB #134 y R5 front #138 mergeados; Edge Function `purge-refund-proofs` DESPLEGADA (v1, ACTIVE, `list_edge_functions` 2026-10-27) → el texto "pendiente desplegar" de `TRACKING_PROGRESS.md:367` está desactualizado; `refund_dispute_states` y `my_operation_refund` aplicadas (`list_migrations`).
  - Pendiente: `admin_resolve_refund` (v1) sigue con EXECUTE para `authenticated` (SELECT `has_function_privilege`, 2026-10-27); la guarda ya cierra el bypass (R5-REVIEW), esto es defensa en profundidad.
  - Pendiente: barrido de huérfanos de storage y flujo real de purga con Storage: SIN VERIFICAR (0 `refund_requests` en prod, no hay datos con que probar).
- **Requisitos**: R1 `REVOKE EXECUTE ON FUNCTION admin_resolve_refund(...) FROM authenticated` (migración aditiva con rollback = GRANT); verificar primero con rg que ningún front la llame; R2 RPC/consulta de huérfanos (objetos en `refund-proofs` sin fila `refund_requests.proof_path`), solo reporte, sin borrado automático; R3 prueba E2E de purga con un reembolso sintético en BD local (no en prod).
- **Meta / verificación**: `SELECT has_function_privilege('authenticated','public.admin_resolve_refund(...)','EXECUTE')` = false; consulta de huérfanos devuelve 0 filas.
- **Riesgo si NO se hace**: bajo hoy (guarda activa); si alguien relaja la guarda reaparece el bypass del comprobante; huérfanos = costo y retención indebida de documentos.
- **Señal de terminado**: SELECT de privilegios en prod = false + test de purga en BD local verde.
- **Dependencias**: ninguna. **Quién**: A (+ "dale"). **Tamaño**: S–M. **Riesgo**: bajo. **Aprobaciones**: PR; "dale" para la migración.

### RB-03 — Desbloqueo del pago Bizum (B0)

- **Outcome**: Un cliente puede elegir Bizum en el checkout y obtener una cotización sellada (estado FX `ok`), con al menos una cuenta Bizum activa a la que pagar.
- **Estado verificado**: BLOQUEADA (por acción del dueño). Evidencia SELECT prod 2026-10-27: par USD→EUR (`0f858223…→f6edae3d…`) `effective_date` 2026-10-16 activo (≈11 días > `fx_block_hours` 96 h por doc del plan); `bizum_accounts` = 0; USD→CUP `effective_date` 2026-10-22. Bizum `available=false` por diseño (migración s5a).
- **Requisitos**:
  - R1 (D, operativo): cargar en Settings una tasa USD→EUR vigente con `effective_date` de hoy y crear ≥1 cuenta Bizum (el agente NO inventa tasas).
  - R2 (A, sobre RB-17): la tarjeta de Settings explica la causa exacta (edad de la tasa vs límite; cuenta faltante) y la acción siguiente.
  - R3 (A): alerta proactiva de edad de tasa en `warn`/`blocked` (Dashboard/Settings) con enlace a donde cargarla.
  - R4 (DEC-4): subir `fx_block_hours` (p. ej. 168) o aceptar recarga cada <96 h; derivar USD→EUR del inverso EUR→USD si solo existe el inverso.
  - R5 (A): tests de borde 24 h / 96 h y ausencia de cuenta.
- **Meta / verificación**: como admin, `get_payment_fx_status` devuelve `ok`; `select count(*) from bizum_accounts where active` ≥ 1; prueba manual: crear cotización en el checkout (sin completar pago real).
- **Riesgo si NO se hace**: el método Bizum (EUR) prometido a clientes de España no se puede usar; revenue y UX perdidos; el estado "bloqueado" es silencioso para el cliente.
- **Señal de terminado**: estado FX `ok` + cuenta activa + una cotización de prueba creada por el dueño.
- **Dependencias**: R1 solo del dueño. **Quién**: D (R1) + A (R2–R5). **Tamaño**: S para A. **Riesgo**: bajo (R1 es dato operativo; R2–R5 front). **Aprobaciones**: PR; R4 si cambia `fx_block_hours` es `set_bizum_settings` = acción del dueño.

### RB-04 — UI a 320 px y accesibilidad

- **Outcome**: Todas las vistas públicas, de usuario y de admin se usan a 320 px sin scroll horizontal, con contraste AA (≥4.5:1 texto) y nombres accesibles.
- **Estado verificado**: PENDIENTE (medido en la sesión previa: desborde `/cart` y checkout 128 px, `/user-panel` 55 px, modal pedido con reembolso 19 px, home 12 px; admin "Contactar" sobresale, KPIs de devoluciones recortados; contraste 2.54:1 (secundarios user-panel), 3.30:1 ("Contactar"), 3.76:1 (badge carrito), 2.94:1 ("Ir a Iniciar Sesión"), 4.3–4.4:1 (títulos KPI); botones/enlaces sin nombre accesible; login/user-panel/dashboard sin `h1`). Esas cifras vienen de la sesión previa y se reportan sin reverificar aquí [NV].
- **Requisitos**: R1 sin overflow horizontal a 320 px por vista (CartPage/checkout, UserPanel, OrderDetailsModal, Home, admin); R2 tokens de color con AA (cambiar `text-gray-*` por tokens); R3 `aria-label` en botones solo-icono y enlaces; R4 un `h1` único por página; R5 test de regresión (Playwright a 320 px o `jest-axe`) por vista.
- **Meta / verificación**: Playwright a 320×640 en cada ruta: `document.documentElement.scrollWidth <= 320`; axe sin violaciones `color-contrast`/`button-name`/`link-name`/`page-has-heading-one`.
- **Riesgo si NO se hace**: el público móvil (principal para remesas a Cuba) tiene UX rota; incumple accesibilidad; no toca dinero.
- **Señal de terminado**: reporte axe + medición de overflow en 0 en las rutas listadas, tras deploy en Vercel preview y revisión manual.
- **Dependencias**: ninguna (RB-09 ayuda a automatizar). **Quién**: A. **Tamaño**: L → partir en 3 PR (carrito/checkout, user-panel+modal, admin+contraste global). **Riesgo**: bajo (solo estilos). **Aprobaciones**: PR por parte. Paralelizable con RB-01/RB-02.

### RB-05 — Dashboard v2 F1: mensajería (costo efectivo, por pagar, por mensajero, margen)

- **Outcome**: El super_admin ve en el Dashboard el costo real de mensajería por entrega (devengado vs estimado), la obligación por pagar a mensajeros y el margen del mes, sin cálculo manual.
- **Estado verificado**: PLAN aprobado (6 decisiones del dueño = "Recomendado" el 2026-10-27), sin código. Plan: `plan_dashboard-v2-courier-bizum.md` (en rama `docs/dashboard-v2-plan`, PR #140 abierta, NO en main). Mensajería fase 1 HECHA (#133; migraciones `20261026135340/135536/135615` en prod). Prod: `couriers`=0, tipos de pago 0, 3 acumulaciones con `amount_usd` NULL (según el plan) → hoy todo costo es "desconocido".
- **Requisitos**: R1 (Q1) neto de pedidos resta costo y suma envío cobrado, tras flag y con "antes/después"; R2 (Q2) costo fechado por la operación; R3 (Q5) solo super_admin ve costos/márgenes/por pagar (RPC con `is_super_admin()`); R4 migración aditiva `M-D1` `admin_dashboard_courier_summary(p_from,p_to)` (solo funciones, rollback `DROP FUNCTION`); R5 `courierCostService` devuelve `isEstimated`; R6 corregir `getMarginSummary` para usar mes de `America/New_York` (item 5 de la lista; `courierService.js:124-125` según el plan [NV: línea no re-leída]); R7 flag `papuenvios.dashboardV2` apagado por defecto, solo super_admin; R8 EXPLAIN con datos sintéticos antes de aplicar; R9 estados vacío/no disponible/error (nunca ceros fabricados).
- **Meta / verificación**: con flag ON y datos actuales: "desconocido: 8" y neto igual al actual; con una regla de prueba en entorno local, por pagar = suma de acumulaciones `calculated`. En prod tras "dale": `SELECT admin_dashboard_courier_summary(...)` como super_admin; flag OFF ⇒ diff de snapshots vacío; baseline 33/29 + md5 de tablas intacto.
- **Riesgo si NO se hace**: el neto sobreestima la ganancia de pedidos (hoy ignora costo de mensajería de pedidos); deuda con mensajeros invisible.
- **Señal de terminado**: el dueño valida "antes/después" del neto con un mes real y activa el flag.
- **Dependencias**: valor real exige cargar mensajeros/tipos de pago (acción D operativa); técnicamente independiente. **Quién**: A. **Tamaño**: L (migración ~120 líneas, front ~500, tests ~400): 1 PR. **Riesgo prod**: bajo. **Aprobaciones**: commit/push/PR; merge; "dale" para `M-D1` (después del deploy del front, que degrada sin la RPC).
- **No lograble hoy**: salario (F4/M5) y costo de combos (fase 2): ver RB-13.

### RB-06 — Dashboard v2 F2: cobros por método (Zelle vs Bizum)

- **Outcome**: El super_admin ve cobros validados por método y ventana (Zelle en USD; Bizum en EUR nativo y USD congelado, con tasa efectiva media), conciliable con el total de pedidos validados.
- **Estado verificado**: PLAN, sin código. Prod: 33/33 pedidos Zelle (plan §1.1; SELECT agregado, 2026-10-27), 0 Bizum.
- **Requisitos**: R1 migración `M-D2` `admin_dashboard_payments_by_method(p_from,p_to)`; R2 filtro `payment_status='validated'` y `validated_at` en ventana (cambia el desglose histórico: conservar el viejo bajo flag); R3 nunca convertir con tasa viva; R4 total global solo en USD congelado rotulado "≈"; R5 nota fija "Bizum en remesas: no disponible aún".
- **Meta / verificación**: con datos prod actuales la suma de la tarjeta == `computeOrderTotals` de la ventana; fila Bizum aparece solo si hay operaciones.
- **Riesgo si NO se hace**: al activar Bizum los totales se mezclan EUR/USD y el dueño no distingue ingresos por método.
- **Señal de terminado**: conciliación aritmética con el total de pedidos validados + (tras RB-03) un pedido Bizum de prueba reflejado.
- **Dependencias**: RB-05 (flag e infraestructura); para ver Bizum real, RB-03. **Quién**: A. **Tamaño**: M. **Riesgo**: bajo. **Aprobaciones**: PR; "dale" para `M-D2`.
- **No lograble hoy**: spread EUR (no se congela mid-rate; DEC-3), Bizum en remesas (S5b).

### RB-07 — Dashboard v2 F3: revisiones y señales de Bizum

- **Outcome**: El admin ve revisiones de pago pendientes por bandera, su antigüedad y las cotizaciones huérfanas, sin PII.
- **Estado verificado**: PLAN. `payment_reviews` = 0 filas, `admin_list_orphan_quotes()` existe (firma exacta [NV]).
- **Requisitos**: R1 tarjeta solo front (opcional `M-D3`); R2 sin `bank_reference` ni teléfono; R3 preparada para consumir `expected/received_amount` cuando exista S6.
- **Meta / verificación**: con 0 filas muestra estado vacío; con filas sintéticas (entorno local) cuenta por bandera.
- **Riesgo si NO se hace**: cotizaciones pagadas sin pedido pasan desapercibidas cuando Bizum esté activo.
- **Señal de terminado**: tarjeta visible y exacta con un caso de prueba controlado.
- **Dependencias**: RB-06. **Quién**: A. **Tamaño**: S. **Riesgo**: nulo. **Aprobaciones**: PR.
- **No lograble hoy**: conciliación real (validado sin referencia / importe distinto) → S6 (RB-14).

### RB-08 — Moneda del precio base (PR-03)

- **Outcome**: El vendedor crea y edita productos en CUP o USD, el sistema guarda siempre USD con la tasa vigente, y el error del cliente (#1) deja de ocurrir; ningún precio queda silenciosamente 100× mal.
- **Estado verificado**: PENDIENTE (A-04). Evidencia: `productPricing.js` ausente; plan F1 describe causa raíz (`getConversionRate` devuelve 1 sin tasa → un importe CUP se guarda como USD).
- **Requisitos**: R1 (#8/#10) `normalizeBasePrice` rechaza tasa 1:1 entre monedas distintas o nula; R2 `validateMargin` 0..999.99 (`numeric(5,2)`); R3 selector de moneda convierte el valor; R4 simulador bimoneda; R5 mapear `22003` en `errorHandler.js`; R6 (#1) requiere el texto exacto del error del cliente (**D**); R7 DEC-7: confirmación cuando USD normalizado < 0.10.
- **Meta / verificación**: manual: crear producto en CUP, reabrir, ver USD correcto; `SELECT count(*) FROM products WHERE base_price < 0.01` = 0 tras uso; 20/68 productos con `base_price < 1` son legítimos (plan), no usar ese conteo como alarma.
- **Riesgo si NO se hace**: precios erróneos en el catálogo (dinero real) cuando se edita en CUP; bug #1 sin resolver.
- **Señal de terminado**: el cliente confirma que #1/#8/#10 están resueltos con su caso real.
- **Dependencias**: DEC-7 y texto del error (parcial: R1–R5 pueden avanzar sin ellos). **Quién**: A + D. **Tamaño**: M, sin migración. **Riesgo**: bajo. **Aprobaciones**: PR.

### RB-09 — Playwright a CI y reparación de specs

- **Outcome**: Un PR no se mergea si rompe un flujo por rol (anon/cliente/admin/super_admin), medido por un job de CI en verde.
- **Estado verificado**: PENDIENTE. `main` contiene `playwright.config.js` y solo 2 specs (`smoke.spec.js`, `catalog-no-sensitive-columns.spec.js`); CI (`.github/workflows/ci.yml`) corre `npm run test:coverage`, sin Playwright (rg). Los specs de roles (`auth.setup.js`, `admin-superadmin`, `productos-roles`, `remesas-roles`, `security-anon-access`, `helpers/auth.js`) y la nueva config con proyectos están SIN COMMIT en el checkout principal (git status inicial, solo leídos de ahí). Rama `test/e2e-local-supabase` (worktree `client-observations-backlog`, 11 entradas sin commit: stack local, seed, schema) es trabajo previo relacionado.
- **Requisitos**: R1 commitear specs de roles y config (en rama propia); R2 reparar 4 tests desactualizados: smoke privacy/terms (ahora son enlaces), smoke `h1` (antes del render lazy; esperar al render), `remesas-roles` "Remittance Types edit" espera `data-testid` que solo existe en `RemittanceTypesConfig.jsx` sin commitear (3 líneas de diff en el checkout; llevarlas a la rama), `admin-superadmin` Orders tab (selector móvil oculto); R3 DEC-5 decidir si Playwright entra a CI con stack local (Supabase local + seed) o queda manual; R4 si entra: job separado, no bloqueante al inicio.
- **Meta / verificación**: `npx playwright test` verde localmente y job de CI verde en un PR de prueba.
- **Riesgo si NO se hace**: regresiones de permisos/UX se detectan en producción; los specs de roles siguen sin respaldo en git.
- **Señal de terminado**: 3 PR consecutivos con el job en verde.
- **Dependencias**: DEC-5. **Quién**: A. **Tamaño**: M–L. **Riesgo prod**: nulo (usa stack local; nunca apuntar a prod con credenciales). **Aprobaciones**: PR; el agente no lee archivos de credenciales.

### RB-10 — Higiene de repo, worktrees y documentación

- **Outcome**: No queda trabajo vivo sin respaldo ni drift entre repo y prod; el próximo agente arranca con el estado correcto.
- **Estado verificado**: PENDIENTE. Evidencia:
  - Drift de migraciones: se trata en la rebanada prioritaria RB-18 (cruce completo hecho).
  - Encabezados "PREPARED, NOT APPLIED" desactualizados en migraciones de mensajería y `TRACKING_PROGRESS.md:367` (Edge Function ya desplegada).
  - Worktrees con cambios sin commitear (git status por worktree, 2026-10-27): `client-observations-backlog` 11 (rama `test/e2e-local-supabase`, trabajo vivo de RB-09), `agent-aa102afc6bd7a80c8` 34 (`feat/w6a-delivery-proof-commission`, tip `ef593e94` = parte de #123/#124 ya squash-mergeado), `agent-a8e3ee6c038dc30de` 16 (w6b) y `agent-aa422cce2eff6d4d4` 17 (w6c, locked), `fix-remittances-panel-badge` 9, `fix-step4` 2 (`feat/admin-remittances-tab`, #65 mergeado), `e2e-run` 7, y varios `agent-*` detached con 1. Clasificación abandonado-vs-vivo: SIN VERIFICAR archivo por archivo; w6a/w6b/w6c apuntan a ramas cuyas PR (#124) están MERGED, probable abandono (diff 916+/584- sin commit sobre un tip antiguo = cambios que el squash ya incorporó o descartó) [NV].
  - Rama legal `docs/legal-refund-hold-terms` (worktree anidado, commit `28757ddd`, "PENDIENTE DE REVISION DEL DUEÑO/ABOGADO, NO MERGEAR"), no pusheada (no existe `origin/docs/legal-refund-hold-terms`).
  - Checkout principal sucio: `RemittanceTypesConfig.jsx`, `zelleService.js`, `AuthContext.jsx` y otros con modificaciones sin commit (3 archivos con 39 inserciones, sin clasificar).
  - codegraph: índice en el checkout principal con último commit local 2026-09-09; `codegraph sync` pendiente.
- **Requisitos**: R1 (movido a RB-18); R2 corregir encabezados y TRACKING; R3 por cada worktree sucio: diff contra `origin/main` → archivar patch (`git diff > scratchpad`) o descartar con aprobación del dueño; NO borrar nada sin "dale"; R4 `codegraph sync`; R5 rama legal intacta hasta revisión (nunca push).
- **Meta / verificación**: `git worktree list` sin entradas sucias sin clasificar; `list_migrations` de prod ⊆ `supabase/migrations` de main (diff por nombre = vacío).
- **Riesgo si NO se hace**: un agente futuro re-aplica o pierde migraciones; trabajo vivo se pierde al limpiar; conocimiento obsoleto (Edge Function "sin desplegar").
- **Señal de terminado**: diff de nombres de migración vacío + lista de worktrees clasificada y aprobada por el dueño.
- **Dependencias**: ninguna. **Quién**: A (R1, R2, R4) + D (aprobar descartes). **Tamaño**: S. **Riesgo prod**: nulo (solo archivos). **Aprobaciones**: PR docs/chore; borrado de worktrees = aprobación explícita.

### RB-11 — AuthContext: carreras de `updateUserState` (seguimiento menor)

- **Outcome**: Un cambio rápido de sesión (logout/login, refresh de token) nunca deja el estado del usuario de una llamada anterior.
- **Estado verificado**: PENDIENTE (menor). #139 (fix deadlock `onAuthStateChange`) está MERGED; la carrera de llamadas concurrentes fuera de orden no está resuelta (el checkout principal tiene 25 líneas sin commit en `AuthContext.jsx` y un `AuthContext.test.jsx` sin trackear: probable trabajo en curso, sin clasificar).
- **Requisitos**: R1 secuencia monótona (descartar resultados de llamadas obsoletas); R2 test que reproduce el orden inverso; R3 reconciliar con las 25 líneas del checkout.
- **Meta / verificación**: test rojo→verde; manual: login/logout rápido repetido sin estado cruzado.
- **Riesgo si NO se hace**: bajo; UI muestra el rol equivocado unos segundos (no es una frontera de seguridad: RLS manda).
- **Señal de terminado**: test verde + sin reportes en uso real.
- **Dependencias**: RB-10 (clasificar cambios sucios). **Quién**: A. **Tamaño**: S. **Riesgo**: bajo. **Aprobaciones**: PR.

### RB-12 — Tiers de comisión de remesas (0.50 USD hasta 50 USD)

- **Outcome**: Una remesa menor al umbral cobra automáticamente el cargo de entrega acordado con la regla del dueño, y el margen por remesa es positivo según el Dashboard.
- **Estado verificado**: BLOQUEADA por decisión. Análisis en `plan_remittance-courier-spread-model.md` (dos lecturas de "0.50 USD" y umbral "dudoso"); `TRACKING_PROGRESS.md:372` lo lista como pendiente del dueño; no hay código.
- **Requisitos**: R1 DEC-1 definir lectura (tabla de tramos del cliente: A=0.50 USD bajo el umbral, B=0); R2 tabla de tramos + RPC de cálculo server-side coherente con `calculate`/guard #122; R3 el guard de pricing de remesas debe aceptar el tramo; R4 front muestra el cargo.
- **Meta / verificación**: SELECT sobre remesas nuevas: `delivery_cost` = tramo esperado por monto; margen del Dashboard ≥ 0.
- **Riesgo si NO se hace**: hoy el cliente paga ~0.50 USD y la mensajera cobra ~200 CUP; el margen en envíos pequeños no está gobernado por regla (puede ser pérdida).
- **Señal de terminado**: 3 remesas reales con el tramo correcto, validadas por el dueño.
- **Dependencias**: DEC-1; idealmente RB-05 para medir. **Quién**: A tras DEC. **Tamaño**: M. **Riesgo prod**: medio (dinero). **Aprobaciones**: PR; "dale" de migración.

### RB-13 — Mensajería fases 2–3 (combos M4, salario M5)

- **Outcome**: El costo de mensajería refleja combos y salarios por período sin doble conteo.
- **Estado verificado**: BLOQUEADA. `courier_salary_*` no existen en prod (plan dashboard §1.1); 0 mensajeros; M4/M5 solo planificadas (`plan_courier-management-module.md` §7, filas M4/M5).
- **Requisitos**: R1 DEC-2 ("¿salarios en el corto plazo?" recomendado: descartar F4); R2 al menos un mensajero real registrado; R3 migración M5 con rollback.
- **Meta / verificación**: línea "Salarios de mensajería" restada UNA vez por ventana.
- **Riesgo si NO se hace**: bajo mientras haya 0 mensajeros; crece al contratar.
- **Señal de terminado**: reabrir solo si DEC-2 cambia.
- **Dependencias**: DEC-2, RB-05. **Quién**: A tras DEC. **Tamaño**: L. **Riesgo**: medio. **Aprobaciones**: PR; "dale".

### RB-14 — Bizum S5b (remesas) y S6 (conciliación)

- **Outcome**: Remesas pagables por Bizum con cotización sellada, y el admin concilia cada pago Bizum (referencia bancaria, importe recibido, decisión).
- **Estado verificado**: BLOQUEADA. `remittances` solo tiene `payment_method` (information_schema, plan §0); `payment_reviews` = 0 y ninguna RPC escribe `decision/received_amount/bank_reference` (comentario de s5a línea 31, según el plan); S5a (pedidos) HECHO #88.
- **Requisitos**: R1 S5b: columnas `payment_*` en remesas + CHECKs `NOT VALID`→`VALIDATE` + trigger de sellado + RPC de creación server-side; R2 S6: RPC admin de validar/rechazar con unicidad de referencia; R3 congelar mid-rate y spread si DEC-3 lo pide.
- **Meta / verificación**: una remesa Bizum de prueba sellada con tasa congelada; conciliación registra `received_amount` y referencia.
- **Riesgo si NO se hace**: Bizum solo cubre pedidos; sin S6 no hay control de pagos tardíos o de importe distinto una vez activo.
- **Señal de terminado**: caso Bizum E2E conciliado en prod con el dueño.
- **Dependencias**: RB-03 (activación operativa), DEC-3. **Quién**: A. **Tamaño**: L por slice. **Riesgo**: medio-alto (dinero, migración sobre tabla viva con 29 filas). **Aprobaciones**: PR; "dale" por migración; revisión adversarial fresca antes de aplicar.

### RB-16 — Referencia de tasa vigente en la pestaña Zelle (Settings > Pagos)

- **Outcome**: El admin que abre Settings > Pagos > Zelle ve, sin salir de la pestaña, la tasa de referencia vigente (hipótesis: USD→CUP) con fuente, fecha de vigencia y edad, igual que la pestaña Bizum muestra la suya; no tiene que ir a Settings > Financiero a consultarla.
- **Estado verificado**: PENDIENTE. Pedido del dueño 2026-10-27. Evidencia: `PaymentFxRateCard` y `PaymentFxBadge` (PR #90) solo se importan en `SettingsBizumSection.jsx:21-22,59-61` (rg sobre `origin/main`); `SettingsZelleTab.jsx` (733 líneas) no tiene referencia de tasa. SELECT prod 2026-10-27: USD→CUP activo con `effective_date` 2026-10-22 (~136 h); USD→EUR 2026-10-16.
- **Hallazgo de diseño**: `PaymentFxRateCard` está acoplada a Bizum: lee `get_payment_fx_status` (RPC fija USD→EUR, con `mid_rate`, `spread_pct`, `fx_warn_hours`, `fx_block_hours` y estados `ok/warn/blocked`; la RPC concede EXECUTE solo a `authenticated`). Esa RPC NO sirve para USD→CUP. Para USD→CUP alcanza el servicio existente que ya lee `exchange_rates` activas desde el front (`currencyService.js` consulta `exchange_rates` con `is_active`; el admin ya puede leerla): NO hace falta RPC ni migración. [NV: confirmar que la política RLS de SELECT sobre `exchange_rates` cubre al admin con el rol real; la lectura del front existente indica que sí.]
- **Requisitos**:
  - R1 (pedido del dueño): la pestaña Zelle muestra la referencia, solo lectura, sin campo para escribir tasa (la única fuente es Settings > Financiero, como en Bizum).
  - R2: generalizar `PaymentFxRateCard` (props: par, etiquetas y bloque opcional de mid/spread/umbrales) en vez de duplicarla; Bizum debe conservar su render byte a byte (test de regresión `PaymentFxBadge.test.jsx`/`SettingsBizumSection.test.jsx`).
  - R3: función de servicio `getActiveRate(fromCode, toCode)` que devuelve `{rate, effective_date, updated_at}` o `null` (fallo cerrado: sin tasa activa se muestra "sin tasa", nunca 0).
  - R4: la edad es solo informativa (calculada con `effective_date`; sin umbrales) y el estado antiguo NO bloquea ni deshabilita Zelle: ningún guard de `guard_payment_method_enabled` ni del front debe depender de este widget.
  - R5: i18n ES/EN (claves nuevas bajo `settings.fxRate.zelle.*`, paridad de namespace) y 320 px sin overflow (usar el grid `grid-cols-1` en móvil).
  - R6: reutilizar el enlace "ir a Financiero" (`onGoToFinancial`) ya existente.
  - R7 (TDD): tests de render con tasa, sin tasa, error de carga con reintento, y de que el bloqueo por edad no deshabilita nada en Zelle.
- **Meta / verificación**: tras deploy, como admin en Settings > Pagos > Zelle se ve la tasa USD→CUP igual al `SELECT rate, effective_date FROM exchange_rates WHERE is_active AND from=USD AND to=CUP` (830 y 2026-10-22 hoy); a 320 px `scrollWidth <= 320`; cambiar la tasa en Financiero y recargar la pestaña refleja el nuevo valor; Bizum sigue idéntico.
- **Riesgo si NO se hace**: bajo (UX): el admin decide límites/cuentas Zelle sin ver la tasa y puede operar con una referencia vencida sin notarlo (hoy 136 h). No toca dinero.
- **Señal de terminado**: el dueño ve la tasa en la pestaña Zelle en prod y confirma que es la referencia que esperaba.
- **Dependencias**: RB-17 (usa su servicio `getActiveRate`, el componente generalizado y el helper de formato: esta rebanada no crea copias); DEC-9 (qué tasa mostrar; no bloquea el diseño, solo el contenido). Ejecutar RB-17 primero y luego RB-16 y RB-03 R2 en ese orden (mismos archivos de `settings/`). **Quién**: A. **Tamaño**: S (~150 líneas front + tests; sin migración). **Riesgo prod**: nulo (solo lectura, sin BD). **Aprobaciones**: commit/push/PR por rama; merge; no requiere "dale" de migración.

### RB-17 — Sistema único de tasa y valor real (criterio transversal del dueño, 2026-10-27)

- **Outcome**: Cualquier pantalla que muestre una tasa de cambio o un valor convertido (Settings Zelle/Bizum/Financiero, Dashboard, carrito/checkout, remesas, B0) usa el mismo componente, la misma fuente de datos, los mismos estados (ok / aviso / vencida / no disponible), las mismas reglas de redondeo y el mismo formato ES/EN; cambiar una regla se hace en un solo lugar. Criterios del dueño: DRY y KISS, máxima usabilidad, coherencia visual e impacto visual cuidado.
- **Estado verificado**: PENDIENTE. Inventario (rg sobre `origin/main`, excluye `src/tests`; 2026-10-27):
  - **Lectura de tasas**: 8 archivos tocan `exchange_rates` (26 apariciones): `currencyService.js`, `remittanceService.js`, `paymentFxService.js`, `VendorPage.jsx:63`, `SettingsPage.jsx:181`, `SettingsPageFinancial.jsx:361`, `SendRemittancePage.jsx:348` y `PaymentFxRateCard.jsx` (solo comentario). Hay accesos directos con `supabase.from('exchange_rates')` en componentes de UI (VendorPage, SettingsPage, SettingsPageFinancial) además de los servicios: fuente duplicada. La conversión pasa por `CurrencyContext` (`getConversionRate`/`convertAmount`, 8 archivos, 58 usos) con caché con TTL y fallo cerrado (#87/#89); Bizum usa otra vía (RPC `get_payment_fx_status`, 2 archivos).
  - **Estados de vigencia**: solo existen para USD→EUR y los calcula el servidor (`ok/warn/blocked/none` + `fx_warn_hours/fx_block_hours`); para USD→CUP y demás pares no hay estado ni edad en ninguna pantalla (USD→CUP lleva ~136 h sin refresco).
  - **Componentes**: `PaymentFxRateCard` y `PaymentFxBadge` se usan solo en `SettingsBizumSection.jsx`; la tarjeta está acoplada a Bizum (campos `mid_rate`, `spread_pct`, umbrales).
  - **Redondeo**: existe la fuente canónica `src/lib/moneyPure.js` (`roundMoney`, `roundTo`), usada por `priceCalculationService.js` y `commissionOverrideRules.js`, pero `.toFixed(` aparece 209 veces en 36 archivos (UserPanel 24, CartPage 22, VendorInventoryTab 18, SendRemittancePage 18, VendorCombosTab 17, whatsappService 12, RemittanceTypesConfig 12, ProductsPage 12): redondeo y formato mezclados (`toFixed` y `roundMoney` pueden diferir en casos de borde de punto flotante) [NV: no se evaluó caso por caso cuáles producen diferencias].
  - **Formato**: implementaciones de moneda en paralelo: `CurrencyContext.formatCurrency` (`toFixed`, sin separadores ni localización), `priceCalculationService.formatPrice/formatPriceWithCode` (`toFixed`), `Intl.NumberFormat` directo en 7 componentes (3 con `'en-US'` fijo: `SettingsZelleTab.jsx:101`, `AdminOrdersTab.jsx:641`, `ZellePaymentHistoryTab.jsx:19`; 4 con `es-US`/`en-US` según idioma: `RefundsAlertCard`, `AdminRefundsInbox`, `MyOperationRefund`, `OperationRefundSection`), helpers locales `formatCup/formatUsd` en `courierUi.jsx:66-67`, `toLocaleString('en-US')` fijo en `AdminRemittancesTab.jsx:962`, y la utilidad correcta `numberFormat.js` (`formatNumber` con `localeFor(language)`, `formatDateTime`) usada solo por las tarjetas FX. Resultado: el mismo importe se ve distinto según pantalla e idioma.
  - Dashboard: `dashboardMetrics.js` calcula en USD; el servicio de costo asume USD (atajo documentado en `DashboardPage.jsx`, plan dashboard v2 §1.2).
- **Propuesta mínima (sin reescrituras ni capas nuevas)**:
  1. **Un servicio de lectura**: `getActiveRate(fromCode, toCode)` en `currencyService.js` (devuelve `{rate, effective_date, updated_at, ageHours}` o `null`); las lecturas directas de UI pasan a usarlo. Para USD→EUR se sigue consumiendo `get_payment_fx_status` (sus umbrales son del servidor).
  2. **Un componente**: generalizar `PaymentFxRateCard`/`PaymentFxBadge` (props: `pair`, `status`, `showSpread`, `thresholds` opcionales, `onGoToFinancial`) con los 4 estados canónicos (ok / aviso / vencida / no disponible), en vez de crear otro. Bizum debe renderizar idéntico (tests existentes `PaymentFxBadge`, `SettingsBizumSection`, `FxReferenceCard`).
  3. **Un helper de formato**: `formatMoney(value, {currency, language})` y `formatRate(value, language)` en `numberFormat.js` (sobre `Intl.NumberFormat` con `localeFor(language)`), redondeando solo con `moneyPure.roundMoney`; sustituir por etapas (solo pantallas tocadas por RB-03/RB-16/RB-05..07; el resto, oportunistamente, sin barrido masivo).
  4. **Regla de edad**: un helper `rateAgeState(effective_date, {warnHours, blockHours})`; para USD→EUR usa los valores de `bizum_settings`; para USD→CUP/Zelle es solo informativo (nunca bloquea).
- **Requisitos**:
  - R1 (criterio dueño) un solo componente de tasa, una sola fuente, un solo formato.
  - R2 eliminar `Intl`/`toFixed` fijos `'en-US'` en las pantallas tocadas (el idioma manda).
  - R3 estados con TEXTO + icono, no solo color.
  - R4 contraste AA con tokens existentes de Tailwind (los `STATE_STYLES` actuales usan `-900` sobre `-50`).
  - R5 foco visible y `role="status"`/`role="alert"` donde ya existe.
  - R6 320 px (`grid-cols-1` en móvil, sin overflow).
  - R7 mensajes que digan la CAUSA y la ACCIÓN (p. ej. "Tasa de hace 136 h; cárgala en Financiero").
  - R8 sin sistema paralelo: Tailwind + Radix + tokens actuales, sin librerías nuevas.
  - R9 TDD: tests que fijan el render actual de Bizum y tests nuevos de `getActiveRate`, `formatMoney`, `rateAgeState` (bordes 24 h / 96 h).
- **Meta / verificación**: (a) `rg "from\('exchange_rates'\)" src --glob '!src/tests/**'` queda solo en servicios y en el guardado de Financiero; (b) las pantallas tocadas no contienen `Intl.NumberFormat('en-US'` ni `toFixed(` para mostrar dinero; (c) revisión visual ES y EN a 320 y 1280 px: el mismo importe (p. ej. 1234.5 USD) se ve idéntico en Settings, Dashboard y carrito; (d) axe sin violaciones en la tarjeta.
- **Riesgo si NO se hace**: cada rebanada nueva (RB-16, RB-03, RB-05..07) agrega otra copia del formato y de la regla de vigencia; riesgo de mostrar importes distintos del cobrado (dinero real) y criterios de edad divergentes.
- **Señal de terminado**: RB-16 y RB-03 R2 se entregan reutilizando componente y servicio (cero copias nuevas) y el dueño valida que Zelle y Bizum se ven coherentes.
- **Dependencias**: ninguna; va ANTES de RB-16 y RB-03 R2/R3. **Quién**: A. **Tamaño**: M (~250 líneas + tests; sin migración ni RPC). **Riesgo prod**: bajo (front; el render de Bizum queda fijado por tests). **Aprobaciones**: PR por rama; merge. Alcance acotado (KISS): sin barrido de los 209 `toFixed`.

### RB-18 — Drift de migraciones repo vs prod (higiene prioritaria)

- **Outcome**: Reconstruir la BD desde `main` produce los mismos endurecimientos de seguridad que prod; hoy 6 migraciones aplicadas en prod no existen en `main`.
- **Estado verificado**: PENDIENTE. Cruce completo NOMBRE a NOMBRE (137 nombres únicos de `list_migrations` de prod vs 128 archivos de `supabase/migrations` en `origin/main`; 2026-10-27):
  - **Aplicadas en prod SIN archivo en main (6, las únicas)**: `sec10_zelle_usage_role_check`, `sec11_is_enabled_checks`, `sec12_bank_account_functions_role_check`, `sec10_12_revoke_public_grant`, `warnings_offers_zelle_offerusage_testimonials`, `warn37_inventory_movements_insert` (versiones prod 20260910172352…225344). Los archivos existen SIN TRACKEAR en el checkout principal con prefijos `20260910130000…140100`.
  - **Diferencias solo de nombre (mapeadas, NO son drift)**: `pr01_restrict_activity_logs_select_admin` y `pr01_fix_sec07_redact_fn_grant` (en repo sin el prefijo `pr01_`); `payment_methods_toggle_a/b/c` (en repo un solo archivo `payment_methods_toggle`); 7 entradas `*.rollback` de 2025 en prod (rollbacks registrados como migración; el repo conserva el original sin sufijo). No hay archivos en main sin su equivalente aplicado en prod.
  - **Equivalencia de contenido contra prod** (SELECT de `prosrc` normalizado sin espacios/mayúsculas y de `pg_policies`): 6 de 7 funciones tienen md5 IDÉNTICO entre archivo y prod (`update_zelle_account_usage`, `is_super_admin`, `get_recipient_bank_account_full`, `get_daily_operational_cost`, `refresh_user_category`, `get_testimonial_author_profiles`). Difiere `get_remittance_bank_accounts_admin` (774 vs 848 caracteres): prod tiene la versión posterior de `20261016140000_fix_rate_functions_and_exchange_rates_constraints.sql`, que SÍ está en main (sec12 queda superada; orden correcto). Policies en prod: `offers_select_public_active`, `offers_select_authenticated`, `zth_select_admin`, `zth_insert_pending_only`, `osh_insert_owner_or_admin`, `offer_usage_insert_own` y las de remesas de admin con `is_admin_user() OR is_super_admin()`; las antiguas fueron eliminadas. `inventory_movements_insert_own_order` (warn37) ya no existe en prod porque `drop_movements_insert_policy` (en main) la elimina: consistente. [NV: ACL y `search_path` de `get_testimonial_author_profiles` no se compararon línea a línea con el archivo.]
- **Requisitos**:
  - R1 llevar los 6 archivos a `main` renombrados con el timestamp de versión de prod, SIN aplicar.
  - R2 test de contenido (harness de `src/tests/concurrency/`) que reconstruya desde cero y compare las 7 funciones con los md5 de prod.
  - R3 corregir en el mismo PR los encabezados "PREPARED, NOT APPLIED" obsoletos y la línea 367 de `TRACKING_PROGRESS.md` (la Edge Function `purge-refund-proofs` ya está desplegada, v1).
  - R4 no ejecutar nada contra prod.
- **Meta / verificación**: el cruce por nombre prod vs repo queda vacío salvo los mapeos documentados; el harness reconstruye la BD y las 7 funciones coinciden con prod.
- **Riesgo si NO se hace**: reconstruir la BD (staging, restauración, branch de Supabase) desde `main` pierde la verificación de rol en funciones de Zelle y de cuentas bancarias y las policies endurecidas: exposición de datos bancarios con dinero real.
- **Señal de terminado**: PR mergeado con aprobación del dueño y cruce por nombre vacío.
- **Dependencias**: ninguna. **Quién**: A (PR) + D (aprobar). **Tamaño**: S (6 archivos ya escritos + test). **Riesgo prod**: nulo. **Aprobaciones**: commit/push/PR; merge. No requiere "dale" de migración (ya aplicadas).

### RB-15 — Tareas del dueño (no del agente)

- **Outcome**: Sin secretos vivos en el historial, texto legal vigente y la web probada de punta a punta por una persona.
- **Estado verificado**: PENDIENTES (`TRACKING_PROGRESS.md:372`; plan `plan_remove-leaked-secrets.md`).
- **Requisitos**: D1 rotar `service_role` key; D2 revocar el PAT que quedó en el historial; D3 decidir si purgar el historial (`git filter-repo` + force-push: exige autorización explícita); D4 prueba manual E2E en navegador (320–1280 px de UIs nuevas); D5 revisar y aprobar el texto legal §9 de reembolsos (rama `docs/legal-refund-hold-terms`; no pushear hasta entonces); D6 cargar tasa USD→EUR y cuenta Bizum (RB-03); D7 cargar mensajeros y tipos de pago (RB-05).
- **Meta / verificación**: D1/D2: la clave anterior devuelve 401; `rg` del historial no encuentra secretos activos; D5: texto aprobado → merge a `main`.
- **Riesgo si NO se hace**: una clave `service_role` filtrada da acceso total a BD con datos reales (CRÍTICO); texto legal de retención sin respaldo.
- **Señal de terminado**: confirmación escrita del dueño por ítem.
- **Quién**: D. **Aprobaciones**: n/a.

## 4. Ruta recomendada (valor × riesgo × dependencias)

0. **Ya mismo, en paralelo** (no depende del código): RB-15 D1/D2 (clave filtrada) y RB-03 R1 (cargar tasa + cuenta Bizum).
1. **Ola A (seguridad de dinero e higiene, paralelas entre sí)**: RB-18 (drift de migraciones, primera por riesgo de reconstrucción) ∥ RB-01 ∥ RB-02 ∥ RB-10.
2. **Ola B (valor visible, UX)**: RB-04 (3 PR, paralelo a la ola A) ; RB-08 (PR-03) en paralelo; RB-17 (sistema único de tasa, M) y luego, sobre él, RB-16 (tasa en Zelle, S) y RB-03 R2/R3 (UX y alerta de edad de Bizum); RB-11.
3. **Ola C (Dashboard, secuencial)**: RB-05 → RB-06 → RB-07 (con RB-03 resuelto para ver Bizum real).
4. **Ola D (calidad)**: RB-09 (tras DEC-5).
5. **Ola E (bloqueadas)**: RB-12 (DEC-1), RB-13 (DEC-2), RB-14 (RB-03 + DEC-3).

## 5. Outcomes que HOY no se pueden lograr (y por qué)

| Outcome | Bloqueo |
|---|---|
| Pagar con Bizum en el checkout | Acción del dueño: tasa USD→EUR vencida (≈11 días, límite 96 h) y 0 cuentas Bizum (RB-03) |
| Bizum en remesas | Slice S5b no existe (RB-14) |
| Conciliación bancaria Bizum | Slice S6 no existe (RB-14) |
| Ingreso por spread EUR | Sellado no congela mid-rate/spread; DEC-3 |
| Salario de mensajero en el Dashboard | M5 no escrita, 0 mensajeros; DEC-2 (RB-13) |
| Costo real de mensajería ≠ "desconocido" | Acción del dueño: 0 mensajeros y 0 tipos de pago (RB-05 D7) |
| Tiers de comisión < 50 USD | DEC-1 sin respuesta (RB-12) |
| Resolver #1 (error de precio) | Falta el texto exacto del error del cliente (RB-08 R6) |

## 6. Decisiones del dueño (8 mayores + 1 menor, DEC-9) con default recomendado

| ID | Decisión | Default recomendado | Bloquea |
|---|---|---|---|
| DEC-1 | Lectura de "0.50 USD hasta 50 USD" (tabla de tramos: A=0.50, B=0) y umbral | Tramos A/B del plan `plan_remittance-courier-spread-model.md` con 50 USD | RB-12 |
| DEC-2 | ¿Salarios fijos de mensajero a corto plazo? | No; descartar F4/M5 hasta tener un mensajero con salario | RB-13 |
| DEC-3 | ¿Mostrar ingreso por spread EUR (congelar mid-rate y spread)? | No ahora; reabrir con S6 | RB-06 (parcial), RB-14 |
| DEC-4 | `fx_block_hours` de Bizum (96 h) y derivar USD→EUR del inverso | 168 h y derivar del inverso solo si falta el directo | RB-03 R4 |
| DEC-5 | ¿Playwright entra a CI con stack local? | Sí, job separado y no bloqueante las primeras 3 semanas | RB-09 |
| DEC-6 | Segunda cuenta de admin como contrapeso a self-dealing | Sí, cuenta separada para validar operaciones del admin principal | RB-01 R6 |
| DEC-7 | Umbral de confirmación de precio normalizado (<0.10 USD) | 0.10 USD (confirmación, no bloqueo) | RB-08 R7 |
| DEC-9 | Qué tasa(s) mostrar en la pestaña Zelle (USD→CUP, USD→EUR o ambas) | Solo USD→CUP (Zelle cobra en USD y la remesa se paga en CUP); USD→EUR queda en la pestaña Bizum | RB-16 (contenido) |
| DEC-8 | Purga del historial git (`filter-repo` + force-push) tras rotar claves | Rotar primero; purgar solo si el repo se comparte o el PAT tenía alcance amplio | RB-15 D3 |

## 7. Qué NO se verificó en esta conciliación

- Estado exacto por archivo de cada worktree sucio (clasificación vivo/abandonado).
- Sonda por rol de `user_id` y de las 4 columnas de `orders` por PostgREST (solo se verificó que el código de los guards no las menciona).
- Brechas R3/R4 de RB-01 (INSERT con precio arbitrario del admin; recalculado con tasa vigente).
- Mediciones de overflow y contraste de RB-04 (cifras de la sesión previa).
- Línea exacta de `getMarginSummary` y firma de `admin_list_orphan_quotes`.
- Confirmación en UI de los logs de remesas de PR-01 (A-01).

## 9. Decisiones del dueño registradas (2026-10-27)

| Decisión | Resolución | Efecto |
|---|---|---|
| Q1–Q6 del plan del dashboard v2 | Aprobadas las 6 recomendaciones (ver `plan_dashboard-v2-courier-bizum.md` §5) | RB-05/06/07 desbloqueadas; salario (F4) fuera de alcance |
| DEC-2 salarios de mensajero | Descartar por ahora (Q6) | RB-13 M5 sigue bloqueada |
| DEC-3 spread EUR | No mostrarlo (Q3) | Sin cambio a `seal_bizum_payment` |
| DEC-4 `fx_block_hours` Bizum | **168 h** (aviso desde 24 h). Se cambia desde Settings > Pagos > Bizum con sesión de admin (`set_bizum_settings`); no se toca producción desde el agente | RB-03 R4; aun así hay que cargar una tasa USD→EUR vigente (la actual tiene ~11 días) y crear una cuenta Bizum |
| DEC-1 regla 0.50 USD hasta 50 USD | **A: tabla de tramos del cliente**, editable, cálculo en servidor, cargo mostrado antes de pagar | RB-12 desbloqueada (migración aditiva con su "dale") |
| Criterio transversal | Outcome-Driven + vertical slices; DRY/KISS, usabilidad, coherencia e impacto visual en todo lo de tasas y valores reales | RB-17 |
| Nota del dueño | El super_admin es quien carga la tasa EUR de Bizum (manual, como las demás tasas); sin automatización | Referencia en Zelle (RB-16) muestra la tasa cargada con fecha y edad |

**DEC-10 (nueva, abierta):** la política `exchange_rates_manage` exige `is_admin_user()`, o sea cualquier admin puede insertar/actualizar/borrar tasas, no solo el super_admin. Pendiente decidir si se restringe a `is_super_admin()` en la base de datos (cambio de comportamiento sobre un flujo vivo; verificar antes quién carga tasas hoy con `financial_audit_log.changed_by_role`). Sin verificar si el front ya restringe esa pantalla.
