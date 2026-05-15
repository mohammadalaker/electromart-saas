-- مرتجعات لمورد: تخفيض مخزون وذمة (عند الآجل)

CREATE TABLE IF NOT EXISTS public.store_purchase_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  original_purchase_id uuid NOT NULL REFERENCES public.store_purchases (id) ON DELETE CASCADE,
  supplier_contact_id uuid REFERENCES public.store_contacts (id) ON DELETE SET NULL,
  return_total numeric(14, 2) NOT NULL CHECK (return_total >= 0),
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_purchase_returns_store
  ON public.store_purchase_returns (store_id, created_at DESC);

ALTER TABLE public.store_purchase_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_purchase_returns_select_own" ON public.store_purchase_returns;
CREATE POLICY "store_purchase_returns_select_own"
  ON public.store_purchase_returns FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_purchase_returns.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_purchase_returns_insert_own" ON public.store_purchase_returns;
CREATE POLICY "store_purchase_returns_insert_own"
  ON public.store_purchase_returns FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_purchase_returns.store_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT ON public.store_purchase_returns TO authenticated;
GRANT ALL ON public.store_purchase_returns TO service_role;

COMMENT ON TABLE public.store_purchase_returns IS 'إرجاع أصناف من فاتورة مشتريات — تخفيض مخزون وذمة';
