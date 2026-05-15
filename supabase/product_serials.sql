-- تتبع أرقام تسلسلية / IMEI مرتبطة بفاتورة شراء (للبحث لاحقاً عند البيع أو الصيانة)

CREATE TABLE IF NOT EXISTS public.product_serials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products (id) ON DELETE SET NULL,
  serial text NOT NULL,
  purchase_id uuid REFERENCES public.store_purchases (id) ON DELETE SET NULL,
  supplier_name text NOT NULL DEFAULT '',
  invoice_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_serials_serial_unique UNIQUE (store_id, serial)
);

CREATE INDEX IF NOT EXISTS idx_product_serials_store_serial
  ON public.product_serials (store_id, serial);

CREATE INDEX IF NOT EXISTS idx_product_serials_product
  ON public.product_serials (product_id)
  WHERE product_id IS NOT NULL;

COMMENT ON TABLE public.product_serials IS 'سجل سيريال/IMEI عند الشراء — للربط بالمورد والتاريخ';

ALTER TABLE public.product_serials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_serials_select_own" ON public.product_serials;
CREATE POLICY "product_serials_select_own"
  ON public.product_serials FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = product_serials.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "product_serials_insert_own" ON public.product_serials;
CREATE POLICY "product_serials_insert_own"
  ON public.product_serials FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = product_serials.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "product_serials_delete_own" ON public.product_serials;
CREATE POLICY "product_serials_delete_own"
  ON public.product_serials FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = product_serials.store_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, DELETE ON public.product_serials TO authenticated;
GRANT ALL ON public.product_serials TO service_role;
