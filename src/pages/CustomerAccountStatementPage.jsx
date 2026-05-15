import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Eye,
  Loader2,
  FileText,
  Printer,
  UserCircle,
  Wallet,
  X,
  Receipt,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import PrintCustomerStatement from '../components/PrintCustomerStatement';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';

const CONTACTS_TABLE = 'store_contacts';
const LEDGER_TABLE = 'customer_ledger';
const SALES_TABLE = 'sales';
const VOUCHERS_TABLE = import.meta.env.VITE_SUPABASE_VOUCHERS_TABLE?.trim() || 'vouchers';

function formatDateLabel(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function isRelationMissing(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || '');
  const code = err.code;
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    /schema cache|could not find.*table|does not exist|customer_ledger/i.test(msg)
  );
}

/** مرجع سند في وصف سطر customer_ledger (يُدرج عند حفظ سند قبض/صرف) */
function extractVoucherIdFromLedgerDescription(desc) {
  if (!desc) return null;
  const m = String(desc).match(/\[voucher:([0-9a-f-]{36})\]/i);
  return m ? m[1] : null;
}

function ledgerVoucherIdsFromEntries(ledgerEntries) {
  const ids = new Set();
  for (const e of ledgerEntries || []) {
    const vid = extractVoucherIdFromLedgerDescription(e.description);
    if (vid) ids.add(String(vid));
  }
  return ids;
}

/** يمنع تكرار دفعة السند في الكشف إذا وُجدت مسبقاً في customer_ledger */
function filterVoucherMovementsNotInLedger(ledgerEntries, voucherMovements) {
  const ids = ledgerVoucherIdsFromEntries(ledgerEntries);
  if (!ids.size) return voucherMovements;
  return voucherMovements.filter((m) => !m.voucherId || !ids.has(String(m.voucherId)));
}

function buildRowsFromLedger(entries) {
  let bal = 0;
  const rows = [];
  for (const e of entries) {
    const d = Number(e.debit ?? 0);
    const c = Number(e.credit ?? 0);
    const voucherId = extractVoucherIdFromLedgerDescription(e.description);
    bal += d - c;
    rows.push({
      dateLabel: formatDateLabel(e.created_at),
      description:
        e.description?.trim() ||
        (d > 0 ? 'مدين — فاتورة / ذمة' : 'دائن — دفعة / تسديد'),
      ref: e.sale_id
        ? String(e.sale_id).slice(0, 8)
        : voucherId
          ? String(voucherId).slice(0, 8)
          : '—',
      /** معرّف الفاتورة الكامل لجلب التفاصيل من sales */
      saleId: e.sale_id ? String(e.sale_id) : null,
      voucherId: voucherId ? String(voucherId) : null,
      debit: d > 0 ? d : null,
      credit: c > 0 ? c : null,
      balance: bal,
    });
  }
  return { rows, closingBalance: bal };
}

function voucherCurrencySymbol(code) {
  if (code === 'JOD') return 'د.أ';
  if (code === 'USD') return '$';
  return '₪';
}

function parseCheckLines(v) {
  const raw = v?.check_lines;
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

/** وصف سطر كشف الحساب لسند قبض من الزبون */
function describeCustomerReceiptVoucher(v) {
  const tender = String(v.voucher_tender || 'cash').toLowerCase();
  const sym = voucherCurrencySymbol(v.currency_code || 'ILS');
  const parts = [`سند قبض (${sym}${Number(v.amount ?? 0).toFixed(2)})`];
  if (tender === 'cash') parts.push('كاش');
  else if (tender === 'visa')
    parts.push('فيزا' + (v.visa_last4 ? ` ****${String(v.visa_last4).slice(-4)}` : ''));
  else if (tender === 'checks' || tender === 'mixed') {
    const lines = parseCheckLines(v);
    parts.push(
      lines.length ? `شيكات — قيد التحصيل (${lines.length})` : 'شيكات'
    );
  }
  const extra = String(v.description || '').trim();
  if (extra) parts.push(extra);
  return parts.join(' — ');
}

function ledgerEntryToMovement(e) {
  const d = Number(e.debit ?? 0);
  const c = Number(e.credit ?? 0);
  const voucherId = extractVoucherIdFromLedgerDescription(e.description);
  return {
    date: e.created_at,
    debit: d,
    credit: c,
    description:
      e.description?.trim() ||
      (d > 0 ? 'مدين — فاتورة / ذمة' : 'دائن — دفعة / تسديد'),
    saleId: e.sale_id || null,
    voucherId: voucherId || null,
  };
}

function voucherReceiptToMovement(v) {
  const dateRaw = v.date || v.created_at;
  return {
    date: dateRaw,
    debit: 0,
    credit: Number(v.amount ?? 0) || 0,
    description: describeCustomerReceiptVoucher(v),
    saleId: null,
    voucherId: v.id,
  };
}

function saleRowToMovement(s, legacyLabel) {
  const amt = Number(s.total_amount ?? 0);
  if (amt <= 0) return null;
  return {
    date: s.created_at,
    debit: amt,
    credit: 0,
    description: legacyLabel
      ? 'فاتورة مبيعات (ذمة — مطابقة من نص الفاتورة / قديمة)'
      : 'فاتورة مبيعات (ذمة)',
    saleId: s.id,
    voucherId: null,
  };
}

/**
 * دمج حركات (دفتر + مبيعات + سندات قبض) وترتيبها زمنياً وحساب الرصيد الجاري.
 */
function computeMergedStatementRows(movements) {
  const sorted = [...movements].sort((a, b) => {
    const ta = new Date(a.date).getTime();
    const tb = new Date(b.date).getTime();
    if (ta !== tb) return ta - tb;
    const ka = `${a.saleId || ''}-${a.voucherId || ''}`;
    const kb = `${b.saleId || ''}-${b.voucherId || ''}`;
    return ka.localeCompare(kb);
  });
  let bal = 0;
  const rows = [];
  for (const m of sorted) {
    bal += m.debit - m.credit;
    rows.push({
      dateLabel: formatDateLabel(m.date),
      description: m.description,
      ref: m.saleId
        ? String(m.saleId).slice(0, 8)
        : m.voucherId
          ? String(m.voucherId).slice(0, 8)
          : '—',
      saleId: m.saleId ? String(m.saleId) : null,
      voucherId: m.voucherId ? String(m.voucherId) : null,
      debit: m.debit > 0 ? m.debit : null,
      credit: m.credit > 0 ? m.credit : null,
      balance: bal,
    });
  }
  return { rows, closingBalance: bal };
}

async function fetchReceiptVouchersForContact(supabaseClient, storeId, contactId) {
  try {
    const { data, error } = await supabaseClient
      .from(VOUCHERS_TABLE)
      .select('*')
      .eq('store_id', storeId)
      .eq('voucher_type', 'receipt')
      .order('date', { ascending: true });
    if (error) {
      console.warn('[customer-statement] vouchers', error);
      return [];
    }
    const cid = String(contactId);
    return (data || []).filter((v) => {
      const a = v.account_id != null ? String(v.account_id) : '';
      const s = v.supplier_contact_id != null ? String(v.supplier_contact_id) : '';
      const u = v.supplier_id != null ? String(v.supplier_id) : '';
      return a === cid || s === cid || u === cid;
    });
  } catch (e) {
    console.warn(e);
    return [];
  }
}

function isColumnMissing(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || '');
  return err.code === '42703' || (/column/i.test(msg) && /does not exist/i.test(msg));
}

