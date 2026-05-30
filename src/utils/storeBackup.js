import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';

const PAGE_SIZE = 1000;
const UPSERT_BATCH = 150;
const IN_BATCH = 100;

export const BACKUP_VERSION = 1;

export const TABLE_LABELS_AR = {
  stores: 'المتجر',
  products: 'المنتجات',
  items: 'الأصناف',
  sales: 'المبيعات',
  expenses: 'المصاريف',
  store_contacts: 'جهات الاتصال',
  store_purchases: 'المشتريات',
  inventory_logs: 'سجل المخزون',
  vouchers: 'السندات',
  pre_orders: 'الحجوزات',
  pre_order_lines: 'أسطر الحجز',
  store_checks: 'الشيكات',
  store_fund_accounts: 'حسابات الصندوق',
  store_fund_movements: 'حركات الصندوق',
  journal_entries: 'القيود اليومية',
  journal_entry_lines: 'أسطر القيود',
  loyalty_point_transactions: 'نقاط الولاء',
  service_warranty_tickets: 'تذاكر الضمان',
  product_serials: 'السيريالات',
  stock_transfers: 'تحويلات المخزون',
  stock_transfer_lines: 'أسطر التحويل',
};

export const EXPORT_ORDER = [
  'stores',
  'products',
  'items',
  'sales',
  'expenses',
  'store_contacts',
  'store_purchases',
  'inventory_logs',
  'vouchers',
  'pre_orders',
  'pre_order_lines',
  'store_checks',
  'store_fund_accounts',
  'store_fund_movements',
  'journal_entries',
  'journal_entry_lines',
  'loyalty_point_transactions',
  'service_warranty_tickets',
  'product_serials',
  'stock_transfers',
  'stock_transfer_lines',
];

export const IMPORT_ORDER = [
  'stores',
  'store_contacts',
  'products',
  'items',
  'store_fund_accounts',
  'store_fund_movements',
  'store_purchases',
  'sales',
  'expenses',
  'vouchers',
  'inventory_logs',
  'pre_orders',
  'pre_order_lines',
  'store_checks',
  'journal_entries',
  'journal_entry_lines',
  'loyalty_point_transactions',
  'service_warranty_tickets',
  'product_serials',
  'stock_transfers',
  'stock_transfer_lines',
];

const TABLE_CONFIG = {
  stores: { table: 'stores', mode: 'store_row' },
  products: { table: PRODUCTS_TABLE, mode: 'store_id' },
  items: { table: 'items', mode: 'store_id', optional: true },
  sales: { table: 'sales', mode: 'store_id' },
  expenses: { table: 'expenses', mode: 'store_id', optional: true },
  store_contacts: { table: 'store_contacts', mode: 'store_id' },
  store_purchases: { table: 'store_purchases', mode: 'store_id' },
  inventory_logs: { table: 'inventory_logs', mode: 'store_id', optional: true },
  vouchers: { table: 'vouchers', mode: 'store_id', optional: true },
  pre_orders: { table: 'pre_orders', mode: 'store_id', optional: true },
  pre_order_lines: {
    table: 'pre_order_lines',
    mode: 'parent_ids',
    parentKey: 'pre_orders',
    parentIdColumn: 'pre_order_id',
    optional: true,
  },
  store_checks: { table: 'store_checks', mode: 'store_id', optional: true },
  store_fund_accounts: { table: 'store_fund_accounts', mode: 'store_id' },
  store_fund_movements: { table: 'store_fund_movements', mode: 'store_id' },
  journal_entries: { table: 'journal_entries', mode: 'store_id', optional: true },
  journal_entry_lines: {
    table: 'journal_entry_lines',
    mode: 'parent_ids',
    parentKey: 'journal_entries',
    parentIdColumn: 'entry_id',
    optional: true,
  },
  loyalty_point_transactions: {
    table: 'loyalty_point_transactions',
    mode: 'store_id',
    optional: true,
  },
  service_warranty_tickets: {
    table: 'service_warranty_tickets',
    mode: 'store_id',
    optional: true,
  },
  product_serials: { table: 'product_serials', mode: 'store_id', optional: true },
  stock_transfers: { table: 'stock_transfers', mode: 'store_id', optional: true },
  stock_transfer_lines: {
    table: 'stock_transfer_lines',
    mode: 'parent_ids',
    parentKey: 'stock_transfers',
    parentIdColumn: 'transfer_id',
    optional: true,
  },
};

