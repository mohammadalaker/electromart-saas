import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Loader2, Plus, Search, ChevronRight } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { supabase } from '../../lib/supabaseClient';
import { useStore } from '../../context/StoreContext';
import ChecksRegistryTable from './ChecksRegistryTable';
import {
  CHECKS_REGISTRY_TABLE,
  fetchChecksRegistry,
  fetchContactsByRole,
  parseMoney,
  contactName,
} from './checksRegistryUtils';

const freshForm = () => ({
  contactId: '',
  check_number: '',
  bank_name: '',
  amount: '',
  issue_date: new Date().toISOString().slice(0, 10),
  due_date: new Date().toISOString().slice(0, 10),
  notes: '',
});

export default function OutgoingChecksPage() {
  const { store, loading: storeLoading } = useStore();
  const [checks, setChecks] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(() => freshForm());
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const loadData = useCallback(async () => {
    if (!store?.id) {
      setChecks([]);
      setContacts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [rows, sup] = await Promise.all([
        fetchChecksRegistry(store.id, { direction: 'outgoing' }),
        fetchContactsByRole(store.id, 'supplier'),
      ]);
      setChecks(rows);
      setContacts(sup);
    } catch (e) {
      setError(e.message || 'تعذّر تحميل البيانات');
      setChecks([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    void loadData();
  }, [storeLoading, loadData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return checks.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (!q) return true;
      const name = contactName(row).toLowerCase();
      const num = String(row.check_number || '').toLowerCase();
      return name.includes(q) || num.includes(q);
    });
  }, [checks, statusFilter, search]);

  const submitForm = async (e) => {
    e.preventDefault();
    if (!store?.id) return;
    const amount = parseMoney(form.amount);
    if (!form.contactId) {
      setError('اختر المورد');
      return;
    }
    if (!form.check_number.trim()) {
      setError('أدخل رقم الشيك');
      return;
    }
    if (amount <= 0) {
      setError('أدخل مبلغاً صحيحاً');
      return;
    }
    setSubmitting(true);
    setError(null);
    const { data, error: err } = await supabase
      .from(CHECKS_REGISTRY_TABLE)
      .insert({
        store_id: store.id,
        direction: 'outgoing',
        status: 'pending',
        contact_id: form.contactId,
        check_number: form.check_number.trim(),
        bank_name: form.bank_name.trim(),
        amount,
        issue_date: form.issue_date || null,
        due_date: form.due_date || new Date().toISOString().slice(0, 10),
        notes: form.notes.trim(),
      })
      .select(
        'id, store_id, direction, status, contact_id, check_number, bank_name, amount, issue_date, due_date, notes, created_at, store_contacts ( id, name, role )'
      )
      .single();

    if (err) {
      setError(err.message);
    } else if (data) {
      const contact = Array.isArray(data.store_contacts) ? data.store_contacts[0] : data.store_contacts;
      setChecks((prev) => [{ ...data, store_contacts: contact || null }, ...prev]);
      setForm(freshForm());
    }
    setSubmitting(false);
  };

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
    if (!window.confirm('حذف هذا الشيك؟')) return;
    setDeletingId(row.id);
    const { error: err } = await supabase
      .from(CHECKS_REGISTRY_TABLE)
      .delete()
      .eq('id', row.id)
      .eq('store_id', store.id);
    if (!err) setChecks((prev) => prev.filter((c) => c.id !== row.id));
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

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6" dir="rtl">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/checks"
            className="inline-flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-indigo-600"
          >
            <ChevronRight size={16} />
            لوحة الشيكات
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100">
            <ArrowUpRight className="h-6 w-6 text-violet-600" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900">الشيكات الصادرة</h1>
            <p className="text-sm text-slate-500">شيكات صادرة للموردين</p>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
            {error}
          </div>
        )}

        <form
          onSubmit={submitForm}
          className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm space-y-4"
        >
          <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
            <Plus size={18} className="text-violet-600" />
            إضافة شيك صادر
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-600">اختر المورد</span>
              <select
                value={form.contactId}
                onChange={(e) => setForm((f) => ({ ...f, contactId: e.target.value }))}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold"
                required
              >
                <option value="">— اختر —</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-600">رقم الشيك</span>
              <input
                value={form.check_number}
                onChange={(e) => setForm((f) => ({ ...f, check_number: e.target.value }))}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                dir="ltr"
                required
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-600">البنك</span>
              <input
                value={form.bank_name}
                onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-600">المبلغ (₪)</span>
              <input
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-mono"
                dir="ltr"
                inputMode="decimal"
                required
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-600">تاريخ الإصدار</span>
              <input
                type="date"
                value={form.issue_date}
                onChange={(e) => setForm((f) => ({ ...f, issue_date: e.target.value }))}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-600">تاريخ الاستحقاق</span>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                required
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2 lg:col-span-3">
              <span className="text-xs font-bold text-slate-600">ملاحظات</span>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm resize-none"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-black text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {submitting ? 'جاري الحفظ…' : 'حفظ الشيك'}
          </button>
        </form>

        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-4">
            <h2 className="text-lg font-black text-slate-900">سجل الشيكات الصادرة</h2>
            <div className="mr-auto flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث بالاسم أو رقم الشيك…"
                  className="w-56 rounded-xl border border-slate-200 py-2 pr-9 pl-3 text-sm"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
              >
                <option value="all">كل الحالات</option>
                <option value="pending">قيد الانتظار</option>
                <option value="cashed">تم الصرف</option>
                <option value="bounced">مرتجع</option>
                <option value="cancelled">ملغي</option>
              </select>
            </div>
          </div>
          <ChecksRegistryTable
            rows={filtered}
            loading={loading}
            showDirection={false}
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
