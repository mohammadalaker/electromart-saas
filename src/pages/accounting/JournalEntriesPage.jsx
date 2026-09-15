import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Plus,
  Edit2,
  Trash2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Calendar,
  Filter,
  Check,
  AlertCircle,
  RefreshCw,
  Info,
  X,
} from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { supabase } from '../../lib/supabaseClient';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { roundMoney } from '../../utils/productModel';
import { useHtmlDarkClass } from '../../lib/theme';

const JOURNAL_TABLE = 'accounting_journal';
const ACCOUNTS_TABLE = 'accounting_accounts';

const toEnglishNumbers = (str) => {
  return String(str).replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => d.charCodeAt(0) - 1632)
                    .replace(/[۰۱۲۳۴۵۶۷۸۹]/g, d => d.charCodeAt(0) - 1776);
};

function FieldTooltip({ text }) {
  if (!text) return null;
  return (
    <span className="relative group/tip inline-flex items-center" title={text}>
      <Info size={13} className="text-slate-400 hover:text-indigo-400 transition-colors cursor-help" />
      <span className="pointer-events-none absolute bottom-full mb-1.5 right-1/2 translate-x-1/2 hidden group-hover/tip:flex flex-col items-center z-50">
        <span className="rounded-lg bg-slate-950/95 text-white text-[11px] font-medium px-2.5 py-1 whitespace-nowrap shadow-xl border border-white/10 backdrop-blur-md">
          {text}
        </span>
      </span>
    </span>
  );
}

