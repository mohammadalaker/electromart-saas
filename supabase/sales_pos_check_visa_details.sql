-- تفاصيل الشيكات (العدد + تواريخ) وآخر 4 أرقام للفيزا — نفّذ بعد sales_pos_delivery_columns.sql

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS pos_check_count integer
  CHECK (pos_check_count IS NULL OR (pos_check_count >= 1 AND pos_check_count <= 100));

COMMENT ON COLUMN public.sales.pos_check_count IS 'عدد الشيكات عند pos_tender = check';

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS pos_check_dates jsonb;

COMMENT ON COLUMN public.sales.pos_check_dates IS 'مصفوفة JSON لتواريخ الشيكات بنفس الترتيب ["2026-04-01","2026-05-01"]';

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS pos_visa_last4 text
  CHECK (pos_visa_last4 IS NULL OR pos_visa_last4 ~ '^[0-9]{4}$');

COMMENT ON COLUMN public.sales.pos_visa_last4 IS 'آخر 4 أرقام من بطاقة الفيزا عند pos_tender = visa';
