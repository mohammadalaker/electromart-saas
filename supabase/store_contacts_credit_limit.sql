-- سقف الدين للزبون: أقصى ذمة مسموح بها (₪)
-- NULL أو غير مُعرَّف = بدون سقف (السلوك القديم)
-- نفّذ بعد store_contacts_payment_columns.sql

ALTER TABLE public.store_contacts
  ADD COLUMN IF NOT EXISTS credit_limit numeric(14, 2);

COMMENT ON COLUMN public.store_contacts.credit_limit IS 'سقف الذمة بالشيقل — إذا كان > 0 يُمنع البيع بالذمة عند تجاوز (المستحق + فاتورة جديدة)';
