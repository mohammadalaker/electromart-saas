-- علم الطلبات الأونلاين في جدول المبيعات + تحديث submit_online_order
-- نفّذ في Supabase SQL Editor

-- 1) العمود الجديد
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS is_online_order boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sales.is_online_order IS 'true للطلبات القادمة من المتجر العام عبر submit_online_order';

-- 2) ترحيل الطلبات القديمة (المعلّمة في الملاحظات)
UPDATE public.sales
SET is_online_order = true
WHERE is_online_order = false
  AND notes LIKE '%أونلاين%';

-- 3) تحديث الدالة لتعليم الطلبات الجديدة
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
    order_status,
    is_online_order
  )
  VALUES (
    v_store_id,
    v_total,
    v_notes,
    v_line_items,
    'cash',
    'pending_online',
    true
  )
  RETURNING id INTO v_sale_id;

  RETURN v_sale_id;
END;
$$;
