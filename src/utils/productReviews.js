/**
 * نظام تقييمات المنتجات — يخزن في Supabase (جدول product_reviews) مع fallback إلى localStorage
 */

export const REVIEWS_TABLE = 'product_reviews';
import { brandStorageKey } from '../constants/brand.js';

const LS_KEY = brandStorageKey('product-reviews-v1');

/** قراءة التقييمات المحلية من localStorage */
function readLocalReviews() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch {
    return {};
  }
}

/** حفظ التقييمات المحلية */
function writeLocalReviews(map) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

/**
 * حساب متوسط التقييم وعدد التقييمات من مصفوفة صفوف قاعدة البيانات.
 * @param {Array} rows - مصفوفة من { rating, product_id }
 * @returns {{ [productId]: { avg: number, count: number }}}
 */
export function aggregateReviews(rows) {
  const map = {};
  for (const r of rows || []) {
    const pid = String(r.product_id);
    if (!map[pid]) map[pid] = { sum: 0, count: 0 };
    map[pid].sum += Number(r.rating) || 0;
    map[pid].count += 1;
  }
  const result = {};
  for (const [pid, { sum, count }] of Object.entries(map)) {
    result[pid] = { avg: count > 0 ? Math.round((sum / count) * 10) / 10 : 0, count };
  }
  return result;
}

/**
 * جلب مجمَّع التقييمات من Supabase لمتجر معين.
 * يُعيد null لو الجدول غير موجود (graceful degradation).
 */
export async function fetchReviewsAggregate(supabase, storeId) {
  if (!storeId) return {};
  try {
    const { data, error } = await supabase
      .from(REVIEWS_TABLE)
      .select('product_id, rating')
      .eq('store_id', storeId);

    if (error) {
      // الجدول غير موجود — نعود للمحلي
      if (/relation|does not exist|PGRST116|42P01/i.test(String(error.message || ''))) {
        return aggregateReviews(buildLocalRows(storeId));
      }
      console.warn('[reviews] fetch error:', error.message);
      return aggregateReviews(buildLocalRows(storeId));
    }
    // دمج البيانات المحلية (حالات offline)
    const localRows = buildLocalRows(storeId);
    return aggregateReviews([...(data || []), ...localRows]);
  } catch (e) {
    console.warn('[reviews]', e);
    return {};
  }
}

/** بناء صفوف وهمية من localStorage للـ fallback */
function buildLocalRows(storeId) {
  const all = readLocalReviews();
  const rows = [];
  for (const [key, rating] of Object.entries(all)) {
    // key = storeId__productId
    const [sid, pid] = key.split('__');
    if (sid === String(storeId) && pid) {
      rows.push({ store_id: sid, product_id: pid, rating });
    }
  }
  return rows;
}

/**
 * حفظ تقييم منتج — يحاول Supabase أولاً، ثم localStorage.
 * @returns {{ ok: boolean, error?: string }}
 */
export async function submitProductReview(supabase, { storeId, productId, rating, reviewerName }) {
  if (!storeId || !productId || !rating) return { ok: false, error: 'بيانات ناقصة' };
  const ratingNum = Math.min(5, Math.max(1, Math.round(Number(rating))));

  // حفظ محلي دائماً (للعمل offline)
  const local = readLocalReviews();
  local[`${storeId}__${productId}`] = ratingNum;
  writeLocalReviews(local);

  try {
    const row = {
      store_id: storeId,
      product_id: productId,
      rating: ratingNum,
      reviewer_name: (reviewerName || '').trim() || 'زبون',
      created_at: new Date().toISOString(),
    };
    const { error } = await supabase.from(REVIEWS_TABLE).insert([row]);
    if (error) {
      if (/relation|does not exist|PGRST116|42P01/i.test(String(error.message || ''))) {
        // الجدول غير موجود — OK، حفظنا محلياً
        return { ok: true, localOnly: true };
      }
      console.warn('[reviews] insert error:', error.message);
      return { ok: true, localOnly: true };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[reviews]', e);
    return { ok: true, localOnly: true };
  }
}
