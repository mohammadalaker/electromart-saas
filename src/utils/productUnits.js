import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { normalizeDigitsToLatin } from './normalizeDigits';

export const PRODUCT_UNITS_TABLE = 'product_units';

export const COMMON_UNIT_PRESETS = [
  'قطعة',
  'علبة',
  'كرتونة',
  'طقم',
  'بكت',
  'شوال',
  'حبة',
  'كغم',
  'غرام',
  'لتر',
];

/**
 * جلب جميع الوحدات المسجلة لصنف معين (بما فيها الوحدة الأساسية)
 */
export async function fetchUnitsByProductId(productId, storeId) {
  if (!productId) return [];
  try {
    let query = supabase
      .from(PRODUCT_UNITS_TABLE)
      .select('*')
      .eq('product_id', productId);

    if (storeId) {
      query = query.eq('store_id', storeId);
    }

    const { data, error } = await query.order('conversion_factor', { ascending: true });
    if (error) {
      // إذا كان الجدول غير موجود بعد في قاعدة البيانات
      if (error.code === 'PGRST205' || /does not exist/i.test(error.message)) {
        return [];
      }
      console.warn('[productUnits] fetchUnitsByProductId error:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('[productUnits] fetchUnitsByProductId exception:', err);
    return [];
  }
}

/**
 * جلب وحدات مجموعة من الأصناف دفعة واحدة (للأداء السريع في الفاتورة)
 */
export async function fetchUnitsForProductIds(productIds, storeId) {
  const ids = Array.from(new Set((productIds || []).filter(Boolean)));
  if (ids.length === 0) return {};
  try {
    let query = supabase
      .from(PRODUCT_UNITS_TABLE)
      .select('*')
      .in('product_id', ids);

    if (storeId) {
      query = query.eq('store_id', storeId);
    }

    const { data, error } = await query;
    if (error) {
      if (error.code === 'PGRST205' || /does not exist/i.test(error.message)) {
        return {};
      }
      console.warn('[productUnits] fetchUnitsForProductIds error:', error.message);
      return {};
    }

    const map = {};
    for (const u of data || []) {
      if (!map[u.product_id]) map[u.product_id] = [];
      map[u.product_id].push(u);
    }
    return map;
  } catch (err) {
    console.warn('[productUnits] fetchUnitsForProductIds exception:', err);
    return {};
  }
}

/**
 * البحث عن وحدة بالباركود الخاص بها
 */
export async function findUnitByBarcode(barcode, storeId) {
  const norm = normalizeDigitsToLatin(String(barcode || '').trim());
  if (!norm) return null;

  try {
    const selCols = `
      id,
      unit_name,
      conversion_factor,
      barcode,
      sale_price,
      is_base_unit,
      product_id,
      store_id,
      product:products(
        id,
        barcode,
        eng_name,
        full_price,
        price_after_disc,
        stock_count,
        brand_group
      )
    `;

    let query = supabase
      .from(PRODUCT_UNITS_TABLE)
      .select(selCols)
      .eq('barcode', norm);

    if (storeId) {
      query = query.eq('store_id', storeId);
    }

    const { data, error } = await query.maybeSingle();
    if (error || !data) {
      return null;
    }
    return data;
  } catch (err) {
    console.warn('[productUnits] findUnitByBarcode exception:', err);
    return null;
  }
}

/**
 * حفظ الوحدات الإضافية والأساسية لصنف ما
 * @param {string} productId معرف المنتج
 * @param {string} storeId معرف المتجر
 * @param {Array} units قائمة بالوحدات
 */
export async function saveProductUnits(productId, storeId, units = []) {
  if (!productId) return { success: false, error: 'missing productId' };

  try {
    // 1. حذف الوحدات السابقة للصنف إن وجدت
    await supabase
      .from(PRODUCT_UNITS_TABLE)
      .delete()
      .eq('product_id', productId);

    if (!units || units.length === 0) {
      return { success: true };
    }

    // 2. تجهيز الصفوف للإدراج
    const rows = units
      .filter((u) => u && String(u.unit_name || '').trim())
      .map((u) => {
        const row = {
          product_id: productId,
          store_id: storeId || null,
          unit_name: String(u.unit_name).trim(),
          conversion_factor: Math.max(0.0001, Number(u.conversion_factor) || 1),
          barcode: u.barcode ? normalizeDigitsToLatin(String(u.barcode).trim()) : null,
          sale_price: Math.max(0, Number(u.sale_price) || 0),
          is_base_unit: Boolean(u.is_base_unit),
        };
        if (u.cost_price != null && Number(u.cost_price) >= 0) {
          row.cost_price = Number(u.cost_price);
        }
        return row;
      });

    if (rows.length === 0) {
      return { success: true };
    }

    let { error: insErr } = await supabase
      .from(PRODUCT_UNITS_TABLE)
      .insert(rows);

    // إذا كان عمود cost_price غير موجود في المخطط بعد، نعيد المحاولة بدونه
    if (
      insErr &&
      (/cost_price/i.test(insErr.message || '') ||
        insErr.code === 'PGRST204' ||
        insErr.code === '42703')
    ) {
      const rowsWithoutCost = rows.map(({ cost_price, ...rest }) => rest);
      const res = await supabase.from(PRODUCT_UNITS_TABLE).insert(rowsWithoutCost);
      insErr = res.error;
    }

    if (insErr) {
      console.warn('[productUnits] saveProductUnits insert error:', insErr.message);
      return { success: false, error: insErr.message };
    }

    return { success: true };
  } catch (err) {
    console.warn('[productUnits] saveProductUnits exception:', err);
    return { success: false, error: err.message };
  }
}
