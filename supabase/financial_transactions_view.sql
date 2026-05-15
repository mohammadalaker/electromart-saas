-- عرض موحّد لكل حركة نقدية (مرجع تقارير / تصدير)
-- يعتمد على store_fund_movements — لا يكرر البيانات
-- نفّذ بعد store_fund_accounts.sql و store_fund_movements_sale_accounting.sql

CREATE OR REPLACE VIEW public.financial_transactions
WITH (security_invoker = true) AS
SELECT
  m.id,
  m.store_id,
  m.created_at,
  m.amount,
  m.direction,
  CASE WHEN m.direction = 'in' THEN m.amount ELSE -m.amount END AS signed_amount,
  m.kind,
  m.expense_category,
  m.description,
  m.fund_account_id,
  fa.code AS fund_code,
  fa.name_ar AS fund_name_ar,
  m.sale_id,
  m.purchase_id,
  m.counterparty_fund_id,
  m.transfer_batch_id
FROM public.store_fund_movements m
INNER JOIN public.store_fund_accounts fa
  ON fa.id = m.fund_account_id AND fa.store_id = m.store_id;

COMMENT ON VIEW public.financial_transactions IS 'كل شيكل يمر عبر الصناديق — عرض على حركات الصناديق';

GRANT SELECT ON public.financial_transactions TO authenticated;
GRANT SELECT ON public.financial_transactions TO service_role;
