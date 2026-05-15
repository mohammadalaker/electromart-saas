/**
 * فاتورة مشتريات للطباعة — هوية شركة سنين، تخطيط A4، جدول أسطر من line_items.
 */
export default function PrintPurchaseInvoice({ data }) {
  if (!data) return null;

  const {
    brandName = 'شركة سنين',
    brandNameEn = 'Senin Company',
    storeName,
    supplierCompanyName,
    supplierPhone,
    invoiceNumber,
    invoiceDate,
    paymentMode,
    paymentDueDate,
    lines = [],
    totalAmount,
    landedCostExtra,
    notes,
    printedAtLabel,
  } = data;

  const isCredit = paymentMode === 'credit';

  return (
    <div
      className="print-invoice-root max-w-[210mm] mx-auto bg-white text-slate-900 px-6 py-8 sm:px-10"
      dir="rtl"
    >
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/90 shadow-sm mb-8">
        <div className="h-1.5 bg-gradient-to-l from-emerald-700 via-teal-600 to-cyan-700" />
        <header className="px-6 pt-6 pb-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-slate-100">
          <div>
            <p className="text-[10px] font-black tracking-[0.25em] text-emerald-800/80 uppercase mb-1">
              {brandNameEn}
            </p>
            <h1 className="font-title text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
              {brandName}
            </h1>
            <p className="mt-1 text-sm font-bold text-slate-600">فاتورة مشتريات — وثيقة رسمية</p>
            {storeName ? (
              <p className="mt-2 text-xs font-bold text-slate-500">المتجر: {storeName}</p>
            ) : null}
          </div>
          <div className="text-left rounded-xl bg-slate-50 border border-slate-200/80 px-4 py-3 min-w-[160px]">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">تاريخ الطباعة</p>
            <p className="text-sm font-bold font-currency text-slate-700" dir="ltr" lang="en">
              {printedAtLabel}
            </p>
          </div>
        </header>
      </div>

      <section className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-5">
          <h2 className="font-title text-xs font-black text-emerald-900 mb-3 flex items-center gap-2">
            <span className="w-8 h-0.5 bg-emerald-600 rounded-full" />
            بيانات المورد
          </h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-[10px] font-bold text-slate-500">اسم الشركة / المورد</dt>
              <dd className="font-black text-slate-900">{supplierCompanyName || '—'}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold text-slate-500">الهاتف</dt>
              <dd className="font-bold font-currency text-slate-800" dir="ltr" lang="en">
                {supplierPhone || '—'}
              </dd>
            </div>
          </dl>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
          <h2 className="font-title text-xs font-black text-slate-700 mb-3">بيانات الفاتورة</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-[10px] font-bold text-slate-500">رقم فاتورة المورد</dt>
              <dd className="font-black font-currency text-slate-900" dir="ltr" lang="en">
                {invoiceNumber || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold text-slate-500">تاريخ الفاتورة</dt>
              <dd className="font-bold font-currency text-slate-900" dir="ltr" lang="en">
                {invoiceDate || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold text-slate-500">طريقة الدفع</dt>
              <dd className="font-black text-slate-900">{isCredit ? 'آجل (ذمة)' : 'كاش'}</dd>
            </div>
            {isCredit && paymentDueDate ? (
              <div>
                <dt className="text-[10px] font-bold text-slate-500">استحقاق السداد</dt>
                <dd className="font-bold font-currency text-amber-900" dir="ltr" lang="en">
                  {paymentDueDate}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="font-title text-sm font-black text-slate-800 mb-3">تفاصيل الأصناف</h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full text-xs sm:text-sm border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white text-right">
                <th className="p-2.5 font-black w-8">#</th>
                <th className="p-2.5 font-black min-w-[100px]">الباركود</th>
                <th className="p-2.5 font-black min-w-[90px]">المرجع</th>
                <th className="p-2.5 font-black w-14 text-center" dir="ltr">
                  الكمية
                </th>
                <th className="p-2.5 font-black w-20" dir="ltr">
                  سعر الوحدة
                </th>
                <th className="p-2.5 font-black w-12 text-center" dir="ltr">
                  خصم %
                </th>
                <th className="p-2.5 font-black w-24" dir="ltr">
                  المجموع
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const lt = Number(line.line_total ?? 0);
                const up = Number(line.unit_price ?? 0);
                const dp = Number(line.discount_percent ?? 0);
                const q = Number(line.qty ?? 0);
                return (
                  <tr key={idx} className="border-b border-slate-100 odd:bg-white even:bg-slate-50/60">
                    <td className="p-2 text-center font-bold text-slate-500">{idx + 1}</td>
                    <td className="p-2 font-currency text-slate-800" dir="ltr" lang="en">
                      {line.barcode || '—'}
                    </td>
                    <td className="p-2 font-currency text-slate-700" dir="ltr" lang="en">
                      {line.reference || '—'}
                    </td>
                    <td className="p-2 text-center font-black font-currency" dir="ltr" lang="en">
                      {q}
                    </td>
                    <td className="p-2 font-currency font-semibold" dir="ltr" lang="en">
                      ₪{up.toFixed(2)}
                    </td>
                    <td className="p-2 text-center font-currency" dir="ltr" lang="en">
                      {dp}%
                    </td>
                    <td className="p-2 font-currency font-black text-slate-900" dir="ltr" lang="en">
                      ₪{lt.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mt-6 space-y-3 border-t-2 border-slate-200 pt-6">
        {landedCostExtra != null && Number(landedCostExtra) > 0 ? (
          <div className="flex justify-between text-sm font-bold text-slate-600">
            <span>مصاريف واصلة / إضافية</span>
            <span className="font-currency" dir="ltr" lang="en">
              ₪{Number(landedCostExtra).toFixed(2)}
            </span>
          </div>
        ) : null}
        <div className="flex justify-between items-center rounded-2xl bg-gradient-to-l from-emerald-900 to-teal-800 text-white px-6 py-5 shadow-lg">
          <span className="font-title text-lg font-black">إجمالي فاتورة المشتريات</span>
          <span className="font-title text-2xl font-black font-currency tracking-tight" dir="ltr" lang="en">
            ₪{Number(totalAmount ?? 0).toFixed(2)}
          </span>
        </div>
        {notes ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
            <span className="font-black text-slate-600">ملاحظات: </span>
            {notes}
          </div>
        ) : null}
        <div className="flex flex-wrap justify-between gap-4 pt-4 border-t border-slate-100 text-[10px] text-slate-400">
          <span>وثيقة صادرة من نظام إدارة المخزون — {brandName}</span>
          <span dir="ltr" lang="en">
            {brandNameEn}
          </span>
        </div>
      </footer>
    </div>
  );
}
