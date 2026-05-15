import { BRAND_NAME } from '../constants/brand.js';

/**
 * وصل بسيط للطباعة السريعة من نقطة البيع (80mm تقريباً).
 */
export default function PrintPosReceiptSimple({ data }) {
  if (!data) return null;
  const {
    storeName,
    lines = [],
    total,
    customerName,
    address,
    tenderLabel,
    checkLines,
    visaLast4,
    walletLabel,
    pickupDate,
    pickupFromLabel,
    printedAtLabel,
  } = data;

  return (
    <div
      className="print-invoice-root max-w-[80mm] mx-auto bg-white text-slate-900 p-6 text-sm"
      dir="rtl"
    >
      <div className="text-center border-b border-slate-200 pb-3 mb-3">
        <p className="font-black text-lg">{storeName || BRAND_NAME}</p>
        <p className="text-[10px] text-slate-500 font-bold mt-1">وصل بيع — POS</p>
      </div>
      {customerName ? (
        <p className="text-xs font-bold text-slate-700 mb-2">
          العميل: <span dir="ltr">{customerName}</span>
        </p>
      ) : null}
      {address ? (
        <p className="text-[10px] font-bold text-slate-600 mb-1 leading-snug">العنوان: {address}</p>
      ) : null}
      {tenderLabel ? (
        <p className="text-[10px] font-bold text-slate-600 mb-1">التحصيل: {tenderLabel}</p>
      ) : null}
      {checkLines?.length ? (
        <div className="text-[9px] font-bold text-slate-600 mb-1 space-y-0.5 leading-tight">
          {checkLines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      ) : null}
      {visaLast4 ? (
        <p className="text-[10px] font-bold text-slate-600 mb-1" dir="ltr">
          بطاقة: •••• {String(visaLast4).replace(/\D/g, '').slice(0, 4)}
        </p>
      ) : null}
      {walletLabel ? (
        <p className="text-[10px] font-bold text-slate-600 mb-1">محفظة: {walletLabel}</p>
      ) : null}
      {pickupDate ? (
        <p className="text-[10px] font-bold text-slate-600 mb-1" dir="ltr">
          استلام: {pickupDate}
        </p>
      ) : null}
      {pickupFromLabel ? (
        <p className="text-[10px] font-bold text-slate-600 mb-2">من: {pickupFromLabel}</p>
      ) : null}
      <table className="w-full text-xs border-collapse mb-3">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            <th className="py-1 text-right font-black">الصنف</th>
            <th className="py-1 text-center w-10">عدد</th>
            <th className="py-1 text-left font-currency w-16" dir="ltr">
              المجموع
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="py-1.5 max-w-[42mm]">
                <div className="font-bold truncate">{line.name || '—'}</div>
                {line.serial ? (
                  <div
                    className="text-[8px] font-mono text-slate-500 mt-0.5 truncate"
                    dir="ltr"
                    title={line.serial}
                  >
                    {line.serial}
                  </div>
                ) : null}
              </td>
              <td className="py-1.5 text-center font-currency" dir="ltr">
                {line.qty}
              </td>
              <td className="py-1.5 text-left font-currency font-bold" dir="ltr">
                ₪{Number(line.lineTotal ?? 0).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-between items-center border-t-2 border-slate-800 pt-2 mt-2">
        <span className="font-black">الإجمالي</span>
        <span className="font-black text-lg font-currency" dir="ltr">
          ₪{Number(total ?? 0).toFixed(2)}
        </span>
      </div>
      <p className="text-[10px] text-center text-slate-400 mt-4 pt-2 border-t border-slate-100">
        {printedAtLabel}
      </p>
    </div>
  );
}
