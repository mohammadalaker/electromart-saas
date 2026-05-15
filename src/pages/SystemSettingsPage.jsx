import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Sun,
  Moon,
  Monitor,
  Layers,
  Store,
  Settings,
  ChevronLeft,
  Sparkles,
  ScanLine,
  Keyboard,
  Puzzle,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useStore } from '../context/StoreContext';
import { applyExplicitTheme, applySystemTheme, getStoredTheme } from '../lib/theme';
import { getBarcodeInputMode, setBarcodeInputMode } from '../lib/barcodeInputPrefs';
import { isModuleEnabled } from '../utils/storeEntitlements';
import { BRAND_THEME_EVENT } from '../constants/brand.js';

function themeModeFromStorage() {
  const s = getStoredTheme();
  if (s === 'dark' || s === 'light') return s;
  return 'system';
}

export default function SystemSettingsPage() {
  const { store, loading } = useStore();
  const [themeMode, setThemeMode] = useState(themeModeFromStorage);
  const [darkNow, setDarkNow] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
  );
  const [barcodeMode, setBarcodeMode] = useState(() => getBarcodeInputMode());

  useEffect(() => {
    const sync = () => {
      setThemeMode(themeModeFromStorage());
      setDarkNow(document.documentElement.classList.contains('dark'));
    };
    window.addEventListener(BRAND_THEME_EVENT, sync);
    return () => window.removeEventListener(BRAND_THEME_EVENT, sync);
  }, []);

  useEffect(() => {
    const sync = () => setBarcodeMode(getBarcodeInputMode());
    window.addEventListener('inventory-barcode-mode-change', sync);
    return () => window.removeEventListener('inventory-barcode-mode-change', sync);
  }, []);

  const setLight = () => {
    applyExplicitTheme('light');
    setThemeMode('light');
    setDarkNow(false);
  };
  const setDark = () => {
    applyExplicitTheme('dark');
    setThemeMode('dark');
    setDarkNow(true);
  };
  const setSystem = () => {
    applySystemTheme();
    setThemeMode('system');
    setDarkNow(document.documentElement.classList.contains('dark'));
  };

  const storefrontOn = isModuleEnabled(store, 'storefront');

  return (
    <DashboardLayout
      actions={
        <Link
          to="/overview"
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400"
        >
          <ChevronLeft size={18} />
          المركز التنفيذي
        </Link>
      }
    >
      <div className="mx-auto max-w-2xl space-y-6 pb-12" dir="rtl">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 text-white shadow-lg shadow-indigo-500/25">
            <Settings size={28} strokeWidth={2} />
          </div>
          <div>
            <h1 className="font-title text-2xl font-black text-slate-900 dark:text-white">إعدادات النظام</h1>
            <p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-400">
              المظهر، الباركود، الباقة، والمتجر العام — من مكان واحد.
            </p>
          </div>
        </div>

        {/* المظهر */}
        <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-white/10 dark:bg-gray-900/70">
          <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4 dark:border-slate-700/60 dark:bg-white/[0.04]">
            <div className="flex items-center gap-2">
              <Sparkles className="text-amber-500" size={20} />
              <h2 className="text-base font-black text-slate-900 dark:text-white">المظهر</h2>
            </div>
            <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
              الوضع الفاتح أو الداكن أو اتباع إعدادات جهازك.
            </p>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={setLight}
                className={`flex flex-col items-center gap-2 rounded-2xl border-2 px-4 py-4 transition-all ${
                  themeMode === 'light'
                    ? 'border-amber-400 bg-amber-50/90 shadow-md dark:border-amber-500/60 dark:bg-amber-950/40'
                    : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20'
                }`}
              >
                <Sun size={26} className="text-amber-500" />
                <span className="text-sm font-black text-slate-900 dark:text-white">وضع فاتح</span>
              </button>
              <button
                type="button"
                onClick={setDark}
                className={`flex flex-col items-center gap-2 rounded-2xl border-2 px-4 py-4 transition-all ${
                  themeMode === 'dark'
                    ? 'border-indigo-400 bg-indigo-50/90 shadow-md dark:border-indigo-500/50 dark:bg-indigo-950/50'
                    : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20'
                }`}
              >
                <Moon size={26} className="text-indigo-600 dark:text-indigo-400" />
                <span className="text-sm font-black text-slate-900 dark:text-white">وضع داكن</span>
              </button>
              <button
                type="button"
                onClick={setSystem}
                className={`flex flex-col items-center gap-2 rounded-2xl border-2 px-4 py-4 transition-all ${
                  themeMode === 'system'
                    ? 'border-teal-400 bg-teal-50/90 shadow-md dark:border-teal-500/50 dark:bg-teal-950/40'
                    : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20'
                }`}
              >
                <Monitor size={26} className="text-teal-600 dark:text-teal-400" />
                <span className="text-sm font-black text-slate-900 dark:text-white">حسب الجهاز</span>
              </button>
            </div>
            <p className="mt-4 text-center text-[11px] font-bold text-slate-500 dark:text-slate-400">
              المعاينة الحالية:{' '}
              <span className="text-slate-800 dark:text-slate-200">
                {darkNow ? 'مظهر داكن' : 'مظهر فاتح'}
                {themeMode === 'system' ? ' (من النظام)' : ''}
              </span>
            </p>
          </div>
        </section>

        {/* إدخال الباركود */}
        <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-white/10 dark:bg-gray-900/70">
          <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4 dark:border-slate-700/60 dark:bg-white/[0.04]">
            <div className="flex items-center gap-2">
              <ScanLine className="text-teal-600 dark:text-teal-400" size={20} />
              <h2 className="text-base font-black text-slate-900 dark:text-white">إدخال الباركود</h2>
            </div>
            <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
              نقطة البيع والجرد السريع: قارئ يعمل كلوحة مفاتيح، أو إدخال يدوي بدون تركيز تلقائي على الحقل.
            </p>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setBarcodeInputMode('scanner');
                  setBarcodeMode('scanner');
                }}
                className={`flex flex-col items-center gap-2 rounded-2xl border-2 px-4 py-4 transition-all ${
                  barcodeMode === 'scanner'
                    ? 'border-teal-400 bg-teal-50/90 shadow-md dark:border-teal-500/50 dark:bg-teal-950/40'
                    : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20'
                }`}
              >
                <ScanLine size={26} className="text-teal-600 dark:text-teal-400" />
                <span className="text-sm font-black text-slate-900 dark:text-white">قارئ باركود</span>
                <span className="text-center text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  تركيز تلقائي على حقل المسح في POS والجرد
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setBarcodeInputMode('manual');
                  setBarcodeMode('manual');
                }}
                className={`flex flex-col items-center gap-2 rounded-2xl border-2 px-4 py-4 transition-all ${
                  barcodeMode === 'manual'
                    ? 'border-amber-400 bg-amber-50/90 shadow-md dark:border-amber-500/50 dark:bg-amber-950/40'
                    : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20'
                }`}
              >
                <Keyboard size={26} className="text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-black text-slate-900 dark:text-white">يدوي</span>
                <span className="text-center text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  اضغط على الحقل ثم اكتب الباركود (مناسب للموبايل أو بدون قارئ)
                </span>
              </button>
            </div>
          </div>
        </section>

        {/* الباقة والوحدات */}
        <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-white/10 dark:bg-gray-900/70">
          <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4 dark:border-slate-700/60 dark:bg-white/[0.04]">
            <div className="flex items-center gap-2">
              <Layers className="text-indigo-600 dark:text-indigo-400" size={20} />
              <h2 className="text-base font-black text-slate-900 dark:text-white">الباقة والوحدات</h2>
            </div>
            <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
              تفعيل أو تعطيل أقسام النظام حسب اشتراكك.
            </p>
          </div>
          <div className="p-5">
            <Link
              to="/settings/plan"
              className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-gradient-to-l from-indigo-50/80 to-transparent px-4 py-4 transition-all hover:border-indigo-300 hover:shadow-md dark:border-white/10 dark:from-indigo-950/30 dark:hover:border-indigo-500/40"
            >
              <div>
                <p className="font-black text-slate-900 dark:text-white">إدارة الوحدات</p>
                <p className="mt-0.5 text-xs font-bold text-slate-500 dark:text-slate-400">
                  الباقة الحالية:{' '}
                  <span className="font-mono uppercase text-indigo-600 dark:text-indigo-400">
                    {loading ? '…' : store?.plan || 'free'}
                  </span>
                </p>
              </div>
              <ChevronLeft className="shrink-0 text-slate-400" size={20} />
            </Link>
          </div>
        </section>

        {/* المتجر العام */}
        <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-white/10 dark:bg-gray-900/70">
          <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4 dark:border-slate-700/60 dark:bg-white/[0.04]">
            <div className="flex items-center gap-2">
              <Store className="text-violet-600 dark:text-violet-400" size={20} />
              <h2 className="text-base font-black text-slate-900 dark:text-white">متجري العام</h2>
            </div>
            <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
              الرابط العام للزبائن وإعدادات الواجهة.
            </p>
          </div>
          <div className="p-5">
            {storefrontOn ? (
              <Link
                to="/settings/storefront"
                className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-gradient-to-l from-violet-50/80 to-transparent px-4 py-4 transition-all hover:border-violet-300 hover:shadow-md dark:border-white/10 dark:from-violet-950/30 dark:hover:border-violet-500/40"
              >
                <div>
                  <p className="font-black text-slate-900 dark:text-white">فتح إعدادات المتجر العام</p>
                  <p className="mt-0.5 text-xs font-bold text-slate-500 dark:text-slate-400">
                    الرابط، التفعيل، والمعاينة.
                  </p>
                </div>
                <ChevronLeft className="shrink-0 text-slate-400" size={20} />
              </Link>
            ) : (
              <div className="rounded-2xl border border-amber-200/80 bg-amber-50/80 px-4 py-4 text-sm font-bold text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
                هذه الوحدة غير مفعّلة في اشتراكك. فعّل «واجهة المتجر» من الباقة والوحدات أعلاه.
              </div>
            )}
          </div>
        </section>
        {/* التطبيقات والربط */}
        <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-white/10 dark:bg-gray-900/70">
          <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4 dark:border-slate-700/60 dark:bg-white/[0.04]">
            <div className="flex items-center gap-2">
              <Puzzle className="text-indigo-600 dark:text-indigo-400" size={20} />
              <h2 className="text-base font-black text-slate-900 dark:text-white">التطبيقات والربط</h2>
            </div>
            <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
              ربط النظام بمنصات خارجية كـ Shopify و WooCommerce، وبوابات الدفع الإلكتروني.
            </p>
          </div>
          <div className="p-5">
            <Link
              to="/settings/integrations"
              className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-gradient-to-l from-indigo-50/80 to-transparent px-4 py-4 transition-all hover:border-indigo-300 hover:shadow-md dark:border-white/10 dark:from-indigo-950/30 dark:hover:border-indigo-500/40"
            >
              <div>
                <p className="font-black text-slate-900 dark:text-white">فتح مركز التطبيقات والربط</p>
                <p className="mt-0.5 text-xs font-bold text-slate-500 dark:text-slate-400">
                  Shopify، WooCommerce، الدفع الإلكتروني.
                </p>
              </div>
              <ChevronLeft className="shrink-0 text-slate-400" size={20} />
            </Link>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
