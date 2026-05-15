import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  Wrench,
  Plus,
  RefreshCw,
  Phone,
  Calendar,
  Hash,
  MessageCircle,
  Search,
  AlertTriangle,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import {
  TICKETS_TABLE,
  STATUS_LABELS_AR,
  getNextTicketNo,
  lookupSaleBySerial,
  buildWhatsAppReadyUrl,
} from '../utils/serviceWarranty';
import { normalizeItemFromSupabase, runProductsSelectWithFallback } from '../utils/productModel';

function isMissingTable(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || '');
  return err.code === 'PGRST205' || err.code === '42P01' || /does not exist|schema cache/i.test(msg);
}

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-EG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return String(iso);
  }
}

function statusBadgeClass(st) {
  switch (st) {
    case 'ready_pickup':
      return 'bg-emerald-500/15 text-emerald-900 dark:text-emerald-100 ring-1 ring-emerald-500/35';
    case 'delivered':
      return 'bg-slate-500/15 text-slate-800 dark:text-slate-200';
    case 'waiting_parts':
      return 'bg-amber-500/15 text-amber-950 dark:text-amber-100';
    case 'repaired':
      return 'bg-sky-500/15 text-sky-900 dark:text-sky-100';
    case 'inspecting':
      return 'bg-violet-500/15 text-violet-900 dark:text-violet-100';
    case 'cancelled':
      return 'bg-rose-500/10 text-rose-800 dark:text-rose-200';
    default:
      return 'bg-indigo-500/10 text-indigo-900 dark:text-indigo-100';
  }
}

