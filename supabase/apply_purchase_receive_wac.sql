-- استلام مشتريات: زيادة المخزن + تحديث متوسط تكلفة مرجح (full_price) في عملية واحدة
-- new_avg = (stock_before * cost_before + qty * unit_cost) / (stock_before + qty)

CREATE OR REPLACE FUNCTION public.apply_purchase_receive_wac(
  p_product_id uuid,
  p_store_id uuid,
  p_qty int,
  p_unit_cost numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock int;
  v_cost numeric;
  v_qty int;
  v_uc numeric;
  v_total int;
  v_new numeric;
BEGIN
  v_qty := GREATEST(0, COALESCE(p_qty, 0));
  v_uc := GREATEST(0, COALESCE(p_unit_cost, 0));
  IF v_qty <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(stock_count, 0), COALESCE(full_price, 0)
  INTO v_stock, v_cost
  FROM public.products
  WHERE id = p_product_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product not found';
  END IF;

  v_total := GREATEST(0, v_stock) + v_qty;
  IF v_total <= 0 THEN
    RETURN v_cost;
  END IF;

  v_new := (GREATEST(0, v_stock)::numeric * v_cost + v_qty::numeric * v_uc) / v_total::numeric;

  UPDATE public.products
  SET
    stock_count = v_total,
    full_price = ROUND(v_new, 2)
  WHERE id = p_product_id AND store_id = p_store_id;

  RETURN ROUND(v_new, 2);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_purchase_receive_wac(uuid, uuid, int, numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.apply_purchase_receive_wac(uuid, uuid, int, numeric) TO authenticated;
