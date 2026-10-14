# Runbook: despliegue de la reserva atomica de stock

Alcance: migraciones `20261014190000_atomic_stock_reservation.sql`,
`20261014200000_product_delete_safety_and_ledger.sql` y `20261014210000_drop_movements_insert_policy.sql`
(esta ultima va DESPUES del front), mas el build del front de esta rama (`feat/atomic-stock-reservation`). Proyecto Supabase `qcwnlbpultscerwdnzbm`.

Reglas de este runbook: cada paso que ESCRIBE en remoto (aplicar migraciones, agendar cron,
desplegar) necesita su propio "dale" explicito del owner. Los pasos de verificacion son solo
`SELECT`. Nada de esto se ejecuto contra remoto desde el desarrollo (solo SELECT de verificacion).

## 0. Orden exacto

1. Sondas previas (seccion 1) y revision de resultados. Si algo no coincide, parar.
2. Gate de ventana (seccion 4): sin pagos en validacion mientras dure el corte; avisar a admins.
3. Backup (seccion 0.2).
4. Aplicar `20261014190000_atomic_stock_reservation.sql` (mecanismo de la seccion 0.1).
5. Verificacion posterior parcial (secciones 2.1 a 2.3).
6. Aplicar `20261014200000_product_delete_safety_and_ledger.sql`.
7. Verificacion posterior completa (seccion 2).
8. Desplegar el front (Vercel) inmediatamente despues. No dejar el SQL nuevo con el front viejo mas de unos minutos.
9. Avisar a admins y vendors: recargar todas las pestanas abiertas del panel (Ctrl+F5) y confirmar que lo hicieron.
10. Aplicar `20261014210000_drop_movements_insert_policy.sql` SOLO despues del paso 9: el build viejo todavia inserta
    movimientos desde el navegador a traves de esa policy (version skew); quitarla antes rompe pestanas abiertas.
11. Agendar pg_cron (seccion 3). Sin cron las reservas no expiran: es el release gate.
12. Monitoreo de las primeras 24 h (seccion 5).

Lista final de migraciones a aplicar en remoto, en este orden: `20261014190000` -> `20261014200000` -> (front + recarga) -> `20261014210000`.

Por que este orden: la migracion 2 depende de `order_stock_allocations`, `reserved_change` y del flag
`app.stock_rpc` que crea/usa la migracion 1. El front nuevo llama a RPCs que solo existen tras las migraciones 1 y 2
(`delete_product`, `get_combo_blockers`, `orders_with_consumed_stock`); el front viejo no conoce el cupo por cliente ni la reserva.

### 0.1 Mecanismo de aplicacion (las versiones remotas NO coinciden con los prefijos locales)

Las versiones del historial remoto son las marcas de tiempo de cuando se aplico cada migracion, no los nombres de archivo
locales. Ejemplo verificado con `list_migrations`: el archivo local `20261014180000_user_profiles_role_guard_and_reset_disarm.sql`
figura en remoto como `20261014183031`; `20261014134641` (remittances_owner_insert_guard) etc. Por eso:

- NUNCA `supabase db push`: compara por version, vera como pendientes migraciones ya aplicadas con otro prefijo y puede reaplicarlas.
- Aplicar cada archivo con `apply_migration` (Supabase MCP / dashboard) usando como `name` el nombre sin prefijo
  (`atomic_stock_reservation`, `product_delete_safety_and_ledger`, `drop_movements_insert_policy`). Eso registra la version remota nueva.
- Registrar en este runbook / en el PR las versiones remotas que se asignen (`SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;`).
- Alternativa si se ejecuta el SQL a mano: despues `supabase migration repair --status applied <version_remota>` con la version asignada.
- Cada aplicacion remota requiere su propio "dale" del owner.

### 0.2 Backup previo

Antes del paso 4 (las tablas se crean en `public`; borrarlas despues de la ventana de monitoreo):

```sql
CREATE TABLE public._bak_inventory_20261014 AS SELECT * FROM public.inventory;
CREATE TABLE public._bak_orders_stock_20261014 AS
  SELECT id, status, payment_status, created_at FROM public.orders;     -- aun no existen las columnas stock_*
CREATE TABLE public._bak_inventory_movements_20261014 AS SELECT * FROM public.inventory_movements;
-- RLS: estas copias no deben ser legibles por la API
ALTER TABLE public._bak_inventory_20261014 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_orders_stock_20261014 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_inventory_movements_20261014 ENABLE ROW LEVEL SECURITY;
```

