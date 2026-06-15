import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Filter,
  Loader2,
  RefreshCw,
  BookOpen,
  Scale,
  ArrowUpRight,
  ArrowDownLeft,
  Info,
  ChevronDown,
  Search,
} from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { supabase } from '../../lib/supabaseClient';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { roundMoney } from '../../utils/productModel';

const ACCOUNTS_TABLE = 'accounting_accounts';
const JOURNAL_LINES_TABLE = 'accounting_journal_lines';

const toEnglishNumbers = (str) => {
  return String(str).replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => d.charCodeAt(0) - 1632)
                    .replace(/[۰۱۲۳۴۵۶۷۸۹]/g, d => d.charCodeAt(0) - 1776);
};

const TYPE_LABELS = {
  asset: 'أصول',
  liability: 'خصوم',
  equity: 'حقوق الملكية',
  revenue: 'إيرادات',
  expense: 'مصروفات',
};

export default function GeneralLedgerPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();

  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingLedger, setLoadingLedger] = useState(false);

  // Filters
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [tableSearch, setTableSearch] = useState('');

  // Ledger Lines Data
  const [allLines, setAllLines] = useState([]);

  // Fetch active accounts list
  const loadAccounts = useCallback(async () => {
    if (!store?.id) {
      setLoadingAccounts(false);
      return;
    }
    setLoadingAccounts(true);
    try {
      const { data, error } = await supabase
        .from(ACCOUNTS_TABLE)
        .select('id, code, name, type, parent_id')
        .eq('store_id', store.id)
        .eq('is_active', true)
        .order('code', { ascending: true });

      if (error) throw error;
      setAccounts(data || []);
      
      // Default to the first account if none is selected
      if (data?.length > 0) {
        setSelectedAccountId(data[0].id);
      }
    } catch (e) {
      console.error(e);
      toast.error('تعذر تحميل الحسابات المحاسبية');
      setAccounts([]);
    } finally {
      setLoadingAccounts(false);
    }
  }, [store?.id, toast]);

  // Load ledger lines for the selected account
  const loadLedger = useCallback(async () => {
    if (!store?.id || !selectedAccountId) {
      setAllLines([]);
      return;
    }
    setLoadingLedger(true);
    try {
      const { data, error } = await supabase
        .from(JOURNAL_LINES_TABLE)
        .select(`
          id,
          debit,
          credit,
          description,
          accounting_journal!inner (
            id,
            entry_number,
            date,
            description,
            status,
            created_at
          )
        `)
        .eq('account_id', selectedAccountId)
        .eq('accounting_journal.status', 'posted');

      if (error) throw error;

      // Sort chronologically by date, then by created_at timestamp
      const sortedLines = (data || []).sort((a, b) => {
        const dateA = new Date(a.accounting_journal.date);
        const dateB = new Date(b.accounting_journal.date);
        if (dateA.getTime() !== dateB.getTime()) {
          return dateA.getTime() - dateB.getTime();
        }
        const timeA = new Date(a.accounting_journal.created_at).getTime();
        const timeB = new Date(b.accounting_journal.created_at).getTime();
        return timeA - timeB;
      });

      setAllLines(sortedLines);
    } catch (e) {
      console.error(e);
      toast.error('تعذر تحميل كشف الأستاذ العام');
      setAllLines([]);
    } finally {
      setLoadingLedger(false);
    }
  }, [store?.id, selectedAccountId, toast]);

  useEffect(() => {
    if (storeLoading) return;
    loadAccounts();
  }, [storeLoading, loadAccounts]);

  useEffect(() => {
    if (storeLoading) return;
    loadLedger();
  }, [storeLoading, selectedAccountId, loadLedger]);

  // Active account metadata
  const selectedAccount = useMemo(() => {
    return accounts.find((a) => a.id === selectedAccountId);
  }, [accounts, selectedAccountId]);

  const accountType = selectedAccount?.type || 'asset';
  const isDebitNatural = accountType === 'asset' || accountType === 'expense';

  // Process data (Opening balance, In range running balances, closing totals)
  const ledgerReport = useMemo(() => {
    let openingBalance = 0;
    let prevDebits = 0;
    let prevCredits = 0;

    // 1. Calculate opening balance (all posted transactions prior to filterFrom)
    allLines.forEach((l) => {
      if (filterFrom && l.accounting_journal.date < filterFrom) {
        prevDebits += Number(l.debit || 0);
        prevCredits += Number(l.credit || 0);
      }
    });

    if (isDebitNatural) {
      openingBalance = prevDebits - prevCredits;
    } else {
      openingBalance = prevCredits - prevDebits;
    }

    // 2. Process all lines to compute running balances in range
    let running = openingBalance;
    let totalDebit = 0;
    let totalCredit = 0;

    const inRangeLines = [];

    allLines.forEach((l) => {
      const date = l.accounting_journal.date;
      const debit = Number(l.debit || 0);
      const credit = Number(l.credit || 0);

      // We calculate running balance sequentially for ALL lines up to the end of range
      const isBeforeFrom = filterFrom && date < filterFrom;
      const isAfterTo = filterTo && date > filterTo;

      if (isBeforeFrom) return; // skip but running was already updated/accounted for

      if (isDebitNatural) {
        running += debit - credit;
      } else {
        running += credit - debit;
      }

      if (!isAfterTo) {
        totalDebit += debit;
        totalCredit += credit;

        inRangeLines.push({
          id: l.id,
          date,
          entry_number: l.accounting_journal.entry_number,
          journal_description: l.accounting_journal.description,
          line_description: l.description,
          debit,
          credit,
          running_balance: running,
        });
      }
    });

    // 3. Search filter inside table
    const filteredLines = inRangeLines.filter((l) => {
      if (!tableSearch.trim()) return true;
      const q = tableSearch.toLowerCase();
      return (
        String(l.entry_number || '').toLowerCase().includes(q) ||
        String(l.journal_description || '').toLowerCase().includes(q) ||
        String(l.line_description || '').toLowerCase().includes(q)
      );
    });

    return {
      openingBalance: roundMoney(openingBalance),
      totalDebit: roundMoney(totalDebit),
      totalCredit: roundMoney(totalCredit),
      closingBalance: roundMoney(running),
      lines: filteredLines,
    };
  }, [allLines, filterFrom, filterTo, isDebitNatural, tableSearch]);

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
            onClick={loadLedger}
            disabled={loadingLedger}
            className="inline-flex items-center justify-center p-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
            title="تحديث البيانات"
          >
            <RefreshCw size={18} className={loadingLedger ? 'animate-spin' : ''} />
          </button>
        </div>
      }
    >
      <div className="max-w-6xl mx-auto space-y-6" dir="rtl">
        {/* Header Block */}
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/10 shrink-0">
            <BookOpen size={26} />
          </div>
          <div>
            <h1 className="font-title text-2xl font-black text-slate-800 font-arabic">دفتر الأستاذ العام (General Ledger)</h1>
            <p className="text-sm text-slate-500 font-bold mt-0.5 leading-relaxed font-arabic">
              كشف تفصيلي لحركات الحسابات المالية المرحّلة. تتبع الحركات والمدفوعات والرصيد التراكمي.
            </p>
          </div>
        </div>

        {/* Filters Panel */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-slate-500 border-b border-slate-100 pb-3">
            <Filter size={18} />
            <span className="text-sm font-black font-arabic">فلاتر التقارير</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            {/* Account Selector */}
            <div>
              <label className="block text-xs font-black text-slate-500 mb-1.5 font-arabic">الحساب المالي</label>
              <div className="relative">
                {loadingAccounts ? (
                  <div className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-400 flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    <span>جاري تحميل الحسابات...</span>
                  </div>
                ) : (
                  <select
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-3 pl-8 text-sm font-bold text-slate-700 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm"
                  >
                    <option value="" disabled>اختر حساباً مالياً...</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        [{acc.code}] - {acc.name} ({TYPE_LABELS[acc.type] || acc.type})
                      </option>
                    ))}
                  </select>
                )}
                <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <ChevronDown size={16} />
                </div>
              </div>
            </div>

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

        {/* Ledger Sheet Content */}
        {!selectedAccountId ? (
          <div className="text-center py-16 text-slate-400 font-bold border border-dashed border-slate-200 rounded-2xl bg-slate-50/50 font-arabic">
            يرجى تحديد حساب مالي من القائمة بالأعلى لعرض دفتر الأستاذ العام.
          </div>
        ) : loadingLedger ? (
          <div className="flex flex-col justify-center items-center py-24 gap-3">
            <Loader2 className="animate-spin text-indigo-500" size={40} />
            <span className="text-sm font-bold text-slate-500">جاري جلب تفاصيل حركات الأستاذ...</span>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Stats Dashboard Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Opening Balance */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-500 flex items-center justify-center mb-3">
                  <Scale size={20} />
                </div>
                <p className="text-lg font-black text-slate-900 font-mono" dir="ltr">₪{fmt(ledgerReport.openingBalance)}</p>
                <p className="text-xs font-bold text-slate-500 mt-1 font-arabic">الرصيد الافتتاحي</p>
              </div>

              {/* Total Debit */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
                  <ArrowUpRight size={20} />
                </div>
                <p className="text-lg font-black text-emerald-600 font-mono" dir="ltr">₪{fmt(ledgerReport.totalDebit)}</p>
                <p className="text-xs font-bold text-slate-500 mt-1 font-arabic">إجمالي حركات المدين (+)</p>
              </div>

              {/* Total Credit */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center mb-3">
                  <ArrowDownLeft size={20} />
                </div>
                <p className="text-lg font-black text-rose-600 font-mono" dir="ltr">₪{fmt(ledgerReport.totalCredit)}</p>
                <p className="text-xs font-bold text-slate-500 mt-1 font-arabic">إجمالي حركات الدائن (-)</p>
              </div>

              {/* Closing Balance */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
                  <BookOpen size={20} />
                </div>
                <p className="text-lg font-black text-indigo-600 font-mono" dir="ltr">₪{fmt(ledgerReport.closingBalance)}</p>
                <p className="text-xs font-bold text-slate-500 mt-1 font-arabic">الرصيد الختامي التراكمي</p>
              </div>
            </div>

            {/* Account Info Badge */}
            {selectedAccount && (
              <div className="rounded-2xl bg-indigo-50/50 border border-indigo-100 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs font-black text-indigo-600 bg-indigo-100 px-2.5 py-1 rounded-md border border-indigo-200">
                    {selectedAccount.code}
                  </span>
                  <span className="text-sm font-black text-indigo-900 font-arabic">
                    {selectedAccount.name}
                  </span>
                  <span className="text-xs font-bold text-indigo-500 font-arabic">
                    (طبيعة الحساب: {isDebitNatural ? 'مدين بطبيعته' : 'دائن بطبيعته'} | نوعه: {TYPE_LABELS[selectedAccount.type]})
                  </span>
                </div>
                {filterFrom && (
                  <div className="text-xs font-bold text-slate-500 flex items-center gap-1 font-arabic">
                    <Info size={14} className="text-indigo-400" />
                    <span>يتم تدوير جميع القيود السابقة لتاريخ {filterFrom} إلى رصيد افتتاحي.</span>
                  </div>
                )}
              </div>
            )}

            {/* Ledger Transactions Table */}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              {/* Table Toolbar */}
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-center gap-3">
                <span className="font-black text-slate-700 text-sm font-arabic">
                  حركات الحساب التفصيلية ({ledgerReport.lines.length})
                </span>
                {/* Internal Search */}
                <div className="relative w-full sm:w-64">
                  <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={tableSearch}
                    onInput={(e) => { e.target.value = toEnglishNumbers(e.target.value); }}
                    onChange={(e) => { e.target.value = toEnglishNumbers(e.target.value); setTableSearch(e.target.value); }}
                    placeholder="بحث في قيود الصفحة..."
                    className="w-full rounded-lg border border-slate-200 bg-white pr-9 pl-3 py-1.5 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:border-indigo-500 shadow-sm"
                  />
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right min-w-[750px] divide-y divide-slate-100">
                  <thead className="bg-slate-50">
                    <tr className="text-slate-500 font-black border-b border-slate-200">
                      <th className="py-3 px-5 text-xs font-arabic">التاريخ</th>
                      <th className="py-3 px-5 text-xs font-arabic w-32">رقم القيد</th>
                      <th className="py-3 px-5 text-xs font-arabic">البيان العام للقيد</th>
                      <th className="py-3 px-5 text-xs font-arabic">شرح الحركة</th>
                      <th className="py-3 px-5 text-xs font-arabic text-center w-28" dir="ltr">مدين ₪</th>
                      <th className="py-3 px-5 text-xs font-arabic text-center w-28" dir="ltr">دائن ₪</th>
                      <th className="py-3 px-5 text-xs font-arabic text-center w-36" dir="ltr">الرصيد التراكمي ₪</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {/* Opening Balance Row */}
                    <tr className="bg-indigo-50/20 font-bold text-slate-600">
                      <td className="py-3 px-5 font-mono text-xs">—</td>
                      <td className="py-3 px-5 font-mono text-xs">—</td>
                      <td className="py-3 px-5 font-arabic">رصيد افتتاحي مدوّر</td>
                      <td className="py-3 px-5 text-slate-400">—</td>
                      <td className="py-3 px-5 text-center font-mono text-xs">—</td>
                      <td className="py-3 px-5 text-center font-mono text-xs">—</td>
                      <td className="py-3 px-5 text-center font-black font-mono text-slate-700" dir="ltr">
                        ₪{fmt(ledgerReport.openingBalance)}
                      </td>
                    </tr>

                    {/* Transaction Rows */}
                    {ledgerReport.lines.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-400 font-bold font-arabic">
                          لا توجد قيود مرحّلة مسجّلة لهذا الحساب خلال الفترة المحددة.
                        </td>
                      </tr>
                    ) : (
                      ledgerReport.lines.map((line) => (
                        <tr key={line.id} className="hover:bg-slate-50/50 transition-colors text-slate-700">
                          <td className="py-3 px-5 font-mono text-xs" dir="ltr">
                            {line.date}
                          </td>
                          <td className="py-3 px-5 font-mono text-xs">
                            <span className="font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">
                              {line.entry_number}
                            </span>
                          </td>
                          <td className="py-3 px-5 font-bold text-slate-800 line-clamp-1 max-w-xs mt-1.5">
                            {line.journal_description || '—'}
                          </td>
                          <td className="py-3 px-5 text-slate-500">
                            {line.line_description || '—'}
                          </td>
                          <td className="py-3 px-5 text-center font-bold text-emerald-600 font-mono" dir="ltr">
                            {line.debit > 0 ? fmt(line.debit) : '—'}
                          </td>
                          <td className="py-3 px-5 text-center font-bold text-rose-600 font-mono" dir="ltr">
                            {line.credit > 0 ? fmt(line.credit) : '—'}
                          </td>
                          <td className="py-3 px-5 text-center font-black text-indigo-600 font-mono" dir="ltr">
                            ₪{fmt(line.running_balance)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {/* Footer Totals */}
                  <tfoot className="bg-slate-50/80 font-black text-slate-800 border-t-2 border-slate-200">
                    <tr>
                      <td colSpan={4} className="py-3.5 px-5 text-left font-arabic">إجمالي الصفحة والختام</td>
                      <td className="py-3.5 px-5 text-center font-mono text-emerald-600" dir="ltr">
                        ₪{fmt(ledgerReport.totalDebit)}
                      </td>
                      <td className="py-3.5 px-5 text-center font-mono text-rose-600" dir="ltr">
                        ₪{fmt(ledgerReport.totalCredit)}
                      </td>
                      <td className="py-3.5 px-5 text-center font-mono text-indigo-600" dir="ltr">
                        ₪{fmt(ledgerReport.closingBalance)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
