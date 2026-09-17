import { useState } from 'react';
import {
  Clock,
  X,
  Receipt,
  RotateCcw,
  AlertCircle,
  CreditCard,
  Banknote,
  Calendar,
  User,
  Package,
  CheckCircle2,
  ChevronLeft,
  ArrowRight,
  Info,
} from 'lucide-react';
import { roundMoney } from '../utils/productModel';

/**
 * مودال مراجعة آخر فواتير الشيفت الحالي مع إمكانية إرجاع صنف من الفاتورة
 *
 * @param {boolean} isOpen حالة ظهور النافذة
 * @param {Function} onClose إغلاق النافذة
 * @param {Array} invoices قائمة آخر فواتير الشيفت (حتى 5 فواتير)
 * @param {boolean} loading حالة تحميل الفواتير
 * @param {Function} onReturnItem دالة تنفيذ إرجاع صنف: (sale, item, returnQty, returnAmount) => Promise<void>
 */
export default function RecentInvoicesModal({
  isOpen,
  onClose,
  invoices = [],
  loading = false,
  onReturnItem,
}) {
  // الفاتورة المختارة للعرض التفصيلي
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  // حالة واجهة إرجاع صنف
  const [returnMode, setReturnMode] = useState(false);
  const [selectedReturnItemIndex, setSelectedReturnItemIndex] = useState(0);
  const [returnQty, setReturnQty] = useState(1);
  const [returnReason, setReturnReason] = useState('');
  const [submittingReturn, setSubmittingReturn] = useState(false);

  if (!isOpen) return null;

  // إغلاق النافذة وتنظيف الحالات المؤقتة
  const handleClose = () => {
    setSelectedInvoice(null);
    setReturnMode(false);
    setSelectedReturnItemIndex(0);
    setReturnQty(1);
    setReturnReason('');
    onClose?.();
  };

  // فتح شاشة إرجاع صنف لفاتورة معينة
  const handleStartReturn = (inv) => {
    setSelectedInvoice(inv);
    setReturnMode(true);
    setSelectedReturnItemIndex(0);
    setReturnQty(1);
    setReturnReason('');
  };

  // استخراج البنود بأمان
  const parseLines = (inv) => {
    if (!inv) return [];
    if (Array.isArray(inv.line_items)) return inv.line_items;
    if (typeof inv.line_items === 'string') {
      try {
        const p = JSON.parse(inv.line_items);
        return Array.isArray(p) ? p : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const invoiceLines = selectedInvoice ? parseLines(selectedInvoice) : [];
  const currentReturnItem = invoiceLines[selectedReturnItemIndex] || invoiceLines[0] || null;

  // الحد الأقصى لكمية الإرجاع المسموحة للصنف المختار
  const maxAvailableQty = currentReturnItem
    ? Math.max(1, Number(currentReturnItem.qty || 1) - Number(currentReturnItem.returned_qty || 0))
    : 1;

  const returnUnitPrice = Number(currentReturnItem?.unit_price || currentReturnItem?.price || 0);
  const calculatedRefundAmount = roundMoney(returnUnitPrice * Number(returnQty || 0));

  // معالجة تأكيد الإرجاع
  const handleConfirmReturn = async () => {
    if (!selectedInvoice || !currentReturnItem) return;
    const qtyNum = Number(returnQty);
    if (isNaN(qtyNum) || qtyNum <= 0 || qtyNum > maxAvailableQty) {
      alert(`يرجى تحديد كمية صحيحة بين 1 و ${maxAvailableQty}`);
      return;
    }

    setSubmittingReturn(true);
    try {
      await onReturnItem?.(selectedInvoice, currentReturnItem, qtyNum, calculatedRefundAmount, returnReason);
      setReturnMode(false);
      setSelectedInvoice(null);
      handleClose();
    } catch (err) {
      console.error('Error in return item handler:', err);
    } finally {
      setSubmittingReturn(false);
    }
  };

  // تسمية طريقة الدفع
  const getPaymentBadge = (inv) => {
    const mode = (inv.payment_mode || '').toLowerCase();
    const method = (inv.payment_method || '').toLowerCase();
    const isCredit = mode === 'credit' || method === 'deferred' || method === 'credit';
    const isCard = mode === 'visa' || mode === 'card' || method === 'card' || method === 'visa';

    if (isCredit) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-700/80 px-2 py-0.5 text-xs font-bold text-amber-800 dark:text-amber-300">
          <User size={12} />
          <span>آجل (ذمة)</span>
        </span>
      );
    }
    if (isCard) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 dark:bg-indigo-950/70 border border-indigo-300 dark:border-indigo-700/80 px-2 py-0.5 text-xs font-bold text-indigo-800 dark:text-indigo-300">
          <CreditCard size={12} />
          <span>بطاقة (فيزا)</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-700/80 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
        <Banknote size={12} />
        <span>نقدي (كاش)</span>
      </span>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 dark:bg-slate-950/85 backdrop-blur-md p-3 sm:p-4 animate-in fade-in duration-150 font-arabic"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200/90 dark:border-white/10 bg-white/95 dark:bg-slate-900/95 shadow-2xl backdrop-blur-2xl text-right text-slate-900 dark:text-white flex flex-col max-h-[88vh] transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── رأس المودال ── */}
        <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-white/10 px-5 py-3.5 bg-slate-50/80 dark:bg-slate-950/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950/80 dark:text-indigo-400 shadow-xs">
              <Clock size={20} strokeWidth={2.5} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                  {returnMode
                    ? `إرجاع صنف من الفاتورة #${String(selectedInvoice?.id || '').slice(0, 8).toUpperCase()}`
                    : selectedInvoice
                    ? `تفاصيل الفاتورة #${String(selectedInvoice?.id || '').slice(0, 8).toUpperCase()}`
                    : 'آخر فواتير الشيفت الحالي'}
                </h3>
                {!selectedInvoice && (
                  <span className="inline-flex items-center rounded-full bg-indigo-100 dark:bg-indigo-950/80 border border-indigo-300 dark:border-indigo-700/80 px-2 py-0.5 text-xs font-mono font-bold text-indigo-800 dark:text-indigo-300">
                    {invoices.length} فواتير
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {returnMode
                  ? 'اختر الصنف والكمية المرتجعة لتحديث المخزون والمالية تلقائياً'
                  : selectedInvoice
                  ? 'عرض تفصيلي للبنود ومراجعة الحركات المالية'
                  : 'آخر 5 فواتير مكتملة في هذه الجلسة مرتبة من الأحدث إلى الأقدم'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {(selectedInvoice || returnMode) && (
              <button
                type="button"
                onClick={() => {
                  if (returnMode) setReturnMode(false);
                  else setSelectedInvoice(null);
                }}
                className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                title="الرجوع للقائمة"
              >
                <ArrowRight size={15} />
                <span>رجوع</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleClose}
              className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white transition cursor-pointer"
              title="إغلاق (Esc)"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ── المحتوى الرئيسي ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[220px] max-h-[62vh] bg-slate-50/50 dark:bg-slate-950/40">
          {/* 1. واجهة إرجاع صنف من الفاتورة */}
          {returnMode && selectedInvoice ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-amber-200 dark:border-amber-800/80 bg-amber-50/80 dark:bg-amber-950/30 p-4 space-y-3 text-xs">
                <div className="flex items-center gap-2 font-black text-amber-800 dark:text-amber-300">
                  <RotateCcw size={16} />
                  <span>تحديد صنف وكمية الإرجاع</span>
                </div>
                <p className="text-slate-600 dark:text-slate-400">
                  سيتم زيادة كمية الصنف في المخزون فوراً، وتخفيض مديونية الزبون (إن كانت الفاتورة آجلة) أو عكس المبلغ من الصندوق.
                </p>
              </div>

              {/* اختيار الصنف من الفاتورة */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  اختر الصنف المراد إرجاعه من الفاتورة:
                </label>
                <select
                  value={selectedReturnItemIndex}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    setSelectedReturnItemIndex(idx);
                    setReturnQty(1);
                  }}
                  className="w-full h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {invoiceLines.map((line, idx) => {
                    const lineAvail = Math.max(0, Number(line.qty || 1) - Number(line.returned_qty || 0));
                    return (
                      <option key={idx} value={idx} disabled={lineAvail <= 0}>
                        {line.name} — المباع: {line.qty} {line.unit || 'قطعة'} (السعر: {line.unit_price || line.price} ₪)
                        {lineAvail <= 0 ? ' [تم إرجاعه بالكامل]' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* تحديد الكمية المراد إرجاعها */}
              {currentReturnItem && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      كمية الإرجاع (الحد الأقصى: {maxAvailableQty} {currentReturnItem.unit || 'قطعة'}):
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max={maxAvailableQty}
                        step="1"
                        value={returnQty}
                        onChange={(e) => {
                          const val = Math.max(1, Math.min(maxAvailableQty, Number(e.target.value) || 1));
                          setReturnQty(val);
                        }}
                        className="w-full h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-base font-bold font-mono text-center text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setReturnQty(maxAvailableQty)}
                        className="h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition shrink-0"
                      >
                        الكل ({maxAvailableQty})
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      إجمالي المبلغ المسترد:
                    </label>
                    <div className="h-11 rounded-xl border border-emerald-300 dark:border-emerald-700/80 bg-emerald-50 dark:bg-emerald-950/40 px-3 flex items-center justify-between">
                      <span className="text-xs text-emerald-800 dark:text-emerald-300 font-bold">
                        {returnQty} × {returnUnitPrice} ₪ =
                      </span>
                      <strong className="font-mono text-lg font-black text-emerald-700 dark:text-emerald-300">
                        {calculatedRefundAmount} ₪
                      </strong>
                    </div>
                  </div>
                </div>
              )}

              {/* سبب الإرجاع (اختياري) */}
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  سبب الإرجاع / ملاحظة (اختياري):
                </label>
                <input
                  type="text"
                  placeholder="مثال: تبديل صنف، عيب في المنتج، رغبة الزبون..."
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* أزرار التأكيد */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200/80 dark:border-white/10">
                <button
                  type="button"
                  disabled={submittingReturn || maxAvailableQty <= 0}
                  onClick={handleConfirmReturn}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white px-5 py-2.5 text-xs font-bold shadow-md transition active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  <RotateCcw size={14} className={submittingReturn ? 'animate-spin' : ''} />
                  <span>{submittingReturn ? 'جاري تسجيل الإرجاع...' : `تأكيد إرجاع الصنف (${calculatedRefundAmount} ₪)`}</span>
                </button>

                <button
                  type="button"
                  disabled={submittingReturn}
                  onClick={() => setReturnMode(false)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </div>
          ) : selectedInvoice ? (
            /* 2. العرض التفصيلي للفاتورة المختارة */
            <div className="space-y-4">
              {/* ملخص رأس الفاتورة */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white dark:bg-slate-900 p-4 shadow-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-black text-indigo-700 dark:text-indigo-400">
                      #{String(selectedInvoice.id).slice(0, 8).toUpperCase()}
                    </span>
                    {getPaymentBadge(selectedInvoice)}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1">
                    <span className="flex items-center gap-1">
                      <Calendar size={13} />
                      <span>{new Date(selectedInvoice.created_at).toLocaleDateString('ar-EG')}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={13} />
                      <span>{new Date(selectedInvoice.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
                    </span>
                  </div>
                </div>

                <div className="text-left">
                  <span className="text-xs text-slate-400">إجمالي الفاتورة:</span>
                  <div className="font-mono text-xl font-black text-emerald-600 dark:text-emerald-400">
                    {roundMoney(selectedInvoice.total_amount)} ₪
                  </div>
                </div>
              </div>

              {/* جدول بنود الفاتورة */}
              <div className="overflow-hidden rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white dark:bg-slate-900 shadow-sm">
                <div className="px-4 py-2.5 border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-slate-950/60 flex items-center justify-between">
                  <h4 className="text-xs font-black text-slate-700 dark:text-slate-200">
                    بنود الفاتورة ({invoiceLines.length} صنف)
                  </h4>
                  <span className="text-[11px] text-slate-400">للمعاينة والمراجعة</span>
                </div>

                <table className="w-full text-right text-xs border-collapse">
                  <thead className="border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900/90 text-slate-600 dark:text-slate-300 font-bold">
                    <tr>
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">اسم المنتج</th>
                      <th className="py-2 px-2 text-center">الوحدة</th>
                      <th className="py-2 px-2 text-center">الكمية</th>
                      <th className="py-2 px-2 text-center">السعر</th>
                      <th className="py-2 px-3 text-left">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {invoiceLines.map((line, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-2 px-3 font-mono text-slate-400">{idx + 1}</td>
                        <td className="py-2 px-3 font-bold text-slate-800 dark:text-slate-100">
                          {line.name}
                          {line.barcode && line.barcode !== '—' && (
                            <span className="block font-mono text-[10px] text-slate-400 font-normal">
                              {line.barcode}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-center text-slate-600 dark:text-slate-300 font-medium">
                          {line.unit || 'قطعة'}
                        </td>
                        <td className="py-2 px-2 text-center font-mono font-bold text-slate-800 dark:text-slate-200">
                          {line.qty}
                        </td>
                        <td className="py-2 px-2 text-center font-mono text-slate-600 dark:text-slate-300">
                          {line.unit_price || line.price} ₪
                        </td>
                        <td className="py-2 px-3 text-left font-mono font-bold text-slate-800 dark:text-slate-100">
                          {line.line_total || roundMoney((line.qty || 1) * (line.unit_price || line.price || 0))} ₪
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ملحوظات الفاتورة إن وجدت */}
              {selectedInvoice.notes && (
                <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-950/40 p-3 text-xs text-slate-600 dark:text-slate-400 whitespace-pre-line">
                  <span className="font-bold text-slate-500 dark:text-slate-300 block mb-1">الملاحظات:</span>
                  {selectedInvoice.notes}
                </div>
              )}

              {/* زر إرجاع صنف من الفاتورة */}
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-slate-400">
                  هل يحتاج الزبون لإرجاع صنف من هذه الفاتورة؟
                </span>
                <button
                  type="button"
                  onClick={() => handleStartReturn(selectedInvoice)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 dark:border-amber-700/80 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 px-4 py-2 text-xs font-bold hover:bg-amber-100 dark:hover:bg-amber-900/60 shadow-xs transition cursor-pointer active:scale-95"
                >
                  <RotateCcw size={14} className="text-amber-600 dark:text-amber-400" />
                  <span>إرجاع صنف من هاي الفاتورة</span>
                </button>
              </div>
            </div>
          ) : (
            /* 3. قائمة آخر 5 فواتير في الشيفت */
            <div className="space-y-3">
              {loading ? (
                <div className="py-12 text-center text-slate-400">جاري جلب فواتير الشيفت...</div>
              ) : invoices.length === 0 ? (
                <div className="py-14 text-center px-4 space-y-3">
                  <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800/80 text-slate-400 dark:text-slate-500 flex items-center justify-center border border-slate-200/60 dark:border-slate-700/60 shadow-xs">
                    <Receipt size={26} />
                  </div>
                  <h4 className="text-base font-black text-slate-700 dark:text-slate-300">
                    لا توجد فواتير مكتملة في الشيفت الحالي بعد
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
                    عند إتمام أي عملية بيع كاش أو فيزا أو آجل، ستظهر هنا آخر الفواتير لتتمكن من مراجعتها أو إرجاع أصناف منها بسرعة.
                  </p>
                </div>
              ) : (
                invoices.map((inv) => {
                  const lines = parseLines(inv);
                  const itemCount = lines.length;
                  const totalMoney = roundMoney(Number(inv.total_amount || 0));
                  const invTime = inv.created_at
                    ? new Date(inv.created_at).toLocaleTimeString('ar-EG', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—';

                  return (
                    <div
                      key={inv.id}
                      onClick={() => setSelectedInvoice(inv)}
                      className="group rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white dark:bg-slate-900 p-4 shadow-sm hover:shadow-md hover:border-indigo-400 dark:hover:border-indigo-600/70 transition-all cursor-pointer space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-black text-indigo-700 dark:text-indigo-400 group-hover:underline">
                            #{String(inv.id).slice(0, 8).toUpperCase()}
                          </span>
                          {getPaymentBadge(inv)}
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1 text-xs text-slate-400 font-mono">
                            <Clock size={12} />
                            <span>{invTime}</span>
                          </span>
                          <span className="font-mono text-base font-black text-emerald-600 dark:text-emerald-400">
                            {totalMoney} ₪
                          </span>
                        </div>
                      </div>

                      {/* ملخص البنود */}
                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/60 px-3 py-2 rounded-xl">
                        <span className="truncate max-w-[360px]">
                          {lines.length > 0
                            ? lines.map((l) => l.name).join(' ، ')
                            : 'لا توجد تفاصيل بنود'}
                        </span>
                        <span className="shrink-0 font-semibold text-slate-600 dark:text-slate-300">
                          {itemCount} صنف
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* ── ذيل المودال (Footer) ── */}
        <div className="px-5 py-3 border-t border-slate-200/80 dark:border-white/10 bg-slate-50/90 dark:bg-slate-950/60 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between shrink-0">
          <span className="font-medium text-slate-600 dark:text-slate-300">
            {selectedInvoice
              ? 'انقر على «إرجاع صنف» لتعديل المخزون والمالية'
              : 'الفواتير معروضة للقراءة والمراجعة السريعة أثناء الشيفت'}
          </span>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
