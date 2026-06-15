-- دليل الحسابات (Chart of Accounts)
-- نفّذ بعد وجود: public.stores

CREATE TABLE IF NOT EXISTS public.accounting_accounts (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid          NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  code          text          NOT NULL,
  name          text          NOT NULL,
  type          text          NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  category      text          NOT NULL DEFAULT '',
  parent_id     uuid          REFERENCES public.accounting_accounts (id) ON DELETE SET NULL,
  notes         text          NOT NULL DEFAULT '',
  is_active     boolean       NOT NULL DEFAULT true,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (store_id, code)
);

-- Indexing
CREATE INDEX IF NOT EXISTS idx_accounting_accounts_store_code ON public.accounting_accounts (store_id, code);
CREATE INDEX IF NOT EXISTS idx_accounting_accounts_parent ON public.accounting_accounts (parent_id);

-- RLS Enablement
ALTER TABLE public.accounting_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "accounts_select" ON public.accounting_accounts;
CREATE POLICY "accounts_select" ON public.accounting_accounts FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = accounting_accounts.store_id AND s.owner_id = auth.uid()));

DROP POLICY IF EXISTS "accounts_insert" ON public.accounting_accounts;
CREATE POLICY "accounts_insert" ON public.accounting_accounts FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = accounting_accounts.store_id AND s.owner_id = auth.uid()));

DROP POLICY IF EXISTS "accounts_update" ON public.accounting_accounts;
CREATE POLICY "accounts_update" ON public.accounting_accounts FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = accounting_accounts.store_id AND s.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = accounting_accounts.store_id AND s.owner_id = auth.uid()));

DROP POLICY IF EXISTS "accounts_delete" ON public.accounting_accounts;
CREATE POLICY "accounts_delete" ON public.accounting_accounts FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = accounting_accounts.store_id AND s.owner_id = auth.uid()));

GRANT ALL ON public.accounting_accounts TO authenticated;
GRANT ALL ON public.accounting_accounts TO service_role;

COMMENT ON TABLE public.accounting_accounts IS 'جدول دليل الحسابات للمتجر — يدعم أصول، خصوم، حقوق ملكية، إيرادات، ومصروفات بشكل هرمي';
