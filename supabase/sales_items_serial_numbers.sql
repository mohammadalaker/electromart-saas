-- أرقام تسلسلية لكل سطر بيع (نفّذ في Supabase SQL Editor بعد sales_items.sql)
ALTER TABLE public.sales_items
  ADD COLUMN IF NOT EXISTS serial_numbers text;

COMMENT ON COLUMN public.sales_items.serial_numbers IS 'سيريال/سيريالات الجهاز — سطر أو أكثر أو مفصولة بفاصلة';
