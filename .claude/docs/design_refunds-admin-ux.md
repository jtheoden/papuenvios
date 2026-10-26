# Diseño UX/UI — Vista admin de devoluciones ("Devoluciones")

**Estado**: propuesta de diseño (sin código de producción). **Base**: `origin/main` @ 51e18bf9 (2026-10-23).
**Engram**: `sdd/refunds-admin/ux` (project `papuenvios`).

## 0. Requisito del dueño

Vista propia para admins de operaciones CANCELADAS que YA ESTABAN PAGADAS (devoluciones por realizar), con la
ventana de reembolso y notificaciones en el badge del panel de usuario y quizá una sección en el Dashboard.
Política: Términos §9 — reembolso del monto total pagado, manual, al mismo método Zelle, dentro de
`REFUND_BUSINESS_DAYS` (=5) días hábiles (`src/lib/legalConfig.js:17`, marcado "proposal" en `:16`); tras el
despacho no se cancela.

## 1. Evidencia — arquitectura de información admin actual

| Superficie | Qué es | Uso | Evidencia |
|---|---|---|---|
| Badge del avatar (topbar) | Conteo rojo = pedidos pendientes + remesas "por procesar"; polling 30 s + realtime orders/remittances; una fuente que falla cuenta 0 | Disparador diario ("tengo trabajo") | `src/components/Header.jsx:86-108`, render `:410-420`, sr-only `adminInbox.badgeAria` |
| Menú del avatar | "Panel de Usuario" → `user-panel` (ternario ES/EN hardcodeado, no `t()`) | Camino badge → trabajo | `Header.jsx:441-450` |
| Panel de Usuario → `AdminWorkTabs` | Tablist solo admin **Pedidos / Remesas por procesar**, estado en `?tab=`, roving tabindex, tabs de 44 px, `CountBadge` con sr-only | **Bandeja de trabajo diaria** | `src/components/admin/AdminWorkTabs.jsx:6-152`, montado en `UserPanel.jsx:862-1155` |
| Bandeja de remesas | Chips de filtro con conteo, tarjetas, semáforo de antigüedad (icono+texto+color), visor de comprobante, acciones con `showModal`, banner stale, `aria-live` | Diario | `src/components/admin/AdminRemittancesInbox.jsx:30-91, 341-483` |
| Lista de pedidos (Panel) | Cancelados/completados ocultos por defecto | Diario | `UserPanel.jsx:94,140` |
| Dashboard | 7 pestañas: Resumen, Pedidos, Remesas, Tipos de remesa, Ofertas, Actividad (super), Historial Zelle; Resumen tiene KPIs + banners de alerta (vencimiento de productos) | **Consulta / reporting** | `src/components/DashboardPage.jsx:423-1080`, patrón de alerta `:438-454` |
| Menú admin | dashboard, admin (catálogo), user-management, settings | Configuración | `Header.jsx:58-63` |

Invariante documentada en código: "número del badge === conteo de la pestaña" (`src/lib/remittanceService.js:146-149`).
Fuente del badge de pedidos: `get_pending_orders_count()` = `status='pending' OR payment_status='pending'` (prod, `pg_proc`).

**Bug preexistente detectado**: un admin que cancela un pedido `pending/pending` deja `payment_status='pending'`
(la cancelación admin no toca el pago), así que ese pedido cancelado **sigue contando en el badge para siempre**.
Como el diseño suma devoluciones al mismo badge, el implementador debe corregir el predicado en el mismo cambio
(`status='pending'`, o excluir `status='cancelled'`).

## 2. Evidencia — hechos de dominio que condicionan el diseño

1. **Matriz de cancelación de pedidos** (`supabase/migrations/20261024110000_order_transition_rpcs.sql:34-36,139-142,222-228`):
   - admin: `pending|processing` → `cancelled`, **payment_status sin cambio** (un pago `validated` sobrevive) → devolución *confirmada*.
   - dueño: solo `pending` y no validado → `cancelled`, **payment_status forzado a `rejected`** (se pierde la señal de "comprobante subido"; `payment_proof_url` no se borra).
   - **reabrir** (dueño): `cancelled` con pago `pending|rejected|proof_uploaded` → `pending/pending`. Un pedido validado no se puede reabrir.
   - despachado/entregado no se cancela → coincide con "tras el despacho no se cancela".
   - `reject_payment` también conserva `payment_proof_url`, y la cancelación posterior **sobrescribe `rejection_reason`** (línea 224).
