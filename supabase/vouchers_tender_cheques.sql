-- توسيع جدول vouchers: طريقة الدفع (كاش / شيكات / مختلط) وتفاصيل الشيكات
-- نفّذ في Supabase SQL Editor بعد وجود جدول public.vouchers
-- check_lines: مصفوفة JSON [{ "check_number", "check_date", "amount", "bank_name" }]
-- اتجاه الشيك: سند قبض = وارد، سند صرف = صادر (يُستنتج من voucher_type وليس عموداً منفصلاً)

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS voucher_tender text NOT NULL DEFAULT 'cash'
    CHECK (voucher_tender IN ('cash', 'checks', 'mixed', 'visa'));

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS cash_amount numeric(14, 2) NOT NULL DEFAULT 0
    CHECK (cash_amount >= 0);

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS check_lines jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.vouchers.voucher_tender IS 'cash | checks | mixed — كاش فقط، شيكات فقط، أو كاش+شيكات';
COMMENT ON COLUMN public.vouchers.cash_amount IS 'جزء الكاش عند tender=mixed؛ عند cash يساوي amount عادة';
COMMENT ON COLUMN public.vouchers.check_lines IS 'تفاصيل الشيكات: رقم، تاريخ، مبلغ، بنك';

-- NOTIFY pgrst, 'reload schema';
