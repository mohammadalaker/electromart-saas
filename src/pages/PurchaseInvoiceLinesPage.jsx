import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
  Loader2,
  ShoppingBag,
  Plus,
  PackagePlus,
  Trash2,
  Save,
  TrendingUp,
  Copy,
  Camera,
  ImagePlus,
  X,
  Upload,
  AlertTriangle,
  Search,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { uploadPurchaseInvoiceScan } from '../utils/uploadProductImage';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';
import { addDaysISO } from '../utils/dateIso';
import { isElectricalProduct } from '../utils/electricalProduct';
import {
  computePurchaseLinePayloads,
  computeLineTotal,
  effectiveUnitCostFromRow,
  parseSerialList,
  stockQtyFromLine,
} from '../utils/purchaseLinePayloads';
import {
  fetchPendingReservationsForProducts,
  groupReservationsByProduct,
} from '../utils/preOrders';
import {
  executePurchaseReceiveEffects,
  upsertSupplierForCreditDraft,
} from '../utils/purchaseReceiveExecution';
import {
  resolvePurchaseLinesNewProducts,
  insertNewProductForPurchase,
} from '../utils/resolvePurchaseNewProducts';
import { brandStorageKey } from '../constants/brand.js';

const PURCHASES_TABLE = 'store_purchases';
const STORAGE_KEY = brandStorageKey('purchase-invoice-header');
const TARGET_MARGIN = 0.2;

