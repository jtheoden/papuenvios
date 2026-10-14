# Plan estratégico final — Observaciones del cliente "To Build Better Web" → Backlog PapuEnvios

Repositorio: `/home/juan/Workspace/papuenvios` · Rama actual: `feat/admin-bulk-ops-reset-audit` (cambios sin commitear) · Fecha: 2026-10-12
Documento de planificación. No se modificó ningún archivo de código ni la base de datos remota; las sondas SQL fueron `SELECT` de solo lectura sobre el proyecto `qcwnlbpultscerwdnzbm`.

**Convención de evidencia (obligatoria para quien ejecute este plan).** Cada cita `archivo:línea` está en uno de dos estados:
- **VERIFICADA**: leída con herramienta durante la planificación o durante el cross-check final (lo dice el texto).
- **HIPÓTESIS / "borrador, no releído"**: la reportó un agente de investigación y no fue releída. Antes de editar cualquier archivo citado así, se debe confirmar con `codegraph explore` o lectura directa. Una cita no verificada nunca justifica un cambio por sí sola.

**Cross-check final (advisor + verificación propia, 2026-10-12)** modificó este documento en tres puntos: (1) se corrigió la explicación de la asimetría pedidos/remesas en la observación #4; (2) PR-00 pasó de "no reverificado" a **confirmado como ruta de dinero real**; (3) se explicitó la convención de evidencia anterior.

---

## 0. Decisiones del usuario (2026-10-13)

Resuelven las 8 decisiones bloqueantes de §5. Detalle y consecuencias por PR en `master-prompt-client-observations-backlog.md` §3.

