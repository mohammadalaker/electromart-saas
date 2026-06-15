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

const JOURNAL_TABLE = 'accounting_journal';
const ACCOUNTS_TABLE = 'accounting_accounts';

const toEnglishNumbers = (str) => {
  return String(str).replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => d.charCodeAt(0) - 1632)
                    .replace(/[۰۱۲۳۴۵۶۷۸۹]/g, d => d.charCodeAt(0) - 1776);
};

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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-arabic" dir="rtl">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => !saving && setModalOpen(false)}
            aria-hidden
          />

          <div
            className="relative bg-white/80 dark:bg-gray-900/50 backdrop-blur-md border border-white/20 dark:border-gray-700/30 w-full max-w-4xl max-h-[92vh] flex flex-col rounded-[32px] shadow-2xl overflow-hidden transition-all duration-300"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Header */}
            <div className="flex-shrink-0 p-6 border-b border-slate-100 dark:border-gray-700/40 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/40">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shrink-0">
                  <BookOpen size={20} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xl font-black text-gray-900 dark:text-white truncate">
                    {editEntry ? `تعديل قيد: ${editEntry.entry_number}` : 'إنشاء قيد محاسبي جديد'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    سجل القيود اليومية المحاسبية المزدوجة
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={saving}
                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors shrink-0 disabled:opacity-50 text-slate-400"
                aria-label="إغلاق"
              >
                <X size={20} />
              </button>
            </div>

            {/* Scrollable Form Body */}
            <div className="p-6 sm:p-8 space-y-6 overflow-y-auto flex-1 min-h-0 [scrollbar-width:thin]">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Entry Number */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-1.5">رقم القيد *</label>
                  <input
                    type="text"
                    required
                    placeholder="مثال: JE-2024-001"
                    value={entryNumber}
                    onChange={(e) => setEntryNumber(e.target.value)}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-gray-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                </div>

                {/* Entry Date */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-1.5">تاريخ القيد *</label>
                  <input
                    type="date"
                    required
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-gray-900 dark:text-white"
                  />
                </div>

                {/* Entry Type */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-1.5">نوع القيد *</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-gray-900 dark:text-white"
                  >
                    {Object.entries(TYPE_META).map(([k, v]) => (
                      <option key={k} value={k} className="bg-white dark:bg-slate-900 text-gray-900 dark:text-white">
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Description */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-1.5">البيان / الوصف الإجمالي</label>
                  <input
                    type="text"
                    placeholder="شرح بسيط للقيد..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-gray-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                </div>

                {/* Reference */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-1.5">المرجع</label>
                  <input
                    type="text"
                    placeholder="رقم الفاتورة أو السند المرتبط..."
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-gray-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                </div>
              </div>

              {/* Dynamic Lines Table */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-black text-slate-700 dark:text-slate-200">بنود وسطور القيد (مزدوج)</span>
                  <button
                    type="button"
                    onClick={handleAddLine}
                    className="inline-flex items-center gap-1 rounded-xl bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-xs font-bold text-indigo-600 dark:text-indigo-300 px-3 py-1.5 transition-colors"
                  >
                    <Plus size={14} />
                    إضافة سطر
                  </button>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700/60 overflow-hidden bg-slate-50/50 dark:bg-slate-800/20 p-2">
                  <table className="w-full text-xs text-right min-w-[600px]">
                    <thead>
                      <tr className="text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700/60">
                        <th className="py-2 px-2 font-black w-1/3">الحساب المالي *</th>
                        <th className="py-2 px-2 font-black">البيان (اختياري)</th>
                        <th className="py-2 px-2 font-black text-center w-24">مدين ₪</th>
                        <th className="py-2 px-2 font-black text-center w-24">دائن ₪</th>
                        <th className="py-2 px-2 w-10 text-center">حذف</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, index) => (
                        <tr key={index} className="border-b border-slate-100 dark:border-slate-800/50">
                          <td className="py-2 px-1">
                            <select
                              required
                              value={line.account_id}
                              onChange={(e) => handleUpdateLine(index, 'account_id', e.target.value)}
                              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs font-bold text-gray-900 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
                            >
                              <option value="" className="text-slate-500 dark:bg-slate-900">اختر الحساب...</option>
                              {accounts.map((acc) => (
                                <option key={acc.id} value={acc.id} className="dark:bg-slate-900 text-gray-900 dark:text-white">
                                  [{acc.code}] {acc.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 px-1">
                            <input
                              type="text"
                              placeholder="بيان خاص بالسطر..."
                              value={line.description}
                              onChange={(e) => handleUpdateLine(index, 'description', e.target.value)}
                              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-gray-900 dark:text-slate-200 focus:outline-none"
                            />
                          </td>
                          <td className="py-2 px-1">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={line.debit || ''}
                              onChange={(e) => {
                                const converted = toEnglishNumbers(e.target.value);
                                handleUpdateLine(index, 'debit', converted);
                              }}
                              placeholder="0.00"
                              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs font-bold text-center text-emerald-600 dark:text-emerald-400 focus:outline-none"
                            />
                          </td>
                          <td className="py-2 px-1">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={line.credit || ''}
                              onChange={(e) => {
                                const converted = toEnglishNumbers(e.target.value);
                                handleUpdateLine(index, 'credit', converted);
                              }}
                              placeholder="0.00"
                              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs font-bold text-center text-rose-600 dark:text-rose-400 focus:outline-none"
                            />
                          </td>
                          <td className="py-2 px-1 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveLine(index)}
                              className="text-rose-500 hover:text-rose-700 p-1"
                              title="حذف السطر"
                            >
                              &times;
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Running Balance Indicator */}
              <div className={`rounded-2xl border p-4 flex flex-wrap justify-between items-center gap-4 ${
                totals.balanced
                  ? 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/5 text-emerald-800 dark:text-emerald-300'
                  : 'border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/5 text-rose-800 dark:text-rose-300'
              }`}>
                <div className="flex gap-4 text-xs font-bold">
                  <div>إجمالي المدين: <span className="font-mono text-sm">₪{fmt(totals.debit)}</span></div>
                  <div>إجمالي الدائن: <span className="font-mono text-sm">₪{fmt(totals.credit)}</span></div>
                </div>

                <div className="flex items-center gap-1.5 text-xs font-black">
                  {totals.balanced ? (
                    <>
                      <Check size={16} />
                      <span>القيد متزن ومكتمل للترحيل</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle size={16} />
                      <span>غير متزن (فرق التوازن: ₪{fmt(totals.diff)})</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Actions Footer */}
            <div className="flex flex-col-reverse sm:flex-row gap-3 sm:gap-4 p-6 sm:px-8 border-t border-slate-100 dark:border-gray-700/40 shrink-0 bg-slate-50/50 dark:bg-slate-800/40">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="sm:px-8 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSaveEntry(false)}
                className="sm:px-8 py-4 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-900/50 rounded-2xl font-bold hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-all"
              >
                حفظ كمسودة
              </button>
              <button
                type="button"
                disabled={saving || !totals.balanced}
                onClick={() => handleSaveEntry(true)}
                className="flex-1 bg-indigo-600 text-white py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-indigo-700 shadow-lg shadow-indigo-200/80 transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
              >
                {saving && <Loader2 className="animate-spin" size={18} />}
                ترحيل القيد (Post)
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
