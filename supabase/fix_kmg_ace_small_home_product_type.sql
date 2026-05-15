-- تحديث نوع المنتج لمجموعة KMG ACE إلى قطع صغيرة ومنزلية
UPDATE products
SET product_type = 'small_home'
WHERE brand_group = 'KMG ACE'
  AND (product_type IS DISTINCT FROM 'small_home');
