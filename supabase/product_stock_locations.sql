-- كميات لكل صنف حسب الموقع (محل / مستودع خارجي / …)
-- نفّذ بعد store_locations.sql و public.products

CREATE TABLE IF NOT EXISTS public.product_stock_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.store_locations (id) ON DELETE CASCADE,
  quantity numeric(14, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, product_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_product_stock_locations_product
  ON public.product_stock_locations (store_id, product_id);
CREATE INDEX IF NOT EXISTS idx_product_stock_locations_loc
  ON public.product_stock_locations (store_id, location_id);

COMMENT ON TABLE public.product_stock_locations IS 'توزيع كمية الصنف بين المواقع — رصيد المحل يُزامن مع products.stock_count';

ALTER TABLE public.product_stock_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_stock_locations_select_own" ON public.product_stock_locations;
CREATE POLICY "product_stock_locations_select_own"
  ON public.product_stock_locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = product_stock_locations.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "product_stock_locations_insert_own" ON public.product_stock_locations;
CREATE POLICY "product_stock_locations_insert_own"
  ON public.product_stock_locations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = product_stock_locations.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "product_stock_locations_update_own" ON public.product_stock_locations;
CREATE POLICY "product_stock_locations_update_own"
  ON public.product_stock_locations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = product_stock_locations.store_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = product_stock_locations.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "product_stock_locations_delete_own" ON public.product_stock_locations;
CREATE POLICY "product_stock_locations_delete_own"
  ON public.product_stock_locations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = product_stock_locations.store_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_stock_locations TO authenticated;
GRANT ALL ON public.product_stock_locations TO service_role;
