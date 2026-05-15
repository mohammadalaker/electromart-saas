-- متجر عام للزبائن: رابط /:slug — نفّذ في Supabase SQL Editor بعد جدولي stores و sales و products
-- يضيف: معرّف الرابط، تفعيل الكاتالوج، حالة الطلب الأونلاين، سياسات anon للقراءة، ودالة إنشاء الطلب

-- ── أعمدة المتجر ───────────────────────────────────────────────────────────
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS public_slug text,
  ADD COLUMN IF NOT EXISTS public_catalog_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.stores.public_slug IS 'معرّف فريد في الرابط العام، أحرف لاتينية وأرقام وشرطة';
COMMENT ON COLUMN public.stores.public_catalog_enabled IS 'عند التفعيل يمكن للزوار تصفح المنتجات وإرسال طلبات أونلاين';

CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_public_slug_lower
  ON public.stores (lower(trim(public_slug)))
  WHERE public_slug IS NOT NULL AND trim(public_slug) <> '';

-- ── حالة الطلب في المبيعات ────────────────────────────────────────────────
-- confirmed = بيع عادي (POS/لوحة)؛ pending_online = طلب من المتجر العام بانتظار التأكيد؛ cancelled = ملغى
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS order_status text NOT NULL DEFAULT 'confirmed';

COMMENT ON COLUMN public.sales.order_status IS 'pending_online | confirmed | cancelled';

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_order_status_check;
ALTER TABLE public.sales
  ADD CONSTRAINT sales_order_status_check
  CHECK (order_status IN ('confirmed', 'pending_online', 'cancelled'));

-- ── سياسات القراءة للزوار (anon) — تتطلّب عادةً تفعيل RLS على الجداول في لوحة Supabase ──

DROP POLICY IF EXISTS "stores_select_public_catalog" ON public.stores;
CREATE POLICY "stores_select_public_catalog"
  ON public.stores FOR SELECT TO anon
  USING (public_catalog_enabled = true AND public_slug IS NOT NULL AND trim(public_slug) <> '');

DROP POLICY IF EXISTS "products_select_public_catalog" ON public.products;
CREATE POLICY "products_select_public_catalog"
  ON public.products FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = products.store_id
        AND s.public_catalog_enabled = true
        AND s.public_slug IS NOT NULL
        AND trim(s.public_slug) <> ''
    )
  );

GRANT SELECT ON public.stores TO anon;
GRANT SELECT ON public.products TO anon;

-- ── دالة إنشاء طلب أونلاين (أسعار من قاعدة البيانات — لا تثق بالعميل) ─────
CREATE OR REPLACE FUNCTION public.submit_online_order(
  p_slug text,
  p_items jsonb,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
  v_store_name text;
  elem jsonb;
  v_pid uuid;
  v_qty numeric;
  v_line_total numeric;
  v_unit_price numeric;
  v_barcode text;
  v_total numeric := 0;
  v_line_items jsonb := '[]'::jsonb;
  v_notes text;
  v_stock int;
  r public.products%ROWTYPE;
  v_sale_id uuid;
BEGIN
  IF p_slug IS NULL OR length(trim(p_slug)) < 2 THEN
    RAISE EXCEPTION 'invalid_slug';
  END IF;
  SELECT id, name INTO v_store_id, v_store_name
  FROM public.stores
  WHERE lower(trim(public_slug)) = lower(trim(p_slug))
    AND public_catalog_enabled = true
  LIMIT 1;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'store_not_found';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'empty_cart';
  END IF;
  IF p_customer_name IS NULL OR length(trim(p_customer_name)) < 2 THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;
  IF p_customer_phone IS NULL OR length(trim(p_customer_phone)) < 6 THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;

  FOR elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_pid := (elem->>'product_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid_product';
    END;
    v_qty := greatest(1::numeric, least(500::numeric, coalesce((elem->>'qty')::numeric, 1)));
    SELECT * INTO r FROM public.products WHERE id = v_pid AND store_id = v_store_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_product';
    END IF;
    v_stock := coalesce(r.stock_count, 0)::int;
    IF v_stock < v_qty THEN
      RAISE EXCEPTION 'insufficient_stock';
    END IF;
    v_unit_price := round(coalesce(
      nullif(r.price_after_disc, 0)::numeric,
      r.full_price::numeric,
      0::numeric
    ), 2);
    IF v_unit_price < 0 THEN
      v_unit_price := 0;
    END IF;
    v_line_total := round(v_unit_price * v_qty, 2);
    v_barcode := coalesce(r.barcode, '');
    v_total := v_total + v_line_total;
    v_line_items := v_line_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_pid,
        'barcode', v_barcode,
        'qty', v_qty,
        'unit_price', v_unit_price,
        'line_total', v_line_total
      )
    );
  END LOOP;

  v_total := round(v_total, 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'empty_cart';
  END IF;

  v_notes := format(
    E'طلب أونلاين — دفع عند الاستلام\nالمتجر: %s\nالزبون: %s\nالهاتف: %s\nالعنوان: %s%s',
    coalesce(v_store_name, ''),
    trim(p_customer_name),
    trim(p_customer_phone),
    trim(coalesce(p_customer_address, '')),
    CASE
      WHEN p_notes IS NOT NULL AND trim(p_notes) <> '' THEN E'\nملاحظات الزبون: ' || trim(p_notes)
      ELSE ''
    END
  );

  INSERT INTO public.sales (
    store_id,
    total_amount,
    notes,
    line_items,
    payment_mode,
    order_status
  )
  VALUES (
    v_store_id,
    v_total,
    v_notes,
    v_line_items,
    'cash',
    'pending_online'
  )
  RETURNING id INTO v_sale_id;

  RETURN v_sale_id;
END;
$$;

COMMENT ON FUNCTION public.submit_online_order IS 'إنشاء فاتورة طلب أونلاين بانتظار التأكيد — بدون خصم مخزون';

REVOKE ALL ON FUNCTION public.submit_online_order(text, jsonb, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_online_order(text, jsonb, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_online_order(text, jsonb, text, text, text, text) TO authenticated;

-- تحديث حقول المتجر العام (public_slug) من لوحة التحكم
DROP POLICY IF EXISTS "stores_update_owner" ON public.stores;
CREATE POLICY "stores_update_owner"
  ON public.stores FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- تحديث فواتير المتجر (مثلاً order_status) — يتطلّب تفعيل RLS على sales إن لم يكن مفعّلاً
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
