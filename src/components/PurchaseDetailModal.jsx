import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Loader2, Truck, X, Printer, Calendar, Hash, FileText } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

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

export default function PurchaseDetailModal({
  isOpen,
  purchaseId,
  storeId,
  onClose,
}) {
  const [loading, setLoading] = useState(false);
  const [purchase, setPurchase] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen || !purchaseId || !storeId) {
      setPurchase(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    supabase
      .from('store_purchases')
      .select(
        'id, invoice_number, invoice_date, total_amount, payment_mode, payment_due_date, created_at, supplier_company_name, supplier_phone, line_items, notes, landed_cost_extra'
      )
      .eq('id', purchaseId)
      .eq('store_id', storeId)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          console.error('[PurchaseDetailModal] error:', err);
          setError(err.message || 'تعذّر تحميل تفاصيل الفاتورة');
        } else {
          setPurchase(data);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, purchaseId, storeId]);

  if (!isOpen) return null;

  const items = parseLineItems(purchase?.line_items);

  const modalContent = (
    <div
      className="fixed inset-0 z-[10005] flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs"
      onClick={onClose}
      role="presentation"
      dir="rtl"
    >
      <div
        className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-5 sm:p-6 dark:bg-gray-900 border border-slate-200 dark:border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* رأس المودال */}
        <div className="flex justify-between items-start gap-3 mb-5 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300 shrink-0">
              <Truck size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  تفاصيل فاتورة مشتريات
                </h3>
                {purchase?.invoice_number && (
                  <span
                    className="font-currency font-black text-xs px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800"
                    dir="ltr"
                  >
                    #{purchase.invoice_number}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                سجل التوريد والأصناف المشتراة من المورد
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 transition-colors"
            aria-label="إغلاق"
          >
            <X size={22} />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="animate-spin text-teal-600 dark:text-teal-400" size={36} />
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
              جاري تحميل بيانات الفاتورة والأصناف...
            </p>
          </div>
        ) : error ? (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-bold dark:bg-rose-950/30 dark:border-rose-900/50 dark:text-rose-200">
            {error}
          </div>
        ) : purchase ? (
          <div className="space-y-5">
            {/* بطاقات البيانات الأساسية */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-slate-800/50">
                <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 mb-1">المورد</p>
                <p className="font-bold text-slate-900 dark:text-white truncate">
                  {purchase.supplier_company_name || '—'}
                </p>
                {purchase.supplier_phone && (
                  <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                    {purchase.supplier_phone}
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-slate-800/50">
                <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 mb-1">رقم الفاتورة</p>
                <p className="font-mono font-bold text-slate-900 dark:text-slate-100 truncate" dir="ltr">
                  {purchase.invoice_number || '—'}
                </p>
              </div>

              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-slate-800/50">
                <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 mb-1">تاريخ الفاتورة</p>
                <p className="font-currency font-bold text-slate-900 dark:text-slate-100" dir="ltr">
                  {purchase.invoice_date || String(purchase.created_at || '').slice(0, 10) || '—'}
                </p>
              </div>

              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3 dark:border-white/10 dark:bg-slate-800/50">
                <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 mb-1">طريقة الشراء</p>
                <div>
                  {purchase.payment_mode === 'credit' ? (
                    <span className="inline-block rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[11px] font-black dark:bg-amber-950/60 dark:text-amber-200">
                      آجل (ذمة)
                    </span>
                  ) : (
                    <span className="inline-block rounded-full bg-emerald-100 text-emerald-900 px-2 py-0.5 text-[11px] font-black dark:bg-emerald-950/60 dark:text-emerald-200">
                      نقدي (كاش)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {purchase.payment_mode === 'credit' && purchase.payment_due_date && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs font-bold text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200 flex items-center justify-between">
                <span>تاريخ استحقاق سداد الفاتورة:</span>
                <span className="font-currency" dir="ltr">
                  {purchase.payment_due_date}
                </span>
              </div>
            )}

            {/* جدول الأصناف الواردة */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-black text-slate-800 dark:text-slate-200">
                  الأصناف الواردة بالفاتورة ({items.length})
                </h4>
              </div>

              {items.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center rounded-xl bg-slate-50 dark:bg-slate-800/40">
                  لا توجد بنود أسطر مسجلة في الفاتورة.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
                  <table className="w-full text-xs text-right min-w-[500px]">
                    <thead>
                      <tr className="bg-slate-900 text-white dark:bg-slate-950">
                        <th className="p-2.5 w-8 text-center">#</th>
                        <th className="p-2.5">اسم الصنف / البيان</th>
                        <th className="p-2.5 font-mono" dir="ltr">الباركود</th>
                        <th className="p-2.5 text-center">الكمية</th>
                        <th className="p-2.5 text-center font-bold" dir="ltr">سعر الوحدة</th>
                        <th className="p-2.5 text-center font-bold" dir="ltr">المجموع</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {items.map((line, idx) => (
                        <tr
                          key={idx}
                          className="border-b border-slate-100 dark:border-slate-700/80 odd:bg-white even:bg-slate-50/70 dark:odd:bg-slate-800/30 dark:even:bg-slate-800/50"
                        >
                          <td className="p-2.5 text-center text-slate-400 font-bold">{idx + 1}</td>
                          <td className="p-2.5 font-bold text-slate-800 dark:text-slate-100">
                            {line.name || line.item_name || line.description || line.reference || 'صنف مشتريات'}
                          </td>
                          <td className="p-2.5 font-mono text-slate-600 dark:text-slate-300" dir="ltr">
                            {line.barcode || '—'}
                          </td>
                          <td className="p-2.5 text-center font-currency font-bold text-slate-800 dark:text-slate-200" dir="ltr">
                            {line.qty ?? line.quantity ?? '—'}
                          </td>
                          <td className="p-2.5 text-center font-currency text-slate-700 dark:text-slate-300" dir="ltr">
                            ₪{Number(line.unit_price ?? line.unitPrice ?? 0).toFixed(2)}
                          </td>
                          <td className="p-2.5 text-center font-black font-currency text-teal-900 dark:text-teal-200" dir="ltr">
                            ₪{Number(line.line_total ?? (Number(line.qty || 1) * Number(line.unit_price || 0))).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ملخص الإجمالي المالي */}
              <div className="mt-4 rounded-xl border border-teal-100 bg-teal-50/60 p-3.5 dark:border-teal-900/40 dark:bg-teal-950/40 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black text-teal-900/70 dark:text-teal-300/70">
                    إجمالي فاتورة الشراء
                  </p>
                  <p className="text-2xl font-black font-currency text-teal-900 dark:text-teal-100" dir="ltr">
                    ₪{Number(purchase.total_amount ?? 0).toFixed(2)}
                  </p>
                </div>

                {Number(purchase.landed_cost_extra ?? 0) > 0 && (
                  <div className="text-xs">
                    <span className="text-slate-500 dark:text-slate-400">مصاريف شحن واصلة: </span>
                    <span className="font-bold font-currency text-slate-800 dark:text-slate-200" dir="ltr">
                      ₪{Number(purchase.landed_cost_extra).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* الملاحظات */}
            {purchase.notes && (
              <div>
                <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 mb-1">ملاحظات الفاتورة</p>
                <pre className="whitespace-pre-wrap text-xs font-medium text-slate-700 dark:text-slate-200 rounded-xl border border-slate-100 bg-slate-50/90 p-3 max-h-32 overflow-y-auto dark:border-white/10 dark:bg-slate-800/60 leading-relaxed font-sans">
                  {purchase.notes}
                </pre>
              </div>
            )}

            {/* تذييل المودال */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
              <Link
                to="/purchase-history"
                className="font-bold text-teal-700 hover:underline dark:text-teal-400"
              >
                فتح في سجل المشتريات ←
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 font-black text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                إغلاق
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null;
}
