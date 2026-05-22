import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, TrendingUp, PackageMinus } from 'lucide-react';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';

const SALES_TABLE = 'sales';

export const LOW_STOCK_THRESHOLD = 10;
export const UNUSUAL_SALE_THRESHOLD = 3000;

const READ_ALERTS_KEY = 'swiftm-read-alerts';

function formatMoney(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatAlertTime(iso) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return null;
  }
}

export function useSystemAlerts({
  lowStockLimit = 10,
  highSaleLimit = 5,
  returnLimit = 5,
  autoRefresh = true,
} = {}) {
  const { store, loading: storeLoading } = useStore();
  const [loading, setLoading] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [readIds, setReadIds] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(READ_ALERTS_KEY) || '[]'));
    } catch {
      return new Set();
    }
  });

  const markRead = (id) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(READ_ALERTS_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const markAllRead = () => {
    const allIds = alerts.map((a) => a.id);
    setReadIds(new Set(allIds));
    try {
      localStorage.setItem(READ_ALERTS_KEY, JSON.stringify(allIds));
    } catch {
      /* ignore */
    }
  };

  const unreadCount = alerts.filter((a) => !readIds.has(a.id)).length;

  const fetchAlerts = useCallback(async () => {
    if (!store?.id) return;
    setLoading(true);

    try {
      const [{ data: lowStock }, { data: highValSales }, { data: returns }] = await Promise.all([
        supabase
          .from(PRODUCTS_TABLE)
          .select('id, eng_name, stock_count')
          .eq('store_id', store.id)
          .lt('stock_count', LOW_STOCK_THRESHOLD)
          .order('stock_count', { ascending: true })
          .limit(lowStockLimit),
        supabase
          .from(SALES_TABLE)
          .select('id, total_amount, created_at')
          .eq('store_id', store.id)
          .gte('total_amount', UNUSUAL_SALE_THRESHOLD)
          .order('created_at', { ascending: false })
          .limit(highSaleLimit),
        supabase
          .from(SALES_TABLE)
          .select('id, total_amount, returned_at')
          .eq('store_id', store.id)
          .not('returned_at', 'is', null)
          .order('returned_at', { ascending: false })
          .limit(returnLimit),
      ]);

      const newAlerts = [];

      if (lowStock?.length) {
        lowStock.forEach((item) => {
          newAlerts.push({
            id: `stock-${item.id}`,
            type: 'low-stock',
            icon: <PackageMinus size={16} className="text-rose-500" />,
            bgIcon: 'bg-rose-50 dark:bg-rose-500/10',
            title: 'مخزون منخفض',
            message: `صنف "${item.eng_name || '—'}" قارَب على الانتهاء (المتبقي: ${item.stock_count})`,
            link: '/inventory/low-stock',
            at: null,
          });
        });
      }

      if (highValSales?.length) {
        highValSales.forEach((sale) => {
          newAlerts.push({
            id: `high-sale-${sale.id}`,
            type: 'high-sale',
            icon: <TrendingUp size={16} className="text-emerald-600" />,
            bgIcon: 'bg-emerald-50 dark:bg-emerald-500/10',
            title: 'صفقة كبيرة قريبة',
            message: `تم تسجيل فاتورة مبيعات بقيمة ₪${formatMoney(sale.total_amount)}`,
            link: '/sales',
            at: sale.created_at || null,
          });
        });
      }

      if (returns?.length) {
        returns.forEach((sale) => {
          newAlerts.push({
            id: `ret-${sale.id}`,
            type: 'return',
            icon: <AlertTriangle size={16} className="text-amber-500" />,
            bgIcon: 'bg-amber-50 dark:bg-amber-500/10',
            title: 'إرجاع مبيعات',
            message: `تم إرجاع فاتورة بقيمة ₪${formatMoney(sale.total_amount)} في ${new Date(sale.returned_at).toLocaleDateString('ar-EG')}`,
            link: '/sales',
            at: sale.returned_at || null,
          });
        });
      }

      setAlerts(newAlerts);
    } catch (err) {
      console.error('System Alerts Fetch Error', err);
    } finally {
      setLoading(false);
    }
  }, [store?.id, lowStockLimit, highSaleLimit, returnLimit]);

  useEffect(() => {
    if (storeLoading) return;
    fetchAlerts();
    if (!autoRefresh) return undefined;
    const intervalId = setInterval(fetchAlerts, 5 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [storeLoading, fetchAlerts, autoRefresh]);

  return {
    storeLoading,
    store,
    loading,
    alerts,
    readIds,
    markRead,
    markAllRead,
    unreadCount,
    fetchAlerts,
  };
}
