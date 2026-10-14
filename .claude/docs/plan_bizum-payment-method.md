# Plan: Bizum como método de pago separado de Zelle (borrador para crítica adversarial)

Estado: PROPUESTA, nada implementado. Fecha: 2026-10-14.
Insumos: informe de investigación de Bizum (fuentes mayormente secundarias; casi nada confirmado en fuentes oficiales) y mapa del código/BD de Zelle (ver sección "Hechos").

## 1. Hechos que condicionan el diseño

De la investigación de Bizum (confianza media/baja, ver fuentes en el informe):
- Hay DOS productos: **Bizum P2P** (entre personas, sin API ni webhook: se verifica a mano contra el extracto del banco) y **Bizum para comercios** (TPV virtual Redsys vía el banco: notificación automática firmada por pago, costo negociado, ~12 bancos).
- Quien paga necesita cuenta bancaria española/andorrana; solo EUR. Un cliente en Cuba/EE. UU. NO puede pagar por Bizum.
- Límites P2P citados: 1.000 € por operación enviada, 2.000 €/día enviado, recepción 2.000 €/día y 60 operaciones/mes; varían por banco (ABANCA, fuente oficial: 500 €/operación).
- Riesgo regulatorio/bancario: los bancos restringen el uso profesional del P2P; desde 2026 deben informar a Hacienda los cobros Bizum de autónomos/empresas; recibir EUR para enviar valor a Cuba puede requerir licencia de entidad de pago/AML (NO verificado; requiere asesoría legal).
- NO verificado: si hay referencia única por transacción, campos de la captura, longitud del concepto, nombre del emisor visible.
- Las capturas son falsificables (igual que en Zelle); el único control fuerte es el extracto bancario.

Del código/BD de Zelle (BD viva):
- `orders.payment_method` es texto libre sin CHECK (24/24 = 'zelle'); `remittances` NO tiene `payment_method` ni `payment_status`; `zelle_account_id` es FK solo a `zelle_accounts`.
- `zelle_transaction_history` (25 filas para 47 pedidos/remesas con cuenta) no tiene moneda ni método; el sync al validar se OMITE si `zelle_account_id` es null (`orderService` ~1235/1385).
- No existe contabilidad global: el Dashboard calcula en JS y suma `total_amount`/`amount_sent` sin mirar moneda (EUR+USD se sumarían crudos). Monedas: solo USD (base) y CUP activas; EUR inactiva; no hay tasa EUR→USD activa.
- Prueba: pedidos → bucket PÚBLICO `order-documents` (URL en `payment_proof_url`); remesas → bucket privado `remittance-proofs` (ruta + signed URL). Existe un bucket privado `order-payments` sin uso.
- `createRemittance` lanza error si no hay cuenta Zelle (no hay camino sin Zelle). Montos de historial inconsistentes (totalToPay al crear vs `amount_sent` al validar).
- Toggles existentes: solo por cuenta (`zelle_accounts.is_active`, `for_products`, `for_remittances`). `system_config` solo permite escribir 2 claves de margen; `notification_settings` es escribible por admin.

## 2. Principios

1. Bizum es una **fuente divergente** (cuentas, prueba, verificación y moneda propias), no una variante de Zelle.
2. Ambas alimentan **un único libro de pagos** con moneda original y equivalente en USD con tasa congelada; los totales globales salen del libro, no de sumar tablas operativas.
3. Los métodos se activan/desactivan con un interruptor global verificado en servidor, sin dejar varados los pedidos en vuelo.
4. ⚠ FALSO según §9.7 (el libro y los CHECK sí cambian comportamiento en F0). ~~Cero cambio de comportamiento para Zelle mientras Bizum esté apagado.~~ Bizum se entrega apagado por defecto.
5. No se confía en capturas: la validación Bizum se ancla al extracto bancario (referencia ingresada por el admin, única).

## 3. Modelo de datos propuesto

> ⚠ Parcialmente reemplazado por §9.2 (libro: trigger único, append-only, sin INSERT de cliente) y §9.3 (FX sellado en servidor; sin gateway).

