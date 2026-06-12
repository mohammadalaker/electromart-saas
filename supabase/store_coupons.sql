-- جدول كوبونات المتجر
CREATE TABLE IF NOT EXISTS public.store_coupons (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE NOT NULL,
  code text NOT NULL,
  discount_type text NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value numeric NOT NULL CHECK (discount_value > 0),
  min_order_amount numeric DEFAULT 0 CHECK (min_order_amount >= 0),
  max_uses integer,
  used_count integer DEFAULT 0,
  expires_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (store_id, code)
);

-- دالة التحقق من الكوبون
CREATE OR REPLACE FUNCTION public.validate_coupon(
  p_slug text,
  p_code text,
  p_order_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_store_id uuid;
  v_coupon record;
  v_discount numeric := 0;
  v_final numeric;
BEGIN
  SELECT id INTO v_store_id FROM public.stores WHERE lower(trim(public_slug)) = lower(trim(p_slug)) AND public_catalog_enabled = true LIMIT 1;
  IF v_store_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'المتجر غير متاح');
  END IF;

  SELECT * INTO v_coupon FROM public.store_coupons WHERE store_id = v_store_id AND upper(trim(code)) = upper(trim(p_code)) LIMIT 1;
  IF v_coupon IS NULL OR NOT v_coupon.is_active THEN
    RETURN jsonb_build_object('valid', false, 'error', 'الكوبون غير صالح أو غير نشط');
  END IF;

  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'الكوبون منتهي الصلاحية');
  END IF;

  IF v_coupon.max_uses IS NOT NULL AND v_coupon.used_count >= v_coupon.max_uses THEN
    RETURN jsonb_build_object('valid', false, 'error', 'الكوبون نفد وتم استخدامه بالكامل');
  END IF;

  IF p_order_amount < v_coupon.min_order_amount THEN
    RETURN jsonb_build_object('valid', false, 'error', format('الحد الأدنى لاستخدام الكوبون هو ₪%s', v_coupon.min_order_amount));
  END IF;

  IF v_coupon.discount_type = 'percent' THEN
    v_discount := round(p_order_amount * (v_coupon.discount_value / 100.0), 2);
  END IF;
  IF v_coupon.discount_type = 'fixed' THEN
    v_discount := round(v_coupon.discount_value, 2);
  END IF;

  IF v_discount > p_order_amount THEN
    v_discount := p_order_amount;
  END IF;

  v_final := round(p_order_amount - v_discount, 2);

  RETURN jsonb_build_object(
    'valid', true,
    'discount_amount', v_discount,
    'final_amount', v_final
  );
END;
$$;

-- دالة زيادة الاستخدام
CREATE OR REPLACE FUNCTION public.increment_coupon_usage(
  p_store_id uuid,
  p_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.store_coupons
  SET used_count = used_count + 1
  WHERE store_id = p_store_id
    AND upper(trim(code)) = upper(trim(p_code));
END;
$$;

-- منح الصلاحيات للعملاء والزوار
GRANT SELECT ON public.store_coupons TO anon;
GRANT EXECUTE ON FUNCTION public.validate_coupon TO anon;
GRANT EXECUTE ON FUNCTION public.increment_coupon_usage TO anon;
