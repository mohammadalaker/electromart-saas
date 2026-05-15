-- تصنيف حجم الجهاز: صغير (منزلي) أو كبير — نفّذ في SQL Editor بعد وجود جدول products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS appliance_size text;

COMMENT ON COLUMN public.products.appliance_size IS 'small = قطع صغيرة/منزلي، large = قطع كبيرة، NULL = غير محدد';
