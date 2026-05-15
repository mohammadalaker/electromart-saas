-- تحديث نوع المنتج لمجموعة Moulinex إلى قطع صغيرة ومنزلية
UPDATE products
SET product_type = 'small_home'
WHERE lower(trim(brand_group)) = 'moulinex'
  AND (product_type IS DISTINCT FROM 'small_home');
