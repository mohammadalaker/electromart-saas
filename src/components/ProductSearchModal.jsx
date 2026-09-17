import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search,
  X,
  PackagePlus,
  Loader2,
  Package,
  Boxes,
  Tag,
  AlertCircle,
  CornerDownLeft,
} from 'lucide-react';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { normalizeItemFromSupabase, roundMoney } from '../utils/productModel';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';
import { PRODUCT_UNITS_TABLE } from '../utils/productUnits';
import StorageObjectImage from './StorageObjectImage';

function escapeIlike(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * مودال بحث الأصناف السريع بالاسم أو الباركود لنقطة البيع (POS)
 *
 * @param {boolean} isOpen حالة ظهور النافذة
 * @param {Function} onClose دالة الإغلاق
 * @param {Function} onSelectProduct دالة اختيار الصنف وإضافته للفاتورة (product, unitData) => void
 * @param {string} storeId معرف المتجر
 * @param {Function} onAddNewProduct اختياري: فتح مودال إضافة صنف جديد مع نص البحث
 */
export default function ProductSearchModal({
  isOpen,
  onClose,
  onSelectProduct,
  storeId,
  onAddNewProduct,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const searchInputRef = useRef(null);
  const listContainerRef = useRef(null);
  const activeItemRef = useRef(null);

  // جلب أصناف المتجر (سواء بالبحث الفوري أو الافتراضية الأخيرة)
  const executeSearch = useCallback(
    async (searchTerm) => {
      if (!storeId) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      const cleanTerm = normalizeDigitsToLatin(String(searchTerm || '')).trim();

      const sel =
        'id, barcode, reference, eng_name, full_price, price_after_disc, purchase_price, brand_group, stock_count, image_url, box_count';

      try {
        if (!cleanTerm) {
          // استعراض آخر 20 منتج في المتجر لكي لا تظهر الشاشة فارغة عند الفتح
          const { data, error } = await supabase
            .from(PRODUCTS_TABLE)
            .select(sel)
            .eq('store_id', storeId)
            .order('created_at', { ascending: false })
            .limit(20);

          if (!error && Array.isArray(data)) {
            setResults(data);
          } else {
            setResults([]);
          }
          setLoading(false);
          return;
        }

        const safePattern = `%${escapeIlike(cleanTerm)}%`;

        const [rName, rBarcode, rRef, rUnits] = await Promise.all([
          supabase
            .from(PRODUCTS_TABLE)
            .select(sel)
            .eq('store_id', storeId)
            .ilike('eng_name', safePattern)
            .limit(20),
          supabase
            .from(PRODUCTS_TABLE)
            .select(sel)
            .eq('store_id', storeId)
            .ilike('barcode', safePattern)
            .limit(15),
          supabase
            .from(PRODUCTS_TABLE)
            .select(sel)
            .eq('store_id', storeId)
            .ilike('reference', safePattern)
            .limit(10),
          supabase
            .from(PRODUCT_UNITS_TABLE)
            .select(
              `
              id,
              unit_name,
              conversion_factor,
              barcode,
              sale_price,
              cost_price,
              product_id,
              product:products(
                id,
                barcode,
                reference,
                eng_name,
                full_price,
                price_after_disc,
                purchase_price,
                brand_group,
                stock_count,
                image_url,
                box_count
              )
            `
            )
            .eq('store_id', storeId)
            .or(`barcode.ilike.${safePattern},unit_name.ilike.${safePattern}`)
            .limit(15)
            .then((res) => res)
            .catch(() => ({ data: [] })),
        ]);

        const map = new Map();

        // 1. الأصناف الأساسية
        [rName.data, rBarcode.data, rRef.data].forEach((arr) => {
          (arr || []).forEach((p) => {
            if (p?.id) {
              map.set(p.id, p);
            }
          });
        });

        // 2. نتائج الوحدات الإضافية (مثل كرتونة أو علبة لها باركود مستقل)
        (rUnits?.data || []).forEach((u) => {
          if (u?.product?.id) {
            map.set(`unit_${u.id}`, {
              ...u.product,
              unitData: u,
            });
          }
        });

        const combined = Array.from(map.values());

        // ترتيب النتائج: المطابقة التامة للباركود أو الاسم في المقدمة
        const lowerClean = cleanTerm.toLowerCase();
        combined.sort((a, b) => {
          const aBc = normalizeDigitsToLatin(String(a.unitData?.barcode || a.barcode || '')).toLowerCase();
          const bBc = normalizeDigitsToLatin(String(b.unitData?.barcode || b.barcode || '')).toLowerCase();
          const aName = String(a.eng_name || '').toLowerCase();
          const bName = String(b.eng_name || '').toLowerCase();

          if (aBc === lowerClean && bBc !== lowerClean) return -1;
          if (bBc === lowerClean && aBc !== lowerClean) return 1;
          if (aName === lowerClean && bName !== lowerClean) return -1;
          if (bName === lowerClean && aName !== lowerClean) return 1;
          if (aName.startsWith(lowerClean) && !bName.startsWith(lowerClean)) return -1;
          if (bName.startsWith(lowerClean) && !aName.startsWith(lowerClean)) return 1;
          return 0;
        });

        setResults(combined.slice(0, 30));
      } catch (err) {
        console.error('Error executing product modal search:', err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [storeId]
  );

  // التعامل مع فتح المودال والتركيز التلقائي
  useEffect(() => {
    if (!isOpen) return;

    setQuery('');
    setActiveIndex(-1);
    executeSearch('');

    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 60);

    return () => clearTimeout(timer);
  }, [isOpen, executeSearch]);

  // تنفيذ البحث الفوري مع Debounce خفيف جداً
  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(() => {
      executeSearch(query);
      setActiveIndex(-1);
    }, 120);

    return () => clearTimeout(timer);
  }, [query, isOpen, executeSearch]);

  // التمرير التلقائي للعنصر المحدد بالأسهم
  useEffect(() => {
    if (activeItemRef.current && listContainerRef.current) {
      activeItemRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [activeIndex]);

  // اختيار صنف معين
  const handleSelect = (rawItem) => {
    if (!rawItem) return;

    const normalizedProduct = normalizeItemFromSupabase(rawItem);
    const unitOverride = rawItem.unitData
      ? {
          unit: rawItem.unitData.unit_name,
          unitPrice:
            rawItem.unitData.sale_price != null && rawItem.unitData.sale_price !== ''
              ? Number(rawItem.unitData.sale_price)
              : normalizedProduct.priceAfterDiscount || normalizedProduct.price,
          conversionFactor: Number(rawItem.unitData.conversion_factor) || 1,
        }
      : null;

    onSelectProduct?.(normalizedProduct, unitOverride);
    onClose?.();
  };

  // التحكم بلوحة المفاتيح داخل المودال (الأسهم، Enter، Esc)
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose?.();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length === 0) return;
      setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length === 0) return;
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (results.length === 0) {
        if (query.trim() && onAddNewProduct) {
          onAddNewProduct(query.trim());
          onClose?.();
        }
        return;
      }
      const targetItem = activeIndex >= 0 ? results[activeIndex] : results[0];
      if (targetItem) {
        handleSelect(targetItem);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 dark:bg-slate-950/85 backdrop-blur-md p-3 sm:p-4 animate-in fade-in duration-150"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl overflow-hidden rounded-3xl border border-slate-200/90 dark:border-white/10 bg-white/95 dark:bg-slate-900/95 shadow-2xl backdrop-blur-2xl text-right text-slate-900 dark:text-white flex flex-col max-h-[90vh] transition-all"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* ── رأس المودال ── */}
        <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-white/10 px-5 py-3.5 bg-slate-50/80 dark:bg-slate-950/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950/80 dark:text-indigo-400 shadow-xs">
              <Search size={20} strokeWidth={2.5} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                  بحث عن صنف في المخزون
                </h3>
                <span className="hidden sm:inline-flex items-center rounded-lg bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200 dark:border-indigo-800/60 px-2 py-0.5 text-[11px] font-mono font-bold text-indigo-700 dark:text-indigo-300">
                  F4 / Ctrl+K
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                ابحث بالاسم أو الباركود أو الموديل — اختر الصنف لإضافته فوراً للفاتورة
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white transition cursor-pointer"
            title="إغلاق (Esc)"
          >
            <kbd className="hidden sm:inline-block text-[10px] font-mono bg-slate-200/60 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-500">
              Esc
            </kbd>
            <X size={20} />
          </button>
        </div>

        {/* ── حقل البحث الكبير والواضح ── */}
        <div className="p-4 border-b border-slate-200/80 dark:border-white/10 bg-white dark:bg-slate-900 shrink-0">
          <div className="relative flex items-center">
            <Search
              size={22}
              className="absolute right-4 text-indigo-600 dark:text-indigo-400 pointer-events-none"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="اكتب اسم الصنف أو امسح الباركود بالسكانر..."
              className="w-full h-13 rounded-2xl border-2 border-indigo-500/40 dark:border-indigo-500/30 bg-slate-50/90 dark:bg-slate-950/80 pr-12 pl-24 text-base font-bold text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 shadow-inner focus:border-indigo-600 focus:bg-white dark:focus:bg-slate-950 focus:outline-none focus:ring-4 focus:ring-indigo-500/15 transition-all"
              autoComplete="off"
              spellCheck="false"
            />

            <div className="absolute left-3 flex items-center gap-2">
              {loading && <Loader2 size={20} className="animate-spin text-indigo-500" />}
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    searchInputRef.current?.focus();
                  }}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white transition cursor-pointer"
                  title="مسح النص"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── قائمة نتائج البحث ── */}
        <div
          ref={listContainerRef}
          className="flex-1 overflow-y-auto min-h-[260px] max-h-[58vh] divide-y divide-slate-100 dark:divide-white/5 bg-slate-50/50 dark:bg-slate-950/40"
        >
          {results.length === 0 && !loading ? (
            <div className="py-14 text-center px-4 space-y-3">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-200/60 dark:border-amber-800/40 shadow-xs">
                <AlertCircle size={26} />
              </div>
              <h4 className="text-base font-black text-slate-800 dark:text-slate-100">
                لا توجد نتائج مطابقة
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
                لم نجد أي صنف مسجل في المخزون يطابق «
                <span className="font-bold text-slate-700 dark:text-slate-200">{query}</span>»
              </p>

              {onAddNewProduct && query.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    onAddNewProduct(query.trim());
                    onClose?.();
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-5 py-2.5 text-xs font-black shadow-md shadow-emerald-600/20 hover:shadow-lg transition cursor-pointer"
                >
                  <PackagePlus size={16} />
                  <span>تسجيل «{query.trim()}» كصنف جديد للمخزون والفاتورة</span>
                </button>
              )}
            </div>
          ) : (
            <ul className="p-2 space-y-1.5">
              {results.map((item, idx) => {
                const isSelected = idx === activeIndex;
                const u = item.unitData;
                const factor = u ? Number(u.conversion_factor) || 1 : 1;

                // احتساب سعر البيع المعروض
                const unitSalePrice =
                  u && Number(u.sale_price) > 0
                    ? Number(u.sale_price)
                    : item.price_after_disc != null && Number(item.price_after_disc) > 0
                    ? Number(item.price_after_disc) * factor
                    : Number(item.full_price ?? item.price ?? 0) * factor;

                // رصيد المخزون المتوفر
                const rawStock = item.stock_count ?? item.stock;
                const stock = rawStock != null && rawStock !== '' ? Number(rawStock) : null;
                const isOutOfStock = stock !== null && stock <= 0;

                const displayBc = u?.barcode || item.barcode || '';

                return (
                  <li
                    key={u ? `unit_${u.id}` : item.id}
                    ref={isSelected ? activeItemRef : null}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={`w-full text-right p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 group cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-50/90 dark:bg-indigo-950/60 border-indigo-400/80 dark:border-indigo-500/60 shadow-md ring-2 ring-indigo-500/20'
                          : 'bg-white/80 dark:bg-slate-900/60 border-slate-200/80 dark:border-white/5 hover:bg-slate-100/80 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      {/* 1. الصورة المصغرة وبيانات الصنف */}
                      <div className="flex items-center gap-3.5 min-w-0 flex-1">
                        {/* الصورة المصغرة */}
                        <div className="w-12 h-12 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                          <StorageObjectImage
                            srcValue={item.image_url || item.image}
                            alt={item.eng_name || item.name}
                            className="w-full h-full object-cover"
                            iconSize={22}
                            fallbackClassName="text-slate-400 dark:text-slate-500"
                          />
                        </div>

                        {/* تفاصيل الاسم والباركود */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition truncate">
                              {item.eng_name || item.name || 'صنف بدون اسم'}
                            </p>

                            {/* شارة الوحدة الإضافية إن وجدت */}
                            {u && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-100 text-indigo-800 dark:bg-indigo-900/70 dark:text-indigo-300 text-xs font-black shrink-0 border border-indigo-200 dark:border-indigo-800/60">
                                <Boxes size={12} />
                                {u.unit_name} ({u.conversion_factor} قطعة)
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {displayBc ? (
                              <span
                                className="font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md text-[11px] font-bold text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60"
                                dir="ltr"
                              >
                                {displayBc}
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400">بدون باركود</span>
                            )}

                            {item.reference && (
                              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                · موديل: {item.reference}
                              </span>
                            )}

                            {item.brand_group && (
                              <span className="text-[11px] bg-slate-100 dark:bg-slate-800/60 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400">
                                {item.brand_group}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 2. السعر + رصيد المخزون */}
                      <div className="text-left shrink-0 space-y-1">
                        <div className="flex items-center justify-end gap-1 font-mono">
                          <span className="text-base sm:text-lg font-black text-indigo-600 dark:text-indigo-400 font-mono">
                            {roundMoney(unitSalePrice)} ₪
                          </span>
                        </div>

                        {/* حالة المخزون: تلوين أحمر صارخ إذا 0 أو سالب */}
                        <div className="flex justify-end">
                          {stock != null ? (
                            !isOutOfStock ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60">
                                المخزون: {stock}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-black bg-rose-100 text-rose-700 border border-rose-300 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-800/80 animate-pulse">
                                {stock < 0 ? `رصيد سالب (${stock})` : 'نفد من المخزون (0)'}
                              </span>
                            )
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </div>
                      </div>

                      {/* 3. زر التأكيد السريع */}
                      <div className="hidden sm:flex items-center justify-center w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition shrink-0 shadow-xs">
                        <CornerDownLeft size={16} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ── ذيل المودال (Footer) ── */}
        <div className="px-5 py-3 border-t border-slate-200/80 dark:border-white/10 bg-slate-50/90 dark:bg-slate-950/60 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700 dark:text-slate-300">
              اضغط على أي صنف لإضافته مباشرة للفاتورة
            </span>
            <span className="hidden md:inline text-slate-400">
              (الأسهم للتنقل • Enter للإضافة • Esc للإغلاق)
            </span>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
            <span>عدد النتائج:</span>
            <strong className="text-indigo-600 dark:text-indigo-400 font-bold">
              {results.length}
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}
