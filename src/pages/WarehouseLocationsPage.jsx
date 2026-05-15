import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, MapPin, Truck, Package } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { roundMoney } from '../utils/productModel';

const LOC_TABLE = 'store_locations';
const PSL_TABLE = 'product_stock_locations';
const ST_TABLE = 'stock_transfers';

export default function WarehouseLocationsPage() {
  const { store, loading: storeLoading } = useStore();
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState([]);
  const [qtyByLoc, setQtyByLoc] = useState({});
  const [pendingTransfers, setPendingTransfers] = useState(0);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    if (!store?.id) {
      setLocations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const { data: locs, error: e1 } = await supabase
        .from(LOC_TABLE)
        .select('id, code, name_ar, is_sales_location, sort_order')
        .eq('store_id', store.id)
        .order('sort_order', { ascending: true });
      if (e1) throw e1;
      setLocations(locs || []);

      const { data: rows, error: e2 } = await supabase
        .from(PSL_TABLE)
        .select('location_id, quantity')
        .eq('store_id', store.id);
      if (e2) {
        if (!/does not exist|schema cache|PGRST205/i.test(String(e2.message || ''))) throw e2;
        setQtyByLoc({});
      } else {
        const m = {};
        for (const r of rows || []) {
          const k = String(r.location_id);
          m[k] = (m[k] || 0) + Math.max(0, Number(r.quantity ?? 0));
        }
        setQtyByLoc(m);
      }

      const { count, error: e3 } = await supabase
        .from(ST_TABLE)
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store.id)
        .eq('status', 'pending_receive');
      if (!e3) setPendingTransfers(Number(count) || 0);
      else setPendingTransfers(0);
    } catch (e) {
      console.error(e);
      setErr(e.message || 'تعذّر التحميل');
      setLocations([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    load();
  }, [storeLoading, load]);

  const totalQty = useMemo(
    () => roundMoney(Object.values(qtyByLoc).reduce((a, b) => a + b, 0)),
    [qtyByLoc]
  );

  if (storeLoading || !store?.id) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24 font-arabic" dir="rtl">
          {!store?.id && !storeLoading ? (
            <p className="font-bold text-amber-800">لا يوجد متجر.</p>
          ) : (
            <Loader2 className="animate-spin text-indigo-500" size={40} />
          )}
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap gap-2 font-arabic">
          <Link
            to="/inventory/transfers"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold dark:border-white/10 dark:bg-white/5"
          >
            <Truck size={18} />
            تحويل مخزني
          </Link>
          <button
            type="button"
            onClick={() => load()}
            className="rounded-xl border px-4 py-2 text-sm font-bold dark:border-white/15"
          >
            تحديث
          </button>
        </div>
      }
    >
      <div className="mx-auto max-w-4xl space-y-6 font-arabic p-2" dir="rtl">
        <header className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-lg">
            <MapPin size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white">مواقع المخزون</h1>
            <p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-400">
              شجرة مواقع المتجر (مستوحاة من مستودعات Odoo) — كميات موزعة حسب الموقع، ومتابعة التحويلات المعلّقة.
            </p>
          </div>
        </header>

        {pendingTransfers > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            يوجد <strong>{pendingTransfers}</strong> تحويل بانتظار الاستلام —{' '}
            <Link to="/inventory/transfers" className="text-indigo-700 underline dark:text-indigo-300">
              افتح صفحة التحويلات
            </Link>
          </div>
        )}

        {err && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
            {err} — نفّذ <code className="rounded bg-white px-1">store_locations.sql</code> و{' '}
            <code className="rounded bg-white px-1">product_stock_locations.sql</code>
          </p>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-indigo-500" size={36} />
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-gray-900/60">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                مجموع الكميات الموزّعة على المواقع (وحدات مخزون)
              </p>
              <p className="mt-1 text-2xl font-black font-currency text-slate-900 dark:text-white" dir="ltr">
                {totalQty.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </p>
            </div>
            <ul className="space-y-3">
              {locations.map((loc) => {
                const q = roundMoney(qtyByLoc[String(loc.id)] || 0);
                return (
                  <li
                    key={loc.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-gray-900/50"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Package className="text-emerald-600" size={20} />
                        <div>
                          <p className="font-black text-slate-900 dark:text-white">{loc.name_ar}</p>
                          <p className="text-[11px] font-bold text-slate-500">
                            كود: <span className="font-mono">{loc.code}</span>
                            {loc.is_sales_location ? (
                              <span className="mr-2 rounded bg-emerald-100 px-2 py-0.5 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
                                نقطة بيع
                              </span>
                            ) : null}
                          </p>
                        </div>
                      </div>
                      <div className="text-left font-currency text-lg font-black text-indigo-700 dark:text-indigo-300" dir="ltr">
                        {q.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {locations.length === 0 && (
              <p className="py-10 text-center text-sm font-bold text-slate-500">لا مواقع بعد — أضف من إعدادات المخزن أو SQL.</p>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
