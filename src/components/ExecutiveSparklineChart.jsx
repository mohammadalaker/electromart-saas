import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

function ChartTooltip({ active, payload, label, formatMoney, shekel }) {
  if (!active || !payload?.length) return null;
  const v = Number(payload[0].value ?? 0);
  return (
    <div
      className="rounded-xl border border-slate-200/90 bg-white/95 px-3 py-2.5 shadow-xl backdrop-blur-md dark:border-slate-600/80 dark:bg-slate-900/95"
      dir="rtl"
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-black tabular-nums text-slate-900 dark:text-white" dir="ltr">
        {shekel}
        {formatMoney(v)}
      </p>
    </div>
  );
}

/**
 * @param {Array<{ label: string, amount: number }>} data
 * @param {string} chartId — فريد لكل مخطط (تدرج SVG)
 * @param {string} stroke — لون الخط والتدرج
 */
export default function ExecutiveSparklineChart({
  data,
  chartId,
  stroke,
  formatMoney,
  shekel = '\u20AA',
  height = 200,
}) {
  const gid = `exec-fill-${chartId}`;

  return (
    <div className="w-full select-none" style={{ height }} dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 16, right: 8, left: 0, bottom: 2 }}
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.45} />
              <stop offset="55%" stopColor={stroke} stopOpacity={0.12} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="4 6"
            vertical={false}
            stroke="currentColor"
            className="text-slate-200 dark:text-slate-600/35"
            strokeOpacity={0.9}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fontWeight: 700, fill: 'currentColor' }}
            className="text-slate-500 dark:text-slate-400"
            axisLine={false}
            tickLine={false}
            dy={8}
            interval="preserveStartEnd"
            minTickGap={8}
          />
          <YAxis hide domain={[0, 'dataMax']} />
          <Tooltip
            cursor={{ stroke: stroke, strokeWidth: 1, strokeDasharray: '4 4', strokeOpacity: 0.5 }}
            content={(tipProps) => (
              <ChartTooltip {...tipProps} formatMoney={formatMoney} shekel={shekel} />
            )}
          />
          <Area
            type="monotone"
            dataKey="amount"
            stroke={stroke}
            strokeWidth={2.5}
            fill={`url(#${gid})`}
            fillOpacity={1}
            activeDot={{
              r: 5,
              strokeWidth: 2,
              stroke: '#ffffff',
              fill: stroke,
            }}
            animationDuration={900}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