**3.1 `payment_methods`** (2 filas: zelle, bizum): `code` PK, `display_name`, `currency` ('USD'|'EUR'), `is_enabled`, `enabled_for_products`, `enabled_for_remittances`, `proof_mode` ('screenshot'|'gateway'), `sort_order`, `updated_by/at`. Escritura: solo admin/super_admin (RLS). Lectura cliente: RPC `list_payment_methods_public()` (SECURITY DEFINER) devuelve solo los habilitados para el flujo pedido. Invariante: no se puede dejar sin ningún método habilitado por flujo (trigger).

**3.2 `bizum_accounts`** (separada de `zelle_accounts`): `id`, `account_name`, `holder_name`, `phone` (receptor), `bank_name`, `is_active`, `for_products`, `for_remittances`, `priority_order`, `receive_daily_limit`, `receive_monthly_ops_limit`, notas. Límites orientativos igual que Zelle.

**3.3 Método en las operaciones**: `remittances.payment_method` (default 'zelle', CHECK) y CHECK en `orders.payment_method` (valores conocidos); `bizum_account_id` en ambas (nullable, FK) con CHECK de coherencia (método zelle ⇒ `zelle_account_id` NOT NULL y bizum null, y viceversa). Montos de pago: `payment_currency`, `payment_amount`, `fx_rate_to_base`, `fx_rate_at` (congelados al crear).

**3.4 `payment_ledger`** (libro unificado): `id`, `method_code`, `source_type` ('order'|'remittance'), `source_id`, `zelle_account_id`/`bizum_account_id` (CHECK exactamente uno según método), `currency`, `amount`, `amount_base_usd`, `fx_rate`, `status` ('pending'|'validated'|'rejected'|'refunded'), `external_reference` (referencia bancaria Bizum; UNIQUE por método cuando no es null), `proof_hash` (sha-256 de la imagen), `validated_by/at`, `created_at`. Se alimenta por triggers/RPC de validar/rechazar de cualquier método (se elimina la omisión "si no hay zelle_account_id"). Backfill desde los 47 pedidos/remesas con Zelle (no desde `zelle_transaction_history`, incompleta). Los totales del Dashboard pasan a leer el libro (suma en USD base, desglose por método y moneda).

**3.5 Cómo distinguir "Bizum P2P" de "Bizum comercio"**: `proof_mode` por método; el comercio (Redsys) sería un adaptador posterior (Edge Function + webhook firmado que escribe en el libro como 'validated'); fuera de la primera entrega.

## 4. Lógica de prueba y verificación Bizum (P2P)

> ⚠ Reemplazado en lo sustancial por §9.3 y §9.5 (referencia bancaria opcional, proof_hash no es control, importe EUR congelado, sin cuenta regresiva).

- La app genera un **código de pago único** por pedido/remesa (p. ej. `PE-7K3Q`) que el cliente debe poner en el concepto del Bizum.
- Importe en EUR calculado con tasa USD→EUR congelada con vigencia (p. ej. 30 min o hasta crear el pedido) + spread configurable; el cliente ve "Envía exactamente X,XX €".
- Formulario de prueba compartido con campos por método; Bizum exige captura + importe EUR + fecha/hora + teléfono del pagador.
- Validación del admin: lista de comprobación (importe esperado, código, teléfono, vigencia de tasa) y **campo obligatorio "referencia del extracto bancario"**; índice único evita reutilizar el mismo Bizum en dos operaciones; `proof_hash` detecta la misma imagen reutilizada.
- Prueba en bucket privado `order-payments` con signed URLs para Bizum (los pedidos Zelle siguen en `order-documents` público, problema existente a corregir aparte).
- Elegibilidad en la UI: "Solo con cuenta bancaria española"; aviso si el total supera 1.000 € (límite habitual por operación).
- Reembolsos: manuales y fuera del sistema (P2P irreversible); se registra estado 'refunded' en el libro.

## 5. Interruptores (activar/desactivar Zelle y/o Bizum)

> ⚠ Reemplazado por §9.4 (RPC único con advisory lock, auditoría dentro del RPC, bypass de contextos confiables).

- Interruptor global por método y por flujo (productos/remesas) en `payment_methods`; por cuenta se mantiene `is_active`.
- Desactivar un método oculta la opción para operaciones NUEVAS; las pendientes con prueba subida siguen siendo validables/rechazables y el cliente puede subir comprobante de una operación en vuelo.
- Verificación en servidor: trigger BEFORE INSERT en `orders`/`remittances` rechaza (para rol cliente) un método deshabilitado o sin cuenta disponible, con error legible; cubre la carrera "el cliente ya estaba en el checkout cuando se apagó".
- Invariante: al menos un método habilitado por flujo; si el admin intenta apagar el último, se bloquea con explicación.
- Diálogo de confirmación al apagar: muestra operaciones pendientes con ese método.
- Registro en `activity_logs` de quién y cuándo cambió el interruptor.

