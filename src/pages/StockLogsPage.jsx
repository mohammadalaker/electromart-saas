import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  ClipboardList,
  RefreshCw,
  Calendar,
  User,
  Package,
  Tag,
  TrendingDown,
  TrendingUp,
  ArrowLeft,
  Filter,
  X,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';

const TABLE = 'inventory_logs';

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return String(iso);
  }
}

const REASON_AR = {
  sale: 'بيع',
  purchase: 'شراء',
  adjustment: 'تعديل',
  damaged: 'تالف',
  other: 'أخرى',
  return: 'مرتجع',
  transfer: 'تحويل مخزني',
};

const REASON_BADGE = {
  sale: {
    base: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
    border: 'border-l-rose-500 dark:border-l-rose-400',
  },
  purchase: {
    base: 'bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300',
    border: 'border-l-teal-500 dark:border-l-teal-400',
  },
  adjustment: {
    base: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
    border: 'border-l-amber-500 dark:border-l-amber-400',
  },
  damaged: {
    base: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    border: 'border-l-slate-400 dark:border-l-slate-500',
  },
  return: {
    base: 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300',
    border: 'border-l-violet-500 dark:border-l-violet-400',
  },
  transfer: {
    base: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300',
    border: 'border-l-indigo-500 dark:border-l-indigo-400',
  },
  other: {
    base: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    border: 'border-l-slate-400 dark:border-l-slate-500',
  },
};

function getDelta(before, after) {
  const b = Number(before ?? 0);
  const a = Number(after ?? 0);
  return a - b;
}

