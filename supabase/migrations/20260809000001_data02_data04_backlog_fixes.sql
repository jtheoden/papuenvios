-- DATA-02 + DATA-04 (backlog P1/P2, ver .claude/TRACKING_PROGRESS.md)
--
-- DATA-02: inventory.available_quantity vive hoy como DEFAULT (quantity - reserved_quantity),
-- no como GENERATED. DEFAULT solo se evalua en INSERT; ninguna llamada a supabase.from('inventory')
-- en el codigo actualiza available_quantity directamente (verificado: solo escriben quantity/
-- reserved_quantity), asi que convertirla a GENERATED ALWAYS AS ... STORED es seguro y coincide
-- con el diseno original (20241001000000_complete_schema.sql:198 ya la definia como GENERATED;
-- en algun punto quedo como DEFAULT en la BD remota). Esto cierra la ventana de overselling: un
-- UPDATE a quantity/reserved_quantity sin recalcular available_quantity a mano quedaba stale.
--
-- DATA-04: orders.estimated_delivery_date (agregada en MIGRATIONS_PHASE_2.sql) es un duplicado
-- sin uso de orders.estimated_delivery (la que sí usa whatsappService.js). Verificado: 0 filas
-- non-null en produccion, sin indices ni constraints que la referencien.

BEGIN;

-- DATA-02: recrear available_quantity como columna generada
DROP INDEX IF EXISTS idx_inventory_low_stock;

ALTER TABLE public.inventory DROP COLUMN available_quantity;

ALTER TABLE public.inventory
  ADD COLUMN available_quantity integer GENERATED ALWAYS AS (quantity - reserved_quantity) STORED;

CREATE INDEX idx_inventory_low_stock ON public.inventory USING btree (product_id, available_quantity);

-- DATA-04: eliminar columna duplicada sin uso
ALTER TABLE public.orders DROP COLUMN IF EXISTS estimated_delivery_date;

COMMIT;
