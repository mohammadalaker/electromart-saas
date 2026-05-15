-- محفّز محاسبي: عند إدراج فاتورة مشتريات «آجل» يُحدَّث رصيد ذمة المورد تلقائياً في store_contacts
-- نفّذ بعد store_purchases.sql و store_contacts_payment_columns.sql
--
-- المبدأ: مصدر الحقيقة لزيادة الدين هو قاعدة البيانات، حتى لو أخطأ العميل (المتصفح).
-- عند تفعيل هذا المحفّز: في الواجهة ضع VITE_SKIP_CLIENT_CREDIT_DEBT=true حتى لا تُزاد الذمة مرتين
-- (المحفّز عند INSERT + executePurchaseReceiveEffects في المتصفح).

CREATE OR REPLACE FUNCTION public.trg_store_purchases_credit_update_contact_debt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.payment_mode = 'credit'
     AND NEW.supplier_contact_id IS NOT NULL
     AND COALESCE(NEW.total_amount, 0) > 0 THEN
    UPDATE public.store_contacts
    SET
      outstanding_amount = COALESCE(outstanding_amount, 0) + NEW.total_amount,
      payment_type = 'credit'
    WHERE id = NEW.supplier_contact_id
      AND store_id = NEW.store_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS store_purchases_credit_update_contact_debt ON public.store_purchases;

CREATE TRIGGER store_purchases_credit_update_contact_debt
  AFTER INSERT ON public.store_purchases
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_store_purchases_credit_update_contact_debt();

COMMENT ON FUNCTION public.trg_store_purchases_credit_update_contact_debt() IS 'يزيد outstanding_amount للمورد عند فاتورة مشتريات آجل';
