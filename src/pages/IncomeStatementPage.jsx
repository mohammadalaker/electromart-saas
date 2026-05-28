import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Receipt,
  Plus,
  Trash2,
  Printer,
  X,
  BarChart2,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import DashboardLayout from '../components/DashboardLayout';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { roundMoney, normalizeItemFromSupabase, runProductsSelectWithFallback } from '../utils/productModel';
import { getExpenses, addExpense, deleteExpense, getExpensesSummary } from '../lib/expenses';
import { parseSaleLineItems } from '../utils/saleReturn';

const PERIOD_PRESETS = [
  { id: 'this_month', label: 'هذا الشهر' },
  { id: 'q1', label: 'الربع الأول' },
  { id: 'h1', label: 'النصف الأول' },
  { id: 'year', label: 'هذه السنة' },
  { id: 'custom', label: 'مخصص' },
];

const EXPENSE_CATEGORIES = [
  { value: 'rent', label: 'إيجار' },
  { value: 'salary', label: 'رواتب' },
  { value: 'electricity', label: 'كهرباء' },
  { value: 'internet', label: 'إنترنت' },
  { value: 'transport', label: 'مواصلات' },
  { value: 'marketing', label: 'تسويق' },
  { value: 'maintenance', label: 'صيانة' },
  { value: 'other', label: 'أخرى' },
];

const CAT_LABELS = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.value, c.label]));

const glassCard =
  'rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-xl shadow-sm dark:shadow-none';

const kpiCardHover =
  'transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg dark:hover:shadow-2xl cursor-default group relative overflow-hidden border-gray-200/80 dark:border-white/10';

const kpiShimmer =
  'absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out bg-gradient-to-r from-transparent via-white/10 dark:via-white/5 to-transparent pointer-events-none';

function formatShekel(n) {
  return `${roundMoney(Number(n ?? 0)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₪`;
}

function formatShekelParen(n) {
  const v = roundMoney(Math.abs(Number(n ?? 0)));
  const formatted = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return Number(n) < 0 ? `(${formatted}) ₪` : `${formatted} ₪`;
}

function resolvePeriodRange(preset, customFrom, customTo) {
  const now = new Date();
  const y = now.getFullYear();
  let from;
  let to;

  switch (preset) {
    case 'q1':
      from = new Date(y, 0, 1);
      to = new Date(y, 2, 31, 23, 59, 59, 999);
      break;
    case 'h1':
      from = new Date(y, 0, 1);
      to = new Date(y, 5, 30, 23, 59, 59, 999);
      break;
    case 'year':
      from = new Date(y, 0, 1);
      to = new Date(y, 11, 31, 23, 59, 59, 999);
      break;
    case 'custom':
      from = new Date(`${customFrom}T00:00:00`);
      to = new Date(`${customTo}T23:59:59`);
      break;
    case 'this_month':
    default:
      from = new Date(y, now.getMonth(), 1);
      to = new Date(y, now.getMonth() + 1, 0, 23, 59, 59, 999);
      break;
  }

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    from = new Date(y, now.getMonth(), 1);
    to = new Date(y, now.getMonth() + 1, 0, 23, 59, 59, 999);
  }
  return { from, to };
}

function monthKey(iso) {
  if (!iso) return null;
  return String(iso).slice(0, 7);
}

function monthLabel(key) {
  if (!key) return '—';
  const [y, m] = key.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('ar-SA', { month: 'short', year: 'numeric' });
}

async function fetchSalesRows(storeId, fromIso, toIso) {
  const baseSelect = 'id, created_at, total_amount, discount, returned_at, line_items';
  let { data, error } = await supabase
    .from('sales')
    .select(baseSelect)
    .eq('store_id', storeId)
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .order('created_at', { ascending: true })
    .limit(5000);

  if (error && /discount|column|PGRST204/i.test(String(error.message || ''))) {
    const res = await supabase
      .from('sales')
      .select('id, created_at, total_amount, returned_at, line_items')
      .eq('store_id', storeId)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: true })
      .limit(5000);
    data = res.data;
    error = res.error;
  }

  if (error) throw error;
  return data || [];
}

