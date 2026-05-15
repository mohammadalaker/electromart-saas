/**
 * تحويل حجز مسبق إلى فاتورة بيع (مثل تحويل عرض سعر في Odoo).
 * يخصم المخزون، يُنشئ sales + sales_items، ويحدّث الصندوق أو الذمة حسب paymentMode.
 */
import { PRODUCTS_TABLE, supabase } from '../lib/supabaseClient';
import { insertInventoryLog } from '../lib/inventoryLogs';
import { applyCashSaleToMainCashFund } from './saleAccounting';
import { isUuid, roundMoney } from './productModel';

const SALES_TABLE = 'sales';
const SALES_ITEMS_TABLE = 'sales_items';
const PRE_ORDERS_TABLE = 'pre_orders';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {{
 *   storeId: string,
 *   preOrder: { id: string, contact_id: string, grand_total: number, order_no: number, notes?: string },
 *   lines: Array<{ product_id: string, qty: number, unit_price: number }>,
 *   paymentMode: 'cash' | 'credit',
 * }} p
 */
export async function convertPreOrderToSale(client, { storeId, preOrder, lines, paymentMode }) {
  if (!storeId || !preOrder?.id || !preOrder.contact_id) {
    throw new Error('بيانات الحجز ناقصة');
  }
  const pm = paymentMode === 'credit' ? 'credit' : 'cash';
  const total = roundMoney(Number(preOrder.grand_total) || 0);
  if (total <= 0) throw new Error('إجمالي الحجز غير صالح');

  const cleanLines = (lines || []).filter((l) => l.product_id && isUuid(String(l.product_id)));
  if (!cleanLines.length) throw new Error('لا توجد أسطر بصنف صالح');

  const productIds = [...new Set(cleanLines.map((l) => String(l.product_id)))];
  const { data: prows, error: pe } = await client
    .from(PRODUCTS_TABLE)
    .select('id, eng_name, barcode, stock_count')
    .eq('store_id', storeId)
    .in('id', productIds);
  if (pe) throw pe;
  const byId = new Map((prows || []).map((r) => [String(r.id), r]));

  const saleLineItems = cleanLines.map((l) => {
    const pid = String(l.product_id);
    const p = byId.get(pid);
    const q = Math.max(1, Math.floor(Number(l.qty) || 1));
    const unit = roundMoney(Number(l.unit_price) || 0);
    return {
      product_id: pid,
      barcode: String(p?.barcode ?? ''),
      qty: q,
      unit_price: unit,
      line_total: roundMoney(unit * q),
    };
  });

  const notes =
    `فاتورة من حجز مسبق #${preOrder.order_no}. ${String(preOrder.notes || '').trim()}`.trim().slice(0, 2000);

  const base = {
    store_id: storeId,
    total_amount: total,
    notes,
    line_items: saleLineItems,
    contact_id: preOrder.contact_id,
    payment_mode: pm,
  };

  let saleId = null;
  let lastErr = null;
  for (const row of [base, { ...base, line_items: saleLineItems }]) {
    const { data, error } = await client.from(SALES_TABLE).insert([row]).select('id').maybeSingle();
    if (!error && data?.id) {
      saleId = data.id;
      break;
    }
    lastErr = error;
  }
  if (!saleId) throw lastErr || new Error('فشل إنشاء فاتورة المبيعات');

  const itemRows = saleLineItems.map((line) => ({
    sale_id: saleId,
    store_id: storeId,
    product_id: line.product_id,
    barcode: line.barcode,
    qty: line.qty,
    unit_price: line.unit_price,
    line_total: line.line_total,
  }));
  const { error: itemsErr } = await client.from(SALES_ITEMS_TABLE).insert(itemRows);
  if (itemsErr) console.warn('[preOrderToSale] sales_items:', itemsErr.message);

  for (const line of saleLineItems) {
    const pid = line.product_id;
    const p = byId.get(pid);
    const name = (p?.eng_name ?? '').toString().trim();
    const qty = line.qty;
    const { data: row0, error: sel0 } = await client
      .from(PRODUCTS_TABLE)
      .select('stock_count')
      .eq('id', pid)
      .eq('store_id', storeId)
      .single();
    if (sel0) throw sel0;
    const prevStock = Number(row0?.stock_count ?? 0);
    if (prevStock < qty) {
      throw new Error(`المخزون لا يكفي للصنف ${name || pid}. المتاح ${prevStock} والمطلوب ${qty}`);
    }
    let newStock = prevStock;
    const { error: rpcError } = await client.rpc('decrement_stock', { row_id: pid, amount: qty });
    if (rpcError) {
      newStock = Math.max(0, prevStock - qty);
      const { error: upErr } = await client
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
      barcode: line.barcode || null,
      productName: name,
      qtyBefore: prevStock,
      qtyAfter: newStock,
      reason: 'sale',
    });
  }

  if (pm === 'cash') {
    try {
      await applyCashSaleToMainCashFund(client, {
        storeId,
        saleId,
        totalAmount: total,
        sourceLabel: `حجز #${preOrder.order_no}`,
      });
    } catch (e) {
      console.warn('[preOrderToSale] صندوق:', e);
    }
  } else {
    const { data: cRow, error: cSelErr } = await client
      .from('store_contacts')
      .select('outstanding_amount')
      .eq('id', preOrder.contact_id)
      .eq('store_id', storeId)
      .eq('role', 'customer')
      .maybeSingle();
    if (cSelErr) throw cSelErr;
    if (!cRow) throw new Error('الزبون غير موجود في الدليل');
    const nextBal = Math.max(0, Number(cRow.outstanding_amount ?? 0)) + total;
    const { error: cUpErr } = await client
      .from('store_contacts')
      .update({ outstanding_amount: nextBal, payment_type: 'credit' })
      .eq('id', preOrder.contact_id)
      .eq('store_id', storeId);
    if (cUpErr) throw cUpErr;
    await client.from('customer_ledger').insert([
      {
        store_id: storeId,
        customer_id: preOrder.contact_id,
        sale_id: saleId,
        debit: total,
        credit: 0,
        description: `بيع بالذمة — من حجز #${preOrder.order_no} — فاتورة ${String(saleId).slice(0, 8)}`,
      },
    ]);
  }

  await client
    .from(PRE_ORDERS_TABLE)
    .update({
      status: 'fulfilled',
      converted_sale_id: saleId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', preOrder.id)
    .eq('store_id', storeId);

  return { saleId, paymentMode: pm };
}
