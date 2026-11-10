# Plan: modelo de ganancia de remesas (spread de tasa + costo de mensajera + cargo de entrega)

Estado: DISEÑO. Nada implementado, nada aplicado a Supabase. Base: origin/main 51e18bf9. Lecturas a prod: solo agregados (2026-10-23).

> **Costo de mensajeria por quien entrega: seccion 11 (reemplaza courier_fee_schedule de 9.5 y la etapa E5 de 10.7).** > **DECISION FINAL del dueño: leer la seccion 10 (reemplaza 3, 5 y 9.5).** Antes: actualizacion WhatsApp, seccion 9. Reemplaza la recomendacion de las secciones 3 y 5 donde difiera: el spread extra queda descartado (E4 cancelada), el 0.50 USD tiene dos lecturas (pregunta #1) y la comision efectiva NO puede subir por competencia.

## 0. Requisito del cliente (audio ~73 s, transcripción aproximada)

Ganancia = diferencia entre la tasa a la que el dueño "la coge" y la tasa a la que "la vende" (ej. 830 vs 810, cifras dudosas) + a veces un % de esa ganancia va a la mensajera. En envíos < 50 USD (umbral dudoso) la mensajera cobra ~200 CUP y el cliente solo paga ~0.50 USD. "No sé cómo se pudiera hacer eso."

## 1. Estado actual (evidencia)

### 1.1 Cómo se calcula hoy
| Concepto | Dónde | Hecho |
|---|---|---|
| Tasa de venta | `remittance_types.exchange_rate` (autoritativa si > 0) y, solo si falta, `exchange_rates` | `src/lib/remittanceService.js:233-247` |
| Tasa de COSTO / spread | NO EXISTE. Ni tabla ni columna. `remittance_services.profit_margin` existe pero tiene 0 filas y ningún caller | prod: `remittance_services` = 0 filas |
| Comisión | `calcForward`: `gross = round(S*pct/100 + fixed)`, descuento de oferta, override admin (`admin_set_remittance_commission`) | `src/lib/remittanceCalculations.js:34-50`; gemelo SQL `_remittance_quote` (`20261023100000_...sql:43`) |
| Pago a destinatario | `amount_to_deliver = round((S - commission) * round(rate,4), 2)` | `remittanceCalculations.js:13` |
| `delivery_cost` | `calculateShippingCost` => `zone.shipping_cost` (o 0 si `free_shipping`). Plano por zona/municipio, NO depende del monto. Lo calcula el CLIENTE y lo inserta | `shippingService.js:278-300`, `remittanceService.js:962-977, 1026` |
| `transport_cost` | `shipping_zones.transport_cost`, USD (no CUP), copiado en snapshot a `remittance_courier_costs.amount_usd` (AFTER INSERT, NULL si <=0) | `20261027100000_remittance_courier_costs.sql` |
| Dashboard | `netIncome = orderProfit + commission + delivery_cost - courierCost`; courier solo donde hay snapshot | `dashboardMetrics.js:253-260` |
| Checkout | muestra `deliveryCost` en el desglose y `calcTotalToPay` = S + delivery_cost | `SendRemittancePage.jsx:479,1237`, `remittanceCalculations.js:107` |

### 1.2 Hallazgo clave: el spread YA esta dentro de la comision
Tipo "Dolares a CUP (Efectivo)": `exchange_rate = 830`, `commission_percentage = 2.4096385542` = **20/830 exacto**. Resultado: el destinatario recibe `830 * (1 - 20/830) = 810 CUP por USD`. Es decir "8.30 publicado / 8.10 pagado" del audio es hoy la comision (2.41%), no un spread aparte. Igual para los otros tipos: 5.5555555556 = 50/900, 4.7619047619 = 5/105. La tasa de costo real del dueno (a cuanto compra CUP) NO esta guardada en ningun lado; el sistema asume implicitamente costo = tasa publicada (C = R).
Consecuencia: **agregar un "spread" encima de la comision sin aclarar esto DUPLICA la ganancia en los reportes.** El modelo propuesto lo hace explicito: `spread_usd = (S - comm) - amount_to_deliver / C`, con C = tasa de costo vigente; si C = R el spread es 0 y nada cambia.

### 1.3 Prod (agregados, 2026-10-23)
- remittances: 27 (5 completadas/entregadas), primera 2026-09-10. Tasas distintas usadas: 10 (min 1.0 = pruebas, max 830).
- Distribucion amount_sent: <50 USD = 2 (ambas 40), =50 -> 1, 100-200 -> 22 (media 114.57), 200-500 -> 1 (257.30), >500 -> 1 (765). Es decir **7.4% del volumen en cantidad esta bajo 50**.
- `delivery_cost > 0`: **0 de 27**. Con zona (`shipping_zone_id`): 4, todas en municipios con `free_shipping = true` (cargo 0, transport 0). Snapshot `remittance_courier_costs`: 1 fila (amount NULL). `order_courier_costs`: 2 filas.
- remittance_types activos: Efectivo CUP (830, 2.4096%, fijo 0, min 20, max 3000, cash) y USD->USD cash (105, 4.7619%, min 20, max 1000). Inactivos: transferencia CUP (900, 5.5556%) y USD transferencia.
- exchange_rates activa USD->CUP 830 (2026-10-22); historial 500 -> 405 -> 430 -> 830 en 10 meses (volatilidad: obliga a snapshot de tasas).
- shipping_zones: 26 filas (14 activas, 10 con municipio, 1 free). `shipping_cost` 0..35 USD (media 6.69), `transport_cost` 0..6 USD (media 0.58), 6 filas con transport > 0. Pares (shipping, transport): (15,1.00)x2, (25,1.10), (25,1.00), (5,5.00), (6,6.00), (10,0), (18,0), (20,0), (35,0), 16 en (0,0). Ojo: una zona cobra 35 USD y otra 18-25 USD de "envio", montos pensados para PEDIDOS; aplicados a una remesa de 20 USD serian un cargo absurdo (no hay tope ni escalon por monto).
- Servidor NO valida `delivery_cost` (verificado en prod): ningun trigger BEFORE INSERT de `remittances` (guard_payment_method_enabled, guard_remittance_offer_id, guard_remittance_owner_insert, guard_remittance_pricing, guard_reset_lock_remittances, trigger_generate_remittance_number) menciona `delivery_cost` en su `prosrc`. Un cliente manipulado puede insertar `delivery_cost = 0`.

## 2. Economia por remesa

Formula (USD): `ganancia = commission + spread + delivery_cost - courier_cost`, con
- `commission = round(S*2.4096385542%, 2)` (prod actual, cash CUP),
- `spread = round((S - commission) - amount_to_deliver / C, 2)`,
- `courier_cost = round(fee_CUP / fx, 2) [+ pct * (commission + spread + delivery_cost)]`.
Tipo de cambio para convertir CUP->USD: 830 (exchange_rates USD->CUP activa, 2026-10-22). Si el cliente confirma otra tasa de costo (C), usar esa.

### 2.0 Valores REALES de prod (pares shipping_cost / transport_cost de `shipping_zones`, comision 2.41%, C = R)
Hoy `delivery_cost = shipping_cost` y el costo = `transport_cost` (ambos en USD, sin importar el monto):
| zona (cargo / transporte) | S=20 | S=30 | S=50 | S=100 | total a pagar con S=20 |
|---|---|---|---|---|---|
| (15 / 1.00) | 14.48 | 14.72 | 15.20 | 16.41 | 35.00 (cargo = 75% del envio) |
| (25 / 1.10) | 24.38 | 24.62 | 25.10 | 26.31 | 45.00 |
| (5 / 5.00) | 0.48 | 0.72 | 1.20 | 2.41 | 25.00 |
| (6 / 6.00) | 0.48 | 0.72 | 1.20 | 2.41 | 26.00 |
| (35 / 0 = sin tarifa cargada) | 35.48 (costo no registrado) | 35.72 | 36.20 | 37.41 | 55.00 (cargo = 175%) |
Lectura: (1) con zonas de pago, una remesa de 20 USD pagaria 5-35 USD de "entrega", un cargo pensado para pedidos y no para remesas (hoy ninguna remesa lo paga porque las 4 con zona son `free_shipping`); (2) `transport_cost` real = 1-6 USD (~830-4980 CUP), muy por encima de los 200 CUP del audio, o sea esos valores NO son la tarifa de la mensajera de remesas. Es la evidencia mas fuerte para ND-6 (desacoplar).

### 2.0b Regla LITERAL del audio (hipotesis principal)
Dos regimenes: (A) S < 50: mensajera cobra 200 CUP fijos, cliente paga 0.50 USD de entrega; (B) S >= 50: mensajera cobra un % de la ganancia. Ejemplo (C = R, 830):
- A, S=30: 0.72 (comision) + 0.50 - 0.24 (200 CUP) = **0.98 USD**; S=20: 0.74.
- B con 30%, S=100, sin cargo: ganancia bruta 2.41 -> mensajera 0.72 -> neta **1.69 USD**; S=50: 1.20 -> 0.36 -> 0.84.
Es rentable en ambos. La duda del dueno ("no se como se pudiera hacer eso") es entonces, muy probablemente, COMO CONFIGURAR esta regla en el sistema, no una perdida. Modelo: tabla de tramos del cliente (A: 0.50, B: 0) + `courier_fee_schedule` con `fee_cup = 200, share_pct = 0` para el tramo A y `fee_cup = 0, share_pct = 30` para el B. Se soporta ademas combinacion fijo + %.

### 2.1 Escenario audio: mensajera 200 CUP (= 0.24 USD a 830), C = R (spread 0)
| S (USD) | comision | cargo entrega 0 -> ganancia | cargo 0.50 -> ganancia |
|---|---|---|---|
| 20 | 0.48 | 0.24 | 0.74 |
| 30 | 0.72 | 0.48 | 0.98 |
| 50 | 1.20 | 0.96 | 1.46 |
| 100 | 2.41 | 2.17 | 2.67 |
Con 200 CUP el negocio nunca pierde en cash (min 20 USD): punto de equilibrio = 0.24/0.024096 = **10.0 USD** < min_amount 20. Con este dato no hay perdida; la pregunta del dueno es de configuracion (2.0b). Si en realidad hubiera perdida, la cifra o el umbral serian otros (sensibilidad 2.3).

### 2.2 Sensibilidad a la tasa de costo C (S=20/30/50/100, cargo 0, courier 200 CUP)
Con C = 840 (compra 10 CUP mejor que la tasa publicada): spread = (S-comm)*(1-830/840) = 0.23 / 0.35 / 0.58 / 1.16 -> ganancia 0.47 / 0.83 / 1.54 / 3.33. Un spread de solo 1.2% casi duplica la ganancia de las remesas chicas y supera al costo de mensajera: el spread es el dato que mas pesa. Con C < R el spread es negativo (perdida).

### 2.3 Sensibilidad (escenario alternativo): equilibrio segun costo de mensajera (comision 2.41%, C = R, sin cargo de entrega)
| mensajera | USD (830) | S de equilibrio |
|---|---|---|
| 200 CUP | 0.24 | 10 USD |
| 500 CUP | 0.60 | 25 USD |
| 1000 CUP | 1.20 | **50 USD** |
| 2000 CUP | 2.41 | 100 USD |
Ejemplo mensajera 1000 CUP + cargo 0.50: S=20 -> 0.48+0.50-1.20 = **-0.22**; S=30 -> +0.02; S=50 -> +0.50; S=100 -> +1.71. Solo SI el umbral de 50 fuese un punto de equilibrio, implicaria una mensajera de ~1000 CUP; es una hipotesis secundaria, no la lectura principal (ver 2.0b).
Modalidad "% de la ganancia" (30% de comision+cargo): S=20, cargo 0.50: ganancia bruta 0.98, mensajera 0.29, neta 0.69. Siempre positiva (el riesgo se traslada a la mensajera) pero variable para ella.

## 3. Opciones y recomendacion

| Opcion | Pro | Contra |
|---|---|---|
| a) cargo de entrega escalonado por monto y zona (cliente) | transparente, ya hay columna `delivery_cost` y campo en Dashboard; resuelve remesas chicas | requiere tabla de tramos + validacion servidor |
| b) comision minima / fija por tramo | cero tablas nuevas (`commission_fixed` ya existe) | cobra "a ciegas" a todos; mezcla comision y entrega en reportes; sube la comision efectiva de >50 |
| c) monto minimo para cash | ya existe `remittance_types.min_amount` (20) | pierde clientes; no resuelve 20-49 |
| d) % de ganancia a mensajera | alinea incentivos, nunca pierde | requiere registrar % por tramo; la mensajera cobra variable |
| e) tarifa mensajera fija en CUP convertida con tasa snapshot | refleja el costo real (la mensajera cobra CUP); la tasa varia mucho (430 -> 830) | requiere fx de costo + snapshot |

