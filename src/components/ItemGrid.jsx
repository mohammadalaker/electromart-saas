import { useState, useMemo } from 'react';
import { getCategoryEmoji } from '../utils/categoryEmoji';

export default function ItemGrid({ items }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return items || [];
    const q = search.toLowerCase().trim();
    return (items || []).filter(
      (i) =>
        (i.engName || '').toLowerCase().includes(q) ||
        String(i.qty).includes(q) ||
        String(i.price).includes(q)
    );
  }, [items, search]);

  return (
    <div className="rounded-2xl bg-white/80 dark:bg-gray-900/50 backdrop-blur-md border border-white/20 dark:border-gray-700/30 p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-100">Inventory items</h3>
        <input
          type="search"
          placeholder="Search by name, qty, price…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-2xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((item) => (
          <div
            key={item.id}
            className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40 p-4 hover:bg-white dark:hover:bg-slate-800/70 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl shrink-0">{getCategoryEmoji(item.engName)}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800 dark:text-slate-100 truncate" title={item.engName}>
                  {item.engName}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  Qty: {item.qty} × {typeof item.price === 'number' ? `$${item.price.toFixed(2)}` : item.price} ={' '}
                  <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                    ${(item.value ?? item.qty * (item.price || 0)).toFixed(2)}
                  </span>
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
      {filtered.length === 0 && (
        <p className="text-slate-400 dark:text-slate-500 text-sm py-8 text-center">
          {items?.length ? 'No items match your search.' : 'Load an Excel/CSV or use sample data.'}
        </p>
      )}
    </div>
  );
}
