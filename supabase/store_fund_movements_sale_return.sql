-- نوع حركة: إرجاع بيع كاش — خصم من صندوق كاش المحل
-- نفّذ بعد store_fund_movements_sale_accounting.sql

ALTER TABLE public.store_fund_movements
  DROP CONSTRAINT IF EXISTS store_fund_movements_kind_check;

ALTER TABLE public.store_fund_movements
  ADD CONSTRAINT store_fund_movements_kind_check
  CHECK (kind IN ('expense', 'transfer', 'adjustment', 'sale_cash_in', 'sale_cash_return'));

COMMENT ON COLUMN public.store_fund_movements.kind IS 'sale_cash_return = إرجاع نقدي — صادر من كاش المحل';
