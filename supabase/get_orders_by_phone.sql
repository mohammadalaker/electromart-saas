-- تتبع طلبات الزبون عبر رقم الهاتف — للمتجر العام
-- نفّذ في Supabase SQL Editor بعد public.stores و public.sales

CREATE OR REPLACE FUNCTION get_orders_by_phone(p_slug text, p_phone text)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  total_amount numeric,
  status text,
  notes text,
  line_items jsonb,
  customer_name text
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.created_at,
    s.total_amount,
    s.status,
    s.notes,
    s.line_items,
    s.customer_name
  FROM sales s
  INNER JOIN stores st ON st.id = s.store_id
  WHERE st.public_slug = p_slug
    AND s.customer_phone = p_phone
    AND s.notes LIKE '%أونلاين%'
  ORDER BY s.created_at DESC
  LIMIT 20;
END;
$$;
