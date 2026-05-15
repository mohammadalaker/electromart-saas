-- اختياري: عمود JSON لأسطر الفاتورة في جدول sales
-- product_id = uuid من جدول products فقط (أو null) — الباركود حقل منفصل barcode (text)
-- لا تستخدم نوع uuid لعمود يخزّن الباركود

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS line_items jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.sales.line_items IS
  'مصفوفة أسطر: [{ "product_id": "<uuid>|null", "barcode": "<string>", "qty", "unit_price", "line_total" }] — الباركود ليس UUID';
