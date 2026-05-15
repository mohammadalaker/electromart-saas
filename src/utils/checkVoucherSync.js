import { supabase } from '../lib/supabaseClient';
import { normalizeDigitsToLatin } from './normalizeDigits';
import {
  applyCustomerOutstandingFromVoucher,
  applySupplierOutstandingFromVoucher,
} from './supplierVoucherBalance';

const VOUCHERS_TABLE = import.meta.env.VITE_SUPABASE_VOUCHERS_TABLE?.trim() || 'vouchers';
const STORE_SUPPLIER_PAYMENTS_TABLE =
  import.meta.env.VITE_SUPABASE_STORE_SUPPLIER_PAYMENTS_TABLE?.trim() || 'store_supplier_payments';
const CONTACTS_FALLBACK = 'store_contacts';
const ILS_SYM = '\u20AA';

function parseMoneyInput(v) {
  const n = parseFloat(normalizeDigitsToLatin(String(v ?? '')).replace(',', '.'));
  return Number.isNaN(n) ? 0 : Math.round(Math.max(0, n) * 100) / 100;
}

function formatChecksForDescription(lines, sym = ILS_SYM) {
  if (!lines?.length) return '';
  const parts = lines.map(
    (c, i) =>
      `شيك ${i + 1}: رقم ${c.check_number} — ${c.check_date} — ${sym}${Number(c.amount).toFixed(2)} — ${c.bank_name}`
  );
  return `\n[تفاصيل الشيكات]\n${parts.join('\n')}`;
}

/**
 * إدراج سند مع محاولات أعمدة الحساب المختلفة (مثل VoucherPage).
 */
export async function insertVoucherFlexible({
  storeId,
  partyId,
  voucherType,
  amount,
  description,
  date,
  checkLine,
  currencyCode = 'ILS',
}) {
  const descriptionTrimmed = description?.trim() || '';
  const dateStr = String(date || '').slice(0, 10);
  const rounded = parseMoneyInput(amount);
  if (!storeId || !partyId || rounded <= 0) {
    return { ok: false, error: { message: 'بيانات السند ناقصة' } };
  }

  const checkLinesDb = [
    {
      check_number: String(checkLine.check_number ?? '').trim(),
      check_date: String(checkLine.check_date ?? checkLine.due_date ?? '').slice(0, 10),
      amount: rounded,
      bank_name: String(checkLine.bank_name ?? '').trim(),
    },
  ];

  const base = {
    store_id: storeId,
    voucher_type: voucherType,
    amount: rounded,
    description: descriptionTrimmed || null,
    date: dateStr,
  };

  const accountVariants = [
    { account_id: partyId, supplier_contact_id: partyId },
    { account_id: partyId },
    { supplier_contact_id: partyId },
    { supplier_id: partyId },
  ];

  const tenderPayload = {
    voucher_tender: 'checks',
    cash_amount: 0,
    check_lines: checkLinesDb,
    currency_code: currencyCode,
    visa_last4: null,
  };

  const tryInsertRow = async (row) => {
    const { data, error } = await supabase.from(VOUCHERS_TABLE).insert([row]).select('id').maybeSingle();
    return { data, error };
  };

  let lastErr = null;
  for (let i = 0; i < accountVariants.length; i++) {
    const row = { ...base, ...tenderPayload, ...accountVariants[i] };
    const { data, error } = await tryInsertRow(row);
    if (!error && data?.id) {
      return { ok: true, voucherId: data.id, tenderSaved: true };
    }
    lastErr = error;
  }

  const fallbackDesc =
    descriptionTrimmed +
    formatChecksForDescription(checkLinesDb, ILS_SYM) +
    '\n[طريقة الدفع: شيكات]' +
    '\n[العملة: شيكل]';

  const baseLegacy = { ...base, description: fallbackDesc.trim() || null };
  for (let i = 0; i < accountVariants.length; i++) {
    const row = { ...baseLegacy, ...accountVariants[i] };
    const { data, error } = await tryInsertRow(row);
    if (!error && data?.id) {
      return { ok: true, voucherId: data.id, tenderSaved: false };
    }
    lastErr = error;
  }

  return { ok: false, error: lastErr };
}

