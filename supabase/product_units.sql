-- ==============================================================================
-- Migration: product_units
-- Description: جدول وحدات المنتجات الإضافية والأساسية لدعم التجزئة والجملة
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.product_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  unit_name text NOT NULL,                                -- اسم الوحدة (كرتونة، علبة، طقم، بكت، شوال...)
  conversion_factor numeric(12, 4) NOT NULL DEFAULT 1,   -- كم قطعة من الوحدة الأساسية تعادل هذه الوحدة
  barcode text,                                           -- باركود خاص بالوحدة الإضافية (اختياري)
  sale_price numeric(12, 2) NOT NULL DEFAULT 0,           -- سعر البيع لهذه الوحدة
  cost_price numeric(12, 2) DEFAULT 0,                    -- سعر التكلفة لهذه الوحدة (اختياري)
  is_base_unit boolean DEFAULT false                      -- هل هذه الوحدة هي الوحدة الأساسية للصنف
);

-- فهارس لتسريع البحث
CREATE INDEX IF NOT EXISTS idx_product_units_product_id ON public.product_units(product_id);
CREATE INDEX IF NOT EXISTS idx_product_units_barcode ON public.product_units(barcode);
CREATE INDEX IF NOT EXISTS idx_product_units_store_id ON public.product_units(store_id);

-- تفعيل سياسات الأمان RLS
ALTER TABLE public.product_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_units_all" ON public.product_units;
CREATE POLICY "product_units_all" ON public.product_units
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.product_units IS 'وحدات بيع المنتجات المتعددة ونسب التحويل إلى الوحدة الأساسية';
COMMENT ON COLUMN public.product_units.unit_name IS 'اسم الوحدة، مثل: كرتونة، علبة، قطعة، بكت';
COMMENT ON COLUMN public.product_units.conversion_factor IS 'معامل التحويل: ضرب الكمية بهذا الرقم يعطي الكمية بالوحدة الأساسية';
COMMENT ON COLUMN public.product_units.barcode IS 'باركود مخصص لهذه الوحدة للتعرف عليها مباشرة عبر السكانر';

-- إضافة عمود cost_price في حال كان الجدول موجوداً مسبقاً بدونه
ALTER TABLE public.product_units ADD COLUMN IF NOT EXISTS cost_price numeric(12, 2) DEFAULT 0;

-- ==============================================================================
-- معالجة صنف "دخان امبريال" (تثبيت كرتونة بباركود مستقل 1212121212-BOX بسعر 270)
-- ==============================================================================
DELETE FROM public.product_units WHERE product_id = '623f38f2-8bb6-4a0c-a2a4-7dbb0546e984';

INSERT INTO public.product_units (store_id, product_id, unit_name, conversion_factor, barcode, sale_price, is_base_unit)
SELECT 
  p.store_id,
  p.id,
  'قطعة',
  1,
  '1212121212',
  27,
  true
FROM public.products p
WHERE p.id = '623f38f2-8bb6-4a0c-a2a4-7dbb0546e984';

INSERT INTO public.product_units (store_id, product_id, unit_name, conversion_factor, barcode, sale_price, is_base_unit)
SELECT 
  p.store_id,
  p.id,
  'كرتونة',
  10,
  '1212121212-BOX',
  270,
  false
FROM public.products p
WHERE p.id = '623f38f2-8bb6-4a0c-a2a4-7dbb0546e984';
