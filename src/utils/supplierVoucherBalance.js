import { supabase } from '../lib/supabaseClient';

const CUSTOMER_LEDGER_TABLE = 'customer_ledger';

/**
 * يحدّث رصيد ذمة الزبون في دليل المتجر (store_contacts) بعد حفظ سند.
 * - receipt (سند قبض): الزبون يدفع → يُنقص المستحق عليه
 * - payment (سند صرف): نرد للزبون → يُزاد المستحق (نادر)
 *
 * عند توفر voucherId يُسجَّل سطر مطابق في customer_ledger حتى يطابق كشف الحساب رصيد الدليل.
 */
export async function applyCustomerOutstandingFromVoucher({
  storeId,
  customerContactId,
  voucherType,
  amount,
  voucherId,
}) {
  const rounded = Math.round(Math.max(0, Number(amount) || 0) * 100) / 100;
  if (!storeId || !customerContactId || rounded <= 0) {
    return { ok: false, skipped: true, reason: 'invalid-args' };
  }

  const { data: row, error: selErr } = await supabase
    .from('store_contacts')
    .select('id, outstanding_amount')
    .eq('id', customerContactId)
    .eq('store_id', storeId)
    .eq('role', 'customer')
    .maybeSingle();

  if (selErr) return { ok: false, error: selErr, skipped: false };
  if (!row) return { ok: false, skipped: true, reason: 'not-a-customer' };

  const prev = Math.max(0, Number(row.outstanding_amount ?? 0));
  // receipt = الزبون يدفع = ينقص ما عليه؛ payment = نرد له = يزيد
  const delta = voucherType === 'receipt' ? -rounded : rounded;
  const next = Math.max(0, Math.round((prev + delta) * 100) / 100);

  const { error: upErr } = await supabase
    .from('store_contacts')
    .update({ outstanding_amount: next })
    .eq('id', customerContactId)
    .eq('store_id', storeId);

  if (upErr) return { ok: false, error: upErr, skipped: false };

  const vid = voucherId != null ? String(voucherId).trim() : '';
  if (vid && (voucherType === 'receipt' || voucherType === 'payment')) {
    const desc =
      voucherType === 'receipt'
        ? `سند قبض — تسديد ذمة [voucher:${vid}]`
        : `سند صرف للزبون [voucher:${vid}]`;
    const ledgerRow =
      voucherType === 'receipt'
        ? {
            store_id: storeId,
            customer_id: customerContactId,
            sale_id: null,
            debit: 0,
            credit: rounded,
            description: desc,
          }
        : {
            store_id: storeId,
            customer_id: customerContactId,
            sale_id: null,
            debit: rounded,
            credit: 0,
            description: desc,
          };
    const { error: ledgerErr } = await supabase.from(CUSTOMER_LEDGER_TABLE).insert([ledgerRow]);
    if (ledgerErr) {
      console.warn('[customer-voucher] customer_ledger:', ledgerErr.message);
    }
  }

  return { ok: true, prev, next };
}

const CONTACTS_TABLE = 'store_contacts';

/**
 * يحدّث رصيد ذمة المورد في دليل المتجر (store_contacts) بعد حفظ سند في vouchers.
 * - payment (سند صرف): ندفع للمورد → يُنقص المستحق علينا
 * - receipt (سند قبض): يُزاد المستحق (تسوية آجل / مستحق لصالح المورد على المتجر)
 *
 * يعمل فقط عندما يكون supplierContactId هو صفاً في store_contacts بدور مورد.
 */
export async function applySupplierOutstandingFromVoucher({
  storeId,
  supplierContactId,
  voucherType,
  amount,
}) {
  const rounded = Math.round(Math.max(0, Number(amount) || 0) * 100) / 100;
  if (!storeId || !supplierContactId || rounded <= 0) {
    return { ok: false, skipped: true, reason: 'invalid-args' };
  }

  const { data: row, error: selErr } = await supabase
    .from(CONTACTS_TABLE)
    .select('id, outstanding_amount')
    .eq('id', supplierContactId)
    .eq('store_id', storeId)
    .eq('role', 'supplier')
    .maybeSingle();

  if (selErr) return { ok: false, error: selErr, skipped: false };
  if (!row) return { ok: false, skipped: true, reason: 'not-a-contact' };

  const prev = Math.max(0, Number(row.outstanding_amount ?? 0));
  const delta = voucherType === 'payment' ? -rounded : rounded;
  const next = Math.max(0, Math.round((prev + delta) * 100) / 100);

  const { error: upErr } = await supabase
    .from(CONTACTS_TABLE)
    .update({ outstanding_amount: next, payment_type: 'credit' })
    .eq('id', supplierContactId)
    .eq('store_id', storeId);

  if (upErr) return { ok: false, error: upErr, skipped: false };
  return { ok: true };
}
