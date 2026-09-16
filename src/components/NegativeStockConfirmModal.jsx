import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X, Check } from 'lucide-react';

/**
 * نافذة تأكيد سريعة لتجاوز المخزون بالسالب عند تعديل الفاتورة
 * تدعم لوحة المفاتيح:
 * - Enter = متابعة
 * - Esc = إلغاء
 */
export default function NegativeStockConfirmModal({
  isOpen,
  items = [],
  onConfirm,
  onCancel,
  loading = false,
}) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (loading) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onConfirm, onCancel, loading]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10005] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
    >
      <div
        className="w-full max-w-lg rounded-3xl border border-amber-300/80 bg-white p-6 shadow-2xl dark:border-amber-700/60 dark:bg-gray-900 animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* رأس النافذة */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 shrink-0">
              <AlertTriangle size={26} />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white">
                تنبيه: عجز في المخزون
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 font-bold mt-0.5">
                الكميات الجديدة المطلوبة تتجاوز المخزون المتوفر لبعض الأصناف
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !loading && onCancel()}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        {/* جدول الأصناف المتأثرة */}
        <div className="mb-5 overflow-hidden rounded-2xl border border-amber-200/80 dark:border-amber-900/40">
          <div className="max-h-56 overflow-y-auto">
            <table className="w-full text-xs text-right">
              <thead>
                <tr className="bg-amber-50 dark:bg-amber-950/50 text-amber-950 dark:text-amber-200 font-black">
                  <th className="p-2.5">الصنف</th>
                  <th className="p-2.5 text-center">المتوفر حالياً</th>
                  <th className="p-2.5 text-center">الخصم الإضافي</th>
                  <th className="p-2.5 text-center">الرصيد الناتج</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100 dark:divide-amber-900/30">
                {items.map((it, idx) => (
                  <tr key={idx} className="bg-white dark:bg-slate-900/80">
                    <td className="p-2.5 font-bold text-slate-900 dark:text-white">
                      <div>{it.name || 'صنف بدون اسم'}</div>
                      {it.barcode && (
                        <div className="text-[10px] font-mono text-slate-400" dir="ltr">
                          {it.barcode}
                        </div>
                      )}
                    </td>
                    <td className="p-2.5 text-center font-currency font-bold text-slate-700 dark:text-slate-300" dir="ltr">
                      {Number(it.currentStock ?? 0)}
                    </td>
                    <td className="p-2.5 text-center font-currency font-bold text-amber-700 dark:text-amber-400" dir="ltr">
                      -{Number(it.neededDelta ?? 0)}
                    </td>
                    <td className="p-2.5 text-center font-currency font-black text-rose-600 dark:text-rose-400" dir="ltr">
                      {Number(it.projectedStock ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 mb-5 leading-relaxed">
          هل ترغب في تأكيد التعديل وتمرير الحركة بالرصيد السالب؟
        </div>

        {/* أزرار الإجراءات مع اختصارات لوحة المفاتيح */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[10px] border border-slate-200 dark:border-slate-700">Enter</span> للمتابعة
            <span className="mx-1">•</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[10px] border border-slate-200 dark:border-slate-700">Esc</span> للإلغاء
          </div>

          <div className="flex items-center gap-2 mr-auto">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              إلغاء (Esc)
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-black text-white bg-amber-600 hover:bg-amber-700 active:scale-95 shadow-md shadow-amber-600/20 transition-all disabled:opacity-50"
            >
              <Check size={16} />
              متابعة بالتعديل (Enter)
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
