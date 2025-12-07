# Diagnóstico para validación de pagos en Supabase

Ejecuta estas consultas en el SQL editor antes de aplicar cambios. Ayudan a inspeccionar estados de órdenes, pagos y políticas relacionadas.

## 1) Estado de la orden que falla
```sql
-- Reemplaza :order_id por el UUID de la orden
select id, status, payment_status, validated_by, validated_at, created_at
from public.orders
where id = :order_id;
```

## 2) Historial de estado de la orden
```sql
select order_id, previous_status, new_status, changed_by, notes, created_at
from public.order_status_history
where order_id = :order_id
order by created_at desc;
```

## 3) Items y tipos para validar reducciones de inventario
```sql
select order_id, item_type, item_id, inventory_id, quantity
from public.order_items
where order_id = :order_id;
```

## 4) Validar políticas RLS y privilegios
```sql
-- Políticas activas en orders y order_status_history
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where tablename in ('orders', 'order_status_history')
order by tablename, policyname;

-- Estado de RLS
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename in ('orders', 'order_status_history');

-- Privilegios explícitos
select table_name, grantee, privilege_type, is_grantable
from information_schema.table_privileges
where table_schema = 'public' and table_name in ('orders', 'order_status_history')
order by table_name, grantee, privilege_type;
```

## 5) Validar datos de usuario administrador
```sql
-- Confirmar rol/claims que supabase transmite en la sesión
select * from auth.users where id = :admin_id;
```

### Uso
1. Ejecuta (1) para ver el estado actual. Si `payment_status` está en `pending`, el flujo ahora permite transición directa a `validated` para super_admin.
2. Consulta (2) y (3) para entender contexto y efectos secundarios de inventario.
3. Revisa (4) y (5) si hay errores de permisos o RLS.
