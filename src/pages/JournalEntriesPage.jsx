import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  BookOpen,
  Filter,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Info,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { roundMoney } from '../utils/productModel';

const JE_TABLE   = 'journal_entries';
const JEL_TABLE  = 'journal_entry_lines';

const ENTRY_TYPE_LABELS = {
  cash_sale:        { label: 'بيع كاش',           tone: 'emerald' },
  credit_sale:      { label: 'بيع ذمة',            tone: 'amber' },
  sale_return:      { label: 'مرتجع',              tone: 'rose' },
  cash_purchase:    { label: 'شراء كاش',           tone: 'sky' },
  credit_purchase:  { label: 'شراء آجل',           tone: 'violet' },
  expense:          { label: 'مصروف',              tone: 'orange' },
  transfer:         { label: 'تحويل بين صناديق',   tone: 'slate' },
  adjustment:       { label: 'تسوية',              tone: 'indigo' },
  opening_balance:  { label: 'رصيد افتتاحي',       tone: 'teal' },
  manual:           { label: 'يدوي',               tone: 'slate' },
};

const TONE_CLASSES = {
  emerald: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200',
  amber:   'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
  rose:    'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
  sky:     'bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200',
  violet:  'bg-violet-100 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200',
  orange:  'bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-200',
  slate:   'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200',
  indigo:  'bg-indigo-100 text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200',
  teal:    'bg-teal-100 text-teal-900 dark:bg-teal-950/50 dark:text-teal-200',
};

function fmt(n) {
  return roundMoney(Number(n ?? 0)).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return String(iso).slice(0, 16); }
}

