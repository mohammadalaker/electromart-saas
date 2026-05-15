/**
 * نموذج منتج موحّد بين المخزن ونقطة البيع.
 */

/** بدون appliance_size — للاستخدام إذا لم تُنفَّذ migration بعد */
export const PRODUCTS_SELECT_BASE =
  'id, barcode, eng_name, brand_group, reference, box_count, product_type, full_price, price_after_disc, stock_count, image_url, warranty_months';

export const PRODUCTS_SELECT = `${PRODUCTS_SELECT_BASE}, appliance_size`;

/** خطأ PostgREST عندما العمود غير موجود في المخطط */
export function isMissingApplianceSizeColumnError(error) {
  if (!error) return false;
  return /appliance_size/i.test(String(error.message || ''));
}

/**
 * تنفيذ استعلام منتجات مع إعادة المحاولة بدون appliance_size إن لزم.
 * @param {(select: string) => Promise<{ data?: unknown; error?: unknown }>} run — دالة تستقبل سلسلة الأعمدة وتُرجع نتيجة supabase
 */
export async function runProductsSelectWithFallback(run) {
  let result = await run(PRODUCTS_SELECT);
  if (result.error && isMissingApplianceSizeColumnError(result.error)) {
    result = await run(PRODUCTS_SELECT_BASE);
  }
  return result;
}

export function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(s || '').trim()
  );
}

/** رقم من قاعدة البيانات؛ null إن لم يُحدَّد (لا يُخلط مع 0) */
function toNumOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** تقريب مبلغ بالشيقل إلى أغورتين (لا يُستخدم Math.round الذي يحذف الكسور) */
export function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

export function normalizeItemFromSupabase(row) {
  if (!row) return null;
  const full = toNumOrNull(row.full_price);
  const afterDisc = toNumOrNull(row.price_after_disc);
  return {
    id: row.id != null ? String(row.id) : String(row.barcode ?? ''),
    barcode: row.barcode ?? '',
    name: (row.eng_name ?? '').toString().trim(),
    group: (row.brand_group ?? '').toString().trim(),
    reference: (row.reference ?? '').toString().trim(),
    box: row.box_count != null && row.box_count !== '' ? String(row.box_count) : '',
    productType: (row.product_type ?? '').toString().trim(),
    applianceSize: (row.appliance_size ?? '').toString().trim(),
    price: full ?? 0,
    /** إن وُجد عمود بعد الخصم (حتى 0) يُستخدم؛ وإلا سعر القائمة */
    priceAfterDiscount: afterDisc !== null ? afterDisc : (full ?? 0),
    stock: row.stock_count,
    image: (row.image_url ?? '').toString().trim() || null,
    /** مدة الضمان بالأشهر — من عمود warranty_months (0 = لا يوجد) */
    warrantyMonths: (() => {
      const v = row.warranty_months;
      if (v == null || v === '') return null;
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      return Math.min(240, Math.max(0, n));
    })(),
  };
}
