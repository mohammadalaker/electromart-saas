import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Truck,
  Package,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { runProductsSelectWithFallback } from '../utils/productModel';
import { ensureDefaultLocations, PSL_TABLE, SHOP_CODE, WAREHOUSE_CODE } from '../utils/storeLocations';
import {
  createStockTransferPending,
  confirmStockTransferReceive,
  cancelStockTransfer,
} from '../utils/stockTransferExecution';

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-EG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return String(iso);
  }
}

export default function StockTransferPage() {
  const { store, loading: storeLoading } = useStore();
  const [locations, setLocations] = useState([]);
  const [missingTables, setMissingTables] = useState(false);
  const [loadingSetup, setLoadingSetup] = useState(true);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([]);
  const [search, setSearch] = useState('');
  const [searchHits, setSearchHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [transfers, setTransfers] = useState([]);
  const [loadingTransfers, setLoadingTransfers] = useState(true);
  const [actionId, setActionId] = useState(null);
  const [errorBanner, setErrorBanner] = useState(null);

  const loadLocations = useCallback(async () => {
    if (!store?.id) return;
    setLoadingSetup(true);
    setErrorBanner(null);
    const ensured = await ensureDefaultLocations(store.id);
    if (!ensured.ok) {
      setMissingTables(true);
      setLocations([]);
      setLoadingSetup(false);
      return;
    }
    setMissingTables(false);
    const { data, error } = await supabase
      .from('store_locations')
      .select('id, code, name_ar, sort_order')
      .eq('store_id', store.id)
      .order('sort_order', { ascending: true });
    if (error) {
      setErrorBanner(error.message);
      setLocations([]);
    } else {
      setLocations(data || []);
      const wh = (data || []).find((l) => l.code === WAREHOUSE_CODE);
      const sh = (data || []).find((l) => l.code === SHOP_CODE);
      setFromId((prev) => prev || wh?.id || '');
      setToId((prev) => prev || sh?.id || '');
    }
    setLoadingSetup(false);
  }, [store?.id]);

  const loadTransfers = useCallback(async () => {
    if (!store?.id) {
      setTransfers([]);
      setLoadingTransfers(false);
      return;
    }
    setLoadingTransfers(true);
    const { data, error } = await supabase
      .from('stock_transfers')
      .select(
        'id, status, notes, created_at, created_by_name, received_at, received_by_name, from_location_id, to_location_id'
      )
      .eq('store_id', store.id)
      .order('created_at', { ascending: false })
      .limit(80);

    if (error) {
      if (error.code === 'PGRST205' || error.code === '42P01') {
        setTransfers([]);
      } else {
        console.warn(error);
      }
    } else {
      setTransfers(data || []);
    }
    setLoadingTransfers(false);
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    loadLocations();
  }, [storeLoading, loadLocations]);

  useEffect(() => {
    if (storeLoading) return;
    loadTransfers();
  }, [storeLoading, loadTransfers]);

  const searchProducts = useCallback(async () => {
    if (!store?.id || !search.trim()) {
      setSearchHits([]);
      return;
    }
    setSearching(true);
    const q = search.trim().slice(0, 80);
    const { data, error } = await runProductsSelectWithFallback((sel) =>
      supabase
        .from(PRODUCTS_TABLE)
        .select(sel)
        .eq('store_id', store.id)
        .or(`barcode.ilike.%${q}%,eng_name.ilike.%${q}%`)
        .limit(25)
    );
    if (error) setSearchHits([]);
    else setSearchHits(data || []);
    setSearching(false);
  }, [store?.id, search]);

  useEffect(() => {
    const t = setTimeout(() => {
      searchProducts();
    }, 280);
    return () => clearTimeout(t);
  }, [search, searchProducts]);

  const qtyAtLocation = useCallback(
    async (productId, locationId) => {
      if (!store?.id || !productId || !locationId) return 0;
      const { data } = await supabase
        .from(PSL_TABLE)
        .select('quantity')
        .eq('store_id', store.id)
        .eq('product_id', productId)
        .eq('location_id', locationId)
        .maybeSingle();
      return Number(data?.quantity ?? 0);
    },
    [store?.id]
  );

  const addLine = async (row) => {
    if (!row?.id) return;
    if (lines.some((l) => l.productId === row.id)) return;
    const avail = fromId ? await qtyAtLocation(row.id, fromId) : 0;
    setLines((prev) => [
      ...prev,
      {
        key: `${row.id}-${Date.now()}`,
        productId: row.id,
        name: row.eng_name || row.barcode || '—',
        barcode: row.barcode || '',
        qty: 1,
        availableAtFrom: avail,
      },
    ]);
    setSearch('');
    setSearchHits([]);
  };

  const updateLineQty = (key, raw) => {
    const n = Math.floor(Math.max(0, parseFloat(String(raw).replace(',', '.')) || 0));
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, qty: n } : l)));
  };

  const removeLine = (key) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorBanner(null);
    if (!store?.id || !fromId || !toId) return;
    setSubmitting(true);
    try {
      await createStockTransferPending({
        storeId: store.id,
        fromLocationId: fromId,
        toLocationId: toId,
        notes,
        lines: lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          name: l.name,
          barcode: l.barcode,
        })),
      });
      setLines([]);
      setNotes('');
      await loadTransfers();
    } catch (err) {
      setErrorBanner(err.message || 'تعذّر إنشاء التحويل');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReceive = async (id) => {
    setErrorBanner(null);
    setActionId(id);
    try {
      await confirmStockTransferReceive(id);
      await loadTransfers();
    } catch (err) {
      setErrorBanner(err.message || 'تعذّر تأكيد الاستلام');
    } finally {
      setActionId(null);
    }
  };

  const handleCancel = async (id) => {
    if (!confirm('إلغاء هذا التحويل؟')) return;
    setErrorBanner(null);
    setActionId(id);
    try {
      await cancelStockTransfer(id);
      await loadTransfers();
    } catch (err) {
      setErrorBanner(err.message || 'تعذّر الإلغاء');
    } finally {
      setActionId(null);
    }
  };

  const locName = useMemo(() => {
    const m = Object.fromEntries((locations || []).map((l) => [l.id, l.name_ar]));
    return (id) => m[id] || '—';
  }, [locations]);

  const pendingList = transfers.filter((t) => t.status === 'pending_receive');
  const doneList = transfers.filter((t) => t.status !== 'pending_receive').slice(0, 40);

  if (storeLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="animate-spin text-indigo-500" size={40} />
        </div>
      </DashboardLayout>
    );
  }

  if (!store?.id) {
    return (
      <DashboardLayout>
        <div
          className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center text-amber-950 font-bold"
          dir="rtl"
        >
          لا يوجد متجر مرتبط بحسابك.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6" dir="rtl">
        <div className="rounded-2xl border border-white/20 dark:border-gray-700/30 bg-white/80 dark:bg-gray-900/50 backdrop-blur-md p-6 shadow-sm">
          <h1 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
            <Truck className="text-indigo-600 shrink-0" size={26} />
            تحويل مخزني
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
            نقل بضاعة بين مواقع المتجر (مثلاً من المستودع الخارجي إلى المحل). يُسجَّل من أنشأ الطلب ومن أكد
            الاستلام عند الوصول.
          </p>
        </div>

        {missingTables && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/95 dark:bg-amber-950/40 dark:border-amber-800/50 p-5 flex gap-3 items-start">
            <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={22} />
            <div className="text-sm text-amber-950 dark:text-amber-100 space-y-2">
              <p className="font-bold">جداول المواقع أو التحويلات غير منشأة في Supabase.</p>
              <p>
                نفّذ بالترتيب: <code className="px-1 rounded bg-white/80">store_locations.sql</code>،{' '}
                <code className="px-1 rounded bg-white/80">product_stock_locations.sql</code>،{' '}
                <code className="px-1 rounded bg-white/80">stock_transfers.sql</code>، ثم اختياريًا{' '}
                <code className="px-1 rounded bg-white/80">store_locations_seed.sql</code> و{' '}
                <code className="px-1 rounded bg-white/80">inventory_logs_reason_transfer.sql</code>.
              </p>
            </div>
          </div>
        )}

        {errorBanner && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-900 px-4 py-3 text-sm font-semibold">
            {errorBanner}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-white/20 dark:border-gray-700/30 bg-white/80 dark:bg-gray-900/50 backdrop-blur-md p-6 shadow-sm space-y-5"
        >
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Package size={20} className="text-indigo-600" />
            طلب تحويل جديد
          </h2>

          {loadingSetup ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-indigo-500" />
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block space-y-1.5">
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-400">من (مصدر)</span>
                  <select
                    value={fromId}
                    onChange={(e) => {
                      setFromId(e.target.value);
                      setLines([]);
                    }}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm"
                  >
                    <option value="">— اختر —</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name_ar}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-400">إلى (وجهة)</span>
                  <select
                    value={toId}
                    onChange={(e) => setToId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm"
                  >
                    <option value="">— اختر —</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name_ar}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-slate-600 dark:text-slate-400">ملاحظات (اختياري)</span>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm"
                  placeholder="مثلاً: طلبية أسبوعية"
                />
              </label>

              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-600 dark:text-slate-400">إضافة أصناف</span>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm"
                  placeholder="بحث بالاسم أو الباركود..."
                  disabled={!fromId || !toId || fromId === toId}
                />
                {searching && (
                  <p className="text-[11px] text-slate-500 flex items-center gap-1">
                    <Loader2 className="animate-spin" size={12} /> جاري البحث…
                  </p>
                )}
                {searchHits.length > 0 && (
                  <ul className="rounded-xl border border-slate-200 dark:border-slate-600 divide-y divide-slate-100 dark:divide-slate-700 max-h-48 overflow-y-auto">
                    {searchHits.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          onClick={() => addLine(h)}
                          className="w-full text-right px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-950/40 flex justify-between gap-2"
                        >
                          <span className="font-semibold truncate">{h.eng_name || h.barcode}</span>
                          <span className="text-slate-500 font-mono text-xs shrink-0">{h.barcode}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {lines.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-600">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300">
                      <tr>
                        <th className="text-right py-2 px-3 font-bold">الصنف</th>
                        <th className="text-right py-2 px-3 font-bold w-28">متوفر عند المصدر</th>
                        <th className="text-right py-2 px-3 font-bold w-32">الكمية</th>
                        <th className="w-12" />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.key} className="border-t border-slate-100 dark:border-slate-700">
                          <td className="py-2 px-3">
                            <div className="font-semibold">{l.name}</div>
                            <div className="text-[11px] text-slate-500 font-mono">{l.barcode}</div>
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300">
                            {l.availableAtFrom}
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              min={1}
                              value={l.qty || ''}
                              onChange={(e) => updateLineQty(l.key, e.target.value)}
                              className="w-full rounded-lg border border-slate-200 dark:border-slate-600 px-2 py-1.5 font-mono"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <button
                              type="button"
                              onClick={() => removeLine(l.key)}
                              className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg"
                              title="حذف السطر"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <button
                type="submit"
                disabled={
                  submitting ||
                  missingTables ||
                  !fromId ||
                  !toId ||
                  fromId === toId ||
                  lines.length === 0
                }
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold px-5 py-3 text-sm transition"
              >
                {submitting ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
                إنشاء طلب تحويل (بانتظار الاستلام)
              </button>
            </>
          )}
        </form>

        <div className="rounded-2xl border border-white/20 dark:border-gray-700/30 bg-white/80 dark:bg-gray-900/50 backdrop-blur-md p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">بانتظار تأكيد الاستلام</h2>
          {loadingTransfers ? (
            <Loader2 className="animate-spin text-indigo-500 mx-auto block" />
          ) : pendingList.length === 0 ? (
            <p className="text-sm text-slate-500">لا توجد تحويلات معلّقة.</p>
          ) : (
            <ul className="space-y-3">
              {pendingList.map((t) => (
                <li
                  key={t.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-600 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="space-y-1 text-sm">
                    <div className="font-bold text-slate-800 dark:text-slate-100">
                      {locName(t.from_location_id)} ← {locName(t.to_location_id)}
                    </div>
                    <div className="text-slate-600 dark:text-slate-400 text-xs">
                      أنشأه: {t.created_by_name || '—'} · {formatWhen(t.created_at)}
                    </div>
                    {t.notes ? (
                      <div className="text-xs text-slate-500">{t.notes}</div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleReceive(t.id)}
                      disabled={actionId === t.id}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold px-4 py-2 text-xs"
                    >
                      {actionId === t.id ? (
                        <Loader2 className="animate-spin" size={14} />
                      ) : (
                        <CheckCircle2 size={14} />
                      )}
                      تأكيد الاستلام
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancel(t.id)}
                      disabled={actionId === t.id}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-bold px-4 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <XCircle size={14} />
                      إلغاء
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-white/20 dark:border-gray-700/30 bg-white/80 dark:bg-gray-900/50 backdrop-blur-md p-6 shadow-sm space-y-3">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">سجل التحويلات الأخيرة</h2>
          {doneList.length === 0 ? (
            <p className="text-sm text-slate-500">لا يوجد سجل بعد.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-600">
                    <th className="text-right py-2 font-bold">المسار</th>
                    <th className="text-right py-2 font-bold">الحالة</th>
                    <th className="text-right py-2 font-bold">المنشئ</th>
                    <th className="text-right py-2 font-bold">المستلم</th>
                    <th className="text-right py-2 font-bold">التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {doneList.map((t) => (
                    <tr key={t.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2">
                        {locName(t.from_location_id)} ← {locName(t.to_location_id)}
                      </td>
                      <td className="py-2">
                        {t.status === 'received' ? (
                          <span className="text-emerald-700 dark:text-emerald-300 font-semibold">مُستلم</span>
                        ) : (
                          <span className="text-slate-500">ملغى</span>
                        )}
                      </td>
                      <td className="py-2 text-xs">{t.created_by_name || '—'}</td>
                      <td className="py-2 text-xs">
                        {t.status === 'received' ? t.received_by_name || '—' : '—'}
                      </td>
                      <td className="py-2 text-xs whitespace-nowrap">
                        {t.status === 'received' ? formatWhen(t.received_at) : formatWhen(t.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
