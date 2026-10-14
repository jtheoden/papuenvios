# Runbook: despliegue de la reserva atomica de stock

Alcance: migraciones `20261014190000_atomic_stock_reservation.sql` y
`20261014200000_product_delete_safety_and_ledger.sql`, mas el build del front de esta rama
(`feat/atomic-stock-reservation`). Proyecto Supabase `qcwnlbpultscerwdnzbm`.

Reglas de este runbook: cada paso que ESCRIBE en remoto (aplicar migraciones, agendar cron,
desplegar) necesita su propio "dale" explicito del owner. Los pasos de verificacion son solo
`SELECT`. Nada de esto se ejecuto contra remoto desde el desarrollo (solo SELECT de verificacion).

## 0. Orden exacto

1. Sondas previas (seccion 1) y revision de resultados. Si algo no coincide, parar.
2. Ventana corta de despliegue (ver seccion 4, riesgo de pestanas viejas).
3. Aplicar `20261014190000_atomic_stock_reservation.sql`.
4. Verificacion posterior parcial (secciones 2.1 a 2.3).
5. Aplicar `20261014200000_product_delete_safety_and_ledger.sql`.
6. Verificacion posterior completa (seccion 2).
7. Desplegar el front (Vercel) inmediatamente despues. No dejar el SQL nuevo con el front viejo mas de unos minutos.
8. Avisar a admins y vendors: recargar todas las pestanas abiertas del panel (Ctrl+F5).
9. SOLO ENTONCES agendar pg_cron (seccion 3). Sin cron las reservas no expiran: es el release gate.
10. Monitoreo de las primeras 24 h (seccion 5).

Por que este orden: la migracion 2 depende de `order_stock_allocations`, `reserved_change` y del flag
`app.stock_rpc` que crea/usa la migracion 1. El front nuevo llama a RPCs que solo existen tras la
migracion 1; el front viejo no conoce el cupo por cliente ni la reserva (ver riesgo W6).

## 1. Sondas previas en remoto (solo SELECT)

```sql
-- 1.1 Filas que romperian el CHECK reserved <= quantity (debe devolver 0)
SELECT count(*) FROM public.inventory WHERE COALESCE(reserved_quantity,0) > quantity;

-- 1.2 Pedidos con inventory_id (esperado: 0 de 126 al 2026-10-14; justifica el predicado nuevo)
SELECT count(*) total, count(inventory_id) con_inventory_id FROM public.order_items;

-- 1.3 Productos hoy en pedidos abiertos (esperado ~15 directos + ~11 via combo): lo que el borrado NO bloqueaba
SELECT count(DISTINCT oi.item_id) FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
 WHERE o.status NOT IN ('dispatched','delivered','completed','cancelled')
   AND oi.item_id IN (SELECT id FROM public.products);

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
SELECT stock_managed, count(*) FROM public.orders GROUP BY 1;   -- los 126 previos en false

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

-- 2.5 Politica de movimientos eliminada
SELECT count(*) FROM pg_policies WHERE tablename='inventory_movements' AND policyname='inventory_movements_insert_own_order';  -- 0

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
3. Lo que el SQL ya frena de forma ruidosa para build viejo: insertar en `inventory_movements` desde el cliente (policy eliminada,
   falla con 42501), editar `reserved_quantity` desde el cliente (42501), agregar lineas a pedidos ya reservados/cancelados/validados
   (42501), baja de stock por debajo de lo reservado (CHECK 23514).
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
4. SQL: bloque ROLLBACK de `20261014200000` (triggers de inventario, restaurar cuerpos previos de `bulk_delete_products` y
   `preview_bulk_delete_products` desde `20260808000001` / `20260909110000`, `DROP FUNCTION get_product_blockers`), y luego el bloque
   ROLLBACK de `20261014190000` (trigger de cancelacion, funciones, tabla de asignaciones, columnas, CHECK). Recrear la policy
   `inventory_movements_insert_own_order` (definicion al final de la migracion 1).
5. Lo que el rollback NO deshace: unidades ya consumidas no se restauran; filas de `inventory_movements`, `activity_logs` y
   `admin_destructive_ops_log` quedan como evidencia.

## 7. Riesgos residuales

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
