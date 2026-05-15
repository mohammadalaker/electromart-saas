-- تاريخ استحقاق سداد فاتورة المورد (آجل) + تتبع التسديد
-- نفّذ بعد store_purchases_invoice_columns.sql

ALTER TABLE public.store_purchases
  ADD COLUMN IF NOT EXISTS payment_due_date date;

ALTER TABLE public.store_purchases
  ADD COLUMN IF NOT EXISTS credit_settled_at timestamptz;

COMMENT ON COLUMN public.store_purchases.payment_due_date IS 'تاريخ استحقاق دفع المورد (فواتير آجل)';
COMMENT ON COLUMN public.store_purchases.credit_settled_at IS 'وقت تسديد هذه الفاتورة في النظام — NULL = لم يُسدد بعد';

CREATE INDEX IF NOT EXISTS idx_store_purchases_credit_due
  ON public.store_purchases (store_id, payment_due_date)
  WHERE payment_mode = 'credit' AND credit_settled_at IS NULL;
