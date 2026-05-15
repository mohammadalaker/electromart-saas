-- نوع المنتج للتصفية في المتجر العام ونقطة البيع (ثلاجات، غسالات، …)
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type text;

COMMENT ON COLUMN products.product_type IS 'مفتاح نوع الجهاز: tv, fridge, washer, dryer, dishwasher, oven — أو NULL';
