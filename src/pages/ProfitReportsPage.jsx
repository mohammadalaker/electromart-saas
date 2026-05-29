import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, TrendingUp, TrendingDown, AlertTriangle, Minus } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import DashboardLayout from '../components/DashboardLayout';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { normalizeItemFromSupabase, roundMoney, runProductsSelectWithFallback } from '../utils/productModel';

const PURCHASES_TABLE = 'store_purchases';
const FUND_MOVEMENTS_TABLE = 'store_fund_movements';

/** نص أرقام الربح — أخضر متوهج في الوضع الداكن */
const profitGlowClass =
  'text-emerald-600 dark:text-emerald-300 [text-shadow:0_0_14px_rgba(16,185,129,0.35)] dark:[text-shadow:0_0_22px_rgba(52,211,153,0.55),0_0_40px_rgba(16,185,129,0.25)]';

const lossGlowClass =
  'text-rose-600 dark:text-rose-300 [text-shadow:0_0_12px_rgba(244,63,94,0.25)] dark:[text-shadow:0_0_18px_rgba(251,113,133,0.35)]';

/** غلاف زجاجي موحّد مع بقية لوحة التحكم */
const glassPanel =
  'rounded-2xl border border-white/20 dark:border-gray-700/30 bg-white/80 dark:bg-gray-900/50 backdrop-blur-md shadow-[0_4px_24px_-8px_rgba(15,23,42,0.08)] dark:shadow-[0_4px_24px_-8px_rgba(0,0,0,0.35)]';

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

