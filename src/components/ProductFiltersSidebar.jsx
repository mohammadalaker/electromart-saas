import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Filter,
  FilterX,
  Layers,
  Tag,
  Palette,
  SlidersHorizontal,
  X,
  Search,
} from 'lucide-react';

function CheckboxRow({ checked, onToggle, label, id, count }) {
  const showCount = typeof count === 'number';
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-2.5 rounded-xl px-2 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-white/30 dark:text-slate-200 dark:hover:bg-white/5"
    >
      <span className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="peer h-4 w-4 cursor-pointer rounded border-slate-300/80 bg-white/50 text-indigo-600 focus:ring-2 focus:ring-indigo-400/40 dark:border-slate-600 dark:bg-slate-800/80 dark:text-indigo-400"
        />
      </span>
      <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <span className="leading-snug">{label}</span>
        {showCount && (
          <span
            className="shrink-0 text-[11px] font-black text-slate-400 dark:text-slate-500 font-currency tabular-nums"
            dir="ltr"
          >
            ({count})
          </span>
        )}
      </span>
    </label>
  );
}

const defaultFacetCounts = {
  categories: { electrical: 0, home: 0 },
  brandCounts: {},
  productTypeCounts: {},
  colorCounts: {},
};

/**
 * شريط جانبي لفلاتر المنتجات — Glassmorphism، متوافق مع الوضع الداكن
 * على الموبايل: زر «تصفية» + لوحة منزلقة
 */
