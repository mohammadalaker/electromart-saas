import { useCallback, useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Bell, AlertTriangle, TrendingUp, PackageMinus, X } from 'lucide-react';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';

const SALES_TABLE = 'sales';

// 5 as default low stock warning.
const LOW_STOCK_THRESHOLD = 5;
// 5000 Shekels default for high-value anomaly.
const UNUSUAL_SALE_THRESHOLD = 5000;

function formatMoney(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function SystemAlerts() {
  const { store, loading: storeLoading } = useStore();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const dropdownRef = useRef(null);

  const fetchAlerts = useCallback(async () => {
    if (!store?.id) return;
    setLoading(true);

    try {
      // We will perform three concurrent queries to capture the anomalies.
      const [
        { data: lowStock }, 
        { data: highValSales }, 
        { data: returns }
      ] = await Promise.all([
        supabase
          .from(PRODUCTS_TABLE)
          .select('id, eng_name, stock_count')
          .eq('store_id', store.id)
          .lt('stock_count', LOW_STOCK_THRESHOLD)
          .order('stock_count', { ascending: true })
          .limit(10),
        supabase
          .from(SALES_TABLE)
          .select('id, total_amount, created_at')
          .eq('store_id', store.id)
          .gte('total_amount', UNUSUAL_SALE_THRESHOLD)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from(SALES_TABLE)
          .select('id, total_amount, returned_at')
          .eq('store_id', store.id)
          .not('returned_at', 'is', null)
          .order('returned_at', { ascending: false })
          .limit(5),
      ]);

      const newAlerts = [];

      if (lowStock && lowStock.length > 0) {
         lowStock.forEach(item => {
             newAlerts.push({
                 id: `stock-${item.id}`,
                 type: 'low-stock',
                 icon: <PackageMinus size={16} className="text-rose-500" />,
                 bgIcon: 'bg-rose-50 dark:bg-rose-500/10',
                 title: 'مخزون منخفض',
                 message: `صنف "${item.eng_name || '—'}" قارَب على الانتهاء (المتبقي: ${item.stock_count})`,
                 link: '/inventory/low-stock'
             });
         });
      }

      if (highValSales && highValSales.length > 0) {
         highValSales.forEach(sale => {
             newAlerts.push({
                 id: `high-sale-${sale.id}`,
                 type: 'high-sale',
                 icon: <TrendingUp size={16} className="text-emerald-600" />,
                 bgIcon: 'bg-emerald-50 dark:bg-emerald-500/10',
                 title: 'صفقة كبيرة قريبة',
                 message: `تم تسجيل فاتورة مبيعات بقيمة ₪${formatMoney(sale.total_amount)}`,
                 link: '/sales'
             });
         });
      }

      if (returns && returns.length > 0) {
         returns.forEach(sale => {
             newAlerts.push({
                 id: `ret-${sale.id}`,
                 type: 'return',
                 icon: <AlertTriangle size={16} className="text-amber-500" />,
                 bgIcon: 'bg-amber-50 dark:bg-amber-500/10',
                 title: 'إرجاع مبيعات',
                 message: `تم إرجاع فاتورة بقيمة ₪${formatMoney(sale.total_amount)} في ${new Date(sale.returned_at).toLocaleDateString('ar-EG')}`,
                 link: '/sales'
             });
         });
      }

      setAlerts(newAlerts);

    } catch (err) {
      console.error("System Alerts Fetch Error", err);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    fetchAlerts();
    
    // Optional: Refresh alerts every 5 minutes automatically.
    const intervalId = setInterval(fetchAlerts, 5 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [storeLoading, fetchAlerts]);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (storeLoading || !store?.id) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200/90 bg-white/90 text-slate-500 shadow-sm transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15 focus:outline-none"
      >
        <Bell size={20} className={alerts.length > 0 ? "animate-[bell-ring_1.5s_ease-out_infinite]" : ""} />
        {alerts.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-black text-white shadow-md border-2 border-white dark:border-gray-900 leading-none">
               {alerts.length > 9 ? '9+' : alerts.length}
            </span>
        )}
      </button>

      {/* Adding a simple bell-ring keyframe for animation */}
      <style>{`
        @keyframes bell-ring {
            0%, 100% { transform: rotate(0); }
            10%, 30%, 50%, 70%, 90% { transform: rotate(-5deg); }
            20%, 40%, 60%, 80% { transform: rotate(5deg); }
        }
      `}</style>

      {open && (
        <div className="absolute left-0 sm:left-auto sm:-right-4 top-full mt-3 w-80 sm:w-96 rounded-[24px] bg-white/95 border border-slate-200/80 p-2 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] backdrop-blur-xl dark:bg-[#18181b]/95 dark:border-white/[0.08] dark:shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] z-50 overflow-hidden transform origin-top transition-all" dir="rtl">
          
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-white/[0.04]">
              <div className="flex items-center gap-2">
                 <h3 className="text-sm font-black text-slate-800 dark:text-white">إشعارات وتنبيهات</h3>
                 <span className="bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full text-[10px] font-bold h-fit min-w-4 flex justify-center items-center leading-none mt-0.5">{alerts.length}</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition">
                  <X size={16} />
              </button>
          </div>

          <div className="max-h-[350px] overflow-y-auto px-1 py-1 custom-scrollbar">
             {loading ? (
                <div className="flex justify-center items-center py-10">
                   <div className="h-6 w-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
             ) : alerts.length === 0 ? (
                 <div className="py-10 text-center flex flex-col items-center opacity-60">
                     <Bell size={32} className="mb-2" />
                     <p className="text-xs font-bold text-slate-500 dark:text-slate-400">لا توجد إشعارات جديدة بانتظارك.</p>
                 </div>
             ) : (
                 <div className="flex flex-col gap-1 mt-1">
                     {alerts.map((al) => (
                        <Link 
                           key={al.id} 
                           to={al.link}
                           onClick={() => setOpen(false)}
                           className="group flex gap-3 rounded-[16px] p-3 transition hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                        >
                            <div className={`flex shrink-0 items-center justify-center h-10 w-10 rounded-xl ${al.bgIcon}`}>
                               {al.icon}
                            </div>
                            <div className="flex flex-col min-w-0 flex-1 justify-center">
                               <p className="text-xs font-bold text-slate-900 dark:text-white truncate pb-0.5">
                                  {al.title}
                               </p>
                               <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                                  {al.message}
                               </p>
                            </div>
                        </Link>
                     ))}
                 </div>
             )}
          </div>
        </div>
      )}
    </div>
  );
}
