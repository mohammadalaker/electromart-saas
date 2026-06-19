-- الحد الائتماني للزبون (₪)
-- نفّذ في Supabase SQL Editor

ALTER TABLE public.store_contacts
  ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(15, 2) DEFAULT 0;

COMMENT ON COLUMN public.store_contacts.credit_limit IS
  '0 means no limit set, otherwise max allowed debt amount';
