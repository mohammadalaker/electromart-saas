import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, RefreshCw } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { formatAlertTime, useSystemAlerts } from '../hooks/useSystemAlerts';

const TYPE_FILTERS = [
  { id: 'all', label: 'الكل' },
  { id: 'low-stock', label: 'مخزون منخفض' },
  { id: 'high-sale', label: 'صفقات كبيرة' },
  { id: 'return', label: 'مرتجعات' },
];

export default function AlertsPage() {
  const [typeFilter, setTypeFilter] = useState('all');
  const {
    storeLoading,
    store,
    loading,
    alerts,
    readIds,
    markRead,
    markAllRead,
    unreadCount,
    fetchAlerts,
  } = useSystemAlerts({
    lowStockLimit: 100,
    highSaleLimit: 50,
    returnLimit: 50,
  });

  const filteredAlerts = useMemo(() => {
    if (typeFilter === 'all') return alerts;
    return alerts.filter((a) => a.type === typeFilter);
  }, [alerts, typeFilter]);

  if (storeLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24">
          <div className="h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  if (!store?.id) {
    return (
      <DashboardLayout>
        <div className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center font-bold" dir="rtl">
          لا يوجد متجر مرتبط بحسابك.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-5" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-sm dark:border-white/[0.06] dark:bg-[#18181b]">
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-white">الإشعارات والتنبيهات</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {alerts.length} إشعار — {unreadCount} غير مقروء
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={markAllRead}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-indigo-600 transition hover:bg-indigo-50 dark:border-white/10 dark:hover:bg-indigo-500/10"
            >
              تحديد الكل كمقروء
            </button>
            <button
              type="button"
              onClick={fetchAlerts}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              تحديث الآن
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {TYPE_FILTERS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setTypeFilter(opt.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                typeFilter === opt.id
                  ? 'bg-indigo-600 text-white shadow'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-white/[0.06] dark:bg-[#18181b]">
          {loading ? (
            <div className="flex justify-center items-center py-20">
              <div className="h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredAlerts.length === 0 ? (
            <div className="py-20 text-center flex flex-col items-center opacity-60">
              <Bell size={40} className="mb-3 text-slate-400" />
              <p className="text-sm font-bold text-slate-500 dark:text-slate-400">لا توجد إشعارات</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1 p-2">
              {filteredAlerts.map((al) => {
                const timeLabel = formatAlertTime(al.at);
                return (
                  <Link
                    key={al.id}
                    to={al.link}
                    onClick={() => markRead(al.id)}
                    className={`group flex gap-3 rounded-[16px] p-4 transition hover:bg-slate-50 dark:hover:bg-white/[0.03] ${
                      !readIds.has(al.id) ? 'bg-indigo-50/40 dark:bg-indigo-500/5' : ''
                    }`}
                  >
                    <div className={`flex shrink-0 items-center justify-center h-10 w-10 rounded-xl ${al.bgIcon}`}>
                      {al.icon}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1 justify-center">
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate pb-0.5 flex items-center gap-1.5">
                        {!readIds.has(al.id) ? (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                        ) : null}
                        {al.title}
                      </p>
                      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                        {al.message}
                      </p>
                      {timeLabel ? (
                        <p className="mt-1 text-[10px] font-bold text-slate-400">{timeLabel}</p>
                      ) : null}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
