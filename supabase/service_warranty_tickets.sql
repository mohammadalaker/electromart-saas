-- تذاكر صيانة وضمان (RMA) — مرتبطة بالسيريال وتاريخ البيع اختيارياً
-- نفّذ بعد public.stores و public.sales و public.products

CREATE TABLE IF NOT EXISTS public.service_warranty_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  ticket_no int NOT NULL,
  serial_number text NOT NULL,
  sale_id uuid REFERENCES public.sales (id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products (id) ON DELETE SET NULL,
  product_name_snapshot text NOT NULL DEFAULT '',
  sale_date date,
  customer_name text NOT NULL DEFAULT '',
  customer_phone text NOT NULL DEFAULT '',
  customer_email text,
  status text NOT NULL DEFAULT 'intake'
    CHECK (
      status IN (
        'intake',
        'inspecting',
        'waiting_parts',
        'repaired',
        'ready_pickup',
        'delivered',
        'cancelled'
      )
    ),
  symptom text NOT NULL DEFAULT '',
  internal_notes text NOT NULL DEFAULT '',
  ready_notified_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  UNIQUE (store_id, ticket_no)
);

CREATE INDEX IF NOT EXISTS idx_service_tickets_store_status
  ON public.service_warranty_tickets (store_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_tickets_serial
  ON public.service_warranty_tickets (store_id, serial_number);

COMMENT ON TABLE public.service_warranty_tickets IS 'تذاكر صيانة — ربط سيريال + تتبع حالة الجهاز';
COMMENT ON COLUMN public.service_warranty_tickets.status IS 'intake | inspecting | waiting_parts | repaired | ready_pickup | delivered | cancelled';

ALTER TABLE public.service_warranty_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_warranty_tickets_select_own" ON public.service_warranty_tickets;
CREATE POLICY "service_warranty_tickets_select_own"
  ON public.service_warranty_tickets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = service_warranty_tickets.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "service_warranty_tickets_insert_own" ON public.service_warranty_tickets;
CREATE POLICY "service_warranty_tickets_insert_own"
  ON public.service_warranty_tickets FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = service_warranty_tickets.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "service_warranty_tickets_update_own" ON public.service_warranty_tickets;
CREATE POLICY "service_warranty_tickets_update_own"
  ON public.service_warranty_tickets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = service_warranty_tickets.store_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = service_warranty_tickets.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "service_warranty_tickets_delete_own" ON public.service_warranty_tickets;
CREATE POLICY "service_warranty_tickets_delete_own"
  ON public.service_warranty_tickets FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = service_warranty_tickets.store_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_warranty_tickets TO authenticated;
GRANT ALL ON public.service_warranty_tickets TO service_role;
