import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Loader2, FileText, Printer, Truck, Wallet, X } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import PrintSupplierStatement from '../components/PrintSupplierStatement';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';

const PURCHASES_TABLE = 'store_purchases';
const RETURNS_TABLE = 'store_purchase_returns';
const CONTACTS_TABLE = 'store_contacts';
const VOUCHERS_TABLE = import.meta.env.VITE_SUPABASE_VOUCHERS_TABLE?.trim() || 'vouchers';
const SUPPLIERS_TABLE = import.meta.env.VITE_SUPABASE_SUPPLIERS_TABLE?.trim() || 'suppliers';

function formatDateLabel(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** جدول المرتجعات غير منشأ في Supabase أو غير ظاهر في الـ schema cache */
function isReturnsTableUnavailable(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || '');
  const code = err.code;
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    /schema cache|could not find.*table|does not exist|store_purchase_returns/i.test(msg)
  );
}

/** خطأ عمود (مثل store_id غير موجود) — لا يُعتبر «الجدول غير موجود» */
function isPostgresColumnError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || '');
  const code = err.code;
  return code === '42703' || (/column/i.test(msg) && /does not exist/i.test(msg));
}

/** جدول vouchers نفسه غير موجود في PostgREST — وليس خطأ عمود أو RLS */
function isVouchersRelationMissing(err) {
  if (!err || isPostgresColumnError(err)) return false;
  const msg = String(err.message || err.details || '');
  const code = err.code;
  if (code === 'PGRST205') return true;
  if (code === '42P01') return true;
  if (/could not find the table|schema cache.*\bvouchers\b|relation\s+["']?vouchers["']?\s+does not exist/i.test(msg))
    return true;
  return false;
}

function sortVoucherRows(rows) {
  return [...rows].sort((a, b) => {
    const ta = new Date(a.created_at || a.date || 0).getTime();
    const tb = new Date(b.created_at || b.date || 0).getTime();
    return ta - tb;
  });
}

/**
 * سندات vouchers قد تخزّن account_id = جهة اتصال، أو supplier_id = صف جدول suppliers.
 * كشف الحساب يختار المورد من store_contacts — نطابق contactId أو أي supplier مرتبط به.
 */
function filterVouchersForLedger(rows, contactId, linkedSupplierIds = [], contactName) {
  const accept = new Set([String(contactId), ...linkedSupplierIds.map((id) => String(id))]);
  const name = String(contactName ?? '').trim() || null;

  return rows.filter((v) => {
    const candidates = [
      v.account_id,
      v.account,
      v.supplier_id,
      v.supplier_contact_id,
      v.contact_id,
      v.party_id,
      v.counterparty_id,
    ];
    if (candidates.some((c) => c != null && accept.has(String(c)))) return true;

    // صفوف قديمة حُفظت بدون مفتاح مورد — نُطابق وصف «المورد: الاسم» أو اسم المورد في النص
    if (name && typeof v.description === 'string' && v.description.trim()) {
      const d = v.description.trim();
      if (d.includes(`المورد: ${name}`) || d.includes(name)) return true;
    }
    return false;
  });
}

function voucherBelongsToStore(v, storeId) {
  if (!Object.prototype.hasOwnProperty.call(v, 'store_id')) return true;
  if (v.store_id == null || v.store_id === '') return true;
  return String(v.store_id) === String(storeId);
}

function dedupeVouchersById(rows) {
  const m = new Map();
  for (const v of rows) {
    if (v && v.id != null && !m.has(v.id)) m.set(v.id, v);
  }
  return Array.from(m.values());
}

function getVoucherTypeField(v) {
  return v.voucher_type ?? v.type ?? v.kind ?? v.voucher_kind;
}

/** صرف = يقلل الذمة؛ قبض يزيدها — يدعم قيم إنجليزية/عربية وأعمدة بديلة */
function voucherTypeIsPayment(voucherType) {
  const raw = voucherType ?? '';
  const t = String(raw).trim().toLowerCase();
  if (/قبض|receipt/.test(t)) return false;
  if (/صرف|payment|pay/.test(t)) return true;
  return true;
}

function parseLineItems(raw) {
  if (raw == null) return [];
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

export default function SupplierAccountStatementPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [contactId, setContactId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [error, setError] = useState(null);

  const [purchases, setPurchases] = useState([]);
  const [returns, setReturns] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [returnsTableMissing, setReturnsTableMissing] = useState(false);
  const [vouchersTableMissing, setVouchersTableMissing] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [viewPurchaseId, setViewPurchaseId] = useState(null);
  const [voucherModal, setVoucherModal] = useState(null);
  /** { id: uuid, refLabel: string } — تفاصيل سند الصرف عند الضغط على المرجع */
  const [voucherDetailOverride, setVoucherDetailOverride] = useState(null);
  const [voucherDetailLoading, setVoucherDetailLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [purchaseDetailOverride, setPurchaseDetailOverride] = useState(null);

  const fetchSuppliers = useCallback(async () => {
    if (!store?.id) {
      setSuppliers([]);
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
        .eq('role', 'supplier')
        .order('name', { ascending: true });
      if (qErr) throw qErr;
      setSuppliers(data || []);
    } catch (e) {
      console.error(e);
      setError(e.message || 'تعذّر تحميل الموردين');
      setSuppliers([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    fetchSuppliers();
  }, [storeLoading, fetchSuppliers]);

  const loadLedger = useCallback(async () => {
    if (!store?.id || !contactId) {
      setPurchases([]);
      setReturns([]);
      setVouchers([]);
      setSelectedContact(null);
      return;
    }
    setLoadingLedger(true);
    setError(null);
    setReturnsTableMissing(false);
    setVouchersTableMissing(false);
    try {
      const { data: contactRow } = await supabase
        .from(CONTACTS_TABLE)
        .select('id, name, phone, outstanding_amount, payment_type')
        .eq('id', contactId)
        .eq('store_id', store.id)
        .maybeSingle();
      setSelectedContact(contactRow || null);

      const { data: pData, error: pErr } = await supabase
        .from(PURCHASES_TABLE)
        .select(
          'id, invoice_number, invoice_date, total_amount, payment_mode, created_at, supplier_company_name, supplier_phone, line_items, notes'
        )
        .eq('store_id', store.id)
        .eq('supplier_contact_id', contactId)
        .order('created_at', { ascending: true });

      if (pErr) throw pErr;
      setPurchases(pData || []);

      const { data: rData, error: rErr } = await supabase
        .from(RETURNS_TABLE)
        .select('id, return_total, created_at, original_purchase_id, notes')
        .eq('store_id', store.id)
        .eq('supplier_contact_id', contactId)
        .order('created_at', { ascending: true });

      if (rErr) {
        if (isReturnsTableUnavailable(rErr)) {
          setReturns([]);
          setReturnsTableMissing(true);
          console.warn('store_purchase_returns غير متاح — يُعرض كشف المشتريات فقط', rErr);
        } else {
          throw rErr;
        }
      } else {
        setReturns(rData || []);
      }

      // select('*') ثم فلترة محلية — وإن فشل .eq('store_id') (عمود غير موجود) نجرب جلب كل الصفوف ونفلتر يدوياً
      let vRes = await supabase
        .from(VOUCHERS_TABLE)
        .select('*')
        .eq('store_id', store.id);

      if (vRes.error && (isPostgresColumnError(vRes.error) || /store_id/i.test(String(vRes.error.message)))) {
        const wide = await supabase.from(VOUCHERS_TABLE).select('*');
        if (!wide.error && wide.data) {
          const rows = wide.data.filter((v) => {
            const sameStore =
              !Object.prototype.hasOwnProperty.call(v, 'store_id') ||
              v.store_id == null ||
              String(v.store_id) === String(store.id);
            return sameStore;
          });
          vRes = { data: rows, error: null };
        } else {
          vRes = wide;
        }
      }

      if (vRes.error) {
        console.warn('[vouchers:ledger] خطأ جلب أولي', VOUCHERS_TABLE, vRes.error);
        setVouchers([]);
        setVouchersTableMissing(isVouchersRelationMissing(vRes.error));
      } else {
        let list = vRes.data || [];
        console.log('[vouchers:ledger] بعد eq(store_id)', {
          storeId: store.id,
          contactId,
          count: list.length,
          rows: list,
        });

        // جلب إضافي: سندات مربوطة بمعرّف المورد (قد لا تُرجعها فلترة store_id وحدها)
        const orContact = [
          `account_id.eq.${contactId}`,
          `supplier_id.eq.${contactId}`,
          `supplier_contact_id.eq.${contactId}`,
          `contact_id.eq.${contactId}`,
        ].join(',');
        const byContactRes = await supabase.from(VOUCHERS_TABLE).select('*').or(orContact);
        if (!byContactRes.error && byContactRes.data?.length) {
          console.log('[vouchers:ledger] دمج or(contact)', { added: byContactRes.data.length, orContact });
          list = dedupeVouchersById([...list, ...byContactRes.data]);
        } else if (byContactRes.error) {
          console.warn('[vouchers:ledger] or(contact) فشل — جلب واسع', byContactRes.error);
          const wide = await supabase.from(VOUCHERS_TABLE).select('*');
          if (!wide.error && wide.data?.length) {
            const pick = wide.data.filter((v) =>
              [v.account_id, v.account, v.supplier_id, v.supplier_contact_id, v.contact_id].some(
                (c) => c != null && String(c) === String(contactId)
              )
            );
            console.log('[vouchers:ledger] بعد فرز يدوي من الجلب الواسع', {
              totalWide: wide.data.length,
              matchedContact: pick.length,
              picked: pick,
            });
            list = dedupeVouchersById([...list, ...pick]);
          }
        }

        let linkedSupplierIds = [];
        const { data: supRows, error: supErr } = await supabase
          .from(SUPPLIERS_TABLE)
          .select('*')
          .eq('store_id', store.id);
        if (!supErr && supRows?.length) {
          linkedSupplierIds = supRows
            .filter((s) => {
              const links = [
                s.contact_id,
                s.store_contact_id,
                s.supplier_contact_id,
                s.account_id,
              ];
              return links.some((x) => x != null && String(x) === String(contactId));
            })
            .map((s) => s.id)
            .filter(Boolean);
        }

        const scoped = list.filter((v) => voucherBelongsToStore(v, store.id));
        const excludedByStore = list.filter((v) => !voucherBelongsToStore(v, store.id));
        if (excludedByStore.length) {
          console.warn('[vouchers:ledger] سندات أُسقِطت لأن store_id لا يطابق المتجر', {
            expectedStoreId: store.id,
            dropped: excludedByStore,
          });
        }

        const forContact = sortVoucherRows(
          filterVouchersForLedger(scoped, contactId, linkedSupplierIds, contactRow?.name)
        );
        const excludedByContact = scoped.filter(
          (v) => !forContact.some((k) => k.id === v.id)
        );
        if (excludedByContact.length) {
          console.warn('[vouchers:ledger] سندات للمتجر لكن لا تطابق المورد/الوصف', {
            contactId,
            linkedSupplierIds,
            contactName: contactRow?.name,
            excluded: excludedByContact,
          });
        }

        console.log('[vouchers:ledger] النتيجة النهائية للكشف', {
          table: VOUCHERS_TABLE,
          forContactCount: forContact.length,
          vouchers: forContact,
        });

        setVouchers(forContact);
        setVouchersTableMissing(false);
      }
    } catch (e) {
      console.error(e);
      setError(e.message || 'تعذّر تحميل الحركات');
      setPurchases([]);
      setReturns([]);
      setVouchers([]);
      setReturnsTableMissing(false);
      setVouchersTableMissing(false);
    } finally {
      setLoadingLedger(false);
    }
  }, [store?.id, contactId]);

  useEffect(() => {
    loadLedger();
  }, [loadLedger]);

  useEffect(() => {
    setViewPurchaseId(null);
    setPurchaseDetailOverride(null);
    setDetailLoading(false);
    setVoucherModal(null);
    setVoucherDetailOverride(null);
    setVoucherDetailLoading(false);
  }, [contactId]);

  const purchaseDetail = useMemo(() => {
    if (!viewPurchaseId) return null;
    const fromList = purchases.find((p) => p.id === viewPurchaseId);
    return fromList || purchaseDetailOverride;
  }, [viewPurchaseId, purchases, purchaseDetailOverride]);

  useEffect(() => {
    if (!viewPurchaseId || !store?.id) {
      setPurchaseDetailOverride(null);
      return;
    }
    if (purchases.some((p) => p.id === viewPurchaseId)) {
      setPurchaseDetailOverride(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    supabase
      .from(PURCHASES_TABLE)
      .select(
        'id, invoice_number, invoice_date, total_amount, payment_mode, created_at, supplier_company_name, supplier_phone, line_items, notes'
      )
      .eq('id', viewPurchaseId)
      .eq('store_id', store.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error(error);
          toast.error(error.message || 'تعذّر تحميل الفاتورة');
          setViewPurchaseId(null);
          return;
        }
        setPurchaseDetailOverride(data);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewPurchaseId, store?.id, purchases, toast]);

  const closeInvoiceModal = () => {
    setViewPurchaseId(null);
    setPurchaseDetailOverride(null);
    setDetailLoading(false);
  };

  const closeVoucherModal = () => {
    setVoucherModal(null);
    setVoucherDetailOverride(null);
    setVoucherDetailLoading(false);
  };

  const voucherDetail = useMemo(() => {
    if (!voucherModal?.id) return null;
    return vouchers.find((v) => v.id === voucherModal.id) || voucherDetailOverride;
  }, [voucherModal, vouchers, voucherDetailOverride]);

  useEffect(() => {
    if (!voucherModal?.id || !store?.id) {
      setVoucherDetailOverride(null);
      setVoucherDetailLoading(false);
      return;
    }
    const local = vouchers.find((v) => v.id === voucherModal.id);
    if (local) {
      setVoucherDetailOverride(null);
      setVoucherDetailLoading(false);
      return;
    }
    let cancelled = false;
    setVoucherDetailOverride(null);
    setVoucherDetailLoading(true);
    supabase
      .from(VOUCHERS_TABLE)
      .select('*')
      .eq('id', voucherModal.id)
      .eq('store_id', store.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error(error);
          setVoucherDetailOverride(null);
          return;
        }
        setVoucherDetailOverride(data);
      })
      .finally(() => {
        if (!cancelled) setVoucherDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [voucherModal, vouchers, store?.id]);

  const purchaseMap = useMemo(() => {
    const m = new Map();
    purchases.forEach((p) => m.set(p.id, p));
    return m;
  }, [purchases]);

  const ledgerRows = useMemo(() => {
    const events = [];
    for (const p of purchases) {
      events.push({
        ts: p.created_at || p.invoice_date,
        kind: 'purchase',
        purchase: p,
      });
    }
    for (const r of returns) {
      events.push({
        ts: r.created_at,
        kind: 'return',
        ret: r,
      });
    }
    for (const v of vouchers) {
      const ts =
        v.created_at ||
        (v.date ? `${String(v.date).slice(0, 10)}T12:00:00` : '');
      events.push({
        ts,
        kind: 'voucher',
        voucher: v,
      });
    }
    events.sort((a, b) => {
      const da = new Date(a.ts).getTime();
      const db = new Date(b.ts).getTime();
      if (da !== db) return da - db;
      const tie = (e) => {
        if (e.kind === 'purchase') return `p-${e.purchase?.id ?? ''}`;
        if (e.kind === 'return') return `r-${e.ret?.id ?? ''}`;
        if (e.kind === 'voucher') return `v-${e.voucher?.id ?? ''}`;
        return '';
      };
      return tie(a).localeCompare(tie(b));
    });

    let bal = 0;
    let paymentVoucherSeq = 0;
    const rows = [];
    for (const e of events) {
      if (e.kind === 'purchase') {
        const p = e.purchase;
        const isCredit = p.payment_mode === 'credit';
        const amt = Number(p.total_amount ?? 0);
        if (isCredit) bal += amt;
        rows.push({
          kind: 'purchase',
          dateLabel: formatDateLabel(p.invoice_date || p.created_at),
          description: isCredit ? 'فاتورة مشتريات (آجل)' : 'فاتورة مشتريات (كاش)',
          ref: p.invoice_number || '—',
          purchaseId: p.id,
          debit: isCredit ? amt : null,
          credit: null,
          balance: bal,
        });
      } else if (e.kind === 'return') {
        const r = e.ret;
        const orig = purchaseMap.get(r.original_purchase_id);
        const affects = orig?.payment_mode === 'credit';
        const cr = affects ? Number(r.return_total ?? 0) : null;
        if (affects) bal -= Number(r.return_total ?? 0);
        rows.push({
          kind: 'return',
          dateLabel: formatDateLabel(r.created_at),
          description: affects ? 'مرتجع مشتريات (يُنقص الذمة)' : 'مرتجع مشتريات (كاش)',
          ref: orig?.invoice_number || r.notes?.slice(0, 32) || '—',
          purchaseId: r.original_purchase_id || null,
          debit: null,
          credit: cr,
          balance: bal,
        });
      } else if (e.kind === 'voucher') {
        const v = e.voucher;
        const amt = Number(v.amount ?? 0);
        const isPayment = voucherTypeIsPayment(getVoucherTypeField(v));
        if (isPayment) {
          paymentVoucherSeq += 1;
          bal = Math.max(0, bal - amt);
          rows.push({
            kind: 'voucher',
            voucherId: v.id,
            dateLabel: formatDateLabel(v.date || v.created_at),
            description: v.description?.trim()
              ? `سند صرف (قبض وصرف) — ${v.description.trim()}`
              : 'سند صرف (من سندات القبض والصرف)',
            ref: String(paymentVoucherSeq),
            purchaseId: null,
            debit: null,
            credit: amt,
            balance: bal,
          });
        } else {
          bal += amt;
          rows.push({
            kind: 'voucher',
            voucherId: v.id,
            dateLabel: formatDateLabel(v.date || v.created_at),
            description: v.description?.trim()
              ? `سند قبض (قبض وصرف) — ${v.description.trim()}`
              : 'سند قبض / تسوية (من سندات القبض والصرف)',
            ref: `سند ${String(v.id).slice(0, 8)}`,
            purchaseId: null,
            debit: amt,
            credit: null,
            balance: bal,
          });
        }
      }
    }
    return { rows, closingBalance: bal };
  }, [purchases, returns, vouchers, purchaseMap]);

  const printPayload = useMemo(
    () => ({
      storeName: store?.name,
      supplierName: selectedContact?.name,
      supplierPhone: selectedContact?.phone,
      rows: ledgerRows.rows,
      closingBalance: ledgerRows.closingBalance,
      printedAtLabel: new Date().toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    }),
    [store?.name, selectedContact, ledgerRows.rows, ledgerRows.closingBalance]
  );

  /** طباعة حقيقية عبر window.print — المحتوى في portal خارج #root (لا يُطبَع iframe فارغاً كما مع react-to-print) */
  const [statementPrintPayload, setStatementPrintPayload] = useState(null);

  useEffect(() => {
    if (!statementPrintPayload) return;
    document.body.classList.add('print-invoice-active');
    const prevTitle = document.title;
    document.title = `كشف حساب — ${statementPrintPayload.supplierName || 'مورد'}`;
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
    if (!contactId || ledgerRows.rows.length === 0) return;
    setStatementPrintPayload({
      ...printPayload,
      rows: [...ledgerRows.rows],
      printedAtLabel: new Date().toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    });
  };

  const submitSupplierPayment = async () => {
    if (!store?.id || !contactId) return;
    const amt = Math.round(Math.max(0, parseFloat(String(paymentAmount).replace(',', '.')) || 0) * 100) / 100;
    if (amt <= 0) {
      toast.warning('أدخل مبلغاً أكبر من صفر');
      return;
    }
    setPaymentSubmitting(true);
    try {
      const dateStr = String(paymentDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const desc = paymentNotes.trim() || null;
      const insertVariants = [
        {
          store_id: store.id,
          account_id: contactId,
          voucher_type: 'payment',
          amount: amt,
          date: dateStr,
          description: desc,
        },
        {
          store_id: store.id,
          supplier_contact_id: contactId,
          voucher_type: 'payment',
          amount: amt,
          date: dateStr,
          description: desc,
        },
        {
          store_id: store.id,
          supplier_id: contactId,
          voucher_type: 'payment',
          amount: amt,
          date: dateStr,
          description: desc,
        },
      ];
      console.log('[vouchers:statement-form] حفظ سند صرف من كشف الحساب', {
        store_id: store.id,
        account_id: contactId,
        amount: amt,
        date: dateStr,
        variants: insertVariants,
      });

      let insErr = null;
      for (let i = 0; i < insertVariants.length; i++) {
        const row = insertVariants[i];
        const { error } = await supabase.from(VOUCHERS_TABLE).insert([row]);
        if (!error) {
          console.log('[vouchers:statement-form] نجح الإدراج', { variantIndex: i + 1, row });
          insErr = null;
          break;
        }
        insErr = error;
        console.warn('[vouchers:statement-form] فشل إدراج', { variantIndex: i + 1, row, error });
      }
      if (insErr) throw insErr;

      const { data: cRow, error: selErr } = await supabase
        .from(CONTACTS_TABLE)
        .select('outstanding_amount')
        .eq('id', contactId)
        .eq('store_id', store.id)
        .maybeSingle();
      if (selErr) throw selErr;
      const prev = Math.max(0, Number(cRow?.outstanding_amount ?? 0));
      const next = Math.max(0, Math.round((prev - amt) * 100) / 100);
      const { error: upErr } = await supabase
        .from(CONTACTS_TABLE)
        .update({ outstanding_amount: next, payment_type: 'credit' })
        .eq('id', contactId)
        .eq('store_id', store.id);
      if (upErr) throw upErr;

      setPaymentAmount('');
      setPaymentNotes('');
      setPaymentDate(new Date().toISOString().slice(0, 10));
      await fetchSuppliers();
      await loadLedger();
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'فشل تسجيل السند');
    } finally {
      setPaymentSubmitting(false);
    }
  };

  if (storeLoading || loading) {
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
          className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center font-bold dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
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
        <Link
          to="/purchases/history"
          className="text-sm font-bold text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"
        >
          ← سجل المشتريات
        </Link>
      }
    >
      <div className="max-w-5xl mx-auto space-y-6" dir="rtl">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-100 text-teal-800 dark:bg-teal-950/50 dark:text-teal-300">
            <Truck size={24} />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900 dark:text-white">كشف حساب مورد</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              مشتريات آجل، مرتجعات، سندات صرف، وسندات القبض/الصرف — مرتّبة زمنياً
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-wrap gap-4 items-end dark:border-gray-700/50 dark:bg-gray-900/70 dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.35)]">
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs font-black text-slate-600 dark:text-slate-300 block mb-2">اختر المورد</label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold bg-slate-50 dark:border-white/10 dark:bg-slate-800/80 dark:text-slate-100"
            >
              <option value="">— اختر مورداً —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || s.phone || s.id}
                </option>
              ))}
            </select>
          </div>
          {selectedContact && (
            <div className="text-xs font-bold text-slate-600 dark:text-slate-300">
              <span className="text-slate-400 dark:text-slate-500">رصيد الذمة المسجّل: </span>
              <span className="font-currency text-amber-900 dark:text-amber-200" dir="ltr" lang="en">
                ₪ {Number(selectedContact.outstanding_amount ?? 0).toFixed(2)}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={openStatementPrint}
            disabled={!contactId || ledgerRows.rows.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 text-white font-black px-5 py-2.5 text-sm hover:bg-emerald-800 disabled:opacity-40 dark:shadow-lg dark:shadow-emerald-950/40"
          >
            <Printer size={18} />
            طباعة الكشف / PDF
          </button>
        </div>

        {contactId && selectedContact && !loadingLedger && (
          <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-5 shadow-sm dark:border-violet-800/40 dark:bg-violet-950/30 dark:shadow-none">
            <div className="flex items-center gap-2 mb-3">
              <Wallet className="text-violet-700 dark:text-violet-400 shrink-0" size={20} />
              <h3 className="text-sm font-black text-violet-950 dark:text-violet-100">سند صرف — دفعة نقدية للمورد</h3>
            </div>
            <p className="text-[11px] text-violet-900/80 dark:text-violet-200/85 mb-4 leading-relaxed">
              يُسجّل الدفع في عمود <strong>دائن</strong> ويُنقص رصيد الذمة المحسوب. يُحدَّث أيضاً «رصيد الذمة المسجّل» في
              دليل الموردين.
            </p>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="min-w-[120px]">
                <label className="text-[10px] font-black text-violet-800 dark:text-violet-300 block mb-1">المبلغ ₪</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full rounded-xl border border-violet-200 px-3 py-2 text-sm font-bold font-currency bg-white dark:border-violet-700/50 dark:bg-slate-900 dark:text-slate-100"
                  dir="ltr"
                  lang="en"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-violet-800 dark:text-violet-300 block mb-1">تاريخ الدفع</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="rounded-xl border border-violet-200 px-3 py-2 text-sm font-currency bg-white dark:border-violet-700/50 dark:bg-slate-900 dark:text-slate-100 dark:[color-scheme:dark]"
                  dir="ltr"
                  lang="en"
                />
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="text-[10px] font-black text-violet-800 dark:text-violet-300 block mb-1">ملاحظات (تظهر كمرجع)</label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full rounded-xl border border-violet-200 px-3 py-2 text-sm bg-white dark:border-violet-700/50 dark:bg-slate-900 dark:text-slate-100 placeholder:text-slate-500"
                  placeholder="اختياري"
                />
              </div>
              <button
                type="button"
                onClick={submitSupplierPayment}
                disabled={paymentSubmitting}
                className="rounded-xl bg-violet-700 text-white font-black px-5 py-2.5 text-sm hover:bg-violet-800 disabled:opacity-40"
              >
                {paymentSubmitting ? <Loader2 className="animate-spin inline" size={18} /> : 'تسجيل السند'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100">
            {error}
          </div>
        )}

        {returnsTableMissing && !error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm font-bold text-amber-950 leading-relaxed dark:border-amber-800/50 dark:bg-amber-950/35 dark:text-amber-100">
            جدول المرتجعات <code className="text-xs bg-amber-100/80 dark:bg-amber-900/50 px-1 rounded">store_purchase_returns</code> غير
            موجود في قاعدة البيانات — يُعرض الآن <strong>كشف المشتريات فقط</strong> (بدون صفوف مرتجعات). لتفعيل
            المرتجعات في الكشف: نفّذ في Supabase SQL Editor الملف{' '}
            <code className="text-xs bg-amber-100/80 dark:bg-amber-900/50 px-1 rounded">swiftm/supabase/store_purchase_returns.sql</code>{' '}
            ثم أعد تحميل الصفحة.
          </div>
        )}

        {vouchersTableMissing && !error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm font-bold text-amber-950 leading-relaxed dark:border-amber-800/50 dark:bg-amber-950/35 dark:text-amber-100">
            جدول <code className="text-xs bg-amber-100/80 dark:bg-amber-900/50 px-1 rounded">vouchers</code> غير متاح أو غير ظاهر في
            الـ schema — لا يمكن عرض سندات القبض/الصرف. تحقق من إنشاء الجدول والأعمدة (
            <code className="text-xs bg-amber-100/80 dark:bg-amber-900/50 px-1 rounded">amount</code>,{' '}
            <code className="text-xs bg-amber-100/80 dark:bg-amber-900/50 px-1 rounded">voucher_type</code>,{' '}
            <code className="text-xs bg-amber-100/80 dark:bg-amber-900/50 px-1 rounded">account_id</code>
            ).
          </div>
        )}

        {!contactId ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 py-16 text-center text-slate-500 font-bold text-sm dark:border-slate-600/60 dark:bg-slate-800/40 dark:text-slate-400">
            اختر مورداً لعرض كشف الحساب
          </div>
        ) : loadingLedger ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-teal-600 dark:text-teal-400" size={36} />
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden dark:border-gray-700/50 dark:bg-gray-900/70 dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.35)]">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right min-w-[640px]">
                <thead>
                  <tr className="bg-slate-900 text-white dark:bg-slate-950">
                    <th className="p-3 font-black">التاريخ</th>
                    <th className="p-3 font-black">البيان</th>
                    <th className="p-3 font-black">المرجع</th>
                    <th className="p-3 font-black text-center">مدين (آجل)</th>
                    <th className="p-3 font-black text-center">دائن</th>
                    <th className="p-3 font-black text-center">رصيد ذمة</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500 font-bold dark:text-slate-400">
                        لا حركات لهذا المورد
                      </td>
                    </tr>
                  ) : (
                    ledgerRows.rows.map((r, i) => (
                      <tr
                        key={`${r.kind}-${r.voucherId || r.purchaseId || r.ref}-${i}`}
                        className="border-b border-slate-100 odd:bg-white even:bg-slate-50/50 dark:border-slate-700/50 dark:odd:bg-slate-800/30 dark:even:bg-slate-800/50"
                      >
                        <td className="p-2.5 font-currency text-slate-700 dark:text-slate-200" dir="ltr" lang="en">
                          {r.dateLabel}
                        </td>
                        <td className="p-2.5 font-bold text-slate-800 dark:text-slate-100">{r.description}</td>
                        <td className="p-2.5 text-xs">
                          {r.kind === 'voucher' && r.credit != null && r.voucherId ? (
                            <button
                              type="button"
                              onClick={() =>
                                setVoucherModal({ id: r.voucherId, refLabel: String(r.ref) })
                              }
                              className="font-currency font-bold text-indigo-700 hover:text-indigo-900 hover:underline underline-offset-2 text-left w-full dark:text-indigo-400 dark:hover:text-indigo-300"
                              dir="ltr"
                              lang="en"
                              title="عرض تفاصيل سند الصرف"
                            >
                              {r.ref}
                            </button>
                          ) : r.purchaseId ? (
                            <button
                              type="button"
                              onClick={() => setViewPurchaseId(r.purchaseId)}
                              className="font-currency font-bold text-teal-700 hover:text-teal-900 hover:underline underline-offset-2 text-left w-full dark:text-teal-400 dark:hover:text-teal-300"
                              dir="ltr"
                              lang="en"
                              title="عرض تفاصيل فاتورة المشتريات"
                            >
                              {r.ref}
                            </button>
                          ) : (
                            <span className="font-currency text-slate-600 dark:text-slate-400" dir="ltr" lang="en">
                              {r.ref}
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 font-currency text-center text-emerald-800 font-bold dark:text-emerald-300" dir="ltr" lang="en">
                          {r.debit != null ? `₪${r.debit.toFixed(2)}` : '—'}
                        </td>
                        <td className="p-2.5 font-currency text-center text-rose-700 font-bold dark:text-rose-300" dir="ltr" lang="en">
                          {r.credit != null ? `₪${r.credit.toFixed(2)}` : '—'}
                        </td>
                        <td className="p-2.5 font-currency text-center font-black text-slate-900 dark:text-white" dir="ltr" lang="en">
                          ₪{r.balance.toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {ledgerRows.rows.length > 0 && (
              <div className="flex justify-between items-center px-4 py-3 bg-emerald-50 border-t border-emerald-100 text-sm font-black text-emerald-950 dark:bg-emerald-950/40 dark:border-emerald-800/50 dark:text-emerald-100">
                <span>رصيد الذمة الختامي (محسوب من الحركات)</span>
                <span className="font-currency" dir="ltr" lang="en">
                  ₪ {ledgerRows.closingBalance.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        )}

        <p className="text-[11px] text-slate-500 leading-relaxed flex items-start gap-2 dark:text-slate-400">
          <FileText size={16} className="shrink-0 mt-0.5 text-slate-400 dark:text-slate-500" />
          المدين: فواتير شراء آجل أو سند قبض. الدائن: مرتجعات آجل أو سندات صرف (بما فيها سندات القبض والصرف). فواتير
          الكاش للعلم فقط. اضغط مرجع <strong className="text-indigo-700 dark:text-indigo-400">سند الصرف</strong> لعرض تفاصيل السند، أو مرجع
          الفاتورة (<strong className="text-teal-700 dark:text-teal-400">رقم فاتورة</strong>) لفتح فاتورة المشتريات. الطباعة تدعم حفظ PDF
          من نافذة المتصفح.
        </p>
      </div>

      {statementPrintPayload
        ? createPortal(
            <div
              id="print-invoice-mount"
              className="fixed inset-0 z-[9999] overflow-y-auto bg-white print:static print:inset-auto print:z-auto"
              aria-hidden
            >
              <PrintSupplierStatement data={statementPrintPayload} />
            </div>,
            document.body
          )
        : null}

      {viewPurchaseId ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={closeInvoiceModal}
          role="presentation"
        >
          <div
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl p-6 dark:bg-gray-900 dark:border dark:border-white/10"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div className="flex justify-between items-start gap-2 mb-4 border-b border-slate-100 dark:border-slate-700 pb-3">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">فاتورة مشتريات</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">من سجل المشتريات المرتبط بهذا المورد</p>
              </div>
              <button
                type="button"
                onClick={closeInvoiceModal}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-600 dark:text-slate-400"
                aria-label="إغلاق"
              >
                <X size={22} />
              </button>
            </div>

            {detailLoading && !purchaseDetail ? (
              <div className="flex justify-center py-12">
                <Loader2 className="animate-spin text-teal-600 dark:text-teal-400" size={32} />
              </div>
            ) : purchaseDetail ? (
              <>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-4">
                  <div>
                    <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">المورد</dt>
                    <dd className="font-black text-slate-900 dark:text-white">{purchaseDetail.supplier_company_name || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">الهاتف</dt>
                    <dd className="font-currency font-bold dark:text-slate-200" dir="ltr" lang="en">
                      {purchaseDetail.supplier_phone || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">رقم الفاتورة</dt>
                    <dd className="font-currency font-black dark:text-slate-100" dir="ltr" lang="en">
                      {purchaseDetail.invoice_number || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">التاريخ</dt>
                    <dd className="font-currency font-bold dark:text-slate-200" dir="ltr" lang="en">
                      {purchaseDetail.invoice_date || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">الدفع</dt>
                    <dd className="font-black dark:text-slate-100">
                      {purchaseDetail.payment_mode === 'credit' ? 'آجل' : 'كاش'}
                    </dd>
                  </div>
                  {purchaseDetail.payment_mode === 'credit' && purchaseDetail.payment_due_date ? (
                    <div>
                      <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">الاستحقاق</dt>
                      <dd className="font-currency font-bold text-amber-900 dark:text-amber-200" dir="ltr" lang="en">
                        {purchaseDetail.payment_due_date}
                      </dd>
                    </div>
                  ) : null}
                  <div className="sm:col-span-2">
                    <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">الإجمالي</dt>
                    <dd className="font-currency text-xl font-black text-teal-800 dark:text-teal-300" dir="ltr" lang="en">
                      ₪ {Number(purchaseDetail.total_amount ?? 0).toFixed(2)}
                    </dd>
                  </div>
                </dl>

                {Number(purchaseDetail.landed_cost_extra ?? 0) > 0 && (
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-3">
                    مصاريف واصلة:{' '}
                    <span className="font-currency" dir="ltr" lang="en">
                      ₪ {Number(purchaseDetail.landed_cost_extra).toFixed(2)}
                    </span>
                  </p>
                )}

                <h4 className="text-xs font-black text-slate-700 dark:text-slate-300 mb-2">الأصناف</h4>
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10 mb-4">
                  <table className="w-full text-xs text-right min-w-[480px]">
                    <thead>
                      <tr className="bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                        <th className="p-2 font-black">الباركود</th>
                        <th className="p-2 font-black">المرجع</th>
                        <th className="p-2 font-black text-center">الكمية</th>
                        <th className="p-2 font-black">السعر</th>
                        <th className="p-2 font-black">المجموع</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parseLineItems(purchaseDetail.line_items).map((line, idx) => (
                        <tr key={idx} className="border-t border-slate-100 dark:border-slate-700 dark:text-slate-200">
                          <td className="p-2 font-currency" dir="ltr" lang="en">
                            {line.barcode || '—'}
                          </td>
                          <td className="p-2 font-currency" dir="ltr" lang="en">
                            {line.reference || '—'}
                          </td>
                          <td className="p-2 text-center font-currency font-bold" dir="ltr" lang="en">
                            {line.qty ?? '—'}
                          </td>
                          <td className="p-2 font-currency" dir="ltr" lang="en">
                            ₪{Number(line.unit_price ?? 0).toFixed(2)}
                          </td>
                          <td className="p-2 font-currency font-black" dir="ltr" lang="en">
                            ₪{Number(line.line_total ?? 0).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {purchaseDetail.notes ? (
                  <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap border-t border-slate-100 dark:border-slate-700 pt-3">
                    <span className="font-black text-slate-500 dark:text-slate-400">ملاحظات: </span>
                    {purchaseDetail.notes}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-center text-slate-500 dark:text-slate-400 font-bold py-8">لا تتوفر بيانات الفاتورة</p>
            )}
          </div>
        </div>
      ) : null}

      {voucherModal ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={closeVoucherModal}
          role="presentation"
        >
          <div
            className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl p-6 dark:bg-gray-900 dark:border dark:border-white/10"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div className="flex justify-between items-start gap-2 mb-4 border-b border-slate-100 dark:border-slate-700 pb-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 shrink-0">
                  <Wallet size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">سند صرف</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    المرجع في الكشف:{' '}
                    <span className="font-currency font-bold text-indigo-800 dark:text-indigo-300" dir="ltr" lang="en">
                      {voucherModal.refLabel}
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeVoucherModal}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-600 dark:text-slate-400"
                aria-label="إغلاق"
              >
                <X size={22} />
              </button>
            </div>

            {voucherDetailLoading && !voucherDetail ? (
              <div className="flex justify-center py-12">
                <Loader2 className="animate-spin text-indigo-600 dark:text-indigo-400" size={32} />
              </div>
            ) : voucherDetail ? (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">المبلغ (دائن)</dt>
                  <dd className="font-currency text-xl font-black text-rose-700 dark:text-rose-300" dir="ltr" lang="en">
                    ₪ {Number(voucherDetail.amount ?? 0).toFixed(2)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">تاريخ السند</dt>
                  <dd className="font-currency font-bold dark:text-slate-200" dir="ltr" lang="en">
                    {voucherDetail.date
                      ? String(voucherDetail.date).slice(0, 10)
                      : formatDateLabel(voucherDetail.created_at)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">نوع السند</dt>
                  <dd className="font-black text-slate-900 dark:text-white">
                    {String(getVoucherTypeField(voucherDetail) ?? '—')}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">تسجيل السند</dt>
                  <dd className="font-currency text-xs text-slate-600 dark:text-slate-400" dir="ltr" lang="en">
                    {voucherDetail.created_at
                      ? new Date(voucherDetail.created_at).toLocaleString('ar-EG', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">البيان / الملاحظات</dt>
                  <dd className="font-bold text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                    {voucherDetail.description?.trim() || '—'}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-[10px] font-bold text-slate-400 dark:text-slate-500">معرّف السند (داخلي)</dt>
                  <dd className="font-mono text-[11px] text-slate-500 dark:text-slate-400 break-all" dir="ltr" lang="en">
                    {String(voucherDetail.id)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-center text-slate-500 dark:text-slate-400 font-bold py-8">لا تتوفر بيانات هذا السند.</p>
            )}
          </div>
        </div>
      ) : null}

    </DashboardLayout>
  );
}