2. **Matriz de cancelación de remesas** (`20261024110100_remittance_transition_rpcs.sql:20-24,93-108,169-171`): **solo el dueño**, desde `payment_pending|payment_rejected|payment_proof_uploaded`. **No existe cancelación admin** (único llamador de `cancelRemittance`: `MyRemittancesPage.jsx`) y **no se cancela tras validar**. Toda remesa candidata es "comprobante subido, nunca validado" = recepción no confirmada.
3. **Timestamps**: remesas tienen `cancelled_at`, `cancelled_by`, `cancellation_reason`. Pedidos **no** → derivar de `order_status_history` (`new_status='cancelled'`, `changed_by`, `created_at`, `notes`); admins pueden leerla por RLS (`osh_select`, `20260210000002_rls_initplan_optimization.sql:386-388`).
4. **Monto pagado**: pedidos `total_amount` (o `payment_amount/payment_currency` cuando hay cotización); remesas `amount_sent + delivery_cost` (`calcTotalToPay`, `remittanceService.js:977`).
5. **A quién devolver**: `zelle_account_id` es la cuenta **del negocio**. **No se guarda el Zelle del cliente**; solo `payer_phone` (contacto) en orders/remittances y `user_profiles.email`.
6. **No hay persistencia de reembolsos** (ni columnas ni tabla). `zelle_transaction_history.status` hoy ∈ {validated, rejected} (prod). Marcar "reembolsado / no procede" requiere esquema → ND-3.
7. **No hay helper de días hábiles** en `src/` ni en migraciones → ND-4.
8. **Datos prod**: 0 pedidos cancelados, 0 remesas canceladas (SELECT 2026-10-23). El estado vacío ES el estado de lanzamiento.

### Regla de candidatos (dos niveles) — decidida con el estado PREVIO a la cancelación

El estado actual no basta (el dueño fuerza `rejected`; un comprobante rechazado por admin conserva `payment_proof_url`).
La regla debe evaluarse **en el momento de cancelar**, con los valores `OLD` de la transición (el registro de
devolución lo crea el servidor dentro de la misma transacción — ver ND-3):

| Nivel | Regla (valores previos a cancelar) | Significado |
|---|---|---|
| **A — Devolución debida** | pedido con `OLD.payment_status='validated'` | Dinero confirmado. Corre el plazo. |
| **B — Verificar recepción** | pedido con `OLD.payment_status='proof_uploaded'`, o remesa con `OLD.status='payment_proof_uploaded'` | El cliente dice que pagó; el admin debe comprobar la cuenta Zelle antes de devolver. Corre el plazo (promesa visible al cliente). |
| Excluido | `pending` / `rejected` (pedido) o `payment_pending` / `payment_rejected` (remesa) | Nada pagado, o el admin ya juzgó el pago inválido. Sin reloj, sin alarma. |

Un pedido nivel B que el dueño reabre sale de la lista (y su registro pasa a "no procede: reabierto", ND-2).

## 3. Decisión de ubicación

| Opción | Frecuencia | Urgencia (plazo) | Mobile | Consistencia | Veredicto |
|---|---|---|---|---|---|
| **A. 3.ª pestaña "Devoluciones" en `AdminWorkTabs`** (Panel de Usuario) | Bandeja diaria, adonde ya lleva el badge | Alta: junto a las otras colas de "actuar ya" | Tabs ya hacen wrap (`flex-wrap`, 44 px) | Reusa tablist, `?tab=`, `CountBadge`, patrón de hook | **Recomendada** |
| B. Nueva pestaña en Dashboard | Dashboard es consulta; ya tiene 7 pestañas | Baja: no se abre a diario | 8.ª pestaña en `TabsResponsive` = más scroll | Duplica patrones de la bandeja | Rechazar como principal |
| C. Página propia en el menú admin | Destino extra para una cola chica (0 hoy) | Media | Un ítem más de menú | Nueva ruta/guard | Sobredimensionado (YAGNI) |
| D. Filtro dentro de las listas existentes | Cancelados ocultos por defecto (`UserPanel.jsx:140`); dos lugares | Baja: sin plazo unificado | — | Parte un trabajo en dos listas | Rechazar |

