-- توسيع pos_tender لدعم المحافظ الرقمية (Bit، PayBox، إلخ) بجانب الكاش والشيك والبطاقة
-- نفّذ في Supabase SQL Editor بعد sales_pos_delivery_columns.sql

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_pos_tender_check;

ALTER TABLE public.sales
  ADD CONSTRAINT sales_pos_tender_check CHECK (
    pos_tender IS NULL OR pos_tender IN ('cash', 'check', 'visa', 'digital_wallet')
  );

COMMENT ON COLUMN public.sales.pos_tender IS 'كاش، شيك، فيزا/بطاقة (دفع إلكتروني)، أو محفظة رقمية';
