-- إصلاح أعمدة ناقصة في customer_ledger (رسائل مثل: credit / sale_id not in schema cache)
-- نفّذ في Supabase → SQL Editor مرة واحدة. إن فشل سطر بسبب وجود العمود، تجاهله أو علّقه.
--
-- المخطط الكامل المرجعي: supabase/customer_ledger.sql

-- مدين / دائن
ALTER TABLE public.customer_ledger
  ADD COLUMN IF NOT EXISTS debit numeric(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.customer_ledger
  ADD COLUMN IF NOT EXISTS credit numeric(14, 2) NOT NULL DEFAULT 0;

-- ربط بفاتورة (اختياري — رصيد افتتاحي يبقى NULL)
ALTER TABLE public.customer_ledger
  ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES public.sales (id) ON DELETE SET NULL;

ALTER TABLE public.customer_ledger
  ADD COLUMN IF NOT EXISTS description text;

COMMENT ON COLUMN public.customer_ledger.debit IS 'مبلغ يُضاف لذمة الزبون (مثلاً بيع بالآجل)';
COMMENT ON COLUMN public.customer_ledger.credit IS 'مبلغ يُخصم من الذمة (مثلاً تسديد)';
COMMENT ON COLUMN public.customer_ledger.sale_id IS 'فاتورة مرتبطة إن وُجدت';
