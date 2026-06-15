-- القيود اليومية المحاسبية الجديدة
-- نفّذ بعد وجود: public.stores و public.accounting_accounts

CREATE TABLE IF NOT EXISTS public.accounting_journal (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid          NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  entry_number  text          NOT NULL,
  date          date          NOT NULL DEFAULT CURRENT_DATE,
  description   text          NOT NULL DEFAULT '',
  reference     text          NOT NULL DEFAULT '',
  type          text          NOT NULL CHECK (type IN ('manual', 'sales', 'purchase', 'payment', 'receipt')),
  status        text          NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled')),
  created_at    timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (store_id, entry_number)
);

CREATE TABLE IF NOT EXISTS public.accounting_journal_lines (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id    uuid          NOT NULL REFERENCES public.accounting_journal (id) ON DELETE CASCADE,
  account_id    uuid          NOT NULL REFERENCES public.accounting_accounts (id) ON DELETE CASCADE,
  description   text          NOT NULL DEFAULT '',
  debit         numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit        numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  created_at    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT chk_debit_credit CHECK (
    (debit > 0 AND credit = 0) OR
    (credit > 0 AND debit = 0) OR
    (debit = 0 AND credit = 0)
  )
);

-- Indexing
CREATE INDEX IF NOT EXISTS idx_accounting_journal_store_date ON public.accounting_journal (store_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_journal_lines_journal ON public.accounting_journal_lines (journal_id);

-- RLS Enablement
ALTER TABLE public.accounting_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_journal_lines ENABLE ROW LEVEL SECURITY;

-- policies for accounting_journal
DROP POLICY IF EXISTS "journal_select" ON public.accounting_journal;
CREATE POLICY "journal_select" ON public.accounting_journal FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = accounting_journal.store_id AND s.owner_id = auth.uid()));

DROP POLICY IF EXISTS "journal_insert" ON public.accounting_journal;
CREATE POLICY "journal_insert" ON public.accounting_journal FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = accounting_journal.store_id AND s.owner_id = auth.uid()));

DROP POLICY IF EXISTS "journal_update" ON public.accounting_journal;
CREATE POLICY "journal_update" ON public.accounting_journal FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = accounting_journal.store_id AND s.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = accounting_journal.store_id AND s.owner_id = auth.uid()));

DROP POLICY IF EXISTS "journal_delete" ON public.accounting_journal;
CREATE POLICY "journal_delete" ON public.accounting_journal FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = accounting_journal.store_id AND s.owner_id = auth.uid()));

-- policies for accounting_journal_lines
DROP POLICY IF EXISTS "lines_select" ON public.accounting_journal_lines;
CREATE POLICY "lines_select" ON public.accounting_journal_lines FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.accounting_journal j
    JOIN public.stores s ON s.id = j.store_id
    WHERE j.id = accounting_journal_lines.journal_id AND s.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "lines_insert" ON public.accounting_journal_lines;
CREATE POLICY "lines_insert" ON public.accounting_journal_lines FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.accounting_journal j
    JOIN public.stores s ON s.id = j.store_id
    WHERE j.id = accounting_journal_lines.journal_id AND s.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "lines_update" ON public.accounting_journal_lines;
CREATE POLICY "lines_update" ON public.accounting_journal_lines FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.accounting_journal j
    JOIN public.stores s ON s.id = j.store_id
    WHERE j.id = accounting_journal_lines.journal_id AND s.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.accounting_journal j
    JOIN public.stores s ON s.id = j.store_id
    WHERE j.id = accounting_journal_lines.journal_id AND s.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "lines_delete" ON public.accounting_journal_lines;
CREATE POLICY "lines_delete" ON public.accounting_journal_lines FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.accounting_journal j
    JOIN public.stores s ON s.id = j.store_id
    WHERE j.id = accounting_journal_lines.journal_id AND s.owner_id = auth.uid()
  ));

GRANT ALL ON public.accounting_journal TO authenticated;
GRANT ALL ON public.accounting_journal TO service_role;
GRANT ALL ON public.accounting_journal_lines TO authenticated;
GRANT ALL ON public.accounting_journal_lines TO service_role;

COMMENT ON TABLE public.accounting_journal IS 'جدول القيود اليومية المحاسبية اليدوية وتلقائية النظام';
COMMENT ON TABLE public.accounting_journal_lines IS 'جدول سطور القيود اليومية (مدين ودائن بالحساب)';
