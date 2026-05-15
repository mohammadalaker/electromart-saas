-- قيود يومية — محاسبة تلقائية مستوحاة من Odoo
-- نفّذ بعد وجود: public.stores, public.sales, public.store_purchases, public.store_fund_movements

-- ==================== دليل الحسابات ====================
-- 1001  الصندوق النقدي (cash_shop)
-- 1002  حساب البنك
-- 1100  المخزون (بسعر التكلفة)
-- 1200  ذمم المدينون (الزبائن الآجلون)
-- 2100  ذمم الدائنون (الموردون الآجلون)
-- 4001  إيراد المبيعات
-- 5001  تكلفة البضاعة المباعة (COGS)
-- 6001  المصروفات التشغيلية
-- ========================================================

CREATE TABLE IF NOT EXISTS public.journal_entries (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid        NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  entry_date    date        NOT NULL DEFAULT CURRENT_DATE,
  entry_type    text        NOT NULL
    CHECK (entry_type IN (
      'cash_sale', 'credit_sale', 'sale_return',
      'cash_purchase', 'credit_purchase',
      'expense', 'transfer', 'adjustment',
      'opening_balance', 'manual'
    )),
  reference_id     uuid,
  reference_type   text,   -- 'sale' | 'purchase' | 'voucher' | 'fund_movement' | null
  description      text    NOT NULL DEFAULT '',
  total_amount     numeric(14,2) NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
  id           uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id     uuid       NOT NULL REFERENCES public.journal_entries (id) ON DELETE CASCADE,
  account_code text       NOT NULL,
  account_name text       NOT NULL,
  debit        numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit       numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_journal_entries_store_date
  ON public.journal_entries (store_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_entries_store_type
  ON public.journal_entries (store_id, entry_type);
CREATE INDEX IF NOT EXISTS idx_journal_entries_reference
  ON public.journal_entries (reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry
  ON public.journal_entry_lines (entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account
  ON public.journal_entry_lines (account_code);

-- Row Level Security
ALTER TABLE public.journal_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_lines  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "je_select" ON public.journal_entries;
CREATE POLICY "je_select" ON public.journal_entries FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = journal_entries.store_id AND s.owner_id = auth.uid()));

DROP POLICY IF EXISTS "je_insert" ON public.journal_entries;
CREATE POLICY "je_insert" ON public.journal_entries FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = journal_entries.store_id AND s.owner_id = auth.uid()));

DROP POLICY IF EXISTS "jel_select" ON public.journal_entry_lines;
CREATE POLICY "jel_select" ON public.journal_entry_lines FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.journal_entries je
    JOIN public.stores s ON s.id = je.store_id
    WHERE je.id = journal_entry_lines.entry_id AND s.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "jel_insert" ON public.journal_entry_lines;
CREATE POLICY "jel_insert" ON public.journal_entry_lines FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.journal_entries je
    JOIN public.stores s ON s.id = je.store_id
    WHERE je.id = journal_entry_lines.entry_id AND s.owner_id = auth.uid()
  ));

GRANT SELECT, INSERT ON public.journal_entries      TO authenticated;
GRANT SELECT, INSERT ON public.journal_entry_lines  TO authenticated;
GRANT ALL ON public.journal_entries      TO service_role;
GRANT ALL ON public.journal_entry_lines  TO service_role;

COMMENT ON TABLE public.journal_entries      IS 'قيود يومية تلقائية — entry_type: cash_sale | credit_sale | expense | ...';
COMMENT ON TABLE public.journal_entry_lines  IS 'سطور كل قيد (مدين/دائن) مع كود الحساب واسمه';