Si el plan de Supabase tiene PITR, anotar la hora exacta del punto de restauracion antes de aplicar (Dashboard -> Database -> Backups).
Guardar tambien los cuerpos vivos actuales: `supabase/rollbacks/20261014_bulk_delete_live_bodies.sql` (ya capturados con SELECT el 2026-10-14;
volver a comparar con `pg_get_functiondef` justo antes de aplicar por si cambiaron).

## 1. Sondas previas en remoto (solo SELECT)

```sql
-- 1.1 Filas que romperian el CHECK reserved <= quantity (debe devolver 0)
SELECT count(*) FROM public.inventory WHERE COALESCE(reserved_quantity,0) > quantity;

-- 1.2 order_items con inventory_id (verificado 2026-10-14: 126 order_items, 0 con inventory_id; ordenes: 25)
SELECT count(*) total, count(inventory_id) con_inventory_id FROM public.order_items;
SELECT count(*) AS ordenes FROM public.orders;                   -- 25 el 2026-10-14 (126 es el conteo de order_items)

-- 1.3 Productos hoy en pedidos abiertos que el borrado NO bloqueaba.
--     Esperado 2026-10-14: 15 productos directos, 0 via combo.
SELECT count(DISTINCT oi.item_id) AS productos_directos FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
 WHERE o.status NOT IN ('dispatched','delivered','completed','cancelled')
   AND oi.item_id IN (SELECT id FROM public.products);
SELECT count(DISTINCT ci.product_id) AS productos_via_combo FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id JOIN public.combo_items ci ON ci.combo_id = oi.item_id
 WHERE o.status NOT IN ('dispatched','delivered','completed','cancelled');

-- 1.4 Distribucion de estados de pedidos (el predicado es fail-closed: estados desconocidos bloquean)
SELECT status, payment_status, count(*) FROM public.orders GROUP BY 1,2 ORDER BY 3 DESC;

-- 1.5 La tabla de log destructivo existe con las columnas esperadas (id, op_type, performed_by, details, created_at)
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_schema='public' AND table_name='admin_destructive_ops_log' ORDER BY ordinal_position;

-- 1.6 inventory_movements vacia o casi (el ledger empieza vacio: sin backfill)
SELECT count(*) FROM public.inventory_movements;

-- 1.7 Triggers actuales en inventory y orders (no deben chocar con los nuevos)
SELECT tgrelid::regclass, tgname FROM pg_trigger
 WHERE tgrelid IN ('public.inventory'::regclass,'public.orders'::regclass,'public.order_items'::regclass) AND NOT tgisinternal;

-- 1.8 Policy que se elimina (guardar su definicion actual por si hace falta rollback)
SELECT policyname, cmd, with_check FROM pg_policies WHERE tablename='inventory_movements';

-- 1.9 pg_cron disponible
SELECT extname, extversion FROM pg_extension WHERE extname='pg_cron';

-- 1.10 Claves de configuracion existentes
SELECT key, value_numeric FROM public.system_config WHERE key LIKE 'stock_%';

-- 1.10b Tipo de las columnas del ledger (esperado text; las migraciones convierten si fueran enum)
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name='inventory_movements' AND column_name IN ('movement_type','reference_type');

-- 1.11 Pedidos nuevos desde la ultima verificacion (los pedidos existentes quedan stock_managed=false y NO se tocan)
SELECT count(*) FILTER (WHERE status IN ('pending','processing')) abiertos, count(*) total FROM public.orders;
```

## 2. Verificacion posterior (solo SELECT)

