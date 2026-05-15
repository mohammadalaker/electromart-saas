import { Pencil, Trash2, ShoppingCart, Package } from 'lucide-react';
import StorageObjectImage from './StorageObjectImage';
import { roundMoney } from '../utils/productModel';
import { getProductTypeLabel } from '../utils/productTypes';

/**
 * جدول منتجات أنيق — RTL، ظلال ناعمة، زوايا مستديرة 2xl
 */
export default function ProductsTable({
  items,
  getStockStatus,
  isElectricalGroup,
  onEdit,
  onDelete,
  onRowClick,
  onAddToCart,
  showSalesColumn = false,
  getSalesQty,
}) {
  return (
    <div
      className="rounded-2xl border border-white/20 dark:border-gray-700/30 bg-white/80 dark:bg-gray-900/50 backdrop-blur-md shadow-[0_4px_32px_-8px_rgba(15,23,42,0.12),0_0_0_1px_rgba(15,23,42,0.03)] dark:shadow-[0_4px_32px_-8px_rgba(0,0,0,0.4)] overflow-hidden"
      dir="rtl"
    >
      <div className="px-6 py-4 border-b border-slate-100 dark:border-gray-700/40 bg-gradient-to-l from-slate-50/80 to-white dark:from-slate-800/80 dark:to-gray-900/20">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">قائمة الأصناف</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          <span className="font-currency" lang="en">
            {items.length.toLocaleString('en-US')}
          </span>{' '}
          صنف معروض — اضغط على الاسم أو الصورة ثم «تعديل الصنف»، أو استخدم أيقونة القلم في العمود المثبّت يساراً.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[1120px]">
          <thead>
            <tr className="bg-slate-50/95 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-gray-700/50">
              <th className="text-right py-3.5 px-4 font-semibold w-16 whitespace-nowrap">صورة</th>
              <th className="text-right py-3.5 px-4 font-semibold min-w-[160px] whitespace-nowrap">الاسم</th>
              <th className="text-right py-3.5 px-4 font-semibold min-w-[120px] whitespace-nowrap">نوع المنتج</th>
              <th className="text-right py-3.5 px-4 font-semibold min-w-[110px] whitespace-nowrap">المجموعة</th>
              <th className="text-right py-3.5 px-4 font-semibold min-w-[7.5rem] whitespace-nowrap">الباركود</th>
              <th className="text-right py-3.5 px-4 font-semibold min-w-[6.5rem] whitespace-nowrap">المرجع</th>
              <th className="text-right py-3.5 px-4 font-semibold min-w-[5.5rem] whitespace-nowrap">السعر</th>
              <th className="text-right py-3.5 px-4 font-semibold min-w-[6.5rem] whitespace-nowrap">بعد الخصم</th>
              <th className="text-right py-3.5 px-4 font-semibold min-w-[4.5rem] whitespace-nowrap">الكمية</th>
              {showSalesColumn && (
                <th
                  className="text-right py-3.5 px-4 font-semibold min-w-[7rem] whitespace-nowrap"
                  title="من آخر دفعة فواتير مُجمّعة"
                >
                  مبيعات (قطع)
                </th>
              )}
              <th className="text-right py-3.5 px-4 font-semibold min-w-[5rem] whitespace-nowrap">الحالة</th>
              <th className="text-center py-3.5 px-4 font-semibold min-w-[9rem] whitespace-nowrap sticky left-0 z-20 bg-slate-50/98 dark:bg-slate-800/98 border-l border-slate-200/80 dark:border-gray-600/50 shadow-[4px_0_14px_-6px_rgba(15,23,42,0.12)] dark:shadow-[4px_0_14px_-6px_rgba(0,0,0,0.45)]">
                إجراءات
              </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={showSalesColumn ? 12 : 11} className="py-16 text-center text-slate-500 dark:text-slate-400">
                  <Package className="mx-auto mb-3 text-slate-300 dark:text-slate-600" size={40} />
                  <p className="font-medium">لا توجد أصناف مطابقة للبحث أو الفلتر</p>
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const status = getStockStatus(item);
                const electrical = isElectricalGroup(item.group);
                const stockN =
                  item.stock != null && item.stock !== '' ? Number(item.stock) : NaN;
                const qtyCritical = !Number.isNaN(stockN) && stockN === 1;
                return (
                  <tr
                    key={item.id}
                    className="border-b border-slate-50 dark:border-gray-800/80 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/30 transition-colors group"
                  >
                    <td className="py-4 px-6 align-middle">
                      <button
                        type="button"
                        onClick={() => onRowClick(item)}
                        className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-100 overflow-hidden flex items-center justify-center shrink-0 hover:ring-2 hover:ring-indigo-200 transition-all"
                      >
                        <StorageObjectImage
                          srcValue={item.image}
                          className="w-full h-full object-contain p-1"
                          iconSize={22}
                        />
                      </button>
                    </td>
                    <td className="py-4 px-6 align-middle">
                      <button
                        type="button"
                        onClick={() => onRowClick(item)}
                        className="text-right font-semibold text-gray-900 dark:text-white line-clamp-2 hover:text-indigo-700 dark:hover:text-indigo-400"
                      >
                        {item.name || '—'}
                      </button>
                    </td>
                    <td className="py-4 px-6 align-middle max-w-[160px]">
                      {getProductTypeLabel(item.productType) ? (
                        <span
                          className="inline-block max-w-full truncate px-2.5 py-1 rounded-lg text-xs font-black bg-indigo-100 text-indigo-900 dark:bg-indigo-950/80 dark:text-indigo-200"
                          title={getProductTypeLabel(item.productType)}
                        >
                          {getProductTypeLabel(item.productType)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-4 px-6 align-middle">
                      {item.group ? (
                        <span
                          className={`inline-block max-w-[140px] truncate px-2 py-0.5 rounded-lg text-xs font-medium ${
                            electrical
                              ? 'bg-violet-100 text-violet-800'
                              : 'bg-sky-100 text-sky-800'
                          }`}
                          title={item.group}
                        >
                          {item.group}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td
                      className="py-4 px-6 align-middle text-xs text-slate-600 font-currency"
                      dir="ltr"
                      lang="en"
                    >
                      {item.barcode || '—'}
                    </td>
                    <td
                      className="py-4 px-6 align-middle text-xs text-slate-600 font-currency max-w-[120px] truncate"
                      dir="ltr"
                      lang="en"
                      title={item.reference || ''}
                    >
                      {item.reference || '—'}
                    </td>
                    <td className="py-4 px-6 align-middle font-medium text-slate-700 font-currency" dir="ltr" lang="en">
                      ₪{roundMoney(item.price ?? 0).toFixed(2)}
                    </td>
                    <td className="py-4 px-6 align-middle font-semibold text-emerald-600 font-currency" dir="ltr" lang="en">
                      ₪{roundMoney(item.priceAfterDiscount ?? item.price ?? 0).toFixed(2)}
                    </td>
                    <td
                      className={`py-4 px-6 align-middle font-currency font-bold ${
                        qtyCritical
                          ? 'inventory-qty-critical rounded-lg text-rose-700 dark:text-rose-300'
                          : 'text-slate-800 dark:text-slate-200'
                      }`}
                      dir="ltr"
                      lang="en"
                    >
                      {item.stock != null && item.stock !== '' ? Number(item.stock) : '—'}
                    </td>
                    {showSalesColumn && (
                      <td
                        className="py-4 px-6 align-middle font-black text-violet-700 dark:text-violet-300 font-currency"
                        dir="ltr"
                        lang="en"
                      >
                        {typeof getSalesQty === 'function'
                          ? Number(getSalesQty(item)).toLocaleString('en-US')
                          : '—'}
                      </td>
                    )}
                    <td className="py-4 px-6 align-middle">
                      <span
                        className={`text-xs font-semibold px-2 py-1 rounded-full ${
                          status === 'موجود'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="py-4 px-6 align-middle sticky left-0 z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-l border-slate-100 dark:border-gray-700/60 shadow-[4px_0_14px_-6px_rgba(15,23,42,0.1)] dark:shadow-[4px_0_14px_-6px_rgba(0,0,0,0.4)] group-hover:bg-indigo-50/90 dark:group-hover:bg-indigo-950/40">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onAddToCart(item)}
                          className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 flex items-center justify-center transition-colors"
                          title="إضافة للسلة"
                        >
                          <ShoppingCart size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onEdit(item)}
                          className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center justify-center transition-colors"
                          title="تعديل الصورة والتصنيف"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(item.barcode)}
                          className="w-8 h-8 rounded-full bg-rose-50 text-rose-500 hover:bg-rose-100 flex items-center justify-center transition-colors"
                          title="حذف"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