/**
 * فاتورة ذمة: payment_mode = credit، أو نص يدل على ذمة في notes،
 * أو مرتبطة بزبون ولم تُعلَّم ككاش صراحة (فواتير قديمة بلا عمود payment_mode).
 */
function isCreditSaleRow(s) {
  const pm = String(s.payment_mode ?? '').toLowerCase();
  if (pm === 'cash') return false;
  if (pm === 'credit') return true;
  const n = String(s.notes || '');
  if (/ذمة|دين|آجل|credit|بالذمة/i.test(n)) return true;
  if (s.contact_id && pm !== 'cash') return true;
  return false;
}

function buildRowsFromSales(sales, opts = {}) {
  const { looseCredit = false, legacyLabel = false } = opts;
  let bal = 0;
  const rows = [];
  for (const s of sales) {
    const amt = Number(s.total_amount ?? 0);
    if (amt <= 0) continue;
    const pm = String(s.payment_mode ?? '').toLowerCase();
    const creditOk =
      isCreditSaleRow(s) ||
      (looseCredit && pm !== 'cash');
    if (!creditOk) continue;
    bal += amt;
    rows.push({
      dateLabel: formatDateLabel(s.created_at),
      description: legacyLabel
        ? 'فاتورة مبيعات (ذمة — مطابقة من نص الفاتورة / قديمة)'
        : 'فاتورة مبيعات (ذمة)',
      ref: String(s.id).slice(0, 8),
      saleId: String(s.id),
      voucherId: null,
      debit: amt,
      credit: null,
      balance: bal,
    });
  }
  return { rows, closingBalance: bal };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * جلب مبيعات الزبون: أولاً بـ contact_id، وإن لم تُحسب ذمة → مطابقة اسم/هاتف في notes (فواتير قديمة).
 */
async function fetchSalesForCustomerStatement(supabaseClient, storeId, contactId, contactName, contactPhone) {
  const baseSelectFull =
    'id, created_at, total_amount, payment_mode, contact_id, notes';
  const baseSelectNoNotes = 'id, created_at, total_amount, payment_mode, contact_id';

  let d1;
  let e1;
  let res = await supabaseClient
    .from(SALES_TABLE)
    .select(baseSelectFull)
    .eq('store_id', storeId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true });
  d1 = res.data;
  e1 = res.error;
  if (e1 && isColumnMissing(e1)) {
    res = await supabaseClient
      .from(SALES_TABLE)
      .select(baseSelectNoNotes)
      .eq('store_id', storeId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true });
    d1 = res.data;
    e1 = res.error;
  }
  if (e1) throw e1;

  if (d1?.length) {
    const trial = buildRowsFromSales(d1);
    if (trial.rows.length > 0) {
      return { rows: d1, source: 'contact_id' };
    }
  }

  let wide;
  let e2;
  res = await supabaseClient
    .from(SALES_TABLE)
    .select(baseSelectFull)
    .eq('store_id', storeId)
    .order('created_at', { ascending: true });
  wide = res.data;
  e2 = res.error;
  if (e2 && isColumnMissing(e2)) {
    res = await supabaseClient
      .from(SALES_TABLE)
      .select(baseSelectNoNotes)
      .eq('store_id', storeId)
      .order('created_at', { ascending: true });
    wide = res.data;
    e2 = res.error;
  }
  if (e2) throw e2;

  const namePart = String(contactName || '').trim();
  const phoneNorm = String(contactPhone || '').replace(/\s/g, '').trim();

  const matched = (wide || []).filter((s) => {
    if (s.contact_id && String(s.contact_id) === String(contactId)) return true;
    const notes = String(s.notes || '');
    if (namePart.length >= 2 && notes.includes(namePart)) return true;
    if (phoneNorm.length >= 6 && notes.replace(/\s/g, '').includes(phoneNorm)) return true;
    try {
      if (namePart && new RegExp(`الزبون:\\s*${escapeRegExp(namePart)}`, 'i').test(notes)) return true;
    } catch {
      /* ignore */
    }
    return false;
  });

  return {
    rows: matched,
    source: matched.length ? 'notes_or_legacy' : 'empty',
  };
}