export default function ServiceCenterPage() {
  const toast = useToast();
  const { store, loading: storeLoading } = useStore();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    serial_number: '',
    customer_name: '',
    customer_phone: '',
    sale_date: '',
    product_id: '',
    symptom: '',
    contact_id: '',
  });
  const [customers, setCustomers] = useState([]);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupHint, setLookupHint] = useState(null);

  const [detail, setDetail] = useState(null);
  const [detailSaving, setDetailSaving] = useState(false);

  const load = useCallback(async () => {
    if (!store?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let q = supabase
        .from(TICKETS_TABLE)
        .select('*')
        .eq('store_id', store.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (filterStatus) q = q.eq('status', filterStatus);
      const { data, error: qErr } = await q;
      if (qErr) {
        if (isMissingTable(qErr)) {
          setMissingTable(true);
          setRows([]);
          return;
        }
        throw qErr;
      }
      setMissingTable(false);
      setRows(data || []);
    } catch (e) {
      console.error(e);
      setError(e.message || 'تعذّر التحميل');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id, filterStatus]);

  useEffect(() => {
    if (storeLoading) return;
    load();
  }, [storeLoading, load]);

  const [productOptions, setProductOptions] = useState([]);

  useEffect(() => {
    if (!store?.id || !modalOpen) return;
    (async () => {
      const { data } = await runProductsSelectWithFallback((sel) =>
        supabase
          .from(PRODUCTS_TABLE)
          .select(sel)
          .eq('store_id', store.id)
          .order('eng_name', { ascending: true })
          .limit(500)
      );
      setProductOptions((data || []).map(normalizeItemFromSupabase).filter(Boolean));
      const { data: cust } = await supabase
        .from('store_contacts')
        .select('id, name, phone')
        .eq('store_id', store.id)
        .eq('role', 'customer')
        .order('name');
      setCustomers(cust || []);
    })();
  }, [store?.id, modalOpen]);

  const runSerialLookup = async () => {
    const sn = form.serial_number.trim();
    if (!sn || !store?.id) return;
    setLookupBusy(true);
    setLookupHint(null);
    try {
      const hit = await lookupSaleBySerial(store.id, sn);
      if (hit?.sale_id) {
        setForm((p) => ({
          ...p,
          sale_date: hit.sale_date || p.sale_date,
          product_id: hit.product_id ? String(hit.product_id) : p.product_id,
          contact_id: hit.contact_id ? String(hit.contact_id) : p.contact_id,
        }));
        let phone = '';
        let name = '';
        const { data: sale } = await supabase
          .from('sales')
          .select('contact_id')
          .eq('id', hit.sale_id)
          .maybeSingle();
        if (sale?.contact_id) {
          const { data: c } = await supabase
            .from('store_contacts')
            .select('name, phone')
            .eq('id', sale.contact_id)
            .maybeSingle();
          if (c) {
            name = c.name || '';
            phone = c.phone || '';
          }
        }
        if (name || phone) {
          setForm((p) => ({
            ...p,
            customer_name: name || p.customer_name,
            customer_phone: phone || p.customer_phone,
          }));
        }
        setLookupHint('وُجدت فاتورة مرتبطة بهذا السيريال — عُدّلت بعض الحقول تلقائياً.');
      } else {
        setLookupHint('لم يُعثر على فاتورة تحتوي هذا السيريال في sales_items — يمكنك المتابعة يدوياً.');
      }
    } catch (e) {
      setLookupHint(e.message || 'تعذّر البحث');
    } finally {
      setLookupBusy(false);
    }
  };

  const openNew = () => {
    setForm({
      serial_number: '',
      customer_name: '',
      customer_phone: '',
      sale_date: new Date().toISOString().slice(0, 10),
      product_id: '',
      symptom: '',
      contact_id: '',
    });
    setLookupHint(null);
    setModalOpen(true);
  };

  const submitNew = async (e) => {
    e.preventDefault();
    if (!store?.id || missingTable) return;
    const serial = form.serial_number.trim();
    if (!serial) {
      setError('أدخل رقم السيريال');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const ticketNo = await getNextTicketNo(store.id);
      const prod = productOptions.find((p) => p.id === form.product_id);
      const payload = {
        store_id: store.id,
        ticket_no: ticketNo,
        serial_number: serial.slice(0, 200),
        sale_id: null,
        product_id: form.product_id || null,
        product_name_snapshot: prod?.name || '',
        sale_date: form.sale_date || null,
        customer_name: form.customer_name.trim(),
        customer_phone: form.customer_phone.trim(),
        symptom: form.symptom.trim(),
        status: 'intake',
        contact_id: form.contact_id || null,
      };

      const hit = await lookupSaleBySerial(store.id, serial);
      if (hit?.sale_id) payload.sale_id = hit.sale_id;
      if (!payload.sale_date && hit?.sale_date) payload.sale_date = hit.sale_date;
      if (!payload.product_id && hit?.product_id) payload.product_id = hit.product_id;

      const { data: userData } = await supabase.auth.getUser();
      payload.created_by = userData?.user?.id ?? null;

      let { error: insErr } = await supabase.from(TICKETS_TABLE).insert([payload]);
      if (insErr && /contact_id|column|schema|PGRST204/i.test(String(insErr.message || ''))) {
        const rest = { ...payload };
        delete rest.contact_id;
        ({ error: insErr } = await supabase.from(TICKETS_TABLE).insert([rest]));
      }
      if (insErr) throw insErr;
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err.message || 'فشل إنشاء التذكرة');
    } finally {
      setSaving(false);
    }
  };

  const updateTicket = async (patch) => {
    if (!detail?.id || !store?.id) return;
    setDetailSaving(true);
    try {
      const { error: uErr } = await supabase
        .from(TICKETS_TABLE)
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
        })
        .eq('id', detail.id)
        .eq('store_id', store.id);
      if (uErr) throw uErr;
      const { data: fresh } = await supabase
        .from(TICKETS_TABLE)
        .select('*')
        .eq('id', detail.id)
        .single();
      setDetail(fresh);
      await load();
    } catch (e) {
      toast.error(e.message || 'فشل التحديث');
    } finally {
      setDetailSaving(false);
    }
  };

  const waUrl =
    detail && detail.status === 'ready_pickup'
      ? buildWhatsAppReadyUrl(detail.customer_phone, {
          ticketNo: detail.ticket_no,
          serial: detail.serial_number,
          storeName: store?.name,
        })
      : null;

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
        <div
          className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center text-amber-950 font-bold"
          dir="rtl"
        >
          لا يوجد متجر مرتبط بحسابك.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            تحديث
          </button>
          <button
            type="button"
            onClick={openNew}
            disabled={missingTable}
            className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 text-white px-4 py-2.5 text-sm font-bold shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            <Plus size={18} />
            طلب صيانة جديد
          </button>
        </div>
      }
    >
      <div className="max-w-6xl mx-auto space-y-5" dir="rtl">
        <div className="rounded-2xl border border-white/20 dark:border-gray-700/30 bg-white/80 dark:bg-gray-900/50 backdrop-blur-md p-6 shadow-sm">
          <h1 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
            <Wrench className="text-indigo-600 shrink-0" size={28} />
            طلبات الصيانة والضمان
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed max-w-3xl">
            سجّل الأجهزة المعطّلة مع السيريال وربطها بالزبون (من الدليل أو يدوياً)، وتتبّع حالة التصليح حتى التسليم.
            يمكن الربط التلقائي بفاتورة البيع عند البحث بالسيريال.
          </p>
        </div>

        {missingTable && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex gap-3 items-start text-sm text-amber-950">
            <AlertTriangle className="shrink-0 mt-0.5" size={20} />
            <p>
              الجدول غير منشأ. نفّذ <code className="px-1 rounded bg-white/90">supabase/service_warranty_tickets.sql</code>{' '}
              في SQL Editor.
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500">تصفية الحالة:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
          >
            <option value="">الكل</option>
            {Object.entries(STATUS_LABELS_AR).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-indigo-500" size={36} />
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-gray-900/40 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300">
                    <th className="text-right py-3 px-3 font-bold">#</th>
                    <th className="text-right py-3 px-3 font-bold">السيريال</th>
                    <th className="text-right py-3 px-3 font-bold">الزبون</th>
                    <th className="text-right py-3 px-3 font-bold">الحالة</th>
                    <th className="text-right py-3 px-3 font-bold">تاريخ البيع</th>
                    <th className="text-right py-3 px-3 font-bold">آخر تحديث</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-500">
                        لا توجد تذاكر بعد.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-t border-slate-100 dark:border-slate-800 cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                        onClick={() => setDetail(r)}
                      >
                        <td className="py-2.5 px-3 font-mono font-bold">{r.ticket_no}</td>
                        <td className="py-2.5 px-3 font-mono text-xs" dir="ltr">
                          {r.serial_number}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold">{r.customer_name || '—'}</div>
                          <div className="text-xs text-slate-500 font-mono" dir="ltr">
                            {r.customer_phone || ''}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-flex rounded-lg px-2 py-0.5 text-xs font-black ${statusBadgeClass(r.status)}`}
                          >
                            {STATUS_LABELS_AR[r.status] || r.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs" dir="ltr">
                          {r.sale_date || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-slate-500">{formatWhen(r.updated_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl border border-slate-200 dark:border-slate-700 max-w-lg w-full p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <h2 className="text-lg font-black text-slate-900 dark:text-white mb-4">طلب صيانة جديد</h2>
            <form onSubmit={submitNew} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-600">زبون من الدليل (اختياري)</label>
                <select
                  value={form.contact_id}
                  onChange={(e) => {
                    const id = e.target.value;
                    const c = customers.find((x) => x.id === id);
                    setForm((p) => ({
                      ...p,
                      contact_id: id,
                      customer_name: c ? c.name || p.customer_name : p.customer_name,
                      customer_phone: c ? c.phone || p.customer_phone : p.customer_phone,
                    }));
                  }}
                  className="w-full mt-1 rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm bg-white dark:bg-slate-800"
                >
                  <option value="">— بدون ربط —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.phone || c.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600">رقم السيريال / IMEI *</label>
                <div className="flex gap-2 mt-1">
                  <input
                    value={form.serial_number}
                    onChange={(e) => setForm((p) => ({ ...p, serial_number: e.target.value }))}
                    className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono"
                    dir="ltr"
                    required
                  />
                  <button
                    type="button"
                    onClick={runSerialLookup}
                    disabled={lookupBusy || !form.serial_number.trim()}
                    className="shrink-0 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-800 px-3 py-2 text-xs font-bold flex items-center gap-1"
                  >
                    <Search size={14} />
                    {lookupBusy ? '...' : 'ربط'}
                  </button>
                </div>
                {lookupHint && <p className="text-[11px] text-slate-600 mt-1">{lookupHint}</p>}
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600">اسم الزبون</label>
                  <input
                    value={form.customer_name}
                    onChange={(e) => setForm((p) => ({ ...p, customer_name: e.target.value }))}
                    className="w-full mt-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600">الهاتف</label>
                  <input
                    value={form.customer_phone}
                    onChange={(e) => setForm((p) => ({ ...p, customer_phone: e.target.value }))}
                    className="w-full mt-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono"
                    dir="ltr"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600">تاريخ البيع (إن وُجد)</label>
                <input
                  type="date"
                  value={form.sale_date}
                  onChange={(e) => setForm((p) => ({ ...p, sale_date: e.target.value }))}
                  className="w-full mt-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600">الصنف (اختياري)</label>
                <select
                  value={form.product_id}
                  onChange={(e) => setForm((p) => ({ ...p, product_id: e.target.value }))}
                  className="w-full mt-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  {productOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600">وصف العطل</label>
                <textarea
                  value={form.symptom}
                  onChange={(e) => setForm((p) => ({ ...p, symptom: e.target.value }))}
                  rows={3}
                  className="w-full mt-1 rounded-xl border border-slate-200 px-3 py-2 text-sm resize-y"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50"
                >
                  {saving ? 'جاري الحفظ...' : 'إنشاء'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detail && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setDetail(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl border border-slate-200 dark:border-slate-700 max-w-lg w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div className="flex items-start justify-between gap-2 mb-4">
              <div>
                <p className="text-xs font-bold text-slate-500 flex items-center gap-1">
                  <Hash size={14} />
                  تذكرة {detail.ticket_no}
                </p>
                <p className="text-lg font-black text-slate-900 dark:text-white mt-1">
                  {detail.product_name_snapshot || 'جهاز'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="text-sm font-bold text-slate-500 hover:text-slate-800"
              >
                إغلاق
              </button>
            </div>

            <div className="space-y-2 text-sm mb-4">
              <p className="flex items-center gap-2 font-mono text-xs" dir="ltr">
                <span className="text-slate-500 font-sans">سيريال:</span> {detail.serial_number}
              </p>
              {(detail.customer_name || detail.customer_phone) && (
                <p className="flex items-center gap-2">
                  <Phone size={14} className="shrink-0 text-slate-400" />
                  {detail.customer_name} —{' '}
                  <span className="font-mono" dir="ltr">
                    {detail.customer_phone}
                  </span>
                </p>
              )}
              {detail.sale_date && (
                <p className="flex items-center gap-2 text-slate-600">
                  <Calendar size={14} />
                  تاريخ البيع: <span dir="ltr">{detail.sale_date}</span>
                </p>
              )}
              {detail.symptom ? (
                <p className="text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/80 rounded-xl p-3 text-xs">
                  {detail.symptom}
                </p>
              ) : null}
            </div>

            <label className="block text-xs font-bold text-slate-600 mb-1">الحالة</label>
            <select
              value={detail.status}
              disabled={detailSaving}
              onChange={(e) => {
                const st = e.target.value;
                const patch = { status: st };
                if (st === 'delivered') patch.delivered_at = new Date().toISOString();
                updateTicket(patch);
              }}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm mb-3"
            >
              {Object.entries(STATUS_LABELS_AR).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>

            <label className="block text-xs font-bold text-slate-600 mb-1">ملاحظات داخلية</label>
            <textarea
              value={detail.internal_notes || ''}
              disabled={detailSaving}
              onChange={(e) => setDetail((d) => ({ ...d, internal_notes: e.target.value }))}
              onBlur={(e) => updateTicket({ internal_notes: e.target.value })}
              rows={3}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm mb-4 resize-y"
            />

            {detail.status === 'ready_pickup' && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 dark:bg-emerald-950/30 dark:border-emerald-800 p-4 space-y-3">
                <p className="text-xs font-bold text-emerald-900 dark:text-emerald-100">
                  إشعار الزبون بالجاهزية
                </p>
                {waUrl ? (
                  <>
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 text-sm"
                    >
                      <MessageCircle size={20} />
                      فتح واتساب مع رسالة جاهزة
                    </a>
                    <button
                      type="button"
                      disabled={detailSaving}
                      onClick={() => updateTicket({ ready_notified_at: new Date().toISOString() })}
                      className="w-full rounded-xl border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 text-emerald-900 dark:text-emerald-100 font-bold py-2 text-xs"
                    >
                      تسجيل أنه تم إبلاغ الزبون
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-amber-800">أضف رقم هاتف صالح للزبون لإنشاء رابط واتساب.</p>
                )}
                {detail.ready_notified_at && (
                  <p className="text-[11px] text-slate-600">
                    آخر تسجيل إشعار: {formatWhen(detail.ready_notified_at)}
                  </p>
                )}
              </div>
            )}

            {detail.status === 'repaired' && (
              <p className="text-xs text-slate-500 mb-2">
                غيّر الحالة إلى «جاهز للتسليم» لإظهار زر واتساب للزبون.
              </p>
            )}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
