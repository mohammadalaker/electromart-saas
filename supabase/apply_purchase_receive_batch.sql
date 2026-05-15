-- استلام دفعة أسطر مشتريات في معاملة واحدة (كلها تنجح أو تُلغى)
-- p_lines: [{ "product_id": "uuid", "qty": 10, "unit_cost": 100.5 }, ...]

CREATE OR REPLACE FUNCTION public.apply_purchase_receive_batch(p_store_id uuid, p_lines jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  el jsonb;
  pid uuid;
  q int;
  uc numeric;
BEGIN
  FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb))
  LOOP
    pid := (el->>'product_id')::uuid;
    q := COALESCE((el->>'qty')::int, 0);
    uc := COALESCE((el->>'unit_cost')::numeric, 0);
    IF pid IS NULL OR q <= 0 THEN
      CONTINUE;
    END IF;
    PERFORM public.apply_purchase_receive_wac(pid, p_store_id, q, uc);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_purchase_receive_batch(uuid, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.apply_purchase_receive_batch(uuid, jsonb) TO authenticated;
