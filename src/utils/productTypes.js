/** أنواع المنتج — تُخزَّن في `products.product_type` */
import { brandStorageKey } from '../constants/brand.js';

export const PRODUCT_TYPE_SLUGS = [
  'tv',
  'fridge',
  'washer',
  'dryer',
  'dishwasher',
  'oven',
  'hood',
  'small_home',
  'small',
  'large',
];

export const PRODUCT_TYPE_LABEL_AR = {
  tv: 'تلفزيونات',
  fridge: 'ثلاجات',
  washer: 'غسالات',
  dryer: 'نشافات',
  dishwasher: 'جلايات',
  oven: 'أفران + ميكروويف بلت إن',
  hood: 'شفاطات',
  small_home: 'قطع صغيرة ومنزلية',
  small: 'قطع صغيرة',
  large: 'قطع كبيرة',
};

export function getProductTypeLabel(slug) {
  if (slug == null || String(slug).trim() === '') return '';
  const s = String(slug).trim();
  return PRODUCT_TYPE_LABEL_AR[s] || s;
}

/** الاسم العربي للنوع المعرف → المفتاح المخزَّن في DB */
const PRODUCT_TYPE_AR_TO_SLUG = Object.fromEntries(
  Object.entries(PRODUCT_TYPE_LABEL_AR).map(([slug, ar]) => [ar, slug])
);

function normalizeKnownProductTypeSlug(value) {
  const t = String(value ?? '').trim();
  if (!t) return '';
  if (PRODUCT_TYPE_SLUGS.includes(t)) return t;
  return PRODUCT_TYPE_AR_TO_SLUG[t] || '';
}

/** قيمة من DB/الجدول → ما يُعرض في حقل النموذج (عربي للأنواع المعرفة، وإلا النص كما هو) */
export function productTypeToFormDisplay(stored) {
  if (stored == null || String(stored).trim() === '') return '';
  const s = String(stored).trim();
  if (PRODUCT_TYPE_LABEL_AR[s]) return PRODUCT_TYPE_LABEL_AR[s];
  return s;
}

/**
 * ما يُحفظ في `products.product_type`: slug للأنواع المعرفة، أو أي نص مخصص (مثل «مكيفات»).
 */
export function normalizeProductTypeForDb(input) {
  const t = String(input ?? '').trim();
  if (!t) return null;
  if (PRODUCT_TYPE_SLUGS.includes(t)) return t;
  const fromAr = PRODUCT_TYPE_AR_TO_SLUG[t];
  if (fromAr) return fromAr;
  return t;
}

/** خيارات حقل «نوع المنتج» في نموذج الإضافة/التعديل */
export const PRODUCT_FORM_TYPE_OPTIONS = [
  { value: '', label: '— بدون نوع —' },
  ...PRODUCT_TYPE_SLUGS.map((value) => ({
    value,
    label: PRODUCT_TYPE_LABEL_AR[value],
  })),
];

const CUSTOM_PRODUCT_TYPES_LS_KEY = brandStorageKey('custom-product-types');
const CUSTOM_PRODUCT_TYPES_MAX = 40;

/** أنواع أضافها المستخدم من النافذة — تُعرض في القائمة مع الأنواع الجاهزة */
export function loadCustomProductTypes() {
  try {
    const raw = localStorage.getItem(CUSTOM_PRODUCT_TYPES_LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))].slice(
      0,
      CUSTOM_PRODUCT_TYPES_MAX
    );
  } catch {
    return [];
  }
}