```sql
-- 2.1 Columnas y tablas
SELECT column_name FROM information_schema.columns
 WHERE table_name='orders' AND column_name IN ('stock_managed','stock_reserved','stock_reserved_at');
SELECT count(*) FROM public.order_stock_allocations;           -- 0 al inicio
SELECT column_name FROM information_schema.columns WHERE table_name='inventory_movements' AND column_name='reserved_change';

-- 2.2 Pedidos existentes intactos: todos stock_managed=false (el cutover)
SELECT stock_managed, count(*) FROM public.orders GROUP BY 1;   -- los 25 previos (2026-10-14) en false

-- 2.3 Funciones con search_path fijado y sin EXECUTE para anon
SELECT p.proname, p.proconfig, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosecdef
   AND p.proname IN ('reserve_order_inventory','release_order_inventory','consume_order_inventory','restock_order_inventory',
                     'expire_stale_order_reservations','get_stock_policy','set_stock_policy','reset_stock_policy',
                     'get_product_blockers','bulk_delete_products','preview_bulk_delete_products','release_stock_on_order_cancel')
 ORDER BY 1;                                                    -- anon_exec = false en todas

-- 2.4 Triggers nuevos
SELECT tgrelid::regclass, tgname, tgenabled FROM pg_trigger
 WHERE tgname IN ('release_stock_on_order_cancel','guard_order_items_insert','guard_orders_stock_columns',
                  'trg_inventory_ledger_ins','trg_inventory_ledger_upd','guard_inventory_reserved_edit','trg_inventory_delete_snapshot');
                                                                -- 7 filas, tgenabled = 'O'

-- 2.5 Politica de movimientos: sigue EXISTIENDO hasta aplicar 20261014210000 (version skew); despues de ese paso debe dar 0
SELECT count(*) FROM pg_policies WHERE tablename='inventory_movements' AND policyname='inventory_movements_insert_own_order';

-- 2.5b Trigger que protege el ledger y nuevas funciones
SELECT tgname FROM pg_trigger WHERE tgname IN ('guard_inventory_movements_delete','guard_inventory_reserved_insert') AND NOT tgisinternal;
SELECT proname, has_function_privilege('anon', oid, 'EXECUTE') AS anon_exec FROM pg_proc
 WHERE pronamespace='public'::regnamespace AND proname IN ('delete_product','get_combo_blockers','orders_with_consumed_stock','_log_product_ledger_snapshot');

-- 2.6 Politica configurada = valores aprobados 48 / 168 / 5
SELECT key, value_numeric FROM public.system_config WHERE key LIKE 'stock_%' ORDER BY key;

-- 2.7 El predicado de borrado ahora ve lo que antes no (comparar con 1.3; necesita sesion con auth.uid() de admin, por eso
--     se verifica desde la app: Vendor -> seleccionar un producto en pedido abierto -> la vista previa debe decir "bloqueado")
```

## 3. Programar el cron (release gate, paso aparte con su "dale")

Solo despues de desplegar el front y de que los admins recargaron:

```sql
SELECT cron.schedule('expire-stale-order-reservations', '17 * * * *',
                     $$SELECT public.expire_stale_order_reservations()$$);
```

Verificar (SELECT):

```sql
SELECT jobid, jobname, schedule, command, active FROM cron.job WHERE jobname='expire-stale-order-reservations';
-- tras la primera hora:
SELECT status, return_message, start_time FROM cron.job_run_details
 WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='expire-stale-order-reservations') ORDER BY start_time DESC LIMIT 5;
```

Notas: el job corre sin argumentos y usa la politica configurada (Ajustes -> Sistema). Un pedido que falle al
expirar se omite con un WARNING y no aborta el barrido; revisar los logs de Postgres si el conteo parece bajo.

## 4. Riesgo W6: pestanas con el build anterior (ventana de despliegue)

Problema: un admin/cliente con la app abierta desde antes ejecuta codigo viejo que NO llama a las RPCs de reserva
(descuenta/ajusta stock desde el navegador, read-modify-write). Entre "SQL aplicado" y "usuarios recargaron" puede haber
operaciones mezcladas.

Mitigaciones (en orden de efectividad):

1. Aplicar SQL y desplegar el front con minutos de diferencia (pasos 5 a 7), en horario de baja actividad.
2. Pedir a admins/vendors recargar (paso 8) y, si hay forma, no tener pedidos en validacion en ese momento.
3. Lo que el SQL ya frena de forma ruidosa para build viejo: editar `reserved_quantity` o crear un lote con reserva desde el cliente (42501),
   agregar lineas a pedidos ya reservados/cancelados/validados (42501), baja de stock por debajo de lo reservado (CHECK 23514), y borrar
   movimientos del ledger desde el cliente (42501: el borrado de producto del build viejo falla, fail-closed; usar el build nuevo).
   La policy de INSERT de movimientos NO se elimina en esta ventana (migracion `20261014210000`, paso 10 del orden).
   **Gate**: no debe haber pagos en validacion durante el corte (de aplicar la migracion 1 hasta que todas las pestanas recargaron):
   un build viejo que valida un pago descuenta stock a mano y ya no ve la reserva.
