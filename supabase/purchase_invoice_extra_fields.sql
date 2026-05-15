-- حقول إضافية لمقترح المحاسبة والمرتجعات الكاملة
-- نفّذ في Supabase SQL Editor بعد وجود الجداول.

-- ─── التطبيق الحالي: store_purchases ───────────────────────────────────────
ALTER TABLE public.store_purchases
  ADD COLUMN IF NOT EXISTS discount_percentage numeric(5, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.store_purchases
  ADD COLUMN IF NOT EXISTS tax_amount numeric(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.store_purchases
  ADD COLUMN IF NOT EXISTS extra_charges numeric(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.store_purchases
  ADD COLUMN IF NOT EXISTS is_returned boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.store_purchases.discount_percentage IS 'خصم ممنوح من المورد على إجمالي الفاتورة (%)';
COMMENT ON COLUMN public.store_purchases.tax_amount IS 'ضريبة القيمة المضافة إذا لم تكن شاملة في المجموع (₪)';
COMMENT ON COLUMN public.store_purchases.extra_charges IS 'تكاليف شحن أو عمالة إضافية (₪) — يُنسَّق مع landed_cost_extra في المنطق إن رغبت';
COMMENT ON COLUMN public.store_purchases.is_returned IS 'هل تم إرجاع هذه الفاتورة بالكامل؟';

-- ─── المخطط الطبيعي: public.purchases (يُنفَّذ فقط إن وُجد الجدول) ─────────────
DO $$
BEGIN
  IF to_regclass('public.purchases') IS NOT NULL THEN
    ALTER TABLE public.purchases
      ADD COLUMN IF NOT EXISTS discount_percentage numeric(5, 2) NOT NULL DEFAULT 0;
    ALTER TABLE public.purchases
      ADD COLUMN IF NOT EXISTS tax_amount numeric(14, 2) NOT NULL DEFAULT 0;
    ALTER TABLE public.purchases
      ADD COLUMN IF NOT EXISTS extra_charges numeric(14, 2) NOT NULL DEFAULT 0;
    ALTER TABLE public.purchases
      ADD COLUMN IF NOT EXISTS is_returned boolean NOT NULL DEFAULT false;
  END IF;
END $$;
