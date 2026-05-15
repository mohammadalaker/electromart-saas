import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  PackagePlus,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Receipt,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { normalizeItemFromSupabase, roundMoney, runProductsSelectWithFallback } from '../utils/productModel';
import {
  PRE_ORDERS_TABLE,
  PRE_ORDER_LINES_TABLE,
  PRE_ORDER_STATUS_AR,
  getNextPreOrderNo,
} from '../utils/preOrders';
import { convertPreOrderToSale } from '../utils/preOrderToSale';

const CONTACTS = 'store_contacts';

function isMissingTable(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || '');
  return err.code === 'PGRST205' || err.code === '42P01' || /does not exist|schema cache/i.test(msg);
}

function newLine() {
  return { key: crypto.randomUUID(), productId: '', qty: '1', unit_price: '' };
}

export default function PreOrdersPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [error, setError] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [invoiceModal, setInvoiceModal] = useState(null);
  const [invoicePayMode, setInvoicePayMode] = useState('cash');
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [form, setForm] = useState({
    contact_id: '',
    deposit_amount: '',
    notes: '',
    lines: [newLine()],
  });

  const load = useCallback(async () => {
    if (!store?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: orders, error: oe } = await supabase
        .from(PRE_ORDERS_TABLE)
        .select('*')
        .eq('store_id', store.id)
        .order('created_at', { ascending: false })
        .limit(150);
      if (oe) {
        if (isMissingTable(oe)) {
          setMissingTable(true);
          setRows([]);
          return;
        }
        throw oe;
      }
      setMissingTable(false);
      const list = orders || [];
      const ids = list.map((o) => o.id);
      let linesByOrder = {};
      if (ids.length) {
        const { data: lines } = await supabase
          .from(PRE_ORDER_LINES_TABLE)
          .select('*')
          .in('pre_order_id', ids);
        for (const ln of lines || []) {
          if (!linesByOrder[ln.pre_order_id]) linesByOrder[ln.pre_order_id] = [];
          linesByOrder[ln.pre_order_id].push(ln);
        }
      }
      const contactIds = [...new Set(list.map((o) => o.contact_id))];
      const { data: contacts } = await supabase
        .from(CONTACTS)
        .select('id, name, phone')
        .in('id', contactIds);
      const cm = new Map((contacts || []).map((c) => [c.id, c]));
      const allLinePids = [
        ...new Set(
          Object.values(linesByOrder)
            .flat()
            .map((ln) => ln.product_id)
            .filter(Boolean)
        ),
      ];
      let productNameById = {};
      if (allLinePids.length) {
        const { data: prows } = await supabase
          .from(PRODUCTS_TABLE)
          .select('id, eng_name')
          .eq('store_id', store.id)
          .in('id', allLinePids);
        productNameById = Object.fromEntries((prows || []).map((p) => [p.id, p.eng_name]));
      }
      setRows(
        list.map((o) => ({
          ...o,
          _lines: (linesByOrder[o.id] || []).map((ln) => ({
            ...ln,
            _productName: productNameById[ln.product_id] || null,
          })),
          _contact: cm.get(o.contact_id),
        }))
      );
    } catch (e) {
      console.error(e);
      setError(e.message || 'تعذّر التحميل');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    load();
  }, [storeLoading, load]);

  useEffect(() => {
    if (!store?.id || !modalOpen) return;
    (async () => {
      const { data: c } = await supabase
        .from(CONTACTS)
        .select('id, name, phone')
        .eq('store_id', store.id)
        .eq('role', 'customer')
        .order('name');
      setCustomers(c || []);
      const { data: p } = await runProductsSelectWithFallback((sel) =>
        supabase
          .from(PRODUCTS_TABLE)
          .select(sel)
          .eq('store_id', store.id)
          .order('eng_name', { ascending: true })
          .limit(2000)
      );
      setProducts((p || []).map(normalizeItemFromSupabase).filter(Boolean));
    })();
  }, [store?.id, modalOpen]);

  const openModal = () => {
    setForm({ contact_id: '', deposit_amount: '', notes: '', lines: [newLine()] });
    setModalOpen(true);
  };

  const grandFromForm = useMemo(() => {
    let s = 0;
    for (const ln of form.lines) {
      const q = Math.max(1, parseInt(String(ln.qty).replace(/\D/g, ''), 10) || 1);
      const u = Math.max(0, parseFloat(String(ln.unit_price).replace(',', '.')) || 0);
      s += roundMoney(q * u);
    }
    return roundMoney(s);
  }, [form.lines]);

  const submitForm = async (e) => {
    e.preventDefault();
    if (!store?.id || missingTable) return;
    if (!form.contact_id) {
      setError('اختر الزبون');
      return;
    }
    const cleanLines = form.lines
      .filter((ln) => ln.productId)
      .map((ln) => {
        const q = Math.max(1, parseInt(String(ln.qty).replace(/\D/g, ''), 10) || 1);
        const u = Math.max(0, parseFloat(String(ln.unit_price).replace(',', '.')) || 0);
        return { product_id: ln.productId, qty: q, unit_price: u, line_total: roundMoney(q * u) };
      });
    if (!cleanLines.length) {
      setError('أضف سطراً واحداً على الأقل بصنف وكمية وسعر');
      return;
    }
    const dep = Math.max(0, parseFloat(String(form.deposit_amount).replace(',', '.')) || 0);
    const total = cleanLines.reduce((a, x) => a + x.line_total, 0);
    if (dep > total + 0.01) {
      setError('العربون لا يمكن أن يتجاوز إجمالي الحجز');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const orderNo = await getNextPreOrderNo(store.id);
      const { data: userData } = await supabase.auth.getUser();
      const header = {
        store_id: store.id,
        contact_id: form.contact_id,
        order_no: orderNo,
        status: dep > 0.01 ? 'deposit_paid' : 'open',
        deposit_amount: roundMoney(dep),
        grand_total: roundMoney(total),
        notes: form.notes.trim(),
        created_by: userData?.user?.id ?? null,
      };
      const { data: ins, error: ie } = await supabase
        .from(PRE_ORDERS_TABLE)
        .insert([header])
        .select('id')
        .single();
      if (ie) throw ie;
      const pid = ins.id;
      const lineRows = cleanLines.map((l) => ({
        pre_order_id: pid,
        product_id: l.product_id,
        qty: l.qty,
        unit_price: l.unit_price,
        line_total: l.line_total,
      }));
      const { error: le } = await supabase.from(PRE_ORDER_LINES_TABLE).insert(lineRows);
      if (le) throw le;
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err.message || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const submitInvoiceFromPreOrder = async (e) => {
    e.preventDefault();
    if (!store?.id || !invoiceModal) return;
    const o = invoiceModal;
    setInvoiceBusy(true);
    setError(null);
    try {
      const lines = (o._lines || []).map((ln) => ({
        product_id: ln.product_id,
        qty: ln.qty,
        unit_price: ln.unit_price,
      }));
      await convertPreOrderToSale(supabase, {
        storeId: store.id,
        preOrder: {
          id: o.id,
          contact_id: o.contact_id,
          grand_total: o.grand_total,
          order_no: o.order_no,
          notes: o.notes,
        },
        lines,
        paymentMode: invoicePayMode === 'credit' ? 'credit' : 'cash',
      });
      setInvoiceModal(null);
      setInvoicePayMode('cash');
      await load();
    } catch (err) {
      console.error(err);
      setError(err.message || 'تعذّر إصدار الفاتورة');
    } finally {
      setInvoiceBusy(false);
    }
  };

  const fulfillLine = async (lineId, preOrderId) => {
    if (!confirm('تأكيد تسليم هذا السطر للزبون (إغلاق الحجز لهذا الصنف)؟')) return;
    try {
      const { error: u1 } = await supabase
        .from(PRE_ORDER_LINES_TABLE)
        .update({ line_status: 'fulfilled' })
        .eq('id', lineId);
      if (u1) throw u1;
      const { data: rest } = await supabase
        .from(PRE_ORDER_LINES_TABLE)
        .select('line_status')
        .eq('pre_order_id', preOrderId);
      const allDone = (rest || []).length > 0 && (rest || []).every((x) => x.line_status === 'fulfilled');
      if (allDone) {
        await supabase
          .from(PRE_ORDERS_TABLE)
          .update({ status: 'fulfilled', updated_at: new Date().toISOString() })
          .eq('id', preOrderId);
      } else {
        await supabase
          .from(PRE_ORDERS_TABLE)
          .update({ updated_at: new Date().toISOString() })
          .eq('id', preOrderId);
      }
      await load();
    } catch (e) {
      toast.error(e.message || 'فشل التحديث');
    }
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
        <div className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center font-bold" dir="rtl">
          لا يوجد متجر مرتبط بحسابك.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap gap-2">
          <Link
            to="/purchases/lines"
            className="text-sm font-bold text-violet-600 hover:text-violet-800"
          >
            فاتورة مشتريات
          </Link>
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            تحديث
          </button>
          <button
            type="button"
            onClick={openModal}
            disabled={missingTable}
            className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 text-white px-4 py-2.5 text-sm font-bold disabled:opacity-50"
          >
            <Plus size={18} />
            حجز جديد
          </button>
        </div>
      }
    >
      <div className="max-w-6xl mx-auto space-y-5" dir="rtl">
        <div className="rounded-2xl border border-white/20 dark:border-gray-700/30 bg-white/80 dark:bg-gray-900/50 backdrop-blur-md p-6 shadow-sm">
          <h1 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
            <PackagePlus className="text-indigo-600 shrink-0" size={28} />
            الحجز المسبق والعربون
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed max-w-3xl">
            سجّل طلب زبون لصنف غير متوفر مع تحصيل عربون. عند إدخال فاتورة مشتريات لنفس الصنف يظهر تنبيه
            لربط الشحنة بالحجز.
          </p>
        </div>

        {missingTable && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex gap-2 text-sm text-amber-950">
            <AlertTriangle className="shrink-0" size={20} />
            <span>
              نفّذ <code className="px-1 rounded bg-white/90">supabase/pre_orders.sql</code> في Supabase.
            </span>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-indigo-500" size={36} />
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((o) => (
              <div
                key={o.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900/40 p-4 shadow-sm"
              >
                <div className="flex flex-wrap justify-between gap-2 mb-3">
                  <div>
                    <span className="text-xs font-bold text-slate-500">حجز #{o.order_no}</span>
                    <p className="font-black text-slate-900 dark:text-white">
                      {o._contact?.name || 'زبون'} —{' '}
                      <span className="font-mono text-sm font-bold" dir="ltr">
                        {o._contact?.phone || '—'}
                      </span>
                    </p>
                  </div>
                  <div className="text-left space-y-2">
                    <span
                      className={`inline-block rounded-full px-3 py-0.5 text-xs font-black ${
                        o.status === 'fulfilled'
                          ? 'bg-emerald-100 text-emerald-900'
                          : o.status === 'cancelled'
                            ? 'bg-slate-200 text-slate-700'
                            : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {PRE_ORDER_STATUS_AR[o.status] || o.status}
                    </span>
                    <p className="text-xs text-slate-500 mt-1 font-currency" dir="ltr">
                      إجمالي {'\u20AA'}
                      {Number(o.grand_total).toFixed(2)} · عربون {'\u20AA'}
                      {Number(o.deposit_amount).toFixed(2)}
                    </p>
                    {o.converted_sale_id ? (
                      <Link
                        to="/sales"
                        className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800"
                      >
                        <Receipt size={14} />
                        فاتورة البيع مُصدَرة — عرض المبيعات
                      </Link>
                    ) : ['open', 'deposit_paid'].includes(o.status) ? (
                      <button
                        type="button"
                        onClick={() => {
                          setInvoicePayMode('cash');
                          setInvoiceModal(o);
                        }}
                        className="inline-flex items-center gap-1 rounded-xl bg-violet-600 text-white px-3 py-1.5 text-xs font-bold"
                      >
                        <Receipt size={14} />
                        إصدار فاتورة بيع
                      </button>
                    ) : null}
                  </div>
                </div>
                {o.notes ? (
                  <p className="text-xs text-slate-600 mb-2">{o.notes}</p>
                ) : null}
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600">
                        <th className="text-right py-2 px-2">الصنف</th>
                        <th className="text-right py-2 px-2 w-16">الكمية</th>
                        <th className="text-right py-2 px-2">الحالة</th>
                        <th className="w-28" />
                      </tr>
                    </thead>
                    <tbody>
                      {o._lines.map((ln) => (
                        <tr key={ln.id} className="border-t border-slate-100">
                          <td className="py-2 px-2 text-slate-900 dark:text-slate-100" dir="rtl">
                            {ln._productName || (
                              <span className="font-mono text-[11px]" dir="ltr">
                                {ln.product_id?.slice(0, 8)}…
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2 font-currency">{ln.qty}</td>
                          <td className="py-2 px-2">
                            {ln.line_status === 'fulfilled' ? (
                              <span className="text-emerald-700 font-bold">مُسلَّم</span>
                            ) : (
                              <span className="text-amber-700 font-bold">معلق</span>
                            )}
                          </td>
                          <td className="py-2 px-2">
                            {ln.line_status === 'pending' &&
                            ['open', 'deposit_paid'].includes(o.status) ? (
                              <button
                                type="button"
                                onClick={() => fulfillLine(ln.id, o.id)}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-2 py-1 text-[11px] font-bold"
                              >
                                <CheckCircle2 size={12} />
                                تسليم
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {rows.length === 0 && !missingTable && (
              <p className="text-center text-slate-500 py-10">لا توجد حجوزات بعد.</p>
            )}
          </div>
        )}
      </div>

      {invoiceModal && (
        <div
          className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/50"
          onClick={() => !invoiceBusy && setInvoiceModal(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl border max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <h2 className="text-lg font-black mb-2">إصدار فاتورة بيع من الحجز</h2>
            <p className="text-xs text-slate-600 mb-4">
              حجز #{invoiceModal.order_no} — إجمالي {'\u20AA'}
              {Number(invoiceModal.grand_total).toFixed(2)}
            </p>
            <form onSubmit={submitInvoiceFromPreOrder} className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="text-xs font-bold text-slate-600 mb-1">طريقة التحصيل</legend>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="pay"
                    checked={invoicePayMode === 'cash'}
                    onChange={() => setInvoicePayMode('cash')}
                  />
                  نقدي (الصندوق الرئيسي)
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="pay"
                    checked={invoicePayMode === 'credit'}
                    onChange={() => setInvoicePayMode('credit')}
                  />
                  ذمّة (كشف الزبون)
                </label>
              </fieldset>
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                يُخصم المخزون لجميع أسطر الحجز. تأكد من توفر الكميات قبل التأكيد.
              </p>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  disabled={invoiceBusy}
                  onClick={() => setInvoiceModal(null)}
                  className="px-4 py-2 rounded-xl border text-sm font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={invoiceBusy}
                  className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold disabled:opacity-50"
                >
                  {invoiceBusy ? '...' : 'تأكيد وإصدار'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50" onClick={() => setModalOpen(false)}>
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl border max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <h2 className="text-lg font-black mb-4">حجز مسبق جديد</h2>
            <form onSubmit={submitForm} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-600">الزبون *</label>
                <select
                  required
                  value={form.contact_id}
                  onChange={(e) => setForm((p) => ({ ...p, contact_id: e.target.value }))}
                  className="w-full mt-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="">— اختر —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.phone}
                    </option>
                  ))}
                </select>
              </div>
              {form.lines.map((ln) => (
                <div key={ln.key} className="flex flex-wrap gap-2 items-end border border-slate-100 rounded-xl p-3">
                  <div className="flex-1 min-w-[140px]">
                    <label className="text-[10px] font-bold text-slate-500">الصنف</label>
                    <select
                      value={ln.productId}
                      onChange={(e) => setForm((p) => ({
                        ...p,
                        lines: p.lines.map((x) =>
                          x.key === ln.key ? { ...x, productId: e.target.value } : x
                        ),
                      }))}
                      className="w-full mt-1 rounded-lg border px-2 py-1.5 text-xs"
                    >
                      <option value="">—</option>
                      {products.map((pr) => (
                        <option key={pr.id} value={pr.id}>
                          {pr.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-20">
                    <label className="text-[10px] font-bold text-slate-500">كمية</label>
                    <input
                      value={ln.qty}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          lines: p.lines.map((x) =>
                            x.key === ln.key ? { ...x, qty: e.target.value } : x
                          ),
                        }))
                      }
                      className="w-full mt-1 rounded-lg border px-2 py-1.5 text-xs font-mono"
                      dir="ltr"
                    />
                  </div>
                  <div className="w-28">
                    <label className="text-[10px] font-bold text-slate-500">سعر الوحدة ₪</label>
                    <input
                      value={ln.unit_price}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          lines: p.lines.map((x) =>
                            x.key === ln.key ? { ...x, unit_price: e.target.value } : x
                          ),
                        }))
                      }
                      className="w-full mt-1 rounded-lg border px-2 py-1.5 text-xs font-mono"
                      dir="ltr"
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setForm((p) => ({ ...p, lines: [...p.lines, newLine()] }))
                }
                className="text-xs font-bold text-indigo-600"
              >
                + سطر
              </button>
              <div>
                <label className="text-xs font-bold text-slate-600">عربون (₪)</label>
                <input
                  value={form.deposit_amount}
                  onChange={(e) => setForm((p) => ({ ...p, deposit_amount: e.target.value }))}
                  className="w-full mt-1 rounded-xl border px-3 py-2 text-sm font-mono"
                  dir="ltr"
                  placeholder="0"
                />
              </div>
              <p className="text-sm font-bold text-slate-700 font-currency" dir="ltr">
                إجمالي مُقدَّر: ₪ {grandFromForm.toFixed(2)}
              </p>
              <div>
                <label className="text-xs font-bold text-slate-600">ملاحظات</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                  rows={2}
                  className="w-full mt-1 rounded-xl border px-3 py-2 text-sm"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 rounded-xl border text-sm font-bold">
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50"
                >
                  {saving ? '...' : 'حفظ الحجز'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