**Recomendación: A**, más una **tarjeta de alerta en Dashboard → Resumen** (mismo bloque que el aviso de vencimiento,
`DashboardPage.jsx:438-454`), visible solo con devoluciones pendientes y con enlace a `user-panel?tab=refunds`.
Cumple "quizá una sección en el Dashboard" sin una segunda lista.

Visibilidad de la pestaña: siempre visible para admins (0 también informa: "no se debe nada"), ubicada **última** para no
alterar la lógica de pestaña por defecto (`AdminWorkTabs.jsx:54-60`). Regla extendida: si pedidos=0 y remesas=0 y hay
devoluciones vencidas → abrir Devoluciones.

## 4. Diseño de la vista

### 4.1 Estructura (todos los anchos)

1. **Franja resumen** (3 tiles): Pendientes (n) · Monto pendiente (suma **por moneda**, nunca mezclada) · Vencen en ≤1 día hábil / vencidas.
2. **Chips de filtro** (patrón de `AdminRemittancesInbox`, `aria-pressed`, conteo por chip): `Por devolver` (defecto: pendientes A+B) · `Verificar recepción` (B) · `Vencidas` · `Reembolsadas` · `No procede` · `Todas`. Control segmentado de tipo: Todas / Pedidos / Remesas.
3. **Búsqueda** (número, nombre/email del cliente): en cliente sobre la lista cargada; `type="search"`, label visible en ≥sm y sr-only en mobile.
4. **Lista de tarjetas** ordenada: vencidas primero (la más vencida arriba) → vencen pronto → en plazo (menos tiempo primero) → resueltas (más recientes).
5. Pie: banner stale / región live / spinner de acción (igual que la bandeja).

### 4.2 Contenido de la tarjeta

- Cabecera: chip de tipo (`Pedido` / `Remesa`, icono Package/Send — no solo color) + número (monospace) + **chip de nivel** (`Devolución debida` / `Verificar recepción`) + chip de estado.
- Cliente: nombre · email (`user_profiles`) · teléfono del pagador.
- **Monto a devolver**: grande, `tabular-nums`, con moneda.
- Pago: cuenta Zelle del negocio que recibió (nombre + email/teléfono) · referencia del pago · botón comprobante (`ImageProofModal`, bucket según tipo).
- Cancelación: fecha-hora + "por el cliente" / "por admin <nombre>" + motivo.
- **Plazo**: `DeadlineLabel` (patrón de `AgeLabel`, `AdminRemittancesInbox.jsx:74-91`), icono + texto + color:
  - En plazo (≥2 días hábiles): CheckCircle, gris/green-700, "Quedan 4 días hábiles".
  - Vence pronto (≤1 día hábil): Clock, amber-700, "Vence mañana" / "Vence hoy".
  - Vencida: AlertTriangle, red-700 negrita, "Vencida hace 2 días hábiles". `<time dateTime>` con fecha límite absoluta en `title` y visible en desktop.
- Acciones (mín. 44 px):
  - Primaria: **Marcar reembolsado** → modal: referencia del reembolso (obligatoria, 1-100), fecha (por defecto hoy, no futura, no anterior a la cancelación), nota opcional; línea resumen con monto + cliente para último control. Nivel B: checkbox obligatorio "Confirmé que el pago llegó a <cuenta Zelle>".
  - Secundaria: **No procede** → `showModal` con motivo obligatorio (1-500) y presets: "El pago nunca llegó", "Duplicado de #…", "Reembolsado fuera de la app", "Otro".
  - Terciaria: **Copiar datos** → un bloque de texto al portapapeles (monto, moneda, cliente, email, teléfono, referencia original, número de operación) + toast "Copiado"; `navigator.clipboard` con fallback.
  - Enlace: abrir detalle del pedido/remesa.