export default function JournalEntriesPage() {
  const { store, loading: storeLoading } = useStore();
  const [entries, setEntries]   = useState([]);
  const [lines,   setLines]     = useState({});   // { entry_id: [lines...] }
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState(null);
  const [expanded, setExpanded] = useState({});   // { entry_id: bool }

  const [filterType, setFilterType] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo,   setFilterTo]   = useState('');

  const load = useCallback(async () => {
    if (!store?.id) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      let q = supabase
        .from(JE_TABLE)
        .select('id, entry_date, entry_type, description, total_amount, reference_id, reference_type, created_at')
        .eq('store_id', store.id)
        .order('created_at', { ascending: false })
        .limit(300);

      if (filterType)  q = q.eq('entry_type', filterType);
      if (filterFrom)  q = q.gte('entry_date', filterFrom);
      if (filterTo)    q = q.lte('entry_date', filterTo);

      const { data, error: qErr } = await q;
      if (qErr) throw qErr;
      setEntries(data || []);
    } catch (e) {
      console.error(e);
      if (/does not exist|schema cache|PGRST205|42P01/i.test(e.message || '')) {
        setError('جدول القيود اليومية غير مُنشأ — نفّذ journal_entries.sql ثم journal_entries_auto_triggers.sql في Supabase.');
      } else {
        setError(e.message || 'تعذّر تحميل القيود');
      }
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id, filterType, filterFrom, filterTo]);

  useEffect(() => {
    if (storeLoading) return;
    load();
  }, [storeLoading, load]);

  const loadLines = useCallback(async (entryId) => {
    if (lines[entryId]) return;
    try {
      const { data, error: lErr } = await supabase
        .from(JEL_TABLE)
        .select('id, account_code, account_name, debit, credit')
        .eq('entry_id', entryId)
        .order('debit', { ascending: false });
      if (lErr) throw lErr;
      setLines((prev) => ({ ...prev, [entryId]: data || [] }));
    } catch (e) {
      console.error(e);
      setLines((prev) => ({ ...prev, [entryId]: [] }));
    }
  }, [lines]);

  const toggleExpand = (id) => {
    const opening = !expanded[id];
    setExpanded((prev) => ({ ...prev, [id]: opening }));
    if (opening) loadLines(id);
  };

  const totals = useMemo(() => {
    const totalDebit  = Object.values(lines).flat().reduce((s, l) => s + Number(l.debit  ?? 0), 0);
    const totalCredit = Object.values(lines).flat().reduce((s, l) => s + Number(l.credit ?? 0), 0);
    return { debit: roundMoney(totalDebit), credit: roundMoney(totalCredit) };
  }, [lines]);

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/finance/trial-balance"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700"
          >ميزان المراجعة</Link>
          <Link to="/finance/activity-log"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
          >سجل التدقيق</Link>
        </div>
      }
    >
      <div className="max-w-6xl mx-auto space-y-6" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
            <BookOpen size={26} />
          </div>
          <div>
            <h1 className="font-title text-2xl font-black text-slate-900 dark:text-white">دفتر القيود اليومية</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 font-bold mt-0.5">
              قيود محاسبية تلقائية — كل بيع وشراء ومصروف يُسجَّل تلقائياً
            </p>
          </div>
        </div>

        {!error && (
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 dark:border-indigo-900/40 dark:bg-indigo-950/30 px-4 py-3 flex gap-3 items-start">
            <Info className="shrink-0 text-indigo-600 dark:text-indigo-400 mt-0.5" size={18} />
            <p className="text-xs font-bold text-indigo-950 dark:text-indigo-100/90 leading-relaxed">
              <strong>للتفعيل:</strong> نفّذ في Supabase SQL Editor ملفَّي{' '}
              <code className="bg-white/70 dark:bg-indigo-900/50 px-1 rounded">journal_entries.sql</code> ثم{' '}
              <code className="bg-white/70 dark:bg-indigo-900/50 px-1 rounded">journal_entries_auto_triggers.sql</code>.
              بعد ذلك، كل عملية بيع/شراء/مصروف ستُنشئ قيداً محاسبياً تلقائياً.
            </p>
          </div>
        )}

        {/* فلاتر */}
        <div className="flex flex-wrap gap-3 items-end rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-white/10 dark:bg-gray-900/60">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <Filter size={18} />
            <span className="text-xs font-black">فلترة</span>
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 mb-1">نوع القيد</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-bold dark:text-slate-100"
            >
              <option value="">الكل</option>
              {Object.entries(ENTRY_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 mb-1">من تاريخ</label>
            <input
              type="date" value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-bold dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 mb-1">إلى تاريخ</label>
            <input
              type="date" value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-bold dark:text-slate-100"
            />
          </div>
          <button
            type="button" onClick={load}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 text-white px-4 py-2.5 text-sm font-black hover:bg-indigo-700"
          >
            <RefreshCw size={16} />
            تحديث
          </button>
          {(filterType || filterFrom || filterTo) && (
            <button
              type="button"
              onClick={() => { setFilterType(''); setFilterFrom(''); setFilterTo(''); }}
              className="text-xs font-bold text-rose-600 hover:underline dark:text-rose-400"
            >
              مسح الفلاتر
            </button>
          )}
        </div>

        {error && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800/50 px-4 py-4 text-sm font-bold text-amber-950 dark:text-amber-100">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-indigo-500 dark:text-indigo-400" size={40} />
          </div>
        ) : !error && entries.length === 0 ? (
          <div className="text-center py-16 text-slate-500 dark:text-slate-400 font-bold">
            لا توجد قيود محاسبية مسجّلة بعد. نفّذ ملف الـ Triggers في Supabase ثم أجرِ عملية بيع أو شراء.
          </div>
        ) : !error ? (
          <div className="rounded-2xl border border-slate-200/80 bg-white dark:border-gray-700/50 dark:bg-gray-900/70 overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-white/10 bg-slate-50/90 dark:bg-white/5 flex justify-between items-center">
              <span className="font-black text-slate-900 dark:text-white text-sm">
                {entries.length} قيد
              </span>
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                افتح كل قيد للاطلاع على السطور
              </span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {entries.map((entry) => {
                const meta   = ENTRY_TYPE_LABELS[entry.entry_type] ?? { label: entry.entry_type, tone: 'slate' };
                const isOpen = !!expanded[entry.id];
                const entryLines = lines[entry.id] ?? [];
                return (
                  <div key={entry.id}>
                    <button
                      type="button"
                      onClick={() => toggleExpand(entry.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-right hover:bg-slate-50/70 dark:hover:bg-white/5 transition-colors"
                    >
                      <span className={`shrink-0 ${isOpen ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'}`}>
                        {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </span>
                      <span className={`shrink-0 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-black ${TONE_CLASSES[meta.tone] ?? TONE_CLASSES.slate}`}>
                        {meta.label}
                      </span>
                      <span className="flex-1 min-w-0 text-sm font-bold text-slate-900 dark:text-white truncate">
                        {entry.description || '—'}
                      </span>
                      <span className="shrink-0 font-black font-currency text-slate-800 dark:text-slate-100" dir="ltr">
                        ₪{fmt(entry.total_amount)}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap" dir="ltr">
                        {formatDate(entry.created_at)}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-8 pb-3 bg-slate-50/50 dark:bg-slate-800/30">
                        {entryLines.length === 0 ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400 py-2">لا توجد سطور مفصّلة.</p>
                        ) : (
                          <table className="w-full text-xs rounded-xl overflow-hidden min-w-[420px]">
                            <thead>
                              <tr className="bg-slate-200/80 dark:bg-slate-700/80 text-slate-700 dark:text-slate-200">
                                <th className="text-right py-2 px-3 font-black">كود الحساب</th>
                                <th className="text-right py-2 px-3 font-black">اسم الحساب</th>
                                <th className="text-center py-2 px-3 font-black" dir="ltr">مدين ₪</th>
                                <th className="text-center py-2 px-3 font-black" dir="ltr">دائن ₪</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entryLines.map((l) => (
                                <tr key={l.id} className="border-t border-slate-200/60 dark:border-slate-600/50">
                                  <td className="py-2 px-3 font-mono text-slate-500 dark:text-slate-400">{l.account_code}</td>
                                  <td className="py-2 px-3 font-bold text-slate-800 dark:text-slate-200">{l.account_name}</td>
                                  <td className="py-2 px-3 text-center font-currency font-bold text-emerald-800 dark:text-emerald-300" dir="ltr">
                                    {Number(l.debit) > 0 ? fmt(l.debit) : '—'}
                                  </td>
                                  <td className="py-2 px-3 text-center font-currency font-bold text-rose-700 dark:text-rose-300" dir="ltr">
                                    {Number(l.credit) > 0 ? fmt(l.credit) : '—'}
                                  </td>
                                </tr>
                              ))}
                              <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-100/80 dark:bg-slate-700/60 font-black text-slate-900 dark:text-white">
                                <td colSpan={2} className="py-2 px-3 text-left text-xs">الإجمالي</td>
                                <td className="py-2 px-3 text-center font-currency" dir="ltr">
                                  {fmt(entryLines.reduce((s, l) => s + Number(l.debit ?? 0), 0))}
                                </td>
                                <td className="py-2 px-3 text-center font-currency" dir="ltr">
                                  {fmt(entryLines.reduce((s, l) => s + Number(l.credit ?? 0), 0))}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
