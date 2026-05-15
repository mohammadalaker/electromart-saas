-- سندات صرف للمورد: دفعات نقدية تُنقص ذمة المورد
-- نفّذ بعد store_contacts.sql و store_purchases.sql

CREATE TABLE IF NOT EXISTS public.store_supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  supplier_contact_id uuid NOT NULL REFERENCES public.store_contacts (id) ON DELETE CASCADE,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  paid_at date NOT NULL DEFAULT CURRENT_DATE,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_supplier_payments_store_supplier
  ON public.store_supplier_payments (store_id, supplier_contact_id, paid_at DESC);

ALTER TABLE public.store_supplier_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_supplier_payments_select_own" ON public.store_supplier_payments;
CREATE POLICY "store_supplier_payments_select_own"
  ON public.store_supplier_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_supplier_payments.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_supplier_payments_insert_own" ON public.store_supplier_payments;
CREATE POLICY "store_supplier_payments_insert_own"
  ON public.store_supplier_payments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_supplier_payments.store_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT ON public.store_supplier_payments TO authenticated;
GRANT ALL ON public.store_supplier_payments TO service_role;

COMMENT ON TABLE public.store_supplier_payments IS 'دفعات نقدية للمورد — تُسجّل في كشف الحساب كدائن وتُنقص outstanding_amount';
