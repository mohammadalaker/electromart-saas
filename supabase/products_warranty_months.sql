-- مدة ضمان الصنف بالأشهر (للشاشات، الغسالات، إلخ)
-- نفّذ بعد وجود public.products

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS warranty_months smallint
  CHECK (warranty_months IS NULL OR (warranty_months >= 0 AND warranty_months <= 240));

COMMENT ON COLUMN public.products.warranty_months IS 'مدة الضمان بالأشهر — 0 لا يوجد، NULL غير محدد، أو 1–240';
