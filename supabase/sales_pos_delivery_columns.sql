-- حقول نقطة البيع: عنوان، طريقة تحصيل (كاش/شيك/فيزا)، تاريخ استلام، مكان الاستلام (معرض/مخزن)
-- نفّذ في Supabase SQL Editor بعد وجود public.sales

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS customer_address text;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS pos_tender text
  CHECK (pos_tender IS NULL OR pos_tender IN ('cash', 'check', 'visa'));

COMMENT ON COLUMN public.sales.customer_address IS 'عنوان التوصيل/العميل — من POS';
COMMENT ON COLUMN public.sales.pos_tender IS 'كاش أو شيك أو فيزا (عند التحصيل النقدي أو لتسجيل أداة الدفع)';

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS pickup_expected_date date;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS pickup_location text
  CHECK (pickup_location IS NULL OR pickup_location IN ('showroom', 'warehouse'));

COMMENT ON COLUMN public.sales.pickup_expected_date IS 'تاريخ الاستلام المتوقع';
COMMENT ON COLUMN public.sales.pickup_location IS 'showroom = المعرض، warehouse = المخزن';
