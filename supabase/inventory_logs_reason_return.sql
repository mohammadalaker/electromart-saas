-- السماح بسبب «مرتجع» في سجل المخزن
-- نفّذ بعد inventory_logs.sql

ALTER TABLE public.inventory_logs DROP CONSTRAINT IF EXISTS inventory_logs_reason_check;

ALTER TABLE public.inventory_logs
  ADD CONSTRAINT inventory_logs_reason_check
  CHECK (reason IN ('sale', 'purchase', 'adjustment', 'damaged', 'other', 'return'));

COMMENT ON COLUMN public.inventory_logs.reason IS 'يشمل return لإرجاع بضاعة من فاتورة';
