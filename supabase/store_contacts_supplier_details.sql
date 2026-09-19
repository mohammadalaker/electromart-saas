-- إضافة الأعمدة الجديدة لجدول store_contacts لدعم تفاصيل الموردين الموسعة
-- نفّذ هذا الملف في Supabase SQL Editor

ALTER TABLE public.store_contacts
  ADD COLUMN IF NOT EXISTS contact_person_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS mobile_phone text DEFAULT '',
  ADD COLUMN IF NOT EXISTS city text DEFAULT '',
  ADD COLUMN IF NOT EXISTS licensed_operator text DEFAULT '';

-- تعليقات توضيحية للأعمدة
COMMENT ON COLUMN public.store_contacts.contact_person_name IS 'اسم مسؤول الحساب / جهة الاتصال لدى المورد';
COMMENT ON COLUMN public.store_contacts.mobile_phone IS 'رقم الهاتف النقال المنفصل للمورد / جهة الاتصال';
COMMENT ON COLUMN public.store_contacts.city IS 'المدينة';
COMMENT ON COLUMN public.store_contacts.licensed_operator IS 'المشغل المرخص (نص حر)';
