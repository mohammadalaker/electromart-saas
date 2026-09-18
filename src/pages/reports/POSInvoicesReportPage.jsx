import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Receipt,
  Search,
  RotateCcw,
  Calendar,
  Clock,
  CreditCard,
  User,
  Store,
  Layers,
  FileText,
  DollarSign,
  AlertCircle,
  Eye,
  SlidersHorizontal,
  BookmarkCheck,
  CheckCircle2,
  XCircle,
  ShoppingBag,
  RefreshCw,
  Hash,
} from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import InvoiceModal from '../../components/InvoiceModal';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { supabase } from '../../lib/supabaseClient';

const STORAGE_KEY = 'pos_invoices_report_filters_v1';
const REMEMBER_KEY = 'pos_invoices_report_remember_v1';

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

const defaultFilters = {
  dateFrom: getTodayStr(),
  dateTo: getTodayStr(),
  timeFrom: '',
  timeTo: '',
  status: 'all', // 'all' | 'completed' | 'voided' | 'returned'
  paymentMode: 'all', // 'all' | 'cash' | 'visa' | 'credit'
  cashierId: 'all',
  sessionId: 'all',
  posType: 'all', // 'all' | 'standard' | 'supermarket'
  invNumberFrom: '',
  invNumberTo: '',
  amountFrom: '',
  amountTo: '',
  notesQuery: '',
  isTodayOnly: true,
};

function formatMoney(n) {
  return Number(n ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function extractSessionId(sale) {
  if (sale.session_id) return String(sale.session_id);
  const notes = String(sale.notes || '');
  const match = notes.match(/\[session_id:([^\]]+)\]/i);
  return match ? match[1] : null;
}

function getPosType(sale) {
  const notes = String(sale.notes || '');
  if (
    notes.includes('نقطة بيع سوبرماركت') ||
    notes.includes('جلسة الصندوق:') ||
    notes.includes('[session_id:') ||
    extractSessionId(sale)
  ) {
    return 'supermarket';
  }
  return 'standard';
}

function getSaleStatus(sale) {
  if (sale.returned_at) return 'returned';
  const st = String(sale.order_status || sale.status || '').toLowerCase();
  if (st === 'cancelled' || st === 'voided' || st === 'void' || st === 'canceled') {
    return 'voided';
  }
  return 'completed';
}

function getPaymentCategory(sale) {
  const mode = String(sale.payment_mode || '').toLowerCase();
  const method = String(sale.payment_method || '').toLowerCase();
  const notes = String(sale.notes || '').toLowerCase();

  if (
    mode === 'visa' ||
    mode === 'card' ||
    method === 'card' ||
    method === 'visa' ||
    notes.includes('بطاقة') ||
    notes.includes('فيزا')
  ) {
    return 'visa';
  }
  if (
    mode === 'credit' ||
    method === 'deferred' ||
    method === 'credit' ||
    notes.includes('آجل') ||
    notes.includes('ذمة')
  ) {
    return 'credit';
  }
  return 'cash';
}

function extractCashierLabel(sale, currentUserId, currentUserName) {
  const notes = String(sale.notes || '');
  const id = sale.cashier_id || sale.user_id;

  const cashierNoteMatch = notes.match(/الكاشير:\s*(?:\[cashier_id:([^\]]+)\]|([^\n]+))/i);
  if (cashierNoteMatch) {
    const matchedId = cashierNoteMatch[1] || cashierNoteMatch[2];
    if (matchedId && matchedId === currentUserId) {
      return currentUserName || 'أنا (المستخدم الحالي)';
    }
    if (matchedId) {
      return matchedId.length > 12 ? `كاشير (${matchedId.slice(0, 6)})` : matchedId;
    }
  }

  if (id) {
    if (id === currentUserId) return currentUserName || 'أنا (المستخدم الحالي)';
    return `كاشير (${id.slice(0, 6)})`;
  }

  return 'كاشير عام';
}

