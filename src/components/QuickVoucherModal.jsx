import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Loader2,
  X,
  Wallet,
  Receipt,
  CreditCard,
  Plus,
  Trash2,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Truck,
  Users,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useToast } from '../context/ToastContext';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';
import {
  applySupplierOutstandingFromVoucher,
  applyCustomerOutstandingFromVoucher,
} from '../utils/supplierVoucherBalance';

const VOUCHERS_TABLE = import.meta.env.VITE_SUPABASE_VOUCHERS_TABLE?.trim() || 'vouchers';

const TENDER_OPTIONS = [
  { value: 'cash', label: 'كاش (نقدي)' },
  { value: 'checks', label: 'شيكات' },
  { value: 'visa', label: 'فيزا / بطاقة' },
];

export default function QuickVoucherModal({
  isOpen,
  onClose,
  type = 'payment', // 'payment' (صرف) or 'receipt' (قبض)
  contact,
  initialAmount = 0,
  store,
  onSuccess,
}) {
  const toast = useToast();

  const isPayment = type === 'payment';
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [tenderType, setTenderType] = useState('cash');
  const [visaLast4, setVisaLast4] = useState('');
  const [checkLines, setCheckLines] = useState([
    {
      check_number: '',
      check_date: new Date().toISOString().slice(0, 10),
      amount: '',
      bank_name: '',
    },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // تحديث القيم عند فتح المودال
  useEffect(() => {
    if (isOpen) {
      setError(null);
      const rawAmt = Math.max(0, Number(initialAmount) || 0);
      setAmount(rawAmt > 0 ? String(rawAmt.toFixed(2)) : '');
      setDate(new Date().toISOString().slice(0, 10));
      setDescription(
        isPayment
          ? `دفعة مسددة للمورد عن رصيد الحساب`
          : `دفعة مقبوضة من الزبون عن رصيد الحساب`
      );
      setTenderType('cash');
      setVisaLast4('');
      setCheckLines([
        {
          check_number: '',
          check_date: new Date().toISOString().slice(0, 10),
          amount: rawAmt > 0 ? String(rawAmt.toFixed(2)) : '',
          bank_name: '',
        },
      ]);
    }
  }, [isOpen, initialAmount, isPayment]);

  if (!isOpen) return null;

  const handleAddCheckLine = () => {
    setCheckLines((prev) => [
      ...prev,
      {
        check_number: '',
        check_date: new Date().toISOString().slice(0, 10),
        amount: '',
        bank_name: '',
      },
    ]);
  };

  const handleUpdateCheckLine = (index, field, value) => {
    setCheckLines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleRemoveCheckLine = (index) => {
    setCheckLines((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!store?.id || !contact?.id) {
      setError('بيانات المتجر أو الطرف غير متوفرة');
      return;
    }

    const cleanAmt = parseFloat(normalizeDigitsToLatin(String(amount).replace(',', '.')));
    if (!cleanAmt || cleanAmt <= 0) {
      setError('يرجى إدخال مبلغ صحيح أكبر من صفر');
      return;
    }

    const roundedAmt = Math.round(cleanAmt * 100) / 100;
    setSubmitting(true);
    setError(null);

    try {
      const cleanDesc = description.trim() || (isPayment ? 'سند صرف للمورد' : 'سند قبض من الزبون');
      const dateStr = String(date || new Date().toISOString().slice(0, 10)).slice(0, 10);

      // تنظيف أسطر الشيكات إن وُجدت
      const sanitizedChecks = checkLines
        .map((c) => ({
          check_number: String(c.check_number || '').trim(),
          check_date: String(c.check_date || '').slice(0, 10),
          amount: parseFloat(normalizeDigitsToLatin(String(c.amount || '0').replace(',', '.'))) || 0,
          bank_name: String(c.bank_name || '').trim(),
        }))
        .filter((c) => c.amount > 0);

      let tenderNotes = '';
      if (tenderType === 'checks' && sanitizedChecks.length > 0) {
        tenderNotes =
          '\n[تفاصيل الشيكات]\n' +
          sanitizedChecks
            .map(
              (c, i) =>
                `شيك ${i + 1}: رقم ${c.check_number} — استحقاق ${c.check_date} — ₪${c.amount.toFixed(2)} — ${c.bank_name}`
            )
            .join('\n');
      } else if (tenderType === 'visa' && visaLast4) {
        tenderNotes = `\n[فيزا: ****${visaLast4.trim().slice(-4)}]`;
      }

      const fullDescription = `${cleanDesc}${tenderNotes}`.trim();

      // محاولة الإدراج مع كامل أعمدة الدفع الحديثة
      const fullPayload = {
        store_id: store.id,
        account_id: contact.id,
        voucher_type: isPayment ? 'payment' : 'receipt',
        amount: roundedAmt,
        date: dateStr,
        description: fullDescription,
        payment_method: tenderType,
        voucher_tender: tenderType,
        cash_amount: tenderType === 'cash' ? roundedAmt : 0,
        check_lines: tenderType === 'checks' ? sanitizedChecks : [],
        visa_last4: tenderType === 'visa' && visaLast4 ? visaLast4.trim().slice(-4) : null,
        currency_code: 'ILS',
      };

      let insertedId = null;
      const { data: resData, error: insErr } = await supabase
        .from(VOUCHERS_TABLE)
        .insert([fullPayload])
        .select('id')
        .maybeSingle();

      if (insErr) {
        console.warn('[QuickVoucherModal] محاولة الإدراج الموسعة فشلت — الرجوع للأعمدة الأساسية:', insErr);
        // تراجع للأعمدة الأساسية المؤكد وجودها
        const basicPayload = {
          store_id: store.id,
          account_id: contact.id,
          voucher_type: isPayment ? 'payment' : 'receipt',
          amount: roundedAmt,
          date: dateStr,
          description: fullDescription,
        };
        const { data: fallbackData, error: fbErr } = await supabase
          .from(VOUCHERS_TABLE)
          .insert([basicPayload])
          .select('id')
          .maybeSingle();

        if (fbErr) throw fbErr;
        insertedId = fallbackData?.id;
      } else {
        insertedId = resData?.id;
      }

      // تحديث رصيد الذمة في store_contacts و customer_ledger
      if (isPayment) {
        await applySupplierOutstandingFromVoucher({
          storeId: store.id,
          supplierContactId: contact.id,
          voucherType: 'payment',
          amount: roundedAmt,
        });
      } else {
        await applyCustomerOutstandingFromVoucher({
          storeId: store.id,
          customerContactId: contact.id,
          voucherType: 'receipt',
          amount: roundedAmt,
          voucherId: insertedId,
        });
      }

      toast.success(
        isPayment
          ? `تم تسجيل سند الصرف بقيمة ₪${roundedAmt.toFixed(2)} بنجاح، وتحديث رصيد المورد`
          : `تم تسجيل سند القبض بقيمة ₪${roundedAmt.toFixed(2)} بنجاح، وتحديث رصيد الزبون`
      );

      if (onSuccess) {
        await onSuccess();
      }
      onClose();
    } catch (err) {
      console.error('[QuickVoucherModal] خطأ حفظ السند:', err);
      setError(err.message || 'فشل حفظ السند. يرجى المحاولة مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[10010] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
      onClick={onClose}
      role="presentation"
      dir="rtl"
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-white/10 p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* رأس المودال */}
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
                {isPayment ? 'تسجيل سند صرف (دفعة للمورد)' : 'تسجيل سند قبض (دفعة من الزبون)'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isPayment
                  ? 'يُنقص ذمة المورد المستحقة ويوثق الدفع في كشف الحساب'
                  : 'يُنقص مديونية الزبون ويوثق الاستلام في كشف الحساب'}
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

        {/* بطاقة معلومات الطرف المحددة مسبقاً */}
        <div
          className={`p-3.5 rounded-xl border mb-4 flex items-center justify-between gap-3 ${
            isPayment
              ? 'bg-rose-50/70 border-rose-200/80 dark:bg-rose-950/30 dark:border-rose-900/40'
              : 'bg-emerald-50/70 border-emerald-200/80 dark:bg-emerald-950/30 dark:border-emerald-900/40'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {isPayment ? (
              <Truck className="text-rose-600 dark:text-rose-400 shrink-0" size={18} />
            ) : (
              <Users className="text-emerald-600 dark:text-emerald-400 shrink-0" size={18} />
            )}
            <div className="min-w-0">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">
                {isPayment ? 'المورد المستفيد' : 'الزبون المسدد'}
              </span>
              <span className="text-xs font-black text-slate-900 dark:text-white truncate block">
                {contact?.name || '—'}{' '}
                {contact?.phone ? (
                  <span className="font-mono text-slate-500 font-bold" dir="ltr">
                    ({contact.phone})
                  </span>
                ) : null}
              </span>
            </div>
          </div>
          <div className="text-left shrink-0">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">
              الرصيد المستحق حالياً
            </span>
            <span
              className={`text-sm font-black font-currency ${
                isPayment
                  ? 'text-rose-700 dark:text-rose-300'
                  : 'text-emerald-700 dark:text-emerald-300'
              }`}
              dir="ltr"
            >
              ₪{Number(initialAmount || contact?.outstanding_amount || 0).toFixed(2)}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* المبلغ وطريقة الدفع */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-black text-slate-700 dark:text-slate-300 mb-1">
                المبلغ المدفوع (₪) *
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
                className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 font-mono text-sm font-black text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                dir="ltr"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                يمكنك تعديل المبلغ إذا كان السداد جزئياً.
              </span>
            </div>

            <div>
              <label className="block font-black text-slate-700 dark:text-slate-300 mb-1">
                طريقة الدفع *
              </label>
              <select
                value={tenderType}
                onChange={(e) => setTenderType(e.target.value)}
                className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 font-bold text-slate-800 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
              >
                {TENDER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* التاريخ */}
          <div>
            <label className="block font-black text-slate-700 dark:text-slate-300 mb-1">
              تاريخ السند *
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 font-mono font-bold text-slate-800 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* تفاصيل الشيكات إذا تم اختيار شيكات */}
          {tenderType === 'checks' && (
            <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/50 dark:border-amber-800/40 dark:bg-amber-950/20 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-black text-amber-950 dark:text-amber-200 text-xs">
                  تفاصيل الشيكات ({checkLines.length})
                </span>
                <button
                  type="button"
                  onClick={handleAddCheckLine}
                  className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-amber-200/80 hover:bg-amber-300 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100 flex items-center gap-1"
                >
                  <Plus size={13} /> إضافة شيك
                </button>
              </div>

              {checkLines.map((line, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-amber-100 dark:border-amber-900/30 items-end"
                >
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">رقم الشيك</label>
                    <input
                      type="text"
                      value={line.check_number}
                      onChange={(e) => handleUpdateCheckLine(idx, 'check_number', e.target.value)}
                      placeholder="مثال: 1042"
                      className="w-full h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">تاريخ الاستحقاق</label>
                    <input
                      type="date"
                      value={line.check_date}
                      onChange={(e) => handleUpdateCheckLine(idx, 'check_date', e.target.value)}
                      className="w-full h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">المبلغ (₪)</label>
                    <input
                      type="number"
                      step="any"
                      value={line.amount}
                      onChange={(e) => handleUpdateCheckLine(idx, 'amount', e.target.value)}
                      placeholder="0.00"
                      className="w-full h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono font-bold"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="flex-1">
                      <label className="text-[10px] text-slate-500 block mb-0.5">اسم البنك</label>
                      <input
                        type="text"
                        value={line.bank_name}
                        onChange={(e) => handleUpdateCheckLine(idx, 'bank_name', e.target.value)}
                        placeholder="بنك فلسطين..."
                        className="w-full h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold"
                      />
                    </div>
                    {checkLines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveCheckLine(idx)}
                        className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg mt-3"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* فيزا */}
          {tenderType === 'visa' && (
            <div>
              <label className="block font-black text-slate-700 dark:text-slate-300 mb-1">
                آخر 4 أرقام من البطاقة (اختياري)
              </label>
              <input
                type="text"
                maxLength={4}
                value={visaLast4}
                onChange={(e) => setVisaLast4(e.target.value)}
                placeholder="4242"
                className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 font-mono text-sm focus:border-indigo-500 focus:outline-none"
                dir="ltr"
              />
            </div>
          )}

          {/* البيان والملاحظات */}
          <div>
            <label className="block font-black text-slate-700 dark:text-slate-300 mb-1">
              البيان / تفاصيل الملاحظات
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="مثال: دفعة عن فاتورة توريد / سداد الحساب"
              className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-800 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold dark:bg-rose-950/30 dark:border-rose-900/50 dark:text-rose-200 flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 dark:border-white/10 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold transition-colors"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`px-5 py-2.5 rounded-xl text-white font-black shadow-md flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 ${
                isPayment
                  ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
                  : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
              }`}
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>جاري تسجيل السند...</span>
                </>
              ) : (
                <>
                  {isPayment ? <Wallet size={16} /> : <Receipt size={16} />}
                  <span>{isPayment ? 'حفظ سند الصرف وتحديث الذمة' : 'حفظ سند القبض وتحديث الرصيد'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null;
}
