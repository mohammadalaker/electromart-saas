import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ShoppingBag, RotateCcw, X, Printer, RefreshCw, Search } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import PrintPurchaseInvoice from '../components/PrintPurchaseInvoice';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { dbLineItemsToReceiveRows, computePurchaseLinePayloads } from '../utils/purchaseLinePayloads';
import { executePurchaseReceiveEffects } from '../utils/purchaseReceiveExecution';

const PURCHASES_TABLE = 'store_purchases';
const RETURNS_TABLE = 'store_purchase_returns';
const CONTACTS_TABLE = 'store_contacts';

function purchaseStatusBadge(p) {
  const s = p.purchase_status || 'received';
  if (s === 'draft') {
    return (
      <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-black bg-slate-200 text-slate-800 dark:bg-slate-600 dark:text-slate-100">
        مسودة
      </span>
    );
  }
  if (s === 'paid') {
    return (
      <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-black bg-emerald-200 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100">
        مدفوعة
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-black bg-sky-100 text-sky-900 dark:bg-sky-950/60 dark:text-sky-100">
      تم الاستلام
    </span>
  );
}

function lineReturnTotal(unitPrice, discountPct, qty) {
  const up = Math.max(0, parseFloat(String(unitPrice).replace(',', '.')) || 0);
  const d = Math.min(100, Math.max(0, parseFloat(String(discountPct).replace(',', '.')) || 0));
  const q = Math.max(0, parseFloat(String(qty).replace(',', '.')) || 0);
  return Math.round(q * up * (1 - d / 100) * 100) / 100;
}

export default function PurchaseHistoryPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalPurchase, setModalPurchase] = useState(null);
  const [returnQty, setReturnQty] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [printPurchaseData, setPrintPurchaseData] = useState(null);
  const [receivingId, setReceivingId] = useState(null);
  const [payingId, setPayingId] = useState(null);

  const [filterSearch, setFilterSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPayment, setFilterPayment] = useState('all');

  const fetchPurchases = useCallback(async () => {
    if (!store?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from(PURCHASES_TABLE)
        .select(
          'id, supplier_company_name, supplier_phone, invoice_number, invoice_date, total_amount, payment_mode, payment_due_date, line_items, supplier_contact_id, notes, landed_cost_extra, purchase_status, credit_settled_at, created_at'
        )
        .eq('store_id', store.id)
        .order('created_at', { ascending: false })
        .limit(300);
      if (qErr) throw qErr;
      setRows(data || []);
    } catch (e) {
      console.error(e);
      setError(e.message || 'تعذّر التحميل');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    fetchPurchases();
  }, [storeLoading, fetchPurchases]);

  useEffect(() => {
    if (!printPurchaseData) return;
    document.body.classList.add('print-invoice-active');
    const t = requestAnimationFrame(() => window.print());
    const onAfterPrint = () => {
      document.body.classList.remove('print-invoice-active');
      setPrintPurchaseData(null);
    };
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener('afterprint', onAfterPrint);
      document.body.classList.remove('print-invoice-active');
    };
  }, [printPurchaseData]);

  const openPrint = (p) => {
    let raw = p.line_items;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = [];
      }
    }
    const lines = Array.isArray(raw) ? raw : [];
    setPrintPurchaseData({
      storeName: store?.name,
      supplierCompanyName: p.supplier_company_name,
      supplierPhone: p.supplier_phone,
      invoiceNumber: p.invoice_number,
      invoiceDate: p.invoice_date,
      paymentMode: p.payment_mode,
      paymentDueDate: p.payment_due_date,
      lines,
      totalAmount: p.total_amount,
      landedCostExtra: p.landed_cost_extra,
      notes: p.notes,
      printedAtLabel: new Date().toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    });
  };

  const confirmReceiveFromDraft = async (p) => {
    if (!store?.id) return;
    if (!window.confirm('تأكيد استلام البضاعة للمخزن وتطبيق التكلفة والذمة (إن وُجدت)؟')) return;
    setReceivingId(p.id);
    try {
      const receiveRows = dbLineItemsToReceiveRows(p.line_items);
      const payloads = computePurchaseLinePayloads(receiveRows, p.landed_cost_extra ?? 0);
      await executePurchaseReceiveEffects({
        storeId: store.id,
        purchaseId: p.id,
        lines: receiveRows,
        linePayloads: payloads,
        updateCatalogCosts: true,
        companyName: p.supplier_company_name || '',
        invoiceDateVal: p.invoice_date,
        paymentMode: p.payment_mode,
        supplierContactId: p.supplier_contact_id,
        grandTotal: Number(p.total_amount),
      });
      const { error } = await supabase
        .from(PURCHASES_TABLE)
        .update({ purchase_status: 'received' })
        .eq('id', p.id)
        .eq('store_id', store.id);
      if (error) throw error;
      await fetchPurchases();
      toast.success('تم تأكيد الاستلام وتحديث المخزن.');
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'فشل تأكيد الاستلام');
    } finally {
      setReceivingId(null);
    }
  };

  const markPurchasePaid = async (p) => {
    if (!store?.id) return;
    if (!window.confirm('تسجيل أنك سدّيت هذه الفاتورة للمورد؟')) return;
    setPayingId(p.id);
    try {
      const { error } = await supabase
        .from(PURCHASES_TABLE)
        .update({
          purchase_status: 'paid',
          credit_settled_at: new Date().toISOString(),
        })
        .eq('id', p.id)
        .eq('store_id', store.id);
      if (error) throw error;
      await fetchPurchases();
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'فشل التحديث');
    } finally {
      setPayingId(null);
    }
  };

  const parseLineItemsSafe = (raw) => {
    if (raw == null) return [];
    if (Array.isArray(raw)) return raw;
    try {
      const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  };

  const openReturn = (p) => {
    if ((p.purchase_status || 'received') === 'draft') {
      toast.warning('لا يمكن الإرجاع من مسودة — أكّد الاستلام أولاً.');
      return;
    }
    setModalPurchase(p);
    const items = parseLineItemsSafe(p.line_items);
    const init = {};
    items.forEach((_, i) => { init[i] = ''; });
    setReturnQty(init);
  };

  const closeModal = () => {
    setModalPurchase(null);
    setReturnQty({});
  };

  const parsedLines = useMemo(
    () => parseLineItemsSafe(modalPurchase?.line_items),
    [modalPurchase]
  );

  const filteredRows = useMemo(() => {
    let result = rows;
    if (filterSearch.trim()) {
      const q = filterSearch.trim().toLowerCase();
      result = result.filter((p) => {
        const supplier = (p.supplier_company_name || '').toLowerCase();
        const invoice = (p.invoice_number || '').toLowerCase();
        const notes = (p.notes || '').toLowerCase();
        const amount = String(p.total_amount ?? '');
        return supplier.includes(q) || invoice.includes(q) || notes.includes(q) || amount.includes(q);
      });
    }
    if (filterStatus !== 'all') {
      result = result.filter((p) => {
        const s = p.purchase_status || 'received';
        return s === filterStatus;
      });
    }
    if (filterPayment !== 'all') {
      result = result.filter((p) => p.payment_mode === filterPayment);
    }
    return result;
  }, [rows, filterSearch, filterStatus, filterPayment]);

  const hasActiveFilter = filterSearch.trim() || filterStatus !== 'all' || filterPayment !== 'all';
  const clearFilters = () => { setFilterSearch(''); setFilterStatus('all'); setFilterPayment('all'); };

  const submitReturn = async () => {
    if (!store?.id || !modalPurchase) return;
    const linesOut = [];
    let totalReturn = 0;
    for (let i = 0; i < parsedLines.length; i++) {
      const item = parsedLines[i];
      const raw = String(returnQty[i] ?? '').trim();
      if (!raw) continue;
      const rq = Math.floor(Math.max(0, parseFloat(raw.replace(',', '.')) || 0));
      if (rq <= 0) continue;
      const maxQ = Math.floor(
        Math.max(0, parseFloat(String(item.qty).replace(',', '.')) || 0)
      );
      if (rq > maxQ) {
        toast.warning(`الكمية المرتجعة للسطر ${i + 1} تتجاوز الكمية الأصلية (${maxQ})`);
        return;
      }
      const pid = item.product_id || null;
      if (!pid) {
        toast.warning(`السطر ${i + 1} غير مربوط بصنف في المخزن — لا يمكن الإرجاع آلياً`);
        return;
      }
      const lt = lineReturnTotal(item.unit_price, item.discount_percent ?? 0, rq);
      totalReturn += lt;
      linesOut.push({
        product_id: pid,
        qty: rq,
        unit_price: item.unit_price,
        discount_percent: item.discount_percent ?? 0,
        line_total: lt,
      });
    }
    if (linesOut.length === 0) {
      toast.warning('أدخل كمية مرتجعة واحدة على الأقل');
      return;
    }

    setSubmitting(true);
    try {
      const { error: insErr } = await supabase.from(RETURNS_TABLE).insert([
        {
          store_id: store.id,
          original_purchase_id: modalPurchase.id,
          supplier_contact_id: modalPurchase.supplier_contact_id || null,
          return_total: Math.round(totalReturn * 100) / 100,
          line_items: linesOut,
          notes: `مرتجع من فاتورة ${modalPurchase.invoice_number || ''}`,
        },
      ]);
      if (insErr) {
        if (insErr.code === '42P01' || insErr.message?.includes('does not exist')) {
          throw new Error('نفّذ ملف store_purchase_returns.sql في Supabase');
        }
        throw insErr;
      }

      for (const line of linesOut) {
        const { error: d1 } = await supabase.rpc('decrement_stock', {
          row_id: line.product_id,
          amount: Math.max(1, Math.floor(line.qty)),
        });
        if (d1) {
          const { data: pr } = await supabase
            .from(PRODUCTS_TABLE)
            .select('stock_count')
            .eq('id', line.product_id)
            .eq('store_id', store.id)
            .maybeSingle();
          const next = Math.max(0, Number(pr?.stock_count ?? 0) - Math.floor(line.qty));
          await supabase
            .from(PRODUCTS_TABLE)
            .update({ stock_count: next })
            .eq('id', line.product_id)
            .eq('store_id', store.id);
        }
      }

      if (modalPurchase.payment_mode === 'credit' && modalPurchase.supplier_contact_id) {
        const { data: c } = await supabase
          .from(CONTACTS_TABLE)
          .select('outstanding_amount')
          .eq('id', modalPurchase.supplier_contact_id)
          .eq('store_id', store.id)
          .maybeSingle();
        if (c) {
          const prev = Math.max(0, Number(c.outstanding_amount ?? 0));
          const dec = Math.min(prev, Math.round(totalReturn * 100) / 100);
          const next = Math.max(0, prev - dec);
          await supabase
            .from(CONTACTS_TABLE)
            .update({ outstanding_amount: next })
            .eq('id', modalPurchase.supplier_contact_id)
            .eq('store_id', store.id);
        }
      }

      closeModal();
      await fetchPurchases();
      toast.success('تم تسجيل المرتجع وتحديث المخزن' + (modalPurchase.payment_mode === 'credit' ? ' والذمة.' : '.'));
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'فشل تسجيل المرتجع');
    } finally {
      setSubmitting(false);
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
        <div className="flex flex-wrap gap-3 items-center">
          <button
            type="button"
            onClick={() => fetchPurchases()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 hover:border-indigo-200 disabled:opacity-50 transition-all dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:shadow-none dark:hover:bg-white/10"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            تحديث
          </button>
          <Link
            to="/purchases/supplier-statement"
            className="text-sm font-bold text-teal-700 hover:text-teal-900 dark:text-teal-400 dark:hover:text-teal-200"
          >
            كشف حساب مورد
          </Link>
          <Link
            to="/purchases"
            className="text-sm font-bold text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"
          >
            ← فاتورة مشتريات جديدة
          </Link>
        </div>
      }
    >
      <div className="max-w-4xl mx-auto space-y-6" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
            <ShoppingBag size={24} />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900 dark:text-white">سجل المشتريات</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              إرجاع أصناف تالفة أو غير مطابقة — يُخصم من المخزن ومن ذمة المورد عند الآجل
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden dark:border-gray-700/50 dark:bg-gray-900/70 dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.35)]">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/60 dark:bg-slate-800/40 flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                placeholder="بحث في المورد أو الفاتورة أو المبلغ…"
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-900 text-slate-800 dark:text-slate-100 text-xs py-2 pr-8 pl-3 placeholder:text-slate-400 focus:outline-none focus:border-indigo-300 dark:focus:border-indigo-500"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-900 text-slate-700 dark:text-slate-200 text-xs py-2 px-3 focus:outline-none focus:border-indigo-300"
            >
              <option value="all">كل الحالات</option>
              <option value="received">تم الاستلام</option>
              <option value="paid">مدفوعة</option>
              <option value="draft">مسودة</option>
            </select>
            <select
              value={filterPayment}
              onChange={(e) => setFilterPayment(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-900 text-slate-700 dark:text-slate-200 text-xs py-2 px-3 focus:outline-none focus:border-indigo-300"
            >
              <option value="all">كل طرق الدفع</option>
              <option value="cash">كاش</option>
              <option value="credit">آجل</option>
            </select>
            {hasActiveFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-900/40"
              >
                <X size={13} />
                مسح
              </button>
            )}
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 mr-auto" lang="en">
              {filteredRows.length}
              {hasActiveFilter ? ` / ${rows.length}` : ''} فاتورة
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-700/80">
            {filteredRows.length === 0 ? (
              <p className="p-8 text-center text-slate-500 font-bold text-sm dark:text-slate-400">
                {rows.length === 0 ? 'لا توجد فواتير مشتريات بعد' : 'لا توجد نتائج مطابقة'}
                {hasActiveFilter && rows.length > 0 && (
                  <button type="button" onClick={clearFilters} className="block mx-auto mt-2 text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:underline">
                    مسح الفلاتر
                  </button>
                )}
              </p>
            ) : (
              filteredRows.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50/80 dark:hover:bg-white/[0.04]"
                >
                  <div className="min-w-0">
                    <p className="font-black text-slate-900 truncate dark:text-white">{p.supplier_company_name || 'مورد'}</p>
                    <p className="text-[11px] text-slate-500 font-currency dark:text-slate-400" dir="ltr" lang="en">
                      {p.invoice_number} · {p.invoice_date} · ₪{' '}
                      {Number(p.total_amount).toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      · {p.payment_mode === 'credit' ? 'آجل' : 'كاش'} · {purchaseStatusBadge(p)}
                      {Number(p.landed_cost_extra || 0) > 0 && (
                        <span className="text-violet-600 font-bold dark:text-violet-400">
                          {' '}
                          · واصل ₪{Number(p.landed_cost_extra).toFixed(2)}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    {(p.purchase_status || 'received') === 'draft' && (
                      <button
                        type="button"
                        onClick={() => confirmReceiveFromDraft(p)}
                        disabled={receivingId === p.id}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-violet-300 bg-violet-100 px-3 py-2 text-xs font-black text-violet-950 hover:bg-violet-200 disabled:opacity-50 dark:border-violet-600/50 dark:bg-violet-950/50 dark:text-violet-100 dark:hover:bg-violet-900/60"
                      >
                        {receivingId === p.id ? <Loader2 className="animate-spin" size={16} /> : null}
                        تأكيد الاستلام
                      </button>
                    )}
                    {p.payment_mode === 'credit' &&
                      (p.purchase_status === 'received' || !p.purchase_status) &&
                      !p.credit_settled_at && (
                        <button
                          type="button"
                          onClick={() => markPurchasePaid(p)}
                          disabled={payingId === p.id}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-100 px-3 py-2 text-xs font-black text-emerald-950 hover:bg-emerald-200 disabled:opacity-50 dark:border-emerald-700/50 dark:bg-emerald-950/45 dark:text-emerald-100 dark:hover:bg-emerald-900/50"
                        >
                          {payingId === p.id ? <Loader2 className="animate-spin" size={16} /> : null}
                          تسجيل كمدفوع
                        </button>
                      )}
                    <button
                      type="button"
                      onClick={() => openPrint(p)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-900 hover:bg-emerald-100 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                    >
                      <Printer size={16} />
                      طباعة
                    </button>
                    <button
                      type="button"
                      onClick={() => openReturn(p)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-950 hover:bg-amber-100 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/45"
                    >
                      <RotateCcw size={16} />
                      إرجاع أصناف
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {modalPurchase && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={closeModal}
          role="presentation"
        >
          <div
            className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl p-6 dark:bg-gray-900 dark:border dark:border-white/10"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div className="flex justify-between items-start gap-2 mb-4">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  إرجاع لـ {modalPurchase.supplier_company_name}
                </h3>
                <p className="text-xs text-slate-500 font-currency dark:text-slate-400" dir="ltr" lang="en">
                  فاتورة {modalPurchase.invoice_number}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-600 dark:text-slate-400"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-xs text-slate-600 mb-3 dark:text-slate-400">
              أدخل كمية المرتجع لكل سطر مربوط بصنف. يُخصم من المخزن ويُنقص دين المورد بقيمة المرتجع عند الفاتورة
              الآجلة.
            </p>

            <ul className="space-y-3 mb-6">
              {parsedLines.map((item, i) => {
                const maxQ = Math.floor(Math.max(0, parseFloat(String(item.qty).replace(',', '.')) || 0));
                const hasPid = !!item.product_id;
                return (
                  <li
                    key={i}
                    className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/5"
                  >
                    <div className="font-bold text-slate-800 dark:text-slate-200">
                      {item.product_name || item.name || item.barcode || item.reference || `صنف ${i + 1}`}
                    </div>
                    {(item.barcode || item.reference) && (item.product_name || item.name) && (
                      <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400" dir="ltr">
                        {item.barcode || item.reference}
                      </p>
                    )}
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-currency" dir="ltr">
                      كمية أصلية: {maxQ} {item.unit_price != null ? `· ₪${Number(item.unit_price).toFixed(2)}` : ''}
                    </p>
                    {!hasPid && (
                      <p className="text-amber-800 font-bold mt-1 dark:text-amber-300">غير مربوط بمخزن — لا يُرجع آلياً</p>
                    )}
                    {hasPid && (
                      <label className="flex items-center gap-2 mt-2">
                        <span className="text-slate-600 font-bold dark:text-slate-400">كمية الإرجاع:</span>
                        <input
                          type="number"
                          min={0}
                          max={maxQ}
                          value={returnQty[i] ?? ''}
                          onChange={(e) =>
                            setReturnQty((prev) => ({ ...prev, [i]: e.target.value }))
                          }
                          className="w-24 rounded-lg border border-slate-200 px-2 py-1 font-currency bg-white dark:bg-slate-950 dark:border-white/15 dark:text-slate-100"
                          dir="ltr"
                          lang="en"
                        />
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  submitReturn();
                }}
                disabled={submitting}
                className="flex-1 py-3 rounded-xl bg-violet-600 text-white font-black text-sm hover:bg-violet-700 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="animate-spin inline" size={18} /> : 'تأكيد الإرجاع'}
              </button>
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-3 rounded-xl border border-slate-200 font-bold text-sm text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {printPurchaseData ? (
        <div
          id="print-invoice-mount"
          className="fixed inset-0 z-[9999] overflow-y-auto bg-white print:static print:inset-auto print:z-auto"
          aria-hidden
        >
          <PrintPurchaseInvoice data={printPurchaseData} />
        </div>
      ) : null}
    </DashboardLayout>
  );
}
