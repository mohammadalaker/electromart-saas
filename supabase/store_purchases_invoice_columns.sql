-- حقول رأس فاتورة المشتريات + أسطر JSON
-- نفّذ بعد store_purchases.sql

ALTER TABLE public.store_purchases
  ADD COLUMN IF NOT EXISTS supplier_company_name text NOT NULL DEFAULT '';

ALTER TABLE public.store_purchases
  ADD COLUMN IF NOT EXISTS invoice_number text NOT NULL DEFAULT '';

ALTER TABLE public.store_purchases
  ADD COLUMN IF NOT EXISTS supplier_phone text NOT NULL DEFAULT '';

ALTER TABLE public.store_purchases
  ADD COLUMN IF NOT EXISTS line_items jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.store_purchases
  ADD COLUMN IF NOT EXISTS invoice_date date DEFAULT CURRENT_DATE;

COMMENT ON COLUMN public.store_purchases.invoice_date IS 'تاريخ فاتورة المورد (يوم/شهر/سنة)';

COMMENT ON COLUMN public.store_purchases.supplier_company_name IS 'اسم شركة المورد';
COMMENT ON COLUMN public.store_purchases.invoice_number IS 'رقم فاتورة المورد';
COMMENT ON COLUMN public.store_purchases.supplier_phone IS 'هاتف المورد (للربط بالذمة)';
COMMENT ON COLUMN public.store_purchases.line_items IS 'أسطر: barcode, reference, unit_price, discount_percent, qty, line_total';
