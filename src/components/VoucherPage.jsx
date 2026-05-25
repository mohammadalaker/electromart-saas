import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  CheckCircle2,
  Receipt,
  AlertCircle,
  Users,
  Truck,
  Banknote,
  Plus,
  Trash2,
  CreditCard,
} from 'lucide-react';
import DashboardLayout from './DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';
import {
  applySupplierOutstandingFromVoucher,
  applyCustomerOutstandingFromVoucher,
} from '../utils/supplierVoucherBalance';
import { useHtmlDarkClass } from '../lib/theme';

const VOUCHERS_TABLE = import.meta.env.VITE_SUPABASE_VOUCHERS_TABLE?.trim() || 'vouchers';
const STORE_SUPPLIER_PAYMENTS_TABLE =
  import.meta.env.VITE_SUPABASE_STORE_SUPPLIER_PAYMENTS_TABLE?.trim() || 'store_supplier_payments';
/** جدول الموردين في Supabase (افتراضي: suppliers)؛ إن لم يوجد يُستخدم store_contacts بدور المورد */
const SUPPLIERS_TABLE = import.meta.env.VITE_SUPABASE_SUPPLIERS_TABLE?.trim() || 'suppliers';
const CONTACTS_FALLBACK = 'store_contacts';

const VOUCHER_TYPES = [
  { value: 'receipt', label: 'سند قبض' },
  { value: 'payment', label: 'سند صرف' },
];

/** طريقة الدفع في السند */
const TENDER_TYPES = [
  { value: 'cash', label: 'كاش' },
  { value: 'checks', label: 'شيكات' },
  { value: 'visa', label: 'فيزا' },
];

const CURRENCIES = [
  { code: 'ILS', label: 'شيكل', symbol: '₪' },
  { code: 'JOD', label: 'دينار', symbol: 'د.أ' },
  { code: 'USD', label: 'دولار', symbol: '$' },
];

function currencySymbol(code) {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? '₪';
}

function parseMoneyInput(v) {
  const n = parseFloat(normalizeDigitsToLatin(String(v ?? '')).replace(',', '.'));
  return Number.isNaN(n) ? 0 : Math.round(Math.max(0, n) * 100) / 100;
}

/** سطور شيكات نظيفة للحفظ في JSON */
function sanitizeCheckLinesForDb(rows) {
  return rows
    .map((r) => ({
      check_number: String(r.check_number ?? '').trim(),
      check_date: String(r.check_date ?? '').slice(0, 10),
      amount: parseMoneyInput(r.amount),
      bank_name: String(r.bank_name ?? '').trim(),
    }))
    .filter((r) => r.amount > 0);
}

function formatChecksForDescription(lines, sym = '₪') {
  if (!lines.length) return '';
  const parts = lines.map(
    (c, i) =>
      `شيك ${i + 1}: رقم ${c.check_number} — ${c.check_date} — ${sym}${c.amount.toFixed(2)} — ${c.bank_name}`
  );
  return `\n[تفاصيل الشيكات]\n${parts.join('\n')}`;
}

/**
 * إدراج في جدول vouchers: store_id + معرّف الطرف في account_id / supplier_contact_id.
 * يدعم أعمدة اختيارية: voucher_tender, cash_amount, check_lines (بعد تشغيل vouchers_tender_cheques.sql).
 */
async function handleInsert({
  storeId,
  supplierId,
  voucherType,
  amount,
  description,
  date,
  tender,
}) {
  const descriptionTrimmed = description?.trim() || '';
  const dateStr = String(date || '').slice(0, 10);

  if (!storeId || !supplierId) {
    console.error('[vouchers:insert] بيانات ناقصة', { storeId, supplierId });
    return { ok: false, error: { message: 'store_id أو الطرف مفقود' } };
  }

  const base = {
    store_id: storeId,
    voucher_type: voucherType,
    amount,
    description: descriptionTrimmed || null,
    date: dateStr,
  };

  const accountVariants = [
    { account_id: supplierId, supplier_contact_id: supplierId },
    { account_id: supplierId },
    { supplier_contact_id: supplierId },
    { supplier_id: supplierId },
  ];

  const tryInsertRow = async (row) => {
    const { data, error } = await supabase.from(VOUCHERS_TABLE).insert([row]).select('id').maybeSingle();
    return { data, error };
  };

  const tenderPayload = tender
    ? {
        voucher_tender: tender.voucher_tender,
        cash_amount: Number(tender.cash_amount) || 0,
        check_lines: Array.isArray(tender.check_lines) ? tender.check_lines : [],
        currency_code: tender.currency_code || 'ILS',
        visa_last4: tender.visa_last4 && String(tender.visa_last4).trim()
          ? String(tender.visa_last4).trim().slice(-4)
          : null,
      }
    : null;

  let lastErr = null;

  if (tenderPayload) {
    for (let i = 0; i < accountVariants.length; i++) {
      const row = { ...base, ...tenderPayload, ...accountVariants[i] };
      const { data, error } = await tryInsertRow(row);
      if (!error && data?.id) {
        console.log('[vouchers:insert] نجح (مع tender)', i + 1);
        return { ok: true, tenderSaved: true, voucherId: data.id };
      }
      lastErr = error;
      console.warn('[vouchers:insert] فشل (مع tender)', i + 1, error);
    }
  }

  const sym = currencySymbol(tender?.currency_code || 'ILS');
  const tenderLabel =
    tender?.voucher_tender === 'mixed'
      ? 'كاش + شيكات'
      : tender?.voucher_tender === 'checks'
        ? 'شيكات'
        : tender?.voucher_tender === 'visa'
          ? 'فيزا'
          : tender?.voucher_tender === 'cash'
            ? 'كاش'
            : '';
  const curLabel = CURRENCIES.find((c) => c.code === (tender?.currency_code || 'ILS'))?.label ?? 'شيكل';
  const fallbackDesc =
    descriptionTrimmed +
    (tender?.check_lines?.length ? formatChecksForDescription(tender.check_lines, sym) : '') +
    (tenderLabel ? `\n[طريقة الدفع: ${tenderLabel}]` : '') +
    (tender ? `\n[العملة: ${curLabel}]` : '') +
    (tender?.visa_last4 ? `\n[فيزا: ****${String(tender.visa_last4).slice(-4)}]` : '');

  const baseLegacy = {
    ...base,
    description: fallbackDesc.trim() || null,
  };

  for (let i = 0; i < accountVariants.length; i++) {
    const row = { ...baseLegacy, ...accountVariants[i] };
    const { data, error } = await tryInsertRow(row);
    if (!error && data?.id) {
      console.log('[vouchers:insert] نجح (بدون أعمدة tender — وُسِّع الوصف)', i + 1);
      return { ok: true, tenderSaved: false, voucherId: data.id };
    }
    lastErr = error;
    console.warn('[vouchers:insert] فشل', i + 1, error);
  }

  console.error('[vouchers:insert] فشل كل المحاولات', lastErr);
  return { ok: false, error: lastErr };
}

