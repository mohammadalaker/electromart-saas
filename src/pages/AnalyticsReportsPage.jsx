import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, LineChart, TrendingUp, Package, ShoppingCart, Info, PieChart as PieChartIcon, BarChart2 } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { normalizeItemFromSupabase, roundMoney, runProductsSelectWithFallback } from '../utils/productModel';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';

const PURCHASES_TABLE = 'store_purchases';
const SALES_TABLE = 'sales';
const SHEKEL = '\u20AA';

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#10b981', '#14b8a6', '#0ea5e9'];

function formatMoney(n) {
  return roundMoney(Number(n ?? 0)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseLineItems(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }
  return [];
}

const CustomTooltip = ({ active, payload, label, prefix = '' }) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-xl border border-slate-200/80 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-[#18181b]/95" dir="rtl">
        <p className="text-[12px] font-bold text-slate-500 mb-2">{label}</p>
        <div className="space-y-1.5">
          {payload.map((entry, index) => (
            <div key={index} className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-md" style={{ backgroundColor: entry.color }} />
              <span className="text-[13px] font-bold text-slate-700 dark:text-slate-200">
                {entry.name}
              </span>
              <span className="flex-1 text-left font-mono text-[14px] font-black text-slate-900 dark:text-white" dir="ltr">
                {prefix}{typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

const TruncatedTick = ({ x, y, payload }) => {
  const raw = payload?.value ?? '';
  const text = raw.length > 24 ? raw.slice(0, 24) + '…' : raw;
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fill="#6b7280"
      fontSize={11}
    >
      {text}
    </text>
  );
};

export default function AnalyticsReportsPage() {
  const { store, loading: storeLoading } = useStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('sales');

  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30); // Default to last 30 days
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [salesRows, setSalesRows] = useState([]);
  const [purchaseRows, setPurchaseRows] = useState([]);
  const [productsMap, setProductsMap] = useState(() => new Map());

  const loadData = useCallback(async () => {
    if (!store?.id) return;
    setLoading(true);
    setError(null);
    try {
      const start = new Date(fromDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);

      const [
        { data: pData, error: pErr },
        { data: sData, error: sErr },
        { data: purData, error: purErr }
      ] = await Promise.all([
        runProductsSelectWithFallback((sel) =>
          supabase.from(PRODUCTS_TABLE).select(sel).eq('store_id', store.id)
        ),
        supabase
          .from(SALES_TABLE)
          .select('id, created_at, line_items, total_amount')
          .eq('store_id', store.id)
          .gte('created_at', start.toISOString())
          .lte('created_at', end.toISOString())
          .order('created_at', { ascending: false })
          .limit(10000),
        supabase
          .from(PURCHASES_TABLE)
          .select('id, created_at, total_amount')
          .eq('store_id', store.id)
          .gte('created_at', start.toISOString())
          .lte('created_at', end.toISOString())
          .order('created_at', { ascending: false })
          .limit(10000)
      ]);

      if (pErr) throw pErr;
      if (sErr) throw sErr;
      if (purErr) {
        if (!/does not exist|schema cache/i.test(purErr.message)) throw purErr;
      }

      const m = new Map();
      for (const row of pData || []) {
        const it = normalizeItemFromSupabase(row);
        if (it) {
           m.set(String(it.id), it);
           if (it.barcode) m.set(`b:${it.barcode}`, it);
        }
      }
      setProductsMap(m);
      setSalesRows(sData || []);
      setPurchaseRows(purData || []);

    } catch (e) {
      console.error(e);
      setError(e.message || 'حدث خطأ أثناء سحب بيانات التحليل.');
    } finally {
      setLoading(false);
    }
  }, [store?.id, fromDate, toDate]);

  useEffect(() => {
    if (storeLoading) return;
    loadData();
  }, [storeLoading, loadData]);

  // -------- PROCESS SALES DATA --------
  const salesAnalytics = useMemo(() => {
    const dailyMap = {};
    const productSalesMap = {};
    let totalSales = 0;

    salesRows.forEach(sale => {
      const date = new Date(sale.created_at).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
      dailyMap[date] = (dailyMap[date] || 0) + Number(sale.total_amount || 0);
      totalSales += Number(sale.total_amount || 0);

      const lines = parseLineItems(sale.line_items);
      lines.forEach(line => {
        const id = line.product_id ? String(line.product_id) : `b:${line.barcode}`;
        const lookedUp =
          (line.product_id && productsMap.get(String(line.product_id))?.name) ||
          (line.barcode && productsMap.get(`b:${line.barcode}`)?.name) ||
          null;
        const name = line.product_name || line.name || lookedUp || 'غير معروف';
        const qty = Number(line.qty || 0);
        const amount = Number(line.line_total || (line.unit_price * qty));
        
        if (!productSalesMap[id]) {
            productSalesMap[id] = { name, qty: 0, revenue: 0 };
        }
        productSalesMap[id].qty += qty;
        productSalesMap[id].revenue += amount;
      });
    });

    const dailySalesArray = Object.keys(dailyMap).map(date => ({ label: date, المبيعات: dailyMap[date] })).reverse();
    
    const topProducts = Object.values(productSalesMap)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

    return { dailySalesArray, topProducts, totalSales };
  }, [salesRows, productsMap]);

  // -------- PROCESS PURCHASES DATA --------
  const purchaseAnalytics = useMemo(() => {
    const dailyMap = {};
    let totalPurchases = 0;

    purchaseRows.forEach(pur => {
      const date = new Date(pur.created_at).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
      dailyMap[date] = (dailyMap[date] || 0) + Number(pur.total_amount || 0);
      totalPurchases += Number(pur.total_amount || 0);
    });

    const dailyPurArray = Object.keys(dailyMap).map(date => ({ label: date, المشتريات: dailyMap[date] })).reverse();
    return { dailyPurArray, totalPurchases };
  }, [purchaseRows]);

  // -------- PROCESS INVENTORY DATA --------
  const inventoryAnalytics = useMemo(() => {
    let totalCapital = 0;
    const itemsByCapital = [];
    let inStockVal = 0;
    let outOfStockCount = 0;
    let lowStockCount = 0;
    let goodStockCount = 0;

    // To prevent duplicate barcode handling, iterate only true IDs:
    const uniqueItems = Array.from(productsMap.values()).filter(it => !it.id.startsWith('b:'));

    uniqueItems.forEach(it => {
        const stock = Number(it.stock || 0);
        const priceCost = Number(it.price || 0); 
        
        if (stock === 0) outOfStockCount++;
        else if (stock < 5) lowStockCount++;
        else goodStockCount++;

        const capital = stock > 0 ? stock * priceCost : 0;
        totalCapital += capital;
        
        if (capital > 0) {
            itemsByCapital.push({ name: it.name, رأس_المال: capital, stock: stock });
        }
    });

    itemsByCapital.sort((a, b) => b.رأس_المال - a.رأس_المال);

    const stockStatusData = [
        { name: 'متوفر', value: goodStockCount, color: '#10b981' },
        { name: 'قارب على الانتهاء', value: lowStockCount, color: '#f59e0b' },
        { name: 'نفذ من المخزون', value: outOfStockCount, color: '#f43f5e' },
    ];

    return { totalCapital, topCapitalItems: itemsByCapital.slice(0, 10), stockStatusData };
  }, [productsMap]);


  if (storeLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-32"><Loader2 className="animate-spin text-indigo-500" size={40} /></div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="w-full mx-auto space-y-6 pb-12" dir="rtl">
        {/* Header & Controls */}
        <div className="rounded-[20px] bg-white border border-slate-200/80 shadow-sm dark:bg-[#18181b] dark:border-white/[0.04] p-6 lg:p-8">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div>
                    <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-3">
                        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                           <LineChart size={24} strokeWidth={2.5} />
                        </span>
                        تحليل الأداء التفاعلي
                    </h1>
                    <p className="text-[13px] font-bold text-slate-500 dark:text-slate-400 mt-2">
                        استخرج تحليلات عميقة حول حركة المبيعات، المشتريات، وتوزيع رأس المال الخاص بالمخزون.
                    </p>
                </div>
                
                <div className="flex flex-wrap items-end gap-3 bg-slate-50 dark:bg-white/[0.02] p-4 rounded-2xl border border-slate-100 dark:border-white/[0.03]">
                    <div>
                        <label className="block text-[11px] font-black text-slate-500 mb-1.5 px-1">من تاريخ</label>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                            className="w-36 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[13px] font-bold text-slate-800 dark:border-white/10 dark:bg-[#18181b] dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        />
                    </div>
                    <div>
                        <label className="block text-[11px] font-black text-slate-500 mb-1.5 px-1">إلى تاريخ</label>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                            className="w-36 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[13px] font-bold text-slate-800 dark:border-white/10 dark:bg-[#18181b] dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        />
                    </div>
                    <button
                        onClick={loadData}
                        disabled={loading}
                        className="rounded-xl bg-indigo-600 text-white px-5 py-2.5 text-[13px] font-black shadow-md shadow-indigo-600/20 hover:bg-indigo-700 transition-colors flex items-center gap-2"
                    >
                        تحديث التحليل
                    </button>
                </div>
            </div>
            
            {/* TABS */}
            <div className="flex items-center gap-2 mt-8">
                {[
                    { id: 'sales', label: 'المبيعات', icon: TrendingUp },
                    { id: 'purchases', label: 'المشتريات', icon: ShoppingCart },
                    { id: 'inventory', label: 'المخزون', icon: Package },
                ].map(tab => {
                    const active = activeTab === tab.id;
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 text-[14px] transition-all ${
                                active
                                  ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl px-4 py-2 font-semibold'
                                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-xl px-4 py-2 transition-colors'
                            }`}
                        >
                            <Icon size={18} strokeWidth={active ? 2.5 : 2} />
                            {tab.label}
                        </button>
                    )
                })}
            </div>
        </div>

        {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
                {error}
            </div>
        )}

        {loading ? (
            <div className="flex justify-center items-center py-24"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>
        ) : (
            <div className="space-y-6">
                
                {/* 1. SALES ANALYTICS */}
                {activeTab === 'sales' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                       {/* Sales Top Metric */}
                       <div className="rounded-[20px] bg-white border border-slate-200/80 shadow-sm dark:bg-[#18181b] dark:border-white/[0.04] p-6 lg:col-span-3 flex flex-col md:flex-row items-center gap-6 justify-between transition-all duration-300 ease-out hover:shadow-md dark:hover:shadow-xl hover:-translate-y-0.5 relative overflow-hidden">
                           <div className="pointer-events-none absolute left-0 top-0 h-full w-1/3 bg-gradient-to-r from-indigo-500/5 to-transparent"></div>
                           <div>
                               <p className="text-[12px] font-black text-slate-500 dark:text-slate-400 mb-1">إجمالي المبيعات المحققة (في الفترة)</p>
                               <p className="font-mono text-3xl font-black text-indigo-600 dark:text-indigo-400" dir="ltr">{SHEKEL}{formatMoney(salesAnalytics.totalSales)}</p>
                           </div>
                           <div className="flex items-center gap-3 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-2.5 rounded-xl border border-emerald-100 dark:border-emerald-500/20">
                               <BarChart2 className="text-emerald-500" size={20} />
                               <span className="text-[13px] font-bold text-emerald-700 dark:text-emerald-300">
                                   إجمالي فواتير الفترة: {salesRows.length}
                               </span>
                           </div>
                       </div>

                       {/* Area Chart: Sales Flow */}
                       <div className="rounded-[20px] bg-white border border-slate-200/80 shadow-sm dark:bg-[#18181b] dark:border-white/[0.04] p-6 lg:col-span-2">
                           <h2 className="text-[15px] font-black text-slate-900 dark:text-white mb-6">اتجاه المبيعات الزمني</h2>
                           {salesAnalytics.dailySalesArray.length === 0 ? (
                               <div className="h-[300px] flex items-center justify-center text-slate-400">لا توجد بيانات للفترة المحددة</div>
                           ) : (
                               <div className="h-[300px] w-full" dir="ltr">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={salesAnalytics.dailySalesArray} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                                      <defs>
                                        <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                                          <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35}/>
                                          <stop offset="50%" stopColor="#6366f1" stopOpacity={0.15}/>
                                          <stop offset="100%" stopColor="#4f46e5" stopOpacity={0}/>
                                        </linearGradient>
                                      </defs>
                                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
                                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#888891', fontWeight: 600 }} dy={10} />
                                      <YAxis hide domain={[0, 'dataMax']} />
                                      <Tooltip content={<CustomTooltip prefix={SHEKEL} />} cursor={{ stroke: '#52525b', strokeWidth: 1, strokeDasharray: '4 4' }} />
                                      <Area
                                        type="monotone"
                                        dataKey="المبيعات"
                                        stroke="#6366f1"
                                        strokeWidth={3}
                                        fillOpacity={1}
                                        fill="url(#salesGrad)"
                                        dot={false}
                                        activeDot={{ r: 5, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }}
                                        animationDuration={800}
                                        animationEasing="ease-out"
                                      />
                                    </AreaChart>
                                  </ResponsiveContainer>
                               </div>
                           )}
                       </div>

                       {/* Bar Chart: Top Products */}
                       <div className="rounded-[20px] bg-white border border-slate-200/80 shadow-sm dark:bg-[#18181b] dark:border-white/[0.04] p-6">
                           <h2 className="text-[15px] font-black text-slate-900 dark:text-white mb-6">أكثر الأصناف مبيعاً (قيمة)</h2>
                           {salesAnalytics.topProducts.length === 0 ? (
                               <div className="h-[300px] flex items-center justify-center text-slate-400">لا توجد مبيعات أصناف</div>
                           ) : (
                               <div className="h-[300px] w-full" dir="ltr">
                                  <ResponsiveContainer width="100%" height="100%">
                                     <BarChart data={salesAnalytics.topProducts} layout="vertical" margin={{ top: 0, right: 0, left: 30, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} className="text-slate-100 dark:text-slate-800" />
                                        <XAxis type="number" hide />
                                        <YAxis
                                          dataKey="name"
                                          type="category"
                                          width={150}
                                          tick={{ fontSize: 11, fill: '#6b7280' }}
                                          tickFormatter={(value) => {
                                            if (!value) return value;
                                            return value.length > 22 ? '\u2026' + value.slice(0, 22) : value;
                                          }}
                                          axisLine={false}
                                          tickLine={false}
                                        />
                                        <Tooltip
                                          content={<CustomTooltip prefix={SHEKEL} />}
                                          contentStyle={{ background: 'rgba(255,255,255,0.98)', border: '1px solid #e5e7eb', borderRadius: '12px', fontSize: '12px' }}
                                          cursor={{ fill: 'var(--tw-colors-slate-100)', opacity: 0.1 }}
                                        />
                                        <Bar dataKey="revenue" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={20} name="العائد" />
                                     </BarChart>
                                  </ResponsiveContainer>
                               </div>
                           )}
                       </div>
                    </div>
                )}

                {/* 2. PURCHASES ANALYTICS */}
                {activeTab === 'purchases' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                       {/* Top Metric */}
                       <div className="rounded-[20px] bg-white border border-slate-200/80 shadow-sm dark:bg-[#18181b] dark:border-white/[0.04] p-6 lg:col-span-3 flex flex-col md:flex-row items-center gap-6 justify-between transition-all duration-300 ease-out hover:shadow-md dark:hover:shadow-xl hover:-translate-y-0.5 relative overflow-hidden">
                           <div className="pointer-events-none absolute left-0 top-0 h-full w-1/3 bg-gradient-to-r from-rose-500/5 to-transparent"></div>
                           <div>
                               <p className="text-[12px] font-black text-slate-500 dark:text-slate-400 mb-1">إجمالي مشتريات البضاعة (في الفترة)</p>
                               <p className="font-mono text-3xl font-black text-rose-600 dark:text-rose-400" dir="ltr">{SHEKEL}{formatMoney(purchaseAnalytics.totalPurchases)}</p>
                           </div>
                           <div className="flex items-center gap-3 bg-rose-50 dark:bg-rose-500/10 px-4 py-2.5 rounded-xl border border-rose-100 dark:border-rose-500/20">
                               <Package className="text-rose-500" size={20} />
                               <span className="text-[13px] font-bold text-rose-700 dark:text-rose-300">
                                   عدد فواتير الشراء: {purchaseRows.length}
                               </span>
                           </div>
                       </div>

                       {/* Area Chart: Purchases Flow */}
                       <div className="rounded-[20px] bg-white border border-slate-200/80 shadow-sm dark:bg-[#18181b] dark:border-white/[0.04] p-6 lg:col-span-3">
                           <h2 className="text-[15px] font-black text-slate-900 dark:text-white mb-6">منحنى المشتريات الزمني</h2>
                           {purchaseAnalytics.dailyPurArray.length === 0 ? (
                               <div className="h-[300px] flex items-center justify-center text-slate-400">لا توجد مشتريات للفترة المحددة</div>
                           ) : (
                               <div className="h-[300px] w-full" dir="ltr">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={purchaseAnalytics.dailyPurArray} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                                      <defs>
                                        <linearGradient id="purGrad" x1="0" y1="0" x2="0" y2="1">
                                          <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4}/>
                                          <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                                        </linearGradient>
                                      </defs>
                                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
                                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#888891', fontWeight: 600 }} dy={10} />
                                      <YAxis hide domain={[0, 'dataMax']} />
                                      <Tooltip content={<CustomTooltip prefix={SHEKEL} />} cursor={{ stroke: '#52525b', strokeWidth: 1, strokeDasharray: '4 4' }} />
                                      <Area type="monotone" dataKey="المشتريات" stroke="#f43f5e" strokeWidth={3} fillOpacity={1} fill="url(#purGrad)" />
                                    </AreaChart>
                                  </ResponsiveContainer>
                               </div>
                           )}
                       </div>
                    </div>
                )}

                {/* 3. INVENTORY ANALYTICS */}
                {activeTab === 'inventory' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                       {/* Top Metric */}
                       <div className="rounded-[20px] bg-white border border-slate-200/80 shadow-sm dark:bg-[#18181b] dark:border-white/[0.04] p-6 lg:col-span-3 flex flex-col md:flex-row items-center gap-6 justify-between transition-all duration-300 ease-out hover:shadow-md dark:hover:shadow-xl hover:-translate-y-0.5 relative overflow-hidden">
                           <div className="pointer-events-none absolute left-0 top-0 h-full w-1/3 bg-gradient-to-r from-amber-500/5 to-transparent"></div>
                           <div>
                               <p className="text-[12px] font-black text-slate-500 dark:text-slate-400 mb-1">التقييم التقريبي لرأس المال في المخزون</p>
                               <p className="font-mono text-3xl font-black text-amber-600 dark:text-amber-400" dir="ltr">{SHEKEL}{formatMoney(inventoryAnalytics.totalCapital)}</p>
                           </div>
                           <div className="flex items-center gap-2 max-w-sm">
                               <Info size={16} className="text-amber-500" />
                               <p className="text-[10px] sm:text-[11px] font-bold text-slate-500 leading-snug">
                                   يتم حساب تقييم رأس المال بناءً على ضرب كمية كل صنف في (سعر التكلفة) الخاص به.
                               </p>
                           </div>
                       </div>

                       {/* Donut Chart: Inventory Status */}
                       <div className="rounded-[20px] bg-white border border-slate-200/80 shadow-sm dark:bg-[#18181b] dark:border-white/[0.04] p-6 flex flex-col items-center">
                           <div className="w-full mb-2">
                               <h2 className="text-[15px] font-black text-slate-900 dark:text-white">حالة المخزون (توزيع الأصناف)</h2>
                           </div>
                           <div className="w-full h-[240px] flex items-center justify-center mt-4">
                               <ResponsiveContainer width="100%" height="100%">
                                  <PieChart>
                                      <Pie
                                        data={inventoryAnalytics.stockStatusData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={65}
                                        outerRadius={90}
                                        paddingAngle={4}
                                        dataKey="value"
                                        stroke="transparent"
                                      >
                                          {inventoryAnalytics.stockStatusData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                          ))}
                                      </Pie>
                                      <Tooltip
                                        contentStyle={{ borderRadius: '12px', border: 'none', background: '#18181b', color: '#fff', fontSize: '13px', fontWeight: 'bold' }} 
                                        itemStyle={{ color: '#fff' }}
                                      />
                                  </PieChart>
                               </ResponsiveContainer>
                           </div>
                           <div className="flex flex-wrap w-full justify-center gap-4 mt-2">
                               {inventoryAnalytics.stockStatusData.map(st => (
                                   <div key={st.name} className="flex items-center gap-1.5">
                                       <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: st.color }}></span>
                                       <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">{st.name} <span className="font-mono mx-1">({st.value})</span></span>
                                   </div>
                               ))}
                           </div>
                       </div>

                       {/* Bar Chart: Top Capital Items */}
                       <div className="rounded-[20px] bg-white border border-slate-200/80 shadow-sm dark:bg-[#18181b] dark:border-white/[0.04] p-6 lg:col-span-2">
                           <h2 className="text-[15px] font-black text-slate-900 dark:text-white mb-6">أكبر الأصناف استحواذاً على رأس المال</h2>
                           {inventoryAnalytics.topCapitalItems.length === 0 ? (
                               <div className="h-[300px] flex items-center justify-center text-slate-400">لا توجد بيانات بضاعة متوفرة</div>
                           ) : (
                               <div className="h-[300px] w-full" dir="ltr">
                                  <ResponsiveContainer width="100%" height="100%">
                                     <BarChart data={inventoryAnalytics.topCapitalItems} layout="vertical" margin={{ top: 0, right: 0, left: 10, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} className="text-slate-100 dark:text-slate-800" />
                                        <XAxis type="number" hide />
                                        <YAxis
                                          dataKey="name"
                                          type="category"
                                          width={170}
                                          interval={0}
                                          tick={<TruncatedTick />}
                                          axisLine={false}
                                          tickLine={false}
                                        />
                                        <Tooltip
                                          content={<CustomTooltip prefix={SHEKEL} />}
                                          contentStyle={{ background: 'rgba(255,255,255,0.98)', border: '1px solid #e5e7eb', borderRadius: '12px', fontSize: '12px' }}
                                          cursor={{ fill: 'var(--tw-colors-slate-100)', opacity: 0.1 }}
                                        />
                                        <Bar dataKey="رأس_المال" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={22} />
                                     </BarChart>
                                  </ResponsiveContainer>
                               </div>
                           )}
                       </div>
                    </div>
                )}
            </div>
        )}
      </div>
    </DashboardLayout>
  );
}
