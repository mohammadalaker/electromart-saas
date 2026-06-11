-- WhatsApp number for floating contact button on public storefront
-- Execute in Supabase SQL Editor after public.stores exists.

ALTER TABLE stores ADD COLUMN IF NOT EXISTS whatsapp_number text;

COMMENT ON COLUMN public.stores.whatsapp_number IS 'WhatsApp number (digits) used for the floating wa.me button on the public store';
