import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  BarChart2,
  TrendingUp,
  TrendingDown,
  Minus,
  ShoppingCart,
  Receipt,
  Wallet,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import DashboardLayout from '../../components/DashboardLayout';
import { supabase, PRODUCTS_TABLE } from '../../lib/supabaseClient';
import { useStore } from '../../context/StoreContext';
import { getExpenses } from '../../lib/expenses';
import { normalizeItemFromSupabase, roundMoney, runProductsSelectWithFallback } from '../../utils/productModel';

const SHEKEL = '\u20AA';

function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthRange(offsetMonths = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0);
  return { from: ymdLocal(start), to: ymdLocal(end) };
}

function weekRange(offsetWeeks = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offsetWeeks * 7);
  now.setHours(12, 0, 0, 0);
  const dow = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - dow);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: ymdLocal(start), to: ymdLocal(end) };
}

function yearRange(offsetYears = 0) {
  const y = new Date().getFullYear() + offsetYears;
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

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

function lineFinancials(line, productsMap) {
  const q = Math.max(0, Number(line.qty) || 0);
  if (q <= 0) return { qty: 0, revenue: 0, profit: 0 };
  const pid = line.product_id ? String(line.product_id) : null;
  const bc = line.barcode != null ? String(line.barcode) : '';
  const unitPrice = Number(line.unit_price) ?? 0;
  const lineTotal =
    line.line_total != null ? Number(line.line_total) : Math.max(0, unitPrice * q);

  let unitCost = 0;
  if (pid && productsMap.has(pid)) unitCost = productsMap.get(pid).unitCost ?? 0;
  else if (bc && productsMap.has(`b:${bc}`)) unitCost = productsMap.get(`b:${bc}`).unitCost ?? 0;

  return { qty: q, revenue: lineTotal, profit: lineTotal - q * unitCost };
}

function saleLines(sale, itemsBySaleId) {
  const fromJson = parseLineItems(sale.line_items);
  if (fromJson.length) return fromJson;
  const rows = itemsBySaleId.get(sale.id) || [];
  return rows.map((r) => ({
    product_id: r.product_id,
    barcode: r.barcode,
    name: r.barcode || 'صنف',
    qty: r.qty,
    unit_price: r.unit_price,
    line_total: r.line_total,
  }));
}

function aggregateTopProducts(salesRows, itemsBySaleId, productsMap, limit = 5) {
  const map = new Map();
  for (const sale of salesRows) {
    if (sale.returned_at) continue;
    for (const line of saleLines(sale, itemsBySaleId)) {
      const f = lineFinancials(line, productsMap);
      if (f.qty <= 0) continue;
      const pid = line.product_id ? String(line.product_id) : null;
      const bc = line.barcode != null ? String(line.barcode) : '';
      let name = line.product_name || line.name || bc || 'صنف';
      if (pid && productsMap.has(pid)) name = productsMap.get(pid).name || name;
      else if (bc && productsMap.has(`b:${bc}`)) name = productsMap.get(`b:${bc}`).name || name;
      const key = pid || (bc ? `b:${bc}` : name);
      const prev = map.get(key) || { key, name, qty: 0 };
      prev.qty += f.qty;
      map.set(key, prev);
    }
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, limit);
}

function computeMetrics(salesRows, expensesRows, itemsBySaleId, productsMap) {
  const active = salesRows.filter((s) => !s.returned_at);
  const revenue = active.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  const orders = active.length;
  const aov = orders > 0 ? revenue / orders : 0;

  let profit = 0;
  let hasLineCost = false;
  for (const sale of active) {
    for (const line of saleLines(sale, itemsBySaleId)) {
      const f = lineFinancials(line, productsMap);
      if (f.qty <= 0) continue;
      profit += f.profit;
      if (productsMap.size > 0) hasLineCost = true;
    }
  }
  if (!hasLineCost) profit = revenue;

  const expenses = expensesRows.reduce((s, e) => s + Number(e.amount ?? 0), 0);

  return {
    revenue: roundMoney(revenue),
    orders,
    aov: roundMoney(aov),
    profit: roundMoney(profit),
    expenses: roundMoney(expenses),
  };
}

function pctChange(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c > 0 ? 100 : 0;
  return roundMoney(((c - p) / p) * 100);
}

function formatMoney(n) {
  return roundMoney(Number(n ?? 0)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function ComparisonBadge({ current, previous, inverse = false }) {
  const change = pctChange(current, previous);
  const increased = change > 0;
  const decreased = change < 0;
  const good = inverse ? decreased : increased;
  const bad = inverse ? increased : decreased;

  let color = 'text-slate-500';
  let Icon = Minus;
  if (good && Math.abs(change) > 0.01) {
    color = 'text-emerald-600';
    Icon = TrendingUp;
  } else if (bad && Math.abs(change) > 0.01) {
    color = 'text-red-600';
    Icon = TrendingDown;
  }

  return (
    <div className={`flex items-center gap-1 text-sm font-bold ${color}`} dir="ltr">
      <Icon size={16} />
      <span>{change > 0 ? '+' : ''}{change}%</span>
      <span className="text-xs font-medium text-slate-400 mr-1">مقارنة بالفترة السابقة</span>
    </div>
  );
}

function MetricCard({ title, icon: Icon, value, current, previous, inverse, isCount }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
        <Icon size={16} className="text-indigo-500" />
        {title}
      </div>
      <p className="mt-3 text-3xl font-black text-slate-900" dir="ltr">
        {isCount ? Number(value).toLocaleString('en-US') : `${SHEKEL}${formatMoney(value)}`}
      </p>
      <div className="mt-2">
        <ComparisonBadge current={current} previous={previous} inverse={inverse} />
      </div>
    </div>
  );
}

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg" dir="rtl">
      <p className="mb-2 text-xs font-bold text-slate-500">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
          <span>{entry.name}:</span>
          <span dir="ltr">{Number(entry.value).toLocaleString('en-US')}</span>
        </div>
      ))}
    </div>
  );
};

