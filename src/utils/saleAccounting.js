/**
 * ربط محاسبي تلقائي بعد حفظ فاتورة مبيعات:
 * - كاش: زيادة صندوق كاش المحل + حركة دخل في store_fund_movements
 * - ذمة: لا يُمس صندوق الكاش؛ مديونية الزبون تُحدَّث في store_contacts (من نفس مسار الدفع في POS/App)
 */
import { FUND_ACCOUNTS_TABLE, FUND_MOVEMENTS_TABLE, ensureDefaultFundAccounts } from './fundAccounts';
import { roundMoney } from './productModel';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ storeId: string, saleId: string | null, totalAmount: number, sourceLabel?: string }} p
 */
export async function applyCashSaleToMainCashFund(supabase, { storeId, saleId, totalAmount, sourceLabel = '' }) {
  const amt = roundMoney(Number(totalAmount));
  if (!storeId || amt <= 0) return { ok: true, skipped: true };

  await ensureDefaultFundAccounts(supabase, storeId);

  const { data: cashRow, error: findErr } = await supabase
    .from(FUND_ACCOUNTS_TABLE)
    .select('id, balance')
    .eq('store_id', storeId)
    .eq('code', 'cash_shop')
    .maybeSingle();

  if (findErr) throw findErr;
  if (!cashRow?.id) return { ok: false, reason: 'no_cash_account' };

  const prev = roundMoney(Number(cashRow.balance ?? 0));
  const next = roundMoney(prev + amt);

  const { error: uErr } = await supabase
    .from(FUND_ACCOUNTS_TABLE)
    .update({ balance: next })
    .eq('id', cashRow.id)
    .eq('store_id', storeId);

  if (uErr) throw uErr;

  const idPart = saleId ? `فاتورة ${String(saleId).slice(0, 8)}` : 'بيع كاش';
  const desc = `إيراد بيع كاش — ${idPart}${sourceLabel ? ` — ${sourceLabel}` : ''}`.slice(0, 500);

  const row = {
    store_id: storeId,
    fund_account_id: cashRow.id,
    amount: amt,
    direction: 'in',
    kind: 'income',
    description: desc,
  };
  const payload = saleId ? { ...row, sale_id: saleId } : { ...row };

  let { error: mErr } = await supabase.from(FUND_MOVEMENTS_TABLE).insert([payload]);
  if (mErr && saleId && /sale_id|column|schema|PGRST204/i.test(String(mErr.message || ''))) {
    ({ error: mErr } = await supabase.from(FUND_MOVEMENTS_TABLE).insert([row]));
  }

  if (mErr) {
    await supabase
      .from(FUND_ACCOUNTS_TABLE)
      .update({ balance: prev })
      .eq('id', cashRow.id)
      .eq('store_id', storeId);
    throw mErr;
  }

  return { ok: true };
}

/**
 * مرتجع بيع كاش: خصم من صندوق كاش المحل + حركة صادرة
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ storeId: string, saleId: string | null, totalAmount: number, sourceLabel?: string }} p
 */
export async function applyCashSaleReturnFromFund(supabase, { storeId, saleId, totalAmount, sourceLabel = '' }) {
  const amt = roundMoney(Number(totalAmount));
  if (!storeId || amt <= 0) return { ok: true, skipped: true };

  await ensureDefaultFundAccounts(supabase, storeId);

  const { data: cashRow, error: findErr } = await supabase
    .from(FUND_ACCOUNTS_TABLE)
    .select('id, balance')
    .eq('store_id', storeId)
    .eq('code', 'cash_shop')
    .maybeSingle();

  if (findErr) throw findErr;
  if (!cashRow?.id) return { ok: false, reason: 'no_cash_account' };

  const prev = roundMoney(Number(cashRow.balance ?? 0));
  if (prev < amt) {
    throw new Error('رصيد كاش المحل غير كافٍ لخصم مبلغ المرتجع. راجع الصندوق أو أضف تسوية.');
  }
  const next = roundMoney(prev - amt);

  const { error: uErr } = await supabase
    .from(FUND_ACCOUNTS_TABLE)
    .update({ balance: next })
    .eq('id', cashRow.id)
    .eq('store_id', storeId);

  if (uErr) throw uErr;

  const idPart = saleId ? `فاتورة ${String(saleId).slice(0, 8)}` : 'مرتجع';
  const desc = `مرتجع بيع كاش — ${idPart}${sourceLabel ? ` — ${sourceLabel}` : ''}`.slice(0, 500);

  const row = {
    store_id: storeId,
    fund_account_id: cashRow.id,
    amount: amt,
    direction: 'out',
    kind: 'expense',
    description: desc,
  };
  const payload = saleId ? { ...row, sale_id: saleId } : { ...row };

  let { error: mErr } = await supabase.from(FUND_MOVEMENTS_TABLE).insert([payload]);
  if (mErr && saleId && /sale_id|column|schema|PGRST204/i.test(String(mErr.message || ''))) {
    ({ error: mErr } = await supabase.from(FUND_MOVEMENTS_TABLE).insert([row]));
  }

  if (mErr) {
    await supabase
      .from(FUND_ACCOUNTS_TABLE)
      .update({ balance: prev })
      .eq('id', cashRow.id)
      .eq('store_id', storeId);
    throw mErr;
  }

  return { ok: true };
}

/**
 * مشتريات كاش: خصم من صندوق كاش المحل + حركة purchase_cash_out
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ storeId: string, purchaseId: string | null, totalAmount: number, sourceLabel?: string }} p
 */