- Tarjetas resueltas: colapsan a una fila ("Reembolsado 22/10 · ref XXXX · por Ana"); sin acciones salvo "Deshacer" (ND-8).

### 4.3 Wireframes

Mobile 320-400 px (una columna; la fila de chips scrollea solo dentro de sí misma):

```
┌──────────────────────────────┐
│ Pedidos 3 │ Remesas 1 │ Devoluciones 2⚠ │  ← el tablist hace wrap a 2 filas si hace falta
├──────────────────────────────┤
│ ┌────────┐┌────────┐┌───────┐│
│ │ 2      ││$310.00 ││ 1 ⚠   ││  tiles 3 col, compactos (text-xl)
│ │pendient││a devolv││vencida││
│ └────────┘└────────┘└───────┘│
│ [Por devolver 2][Verificar 1][Vencidas 1][Reemb.][No procede][Todas] → │
│ [Todas | Pedidos | Remesas]   │
│ [🔍 Buscar número, cliente  ] │
│ ┌──────────────────────────┐ │
│ │▌PEDIDO ORD-1042          │ │  ▌= borde izq. 4 px rojo (redundante con el texto)
│ │ Devolución debida        │ │
│ │ $250.00 USD              │ │
│ │ ⚠ Vencida hace 1 día háb.│ │
│ │ Juan P. · juan@…         │ │
│ │ Cancelado 15/10 por admin│ │
│ │ Zelle: Cuenta A · ref 88…│ │
│ │ [ Marcar reembolsado    ]│ │  primaria ancho completo 44 px
│ │ [Copiar datos][No procede]│ │  secundarias en 2 col
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

Tablet 640-1023 px: resumen 3 col; tarjetas 1 col con cuerpo en 2 columnas (cliente | pago); acciones en una fila alineadas a la derecha.

Desktop ≥1024 px (dentro de la tarjeta del panel existente):

```
┌ Resumen: [2 pendientes] [$310.00 USD] [1 vencida · 1 vence hoy] ─────────────────────────┐
│ chips…                                   [Todas|Pedidos|Remesas]  [🔍 buscar……]          │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│▌PEDIDO ORD-1042  Devolución debida │ Juan P. juan@… +1 305… │ $250.00 USD │ ⚠ Vencida 1d  │
│  Cancel. 15/10 10:32 · admin Ana · "sin stock" │ Zelle Cuenta A · ref 88231 [Ver comp.]  │
│                                  [Copiar datos] [No procede] [Marcar reembolsado]       │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│▌REMESA REM-0311  Verificar recepción │ … │ $60.00 USD │ ⏱ Vence mañana                    │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

Tarjetas, no `ResponsiveTableWrapper`: la cola es chica y con muchas acciones, y la bandeja existente ya usa tarjetas
(consistencia antes que tabla). `ResponsiveTableWrapper` queda como opción para el historial "Reembolsadas / Todas" si
crece (ND-9). `BulkDeleteBar` **no** se reusa: un "marcar reembolsado" masivo es inseguro (cada devolución lleva su
propia referencia).

### 4.4 Estados

- Carga: patrón `InboxSkeleton` (3 placeholders, `role="status"`).
- Error de primera carga: alerta roja + Reintentar. Fallo posterior: banner ámbar stale, se mantiene la última lista.
- Vacío (estado de lanzamiento): panel neutro con CheckCircle: "No hay devoluciones pendientes. Cuando se cancele un pedido o remesa con pago, aparecerá aquí con su plazo de 5 días hábiles." Vacío por filtro: "Nada en este filtro".
- Carrera: si una acción choca con un cambio de estado (p. ej. el dueño reabrió) → toast "La operación cambió; lista actualizada" + recarga (mismo manejo CONFLICT de las transiciones).

## 5. Notificaciones

### 5.1 Badge del avatar (`Header.jsx:86-108,410-420`)

- **Sumar** las devoluciones pendientes (A + B, estado pendiente) al conteo existente, manteniendo la invariante
  *badge = suma de los conteos de las pestañas de trabajo*. La pestaña Devoluciones usa exactamente el mismo predicado.