/** مفتاح يوم تقويمي محلي (يتوافق مع عرض التواريخ للمستخدم) */
function dateKeyLocal(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * إيراد السطر وتكلفته وربحه: (سعر البيع الفعلي للسطر − تكلفة الوحدة × الكمية).
 * تكلفة الوحدة من `full_price` الحالي للصنف (متوسط تكلفة مرجّح بعد المشتريات).
 */
function lineFinancials(line, productsMap) {
  const q = Math.max(0, Number(line.qty) || 0);
  if (q <= 0) return { qty: 0, revenue: 0, cost: 0, profit: 0 };
  const pid = line.product_id ? String(line.product_id) : null;
  const bc = line.barcode != null ? String(line.barcode) : '';
  const unitPrice = Number(line.unit_price) ?? 0;
  const lineTotal =
    line.line_total != null ? Number(line.line_total) : Math.max(0, unitPrice * q);

  let unitCost = 0;
  if (pid && productsMap.has(pid)) {
    unitCost = productsMap.get(pid).unitCost ?? 0;
  } else if (bc && productsMap.has(`b:${bc}`)) {
    unitCost = productsMap.get(`b:${bc}`).unitCost ?? 0;
  }
  const lineCost = q * unitCost;
  return {
    qty: q,
    revenue: lineTotal,
    cost: lineCost,
    profit: lineTotal - lineCost,
  };
}

function aggregateSalesToProfitRows(salesRows, productsMap) {
  const lineRows = [];
  let revenue = 0;
  let cost = 0;

  for (const sale of salesRows) {
    const lines = parseLineItems(sale.line_items);
    for (const line of lines) {
      const f = lineFinancials(line, productsMap);
      if (f.qty <= 0) continue;
      revenue += f.revenue;
      cost += f.cost;
      const pid = line.product_id ? String(line.product_id) : null;
      const bc = line.barcode != null ? String(line.barcode) : '';
      let displayName = line.product_name || line.name || 'صنف';
      if (pid && productsMap.has(pid)) displayName = productsMap.get(pid).name || displayName;
      else if (bc && productsMap.has(`b:${bc}`)) displayName = productsMap.get(`b:${bc}`).name || displayName;

      lineRows.push({
        name: displayName,
        barcode: bc,
        qty: f.qty,
        revenue: f.revenue,
        cost: f.cost,
        profit: f.profit,
      });
    }
  }

  const agg = new Map();
  for (const r of lineRows) {
    const k = `${r.name}|${r.barcode}`;
    const prev = agg.get(k) || {
      name: r.name,
      barcode: r.barcode,
      profit: 0,
      revenue: 0,
      cost: 0,
      qty: 0,
    };
    prev.profit += r.profit;
    prev.revenue += r.revenue;
    prev.cost += r.cost;
    prev.qty += r.qty;
    agg.set(k, prev);
  }
  const top = [...agg.values()].sort((a, b) => b.profit - a.profit).slice(0, 15);

  return {
    linesProfit: lineRows,
    totalRevenue: revenue,
    totalCost: cost,
    netProfit: revenue - cost,
    topByProfit: top,
  };
}

/** ربح وتكلفة يومية ضمن الفترة المختارة */
function buildProfitChartData(salesRows, productsMap, fromDateStr, toDateStr) {
  const start = new Date(`${fromDateStr}T00:00:00`);
  const end = new Date(`${toDateStr}T23:59:59`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const dayKeys = [];
  const cursor = new Date(start);
  cursor.setHours(12, 0, 0, 0);
  while (cursor <= end) {
    const key = dateKeyLocal(cursor.toISOString());
    if (key) dayKeys.push({ key, date: new Date(cursor) });
    cursor.setDate(cursor.getDate() + 1);
  }

  const byDay = new Map(dayKeys.map(({ key }) => [key, { profit: 0, costs: 0 }]));

  for (const sale of salesRows) {
    const dk = dateKeyLocal(sale.created_at);
    if (!dk || !byDay.has(dk)) continue;
    const lines = parseLineItems(sale.line_items);
    for (const line of lines) {
      const f = lineFinancials(line, productsMap);
      const prev = byDay.get(dk);
      prev.profit += f.profit;
      prev.costs += f.cost;
    }
  }

  return dayKeys.map(({ key, date }) => ({
    date: date.toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' }),
    profit: roundMoney(byDay.get(key).profit),
    costs: roundMoney(byDay.get(key).costs),
  }));
}

function ProfitLineChart({ data }) {
  if (!data.length) return null;

  return (
    <div className={`${glassPanel} p-5 sm:p-6`}>
      <h2 className="font-black text-slate-900 dark:text-white mb-1">الربح والتكاليف</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        اتجاه يومي ضمن الفترة المختارة — أخضر للربح، برتقالي للتكاليف.
      </p>
      <div className="h-[300px] w-full" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" className="dark:opacity-20" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#888891' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#888891' }} axisLine={false} tickLine={false} width={48} />
            <Tooltip
              contentStyle={{
                borderRadius: '16px',
                border: 'none',
                boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
              }}
              formatter={(value) =>
                `₪${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              }
            />
            <Line
              type="monotone"
              dataKey="profit"
              name="الربح"
              stroke="#4CAF50"
              strokeWidth={3}
              dot={{ fill: '#4CAF50', r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="costs"
              name="التكاليف"
              stroke="#FF9800"
              strokeWidth={3}
              dot={{ fill: '#FF9800', r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function ProfitReportsPage() {
  const { store, loading: storeLoading } = useStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [salesRows, setSalesRows] = useState([]);
  const [purchasesTotal, setPurchasesTotal] = useState(null);
  /** مصروفات تشغيلية مسجّلة من صفحة الصناديق والمالية */
  const [operatingExpensesTotal, setOperatingExpensesTotal] = useState(null);
  const [productsMap, setProductsMap] = useState(() => new Map());

  const loadProductsCost = useCallback(async () => {
    if (!store?.id) return;
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

  const loadData = useCallback(async () => {
    if (!store?.id) {
      setSalesRows([]);
      setPurchasesTotal(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await loadProductsCost();
      const start = new Date(fromDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);

      const { data, error: qErr } = await supabase
        .from('sales')
        .select('id, created_at, line_items, total_amount')
        .eq('store_id', store.id)
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
        .order('created_at', { ascending: false })
        .limit(2000);

      if (qErr) throw qErr;
      setSalesRows(data || []);

      let pSum = 0;
      const { data: pData, error: pErr } = await supabase
        .from(PURCHASES_TABLE)
        .select('total_amount')
        .eq('store_id', store.id)
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
        .limit(5000);

      if (pErr) {
        const msg = String(pErr.message || '');
        if (!/does not exist|schema cache|PGRST205/i.test(msg)) console.warn('[profit] purchases:', pErr);
        setPurchasesTotal(null);
      } else {
        for (const row of pData || []) {
          pSum += Number(row.total_amount ?? 0);
        }
        setPurchasesTotal(pSum);
      }

      let opExpSum = 0;
      const { data: expData, error: expErr } = await supabase
        .from(FUND_MOVEMENTS_TABLE)
        .select('amount')
        .eq('store_id', store.id)
        .eq('kind', 'expense')
        .eq('direction', 'out')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString());
      if (expErr) {
        const msg = String(expErr.message || '');
        if (!/does not exist|schema cache|PGRST205|42P01/i.test(msg)) console.warn('[profit] fund movements:', expErr);
        setOperatingExpensesTotal(null);
      } else {
        for (const row of expData || []) {
          opExpSum += Number(row.amount ?? 0);
        }
        setOperatingExpensesTotal(roundMoney(opExpSum));
      }
    } catch (e) {
      console.error(e);
      setError(e.message || 'تعذّر التحميل');
      setSalesRows([]);
      setPurchasesTotal(null);
      setOperatingExpensesTotal(null);
    } finally {
      setLoading(false);
    }
  }, [store?.id, fromDate, toDate, loadProductsCost]);

  useEffect(() => {
    if (storeLoading) return;
    loadData();
  }, [storeLoading, loadData]);

  const { linesProfit, totalRevenue, totalCost, netProfit, topByProfit } = useMemo(
    () => aggregateSalesToProfitRows(salesRows, productsMap),
    [salesRows, productsMap]
  );

  const netAfterOperating =
    typeof operatingExpensesTotal === 'number'
      ? roundMoney(netProfit - operatingExpensesTotal)
      : null;

  const profitData = useMemo(
    () => buildProfitChartData(salesRows, productsMap, fromDate, toDate),
    [salesRows, productsMap, fromDate, toDate]
  );

  const kpiCards = useMemo(() => {
    const profitColor =
      netProfit > 0
        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
        : netProfit < 0
          ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'
          : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-300';
    const ProfitIcon = netProfit > 0 ? TrendingUp : netProfit < 0 ? AlertTriangle : Minus;

    return [
      {
        title: 'إجمالي المبيعات',
        value: totalRevenue,
        color: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
        icon: TrendingUp,
      },
      {
        title: 'إجمالي التكاليف',
        value: totalCost,
        color: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
        icon: TrendingDown,
      },
      {
        title: 'صافي الربح',
        value: netProfit,
        color: profitColor,
        icon: ProfitIcon,
      },
    ];
  }, [totalRevenue, totalCost, netProfit]);

  const detailItems = useMemo(() => {
    const revenueBase = totalRevenue > 0 ? totalRevenue : 1;
    const share = (amount) => Math.min(100, Math.round((Math.abs(amount) / revenueBase) * 1000) / 10);

    const rows = [
      { name: 'إجمالي المبيعات', amount: totalRevenue, percent: 100, trend: 1 },
      { name: 'إجمالي التكاليف', amount: totalCost, percent: share(totalCost), trend: -1 },
      { name: 'صافي الربح', amount: netProfit, percent: share(netProfit), trend: netProfit >= 0 ? 1 : -1 },
    ];

    if (typeof purchasesTotal === 'number') {
      rows.push({ name: 'مشتريات الفترة', amount: purchasesTotal, percent: share(purchasesTotal), trend: -1 });
    }
    if (typeof operatingExpensesTotal === 'number') {
      rows.push({
        name: 'مصروفات تشغيلية',
        amount: operatingExpensesTotal,
        percent: share(operatingExpensesTotal),
        trend: -1,
      });
    }
    if (netAfterOperating != null) {
      rows.push({
        name: 'صافي الربح بعد المصروفات',
        amount: netAfterOperating,
        percent: share(netAfterOperating),
        trend: netAfterOperating >= 0 ? 1 : -1,
      });
    }

    return rows;
  }, [totalRevenue, totalCost, netProfit, purchasesTotal, operatingExpensesTotal, netAfterOperating]);

  const productItems = useMemo(() => {
    const maxProfit = Math.max(...topByProfit.map((r) => Math.abs(r.profit)), 1);
    return topByProfit.map((r) => ({
      name: r.name,
      amount: r.profit,
      percent: Math.min(100, Math.round((Math.abs(r.profit) / maxProfit) * 1000) / 10),
      trend: r.profit >= 0 ? 1 : -1,
    }));
  }, [topByProfit]);

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
        <div
          className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center text-amber-950 font-bold"
          dir="rtl"
        >
          لا يوجد متجر مرتبط بحسابك.
        </div>
      </DashboardLayout>
    );
  }

  const fmtMoney = (n) =>
    `₪${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6" dir="rtl">
        <div className={`${glassPanel} p-6 transition-shadow hover:shadow-[0_8px_32px_-8px_rgba(15,23,42,0.1)] dark:hover:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.45)]`}>
          <h1 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 dark:bg-emerald-400/10 text-emerald-600 dark:text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.25)] dark:shadow-[0_0_24px_rgba(52,211,153,0.35)] ring-1 ring-emerald-500/20">
              <TrendingUp className="shrink-0" size={26} strokeWidth={2.25} />
            </span>
            تقارير الأرباح
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-3 leading-relaxed max-w-3xl">
            المصدر: جدول <code className="text-xs bg-slate-100/90 dark:bg-white/5 px-1.5 py-0.5 rounded-md border border-slate-200/80 dark:border-white/10">sales</code> (أسطر
            الفاتورة) وجدول{' '}
            <code className="text-xs bg-slate-100/90 dark:bg-white/5 px-1.5 py-0.5 rounded-md border border-slate-200/80 dark:border-white/10">store_purchases</code> لإجمالي
            المشتريات في نفس الفترة. لكل صنف: صافي الربح ≈ إيراد السطر − (تكلفة الوحدة × الكمية المباعة)؛ تكلفة
            الوحدة من <code className="text-xs bg-slate-100/90 dark:bg-white/5 px-1.5 py-0.5 rounded-md border border-slate-200/80 dark:border-white/10">full_price</code> الحالي
            (متوسط تكلفة بعد استلام المشتريات).
          </p>
          <div className="flex flex-wrap gap-3 mt-5 items-end">
            <div>
              <label className="block text-xs font-black text-slate-600 dark:text-slate-400 mb-1">من</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="rounded-xl border border-white/30 dark:border-white/10 bg-white/90 dark:bg-slate-900/60 backdrop-blur-sm px-3 py-2 text-sm font-currency text-slate-900 dark:text-white shadow-inner"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-600 dark:text-slate-400 mb-1">إلى</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="rounded-xl border border-white/30 dark:border-white/10 bg-white/90 dark:bg-slate-900/60 backdrop-blur-sm px-3 py-2 text-sm font-currency text-slate-900 dark:text-white shadow-inner"
                dir="ltr"
              />
            </div>
            <button
              type="button"
              onClick={() => loadData()}
              className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-5 py-2.5 text-sm font-black shadow-[0_4px_16px_-4px_rgba(79,70,229,0.45)] hover:from-indigo-500 hover:to-violet-500 transition-all ring-1 ring-white/20"
            >
              تحديث
            </button>
          </div>
        </div>

        {error && (
          <p className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/95 dark:bg-rose-950/40 backdrop-blur-md px-4 py-3 text-sm font-bold text-rose-800 dark:text-rose-200">
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-indigo-500" size={36} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {kpiCards.map((card) => {
                const Icon = card.icon;
                return (
                  <div key={card.title} className={`rounded-2xl p-6 ${card.color}`}>
                    <div className="flex items-center justify-between">
                      <Icon size={24} />
                      <span className="text-sm font-bold opacity-70">{card.title}</span>
                    </div>
                    <p className="mt-2 text-3xl font-black font-currency" dir="ltr">
                      ₪{Number(card.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                );
              })}
            </div>

            {netProfit < 0 && (
              <div className="mb-4 flex items-center gap-3 rounded-2xl bg-rose-50 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-800/50 p-4">
                <AlertTriangle className="text-rose-500 shrink-0" size={24} />
                <div>
                  <p className="font-bold text-rose-700 dark:text-rose-300" dir="ltr">
                    تنبيه: خسارة ₪{Math.abs(netProfit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-sm text-rose-600 dark:text-rose-400" dir="ltr">
                    التكاليف أعلى من المبيعات بـ ₪{Math.abs(netProfit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            )}

            {typeof purchasesTotal === 'number' && (
              <p
                className={`${glassPanel} px-4 py-3 text-sm text-slate-600 dark:text-slate-300 font-bold`}
              >
                إجمالي مشتريات الفترة ({PURCHASES_TABLE}):{' '}
                <span className="font-currency text-teal-700 dark:text-teal-300/95" dir="ltr">
                  {fmtMoney(purchasesTotal)}
                </span>
              </p>
            )}

            {typeof operatingExpensesTotal === 'number' && (
              <div className={`${glassPanel} px-4 py-4 space-y-2`}>
                <p className="text-sm text-slate-600 dark:text-slate-300 font-bold">
                  مصروفات تشغيلية مسجّلة في الفترة (إيجار، كهرباء، رواتب…):{' '}
                  <span className="font-currency text-rose-700 dark:text-rose-300/95" dir="ltr">
                    {fmtMoney(operatingExpensesTotal)}
                  </span>
                </p>
                <p className="text-sm font-black text-slate-900 dark:text-white">
                  صافي الربح بعد المصروفات التشغيلية:{' '}
                  <span
                    className={`font-currency ${netAfterOperating >= 0 ? profitGlowClass : lossGlowClass}`}
                    dir="ltr"
                  >
                    {fmtMoney(netAfterOperating)}
                  </span>
                </p>
                <Link
                  to="/finance"
                  className="inline-block text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  المالية والمصروفات ←
                </Link>
              </div>
            )}

            <ProfitLineChart data={profitData} />

            <div className="rounded-2xl bg-white dark:bg-[#18181b] overflow-hidden shadow-sm border border-gray-200 dark:border-white/10">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-white/10">
                <h2 className="font-black text-gray-900 dark:text-white text-sm">ملخص الأرباح التفصيلي</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  شركة {store?.name || 'المتجر'} — الفترة المختارة
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px]">
                  <thead className="bg-gray-50 dark:bg-white/[0.03]">
                    <tr>
                      <th className="px-4 py-3 text-right text-sm font-bold text-gray-600 dark:text-gray-400">البند</th>
                      <th className="px-4 py-3 text-right text-sm font-bold text-gray-600 dark:text-gray-400">المبلغ</th>
                      <th className="px-4 py-3 text-right text-sm font-bold text-gray-600 dark:text-gray-400">النسبة</th>
                      <th className="px-4 py-3 text-right text-sm font-bold text-gray-600 dark:text-gray-400">الاتجاه</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                    {detailItems.map((item) => (
                      <tr key={item.name} className="hover:bg-gray-50 dark:hover:bg-white/[0.03] transition">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{item.name}</td>
                        <td className="px-4 py-3 font-bold font-currency text-gray-900 dark:text-gray-100" dir="ltr">
                          ₪{Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="h-2 w-24 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${item.trend > 0 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                              style={{ width: `${item.percent}%` }}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {item.trend > 0 ? (
                            <TrendingUp className="text-green-500" size={20} />
                          ) : (
                            <TrendingDown className="text-red-500" size={20} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl bg-white dark:bg-[#18181b] overflow-hidden shadow-sm border border-gray-200 dark:border-white/10">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-white/10">
                <h2 className="font-black text-gray-900 dark:text-white text-sm">صافي الربح لكل صنف (الأعلى)</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  تجميع حسب الصنف ضمن الفترة
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px]">
                  <thead className="bg-gray-50 dark:bg-white/[0.03]">
                    <tr>
                      <th className="px-4 py-3 text-right text-sm font-bold text-gray-600 dark:text-gray-400">البند</th>
                      <th className="px-4 py-3 text-right text-sm font-bold text-gray-600 dark:text-gray-400">المبلغ</th>
                      <th className="px-4 py-3 text-right text-sm font-bold text-gray-600 dark:text-gray-400">النسبة</th>
                      <th className="px-4 py-3 text-right text-sm font-bold text-gray-600 dark:text-gray-400">الاتجاه</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                    {productItems.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                          لا توجد بيانات في الفترة أو لا تطابق أصناف المخزن (line_items).
                        </td>
                      </tr>
                    ) : (
                      productItems.map((item, i) => (
                        <tr key={`${item.name}-${i}`} className="hover:bg-gray-50 dark:hover:bg-white/[0.03] transition">
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{item.name}</td>
                          <td
                            className={`px-4 py-3 font-bold font-currency ${item.trend > 0 ? profitGlowClass : lossGlowClass}`}
                            dir="ltr"
                          >
                            ₪{Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3">
                            <div className="h-2 w-24 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
                              <div className="h-full rounded-full bg-blue-500" style={{ width: `${item.percent}%` }} />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {item.trend > 0 ? (
                              <TrendingUp className="text-green-500" size={20} />
                            ) : (
                              <TrendingDown className="text-red-500" size={20} />
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {linesProfit.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-500 text-center backdrop-blur-sm rounded-lg py-1">
                عدد أسطر البيع المحلّلة: {linesProfit.length}
              </p>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
