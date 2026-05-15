-- سجل التدقيق (Audit Log) — رقابة داخلية لكل عملية على الجداول الرئيسية
-- نفّذ بعد: public.stores, public.sales, public.products, public.store_contacts, public.store_purchases

CREATE TABLE IF NOT EXISTS public.activity_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid        REFERENCES public.stores (id) ON DELETE SET NULL,
  user_id       uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  action_type   text        NOT NULL CHECK (action_type IN ('INSERT','UPDATE','DELETE','LOGIN','MANUAL')),
  entity_type   text        NOT NULL,   -- 'sale' | 'product' | 'contact' | 'purchase' | 'fund_movement' | ...
  entity_id     uuid,
  description   text        NOT NULL DEFAULT '',
  old_data      jsonb,
  new_data      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_store_date
  ON public.activity_log (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity
  ON public.activity_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user
  ON public.activity_log (user_id, created_at DESC);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "al_select" ON public.activity_log;
CREATE POLICY "al_select" ON public.activity_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = activity_log.store_id AND s.owner_id = auth.uid()));

DROP POLICY IF EXISTS "al_insert" ON public.activity_log;
CREATE POLICY "al_insert" ON public.activity_log FOR INSERT
  WITH CHECK (
    store_id IS NULL
    OR EXISTS (SELECT 1 FROM public.stores s WHERE s.id = activity_log.store_id AND s.owner_id = auth.uid())
  );

GRANT SELECT, INSERT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;

COMMENT ON TABLE public.activity_log IS 'سجل تدقيق داخلي — كل INSERT/UPDATE/DELETE على الجداول الحرجة';

