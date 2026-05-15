import { BRAND_NAME } from '../constants/brand.js';

/**
 * طباعة كشف حساب مورد — تخطيط A4، يتماشى مع هوية Swiftm (فواتير المشتريات والواجهة).
 */
export default function PrintSupplierStatement({ data }) {
  if (!data) return null;

  const {
    brandName = 'شركة سنين',
    brandNameEn = 'Senin Company',
    storeName,
    supplierName,
    supplierPhone,
    rows = [],
    closingBalance,
    printedAtLabel,
  } = data;

  const movementCount = rows.length;
  const totalDebit = rows.reduce((s, r) => s + (r.debit != null ? Number(r.debit) : 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (r.credit != null ? Number(r.credit) : 0), 0);

  return (
    <div
      className="print-invoice-root print-supplier-statement max-w-[210mm] mx-auto bg-white text-slate-900 px-5 py-7 sm:px-9"
      dir="rtl"
    >
      {/* رأس الوثيقة */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/90 shadow-sm mb-7 print:shadow-none print:border-slate-300">
        <div className="h-2 bg-gradient-to-l from-indigo-600 via-teal-600 to-emerald-600 print:h-1.5" />
        <header className="px-6 pt-6 pb-5 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5 border-b border-slate-100/90">
          <div className="space-y-1">
            <p className="text-[10px] font-black tracking-[0.22em] text-teal-800/85 uppercase">{brandNameEn}</p>
            <h1 className="font-title text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">{brandName}</h1>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <span className="inline-flex items-center rounded-full bg-indigo-50 border border-indigo-200/80 px-3 py-1 text-[11px] font-black text-indigo-900">
                كشف حساب مورد
              </span>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold text-slate-600">
                {BRAND_NAME} · وثيقة محاسبية
              </span>
            </div>
            {storeName ? (
              <p className="mt-2 text-xs font-bold text-slate-500">
                <span className="text-slate-400">المتجر:</span> {storeName}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 lg:min-w-[200px]">
            <div className="rounded-2xl bg-gradient-to-br from-slate-50 to-indigo-50/40 border border-slate-200/90 px-4 py-3">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">تاريخ الطباعة</p>
              <p className="text-sm font-bold font-currency text-slate-800" dir="ltr" lang="en">
                {printedAtLabel}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-emerald-50/80 border border-emerald-100 px-2 py-2">
                <p className="text-[9px] font-bold text-emerald-700/80">حركات</p>
                <p className="text-lg font-black font-currency text-emerald-900" dir="ltr" lang="en">
                  {movementCount}
                </p>
              </div>
              <div className="rounded-xl bg-violet-50/80 border border-violet-100 px-2 py-2">
                <p className="text-[9px] font-bold text-violet-700/80">العملة</p>
                <p className="text-sm font-black text-violet-950" dir="ltr" lang="en">
                  ₪ ILS
                </p>
              </div>
            </div>
          </div>
        </header>
      </div>

      {/* بطاقة المورد */}
      <section className="mb-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-3xl border border-teal-100 bg-gradient-to-br from-teal-50/90 via-emerald-50/40 to-white p-6 shadow-sm print:border-teal-200">
          <div className="flex items-center gap-2 mb-4">
            <span className="h-8 w-1 rounded-full bg-gradient-to-b from-teal-500 to-emerald-600" />
            <h2 className="font-title text-sm font-black text-teal-950">بيانات المورد</h2>
          </div>
          <p className="font-title text-xl font-black text-slate-900 leading-snug">{supplierName || '—'}</p>
          {supplierPhone ? (
            <p className="mt-2 text-sm font-bold font-currency text-slate-700" dir="ltr" lang="en">
              {supplierPhone}
            </p>
          ) : (
            <p className="mt-2 text-xs font-bold text-slate-400">لا يوجد هاتف مسجّل</p>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5 flex flex-col justify-center">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-wide mb-2">ملخص الحركات</p>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="font-bold text-slate-600">إجمالي مدين</dt>
              <dd className="font-currency font-black text-emerald-800" dir="ltr" lang="en">
                ₪{totalDebit.toFixed(2)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-bold text-slate-600">إجمالي دائن</dt>
              <dd className="font-currency font-black text-rose-700" dir="ltr" lang="en">
                ₪{totalCredit.toFixed(2)}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* جدول الحركات */}
      <section className="mb-6">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="font-title text-sm font-black text-slate-800">تفصيل الحركات</h2>
          <span className="text-[10px] font-bold text-slate-400">مرتّبة زمنياً</span>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200/95 shadow-sm print:shadow-none">
          <table className="w-full text-[10px] sm:text-[11px] border-collapse">
            <thead>
              <tr className="bg-gradient-to-l from-slate-900 via-slate-800 to-indigo-950 text-white text-right print:from-slate-900 print:to-slate-900">
                <th className="p-2.5 font-black w-9 text-center">#</th>
                <th className="p-2.5 font-black w-[72px]">التاريخ</th>
                <th className="p-2.5 font-black min-w-[120px]">البيان</th>
                <th className="p-2.5 font-black w-[72px]">المرجع</th>
                <th className="p-2.5 font-black w-[68px] text-center">مدين</th>
                <th className="p-2.5 font-black w-[68px] text-center">دائن</th>
                <th className="p-2.5 font-black w-[78px] text-center">رصيد ذمة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={i}
                  className="border-b border-slate-100 odd:bg-white even:bg-slate-50/60 print:break-inside-avoid"
                >
                  <td className="p-2 text-center font-currency font-bold text-slate-400" dir="ltr" lang="en">
                    {i + 1}
                  </td>
                  <td className="p-2 font-currency text-slate-700" dir="ltr" lang="en">
                    {r.dateLabel}
                  </td>
                  <td className="p-2 font-bold text-slate-800 leading-snug">{r.description}</td>
                  <td className="p-2 font-currency text-slate-600" dir="ltr" lang="en">
                    {r.ref || '—'}
                  </td>
                  <td className="p-2 font-currency text-center text-emerald-800 font-bold" dir="ltr" lang="en">
                    {r.debit != null ? `₪${Number(r.debit).toFixed(2)}` : '—'}
                  </td>
                  <td className="p-2 font-currency text-center text-rose-700 font-bold" dir="ltr" lang="en">
                    {r.credit != null ? `₪${Number(r.credit).toFixed(2)}` : '—'}
                  </td>
                  <td className="p-2 font-currency text-center font-black text-slate-900" dir="ltr" lang="en">
                    ₪{Number(r.balance ?? 0).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* الرصيد الختامي */}
      <div className="relative overflow-hidden rounded-3xl border-2 border-emerald-200/90 bg-gradient-to-br from-emerald-50 via-teal-50/50 to-white px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:border-emerald-300">
        <div className="absolute inset-0 bg-gradient-to-l from-emerald-500/5 to-transparent pointer-events-none print:hidden" />
        <span className="font-title relative text-lg font-black text-emerald-950">رصيد الذمة الختامي (آجل)</span>
        <span
          className="font-title relative text-2xl sm:text-3xl font-black font-currency text-emerald-900 tracking-tight"
          dir="ltr"
          lang="en"
        >
          ₪{Number(closingBalance ?? 0).toFixed(2)}
        </span>
      </div>

      <p className="text-center text-[10px] text-slate-400 mt-8 pt-5 border-t border-slate-100 leading-relaxed">
        {brandName} — {brandNameEn} · كشف حساب للمراجعة الداخلية · يُصدَر من نظام {BRAND_NAME}
      </p>
    </div>
  );
}
