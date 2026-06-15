import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Filter,
  Loader2,
  RefreshCw,
  Scale,
  Search,
  CheckCircle,
  XCircle,
  Info,
} from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { supabase } from '../../lib/supabaseClient';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { roundMoney } from '../../utils/productModel';

const TYPE_META = {
  asset: { label: 'أصول', colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  liability: { label: 'خصوم', colorClass: 'bg-rose-50 text-rose-700 border-rose-100' },
  equity: { label: 'حقوق الملكية', colorClass: 'bg-amber-50 text-amber-700 border-amber-100' },
  revenue: { label: 'إيرادات', colorClass: 'bg-sky-50 text-sky-700 border-sky-100' },
  expense: { label: 'مصروفات', colorClass: 'bg-violet-50 text-violet-700 border-violet-100' },
};

const toEnglishNumbers = (str) => {
  return String(str).replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => d.charCodeAt(0) - 1632)
                    .replace(/[۰۱۲۳۴۵۶۷۸۹]/g, d => d.charCodeAt(0) - 1776);
};

export default function TrialBalancePage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch and aggregate trial balance rows
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
        .from('accounting_accounts')
        .select('id, code, name, type')
        .eq('store_id', store.id)
        .eq('is_active', true)
        .order('code', { ascending: true });

      if (accErr) throw accErr;

      // 2. Fetch posted journal lines falling inside dates
      let q = supabase
        .from('accounting_journal_lines')
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

      // 3. Aggregate debits and credits per account in memory
      const debitCredits = {};
      (linesData || []).forEach((line) => {
        const accId = line.account_id;
        if (!debitCredits[accId]) {
          debitCredits[accId] = { debit: 0, credit: 0 };
        }
        debitCredits[accId].debit += Number(line.debit || 0);
        debitCredits[accId].credit += Number(line.credit || 0);
      });

      // 4. Map to UI rows
      const mappedRows = (accData || [])
        .map((acc) => {
          const sums = debitCredits[acc.id] || { debit: 0, credit: 0 };
          const debit = roundMoney(sums.debit);
          const credit = roundMoney(sums.credit);

          // Calculate net balance: Asset/Expense is Debit-natural, others are Credit-natural
          const isDebitNatural = acc.type === 'asset' || acc.type === 'expense';
          let balance = 0;
          if (isDebitNatural) {
            balance = debit - credit;
          } else {
            balance = credit - debit;
          }

          return {
            id: acc.id,
            code: acc.code,
            name: acc.name,
            type: acc.type,
            debit,
            credit,
            balance: roundMoney(balance),
            isDebitNatural,
          };
        })
        // Only show accounts with movements (debit > 0 or credit > 0)
        .filter((row) => row.debit > 0 || row.credit > 0);

      setRows(mappedRows);
    } catch (e) {
      console.error(e);
      setError(e.message || 'تعذر تحميل ميزان المراجعة');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id, filterFrom, filterTo]);

  useEffect(() => {
    if (storeLoading) return;
    loadData();
  }, [storeLoading, loadData]);

  // Totals calculations
  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    rows.forEach((r) => {
      debit += r.debit;
      credit += r.credit;
    });
    return {
      debit: roundMoney(debit),
      credit: roundMoney(credit),
      balanced: Math.abs(debit - credit) < 0.01,
    };
  }, [rows]);

  // Filter table rows by search query
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q)
    );
  }, [rows, searchQuery]);

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
              <Scale size={26} />
            </div>
            <div>
              <h1 className="font-title text-2xl font-black text-slate-800 font-arabic">ميزان المراجعة (Trial Balance)</h1>
              <p className="text-sm text-slate-500 font-bold mt-0.5 leading-relaxed font-arabic">
                ملخص إجمالي الحركات المدينة والدائنة والأرصدة لجميع الحسابات النشطة التي بها حركات مرحّلة.
              </p>
            </div>
          </div>

          {/* Balanced Status Banner */}
          {!loading && !error && rows.length > 0 && (
            <div className={`inline-flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-black border shadow-sm ${
              totals.balanced
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}>
              {totals.balanced ? (
                <>
                  <CheckCircle size={18} className="text-emerald-600" />
                  <span>ميزان المراجعة متوازن ✓</span>
                </>
              ) : (
                <>
                  <XCircle size={18} className="text-rose-600" />
                  <span>ميزان المراجعة غير متوازن ✗ (فرق: ₪{fmt(Math.abs(totals.debit - totals.credit))})</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Filters Panel */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-slate-500 border-b border-slate-100 pb-3">
            <Filter size={18} />
            <span className="text-sm font-black font-arabic">فلاتر الميزان</span>
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

          {/* Quick Clear Buttons */}
          {(filterFrom || filterTo) && (
            <div className="flex justify-start pt-2">
              <button
                type="button"
                onClick={() => {
                  setFilterFrom('');
                  setFilterTo('');
                }}
                className="text-xs font-bold text-rose-500 hover:text-rose-600 hover:underline"
              >
                إلغاء فلاتر التواريخ
              </button>
            </div>
          )}
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
            <span className="text-sm font-bold text-slate-500">جاري احتساب وتجميع حركات الميزان...</span>
          </div>
        ) : !error && rows.length === 0 ? (
          <div className="text-center py-16 text-slate-400 font-bold border border-dashed border-slate-200 rounded-2xl bg-slate-50/50 font-arabic">
            لا توجد أي حركات مرحّلة مسجّلة في النظام لتوليد ميزان المراجعة.
          </div>
        ) : !error ? (
          <div className="space-y-6">
            {/* Summary Banner Info */}
            <div className="rounded-2xl bg-indigo-50/40 border border-indigo-100 p-4 flex gap-3 items-start text-indigo-900 font-arabic text-xs">
              <Info size={16} className="text-indigo-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-black">ملاحظة محاسبية حول ميزان المراجعة:</p>
                <p className="font-bold text-indigo-700 mt-1 leading-relaxed">
                  يحتوي هذا الكشف فقط على الحسابات المالية التي تمت عليها حركات (حركات مدينة أو دائنة أكبر من الصفر) في الفترة المحددة.
                  في ميزان المراجعة المزدوج المتكامل، يجب دائماً أن يتطابق إجمالي الأرصدة المدينة مع إجمالي الأرصدة الدائنة.
                </p>
              </div>
            </div>

            {/* Trial Balance Table Card */}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              {/* Toolbar */}
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-center gap-3">
                <span className="font-black text-slate-700 text-sm font-arabic">
                  بنود الميزان للأرصدة والحركات ({filteredRows.length})
                </span>
                {/* Internal Search */}
                <div className="relative w-full sm:w-64">
                  <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onInput={(e) => { e.target.value = toEnglishNumbers(e.target.value); }}
                    onChange={(e) => { e.target.value = toEnglishNumbers(e.target.value); setSearchQuery(e.target.value); }}
                    placeholder="بحث برمز أو اسم الحساب..."
                    className="w-full rounded-lg border border-slate-200 bg-white pr-9 pl-3 py-1.5 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:border-indigo-500 shadow-sm"
                  />
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right min-w-[750px] divide-y divide-slate-100">
                  <thead className="bg-slate-50">
                    <tr className="text-slate-500 font-black border-b border-slate-200">
                      <th className="py-3 px-5 text-xs font-arabic w-32">رقم الحساب</th>
                      <th className="py-3 px-5 text-xs font-arabic">اسم الحساب</th>
                      <th className="py-3 px-5 text-xs font-arabic text-center w-28">النوع</th>
                      <th className="py-3 px-5 text-xs font-arabic text-center w-36" dir="ltr">إجمالي المدين ₪</th>
                      <th className="py-3 px-5 text-xs font-arabic text-center w-36" dir="ltr">إجمالي الدائن ₪</th>
                      <th className="py-3 px-5 text-xs font-arabic text-center w-40" dir="ltr">الرصيد النهائي ₪</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-slate-400 font-bold font-arabic">
                          لا توجد حسابات تطابق البحث.
                        </td>
                      </tr>
                    ) : (
                      filteredRows.map((row) => {
                        const typeMeta = TYPE_META[row.type] || { label: row.type, colorClass: '' };
                        return (
                          <tr key={row.id} className="hover:bg-slate-50/50 transition-colors text-slate-700">
                            <td className="py-3 px-5 font-mono text-xs">
                              <span className="font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded">
                                {row.code}
                              </span>
                            </td>
                            <td className="py-3 px-5 font-bold text-slate-800">
                              {row.name}
                            </td>
                            <td className="py-3 px-5 text-center">
                              <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-black border ${typeMeta.colorClass}`}>
                                {typeMeta.label}
                              </span>
                            </td>
                            <td className="py-3 px-5 text-center font-bold text-emerald-600 font-mono" dir="ltr">
                              {row.debit > 0 ? fmt(row.debit) : '—'}
                            </td>
                            <td className="py-3 px-5 text-center font-bold text-rose-600 font-mono" dir="ltr">
                              {row.credit > 0 ? fmt(row.credit) : '—'}
                            </td>
                            <td className="py-3 px-5 text-center font-black font-mono text-slate-700" dir="ltr">
                              {row.balance === 0 ? '0.00' : (
                                <span className={row.balance > 0 ? 'text-indigo-600' : 'text-slate-500'}>
                                  ₪{fmt(row.balance)} {row.isDebitNatural ? '(مدين)' : '(دائن)'}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {/* Totals Row */}
                  <tfoot className="bg-slate-50/80 font-black text-slate-800 border-t-2 border-slate-200">
                    <tr>
                      <td colSpan={3} className="py-3.5 px-5 text-left font-arabic">الإجمالي العام</td>
                      <td className="py-3.5 px-5 text-center font-mono text-emerald-600" dir="ltr">
                        ₪{fmt(totals.debit)}
                      </td>
                      <td className="py-3.5 px-5 text-center font-mono text-rose-600" dir="ltr">
                        ₪{fmt(totals.credit)}
                      </td>
                      <td className={`py-3.5 px-5 text-center font-arabic ${totals.balanced ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {totals.balanced ? 'متوازن ✓' : 'غير متوازن ✗'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