/** سند كاش (بدون شيكات) — للعكس المحاسبي وغيره */
export async function insertCashVoucherFlexible({
  storeId,
  partyId,
  voucherType,
  amount,
  description,
  date,
  currencyCode = 'ILS',
}) {
  const descriptionTrimmed = description?.trim() || '';
  const dateStr = String(date || '').slice(0, 10);
  const rounded = parseMoneyInput(amount);
  if (!storeId || !partyId || rounded <= 0) {
    return { ok: false, error: { message: 'بيانات السند ناقصة' } };
  }

  const base = {
    store_id: storeId,
    voucher_type: voucherType,
    amount: rounded,
    description: descriptionTrimmed || null,
    date: dateStr,
  };

  const accountVariants = [
    { account_id: partyId, supplier_contact_id: partyId },
    { account_id: partyId },
    { supplier_contact_id: partyId },
    { supplier_id: partyId },
  ];

  const tenderPayload = {
    voucher_tender: 'cash',
    cash_amount: rounded,
    check_lines: [],
    currency_code: currencyCode,
    visa_last4: null,
  };

  const tryInsertRow = async (row) => {
    const { data, error } = await supabase.from(VOUCHERS_TABLE).insert([row]).select('id').maybeSingle();
    return { data, error };
  };

  let lastErr = null;
  for (let i = 0; i < accountVariants.length; i++) {
    const row = { ...base, ...tenderPayload, ...accountVariants[i] };
    const { data, error } = await tryInsertRow(row);
    if (!error && data?.id) {
      return { ok: true, voucherId: data.id, tenderSaved: true };
    }
    lastErr = error;
  }

  const fallbackDesc =
    descriptionTrimmed +
    `\n[طريقة الدفع: كاش]\n[العملة: شيكل]`;
  const baseLegacy = { ...base, description: fallbackDesc.trim() || null };
  for (let i = 0; i < accountVariants.length; i++) {
    const row = { ...baseLegacy, ...accountVariants[i] };
    const { data, error } = await tryInsertRow(row);
    if (!error && data?.id) {
      return { ok: true, voucherId: data.id, tenderSaved: false };
    }
    lastErr = error;
  }

  return { ok: false, error: lastErr };
}

async function insertStoreSupplierPaymentRow({ storeId, supplierId, amount, paidAt, notes }) {
  const raw = String(paidAt || '').slice(0, 10);
  const paid = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
  const notesStr = typeof notes === 'string' ? notes.trim() : '';
  const base = {
    store_id: storeId,
    amount,
    paid_at: paid,
    notes: notesStr || '',
  };
  const variants = [
    { ...base, supplier_contact_id: supplierId },
    { ...base, supplier_contact_id: supplierId, account_id: supplierId },
    { ...base, account_id: supplierId },
    { ...base, supplier_id: supplierId },
  ];
  let lastErr = null;
  for (const row of variants) {
    const { error } = await supabase.from(STORE_SUPPLIER_PAYMENTS_TABLE).insert([row]);
    if (!error) return { ok: true };
    lastErr = error;
  }
  return { ok: false, error: lastErr };
}

/** سند قبض شيك من زبون + تحديث ذمة + customer_ledger */
export async function syncIncomingCheckLedger({
  storeId,
  customerContactId,
  amount,
  date,
  description,
  checkMeta,
}) {
  const res = await insertVoucherFlexible({
    storeId,
    partyId: customerContactId,
    voucherType: 'receipt',
    amount,
    description,
    date,
    checkLine: checkMeta,
  });
  if (!res.ok) return res;

  const bal = await applyCustomerOutstandingFromVoucher({
    storeId,
    customerContactId,
    voucherType: 'receipt',
    amount,
    voucherId: res.voucherId,
  });
  return { ...res, balance: bal };
}

/** سند صرف شيك لمورد + دفعة المورد + تحديث ذمة */
export async function syncOutgoingCheckLedger({
  storeId,
  supplierContactId,
  amount,
  date,
  description,
  checkMeta,
}) {
  const res = await insertVoucherFlexible({
    storeId,
    partyId: supplierContactId,
    voucherType: 'payment',
    amount,
    description,
    date,
    checkLine: checkMeta,
  });
  if (!res.ok) return res;

  let paymentSyncWarning = '';
  const payRes = await insertStoreSupplierPaymentRow({
    storeId,
    supplierId: supplierContactId,
    amount,
    paidAt: date,
    notes: description,
  });
  if (!payRes.ok) {
    paymentSyncWarning = payRes.error?.message || 'تعذّر تسجيل دفعة المورد';
  }

  const bal = await applySupplierOutstandingFromVoucher({
    storeId,
    supplierContactId,
    voucherType: 'payment',
    amount,
  });

  return { ...res, balance: bal, paymentSyncWarning };
}

export { CONTACTS_FALLBACK };
