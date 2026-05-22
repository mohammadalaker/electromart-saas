import { BRAND_NAME } from '../constants/brand.js';

/**
 * فاتورة طباعة احترافية — خط Cairo، جدول أصناف، ملخص مبالغ.
 * يُعرض داخل طبقة ثابتة ثم يُستدعى window.print().
 */
export default function PrintInvoice({ data }) {
  if (!data) return null;

  const {
    storeName,
    customerName,
    customerPhone,
    customerEmail,
    customerAddress,
    customerNotes,
    posTenderLabel,
    checkDetailsLines,
    visaLast4,
    posWalletLabel,
    pickupDateLabel,
    pickupLocationLabel,
    lines,
    subtotal,
    totalDiscount,
    finalTotal,
    manualDiscount,
    printedAtLabel,
  } = data;

  return (
    <>
      <style>{`
  @media print {
    @page { margin: 10mm; }
    head, header ~ *, .print-browser-header { display: none !important; }
  }
`}</style>
    <div
      className="print-invoice-root max-w-[210mm] mx-auto bg-white text-slate-900 px-6 py-8 sm:px-10"
      dir="rtl"
    >
      <header className="border-b-2 border-indigo-600/90 pb-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="font-title text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {storeName || 'المتجر'}
            </h1>
            <p className="mt-1 text-sm font-bold text-indigo-600">فاتورة مبيعات</p>
          </div>
          <div className="text-left text-xs sm:text-sm text-slate-500 font-bold">
            <span className="block text-slate-400 text-[10px] uppercase tracking-wider">التاريخ</span>
            <span dir="ltr" lang="en">
              {printedAtLabel}
            </span>
          </div>
        </div>
      </header>

      <section className="mb-8 rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
        <h2 className="font-title text-sm font-black text-slate-700 mb-3">بيانات العميل</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          {customerName && customerName !== '—' && customerName.trim() && (
            <div>
              <dt className="text-[11px] font-bold text-slate-400">الاسم</dt>
              <dd className="font-bold text-slate-800">{customerName}</dd>
            </div>
          )}
          {customerPhone && customerPhone !== '—' && String(customerPhone).trim() && (
            <div>
              <dt className="text-[11px] font-bold text-slate-400">الهاتف</dt>
              <dd className="font-bold font-currency" dir="ltr" lang="en">
                {customerPhone}
              </dd>
            </div>
          )}
          {customerEmail && customerEmail !== '—' && String(customerEmail).trim() ? (
            <div className="sm:col-span-2">
              <dt className="text-[11px] font-bold text-slate-400">البريد</dt>
              <dd className="font-currency" dir="ltr" lang="en">
                {customerEmail}
              </dd>
            </div>
          ) : null}
          {customerAddress && customerAddress !== '—' && String(customerAddress).trim() ? (
            <div className="sm:col-span-2">
              <dt className="text-[11px] font-bold text-slate-400">العنوان</dt>
              <dd className="text-slate-700 leading-relaxed">{customerAddress}</dd>
            </div>
          ) : null}
          {posTenderLabel ? (
            <div>
              <dt className="text-[11px] font-bold text-slate-400">طريقة التحصيل</dt>
              <dd className="font-bold text-slate-800">{posTenderLabel}</dd>
            </div>
          ) : null}
          {checkDetailsLines?.length ? (
            <div className="sm:col-span-2">
              <dt className="text-[11px] font-bold text-slate-400">تفاصيل الشيكات</dt>
              <dd className="space-y-1">
                {checkDetailsLines.map((line, i) => (
                  <div key={i} className="font-bold text-slate-800 text-sm leading-snug">
                    {line}
                  </div>
                ))}
              </dd>
            </div>
          ) : null}
          {visaLast4 ? (
            <div>
              <dt className="text-[11px] font-bold text-slate-400">البطاقة — آخر 4 أرقام</dt>
              <dd className="font-black font-currency tracking-widest" dir="ltr" lang="en">
                •••• {String(visaLast4).replace(/\D/g, '').slice(0, 4)}
              </dd>
            </div>
          ) : null}
          {posWalletLabel ? (
            <div className="sm:col-span-2">
              <dt className="text-[11px] font-bold text-slate-400">محفظة رقمية</dt>
              <dd className="font-bold text-slate-800">{posWalletLabel}</dd>
            </div>
          ) : null}
          {pickupDateLabel ? (
            <div>
              <dt className="text-[11px] font-bold text-slate-400">تاريخ الاستلام المتوقع</dt>
              <dd className="font-currency font-bold" dir="ltr" lang="en">
                {pickupDateLabel}
              </dd>
            </div>
          ) : null}
          {pickupLocationLabel ? (
            <div>
              <dt className="text-[11px] font-bold text-slate-400">الاستلام من</dt>
              <dd className="font-bold text-slate-800">{pickupLocationLabel}</dd>
            </div>
          ) : null}
          {customerNotes && customerNotes !== '—' && String(customerNotes).trim() ? (
            <div className="sm:col-span-2">
              <dt className="text-[11px] font-bold text-slate-400">ملاحظات</dt>
              <dd className="text-slate-700 leading-relaxed">{customerNotes}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="mb-6">
        <h2 className="font-title text-sm font-black text-slate-700 mb-3">تفاصيل الأصناف</h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-indigo-600 text-white text-right">
                <th className="px-4 py-3 font-black w-10">#</th>
                <th className="px-4 py-3 font-black w-14 print:hidden">صورة</th>
                <th className="px-4 py-3 font-black min-w-[120px]">المنتج</th>
                <th className="px-4 py-3 font-black w-28" dir="ltr">
                  الباركود
                </th>
                <th className="px-4 py-3 font-black w-16" dir="ltr">
                  الكمية
                </th>
                <th className="px-4 py-3 font-black w-20" dir="ltr">
                  السعر
                </th>
                <th className="px-4 py-3 font-black w-16" dir="ltr">
                  خصم %
                </th>
                <th className="px-4 py-3 font-black w-24" dir="ltr">
                  بعد الخصم
                </th>
                <th className="px-4 py-3 font-black w-24" dir="ltr">
                  المجموع
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr key={idx} className="border-b border-slate-100 odd:bg-white even:bg-slate-50/50">
                  <td className="px-4 py-3 text-center font-bold text-slate-500">{idx + 1}</td>
                  <td className="px-4 py-2 print:hidden w-14">
                    {line.imageUrl ? (
                      <img
                        src={line.imageUrl}
                        alt=""
                        className="w-10 h-10 object-contain rounded-lg bg-slate-100 mx-auto"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-slate-100 mx-auto" />
                    )}
                  </td>
                  <td className="px-4 py-3 font-bold text-slate-800 leading-snug">
                    <div className="line-clamp-2 max-w-[180px]">{line.name || '—'}</div>
                    {line.serial ? (
                      <div
                        className="text-[10px] font-mono font-semibold text-slate-500 mt-1 whitespace-pre-wrap break-all"
                        dir="ltr"
                        lang="en"
                      >
                        سيريال: {line.serial}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-currency text-[11px] text-slate-600" dir="ltr" lang="en">
                    {line.barcode || '—'}
                  </td>
                  <td className="px-4 py-3 font-currency font-bold text-center" dir="ltr" lang="en">
                    {line.qty}
                  </td>
                  <td className="px-4 py-3 font-currency" dir="ltr" lang="en">
                    ₪{Number(line.originalPrice ?? 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 font-currency text-center" dir="ltr" lang="en">
                    {line.discountPercent ?? 0}%
                  </td>
                  {(line.discountPercent ?? 0) > 0 ? (
                    <td className="px-4 py-3 font-currency font-semibold text-indigo-700" dir="ltr" lang="en">
                      ₪{Number(line.unitPrice ?? 0).toFixed(2)}
                    </td>
                  ) : null}
                  <td className="px-4 py-3 font-currency font-black text-slate-900" dir="ltr" lang="en">
                    ₪{Number(line.lineTotal ?? 0).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mt-8 space-y-3 border-t border-slate-200 pt-6">
        <div className="flex justify-between text-sm font-bold text-slate-600">
          <span>إجمالي السعر الأصلي</span>
          <span className="font-currency" dir="ltr" lang="en">
            ₪{Number(subtotal ?? 0).toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between text-sm font-bold text-emerald-700">
          <span>توفير (خصومات)</span>
          <span className="font-currency" dir="ltr" lang="en">
            − ₪{Number(totalDiscount ?? 0).toFixed(2)}
          </span>
        </div>
        {Number(manualDiscount ?? 0) > 0.005 && (
          <div className="flex justify-between text-sm font-bold text-rose-600">
            <span>خصم يدوي</span>
            <span className="font-currency" dir="ltr" lang="en">
              − ₪{Number(manualDiscount).toFixed(2)}
            </span>
          </div>
        )}
        <div className="flex justify-between items-center rounded-2xl bg-indigo-50 border border-indigo-100 px-5 py-4">
          <span className="font-title text-lg font-black text-slate-900">المطلوب دفعه</span>
          <span className="font-title text-2xl font-black text-indigo-600 font-currency tracking-tight" dir="ltr" lang="en">
            ₪{Number(finalTotal ?? 0).toFixed(2)}
          </span>
        </div>
        <p className="text-center text-[10px] text-slate-400 pt-2">
          شكراً لتعاملكم معنا — {BRAND_NAME}
        </p>
      </footer>
    </div>
    </>
  );
}