## 6. UX/UI propuesta

> ⚠ Reemplazado por §9.6: NO construir el selector de dos tarjetas; Zelle por defecto y Bizum tras autodeclaración de elegibilidad.

Checkout (carrito y remesa), paso "Método de pago":
- Si solo hay UN método habilitado: no se muestra selector (UX actual intacta).
- Si hay dos: dos tarjetas seleccionables lado a lado — **Zelle (USD)** y **Bizum (EUR)** — cada una con una línea de elegibilidad ("Cuenta en EE. UU." / "Solo con cuenta bancaria española"), el importe en SU moneda y el equivalente "≈" en la otra.
- Panel específico del método: Zelle conserva selector de cuenta y aviso de límites; Bizum muestra el número receptor con botón copiar, el **código de concepto** destacado con botón copiar, pasos numerados ("1 Abre tu app del banco → Bizum → Enviar dinero · 2 Pega el número · 3 Importe exacto · 4 Concepto: el código"), cuenta regresiva de vigencia de la tasa.
- Luego, el formulario de comprobante compartido con pistas según método.
- Estados de error claros: método desactivado entre pasos, tasa vencida (recalcular), importe sobre el límite.

Admin:
- Settings → "Métodos de pago" (pestaña padre) con subpestañas Zelle | Bizum | Estado: interruptores maestros por método y flujo con confirmación; el resto de cuentas como hoy.
- Modal de validación consciente del método con la lista de comprobación y la referencia bancaria obligatoria (Bizum).
- Dashboard: tarjeta "Cobros" por método con moneda original y equivalente USD; total global en USD con nota de conversión; filtro por método; vista de conciliación (validados sin referencia bancaria, pendientes viejos).

## 7. Plan por fases (cada una desplegable sola)

> ⚠ Reemplazado por §9.8 (nueva fase F-1 de seguridad antes de F0) y §9.7 (rollout NOT VALID + VALIDATE).

- **F0 Fundaciones (sin Bizum visible)**: `payment_methods` (zelle habilitado) + interruptor y su UI; `remittances.payment_method` + CHECKs; `payment_ledger` + backfill + escritura en validar/rechazar para todo método (arregla la omisión y la inconsistencia de montos); Dashboard lee del libro con conversión a USD. Zelle sin cambios de comportamiento.
- **F1 Bizum P2P (apagado por defecto)**: `bizum_accounts`, columnas de pago/FX, tasas EUR, código de concepto, UI de checkout y admin, validación con referencia bancaria, bucket privado. Se enciende solo tras resolver las preguntas de negocio/legal.
- **F2 Bizum comercios (Redsys)**: adaptador con webhook; solo si el banco lo ofrece y el volumen lo justifica.

## 8. Preguntas abiertas para el dueño (bloquean F1, no F0)

1. ¿Sociedad o autónomo? ¿Su banco ofrece Bizum para comercios (TPV Redsys) o solo P2P? Límites reales de recepción.
2. ¿Permite el banco el P2P en cuenta profesional y la actividad de remesas? (por escrito)
3. Situación legal/licencia (asesoría legal).
4. ¿Qué muestra el extracto por cada Bizum recibido (referencia, nombre del emisor)?
5. Política de cambio EUR→USD y quién asume el riesgo; spread.
6. ¿Dónde se mantienen los fondos y existe entidad legal en España?

---

## 9. REVISIÓN ADVERSARIAL (2 críticos independientes) — cambios obligatorios al borrador

> Etiquetado de evidencia: SOLO §9.1 fue verificado contra la BD viva por la sesión principal (consultas de solo lectura: política orders_update, triggers de orders, políticas de storage, activity_logs). §9.2–§9.8 son hallazgos de los críticos NO verificados aún (p. ej. "EUR inactiva y sin tasa EUR→USD", "historial usa totalToPay al crear y amount_sent al validar"): confirmar con consulta antes de implementar.

