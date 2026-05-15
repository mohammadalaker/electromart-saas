-- مخطط طبيعي (Normalized): فاتورة مشتريات + أسطر (One-to-Many)
-- purchases: رأس الفاتورة — purchase_items: تفاصيل الأصناف
--
-- ملاحظة: التطبيق الحالي يستخدم جدول store_purchases مع line_items كـ JSONB.
-- يمكنك لاحقاً ترحيل البيانات إلى هذا المخطط أو استخدامه لبيانات جديدة فقط.
-- نفّذ بعد وجود جداول public.stores و public.products (اختياري لـ product_id).

-- ─── رأس الفاتورة ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  supplier_name text NOT NULL DEFAULT '',
  total_amount numeric(14, 2) NOT NULL CHECK (total_amount >= 0),
  payment_mode text NOT NULL CHECK (payment_mode IN ('cash', 'credit')),
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchases_store_date
  ON public.purchases (store_id, invoice_date DESC);

COMMENT ON TABLE public.purchases IS 'فواتير مشتريات — رأس: مورد، إجمالي، نوع دفع، تاريخ';
COMMENT ON COLUMN public.purchases.supplier_name IS 'اسم المورد / الشركة';
COMMENT ON COLUMN public.purchases.payment_mode IS 'cash = كاش، credit = آجل';

-- ─── أسطر الفاتورة (Many ← One) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.purchases (id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products (id) ON DELETE SET NULL,
  quantity numeric(14, 4) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14, 2) NOT NULL CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase
  ON public.purchase_items (purchase_id);

CREATE INDEX IF NOT EXISTS idx_purchase_items_product
  ON public.purchase_items (product_id)
  WHERE product_id IS NOT NULL;

COMMENT ON TABLE public.purchase_items IS 'أسطر فاتورة المشتريات — صنف، كمية، سعر شراء';
COMMENT ON COLUMN public.purchase_items.unit_price IS 'سعر شراء الوحدة';
COMMENT ON COLUMN public.purchase_items.product_id IS 'مرجع للصنف في المخزن — NULL إذا كان السطر يدوياً';

-- ─── RLS: نفس منطق المتجر (مالك المتجر) ─────────────────────────────────────
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchases_select_own" ON public.purchases;
CREATE POLICY "purchases_select_own"
  ON public.purchases FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = purchases.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "purchases_insert_own" ON public.purchases;
CREATE POLICY "purchases_insert_own"
  ON public.purchases FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = purchases.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "purchases_update_own" ON public.purchases;
CREATE POLICY "purchases_update_own"
  ON public.purchases FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = purchases.store_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = purchases.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "purchases_delete_own" ON public.purchases;
CREATE POLICY "purchases_delete_own"
  ON public.purchases FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = purchases.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "purchase_items_select_own" ON public.purchase_items;
CREATE POLICY "purchase_items_select_own"
  ON public.purchase_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.purchases p
      JOIN public.stores s ON s.id = p.store_id
      WHERE p.id = purchase_items.purchase_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "purchase_items_insert_own" ON public.purchase_items;
CREATE POLICY "purchase_items_insert_own"
  ON public.purchase_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.purchases p
      JOIN public.stores s ON s.id = p.store_id
      WHERE p.id = purchase_items.purchase_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "purchase_items_update_own" ON public.purchase_items;
CREATE POLICY "purchase_items_update_own"
  ON public.purchase_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.purchases p
      JOIN public.stores s ON s.id = p.store_id
      WHERE p.id = purchase_items.purchase_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.purchases p
      JOIN public.stores s ON s.id = p.store_id
      WHERE p.id = purchase_items.purchase_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "purchase_items_delete_own" ON public.purchase_items;
CREATE POLICY "purchase_items_delete_own"
  ON public.purchase_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.purchases p
      JOIN public.stores s ON s.id = p.store_id
      WHERE p.id = purchase_items.purchase_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_items TO authenticated;
GRANT ALL ON public.purchases TO service_role;
GRANT ALL ON public.purchase_items TO service_role;
