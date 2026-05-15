-- صناديق المتجر (كاش، بنك، عهدة) + حركات مالية (مصروفات، تحويلات، تسويات)
-- نفّذ في Supabase SQL Editor بعد وجود public.stores

CREATE TABLE IF NOT EXISTS public.store_fund_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  balance numeric(14, 2) NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, code)
);

CREATE INDEX IF NOT EXISTS idx_store_fund_accounts_store ON public.store_fund_accounts (store_id, sort_order);

COMMENT ON TABLE public.store_fund_accounts IS 'صناديق نقدية لكل متجر — code: cash_shop | bank | employee_petty';

CREATE TABLE IF NOT EXISTS public.store_fund_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  fund_account_id uuid NOT NULL REFERENCES public.store_fund_accounts (id) ON DELETE CASCADE,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  kind text NOT NULL CHECK (kind IN ('expense', 'transfer', 'adjustment')),
  expense_category text,
  description text NOT NULL DEFAULT '',
  counterparty_fund_id uuid REFERENCES public.store_fund_accounts (id) ON DELETE SET NULL,
  transfer_batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_fund_movements_store_created
  ON public.store_fund_movements (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_fund_movements_fund
  ON public.store_fund_movements (fund_account_id, created_at DESC);

COMMENT ON TABLE public.store_fund_movements IS 'حركات الصناديق: مصروف تشغيلي، تحويل بين صناديق، تسوية يدوية';
COMMENT ON COLUMN public.store_fund_movements.expense_category IS 'مثال: rent, electricity, salary, other — للمصروفات فقط';

ALTER TABLE public.store_fund_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_fund_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_fund_accounts_select_own" ON public.store_fund_accounts;
CREATE POLICY "store_fund_accounts_select_own"
  ON public.store_fund_accounts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_fund_accounts.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_fund_accounts_insert_own" ON public.store_fund_accounts;
CREATE POLICY "store_fund_accounts_insert_own"
  ON public.store_fund_accounts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_fund_accounts.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_fund_accounts_update_own" ON public.store_fund_accounts;
CREATE POLICY "store_fund_accounts_update_own"
  ON public.store_fund_accounts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_fund_accounts.store_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_fund_accounts.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_fund_accounts_delete_own" ON public.store_fund_accounts;
CREATE POLICY "store_fund_accounts_delete_own"
  ON public.store_fund_accounts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_fund_accounts.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_fund_movements_select_own" ON public.store_fund_movements;
CREATE POLICY "store_fund_movements_select_own"
  ON public.store_fund_movements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_fund_movements.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_fund_movements_insert_own" ON public.store_fund_movements;
CREATE POLICY "store_fund_movements_insert_own"
  ON public.store_fund_movements FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_fund_movements.store_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_fund_accounts TO authenticated;
GRANT SELECT, INSERT ON public.store_fund_movements TO authenticated;
GRANT ALL ON public.store_fund_accounts TO service_role;
GRANT ALL ON public.store_fund_movements TO service_role;
