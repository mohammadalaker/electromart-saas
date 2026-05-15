-- نقاط ولاء الزبائن — تجميع بالشراء واستبدال بخصم في POS
-- نفّذ بعد public.stores و public.store_contacts و public.sales

ALTER TABLE public.store_contacts
  ADD COLUMN IF NOT EXISTS loyalty_points numeric(14, 2) NOT NULL DEFAULT 0
  CHECK (loyalty_points >= 0);

COMMENT ON COLUMN public.store_contacts.loyalty_points IS 'رصيد نقاط الولاء (للزبائن)';

CREATE TABLE IF NOT EXISTS public.store_loyalty_settings (
  store_id uuid PRIMARY KEY REFERENCES public.stores (id) ON DELETE CASCADE,
  earn_shekel_per_point numeric(14, 4) NOT NULL DEFAULT 100
    CHECK (earn_shekel_per_point > 0),
  redeem_shekel_per_point numeric(14, 4) NOT NULL DEFAULT 1
    CHECK (redeem_shekel_per_point > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.store_loyalty_settings IS 'قواعد المتجر: كل N شيكل شراء = نقطة؛ كل نقطة تستبدل بـ M شيكل خصم';
COMMENT ON COLUMN public.store_loyalty_settings.earn_shekel_per_point IS 'مبلغ الشراء بالشيكل لكل نقطة مكتسبة (مثلاً 100)';
COMMENT ON COLUMN public.store_loyalty_settings.redeem_shekel_per_point IS 'قيمة الشيكل لكل نقطة عند الاستبدال (مثلاً 1)';

CREATE TABLE IF NOT EXISTS public.loyalty_point_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.store_contacts (id) ON DELETE CASCADE,
  sale_id uuid REFERENCES public.sales (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('earn', 'redeem', 'adjust')),
  points_delta numeric(14, 4) NOT NULL,
  shekel_amount numeric(14, 4),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_tx_store_contact
  ON public.loyalty_point_transactions (store_id, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_sale ON public.loyalty_point_transactions (sale_id);

ALTER TABLE public.store_loyalty_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_point_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_loyalty_settings_select_own" ON public.store_loyalty_settings;
CREATE POLICY "store_loyalty_settings_select_own"
  ON public.store_loyalty_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_loyalty_settings.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_loyalty_settings_insert_own" ON public.store_loyalty_settings;
CREATE POLICY "store_loyalty_settings_insert_own"
  ON public.store_loyalty_settings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_loyalty_settings.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_loyalty_settings_update_own" ON public.store_loyalty_settings;
CREATE POLICY "store_loyalty_settings_update_own"
  ON public.store_loyalty_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_loyalty_settings.store_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_loyalty_settings.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "loyalty_tx_select_own" ON public.loyalty_point_transactions;
CREATE POLICY "loyalty_tx_select_own"
  ON public.loyalty_point_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = loyalty_point_transactions.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "loyalty_tx_insert_own" ON public.loyalty_point_transactions;
CREATE POLICY "loyalty_tx_insert_own"
  ON public.loyalty_point_transactions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = loyalty_point_transactions.store_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.store_loyalty_settings TO authenticated;
GRANT SELECT, INSERT ON public.loyalty_point_transactions TO authenticated;
GRANT ALL ON public.store_loyalty_settings TO service_role;
GRANT ALL ON public.loyalty_point_transactions TO service_role;

-- صف افتراضي لكل متجر (قابل للتعديل لاحقاً من لوحة الإدارة)
INSERT INTO public.store_loyalty_settings (store_id)
SELECT id FROM public.stores
ON CONFLICT (store_id) DO NOTHING;