function getInvoiceNumber(sale) {
  if (sale.invoice_number) return String(sale.invoice_number);
  return sale.id ? sale.id.slice(0, 8).toUpperCase() : '—';
}

export default function POSInvoicesReportPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();

  // Load saved preferences if available
  const [rememberChoices, setRememberChoices] = useState(() => {
    try {
      return localStorage.getItem(REMEMBER_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [filters, setFilters] = useState(() => {
    try {
      const isRem = localStorage.getItem(REMEMBER_KEY) === 'true';
      if (isRem) {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          return { ...defaultFilters, ...parsed };
        }
      }
    } catch (e) {
      console.warn('Error reading saved filter prefs', e);
    }
    return defaultFilters;
  });

  const [appliedFilters, setAppliedFilters] = useState(() => filters);

  const [rawSales, setRawSales] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [currentAuthUser, setCurrentAuthUser] = useState(null);
  const [selectedSaleId, setSelectedSaleId] = useState(null);

  // Fetch current user details
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        const u = data.user;
        const m = u.user_metadata || {};
        const dName = [m.full_name, m.name, m.display_name].find((x) => String(x || '').trim()) ||
          u.email?.split('@')[0] ||
          'المستخدم الحالي';
        setCurrentAuthUser({ id: u.id, name: dName, email: u.email });
      }
    });
  }, []);

  // Fetch sessions from cash_register_sessions
  const fetchSessions = useCallback(async () => {
    if (!store?.id) return;
    try {
      const { data, error: sErr } = await supabase
        .from('cash_register_sessions')
        .select('id, opened_at, closed_at, status, opening_amount, closing_amount, user_id, notes')
        .eq('store_id', store.id)
        .order('opened_at', { ascending: false })
        .limit(100);

      if (sErr) {
        console.warn('[POSInvoicesReport] cash_register_sessions error:', sErr.message);
      } else {
        setSessions(data || []);
      }
    } catch (e) {
      console.warn('[POSInvoicesReport] fetchSessions exception:', e);
    }
  }, [store?.id]);

  // Fetch sales from sales table
  const fetchSalesData = useCallback(async () => {
    if (!store?.id) return;
    setLoading(true);
    setError(null);
    try {
      const salesSelect =
        'id, created_at, store_id, total_amount, payment_mode, payment_method, contact_id, customer_name, customer_phone, line_items, notes, status, order_status, returned_at, return_note';

      const { data, error: qErr } = await supabase
        .from('sales')
        .select(salesSelect)
        .eq('store_id', store.id)
        .order('created_at', { ascending: false })
        .limit(1500);

      if (qErr) throw qErr;

      setRawSales(data || []);
    } catch (err) {
      console.error('[POSInvoicesReport] fetch sales error:', err);
      setError(err.message || 'تعذّر تحميل فواتير المبيعات.');
      setRawSales([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (!storeLoading && store?.id) {
      fetchSalesData();
      fetchSessions();
    }
  }, [storeLoading, store?.id, fetchSalesData, fetchSessions]);

  // Save or clear preferences in localStorage
  const handleRememberToggle = (checked) => {
    setRememberChoices(checked);
    try {
      if (checked) {
        localStorage.setItem(REMEMBER_KEY, 'true');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
      } else {
        localStorage.setItem(REMEMBER_KEY, 'false');
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {
      console.warn('localStorage error', e);
    }
  };

  const handleApplyFilters = () => {
    setAppliedFilters({ ...filters });
    if (rememberChoices) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
      } catch (e) {
        console.warn('localStorage error', e);
      }
    }
    toast.info('تم تطبيق خيارات البحث والفلاتر');
  };

  const handleResetFilters = () => {
    setFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
    if (rememberChoices) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultFilters));
      } catch (e) {
        console.warn('localStorage error', e);
      }
    }
    toast.info('تمت استعادة الفلاتر الافتراضية');
  };

  const handleTodayOnlyToggle = (e) => {
    const checked = e.target.checked;
    const today = getTodayStr();
    setFilters((prev) => ({
      ...prev,
      isTodayOnly: checked,
      dateFrom: checked ? today : prev.dateFrom,
      dateTo: checked ? today : prev.dateTo,
    }));
  };

  // Distinct cashiers list for the dropdown
  const cashierOptions = useMemo(() => {
    const map = new Map();
    if (currentAuthUser) {
      map.set(currentAuthUser.id, currentAuthUser.name || 'أنا (المستخدم الحالي)');
    }

    rawSales.forEach((s) => {
      const cId = s.cashier_id || s.user_id;
      const notes = String(s.notes || '');
      const noteMatch = notes.match(/الكاشير:\s*(?:\[cashier_id:([^\]]+)\]|([^\n]+))/i);
      const extracted = noteMatch ? (noteMatch[1] || noteMatch[2]) : null;

      const effectiveId = cId || extracted;
      if (effectiveId && !map.has(effectiveId)) {
        if (currentAuthUser && effectiveId === currentAuthUser.id) {
          map.set(effectiveId, currentAuthUser.name);
        } else {
          map.set(effectiveId, effectiveId.length > 12 ? `كاشير (${effectiveId.slice(0, 6)})` : effectiveId);
        }
      }
    });

    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [rawSales, currentAuthUser]);

  // Client-side filtering on rawSales
  const filteredSales = useMemo(() => {
    return rawSales.filter((sale) => {
      const createdAt = sale.created_at ? new Date(sale.created_at) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) return false;

      // 1. Date Range
      const saleDateStr = createdAt.toISOString().slice(0, 10);
      if (appliedFilters.dateFrom && saleDateStr < appliedFilters.dateFrom) {
        return false;
      }
      if (appliedFilters.dateTo && saleDateStr > appliedFilters.dateTo) {
        return false;
      }

      // 2. Time Range
      const saleHours = String(createdAt.getHours()).padStart(2, '0');
      const saleMins = String(createdAt.getMinutes()).padStart(2, '0');
      const saleTimeStr = `${saleHours}:${saleMins}`;
      if (appliedFilters.timeFrom && saleTimeStr < appliedFilters.timeFrom) {
        return false;
      }
      if (appliedFilters.timeTo && saleTimeStr > appliedFilters.timeTo) {
        return false;
      }

      // 3. Status Filter
      const st = getSaleStatus(sale);
      if (appliedFilters.status !== 'all') {
        if (appliedFilters.status === 'completed' && st !== 'completed') return false;
        if (appliedFilters.status === 'voided' && st !== 'voided') return false;
        if (appliedFilters.status === 'returned' && st !== 'returned') return false;
      }

      // 4. Payment Mode Filter
      const pm = getPaymentCategory(sale);
      if (appliedFilters.paymentMode !== 'all') {
        if (appliedFilters.paymentMode !== pm) return false;
      }

      // 5. Cashier / User Filter
      if (appliedFilters.cashierId !== 'all') {
        const cId = sale.cashier_id || sale.user_id;
        const notes = String(sale.notes || '');
        const noteMatch = notes.match(/الكاشير:\s*(?:\[cashier_id:([^\]]+)\]|([^\n]+))/i);
        const extracted = noteMatch ? (noteMatch[1] || noteMatch[2]) : null;
        if (cId !== appliedFilters.cashierId && extracted !== appliedFilters.cashierId) {
          return false;
        }
      }

      // 6. Shift / Session Filter
      if (appliedFilters.sessionId !== 'all') {
        const extractedSession = extractSessionId(sale);
        const notes = String(sale.notes || '');
        const matchesSession =
          extractedSession === appliedFilters.sessionId ||
          notes.includes(appliedFilters.sessionId);
        if (!matchesSession) return false;
      }

      // 7. POS Type Filter
      if (appliedFilters.posType !== 'all') {
        const posType = getPosType(sale);
        if (posType !== appliedFilters.posType) return false;
      }

      // 8. Invoice Number Range / Search
      const invNum = getInvoiceNumber(sale);
      if (appliedFilters.invNumberFrom.trim()) {
        const fromVal = appliedFilters.invNumberFrom.trim().toUpperCase();
        if (!invNum.includes(fromVal) && invNum < fromVal) {
          return false;
        }
      }
      if (appliedFilters.invNumberTo.trim()) {
        const toVal = appliedFilters.invNumberTo.trim().toUpperCase();
        if (!invNum.includes(toVal) && invNum > toVal) {
          return false;
        }
      }

      // 9. Amount Range Filter
      const amount = Number(sale.total_amount ?? 0);
      if (appliedFilters.amountFrom !== '' && !isNaN(Number(appliedFilters.amountFrom))) {
        if (amount < Number(appliedFilters.amountFrom)) return false;
      }
      if (appliedFilters.amountTo !== '' && !isNaN(Number(appliedFilters.amountTo))) {
        if (amount > Number(appliedFilters.amountTo)) return false;
      }

      // 10. Notes Search
      if (appliedFilters.notesQuery.trim()) {
        const q = appliedFilters.notesQuery.trim().toLowerCase();
        const n = String(sale.notes || '').toLowerCase();
        if (!n.includes(q)) return false;
      }

      return true;
    });
  }, [rawSales, appliedFilters]);

  // Financial Breakdown Totals
  const totals = useMemo(() => {
    let count = filteredSales.length;
    let grandTotal = 0;
    let cashTotal = 0;
    let visaTotal = 0;
    let creditTotal = 0;

    filteredSales.forEach((s) => {
      const amt = Number(s.total_amount ?? 0);
      grandTotal += amt;
      const cat = getPaymentCategory(s);
      if (cat === 'visa') visaTotal += amt;
      else if (cat === 'credit') creditTotal += amt;
      else cashTotal += amt;
    });

    return {
      count,
      grandTotal,
      cashTotal,
      visaTotal,
      creditTotal,
    };
  }, [filteredSales]);

  return (
    <DashboardLayout>
      <div className="space-y-5 pb-16 max-w-7xl mx-auto px-2 sm:px-4" dir="rtl">
        {/* Top Header Card */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/95 dark:bg-slate-900/90 backdrop-blur-xl p-5 shadow-xs transition-colors flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-500/20">
              <Receipt size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
                  كشف فواتير المبيعات (POS)
                </h1>
                <span className="rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/80 px-2.5 py-0.5 text-xs font-black text-indigo-700 dark:text-indigo-300">
                  {totals.count} فاتورة
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-bold">
                استعراض وتدقيق فواتير نقاط البيع (العادية والسوبرماركت) ومتابعة الشيفتات وطرق الدفع
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                fetchSalesData();
                fetchSessions();
              }}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 shadow-xs transition-all disabled:opacity-50"
              title="تحديث البيانات من السيرفر"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin text-indigo-600' : ''} />
              <span>تحديث</span>
            </button>
          </div>
        </div>

        {/* 1. FILTER BAR (Structured Responsive Grid) */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/95 dark:bg-slate-900/90 backdrop-blur-xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
            <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 font-black text-xs">
              <SlidersHorizontal size={16} className="text-indigo-600" />
              <span>فلاتر البحث والتدقيق</span>
            </div>

            {/* مبيعات اليوم فقط + تذكر خياراتي */}
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-black text-indigo-700 dark:text-indigo-300 select-none">
                <input
                  type="checkbox"
                  checked={filters.isTodayOnly}
                  onChange={handleTodayOnlyToggle}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                />
                <span>📅 مبيعات اليوم فقط</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-slate-600 dark:text-slate-400 select-none">
                <input
                  type="checkbox"
                  checked={rememberChoices}
                  onChange={(e) => handleRememberToggle(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
                />
                <span className="flex items-center gap-1">
                  <BookmarkCheck size={13} className="text-amber-500" />
                  <span>تذكر خياراتي</span>
                </span>
              </label>
            </div>
          </div>

          {/* Filters Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {/* من تاريخ */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                من تاريخ
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, dateFrom: e.target.value, isTodayOnly: false }))
                  }
                  className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 text-xs font-bold font-currency text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 transition-all"
                />
              </div>
            </div>

            {/* إلى تاريخ */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                إلى تاريخ
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, dateTo: e.target.value, isTodayOnly: false }))
                  }
                  className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 text-xs font-bold font-currency text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 transition-all"
                />
              </div>
            </div>

            {/* من ساعة */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                من ساعة (اختياري)
              </label>
              <input
                type="time"
                value={filters.timeFrom}
                onChange={(e) => setFilters((prev) => ({ ...prev, timeFrom: e.target.value }))}
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 text-xs font-bold font-currency text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 transition-all"
              />
            </div>

            {/* إلى ساعة */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                إلى ساعة (اختياري)
              </label>
              <input
                type="time"
                value={filters.timeTo}
                onChange={(e) => setFilters((prev) => ({ ...prev, timeTo: e.target.value }))}
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 text-xs font-bold font-currency text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 transition-all"
              />
            </div>

            {/* الحالة */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                الحالة
              </label>
              <select
                value={filters.status}
                onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-2 text-xs font-bold text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 cursor-pointer transition-all"
              >
                <option value="all">الكل (جميع الحالات)</option>
                <option value="completed">مكتملة (ناجحة)</option>
                <option value="voided">ملغاة (Voided)</option>
                <option value="returned">مرتجعة جزئياً/كلياً</option>
              </select>
            </div>

            {/* طريقة الدفع */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                طريقة الدفع
              </label>
              <select
                value={filters.paymentMode}
                onChange={(e) => setFilters((prev) => ({ ...prev, paymentMode: e.target.value }))}
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-2 text-xs font-bold text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 cursor-pointer transition-all"
              >
                <option value="all">الكل (نقدي وبطاقة وآجل)</option>
                <option value="cash">نقدي (كاش)</option>
                <option value="visa">بطاقة / فيزا</option>
                <option value="credit">آجل (ذمة)</option>
              </select>
            </div>

            {/* الكاشير / المستخدم */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                الكاشير / المستخدم
              </label>
              <select
                value={filters.cashierId}
                onChange={(e) => setFilters((prev) => ({ ...prev, cashierId: e.target.value }))}
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-2 text-xs font-bold text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 cursor-pointer transition-all"
              >
                <option value="all">الكل (جميع المستخدمين)</option>
                {cashierOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* الشيفت / الصندوق */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                الصندوق / الشيفت
              </label>
              <select
                value={filters.sessionId}
                onChange={(e) => setFilters((prev) => ({ ...prev, sessionId: e.target.value }))}
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-2 text-xs font-bold text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 cursor-pointer transition-all"
              >
                <option value="all">الكل (جميع الشيفتات)</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    شيفت #{s.id.slice(0, 6)} ({s.status === 'open' ? 'مفتوح 🟢' : 'مغلق 🔒'}) - {new Date(s.opened_at).toLocaleDateString('ar-EG')}
                  </option>
                ))}
              </select>
            </div>

            {/* نوع نقطة البيع */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                نوع نقطة البيع
              </label>
              <select
                value={filters.posType}
                onChange={(e) => setFilters((prev) => ({ ...prev, posType: e.target.value }))}
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-2 text-xs font-bold text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 cursor-pointer transition-all"
              >
                <option value="all">الكل (العادية والسوبرماركت)</option>
                <option value="standard">نقطة البيع العادية</option>
                <option value="supermarket">سوبرماركت POS</option>
              </select>
            </div>

            {/* نطاق رقم الفاتورة من / إلى */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                رقم الفاتورة (من)
              </label>
              <input
                type="text"
                value={filters.invNumberFrom}
                onChange={(e) => setFilters((prev) => ({ ...prev, invNumberFrom: e.target.value }))}
                placeholder="مثلاً: A1B2..."
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 text-xs font-mono font-bold text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 transition-all uppercase"
                dir="ltr"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                رقم الفاتورة (إلى)
              </label>
              <input
                type="text"
                value={filters.invNumberTo}
                onChange={(e) => setFilters((prev) => ({ ...prev, invNumberTo: e.target.value }))}
                placeholder="مثلاً: Z9Y8..."
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 text-xs font-mono font-bold text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 transition-all uppercase"
                dir="ltr"
              />
            </div>

            {/* نطاق القيمة من / إلى */}
            <div>
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                المبلغ من ₪
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={filters.amountFrom}
                onChange={(e) => setFilters((prev) => ({ ...prev, amountFrom: e.target.value }))}
                placeholder="0"
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 text-xs font-currency font-bold text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 transition-all"
                dir="ltr"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                المبلغ إلى ₪
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={filters.amountTo}
                onChange={(e) => setFilters((prev) => ({ ...prev, amountTo: e.target.value }))}
                placeholder="بدون حد"
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 text-xs font-currency font-bold text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 transition-all"
                dir="ltr"
              />
            </div>

            {/* بحث بالملاحظات */}
            <div className="sm:col-span-2 md:col-span-2 lg:col-span-3 xl:col-span-3">
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                بحث بنص الملاحظات والزبون
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={filters.notesQuery}
                  onChange={(e) => setFilters((prev) => ({ ...prev, notesQuery: e.target.value }))}
                  placeholder="ابحث باسم الزبون، رقم الشيك، رقم الهاتف، أو نص الملاحظة…"
                  className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 text-xs font-bold text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 transition-all"
                />
                <Search size={14} className="absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* أزرار التطبيق وإعادة التعيين */}
            <div className="sm:col-span-2 md:col-span-3 lg:col-span-4 xl:col-span-2 flex items-end gap-2.5">
              <button
                type="button"
                onClick={handleApplyFilters}
                className="h-9 flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-black shadow-md shadow-indigo-500/20 transition-all"
              >
                <Search size={14} />
                <span>تطبيق الفلاتر</span>
              </button>

              <button
                type="button"
                onClick={handleResetFilters}
                className="h-9 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 active:scale-95 text-slate-700 text-xs font-bold px-3 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 shadow-xs transition-all"
                title="تصفير كل الخيارات للوضع الافتراضي"
              >
                <RotateCcw size={13} />
                <span>إعادة تعيين</span>
              </button>
            </div>
          </div>
        </div>

        {/* 2. RESULTS TABLE */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/95 dark:bg-slate-900/90 backdrop-blur-xl shadow-sm overflow-hidden transition-colors">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[950px] border-collapse text-right">
              <thead>
                <tr className="bg-indigo-600 text-white border-b border-indigo-700 text-xs font-black select-none shadow-xs">
                  <th className="py-3 px-3 font-black w-12 text-center text-white">#</th>
                  <th className="py-3 px-3 font-black min-w-[120px] text-center text-white" dir="ltr">
                    رقم الفاتورة
                  </th>
                  <th className="py-3 px-3 font-black min-w-[140px] text-center text-white">
                    التاريخ والوقت
                  </th>
                  <th className="py-3 px-3 font-black min-w-[130px] text-white">
                    الكاشير
                  </th>
                  <th className="py-3 px-3 font-black w-32 text-center text-white">
                    نوع نقطة البيع
                  </th>
                  <th className="py-3 px-3 font-black w-28 text-center text-white">
                    طريقة الدفع
                  </th>
                  <th className="py-3 px-3 font-black w-32 text-center text-white" dir="ltr">
                    القيمة الإجمالية
                  </th>
                  <th className="py-3 px-3 font-black w-28 text-center text-white">
                    الحالة
                  </th>
                  <th className="py-3 px-3 font-black w-20 text-center text-white">
                    معاينة
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-bold">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs font-black text-slate-600 dark:text-slate-300">
                          جاري تحميل فواتير المبيعات…
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center">
                      <div className="flex flex-col items-center justify-center gap-2 text-rose-600 dark:text-rose-400">
                        <AlertCircle size={28} />
                        <span className="text-xs font-bold">{error}</span>
                        <button
                          type="button"
                          onClick={fetchSalesData}
                          className="mt-1 px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300"
                        >
                          إعادة المحاولة
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : filteredSales.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800">
                          <Receipt size={24} />
                        </div>
                        <p className="font-bold text-sm text-slate-700 dark:text-slate-300">
                          لا توجد فواتير مطابقة للفلاتر المحددة
                        </p>
                        <p className="text-xs text-slate-400 max-w-sm">
                          جرب تعديل نطاق التاريخ أو إلغاء بعض شروط التصفية لإظهار المزيد من السجلات.
                        </p>
                        <button
                          type="button"
                          onClick={handleResetFilters}
                          className="mt-1 px-4 py-1.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:border-indigo-800 dark:text-indigo-300 text-xs font-black hover:bg-indigo-100 transition-colors"
                        >
                          إعادة تعيين الفلاتر
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredSales.map((sale, idx) => {
                    const invNumber = getInvoiceNumber(sale);
                    const posType = getPosType(sale);
                    const status = getSaleStatus(sale);
                    const payCat = getPaymentCategory(sale);
                    const cashierName = extractCashierLabel(
                      sale,
                      currentAuthUser?.id,
                      currentAuthUser?.name
                    );

                    const d = new Date(sale.created_at);
                    const dateFormatted = d.toLocaleDateString('ar-EG', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    });
                    const timeFormatted = d.toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    });

                    return (
                      <tr
                        key={sale.id}
                        onClick={() => setSelectedSaleId(sale.id)}
                        className={`cursor-pointer transition-colors group ${
                          status === 'voided'
                            ? 'bg-rose-50/40 hover:bg-rose-50/70 dark:bg-rose-950/10 dark:hover:bg-rose-950/20 opacity-85'
                            : status === 'returned'
                            ? 'bg-amber-50/40 hover:bg-amber-50/70 dark:bg-amber-950/10 dark:hover:bg-amber-950/20'
                            : 'hover:bg-indigo-50/60 dark:hover:bg-indigo-950/30'
                        }`}
                        title="انقر لعرض تفاصيل وطباعة الفاتورة الكاملة"
                      >
                        {/* 1. Index */}
                        <td className="py-2.5 px-3 text-center text-slate-400 font-bold font-currency" lang="en">
                          {idx + 1}
                        </td>

                        {/* 2. Invoice Number */}
                        <td className="py-2.5 px-3 text-center font-mono font-black text-indigo-700 dark:text-indigo-300" dir="ltr">
                          <span className="px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200/80 dark:border-indigo-800/60">
                            #{invNumber}
                          </span>
                        </td>

                        {/* 3. Date & Time */}
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          <div className="text-slate-800 dark:text-slate-200">{dateFormatted}</div>
                          <div className="text-[10px] text-slate-400 font-currency" dir="ltr" lang="en">
                            {timeFormatted}
                          </div>
                        </td>

                        {/* 4. Cashier */}
                        <td className="py-2.5 px-3 text-slate-800 dark:text-slate-200 font-bold truncate max-w-[140px]">
                          <div className="flex items-center gap-1.5">
                            <User size={13} className="text-slate-400 shrink-0" />
                            <span className="truncate">{cashierName}</span>
                          </div>
                        </td>

                        {/* 5. POS Type */}
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          {posType === 'supermarket' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                              <Store size={12} />
                              <span>سوبرماركت</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300 border border-violet-300 dark:border-violet-800">
                              <ShoppingBag size={12} />
                              <span>نقطة بيع عادية</span>
                            </span>
                          )}
                        </td>

                        {/* 6. Payment Method */}
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          {payCat === 'visa' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                              <CreditCard size={12} />
                              <span>بطاقة / فيزا</span>
                            </span>
                          ) : payCat === 'credit' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                              <span>آجل (ذمة)</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              <DollarSign size={12} />
                              <span>نقدي (كاش)</span>
                            </span>
                          )}
                        </td>

                        {/* 7. Amount */}
                        <td className="py-2.5 px-3 text-center font-currency font-black text-slate-900 dark:text-white whitespace-nowrap text-sm" dir="ltr" lang="en">
                          ₪ {formatMoney(sale.total_amount)}
                        </td>

                        {/* 8. Status */}
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          {status === 'voided' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                              <XCircle size={12} />
                              <span>ملغاة</span>
                            </span>
                          ) : status === 'returned' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700">
                              <span>مرتجعة</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                              <CheckCircle2 size={12} />
                              <span>مكتملة</span>
                            </span>
                          )}
                        </td>

                        {/* 9. Actions Preview */}
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedSaleId(sale.id);
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 transition-colors"
                            title="عرض الفاتورة"
                          >
                            <Eye size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 3. TOTALS BAR AT THE BOTTOM OF THE TABLE */}
          <div className="bg-indigo-50/90 dark:bg-indigo-950/50 border-t-2 border-indigo-200 dark:border-indigo-800/80 p-4 select-none">
            <div className="flex flex-wrap items-center justify-between gap-4 text-xs font-bold">
              {/* Count and Goods total */}
              <div className="flex flex-wrap items-center gap-4">
                <div className="rounded-xl bg-white dark:bg-slate-900 border border-indigo-200/80 dark:border-indigo-900/60 px-3.5 py-2 shadow-xs">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                    عدد الفواتير المطابقة
                  </span>
                  <span className="text-base font-black text-indigo-950 dark:text-indigo-100 font-currency" dir="ltr" lang="en">
                    {totals.count}
                  </span>
                </div>

                <div className="rounded-xl bg-white dark:bg-slate-900 border border-indigo-200/80 dark:border-indigo-900/60 px-3.5 py-2 shadow-xs">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                    مجموع كاش (نقدي)
                  </span>
                  <span className="text-sm font-black text-emerald-700 dark:text-emerald-400 font-currency" dir="ltr" lang="en">
                    ₪ {formatMoney(totals.cashTotal)}
                  </span>
                </div>

                <div className="rounded-xl bg-white dark:bg-slate-900 border border-indigo-200/80 dark:border-indigo-900/60 px-3.5 py-2 shadow-xs">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                    مجموع بطاقات (فيزا)
                  </span>
                  <span className="text-sm font-black text-blue-700 dark:text-blue-400 font-currency" dir="ltr" lang="en">
                    ₪ {formatMoney(totals.visaTotal)}
                  </span>
                </div>

                <div className="rounded-xl bg-white dark:bg-slate-900 border border-indigo-200/80 dark:border-indigo-900/60 px-3.5 py-2 shadow-xs">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                    مجموع آجل (ذمم)
                  </span>
                  <span className="text-sm font-black text-amber-700 dark:text-amber-400 font-currency" dir="ltr" lang="en">
                    ₪ {formatMoney(totals.creditTotal)}
                  </span>
                </div>
              </div>

              {/* Total Grand Amount */}
              <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50/90 dark:bg-emerald-950/60 px-5 py-2.5 shadow-md shadow-emerald-500/10">
                <span className="text-[11px] text-emerald-800 dark:text-emerald-300 block font-black">
                  إجمالي قيمة الفواتير
                </span>
                <span className="text-2xl font-black text-emerald-950 dark:text-emerald-100 font-currency" dir="ltr" lang="en">
                  ₪ {formatMoney(totals.grandTotal)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Unified Invoice Details Modal */}
      <InvoiceModal
        isOpen={Boolean(selectedSaleId)}
        saleId={selectedSaleId}
        onClose={() => setSelectedSaleId(null)}
        store={store}
        onInvoiceUpdated={() => {
          fetchSalesData();
        }}
      />
    </DashboardLayout>
  );
}
