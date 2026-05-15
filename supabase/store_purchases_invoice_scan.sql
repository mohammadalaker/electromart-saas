-- صورة فاتورة المورد الأصلية (مرجع في Storage)
-- نفّذ بعد store_purchases_invoice_columns.sql

ALTER TABLE public.store_purchases
  ADD COLUMN IF NOT EXISTS invoice_scan_path text NULL;

COMMENT ON COLUMN public.store_purchases.invoice_scan_path IS 'مسار نسبي في bucket الصور (مثل Pic_of_items) لصورة فاتورة المورد';