4. Lo que NO frena: un build viejo que valide pagos o edite `quantity` ya no ve la reserva; las ediciones de `quantity` quedan
   registradas como `adjustment` ("manual edit"), pero un descuento viejo + consume nuevo podria contar dos veces. Tras la ventana,
   correr las consultas de monitoreo (seccion 5) y reconciliar a mano si hay diferencias.
5. Pedidos creados con build viejo durante la ventana nacen `stock_managed = true` por default de columna y sin reserva; se reservan
   al validar (consume reserva+consume con chequeo de disponibilidad) o los barre el cron si se cancelan.

## 5. Monitoreo (SELECT)

```sql
-- 5.1 reserved_quantity debe igualar la suma de asignaciones 'reserved' por lote (esperado: 0 filas)
SELECT i.id, i.product_id, COALESCE(i.reserved_quantity,0) AS reservado,
       COALESCE(SUM(a.quantity) FILTER (WHERE a.state='reserved'),0) AS en_asignaciones
  FROM public.inventory i LEFT JOIN public.order_stock_allocations a ON a.inventory_id = i.id
 GROUP BY i.id HAVING COALESCE(i.reserved_quantity,0) <> COALESCE(SUM(a.quantity) FILTER (WHERE a.state='reserved'),0);

-- 5.2 Pedidos gestionados y validados sin ninguna asignacion consumida (esperado: 0 filas; inconsistentes)
SELECT o.id, o.order_number, o.status, o.payment_status FROM public.orders o
 WHERE o.stock_managed AND o.payment_status='validated' AND o.status <> 'cancelled'
   AND NOT EXISTS (SELECT 1 FROM public.order_stock_allocations a WHERE a.order_id=o.id AND a.state='consumed');

-- 5.3 Cancelados que aun retienen reserva (huerfanos; el cron los libera; esperado: 0 filas fuera de la ventana horaria)
SELECT o.id, o.order_number FROM public.orders o
 WHERE o.status='cancelled' AND EXISTS (SELECT 1 FROM public.order_stock_allocations a WHERE a.order_id=o.id AND a.state='reserved');

-- 5.4 Lotes con ajustes manuales recientes (ediciones fuera de las RPCs)
SELECT inventory_id, count(*), sum(quantity_change) FROM public.inventory_movements
 WHERE movement_type='adjustment' AND notes='manual edit' AND created_at > now() - interval '24 hours' GROUP BY 1;

-- 5.5 Borrados de lotes (instantaneas)
SELECT created_at, performed_by, details FROM public.admin_destructive_ops_log
 WHERE op_type='inventory_batch_deleted' ORDER BY created_at DESC LIMIT 20;

-- 5.6 Cambios de politica (auditoria dentro de la BD)
SELECT created_at, action, performed_by, metadata FROM public.activity_logs
 WHERE entity_type='system_config' AND action LIKE 'stock_policy_%' ORDER BY created_at DESC LIMIT 10;

-- 5.8 Fallos del barrido / de la liberacion al cancelar (esperado: 0 filas)
SELECT created_at, op_type, details FROM public.admin_destructive_ops_log
 WHERE op_type IN ('stock_expiry_skipped','stock_expiry_run','stock_release_failed') ORDER BY created_at DESC LIMIT 20;

-- 5.7 Pedidos cancelados por el sistema
SELECT rejection_reason, count(*) FROM public.orders
 WHERE rejection_reason IN ('reservation_expired','insufficient_stock','too_many_open_reservations','invalid_item','empty_order')
 GROUP BY 1;
```

## 6. Rollback (orden inverso)

