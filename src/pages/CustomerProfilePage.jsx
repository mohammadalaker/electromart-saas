import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  Loader2,
  User,
  Mail,
  MapPin,
  Wallet,
  ArrowRight,
  ShoppingCart,
  Receipt,
  AlertCircle,
  Save,
  ExternalLink,
  Bookmark,
  TrendingUp,
  Calendar,
  BarChart2,
  RotateCcw,
  Phone,
  CreditCard,
  Award,
  Clock,
  Plus,
  CheckCircle2,
  Pencil,
  Trash2,
  XCircle,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';

const CONTACTS = 'store_contacts';
const SALES = 'sales';
const PRE_ORDERS = 'pre_orders';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatMoney(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return '0.00';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return String(iso).slice(0, 16);
  }
}

function timeAgo(iso) {
  if (!iso) return null;
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'اليوم';
    if (days === 1) return 'أمس';
    if (days < 7) return `منذ ${days} أيام`;
    if (days < 30) return `منذ ${Math.floor(days / 7)} أسابيع`;
    if (days < 365) return `منذ ${Math.floor(days / 30)} أشهر`;
    return `منذ ${Math.floor(days / 365)} سنة`;
  } catch {
    return null;
  }
}

function paymentLabelArabic(pm, notes) {
  const p = String(pm || '').toLowerCase();
  if (p === 'credit') return 'ذمة';
  if (p === 'cash') return 'كاش';
  const n = String(notes || '');
  if (/شيك|check|تحصيل|فيزا|visa/i.test(n)) {
    if (/شيك|check/i.test(n)) return 'كاش (شيك)';
    if (/فيزا|visa/i.test(n)) return 'كاش (فيزا)';
  }
  return p || '—';
}

const EMPTY_CHEQUE = {
  number: '',
  amount: '',
  date: '',
  returnDate: '',
  bank: '',
  reason: '',
  status: 'open',
};

function parseCheques(raw) {
  if (!raw) return [];
  const str = String(raw).trim();
  if (!str) return [];
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [{ ...EMPTY_CHEQUE, reason: str, status: 'open', _legacy: true }];
}

function serializeCheques(list) {
  if (!list || list.length === 0) return null;
  return JSON.stringify(list.map(({ _legacy, ...rest }) => rest));
}

function StatCard({ icon: Icon, label, value, sub, color = 'indigo', trend }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400',
  };
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-gray-700/50 dark:bg-gray-900/70">
      <div className="flex items-start justify-between gap-2">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${colors[color]}`}>
          <Icon size={20} />
        </div>
        {trend != null && (
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
            trend > 0
              ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
              : trend < 0
                ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400'
                : 'bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
          }`}>
            {trend > 0 ? '↑' : trend < 0 ? '↓' : '—'}
          </span>
        )}
      </div>
      <p className="mt-3 text-xl font-black text-slate-900 dark:text-white font-currency" dir="ltr" lang="en">
        {value}
      </p>
      <p className="mt-0.5 text-xs font-bold text-slate-500 dark:text-slate-400">{label}</p>
      {sub && <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">{sub}</p>}
    </div>
  );
}

