import { useState } from 'react';
import {
  Pause,
  RotateCcw,
  Trash2,
  X,
  Clock,
  Receipt,
  AlertTriangle,
  CheckCircle2,
  Layers,
} from 'lucide-react';
import { roundMoney } from '../utils/productModel';

/**
 * مودال إدارة الفواتير المعلّقة (Parked / Held Invoices Modal)
 *
 * @param {boolean} isOpen حالة ظهور النافذة
 * @param {Function} onClose إغلاق النافذة
 * @param {Array} heldInvoices مصفوفة الفواتير المعلقة
 * @param {boolean} hasCurrentActiveItems هل توجد أصناف في الفاتورة الجارية الحالية
 * @param {Function} onDirectRestore استرجاع الفاتورة مباشرة (عند فراغ السلة)
 * @param {Function} onHoldCurrentAndRestore تعليق السلة الحالية واسترجاع هذه الفاتورة
 * @param {Function} onDiscardCurrentAndRestore تفريغ السلة الحالية واسترجاع هذه الفاتورة
 * @param {Function} onDeleteHeld حذف فاتورة معلقة
 */
export default function HeldInvoicesModal({
  isOpen,
  onClose,
  heldInvoices = [],
  hasCurrentActiveItems = false,
  onDirectRestore,
  onHoldCurrentAndRestore,
  onDiscardCurrentAndRestore,
  onDeleteHeld,
}) {
  // تتبع الفاتورة التي طلب المستخدم استرجاعها وعليها نزاع مع السلة الحالية
  const [conflictTarget, setConflictTarget] = useState(null);
  // تتبع الفاتورة التي طلب المستخدم تأكيد حذفها
  const [deleteTargetId, setDeleteTargetId] = useState(null);

  if (!isOpen) return null;

  const handleRestoreClick = (invoice) => {
    if (hasCurrentActiveItems) {
      setConflictTarget(invoice);
    } else {
      onDirectRestore?.(invoice);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 dark:bg-slate-950/85 backdrop-blur-md p-3 sm:p-4 animate-in fade-in duration-150 font-arabic"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      onClick={() => {
        setConflictTarget(null);
        setDeleteTargetId(null);
        onClose?.();
      }}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200/90 dark:border-white/10 bg-white/95 dark:bg-slate-900/95 shadow-2xl backdrop-blur-2xl text-right text-slate-900 dark:text-white flex flex-col max-h-[88vh] transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── رأس المودال ── */}
        <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-white/10 px-5 py-3.5 bg-slate-50/80 dark:bg-slate-950/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-950/80 dark:text-amber-400 shadow-xs">
              <Pause size={20} strokeWidth={2.5} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                  الفواتير المعلّقة (Parked Sales)
                </h3>
                <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-950/80 border border-amber-300 dark:border-amber-700/80 px-2 py-0.5 text-xs font-mono font-bold text-amber-800 dark:text-amber-300">
                  {heldInvoices.length} فاتورة
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                فواتير تم تعليقها مؤقتاً خلال الشيفت الحالي لاستئنافها لاحقاً
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white transition cursor-pointer"
            title="إغلاق (Esc)"
          >
            <X size={20} />
          </button>
        </div>

        {/* ── قائمة الفواتير المعلّقة ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[220px] max-h-[62vh] bg-slate-50/50 dark:bg-slate-950/40">
          {heldInvoices.length === 0 ? (
            <div className="py-14 text-center px-4 space-y-3">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800/80 text-slate-400 dark:text-slate-500 flex items-center justify-center border border-slate-200/60 dark:border-slate-700/60 shadow-xs">
                <Receipt size={26} />
              </div>
              <h4 className="text-base font-black text-slate-700 dark:text-slate-300">
                لا توجد فواتير معلّقة حالياً
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
                يمكنك الضغط على زر «تعليق الفاتورة ⏸» فوق جدول الفاتورة لتعليق طلب الزبون والبدء بزبون آخر فوراً دون فقدان البيانات.
              </p>
            </div>
          ) : (
            heldInvoices.map((inv) => {
              const isConflictOpen = conflictTarget?.id === inv.id;
              const isConfirmDelete = deleteTargetId === inv.id;
              const itemCount = (inv.items || []).length;
              const unitCount =
                inv.totalUnits ||
                (inv.items || []).reduce((acc, it) => acc + (Number(it.qty) || 1), 0);
              const totalMoney = roundMoney(
                inv.totalAmount ||
                  (inv.items || []).reduce((acc, it) => acc + (Number(it.lineTotal) || 0), 0)
              );

              return (
                <div
                  key={inv.id}
                  className="rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white dark:bg-slate-900 p-4 shadow-sm hover:shadow-md transition-all space-y-3"
                >
                  {/* رأس بطاقة الفاتورة المعلّقة */}
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center justify-center h-7 px-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 text-xs font-black font-mono">
                        #{inv.number || '1'}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 font-medium">
                        <Clock size={13} className="text-slate-400" />
                        <span>{inv.displayTime || new Date(inv.heldAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {itemCount} صنف ({unitCount} قطعة)
                      </span>
                      <span className="font-mono text-base font-black text-emerald-600 dark:text-emerald-400">
                        {totalMoney} ₪
                      </span>
                    </div>
                  </div>

                  {/* معاينة سريعة لأسماء الأصناف */}
                  <div className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/60 p-2.5 rounded-xl border border-slate-100 dark:border-white/5 line-clamp-2">
                    <span className="font-bold text-slate-500 dark:text-slate-400 me-1">الأصناف:</span>
                    {(inv.items || [])
                      .map((it) => `${it.name || it.baseName} (${it.qty} ${it.unit || 'قطعة'})`)
                      .join(' ، ')}
                  </div>

                  {/* في حال النزاع: رسالة تأكيد الخيارات */}
                  {isConflictOpen && (
                    <div className="rounded-xl border border-amber-200 dark:border-amber-800/80 bg-amber-50/90 dark:bg-amber-950/40 p-3 space-y-2.5 animate-in fade-in zoom-in-95 duration-100">
                      <div className="flex items-start gap-2 text-xs font-bold text-amber-800 dark:text-amber-300">
                        <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p>توجد أصناف غير محفوظة في الفاتورة الحالية الجارية.</p>
                          <p className="text-[11px] font-normal text-amber-700 dark:text-amber-400">
                            كيف تود التعامل مع الفاتورة الحالية قبل استرجاع الفاتورة #{inv.number}؟
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setConflictTarget(null);
                            onHoldCurrentAndRestore?.(inv);
                          }}
                          className="flex-1 min-w-[170px] inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition cursor-pointer"
                        >
                          <Pause size={13} />
                          <span>تعليق الحالية واسترجاع هذه ✓</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setConflictTarget(null);
                            onDiscardCurrentAndRestore?.(inv);
                          }}
                          className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm transition cursor-pointer"
                        >
                          <Trash2 size={13} />
                          <span>تفريغ الحالية واسترجاع هذه</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setConflictTarget(null)}
                          className="py-2 px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition cursor-pointer"
                        >
                          إلغاء
                        </button>
                      </div>
                    </div>
                  )}

                  {/* في حال تأكيد الحذف */}
                  {isConfirmDelete && (
                    <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/90 dark:bg-rose-950/40 p-3 space-y-2 animate-in fade-in zoom-in-95 duration-100">
                      <p className="text-xs font-bold text-rose-800 dark:text-rose-300 flex items-center gap-1.5">
                        <AlertTriangle size={15} />
                        هل أنت متأكد من حذف الفاتورة المعلّقة #{inv.number} نهائياً؟
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteTargetId(null);
                            onDeleteHeld?.(inv.id);
                          }}
                          className="rounded-lg bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 text-xs font-bold shadow-sm transition cursor-pointer"
                        >
                          نعم، حذف نهائي
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTargetId(null)}
                          className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                        >
                          تراجع
                        </button>
                      </div>
                    </div>
                  )}

                  {/* أزرار الإجراءات العادية (استرجاع وحذف) */}
                  {!isConflictOpen && !isConfirmDelete && (
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleRestoreClick(inv)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white px-4 py-2 text-xs font-bold shadow-sm hover:shadow-md transition active:scale-95 cursor-pointer"
                      >
                        <RotateCcw size={14} />
                        <span>استرجاع الفاتورة</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setDeleteTargetId(inv.id);
                          setConflictTarget(null);
                        }}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition cursor-pointer"
                        title="حذف هذه الفاتورة المعلّقة"
                      >
                        <Trash2 size={14} />
                        <span>حذف</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ── ذيل المودال (Footer) ── */}
        <div className="px-5 py-3 border-t border-slate-200/80 dark:border-white/10 bg-slate-50/90 dark:bg-slate-950/60 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between shrink-0">
          <span className="font-bold text-slate-600 dark:text-slate-300">
            الفواتير المعلّقة محفوظة بأمان طوال فترة الشيفت الحالي
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
