import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Banknote, Plus, CheckCircle2, AlertCircle, ArrowLeftRight } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';
import {
  CONTACTS_FALLBACK,
  syncIncomingCheckLedger,
  syncOutgoingCheckLedger,
} from '../utils/checkVoucherSync';
import { applyBouncedCheckAccounting } from '../utils/checkBounceAccounting';
import { useHtmlDarkClass } from '../lib/theme';

const CHECKS_TABLE = 'store_checks';
const ENDORSEMENTS_TABLE = 'check_endorsements';
const ILS = '\u20AA';

const STATUS_LABEL = {
  received: 'بحوزة المتجر (وارد)',
  endorsed: 'مُظهر لمورد',
  issued: 'مُصدر',
  delivered: 'مُسلّم للمورد',
  cleared: 'مُقاص',
  bounced: 'مرتجع',
  void: 'ملغى',
};

function parseMoney(v) {
  const n = parseFloat(normalizeDigitsToLatin(String(v ?? '')).replace(',', '.'));
  return Number.isNaN(n) ? 0 : Math.round(Math.max(0, n) * 100) / 100;
}

function formatMoney(n) {
  return parseMoney(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** YYYY-MM من تاريخ قاعدة البيانات */
function monthKeyFromRowDate(iso) {
  if (!iso) return null;
  const s = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}/.test(s)) return null;
  return s.slice(0, 7);
}

function rowMatchesMonthFilter(row, yyyymm, dateMode) {
  if (!yyyymm) return true;
  const key =
    dateMode === 'issue' ? monthKeyFromRowDate(row.issue_date) : monthKeyFromRowDate(row.due_date);
  return key === yyyymm;
}

function Toast({ message, variant = 'success', onDismiss }) {
  const bar =
    variant === 'success'
      ? 'border-emerald-500/40 bg-slate-950/95'
      : 'border-rose-500/40 bg-slate-950/95';
  return (
    <div
      className={`fixed bottom-6 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-2xl border px-5 py-3.5 shadow-2xl backdrop-blur-xl sm:left-auto sm:right-8 sm:translate-x-0 ${bar}`}
      role="status"
      dir="rtl"
    >
      {variant === 'success' ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
      ) : (
        <AlertCircle className="h-5 w-5 shrink-0 text-rose-400" aria-hidden />
      )}
      <p className="max-w-md text-sm font-bold text-white">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="mr-1 rounded-lg px-2 py-1 text-xs font-bold text-slate-400 hover:bg-white/10 hover:text-white"
      >
        إغلاق
      </button>
    </div>
  );
}

