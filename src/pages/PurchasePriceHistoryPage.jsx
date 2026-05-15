import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, TrendingUp } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { roundMoney } from '../utils/productModel';

const PURCHASES_TABLE = 'store_purchases';

function parseLineItems(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

export default function PurchasePriceHistoryPage() {
  const { store, loading: storeLoading } = useStore();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    if (!store?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from(PURCHASES_TABLE)
        .select('invoice_date, supplier_company_name, line_items, created_at')
        .eq('store_id', store.id)
        .order('invoice_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(400);
      if (error) throw error;
      const lastByKey = new Map();
      for (const inv of data || []) {
        const lines = parseLineItems(inv.line_items);
        const d = inv.invoice_date || String(inv.created_at || '').slice(0, 10);
        for (const li of lines) {
          const key = String(li.barcode || li.reference || li.product_id || '').trim();
          if (!key) continue;
          const unit = roundMoney(Number(li.unit_price ?? li.price ?? 0));
          if (!(unit > 0)) continue;
          if (!lastByKey.has(key)) {
            lastByKey.set(key, {
              key,
              label: String(li.reference || li.description || li.name || key).slice(0, 80),
              lastPrice: unit,
              lastDate: d,
              supplier: String(inv.supplier_company_name || '').trim() || '—',
            });
          }
        }
      }
      setRows(Array.from(lastByKey.values()).sort((a, b) => a.label.localeCompare(b.label, 'ar')));
    } catch (e) {
      console.error(e);
      setErr(e.message || 'تعذّر التحميل');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    load();
  }, [storeLoading, load]);

  const avgHint = useMemo(() => {
    const prices = rows.map((r) => r.lastPrice).filter((p) => p > 0);
    if (!prices.length) return 0;
    return roundMoney(prices.reduce((a, b) => a + b, 0) / prices.length);
  }, [rows]);

  if (!store?.id && !storeLoading) {
    return (
      <DashboardLayout>
        <p className="p-8 text-center font-bold font-arabic" dir="rtl">
          لا يوجد متجر.
        </p>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      actions={
        <Link
          to="/purchases/lines"
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold dark:border-white/10 dark:bg-white/5 font-arabic"
        >
          فاتورة مشتريات جديدة
        </Link>
      }
    >
      <div className="mx-auto max-w-5xl space-y-6 p-2 font-arabic" dir="rtl">
        <header className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-600 text-white">
            <TrendingUp size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white">آخر أسعار شراء (من الفواتير)</h1>
            <p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-400">
              يستخرج من <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">line_items</code> في فواتير الموردين — مفيد
              لمقارنة التسعيرة ومراقبة متوسط التكلفة (WAC يُحدَّث عند الاستلام في النظام).
            </p>
          </div>
        </header>

        {err && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold">{err}</p>}

        {!loading && rows.length > 0 && (
          <p className="text-xs font-bold text-slate-600 dark:text-slate-400">
            متوسط آخر سعر مسجّل (تقريبي على العينة):{' '}
            <span className="font-currency text-slate-900 dark:text-white" dir="ltr">
              {'\u20AA'}
              {avgHint.toFixed(2)}
            </span>
          </p>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-indigo-500" size={36} />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/10">
            <table className="w-full min-w-[640px] text-right text-sm">
              <thead>
                <tr className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <th className="px-3 py-2 font-bold">المرجع / الباركود</th>
                  <th className="px-3 py-2 font-bold">وصف</th>
                  <th className="px-3 py-2 font-bold">آخر مورد</th>
                  <th className="px-3 py-2 font-bold">تاريخ</th>
                  <th className="px-3 py-2 font-bold">آخر سعر شراء</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-slate-100 dark:border-white/10">
                    <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                      {r.key}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.label}</td>
                    <td className="px-3 py-2 text-xs">{r.supplier}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.lastDate}</td>
                    <td className="px-3 py-2 font-currency font-bold" dir="ltr">
                      {'\u20AA'}
                      {r.lastPrice.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && rows.length === 0 && !err && (
          <p className="py-12 text-center text-sm font-bold text-slate-500">لا فواتير مشتريات بأسطر بعد.</p>
        )}
      </div>
    </DashboardLayout>
  );
}
