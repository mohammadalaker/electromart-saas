const STYLES = {
  blue: 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-200 border-indigo-200/80 dark:border-indigo-800/60',
  green: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-emerald-200/80 dark:border-emerald-800/60',
  neutral: 'bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600',
};

export default function SummaryWidget({ label, value, trend, style = 'blue' }) {
  return (
    <div
      className={`rounded-2xl border p-5 shadow-sm backdrop-blur-sm ${STYLES[style] || STYLES.blue}`}
    >
      <p className="text-sm font-medium opacity-90">{label}</p>
      <p className="text-xl font-bold mt-1">{value}</p>
      {trend && <p className="text-xs mt-1 opacity-80 dark:opacity-90">{trend}</p>}
    </div>
  );
}
