/** مجموعات/علامات تُعامل كأجهزة كهربائية (كفالة، سيريال) — قابلة للتوسعة */
const ELECTRICAL_GROUPS = [
  'Tefal Electric',
  'Tefal',
  'Moulinex',
  'Mounliex',
  'Babyliss',
  'Babyliss Pro',
  'Kenwood',
  'Braun',
  'KMG midea SDA',
  'KMG midea VC',
  'KMG ACE',
  'KMG midea MWO',
  'JBL',
  'Midea',
  'Samsung',
  'LG',
  'Philips',
  'Dyson',
].map((s) => s.trim().toLowerCase());

/**
 * هل يُصنَّف الصنف كجهاز كهربائي (لإظهار حقل السيريال)؟
 * يعتمد على brand_group من المنتج أو اسم المنتج.
 */
export function isElectricalProduct({ brandGroup, productName } = {}) {
  const g = String(brandGroup || '')
    .trim()
    .toLowerCase();
  if (g && ELECTRICAL_GROUPS.some((eg) => g === eg)) return true;
  const n = String(productName || '')
    .trim()
    .toLowerCase();
  if (!n) return false;
  return ELECTRICAL_GROUPS.some((eg) => n.includes(eg) || eg.includes(n));
}
