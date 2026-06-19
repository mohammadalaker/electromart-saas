import { User, UserPlus, Star } from 'lucide-react';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';

const POS_TENDER_KEYS = ['cash', 'visa', 'digital_wallet', 'check'];
const POS_TENDER_AR = {
  cash: 'نقدي',
  visa: 'دفع إلكتروني',
  digital_wallet: 'محفظة رقمية',
  check: 'شيك',
};
const PICKUP_LOC_AR = { showroom: 'المعرض', warehouse: 'المخزن' };

/**
 * نموذج إتمام بيع نقطة البيع — يُعرض في صفحة/طبقة كاملة بدل الشريط الجانبي الضيق.
 */
export default function POSCheckoutFullForm({
  shellDark,
  orderCustomer,
  setOrderCustomer,
  directoryCustomers,
  onPickDirectoryCustomer,
  openNewCustomerModal,
  creditLimitWarningPreview,
  loyaltyDerived,
  loyaltyEarnDivisor,
  loyaltyRedeemRate,
  loyaltyPointsInput,
  setLoyaltyPointsInput,
  loyaltyMissingTable,
}) {
  return (
    <div className="space-y-4 max-w-xl mx-auto w-full">
      <div>
        <p
          className={`text-[10px] font-black mb-2 ${
            shellDark ? 'text-slate-400' : 'text-slate-500'
          }`}
        >
          طريقة الدفع
        </p>
        <div
          className={`flex rounded-xl border p-0.5 ${
            shellDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <button
            type="button"
            onClick={() => setOrderCustomer((p) => ({ ...p, salePaymentMode: 'cash' }))}
            className={`flex-1 rounded-lg py-2.5 text-xs font-black transition-colors ${
              orderCustomer.salePaymentMode === 'cash'
                ? shellDark
                  ? 'bg-white/15 text-indigo-200 shadow-sm'
                  : 'bg-white text-indigo-700 shadow-sm'
                : shellDark
                  ? 'text-slate-400'
                  : 'text-slate-500'
            }`}
          >
            كاش
          </button>
          <button
            type="button"
            onClick={() => setOrderCustomer((p) => ({ ...p, salePaymentMode: 'credit' }))}
            className={`flex-1 rounded-lg py-2.5 text-xs font-black transition-colors ${
              orderCustomer.salePaymentMode === 'credit'
                ? shellDark
                  ? 'bg-amber-500/20 text-amber-100 shadow-sm'
                  : 'bg-white text-amber-800 shadow-sm'
                : shellDark
                  ? 'text-slate-400'
                  : 'text-slate-500'
            }`}
          >
            ذمة
          </button>
        </div>
      </div>

      {orderCustomer.salePaymentMode === 'credit' && (
        <div
          className={`rounded-xl border p-4 space-y-2 ${
            shellDark ? 'border-amber-500/35 bg-amber-500/10' : 'border-amber-200 bg-amber-50/90'
          }`}
        >
          <label
            className={`flex items-center gap-1.5 text-[10px] font-black ${
              shellDark ? 'text-amber-100' : 'text-amber-900'
            }`}
          >
            <User size={12} className="shrink-0" />
            الزبون — من دليل المتجر (إلزامي)
          </label>
          <div className="flex items-stretch gap-2">
            <select
              value={orderCustomer.contactId || ''}
              onChange={(e) => onPickDirectoryCustomer(e.target.value)}
              className={`min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-sm font-bold ${
                shellDark
                  ? 'border-white/15 bg-white/10 text-white'
                  : 'border-amber-300/80 bg-white text-slate-900'
              } ${!orderCustomer.contactId ? 'ring-2 ring-amber-400/50' : ''}`}
            >
              <option value="">— اختر زبوناً مسجّلاً —</option>
              {directoryCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.phone || c.id}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={openNewCustomerModal}
              title="زبون جديد"
              className={`flex h-[42px] w-11 shrink-0 items-center justify-center rounded-xl border font-black transition-colors ${
                shellDark
                  ? 'border-white/20 bg-white/10 text-amber-100 hover:bg-white/15'
                  : 'border-amber-300/80 bg-white text-amber-800 hover:bg-amber-50'
              }`}
              aria-label="إضافة زبون جديد"
            >
              <UserPlus size={20} strokeWidth={2.25} />
            </button>
          </div>
          {directoryCustomers.length === 0 ? (
            <p
              className={`text-[10px] font-bold leading-relaxed ${
                shellDark ? 'text-amber-200/90' : 'text-amber-800'
              }`}
            >
              لا يوجد عملاء بعد — اضغط (+) لإضافة زبون، أو من شاشة العملاء والموردين.
            </p>
          ) : (
            <p
              className={`text-[10px] font-bold leading-relaxed ${
                shellDark ? 'text-amber-200/80' : 'text-amber-800/90'
              }`}
            >
              يُربط المبلغ بحساب الذمة (المستحق) لهذا الزبون في المتجر.
            </p>
          )}
          {creditLimitWarningPreview && (
            <p
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-black text-amber-800 dark:border-amber-500/50 dark:bg-amber-950/50 dark:text-amber-200"
              role="status"
            >
              تنبيه: هذا البيع سيتجاوز الحد الائتماني المسموح — سيُطلب تأكيد قبل الإتمام
            </p>
          )}
        </div>
      )}

      {orderCustomer.salePaymentMode === 'cash' && (
        <div
          className={`rounded-xl border p-4 space-y-2 ${
            shellDark ? 'border-indigo-500/30 bg-indigo-500/10' : 'border-indigo-200 bg-indigo-50/90'
          }`}
        >
          <label
            className={`flex items-center gap-1.5 text-[10px] font-black ${
              shellDark ? 'text-indigo-100' : 'text-indigo-900'
            }`}
          >
            <Star size={12} className="shrink-0" />
            ربط بالدليل (اختياري — نقاط الولاء)
          </label>
          <select
            value={orderCustomer.contactId || ''}
            onChange={(e) => onPickDirectoryCustomer(e.target.value)}
            className={`w-full rounded-xl border px-3 py-2.5 text-sm font-bold ${
              shellDark
                ? 'border-white/15 bg-white/10 text-white'
                : 'border-indigo-200 bg-white text-slate-900'
            }`}
          >
            <option value="">— بدون ربط —</option>
            {directoryCustomers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || c.phone || c.id}
              </option>
            ))}
          </select>
          <p
            className={`text-[10px] font-bold leading-relaxed ${
              shellDark ? 'text-indigo-200/85' : 'text-indigo-800/90'
            }`}
          >
            كاش بدون ربط = لا تُجمَّع نقاط. اختر زبوناً لتفعيل النقاط والاستبدال.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        <input
          type="text"
          placeholder="اسم العميل"
          value={orderCustomer.name}
          onChange={(e) => setOrderCustomer((p) => ({ ...p, name: e.target.value }))}
          className={`rounded-xl border px-3 py-2.5 text-sm font-bold ${
            shellDark
              ? 'border-white/10 bg-white/5 text-white placeholder:text-slate-500'
              : 'border-slate-200 text-slate-900'
          }`}
        />
        <input
          type="text"
          placeholder="الهاتف"
          value={orderCustomer.phone}
          onChange={(e) =>
            setOrderCustomer((p) => ({
              ...p,
              phone: normalizeDigitsToLatin(e.target.value),
            }))
          }
          className={`rounded-xl border px-3 py-2.5 text-sm font-bold font-currency ${
            shellDark
              ? 'border-white/10 bg-white/5 text-white placeholder:text-slate-500'
              : 'border-slate-200 text-slate-900'
          }`}
          dir="ltr"
          lang="en"
        />
        <input
          type="text"
          placeholder="ملاحظات (اختياري)"
          value={orderCustomer.notes}
          onChange={(e) => setOrderCustomer((p) => ({ ...p, notes: e.target.value }))}
          className={`rounded-xl border px-3 py-2.5 text-sm font-bold ${
            shellDark
              ? 'border-white/10 bg-white/5 text-white placeholder:text-slate-500'
              : 'border-slate-200 text-slate-900'
          }`}
        />
        <textarea
          placeholder="العنوان (توصيل / زيارة)"
          value={orderCustomer.address}
          onChange={(e) => setOrderCustomer((p) => ({ ...p, address: e.target.value }))}
          rows={3}
          className={`rounded-xl border px-3 py-2.5 text-sm font-bold resize-none ${
            shellDark
              ? 'border-white/10 bg-white/5 text-white placeholder:text-slate-500'
              : 'border-slate-200 text-slate-900'
          }`}
        />
        <div>
          <p
            className={`text-[10px] font-black mb-1.5 ${
              shellDark ? 'text-slate-400' : 'text-slate-500'
            }`}
          >
            أداة الدفع
          </p>
          <p
            className={`text-[10px] font-bold mb-2 leading-relaxed ${
              shellDark ? 'text-slate-500' : 'text-slate-500'
            }`}
          >
            نقدي، بطاقة/محطة، محفظة رقمية، أو شيك — للتسجيل والتقارير فقط (لا يمرّ الدفع عبر التطبيق).
          </p>
          <div
            className={`grid grid-cols-2 sm:grid-cols-4 rounded-xl border p-0.5 gap-0.5 ${
              shellDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'
            }`}
          >
            {POS_TENDER_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() =>
                  setOrderCustomer((p) => {
                    const next = {
                      ...p,
                      posTender: key,
                      ...(key !== 'digital_wallet' ? { walletLabel: '' } : {}),
                    };
                    if (key === 'check') {
                      const n = Math.max(
                        1,
                        Math.min(50, Number.parseInt(String(p.checkCount ?? 1), 10) || 1)
                      );
                      const dates = [...(p.checkDates?.length ? p.checkDates : [''])];
                      while (dates.length < n) dates.push('');
                      dates.length = n;
                      return { ...next, checkCount: n, checkDates: dates };
                    }
                    return next;
                  })
                }
                className={`rounded-lg py-2.5 px-1 text-[10px] sm:text-[11px] font-black transition-colors leading-tight ${
                  orderCustomer.posTender === key
                    ? shellDark
                      ? 'bg-white/15 text-indigo-200 shadow-sm'
                      : 'bg-white text-indigo-700 shadow-sm'
                    : shellDark
                      ? 'text-slate-400'
                      : 'text-slate-500'
                }`}
              >
                {POS_TENDER_AR[key]}
              </button>
            ))}
          </div>
        </div>

        {orderCustomer.posTender === 'check' && (
          <div
            className={`rounded-xl border p-4 space-y-2 ${
              shellDark ? 'border-amber-500/35 bg-amber-950/20' : 'border-amber-200 bg-amber-50/90'
            }`}
          >
            <label
              className={`block text-[10px] font-black ${
                shellDark ? 'text-amber-100' : 'text-amber-900'
              }`}
            >
              عدد الشيكات
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={orderCustomer.checkCount}
              onChange={(e) => {
                const n = Math.max(1, Math.min(50, Number.parseInt(e.target.value, 10) || 1));
                setOrderCustomer((p) => {
                  const dates = [...(p.checkDates || [])];
                  while (dates.length < n) dates.push('');
                  dates.length = n;
                  return { ...p, checkCount: n, checkDates: dates };
                });
              }}
              className={`w-full rounded-xl border px-3 py-2 text-sm font-black font-currency ${
                shellDark
                  ? 'border-white/15 bg-white/10 text-white'
                  : 'border-amber-300/80 bg-white text-slate-900'
              }`}
              dir="ltr"
              lang="en"
            />
            <p
              className={`text-[10px] font-bold ${shellDark ? 'text-amber-200/90' : 'text-amber-800'}`}
            >
              تواريخ الشيكات (استحقاق كل شيك)
            </p>
            <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-0.5">
              {Array.from({
                length: Math.max(
                  1,
                  Math.min(50, Number.parseInt(String(orderCustomer.checkCount ?? 1), 10) || 1)
                ),
              }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span
                    className={`shrink-0 text-[10px] font-black w-14 ${
                      shellDark ? 'text-amber-200' : 'text-amber-900'
                    }`}
                  >
                    شيك {i + 1}
                  </span>
                  <input
                    type="date"
                    value={orderCustomer.checkDates[i] || ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setOrderCustomer((p) => {
                        const dates = [...(p.checkDates || [])];
                        dates[i] = v;
                        return { ...p, checkDates: dates };
                      });
                    }}
                    className={`min-w-0 flex-1 rounded-xl border px-2 py-1.5 text-xs font-bold font-currency ${
                      shellDark
                        ? 'border-white/15 bg-white/10 text-white [color-scheme:dark]'
                        : 'border-amber-200 bg-white text-slate-900'
                    }`}
                    dir="ltr"
                    lang="en"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {orderCustomer.posTender === 'digital_wallet' && (
          <div
            className={`rounded-xl border p-4 space-y-2 ${
              shellDark ? 'border-teal-500/35 bg-teal-950/25' : 'border-teal-200 bg-teal-50/90'
            }`}
          >
            <label
              className={`block text-[10px] font-black ${
                shellDark ? 'text-teal-100' : 'text-teal-900'
              }`}
            >
              المحفظة أو المرجع (اختياري)
            </label>
            <input
              type="text"
              placeholder="مثال: Bit، PayBox، Apple Pay…"
              value={orderCustomer.walletLabel || ''}
              onChange={(e) =>
                setOrderCustomer((p) => ({ ...p, walletLabel: e.target.value.slice(0, 80) }))
              }
              className={`w-full rounded-xl border px-3 py-2 text-sm font-bold ${
                shellDark
                  ? 'border-white/15 bg-white/10 text-white placeholder:text-slate-500'
                  : 'border-teal-200 bg-white text-slate-900'
              }`}
            />
          </div>
        )}

        {orderCustomer.posTender === 'visa' && (
          <div
            className={`rounded-xl border p-4 space-y-2 ${
              shellDark ? 'border-indigo-500/35 bg-indigo-950/30' : 'border-indigo-200 bg-indigo-50/90'
            }`}
          >
            <label
              className={`block text-[10px] font-black ${
                shellDark ? 'text-indigo-100' : 'text-indigo-900'
              }`}
            >
              بطاقة بنكية / دفع إلكتروني — آخر 4 أرقام
            </label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="••••"
              value={orderCustomer.visaLast4}
              onChange={(e) =>
                setOrderCustomer((p) => ({
                  ...p,
                  visaLast4: normalizeDigitsToLatin(e.target.value).replace(/\D/g, '').slice(0, 4),
                }))
              }
              className={`w-full rounded-xl border px-3 py-2 text-center text-lg font-black font-currency tracking-[0.35em] ${
                shellDark
                  ? 'border-white/15 bg-white/10 text-white placeholder:text-slate-500'
                  : 'border-indigo-200 bg-white text-slate-900'
              }`}
              dir="ltr"
              lang="en"
            />
          </div>
        )}

        <div>
          <label
            className={`block text-[10px] font-black mb-1 ${
              shellDark ? 'text-slate-400' : 'text-slate-500'
            }`}
          >
            تاريخ الاستلام المتوقع
          </label>
          <input
            type="date"
            value={orderCustomer.pickupDate}
            onChange={(e) => setOrderCustomer((p) => ({ ...p, pickupDate: e.target.value }))}
            className={`w-full rounded-xl border px-3 py-2.5 text-sm font-bold font-currency ${
              shellDark
                ? 'border-white/10 bg-white/5 text-white [color-scheme:dark]'
                : 'border-slate-200 text-slate-900'
            }`}
            dir="ltr"
            lang="en"
          />
        </div>
        <div>
          <p
            className={`text-[10px] font-black mb-1.5 ${
              shellDark ? 'text-slate-400' : 'text-slate-500'
            }`}
          >
            الاستلام من
          </p>
          <div
            className={`flex rounded-xl border p-0.5 gap-0.5 ${
              shellDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'
            }`}
          >
            <button
              type="button"
              onClick={() =>
                setOrderCustomer((p) => ({
                  ...p,
                  pickupLocation: p.pickupLocation === 'showroom' ? '' : 'showroom',
                }))
              }
              className={`flex-1 rounded-lg py-2.5 text-[11px] font-black transition-colors ${
                orderCustomer.pickupLocation === 'showroom'
                  ? shellDark
                    ? 'bg-white/15 text-indigo-200 shadow-sm'
                    : 'bg-white text-indigo-700 shadow-sm'
                  : shellDark
                    ? 'text-slate-400'
                    : 'text-slate-500'
              }`}
            >
              {PICKUP_LOC_AR.showroom}
            </button>
            <button
              type="button"
              onClick={() =>
                setOrderCustomer((p) => ({
                  ...p,
                  pickupLocation: p.pickupLocation === 'warehouse' ? '' : 'warehouse',
                }))
              }
              className={`flex-1 rounded-lg py-2.5 text-[11px] font-black transition-colors ${
                orderCustomer.pickupLocation === 'warehouse'
                  ? shellDark
                    ? 'bg-white/15 text-indigo-200 shadow-sm'
                    : 'bg-white text-indigo-700 shadow-sm'
                  : shellDark
                    ? 'text-slate-400'
                    : 'text-slate-500'
              }`}
            >
              {PICKUP_LOC_AR.warehouse}
            </button>
          </div>
        </div>
      </div>

      {orderCustomer.contactId && (
        <div
          className={`rounded-xl border p-4 space-y-2 ${
            shellDark ? 'border-violet-500/35 bg-violet-950/30' : 'border-violet-200 bg-violet-50/95'
          }`}
        >
          <p
            className={`text-[10px] font-black flex items-center gap-1 ${
              shellDark ? 'text-violet-200' : 'text-violet-900'
            }`}
          >
            <Star size={12} className="shrink-0" />
            نقاط الولاء
          </p>
          <p
            className={`text-[11px] font-bold leading-relaxed ${
              shellDark ? 'text-violet-200/90' : 'text-violet-900/90'
            }`}
          >
            رصيد الزبون:{' '}
            <span className="font-currency" dir="ltr">
              {loyaltyDerived.balance.toFixed(0)}
            </span>{' '}
            نقطة — كل {loyaltyEarnDivisor} ₪ مشتريات تمنح نقطة؛ استبدال: نقطة = {loyaltyRedeemRate} ₪ خصم.
          </p>
          {loyaltyMissingTable && (
            <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300">
              نفّذ <code className="px-1 rounded bg-white/10">supabase/loyalty_points.sql</code> لتفعيل التخزين.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label
                className={`block text-[10px] font-black mb-1 ${
                  shellDark ? 'text-violet-300' : 'text-violet-800'
                }`}
              >
                استبدال نقاط (خصم على الفاتورة)
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={loyaltyPointsInput}
                onChange={(e) => setLoyaltyPointsInput(e.target.value.replace(/[^\d.,]/g, ''))}
                placeholder="0"
                className={`w-full rounded-lg border px-2.5 py-2 text-sm font-black font-currency ${
                  shellDark
                    ? 'border-white/15 bg-white/10 text-white'
                    : 'border-violet-200 bg-white text-slate-900'
                }`}
                dir="ltr"
                lang="en"
              />
            </div>
            <button
              type="button"
              onClick={() =>
                setLoyaltyPointsInput(String(Math.max(0, loyaltyDerived.maxRedeemPoints)))
              }
              className={`shrink-0 rounded-lg border px-3 py-2 text-[11px] font-black ${
                shellDark
                  ? 'border-violet-400/40 bg-violet-500/20 text-violet-100'
                  : 'border-violet-300 bg-white text-violet-800'
              }`}
            >
              أقصى مسموح
            </button>
          </div>
          {loyaltyDerived.effectivePoints > 0 && (
            <p
              className={`text-[10px] font-bold font-currency ${
                shellDark ? 'text-emerald-300' : 'text-emerald-800'
              }`}
              dir="ltr"
            >
              خصم بالنقاط: ₪{loyaltyDerived.discountShekel.toFixed(2)} — يُستبدل {loyaltyDerived.effectivePoints}{' '}
              نقطة
            </p>
          )}
          {loyaltyDerived.earnPointsPreview >= 0 && (
            <p className={`text-[10px] font-bold ${shellDark ? 'text-slate-400' : 'text-slate-600'}`}>
              بعد الدفع يُضاف تقديرياً {loyaltyDerived.earnPointsPreview} نقطة على هذا المبلغ.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
