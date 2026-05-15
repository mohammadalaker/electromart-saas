-- نفّذ هذا في Supabase → SQL Editor (عدّل اسم الجدول إن كان مختلفاً عن products)
-- يخصم الكمية ذرّياً من عمود stock_count دون race condition بين الطلبات المتزامنة

CREATE OR REPLACE FUNCTION public.decrement_stock(row_id uuid, amount int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.products
  SET stock_count = GREATEST(0, COALESCE(stock_count, 0) - GREATEST(1, amount))
  WHERE id = row_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decrement_stock(uuid, int) TO anon;
GRANT EXECUTE ON FUNCTION public.decrement_stock(uuid, int) TO authenticated;
