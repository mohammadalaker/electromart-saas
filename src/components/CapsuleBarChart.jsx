import { getCategoryEmoji } from '../utils/categoryEmoji';

const PASTELS = [
  'bg-[#99D6FF]',
  'bg-[#99E6B3]',
  'bg-[#E6B3F5]',
  'bg-[#FFE699]',
  'bg-[#99E6E6]',
  'bg-[#FFB399]',
];

/**
 * مخطط أشرطة كبسولي — ألوان ثابتة للأشرطة، نصوص وخطوط تتكيف مع Dark Mode.
 */
export default function CapsuleBarChart({ items, maxBars = 10, title = 'Stock Distribution' }) {
  const sorted = [...(items || [])]
    .filter((i) => i.qty > 0)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, maxBars);
  const maxQty = Math.max(1, ...sorted.map((i) => i.qty));

  return (
    <div className="rounded-2xl bg-white/80 dark:bg-gray-900/50 backdrop-blur-md border border-white/20 dark:border-gray-700/30 p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-100 mb-4">{title}</h3>
      <div className="space-y-3">
        {sorted.map((item, i) => (
          <div key={item.id} className="flex items-center gap-3">
            <span className="text-xl w-8 shrink-0" title={item.engName}>
              {getCategoryEmoji(item.engName)}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{item.engName}</p>
              <div className="h-6 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mt-0.5 ring-1 ring-inset ring-slate-200/60 dark:ring-slate-600/50">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ease-out ${PASTELS[i % PASTELS.length]}`}
                  style={{ width: `${Math.min(100, (item.qty / maxQty) * 100)}%` }}
                />
              </div>
            </div>
            <span className="text-sm font-semibold text-slate-600 dark:text-slate-300 w-10 text-right shrink-0 tabular-nums">
              {item.qty}
            </span>
          </div>
        ))}
      </div>
      {sorted.length === 0 && (
        <p className="text-slate-400 dark:text-slate-500 text-sm py-4 text-center">No quantity data to show.</p>
      )}
    </div>
  );
}