export default function StockLogsPage() {
  const { store, loading: storeLoading } = useStore();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [missingTable, setMissingTable] = useState(false);
  const [filterReason, setFilterReason] = useState('all');

  const load = useCallback(async () => {
    if (!store?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from(TABLE)
        .select('id, created_at, actor_name, product_name, barcode, qty_before, qty_after, reason')
        .eq('store_id', store.id)
        .order('created_at', { ascending: false })
        .limit(300);

      if (qErr) {
        const msg = String(qErr.message || '');
        if (qErr.code === 'PGRST205' || qErr.code === '42P01' || /does not exist/i.test(msg)) {
          setMissingTable(true);
          setRows([]);
          return;
        }
        throw qErr;
      }
      setMissingTable(false);
      setRows(data || []);
    } catch (e) {
      console.error(e);
      setError(e.message || 'تعذّر التحميل');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    load();
  }, [storeLoading, load]);

  const filteredRows = useMemo(() => {
    if (filterReason === 'all') return rows;
    return rows.filter((r) => (r.reason ?? 'other') === filterReason);
  }, [rows, filterReason]);

  const hasFilter = filterReason !== 'all';

  if (storeLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="animate-spin text-indigo-500 dark:text-indigo-400" size={40} />
        </div>
      </DashboardLayout>
    );
  }

  if (!store?.id) {
    return (
      <DashboardLayout>
        <div
          className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center text-amber-950 font-bold dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
          dir="rtl"
        >
          لا يوجد متجر مرتبط بحسابك.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      actions={
        <button
          type="button"
          onClick={() => load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 hover:border-indigo-200 disabled:opacity-50 transition-all dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:shadow-none dark:hover:bg-white/10 dark:hover:border-indigo-500/40"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          تحديث
        </button>
      }
    >
      <div className="space-y-4" dir="rtl">

        {/* Main card */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-[0_4px_32px_-8px_rgba(15,23,42,0.12)] overflow-hidden dark:border-gray-700/50 dark:bg-gray-900/70 dark:shadow-[0_4px_32px_-8px_rgba(0,0,0,0.45)]">

          {/* Card header */}
          <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-l from-indigo-50/40 to-white flex flex-wrap items-center justify-between gap-3 dark:border-slate-700/60 dark:from-indigo-950/50 dark:to-gray-900/90">
            <div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                <ClipboardList className="text-indigo-600 dark:text-indigo-400 shrink-0" size={22} />
                سجل حركات المخزن
              </h3>
              <p className="text-xs text-slate-500 mt-1 font-medium dark:text-slate-400">
                صندوق أسود للمخزن — كل تغيير في الكميات مُسجَّل بالتاريخ والصنف ونوع الحركة
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-bold text-indigo-600 bg-indigo-50/80 px-3 py-1.5 rounded-xl border border-indigo-100 dark:text-indigo-300 dark:bg-indigo-950/50 dark:border-indigo-500/30">
              <ClipboardList size={14} />
              <span className="font-currency" lang="en">
                {loading ? '…' : filteredRows.length.toLocaleString('en-US')}
              </span>
              <span>{hasFilter && !loading ? `من ${rows.length.toLocaleString('en-US')} ` : ''}حركة</span>
            </div>
          </div>

          {/* Filter bar */}
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/60 flex flex-wrap gap-2 items-center">
            <Filter size={13} className="text-slate-400 dark:text-slate-500 shrink-0" />
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">نوع الحركة:</span>
            {['all', 'sale', 'purchase', 'return', 'adjustment', 'transfer', 'damaged', 'other'].map((key) => {
              const badge = key !== 'all' ? REASON_BADGE[key] : null;
              const isActive = filterReason === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilterReason(key)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-black transition-all ${
                    isActive
                      ? key === 'all'
                        ? 'bg-slate-800 text-white border-slate-800 dark:bg-white dark:text-slate-900 dark:border-white shadow-sm'
                        : `${badge?.base} border-transparent shadow-sm`
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10'
                  }`}
                >
                  {key === 'all' ? 'الكل' : REASON_AR[key] ?? key}
                </button>
              );
            })}
            {hasFilter && (
              <button
                type="button"
                onClick={() => setFilterReason('all')}
                className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-100 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-900/40 transition-all shadow-sm hover:shadow-md"
              >
                <X size={11} />
                مسح
              </button>
            )}
          </div>

          {/* Alerts */}
          {missingTable && (
            <div className="mx-6 mt-4 rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-xs font-bold text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
              جدول{' '}
              <code className="rounded bg-white/80 px-1 dark:bg-black/20">inventory_logs</code>{' '}
              غير منشأ بعد. انسخ محتوى الملف{' '}
              <code className="rounded bg-white/80 px-1 dark:bg-black/20">supabase/inventory_logs.sql</code>{' '}
              والصقه في SQL Editor.
            </div>
          )}
          {error && (
            <div className="mx-6 mt-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100">
              {error}
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="bg-gradient-to-r from-indigo-50/80 to-transparent text-slate-700 border-b border-slate-200/70 dark:from-indigo-950/40 dark:to-transparent dark:text-slate-200 dark:border-slate-700/60">
                  <th className="text-right py-3.5 px-5 font-semibold w-14">
                    <span className="inline-flex items-center gap-1.5 text-slate-400 dark:text-slate-500 text-xs">#</span>
                  </th>
                  <th className="text-right py-3.5 px-5 font-semibold min-w-[180px]">
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar size={13} className="text-indigo-400 dark:text-indigo-500 shrink-0" />
                      التاريخ والوقت
                    </span>
                  </th>
                  <th className="text-right py-3.5 px-5 font-semibold min-w-[110px]">
                    <span className="inline-flex items-center gap-1.5">
                      <User size={13} className="text-indigo-400 dark:text-indigo-500 shrink-0" />
                      الموظف
                    </span>
                  </th>
                  <th className="text-right py-3.5 px-5 font-semibold min-w-[180px]">
                    <span className="inline-flex items-center gap-1.5">
                      <Package size={13} className="text-indigo-400 dark:text-indigo-500 shrink-0" />
                      الصنف
                    </span>
                  </th>
                  <th className="text-center py-3.5 px-5 font-semibold w-32">
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <ArrowLeft size={13} className="text-indigo-400 dark:text-indigo-500 shrink-0" />
                      قبل → بعد
                    </span>
                  </th>
                  <th className="text-center py-3.5 px-5 font-semibold w-28">
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <Tag size={13} className="text-indigo-400 dark:text-indigo-500 shrink-0" />
                      نوع الحركة
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-20 text-center">
                      <Loader2 className="inline animate-spin text-indigo-500 dark:text-indigo-400" size={36} />
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center">
                      <div className="inline-flex flex-col items-center gap-3 px-8 py-8 rounded-2xl bg-gradient-to-b from-slate-50/80 to-transparent dark:from-slate-800/40 dark:to-transparent">
                        <ClipboardList className="text-slate-300 dark:text-slate-600" size={64} />
                        <p className="font-bold text-slate-600 dark:text-slate-300">
                          {rows.length === 0 ? 'لا توجد حركات مسجّلة بعد' : 'لا توجد نتائج مطابقة'}
                        </p>
                        {rows.length === 0 ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            ستظهر هنا عند أول بيع أو تعديل كمية
                          </p>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setFilterReason('all')}
                            className="text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:underline"
                          >
                            مسح الفلتر
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r, idx) => {
                    const delta = getDelta(r.qty_before, r.qty_after);
                    const isIncrease = delta > 0;
                    const isDecrease = delta < 0;
                    const badge = REASON_BADGE[r.reason] ?? REASON_BADGE.other;

                    return (
                      <tr
                        key={r.id}
                        className={`border-b border-slate-100/70 align-top transition-colors dark:border-slate-700/40 hover:bg-indigo-50/60 dark:hover:bg-indigo-950/30 ${
                          idx % 2 === 0
                            ? 'bg-white dark:bg-slate-900/50'
                            : 'bg-slate-50/40 dark:bg-slate-800/30'
                        }`}
                      >
                        {/* # */}
                        <td className="py-3.5 px-5 text-slate-400 font-bold text-center font-currency dark:text-slate-500 text-xs" lang="en">
                          {(idx + 1).toLocaleString('en-US')}
                        </td>

                        {/* Date */}
                        <td className="py-3.5 px-5 font-currency text-slate-700 whitespace-nowrap dark:text-slate-300 text-xs" dir="ltr" lang="en">
                          {formatWhen(r.created_at)}
                        </td>

                        {/* Actor */}
                        <td className="py-3.5 px-5 text-slate-700 dark:text-slate-300 font-bold whitespace-nowrap text-xs">
                          {r.actor_name || <span className="text-slate-400 dark:text-slate-600">—</span>}
                        </td>

                        {/* Product */}
                        <td className="py-3.5 px-5">
                          <span className="font-bold text-slate-800 dark:text-slate-200 text-xs">
                            {r.product_name || '—'}
                          </span>
                          {r.barcode && (
                            <span className="block text-[10px] text-slate-500 dark:text-slate-500 font-currency mt-0.5" dir="ltr">
                              {r.barcode}
                            </span>
                          )}
                        </td>

                        {/* Before → After + Delta */}
                        <td className="py-3.5 px-5 text-center">
                          <div className="inline-flex items-center gap-1.5 font-currency text-xs" dir="ltr" lang="en">
                            <span className="text-slate-500 dark:text-slate-400 font-bold">
                              {Number(r.qty_before ?? 0).toFixed(0)}
                            </span>
                            <span className="text-slate-300 dark:text-slate-600">→</span>
                            <span className={`font-black ${
                              isIncrease
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : isDecrease
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-slate-600 dark:text-slate-300'
                            }`}>
                              {Number(r.qty_after ?? 0).toFixed(0)}
                            </span>
                          </div>
                          {delta !== 0 && (
                            <div className={`mt-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                              isIncrease
                                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                                : 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400'
                            }`} dir="ltr" lang="en">
                              {isIncrease
                                ? <TrendingUp size={9} className="shrink-0" />
                                : <TrendingDown size={9} className="shrink-0" />
                              }
                              {isIncrease ? '+' : ''}{delta}
                            </div>
                          )}
                        </td>

                        {/* Reason badge */}
                        <td className="py-3.5 px-5 text-center">
                          <span
                            className={`inline-block rounded-full border-l-[3px] px-2.5 py-0.5 text-[11px] font-black ${badge.base} ${badge.border}`}
                          >
                            {REASON_AR[r.reason] || r.reason || 'أخرى'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
