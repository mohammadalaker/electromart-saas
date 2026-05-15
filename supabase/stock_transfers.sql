-- تحويلات مخزنية بين مواقع المتجر
-- نفّذ بعد product_stock_locations.sql

CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  from_location_id uuid NOT NULL REFERENCES public.store_locations (id) ON DELETE RESTRICT,
  to_location_id uuid NOT NULL REFERENCES public.store_locations (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending_receive'
    CHECK (status IN ('pending_receive', 'received', 'cancelled')),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_name text,
  received_at timestamptz,
  received_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  received_by_name text,
  CONSTRAINT stock_transfers_different_locations CHECK (from_location_id <> to_location_id)
);

CREATE TABLE IF NOT EXISTS public.stock_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.stock_transfers (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  quantity numeric(14, 2) NOT NULL CHECK (quantity > 0),
  UNIQUE (transfer_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_store_created
  ON public.stock_transfers (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status
  ON public.stock_transfers (store_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_lines_transfer
  ON public.stock_transfer_lines (transfer_id);

COMMENT ON TABLE public.stock_transfers IS 'طلب تحويل — pending_receive حتى يؤكد المستلم الاستلام';
COMMENT ON COLUMN public.stock_transfers.status IS 'pending_receive | received | cancelled';

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_transfers_select_own" ON public.stock_transfers;
CREATE POLICY "stock_transfers_select_own"
  ON public.stock_transfers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = stock_transfers.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "stock_transfers_insert_own" ON public.stock_transfers;
CREATE POLICY "stock_transfers_insert_own"
  ON public.stock_transfers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = stock_transfers.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "stock_transfers_update_own" ON public.stock_transfers;
CREATE POLICY "stock_transfers_update_own"
  ON public.stock_transfers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = stock_transfers.store_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = stock_transfers.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "stock_transfer_lines_select_own" ON public.stock_transfer_lines;
CREATE POLICY "stock_transfer_lines_select_own"
  ON public.stock_transfer_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stock_transfers t
      JOIN public.stores s ON s.id = t.store_id
      WHERE t.id = stock_transfer_lines.transfer_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "stock_transfer_lines_insert_own" ON public.stock_transfer_lines;
CREATE POLICY "stock_transfer_lines_insert_own"
  ON public.stock_transfer_lines FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stock_transfers t
      JOIN public.stores s ON s.id = t.store_id
      WHERE t.id = stock_transfer_lines.transfer_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "stock_transfer_lines_delete_own" ON public.stock_transfer_lines;
CREATE POLICY "stock_transfer_lines_delete_own"
  ON public.stock_transfer_lines FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.stock_transfers t
      JOIN public.stores s ON s.id = t.store_id
      WHERE t.id = stock_transfer_lines.transfer_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_transfers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_transfer_lines TO authenticated;
GRANT ALL ON public.stock_transfers TO service_role;
GRANT ALL ON public.stock_transfer_lines TO service_role;
