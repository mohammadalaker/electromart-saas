-- تهيئة مواقع افتراضية وربط كميات المحل بـ products.stock_count (اختياري — يمكن الاعتماد على الواجهة)
-- نفّذ بعد store_locations.sql و product_stock_locations.sql

-- إدراج مواقع افتراضية لكل متجر لا يملك مواقع بعد
INSERT INTO public.store_locations (store_id, code, name_ar, is_sales_location, sort_order)
SELECT s.id, 'shop', 'المحل', true, 0
FROM public.stores s
WHERE NOT EXISTS (
  SELECT 1 FROM public.store_locations sl WHERE sl.store_id = s.id AND sl.code = 'shop'
);

INSERT INTO public.store_locations (store_id, code, name_ar, is_sales_location, sort_order)
SELECT s.id, 'warehouse', 'مستودع خارجي', false, 1
FROM public.stores s
WHERE NOT EXISTS (
  SELECT 1 FROM public.store_locations sl WHERE sl.store_id = s.id AND sl.code = 'warehouse'
);

-- ربط رصيد المحل بعمود المنتج (مرة واحدة لكل صف غير موجود)
INSERT INTO public.product_stock_locations (store_id, product_id, location_id, quantity)
SELECT
  p.store_id,
  p.id,
  sl.id,
  GREATEST(0, COALESCE(p.stock_count, 0)::numeric)
FROM public.products p
JOIN public.store_locations sl ON sl.store_id = p.store_id AND sl.code = 'shop'
ON CONFLICT (store_id, product_id, location_id) DO NOTHING;

INSERT INTO public.product_stock_locations (store_id, product_id, location_id, quantity)
SELECT
  p.store_id,
  p.id,
  sl.id,
  0
FROM public.products p
JOIN public.store_locations sl ON sl.store_id = p.store_id AND sl.code = 'warehouse'
ON CONFLICT (store_id, product_id, location_id) DO NOTHING;
