-- محفّزات إنشاء قيود يومية تلقائية — نفّذ بعد journal_entries.sql
-- =================================================================
-- يستلزم وجود: public.sales, public.store_fund_movements, public.store_purchases

-- ────────────────────────────────────────────────
-- 1.  قيد عند إدراج فاتورة مبيعات (sales)
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_je_on_sale_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_entry_id uuid;
  v_dr_code  text;
  v_dr_name  text;
BEGIN
  -- مدين: صندوق (كاش) أو ذمم مدينون (ذمة)
  IF COALESCE(NEW.payment_mode,'cash') = 'credit' THEN
    v_dr_code := '1200';  v_dr_name := 'ذمم المدينون';
  ELSE
    v_dr_code := '1001';  v_dr_name := 'الصندوق النقدي';
  END IF;

  INSERT INTO public.journal_entries
    (store_id, entry_date, entry_type, reference_id, reference_type, description, total_amount)
  VALUES (
    NEW.store_id, CURRENT_DATE,
    CASE WHEN COALESCE(NEW.payment_mode,'cash') = 'credit' THEN 'credit_sale' ELSE 'cash_sale' END,
    NEW.id, 'sale',
    'فاتورة مبيعات — ' || COALESCE(LEFT(NEW.notes, 80), ''),
    COALESCE(NEW.total_amount, 0)
  ) RETURNING id INTO v_entry_id;

  -- سطر مدين: صندوق / ذمم
  INSERT INTO public.journal_entry_lines (entry_id, account_code, account_name, debit, credit)
  VALUES (v_entry_id, v_dr_code, v_dr_name, COALESCE(NEW.total_amount,0), 0);

  -- سطر دائن: إيراد المبيعات
  INSERT INTO public.journal_entry_lines (entry_id, account_code, account_name, debit, credit)
  VALUES (v_entry_id, '4001', 'إيراد المبيعات', 0, COALESCE(NEW.total_amount,0));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_je_sale_insert ON public.sales;
CREATE TRIGGER trg_je_sale_insert
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION fn_je_on_sale_insert();

-- ────────────────────────────────────────────────
-- 2.  قيد عند تسجيل حركة صندوق (store_fund_movements)
--     expense / adjustment / transfer
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_je_on_fund_movement_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_entry_id  uuid;
  v_etype     text;
  v_fund_code text;
BEGIN
  -- تحديد كود الصندوق من store_fund_accounts
  SELECT code INTO v_fund_code
  FROM public.store_fund_accounts
  WHERE id = NEW.fund_account_id
  LIMIT 1;

  IF v_fund_code IS NULL THEN v_fund_code := 'cash_shop'; END IF;

  CASE
    WHEN NEW.kind = 'expense'    THEN v_etype := 'expense';
    WHEN NEW.kind = 'transfer'   THEN v_etype := 'transfer';
    WHEN NEW.kind = 'adjustment' THEN v_etype := 'adjustment';
    ELSE v_etype := 'manual';
  END CASE;

  INSERT INTO public.journal_entries
    (store_id, entry_date, entry_type, reference_id, reference_type, description, total_amount)
  VALUES (
    NEW.store_id, CURRENT_DATE, v_etype,
    NEW.id, 'fund_movement',
    COALESCE(NEW.description, NEW.kind),
    NEW.amount
  ) RETURNING id INTO v_entry_id;

  IF NEW.direction = 'out' THEN
    -- مدين: حساب المصروف أو الصندوق الوجهة
    INSERT INTO public.journal_entry_lines (entry_id, account_code, account_name, debit, credit)
    VALUES (v_entry_id, '6001', 'المصروفات التشغيلية', NEW.amount, 0);
    -- دائن: الصندوق
    INSERT INTO public.journal_entry_lines (entry_id, account_code, account_name, debit, credit)
    VALUES (v_entry_id,
      CASE v_fund_code WHEN 'bank' THEN '1002' ELSE '1001' END,
      CASE v_fund_code WHEN 'bank' THEN 'حساب البنك'  ELSE 'الصندوق النقدي' END,
      0, NEW.amount);
  ELSE
    -- واردة (تسوية/إيداع)
    INSERT INTO public.journal_entry_lines (entry_id, account_code, account_name, debit, credit)
    VALUES (v_entry_id,
      CASE v_fund_code WHEN 'bank' THEN '1002' ELSE '1001' END,
      CASE v_fund_code WHEN 'bank' THEN 'حساب البنك'  ELSE 'الصندوق النقدي' END,
      NEW.amount, 0);
    INSERT INTO public.journal_entry_lines (entry_id, account_code, account_name, debit, credit)
    VALUES (v_entry_id, '4001', 'إيراد / تسوية واردة', 0, NEW.amount);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_je_fund_movement ON public.store_fund_movements;
CREATE TRIGGER trg_je_fund_movement
  AFTER INSERT ON public.store_fund_movements
  FOR EACH ROW EXECUTE FUNCTION fn_je_on_fund_movement_insert();

-- ────────────────────────────────────────────────
-- 3.  قيد عند تسجيل فاتورة مشتريات
-- ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_je_on_purchase_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_entry_id uuid;
BEGIN
  INSERT INTO public.journal_entries
    (store_id, entry_date, entry_type, reference_id, reference_type, description, total_amount)
  VALUES (
    NEW.store_id, COALESCE(NEW.invoice_date, CURRENT_DATE),
    CASE WHEN COALESCE(NEW.payment_mode,'cash') = 'credit' THEN 'credit_purchase' ELSE 'cash_purchase' END,
    NEW.id, 'purchase',
    'فاتورة مشتريات — ' || COALESCE(NEW.supplier_company_name, ''),
    COALESCE(NEW.total_amount, 0)
  ) RETURNING id INTO v_entry_id;

  -- مدين: المخزون
  INSERT INTO public.journal_entry_lines (entry_id, account_code, account_name, debit, credit)
  VALUES (v_entry_id, '1100', 'المخزون', COALESCE(NEW.total_amount,0), 0);

  -- دائن: الصندوق (كاش) أو ذمم دائنون (آجل)
  INSERT INTO public.journal_entry_lines (entry_id, account_code, account_name, debit, credit)
  VALUES (v_entry_id,
    CASE WHEN COALESCE(NEW.payment_mode,'cash') = 'credit' THEN '2100' ELSE '1001' END,
    CASE WHEN COALESCE(NEW.payment_mode,'cash') = 'credit' THEN 'ذمم الدائنون (موردون)' ELSE 'الصندوق النقدي' END,
    0, COALESCE(NEW.total_amount,0));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_je_purchase_insert ON public.store_purchases;
CREATE TRIGGER trg_je_purchase_insert
  AFTER INSERT ON public.store_purchases
  FOR EACH ROW EXECUTE FUNCTION fn_je_on_purchase_insert();
