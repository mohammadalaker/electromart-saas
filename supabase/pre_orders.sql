-- طلبات حجز مسبق + عربون — مرتبطة بزبون وأصناف
-- نفّذ بعد public.stores و public.store_contacts و public.products

CREATE TABLE IF NOT EXISTS public.pre_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.store_contacts (id) ON DELETE RESTRICT,
  order_no int NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'deposit_paid', 'fulfilled', 'cancelled')),
  deposit_amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  grand_total numeric(14, 2) NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  UNIQUE (store_id, order_no)
);

CREATE TABLE IF NOT EXISTS public.pre_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_order_id uuid NOT NULL REFERENCES public.pre_orders (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
  qty int NOT NULL CHECK (qty > 0),
  unit_price numeric(14, 2) NOT NULL DEFAULT 0,
  line_total numeric(14, 2) NOT NULL DEFAULT 0,
  line_status text NOT NULL DEFAULT 'pending'
    CHECK (line_status IN ('pending', 'fulfilled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pre_order_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_pre_orders_store ON public.pre_orders (store_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pre_order_lines_product
  ON public.pre_order_lines (product_id)
  WHERE line_status = 'pending';

COMMENT ON TABLE public.pre_orders IS 'حجز مسبق مع عربون — يُنبَّه عند استيراد نفس الصنف في المشتريات';
COMMENT ON TABLE public.pre_order_lines IS 'أسطر الحجز — line_status pending حتى التسليم للزبون';

ALTER TABLE public.pre_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pre_order_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pre_orders_select_own" ON public.pre_orders;
CREATE POLICY "pre_orders_select_own"
  ON public.pre_orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = pre_orders.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "pre_orders_insert_own" ON public.pre_orders;
CREATE POLICY "pre_orders_insert_own"
  ON public.pre_orders FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = pre_orders.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "pre_orders_update_own" ON public.pre_orders;
CREATE POLICY "pre_orders_update_own"
  ON public.pre_orders FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = pre_orders.store_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = pre_orders.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "pre_orders_delete_own" ON public.pre_orders;
CREATE POLICY "pre_orders_delete_own"
  ON public.pre_orders FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = pre_orders.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "pre_order_lines_select_own" ON public.pre_order_lines;
CREATE POLICY "pre_order_lines_select_own"
  ON public.pre_order_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pre_orders o
      JOIN public.stores s ON s.id = o.store_id
      WHERE o.id = pre_order_lines.pre_order_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "pre_order_lines_insert_own" ON public.pre_order_lines;
CREATE POLICY "pre_order_lines_insert_own"
  ON public.pre_order_lines FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pre_orders o
      JOIN public.stores s ON s.id = o.store_id
      WHERE o.id = pre_order_lines.pre_order_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "pre_order_lines_update_own" ON public.pre_order_lines;
CREATE POLICY "pre_order_lines_update_own"
  ON public.pre_order_lines FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.pre_orders o
      JOIN public.stores s ON s.id = o.store_id
      WHERE o.id = pre_order_lines.pre_order_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pre_orders o
      JOIN public.stores s ON s.id = o.store_id
      WHERE o.id = pre_order_lines.pre_order_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "pre_order_lines_delete_own" ON public.pre_order_lines;
CREATE POLICY "pre_order_lines_delete_own"
  ON public.pre_order_lines FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.pre_orders o
      JOIN public.stores s ON s.id = o.store_id
      WHERE o.id = pre_order_lines.pre_order_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pre_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pre_order_lines TO authenticated;
GRANT ALL ON public.pre_orders TO service_role;
GRANT ALL ON public.pre_order_lines TO service_role;