export default function ProductFiltersSidebar({
  brandOptions = [],
  colorOptions = [],
  facetCounts: facetCountsProp,
  categories = [],
  brands = [],
  colors = [],
  onToggleCategory,
  onToggleBrand,
  onToggleColor,
  onClear,
  hasActiveFilters,
}) {
  const facetCounts = facetCountsProp || defaultFacetCounts;
  const [brandQuery, setBrandQuery] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeFilterCount =
    categories.length + brands.length + colors.length;

  const filteredBrandOptions = useMemo(() => {
    const q = brandQuery.trim().toLowerCase();
    if (!q) return brandOptions;
    return brandOptions.filter((b) => String(b.label || b.value).toLowerCase().includes(q));
  }, [brandOptions, brandQuery]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const panelInner = (opts = {}) => {
    const { showBrandSearch = true } = opts;
    return (
      <>
        <div className="mb-4 flex items-center justify-between gap-2 border-b border-white/20 dark:border-white/10 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
              <Filter size={18} strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black text-slate-800 dark:text-white">بحث متقدم</h3>
              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">تحديث فوري للقائمة</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClear}
            disabled={!hasActiveFilters}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200/80 bg-white/60 px-2.5 py-1.5 text-[11px] font-black text-slate-600 shadow-sm transition-all hover:bg-white disabled:pointer-events-none disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <FilterX size={14} />
            مسح الفلاتر
          </button>
        </div>

        <div className="max-h-[min(70vh,560px)] space-y-5 overflow-y-auto pr-0.5 lg:max-h-[min(70vh,560px)]">
          <section>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <Layers size={14} className="text-indigo-500 dark:text-indigo-400" />
              النوع (الفئة)
            </div>
            <div className="rounded-xl border border-white/20 bg-white/25 p-2 dark:border-white/5 dark:bg-white/[0.04]">
              <CheckboxRow
                id="cat-electrical"
                label="أجهزة كهربائية"
                count={facetCounts.categories?.electrical}
                checked={categories.includes('electrical')}
                onToggle={() => onToggleCategory('electrical')}
              />
              <CheckboxRow
                id="cat-home"
                label="أدوات منزلية"
                count={facetCounts.categories?.home}
                checked={categories.includes('home')}
                onToggle={() => onToggleCategory('home')}
              />
            </div>
          </section>

          {brandOptions.length > 0 && (
            <section>
              <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <Tag size={14} className="text-indigo-500 dark:text-indigo-400" />
                العلامة التجارية
              </div>
              {showBrandSearch && (
                <div className="relative mb-2">
                  <Search
                    className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={brandQuery}
                    onChange={(e) => setBrandQuery(e.target.value)}
                    placeholder="ابحث عن علامة…"
                    className="w-full rounded-xl border border-white/25 bg-white/50 py-2 pr-8 pl-2 text-xs font-bold text-slate-800 placeholder:text-slate-400 focus:border-indigo-400/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-white/10 dark:bg-slate-800/50 dark:text-white dark:placeholder:text-slate-500"
                    dir="rtl"
                    autoComplete="off"
                  />
                </div>
              )}
              <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-xl border border-white/20 bg-white/25 p-2 dark:border-white/5 dark:bg-white/[0.04]">
                {filteredBrandOptions.length === 0 ? (
                  <p className="py-3 text-center text-xs font-bold text-slate-400 dark:text-slate-500">
                    لا توجد علامات مطابقة
                  </p>
                ) : (
                  filteredBrandOptions.map((b, idx) => (
                    <CheckboxRow
                      key={b.value}
                      id={`brand-opt-${idx}`}
                      label={b.label}
                      count={facetCounts.brandCounts?.[b.value] ?? 0}
                      checked={brands.includes(b.value)}
                      onToggle={() => onToggleBrand(b.value)}
                    />
                  ))
                )}
              </div>
            </section>
          )}

          {colorOptions.length > 0 && (
            <section>
              <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <Palette size={14} className="text-indigo-500 dark:text-indigo-400" />
                اللون (من اسم المنتج)
              </div>
              <div className="flex flex-wrap gap-2 rounded-xl border border-white/20 bg-white/25 p-2 dark:border-white/5 dark:bg-white/[0.04]">
                {colorOptions.map((c) => {
                  const active = colors.includes(c.id);
                  const cnt = facetCounts.colorCounts?.[c.id] ?? 0;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onToggleColor(c.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-black transition-all ${
                        active
                          ? 'border-indigo-500 bg-indigo-500/20 text-indigo-800 shadow-[0_0_0_2px_rgba(99,102,241,0.35)] dark:border-indigo-400 dark:bg-indigo-500/25 dark:text-indigo-100'
                          : 'border-slate-200/80 bg-white/40 text-slate-600 hover:border-indigo-300 dark:border-slate-600 dark:bg-slate-800/40 dark:text-slate-300'
                      }`}
                    >
                      {c.label}{' '}
                      <span className="font-currency tabular-nums opacity-80" dir="ltr">
                        ({cnt})
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </>
    );
  };

  const glassShell = 'relative overflow-hidden rounded-2xl border border-white/25 dark:border-white/10 bg-white/45 dark:bg-slate-900/35 backdrop-blur-xl shadow-[0_8px_40px_-12px_rgba(15,23,42,0.2)] dark:shadow-[0_8px_40px_-12px_rgba(0,0,0,0.55)] ring-1 ring-white/30 dark:ring-white/5';

  const mobileSheet =
    mobileOpen &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-end justify-center lg:hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="filters-sheet-title"
      >
        <button
          type="button"
          className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px]"
          aria-label="إغلاق"
          onClick={() => setMobileOpen(false)}
        />
        <div
          className="relative z-[1] flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-3xl border border-white/15 bg-white/90 shadow-2xl dark:border-white/10 dark:bg-slate-900/95"
          dir="rtl"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-slate-700/60">
            <h2 id="filters-sheet-title" className="text-base font-black text-slate-900 dark:text-white">
              تصفية المنتجات
            </h2>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-400"
              aria-label="إغلاق"
            >
              <X size={22} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 pt-1">{panelInner({ showBrandSearch: true })}</div>
          <div className="shrink-0 border-t border-slate-200/80 bg-white/80 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-slate-700/60 dark:bg-slate-900/90">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="w-full rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 py-3.5 text-sm font-black text-white shadow-lg shadow-indigo-500/25"
            >
              عرض النتائج
            </button>
          </div>
        </div>
      </div>,
      document.body
    );

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/25 bg-white/50 py-3 text-sm font-black text-slate-800 shadow-sm backdrop-blur-md transition-colors hover:bg-white/70 dark:border-white/10 dark:bg-slate-900/50 dark:text-white dark:hover:bg-slate-800/80 lg:hidden"
      >
        <SlidersHorizontal size={18} className="shrink-0 text-indigo-600 dark:text-indigo-400" />
        <span>تصفية</span>
        {activeFilterCount > 0 && (
          <span className="flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[11px] font-black text-white dark:bg-indigo-500">
            {activeFilterCount}
          </span>
        )}
      </button>

      <aside className={`${glassShell} hidden lg:block lg:w-[280px] lg:shrink-0 lg:sticky lg:top-2`} dir="rtl">
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500/[0.07] via-transparent to-violet-500/[0.06] dark:from-indigo-400/[0.06] dark:to-violet-500/[0.04]"
          aria-hidden
        />
        <div className="relative p-4 sm:p-5">{panelInner({ showBrandSearch: true })}</div>
      </aside>

      {mobileSheet}
    </>
  );
}
