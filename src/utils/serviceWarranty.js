import { supabase } from '../lib/supabaseClient';

export const TICKETS_TABLE = 'service_warranty_tickets';

export const STATUS_LABELS_AR = {
  intake: 'استلام',
  inspecting: 'قيد الفحص',
  waiting_parts: 'بانتظار قطع غيار',
  repaired: 'تم الإصلاح',
  ready_pickup: 'جاهز للتسليم',
  delivered: 'تم التسليم',
  cancelled: 'ملغاة',
};

/** أول رقم تذكرة تالي للمتجر */
export async function getNextTicketNo(storeId) {
  const { data, error } = await supabase
    .from(TICKETS_TABLE)
    .select('ticket_no')
    .eq('store_id', storeId)
    .order('ticket_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return (data?.ticket_no ?? 0) + 1;
}

/**
 * محاولة إيجاد فاتورة بيع تحتوي السيريال في sales_items.serial_numbers أو نص الملاحظات.
 */
export async function lookupSaleBySerial(storeId, serialRaw) {
  const serial = String(serialRaw || '').trim();
  if (!serial || !storeId) return null;

  const { data: lines, error: e1 } = await supabase
    .from('sales_items')
    .select('sale_id, product_id, serial_numbers')
    .eq('store_id', storeId);

  if (!e1 && lines?.length) {
    const norm = serial.replace(/\s/g, '').toLowerCase();
    for (const row of lines) {
      const sn = String(row.serial_numbers || '');
      const parts = sn.split(/[\n,;،]+/).map((s) => s.trim()).filter(Boolean);
      const hit = parts.some((p) => p.replace(/\s/g, '').toLowerCase() === norm);
      if (hit) {
        const { data: sale, error: e2 } = await supabase
          .from('sales')
          .select('id, created_at, notes, contact_id')
          .eq('id', row.sale_id)
          .eq('store_id', storeId)
          .maybeSingle();
        if (!e2 && sale) {
          return {
            sale_id: sale.id,
            sale_date: sale.created_at ? String(sale.created_at).slice(0, 10) : null,
            product_id: row.product_id,
            notes: sale.notes,
            contact_id: sale.contact_id ?? null,
          };
        }
      }
    }
  }

  const { data: sales, error: e3 } = await supabase
    .from('sales')
    .select('id, created_at, notes, contact_id')
    .eq('store_id', storeId)
    .ilike('notes', `%${serial}%`)
    .order('created_at', { ascending: false })
    .limit(3);

  if (!e3 && sales?.length) {
    const s = sales[0];
    return {
      sale_id: s.id,
      sale_date: s.created_at ? String(s.created_at).slice(0, 10) : null,
      product_id: null,
      notes: s.notes,
      contact_id: s.contact_id ?? null,
    };
  }

  return null;
}

function digitsOnly(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * رابط واتساب لإبلاغ الزبون أن الجهاز جاهز (يفتح من المتصفح / الهاتف).
 */
export function buildWhatsAppReadyUrl(phone, { ticketNo, serial, storeName } = {}) {
  const n = digitsOnly(phone);
  if (!n) return null;
  const msg = [
    'السلام عليكم،',
    storeName ? `من ${storeName}:` : '',
    `تذكرة صيانة رقم ${ticketNo ?? '—'}`,
    serial ? `السيريال: ${serial}` : '',
    'الجهاز جاهز للاستلام. نرجو التنسيق لاستلامه.',
  ]
    .filter(Boolean)
    .join('\n');
  const enc = encodeURIComponent(msg);
  return `https://wa.me/${n}?text=${enc}`;
}
