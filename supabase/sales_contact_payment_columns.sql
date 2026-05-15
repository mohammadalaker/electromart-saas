-- ربط فاتورة المبيعات بالزبون وطريقة الدفع (كاش / ذمة)
-- نفّذ في Supabase SQL Editor بعد وجود جدولي sales و store_contacts

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.store_contacts (id) ON DELETE SET NULL;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS payment_mode text CHECK (payment_mode IS NULL OR payment_mode IN ('cash', 'credit'));

COMMENT ON COLUMN public.sales.contact_id IS 'مرجع لزبون من store_contacts (role=customer) عند الربط بالدليل';
COMMENT ON COLUMN public.sales.payment_mode IS 'cash = كاش، credit = بيع بالذمة (يُحدَّث رصيد الزبون)';

CREATE INDEX IF NOT EXISTS idx_sales_contact_id ON public.sales (contact_id) WHERE contact_id IS NOT NULL;
