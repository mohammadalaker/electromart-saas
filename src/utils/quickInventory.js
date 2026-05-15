/**
 * جرد سريع من الموبايل — بحث بالباركود وتوزيع المواقع وتصحيح الرصيد.
 */
import { supabase, PRODUCTS_TABLE, PRODUCTS_STOCK_COLUMN } from '../lib/supabaseClient';
import { insertInventoryLog } from '../lib/inventoryLogs';
import { normalizeItemFromSupabase, roundMoney, runProductsSelectWithFallback } from './productModel';
import { normalizeDigitsToLatin } from './normalizeDigits';
import { LOC_TABLE, PSL_TABLE, syncShopLocationStockFromProductRow } from './storeLocations';

function isMissingTable(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || '');
  return err.code === 'PGRST205' || err.code === '42P01' || /does not exist|schema cache/i.test(msg);
}

/** بحث صنف بالباركود ضمن المتجر. */
export async function lookupProductByBarcode(storeId, rawBarcode) {
  const barcode = normalizeDigitsToLatin(String(rawBarcode || '').trim());
  if (!storeId || !barcode) return { product: null, raw: null, error: null };

  const { data, error } = await runProductsSelectWithFallback((sel) =>
    supabase
      .from(PRODUCTS_TABLE)
      .select(sel)
      .eq('store_id', storeId)
      .eq('barcode', barcode)
      .maybeSingle()
  );

  if (error) return { product: null, raw: null, error };
  if (!data) return { product: null, raw: null, error: null };

  return { product: normalizeItemFromSupabase(data), raw: data, error: null };
}

/**
 * كميات الصنف حسب موقع التخزين (محل / مستودع …).
 * @returns {{ rows: Array<{ qty: number, name: string, code: string }>, missingTable: boolean, error?: Error }}
 */
export async function fetchStockByLocation(storeId, productId) {
  if (!storeId || !productId) return { rows: [], missingTable: false };

  let data;
  let error;
  const q1 = await supabase
    .from(PSL_TABLE)
    .select('quantity, store_locations(name_ar, code, sort_order)')
    .eq('store_id', storeId)
    .eq('product_id', productId);
  data = q1.data;
  error = q1.error;

  if (error && !isMissingTable(error)) {
    const q2 = await supabase
      .from(PSL_TABLE)
      .select('quantity, location_id')
      .eq('store_id', storeId)
      .eq('product_id', productId);
    if (q2.error) {
      if (isMissingTable(q2.error)) return { rows: [], missingTable: true };
      return { rows: [], missingTable: false, error: q2.error };
    }
    const locIds = [...new Set((q2.data || []).map((r) => r.location_id).filter(Boolean))];
    let locMap = new Map();
    if (locIds.length) {
      const { data: locs, error: le } = await supabase
        .from(LOC_TABLE)
        .select('id, name_ar, code, sort_order')
        .eq('store_id', storeId)
        .in('id', locIds);
      if (!le && locs) locMap = new Map(locs.map((l) => [l.id, l]));
    }
    data = (q2.data || []).map((r) => ({
      quantity: r.quantity,
      store_locations: locMap.get(r.location_id) || null,
    }));
    error = null;
  }

  if (error) {
    if (isMissingTable(error)) return { rows: [], missingTable: true };
    return { rows: [], missingTable: false, error };
  }

  const rows = (data || [])
    .map((r) => {
      const loc = r.store_locations;
      const name = loc?.name_ar || loc?.code || 'موقع';
      return {
        qty: roundMoney(Number(r.quantity ?? 0)),
        name: String(name),
        code: String(loc?.code ?? ''),
        sort: Number(loc?.sort_order ?? 0),
      };
    })
    .sort((a, b) => a.sort - b.sort);

  return { rows, missingTable: false };
}

/**
 * يحدّث رصيد النظام ليطابق العد الفعلي (جرد) ويُسجّل adjustment + يزامن موقع المحل.
 */
export async function applyPhysicalCount(storeId, productRow, previousQty, newQty) {
  if (!storeId || !productRow?.id) throw new Error('بيانات ناقصة');

  const next = Math.max(0, roundMoney(Number(newQty)));
  const prev = roundMoney(Number(previousQty));

  const { data: updated, error } = await runProductsSelectWithFallback((sel) =>
    supabase
      .from(PRODUCTS_TABLE)
      .update({ [PRODUCTS_STOCK_COLUMN]: next })
      .eq('id', productRow.id)
      .eq('store_id', storeId)
      .select(sel)
      .single()
  );

  if (error) throw error;
  if (!updated) throw new Error('لم يُحدَّث الصنف');

  const norm = normalizeItemFromSupabase(updated);
  await insertInventoryLog({
    storeId,
    productId: norm?.id && /^[0-9a-f-]{36}$/i.test(String(norm.id)) ? norm.id : null,
    barcode: norm?.barcode ?? productRow.barcode,
    productName: norm?.name,
    qtyBefore: prev,
    qtyAfter: next,
    reason: 'adjustment',
  });

  await syncShopLocationStockFromProductRow(storeId, updated);

  return normalizeItemFromSupabase(updated);
}
