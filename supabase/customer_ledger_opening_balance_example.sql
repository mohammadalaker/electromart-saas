-- مثال: تسجيل رصيد افتتاحي / مرحّل لزبون (مدين) عندما يوجد رصيد في الدليل بلا فواتير مربوطة
-- استبدل المعرفات بقيمك من Table Editor ثم نفّذ في SQL Editor.
-- يجب تنفيذ customer_ledger.sql أولاً.

/*
INSERT INTO public.customer_ledger (
  store_id,
  customer_id,
  sale_id,
  debit,
  credit,
  description
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,  -- stores.id
  '00000000-0000-0000-0000-000000000002'::uuid,  -- store_contacts.id (زبون)
  NULL,
  1790.00,
  0,
  'رصيد مرحّل — مطابقة رصيد الدليل قبل ربط الفواتير'
);
*/
