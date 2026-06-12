-- تخصيص ألوان المتجر العام: اللون الأساسي ولون الهيدر والفوتر
-- نفّذ في Supabase SQL Editor

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS primary_color text NOT NULL DEFAULT '#5B6BF5',
  ADD COLUMN IF NOT EXISTS header_color text NOT NULL DEFAULT '#1a1b3d';

COMMENT ON COLUMN public.stores.primary_color IS 'اللون الأساسي للمتجر العام (أزرار ونصوص مميزة)';
COMMENT ON COLUMN public.stores.header_color IS 'لون الهيدر والفوتر للمتجر العام';
