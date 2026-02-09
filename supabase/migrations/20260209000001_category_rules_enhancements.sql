-- Add icon and display name columns to category_rules
-- icon: Lucide icon name for customizable display
-- display_name_es/en: Admin-customizable labels (internal category_name stays fixed)

ALTER TABLE public.category_rules
  ADD COLUMN IF NOT EXISTS icon text DEFAULT 'Star',
  ADD COLUMN IF NOT EXISTS display_name_es text,
  ADD COLUMN IF NOT EXISTS display_name_en text;

-- Set defaults matching current hardcoded values
UPDATE public.category_rules SET icon = 'Star', display_name_es = 'Regular', display_name_en = 'Regular' WHERE category_name = 'regular';
UPDATE public.category_rules SET icon = 'Zap', display_name_es = 'Pro', display_name_en = 'Pro' WHERE category_name = 'pro';
UPDATE public.category_rules SET icon = 'Crown', display_name_es = 'VIP', display_name_en = 'VIP' WHERE category_name = 'vip';