export default function ComparisonReportPage() {
  const { store, loading: storeLoading } = useStore();
  const currentDefault = monthRange(0);
  const previousDefault = monthRange(-1);

  const [currentFrom, setCurrentFrom] = useState(currentDefault.from);
  const [currentTo, setCurrentTo] = useState(currentDefault.to);
  const [previousFrom, setPreviousFrom] = useState(previousDefault.from);
  const [previousTo, setPreviousTo] = useState(previousDefault.to);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [productsMap, setProductsMap] = useState(new Map());
  const [currentSales, setCurrentSales] = useState([]);
  const [previousSales, setPreviousSales] = useState([]);
  const [currentExpenses, setCurrentExpenses] = useState([]);
  const [previousExpenses, setPreviousExpenses] = useState([]);
  const [currentItemsBySale, setCurrentItemsBySale] = useState(new Map());
  const [previousItemsBySale, setPreviousItemsBySale] = useState(new Map());

  const applyPreset = (type) => {
    if (type === 'month') {
      const cur = monthRange(0);
      const prev = monthRange(-1);
      setCurrentFrom(cur.from);
      setCurrentTo(cur.to);
      setPreviousFrom(prev.from);
      setPreviousTo(prev.to);
    } else if (type === 'week') {
      const cur = weekRange(0);
      const prev = weekRange(-1);
      setCurrentFrom(cur.from);
      setCurrentTo(cur.to);
      setPreviousFrom(prev.from);
      setPreviousTo(prev.to);
    } else if (type === 'year') {
      const cur = yearRange(0);
      const prev = yearRange(-1);
      setCurrentFrom(cur.from);
      setCurrentTo(cur.to);
      setPreviousFrom(prev.from);
      setPreviousTo(prev.to);
    }
  };

  const loadProductsCost = useCallback(async () => {
    if (!store?.id) {
      setProductsMap(new Map());
      return;
    }
    const { data, error: qErr } = await runProductsSelectWithFallback((sel) =>
      supabase.from(PRODUCTS_TABLE).select(sel).eq('store_id', store.id)
    );
    if (qErr) throw qErr;
    const m = new Map();
    for (const row of data || []) {
      const it = normalizeItemFromSupabase(row);
      if (!it) continue;
      const cost = Number(row.full_price) || 0;
      m.set(String(it.id), { ...it, unitCost: cost });
      if (it.barcode) m.set(`b:${it.barcode}`, { ...it, unitCost: cost });
    }
    setProductsMap(m);
  }, [store?.id]);

  const fetchSales = async (from, to) => {
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T23:59:59.999`);
    const { data, error: qErr } = await supabase
      .from('sales')
      .select('id, created_at, total_amount, line_items, returned_at')
      .eq('store_id', store.id)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .limit(5000);
    if (qErr) throw qErr;
    return data || [];
  };

  const fetchSalesItemsMap = async (salesRows) => {
    const needItems = salesRows.filter((s) => parseLineItems(s.line_items).length === 0).map((s) => s.id);
    const map = new Map();
    if (!needItems.length) return map;
    const chunkSize = 200;
    for (let i = 0; i < needItems.length; i += chunkSize) {
      const chunk = needItems.slice(i, i + chunkSize);
      const { data } = await supabase
        .from('sales_items')
        .select('sale_id, product_id, barcode, qty, unit_price, line_total')
        .eq('store_id', store.id)
        .in('sale_id', chunk);
      for (const row of data || []) {
        if (!map.has(row.sale_id)) map.set(row.sale_id, []);
        map.get(row.sale_id).push(row);
      }
    }
    return map;
  };

  const loadData = useCallback(async () => {
    if (!store?.id) {
      setCurrentSales([]);
      setPreviousSales([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await loadProductsCost();
      const [curSales, prevSales, curExp, prevExp] = await Promise.all([
        fetchSales(currentFrom, currentTo),
        fetchSales(previousFrom, previousTo),
        getExpenses(store.id, { from: currentFrom, to: currentTo }),
        getExpenses(store.id, { from: previousFrom, to: previousTo }),
      ]);
      const [curItems, prevItems] = await Promise.all([
        fetchSalesItemsMap(curSales),
        fetchSalesItemsMap(prevSales),
      ]);
      setCurrentSales(curSales);
      setPreviousSales(prevSales);
      setCurrentExpenses(curExp);
      setPreviousExpenses(prevExp);
      setCurrentItemsBySale(curItems);
      setPreviousItemsBySale(prevItems);
    } catch (e) {
      setError(e.message || 'تعذّر تحميل بيانات المقارنة');
    } finally {
      setLoading(false);
    }
  }, [
    store?.id,
    currentFrom,
    currentTo,
    previousFrom,
    previousTo,
    loadProductsCost,
  ]);

  useEffect(() => {
    if (storeLoading) return;
    void loadData();
  }, [storeLoading, loadData]);

  const currentMetrics = useMemo(
    () => computeMetrics(currentSales, currentExpenses, currentItemsBySale, productsMap),
    [currentSales, currentExpenses, currentItemsBySale, productsMap]
  );

  const previousMetrics = useMemo(
    () => computeMetrics(previousSales, previousExpenses, previousItemsBySale, productsMap),
    [previousSales, previousExpenses, previousItemsBySale, productsMap]
  );

  const chartData = useMemo(
    () => [
      {
        name: 'المبيعات',
        current: currentMetrics.revenue,
        previous: previousMetrics.revenue,
      },
      {
        name: 'الطلبات',
        current: currentMetrics.orders,
        previous: previousMetrics.orders,
      },
      {
        name: 'المصروفات',
        current: currentMetrics.expenses,
        previous: previousMetrics.expenses,
      },
    ],
    [currentMetrics, previousMetrics]
  );

  const topCurrent = useMemo(
    () => aggregateTopProducts(currentSales, currentItemsBySale, productsMap, 5),
    [currentSales, currentItemsBySale, productsMap]
  );

  const topPreviousMap = useMemo(() => {
    const all = aggregateTopProducts(previousSales, previousItemsBySale, productsMap, 100);
    const ranked = new Map();
    all.forEach((p, idx) => ranked.set(p.key, { qty: p.qty, rank: idx + 1 }));
    return ranked;
  }, [previousSales, previousItemsBySale, productsMap]);

  const previousTop5Keys = useMemo(() => {
    return new Set(
      aggregateTopProducts(previousSales, previousItemsBySale, productsMap, 5).map((p) => p.key)
    );
  }, [previousSales, previousItemsBySale, productsMap]);

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
        <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100">
                <BarChart2 className="h-6 w-6 text-indigo-600" />
              </div>
              <div>
                <h1 className="text-2xl font-black text-slate-900">مقارنة الفترات</h1>
                <p className="text-sm text-slate-500">قارن أداء المتجر بين فترتين زمنيتين</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'جاري التحميل…' : 'تحديث التقرير'}
            </button>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {[
              { key: 'month', label: 'هذا الشهر مقابل الشهر السابق' },
              { key: 'week', label: 'هذا الأسبوع مقابل الأسبوع السابق' },
              { key: 'year', label: 'هذا العام مقابل العام السابق' },
            ].map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.key)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
              <h3 className="mb-3 text-sm font-black text-slate-800">الفترة الحالية</h3>
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-500">من</span>
                  <input
                    type="date"
                    value={currentFrom}
                    onChange={(e) => setCurrentFrom(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-500">إلى</span>
                  <input
                    type="date"
                    value={currentTo}
                    onChange={(e) => setCurrentTo(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
              <h3 className="mb-3 text-sm font-black text-slate-800">الفترة السابقة للمقارنة</h3>
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-500">من</span>
                  <input
                    type="date"
                    value={previousFrom}
                    onChange={(e) => setPreviousFrom(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-slate-500">إلى</span>
                  <input
                    type="date"
                    value={previousTo}
                    onChange={(e) => setPreviousTo(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-indigo-500" size={40} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title="المبيعات"
                icon={TrendingUp}
                value={currentMetrics.revenue}
                current={currentMetrics.revenue}
                previous={previousMetrics.revenue}
              />
              <MetricCard
                title="الطلبات"
                icon={ShoppingCart}
                value={currentMetrics.orders}
                current={currentMetrics.orders}
                previous={previousMetrics.orders}
                isCount
              />
              <MetricCard
                title="متوسط الفاتورة"
                icon={Receipt}
                value={currentMetrics.aov}
                current={currentMetrics.aov}
                previous={previousMetrics.aov}
              />
              <MetricCard
                title="المصروفات"
                icon={Wallet}
                value={currentMetrics.expenses}
                current={currentMetrics.expenses}
                previous={previousMetrics.expenses}
                inverse
              />
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-black text-slate-900">مقارنة بيانية</h2>
              <p className="mb-4 text-xs text-slate-500">المبيعات والطلبات والمصروفات — الفترة الحالية مقابل السابقة</p>
              <div className="h-80 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barGap={4} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={56} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
                    <Bar dataKey="current" name="الفترة الحالية" fill="#6366f1" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="previous" name="الفترة السابقة" fill="#94a3b8" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-6 py-4">
                <h2 className="text-lg font-black text-slate-900">أفضل 5 منتجات (الفترة الحالية)</h2>
                <p className="text-xs text-slate-500 mt-0.5">مقارنة الكمية المباعة مع الفترة السابقة</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/80">
                      <th className="py-3 px-4 text-right text-xs font-bold text-slate-600">#</th>
                      <th className="py-3 px-4 text-right text-xs font-bold text-slate-600">المنتج</th>
                      <th className="py-3 px-4 text-right text-xs font-bold text-slate-600">الكمية (حالية)</th>
                      <th className="py-3 px-4 text-right text-xs font-bold text-slate-600">الترتيب السابق</th>
                      <th className="py-3 px-4 text-right text-xs font-bold text-slate-600">الكمية (سابقة)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCurrent.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-sm text-slate-400">
                          لا توجد مبيعات في الفترة الحالية
                        </td>
                      </tr>
                    ) : (
                      topCurrent.map((product, idx) => {
                        const prev = topPreviousMap.get(product.key);
                        const isNew = !previousTop5Keys.has(product.key);
                        return (
                          <tr
                            key={product.key}
                            className={`border-b border-slate-50 ${isNew ? 'bg-emerald-50/50' : 'hover:bg-slate-50/60'}`}
                          >
                            <td className="py-3 px-4 font-black text-slate-700">{idx + 1}</td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-slate-800">{product.name}</span>
                                {isNew && (
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                                    جديد
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 font-mono text-sm font-bold text-indigo-700" dir="ltr">
                              {product.qty.toLocaleString('en-US')}
                            </td>
                            <td className="py-3 px-4 text-sm text-slate-600">
                              {prev ? `#${prev.rank}` : '—'}
                            </td>
                            <td className="py-3 px-4 font-mono text-sm text-slate-600" dir="ltr">
                              {prev ? prev.qty.toLocaleString('en-US') : '—'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