**Recomendacion (a + e, con d opcional por tramo):**
1. Cliente: `remittance_delivery_fee_tiers` (publica, no sensible): por zona opcional y tramo de monto -> cargo USD. Ej.: 20-49.99 -> 0.50 (a validar), >=50 -> 0 (o el de la zona). Se muestra el desglose ANTES de pagar: "Enviado / Cargo de entrega / Total a pagar" y se agrega a Terminos.
2. Interno (solo admin): `courier_fee_schedule`: fee fijo en CUP por entrega (+ `share_pct` opcional de la ganancia) por tramo/zona; se convierte a USD con la tasa USD/CUP vigente al crear la remesa y se congela en snapshot.
3. Spread (SOLO si Q1 confirma una tasa de compra distinta de la publicada; etapa E4): `fx_cost_rates` (solo super_admin) con vigencia; el snapshot guarda C usada y `spread_usd`. Default C = R (spread 0) hasta que el dueno cargue su costo.
4. Alerta, no bloqueo: el Dashboard marca remesas con ganancia < 0 (conteo + monto) para decidir ajustes; el cliente nunca ve costos ni margen. `min_amount` se mantiene como palanca (c) sin codigo.
No recomendado: (b) como solucion principal.

## 4. Seguridad

### 4.1 Quien lee hoy (prod, verificado)
| Dato | Superficie | Lectura |
|---|---|---|
| `shipping_zones.transport_cost` | grants por columna: anon SELECT, authenticated SELECT/INSERT/UPDATE; policy `shipping_zones_select` = `true` para `public` | **C1 confirmado en vivo**: cualquiera con la anon key lee el costo de transporte. Cierre preparado y NO aplicado: `supabase/contract/20261016160100_phase0b_contract_revoke_cost_columns.sql`; lectura admin ya por RPC `admin_list_shipping_zone_costs` (`20261016160000_...:199`) |
| `exchange_rates.rate`, `remittance_types.exchange_rate/commission_*` | anon SELECT, SELECT policy `true` / is_active | Publico por diseno (el cliente ve la tasa y comision). **Aqui NO se debe guardar la tasa de costo.** |
| `remittance_courier_costs` | RLS + SELECT policy `is_admin_user()`; sin INSERT/UPDATE/DELETE | correcto (admin-only) |
| `remittances` (owner) | el dueno de la fila lee todas las columnas | NO agregar columnas de costo/spread/mensajera a `remittances` |
| `remittance_services.profit_margin/fee_percent` | 0 filas, `authenticated` SELECT | tabla muerta; la cierra el contrato B |
| `delivery_cost` | lo envia el cliente, servidor no lo valida | falla de integridad (1.3) |

### 4.2 Modelo seguro propuesto
- Tablas nuevas con `ENABLE RLS`, `REVOKE ALL FROM PUBLIC, anon, authenticated`, y un unico `GRANT SELECT` + policy segun nivel:
  - `fx_cost_rates(id, pair text CHECK ('USD/CUP'), cost_rate numeric(12,4) CHECK (>0), valid_from timestamptz, valid_to timestamptz NULL, created_by, reason text NOT NULL)`: append-only (sin UPDATE/DELETE), vigencia sin solape (EXCLUDE con btree_gist o RPC que cierra la anterior), **SELECT solo super_admin** (policy `is_super_admin()`), escritura SOLO por RPC `admin_set_fx_cost_rate` (SECURITY DEFINER, re-verifica `is_super_admin()`, `pg_advisory_xact_lock`, audita en `financial_audit_log`; patron de `20261023120000_remittance_commission_override.sql:121`).
  - `courier_fee_schedule(id, shipping_zone_id NULL, min_amount_usd, max_amount_usd NULL, fee_cup numeric(12,2) CHECK (>=0), share_pct numeric(5,2) CHECK (0..100), valid_from, valid_to, is_active)`: SELECT `is_admin_user()`, escritura por RPC admin (super_admin si se quiere separar). CHECK `max > min`.
  - `remittance_delivery_fee_tiers(...)`: lectura publica (es lo que paga el cliente); escritura admin por RPC.
  - `remittance_spread_snapshots(remittance_id PK/FK CASCADE, sell_rate, cost_rate, spread_usd, courier_fee_cup, courier_fx, courier_share_usd, schedule_id, computed_at)`: SELECT solo super_admin. Los datos de mensajera por remesa van en columnas nuevas de `remittance_courier_costs` (admin, ya existente) para no tocar el Dashboard actual: `fee_cup`, `fx_used`, `share_usd`; `amount_usd` pasa a ser el total.
