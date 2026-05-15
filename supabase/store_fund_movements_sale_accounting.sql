-- توسيع حركات الصناديق لدعم إيراد بيع كاش + ربط اختياري بفاتورة sales
-- نفّذ بعد store_fund_accounts.sql

ALTER TABLE public.store_fund_movements
  DROP CONSTRAINT IF EXISTS store_fund_movements_kind_check;

ALTER TABLE public.store_fund_movements
  ADD CONSTRAINT store_fund_movements_kind_check
  CHECK (kind IN ('expense', 'transfer', 'adjustment', 'sale_cash_in'));

ALTER TABLE public.store_fund_movements
  ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES public.sales (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.store_fund_movements.sale_id IS 'ربط اختياري بفاتورة مبيعات عند تسجيل إيراد كاش';
COMMENT ON COLUMN public.store_fund_movements.kind IS 'sale_cash_in = إيراد بيع نقدي إلى كاش المحل';

CREATE INDEX IF NOT EXISTS idx_store_fund_movements_sale_id
  ON public.store_fund_movements (sale_id)
  WHERE sale_id IS NOT NULL;