- **Escalado por vencidas**: con ≥1 vencida, añadir un **marcador "!"** en la esquina opuesta del badge (no solo color)
  y extender el sr-only: "5 elementos pendientes, 1 devolución vencida". El rojo del conteo mantiene su significado ("actuar").
- Mantener "fuente que falla cuenta 0" para el conteo de devoluciones.
- Realtime: reusar `useRealtimeOrders` + `useRealtimeRemittances` ya suscritos en Header (cancelar/reabrir son updates de
  esas filas); cuando exista la tabla de devoluciones, suscribirla también. Polling 30 s se mantiene. "Vencida" cambia con
  el tiempo, no con eventos → recalcular en cada poll.
- Ítem "Panel de Usuario" del menú: mostrar el mismo chip de conteo (+ pasar el ternario hardcodeado a `t()`).
- Corregir el predicado de `get_pending_orders_count` (bug §1).

### 5.2 Indicador en la pestaña (`CountBadge` de `AdminWorkTabs`)

Conteo en gris neutro como las demás; con vencidas → chip red-50/red-800 con AlertTriangle y sr-only "2 devoluciones, 1 vencida".

### 5.3 Tarjeta en Dashboard → Resumen

Solo si pendientes > 0. Arriba del Resumen, sobre los KPIs (jerarquía: lo que exige acción antes que lo que se lee).
Ámbar si todo está en plazo, rojo si hay vencidas. Contenido: "3 devoluciones pendientes · $410 · 1 vencida" + botón
"Ir a devoluciones" (44 px) → `user-panel?tab=refunds`. `role="alert"` **solo** con vencidas; si no, `role="status"`
(evita anunciar en cada visita).

## 6. Accesibilidad, responsive, i18n, tokens

- Badge: número visible `aria-hidden`, frase completa en sr-only (patrón existente). Región live en el panel anuncia "1 nueva devolución pendiente" (patrón `liveNew`).
- Nunca solo color: cada nivel del semáforo tiene icono + palabras; el borde izquierdo es una pista redundante.
- Contraste: texto -700/-800 sobre fondos -50/-100 (ya usados: `text-amber-700`, `text-red-700`, `bg-yellow-100 text-yellow-800`) — AA para texto chico.
- Objetivos táctiles: todos los botones/chips `min-h-[44px]` (los chips de la bandeja tienen 40 px — subir en la vista nueva). Gap preexistente: el botón del avatar mide 32-36 px (`h-8 w-8 sm:h-9 sm:w-9`, `Header.jsx:405`).
- Foco: constante `FOCUS_RING`; los modales devuelven el foco al botón que los abrió.
- Teclado: las flechas del tablist incluyen la pestaña nueva (extender `TABS`).
- Movimiento: sin pulso/parpadeo en el badge (WCAG 2.3; molesto con polling de 30 s); un único scale-in de 150 ms al subir el conteo, desactivado con `prefers-reduced-motion`.
- i18n: nuevo namespace `adminRefunds.*` en `ES.json`/`EN.json` (tabs, chips, niveles, plazos con `{count}`, labels de modales, vacíos, frases sr-only). Fechas con `toLocaleDateString(language)`; montos con `Intl.NumberFormat` y la moneda de la fila.
- Mobile-first 320 → 1280; los tiles bajan a text-xl en 320; sin scroll horizontal de página (la fila de chips scrollea dentro de sí con borde degradado).
- Psicología del color: rojo = debido y tarde (urgencia), ámbar = vence pronto (atención), verde/neutro = en plazo / hecho (calma). La acción primaria conserva el azul de la app (`bg-blue-600`) para que "marcar reembolsado" se lea como el siguiente paso normal, no como peligro. "No procede" es botón outline neutro, nunca rojo (no es destructivo, es una decisión).

## 7. Riesgos de UX y mitigación

