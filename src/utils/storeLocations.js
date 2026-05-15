/**
 * مواقع المخزن (محل / مستودع) وكميات product_stock_locations.
 * رصيد المحل (code=shop) يُزامن مع products[PRODUCTS_STOCK_COLUMN] ليبقى POS متسقاً.
 */
import { supabase, PRODUCTS_TABLE, PRODUCTS_STOCK_COLUMN } from '../lib/supabaseClient';

export const LOC_TABLE = 'store_locations';
export const PSL_TABLE = 'product_stock_locations';

export const SHOP_CODE = 'shop';
export const WAREHOUSE_CODE = 'warehouse';

function isMissingTable(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || '');
  return err.code === 'PGRST205' || err.code === '42P01' || /does not exist|schema cache/i.test(msg);
}

/**
 * يضمن وجود موقع «المحل» و«مستودع خارجي» ثم يملأ أسطر الكميات من عمود المنتج عند الحاجة.
 * @returns {{ ok: boolean, missingTables?: boolean, shopLocationId?: string, warehouseLocationId?: string }}
 */
export async function ensureDefaultLocations(storeId) {
  if (!storeId) return { ok: false, missingTables: true };

  const { data: existing, error: selErr } = await supabase
    .from(LOC_TABLE)
    .select('id, code')
    .eq('store_id', storeId);

  if (selErr && isMissingTable(selErr)) {
    return { ok: false, missingTables: true };
  }
  if (selErr) throw selErr;

  let shopId = (existing || []).find((r) => r.code === SHOP_CODE)?.id;
  let whId = (existing || []).find((r) => r.code === WAREHOUSE_CODE)?.id;
  /** يُشغّل تعبئة PSL لجميع المنتجات مرة واحدة فقط عند إنشاء موقع جديد — لا عند كل حفظ صنف */
  let needFullBackfill = false;

  if (!shopId) {
    const { data: ins, error: e1 } = await supabase
      .from(LOC_TABLE)
      .insert([
        {
          store_id: storeId,
          code: SHOP_CODE,
          name_ar: 'المحل',
          is_sales_location: true,
          sort_order: 0,
        },
      ])
      .select('id')
      .single();
    if (e1 && !isMissingTable(e1)) throw e1;
    if (e1) return { ok: false, missingTables: true };
    shopId = ins?.id;
    needFullBackfill = true;
  }

  if (!whId) {
    const { data: ins2, error: e2 } = await supabase
      .from(LOC_TABLE)
      .insert([
        {
          store_id: storeId,
          code: WAREHOUSE_CODE,
          name_ar: 'مستودع خارجي',
          is_sales_location: false,
          sort_order: 1,
        },
      ])
      .select('id')
      .single();
    if (e2 && !isMissingTable(e2)) throw e2;
    if (e2) return { ok: false, missingTables: true };
    whId = ins2?.id;
    needFullBackfill = true;
  }

  if (needFullBackfill) {
    await backfillProductStockLocations(storeId, shopId, whId);
  }

  return { ok: true, shopLocationId: shopId, warehouseLocationId: whId };
}

async function backfillProductStockLocations(storeId, shopLocationId, warehouseLocationId) {
  if (!shopLocationId || !warehouseLocationId) return;

  const { data: products, error: pErr } = await supabase
    .from(PRODUCTS_TABLE)
    .select(`id, ${PRODUCTS_STOCK_COLUMN}`)
    .eq('store_id', storeId);

  if (pErr || !products?.length) return;

  for (const p of products) {
    const stockVal = Number(p[PRODUCTS_STOCK_COLUMN] ?? 0);
    const { error: u1 } = await supabase.from(PSL_TABLE).upsert(
      [
        {
          store_id: storeId,
          product_id: p.id,
          location_id: shopLocationId,
          quantity: Math.max(0, stockVal),
        },
      ],
      { onConflict: 'store_id,product_id,location_id' }
    );
    if (u1 && !isMissingTable(u1)) console.warn('[product_stock_locations shop]', u1.message);

    const { data: whRow } = await supabase
      .from(PSL_TABLE)
      .select('id')
      .eq('store_id', storeId)
      .eq('product_id', p.id)
      .eq('location_id', warehouseLocationId)
      .maybeSingle();

    if (!whRow) {
      const { error: u2 } = await supabase.from(PSL_TABLE).insert([
        {
          store_id: storeId,
          product_id: p.id,
          location_id: warehouseLocationId,
          quantity: 0,
        },
      ]);
      if (u2 && !isMissingTable(u2)) console.warn('[product_stock_locations wh]', u2.message);
    }
  }
}

/**
 * يضبط سطر المحل ليطابق عمود المنتج (بعد تعديل صنف أو استلام مشتريات).
 */
export async function syncShopLocationStockFromProductRow(storeId, productRow) {
  if (!storeId || !productRow?.id) return;
  const ensured = await ensureDefaultLocations(storeId);
  if (!ensured.ok || !ensured.shopLocationId) return;

  const qty = Math.max(0, Number(productRow[PRODUCTS_STOCK_COLUMN] ?? 0));
  const { error } = await supabase.from(PSL_TABLE).upsert(
    [
      {
        store_id: storeId,
        product_id: productRow.id,
        location_id: ensured.shopLocationId,
        quantity: qty,
      },
    ],
    { onConflict: 'store_id,product_id,location_id' }
  );
  if (error && !isMissingTable(error)) console.warn('[syncShopLocation]', error.message);
}

/**
 * يحدّث عمود المنتج من رصيد موقع المحل.
 */
export async function syncProductStockCountFromShopLocation(storeId, productId, shopLocationId) {
  if (!storeId || !productId || !shopLocationId) return;

  const { data: row } = await supabase
    .from(PSL_TABLE)
    .select('quantity')
    .eq('store_id', storeId)
    .eq('product_id', productId)
    .eq('location_id', shopLocationId)
    .maybeSingle();

  const q = Math.max(0, Number(row?.quantity ?? 0));
  const { error } = await supabase
    .from(PRODUCTS_TABLE)
    .update({ [PRODUCTS_STOCK_COLUMN]: Math.round(q) })
    .eq('id', productId)
    .eq('store_id', storeId);

  if (error && !isMissingTable(error)) console.warn('[syncProductStockCountFromShop]', error.message);
}

export async function syncShopLocationsForProductIds(storeId, productIds) {
  if (!storeId || !productIds?.length) return;
  const ensured = await ensureDefaultLocations(storeId);
  if (!ensured.ok || !ensured.shopLocationId) return;

  const unique = [...new Set(productIds.filter(Boolean))];
  for (const pid of unique) {
    const { data: pr } = await supabase
      .from(PRODUCTS_TABLE)
      .select(`id, ${PRODUCTS_STOCK_COLUMN}`)
      .eq('store_id', storeId)
      .eq('id', pid)
      .maybeSingle();
    if (pr) await syncShopLocationStockFromProductRow(storeId, pr);
  }
}
