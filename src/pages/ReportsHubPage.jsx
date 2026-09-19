import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Boxes,
  Users,
  Truck,
  ShoppingCart,
  Receipt,
  Search,
  Filter,
  Calendar,
  Download,
  Printer,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Package,
  PackageMinus,
  FileText,
  Clock,
  ArrowUpDown,
  BookOpen,
  ArrowDownLeft,
  ArrowUpRight,
  UserCheck,
  ChevronDown,
  Eye,
  Wallet,
  SlidersHorizontal,
  Layers,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import DashboardLayout from '../components/DashboardLayout';
import PurchaseDetailModal from '../components/PurchaseDetailModal';
import InvoiceModal from '../components/InvoiceModal';
import QuickVoucherModal from '../components/QuickVoucherModal';
import VoucherDetailModal from '../components/VoucherDetailModal';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { roundMoney } from '../utils/productModel';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';

// ── فئات التقارير الخمس الرئيسية ──
const CATEGORIES = [
  {
    id: 'inventory',
    label: 'المخزون',
    icon: Boxes,
    color: 'from-emerald-600 to-teal-700',
    badgeTone: 'emerald',
    description: 'الأرصدة، النواقص، حركات الأصناف، والأرباح',
  },
  {
    id: 'customers',
    label: 'العملاء',
    icon: Users,
    color: 'from-indigo-600 to-violet-700',
    badgeTone: 'indigo',
    description: 'كشوفات حساب الزبائن وأرصدة الذمم والديون',
  },
  {
    id: 'suppliers',
    label: 'الموردين',
    icon: Truck,
    color: 'from-amber-600 to-orange-700',
    badgeTone: 'amber',
    description: 'كشوفات حساب الموردين والذمم الدائنة والمشتريات',
  },
  {
    id: 'pos',
    label: 'نقاط البيع (POS)',
    icon: ShoppingCart,
    color: 'from-purple-600 to-pink-700',
    badgeTone: 'purple',
    description: 'كشف فواتير المبيعات، مبيعات اليوم، وطرق الدفع',
  },
  {
    id: 'accounting',
    label: 'السندات المحاسبية',
    icon: Receipt,
    color: 'from-sky-600 to-blue-700',
    badgeTone: 'sky',
    description: 'القيود اليومية المحاسبية وسندات القبض والصرف',
  },
];