- Calculo siempre en servidor: se extiende `snapshot_remittance_courier_cost()` (AFTER INSERT, SECURITY DEFINER, `search_path = public, pg_temp`, ya traga errores con WARNING) para resolver fee_schedule + fx_cost_rates con `now()` y escribir los snapshots; no se confia en nada del cliente. La historia NO se reescribe: no hay backfill, cambiar tarifas solo afecta remesas futuras.
- `delivery_cost` validado: trigger BEFORE INSERT `guard_remittance_delivery_fee` (o dentro del futuro `create_remittance` F4a) que recalcula el cargo desde `remittance_delivery_fee_tiers` y, con kill switch `off|warn|block` en `system_config` (como S2), registra en `price_integrity_flags` o rechaza si `delivery_cost` < esperado. Sale en `warn`, pasa a `block` tras observar.
- Redondeo coherente con W4: todo `round(numeric, 2)` half-up en SQL; tasas a 4 dp; CUP->USD = `round(fee_cup / fx, 2)`; `spread_usd` se deriva de valores YA almacenados (`amount_sent`, `commission_total`, `amount_to_deliver`); con C = R el residuo es < 0.01 y no se acumula. El gemelo JS (solo para simulador admin) usa `roundMoney` de `moneyPure`. Vectores dorados nuevos en `src/tests/fixtures/` para spread/courier.
- CHECKs: todos los montos >= 0 salvo `spread_usd` (puede ser negativo); `fee_cup`, `cost_rate`, `share_pct` acotados; sin `RETURNING *` hacia clientes.
- Quien ve que:
  | Dato | cliente | admin | super_admin |
  |---|---|---|---|
  | tasa publicada, comision, cargo de entrega, total | si | si | si |
  | costo de mensajera por remesa (fee CUP, USD) | no | si (ya hoy) | si |
  | tasa de costo, spread, ganancia neta con spread | no | no (ND-5) | si |
- Dashboard sin filtrar costos: RPC `admin_remittance_profit_totals(p_from, p_to)` SECURITY DEFINER devuelve SOLO agregados por ventana (commission, delivery, courier; y spread+net solo si `is_super_admin()`, NULL si no). El front deja de hacer SELECT de tablas de costo para el calculo; `dashboardMetrics.computeHeadline` recibe `remittanceSpread` y suma. Conteo de "remesas con ganancia < 0" tambien agregado (sin ids de cliente).
- Prerrequisito: cerrar C1 (contrato B) antes o junto con esto; mientras `transport_cost` sea publico, el costo de mensajera "por zona" tambien lo es. Mitigacion: el costo real de remesas vive en `courier_fee_schedule` (privada), no en `shipping_zones`.

## 5. Plan por etapas (TDD, una etapa = una rama/PR; nada se aplica a prod sin "dale" separado)

Cada etapa: test rojo -> migracion -> verde -> `/correction-protocol` -> actualizar TRACKING_PROGRESS.md. Migraciones con `BEGIN; SET LOCAL lock_timeout`, idempotentes, rollback en `supabase/rollbacks/*_down.sql`, probadas up/down/up en el harness (`src/tests/concurrency/`).

| # | Timestamp | Contenido | Tests primero |
|---|---|---|---|
| E0 | - | Respuestas del cliente (seccion 7) y ND-1..8 | - |
| E1 | 20261030100000 `remittance_delivery_fee_tiers` | tabla publica + `quote_remittance_delivery_fee()` + guard BEFORE INSERT en modo `warn` (trigger nuevo `guard_remittance_delivery_fee`, kill switch en `system_config` como S2) | quote vs golden; insert con cargo 0 -> flag en warn, rechazo en block; kill switch |
| E2 | 20261030110000 `courier_fee_schedule` | tabla + RPC admin + resolver `_courier_fee_resolve(zone, amount, at)`; columnas `fee_cup`, `fx_used`, `share_usd` en `remittance_courier_costs` + `CREATE OR REPLACE snapshot_remittance_courier_cost()` | precedencia zona > default; tramos sin hueco/solape; vigencia; golden 2.0b (A y B); cambio posterior del schedule no altera el snapshot; falla interna no rompe INSERT; RLS por rol |
| E3 | front + 20261030120000 `admin_remittance_profit_totals` | RPC agregada, `courierCostService`/`dashboardMetrics`, pantalla admin de tarifa de mensajera, desglose en wizard (cargo escalonado desde RPC, no desde `shipping_zones`), i18n ES/EN, Terminos | Vitest `dashboardMetrics` (net con/sin permiso), `calcTotalToPay`, Testing Library del desglose; e2e sin columnas sensibles en respuestas anon |
| E4 (CONDICIONAL a Q1) | 20261030130000 `fx_cost_rates` + `remittance_spread_snapshots` | solo si el dueno confirma una tasa de COMPRA distinta de la publicada: tabla super_admin + RPC `admin_set_fx_cost_rate` + spread en el snapshot y en la RPC del Dashboard | anon/auth/admin denegados; solo super_admin por RPC; no solape; append-only; audit; golden spread 2.2 |
| E5 | contrato B (ya preparado) | aplicar `supabase/contract/20261016160100_...` tras 48 h de observacion | `phase0bContract.test.js` existente |

Nota F4a: `plan_w4-remittance-rounding-f4a.md` (checkout principal, no versionado) deja explicitamente fuera la RPC `create_remittance` server-side (seccion 7/decision 8), asi que hoy el INSERT sale del cliente y el guard debe ser un trigger. Cuando exista `create_remittance`, la validacion del cargo y los snapshots migran dentro de ella (la funcion `quote_remittance_delivery_fee` y los resolvers se reutilizan tal cual).

Orden de despliegue: E1 (warn) -> E2 -> E3 front -> observar `price_integrity_flags` -> E1 a `block` -> E4 (si aplica) -> E5. Rollback: cada `_down.sql` es inmediato y sin efecto en datos previos (los snapshots nuevos se pierden; los existentes de `remittance_courier_costs` se conservan porque solo se agregan columnas NULLables). Riesgos: remesas hechas antes de E4 sin snapshot -> el Dashboard ya las cuenta como "no registradas"; sin E4 o sin tasa de costo cargada -> spread 0 (explicito en UI).

## 6. Decisiones para el dueno (ND)

- **ND-1 Spread vs comision.** Reco: mantener comision como esta (ya es 20 CUP/USD) y modelar el spread como `C - R` adicional, default 0. Tradeoff: si el dueno cree que 830/810 es spread adicional, se duplicaria; confirmar con Q1 (E4 solo se construye si hay una tasa de compra distinta). Tension: publicar 830 junto a una comision visible de 2.41% ya muestra el margen al cliente; si el dueno quiere ocultarlo, la alternativa es publicar 810 con comision 0% (cambia Terminos, desglose del checkout y que el Dashboard deja de ver "comision": todo el margen pasaria a spread).
- **ND-2 Cargo al cliente en remesas chicas.** Reco: escalonado por monto (ej. 20-49.99 -> 0.50 USD, >=50 -> 0), visible antes de pagar. Tradeoff: ingreso explicito y legal vs friccion de conversion en las chicas.
- **ND-3 Costo de mensajera.** Reco: fijo en CUP por entrega (convertido con tasa vigente y congelado), y `share_pct` solo si el acuerdo real es porcentual. Tradeoff: fijo es predecible para la mensajera y refleja riesgo cambiario al dueno; % reparte el riesgo pero complica el pago.
- **ND-4 Quien paga el % (sale de la ganancia del dueno o se suma al cliente).** Reco: sale de la ganancia (no se cobra extra al cliente). Tradeoff: margen menor vs transparencia.
- **ND-5 Visibilidad del spread/tasa de costo.** Reco: solo super_admin; admin ve comision, cargo y costo de mensajera. Tradeoff: el admin no ve la ganancia neta completa.
- **ND-6 Desacoplar cargo de entrega de `shipping_zones.shipping_cost`.** Reco: si; usar tabla de tramos propia (hoy una zona cobra hasta 35 USD, pensado para pedidos). Tradeoff: migrar/configurar tramos y mantener fallback temporal.
- **ND-7 Remesas bajo cero.** Reco: no bloquear; alertar en Dashboard y ajustar tramos. Tradeoff: perdida puntual vs rechazar clientes.
- **ND-8 Snapshot de remesas pasadas.** Reco: sin backfill (ganancia historica "no registrada"), como ya se hizo con courier. Tradeoff: historico incompleto vs inventar costos.

## 7. Preguntas al cliente (cifras dudosas)

1. "8.30 y 8.10": tomo que son 830 y 810 CUP por USD. ¿830 es la tasa a la que COMPRA CUP (su costo) y 810 la que paga al destinatario? Hoy la web ya muestra 830 con comisión de 2.41% (= 20 CUP). ¿Esa comisión ES la diferencia o además gana otra?
2. ¿La regla es: en envíos menores de 50 USD la mensajera cobra 200 CUP fijos y el cliente paga 0.50 USD; en los demás la mensajera recibe un % de la ganancia? ¿Los 200 son CUP y son iguales en todas las provincias o varían?
3. "Por debajo de 50": ¿50 USD? ¿Desde que monto y hasta que monto aplica la tarifa especial?
4. "Los clientes me pagan 0.50 USD": ¿es un cargo fijo adicional por entrega a domicilio, en USD, para envíos menores de 50? ¿Y para los de 50 o más cuánto?
5. "Un por ciento que se le entrega a la mensajera": ¿es un % de la ganancia (comisión) o del monto enviado? ¿Qué % y en que casos (todos o solo ciertos montos)?
6. ¿Con qué frecuencia cambia su tasa de compra y quién la actualiza (solo usted)? ¿Quiere que el sistema guarde el histórico?
7. ¿Quiere que el cliente vea el cargo de entrega desglosado antes de pagar? (recomendado y para Términos)