export async function applyCashPurchaseFromFund(supabase, { storeId, purchaseId, totalAmount, sourceLabel = '' }) {
  const amt = roundMoney(Number(totalAmount));
  if (!storeId || amt <= 0) return { ok: true, skipped: true };

  await ensureDefaultFundAccounts(supabase, storeId);

  const { data: cashRow, error: findErr } = await supabase
    .from(FUND_ACCOUNTS_TABLE)
    .select('id, balance')
    .eq('store_id', storeId)
    .eq('code', 'cash_shop')
    .maybeSingle();

  if (findErr) throw findErr;
  if (!cashRow?.id) return { ok: false, reason: 'no_cash_account' };

  const prev = roundMoney(Number(cashRow.balance ?? 0));
  if (prev < amt) {
    throw new Error(
      'رصيد كاش المحل غير كافٍ لتسجيل دفع المشتريات نقداً. راجع الصندوق أو سجّل الفاتورة آجلاً.'
    );
  }
  const next = roundMoney(prev - amt);

  const { error: uErr } = await supabase
    .from(FUND_ACCOUNTS_TABLE)
    .update({ balance: next })
    .eq('id', cashRow.id)
    .eq('store_id', storeId);

  if (uErr) throw uErr;

  const idPart = purchaseId ? `مشتريات ${String(purchaseId).slice(0, 8)}` : 'مشتريات';
  const desc = `دفع مشتريات كاش — ${idPart}${sourceLabel ? ` — ${sourceLabel}` : ''}`.slice(0, 500);

  const row = {
    store_id: storeId,
    fund_account_id: cashRow.id,
    amount: amt,
    direction: 'out',
    kind: 'expense',
    description: desc,
  };
  const payload = purchaseId ? { ...row, purchase_id: purchaseId } : { ...row };

  let { error: mErr } = await supabase.from(FUND_MOVEMENTS_TABLE).insert([payload]);
  if (mErr && purchaseId && /purchase_id|column|schema|PGRST204/i.test(String(mErr.message || ''))) {
    ({ error: mErr } = await supabase.from(FUND_MOVEMENTS_TABLE).insert([row]));
  }

  if (mErr) {
    await supabase
      .from(FUND_ACCOUNTS_TABLE)
      .update({ balance: prev })
      .eq('id', cashRow.id)
      .eq('store_id', storeId);
    throw mErr;
  }

  return { ok: true };
}

/**
 * عكس دفع مشتريات كاش (عند فشل تحديث المخزن بعد الخصم)
 */
export async function revertCashPurchaseFromFund(supabase, { storeId, purchaseId, totalAmount, sourceLabel = '' }) {
  const amt = roundMoney(Number(totalAmount));
  if (!storeId || amt <= 0) return { ok: true };

  await ensureDefaultFundAccounts(supabase, storeId);
  const { data: cashRow, error: findErr } = await supabase
    .from(FUND_ACCOUNTS_TABLE)
    .select('id, balance')
    .eq('store_id', storeId)
    .eq('code', 'cash_shop')
    .maybeSingle();
  if (findErr) throw findErr;
  if (!cashRow?.id) return { ok: false };

  const prev = roundMoney(Number(cashRow.balance ?? 0));
  const next = roundMoney(prev + amt);
  const { error: uErr } = await supabase
    .from(FUND_ACCOUNTS_TABLE)
    .update({ balance: next })
    .eq('id', cashRow.id)
    .eq('store_id', storeId);
  if (uErr) throw uErr;

  const desc = `إلغاء خصم مشتريات (تراجع) — ${purchaseId ? String(purchaseId).slice(0, 8) : ''}${sourceLabel ? ` — ${sourceLabel}` : ''}`.slice(0, 500);
  await supabase.from(FUND_MOVEMENTS_TABLE).insert([
    {
      store_id: storeId,
      fund_account_id: cashRow.id,
      amount: amt,
      direction: 'in',
      kind: 'adjustment',
      description: desc,
    },
  ]);
  return { ok: true };
}

/**
 * مرتجع بيع ذمة: تخفيض مديونية الزبون + سطر دائن اختياري في customer_ledger
 */
export async function applyCreditSaleReturn(supabase, {
  storeId,
  saleId,
  contactId,
  totalAmount,
  sourceLabel = '',
}) {
  const amt = roundMoney(Number(totalAmount));
  if (!storeId || !contactId || amt <= 0) return { ok: true, skipped: true };

  const { data: cRow, error: cSelErr } = await supabase
    .from('store_contacts')
    .select('outstanding_amount')
    .eq('id', contactId)
    .eq('store_id', storeId)
    .eq('role', 'customer')
    .maybeSingle();

  if (cSelErr) throw cSelErr;
  if (!cRow) throw new Error('لم يُعثر على الزبون في الدليل — لا يمكن إرجاع ذمة هذه الفاتورة آلياً.');

  const prev = Math.max(0, Number(cRow.outstanding_amount ?? 0));
  const nextBal = Math.max(0, roundMoney(prev - amt));

  const { error: cUpErr } = await supabase
    .from('store_contacts')
    .update({ outstanding_amount: nextBal })
    .eq('id', contactId)
    .eq('store_id', storeId);

  if (cUpErr) throw cUpErr;

  const desc = `مرتجع بيع ذمة — فاتورة ${String(saleId).slice(0, 8)}…${sourceLabel ? ` — ${sourceLabel}` : ''}`;
  const { error: ledgerErr } = await supabase.from('customer_ledger').insert([
    {
      store_id: storeId,
      customer_id: contactId,
      sale_id: saleId,
      debit: 0,
      credit: amt,
      description: desc.slice(0, 500),
    },
  ]);
  if (ledgerErr) {
    const msg = String(ledgerErr.message || '');
    if (!/does not exist|schema cache|PGRST205|42P01/i.test(msg)) {
      console.warn('[sale return] customer_ledger:', ledgerErr.message);
    }
  }

  return { ok: true };
}
