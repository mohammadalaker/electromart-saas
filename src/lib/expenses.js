import { supabase } from './supabaseClient';

const TABLE = 'expenses';

function toDateStr(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function isMissingTable(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || '');
  return err.code === 'PGRST205' || err.code === '42P01' || /does not exist|schema cache/i.test(msg);
}

/**
 * جلب المصاريف حسب المتجر والفترة الزمنية.
 */
export async function getExpenses(storeId, { from, to } = {}) {
  if (!storeId) return [];
  let q = supabase
    .from(TABLE)
    .select('id, store_id, category, description, amount, expense_date, created_at')
    .eq('store_id', storeId)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false });

  const fromStr = toDateStr(from);
  const toStr = toDateStr(to);
  if (fromStr) q = q.gte('expense_date', fromStr);
  if (toStr) q = q.lte('expense_date', toStr);

  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return data || [];
}

/**
 * إضافة مصروف جديد.
 */
export async function addExpense(data) {
  const { data: row, error } = await supabase.from(TABLE).insert([data]).select().single();
  if (error) throw error;
  return row;
}

/**
 * حذف مصروف.
 */
export async function deleteExpense(id) {
  if (!id) return;
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}

/**
 * ملخص المصاريف مجمّعاً حسب الفئة.
 */
export async function getExpensesSummary(storeId, { from, to } = {}) {
  const items = await getExpenses(storeId, { from, to });
  const byCategory = {};
  let total = 0;
  for (const row of items) {
    const amt = Number(row.amount) || 0;
    const cat = row.category || 'other';
    byCategory[cat] = (byCategory[cat] || 0) + amt;
    total += amt;
  }
  return { byCategory, total, items };
}
