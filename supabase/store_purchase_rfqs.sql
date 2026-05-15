-- طلبات تسعيرة (RFQ مبسّط) — مقارنة موردين قبل أمر شراء
-- نفّذ بعد public.stores و public.store_contacts

CREATE TABLE IF NOT EXISTS public.store_purchase_rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'closed', 'cancelled')),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_purchase_rfq_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid NOT NULL REFERENCES public.store_purchase_rfqs (id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products (id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  qty numeric(14, 4) NOT NULL DEFAULT 1 CHECK (qty > 0),
  target_price numeric(14, 2),
  supplier_contact_id uuid REFERENCES public.store_contacts (id) ON DELETE SET NULL,
  quoted_price numeric(14, 2),
  line_notes text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_store_purchase_rfqs_store ON public.store_purchase_rfqs (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_purchase_rfq_lines_rfq ON public.store_purchase_rfq_lines (rfq_id);

COMMENT ON TABLE public.store_purchase_rfqs IS 'طلب تسعيرة — حالة draft/sent/closed';
COMMENT ON TABLE public.store_purchase_rfq_lines IS 'سطر RFQ: صنف، كمية، سعر مستهدف، عرض مورد اختياري';

ALTER TABLE public.store_purchase_rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_purchase_rfq_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_purchase_rfqs_select_own" ON public.store_purchase_rfqs;
CREATE POLICY "store_purchase_rfqs_select_own"
  ON public.store_purchase_rfqs FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_purchase_rfqs.store_id AND s.owner_id = auth.uid()));

DROP POLICY IF EXISTS "store_purchase_rfqs_insert_own" ON public.store_purchase_rfqs;
CREATE POLICY "store_purchase_rfqs_insert_own"
  ON public.store_purchase_rfqs FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_purchase_rfqs.store_id AND s.owner_id = auth.uid()));

DROP POLICY IF EXISTS "store_purchase_rfqs_update_own" ON public.store_purchase_rfqs;
CREATE POLICY "store_purchase_rfqs_update_own"
  ON public.store_purchase_rfqs FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_purchase_rfqs.store_id AND s.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_purchase_rfqs.store_id AND s.owner_id = auth.uid()));

DROP POLICY IF EXISTS "store_purchase_rfqs_delete_own" ON public.store_purchase_rfqs;
CREATE POLICY "store_purchase_rfqs_delete_own"
  ON public.store_purchase_rfqs FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_purchase_rfqs.store_id AND s.owner_id = auth.uid()));

DROP POLICY IF EXISTS "store_purchase_rfq_lines_select_own" ON public.store_purchase_rfq_lines;
CREATE POLICY "store_purchase_rfq_lines_select_own"
  ON public.store_purchase_rfq_lines FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.store_purchase_rfqs r JOIN public.stores s ON s.id = r.store_id
    WHERE r.id = store_purchase_rfq_lines.rfq_id AND s.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "store_purchase_rfq_lines_insert_own" ON public.store_purchase_rfq_lines;
CREATE POLICY "store_purchase_rfq_lines_insert_own"
  ON public.store_purchase_rfq_lines FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.store_purchase_rfqs r JOIN public.stores s ON s.id = r.store_id
    WHERE r.id = store_purchase_rfq_lines.rfq_id AND s.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "store_purchase_rfq_lines_update_own" ON public.store_purchase_rfq_lines;
CREATE POLICY "store_purchase_rfq_lines_update_own"
  ON public.store_purchase_rfq_lines FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.store_purchase_rfqs r JOIN public.stores s ON s.id = r.store_id
    WHERE r.id = store_purchase_rfq_lines.rfq_id AND s.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "store_purchase_rfq_lines_delete_own" ON public.store_purchase_rfq_lines;
CREATE POLICY "store_purchase_rfq_lines_delete_own"
  ON public.store_purchase_rfq_lines FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.store_purchase_rfqs r JOIN public.stores s ON s.id = r.store_id
    WHERE r.id = store_purchase_rfq_lines.rfq_id AND s.owner_id = auth.uid()
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_purchase_rfqs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_purchase_rfq_lines TO authenticated;
GRANT ALL ON public.store_purchase_rfqs TO service_role;
GRANT ALL ON public.store_purchase_rfq_lines TO service_role;
