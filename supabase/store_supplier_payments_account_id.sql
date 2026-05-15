-- إضافة عمود account_id لربط السند بجهة الاتصال (نفس منطق المورد في الواجهة)
-- نفّذ مرة واحدة في Supabase SQL Editor إن كان الجدول بدون account_id

ALTER TABLE public.store_supplier_payments
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.store_contacts (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.store_supplier_payments.account_id IS 'معرّف جهة الاتصال (مورد) — يُعبأ من الواجهة مع supplier_contact_id';