function isMissingTableError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || '');
  return err.code === 'PGRST205' || err.code === '42P01' || /does not exist|schema cache|PGRST204/i.test(msg);
}

async function fetchPaged(table, applyFilter) {
  let from = 0;
  const all = [];
  while (true) {
    let q = supabase.from(table).select('*');
    q = applyFilter(q).range(from, from + PAGE_SIZE - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

async function fetchByStoreId(table, storeId) {
  return fetchPaged(table, (q) => q.eq('store_id', storeId));
}

async function fetchStoreRow(storeId) {
  const { data, error } = await supabase.from('stores').select('*').eq('id', storeId).maybeSingle();
  if (error) throw error;
  return data ? [data] : [];
}

async function fetchByParentIds(table, parentIds, parentIdColumn) {
  if (!parentIds.length) return [];
  const all = [];
  for (let i = 0; i < parentIds.length; i += IN_BATCH) {
    const chunk = parentIds.slice(i, i + IN_BATCH);
    const rows = await fetchPaged(table, (q) => q.in(parentIdColumn, chunk));
    all.push(...rows);
  }
  return all;
}

async function fetchTableRows(key, storeId, tablesAccumulator) {
  const cfg = TABLE_CONFIG[key];
  if (!cfg) return [];

  try {
    if (cfg.mode === 'store_row') {
      return await fetchStoreRow(storeId);
    }
    if (cfg.mode === 'store_id') {
      return await fetchByStoreId(cfg.table, storeId);
    }
    if (cfg.mode === 'parent_ids') {
      const parentRows = tablesAccumulator[cfg.parentKey] || [];
      const parentIds = parentRows.map((r) => r.id).filter(Boolean);
      return await fetchByParentIds(cfg.table, parentIds, cfg.parentIdColumn);
    }
    return [];
  } catch (err) {
    if (cfg.optional || isMissingTableError(err)) return [];
    throw err;
  }
}

export function sanitizeBackupFileName(storeName) {
  const safe =
    String(storeName || 'store')
      .trim()
      .replace(/[^\w\u0600-\u06FF-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'store';
  const date = new Date().toISOString().slice(0, 10);
  return `backup-${safe}-${date}.json`;
}

export async function exportStoreBackup(storeId, storeName) {
  const tables = {};

  for (const key of EXPORT_ORDER) {
    tables[key] = await fetchTableRows(key, storeId, tables);
  }

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    storeName: storeName || '',
    storeId,
    tables,
  };
}

export function parseBackupFile(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data || typeof data !== 'object') {
    throw new Error('ملف النسخة الاحتياطية غير صالح.');
  }
  if (!data.tables || typeof data.tables !== 'object') {
    throw new Error('بنية الملف غير صحيحة: tables مفقود.');
  }
  return data;
}

export function getBackupSummary(backup) {
  const counts = {};
  for (const key of EXPORT_ORDER) {
    const rows = backup.tables?.[key];
    counts[key] = Array.isArray(rows) ? rows.length : 0;
  }
  return counts;
}

function normalizeRowForImport(row, storeId, key) {
  const next = { ...row };
  if (key === 'stores') {
    return { ...next, id: storeId };
  }
  if ('store_id' in next) {
    next.store_id = storeId;
  }
  return next;
}

async function upsertTableRows(table, rows) {
  if (!rows?.length) return;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const chunk = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: 'id' });
    if (error) throw error;
  }
}

export async function importStoreBackup(storeId, backup) {
  const parsed = parseBackupFile(backup);
  const results = {};

  for (const key of IMPORT_ORDER) {
    const cfg = TABLE_CONFIG[key];
    if (!cfg) continue;

    const rawRows = parsed.tables?.[key];
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      results[key] = 0;
      continue;
    }

    const rows = rawRows.map((row) => normalizeRowForImport(row, storeId, key));

    try {
      await upsertTableRows(cfg.table, rows);
      results[key] = rows.length;
    } catch (err) {
      if (cfg.optional || isMissingTableError(err)) {
        results[key] = 0;
        continue;
      }
      throw new Error(`${TABLE_LABELS_AR[key] || key}: ${err.message || 'فشل الاستيراد'}`);
    }
  }

  return results;
}

export function downloadJsonBackup(payload, fileName) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
