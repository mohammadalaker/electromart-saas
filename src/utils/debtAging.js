/**
 * تقرير أعمار الذمم (مدين الزبائن): تجميع المستحق حسب مدة انفتاح الدين.
 * يعتمد على FIFO: دفتر customer_ledger إن وُجد، وإلا فواتير البيع بالذمة من sales.
 */
import { roundMoney } from './productModel';

const CONTACTS = 'store_contacts';
const LEDGER = 'customer_ledger';
const SALES = 'sales';

export const BUCKET_KEYS = ['b0_30', 'b31_60', 'b61_90', 'b90_plus'];

export const BUCKET_LABELS_AR = {
  b0_30: 'حتى 30 يوماً',
  b31_60: '31–60 يوماً',
  b61_90: '61–90 يوماً',
  b90_plus: 'أكثر من 90 يوماً',
};

function emptyBuckets() {
  return { b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0 };
}

function isMissingTable(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || '');
  return err.code === 'PGRST205' || err.code === '42P01' || /does not exist|schema cache/i.test(msg);
}

/** عدد الأيام من تاريخ الحركة حتى تاريخ التقرير (بداية اليوم لكليهما). */
export function daysSinceTransaction(txDate, asOf) {
  const t0 = new Date(txDate);
  const t1 = new Date(asOf);
  t0.setHours(0, 0, 0, 0);
  t1.setHours(0, 0, 0, 0);
  const d = Math.floor((t1.getTime() - t0.getTime()) / 86400000);
  return Math.max(0, d);
}

export function bucketKeyForDays(days) {
  if (days <= 30) return 'b0_30';
  if (days <= 60) return 'b31_60';
  if (days <= 90) return 'b61_90';
  return 'b90_plus';
}

/**
 * طبقات مدين مفتوحة بعد تطبيق الدائنات على الأقدم أولاً (FIFO).
 * @param {Array<{ type: 'debit'|'credit', amount: number, at: Date }>} entries
 */
export function fifoOpenDebitLayers(entries) {
  const sorted = [...entries].sort((a, b) => a.at - b.at);
  const layers = [];
  for (const e of sorted) {
    const amt = roundMoney(Math.max(0, Number(e.amount) || 0));
    if (amt < 0.005) continue;
    if (e.type === 'debit') {
      layers.push({ amount: amt, at: e.at });
    } else if (e.type === 'credit') {
      let c = amt;
      while (c > 0.005 && layers.length) {
        const L = layers[0];
        const take = roundMoney(Math.min(c, L.amount));
        L.amount = roundMoney(L.amount - take);
        c = roundMoney(c - take);
        if (L.amount < 0.005) layers.shift();
      }
    }
  }
  return layers.filter((l) => l.amount > 0.005);
}

function scaleLayersToBalance(layers, targetBalance) {
  const t = roundMoney(Math.max(0, Number(targetBalance) || 0));
  const sum = roundMoney(layers.reduce((s, l) => s + l.amount, 0));
  if (sum < 0.005 || t < 0.005) return [];
  if (Math.abs(sum - t) < 0.02) return layers.map((l) => ({ ...l, amount: roundMoney(l.amount) }));
  const k = t / sum;
  return layers.map((l) => ({ ...l, amount: roundMoney(l.amount * k) }));
}

/** أقدم فواتير ذمة غير مرتجعة، تصاعدياً */
function fifoLayersFromSales(salesAsc, outstanding) {
  const layers = [];
  let rem = roundMoney(Math.max(0, Number(outstanding) || 0));
  for (const s of salesAsc) {
    if (rem < 0.005) break;
    const line = roundMoney(Math.max(0, Number(s.total_amount) || 0));
    if (line < 0.005) continue;
    const take = roundMoney(Math.min(rem, line));
    layers.push({ amount: take, at: new Date(s.created_at) });
    rem = roundMoney(rem - take);
  }
  if (rem > 0.05) {
    const anchor = salesAsc.length
      ? new Date(salesAsc[0].created_at)
      : new Date();
    layers.push({ amount: rem, at: anchor });
  }
  return layers.filter((l) => l.amount > 0.005);
}

function layersToBucketTotals(layers, asOf) {
  const out = emptyBuckets();
  for (const layer of layers) {
    const days = daysSinceTransaction(layer.at, asOf);
    const key = bucketKeyForDays(days);
    out[key] = roundMoney(out[key] + layer.amount);
  }
  return out;
}