async function fetchCogsFromSalesItems(saleIds) {
  if (!saleIds.length) return null;
  let total = 0;
  let hasRows = false;
  const chunk = 150;

  for (let i = 0; i < saleIds.length; i += chunk) {
    const batch = saleIds.slice(i, i + chunk);
    let { data, error } = await supabase
      .from('sales_items')
      .select('sale_id, qty, quantity, cost_price, full_price, unit_price')
      .in('sale_id', batch);

    if (error && /cost_price|column|PGRST204/i.test(String(error.message || ''))) {
      const res = await supabase
        .from('sales_items')
        .select('sale_id, qty, quantity, full_price, unit_price')
        .in('sale_id', batch);
      data = res.data;
      error = res.error;
    }

    if (error) {
      const msg = String(error.message || '');
      if (/does not exist|schema cache|PGRST205|42P01/i.test(msg)) return null;
      throw error;
    }

    for (const row of data || []) {
      hasRows = true;
      const q = Math.max(0, Number(row.qty ?? row.quantity ?? 0));
      const unitCost = Number(row.cost_price ?? row.full_price ?? 0);
      total += q * unitCost;
    }
  }

  return hasRows ? roundMoney(total) : null;
}

function cogsFromLineItems(salesRows, productsMap) {
  let total = 0;
  for (const sale of salesRows) {
    if (sale.returned_at) continue;
    for (const line of parseSaleLineItems(sale.line_items)) {
      const q = Math.max(0, Number(line.qty ?? line.quantity ?? 0));
      if (q <= 0) continue;
      const pid = line.product_id ? String(line.product_id) : null;
      const bc = line.barcode != null ? String(line.barcode) : '';
      let unitCost = Number(line.cost_price ?? line.full_price ?? 0);
      if (!unitCost && pid && productsMap.has(pid)) unitCost = productsMap.get(pid).unitCost ?? 0;
      else if (!unitCost && bc && productsMap.has(`b:${bc}`)) unitCost = productsMap.get(`b:${bc}`).unitCost ?? 0;
      total += q * unitCost;
    }
  }
  return roundMoney(total);
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className={`${glassCard} px-4 py-3 text-xs`} dir="rtl">
      <p className="font-bold text-gray-600 dark:text-slate-400 mb-2">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center justify-between gap-4 py-0.5">
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span className="font-black text-gray-900 dark:text-white" dir="ltr">{formatShekel(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

function StatementRow({ label, value, bold, indent, negative, highlight, raw }) {
  const valueClass = highlight
    ? Number(value) >= 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-rose-600 dark:text-rose-400'
    : negative
      ? 'text-rose-600 dark:text-rose-300'
      : 'text-indigo-600 dark:text-indigo-200';

  let display = raw ? String(value) : formatShekel(value);
  if (!raw && (negative || Number(value) < 0)) {
    display = formatShekelParen(negative ? -Math.abs(value) : value);
  }

  return (
    <div
      className={`flex items-center justify-between gap-4 py-2 ${bold ? 'font-black text-gray-900 dark:text-white' : 'text-gray-600 dark:text-slate-300'} ${indent ? 'pr-4' : ''}`}
    >
      <span className={bold ? 'text-base' : 'text-sm'}>{label}</span>
      <span className={`text-sm font-black tabular-nums ${valueClass}`} dir="ltr">
        {display}
      </span>
    </div>
  );
}

export default function IncomeStatementPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();
  const printRef = useRef(null);

  const [periodPreset, setPeriodPreset] = useState('this_month');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));

  const [loading, setLoading] = useState(true);
  const [salesRows, setSalesRows] = useState([]);
  const [cogs, setCogs] = useState(0);
  const [expensesList, setExpensesList] = useState([]);
  const [expenseSummary, setExpenseSummary] = useState({ byCategory: {}, total: 0 });

  const [showModal, setShowModal] = useState(false);
  const [expForm, setExpForm] = useState({
    category: 'rent',
    description: '',
    amount: '',
    expense_date: new Date().toISOString().slice(0, 10),
  });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const { from, to } = useMemo(
    () => resolvePeriodRange(periodPreset, customFrom, customTo),
    [periodPreset, customFrom, customTo]
  );

  const loadProductsCost = useCallback(async () => {
    if (!store?.id) return new Map();
    const { data, error: qErr } = await runProductsSelectWithFallback((sel) =>
      supabase.from(PRODUCTS_TABLE).select(sel).eq('store_id', store.id)
    );
    if (qErr) throw qErr;
    const m = new Map();
    for (const row of data || []) {
      const it = normalizeItemFromSupabase(row);
      if (!it) continue;
      const cost = Number(row.full_price) || 0;
      m.set(String(it.id), { ...it, unitCost: cost });
      if (it.barcode) m.set(`b:${it.barcode}`, { ...it, unitCost: cost });
    }
    return m;
  }, [store?.id]);

  const loadData = useCallback(async () => {
    if (!store?.id) {
      setSalesRows([]);
      setCogs(0);
      setExpensesList([]);
      setExpenseSummary({ byCategory: {}, total: 0 });
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const fromIso = from.toISOString();
      const toIso = to.toISOString();

      const [sales, productsMap, expenses, summary] = await Promise.all([
        fetchSalesRows(store.id, fromIso, toIso),
        loadProductsCost(),
        getExpenses(store.id, { from, to }),
        getExpensesSummary(store.id, { from, to }),
      ]);

      setSalesRows(sales);
      setExpensesList(expenses);
      setExpenseSummary(summary);

      const activeIds = sales.filter((s) => !s.returned_at).map((s) => s.id);
      let cogsTotal = await fetchCogsFromSalesItems(activeIds);
      if (cogsTotal == null) {
        cogsTotal = cogsFromLineItems(sales, productsMap);
      }
      setCogs(cogsTotal);
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'تعذّر تحميل قائمة الدخل');
    } finally {
      setLoading(false);
    }
  }, [store?.id, from, to, loadProductsCost, toast]);

  useEffect(() => {
    if (!storeLoading) loadData();
  }, [storeLoading, loadData]);

  const metrics = useMemo(() => {
    const active = salesRows.filter((s) => !s.returned_at);
    const returned = salesRows.filter((s) => s.returned_at);

    const grossSales = active.reduce(
      (sum, s) => sum + Number(s.total_amount ?? 0) + Number(s.discount ?? 0),
      0
    );
    const totalDiscounts = active.reduce((sum, s) => sum + Number(s.discount ?? 0), 0);
    const returnsAmount = returned.reduce((sum, s) => sum + Number(s.total_amount ?? 0), 0);
    const deductions = roundMoney(totalDiscounts + returnsAmount);
    const netRevenue = roundMoney(active.reduce((sum, s) => sum + Number(s.total_amount ?? 0), 0));
    const totalExpenses = roundMoney(expenseSummary.total);
    const grossProfit = roundMoney(netRevenue - cogs);
    const grossMargin = netRevenue > 0 ? roundMoney((grossProfit / netRevenue) * 100) : 0;
    const netProfit = roundMoney(grossProfit - totalExpenses);

    return {
      grossSales: roundMoney(grossSales),
      deductions,
      netRevenue,
      cogs: roundMoney(cogs),
      grossProfit,
      grossMargin,
      totalExpenses,
      netProfit,
      byCategory: expenseSummary.byCategory,
    };
  }, [salesRows, cogs, expenseSummary]);

  const monthlyChart = useMemo(() => {
    const months = new Map();
    const addMonth = (key) => {
      if (!months.has(key)) {
        months.set(key, { key, label: monthLabel(key), revenue: 0, expenses: 0, profit: 0 });
      }
      return months.get(key);
    };

    for (const s of salesRows) {
      if (s.returned_at) continue;
      const k = monthKey(s.created_at);
      if (!k) continue;
      addMonth(k).revenue += Number(s.total_amount ?? 0);
    }

    for (const e of expensesList) {
      const k = monthKey(e.expense_date);
      if (!k) continue;
      addMonth(k).expenses += Number(e.amount ?? 0);
    }

    const sorted = [...months.values()].sort((a, b) => a.key.localeCompare(b.key));
    for (const row of sorted) {
      row.revenue = roundMoney(row.revenue);
      row.expenses = roundMoney(row.expenses);
      row.profit = roundMoney(row.revenue - row.expenses);
    }
    return sorted;
  }, [salesRows, expensesList]);

  const sortedCategories = useMemo(() => {
    const entries = Object.entries(metrics.byCategory || {});
    entries.sort((a, b) => b[1] - a[1]);
    return entries;
  }, [metrics.byCategory]);

  const handleAddExpense = async (e) => {
    e.preventDefault();
    if (!store?.id) return;
    const amount = roundMoney(parseFloat(String(expForm.amount).replace(',', '.')) || 0);
    if (amount <= 0) {
      toast.warning('أدخل مبلغاً صحيحاً');
      return;
    }
    setSaving(true);
    try {
      await addExpense({
        store_id: store.id,
        category: expForm.category,
        description: expForm.description.trim() || null,
        amount,
        expense_date: expForm.expense_date,
      });
      toast.success('تم إضافة المصروف');
      setShowModal(false);
      setExpForm({
        category: 'rent',
        description: '',
        amount: '',
        expense_date: new Date().toISOString().slice(0, 10),
      });
      loadData();
    } catch (err) {
      toast.error(err.message || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExpense = async (id) => {
    setDeletingId(id);
    try {
      await deleteExpense(id);
      toast.success('تم حذف المصروف');
      loadData();
    } catch (err) {
      toast.error(err.message || 'فشل الحذف');
    } finally {
      setDeletingId(null);
    }
  };

  const handlePrint = () => window.print();

  if (storeLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="animate-spin text-indigo-500" size={40} />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      actions={
        <button
          type="button"
          onClick={handlePrint}
          className="no-print inline-flex items-center gap-2 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-2.5 text-sm font-black text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/20 transition-colors"
        >
          <Printer size={16} />
          تصدير PDF
        </button>
      }
    >
      <div className="min-h-full bg-gray-50 dark:bg-[#0a0f1e] -m-4 sm:-m-6 p-4 sm:p-6" dir="rtl">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="print-area space-y-6" dir="rtl" ref={printRef}>
            {/* Header */}
            <div className={`${glassCard} p-6`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-400">
                      <TrendingUp size={22} />
                    </div>
                    <h1 className="text-xl font-black text-gray-900 dark:text-white">قائمة الدخل</h1>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {store?.name || 'المتجر'} — من {from.toLocaleDateString('ar-SA')} إلى {to.toLocaleDateString('ar-SA')}
                  </p>
                </div>
              </div>

              {/* Period filter */}
              <div className="mt-5 flex flex-wrap gap-2 no-print">
                {PERIOD_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPeriodPreset(p.id)}
                    className={`no-print rounded-xl px-3.5 py-2 text-xs font-black transition-all ${
                      periodPreset === p.id
                        ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25'
                        : 'border border-gray-200 dark:border-white/10 bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {periodPreset === 'custom' && (
                <div className="mt-3 flex flex-wrap items-center gap-3 no-print">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="no-print rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 py-2 text-xs text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                  <span className="text-gray-500 dark:text-gray-500 text-xs">إلى</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="no-print rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 py-2 text-xs text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>
              )}
            </div>

            {!loading && (
              <>
                {/* KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className={`${glassCard} ${kpiCardHover} p-5 border-l-4 border-l-indigo-500`}>
                  <div className={kpiShimmer} aria-hidden />
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 text-indigo-400 mb-2">
                      <DollarSign size={18} />
                      <span className="text-xs font-bold">الإيرادات الإجمالية</span>
                    </div>
                    <p className="text-2xl font-black text-indigo-600 dark:text-indigo-300" dir="ltr">{formatShekel(metrics.netRevenue)}</p>
                  </div>
                </div>
                <div className={`${glassCard} ${kpiCardHover} p-5 border-l-4 border-l-violet-500`}>
                  <div className={kpiShimmer} aria-hidden />
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 text-violet-400 mb-2">
                      <Receipt size={18} />
                      <span className="text-xs font-bold">تكلفة البضاعة المباعة</span>
                    </div>
                    <p className="text-2xl font-black text-violet-600 dark:text-violet-300" dir="ltr">{formatShekel(metrics.cogs)}</p>
                  </div>
                </div>
                <div className={`${glassCard} ${kpiCardHover} p-5 border-l-4 border-l-rose-500`}>
                  <div className={kpiShimmer} aria-hidden />
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 text-rose-400 mb-2">
                      <TrendingDown size={18} />
                      <span className="text-xs font-bold">إجمالي المصاريف</span>
                    </div>
                    <p className="text-2xl font-black text-rose-600 dark:text-rose-300" dir="ltr">{formatShekel(metrics.totalExpenses)}</p>
                  </div>
                </div>
                <div className={`${glassCard} ${kpiCardHover} p-5 border-l-4 ${metrics.netProfit >= 0 ? 'border-l-emerald-500' : 'border-l-rose-500'}`}>
                  <div className={kpiShimmer} aria-hidden />
                  <div className="relative z-10">
                    <div className={`flex items-center gap-2 mb-2 ${metrics.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      <TrendingUp size={18} />
                      <span className="text-xs font-bold">صافي الربح</span>
                    </div>
                    <p className={`text-2xl font-black ${metrics.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`} dir="ltr">
                      {formatShekel(metrics.netProfit)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Income Statement Table */}
              <div className={`${glassCard} p-6`}>
                <h2 className="text-sm font-black text-gray-900 dark:text-white mb-4">قائمة الدخل التفصيلية</h2>
                <div className="divide-y divide-gray-200 dark:divide-white/10">
                  <div className="pb-3 mb-1">
                    <p className="text-xs font-black text-indigo-400 uppercase tracking-wider mb-2">الإيرادات</p>
                    <StatementRow label="إيرادات المبيعات" value={metrics.grossSales} indent />
                    <StatementRow label="المرتجعات والخصومات" value={metrics.deductions} indent negative />
                    <StatementRow label="صافي الإيرادات" value={metrics.netRevenue} bold />
                  </div>

                  <div className="py-3">
                    <p className="text-xs font-black text-violet-400 uppercase tracking-wider mb-2">تكلفة البضاعة المباعة</p>
                    <StatementRow label="تكلفة المبيعات" value={metrics.cogs} indent negative />
                    <StatementRow label="مجمل الربح" value={metrics.grossProfit} bold />
                    <StatementRow label="هامش مجمل الربح %" value={`${metrics.grossMargin.toLocaleString('en-US')}%`} indent raw />
                  </div>

                  <div className="py-3">
                    <p className="text-xs font-black text-rose-400 uppercase tracking-wider mb-2">المصاريف التشغيلية</p>
                    {sortedCategories.length === 0 ? (
                      <p className="text-sm text-gray-500 dark:text-gray-500 pr-4 py-2">لا توجد مصاريف مسجّلة في هذه الفترة</p>
                    ) : (
                      sortedCategories.map(([cat, amt]) => (
                        <StatementRow
                          key={cat}
                          label={CAT_LABELS[cat] || cat}
                          value={amt}
                          indent
                          negative
                        />
                      ))
                    )}
                    <StatementRow label="إجمالي المصاريف" value={metrics.totalExpenses} bold negative />
                  </div>

                  <div className="pt-4">
                    <StatementRow
                      label="صافي الربح / الخسارة"
                      value={metrics.netProfit}
                      bold
                      highlight
                    />
                  </div>
                </div>
              </div>
              </>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-20 no-print">
              <Loader2 className="animate-spin text-indigo-400" size={36} />
            </div>
          ) : (
            <>
              {/* Chart */}
              <div className={`${glassCard} p-6 no-print`}>
                <div className="flex items-center gap-2 mb-4">
                  <BarChart2 size={18} className="text-indigo-400" />
                  <h2 className="text-sm font-black text-gray-900 dark:text-white">مقارنة شهرية: الإيرادات vs المصاريف vs الربح</h2>
                </div>
                {monthlyChart.length === 0 ? (
                  <p className="text-center text-sm text-gray-500 dark:text-gray-500 py-12">لا توجد بيانات كافية للرسم البياني</p>
                ) : (
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={monthlyChart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.9} />
                            <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.6} />
                          </linearGradient>
                          <linearGradient id="gradExpense" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.9} />
                            <stop offset="100%" stopColor="#e11d48" stopOpacity={0.6} />
                          </linearGradient>
                          <linearGradient id="gradProfit" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.9} />
                            <stop offset="100%" stopColor="#059669" stopOpacity={0.6} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => v.toLocaleString('en-US')} />
                        <Tooltip
                          contentStyle={{
                            background: 'rgba(15,23,42,0.95)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '12px',
                            backdropFilter: 'blur(10px)',
                          }}
                        />
                        <Legend wrapperStyle={{ paddingTop: '16px', fontSize: '13px' }} />
                        <Bar dataKey="revenue" name="الإيرادات" fill="url(#gradRevenue)" radius={[6, 6, 0, 0]} />
                        <Bar dataKey="expenses" name="المصاريف" fill="url(#gradExpense)" radius={[6, 6, 0, 0]} />
                        <Bar dataKey="profit" name="صافي الربح" fill="url(#gradProfit)" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Expenses management */}
              <div className={`${glassCard} p-6 no-print`}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <h2 className="text-sm font-black text-gray-900 dark:text-white">إدارة المصاريف</h2>
                  <button
                    type="button"
                    onClick={() => setShowModal(true)}
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-500 transition-colors"
                  >
                    <Plus size={14} />
                    إضافة مصروف
                  </button>
                </div>

                <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-white/10 text-gray-600 dark:text-slate-400 text-xs">
                        <th className="text-right py-3 px-4 font-semibold">التاريخ</th>
                        <th className="text-right py-3 px-4 font-semibold">الفئة</th>
                        <th className="text-right py-3 px-4 font-semibold">الوصف</th>
                        <th className="text-right py-3 px-4 font-semibold">المبلغ</th>
                        <th className="text-center py-3 px-4 font-semibold w-16">حذف</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expensesList.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-10 text-center text-gray-500 dark:text-gray-500 text-sm">
                            لا توجد مصاريف في هذه الفترة
                          </td>
                        </tr>
                      ) : (
                        expensesList.map((row) => (
                          <tr key={row.id} className="border-b border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                            <td className="py-3 px-4 text-gray-700 dark:text-slate-300 text-xs">
                              {row.expense_date
                                ? new Date(row.expense_date).toLocaleDateString('ar-SA')
                                : '—'}
                            </td>
                            <td className="py-3 px-4 text-gray-700 dark:text-slate-300 text-xs">{CAT_LABELS[row.category] || row.category || '—'}</td>
                            <td className="py-3 px-4 text-gray-500 dark:text-slate-400 text-xs max-w-[200px] truncate">{row.description || '—'}</td>
                            <td className="py-3 px-4 font-black text-rose-600 dark:text-rose-300 text-xs" dir="ltr">{formatShekel(row.amount)}</td>
                            <td className="py-3 px-4 text-center">
                              <button
                                type="button"
                                disabled={deletingId === row.id}
                                onClick={() => handleDeleteExpense(row.id)}
                                className="inline-flex items-center justify-center rounded-lg p-1.5 text-rose-400 hover:bg-rose-500/10 disabled:opacity-40"
                              >
                                {deletingId === row.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Add expense modal */}
      {showModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm no-print">
          <div className={`${glassCard} w-full max-w-md p-6 bg-white dark:bg-[#0f1629]`} dir="rtl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-black text-gray-900 dark:text-white">إضافة مصروف</h3>
              <button type="button" onClick={() => setShowModal(false)} className="text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddExpense} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-600 dark:text-slate-400 block mb-1.5">الفئة</label>
                <select
                  value={expForm.category}
                  onChange={(e) => setExpForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 py-2.5 text-sm text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 dark:text-slate-400 block mb-1.5">الوصف</label>
                <input
                  type="text"
                  value={expForm.description}
                  onChange={(e) => setExpForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="وصف المصروف (اختياري)"
                  className="w-full rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 py-2.5 text-sm text-gray-800 dark:text-slate-200 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 dark:text-slate-400 block mb-1.5">المبلغ (₪)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={expForm.amount}
                  onChange={(e) => setExpForm((f) => ({ ...f, amount: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 py-2.5 text-sm text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 dark:text-slate-400 block mb-1.5">التاريخ</label>
                <input
                  type="date"
                  value={expForm.expense_date}
                  onChange={(e) => setExpForm((f) => ({ ...f, expense_date: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 py-2.5 text-sm text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  required
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-black text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : null}
                  حفظ
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-gray-200 dark:border-white/10 px-4 py-2.5 text-sm font-bold text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-white/5"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
