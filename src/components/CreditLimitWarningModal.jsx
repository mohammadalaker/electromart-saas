function formatMoney(n) {
  return Number(n ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function CreditLimitWarningModal({ warning, onCancel, onProceed, loading }) {
  if (!warning) return null;

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credit-limit-warning-title"
      dir="rtl"
    >
      <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 shadow-2xl">
        <h2 id="credit-limit-warning-title" className="text-lg font-black text-amber-900">
          ⚠️ تحذير: الحد الائتماني
        </h2>
        <p className="mt-2 text-sm font-bold text-slate-700">
          هذا العميل سيتجاوز حده الائتماني المسموح
        </p>
        <ul className="mt-4 space-y-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-bold text-slate-800">
          <li className="flex justify-between gap-3">
            <span>الحد الائتماني:</span>
            <span dir="ltr">{formatMoney(warning.creditLimit)} شيكل</span>
          </li>
          <li className="flex justify-between gap-3">
            <span>الدين الحالي:</span>
            <span dir="ltr">{formatMoney(warning.currentBalance)} شيكل</span>
          </li>
          <li className="flex justify-between gap-3 text-amber-900">
            <span>بعد هذا البيع:</span>
            <span dir="ltr">{formatMoney(warning.afterSale)} شيكل</span>
          </li>
        </ul>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 rounded-xl border border-slate-200 bg-white py-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={onProceed}
            disabled={loading}
            className="flex-1 rounded-xl bg-amber-600 py-3 text-sm font-black text-white hover:bg-amber-700 disabled:opacity-50"
          >
            المتابعة على أي حال
          </button>
        </div>
      </div>
    </div>
  );
}
