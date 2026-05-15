-- دفتر ذمم الزبائن: حركات مدين/دائن مرتبطة بمتجر وزبون من دليل المتجر
-- نفّذ بعد وجود public.stores و public.store_contacts و public.sales

CREATE TABLE IF NOT EXISTS public.customer_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.store_contacts (id) ON DELETE CASCADE,
  sale_id uuid REFERENCES public.sales (id) ON DELETE SET NULL,
  debit numeric(14, 2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14, 2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description text,
  CONSTRAINT customer_ledger_debit_credit_nonneg CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0) OR (debit = 0 AND credit = 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_customer_ledger_store_customer
  ON public.customer_ledger (store_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_sale ON public.customer_ledger (sale_id);

ALTER TABLE public.customer_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_ledger_select_own" ON public.customer_ledger;
CREATE POLICY "customer_ledger_select_own"
  ON public.customer_ledger FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = customer_ledger.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "customer_ledger_insert_own" ON public.customer_ledger;
CREATE POLICY "customer_ledger_insert_own"
  ON public.customer_ledger FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = customer_ledger.store_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT ON public.customer_ledger TO authenticated;
GRANT ALL ON public.customer_ledger TO service_role;

COMMENT ON TABLE public.customer_ledger IS 'حركات ذمم العملاء — مدين يزيد الدين، دائن يقلّصه';
COMMENT ON COLUMN public.customer_ledger.debit IS 'مبلغ يُضاف لذمة الزبون (مثلاً بيع بالآجل)';
COMMENT ON COLUMN public.customer_ledger.credit IS 'مبلغ يُخصم من الذمة (مثلاً تسديد)';
