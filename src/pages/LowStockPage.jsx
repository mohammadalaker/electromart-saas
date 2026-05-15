import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  PackageMinus,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  XCircle,
  Settings2,
  Search,
  Download,
  ShoppingBag,
  TrendingDown,
  CheckCircle2,
  Filter,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import DashboardLayout from '../components/DashboardLayout';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';

import { brandStorageKey } from '../constants/brand.js';

const THRESHOLD_KEY = brandStorageKey('low-stock-threshold');

function getThreshold() {
  try { return Math.max(1, parseInt(localStorage.getItem(THRESHOLD_KEY) || '5', 10)) || 5; }
  catch { return 5; }
}
function saveThreshold(v) {
  try { localStorage.setItem(THRESHOLD_KEY, String(v)); } catch {}
}

function stockLevel(stock, threshold) {
  if (stock <= 0) return 'out';
  if (stock <= Math.ceil(threshold / 3)) return 'critical';
  return 'low';
}

const LEVEL_CONFIG = {
  out:      { label: 'نفد المخزون', bg: 'bg-rose-50 dark:bg-rose-950/20', border: 'border-l-rose-500', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300', icon: XCircle, iconColor: 'text-rose-500' },
  critical: { label: 'حرج جداً',   bg: 'bg-orange-50 dark:bg-orange-950/20', border: 'border-l-orange-500', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300', icon: AlertCircle, iconColor: 'text-orange-500' },
  low:      { label: 'منخفض',      bg: 'bg-amber-50 dark:bg-amber-950/20',  border: 'border-l-amber-400',  badge: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',  icon: AlertTriangle, iconColor: 'text-amber-500' },
};

export default function LowStockPage() {
  const { store, loading: storeLoading } = useStore();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(getThreshold);
  const [thresholdInput, setThresholdInput] = useState(String(getThreshold()));
  const [showSettings, setShowSettings] = useState(false);
  const [search, setSearch] = useState('');
  const [filterLevel, setFilterLevel] = useState('all');

  const fetchItems = useCallback(async () => {
    if (!store?.id) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from(PRODUCTS_TABLE)
        .select('id, eng_name, barcode, stock_count, brand_group, full_price, reference')
        .eq('store_id', store.id)
        .lt('stock_count', threshold)
        .order('stock_count', { ascending: true })
        .limit(500);
      if (!error) setItems(data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [store?.id, threshold]);

  useEffect(() => {
    if (!storeLoading) fetchItems();
  }, [storeLoading, fetchItems]);

  const applyThreshold = () => {
    const n = Math.max(1, Math.min(9999, parseInt(thresholdInput, 10) || 5));
    setThreshold(n);
    setThresholdInput(String(n));
    saveThreshold(n);
    setShowSettings(false);
  };

  const filtered = useMemo(() => {
    let res = items;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      res = res.filter(i => (i.eng_name || '').toLowerCase().includes(q) || String(i.barcode || '').includes(q) || (i.brand_group || '').toLowerCase().includes(q));
    }
    if (filterLevel !== 'all') {
      res = res.filter(i => stockLevel(i.stock_count, threshold) === filterLevel);
    }
    return res;
  }, [items, search, filterLevel, threshold]);

  const counts = useMemo(() => ({
    out: items.filter(i => i.stock_count <= 0).length,
    critical: items.filter(i => i.stock_count > 0 && i.stock_count <= Math.ceil(threshold / 3)).length,
    low: items.filter(i => i.stock_count > Math.ceil(threshold / 3) && i.stock_count < threshold).length,
  }), [items, threshold]);

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('مخزون منخفض', { views: [{ rightToLeft: true }] });
    const headerRow = ws.addRow(['الصنف', 'الباركود', 'المجموعة', 'المخزون الحالي', 'الحالة', 'السعر']);
    headerRow.eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFdc2626' } };
    });
    filtered.forEach(i => {
      ws.addRow([i.eng_name || '—', i.barcode || '—', i.brand_group || '—', i.stock_count ?? 0, LEVEL_CONFIG[stockLevel(i.stock_count, threshold)].label, i.full_price ?? 0]);
    });
    ws.columns.forEach(c => { c.width = 20; });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'مخزون-منخفض.xlsx'; a.click();
    URL.revokeObjectURL(url);
  };

  if (storeLoading) return (
    <DashboardLayout><div className="flex justify-center py-24"><Loader2 className="animate-spin text-indigo-500" size={40} /></div></DashboardLayout>
  );

  return (
    <DashboardLayout
      actions={
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowSettings(s => !s)}
            className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-bold shadow-sm transition-all ${showSettings ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700/50 dark:bg-indigo-950/30 dark:text-indigo-300' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200'}`}>
            <Settings2 size={16} />
            الحد = {threshold}
          </button>
          <button type="button" onClick={fetchItems} disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-all dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            تحديث
          </button>
          <button type="button" onClick={exportExcel} disabled={filtered.length === 0}
            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-black text-emerald-800 shadow-sm hover:bg-emerald-100 disabled:opacity-40 transition-all dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-200">
            <Download size={16} />
            تصدير Excel
          </button>
        </div>
      }
    >
      <div className="space-y-5 max-w-5xl mx-auto" dir="rtl">

        {/* Threshold settings panel */}
        {showSettings && (
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-800/40 dark:bg-indigo-950/20 flex flex-wrap items-end gap-4">
            <div>
              <label className="text-xs font-black text-indigo-800 dark:text-indigo-200 block mb-2">حد المخزون المنخفض (أقل من)</label>
              <div className="flex items-center gap-3">
                <input type="range" min={1} max={50} value={thresholdInput} onChange={e => setThresholdInput(e.target.value)}
                  className="w-40 accent-indigo-600" />
                <input type="number" min={1} max={9999} value={thresholdInput} onChange={e => setThresholdInput(e.target.value)}
                  className="w-20 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-black text-indigo-700 text-center focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-indigo-700/50 dark:bg-slate-800 dark:text-indigo-300" />
                <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300">قطعة</span>
              </div>
            </div>
            <button type="button" onClick={applyThreshold}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white hover:bg-indigo-700 transition-colors shadow-md">
              <CheckCircle2 size={16} />
              تطبيق
            </button>
            <p className="text-[11px] text-indigo-600/70 dark:text-indigo-400/70 self-center">
              حالياً: أي منتج مخزونه أقل من {threshold} يظهر هنا. يُحفظ تلقائياً.
            </p>
          </div>
        )}

        {/* Header card */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-[0_4px_32px_-8px_rgba(15,23,42,0.10)] overflow-hidden dark:border-gray-700/50 dark:bg-gray-900/70">
          <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-l from-rose-50/50 to-white flex flex-wrap items-center justify-between gap-3 dark:border-slate-700/60 dark:from-rose-950/20 dark:to-gray-900/90">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-500 text-white shadow-md">
                <PackageMinus size={22} />
              </div>
              <div>
                <h1 className="text-lg font-black text-slate-900 dark:text-white">تنبيهات المخزون المنخفض</h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">المنتجات التي مخزونها أقل من {threshold} قطعة</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['out', 'critical', 'low'] ).map(lvl => {
                const cfg = LEVEL_CONFIG[lvl];
                const Icon = cfg.icon;
                return (
                  <button key={lvl} type="button" onClick={() => setFilterLevel(f => f === lvl ? 'all' : lvl)}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-black transition-all ${filterLevel === lvl ? cfg.badge + ' border-current shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-400'}`}>
                    <Icon size={13} />
                    {cfg.label}
                    <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[9px] font-black ${filterLevel === lvl ? 'bg-white/50' : 'bg-slate-100 dark:bg-slate-800'}`}>
                      {counts[lvl]}
                    </span>
                  </button>
                );
              })}
              {filterLevel !== 'all' && (
                <button type="button" onClick={() => setFilterLevel('all')} className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
                  <Filter size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Search */}
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/60">
            <div className="relative max-w-sm">
              <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="بحث باسم المنتج أو الباركود…"
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-900 text-slate-800 dark:text-slate-100 text-xs py-2 pr-8 pl-3 placeholder:text-slate-400 focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20 transition-shadow" />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="bg-gradient-to-r from-rose-50/80 to-transparent text-slate-700 border-b border-slate-200/70 dark:from-rose-950/30 dark:to-transparent dark:text-slate-200 dark:border-slate-700/60">
                  <th className="text-right py-3.5 px-5 font-semibold">الصنف</th>
                  <th className="text-right py-3.5 px-4 font-semibold w-32">الباركود</th>
                  <th className="text-right py-3.5 px-4 font-semibold w-32">المجموعة</th>
                  <th className="text-center py-3.5 px-4 font-semibold w-28">المخزون</th>
                  <th className="text-center py-3.5 px-4 font-semibold w-28">الحالة</th>
                  <th className="text-center py-3.5 px-4 font-semibold w-28">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="py-20 text-center"><Loader2 className="inline animate-spin text-rose-500" size={36} /></td></tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center">
                      <div className="inline-flex flex-col items-center gap-3 px-8 py-8 rounded-2xl bg-gradient-to-b from-emerald-50/60 to-transparent dark:from-emerald-950/20 dark:to-transparent">
                        <CheckCircle2 className="text-emerald-400 dark:text-emerald-600" size={56} />
                        <p className="font-black text-slate-600 dark:text-slate-300">
                          {items.length === 0 ? '🎉 جميع المنتجات فوق الحد المحدد!' : 'لا توجد نتائج مطابقة'}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">الحد الحالي: {threshold} قطعة</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((item, idx) => {
                    const lvl = stockLevel(item.stock_count, threshold);
                    const cfg = LEVEL_CONFIG[lvl];
                    const Icon = cfg.icon;
                    return (
                      <tr key={item.id}
                        className={`border-b border-slate-100/70 dark:border-slate-700/40 transition-colors hover:bg-rose-50/40 dark:hover:bg-rose-950/15 border-r-0 border-l-[3px] ${cfg.border} ${idx % 2 === 0 ? 'bg-white dark:bg-slate-900/50' : 'bg-slate-50/40 dark:bg-slate-800/30'}`}>
                        <td className="py-3.5 px-5">
                          <p className="font-bold text-slate-900 dark:text-white text-sm">{item.eng_name || '—'}</p>
                          {item.reference && <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{item.reference}</p>}
                        </td>
                        <td className="py-3.5 px-4 text-xs font-currency text-slate-500 dark:text-slate-400" dir="ltr">{item.barcode || '—'}</td>
                        <td className="py-3.5 px-4 text-xs text-slate-600 dark:text-slate-300">{item.brand_group || '—'}</td>
                        <td className="py-3.5 px-4 text-center">
                          <span className={`inline-flex items-center justify-center h-9 w-9 rounded-xl text-lg font-black ${
                            lvl === 'out' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' :
                            lvl === 'critical' ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300' :
                            'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                          }`} dir="ltr">
                            {item.stock_count ?? 0}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span className={`inline-flex items-center gap-1 rounded-full border-l-[3px] ${cfg.border} px-2.5 py-0.5 text-[10px] font-black ${cfg.badge}`}>
                            <Icon size={9} />
                            {cfg.label}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <Link to="/purchases" className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-black text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800/40 dark:bg-indigo-950/30 dark:text-indigo-300 transition-colors">
                            <ShoppingBag size={12} />
                            أمر شراء
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {filtered.length > 0 && !loading && (
            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {filtered.length} منتج يحتاج تعبئة
              </p>
              <Link to="/purchases/rfq" className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white hover:bg-rose-700 transition-colors shadow-sm">
                <TrendingDown size={14} />
                إنشاء طلب شراء للكل
              </Link>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
