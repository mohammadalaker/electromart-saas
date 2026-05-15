import { supabase } from '../lib/supabaseClient';
import { insertCashVoucherFlexible } from './checkVoucherSync';
import {
  applyCustomerOutstandingFromVoucher,
  applySupplierOutstandingFromVoucher,
} from './supplierVoucherBalance';

const CHECKS_TABLE = 'store_checks';

function roundMoney(n) {
  return Math.round(Math.max(0, Number(n) || 0) * 100) / 100;
}

/**
 * عند تسجيل شيك مرتجع: إنشاء سندات عكس تلقائياً وتحديث الذمم إن وُجدت سندات أصلية مربوطة.
 * - receipt_voucher_id على الشيك → عكس ذمة الزبون (سند صرف للزبون + دائن في customer_ledger)
 * - payment_voucher_id → عكس ذمة المورد (سند قبض من المورد + زيادة المستحق علينا)
 * يدعم التكرار الآمن عبر أعمدة bounce_*_reversal_voucher_id على store_checks.
 */
export async function applyBouncedCheckAccounting({ storeId, checkId }) {
  if (!storeId || !checkId) {
    return { ok: false, error: { message: 'بيانات ناقصة' } };
  }

  const { data: check, error: fetchErr } = await supabase
    .from(CHECKS_TABLE)
    .select('*')
    .eq('id', checkId)
    .eq('store_id', storeId)
    .maybeSingle();

  if (fetchErr) return { ok: false, error: fetchErr };
  if (!check) return { ok: false, error: { message: 'الشيك غير موجود' } };

  const amt = roundMoney(check.amount);
  if (amt <= 0) return { ok: false, error: { message: 'مبلغ الشيك غير صالح' } };

  const dateStr = String(check.due_date || new Date().toISOString()).slice(0, 10);
  const ref = `[check_bounce:${check.id}]`;
  const notes = [];

  let customerVoucherId = check.bounce_customer_reversal_voucher_id || null;
  let supplierVoucherId = check.bounce_supplier_reversal_voucher_id || null;

  if (check.receipt_voucher_id && check.customer_contact_id && !customerVoucherId) {
    const desc = `مرتجع شيك وارد — رقم ${check.check_number} — عكس قبض ${ref}`;
    const ins = await insertCashVoucherFlexible({
      storeId,
      partyId: check.customer_contact_id,
      voucherType: 'payment',
      amount: amt,
      description: desc,
      date: dateStr,
    });
    if (!ins.ok) return { ok: false, error: ins.error, customerVoucherId, supplierVoucherId };
    customerVoucherId = ins.voucherId;
    const bal = await applyCustomerOutstandingFromVoucher({
      storeId,
      customerContactId: check.customer_contact_id,
      voucherType: 'payment',
      amount: amt,
      voucherId: customerVoucherId,
    });
    if (!bal.ok && !bal.skipped) {
      return { ok: false, error: bal.error || { message: 'تعذّر تحديث ذمة الزبون' }, customerVoucherId, supplierVoucherId };
    }
    if (bal.ok) notes.push('عكس ذمة الزبون');
    await supabase
      .from(CHECKS_TABLE)
      .update({ bounce_customer_reversal_voucher_id: customerVoucherId, updated_at: new Date().toISOString() })
      .eq('id', checkId)
      .eq('store_id', storeId);
  }

  if (check.payment_voucher_id && check.payee_supplier_contact_id && !supplierVoucherId) {
    const desc = `مرتجع شيك — عكس صرف للمورد — رقم ${check.check_number} ${ref}`;
    const ins = await insertCashVoucherFlexible({
      storeId,
      partyId: check.payee_supplier_contact_id,
      voucherType: 'receipt',
      amount: amt,
      description: desc,
      date: dateStr,
    });
    if (!ins.ok) return { ok: false, error: ins.error, customerVoucherId, supplierVoucherId };
    supplierVoucherId = ins.voucherId;
    const bal = await applySupplierOutstandingFromVoucher({
      storeId,
      supplierContactId: check.payee_supplier_contact_id,
      voucherType: 'receipt',
      amount: amt,
    });
    if (!bal.ok && !bal.skipped) {
      return { ok: false, error: bal.error || { message: 'تعذّر تحديث ذمة المورد' }, customerVoucherId, supplierVoucherId };
    }
    if (bal.ok) notes.push('عكس ذمة المورد');
    await supabase
      .from(CHECKS_TABLE)
      .update({ bounce_supplier_reversal_voucher_id: supplierVoucherId, updated_at: new Date().toISOString() })
      .eq('id', checkId)
      .eq('store_id', storeId);
  }

  return {
    ok: true,
    customerVoucherId,
    supplierVoucherId,
    notes,
    hadAccounting: Boolean(
      (check.receipt_voucher_id && check.customer_contact_id) ||
        (check.payment_voucher_id && check.payee_supplier_contact_id)
    ),
  };
}
