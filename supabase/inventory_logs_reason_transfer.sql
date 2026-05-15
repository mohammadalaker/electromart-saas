-- السماح بسبب «تحويل مخزني» في سجل المخزن
-- نفّذ بعد inventory_logs.sql و (إن وُجد) inventory_logs_reason_return.sql

ALTER TABLE public.inventory_logs DROP CONSTRAINT IF EXISTS inventory_logs_reason_check;

ALTER TABLE public.inventory_logs
  ADD CONSTRAINT inventory_logs_reason_check
  CHECK (
    reason IN (
      'sale',
      'purchase',
      'adjustment',
      'damaged',
      'other',
      'return',
      'transfer'
    )
  );

COMMENT ON COLUMN public.inventory_logs.reason IS 'يشمل return و transfer';
