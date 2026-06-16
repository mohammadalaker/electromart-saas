import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Receipt, RefreshCw, Undo2, Shield, CheckCircle, XCircle, Printer, Search, X, Calendar, User, CreditCard, Package, Tag, FileText, Hash, Zap } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import DashboardLayout from '../components/DashboardLayout';
import PrintInvoice from '../components/PrintInvoice';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { processFullSaleReturn } from '../utils/saleReturn';
import { normalizeItemFromSupabase, roundMoney } from '../utils/productModel';
import { computeWarrantyStatus, formatWarrantyEndDate } from '../utils/warranty';
import { confirmPendingOnlineSale, cancelPendingOnlineSale } from '../utils/onlineOrderConfirm';
import { getPublicImageUrl } from '../utils/storageImageUrl';
import { generateInvoicePDF } from '../utils/generatePDF';

function parseLineItems(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function countLineItems(lineItems) {
  if (lineItems == null) return null;
  const parsed = parseLineItems(lineItems);
  return parsed.length > 0 ? parsed.length : null;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return '—';
  }
}

export default function SalesMovements() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [pendingReturn, setPendingReturn] = useState(null);
  const [returnNote, setReturnNote] = useState('');
  const [returnBusy, setReturnBusy] = useState(false);

  const [warrantyByProductId, setWarrantyByProductId] = useState(() => new Map());
  const [productLookup, setProductLookup] = useState(() => ({ byId: new Map(), byBarcode: new Map() }));
  const [warrantyModalSale, setWarrantyModalSale] = useState(null);
  const [printInvoiceData, setPrintInvoiceData] = useState(null);
  const [onlineActionBusyId, setOnlineActionBusyId] = useState(null);

  const [contactsMap, setContactsMap] = useState(() => new Map());

  const [filterSearch, setFilterSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPayment, setFilterPayment] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const fetchSales = useCallback(async () => {
    if (!store?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const baseSelect =
        'id, created_at, total_amount, notes, line_items, payment_mode, contact_id, returned_at, return_note';
      let { data, error: qErr } = await supabase
        .from('sales')
        .select(`${baseSelect}, order_status`)
        .eq('store_id', store.id)
        .order('created_at', { ascending: false })
        .limit(300);

      if (qErr && /order_status|column|schema|PGRST204/i.test(String(qErr.message || ''))) {
        ({ data, error: qErr } = await supabase
          .from('sales')
          .select(baseSelect)
          .eq('store_id', store.id)
          .order('created_at', { ascending: false })
          .limit(300));
      }
      if (qErr) throw qErr;
      setRows(data || []);
    } catch (e) {
      console.error(e);
      setError(e.message || 'تعذّر تحميل المبيعات');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    fetchSales();
  }, [storeLoading, fetchSales]);

  useEffect(() => {
    if (!store?.id || storeLoading) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from(PRODUCTS_TABLE)
        .select('id, barcode, eng_name, full_price, price_after_disc, image_url, warranty_months')
        .eq('store_id', store.id);
      if (cancelled) return;
      if (error) {
        if (/warranty_months|column|schema|PGRST204/i.test(String(error.message || ''))) {
          setWarrantyByProductId(new Map());
          setProductLookup({ byId: new Map(), byBarcode: new Map() });
          return;
        }
        console.warn('[sales] warranty map', error);
        setWarrantyByProductId(new Map());
        setProductLookup({ byId: new Map(), byBarcode: new Map() });
        return;
      }
      setWarrantyByProductId(
        new Map((data || []).map((r) => [String(r.id), r.warranty_months]))
      );
      const byId = new Map();
      const byBarcode = new Map();
      (data || []).forEach((row) => {
        const product = normalizeItemFromSupabase(row);
        if (!product) return;
        byId.set(String(product.id), product);
        if (product.barcode) byBarcode.set(String(product.barcode), product);
      });
      setProductLookup({ byId, byBarcode });
    })();
    return () => {
      cancelled = true;
    };
  }, [store?.id, storeLoading]);

  useEffect(() => {
    if (!store?.id || storeLoading) return;
    let cancelled = false;
    supabase
      .from('store_contacts')
      .select('id, name')
      .eq('store_id', store.id)
      .eq('role', 'customer')
      .then(({ data }) => {
        if (cancelled) return;
        setContactsMap(new Map((data || []).map((c) => [String(c.id), c.name || ''])));
      });
    return () => { cancelled = true; };
  }, [store?.id, storeLoading]);

  useEffect(() => {
    if (!printInvoiceData) return;
    document.body.classList.add('print-invoice-active');
    const t = requestAnimationFrame(() => window.print());
    const onAfterPrint = () => {
      document.body.classList.remove('print-invoice-active');
      setPrintInvoiceData(null);
    };
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener('afterprint', onAfterPrint);
      document.body.classList.remove('print-invoice-active');
    };
  }, [printInvoiceData]);

  const handleConfirmReturn = async () => {
    if (!pendingReturn || !store?.id) return;
    setReturnBusy(true);
    try {
      const { data: fresh, error: fetchErr } = await supabase
        .from('sales')
        .select(
          'id, store_id, line_items, total_amount, payment_mode, contact_id, returned_at, return_note'
        )
        .eq('id', pendingReturn.id)
        .eq('store_id', store.id)
        .single();
      if (fetchErr) throw fetchErr;
      await processFullSaleReturn(supabase, fresh, {
        storeId: store.id,
        returnNote,
      });
      setPendingReturn(null);
      setReturnNote('');
      await fetchSales();
      toast.success('تم تنفيذ المرتجع بنجاح');
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'فشل تنفيذ المرتجع');
    } finally {
      setReturnBusy(false);
    }
  };

  const handlePrint = useCallback(
    (sale) => {
      const lines = parseLineItems(sale.line_items).map((line, idx) => {
        const barcode = line.barcode != null ? String(line.barcode) : '';
        const productId = line.product_id != null ? String(line.product_id) : '';
        const product = productLookup.byId.get(productId) || productLookup.byBarcode.get(barcode);
        const qty = Math.max(1, Number(line.qty ?? line.quantity ?? 1) || 1);
        const unitPrice = roundMoney(Number(line.unit_price ?? line.unitPrice ?? 0));
        const lineTotal = roundMoney(Number(line.line_total ?? line.lineTotal ?? unitPrice * qty));
        const originalPrice = roundMoney(Number(line.original_price ?? line.originalPrice ?? product?.price ?? unitPrice));
        const discountPercent =
          originalPrice > 0 && unitPrice < originalPrice
            ? Math.round(((originalPrice - unitPrice) / originalPrice) * 100)
            : 0;

        return {
          name: line.name || line.product_name || product?.name || (barcode ? `باركود ${barcode}` : `صنف ${idx + 1}`),
          barcode: barcode || product?.barcode,
          qty,
          unitPrice,
          lineTotal,
          originalPrice,
          discountPercent,
          imageUrl: getPublicImageUrl(line.image_url || line.image || product?.image),
          serial: line.serial_numbers ? String(line.serial_numbers).trim() : undefined,
        };
      });
      const subtotal = roundMoney(
        lines.reduce((sum, line) => sum + Number(line.originalPrice || 0) * Number(line.qty || 0), 0)
      );
      const finalTotal = roundMoney(Number(sale.total_amount ?? 0));

      setPrintInvoiceData({
        storeName: store?.name,
        customerNotes: sale.notes,
        posTenderLabel: sale.payment_mode === 'credit' ? 'ذمة' : sale.payment_mode === 'cash' ? 'كاش' : undefined,
        lines,
        subtotal: subtotal || finalTotal,
        totalDiscount: Math.max(0, roundMoney((subtotal || finalTotal) - finalTotal)),
        finalTotal,
        printedAtLabel: formatDateTime(sale.created_at),
      });
    },
    [productLookup, store?.name]
  );

  const handleDownloadPDF = useCallback(
    async (sale) => {
      // 1. Resolve customer details
      let customerName = '';
      if (sale.contact_id) {
        customerName = contactsMap.get(String(sale.contact_id)) || '';
      }
      const notes = sale.notes ? String(sale.notes).trim() : '';
      const customerMatch = notes.match(/الزبون:\s*([^\n]+)/);
      const customerFromNotes = customerMatch ? customerMatch[1].trim() : null;
      if (!customerName && customerFromNotes) {
        customerName = customerFromNotes;
      }

      const phoneMatch = notes.match(/(?:الهاتف|تلفون|جوال|رقم):\s*([^\n]+)/);
      const customerPhone = phoneMatch ? phoneMatch[1].trim() : undefined;

      const addressMatch = notes.match(/(?:العنوان|عنوان):\s*([^\n]+)/);
      const customerAddress = addressMatch ? addressMatch[1].trim() : undefined;

      // 2. Resolve line items
      const resolvedLineItems = parseLineItems(sale.line_items).map((line, idx) => {
        const barcode = line.barcode != null ? String(line.barcode) : '';
        const productId = line.product_id != null ? String(line.product_id) : '';
        const product = productLookup.byId.get(productId) || productLookup.byBarcode.get(barcode);
        const qty = Math.max(1, Number(line.qty ?? line.quantity ?? 1) || 1);
        const unitPrice = roundMoney(Number(line.unit_price ?? line.unitPrice ?? 0));
        const lineTotal = roundMoney(Number(line.line_total ?? line.lineTotal ?? unitPrice * qty));
        const originalPrice = roundMoney(
          Number(line.original_price ?? line.originalPrice ?? product?.price ?? unitPrice)
        );
        const discountPercent =
          originalPrice > 0 && unitPrice < originalPrice
            ? Math.round(((originalPrice - unitPrice) / originalPrice) * 100)
            : 0;

        return {
          name: line.name || line.product_name || product?.name || (barcode ? `باركود ${barcode}` : `صنف ${idx + 1}`),
          barcode: barcode || product?.barcode,
          qty,
          unitPrice,
          lineTotal,
          originalPrice,
          discountPercent,
          imageUrl: getPublicImageUrl(line.image_url || line.image || product?.image),
          serial: line.serial_numbers ? String(line.serial_numbers).trim() : undefined,
        };
      });

      const augmentedSale = {
        ...sale,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_address: customerAddress,
        line_items: resolvedLineItems,
      };

      await generateInvoicePDF(augmentedSale, store);
    },
    [contactsMap, productLookup, store]
  );

  const filteredRows = useMemo(() => {
    let result = rows;

    if (filterSearch.trim()) {
      const q = filterSearch.trim().toLowerCase();
      result = result.filter((r) => {
        const notes = (r.notes || '').toLowerCase();
        const amount = String(r.total_amount ?? '');
        const date = formatDateTime(r.created_at).toLowerCase();
        const customerName = (r.contact_id ? (contactsMap.get(String(r.contact_id)) || '') : '').toLowerCase();
        return notes.includes(q) || amount.includes(q) || date.includes(q) || customerName.includes(q);
      });
    }

    if (filterStatus !== 'all') {
      result = result.filter((r) => {
        const st = r.order_status ?? 'confirmed';
        if (filterStatus === 'returned') return Boolean(r.returned_at);
        if (filterStatus === 'cancelled') return st === 'cancelled';
        if (filterStatus === 'pending_online') return st === 'pending_online';
        if (filterStatus === 'active') return !r.returned_at && st !== 'cancelled' && st !== 'pending_online';
        return true;
      });
    }

    if (filterPayment !== 'all') {
      result = result.filter((r) => r.payment_mode === filterPayment);
    }

    if (filterDateFrom) {
      const from = new Date(filterDateFrom);
      from.setHours(0, 0, 0, 0);
      result = result.filter((r) => r.created_at && new Date(r.created_at) >= from);
    }

    if (filterDateTo) {
      const to = new Date(filterDateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter((r) => r.created_at && new Date(r.created_at) <= to);
    }

    return result;
  }, [rows, filterSearch, filterStatus, filterPayment, filterDateFrom, filterDateTo, contactsMap]);

  const hasActiveFilter =
    filterSearch.trim() || filterStatus !== 'all' || filterPayment !== 'all' || filterDateFrom || filterDateTo;

  const clearFilters = () => {
    setFilterSearch('');
    setFilterStatus('all');
    setFilterPayment('all');
    setFilterDateFrom('');
    setFilterDateTo('');
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
          لا يوجد متجر مرتبط بحسابك. أنشئ متجراً من صفحة التسجيل أو تواصل مع الدعم.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      actions={
        <button
          type="button"
          onClick={() => fetchSales()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 hover:border-indigo-200 disabled:opacity-50 transition-all dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:shadow-none dark:hover:bg-white/10 dark:hover:border-indigo-500/40"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          تحديث القائمة
        </button>
      }
    >
      <div className="space-y-4" dir="rtl">
        <div className="rounded-2xl border border-t-4 border-slate-200/80 border-t-indigo-500/30 bg-white/95 backdrop-blur-sm shadow-[0_4px_32px_-8px_rgba(15,23,42,0.12)] overflow-hidden dark:border-gray-700/50 dark:border-t-indigo-400/30 dark:bg-slate-900/80 dark:shadow-[0_4px_32px_-8px_rgba(0,0,0,0.45)]">
          <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-l from-indigo-50/40 to-white flex flex-wrap items-center justify-between gap-3 dark:border-slate-700/60 dark:from-indigo-950/50 dark:to-gray-900/90">
            <div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white">حركات المبيعات</h3>
              <p className="text-xs text-slate-500 mt-1 font-medium dark:text-slate-400">
                آخر عمليات البيع — يمكن إرجاع فاتورة كاملة لإعادة البضاعة للمخزن وتعديل الكاش أو ذمة الزبون
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-bold text-indigo-600 bg-indigo-50/80 px-3 py-1.5 rounded-xl border border-indigo-100 dark:text-indigo-300 dark:bg-indigo-950/50 dark:border-indigo-500/30">
              <Receipt size={16} />
              <span className="font-currency" lang="en">
                {loading ? '…' : filteredRows.length.toLocaleString('en-US')}
              </span>
              <span>
                {hasActiveFilter && !loading ? `من ${rows.length.toLocaleString('en-US')} ` : ''}عملية
              </span>
            </div>
          </div>

          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/60 flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                placeholder="بحث في الملاحظات أو المبلغ…"
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-900 text-slate-800 dark:text-slate-100 text-xs py-2 pr-8 pl-3 placeholder:text-slate-400 focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20 dark:focus:border-indigo-500 transition-shadow"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-900 text-slate-700 dark:text-slate-200 text-xs py-2 px-3 focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
            >
              <option value="all">كل الحالات</option>
              <option value="active">فعّال</option>
              <option value="returned">مرتجع</option>
              <option value="cancelled">ملغى</option>
              <option value="pending_online">أونلاين — بانتظار التأكيد</option>
            </select>
            <select
              value={filterPayment}
              onChange={(e) => setFilterPayment(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-900 text-slate-700 dark:text-slate-200 text-xs py-2 px-3 focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
            >
              <option value="all">كل طرق الدفع</option>
              <option value="cash">كاش</option>
              <option value="credit">ذمة</option>
            </select>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              title="من تاريخ"
              className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-900 text-slate-700 dark:text-slate-200 text-xs py-2 px-3 focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
            />
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              title="إلى تاريخ"
              className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-900 text-slate-700 dark:text-slate-200 text-xs py-2 px-3 focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
            />
            {hasActiveFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 hover:scale-[1.02] shadow-sm hover:shadow-md dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-900/40 transition-all duration-200"
              >
                <X size={13} />
                مسح الفلاتر
              </button>
            )}
          </div>

          {error && (
            <div className="mx-6 mt-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100">
              {error}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[880px]">
              <thead>
                <tr className="bg-gradient-to-r from-indigo-50/80 to-transparent text-slate-700 dark:text-slate-100 border-b border-slate-200/70 dark:from-indigo-950/40 dark:to-transparent dark:border-slate-700/60">
                  <th className="text-right py-3.5 px-5 font-semibold w-14">
                    <span className="inline-flex items-center gap-1.5">
                      <Hash size={16} className="text-slate-500 dark:text-slate-400" />
                    </span>
                  </th>
                  <th className="text-right py-3.5 px-5 font-semibold min-w-[200px]" dir="ltr">
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar size={16} className="text-slate-500 dark:text-slate-400 shrink-0" />
                      التاريخ والوقت
                    </span>
                  </th>
                  <th className="text-right py-3.5 px-5 font-semibold min-w-[130px]">
                    <span className="inline-flex items-center gap-1.5">
                      <User size={16} className="text-slate-500 dark:text-slate-400 shrink-0" />
                      الزبون
                    </span>
                  </th>
                  <th className="text-right py-3.5 px-5 font-semibold min-w-[110px]" dir="ltr">
                    <span className="inline-flex items-center gap-1.5">
                      <CreditCard size={16} className="text-slate-500 dark:text-slate-400 shrink-0" />
                      المبلغ
                    </span>
                  </th>
                  <th className="text-center py-3.5 px-5 font-semibold w-24">
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <CreditCard size={16} className="text-slate-500 dark:text-slate-400 shrink-0" />
                      الدفع
                    </span>
                  </th>
                  <th className="text-center py-3.5 px-5 font-semibold w-24" dir="ltr">
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <Package size={16} className="text-slate-500 dark:text-slate-400 shrink-0" />
                      أصناف
                    </span>
                  </th>
                  <th className="text-center py-3.5 px-5 font-semibold w-28">
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <Tag size={16} className="text-slate-500 dark:text-slate-400 shrink-0" />
                      الحالة
                    </span>
                  </th>
                  <th className="text-right py-3.5 px-5 font-semibold min-w-[200px]">
                    <span className="inline-flex items-center gap-1.5">
                      <FileText size={16} className="text-slate-500 dark:text-slate-400 shrink-0" />
                      ملاحظات / تفاصيل
                    </span>
                  </th>
                  <th className="text-center py-3.5 px-5 font-semibold w-32">
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <Shield size={16} className="text-slate-500 dark:text-slate-400 shrink-0" />
                      الضمان
                    </span>
                  </th>
                  <th className="text-center py-3.5 px-5 font-semibold w-36">
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <Zap size={16} className="text-slate-500 dark:text-slate-400 shrink-0" />
                      إجراء
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className="py-20">
                      <div className="flex justify-center items-center">
                        <Loader2 className="animate-spin text-indigo-500 dark:text-indigo-400" size={36} />
                      </div>
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-16 text-center">
                      <div className="inline-flex flex-col items-center gap-3 px-8 py-8 rounded-2xl bg-gradient-to-b from-slate-50/80 to-transparent dark:from-slate-800/40 dark:to-transparent">
                        <div className="relative flex items-center justify-center">
                          <div className="absolute h-24 w-24 rounded-full bg-gradient-to-br from-slate-100 to-transparent dark:from-slate-700/40 dark:to-transparent" />
                          <Receipt className="relative text-slate-300 dark:text-slate-600 opacity-30" size={64} />
                        </div>
                        {rows.length === 0 ? (
                          <>
                            <p className="font-bold text-slate-600 dark:text-slate-300">لا توجد مبيعات مسجّلة بعد</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">ستظهر هنا الفواتير عند إتمام البيع من لوحة المخزن</p>
                          </>
                        ) : (
                          <>
                            <p className="font-bold text-slate-600 dark:text-slate-300">لا توجد نتائج مطابقة</p>
                            <button
                              type="button"
                              onClick={clearFilters}
                              className="text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:underline"
                            >
                              مسح الفلاتر
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, idx) => {
                    const n = countLineItems(row.line_items);
                    const notes = row.notes ? String(row.notes).trim() : '';
                    const preview = notes || '—';
                    const customerMatch = notes.match(/الزبون:\s*([^\n]+)/);
                    const customerFromNotes = customerMatch ? customerMatch[1].trim() : null;
                    const notesWithoutCustomer = customerFromNotes
                      ? notes.replace(/الزبون:[^\n]*\n?/, '').trim()
                      : notes;
                    const isReturned = Boolean(row.returned_at);
                    const orderSt = row.order_status ?? 'confirmed';
                    const isPendingOnline = orderSt === 'pending_online';
                    const isCancelled = orderSt === 'cancelled';
                    const customerName = row.contact_id ? (contactsMap.get(String(row.contact_id)) || '') : '';
                    return (
                      <tr
                        key={row.id}
                        className={`border-b border-slate-100/70 align-top transition-colors dark:border-slate-700/40 ${
                          isReturned
                            ? 'bg-slate-50/80 opacity-90 dark:bg-slate-800/50'
                            : `${idx % 2 === 0 ? 'bg-white dark:bg-slate-900/50' : 'bg-slate-50/40 dark:bg-slate-800/30'} hover:bg-indigo-50/60 dark:hover:bg-indigo-950/30`
                        }`}
                      >
                        <td className="py-3.5 px-5 text-slate-400 font-bold text-center font-currency dark:text-slate-500 opacity-60" lang="en">
                          {(idx + 1).toLocaleString('en-US')}
                        </td>
                        <td className="py-3.5 px-5 font-currency text-slate-800 whitespace-nowrap dark:text-slate-200" dir="ltr" lang="en">
                          {formatDateTime(row.created_at)}
                        </td>
                        <td className="py-3.5 px-5 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {customerName || <span className="text-slate-400 dark:text-slate-600">—</span>}
                        </td>
                        <td className="py-3.5 px-5 font-black text-indigo-700 font-currency whitespace-nowrap dark:text-indigo-300" dir="ltr" lang="en">
                          ₪
                          {Number(row.total_amount ?? 0).toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="py-3.5 px-5 text-center">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-black ${
                              row.payment_mode === 'credit'
                                ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-100 dark:border dark:border-amber-800/50'
                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border dark:border-emerald-800/40'
                            }`}
                          >
                            {row.payment_mode === 'credit'
                              ? 'ذمة'
                              : row.payment_mode === 'cash'
                                ? isPendingOnline
                                  ? 'كاش (عند الاستلام)'
                                  : 'كاش'
                                : '—'}
                          </span>
                        </td>
                        <td className="py-3.5 px-5 text-center font-currency text-slate-700 dark:text-slate-300" dir="ltr" lang="en">
                          {n != null ? n.toLocaleString('en-US') : '—'}
                        </td>
                        <td className="py-3.5 px-5 text-center">
                          {isReturned ? (
                            <span className="inline-block rounded-full border-l-4 border-l-slate-400 dark:border-l-slate-500 px-2.5 py-0.5 text-[11px] font-black bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              مرتجع
                            </span>
                          ) : isCancelled ? (
                            <span className="inline-block rounded-full border-l-4 border-l-slate-400 dark:border-l-slate-500 px-2.5 py-0.5 text-[11px] font-black bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              ملغى
                            </span>
                          ) : isPendingOnline ? (
                            <span className="inline-block rounded-full border-l-4 border-l-amber-500 dark:border-l-amber-400 px-2.5 py-0.5 text-[11px] font-black bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                              طلب أونلاين — بانتظار التأكيد
                            </span>
                          ) : (
                            <span className="inline-block rounded-full border-l-4 border-l-emerald-500 dark:border-l-emerald-400 px-2.5 py-0.5 text-[11px] font-black bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                              فعّال
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-5 max-w-[180px]">
                          <div className="space-y-1">
                            {customerFromNotes && (
                              <span className="inline-block bg-slate-100 dark:bg-slate-800 rounded-lg px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:text-slate-300 truncate max-w-full">
                                👤 {customerFromNotes}
                              </span>
                            )}
                            <p
                              className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed"
                              title={notes || undefined}
                            >
                              {notesWithoutCustomer || '—'}
                            </p>
                          </div>
                        </td>
                        <td className="py-3.5 px-5 text-center">
                          <button
                            type="button"
                            disabled={isReturned || isPendingOnline}
                            onClick={() => setWarrantyModalSale(row)}
                            className="inline-flex items-center gap-1 rounded-xl border border-violet-200 bg-violet-50 dark:bg-violet-950/40 dark:border-violet-800 px-2.5 py-1.5 text-[11px] font-black text-violet-900 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-900/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                          >
                            <Shield size={14} />
                            عرض
                          </button>
                        </td>
                        <td className="py-3.5 px-5 text-center">
                          {isPendingOnline ? (
                            <div className="flex flex-col gap-2 items-center">
                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handlePrint(row)}
                                  className="p-1.5 text-slate-500 hover:text-indigo-600 hover:scale-110 dark:text-slate-400 dark:hover:text-indigo-400 transition-all duration-200"
                                  title="طباعة الفاتورة"
                                >
                                  <Printer size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDownloadPDF(row)}
                                  className="p-1.5 text-slate-500 hover:text-indigo-600 hover:scale-110 dark:text-slate-400 dark:hover:text-indigo-400 transition-all duration-200"
                                  title="تحميل فاتورة PDF"
                                >
                                  <FileText size={16} />
                                </button>
                              </div>
                              <button
                                type="button"
                                disabled={onlineActionBusyId === row.id}
                                onClick={async () => {
                                  setOnlineActionBusyId(row.id);
                                  try {
                                    await confirmPendingOnlineSale(supabase, {
                                      saleId: row.id,
                                      storeId: store.id,
                                    });
                                    await fetchSales();
                                  } catch (e) {
                                    console.error(e);
                                    toast.error(e.message || 'فشل تأكيد الطلب');
                                  } finally {
                                    setOnlineActionBusyId(null);
                                  }
                                }}
                                className="inline-flex items-center gap-1 rounded-xl border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-black text-emerald-900 hover:bg-emerald-100 hover:-translate-x-1 disabled:opacity-50 disabled:cursor-not-allowed dark:border-emerald-700/50 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-900/50 transition-all duration-200"
                              >
                                {onlineActionBusyId === row.id ? (
                                  <Loader2 className="animate-spin" size={14} />
                                ) : (
                                  <CheckCircle size={14} />
                                )}
                                تأكيد الطلب
                              </button>
                              <button
                                type="button"
                                disabled={onlineActionBusyId === row.id}
                                onClick={async () => {
                                  if (!window.confirm('إلغاء هذا الطلب؟ لن يُخصم المخزون.')) return;
                                  setOnlineActionBusyId(row.id);
                                  try {
                                    await cancelPendingOnlineSale(supabase, {
                                      saleId: row.id,
                                      storeId: store.id,
                                    });
                                    await fetchSales();
                                  } catch (e) {
                                    console.error(e);
                                    toast.error(e.message || 'فشل الإلغاء');
                                  } finally {
                                    setOnlineActionBusyId(null);
                                  }
                                }}
                                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-700 hover:bg-slate-50 hover:-translate-x-1 disabled:opacity-50 disabled:cursor-not-allowed dark:border-white/15 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10 transition-all duration-200"
                              >
                                <XCircle size={14} />
                                إلغاء
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center justify-center gap-2">
                              <button
                                type="button"
                                onClick={() => handlePrint(row)}
                                className="p-1.5 text-slate-500 hover:text-indigo-600 hover:scale-110 dark:text-slate-400 dark:hover:text-indigo-400 transition-all duration-200"
                                title="طباعة الفاتورة"
                              >
                                <Printer size={16} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDownloadPDF(row)}
                                className="p-1.5 text-slate-500 hover:text-indigo-600 hover:scale-110 dark:text-slate-400 dark:hover:text-indigo-400 transition-all duration-200"
                                title="تحميل فاتورة PDF"
                              >
                                <FileText size={16} />
                              </button>
                              <button
                                type="button"
                                disabled={isReturned || isCancelled || returnBusy}
                                onClick={() => setPendingReturn(row)}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-900 hover:bg-amber-100 hover:scale-[1.05] hover:shadow-md hover:border-l-4 hover:border-l-amber-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-100 dark:hover:bg-amber-900/40 transition-all duration-200"
                              >
                                <Undo2 size={14} />
                                إرجاع فاتورة
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {warrantyModalSale &&
        createPortal(
          <div
            className="fixed inset-0 z-[190] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            dir="rtl"
            role="dialog"
            aria-modal="true"
            onClick={() => setWarrantyModalSale(null)}
          >
            <div
              className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:bg-gray-900 dark:border-white/10 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-2 mb-4">
                <div>
                  <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <Shield className="text-violet-600 dark:text-violet-400 shrink-0" size={22} />
                    حالة الضمان
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono" dir="ltr">
                    تاريخ البيع: {formatDateTime(warrantyModalSale.created_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setWarrantyModalSale(null)}
                  className="text-sm font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                >
                  إغلاق
                </button>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                يُحسب الضمان من <strong>تاريخ الفاتورة</strong> و<strong>مدة الضمان المسجّلة في بطاقة الصنف</strong>{' '}
                (بالأشهر). إن لم تُحدَّد المدة في المنتج يظهر «غير محدد».
              </p>
              {parseLineItems(warrantyModalSale.line_items).length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">لا توجد أسطر أصناف في هذه الفاتورة.</p>
              ) : (
                <ul className="space-y-3">
                  {parseLineItems(warrantyModalSale.line_items).map((line, idx) => {
                    const pid = line.product_id ? String(line.product_id) : null;
                    const barcode = line.barcode ? String(line.barcode) : '';
                    const product = (pid ? productLookup.byId.get(pid) : null) || productLookup.byBarcode.get(barcode);
                    const months = pid != null ? warrantyByProductId.get(pid) : undefined;
                    const st = computeWarrantyStatus(warrantyModalSale.created_at, months);
                    const serial = line.serial_numbers ? String(line.serial_numbers).trim() : '';
                    const productName = line.name || line.product_name || product?.name || '';
                    return (
                      <li
                        key={`${pid || idx}-${idx}`}
                        className="rounded-xl border border-slate-100 dark:border-white/10 bg-slate-50/80 dark:bg-white/5 p-3 text-sm"
                      >
                        <div className="flex flex-wrap justify-between gap-2 items-start">
                          <div className="min-w-0">
                            {productName ? (
                              <p className="font-bold text-sm text-slate-800 dark:text-slate-100 mb-1">{productName}</p>
                            ) : null}
                            <p className="font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                              باركود {barcode || '—'}
                            </p>
                            {serial ? (
                              <p className="text-[11px] font-mono text-slate-600 dark:text-slate-400 mt-1 whitespace-pre-wrap" dir="ltr">
                                سيريال: {serial}
                              </p>
                            ) : null}
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-currency" dir="ltr">
                              كمية: {line.qty ?? '—'}
                            </p>
                          </div>
                          <div className="text-left shrink-0">
                            <span
                              className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-black ${
                                st.kind === 'active'
                                  ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100'
                                  : st.kind === 'expired'
                                    ? 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100'
                                    : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                              }`}
                            >
                              {st.labelAr}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-slate-600 dark:text-slate-400 space-y-1">
                          <p>
                            مدة الضمان في الصنف:{' '}
                            {months != null && months !== '' ? (
                              <span className="font-black font-currency">{Number(months)} شهراً</span>
                            ) : (
                              'غير محدد في المنتج'
                            )}
                          </p>
                          {st.endDate && (
                            <p dir="ltr" className="font-currency">
                              ينتهي الضمان تقريباً في: {formatWarrantyEndDate(st.endDate)}
                              {st.daysLeft != null && st.kind === 'active' ? (
                                <span className="text-emerald-700 dark:text-emerald-300 mr-2">
                                  ({st.daysLeft} يوم متبقٍ)
                                </span>
                              ) : null}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>,
          document.body
        )}

      {pendingReturn &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            dir="rtl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="return-dialog-title"
          >
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:bg-gray-900 dark:border-white/10">
              <h2 id="return-dialog-title" className="text-lg font-black text-slate-900 dark:text-white">
                إرجاع فاتورة كاملة
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
                سيتم: إعادة القطع إلى المخزن، ثم{' '}
                {pendingReturn.payment_mode === 'credit'

                  ? 'خصم المبلغ من مديونية الزبون (للفواتير المربوطة بزبون في الدليل).'

                  : 'خصم المبلغ من صندوق كاش المحل.'}{' '}
                لا يمكن التراجع عن العملية من الواجهة.
              </p>
              <p className="mt-3 text-sm font-black text-indigo-700 dark:text-indigo-300 font-currency" dir="ltr">
                ₪ {roundMoney(Number(pendingReturn.total_amount ?? 0)).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <label className="block mt-4 text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
                ملاحظة (اختياري)
              </label>
              <input
                type="text"
                value={returnNote}
                onChange={(e) => setReturnNote(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                placeholder="مثال: عيب مصنع، استبدال…"
              />
              <div className="flex flex-wrap gap-3 justify-end mt-6">
                <button
                  type="button"
                  disabled={returnBusy}
                  onClick={() => {
                    setPendingReturn(null);
                    setReturnNote('');
                  }}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={returnBusy}
                  onClick={() => {
                    void handleConfirmReturn();
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-black text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {returnBusy ? <Loader2 className="animate-spin" size={18} /> : <Undo2 size={18} />}
                  تأكيد الإرجاع
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {printInvoiceData &&
        createPortal(
          <div
            id="print-invoice-mount"
            className="fixed inset-0 z-[9999] overflow-y-auto bg-white print:static print:inset-auto print:z-auto"
          >
            <PrintInvoice data={printInvoiceData} />
          </div>,
          document.body
        )}
    </DashboardLayout>
  );
}
