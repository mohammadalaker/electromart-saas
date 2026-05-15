-- عكس القيود عند مرتجع الشيك: تتبع سندات العكس (تشغيل مرة واحدة بعد store_checks.sql)

ALTER TABLE public.store_checks
  ADD COLUMN IF NOT EXISTS bounce_customer_reversal_voucher_id uuid REFERENCES public.vouchers (id) ON DELETE SET NULL;

ALTER TABLE public.store_checks
  ADD COLUMN IF NOT EXISTS bounce_supplier_reversal_voucher_id uuid REFERENCES public.vouchers (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.store_checks.bounce_customer_reversal_voucher_id IS 'سند عكس قبض الزبون عند مرتجع الشيك';
COMMENT ON COLUMN public.store_checks.bounce_supplier_reversal_voucher_id IS 'سند عكس صرف المورد عند مرتجع الشيك';
