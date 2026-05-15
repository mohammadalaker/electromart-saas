export default function DailySnapshot({ totalValue, totalQty, dateLabel = 'Today' }) {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(totalValue);

  return (
    <div className="rounded-2xl bg-white/80 dark:bg-gray-900/50 backdrop-blur-md border border-white/20 dark:border-gray-700/30 p-6 shadow-lg">
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">Daily Snapshot</p>
      <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-300">{formatted}</p>
      <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
        {totalQty.toLocaleString()} parts · {dateLabel}
      </p>
    </div>
  );
}