### 9.1 Prerrequisito de seguridad que NO depende de Bizum (hallazgos verificados)
- **`orders` no tiene guard del dueño.** `orders_update`: USING (dueño OR admin), sin WITH CHECK; `authenticated` tiene UPDATE; triggers solo de auditoría/numeración/timestamp. Un cliente puede modificar su pedido por la API (`status`, `payment_status`, `total_amount`, `payment_method`, `zelle_account_id`). Cualquier libro alimentado por triggers de `orders` convertiría esa falsificación en un cobro "validado". → Nueva fase **F-1 (seguridad)** ANTES de cualquier libro: guard de UPDATE (lista blanca, como `guard_remittance_owner_update`) y de INSERT para `orders`.
- **Storage:** las políticas `Users Can Update/Delete Their Own Files 16wiy3a_0` (`auth.uid() = owner`) no filtran por bucket: el cliente puede reemplazar o borrar su propio comprobante tras la validación. `order-documents` es de lectura pública. → quitar/acotar esas políticas; comprobantes Bizum en `order-payments` (solo INSERT para el usuario); al validar, copiar el objeto a una ruta solo-admin.
- **`activity_logs` INSERT con `check=true`** para cualquier autenticado: la auditoría del interruptor sería falsificable → el log del interruptor se escribe DENTRO del RPC del interruptor.

### 9.2 Libro de pagos (§3.4) — correcciones
- Una sola fuente de verdad: **trigger AFTER UPDATE sobre la transición de estado** de pedidos/remesas (no código de aplicación Y trigger). `UNIQUE (source_type, source_id)` + `ON CONFLICT DO UPDATE` (idempotente ante doble clic / dos admins).
- El libro **no tiene políticas INSERT/UPDATE/DELETE**; solo lo escriben funciones SECURITY DEFINER que revalidan rol. No copiar `zth_insert_pending_only`.
- **Append-only**: reversos como filas negativas con `reverses_id`; tabla de transiciones permitidas; `FOR UPDATE` sobre la fuente en validar/rechazar. Agregar `amount_expected` y `amount_received` (+ marca de tolerancia) para pagos de importe incorrecto.
- Importe canónico = lo que el cliente transfirió (`amount_sent + delivery_cost`); hoy el historial usa totalToPay al crear y `amount_sent` al validar. Backfill con `source='backfill'` y la tasa de la fecha; avisar que los totales del Dashboard cambiarán; Dashboard detrás de un flag con totales lado a lado durante un periodo de conciliación.
- Vista de conciliación: validadas sin fila de libro.

### 9.3 FX (§3.3/§4)
- La tasa congelada NO puede venir del cliente (hoy los montos y tasas de remesa los calcula el cliente). → RPC de creación SECURITY DEFINER que lee `exchange_rates` (solo admin escribe) y sella `payment_amount`, `fx_rate_to_base`, `fx_rate_at`; trigger que rechaza fx_* que no coincidan. EUR hoy inactiva y sin tasa EUR→USD: F1 exige tasa vigente (con chequeo de antigüedad). `numeric(14,2)`, redondeo único.
- **Sin cuenta regresiva.** Importe en EUR congelado al CREAR la operación y válido toda la ventana de pago (p. ej. 24 h). Nunca bloquear a quien ya pagó; si el importe recibido difiere, el admin acepta el recibido y concilia la diferencia.

### 9.4 Interruptores (§5)
- Un único RPC para alternar, con `pg_advisory_xact_lock(hashtext('payment_methods'))` y `FOR UPDATE`; los triggers de creación toman el lock compartido (patrón `guard_platform_reset_lock`). Invariante "al menos un método por flujo" dentro del RPC.
- Trigger de creación con bypass de contextos confiables (service_role, `auth.uid() IS NULL`, admins) y orden de nombre documentado respecto de `guard_remittance_owner_insert`.
- `list_payment_methods_public` con lista explícita de columnas.
- `remittances.payment_method` y columnas nuevas NO se agregan a la lista blanca del guard de UPDATE del dueño (quedan bloqueadas por defecto).

