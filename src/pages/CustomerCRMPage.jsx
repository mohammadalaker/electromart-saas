import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  RefreshCw,
  HeartHandshake,
  User,
  Phone,
  Search,
  ShoppingCart,
  TrendingUp,
  Award,
  Crown,
  Medal,
  Clock,
  ArrowUpRight
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { roundMoney } from '../utils/productModel';

const CONTACTS_TABLE = 'store_contacts';
const SALES_TABLE = 'sales';
const SHEKEL = '\u20AA';

function formatMoney(n) {
  return roundMoney(Number(n ?? 0)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function timeSince(dateString) {
  if (!dateString) return 'لم يشتري بعد';
  const date = new Date(dateString);
  const seconds = Math.floor((new Date() - date) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + ' سنة';
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + ' شهر';
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + ' يوم';
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + ' ساعة';
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + ' دقيقة';
  return 'الآن';
}

export default function CustomerCRMPage() {
  const { store, loading: storeLoading } = useStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [customers, setCustomers] = useState([]);
  const [salesData, setSalesData] = useState([]);

  const loadData = useCallback(async () => {
    if (!store?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [
        { data: contacts, error: cErr },
        { data: sales, error: sErr }
      ] = await Promise.all([
        supabase
          .from(CONTACTS_TABLE)
          .select('id, name, phone, email, notes, created_at, outstanding_amount')
          .eq('store_id', store.id)
          .eq('role', 'customer')
          .order('created_at', { ascending: false }),
        supabase
          .from(SALES_TABLE)
          .select('id, total_amount, created_at, contact_id')
          .eq('store_id', store.id)
          .not('contact_id', 'is', null) // Only fetch linked sales
      ]);

      if (cErr) throw cErr;
      if (sErr) throw sErr;

      setCustomers(contacts || []);
      setSalesData(sales || []);
    } catch (e) {
      console.error(e);
      setError(e.message || 'حدث خطأ أثناء الاتصال بقاعدة البيانات');
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    loadData();
  }, [storeLoading, loadData]);

  // Merge Contacts and Sales to build CRM metrics
  const aggregatedCustomers = useMemo(() => {
    const crmMap = new Map();

    // Initialize all customers
    customers.forEach(c => {
        crmMap.set(c.id, {
            ...c,
            totalSpent: 0,
            orderCount: 0,
            lastPurchaseDate: null,
            latestSaleId: null
        });
    });

    // Populate Sales data into map
    salesData.forEach(sale => {
        const contactId = sale.contact_id;
        if (contactId && crmMap.has(contactId)) {
            const crm = crmMap.get(contactId);
            crm.totalSpent += Number(sale.total_amount || 0);
            crm.orderCount += 1;
            
            const saleDate = new Date(sale.created_at);
            if (!crm.lastPurchaseDate || saleDate > new Date(crm.lastPurchaseDate)) {
                crm.lastPurchaseDate = sale.created_at;
                crm.latestSaleId = sale.id;
            }
        }
    });

    const results = Array.from(crmMap.values());
    
    // Sort primarily by Total Spent
    results.sort((a, b) => b.totalSpent - a.totalSpent);
    return results;
  }, [customers, salesData]);

  // Filter based on UI search bar
  const filteredCustomers = useMemo(() => {
     if (!searchQuery.trim()) return aggregatedCustomers;
     const q = searchQuery.toLowerCase();
     return aggregatedCustomers.filter(c => 
         (c.name && c.name.toLowerCase().includes(q)) ||
         (c.phone && c.phone.includes(q))
     );
  }, [aggregatedCustomers, searchQuery]);

  // Top 3 Leaderboard
  const topCustomers = aggregatedCustomers.slice(0, 3);

  if (storeLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24"><Loader2 className="animate-spin text-indigo-500" size={40} /></div>
      </DashboardLayout>
    );
  }

  if (!store?.id) {
    return (
      <DashboardLayout>
        <div className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center font-bold" dir="rtl">لا يوجد متجر مرتبط بحسابك.</div>
      </DashboardLayout>
    );
  }

  const RANK_COLORS = [
      'bg-amber-100 text-amber-600 border-amber-200 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.2)]', // Gold
      'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-500/20 dark:text-slate-300 dark:border-slate-500/30', // Silver
      'bg-orange-100 text-orange-600 border-orange-200 dark:bg-orange-600/20 dark:text-orange-400 dark:border-orange-600/30' // Bronze
  ];
  
  const RANK_ICONS = [Crown, Medal, Award];

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold shadow-sm transition hover:bg-slate-50 dark:border-white/10 dark:bg-[#18181b] dark:text-slate-200 dark:hover:bg-white/5"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            تحديث
          </button>
        </div>
      }
    >
      <div className="max-w-6xl mx-auto space-y-6 pb-12" dir="rtl">
        
        {/* Header Hero */}
        <div className="rounded-[24px] border border-slate-200/80 bg-white p-6 shadow-sm sm:p-8 dark:border-white/[0.04] dark:bg-[#18181b] relative overflow-hidden">
            <div className="pointer-events-none absolute left-0 top-0 h-full w-1/3 bg-gradient-to-r from-rose-500/5 to-transparent"></div>
            <div className="relative">
                <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-3">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400">
                       <HeartHandshake size={24} strokeWidth={2.5} />
                    </span>
                    إدارة علاقات العملاء (CRM)
                </h1>
                <p className="text-[13px] font-bold text-slate-500 dark:text-slate-400 mt-2 max-w-2xl leading-relaxed">
                    قسم التحليلات الخاص بالزبائن لتحديد كبار المشترين ومتابعة قوة العلاقة التجارية. يتم حساب قيمة "إجمالي المشتريات" ديناميكياً من فواتير البيع المربوطة باسم الزبون عبر الـ POS.
                </p>
            </div>
        </div>

        {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 font-bold text-rose-800">{error}</div>
        )}

        {loading ? (
           <div className="flex justify-center items-center py-20 min-h-[300px]">
               <Loader2 className="animate-spin text-indigo-500" size={40} />
           </div>
        ) : (
           <>
              {/* Leaderboard */}
              {topCustomers.some(c => c.totalSpent > 0) && (
                 <div className="grid gap-4 md:grid-cols-3">
                    {topCustomers.map((c, i) => {
                        if (c.totalSpent === 0) return null;
                        const RIcon = RANK_ICONS[i] || Award;
                        return (
                            <div key={c.id} className={`rounded-[20px] bg-white border shadow-sm p-6 relative overflow-hidden dark:bg-[#18181b] transition hover:translate-y-[-2px] ${RANK_COLORS[i]}`}>
                                <div className="absolute left-[-20px] top-[-20px] opacity-10">
                                    <RIcon size={120} />
                                </div>
                                <div className="flex items-start justify-between relative z-10 mb-6">
                                    <h3 className="font-black text-[16px] truncate pr-2 max-w-[80%]">{c.name}</h3>
                                    <span className="font-mono text-xl font-black bg-white/50 dark:bg-black/20 w-8 h-8 flex items-center justify-center rounded-lg">#{i+1}</span>
                                </div>
                                <div className="space-y-4 relative z-10">
                                    <div>
                                        <p className="text-[10px] font-bold opacity-70 uppercase tracking-widest mb-1">الإنفاق التراكمي (LTV)</p>
                                        <p className="font-mono text-2xl font-black" dir="ltr">{SHEKEL}{formatMoney(c.totalSpent)}</p>
                                    </div>
                                    <div className="flex items-center gap-4 border-t border-black/5 dark:border-white/5 pt-4 mt-2">
                                        <div className="flex items-center gap-2">
                                            <ShoppingCart size={14} className="opacity-70" />
                                            <span className="text-[12px] font-bold">{c.orderCount} طلبيات</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Clock size={14} className="opacity-70" />
                                            <span className="text-[12px] font-bold">{timeSince(c.lastPurchaseDate)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                 </div>
              )}

              {/* Data Table */}
              <div className="rounded-[20px] border border-slate-200/80 bg-white shadow-sm overflow-hidden dark:border-white/[0.04] dark:bg-[#18181b]">
                 <div className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800">
                    <h2 className="text-[15px] font-black text-slate-900 dark:text-white flex items-center gap-2">
                       <TrendingUp className="text-indigo-500" size={18} />
                       جميع العملاء (تحليل الشراء)
                    </h2>
                    <div className="relative">
                       <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                       <input 
                           type="search"
                           value={searchQuery}
                           onChange={(e) => setSearchQuery(e.target.value)}
                           className="w-full sm:w-64 rounded-xl border border-slate-200 bg-slate-50 py-2.5 pr-9 pl-3 text-sm font-bold placeholder:text-slate-400 dark:border-slate-700/60 dark:bg-slate-900/50 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                           placeholder="بحث بعميل أو رقم…"
                       />
                    </div>
                 </div>

                 <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[800px]">
                        <thead>
                           <tr className="bg-slate-50/50 text-slate-500 dark:bg-slate-900/30 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                               <th className="py-3 px-6 text-right font-bold w-12">#</th>
                               <th className="py-3 px-6 text-right font-bold">العميل والتواصل</th>
                               <th className="py-3 px-6 text-center font-bold">الطلبيات</th>
                               <th className="py-3 px-6 text-center font-bold w-36">آخر نشاط</th>
                               <th className="py-3 px-6 text-right font-bold w-40" dir="ltr">قيمة المشتريات</th>
                               <th className="py-3 px-6 text-right font-bold w-40" dir="ltr">رصيد الذمة</th>
                               <th className="py-3 px-6 text-center font-bold w-24">الملف</th>
                           </tr>
                        </thead>
                        <tbody>
                           {filteredCustomers.length === 0 ? (
                               <tr>
                                   <td colSpan={7} className="py-16 text-center text-slate-500 font-bold">لا يوجد عملاء يعرضون أو يطابقون البحث.</td>
                               </tr>
                           ) : (
                               filteredCustomers.map((c, idx) => (
                                   <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/70 transition dark:border-slate-800/80 dark:hover:bg-slate-800/30">
                                       <td className="py-3.5 px-6 font-mono text-[11px] font-black">{idx + 1}</td>
                                       <td className="py-3.5 px-6">
                                          <div className="font-bold text-slate-900 dark:text-slate-100">{c.name}</div>
                                          {c.phone && <div className="text-[11px] text-slate-500 font-mono mt-0.5" dir="ltr">{c.phone}</div>}
                                       </td>
                                       <td className="py-3.5 px-6 text-center font-black">
                                          <span className="bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 px-2 py-0.5 rounded-md">
                                             {c.orderCount}
                                          </span>
                                       </td>
                                       <td className="py-3.5 px-6 text-center text-[12px] font-bold text-slate-500 dark:text-slate-400">
                                          {timeSince(c.lastPurchaseDate)}
                                       </td>
                                       <td className="py-3.5 px-6 font-mono text-[14px] font-black text-emerald-600 dark:text-emerald-400" dir="ltr">
                                          {SHEKEL}{formatMoney(c.totalSpent)}
                                       </td>
                                       <td className="py-3.5 px-6 font-mono text-[14px] font-black text-rose-600 dark:text-rose-400" dir="ltr">
                                          {Number(c.outstanding_amount) > 0 ? `${SHEKEL}${formatMoney(c.outstanding_amount)}` : '—'}
                                       </td>
                                       <td className="py-3.5 px-6 text-center">
                                          <Link to={`/customers/${c.id}`} className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 transition">
                                             <User size={16} />
                                          </Link>
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
    </DashboardLayout>
  );
}
