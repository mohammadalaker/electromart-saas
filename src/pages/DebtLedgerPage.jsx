import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, FileText, Loader2, RefreshCw, Search } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';

const CONTACTS_TABLE = 'store_contacts';

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

function toAgingRow(row) {
  const total = Math.max(0, Number(row.outstanding_amount ?? 0));
  const age = debtAgeDays(row.created_at);
  return {
    ...row,
    current: age <= 30 ? total : 0,
    days31_60: age > 30 && age <= 60 ? total : 0,
    days61_90: age > 60 && age <= 90 ? total : 0,
    days90Plus: age > 90 ? total : 0,
    total,
  };
}

function formatArabicDate(dateStr) {
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString('ar-SA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function DebtLedgerPage() {
  const { store, loading: storeLoading } = useStore();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10));

  const fetchRows = useCallback(async () => {
    if (!store?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from(CONTACTS_TABLE)
        .select('id, role, name, phone, outstanding_amount, created_at')
        .eq('store_id', store.id)
        .eq('payment_type', 'credit')
        .order('outstanding_amount', { ascending: false });

      if (qErr) throw qErr;
      setRows(data || []);
    } catch (e) {
      setError(e.message || 'تعذّر تحميل الذمم');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    fetchRows();
  }, [storeLoading, fetchRows]);

  const filteredRows = useMemo(() => {
    const data = rows.map(toAgingRow);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return data;
    return data.filter((r) => {
      const name = String(r.name || '').toLowerCase();
      const phone = String(r.phone || '');
      return name.includes(q) || phone.includes(q);
    });
  }, [rows, searchQuery]);

  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, c) => ({
          current: acc.current + c.current,
          days31_60: acc.days31_60 + c.days31_60,
          days61_90: acc.days61_90 + c.days61_90,
          days90Plus: acc.days90Plus + c.days90Plus,
          total: acc.total + c.total,
        }),
        { current: 0, days31_60: 0, days61_90: 0, days90Plus: 0, total: 0 }
      ),
    [filteredRows]
  );

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
        <div className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center text-amber-950 font-bold" dir="rtl">
          لا يوجد متجر مرتبط بحسابك.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gray-50 p-6 space-y-6" dir="rtl">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                <Calendar className="w-6 h-6 text-indigo-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">أعمار الديون</h1>
                <p className="text-gray-500 text-sm mt-0.5">توزيع مستحقات الزبائن حسب مدة بقاء الدين مفتوحاً</p>
              </div>
            </div>
            <button
              type="button"
              onClick={fetchRows}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              تحديث
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3 bg-gray-50 rounded-xl p-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">تاريخ التقرير</label>
              <div className="relative">
                <input
                  type="date"
                  value={reportDate}
                  onChange={(e) => setReportDate(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-44"
                />
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              </div>
            </div>
            <div className="text-sm text-gray-500">{formatArabicDate(reportDate)}</div>
            <div className="relative mr-auto w-full md:w-72">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث باسم الزبون أو الهاتف..."
                className="w-full pr-9 pl-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <span className="text-sm text-gray-500">حتى 30 يوماً</span>
            <p className="text-2xl font-bold text-gray-900 mt-2">₪ {formatMoney(totals.current)}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <span className="text-sm text-gray-500">31-60 يوماً</span>
            <p className="text-2xl font-bold text-gray-900 mt-2">₪ {formatMoney(totals.days31_60)}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <span className="text-sm text-gray-500">61-90 يوماً</span>
            <p className="text-2xl font-bold text-gray-900 mt-2">₪ {formatMoney(totals.days61_90)}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <span className="text-sm text-gray-500">أكثر من 90 يوماً</span>
            <p className="text-2xl font-bold text-gray-900 mt-2">₪ {formatMoney(totals.days90Plus)}</p>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-amber-700" />
            <span className="text-amber-800 font-semibold">إجمالي المستحقات المؤجلة</span>
          </div>
          <p className="text-3xl font-bold text-amber-900">₪ {formatMoney(totals.total)}</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-right py-4 px-6 text-sm font-semibold text-gray-700">الزبون</th>
                  <th className="text-right py-4 px-6 text-sm font-semibold text-gray-700">الهاتف</th>
                  <th className="text-right py-4 px-6 text-sm font-semibold text-gray-700">حتى 30 يوماً</th>
                  <th className="text-right py-4 px-6 text-sm font-semibold text-gray-700">31-60 يوماً</th>
                  <th className="text-right py-4 px-6 text-sm font-semibold text-gray-700">61-90 يوماً</th>
                  <th className="text-right py-4 px-6 text-sm font-semibold text-red-600">أكثر من 90 يوماً</th>
                  <th className="text-right py-4 px-6 text-sm font-semibold text-gray-700">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-20 text-center">
                      <Loader2 className="inline animate-spin text-indigo-500" size={36} />
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-gray-500">
                      لا توجد نتائج مطابقة
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((customer) => (
                    <tr key={customer.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition">
                      <td className="py-4 px-6 font-medium text-gray-900">{customer.name || '—'}</td>
                      <td className="py-4 px-6 text-gray-500 text-sm font-mono" dir="ltr">{customer.phone || '—'}</td>
                      <td className="py-4 px-6 font-medium text-gray-900" dir="ltr">
                        {customer.current > 0 ? customer.current.toFixed(2) : '—'}
                      </td>
                      <td className="py-4 px-6 font-medium text-gray-900" dir="ltr">
                        {customer.days31_60 > 0 ? customer.days31_60.toFixed(2) : '—'}
                      </td>
                      <td className="py-4 px-6 font-medium text-gray-900" dir="ltr">
                        {customer.days61_90 > 0 ? customer.days61_90.toFixed(2) : '—'}
                      </td>
                      <td className="py-4 px-6 font-medium text-red-600" dir="ltr">
                        {customer.days90Plus > 0 ? customer.days90Plus.toFixed(2) : '—'}
                      </td>
                      <td className="py-4 px-6 font-bold text-gray-900 text-lg" dir="ltr">
                        {customer.total.toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
