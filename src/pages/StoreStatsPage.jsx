import { useEffect, useState } from 'react';
import { Loader2, Package, ShoppingCart, Users, TrendingUp, Star, Phone, User } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';

const STATUS_MAP = {
  pending:   { label: 'قيد المعالجة', color: 'bg-amber-100 text-amber-700' },
  confirmed: { label: 'مؤكدة',        color: 'bg-blue-100 text-blue-700' },
  delivered: { label: 'مسلّمة',       color: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'ملغية',        color: 'bg-red-100 text-red-700' },
};

function StatCard({ icon: Icon, label, value, sub, color = 'violet' }) {
  const colors = {
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950/30',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950/30',
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-950/30',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-950/30',
  };
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-gray-900/40 dark:border-white/10 p-5">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-3 ${colors[color]}`}>
        <Icon size={22} />
      </div>
      <p className="text-2xl font-black text-slate-900 dark:text-white">{value}</p>
      <p className="text-sm font-bold text-slate-600 dark:text-slate-300 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function StoreStatsPage() {
  const { store } = useStore();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!store?.id) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_store_online_stats', {
        p_store_id: store.id,
      });
      if (!error && data) setStats(data);
      setLoading(false);
    })();
  }, [store?.id]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24" dir="rtl">
          <Loader2 className="animate-spin text-violet-500" size={40} />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        {/* Header */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden dark:bg-gray-900/40 dark:border-white/10">
          <div className="px-6 py-4 flex items-center gap-3 bg-gradient-to-l from-violet-50/50 to-white dark:from-violet-950/30 dark:to-gray-900">
            <div className="h-11 w-11 rounded-xl bg-violet-600 text-white flex items-center justify-center shadow-lg">
              <TrendingUp size={22} />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 dark:text-white">إحصائيات المتجر الأونلاين</h1>
              <p className="text-xs text-slate-500 mt-0.5">ملخص أداء المتجر العام</p>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard icon={ShoppingCart} label="إجمالي الطلبات" value={stats?.total_orders ?? 0} color="violet" />
          <StatCard
            icon={TrendingUp}
            label="إجمالي المبيعات"
            value={`₪ ${Number(stats?.total_revenue ?? 0).toFixed(0)}`}
            color="emerald"
          />
          <StatCard
            icon={Package}
            label="متوسط قيمة الطلب"
            value={`₪ ${Number(stats?.avg_order_value ?? 0).toFixed(0)}`}
            color="blue"
          />
          <StatCard icon={Users} label="إجمالي الزبائن" value={stats?.total_customers ?? 0} color="amber" />
          <StatCard icon={Star} label="طلبات مسلّمة" value={stats?.delivered_orders ?? 0} color="rose" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* أفضل المنتجات */}
          <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-gray-900/40 dark:border-white/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/5">
              <h2 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                <Star size={16} className="text-amber-500" />
                أفضل المنتجات مبيعاً
              </h2>
            </div>
            <div className="p-4 space-y-3">
              {!stats?.top_products || stats.top_products.length === 0 ? (
                <p className="text-center text-sm text-slate-400 py-8">لا توجد بيانات</p>
              ) : (
                stats.top_products.map((p, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
                      i === 0 ? 'bg-amber-100 text-amber-700' :
                      i === 1 ? 'bg-slate-100 text-slate-600' :
                      i === 2 ? 'bg-orange-100 text-orange-700' :
                      'bg-slate-50 text-slate-400'
                    }`}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200 line-clamp-1">{p.name || '—'}</p>
                      <p className="text-xs text-slate-400">{p.total_qty} قطعة مباعة</p>
                    </div>
                    <span className="text-sm font-black text-violet-600 shrink-0" dir="ltr">
                      ₪ {Number(p.total_revenue ?? 0).toFixed(0)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* أفضل الزبائن */}
          <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-gray-900/40 dark:border-white/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/5">
              <h2 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                <Users size={16} className="text-violet-500" />
                أفضل الزبائن
              </h2>
            </div>
            <div className="p-4 space-y-3">
              {!stats?.top_customers || stats.top_customers.length === 0 ? (
                <p className="text-center text-sm text-slate-400 py-8">لا توجد بيانات</p>
              ) : (
                stats.top_customers.map((c, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-violet-100 dark:bg-violet-950/50 flex items-center justify-center shrink-0">
                      <User size={16} className="text-violet-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200 line-clamp-1">
                        {c.customer_name || 'زبون'}
                      </p>
                      <a href={`tel:${c.customer_phone}`} className="text-xs text-slate-400 hover:text-violet-600 flex items-center gap-1">
                        <Phone size={10} />
                        <span dir="ltr">{c.customer_phone}</span>
                      </a>
                    </div>
                    <div className="text-left shrink-0">
                      <p className="text-sm font-black text-violet-600" dir="ltr">₪ {Number(c.total_spent ?? 0).toFixed(0)}</p>
                      <p className="text-xs text-slate-400">{c.orders_count} طلب</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* توزيع الطلبات */}
        {stats?.orders_by_status && stats.orders_by_status.length > 0 && (
          <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-gray-900/40 dark:border-white/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/5">
              <h2 className="text-sm font-black text-slate-800 dark:text-white">توزيع الطلبات حسب الحالة</h2>
            </div>
            <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {stats.orders_by_status.map((s, i) => {
                const st = STATUS_MAP[s.status] ?? STATUS_MAP.pending;
                const total = stats.total_orders || 1;
                const pct = Math.round((s.count / total) * 100);
                return (
                  <div key={i} className={`rounded-xl p-3 ${st.color.split(' ')[0]}`}>
                    <p className={`text-2xl font-black ${st.color.split(' ')[1]}`}>{s.count}</p>
                    <p className={`text-xs font-bold mt-0.5 ${st.color.split(' ')[1]}`}>{st.label}</p>
                    <p className={`text-xs opacity-60 mt-0.5 ${st.color.split(' ')[1]}`}>{pct}%</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
