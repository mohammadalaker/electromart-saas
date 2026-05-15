-- أعمدة نوع الدفع (كاش / دين) والمبلغ المستحق — نفّذ بعد إنشاء جدول store_contacts

ALTER TABLE public.store_contacts
  ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'cash'
    CHECK (payment_type IN ('cash', 'credit'));

ALTER TABLE public.store_contacts
  ADD COLUMN IF NOT EXISTS outstanding_amount numeric(14, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.store_contacts.payment_type IS 'cash = كاش، credit = دين (ذمة)';
COMMENT ON COLUMN public.store_contacts.outstanding_amount IS 'المبلغ المستحق على الذمة (₪) — يُستخدم عند payment_type = credit';
