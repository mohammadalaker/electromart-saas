-- سياسات RLS أساسية: stores و products و sales — صاحب المتجر فقط (owner_id = auth.uid())
-- نفّذ في Supabase SQL Editor بعد وجود الجداول. متوافق مع public_store_catalog.sql (سياسات anon للكاتالوج العام).
--
-- تحذير: تفعيل RLS بدون سياسات يمنع كل الوصول. نفّذ الملف كاملاً دفعة واحدة.

-- ── stores ─────────────────────────────────────────────────────────────────
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stores_select_authenticated_owner" ON public.stores;
CREATE POLICY "stores_select_authenticated_owner"
  ON public.stores FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "stores_insert_authenticated_owner" ON public.stores;
CREATE POLICY "stores_insert_authenticated_owner"
  ON public.stores FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "stores_update_owner" ON public.stores;
CREATE POLICY "stores_update_owner"
  ON public.stores FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- حذف المتجر من لوحة التحكم (اختياري — عطّل السياسة إن لم ترد الحذف)
DROP POLICY IF EXISTS "stores_delete_authenticated_owner" ON public.stores;
CREATE POLICY "stores_delete_authenticated_owner"
  ON public.stores FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- ── products ───────────────────────────────────────────────────────────────
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select_authenticated_owner" ON public.products;
CREATE POLICY "products_select_authenticated_owner"
  ON public.products FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = products.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "products_insert_authenticated_owner" ON public.products;
CREATE POLICY "products_insert_authenticated_owner"
  ON public.products FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = products.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "products_update_authenticated_owner" ON public.products;
CREATE POLICY "products_update_authenticated_owner"
  ON public.products FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = products.store_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = products.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "products_delete_authenticated_owner" ON public.products;
CREATE POLICY "products_delete_authenticated_owner"
  ON public.products FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = products.store_id AND s.owner_id = auth.uid()
    )
  );

-- ── sales ───────────────────────────────────────────────────────────────────
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_select_authenticated_owner" ON public.sales;
CREATE POLICY "sales_select_authenticated_owner"
  ON public.sales FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = sales.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "sales_insert_authenticated_owner" ON public.sales;
CREATE POLICY "sales_insert_authenticated_owner"
  ON public.sales FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = sales.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "sales_update_own_store" ON public.sales;
CREATE POLICY "sales_update_own_store"
  ON public.sales FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = sales.store_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = sales.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "sales_delete_authenticated_owner" ON public.sales;
CREATE POLICY "sales_delete_authenticated_owner"
  ON public.sales FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = sales.store_id AND s.owner_id = auth.uid()
    )
  );

COMMENT ON TABLE public.stores IS 'RLS: مالك الصف = auth.uid()؛ anon: انظر public_store_catalog.sql';
COMMENT ON TABLE public.products IS 'RLS: صفوف المتجر المملوك لصاحب الجلسة؛ anon: قراءة الكاتالوج العام';
COMMENT ON TABLE public.sales IS 'RLS: مبيعات المتجر المملوك؛ الطلبات الأونلاين تُدرج عبر submit_online_order (SECURITY DEFINER)';
