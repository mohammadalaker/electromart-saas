-- يزيد الكمية ذرّياً في stock_count (مشتريات / إرجاع)
-- نفّذ بعد decrement_stock.sql

CREATE OR REPLACE FUNCTION public.increment_stock(row_id uuid, amount int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.products
  SET stock_count = COALESCE(stock_count, 0) + GREATEST(0, amount)
  WHERE id = row_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_stock(uuid, int) TO anon;
GRANT EXECUTE ON FUNCTION public.increment_stock(uuid, int) TO authenticated;
