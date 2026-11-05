# Plan F2 — Endurecimiento financiero del cliente (rama `fix/financial-client-hardening`)

Origen: `.claude/docs/audit-report-financiero-monedas-2026-11-04.md` (Fase 2) y detalle frontend (A1–A11).
Alcance: solo código cliente + i18n. Sin BD, sin migraciones, sin cambiar fórmulas de remesa ni la regla `rate >= market_rate`.
Pedidos de hoy (USD, Zelle) y remesas USD→CUP / USD→USD no deben cambiar de comportamiento.

## Especificación (criterios de aceptación)

### A1 — Tasa de remesa fail-closed
- A1.1 `getRemittanceExchangeRate(from, to, typeRate)`: misma moneda -> `{rate:1, source:'configured'}` (sin consultar nada).
- A1.2 Precedencia (sin cambios): `typeRate > 0` gana -> `{rate:typeRate, source:'type'}` y NO consulta `exchange_rates`. Se corrigen los comentarios que decían lo contrario (L220-222, L689-690).
- A1.3 Sin `typeRate` válido: usa `exchange_rates` (directa) -> `{rate, source:'configured'}`.
- A1.4 Sin tasa válida (null/0/NaN/negativa) o error al consultar: lanza `AppError` con `code === ERROR_CODES.EXCHANGE_RATE_UNAVAILABLE`, `context.from/to`. NUNCA devuelve `rate: 1` ni `typeRate || 1`.
- A1.5 `calculateReverseRemittance` pasa `type.exchange_rate` crudo (sin `|| 1`): con tasa nula usa la central; sin central lanza el error tipado.
- A1.6 `calculateRemittance`, `calculateReverseRemittance` y `createRemittance` propagan el error tipado (no insertan nada).
- A1.7 UI (`SendRemittancePage`): un tipo sin tasa se marca `rateUnavailable`, se muestra un aviso claro (i18n ES/EN, usted) y no se calcula con tasa 1; los toasts de calcular/crear muestran el mensaje i18n cuando `error.code === EXCHANGE_RATE_UNAVAILABLE`. Sin `|| 1` ni división sin guarda (`handleAmountChange`, `handleDesiredReceiveChange`, `handleSelectType`).
- A1.8 `createRemittance` (payload real): envía `exchange_rate`, `currency_sent/delivered`, `commission_*`, `amount_to_deliver` del cálculo; sin `offer_id` no envía `discount_amount`.

### A3 — Zona horaria única (America/New_York)
- A3.1 `getMarginSummary(now)`: `p_from`/`p_to` = inicio del mes y del mes siguiente en `America/New_York` (independiente de `process.env.TZ`). Vector: `now = 2026-12-01T04:30Z` (30-nov 23:30 NY) bajo `Asia/Tokyo` y `Europe/Madrid` -> `from = 2026-11-01T04:00:00.000Z`, `to = 2026-12-01T05:00:00.000Z` (cruce de DST incluido).
- A3.2 Fallback de `getZelleAccountUsageSummary` (RPC falla): ventanas día/mes en `America/New_York` vía `getBusinessWindows`. El `computedError` deja de ser silencioso (se registra con `logError`).

### A5 — Pares de tasas consistentes (sin BD)
- A5.1 `saveExchangeRatePair({fromCurrencyId,toCurrencyId,rate,effectiveDate})` en `currencyService`: guarda directa y luego inversa (`1/rate`); si la inversa falla, revierte la directa (borra la fila que acaba de crear/restaura la previa) y lanza error; en cualquier desenlace con escritura parcial llama `notifyRatesChanged()`. `SettingsPageFinancial.handleSaveRate` lo usa; si falla no muestra "guardado" y recarga el estado real.
- A5.2 `updateExchangeRatePair`: si falla la inversa tras actualizar la directa, restaura la directa a su valor/fecha previos (leídos antes), notifica el cambio y lanza el error.
- A5.3 Confirmación de cambio >5 % (`requiresChangeConfirmation`) aplica a cualquier par al editar (no solo USD/EUR). La banda dura para USD→CUP NO se inventa: decisión del dueño (se documenta). Mensaje de confirmación genérico (par, no "USD a EUR/Bizum").
- A5.4 `deleteExchangeRatePair` valida UUID de ambos ids antes de interpolar en `.or()`; ids no-UUID -> error de validación sin llamar a la BD.
- Diferido a F3: atomicidad real = RPC `set_exchange_rate_pair` (SECURITY DEFINER, una transacción).

