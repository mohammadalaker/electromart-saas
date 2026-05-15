import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  RefreshCw,
  TrendingUp,
  ShoppingCart,
  ShoppingBag,
  Landmark,
  Wallet,
  Users,
  ArrowUpRight,
  Building2,
  ArrowRightLeft,
  AlertCircle
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { roundMoney } from '../utils/productModel';
import { FUND_ACCOUNTS_TABLE, FUND_MOVEMENTS_TABLE, ensureDefaultFundAccounts } from '../utils/fundAccounts';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell
} from 'recharts';

const CONTACTS = 'store_contacts';
const SALES = 'sales';
const PURCHASES = 'store_purchases';
const SHEKEL = '\u20AA';
const CHART_DAYS = 14;
const LATE_SALES_DAYS = 30;

function formatMoney(n) {
  return roundMoney(Number(n ?? 0)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function seriesByDay(rows, days, getAmount) {
  const keys = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (days - 1 - i));
    keys.push(d.toISOString().slice(0, 10));
  }
  const map = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const row of rows || []) {
    const day = String(row.created_at || '').slice(0, 10);
    if (map[day] !== undefined) map[day] += getAmount(row);
  }
  return keys.map((k) => roundMoney(map[k]));
}

function CustomTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-xl border border-slate-200/50 bg-white/95 px-4 py-3 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.1)] backdrop-blur-md dark:border-white/10 dark:bg-[#18181b]/95" dir="rtl">
        <p className="text-[11px] font-bold text-slate-500 mb-2">{label}</p>
        <div className="space-y-1.5">
          {payload.map((entry, index) => (
            <div key={index} className="flex items-center gap-3">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">
                {entry.name === 'sales' ? 'المبيعات' : 'المشتريات'}
              </span>
              <span className="flex-1 text-left font-mono text-[13px] font-black text-slate-900 dark:text-white" dir="ltr">
                {SHEKEL}{formatMoney(entry.value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

export default function ExecutiveDashboardPage() {
  const { store, loading: storeLoading } = useStore();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [salesSeries, setSalesSeries] = useState([]);
  const [purchaseSeries, setPurchaseSeries] = useState([]);
  
  const [stats, setStats] = useState({
    salesPeriodTotal: 0,
    creditSalesLateCount: 0,
    creditSalesLateAmount: 0,
    customersInDebt: 0,
    receivables: 0,
    purchasesUnpaidCount: 0,
    purchasesUnpaidAmount: 0,
    payablesTotal: 0,
    cashBalance: 0,
    bankBalance: 0,
    liquidityTotal: 0,
  });
  const [topDebtors, setTopDebtors] = useState([]);

  const load = useCallback(async () => {
    if (!store?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    const since = new Date();
    since.setDate(since.getDate() - CHART_DAYS);
    since.setHours(0, 0, 0, 0);
    const sinceIso = since.toISOString();
    const lateCut = new Date();
    lateCut.setDate(lateCut.getDate() - LATE_SALES_DAYS);
    const lateIso = lateCut.toISOString();

    try {
      await ensureDefaultFundAccounts(supabase, store.id);

      const [
        { data: fundRows, error: fundErr },
        { data: saleRows, error: saleErr },
        { data: purchaseRows, error: purchaseErr },
        { data: lateSales, error: lateErr },
        { data: customers, error: custErr },
        { data: suppliers, error: supErr },
      ] = await Promise.all([
        supabase
          .from(FUND_ACCOUNTS_TABLE)
          .select('id, code, name_ar, balance')
          .eq('store_id', store.id)
          .order('sort_order', { ascending: true }),
        supabase
          .from(SALES)
          .select('created_at, total_amount, payment_mode')
          .eq('store_id', store.id)
          .gte('created_at', sinceIso)
          .is('returned_at', null)
          .limit(8000),
        supabase
          .from(PURCHASES)
          .select('created_at, total_amount, payment_mode')
          .eq('store_id', store.id)
          .gte('created_at', sinceIso)
          .limit(8000),
        supabase
          .from(SALES)
          .select('id, total_amount')
          .eq('store_id', store.id)
          .eq('payment_mode', 'credit')
          .lt('created_at', lateIso)
          .is('returned_at', null)
          .limit(5000),
        supabase
          .from(CONTACTS)
          .select('id, name, outstanding_amount')
          .eq('store_id', store.id)
          .eq('role', 'customer')
          .order('outstanding_amount', { ascending: false })
          .limit(200),
        supabase
          .from(CONTACTS)
          .select('outstanding_amount')
          .eq('store_id', store.id)
          .eq('role', 'supplier'),
      ]);

      if (fundErr) throw fundErr;
      if (saleErr) throw saleErr;
      if (purchaseErr) throw purchaseErr;
      if (custErr) throw custErr;
      if (supErr) throw supErr;

      const funds = fundRows || [];
      const byCode = (c) => funds.filter((f) => f.code === c);
      const cashIds = new Set([...byCode('cash_shop'), ...byCode('employee_petty')].map((f) => f.id));
      const bankIds = new Set(byCode('bank').map((f) => f.id));

      let cashBalance = 0;
      let bankBalance = 0;
      let liquidityTotal = 0;
      for (const f of funds) {
        const b = Math.max(0, Number(f.balance ?? 0));
        liquidityTotal += b;
        if (cashIds.has(f.id)) cashBalance += b;
        if (bankIds.has(f.id)) bankBalance += b;
      }

      const saleSeries = seriesByDay(saleRows, CHART_DAYS, (r) => Number(r.total_amount ?? 0));
      const purSeries = seriesByDay(purchaseRows, CHART_DAYS, (r) => Number(r.total_amount ?? 0));

      let lateCount = 0;
      let lateAmount = 0;
      if (!lateErr && lateSales?.length) {
        lateCount = lateSales.length;
        lateAmount = lateSales.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
      }

      let receivables = 0;
      const debtors = [];
      for (const c of customers || []) {
        const o = Math.max(0, Number(c.outstanding_amount ?? 0));
        receivables += o;
        if (o > 0.01) debtors.push({ id: c.id, name: c.name, amount: roundMoney(o) });
      }
      const topD = debtors.slice(0, 5);

      let payables = 0;
      for (const s of suppliers || []) {
        payables += Math.max(0, Number(s.outstanding_amount ?? 0));
      }

      let unpaidPurchasesCount = 0;
      let unpaidPurchasesAmount = 0;
      try {
        let q = supabase
          .from(PURCHASES)
          .select('id, total_amount')
          .eq('store_id', store.id)
          .eq('payment_mode', 'credit')
          .limit(2000);
        q = q.is('credit_settled_at', null);
        const { data: ups, error: upErr } = await q;
        if (!upErr && ups) {
          unpaidPurchasesCount = ups.length;
          unpaidPurchasesAmount = ups.reduce((a, r) => a + Number(r.total_amount ?? 0), 0);
        }
      } catch {
        /* ignore */
      }

      const salesPeriodTotal = saleSeries.reduce((a, b) => a + b, 0);

      setSalesSeries(saleSeries);
      setPurchaseSeries(purSeries);
      setTopDebtors(topD);
      setStats({
        salesPeriodTotal: roundMoney(salesPeriodTotal),
        creditSalesLateCount: lateCount,
        creditSalesLateAmount: roundMoney(lateAmount),
        customersInDebt: debtors.length,
        receivables: roundMoney(receivables),
        purchasesUnpaidCount: unpaidPurchasesCount,
        purchasesUnpaidAmount: roundMoney(unpaidPurchasesAmount),
        payablesTotal: roundMoney(payables),
        cashBalance: roundMoney(cashBalance),
        bankBalance: roundMoney(bankBalance),
        liquidityTotal: roundMoney(liquidityTotal),
      });
    } catch (e) {
      console.error(e);
      setErr(e.message || 'تعذّر تحميل اللوحة');
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    load();
  }, [storeLoading, load]);

  // Transform data for the Combined Flow Chart
  const combinedFlowData = useMemo(() => {
    return salesSeries.map((sAmount, i) => {
      const pAmount = purchaseSeries[i] || 0;
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - (CHART_DAYS - 1 - i));
      return {
        label: new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short' }).format(d),
        sales: sAmount,
        purchases: pAmount,
      };
    });
  }, [salesSeries, purchaseSeries]);

  // Donut chart data for Liquidity Total
  const liquidityData = [
    { name: 'البنك', value: stats.bankBalance, color: '#0ea5e9' },
    { name: 'الصناديق', value: stats.cashBalance, color: '#10b981' },
  ];
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
        <div className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center font-bold" dir="rtl">
          لا يوجد متجر مرتبط بحسابك.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-[14px] border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold shadow-sm transition hover:bg-slate-50 dark:border-white/10 dark:bg-[#18181b] dark:hover:bg-white/5"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            تحديث
          </button>
          <Link
            to="/pos"
            className="inline-flex items-center gap-2 rounded-[14px] bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-transform hover:scale-[1.02]"
          >
            نقطة البيع <ArrowUpRight size={16} />
          </Link>
        </div>
      }
    >
      <div className="mx-auto w-full space-y-6 pb-10" dir="rtl">
        {err && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
            {err}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200/50 bg-gradient-to-br from-indigo-50/30 to-white py-32 dark:border-white/[0.04] dark:from-indigo-950/10 dark:to-transparent">
            <Loader2 className="animate-spin text-indigo-500" size={40} />
            <p className="text-sm font-bold text-slate-500">جاري تجميع البيانات…</p>
          </div>
        ) : (
          <>
            {/* KPI Cards Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-[20px] border border-l-4 border-l-emerald-500 border-white/60 bg-white/70 p-6 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.1)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_-8px_rgba(0,0,0,0.15)] dark:border-white/[0.06] dark:border-l-emerald-400 dark:bg-white/[0.03] dark:backdrop-blur-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-50/90 to-emerald-100/50 text-emerald-600 dark:from-emerald-500/15 dark:to-emerald-500/5 dark:text-emerald-400">
                    <Wallet size={20} className="stroke-[2.5]" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400">إجمالي السيولة</h3>
                </div>
                <div className="mb-4 h-px bg-slate-100 dark:bg-white/[0.06]" />
                <div className="flex items-end justify-between gap-3">
                  <p className="font-mono text-3xl font-black text-slate-900 dark:text-white" dir="ltr">
                    {SHEKEL}{formatMoney(stats.liquidityTotal)}
                  </p>
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                    ↗ مستقر
                  </span>
                </div>
              </div>

              <div className="rounded-[20px] border border-l-4 border-l-amber-500 border-white/60 bg-white/70 p-6 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.1)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_-8px_rgba(0,0,0,0.15)] dark:border-white/[0.06] dark:border-l-amber-400 dark:bg-white/[0.03] dark:backdrop-blur-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-50/90 to-amber-100/50 text-amber-600 dark:from-amber-500/15 dark:to-amber-500/5 dark:text-amber-400">
                    <Users size={20} className="stroke-[2.5]" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400">أرصدة وذمم الزبائن</h3>
                </div>
                <div className="mb-4 h-px bg-slate-100 dark:bg-white/[0.06]" />
                <p className="font-mono text-3xl font-black text-slate-900 dark:text-white" dir="ltr">
                  {SHEKEL}{formatMoney(stats.receivables)}
                </p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                    لدى {stats.customersInDebt} زبائن
                  </p>
                  <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                    ↘ متابعة
                  </span>
                </div>
              </div>

              <div className="rounded-[20px] border border-l-4 border-l-indigo-500 border-white/60 bg-white/70 p-6 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.1)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_-8px_rgba(0,0,0,0.15)] dark:border-white/[0.06] dark:border-l-indigo-400 dark:bg-white/[0.03] dark:backdrop-blur-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-50/90 to-indigo-100/50 text-indigo-600 dark:from-indigo-500/15 dark:to-indigo-500/5 dark:text-indigo-400">
                    <TrendingUp size={20} className="stroke-[2.5]" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400">المبيعات (14 يوم)</h3>
                </div>
                <div className="mb-4 h-px bg-slate-100 dark:bg-white/[0.06]" />
                <p className="font-mono text-3xl font-black text-slate-900 dark:text-white" dir="ltr">
                  {SHEKEL}{formatMoney(stats.salesPeriodTotal)}
                </p>
                <div className="mt-2 flex justify-end">
                  <span className="rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-black text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                    ↗ نمو
                  </span>
                </div>
              </div>

              <div className="rounded-[20px] border border-l-4 border-l-rose-500 border-white/60 bg-white/70 p-6 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.1)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_-8px_rgba(0,0,0,0.15)] dark:border-white/[0.06] dark:border-l-rose-400 dark:bg-white/[0.03] dark:backdrop-blur-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-rose-50/90 to-rose-100/50 text-rose-600 dark:from-rose-500/15 dark:to-rose-500/5 dark:text-rose-400">
                    <AlertCircle size={20} className="stroke-[2.5]" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400">ذمم الموردين غير المسددة</h3>
                </div>
                <div className="mb-4 h-px bg-slate-100 dark:bg-white/[0.06]" />
                <p className="font-mono text-3xl font-black text-slate-900 dark:text-white" dir="ltr">
                  {SHEKEL}{formatMoney(stats.purchasesUnpaidAmount)}
                </p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">
                    {stats.purchasesUnpaidCount} فاتورة مستحقة
                  </p>
                  <span className="rounded-full bg-rose-50 px-2 py-1 text-[11px] font-black text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                    ↘ مطلوب
                  </span>
                </div>
              </div>
            </div>

            {/* Main Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 rounded-[20px] border border-slate-200/80 bg-gradient-to-br from-white/80 to-slate-50/50 p-5 shadow-sm backdrop-blur-xl dark:border-white/[0.04] dark:bg-gradient-to-br dark:from-white/[0.04] dark:to-white/[0.01]">
                <div className="-m-5 mb-6 flex items-center justify-between rounded-t-[20px] bg-gradient-to-r from-indigo-50/50 to-transparent p-5 dark:from-indigo-500/5 dark:to-transparent">
                  <div>
                    <h2 className="text-[15px] font-black text-slate-900 dark:text-white">حركة التدفق (مبيعات ومشتريات)</h2>
                    <p className="mt-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">مقارنة الداخل والخارج خلال 14 يوماً</p>
                  </div>
                  <div className="flex gap-4 items-center">
                    <div className="flex items-center gap-2">
                       <span className="w-3 h-3 rounded-md bg-indigo-500"></span>
                       <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">المبيعات</span>
                    </div>
                    <div className="flex items-center gap-2">
                       <span className="w-3 h-3 rounded-md bg-rose-500"></span>
                       <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">المشتريات</span>
                    </div>
                  </div>
                </div>
                <div className="h-[300px] w-full rounded-[18px] bg-gradient-to-br from-indigo-50/80 via-white to-rose-50/60 p-3 dark:from-indigo-950/20 dark:via-white/[0.02] dark:to-rose-950/20" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={combinedFlowData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.5}/>
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorPurchases" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#888891', fontWeight: 600 }} dy={10} />
                      <YAxis hide domain={[0, 'dataMax']} />
                      <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#52525b', strokeWidth: 1, strokeDasharray: '4 4' }} />
                      <Area type="monotone" dataKey="sales" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
                      <Area type="monotone" dataKey="purchases" stroke="#f43f5e" strokeWidth={3} fillOpacity={1} fill="url(#colorPurchases)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-sm font-bold text-slate-600 dark:border-white/[0.04] dark:bg-white/[0.03] dark:text-slate-300">
                  <span>
                    إجمالي المبيعات:{' '}
                    <span className="font-mono font-black text-indigo-700 dark:text-indigo-300" dir="ltr">
                      {SHEKEL}{formatMoney(stats.salesPeriodTotal)}
                    </span>
                  </span>
                  <span className="text-slate-300">|</span>
                  <span>
                    إجمالي المشتريات:{' '}
                    <span className="font-mono font-black text-rose-700 dark:text-rose-300" dir="ltr">
                      {SHEKEL}{formatMoney(purchaseSeries.reduce((a, b) => a + b, 0))}
                    </span>
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-center rounded-[20px] border border-slate-200/80 bg-gradient-to-br from-white/80 to-slate-50/50 p-5 shadow-sm backdrop-blur-xl dark:border-white/[0.04] dark:bg-gradient-to-br dark:from-white/[0.04] dark:to-white/[0.01]">
                <div className="w-full mb-2">
                   <h2 className="text-[15px] font-black text-slate-900 dark:text-white">توزيع السيولة</h2>
                   <p className="text-[11px] font-bold text-slate-500 mt-1">البنك النقد في العهدة</p>
                </div>
                <div className="relative w-full flex-1 flex flex-col items-center justify-center">
                  <div className="h-[220px] w-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={liquidityData}
                          cx="50%"
                          cy="50%"
                          innerRadius={65}
                          outerRadius={90}
                          paddingAngle={5}
                          dataKey="value"
                          stroke="transparent"
                        >
                          {liquidityData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip 
                            formatter={(value) => [SHEKEL + formatMoney(value), '']}
                            contentStyle={{ borderRadius: '12px', border: 'none', background: '#18181b', color: '#fff', fontSize: '13px', fontWeight: 'bold' }} 
                            itemStyle={{ color: '#fff' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                     <p className="text-[10px] font-bold text-slate-500">الإجمالي</p>
                     <p className="font-mono text-lg font-black text-slate-900 dark:text-white">{formatMoney(stats.liquidityTotal)}</p>
                  </div>
                </div>
                <div className="flex w-full justify-center gap-6 mt-2">
                  <div className="flex flex-col items-center">
                    <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#0ea5e9]"></span><span className="text-[12px] font-bold text-slate-600 dark:text-slate-400">البنك</span></div>
                    <span className="font-mono text-[13px] font-black mt-1">{formatMoney(stats.bankBalance)}</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#10b981]"></span><span className="text-[12px] font-bold text-slate-600 dark:text-slate-400">الصناديق</span></div>
                    <span className="font-mono text-[13px] font-black mt-1">{formatMoney(stats.cashBalance)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2 rounded-[20px] bg-white border border-slate-200/80 shadow-sm dark:bg-[#18181b] dark:border-white/[0.04] p-5">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <Users className="text-violet-600 dark:text-violet-500" size={20} strokeWidth={2.5} />
                    <h2 className="text-[15px] font-black text-slate-900 dark:text-white">أكبر ذمم الزبائن</h2>
                  </div>
                  <Link
                    to="/customers"
                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 dark:bg-indigo-500/10 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    عرض الكل
                  </Link>
                </div>
                {topDebtors.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                    <Users size={32} className="mb-2 opacity-50" />
                    <p className="text-sm font-bold">لا توجد ذمم مفتوحة حالياً.</p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {topDebtors.map((d, i) => {
                      const progress = stats.receivables > 0 ? Math.min(100, (d.amount / stats.receivables) * 100) : 0;
                      return (
                      <li
                        key={d.id}
                        className="group rounded-[14px] border border-slate-100 bg-slate-50/50 px-4 py-3 transition hover:bg-slate-100 dark:border-white/[0.03] dark:bg-white/[0.02] dark:hover:bg-white/[0.05]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-violet-100/80 text-[13px] font-black text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                              {i + 1}
                            </span>
                            <Link to={`/customers/${d.id}`} className="truncate font-bold text-slate-800 hover:text-indigo-600 dark:text-slate-200">
                              {d.name || 'زبون'}
                            </Link>
                          </div>
                          <span className="shrink-0 font-mono text-[14px] font-black text-amber-700 dark:text-amber-400" dir="ltr">
                            {SHEKEL}
                            {formatMoney(d.amount)}
                          </span>
                        </div>
                        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/10">
                          <div
                            className="h-full rounded-full bg-amber-400/60"
                            style={{ width: `${progress}%` }}
                            aria-hidden
                          />
                        </div>
                      </li>
                    );
                    })}
                  </ul>
                )}
              </div>

              <div className="rounded-[20px] bg-white border border-slate-200/80 shadow-sm dark:bg-[#18181b] dark:border-white/[0.04] p-5">
                <div className="flex items-center gap-2 mb-5">
                  <Landmark className="text-sky-600 dark:text-sky-500" size={20} strokeWidth={2.5} />
                  <h2 className="text-[15px] font-black text-slate-900 dark:text-white">إجراءات سريعة</h2>
                </div>
                <nav className="flex flex-col gap-2.5">
                  {[
                    { to: '/pos', label: 'نقطة البيع (كاشير)', icon: ShoppingCart, color: 'text-indigo-500 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-500/10' },
                    { to: '/purchases/lines', label: 'إدخال فاتورة مشتريات', icon: ShoppingBag, color: 'text-rose-500 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-500/10' },
                    { to: '/vouchers', label: 'إنشاء سند قبض / صرف', icon: ArrowRightLeft, color: 'text-emerald-500 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
                    { to: '/finance/center', label: 'المركز المالي الشامل', icon: Building2, color: 'text-amber-500 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10' },
                  ].map(({ to, label, icon: Icon, color, bg }) => (
                    <Link
                      key={to}
                      to={to}
                      className="group flex items-center justify-between gap-2 rounded-[14px] border border-slate-100 bg-white px-3.5 py-3 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm hover:shadow-md hover:shadow-indigo-500/10 dark:border-white/[0.03] dark:bg-white/[0.02] dark:hover:border-white/10 dark:hover:bg-white/[0.05]"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-110 ${bg} ${color}`}>
                            <Icon size={18} strokeWidth={2.5} />
                        </div>
                        <span className="text-[13px] font-bold text-slate-800 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                          {label}
                        </span>
                      </div>
                      <ArrowUpRight size={16} className="text-slate-300 transition-transform group-hover:translate-x-1 dark:text-slate-600 group-hover:text-indigo-500" />
                    </Link>
                  ))}
                </nav>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
