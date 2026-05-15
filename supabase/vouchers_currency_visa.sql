-- عملة السند + فيزا + توسيع قيم voucher_tender
-- نفّذ في Supabase بعد vouchers.sql و vouchers_tender_cheques.sql

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'ILS'
    CHECK (currency_code IN ('ILS', 'JOD', 'USD'));

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS visa_last4 text;

COMMENT ON COLUMN public.vouchers.currency_code IS 'ILS شيكل | JOD دينار | USD دولار';
COMMENT ON COLUMN public.vouchers.visa_last4 IS 'آخر 4 أرقام للبطاقة عند الدفع بفيزا (اختياري)';

-- السماح بقيمة visa في voucher_tender
ALTER TABLE public.vouchers DROP CONSTRAINT IF EXISTS vouchers_voucher_tender_check;

ALTER TABLE public.vouchers
  ADD CONSTRAINT vouchers_voucher_tender_check
  CHECK (voucher_tender IN ('cash', 'checks', 'mixed', 'visa'));

-- NOTIFY pgrst, 'reload schema';
