import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote,
  Loader2,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { supabase } from '../../lib/supabaseClient';
import { useStore } from '../../context/StoreContext';
import ChecksRegistryTable from './ChecksRegistryTable';
import {
  CHECKS_REGISTRY_TABLE,
  fetchChecksRegistry,
  computeSummary,
  formatMoney,
} from './checksRegistryUtils';

export default function ChecksDashboardPage() {
  const { store, loading: storeLoading } = useStore();
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const loadChecks = useCallback(async () => {
    if (!store?.id) {
      setChecks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchChecksRegistry(store.id);
      setChecks(data);
    } catch (e) {
      setError(
        e.message ||
          'تعذّر تحميل الشيكات. نفّذ ملف supabase/checks_registry.sql في Supabase.'
      );
      setChecks([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    void loadChecks();
  }, [storeLoading, loadChecks]);

  const summary = useMemo(() => computeSummary(checks), [checks]);

  const pendingChecks = useMemo(
    () => checks.filter((c) => c.status === 'pending').sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))),
    [checks]
  );

  const updateStatus = async (id, status) => {
    setUpdatingId(id);
    const { error: err } = await supabase
      .from(CHECKS_REGISTRY_TABLE)
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('store_id', store.id);
    if (!err) {
      setChecks((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
    }
    setUpdatingId(null);
  };

  const deleteCheck = async (row) => {
    if (!window.confirm('حذف هذا الشيك من السجل؟')) return;
    setDeletingId(row.id);
    const { error: err } = await supabase
      .from(CHECKS_REGISTRY_TABLE)
      .delete()
      .eq('id', row.id)
      .eq('store_id', store.id);
    if (!err) {
      setChecks((prev) => prev.filter((c) => c.id !== row.id));
    }
    setDeletingId(null);
  };

  if (storeLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="animate-spin text-indigo-500" size={40} />
        </div>
      </DashboardLayout>
    );
  }

  if (!store?.id) {
    return (
      <DashboardLayout>
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-6 py-10 text-center font-bold text-amber-950" dir="rtl">
          لا يوجد متجر مرتبط بحسابك.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100">
              <Banknote className="h-6 w-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900">الشيكات والكمبيالات</h1>
              <p className="text-sm text-slate-500">نظرة عامة على الشيكات الواردة والصادرة</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadChecks()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <ArrowDownLeft className="h-4 w-4 text-blue-500" />
              شيكات واردة مستحقة
            </div>
            <p className="mt-2 text-2xl font-black text-slate-900" dir="ltr">
              ₪ {formatMoney(summary.incomingPending)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <ArrowUpRight className="h-4 w-4 text-violet-500" />
              شيكات صادرة مستحقة
            </div>
            <p className="mt-2 text-2xl font-black text-slate-900" dir="ltr">
              ₪ {formatMoney(summary.outgoingPending)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <CalendarClock className="h-4 w-4 text-amber-500" />
              مستحقة هذا الأسبوع
            </div>
            <p className="mt-2 text-2xl font-black text-amber-700" dir="ltr">
              ₪ {formatMoney(summary.dueThisWeek)}
            </p>
          </div>
          <div className="rounded-2xl border border-red-100 bg-red-50 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4" />
              شيكات متأخرة
            </div>
            <p className="mt-2 text-2xl font-black text-red-700" dir="ltr">
              ₪ {formatMoney(summary.overdue)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Link
            to="/checks/incoming"
            className="group rounded-2xl border border-blue-100 bg-gradient-to-l from-blue-50 to-white p-6 shadow-sm transition hover:border-blue-200 hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-blue-900">الشيكات الواردة</h2>
                <p className="mt-1 text-sm text-blue-700/80">شيكات من الزبائن — إضافة ومتابعة</p>
              </div>
              <ArrowDownLeft className="h-8 w-8 text-blue-400 transition group-hover:text-blue-600" />
            </div>
          </Link>
          <Link
            to="/checks/outgoing"
            className="group rounded-2xl border border-violet-100 bg-gradient-to-l from-violet-50 to-white p-6 shadow-sm transition hover:border-violet-200 hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-violet-900">الشيكات الصادرة</h2>
                <p className="mt-1 text-sm text-violet-700/80">شيكات للموردين — إصدار ومتابعة</p>
              </div>
              <ArrowUpRight className="h-8 w-8 text-violet-400 transition group-hover:text-violet-600" />
            </div>
          </Link>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="text-lg font-black text-slate-900">الشيكات القادمة (قيد الانتظار)</h2>
            <p className="text-xs text-slate-500 mt-0.5">مرتبة حسب تاريخ الاستحقاق</p>
          </div>
          <ChecksRegistryTable
            rows={pendingChecks}
            loading={loading}
            emptyMessage="لا توجد شيكات قيد الانتظار"
            showDirection
            onStatusChange={updateStatus}
            onDelete={deleteCheck}
            updatingId={updatingId}
            deletingId={deletingId}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
