/** هوية Swiftm — مصدر واحد لاسم المشروع والشعار والتخزين المحلي */
export const BRAND_NAME = 'Swiftm';
export const BRAND_NAME_LOWER = 'swiftm';
export const BRAND_TAGLINE_AR = 'إدارة تجارة ذكية';
export const BRAND_TAGLINE_EN = 'SMART COMMERCE';
export const BRAND_FOOTER_AR = 'منصة تجارة ذكية. تجربة إدارة عصرية.';
export const BRAND_STORAGE_PREFIX = 'swiftm';
export const BRAND_THEME_EVENT = 'swiftm-theme-change';
export const BRAND_SQL_PATH_PREFIX = 'swiftm/supabase';

export function brandStorageKey(suffix) {
  return `${BRAND_STORAGE_PREFIX}-${suffix}`;
}

export function brandCopyright(year = new Date().getFullYear()) {
  return `© ${year} ${BRAND_NAME} — جميع الحقوق محفوظة.`;
}

export function brandPublicCartKey(slug) {
  return brandStorageKey(`public-cart-${slug}`);
}
