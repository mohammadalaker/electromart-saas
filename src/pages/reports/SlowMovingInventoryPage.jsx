import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, PackageMinus, RefreshCw, ExternalLink, AlertTriangle, Ban } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { supabase, PRODUCTS_TABLE } from '../../lib/supabaseClient';
import { useStore } from '../../context/StoreContext';
import { roundMoney } from '../../utils/productModel';

const NEVER_SOLD_DAYS = 99999;

function parseLineItems(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }
  return [];
}

function formatMoney(n) {
  return roundMoney(Number(n ?? 0)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function daysSince(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24)));
}

function formatDateAr(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

function unitCost(product) {
  const cost = Number(product.full_price);
  if (Number.isFinite(cost) && cost > 0) return cost;
  const sell = Number(product.price_after_disc);
  if (Number.isFinite(sell) && sell > 0) return sell;
  return 0;
}

async function fetchLastSaleMap(storeId) {
  const map = new Map();
  const pageSize = 1000;
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('sales_items')
      .select('product_id, sales!inner(created_at)')
      .eq('store_id', storeId)
      .not('product_id', 'is', null)
      .range(from, from + pageSize - 1);

    if (error) {
      if (!/does not exist|schema|PGRST205|42P01/i.test(String(error.message || ''))) {
        throw error;
      }
      break;
    }
    if (!data?.length) break;

    for (const row of data) {
      const pid = row.product_id;
      const ts = row.sales?.created_at;
      if (!pid || !ts) continue;
      const prev = map.get(pid);
      if (!prev || new Date(ts) > new Date(prev)) map.set(pid, ts);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  let salesFrom = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('sales')
      .select('created_at, line_items, returned_at')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .range(salesFrom, salesFrom + pageSize - 1);

    if (error) throw error;
    if (!data?.length) break;

    for (const sale of data) {
      if (sale.returned_at) continue;
      for (const line of parseLineItems(sale.line_items)) {
        const pid = line.product_id;
        if (!pid) continue;
        const prev = map.get(pid);
        if (!prev || new Date(sale.created_at) > new Date(prev)) {
          map.set(pid, sale.created_at);
        }
      }
    }
    if (data.length < pageSize) break;
    salesFrom += pageSize;
    if (salesFrom >= 5000) break;
  }

  return map;
}

export default function SlowMovingInventoryPage() {
  const { store, loading: storeLoading } = useStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [threshold, setThreshold] = useState(60);
  const [sortBy, setSortBy] = useState('oldest');

  const loadData = useCallback(async () => {
    if (!store?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const lastSaleMap = await fetchLastSaleMap(store.id);
      const saleMap = lastSaleMap instanceof Map ? lastSaleMap : new Map();

      const { data: products, error: pErr } = await supabase
        .from(PRODUCTS_TABLE)
        .select('id, eng_name, barcode, stock_count, full_price, price_after_disc, reference, brand_group')
        .eq('store_id', store.id)
        .gt('stock_count', 0)
        .limit(5000);

      if (pErr) throw pErr;

      const enriched = (products || []).map((p) => {
        const qty = Math.max(0, Number(p.stock_count ?? 0));
        const lastSaleAt = saleMap.get(p.id) || null;
        const neverSold = !lastSaleAt;
        const days = neverSold ? NEVER_SOLD_DAYS : daysSince(lastSaleAt);
        const frozen = roundMoney(qty * unitCost(p));
        return {
          id: p.id,
          name: p.eng_name || p.reference || p.barcode || '—',
          barcode: p.barcode || '',
          qty,
          frozenValue: frozen,
          lastSaleAt,
          neverSold,
          daysSinceSale: days,
        };
      });

      setRows(enriched);
    } catch (e) {
      setError(e.message || 'تعذّر تحميل بيانات المخزون الراكد');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    void loadData();
  }, [storeLoading, loadData]);

  const filtered = useMemo(() => {
    const list = rows.filter((r) => r.neverSold || (r.daysSinceSale ?? 0) >= threshold);
    if (sortBy === 'value') {
      return [...list].sort((a, b) => b.frozenValue - a.frozenValue);
    }
    return [...list].sort((a, b) => b.daysSinceSale - a.daysSinceSale);
  }, [rows, threshold, sortBy]);

  const summary = useMemo(() => {
    const list = filtered;
    return {
      count: list.length,
      frozenTotal: roundMoney(list.reduce((s, r) => s + r.frozenValue, 0)),
      neverSold: list.filter((r) => r.neverSold).length,
    };
  }, [filtered]);

  if (storeLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="animate-spin text-indigo-500" size={40} />
        </div>
      </DashboardLayout>
    );
  }

  if (!store?.id) {
    return (
      <DashboardLayout>
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-6 py-10 text-center font-bold text-amber-950" dir="rtl">
          لا يوجد متجر مرتبط بحسابك.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-100">
              <PackageMinus className="h-6 w-6 text-orange-600" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900">المنتجات الراكدة</h1>
              <p className="text-sm text-slate-500">أصناف بمخزون متبقٍ دون مبيعات حديثة</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">عدد المنتجات الراكدة</p>
            <p className="mt-2 text-3xl font-black text-slate-900">{summary.count}</p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">القيمة المجمدة بالمخزون</p>
            <p className="mt-2 text-3xl font-black text-orange-700" dir="ltr">
              ₪ {formatMoney(summary.frozenTotal)}
            </p>
          </div>
          <div className="rounded-2xl border border-red-100 bg-red-50 p-5 shadow-sm">
            <p className="flex items-center gap-1.5 text-sm text-red-700">
              <Ban size={14} />
              لم تُبع مطلقاً
            </p>
            <p className="mt-2 text-3xl font-black text-red-700">{summary.neverSold}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-bold text-slate-500">عتبة الأيام:</span>
            {[60, 90, 120].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setThreshold(d)}
                className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${
                  threshold === d
                    ? 'bg-indigo-600 text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {d} يوم
              </button>
            ))}
            <div className="mr-auto flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-500">ترتيب:</span>
              <button
                type="button"
                onClick={() => setSortBy('oldest')}
                className={`rounded-xl px-3 py-1.5 text-xs font-black ${
                  sortBy === 'oldest' ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-700'
                }`}
              >
                الأقدم
              </button>
              <button
                type="button"
                onClick={() => setSortBy('value')}
                className={`rounded-xl px-3 py-1.5 text-xs font-black ${
                  sortBy === 'value' ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-700'
                }`}
              >
                الأعلى قيمة
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-indigo-500" size={36} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm font-bold text-slate-400">
              لا توجد منتجات راكدة ضمن العتبة المختارة
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80">
                    <th className="py-3.5 px-4 text-right text-xs font-bold text-slate-600">المنتج</th>
                    <th className="py-3.5 px-4 text-right text-xs font-bold text-slate-600">الكمية المتبقية</th>
                    <th className="py-3.5 px-4 text-right text-xs font-bold text-slate-600">القيمة المجمدة</th>
                    <th className="py-3.5 px-4 text-right text-xs font-bold text-slate-600">آخر بيع</th>
                    <th className="py-3.5 px-4 text-right text-xs font-bold text-slate-600">عدد الأيام منذ آخر بيع</th>
                    <th className="py-3.5 px-4 text-right text-xs font-bold text-slate-600">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const daysClass = row.neverSold || row.daysSinceSale > 120
                      ? 'text-red-600 font-black'
                      : row.daysSinceSale >= 60
                        ? 'text-amber-700 font-bold'
                        : 'text-slate-600';
                    return (
                      <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                        <td className="py-3.5 px-4">
                          <div className="text-sm font-bold text-slate-800">{row.name}</div>
                          {row.barcode && (
                            <div className="text-[11px] font-mono text-slate-400" dir="ltr">
                              {row.barcode}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-sm text-slate-700" dir="ltr">
                          {row.qty}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-sm font-bold text-slate-900" dir="ltr">
                          ₪ {formatMoney(row.frozenValue)}
                        </td>
                        <td className="py-3.5 px-4 text-sm">
                          {row.neverSold ? (
                            <span className="font-black text-red-600">لم يُبع مطلقاً</span>
                          ) : (
                            <span className="text-slate-600">{formatDateAr(row.lastSaleAt)}</span>
                          )}
                        </td>
                        <td className={`py-3.5 px-4 text-sm ${daysClass}`} dir="ltr">
                          {row.neverSold ? (
                            <span className="inline-flex items-center gap-1">
                              <AlertTriangle size={14} />
                              —
                            </span>
                          ) : (
                            row.daysSinceSale
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <Link
                            to={
                              row.barcode
                                ? `/inventory?barcode=${encodeURIComponent(row.barcode)}`
                                : '/inventory'
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-black text-indigo-700 hover:bg-indigo-100"
                          >
                            <ExternalLink size={13} />
                            عرض المنتج
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
