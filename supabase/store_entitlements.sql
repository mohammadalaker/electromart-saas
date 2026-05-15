-- تفعيل انتقائي للوحدات لكل متجر (SaaS): كل الوحدات مبنية في النظام، والزبون يعطّل ما لم يشتره.
-- القيمة [] أو NULL = لا شيء معطّل = كل الميزات ظاهرة.
-- مثال لتعطيل الشيكات وطلبات عرض السعر: ["checks", "purchase_rfq"]

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS disabled_modules jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.stores.disabled_modules IS
  'JSON array of module keys disabled for this subscription, e.g. ["checks","purchase_rfq"]. Empty = all modules on.';

ALTER TABLE public.stores
  DROP CONSTRAINT IF EXISTS stores_disabled_modules_is_array;

ALTER TABLE public.stores
  ADD CONSTRAINT stores_disabled_modules_is_array
  CHECK (jsonb_typeof(disabled_modules) = 'array');
