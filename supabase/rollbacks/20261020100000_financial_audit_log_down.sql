-- Rollback of 20261020100000_financial_audit_log.sql. Destroys the audit rows: export them first if any exist.
DROP TRIGGER IF EXISTS audit_financial_update ON public.remittances;
DROP TRIGGER IF EXISTS audit_financial_update ON public.orders;
DROP TRIGGER IF EXISTS audit_financial_update ON public.remittance_types;
DROP TRIGGER IF EXISTS audit_financial_delete ON public.remittance_types;
DROP TRIGGER IF EXISTS audit_financial_update ON public.shipping_zones;
DROP TRIGGER IF EXISTS audit_financial_delete ON public.shipping_zones;
DROP TRIGGER IF EXISTS audit_financial_update ON public.exchange_rates;
DROP TRIGGER IF EXISTS audit_financial_delete ON public.exchange_rates;
DROP FUNCTION IF EXISTS public.audit_financial_changes();
DROP FUNCTION IF EXISTS public.financial_audit_columns(text);
DROP TABLE IF EXISTS public.financial_audit_log; -- also drops its immutability triggers, policy and indexes
DROP FUNCTION IF EXISTS public.financial_audit_log_block_mutation();
