-- تتبع إرجاع فاتورة كامل (مرتجع واحد لكل فاتورة)
-- نفّذ بعد وجود public.sales

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS returned_at timestamptz;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS return_note text;

COMMENT ON COLUMN public.sales.returned_at IS 'عند تعبئته: تم إرجاع الفاتورة بالكامل — لا يُكرَّر المرتجع';
COMMENT ON COLUMN public.sales.return_note IS 'ملاحظة اختيارية عند تسجيل المرتجع';

CREATE INDEX IF NOT EXISTS idx_sales_store_returned ON public.sales (store_id, returned_at)
  WHERE returned_at IS NULL;