export default function CustomerProfilePage() {
  const { contactId } = useParams();
  const navigate = useNavigate();
  const { store, loading: storeLoading } = useStore();

  const [contact, setContact] = useState(null);
  const [sales, setSales] = useState([]);
  const [preOrders, setPreOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [chequesList, setChequesList] = useState([]);
  const [chequesAddingNew, setChequesAddingNew] = useState(false);
  const [chequesEditingIdx, setChequesEditingIdx] = useState(null);
  const [chequesForm, setChequesForm] = useState(EMPTY_CHEQUE);
  const [chequesSaving, setChequesSaving] = useState(false);
  const [chequesError, setChequesError] = useState(null);

  const validId = contactId && UUID_RE.test(contactId);

  const loadAll = useCallback(async () => {
    if (!store?.id || !validId) return;
    setLoading(true);
    setError(null);
    try {
      let sel =
        'id, name, phone, email, address, notes, payment_type, outstanding_amount, credit_limit, loyalty_points, returned_cheques_notes, created_at';
      let { data: c, error: cErr } = await supabase
        .from(CONTACTS)
        .select(sel)
        .eq('id', contactId)
        .eq('store_id', store.id)
        .eq('role', 'customer')
        .maybeSingle();

      if (cErr && /returned_cheques_notes|loyalty_points|column|schema|PGRST204/i.test(String(cErr.message || ''))) {
        sel = 'id, name, phone, email, address, notes, payment_type, outstanding_amount, credit_limit, created_at';
        ({ data: c, error: cErr } = await supabase
          .from(CONTACTS)
          .select(sel)
          .eq('id', contactId)
          .eq('store_id', store.id)
          .eq('role', 'customer')
          .maybeSingle());
      }
      if (cErr) throw cErr;
      if (!c?.id) {
        setContact(null);
        setError('الزبون غير موجود أو ليس من عملاء هذا المتجر.');
        setSales([]);
        setPreOrders([]);
        return;
      }
      setContact(c);
      setChequesList(parseCheques(c.returned_cheques_notes));

      const salesSelect =
        'id, created_at, total_amount, payment_mode, notes, line_items, contact_id, returned_at, return_note, pos_tender';
      let { data: sRows, error: sErr } = await supabase
        .from(SALES)
        .select(salesSelect)
        .eq('store_id', store.id)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(250);

      if (sErr && /pos_tender|column|schema|PGRST204/i.test(String(sErr.message || ''))) {
        ({ data: sRows, error: sErr } = await supabase
          .from(SALES)
          .select('id, created_at, total_amount, payment_mode, notes, line_items, contact_id, returned_at, return_note')
          .eq('store_id', store.id)
          .eq('contact_id', contactId)
          .order('created_at', { ascending: false })
          .limit(250));
      }
      if (sErr) throw sErr;
      setSales(sRows || []);

      let { data: po, error: poErr } = await supabase
        .from(PRE_ORDERS)
        .select('id, order_no, status, total_amount, created_at')
        .eq('store_id', store.id)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (poErr && /does not exist|schema|PGRST205/i.test(String(poErr.message || ''))) po = [];
      else if (poErr) { console.warn('[CustomerProfile] pre_orders', poErr.message); po = []; }
      setPreOrders(po || []);
    } catch (e) {
      console.error(e);
      setError(e.message || 'تعذّر التحميل');
      setContact(null);
    } finally {
      setLoading(false);
    }
  }, [store?.id, contactId, validId]);

  useEffect(() => {
    if (storeLoading) return;
    loadAll();
  }, [storeLoading, loadAll]);

  const balance = useMemo(() => Math.max(0, Number(contact?.outstanding_amount ?? 0)), [contact]);

  const stats = useMemo(() => {
    const activeSales = sales.filter((s) => !s.returned_at);
    const totalSpent = activeSales.reduce((sum, s) => sum + Number(s.total_amount ?? 0), 0);
    const returnedCount = sales.filter((s) => s.returned_at).length;
    const lastPurchase = sales.length > 0 ? sales[0].created_at : null;
    const avgInvoice = activeSales.length > 0 ? totalSpent / activeSales.length : 0;
    const creditCount = activeSales.filter((s) => s.payment_mode === 'credit').length;
    const cashCount = activeSales.filter((s) => s.payment_mode === 'cash').length;
    return {
      totalSpent,
      invoiceCount: sales.length,
      activeCount: activeSales.length,
      returnedCount,
      lastPurchase,
      avgInvoice,
      creditCount,
      cashCount,
    };
  }, [sales]);

  const saveCheques = async (newList) => {
    if (!store?.id || !contact?.id) return;
    setChequesSaving(true);
    setChequesError(null);
    try {
      const raw = serializeCheques(newList);
      const { error: uErr } = await supabase
        .from(CONTACTS)
        .update({ returned_cheques_notes: raw })
        .eq('id', contact.id)
        .eq('store_id', store.id);
      if (uErr && /returned_cheques_notes|column|schema|PGRST204/i.test(String(uErr.message || ''))) {
        setChequesError('نفّذ في Supabase الملف: supabase/store_contacts_returned_cheques_notes.sql');
        return;
      }
      if (uErr) throw uErr;
      setChequesList(newList);
      setContact((p) => (p ? { ...p, returned_cheques_notes: raw } : p));
    } catch (e) {
      console.error(e);
      setChequesError(e.message || 'فشل الحفظ');
    } finally {
      setChequesSaving(false);
    }
  };

  const handleChequeSave = async () => {
    const entry = {
      number: chequesForm.number.trim(),
      amount: chequesForm.amount.trim(),
      date: chequesForm.date,
      returnDate: chequesForm.returnDate,
      bank: chequesForm.bank.trim(),
      reason: chequesForm.reason.trim(),
      status: chequesForm.status,
    };
    let newList;
    if (chequesEditingIdx !== null) {
      newList = chequesList.map((c, i) => (i === chequesEditingIdx ? entry : c));
    } else {
      newList = [...chequesList, entry];
    }
    await saveCheques(newList);
    setChequesAddingNew(false);
    setChequesEditingIdx(null);
    setChequesForm(EMPTY_CHEQUE);
  };

  const handleChequeDelete = async (idx) => {
    if (!window.confirm('حذف هذا الشيك نهائياً؟')) return;
    await saveCheques(chequesList.filter((_, i) => i !== idx));
  };

  const handleChequeResolve = async (idx) => {
    const newList = chequesList.map((c, i) =>
      i === idx ? { ...c, status: 'resolved' } : c
    );
    await saveCheques(newList);
  };

  const openAddCheque = () => {
    setChequesEditingIdx(null);
    setChequesForm(EMPTY_CHEQUE);
    setChequesAddingNew(true);
  };

  const openEditCheque = (idx) => {
    setChequesEditingIdx(idx);
    setChequesForm({ ...EMPTY_CHEQUE, ...chequesList[idx] });
    setChequesAddingNew(true);
  };

  if (!validId) return <Navigate to="/customers" replace />;

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
        <div className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center font-bold dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100" dir="rtl">
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
            to="/customers"
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <ArrowRight size={18} />
            دليل الزبائن
          </Link>
          <Link
            to="/sales/customer-statement"
            className="inline-flex items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-black text-indigo-900 shadow-sm hover:bg-indigo-100 dark:border-indigo-800/50 dark:bg-indigo-950/40 dark:text-indigo-100 dark:hover:bg-indigo-900/50"
          >
            <Receipt size={18} />
            كشف حساب (ذمة)
          </Link>
        </div>
      }
    >
      <div className="max-w-6xl mx-auto space-y-6" dir="rtl">
        <button
          type="button"
          onClick={() => navigate('/customers')}
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-300 transition-colors"
        >
          <ArrowRight size={18} />
          رجوع للدليل
        </button>

        {/* بانر شيكات مرتجعة */}
        {!loading && contact && chequesList.filter(c => c.status !== 'resolved').length > 0 && (
          <div className="rounded-2xl border border-rose-300 bg-rose-50 px-5 py-4 dark:border-rose-700/50 dark:bg-rose-950/30">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="text-rose-600 dark:text-rose-400 shrink-0" size={20} />
              <p className="font-black text-rose-800 dark:text-rose-200 text-sm">
                ⚠️ تحذير — {chequesList.filter(c => c.status !== 'resolved').length === 1 ? 'يوجد شيك مرتجع مفتوح' : `يوجد ${chequesList.filter(c => c.status !== 'resolved').length} شيكات مرتجعة مفتوحة`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {chequesList.filter(c => c.status !== 'resolved').map((ch, i) => (
                <div key={i} className="rounded-xl bg-white border border-rose-200 px-3 py-1.5 text-xs dark:bg-rose-950/30 dark:border-rose-800/50">
                  {ch.number && <span className="font-black text-rose-800 dark:text-rose-200">#{ch.number} </span>}
                  {ch.amount && <span className="font-currency font-bold text-rose-700 dark:text-rose-300" dir="ltr">₪{ch.amount} </span>}
                  {ch.date && <span className="text-rose-600 dark:text-rose-400">{ch.date}</span>}
                  {!ch.number && !ch.amount && <span className="text-rose-700 dark:text-rose-300">{String(ch.reason || '').slice(0, 40)}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-indigo-500 dark:text-indigo-400" size={40} />
          </div>
        ) : error && !contact ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100 font-bold">
            {error}
          </div>
        ) : contact ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* ===== ASIDE — بطاقة الزبون ===== */}
            <aside className="lg:col-span-4 space-y-4">

              {/* بطاقة الهوية */}
              <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden dark:border-gray-700/50 dark:bg-gray-900/70">
                <div className="p-6 bg-gradient-to-br from-indigo-500/10 via-violet-500/5 to-transparent dark:from-indigo-950/50 dark:via-violet-950/30 border-b border-slate-100 dark:border-slate-700/60">
                  <div className="flex flex-col items-center text-center gap-3">
                    <div className="relative">
                      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-indigo-950/80 dark:to-violet-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-300 shadow-sm">
                        <User size={40} strokeWidth={1.5} />
                      </div>
                      {stats.activeCount > 0 && (
                        <span className="absolute -bottom-1 -left-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-black text-white shadow-sm px-1">
                          {stats.activeCount}
                        </span>
                      )}
                    </div>
                    <div>
                      <h1 className="text-xl font-black text-slate-900 dark:text-white">{contact.name || '—'}</h1>
                      {contact.phone ? (
                        <p className="text-sm font-currency font-bold text-slate-500 dark:text-slate-400 mt-0.5 flex items-center justify-center gap-1.5" dir="ltr">
                          <Phone size={13} className="text-slate-400 dark:text-slate-500" />
                          {contact.phone}
                        </p>
                      ) : null}
                    </div>
                    {contact.created_at && (
                      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1">
                        <Calendar size={10} />
                        زبون منذ {new Date(contact.created_at).getFullYear()}
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  {/* رصيد الذمة */}
                  <div className={`rounded-xl p-4 border ${
                    balance > 0.005
                      ? 'border-rose-200 bg-rose-50/90 dark:border-rose-900/40 dark:bg-rose-950/30'
                      : 'border-emerald-100 bg-emerald-50/60 dark:border-emerald-900/30 dark:bg-emerald-950/20'
                  }`}>
                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                      <CreditCard size={11} />
                      رصيد الذمة الحالي
                    </p>
                    <p className={`text-2xl font-black font-currency ${
                      balance > 0.005 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'
                    }`} dir="ltr">
                      ₪ {formatMoney(balance)}
                    </p>
                    {contact.credit_limit > 0 && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                          <span>حد الائتمان</span>
                          <span dir="ltr" lang="en">₪ {formatMoney(contact.credit_limit)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              balance / contact.credit_limit > 0.8
                                ? 'bg-rose-500'
                                : balance / contact.credit_limit > 0.5
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(100, (balance / contact.credit_limit) * 100).toFixed(1)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* نقاط الولاء */}
                  {contact.loyalty_points > 0 && (
                    <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3 flex items-center gap-3 dark:border-amber-800/30 dark:bg-amber-950/20">
                      <Award className="text-amber-500 shrink-0" size={20} />
                      <div>
                        <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300">نقاط الولاء</p>
                        <p className="text-lg font-black text-amber-800 dark:text-amber-200 font-currency" dir="ltr">
                          {Number(contact.loyalty_points).toLocaleString('en-US')}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* معلومات التواصل */}
                  {contact.email ? (
                    <div className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                      <Mail size={15} className="shrink-0 mt-0.5 text-slate-400" />
                      <span className="font-currency break-all text-xs" dir="ltr">{contact.email}</span>
                    </div>
                  ) : null}
                  {contact.address ? (
                    <div className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                      <MapPin size={15} className="shrink-0 mt-0.5 text-slate-400" />
                      <span className="text-xs">{contact.address}</span>
                    </div>
                  ) : null}
                  {contact.notes ? (
                    <div className="text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-700/60 pt-3">
                      <span className="font-bold text-slate-600 dark:text-slate-300">ملاحظات: </span>
                      {contact.notes}
                    </div>
                  ) : null}

                  <Link
                    to="/customers"
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-slate-200 text-sm font-black text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800/80 transition-colors"
                  >
                    تعديل البيانات من الدليل
                    <ExternalLink size={14} />
                  </Link>
                </div>
              </div>

              {/* شيكات مرتجعة — منظّمة */}
              <div className={`rounded-2xl border p-4 space-y-3 ${
                chequesList.filter(c => c.status !== 'resolved').length > 0
                  ? 'border-rose-300 bg-rose-50/40 dark:border-rose-700/50 dark:bg-rose-950/15'
                  : 'border-amber-200/80 bg-amber-50/50 dark:border-amber-800/40 dark:bg-amber-950/25'
              }`}>
                {/* Header */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle
                      className={`shrink-0 ${chequesList.filter(c => c.status !== 'resolved').length > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}
                      size={17}
                    />
                    <h2 className={`font-black text-sm ${chequesList.filter(c => c.status !== 'resolved').length > 0 ? 'text-rose-800 dark:text-rose-200' : 'text-amber-900 dark:text-amber-100'}`}>
                      شيكات مرتجعة
                    </h2>
                    {chequesList.length > 0 && (
                      <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[9px] font-black text-white ${
                        chequesList.filter(c => c.status !== 'resolved').length > 0 ? 'bg-rose-500' : 'bg-emerald-500'
                      }`}>
                        {chequesList.length}
                      </span>
                    )}
                  </div>
                  {!chequesAddingNew && (
                    <button
                      type="button"
                      onClick={openAddCheque}
                      className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1.5 text-[11px] font-black text-white hover:bg-rose-700 transition-colors dark:bg-rose-700 dark:hover:bg-rose-600"
                    >
                      <Plus size={12} />
                      إضافة شيك
                    </button>
                  )}
                </div>

                {/* List of existing cheques */}
                {chequesList.map((ch, idx) => (
                  <div
                    key={idx}
                    className={`rounded-xl border p-3 space-y-2 ${
                      ch.status === 'resolved'
                        ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-800/40 dark:bg-emerald-950/20 opacity-70'
                        : 'border-rose-200 bg-white dark:border-rose-800/40 dark:bg-rose-950/10'
                    }`}
                  >
                    {/* Card header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {ch.status === 'resolved' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-black dark:bg-emerald-950/50 dark:text-emerald-300">
                            <CheckCircle2 size={10} /> تم الحل
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 text-rose-700 px-2 py-0.5 text-[10px] font-black dark:bg-rose-950/50 dark:text-rose-300">
                            <XCircle size={10} /> مفتوح
                          </span>
                        )}
                        {ch.number && (
                          <span className="text-xs font-black text-slate-700 dark:text-slate-200">شيك #{ch.number}</span>
                        )}
                        {ch.amount && (
                          <span className="text-xs font-black text-rose-700 dark:text-rose-300 font-currency" dir="ltr">₪{ch.amount}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {ch.status !== 'resolved' && (
                          <button
                            type="button"
                            onClick={() => handleChequeResolve(idx)}
                            disabled={chequesSaving}
                            className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40 transition-colors"
                            title="تم الحل"
                          >
                            <CheckCircle2 size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEditCheque(idx)}
                          disabled={chequesSaving}
                          className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40 transition-colors"
                          title="تعديل"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleChequeDelete(idx)}
                          disabled={chequesSaving}
                          className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 transition-colors"
                          title="حذف"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Card details */}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      {ch.date && (
                        <div>
                          <span className="text-slate-400 dark:text-slate-500">تاريخ الشيك: </span>
                          <span className="font-bold text-slate-700 dark:text-slate-300" dir="ltr">{ch.date}</span>
                        </div>
                      )}
                      {ch.returnDate && (
                        <div>
                          <span className="text-slate-400 dark:text-slate-500">تاريخ الإرجاع: </span>
                          <span className="font-bold text-slate-700 dark:text-slate-300" dir="ltr">{ch.returnDate}</span>
                        </div>
                      )}
                      {ch.bank && (
                        <div className="col-span-2">
                          <span className="text-slate-400 dark:text-slate-500">البنك: </span>
                          <span className="font-bold text-slate-700 dark:text-slate-300">{ch.bank}</span>
                        </div>
                      )}
                      {ch.reason && (
                        <div className="col-span-2">
                          <span className="text-slate-400 dark:text-slate-500">السبب: </span>
                          <span className="font-bold text-slate-700 dark:text-slate-300">{ch.reason}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Add / Edit form */}
                {chequesAddingNew && (
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 space-y-3 dark:border-indigo-800/40 dark:bg-indigo-950/20">
                    <p className="text-xs font-black text-indigo-800 dark:text-indigo-200">
                      {chequesEditingIdx !== null ? 'تعديل الشيك' : 'إضافة شيك مرتجع جديد'}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 block mb-1">رقم الشيك</label>
                        <input
                          type="text"
                          value={chequesForm.number}
                          onChange={(e) => setChequesForm(p => ({ ...p, number: e.target.value }))}
                          placeholder="12345"
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-currency dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                          dir="ltr"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 block mb-1">المبلغ ₪</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={chequesForm.amount}
                          onChange={(e) => setChequesForm(p => ({ ...p, amount: e.target.value }))}
                          placeholder="0.00"
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-currency dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                          dir="ltr"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 block mb-1">تاريخ الشيك</label>
                        <input
                          type="date"
                          value={chequesForm.date}
                          onChange={(e) => setChequesForm(p => ({ ...p, date: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 block mb-1">تاريخ الإرجاع</label>
                        <input
                          type="date"
                          value={chequesForm.returnDate}
                          onChange={(e) => setChequesForm(p => ({ ...p, returnDate: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 block mb-1">البنك</label>
                        <input
                          type="text"
                          value={chequesForm.bank}
                          onChange={(e) => setChequesForm(p => ({ ...p, bank: e.target.value }))}
                          placeholder="اسم البنك"
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 block mb-1">سبب الإرجاع</label>
                        <input
                          type="text"
                          value={chequesForm.reason}
                          onChange={(e) => setChequesForm(p => ({ ...p, reason: e.target.value }))}
                          placeholder="رصيد غير كافٍ / توقيع غير مطابق…"
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                    </div>
                    {chequesError && (
                      <p className="text-[11px] font-bold text-rose-600 dark:text-rose-300">{chequesError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleChequeSave}
                        disabled={chequesSaving}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 text-white font-black text-xs py-2.5 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                      >
                        {chequesSaving ? <Loader2 className="animate-spin" size={13} /> : <Save size={13} />}
                        حفظ
                      </button>
                      <button
                        type="button"
                        onClick={() => { setChequesAddingNew(false); setChequesEditingIdx(null); setChequesForm(EMPTY_CHEQUE); }}
                        disabled={chequesSaving}
                        className="px-4 rounded-xl border border-slate-200 text-slate-600 font-black text-xs hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300"
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                )}

                {chequesList.length === 0 && !chequesAddingNew && (
                  <p className="text-xs text-amber-700/70 dark:text-amber-400/60 text-center py-1">
                    لا توجد شيكات مسجّلة — اضغط «إضافة شيك» لتسجيل أول شيك مرتجع
                  </p>
                )}
              </div>

              {/* إجراءات سريعة */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-gray-700/50 dark:bg-gray-900/50 space-y-1">
                <p className="text-[10px] font-black text-slate-400 px-1 mb-2">إجراءات سريعة</p>
                <Link
                  to="/pos"
                  className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-indigo-50/60 dark:text-slate-200 dark:hover:bg-white/5 transition-colors"
                >
                  <ShoppingCart size={17} className="text-indigo-500 shrink-0" />
                  فاتورة بيع — POS
                </Link>
                <Link
                  to="/vouchers"
                  className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-emerald-50/60 dark:text-slate-200 dark:hover:bg-white/5 transition-colors"
                >
                  <Wallet size={17} className="text-emerald-600 shrink-0" />
                  سندات القبض والصرف
                </Link>
              </div>
            </aside>

            {/* ===== MAIN CONTENT ===== */}
            <div className="lg:col-span-8 space-y-6">

              {/* Stats Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                  icon={TrendingUp}
                  label="إجمالي المشتريات"
                  value={`₪${formatMoney(stats.totalSpent)}`}
                  sub={`${stats.activeCount} فاتورة فعّالة`}
                  color="indigo"
                />
                <StatCard
                  icon={Receipt}
                  label="عدد الفواتير"
                  value={stats.invoiceCount.toLocaleString('en-US')}
                  sub={stats.returnedCount > 0 ? `${stats.returnedCount} مرتجع` : 'لا مرتجعات'}
                  color={stats.returnedCount > 0 ? 'rose' : 'emerald'}
                />
                <StatCard
                  icon={Clock}
                  label="آخر زيارة"
                  value={timeAgo(stats.lastPurchase) ?? '—'}
                  sub={stats.lastPurchase ? formatDateTime(stats.lastPurchase).split(',')[0] : undefined}
                  color="violet"
                />
                <StatCard
                  icon={BarChart2}
                  label="متوسط الفاتورة"
                  value={`₪${formatMoney(stats.avgInvoice)}`}
                  sub={stats.creditCount > 0 ? `${stats.creditCount} بالذمة` : 'كاش فقط'}
                  color="amber"
                />
              </div>

              {/* جدول المشتريات */}
              <section className="rounded-2xl border border-slate-200/80 bg-white shadow-[0_4px_32px_-8px_rgba(15,23,42,0.08)] overflow-hidden dark:border-gray-700/50 dark:bg-gray-900/70">
                <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-l from-indigo-50/40 to-white flex flex-wrap items-center justify-between gap-3 dark:border-slate-700/60 dark:from-indigo-950/40 dark:to-gray-900/90">
                  <div className="flex items-center gap-2">
                    <ShoppingCart size={20} className="text-indigo-500 shrink-0 dark:text-indigo-400" />
                    <h2 className="font-black text-slate-900 dark:text-white">مشتريات من المتجر</h2>
                  </div>
                  <span className="text-xs font-bold text-indigo-600 bg-indigo-50/80 px-3 py-1 rounded-xl border border-indigo-100 dark:text-indigo-300 dark:bg-indigo-950/50 dark:border-indigo-500/30">
                    {sales.length} فاتورة
                  </span>
                </div>

                {sales.length === 0 ? (
                  <div className="py-16 text-center">
                    <div className="inline-flex flex-col items-center gap-3 px-8 py-8 rounded-2xl bg-gradient-to-b from-slate-50/80 to-transparent dark:from-slate-800/40 dark:to-transparent">
                      <ShoppingCart className="text-slate-300 dark:text-slate-600" size={56} />
                      <p className="font-bold text-slate-600 dark:text-slate-300">لا توجد فواتير مرتبطة بعد</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">تأكد من اختيار الزبون من الدليل عند البيع بالـ POS</p>
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[520px]">
                      <thead>
                        <tr className="bg-gradient-to-r from-indigo-50/80 to-transparent text-slate-700 border-b border-slate-200/70 dark:from-indigo-950/40 dark:to-transparent dark:text-slate-200 dark:border-slate-700/60">
                          <th className="text-right py-3 px-4 font-semibold">
                            <span className="inline-flex items-center gap-1.5">
                              <Calendar size={12} className="text-indigo-400 dark:text-indigo-500" />
                              التاريخ
                            </span>
                          </th>
                          <th className="text-right py-3 px-4 font-semibold" dir="ltr">
                            <span className="inline-flex items-center gap-1.5">
                              <TrendingUp size={12} className="text-indigo-400 dark:text-indigo-500" />
                              المبلغ
                            </span>
                          </th>
                          <th className="text-right py-3 px-4 font-semibold">الدفع</th>
                          <th className="text-center py-3 px-4 font-semibold">الحالة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sales.map((s, idx) => (
                          <tr
                            key={s.id}
                            className={`border-b border-slate-100/70 transition-colors hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 dark:border-slate-700/40 ${
                              idx % 2 === 0
                                ? 'bg-white dark:bg-slate-900/50'
                                : 'bg-slate-50/40 dark:bg-slate-800/30'
                            }`}
                          >
                            <td className="py-3 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap text-xs" dir="ltr">
                              {formatDateTime(s.created_at)}
                            </td>
                            <td className="py-3 px-4 font-currency font-black text-indigo-700 dark:text-indigo-300 whitespace-nowrap" dir="ltr">
                              ₪ {formatMoney(s.total_amount)}
                            </td>
                            <td className="py-3 px-4 text-slate-600 dark:text-slate-300 text-xs">
                              <span className={`inline-block rounded-full border-l-[3px] px-2 py-0.5 font-bold ${
                                s.payment_mode === 'credit'
                                  ? 'bg-amber-50 text-amber-700 border-l-amber-500 dark:bg-amber-950/30 dark:text-amber-300 dark:border-l-amber-400'
                                  : 'bg-emerald-50 text-emerald-700 border-l-emerald-500 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-l-emerald-400'
                              }`}>
                                {paymentLabelArabic(s.payment_mode, s.notes)}
                              </span>
                              {s.pos_tender === 'check' && (
                                <span className="block text-amber-700 dark:text-amber-300 font-bold mt-0.5 text-[10px]">شيك</span>
                              )}
                              {s.pos_tender === 'visa' && (
                                <span className="block text-indigo-600 dark:text-indigo-300 font-bold mt-0.5 text-[10px]">دفع إلكتروني</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {s.returned_at ? (
                                <span className="inline-flex items-center gap-1 rounded-full border-l-[3px] border-l-slate-400 px-2 py-0.5 text-[11px] font-black bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:border-l-slate-500">
                                  <RotateCcw size={9} />
                                  مرتجع
                                </span>
                              ) : (
                                <span className="inline-block rounded-full border-l-[3px] border-l-emerald-500 px-2 py-0.5 text-[11px] font-black bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-l-emerald-400">
                                  فعّال
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Pre-orders */}
              {preOrders.length > 0 && (
                <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden dark:border-gray-700/50 dark:bg-gray-900/70">
                  <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-l from-violet-50/40 to-white flex items-center gap-2 dark:border-slate-700/60 dark:from-violet-950/30 dark:to-gray-900/90">
                    <Bookmark size={20} className="text-violet-500 shrink-0" />
                    <h2 className="font-black text-slate-900 dark:text-white">حجز مسبق</h2>
                    <span className="text-xs font-bold text-violet-600 bg-violet-50 px-2.5 py-0.5 rounded-xl border border-violet-100 mr-auto dark:text-violet-300 dark:bg-violet-950/40 dark:border-violet-500/30">
                      {preOrders.length}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gradient-to-r from-violet-50/60 to-transparent text-slate-700 border-b border-slate-200/70 dark:from-violet-950/30 dark:to-transparent dark:text-slate-200 dark:border-slate-700/60">
                          <th className="text-right py-3 px-4 font-semibold">رقم الطلب</th>
                          <th className="text-right py-3 px-4 font-semibold">الحالة</th>
                          <th className="text-right py-3 px-4 font-semibold" dir="ltr">المبلغ</th>
                          <th className="text-right py-3 px-4 font-semibold">التاريخ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preOrders.map((p, idx) => (
                          <tr
                            key={p.id}
                            className={`border-b border-slate-100/70 transition-colors hover:bg-violet-50/40 dark:hover:bg-violet-950/20 dark:border-slate-700/40 ${
                              idx % 2 === 0 ? 'bg-white dark:bg-slate-900/50' : 'bg-slate-50/40 dark:bg-slate-800/30'
                            }`}
                          >
                            <td className="py-3 px-4 font-mono text-xs text-slate-600 dark:text-slate-300" dir="ltr">
                              {p.order_no || p.id?.slice(0, 8)}
                            </td>
                            <td className="py-3 px-4 text-xs">
                              <span className="rounded-full bg-violet-50 text-violet-700 border-l-[3px] border-l-violet-500 px-2 py-0.5 font-bold dark:bg-violet-950/30 dark:text-violet-300 dark:border-l-violet-400">
                                {p.status || '—'}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-currency font-bold text-slate-800 dark:text-slate-200" dir="ltr">
                              ₪ {formatMoney(p.total_amount)}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-500 dark:text-slate-400">
                              {formatDateTime(p.created_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
