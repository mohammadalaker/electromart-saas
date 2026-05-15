import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  RefreshCw,
  Users,
  Truck,
  Plus,
  Trash2,
  X,
  Wallet,
  AlertTriangle,
  Filter,
  Search,
  Pencil,
  FileText,
  MessageCircle,
  Phone,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import {
  outstandingDebtBadgeClasses,
  outstandingDebtMutedLabelClasses,
  outstandingDebtPanelClasses,
} from '../utils/outstandingDebtTone';

const CONTACTS_TABLE = 'store_contacts';

/** أرقام لـ wa.me (بدون +)؛ 05… → 9725… */
function whatsappDigitsFromPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0') && d.length >= 9) return `972${d.slice(1)}`;
  if (d.startsWith('972')) return d;
  return d;
}

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
  payment_type: 'cash',
  outstanding_amount: '0',
  credit_limit: '',
};

export default function CustomersSuppliers() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState('customer');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [filterBounced, setFilterBounced] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [contactSearch, setContactSearch] = useState('');

  const fetchRows = useCallback(async () => {
    if (!store?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let { data, error: qErr } = await supabase
        .from(CONTACTS_TABLE)
        .select('id, name, phone, email, address, notes, payment_type, outstanding_amount, credit_limit, returned_cheques_notes, created_at')
        .eq('store_id', store.id)
        .eq('role', tab)
        .order('created_at', { ascending: false });

      if (qErr && /credit_limit|returned_cheques_notes|column|schema|PGRST204/i.test(String(qErr.message || ''))) {
        ({ data, error: qErr } = await supabase
          .from(CONTACTS_TABLE)
          .select('id, name, phone, email, address, notes, payment_type, outstanding_amount, created_at')
          .eq('store_id', store.id)
          .eq('role', tab)
          .order('created_at', { ascending: false }));
      }

      if (qErr) throw qErr;
      setRows(data || []);
    } catch (e) {
      console.error(e);
      setError(e.message || 'تعذّر تحميل البيانات');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id, tab]);

  useEffect(() => {
    if (storeLoading) return;
    fetchRows();
  }, [storeLoading, fetchRows]);

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setForm({
      name: row.name || '',
      phone: row.phone || '',
      email: row.email || '',
      address: row.address || '',
      notes: row.notes || '',
      payment_type: row.payment_type === 'credit' ? 'credit' : 'cash',
      outstanding_amount: String(row.outstanding_amount ?? 0),
      credit_limit:
        row.credit_limit != null && row.credit_limit !== ''
          ? String(row.credit_limit)
          : '',
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!store?.id) return;
    const name = form.name.trim();
    if (!name) {
      toast.warning('يرجى إدخال الاسم');
      return;
    }
    const paymentType = form.payment_type === 'credit' ? 'credit' : 'cash';
    const amount =
      paymentType === 'credit'
        ? Math.max(0, parseFloat(String(form.outstanding_amount).replace(',', '.')) || 0)
        : 0;
    const creditLimitParsed =
      tab === 'customer' && paymentType === 'credit'
        ? (() => {
            const raw = String(form.credit_limit ?? '').trim();
            if (raw === '') return null;
            const n = parseFloat(raw.replace(',', '.'));
            return Number.isFinite(n) && n > 0 ? n : null;
          })()
        : null;
    setSaving(true);
    try {
      const payload = {
        name,
        phone: form.phone.trim(),
        email: form.email.trim(),
        address: form.address.trim(),
        notes: form.notes.trim(),
        payment_type: paymentType,
        outstanding_amount: amount,
        ...(tab === 'customer'
          ? { credit_limit: paymentType === 'credit' ? creditLimitParsed : null }
          : {}),
      };
      if (editingId) {
        const { error: uErr } = await supabase
          .from(CONTACTS_TABLE)
          .update(payload)
          .eq('id', editingId)
          .eq('store_id', store.id);
        if (uErr) throw uErr;
      } else {
        const { error: iErr } = await supabase.from(CONTACTS_TABLE).insert([
          {
            store_id: store.id,
            role: tab,
            ...payload,
          },
        ]);
        if (iErr) throw iErr;
      }
      closeModal();
      await fetchRows();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!store?.id) return;
    if (!window.confirm('حذف هذا السجل نهائياً؟')) return;
    try {
      const { error: dErr } = await supabase
        .from(CONTACTS_TABLE)
        .delete()
        .eq('id', id)
        .eq('store_id', store.id);
      if (dErr) throw dErr;
      await fetchRows();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'فشل الحذف');
    }
  };

  const preview = (s, max = 48) => {
    const t = (s || '').trim();
    if (!t) return '—';
    return t.length > max ? `${t.slice(0, max)}…` : t;
  };

  const bouncedCount = rows.filter((r) => String(r.returned_cheques_notes || '').trim()).length;
  const displayRows = filterBounced
    ? rows.filter((r) => String(r.returned_cheques_notes || '').trim())
    : rows;

  const filteredDisplayRows = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return displayRows;
    const qDigits = q.replace(/\D/g, '');
    return displayRows.filter((r) => {
      const name = (r.name || '').toLowerCase();
      const phoneRaw = (r.phone || '').trim();
      const phoneNorm = phoneRaw.replace(/\s/g, '');
      const phoneLc = phoneRaw.toLowerCase();
      const byName = name.includes(q);
      const byPhone =
        phoneLc.includes(q) || (qDigits.length > 0 && phoneNorm.includes(qDigits));
      return byName || byPhone;
    });
  }, [displayRows, contactSearch]);

  const tabStats = useMemo(() => {
    const now = Date.now();
    const windowMs = 30 * 24 * 60 * 60 * 1000;
    let totalDebt = 0;
    let newCount = 0;
    for (const r of displayRows) {
      if (r.payment_type === 'credit') {
        totalDebt += Math.max(0, Number(r.outstanding_amount ?? 0));
      }
      const t = r.created_at ? new Date(r.created_at).getTime() : NaN;
      if (Number.isFinite(t) && now - t <= windowMs) newCount += 1;
    }
    return {
      count: displayRows.length,
      totalDebt,
      newCount,
    };
  }, [displayRows]);

  const formatStatMoney = (n) =>
    Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (storeLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="animate-spin text-indigo-500 dark:text-indigo-400" size={40} />
        </div>
      </DashboardLayout>
    );
  }

  if (!store?.id) {
    return (
      <DashboardLayout>
        <div
          className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center text-amber-950 font-bold dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
          dir="rtl"
        >
          لا يوجد متجر مرتبط بحسابك.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/customers/debt"
            className="inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-2.5 text-sm font-black text-amber-900 shadow-sm hover:bg-amber-100/90 transition-all dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/45 dark:shadow-none"
          >
            <Wallet size={18} />
            صفحة الذمم والديون
          </Link>
          <button
            type="button"
            onClick={() => fetchRows()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-all dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10 dark:shadow-none"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            تحديث
          </button>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white shadow-md hover:bg-indigo-700 transition-all dark:shadow-indigo-950/50"
          >
            <Plus size={18} />
            {tab === 'customer' ? 'إضافة زبون' : 'إضافة مورد'}
          </button>
        </div>
      }
    >
      <style>{`
        @keyframes posCheckoutShine {
          0% { transform: translateX(-170%) skewX(-18deg); }
          45%, 100% { transform: translateX(420%) skewX(-18deg); }
        }
        .pos-checkout-shine {
          animation: posCheckoutShine 2.6s ease-in-out infinite;
        }
      `}</style>
      <div className="space-y-4" dir="rtl">
        <div className="flex flex-wrap gap-2 p-1 rounded-2xl bg-slate-100/90 border border-slate-200/80 w-fit max-w-full dark:bg-slate-800/80 dark:border-slate-600/50">
          <button
            type="button"
            onClick={() => setTab('customer')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black transition-all ${
              tab === 'customer'
                ? 'bg-white text-indigo-700 shadow-md dark:bg-indigo-950/60 dark:text-indigo-200 dark:shadow-lg dark:shadow-black/20'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <Users size={18} />
            الزبائن
          </button>
          <button
            type="button"
            onClick={() => setTab('supplier')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black transition-all ${
              tab === 'supplier'
                ? 'bg-white text-indigo-700 shadow-md dark:bg-indigo-950/60 dark:text-indigo-200 dark:shadow-lg dark:shadow-black/20'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <Truck size={18} />
            الموردين
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-[0_4px_32px_-8px_rgba(15,23,42,0.12)] overflow-hidden dark:border-gray-700/50 dark:bg-gray-900/70 dark:shadow-[0_4px_32px_-8px_rgba(0,0,0,0.45)]">
          <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-l from-violet-50/50 to-white dark:border-slate-700/60 dark:from-indigo-950/40 dark:to-gray-900/90 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white">
                {tab === 'customer' ? 'دليل الزبائن' : 'دليل الموردين'}
              </h3>
              <p className="text-xs text-slate-500 mt-1 font-medium dark:text-slate-400">
                سجّل بيانات التواصل لاستخدامها لاحقاً في الطلبات والمشتريات
              </p>
            </div>
            {tab === 'customer' && bouncedCount > 0 && (
              <button
                type="button"
                onClick={() => setFilterBounced((v) => !v)}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black transition-all ${
                  filterBounced
                    ? 'border-rose-500 bg-rose-500 text-white shadow-sm'
                    : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-900/40'
                }`}
              >
                <AlertTriangle size={14} />
                شيكات مرتجعة
                <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-black ${
                  filterBounced ? 'bg-white/20 text-white' : 'bg-rose-200 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200'
                }`}>
                  {bouncedCount}
                </span>
                {filterBounced && <Filter size={11} />}
              </button>
            )}
          </div>

          {error && (
            <div className="mx-6 mt-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 space-y-2 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100">
              <p>{error}</p>
              <p className="text-xs font-normal text-rose-700/90 dark:text-rose-200/90 leading-relaxed">
                نفّذ في Supabase:{' '}
                <code className="bg-white/80 dark:bg-rose-900/40 px-1 rounded">store_contacts.sql</code> ثم{' '}
                <code className="bg-white/80 dark:bg-rose-900/40 px-1 rounded">store_contacts_payment_columns.sql</code>
              </p>
            </div>
          )}

          <div className="px-4 pt-2 pb-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute right-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-indigo-400"
                aria-hidden
              />
              <input
                type="search"
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder="بحث بالاسم أو الهاتف…"
                className="w-full rounded-2xl border border-slate-200/90 bg-white py-2.5 pr-10 pl-4 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20 dark:border-white/10 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-indigo-500/50"
              />
            </div>
          </div>

          {!loading && (
            <div className="px-4 pb-2">
              <div className="mb-4 flex flex-wrap gap-3 sm:mb-6 sm:flex-nowrap sm:gap-4">
                <div className="min-w-[140px] flex-1 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-800/80">
                  <p className="text-sm text-gray-500 dark:text-slate-400">
                    {tab === 'customer' ? 'إجمالي الزبائن' : 'إجمالي الموردين'}
                  </p>
                  <p className="text-2xl font-black text-slate-900 dark:text-white">{tabStats.count}</p>
                </div>
                <div className="min-w-[140px] flex-1 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-800/80">
                  <p className="text-sm text-gray-500 dark:text-slate-400">
                    {tab === 'customer' ? 'إجمالي الديون' : 'إجمالي المستحقات'}
                  </p>
                  <p className="text-2xl font-black text-rose-600 dark:text-rose-400" dir="ltr" lang="en">
                    ₪{formatStatMoney(tabStats.totalDebt)}
                  </p>
                </div>
                <div className="min-w-[140px] flex-1 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-800/80">
                  <p className="text-sm text-gray-500 dark:text-slate-400">
                    {tab === 'customer' ? 'زبائن جدد' : 'موردين جدد'}
                  </p>
                  <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                    {tabStats.newCount > 0 ? `+${tabStats.newCount}` : tabStats.newCount}
                  </p>
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-indigo-500 dark:text-indigo-400" size={36} />
            </div>
          ) : displayRows.length === 0 ? (
            <div className="py-16 text-center text-slate-500 dark:text-slate-400">
              <div className="inline-flex flex-col items-center gap-3 px-8 py-6 rounded-2xl bg-gradient-to-b from-slate-50/80 to-transparent dark:from-slate-800/40 dark:to-transparent">
                {filterBounced ? (
                  <AlertTriangle className="text-rose-300 dark:text-rose-700" size={56} />
                ) : tab === 'customer' ? (
                  <Users className="text-slate-300 dark:text-slate-600" size={56} />
                ) : (
                  <Truck className="text-slate-300 dark:text-slate-600" size={56} />
                )}
                <p className="font-bold text-slate-600 dark:text-slate-300">
                  {filterBounced ? 'لا توجد شيكات مرتجعة' : 'لا توجد سجلات بعد'}
                </p>
                {filterBounced ? (
                  <button
                    type="button"
                    onClick={() => setFilterBounced(false)}
                    className="text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:underline"
                  >
                    عرض الكل
                  </button>
                ) : (
                  <p className="text-xs text-slate-400 dark:text-slate-500">استخدم «إضافة» لإنشاء أول سجل</p>
                )}
              </div>
            </div>
          ) : filteredDisplayRows.length === 0 ? (
            <div className="py-16 text-center text-slate-500 dark:text-slate-400">
              <p className="font-bold text-slate-600 dark:text-slate-300">لا توجد نتائج للبحث</p>
              <button
                type="button"
                onClick={() => setContactSearch('')}
                className="mt-2 text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:underline"
              >
                مسح البحث
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredDisplayRows.map((row) => {
                const hasBounced = Boolean(String(row.returned_cheques_notes || '').trim());
                const initial = (row.name && row.name.trim().charAt(0)) || '?';
                const phoneTrim = (row.phone || '').trim();
                const waDigits = phoneTrim ? whatsappDigitsFromPhone(phoneTrim) : '';
                return (
                  <div
                    key={row.id}
                    className={`rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-slate-900/60 ${
                      hasBounced ? 'ring-1 ring-rose-200/70 dark:ring-rose-900/50' : ''
                    }`}
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-black text-white">
                          {initial}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-black text-slate-900 dark:text-white">{row.name || '—'}</p>
                          <span
                            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-black ${
                              row.payment_type === 'credit'
                                ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100 dark:ring-1 dark:ring-amber-800/40'
                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-200 dark:ring-1 dark:ring-emerald-800/40'
                            }`}
                          >
                            {row.payment_type === 'credit' ? 'دين' : 'كاش'}
                          </span>
                        </div>
                      </div>
                      {hasBounced && (
                        <span
                          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-200 bg-rose-100 px-1.5 py-0.5 text-[9px] font-black text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/50 dark:text-rose-300"
                          title={String(row.returned_cheques_notes).trim()}
                        >
                          <AlertTriangle size={9} />
                          شيك مرتجع
                        </span>
                      )}
                    </div>

                    {row.payment_type === 'credit' && (
                      <div
                        className={`mb-3 rounded-xl border px-3 py-2 ${outstandingDebtPanelClasses(row.outstanding_amount)}`}
                      >
                        <p className="text-xs font-bold">
                          <span
                            className={`inline-block rounded-lg px-2 py-1 font-black ${outstandingDebtBadgeClasses(row.outstanding_amount)}`}
                          >
                            مستحق: ₪{Number(row.outstanding_amount ?? 0).toFixed(2)}
                          </span>
                        </p>
                        {tabStats.totalDebt > 0 && (
                          <div
                            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700/80"
                            dir="ltr"
                            title={`${((Math.max(0, Number(row.outstanding_amount ?? 0)) / tabStats.totalDebt) * 100).toFixed(1)}% من إجمالي الديون في الدليل`}
                          >
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-rose-400 to-rose-600"
                              style={{
                                width: `${Math.min(
                                  100,
                                  (Math.max(0, Number(row.outstanding_amount ?? 0)) / tabStats.totalDebt) * 100
                                )}%`,
                              }}
                            />
                          </div>
                        )}
                        {tab === 'customer' &&
                          row.credit_limit != null &&
                          Number(row.credit_limit) > 0 && (
                            <p
                              className={`mt-1 text-[10px] font-bold ${outstandingDebtMutedLabelClasses(row.outstanding_amount)}`}
                              dir="ltr"
                            >
                              سقف: ₪
                              {Number(row.credit_limit).toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </p>
                          )}
                      </div>
                    )}

                    <div className="space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                      {row.phone?.trim() && (
                        <p dir="ltr">
                          <span aria-hidden>📞 </span>
                          {row.phone.trim()}
                        </p>
                      )}
                      {row.email?.trim() && (
                        <p className="truncate" dir="ltr" title={row.email}>
                          <span aria-hidden>✉️ </span>
                          {row.email.trim()}
                        </p>
                      )}
                      {row.address?.trim() && (
                        <p title={row.address}>
                          <span aria-hidden>📍 </span>
                          {row.address.trim().slice(0, 40)}
                          {row.address.trim().length > 40 ? '…' : ''}
                        </p>
                      )}
                      {row.notes?.trim() && (
                        <p className="line-clamp-2 text-[11px] text-slate-400 dark:text-slate-500" title={row.notes}>
                          {preview(row.notes, 80)}
                        </p>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-start gap-2 border-t border-slate-100 pt-3 dark:border-white/5">
                      <div className="flex gap-2">
                        {waDigits && (
                          <a
                            href={`https://wa.me/${waDigits}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-100 text-green-600 transition-colors hover:bg-green-200 dark:bg-green-950/40 dark:text-green-400 dark:hover:bg-green-900/50"
                            title="واتساب"
                            aria-label="فتح واتساب"
                          >
                            <MessageCircle size={18} />
                          </a>
                        )}
                        {phoneTrim && (
                          <a
                            href={`tel:${phoneTrim.replace(/\s/g, '')}`}
                            className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-600 transition-colors hover:bg-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:hover:bg-blue-900/50"
                            title="اتصال"
                            aria-label="اتصال"
                          >
                            <Phone size={18} />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 transition-colors hover:bg-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
                          title="تعديل"
                          aria-label="تعديل"
                        >
                          <Pencil size={18} />
                        </button>
                      </div>
                      {tab === 'customer' && (
                        <Link
                          to={`/customers/${row.id}`}
                          className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-50 text-purple-600 transition-colors hover:bg-purple-100 dark:bg-purple-950/40 dark:text-purple-300 dark:hover:bg-purple-900/50"
                          title="الملف"
                          aria-label="الملف"
                        >
                          <FileText size={18} />
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(row.id)}
                        className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/50"
                        title="حذف"
                        aria-label="حذف"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 dark:bg-black/65"
          dir="rtl"
          onClick={() => !saving && closeModal()}
        >
          <div
            className="bg-white rounded-3xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-100 dark:bg-gray-900 dark:border-gray-700/60 dark:shadow-black/40"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700/80">
              <h3 className="text-lg font-black text-slate-900 dark:text-white">
                {editingId
                  ? tab === 'customer'
                    ? 'تعديل زبون'
                    : 'تعديل مورد'
                  : tab === 'customer'
                    ? 'زبون جديد'
                    : 'مورد جديد'}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 disabled:opacity-40 dark:hover:bg-slate-800 dark:text-slate-400"
              >
                <X size={22} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300 block mb-1.5">الاسم *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 outline-none dark:border-slate-600 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-500 dark:focus:ring-indigo-500/30 dark:focus:border-indigo-500/60"
                  placeholder="الاسم أو اسم الشركة"
                />
              </div>
              <div>
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300 block mb-1.5">الهاتف</label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-currency dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-100"
                  dir="ltr"
                  lang="en"
                  placeholder="05xxxxxxxx"
                />
              </div>
              <div>
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300 block mb-1.5">البريد</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-currency dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-100"
                  dir="ltr"
                  lang="en"
                />
              </div>
              <div>
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300 block mb-1.5">العنوان</label>
                <textarea
                  value={form.address}
                  onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                  rows={2}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm resize-none focus:ring-2 focus:ring-indigo-200 outline-none dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-100 dark:focus:ring-indigo-500/30"
                />
              </div>
              <div>
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300 block mb-1.5">ملاحظات</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                  rows={2}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm resize-none focus:ring-2 focus:ring-indigo-200 outline-none dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-100 dark:focus:ring-indigo-500/30"
                />
              </div>
              <div>
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300 block mb-2">طريقة الدفع</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setForm((p) => ({
                        ...p,
                        payment_type: 'cash',
                        outstanding_amount: '0',
                        credit_limit: '',
                      }))
                    }
                    className={`flex-1 py-3 rounded-2xl text-sm font-black border-2 transition-all ${
                      form.payment_type === 'cash'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-200 dark:border-emerald-400'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-400 dark:hover:border-slate-500'
                    }`}
                  >
                    كاش
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, payment_type: 'credit' }))}
                    className={`flex-1 py-3 rounded-2xl text-sm font-black border-2 transition-all ${
                      form.payment_type === 'credit'
                        ? 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/45 dark:text-amber-100 dark:border-amber-400'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-400 dark:hover:border-slate-500'
                    }`}
                  >
                    دين
                  </button>
                </div>
              </div>
              {form.payment_type === 'credit' && (
                <div>
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300 block mb-1.5">
                    المبلغ المستحق على الذمة (₪)
                  </label>
                  <input
                    value={form.outstanding_amount}
                    onChange={(e) => setForm((p) => ({ ...p, outstanding_amount: e.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-currency dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-100"
                    dir="ltr"
                    lang="en"
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </div>
              )}
              {form.payment_type === 'credit' && tab === 'customer' && (
                <div>
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300 block mb-1.5">
                    سقف الدين (₪)
                  </label>
                  <p className="text-[11px] text-slate-500 mb-1.5 leading-relaxed dark:text-slate-400">
                    أقصى ذمة مسموح بها لهذا الزبون. اتركه فارغاً لعدم تفعيل السقف.
                  </p>
                  <input
                    value={form.credit_limit}
                    onChange={(e) => setForm((p) => ({ ...p, credit_limit: e.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-currency dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-100"
                    dir="ltr"
                    lang="en"
                    inputMode="decimal"
                    placeholder="بدون سقف"
                  />
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="relative flex-1 overflow-hidden rounded-2xl bg-gradient-to-l from-indigo-600 to-violet-700 py-3.5 text-sm font-black text-white transition hover:brightness-110 disabled:opacity-50 dark:shadow-lg dark:shadow-indigo-950/40"
                >
                  <span className="relative z-[1]">{saving ? 'جاري الحفظ…' : 'حفظ'}</span>
                  {!saving && (
                    <span
                      className="pos-checkout-shine pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent"
                      aria-hidden
                    />
                  )}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="px-6 py-3.5 rounded-2xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800/80"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
