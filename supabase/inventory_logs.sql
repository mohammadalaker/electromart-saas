-- سجل تعديلات المخزن: من عدّل، أي صنف، كمية قبل/بعد، السبب
-- نفّذ بعد وجود public.stores و public.products (أو جدول المنتجات المستخدم لديك)

CREATE TABLE IF NOT EXISTS public.inventory_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  actor_name text,
  product_id uuid,
  barcode text,
  product_name text,
  qty_before numeric(14, 2) NOT NULL DEFAULT 0,
  qty_after numeric(14, 2) NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT 'adjustment'
    CHECK (reason IN ('sale', 'purchase', 'adjustment', 'damaged', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_inventory_logs_store_created
  ON public.inventory_logs (store_id, created_at DESC);

ALTER TABLE public.inventory_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_logs_select_own" ON public.inventory_logs;
CREATE POLICY "inventory_logs_select_own"
  ON public.inventory_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = inventory_logs.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "inventory_logs_insert_own" ON public.inventory_logs;
CREATE POLICY "inventory_logs_insert_own"
  ON public.inventory_logs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = inventory_logs.store_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT ON public.inventory_logs TO authenticated;
GRANT ALL ON public.inventory_logs TO service_role;

COMMENT ON TABLE public.inventory_logs IS 'حركات مخزن — بيع، شراء، تعديل يدوي، تالف';
COMMENT ON COLUMN public.inventory_logs.actor_name IS 'اسم المعروض من metadata المستخدم';
COMMENT ON COLUMN public.inventory_logs.reason IS 'sale | purchase | adjustment | damaged | other';
