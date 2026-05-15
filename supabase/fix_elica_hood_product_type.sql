-- تحديث نوع المنتج لمجموعة Elica إلى شفاطات
UPDATE products
SET product_type = 'hood'
WHERE lower(trim(brand_group)) = 'elica'
  AND (product_type IS DISTINCT FROM 'hood');