| Decisión | Resolución |
|---|---|
| D1 Aviso server-side (F4-C) | Se queda el **enlace manual** de WhatsApp. F4-C cerrado. PR-04 es la solución definitiva |
| D2 Costo de entrega (F6-B) | **Se suma** a lo que paga el remitente |
| D3 Regla #12 (F6-A) | **Interpretación B** |
| D4 % global de ganancia | **No re-precia** lo existente |
| D5 Precio en carrito | Cobra **`final_price`** del catálogo |
| D6 Orden vs Corte 3 | **F3 ahora**. Verificado: el RPC `create_order` no existe (Corte 3 es solo diseño). Traspaso: el futuro RPC debe aceptar `p_payer_phone` |
| D7 Zelle | **Opción D (datos)** con `show_email` y `show_phone` **independientes** por cuenta; salvaguarda "al menos uno visible" |
| D8 Punto de rama | **Cada PR desde `origin/main` fresco**. La rama `feat/admin-bulk-ops-reset-audit` ya fue fusionada (PR #53) |

Siguen abiertos solo: el texto exacto del error de la observación 1 (afecta a PR-03) y los detalles menores de copy anotados por PR. Cada `supabase db push` mantiene su "dale" propio.

---

## 1. Resumen ejecutivo y orden de ejecución

### 1.1 Resumen

- Las 12 observaciones se cubren con 8 frentes (F1–F8). Ninguna se rechaza. 7 frentes son "implementar con cambios", 1 (F7) es "implementar" literal, y 2 sub-slices (F4-C canal server-side, F5 modalidad de control) requieren decisión del usuario antes de implementarse.
- La revisión adversarial añadió **dos bugs de dinero confirmados que el borrador no tenía**:
  - **PR-00 (nuevo, bloqueante para F1/F8)**: el carrito ignora el precio por producto. `ProductsPage.jsx:188` llama `addToCart(product)` con el producto crudo (sin `displayed_price`), `CartContext.jsx:37-46` lo guarda tal cual, y `CartPage.jsx:109-113` cae en la rama legacy `base_price * (1 + financialSettings.productProfit || 40)`. El catálogo muestra `final_price` (`ProductsPage.jsx:285,305,446`). Catálogo y carrito cobran precios distintos **hoy**.
  - **F6-A reforzado**: `CartPage.jsx:277-283` convierte cualquier error de `calculateShippingCost` en `setShippingCost(0)`. Lanzar un error desde el servicio no cambia nada: el pedido se crearía con envío gratis.
- Bug de registro confirmado en BD viva: `has_function_privilege('authenticated','public.redact_pii_jsonb(jsonb)','EXECUTE') = false`; desde SEC-07 (2026-08-09) solo sobreviven inserts en `activity_logs` hechos vía RPC `SECURITY DEFINER` (6 filas, todas `product/product_deleted`). **Corrección del cross-check**: este bug rompe el registro de TODO insert directo de `authenticated`, incluidos los pedidos (`orderService.logOrderActivity` y `remittanceService.logRemittancePaymentActivity` pasan ambos por `activityLogger.logActivity`, que inserta directo en `activity_logs`). Por lo tanto **no explica por sí solo** la asimetría "productos sí, remesas no" que percibe el cliente. Lo más probable (hipótesis): el "sí" de productos/pedidos que ve el cliente es el aviso por WhatsApp del carrito (`CartPage`), no el registro. Verificado además que `logActivity` y ambos wrappers **nunca lanzan**: ante 42501 encolan en `localStorage` y devuelven `{status:'queued'}`, así que un fallo del log **no** bloquea la notificación. F4-A (registro) y F4-B (notificación) son fallas independientes. Se corrige con una migración de una sentencia (PR-01).
- Un control financiero miente: `SettingsPageFinancial.jsx:230-232` `handleFinancialSave` solo muestra un toast (#9).
- Dos pedidos literales se desaconsejan con impacto económico concreto: persistir precio en CUP (#8, dos verdades divergentes con la tasa) y "provincia gratis si el municipio es gratis" (#12, anula el cobro de 20 USD en los municipios sin fila de Ciego de Ávila).
- Premisa del borrador corregida: `products.profit_margin` es **NULLABLE con DEFAULT 40** (sonda `information_schema.columns`), no NOT NULL. 0/68 productos lo tienen en NULL.
- 6 migraciones aditivas; cada `supabase db push` requiere un "dale" explícito e independiente (Autonomy Boundaries).
- Carga total estimada: ~2 700–3 200 líneas en 12–13 PRs. Solo F3 supera el umbral de 400 y se divide.

### 1.2 Orden de ejecución

| Orden | PR | Frente | Obs. | Pausa antes de aplicar |
|---|---|---|---|---|
| 1 | PR-01 | F4-A migración GRANT `redact_pii_jsonb` | #4 (registro) | `db push` + punto de rama |
| 2 | **PR-00** | Integridad de precio carrito = catálogo | prerequisito #9/#11 y bug vivo | Confirmar que el carrito debe cobrar `final_price` (no margen global) |
| 3 | PR-02 | F7 vaciar carrito | #7 | No |
| 4 | PR-03 | F1 moneda del precio base | #1, #8, #10 | Texto exacto del error #1; política "USD única verdad" |
| 5 | PR-04 | F4-B notificación cliente (builder puro + enlace explícito) | #4 (notificación) | Reproducir en el dispositivo del cliente; idioma del mensaje |
| 6 | PR-05 | F2 teléfono + municipio en vista admin | #2 | Qué "captura" ve el cliente |
| 7 | PR-06a / 06b | F3 teléfono del pagador | #3 | `db push`; reconciliación con Corte 3; copy |
| 8 | PR-07 | F8-A márgenes globales en BD | #9 | `db push`; "solo defaults, sin re-precio" |
| 9 | PR-08 | F6-A regla municipio⇒provincia + UI bloquea envío no disponible | #12 | Interpretación A/B |
| 10 | PR-09 | F6-B costo de entrega en remesas + protección de columnas | #6 | Suma vs descuento; `db push`; reconciliación Corte 3 |
| 11 | PR-10 | F5 visibilidad Zelle | #5 | Modalidad presentación vs datos; `db push` |
| 12 | PR-11 | F8-B margen por categoría | #11 | No (migración de PR-07 ya aplicada) |
| Gate | — | F4-C canal server-side | #4 | Decisión de negocio: proveedor + secretos |

Paralelismo seguro: PR-02 y PR-10 no comparten archivos con nadie. PR-03 no comparte archivos con la cadena PR-04→06. PR-00 debe preceder a PR-07 (F8-A) y conviene que preceda a PR-03 (ambos tocan la lógica de precio, en archivos distintos).

---

## 2. Observaciones → frente → veredicto

| # | Observación (resumen) | Frente | Veredicto | Valor de negocio | Tamaño est. |
|---|---|---|---|---|---|
| 1 | Precio base en USD "me da error" | F1 | Implementar con cambios | Alto | M (parte de PR-03, ~250 líneas) |
| 2 | Comprobante de pago: mostrar teléfono del destinatario y municipio (pedidos y remesas) | F2 | Implementar con cambios | Medio | M (~250) |
| 3 | Campo obligatorio "Tu teléfono para contactarte" | F3 | Implementar con cambios | Alto | L (~420, dividido en 2 PRs) |
| 4 | Remesas: "ni se registran ni se notifican" | F4 | A: implementar (bug confirmado) · B: implementar con cambios (mitigación) · C: requiere decisión | Crítico | S (A ~15) + M (B ~280) + C sin estimar |
| 5 | Zelle: mostrar/ocultar email y teléfono por cuenta | F5 | Implementar con cambios · modalidad requiere decisión | Medio | M (~250–290) |
| 6 | Costo de envío a provincias/municipios en remesas | F6-B | Implementar con cambios | Alto | M (~320–390) |
| 7 | Vaciar carrito | F7 | Implementar | Medio | S (~180) |
| 8 | Editar producto: declarado en CUP, reabre en USD | F1 | Implementar con cambios (no persistir CUP) | Alto | (incluido en PR-03) |
| 9 | Financiero: actualizar % fijos de ganancia producto/combo | F8-A (+PR-00) | Implementar con cambios | Alto | M (~250 + PR-00 ~120) |
| 10 | Precio base en CUP → simulador también en USD | F1 | Implementar con cambios | Medio | (incluido en PR-03) |
| 11 | % por producto, por categoría, luego global | F8-B | Implementar con cambios | Alto | M (~230) |
| 12 | Municipio gratis ⇒ provincia también | F6-A | Implementar con cambios (interpretación B) | Alto | M (~230–280) |

---

## 3. Frentes

### PR-00 — Integridad de precio: el carrito debe cobrar lo que muestra el catálogo (prerequisito de F1/F8)

**Comportamiento actual (evidencia)**
- `src/components/ProductsPage.jsx:187-188`: `handleAddToCart` → `addToCart(product)` con el objeto crudo de BD.
- `src/contexts/CartContext.jsx:37-46`: `addToCart` guarda `{ ...product, quantity: 1 }` sin enriquecer con `displayed_price` ni `calculated_price_usd`.
- `src/components/CartPage.jsx:84-116` `getItemPrice`: las ramas `displayed_price` (:89) y `calculated_price_usd` (:98) no aplican a productos del catálogo; cae en la rama legacy `:109-113`: `base_price * (1 + (financialSettings.productProfit || 40)/100)`.
- Catálogo y detalle muestran `final_price` (GENERATED en BD): `ProductsPage.jsx:285,305,446`.
- BD viva: `products.final_price numeric(10,2) is_generated=ALWAYS`; `profit_margin numeric(5,2) NULL DEFAULT 40.00`.

**Causa raíz**: el flujo "catálogo → carrito" nunca adoptó `final_price`; el carrito conserva la fórmula previa a la columna generada.

**Confirmación del cross-check (VERIFICADA con lectura directa)**
- Solo hay dos llamadores de `addToCart`: `ProductsPage.jsx:188` (producto crudo, **sin** `displayed_price`) y `ProductDetailPage.jsx:251` (sí inyecta `displayed_price`, `displayed_currency_id`, `displayed_currency_code`, líneas 241-248). El bug se limita a lo agregado desde el **listado**.
- El precio y el total que se cobran se calculan en el cliente y se persisten sin recalcular: `CartPage.jsx:695` `unitPrice: getItemPrice(item)` → `orderService.js:343` `unit_price: item.unitPrice`; `CartPage.jsx:136` `totalAmount` → `orderService.js:307` `total_amount: orderData.totalAmount`. Es decir, **es un bug de cobro, no solo de visualización**, y el servidor confía en el cliente (deuda que el RPC `create_order` de Corte 3 cierra).
- Sigue siendo **HIPÓTESIS** cuánto difiere en datos reales: solo hay divergencia si `products.profit_margin` ≠ `financialSettings.productProfit` (fallback 40). Con el 100 % de productos en el DEFAULT 40 y el global en 40, hoy no se nota. El test rojo de PR-00 debe usar un producto con margen ≠ global.

**Veredicto**: implementar (bug de dinero vivo). Es prerequisito de F8-A: mientras el carrito use `financialSettings.productProfit`, persistir el % global en BD cambiaría lo que paga cada cliente, y la promesa "solo defaults, sin re-precio" sería falsa.

**Impacto**: `src/components/CartPage.jsx` (`getItemPrice`), `src/contexts/CartContext.jsx` (opcional: congelar `displayed_price` al añadir), test nuevo `src/tests/unit/CartPage.getItemPrice.test.jsx`. Sin migración, sin RLS, sin traducciones.

**Plan quirúrgico**
1. TDD: test "precio en carrito de un producto con `final_price` = `final_price`, no `base_price * 1.4`"; test "combo con `profitMargin` propio conserva su cálculo". Rojo.
2. Implementación: en `getItemPrice`, para productos (`!item.products`) usar `item.final_price` cuando exista; mantener la rama global solo como último recurso cuando no haya `final_price` (combos legacy). Verde.
3. Verificación: `npm run test`; comparación manual catálogo vs carrito con un producto cuyo margen ≠ 40 (ejemplo vivo citado por la crítica: margen 45 → catálogo 0.75, carrito 0.73; **no reverificado por mí**, se trata como hipótesis hasta el test).
4. Riesgo de regresión: ítems ya en `localStorage` del carrito sin `final_price` (añadidos antes del cambio) seguirían usando la rama legacy; aceptable y temporal.

**YAGNI**: no refactorizar `CartContext`; no tocar combos; no migrar `financialSettings` aquí (eso es F8-A).

**Requiere confirmación**: ¿el precio que debe pagar el cliente es `final_price` del catálogo? (asumido sí).

---

### F1 — Moneda del precio base (CUP vs USD): normalización segura, cambio de moneda y simulador bimoneda (#1, #8, #10)

**Comportamiento actual (evidencia)**
- `src/components/vendor/VendorInventoryTab.jsx:309-326`: `handleSubmitProduct` convierte `parseFloat(productForm.basePrice)` de la moneda del formulario a la del sistema. `finalCurrencyId` solo cambia a `systemBaseCurrencyId` dentro del `try` (:321); en el `catch` (:322-325) queda la moneda original.
- `src/contexts/CurrencyContext.jsx:90-98`: `getConversionRate` **nunca lanza**: devuelve `1` tanto si no hay tasa como si hay error. Por tanto el `catch` de `VendorInventoryTab` es código muerto y el camino silencioso real es la rama feliz con tasa 1:1 → un importe en CUP se guarda etiquetado USD.
- El `<select>` de moneda (borrador: `:745-749`, no releído aquí; **hipótesis** mantenida del borrador) solo cambia `base_currency_id` sin convertir el número → 10 USD → "10 CUP" → 0.01 USD al guardar.
- BD viva: `base_price numeric(10,2) NOT NULL`, `profit_margin numeric(5,2) NULL DEFAULT 40`, 20/68 productos con `base_price < 1` (legítimos, sub-dólar). Hipótesis H1 para #1: overflow `22003` de `numeric(5,2)` si el margen ≥ 1000; no reproducido.

**Causa raíz** (#8/#10): el formulario no distingue "moneda de entrada" de "moneda almacenada"; USD es la única verdad y al reabrir se muestra USD. (#1): no reproducido; requiere el texto exacto del error.

**Veredicto**: implementar con cambios. No se persiste CUP (dos verdades que divergen con la tasa: 770 hoy, 430/405/500 en histórico según el borrador). Se resuelve en el formulario: selector que convierte el valor, simulador bimoneda, fallo explícito sin tasa, validación de precisión antes de guardar.

**Impacto**: `src/lib/productPricing.js` (nuevo, puro), `VendorInventoryTab.jsx`, `src/lib/errorHandler.js` (mapeo 22003), `ES.json`/`EN.json` (`vendor.addProduct.*`), tests `productPricing.test.js`, `VendorInventoryTab.currency.test.jsx`. Sin migración, sin RLS.

**Plan quirúrgico**
1. TDD `productPricing.normalizeBasePrice(amount, fromId, toId, rate)`: rechaza `rate === 1` entre monedas distintas (ataca el fallback 1:1, no el `catch` muerto); rechaza `rate` nulo; redondea a 2 decimales; acepta sub-dólar (`round(x,2) >= 0.01`).
2. TDD `productPricing.validateMargin(x)`: `0 <= x <= 999.99` (límite real de `numeric(5,2)`); se reutiliza en F8-B.
3. Selector de moneda convierte el valor mostrado y conserva `originalBasePrice`/`originalCurrencyId` para que "guardar sin editar" no redondee.
4. Hard-fail sin tasa: mensaje traducido, no guardar. Confirmación (no bloqueo) cuando el USD normalizado < 0.10.
5. Simulador: segunda fila en USD usando `convertedPreview` existente (borrador `:134-169`, `:815-867`; no releído, **hipótesis**).
6. Mapear `22003` en `errorHandler.js` a un mensaje legible. Traducciones + paridad ES/EN del namespace tocado.
7. Verificación: unit tests; prueba manual crear/editar en CUP y reabrir; e2e `productos-roles.spec.js` existente.
8. Riesgo de regresión: `handleProfitChange`/`handleBasePriceChange` se reescriben aquí; F8-B depende de esta versión (orden obligatorio F1 → F8-B).

**YAGNI**: sin columnas `input_currency_id/input_price`; no tocar el fallback global de `CurrencyContext` (frente de endurecimiento aparte); no tocar combos; sin CHECKs nuevos en `products`.

**Requiere confirmación**: texto exacto y contexto del error de #1; política "USD única verdad"; umbral de confirmación 0.10 USD.

---

### F2 — Vista admin del comprobante: teléfono del destinatario y municipio (#2)

**Comportamiento actual (evidencia)**
- Remesas, admin: `src/components/AdminRemittancesTab.jsx:951` y `:1115` gatean sobre `recipient_city` (columna inexistente en BD viva; existen `recipient_province` y `recipient_municipality`, 23/23 filas con municipio). **Matiz**: el bloque "Cash Delivery" `:1126-1138` ya muestra provincia y municipio cuando `delivery_method === 'cash'`. La brecha real es: tarjeta de lista (:951), tipos no-`cash` (:1115 muerto) y vista de usuario `MyRemittancesPage.jsx:1020` (muerto).
- `src/lib/remittanceService.js:911-912` escribe `recipient_province`/`recipient_municipality` desde `recipient_city` como fallback.
- Mensaje WhatsApp (borrador `whatsappService.js:532,:563`) omite municipio (**no releído**, hipótesis).
- Pedidos, móvil: `src/components/tables/ResponsiveTableWrapper.jsx:84-88` `handleRowClick` hace `setShowModal(true)` **y** `onRowClick?.(row)` → dos modales apilados en móvil. `OrderDetailsModal.jsx:158` usa `t('remittances.paymentReferenceLabel')`, clave que **no existe**; existen `remittances.admin.paymentReferenceLabel` y `remittances.user.paymentReferenceLabel` (`ES.json:339,438`).
- Colateral: `orders.recipient_info` doblemente codificado (borrador; no reverificado).

**Causa raíz**: gates sobre una columna que nunca existió; modal genérico móvil sin datos del destinatario; clave i18n mal namespaced.

**Veredicto**: implementar con cambios. En lugar de duplicar columnas en el modal genérico, suprimir el modal genérico cuando hay `onRowClick` y usar `OrderDetailsModal` (ya responsive) como única vista.

**Impacto**: `AdminRemittancesTab.jsx`, `MyRemittancesPage.jsx`, `whatsappService.js` (builder de F4-B), `tables/ResponsiveTableWrapper.jsx` (prop `disableBuiltInModal` o supresión cuando `onRowClick`), `admin/OrderTableConfig.jsx` (solo si queda algún caso sin `onRowClick`), `OrderDetailsModal.jsx` (clave corregida + `parseRecipientInfo`), `orderService.js` (`parseRecipientInfo`), `ES.json`/`EN.json`, 3–4 tests. Sin migración.

**Plan quirúrgico**
1. TDD `parseRecipientInfo` (string JSON doble, objeto, null).
2. `ResponsiveTableWrapper`: test "con `onRowClick`, no abre el modal genérico"; implementar; verificar todas las tablas admin que pasan `onRowClick` (blast radius: `AdminOrdersTab.jsx:865` según la crítica; **verificar callers con CodeGraph antes de editar**).
3. `OrderDetailsModal`: corregir clave a `remittances.admin.paymentReferenceLabel`; añadir teléfono/municipio desde `parseRecipientInfo`.
4. Remesas: reemplazar gates `recipient_city` por `recipient_municipality || recipient_province` en `:951`, `:1115` y `MyRemittancesPage.jsx:1020`.
5. Municipio en WhatsApp: línea `📍 municipio, provincia` en `buildRemittanceProofMessage` (F4-B).
6. Verificación: unit; e2e `admin-superadmin.spec.js`; prueba manual móvil (un solo modal).
7. Riesgo: cambio en `ResponsiveTableWrapper` afecta a todas las tablas admin → test de regresión por tabla con `onRowClick`.

**YAGNI**: sin columna `recipient_city`; sin normalizar `recipient_info` en BD; sin imagen embebida.

**Requiere confirmación**: qué "captura" ve el cliente (móvil/escritorio/WhatsApp); municipio para tipos `transfer`; arreglar vista de usuario en el mismo PR (propuesto sí).

---

### F3 — Teléfono del pagador obligatorio "Tu teléfono para contactarte" (#3)

**Comportamiento actual (evidencia)**
- `src/components/shared/PaymentProofForm.jsx:41-45`: `t` es un **diccionario inline local** (`language === 'es' ? … : …`), no usa `ES.json`/`EN.json`. Las claves `paymentProof.payerPhone.*` propuestas en el borrador nunca se leerían ahí.
- Paridad i18n: ES 1634 claves, EN 1625; 9 solo en ES (`remittances.user.cancelReasonPlaceholder`, `.close`, `.confirmCancelMessage`, `.paymentProofAlt`, `.paymentProofRequired`, `.paymentProofTitle`, `.paymentReferenceRequired`, `.referenceExamplePlaceholder`, `.status`). Un test de paridad global fallaría el primer día.
- `src/lib/userService.js:45-62` `getUserById` selecciona `phone` y `metadata`; ninguna existe en `user_profiles` (sonda vacía para ambas) → la consulta no puede funcionar hoy (42703, **hipótesis** sobre el código de error; la ausencia de columnas es hecho).
- Diseño pendiente `.claude/docs/design_checkout_atomic_transaction_corte3.md:1,47,90`: propone RPC `create_order(p_cart_items, p_customer_data, …)` que reemplazaría `orderService.createOrder`. Si aterriza antes que F3, `payer_phone` no viajaría al RPC.
- Puntos de entrada (borrador, no releídos): `CartPage.jsx:1160-1173`, `PaymentProofForm.jsx:114-128`, `UserPanel.jsx:1717-1731` (ternarios inline), `MyRemittancesPage.jsx:901-947`.

**Veredicto**: implementar con cambios. Columna dedicada nullable `payer_phone` en `orders` y `remittances`; obligatorio en UI + servicio; sin NOT NULL. Dependencia explícita con Corte 3.

**Impacto**: migración; `remittanceService.js` (firma `uploadPaymentProof(remittanceId, file, reference, notes, payerPhone, options)` acordada en F4-B), `orderService.js`, `whatsappService.js`, `PaymentProofForm.jsx` (extender diccionario inline o migrar a `useLanguage().t` en el mismo PR), `SendRemittancePage.jsx`, `MyRemittancesPage.jsx`, `CartPage.jsx`, `UserPanel.jsx` (claves JSON reemplazan ternarios), `OrderDetailsModal.jsx`, `AdminRemittancesTab.jsx`, `ES.json`/`EN.json`, 4 tests + e2e opcional. Sin RLS/GRANT nuevos.

**Plan quirúrgico** (PR-06a remesas, PR-06b pedidos)
1. Migración (ver §4). Verificación `SELECT column_name … WHERE column_name='payer_phone'`.
2. i18n: claves `paymentProof.payerPhone.label/placeholder/required` en JSON + extensión del diccionario inline de `PaymentProofForm`; test de paridad **acotado a los namespaces tocados por este plan** (no global) o incluir las 9 claves EN faltantes en este PR.
3. TDD `PaymentProofForm`: no envía sin teléfono válido (`isValidPhoneNumber` existente).
4. `remittanceService.uploadPaymentProof` persiste `payer_phone`; wizard y carga tardía lo pasan.
5. PR-06b: `orderService.createOrder` persiste `payer_phone`; `CartPage` valida **antes** de `createOrder`, nunca dentro de `postCreationTasks`; `UserPanel` idem.
6. WhatsApp: línea "Teléfono del pagador" en ambos builders. Vistas admin lo muestran.
7. Verificación: unit; e2e `remesas-roles.spec.js`; sonda SQL de filas nuevas con `payer_phone`.
8. Riesgo: ningún PII en `activity_logs`; si Corte 3 se implementa después, su RPC debe aceptar `p_payer_phone`.

**YAGNI**: sin backfill; sin teléfono en perfil; sin E.164; no tocar `userService.js:45-62` (deuda registrada en §5).

**Requiere confirmación**: orden relativo a Corte 3 (F3 antes y el RPC lo incorpora, o F3 después); obligatorio en reintentos (asumido sí); copy EN/placeholder; exigir `+`; `db push`.

---

### F4 — Notificaciones de remesas: registro roto (confirmado) + WhatsApp solo cliente (mitigación) + canal server-side (decisión) (#4)

**Slice A — Registro (CONFIRMADO)**
- Sonda viva: `has_function_privilege('authenticated','public.redact_pii_jsonb(jsonb)','EXECUTE') = false`. Desde 2026-08-09 solo hay 6 filas en `activity_logs`, todas `product/product_deleted` (insertadas por el RPC `bulk_delete_products`, `SECURITY DEFINER`). Ningún insert directo del rol `authenticated` (remesas, pedidos, carrito) sobrevive al trigger `trg_activity_logs_redact_pii`.
- Esto explica la asimetría "productos sí registra, remesas no": el único flujo que escribe vía RPC es el de productos.
- Causa raíz: `20260809000002_sec07_activity_logs_pii_ttl.sql` revocó EXECUTE a PUBLIC sin re-otorgarlo (borrador; coherente con la sonda).
- Fix: migración `GRANT EXECUTE ON FUNCTION public.redact_pii_jsonb(jsonb) TO authenticated, service_role;`. Sin cambios en `src`.
- Verificación post-migración: `BEGIN; SET ROLE authenticated; INSERT INTO activity_logs (…) VALUES (…); ROLLBACK;` sin 42501; criterio UI: el tab Activity Log muestra entidad `remittance` tras subir un comprobante.
- Riesgo: nulo (función pura). Auditoría perdida no reconstruible; las colas `localStorage` reponen hasta 100 entradas por navegador (borrador).

**Slice B — Notificación cliente (MITIGACIÓN, no causa raíz confirmada)**
- `src/lib/remittanceService.js:1138-1157`: `uploadPaymentProof` llama `notifyAdminNewPaymentProof(…, 'es')` tras `await getFreshWhatsappRecipient()`.
- `src/components/SendRemittancePage.jsx:1327-1343`: tras `await uploadPaymentProof(...)` vuelve a llamar `notifyAdminNewPaymentProof(…, language)`. **Doble `window.open` por una sola activación de usuario**; los navegadores suelen permitir un popup por gesto (comportamiento de navegador, **hipótesis** no reproducida).
- El flujo de pedidos también abre WhatsApp tras varios `await` (borrador: `CartPage.jsx:773-793`; no releído) y el cliente dice que ese sí notifica → "window.open tras await" **no discrimina** por sí solo. Diferencias específicas de remesas: doble apertura, `alert()` bloqueante (borrador `whatsappService.js:484`), idioma forzado `'es'` en el servicio.
- Fix: extraer `buildRemittanceProofMessage` puro; eliminar la llamada duplicada de la página (dejar un único punto en el servicio con `language` opcional); añadir enlace explícito "Avisar al administrador por WhatsApp" en el modal de confirmación y tras carga tardía en `MyRemittancesPage` (abre desde gesto de usuario, nunca bloqueado); sustituir `alert()` por toast.
- Verificación: unit del builder (sin `window.open`); e2e: el enlace existe en el modal; **reproducir en el dispositivo del cliente antes de cerrar #4**.

**Slice C — Server-side (REQUIERE DECISIÓN)**
- `supabase secrets list` (borrador): solo `BANK_ENCRYPTION_KEY`, `MIGRATION_TOKEN`, `SUPABASE_*`. Sin Resend ni Meta; `notify-order` es código muerto; `pg_net` no instalado. Opciones: Resend, WhatsApp Cloud API, inbox admin en app, o quedarse en A+B.

**Impacto**: migración (A); `whatsappService.js`, `remittanceService.js`, `SendRemittancePage.jsx`, `MyRemittancesPage.jsx`, modal de confirmación, `ES.json`/`EN.json`, 2 tests unit + 1 e2e (B).
**YAGNI**: sin integración de proveedor sin decisión; no resucitar `notify-order`; no backfill; no hacer el trigger `SECURITY DEFINER`.
**Requiere confirmación**: proveedor (C); qué significa "ni registrando" para el cliente (tab Activity Log vs lista admin); idioma del mensaje (ES forzado vs UI); enlace de fallback también en pedidos.

---

### F5 — Cuentas Zelle: toggle admin por cuenta para mostrar/ocultar email y teléfono (#5)

**Comportamiento actual (evidencia)**
- BD viva: `zelle_accounts.email text NOT NULL`, `phone text NULL`; sin columnas de visibilidad.
- RLS viva: `zelle_accounts_select_active` SELECT para `authenticated` con `is_active = true` → cualquier usuario autenticado lee la fila completa (email, teléfono, límites, notas) vía API. `zelle_accounts_manage` ALL para admins.
- `src/lib/zelleService.js:172-176`: `reserveZelleAccount` hace `.from('zelle_accounts').select('*')` en cliente tras el RPC.
- `ZelleAccountDisplay.jsx:63,:74` y `ZelleAccountSelector.jsx:223,:258,:278` renderizan sin gating (borrador, no releído).

**Veredicto**: implementar con cambios; la **modalidad requiere decisión**:
- Opción P (presentación): flags `show_email`/`show_phone` + gating en UI. Honesto solo si se documenta que la API sigue exponiendo ambos.
- Opción D (datos, recomendada): mismos flags + RPC `SECURITY DEFINER get_zelle_account_public(p_id)` (o vista) que devuelve `id, account_name, account_holder, email IF show_email, phone IF show_phone`; `reserveZelleAccount` consume esa forma; `zelle_accounts_select_active` se sustituye por SELECT admin-only **solo tras inventariar con CodeGraph todos los callers cliente de `zelle_accounts`** (no verificado en esta sesión). ~+60 líneas sobre P.

**Impacto**: migración; `ZelleAccountDisplay.jsx`, `ZelleAccountSelector.jsx`, `zelleService.js` (`getZelleAccountPublicContact`, validación "al menos uno"), `settings/SettingsZelleTab.jsx`, `ES.json`/`EN.json`, 2 tests + extensión `zelleService.test.js`; en D: RPC + ajuste de policy + test de que un usuario no admin no obtiene `email` con `show_email=false`.

**Plan quirúrgico**: migración → TDD validación "al menos uno visible" → helper de contacto público → gating en Display y Selector → toggles en SettingsZelleTab → (D) RPC + policy + sonda SQL `SET ROLE authenticated` → verificación e2e checkout Zelle.
**Riesgo**: en D, cualquier `select` cliente a `zelle_accounts` no inventariado se rompe → inventario previo obligatorio.
**YAGNI**: sin visibilidad por flujo; no ocultar en vistas admin; sin setting global.
**Requiere confirmación**: P vs D; regla "al menos uno"; gating del selector; `db push`.

---

### F6 — Costo de entrega en remesas (#6) + regla municipio⇒provincia (#12)

**Comportamiento actual (evidencia)**
- #12: `src/components/CartPage.jsx:213-217` y `src/components/SendRemittancePage.jsx:315-318` filtran `free_shipping === true || cost > 0`. `src/components/ProvinceSelector.jsx:25-32` lista solo filas sin municipio y calcula `disabledProvinces`, pero la fila provincial con 0/no-gratis **ya fue eliminada por los filtros**: para ese caso `disabledProvinces` es inalcanzable y la provincia simplemente **no aparece**. Caso vivo: `Camagüey(-):0/false/true` con municipios `Camagüey:5`, `Guáimaro:6` → Camagüey ausente del selector. Ciego de Ávila: provincia 20, `Primero de Enero` gratis, 8 municipios con tarifa propia.
- `src/components/CartPage.jsx:268-284` `updateShippingCost`: `catch → setShippingCost(0)`. Lanzar `VALIDATION_FAILED` desde `shippingService` no impediría crear el pedido con envío 0.
- #6: `calculateRemittance`, `calcForward`, `createRemittance` y el wizard no consideran `shipping_zones` (borrador `remittanceService.js:577-672,:897-917`, `remittanceCalculations.js:10-31`; no releídos). BD viva: `remittances` sin `delivery_cost`.
- `src/components/SendRemittancePage.jsx:1066`: `addresses?.[0]` ignora `recipientData.addressId`.
- RLS viva: `users can update own remittances` UPDATE para `authenticated`, `qual/with_check (user_id = current_user_id())`, **sin restricción de columnas**; `authenticated` tiene GRANT UPDATE en `remittances`. Un usuario podría alterar `delivery_cost`/`amount_sent` antes de la validación admin.
- Corte 3 (`design_checkout_atomic_transaction_corte3.md`) afecta a pedidos, no a remesas; la dependencia se registra igual por si se extiende el patrón RPC.

**Veredicto**: implementar con cambios, 2 PRs encadenados. Interpretación B de #12 ("provincia seleccionable si tiene ≥1 municipio disponible"); el costo se SUMA al total que paga el remitente; solo `delivery_method='cash'`; la UI bloquea el avance cuando la zona no está disponible; columnas de dinero protegidas contra UPDATE del propio usuario.

**PR-A (#12 + bloqueo UI, sin BD)**
- Archivos: `src/lib/shippingZoneRules.js` (nuevo: `getSelectableProvinces(zones)`, `isZoneAvailable`), `CartPage.jsx:213-217` y `SendRemittancePage.jsx:315-318` (aplicar la regla en los **dos filtros**, antes que `ProvinceSelector`), `ProvinceSelector.jsx` (consume zonas ya filtradas), `RecipientSelector.jsx`, `CartPage.updateShippingCost` (estado `shippingUnavailable`, deshabilitar "continuar/pagar", nunca 0 por error), paso 3 de `SendRemittancePage`, i18n, tests `shippingZoneRules.test.js`, `CartPage.shipping.test.jsx` (provincia deshabilitada → botón deshabilitado, costo ≠ 0), `ProvinceSelector.test.jsx`.
- TDD: regla pura con el dataset vivo de Camagüey/Ciego de Ávila.
- Riesgo: cambia qué provincias aparecen en checkout y remesas; e2e `productos-roles`/`remesas-roles` como red.

**PR-B (#6, sobre PR-A)**
- Migración (§4): `delivery_cost`, `shipping_zone_id`, y **protección de columnas** (trigger `BEFORE UPDATE` que rechaza cambios en `amount_sent, amount_to_deliver, delivery_cost, exchange_rate, commission_*` cuando `NOT is_admin_user()`; alternativa: `REVOKE UPDATE (cols) ON remittances FROM authenticated`).
- `remittanceCalculations.calcTotalToPay`; `createRemittance` resuelve costo con `shippingService.calculateShippingCost` (única fuente) y usa `total_to_pay` en `reserveZelleAccount`/`registerZelleTransaction`; fix `addressId`; preview, resumen paso 3, `AmountDisplayCard`; `AdminRemittancesTab` (total pagado); builder WhatsApp; i18n; tests unit + e2e; **test que asegura que lo registrado en `zelle_transactions` y lo que ve el admin = `amount_sent + delivery_cost`**.
- Verificación: sonda `SET ROLE authenticated; UPDATE remittances SET delivery_cost=0 …` debe fallar (en transacción con ROLLBACK).
- Riesgo: `calcReverse` intacto (no descontar de `amount_to_deliver`).

**YAGNI**: sin tarifas en `remittance_types`; sin columna generada `total_to_pay`; sin trigger de recálculo desde `shipping_zones` (acoplaría remesas históricas a ediciones de zonas); sin backfill.
**Requiere confirmación** (bloqueantes para PR-B): suma vs descuento; solo `cash`; interpretación A/B de #12; bloquear vs cobrar 0 en municipio sin fila con provincia deshabilitada; incluir fix `addressId`; mecanismo de protección (trigger vs REVOKE por columna); `db push`.

---

### F7 — Carrito: acción "Vaciar carrito" con confirmación (#7)

**Comportamiento actual**: `src/contexts/CartContext.jsx` expone `clearCart` (:69); `CartPage.jsx` lo usa en `:819, :1256, :1261, :1480, :1485` (post-pedido y handlers de `ConfirmationModal`). No hay acción de usuario para vaciar.
**Veredicto**: implementar.
**Impacto**: `CartPage.jsx` (botón en panel resumen, solo `view === 'cart' && cart.length > 0 && !showConfirmationModal`), `ES.json`/`EN.json` (`cart.clearAll.*`), tests `CartContext.test.jsx`, `CartPage.clearCart.test.jsx` (query por rol/label del botón; no asumir "clearCart llamado una vez"; mockear `getActiveShippingZones` y `convertCurrency`), e2e opcional. Sin migración.
**Plan**: TDD botón ausente en vistas `recipient`/`payment`/confirmación → implementar con `useModal().showModal({type:'danger'})` → traducciones → verificación.
**Riesgo**: nulo (semántica de `clearCart` intacta).
**YAGNI**: sin undo; sin log; sin refactor de `CartPage`.
**Requiere confirmación**: ubicación del botón; el cupón aplicado se descarta implícitamente (propuesto sí).

---

### F8 — Márgenes globales persistidos en BD + precedencia producto > categoría > global (#9, #11)

**Comportamiento actual (evidencia)**
- #9: `src/components/settings/SettingsPageFinancial.jsx:230-232` `handleFinancialSave = () => toast(...)`: no persiste. `SettingsContext` guarda en `localStorage` por dispositivo (borrador `:66-79`). BD viva `system_config`: columnas `id,key,value_text,value_numeric,value_boolean,description,…`; claves `default_profit_margin, shipping_cost_local, shipping_cost_national, tax_rate`; policies: `admins_read_config` (SELECT admins), `users_read_notification_config` (SELECT key-scoped), `service_role_all_access`; **sin policy UPDATE**; GRANTs: `authenticated` INSERT/SELECT/UPDATE/DELETE, **sin anon**.
- #11: `products.profit_margin numeric(5,2) NULL DEFAULT 40` (0/68 en NULL); `final_price` GENERATED. `product_categories` sin `profit_margin`. `useProfitMargin.js:29-43` ignora `categoryId` (fallback 40); cadena `PriceDisplay → usePriceCalculation → useProfitMargin` no se renderiza en `ProductsPage` (sin `<PriceDisplay`; solo precio por `final_price`).
- Dependencia: PR-00 debe aterrizar antes; hoy el carrito usa el margen global de `localStorage` (ver PR-00).

**Veredicto**: implementar con cambios. Persistir en `system_config` con policies key-scoped **solo para `authenticated`/admin** (sin anon). Precedencia resuelta al precargar el formulario (producto → categoría → global) mostrando la fuente del valor; **no** usar `profit_margin IS NULL` como "hereda" (requeriría que `final_price` GENERATED tolere NULL o un trigger; hoy ningún producto lo usa); nunca re-preciar productos existentes.

**PR-A (#9)**: migración (fila `default_combo_profit_margin`; policy `system_config_admin_update_margins` UPDATE con `is_admin_user()` y `key IN (…)`; INSERT equivalente si hay upsert; **sin GRANT a anon ni policy pública**); `src/lib/marginResolver.js`; `src/lib/financialSettingsService.js`; `SettingsContext.jsx` (lee de BD cuando el usuario es admin; fallback para no-admin no depende de estas claves); `SettingsPage.jsx` (borrar handler huérfano `:90-99`, borrador); `SettingsPageFinancial.jsx`; i18n; tests `marginResolver`, `financialSettingsService`, `SettingsContext.margins`, `SettingsPageFinancial.margins`; e2e admin.
**PR-B (#11)**: misma migración añade `product_categories.profit_margin numeric(5,2) NULL CHECK (profit_margin >= 0 AND profit_margin <= 999.99)` (mismo límite que `products` y que `productPricing.validateMargin` de F1); `productService.js` create/updateCategory; `VendorCategoriesTab.jsx`; `VendorInventoryTab.jsx` (`getEffectiveMargin`, `marginTouched`, fuente del valor; sobre la versión de F1); i18n; tests `productService.categories`, `VendorInventoryTab.margin`, y un test que documenta el comportamiento con `profit_margin IS NULL` en producto.
**Riesgo**: `SettingsContext` lo consume todo el frontend; cambios acotados a las dos claves de margen.
**YAGNI**: sin re-precio masivo (sería frente aparte con RPC `SECURITY DEFINER` + confirm-word); no migrar `usdToLocal/currencies/shipping*` fuera de `localStorage`; no borrar la cadena muerta `useProfitMargin`; sin herencia por `parent_id`.
**Requiere confirmación**: "solo defaults, sin re-precio"; al editar producto cuya categoría tiene %, mantener el guardado (asumido sí); confirmar que ningún flujo no-admin necesita leer el margen global tras PR-00.

---

## 4. Cambios de modelo de datos (migraciones)

Todas aditivas y reversibles; una por PR; sin índices especulativos; cada `supabase db push` requiere confirmación explícita.

| Migración | PR | Contenido | Justificación | Riesgo |
|---|---|---|---|---|
| `20261013100000_fix_sec07_redact_fn_grant.sql` + `20261013100100_restrict_activity_logs_select_admin.sql` | PR-01 (IMPLEMENTADO, commit `0f90679a`, APLICADO al remoto 2026-10-13) | `GRANT EXECUTE ON FUNCTION public.redact_pii_jsonb(jsonb) TO authenticated, service_role;` (mantener REVOKE FROM PUBLIC) **y** reemplazo de la policy de lectura `USING (true)` por `is_admin_user()` | `has_function_privilege(...) = false` confirmado; trigger `BEFORE INSERT` sin `SECURITY DEFINER`. La lectura abierta se descubrió en la revisión de implementación: sin la segunda migración, arreglar el GRANT expondría logs de pedidos y remesas a todos los clientes | Bajo. **Corrige el "Nulo" original** |
| `<ts>_payer_phone_on_orders_remittances.sql` | PR-06a | `orders.payer_phone text NULL`, `remittances.payer_phone varchar(30) NULL`, CHECK de formato tolerante a NULL | Campo nuevo; no concatenar en `payment_reference` | Nulo |
| `<ts>_f8_profit_margin_settings.sql` | PR-07 (+PR-11) | fila `system_config('default_combo_profit_margin')`; policies `system_config_admin_update_margins` (UPDATE, `is_admin_user()`, key-scoped) e INSERT equivalente; `product_categories.profit_margin numeric(5,2) NULL CHECK (0..999.99)` | Persistencia real del % global; misma precisión que `products` | Bajo (sin exposición a anon) |
| `<ts>_remittances_delivery_cost.sql` | PR-09 | `delivery_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (>= 0)`; `shipping_zone_id uuid NULL REFERENCES shipping_zones ON DELETE SET NULL`; trigger `BEFORE UPDATE` (o REVOKE por columna) que impide a no-admins modificar columnas de dinero | Cobro de entrega + cierre del agujero de UPDATE propio sobre la nueva columna | Bajo para datos existentes; medio para flujos que hoy actualicen esas columnas como usuario (inventariar antes) |
| `<ts>_zelle_accounts_visibility_flags.sql` | PR-10 | `show_email boolean NOT NULL DEFAULT true`, `show_phone boolean NOT NULL DEFAULT true`, `CHECK (show_email OR show_phone)`; en opción D: RPC `get_zelle_account_public(uuid)` `SECURITY DEFINER` + ajuste de `zelle_accounts_select_active` | Control admin por cuenta | Nulo (P) / Medio (D, requiere inventario de callers) |

No se fusionan: cada una pertenece a un PR y debe poder revertirse sola. `remittances` ya tiene GRANTs completos para `authenticated`; `system_config` también (verificado), por lo que solo faltan policies.

---

## 5. Riesgos NEEDS-DISCUSSION (las 8 decisiones bloqueantes quedaron RESUELTAS, ver §0; se conservan como registro)

**Bloqueantes (sin respuesta no se implementa el paso):**
1. **F4-C** proveedor server-side: Resend / WhatsApp Cloud API / inbox admin / quedarse en A+B.
2. **F6-B** costo de entrega: ¿se SUMA a lo que paga el remitente (recomendado) o se DESCUENTA de lo entregado?
3. **F6-A** regla #12: (A) literal "provincia pasa a gratis" (pérdida de 20 USD en municipios sin fila de Ciego de Ávila) o (B) "seleccionable si tiene ≥1 municipio disponible" (recomendado).
4. **F8** ¿cambiar el % global re-precia productos/combos existentes? Plan asume NO.
5. **PR-00** ¿el carrito debe cobrar exactamente `final_price` del catálogo? Plan asume SÍ.
6. **F3/F6-B vs Corte 3 (DATA-01)**: implementar antes y que el RPC `create_order` incorpore `payer_phone` (y el patrón se extienda a remesas), o posponer hasta que exista el RPC.
7. **F5** modalidad P (presentación) vs D (datos). Plan recomienda D con inventario previo de callers.
8. **Punto de rama**: commitear/cerrar `feat/admin-bulk-ops-reset-audit` y ramificar desde `main`, o encadenar sobre la rama actual.

**Necesarias para cerrar bien (plan asume un valor por defecto):**
9. F1: texto exacto del error #1; umbral de confirmación 0.10 USD; política USD única verdad.
10. F2: qué "captura" ve el cliente; municipio para tipos `transfer`; vista de usuario en el mismo PR.
11. F3: obligatorio en reintentos; copy EN; exigir `+`; mostrar al usuario su teléfono (asumido no).
12. F4: idioma del mensaje; significado de "ni registrando"; reproducción en el dispositivo del cliente antes de PR-04.
13. F6-B: mecanismo de protección (trigger vs REVOKE por columna); solo `cash`; fix `addressId` incluido.
14. F7: ubicación del botón; cupón descartado.
15. F8: comportamiento al editar producto con categoría con %.

**Deuda registrada (fuera de alcance):** `userService.getUserById` selecciona `phone` y `metadata` inexistentes (`userService.js:45-62`); `orders.recipient_info` doblemente codificado; fallback 1:1 global en `CurrencyContext.jsx:90-98`; `notify-order` y ruta Resend muertas; cadena muerta `useProfitMargin`; `zelleService.js:790` claves no coincidentes (borrador); nota de `CLAUDE.md` sobre `RESEND_API_KEY` incorrecta; `products` sin CHECK de no negativos.

**Confirmaciones operativas obligatorias:** un "dale" por cada `db push` (PR-01, 06a, 07, 09, 10).

---

## 6. Review Workload Forecast

Convención: ≤ 400 líneas cambiadas por PR (incluye tests).

| PR | Frente | Archivos prod | Tests | Líneas est. | Migración | Riesgo 400 | Agrupación |
|---|---|---|---|---|---|---|---|
| PR-01 | F4-A | 1 migración + 2 docs | sonda SQL | ~15 | Sí | Nulo | Separado |
| PR-00 | Precio carrito | 1–2 | 1 | ~100–140 | No | Bajo | Separado, antes de PR-03/07 |
| PR-02 | F7 | 3 | 2 (+e2e opc.) | ~180 | No | Bajo | Separado |
| PR-03 | F1 | 5 | 2 | ~230–310 | No | Bajo-medio | Separado |
| PR-04 | F4-B | 7 | 2 + 1 e2e | ~250–300 | No | Medio | Base de cadena remesas |
| PR-05 | F2 | 8 | 3–4 | ~240–340 | No | Medio | Encadenado sobre PR-04 |
| PR-06a | F3 remesas | 7 | 2 | ~230 | Sí | Bajo-medio | Encadenado sobre PR-05 |
| PR-06b | F3 pedidos | 6 | 2 (+e2e) | ~210 | No | Bajo | Encadenado sobre PR-06a |
| PR-07 | F8-A | 7 | 4 + e2e | ~250–280 | Sí (compartida con PR-11) | Medio | Separado, después de PR-00 |
| PR-08 | F6-A | 7 | 3 | ~230–280 | No | Medio | Base de PR-09 |
| PR-09 | F6-B | 9 | 3 + e2e | ~320–390 | Sí | **Medio-alto** | Encadenado sobre PR-08; si supera 380, separar trigger de protección en PR-09a |
| PR-10 | F5 | 7 (+RPC en D) | 2 + ext. | ~190–230 (P) / ~250–290 (D) | Sí | Bajo-medio | Separado |
| PR-11 | F8-B | 5 | 3 | ~230 | Reusa PR-07 | Bajo | Encadenado sobre PR-07 y después de PR-03 |
| **Total** | | | | **~2 700–3 200** | 5 | | 13 PRs |

- Chained PRs recommended: **Yes** (cadenas: F4-B→F2→F3a→F3b; F6-A→F6-B; F8-A→F8-B).
- 400-line budget risk: **High** evitado dividiendo F3; **Medium-high** en PR-09 (plan de corte previsto).
- Decision needed before apply: **Yes** en PR-00, 01, 03, 04, 05, 06a, 07, 08, 09, 10.
- Estrategia sugerida: `feature-branch-chain` para las tres cadenas; `stacked-to-main` para PR-00, 01, 02, 10.
- Archivos compartidos a serializar: `whatsappService.js` (F4-B → F2 → F3 → F6-B), `remittanceService.js` (F4-B → F3 → F6-B), `SendRemittancePage.jsx` (F4-B → F3 → F6-B), `AdminRemittancesTab.jsx` (F2 → F3 → F6-B), `CartPage.jsx` (PR-00 → F7 → F3b → F6-A), `VendorInventoryTab.jsx` (F1 → F8-B), `ES.json`/`EN.json` (todos; test de paridad acotado a namespaces tocados).

---

## 7. Apéndice: hallazgos de la crítica aceptados vs rechazados

**Aceptados (verificados en esta sesión)**
1. F8 — `products.profit_margin` es NULLABLE DEFAULT 40 (sonda `information_schema.columns`). Corregido en F8; se mantiene precarga y se añade test para `IS NULL`.
2. F4 — "window.open tras await" no discrimina frente al flujo de pedidos; doble llamada confirmada (`remittanceService.js:1149`, `SendRemittancePage.jsx:1341`). Slice B reetiquetado como mitigación; reproducción previa obligatoria.
3. F3 — Dependencia con Corte 3 (`design_checkout_atomic_transaction_corte3.md:1,47,90`). Añadida a §5.6.
4. F6 — `users can update own remittances` sin restricción de columnas (pg_policies). Protección incluida en la migración de PR-09 (no "frente aparte").
5. F1 — El `catch` es código muerto; `CurrencyContext.jsx:90-98` devuelve 1. Test TDD apunta al fallback 1:1.
6. F6 — Camagüey está **ausente**, no deshabilitada (`CartPage.jsx:213-217`, `SendRemittancePage.jsx:315-318`, `ProvinceSelector.jsx:25-32`). Regla movida a los filtros.
7. F7 — `clearCart` en 5 sitios (`CartPage.jsx:819,1256,1261,1480,1485`). Test acotado al botón.
8. F8 — Sin GRANT a anon ni policy pública (confirmado: sin GRANT anon vivo, `<PriceDisplay` no renderizado en `ProductsPage`). Migración de PR-07 reducida.
9. F4 — Evidencia sustituida por `has_function_privilege = false` y 6 filas post-SEC-07 todas `product_deleted` vía RPC `SECURITY DEFINER`.
10. F8 **CRÍTICO** — Carrito cobra margen global (`ProductsPage.jsx:188`, `CartContext.jsx:37-46`, `CartPage.jsx:109-113`). Nuevo PR-00 prerequisito.
11. F6 **CRÍTICO** — `CartPage.jsx:277-283` traga el error a 0. PR-A hace de la UI el gate.
12. F2 — Doble modal (`ResponsiveTableWrapper.jsx:84-88`) y clave `remittances.paymentReferenceLabel` inexistente (`OrderDetailsModal.jsx:158`; existen `remittances.admin.*`/`remittances.user.*` en `ES.json:339,438`). Incorporado en F2.
13. F3 — `PaymentProofForm.jsx:41-45` usa diccionario inline; 9 claves faltan en EN (listadas en F3). Plan i18n corregido; test de paridad acotado.
14. F2 — `recipient_municipality` existe y está poblada (23/23). **Con matiz**: `AdminRemittancesTab.jsx:1126-1138` ya la muestra para tipos `cash`; la brecha real es la tarjeta de lista (:951), tipos no-`cash` (:1115) y `MyRemittancesPage.jsx:1020`.
15. F8 — `product_categories.profit_margin` en `numeric(5,2)` con CHECK ≤ 999.99, compartido con el validador de F1.
16. F1 — 20/68 productos sub-dólar; umbral `>= 0.01` + confirmación < 0.10 en lugar de bloqueo.
17. F3 — `getUserById` también selecciona `metadata` inexistente (`userService.js:45-62`). Registrado como deuda con ambas columnas.
18. F5 — Gating a nivel de datos (`zelle_accounts_select_active` + `zelleService.js:172-176 select('*')`). Aceptado como **opción D recomendada**, condicionado a inventario de callers y decisión del usuario (§5.7).

**Rechazados o aceptados parcialmente**
- F8, alternativa "reutilizar la Edge Function `notification-settings` para escribir márgenes": **rechazada**. Introduce una dependencia cruzada entre dominios y una Edge Function con service role para dos claves no sensibles; las policies key-scoped para admin bastan y siguen el patrón ya existente en `system_config` (`users_read_notification_config`).
- F6, "trigger que recalcule `delivery_cost` desde `shipping_zones` en cada UPDATE": **rechazado**. Acoplaría remesas históricas a ediciones futuras de tarifas (una remesa validada cambiaría de total al editar una zona). Se adopta en su lugar la congelación de columnas de dinero para no-admins (trigger de guarda o REVOKE por columna), que cubre el riesgo señalado sin ese efecto colateral.
- F5, "sustituir `zelle_accounts_select_active` por SELECT admin-only" **sin inventario previo**: aceptado solo con la condición de inventariar con CodeGraph todos los accesos cliente a `zelle_accounts` (no verificado en esta sesión); aplicar la policy a ciegas podría romper el checkout.
- F4 y F6/F7/F8 — Los hallazgos duplicados (asimetría productos/remesas; UPDATE propio; `clearCart` x5; sobre-provisión anon) se consolidaron con su primera aparición; no se contabilizan dos veces.