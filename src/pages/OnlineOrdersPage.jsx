import { useEffect, useState, useMemo } from 'react';
import { Loader2, Package, Phone, User, MapPin, MessageSquare, ChevronDown, FileText } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import WhatsAppButton from '../components/WhatsAppButton';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { generateInvoicePDF } from '../utils/generatePDF';
import {
  parseOrderCustomer,
  buildOrderReadyMessage,
  buildDeliveryAssignedMessage,
} from '../utils/whatsapp';

const STATUS_MAP = {
  pending: { label: 'قيد المعالجة', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  confirmed: { label: 'تم التأكيد', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  ready: { label: 'جاهز للاستلام', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  delivered: { label: 'تم التسليم', color: 'bg-teal-100 text-teal-700 border-teal-200' },
  cancelled: { label: 'ملغي', color: 'bg-red-100 text-red-700 border-red-200' },
};

function getOrderUiStatus(order) {
  const raw = order.order_status ?? order.status ?? 'pending_online';
  if (raw === 'pending_online' || raw === 'pending') return 'pending';
  if (raw === 'ready') return 'ready';
  if (raw === 'confirmed') return 'confirmed';
  if (raw === 'delivered') return 'delivered';
  if (raw === 'cancelled') return 'cancelled';
  return 'pending';
}

function uiStatusToDb(uiStatus) {
  if (uiStatus === 'pending') return 'pending_online';
  return uiStatus;
}

function orderNumberLabel(orderId) {
  return String(orderId || '').slice(0, 8).toUpperCase();
}

export default function OnlineOrdersPage() {
  const { store } = useStore();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [updatingId, setUpdatingId] = useState(null);
  const [companies, setCompanies] = useState([]);

  useEffect(() => {
    if (!store?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('sales')
        .select(
          'id, store_id, created_at, total_amount, notes, line_items, order_status, status, customer_name, customer_phone, customer_address, delivery_company_id, delivery_status, is_online_order'
        )
        .eq('store_id', store.id)
        .eq('is_online_order', true)
        .order('created_at', { ascending: false })
        .limit(200);
      const { data: comp } = await supabase
        .from('store_delivery_companies')
        .select('id, name')
        .eq('store_id', store.id)
        .eq('is_active', true);
      if (!cancelled) {
        setOrders(error ? [] : data || []);
        setCompanies(comp || []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store?.id]);

  const filtered = useMemo(() => {
    if (filterStatus === 'all') return orders;
    return orders.filter((o) => getOrderUiStatus(o) === filterStatus);
  }, [orders, filterStatus]);

  const updateStatus = async (id, newUiStatus) => {
    setUpdatingId(id);
    const dbStatus = uiStatusToDb(newUiStatus);
    let savedOrderStatus = dbStatus;
    let { error } = await supabase
      .from('sales')
      .update({ order_status: dbStatus })
      .eq('id', id)
      .eq('store_id', store.id);

    if (error && /order_status|column|schema|PGRST204/i.test(String(error.message || ''))) {
      ({ error } = await supabase
        .from('sales')
        .update({ status: newUiStatus })
        .eq('id', id)
        .eq('store_id', store.id));
    } else if (error && dbStatus === 'ready') {
      ({ error } = await supabase
        .from('sales')
        .update({ order_status: 'confirmed' })
        .eq('id', id)
        .eq('store_id', store.id));
      if (!error) savedOrderStatus = 'confirmed';
    }

    if (!error) {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === id
            ? {
                ...o,
                order_status: savedOrderStatus,
                status: newUiStatus,
              }
            : o
        )
      );
    }
    setUpdatingId(null);
  };

  const assignCompany = async (orderId, companyId) => {
    await supabase
      .from('sales')
      .update({
        delivery_company_id: companyId || null,
        delivery_status: companyId ? 'assigned' : 'pending',
        delivery_assigned_at: companyId ? new Date().toISOString() : null,
      })
      .eq('id', orderId);
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? {
              ...o,
              delivery_company_id: companyId || null,
              delivery_status: companyId ? 'assigned' : 'pending',
            }
          : o
      )
    );
  };

  const counts = useMemo(() => {
    const c = { all: orders.length, pending: 0, confirmed: 0, ready: 0, delivered: 0, cancelled: 0 };
    orders.forEach((o) => {
      const key = getOrderUiStatus(o);
      c[key] = (c[key] || 0) + 1;
    });
    return c;
  }, [orders]);

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
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden dark:bg-gray-900/40 dark:border-white/10">
          <div className="px-6 py-4 flex items-center gap-3 border-b border-slate-100 bg-gradient-to-l from-violet-50/50 to-white dark:from-violet-950/30 dark:to-gray-900">
            <div className="h-11 w-11 rounded-xl bg-violet-600 text-white flex items-center justify-center shadow-lg">
              <Package size={22} />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 dark:text-white">الطلبات الأونلاين</h1>
              <p className="text-xs text-slate-500 mt-0.5">إدارة طلبات المتجر العام</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-6 divide-x divide-x-reverse divide-slate-100 dark:divide-white/5">
            {[
              { key: 'all', label: 'الكل' },
              { key: 'pending', label: 'قيد المعالجة' },
              { key: 'confirmed', label: 'مؤكدة' },
              { key: 'ready', label: 'جاهزة' },
              { key: 'delivered', label: 'مسلّمة' },
              { key: 'cancelled', label: 'ملغية' },
            ].map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setFilterStatus(s.key)}
                className={`px-4 py-3 text-center transition-colors ${
                  filterStatus === s.key
                    ? 'bg-violet-50 dark:bg-violet-950/30'
                    : 'hover:bg-slate-50 dark:hover:bg-white/5'
                }`}
              >
                <div
                  className={`text-xl font-black ${filterStatus === s.key ? 'text-violet-600' : 'text-slate-800 dark:text-white'}`}
                >
                  {counts[s.key] || 0}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <Package size={48} className="mx-auto mb-4 opacity-30" />
            <p className="font-bold">لا توجد طلبات</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((order) => {
              const uiStatus = getOrderUiStatus(order);
              const st = STATUS_MAP[uiStatus] || STATUS_MAP.pending;
              const customer = parseOrderCustomer(order);
              const date = new Date(order.created_at).toLocaleDateString('ar-EG', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });
              const lines = Array.isArray(order.line_items) ? order.line_items : [];
              const orderNo = orderNumberLabel(order.id);

              return (
                <div
                  key={order.id}
                  className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden dark:bg-gray-900/40 dark:border-white/10"
                >
                  <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-white/5">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-3 py-1 rounded-full border ${st.color}`}>
                        {st.label}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">{date}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-lg font-black text-violet-600" dir="ltr">
                        ₪ {Number(order.total_amount || 0).toFixed(2)}
                      </span>

                      <div className="relative">
                        <select
                          value={uiStatus}
                          onChange={(e) => updateStatus(order.id, e.target.value)}
                          disabled={updatingId === order.id}
                          className="appearance-none rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-950 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 pr-7 focus:ring-violet-500 focus:border-violet-500 cursor-pointer disabled:opacity-50"
                        >
                          <option value="pending">قيد المعالجة</option>
                          <option value="confirmed">تم التأكيد</option>
                          <option value="ready">جاهز للاستلام</option>
                          <option value="delivered">تم التسليم</option>
                          <option value="cancelled">ملغي</option>
                        </select>
                        <ChevronDown
                          size={12}
                          className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                        />
                      </div>

                      {companies.length > 0 && (
                        <div className="relative">
                          <select
                            value={order.delivery_company_id ?? ''}
                            onChange={(e) => assignCompany(order.id, e.target.value)}
                            className="appearance-none rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-950 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 focus:ring-violet-500 focus:border-violet-500 cursor-pointer"
                          >
                            <option value="">🚚 بدون شركة</option>
                            {companies.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {order.delivery_company_id && (
                        <select
                          value={order.delivery_status ?? 'assigned'}
                          onChange={async (e) => {
                            await supabase
                              .from('sales')
                              .update({ delivery_status: e.target.value })
                              .eq('id', order.id);
                            setOrders((prev) =>
                              prev.map((o) =>
                                o.id === order.id ? { ...o, delivery_status: e.target.value } : o
                              )
                            );
                          }}
                          className="appearance-none rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-950 px-3 py-1.5 text-xs font-bold cursor-pointer"
                        >
                          <option value="assigned">📦 معيّن</option>
                          <option value="picked_up">🚚 مع الشركة</option>
                          <option value="delivered">✅ وصل للزبون</option>
                          <option value="returned">↩️ مرجّع</option>
                        </select>
                      )}

                      {uiStatus === 'ready' && (
                        <WhatsAppButton
                          phone={customer.phone}
                          message={buildOrderReadyMessage({
                            customerName: customer.name,
                            orderNumber: orderNo,
                            total: order.total_amount,
                          })}
                        >
                          إشعار جاهز واتساب
                        </WhatsAppButton>
                      )}

                      {order.delivery_company_id && (
                        <WhatsAppButton
                          phone={customer.phone}
                          message={buildDeliveryAssignedMessage({
                            customerName: customer.name,
                            orderNumber: orderNo,
                            lineItems: lines,
                            total: order.total_amount,
                            deliveryCompanyName:
                              companies.find((c) => c.id === order.delivery_company_id)?.name ?? '',
                          })}
                        >
                          واتساب توصيل
                        </WhatsAppButton>
                      )}

                      <button
                        type="button"
                        onClick={() => void generateInvoicePDF(order, store)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-950 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-all duration-200"
                        title="تحميل فاتورة PDF"
                      >
                        <FileText size={14} className="text-violet-600 dark:text-violet-400" />
                        <span>تحميل PDF</span>
                      </button>
                    </div>
                  </div>

                  <div className="px-5 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/2">
                    {customer.name && (
                      <div className="flex items-center gap-2 text-sm">
                        <User size={14} className="text-slate-400 shrink-0" />
                        <span className="font-bold text-slate-700 dark:text-slate-200">{customer.name}</span>
                      </div>
                    )}
                    {customer.phone && (
                      <a
                        href={`tel:${customer.phone}`}
                        className="flex items-center gap-2 text-sm hover:text-violet-600 transition-colors"
                      >
                        <Phone size={14} className="text-slate-400 shrink-0" />
                        <span className="font-mono text-slate-700 dark:text-slate-200" dir="ltr">
                          {customer.phone}
                        </span>
                      </a>
                    )}
                    {order.customer_address && (
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin size={14} className="text-slate-400 shrink-0" />
                        <span className="text-slate-700 dark:text-slate-200">{order.customer_address}</span>
                      </div>
                    )}
                  </div>

                  {lines.length > 0 && (
                    <div className="px-5 py-3 space-y-1.5">
                      {lines.map((line, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span className="text-slate-600 dark:text-slate-300 line-clamp-1">
                            {line.name || line.barcode || `صنف ${i + 1}`}
                            <span className="text-slate-400 mr-2">× {line.qty}</span>
                          </span>
                          {line.unit_price && (
                            <span className="font-mono text-slate-700 dark:text-slate-200 shrink-0" dir="ltr">
                              ₪ {Number(line.unit_price * line.qty).toFixed(2)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {order.notes && (
                    <div className="px-5 py-3 border-t border-slate-100 dark:border-white/5 flex items-start gap-2">
                      <MessageSquare size={14} className="text-slate-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-slate-500 leading-relaxed">{order.notes}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