| Riesgo | Mitigación |
|---|---|
| Falso positivo: comprobante subido pero el dinero nunca llegó (todas las remesas, pedidos cancelados por el dueño) | Chip nivel B "Verificar recepción" + checkbox obligatorio "pago confirmado en cuenta X" antes de marcar reembolsado; preset "No procede → el pago nunca llegó" |
| Falso positivo: comprobante ya **rechazado** por admin y luego cancelado | Regla con estado previo a cancelar (§2): `rejected` queda excluido, sin reloj ni alarma |
| Doble reembolso (dos admins, o reembolso y luego reapertura) | "Marcar reembolsado" como transición con lock y CONFLICT en servidor (mismo modelo que `order_*`); quién/cuándo visible en resueltas; bloquear reapertura con reembolso registrado (ND-2) |
| Devolver al destinatario o monto equivocado | El modal repite monto + cliente + referencia original; "Copiar datos" genera un único bloque exacto |
| "No procede" usado para esconder trabajo | Motivo obligatorio con actor registrado; chip propio; solo lo resuelto sale del badge |
| Error de conteo de días hábiles → falso "vencida" | Regla explícita (ND-4); fecha límite absoluta junto al texto relativo |
| Sumar monedas distintas | Resumen agrupado por moneda |
| KPIs siguen contando ingresos reembolsados | Fuera del alcance UI; ND-7 |
| Badge inflado por pedidos cancelados `pending/pending` (bug actual) | Corregir el predicado en el mismo cambio (§1) |

## 8. Decisiones para el dueño (ND)

- **ND-1 Remesas solo como "verificar recepción".** Solo el cliente cancela remesas y nunca tras validar, así que ninguna es devolución confirmada. Recomendación: incluirlas como nivel B. Confirmar también que el admin **no** debe tener acción de cancelar remesas (hoy no la tiene).
- **ND-2 Reapertura tras devolución.** Recomendación: bloquear la reapertura del dueño cuando haya devolución registrada; si reabre antes, el registro pasa a "no procede: reabierto" automáticamente.
- **ND-3 Persistencia.** Recomendación: tabla `refunds` (entity_type, entity_id único, tier, state pending|refunded|not_applicable, amount, currency, reference, refunded_at, resolved_by, reason, due_at) creada **dentro de la transición de cancelación** con los valores `OLD` (única forma fiable de saber si había pago), y resuelta por RPCs SECURITY DEFINER con lock de fila. Alternativa: columnas en orders y remittances (duplicadas).
- **ND-4 Regla de días hábiles.** Recomendación: lunes a viernes, hora del Este de EE. UU. (coherente con los límites Zelle), sin calendario de feriados en v1; el plazo empieza al cancelar y el día de cancelación no cuenta. Confirmar `REFUND_BUSINESS_DAYS=5` como definitivo (sigue "proposal").
- **ND-5 Destino del reembolso.** No se guarda el Zelle del cliente. Recomendación v1: mostrar `payer_phone` + email de la cuenta + referencia original; el admin devuelve al remitente que ve en la cuenta Zelle del negocio. v2 opcional: pedir el Zelle del cliente al cancelar.
- **ND-6 Monto.** Pedidos `total_amount` (o `payment_amount` si existe), remesas `amount_sent + delivery_cost`. Confirmar descuentos/comisión = "total pagado".
- **ND-7 Finanzas.** ¿Restar operaciones reembolsadas de KPIs del Dashboard / uso Zelle? Recomendación: sí, en un cambio posterior.
- **ND-8 Deshacer.** Recomendación: solo super_admin, registrado.
- **ND-9 Profundidad del historial.** Resueltas: últimos 30 días en esta pestaña; historial completo en un reporte de Dashboard si hace falta.
- **ND-10 Composición del badge.** Recomendación: sumado + marcador "!" de vencidas. Alternativa: segundo badge separado (más claro, pero saturado en un avatar de 32 px).
- **ND-11 Comprobante rechazado y luego cancelado.** Recomendación: excluir (el admin ya juzgó). Alternativa: listarlo sin reloj como "revisar".

## 9. No verificado

- Sin render real: wireframes, wrap del tablist de 3 pestañas a 320 px y contraste de chips nuevos no medidos en navegador.
- Sin datos reales de cancelación en prod (0 filas): regla de niveles, montos y fechas derivadas del historial no probados con datos.
- Semántica de `payment_amount` en pedidos Zelle inferida del código, no confirmada.
- Que `changed_by` de `order_status_history` resuelva a un nombre legible (join a `user_profiles`) no se comprobó.
