import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
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
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react';
import DashboardLayout from './DashboardLayout';
import SupplierFormModal from './SupplierFormModal';
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

/** دالة تنسيق الحقول وفق الحالة والترميز اللوني */
function getInputClass({
  filled = false,
  isAmount = false,
  isPayment = false,
  amountVal = 0,
  isReadOnly = false,
  extra = '',
}) {
  const common =
    'h-12 w-full rounded-2xl px-4 text-base font-bold outline-none transition-all focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:opacity-60 ';

  if (isReadOnly) {
    return (
      common +
      'border border-violet-200/90 bg-violet-50/70 dark:border-violet-900/60 dark:bg-violet-950/40 text-violet-800 dark:text-violet-300 font-mono font-black select-all cursor-default ' +
      extra
    );
  }

  if (isAmount && amountVal > 0) {
    if (isPayment) {
      return (
        common +
        'border-2 border-rose-400 dark:border-rose-500/80 bg-rose-50/60 dark:bg-rose-950/30 text-rose-950 dark:text-rose-200 font-currency font-black ' +
        extra
      );
    }
    return (
      common +
      'border-2 border-emerald-400 dark:border-emerald-500/80 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-950 dark:text-emerald-200 font-currency font-black ' +
      extra
    );
  }

  if (filled) {
    return (
      common +
      'border border-emerald-400 dark:border-emerald-500/70 bg-white dark:bg-slate-800/90 text-slate-900 dark:text-white ' +
      extra
    );
  }

  return (
    common +
    'border border-slate-200 dark:border-slate-700 bg-slate-50/70 focus:bg-white dark:bg-slate-800/60 dark:focus:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 ' +
    extra
  );
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
  voucherNumber,
  manualVoucherNo,
  manualVoucherDate,
}) {
  const descriptionTrimmed = description?.trim() || '';
  const dateStr = String(date || '').slice(0, 10);
  const manualTrimmed = manualVoucherNo?.trim() || '';
  const manualDateTrimmed = manualVoucherDate?.trim() || '';

  if (!storeId || !supplierId) {
    console.error('[vouchers:insert] بيانات ناقصة', { storeId, supplierId });
    return { ok: false, error: { message: 'store_id أو الطرف مفقود' } };
  }

  const metaTags = [];
  if (voucherNumber) metaTags.push(`[رقم: ${voucherNumber}]`);
  if (manualTrimmed) {
    metaTags.push(`[سند يدوي: ${manualTrimmed}${manualDateTrimmed ? ` بتاريخ ${manualDateTrimmed}` : ''}]`);
  }
  const prefixNotes = metaTags.length > 0 ? metaTags.join(' ') : '';
  const fullDesc = [prefixNotes, descriptionTrimmed].filter(Boolean).join(' — ');

  const base = {
    store_id: storeId,
    voucher_type: voucherType,
    amount,
    description: fullDesc || null,
    reference_number: voucherNumber || manualTrimmed || null,
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
    (fullDesc ? fullDesc + '\n' : '') +
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

export default function VoucherPage({ type }) {
  const { store, loading: storeLoading } = useStore();
  const darkUi = useHtmlDarkClass();
  const location = useLocation();

  const isPayment = (type || (location.pathname.includes('/payment') ? 'payment' : 'receipt')) === 'payment';
  const voucherType = isPayment ? 'payment' : 'receipt';

  /** الطرف: مورد أو زبون */
  const [partyType, setPartyType] = useState('supplier');

  const [suppliers, setSuppliers] = useState([]);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [suppliersSource, setSuppliersSource] = useState(null);
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);

  const [customers, setCustomers] = useState([]);
  const [customersLoading, setCustomersLoading] = useState(false);

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState('');
  const [customerId, setCustomerId] = useState('');

  // حقول رقم السند (افتراضي تلقائي وقابل للتعديل) والسند اليدوي
  const [voucherNumber, setVoucherNumber] = useState('');
  const [isVoucherNumberTouched, setIsVoucherNumberTouched] = useState(false);
  const [manualVoucherNo, setManualVoucherNo] = useState('');
  const [manualVoucherDate, setManualVoucherDate] = useState('');
  const [voucherSeq, setVoucherSeq] = useState(1);

  const fetchVoucherCount = useCallback(async () => {
    if (!store?.id) return;
    try {
      const { count, error } = await supabase
        .from(VOUCHERS_TABLE)
        .select('id', { count: 'exact', head: true })
        .eq('store_id', store.id)
        .eq('voucher_type', voucherType);

      if (!error && count != null) {
        setVoucherSeq(count + 1);
      }
    } catch (err) {
      console.warn('Failed to fetch voucher count:', err);
    }
  }, [store?.id, voucherType]);

  useEffect(() => {
    fetchVoucherCount();
  }, [fetchVoucherCount]);

  // رقم السند الافتراضي بصيغة: REC-YYYYMMDD-XXXX أو PAY-YYYYMMDD-XXXX
  const defaultVoucherNumber = useMemo(() => {
    const prefix = isPayment ? 'PAY' : 'REC';
    const dateClean = (date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    const seqStr = String(voucherSeq).padStart(4, '0');
    return `${prefix}-${dateClean}-${seqStr}`;
  }, [isPayment, date, voucherSeq]);

  // تحديث رقم السند بالقيمة المقترحة تلقائياً طالما لم يقم المستخدم بتعديله يدوياً
  useEffect(() => {
    if (!isVoucherNumberTouched) {
      setVoucherNumber(defaultVoucherNumber);
    }
  }, [defaultVoucherNumber, isVoucherNumberTouched]);

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

  // حساب مجموع الشيكات ومزامنته مع المبلغ عند اختيار شيكات
  const totalChecksAmount = useMemo(() => {
    return sanitizeCheckLinesForDb(checkRows).reduce((s, c) => s + c.amount, 0);
  }, [checkRows]);

  useEffect(() => {
    if (tenderType === 'checks') {
      setAmount(totalChecksAmount > 0 ? String(totalChecksAmount) : '');
    }
  }, [tenderType, totalChecksAmount]);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [toast, setToast] = useState(null);

  const [recentPayments, setRecentPayments] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [paymentFilter, setPaymentFilter] = useState(() => (isPayment ? 'payment' : 'receipt'));
  const [deletingPaymentId, setDeletingPaymentId] = useState(null);

  useEffect(() => {
    setPaymentFilter(isPayment ? 'payment' : 'receipt');
  }, [isPayment]);

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
      const contactsMap = new Map();
      suppliers.forEach((s) => contactsMap.set(String(s.id), s.name));
      customers.forEach((c) => contactsMap.set(String(c.id), c.name));

      // 1. Fetch from VOUCHERS_TABLE first
      const { data: vData, error: vError } = await supabase
        .from(VOUCHERS_TABLE)
        .select('*')
        .eq('store_id', store.id)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(30);

      if (!vError && Array.isArray(vData) && vData.length > 0) {
        setRecentPayments(
          vData.map((row) => {
            const contactId = row.account_id || row.supplier_contact_id || row.supplier_id;
            return {
              id: row.id,
              contactId,
              supplierName: contactsMap.get(String(contactId)) || '—',
              amount: row.amount,
              paid_at: row.date || row.created_at,
              notes: row.description,
              voucher_type: row.voucher_type || 'receipt',
              source: 'vouchers',
            };
          })
        );
        setPaymentsLoading(false);
        return;
      }

      // 2. Fallback to STORE_SUPPLIER_PAYMENTS_TABLE
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

      if (error && !vData) throw error;

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
            supplierName: joinedName || contactsMap.get(String(contactId)) || '—',
            voucher_type: row.voucher_type || 'payment',
            source: 'store_supplier_payments',
          };
        })
      );
    } catch (e) {
      console.error('[vouchers:list]', e);
      setRecentPayments([]);
    } finally {
      setPaymentsLoading(false);
    }
  }, [store?.id, suppliers, customers]);

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
    const vType = row.voucher_type || (isPayment ? 'payment' : 'receipt');
    setDeletingPaymentId(row.id);
    try {
      if (row.source === 'vouchers') {
        const { error: delErr } = await supabase
          .from(VOUCHERS_TABLE)
          .delete()
          .eq('id', row.id)
          .eq('store_id', store.id);
        if (delErr) throw delErr;
      } else {
        const { error: delErr } = await supabase
          .from(STORE_SUPPLIER_PAYMENTS_TABLE)
          .delete()
          .eq('id', row.id)
          .eq('store_id', store.id);
        if (delErr) throw delErr;
      }

      if (contactId && amount > 0) {
        const isCustomer = customers.some((c) => String(c.id) === String(contactId));
        if (isCustomer) {
          const reverseType = vType === 'payment' ? 'receipt' : 'payment';
          await applyCustomerOutstandingFromVoucher({
            storeId: store.id,
            customerContactId: contactId,
            voucherType: reverseType,
            amount,
          });
        } else {
          const reverseType = vType === 'payment' ? 'receipt' : 'payment';
          const bal = await applySupplierOutstandingFromVoucher({
            storeId: store.id,
            supplierContactId: contactId,
            voucherType: reverseType,
            amount,
          });
          if (!bal.ok && !bal.skipped) {
            console.warn('[vouchers:reverse]', bal.error);
          }
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
    setAmount('');
    setDescription('');
    setDate(new Date().toISOString().slice(0, 10));
    setSupplierId('');
    setCustomerId('');
    setIsVoucherNumberTouched(false);
    setVoucherNumber('');
    setManualVoucherNo('');
    setManualVoucherDate('');
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
    fetchVoucherCount();
  }, [fetchVoucherCount]);

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

    const finalVoucherNumber = voucherNumber.trim() || defaultVoucherNumber;

    const result = await handleInsert({
      storeId: store.id,
      supplierId: activePartyId,
      voucherType,
      amount: num,
      description,
      date,
      tender,
      voucherNumber: finalVoucherNumber,
      manualVoucherNo,
      manualVoucherDate,
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
          className={`relative overflow-hidden rounded-3xl border p-4 sm:p-6 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.45)] transition-colors ${
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
            className={`relative mx-auto max-w-6xl rounded-2xl border p-4 sm:p-6 backdrop-blur-2xl ${
              darkUi
                ? 'border-white/15 bg-white/5 shadow-inner shadow-white/5'
                : 'border-white/60 bg-white/40 shadow-lg'
            }`}
          >
            <div className="mb-6 flex items-start gap-3">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                  isPayment
                    ? darkUi
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : 'bg-rose-100 text-rose-600 border border-rose-200'
                    : darkUi
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-emerald-100 text-emerald-600 border border-emerald-200'
                }`}
              >
                {isPayment ? <ArrowUpRight size={24} /> : <ArrowDownLeft size={24} />}
              </div>
              <div>
                <h1
                  className={`text-xl font-black tracking-tight sm:text-2xl ${
                    darkUi ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  {isPayment ? 'سند صرف جديد' : 'سند قبض جديد'}
                </h1>
                <p className={`mt-1 text-sm ${darkUi ? 'text-slate-400' : 'text-slate-600'}`}>
                  {isPayment ? 'تسجيل سند صرف — مورد أو زبون.' : 'تسجيل سند قبض — مورد أو زبون.'}
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

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="rounded-3xl border border-slate-200/90 bg-white/95 p-6 sm:p-8 shadow-xl backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 space-y-6">

                {/* 1. الصف الأول: رقم السند (تلقائي) + تاريخ السند */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                  {/* رقم السند */}
                  <div>
                    <label className="block text-xs sm:text-sm font-black text-slate-700 dark:text-slate-300 mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Receipt size={16} className="text-violet-600 dark:text-violet-400" />
                        رقم السند
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950/80 dark:text-violet-300 font-bold">
                        {isVoucherNumberTouched ? 'معدّل يدوياً' : 'تلقائي (قابل للتعديل)'}
                      </span>
                    </label>
                    <input
                      type="text"
                      value={voucherNumber}
                      onChange={(e) => {
                        setVoucherNumber(e.target.value);
                        setIsVoucherNumberTouched(true);
                      }}
                      placeholder={defaultVoucherNumber}
                      className={getInputClass({ filled: Boolean(voucherNumber.trim()) })}
                      dir="ltr"
                      title="رقم السند (معبأ برقم مقترح تلقائياً ويمكن تعديله)"
                    />
                  </div>

                  {/* تاريخ السند */}
                  <div>
                    <label className="block text-xs sm:text-sm font-black text-slate-700 dark:text-slate-300 mb-2">
                      تاريخ السند <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(normalizeDigitsToLatin(e.target.value))}
                      className={getInputClass({ filled: Boolean(date), extra: 'font-currency' })}
                      dir="ltr"
                      lang="en"
                      required
                    />
                  </div>
                </div>

                {/* 2. الصف الثاني: سند يدوي + تاريخه */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                  {/* سند يدوي */}
                  <div>
                    <label className="block text-xs sm:text-sm font-black text-slate-700 dark:text-slate-300 mb-2 flex items-center justify-between">
                      <span>سند يدوي</span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500 font-normal">
                        (اختياري — ربط سند ورقي سابق)
                      </span>
                    </label>
                    <input
                      type="text"
                      value={manualVoucherNo}
                      onChange={(e) => setManualVoucherNo(e.target.value)}
                      placeholder="مثال: 1042 أو رقم الدفتر الورقي"
                      className={getInputClass({ filled: Boolean(manualVoucherNo.trim()) })}
                    />
                  </div>

                  {/* تاريخ السند اليدوي */}
                  <div>
                    <label className="block text-xs sm:text-sm font-black text-slate-700 dark:text-slate-300 mb-2 flex items-center justify-between">
                      <span>تاريخ السند اليدوي</span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500 font-normal">
                        (اختياري — لو الورقي بتاريخ سابق)
                      </span>
                    </label>
                    <input
                      type="date"
                      value={manualVoucherDate}
                      onChange={(e) => setManualVoucherDate(normalizeDigitsToLatin(e.target.value))}
                      className={getInputClass({ filled: Boolean(manualVoucherDate), extra: 'font-currency' })}
                      dir="ltr"
                      lang="en"
                    />
                  </div>
                </div>

                {/* 3. الصف الثالث: الطرف (المدفوع له / المقبوض منه) - عرض كامل */}
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <label className="text-xs sm:text-sm font-black text-slate-800 dark:text-slate-200 flex items-center gap-2">
                      <span className="text-indigo-600 dark:text-indigo-400">●</span>
                      <span>{isPayment ? 'المدفوع له' : 'المقبوض منه (المدفوع له)'}</span>
                      <span className="text-rose-500">*</span>
                    </label>

                    <div className="flex items-center gap-2">
                      {/* تبديل نوع الطرف: مورد / زبون */}
                      <div className="flex h-9 rounded-xl border border-slate-200 bg-slate-100/90 p-0.5 dark:border-slate-700 dark:bg-slate-800">
                        {[
                          { val: 'supplier', label: 'مورد', Icon: Truck },
                          { val: 'customer', label: 'زبون', Icon: Users },
                        ].map(({ val, label, Icon }) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => {
                              setPartyType(val);
                              setSupplierId('');
                              setCustomerId('');
                            }}
                            className={`flex items-center gap-1.5 px-3 rounded-lg text-xs font-black transition ${
                              partyType === val
                                ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-300'
                                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                            }`}
                          >
                            <Icon size={14} />
                            {label}
                          </button>
                        ))}
                      </div>

                      {/* زر إضافة مورد جديد عبر المودال الموحد */}
                      {partyType === 'supplier' && (
                        <button
                          type="button"
                          onClick={() => setSupplierModalOpen(true)}
                          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-300 text-xs font-black transition"
                        >
                          <Plus size={14} />
                          <span>مورد جديد</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="relative">
                    {partyType === 'supplier' ? (
                      <select
                        value={supplierId}
                        onChange={(e) => setSupplierId(e.target.value)}
                        disabled={suppliersLoading || !store?.id}
                        className={getInputClass({
                          filled: Boolean(supplierId),
                          extra: 'cursor-pointer pr-4 pl-10',
                        })}
                      >
                        <option value="">— اختر المورد المدفوع له —</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name || 'بدون اسم'} {s.phone ? `(${s.phone})` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <select
                        value={customerId}
                        onChange={(e) => setCustomerId(e.target.value)}
                        disabled={customersLoading || !store?.id}
                        className={getInputClass({
                          filled: Boolean(customerId),
                          extra: 'cursor-pointer pr-4 pl-10',
                        })}
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
                    )}
                    {(suppliersLoading || customersLoading) && (
                      <Loader2 className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 animate-spin text-indigo-500" />
                    )}
                  </div>
                </div>

                {/* 4. الصف الرابع: عملة السند + مبلغ السند */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                  {/* عملة السند */}
                  <div>
                    <label className="block text-xs sm:text-sm font-black text-slate-700 dark:text-slate-300 mb-2">
                      عملة السند
                    </label>
                    <select
                      value={currencyCode}
                      onChange={(e) => setCurrencyCode(e.target.value)}
                      className={getInputClass({
                        filled: true,
                        extra: 'cursor-pointer',
                      })}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} — {c.label} ({c.symbol})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* مبلغ السند */}
                  <div>
                    <label className="block text-xs sm:text-sm font-black text-slate-700 dark:text-slate-300 mb-2 flex items-center justify-between">
                      <span>
                        مبلغ السند ({currencySymbol(currencyCode)}) <span className="text-rose-500">*</span>
                      </span>
                      {parseMoneyInput(amount) > 0 && (
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                            isPayment
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          }`}
                        >
                          {isPayment ? 'صرف مالي' : 'قبض نقدي'}
                        </span>
                      )}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(normalizeDigitsToLatin(e.target.value))}
                      placeholder="0.00"
                      dir="ltr"
                      className={getInputClass({
                        isAmount: true,
                        isPayment,
                        amountVal: parseMoneyInput(amount),
                        filled: parseMoneyInput(amount) > 0,
                        extra: 'text-lg',
                      })}
                      disabled={tenderType === 'checks'}
                      title={tenderType === 'checks' ? 'يُحسب المبلغ تلقائياً من مجموع الشيكات' : ''}
                    />
                  </div>
                </div>

                {/* 5. الصف الخامس: طريقة الدفع */}
                <div>
                  <label className="block text-xs sm:text-sm font-black text-slate-700 dark:text-slate-300 mb-2">
                    طريقة الدفع
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {TENDER_TYPES.map((t) => {
                      const isSelected = tenderType === t.value;
                      const Icon = t.value === 'cash' ? Banknote : t.value === 'visa' ? CreditCard : Receipt;
                      return (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => setTenderType(t.value)}
                          className={`h-12 rounded-2xl flex items-center justify-center gap-2 text-sm sm:text-base font-black border-2 transition-all ${
                            isSelected
                              ? 'border-indigo-600 bg-indigo-50/80 text-indigo-700 shadow-sm dark:border-indigo-400 dark:bg-indigo-950/40 dark:text-indigo-200'
                              : 'border-slate-200 bg-slate-50/60 text-slate-600 hover:bg-slate-100 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:bg-slate-800'
                          }`}
                        >
                          <Icon size={18} />
                          <span>{t.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* فيزا: آخر 4 أرقام */}
                  {tenderType === 'visa' && (
                    <div className="mt-4 max-w-xs">
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">
                        آخر 4 أرقام من البطاقة
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
                        className={getInputClass({
                          filled: visaLast4Input.length === 4,
                          extra: 'text-center font-mono tracking-widest text-lg',
                        })}
                      />
                    </div>
                  )}
                </div>

                {/* 6. تفاصيل الشيكات (عند اختيار شيكات) */}
                {tenderType === 'checks' && (
                  <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-black text-slate-800 dark:text-slate-200">
                        تفاصيل الشيكات ({checkRows.length})
                      </label>
                      <button
                        type="button"
                        onClick={addCheckRow}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-black text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60 transition"
                      >
                        <Plus size={14} />
                        <span>إضافة شيك</span>
                      </button>
                    </div>

                    <div className="space-y-3">
                      {checkRows.map((row, idx) => (
                        <div
                          key={idx}
                          className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700/80 dark:bg-slate-800/40"
                        >
                          <div className="mb-2.5 flex items-center justify-between">
                            <span className="text-xs font-black text-indigo-700 dark:text-indigo-300">
                              شيك رقم {idx + 1}
                            </span>
                            {checkRows.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeCheckRow(idx)}
                                className="rounded-lg p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                                aria-label="حذف الشيك"
                                title="حذف هذا الشيك"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                            <div>
                              <label className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-400">
                                رقم الشيك
                              </label>
                              <input
                                type="text"
                                value={row.check_number}
                                onChange={(e) =>
                                  updateCheckRow(idx, 'check_number', normalizeDigitsToLatin(e.target.value))
                                }
                                dir="ltr"
                                placeholder="رقم الشيك"
                                className={getInputClass({
                                  filled: Boolean(row.check_number.trim()),
                                  extra: 'h-10 text-sm font-currency',
                                })}
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-400">
                                تاريخ الشيك
                              </label>
                              <input
                                type="date"
                                value={row.check_date}
                                onChange={(e) =>
                                  updateCheckRow(idx, 'check_date', normalizeDigitsToLatin(e.target.value))
                                }
                                dir="ltr"
                                className={getInputClass({
                                  filled: Boolean(row.check_date),
                                  extra: 'h-10 text-sm font-currency',
                                })}
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-400">
                                المبلغ ({currencySymbol(currencyCode)})
                              </label>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={row.amount}
                                onChange={(e) =>
                                  updateCheckRow(idx, 'amount', normalizeDigitsToLatin(e.target.value))
                                }
                                dir="ltr"
                                placeholder="0.00"
                                className={getInputClass({
                                  filled: parseMoneyInput(row.amount) > 0,
                                  extra: 'h-10 text-sm font-currency font-bold',
                                })}
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-400">
                                اسم البنك
                              </label>
                              <input
                                type="text"
                                value={row.bank_name}
                                onChange={(e) =>
                                  updateCheckRow(idx, 'bank_name', normalizeDigitsToLatin(e.target.value))
                                }
                                placeholder="مثال: بنك فلسطين"
                                className={getInputClass({
                                  filled: Boolean(row.bank_name.trim()),
                                  extra: 'h-10 text-sm',
                                })}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm font-bold text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800/60 dark:text-emerald-200">
                      <span>إجمالي مبالغ الشيكات:</span>
                      <span dir="ltr" className="font-currency font-black text-base">
                        {currencySymbol(currencyCode)} {totalChecksAmount.toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                {/* 7. الصف السابع: البيان / الوصف + زر الحفظ */}
                <div className="space-y-4 pt-4 border-t border-slate-200/80 dark:border-slate-800">
                  <div>
                    <label className="block text-xs sm:text-sm font-black text-slate-700 dark:text-slate-300 mb-2">
                      البيان / تفاصيل السند
                    </label>
                    <input
                      type="text"
                      value={description}
                      onChange={(e) => setDescription(normalizeDigitsToLatin(e.target.value))}
                      placeholder="تفاصيل السند، سبب الصرف/القبض، أو ملاحظات إضافية…"
                      className={getInputClass({ filled: Boolean(description.trim()) })}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting || storeLoading || !store?.id}
                    className={`w-full h-13 rounded-2xl text-base font-black text-white shadow-lg transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                      isPayment
                        ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
                        : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                    }`}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span>جاري حفظ السند…</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={20} />
                        <span>{isPayment ? 'اعتماد وحفظ سند الصرف' : 'اعتماد وحفظ سند القبض'}</span>
                      </>
                    )}
                  </button>
                </div>

              </div>
            </form>

            <div className="mt-8 pt-8 border-t border-white/10">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className={`text-sm font-black ${darkUi ? 'text-white' : 'text-slate-900'}`}>
                  {isPayment ? 'آخر 20 سند صرف' : 'آخر 20 سند قبض'}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: isPayment ? 'payment' : 'receipt', label: isPayment ? 'سندات الصرف' : 'سندات القبض' },
                    { id: 'all', label: 'عرض الكل' },
                    { id: isPayment ? 'receipt' : 'payment', label: isPayment ? 'سندات القبض' : 'سندات الصرف' },
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
                      <th className="text-right py-3 px-4 font-semibold">الطرف</th>
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
                            className={`py-3 px-4 text-xs font-black font-currency ${
                              row.voucher_type === 'payment'
                                ? darkUi ? 'text-rose-300' : 'text-rose-700'
                                : darkUi ? 'text-emerald-300' : 'text-emerald-700'
                            }`}
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

      {/* مودال إضافة مورد جديد */}
      <SupplierFormModal
        isOpen={supplierModalOpen}
        onClose={() => setSupplierModalOpen(false)}
        onSuccess={(newSupplier) => {
          setSuppliers((prev) => [newSupplier, ...prev.filter((s) => s.id !== newSupplier.id)]);
          setSupplierId(newSupplier.id);
          setSupplierModalOpen(false);
        }}
      />
    </DashboardLayout>
  );
}