## 8. Lo que no pude verificar
- El plan W4/F4a existe solo como archivo no versionado en el checkout principal; lo lei (read-only) para confirmar que `create_remittance` server-side queda fuera de la ola 4. No lo contraste linea a linea con esta propuesta; alinee el redondeo con `remittanceCalculations.js`/`_remittance_quote`.
- La transcripcion del audio (no escuchado): todas las cifras de seccion 0 y 2 son hipotesis; la tasa de costo real, los CUP de la mensajera y el umbral son desconocidos.
- Tamano de muestra en prod: 27 remesas (5 completadas, 0 con cargo de entrega); no hay base estadistica. El valor 1.0 de tasa minima son pruebas.
- No se verifico la UI renderizada ni los Terminos publicados (solo codigo); no se probo ninguna migracion (ni harness local).
- No se leyeron `payment_fx_rates`/Bizum ni Edge Functions de notificacion; tampoco si WhatsApp/emails exponen `delivery_cost`.

## 9. Actualizacion con datos de WhatsApp (9.2 y 9.5 SUPERADAS por la seccion 10; 9.1, 9.3 y 9.4 siguen vigentes)

### 9.1 Lo que confirman los datos
- **No hay spread extra.** "Se invierte 80 000 y ganas 1900, o 1700 con el viaje": 1900/80000 = 2.375% bruto, 1700/80000 = 2.125% neto de mensajera. Encaja con la comision actual (2.4096%, = 20 CUP/USD) y con 200 CUP de mensajera: 80 000 CUP ~ 100 USD, margen 1900 CUP, viaje 200 CUP, neto 1700 CUP. Se cancela E4 (`fx_cost_rates`/spread) mientras el dueño no diga lo contrario (YAGNI; ND-1 queda "comision = margen").
- **Mensajera en CUP, factor 0.1235.** 100 CUP / 810 = 0.12346 USD; verificado: 200 CUP = 0.247 USD a 810 (0.241 a 830, que usaba en 2.1). Usar el factor de 810 (tasa efectiva de pago) es mas conservador: costo de mensajera = **0.25 USD** (round 2 dp). Coherente con "cada 100" y "200 pesos". El snapshot guarda `fee_cup` y `fx_used`; la tasa para convertir es la efectiva de pago (rate * (1 - pct)), no la publicada. Pregunta menor Q-b (abajo).
- **Restriccion de competencia:** la comision efectiva no puede subir ("la competencia usa mi mismo margen"; rechazo subir a 3%; acepta 2.125% y "cuando se estabilice juega con los precios"). Todo costo de mensajera debe salir de ese margen o de un cargo que no altere el porcentaje publicado.

### 9.2 Pregunta #1 (bloqueante): ¿que es el 0.50 USD en envios <= 50?
Texto: "Si el envio es menor a 50 o =50, al cliente yo le descuento 0.50 USD y el pago, digamos, eran 50; de ahi solo pago 49,50 segun tarifa del momento."
- **Lectura A (la del coordinador): descuento al cliente** (cuesta 0.50 al negocio). Mecanismo existente: `discount_amount` de oferta; ojo, el motor topa el descuento a la comision bruta (`_remittance_quote`, `calcDiscount`), asi que en S=20 solo se podria descontar 0.48.
- **Lectura B (la literal): retencion al destinatario** — el envio es 50 pero se paga como 49.50: el dueño se queda 0.50 mas (ingreso, equivale a una comision fija minima de 0.50 en <= 50). Mi lectura textual de "yo le descuento ... solo pago 49,50" apunta a B; debe confirmarse con el cliente porque cambia el signo de la economia.
Pregunta exacta: "Cuando el envio es de 50 o menos, ¿el destinatario recibe 0.50 USD MENOS (usted gana 0.50 mas) o el cliente PAGA 0.50 menos (usted gana 0.50 menos)? ¿Y es siempre 0.50 o 'cada 100'?"

### 9.3 Economia (comision 2.4096%, mensajera 200 CUP = 0.25 USD, sin spread). Neto % sobre el monto enviado; objetivo del cliente 2.125%
| S | comision | neto sin ajuste | neto % | lectura B (+0.50 si S<=50) | neto % B | lectura A (-0.50 si S<=50) | neto % A |
|---|---|---|---|---|---|---|---|
| 20 | 0.48 | 0.23 | 1.15% | 0.73 | 3.65% | -0.25 (descuento topado a 0.48) | -1.25% |
| 30 | 0.72 | 0.47 | 1.57% | 0.97 | 3.23% | -0.03 | -0.10% |
| 50 | 1.20 | 0.95 | 1.90% | 1.45 | 2.90% | 0.45 | 0.90% |
| 100 | 2.41 | 2.16 | 2.16% | 2.16 (no aplica) | 2.16% | 2.16 | 2.16% |
- **Sin ajuste:** el equilibrio es 0.25/0.024096 = **10.4 USD** (< min 20): rentable siempre, pero por debajo del objetivo 2.125% en 20/30/50 (courier fijo pesa mas en montos chicos); alcanza 2.125% recien en ~S=100 (el punto donde el cliente hizo su cuenta: 80 000 -> 1700).
- **Lectura B:** rentable siempre; sobre-cumple el objetivo en <=50 (2.9-3.65%). Para llegar exactamente a 2.125% bastaria +0.20 en S=20 y +0.12 en S=50 (cuenta: 2.125%*S - (comision - 0.25)).
- **Lectura A:** NO es rentable por debajo de **S = 0.75/0.024096 = 31.1 USD** (30.8 con 0.247); con comision 2.125% seria 35.3. Entre 20 y 31 USD pierde; a 50 queda 0.90% (muy bajo el objetivo). El descuento de 0.50 en A solo se sostiene con un monto minimo ~35 o si se acota (9.4).

### 9.4 Opciones que respetan la competencia (no subir el % publicado)
| Opcion | Efecto | Competencia | Costo de implementacion |
|---|---|---|---|
| 1. Retencion/comision fija por tramo (B): `commission_fixed` +0.50 si S<=50 | cubre mensajera y supera el objetivo | el % publicado no cambia; se muestra "cargo envios <= 50" en el desglose | tabla de tramos que alimenta `p_fixed` de `_remittance_quote` y `calcForward` (gemelos); la comision sigue congelada al subir comprobante |
| 2. Descuento acotado (A): descuento = min(0.50, comision - mensajera) (=0 en S=20, 0.22 en S=30, 0.50 desde ~31) | nunca pierde frente al costo | conserva la promesa de descuento donde es sostenible | requiere calculo con el costo de mensajera en servidor; el cliente ve descuentos distintos por monto (explicar) |
| 3. Monto minimo cash mas alto (20 -> 35) | elimina la zona de perdida de A | menos clientes chicos | cambio de `remittance_types.min_amount`, sin codigo |
| 4. Cargo minimo de comision (piso, p. ej. max(2.41%, 0.75)) | cubre mensajera en chicos | no cambia el % sobre 31+ USD | variante de 1; piso en vez de suma |
| 5. Mensajera en lote / % de la ganancia | baja el costo por entrega | invisible al cliente | operativo; `share_pct` ya soportado por `courier_fee_schedule` |
No recomendado: subir el % global (rechazado por el cliente), ni cobrar zona `shipping_cost` (5-35 USD) a remesas.

### 9.5 Recomendacion revisada
1. **Primero Q#1.** Sin esa respuesta no se implementa el 0.50.
2. **Si es B (retencion):** opcion 1. Tabla `remittance_commission_tiers` (publica, por tipo: `min_amount`, `max_amount`, `fixed_add`), usada por `_remittance_quote` y `calcForward`; sin tabla de `delivery_cost` nueva ni cambios al Dashboard (es comision). Se mantiene la comision congelada y el redondeo W4. Se descarta el cargo "adicional al total".
3. **Si es A (descuento):** opcion 2 (descuento acotado) y evaluar opcion 3 (min 35); NO descuento plano de 0.50 (pierde de 20 a 31 USD).
4. **En ambos casos:** `courier_fee_schedule` admin-only (fee_cup=200, `share_pct` opcional) + snapshot en `remittance_courier_costs` (columnas `fee_cup`, `fx_used`, `share_usd`; conversion con la tasa efectiva de pago 810), Dashboard con RPC agregada y KPI nuevo "margen neto % vs objetivo 2.125%" y conteo de remesas bajo cero. Guard de `delivery_cost` en `warn` se mantiene (agujero real: ningun trigger lo valida) pero ya no es critico para el 0.50.
5. Etapas actualizadas: E1 = tiers de comision (B) o regla de descuento acotado (A); E2 = courier schedule + snapshot; E3 = Dashboard + front + i18n/Terminos; E4 = cancelada; E5 = contrato B (C1). Timestamps y orden de despliegue como en seccion 5 (E4 omitida).
6. La frase "juega con los precios cuando se estabilice" apunta a una palanca futura: dejar los tramos configurables por super_admin via RPC (sin deploy) en vez de cableados.

