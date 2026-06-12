import { useEffect, useState, useMemo } from 'react';
import { Loader2, Truck, Plus, DollarSign, ChevronDown, ChevronUp } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';

const DELIVERY_STATUS_MAP = {
  pending:   { label: 'معلّق',           color: 'bg-slate-100 text-slate-600' },
  assigned:  { label: 'معيّن',           color: 'bg-blue-100 text-blue-700' },
  picked_up: { label: 'مع الشركة',      color: 'bg-amber-100 text-amber-700' },
  delivered: { label: 'وصل للزبون',     color: 'bg-emerald-100 text-emerald-700' },
  returned:  { label: 'مرجّع',          color: 'bg-red-100 text-red-700' },
};

export default function DeliveryAccountPage() {
  const { store } = useStore();
  const [companies, setCompanies] = useState([]);
  const [orders, setOrders] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState(false);

  useEffect(() => {
    if (!store?.id) return;
    fetchAll();
  }, [store?.id]);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: comp }, { data: ord }, { data: pay }] = await Promise.all([
      supabase.from('store_delivery_companies').select('*').eq('store_id', store.id).eq('is_active', true),
      supabase.from('sales').select('id, created_at, total_amount, delivery_fee, customer_name, customer_phone, delivery_company_id, delivery_status')
        .eq('store_id', store.id).eq('is_online_order', true).not('delivery_company_id', 'is', null),
      supabase.from('delivery_payments').select('*').eq('store_id', store.id).order('payment_date', { ascending: false }),
    ]);
    setCompanies(comp || []);
    setOrders(ord || []);
    setPayments(pay || []);
    if (comp?.length > 0 && !selectedCompany) setSelectedCompany(comp[0].id);
    setLoading(false);
  };

  const addPayment = async (e) => {
    e.preventDefault();
    if (!paymentForm.amount || !selectedCompany) return;
    setSaving(true);
    const { error } = await supabase.from('delivery_payments').insert({
      store_id: store.id,
      company_id: selectedCompany,
      amount: Number(paymentForm.amount),
      notes: paymentForm.notes.trim() || null,
    });
    if (!error) {
      setPaymentForm({ amount: '', notes: '' });
      fetchAll();
    }
    setSaving(false);
  };

  const companyOrders = useMemo(() =>
    orders.filter((o) => o.delivery_company_id === selectedCompany),
    [orders, selectedCompany]
  );

  const companyPayments = useMemo(() =>
    payments.filter((p) => p.company_id === selectedCompany),
    [payments, selectedCompany]
  );

  const totalToCollect = useMemo(() =>
    companyOrders
      .filter((o) => o.delivery_status === 'delivered')
      .reduce((sum, o) => sum + Number(o.total_amount || 0), 0),
    [companyOrders]
  );

  const totalPaid = useMemo(() =>
    companyPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0),
    [companyPayments]
  );

  const balance = totalToCollect - totalPaid;

  const selectedComp = companies.find((c) => c.id === selectedCompany);

  if (loading) return (
    <DashboardLayout>
      <div className="flex justify-center py-24" dir="rtl">
        <Loader2 className="animate-spin text-violet-500" size={40} />
      </div>
    </DashboardLayout>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        {/* Header */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden dark:bg-gray-900/40 dark:border-white/10">
          <div className="px-6 py-4 flex items-center gap-3 bg-gradient-to-l from-violet-50/50 to-white dark:from-violet-950/30 dark:to-gray-900">
            <div className="h-11 w-11 rounded-xl bg-violet-600 text-white flex items-center justify-center shadow-lg">
              <Truck size={22} />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 dark:text-white">كشف حساب التوصيل</h1>
              <p className="text-xs text-slate-500 mt-0.5">تتبع مديونية شركات التوصيل</p>
            </div>
          </div>

          {/* Company Tabs */}
          {companies.length > 0 && (
            <div className="px-6 py-3 border-t border-slate-100 dark:border-white/5 flex gap-2 overflow-x-auto">
              {companies.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCompany(c.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all ${
                    selectedCompany === c.id
                      ? 'bg-violet-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {companies.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Truck size={48} className="mx-auto mb-3 opacity-30" />
            <p className="font-bold">لا توجد شركات توصيل</p>
            <p className="text-xs mt-1">أضف شركات التوصيل أولاً من صفحة مناطق التوصيل</p>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-gray-900/40 dark:border-white/10 p-5 text-center">
                <p className="text-2xl font-black text-emerald-600" dir="ltr">₪ {totalToCollect.toFixed(2)}</p>
                <p className="text-xs font-bold text-slate-500 mt-1">إجمالي المحصّل (وصل للزبون)</p>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-gray-900/40 dark:border-white/10 p-5 text-center">
                <p className="text-2xl font-black text-blue-600" dir="ltr">₪ {totalPaid.toFixed(2)}</p>
                <p className="text-xs font-bold text-slate-500 mt-1">المدفوع للمتجر</p>
              </div>
              <div className={`rounded-2xl border p-5 text-center ${balance > 0 ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/20' : 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20'}`}>
                <p className={`text-2xl font-black ${balance > 0 ? 'text-amber-600' : 'text-emerald-600'}`} dir="ltr">
                  ₪ {Math.abs(balance).toFixed(2)}
                </p>
                <p className="text-xs font-bold text-slate-500 mt-1">
                  {balance > 0 ? '⚠️ مديونية على الشركة' : '✅ تم التسوية'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* تسجيل دفعة */}
              <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-gray-900/40 dark:border-white/10 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 dark:border-white/5">
                  <h2 className="text-sm font-black text-slate-800 dark:text-white">💰 تسجيل استلام دفعة من {selectedComp?.name}</h2>
                </div>
                <form onSubmit={addPayment} className="p-5 space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">المبلغ المستلم (₪)</label>
                    <input
                      type="number"
                      value={paymentForm.amount}
                      onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
                      className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950"
                      placeholder="0.00" min="0" step="0.01" dir="ltr" required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">ملاحظات</label>
                    <input
                      type="text"
                      value={paymentForm.notes}
                      onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
                      className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950"
                      placeholder="رقم الإيصال أو أي ملاحظة..."
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={saving || balance <= 0}
                    className="w-full bg-violet-600 text-white rounded-xl py-2.5 text-sm font-bold hover:bg-violet-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    تسجيل الدفعة
                  </button>
                </form>

                {/* سجل الدفعات */}
                {companyPayments.length > 0 && (
                  <div className="border-t border-slate-100 dark:border-white/5">
                    <div className="px-5 py-3 text-xs font-bold text-slate-500">سجل الدفعات</div>
                    <div className="px-5 pb-4 space-y-2">
                      {companyPayments.map((p) => (
                        <div key={p.id} className="flex items-center justify-between bg-slate-50 dark:bg-white/5 rounded-xl px-4 py-2.5">
                          <div>
                            <p className="text-xs text-slate-400">{new Date(p.payment_date).toLocaleDateString('ar-EG')}</p>
                            {p.notes && <p className="text-xs text-slate-500 mt-0.5">{p.notes}</p>}
                          </div>
                          <span className="text-sm font-black text-emerald-600" dir="ltr">+ ₪ {Number(p.amount).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* طلبات الشركة */}
              <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-gray-900/40 dark:border-white/10 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedOrders(!expandedOrders)}
                  className="w-full px-5 py-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between"
                >
                  <h2 className="text-sm font-black text-slate-800 dark:text-white">
                    📦 طلبات {selectedComp?.name} ({companyOrders.length})
                  </h2>
                  {expandedOrders ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                </button>
                {expandedOrders && (
                  <div className="divide-y divide-slate-100 dark:divide-white/5 max-h-96 overflow-y-auto">
                    {companyOrders.length === 0 ? (
                      <div className="text-center py-10 text-slate-400 text-sm">لا توجد طلبات</div>
                    ) : (
                      companyOrders.map((o) => {
                        const ds = DELIVERY_STATUS_MAP[o.delivery_status ?? 'pending'];
                        return (
                          <div key={o.id} className="px-5 py-3 flex items-center justify-between">
                            <div>
                              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{o.customer_name || 'زبون'}</p>
                              <p className="text-xs text-slate-400">{new Date(o.created_at).toLocaleDateString('ar-EG')}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ds.color}`}>{ds.label}</span>
                              <span className="text-sm font-black text-violet-600" dir="ltr">₪ {Number(o.total_amount).toFixed(2)}</span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
