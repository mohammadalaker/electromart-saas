-- جدول سندات القبض والصرف — يُستخدم في صفحة /vouchers وكشف حساب المورد
-- نفّذ في Supabase: SQL Editor → New query → لصق → Run
-- يتطلب وجود جداول: public.stores ، public.store_contacts (اختياري للـ FK)

CREATE TABLE IF NOT EXISTS public.vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  -- مربوط بمورد في الدليل (نفس id في صفحة كشف الحساب)
  account_id uuid REFERENCES public.store_contacts (id) ON DELETE SET NULL,
  supplier_contact_id uuid REFERENCES public.store_contacts (id) ON DELETE SET NULL,
  -- إن ربطت موردين من جدول suppliers منفصل
  supplier_id uuid,
  voucher_type text NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  description text,
  date date NOT NULL DEFAULT (CURRENT_DATE),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vouchers_store_date ON public.vouchers (store_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_vouchers_store_account ON public.vouchers (store_id, account_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_store_supplier_contact ON public.vouchers (store_id, supplier_contact_id);

COMMENT ON TABLE public.vouchers IS 'سندات قبض/صرف — voucher_type: receipt | payment (أو قيم عربية إن وُجدت في الواجهة)';

ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vouchers_select_own_store" ON public.vouchers;
CREATE POLICY "vouchers_select_own_store"
  ON public.vouchers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = vouchers.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "vouchers_insert_own_store" ON public.vouchers;
CREATE POLICY "vouchers_insert_own_store"
  ON public.vouchers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = vouchers.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "vouchers_update_own_store" ON public.vouchers;
CREATE POLICY "vouchers_update_own_store"
  ON public.vouchers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = vouchers.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "vouchers_delete_own_store" ON public.vouchers;
CREATE POLICY "vouchers_delete_own_store"
  ON public.vouchers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = vouchers.store_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vouchers TO authenticated;
GRANT ALL ON public.vouchers TO service_role;

-- لتفعيل كاش/شيكات/فيزا والعملة: نفّذ أيضاً vouchers_tender_cheques.sql ثم vouchers_currency_visa.sql

-- إعلام PostgREST بإعادة تحميل المخطط (اختياري عند عدم ظهور الجدول في الـ API)
-- NOTIFY pgrst, 'reload schema';
