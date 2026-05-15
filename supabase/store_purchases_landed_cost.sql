-- مصاريف إضافية (نقل، تنزيل…) تُوزَّع على أسطر الفاتورة في التطبيق
ALTER TABLE public.store_purchases
  ADD COLUMN IF NOT EXISTS landed_cost_extra numeric(14, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.store_purchases.landed_cost_extra IS 'مصاريف واصلة إضافية (₪) — توزيع نسبي على الأصناف في الواجهة';
