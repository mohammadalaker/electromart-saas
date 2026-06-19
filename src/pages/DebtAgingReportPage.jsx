import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import WhatsAppButton from '../components/WhatsAppButton';
import { buildPaymentReminderMessage } from '../utils/whatsapp';

function formatMoney(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return '0.00';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function debtAgeDays(createdAt) {
  if (!createdAt) return 0;
  const ts = new Date(createdAt).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24)));
}

export default function DebtAgingReportPage() {
  const { store } = useStore();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchData = useCallback(async () => {
    if (!store?.id) {
      setData([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data: rows, error } = await supabase
        .from('store_contacts')
        .select('id, name, phone, outstanding_amount, created_at, payment_type')
        .eq('store_id', store.id)
        .eq('payment_type', 'credit')
        .order('outstanding_amount', { ascending: false });

      if (error) throw error;

      const mapped = (rows || []).map((r) => {
        const total = Math.max(0, Number(r.outstanding_amount ?? 0));
        const age = debtAgeDays(r.created_at);
        return {
          id: r.id,
          name: r.name || '—',
          phone: r.phone || '—',
          current: age <= 30 ? total : 0,
          days31_60: age > 30 && age <= 60 ? total : 0,
          days61_90: age > 60 && age <= 90 ? total : 0,
          days90Plus: age > 90 ? total : 0,
          total,
        };
      });
      setData(mapped);
    } catch (e) {
      console.error(e);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(() => {
    if (!searchQuery) return data;
    return data.filter(
      (d) =>
        d.name?.toLowerCase().includes(searchQuery.toLowerCase()) || d.phone?.includes(searchQuery)
    );
  }, [data, searchQuery]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, c) => ({
          current: acc.current + (c.current || 0),
          days31_60: acc.days31_60 + (c.days31_60 || 0),
          days61_90: acc.days61_90 + (c.days61_90 || 0),
          days90Plus: acc.days90Plus + (c.days90Plus || 0),
          total: acc.total + (c.total || 0),
        }),
        { current: 0, days31_60: 0, days61_90: 0, days90Plus: 0, total: 0 }
      ),
    [filtered]
  );

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ar-SA', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6" dir="rtl">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                <Calendar className="w-6 h-6 text-indigo-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">أعمار الديون</h1>
                <p className="text-gray-500 text-sm mt-0.5">
                  توزيع مستحقات الزبائن حسب مدة بقاء الدين مفتوحاً
                </p>
              </div>
            </div>

            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              تحديث
            </button>
          </div>

          <div className="mt-4 flex items-center gap-3 bg-gray-50 rounded-xl p-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">تاريخ التقرير</label>
              <div className="relative">
                <input
                  type="date"
                  value={reportDate}
                  onChange={(e) => setReportDate(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-40"
                />
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              </div>
            </div>
            <div className="text-sm text-gray-500 mt-5">{formatDate(reportDate)}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition">
            <div className="flex justify-between items-start mb-3">
              <span className="text-sm text-gray-500">حتى 30 يوماً</span>
              <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">₪ {formatMoney(totals.current)}</p>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition">
            <div className="flex justify-between items-start mb-3">
              <span className="text-sm text-gray-500">31-60 يوماً</span>
              <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center">
                <Clock className="w-4 h-4 text-amber-500" />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">₪ {formatMoney(totals.days31_60)}</p>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition">
            <div className="flex justify-between items-start mb-3">
              <span className="text-sm text-gray-500">61-90 يوماً</span>
              <div className="w-8 h-8 bg-orange-50 rounded-lg flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-orange-500" />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">₪ {formatMoney(totals.days61_90)}</p>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition">
            <div className="flex justify-between items-start mb-3">
              <span className="text-sm text-gray-500">أكثر من 90 يوماً</span>
              <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-red-500" />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">₪ {formatMoney(totals.days90Plus)}</p>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-amber-700" />
            <span className="text-amber-800 font-semibold">إجمالي المستحقات المؤجلة</span>
          </div>
          <p className="text-3xl font-bold text-amber-900">₪ {formatMoney(totals.total)}</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              placeholder="البحث باسم الزبون أو الهاتف..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pr-10 pl-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <span className="text-sm text-gray-500">النتائج: {filtered.length}</span>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="h-64 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-right py-4 px-6 text-sm font-semibold text-gray-700">الزبون</th>
                    <th className="text-right py-4 px-6 text-sm font-semibold text-gray-700">الهاتف</th>
                    <th className="text-right py-4 px-6 text-sm font-semibold text-gray-700">حتى 30 يوماً</th>
                    <th className="text-right py-4 px-6 text-sm font-semibold text-gray-700">31-60 يوماً</th>
                    <th className="text-right py-4 px-6 text-sm font-semibold text-gray-700">61-90 يوماً</th>
                    <th className="text-right py-4 px-6 text-sm font-semibold text-red-600">أكثر من 90 يوماً</th>
                    <th className="text-right py-4 px-6 text-sm font-semibold text-gray-700">الإجمالي</th>
                    <th className="text-right py-4 px-6 text-sm font-semibold text-gray-700">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition">
                      <td className="py-4 px-6 font-medium text-gray-900">{row.name}</td>
                      <td className="py-4 px-6 text-gray-500 text-sm font-mono">{row.phone}</td>
                      <td className="py-4 px-6 font-medium text-emerald-700">
                        {row.current > 0 ? formatMoney(row.current) : '—'}
                      </td>
                      <td className="py-4 px-6 font-medium text-amber-700">
                        {row.days31_60 > 0 ? formatMoney(row.days31_60) : '—'}
                      </td>
                      <td className="py-4 px-6 font-medium text-orange-700">
                        {row.days61_90 > 0 ? formatMoney(row.days61_90) : '—'}
                      </td>
                      <td className="py-4 px-6 font-medium text-red-700">
                        {row.days90Plus > 0 ? formatMoney(row.days90Plus) : '—'}
                      </td>
                      <td className="py-4 px-6 font-bold text-gray-900 text-lg">
                        ₪ {formatMoney(row.total)}
                      </td>
                      <td className="py-4 px-6">
                        {row.total > 0 && (
                          <WhatsAppButton
                            phone={row.phone}
                            message={buildPaymentReminderMessage({
                              customerName: row.name,
                              storeName: store?.name,
                              amount: row.total,
                            })}
                          >
                            تذكير دفع واتساب
                          </WhatsAppButton>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="h-32 text-center text-gray-400">
                        لا توجد نتائج مطابقة للبحث
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
