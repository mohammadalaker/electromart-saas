-- One-time backfill: INSERT credit lines into customer_ledger from receipt vouchers.
-- Backup DB first. Run whole script in Supabase SQL Editor.

INSERT INTO public.customer_ledger (store_id, customer_id, sale_id, debit, credit, description)
SELECT
  v.store_id,
  c.id,
  NULL,
  0,
  LEAST(v.amount::numeric, 9999999999.99),
  'سند قبض — تسديد ذمة (ترحيل) [voucher:' || v.id::text || ']'
FROM public.vouchers v
INNER JOIN public.store_contacts c
  ON c.id = COALESCE(v.account_id, v.supplier_contact_id, v.supplier_id)
  AND c.store_id = v.store_id
  AND c.role = 'customer'
WHERE v.voucher_type = 'receipt'
  AND COALESCE(v.amount::numeric, 0) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.customer_ledger cl
    WHERE cl.store_id = v.store_id
      AND cl.customer_id = c.id
      AND cl.description LIKE '%[voucher:' || v.id::text || ']%'
  );
