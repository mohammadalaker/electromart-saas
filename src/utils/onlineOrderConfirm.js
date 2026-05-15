/**
 * تأكيد طلب أونلاين: خصم مخزون + تسجيل حركات + إيراد كاش (عند الاستلام بعد التأكيد).
 */
import { PRODUCTS_TABLE } from '../lib/supabaseClient';
import { insertInventoryLog } from '../lib/inventoryLogs';
import { applyCashSaleToMainCashFund } from './saleAccounting';
import { isUuid, roundMoney } from './productModel';

function parseLineItems(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ saleId: string, storeId: string }} p
 */
export async function confirmPendingOnlineSale(supabase, { saleId, storeId }) {
  const { data: sale, error: fetchErr } = await supabase
    .from('sales')
    .select('id, store_id, line_items, total_amount, order_status, payment_mode, returned_at')
    .eq('id', saleId)
    .eq('store_id', storeId)
    .single();

  if (fetchErr) throw fetchErr;
  if (!sale) throw new Error('لم يُعثر على الفاتورة');
  if (sale.returned_at) throw new Error('الفاتورة مرتجعة');
  const st = sale.order_status ?? 'confirmed';
  if (st !== 'pending_online') throw new Error('هذه الفاتورة ليست طلباً بانتظار التأكيد');

  const lines = parseLineItems(sale.line_items);
  if (lines.length === 0) throw new Error('لا توجد أسطر في الفاتورة');

  const productIds = [
    ...new Set(
      lines.map((l) => l.product_id).filter((id) => id && isUuid(String(id)))
    ),
  ];
  const namesById = new Map();
  if (productIds.length) {
    const { data: prows, error: pe } = await supabase
      .from(PRODUCTS_TABLE)
      .select('id, eng_name')
      .eq('store_id', storeId)
      .in('id', productIds);
    if (pe) throw pe;
    (prows || []).forEach((r) => namesById.set(String(r.id), (r.eng_name ?? '').toString().trim()));
  }

  for (const line of lines) {
    const qty = Math.max(1, Number(line.qty) || 1);
    const pid = line.product_id && isUuid(String(line.product_id)) ? String(line.product_id) : null;
    const barcodeStr = String(line.barcode ?? '').trim();
    const itemName = pid ? namesById.get(pid) || '' : '';

    if (pid) {
      const { data: row0, error: sel0 } = await supabase
        .from(PRODUCTS_TABLE)
        .select('stock_count')
        .eq('id', pid)
        .eq('store_id', storeId)
        .single();
      if (sel0) throw sel0;
      const prevStock = Number(row0?.stock_count ?? 0);
      if (prevStock < qty) {
        throw new Error(
          `المخزون لا يكفي للصنف (${barcodeStr || pid}). المتاح: ${prevStock} والمطلوب: ${qty}`
        );
      }

      let newStock = prevStock;
      const { error: rpcError } = await supabase.rpc('decrement_stock', {
        row_id: pid,
        amount: qty,
      });
      if (rpcError) {
        newStock = Math.max(0, prevStock - qty);
        const { error: upErr } = await supabase
          .from(PRODUCTS_TABLE)
          .update({ stock_count: newStock })
          .eq('id', pid)
          .eq('store_id', storeId);
        if (upErr) throw upErr;
      } else {
        newStock = Math.max(0, prevStock - qty);
      }

      await insertInventoryLog({
        storeId,
        productId: pid,
        barcode: barcodeStr || null,
        productName: itemName,
        qtyBefore: prevStock,
        qtyAfter: newStock,
        reason: 'sale',
      });
    } else if (barcodeStr) {
      const { data: row, error: selErr } = await supabase
        .from(PRODUCTS_TABLE)
        .select('stock_count')
        .eq('barcode', barcodeStr)
        .eq('store_id', storeId)
        .single();
      if (selErr) throw selErr;
      const prevStock = Number(row?.stock_count ?? 0);
      if (prevStock < qty) {
        throw new Error(`المخزون لا يكفي للباركود ${barcodeStr}`);
      }
      const newStock = Math.max(0, prevStock - qty);
      const { error: upErr } = await supabase
        .from(PRODUCTS_TABLE)
        .update({ stock_count: newStock })
        .eq('barcode', barcodeStr)
        .eq('store_id', storeId);
      if (upErr) throw upErr;

      await insertInventoryLog({
        storeId,
        productId: null,
        barcode: barcodeStr,
        productName: itemName,
        qtyBefore: prevStock,
        qtyAfter: newStock,
        reason: 'sale',
      });
    } else {
      throw new Error('سطر فاتورة بدون معرّف صنف صالح');
    }
  }

  const total = roundMoney(Number(sale.total_amount ?? 0));
  const paymentMode = sale.payment_mode ?? 'cash';

  if (paymentMode === 'cash' && total > 0) {
    try {
      await applyCashSaleToMainCashFund(supabase, {
        storeId,
        saleId,
        totalAmount: total,
        sourceLabel: 'تأكيد طلب أونلاين',
      });
    } catch (e) {
      console.warn('[onlineOrderConfirm] صندوق الكاش:', e);
    }
  }

  const { error: upErr } = await supabase
    .from('sales')
    .update({ order_status: 'confirmed' })
    .eq('id', saleId)
    .eq('store_id', storeId);
  if (upErr) throw upErr;

  return { ok: true };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ saleId: string, storeId: string }} p
 */
export async function cancelPendingOnlineSale(supabase, { saleId, storeId }) {
  const { data: sale, error: fetchErr } = await supabase
    .from('sales')
    .select('id, order_status, returned_at')
    .eq('id', saleId)
    .eq('store_id', storeId)
    .single();
  if (fetchErr) throw fetchErr;
  if (!sale || sale.returned_at) throw new Error('لا يمكن إلغاء هذه الفاتورة');
  if ((sale.order_status ?? 'confirmed') !== 'pending_online') {
    throw new Error('هذه الفاتورة ليست طلباً بانتظار التأكيد');
  }
  let { error } = await supabase
    .from('sales')
    .update({ order_status: 'cancelled' })
    .eq('id', saleId)
    .eq('store_id', storeId);
  if (error && /order_status|column|schema|PGRST204/i.test(String(error.message || ''))) {
    error = { message: 'عمود حالة الطلب غير متوفر — نفّذ هجرة قاعدة البيانات' };
  }
  if (error) throw error;
  return { ok: true };
}
