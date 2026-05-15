-- ربط الحجز المسبق بفاتورة البيع الناتجة عن «تحويل إلى فاتورة»
ALTER TABLE public.pre_orders
  ADD COLUMN IF NOT EXISTS converted_sale_id uuid REFERENCES public.sales (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.pre_orders.converted_sale_id IS 'فاتورة مبيعات أُنشئت من هذا الحجز';

CREATE INDEX IF NOT EXISTS idx_pre_orders_converted_sale ON public.pre_orders (converted_sale_id) WHERE converted_sale_id IS NOT NULL;
