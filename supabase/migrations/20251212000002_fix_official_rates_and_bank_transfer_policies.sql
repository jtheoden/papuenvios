-- Ensure official currency rates are available for conversion fallbacks and prevent 404 errors
CREATE TABLE IF NOT EXISTS public.official_currency_rates (
  currency_code TEXT PRIMARY KEY,
  rate_to_usd NUMERIC(18, 6) NOT NULL,
  source TEXT,
  retrieved_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.official_currency_rates ENABLE ROW LEVEL SECURITY;

-- Policies: open reads for clients, admin-managed writes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'official_currency_rates_select_public'
  ) THEN
    CREATE POLICY official_currency_rates_select_public
      ON public.official_currency_rates
      FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'official_currency_rates_admin_insert'
  ) THEN
    CREATE POLICY official_currency_rates_admin_insert
      ON public.official_currency_rates
      FOR INSERT
      WITH CHECK ((auth.jwt() ->> 'user_role') = 'admin');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'official_currency_rates_admin_update'
  ) THEN
    CREATE POLICY official_currency_rates_admin_update
      ON public.official_currency_rates
      FOR UPDATE
      USING ((auth.jwt() ->> 'user_role') = 'admin');
  END IF;
END $$;

-- Seed required currencies (idempotent)
INSERT INTO public.official_currency_rates (currency_code, rate_to_usd, source, retrieved_at, updated_at)
VALUES
  ('USD', 1, 'seed', now(), now()),
  ('MLC', 1, 'seed', now(), now()),
  ('CUP', 0.041, 'seed', now(), now())
ON CONFLICT (currency_code) DO UPDATE
SET
  rate_to_usd = EXCLUDED.rate_to_usd,
  source = EXCLUDED.source,
  retrieved_at = now(),
  updated_at = now();

-- Extend remittance bank transfer permissions so remittance owners can create their records
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'remittance_bank_transfers_owner_select'
  ) THEN
    CREATE POLICY remittance_bank_transfers_owner_select
      ON public.remittance_bank_transfers
      FOR SELECT
      USING (
        (auth.jwt() ->> 'user_role') = 'admin'
        OR EXISTS (
          SELECT 1
          FROM public.remittances r
          WHERE r.id = remittance_bank_transfers.remittance_id
            AND r.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'remittance_bank_transfers_owner_insert'
  ) THEN
    CREATE POLICY remittance_bank_transfers_owner_insert
      ON public.remittance_bank_transfers
      FOR INSERT
      WITH CHECK (
        auth.uid() IS NOT NULL AND
        EXISTS (
          SELECT 1
          FROM public.remittances r
          WHERE r.id = remittance_bank_transfers.remittance_id
            AND r.user_id = auth.uid()
        )
      );
  END IF;
END $$;