function escapeIlike(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function newLine() {
  return {
    key: crypto.randomUUID(),
    barcode: '',
    reference: '',
    unit_price: '',
    discount_percent: '0',
    qty: '1',
    productId: null,
    productName: '',
    sellPrice: null,
    stockFullPrice: null,
    brandGroup: '',
    expiryDate: '',
    serialInput: '',
  };
}

function formatInvoiceDateLabel(isoDate) {
  if (!isoDate) return '—';
  try {
    const d = new Date(`${String(isoDate).slice(0, 10)}T12:00:00`);
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

function suggestedSellAtMargin(cost, margin = TARGET_MARGIN) {
  if (cost <= 0) return null;
  return Math.round(cost * (1 + margin) * 100) / 100;
}

export default function PurchaseInvoiceLinesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();
  const [header, setHeader] = useState(null);
  const [lines, setLines] = useState([newLine()]);
  const [extraNotes, setExtraNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [suggestionsByRow, setSuggestionsByRow] = useState({});
  const [dropdownRowKey, setDropdownRowKey] = useState(null);
  const [searchLoadingKey, setSearchLoadingKey] = useState(null);
  const [updateCatalogCosts, setUpdateCatalogCosts] = useState(true);
  const [landedCostExtra, setLandedCostExtra] = useState('');
  /** مسودة = لا يُحدَّث المخزن؛ استلام = تطبيق الكميات والتكلفة فوراً */
  const [purchaseStatus, setPurchaseStatus] = useState('received');
  const [invoiceScanFile, setInvoiceScanFile] = useState(null);
  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState(null);
  const [preOrderReservations, setPreOrderReservations] = useState([]);
  const [newProductOpen, setNewProductOpen] = useState(false);
  const [newProductSaving, setNewProductSaving] = useState(false);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productSearchResults, setProductSearchResults] = useState([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const productSearchInputRef = useRef(null);
  const [npEngName, setNpEngName] = useState('');
  const [npRef, setNpRef] = useState('');
  const [npBarcode, setNpBarcode] = useState('');
  const [npUnitPrice, setNpUnitPrice] = useState('');
  const [npDiscount, setNpDiscount] = useState('0');
  const [npQty, setNpQty] = useState('1');
  const searchTimersRef = useRef({});
  const dropdownRef = useRef(null);
  const invoiceFileRef = useRef(null);

  useEffect(() => {
    const fromNav = location.state?.header;
    let h = fromNav;
    if (!h) {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (raw) h = JSON.parse(raw);
      } catch {
        h = null;
      }
    }
    if (h?.supplierCompanyName && h?.invoiceNumber && h?.invoiceDate && h?.supplierPhone) {
      if (h.paymentMode === 'credit' && !h.paymentDueDate) {
        h = { ...h, paymentDueDate: addDaysISO(h.invoiceDate, 30) };
      }
      setHeader(h);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(h));
    } else {
      navigate('/purchases', { replace: true });
    }
  }, [location.state, navigate]);

  useEffect(() => {
    return () => {
      if (invoicePreviewUrl) URL.revokeObjectURL(invoicePreviewUrl);
    };
  }, [invoicePreviewUrl]);

  useEffect(() => {
    const close = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownRowKey(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const fetchProductSuggestions = useCallback(
    async (rowKey, rawTerm) => {
      const term = rawTerm.trim();
      if (!store?.id || term.length < 2) {
        setSuggestionsByRow((prev) => ({ ...prev, [rowKey]: [] }));
        return;
      }
      setSearchLoadingKey(rowKey);
      const safe = escapeIlike(term);
      const pattern = `%${safe}%`;
      const sel =
        'id, barcode, reference, eng_name, full_price, price_after_disc, brand_group';
      try {
        const [r1, r2, r3] = await Promise.all([
          supabase
            .from(PRODUCTS_TABLE)
            .select(sel)
            .eq('store_id', store.id)
            .ilike('barcode', pattern)
            .limit(8),
          supabase
            .from(PRODUCTS_TABLE)
            .select(sel)
            .eq('store_id', store.id)
            .ilike('reference', pattern)
            .limit(8),
          supabase
            .from(PRODUCTS_TABLE)
            .select(sel)
            .eq('store_id', store.id)
            .ilike('eng_name', pattern)
            .limit(8),
        ]);
        const err = r1.error || r2.error || r3.error;
        if (err) throw err;
        const map = new Map();
        [r1.data, r2.data, r3.data].forEach((arr) => {
          (arr || []).forEach((p) => {
            if (p?.id) map.set(p.id, p);
          });
        });
        setSuggestionsByRow((prev) => ({
          ...prev,
          [rowKey]: Array.from(map.values()).slice(0, 12),
        }));
      } catch (e) {
        console.warn('product search', e);
        setSuggestionsByRow((prev) => ({ ...prev, [rowKey]: [] }));
      } finally {
        setSearchLoadingKey(null);
      }
    },
    [store?.id]
  );

  const scheduleSearch = useCallback(
    (rowKey, term) => {
      if (searchTimersRef.current[rowKey]) clearTimeout(searchTimersRef.current[rowKey]);
      searchTimersRef.current[rowKey] = setTimeout(() => {
        fetchProductSuggestions(rowKey, term);
      }, 280);
    },
    [fetchProductSuggestions]
  );

  const linePayloads = useMemo(
    () => computePurchaseLinePayloads(lines, landedCostExtra),
    [lines, landedCostExtra]
  );

  const grandTotal = useMemo(
    () => linePayloads.reduce((a, x) => a + x.line_total, 0),
    [linePayloads]
  );

  const landingTotal = useMemo(
    () => Math.max(0, parseFloat(String(landedCostExtra).replace(',', '.')) || 0),
    [landedCostExtra]
  );

  const productIdsForPreOrders = useMemo(
    () => [...new Set(lines.map((l) => l.productId).filter(Boolean))],
    [lines]
  );

  const reservationsByProduct = useMemo(
    () => groupReservationsByProduct(preOrderReservations),
    [preOrderReservations]
  );

  useEffect(() => {
    if (!store?.id || productIdsForPreOrders.length === 0) {
      setPreOrderReservations([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchPendingReservationsForProducts(store.id, productIdsForPreOrders);
        if (!cancelled) setPreOrderReservations(rows);
      } catch (e) {
        console.warn('pre-order reservations', e);
        if (!cancelled) setPreOrderReservations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store?.id, productIdsForPreOrders]);

  const updateLine = useCallback((key, field, value) => {
    setLines((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, [field]: value };
        if (field === 'barcode' || field === 'reference') {
          if (field === 'barcode' && row.productId && value !== row.barcode) {
            next.productId = null;
            next.productName = '';
            next.sellPrice = null;
            next.stockFullPrice = null;
            next.brandGroup = '';
            next.expiryDate = '';
            next.serialInput = '';
          }
        }
        return next;
      })
    );
  }, []);

  const pickProduct = useCallback((rowKey, p) => {
    setLines((prev) =>
      prev.map((r) =>
        r.key !== rowKey
          ? r
          : {
              ...r,
              barcode: String(p.barcode || '').trim(),
              reference: String(p.reference ?? '').trim(),
              productId: p.id,
              productName: String(p.eng_name ?? '')
                .trim()
                .slice(0, 80),
              sellPrice:
                Number(p.price_after_disc) > 0
                  ? Number(p.price_after_disc)
                  : Number(p.full_price) || 0,
              stockFullPrice: Number(p.full_price) || 0,
              brandGroup: String(p.brand_group ?? '').trim().slice(0, 80),
            }
      )
    );
    setSuggestionsByRow((prev) => ({ ...prev, [rowKey]: [] }));
    setDropdownRowKey(null);
  }, []);

  const addRow = () => setLines((prev) => [...prev, newLine()]);
  const removeRow = (key) =>
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));

  const duplicateRow = useCallback((key) => {
    setLines((prev) => {
      const idx = prev.findIndex((r) => r.key === key);
      if (idx === -1) return prev;
      const src = prev[idx];
      const copy = {
        ...newLine(),
        barcode: src.barcode,
        reference: src.reference,
        unit_price: src.unit_price,
        discount_percent: src.discount_percent,
        qty: src.qty,
        productId: src.productId,
        productName: src.productName,
        sellPrice: src.sellPrice,
        stockFullPrice: src.stockFullPrice,
        brandGroup: src.brandGroup,
        expiryDate: '',
        serialInput: '',
      };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  }, []);

  const searchProductsForModal = useCallback(
    async (q) => {
      const term = q.trim();
      if (!store?.id || term.length < 2) {
        setProductSearchResults([]);
        return;
      }
      setProductSearchLoading(true);
      const safe = escapeIlike(term);
      const pattern = `%${safe}%`;
      const sel = 'id, barcode, reference, eng_name, full_price, price_after_disc, brand_group, stock_count';
      try {
        const [r1, r2, r3] = await Promise.all([
          supabase.from(PRODUCTS_TABLE).select(sel).eq('store_id', store.id).ilike('eng_name', pattern).limit(12),
          supabase.from(PRODUCTS_TABLE).select(sel).eq('store_id', store.id).ilike('barcode', pattern).limit(8),
          supabase.from(PRODUCTS_TABLE).select(sel).eq('store_id', store.id).ilike('reference', pattern).limit(8),
        ]);
        const map = new Map();
        [r1.data, r2.data, r3.data].forEach((arr) =>
          (arr || []).forEach((p) => { if (p?.id) map.set(p.id, p); })
        );
        setProductSearchResults(Array.from(map.values()).slice(0, 20));
      } catch (e) {
        console.warn('product modal search', e);
        setProductSearchResults([]);
      } finally {
        setProductSearchLoading(false);
      }
    },
    [store?.id]
  );

  const addProductFromSearch = useCallback((p) => {
    const line = newLine();
    setLines((prev) => [
      ...prev,
      {
        ...line,
        barcode: String(p.barcode || '').trim(),
        reference: String(p.reference ?? '').trim(),
        productId: p.id,
        productName: String(p.eng_name ?? '').trim().slice(0, 80),
        sellPrice: Number(p.price_after_disc) > 0 ? Number(p.price_after_disc) : Number(p.full_price) || 0,
        stockFullPrice: Number(p.full_price) || 0,
        brandGroup: String(p.brand_group ?? '').trim().slice(0, 80),
      },
    ]);
    setProductSearchOpen(false);
    setProductSearchQuery('');
    setProductSearchResults([]);
  }, []);

  const openNewProductModal = useCallback(() => {
    setNpEngName('');
    setNpRef('');
    setNpBarcode('');
    setNpUnitPrice('');
    setNpDiscount('0');
    setNpQty('1');
    setNewProductOpen(true);
  }, []);

  const handleNewProductSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      if (!store?.id) return;
      if (!npEngName.trim()) {
        toast.warning('أدخل اسم المنتج.');
        return;
      }
      const up0 = parseFloat(String(npUnitPrice).replace(',', '.')) || 0;
      if (up0 < 0) {
        toast.warning('سعر الشراء غير صالح.');
        return;
      }
      const qi0 = Math.max(0, parseFloat(String(npQty).replace(',', '.')) || 0);
      if (qi0 <= 0) {
        toast.warning('العدد يجب أن يكون أكبر من صفر.');
        return;
      }
      setNewProductSaving(true);
      try {
        const p = await insertNewProductForPurchase(supabase, store.id, {
          engName: npEngName,
          reference: npRef,
          barcode: npBarcode,
          unitPrice: npUnitPrice,
          discountPercent: npDiscount,
        });
        const fp = Number(p.full_price) || 0;
        const pad = Number(p.price_after_disc);
        const line = newLine();
        const refShow = String(p.reference ?? npRef ?? '').trim();
        const nameShow = String(p.eng_name ?? npEngName).slice(0, 80);
        setLines((prev) => [
          ...prev,
          {
            ...line,
            barcode: String(p.barcode || ''),
            reference: refShow || nameShow,
            productId: p.id,
            productName: nameShow,
            sellPrice: pad > 0 ? pad : fp,
            stockFullPrice: fp,
            brandGroup: String(p.brand_group ?? '').trim().slice(0, 80),
            unit_price: npUnitPrice,
            discount_percent: npDiscount,
            qty: npQty,
          },
        ]);
        setNewProductOpen(false);
      } catch (err) {
        toast.error(err?.message || String(err));
      } finally {
        setNewProductSaving(false);
      }
    },
    [store?.id, npEngName, npRef, npBarcode, npUnitPrice, npDiscount, npQty, toast]
  );

  const handleInvoiceFileChosen = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    invoiceFileRef.current?.removeAttribute('capture');
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      toast.warning('يرجى اختيار ملف صورة.');
      return;
    }
    if (f.size > 12 * 1024 * 1024) {
      toast.warning('حجم الملف كبير جداً (الحد 12 ميجابايت).');
      return;
    }
    setInvoicePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
    setInvoiceScanFile(f);
  };

  const clearInvoiceScan = () => {
    setInvoicePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setInvoiceScanFile(null);
  };

  const openInvoiceGallery = () => {
    const el = invoiceFileRef.current;
    if (el) el.removeAttribute('capture');
    el?.click();
  };

  const openInvoiceCamera = () => {
    const el = invoiceFileRef.current;
    if (el) el.setAttribute('capture', 'environment');
    el?.click();
  };

  const handleSavePurchase = async () => {
    if (!store?.id || !header) return;

    let linesForSave = lines;
    try {
      linesForSave = await resolvePurchaseLinesNewProducts(supabase, store.id, lines);
    } catch (e) {
      toast.error(e?.message || String(e));
      return;
    }

    const linePayloadsForSave = computePurchaseLinePayloads(linesForSave, landedCostExtra);
    const grandTotalSave = linePayloadsForSave.reduce((a, x) => a + x.line_total, 0);

    if (grandTotalSave <= 0) {
      toast.warning('أضف أصنافاً بمبالغ صحيحة — المجموع يجب أن يكون أكبر من صفر');
      return;
    }

    const validLines = linePayloadsForSave.filter((x) => x.qty > 0 && x.unit_price >= 0);
    if (validLines.length === 0) {
      toast.warning('أدخل سطراً واحداً على الأقل بكمية وسعر');
      return;
    }

    const phoneNorm = normalizeDigitsToLatin(String(header.supplierPhone).trim());
    const companyName = String(header.supplierCompanyName || '').trim();
    const invoiceNumber = normalizeDigitsToLatin(String(header.invoiceNumber || '').trim());
    const invoiceDateVal = String(header.invoiceDate || '').trim().slice(0, 10);
    const paymentMode = header.paymentMode === 'credit' ? 'credit' : 'cash';
    const paymentDueDateVal =
      paymentMode === 'credit'
        ? String(header.paymentDueDate || addDaysISO(invoiceDateVal, 30)).trim().slice(0, 10)
        : null;

    setSaving(true);

    try {
      let invoiceScanPath = null;
      if (invoiceScanFile) {
        invoiceScanPath = await uploadPurchaseInvoiceScan(store.id, invoiceScanFile);
      }

      let supplierContactId = null;
      if (paymentMode === 'credit') {
        const { contactId } = await upsertSupplierForCreditDraft(phoneNorm, companyName, store.id);
        supplierContactId = contactId;
      }

      const notesText = [
        `شركة: ${companyName}`,
        `رقم فاتورة المورد: ${invoiceNumber}`,
        `تاريخ الفاتورة: ${invoiceDateVal}`,
        paymentDueDateVal && `استحقاق السداد: ${paymentDueDateVal}`,
        `هاتف: ${phoneNorm}`,
        extraNotes.trim() && `ملاحظات: ${extraNotes.trim()}`,
      ]
        .filter(Boolean)
        .join('\n');

      const landingPart = landingTotal > 0 ? { landed_cost_extra: landingTotal } : {};
      const duePart = paymentDueDateVal ? { payment_due_date: paymentDueDateVal } : {};
      const scanPart = invoiceScanPath ? { invoice_scan_path: invoiceScanPath } : {};

      /** أعمدة أساسية: supplier_contact_id (uuid أو null)، line_items (jsonb)، total_amount */
      const rowFull = {
        store_id: store.id,
        supplier_contact_id: supplierContactId,
        supplier_company_name: companyName,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDateVal,
        supplier_phone: phoneNorm,
        total_amount: grandTotalSave,
        payment_mode: paymentMode,
        purchase_status: purchaseStatus === 'draft' ? 'draft' : 'received',
        ...duePart,
        ...scanPart,
        ...landingPart,
        line_items: validLines,
        notes: notesText,
      };

      let purchaseId = null;
      const { data: insData, error: insErr } = await supabase
        .from(PURCHASES_TABLE)
        .insert([rowFull])
        .select('id')
        .single();
      if (insErr) throw insErr;
      purchaseId = insData?.id ?? null;

      if (purchaseStatus === 'received') {
        try {
          await executePurchaseReceiveEffects({
            storeId: store.id,
            purchaseId,
            lines: linesForSave,
            linePayloads: linePayloadsForSave,
            updateCatalogCosts,
            companyName,
            invoiceDateVal,
            paymentMode,
            supplierContactId,
            grandTotal: grandTotalSave,
          });
        } catch (stockErr) {
          console.error(stockErr);
          if (purchaseId) {
            await supabase.from(PURCHASES_TABLE).delete().eq('id', purchaseId).eq('store_id', store.id);
          }
          throw stockErr instanceof Error ? stockErr : new Error(String(stockErr?.message || stockErr));
        }
      }

      sessionStorage.removeItem(STORAGE_KEY);
      navigate('/purchases', {
        replace: true,
        state: { purchaseSaved: true, total: grandTotalSave },
      });
    } catch (e) {
      console.error(e);
      const msg = e?.message || e?.details || e?.hint || '';
      toast.error(msg.trim() ? msg : 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  if (storeLoading || !header) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="animate-spin text-indigo-500" size={40} />
        </div>
      </DashboardLayout>
    );
  }

  if (!store?.id) {
    return (
      <DashboardLayout>
        <div className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center font-bold" dir="rtl">
          لا يوجد متجر مرتبط بحسابك.
        </div>
      </DashboardLayout>
    );
  }

  /** أسطر تؤثر على المخزن: مربوطة بمنتج أو جاهزة لإنشاء صنف جديد عند الحفظ */
  const hasLinkedLines =
    lines.some((r) => r.productId) ||
    lines.some((r) => {
      if (r.productId) return false;
      const q = stockQtyFromLine(r);
      const u = Math.max(0, parseFloat(String(r.unit_price).replace(',', '.')) || 0);
      return q > 0 && u >= 0;
    });

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap items-center gap-4">
          <Link
            to="/purchases/history"
            className="text-sm font-bold text-violet-600 hover:text-violet-800"
          >
            سجل المشتريات والمرتجعات
          </Link>
          <Link
            to="/purchases"
            className="text-sm font-bold text-slate-600 hover:text-indigo-600"
          >
            ← رجوع لتعديل رأس الفاتورة
          </Link>
        </div>
      }
    >
      <div className="space-y-6 max-w-[1200px] mx-auto" dir="rtl">
        <div className="rounded-2xl border border-violet-200 bg-gradient-to-l from-violet-50/80 to-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <ShoppingBag className="text-violet-600" size={22} />
                تفاصيل فاتورة المشتريات
              </h2>
              <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                <div>
                  <dt className="text-[11px] font-bold text-slate-400">الشركة</dt>
                  <dd className="font-bold text-slate-800">{header.supplierCompanyName}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-slate-400">رقم الفاتورة</dt>
                  <dd className="font-currency font-bold" dir="ltr" lang="en">
                    {normalizeDigitsToLatin(String(header.invoiceNumber ?? ''))}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-slate-400">تاريخ الفاتورة</dt>
                  <dd className="font-currency font-bold" dir="ltr" lang="en">
                    {formatInvoiceDateLabel(header.invoiceDate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-slate-400">هاتف المورد</dt>
                  <dd className="font-currency font-bold" dir="ltr" lang="en">
                    {normalizeDigitsToLatin(header.supplierPhone)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-slate-400">الدفع</dt>
                  <dd>
                    <span
                      className={`inline-block rounded-full px-3 py-0.5 text-xs font-black ${
                        header.paymentMode === 'credit'
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {header.paymentMode === 'credit' ? 'آجل (ذمة)' : 'كاش'}
                    </span>
                  </dd>
                </div>
                {header.paymentMode === 'credit' && header.paymentDueDate && (
                  <div className="sm:col-span-2">
                    <dt className="text-[11px] font-bold text-slate-400">استحقاق السداد</dt>
                    <dd className="font-currency font-bold text-amber-900" dir="ltr" lang="en">
                      {formatInvoiceDateLabel(header.paymentDueDate)}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
            <div className="text-left">
              <p className="text-[11px] font-bold text-slate-400">إجمالي الأسطر</p>
              <p className="text-2xl font-black text-violet-700 font-currency" dir="ltr" lang="en">
                ₪{' '}
                {grandTotal.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-xs text-indigo-900 leading-relaxed">
          <strong className="font-black">بحث ذكي:</strong> اكتب حرفين على الأقل في الباركود أو المرجع
          لعرض أصناف المخزن وتعبئة البيانات. عند ربط صنف يُعرض هامش الربح مقارنة بسعر البيع الحالي،
          واقتراح سعر بيع بربح {TARGET_MARGIN * 100}% على التكلفة. عند التفعيل أدناه يُحدَّث{' '}
          <strong>متوسط تكلفة الشراء المرجح</strong> في <code className="bg-white/80 px-1 rounded">full_price</code>{' '}
          مع كل استلام.
          <span className="block mt-2">
            <strong className="font-black">صنف جديد:</strong> استخدم زر «منتج جديد» بجانب «سطر جديد» لإنشاء
            الصنف فوراً وربطه بالفاتورة؛ أو املأ سطراً يدوياً دون اختيار من البحث — يُنشأ المنتج تلقائياً عند
            الحفظ. الباركود الفارغ يُولَّد داخلياً (يبدأ بـ 8).
          </span>
          <span className="block mt-2">
            <strong className="font-black">المخزن:</strong>{' '}
            {purchaseStatus === 'received'
              ? 'الأصناف المربوطة تُحدَّث كمياتها فور الحفظ.'
              : 'في وضع المسودة لا يُحدَّث المخزن — استخدم «تأكيد الاستلام» من سجل المشتريات عند وصول البضاعة.'}
            المصاريف الواصلة (شحن، عمال…) تُوزَّع تلقائياً على أسطر الفاتورة بنسبة قيمة كل سطر لتقدير{' '}
            <strong>تكلفة الوحدة الواصلة (Landed Cost)</strong> والربح الصافي.
          </span>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3">
          <label className="block text-xs font-black text-amber-900 mb-2">حالة الطلبية</label>
          <select
            value={purchaseStatus}
            onChange={(e) => setPurchaseStatus(e.target.value)}
            className="w-full max-w-md rounded-xl border border-amber-300 bg-white px-3 py-2.5 text-sm font-bold text-amber-950"
          >
            <option value="draft">مسودة — طلبية مسجّلة، البضاعة لم تُستلم للمخزن بعد</option>
            <option value="received">تم الاستلام — إدخال للمخزن وتطبيق التكلفة فور الحفظ</option>
          </select>
          <p className="text-[11px] text-amber-800/90 mt-2 leading-relaxed">
            استخدم المسودة لتتبّع ما طلبته من المورد قبل وصول الشحنة. عند الاستلام يمكن تأكيدها من «سجل
            المشتريات» إن حفظت كمسودة.
          </p>
        </div>

        {hasLinkedLines && purchaseStatus === 'received' && (
          <label className="flex items-center gap-3 cursor-pointer rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm font-bold text-emerald-900">
            <input
              type="checkbox"
              checked={updateCatalogCosts}
              onChange={(e) => setUpdateCatalogCosts(e.target.checked)}
              className="rounded border-emerald-400 text-emerald-600 focus:ring-emerald-500"
            />
            <span>
              تطبيق <strong>متوسط تكلفة شراء مرجح (WAC)</strong> على full_price — يجمع الكمية القديمة
              والجديدة كما في مثال مولينكس (100 ثم 120). عند الإلغاء: زيادة مخزن فقط دون تعديل التكلفة.
            </span>
          </label>
        )}
        {hasLinkedLines && purchaseStatus === 'draft' && (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">
            خيار متوسط التكلفة المرجح يظهر بعد اختيار «تم الاستلام» أو عند تأكيد المسودة لاحقاً.
          </p>
        )}

        <input
          ref={invoiceFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleInvoiceFileChosen}
        />

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
              <ImagePlus size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-black text-slate-900">صورة فاتورة المورد الأصلية (اختياري)</h3>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                احفظ صورة الورقية أو PDF كصورة للرجوع إليها عند الخلاف على الأرقام. يُرفع مع الحفظ إلى
                التخزين.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  onClick={openInvoiceGallery}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                >
                  <Upload size={16} />
                  من الملفات
                </button>
                <button
                  type="button"
                  onClick={openInvoiceCamera}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-800 hover:bg-violet-100"
                >
                  <Camera size={16} />
                  كاميرا
                </button>
                {invoiceScanFile && (
                  <button
                    type="button"
                    onClick={clearInvoiceScan}
                    className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50"
                  >
                    <X size={16} />
                    إزالة
                  </button>
                )}
              </div>
            </div>
            {invoicePreviewUrl && (
              <div className="relative shrink-0 rounded-xl border border-slate-200 overflow-hidden bg-slate-100 max-w-[200px]">
                <img
                  src={invoicePreviewUrl}
                  alt="معاينة فاتورة المورد"
                  className="max-h-36 w-auto object-contain mx-auto block"
                />
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-black text-slate-800 text-sm">أصناف الفاتورة</h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setProductSearchOpen(true);
                  setProductSearchQuery('');
                  setProductSearchResults([]);
                  setTimeout(() => productSearchInputRef.current?.focus(), 50);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border-2 border-indigo-400 bg-indigo-50 text-indigo-900 text-xs font-black px-3 py-2 hover:bg-indigo-100"
                title="بحث عن منتج موجود في المخزن وإضافته للفاتورة"
              >
                <Search size={15} />
                بحث منتج
              </button>
              <button
                type="button"
                onClick={openNewProductModal}
                className="inline-flex items-center gap-1.5 rounded-xl border-2 border-emerald-500 bg-emerald-50 text-emerald-900 text-xs font-black px-3 py-2 hover:bg-emerald-100"
                title="إنشاء صنف في المخزن وإضافته كسطر في الفاتورة"
              >
                <PackagePlus size={17} strokeWidth={2.25} />
                منتج جديد
              </button>
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 text-white text-xs font-black px-3 py-2 hover:bg-violet-700"
              >
                <Plus size={16} />
                سطر جديد
              </button>
            </div>
          </div>

          {preOrderReservations.length > 0 && (
            <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50/90 dark:bg-amber-950/30 dark:border-amber-800/50 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
              <div className="flex items-start gap-2">
                <AlertTriangle className="shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" size={18} />
                <div className="min-w-0">
                  <p className="font-black">
                    هذا الصنف محجوز لزبون — هل تريد تخصيصه له عند الاستلام؟ راجع الحجز أدناه.
                  </p>
                  <ul className="mt-2 space-y-1 text-xs leading-relaxed">
                    {preOrderReservations.map((r) => (
                      <li key={r.lineId}>
                        طلب حجز #{r.orderNo} —{' '}
                        <span className="font-bold">{r.customerName}</span>
                        {r.customerPhone ? (
                          <span className="font-mono" dir="ltr">
                            {' '}
                            {r.customerPhone}
                          </span>
                        ) : null}
                        {' — '}
                        كمية محجوزة: <span className="font-currency">{r.qty}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/sales/preorders"
                    className="inline-block mt-2 text-xs font-bold text-violet-700 dark:text-violet-300 hover:underline"
                  >
                    فتح صفحة الحجوزات والتسليم
                  </Link>
                </div>
              </div>
            </div>
          )}

          <div className="overflow-x-auto" ref={dropdownRef}>
            <table className="w-full text-xs min-w-[1100px]">
              <thead>
                <tr className="bg-slate-100/90 text-slate-600 border-b border-slate-200">
                  <th className="text-right py-3 px-2 font-bold w-10">#</th>
                  <th className="text-right py-3 px-2 font-bold min-w-[140px]" dir="ltr">
                    الباركود
                  </th>
                  <th className="text-right py-3 px-2 font-bold min-w-[120px]" dir="ltr">
                    المرجع
                  </th>
                  <th className="text-right py-3 px-2 font-bold w-32" dir="ltr">
                    سعر الشراء
                  </th>
                  <th className="text-right py-3 px-2 font-bold w-20" dir="ltr">
                    خصم %
                  </th>
                  <th className="text-right py-3 px-2 font-bold w-20" dir="ltr">
                    العدد
                  </th>
                  <th className="text-right py-3 px-2 font-bold w-28" dir="ltr">
                    المجموع
                  </th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {lines.map((row, idx) => {
                  const pl = linePayloads[idx];
                  const landedU = Number(pl?.landed_unit_extra || 0);
                  const lt = computeLineTotal(row.unit_price, row.discount_percent, row.qty);
                  const cost = effectiveUnitCostFromRow(row);
                  const costLanded = Math.round((cost + landedU) * 10000) / 10000;
                  const sell = row.sellPrice != null ? Number(row.sellPrice) : null;
                  const profit =
                    sell != null && costLanded >= 0 ? Math.round((sell - costLanded) * 100) / 100 : null;
                  const marginPct =
                    profit != null && costLanded > 0
                      ? Math.round((profit / costLanded) * 10000) / 100
                      : null;
                  const suggestedSell = suggestedSellAtMargin(costLanded);
                  const storeDiff =
                    row.productId &&
                    row.stockFullPrice != null &&
                    Math.abs(Number(row.stockFullPrice) - costLanded) >= 0.01;
                  const electrical = isElectricalProduct({
                    brandGroup: row.brandGroup,
                    productName: row.productName,
                  });

                  const sug = suggestionsByRow[row.key] || [];
                  const showDrop = dropdownRowKey === row.key && sug.length > 0;
                  const serialsParsed = parseSerialList(row.serialInput);
                  const qtyInt = stockQtyFromLine(row);
                  const serialMismatch =
                    serialsParsed.length > 0 && qtyInt > 0 && serialsParsed.length !== qtyInt;

                  return (
                    <Fragment key={row.key}>
                    <tr className="border-b border-slate-50 hover:bg-slate-50/50 align-top">
                      <td className="py-2 px-2 text-slate-400 font-bold text-center font-currency" lang="en">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-2 relative">
                        <input
                          value={row.barcode}
                          onChange={(e) => {
                            const v = normalizeDigitsToLatin(e.target.value);
                            updateLine(row.key, 'barcode', v);
                            setDropdownRowKey(row.key);
                            scheduleSearch(row.key, v);
                          }}
                          onFocus={() => {
                            setDropdownRowKey(row.key);
                            if ((row.barcode || '').trim().length >= 2) {
                              fetchProductSuggestions(row.key, row.barcode);
                            }
                          }}
                          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 font-currency"
                          dir="ltr"
                          lang="en"
                          placeholder="بحث…"
                        />
                        {searchLoadingKey === row.key && (
                          <Loader2 className="absolute left-2 top-2.5 w-3.5 h-3.5 animate-spin text-violet-500" />
                        )}
                        {showDrop && (
                          <ul className="absolute z-50 right-0 left-0 mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl text-[11px]">
                            {sug.map((p) => (
                              <li key={p.id}>
                                <button
                                  type="button"
                                  className="w-full text-right px-2 py-2 hover:bg-violet-50 border-b border-slate-50 last:border-0"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    pickProduct(row.key, p);
                                  }}
                                >
                                  <span className="font-bold text-slate-800 block truncate">
                                    {p.eng_name || '—'}
                                  </span>
                                  <span className="font-currency text-slate-500" dir="ltr" lang="en">
                                    {p.barcode} · مرجع {p.reference || '—'}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {row.productName && (
                          <p className="mt-1 text-[10px] text-violet-700 font-bold truncate" title={row.productName}>
                            {row.productName}
                          </p>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <input
                          value={row.reference}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateLine(row.key, 'reference', v);
                            setDropdownRowKey(row.key);
                            scheduleSearch(row.key, v);
                          }}
                          onFocus={() => {
                            setDropdownRowKey(row.key);
                            if ((row.reference || '').trim().length >= 2) {
                              fetchProductSuggestions(row.key, row.reference);
                            }
                          }}
                          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 font-currency"
                          dir="ltr"
                          lang="en"
                          placeholder="بحث…"
                        />
                        <p className="text-[9px] text-slate-400 mt-0.5">القائمة تظهر تحت الباركود</p>
                      </td>
                      <td className="py-2 px-2">
                        <input
                          value={row.unit_price}
                          onChange={(e) => updateLine(row.key, 'unit_price', e.target.value)}
                          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 font-currency"
                          dir="ltr"
                          lang="en"
                          inputMode="decimal"
                        />
                        {row.productId && sell != null && cost >= 0 && (
                          <div className="mt-1.5 space-y-0.5 text-[10px] leading-snug">
                            <div className="flex items-start gap-1 text-emerald-800">
                              <TrendingUp size={12} className="shrink-0 mt-0.5" />
                              <span dir="ltr" lang="en">
                                تكلفة/وحدة (بعد خصم{landedU > 0 ? ' +واصل' : ''}): ₪
                                {costLanded.toFixed(2)}
                                {landedU > 0 && (
                                  <span className="text-slate-600">
                                    {' '}
                                    (أساس ₪{cost.toFixed(2)} + واصل ₪{landedU.toFixed(4)})
                                  </span>
                                )}{' '}
                                · بيع حالي: ₪
                                {sell.toFixed(2)}
                                {profit != null && (
                                  <>
                                    {' '}
                                    → ربح <strong>₪{profit.toFixed(2)}</strong>
                                    {marginPct != null && (
                                      <span className="text-slate-600"> ({marginPct}% على التكلفة)</span>
                                    )}
                                  </>
                                )}
                              </span>
                            </div>
                            {suggestedSell != null && (
                              <div className="text-indigo-700 font-bold" dir="ltr" lang="en">
                                بيع مقترح +{TARGET_MARGIN * 100}%: ₪{suggestedSell.toFixed(2)}
                              </div>
                            )}
                            {storeDiff && (
                              <div className="text-amber-800 font-bold">
                                يختلف عن تكلفة المخزن الحالية (₪
                                {Number(row.stockFullPrice).toFixed(2)}) — يُحدَّث عند الحفظ إن فعّلت
                                الخيار أعلاه
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <input
                          value={row.discount_percent}
                          onChange={(e) => updateLine(row.key, 'discount_percent', e.target.value)}
                          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 font-currency"
                          dir="ltr"
                          lang="en"
                          inputMode="decimal"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          value={row.qty}
                          onChange={(e) => updateLine(row.key, 'qty', e.target.value)}
                          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 font-currency"
                          dir="ltr"
                          lang="en"
                          inputMode="decimal"
                        />
                      </td>
                      <td className="py-2 px-2 font-black text-slate-800 font-currency whitespace-nowrap" dir="ltr" lang="en">
                        ₪ {lt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 px-1 text-center align-middle">
                        <div className="flex flex-col gap-1 items-center justify-center">
                          <button
                            type="button"
                            title="تكرار السطر"
                            aria-label="تكرار السطر"
                            onClick={() => duplicateRow(row.key)}
                            className="p-1.5 rounded-lg text-violet-600 hover:bg-violet-50"
                          >
                            <Copy size={16} />
                          </button>
                          <button
                            type="button"
                            title="حذف السطر"
                            aria-label="حذف السطر"
                            onClick={() => removeRow(row.key)}
                            disabled={lines.length <= 1}
                            className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 disabled:opacity-30"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    <tr className="border-b border-slate-100 bg-slate-50/40">
                      <td className="py-2 px-2" />
                      <td className="py-2 px-2" colSpan={6}>
                        <div className="flex flex-wrap items-start gap-4">
                          {row.productId && (reservationsByProduct.get(row.productId) || []).length > 0 ? (
                            <div className="w-full rounded-lg border border-amber-200 bg-amber-50/70 dark:bg-amber-950/40 dark:border-amber-800/60 px-2 py-1.5 text-[11px] text-amber-950 dark:text-amber-100">
                              <span className="font-black">حجز مسبق على هذا الصنف: </span>
                              {(reservationsByProduct.get(row.productId) || []).map((r) => (
                                <span key={r.lineId} className="inline-block ms-2">
                                  {r.customerName} (حجز #{r.orderNo}، كمية {r.qty})
                                </span>
                              ))}
                              {' — '}
                              <Link
                                to="/sales/preorders"
                                className="font-bold text-violet-700 dark:text-violet-300 underline-offset-2 hover:underline"
                              >
                                صفحة الحجوزات
                              </Link>
                            </div>
                          ) : null}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 mb-1">
                              صلاحية (اختياري)
                            </label>
                            <input
                              type="date"
                              value={row.expiryDate}
                              onChange={(e) => updateLine(row.key, 'expiryDate', e.target.value)}
                              className="rounded-lg border border-slate-200 px-2 py-1.5 font-currency text-[11px] bg-white"
                              dir="ltr"
                              lang="en"
                            />
                          </div>
                          {row.productId && electrical ? (
                            <div className="flex-1 min-w-[220px]">
                              <label className="block text-[10px] font-bold text-slate-500 mb-1">
                                سيريال / IMEI (جهاز كهربائي){' '}
                                {row.brandGroup ? (
                                  <span className="text-violet-600 font-bold">— {row.brandGroup}</span>
                                ) : null}
                              </label>
                              <input
                                type="text"
                                inputMode="text"
                                autoCapitalize="characters"
                                placeholder="امسح الباركود ثم Enter لإضافة كل قطعة"
                                className="w-full rounded-lg border border-amber-200 bg-amber-50/50 px-2 py-1.5 font-currency text-[11px] mb-2"
                                dir="ltr"
                                lang="en"
                                onKeyDown={(e) => {
                                  if (e.key !== 'Enter') return;
                                  e.preventDefault();
                                  const v = String(e.currentTarget.value || '').trim();
                                  if (!v) return;
                                  const cur = row.serialInput || '';
                                  updateLine(
                                    row.key,
                                    'serialInput',
                                    cur ? `${cur}\n${v}` : v
                                  );
                                  e.currentTarget.value = '';
                                }}
                              />
                              <textarea
                                value={row.serialInput}
                                onChange={(e) => updateLine(row.key, 'serialInput', e.target.value)}
                                rows={2}
                                placeholder="قائمة السيريالات — سطر أو فاصلة لكل قطعة"
                                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 font-currency text-[11px] bg-white resize-y min-h-[44px]"
                                dir="ltr"
                                lang="en"
                              />
                              {serialMismatch && (
                                <p className="text-[10px] text-amber-800 font-bold mt-1">
                                  عدد التسلسلات ({serialsParsed.length}) لا يطابق العدد ({qtyInt}) — راجع
                                  للكفالة.
                                </p>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2 px-1" />
                    </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-4 border-t border-slate-100 bg-slate-50/50 space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">
                مصاريف إضافية (نقل، تنزيل…) ₪ — تُوزَّع على الأصناف بنسبة قيمة كل سطر
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={landedCostExtra}
                onChange={(e) => setLandedCostExtra(e.target.value)}
                className="w-full max-w-xs rounded-xl border border-slate-200 px-3 py-2 text-sm font-currency bg-white"
                dir="ltr"
                lang="en"
                placeholder="0"
              />
              {landingTotal > 0 && grandTotal > 0 && (
                <p className="text-[11px] text-slate-600 mt-2">
                  إجمالي بضاعة الأسطر ₪{grandTotal.toFixed(2)} + مصاريف واصلة ₪{landingTotal.toFixed(2)} = تقدير
                  تكلفة واصلة لكل قطعة في عمود الربح
                  {purchaseStatus === 'received' ? ' والمتوسط المرجح عند الحفظ' : ' (يُطبَّق على المخزن عند الاستلام)'}.
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">ملاحظات إضافية (اختياري)</label>
              <textarea
                value={extraNotes}
                onChange={(e) => setExtraNotes(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm resize-none"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm font-bold text-slate-600">
            المجموع النهائي للفاتورة:{' '}
            <span className="text-violet-700 font-currency" dir="ltr" lang="en">
              ₪{' '}
              {grandTotal.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            {header.paymentMode === 'credit' && purchaseStatus === 'received' && (
              <span className="block text-xs text-amber-800 mt-1">
                عند الحفظ يُضاف هذا المبلغ لذمة المورد (بحث بالهاتف أو إنشاء مورد جديد).
              </span>
            )}
            {header.paymentMode === 'credit' && purchaseStatus === 'draft' && (
              <span className="block text-xs text-amber-800 mt-1">
                مسودة: لا تُزاد الذمة حتى تأكيد الاستلام للمخزن.
              </span>
            )}
            <span className="block text-xs text-slate-500 mt-1">
              {purchaseStatus === 'received'
                ? 'الأصناف المربوطة من المخزن تُزاد كمياتها فور الحفظ (قطع كاملة حسب خانة العدد).'
                : 'المسودة تحفظ الأرقام فقط — المخزن والذمة يُحدَّثان عند تأكيد الاستلام.'}
            </span>
          </p>
          <button
            type="button"
            onClick={handleSavePurchase}
            disabled={saving || grandTotal <= 0}
            className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 text-white font-black px-8 py-4 hover:bg-violet-700 disabled:opacity-50 shadow-lg"
          >
            {saving ? (
              <Loader2 className="animate-spin" size={22} />
            ) : (
              <Save size={22} />
            )}
            {purchaseStatus === 'draft' ? 'حفظ كمسودة' : 'حفظ واستلام للمخزن'}
          </button>
        </div>

        {productSearchOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[10vh] bg-black/50 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={() => { setProductSearchOpen(false); setProductSearchResults([]); setProductSearchQuery(''); }}
          >
            <div
              className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
              dir="rtl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
                <Search size={18} className="text-indigo-500 shrink-0" />
                <input
                  ref={productSearchInputRef}
                  type="text"
                  value={productSearchQuery}
                  onChange={(e) => {
                    setProductSearchQuery(e.target.value);
                    searchProductsForModal(e.target.value);
                  }}
                  placeholder="ابحث بالاسم أو الباركود أو المرجع… (حرفان كحد أدنى)"
                  className="flex-1 bg-transparent text-sm font-bold text-slate-800 placeholder:text-slate-400 focus:outline-none"
                  autoComplete="off"
                />
                {productSearchLoading && <Loader2 size={16} className="animate-spin text-indigo-400 shrink-0" />}
                <button
                  type="button"
                  onClick={() => { setProductSearchOpen(false); setProductSearchResults([]); setProductSearchQuery(''); }}
                  className="p-1 text-slate-400 hover:text-slate-700 shrink-0"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="max-h-[60vh] overflow-y-auto">
                {productSearchQuery.trim().length < 2 ? (
                  <p className="py-10 text-center text-sm text-slate-400 font-bold">
                    اكتب حرفين على الأقل للبحث
                  </p>
                ) : productSearchResults.length === 0 && !productSearchLoading ? (
                  <p className="py-10 text-center text-sm text-slate-400 font-bold">
                    لا توجد منتجات مطابقة
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {productSearchResults.map((p) => {
                      const price = Number(p.price_after_disc) > 0 ? Number(p.price_after_disc) : Number(p.full_price) || 0;
                      const stock = p.stock_count != null ? Number(p.stock_count) : null;
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); addProductFromSearch(p); }}
                            className="w-full text-right px-4 py-3 hover:bg-indigo-50 flex items-start justify-between gap-3"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-black text-sm text-slate-900 truncate">{p.eng_name || '—'}</p>
                              <p className="text-[11px] font-mono text-slate-500 mt-0.5" dir="ltr">
                                {p.barcode || '—'}{p.reference ? ` · ${p.reference}` : ''}
                              </p>
                            </div>
                            <div className="text-left shrink-0 space-y-0.5">
                              <p className="text-sm font-black text-indigo-700 font-currency" dir="ltr">
                                ₪{price.toFixed(2)}
                              </p>
                              {stock != null && (
                                <p className={`text-[11px] font-bold ${stock > 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                                  مخزون: {stock}
                                </p>
                              )}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-400 text-center font-bold">
                اضغط على المنتج لإضافته كسطر جديد في الفاتورة
              </div>
            </div>
          </div>
        )}

        {newProductOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-product-modal-title"
            onClick={() => {
              if (!newProductSaving) setNewProductOpen(false);
            }}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
              dir="rtl"
              onClick={(ev) => ev.stopPropagation()}
            >
              <div className="flex items-start gap-3 mb-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                  <PackagePlus size={22} strokeWidth={2.25} />
                </div>
                <div className="min-w-0">
                  <h3 id="new-product-modal-title" className="text-lg font-black text-slate-900">
                    إضافة منتج جديد
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    يُنشأ الصنف في المخزن فوراً ويُربط بهذا السطر. اترك الباركود فارغاً ليولّد النظام
                    باركوداً داخلياً (يبدأ بـ 8).
                  </p>
                </div>
              </div>
              <form onSubmit={handleNewProductSubmit} className="space-y-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">اسم المنتج *</label>
                  <input
                    value={npEngName}
                    onChange={(e) => setNpEngName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
                    placeholder="مثال: ثلاجة سامسونج 500 لتر"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">مرجع / رمز (اختياري)</label>
                  <input
                    value={npRef}
                    onChange={(e) => setNpRef(normalizeDigitsToLatin(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-currency bg-white"
                    dir="ltr"
                    lang="en"
                    placeholder="REF-123"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">الباركود (اختياري)</label>
                  <input
                    value={npBarcode}
                    onChange={(e) => setNpBarcode(normalizeDigitsToLatin(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-currency bg-white"
                    dir="ltr"
                    lang="en"
                    placeholder="فارغ = توليد تلقائي"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">سعر الشراء *</label>
                    <input
                      value={npUnitPrice}
                      onChange={(e) => setNpUnitPrice(normalizeDigitsToLatin(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-currency bg-white"
                      dir="ltr"
                      lang="en"
                      inputMode="decimal"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">خصم %</label>
                    <input
                      value={npDiscount}
                      onChange={(e) => setNpDiscount(normalizeDigitsToLatin(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-currency bg-white"
                      dir="ltr"
                      lang="en"
                      inputMode="decimal"
                      placeholder="0"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">العدد في الفاتورة</label>
                  <input
                    value={npQty}
                    onChange={(e) => setNpQty(normalizeDigitsToLatin(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-currency bg-white"
                    dir="ltr"
                    lang="en"
                    inputMode="numeric"
                    placeholder="1"
                  />
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!newProductSaving) setNewProductOpen(false);
                    }}
                    className="flex-1 min-w-[6rem] rounded-xl border border-slate-200 py-2.5 text-sm font-black text-slate-600 hover:bg-slate-50"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={newProductSaving}
                    className="flex-1 min-w-[8rem] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-white py-2.5 text-sm font-black hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {newProductSaving ? (
                      <Loader2 className="animate-spin" size={18} />
                    ) : (
                      <PackagePlus size={18} />
                    )}
                    إضافة للفاتورة
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
