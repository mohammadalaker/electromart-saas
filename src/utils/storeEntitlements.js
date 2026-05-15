/**
 * مفاتيح الوحدات — تُخزَّن في stores.disabled_modules كمصفوفة نصوص للمعطّل فقط.
 * غياب المفتاح من المصفوفة = الوحدة مفعّلة.
 */

/** مجموعات عرض في شاشة إدارة الباقة (نفس منطق القائمة الجانبية تقريباً) */
export const MODULE_GROUPS = [
  {
    id: 'inventory',
    title: 'المخزون والصيانة',
    keys: [
      'inventory_logs',
      'stock_transfers',
      'warehouse_locations',
      'quick_inventory',
      'service_warranty',
    ],
  },
  {
    id: 'finance',
    title: 'المالية والمحاسبة',
    keys: [
      'financial_center',
      'trial_balance',
      'journal_entries',
      'activity_log',
      'funds',
      'finance_overview',
      'debt_aging',
      'profit_reports',
      'vouchers',
      'checks',
    ],
  },
  {
    id: 'pos',
    title: 'نقطة البيع والعروض',
    keys: ['pos', 'promotions'],
  },
  {
    id: 'sales',
    title: 'المبيعات والمشتريات',
    keys: [
      'sales_movements',
      'preorders',
      'purchases',
      'purchase_rfq',
      'purchase_price_history',
      'purchase_history',
      'purchase_lines',
      'supplier_statement',
      'customer_statement',
    ],
  },
  {
    id: 'customers',
    title: 'العملاء والمتجر العام',
    keys: ['customers', 'debt_ledger', 'storefront'],
  },
];

export const MODULE_LABELS_AR = {
  inventory_logs: 'سجل حركات المخزن',
  stock_transfers: 'التحويل المخزني',
  warehouse_locations: 'مواقع المخزن',
  quick_inventory: 'الجرد السريع',
  service_warranty: 'الصيانة والضمان',
  financial_center: 'المركز المالي',
  trial_balance: 'ميزان المراجعة',
  journal_entries: 'القيود اليومية',
  activity_log: 'سجل التدقيق',
  funds: 'الصناديق والبنوك',
  finance_overview: 'المالية والمصروفات',
  debt_aging: 'أعمار الديون',
  profit_reports: 'تقارير الأرباح',
  vouchers: 'سندات القبض والصرف',
  checks: 'الشيكات',
  promotions: 'العروض الذكية',
  pos: 'نقطة البيع',
  sales_movements: 'حركات المبيعات',
  preorders: 'الحجز المسبق',
  purchases: 'المشتريات',
  purchase_rfq: 'طلبات عرض السعر',
  purchase_price_history: 'آخر أسعار الشراء',
  purchase_history: 'سجل المشتريات',
  purchase_lines: 'فاتورة مشتريات (أسطر)',
  supplier_statement: 'كشف حساب مورد',
  customer_statement: 'كشف حساب زبون',
  customers: 'الزبائن والموردين',
  debt_ledger: 'الذمم والديون',
  storefront: 'إعدادات واجهة المتجر',
};

/** @param {Record<string, unknown> | null | undefined} store */
export function getDisabledModuleSet(store) {
  const raw = store?.disabled_modules;
  if (raw == null) return new Set();
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((x) => typeof x === 'string' && x.length > 0));
}

/**
 * @param {Record<string, unknown> | null | undefined} store
 * @param {string | undefined} moduleKey
 */
export function isModuleEnabled(store, moduleKey) {
  if (!moduleKey) return true;
  if (!store) return true;
  return !getDisabledModuleSet(store).has(moduleKey);
}

const ALLOWED_MODULE_KEYS = new Set(Object.keys(MODULE_LABELS_AR));

/** يبقي فقط مفاتيح معروفة ومرتّبة — للحفظ في disabled_modules */
export function normalizeDisabledModules(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [...new Set(raw.filter((k) => typeof k === 'string' && ALLOWED_MODULE_KEYS.has(k)))];
  out.sort();
  return out;
}
