/** جداول الصناديق — نفس أسماء الجداول في Supabase (store_fund_accounts.sql) */
export const FUND_ACCOUNTS_TABLE = 'store_fund_accounts';
export const FUND_MOVEMENTS_TABLE = 'store_fund_movements';

const defaultFundsEnsuredStores = new Set();

/** إنشاء صناديق افتراضية (كاش، بنك، عهدة) إن لم تكن موجودة */
export async function ensureDefaultFundAccounts(supabase, storeId) {
  if (!storeId || defaultFundsEnsuredStores.has(storeId)) return;
  const { data, error } = await supabase
    .from(FUND_ACCOUNTS_TABLE)
    .select('id')
    .eq('store_id', storeId)
    .limit(1);
  if (error) throw error;
  if (data?.length) {
    defaultFundsEnsuredStores.add(storeId);
    return;
  }
  const { error: insErr } = await supabase.from(FUND_ACCOUNTS_TABLE).insert([
    { store_id: storeId, code: 'cash_shop', name_ar: 'كاش المحل', sort_order: 0 },
    { store_id: storeId, code: 'bank', name_ar: 'حساب البنك', sort_order: 1 },
    { store_id: storeId, code: 'employee_petty', name_ar: 'عهدة الموظف', sort_order: 2 },
  ]);
  if (insErr) throw insErr;
  defaultFundsEnsuredStores.add(storeId);
}
