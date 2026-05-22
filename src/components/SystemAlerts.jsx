import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, X } from 'lucide-react';
import { useSystemAlerts } from '../hooks/useSystemAlerts';

export default function SystemAlerts() {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);
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
  } = useSystemAlerts();

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (storeLoading || !store?.id) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200/90 bg-white/90 text-slate-500 shadow-sm transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15 focus:outline-none"
      >
        <Bell size={20} className={alerts.length > 0 ? 'animate-[bell-ring_1.5s_ease-out_infinite]' : ''} />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-black text-white shadow-md border-2 border-white dark:border-gray-900 leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

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
              <span className="bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full text-[10px] font-bold h-fit min-w-4 flex justify-center items-center leading-none mt-0.5">
                {alerts.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={markAllRead} className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 transition">
                تحديد الكل كمقروء
              </button>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="max-h-[350px] overflow-y-auto px-1 py-1 custom-scrollbar">
            {loading ? (
              <div className="flex justify-center items-center py-10">
                <div className="h-6 w-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
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
                    onClick={() => {
                      markRead(al.id);
                      setOpen(false);
                    }}
                    className={`group flex gap-3 rounded-[16px] p-3 transition hover:bg-slate-50 dark:hover:bg-white/[0.03] ${
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
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 dark:border-white/[0.04] px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">تحديث كل 5 دقائق</span>
              <button type="button" onClick={fetchAlerts} className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700">
                تحديث الآن
              </button>
            </div>
            <Link
              to="/alerts"
              onClick={() => setOpen(false)}
              className="block text-center text-[11px] font-bold text-indigo-600 hover:text-indigo-700 transition"
            >
              عرض الكل
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
