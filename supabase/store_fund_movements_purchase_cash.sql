-- حركة صندوق: دفع مشتريات نقدية من كاش المحل
-- نفّذ بعد store_fund_movements_sale_return.sql (أو أي ملف يوسّع kind)

ALTER TABLE public.store_fund_movements
  DROP CONSTRAINT IF EXISTS store_fund_movements_kind_check;

ALTER TABLE public.store_fund_movements
  ADD CONSTRAINT store_fund_movements_kind_check
  CHECK (
    kind IN (
      'expense',
      'transfer',
      'adjustment',
      'sale_cash_in',
      'sale_cash_return',
      'purchase_cash_out'
    )
  );

ALTER TABLE public.store_fund_movements
  ADD COLUMN IF NOT EXISTS purchase_id uuid REFERENCES public.store_purchases (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_store_fund_movements_purchase_id
  ON public.store_fund_movements (purchase_id)
  WHERE purchase_id IS NOT NULL;

COMMENT ON COLUMN public.store_fund_movements.kind IS 'purchase_cash_out = دفع مشتريات نقدية من كاش المحل';
COMMENT ON COLUMN public.store_fund_movements.purchase_id IS 'ربط اختياري بفاتورة store_purchases';
