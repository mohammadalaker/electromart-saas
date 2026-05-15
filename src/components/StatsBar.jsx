import { Package, TrendingUp, AlertTriangle, Loader2 } from 'lucide-react';
import { isInventoryOutOfStock } from '../lib/inventoryStock';

function countOutOfStock(items) {
  return items.filter((i) => isInventoryOutOfStock(i)).length;
}

const cardBase =
  'rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:bg-[#18181b] dark:border-white/[0.04] p-5 flex flex-col min-h-[124px]';

/**
 * @param {number | null} salesTodayNis — مجموع total_amount لمبيعات اليوم من جدول sales؛ null أثناء التحميل
 * @param {Array} [itemsForOutOfStockCount] — نفس نطاق فلتر «منتهية» (بعد المجموعة والبحث)
 */
export default function StatsBar({ items, itemsForOutOfStockCount, loading, salesTodayNis = null }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className={`${cardBase} animate-pulse border-l-4 border-l-slate-200 dark:border-l-white/10`}
          >
            <div className="h-10 w-10 rounded-xl bg-slate-100 dark:bg-white/10" />
            <div className="mt-4 h-4 w-28 rounded bg-slate-100 dark:bg-white/10" />
            <div className="mt-2 h-8 w-20 rounded bg-slate-100 dark:bg-white/10" />
          </div>
        ))}
      </div>
    );
  }

  const productsCount = items.length;
  const scopeForOut = itemsForOutOfStockCount ?? items;
  /** نفس منطق زر «منتهية» على نفس القائمة المعروضة بعد المجموعة والبحث */
  const outOfStockCount = countOutOfStock(scopeForOut);
  const salesReady = typeof salesTodayNis === 'number';
  const salesDisplay = salesReady
    ? `${Number(salesTodayNis).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`
    : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
      <div className={`${cardBase} border-l-4 border-l-rose-500`}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-500">
          <AlertTriangle size={20} strokeWidth={2} />
        </div>
        <p className="mt-4 text-sm font-bold text-slate-500 dark:text-slate-400">أصناف منتهية المخزون</p>
        <h3 className="mt-1 text-3xl font-black text-slate-900 dark:text-white font-currency">
          {outOfStockCount.toLocaleString('en-US')}
        </h3>
      </div>

      <div className={`${cardBase} border-l-4 border-l-indigo-500`}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
          <Package size={20} strokeWidth={2} />
        </div>
        <p className="mt-4 text-sm font-bold text-slate-500 dark:text-slate-400">إجمالي الأصناف</p>
        <h3 className="mt-1 text-3xl font-black text-slate-900 dark:text-white font-currency">
          {productsCount.toLocaleString('en-US')}
        </h3>
      </div>

      <div className={`${cardBase} border-l-4 border-l-emerald-500`}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-500">
          <TrendingUp size={20} strokeWidth={2} />
        </div>
        <p className="mt-4 text-sm font-bold text-slate-500 dark:text-slate-400">مبيعات اليوم</p>
        {salesReady ? (
          <h3
            className="mt-1 text-3xl font-black text-slate-900 dark:text-white font-currency"
            dir="ltr"
            lang="en"
          >
            {salesDisplay}
          </h3>
        ) : (
          <div className="mt-1 flex min-h-[2.25rem] items-center" role="status" aria-label="جاري التحميل">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" strokeWidth={2} />
          </div>
        )}
      </div>
    </div>
  );
}
