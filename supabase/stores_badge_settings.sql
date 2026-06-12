-- إعدادات شارات المنتجات في المتجر العام
-- نفّذ في Supabase SQL Editor — مطلوب قبل نشر ميزة الشارات وإلا يفشل تحميل المتجر العام

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS badge_low_stock_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS badge_low_stock_threshold int NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS badge_new_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS badge_new_days int NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS badge_limited_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS badge_bestseller_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.stores.badge_low_stock_enabled IS 'شارة آخر قطعة على بطاقات المنتجات';
COMMENT ON COLUMN public.stores.badge_low_stock_threshold IS 'حد المخزون لإظهار شارة آخر قطعة';
COMMENT ON COLUMN public.stores.badge_new_enabled IS 'شارة جديد';
COMMENT ON COLUMN public.stores.badge_new_days IS 'عدد الأيام لاعتبار المنتج جديداً';
COMMENT ON COLUMN public.stores.badge_limited_enabled IS 'شارة عرض محدود على المنتجات المخفّضة';
COMMENT ON COLUMN public.stores.badge_bestseller_enabled IS 'شارة الأكثر مبيعاً';
