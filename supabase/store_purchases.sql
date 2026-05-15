-- مشتريات بسيطة مرتبطة بمورد من الدليل + تحديث الذمة عند الشراء بالآجل

CREATE TABLE IF NOT EXISTS public.store_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  supplier_contact_id uuid REFERENCES public.store_contacts (id) ON DELETE SET NULL,
  total_amount numeric(14, 2) NOT NULL CHECK (total_amount >= 0),
  payment_mode text NOT NULL CHECK (payment_mode IN ('cash', 'credit')),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_purchases_store ON public.store_purchases (store_id, created_at DESC);

ALTER TABLE public.store_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_purchases_select_own" ON public.store_purchases;
CREATE POLICY "store_purchases_select_own"
  ON public.store_purchases FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_purchases.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_purchases_insert_own" ON public.store_purchases;
CREATE POLICY "store_purchases_insert_own"
  ON public.store_purchases FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_purchases.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_purchases_update_own" ON public.store_purchases;
CREATE POLICY "store_purchases_update_own"
  ON public.store_purchases FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_purchases.store_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_purchases.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_purchases_delete_own" ON public.store_purchases;
CREATE POLICY "store_purchases_delete_own"
  ON public.store_purchases FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_purchases.store_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_purchases TO authenticated;
GRANT ALL ON public.store_purchases TO service_role;

COMMENT ON TABLE public.store_purchases IS 'مشتريات من مورد — عند credit يُزاد رصيد الذمة على المورد (ما عليك له)';