-- ────────────────────────────────────────────────
-- دالة مشتركة لتسجيل الحدث
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_log_activity(
  p_store_id    uuid,
  p_action_type text,
  p_entity_type text,
  p_entity_id   uuid,
  p_description text,
  p_old_data    jsonb DEFAULT NULL,
  p_new_data    jsonb DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.activity_log
    (store_id, user_id, action_type, entity_type, entity_id, description, old_data, new_data)
  VALUES (
    p_store_id,
    auth.uid(),
    p_action_type, p_entity_type, p_entity_id,
    p_description, p_old_data, p_new_data
  );
END;
$$;

-- ────────────────────────────────────────────────
-- محفّز: تسجيل بيع جديد
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_al_on_sale_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM fn_log_activity(
    NEW.store_id, 'INSERT', 'sale', NEW.id,
    'فاتورة مبيعات جديدة — ' ||
      COALESCE(to_char(NEW.total_amount,'FM999,999,990.00'),'0') || ' ₪ — ' ||
      COALESCE(NEW.payment_mode,'cash'),
    NULL,
    jsonb_build_object('total_amount', NEW.total_amount, 'payment_mode', NEW.payment_mode,
                       'notes', LEFT(COALESCE(NEW.notes,''),120))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_al_sale_insert ON public.sales;
CREATE TRIGGER trg_al_sale_insert
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION fn_al_on_sale_insert();

-- محفّز: مرتجع مبيعات (تحديث returned_at)
CREATE OR REPLACE FUNCTION fn_al_on_sale_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.returned_at IS NULL AND NEW.returned_at IS NOT NULL THEN
    PERFORM fn_log_activity(
      NEW.store_id, 'UPDATE', 'sale', NEW.id,
      'مرتجع مبيعات — ' || to_char(NEW.total_amount,'FM999,999,990.00') || ' ₪',
      jsonb_build_object('returned_at', NULL),
      jsonb_build_object('returned_at', NEW.returned_at, 'return_note', NEW.return_note)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_al_sale_update ON public.sales;
CREATE TRIGGER trg_al_sale_update
  AFTER UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION fn_al_on_sale_update();

-- ────────────────────────────────────────────────
-- محفّز: تغيير سعر أو كمية منتج
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_al_on_product_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_changes text := '';
BEGIN
  IF OLD.full_price IS DISTINCT FROM NEW.full_price THEN
    v_changes := v_changes || 'التكلفة: ' || COALESCE(OLD.full_price::text,'—') || ' → ' || COALESCE(NEW.full_price::text,'—') || '; ';
  END IF;
  IF OLD.price_after_disc IS DISTINCT FROM NEW.price_after_disc THEN
    v_changes := v_changes || 'سعر البيع: ' || COALESCE(OLD.price_after_disc::text,'—') || ' → ' || COALESCE(NEW.price_after_disc::text,'—') || '; ';
  END IF;
  IF OLD.stock_count IS DISTINCT FROM NEW.stock_count THEN
    v_changes := v_changes || 'الكمية: ' || COALESCE(OLD.stock_count::text,'—') || ' → ' || COALESCE(NEW.stock_count::text,'—') || '; ';
  END IF;

  IF v_changes <> '' THEN
    PERFORM fn_log_activity(
      NEW.store_id, 'UPDATE', 'product', NEW.id,
      'تعديل منتج [' || COALESCE(NEW.eng_name, NEW.barcode, '?') || '] — ' || v_changes,
      jsonb_build_object('full_price', OLD.full_price, 'price_after_disc', OLD.price_after_disc, 'stock_count', OLD.stock_count),
      jsonb_build_object('full_price', NEW.full_price, 'price_after_disc', NEW.price_after_disc, 'stock_count', NEW.stock_count)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_al_product_update ON public.products;
CREATE TRIGGER trg_al_product_update
  AFTER UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION fn_al_on_product_update();

-- ────────────────────────────────────────────────
-- محفّز: حذف منتج
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_al_on_product_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM fn_log_activity(
    OLD.store_id, 'DELETE', 'product', OLD.id,
    'حذف منتج [' || COALESCE(OLD.eng_name, OLD.barcode, '?') || '] — كمية: ' || COALESCE(OLD.stock_count::text,'0'),
    jsonb_build_object('name', OLD.eng_name, 'barcode', OLD.barcode, 'stock_count', OLD.stock_count, 'full_price', OLD.full_price),
    NULL
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_al_product_delete ON public.products;
CREATE TRIGGER trg_al_product_delete
  AFTER DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION fn_al_on_product_delete();

-- ────────────────────────────────────────────────
-- محفّز: تغيير رصيد زبون/مورد
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_al_on_contact_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.outstanding_amount IS DISTINCT FROM NEW.outstanding_amount THEN
    PERFORM fn_log_activity(
      NEW.store_id, 'UPDATE', 'contact', NEW.id,
      'تغيير رصيد [' || NEW.role || '] ' || COALESCE(NEW.name,'?') ||
        ' — ' || COALESCE(OLD.outstanding_amount::text,'0') || ' → ' || COALESCE(NEW.outstanding_amount::text,'0') || ' ₪',
      jsonb_build_object('outstanding_amount', OLD.outstanding_amount),
      jsonb_build_object('outstanding_amount', NEW.outstanding_amount)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_al_contact_update ON public.store_contacts;
CREATE TRIGGER trg_al_contact_update
  AFTER UPDATE ON public.store_contacts
  FOR EACH ROW EXECUTE FUNCTION fn_al_on_contact_update();

-- ────────────────────────────────────────────────
-- محفّز: مشتريات جديدة
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_al_on_purchase_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM fn_log_activity(
    NEW.store_id, 'INSERT', 'purchase', NEW.id,
    'فاتورة مشتريات — ' || COALESCE(NEW.supplier_company_name,'?') ||
      ' — ' || COALESCE(to_char(NEW.total_amount,'FM999,999,990.00'),'0') || ' ₪ — ' || COALESCE(NEW.payment_mode,'cash'),
    NULL,
    jsonb_build_object('total_amount', NEW.total_amount, 'payment_mode', NEW.payment_mode,
                       'supplier', NEW.supplier_company_name)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_al_purchase_insert ON public.store_purchases;
CREATE TRIGGER trg_al_purchase_insert
  AFTER INSERT ON public.store_purchases
  FOR EACH ROW EXECUTE FUNCTION fn_al_on_purchase_insert();
