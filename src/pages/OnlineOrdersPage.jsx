import { useEffect, useState, useMemo } from 'react';
import { Loader2, Package, Phone, User, MapPin, MessageSquare, ChevronDown, Truck, FileText } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { generateInvoicePDF } from '../utils/generatePDF';

const STATUS_MAP = {
  pending:   { label: 'قيد المعالجة', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  confirmed: { label: 'تم التأكيد',   color: 'bg-blue-100 text-blue-700 border-blue-200' },
  delivered: { label: 'تم التسليم',   color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  cancelled: { label: 'ملغي',         color: 'bg-red-100 text-red-700 border-red-200' },
};

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
        .select('*')
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
        console.log('Online orders query:', { data, error, storeId: store.id });
        setOrders(error ? [] : (data || []));
        setCompanies(comp || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [store?.id]);

  const filtered = useMemo(() => {
    if (filterStatus === 'all') return orders;
    return orders.filter((o) => (o.status || 'pending') === filterStatus);
  }, [orders, filterStatus]);

  const updateStatus = async (id, newStatus) => {
    setUpdatingId(id);
    const { error } = await supabase
      .from('sales')
      .update({ status: newStatus })
      .eq('id', id)
      .eq('store_id', store.id);
    if (!error) {
      setOrders((prev) =>
        prev.map((o) => o.id === id ? { ...o, status: newStatus } : o)
      );
    }
    setUpdatingId(null);
  };

  const assignCompany = async (orderId, companyId) => {
    await supabase.from('sales').update({
      delivery_company_id: companyId || null,
      delivery_status: companyId ? 'assigned' : 'pending',
      delivery_assigned_at: companyId ? new Date().toISOString() : null,
    }).eq('id', orderId);
    setOrders((prev) => prev.map((o) => o.id === orderId ? {
      ...o,
      delivery_company_id: companyId || null,
      delivery_status: companyId ? 'assigned' : 'pending',
    } : o));
  };

  const counts = useMemo(() => {
    const c = { all: orders.length, pending: 0, confirmed: 0, delivered: 0, cancelled: 0 };
    orders.forEach((o) => { c[o.status || 'pending'] = (c[o.status || 'pending'] || 0) + 1; });
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
        {/* Header */}
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

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-x-reverse divide-slate-100 dark:divide-white/5">
            {[
              { key: 'all', label: 'الكل' },
              { key: 'pending', label: 'قيد المعالجة' },
              { key: 'confirmed', label: 'مؤكدة' },
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
                <div className={`text-xl font-black ${filterStatus === s.key ? 'text-violet-600' : 'text-slate-800 dark:text-white'}`}>
                  {counts[s.key] || 0}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Orders List */}
        {filtered.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <Package size={48} className="mx-auto mb-4 opacity-30" />
            <p className="font-bold">لا توجد طلبات</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((order) => {
              const st = STATUS_MAP[order.status || 'pending'];
              const date = new Date(order.created_at).toLocaleDateString('ar-EG', {
                year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
              });
              const lines = Array.isArray(order.line_items) ? order.line_items : [];

              return (
                <div key={order.id} className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden dark:bg-gray-900/40 dark:border-white/10">
                  {/* Order Header */}
                  <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-white/5">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-3 py-1 rounded-full border ${st.color}`}>
                        {st.label}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">{date}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-black text-violet-600" dir="ltr">
                        ₪ {Number(order.total_amount || 0).toFixed(2)}
                      </span>
                      {/* Status Changer */}
                      <div className="relative">
                        <select
                          value={order.status || 'pending'}
                          onChange={(e) => updateStatus(order.id, e.target.value)}
                          disabled={updatingId === order.id}
                          className="appearance-none rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-950 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 pr-7 focus:ring-violet-500 focus:border-violet-500 cursor-pointer disabled:opacity-50"
                        >
                          <option value="pending">قيد المعالجة</option>
                          <option value="confirmed">تم التأكيد</option>
                          <option value="delivered">تم التسليم</option>
                          <option value="cancelled">ملغي</option>
                        </select>
                        <ChevronDown size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      </div>

                      {/* شركة التوصيل */}
                      {companies.length > 0 && (
                        <div className="relative">
                          <select
                            value={order.delivery_company_id ?? ''}
                            onChange={(e) => assignCompany(order.id, e.target.value)}
                            className="appearance-none rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-950 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 focus:ring-violet-500 focus:border-violet-500 cursor-pointer"
                          >
                            <option value="">🚚 بدون شركة</option>
                            {companies.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* حالة التوصيل */}
                      {order.delivery_company_id && (
                        <select
                          value={order.delivery_status ?? 'assigned'}
                          onChange={async (e) => {
                            await supabase.from('sales').update({ delivery_status: e.target.value }).eq('id', order.id);
                            setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, delivery_status: e.target.value } : o));
                          }}
                          className="appearance-none rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-950 px-3 py-1.5 text-xs font-bold cursor-pointer"
                        >
                          <option value="assigned">📦 معيّن</option>
                          <option value="picked_up">🚚 مع الشركة</option>
                          <option value="delivered">✅ وصل للزبون</option>
                          <option value="returned">↩️ مرجّع</option>
                        </select>
                      )}

                      {/* واتساب */}
                      {order.delivery_company_id && (order.customer_phone || (order.notes && order.notes.match(/(\d{9,12})/))) && (
                        <a
                          href={`https://wa.me/${(order.customer_phone || (order.notes && order.notes.match(/(\d{9,12})/)?.[1]) || '').replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                            `مرحباً ${order.customer_name || ''}،\n\nطلبك رقم: ${order.id.slice(0, 8).toUpperCase()} تم تسليمه لشركة التوصيل.\n\n📦 المنتجات:\n${
                              (Array.isArray(order.line_items) ? order.line_items : [])
                                .map((l) => `- ${l.name || l.barcode || 'صنف'} × ${l.qty}`)
                                .join('\n')
                            }\n\n💰 المبلغ: ₪${Number(order.total_amount).toFixed(2)}\n🚚 شركة التوصيل: ${companies.find((c) => c.id === order.delivery_company_id)?.name ?? ''}\n\nشكراً لثقتك! 🙏`
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white transition-all hover:opacity-90"
                          style={{ backgroundColor: '#25D366' }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.117 1.528 5.845L.057 23.547a.5.5 0 0 0 .609.61l5.857-1.53A11.943 11.943 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.894a9.894 9.894 0 0 1-5.044-1.376l-.361-.214-3.737.977.999-3.645-.235-.374A9.895 9.895 0 0 1 2.106 12C2.106 6.533 6.533 2.106 12 2.106c5.467 0 9.894 4.427 9.894 9.894 0 5.467-4.427 9.894-9.894 9.894z"/>
                          </svg>
                          واتساب
                        </a>
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

                  {/* Customer Info */}
                  <div className="px-5 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/2">
                    {order.customer_name && (
                      <div className="flex items-center gap-2 text-sm">
                        <User size={14} className="text-slate-400 shrink-0" />
                        <span className="font-bold text-slate-700 dark:text-slate-200">{order.customer_name}</span>
                      </div>
                    )}
                    {order.customer_phone && (
                      <a href={`tel:${order.customer_phone}`} className="flex items-center gap-2 text-sm hover:text-violet-600 transition-colors">
                        <Phone size={14} className="text-slate-400 shrink-0" />
                        <span className="font-mono text-slate-700 dark:text-slate-200" dir="ltr">{order.customer_phone}</span>
                      </a>
                    )}
                    {order.customer_address && (
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin size={14} className="text-slate-400 shrink-0" />
                        <span className="text-slate-700 dark:text-slate-200">{order.customer_address}</span>
                      </div>
                    )}
                  </div>

                  {/* Line Items */}
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

                  {/* Notes */}
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
