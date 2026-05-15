/**
 * محرك عروض الـ POS — يُقيَّم على السلة دون تعديل أسطر الطلب يدوياً.
 *
 * bundle_pair — config:
 *   trigger_product_id, reward_product_id (uuid نصّي),
 *   trigger_min_qty (افتراضي 1),
 *   discount_percent (0–100 على وحدات المكافأة المقترنة)
 *
 * cart_qty_discount — config:
 *   min_total_units (مجموع قطع السلة),
 *   discount_percent (يُطبَّق على كل الأصناف بعد حزم bundle_pair)
 */
import { roundMoney } from './productModel';

const TABLE = 'store_promotions';

export { TABLE as STORE_PROMOTIONS_TABLE };

function baseUnitFromItem(item) {
  return roundMoney(item?.priceAfterDiscount ?? item?.price ?? 0);
}

function normId(id) {
  return id != null ? String(id).trim() : '';
}

/**
 * @param {Array<{ id: string, qty: number, item: object }>} orderLines — أسطر بعد ربط item
 * @param {Array<{ id: string, name_ar: string, active: boolean, sort_order: number, kind: string, config: object }>} promotions
 * @returns {{ byLineId: Map<string, { unit: number, labels: string[] }>, cartWideLabels: string[] }}
 */
export function evaluatePromotions(orderLines, promotions) {
  const lines = (orderLines || [])
    .filter((o) => o.item)
    .map((o) => ({
      id: normId(o.id),
      qty: Math.max(1, Math.floor(Number(o.qty) || 1)),
      item: o.item,
    }));

  const byLineId = new Map();
  for (const L of lines) {
    byLineId.set(L.id, {
      unit: baseUnitFromItem(L.item),
      labels: [],
    });
  }

  const cartWideLabels = [];
  const sorted = [...(promotions || [])]
    .filter((p) => p && p.active !== false)
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));

  const appliedBundleKeys = new Set();

  for (const p of sorted) {
    const cfg = p.config && typeof p.config === 'object' ? p.config : {};

    if (p.kind === 'bundle_pair') {
      const tid = normId(cfg.trigger_product_id);
      const rid = normId(cfg.reward_product_id);
      const tmin = Math.max(1, Math.floor(Number(cfg.trigger_min_qty) || 1));
      const d = Math.min(100, Math.max(0, Number(cfg.discount_percent) || 0));
      if (!tid || !rid || tid === rid) continue;

      const key = `${tid}|${rid}`;
      if (appliedBundleKeys.has(key)) continue;

      const tLine = lines.find((l) => l.id === tid);
      const rLine = lines.find((l) => l.id === rid);
      if (!tLine || !rLine) continue;

      const sets = Math.min(Math.floor(tLine.qty / tmin), rLine.qty);
      if (sets < 1) continue;

      const P = baseUnitFromItem(rLine.item);
      const rq = rLine.qty;
      const blended = (sets * P * (1 - d / 100) + (rq - sets) * P) / rq;

      const cur = byLineId.get(rid);
      if (!cur) continue;
      byLineId.set(rid, {
        unit: roundMoney(blended),
        labels: [...cur.labels, p.name_ar || 'عرض شراء'],
      });
      appliedBundleKeys.add(key);
    } else if (p.kind === 'cart_qty_discount') {
      const minU = Math.max(2, Math.floor(Number(cfg.min_total_units) || 2));
      const d = Math.min(100, Math.max(0, Number(cfg.discount_percent) || 0));
      const totalUnits = lines.reduce((s, l) => s + l.qty, 0);
      if (totalUnits < minU || d <= 0) continue;

      for (const L of lines) {
        const cur = byLineId.get(L.id);
        if (!cur) continue;
        byLineId.set(L.id, {
          unit: roundMoney(cur.unit * (1 - d / 100)),
          labels: [...cur.labels, p.name_ar || `خصم ${d}%`],
        });
      }
      cartWideLabels.push(p.name_ar || `خصم ${d}% عند ${minU}+ قطعة`);
    }
  }

  return { byLineId, cartWideLabels };
}

/**
 * اقتراحات للبائع: يوجد عرض حزمة لكن المنتج المكافأ غير في السلة.
 * @param {Array<{ id: string, qty: number }>} orderLines
 * @param promotions
 * @param {Array<{ id: string, name?: string, barcode?: string }>} catalogItems — مخزون المنتجات للبحث بالاسم
 */
export function getPromotionSuggestions(orderLines, promotions, catalogItems) {
  const inCart = new Set((orderLines || []).map((o) => normId(o.id)));
  const itemsById = new Map((catalogItems || []).map((i) => [normId(i.id), i]));
  const out = [];
  const seen = new Set();

  const sorted = [...(promotions || [])]
    .filter((p) => p && p.active !== false && p.kind === 'bundle_pair')
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));

  for (const p of sorted) {
    const cfg = p.config && typeof p.config === 'object' ? p.config : {};
    const tid = normId(cfg.trigger_product_id);
    const rid = normId(cfg.reward_product_id);
    if (!tid || !rid) continue;
    if (!inCart.has(tid) || inCart.has(rid)) continue;
    const reward = itemsById.get(rid);
    if (!reward) continue;
    const k = `${tid}|${rid}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const name = reward.name || reward.barcode || 'صنف';
    out.push({
      promotionId: p.id,
      nameAr: p.name_ar,
      rewardProductId: rid,
      rewardName: name,
      message: `أضف «${name}» لتفعيل العرض: ${p.name_ar}`,
    });
  }
  return out;
}

export function effectiveUnitForLine(lineId, promotionResult, fallbackUnit) {
  const id = normId(lineId);
  const row = promotionResult?.byLineId?.get(id);
  if (row && Number(row.unit) >= 0) return roundMoney(row.unit);
  return roundMoney(fallbackUnit);
}