const STATUS_META = {
  draft: { label: 'مسودة', colorClass: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
  posted: { label: 'مرحّل', colorClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  cancelled: { label: 'ملغي', colorClass: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
};

const TYPE_META = {
  manual: { label: 'يدوي', colorClass: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' },
  sales: { label: 'مبيعات', colorClass: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  purchase: { label: 'مشتريات', colorClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  payment: { label: 'دفعة', colorClass: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
  receipt: { label: 'قبض', colorClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
};

export default function JournalEntriesPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();
  const darkUi = useHtmlDarkClass();

  const [entries, setEntries] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  // Expand state
  const [expandedEntries, setExpandedEntries] = useState({});

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editEntry, setEditEntry] = useState(null);

  // Form Fields
  const [entryNumber, setEntryNumber] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [type, setType] = useState('manual');
  const [lines, setLines] = useState([
    { account_id: '', description: '', debit: 0, credit: 0 },
    { account_id: '', description: '', debit: 0, credit: 0 },
  ]);

  const loadEntries = useCallback(async () => {
    if (!store?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let q = supabase
        .from(JOURNAL_TABLE)
        .select(`
          *,
          lines:accounting_journal_lines (
            *,
            account:accounting_accounts (
              id,
              code,
              name
            )
          )
        `)
        .eq('store_id', store.id)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });

      if (filterStatus) q = q.eq('status', filterStatus);
      if (filterFrom) q = q.gte('date', filterFrom);
      if (filterTo) q = q.lte('date', filterTo);

      const { data, error: qErr } = await q;
      if (qErr) throw qErr;
      setEntries(data || []);
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'تعذر تحميل القيود اليومية');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id, filterStatus, filterFrom, filterTo]);

  // Load active accounts list
  const loadAccounts = useCallback(async () => {
    if (!store?.id) return;
    try {
      const { data, error: accErr } = await supabase
        .from(ACCOUNTS_TABLE)
        .select('id, code, name')
        .eq('store_id', store.id)
        .eq('is_active', true)
        .order('code', { ascending: true });
      if (accErr) throw accErr;
      setAccounts(data || []);
    } catch (e) {
      console.error(e);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    loadEntries();
    loadAccounts();
  }, [storeLoading, loadEntries, loadAccounts]);

  // Auto-generate entry number helper
  const suggestEntryNumber = () => {
    const now = new Date();
    const yearMonth = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `JE-${yearMonth}-${rand}`;
  };

  // Open Modal for Add
  const handleOpenAddModal = () => {
    setEditEntry(null);
    setEntryNumber(suggestEntryNumber());
    setEntryDate(new Date().toISOString().split('T')[0]);
    setDescription('');
    setReference('');
    setType('manual');
    setLines([
      { account_id: '', description: '', debit: 0, credit: 0 },
      { account_id: '', description: '', debit: 0, credit: 0 },
    ]);
    setModalOpen(true);
  };

  // Open Modal for Edit (Only allowed if status === 'draft')
  const handleOpenEditModal = (entry) => {
    if (entry.status !== 'draft') {
      toast.error('يمكنك تعديل مسودات القيود فقط.');
      return;
    }
    setEditEntry(entry);
    setEntryNumber(entry.entry_number);
    setEntryDate(entry.date);
    setDescription(entry.description);
    setReference(entry.reference || '');
    setType(entry.type);
    setLines(
      entry.lines.map((l) => ({
        account_id: l.account_id,
        description: l.description || '',
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
      }))
    );
    setModalOpen(true);
  };

  // Line helpers
  const handleAddLine = () => {
    setLines([...lines, { account_id: '', description: '', debit: 0, credit: 0 }]);
  };

  const handleRemoveLine = (index) => {
    if (lines.length <= 2) {
      toast.warning('يجب أن يحتوي القيد على سطرين على الأقل.');
      return;
    }
    setLines(lines.filter((_, i) => i !== index));
  };

  const handleUpdateLine = (index, field, value) => {
    const next = [...lines];
    if (field === 'debit' || field === 'credit') {
      const num = Math.max(0, parseFloat(value) || 0);
      next[index][field] = value;
      // Clear alternative field
      if (field === 'debit' && num > 0) next[index].credit = 0;
      if (field === 'credit' && num > 0) next[index].debit = 0;
    } else {
      next[index][field] = value;
    }
    setLines(next);
  };

  // Running totals calculations
  const totals = useMemo(() => {
    const d = lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
    const c = lines.reduce((sum, l) => sum + Number(l.credit || 0), 0);
    return {
      debit: roundMoney(d),
      credit: roundMoney(c),
      diff: roundMoney(Math.abs(d - c)),
      balanced: d > 0 && Math.abs(d - c) < 0.01,
    };
  }, [lines]);

  // Save Entry (Draft or Post)
  const handleSaveEntry = async (shouldPost) => {
    if (!store?.id) return;

    if (!entryNumber.trim() || !entryDate) {
      toast.warning('يرجى تحديد رقم القيد والتاريخ.');
      return;
    }

    // Check account selected in all lines
    const incompleteLines = lines.some((l) => !l.account_id);
    if (incompleteLines) {
      toast.warning('يرجى تحديد حساب مالي لجميع أسطر القيد.');
      return;
    }

    // If posting directly, must be balanced
    if (shouldPost && !totals.balanced) {
      toast.error('لا يمكن ترحيل قيد غير متزن. يجب أن يتطابق إجمالي المدين مع إجمالي الدائن.');
      return;
    }

    // Check if code exists local uniqueness (except for current editing)
    if (!editEntry || editEntry.entry_number !== entryNumber.trim()) {
      const codeExists = entries.some((e) => e.entry_number === entryNumber.trim());
      if (codeExists) {
        toast.error('رقم القيد مستخدم بالفعل. يرجى اختيار رقم فريد.');
        return;
      }
    }

    setSaving(true);
    let createdId = null;
    try {
      const headerPayload = {
        store_id: store.id,
        entry_number: entryNumber.trim(),
        date: entryDate,
        description: description.trim(),
        reference: reference.trim(),
        type,
        status: shouldPost ? 'posted' : 'draft',
      };

      if (editEntry) {
        // Update header
        const { error: headerErr } = await supabase
          .from(JOURNAL_TABLE)
          .update(headerPayload)
          .eq('id', editEntry.id);
        if (headerErr) throw headerErr;

        // Delete old lines
        const { error: delErr } = await supabase
          .from('accounting_journal_lines')
          .delete()
          .eq('journal_id', editEntry.id);
        if (delErr) throw delErr;

        createdId = editEntry.id;
      } else {
        // Insert header
        const { data, error: headerErr } = await supabase
          .from(JOURNAL_TABLE)
          .insert(headerPayload)
          .select('id')
          .single();
        if (headerErr) throw headerErr;
        createdId = data.id;
      }

      // Insert new lines
      const linesToInsert = lines.map((l) => ({
        journal_id: createdId,
        account_id: l.account_id,
        description: l.description.trim() || description.trim(),
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
      }));

      const { error: linesErr } = await supabase
        .from('accounting_journal_lines')
        .insert(linesToInsert);
      if (linesErr) {
        // Cleanup header on failure if it's a new entry
        if (!editEntry) {
          await supabase.from(JOURNAL_TABLE).delete().eq('id', createdId);
        }
        throw linesErr;
      }

      toast.success(shouldPost ? 'تم ترحيل القيد المحاسبي بنجاح' : 'تم حفظ مسودة القيد بنجاح');
      setModalOpen(false);
      loadEntries();
    } catch (err) {
      console.error(err);
      toast.error('تعذر حفظ القيد: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Cancel Posted Entry
  const handleCancelEntry = async (entry) => {
    if (!window.confirm(`هل أنت متأكد من إلغاء القيد: ${entry.entry_number}؟ لا يمكن التراجع عن هذا الإجراء.`)) {
      return;
    }
    try {
      const { error: err } = await supabase
        .from(JOURNAL_TABLE)
        .update({ status: 'cancelled' })
        .eq('id', entry.id);
      if (err) throw err;
      toast.success('تم إلغاء القيد بنجاح');
      loadEntries();
    } catch (e) {
      console.error(e);
      toast.error('تعذر إلغاء القيد: ' + e.message);
    }
  };

  // Delete Draft Entry
  const handleDeleteEntry = async (entry) => {
    if (entry.status !== 'draft') {
      toast.error('لا يمكن حذف القيود المرحّلة أو الملغاة. يمكنك فقط إلغاؤها.');
      return;
    }
    if (!window.confirm(`هل أنت متأكد من حذف مسودة القيد: ${entry.entry_number} نهائياً؟`)) {
      return;
    }
    try {
      const { error: err } = await supabase
        .from(JOURNAL_TABLE)
        .delete()
        .eq('id', entry.id);
      if (err) throw err;
      toast.success('تم حذف القيد بنجاح');
      loadEntries();
    } catch (e) {
      console.error(e);
      toast.error('تعذر حذف القيد: ' + e.message);
    }
  };

  const toggleExpand = (id) => {
    setExpandedEntries((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

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
            onClick={handleOpenAddModal}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-black text-white hover:from-indigo-700 hover:to-violet-700 shadow-md shadow-indigo-500/15"
          >
            <Plus size={16} />
            إنشاء قيد محاسبي
          </button>
          <button
            type="button"
            onClick={loadEntries}
            className="inline-flex items-center justify-center p-2.5 rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            title="تحديث البيانات"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      }
    >
      <div className="max-w-6xl mx-auto space-y-6" dir="rtl">
        {/* Header Block */}
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 shrink-0">
            <BookOpen size={26} />
          </div>
          <div>
            <h1 className="font-title text-2xl font-black text-slate-100 font-arabic">دفتر القيود اليومية (الجديد)</h1>
            <p className="text-sm text-slate-400 font-bold mt-0.5 leading-relaxed font-arabic">
              تسجيل ومتابعة القيود المحاسبية المزدوجة للمتجر. تصفح مسودات القيود، القيود المرحّلة، والملغاة.
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-end rounded-2xl border border-white/10 bg-slate-900/40 backdrop-blur-md p-5 shadow-xl">
          <div className="flex items-center gap-2 text-slate-400">
            <Filter size={18} />
            <span className="text-xs font-black">تصفية</span>
          </div>

          {/* Status */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 mb-1.5">حالة القيد</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm font-bold text-slate-200 focus:outline-none focus:border-indigo-500/50"
            >
              <option value="" className="bg-slate-900">الكل</option>
              <option value="draft" className="bg-slate-900">مسودة</option>
              <option value="posted" className="bg-slate-900">مرحّل</option>
              <option value="cancelled" className="bg-slate-900">ملغي</option>
            </select>
          </div>

          {/* Date From */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 mb-1.5">من تاريخ</label>
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm font-bold text-slate-200 focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 mb-1.5">إلى تاريخ</label>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm font-bold text-slate-200 focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          {/* Clear Button */}
          {(filterStatus || filterFrom || filterTo) && (
            <button
              type="button"
              onClick={() => {
                setFilterStatus('');
                setFilterFrom('');
                setFilterTo('');
              }}
              className="text-xs font-bold text-rose-400 hover:text-rose-300 hover:underline mb-2"
            >
              مسح الفلاتر
            </button>
          )}

          {/* Refresh */}
          <button
            type="button"
            onClick={loadEntries}
            className="mr-auto inline-flex items-center gap-2 rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-black hover:bg-indigo-700 transition-colors"
          >
            تحديث
          </button>
        </div>

        {/* Loader */}
        {loading ? (
          <div className="flex flex-col justify-center items-center py-24 gap-3">
            <Loader2 className="animate-spin text-indigo-400" size={40} />
            <span className="text-sm font-bold text-slate-400">جاري تحميل دفتر القيود...</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-slate-500 font-bold border border-dashed border-white/10 rounded-2xl bg-slate-900/30">
            لا توجد قيود يومية مسجّلة تطابق البحث. أضف قيداً محاسبياً جديداً للبدء.
          </div>
        ) : (
          /* List of entries */
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-white/5 bg-white/[0.02] flex justify-between items-center">
              <span className="font-black text-slate-200 text-sm">
                قائمة القيود ({entries.length})
              </span>
              <span className="text-[11px] font-bold text-slate-400">
                انقر على القيد لعرض الحسابات والسطور المفصّلة
              </span>
            </div>

            <div className="divide-y divide-white/5">
              {entries.map((entry) => {
                const isOpen = !!expandedEntries[entry.id];
                const entryTotalDebit = entry.lines?.reduce((s, l) => s + Number(l.debit || 0), 0) || 0;
                const statusMeta = STATUS_META[entry.status] || { label: entry.status, colorClass: '' };
                const typeMeta = TYPE_META[entry.type] || { label: entry.type, colorClass: '' };

                return (
                  <div key={entry.id} className="relative">
                    {/* Header Row */}
                    <button
                      type="button"
                      onClick={() => toggleExpand(entry.id)}
                      className="w-full flex flex-wrap items-center gap-3 px-5 py-4 text-right hover:bg-white/[0.03] transition-colors"
                    >
                      <span className={isOpen ? 'text-indigo-400' : 'text-slate-500'}>
                        {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </span>

                      {/* Number */}
                      <span className="font-mono text-xs font-bold text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 shrink-0">
                        {entry.entry_number}
                      </span>

                      {/* Status */}
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black border ${statusMeta.colorClass}`}>
                        {statusMeta.label}
                      </span>

                      {/* Type */}
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black border ${typeMeta.colorClass}`}>
                        {typeMeta.label}
                      </span>

                      {/* Description */}
                      <span className="flex-1 min-w-0 text-sm font-bold text-slate-200 truncate">
                        {entry.description || '—'}
                      </span>

                      {/* Reference */}
                      {entry.reference && (
                        <span className="text-xs text-slate-400 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full hidden md:inline">
                          مرجع: {entry.reference}
                        </span>
                      )}

                      {/* Date */}
                      <span className="text-xs text-slate-400 font-mono" dir="ltr">
                        {entry.date}
                      </span>

                      {/* Total Amount */}
                      <span className="font-black text-sm text-slate-100 font-currency shrink-0 pr-4" dir="ltr">
                        ₪{fmt(entryTotalDebit)}
                      </span>
                    </button>

                    {/* Detailed Lines */}
                    {isOpen && (
                      <div className="px-12 pb-5 pt-2 bg-black/20 space-y-4">
                        <div className="rounded-xl border border-white/5 overflow-hidden">
                          <table className="w-full text-xs text-right min-w-[500px]">
                            <thead>
                              <tr className="bg-white/[0.02] text-slate-400 border-b border-white/5">
                                <th className="py-2.5 px-4 font-black w-24">رمز الحساب</th>
                                <th className="py-2.5 px-4 font-black">اسم الحساب</th>
                                <th className="py-2.5 px-4 font-black">البيان / الوصف</th>
                                <th className="py-2.5 px-4 font-black text-center" dir="ltr">مدين ₪</th>
                                <th className="py-2.5 px-4 font-black text-center" dir="ltr">دائن ₪</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entry.lines?.map((line) => (
                                <tr key={line.id} className="border-b border-white/[0.02] text-slate-300">
                                  <td className="py-2.5 px-4 font-mono text-slate-400">{line.account?.code || '—'}</td>
                                  <td className="py-2.5 px-4 font-bold">{line.account?.name || '—'}</td>
                                  <td className="py-2.5 px-4 text-slate-400">{line.description || '—'}</td>
                                  <td className="py-2.5 px-4 text-center font-bold text-emerald-400" dir="ltr">
                                    {Number(line.debit) > 0 ? fmt(line.debit) : '—'}
                                  </td>
                                  <td className="py-2.5 px-4 text-center font-bold text-rose-400" dir="ltr">
                                    {Number(line.credit) > 0 ? fmt(line.credit) : '—'}
                                  </td>
                                </tr>
                              ))}
                              {/* Total Footer */}
                              <tr className="bg-white/[0.03] font-black text-slate-200">
                                <td colSpan={3} className="py-2.5 px-4 text-left">الإجمالي</td>
                                <td className="py-2.5 px-4 text-center font-currency text-emerald-400" dir="ltr">
                                  ₪{fmt(entryTotalDebit)}
                                </td>
                                <td className="py-2.5 px-4 text-center font-currency text-rose-400" dir="ltr">
                                  ₪{fmt(entry.lines?.reduce((s, l) => s + Number(l.credit || 0), 0) || 0)}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        {/* Actions for this Entry */}
                        <div className="flex justify-end gap-2 text-xs">
                          {entry.status === 'draft' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenEditModal(entry)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/20 bg-indigo-500/10 text-indigo-300 px-3.5 py-1.5 font-bold hover:bg-indigo-500/25 transition-colors"
                              >
                                <Edit2 size={12} />
                                تعديل المسودة
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteEntry(entry)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-400 px-3.5 py-1.5 font-bold hover:bg-rose-500/25 transition-colors"
                              >
                                <Trash2 size={12} />
                                حذف المسودة
                              </button>
                            </>
                          )}
                          {entry.status === 'posted' && (
                            <button
                              type="button"
                              onClick={() => handleCancelEntry(entry)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-400 px-3.5 py-1.5 font-bold hover:bg-rose-500/25 transition-colors"
                            >
                              <XCircle size={12} />
                              إلغاء القيد (ملغي)
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Add / Edit Glassmorphic Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 font-arabic" dir="rtl">
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity"
            onClick={() => !saving && setModalOpen(false)}
            aria-hidden
          />

          <div
            className={`relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl border shadow-2xl overflow-hidden transition-all duration-300 ${
              darkUi
                ? 'border-white/10 bg-slate-900/95 backdrop-blur-2xl text-white'
                : 'border-slate-200 bg-white/95 backdrop-blur-2xl text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Header */}
            <div
              className={`flex-shrink-0 px-5 py-3.5 sm:px-6 sm:py-4 border-b flex justify-between items-center ${
                darkUi
                  ? 'border-white/10 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950'
                  : 'border-slate-200 bg-gradient-to-r from-slate-50 via-white to-indigo-50/50'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${
                    darkUi
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                      : 'bg-indigo-100 text-indigo-600 border border-indigo-200'
                  }`}
                >
                  <BookOpen size={20} />
                </div>
                <div className="min-w-0">
                  <h3 className={`text-base sm:text-lg font-black truncate ${darkUi ? 'text-white' : 'text-slate-900'}`}>
                    {editEntry ? `تعديل قيد: ${editEntry.entry_number}` : 'إنشاء قيد محاسبي جديد'}
                  </h3>
                  <p className={`text-xs truncate ${darkUi ? 'text-slate-400' : 'text-slate-500'}`}>
                    سجل القيود اليومية المحاسبية المزدوجة
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={saving}
                className={`p-1.5 rounded-lg transition-colors shrink-0 disabled:opacity-50 ${
                  darkUi
                    ? 'text-slate-400 hover:bg-white/10 hover:text-white'
                    : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                }`}
                aria-label="إغلاق"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable Form Body */}
            <div className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1 min-h-0 [scrollbar-width:thin]">
              {/* Row 1: Identification & Timing (Entry Number + Date + Type) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Entry Number */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className={`flex items-center gap-1.5 text-xs font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}>
                      <span>رقم القيد *</span>
                      <FieldTooltip text="رقم مرجعي فريد لكل قيد محاسبي لتتبعه بدقة." />
                    </label>
                    {!editEntry && (
                      <button
                        type="button"
                        onClick={() => setEntryNumber(suggestEntryNumber())}
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition ${
                          darkUi
                            ? 'text-indigo-300 hover:bg-indigo-500/20'
                            : 'text-indigo-600 hover:bg-indigo-50'
                        }`}
                        title="توليد رقم تلقائي"
                      >
                        توليد تلقائي
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="مثال: JE-2024-001"
                    value={entryNumber}
                    onChange={(e) => setEntryNumber(toEnglishNumbers(e.target.value))}
                    dir="ltr"
                    className={`w-full h-10 px-3.5 py-2 font-mono text-sm font-semibold rounded-xl border outline-none transition focus:ring-2 ${
                      darkUi
                        ? 'border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400/50 focus:ring-indigo-500/20'
                        : 'border-slate-200 bg-white/80 text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:ring-indigo-100'
                    }`}
                  />
                </div>

                {/* Entry Date */}
                <div>
                  <label className={`mb-1.5 flex items-center gap-1.5 text-xs font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}>
                    <span>تاريخ القيد *</span>
                    <FieldTooltip text="تاريخ تسجيل الحركة المحاسبية بالدفتر." />
                  </label>
                  <input
                    type="date"
                    required
                    value={entryDate}
                    onChange={(e) => setEntryDate(toEnglishNumbers(e.target.value))}
                    dir="ltr"
                    className={`w-full h-10 px-3.5 py-2 text-sm font-semibold rounded-xl border outline-none transition focus:ring-2 ${
                      darkUi
                        ? 'border-white/10 bg-white/5 text-white focus:border-indigo-400/50 focus:ring-indigo-500/20'
                        : 'border-slate-200 bg-white/80 text-slate-900 focus:border-indigo-300 focus:ring-indigo-100'
                    }`}
                  />
                </div>

                {/* Entry Type */}
                <div>
                  <label className={`mb-1.5 flex items-center gap-1.5 text-xs font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}>
                    <span>نوع القيد *</span>
                    <FieldTooltip text="تصنيف العملية المالية (يدوي، مبيعات، مشتريات...)." />
                  </label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className={`w-full h-10 px-3.5 py-2 text-sm font-semibold rounded-xl border outline-none transition focus:ring-2 ${
                      darkUi
                        ? 'border-white/10 bg-white/5 text-white focus:border-indigo-400/50 focus:ring-indigo-500/20'
                        : 'border-slate-200 bg-white/80 text-slate-900 focus:border-indigo-300 focus:ring-indigo-100'
                    }`}
                  >
                    {Object.entries(TYPE_META).map(([k, v]) => (
                      <option key={k} value={k} className={darkUi ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Row 2: Reference & Description */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Reference */}
                <div className="sm:col-span-1">
                  <label className={`mb-1.5 flex items-center gap-1.5 text-xs font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}>
                    <span>المرجع (اختياري)</span>
                    <FieldTooltip text="رقم الفاتورة أو السند أو الشيك المرتبط بالقيد لتتبعه." />
                  </label>
                  <input
                    type="text"
                    placeholder="رقم الفاتورة أو السند…"
                    value={reference}
                    onChange={(e) => setReference(toEnglishNumbers(e.target.value))}
                    className={`w-full h-10 px-3.5 py-2 text-sm font-semibold rounded-xl border outline-none transition focus:ring-2 ${
                      darkUi
                        ? 'border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400/50 focus:ring-indigo-500/20'
                        : 'border-slate-200 bg-white/80 text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:ring-indigo-100'
                    }`}
                  />
                </div>

                {/* Description */}
                <div className="sm:col-span-2">
                  <label className={`mb-1.5 flex items-center gap-1.5 text-xs font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}>
                    <span>البيان / الوصف الإجمالي</span>
                    <FieldTooltip text="شرح مختصر لطبيعة وسبب القيد المحاسبي." />
                  </label>
                  <input
                    type="text"
                    placeholder="شرح وتفاصيل القيد المحاسبي…"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className={`w-full h-10 px-3.5 py-2 text-sm font-semibold rounded-xl border outline-none transition focus:ring-2 ${
                      darkUi
                        ? 'border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400/50 focus:ring-indigo-500/20'
                        : 'border-slate-200 bg-white/80 text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:ring-indigo-100'
                    }`}
                  />
                </div>
              </div>

              {/* Dynamic Lines Table */}
              <div className="space-y-2 pt-1">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}>
                      بنود وسطور القيد (مزدوج)
                    </span>
                    <FieldTooltip text="يجب أن يتطابق إجمالي المدين مع إجمالي الدائن لتوازن القيد." />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddLine}
                    className={`h-8 inline-flex items-center gap-1 rounded-xl px-3 text-xs font-bold transition ${
                      darkUi
                        ? 'border border-white/15 bg-white/10 text-indigo-200 hover:bg-white/15'
                        : 'border border-slate-200 bg-white text-indigo-700 hover:bg-slate-50 shadow-sm'
                    }`}
                  >
                    <Plus size={14} />
                    إضافة سطر
                  </button>
                </div>

                <div
                  className={`rounded-2xl border overflow-hidden p-1.5 ${
                    darkUi
                      ? 'border-white/10 bg-white/[0.02]'
                      : 'border-slate-200 bg-slate-50/70'
                  }`}
                >
                  <table className="w-full text-xs text-right min-w-[560px]">
                    <thead>
                      <tr
                        className={`border-b text-xs ${
                          darkUi
                            ? 'border-white/10 text-slate-400'
                            : 'border-slate-200 text-slate-600'
                        }`}
                      >
                        <th className="py-2 px-2 font-black w-5/12">الحساب المالي *</th>
                        <th className="py-2 px-2 font-black">البيان (اختياري)</th>
                        <th className="py-2 px-2 font-black text-center w-28">مدين ₪</th>
                        <th className="py-2 px-2 font-black text-center w-28">دائن ₪</th>
                        <th className="py-2 px-2 w-10 text-center">حذف</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, index) => (
                        <tr
                          key={index}
                          className={`border-b transition-colors ${
                            darkUi
                              ? 'border-white/5 hover:bg-white/[0.02]'
                              : 'border-slate-100 hover:bg-white/60'
                          }`}
                        >
                          <td className="py-1.5 px-1">
                            <select
                              required
                              value={line.account_id}
                              onChange={(e) => handleUpdateLine(index, 'account_id', e.target.value)}
                              className={`w-full h-8 rounded-lg border px-2 py-1 text-xs font-bold outline-none transition focus:ring-1 ${
                                darkUi
                                  ? 'border-white/10 bg-slate-900 text-white focus:border-indigo-400'
                                  : 'border-slate-200 bg-white text-slate-900 focus:border-indigo-400'
                              }`}
                            >
                              <option value="" className={darkUi ? 'bg-slate-900 text-slate-400' : 'bg-white text-slate-400'}>
                                — اختر الحساب —
                              </option>
                              {accounts.map((acc) => (
                                <option
                                  key={acc.id}
                                  value={acc.id}
                                  className={darkUi ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'}
                                >
                                  [{acc.code}] {acc.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1.5 px-1">
                            <input
                              type="text"
                              placeholder="بيان السطر…"
                              value={line.description}
                              onChange={(e) => handleUpdateLine(index, 'description', e.target.value)}
                              className={`w-full h-8 rounded-lg border px-2 py-1 text-xs outline-none transition focus:ring-1 ${
                                darkUi
                                  ? 'border-white/10 bg-slate-900 text-white placeholder:text-slate-500 focus:border-indigo-400'
                                  : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-indigo-400'
                              }`}
                            />
                          </td>
                          <td className="py-1.5 px-1">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={line.debit || ''}
                              onChange={(e) => {
                                const converted = toEnglishNumbers(e.target.value);
                                handleUpdateLine(index, 'debit', converted);
                              }}
                              placeholder="0.00"
                              dir="ltr"
                              className={`w-full h-8 rounded-lg border px-2 py-1 font-currency text-xs font-bold text-center outline-none transition focus:ring-1 ${
                                darkUi
                                  ? 'border-white/10 bg-slate-900 text-emerald-300 focus:border-emerald-400'
                                  : 'border-slate-200 bg-white text-emerald-700 focus:border-emerald-500'
                              }`}
                            />
                          </td>
                          <td className="py-1.5 px-1">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={line.credit || ''}
                              onChange={(e) => {
                                const converted = toEnglishNumbers(e.target.value);
                                handleUpdateLine(index, 'credit', converted);
                              }}
                              placeholder="0.00"
                              dir="ltr"
                              className={`w-full h-8 rounded-lg border px-2 py-1 font-currency text-xs font-bold text-center outline-none transition focus:ring-1 ${
                                darkUi
                                  ? 'border-white/10 bg-slate-900 text-rose-300 focus:border-rose-400'
                                  : 'border-slate-200 bg-white text-rose-700 focus:border-rose-500'
                              }`}
                            />
                          </td>
                          <td className="py-1.5 px-1 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveLine(index)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-rose-400 hover:bg-rose-500/15 hover:text-rose-500 transition-colors"
                              title="حذف السطر"
                              aria-label="حذف السطر"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Running Balance Indicator */}
              <div
                className={`rounded-2xl border px-4 py-2.5 flex flex-wrap justify-between items-center gap-3 transition-colors ${
                  totals.balanced
                    ? darkUi
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-emerald-200 bg-emerald-50/80 text-emerald-800'
                    : darkUi
                    ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                    : 'border-rose-200 bg-rose-50/80 text-rose-800'
                }`}
              >
                <div className="flex items-center gap-4 text-xs font-bold">
                  <div>
                    إجمالي المدين: <span className="font-currency text-sm font-black" dir="ltr">₪{fmt(totals.debit)}</span>
                  </div>
                  <div>
                    إجمالي الدائن: <span className="font-currency text-sm font-black" dir="ltr">₪{fmt(totals.credit)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-xs font-black">
                  {totals.balanced ? (
                    <>
                      <Check size={16} className="text-emerald-500 shrink-0" />
                      <span>القيد متزن ومكتمل للترحيل</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle size={16} className="text-rose-500 shrink-0" />
                      <span>غير متزن (الفرق: ₪{fmt(totals.diff)})</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Actions Footer */}
            <div
              className={`px-5 py-3.5 sm:px-6 sm:py-4 border-t flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5 shrink-0 ${
                darkUi
                  ? 'border-white/10 bg-slate-900/90'
                  : 'border-slate-200/80 bg-slate-50/90'
              }`}
            >
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className={`w-full sm:w-auto h-10 px-5 rounded-xl text-sm font-bold transition ${
                  darkUi
                    ? 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSaveEntry(false)}
                className={`w-full sm:w-auto h-10 px-5 rounded-xl text-sm font-bold transition disabled:opacity-50 ${
                  darkUi
                    ? 'border border-indigo-500/30 bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25'
                    : 'border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                }`}
              >
                حفظ كمسودة
              </button>
              <button
                type="button"
                disabled={saving || !totals.balanced}
                onClick={() => handleSaveEntry(true)}
                className={`w-full sm:w-auto h-10 px-6 rounded-xl text-sm font-black flex items-center justify-center gap-2 shadow-lg transition active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none ${
                  darkUi
                    ? 'bg-gradient-to-l from-indigo-600 to-violet-600 text-white shadow-indigo-900/40 hover:from-indigo-500 hover:to-violet-500'
                    : 'bg-gradient-to-l from-indigo-600 to-indigo-500 text-white shadow-indigo-200 hover:from-indigo-500 hover:to-indigo-400'
                }`}
              >
                {saving && <Loader2 className="animate-spin" size={16} />}
                ترحيل القيد (Post)
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
