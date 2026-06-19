-- إضافة حالة «جاهز للاستلام» لطلبات الأونلاين
-- نفّذ في Supabase SQL Editor

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_order_status_check;

ALTER TABLE public.sales
  ADD CONSTRAINT sales_order_status_check
  CHECK (order_status IN ('confirmed', 'pending_online', 'cancelled', 'ready', 'delivered'));

COMMENT ON COLUMN public.sales.order_status IS 'pending_online | confirmed | ready | delivered | cancelled';
