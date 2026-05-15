import { brandStorageKey } from '../constants/brand.js';

/** نقل قيمة من مفتاح قديم إلى مفتاح Swiftm عند أول تشغيل بعد إعادة التسمية */
function migrateKey(oldKey, newKey) {
  if (typeof window === 'undefined') return;
  try {
    const value = localStorage.getItem(oldKey);
    if (value == null) return;
    if (localStorage.getItem(newKey) == null) {
      localStorage.setItem(newKey, value);
    }
    localStorage.removeItem(oldKey);
  } catch {
    /* ignore */
  }
}

function migrateSessionKey(oldKey, newKey) {
  if (typeof window === 'undefined') return;
  try {
    const value = sessionStorage.getItem(oldKey);
    if (value == null) return;
    if (sessionStorage.getItem(newKey) == null) {
      sessionStorage.setItem(newKey, value);
    }
    sessionStorage.removeItem(oldKey);
  } catch {
    /* ignore */
  }
}

/** يُستدعى مرة عند إقلاع التطبيق */
export function migrateLegacyStorageKeys() {
  const pairs = [
    ['electrogo_remember_email', brandStorageKey('remember-email')],
    ['electrogo-custom-product-types', brandStorageKey('custom-product-types')],
    ['electromart-low-stock-threshold', brandStorageKey('low-stock-threshold')],
    ['inventory-dashboard-sidebar-collapsed', brandStorageKey('sidebar-collapsed')],
    ['inventory-dashboard-theme', brandStorageKey('theme')],
    ['inventory-dashboard-barcode-mode', brandStorageKey('barcode-mode')],
    ['sidebar-recent-pages', brandStorageKey('sidebar-recent-pages')],
    ['sidebar-pinned-pages', brandStorageKey('sidebar-pinned-pages')],
    ['pos_product_reviews_v1', brandStorageKey('product-reviews-v1')],
    ['purchase_invoice_header', brandStorageKey('purchase-invoice-header')],
  ];

  for (const [oldKey, newKey] of pairs) {
    migrateKey(oldKey, newKey);
  }

  migrateSessionKey('purchase_invoice_header', brandStorageKey('purchase-invoice-header'));

  try {
    const prefix = 'em-public-cart-';
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const oldKey of keys) {
      const slug = oldKey.slice(prefix.length);
      migrateKey(oldKey, brandStorageKey(`public-cart-${slug}`));
    }
  } catch {
    /* ignore */
  }
}
