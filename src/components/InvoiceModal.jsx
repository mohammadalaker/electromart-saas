import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Receipt, Printer, Download, X, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import PrintInvoice from './PrintInvoice';
import { generateInvoicePDF } from '../utils/generatePDF';
import { getPublicImageUrl } from '../utils/storageImageUrl';

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
}) {
  const contextStore = useStore()?.store;
  const store = propStore || contextStore;

  const targetSaleId = saleId || invoiceId || initialSale?.id;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saleData, setSaleData] = useState(initialSale);
  const [printInvoiceData, setPrintInvoiceData] = useState(null);

  const [isPrinting, setIsPrinting] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  // جلب وتجهيز بيانات الفاتورة الأصلية عند فتح النافذة
  useEffect(() => {
    if (!isOpen || !targetSaleId) {
      setSaleData(null);
      setPrintInvoiceData(null);
      setError(null);
      return;
    }

    let isMounted = true;
    const loadFullInvoice = async () => {
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

        // استخراج تفاصيل الفيزا من الملاحظات إن وُجدت
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

        if (isMounted) {
          setSaleData({
            ...sale,
            customer_name: customer.customerName,
            customer_phone: customer.customerPhone,
            customer_address: customer.customerAddress,
            line_items: lines,
          });
          setPrintInvoiceData(prepared);
        }
      } catch (err) {
        console.error('[InvoiceModal] load invoice error:', err);
        if (isMounted) {
          setError(err.message || 'تعذّر تحميل تفاصيل الفاتورة.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadFullInvoice();
    return () => {
      isMounted = false;
    };
  }, [isOpen, targetSaleId, initialSale, store]);

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
    </>
  );
}
