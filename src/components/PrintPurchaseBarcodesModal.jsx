import { useMemo, useState } from 'react';
import Barcode from 'react-barcode';
import { X, Printer, Tag } from 'lucide-react';

export default function PrintPurchaseBarcodesModal({ lines = [], storeName = '', onClose }) {
  const [showPrice, setShowPrice] = useState(true);
  const [showStoreName, setShowStoreName] = useState(true);
  const [paperType, setPaperType] = useState('roll'); // 'roll' | 'a4'

  // Generate flat array of labels based on quantities
  const labels = useMemo(() => {
    const list = [];
    lines.forEach((line) => {
      const bc = String(line.barcode || '').trim();
      if (!bc) return;
      const q = Math.max(1, Math.floor(Number(line.qty) || 1));
      const pName = line.product_name || line.productName || line.reference || 'صنف';
      const price = line.sellPrice != null ? Number(line.sellPrice) : Number(line.unit_price) || 0;

      for (let i = 0; i < q; i++) {
        list.push({
          id: `${line.key || line.barcode}-${i}`,
          barcode: bc,
          name: pName,
          price,
          unit: line.unit || 'قطعة',
        });
      }
    });
    return list;
  }, [lines]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 print:p-0 print:bg-white print:static print:inset-auto"
      dir="rtl"
    >
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-3xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden print:border-none print:shadow-none print:max-w-none print:max-h-none print:w-full">
        
        {/* Modal Header (Hidden in Print) */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/10 px-6 py-4 shrink-0 print:hidden bg-slate-50/70 dark:bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
              <Tag size={20} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                طباعة ملصقات الباركود للأصناف المستلمة
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                إجمالي الملصقات: <span className="font-mono font-black text-violet-600 dark:text-violet-400">{labels.length}</span> ملصق (حسب الكميات المستلمة بالفاتورة)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Options Toolbar (Hidden in Print) */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3 border-b border-slate-200/80 dark:border-white/5 bg-slate-50/40 dark:bg-slate-950/30 text-xs shrink-0 print:hidden">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer select-none font-bold text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={showPrice}
                onChange={(e) => setShowPrice(e.target.checked)}
                className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              <span>عرض سعر الصنف</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none font-bold text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={showStoreName}
                onChange={(e) => setShowStoreName(e.target.checked)}
                className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              <span>عرض اسم المتجر</span>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-500">نوع الورق:</span>
            <button
              type="button"
              onClick={() => setPaperType('roll')}
              className={`px-3 py-1.5 rounded-lg font-bold transition ${
                paperType === 'roll'
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              طابعة ملصقات (رول 38x25mm)
            </button>
            <button
              type="button"
              onClick={() => setPaperType('a4')}
              className={`px-3 py-1.5 rounded-lg font-bold transition ${
                paperType === 'a4'
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              صفحة A4 (شبكة ملصقات)
            </button>
          </div>
        </div>

        {/* Labels Preview & Print Container */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar print:overflow-visible print:p-0">
          {labels.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              لا توجد أصناف تحمل باركود أو كميات صالحة في هذه الفاتورة.
            </div>
          ) : (
            <div
              className={`barcode-print-grid ${
                paperType === 'roll'
                  ? 'flex flex-wrap gap-3 justify-center'
                  : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3'
              }`}
            >
              {labels.map((item, index) => (
                <div
                  key={`${item.id}-${index}`}
                  className="barcode-sticker border border-slate-200 rounded-xl p-2.5 bg-white text-slate-900 text-center flex flex-col items-center justify-between shadow-xs print:shadow-none print:border-slate-300 print:break-inside-avoid w-[190px] h-[135px]"
                >
                  {showStoreName && storeName ? (
                    <div className="text-[10px] font-bold text-slate-500 truncate max-w-[170px] leading-tight">
                      {storeName}
                    </div>
                  ) : null}

                  <div className="text-xs font-black text-slate-900 truncate max-w-[170px] leading-tight px-1" title={item.name}>
                    {item.name}
                  </div>

                  <div className="my-1 flex items-center justify-center overflow-hidden max-w-[175px]">
                    <Barcode
                      value={item.barcode}
                      width={1.2}
                      height={32}
                      fontSize={10}
                      margin={0}
                      displayValue={true}
                    />
                  </div>

                  {showPrice ? (
                    <div className="text-xs font-black text-slate-900 font-mono tracking-tight" dir="ltr">
                      ₪ {item.price.toFixed(2)}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Footer (Hidden in Print) */}
        <div className="flex items-center justify-between border-t border-slate-200 dark:border-white/10 px-6 py-4 shrink-0 print:hidden bg-slate-50/70 dark:bg-slate-950/60">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            إغلاق
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={labels.length === 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white text-xs font-black shadow-md shadow-violet-600/30 transition disabled:opacity-50 cursor-pointer"
          >
            <Printer size={16} />
            <span>طباعة الملصقات ({labels.length})</span>
          </button>
        </div>

      </div>
    </div>
  );
}