/** حفظ نوع جديد وإرجاع القائمة المحدّثة */
export function addCustomProductType(label) {
  const t = String(label ?? '').trim();
  if (!t) return loadCustomProductTypes();
  const builtinLabels = new Set(Object.values(PRODUCT_TYPE_LABEL_AR));
  if (builtinLabels.has(t)) return loadCustomProductTypes();
  const cur = loadCustomProductTypes().filter((x) => x !== t);
  const merged = [t, ...cur].slice(0, CUSTOM_PRODUCT_TYPES_MAX);
  try {
    localStorage.setItem(CUSTOM_PRODUCT_TYPES_LS_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
  return merged;
}

/** بناء خيارات الـ select: جاهزة + مخصصة + القيمة الحالية (مثل Sheet1 من Excel) */
export function buildProductTypeSelectOptions(customTypes, currentFormValue) {
  const cur = String(currentFormValue ?? '').trim();
  const seen = new Set();
  const out = [];

  for (const o of PRODUCT_FORM_TYPE_OPTIONS) {
    const value = o.value === '' ? '' : o.label;
    const label = o.label;
    if (value !== '') seen.add(value);
    out.push({ value, label });
  }

  const predefined = new Set(
    PRODUCT_FORM_TYPE_OPTIONS.filter((o) => o.value).map((o) => o.label)
  );

  for (const t of customTypes) {
    if (!t || predefined.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push({ value: t, label: t });
  }

  if (cur && !seen.has(cur)) {
    out.push({ value: cur, label: `${cur} (قيمة حالية)` });
  }

  return out;
}

/** بطاقات التصنيف في المتجر العام (الأولى للكل) */
const STORE_CATEGORY_SLUGS = PRODUCT_TYPE_SLUGS.filter((id) => id !== 'small' && id !== 'large');

export const STORE_CATEGORY_TILES = [
  { id: 'all', label: 'الكل' },
  ...STORE_CATEGORY_SLUGS.map((id) => ({
    id,
    label: PRODUCT_TYPE_LABEL_AR[id],
  })),
];

function searchBlob(item) {
  return `${item.name || ''} ${item.group || ''} ${item.reference || ''}`.toLowerCase();
}

/** تطابق قديم للأصناف قبل تعبئة product_type */
const LEGACY_TEST = {
  tv: (t) =>
    /تلفزيون|تليفزيون|\btv\b|television|smart\s*tv|شاشة/.test(t),
  fridge: (t) => /ثلاج|refrigerator|\bfridge\b|freezer|فريزر/.test(t),
  washer: (t) => /غسال|washing\s*machine|laundry|مغسلة/.test(t),
  dryer: (t) => /نشاف|مجفف|dryer|tumble/.test(t),
  dishwasher: (t) => /جلاي|dishwasher/.test(t),
  oven: (t) =>
    /فرن|أفران|ميكروو|microwave|\boven\b|بلت\s*ان|built[\s-]*in/.test(t),
  hood: (t) =>
    /شفاط|شفّاط|هود|hood|range\s*hood|cooker\s*hood|extractor|canopy\s*hood/.test(t),
  small_home: (t) =>
    /tefal|تيفال|مكواة|كوي|iron\b|غلاية|غلا?ي|kettle|خلاط|blender|مخفقة|mixer|عصارة|juicer|توستر|toaster|مكنسة|vacuum|مروحة|fan|هيتر|سخان|heater|fryer|قلاية|air\s*fryer|قالب|حلاقة|shaver|شعر|hair/.test(t),
  small: () => false,
  large: () => false,
};

/** تصفية بطاقة متجر عام أو فلتر POS */
export function itemMatchesProductCategory(tileId, item) {
  if (!tileId || tileId === 'all') return true;
  const pt = normalizeKnownProductTypeSlug(item.productType);
  if (pt === tileId) return true;
  if (pt) return false;
  const fn = LEGACY_TEST[tileId];
  if (!fn) return false;
  return fn(searchBlob(item));
}

/** تصفية واجهة المتجر العامة — تعتمد على النوع المخزن فقط لتجنب خلط صور/منتجات التصنيفات. */
export function itemMatchesStoreCategory(tileId, item) {
  if (!tileId || tileId === 'all') return true;
  return normalizeKnownProductTypeSlug(item.productType) === tileId;
}

export function itemMatchesAnyProductTypeSlug(slugs, item) {
  if (!slugs?.length) return true;
  return slugs.some((slug) => itemMatchesProductCategory(slug, item));
}

/** حقل منفصل عن نوع الجهاز — قطع صغيرة / كبيرة (`products.appliance_size`) */
export const APPLIANCE_SIZE_FORM_OPTIONS = [
  { value: '', label: '— غير محدد —' },
  { value: 'small', label: 'قطع صغيرة (منزلي)' },
  { value: 'large', label: 'قطع كبيرة' },
];