/**
 * سند صرف: إدراج في store_supplier_payments مع store_id و account_id (= معرّف المورد) و supplier_contact_id.
 * supplierId هو نفس id صف المورد في store_contacts.
 */
async function insertStoreSupplierPaymentRow({ storeId, supplierId, amount, paidAt, notes }) {
  const raw = String(paidAt || '').slice(0, 10);
  const paid = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? raw
    : new Date().toISOString().slice(0, 10);
  const notesStr = typeof notes === 'string' ? notes.trim() : '';
  const base = {
    store_id: storeId,
    amount,
    paid_at: paid,
    notes: notesStr || '',
  };

  /** المخطط المرجعي: supplier_contact_id + store_id فقط — جرّبها أولاً قبل account_id */
  const variants = [
    { ...base, supplier_contact_id: supplierId },
    { ...base, supplier_contact_id: supplierId, account_id: supplierId },
    { ...base, account_id: supplierId },
    { ...base, supplier_id: supplierId },
  ];

  console.log('[store_supplier_payments:insert]', {
    table: STORE_SUPPLIER_PAYMENTS_TABLE,
    store_id: storeId,
    supplier_contact_id: supplierId,
    amount,
    paid_at: paid,
  });

  let lastErr = null;
  for (let i = 0; i < variants.length; i++) {
    const row = variants[i];
    const { error } = await supabase.from(STORE_SUPPLIER_PAYMENTS_TABLE).insert([row]);
    if (!error) {
      console.log('[store_supplier_payments:insert] نجح', i + 1, row);
      return { ok: true };
    }
    lastErr = error;
    console.warn('[store_supplier_payments:insert] فشل', i + 1, row, error);
  }
  return { ok: false, error: lastErr };
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
      <p className="text-sm font-bold text-white">{message}</p>
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

export default function VoucherPage() {
  const { store, loading: storeLoading } = useStore();
  const darkUi = useHtmlDarkClass();

  /** الطرف: مورد أو زبون */
  const [partyType, setPartyType] = useState('supplier');

  const [suppliers, setSuppliers] = useState([]);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [suppliersSource, setSuppliersSource] = useState(null);

  const [customers, setCustomers] = useState([]);
  const [customersLoading, setCustomersLoading] = useState(false);

  const [voucherType, setVoucherType] = useState('receipt');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState('');
  const [customerId, setCustomerId] = useState('');

  /** كاش | شيكات | فيزا */
  const [tenderType, setTenderType] = useState('cash');
  const [currencyCode, setCurrencyCode] = useState('ILS');
  const [visaLast4Input, setVisaLast4Input] = useState('');
  const [checkRows, setCheckRows] = useState(() => [
    {
      check_number: '',
      check_date: new Date().toISOString().slice(0, 10),
      amount: '',
      bank_name: '',
    },
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [toast, setToast] = useState(null);

  const [recentPayments, setRecentPayments] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [deletingPaymentId, setDeletingPaymentId] = useState(null);

  /**
   * جلب الموردين — يُفضّل دليل المتجر (store_contacts) ليتطابق id مع كشف الحساب؛ ثم جدول suppliers.
   */
  const fetchSuppliers = useCallback(async () => {
    if (!store?.id) {
      setSuppliers([]);
      setSuppliersLoading(false);
      return;
    }
    setSuppliersLoading(true);
    setFormError(null);

    const fromContacts = await supabase
      .from(CONTACTS_FALLBACK)
      .select('id, name')
      .eq('store_id', store.id)
      .eq('role', 'supplier')
      .order('name', { ascending: true });

    if (!fromContacts.error && fromContacts.data?.length) {
      setSuppliers(fromContacts.data);
      setSuppliersSource(CONTACTS_FALLBACK);
      setSuppliersLoading(false);
      return;
    }

    const fromSuppliers = await supabase
      .from(SUPPLIERS_TABLE)
      .select('id, name')
      .eq('store_id', store.id)
      .order('name', { ascending: true });

    if (!fromSuppliers.error && fromSuppliers.data) {
      setSuppliers(fromSuppliers.data);
      setSuppliersSource(SUPPLIERS_TABLE);
    } else {
      setSuppliers([]);
      setSuppliersSource(null);
      setFormError(
        fromSuppliers.error?.message ||
          fromContacts.error?.message ||
          'تعذّر تحميل الموردين. تحقق من جدول suppliers أو store_contacts.'
      );
    }
    setSuppliersLoading(false);
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    void fetchSuppliers();
  }, [storeLoading, fetchSuppliers]);

  /** جلب الزبائن من دليل المتجر */
  const fetchCustomers = useCallback(async () => {
    if (!store?.id) { setCustomers([]); return; }
    setCustomersLoading(true);
    const { data, error } = await supabase
      .from(CONTACTS_FALLBACK)
      .select('id, name, outstanding_amount')
      .eq('store_id', store.id)
      .eq('role', 'customer')
      .order('name', { ascending: true });
    if (!error) setCustomers(data || []);
    else setCustomers([]);
    setCustomersLoading(false);
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    fetchCustomers();
  }, [storeLoading, fetchCustomers]);

  const fetchRecentPayments = useCallback(async () => {
    if (!store?.id) {
      setRecentPayments([]);
      setPaymentsLoading(false);
      return;
    }
    setPaymentsLoading(true);
    try {
      const baseSelect =
        'id, supplier_contact_id, account_id, amount, paid_at, notes, created_at, voucher_type';
      let { data, error } = await supabase
        .from(STORE_SUPPLIER_PAYMENTS_TABLE)
        .select(`${baseSelect}, store_contacts ( name )`)
        .eq('store_id', store.id)
        .order('paid_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(20);

      if (error && /voucher_type|column|PGRST204/i.test(String(error.message || ''))) {
        const res = await supabase
          .from(STORE_SUPPLIER_PAYMENTS_TABLE)
          .select(`${baseSelect.replace(', voucher_type', '')}, store_contacts ( name )`)
          .eq('store_id', store.id)
          .order('paid_at', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(20);
        data = res.data;
        error = res.error;
      }

      if (error && /store_contacts|relationship|PGRST/i.test(String(error.message || ''))) {
        const res = await supabase
          .from(STORE_SUPPLIER_PAYMENTS_TABLE)
          .select('id, supplier_contact_id, account_id, amount, paid_at, notes, created_at')
          .eq('store_id', store.id)
          .order('paid_at', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(20);
        data = res.data;
        error = res.error;
      }

      if (error) throw error;

      const nameById = new Map(suppliers.map((s) => [String(s.id), s.name]));
      setRecentPayments(
        (data || []).map((row) => {
          const contact = row.store_contacts;
          const joinedName =
            contact && typeof contact === 'object'
              ? contact.name ?? (Array.isArray(contact) ? contact[0]?.name : null)
              : null;
          const contactId = row.supplier_contact_id || row.account_id;
          return {
            ...row,
            contactId,
            supplierName: joinedName || nameById.get(String(contactId)) || '—',
            voucher_type: row.voucher_type || 'payment',
          };
        })
      );
    } catch (e) {
      console.error('[store_supplier_payments:list]', e);
      setRecentPayments([]);
    } finally {
      setPaymentsLoading(false);
    }
  }, [store?.id, suppliers]);

  useEffect(() => {
    if (storeLoading) return;
    void fetchRecentPayments();
  }, [storeLoading, fetchRecentPayments]);

  const filteredPayments = useMemo(() => {
    if (paymentFilter === 'all') return recentPayments;
    if (paymentFilter === 'payment') {
      return recentPayments.filter((p) => (p.voucher_type || 'payment') === 'payment');
    }
    return recentPayments.filter((p) => p.voucher_type === 'receipt');
  }, [recentPayments, paymentFilter]);

  const handleDeletePayment = async (row) => {
    if (!store?.id || !row?.id) return;
    const contactId = row.contactId || row.supplier_contact_id || row.account_id;
    const amount = parseMoneyInput(row.amount);
    const vType = row.voucher_type || 'payment';
    setDeletingPaymentId(row.id);
    try {
      const { error: delErr } = await supabase
        .from(STORE_SUPPLIER_PAYMENTS_TABLE)
        .delete()
        .eq('id', row.id)
        .eq('store_id', store.id);
      if (delErr) throw delErr;

      if (contactId && amount > 0) {
        const reverseType = vType === 'payment' ? 'receipt' : 'payment';
        const bal = await applySupplierOutstandingFromVoucher({
          storeId: store.id,
          supplierContactId: contactId,
          voucherType: reverseType,
          amount,
        });
        if (!bal.ok && !bal.skipped) {
          console.warn('[store_supplier_payments:reverse]', bal.error);
        }
      }

      setToast({ message: 'تم حذف السند وعكس الترحيل.', variant: 'success' });
      void fetchRecentPayments();
    } catch (e) {
      console.error(e);
      setToast({
        message: e.message || 'تعذّر حذف السند.',
        variant: 'error',
      });
    } finally {
      setDeletingPaymentId(null);
    }
  };

  const resetForm = useCallback(() => {
    setVoucherType('receipt');
    setAmount('');
    setDescription('');
    setDate(new Date().toISOString().slice(0, 10));
    setSupplierId('');
    setCustomerId('');
    setTenderType('cash');
    setCurrencyCode('ILS');
    setVisaLast4Input('');
    setCheckRows([
      {
        check_number: '',
        check_date: new Date().toISOString().slice(0, 10),
        amount: '',
        bank_name: '',
      },
    ]);
    setFormError(null);
  }, []);

  const updateCheckRow = (index, field, value) => {
    setCheckRows((prev) => {
      const next = [...prev];
      if (!next[index]) return prev;
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addCheckRow = () => {
    setCheckRows((prev) => [
      ...prev,
      {
        check_number: '',
        check_date: new Date().toISOString().slice(0, 10),
        amount: '',
        bank_name: '',
      },
    ]);
  };

  const removeCheckRow = (index) => {
    setCheckRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!store?.id) {
      setFormError('لا يوجد متجر مرتبط بهذا الحساب.');
      return;
    }
    const activePartyId = partyType === 'customer' ? customerId : supplierId;
    if (!activePartyId) {
      setFormError(partyType === 'customer' ? 'اختر الزبون.' : 'اختر المورد.');
      return;
    }
    const checkLinesDb = sanitizeCheckLinesForDb(checkRows);
    let num = 0;
    let tender = null;

    const visaDigits = normalizeDigitsToLatin(String(visaLast4Input || '')).replace(/\D/g, '');
    if (visaDigits.length > 0 && visaDigits.length !== 4) {
      setFormError('آخر 4 أرقام للفيزا: أدخل 4 أرقام بالضبط أو اترك الحقل فارغاً.');
      return;
    }
    const visaLast4 = visaDigits.length === 4 ? visaDigits : null;

    const baseTender = () => ({
      currency_code: currencyCode,
      visa_last4: null,
    });

    if (tenderType === 'cash') {
      num = parseMoneyInput(amount);
      if (num <= 0) {
        setFormError('أدخل مبلغاً صحيحاً أكبر من صفر.');
        return;
      }
      tender = { ...baseTender(), voucher_tender: 'cash', cash_amount: num, check_lines: [] };
    } else if (tenderType === 'checks') {
      if (checkLinesDb.length === 0) {
        setFormError('أضف شيكاً واحداً على الأقل بمبلغ صحيح.');
        return;
      }
      for (const c of checkLinesDb) {
        if (!c.check_number || !c.check_date || !c.bank_name) {
          setFormError('لكل شيك: رقم الشيك، تاريخ الشيك، المبلغ، واسم البنك مطلوبة.');
          return;
        }
      }
      num = checkLinesDb.reduce((s, c) => s + c.amount, 0);
      tender = { ...baseTender(), voucher_tender: 'checks', cash_amount: 0, check_lines: checkLinesDb };
    } else {
      num = parseMoneyInput(amount);
      if (num <= 0) {
        setFormError('أدخل مبلغاً صحيحاً أكبر من صفر.');
        return;
      }
      tender = {
        ...baseTender(),
        voucher_tender: 'visa',
        cash_amount: num,
        check_lines: [],
        visa_last4,
      };
    }

    setSubmitting(true);
    setFormError(null);

    const result = await handleInsert({
      storeId: store.id,
      supplierId: activePartyId,
      voucherType,
      amount: num,
      description,
      date,
      tender,
    });

    if (result.ok) {
      let extra = '';
      if (
        result.tenderSaved === false &&
        tender &&
        (tender.voucher_tender === 'checks' ||
          tender.voucher_tender === 'visa' ||
          tender.currency_code !== 'ILS')
      ) {
        extra +=
          ' — بعض الحقول وُسِجَت في «البيان» لأن أعمدة الجدول غير مفعّلة؛ نفّذ vouchers_tender_cheques.sql و vouchers_currency_visa.sql في Supabase.';
      }

      if (partyType === 'customer') {
        const bal = await applyCustomerOutstandingFromVoucher({
          storeId: store.id,
          customerContactId: activePartyId,
          voucherType,
          amount: num,
          voucherId: result.voucherId,
        });
        if (bal.ok) {
          extra = ` — رصيد الزبون: ₪${bal.prev?.toFixed(2)} → ₪${bal.next?.toFixed(2)}`;
        } else if (!bal.skipped) {
          extra = ` (تحذير: لم يُحدَّث رصيد الزبون: ${bal.error?.message || ''})`;
        }
      } else {
        let paymentSyncWarning = '';
        if (voucherType === 'payment') {
          if (suppliersSource !== CONTACTS_FALLBACK) {
            paymentSyncWarning =
              ' لم يُسجَّل في دفعات الموردين: اختر مورداً من دليل المتجر.';
          } else {
            const payRes = await insertStoreSupplierPaymentRow({
              storeId: store.id,
              supplierId: activePartyId,
              amount: num,
              paidAt: date,
              notes: description,
            });
            if (!payRes.ok) {
              const detail = payRes.error?.message || payRes.error?.hint || '';
              paymentSyncWarning = ` تعذّر تسجيل دفعة المورد${detail ? `: ${detail}` : '.'}`;
              console.error('[store_supplier_payments] فشل', payRes.error);
            }
          }
        }
        const bal = await applySupplierOutstandingFromVoucher({
          storeId: store.id,
          supplierContactId: activePartyId,
          voucherType,
          amount: num,
        });
        extra = paymentSyncWarning;
        if (bal.skipped && bal.reason === 'not-a-contact') {
          extra += ' لم يُحدَّث رصيد الذمة لأن المورد ليس في الدليل.';
        } else if (!bal.ok && !bal.skipped) {
          extra += ` تعذّر تحديث رصيد الذمة: ${bal.error?.message || ''}`.trim();
        }
      }

      setToast({
        message: 'تم حفظ السند بنجاح.' + extra,
        variant: extra.includes('تعذّر') || extra.includes('تحذير') ? 'error' : 'success',
      });
      resetForm();
      void fetchRecentPayments();
    } else {
      setToast({
        message:
          result.error?.message || 'فشل الحفظ. تحقق من أعمدة الجدول والصلاحيات.',
        variant: 'error',
      });
    }
    setSubmitting(false);
  };

  const shell = darkUi ? 'dark' : '';

  return (
    <DashboardLayout>
      <div className={`${shell} font-arabic`} dir="rtl">
        <div
          className={`relative overflow-hidden rounded-3xl border p-6 sm:p-8 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.45)] transition-colors ${
            darkUi
              ? 'border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950'
              : 'border-slate-200 bg-gradient-to-br from-slate-50 via-white to-indigo-50/80'
          }`}
        >
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.25),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(14,165,233,0.12),transparent_50%)]"
            aria-hidden
          />
          <div
            className={`relative mx-auto max-w-xl rounded-2xl border p-6 sm:p-8 backdrop-blur-2xl ${
              darkUi
                ? 'border-white/15 bg-white/5 shadow-inner shadow-white/5'
                : 'border-white/60 bg-white/40 shadow-lg'
            }`}
          >
            <div className="mb-6 flex items-start gap-3">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                  darkUi ? 'bg-indigo-500/20 text-indigo-300' : 'bg-indigo-100 text-indigo-600'
                }`}
              >
                <Receipt size={24} />
              </div>
              <div>
                <h1
                  className={`text-xl font-black tracking-tight sm:text-2xl ${
                    darkUi ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  سندات القبض والصرف
                </h1>
                <p className={`mt-1 text-sm ${darkUi ? 'text-slate-400' : 'text-slate-600'}`}>
                  تسجيل سند قبض أو صرف — مورد أو زبون.
                  {suppliersSource && (
                    <span className="mr-2 inline-block rounded-lg bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-400">
                      الموردون: {suppliersSource}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {!store?.id && !storeLoading && (
              <p className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-200">
                لا يوجد متجر لهذا الحساب — لا يمكن حفظ السندات.
              </p>
            )}

            {formError && (
              <p className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-200">
                {formError}
              </p>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">

              {/* نوع الطرف: زبون / مورد */}
              <div>
                <label className={`mb-2 block text-sm font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}>
                  الطرف
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { val: 'supplier', label: 'مورد', Icon: Truck },
                    { val: 'customer', label: 'زبون', Icon: Users },
                  ].map(({ val, label, Icon }) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => { setPartyType(val); setSupplierId(''); setCustomerId(''); }}
                      className={`flex items-center justify-center gap-2 rounded-2xl border py-2.5 text-sm font-bold transition ${
                        partyType === val
                          ? darkUi
                            ? 'border-indigo-400/60 bg-indigo-500/25 text-indigo-200'
                            : 'border-indigo-400 bg-indigo-50 text-indigo-700'
                          : darkUi
                          ? 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'
                          : 'border-slate-200 bg-white/60 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <Icon size={16} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* نوع السند */}
              <div>
                <label
                  className={`mb-2 block text-sm font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}
                >
                  نوع السند
                </label>
                <select
                  value={voucherType}
                  onChange={(e) => setVoucherType(e.target.value)}
                  className={`w-full rounded-2xl border px-4 py-3 text-sm font-semibold outline-none transition focus:ring-2 ${
                    darkUi
                      ? 'border-white/10 bg-white/5 text-white focus:border-indigo-400/50 focus:ring-indigo-500/30'
                      : 'border-slate-200 bg-white/80 text-slate-900 focus:border-indigo-300 focus:ring-indigo-200'
                  }`}
                >
                  {VOUCHER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  className={`mb-2 block text-sm font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}
                >
                  العملة
                </label>
                <select
                  value={currencyCode}
                  onChange={(e) => setCurrencyCode(e.target.value)}
                  className={`w-full rounded-2xl border px-4 py-3 text-sm font-semibold outline-none transition focus:ring-2 ${
                    darkUi
                      ? 'border-white/10 bg-white/5 text-white focus:border-indigo-400/50 focus:ring-indigo-500/30'
                      : 'border-slate-200 bg-white/80 text-slate-900 focus:border-indigo-300 focus:ring-indigo-200'
                  }`}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label} ({c.symbol})
                    </option>
                  ))}
                </select>
              </div>

              {/* قائمة الطرف (مورد أو زبون) */}
              {partyType === 'supplier' ? (
                <div>
                  <label className={`mb-2 block text-sm font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}>
                    المورد
                  </label>
                  <div className="relative">
                    <select
                      value={supplierId}
                      onChange={(e) => setSupplierId(e.target.value)}
                      disabled={suppliersLoading || !store?.id}
                      className={`w-full rounded-2xl border px-4 py-3 text-sm font-semibold outline-none transition focus:ring-2 disabled:opacity-50 ${
                        darkUi
                          ? 'border-white/10 bg-white/5 text-white focus:border-indigo-400/50 focus:ring-indigo-500/30'
                          : 'border-slate-200 bg-white/80 text-slate-900 focus:border-indigo-300 focus:ring-indigo-200'
                      }`}
                    >
                      <option value="">— اختر المورد —</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name || 'بدون اسم'}
                        </option>
                      ))}
                    </select>
                    {suppliersLoading && (
                      <Loader2 className={`pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin ${darkUi ? 'text-indigo-400' : 'text-indigo-500'}`} />
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <label className={`mb-2 block text-sm font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}>
                    الزبون
                  </label>
                  <div className="relative">
                    <select
                      value={customerId}
                      onChange={(e) => setCustomerId(e.target.value)}
                      disabled={customersLoading || !store?.id}
                      className={`w-full rounded-2xl border px-4 py-3 text-sm font-semibold outline-none transition focus:ring-2 disabled:opacity-50 ${
                        darkUi
                          ? 'border-white/10 bg-white/5 text-white focus:border-indigo-400/50 focus:ring-indigo-500/30'
                          : 'border-slate-200 bg-white/80 text-slate-900 focus:border-indigo-300 focus:ring-indigo-200'
                      }`}
                    >
                      <option value="">— اختر الزبون —</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name || 'بدون اسم'}
                          {c.outstanding_amount > 0
                            ? ` (عليه: ${currencySymbol(currencyCode)}${Number(c.outstanding_amount).toFixed(2)})`
                            : ''}
                        </option>
                      ))}
                    </select>
                    {customersLoading && (
                      <Loader2 className={`pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin ${darkUi ? 'text-indigo-400' : 'text-indigo-500'}`} />
                    )}
                  </div>
                  {partyType === 'customer' && voucherType === 'receipt' && (
                    <p className={`mt-1.5 text-xs ${darkUi ? 'text-slate-400' : 'text-slate-500'}`}>
                      سند قبض من زبون = يُنقص ما عليه من دين
                    </p>
                  )}
                </div>
              )}

              {/* طريقة الدفع: كاش / شيكات */}
              <div>
                <label className={`mb-2 block text-sm font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}>
                  طريقة الدفع
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {TENDER_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setTenderType(t.value)}
                      className={`flex items-center justify-center gap-1.5 rounded-2xl border py-2.5 text-xs font-bold transition sm:text-sm ${
                        tenderType === t.value
                          ? darkUi
                            ? 'border-amber-400/50 bg-amber-500/20 text-amber-100'
                            : 'border-amber-400 bg-amber-50 text-amber-900'
                          : darkUi
                            ? 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'
                            : 'border-slate-200 bg-white/60 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {t.value === 'cash' ? (
                        <Banknote size={14} className="shrink-0" />
                      ) : t.value === 'visa' ? (
                        <CreditCard size={14} className="shrink-0" />
                      ) : null}
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className={`mt-2 text-xs leading-relaxed ${darkUi ? 'text-slate-400' : 'text-slate-600'}`}>
                  {tenderType === 'checks' && (
                    <>
                      {voucherType === 'receipt' && partyType === 'customer' && 'شيكات واردة (مستلمة من الزبون). '}
                      {voucherType === 'receipt' && partyType === 'supplier' && 'شيكات واردة (مستلمة). '}
                      {voucherType === 'payment' && partyType === 'supplier' && 'شيكات صادرة (للمورد). '}
                      {voucherType === 'payment' && partyType === 'customer' && 'شيكات صادرة (للزبون). '}
                    </>
                  )}
                  {tenderType === 'visa' && 'دفع ببطاقة (فيزا/ماستر). '}
                  سند القبض يعني وارد، سند الصرف يعني صادر.
                </p>
              </div>

              {tenderType === 'cash' && (
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label
                      className={`mb-2 block text-sm font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}
                    >
                      المبلغ ({currencySymbol(currencyCode)})
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(normalizeDigitsToLatin(e.target.value))}
                      placeholder="0.00"
                      dir="ltr"
                      className={`w-full rounded-2xl border px-4 py-3 font-currency text-sm outline-none transition focus:ring-2 ${
                        darkUi
                          ? 'border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400/50 focus:ring-indigo-500/30'
                          : 'border-slate-200 bg-white/80 text-slate-900 focus:border-indigo-300 focus:ring-indigo-200'
                      }`}
                    />
                  </div>
                  <div>
                    <label
                      className={`mb-2 block text-sm font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}
                    >
                      تاريخ السند
                    </label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(normalizeDigitsToLatin(e.target.value))}
                      dir="ltr"
                      className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition focus:ring-2 ${
                        darkUi
                          ? 'border-white/10 bg-white/5 text-white focus:border-indigo-400/50 focus:ring-indigo-500/30'
                          : 'border-slate-200 bg-white/80 text-slate-900 focus:border-indigo-300 focus:ring-indigo-200'
                      }`}
                    />
                  </div>
                </div>
              )}

              {tenderType === 'visa' && (
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label
                      className={`mb-2 block text-sm font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}
                    >
                      المبلغ ({currencySymbol(currencyCode)})
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(normalizeDigitsToLatin(e.target.value))}
                      placeholder="0.00"
                      dir="ltr"
                      className={`w-full rounded-2xl border px-4 py-3 font-currency text-sm outline-none transition focus:ring-2 ${
                        darkUi
                          ? 'border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400/50 focus:ring-indigo-500/30'
                          : 'border-slate-200 bg-white/80 text-slate-900 focus:border-indigo-300 focus:ring-indigo-200'
                      }`}
                    />
                  </div>
                  <div>
                    <label
                      className={`mb-2 block text-sm font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}
                    >
                      تاريخ السند
                    </label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(normalizeDigitsToLatin(e.target.value))}
                      dir="ltr"
                      className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition focus:ring-2 ${
                        darkUi
                          ? 'border-white/10 bg-white/5 text-white focus:border-indigo-400/50 focus:ring-indigo-500/30'
                          : 'border-slate-200 bg-white/80 text-slate-900 focus:border-indigo-300 focus:ring-indigo-200'
                      }`}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label
                      className={`mb-2 block text-sm font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}
                    >
                      آخر 4 أرقام للبطاقة (اختياري)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      value={visaLast4Input}
                      onChange={(e) =>
                        setVisaLast4Input(
                          normalizeDigitsToLatin(e.target.value).replace(/\D/g, '').slice(0, 4)
                        )
                      }
                      placeholder="••••"
                      dir="ltr"
                      className={`w-full max-w-[10rem] rounded-2xl border px-4 py-3 font-currency text-sm tracking-widest outline-none transition focus:ring-2 ${
                        darkUi
                          ? 'border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400/50 focus:ring-indigo-500/30'
                          : 'border-slate-200 bg-white/80 text-slate-900 focus:border-indigo-300 focus:ring-indigo-200'
                      }`}
                    />
                  </div>
                </div>
              )}

              {tenderType === 'checks' && (
                <div className="space-y-4">
                  <div>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <label className={`text-sm font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}>
                        تفاصيل الشيكات ({checkRows.length})
                      </label>
                      <button
                        type="button"
                        onClick={addCheckRow}
                        className={`inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                          darkUi
                            ? 'border-white/15 bg-white/10 text-indigo-200 hover:bg-white/15'
                            : 'border-slate-200 bg-white text-indigo-700 hover:bg-slate-50'
                        }`}
                      >
                        <Plus size={14} />
                        إضافة شيك
                      </button>
                    </div>
                    <div className="space-y-3">
                      {checkRows.map((row, idx) => (
                        <div
                          key={idx}
                          className={`rounded-2xl border p-3 sm:p-4 ${
                            darkUi ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-slate-50/80'
                          }`}
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <span className={`text-xs font-bold ${darkUi ? 'text-slate-400' : 'text-slate-600'}`}>
                              شيك {idx + 1}
                            </span>
                            {checkRows.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeCheckRow(idx)}
                                className="rounded-lg p-1 text-rose-400 hover:bg-rose-500/20"
                                aria-label="حذف الشيك"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <label className={`mb-1 block text-[11px] font-bold ${darkUi ? 'text-slate-400' : 'text-slate-600'}`}>
                                رقم الشيك
                              </label>
                              <input
                                type="text"
                                value={row.check_number}
                                onChange={(e) =>
                                  updateCheckRow(idx, 'check_number', normalizeDigitsToLatin(e.target.value))
                                }
                                dir="ltr"
                                className={`w-full rounded-xl border px-3 py-2 text-sm outline-none ${
                                  darkUi
                                    ? 'border-white/10 bg-white/5 text-white'
                                    : 'border-slate-200 bg-white text-slate-900'
                                }`}
                              />
                            </div>
                            <div>
                              <label className={`mb-1 block text-[11px] font-bold ${darkUi ? 'text-slate-400' : 'text-slate-600'}`}>
                                تاريخ الشيك
                              </label>
                              <input
                                type="date"
                                value={row.check_date}
                                onChange={(e) =>
                                  updateCheckRow(idx, 'check_date', normalizeDigitsToLatin(e.target.value))
                                }
                                dir="ltr"
                                className={`w-full rounded-xl border px-3 py-2 text-sm outline-none ${
                                  darkUi
                                    ? 'border-white/10 bg-white/5 text-white'
                                    : 'border-slate-200 bg-white text-slate-900'
                                }`}
                              />
                            </div>
                            <div>
                              <label className={`mb-1 block text-[11px] font-bold ${darkUi ? 'text-slate-400' : 'text-slate-600'}`}>
                                مبلغ الشيك ({currencySymbol(currencyCode)})
                              </label>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={row.amount}
                                onChange={(e) =>
                                  updateCheckRow(idx, 'amount', normalizeDigitsToLatin(e.target.value))
                                }
                                dir="ltr"
                                className={`w-full rounded-xl border px-3 py-2 font-currency text-sm outline-none ${
                                  darkUi
                                    ? 'border-white/10 bg-white/5 text-white'
                                    : 'border-slate-200 bg-white text-slate-900'
                                }`}
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className={`mb-1 block text-[11px] font-bold ${darkUi ? 'text-slate-400' : 'text-slate-600'}`}>
                                اسم البنك
                              </label>
                              <input
                                type="text"
                                value={row.bank_name}
                                onChange={(e) =>
                                  updateCheckRow(idx, 'bank_name', normalizeDigitsToLatin(e.target.value))
                                }
                                placeholder="مثال: بنك فلسطين"
                                className={`w-full rounded-xl border px-3 py-2 text-sm outline-none ${
                                  darkUi
                                    ? 'border-white/10 bg-white/5 text-white placeholder:text-slate-500'
                                    : 'border-slate-200 bg-white text-slate-900'
                                }`}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label
                        className={`mb-2 block text-sm font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}
                      >
                        إجمالي السند (مجموع الشيكات)
                      </label>
                      <p
                        dir="ltr"
                        className={`rounded-2xl border px-4 py-3 font-currency text-sm font-bold ${
                          darkUi ? 'border-white/10 bg-white/10 text-emerald-300' : 'border-slate-200 bg-white text-emerald-700'
                        }`}
                      >
                        {currencySymbol(currencyCode)}
                        {sanitizeCheckLinesForDb(checkRows)
                          .reduce((s, c) => s + c.amount, 0)
                          .toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <label
                        className={`mb-2 block text-sm font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}
                      >
                        تاريخ السند
                      </label>
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(normalizeDigitsToLatin(e.target.value))}
                        dir="ltr"
                        className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition focus:ring-2 ${
                          darkUi
                            ? 'border-white/10 bg-white/5 text-white focus:border-indigo-400/50 focus:ring-indigo-500/30'
                            : 'border-slate-200 bg-white/80 text-slate-900 focus:border-indigo-300 focus:ring-indigo-200'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label
                  className={`mb-2 block text-sm font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}
                >
                  البيان / الوصف
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(normalizeDigitsToLatin(e.target.value))}
                  rows={3}
                  placeholder="تفاصيل السند…"
                  className={`w-full resize-none rounded-2xl border px-4 py-3 text-sm outline-none transition focus:ring-2 ${
                    darkUi
                      ? 'border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400/50 focus:ring-indigo-500/30'
                      : 'border-slate-200 bg-white/80 text-slate-900 focus:border-indigo-300 focus:ring-indigo-200'
                  }`}
                />
              </div>

              <button
                type="submit"
                disabled={submitting || storeLoading || !store?.id}
                className={`flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-black shadow-lg transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${
                  darkUi
                    ? 'bg-gradient-to-l from-indigo-600 to-violet-600 text-white shadow-indigo-900/40 hover:from-indigo-500 hover:to-violet-500'
                    : 'bg-gradient-to-l from-indigo-600 to-indigo-500 text-white shadow-indigo-200 hover:from-indigo-500 hover:to-indigo-400'
                }`}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    جاري الحفظ…
                  </>
                ) : (
                  'حفظ السند'
                )}
              </button>
            </form>

            <div className="mt-8 pt-8 border-t border-white/10">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className={`text-sm font-black ${darkUi ? 'text-white' : 'text-slate-900'}`}>
                  آخر 20 سند
                </h2>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'all', label: 'عرض الكل' },
                    { id: 'payment', label: 'سندات الصرف فقط' },
                    { id: 'receipt', label: 'سندات القبض فقط' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setPaymentFilter(f.id)}
                      className={`rounded-xl px-3 py-1.5 text-[11px] font-black transition ${
                        paymentFilter === f.id
                          ? darkUi
                            ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-400/40'
                            : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                          : darkUi
                            ? 'border border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'
                            : 'border border-slate-200 bg-white/60 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div
                className={`overflow-x-auto rounded-2xl border backdrop-blur-xl ${
                  darkUi
                    ? 'border-white/10 bg-white/[0.03]'
                    : 'border-slate-200/80 bg-white/80'
                }`}
              >
                <table className="w-full text-sm min-w-[520px]">
                  <thead>
                    <tr
                      className={`border-b text-xs ${
                        darkUi
                          ? 'border-white/10 text-slate-400'
                          : 'border-slate-200 text-slate-600'
                      }`}
                    >
                      <th className="text-right py-3 px-4 font-semibold">التاريخ</th>
                      <th className="text-right py-3 px-4 font-semibold">المورد</th>
                      <th className="text-right py-3 px-4 font-semibold">المبلغ</th>
                      <th className="text-right py-3 px-4 font-semibold">الملاحظات</th>
                      <th className="text-center py-3 px-4 font-semibold w-16">حذف</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentsLoading ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center">
                          <Loader2
                            className={`inline animate-spin ${darkUi ? 'text-indigo-400' : 'text-indigo-500'}`}
                            size={28}
                          />
                        </td>
                      </tr>
                    ) : filteredPayments.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className={`py-10 text-center text-sm ${darkUi ? 'text-slate-500' : 'text-slate-400'}`}
                        >
                          لا توجد سندات مطابقة
                        </td>
                      </tr>
                    ) : (
                      filteredPayments.map((row) => (
                        <tr
                          key={row.id}
                          className={`border-b transition-colors ${
                            darkUi
                              ? 'border-white/5 hover:bg-white/[0.04]'
                              : 'border-slate-100 hover:bg-slate-50/80'
                          }`}
                        >
                          <td className={`py-3 px-4 text-xs ${darkUi ? 'text-slate-300' : 'text-slate-600'}`}>
                            {row.paid_at
                              ? new Date(row.paid_at).toLocaleDateString('ar-SA')
                              : '—'}
                          </td>
                          <td className={`py-3 px-4 text-xs font-bold ${darkUi ? 'text-slate-200' : 'text-slate-800'}`}>
                            {row.supplierName}
                          </td>
                          <td
                            className={`py-3 px-4 text-xs font-black font-currency ${darkUi ? 'text-emerald-300' : 'text-emerald-700'}`}
                            dir="ltr"
                          >
                            ₪{parseMoneyInput(row.amount).toFixed(2)}
                          </td>
                          <td
                            className={`py-3 px-4 text-xs max-w-[180px] truncate ${darkUi ? 'text-slate-400' : 'text-slate-500'}`}
                            title={row.notes || ''}
                          >
                            {row.notes || '—'}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              type="button"
                              disabled={deletingPaymentId === row.id}
                              onClick={() => handleDeletePayment(row)}
                              className="inline-flex items-center justify-center rounded-lg p-1.5 text-rose-400 hover:bg-rose-500/10 disabled:opacity-40"
                              aria-label="حذف السند"
                            >
                              {deletingPaymentId === row.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Trash2 size={14} />
                              )}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <Toast
          message={toast.message}
          variant={toast.variant}
          onDismiss={() => setToast(null)}
        />
      )}
    </DashboardLayout>
  );
}
