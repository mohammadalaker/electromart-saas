-- جدول الزبائن والموردين لكل متجر (SaaS)
-- نفّذ هذا الملف في SQL Editor في لوحة Supabase ثم فعّل RLS إن لزم.

CREATE TABLE IF NOT EXISTS public.store_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('customer', 'supplier')),
  name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_contacts_store_role
  ON public.store_contacts (store_id, role);

ALTER TABLE public.store_contacts ENABLE ROW LEVEL SECURITY;

-- صاحب المتجر فقط (عبر stores.owner_id)
DROP POLICY IF EXISTS "store_contacts_select_own" ON public.store_contacts;
CREATE POLICY "store_contacts_select_own"
  ON public.store_contacts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_contacts.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_contacts_insert_own" ON public.store_contacts;
CREATE POLICY "store_contacts_insert_own"
  ON public.store_contacts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_contacts.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_contacts_update_own" ON public.store_contacts;
CREATE POLICY "store_contacts_update_own"
  ON public.store_contacts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_contacts.store_id AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_contacts.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_contacts_delete_own" ON public.store_contacts;
CREATE POLICY "store_contacts_delete_own"
  ON public.store_contacts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_contacts.store_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_contacts TO authenticated;
GRANT ALL ON public.store_contacts TO service_role;

COMMENT ON TABLE public.store_contacts IS 'زبائن وموردون مرتبطون بمتجر — role = customer | supplier';

-- أعمدة كاش/دين: نفّذ أيضاً الملف store_contacts_payment_columns.sql
