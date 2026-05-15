import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRef } from 'react';
import {
  Loader2,
  CalendarDays,
  Receipt,
  TrendingUp,
  TrendingDown,
  CreditCard,
  Banknote,
  RotateCcw,
  Printer,
  RefreshCw,
  ShoppingCart,
  Package,
  Clock,
  CheckCircle2,
  BarChart2,
  Wallet,
  FileCheck,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';

function fmtMoney(n) {
  const v = Number(n ?? 0);
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function parseLineItems(raw) {
  if (!raw) return [];
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

const PAYMENT_LABELS = {
  cash: 'كاش',
  credit: 'ذمة',
  visa: 'دفع إلكتروني',
  check: 'شيك',
  digital_wallet: 'محفظة رقمية',
};

const PAYMENT_COLORS = {
  cash:   { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-800/40', icon: Banknote },
  credit: { bg: 'bg-amber-50 dark:bg-amber-950/30',    text: 'text-amber-700 dark:text-amber-300',    border: 'border-amber-200 dark:border-amber-800/40',   icon: CreditCard },
  visa:   { bg: 'bg-indigo-50 dark:bg-indigo-950/30',  text: 'text-indigo-700 dark:text-indigo-300',  border: 'border-indigo-200 dark:border-indigo-800/40',  icon: CreditCard },
  check:  { bg: 'bg-violet-50 dark:bg-violet-950/30',  text: 'text-violet-700 dark:text-violet-300',  border: 'border-violet-200 dark:border-violet-800/40',  icon: FileCheck },
  digital_wallet: { bg: 'bg-teal-50 dark:bg-teal-950/30', text: 'text-teal-700 dark:text-teal-300', border: 'border-teal-200 dark:border-teal-800/40', icon: Wallet },
};

export default function EndOfDayReportPage() {
  const { store, loading: storeLoading } = useStore();
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState(null);
  const printRef = useRef(null);

  const fetchSales = useCallback(async () => {
    if (!store?.id) return;
    setLoading(true);
    try {
      const from = new Date(selectedDate); from.setHours(0, 0, 0, 0);
      const to   = new Date(selectedDate); to.setHours(23, 59, 59, 999);

      const { data, error } = await supabase
        .from('sales')
        .select('id, created_at, total_amount, payment_mode, pos_tender, returned_at, return_note, line_items, contact_id, notes')
        .eq('store_id', store.id)
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString())
        .order('created_at', { ascending: true });

      if (error && /pos_tender|column|PGRST204/i.test(String(error.message || ''))) {
        const { data: d2 } = await supabase
          .from('sales')
          .select('id, created_at, total_amount, payment_mode, returned_at, line_items, notes')
          .eq('store_id', store.id)
          .gte('created_at', from.toISOString())
          .lte('created_at', to.toISOString())
          .order('created_at', { ascending: true });
        setSales(d2 || []);
      } else {
        setSales(data || []);
      }
      setGeneratedAt(new Date());
    } catch (e) {
      console.error(e);
      setSales([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id, selectedDate]);

  useEffect(() => {
    if (!storeLoading && store?.id) fetchSales();
  }, [storeLoading, fetchSales]);

  const stats = useMemo(() => {
    const active = sales.filter(s => !s.returned_at);
    const returned = sales.filter(s => s.returned_at);

    const totalRevenue = active.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
    const returnedAmount = returned.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
    const netRevenue = totalRevenue - returnedAmount;

    // By payment method
    const byPayment = {};
    active.forEach(s => {
      const key = s.pos_tender || s.payment_mode || 'cash';
      if (!byPayment[key]) byPayment[key] = { count: 0, amount: 0 };
      byPayment[key].count++;
      byPayment[key].amount += Number(s.total_amount ?? 0);
    });

    // By hour
    const byHour = {};
    active.forEach(s => {
      const h = new Date(s.created_at).getHours();
      if (!byHour[h]) byHour[h] = { count: 0, amount: 0 };
      byHour[h].count++;
      byHour[h].amount += Number(s.total_amount ?? 0);
    });

    // Top products
    const productMap = {};
    active.forEach(s => {
      parseLineItems(s.line_items).forEach(line => {
        const name = line.name || line.product_name || (line.barcode ? `باركود ${line.barcode}` : 'غير محدد');
        const qty = Math.max(0, Number(line.qty ?? line.quantity ?? 1) || 1);
        const total = Number(line.line_total ?? line.lineTotal ?? (Number(line.unit_price ?? 0) * qty));
        if (!productMap[name]) productMap[name] = { qty: 0, amount: 0 };
        productMap[name].qty += qty;
        productMap[name].amount += total;
      });
    });
    const topProducts = Object.entries(productMap)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);

    // Hours filled
    const hoursData = Array.from({ length: 24 }, (_, h) => ({
      h,
      count: byHour[h]?.count || 0,
      amount: byHour[h]?.amount || 0,
    })).filter(h => h.count > 0);

    const maxHourAmount = Math.max(...hoursData.map(h => h.amount), 1);
    const peakHour = hoursData.sort((a, b) => b.amount - a.amount)[0];

    return {
      totalRevenue,
      returnedAmount,
      netRevenue,
      txCount: active.length,
      returnCount: returned.length,
      byPayment,
      topProducts,
      hoursData: hoursData.sort((a, b) => a.h - b.h),
      maxHourAmount,
      peakHour,
      avgTicket: active.length > 0 ? totalRevenue / active.length : 0,
    };
  }, [sales]);

  const handlePrint = () => window.print();

  if (storeLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="animate-spin text-indigo-500" size={40} />
        </div>
      </DashboardLayout>
    );
  }

  const isToday = selectedDate === new Date().toISOString().slice(0, 10);
  const dateLabel = isToday ? 'اليوم' : new Date(selectedDate).toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <DashboardLayout
      actions={
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
          <button
            type="button"
            onClick={fetchSales}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-all dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            تحديث
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white shadow-md hover:bg-indigo-700 transition-all"
          >
            <Printer size={16} />
            طباعة
          </button>
        </div>
      }
    >
      <div className="space-y-6 max-w-5xl mx-auto" dir="rtl" ref={printRef}>

        {/* Report Header */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden dark:border-gray-700/50 dark:bg-gray-900/70">
          <div className="px-6 py-5 bg-gradient-to-l from-indigo-50/60 to-white dark:from-indigo-950/40 dark:to-gray-900/90 border-b border-slate-100 dark:border-slate-700/60">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md">
                    <CalendarDays size={22} />
                  </div>
                  <div>
                    <h1 className="text-xl font-black text-slate-900 dark:text-white">تقرير نهاية اليوم (Z-Report)</h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                      {store?.name} — {dateLabel}
                    </p>
                  </div>
                </div>
              </div>
              <div className="text-left">
                {generatedAt && (
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium" dir="ltr">
                    تم التوليد: {fmtDate(generatedAt.toISOString())}
                  </p>
                )}
                {isToday && (
                  <span className="inline-flex items-center gap-1 mt-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-black dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    تقرير اليوم
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-indigo-500" size={36} />
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-2xl border border-indigo-200/80 bg-white p-4 shadow-sm dark:border-indigo-800/30 dark:bg-gray-900/70">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/50">
                    <TrendingUp size={18} className="text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <span className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 rounded-full">إجمالي</span>
                </div>
                <p className="text-2xl font-black text-slate-900 dark:text-white font-currency" dir="ltr">₪{fmtMoney(stats.totalRevenue)}</p>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-0.5">إجمالي المبيعات</p>
              </div>

              <div className="rounded-2xl border border-emerald-200/80 bg-white p-4 shadow-sm dark:border-emerald-800/30 dark:bg-gray-900/70">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/50">
                    <Receipt size={18} className="text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-full font-currency" dir="ltr">{stats.txCount}</span>
                </div>
                <p className="text-2xl font-black text-slate-900 dark:text-white font-currency" dir="ltr">{stats.txCount}</p>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-0.5">فاتورة مكتملة</p>
              </div>

              <div className={`rounded-2xl border bg-white p-4 shadow-sm dark:bg-gray-900/70 ${stats.returnCount > 0 ? 'border-rose-200/80 dark:border-rose-800/30' : 'border-slate-200/80 dark:border-slate-700/30'}`}>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${stats.returnCount > 0 ? 'bg-rose-50 dark:bg-rose-950/40' : 'bg-slate-50 dark:bg-slate-800/40'}`}>
                    <RotateCcw size={18} className={stats.returnCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'} />
                  </div>
                </div>
                <p className={`text-2xl font-black font-currency ${stats.returnCount > 0 ? 'text-rose-700 dark:text-rose-400' : 'text-slate-400'}`} dir="ltr">
                  {stats.returnCount > 0 ? `-₪${fmtMoney(stats.returnedAmount)}` : '—'}
                </p>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-0.5">مرتجعات ({stats.returnCount})</p>
              </div>

              <div className="rounded-2xl border border-violet-200/80 bg-gradient-to-br from-violet-50/60 to-indigo-50/40 p-4 shadow-sm dark:border-violet-800/30 dark:bg-gray-900/70 dark:from-violet-950/20 dark:to-indigo-950/10">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white dark:bg-violet-950/50 shadow-sm">
                    <CheckCircle2 size={18} className="text-violet-600 dark:text-violet-400" />
                  </div>
                  {stats.avgTicket > 0 && (
                    <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400">
                      متوسط ₪{fmtMoney(stats.avgTicket)}
                    </span>
                  )}
                </div>
                <p className="text-2xl font-black text-violet-700 dark:text-violet-300 font-currency" dir="ltr">₪{fmtMoney(stats.netRevenue)}</p>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-0.5">صافي المبيعات</p>
              </div>
            </div>

            {/* Payment methods + Top products */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Payment methods */}
              <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden dark:border-gray-700/50 dark:bg-gray-900/70">
                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700/60 bg-gradient-to-l from-emerald-50/40 to-white dark:from-emerald-950/20 dark:to-gray-900">
                  <h2 className="font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <Banknote size={18} className="text-emerald-600 dark:text-emerald-400" />
                    تفصيل طرق الدفع
                  </h2>
                </div>
                <div className="p-4 space-y-3">
                  {Object.keys(PAYMENT_LABELS).map(key => {
                    const data = stats.byPayment[key];
                    if (!data) return null;
                    const colors = PAYMENT_COLORS[key] || PAYMENT_COLORS.cash;
                    const IconComp = colors.icon;
                    const pct = stats.totalRevenue > 0 ? (data.amount / stats.totalRevenue) * 100 : 0;
                    return (
                      <div key={key} className={`rounded-xl border ${colors.border} ${colors.bg} p-3`}>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <IconComp size={15} className={colors.text} />
                            <span className={`text-sm font-black ${colors.text}`}>{PAYMENT_LABELS[key]}</span>
                          </div>
                          <div className="text-left">
                            <span className={`text-sm font-black font-currency ${colors.text}`} dir="ltr">₪{fmtMoney(data.amount)}</span>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 mr-2">({data.count} فاتورة)</span>
                          </div>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/60 dark:bg-black/20 overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${
                            key === 'cash' ? 'bg-emerald-500' :
                            key === 'credit' ? 'bg-amber-500' :
                            key === 'visa' ? 'bg-indigo-500' :
                            key === 'check' ? 'bg-violet-500' : 'bg-teal-500'
                          }`} style={{ width: `${pct.toFixed(1)}%` }} />
                        </div>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 text-left" dir="ltr">{pct.toFixed(1)}%</p>
                      </div>
                    );
                  })}
                  {Object.keys(stats.byPayment).length === 0 && (
                    <p className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm font-bold">لا توجد مبيعات في هذا اليوم</p>
                  )}
                </div>
              </div>

              {/* Top products */}
              <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden dark:border-gray-700/50 dark:bg-gray-900/70">
                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700/60 bg-gradient-to-l from-violet-50/40 to-white dark:from-violet-950/20 dark:to-gray-900">
                  <h2 className="font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <Package size={18} className="text-violet-600 dark:text-violet-400" />
                    أكثر الأصناف مبيعاً
                  </h2>
                </div>
                <div className="p-4">
                  {stats.topProducts.length === 0 ? (
                    <p className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm font-bold">لا توجد بيانات أصناف</p>
                  ) : (
                    <div className="space-y-2.5">
                      {stats.topProducts.map((p, idx) => {
                        const maxAmount = stats.topProducts[0]?.amount || 1;
                        const pct = (p.amount / maxAmount) * 100;
                        return (
                          <div key={idx} className="flex items-center gap-3">
                            <span className={`shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black ${
                              idx === 0 ? 'bg-amber-400 text-white' :
                              idx === 1 ? 'bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-200' :
                              idx === 2 ? 'bg-orange-300 text-white' :
                              'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                            }`}>{idx + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{p.name}</span>
                                <div className="shrink-0 text-right">
                                  <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 font-currency" dir="ltr">₪{fmtMoney(p.amount)}</span>
                                  <span className="text-[10px] text-slate-400 dark:text-slate-500 mr-1">× {p.qty}</span>
                                </div>
                              </div>
                              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <div className="h-full rounded-full bg-gradient-to-l from-violet-500 to-indigo-500" style={{ width: `${pct.toFixed(1)}%` }} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Hourly breakdown */}
            {stats.hoursData.length > 0 && (
              <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden dark:border-gray-700/50 dark:bg-gray-900/70">
                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700/60 bg-gradient-to-l from-indigo-50/40 to-white dark:from-indigo-950/20 dark:to-gray-900 flex items-center justify-between">
                  <h2 className="font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <Clock size={18} className="text-indigo-500 dark:text-indigo-400" />
                    توزيع المبيعات بالساعة
                  </h2>
                  {stats.peakHour && (
                    <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1 rounded-xl border border-indigo-100 dark:border-indigo-800/40">
                      ذروة: {stats.peakHour.h}:00 — ₪{fmtMoney(stats.peakHour.amount)}
                    </span>
                  )}
                </div>
                <div className="p-5">
                  <div className="flex items-end gap-1.5 h-32">
                    {stats.hoursData.map(h => {
                      const barH = Math.max(4, (h.amount / stats.maxHourAmount) * 100);
                      const isPeak = stats.peakHour?.h === h.h;
                      return (
                        <div key={h.h} className="flex-1 flex flex-col items-center gap-1 group" title={`${h.h}:00 — ₪${fmtMoney(h.amount)} (${h.count} فاتورة)`}>
                          <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                            ₪{Math.round(h.amount)}
                          </span>
                          <div
                            className={`w-full rounded-t-lg transition-all ${isPeak ? 'bg-gradient-to-t from-indigo-600 to-violet-500' : 'bg-indigo-200 dark:bg-indigo-800/60 group-hover:bg-indigo-400 dark:group-hover:bg-indigo-600'}`}
                            style={{ height: `${barH}%` }}
                          />
                          <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500">{h.h}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Cash Reconciliation */}
            <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden dark:border-gray-700/50 dark:bg-gray-900/70">
              <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700/60 bg-gradient-to-l from-emerald-50/40 to-white dark:from-emerald-950/20 dark:to-gray-900">
                <h2 className="font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <BarChart2 size={18} className="text-emerald-600 dark:text-emerald-400" />
                  تسوية الكاش
                </h2>
              </div>
              <div className="p-5">
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/60">
                    <span className="text-sm font-bold text-slate-600 dark:text-slate-300">إجمالي مبيعات كاش اليوم</span>
                    <span className="font-black text-emerald-700 dark:text-emerald-300 font-currency" dir="ltr">
                      +₪{fmtMoney(stats.byPayment?.cash?.amount || 0)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/60">
                    <span className="text-sm font-bold text-slate-600 dark:text-slate-300">مرتجعات كاش</span>
                    <span className={`font-black font-currency ${stats.returnCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}`} dir="ltr">
                      {stats.returnCount > 0 ? `-₪${fmtMoney(stats.returnedAmount)}` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-3 bg-slate-50/80 dark:bg-slate-800/40 rounded-xl px-3">
                    <span className="text-base font-black text-slate-800 dark:text-white">صافي الكاش اليوم</span>
                    <span className="text-xl font-black text-emerald-700 dark:text-emerald-300 font-currency" dir="ltr">
                      ₪{fmtMoney((stats.byPayment?.cash?.amount || 0) - stats.returnedAmount)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Summary line for print */}
            <div className="rounded-2xl border border-indigo-200/80 bg-indigo-50/40 p-4 dark:border-indigo-800/30 dark:bg-indigo-950/20 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                تقرير نهاية اليوم — {store?.name} — {dateLabel} — {stats.txCount} فاتورة — صافي ₪{fmtMoney(stats.netRevenue)}
              </p>
            </div>
          </>
        )}
      </div>

      <style>{`
        @media print {
          body > *:not(#root) { display: none; }
          .sidebar, nav, header button, [data-no-print] { display: none !important; }
        }
      `}</style>
    </DashboardLayout>
  );
}
