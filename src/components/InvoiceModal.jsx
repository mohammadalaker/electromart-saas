import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Receipt, Printer, Download, X, Loader2, AlertCircle, Edit3, Trash2, Plus, Search, Check, Save } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import PrintInvoice from './PrintInvoice';
import NegativeStockConfirmModal from './NegativeStockConfirmModal';
import { generateInvoicePDF } from '../utils/generatePDF';
import { getPublicImageUrl } from '../utils/storageImageUrl';
import {
  calculateStockDeltas,
  checkNegativeStockIssues,
  executeSaleInvoiceEdit,
  searchProductsAndUnits,
  lookupProductOrUnitByBarcode,
} from '../utils/invoiceEditExecution';

const SALES_TABLE = import.meta.env.VITE_SUPABASE_SALES_TABLE?.trim() || 'sales';
const CONTACTS_TABLE = import.meta.env.VITE_SUPABASE_CONTACTS_TABLE?.trim() || 'store_contacts';
const PRODUCTS_TABLE = import.meta.env.VITE_SUPABASE_PRODUCTS_TABLE?.trim() || 'products';

/**
 * دالة مساعدة لتسوية أسطر الفاتورة وجلب أسماء المنتجات وصورها إن لم تكن متوفرة
 */
async function enrichSaleLineItems(supabaseClient, storeId, rawLines) {
  if (!rawLines) return [];
  let lines = rawLines;
  if (typeof rawLines === 'string') {
    try {
      lines = JSON.parse(rawLines);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(lines) || lines.length === 0) return [];

  const productIds = [];
  const barcodes = [];
  for (const l of lines) {
    if (l.product_id) productIds.push(String(l.product_id));
    if (l.barcode) barcodes.push(String(l.barcode));
  }

  const productMap = new Map();
  try {
    if (productIds.length > 0) {
      const { data } = await supabaseClient
        .from(PRODUCTS_TABLE)
        .select('id, name, barcode, price, image, image_url')
        .eq('store_id', storeId)
        .in('id', productIds);
      (data || []).forEach((p) => productMap.set(String(p.id), p));
    }
    if (barcodes.length > 0) {
      const { data } = await supabaseClient
        .from(PRODUCTS_TABLE)
        .select('id, name, barcode, price, image, image_url')
        .eq('store_id', storeId)
        .in('barcode', barcodes);
      (data || []).forEach((p) => {
        if (p.barcode) productMap.set(`b:${p.barcode}`, p);
      });
    }
  } catch (err) {
    console.warn('[InvoiceModal] enrich products error:', err);
  }

  return lines.map((line, idx) => {
    const p =
      (line.product_id && productMap.get(String(line.product_id))) ||
      (line.barcode && productMap.get(`b:${line.barcode}`)) ||
      null;

    const name =
      line.name ||
      line.product_name ||
      line.item_name ||
      p?.name ||
      (line.barcode ? `باركود ${line.barcode}` : `صنف ${idx + 1}`);

    const barcode = line.barcode || p?.barcode || '';
    const qty = Math.max(1, Number(line.qty ?? line.quantity ?? 1) || 1);
    const unitPrice = Number(line.unit_price ?? line.unitPrice ?? 0);
    const lineTotal = Number(
      line.line_total ?? line.lineTotal ?? Math.max(0, unitPrice * qty - Number(line.discount || 0))
    );
    const originalPrice = Number(
      line.original_price ?? line.originalPrice ?? p?.price ?? (unitPrice + (Number(line.discount || 0) / qty))
    );
    const discountPercent =
      Number(line.discountPercent) ||
      (originalPrice > 0 && unitPrice < originalPrice
        ? Math.round(((originalPrice - unitPrice) / originalPrice) * 100)
        : 0);
    const imageUrl = getPublicImageUrl(line.image_url || line.image || p?.image || p?.image_url);
    const serial = line.serial_numbers ? String(line.serial_numbers).trim() : undefined;

    return {
      name,
      barcode,
      qty,
      unitPrice,
      lineTotal,
      originalPrice,
      discountPercent,
      imageUrl,
      serial,
    };
  });
}

/**
 * دالة مساعدة لتسوية بيانات العميل من جدول جهات الاتصال أو نص الملاحظات
 */
async function resolveCustomerDetails(supabaseClient, storeId, contactId, notes) {
  let customerName = '';
  let customerPhone = '';
  let customerEmail = '';
  let customerAddress = '';

  if (contactId) {
    try {
      const { data } = await supabaseClient
        .from(CONTACTS_TABLE)
        .select('name, phone, email, address')
        .eq('store_id', storeId)
        .eq('id', contactId)
        .maybeSingle();
      if (data) {
        customerName = data.name || '';
        customerPhone = data.phone || '';
        customerEmail = data.email || '';
        customerAddress = data.address || '';
      }
    } catch (e) {
      console.warn('[InvoiceModal] fetch customer error:', e);
    }
  }

  // استخراج البيانات من الملاحظات في حال عدم وجودها
  const n = String(notes || '').trim();
  if (!customerName && n) {
    const m = n.match(/الزبون:\s*([^\n]+)/);
    if (m) customerName = m[1].trim();
  }
  if (!customerPhone && n) {
    const m = n.match(/(?:الهاتف|تلفون|جوال|رقم):\s*([^\n]+)/);
    if (m) customerPhone = m[1].trim();
  }
  if (!customerAddress && n) {
    const m = n.match(/(?:العنوان|عنوان):\s*([^\n]+)/);
    if (m) customerAddress = m[1].trim();
  }

  return { customerName, customerPhone, customerEmail, customerAddress };
}

function resolveTenderLabel(sale) {
  const tender = String(sale.pos_tender || '').toLowerCase();
  if (tender === 'check') return 'شيك';
  if (tender === 'visa') return 'بطاقة / فيزا';
  if (tender === 'digital_wallet') return 'محفظة رقمية';

  const mode = String(sale.payment_mode || sale.payment_method || '').toLowerCase();
  if (mode === 'credit') return 'ذمة (آجل)';
  if (mode === 'cash') return 'كاش (نقدي)';
  if (mode === 'visa') return 'بطاقة / فيزا';
  return mode ? String(sale.payment_mode) : 'كاش (نقدي)';
}

function extractCheckDetails(sale) {
  const notes = String(sale.notes || '');
  const lines = [];
  const checkMatches = notes.match(/شيك(?:\s+رقم)?\s*([^\n]+)/gi);
  if (checkMatches) {
    lines.push(...checkMatches);
  }
  return lines;
}

/**
 * مكون InvoiceModal الموحد لعرض وطباعة الفاتورة الأصلية
 *
 * @param {boolean} isOpen - حالة فتح النافذة المنبثقة
 * @param {Function} onClose - دالة الإغلاق
 * @param {string} saleId - معرّف الفاتورة في جدول sales (أو invoiceId)
 * @param {object} initialSale - كائن الفاتورة مسبق الجلب (اختياري)
 * @param {object} store - كائن بيانات المتجر (اختياري، يُجلب من السياق تلقائياً)
 */
export default function InvoiceModal({
  isOpen,
  onClose,
  saleId,
  invoiceId,
  initialSale = null,
  store: propStore = null,
  onInvoiceUpdated = null,
}) {
  const contextStore = useStore()?.store;
  const store = propStore || contextStore;
  const toast = useToast();

  const targetSaleId = saleId || invoiceId || initialSale?.id;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saleData, setSaleData] = useState(initialSale);
  const [printInvoiceData, setPrintInvoiceData] = useState(null);

  const [isPrinting, setIsPrinting] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  // حالات وضع التعديل المباشر
  const [isEditing, setIsEditing] = useState(false);
  const [editableLines, setEditableLines] = useState([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [negativeIssues, setNegativeIssues] = useState([]);
  const [showNegativeModal, setShowNegativeModal] = useState(false);
  const searchDebounceRef = useRef(null);

  // دالة جلب وتجهيز بيانات الفاتورة الأصلية
  const loadFullInvoice = useCallback(async () => {
    if (!isOpen || !targetSaleId) {
      setSaleData(null);
      setPrintInvoiceData(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let sale = initialSale;
      const currentStoreId = store?.id;

      if (!sale || !sale.line_items || !sale.total_amount) {
        const { data, error: sErr } = await supabase
          .from(SALES_TABLE)
          .select('*')
          .eq('id', targetSaleId)
          .maybeSingle();

        if (sErr) throw sErr;
        if (!data) throw new Error('تعذّر العثور على الفاتورة المطلوبة.');
        sale = data;
      }

      const effectiveStoreId = sale.store_id || currentStoreId;

      // جلب وتخصيب الأصناف
      const lines = await enrichSaleLineItems(supabase, effectiveStoreId, sale.line_items);

      // جلب وتخصيب بيانات العميل
      const customer = await resolveCustomerDetails(
        supabase,
        effectiveStoreId,
        sale.contact_id,
        sale.notes
      );

      // الحسابات المالية
      const subtotal = lines.reduce(
        (sum, l) => sum + Number(l.originalPrice || l.unitPrice || 0) * Number(l.qty || 1),
        0
      );
      const finalTotal = Number(sale.total_amount ?? 0);
      const totalDiscount = Math.max(0, subtotal - finalTotal);

      const checkLines = extractCheckDetails(sale);
      const posTender = resolveTenderLabel(sale);

      let visa4 = undefined;
      const vMatch = String(sale.notes || '').match(/فيزا.*?(\d{4})/i);
      if (vMatch) visa4 = vMatch[1];

      const dateStr = sale.created_at
        ? new Date(sale.created_at).toLocaleString('ar-EG', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '—';

      const prepared = {
        storeName: store?.name || 'المتجر',
        logoUrl: store?.logo_url,
        invoiceNumber: sale.id?.slice(0, 8)?.toUpperCase(),
        invoiceId: sale.id,
        customerName: customer.customerName || 'زبون عام',
        customerPhone: customer.customerPhone,
        customerEmail: customer.customerEmail,
        customerAddress: customer.customerAddress,
        customerNotes: sale.notes,
        posTenderLabel: posTender,
        checkDetailsLines: checkLines.length > 0 ? checkLines : undefined,
        visaLast4: visa4,
        lines,
        subtotal: subtotal || finalTotal,
        totalDiscount,
        finalTotal,
        printedAtLabel: dateStr,
      };

      setSaleData({
        ...sale,
        customer_name: customer.customerName,
        customer_phone: customer.customerPhone,
        customer_address: customer.customerAddress,
        line_items: lines,
      });
      setPrintInvoiceData(prepared);
    } catch (err) {
      console.error('[InvoiceModal] load invoice error:', err);
      setError(err.message || 'تعذّر تحميل تفاصيل الفاتورة.');
    } finally {
      setLoading(false);
    }
  }, [isOpen, targetSaleId, initialSale, store]);

  useEffect(() => {
    loadFullInvoice();
    setIsEditing(false);
  }, [loadFullInvoice]);

  // بدء التعديل المباشر
  const startEditing = () => {
    const lines = saleData?.line_items || [];
    setEditableLines(
      lines.map((l, idx) => ({
        key: l.key || `line_${idx}_${Date.now()}`,
        product_id: l.product_id || l.productId || null,
        barcode: l.barcode || '',
        name: l.name || l.product_name || l.item_name || 'صنف',
        unit: l.unit || 'قطعة',
        conversion_factor: Number(l.conversion_factor || l.conversionFactor || 1),
        qty: Number(l.qty ?? l.quantity ?? 1),
        unit_price: Number(l.unit_price ?? l.unitPrice ?? 0),
        discount: Number(l.discount || 0),
        line_total: Number(
          l.line_total ??
            l.lineTotal ??
            Math.max(0, Number(l.qty || 1) * Number(l.unit_price || 0) - Number(l.discount || 0))
        ),
      }))
    );
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setSearchTerm('');
    setSearchResults([]);
  };

  const updateLine = (idx, field, val) => {
    setEditableLines((prev) => {
      const next = [...prev];
      const cur = { ...next[idx] };
      if (field === 'qty') {
        const q = Math.max(0, parseFloat(val) || 0);
        cur.qty = val;
        cur.line_total = Math.max(
          0,
          Math.round((q * Number(cur.unit_price || 0) - Number(cur.discount || 0)) * 100) / 100
        );
      } else if (field === 'unit_price') {
        const p = Math.max(0, parseFloat(val) || 0);
        cur.unit_price = val;
        cur.line_total = Math.max(
          0,
          Math.round((Number(cur.qty || 0) * p - Number(cur.discount || 0)) * 100) / 100
        );
      }
      next[idx] = cur;
      return next;
    });
  };

  const deleteLine = (idx) => {
    setEditableLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSearch = (q) => {
    setSearchTerm(q);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      const res = await searchProductsAndUnits(store?.id, q, supabase);
      setSearchResults(res);
      setSearchLoading(false);
    }, 200);
  };

  const addProductFromSearch = (p) => {
    setEditableLines((prev) => [
      ...prev,
      {
        key: `new_${Date.now()}_${Math.random()}`,
        product_id: p.productId,
        barcode: p.barcode,
        name: p.name,
        unit: p.unit || 'قطعة',
        conversion_factor: p.conversionFactor || 1,
        qty: 1,
        unit_price: p.price,
        discount: 0,
        line_total: p.price,
      },
    ]);
    setSearchTerm('');
    setSearchResults([]);
  };

  const handleSearchKeyDown = async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = searchTerm.trim();
    if (!q) return;

    try {
      setSearchLoading(true);
      const match = await lookupProductOrUnitByBarcode(q, store?.id, supabase);
      setSearchLoading(false);
      if (match) {
        addProductFromSearch(match);
        toast.success(`تمت إضافة: ${match.name} (${match.unit || 'قطعة'})`);
        return;
      }
    } catch (err) {
      setSearchLoading(false);
      console.error('[handleSearchKeyDown] lookup error:', err);
    }

    if (searchResults.length === 1) {
      const single = searchResults[0];
      addProductFromSearch(single);
      toast.success(`تمت إضافة: ${single.name}`);
      return;
    }

    if (searchResults.length > 1) {
      toast.info('توجد عدة نتائج مطابقة، اختر الصنف من القائمة المنسدلة.');
    } else {
      toast.warning('لم يتم العثور على صنف مطابق بهذا الباركود.');
    }
  };

  const handleSaveEdit = async () => {
    const valid = editableLines.filter((l) => Number(l.qty) > 0);
    if (valid.length === 0) {
      toast.warning('يجب أن تحتوي الفاتورة على سطر واحد على الأقل بكمية صالحة.');
      return;
    }
    const deltas = calculateStockDeltas(saleData?.line_items, valid);
    const issues = await checkNegativeStockIssues(store?.id, deltas, 'sale', supabase);
    if (issues.length > 0) {
      setNegativeIssues(issues);
      setShowNegativeModal(true);
      return;
    }
    await doSaveEdit(valid);
  };

  const doSaveEdit = async (linesToSave = null) => {
    setShowNegativeModal(false);
    const valid = (linesToSave || editableLines).filter((l) => Number(l.qty) > 0);
    setSavingEdit(true);
    try {
      const newTotal = valid.reduce((sum, l) => sum + Number(l.line_total || 0), 0);
      const result = await executeSaleInvoiceEdit({
        storeId: store?.id,
        saleId: targetSaleId,
        oldSale: saleData,
        newLines: valid,
        newTotal,
        supabase,
      });

      const stockSign = result.totalStockDiff > 0 ? '+' : '';
      const debtSign = result.debtDiff > 0 ? '+' : '';
      toast.success(
        `تم التعديل، الفرق بالمخزون: ${stockSign}${result.totalStockDiff}، الفرق بالرصيد: ${debtSign}${result.debtDiff.toFixed(2)} ₪`
      );

      setIsEditing(false);
      await loadFullInvoice();
      onInvoiceUpdated?.();
    } catch (err) {
      console.error('[InvoiceModal] save edit error:', err);
      toast.error(err.message || 'فشل حفظ تعديلات الفاتورة');
    } finally {
      setSavingEdit(false);
    }
  };

  // إدارة حدث الطباعة عبر المتصفح
  useEffect(() => {
    if (!isPrinting) return;
    document.body.classList.add('print-invoice-active');
    const t = requestAnimationFrame(() => window.print());
    const onAfterPrint = () => {
      document.body.classList.remove('print-invoice-active');
      setIsPrinting(false);
    };
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener('afterprint', onAfterPrint);
      document.body.classList.remove('print-invoice-active');
    };
  }, [isPrinting]);

  // دالة تشغيل الطباعة
  const handlePrint = useCallback(() => {
    if (!printInvoiceData) return;
    setIsPrinting(true);
  }, [printInvoiceData]);

  // دالة تحميل الـ PDF باستخدام html2canvas + jsPDF
  const handleDownloadPdf = useCallback(async () => {
    if (!saleData || !store) return;
    setIsDownloadingPdf(true);
    try {
      await generateInvoicePDF(saleData, store);
    } catch (err) {
      console.error('[InvoiceModal] generateInvoicePDF error:', err);
    } finally {
      setIsDownloadingPdf(false);
    }
  }, [saleData, store]);

  if (!isOpen) return null;

  return (
    <>
      {/* طبقة الطباعة المخصصة لطباعة الفاتورة عبر نافذة المتصفح */}
      {isPrinting && printInvoiceData
        ? createPortal(
            <div
              id="print-invoice-mount"
              className="fixed inset-0 z-[99999] overflow-y-auto bg-white print:static print:inset-auto print:z-auto"
            >
              <PrintInvoice data={printInvoiceData} />
            </div>,
            document.body
          )
        : null}

      {/* نافذة العرض المنبثقة التفاعلية */}
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[10001] flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm overflow-y-auto"
            dir="rtl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-modal-title"
            onClick={(e) => {
              if (e.target === e.currentTarget && !loading) onClose();
            }}
          >
            <div
              className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-slate-100 dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* شريط الإجراءات العلوي للنافذة */}
              <div className="flex items-center justify-between px-5 py-3.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-white/10 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                    <Receipt size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 id="invoice-modal-title" className="text-base font-black text-slate-900 dark:text-white">
                        فاتورة مبيعات
                      </h3>
                      {targetSaleId && (
                        <span
                          className="font-currency font-black text-xs px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                          dir="ltr"
                        >
                          #{String(targetSaleId).slice(0, 8).toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {printInvoiceData && (
                    <>
                      <button
                        type="button"
                        onClick={isEditing ? cancelEditing : startEditing}
                        disabled={loading || isPrinting || savingEdit}
                        className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black shadow-sm transition-all disabled:opacity-50 ${
                          isEditing
                            ? 'bg-slate-200 hover:bg-slate-300 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200'
                            : 'bg-amber-500 hover:bg-amber-600 text-white active:scale-95'
                        }`}
                        title="تعديل الفاتورة والأصناف"
                      >
                        <Edit3 size={15} />
                        <span>{isEditing ? 'معاينة الفاتورة' : 'تعديل الفاتورة'}</span>
                      </button>

                      {!isEditing && (
                        <>
                          <button
                            type="button"
                            onClick={handlePrint}
                            disabled={loading || isPrinting}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-black shadow-sm transition-all disabled:opacity-50"
                            title="طباعة الفاتورة"
                          >
                            <Printer size={15} />
                            <span>طباعة</span>
                          </button>

                          <button
                            type="button"
                            onClick={handleDownloadPdf}
                            disabled={loading || isDownloadingPdf}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 dark:border-white/10 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-black shadow-sm transition-all disabled:opacity-50"
                            title="تحميل الفاتورة كملف PDF"
                          >
                            {isDownloadingPdf ? (
                              <Loader2 size={15} className="animate-spin text-indigo-600" />
                            ) : (
                              <Download size={15} />
                            )}
                            <span>تحميل PDF</span>
                          </button>
                        </>
                      )}
                    </>
                  )}

                  <button
                    type="button"
                    onClick={onClose}
                    className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-white/10 dark:hover:text-white transition-colors mr-1"
                    aria-label="إغلاق"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* جسم الفاتورة القابل للتمرير */}
              <div className="flex-1 overflow-y-auto p-3 sm:p-6 bg-slate-100/70 dark:bg-slate-950/60">
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-24 gap-3">
                    <Loader2 className="animate-spin text-indigo-600 dark:text-indigo-400" size={36} />
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      جاري تحميل بيانات الفاتورة الأصلية...
                    </p>
                  </div>
                ) : error ? (
                  <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300 max-w-md mx-auto my-12">
                    <AlertCircle size={24} className="shrink-0" />
                    <p className="text-sm font-bold">{error}</p>
                  </div>
                ) : isEditing ? (
                  <div className="max-w-4xl mx-auto space-y-5">
                    {/* بطاقة معلومات الفاتورة في وضع التعديل */}
                    <div className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
                      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div>
                          <span className="font-bold text-slate-400 dark:text-slate-500">الزبون: </span>
                          <span className="font-black text-slate-800 dark:text-white mr-1">
                            {saleData?.customer_name || 'زبون عام'}
                          </span>
                          {saleData?.customer_phone && (
                            <span className="text-slate-500 mr-2 font-mono">({saleData.customer_phone})</span>
                          )}
                        </div>
                        <div>
                          <span className="font-bold text-slate-400 dark:text-slate-500">طريقة الدفع: </span>
                          <span className="font-black text-indigo-600 dark:text-indigo-400 mr-1">
                            {resolveTenderLabel(saleData)}
                          </span>
                        </div>
                        <div className="text-amber-800 dark:text-amber-300 font-bold bg-amber-50 dark:bg-amber-950/40 px-3 py-1 rounded-xl border border-amber-200 dark:border-amber-800/60">
                          وضع التعديل — يتم احتساب وتحديث المخزون والذمة آلياً
                        </div>
                      </div>
                    </div>

                    {/* جدول بنود الفاتورة القابل للتعديل */}
                    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden dark:border-white/10 dark:bg-slate-900">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs text-right min-w-[620px]">
                          <thead>
                            <tr className="bg-slate-900 text-white dark:bg-slate-950 font-black">
                              <th className="p-3 w-10 text-center">#</th>
                              <th className="p-3">اسم الصنف</th>
                              <th className="p-3 font-mono" dir="ltr">الباركود</th>
                              <th className="p-3 text-center">الوحدة</th>
                              <th className="p-3 text-center w-28">الكمية</th>
                              <th className="p-3 text-center w-28">سعر الوحدة</th>
                              <th className="p-3 text-center font-currency">المجموع</th>
                              <th className="p-3 text-center w-12">حذف</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                            {editableLines.length === 0 ? (
                              <tr>
                                <td colSpan={8} className="p-8 text-center text-slate-400 font-bold">
                                  لا توجد أسطر في الفاتورة. استخدم حقل البحث بالأسفل لإضافة صنف.
                                </td>
                              </tr>
                            ) : (
                              editableLines.map((line, idx) => (
                                <tr
                                  key={line.key || idx}
                                  className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                                >
                                  <td className="p-2.5 text-center text-slate-400 font-bold">{idx + 1}</td>
                                  <td className="p-2.5 font-black text-slate-900 dark:text-white">{line.name}</td>
                                  <td className="p-2.5 font-mono text-slate-500 dark:text-slate-400 text-[11px]" dir="ltr">
                                    {line.barcode || '—'}
                                  </td>
                                  <td className="p-2.5 text-center">
                                    <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-700 dark:text-slate-300">
                                      {line.unit || 'قطعة'}
                                    </span>
                                  </td>
                                  <td className="p-2.5 text-center">
                                    <input
                                      type="number"
                                      step="any"
                                      min="0.001"
                                      value={line.qty}
                                      onChange={(e) => updateLine(idx, 'qty', e.target.value)}
                                      className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-center font-bold font-currency text-slate-900 focus:border-indigo-500 focus:bg-white dark:border-white/10 dark:bg-slate-800 dark:text-white"
                                      dir="ltr"
                                    />
                                  </td>
                                  <td className="p-2.5 text-center">
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={line.unit_price}
                                      onChange={(e) => updateLine(idx, 'unit_price', e.target.value)}
                                      className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-center font-bold font-currency text-slate-900 focus:border-indigo-500 focus:bg-white dark:border-white/10 dark:bg-slate-800 dark:text-white"
                                      dir="ltr"
                                    />
                                  </td>
                                  <td className="p-2.5 text-center font-black font-currency text-indigo-700 dark:text-indigo-300" dir="ltr">
                                    ₪{Number(line.line_total ?? 0).toFixed(2)}
                                  </td>
                                  <td className="p-2.5 text-center">
                                    <button
                                      type="button"
                                      onClick={() => deleteLine(idx)}
                                      className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 transition-colors"
                                      title="حذف هذا السطر"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* شريط إضافة صنف جديد بالبحث */}
                      <div className="p-4 border-t border-slate-100 bg-slate-50/50 dark:border-white/10 dark:bg-slate-800/30">
                        <label className="block text-xs font-black text-slate-700 dark:text-slate-300 mb-2">
                          إضافة صنف جديد للفاتورة:
                        </label>
                        <div className="relative">
                          <Search className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                          <input
                            type="search"
                            value={searchTerm}
                            onChange={(e) => handleSearch(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                            placeholder="ابحث باسم الصنف، الباركود، أو الوحدة (أو امسح الباركود واضغط Enter)..."
                            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-9 pl-4 text-xs font-bold text-slate-900 outline-none transition focus:border-indigo-500 dark:border-white/10 dark:bg-slate-900 dark:text-white"
                          />
                          {searchLoading && (
                            <div className="absolute left-3 top-1/2 -translate-y-1/2">
                              <Loader2 className="animate-spin text-indigo-600" size={16} />
                            </div>
                          )}
                        </div>

                        {/* لا توجد نتائج مطابقة */}
                        {!searchLoading && searchTerm.trim() && searchResults.length === 0 && (
                          <div className="mt-2 p-3 text-center rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-400 dark:bg-slate-900 dark:border-white/10">
                            لا توجد نتائج مطابقة لـ &quot;{searchTerm}&quot;
                          </div>
                        )}

                        {/* نتائج البحث المنسدلة */}
                        {searchResults.length > 0 && (
                          <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg dark:border-white/10 dark:bg-slate-900 divide-y divide-slate-100 dark:divide-white/5">
                            {searchResults.map((p, idx) => (
                              <button
                                key={p.unitId ? `u_${p.unitId}` : p.id || idx}
                                type="button"
                                onClick={() => addProductFromSearch(p)}
                                className="w-full px-3 py-2.5 text-right flex items-center justify-between hover:bg-indigo-50/80 dark:hover:bg-indigo-950/40 transition-colors"
                              >
                                <div>
                                  <div className="font-black text-slate-900 dark:text-white text-xs">{p.name}</div>
                                  <div className="flex items-center gap-2 text-[10px] text-slate-400">
                                    {p.barcode && <span className="font-mono">باركود: {p.barcode}</span>}
                                    <span>الوحدة: {p.unit}</span>
                                    <span>المخزون: {p.stockCount}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="font-currency font-black text-indigo-700 dark:text-indigo-300 text-xs" dir="ltr">
                                    ₪{Number(p.price).toFixed(2)}
                                  </span>
                                  <span className="p-1 rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200 text-[11px] font-bold inline-flex items-center gap-1">
                                    <Plus size={13} /> إضافة
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* شريط الملخص المالي للأصل والجديد */}
                    {(() => {
                      const newTotal = editableLines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);
                      const oldTotal = Number(saleData?.total_amount ?? 0);
                      const diff = Math.round((newTotal - oldTotal) * 100) / 100;
                      return (
                        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-4">
                          <div className="flex flex-wrap items-center gap-6">
                            <div>
                              <p className="text-[10px] font-bold text-slate-400">الإجمالي السابق</p>
                              <p className="text-lg font-black font-currency text-slate-600 dark:text-slate-300" dir="ltr">
                                ₪{oldTotal.toFixed(2)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-slate-400">الإجمالي الجديد</p>
                              <p className="text-2xl font-black font-currency text-indigo-700 dark:text-indigo-300" dir="ltr">
                                ₪{newTotal.toFixed(2)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-slate-400">فرق الفاتورة</p>
                              <p
                                className={`text-lg font-black font-currency ${
                                  diff > 0
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : diff < 0
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-slate-500'
                                }`}
                                dir="ltr"
                              >
                                {diff > 0 ? `+₪${diff.toFixed(2)}` : diff < 0 ? `-₪${Math.abs(diff).toFixed(2)}` : '₪0.00'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={cancelEditing}
                              disabled={savingEdit}
                              className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 dark:border-white/10 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all disabled:opacity-50"
                            >
                              إلغاء
                            </button>
                            <button
                              type="button"
                              onClick={handleSaveEdit}
                              disabled={savingEdit || editableLines.length === 0}
                              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-black shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50"
                            >
                              {savingEdit ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                              <span>حفظ التعديلات وتحديث الرصيد</span>
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : printInvoiceData ? (
                  <div className="rounded-2xl bg-white text-slate-900 shadow-xl border border-slate-200/80 max-w-[210mm] mx-auto overflow-hidden">
                    {/* استخدام نفس مكون الفاتورة الأصلية الموجود بنقطة البيع */}
                    <PrintInvoice data={printInvoiceData} />
                  </div>
                ) : null}
              </div>
            </div>
          </div>,
          document.body
        )}

      <NegativeStockConfirmModal
        isOpen={showNegativeModal}
        items={negativeIssues}
        onConfirm={() => doSaveEdit()}
        onCancel={() => setShowNegativeModal(false)}
        loading={savingEdit}
      />
    </>
  );
}
