-- مواقع/مخازن لكل متجر (محل، مستودع خارجي، …)
-- نفّذ بعد public.stores

CREATE TABLE IF NOT EXISTS public.store_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  is_sales_location boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, code)
);

CREATE INDEX IF NOT EXISTS idx_store_locations_store ON public.store_locations (store_id, sort_order);

COMMENT ON TABLE public.store_locations IS 'مواقع المخزون — code: shop | warehouse | …';
COMMENT ON COLUMN public.store_locations.is_sales_location IS 'true للمحل الذي يُباع منه في POS';

ALTER TABLE public.store_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_locations_select_own" ON public.store_locations;
CREATE POLICY "store_locations_select_own"
  ON public.store_locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_locations.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_locations_insert_own" ON public.store_locations;
CREATE POLICY "store_locations_insert_own"
  ON public.store_locations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_locations.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_locations_update_own" ON public.store_locations;
CREATE POLICY "store_locations_update_own"
  ON public.store_locations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_locations.store_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_locations.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_locations_delete_own" ON public.store_locations;
CREATE POLICY "store_locations_delete_own"
  ON public.store_locations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_locations.store_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_locations TO authenticated;
GRANT ALL ON public.store_locations TO service_role;
