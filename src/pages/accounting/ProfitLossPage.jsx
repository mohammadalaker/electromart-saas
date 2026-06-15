import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Filter,
  Loader2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  DollarSign,
  PieChart,
  Info,
  ChevronDown,
} from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { supabase } from '../../lib/supabaseClient';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { roundMoney } from '../../utils/productModel';

const ACCOUNTS_TABLE = 'accounting_accounts';
const JOURNAL_LINES_TABLE = 'accounting_journal_lines';

const getDefaultDates = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const formatDate = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  return {
    from: formatDate(firstDay),
    to: formatDate(lastDay),
  };
};

const toEnglishNumbers = (str) => {
  return String(str).replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => d.charCodeAt(0) - 1632)
                    .replace(/[۰۱۲۳۴۵۶۷۸۹]/g, d => d.charCodeAt(0) - 1776);
};

export default function ProfitLossPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();

  const [revenueAccounts, setRevenueAccounts] = useState([]);
  const [expenseAccounts, setExpenseAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Default date range filter to current month
  const defaultDates = useMemo(() => getDefaultDates(), []);
  const [filterFrom, setFilterFrom] = useState(defaultDates.from);
  const [filterTo, setFilterTo] = useState(defaultDates.to);

  // Fetch accounts and calculate profit and loss movements
  const loadData = useCallback(async () => {
    if (!store?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch all active revenue & expense accounts
      const { data: accData, error: accErr } = await supabase
        .from(ACCOUNTS_TABLE)
        .select('id, code, name, type')
        .eq('store_id', store.id)
        .eq('is_active', true)
        .in('type', ['revenue', 'expense'])
        .order('code', { ascending: true });

      if (accErr) throw accErr;

      // 2. Fetch posted journal lines within the selected date range
      let q = supabase
        .from(JOURNAL_LINES_TABLE)
        .select(`
          debit,
          credit,
          account_id,
          accounting_journal!inner (
            date,
            status,
            store_id
          )
        `)
        .eq('accounting_journal.store_id', store.id)
        .eq('accounting_journal.status', 'posted');

      if (filterFrom) {
        q = q.gte('accounting_journal.date', filterFrom);
      }
      if (filterTo) {
        q = q.lte('accounting_journal.date', filterTo);
      }

      const { data: linesData, error: linesErr } = await q;
      if (linesErr) throw linesErr;

      // 3. Aggregate net movements in memory
      const netMovements = {};
      (linesData || []).forEach((line) => {
        const accId = line.account_id;
        if (!netMovements[accId]) {
          netMovements[accId] = { debit: 0, credit: 0 };
        }
        netMovements[accId].debit += Number(line.debit || 0);
        netMovements[accId].credit += Number(line.credit || 0);
      });

      // 4. Map accounts to revenue or expense sections
      const revenues = [];
      const expenses = [];

      (accData || []).forEach((acc) => {
        const movement = netMovements[acc.id] || { debit: 0, credit: 0 };
        const debit = roundMoney(movement.debit);
        const credit = roundMoney(movement.credit);

        // Revenue natural balance: Credit - Debit
        // Expense natural balance: Debit - Credit
        let netAmount = 0;
        if (acc.type === 'revenue') {
          netAmount = credit - debit;
        } else {
          netAmount = debit - credit;
        }

        const row = {
          id: acc.id,
          code: acc.code,
          name: acc.name,
          type: acc.type,
          amount: roundMoney(netAmount),
        };

        if (acc.type === 'revenue') {
          revenues.push(row);
        } else {
          expenses.push(row);
        }
      });

      setRevenueAccounts(revenues);
      setExpenseAccounts(expenses);
    } catch (e) {
      console.error(e);
      setError(e.message || 'تعذر تحميل قائمة الأرباح والخسائر');
      setRevenueAccounts([]);
      setExpenseAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id, filterFrom, filterTo]);

  useEffect(() => {
    if (storeLoading) return;
    loadData();
  }, [storeLoading, loadData]);

  // Aggregate totals
  const totals = useMemo(() => {
    const totalRevenue = revenueAccounts.reduce((sum, r) => sum + r.amount, 0);
    const totalExpenses = expenseAccounts.reduce((sum, r) => sum + r.amount, 0);
    const netProfit = totalRevenue - totalExpenses;
    const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    return {
      revenue: roundMoney(totalRevenue),
      expense: roundMoney(totalExpenses),
      profit: roundMoney(netProfit),
      margin: roundMoney(margin),
    };
  }, [revenueAccounts, expenseAccounts]);

  const fmt = (n) => {
    return roundMoney(Number(n ?? 0)).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="inline-flex items-center justify-center p-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
            title="تحديث البيانات"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      }
    >
      <div className="max-w-6xl mx-auto space-y-6" dir="rtl">
        {/* Header Block */}
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/10 shrink-0">
            <TrendingUp size={26} />
          </div>
          <div>
            <h1 className="font-title text-2xl font-black text-slate-800 font-arabic">قائمة الأرباح والخسائر (Profit & Loss)</h1>
            <p className="text-sm text-slate-500 font-bold mt-0.5 leading-relaxed font-arabic">
              التقرير المالي العام لقياس الإيرادات مقابل المصروفات واحتساب صافي الأرباح التشغيلية للمتجر.
            </p>
          </div>
        </div>

        {/* Date Filters Panel */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-slate-500 border-b border-slate-100 pb-3">
            <Filter size={18} />
            <span className="text-sm font-black font-arabic">فلاتر التقرير</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Date From */}
            <div>
              <label className="block text-xs font-black text-slate-500 mb-1.5 font-arabic">من تاريخ</label>
              <div className="relative">
                <input
                  type="date"
                  value={filterFrom}
                  onInput={(e) => { e.target.value = toEnglishNumbers(e.target.value); }}
                  onChange={(e) => { e.target.value = toEnglishNumbers(e.target.value); setFilterFrom(e.target.value); }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 focus:outline-none focus:border-indigo-500 shadow-sm"
                />
              </div>
            </div>

            {/* Date To */}
            <div>
              <label className="block text-xs font-black text-slate-500 mb-1.5 font-arabic">إلى تاريخ</label>
              <div className="relative">
                <input
                  type="date"
                  value={filterTo}
                  onInput={(e) => { e.target.value = toEnglishNumbers(e.target.value); }}
                  onChange={(e) => { e.target.value = toEnglishNumbers(e.target.value); setFilterTo(e.target.value); }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 focus:outline-none focus:border-indigo-500 shadow-sm"
                />
              </div>
            </div>
          </div>

          {/* Quick Month Reset Button */}
          {(filterFrom !== defaultDates.from || filterTo !== defaultDates.to) && (
            <div className="flex justify-start pt-2">
              <button
                type="button"
                onClick={() => {
                  setFilterFrom(defaultDates.from);
                  setFilterTo(defaultDates.to);
                }}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-700 hover:underline"
              >
                إعادة التعيين للشهر الحالي
              </button>
            </div>
          )}
        </div>

        {/* Error Notification */}
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700 flex gap-2 items-center">
            <XCircle size={18} className="text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Loader */}
        {loading ? (
          <div className="flex flex-col justify-center items-center py-24 gap-3">
            <Loader2 className="animate-spin text-indigo-500" size={40} />
            <span className="text-sm font-bold text-slate-500">جاري احتساب وتجميع الإيرادات والمصروفات...</span>
          </div>
        ) : !error && (
          <div className="space-y-6">
            {/* Stats Dashboard Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Total Revenues */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center mb-3">
                  <DollarSign size={20} />
                </div>
                <p className="text-lg font-black text-slate-900 font-mono" dir="ltr">₪{fmt(totals.revenue)}</p>
                <p className="text-xs font-bold text-slate-500 mt-1 font-arabic">إجمالي الإيرادات</p>
              </div>

              {/* Total Expenses */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center mb-3">
                  <TrendingDown size={20} />
                </div>
                <p className="text-lg font-black text-slate-900 font-mono" dir="ltr">₪{fmt(totals.expense)}</p>
                <p className="text-xs font-bold text-slate-500 mt-1 font-arabic">إجمالي المصروفات</p>
              </div>

              {/* Net Profit / Loss */}
              <div className={`rounded-2xl border p-5 shadow-sm ${
                totals.profit >= 0 ? 'bg-emerald-50/30 border-emerald-200/60' : 'bg-rose-50/30 border-rose-200/60'
              }`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
                  totals.profit >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                }`}>
                  <TrendingUp size={20} className={totals.profit >= 0 ? '' : 'rotate-180'} />
                </div>
                <p className={`text-lg font-black font-mono ${
                  totals.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`} dir="ltr">
                  ₪{fmt(totals.profit)}
                </p>
                <p className="text-xs font-bold text-slate-500 mt-1 font-arabic">
                  {totals.profit >= 0 ? 'صافي الربح' : 'صافي الخسارة'}
                </p>
              </div>

              {/* Profit Margin */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center mb-3">
                  <PieChart size={20} />
                </div>
                <p className="text-lg font-black text-violet-600 font-mono" dir="ltr">
                  {totals.margin.toFixed(2)}%
                </p>
                <p className="text-xs font-bold text-slate-500 mt-1 font-arabic">هامش الربح التشغيلي</p>
              </div>
            </div>

            {/* Income Statement Sections Side-by-Side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Revenues Column */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
                <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                  <span className="font-black text-slate-800 text-sm font-arabic">1. الإيرادات (Revenues)</span>
                  <span className="text-xs font-mono font-black text-sky-600" dir="ltr">₪{fmt(totals.revenue)}</span>
                </div>

                <div className="flex-1 overflow-x-auto">
                  <table className="w-full text-sm text-right divide-y divide-slate-100">
                    <thead className="bg-slate-50/50">
                      <tr className="text-slate-500 font-black border-b border-slate-200">
                        <th className="py-2.5 px-4 text-xs font-arabic w-24">الرمز</th>
                        <th className="py-2.5 px-4 text-xs font-arabic">الحساب المالي</th>
                        <th className="py-2.5 px-4 text-xs font-arabic text-left w-32" dir="ltr">المبلغ ₪</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {revenueAccounts.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="py-8 text-center text-slate-400 font-bold font-arabic">
                            لا توجد أي حسابات إيرادات معرّفة.
                          </td>
                        </tr>
                      ) : (
                        revenueAccounts.map((acc) => (
                          <tr key={acc.id} className="hover:bg-slate-50/30 transition-colors">
                            <td className="py-2.5 px-4 font-mono text-xs text-slate-500">{acc.code}</td>
                            <td className="py-2.5 px-4 font-bold text-slate-700">{acc.name}</td>
                            <td className="py-2.5 px-4 text-left font-mono font-bold text-slate-800" dir="ltr">
                              ₪{fmt(acc.amount)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {revenueAccounts.length > 0 && (
                      <tfoot className="bg-slate-50/50 font-black text-slate-800 border-t border-slate-200">
                        <tr>
                          <td colSpan={2} className="py-2.5 px-4 font-arabic">إجمالي الإيرادات</td>
                          <td className="py-2.5 px-4 text-left font-mono font-black text-sky-600" dir="ltr">
                            ₪{fmt(totals.revenue)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              {/* Expenses Column */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
                <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                  <span className="font-black text-slate-800 text-sm font-arabic">2. المصروفات (Expenses)</span>
                  <span className="text-xs font-mono font-black text-rose-600" dir="ltr">₪{fmt(totals.expense)}</span>
                </div>

                <div className="flex-1 overflow-x-auto">
                  <table className="w-full text-sm text-right divide-y divide-slate-100">
                    <thead className="bg-slate-50/50">
                      <tr className="text-slate-500 font-black border-b border-slate-200">
                        <th className="py-2.5 px-4 text-xs font-arabic w-24">الرمز</th>
                        <th className="py-2.5 px-4 text-xs font-arabic">الحساب المالي</th>
                        <th className="py-2.5 px-4 text-xs font-arabic text-left w-32" dir="ltr">المبلغ ₪</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {expenseAccounts.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="py-8 text-center text-slate-400 font-bold font-arabic">
                            لا توجد أي حسابات مصروفات معرّفة.
                          </td>
                        </tr>
                      ) : (
                        expenseAccounts.map((acc) => (
                          <tr key={acc.id} className="hover:bg-slate-50/30 transition-colors">
                            <td className="py-2.5 px-4 font-mono text-xs text-slate-500">{acc.code}</td>
                            <td className="py-2.5 px-4 font-bold text-slate-700">{acc.name}</td>
                            <td className="py-2.5 px-4 text-left font-mono font-bold text-slate-800" dir="ltr">
                              ₪{fmt(acc.amount)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {expenseAccounts.length > 0 && (
                      <tfoot className="bg-slate-50/50 font-black text-slate-800 border-t border-slate-200">
                        <tr>
                          <td colSpan={2} className="py-2.5 px-4 font-arabic">إجمالي المصروفات</td>
                          <td className="py-2.5 px-4 text-left font-mono font-black text-rose-600" dir="ltr">
                            ₪{fmt(totals.expense)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </div>

            {/* Overall Bottom Net Result Card */}
            <div className={`rounded-2xl border p-6 flex flex-col sm:flex-row justify-between items-center gap-4 ${
              totals.profit >= 0
                ? 'bg-emerald-50/20 border-emerald-200/50 text-emerald-800'
                : 'bg-rose-50/20 border-rose-200/50 text-rose-800'
            }`}>
              <div className="space-y-1">
                <h3 className="font-black text-base font-arabic">خلاصة النشاط للفترة المحددة:</h3>
                <p className="text-xs font-bold opacity-80 leading-relaxed font-arabic">
                  تم احتساب صافي النتائج المالية التشغيلية بالاعتماد على القيود اليومية المحللة والمرحّلة في النظام.
                </p>
              </div>

              <div className="flex flex-wrap gap-4 text-center justify-center items-center">
                <div className="bg-white/80 dark:bg-black/30 border border-slate-200/60 rounded-xl px-4 py-2">
                  <p className="text-[10px] font-bold text-slate-500 font-arabic">إجمالي الإيرادات</p>
                  <p className="text-sm font-black font-mono text-sky-600" dir="ltr">₪{fmt(totals.revenue)}</p>
                </div>
                <div className="bg-white/80 dark:bg-black/30 border border-slate-200/60 rounded-xl px-4 py-2">
                  <p className="text-[10px] font-bold text-slate-500 font-arabic">إجمالي المصروفات</p>
                  <p className="text-sm font-black font-mono text-rose-600" dir="ltr">₪{fmt(totals.expense)}</p>
                </div>
                <div className="bg-white/80 dark:bg-black/30 border border-slate-200/60 rounded-xl px-4 py-2">
                  <p className="text-[10px] font-bold text-slate-500 font-arabic">صافي الربح / الخسارة</p>
                  <p className={`text-sm font-black font-mono ${totals.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} dir="ltr">
                    ₪{fmt(totals.profit)} {totals.profit >= 0 ? '(ربح ✓)' : '(خسارة ✗)'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
