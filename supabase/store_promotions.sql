-- store_promotions: POS promotion rules (bundle_pair + cart_qty_discount).
-- Run in Supabase SQL Editor AFTER public.stores exists.
-- IMPORTANT: every comment line must start with TWO dashes: --  (not a single -)

CREATE TABLE IF NOT EXISTS public.store_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  name_ar text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  kind text NOT NULL CHECK (kind IN ('bundle_pair', 'cart_qty_discount')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_promotions_store ON public.store_promotions (store_id, active, sort_order);

COMMENT ON TABLE public.store_promotions IS 'Smart promotions: bundle_pair (trigger+reward discount), cart_qty_discount (min units in cart).';
COMMENT ON COLUMN public.store_promotions.kind IS 'bundle_pair | cart_qty_discount';
COMMENT ON COLUMN public.store_promotions.config IS 'JSON per kind; see promotionEngine.js in the repo.';

ALTER TABLE public.store_promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_promotions_select_own" ON public.store_promotions;
CREATE POLICY "store_promotions_select_own"
  ON public.store_promotions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_promotions.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_promotions_insert_own" ON public.store_promotions;
CREATE POLICY "store_promotions_insert_own"
  ON public.store_promotions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_promotions.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_promotions_update_own" ON public.store_promotions;
CREATE POLICY "store_promotions_update_own"
  ON public.store_promotions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_promotions.store_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_promotions.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_promotions_delete_own" ON public.store_promotions;
CREATE POLICY "store_promotions_delete_own"
  ON public.store_promotions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_promotions.store_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_promotions TO authenticated;
GRANT ALL ON public.store_promotions TO service_role;
