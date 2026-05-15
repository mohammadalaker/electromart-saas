-- ملاحظات شيكات مرتجعة لكل زبون — صفحة ملف الزبون
-- نفّذ في Supabase SQL Editor بعد public.store_contacts

ALTER TABLE public.store_contacts
  ADD COLUMN IF NOT EXISTS returned_cheques_notes text;

COMMENT ON COLUMN public.store_contacts.returned_cheques_notes IS 'متابعة شيكات مرتجعة أو ملاحظات تحصيل (تُعرض في صفحة ملف الزبون)';
