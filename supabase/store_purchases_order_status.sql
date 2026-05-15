-- حالة طلبية المشتريات: مسودة (لم يُستلم للمخزن) → استلام → مدفوع (سداد للمورد)
-- نفّذ بعد store_purchases.sql وملفات أعمدة الفاتورة.

ALTER TABLE public.store_purchases
  ADD COLUMN IF NOT EXISTS purchase_status text NOT NULL DEFAULT 'received';

ALTER TABLE public.store_purchases
  DROP CONSTRAINT IF EXISTS store_purchases_purchase_status_check;

ALTER TABLE public.store_purchases
  ADD CONSTRAINT store_purchases_purchase_status_check
  CHECK (purchase_status IN ('draft', 'received', 'paid'));

UPDATE public.store_purchases
SET purchase_status = 'received'
WHERE purchase_status IS NULL OR purchase_status NOT IN ('draft', 'received', 'paid');

COMMENT ON COLUMN public.store_purchases.purchase_status IS
  'draft=مسودة بدون تأثير على المخزن؛ received=تم الاستلام؛ paid=سُدِّي للمورد (غالباً بعد received)';

CREATE INDEX IF NOT EXISTS idx_store_purchases_status
  ON public.store_purchases (store_id, purchase_status, created_at DESC);
