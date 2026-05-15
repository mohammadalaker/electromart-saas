import { useCallback, useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';
import PurchaseCreditDueAlerts from './PurchaseCreditDueAlerts';
import SystemAlerts from './SystemAlerts';
import { useStore } from '../context/StoreContext';
import { supabase } from '../lib/supabaseClient';

import { brandStorageKey } from '../constants/brand.js';

const SIDEBAR_COLLAPSED_KEY = brandStorageKey('sidebar-collapsed');

function readSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export default function DashboardLayout({ actions, children }) {
  const { store, loading: storeLoading } = useStore();
  const [greetingName, setGreetingName] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    typeof window !== 'undefined' ? readSidebarCollapsed() : false
  );

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? 'true' : 'false');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled || !data?.user) return;
      const meta = data.user.user_metadata || {};
      const fromMeta =
        meta.full_name ||
        meta.name ||
        meta.display_name ||
        '';
      const fromEmail = data.user.email?.split('@')[0] || '';
      const label = String(fromMeta || fromEmail || '').trim();
      setGreetingName(label);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="relative flex h-screen bg-slate-50 dark:bg-slate-950 font-arabic overflow-hidden antialiased"
      dir="rtl"
    >
      <Sidebar collapsible collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} />

      {sidebarCollapsed && (
        <button
          type="button"
          onClick={toggleSidebar}
          className="fixed z-50 top-1/2 -translate-y-1/2 right-0 flex h-14 w-12 items-center justify-center rounded-l-2xl border border-slate-200/90 border-r-0 bg-white/95 py-3 pl-1 pr-0.5 shadow-[0_4px_24px_-4px_rgba(15,23,42,0.15)] backdrop-blur-md transition hover:bg-indigo-50 dark:border-gray-700/50 dark:bg-gray-900/95 dark:hover:bg-indigo-950/50"
          title="إظهار لوحة التحكم"
          aria-label="إظهار لوحة التحكم والقائمة"
        >
          <Menu className="h-6 w-6 text-indigo-600 dark:text-indigo-400" strokeWidth={2.25} />
        </button>
      )}

      <main className="min-w-0 flex-1 overflow-y-auto transition-[padding] duration-300">
        <div
          className={`p-4 sm:p-6 mx-auto w-full transition-[max-width] duration-300 ${
            sidebarCollapsed ? 'max-w-[1920px]' : 'max-w-[1600px]'
          }`}
        >
          {/* Welcome — SaaS hero */}
          <header className="group relative mb-4 flex flex-col gap-4 overflow-hidden rounded-3xl border border-white/50 bg-white/80 p-6 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.1)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_48px_-12px_rgba(0,0,0,0.2)] sm:flex-row sm:items-center sm:justify-between sm:p-7 dark:border-white/10 dark:bg-gray-900/65 dark:shadow-[0_8px_32px_-12px_rgba(0,0,0,0.45)] dark:hover:shadow-[0_16px_48px_-12px_rgba(0,0,0,0.55)]">
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-l from-indigo-50/90 via-white to-white dark:from-indigo-950/40 dark:via-gray-900/30 dark:to-gray-900/20"
              aria-hidden
            />
            <div className="relative z-[1] flex min-w-0 flex-1 items-start gap-3">
              {sidebarCollapsed && (
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200/90 bg-white/90 text-indigo-600 shadow-sm transition hover:bg-indigo-50 dark:border-white/10 dark:bg-white/10 dark:text-indigo-300 dark:hover:bg-white/15"
                  title="إظهار لوحة التحكم"
                  aria-label="إظهار لوحة التحكم والقائمة"
                >
                  <Menu className="h-6 w-6" strokeWidth={2.25} />
                </button>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-500 dark:text-indigo-400 mb-2">
                  Dashboard
                </p>
                <h2 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white tracking-tight leading-tight">
                  {storeLoading ? (
                    <span className="inline-block h-9 w-56 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
                  ) : (
                    <>مرحباً بك في {store?.name || 'متجرك'}</>
                  )}
                </h2>
                {/* ✅ التعديل هون: الاسم بـ badge منفصل + اتجاه LTR */}
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-2 max-w-xl leading-relaxed flex flex-wrap items-center gap-2">
                  {greetingName ? (
                    <>
                      أهلاً
                      <span dir="ltr" className="inline-flex items-center gap-2 mx-0.5 align-middle">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-lg font-bold text-white shadow-lg">
                          {(greetingName.trim().charAt(0) || '?').toUpperCase()}
                        </div>
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {greetingName}
                        </span>
                      </span>
                      <span>👋 إليك حالة متجرك لهذا اليوم — نتمنى لك يوماً مثمراً.</span>
                    </>
                  ) : (
                    'إليك حالة متجرك لهذا اليوم — نتمنى لك يوماً مثمراً.'
                  )}
                </p>
              </div>
            </div>
            <div className="relative flex flex-wrap shrink-0 items-center gap-3 mt-4 sm:mt-0">
              {actions}
              <SystemAlerts />
            </div>
          </header>

          <PurchaseCreditDueAlerts />

          {children}
        </div>
      </main>
    </div>
  );
}