// ── شجرة التقارير لكل فئة ──
const REPORTS_BY_CATEGORY = {
  inventory: [
    { id: 'inventory_balances', label: 'أرصدة المخزون وقيمتها المالية', icon: Boxes },
    { id: 'inventory_low_stock', label: 'بضائع تحت الحد الأدنى (النواقص)', icon: PackageMinus },
    { id: 'inventory_top_selling', label: 'الأكثر مبيعاً (Top 20)', icon: TrendingUp },
    { id: 'inventory_movement', label: 'حركة المخزون تفصيلي (كارت الصنف)', icon: ArrowUpDown },
    { id: 'inventory_slow_moving', label: 'أصناف راكدة لم تتحرك', icon: AlertTriangle },
    { id: 'inventory_sales_profit', label: 'أرباح المبيعات بالتكلفة الحالية', icon: DollarSign },
  ],
  customers: [
    { id: 'customer_statement', label: 'كشف حساب زبون تفصيلي', icon: FileText },
    { id: 'customer_balances', label: 'أرصدة العملاء والذمم المستحقة', icon: Users },
  ],
  suppliers: [
    { id: 'supplier_statement', label: 'كشف حساب مورد تفصيلي', icon: FileText },
    { id: 'supplier_balances', label: 'أرصدة الموردين المستحقة', icon: Truck },
  ],
  pos: [
    { id: 'pos_invoices', label: 'كشف فواتير المبيعات الشامل', icon: ShoppingCart },
    { id: 'pos_today_summary', label: 'مبيعات اليوم بالتفصيل', icon: Clock },
  ],
  accounting: [
    { id: 'journal_entries', label: 'القيود اليومية المحاسبية', icon: BookOpen },
    { id: 'receipt_vouchers', label: 'سندات القبض (Receipt)', icon: ArrowDownLeft },
    { id: 'payment_vouchers', label: 'سندات الصرف (Payment)', icon: ArrowUpRight },
  ],
};

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getThirtyDaysAgoStr() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function getSevenDaysAgoStr() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function formatMoney(num) {
  const n = Number(num || 0);
  return roundMoney(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseLineItems(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default function ReportsHubPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. القائمتان المنسدلتان المتتاليتان (Dependent Dropdowns)
  const initialCategory = useMemo(() => {
    const qCat = searchParams.get('category');
    return CATEGORIES.some((c) => c.id === qCat) ? qCat : 'inventory';
  }, []);

  const initialReport = useMemo(() => {
    const qRep = searchParams.get('report');
    const available = REPORTS_BY_CATEGORY[initialCategory] || [];
    return available.some((r) => r.id === qRep)
      ? qRep
      : available[0]?.id || 'inventory_balances';
  }, [initialCategory]);

  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [selectedReport, setSelectedReport] = useState(initialReport);

  // Sync state when URL searchParams change
  useEffect(() => {
    const qCat = searchParams.get('category');
    const qRep = searchParams.get('report');
    if (qCat && CATEGORIES.some((c) => c.id === qCat)) {
      setSelectedCategory(qCat);
      const reports = REPORTS_BY_CATEGORY[qCat] || [];
      if (qRep && reports.some((r) => r.id === qRep)) {
        setSelectedReport(qRep);
      } else if (reports.length > 0) {
        setSelectedReport(reports[0].id);
      }
    }
    const qCust = searchParams.get('customerId') || searchParams.get('contactId');
    if (qCust) setSelectedCustomerId(qCust);
    const qSupp = searchParams.get('supplierId') || searchParams.get('contactId');
    if (qSupp) setSelectedSupplierId(qSupp);
    const qProd = searchParams.get('productId');
    if (qProd) setSelectedProductId(qProd);
  }, [searchParams]);

  // مزامنة التقرير الافتراضي عند تغيير الفئة
  const handleCategoryChange = (catId) => {
    setSelectedCategory(catId);
    const reports = REPORTS_BY_CATEGORY[catId] || [];
    const firstRep = reports.length > 0 ? reports[0].id : '';
    if (firstRep) {
      setSelectedReport(firstRep);
      setSearchParams({ category: catId, report: firstRep }, { replace: true });
    }
  };

  const handleReportChange = (repId) => {
    setSelectedReport(repId);
    setSearchParams({ category: selectedCategory, report: repId }, { replace: true });
  };

  // 2. الفلاتر المشتركة والديناميكية
  const [dateFrom, setDateFrom] = useState(getThirtyDaysAgoStr);
  const [dateTo, setDateTo] = useState(getTodayStr);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('all');
  const [hideZeroStock, setHideZeroStock] = useState(false);
  const [lowStockLevel, setLowStockLevel] = useState('all'); // all, out, critical, low
  const [slowDaysOption, setSlowDaysOption] = useState('30'); // 30, 60, 90, never
  const [topSellingLimit, setTopSellingLimit] = useState(20);
  const [paymentModeFilter, setPaymentModeFilter] = useState('all'); // all, cash, visa, credit

  // منتقي الزبائن والموردين
  const [customersList, setCustomersList] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [suppliersList, setSuppliersList] = useState([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');

  // منتقي الأصناف لحركة المخزون
  const [productsList, setProductsList] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState('');

  const [loading, setLoading] = useState(false);
  const [reportResult, setReportResult] = useState(null); // { title, kpis: [], columns: [], rows: [] }

  // حالات نوافذ التفاصيل التفاعلية والسندات
  const [viewPurchaseId, setViewPurchaseId] = useState(null);
  const [viewSaleId, setViewSaleId] = useState(null);
  const [viewVoucherId, setViewVoucherId] = useState(null);
  const [voucherModalState, setVoucherModalState] = useState({
    open: false,
    type: 'payment',
    contact: null,
    amount: 0,
  });

  // جلب قوائم الزبائن والموردين والأصناف للفلاتر عند الحاجة
  useEffect(() => {
    if (!store?.id) return;
    let cancelled = false;

    // جلب الزبائن
    supabase
      .from('store_contacts')
      .select('id, name, phone, outstanding_amount')
      .eq('store_id', store.id)
      .eq('role', 'customer')
      .order('name')
      .then(({ data }) => {
        if (!cancelled && data) {
          setCustomersList(data);
          if (data.length > 0 && !selectedCustomerId) {
            setSelectedCustomerId(data[0].id);
          }
        }
      });

    // جلب الموردين
    supabase
      .from('store_contacts')
      .select('id, name, phone, outstanding_amount')
      .eq('store_id', store.id)
      .eq('role', 'supplier')
      .order('name')
      .then(({ data }) => {
        if (!cancelled && data) {
          setSuppliersList(data);
          if (data.length > 0 && !selectedSupplierId) {
            setSelectedSupplierId(data[0].id);
          }
        }
      });

    // جلب عينة الأصناف للاختيار
    supabase
      .from(PRODUCTS_TABLE)
      .select('id, barcode, eng_name, brand_group')
      .eq('store_id', store.id)
      .order('eng_name')
      .limit(300)
      .then(({ data }) => {
        if (!cancelled && data) {
          setProductsList(data);
          if (data.length > 0 && !selectedProductId) {
            setSelectedProductId(data[0].id);
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [store?.id]);

  // قائمة الماركات المتوفرة من الأصناف
  const availableBrands = useMemo(() => {
    const set = new Set();
    productsList.forEach((p) => {
      if (p.brand_group) set.add(p.brand_group);
    });
    return Array.from(set).sort();
  }, [productsList]);

  // تعيين سريع لنطاقات التاريخ
  const setQuickDateRange = (days) => {
    const today = getTodayStr();
    setDateTo(today);
    if (days === 0) {
      setDateFrom(today);
    } else {
      const d = new Date();
      d.setDate(d.getDate() - days);
      setDateFrom(d.toISOString().slice(0, 10));
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 4. تنفيذ الاستعلام الحقيقي حسب التقرير المختار
  // ─────────────────────────────────────────────────────────────
  const handleExecuteReport = async () => {
    if (!store?.id) {
      toast.error('يرجى اختيار المتجر أولاً');
      return;
    }

    setLoading(true);
    try {
      switch (selectedReport) {
        // ──────────────────────────────────────────────────────────
        // 1.1 أرصدة المخزون وقيمتها المالية
        // ──────────────────────────────────────────────────────────
        case 'inventory_balances': {
          let q = supabase
            .from(PRODUCTS_TABLE)
            .select(
              'id, barcode, reference, eng_name, brand_group, full_price, price_after_disc, purchase_price, stock_count, category, brand'
            )
            .eq('store_id', store.id)
            .order('stock_count', { ascending: false });

          const { data, error } = await q;
          if (error) throw error;

          const rawRows = data || [];
          const cleanQ = normalizeDigitsToLatin(searchQuery.trim()).toLowerCase();

          const filtered = rawRows.filter((item) => {
            const stock = Number(item.stock_count || 0);
            if (hideZeroStock && stock <= 0) return false;
            if (selectedBrand !== 'all' && item.brand_group !== selectedBrand) return false;
            if (cleanQ) {
              const name = String(item.eng_name || '').toLowerCase();
              const bc = String(item.barcode || '').toLowerCase();
              const ref = String(item.reference || '').toLowerCase();
              if (!name.includes(cleanQ) && !bc.includes(cleanQ) && !ref.includes(cleanQ))
                return false;
            }
            return true;
          });

          let totalItems = filtered.length;
          let totalUnits = 0;
          let totalCostVal = 0;
          let totalSaleVal = 0;

          const tableRows = filtered.map((it, idx) => {
            const qty = Number(it.stock_count || 0);
            const cost = Number(it.purchase_price || 0);
            const price = Number(it.price_after_disc || it.full_price || 0);
            const itemCostTotal = qty * cost;
            const itemSaleTotal = qty * price;

            totalUnits += qty;
            totalCostVal += itemCostTotal;
            totalSaleVal += itemSaleTotal;

            return {
              index: idx + 1,
              barcode: it.barcode || '—',
              name: it.eng_name || 'منتج',
              brand: it.brand_group || it.brand || '—',
              costPrice: formatMoney(cost),
              salePrice: formatMoney(price),
              qty: qty,
              costTotal: formatMoney(itemCostTotal),
              saleTotal: formatMoney(itemSaleTotal),
            };
          });

          setReportResult({
            title: 'تقرير أرصدة المخزون وقيمتها المالية',
            kpis: [
              { label: 'إجمالي الأصناف', value: totalItems, tone: 'indigo' },
              { label: 'إجمالي القطع بالمخزن', value: totalUnits, tone: 'sky' },
              { label: 'إجمالي القيمة بالتكلفة', value: `${formatMoney(totalCostVal)} ₪`, tone: 'amber' },
              { label: 'إجمالي القيمة البيعية المتوقعة', value: `${formatMoney(totalSaleVal)} ₪`, tone: 'emerald' },
            ],
            columns: [
              { key: 'index', header: '#', width: 6 },
              { key: 'barcode', header: 'الباركود', width: 15 },
              { key: 'name', header: 'اسم الصنف', width: 30 },
              { key: 'brand', header: 'الماركة/التصنيف', width: 16 },
              { key: 'costPrice', header: 'التكلفة (₪)', width: 12 },
              { key: 'salePrice', header: 'سعر البيع (₪)', width: 12 },
              { key: 'qty', header: 'الرصيد المتوفر', width: 14 },
              { key: 'costTotal', header: 'إجمالي التكلفة (₪)', width: 16 },
              { key: 'saleTotal', header: 'إجمالي البيع (₪)', width: 16 },
            ],
            rows: tableRows,
          });
          break;
        }

        // ──────────────────────────────────────────────────────────
        // 1.2 بضائع تحت الحد الأدنى (النواقص)
        // ──────────────────────────────────────────────────────────
        case 'inventory_low_stock': {
          const { data, error } = await supabase
            .from(PRODUCTS_TABLE)
            .select(
              'id, barcode, reference, eng_name, brand_group, full_price, price_after_disc, purchase_price, stock_count, box_count'
            )
            .eq('store_id', store.id)
            .order('stock_count', { ascending: true });

          if (error) throw error;

          const cleanQ = normalizeDigitsToLatin(searchQuery.trim()).toLowerCase();
          const items = (data || []).filter((it) => {
            const stock = Number(it.stock_count || 0);
            const minAlert = Math.max(1, Number(it.box_count || 5));
            const isLow = stock <= minAlert;
            if (!isLow) return false;

            if (lowStockLevel === 'out' && stock > 0) return false;
            if (lowStockLevel === 'critical' && (stock <= 0 || stock > Math.ceil(minAlert / 3)))
              return false;
            if (lowStockLevel === 'low' && stock <= Math.ceil(minAlert / 3)) return false;

            if (cleanQ) {
              const name = String(it.eng_name || '').toLowerCase();
              const bc = String(it.barcode || '').toLowerCase();
              if (!name.includes(cleanQ) && !bc.includes(cleanQ)) return false;
            }
            return true;
          });

          let outCount = 0;
          let criticalCount = 0;
          let totalDeficit = 0;

          const rows = items.map((it, idx) => {
            const stock = Number(it.stock_count || 0);
            const minAlert = Math.max(1, Number(it.box_count || 5));
            const deficit = Math.max(0, minAlert - stock);
            const cost = Number(it.purchase_price || it.full_price || 0);

            if (stock <= 0) outCount++;
            else if (stock <= Math.ceil(minAlert / 3)) criticalCount++;
            totalDeficit += deficit;

            let statusLabel = 'منخفض';
            let statusColor = 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-300';
            if (stock <= 0) {
              statusLabel = 'نفد المخزون';
              statusColor = 'text-rose-600 bg-rose-50 dark:bg-rose-950/40 border-rose-300';
            } else if (stock <= Math.ceil(minAlert / 3)) {
              statusLabel = 'حرج جداً';
              statusColor = 'text-orange-600 bg-orange-50 dark:bg-orange-950/40 border-orange-300';
            }

            return {
              index: idx + 1,
              barcode: it.barcode || '—',
              name: it.eng_name || 'منتج',
              brand: it.brand_group || '—',
              stock: stock,
              minAlert: minAlert,
              deficit: deficit,
              status: statusLabel,
              costPrice: formatMoney(cost),
              reorderCost: formatMoney(deficit * cost),
            };
          });

          setReportResult({
            title: 'تقرير بضائع تحت الحد الأدنى والنواقص',
            kpis: [
              { label: 'إجمالي الأصناف الناقصة', value: items.length, tone: 'rose' },
              { label: 'أصناف نفدت بالكامل (0)', value: outCount, tone: 'rose' },
              { label: 'أصناف في وضع حرج', value: criticalCount, tone: 'amber' },
              { label: 'إجمالي الكميات المطلوبة للطلب', value: totalDeficit, tone: 'sky' },
            ],
            columns: [
              { key: 'index', header: '#', width: 6 },
              { key: 'barcode', header: 'الباركود', width: 15 },
              { key: 'name', header: 'اسم الصنف', width: 30 },
              { key: 'brand', header: 'الماركة', width: 14 },
              { key: 'stock', header: 'الرصيد المتوفر', width: 14 },
              { key: 'minAlert', header: 'حد التنبيه', width: 12 },
              { key: 'deficit', header: 'العجز المطلوب', width: 14 },
              { key: 'status', header: 'الحالة', width: 14 },
              { key: 'costPrice', header: 'التكلفة (₪)', width: 12 },
              { key: 'reorderCost', header: 'تكلفة تغطية العجز (₪)', width: 18 },
            ],
            rows,
          });
          break;
        }

        // ──────────────────────────────────────────────────────────
        // 1.3 الأكثر مبيعاً (Top Selling Products)
        // ──────────────────────────────────────────────────────────
        case 'inventory_top_selling': {
          const { data: sales, error } = await supabase
            .from('sales')
            .select('line_items, returned_at')
            .eq('store_id', store.id)
            .gte('created_at', dateFrom + 'T00:00:00')
            .lte('created_at', dateTo + 'T23:59:59');

          if (error) throw error;

          const countMap = new Map();
          for (const s of sales || []) {
            if (s.returned_at) continue;
            const lines = parseLineItems(s.line_items);
            for (const line of lines) {
              const key = line.product_id || line.barcode || line.eng_name || line.name;
              if (!key) continue;
              const existing = countMap.get(key) || {
                id: line.product_id || null,
                barcode: line.barcode || '—',
                name: line.eng_name || line.name || 'منتج',
                unit: line.unit || 'قطعة',
                qtySold: 0,
                revenue: 0,
              };
              const q = Number(line.qty || 1);
              const price = Number(line.unit_price || line.price || 0);
              const lineTot = Number(line.line_total ?? q * price);

              existing.qtySold += q;
              existing.revenue += lineTot;
              countMap.set(key, existing);
            }
          }

          // ترتيب تنازلي حسب الكمية المباعة
          const sorted = Array.from(countMap.values())
            .sort((a, b) => b.qtySold - a.qtySold)
            .slice(0, Number(topSellingLimit) || 20);

          let totalUnitsSold = 0;
          let totalSalesRevenue = 0;

          const rows = sorted.map((it, idx) => {
            totalUnitsSold += it.qtySold;
            totalSalesRevenue += it.revenue;
            const avgPrice = it.qtySold > 0 ? it.revenue / it.qtySold : 0;
            return {
              rank: idx + 1,
              barcode: it.barcode,
              name: it.name,
              qtySold: it.qtySold,
              revenue: formatMoney(it.revenue),
              avgPrice: formatMoney(avgPrice),
            };
          });

          setReportResult({
            title: `تقرير الأكثر مبيعاً (أعلى ${topSellingLimit} صنف من ${dateFrom} إلى ${dateTo})`,
            kpis: [
              { label: 'عدد الأصناف في التقرير', value: rows.length, tone: 'purple' },
              { label: 'إجمالي القطع المباعة', value: totalUnitsSold, tone: 'indigo' },
              { label: 'إجمالي إيرادات المبيعات', value: `${formatMoney(totalSalesRevenue)} ₪`, tone: 'emerald' },
            ],
            columns: [
              { key: 'rank', header: 'الترتيب', width: 10 },
              { key: 'barcode', header: 'الباركود', width: 16 },
              { key: 'name', header: 'اسم المنتج', width: 35 },
              { key: 'qtySold', header: 'الكمية المباعة', width: 16 },
              { key: 'avgPrice', header: 'متوسط السعر (₪)', width: 16 },
              { key: 'revenue', header: 'إجمالي الإيراد (₪)', width: 20 },
            ],
            rows,
          });
          break;
        }

        // ──────────────────────────────────────────────────────────
        // 1.4 حركة المخزون تفصيلي (كارت الصنف)
        // ──────────────────────────────────────────────────────────
        case 'inventory_movement': {
          let q = supabase
            .from('inventory_logs')
            .select('*')
            .eq('store_id', store.id)
            .gte('created_at', dateFrom + 'T00:00:00')
            .lte('created_at', dateTo + 'T23:59:59')
            .order('created_at', { ascending: true });

          if (selectedProductId) {
            q = q.eq('product_id', selectedProductId);
          }

          const { data, error } = await q;
          if (error && !/does not exist|42P01|PGRST205/i.test(String(error.message || ''))) {
            throw error;
          }

          const logs = data || [];
          const REASON_MAP = {
            sale: 'بيع فاتورة',
            purchase: 'شراء وتوريد',
            adjustment: 'تسوية جردية',
            damaged: 'إتلاف بضاعة',
            return: 'مرتجع بيع',
            sale_return: 'مرتجع بيع',
            transfer: 'تحويل مخزني',
          };

          let totalIn = 0;
          let totalOut = 0;

          const rows = logs.map((l, idx) => {
            const before = Number(l.qty_before ?? 0);
            const after = Number(l.qty_after ?? 0);
            const delta = after - before;
            if (delta > 0) totalIn += delta;
            else totalOut += Math.abs(delta);

            const dt = l.created_at
              ? new Date(l.created_at).toLocaleString('ar-EG', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })
              : '—';

            return {
              index: idx + 1,
              date: dt,
              reason: REASON_MAP[l.reason] || l.reason || 'حركة مخزنية',
              productName: l.product_name || '—',
              barcode: l.barcode || '—',
              before: before,
              change: delta > 0 ? `+${delta}` : delta,
              after: after,
              user: l.actor_name || 'النظام',
            };
          });

          setReportResult({
            title: `تقرير حركة المخزون تفصيلي (كارت الصنف) من ${dateFrom} إلى ${dateTo}`,
            kpis: [
              { label: 'عدد الحركات المسجلة', value: rows.length, tone: 'indigo' },
              { label: 'إجمالي الوارد (+)', value: totalIn, tone: 'emerald' },
              { label: 'إجمالي المنصرف (-)', value: totalOut, tone: 'rose' },
              { label: 'صافي التغير بالمخزون', value: totalIn - totalOut, tone: 'sky' },
            ],
            columns: [
              { key: 'index', header: '#', width: 6 },
              { key: 'date', header: 'التاريخ والوقت', width: 18 },
              { key: 'reason', header: 'نوع الحركة', width: 16 },
              { key: 'productName', header: 'بيان الصنف', width: 28 },
              { key: 'barcode', header: 'الباركود', width: 15 },
              { key: 'before', header: 'الرصيد قبل', width: 12 },
              { key: 'change', header: 'التغيير (+/-)', width: 14 },
              { key: 'after', header: 'الرصيد بعد', width: 12 },
              { key: 'user', header: 'المستخدم / المصدر', width: 16 },
            ],
            rows,
          });
          break;
        }

        // ──────────────────────────────────────────────────────────
        // 1.5 أصناف لم تتحرك (راكدة)
        // ──────────────────────────────────────────────────────────
        case 'inventory_slow_moving': {
          const daysNum = parseInt(slowDaysOption, 10) || 30;
          const targetDate = new Date();
          targetDate.setDate(targetDate.getDate() - daysNum);

          // 1. جلب المنتجات ذات الرصيد الموجب
          const { data: prods, error: pErr } = await supabase
            .from(PRODUCTS_TABLE)
            .select('id, barcode, eng_name, brand_group, full_price, purchase_price, stock_count')
            .eq('store_id', store.id)
            .gt('stock_count', 0);

          if (pErr) throw pErr;

          // 2. جلب مبيعات الفترة
          const { data: sales, error: sErr } = await supabase
            .from('sales')
            .select('line_items, created_at')
            .eq('store_id', store.id)
            .gte('created_at', targetDate.toISOString());

          if (sErr) throw sErr;

          const activeProductIds = new Set();
          for (const s of sales || []) {
            const lines = parseLineItems(s.line_items);
            for (const l of lines) {
              if (l.product_id) activeProductIds.add(String(l.product_id));
              if (l.barcode) activeProductIds.add(String(l.barcode));
            }
          }

          // فرز الأصناف الراكدة التي لم تظهر في المبيعات
          const slowItems = (prods || []).filter((p) => {
            if (activeProductIds.has(String(p.id)) || activeProductIds.has(String(p.barcode))) {
              return false;
            }
            return true;
          });

          let frozenCapital = 0;
          let totalUnitsSlow = 0;

          const rows = slowItems.map((it, idx) => {
            const stock = Number(it.stock_count || 0);
            const cost = Number(it.purchase_price || it.full_price || 0);
            const totalVal = stock * cost;

            frozenCapital += totalVal;
            totalUnitsSlow += stock;

            return {
              index: idx + 1,
              barcode: it.barcode || '—',
              name: it.eng_name || 'منتج',
              brand: it.brand_group || '—',
              stock: stock,
              costPrice: formatMoney(cost),
              frozenValue: formatMoney(totalVal),
              daysPeriod: `أكثر من ${daysNum} يوم`,
            };
          });

          setReportResult({
            title: `تقرير الأصناف الراكدة التي لم تتحرك منذ ${daysNum} يوم`,
            kpis: [
              { label: 'عدد الأصناف الراكدة', value: rows.length, tone: 'rose' },
              { label: 'إجمالي القطع المجمدة', value: totalUnitsSlow, tone: 'amber' },
              { label: 'رأس المال المجمد بالبضاعة الراكدة', value: `${formatMoney(frozenCapital)} ₪`, tone: 'rose' },
            ],
            columns: [
              { key: 'index', header: '#', width: 6 },
              { key: 'barcode', header: 'الباركود', width: 16 },
              { key: 'name', header: 'اسم الصنف', width: 30 },
              { key: 'brand', header: 'الماركة', width: 15 },
              { key: 'stock', header: 'الرصيد الراكد', width: 14 },
              { key: 'costPrice', header: 'سعر التكلفة (₪)', width: 14 },
              { key: 'frozenValue', header: 'القيمة الراكدة (₪)', width: 18 },
              { key: 'daysPeriod', header: 'فترة الركود', width: 15 },
            ],
            rows,
          });
          break;
        }

        // ──────────────────────────────────────────────────────────
        // 1.6 أرباح المبيعات بالتكلفة الحالية
        // ──────────────────────────────────────────────────────────
        case 'inventory_sales_profit': {
          const [salesRes, prodsRes] = await Promise.all([
            supabase
              .from('sales')
              .select('line_items, returned_at, created_at')
              .eq('store_id', store.id)
              .gte('created_at', dateFrom + 'T00:00:00')
              .lte('created_at', dateTo + 'T23:59:59'),
            supabase
              .from(PRODUCTS_TABLE)
              .select('id, barcode, full_price, purchase_price, eng_name')
              .eq('store_id', store.id),
          ]);

          if (salesRes.error) throw salesRes.error;
          if (prodsRes.error) throw prodsRes.error;

          const prodCostMap = new Map();
          for (const p of prodsRes.data || []) {
            const cost = Number(p.purchase_price || p.full_price || 0);
            if (p.id) prodCostMap.set(String(p.id), { cost, name: p.eng_name || 'صنف' });
            if (p.barcode) prodCostMap.set(`b:${p.barcode}`, { cost, name: p.eng_name || 'صنف' });
          }

          const aggregated = new Map();
          let grandRevenue = 0;
          let grandCost = 0;

          for (const s of salesRes.data || []) {
            if (s.returned_at) continue;
            const lines = parseLineItems(s.line_items);
            for (const l of lines) {
              const q = Math.max(0, Number(l.qty || 1));
              const sellPrice = Number(l.unit_price || l.price || 0);
              const lineRevenue = Number(l.line_total ?? q * sellPrice);

              let itemCost = 0;
              let prodName = l.eng_name || l.name || 'صنف';
              if (l.product_id && prodCostMap.has(String(l.product_id))) {
                itemCost = prodCostMap.get(String(l.product_id)).cost;
                prodName = prodCostMap.get(String(l.product_id)).name;
              } else if (l.barcode && prodCostMap.has(`b:${l.barcode}`)) {
                itemCost = prodCostMap.get(`b:${l.barcode}`).cost;
                prodName = prodCostMap.get(`b:${l.barcode}`).name;
              }

              const lineCost = q * itemCost;
              const lineProfit = lineRevenue - lineCost;

              grandRevenue += lineRevenue;
              grandCost += lineCost;

              const key = l.product_id || l.barcode || prodName;
              const cur = aggregated.get(key) || {
                barcode: l.barcode || '—',
                name: prodName,
                qty: 0,
                revenue: 0,
                cost: 0,
                profit: 0,
              };

              cur.qty += q;
              cur.revenue += lineRevenue;
              cur.cost += lineCost;
              cur.profit += lineProfit;
              aggregated.set(key, cur);
            }
          }

          const sortedProfits = Array.from(aggregated.values()).sort((a, b) => b.profit - a.profit);
          const grandProfit = grandRevenue - grandCost;
          const grandMargin = grandRevenue > 0 ? (grandProfit / grandRevenue) * 100 : 0;

          const rows = sortedProfits.map((it, idx) => {
            const margin = it.revenue > 0 ? (it.profit / it.revenue) * 100 : 0;
            return {
              index: idx + 1,
              barcode: it.barcode,
              name: it.name,
              qty: it.qty,
              revenue: formatMoney(it.revenue),
              cost: formatMoney(it.cost),
              profit: formatMoney(it.profit),
              margin: `${roundMoney(margin)}%`,
            };
          });

          setReportResult({
            title: `تقرير أرباح المبيعات بالتكلفة الحالية من ${dateFrom} إلى ${dateTo}`,
            kpis: [
              { label: 'إجمالي الإيرادات (المبيعات)', value: `${formatMoney(grandRevenue)} ₪`, tone: 'sky' },
              { label: 'إجمالي التكلفة التقديرية', value: `${formatMoney(grandCost)} ₪`, tone: 'amber' },
              { label: 'صافي مجمل الربح', value: `${formatMoney(grandProfit)} ₪`, tone: 'emerald' },
              { label: 'متوسط هامش الربح الإجمالي', value: `${roundMoney(grandMargin)}%`, tone: 'purple' },
            ],
            columns: [
              { key: 'index', header: '#', width: 6 },
              { key: 'barcode', header: 'الباركود', width: 16 },
              { key: 'name', header: 'اسم الصنف', width: 30 },
              { key: 'qty', header: 'الكمية المباعة', width: 14 },
              { key: 'revenue', header: 'إجمالي البيع (₪)', width: 16 },
              { key: 'cost', header: 'إجمالي التكلفة (₪)', width: 16 },
              { key: 'profit', header: 'صافي الربح (₪)', width: 16 },
              { key: 'margin', header: 'هامش الربح %', width: 14 },
            ],
            rows,
          });
          break;
        }

        // ──────────────────────────────────────────────────────────
        // 2.1 كشف حساب زبون تفصيلي
        // ──────────────────────────────────────────────────────────
        case 'customer_statement': {
          let activeCustId = selectedCustomerId;
          if (!activeCustId) {
            if (customersList.length > 0) {
              activeCustId = customersList[0].id;
              setSelectedCustomerId(activeCustId);
            } else {
              const { data: firstC } = await supabase
                .from('store_contacts')
                .select('id, name')
                .eq('store_id', store.id)
                .eq('role', 'customer')
                .order('name')
                .limit(1);
              if (firstC?.[0]) {
                activeCustId = firstC[0].id;
                setSelectedCustomerId(activeCustId);
              }
            }
          }

          if (!activeCustId) {
            toast.warning('يرجى اختيار الزبون لعرض كشف حسابه أو إضافة زبائن أولاً');
            return;
          }

          const targetCust = customersList.find((c) => c.id === activeCustId);
          const custName = targetCust?.name || 'الزبون';

          // جلب قيود العميل من customer_ledger + فواتير المبيعات sales + سندات القبض vouchers
          const [ledgerRes, salesRes, vouchersRes] = await Promise.all([
            supabase
              .from('customer_ledger')
              .select('*')
              .eq('store_id', store.id)
              .eq('customer_id', activeCustId)
              .gte('created_at', dateFrom + 'T00:00:00')
              .lte('created_at', dateTo + 'T23:59:59')
              .order('created_at', { ascending: true }),
            supabase
              .from('sales')
              .select('id, created_at, total_amount, payment_mode, payment_method, notes')
              .eq('store_id', store.id)
              .eq('contact_id', activeCustId)
              .gte('created_at', dateFrom + 'T00:00:00')
              .lte('created_at', dateTo + 'T23:59:59')
              .order('created_at', { ascending: true }),
            supabase
              .from('vouchers')
              .select('*')
              .eq('store_id', store.id)
              .eq('voucher_type', 'receipt')
              .eq('account_id', activeCustId)
              .gte('created_at', dateFrom + 'T00:00:00')
              .lte('created_at', dateTo + 'T23:59:59')
              .order('created_at', { ascending: true }),
          ]);

          const ledger = ledgerRes.data || [];
          const sales = salesRes.data || [];
          const vouchers = vouchersRes.data || [];

          const knownSaleIds = new Set(ledger.map((e) => e.sale_id).filter(Boolean));
          const knownVoucherIds = new Set(
            ledger.map((e) => e.voucher_id || (e.description?.match(/سند\s*#?([a-f0-9-]+)/i)?.[1])).filter(Boolean)
          );

          const movements = [];

          // 1. حركات دفتر الأستاذ للعميل
          for (const entry of ledger) {
            movements.push({
              date: entry.created_at,
              description: entry.description || (Number(entry.debit || 0) > 0 ? 'فاتورة مبيعات آجل' : 'سند قبض'),
              ref: entry.sale_id ? `#${String(entry.sale_id).slice(0, 8).toUpperCase()}` : 'قيد دفتر أستاذ',
              saleId: entry.sale_id ? String(entry.sale_id) : null,
              voucherId: entry.voucher_id ? String(entry.voucher_id) : null,
              debit: Number(entry.debit || 0),
              credit: Number(entry.credit || 0),
            });
          }

          // 2. فواتير المبيعات (غير المكررة في دفتر الأستاذ)
          for (const s of sales) {
            if (knownSaleIds.has(s.id)) continue;
            const amt = Number(s.total_amount || 0);
            const pm = String(s.payment_mode || s.payment_method || '').toLowerCase();
            const isCredit = ['credit', 'deferred'].includes(pm);

            if (isCredit) {
              movements.push({
                date: s.created_at,
                description: s.notes ? `فاتورة مبيعات (آجل) — ${s.notes}` : 'فاتورة مبيعات (آجل)',
                ref: `#${String(s.id).slice(0, 8).toUpperCase()}`,
                saleId: String(s.id),
                voucherId: null,
                debit: amt,
                credit: 0,
              });
            } else {
              // فاتورة نقدية: تظهر كمرجع تاريخي دون أثر صافٍ على الرصيد
              movements.push({
                date: s.created_at,
                description: s.notes ? `فاتورة مبيعات (نقدي — مسددة) — ${s.notes}` : 'فاتورة مبيعات (نقدي — مسددة)',
                ref: `#${String(s.id).slice(0, 8).toUpperCase()}`,
                saleId: String(s.id),
                voucherId: null,
                debit: amt,
                credit: amt,
              });
            }
          }

          // 3. سندات القبض (غير المكررة في دفتر الأستاذ)
          for (const v of vouchers) {
            if (knownVoucherIds.has(v.id)) continue;
            const amt = Number(v.amount || 0);
            movements.push({
              date: v.created_at || v.date,
              description: v.description || 'سند قبض نقدي / شيكات',
              ref: v.reference_number ? `سند #${v.reference_number}` : (v.voucher_number ? `سند #${v.voucher_number}` : 'سند قبض'),
              saleId: null,
              voucherId: String(v.id),
              debit: 0,
              credit: amt,
            });
          }

          // ترتيب زمني للحركات
          movements.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

          let cumulativeBalance = 0;
          let totalDebit = 0;
          let totalCredit = 0;

          const rows = movements.map((m, idx) => {
            totalDebit += m.debit;
            totalCredit += m.credit;
            cumulativeBalance += m.debit - m.credit;

            return {
              index: idx + 1,
              date: m.date ? m.date.slice(0, 10) : '—',
              description: m.description,
              ref: m.ref,
              saleId: m.saleId,
              voucherId: m.voucherId,
              debit: m.debit > 0 ? formatMoney(m.debit) : '—',
              credit: m.credit > 0 ? formatMoney(m.credit) : '—',
              balance: formatMoney(cumulativeBalance),
              rawDebit: m.debit,
              rawCredit: m.credit,
              rawBalance: cumulativeBalance,
            };
          });

          setReportResult({
            reportKey: 'customer_statement',
            contact: targetCust,
            activeContactId: activeCustId,
            closingBalance: cumulativeBalance,
            totalDebit,
            totalCredit,
            title: `كشف حساب الزبون: ${custName} (من ${dateFrom} إلى ${dateTo})`,
            kpis: [
              { label: 'إجمالي المدين (عليه)', value: `${formatMoney(totalDebit)} ₪`, tone: 'rose' },
              { label: 'إجمالي الدائن (المسدد)', value: `${formatMoney(totalCredit)} ₪`, tone: 'emerald' },
              { label: 'الرصيد المستحق النهائي', value: `${formatMoney(cumulativeBalance)} ₪`, tone: cumulativeBalance > 0 ? 'rose' : 'emerald' },
            ],
            columns: [
              { key: 'index', header: '#', width: 6 },
              { key: 'date', header: 'التاريخ', width: 14 },
              { key: 'description', header: 'البيان', width: 35 },
              { key: 'ref', header: 'رقم المرجع', width: 14 },
              { key: 'debit', header: 'مدين (+) عليه', width: 15 },
              { key: 'credit', header: 'دائن (-) له', width: 15 },
              { key: 'balance', header: 'الرصيد التراكمي (₪)', width: 18 },
            ],
            rows,
          });
          break;
        }

        // ──────────────────────────────────────────────────────────
        // 2.2 أرصدة العملاء والذمم المستحقة
        // ──────────────────────────────────────────────────────────
        case 'customer_balances': {
          const { data, error } = await supabase
            .from('store_contacts')
            .select('id, name, phone, email, address, notes, outstanding_amount')
            .eq('store_id', store.id)
            .eq('role', 'customer')
            .gt('outstanding_amount', 0)
            .order('outstanding_amount', { ascending: false });

          if (error) throw error;

          const cleanQ = normalizeDigitsToLatin(searchQuery.trim()).toLowerCase();
          const list = (data || []).filter((c) => {
            if (!cleanQ) return true;
            return (
              String(c.name || '').toLowerCase().includes(cleanQ) ||
              String(c.phone || '').includes(cleanQ)
            );
          });

          let totalDebts = 0;
          const rows = list.map((c, idx) => {
            const debt = Number(c.outstanding_amount || 0);
            totalDebts += debt;
            return {
              index: idx + 1,
              name: c.name || 'عميل',
              phone: c.phone || '—',
              address: c.address || '—',
              debt: formatMoney(debt),
              notes: c.notes || '—',
            };
          });

          setReportResult({
            title: 'تقرير أرصدة العملاء والذمم المستحقة (مرتبة تنازلياً)',
            kpis: [
              { label: 'عدد العملاء المدينين', value: list.length, tone: 'indigo' },
              { label: 'إجمالي الديون المستحقة على العملاء', value: `${formatMoney(totalDebts)} ₪`, tone: 'rose' },
              { label: 'متوسط دين العميل', value: `${formatMoney(list.length > 0 ? totalDebts / list.length : 0)} ₪`, tone: 'amber' },
            ],
            columns: [
              { key: 'index', header: '#', width: 6 },
              { key: 'name', header: 'اسم الزبون', width: 28 },
              { key: 'phone', header: 'رقم الهاتف', width: 16 },
              { key: 'address', header: 'العنوان', width: 22 },
              { key: 'debt', header: 'المبلغ المستحق (₪)', width: 18 },
              { key: 'notes', header: 'ملاحظات', width: 25 },
            ],
            rows,
          });
          break;
        }

        // ──────────────────────────────────────────────────────────
        // 3.1 كشف حساب مورد تفصيلي
        // ──────────────────────────────────────────────────────────
        case 'supplier_statement': {
          let activeSupId = selectedSupplierId;
          if (!activeSupId) {
            if (suppliersList.length > 0) {
              activeSupId = suppliersList[0].id;
              setSelectedSupplierId(activeSupId);
            } else {
              const { data: firstS } = await supabase
                .from('store_contacts')
                .select('id, name')
                .eq('store_id', store.id)
                .eq('role', 'supplier')
                .order('name')
                .limit(1);
              if (firstS?.[0]) {
                activeSupId = firstS[0].id;
                setSelectedSupplierId(activeSupId);
              }
            }
          }

          if (!activeSupId) {
            toast.warning('يرجى اختيار المورد لعرض كشف حسابه أو إضافة موردين أولاً');
            return;
          }

          const targetSup = suppliersList.find((s) => s.id === activeSupId);
          const supName = targetSup?.name || 'المورد';

          // جلب فواتير الشراء والسندات للمورد
          const [purchasesRes, vouchersRes] = await Promise.all([
            supabase
              .from('store_purchases')
              .select('*')
              .eq('store_id', store.id)
              .eq('supplier_contact_id', activeSupId)
              .gte('created_at', dateFrom + 'T00:00:00')
              .lte('created_at', dateTo + 'T23:59:59')
              .order('created_at', { ascending: true }),
            supabase
              .from('vouchers')
              .select('*')
              .eq('store_id', store.id)
              .eq('voucher_type', 'payment')
              .eq('account_id', activeSupId)
              .gte('created_at', dateFrom + 'T00:00:00')
              .lte('created_at', dateTo + 'T23:59:59')
              .order('created_at', { ascending: true }),
          ]);

          const purchases = purchasesRes.data || [];
          const vouchers = vouchersRes.data || [];

          // دمج وترتيب الحركات زمنياً
          const merged = [
            ...purchases.map((p) => ({
              id: p.id,
              purchaseId: p.id,
              voucherId: null,
              date: p.created_at || p.invoice_date || p.purchase_date,
              type: 'purchase',
              ref: p.invoice_number ? `#${p.invoice_number}` : 'فاتورة شراء',
              description: p.notes || (p.supplier_company_name ? `فاتورة توريد من ${p.supplier_company_name}` : 'فاتورة توريد بضاعة'),
              amountDue: Number(p.total_amount || 0),
              amountPaid: 0,
            })),
            ...vouchers.map((v) => ({
              id: v.id,
              purchaseId: null,
              voucherId: v.id,
              date: v.created_at || v.date,
              type: 'payment',
              ref: v.reference_number ? `سند #${v.reference_number}` : (v.voucher_number ? `سند #${v.voucher_number}` : 'سند صرف'),
              description: v.description || 'تسديد دفعة للمورد',
              amountDue: 0,
              amountPaid: Number(v.amount || 0),
            })),
          ].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

          let cumBalance = 0;
          let totalBills = 0;
          let totalPayments = 0;

          const rows = merged.map((m, idx) => {
            totalBills += m.amountDue;
            totalPayments += m.amountPaid;
            cumBalance += m.amountDue - m.amountPaid;

            return {
              index: idx + 1,
              date: m.date ? m.date.slice(0, 10) : '—',
              ref: m.ref,
              description: m.description,
              purchaseId: m.purchaseId,
              voucherId: m.voucherId,
              type: m.type,
              debit: m.amountDue > 0 ? formatMoney(m.amountDue) : '—',
              credit: m.amountPaid > 0 ? formatMoney(m.amountPaid) : '—',
              billAmount: m.amountDue > 0 ? formatMoney(m.amountDue) : '—',
              paymentAmount: m.amountPaid > 0 ? formatMoney(m.amountPaid) : '—',
              balance: formatMoney(cumBalance),
              rawDebit: m.amountDue,
              rawCredit: m.amountPaid,
              rawBalance: cumBalance,
            };
          });

          setReportResult({
            reportKey: 'supplier_statement',
            contact: targetSup,
            activeContactId: activeSupId,
            closingBalance: cumBalance,
            totalBills,
            totalPayments,
            title: `كشف حساب المورد: ${supName} (من ${dateFrom} إلى ${dateTo})`,
            kpis: [
              { label: 'إجمالي فواتير الشراء', value: `${formatMoney(totalBills)} ₪`, tone: 'amber' },
              { label: 'إجمالي المدفوعات والسندات', value: `${formatMoney(totalPayments)} ₪`, tone: 'emerald' },
              { label: 'رصيد المورد المستحق حالياً', value: `${formatMoney(cumBalance)} ₪`, tone: 'rose' },
            ],
            columns: [
              { key: 'index', header: '#', width: 6 },
              { key: 'date', header: 'التاريخ', width: 14 },
              { key: 'ref', header: 'رقم المرجع/السند', width: 16 },
              { key: 'description', header: 'البيان والتفاصيل', width: 32 },
              { key: 'debit', header: 'فاتورة شراء (له)', width: 16 },
              { key: 'credit', header: 'سند صرف (منه)', width: 16 },
              { key: 'balance', header: 'الرصيد المستحق (₪)', width: 18 },
            ],
            rows,
          });
          break;
        }

        // ──────────────────────────────────────────────────────────
        // 3.2 أرصدة الموردين المستحقة
        // ──────────────────────────────────────────────────────────
        case 'supplier_balances': {
          const { data, error } = await supabase
            .from('store_contacts')
            .select('id, name, phone, email, address, notes, outstanding_amount')
            .eq('store_id', store.id)
            .eq('role', 'supplier')
            .gt('outstanding_amount', 0)
            .order('outstanding_amount', { ascending: false });

          if (error) throw error;

          let totalSupplierDebt = 0;
          const rows = (data || []).map((s, idx) => {
            const debt = Number(s.outstanding_amount || 0);
            totalSupplierDebt += debt;
            return {
              index: idx + 1,
              name: s.name || 'مورد',
              phone: s.phone || '—',
              address: s.address || '—',
              balance: formatMoney(debt),
              notes: s.notes || '—',
            };
          });

          setReportResult({
            title: 'تقرير أرصدة الموردين المستحقة (الذمم الدائنة)',
            kpis: [
              { label: 'عدد الموردين المستحقين', value: rows.length, tone: 'amber' },
              { label: 'إجمالي المبالغ المستحقة للموردين', value: `${formatMoney(totalSupplierDebt)} ₪`, tone: 'rose' },
            ],
            columns: [
              { key: 'index', header: '#', width: 6 },
              { key: 'name', header: 'اسم المورد', width: 30 },
              { key: 'phone', header: 'رقم الهاتف', width: 18 },
              { key: 'address', header: 'العنوان', width: 25 },
              { key: 'balance', header: 'المبلغ المستحق (₪)', width: 20 },
              { key: 'notes', header: 'ملاحظات', width: 25 },
            ],
            rows,
          });
          break;
        }

        // ──────────────────────────────────────────────────────────
        // 4.1 كشف فواتير المبيعات الشامل
        // ──────────────────────────────────────────────────────────
        case 'pos_invoices': {
          let q = supabase
            .from('sales')
            .select('id, created_at, total_amount, payment_mode, payment_method, notes, contact_id, line_items, status')
            .eq('store_id', store.id)
            .gte('created_at', dateFrom + 'T00:00:00')
            .lte('created_at', dateTo + 'T23:59:59')
            .order('created_at', { ascending: false });

          const { data, error } = await q;
          if (error) throw error;

          const cleanQ = normalizeDigitsToLatin(searchQuery.trim()).toLowerCase();
          const filtered = (data || []).filter((s) => {
            const mode = String(s.payment_mode || s.payment_method || 'cash').toLowerCase();
            if (paymentModeFilter !== 'all') {
              if (paymentModeFilter === 'cash' && !mode.includes('cash')) return false;
              if (paymentModeFilter === 'visa' && !mode.includes('visa') && !mode.includes('card'))
                return false;
              if (paymentModeFilter === 'credit' && !mode.includes('credit') && !mode.includes('deferred'))
                return false;
            }
            if (cleanQ) {
              const notesStr = String(s.notes || '').toLowerCase();
              const idStr = String(s.id || '').toLowerCase();
              if (!notesStr.includes(cleanQ) && !idStr.includes(cleanQ)) return false;
            }
            return true;
          });

          let totalRevenue = 0;
          let cashTotal = 0;
          let cardTotal = 0;
          let creditTotal = 0;

          const rows = filtered.map((s, idx) => {
            const amt = Number(s.total_amount || 0);
            totalRevenue += amt;

            const mode = String(s.payment_mode || s.payment_method || 'cash').toLowerCase();
            let modeLabel = 'نقدي كاش';
            if (mode.includes('visa') || mode.includes('card')) {
              modeLabel = 'بطاقة / فيزا';
              cardTotal += amt;
            } else if (mode.includes('credit') || mode.includes('deferred')) {
              modeLabel = 'آجل / دين';
              creditTotal += amt;
            } else {
              cashTotal += amt;
            }

            const lines = parseLineItems(s.line_items);
            const itemCount = lines.reduce((acc, cur) => acc + (Number(cur.qty) || 1), 0);

            const dt = s.created_at
              ? new Date(s.created_at).toLocaleString('ar-EG', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })
              : '—';

            return {
              index: idx + 1,
              invoiceId: `#${String(s.id).slice(0, 8).toUpperCase()}`,
              date: dt,
              mode: modeLabel,
              itemsCount: itemCount,
              totalAmount: formatMoney(amt),
            };
          });

          setReportResult({
            title: `كشف فواتير المبيعات من ${dateFrom} إلى ${dateTo}`,
            kpis: [
              { label: 'عدد الفواتير', value: rows.length, tone: 'indigo' },
              { label: 'إجمالي المبيعات', value: `${formatMoney(totalRevenue)} ₪`, tone: 'emerald' },
              { label: 'مبيعات الكاش', value: `${formatMoney(cashTotal)} ₪`, tone: 'teal' },
              { label: 'مبيعات البطاقة والفيزا', value: `${formatMoney(cardTotal)} ₪`, tone: 'sky' },
              { label: 'مبيعات الآجل والديون', value: `${formatMoney(creditTotal)} ₪`, tone: 'amber' },
            ],
            columns: [
              { key: 'index', header: '#', width: 6 },
              { key: 'invoiceId', header: 'رقم الفاتورة', width: 16 },
              { key: 'date', header: 'التاريخ والوقت', width: 20 },
              { key: 'mode', header: 'طريقة الدفع', width: 16 },
              { key: 'itemsCount', header: 'عدد القطع', width: 14 },
              { key: 'totalAmount', header: 'إجمالي الفاتورة (₪)', width: 18 },
            ],
            rows,
          });
          break;
        }

        // ──────────────────────────────────────────────────────────
        // 4.2 مبيعات اليوم بالتفصيل
        // ──────────────────────────────────────────────────────────
        case 'pos_today_summary': {
          const today = getTodayStr();
          const { data: sales, error } = await supabase
            .from('sales')
            .select('id, created_at, total_amount, payment_mode, payment_method, notes, line_items, cashier_id')
            .eq('store_id', store.id)
            .gte('created_at', today + 'T00:00:00')
            .lte('created_at', today + 'T23:59:59')
            .order('created_at', { ascending: false });

          if (error) throw error;

          const list = sales || [];
          let todayTotal = 0;
          let todayCash = 0;
          let todayCard = 0;
          let todayCredit = 0;

          const rows = list.map((s, idx) => {
            const amt = Number(s.total_amount || 0);
            todayTotal += amt;

            const mode = String(s.payment_mode || s.payment_method || 'cash').toLowerCase();
            let modeLabel = 'نقدي كاش';
            if (mode.includes('visa') || mode.includes('card')) {
              modeLabel = 'بطاقة / فيزا';
              todayCard += amt;
            } else if (mode.includes('credit') || mode.includes('deferred')) {
              modeLabel = 'آجل / دين';
              todayCredit += amt;
            } else {
              todayCash += amt;
            }

            const timeStr = s.created_at
              ? new Date(s.created_at).toLocaleTimeString('ar-EG', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '—';

            const lines = parseLineItems(s.line_items);
            const units = lines.reduce((acc, cur) => acc + (Number(cur.qty) || 1), 0);

            return {
              index: idx + 1,
              invoiceId: `#${String(s.id).slice(0, 8).toUpperCase()}`,
              time: timeStr,
              mode: modeLabel,
              units: units,
              total: formatMoney(amt),
            };
          });

          const avgInvoice = list.length > 0 ? todayTotal / list.length : 0;

          setReportResult({
            title: `تقرير مبيعات اليوم بالتفصيل (${today})`,
            kpis: [
              { label: 'عدد فواتير اليوم', value: list.length, tone: 'indigo' },
              { label: 'إجمالي مبيعات اليوم', value: `${formatMoney(todayTotal)} ₪`, tone: 'emerald' },
              { label: 'متوسط قيمة الفاتورة', value: `${formatMoney(avgInvoice)} ₪`, tone: 'sky' },
              { label: 'كاش نقدي', value: `${formatMoney(todayCash)} ₪`, tone: 'teal' },
              { label: 'بطاقات وفيزا', value: `${formatMoney(todayCard)} ₪`, tone: 'purple' },
              { label: 'آجل وذمم', value: `${formatMoney(todayCredit)} ₪`, tone: 'amber' },
            ],
            columns: [
              { key: 'index', header: '#', width: 6 },
              { key: 'invoiceId', header: 'رقم الفاتورة', width: 16 },
              { key: 'time', header: 'وقت العملية', width: 15 },
              { key: 'mode', header: 'طريقة الدفع', width: 16 },
              { key: 'units', header: 'الكمية (قطع)', width: 14 },
              { key: 'total', header: 'المبلغ (₪)', width: 18 },
            ],
            rows,
          });
          break;
        }

        // ──────────────────────────────────────────────────────────
        // 5.1 القيود اليومية المحاسبية
        // ──────────────────────────────────────────────────────────
        case 'journal_entries': {
          const { data, error } = await supabase
            .from('journal_entries')
            .select('*')
            .eq('store_id', store.id)
            .gte('created_at', dateFrom + 'T00:00:00')
            .lte('created_at', dateTo + 'T23:59:59')
            .order('created_at', { ascending: false });

          if (error && !/does not exist|42P01|PGRST205/i.test(String(error.message || ''))) {
            throw error;
          }

          let totalSum = 0;
          const rows = (data || []).map((e, idx) => {
            const amt = Number(e.total_amount || e.amount || 0);
            totalSum += amt;
            const dateStr = e.entry_date || (e.created_at ? e.created_at.slice(0, 10) : '—');
            return {
              index: idx + 1,
              entryNumber: e.entry_number ? `#${e.entry_number}` : `#Q-${idx + 1}`,
              date: dateStr,
              type: e.entry_type || 'قيد عام',
              description: e.description || 'قيد محاسبي',
              amount: formatMoney(amt),
            };
          });

          setReportResult({
            title: `سجل القيود اليومية المحاسبية من ${dateFrom} إلى ${dateTo}`,
            kpis: [
              { label: 'عدد القيود المحاسبية', value: rows.length, tone: 'indigo' },
              { label: 'إجمالي المبالغ المقيدة', value: `${formatMoney(totalSum)} ₪`, tone: 'emerald' },
            ],
            columns: [
              { key: 'index', header: '#', width: 6 },
              { key: 'entryNumber', header: 'رقم القيد', width: 15 },
              { key: 'date', header: 'تاريخ القيد', width: 15 },
              { key: 'type', header: 'نوع القيد', width: 18 },
              { key: 'description', header: 'بيان وتفاصيل القيد', width: 35 },
              { key: 'amount', header: 'مبلغ القيد (₪)', width: 18 },
            ],
            rows,
          });
          break;
        }

        // ──────────────────────────────────────────────────────────
        // 5.2 سندات القبض
        // ──────────────────────────────────────────────────────────
        case 'receipt_vouchers': {
          const { data, error } = await supabase
            .from('vouchers')
            .select('*')
            .eq('store_id', store.id)
            .eq('voucher_type', 'receipt')
            .gte('created_at', dateFrom + 'T00:00:00')
            .lte('created_at', dateTo + 'T23:59:59')
            .order('created_at', { ascending: false });

          if (error && !/does not exist|42P01|PGRST205/i.test(String(error.message || ''))) {
            throw error;
          }

          let totalReceipts = 0;
          const rows = (data || []).map((v, idx) => {
            const amt = Number(v.amount || 0);
            totalReceipts += amt;
            const dt = v.created_at ? v.created_at.slice(0, 10) : '—';
            return {
              index: idx + 1,
              voucherNo: v.reference_number ? `سند #${v.reference_number}` : (v.voucher_number ? `#${v.voucher_number}` : `#R-${idx + 1}`),
              date: dt,
              party: v.party_name || v.description?.slice(0, 30) || 'زبون / جهة',
              amount: formatMoney(amt),
              notes: v.description || '—',
            };
          });

          setReportResult({
            title: `تقرير سندات القبض من ${dateFrom} إلى ${dateTo}`,
            kpis: [
              { label: 'عدد سندات القبض', value: rows.length, tone: 'emerald' },
              { label: 'إجمالي المقبوضات', value: `${formatMoney(totalReceipts)} ₪`, tone: 'emerald' },
            ],
            columns: [
              { key: 'index', header: '#', width: 6 },
              { key: 'voucherNo', header: 'رقم السند', width: 16 },
              { key: 'date', header: 'تاريخ السند', width: 15 },
              { key: 'party', header: 'استلمنا من', width: 28 },
              { key: 'amount', header: 'المبلغ المقبوض (₪)', width: 18 },
              { key: 'notes', header: 'بيان السند', width: 30 },
            ],
            rows,
          });
          break;
        }

        // ──────────────────────────────────────────────────────────
        // 5.3 سندات الصرف
        // ──────────────────────────────────────────────────────────
        case 'payment_vouchers': {
          const { data, error } = await supabase
            .from('vouchers')
            .select('*')
            .eq('store_id', store.id)
            .eq('voucher_type', 'payment')
            .gte('created_at', dateFrom + 'T00:00:00')
            .lte('created_at', dateTo + 'T23:59:59')
            .order('created_at', { ascending: false });

          if (error && !/does not exist|42P01|PGRST205/i.test(String(error.message || ''))) {
            throw error;
          }

          let totalPayments = 0;
          const rows = (data || []).map((v, idx) => {
            const amt = Number(v.amount || 0);
            totalPayments += amt;
            const dt = v.created_at ? v.created_at.slice(0, 10) : '—';
            return {
              index: idx + 1,
              voucherNo: v.voucher_number ? `#${v.voucher_number}` : `#P-${idx + 1}`,
              date: dt,
              party: v.party_name || v.description?.slice(0, 30) || 'مورد / مصاريف',
              amount: formatMoney(amt),
              notes: v.description || '—',
            };
          });

          setReportResult({
            title: `تقرير سندات الصرف من ${dateFrom} إلى ${dateTo}`,
            kpis: [
              { label: 'عدد سندات الصرف', value: rows.length, tone: 'rose' },
              { label: 'إجمالي المدفوعات', value: `${formatMoney(totalPayments)} ₪`, tone: 'rose' },
            ],
            columns: [
              { key: 'index', header: '#', width: 6 },
              { key: 'voucherNo', header: 'رقم السند', width: 16 },
              { key: 'date', header: 'تاريخ السند', width: 15 },
              { key: 'party', header: 'صرفنا إلى', width: 28 },
              { key: 'amount', header: 'المبلغ المصروف (₪)', width: 18 },
              { key: 'notes', header: 'بيان الصرف', width: 30 },
            ],
            rows,
          });
          break;
        }

        default:
          toast.warning('يرجى اختيار تقرير صحيح');
      }
    } catch (err) {
      console.error('Report execution error:', err);
      toast.error('حدث خطأ أثناء استخراج التقرير: ' + (err.message || ''));
    } finally {
      setLoading(false);
    }
  };

  // ── التنفيذ التلقائي الفوري للتقرير عند فتح الصفحة أو تبديل التقرير المختار ──
  useEffect(() => {
    if (store?.id && selectedReport) {
      handleExecuteReport();
    }
  }, [store?.id, selectedReport]);

  useEffect(() => {
    if (store?.id && selectedReport === 'customer_statement' && selectedCustomerId) {
      handleExecuteReport();
    }
  }, [selectedCustomerId]);

  useEffect(() => {
    if (store?.id && selectedReport === 'supplier_statement' && selectedSupplierId) {
      handleExecuteReport();
    }
  }, [selectedSupplierId]);

  useEffect(() => {
    if (store?.id && selectedReport === 'inventory_movement' && selectedProductId) {
      handleExecuteReport();
    }
  }, [selectedProductId]);

  // ─────────────────────────────────────────────────────────────
  // 5. تصدير Excel فوري باستخدام ExcelJS
  // ─────────────────────────────────────────────────────────────
  const handleExportExcel = async () => {
    if (!reportResult || !reportResult.rows?.length) {
      toast.warning('لا توجد بيانات مصدرة حالياً في التقرير');
      return;
    }

    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(reportResult.title.slice(0, 30));
      worksheet.views = [{ rtl: true }];

      // إعداد الأعمدة
      worksheet.columns = reportResult.columns.map((c) => ({
        header: c.header,
        key: c.key,
        width: c.width || 18,
      }));

      // إدراج الصفوف
      reportResult.rows.forEach((r) => worksheet.addRow(r));

      // تنسيق شريط الرأس
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4F46E5' }, // Indigo-600
      };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportResult.title}-${getTodayStr()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('تم تصدير ملف Excel بنجاح ✓');
    } catch (err) {
      console.error('Error exporting excel:', err);
      toast.error('تعذر تصدير ملف الإكسل: ' + err.message);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 6. طباعة التقرير
  // ─────────────────────────────────────────────────────────────
  const handlePrint = () => {
    if (!reportResult || !reportResult.rows?.length) {
      toast.warning('لا توجد بيانات للطباعة');
      return;
    }
    window.print();
  };

  return (
    <DashboardLayout
      title="مركز التقارير الموحد"
      subtitle="منصة التقارير المركزية — استعلم عن المخزون، العملاء، الموردين، نقاط البيع، والسندات في شاشة واحدة"
    >
      <div className="space-y-6 print:m-0 print:p-0" dir="rtl">
        {/* أسلوب الطباعة المخصص */}
        <style>{`
          @media print {
            body { background: white !important; color: black !important; }
            header, nav, aside, .no-print { display: none !important; }
            .print-only { display: block !important; }
            .print-area { border: none !important; box-shadow: none !important; padding: 0 !important; }
          }
        `}</style>

        {/* ── 1. شبكة أيقونات الفئات الخمس (Category Cards) ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 no-print">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => handleCategoryChange(cat.id)}
                className={`group flex flex-col justify-between p-4 rounded-3xl border text-right transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? 'border-indigo-500 bg-white dark:bg-slate-900 shadow-lg shadow-indigo-500/10 ring-2 ring-indigo-500/30 -translate-y-1'
                    : 'border-slate-200/90 dark:border-white/10 bg-white/70 dark:bg-slate-900/50 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-white dark:hover:bg-slate-900 shadow-xs'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-3">
                  <div
                    className={`h-11 w-11 rounded-2xl bg-gradient-to-tr ${cat.color} text-white flex items-center justify-center shadow-md transition-transform group-hover:scale-110`}
                  >
                    <Icon size={22} />
                  </div>
                  {isSelected && (
                    <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    {cat.label}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
                    {cat.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── 2. صندوق التحكم بالقائمتين المنسدلتين المتتاليتين والفلاتر الديناميكية ── */}
        <div className="rounded-3xl border border-slate-200/90 dark:border-white/10 bg-white/90 dark:bg-slate-900/80 p-5 sm:p-6 shadow-sm backdrop-blur-xl space-y-5 no-print transition-colors">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-white/5 pb-4">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <SlidersHorizontal size={18} />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-900 dark:text-white">
                  معايير التقرير والفلاتر
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  اختر الفئة ثم حدد التقرير المطلوب لتخصيص خيارات الفلترة
                </p>
              </div>
            </div>

            {/* أزرار الإجراءات السريعة (عرض، تصدير، طباعة) */}
            <div className="flex items-center gap-2">
              {reportResult && reportResult.rows?.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={handleExportExcel}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-300 dark:border-emerald-800/80 bg-emerald-50/80 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 text-xs font-bold transition shadow-xs cursor-pointer active:scale-95"
                    title="تصدير النتائج المعروضة إلى ملف Excel"
                  >
                    <Download size={14} />
                    <span>تصدير Excel</span>
                  </button>

                  <button
                    type="button"
                    onClick={handlePrint}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition shadow-xs cursor-pointer active:scale-95"
                    title="طباعة التقرير"
                  >
                    <Printer size={14} />
                    <span>طباعة 🖨️</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={handleExecuteReport}
                disabled={loading}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-black text-xs sm:text-sm shadow-md shadow-indigo-500/20 hover:shadow-indigo-500/30 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
              >
                {loading ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <Search size={16} />
                )}
                <span>{reportResult ? 'تحديث التقرير 🔄' : 'عرض التقرير 📊'}</span>
              </button>
            </div>
          </div>

          {/* القائمتان المنسدلتان المتتاليتان (Dependent Dropdowns) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50/80 dark:bg-slate-950/50 p-4 rounded-2xl border border-slate-200/60 dark:border-white/5">
            {/* القائمة الأولى: الفئة */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                1. الفئة الرئيسية *
              </label>
              <div className="relative">
                <select
                  value={selectedCategory}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="w-full h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs sm:text-sm font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 appearance-none cursor-pointer"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  size={16}
                />
              </div>
            </div>

            {/* القائمة الثانية: التقرير (تتغير حسب الفئة) */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                2. التقرير المطلوب *
              </label>
              <div className="relative">
                <select
                  value={selectedReport}
                  onChange={(e) => handleReportChange(e.target.value)}
                  className="w-full h-11 rounded-xl border border-indigo-300 dark:border-indigo-700/80 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs sm:text-sm font-black text-indigo-700 dark:text-indigo-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 appearance-none cursor-pointer"
                >
                  {(REPORTS_BY_CATEGORY[selectedCategory] || []).map((rep) => (
                    <option key={rep.id} value={rep.id}>
                      {rep.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-500 pointer-events-none"
                  size={16}
                />
              </div>
            </div>
          </div>

          {/* ── الفلاتر الديناميكية المتغيرة حسب التقرير ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5 pt-1">
            {/* فلتر نطاق التاريخ (للتقارير التي تحتاج تاريخ) */}
            {[
              'inventory_top_selling',
              'inventory_movement',
              'inventory_sales_profit',
              'customer_statement',
              'supplier_statement',
              'pos_invoices',
              'journal_entries',
              'receipt_vouchers',
              'payment_vouchers',
            ].includes(selectedReport) && (
              <>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    من تاريخ:
                  </label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-mono font-bold text-slate-800 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    إلى تاريخ:
                  </label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-mono font-bold text-slate-800 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </>
            )}

            {/* تنبيه النطاق الزمني لكشف حساب الزبون والمورد لتوضيح أن الافتراضي 30 يوم وإتاحة توسيعه */}
            {['customer_statement', 'supplier_statement'].includes(selectedReport) && (
              <div className="col-span-full bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>
                    <strong>تنبيه النطاق الزمني:</strong> يُعرض كشف الحساب افتراضياً لآخر 30 يوماً فقط. إذا كانت هناك فواتير أو سندات سابقة غير ظاهرة، يمكنك توسيع الفترة بنقرة واحدة:
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDateFrom('2020-01-01')}
                    className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-colors"
                  >
                    عرض كل الفترات (من البداية)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setFullYear(d.getFullYear() - 1);
                      setDateFrom(d.toISOString().slice(0, 10));
                    }}
                    className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700/60 hover:bg-amber-50 dark:hover:bg-slate-700 text-amber-900 dark:text-amber-200 transition-colors"
                  >
                    آخر سنة
                  </button>
                </div>
              </div>
            )}

            {/* فلتر اختيار زبون محدد لكشف الحساب */}
            {selectedReport === 'customer_statement' && (
              <div className="col-span-1 sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  اختر الزبون *
                </label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-800 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">-- اختر زبوناً --</option>
                  {customersList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.phone ? `(${c.phone})` : ''}{' '}
                      {Number(c.outstanding_amount || 0) > 0
                        ? `[مدين: ${formatMoney(c.outstanding_amount)} ₪]`
                        : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* فلتر اختيار مورد محدد لكشف الحساب */}
            {selectedReport === 'supplier_statement' && (
              <div className="col-span-1 sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  اختر المورد *
                </label>
                <select
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-800 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">-- اختر مورداً --</option>
                  {suppliersList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.phone ? `(${s.phone})` : ''}{' '}
                      {Number(s.outstanding_amount || 0) > 0
                        ? `[دائن: ${formatMoney(s.outstanding_amount)} ₪]`
                        : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* فلتر اختيار صنف محدد لكارت حركة المخزون */}
            {selectedReport === 'inventory_movement' && (
              <div className="col-span-1 sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  تحديد الصنف (اختياري للكل):
                </label>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-800 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">-- كافة الأصناف --</option>
                  {productsList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.eng_name || 'صنف'} {p.barcode ? `(${p.barcode})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* فلتر البحث النصي العام */}
            {[
              'inventory_balances',
              'inventory_low_stock',
              'customer_balances',
              'supplier_balances',
              'pos_invoices',
            ].includes(selectedReport) && (
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  بحث سريع:
                </label>
                <div className="relative">
                  <Search
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                    size={14}
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ابحث بالاسم أو الباركود..."
                    className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pr-9 pl-3 text-xs font-medium text-slate-800 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* فلتر الماركة للأرصدة */}
            {selectedReport === 'inventory_balances' && (
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  الماركة / التصنيف:
                </label>
                <select
                  value={selectedBrand}
                  onChange={(e) => setSelectedBrand(e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-800 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="all">كافة الماركات والتصنيفات</option>
                  {availableBrands.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* تصفية الرصيد الصفري للأرصدة */}
            {selectedReport === 'inventory_balances' && (
              <div className="flex items-center gap-2 pt-6">
                <input
                  type="checkbox"
                  id="hideZeroStock"
                  checked={hideZeroStock}
                  onChange={(e) => setHideZeroStock(e.target.checked)}
                  className="rounded h-4 w-4 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <label
                  htmlFor="hideZeroStock"
                  className="text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  إخفاء الأصناف ذات الرصيد 0
                </label>
              </div>
            )}

            {/* فلتر مستوى النواقص */}
            {selectedReport === 'inventory_low_stock' && (
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  مستوى النقص:
                </label>
                <select
                  value={lowStockLevel}
                  onChange={(e) => setLowStockLevel(e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-800 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="all">الكل (منخفض وحرج وصفر)</option>
                  <option value="out">نفد تماماً (الرصيد 0)</option>
                  <option value="critical">وضع حرج جداً (ثلث الحد)</option>
                  <option value="low">منخفض فقط</option>
                </select>
              </div>
            )}

            {/* فلتر فترة الركود */}
            {selectedReport === 'inventory_slow_moving' && (
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  فترة عدم الحركة:
                </label>
                <select
                  value={slowDaysOption}
                  onChange={(e) => setSlowDaysOption(e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-800 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="30">لم تُبع منذ أكثر من 30 يوماً</option>
                  <option value="60">لم تُبع منذ أكثر من 60 يوماً</option>
                  <option value="90">لم تُبع منذ أكثر من 90 يوماً</option>
                </select>
              </div>
            )}

            {/* فلتر حد الأكثر مبيعاً */}
            {selectedReport === 'inventory_top_selling' && (
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  عدد النتائج:
                </label>
                <select
                  value={topSellingLimit}
                  onChange={(e) => setTopSellingLimit(Number(e.target.value))}
                  className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-800 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="10">أعلى 10 أصناف</option>
                  <option value="20">أعلى 20 صنفاً (الافتراضي)</option>
                  <option value="50">أعلى 50 صنفاً</option>
                </select>
              </div>
            )}

            {/* فلتر وسيلة الدفع لفواتير POS */}
            {selectedReport === 'pos_invoices' && (
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  طريقة الدفع:
                </label>
                <select
                  value={paymentModeFilter}
                  onChange={(e) => setPaymentModeFilter(e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-800 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="all">كافة طرق الدفع</option>
                  <option value="cash">نقدي (كاش فقط)</option>
                  <option value="visa">بطاقة / فيزا فقط</option>
                  <option value="credit">آجل / ديون فقط</option>
                </select>
              </div>
            )}
          </div>

          {/* أزرار سريعة لتحديد التاريخ */}
          {[
            'inventory_top_selling',
            'inventory_movement',
            'inventory_sales_profit',
            'customer_statement',
            'supplier_statement',
            'pos_invoices',
            'journal_entries',
            'receipt_vouchers',
            'payment_vouchers',
          ].includes(selectedReport) && (
            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100 dark:border-white/5 text-xs text-slate-500">
              <span className="font-bold text-slate-400 ml-1">تحديد سريع:</span>
              <button
                type="button"
                onClick={() => setQuickDateRange(0)}
                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-bold transition cursor-pointer"
              >
                اليوم
              </button>
              <button
                type="button"
                onClick={() => setQuickDateRange(7)}
                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-bold transition cursor-pointer"
              >
                آخر 7 أيام
              </button>
              <button
                type="button"
                onClick={() => setQuickDateRange(30)}
                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-bold transition cursor-pointer"
              >
                آخر 30 يوماً
              </button>
            </div>
          )}
        </div>

        {/* ── 3. مساحة عرض نتائج التقرير (Results Table & KPIs) ── */}
        {loading ? (
          <div className="rounded-3xl border border-slate-200/90 dark:border-white/10 bg-white/70 dark:bg-slate-900/50 p-16 text-center space-y-3">
            <RefreshCw
              size={36}
              className="animate-spin text-indigo-600 dark:text-indigo-400 mx-auto"
            />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              جاري معالجة واستخراج بيانات التقرير...
            </p>
          </div>
        ) : reportResult ? (
          <div className="space-y-4 print-area">
            {/* عنوان التقرير وتاريخ الإصدار */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/90 dark:border-white/10 pb-3">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  {reportResult.title}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  تاريخ استخراج التقرير: {new Date().toLocaleDateString('ar-EG')} — الساعة:{' '}
                  {new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <span className="font-mono text-xs font-bold bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 px-3 py-1.5 rounded-xl">
                عدد النتائج: {reportResult.rows?.length || 0}
              </span>
            </div>

            {['supplier_statement', 'customer_statement'].includes(reportResult.reportKey) ? (
              /* ── العرض الموحّد الراقي لكشف حساب المورد والزبون ── */
              <div className="space-y-5">
                {/* 1. بطاقات المؤشرات مع زر السند البارز */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* بطاقة الرصيد المستحق + زر السند المباشر */}
                  <div
                    className={`p-5 rounded-2xl border shadow-xs flex flex-col justify-between ${
                      reportResult.reportKey === 'supplier_statement'
                        ? 'bg-gradient-to-br from-rose-50 to-orange-50/70 border-rose-200 dark:from-rose-950/40 dark:to-orange-950/20 dark:border-rose-900/50'
                        : 'bg-gradient-to-br from-indigo-50 to-blue-50/70 border-indigo-200 dark:from-indigo-950/40 dark:to-blue-950/20 dark:border-indigo-900/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <span
                          className={`text-xs font-black block ${
                            reportResult.reportKey === 'supplier_statement'
                              ? 'text-rose-800 dark:text-rose-300'
                              : 'text-indigo-800 dark:text-indigo-300'
                          }`}
                        >
                          {reportResult.reportKey === 'supplier_statement'
                            ? 'رصيد المورد المستحق حالياً (له علينا)'
                            : 'الرصيد المستحق على الزبون (عليه للمتجر)'}
                        </span>
                        <span
                          className={`text-2xl font-black font-mono mt-1 block ${
                            reportResult.reportKey === 'supplier_statement'
                              ? 'text-rose-900 dark:text-rose-100'
                              : 'text-indigo-950 dark:text-indigo-100'
                          }`}
                        >
                          {formatMoney(reportResult.closingBalance || 0)} ₪
                        </span>
                      </div>
                      <div
                        className={`p-2.5 rounded-xl ${
                          reportResult.reportKey === 'supplier_statement'
                            ? 'bg-rose-200/80 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200'
                            : 'bg-indigo-200/80 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-200'
                        }`}
                      >
                        {reportResult.reportKey === 'supplier_statement' ? <Wallet size={22} /> : <Receipt size={22} />}
                      </div>
                    </div>

                    {/* زر السند البارز المباشر */}
                    <button
                      type="button"
                      onClick={() =>
                        setVoucherModalState({
                          open: true,
                          type: reportResult.reportKey === 'supplier_statement' ? 'payment' : 'receipt',
                          contact: reportResult.contact,
                          amount: reportResult.closingBalance || 0,
                        })
                      }
                      className={`w-full py-2.5 px-4 rounded-xl font-black text-xs text-white shadow-md flex items-center justify-center gap-2 transition-all active:scale-98 ${
                        reportResult.reportKey === 'supplier_statement'
                          ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/25'
                          : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/25'
                      }`}
                    >
                      {reportResult.reportKey === 'supplier_statement' ? (
                        <>
                          <Wallet size={16} />
                          <span>تسجيل سند صرف للمورد (تسديد دفعة) 💳</span>
                        </>
                      ) : (
                        <>
                          <Receipt size={16} />
                          <span>تسجيل سند قبض من الزبون (استلام دفعة) 💰</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* بطاقة إجمالي الفواتير (شراء / مبيعات) */}
                  <div className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/90 dark:bg-slate-900/70 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                        {reportResult.reportKey === 'supplier_statement'
                          ? 'إجمالي فواتير الشراء والتوريد'
                          : 'إجمالي فواتير المبيعات (المدين)'}
                      </span>
                      <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                        {reportResult.reportKey === 'supplier_statement' ? <Truck size={18} /> : <ShoppingCart size={18} />}
                      </div>
                    </div>
                    <span className="text-xl font-black font-mono text-slate-900 dark:text-white">
                      {formatMoney(
                        reportResult.reportKey === 'supplier_statement'
                          ? reportResult.totalBills || 0
                          : reportResult.totalDebit || 0
                      )}{' '}
                      ₪
                    </span>
                  </div>

                  {/* بطاقة إجمالي المدفوعات / السندات */}
                  <div className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/90 dark:bg-slate-900/70 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                        {reportResult.reportKey === 'supplier_statement'
                          ? 'إجمالي المدفوعات وسندات الصرف'
                          : 'إجمالي المقبوضات وسندات القبض'}
                      </span>
                      <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 size={18} />
                      </div>
                    </div>
                    <span className="text-xl font-black font-mono text-slate-900 dark:text-white">
                      {formatMoney(
                        reportResult.reportKey === 'supplier_statement'
                          ? reportResult.totalPayments || 0
                          : reportResult.totalCredit || 0
                      )}{' '}
                      ₪
                    </span>
                  </div>
                </div>

                {/* 2. جدول الحركات التفصيلي مع إمكانية النقر وعرض التفاصيل */}
                <div className="overflow-x-auto rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white dark:bg-slate-900 shadow-sm">
                  {reportResult.rows && reportResult.rows.length > 0 ? (
                    <table className="w-full text-right text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-900 text-white dark:bg-slate-950 border-b border-slate-800 select-none">
                          <th className="py-3 px-3 font-black text-center w-10">#</th>
                          <th className="py-3 px-3 font-black whitespace-nowrap">التاريخ</th>
                          <th className="py-3 px-3 font-black min-w-[200px]">البيان</th>
                          <th className="py-3 px-3 font-black whitespace-nowrap">المرجع</th>
                          <th className="py-3 px-3 font-black text-center w-28 whitespace-nowrap">تفاصيل الفاتورة / السند</th>
                          <th className="py-3 px-3 font-black text-center whitespace-nowrap">
                            {reportResult.reportKey === 'supplier_statement' ? 'مدين (له)' : 'مدين (+) عليه'}
                          </th>
                          <th className="py-3 px-3 font-black text-center whitespace-nowrap">
                            {reportResult.reportKey === 'supplier_statement' ? 'دائن (منه)' : 'دائن (-) له'}
                          </th>
                          <th className="py-3 px-3 font-black text-center whitespace-nowrap">
                            {reportResult.reportKey === 'supplier_statement' ? 'الرصيد المستحق (₪)' : 'الرصيد التراكمي (₪)'}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                        {reportResult.rows.map((row, rIdx) => {
                          const hasPurchase = Boolean(row.purchaseId);
                          const hasSale = Boolean(row.saleId);
                          const hasVoucher = Boolean(row.voucherId);
                          const isClickable = hasPurchase || hasSale || hasVoucher;

                          return (
                            <tr
                              key={rIdx}
                              onClick={() => {
                                if (hasPurchase) setViewPurchaseId(row.purchaseId);
                                else if (hasSale) setViewSaleId(row.saleId);
                                else if (hasVoucher) setViewVoucherId(row.voucherId);
                              }}
                              className={`transition-colors ${
                                isClickable
                                  ? 'cursor-pointer hover:bg-teal-50/70 dark:hover:bg-teal-950/40'
                                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                              } ${
                                rIdx % 2 === 0
                                  ? 'bg-white dark:bg-slate-900'
                                  : 'bg-slate-50/60 dark:bg-slate-800/30'
                              }`}
                              title={
                                hasPurchase
                                  ? 'اضغط لعرض تفاصيل فاتورة المشتريات والأصناف'
                                  : hasSale
                                  ? 'اضغط لعرض تفاصيل فاتورة المبيعات والأصناف'
                                  : hasVoucher
                                  ? 'اضغط لعرض تفاصيل السند'
                                  : undefined
                              }
                            >
                              <td className="py-2.5 px-3 text-center text-slate-400 font-bold">{rIdx + 1}</td>
                              <td className="py-2.5 px-3 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap" dir="ltr">
                                {row.date}
                              </td>
                              <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-slate-100">
                                {row.description}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-xs font-bold text-slate-600 dark:text-slate-400 whitespace-nowrap" dir="ltr">
                                {row.ref}
                              </td>
                              <td className="py-2.5 px-3 text-center align-middle whitespace-nowrap">
                                {hasPurchase ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setViewPurchaseId(row.purchaseId);
                                    }}
                                    className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-black text-teal-900 hover:bg-teal-100 dark:border-teal-800/50 dark:bg-teal-950/40 dark:text-teal-200 transition-colors"
                                  >
                                    <Eye size={13} />
                                    <span>عرض الفاتورة</span>
                                  </button>
                                ) : hasSale ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setViewSaleId(row.saleId);
                                    }}
                                    className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-black text-indigo-900 hover:bg-indigo-100 dark:border-indigo-800/50 dark:bg-indigo-950/40 dark:text-indigo-200 transition-colors"
                                  >
                                    <Eye size={13} />
                                    <span>عرض الفاتورة</span>
                                  </button>
                                ) : hasVoucher ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setViewVoucherId(row.voucherId);
                                    }}
                                    className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-950 hover:bg-amber-100 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-200 transition-colors"
                                  >
                                    <Receipt size={13} />
                                    <span>تفاصيل السند</span>
                                  </button>
                                ) : (
                                  <span className="text-slate-400 text-xs">—</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap" dir="ltr">
                                {row.debit}
                              </td>
                              <td className="py-2.5 px-3 text-center font-mono font-bold text-emerald-700 dark:text-emerald-300 whitespace-nowrap" dir="ltr">
                                {row.credit}
                              </td>
                              <td className="py-2.5 px-3 text-center font-mono font-black text-slate-900 dark:text-white whitespace-nowrap" dir="ltr">
                                {row.balance}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="py-16 text-center text-slate-500 dark:text-slate-400 text-xs">
                      لا توجد حركات مسجلة لهذا الحساب خلال الفترة المحددة.
                    </div>
                  )}

                  {/* شريط الرصيد الختامي أسفل الجدول */}
                  {reportResult.rows && reportResult.rows.length > 0 && (
                    <div
                      className={`flex justify-between items-center px-4 py-3.5 border-t text-xs font-black ${
                        reportResult.reportKey === 'supplier_statement'
                          ? 'bg-rose-50/70 border-rose-200 text-rose-950 dark:bg-rose-950/30 dark:border-rose-900/40 dark:text-rose-200'
                          : 'bg-indigo-50/70 border-indigo-200 text-indigo-950 dark:bg-indigo-950/30 dark:border-indigo-900/40 dark:text-indigo-200'
                      }`}
                    >
                      <span>
                        {reportResult.reportKey === 'supplier_statement'
                          ? 'رصيد الذمة الختامي للمورد (محسوب من الحركات)'
                          : 'الرصيد النهائي المستحق على الزبون (محسوب من الحركات)'}
                      </span>
                      <span className="font-mono text-sm" dir="ltr">
                        ₪ {formatMoney(reportResult.closingBalance || 0)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* ── العرض الافتراضي لباقي التقارير كما هو ── */
              <>
                {/* بطاقات المؤشرات الإجمالية (KPIs) */}
                {reportResult.kpis && reportResult.kpis.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {reportResult.kpis.map((kpi, idx) => (
                      <div
                        key={idx}
                        className="p-4 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/90 dark:bg-slate-900/70 shadow-xs"
                      >
                        <span className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">
                          {kpi.label}
                        </span>
                        <span className="block text-xl font-black font-mono text-slate-900 dark:text-white">
                          {kpi.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* جدول النتائج التفاعلي */}
                <div className="overflow-x-auto rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white dark:bg-slate-900 shadow-sm">
                  {reportResult.rows && reportResult.rows.length > 0 ? (
                    <table className="w-full text-right text-xs border-collapse">
                      <thead>
                        <tr className="bg-indigo-600 text-white border-b border-indigo-700 select-none">
                          {reportResult.columns.map((col) => (
                            <th
                              key={col.key}
                              className="py-3 px-3 font-black text-xs whitespace-nowrap"
                            >
                              {col.header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                        {reportResult.rows.map((row, rIdx) => (
                          <tr
                            key={rIdx}
                            className={`transition-colors ${
                              rIdx % 2 === 0
                                ? 'bg-white dark:bg-slate-900'
                                : 'bg-slate-50/70 dark:bg-slate-800/30'
                            } hover:bg-indigo-50/60 dark:hover:bg-indigo-950/40`}
                          >
                            {reportResult.columns.map((col) => {
                              const val = row[col.key];
                              return (
                                <td
                                  key={col.key}
                                  className="py-2.5 px-3 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap"
                                >
                                  {val != null ? String(val) : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="py-16 text-center text-slate-500 dark:text-slate-400 text-xs">
                      لا توجد حركات أو نتائج مطابقة لمعايير البحث في هذا التقرير.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          /* رسالة بداية لطيفة تشجع على اختيار التقرير وعرضه */
          <div className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 p-16 text-center space-y-3 bg-white/40 dark:bg-slate-900/20">
            <div className="h-14 w-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto shadow-sm">
              <FileText size={26} />
            </div>
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">
              اختر التقرير واضغط «عرض التقرير 📊»
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              سيتم تنفيذ الاستعلام مباشرة وعرض الجداول والمؤشرات الرقمية أسفل الشاشة، مع إمكانية
              الطباعة والتصدير لـ Excel بضغطة زر.
            </p>
          </div>
        )}
      </div>

      {/* نوافذ التفاصيل التفاعلية والسندات */}
      <PurchaseDetailModal
        isOpen={Boolean(viewPurchaseId)}
        purchaseId={viewPurchaseId}
        storeId={store?.id}
        onClose={() => setViewPurchaseId(null)}
      />

      <InvoiceModal
        isOpen={Boolean(viewSaleId)}
        saleId={viewSaleId}
        store={store}
        onClose={() => setViewSaleId(null)}
        onInvoiceUpdated={handleExecuteReport}
      />

      <QuickVoucherModal
        isOpen={voucherModalState.open}
        onClose={() => setVoucherModalState((prev) => ({ ...prev, open: false }))}
        type={voucherModalState.type}
        contact={voucherModalState.contact}
        initialAmount={voucherModalState.amount}
        store={store}
        onSuccess={handleExecuteReport}
      />

      <VoucherDetailModal
        isOpen={Boolean(viewVoucherId)}
        voucherId={viewVoucherId}
        storeId={store?.id}
        onClose={() => setViewVoucherId(null)}
      />
    </DashboardLayout>
  );
}