### 9.5 Prueba Bizum (§4)
- Código de concepto de ≥8 caracteres de alfabeto sin ambigüedades, único y nunca reutilizado; la búsqueda por código es solo-admin.
- `proof_hash` se evade re-codificando la imagen: no es control de unicidad; el control real es la referencia bancaria, normalizada (mayúsculas, trim) con índice único PARCIAL (`WHERE status <> 'rejected'`).
- **La referencia bancaria pasa a OPCIONAL pero visible**, con vista de conciliación diaria ("validados sin referencia"). Clave de coincidencia real = importe + código en concepto + fecha. El flujo debe cubrir: importe distinto, pago tardío, pago doble (el segundo a reembolso), código erróneo o ausente (marca manual).
- Formulario Bizum reducido: solo captura + teléfono pagador; importe y código vienen precargados y de solo lectura.
- PII (teléfonos) en `activity_logs` y comprobantes: enmascarar y definir retención. URLs firmadas de 5–10 min generadas por petición.
- Recortar `proof_mode='gateway'` de F0/F1 (esquema muerto; YAGNI): F2 lo añade si se hace.

### 9.6 UX (§6) — cambios al diseño
- **Se descarta el selector de dos tarjetas visibles para todos.** Zelle queda preseleccionado; Bizum aparece tras una pregunta de elegibilidad por autodeclaración ("¿Pagas desde una cuenta bancaria en España?"), recordada por usuario. Sin detección por IP/idioma (poco fiable para la diáspora). Copy mínimo honesto: "Necesitas una cuenta bancaria en España y la app Bizum de tu banco. Pagas en euros."
- **El método se elige en el MISMO punto que hoy se elige la cuenta Zelle** (paso del destinatario/cuenta), nunca después de crear la operación; no se edita el método tras crear ("Cancelar y cambiar de método").
- Remesa: mostrar el tipo de cambio y el spread explícitos ("1 USD = 0,92 EUR · incluido"), fijado al crear.
- Instrucciones móviles en el orden del banco: Importe → Teléfono → Concepto, con botones de copiar ≥44 px, `aria-label`, estado "Copiado ✓" visible y respaldo de selección si falla el portapapeles; texto "Envía un Bizum (no 'Solicitar dinero')".
- Admin: Settings conserva la pestaña "Zelle" y suma "Bizum" solo cuando exista F1; una tarjeta de estado de métodos arriba con los interruptores (no una subpestaña "Estado"); diálogo que nombra la consecuencia ("hay N pedidos pendientes que se seguirán validando"); "Apagado por X el DD/MM HH:MM" visible junto al interruptor; cliente a mitad de checkout ve alerta en línea sin perder el formulario.
- Dashboard: por defecto totales por método en moneda nativa; el total en USD es "≈" y se calcula con `amount_base_usd` congelado (nunca con la tasa viva); si falta la tasa congelada se muestra "—".
- Accesibilidad/i18n: tarjetas como `radiogroup`, `aria-live` en el copiado, claves en ES.json/EN.json con test de paridad (no ternarios en línea), estados de carga/vacío/error definidos.

### 9.7 Rollout sobre datos vivos (§7)
- Todas las restricciones nuevas `NOT VALID` + `VALIDATE` aparte, tras contar infractores con SELECT. Mantener `DEFAULT 'zelle'` permanente en `remittances.payment_method` (pestañas viejas no lo envían). Backfill por lotes con índices creados antes. Rollback: bajar primero los triggers del libro; Dashboard en doble lectura hasta conciliar.
- Principio 4 corregido: "cero cambio de comportamiento para Zelle" es FALSO en F0 (validar empieza a escribir libro; los totales del Dashboard cambian; los CHECK/guards pueden rechazar escrituras legadas). Se declara y se mitiga con el flag de Dashboard y el periodo de conciliación.

### 9.8 Fases revisadas
- **F-1 Seguridad (independiente de Bizum, urgente):** guard de UPDATE/INSERT del dueño en `orders`; acotar políticas de Storage por bucket; (opcional) cierre del INSERT abierto de `activity_logs` para acciones sensibles.
- **F0 Fundaciones:** `payment_methods` + RPC de interruptor + UI; `remittances.payment_method`; libro con backfill y trigger; Dashboard desde el libro tras flag.
- **F1 Bizum P2P (apagado):** solo tras responder las preguntas de negocio/legales #1–#4.
- **F2 Bizum comercios (Redsys):** si el banco lo ofrece.
- **Alternativa de menor riesgo para validar la demanda antes de F1:** enlace "Pagar desde España" que abre una página/flujo asistido (p. ej. WhatsApp) con cotización fija en EUR, sin tocar carrito ni wizard.