/**
 * @returns {Promise<{
 *   rows: Array<{
 *     customerId: string,
 *     name: string,
 *     phone: string | null,
 *     outstanding: number,
 *     buckets: typeof emptyBuckets,
 *     source: 'ledger'|'sales'|'scaled'
 *   }>,
 *   totals: typeof emptyBuckets,
 *   grandTotal: number,
 *   ledgerAvailable: boolean,
 *   asOf: string
 * }>}
 */
export async function computeReceivablesAgingForStore(supabase, storeId, asOf = new Date()) {
  const asOfIso = new Date(asOf).toISOString();

  const { data: contacts, error: cErr } = await supabase
    .from(CONTACTS)
    .select('id, name, phone, outstanding_amount')
    .eq('store_id', storeId)
    .eq('role', 'customer')
    .eq('payment_type', 'credit');

  if (cErr) throw cErr;

  const debtors = (contacts || []).filter((c) => Number(c.outstanding_amount ?? 0) > 0.005);
  const ids = debtors.map((c) => c.id);
  if (ids.length === 0) {
    return {
      rows: [],
      totals: emptyBuckets(),
      grandTotal: 0,
      ledgerAvailable: false,
      asOf: asOfIso,
    };
  }

  let ledgerRows = [];
  let ledgerAvailable = true;
  const { data: ledData, error: lErr } = await supabase
    .from(LEDGER)
    .select('customer_id, debit, credit, created_at')
    .eq('store_id', storeId)
    .in('customer_id', ids)
    .order('created_at', { ascending: true });

  if (lErr && isMissingTable(lErr)) {
    ledgerAvailable = false;
  } else if (lErr) {
    throw lErr;
  } else {
    ledgerRows = ledData || [];
  }

  const { data: saleData, error: sErr } = await supabase
    .from(SALES)
    .select('id, contact_id, total_amount, created_at, payment_mode, returned_at')
    .eq('store_id', storeId)
    .eq('payment_mode', 'credit')
    .is('returned_at', null)
    .in('contact_id', ids)
    .order('created_at', { ascending: true });

  if (sErr) throw sErr;
  const salesList = saleData || [];

  const byCustomerSales = new Map();
  for (const s of salesList) {
    const cid = s.contact_id;
    if (!cid) continue;
    if (!byCustomerSales.has(cid)) byCustomerSales.set(cid, []);
    byCustomerSales.get(cid).push(s);
  }

  const byCustomerLedger = new Map();
  for (const row of ledgerRows) {
    const cid = row.customer_id;
    if (!byCustomerLedger.has(cid)) byCustomerLedger.set(cid, []);
    byCustomerLedger.get(cid).push(row);
  }

  const rows = [];

  for (const c of debtors) {
    const outstanding = roundMoney(Number(c.outstanding_amount ?? 0));
    let layers = [];
    let source = 'sales';

    if (ledgerAvailable) {
      const raw = byCustomerLedger.get(c.id) || [];
      const entries = [];
      for (const r of raw) {
        const d = Number(r.debit ?? 0);
        const cr = Number(r.credit ?? 0);
        if (d > 0.005) {
          entries.push({ type: 'debit', amount: d, at: new Date(r.created_at) });
        } else if (cr > 0.005) {
          entries.push({ type: 'credit', amount: cr, at: new Date(r.created_at) });
        }
      }
      layers = fifoOpenDebitLayers(entries);
      const sumL = roundMoney(layers.reduce((s, x) => s + x.amount, 0));
      source = 'ledger';
      if (layers.length && Math.abs(sumL - outstanding) > 0.05) {
        layers = scaleLayersToBalance(layers, outstanding);
        source = 'scaled';
      }
      if (layers.length === 0 && outstanding > 0.05) {
        const salesAsc = byCustomerSales.get(c.id) || [];
        layers = fifoLayersFromSales(salesAsc, outstanding);
        source = 'sales';
      }
    } else {
      const salesAsc = byCustomerSales.get(c.id) || [];
      layers = fifoLayersFromSales(salesAsc, outstanding);
      source = 'sales';
    }

    const buckets = layersToBucketTotals(layers, asOf);
    rows.push({
      customerId: c.id,
      name: c.name || '—',
      phone: c.phone ?? null,
      outstanding,
      buckets,
      source,
    });
  }

  rows.sort((a, b) => b.outstanding - a.outstanding);

  const totals = emptyBuckets();
  for (const r of rows) {
    for (const k of BUCKET_KEYS) {
      totals[k] = roundMoney(totals[k] + r.buckets[k]);
    }
  }
  const grandTotal = roundMoney(BUCKET_KEYS.reduce((s, k) => s + totals[k], 0));

  return {
    rows,
    totals,
    grandTotal,
    ledgerAvailable,
    asOf: asOfIso,
  };
}
