import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

function FilterCheckbox({ id, label, count, checked, onToggle }) {
  if (typeof count === 'number' && count === 0 && !checked) return null;

  return (
    <label htmlFor={id} className="flex items-center justify-between px-4 py-1 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4 accent-indigo-600"
        />
        <span className="truncate text-gray-700 dark:text-gray-300" title={label}>
          {label}
        </span>
      </span>
      {typeof count === 'number' && (
        <span className="rounded-full bg-gray-100 px-2 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400" dir="ltr">
          {count}
        </span>
      )}
    </label>
  );
}

function CollapsibleSection({ title, children, defaultOpen = true }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className="border-b border-gray-200 dark:border-gray-800">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full cursor-pointer items-center justify-between px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 transition hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/70"
        aria-expanded={isOpen}
      >
        <span>{title}</span>
        <ChevronDown
          size={14}
          className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {isOpen ? <div className="pb-2">{children}</div> : null}
    </section>
  );
}

export default function PosProductFiltersSidebar({
  facetCounts,
  brandOptions = [],
  productTypeOptions = [],
  categories = [],
  brands = [],
  productTypes = [],
  onToggleCategory,
  onToggleBrand,
  onToggleProductType,
  onReset,
  hasActiveFilters,
  staticFiltersHint = null,
}) {
  return (
    <aside
      className="h-full w-full overflow-y-auto border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
      dir="rtl"
    >
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-50">فلاتر المنتجات</span>
        <button
          type="button"
          onClick={onReset}
          disabled={!hasActiveFilters}
          className="text-xs text-indigo-600 transition hover:underline disabled:cursor-not-allowed disabled:opacity-40"
        >
          إعادة تعيين
        </button>
      </div>

      <div className="min-h-0">
        {staticFiltersHint && (
          <p
            className="mx-4 my-3 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] font-bold leading-relaxed text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-300"
            role="status"
          >
            {staticFiltersHint}
          </p>
        )}
        <CollapsibleSection title="النوع (Category)" defaultOpen>
          <FilterCheckbox
            id="pos-cat-el"
            label="أجهزة كهربائية"
            count={facetCounts?.categories?.electrical}
            checked={categories.includes('electrical')}
            onToggle={() => onToggleCategory('electrical')}
          />
          <FilterCheckbox
            id="pos-cat-home"
            label="أدوات منزلية"
            count={facetCounts?.categories?.home}
            checked={categories.includes('home')}
            onToggle={() => onToggleCategory('home')}
          />
        </CollapsibleSection>

        {brandOptions.length > 0 && (
          <CollapsibleSection title="العلامة التجارية (Brand)" defaultOpen>
            {brandOptions.map((b, idx) => (
              <FilterCheckbox
                key={b.value}
                id={`pos-brand-${idx}`}
                label={b.label}
                count={facetCounts?.brandCounts?.[b.value] ?? 0}
                checked={brands.includes(b.value)}
                onToggle={() => onToggleBrand(b.value)}
              />
            ))}
          </CollapsibleSection>
        )}

        {productTypeOptions.length > 0 && (
          <CollapsibleSection title="نوع المنتج" defaultOpen>
            {productTypeOptions.map((s, idx) => (
              <FilterCheckbox
                key={s.value}
                id={`pos-ptype-${idx}`}
                label={s.label}
                count={facetCounts?.productTypeCounts?.[s.value] ?? 0}
                checked={productTypes.includes(s.value)}
                onToggle={() => onToggleProductType(s.value)}
              />
            ))}
          </CollapsibleSection>
        )}
      </div>
    </aside>
  );
}
