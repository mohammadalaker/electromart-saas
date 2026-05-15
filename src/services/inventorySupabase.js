import { supabase, isSupabaseConfigured } from '../lib/supabase';

const TABLE = import.meta.env.VITE_SUPABASE_TABLE || 'inventory';

/**
 * Normalize a row from Supabase to app shape: { id, engName, qty, price, value }
 * Supports: id, engName | eng_name | name | description, qty | quantity, price | unit_price, value
 */
function normalizeRow(row, index) {
  const id = row.id ?? row.ID ?? `row-${index}`;
  const engName =
    row.engName ??
    row.eng_name ??
    row.name ??
    row.description ??
    row['Eng-Name'] ??
    '';
  const qty = Number(row.qty ?? row.quantity ?? row.Qty ?? 0) || 0;
  const price = Number(row.price ?? row.unit_price ?? row.Price ?? 0) || 0;
  const value =
    Number(row.value ?? row.total_value ?? null) ??
    (qty * price);
  return {
    id: String(id),
    engName: String(engName || 'Unnamed').trim(),
    qty: Math.max(0, qty),
    price: Math.max(0, price),
    value: Math.max(0, value),
  };
}

/**
 * Fetch all inventory items from Supabase table.
 * @returns { Promise<{ items: Array, totalValue: number, totalQty: number }> }
 */
export async function fetchInventoryFromSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured (missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY)');
  }

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('id', { ascending: true });

  if (error) {
    throw new Error(error.message || 'Failed to load inventory from Supabase');
  }

  const rawRows = Array.isArray(data) ? data : [];
  const items = rawRows.map((row, i) => normalizeRow(row, i));
  const totalValue = items.reduce((s, i) => s + i.value, 0);
  const totalQty = items.reduce((s, i) => s + i.qty, 0);

  return { items, totalValue, totalQty };
}
