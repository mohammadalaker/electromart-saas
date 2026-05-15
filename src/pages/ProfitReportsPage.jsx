import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, TrendingUp } from 'lucide-react';
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

/** صافي ربح كل يوم ضمن آخر 7 أيام تنتهي بـ `toDate` (تقويم محلي) */
function buildLast7DaysProfit(salesRows, productsMap, toDateStr) {
  const end = new Date(`${toDateStr}T23:59:59`);
  if (Number.isNaN(end.getTime())) return [];

  const dayKeys = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(end);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = dateKeyLocal(d.toISOString());
    if (key) dayKeys.push({ key, date: new Date(d) });
  }

  const profitByDay = new Map(dayKeys.map(({ key }) => [key, 0]));

  for (const sale of salesRows) {
    const dk = dateKeyLocal(sale.created_at);
    if (!dk || !profitByDay.has(dk)) continue;
    const lines = parseLineItems(sale.line_items);
    let saleProfit = 0;
    for (const line of lines) {
      saleProfit += lineFinancials(line, productsMap).profit;
    }
    profitByDay.set(dk, profitByDay.get(dk) + saleProfit);
  }

  return dayKeys.map(({ key, date }) => ({
    key,
    label: date.toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'numeric' }),
    profit: profitByDay.get(key) ?? 0,
  }));
}

