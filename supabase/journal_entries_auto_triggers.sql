-- =================================================================
-- محفّزات إنشاء قيود يومية تلقائية على النظام المحاسبي الجديد
-- (public.accounting_journal & public.accounting_journal_lines)
-- نفّذ في Supabase: SQL Editor → New query → لصق → Run
-- =================================================================
-- يستلزم وجود: public.sales, public.store_fund_movements, public.store_purchases, public.vouchers, public.accounting_accounts

-- ─────────────────────────────────────────────────────────────────
-- 1. قيد المبيعات التلقائي عند إدراج فاتورة مبيعات (public.sales)
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_je_on_sale_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_entry_id   uuid;
  v_prefix     text;
  v_seq        integer;
  v_entry_num  text;
  v_dr_code    text;
  v_dr_name    text;
  v_dr_acc_id  uuid;
  v_cr_acc_id  uuid;
  v_amount     numeric(14,2);
BEGIN
  v_amount := COALESCE(NEW.total_amount, 0);
  IF v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- 1. تحديد كود الحساب المدين بفحص مزدوج (payment_mode أو payment_method)
  IF COALESCE(NEW.payment_mode, '') = 'credit' 
     OR COALESCE(NEW.payment_method, '') IN ('credit', 'deferred') THEN
    v_dr_code := '1200';
    v_dr_name := 'ذمم العملاء';
  ELSE
    v_dr_code := '1001';
    v_dr_name := 'الصندوق النقدي';
  END IF;

  -- 2. جلب معرفات الحسابات ديناميكياً من دليل حسابات نفس المتجر
  SELECT id INTO v_dr_acc_id 
  FROM public.accounting_accounts 
  WHERE store_id = NEW.store_id AND code = v_dr_code AND is_active = true 
  LIMIT 1;

  SELECT id INTO v_cr_acc_id 
  FROM public.accounting_accounts 
  WHERE store_id = NEW.store_id AND code = '4001' AND is_active = true 
  LIMIT 1;

  -- إذا لم يكن دليل الحسابات مهيأ للمتجر بعد، لا نوقف العملية البيعية على الكاشير
  IF v_dr_acc_id IS NULL OR v_cr_acc_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 3. توليد رقم قيد متسلسل بنمط JE-YYYYMM-XXXX
  v_prefix := 'JE-' || to_char(CURRENT_DATE, 'YYYYMM') || '-';
  SELECT COALESCE(MAX(
    CASE 
      WHEN entry_number ~ ('^' || v_prefix || '[0-9]+$') 
      THEN SUBSTRING(entry_number FROM LENGTH(v_prefix) + 1)::integer 
      ELSE 0 
    END
  ), 0) + 1
  INTO v_seq
  FROM public.accounting_journal
  WHERE store_id = NEW.store_id AND entry_number LIKE v_prefix || '%';

  v_entry_num := v_prefix || LPAD(v_seq::text, 4, '0');

  -- 4. إدراج رأس القيد في accounting_journal
  INSERT INTO public.accounting_journal (
    store_id,
    entry_number,
    date,
    description,
    reference,
    type,
    status,
    created_at
  ) VALUES (
    NEW.store_id,
    v_entry_num,
    CURRENT_DATE,
    'فاتورة مبيعات — ' || COALESCE(LEFT(NEW.notes, 80), ''),
    NEW.id::text,
    'sales',
    'posted',
    now()
  ) RETURNING id INTO v_entry_id;

  -- 5. إدراج سطر المدين (الصندوق أو العملاء)
  INSERT INTO public.accounting_journal_lines (
    journal_id,
    account_id,
    description,
    debit,
    credit,
    created_at
  ) VALUES (
    v_entry_id,
    v_dr_acc_id,
    'طرف مدين: ' || v_dr_name,
    v_amount,
    0,
    now()
  );

  -- 6. إدراج سطر الدائن (إيرادات المبيعات 4001)
  INSERT INTO public.accounting_journal_lines (
    journal_id,
    account_id,
    description,
    debit,
    credit,
    created_at
  ) VALUES (
    v_entry_id,
    v_cr_acc_id,
    'طرف دائن: إيرادات المبيعات',
    0,
    v_amount,
    now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_je_sale_insert ON public.sales;
CREATE TRIGGER trg_je_sale_insert
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.fn_je_on_sale_insert();


-- ─────────────────────────────────────────────────────────────────
-- 2. قيد المشتريات التلقائي عند إدراج فاتورة مشتريات (public.store_purchases)
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_je_on_purchase_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_entry_id   uuid;
  v_prefix     text;
  v_seq        integer;
  v_entry_num  text;
  v_cr_code    text;
  v_cr_name    text;
  v_dr_acc_id  uuid;
  v_cr_acc_id  uuid;
  v_amount     numeric(14,2);
BEGIN
  v_amount := COALESCE(NEW.total_amount, 0);
  IF v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- 1. تحديد كود الحساب الدائن بفحص مزدوج (payment_method أو payment_mode)
  IF COALESCE(NEW.payment_method, '') IN ('credit', 'deferred') 
     OR COALESCE(NEW.payment_mode, '') = 'credit' THEN
    v_cr_code := '2100';
    v_cr_name := 'ذمم دائنون (الموردون)';
  ELSE
    v_cr_code := '1001';
    v_cr_name := 'الصندوق النقدي';
  END IF;

  -- 2. جلب معرفات الحسابات ديناميكياً (المخزون 1100 مدين، الصندوق/الموردون دائن)
  SELECT id INTO v_dr_acc_id 
  FROM public.accounting_accounts 
  WHERE store_id = NEW.store_id AND code = '1100' AND is_active = true 
  LIMIT 1;

  SELECT id INTO v_cr_acc_id 
  FROM public.accounting_accounts 
  WHERE store_id = NEW.store_id AND code = v_cr_code AND is_active = true 
  LIMIT 1;

  IF v_dr_acc_id IS NULL OR v_cr_acc_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 3. توليد رقم القيد المتسلسل بنمط JE-YYYYMM-XXXX
  v_prefix := 'JE-' || to_char(CURRENT_DATE, 'YYYYMM') || '-';
  SELECT COALESCE(MAX(
    CASE 
      WHEN entry_number ~ ('^' || v_prefix || '[0-9]+$') 
      THEN SUBSTRING(entry_number FROM LENGTH(v_prefix) + 1)::integer 
      ELSE 0 
    END
  ), 0) + 1
  INTO v_seq
  FROM public.accounting_journal
  WHERE store_id = NEW.store_id AND entry_number LIKE v_prefix || '%';

  v_entry_num := v_prefix || LPAD(v_seq::text, 4, '0');

  -- 4. إدراج رأس القيد في accounting_journal
  INSERT INTO public.accounting_journal (
    store_id,
    entry_number,
    date,
    description,
    reference,
    type,
    status,
    created_at
  ) VALUES (
    NEW.store_id,
    v_entry_num,
    COALESCE(NEW.invoice_date, CURRENT_DATE),
    'فاتورة مشتريات — ' || COALESCE(NEW.supplier_company_name, ''),
    NEW.id::text,
    'purchase',
    'posted',
    now()
  ) RETURNING id INTO v_entry_id;

  -- 5. إدراج سطر المدين (المخزون 1100)
  INSERT INTO public.accounting_journal_lines (
    journal_id,
    account_id,
    description,
    debit,
    credit,
    created_at
  ) VALUES (
    v_entry_id,
    v_dr_acc_id,
    'طرف مدين: المخزون',
    v_amount,
    0,
    now()
  );

  -- 6. إدراج سطر الدائن (الصندوق أو الموردين)
  INSERT INTO public.accounting_journal_lines (
    journal_id,
    account_id,
    description,
    debit,
    credit,
    created_at
  ) VALUES (
    v_entry_id,
    v_cr_acc_id,
    'طرف دائن: ' || v_cr_name,
    0,
    v_amount,
    now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_je_purchase_insert ON public.store_purchases;
CREATE TRIGGER trg_je_purchase_insert
  AFTER INSERT ON public.store_purchases
  FOR EACH ROW EXECUTE FUNCTION public.fn_je_on_purchase_insert();


-- ─────────────────────────────────────────────────────────────────
-- 3. قيد حركات الصناديق في public.store_fund_movements
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_je_on_fund_movement_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_entry_id   uuid;
  v_prefix     text;
  v_seq        integer;
  v_entry_num  text;
  v_fund_code  text;
  v_fund_acc_id uuid;
  v_other_acc_id uuid;
  v_other_code text;
  v_amount     numeric(14,2);
BEGIN
  v_amount := COALESCE(NEW.amount, 0);
  IF v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- معرفة كود الصندوق (كاش أو بنك)
  SELECT code INTO v_fund_code
  FROM public.store_fund_accounts
  WHERE id = NEW.fund_account_id
  LIMIT 1;

  IF v_fund_code = 'bank' THEN
    v_fund_code := '1002';
  ELSE
    v_fund_code := '1001';
  END IF;

  SELECT id INTO v_fund_acc_id 
  FROM public.accounting_accounts 
  WHERE store_id = NEW.store_id AND code = v_fund_code AND is_active = true 
  LIMIT 1;

  IF NEW.direction = 'out' THEN
    v_other_code := '6001'; -- مصروفات
  ELSE
    v_other_code := '4001'; -- إيرادات / تسوية
  END IF;

  SELECT id INTO v_other_acc_id 
  FROM public.accounting_accounts 
  WHERE store_id = NEW.store_id AND code = v_other_code AND is_active = true 
  LIMIT 1;

  IF v_fund_acc_id IS NULL OR v_other_acc_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- توليد رقم القيد بنمط JE-YYYYMM-XXXX
  v_prefix := 'JE-' || to_char(CURRENT_DATE, 'YYYYMM') || '-';
  SELECT COALESCE(MAX(
    CASE 
      WHEN entry_number ~ ('^' || v_prefix || '[0-9]+$') 
      THEN SUBSTRING(entry_number FROM LENGTH(v_prefix) + 1)::integer 
      ELSE 0 
    END
  ), 0) + 1
  INTO v_seq
  FROM public.accounting_journal
  WHERE store_id = NEW.store_id AND entry_number LIKE v_prefix || '%';

  v_entry_num := v_prefix || LPAD(v_seq::text, 4, '0');

  -- إدراج رأس القيد في accounting_journal
  INSERT INTO public.accounting_journal (
    store_id,
    entry_number,
    date,
    description,
    reference,
    type,
    status,
    created_at
  ) VALUES (
    NEW.store_id,
    v_entry_num,
    CURRENT_DATE,
    COALESCE(NEW.description, NEW.kind),
    NEW.id::text,
    'manual',
    'posted',
    now()
  ) RETURNING id INTO v_entry_id;

  IF NEW.direction = 'out' THEN
    -- مدين المصروف / دائن الصندوق
    INSERT INTO public.accounting_journal_lines (journal_id, account_id, description, debit, credit, created_at)
    VALUES (v_entry_id, v_other_acc_id, 'طرف مدين: مصروفات تشغيلية', v_amount, 0, now());

    INSERT INTO public.accounting_journal_lines (journal_id, account_id, description, debit, credit, created_at)
    VALUES (v_entry_id, v_fund_acc_id, 'طرف دائن: الصندوق/البنك', 0, v_amount, now());
  ELSE
    -- مدين الصندوق / دائن الإيراد والتسوية
    INSERT INTO public.accounting_journal_lines (journal_id, account_id, description, debit, credit, created_at)
    VALUES (v_entry_id, v_fund_acc_id, 'طرف مدين: الصندوق/البنك', v_amount, 0, now());

    INSERT INTO public.accounting_journal_lines (journal_id, account_id, description, debit, credit, created_at)
    VALUES (v_entry_id, v_other_acc_id, 'طرف دائن: تسوية / إيراد وارد', 0, v_amount, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_je_fund_movement ON public.store_fund_movements;
CREATE TRIGGER trg_je_fund_movement
  AFTER INSERT ON public.store_fund_movements
  FOR EACH ROW EXECUTE FUNCTION public.fn_je_on_fund_movement_insert();


-- ─────────────────────────────────────────────────────────────────
-- 4. قيد سندات القبض والصرف في public.vouchers
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_je_on_voucher_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_entry_id       uuid;
  v_prefix         text;
  v_seq            integer;
  v_entry_num      text;
  v_party_name     text;
  v_party_role     text;
  v_party_code     text;
  v_party_acc_id   uuid;
  v_cash_acc_id    uuid;
  v_dr_acc_id      uuid;
  v_cr_acc_id      uuid;
  v_dr_label       text;
  v_cr_label       text;
  v_voucher_title  text;
  v_amount         numeric(14,2);
BEGIN
  -- 1. فحص المبلغ
  v_amount := COALESCE(NEW.amount, 0);
  IF v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- إذا لم يُحدد طرف للسند نتخطى بأمان
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 2. جلب دور واسم الطرف من store_contacts
  SELECT role, name INTO v_party_role, v_party_name
  FROM public.store_contacts
  WHERE id = NEW.account_id AND store_id = NEW.store_id
  LIMIT 1;

  -- 3. تحديد كود حساب الطرف حسب نوعه (عميل أو مورد)
  IF v_party_role = 'customer' THEN
    v_party_code := '1200'; -- ذمم العملاء
  ELSIF v_party_role = 'supplier' THEN
    v_party_code := '2100'; -- ذمم دائنون (الموردون)
  ELSE
    RETURN NEW;
  END IF;

  -- 4. جلب معرفات الحسابات ديناميكياً من شجرة حسابات نفس المتجر
  SELECT id INTO v_cash_acc_id
  FROM public.accounting_accounts
  WHERE store_id = NEW.store_id AND code = '1001' AND is_active = true
  LIMIT 1;

  SELECT id INTO v_party_acc_id
  FROM public.accounting_accounts
  WHERE store_id = NEW.store_id AND code = v_party_code AND is_active = true
  LIMIT 1;

  -- إذا كان أحد الحسابين غير موجود بدليل الحسابات، نتخطى بدون إيقاف حفظ السند
  IF v_cash_acc_id IS NULL OR v_party_acc_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 5. المنطق المحاسبي (سند قبض أم سند صرف)
  IF NEW.voucher_type = 'receipt' THEN
    -- سند قبض: الصندوق مدين (يزيد) / الطرف دائن (ينقص ذمة العميل أو يزيد ذمة المورد)
    v_dr_acc_id     := v_cash_acc_id;
    v_dr_label      := 'طرف مدين: الصندوق النقدي';
    v_cr_acc_id     := v_party_acc_id;
    v_cr_label      := 'طرف دائن: ' || COALESCE(v_party_name, 'الطرف');
    v_voucher_title := 'سند قبض';
  ELSIF NEW.voucher_type = 'payment' THEN
    -- سند صرف: الطرف مدين (ينقص ذمة المورد أو يزيد سلفة العميل) / الصندوق دائن (ينقص)
    v_dr_acc_id     := v_party_acc_id;
    v_dr_label      := 'طرف مدين: ' || COALESCE(v_party_name, 'الطرف');
    v_cr_acc_id     := v_cash_acc_id;
    v_cr_label      := 'طرف دائن: الصندوق النقدي';
    v_voucher_title := 'سند صرف';
  ELSE
    RETURN NEW;
  END IF;

  -- 6. توليد رقم القيد بنمط JE-YYYYMM-XXXX
  v_prefix := 'JE-' || to_char(CURRENT_DATE, 'YYYYMM') || '-';
  SELECT COALESCE(MAX(
    CASE 
      WHEN entry_number ~ ('^' || v_prefix || '[0-9]+$') 
      THEN SUBSTRING(entry_number FROM LENGTH(v_prefix) + 1)::integer 
      ELSE 0 
    END
  ), 0) + 1
  INTO v_seq
  FROM public.accounting_journal
  WHERE store_id = NEW.store_id AND entry_number LIKE v_prefix || '%';

  v_entry_num := v_prefix || LPAD(v_seq::text, 4, '0');

  -- 7. إدراج رأس القيد في accounting_journal
  INSERT INTO public.accounting_journal (
    store_id,
    entry_number,
    date,
    description,
    reference,
    type,
    status,
    created_at
  ) VALUES (
    NEW.store_id,
    v_entry_num,
    COALESCE(NEW.date, CURRENT_DATE),
    v_voucher_title || ' — ' || COALESCE(v_party_name, '') || CASE WHEN NEW.description IS NOT NULL AND TRIM(NEW.description) <> '' THEN ' (' || TRIM(NEW.description) || ')' ELSE '' END,
    NEW.id::text,
    'manual',
    'posted',
    now()
  ) RETURNING id INTO v_entry_id;

  -- 8. إدراج سطر المدين
  INSERT INTO public.accounting_journal_lines (
    journal_id,
    account_id,
    description,
    debit,
    credit,
    created_at
  ) VALUES (
    v_entry_id,
    v_dr_acc_id,
    v_dr_label,
    v_amount,
    0,
    now()
  );

  -- 9. إدراج سطر الدائن
  INSERT INTO public.accounting_journal_lines (
    journal_id,
    account_id,
    description,
    debit,
    credit,
    created_at
  ) VALUES (
    v_entry_id,
    v_cr_acc_id,
    v_cr_label,
    0,
    v_amount,
    now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_je_voucher_insert ON public.vouchers;
CREATE TRIGGER trg_je_voucher_insert
  AFTER INSERT ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.fn_je_on_voucher_insert();
