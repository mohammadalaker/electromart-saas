import { useState, useEffect, useRef, memo } from 'react';
import { Search, Loader2, X } from 'lucide-react';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';

function InventorySearchBar({
  value = '',
  onSearch,
  loading = false,
  placeholder = 'بحث بالاسم، الباركود، المجموعة…',
  debounceMs = 250,
}) {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef(null);
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  // Sync external resets
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Clean timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleChange = (e) => {
    const val = normalizeDigitsToLatin(e.target.value);
    setLocalValue(val);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      if (onSearchRef.current) {
        onSearchRef.current(val);
      }
    }, debounceMs);
  };

  const handleClear = () => {
    setLocalValue('');
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    if (onSearchRef.current) {
      onSearchRef.current('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (onSearchRef.current) {
        onSearchRef.current(localValue);
      }
    } else if (e.key === 'Escape') {
      handleClear();
    }
  };

  return (
    <div className="relative min-w-[120px] max-w-xs flex-1">
      {loading ? (
        <Loader2
          className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-indigo-500 animate-spin"
          size={14}
          aria-hidden
        />
      ) : (
        <Search
          className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-indigo-400"
          size={14}
          aria-hidden
        />
      )}
      <input
        type="text"
        placeholder={placeholder}
        value={localValue}
        dir="ltr"
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="w-full min-w-0 rounded-xl border border-slate-200 bg-white/95 py-2 pl-9 pr-7 text-sm text-gray-900 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20 dark:border-white/10 dark:bg-slate-900/70 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-indigo-400/50 dark:focus:ring-indigo-500/20"
      />
      {localValue && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded transition-colors"
          title="مسح البحث"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export default memo(InventorySearchBar);