### A6 — Conversores fail-closed
- A6.1 `CurrencyContext.convertAmount`: `NaN` -> `NaN` (no 0); `0/null/undefined` -> 0; id de moneda faltante -> `NaN` (no el monto sin convertir); ids iguales -> monto.
- A6.2 `displayCurrency(NaN)` y `formatCurrency(NaN)` -> `—` (UNAVAILABLE), nunca `$0.00`. `null/undefined` siguen siendo `0.00`.
- A6.3 `console.error` de `CurrencyContext` -> `logError` (logger del proyecto).
- A6.4 `comboUtils.convertWithRates(amount, fromId, toId, rates)` (puro): sin tasa devuelve `NaN`; `VendorCombosTab.convertPrice` lo usa; `computeComboPricing` devuelve precios `NaN` si un componente no es convertible (no usa el monto crudo) y la UI muestra `—`.
- A6.5 `comboService.createCombo/updateCombo`: si algún componente tiene `base_currency_id` distinta de la moneda base (null = base) lanza error de validación y no escribe (combos solo admiten componentes en moneda base; convertir es decisión F4).

### A7 — Alerta de cambio de tasa (MyRemittancesPage)
- A7.1 Helper puro `quoteRateChange(remittance)` (`src/lib/remittanceRateChange.js`) que usa `calcForward` (contrato único): tasa nueva = `remittance_types.exchange_rate`; comisión del tipo; descuento = `remittance.discount_amount` como `fixed_amount` (espejo de `_remittance_discount_source` cuando la oferta no está cargada). Devuelve `null` si tasa snapshot o actual no son > 0 (guarda de división).
- A7.2 Vectores dorados (`remittanceGoldenVectors.json`, forward) coinciden con `quoteRateChange` con y sin oferta.
- A7.3 La alerta formatea tasas con `formatRate` y montos con `formatMoney` (no `toFixed(2)`), `pctChange` con 2 decimales numéricos.
- Limitación documentada: una comisión sobrescrita por admin (override) no es visible para el cliente; el RPC es la fuente de verdad.

### A9 — `commission_percentage` derivado
- A9.1 `calcCommissionFromRates(market, delivery)` (puro, exportado desde `remittanceCalculations`) redondea a 2 decimales: 520/500 -> 3.85. (Corregido en la revisión: `remittance_types.commission_percentage` es `numeric(20,10)`; solo `remittances.commission_percentage` es `numeric(5,2)`. La premisa original de escala era falsa para esta tabla.)
- A9.2 `RemittanceTypesConfig` recalcula la comisión SOLO cuando el usuario cambia la tasa de mercado o la de entrega (nunca al abrir el formulario de edición: editar solo el nombre/límites/is_active conserva el valor almacenado con precisión completa). Al cambiar tasas guarda el valor redondeado y muestra la tasa de entrega efectiva (`market * (1 - pct/100)`, 2 dec.) para que el admin vea lo que realmente se aplicará.

## Diferido / fuera de alcance (documentado)
- A2 (cliente fija montos; `passedDiscountAmount`), A4 (6 decimales en inversa), A8 (umbrales de edad USD→CUP), A10 `computeComboPricing` redondeo, A11 (Edge Function), banda dura USD→CUP, RPC de par atómico, fórmulas de remesa, guards BD.
