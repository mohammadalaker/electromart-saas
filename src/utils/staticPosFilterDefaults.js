/**
 * فلاتر POS ثابتة (عرض/تصميم) عندما لا تُرجع بيانات Supabase
 * مجموعات أو أحجاماً كافية — حتى يبقى الشريط الجانبي قابلاً للمعاينة.
 * عند تعبئة brand_group و box_count في المنتجات تُستبدل تلقائياً بالقيم الفعلية.
 */

/** علامات تجارية شائعة في الأجهزة المنزلية والكهربائية */
export const STATIC_POS_BRAND_OPTIONS = [
  { value: 'Samsung', label: 'Samsung' },
  { value: 'LG', label: 'LG' },
  { value: 'Bosch', label: 'Bosch' },
  { value: 'Sony', label: 'Sony' },
  { value: 'Philips', label: 'Philips' },
  { value: 'Panasonic', label: 'Panasonic' },
  { value: 'Whirlpool', label: 'Whirlpool' },
  { value: 'Haier', label: 'Haier' },
  { value: 'Midea', label: 'Midea' },
  { value: 'Hisense', label: 'Hisense' },
  { value: 'Tefal', label: 'Tefal' },
  { value: 'Moulinex', label: 'Moulinex' },
  { value: 'Braun', label: 'Braun' },
  { value: 'Kenwood', label: 'Kenwood' },
  { value: 'Dyson', label: 'Dyson' },
];

/** أحجام/صناديق شائعة — للعرض عند عدم وجود أصناف محمّلة بعد */
export const STATIC_POS_SIZE_OPTIONS = [
  { value: '__empty__', label: 'بدون صندوق / حجم' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '4', label: '4' },
  { value: '6', label: '6' },
  { value: '8', label: '8' },
];
