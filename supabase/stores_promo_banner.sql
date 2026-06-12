-- بانر إعلاني للمتجر العام — شريط ترويجي أعلى الصفحة
-- نفّذ في Supabase SQL Editor — مطلوب قبل نشر الميزة وإلا يفشل تحميل المتجر العام

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS banner_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS banner_title text,
  ADD COLUMN IF NOT EXISTS banner_subtitle text,
  ADD COLUMN IF NOT EXISTS banner_cta_text text,
  ADD COLUMN IF NOT EXISTS banner_cta_link text,
  ADD COLUMN IF NOT EXISTS banner_bg_color text NOT NULL DEFAULT '#1a1b3d',
  ADD COLUMN IF NOT EXISTS banner_text_color text NOT NULL DEFAULT '#ffffff';

COMMENT ON COLUMN public.stores.banner_enabled IS 'تفعيل البانر الإعلاني أعلى المتجر العام';
COMMENT ON COLUMN public.stores.banner_title IS 'العنوان الرئيسي للبانر';
COMMENT ON COLUMN public.stores.banner_subtitle IS 'النص الفرعي للبانر';
COMMENT ON COLUMN public.stores.banner_cta_text IS 'نص زر البانر';
COMMENT ON COLUMN public.stores.banner_cta_link IS 'رابط زر البانر (داخلي مثل #products أو خارجي)';
COMMENT ON COLUMN public.stores.banner_bg_color IS 'لون خلفية البانر (hex)';
COMMENT ON COLUMN public.stores.banner_text_color IS 'لون نص البانر (hex)';
