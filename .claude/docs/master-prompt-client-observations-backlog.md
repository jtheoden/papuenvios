# Master Prompt — Backlog de observaciones del cliente "To Build Better Web"

**Propósito**: receta reusable para que cualquier agente, sin memoria de esta sesión, implemente **un PR del backlog por vez** de forma quirúrgica, funcional y segura. Hechos y veredictos viven en `.claude/docs/plan_client-observations-to-build-better-web.md` (fuente única de verdad). Si este prompt y el plan divergen, **manda el plan**: se corrige el plan y luego se regenera este documento.

Origen: documento del cliente `tO BUILD BETTER WEB.docx` (12 observaciones), analizado contra el código y la BD viva el 2026-10-12 con `/strategic-plan-workflow` (recon → 8 frentes → síntesis → 2 críticos adversariales → plan final → cross-check con advisor).

---

## 1. Objetivo de negocio

PapuEnvios mueve dinero real de clientes cubanos (remesas y pedidos). El criterio rector de cada decisión es **el mejor interés del proyecto**, no la literalidad del pedido. Por eso 2 pedidos se implementan con cambios y el plan lo justifica con evidencia (#8 no persiste CUP; #12 usa la interpretación B). Prioridad: (1) correctitud de dinero, (2) visibilidad para el admin de quién paga y a quién se entrega, (3) fiabilidad de avisos, (4) comodidad.

## 2. Reglas no negociables (aplican a TODOS los PR)

1. **Un PR = una rama = un conjunto de cambios revisable (≤ 400 líneas incluyendo tests).** Rama feature nueva **creada desde `origin/main` fresco** (D8, `stacked-to-main`) con Conventional Commits; solo se encadena sobre otro PR del backlog cuando la columna "Depende de" lo exige y ese PR aún no está fusionado. **Nunca commit ni push sin pedido explícito del usuario.** Nunca sobre `main`.
2. **TDD estricto rojo → verde → refactor.** Cada paso nombra el test (Vitest en `src/tests/unit/`, Playwright en `src/tests/e2e/`) o la sonda SQL exacta que **falla hoy**. Se ejecuta en rojo y se muestra la salida antes de implementar.
3. **Corrección tras cada archivo escrito**: releer, buscar referencias indefinidas, imports, claves i18n y custom properties. No avanzar con un error conocido.
4. **Evidencia primero.** Cada cita `archivo:línea` del plan es VERIFICADA o HIPÓTESIS (el plan lo dice). Antes de editar un archivo, confirmar con `codegraph explore "<símbolo>"` la forma real y los **callers vivos** (blast radius). Una cita no verificada nunca justifica un cambio.
5. **Base de datos remota: solo lectura salvo orden explícita.** Las migraciones se escriben en `supabase/migrations/` con timestamp ISO y se dejan listas. **Cada `supabase db push` / `apply_migration` requiere su propio "dale" del usuario**, separado de aprobar el PR. Sondas SQL permitidas: `SELECT` y transacciones con `ROLLBACK`.
6. **Patrón SQL del proyecto**: RPC nuevo = `SECURITY DEFINER` + `SET search_path = public` + chequeo de rol interno + `GRANT EXECUTE ... TO authenticated` como sentencia aparte. Tabla/columna nueva = verificar GRANTs **y** RLS. `REVOKE ... FROM PUBLIC` también quita al resto: re-otorgar explícito.
7. **i18n**: todo texto visible va a `src/translations/ES.json` **y** `EN.json` en la misma tarea. Excepción conocida: `PaymentProofForm.jsx:41-45` usa un diccionario inline propio, no los JSON. El test de paridad se **acota a los namespaces tocados** (hoy hay 9 claves solo-ES preexistentes).
8. **Sin `console.log`/`debugger`/`TODO`/`FIXME`** en código listo para PR. Sin secretos. Sanitizar entrada de usuario. `activity_logs` no recibe PII (teléfonos).
9. **YAGNI explícito por PR** (sección "No hacer"). No refactorizar lo que no se pide.
10. **Preguntar solo cuando la decisión es del usuario.** Si el PR depende de una decisión bloqueante abierta, **no se implementa**: se detiene y se formula la pregunta exacta (una por vez). Si hay una respuesta razonable por defecto documentada, se declara el supuesto y se sigue.
11. **Trazabilidad al cerrar cada PR**: anexar (nunca reemplazar) a `.claude/TRACKING_PROGRESS.md`, y guardar `mem_save` con `topic_key: strategic-plan/client-observations/<PR-id>` (qué se construyó vs. lo planeado, qué sorprendió).
12. **Arranque de cada sesión**: `mem_context` + `mem_search("strategic-plan client-observations")`, leer el plan y la fila del PR en esta cola.

## 3. Cola de ejecución (orden obligatorio y estado)

**Decisiones del usuario (resueltas el 2026-10-13, ya no bloquean):**
- **D1** Aviso al admin: se queda el **enlace manual** de WhatsApp. F4-C (proveedor server-side) queda **CERRADO, no se implementa**. Por eso PR-04 pasa a ser la solución definitiva del aviso y debe quedar robusta.
- **D2** El costo de entrega **se suma** a lo que paga el remitente.
- **D3** Regla #12 con **interpretación B** (provincia seleccionable si tiene al menos un municipio disponible).
- **D4** Cambiar el % global de ganancia **no re-precia** lo existente.
- **D5** El carrito **cobra exactamente `final_price`** del catálogo.
- **D6** (elegida por criterio técnico) Se construye el teléfono del pagador **ahora**, contra el `createOrder` actual, con columna nullable. Motivo verificado: el RPC `create_order` de Corte 3 **no existe** (el documento dice "SOLO DISEÑO"; no hay migración). Obligación de traspaso: cuando se implemente Corte 3, su RPC debe aceptar `p_payer_phone`.
- **D7** Zelle: **opción D (datos)** con dos interruptores **independientes** `show_email` y `show_phone`; el admin puede ocultar uno u otro por cuenta. Salvaguarda que se mantiene salvo que el usuario la anule: **al menos uno visible**, porque con ambos ocultos el cliente no sabría adónde enviar el Zelle.
- **D8** (elegida por criterio técnico) **Cada PR sale de `origin/main` fresco** (estrategia `stacked-to-main`). La rama `feat/admin-bulk-ops-reset-audit` ya fue fusionada en `main` por el PR #53 (la base de este worktree es `e2fa320a`). **No** se encadena sobre ella. Los cambios sin commitear del checkout principal (`zelleService.js`, `constants.js`, `AuthContext.jsx`, `RemittanceTypesConfig.jsx`, `notify-zelle-deactivation`, migraciones SEC-10/11/12) **no están en `main`**: se recomienda commitearlos o fusionarlos antes de PR-10, que toca `zelleService.js`, para evitar conflictos.

**Preguntas que siguen abiertas:** (i) el texto exacto del error de la observación 1 (solo afecta a PR-03); (ii) cada `supabase db push` pide su propio "dale"; (iii) detalles menores de copy anotados dentro de cada PR.

| # | PR | Frente | Obs. | Estado | Depende de | Pregunta aún abierta |
|---|---|---|---|---|---|---|
| 1 | PR-01 | F4-A GRANT `redact_pii_jsonb` + lectura admin-only de `activity_logs` | #4 | **IMPLEMENTADO, commiteado (`0f90679a`, sin push) y APLICADO a Supabase remoto el 2026-10-13** (versiones remotas `20261013130848` y `20261013130913`). Pendiente: verificar en la UI que aparezcan logs de remesas | — | Ninguna |
| 2 | PR-00 | Carrito cobra `final_price` | #9/#11 | **IMPLEMENTADO y commiteado** (`fix/pr-00-cart-final-price`, `3c37a251`, sin push; 92/92 tests, build OK) | — | Ninguna |
| 3 | PR-02 | F7 Vaciar carrito | #7 | **IMPLEMENTADO y commiteado** (`feat/pr-02-clear-cart`, `9380b8fd`, sin push; 96/96 tests, build OK) | PR-00 (comparte `CartPage.jsx`) | Ubicación del botón (supuesto: panel resumen) |
| 4 | PR-03 | F1 Moneda del precio base | #1,#8,#10 | **LISTO** para #8/#10; #1 requiere el texto exacto del error | PR-00 recomendado | "¿Qué mensaje/valor exacto dio el error de la obs. 1?" |
| 5 | PR-04 | F4-B Aviso al admin por enlace manual (solución definitiva, D1) | #4 | **IMPLEMENTADO y commiteado** (`feat/pr-04-remittance-admin-notice`, `7ae85945`, sin push; 87/87 tests, build OK) | — | Idioma del mensaje (supuesto: el de la UI del cliente) |
| 6 | PR-05 | F2 Teléfono y municipio en vista admin | #2 | **IMPLEMENTADO y commiteado** (`feat/pr-05-recipient-contact-admin-view`, `13a2fb57`, sin push, apilado sobre PR-04; 115/115 tests, build OK) | PR-04 | "¿Qué 'captura' ve el cliente?" (supuesto: el modal admin y el mensaje de WhatsApp) |
| 7 | PR-06a | F3 Teléfono pagador (remesas) | #3 | **IMPLEMENTADO y commiteado** (`feat/pr-06a-payer-phone-remittances`, `8c4d228c`, sin push, apilado sobre PR-05; 135/135 tests, build OK). **Migración NO aplicada al remoto: falta tu "dale"** | PR-05 | Copy EN; obligatorio también en reintentos (supuesto: sí) |
| 8 | PR-06b | F3 Teléfono pagador (pedidos) | #3 | **IMPLEMENTADO y commiteado** (`feat/pr-06b-payer-phone-orders`, `34e14454`, sin push, apilado sobre PR-06a; 160/160 tests, build OK). Requiere la migración de PR-06a aplicada antes de desplegar | PR-06a | idem |
| 9 | PR-07 | F8-A Márgenes globales en BD | #9 | **IMPLEMENTADO y commiteado** (`feat/pr-07-global-margins-db`, `d72f3a8c`, sin push, desde origin/main; 102/102 tests, build OK). **Migración NO aplicada: falta tu "dale"** | PR-00 | Ninguna |
| 10 | PR-08 | F6-A Regla municipio⇒provincia (interpretación B) | #12 | **IMPLEMENTADO y commiteado** (`feat/pr-08-shipping-zone-rules`, `371e39d9`, sin push, apilado sobre PR-06b; 198/198 tests, build OK) | PR-00 (`CartPage.jsx`) | Ninguna |
| 11 | PR-09 | F6-B Costo de entrega en remesas (se suma) | #6 | **IMPLEMENTADO y commiteado SIN trigger** (`feat/pr-09-remittance-delivery-cost`, `93cfc15b`, sin push, apilado sobre PR-08; 218/218 tests, build OK). **Migración NO aplicada: falta tu "dale"** | PR-08 | Mecanismo de protección: trigger vs REVOKE por columna (supuesto: trigger) |
| 12 | PR-10 | F5 Visibilidad Zelle, opción D, toggles independientes | #5 | **LISTO** (D7); recomendado commitear antes los cambios locales de `zelleService.js` | — | Ninguna |
| 13 | PR-11 | F8-B Margen por categoría | #11 | **LISTO** tras PR-03 y PR-07 | PR-03, PR-07 | Ninguna |
| — | F4-C | Aviso server-side (Resend/Meta API) | #4 | **CERRADO por D1: no se implementa** | — | — |

Paralelismo seguro: PR-02 y PR-10 no comparten archivos con nadie. PR-03 no comparte archivos con la cadena PR-04→06b. Archivos a **serializar**: `whatsappService.js`, `remittanceService.js`, `SendRemittancePage.jsx`, `AdminRemittancesTab.jsx` (cadena de remesas); `CartPage.jsx` (PR-00 → PR-02 → PR-06b → PR-08); `VendorInventoryTab.jsx` (PR-03 → PR-11); `ES.json`/`EN.json` (todos).

---

## 4. Prompts por PR (cada uno es autocontenido)

> Plantilla de cada tarea: **Objetivo → Evidencia (V=verificada / H=hipótesis a confirmar) → Test rojo → Implementación → Verificación → Riesgo de regresión → No hacer → Pausa/Pregunta.**

### PR-01 — Registro de actividad roto (F4-A, obs. #4) — IMPLEMENTADO 2026-10-13
- **Estado**: rama `fix/pr-01-redact-pii-grant`, commit `0f90679a`, **sin push**. **APLICADO al remoto el 2026-10-13** con `apply_migration` (no con `supabase db push`, ver nota abajo), en orden seguro: primero la restricción de lectura (versión remota `20261013130848`), después el GRANT (`20261013130913`). Dos migraciones que deben aplicarse **juntas**:
  1. `supabase/migrations/20261013100000_fix_sec07_redact_fn_grant.sql`: `GRANT EXECUTE ON FUNCTION public.redact_pii_jsonb(jsonb) TO authenticated, service_role;` (no a `anon`, que no tiene INSERT sobre la tabla).
  2. `supabase/migrations/20261013100100_restrict_activity_logs_select_admin.sql`: reemplaza la policy de lectura `activity_logs_select_authenticated` (`USING (true)`) por `activity_logs_select_admin` con `(SELECT public.is_admin_user())`.
- **Evidencia (V, BD viva 2026-10-13)**: ACL de `redact_pii_jsonb` = `{postgres=X/postgres}`; el trigger `trg_activity_logs_redact_pii` está activo y su función no es `SECURITY DEFINER`; la policy de INSERT (`with_check true`) y el GRANT INSERT de `authenticated` estaban bien, así que el único bloqueo era el permiso de la función. Desde SEC-07 solo hay 6 logs nuevos, todos `product/product_deleted` por RPC.
- **Corrección al plan original**: el plan decía "Riesgo: nulo". **No lo era.** La policy de lectura permitía a cualquier cliente logueado leer todo el rastro (un `role='user'` veía las 40 filas). Arreglar solo el GRANT habría empezado a volcar montos, referencias de pago y emails de `performed_by` de pedidos y remesas a la vista de todos los clientes. Por eso se añadió la segunda migración. Único lector verificado: `ActivityLogTab` dentro de `DashboardPage` (ruta admin); los INSERT y el flush de la cola `localStorage` no leen de vuelta.
- **Test rojo → verde (ejecutado en la BD viva con bloques `DO` que terminan en `RAISE EXCEPTION`, sin persistir nada; verificado después: 0 filas de prueba, ACL sin cambios)**:
  - ROJO: INSERT como `authenticated` → `42501 permission denied for function redact_pii_jsonb`. Fuga: usuario normal ve 40 filas.
  - VERDE: tras el GRANT el INSERT funciona; `anon=false`, `authenticated=true`, `service_role=true`; la redacción enmascara emails en `description`, `metadata` anidada y arrays sin tocar números. Predicado de lectura `is_admin_user()`: usuario normal `false`, usuario deshabilitado `false`, admin `true`, super_admin `true`.
  - **No probado de forma directa**: la policy nueva ejecutada contra la tabla, porque la herramienta bloquea `DROP POLICY` sin confirmación (incluso dentro de un bloque que se revierte). Se validó el predicado, que es la única regla de lectura que queda al eliminar la policy vieja, y la sintaxis sigue el patrón ya aplicado en `20260118000002`.
- **Verificación post-apply (solo lectura)**: `has_function_privilege('authenticated','public.redact_pii_jsonb(jsonb)','EXECUTE')` = `true`; `anon` = `false`; en la UI, tras subir un comprobante de remesa, el tab Activity Log (admin) muestra entidad `remittance`; un usuario normal no puede leer `activity_logs` por la API. Correr también `admin-superadmin.spec.js` (Activity Log) contra el remoto ya migrado.
- **Riesgo**: (1) al aplicar, los navegadores con logs encolados en `localStorage` (hasta 100 por navegador) los repondrán solos, con fechas de repuesto y no de origen. (2) Si alguna vista no-admin leyera `activity_logs`, dejaría de verlo: se buscó y no existe. (3) Hipótesis sin confirmar: antes de SEC-07 tampoco hay logs de pedidos ni remesas en la tabla; puede deberse al reset de plataforma o a otra causa, así que PR-01 es necesario (probado) pero **no está demostrado que sea suficiente** para que aparezcan. Confirmarlo tras el `db push`.
- **No hacer**: no volver `SECURITY DEFINER` al trigger; sin backfill; sin tocar `activityLogger.js`.
- **Verificado tras aplicar (BD viva)**: ACL de `redact_pii_jsonb` = `{postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}`, `anon=false`. Lectura de `activity_logs`: usuario normal 0 filas, usuario deshabilitado 0, admin 40, super_admin 40 (esta fue la prueba directa de la policy que no se pudo hacer antes). INSERT como usuario normal OK con emails redactados (sonda revertida; 40 filas totales, sin residuos). `get_advisors(security)` sin hallazgos nuevos por este cambio.
- **Por qué NO `supabase db push`**: `supabase migration list` muestra 12 migraciones locales sin registro remoto y 16 remotas sin archivo local, porque el proyecto aplicó migraciones por conector (`apply_migration`) con versiones propias. Un `db push` intentaría reaplicar migraciones ya aplicadas (incluido el reset de plataforma). Regla para los próximos PR: aplicar con `apply_migration`, una migración por vez, y nunca `db push` hasta reconciliar el historial (`supabase migration repair`), que queda como tarea aparte. Las dos migraciones de PR-01 son idempotentes (GRANT y DROP IF EXISTS + CREATE), así que una reaplicación futura es inocua.
- **Nota operativa**: el primer intento de `apply_migration` con `DROP POLICY` devolvió `Invalid or expired requestState` (estado de confirmación vencido) y no aplicó nada; el reintento funcionó.
- **Rollback**: documentado en el encabezado de cada migración.

### PR-00 — El carrito debe cobrar lo que muestra el catálogo

> **Estado (2026-10-13)**: IMPLEMENTADO y commiteado en `fix/pr-00-cart-final-price` (`3c37a251`, sin push). Nuevo `src/lib/cartPricing.js` + rama de `final_price` (convertido a USD, 2 decimales) en `CartPage.jsx`; 19 tests nuevos, suite 92/92, build OK. Impacto en datos vivos: 41 de 69 productos con margen distinto de 40; 111 líneas de pedido coinciden con `base*1.40`; 18 de 22 órdenes con productos tienen alguna línea distinta del `final_price` actual (sobrecobrado USD 19.70, subcobrado USD 18.00). Los importes ya cobrados no se corrigen solos. Deuda fuera de alcance: `displayed_price` mezcla moneda seleccionada con subtotal USD; el servidor confía en precios del cliente (Corte 3); carritos viejos en localStorage sin `final_price` siguen en la fórmula legacy.
- **Objetivo**: que `CartPage.getItemPrice` use `final_price` para productos agregados desde el listado.
- **Evidencia (V)**: solo dos llamadores de `addToCart`: `ProductsPage.jsx:188` (producto crudo) y `ProductDetailPage.jsx:251` (inyecta `displayed_price`, `displayed_currency_id`, `displayed_currency_code`, líneas 241-248). `CartContext.jsx:37-46` guarda el objeto tal cual. `CartPage.jsx:84-116` cae en la rama legacy `base_price * (1 + financialSettings.productProfit || 40)` (líneas 109-113). Se cobra lo calculado en cliente: `CartPage.jsx:695` `unitPrice: getItemPrice(item)` → `orderService.js:343`; `CartPage.jsx:136` `totalAmount` → `orderService.js:307`. El catálogo muestra `final_price` (columna GENERATED) en `ProductsPage.jsx:285,305,446` (H: líneas no releídas en el cross-check).
- **Test rojo** (`src/tests/unit/CartPage.getItemPrice.test.jsx`): ítem de producto con `base_price=1`, `profit_margin=45`, `final_price=1.45`, `financialSettings.productProfit=40` → hoy da `1.40`, debe dar `1.45`. Segundo test: combo con `profitMargin` propio conserva su cálculo.
- **Implementación**: en `getItemPrice`, para productos (`!item.products`) usar `item.final_price` si es numérico válido; mantener la fórmula global solo como último recurso. Opcional: congelar `displayed_price` en `handleAddToCart` de `ProductsPage`.
- **Verificación**: `npm run test`; comparar catálogo vs carrito con un producto de margen ≠ global.
- **Riesgo**: ítems ya en `localStorage` sin `final_price` siguen en la rama legacy (aceptable, temporal).
- **No hacer**: no refactorizar `CartContext`; no tocar combos; no mover `financialSettings` (eso es PR-07).
- **Pausa**: ninguna (D5 resuelta: el carrito cobra `final_price`).

### PR-02 — Vaciar carrito (F7, obs. #7)

> **Estado (2026-10-13)**: IMPLEMENTADO y commiteado en `feat/pr-02-clear-cart` (`9380b8fd`, sin push), apilado sobre `fix/pr-00-cart-final-price`. Botón bajo "Finalizar compra", modal `danger`, claves `cart.clearAll.*`; 4 tests nuevos (`CartPage.clearCart.test.jsx`), suite 96/96. No se agregó `CartContext.test.jsx` (semántica de `clearCart` intacta).
- **Objetivo**: botón "Vaciar carrito" con confirmación en el panel resumen.
- **Evidencia**: `CartContext.jsx:69` ya expone `clearCart` (V). `CartPage.jsx` lo usa en `:819, :1256, :1261, :1480, :1485` (V). Sin acción de usuario hoy.
- **Test rojo**: `CartPage.clearCart.test.jsx` — el botón aparece solo con `view === 'cart' && cart.length > 0 && !showConfirmationModal`; al confirmar, el carrito queda vacío; cancelar no vacía. Consultar por rol/label, no asumir "clearCart llamado una vez". Mockear `getActiveShippingZones` y `convertCurrency`. Más `CartContext.test.jsx`.
- **Implementación**: usar `useModal().showModal({type:'danger'})`; claves `cart.clearAll.*` en ES/EN.
- **Riesgo**: nulo (semántica de `clearCart` intacta). Un cupón aplicado se descarta implícitamente.
- **No hacer**: sin undo, sin log, sin refactor de `CartPage`.

### PR-03 — Moneda del precio base (F1, obs. #1, #8, #10)
- **Objetivo**: que el formulario de producto convierta (no relabele) al cambiar de moneda, falle explícito sin tasa y muestre el simulador también en USD. USD es la única verdad almacenada.
- **Evidencia**: `VendorInventoryTab.jsx:309-326` `handleSubmitProduct`; el `catch` (:322-325) es código muerto porque `CurrencyContext.jsx:90-98` `getConversionRate` **nunca lanza y devuelve 1** (V). El `<select>` de moneda (~`:745-749`) y el simulador (`:134-169`, `:815-867`) son H. BD (V): `base_price numeric(10,2) NOT NULL`, `profit_margin numeric(5,2) NULL DEFAULT 40`; 20/68 productos sub-dólar (legítimos).
- **Test rojo** (`src/tests/unit/productPricing.test.js`, módulo nuevo y puro `src/lib/productPricing.js`): `normalizeBasePrice` rechaza `rate===1` entre monedas distintas y `rate` nulo, redondea a 2 decimales y acepta sub-dólar (`>= 0.01`); `validateMargin` acepta `0..999.99`. Luego `VendorInventoryTab.currency.test.jsx`: cambiar el selector convierte el número mostrado; guardar sin editar no redondea (conserva `originalBasePrice`/`originalCurrencyId`).
- **Implementación**: selector convierte el valor; hard-fail traducido sin tasa; confirmación (no bloqueo) si el USD normalizado < 0.10; segunda fila del simulador en USD; mapear el código `22003` en `src/lib/errorHandler.js` a un mensaje legible.
- **Verificación**: unit; manual crear/editar en CUP y reabrir (se ve en USD, con el equivalente CUP en el simulador); `productos-roles.spec.js`.
- **Riesgo**: se reescriben `handleProfitChange`/`handleBasePriceChange`; PR-11 depende de esta versión.
- **No hacer**: sin columnas `input_currency_id/input_price`; no tocar el fallback global de `CurrencyContext`; no tocar combos; sin CHECKs nuevos en `products`.
- **Pausa**: pedir el texto exacto del error de la obs. 1. Sin reproducirlo, **no** se afirma causa raíz (hipótesis H1: overflow `22003` si el margen ≥ 1000).

### PR-04 — Aviso al admin desde el cliente (F4-B, obs. #4)

> **Estado (2026-10-13)**: IMPLEMENTADO y commiteado en `feat/pr-04-remittance-admin-notice` (`7ae85945`, sin push), desde `origin/main` fresco (D8). `buildRemittanceProofMessage` puro en `whatsappService.js`; llamada duplicada eliminada de `SendRemittancePage`; `uploadPaymentProof(..., options.language)`; nuevo `NotifyAdminWhatsAppButton` (modal de confirmación + detalle en `MyRemittancesPage` con estado `payment_proof_uploaded`); 14 tests nuevos. `alert()` del notificador de remesas reemplazado por resultado `{opened, reason}` + toast en el botón. Pendiente: validar en móvil real (Safari iOS / Chrome Android). Deuda: queda un `alert()` en `notifyAdminNewPayment` (pedidos, `whatsappService.js` ~148), fuera de alcance; el `window.open` automático sigue tras `await`s y puede bloquearse, por eso el botón es la vía confiable; línea `📍` cambia de `N/A` a omitida cuando falta ubicación.
- **Objetivo**: un único punto de aviso, sin `alert()`, con un enlace explícito disparado por gesto de usuario.
- **Evidencia**: `remittanceService.js:1138-1157` notifica tras `await getFreshWhatsappRecipient()` (V); `SendRemittancePage.jsx:1327-1343` vuelve a llamar `notifyAdminNewPaymentProof` (V, doble `window.open` por una activación). Pedidos también abre WhatsApp tras `await`s y el cliente dice que **ese sí** avisa, así que "window.open tras await" **no discrimina** por sí solo. `whatsappService.js:484` usa `alert()` (H).
- **Test rojo**: `buildRemittanceProofMessage` puro (sin `window.open`) incluye ID, monto, destinatario y municipio; e2e: el enlace "Avisar al administrador por WhatsApp" existe en el modal de confirmación.
- **Implementación**: extraer el builder; eliminar la llamada duplicada de la página; `language` opcional en el servicio; enlace explícito en el modal y tras carga tardía en `MyRemittancesPage`; `alert()` → toast.
- **Riesgo**: con D1 este PR **es** la solución definitiva del aviso, no un parche transitorio: depende de que el cliente toque "Enviar" en WhatsApp. Por eso el enlace debe verse siempre: en el modal de confirmación, tras la carga tardía de comprobante y en el detalle de la remesa del propio cliente cuando el estado es `payment_proof_uploaded`. La causa raíz original del "no notifica" sigue **sin reproducirse**; validar en un móvil real (Safari iOS y Chrome Android) al cerrar el PR, como verificación final y no como bloqueo.
- **No hacer**: sin proveedor server-side (F4-C cerrado por D1); no resucitar `notify-order`.

### PR-05 — Teléfono del destinatario y municipio para el admin (F2, obs. #2)

> **Estado (2026-10-13)**: IMPLEMENTADO y commiteado en `feat/pr-05-recipient-contact-admin-view` (`13a2fb57`, sin push), apilado sobre `feat/pr-04-remittance-admin-notice`. `src/lib/recipientInfo.js` (`parseRecipientInfo` tolera doble codificación), `RecipientLocation.jsx`, gates `recipient_city` reemplazados, `ResponsiveTableWrapper` no abre el modal genérico con `onRowClick` (consumidores verificados: AdminOrdersTab, UserManagement, ZellePaymentHistoryTab, InventoryManagement; sin hueco en UserManagement porque su modal propio cubre <768px y el wrapper solo engancha clics bajo 768px), `OrderDetailsModal` (en `admin/modals/`) con clave corregida, teléfono y ubicación. 28 tests nuevos. Deuda: hooks tras `return null` en `OrderDetailsModal` (previa), clave `remittances.user.recipientCity` sin uso, sin prueba manual en navegador del modal de pedidos.
- **Objetivo**: mostrar teléfono y municipio de entrega en la vista admin de comprobantes de **pedidos** y **remesas**.
- **Evidencia**: `AdminRemittancesTab.jsx:951,1115` y `MyRemittancesPage.jsx:1020` gatean sobre `recipient_city`, columna que **no existe**; existen `recipient_province` y `recipient_municipality` (23/23 con municipio) (V). El bloque cash `:1126-1138` ya los muestra; la brecha real es la tarjeta de lista, tipos no-cash y la vista de usuario. En móvil `ResponsiveTableWrapper.jsx:84-88` abre el modal genérico **y** llama `onRowClick` (dos modales). `OrderDetailsModal.jsx:158` usa `remittances.paymentReferenceLabel`, clave inexistente; existen `remittances.admin.*` y `remittances.user.*` (`ES.json:339,438`) (V). `orders.recipient_info` está doblemente codificado (H).
- **Test rojo**: `parseRecipientInfo` (string JSON doble, objeto, null); con `onRowClick`, `ResponsiveTableWrapper` no abre el modal genérico.
- **Implementación**: reemplazar gates por `recipient_municipality || recipient_province`; suprimir el modal genérico si hay `onRowClick`; corregir la clave; añadir teléfono/municipio a `OrderDetailsModal`; línea `📍 municipio, provincia` en el builder de PR-04.
- **Verificación**: unit; `admin-superadmin.spec.js`; manual móvil (un solo modal). **Antes de editar `ResponsiveTableWrapper`**, `codegraph explore` de todos los que pasan `onRowClick` (p. ej. `AdminOrdersTab.jsx:865`, H) y un test de regresión por tabla.
- **No hacer**: sin columna `recipient_city`; sin normalizar `recipient_info` en BD; sin imagen embebida.

### PR-06a / PR-06b — Teléfono del pagador "Tu teléfono para contactarte" (F3, obs. #3)

> **Estado PR-06a (2026-10-13)**: IMPLEMENTADO y commiteado en `feat/pr-06a-payer-phone-remittances` (`8c4d228c`, sin push). Migración `supabase/migrations/20261013140000_add_payer_phone.sql` (idempotente; `orders.payer_phone text`, `remittances.payer_phone varchar(30)`, CHECK 7–30 tolerante a NULL) **escrita pero NO aplicada al remoto**: aplicar con `apply_migration` y tu "dale". Hasta aplicarla, subir un comprobante de remesa fallará en producción porque el UPDATE incluye `payer_phone`; desplegar el código solo después de aplicar la migración. `src/lib/payerPhone.js`, `PaymentProofForm` (props `requirePayerPhone`, `payerPhone`, `onPayerPhoneChange`), `uploadPaymentProof(..., {language, payerPhone})` valida antes del upload y no lo registra en `activity_logs`; línea 📞 en el mensaje de WhatsApp; vistas de detalle. Obligatorio también en reintentos. No se verificaron los grants remotos de `public.remittances` (no existen en el repo).
- **Objetivo**: campo obligatorio bajo el titular/empresa del comprobante, en remesas (06a) y pedidos (06b).
- **Evidencia**: `PaymentProofForm.jsx:41-45` usa diccionario inline (V); `userService.js:45-62` selecciona `phone`/`metadata` que no existen en `user_profiles` (deuda, no tocar); `design_checkout_atomic_transaction_corte3.md:1,47,90` propone un RPC `create_order` que reemplazaría `createOrder` (V).
- **Migración (06a)**: `orders.payer_phone text NULL`, `remittances.payer_phone varchar(30) NULL`, CHECK tolerante a NULL. Sin NOT NULL, sin backfill.
- **Test rojo**: `PaymentProofForm` no envía sin teléfono válido (reusar `isValidPhoneNumber`); `uploadPaymentProof(remittanceId, file, reference, notes, payerPhone)` persiste `payer_phone`; en 06b `CartPage` valida **antes** de `createOrder`, nunca dentro de `postCreationTasks`.
- **Implementación**: claves `paymentProof.payerPhone.*` en JSON y extensión del diccionario inline; WhatsApp y vistas admin muestran "Teléfono del pagador"; sin PII en `activity_logs`.
- **Riesgo**: si Corte 3 aterriza después, su RPC debe aceptar `p_payer_phone`.
- **No hacer**: sin backfill; sin teléfono en perfil; sin E.164 forzado.
> **Estado PR-06b (2026-10-13)**: IMPLEMENTADO y commiteado en `feat/pr-06b-payer-phone-orders` (`34e14454`, sin push). `CartPage` valida con `getPaymentConfirmationBlocker` (`src/lib/orderPayerPhone.js`) antes de `createOrder` y de subir el comprobante; `orderService.createOrder` y `uploadPaymentProof(file, orderId, userId, ref, {payerPhone})` validan y persisten `payer_phone` antes de tocar BD/storage (la firma sin options ahora lanza); `UserPanel` (reintento) lo exige; línea 📞 en WhatsApp de pedidos y en `OrderDetailsModal`; sin PII en `activity_logs`. **Orden de despliegue**: aplicar primero la migración `20261013140000_add_payer_phone.sql` (si no, `createOrder` falla al insertar). Sin tests de render de `CartPage`/`UserPanel` (solo helper + servicio): el orden validar-antes-de-createOrder no está forzado por un test. La rama no incluye PR-00 ni PR-02 (cambios en `CartPage.jsx` en otras ramas): al mergear habrá que resolver conflictos de `CartPage.jsx`.

- **Traspaso a Corte 3**: al implementarse el RPC `create_order` (hoy solo diseño), debe aceptar `p_payer_phone`; dejar la nota en `design_checkout_atomic_transaction_corte3.md`.
- **Pausa**: `db push` aparte (migración en 06a).

### PR-07 — Márgenes globales persistidos (F8-A, obs. #9)

> **Estado (2026-10-13)**: IMPLEMENTADO y commiteado en `feat/pr-07-global-margins-db` (`d72f3a8c`, sin push), desde `origin/main` fresco. Migración `20261013150000_f8_profit_margin_settings.sql` (BEGIN/COMMIT, idempotente): fila `default_combo_profit_margin`=35, policies `system_config_admin_update_margins`/`_insert_margins` (authenticated, `is_admin_user()`, solo las 2 claves), `product_categories.profit_margin numeric(5,2) NULL` + CHECK 0..999.99 (consumida por PR-11). **No aplicada al remoto: requiere tu "dale" y `apply_migration`.** Mientras tanto, guardar márgenes como admin falla con toast de error y la app sigue con valores de respaldo. `financialSettingsService`, `marginResolver`, `SettingsContext` (solo admins leen de BD; expone `applyMarginSettings`), `handleFinancialSave` real, handler huérfano de `SettingsPage.jsx` eliminado. Los no-admin y el carrito siguen con localStorage/40-35 (el carrito cobra `final_price`, PR-00). Sin re-precio.
- **Objetivo**: que "Ganancia producto" y "Ganancia combo" se guarden en BD, hoy `handleFinancialSave` solo muestra un toast.
- **Evidencia**: `SettingsPageFinancial.jsx:230-232` (V); `system_config` tiene `default_profit_margin` y policy SELECT, **sin policy UPDATE**; `authenticated` tiene GRANT; sin GRANT para `anon` (V).
- **Test rojo**: `financialSettingsService` persiste y lee ambas claves; `marginResolver` (producto > categoría > global); `SettingsContext` toma el valor de BD para admin.
- **Implementación**: migración con fila `default_combo_profit_margin` y policies `UPDATE`/`INSERT` key-scoped con `is_admin_user()`, **sin policy pública ni GRANT a anon**; borrar el handler huérfano de `SettingsPage.jsx:90-99` (H).
- **Riesgo**: `SettingsContext` lo consume todo el frontend; acotar a las dos claves.
- **No hacer**: sin re-precio masivo (sería frente aparte con RPC y confirm-word); no migrar `usdToLocal/currencies/shipping*`; no reutilizar la Edge Function `notification-settings` (rechazado en el plan).
- **Pausa**: `db push` aparte.

### PR-08 — Municipio gratis ⇒ provincia (F6-A, obs. #12)

> **Estado (2026-10-13)**: IMPLEMENTADO y commiteado en `feat/pr-08-shipping-zone-rules` (`371e39d9`, sin push), apilado sobre `feat/pr-06b-payer-phone-orders`. `src/lib/shippingZoneRules.js` (`isZoneAvailable`, `getSelectableProvinces`, `getShippingState`, `isShippingBlocked`, `isCashDeliveryBlocked`) con el dataset vivo; Camagüey ahora aparece (municipios $5/$6); Artemisa y La Habana (activas, 0, sin municipios) siguen sin ser seleccionables; Ciego de Ávila sin cambios de precio. `CartPage`: `shippingUnavailable` bloquea continuar/pagar y el `catch` ya no deja envío gratis silencioso; `SendRemittancePage`: bloquea solo entrega `cash`; `ProvinceSelector`/`RecipientSelector` adaptados. 43 tests nuevos. Riesgos: coincidencia exacta de nombres de provincia (un destinatario guardado con otra capitalización queda bloqueado en vez de recibir envío 0); si las zonas no cargaron, el checkout queda bloqueado hasta que lleguen; la carrera de respuestas async de `calculateShippingCost` sigue existiendo; una provincia sin fila propia no se lista (no ocurre en el dataset vivo).
- **Objetivo**: regla pura `getSelectableProvinces(zones)` aplicada en los dos filtros, y UI que **bloquea** el avance si la zona no está disponible.
- **Evidencia**: filtros `free_shipping === true || cost > 0` en `CartPage.jsx:213-217` y `SendRemittancePage.jsx:315-318` (V). `ProvinceSelector.jsx:25-32` nunca ve la fila provincial ya filtrada, así Camagüey **no aparece** (V, datos vivos: `Camagüey(-):0/false`, municipios `Camagüey:5`, `Guáimaro:6`). `CartPage.jsx:277-283` convierte cualquier error de `calculateShippingCost` en `setShippingCost(0)`, así lanzar error en el servicio no basta (V).
- **Test rojo**: `shippingZoneRules.test.js` con el dataset vivo; `CartPage.shipping.test.jsx` (provincia no disponible → botón deshabilitado y costo ≠ 0); `ProvinceSelector.test.jsx`.
- **Riesgo**: cambia qué provincias aparecen en checkout y remesas. Interpretación A anularía el cobro de 20 USD en municipios sin fila de Ciego de Ávila.
- **No hacer**: sin migración; no cambiar tarifas.
- **Pausa**: ninguna de diseño (D3 resuelta: interpretación B).

### PR-09 — Costo de entrega en remesas (F6-B, obs. #6)

> **Estado (2026-10-13)**: IMPLEMENTADO y commiteado en `feat/pr-09-remittance-delivery-cost` (`93cfc15b`, sin push). Migración `20261013160000_remittances_delivery_cost.sql` (aditiva: `delivery_cost numeric(12,2) NOT NULL DEFAULT 0` + CHECK, `shipping_zone_id` FK a `shipping_zones` ON DELETE SET NULL) **sin aplicar; el front debe desplegarse DESPUÉS de aplicarla**. `calcTotalToPay`, `createRemittance` valida zona y persiste costo, Zelle registra `amount_sent + delivery_cost`, fix `addressId`, UI/WhatsApp/admin con el total. **El trigger de protección de columnas de dinero NO se escribió**: el inventario (gate) encontró que `recalculateRemittanceAtCurrentRate` (`remittanceService.js:537`, botón del usuario en `MyRemittancesPage.jsx:139`) actualiza `exchange_rate`, `commission_*` y `amount_to_deliver` con la sesión del dueño; un trigger lo rompería. Opciones: (1) convertir el recálculo en RPC `SECURITY DEFINER` y luego agregar el guard; (2) guard más estrecho que permita solo el recálculo en estado `payment_pending`/`payment_rejected`. **Deuda de seguridad abierta**: la policy `users can update own remittances` no restringe columnas; el dueño puede cambiar `status`, `payment_validated`, `payment_validated_by` (auto-validar su pago) y los montos. Otras notas: `zelleService.js:937` reporta solo `amount_sent`; las vistas de usuario no muestran el costo de entrega; una remesa cash sin provincia ahora se rechaza.
- **Objetivo**: sumar el costo de entrega a lo que paga el remitente (solo `delivery_method='cash'`) y cerrar el UPDATE propio sobre columnas de dinero.
- **Evidencia**: `calculateRemittance`/`createRemittance` no consideran `shipping_zones` (V en la lectura previa de `createRemittance` de esta sesión; el resto H). `remittances` no tiene `delivery_cost` (V). La policy `users can update own remittances` no restringe columnas y `authenticated` tiene `UPDATE` (V). `SendRemittancePage.jsx:1066` usa `addresses?.[0]` e ignora `recipientData.addressId` (H).
- **Migración**: `delivery_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (>=0)`, `shipping_zone_id uuid NULL REFERENCES shipping_zones ON DELETE SET NULL`, y trigger `BEFORE UPDATE` (o REVOKE por columna) que rechaza cambios en `amount_sent, amount_to_deliver, delivery_cost, exchange_rate, commission_*` cuando `NOT is_admin_user()`. **Antes**, inventariar con `codegraph` los flujos que hoy actualizan esas columnas como usuario.
- **Test rojo**: `calcTotalToPay`; el total de `zelle_transactions` y lo que ve el admin = `amount_sent + delivery_cost`; sonda `BEGIN; SET ROLE authenticated; UPDATE remittances SET delivery_cost=0 ...; ROLLBACK;` debe fallar.
- **Riesgo**: `calcReverse` intacto (no descontar de `amount_to_deliver`). Si supera ~380 líneas, separar el trigger en PR-09a.
- **No hacer**: sin tarifas en `remittance_types`; sin columna generada `total_to_pay`; sin trigger que recalcule desde `shipping_zones`; sin backfill.
- **Pausa**: `db push` aparte; el inventario previo de flujos que actualizan columnas de dinero como usuario es obligatorio antes de escribir el trigger.

### PR-10 — Visibilidad de email/teléfono en cuentas Zelle (F5, obs. #5)
- **Objetivo**: toggles admin por cuenta (`show_email`, `show_phone`, con `CHECK (show_email OR show_phone)`).
- **Evidencia**: `zelle_accounts.email NOT NULL`, `phone NULL`; la policy `zelle_accounts_select_active` deja a cualquier `authenticated` leer la fila completa (V). `zelleService.js:172-176` hace `select('*')` en cliente (V). Gating actual en `ZelleAccountDisplay.jsx:63,74` y `ZelleAccountSelector.jsx:223,258,278` (H).
- **Decisión D7**: opción **D (datos)**. Flags independientes `show_email` y `show_phone` (ambos `boolean NOT NULL DEFAULT true`) editables por el admin por cuenta, con `CHECK (show_email OR show_phone)` como salvaguarda (con ambos ocultos el cliente no sabría adónde pagar). RPC `SECURITY DEFINER get_zelle_account_public(uuid)` que devuelve `id`, nombre/titular y `email` solo si `show_email`, `phone` solo si `show_phone`; `reserveZelleAccount` pasa a consumir esa forma. El SELECT directo de `authenticated` sobre `zelle_accounts` se restringe a admin **solo tras inventariar con `codegraph` todos los accesos cliente a la tabla**; si el inventario muestra uno no migrable, parar y reportar.
- **Test rojo**: validación "al menos uno visible"; en D, un usuario no admin no obtiene `email` con `show_email=false` (sonda con `SET ROLE authenticated`).
- **Riesgo (D)**: un `select` cliente no inventariado rompe el checkout Zelle.
- **No hacer**: sin visibilidad por flujo; no ocultar en vistas admin; sin setting global.
- **Pausa**: `db push` aparte; commitear o fusionar antes los cambios locales de `zelleService.js` (D8).

### PR-11 — Margen por categoría (F8-B, obs. #11)
- **Objetivo**: `product_categories.profit_margin numeric(5,2) NULL CHECK (profit_margin >= 0 AND profit_margin <= 999.99)`; precarga del formulario de producto con precedencia producto > categoría > global, mostrando la fuente del valor.
- **Evidencia (V)**: `products.profit_margin` es **NULLABLE DEFAULT 40** (0/68 en NULL) y `final_price` es GENERATED; por eso **no** se usa `IS NULL` como "hereda". `useProfitMargin.js:29-43` ignora `categoryId`, pero esa cadena no se renderiza en `ProductsPage` (H).
- **Test rojo**: `productService.categories` (create/updateCategory con margen), `VendorInventoryTab.margin` (`getEffectiveMargin`, `marginTouched`), y un test que documenta el comportamiento con `profit_margin IS NULL`.
- **Implementación**: reutilizar `validateMargin` de PR-03; la migración de columna viaja con PR-07.
- **No hacer**: sin re-precio masivo; sin herencia por `parent_id`; no borrar la cadena muerta `useProfitMargin`.

### F4-C — Aviso server-side (CERRADO por D1)
- **Estado**: el usuario decidió quedarse con el enlace manual de WhatsApp. No hay proveedor, secretos ni Edge Function nueva. Si en el futuro se reabre, requerirá elegir proveedor (Resend, WhatsApp Cloud API con cuenta Business verificada, o inbox en la app) y gestionar credenciales.
- **Consecuencia**: la fiabilidad del aviso descansa en PR-01 (registro de actividad, el admin también ve la remesa en su panel) y PR-04 (enlace siempre visible).

---

## 5. Deuda registrada fuera de alcance (no asignar etapa)
`userService.getUserById` selecciona columnas inexistentes · `orders.recipient_info` doblemente codificado · fallback 1:1 global en `CurrencyContext.jsx:90-98` · el servidor confía en precios/totales calculados en el cliente (lo cierra Corte 3) · `notify-order` y ruta Resend muertas · cadena muerta `useProfitMargin` · `products` sin CHECK de no negativos · el PAT filtrado de Supabase en el historial de git (diferido por el usuario).

## 6. Instrucción para el agente que ejecuta un PR

> Recuperá contexto (`mem_context`, `mem_search "strategic-plan client-observations"`). Leé el plan completo y **solo** la fila y el prompt del PR que te toca. Si algún estado figura como BLOQUEADO, no implementes: hacé la pregunta exacta y detenete. Las preguntas de la columna "Pregunta aún abierta" que traen un supuesto se siguen con ese supuesto declarado; las que no lo traen (texto del error de la obs. 1) se hacen al usuario antes de tocar ese sub-ítem. Si está LISTO: creá la rama, escribí primero el test rojo y mostrá su salida, implementá lo mínimo, corré `npm run test`, verificá con la sección de Verificación, aplicá la regla de corrección tras cada archivo, y no hagas commit ni `db push` sin pedido explícito. Cerrá con la traza en `TRACKING_PROGRESS.md` y `mem_save`. Todo hueco de información se marca `REQUIERE CONFIRMACIÓN DEL USUARIO`; nunca se infiere.
