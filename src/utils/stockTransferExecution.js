import { supabase, PRODUCTS_TABLE, PRODUCTS_STOCK_COLUMN } from '../lib/supabaseClient';
import { getActorDisplayName, insertInventoryLog } from '../lib/inventoryLogs';
import {
  ensureDefaultLocations,
  LOC_TABLE,
  PSL_TABLE,
  syncProductStockCountFromShopLocation,
} from './storeLocations';

const TRANSFERS = 'stock_transfers';
const LINES = 'stock_transfer_lines';

function parseQty(v) {
  const n = Math.floor(Math.max(0, parseFloat(String(v).replace(',', '.')) || 0));
  return n;
}

function isMissingTable(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || '');
  return err.code === 'PGRST205' || err.code === '42P01' || /does not exist|schema cache/i.test(msg);
}

/**
 * @param {object} p
 * @param {string} p.storeId
 * @param {string} p.fromLocationId
 * @param {string} p.toLocationId
 * @param {Array<{ productId: string, qty: number, name?: string, barcode?: string }>} p.lines
 * @param {string} [p.notes]
 */
export async function createStockTransferPending({
  storeId,
  fromLocationId,
  toLocationId,
  lines,
  notes = '',
}) {
  if (!storeId || !fromLocationId || !toLocationId) {
    throw new Error('مواقع غير مكتملة');
  }
  if (fromLocationId === toLocationId) {
    throw new Error('يجب اختيار موقعين مختلفين');
  }
  const clean = (lines || [])
    .map((l) => ({
      productId: l.productId,
      qty: parseQty(l.qty),
      name: l.name,
      barcode: l.barcode,
    }))
    .filter((l) => l.productId && l.qty > 0);

  if (clean.length === 0) {
    throw new Error('أضف سطراً واحداً على الأقل بكمية صحيحة');
  }

  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id ?? null;
  const createdByName = (await getActorDisplayName()) || null;

  const { data: tr, error: tErr } = await supabase
    .from(TRANSFERS)
    .insert([
      {
        store_id: storeId,
        from_location_id: fromLocationId,
        to_location_id: toLocationId,
        status: 'pending_receive',
        notes: String(notes || '').slice(0, 2000),
        created_by: uid,
        created_by_name: createdByName,
      },
    ])
    .select('id')
    .single();

  if (tErr) {
    if (isMissingTable(tErr)) throw new Error('جدول التحويلات غير منشأ — نفّذ stock_transfers.sql في Supabase');
    throw tErr;
  }

  const transferId = tr.id;
  const lineRows = clean.map((l) => ({
    transfer_id: transferId,
    product_id: l.productId,
    quantity: l.qty,
  }));

  const { error: lErr } = await supabase.from(LINES).insert(lineRows);
  if (lErr) throw lErr;

  return { transferId };
}

/**
 * تنفيذ الاستلام: خصم من المصدر، إضافة للوجهة، مزامنة رصيد المحل مع المنتج، سجل مخزن عند تغيّر رصيد المحل.
 */
