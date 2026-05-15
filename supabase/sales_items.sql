-- أسطر فاتورة البيع المنفصلة (اختياري — يكمّل عمود line_items في sales)
-- نفّذ بعد وجود جدول public.sales و public.products

CREATE TABLE IF NOT EXISTS public.sales_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products (id) ON DELETE SET NULL,
  barcode text NOT NULL DEFAULT '',
  qty numeric(14, 2) NOT NULL CHECK (qty > 0),
  unit_price numeric(14, 2) NOT NULL,
  line_total numeric(14, 2) NOT NULL,
  serial_numbers text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_items_sale ON public.sales_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sales_items_store ON public.sales_items (store_id);

ALTER TABLE public.sales_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_items_select_own" ON public.sales_items;
CREATE POLICY "sales_items_select_own"
  ON public.sales_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = sales_items.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "sales_items_insert_own" ON public.sales_items;
CREATE POLICY "sales_items_insert_own"
  ON public.sales_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = sales_items.store_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT ON public.sales_items TO authenticated;
GRANT ALL ON public.sales_items TO service_role;

COMMENT ON TABLE public.sales_items IS 'أسطر مبيعات — يُملأ من POS بعد إدراج sales';