function parseSaleLineItems(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

async function fetchSaleDetailForStatement(supabaseClient, storeId, saleId) {
  const baseSelect =
    'id, created_at, total_amount, payment_mode, notes, line_items, contact_id, returned_at, return_note, pos_tender';
  let { data, error } = await supabaseClient
    .from(SALES_TABLE)
    .select(baseSelect)
    .eq('store_id', storeId)
    .eq('id', saleId)
    .maybeSingle();
  if (error && /pos_tender|column|schema|PGRST204/i.test(String(error.message || ''))) {
    ({ data, error } = await supabaseClient
      .from(SALES_TABLE)
      .select('id, created_at, total_amount, payment_mode, notes, line_items, contact_id, returned_at, return_note')
      .eq('store_id', storeId)
      .eq('id', saleId)
      .maybeSingle());
  }
  if (error) throw error;
  return data;
}

export default function CustomerAccountStatementPage() {
  const { store, loading: storeLoading } = useStore();
  const [customers, setCustomers] = useState([]);
  const [contactId, setContactId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [error, setError] = useState(null);

  const [selectedContact, setSelectedContact] = useState(null);
  const [ledgerRows, setLedgerRows] = useState([]);
  const [closingBalance, setClosingBalance] = useState(0);
  const [dataSourceNote, setDataSourceNote] = useState('');

  const [statementPrintPayload, setStatementPrintPayload] = useState(null);

  const [openingModalOpen, setOpeningModalOpen] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('');
  const [openingDescription, setOpeningDescription] = useState('رصيد مرحّل — مطابقة رصيد الدليل');
  const [openingSaving, setOpeningSaving] = useState(false);
  const [openingError, setOpeningError] = useState(null);
  const [openingConfirm, setOpeningConfirm] = useState(false);

  /** نافذة تفاصيل فاتورة مرتبطة بـ sale_id */
  const [invoiceModal, setInvoiceModal] = useState({
    open: false,
    loading: false,
    sale: null,
    error: null,
  });

  const openInvoiceDetail = async (saleId) => {
    if (!store?.id || !saleId) return;
    setInvoiceModal({ open: true, loading: true, sale: null, error: null });
    try {
      const data = await fetchSaleDetailForStatement(supabase, store.id, saleId);
      if (!data?.id) {
        setInvoiceModal({
          open: true,
          loading: false,
          sale: null,
          error: 'تعذّر العثور على الفاتورة.',
        });
        return;
      }
      setInvoiceModal({ open: true, loading: false, sale: data, error: null });
    } catch (e) {
      console.error(e);
      setInvoiceModal({
        open: true,
        loading: false,
        sale: null,
        error: e.message || 'فشل تحميل تفاصيل الفاتورة',
      });
    }
  };

  const closeInvoiceModal = () => {
    setInvoiceModal({ open: false, loading: false, sale: null, error: null });
  };

  const [voucherModal, setVoucherModal] = useState({
    open: false,
    loading: false,
    voucher: null,
    error: null,
  });

  const openVoucherDetail = async (voucherId) => {
    if (!store?.id || !voucherId) return;
    setVoucherModal({ open: true, loading: true, voucher: null, error: null });
    try {
      const { data, error: qErr } = await supabase
        .from(VOUCHERS_TABLE)
        .select('*')
        .eq('id', voucherId)
        .eq('store_id', store.id)
        .maybeSingle();
      if (qErr) throw qErr;
      if (!data?.id) {
        setVoucherModal({
          open: true,
          loading: false,
          voucher: null,
          error: 'تعذّر العثور على السند.',
        });
        return;
      }
      setVoucherModal({ open: true, loading: false, voucher: data, error: null });
    } catch (e) {
      console.error(e);
      setVoucherModal({
        open: true,
        loading: false,
        voucher: null,
        error: e.message || 'فشل تحميل السند',
      });
    }
  };

  const closeVoucherModal = () => {
    setVoucherModal({ open: false, loading: false, voucher: null, error: null });
  };

  const fetchCustomers = useCallback(async () => {
    if (!store?.id) {
      setCustomers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from(CONTACTS_TABLE)
        .select('id, name, phone, outstanding_amount, payment_type')
        .eq('store_id', store.id)
        .eq('role', 'customer')
        .order('name', { ascending: true });
      if (qErr) throw qErr;
      setCustomers(data || []);
    } catch (e) {
      console.error(e);
      setError(e.message || 'تعذّر تحميل الزبائن');
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    fetchCustomers();
  }, [storeLoading, fetchCustomers]);

  const loadLedger = useCallback(async () => {
    if (!store?.id || !contactId) {
      setSelectedContact(null);
      setLedgerRows([]);
      setClosingBalance(0);
      setDataSourceNote('');
      return;
    }
    setLoadingLedger(true);
    setError(null);
    try {
      const { data: contactRow } = await supabase
        .from(CONTACTS_TABLE)
        .select('id, name, phone, outstanding_amount, payment_type')
        .eq('id', contactId)
        .eq('store_id', store.id)
        .maybeSingle();
      setSelectedContact(contactRow || null);

      const receiptVouchers = await fetchReceiptVouchersForContact(supabase, store.id, contactId);
      const voucherMovements = receiptVouchers.map(voucherReceiptToMovement);

      const { data: ledgerData, error: ledgerErr } = await supabase
        .from(LEDGER_TABLE)
        .select('id, created_at, debit, credit, description, sale_id')
        .eq('store_id', store.id)
        .eq('customer_id', contactId)
        .order('created_at', { ascending: true });

      if (ledgerErr) {
        if (isRelationMissing(ledgerErr)) {
          console.warn('[customer-statement] customer_ledger غير متاح — عرض مبيعات ذمة من sales', ledgerErr);
          const { rows: salesRows, source } = await fetchSalesForCustomerStatement(
            supabase,
            store.id,
            contactId,
            contactRow?.name,
            contactRow?.phone
          );
          const loose = source === 'notes_or_legacy';
          const movements = [];
          for (const s of salesRows) {
            const pm = String(s.payment_mode ?? '').toLowerCase();
            const creditOk = isCreditSaleRow(s) || (loose && pm !== 'cash');
            if (!creditOk) continue;
            const mv = saleRowToMovement(s, loose);
            if (mv) movements.push(mv);
          }
          movements.push(...voucherMovements);
          const built = computeMergedStatementRows(movements);
          setLedgerRows(built.rows);
          setClosingBalance(built.closingBalance);
          const noteSales =
            source === 'notes_or_legacy'
              ? 'يُعرض من فواتير المبيعات (مطابقة اسم/هاتف في نص الفاتورة لأن contact_id أو payment_mode غير موثوق). نفّذ supabase/customer_ledger.sql لسجل أدق.'
              : 'يُعرض من فواتير المبيعات (جدول customer_ledger غير منشأ أو غير متاح). نفّذ ملف supabase/customer_ledger.sql لاحقاً لسجل حركات أدق.';
          const hasSalesMov = movements.some((m) => m.saleId);
          const hasVoucherMov = voucherMovements.length > 0;
          let combinedNote = '';
          if (hasSalesMov) combinedNote = noteSales;
          if (hasVoucherMov)
            combinedNote += (combinedNote ? ' ' : '') + 'سندات القبض من جدول vouchers مُدمجة كدفعات دائنة.';
          if (built.rows.length && !combinedNote) combinedNote = 'سندات قبض من جدول vouchers.';
          setDataSourceNote(
            built.rows.length
              ? combinedNote
              : hasVoucherMov
                ? 'سندات قبض فقط (من vouchers) — لا توجد فواتير ذمة مرتبطة في sales بهذا الشكل.'
                : 'لا توجد فواتير ذمة مرتبطة بهذا الزبون في sales رغم وجود رصيد في الدليل — راجع أعمدة contact_id وpayment_mode في قاعدة البيانات.'
          );
          return;
        }
        throw ledgerErr;
      }

      if (ledgerData?.length) {
        const voucherExtra = filterVoucherMovementsNotInLedger(ledgerData, voucherMovements);
        const movements = ledgerData.map(ledgerEntryToMovement);
        movements.push(...voucherExtra);
        const built = computeMergedStatementRows(movements);
        setLedgerRows(built.rows);
        setClosingBalance(built.closingBalance);
        setDataSourceNote(
          voucherExtra.length
            ? 'يُعرض من جدول customer_ledger + سندات قبض من vouchers غير مكرّرة في الدفتر (قديمة).'
            : 'يُعرض من جدول customer_ledger (مدين / دائن) — بما فيها سندات القبض المسجّلة كدائن.'
        );
        return;
      }

      const { rows: salesRows, source } = await fetchSalesForCustomerStatement(
        supabase,
        store.id,
        contactId,
        contactRow?.name,
        contactRow?.phone
      );
      const loose = source === 'notes_or_legacy';
      const voucherExtra = filterVoucherMovementsNotInLedger(ledgerData || [], voucherMovements);
      const movements = [];
      for (const s of salesRows) {
        const pm = String(s.payment_mode ?? '').toLowerCase();
        const creditOk = isCreditSaleRow(s) || (loose && pm !== 'cash');
        if (!creditOk) continue;
        const mv = saleRowToMovement(s, loose);
        if (mv) movements.push(mv);
      }
      movements.push(...voucherExtra);
      const built = computeMergedStatementRows(movements);
      setLedgerRows(built.rows);
      setClosingBalance(built.closingBalance);
      if (built.rows.length) {
        setDataSourceNote(
          `${source === 'notes_or_legacy'
            ? 'لا توجد حركات في customer_ledger — عُثر على فواتير عبر مطابقة النص (قديمة). يُفضّل تنفيذ customer_ledger.sql.'
            : 'لا توجد حركات في customer_ledger — يُعرض من فواتير المبيعات بالذمة (sales)'
          }${voucherExtra.length ? ' + سندات القبض (vouchers).' : ' فقط.'}`
        );
      } else {
        setDataSourceNote(
          voucherExtra.length
            ? 'سندات قبض فقط من vouchers — لا توجد حركات في sales أو customer_ledger لهذا الزبون.'
            : 'لا توجد حركات مسجّلة لهذا الزبون في sales أو customer_ledger. إن ظهر رصيد في الدليل فالفواتير قد تكون بلا contact_id — راجع الجدول في Supabase.'
        );
      }
    } catch (e) {
      console.error(e);
      setError(e.message || 'تعذّر تحميل كشف الحساب');
      setLedgerRows([]);
      setClosingBalance(0);
      setDataSourceNote('');
    } finally {
      setLoadingLedger(false);
    }
  }, [store?.id, contactId]);

  useEffect(() => {
    loadLedger();
  }, [loadLedger]);

  const totals = useMemo(() => {
    const totalDebit = ledgerRows.reduce((s, r) => s + (r.debit != null ? Number(r.debit) : 0), 0);
    const totalCredit = ledgerRows.reduce((s, r) => s + (r.credit != null ? Number(r.credit) : 0), 0);
    return { totalDebit, totalCredit, balance: totalDebit - totalCredit };
  }, [ledgerRows]);

  /** فرق بين رصيد الدليل (store_contacts) وبين مجموع الحركات المعروضة */
  const balanceMismatch = useMemo(() => {
    if (!contactId || loadingLedger || !selectedContact) return null;
    const dir = Number(selectedContact.outstanding_amount ?? 0);
    const calc = totals.balance;
    const diff = Math.abs(dir - calc);
    if (diff < 0.02) return null;
    return { directory: dir, fromMovements: calc, diff };
  }, [contactId, loadingLedger, selectedContact, totals.balance]);

  /** زر رصيد افتتاحي: لا حركات معروضة مع رصيد في الدليل (تجنّب التكرار عند وجود صفوف) */
  const showOpeningBalanceBtn = useMemo(() => {
    if (!contactId || loadingLedger || !selectedContact) return false;
    if (ledgerRows.length > 0) return false;
    return Number(selectedContact.outstanding_amount ?? 0) > 0.02;
  }, [contactId, loadingLedger, selectedContact, ledgerRows.length]);

  const openOpeningModal = () => {
    const o = Number(selectedContact?.outstanding_amount ?? 0);
    setOpeningAmount(o > 0 ? o.toFixed(2) : '');
    setOpeningDescription('رصيد مرحّل — مطابقة رصيد الدليل');
    setOpeningConfirm(false);
    setOpeningError(null);
    setOpeningModalOpen(true);
  };

  const handleSaveOpeningBalance = async (e) => {
    e.preventDefault();
    if (!store?.id || !contactId) return;
    if (!openingConfirm) {
      setOpeningError('يرجى تأكيد الإدراج.');
      return;
    }
    const amt = Math.max(0, parseFloat(String(openingAmount).replace(',', '.')) || 0);
    if (amt <= 0) {
      setOpeningError('أدخل مبلغاً أكبر من صفر.');
      return;
    }
    setOpeningSaving(true);
    setOpeningError(null);
    try {
      const { error } = await supabase.from(LEDGER_TABLE).insert([
        {
          store_id: store.id,
          customer_id: contactId,
          sale_id: null,
          debit: amt,
          credit: 0,
          description: openingDescription.trim() || 'رصيد مرحّل',
        },
      ]);
      if (error) throw error;
      setOpeningModalOpen(false);
      await loadLedger();
    } catch (err) {
      console.error(err);
      setOpeningError(err.message || 'فشل الحفظ — تأكد من تنفيذ customer_ledger.sql');
    } finally {
      setOpeningSaving(false);
    }
  };

  const printPayload = useMemo(
    () => ({
      storeName: store?.name,
      customerName: selectedContact?.name,
      customerPhone: selectedContact?.phone,
      rows: ledgerRows,
      closingBalance,
      printedAtLabel: new Date().toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    }),
    [store?.name, selectedContact, ledgerRows, closingBalance]
  );

  useEffect(() => {
    if (!statementPrintPayload) return;
    document.body.classList.add('print-invoice-active');
    const prevTitle = document.title;
    document.title = `كشف حساب — ${statementPrintPayload.customerName || 'زبون'}`;
    const t = requestAnimationFrame(() => window.print());
    const onAfterPrint = () => {
      document.title = prevTitle;
      document.body.classList.remove('print-invoice-active');
      setStatementPrintPayload(null);
    };
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener('afterprint', onAfterPrint);
      document.body.classList.remove('print-invoice-active');
      document.title = prevTitle;
    };
  }, [statementPrintPayload]);

  const openStatementPrint = () => {
    if (!contactId || ledgerRows.length === 0) return;
    setStatementPrintPayload({
      ...printPayload,
      rows: [...ledgerRows],
      printedAtLabel: new Date().toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    });
  };

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
            to="/customers"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <UserCircle size={18} />
            دليل الزبائن
          </Link>
          {showOpeningBalanceBtn && (
            <button
              type="button"
              onClick={openOpeningModal}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-black text-amber-950 hover:bg-amber-100 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/45"
            >
              <Wallet size={18} />
              رصيد افتتاحي
            </button>
          )}
          <button
            type="button"
            onClick={openStatementPrint}
            disabled={!contactId || ledgerRows.length === 0 || loadingLedger}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-black hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed dark:shadow-lg dark:shadow-indigo-950/40"
          >
            <Printer size={18} />
            طباعة الكشف
          </button>
        </div>
      }
    >
      <div className="max-w-5xl mx-auto space-y-6" dir="rtl">
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm dark:border-gray-700/50 dark:bg-gray-900/70 dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.35)]">
          <div className="flex flex-wrap items-start gap-4 justify-between">
            <div>
              <h1 className="font-title text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                <FileText className="text-indigo-600 dark:text-indigo-400 shrink-0" size={28} />
                كشف حساب زبون
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 font-bold mt-2 leading-relaxed">
                الرصيد = إجمالي المدين (فواتير ذمة) − إجمالي الدائن (دفعات). اختر زبوناً من دليل المتجر.
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-black text-slate-600 dark:text-slate-300 mb-2">الزبون</label>
              <select
                value={contactId}
                disabled={loading}
                onChange={(e) => setContactId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900 disabled:opacity-60 dark:border-white/10 dark:bg-slate-800/80 dark:text-slate-100"
              >
                <option value="">— اختر زبوناً —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone || c.id}
                  </option>
                ))}
              </select>
            </div>
            {selectedContact?.outstanding_amount != null && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/80 px-4 py-3 flex flex-col justify-center dark:border-indigo-800/40 dark:bg-indigo-950/40">
                <span className="text-[10px] font-black text-indigo-700 dark:text-indigo-300 uppercase">رصيد مسجّل في الدليل</span>
                <span className="text-lg font-black font-currency text-indigo-900 dark:text-indigo-100" dir="ltr">
                  ₪{Number(selectedContact.outstanding_amount ?? 0).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {error && (
            <p className="mt-4 text-sm font-bold text-rose-600 dark:text-rose-100 rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/40 px-4 py-3">
              {error}
            </p>
          )}
          {dataSourceNote && !error && (
            <p className="mt-4 text-xs font-bold text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-white/10 rounded-xl px-4 py-2">
              {dataSourceNote}
              {ledgerRows.some((r) => r.saleId || r.voucherId) ? (
                <span className="block mt-2 text-indigo-700 dark:text-indigo-300">
                  للحركات المرتبطة بفاتورة: زر «عرض». لسند قبض (دفعة/شيك/فيزا): زر «سند» — تفاصيل طريقة الدفع والشيكات إن وُجدت.
                </span>
              ) : null}
            </p>
          )}
          {balanceMismatch && !error && (
            <div
              className="mt-4 flex gap-3 rounded-xl border border-amber-300/80 bg-amber-50/95 px-4 py-3 text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/35 dark:text-amber-100"
              role="status"
            >
              <AlertTriangle className="shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" size={20} />
              <div className="text-sm font-bold leading-relaxed space-y-1">
                <p>تنبيه: رصيد الدليل لا يطابق مجموع الحركات المعروضة.</p>
                <p className="text-xs font-bold text-amber-900/90 dark:text-amber-200/90">
                  رصيد مسجّل في الدليل:{' '}
                  <span className="font-currency" dir="ltr">
                    ₪{balanceMismatch.directory.toFixed(2)}
                  </span>
                  {' — '}
                  مجموع الحركات (مدين − دائن):{' '}
                  <span className="font-currency" dir="ltr">
                    ₪{balanceMismatch.fromMovements.toFixed(2)}
                  </span>
                  {' — '}
                  الفرق:{' '}
                  <span className="font-currency" dir="ltr">
                    ₪{balanceMismatch.diff.toFixed(2)}
                  </span>
                </p>
                <p className="text-[11px] font-bold text-amber-800/85 dark:text-amber-200/80 pt-1">
                  السبب الشائع: فواتير قديمة بلا <code className="px-1 rounded bg-amber-100/80 dark:bg-amber-900/50">contact_id</code> أو بلا{' '}
                  <code className="px-1 rounded bg-amber-100/80 dark:bg-amber-900/50">payment_mode= credit</code>، أو عدم تنفيذ جدول{' '}
                  <code className="px-1 rounded bg-amber-100/80 dark:bg-amber-900/50">customer_ledger</code>. بعد ربط الفواتير أو تشغيل
                  السكربت، يجب أن يقترب الرصيدان.
                </p>
              </div>
            </div>
          )}
        </div>

        {contactId && (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-gray-700/50 dark:bg-gray-900/70 dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.35)]">
            {loadingLedger ? (
              <div className="flex justify-center py-16">
                <Loader2 className="animate-spin text-indigo-500 dark:text-indigo-400" size={36} />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 dark:border-emerald-800/40 dark:bg-emerald-950/40">
                    <p className="text-[10px] font-black text-emerald-800 dark:text-emerald-300">مجموع المدين (فواتير)</p>
                    <p className="text-xl font-black font-currency text-emerald-900 dark:text-emerald-200" dir="ltr">
                      ₪{totals.totalDebit.toFixed(2)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-rose-100 bg-rose-50/70 px-4 py-3 dark:border-rose-800/40 dark:bg-rose-950/40">
                    <p className="text-[10px] font-black text-rose-800 dark:text-rose-300">مجموع الدائن (دفعات)</p>
                    <p className="text-xl font-black font-currency text-rose-900 dark:text-rose-200" dir="ltr">
                      ₪{totals.totalCredit.toFixed(2)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/80 px-4 py-3 dark:border-indigo-800/40 dark:bg-indigo-950/40">
                    <p className="text-[10px] font-black text-indigo-800 dark:text-indigo-300">الرصيد (مدين − دائن)</p>
                    <p className="text-xl font-black font-currency text-indigo-950 dark:text-indigo-100" dir="ltr">
                      ₪{totals.balance.toFixed(2)}
                    </p>
                  </div>
                </div>

                {ledgerRows.length === 0 ? (
                  <div className="text-center py-12 space-y-4">
                    <p className="text-slate-500 dark:text-slate-400 font-bold">لا توجد حركات لهذا الزبون.</p>
                    {showOpeningBalanceBtn && (
                      <button
                        type="button"
                        onClick={openOpeningModal}
                        className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-black text-indigo-900 hover:bg-indigo-100 dark:border-indigo-700/50 dark:bg-indigo-950/40 dark:text-indigo-100 dark:hover:bg-indigo-900/50"
                      >
                        <Wallet size={18} />
                        تسجيل رصيد افتتاحي في الدفتر
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
                    <table className="w-full text-sm text-right">
                      <thead>
                        <tr className="bg-slate-900 text-white dark:bg-slate-950">
                          <th className="p-3 w-10">#</th>
                          <th className="p-3">التاريخ</th>
                          <th className="p-3">البيان</th>
                          <th className="p-3">المرجع</th>
                          <th className="p-3 w-[88px] text-center">تفاصيل</th>
                          <th className="p-3 text-center">مدين</th>
                          <th className="p-3 text-center">دائن</th>
                          <th className="p-3 text-center">رصيد</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerRows.map((r, i) => (
                          <tr
                            key={`${i}-${r.saleId || ''}-${r.voucherId || 'row'}`}
                            className="border-b border-slate-100 odd:bg-white even:bg-slate-50/60 dark:border-slate-700/50 dark:odd:bg-slate-800/30 dark:even:bg-slate-800/50"
                          >
                            <td className="p-2.5 text-center font-currency text-slate-500 dark:text-slate-400">{i + 1}</td>
                            <td className="p-2.5 font-currency dark:text-slate-200" dir="ltr">
                              {r.dateLabel}
                            </td>
                            <td className="p-2.5 font-bold dark:text-slate-100">{r.description}</td>
                            <td className="p-2.5 font-currency dark:text-slate-300" dir="ltr">
                              {r.ref}
                            </td>
                            <td className="p-2.5 text-center align-middle">
                              {r.saleId ? (
                                <button
                                  type="button"
                                  onClick={() => openInvoiceDetail(r.saleId)}
                                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-[11px] font-black text-indigo-900 hover:bg-indigo-100 dark:border-indigo-800/50 dark:bg-indigo-950/40 dark:text-indigo-100 dark:hover:bg-indigo-900/50"
                                  title="عرض أصناف الفاتورة والملاحظات"
                                >
                                  <Eye size={14} className="shrink-0" />
                                  عرض
                                </button>
                              ) : r.voucherId ? (
                                <button
                                  type="button"
                                  onClick={() => openVoucherDetail(r.voucherId)}
                                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-black text-amber-950 hover:bg-amber-100 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/45"
                                  title="تفاصيل سند القبض وطريقة الدفع والشيكات"
                                >
                                  <Receipt size={14} className="shrink-0" />
                                  سند
                                </button>
                              ) : (
                                <span className="text-slate-400 dark:text-slate-600 text-xs">—</span>
                              )}
                            </td>
                            <td className="p-2.5 text-center font-currency text-emerald-800 font-bold dark:text-emerald-300" dir="ltr">
                              {r.debit != null ? `₪${Number(r.debit).toFixed(2)}` : '—'}
                            </td>
                            <td className="p-2.5 text-center font-currency text-rose-700 font-bold dark:text-rose-300" dir="ltr">
                              {r.credit != null ? `₪${Number(r.credit).toFixed(2)}` : '—'}
                            </td>
                            <td className="p-2.5 text-center font-black font-currency dark:text-white" dir="ltr">
                              ₪{Number(r.balance ?? 0).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {typeof document !== 'undefined' &&
        createPortal(
          statementPrintPayload ? (
            <div
              id="print-invoice-mount"
              className="fixed inset-0 z-[9999] overflow-y-auto bg-white print:static print:inset-auto print:z-auto"
            >
              <PrintCustomerStatement data={statementPrintPayload} />
            </div>
          ) : null,
          document.body
        )}

      {typeof document !== 'undefined' &&
        createPortal(
          openingModalOpen ? (
            <div
              className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
              dir="rtl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="opening-balance-title"
              onClick={(ev) => {
                if (ev.target === ev.currentTarget && !openingSaving) setOpeningModalOpen(false);
              }}
            >
              <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-gray-900">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <h2 id="opening-balance-title" className="text-lg font-black text-slate-900 dark:text-white">
                    تسجيل رصيد افتتاحي
                  </h2>
                  <button
                    type="button"
                    onClick={() => !openingSaving && setOpeningModalOpen(false)}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
                    aria-label="إغلاق"
                  >
                    <X size={22} />
                  </button>
                </div>
                <p className="text-xs font-bold text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                  يُسجَّل سطراً مديناً في <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">customer_ledger</code> لمطابقة رصيد
                  الدليل عندما لا توجد حركات معروضة بعد.
                </p>
                <form onSubmit={handleSaveOpeningBalance} className="space-y-4">
                  <div>
                    <label className="block text-xs font-black text-slate-600 dark:text-slate-300 mb-1.5">المبلغ (مدين)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={openingAmount}
                      onChange={(e) => setOpeningAmount(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold font-currency text-slate-900 dark:border-white/10 dark:bg-slate-800 dark:text-slate-100"
                      dir="ltr"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-slate-600 dark:text-slate-300 mb-1.5">البيان</label>
                    <textarea
                      value={openingDescription}
                      onChange={(e) => setOpeningDescription(e.target.value)}
                      rows={2}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-900 resize-y min-h-[3rem] dark:border-white/10 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={openingConfirm}
                      onChange={(e) => setOpeningConfirm(e.target.checked)}
                      className="mt-1 rounded border-slate-300 dark:border-slate-600"
                    />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 leading-relaxed">
                      أؤكد أن هذه حركة محاسبية تُسجّل في الدفتر ولن أكررها يدوياً بنفس المبلغ.
                    </span>
                  </label>
                  {openingError && (
                    <p className="text-sm font-bold text-rose-600 dark:text-rose-100 rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/40 px-3 py-2">
                      {openingError}
                    </p>
                  )}
                  <div className="flex flex-wrap justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => !openingSaving && setOpeningModalOpen(false)}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                    >
                      إلغاء
                    </button>
                    <button
                      type="submit"
                      disabled={openingSaving}
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-black hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {openingSaving ? <Loader2 className="animate-spin" size={18} /> : <Wallet size={18} />}
                      حفظ
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null,
          document.body
        )}

      {typeof document !== 'undefined' &&
        createPortal(
          invoiceModal.open ? (
            <div
              className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-sm"
              dir="rtl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="invoice-detail-title"
              onClick={(ev) => {
                if (ev.target === ev.currentTarget && !invoiceModal.loading) closeInvoiceModal();
              }}
            >
              <div
                className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-gray-900"
                onClick={(ev) => ev.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <h2 id="invoice-detail-title" className="text-lg font-black text-slate-900 dark:text-white">
                    تفاصيل الفاتورة
                  </h2>
                  <button
                    type="button"
                    onClick={() => !invoiceModal.loading && closeInvoiceModal()}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10"
                    aria-label="إغلاق"
                  >
                    <X size={22} />
                  </button>
                </div>
                {invoiceModal.loading ? (
                  <div className="flex justify-center py-16">
                    <Loader2 className="animate-spin text-indigo-500 dark:text-indigo-400" size={36} />
                  </div>
                ) : invoiceModal.error ? (
                  <p className="text-sm font-bold text-rose-600 dark:text-rose-100 py-4">{invoiceModal.error}</p>
                ) : invoiceModal.sale ? (
                  <div className="space-y-4">
                    <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 break-all" dir="ltr">
                      معرّف: {invoiceModal.sale.id}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-white/10 dark:bg-slate-800/50">
                        <p className="text-[10px] font-black text-slate-500 dark:text-slate-400">التاريخ</p>
                        <p className="font-bold font-currency text-slate-900 dark:text-slate-100" dir="ltr">
                          {invoiceModal.sale.created_at
                            ? new Date(invoiceModal.sale.created_at).toLocaleString('ar-EG', {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })
                            : '—'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-white/10 dark:bg-slate-800/50">
                        <p className="text-[10px] font-black text-slate-500 dark:text-slate-400">الإجمالي</p>
                        <p className="font-black font-currency text-indigo-900 dark:text-indigo-100" dir="ltr">
                          ₪{Number(invoiceModal.sale.total_amount ?? 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs font-bold">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
                        الدفع:{' '}
                        {String(invoiceModal.sale.payment_mode || '').toLowerCase() === 'credit'
                          ? 'ذمة'
                          : String(invoiceModal.sale.payment_mode || '').toLowerCase() === 'cash'
                            ? 'كاش'
                            : invoiceModal.sale.payment_mode || '—'}
                      </span>
                      {invoiceModal.sale.pos_tender === 'check' ? (
                        <span className="rounded-full bg-amber-100 text-amber-900 px-2.5 py-1 dark:bg-amber-950/50 dark:text-amber-100">
                          تحصيل: شيك
                        </span>
                      ) : null}
                      {invoiceModal.sale.pos_tender === 'visa' ? (
                        <span className="rounded-full bg-violet-100 text-violet-900 px-2.5 py-1 dark:bg-violet-950/50 dark:text-violet-100">
                          تحصيل: دفع إلكتروني
                        </span>
                      ) : null}
                      {invoiceModal.sale.pos_tender === 'digital_wallet' ? (
                        <span className="rounded-full bg-teal-100 text-teal-900 px-2.5 py-1 dark:bg-teal-950/45 dark:text-teal-100">
                          تحصيل: محفظة رقمية
                        </span>
                      ) : null}
                      {invoiceModal.sale.returned_at ? (
                        <span className="rounded-full bg-rose-100 text-rose-800 px-2.5 py-1 dark:bg-rose-950/45 dark:text-rose-100">
                          مرتجع
                        </span>
                      ) : null}
                    </div>
                    {invoiceModal.sale.contact_id ? (
                      <Link
                        to={`/customers/${invoiceModal.sale.contact_id}`}
                        className="inline-flex text-xs font-black text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        فتح ملف الزبون المرتبط ←
                      </Link>
                    ) : null}
                    {invoiceModal.sale.notes ? (
                      <div>
                        <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 mb-1">ملاحظات الفاتورة</p>
                        <pre className="whitespace-pre-wrap text-xs font-bold text-slate-700 dark:text-slate-200 rounded-xl border border-slate-100 bg-slate-50/90 p-3 max-h-40 overflow-y-auto dark:border-white/10 dark:bg-slate-800/60">
                          {String(invoiceModal.sale.notes)}
                        </pre>
                      </div>
                    ) : null}
                    <div>
                      <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 mb-2">الأصناف</p>
                      {parseSaleLineItems(invoiceModal.sale.line_items).length === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">لا توجد أسطر محفوظة في الفاتورة.</p>
                      ) : (
                        <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-white/10">
                          <table className="w-full text-xs text-right min-w-[320px]">
                            <thead>
                              <tr className="bg-slate-900 text-white dark:bg-slate-950">
                                <th className="p-2">#</th>
                                <th className="p-2" dir="ltr">
                                  باركود
                                </th>
                                <th className="p-2 text-center">كمية</th>
                                <th className="p-2 text-center" dir="ltr">
                                  سعر
                                </th>
                                <th className="p-2 text-center" dir="ltr">
                                  إجمالي
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {parseSaleLineItems(invoiceModal.sale.line_items).map((line, idx) => (
                                <tr
                                  key={`${idx}-${line.barcode || idx}`}
                                  className="border-b border-slate-100 dark:border-slate-700/80 odd:bg-white even:bg-slate-50/70 dark:odd:bg-slate-800/30 dark:even:bg-slate-800/50"
                                >
                                  <td className="p-2 text-center text-slate-500">{idx + 1}</td>
                                  <td className="p-2 font-mono" dir="ltr">
                                    {line.barcode ?? '—'}
                                  </td>
                                  <td className="p-2 text-center font-currency">{line.qty ?? '—'}</td>
                                  <td className="p-2 text-center font-currency" dir="ltr">
                                    {line.unit_price != null ? `₪${Number(line.unit_price).toFixed(2)}` : '—'}
                                  </td>
                                  <td className="p-2 text-center font-black font-currency" dir="ltr">
                                    {line.line_total != null ? `₪${Number(line.line_total).toFixed(2)}` : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {parseSaleLineItems(invoiceModal.sale.line_items).some((l) => l.serial_numbers) ? (
                        <ul className="mt-2 space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                          {parseSaleLineItems(invoiceModal.sale.line_items).map((line, idx) =>
                            line.serial_numbers ? (
                              <li key={`s-${idx}`} className="font-mono" dir="ltr">
                                سيريال #{idx + 1}: {String(line.serial_numbers)}
                              </li>
                            ) : null
                          )}
                        </ul>
                      ) : null}
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-700/60">
                      يمكنك أيضاً مراجعة الفاتورة في صفحة{' '}
                      <Link to="/sales" className="font-black text-indigo-600 hover:underline dark:text-indigo-400">
                        حركة المبيعات
                      </Link>
                      .
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null,
          document.body
        )}

      {typeof document !== 'undefined' &&
        createPortal(
          voucherModal.open ? (
            <div
              className="fixed inset-0 z-[10002] flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-sm"
              dir="rtl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="voucher-detail-title"
              onClick={(ev) => {
                if (ev.target === ev.currentTarget && !voucherModal.loading) closeVoucherModal();
              }}
            >
              <div
                className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-gray-900"
                onClick={(ev) => ev.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <h2 id="voucher-detail-title" className="text-lg font-black text-slate-900 dark:text-white">
                    تفاصيل سند القبض
                  </h2>
                  <button
                    type="button"
                    onClick={() => !voucherModal.loading && closeVoucherModal()}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10"
                    aria-label="إغلاق"
                  >
                    <X size={22} />
                  </button>
                </div>
                {voucherModal.loading ? (
                  <div className="flex justify-center py-16">
                    <Loader2 className="animate-spin text-amber-500 dark:text-amber-400" size={36} />
                  </div>
                ) : voucherModal.error ? (
                  <p className="text-sm font-bold text-rose-600 dark:text-rose-100 py-4">{voucherModal.error}</p>
                ) : voucherModal.voucher ? (
                  <div className="space-y-4 text-sm">
                    <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 break-all" dir="ltr">
                      {voucherModal.voucher.id}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-white/10 dark:bg-slate-800/50">
                        <p className="text-[10px] font-black text-slate-500">تاريخ السند</p>
                        <p className="font-bold font-currency" dir="ltr">
                          {voucherModal.voucher.date || '—'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-white/10 dark:bg-slate-800/50">
                        <p className="text-[10px] font-black text-slate-500">المبلغ</p>
                        <p className="font-black font-currency text-amber-900 dark:text-amber-100" dir="ltr">
                          {voucherCurrencySymbol(voucherModal.voucher.currency_code)}
                          {Number(voucherModal.voucher.amount ?? 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs font-bold">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
                        طريقة:{' '}
                        {String(voucherModal.voucher.voucher_tender || 'cash') === 'checks'
                          ? 'شيكات (قيد التحصيل)'
                          : String(voucherModal.voucher.voucher_tender || 'cash') === 'visa'
                            ? 'فيزا'
                            : String(voucherModal.voucher.voucher_tender || 'cash') === 'mixed'
                              ? 'كاش + شيكات'
                              : 'كاش'}
                      </span>
                      {voucherModal.voucher.visa_last4 ? (
                        <span className="rounded-full bg-violet-100 text-violet-900 px-2.5 py-1 dark:bg-violet-950/50">
                          ****{String(voucherModal.voucher.visa_last4).slice(-4)}
                        </span>
                      ) : null}
                    </div>
                    {parseCheckLines(voucherModal.voucher).length > 0 ? (
                      <div>
                        <p className="text-[10px] font-black text-slate-500 mb-2">تفاصيل الشيكات (برسم التحصيل)</p>
                        <div className="overflow-x-auto rounded-xl border border-amber-100 dark:border-amber-900/40">
                          <table className="w-full text-xs min-w-[300px]">
                            <thead>
                              <tr className="bg-amber-100 dark:bg-amber-950/50 text-amber-950 dark:text-amber-100">
                                <th className="p-2 text-right">رقم الشيك</th>
                                <th className="p-2" dir="ltr">
                                  التاريخ
                                </th>
                                <th className="p-2 text-center" dir="ltr">
                                  المبلغ
                                </th>
                                <th className="p-2 text-right">البنك</th>
                              </tr>
                            </thead>
                            <tbody>
                              {parseCheckLines(voucherModal.voucher).map((ch, idx) => (
                                <tr
                                  key={idx}
                                  className="border-b border-amber-50 dark:border-amber-900/30 odd:bg-white even:bg-amber-50/30 dark:odd:bg-slate-800/40"
                                >
                                  <td className="p-2 font-mono" dir="ltr">
                                    {ch.check_number ?? '—'}
                                  </td>
                                  <td className="p-2 font-currency" dir="ltr">
                                    {ch.check_date ?? '—'}
                                  </td>
                                  <td className="p-2 text-center font-currency" dir="ltr">
                                    {ch.amount != null ? Number(ch.amount).toFixed(2) : '—'}
                                  </td>
                                  <td className="p-2">{ch.bank_name ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : null}
                    {voucherModal.voucher.description ? (
                      <div>
                        <p className="text-[10px] font-black text-slate-500 mb-1">البيان</p>
                        <pre className="whitespace-pre-wrap text-xs font-bold text-slate-700 dark:text-slate-200 rounded-xl border border-slate-100 bg-slate-50/90 p-3 max-h-32 overflow-y-auto dark:border-white/10 dark:bg-slate-800/60">
                          {String(voucherModal.voucher.description)}
                        </pre>
                      </div>
                    ) : null}
                    <Link
                      to="/vouchers"
                      className="inline-flex text-xs font-black text-amber-700 hover:underline dark:text-amber-400"
                    >
                      فتح صفحة سندات القبض والصرف ←
                    </Link>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null,
          document.body
        )}
    </DashboardLayout>
  );
}