function WeeklyProfitChart({ series }) {
  if (!series.length) return null;
  const maxVal = Math.max(...series.map((s) => Math.abs(s.profit)), 1);
  return (
    <div className={`${glassPanel} p-5 sm:p-6 overflow-hidden relative`}>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/[0.06] dark:from-emerald-400/[0.08] via-transparent to-violet-500/[0.04] rounded-2xl" />
      <div className="relative">
        <h2 className="font-black text-slate-900 dark:text-white mb-1">الربح خلال آخر 7 أيام</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
          يعتمد على أسطر المبيعات في الفترة المختارة؛ الأيام خارج الفلتر تظهر صفراً.
        </p>
        <div className="flex items-end justify-between gap-1 sm:gap-2 min-h-[200px] pt-2" dir="ltr">
          {series.map((d) => {
            const h = maxVal > 0 ? Math.max(8, (Math.abs(d.profit) / maxVal) * 100) : 8;
            const positive = d.profit >= 0;
            return (
              <div key={d.key} className="flex-1 flex flex-col items-center gap-2 min-w-0">
                <div className="w-full flex flex-col items-center justify-end h-40">
                  <span
                    className={`text-[10px] sm:text-xs font-black font-currency mb-1 truncate max-w-full ${
                      positive ? profitGlowClass : lossGlowClass
                    }`}
                    title={d.profit.toFixed(2)}
                  >
                    {d.profit >= 0 ? '' : '−'}
                    ₪{Math.abs(d.profit).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </span>
                  <div
                    className={`w-full max-w-[48px] mx-auto rounded-t-lg transition-all ${
                      positive
                        ? 'bg-gradient-to-t from-emerald-700 via-emerald-500 to-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.45)] dark:shadow-[0_0_28px_rgba(52,211,153,0.4)]'
                        : 'bg-gradient-to-t from-rose-700 to-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.25)]'
                    }`}
                    style={{ height: `${h}%` }}
                    role="img"
                    aria-label={`${d.label}: ${d.profit}`}
                  />
                </div>
                <span className="text-[10px] sm:text-xs font-bold text-slate-600 dark:text-slate-400 text-center leading-tight px-0.5">
                  {d.label}
                </span>
              </div>
            );
          })}
        </div>
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

  const weekSeries = useMemo(
    () => buildLast7DaysProfit(salesRows, productsMap, toDate),
    [salesRows, productsMap, toDate]
  );

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
              <div
                className={`${glassPanel} p-5 transition-all hover:border-emerald-300/40 dark:hover:border-emerald-500/25`}
              >
                <p className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  إجمالي المبيعات
                </p>
                <p
                  className="text-2xl font-black font-currency text-slate-900 dark:text-white mt-2 [text-shadow:0_1px_2px_rgba(0,0,0,0.06)]"
                  dir="ltr"
                >
                  {fmtMoney(totalRevenue)}
                </p>
              </div>
              <div
                className={`${glassPanel} p-5 transition-all hover:border-amber-300/40 dark:hover:border-amber-500/20`}
              >
                <p className="text-xs font-black text-slate-500 dark:text-slate-400">إجمالي التكاليف (تقديري)</p>
                <p className="text-2xl font-black font-currency text-amber-800 dark:text-amber-200/95 mt-2" dir="ltr">
                  {fmtMoney(totalCost)}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-500 mt-2 leading-snug">
                  الكمية × تكلفة الوحدة من المخزن لكل سطر بيع.
                </p>
              </div>
              <div
                className={`${glassPanel} p-5 relative overflow-hidden ring-1 ring-emerald-500/20 dark:ring-emerald-400/25`}
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/[0.12] dark:from-emerald-400/[0.14] via-transparent to-teal-500/[0.06] rounded-2xl" />
                <div className="relative">
                  <p className="text-xs font-black text-emerald-800/90 dark:text-emerald-200/90">صافي الربح الإجمالي</p>
                  <p
                    className={`text-2xl sm:text-3xl font-black font-currency mt-2 ${
                      netProfit >= 0 ? profitGlowClass : lossGlowClass
                    }`}
                    dir="ltr"
                  >
                    {fmtMoney(netProfit)}
                  </p>
                </div>
              </div>
            </div>

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

            <WeeklyProfitChart series={weekSeries} />

            <div className={`${glassPanel} overflow-hidden`}>
              <div className="px-4 py-3 border-b border-white/20 dark:border-white/5 bg-white/40 dark:bg-white/[0.03] backdrop-blur-sm">
                <h2 className="font-black text-slate-900 dark:text-white">صافي الربح لكل صنف (الأعلى)</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  شركة {store?.name || 'المتجر'} — تجميع حسب الصنف ضمن الفترة
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right min-w-[560px]">
                  <thead>
                    <tr className="bg-slate-900/95 dark:bg-slate-950/90 text-white backdrop-blur-md">
                      <th className="p-3">#</th>
                      <th className="p-3">الصنف</th>
                      <th className="p-3 text-center">كمية مباعة</th>
                      <th className="p-3 text-center">مبيعات</th>
                      <th className="p-3 text-center">تكلفة</th>
                      <th className="p-3 text-center">صافي ربح</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topByProfit.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-500 dark:text-slate-400">
                          لا توجد بيانات في الفترة أو لا تطابق أصناف المخزن (line_items).
                        </td>
                      </tr>
                    ) : (
                      topByProfit.map((r, i) => (
                        <tr
                          key={`${r.name}-${r.barcode}-${i}`}
                          className="border-b border-slate-200/60 dark:border-white/[0.06] odd:bg-white/50 dark:odd:bg-slate-900/35 even:bg-white/30 dark:even:bg-transparent"
                        >
                          <td className="p-2.5 text-center font-currency text-slate-600 dark:text-slate-400">
                            {i + 1}
                          </td>
                          <td className="p-2.5 font-bold text-slate-900 dark:text-slate-100">{r.name}</td>
                          <td className="p-2.5 text-center font-currency text-slate-700 dark:text-slate-300" dir="ltr">
                            {r.qty != null ? r.qty : '—'}
                          </td>
                          <td className="p-2.5 text-center font-currency text-slate-700 dark:text-slate-300" dir="ltr">
                            {fmtMoney(r.revenue)}
                          </td>
                          <td className="p-2.5 text-center font-currency text-amber-800/90 dark:text-amber-200/85" dir="ltr">
                            {fmtMoney(r.cost)}
                          </td>
                          <td
                            className={`p-2.5 text-center font-black font-currency ${
                              r.profit >= 0 ? profitGlowClass : lossGlowClass
                            }`}
                            dir="ltr"
                          >
                            {fmtMoney(r.profit)}
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
