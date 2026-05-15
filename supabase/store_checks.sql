-- نظام الشيكات: وارد (من زبائن) وصادر (لموردين) + تظهير لمورد
-- نفّذ في Supabase SQL Editor بعد: public.stores ، public.store_contacts ، public.vouchers

CREATE TABLE IF NOT EXISTS public.store_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'endorsed', 'issued', 'delivered', 'cleared', 'bounced', 'void')),
  check_number text NOT NULL DEFAULT '',
  bank_name text NOT NULL DEFAULT '',
  branch_name text NOT NULL DEFAULT '',
  issue_date date,
  due_date date NOT NULL DEFAULT (CURRENT_DATE),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  customer_contact_id uuid REFERENCES public.store_contacts (id) ON DELETE SET NULL,
  payee_supplier_contact_id uuid REFERENCES public.store_contacts (id) ON DELETE SET NULL,
  receipt_voucher_id uuid REFERENCES public.vouchers (id) ON DELETE SET NULL,
  payment_voucher_id uuid REFERENCES public.vouchers (id) ON DELETE SET NULL,
  bounce_customer_reversal_voucher_id uuid REFERENCES public.vouchers (id) ON DELETE SET NULL,
  bounce_supplier_reversal_voucher_id uuid REFERENCES public.vouchers (id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_checks_store_due
  ON public.store_checks (store_id, due_date);
CREATE INDEX IF NOT EXISTS idx_store_checks_store_status
  ON public.store_checks (store_id, status);
CREATE INDEX IF NOT EXISTS idx_store_checks_store_direction
  ON public.store_checks (store_id, direction);

COMMENT ON TABLE public.store_checks IS 'شيكات واردة/صادرة لكل متجر — received/endorsed للوارد، issued/delivered للصادر';
COMMENT ON COLUMN public.store_checks.customer_contact_id IS 'الزبون الساحب — للشيك الوارد';
COMMENT ON COLUMN public.store_checks.payee_supplier_contact_id IS 'المورد المستفيد — للصادر أو بعد التظهير';
COMMENT ON COLUMN public.store_checks.bounce_customer_reversal_voucher_id IS 'سند عكس قبض الزبون عند مرتجع الشيك';
COMMENT ON COLUMN public.store_checks.bounce_supplier_reversal_voucher_id IS 'سند عكس صرف المورد عند مرتجع الشيك';

CREATE TABLE IF NOT EXISTS public.check_endorsements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id uuid NOT NULL REFERENCES public.store_checks (id) ON DELETE CASCADE,
  to_supplier_contact_id uuid NOT NULL REFERENCES public.store_contacts (id) ON DELETE CASCADE,
  endorsed_at timestamptz NOT NULL DEFAULT now(),
  notes text NOT NULL DEFAULT '',
  payment_voucher_id uuid REFERENCES public.vouchers (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_check_endorsements_check
  ON public.check_endorsements (check_id, endorsed_at DESC);

COMMENT ON TABLE public.check_endorsements IS 'سجل تظهير شيك وارد لمورد';

ALTER TABLE public.store_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.check_endorsements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_checks_select_own" ON public.store_checks;
CREATE POLICY "store_checks_select_own"
  ON public.store_checks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_checks.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_checks_insert_own" ON public.store_checks;
CREATE POLICY "store_checks_insert_own"
  ON public.store_checks FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_checks.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_checks_update_own" ON public.store_checks;
CREATE POLICY "store_checks_update_own"
  ON public.store_checks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_checks.store_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_checks.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_checks_delete_own" ON public.store_checks;
CREATE POLICY "store_checks_delete_own"
  ON public.store_checks FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_checks.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "check_endorsements_select_own" ON public.check_endorsements;
CREATE POLICY "check_endorsements_select_own"
  ON public.check_endorsements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.store_checks c
      JOIN public.stores s ON s.id = c.store_id
      WHERE c.id = check_endorsements.check_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "check_endorsements_insert_own" ON public.check_endorsements;
CREATE POLICY "check_endorsements_insert_own"
  ON public.check_endorsements FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.store_checks c
      JOIN public.stores s ON s.id = c.store_id
      WHERE c.id = check_endorsements.check_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "check_endorsements_update_own" ON public.check_endorsements;
CREATE POLICY "check_endorsements_update_own"
  ON public.check_endorsements FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.store_checks c
      JOIN public.stores s ON s.id = c.store_id
      WHERE c.id = check_endorsements.check_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.store_checks c
      JOIN public.stores s ON s.id = c.store_id
      WHERE c.id = check_endorsements.check_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_checks TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.check_endorsements TO authenticated;
GRANT ALL ON public.store_checks TO service_role;
GRANT ALL ON public.check_endorsements TO service_role;

-- لتتبّع سندات عكس المرتجع تلقائياً من الواجهة، نفّذ أيضاً: store_checks_bounce_reversal.sql