export async function confirmStockTransferReceive(transferId) {
  if (!transferId) throw new Error('معرّف التحويل مفقود');

  const { data: tr, error: trErr } = await supabase
    .from(TRANSFERS)
    .select('id, store_id, from_location_id, to_location_id, status')
    .eq('id', transferId)
    .single();

  if (trErr) throw trErr;
  if (!tr || tr.status !== 'pending_receive') {
    throw new Error('لا يمكن تأكيد هذا التحويل (غير معلّق للاستلام)');
  }

  const ensured = await ensureDefaultLocations(tr.store_id);
  if (!ensured.ok) {
    throw new Error('جداول المواقع غير جاهزة — نفّذ store_locations.sql و product_stock_locations.sql');
  }

  const shopLocId = ensured.shopLocationId;
  const touchesShop =
    shopLocId &&
    (tr.from_location_id === shopLocId || tr.to_location_id === shopLocId);

  const { data: lines, error: lnErr } = await supabase
    .from(LINES)
    .select('id, product_id, quantity')
    .eq('transfer_id', transferId);

  if (lnErr) throw lnErr;
  if (!lines?.length) throw new Error('لا توجد أسطر للتحويل');

  /** رصيد المحل قبل الحركة — لسجل inventory_logs */
  const shopQtyBefore = new Map();
  if (touchesShop && shopLocId) {
    for (const line of lines) {
      const { data: row } = await supabase
        .from(PSL_TABLE)
        .select('quantity')
        .eq('store_id', tr.store_id)
        .eq('product_id', line.product_id)
        .eq('location_id', shopLocId)
        .maybeSingle();
      shopQtyBefore.set(line.product_id, Number(row?.quantity ?? 0));
    }
  }

  const { data: userData } = await supabase.auth.getUser();
  const receivedBy = userData?.user?.id ?? null;
  const receivedByName = (await getActorDisplayName()) || null;

  for (const line of lines) {
    const qty = parseQty(line.quantity);
    if (qty <= 0) continue;

    const { data: fromRow } = await supabase
      .from(PSL_TABLE)
      .select('id, quantity')
      .eq('store_id', tr.store_id)
      .eq('product_id', line.product_id)
      .eq('location_id', tr.from_location_id)
      .maybeSingle();

    const curFrom = Number(fromRow?.quantity ?? 0);
    if (curFrom < qty) {
      const { data: pr } = await supabase
        .from(PRODUCTS_TABLE)
        .select('eng_name, barcode')
        .eq('id', line.product_id)
        .maybeSingle();
      const label = pr?.eng_name || pr?.barcode || line.product_id;
      throw new Error(`الكمية غير كافية في موقع الإرسال للصنف: ${label} (متوفر ${curFrom})`);
    }

    if (!fromRow?.id) {
      throw new Error('لا يوجد رصيد في موقع الإرسال لهذا الصنف');
    }

    const nextFrom = curFrom - qty;
    const { error: uFrom } = await supabase
      .from(PSL_TABLE)
      .update({ quantity: nextFrom, updated_at: new Date().toISOString() })
      .eq('id', fromRow.id);

    if (uFrom) throw uFrom;

    const { data: toRow } = await supabase
      .from(PSL_TABLE)
      .select('id, quantity')
      .eq('store_id', tr.store_id)
      .eq('product_id', line.product_id)
      .eq('location_id', tr.to_location_id)
      .maybeSingle();

    if (toRow) {
      const nextTo = Number(toRow.quantity ?? 0) + qty;
      const { error: uTo } = await supabase
        .from(PSL_TABLE)
        .update({ quantity: nextTo, updated_at: new Date().toISOString() })
        .eq('id', toRow.id);
      if (uTo) throw uTo;
    } else {
      const { error: insTo } = await supabase.from(PSL_TABLE).insert([
        {
          store_id: tr.store_id,
          product_id: line.product_id,
          location_id: tr.to_location_id,
          quantity: qty,
        },
      ]);
      if (insTo) throw insTo;
    }
  }

  if (touchesShop && shopLocId) {
    for (const line of lines) {
      if (parseQty(line.quantity) <= 0) continue;
      await syncProductStockCountFromShopLocation(tr.store_id, line.product_id, shopLocId);
    }

    for (const line of lines) {
      const qty = parseQty(line.quantity);
      if (qty <= 0) continue;

      const before = shopQtyBefore.get(line.product_id) ?? 0;
      const { data: pr } = await supabase
        .from(PRODUCTS_TABLE)
        .select(`eng_name, barcode, ${PRODUCTS_STOCK_COLUMN}`)
        .eq('id', line.product_id)
        .eq('store_id', tr.store_id)
        .maybeSingle();

      const after = Number(pr?.[PRODUCTS_STOCK_COLUMN] ?? 0);

      await insertInventoryLog({
        storeId: tr.store_id,
        productId: line.product_id,
        barcode: pr?.barcode ?? null,
        productName: pr?.eng_name ? `تحويل مخزني ← ${pr.eng_name}` : 'تحويل مخزني',
        qtyBefore: before,
        qtyAfter: after,
        reason: 'transfer',
      });
    }
  }

  const { error: upTr } = await supabase
    .from(TRANSFERS)
    .update({
      status: 'received',
      received_at: new Date().toISOString(),
      received_by: receivedBy,
      received_by_name: receivedByName,
    })
    .eq('id', transferId)
    .eq('status', 'pending_receive');

  if (upTr) throw upTr;

  return { ok: true };
}

export async function cancelStockTransfer(transferId) {
  if (!transferId) return;
  const { data: tr } = await supabase
    .from(TRANSFERS)
    .select('id, status')
    .eq('id', transferId)
    .maybeSingle();
  if (!tr || tr.status !== 'pending_receive') {
    throw new Error('لا يمكن إلغاء هذا التحويل');
  }
  const { error } = await supabase
    .from(TRANSFERS)
    .update({ status: 'cancelled' })
    .eq('id', transferId)
    .eq('status', 'pending_receive');
  if (error) throw error;
}
