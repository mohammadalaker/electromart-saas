-- تحديث نوع المنتج لمجموعة Lofra إلى أفران + ميكروويف بلت إن
UPDATE products
SET product_type = 'oven'
WHERE brand_group = 'Lofra'
  AND (product_type IS DISTINCT FROM 'oven');
