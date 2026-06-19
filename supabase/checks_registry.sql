-- سجل الشيكات والكمبيالات (وارد / صادر) — نفّذ في Supabase SQL Editor
-- يعمل بجانب store_checks دون استبداله

CREATE TABLE IF NOT EXISTS public.checks_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'cashed', 'bounced', 'cancelled')),
  contact_id uuid REFERENCES public.store_contacts (id) ON DELETE SET NULL,
  check_number text NOT NULL DEFAULT '',
  bank_name text NOT NULL DEFAULT '',
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  issue_date date,
  due_date date NOT NULL DEFAULT (CURRENT_DATE),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checks_registry_store_due
  ON public.checks_registry (store_id, due_date);
CREATE INDEX IF NOT EXISTS idx_checks_registry_store_status
  ON public.checks_registry (store_id, status);
CREATE INDEX IF NOT EXISTS idx_checks_registry_store_direction
  ON public.checks_registry (store_id, direction);

COMMENT ON TABLE public.checks_registry IS 'سجل شيكات واردة/صادرة — pending | cashed | bounced | cancelled';

ALTER TABLE public.checks_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checks_registry_select_own" ON public.checks_registry;
CREATE POLICY "checks_registry_select_own"
  ON public.checks_registry FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = checks_registry.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "checks_registry_insert_own" ON public.checks_registry;
CREATE POLICY "checks_registry_insert_own"
  ON public.checks_registry FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = checks_registry.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "checks_registry_update_own" ON public.checks_registry;
CREATE POLICY "checks_registry_update_own"
  ON public.checks_registry FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = checks_registry.store_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = checks_registry.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "checks_registry_delete_own" ON public.checks_registry;
CREATE POLICY "checks_registry_delete_own"
  ON public.checks_registry FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = checks_registry.store_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checks_registry TO authenticated;
GRANT ALL ON public.checks_registry TO service_role;
