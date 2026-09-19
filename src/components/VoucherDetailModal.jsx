import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, Receipt, Wallet, Calendar, Hash, CreditCard } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

const VOUCHERS_TABLE = import.meta.env.VITE_SUPABASE_VOUCHERS_TABLE?.trim() || 'vouchers';

export default function VoucherDetailModal({ isOpen, voucherId, storeId, onClose }) {
  const [voucher, setVoucher] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen || !voucherId || !storeId) {
      setVoucher(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    supabase
      .from(VOUCHERS_TABLE)
      .select('*')
      .eq('id', voucherId)
      .eq('store_id', storeId)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          console.error('[VoucherDetailModal] error:', err);
          setError(err.message || 'تعذّر تحميل بيانات السند');
        } else {
          setVoucher(data);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, voucherId, storeId]);

  if (!isOpen) return null;

  const isPayment = (voucher?.voucher_type || voucher?.type) === 'payment';
  const checks = Array.isArray(voucher?.check_lines)
    ? voucher.check_lines
    : typeof voucher?.check_lines === 'string'
    ? (() => {
        try {
          return JSON.parse(voucher.check_lines);
        } catch {
          return [];
        }
      })()
    : [];

  const modalContent = (
    <div
      className="fixed inset-0 z-[10005] flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs"
      onClick={onClose}
      role="presentation"
      dir="rtl"
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl p-5 sm:p-6 border border-slate-200 dark:border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl shrink-0 ${
                isPayment
                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300'
                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
              }`}
            >
              {isPayment ? <Wallet size={22} /> : <Receipt size={22} />}
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white">
                {isPayment ? 'تفاصيل سند صرف' : 'تفاصيل سند قبض'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                سجل الدفعة النقدية المسجلة في الحساب
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400"
          >
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2">
            <Loader2 className="animate-spin text-indigo-500" size={32} />
            <span className="text-xs font-bold text-slate-500">جاري تحميل السند...</span>
          </div>
        ) : error ? (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold dark:bg-rose-950/30 dark:border-rose-900/50 dark:text-rose-200">
            {error}
          </div>
        ) : voucher ? (
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-white/10 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-400 block mb-0.5">مبلغ السند</span>
                <span
                  className={`text-2xl font-black font-currency ${
                    isPayment
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                  dir="ltr"
                >
                  ₪{Number(voucher.amount || 0).toFixed(2)}
                </span>
              </div>
              <div className="text-left">
                <span className="text-[10px] font-bold text-slate-400 block mb-0.5">طريقة الدفع</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {voucher.voucher_tender === 'checks'
                    ? 'شيكات'
                    : voucher.voucher_tender === 'visa'
                    ? 'فيزا / بطاقة'
                    : voucher.payment_method === 'checks'
                    ? 'شيكات'
                    : 'كاش (نقدي)'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/70 dark:border-white/10 dark:bg-slate-800/40">
                <span className="text-[10px] font-bold text-slate-400 block mb-0.5">تاريخ السند</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200" dir="ltr">
                  {voucher.date || String(voucher.created_at || '').slice(0, 10)}
                </span>
              </div>
              <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/70 dark:border-white/10 dark:bg-slate-800/40">
                <span className="text-[10px] font-bold text-slate-400 block mb-0.5">رقم السند المرجعي</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200" dir="ltr">
                  {voucher.reference_number
                    ? `#${voucher.reference_number}`
                    : voucher.voucher_number
                    ? `#${voucher.voucher_number}`
                    : `#${String(voucher.id).slice(0, 8).toUpperCase()}`}
                </span>
              </div>
            </div>

            {checks.length > 0 && (
              <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20 space-y-2">
                <span className="font-black text-amber-900 dark:text-amber-200 block">
                  تفاصيل الشيكات المسجلة بالسند ({checks.length}):
                </span>
                <div className="space-y-1.5">
                  {checks.map((chk, i) => (
                    <div
                      key={i}
                      className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-amber-100 dark:border-amber-900/30 flex items-center justify-between text-[11px]"
                    >
                      <div>
                        <span className="font-mono font-bold">شيك #{chk.check_number}</span>
                        <span className="text-slate-400 mx-1.5">·</span>
                        <span>{chk.bank_name || 'البنك'}</span>
                      </div>
                      <div className="text-left font-mono" dir="ltr">
                        <span className="font-black text-amber-800 dark:text-amber-300">
                          ₪{Number(chk.amount || 0).toFixed(2)}
                        </span>
                        <span className="text-[10px] text-slate-400 block">
                          استحقاق: {chk.check_date}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {voucher.description && (
              <div>
                <span className="text-[10px] font-bold text-slate-400 block mb-1">البيان والتفاصيل</span>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-white/10 text-slate-700 dark:text-slate-300 leading-relaxed font-sans whitespace-pre-wrap">
                  {voucher.description}
                </div>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-black transition-colors"
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