### 9.6 ND y preguntas restantes (minimo)
- **ND-A:** lectura A o B del 0.50 (depende de Q#1). Reco: B (suma, simple, sin perdida).
- **ND-B:** ¿tope de tramo en 50 inclusive (<= 50)? Reco: si, tal como lo escribio el cliente.
- **ND-C:** ¿tasa para convertir los 200 CUP: efectiva de pago (810, 0.1235 por 100 CUP) o publicada (830)? Reco: 810 (conservador, el cliente mismo usa 0.1235).
- ND-2/3/5/6/7/8 de la seccion 6 siguen validos; ND-1 se cierra ("comision = margen") y ND-4 pasa a "el costo de mensajera sale del margen".
Preguntas al cliente: **Q#1** (arriba); **Q-b** ¿los 200 CUP de mensajera son iguales para todas las provincias y para cada entrega (o 'cada 100' = 100 CUP por cada 100 USD entregado)?; **Q-c** ¿el margen objetivo 2.125% es neto por remesa de 100 USD o promedio de todas?

## 10. CIERRE (decision final del dueño: Lectura B, tramos configurables). Reemplaza 3, 5 y 9.5

Decision: en envios <= 50 USD el DESTINATARIO recibe 0.50 menos (el dueño gana 0.50 mas); el cliente paga lo mismo y VE el monto que recibira el destinatario ya descontado. Importe dinamico, configurable por el admin, por tramo de monto. Se cierra Q#1 (Lectura B). El spread extra sigue descartado.

### 10.1 Idea central: es una COMISION FIJA POR TRAMO (no un cargo nuevo)
El cargo entra como parte de `commission_fixed`/`commission_total`. Asi el contrato de redondeo, el override del admin, la aceptacion del cliente y el Dashboard siguen coherentes sin cambios de esquema en `remittances` ni en el Dashboard (la comision ya es ingreso). No se usa `delivery_cost` (se suma al total a pagar, que no es lo que decidio el dueño) ni descuentos.
`commission_gross = round(S*pct/100 + type.commission_fixed + tier_fee, 2)`; los descuentos de oferta se aplican sobre ese bruto (tope = bruto, sin cambio de codigo). Se guarda en la remesa `commission_fixed = type.commission_fixed + tier_fee`, de modo que la invariante almacenada (`commission_total = round(S*pct/100 + commission_fixed) - descuento`) sigue valiendo y los lectores existentes no cambian.
Ejemplo (tasa 830, 2.4096%): S=20 -> comision 0.48+0.50 = 0.98; destinatario 15 786.60 CUP (antes 16 201.60: -415 CUP = 0.50 USD). S=50 -> 1.20+0.50 = 1.70; 40 089.00 CUP. S=50.01 -> 1.21 sin cargo; 40 504.00 CUP.
**Consecuencia a decidir (ND-F):** hay un "escalon": enviar 50.01 en vez de 50 hace que el destinatario reciba 0.50 USD (415 CUP) mas por 1 centavo mas. Es inherente a "<= 50". Opciones: aceptarlo (recomendado: es lo que el cliente describe y es transparente) o suavizarlo con un tramo decreciente (0.50 hasta 50, 0.25 de 50 a 100), configurable sin codigo.
Sobre "cada 100": en <= 50 hay un solo bloque, asi que "0.50 fijo" y "0.50 por cada 100" son IDENTICOS en este tramo. Recomendacion minima: NO modelar `fee_per_block` (YAGNI); si luego se quieren cargos por encima de 50, se agregan mas tramos.

### 10.2 Tabla de tramos (lectura publica, escritura solo por RPC)
`public.remittance_fee_tiers`:
| columna | tipo | regla |
|---|---|---|
| id | uuid pk | |
| remittance_type_id | uuid fk remittance_types | NOT NULL (el cargo esta en la moneda enviada del tipo) |
| amount_from | numeric(12,2) | EXCLUSIVO, >= 0 |
| amount_to | numeric(12,2) NULL | INCLUSIVO, NULL = sin tope; `amount_to > amount_from` |
| fee_amount | numeric(10,2) | CHECK >= 0 |
| is_active | boolean default true | |
| valid_from / valid_to | timestamptz | `valid_to` NULL = vigente; `valid_to > valid_from` |
| created_by, created_at | | |
Semantica: aplica si `amount_from < S <= amount_to` (intervalos (a, b]); "<= 50" = (0, 50] y el siguiente tramo empieza en 50, sin huecos de centavos.
Seguridad: RLS ON; `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role`; `GRANT SELECT TO anon, authenticated`; policy SELECT: `(is_active AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())) OR is_admin_user()`. Sin INSERT/UPDATE/DELETE para ningun rol de API. Lo que ve el cliente es justo lo que paga: no hay dato sensible.
Escritura: RPCs SECURITY DEFINER (`search_path = public, pg_temp`) `admin_set_remittance_fee_tier(...)` y `admin_deactivate_remittance_fee_tier(id)`; primera linea: `auth.uid()` no nulo y `is_admin_user() OR is_super_admin()` (re-verificado, deshabilitados rechazados como en `admin_set_remittance_commission`); `pg_advisory_xact_lock(hashtext('remittance_fee_tiers'))`.
Validaciones (22023/42501): `fee_amount >= 0`; `amount_from >= 0`; `amount_to > amount_from`; sin solape con otro tramo activo del mismo tipo en la ventana de vigencia (comprobado en la RPC bajo el lock; btree_gist NO esta instalado en prod, por eso no se usa EXCLUDE); **tope de cordura: `fee_amount <= 10% de max(amount_from, type.min_amount)`** (con min 20 => maximo 2.00; evita teclear 50 por 0.50) y `fee_amount < type.min_amount` (el destinatario nunca queda en cero). Los cambios son VERSIONADOS: no se edita en sitio; la RPC cierra la fila vigente (`valid_to = now()`) e inserta la nueva. Historia completa en la tabla y en `financial_audit_log` (agregar `remittance_fee_tiers` a `financial_audit_columns` y a los triggers `audit_financial_*` como `remittance_types` en 20261020100000; el INSERT lo registra la RPC).
**Quien edita:** recomendado `admin` (y super_admin), igual que `remittance_types` (tasa y comision, hoy `is_admin_user()`): es la misma clase de dato de precio, con auditoria, tope de cordura y efecto solo hacia adelante. Alternativa mas estricta (solo super_admin) en ND-G.

### 10.3 Integracion con el calculo (verificado en codigo)
Puntos que hoy leen `type.commission_fixed` y deben sumar el tramo:
| Pieza | Donde | Cambio |
|---|---|---|
| Resolver SQL nuevo | `20261030100000` | `_remittance_tier_fee(type_id, amount, at default now()) STABLE` -> 0 si no hay tramo; `_remittance_fixed_commission(type_id, amount, at)` = `COALESCE(type.commission_fixed,0) + tier_fee` |
| `_remittance_quote` | `20261023100000_...sql:43` | **SIN cambios de firma ni cuerpo**: ya recibe `p_fixed`; los llamadores pasan el fijo efectivo. Aritmetica pura IMMUTABLE intacta |
| `recalculate_remittance_at_current_rate` | `20261023120000:192` y variantes posteriores | pasar `_remittance_fixed_commission(...)`, guardar `commission_fixed` efectivo y actualizar el snapshot del tramo (solo pending/rejected: la comision aun no esta congelada) |
| `admin_set_remittance_commission` | **M0 ya en main** (`20261028100000`, solo pending/rejected; linea 70 usa `COALESCE(v_type.commission_fixed,0)`) | cambio de UNA expresion: `standard_commission` (referencia de auditoria) = comision estandar CON tramo. El override reemplaza `commission_total` entero, asi que incluye el cargo sin mas |
| `calcForward` / `calcReverse` / `simulateRemittance` | `remittanceCalculations.js:40,62,84` | sin cambio de firma: reciben `commissionFixed` efectivo. Helper puro nuevo `resolveTierFee(tiers, amount)` con los mismos vectores dorados |
| Servicio | `remittanceService.js:750-764, 831-849, 1030` | cargar los tramos del tipo (lectura publica) y pasar el fijo efectivo. **Reverse**: `calcReverse` debe probar S con y sin tramo (la funcion deja de ser monotona en el borde: dos candidatos, se elige el menor S con `amountToDeliver >= D`; mantiene "nunca recibe menos") |
| Vista previa de recalculo | `MyRemittancesPage.jsx:764` | sumar el tramo a `newCommFixed` (solo aviso) |
| Guard S2 `commission_below_floor` | `20261017110000` | solo flag; con el tramo el piso real sube; se cubre en el trigger nuevo (10.4) |
Aceptacion de comision (`plan_commission-client-acceptance.md`, worktree agent-ae8f4c72ee032e721, leido completo): sus propuestas comparan `commission_total` viva (baseline/new) y no recomputan nada, y el tramo queda congelado en la remesa, asi que **no chocan**. Puntos de coordinacion: (1) ambos reemplazan `admin_set_remittance_commission` con CREATE OR REPLACE: su M3 (20261028100300) y nuestro 20261030120000 deben aplicarse en orden y partiendo del `prosrc` vigente en prod (nunca de una copia vieja del archivo); (2) editar tramos NO genera propuestas (solo afecta remesas futuras); (3) el recalculo por tasa lo inicia el cliente y no pasa por aceptacion (sin cambios); (4) la UI de comision muestra `commission_total` ya con el cargo.

### 10.4 Snapshot por remesa y validacion del servidor
- `public.remittance_applied_fee_tiers(remittance_id PK FK ON DELETE CASCADE, tier_id FK ON DELETE SET NULL, fee_amount, amount_from, amount_to, applied_at)`: lectura para el dueño y los admins (el cliente ve su propio cargo), sin escritura de API. La llena un trigger AFTER INSERT SECURITY DEFINER con la regla del SERVIDOR (no con lo que dijo el cliente). La historia no se reescribe: cambiar o desactivar tramos no toca remesas existentes; sin backfill (las 27 actuales quedan sin tramo).
- Hoy el cliente inserta `commission_fixed`, `commission_total` y `amount_to_deliver` (`remittanceService.js:1026-1030`). Trigger nuevo `guard_remittance_fee_tier` (BEFORE INSERT, mismo kill switch `remittance_pricing_guard_mode` off|warn|block y `price_integrity_flags` de S2): esperado = `_remittance_fixed_commission(type, amount_sent)`; regla `fee_tier_missing` si `commission_fixed < esperado - 0.005` o `commission_total < round(S*pct/100 + esperado, 2) - discount_amount - 0.01` (un override no existe al insertar). Tolerancia de carrera: se acepta el menor cargo vigente en los ultimos 15 min (un admin que sube el cargo mientras el cliente cotiza no genera falso positivo). Sale en `warn`; pasa a `block` tras observar `price_integrity_flags` sin falsos positivos. Cuando exista `create_remittance` server-side (F4a, fuera de la ola 4), esta logica se mueve dentro de ella.
- `recalculate...` re-resuelve el tramo y actualiza el snapshot (solo pending/rejected). Ningun otro camino lo modifica.

### 10.5 UI
- **Wizard** (`SendRemittancePage.jsx`, `AmountDisplayCard`): desglose visible antes de pagar, en cada paso con importe: "Envias {S} USD", "Comision ({pct}%) {x}", **"Cargo por envios de hasta {to} USD: {fee}"** (solo si aplica; `aria-live` al cambiar el monto), "Tu destinatario recibira {CUP}" (ya descontado), "Total a pagar {S + delivery_cost}" (sin cambio). Nota neutra cuando aplica el tramo, sin incitar a cambiar el monto. Mobile-first, sin depender solo del color, contraste AA.
- **Admin**: pestaña "Cargos por tramo" en `RemittanceTypesConfig` (o Settings): tabla por tipo con desde/hasta/importe/estado/vigente desde, formulario accesible (labels, errores con `aria-describedby`), simulador reutilizando `simulateRemittance` (muestra comision, cargo y monto a entregar antes de guardar), aviso "Aplica solo a remesas nuevas", historial de versiones. Errores de la RPC mapeados a i18n.
- **i18n** (ES/EN, claves `remittances.feeTier.*` y `settings.feeTiers.*`): ES "Cargo por envíos de hasta {max} USD" / EN "Fee for transfers up to {max} USD"; ES "Tu destinatario recibirá {amount} {currency}" / EN "Your recipient will receive {amount} {currency}"; ES "Aplica solo a remesas nuevas" / EN "Applies to new remittances only"; ES "El importe no puede superar el {pct}% del monto mínimo del tramo" / EN "The fee cannot exceed {pct}% of the tier's minimum amount"; ES "Los tramos no pueden solaparse" / EN "Tiers cannot overlap".
- **Términos** (`TermsPage`, `legalConfig`): cláusula "Comisión y cargo por envíos pequeños: además de la comisión porcentual, los envíos de hasta el importe publicado en la plataforma incluyen un cargo fijo que se descuenta del monto que recibe el destinatario. El cargo vigente se muestra antes del pago y queda registrado en cada remesa." Los importes NO se escriben en el texto legal; se leen de la plataforma. Redacción final: revisión legal.

### 10.6 Economia final (comision 2.4096%, mensajera 200 CUP = 0.25 USD a 810)
| S | comision + cargo | neta tras mensajera | % neto (objetivo 2.125%) | destinatario recibe (CUP @830) |
|---|---|---|---|---|
| 20 | 0.98 | 0.73 | 3.65% | 15 786.60 |
| 30 | 1.22 | 0.97 | 3.23% | 23 887.40 |
| 50 | 1.70 | 1.45 | 2.90% | 40 089.00 |
| 100 | 2.41 | 2.16 | 2.16% | 80 999.70 |
Nunca pierde. El cargo de 0.50 supera el objetivo de 2.125% en <= 50; para quedar exactamente en 2.125% bastaria un cargo de 0.20 en S=20 y 0.12 en S=50 (se ajusta desde el panel, sin codigo). El % publicado NO cambia (respeta la restriccion de competencia).

### 10.7 Etapas TDD (timestamps desde 20261030100000; test rojo primero; rollback `_down.sql`; nada a prod sin "dale")
| # | Entrega | Pruebas primero |
|---|---|---|
| E0 | Vectores dorados nuevos en `src/tests/fixtures/remittanceGoldenVectors.json` (S=20/30/50/50.01/100, con y sin oferta, reverse en el borde) y test JS de `resolveTierFee` | JS y gemelo SQL deben dar identico (como hoy) |
| E1 `20261030100000_remittance_fee_tiers.sql` | tabla + RLS/GRANT + resolvers `_remittance_tier_fee`, `_remittance_fixed_commission` + tabla snapshot | anon/auth leen solo vigentes; sin DML de API; intervalos (a,b] sin huecos; vigencia; resolver devuelve 0 sin tramo |
| E2 `20261030110000_remittance_fee_tier_rpcs.sql` | RPCs admin de alta/desactivacion versionada + auditoria | rol re-verificado (cliente/anon 42501, admin deshabilitado rechazado); solape, fee < 0, tope 10%, `fee < min_amount`; el versionado cierra la fila anterior; fila en `financial_audit_log`; concurrencia (dos altas simultaneas, una gana) |
| E3 `20261030120000_remittance_fee_tier_pricing.sql` | CREATE OR REPLACE de `recalculate_remittance_at_current_rate` y `admin_set_remittance_commission` (desde el prosrc vigente), trigger de snapshot AFTER INSERT, trigger `guard_remittance_fee_tier` en `warn` | recalculo incluye tramo y actualiza el snapshot; el override conserva `standard_commission` con tramo; INSERT con comision sin tramo -> flag en warn / rechazo en block; tolerancia de 15 min; `phase15S2RemittancePricingGuard` y `remittanceCommissionOverride` siguen verdes |
| E4 front | `remittanceCalculations` (+reverse con dos candidatos), `remittanceService`, `MyRemittancesPage`, simulador, desglose del wizard, pantalla admin, i18n, Terminos | Vitest de calculos (golden) y servicio; Testing Library (desglose, 320/375/768 px, aria-live, errores del formulario); e2e Playwright "admin crea tramo -> cliente ve cargo -> la remesa guarda el snapshot" |
| E5 `20261030130000_courier_fee_schedule_and_snapshot.sql` + Dashboard | lo de 9.5 sin cambios (courier_fee_schedule admin, snapshot de mensajera a tasa efectiva 810, RPC agregada, KPI margen neto % vs 2.125% y remesas bajo cero); KPI opcional "ingreso por cargo de tramo" desde el snapshot | segun secciones 5 y 9 |
| E6 | `guard_remittance_fee_tier` a `block`; aplicar contrato B (C1) | observacion >= 48 h sin flags legitimos |
Orden de despliegue: E1 -> E2 -> E3 (warn) -> E4 -> cargar el tramo 0.50 desde el panel -> E5 -> E6. Sin tramos cargados todo se comporta como hoy (el resolver devuelve 0).

### 10.8 Riesgos
Escalon en 50 (ND-F); reverse no monotono en el borde (cubierto con dos candidatos); colision de CREATE OR REPLACE con M3 de aceptacion (aplicar en orden, base = prosrc vivo); falsos positivos del guard cuando el admin cambia un cargo (ventana de tolerancia); front viejo + tramos cargados: el cliente veria el monto sin cargo y el guard en warn lo marcaria (desplegar E4 antes de cargar el tramo y mantener `warn` hasta entonces); remesas existentes sin snapshot de tramo.

### 10.9 ND y preguntas minimas que quedan
- **ND-F** escalon en 50: aceptarlo (reco) o tramo decreciente.
- **ND-G** quien edita: admin + super_admin (reco, paridad con `remittance_types`) vs solo super_admin.
- **ND-H** descuento de ofertas sobre el bruto con cargo (reco: si, sin codigo) vs cargo no descontable.
- Cerradas: lectura B; spread descartado; fee fijo sin `fee_per_block`.
Preguntas al cliente: (1) valor inicial: ¿0.50 USD fijo para todo envío de 50 o menos (desde el mínimo de 20)? (2) ¿igual para cualquier provincia/destino? (3) ¿la mensajera sigue en 200 CUP por entrega, saliendo de ese margen (Q-b y Q-c de 9.6)? (4) ¿le parece bien mostrar el cargo desglosado en el checkout y en los Términos?

### 10.10 No verificado
No ejecute migraciones ni tests. No compare el `prosrc` vivo de `admin_set_remittance_commission`/`recalculate...` en prod con el repo tras M0 (M0 esta en main, #129, no se sabe si aplicado). No lei el esquema de `price_integrity_flags` ni de `financial_audit_log` linea a linea (se asume el patron de S2 y 20261020100000). btree_gist no esta instalado (consultado por MCP). Redaccion legal sin revision de abogado.

## 11. COSTO DE MENSAJERIA FIJADO POR ADMIN/SUPER_ADMIN, POR QUIEN ENTREGA (remesas y pedidos). Reemplaza `courier_fee_schedule` de 9.5 y la etapa E5 de 10.7

### 11.1 Estado actual (codigo + prod, SELECT agregados 2026-10-23)
- **No existe entidad "mensajero".** No hay tabla de couriers/repartidores/carriers (`information_schema`: solo `order_courier_costs` y `remittance_courier_costs` coinciden con "courier"). Roles en `user_profiles`: user 39, super_admin 3, admin 2: los mensajeros no tienen cuenta.
- **"Quien entrego" no se registra.** `remittances.delivered_by` existe (uuid, FK a `auth.users`) pero esta en 0 de 5 remesas entregadas y ninguna RPC lo escribe (`_remittance_transition` accion `confirm_delivery`, `20261025110000_delivery_proof_optional.sql:~345`, solo pone `delivered_at`, `delivery_proof_url` y notas). `orders.dispatched_by` (FK a `auth.users`, 27/27) es el ADMIN que despacho, no quien reparte; `orders` no tiene `delivered_by`. `delivered_to_name`/`delivered_to_id` (a quien se entrego) estan en 0. Prueba de entrega: `delivery_proof_url` (5/5 remesas, 18/19 pedidos), opcional desde #124 (`NULLIF(v_path,'')`).
- **Costo hoy:** `shipping_zones.transport_cost` (USD por zona, 6 zonas > 0, max 6.00) copiado UNA vez al CREAR a `order_courier_costs` (31+ pedidos, 2 filas actuales) y `remittance_courier_costs` (1 fila, NULL), tablas admin-only (RLS `is_admin_user()`, sin DML de API). Es costo por zona, no por persona, en USD, y se congela al crear (no al entregar). `transport_cost` sigue legible por anon (C1, sin cerrar).

### 11.2 Modelo (a): mensajeros + tarifas versionadas en CUP
**`public.couriers`** (admin-only): `id uuid pk`, `name text NOT NULL` (unico entre activos, `lower(btrim(name))`), `phone text NULL`, `notes text NULL`, `is_active boolean default true`, `created_by`, `created_at`. No es un usuario de la app (no login, no rol nuevo): es un registro interno. Nombre y telefono son datos personales de terceros: solo admin (ver 11.5).
**`public.courier_rates`** (admin-only, versionada, append-only): `id`, `delivery_kind text CHECK IN ('remittance','order')`, `courier_id uuid NULL` (NULL = todos), `shipping_zone_id uuid NULL` (NULL = cualquier zona), `amount_from numeric(12,2) NULL` / `amount_to numeric(12,2) NULL` (tramo sobre el monto enviado, solo remesas; (a, b] como los tramos de 10.2; NULL/NULL = cualquier monto), `fee_cup numeric(12,2) CHECK (>= 0)`, `is_active`, `valid_from`, `valid_to`, `created_by`.
- Resolucion de la tarifa (funcion `_courier_rate_resolve(kind, courier_id, zone_id, amount, at)` STABLE): la fila activa y vigente MAS ESPECIFICA gana: (courier+zona) > courier > zona > general; empate imposible porque la RPC impide solapes por (kind, courier, zona, tramo, vigencia). Sin fila -> `fee_cup` NULL (desconocido, NO cero; igual que hoy).
- Ejemplo del dueño: remesa, general, tramo (0, 50] -> 200 CUP; remesa general (50, inf) -> la tarifa que defina (hoy sin confirmar; el "% de la ganancia" de 9.5 NO se modela: Q#5 sigue abierta y es YAGNI; se agregaria como `share_pct` NULLable en una migracion posterior).
- **Moneda y conversion:** la tarifa se fija en CUP; el costo en USD = `round(fee_cup / fx, 2)` con `fx` = tasa efectiva congelada en el snapshot. Remesas: `fx = round(exchange_rate * (1 - commission_percentage/100), 4)` tomada de la propia remesa (830 y 2.4096% -> 810.0000; sin dato nuevo). Pedidos: `fx` = tasa activa USD->CUP de `exchange_rates` al finalizar (830 hoy) o, si el dueño prefiere 810 tambien en pedidos, una tasa propia (ND-J). 200 CUP / 810 = 0.2469 -> 0.25 USD; coincide con el factor 0.1235 del cliente.
**Quien edita y como:** admin y super_admin. Solo por RPC SECURITY DEFINER (`search_path = public, pg_temp`), primera linea `auth.uid()` no nulo e `is_admin_user() OR is_super_admin()` (re-verificado; deshabilitados rechazados): `admin_upsert_courier(...)`, `admin_set_courier_rate(...)`, `admin_deactivate_courier_rate(id)`. `pg_advisory_xact_lock(hashtext('courier_rates'))`, validacion de solapes y tope de cordura `fee_cup <= 20000` (~25 USD; la tarifa mas alta de hoy es 6 USD ~ 5000 CUP; evita teclear de mas), versionado (cierra la fila vigente, inserta la nueva), auditoria en `financial_audit_log` (registrar `courier_rates` en `financial_audit_columns`; el alta la escribe la RPC). Sin DML directo para ningun rol de API.

### 11.3 Registro de quien entrego y congelamiento (b)
Principio: NO tocar `_remittance_transition`/`_order_transition` (funciones grandes ya reemplazadas varias veces, riesgo de pisar #124 "comprobante opcional"). Se hace en dos pasos desacoplados:
1. **Asignar** (antes o durante el reparto): RPC `admin_assign_delivery_courier(p_kind, p_id, p_courier_id, p_fee_cup_override NULL, p_reason NULL)`; admin/super_admin; permitida mientras la remesa/pedido NO este entregado (remesa `processing`; pedido `processing`/`dispatched`). Escribe en la fila existente de `*_courier_costs`: `courier_id`, y si hay override `fee_cup` manual con `source='manual'` (motivo 10-500 caracteres obligatorio, igual que el override de comision; si no hay override, la tarifa se resuelve al finalizar).
2. **Finalizar al entregar** (atomico con la entrega): trigger `AFTER UPDATE OF status` en `remittances` (-> `delivered`) y en `orders` (-> `delivered`), SECURITY DEFINER, que toma la fila de costo, resuelve la tarifa vigente AHORA (o usa el override), calcula `fx_used` y `amount_usd`, y marca `status='final'`, `finalized_at`. Traga sus errores con WARNING (la contabilidad nunca rompe una entrega, como `snapshot_remittance_courier_cost`). **Compatible con #124:** depende solo del cambio de estado, no de `delivery_proof_url`; con o sin foto el resultado es el mismo. Si nadie asigno mensajero: se finaliza con la tarifa general y `courier_id` NULL, `status='final'`, y el Dashboard lo cuenta como "sin mensajero asignado" (no se bloquea la entrega; ND-I).
3. Congelado: una vez `final`, un trigger BEFORE UPDATE impide cambios a las columnas de costo salvo desde la RPC de correccion `admin_correct_delivery_courier_cost(p_kind, p_id, p_courier_id, p_fee_cup, p_reason)` (admin/super_admin, motivo obligatorio, historial append-only en `courier_cost_corrections`, auditoria). Cambiar tarifas o mensajeros despues NO reescribe entregas pasadas.
**Cambios de esquema (aditivos, NULLables, sin backfill):** en `order_courier_costs` y `remittance_courier_costs`: `courier_id uuid NULL` (FK a `couriers`, ON DELETE RESTRICT), `fee_cup numeric(12,2) NULL`, `fx_used numeric(12,4) NULL`, `source text CHECK ('zone_estimate','schedule','manual')`, `status text CHECK ('estimated','final') DEFAULT 'estimated'`, `finalized_at timestamptz`, `set_by uuid`. `amount_usd` sigue siendo la cifra que lee el Dashboard. **Estimado al crear:** el trigger AFTER INSERT existente se extiende: usa `_courier_rate_resolve` (sin mensajero) y, si no hay tarifa, cae al `transport_cost` de la zona como hoy (`source='zone_estimate'`); esto mantiene el comportamiento actual hasta que el dueño cargue tarifas. Las 2 + 1 filas existentes quedan 'estimated' sin cambios; los 19 pedidos y 5 remesas ya entregados NO se reescriben.
Opcional (ND-K): `paid_at/paid_by` y RPC `admin_mark_courier_paid(ids[])` para saber lo ya liquidado.

### 11.4 Seguridad (c) y cierre de C1
- Todo lo nuevo es admin-only: `couriers`, `courier_rates`, `courier_cost_corrections` y las columnas nuevas de los dos snapshots. RLS ON, `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role`, `GRANT SELECT TO authenticated`, policy `(SELECT is_admin_user()) OR (SELECT is_super_admin())`; sin INSERT/UPDATE/DELETE de API; escritura por RPC/trigger definer. El cliente (aunque sea dueño de la remesa/pedido) no lee nada: NO se agregan columnas de mensajero/costo a `orders` ni `remittances` (el dueño de la fila las leeria; esas tablas ya exponen todas sus columnas a su dueño). Test: un cliente no ve filas ni en la API ni en Realtime (los snapshots no estan en `supabase_realtime`).
- El pago al mensajero y su costo no aparecen en correos/WhatsApp al cliente ni en `delivery_notes` (que si lee el cliente): la nota interna usa `delivery_notes_admin` (no editable por el cliente) y no se copia la tarifa.
- **C1:** con el costo fuera de `shipping_zones`, `transport_cost` queda solo como estimado heredado. Se aplica el contrato B (`supabase/contract/20261016160100_phase0b_contract_revoke_cost_columns.sql`): quita `transport_cost` a anon/authenticated. Los triggers de snapshot son SECURITY DEFINER (corren como propietario) y siguen leyendo la columna; el admin la lee por `admin_list_shipping_zone_costs`. Orden: primero el front de 11.6 (ya no depende de la columna), 48 h de observacion, luego el contrato. Las 6 zonas con `transport_cost > 0` se pasan a `courier_rates` (zona, CUP = USD x 810) desde la nueva pantalla; script de ayuda, no migracion automatica.
- Integridad: `courier_id` solo desde la RPC (el cliente no puede asignarse costos); `fee_cup`/`amount_usd` con CHECK >= 0; el trigger final no se puede disparar desde el cliente (solo cambia de estado la RPC de transicion, ya blindada por `guard_status_via_rpc`).

### 11.5 Pantallas admin (d)
- **Mensajeros y tarifas** (nueva pestaña en Configuracion o junto a Envios): lista de mensajeros (alta, desactivar, telefono/nota), tabla de tarifas (tipo remesa/pedido, mensajero, zona, tramo de monto, CUP, USD aproximado a la tasa vigente, vigente desde, estado) con formulario accesible (labels, errores `aria-describedby`), aviso "aplica solo a entregas nuevas", historial de versiones, y boton "Importar tarifas de zona" (pre-llena desde `transport_cost` x 810 para que el admin confirme). Mobile-first, targets 44 px.
- **Al confirmar la entrega** (modal en `AdminRemittancesTab`/`AdminRemittancesInbox`/`AdminOrdersTab`): selector "Quien entrego" (mensajeros activos; con aviso si se deja vacio), importe prellenado desde la tarifa con vista previa CUP -> USD, campo de importe manual + motivo (solo si se cambia). La asignacion tambien puede hacerse antes (al despachar).
- **Costo por entrega** (visible solo admin): en tarjeta/detalle de cada remesa y pedido "Mensajero: {nombre} · {CUP} ≈ {USD} · final/estimado", y un reporte "A pagar a mensajeros" por periodo y mensajero (suma de costos finales; con ND-K, pendiente/pagado).
- i18n ES/EN (`couriers.*`, `courierRates.*`): ES "Quién entregó" / EN "Delivered by"; ES "Costo de mensajería (CUP)" / EN "Courier fee (CUP)"; ES "Aplica solo a entregas nuevas" / EN "Applies to new deliveries only"; ES "Entrega sin mensajero asignado" / EN "Delivery without an assigned courier". Todo solo en vistas admin.

### 11.6 Ganancia neta en el Dashboard (e)
- Remesas: `neta = commission_total (con cargo de tramo, 10.1) + delivery_cost - courier_cost`; pedidos: `ganancia de pedido (sin envio) + envio cobrado - courier_cost`. `courier_cost` = `amount_usd` del snapshot: 'final' si ya se entrego, 'estimated' si aun no (se muestra aparte con etiqueta "estimado"), y NULL cuenta como "sin tarifa registrada" (nunca 0), como hoy (`dashboardMetrics.js:157-260`, `computeRemittanceCourierTotals`).
- `courierService`/`listCourierCosts` pasa a leer tambien `status`, `courier_id`; nuevas cifras: costo final / estimado / sin tarifa / sin mensajero asignado, y desglose por mensajero (suma de finales). Sigue siendo lectura directa bajo RLS admin (no hay fuga: solo admins pueden leer las tablas); no hace falta RPC nueva. KPI "margen neto % vs 2.125%" (9.5) usa el mismo costo.
- Redondeo: `round(fee_cup/fx, 2)` en SQL (gemelo JS `roundMoney` en la vista previa del modal); sumas ya en centavos.

### 11.7 Etapas TDD (timestamps; sustituyen E5 de 10.7; test rojo primero, rollback `_down.sql`, nada a prod sin "dale")
| # | Entrega | Pruebas primero |
|---|---|---|
| C1 `20261030130000_couriers_and_rates.sql` | `couriers`, `courier_rates`, `_courier_rate_resolve`, RPCs `admin_upsert_courier`, `admin_set_courier_rate`, `admin_deactivate_courier_rate`, auditoria | anon/auth/cliente sin SELECT ni DML; admin y super_admin ok; deshabilitado rechazado; solape; tope de cordura; versionado; precedencia (courier+zona > courier > zona > general) y tramos (0,50]; fila en `financial_audit_log` |
| C2 `20261030140000_delivery_courier_snapshot.sql` | columnas nuevas en ambos snapshots, trigger de estimado extendido (con caida a `transport_cost`), triggers de finalizacion al `delivered`, trigger de congelado, RPC `admin_assign_delivery_courier`, RPC `admin_correct_delivery_courier_cost` + `courier_cost_corrections` | entrega con y sin foto (#124) finaliza igual; con mensajero asignado / sin asignar; asignar tras entregar falla (usar correccion); override exige motivo; cambiar tarifa o tipo de cambio despues no altera el snapshot; falla interna del trigger no impide la entrega (WARNING); cliente dueño no lee nada; `guard_status_via_rpc`, `guard_remittance_money_columns` y `phase15` siguen verdes; el INSERT de remesa/pedido sigue funcionando sin tarifas (caida a zona) |
| C3 front | servicios (`courierService`), pantalla Mensajeros y tarifas, modal de entrega, detalle de costo por entrega, reporte "a pagar", Dashboard (estado/mensajero), i18n | Vitest de servicios y `dashboardMetrics` (final/estimado/sin tarifa/sin mensajero); Testing Library (formularios, errores, 320/375/768 px, foco/aria); e2e "admin carga tarifa -> asigna mensajero -> confirma entrega -> costo final congelado -> cliente no ve nada" |
| C4 (opcional ND-K) `20261030150000_courier_settlement.sql` | `paid_at/paid_by`, `admin_mark_courier_paid` | permisos; no pagar dos veces; reporte |
| C5 | contrato B (C1) tras 48 h | `phase0bContract.test.js` existente |
Orden: C1 -> C2 -> C3 (cargar mensajeros y tarifas) -> C5; C4 si se aprueba. Mientras no haya tarifas ni mensajeros todo se comporta como hoy.

### 11.8 Riesgos
Entregas marcadas sin mensajero (se finalizan con tarifa general y se listan); dos pasos (asignar y entregar) no atomicos en UI (mitigado: la finalizacion es server-side por trigger y el modal los encadena); `fx` de pedidos distinto a 810 (ND-J); el estimado por zona puede desviar el costo de entregas no finalizadas; datos personales de mensajeros (admin-only, sin telefono en listados publicos); colision de timestamps con las ramas paralelas: reservar 20261030130000-150000 para este bloque.

### 11.9 ND y preguntas minimas
- **ND-I** asignar mensajero obligatorio u opcional al entregar: reco opcional con aviso (no bloquear entregas), obligatorio cuando haya 2+ mensajeros activos.
- **ND-J** tasa para convertir CUP->USD en pedidos: reco la activa de `exchange_rates` (830) salvo que el dueño quiera 810 tambien; en remesas, la efectiva de la remesa (810).
- **ND-K** liquidacion/pagado al mensajero: reco incluirla (C4) si pagan por periodo; si pagan al momento, basta el reporte.
- Se cierra: edita admin y super_admin; tarifa en CUP versionada; costo congelado al entregar; override con motivo.
Preguntas al cliente: (1) ¿cuántos mensajeros hay y cobra cada uno distinto, o la tarifa depende solo de la zona y el monto? (2) ¿Las entregas de pedidos también se pagan en CUP, y cuánto (por zona)? (3) ¿Se paga en el momento de cada entrega o se liquida por semana/mes (¿quiere marcar "pagado")? (4) ¿Los mismos mensajeros reparten remesas y pedidos? (5) Sigue pendiente el % de la ganancia para envíos de más de 50 (9.6 Q5): ¿se mantiene o basta la tarifa fija en CUP?

### 11.10 No verificado
No se probaron migraciones ni tests ni la UI. No se revisaron las vistas actuales del modal de entrega de `AdminRemittancesTab`, `AdminRemittancesInbox` y `AdminOrdersTab` linea a linea (se asume que llaman a las RPC de transicion); no se confirmo si `is_admin_user()` incluye a super_admin (por eso la policy usa ambas); no se contrasto el `prosrc` vivo de `_order_transition`/`_remittance_transition` con el repo (los triggers de finalizacion se eligieron justamente para no tocarlos); estados exactos de pedido en que se permite asignar mensajero a validar con el flujo real.