1. Front primero: redeploy del build anterior en Vercel (o revertir el merge). Sin esto el front nuevo llamaria a RPCs que dejan de existir.
2. `SELECT cron.unschedule('expire-stale-order-reservations');` si se agendo.
3. Liberar reservas vivas: `SELECT public.release_order_inventory(id)` para cada cancelado con reserva, y cancelar/liberar los vivos
   (si no, el stock quedaria reservado sin que nadie lo libere al borrar la tabla de asignaciones).
4. SQL, en este orden: (a) si se aplico `20261014210000`, recrear la policy con el bloque ROLLBACK de ese archivo; (b) bloque ROLLBACK de
   `20261014200000`, que restaura los cuerpos VIVOS de `bulk_delete_products` / `preview_bulk_delete_products` ejecutando
   `supabase/rollbacks/20261014_bulk_delete_live_bodies.sql` (capturados de remoto con SELECT; ojo: el preview vivo esta ROTO hoy con
   42702 "column reference id is ambiguous", la version nueva lo corrige, volver al viejo lo rompe de nuevo); (c) bloque ROLLBACK de
   `20261014190000` (trigger de cancelacion, funciones, tabla de asignaciones, columnas, CHECK). Si hace falta, restaurar datos desde
   `_bak_inventory_20261014` / `_bak_inventory_movements_20261014` (seccion 0.2) o PITR.
5. Lo que el rollback NO deshace: unidades ya consumidas no se restauran; filas de `inventory_movements`, `activity_logs` y
   `admin_destructive_ops_log` quedan como evidencia.

## 7. Riesgos residuales

- **Borrado de movimientos**: `delete_product`, `bulk_delete_products` y `execute_platform_reset` (corren como `postgres`) son los unicos
  caminos que borran el ledger; antes de borrar se guarda una instantanea con las sumas por lote en `admin_destructive_ops_log`
  (`product_ledger_snapshot`; el reset NO guarda sumas por lote, solo la fila `inventory_batch_deleted` de cada lote).
- **Vista previa del borrado**: es STABLE (no puede tomar locks); el borrado real vuelve a chequear bajo lock de los lotes.
- **Sweep**: un pedido que falla al expirar se omite y queda registrado (`stock_expiry_skipped` / `stock_expiry_run`); el cancel del dueño
  tampoco falla si la liberacion falla (`stock_release_failed`): revisar esas filas (consulta 5.8).
- **Ledger incompleto para lotes previos**: no hay movimiento de apertura (la tabla estaba vacia, sin backfill). Las sumas reproducen
  cambios desde la migracion, no la cantidad total, para lotes viejos.
- **Ediciones directas de `quantity`** (productService, VendorInventoryTab) siguen existiendo: ahora quedan registradas como
  `adjustment`, pero nada impide un ajuste erroneo. `reserved_quantity` solo se cambia por RPC.
- **`order_stock_allocations.inventory_id ON DELETE CASCADE`**: borrar un lote borra las asignaciones. Mitigado por `get_product_blockers`
  (bloquea si hay asignaciones `reserved`) y por la instantanea en `admin_destructive_ops_log`, no eliminado. `consumed` NO bloquea (decision del owner).
- **`execute_platform_reset`** conserva su gating actual (no se agrego guardia de pedidos abiertos): con el flag armado borra todo, incluidas
  reservas; las instantaneas por lote se escriben pero las asignaciones ya se habian borrado con los pedidos.
- **Tope por cliente**: cuenta pedidos con asignacion `reserved` (cualquier estado), no `stock_reserved AND pending`; ver comentario
  en la migracion (el flag queda en true tras consumir).
- **Pedidos anteriores al corte** (`stock_managed=false`) no se tocan: su stock sigue siendo manual.
- **Flag `app.stock_rpc`**: es una configuracion de transaccion que cualquier sesion SQL puede fijar; protege contra ediciones accidentales de
  roles de la app, no contra quien ejecuta SQL arbitrario como propietario.
- **Sin prueba en navegador real**: las pruebas son unitarias (jsdom), de concurrencia contra Postgres local y estaticas. No se probo la UI en un
  navegador ni contra el Supabase remoto.
- **Restock** sigue siendo decision manual del admin (boton "Devolver al inventario" en pedidos cancelados con unidades consumidas).
- **Cron**: si no se agenda, las reservas no expiran (release gate). Si el job falla en silencio, ver `cron.job_run_details` y los WARNING.
