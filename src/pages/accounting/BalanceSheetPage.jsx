import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Filter,
  Loader2,
  RefreshCw,
  Scale,
  CheckCircle,
  XCircle,
  Info,
  TrendingUp,
  Landmark,
} from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { supabase } from '../../lib/supabaseClient';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { roundMoney } from '../../utils/productModel';

const ACCOUNTS_TABLE = 'accounting_accounts';
const JOURNAL_LINES_TABLE = 'accounting_journal_lines';

const getTodayDate = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const toEnglishNumbers = (str) => {
  return String(str).replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => d.charCodeAt(0) - 1632)
                    .replace(/[۰۱۲۳۴۵۶۷۸۹]/g, d => d.charCodeAt(0) - 1776);
};

export default function BalanceSheetPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();

  const [accounts, setAccounts] = useState([]);
  const [journalLines, setJournalLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filter: As of Date (default: today)
  const [filterDate, setFilterDate] = useState(() => getTodayDate());

  // Fetch accounts and posted lines
  const loadData = useCallback(async () => {
    if (!store?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch active accounts
      const { data: accData, error: accErr } = await supabase
        .from(ACCOUNTS_TABLE)
        .select('id, code, name, type, category')
        .eq('store_id', store.id)
        .eq('is_active', true)
        .order('code', { ascending: true });

      if (accErr) throw accErr;

      // 2. Fetch posted lines up to filterDate
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

      if (filterDate) {
        q = q.lte('accounting_journal.date', filterDate);
      }

      const { data: linesData, error: linesErr } = await q;
      if (linesErr) throw linesErr;

      setAccounts(accData || []);
      setJournalLines(linesData || []);
    } catch (e) {
      console.error(e);
      setError(e.message || 'تعذر تحميل الميزانية العمومية');
      setAccounts([]);
      setJournalLines([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id, filterDate]);

  useEffect(() => {
    if (storeLoading) return;
    loadData();
  }, [storeLoading, loadData]);

  // Aggregate and partition values
  const balanceSheetReport = useMemo(() => {
    // 1. Calculate net balances per account id
    const netBalances = {};
    journalLines.forEach((l) => {
      const accId = l.account_id;
      if (!netBalances[accId]) {
        netBalances[accId] = { debit: 0, credit: 0 };
      }
      netBalances[accId].debit += Number(l.debit || 0);
      netBalances[accId].credit += Number(l.credit || 0);
    });

    // 2. Group accounts and calculate net values
    let currentAssets = [];
    let fixedAssets = [];
    let currentLiabilities = [];
    let longTermLiabilities = [];
    let equity = [];

    // Profit & Loss helper (Revenue - Expenses) to calculate Current Period Net Income
    let totalRevenueSum = 0;
    let totalExpenseSum = 0;

    accounts.forEach((acc) => {
      const sums = netBalances[acc.id] || { debit: 0, credit: 0 };
      const debit = roundMoney(sums.debit);
      const credit = roundMoney(sums.credit);

      // Natural values calculation
      const isDebitNatural = acc.type === 'asset' || acc.type === 'expense';
      let balanceAmount = 0;
      if (isDebitNatural) {
        balanceAmount = debit - credit;
      } else {
        balanceAmount = credit - debit;
      }
      balanceAmount = roundMoney(balanceAmount);

      // P&L calculation
      if (acc.type === 'revenue') {
        totalRevenueSum += balanceAmount;
        return;
      }
      if (acc.type === 'expense') {
        totalExpenseSum += balanceAmount;
        return;
      }

      const row = {
        id: acc.id,
        code: acc.code,
        name: acc.name,
        amount: balanceAmount,
      };

      if (acc.type === 'asset') {
        // Classify Current vs Fixed Asset
        const isCurrent =
          acc.code.startsWith('10') ||
          acc.code.startsWith('11') ||
          acc.code.startsWith('12') ||
          String(acc.category || '').includes('متداول') ||
          String(acc.category || '').includes('نقد') ||
          String(acc.category || '').includes('مخزون') ||
          String(acc.category || '').includes('ذمم');

        if (isCurrent) {
          currentAssets.push(row);
        } else {
          fixedAssets.push(row);
        }
      } else if (acc.type === 'liability') {
        // Classify Current vs Longterm Liability
        const isCurrent =
          acc.code.startsWith('20') ||
          acc.code.startsWith('21') ||
          acc.code.startsWith('22') ||
          String(acc.category || '').includes('متداول') ||
          String(acc.category || '').includes('دائن') ||
          String(acc.category || '').includes('ذمم');

        if (isCurrent) {
          currentLiabilities.push(row);
        } else {
          longTermLiabilities.push(row);
        }
      } else if (acc.type === 'equity') {
        equity.push(row);
      }
    });

    // 3. Compute current Net Income/Loss & inject in Equity
    const netIncome = roundMoney(totalRevenueSum - totalExpenseSum);
    equity.push({
      id: 'net-income-summary-row',
      code: '3999',
      name: 'صافي أرباح / خسائر الفترة الحالية',
      amount: netIncome,
    });

    // 4. Calculate sub totals
    const sumCurrentAssets = currentAssets.reduce((sum, r) => sum + r.amount, 0);
    const sumFixedAssets = fixedAssets.reduce((sum, r) => sum + r.amount, 0);
    const totalAssets = sumCurrentAssets + sumFixedAssets;

    const sumCurrentLiabs = currentLiabilities.reduce((sum, r) => sum + r.amount, 0);
    const sumLongLiabs = longTermLiabilities.reduce((sum, r) => sum + r.amount, 0);
    const sumEquity = equity.reduce((sum, r) => sum + r.amount, 0);
    const totalLiabsEquity = sumCurrentLiabs + sumLongLiabs + sumEquity;

    return {
      currentAssets,
      fixedAssets,
      currentLiabilities,
      longTermLiabilities,
      equity,
      sumCurrentAssets: roundMoney(sumCurrentAssets),
      sumFixedAssets: roundMoney(sumFixedAssets),
      totalAssets: roundMoney(totalAssets),
      sumCurrentLiabs: roundMoney(sumCurrentLiabs),
      sumLongLiabs: roundMoney(sumLongLiabs),
      sumEquity: roundMoney(sumEquity),
      totalLiabsEquity: roundMoney(totalLiabsEquity),
      balanced: Math.abs(totalAssets - totalLiabsEquity) < 0.01,
    };
  }, [accounts, journalLines]);

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
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/10 shrink-0">
              <Landmark size={26} />
            </div>
            <div>
              <h1 className="font-title text-2xl font-black text-slate-800 font-arabic">الميزانية العمومية (Balance Sheet)</h1>
              <p className="text-sm text-slate-500 font-bold mt-0.5 leading-relaxed font-arabic">
                المركز المالي الشامل للمتجر في لحظة زمنية معينة. يقيس الأصول مقابل الخصوم وحقوق الملكية.
              </p>
            </div>
          </div>

          {/* Balanced Status Badge */}
          {!loading && !error && accounts.length > 0 && (
            <div className={`inline-flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-black border shadow-sm ${
              balanceSheetReport.balanced
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}>
              {balanceSheetReport.balanced ? (
                <>
                  <CheckCircle size={18} className="text-emerald-600" />
                  <span>الميزانية متوازنة ✓</span>
                </>
              ) : (
                <>
                  <XCircle size={18} className="text-rose-600" />
                  <span>الميزانية غير متوازنة ✗ (فرق: ₪{fmt(Math.abs(balanceSheetReport.totalAssets - balanceSheetReport.totalLiabsEquity))})</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Date Filter Panel */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-slate-500 border-b border-slate-100 pb-3">
            <Calendar size={18} />
            <span className="text-sm font-black font-arabic">تاريخ المركز المالي</span>
          </div>

          <div className="max-w-xs">
            <label className="block text-xs font-black text-slate-500 mb-1.5 font-arabic">حتى تاريخ (As of Date)</label>
            <input
              type="date"
              value={filterDate}
              onInput={(e) => { e.target.value = toEnglishNumbers(e.target.value); }}
              onChange={(e) => { e.target.value = toEnglishNumbers(e.target.value); setFilterDate(e.target.value); }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 focus:outline-none focus:border-indigo-500 shadow-sm"
            />
          </div>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700 flex gap-2 items-center">
            <XCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {/* Data Loading */}
        {loading ? (
          <div className="flex flex-col justify-center items-center py-24 gap-3">
            <Loader2 className="animate-spin text-indigo-500" size={40} />
            <span className="text-sm font-bold text-slate-500">جاري احتساب وتجميع حركات الميزانية...</span>
          </div>
        ) : !error && accounts.length === 0 ? (
          <div className="text-center py-16 text-slate-400 font-bold border border-dashed border-slate-200 rounded-2xl bg-slate-50/50 font-arabic">
            لا توجد أي حسابات مالية مسجّلة لتوليد الميزانية العمومية.
          </div>
        ) : !error && (
          <div className="space-y-6">
            {/* Info Message */}
            <div className="rounded-2xl bg-indigo-50/40 border border-indigo-100 p-4 flex gap-3 items-start text-indigo-900 font-arabic text-xs">
              <Info size={16} className="text-indigo-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-black">ملاحظة حول ميزان المركز المالي:</p>
                <p className="font-bold text-indigo-700 mt-1 leading-relaxed">
                  صافي أرباح/خسائر الفترة المحتسبة من الإيرادات والمصروفات حتى تاريخ {filterDate} يتم إدراجها تلقائياً تحت بند حقوق الملكية باسم "صافي أرباح / خسائر الفترة الحالية" لتحقيق التوازن بين جانبي الميزانية.
                </p>
              </div>
            </div>

            {/* Side by Side Layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* RIGHT Column: الخصوم وحقوق الملكية */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col p-5 space-y-6">
                <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
                  <h3 className="font-black text-slate-800 text-sm font-arabic">الجانب الأيسر: الخصوم وحقوق الملكية</h3>
                  <span className="text-xs font-mono font-black text-indigo-600" dir="ltr">
                    ₪{fmt(balanceSheetReport.totalLiabsEquity)}
                  </span>
                </div>

                {/* 1. Current Liabilities */}
                <div className="space-y-2.5">
                  <h4 className="font-bold text-xs text-slate-400 font-arabic uppercase tracking-wider">أولاً: الخصوم المتداولة</h4>
                  <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                    {balanceSheetReport.currentLiabilities.length === 0 ? (
                      <p className="text-xs text-slate-400 py-3 text-center">لا توجد خصوم متداولة</p>
                    ) : (
                      balanceSheetReport.currentLiabilities.map((r) => (
                        <div key={r.id} className="flex justify-between items-center px-4 py-2.5 text-xs">
                          <span className="font-bold text-slate-700">{r.name} <span className="font-mono text-[10px] text-slate-400">[{r.code}]</span></span>
                          <span className="font-mono font-bold text-slate-800" dir="ltr">₪{fmt(r.amount)}</span>
                        </div>
                      ))
                    )}
                    <div className="flex justify-between items-center px-4 py-2.5 text-xs bg-slate-50 font-black text-slate-800">
                      <span>إجمالي الخصوم المتداولة</span>
                      <span className="font-mono" dir="ltr">₪{fmt(balanceSheetReport.sumCurrentLiabs)}</span>
                    </div>
                  </div>
                </div>

                {/* 2. Longterm Liabilities */}
                <div className="space-y-2.5">
                  <h4 className="font-bold text-xs text-slate-400 font-arabic uppercase tracking-wider">ثانياً: القروض والالتزامات طويلة الأجل</h4>
                  <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                    {balanceSheetReport.longTermLiabilities.length === 0 ? (
                      <p className="text-xs text-slate-400 py-3 text-center">لا توجد قروض طويلة الأجل</p>
                    ) : (
                      balanceSheetReport.longTermLiabilities.map((r) => (
                        <div key={r.id} className="flex justify-between items-center px-4 py-2.5 text-xs">
                          <span className="font-bold text-slate-700">{r.name} <span className="font-mono text-[10px] text-slate-400">[{r.code}]</span></span>
                          <span className="font-mono font-bold text-slate-800" dir="ltr">₪{fmt(r.amount)}</span>
                        </div>
                      ))
                    )}
                    <div className="flex justify-between items-center px-4 py-2.5 text-xs bg-slate-50 font-black text-slate-800">
                      <span>إجمالي الالتزامات طويلة الأجل</span>
                      <span className="font-mono" dir="ltr">₪{fmt(balanceSheetReport.sumLongLiabs)}</span>
                    </div>
                  </div>
                </div>

                {/* 3. Equity */}
                <div className="space-y-2.5">
                  <h4 className="font-bold text-xs text-slate-400 font-arabic uppercase tracking-wider">ثالثاً: حقوق الملكية</h4>
                  <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                    {balanceSheetReport.equity.map((r) => (
                      <div key={r.id} className={`flex justify-between items-center px-4 py-2.5 text-xs ${r.id === 'net-income-summary-row' ? 'bg-indigo-50/30' : ''}`}>
                        <span className="font-bold text-slate-700">
                          {r.name}{' '}
                          {r.id !== 'net-income-summary-row' && (
                            <span className="font-mono text-[10px] text-slate-400">[{r.code}]</span>
                          )}
                        </span>
                        <span className={`font-mono font-bold ${r.id === 'net-income-summary-row' ? 'text-indigo-600' : 'text-slate-800'}`} dir="ltr">
                          ₪{fmt(r.amount)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center px-4 py-2.5 text-xs bg-slate-50 font-black text-slate-800">
                      <span>إجمالي حقوق الملكية</span>
                      <span className="font-mono" dir="ltr">₪{fmt(balanceSheetReport.sumEquity)}</span>
                    </div>
                  </div>
                </div>

                {/* Right Side Total */}
                <div className="pt-4 border-t border-slate-100 flex justify-between items-center font-black text-sm text-indigo-700 font-arabic">
                  <span>إجمالي الخصوم وحقوق الملكية</span>
                  <span className="font-mono text-base" dir="ltr">₪{fmt(balanceSheetReport.totalLiabsEquity)}</span>
                </div>
              </div>

              {/* LEFT Column: الأصول */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col p-5 space-y-6">
                <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
                  <h3 className="font-black text-slate-800 text-sm font-arabic">الجانب الأيمن: الأصول (Assets)</h3>
                  <span className="text-xs font-mono font-black text-indigo-600" dir="ltr">
                    ₪{fmt(balanceSheetReport.totalAssets)}
                  </span>
                </div>

                {/* 1. Current Assets */}
                <div className="space-y-2.5">
                  <h4 className="font-bold text-xs text-slate-400 font-arabic uppercase tracking-wider">أولاً: الأصول المتداولة</h4>
                  <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                    {balanceSheetReport.currentAssets.length === 0 ? (
                      <p className="text-xs text-slate-400 py-3 text-center">لا توجد أصول متداولة</p>
                    ) : (
                      balanceSheetReport.currentAssets.map((r) => (
                        <div key={r.id} className="flex justify-between items-center px-4 py-2.5 text-xs">
                          <span className="font-bold text-slate-700">{r.name} <span className="font-mono text-[10px] text-slate-400">[{r.code}]</span></span>
                          <span className="font-mono font-bold text-slate-800" dir="ltr">₪{fmt(r.amount)}</span>
                        </div>
                      ))
                    )}
                    <div className="flex justify-between items-center px-4 py-2.5 text-xs bg-slate-50 font-black text-slate-800">
                      <span>إجمالي الأصول المتداولة</span>
                      <span className="font-mono" dir="ltr">₪{fmt(balanceSheetReport.sumCurrentAssets)}</span>
                    </div>
                  </div>
                </div>

                {/* 2. Fixed Assets */}
                <div className="space-y-2.5">
                  <h4 className="font-bold text-xs text-slate-400 font-arabic uppercase tracking-wider">ثانياً: الأصول الثابتة وطويلة الأجل</h4>
                  <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                    {balanceSheetReport.fixedAssets.length === 0 ? (
                      <p className="text-xs text-slate-400 py-3 text-center">لا توجد أصول ثابتة</p>
                    ) : (
                      balanceSheetReport.fixedAssets.map((r) => (
                        <div key={r.id} className="flex justify-between items-center px-4 py-2.5 text-xs">
                          <span className="font-bold text-slate-700">{r.name} <span className="font-mono text-[10px] text-slate-400">[{r.code}]</span></span>
                          <span className="font-mono font-bold text-slate-800" dir="ltr">₪{fmt(r.amount)}</span>
                        </div>
                      ))
                    )}
                    <div className="flex justify-between items-center px-4 py-2.5 text-xs bg-slate-50 font-black text-slate-800">
                      <span>إجمالي الأصول الثابتة</span>
                      <span className="font-mono" dir="ltr">₪{fmt(balanceSheetReport.sumFixedAssets)}</span>
                    </div>
                  </div>
                </div>

                {/* Left Side Total */}
                <div className="pt-4 border-t border-slate-100 flex justify-between items-center font-black text-sm text-indigo-700 font-arabic md:mt-auto">
                  <span>إجمالي الأصول</span>
                  <span className="font-mono text-base" dir="ltr">₪{fmt(balanceSheetReport.totalAssets)}</span>
                </div>
              </div>
            </div>

            {/* Bottom Balance Check Summary Box */}
            <div className={`rounded-2xl border p-6 flex flex-col sm:flex-row justify-between items-center gap-4 ${
              balanceSheetReport.balanced
                ? 'bg-emerald-50/20 border-emerald-200/50 text-emerald-800'
                : 'bg-rose-50/20 border-rose-200/50 text-rose-800'
            }`}>
              <div className="space-y-1">
                <h3 className="font-black text-base font-arabic">ميزان المعادلة المحاسبية:</h3>
                <p className="text-xs font-bold opacity-80 leading-relaxed font-arabic">
                  المعادلة المحاسبية الأساسية: الأصول (₪{fmt(balanceSheetReport.totalAssets)}) = الخصوم + حقوق الملكية (₪{fmt(balanceSheetReport.totalLiabsEquity)}).
                </p>
              </div>

              <div className="flex items-center gap-2">
                {balanceSheetReport.balanced ? (
                  <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 font-black px-5 py-2.5 rounded-xl text-sm font-arabic">
                    <CheckCircle size={18} className="text-emerald-600" />
                    <span>الميزانية متوازنة ✓</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 font-black px-5 py-2.5 rounded-xl text-sm font-arabic">
                    <XCircle size={18} className="text-rose-600" />
                    <span>غير متوازنة ✗ (الفرق: ₪{fmt(Math.abs(balanceSheetReport.totalAssets - balanceSheetReport.totalLiabsEquity))})</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
