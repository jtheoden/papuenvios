-- Add offer tracking columns to remittances table
ALTER TABLE public.remittances
  ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES public.offers(id),
  ADD COLUMN IF NOT EXISTS discount_amount decimal(10,2) DEFAULT 0;

-- Add remittance_id to offer_usage for tracking which remittance used the offer
ALTER TABLE public.offer_usage
  ADD COLUMN IF NOT EXISTS remittance_id uuid REFERENCES public.remittances(id);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_remittances_offer_id ON public.remittances(offer_id) WHERE offer_id IS NOT NULL;