export default function ChecksPage() {
  const { store, loading: storeLoading } = useStore();
  const darkUi = useHtmlDarkClass();
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  /** صفحة منفصلة منطقياً: صادر (للموردين) | وارد (من الزبائن) */
  const [mainTab, setMainTab] = useState('outgoing');
  const [portfolioOnly, setPortfolioOnly] = useState(false);
  /** فلتر YYYY-MM أو فراغ = بدون */
  const [monthFilter, setMonthFilter] = useState('');
  /** للصادر: فلتر الشهر حسب تاريخ الاستحقاق أو الإصدار (متابعة الإيداع قبل نهاية الشهر) */
  const [outgoingMonthBy, setOutgoingMonthBy] = useState('due');
  /** صادر: عرض الشيكات التي لم تُقصّ بعد (issued / delivered) */
  const [outstandingDepositOnly, setOutstandingDepositOnly] = useState(false);
  const [toast, setToast] = useState(null);

  const [showIncoming, setShowIncoming] = useState(false);
  const [showOutgoing, setShowOutgoing] = useState(false);
  const [endorseCheck, setEndorseCheck] = useState(null);

  const [formSubmitting, setFormSubmitting] = useState(false);

  const freshIncomingForm = () => ({
    customerId: '',
    amount: '',
    check_number: '',
    bank_name: '',
    branch_name: '',
    issue_date: '',
    due_date: new Date().toISOString().slice(0, 10),
    notes: '',
    syncLedger: true,
  });
  const [incomingForm, setIncomingForm] = useState(() => freshIncomingForm());

  const [outgoingForm, setOutgoingForm] = useState({
    supplierId: '',
    amount: '',
    check_number: '',
    bank_name: '',
    branch_name: '',
    issue_date: '',
    due_date: new Date().toISOString().slice(0, 10),
    notes: '',
    syncLedger: true,
  });

  const [endorseForm, setEndorseForm] = useState({
    supplierId: '',
    notes: '',
    syncLedger: true,
  });
  const [bounceSubmittingId, setBounceSubmittingId] = useState(null);

  const fetchContacts = useCallback(async () => {
    if (!store?.id) {
      setCustomers([]);
      setSuppliers([]);
      return;
    }
    const [custRes, supRes] = await Promise.all([
      supabase
        .from(CONTACTS_FALLBACK)
        .select('id, name')
        .eq('store_id', store.id)
        .eq('role', 'customer')
        .order('name', { ascending: true }),
      supabase
        .from(CONTACTS_FALLBACK)
        .select('id, name')
        .eq('store_id', store.id)
        .eq('role', 'supplier')
        .order('name', { ascending: true }),
    ]);
    setCustomers(custRes.data || []);
    setSuppliers(supRes.data || []);
  }, [store?.id]);

  const fetchChecks = useCallback(async () => {
    if (!store?.id) {
      setChecks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from(CHECKS_TABLE)
      .select('*')
      .eq('store_id', store.id)
      .order('due_date', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[checks]', error);
      setChecks([]);
      setToast({
        message:
          error.message ||
          'تعذّر تحميل الشيكات. نفّذ ملف supabase/store_checks.sql في Supabase.',
        variant: 'error',
      });
    } else {
      setChecks(data || []);
    }
    setLoading(false);
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    void fetchContacts();
    void fetchChecks();
  }, [storeLoading, fetchContacts, fetchChecks]);

  const contactName = useCallback(
    (id) => {
      if (!id) return '—';
      const c = customers.find((x) => x.id === id) || suppliers.find((x) => x.id === id);
      return c?.name || id.slice(0, 8);
    },
    [customers, suppliers]
  );

  const filteredChecks = useMemo(() => {
    let rows = checks.filter((r) => r.direction === mainTab);
    if (mainTab === 'incoming' && portfolioOnly) {
      rows = rows.filter((r) => r.status === 'received');
    }
    if (monthFilter) {
      const mode = mainTab === 'outgoing' ? outgoingMonthBy : 'due';
      rows = rows.filter((r) => rowMatchesMonthFilter(r, monthFilter, mode));
    }
    if (mainTab === 'outgoing' && outstandingDepositOnly) {
      rows = rows.filter((r) => r.status === 'issued' || r.status === 'delivered');
    }
    return rows;
  }, [checks, mainTab, portfolioOnly, monthFilter, outgoingMonthBy, outstandingDepositOnly]);

  const listTotals = useMemo(() => {
    let sum = 0;
    for (const r of filteredChecks) sum += parseMoney(r.amount);
    return { count: filteredChecks.length, sum };
  }, [filteredChecks]);

  const setThisMonthFilter = useCallback(() => {
    setMonthFilter(new Date().toISOString().slice(0, 7));
  }, []);

  const submitIncoming = async (e) => {
    e.preventDefault();
    if (!store?.id) return;
    const amt = parseMoney(incomingForm.amount);
    if (amt <= 0) {
      setToast({ message: 'أدخل مبلغاً صحيحاً.', variant: 'error' });
      return;
    }
    if (!incomingForm.customerId) {
      setToast({ message: 'اختر الزبون.', variant: 'error' });
      return;
    }
    if (!String(incomingForm.check_number || '').trim() || !String(incomingForm.bank_name || '').trim()) {
      setToast({ message: 'رقم الشيك واسم البنك مطلوبان.', variant: 'error' });
      return;
    }
    const due = String(incomingForm.due_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      setToast({ message: 'تاريخ استحقاق غير صالح.', variant: 'error' });
      return;
    }

    setFormSubmitting(true);
    const issue = String(incomingForm.issue_date || '').trim();
    const row = {
      store_id: store.id,
      direction: 'incoming',
      status: 'received',
      check_number: String(incomingForm.check_number).trim(),
      bank_name: String(incomingForm.bank_name).trim(),
      branch_name: String(incomingForm.branch_name || '').trim(),
      issue_date: /^\d{4}-\d{2}-\d{2}$/.test(issue) ? issue : null,
      due_date: due,
      amount: amt,
      customer_contact_id: incomingForm.customerId,
      payee_supplier_contact_id: null,
      notes: String(incomingForm.notes || '').trim(),
      updated_at: new Date().toISOString(),
    };

    const { data: inserted, error: insErr } = await supabase.from(CHECKS_TABLE).insert([row]).select('id').single();
    if (insErr) {
      setFormSubmitting(false);
      setToast({ message: insErr.message || 'فشل الحفظ', variant: 'error' });
      return;
    }

    let voucherId = null;
    let extra = '';
    if (incomingForm.syncLedger) {
      const desc =
        (incomingForm.notes || '').trim() ||
        `شيك وارد — رقم ${row.check_number} — ${row.bank_name}`;
      const sync = await syncIncomingCheckLedger({
        storeId: store.id,
        customerContactId: incomingForm.customerId,
        amount: amt,
        date: due,
        description: desc,
        checkMeta: {
          check_number: row.check_number,
          check_date: due,
          due_date: due,
          bank_name: row.bank_name,
        },
      });
      if (!sync.ok) {
        extra = ` — تحذير: الشيك حُفظ لكن السند فشل: ${sync.error?.message || ''}`;
      } else {
        voucherId = sync.voucherId;
        if (sync.balance?.ok && sync.balance.prev != null) {
          extra = ` — ذمة الزبون: ${formatMoney(sync.balance.prev)} ← ${formatMoney(sync.balance.next)}`;
        }
        if (sync.tenderSaved === false) {
          extra +=
            ' — نفّذ vouchers_tender_cheques.sql إن لم تظهر تفاصيل الشيك في السند.';
        }
      }
    }

    if (voucherId) {
      await supabase
        .from(CHECKS_TABLE)
        .update({ receipt_voucher_id: voucherId, updated_at: new Date().toISOString() })
        .eq('id', inserted.id);
    }

    setFormSubmitting(false);
    setShowIncoming(false);
    setIncomingForm(freshIncomingForm());
    await fetchChecks();
    setToast({
      message: 'تم تسجيل الشيك الوارد.' + extra,
      variant: extra.includes('فشل') || extra.includes('تحذير') ? 'error' : 'success',
    });
  };

  const submitOutgoing = async (e) => {
    e.preventDefault();
    if (!store?.id) return;
    const amt = parseMoney(outgoingForm.amount);
    if (amt <= 0) {
      setToast({ message: 'أدخل مبلغاً صحيحاً.', variant: 'error' });
      return;
    }
    if (!outgoingForm.supplierId) {
      setToast({ message: 'اختر المورد.', variant: 'error' });
      return;
    }
    if (!String(outgoingForm.check_number || '').trim() || !String(outgoingForm.bank_name || '').trim()) {
      setToast({ message: 'رقم الشيك واسم البنك مطلوبان.', variant: 'error' });
      return;
    }
    const due = String(outgoingForm.due_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      setToast({ message: 'تاريخ استحقاق غير صالح.', variant: 'error' });
      return;
    }

    setFormSubmitting(true);
    const issue = String(outgoingForm.issue_date || '').trim();
    const row = {
      store_id: store.id,
      direction: 'outgoing',
      status: 'issued',
      check_number: String(outgoingForm.check_number).trim(),
      bank_name: String(outgoingForm.bank_name).trim(),
      branch_name: String(outgoingForm.branch_name || '').trim(),
      issue_date: /^\d{4}-\d{2}-\d{2}$/.test(issue) ? issue : null,
      due_date: due,
      amount: amt,
      customer_contact_id: null,
      payee_supplier_contact_id: outgoingForm.supplierId,
      notes: String(outgoingForm.notes || '').trim(),
      updated_at: new Date().toISOString(),
    };

    const { data: inserted, error: insErr } = await supabase.from(CHECKS_TABLE).insert([row]).select('id').single();
    if (insErr) {
      setFormSubmitting(false);
      setToast({ message: insErr.message || 'فشل الحفظ', variant: 'error' });
      return;
    }

    let voucherId = null;
    let extra = '';
    if (outgoingForm.syncLedger) {
      const desc =
        (outgoingForm.notes || '').trim() ||
        `شيك صادر — رقم ${row.check_number} — ${row.bank_name}`;
      const sync = await syncOutgoingCheckLedger({
        storeId: store.id,
        supplierContactId: outgoingForm.supplierId,
        amount: amt,
        date: due,
        description: desc,
        checkMeta: {
          check_number: row.check_number,
          check_date: due,
          due_date: due,
          bank_name: row.bank_name,
        },
      });
      if (!sync.ok) {
        extra = ` — تحذير: الشيك حُفظ لكن السند فشل: ${sync.error?.message || ''}`;
      } else {
        voucherId = sync.voucherId;
        if (sync.paymentSyncWarning) extra += ` — ${sync.paymentSyncWarning}`;
        if (sync.tenderSaved === false) {
          extra +=
            ' — نفّذ vouchers_tender_cheques.sql إن لم تظهر تفاصيل الشيك في السند.';
        }
      }
    }

    if (voucherId) {
      await supabase
        .from(CHECKS_TABLE)
        .update({ payment_voucher_id: voucherId, updated_at: new Date().toISOString() })
        .eq('id', inserted.id);
    }

    setFormSubmitting(false);
    setShowOutgoing(false);
    setOutgoingForm({
      supplierId: '',
      amount: '',
      check_number: '',
      bank_name: '',
      branch_name: '',
      issue_date: '',
      due_date: new Date().toISOString().slice(0, 10),
      notes: '',
      syncLedger: true,
    });
    await fetchChecks();
    setToast({
      message: 'تم تسجيل الشيك الصادر.' + extra,
      variant: extra.includes('فشل') ? 'error' : 'success',
    });
  };

  const updateCheckStatus = async (checkRow, status) => {
    if (!store?.id) return;

    if (status === 'bounced') {
      setBounceSubmittingId(checkRow.id);
      try {
        const acct = await applyBouncedCheckAccounting({ storeId: store.id, checkId: checkRow.id });
        if (!acct.ok) {
          setToast({
            message:
              acct.error?.message ||
              'فشل عكس القيود. نفّذ store_checks_bounce_reversal.sql إن كان العمود ناقصاً.',
            variant: 'error',
          });
          return;
        }
        let msg = 'تم تسجيل المرتجع.';
        if (acct.notes?.length) msg += ` — ${acct.notes.join('، ')}`;
        else if (acct.hadAccounting) msg += ' — لا عكس إضافي (مُنفَّذ مسبقاً أو غير مطلوب).';
        else msg += ' — لا سندات مربوطة بالشيك؛ حُدّثت الحالة فقط (ذمم بدون تغيير).';

        const { error } = await supabase
          .from(CHECKS_TABLE)
          .update({ status: 'bounced', updated_at: new Date().toISOString() })
          .eq('id', checkRow.id)
          .eq('store_id', store.id);
        if (error) {
          setToast({ message: error.message, variant: 'error' });
          return;
        }
        await fetchChecks();
        setToast({ message: msg, variant: 'success' });
      } finally {
        setBounceSubmittingId(null);
      }
      return;
    }

    const { error } = await supabase
      .from(CHECKS_TABLE)
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', checkRow.id)
      .eq('store_id', store.id);
    if (error) setToast({ message: error.message, variant: 'error' });
    else {
      await fetchChecks();
      setToast({ message: 'تم تحديث حالة الشيك.', variant: 'success' });
    }
  };

  const submitEndorse = async (e) => {
    e.preventDefault();
    if (!endorseCheck || !store?.id) return;
    if (!endorseForm.supplierId) {
      setToast({ message: 'اختر المورد المستفيد.', variant: 'error' });
      return;
    }
    setFormSubmitting(true);
    const amt = Number(endorseCheck.amount);
    const due = String(endorseCheck.due_date || '').slice(0, 10);

    const { data: endIns, error: enErr } = await supabase
      .from(ENDORSEMENTS_TABLE)
      .insert([
        {
          check_id: endorseCheck.id,
          to_supplier_contact_id: endorseForm.supplierId,
          notes: String(endorseForm.notes || '').trim(),
        },
      ])
      .select('id')
      .single();
    if (enErr) {
      setFormSubmitting(false);
      setToast({ message: enErr.message, variant: 'error' });
      return;
    }

    let paymentVoucherId = null;
    let extra = '';
    if (endorseForm.syncLedger) {
      const desc =
        (endorseForm.notes || '').trim() ||
        `تظهير شيك وارد رقم ${endorseCheck.check_number} للمورد`;
      const sync = await syncOutgoingCheckLedger({
        storeId: store.id,
        supplierContactId: endorseForm.supplierId,
        amount: amt,
        date: due,
        description: desc,
        checkMeta: {
          check_number: endorseCheck.check_number,
          check_date: due,
          due_date: due,
          bank_name: endorseCheck.bank_name,
        },
      });
      if (!sync.ok) {
        extra = ` — تحذير: التظهير حُفظ لكن السند فشل: ${sync.error?.message || ''}`;
      } else {
        paymentVoucherId = sync.voucherId;
        if (sync.paymentSyncWarning) extra += ` — ${sync.paymentSyncWarning}`;
      }
    }

    const { error: upErr } = await supabase
      .from(CHECKS_TABLE)
      .update({
        status: 'endorsed',
        payee_supplier_contact_id: endorseForm.supplierId,
        payment_voucher_id: paymentVoucherId || endorseCheck.payment_voucher_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', endorseCheck.id);

    if (paymentVoucherId && endIns?.id) {
      await supabase
        .from(ENDORSEMENTS_TABLE)
        .update({ payment_voucher_id: paymentVoucherId })
        .eq('id', endIns.id);
    }

    setFormSubmitting(false);
    setEndorseCheck(null);
    setEndorseForm({ supplierId: '', notes: '', syncLedger: true });
    await fetchChecks();
    if (upErr) setToast({ message: upErr.message, variant: 'error' });
    else
      setToast({
        message: 'تم تظهير الشيك للمورد.' + extra,
        variant: extra.includes('فشل') ? 'error' : 'success',
      });
  };

  const shell = darkUi ? 'dark' : '';
  const card = darkUi
    ? 'border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950'
    : 'border-slate-200 bg-gradient-to-br from-slate-50 via-white to-indigo-50/80';
  const inner = darkUi
    ? 'border-white/15 bg-white/5 shadow-inner shadow-white/5'
    : 'border-white/60 bg-white/40 shadow-lg';
  const label = darkUi ? 'text-slate-300' : 'text-slate-600';
  const input = darkUi
    ? 'border-white/15 bg-slate-900/80 text-white placeholder:text-slate-500'
    : 'border-slate-200 bg-white text-slate-900';

  const modalWrap = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm';

  return (
    <DashboardLayout>
      <div className={`${shell} font-arabic`} dir="rtl">
        {toast && <Toast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />}

        <div
          className={`relative overflow-hidden rounded-3xl border p-6 sm:p-8 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.45)] ${card}`}
        >
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.25),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(14,165,233,0.12),transparent_50%)]"
            aria-hidden
          />

          <div className={`relative rounded-2xl border p-6 backdrop-blur-2xl ${inner}`}>
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                    darkUi ? 'bg-indigo-500/20 text-indigo-300' : 'bg-indigo-100 text-indigo-600'
                  }`}
                >
                  <Banknote size={24} />
                </div>
                <div>
                  <h1 className={`text-xl font-black tracking-tight sm:text-2xl ${darkUi ? 'text-white' : 'text-slate-900'}`}>
                    الشيكات
                  </h1>
                  <p className={`mt-1 text-sm ${label}`}>
                    كشف منفصل للصادر (للموردين) والواردة (من الزبائن) — متابعة الإصدار، الاستحقاق، الإيداع، والتظهير.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowIncoming(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-500"
                >
                  <Plus size={18} />
                  شيك وارد
                </button>
                <button
                  type="button"
                  onClick={() => setShowOutgoing(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-500"
                >
                  <Plus size={18} />
                  شيك صادر
                </button>
              </div>
            </div>

            {!store?.id && !storeLoading && (
              <p className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-200">
                لا يوجد متجر لهذا الحساب.
              </p>
            )}

            <div
              className={`mb-4 flex flex-wrap gap-2 border-b pb-3 ${darkUi ? 'border-white/10' : 'border-slate-200'}`}
            >
              <button
                type="button"
                onClick={() => {
                  setMainTab('outgoing');
                  setPortfolioOnly(false);
                }}
                className={`rounded-xl px-4 py-2.5 text-sm font-black transition ${
                  mainTab === 'outgoing'
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/30'
                    : darkUi
                      ? 'bg-white/10 text-slate-300 hover:bg-white/15'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                الشيكات الصادرة (للموردين)
              </button>
              <button
                type="button"
                onClick={() => {
                  setMainTab('incoming');
                  setOutstandingDepositOnly(false);
                  setOutgoingMonthBy('due');
                }}
                className={`rounded-xl px-4 py-2.5 text-sm font-black transition ${
                  mainTab === 'incoming'
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30'
                    : darkUi
                      ? 'bg-white/10 text-slate-300 hover:bg-white/15'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                الشيكات الواردة (من الزبائن)
              </button>
            </div>

            {mainTab === 'outgoing' && (
              <p className={`mb-3 text-xs font-bold leading-relaxed ${label}`}>
                هنا كل ما أصدرته للمورد: تاريخ الإصدار والاستحقاق، والمبلغ. استخدم فلتر الشهر قبل نهاية الشهر لمطابقة
                ما يجب تغطيته في البنك، و«مقاص» عند التسوية.
              </p>
            )}
            {mainTab === 'incoming' && (
              <p className={`mb-3 text-xs font-bold leading-relaxed ${label}`}>
                شيكات الزبائن: تاريخ الاستحقاق، هل بقيت بحوزتك أم تم تظهيرها لمورد، ثم حالة المتابعة.
              </p>
            )}

            <div className={`mb-4 flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:flex-wrap sm:items-end ${darkUi ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-slate-50/80'}`}>
              <div>
                <span className={`mb-1 block text-[10px] font-bold uppercase tracking-wide ${label}`}>شهر (فلتر)</span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="month"
                    value={monthFilter}
                    onChange={(e) => setMonthFilter(e.target.value)}
                    className={`rounded-lg border px-2 py-1.5 text-sm ${darkUi ? 'border-white/15 bg-slate-900 text-white' : 'border-slate-200 bg-white'}`}
                  />
                  <button
                    type="button"
                    onClick={setThisMonthFilter}
                    className={`rounded-lg px-2 py-1.5 text-xs font-bold ${darkUi ? 'bg-white/15 text-white hover:bg-white/20' : 'bg-slate-200 text-slate-800'}`}
                  >
                    هذا الشهر
                  </button>
                  <button
                    type="button"
                    onClick={() => setMonthFilter('')}
                    className={`rounded-lg px-2 py-1.5 text-xs font-bold ${darkUi ? 'text-slate-400 hover:text-white' : 'text-slate-600'}`}
                  >
                    الكل
                  </button>
                </div>
              </div>
              {mainTab === 'outgoing' && (
                <>
                  <div>
                    <span className={`mb-1 block text-[10px] font-bold ${label}`}>الشهر يطابق</span>
                    <div className="flex gap-1">
                      {[
                        { v: 'due', t: 'تاريخ الاستحقاق' },
                        { v: 'issue', t: 'تاريخ الإصدار' },
                      ].map((x) => (
                        <button
                          key={x.v}
                          type="button"
                          onClick={() => setOutgoingMonthBy(x.v)}
                          className={`rounded-lg px-2 py-1.5 text-xs font-bold ${
                            outgoingMonthBy === x.v
                              ? 'bg-indigo-500 text-white'
                              : darkUi
                                ? 'bg-white/10 text-slate-300'
                                : 'bg-white text-slate-700 ring-1 ring-slate-200'
                          }`}
                        >
                          {x.t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className={`flex cursor-pointer items-center gap-2 text-xs font-bold ${label}`}>
                    <input
                      type="checkbox"
                      checked={outstandingDepositOnly}
                      onChange={(e) => setOutstandingDepositOnly(e.target.checked)}
                      className="rounded border-slate-400"
                    />
                    بانتظار المقاص / متابعة الإيداع فقط
                  </label>
                </>
              )}
              {mainTab === 'incoming' && (
                <label className={`flex cursor-pointer items-center gap-2 text-xs font-bold ${label}`}>
                  <input
                    type="checkbox"
                    checked={portfolioOnly}
                    onChange={(e) => setPortfolioOnly(e.target.checked)}
                    className="rounded border-slate-400"
                  />
                  المحفظة: وارد بحوزتي فقط (لم يُظهر)
                </label>
              )}
            </div>

            {!loading && filteredChecks.length > 0 && (
              <div
                className={`mb-3 flex flex-wrap gap-4 rounded-xl border px-4 py-2 text-sm font-bold ${darkUi ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}
              >
                <span>
                  العدد: {listTotals.count}
                </span>
                <span>
                  المجموع: {ILS}
                  {formatMoney(listTotals.sum)}
                </span>
              </div>
            )}

            {loading ? (
              <div className={`flex items-center justify-center gap-2 py-16 ${label}`}>
                <Loader2 className="h-6 w-6 animate-spin" />
                جاري التحميل...
              </div>
            ) : filteredChecks.length === 0 ? (
              <p className={`py-12 text-center text-sm font-bold ${label}`}>
                {mainTab === 'outgoing' ? 'لا توجد شيكات صادرة مطابقة.' : 'لا توجد شيكات واردة مطابقة.'}
              </p>
            ) : mainTab === 'outgoing' ? (
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[880px] text-right text-sm">
                  <thead>
                    <tr className={darkUi ? 'bg-white/5 text-slate-400' : 'bg-slate-100 text-slate-600'}>
                      <th className="px-3 py-2 font-bold">المورد</th>
                      <th className="px-3 py-2 font-bold">رقم الشيك</th>
                      <th className="px-3 py-2 font-bold">البنك</th>
                      <th className="px-3 py-2 font-bold">الفرع</th>
                      <th className="px-3 py-2 font-bold">تاريخ الإصدار</th>
                      <th className="px-3 py-2 font-bold">الاستحقاق</th>
                      <th className="px-3 py-2 font-bold">المبلغ</th>
                      <th className="px-3 py-2 font-bold">الحالة</th>
                      <th className="px-3 py-2 font-bold">متابعة إيداع</th>
                      <th className="px-3 py-2 font-bold">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredChecks.map((r) => (
                      <tr
                        key={r.id}
                        className={`border-t border-white/10 ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}
                      >
                        <td className="px-3 py-2 text-xs font-bold">{contactName(r.payee_supplier_contact_id)}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.check_number}</td>
                        <td className="px-3 py-2 text-xs">{r.bank_name}</td>
                        <td className="px-3 py-2 text-xs">{r.branch_name || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.issue_date || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.due_date}</td>
                        <td className="px-3 py-2 font-mono font-bold">
                          {ILS}
                          {formatMoney(r.amount)}
                        </td>
                        <td className="px-3 py-2 text-xs font-bold">{STATUS_LABEL[r.status] || r.status}</td>
                        <td className="max-w-[140px] px-3 py-2 text-[11px] font-bold leading-snug">
                          {r.status === 'cleared' && (
                            <span className="text-emerald-400">مُقاص — تسوية</span>
                          )}
                          {(r.status === 'issued' || r.status === 'delivered') && (
                            <span className="text-amber-300">راجع رصيد الحساب / الإيداع</span>
                          )}
                          {r.status === 'bounced' && <span className="text-rose-300">مرتجع</span>}
                          {r.status === 'void' && <span className="text-slate-500">ملغى</span>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {r.status === 'issued' && (
                              <button
                                type="button"
                                onClick={() => updateCheckStatus(r, 'delivered')}
                                className="rounded-lg bg-sky-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-sky-500"
                              >
                                تسليم
                              </button>
                            )}
                            {!['cleared', 'bounced', 'void'].includes(r.status) && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => updateCheckStatus(r, 'cleared')}
                                  className="rounded-lg bg-emerald-800/80 px-2 py-1 text-[11px] font-bold text-white"
                                >
                                  مقاص
                                </button>
                                <button
                                  type="button"
                                  disabled={bounceSubmittingId === r.id}
                                  onClick={() => updateCheckStatus(r, 'bounced')}
                                  className="rounded-lg bg-rose-700/90 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                                >
                                  {bounceSubmittingId === r.id ? '...' : 'مرتجع'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateCheckStatus(r, 'void')}
                                  className="rounded-lg bg-slate-600 px-2 py-1 text-[11px] font-bold text-white"
                                >
                                  إلغاء
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[920px] text-right text-sm">
                  <thead>
                    <tr className={darkUi ? 'bg-white/5 text-slate-400' : 'bg-slate-100 text-slate-600'}>
                      <th className="px-3 py-2 font-bold">الزبون</th>
                      <th className="px-3 py-2 font-bold">تظهير / تجيير</th>
                      <th className="px-3 py-2 font-bold">المورد المستفيد</th>
                      <th className="px-3 py-2 font-bold">رقم الشيك</th>
                      <th className="px-3 py-2 font-bold">البنك</th>
                      <th className="px-3 py-2 font-bold">تاريخ الإصدار</th>
                      <th className="px-3 py-2 font-bold">الاستحقاق</th>
                      <th className="px-3 py-2 font-bold">المبلغ</th>
                      <th className="px-3 py-2 font-bold">الحالة</th>
                      <th className="px-3 py-2 font-bold">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredChecks.map((r) => {
                      const endorsed =
                        r.status === 'endorsed' || Boolean(r.payee_supplier_contact_id);
                      return (
                        <tr
                          key={r.id}
                          className={`border-t border-white/10 ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}
                        >
                          <td className="px-3 py-2 text-xs font-bold">{contactName(r.customer_contact_id)}</td>
                          <td className="px-3 py-2 text-[11px] font-bold">
                            {endorsed ? (
                              <span className="text-indigo-300">نعم — مُظهر</span>
                            ) : (
                              <span className="text-slate-400">لا — بحوزة المتجر</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {endorsed ? contactName(r.payee_supplier_contact_id) : '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{r.check_number}</td>
                          <td className="px-3 py-2 text-xs">{r.bank_name}</td>
                          <td className="px-3 py-2 font-mono text-xs">{r.issue_date || '—'}</td>
                          <td className="px-3 py-2 font-mono text-xs">{r.due_date}</td>
                          <td className="px-3 py-2 font-mono font-bold">
                            {ILS}
                            {formatMoney(r.amount)}
                          </td>
                          <td className="px-3 py-2 text-xs font-bold">{STATUS_LABEL[r.status] || r.status}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {r.status === 'received' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEndorseCheck(r);
                                    setEndorseForm({ supplierId: '', notes: '', syncLedger: true });
                                  }}
                                  className="rounded-lg bg-amber-500/90 px-2 py-1 text-[11px] font-bold text-white hover:bg-amber-400"
                                >
                                  تظهير
                                </button>
                              )}
                              {!['cleared', 'bounced', 'void'].includes(r.status) && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => updateCheckStatus(r, 'cleared')}
                                    className="rounded-lg bg-emerald-800/80 px-2 py-1 text-[11px] font-bold text-white"
                                  >
                                    مقاص
                                  </button>
                                  <button
                                    type="button"
                                    disabled={bounceSubmittingId === r.id}
                                    onClick={() => updateCheckStatus(r, 'bounced')}
                                    className="rounded-lg bg-rose-700/90 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                                  >
                                    {bounceSubmittingId === r.id ? '...' : 'مرتجع'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => updateCheckStatus(r, 'void')}
                                    className="rounded-lg bg-slate-600 px-2 py-1 text-[11px] font-bold text-white"
                                  >
                                    إلغاء
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <p className={`mt-4 text-[11px] leading-relaxed ${label}`}>
              للتفعيل الأول: نفّذ في Supabase الملف{' '}
              <code className="rounded bg-black/20 px-1">swiftm/supabase/store_checks.sql</code>.
              لربط تفاصيل الشيك في جدول السندات نفّذ أيضاً{' '}
              <code className="rounded bg-black/20 px-1">vouchers_tender_cheques.sql</code>. لعكس القيود عند المرتجع نفّذ{' '}
              <code className="rounded bg-black/20 px-1">store_checks_bounce_reversal.sql</code>.
            </p>
          </div>
        </div>

        {showIncoming && (
          <div className={modalWrap} role="dialog" aria-modal>
            <form
              onSubmit={submitIncoming}
              className={`max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border p-6 shadow-2xl ${inner}`}
            >
              <h2 className={`mb-4 text-lg font-black ${darkUi ? 'text-white' : 'text-slate-900'}`}>شيك وارد من زبون</h2>
              <div className="space-y-3">
                <div>
                  <label className={`mb-1 block text-xs font-bold ${label}`}>الزبون</label>
                  <select
                    required
                    value={incomingForm.customerId}
                    onChange={(e) => setIncomingForm((p) => ({ ...p, customerId: e.target.value }))}
                    className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                  >
                    <option value="">— اختر —</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`mb-1 block text-xs font-bold ${label}`}>المبلغ ({ILS})</label>
                  <input
                    value={incomingForm.amount}
                    onChange={(e) => setIncomingForm((p) => ({ ...p, amount: e.target.value }))}
                    className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                    inputMode="decimal"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={`mb-1 block text-xs font-bold ${label}`}>رقم الشيك</label>
                    <input
                      value={incomingForm.check_number}
                      onChange={(e) => setIncomingForm((p) => ({ ...p, check_number: e.target.value }))}
                      className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                    />
                  </div>
                  <div>
                    <label className={`mb-1 block text-xs font-bold ${label}`}>البنك</label>
                    <input
                      value={incomingForm.bank_name}
                      onChange={(e) => setIncomingForm((p) => ({ ...p, bank_name: e.target.value }))}
                      className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                    />
                  </div>
                </div>
                <div>
                  <label className={`mb-1 block text-xs font-bold ${label}`}>فرع (اختياري)</label>
                  <input
                    value={incomingForm.branch_name}
                    onChange={(e) => setIncomingForm((p) => ({ ...p, branch_name: e.target.value }))}
                    className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={`mb-1 block text-xs font-bold ${label}`}>تاريخ الإصدار</label>
                    <input
                      type="date"
                      value={incomingForm.issue_date}
                      onChange={(e) => setIncomingForm((p) => ({ ...p, issue_date: e.target.value }))}
                      className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                    />
                  </div>
                  <div>
                    <label className={`mb-1 block text-xs font-bold ${label}`}>تاريخ الاستحقاق</label>
                    <input
                      type="date"
                      value={incomingForm.due_date}
                      onChange={(e) => setIncomingForm((p) => ({ ...p, due_date: e.target.value }))}
                      className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                    />
                  </div>
                </div>
                <div>
                  <label className={`mb-1 block text-xs font-bold ${label}`}>ملاحظات</label>
                  <textarea
                    value={incomingForm.notes}
                    onChange={(e) => setIncomingForm((p) => ({ ...p, notes: e.target.value }))}
                    rows={2}
                    className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                  />
                </div>
                <label className={`flex cursor-pointer items-center gap-2 text-xs font-bold ${label}`}>
                  <input
                    type="checkbox"
                    checked={incomingForm.syncLedger}
                    onChange={(e) => setIncomingForm((p) => ({ ...p, syncLedger: e.target.checked }))}
                  />
                  سند قبض + تحديث ذمة الزبون ودفتر الذمم
                </label>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowIncoming(false)}
                  className="rounded-xl border border-white/20 px-4 py-2 text-sm font-bold text-slate-300"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {formSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  حفظ
                </button>
              </div>
            </form>
          </div>
        )}

        {showOutgoing && (
          <div className={modalWrap} role="dialog" aria-modal>
            <form
              onSubmit={submitOutgoing}
              className={`max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border p-6 shadow-2xl ${inner}`}
            >
              <h2 className={`mb-4 text-lg font-black ${darkUi ? 'text-white' : 'text-slate-900'}`}>شيك صادر لمورد</h2>
              <div className="space-y-3">
                <div>
                  <label className={`mb-1 block text-xs font-bold ${label}`}>المورد</label>
                  <select
                    required
                    value={outgoingForm.supplierId}
                    onChange={(e) => setOutgoingForm((p) => ({ ...p, supplierId: e.target.value }))}
                    className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                  >
                    <option value="">— اختر —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`mb-1 block text-xs font-bold ${label}`}>المبلغ ({ILS})</label>
                  <input
                    value={outgoingForm.amount}
                    onChange={(e) => setOutgoingForm((p) => ({ ...p, amount: e.target.value }))}
                    className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                    inputMode="decimal"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={`mb-1 block text-xs font-bold ${label}`}>رقم الشيك</label>
                    <input
                      value={outgoingForm.check_number}
                      onChange={(e) => setOutgoingForm((p) => ({ ...p, check_number: e.target.value }))}
                      className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                    />
                  </div>
                  <div>
                    <label className={`mb-1 block text-xs font-bold ${label}`}>البنك</label>
                    <input
                      value={outgoingForm.bank_name}
                      onChange={(e) => setOutgoingForm((p) => ({ ...p, bank_name: e.target.value }))}
                      className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                    />
                  </div>
                </div>
                <div>
                  <label className={`mb-1 block text-xs font-bold ${label}`}>فرع (اختياري)</label>
                  <input
                    value={outgoingForm.branch_name}
                    onChange={(e) => setOutgoingForm((p) => ({ ...p, branch_name: e.target.value }))}
                    className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={`mb-1 block text-xs font-bold ${label}`}>تاريخ الإصدار</label>
                    <input
                      type="date"
                      value={outgoingForm.issue_date}
                      onChange={(e) => setOutgoingForm((p) => ({ ...p, issue_date: e.target.value }))}
                      className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                    />
                  </div>
                  <div>
                    <label className={`mb-1 block text-xs font-bold ${label}`}>تاريخ الاستحقاق</label>
                    <input
                      type="date"
                      value={outgoingForm.due_date}
                      onChange={(e) => setOutgoingForm((p) => ({ ...p, due_date: e.target.value }))}
                      className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                    />
                  </div>
                </div>
                <div>
                  <label className={`mb-1 block text-xs font-bold ${label}`}>ملاحظات</label>
                  <textarea
                    value={outgoingForm.notes}
                    onChange={(e) => setOutgoingForm((p) => ({ ...p, notes: e.target.value }))}
                    rows={2}
                    className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                  />
                </div>
                <label className={`flex cursor-pointer items-center gap-2 text-xs font-bold ${label}`}>
                  <input
                    type="checkbox"
                    checked={outgoingForm.syncLedger}
                    onChange={(e) => setOutgoingForm((p) => ({ ...p, syncLedger: e.target.checked }))}
                  />
                  سند صرف + دفعة المورد + تحديث ذمة المورد
                </label>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowOutgoing(false)}
                  className="rounded-xl border border-white/20 px-4 py-2 text-sm font-bold text-slate-300"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {formSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  حفظ
                </button>
              </div>
            </form>
          </div>
        )}

        {endorseCheck && (
          <div className={modalWrap} role="dialog" aria-modal>
            <form
              onSubmit={submitEndorse}
              className={`max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border p-6 shadow-2xl ${inner}`}
            >
              <div className="mb-4 flex items-start gap-2">
                <ArrowLeftRight className="mt-0.5 h-5 w-5 text-amber-400" />
                <div>
                  <h2 className={`text-lg font-black ${darkUi ? 'text-white' : 'text-slate-900'}`}>تظهير شيك لمورد</h2>
                  <p className={`mt-1 text-xs ${label}`}>
                    شيك رقم {endorseCheck.check_number} — {ILS}
                    {formatMoney(endorseCheck.amount)} — استحقاق{' '}
                    {endorseCheck.due_date}
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className={`mb-1 block text-xs font-bold ${label}`}>المورد المستفيد</label>
                  <select
                    required
                    value={endorseForm.supplierId}
                    onChange={(e) => setEndorseForm((p) => ({ ...p, supplierId: e.target.value }))}
                    className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                  >
                    <option value="">— اختر —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`mb-1 block text-xs font-bold ${label}`}>ملاحظات</label>
                  <textarea
                    value={endorseForm.notes}
                    onChange={(e) => setEndorseForm((p) => ({ ...p, notes: e.target.value }))}
                    rows={2}
                    className={`w-full rounded-xl border px-3 py-2 text-sm ${input}`}
                  />
                </div>
                <label className={`flex cursor-pointer items-center gap-2 text-xs font-bold ${label}`}>
                  <input
                    type="checkbox"
                    checked={endorseForm.syncLedger}
                    onChange={(e) => setEndorseForm((p) => ({ ...p, syncLedger: e.target.checked }))}
                  />
                  سند صرف للمورد + تحديث الذمة
                </label>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEndorseCheck(null)}
                  className="rounded-xl border border-white/20 px-4 py-2 text-sm font-bold text-slate-300"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {formSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  تأكيد التظهير
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
