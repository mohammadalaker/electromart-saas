import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import DashboardLayout from './DashboardLayout';
import { MODULE_LABELS_AR } from '../utils/storeEntitlements';

export default function ModuleLockedPage({ moduleKey }) {
  const title = MODULE_LABELS_AR[moduleKey] || moduleKey || 'هذه الصفحة';

  return (
    <DashboardLayout>
      <div
        className="max-w-lg mx-auto mt-16 rounded-2xl border border-amber-200 bg-amber-50/90 dark:bg-amber-950/30 dark:border-amber-800/50 px-6 py-10 text-center space-y-4"
        dir="rtl"
      >
        <div className="flex justify-center">
          <div className="rounded-full bg-amber-100 dark:bg-amber-900/50 p-4 text-amber-800 dark:text-amber-200">
            <Lock size={32} strokeWidth={2} />
          </div>
        </div>
        <h1 className="text-lg font-black text-slate-900 dark:text-white">{title}</h1>
        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          هذه الوحدة غير مفعّلة في اشتراك متجرك. للتفعيل أو الترقية، تواصل مع مزوّد النظام.
        </p>
        <Link
          to="/inventory"
          className="inline-flex items-center justify-center rounded-xl bg-indigo-600 text-white px-5 py-2.5 text-sm font-bold hover:bg-indigo-700"
        >
          العودة للوحة المخزن
        </Link>
      </div>
    </DashboardLayout>
  );
}
