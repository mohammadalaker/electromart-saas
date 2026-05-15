import { memo, useEffect, useState } from 'react';
import { Plus, Zap } from 'lucide-react';
import StorageObjectImage from './StorageObjectImage';
import { roundMoney } from '../utils/productModel';
import { getProductTypeLabel } from '../utils/productTypes';
import StarRating from './StarRating';

/**
 * كارد منتج للعرض الشبكي — يعرض الصورة والسعر وزر الإضافة للسلة.
 * @param {boolean} [snappy] — انتقالات أسرع (مثلاً نقطة البيع)
 */
function ProductCard({
  item,
  onAddToCart,
  onEdit,
  getStockStatus,
  salesSoldQty,
  reviewStats,
  onReview,
  cartQty = 0,
  snappy = false,
}) {
  const t = snappy ? 'duration-150' : 'duration-500';
  const stockStatus = getStockStatus?.(item);
  const stockNum = item?.stock != null ? Number(item.stock) : null;
  const isOutOfStock =
    stockStatus === 'نفد' ||
    stockStatus === 'لا يوجد' ||
    stockStatus === 'غير موجود' ||
    (stockNum != null && stockNum <= 0);
  const isLowStock = !isOutOfStock && stockNum != null && stockNum <= 5;

  const hasDiscount =
    item.priceAfterDiscount != null &&
    item.priceAfterDiscount !== '' &&
    Number(item.priceAfterDiscount) < Number(item.price);
  const discountPct = hasDiscount
    ? Math.round(
        ((Number(item.price) - Number(item.priceAfterDiscount)) / Number(item.price)) * 100
      )
    : 0;

  const productTypeLabel = getProductTypeLabel(item.productType) || '—';
  const displayPrice = roundMoney(item.priceAfterDiscount ?? item.price ?? 0);
  const selectedQty = Math.max(0, Number(cartQty) || 0);
  const [addedFlash, setAddedFlash] = useState(false);

  useEffect(() => {
    if (!addedFlash) return undefined;
    const tmr = setTimeout(() => setAddedFlash(false), 600);
    return () => clearTimeout(tmr);
  }, [addedFlash]);

  return (
    <div
      className={`group relative flex min-h-full cursor-pointer flex-col overflow-hidden rounded-xl border bg-white dark:bg-gray-900 transition-all ${t} hover:border-indigo-400 hover:shadow-md ${
        selectedQty > 0 && snappy
          ? 'border-indigo-400'
          : addedFlash
            ? 'border-emerald-400 shadow-emerald-100'
            : 'border-gray-200 dark:border-gray-800'
      }`}
      onClick={() => onEdit?.(item)}
    >
      {/* Non-snappy: stock badge top-left */}
      {!snappy && (
        <span
          className={`absolute left-3 top-3 z-10 rounded-full px-3 py-1 text-[10px] font-bold shadow-sm backdrop-blur ${
            isOutOfStock
              ? 'bg-rose-50/90 text-rose-700 ring-1 ring-rose-100 dark:bg-rose-950/70 dark:text-rose-200 dark:ring-rose-900/70'
              : isLowStock
                ? 'bg-amber-50/90 text-amber-700 ring-1 ring-amber-100 dark:bg-amber-950/70 dark:text-amber-200 dark:ring-amber-900/70'
                : 'bg-emerald-50/90 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/70 dark:text-emerald-200 dark:ring-emerald-900/70'
          }`}
        >
          {isOutOfStock ? 'نفد المخزون' : isLowStock ? `آخر ${stockNum} قطع` : 'متوفر'}
        </span>
      )}

      {/* Discount % badge — top-right */}
      {hasDiscount && discountPct > 0 && (
        <span
          className={`absolute z-10 flex items-center gap-0.5 rounded-full bg-gradient-to-br from-rose-500 to-orange-500 px-2 py-0.5 text-[9px] font-black text-white shadow-sm ${
            snappy && selectedQty > 0 ? 'right-10 top-3' : 'right-3 top-3'
          }`}
        >
          <Zap size={8} className="shrink-0" />
          {discountPct}%
        </span>
      )}

      {/* Cart qty badge (snappy) */}
      {snappy && selectedQty > 0 && (
        <span
          className="absolute right-3 top-3 z-20 flex h-6 min-w-6 items-center justify-center rounded-full bg-violet-600 px-1.5 text-[10px] font-black text-white shadow-md shadow-violet-500/30"
          dir="ltr"
          lang="en"
          title="الكمية في السلة"
        >
          {selectedQty}
        </span>
      )}

      {/* Image area */}
      <div
        className={`relative flex w-full items-center justify-center overflow-hidden bg-gray-100 dark:bg-gray-800 ${
          snappy ? 'h-48' : 'h-40 sm:h-44'
        }`}
      >
        {item.image ? (
          <div className="flex h-full w-full items-center justify-center p-4">
            <StorageObjectImage
              srcValue={item.image}
              className={`max-h-full max-w-full object-contain drop-shadow-sm transition-transform ${t} group-hover:scale-[1.03]`}
              iconSize={40}
            />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-300 dark:text-gray-600">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}

        {/* Snappy: stock chip at bottom-left of image */}
        {snappy && (
          <span
            className={`absolute bottom-2 left-2 z-10 flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold shadow-sm backdrop-blur ${
              isOutOfStock
                ? 'bg-rose-600/90 text-white'
                : isLowStock
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-white/10 text-slate-200'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                isOutOfStock
                  ? 'bg-white/80'
                  : isLowStock
                    ? 'bg-white/80'
                    : 'bg-emerald-500 dark:bg-emerald-300'
              }`}
            />
            {isOutOfStock
              ? 'نفد المخزون'
              : isLowStock
                ? `آخر ${stockNum} قطع`
                : 'متوفر'}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col px-3 py-2 text-right" dir="rtl">
        <p className="mb-0.5 text-xs text-gray-400">
          {productTypeLabel}
        </p>
        <h3
          className={`line-clamp-2 font-semibold leading-snug text-gray-900 dark:text-white ${
            snappy ? 'text-xs' : 'min-h-11 text-sm'
          }`}
        >
          {item.name || '—'}
        </h3>
        <p className="sr-only" title={[productTypeLabel, item.group, item.reference].filter(Boolean).join(' — ')} />

        {!snappy && salesSoldQty != null && (
          <p className="mt-2 text-[10px] font-bold text-violet-600 dark:text-violet-400" dir="ltr" lang="en">
            مبيعات: {Number(salesSoldQty).toLocaleString('en-US')} قطعة
          </p>
        )}

        {!snappy && (
          <div
            className="mt-2 flex min-h-[18px] items-center justify-between"
            onClick={(e) => { e.stopPropagation(); onReview?.(item); }}
            role={onReview ? 'button' : undefined}
            tabIndex={onReview ? 0 : undefined}
            title={onReview ? 'أضف تقييمك' : undefined}
            style={{ cursor: onReview ? 'pointer' : 'default' }}
            onKeyDown={(e) => { if (e.key === 'Enter' && onReview) { e.stopPropagation(); onReview(item); } }}
          >
            {reviewStats && reviewStats.count > 0 ? (
              <StarRating value={reviewStats.avg} count={reviewStats.count} showCount size="sm" />
            ) : onReview ? (
              <span className="text-[9px] font-bold text-slate-400 transition-colors hover:text-amber-500 dark:text-slate-500 dark:hover:text-amber-400">
                ★ أول من يقيّم
              </span>
            ) : (
              <span className="text-[9px] text-slate-300 dark:text-slate-700">— لا تقييمات</span>
            )}
            {onReview && reviewStats && reviewStats.count > 0 && (
              <span className="text-[9px] font-bold text-indigo-400 transition-colors hover:text-indigo-600 dark:hover:text-indigo-300">
                + قيّم
              </span>
            )}
          </div>
        )}

        <div className={`mt-auto flex gap-3 pt-4 ${snappy ? 'flex-col items-stretch' : 'items-end justify-between'}`}>
          <div className="min-w-0 text-left tabular-nums" dir="ltr" lang="en">
            {hasDiscount && (
              <div className="text-[11px] font-semibold text-slate-400 line-through dark:text-slate-600">
                ₪{roundMoney(item.price ?? 0).toFixed(2)}
              </div>
            )}
            <div className="mt-1 text-lg font-bold tracking-tight text-indigo-600">
              ₪{displayPrice.toFixed(2)}
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddToCart?.(item);
              setAddedFlash(true);
            }}
            disabled={isOutOfStock}
            className={`relative mt-2 flex h-10 shrink-0 items-center justify-center gap-1 overflow-hidden rounded-lg bg-indigo-600 text-sm font-medium text-white transition-all hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
              snappy ? 'w-full duration-100' : 'w-11'
            } ${
              selectedQty > 0 && snappy
                ? 'bg-indigo-700'
                : ''
            }`}
            title="أضف للسلة"
            aria-label="أضف للسلة"
          >
            <Plus size={20} strokeWidth={2.5} />
            {snappy && (
              <span className="text-sm font-black">
                {selectedQty > 0 ? `إضافة (${selectedQty})` : 'إضافة'}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(ProductCard);
