import { supabase } from '../lib/supabaseClient';
import { roundMoney } from './productModel';

export const PRE_ORDERS_TABLE = 'pre_orders';
export const PRE_ORDER_LINES_TABLE = 'pre_order_lines';

export const PRE_ORDER_STATUS_AR = {
  open: 'مفتوح',
  deposit_paid: 'عربون محصّل',
  fulfilled: 'مُنجز',
  cancelled: 'ملغى',
};

/**
 * حجوزات معلّقة لأصناف معيّنة (للتنبيه في فاتورة المشتريات).
 * @param {string} storeId
 * @param {string[]} productIds
 * @returns {Promise<Array<{
 *   lineId: string,
 *   preOrderId: string,
 *   orderNo: number,
 *   productId: string,
 *   qty: number,
 *   customerName: string,
 *   customerPhone: string | null
 * }>>}
 */
export async function fetchPendingReservationsForProducts(storeId, productIds) {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!storeId || ids.length === 0) return [];

  const { data: lines, error: le } = await supabase
    .from(PRE_ORDER_LINES_TABLE)
    .select('id, pre_order_id, product_id, qty, line_status')
    .in('product_id', ids)
    .eq('line_status', 'pending');

  if (le || !lines?.length) return [];

  const orderIds = [...new Set(lines.map((l) => l.pre_order_id))];
  const { data: orders, error: oe } = await supabase
    .from(PRE_ORDERS_TABLE)
    .select('id, order_no, status, store_id, contact_id')
    .eq('store_id', storeId)
    .in('id', orderIds)
    .in('status', ['open', 'deposit_paid']);

  if (oe || !orders?.length) return [];

  const orderMap = new Map(orders.map((o) => [o.id, o]));
  const contactIds = [...new Set(orders.map((o) => o.contact_id).filter(Boolean))];
  const { data: contacts } = await supabase
    .from('store_contacts')
    .select('id, name, phone')
    .in('id', contactIds);

  const contactMap = new Map((contacts || []).map((c) => [c.id, c]));

  const out = [];
  for (const ln of lines) {
    const o = orderMap.get(ln.pre_order_id);
    if (!o) continue;
    const c = contactMap.get(o.contact_id);
    out.push({
      lineId: ln.id,
      preOrderId: o.id,
      orderNo: o.order_no,
      productId: ln.product_id,
      qty: ln.qty,
      customerName: c?.name || 'زبون',
      customerPhone: c?.phone ?? null,
    });
  }
  return out;
}

export async function getNextPreOrderNo(storeId) {
  const { data, error } = await supabase
    .from(PRE_ORDERS_TABLE)
    .select('order_no')
    .eq('store_id', storeId)
    .order('order_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return (data?.order_no ?? 0) + 1;
}

export function groupReservationsByProduct(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.productId)) m.set(r.productId, []);
    m.get(r.productId).push(r);
  }
  return m;
}
