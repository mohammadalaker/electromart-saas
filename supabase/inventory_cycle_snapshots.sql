-- لقطات جرد دورية: حفظ كميات النظام لكل صنف لمقارنتها لاحقاً بالجرد الفعلي.
-- نفّذ بعد public.stores و public.products (جدول products بأعمدة: id, store_id, barcode, eng_name, stock_count).
--
-- الجدول التلقائي على الخادم: فعّل امتداد pg_cron في لوحة Supabase ثم (اختياري):
--   SELECT cron.schedule(
--     'inventory-cycle-snapshots',
--     '0 2 * * *',
--     $$ SELECT public.run_scheduled_inventory_cycle_snapshots(); $$
--   );

CREATE TABLE IF NOT EXISTS public.store_inventory_cycle_settings (
  store_id uuid PRIMARY KEY REFERENCES public.stores (id) ON DELETE CASCADE,
  auto_snapshot_enabled boolean NOT NULL DEFAULT false,
  interval_days integer NOT NULL DEFAULT 7
    CHECK (interval_days >= 1 AND interval_days <= 365),
  last_auto_snapshot_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_cycle_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  product_id uuid,
  barcode text,
  eng_name text,
  system_qty numeric(14, 2) NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'scheduled'))
);

CREATE INDEX IF NOT EXISTS idx_inventory_cycle_snapshots_store_created
  ON public.inventory_cycle_snapshots (store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_cycle_snapshots_store_batch
  ON public.inventory_cycle_snapshots (store_id, batch_id);

COMMENT ON TABLE public.store_inventory_cycle_settings IS 'إعدادات اللقطات التلقائية للجرد حسب المتجر';
COMMENT ON TABLE public.inventory_cycle_snapshots IS 'صفوف لقطة جرد — كل دفعة تشترك في batch_id';

ALTER TABLE public.store_inventory_cycle_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_cycle_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cycle_settings_select_own" ON public.store_inventory_cycle_settings;
CREATE POLICY "cycle_settings_select_own"
  ON public.store_inventory_cycle_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_inventory_cycle_settings.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "cycle_settings_upsert_own" ON public.store_inventory_cycle_settings;
CREATE POLICY "cycle_settings_upsert_own"
  ON public.store_inventory_cycle_settings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_inventory_cycle_settings.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "cycle_settings_update_own" ON public.store_inventory_cycle_settings;
CREATE POLICY "cycle_settings_update_own"
  ON public.store_inventory_cycle_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_inventory_cycle_settings.store_id AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "cycle_snapshots_select_own" ON public.inventory_cycle_snapshots;
CREATE POLICY "cycle_snapshots_select_own"
  ON public.inventory_cycle_snapshots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = inventory_cycle_snapshots.store_id AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.store_inventory_cycle_settings TO authenticated;
GRANT SELECT ON public.inventory_cycle_snapshots TO authenticated;
GRANT ALL ON public.store_inventory_cycle_settings TO service_role;
GRANT ALL ON public.inventory_cycle_snapshots TO service_role;

-- لقطة جرد يدوية أو مستدعاة من الواجهة — تتحقق من ملكية المتجر
CREATE OR REPLACE FUNCTION public.create_inventory_cycle_snapshot(p_store_id uuid, p_source text DEFAULT 'manual')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch uuid := gen_random_uuid();
  v_src text := lower(trim(coalesce(p_source, 'manual')));
BEGIN
  IF v_src NOT IN ('manual', 'scheduled') THEN
    v_src := 'manual';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = p_store_id AND s.owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'غير مصرح بتسجيل جرد لهذا المتجر';
  END IF;

  INSERT INTO public.inventory_cycle_snapshots (
    store_id, batch_id, product_id, barcode, eng_name, system_qty, source
  )
  SELECT
    p_store_id,
    v_batch,
    p.id,
    p.barcode,
    p.eng_name,
    COALESCE(p.stock_count, 0),
    v_src
  FROM public.products p
  WHERE p.store_id = p_store_id;

  RETURN v_batch;
END;
$$;

REVOKE ALL ON FUNCTION public.create_inventory_cycle_snapshot(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_inventory_cycle_snapshot(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_inventory_cycle_snapshot(uuid, text) TO service_role;

COMMENT ON FUNCTION public.create_inventory_cycle_snapshot IS 'يُنشئ دفعة لقطات جرد لكل منتجات المتجر؛ يُرجع batch_id';

-- مهمة مجدولة (pg_cron): لقطات تلقائية حسب الإعدادات
CREATE OR REPLACE FUNCTION public.run_scheduled_inventory_cycle_snapshots()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_batch uuid;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT s.store_id, s.interval_days, s.last_auto_snapshot_at
    FROM public.store_inventory_cycle_settings s
    WHERE s.auto_snapshot_enabled = true
  LOOP
    IF r.last_auto_snapshot_at IS NULL
       OR r.last_auto_snapshot_at < (now() - (r.interval_days::text || ' days')::interval)
    THEN
      v_batch := gen_random_uuid();
      INSERT INTO public.inventory_cycle_snapshots (
        store_id, batch_id, product_id, barcode, eng_name, system_qty, source
      )
      SELECT
        r.store_id,
        v_batch,
        p.id,
        p.barcode,
        p.eng_name,
        COALESCE(p.stock_count, 0),
        'scheduled'
      FROM public.products p
      WHERE p.store_id = r.store_id;

      UPDATE public.store_inventory_cycle_settings
      SET last_auto_snapshot_at = now(), updated_at = now()
      WHERE store_id = r.store_id;

      n := n + 1;
    END IF;
  END LOOP;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.run_scheduled_inventory_cycle_snapshots() FROM PUBLIC;
-- صلاحية التشغيل من cron / دورة خلفية (عدّل حسب بيئتك)
GRANT EXECUTE ON FUNCTION public.run_scheduled_inventory_cycle_snapshots() TO postgres;
GRANT EXECUTE ON FUNCTION public.run_scheduled_inventory_cycle_snapshots() TO service_role;
