-- تحديث نوع المنتج لمجموعة Tefal Electric من Sheet1 إلى small_home
UPDATE products
SET product_type = 'small_home'
WHERE brand_group = 'Tefal Electric'
  AND (product_type = 'Sheet1' OR product_type IS NULL OR product_type = '');
