import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Loader2,
  Search,
  ScanLine,
  Trash2,
  Minus,
  Plus,
  UserPlus,
  CreditCard,
  User,
  ShoppingBag,
  FileText,
  ShoppingCart,
  CheckCircle2,
  Printer,
  X,
  SlidersHorizontal,
  Menu,
  Sparkles,
  Star,
  ArrowRight,
  TrendingUp,
  Maximize2,
} from 'lucide-react';
import { supabase, PRODUCTS_TABLE, PRODUCTS_STOCK_COLUMN } from '../lib/supabaseClient';
import { normalizeItemFromSupabase, isUuid, roundMoney, runProductsSelectWithFallback } from '../utils/productModel';
import { insertInventoryLog } from '../lib/inventoryLogs';
import { normalizeDigitsToLatin, normalizePriceInput } from '../utils/normalizeDigits';
import { getPublicImageUrl } from '../utils/storageImageUrl';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { useBarcodeScannerMode } from '../lib/barcodeInputPrefs';
import {
  applyAdvancedProductFilters,
  computeFacetCounts,
} from '../utils/productAdvancedFilters';
import { STATIC_POS_BRAND_OPTIONS } from '../utils/staticPosFilterDefaults';
import { PRODUCT_TYPE_SLUGS, PRODUCT_TYPE_LABEL_AR } from '../utils/productTypes';
import Sidebar from '../components/Sidebar';
import PosProductFiltersSidebar from '../components/PosProductFiltersSidebar';
import ProductCard from '../components/ProductCard';
import PrintInvoice from '../components/PrintInvoice';
import PrintPosReceiptSimple from '../components/PrintPosReceiptSimple';
import POSCheckoutFullForm from '../components/POSCheckoutFullForm';
import { applyCashSaleToMainCashFund } from '../utils/saleAccounting';
import { isCreditLimitExceeded, verifyCreditLimitAllowsSale } from '../utils/creditLimit';
import {
  evaluatePromotions,
  getPromotionSuggestions,
  effectiveUnitForLine,
  STORE_PROMOTIONS_TABLE,
} from '../utils/promotionEngine';
import {
  DEFAULT_LOYALTY_SETTINGS,
  LOYALTY_TX_TABLE,
  computeEarnedPoints,
  computeEffectiveRedemption,
  fetchLoyaltySettings,
} from '../utils/loyalty';
import {
  fetchReviewsAggregate,
  submitProductReview,
} from '../utils/productReviews';
import StarRating from '../components/StarRating';
import { brandStorageKey } from '../constants/brand.js';

const PAGE_SIZE = 80;

/** تسميات عربية لحقول POS الإضافية */
const POS_TENDER_AR = {
  cash: 'نقدي',
  visa: 'دفع إلكتروني',
  digital_wallet: 'محفظة رقمية',
  check: 'شيك',
};
const POS_TENDER_KEYS = ['cash', 'visa', 'digital_wallet', 'check'];
const PICKUP_LOC_AR = { showroom: 'المعرض', warehouse: 'المخزن' };

function buildCheckLinesForPrint(oc) {
  if (!oc || oc.posTender !== 'check') return undefined;
  const n = Math.max(1, Math.min(50, Number.parseInt(String(oc.checkCount ?? 1), 10) || 1));
  const dates = oc.checkDates || [];
  return [
    `عدد الشيكات: ${n}`,
    ...dates.slice(0, n).map((d, i) => `شيك ${i + 1} — تاريخ: ${d || '—'}`),
  ];
}

/** نفس مفتاح DashboardLayout — حالة طي القائمة تبقى عند التنقل */
const SIDEBAR_COLLAPSED_KEY = brandStorageKey('sidebar-collapsed');

function readSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * بحث نصي يعمل بالتوازي مع الفلاتر (يُطبَّق أولاً على المخزون، ثم الفلاتر على النتيجة).
 * يوحّد الأرقام العربية/اللاتينية حتى يطابق "65" مع "٦٥" في الاسم أو المرجع.
 */
function productMatchesPosSearch(item, rawQuery) {
  const q = normalizeDigitsToLatin(String(rawQuery || '').trim()).toLowerCase();
  if (!q) return true;
  const fields = [item.name, item.barcode, item.reference, item.group];
  return fields.some((f) => {
    const t = normalizeDigitsToLatin(String(f ?? '')).toLowerCase();
    return t.includes(q);
  });
}

function normPromotionId(id) {
  return id != null ? String(id).trim() : '';
}

/** تجميع كميات المبيعات من line_items — مثل صفحة المخزن */
function aggregateSalesQtyByProduct(salesRows) {
  const m = new Map();
  for (const s of salesRows || []) {
    const raw = s.line_items;
    let lines = [];
    if (Array.isArray(raw)) lines = raw;
    else if (typeof raw === 'string') {
      try {
        const j = JSON.parse(raw);
        if (Array.isArray(j)) lines = j;
      } catch {
        /* ignore */
      }
    }
    for (const line of lines) {
      const q = Math.max(0, Number(line.qty) || 0);
      if (q <= 0) continue;
      const pid = line.product_id != null ? String(line.product_id) : '';
      const bc = line.barcode != null ? String(line.barcode) : '';
      if (pid) m.set(pid, (m.get(pid) || 0) + q);
      if (bc) m.set(`b:${bc}`, (m.get(`b:${bc}`) || 0) + q);
    }
  }
  return m;
}

function getStockStatus(item) {
  const s = item?.stock;
  if (s == null || s === '') return 'غير موجود';
  const n = Number(s);
  if (Number.isNaN(n)) return 'غير موجود';
  return n > 0 ? 'موجود' : 'غير موجود';
}

function trimSerial(serial) {
  if (serial == null) return '';
  return String(serial).trim();
}

/** نص عرض للفاتورة — يحافظ على أسطر متعددة */
function serialForPrint(serial) {
  const t = trimSerial(serial);
  return t || undefined;
}

/** سطر سلة موحّد — الشريط الجانبي وعرض السلة الكامل */
function PosCartLineBlock({
  o,
  shellDark,
  promotionLabels,
  getLineUnitPrice,
  getLineTotal,
  removeFromOrder,
  updateQuantity,
  increaseQuantity,
  updateLineSerial,
  updateLineUnitPrice,
}) {
  const [serialOpen, setSerialOpen] = useState(false);

  return (
    <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-50">{o.item?.name}</p>
          <div className="mt-1 inline-flex items-center gap-1 rounded border border-gray-300 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800">
            <span className="text-xs text-gray-500 dark:text-gray-400">₪</span>
            <input
              type="text"
              inputMode="decimal"
              value={getLineUnitPrice(o)}
              onChange={(e) => updateLineUnitPrice(o.id, e.target.value)}
              className="w-16 border-0 bg-transparent p-0 text-xs font-semibold text-indigo-600 outline-none dark:text-indigo-400"
              dir="ltr"
              lang="en"
              aria-label="سعر بيع الوحدة"
              title="تعديل سعر بيع الوحدة"
            />
          </div>
          <div className="mt-2 inline-flex items-center gap-2">
            <button type="button" onClick={() => updateQuantity(o.id, -1)} className="flex h-7 w-7 items-center justify-center rounded border border-gray-300 text-xs dark:border-gray-700" aria-label="إنقاص الكمية">
              <Minus size={12} />
            </button>
            <span className="w-7 text-center text-xs font-semibold" dir="ltr">{o.qty}</span>
            <button type="button" onClick={() => increaseQuantity(o)} className="flex h-7 w-7 items-center justify-center rounded border border-gray-300 text-xs dark:border-gray-700" aria-label="زيادة الكمية">
              <Plus size={12} />
            </button>
          </div>
        </div>
        <span className="text-sm font-semibold text-indigo-600" dir="ltr" lang="en">₪{getLineTotal(o).toFixed(2)}</span>
        <button type="button" onClick={() => removeFromOrder(o.id)} className="text-gray-400 transition hover:text-red-500" aria-label="حذف المنتج">
          <Trash2 size={14} />
        </button>
      </div>
      {promotionLabels?.length ? (
        <p className="mt-1 truncate text-[10px] text-amber-600 dark:text-amber-400">
          {promotionLabels.join(' · ')}
        </p>
      ) : null}
      <div className="sr-only">
        <button type="button" onClick={() => setSerialOpen((open) => !open)} aria-expanded={serialOpen}>serial</button>
        {serialOpen && (
          o.qty <= 1 ? (
            <input type="text" value={o.serial ?? ''} onChange={(e) => updateLineSerial(o.id, e.target.value)} />
          ) : (
            <textarea value={o.serial ?? ''} onChange={(e) => updateLineSerial(o.id, e.target.value)} />
          )
        )}
      </div>
    </div>
  );
}

export default function POSPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  /** تأخير بسيط للتصفية حتى لا تُعاد رسم الشبكة عند كل حرف — يبقى الحقل فورياً */
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [orderItems, setOrderItems] = useState([]);
  const [orderCustomer, setOrderCustomer] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    notes: '',
    contactId: null,
    salePaymentMode: 'cash',
    posTender: 'cash',
    checkCount: 1,
    checkDates: [''],
    visaLast4: '',
    walletLabel: '',
    pickupDate: '',
    pickupLocation: '',
    manualDiscount: 0,
  });
  const [directoryCustomers, setDirectoryCustomers] = useState([]);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const [printInvoiceData, setPrintInvoiceData] = useState(null);
  const shellDark = true;
  const barcodeScannerMode = useBarcodeScannerMode();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    typeof window !== 'undefined' ? readSidebarCollapsed() : false
  );
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? 'true' : 'false');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const [successToast, setSuccessToast] = useState(null);
  const [simpleReceiptPrint, setSimpleReceiptPrint] = useState(null);
  const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({ name: '', phone: '' });
  const [newCustomerSaving, setNewCustomerSaving] = useState(false);
  const [newCustomerError, setNewCustomerError] = useState(null);

  /** نقاط الولاء — إعدادات المتجر + نقاط يدوية للاستبدال */
  const [storeLoyaltySettings, setStoreLoyaltySettings] = useState(null);
  const [loyaltyMissingTable, setLoyaltyMissingTable] = useState(false);
  const [loyaltyPointsInput, setLoyaltyPointsInput] = useState('');

  /** عروض تسويقية نشطة — تُقيَّم على السلة */
  const [promotions, setPromotions] = useState([]);

  /** اختصارات عرض المنتجات: الكل | الأكثر مبيعاً | أصناف ضمن عروض الحزم */
  const [posShortcutFilter, setPosShortcutFilter] = useState('none');
  const [salesQtyMap, setSalesQtyMap] = useState(() => new Map());
  const [salesMapVersion, setSalesMapVersion] = useState(0);

  /** فلاتر الشريط الجانبي (نوع / علامة / حجم) — تُطبَّق بعد البحث النصي */
  const [posFilterCategories, setPosFilterCategories] = useState([]);
  const [posFilterBrands, setPosFilterBrands] = useState([]);
  const [posFilterProductTypes, setPosFilterProductTypes] = useState([]);
  const [posFiltersSheetOpen, setPosFiltersSheetOpen] = useState(false);
  const [posFiltersCollapsed, setPosFiltersCollapsed] = useState(false);
  /** خطوة ثانية: صفحة كاملة لبيانات العميل والدفع بدل الضغط في الشريط الضيق */
  const [posCheckoutOpen, setPosCheckoutOpen] = useState(false);
  /** عرض السلة بملء الشاشة — من شريط الرأس أو التوسيع */
  const [posCartFullOpen, setPosCartFullOpen] = useState(false);

  /** تقييمات المنتجات — مجمَّعة { [productId]: { avg, count } } */
  const [reviewsMap, setReviewsMap] = useState({});
  const [reviewModal, setReviewModal] = useState(null); // { item } | null
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewName, setReviewName] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);

  const barcodeInputRef = useRef(null);
  const loadMoreRef = useRef(null);
  const scrollContainerRef = useRef(null);

  /** جلب مجمَّع التقييمات بعد تحميل المنتجات */
  useEffect(() => {
    if (!store?.id) return;
    fetchReviewsAggregate(supabase, store.id).then((map) => {
      if (map) setReviewsMap(map);
    });
  }, [store?.id, items.length]);

  const openReviewModal = useCallback((item) => {
    setReviewModal({ item });
    setReviewRating(0);
    setReviewName('');
    setReviewDone(false);
  }, []);

  const handleSubmitReview = useCallback(async () => {
    if (!reviewRating || !reviewModal?.item || !store?.id) return;
    setReviewSubmitting(true);
    const { ok } = await submitProductReview(supabase, {
      storeId: store.id,
      productId: reviewModal.item.id,
      rating: reviewRating,
      reviewerName: reviewName,
    });
    if (ok) {
      // تحديث المجمَّع محلياً فوراً
      setReviewsMap((prev) => {
        const pid = reviewModal.item.id;
        const old = prev[pid] || { avg: 0, count: 0 };
        const newCount = old.count + 1;
        const newAvg = Math.round(((old.avg * old.count + reviewRating) / newCount) * 10) / 10;
        return { ...prev, [pid]: { avg: newAvg, count: newCount } };
      });
      setReviewDone(true);
    }
    setReviewSubmitting(false);
  }, [reviewRating, reviewModal, store?.id, reviewName]);

  const fetchItems = useCallback(
    async (reset = false) => {
      if (storeLoading) return;
      if (!store?.id) {
        setLoading(false);
        setLoadingMore(false);
        return;
      }
      const from = reset ? 0 : page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      if (reset) setLoading(true);
      else setLoadingMore(true);
      try {
        const { data, error } = await runProductsSelectWithFallback((sel) =>
          supabase
            .from(PRODUCTS_TABLE)
            .select(sel)
            .eq('store_id', store.id)
            .gt(PRODUCTS_STOCK_COLUMN, 0)
            .order('brand_group', { ascending: true })
            .order('eng_name', { ascending: true })
            .range(from, to)
        );
        if (error) throw error;
        const normalized = (data || []).map(normalizeItemFromSupabase).filter(Boolean);
        if (reset) {
          setItems(normalized);
          setPage(0);
        } else {
          setItems((prev) => [...prev, ...normalized]);
        }
        setHasMore((data?.length || 0) === PAGE_SIZE);
      } catch (err) {
        console.error(err);
        setItems([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [page, store?.id, storeLoading]
  );

  useEffect(() => {
    if (storeLoading) return;
    if (!store?.id) {
      setItems([]);
      setLoading(false);
      return;
    }
    setPage(0);
    fetchItems(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- إعادة تحميل عند المتجر فقط؛ fetchItems يعتمد على page
  }, [store?.id, storeLoading]);

  useEffect(() => {
    if (page > 0) fetchItems(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const fetchDirectoryCustomers = useCallback(async () => {
    if (!store?.id) {
      setDirectoryCustomers([]);
      return;
    }
    let { data, error } = await supabase
      .from('store_contacts')
      .select(
        'id, name, phone, email, address, payment_type, outstanding_amount, credit_limit, loyalty_points'
      )
      .eq('store_id', store.id)
      .eq('role', 'customer')
      .order('name');
    if (error && /credit_limit|column|schema|PGRST204|loyalty_points|address/i.test(String(error.message || ''))) {
      ({ data, error } = await supabase
        .from('store_contacts')
        .select('id, name, phone, email, payment_type, outstanding_amount, credit_limit, loyalty_points')
        .eq('store_id', store.id)
        .eq('role', 'customer')
        .order('name'));
    }
    if (error && /credit_limit|column|schema|PGRST204|loyalty_points/i.test(String(error.message || ''))) {
      ({ data, error } = await supabase
        .from('store_contacts')
        .select('id, name, phone, email, payment_type, outstanding_amount, credit_limit')
        .eq('store_id', store.id)
        .eq('role', 'customer')
        .order('name'));
    }
    if (error && /credit_limit|column|schema|PGRST204/i.test(String(error.message || ''))) {
      ({ data, error } = await supabase
        .from('store_contacts')
        .select('id, name, phone, email, payment_type, outstanding_amount')
        .eq('store_id', store.id)
        .eq('role', 'customer')
        .order('name'));
    }
    if (!error) setDirectoryCustomers(data || []);
  }, [store?.id]);

  useEffect(() => {
    fetchDirectoryCustomers();
  }, [fetchDirectoryCustomers]);

  useEffect(() => {
    if (!posFiltersSheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [posFiltersSheetOpen]);

  /** تركيز حقل الباركود عند استخدام قارئ يعمل كلوحة مفاتيح (وضع «قارئ» في إعدادات النظام) */
  useEffect(() => {
    if (!store?.id || !barcodeScannerMode) return;
    const t = setTimeout(() => barcodeInputRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, [store?.id, barcodeScannerMode]);

  useEffect(() => {
    if (!store?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from(STORE_PROMOTIONS_TABLE)
        .select('id, name_ar, active, sort_order, kind, config')
        .eq('store_id', store.id)
        .eq('active', true)
        .order('sort_order', { ascending: true });
      if (cancelled) return;
      if (!error && data) setPromotions(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [store?.id]);

  /** تجميع مبيعات حسب الصنف لاختصار «الأكثر مبيعاً» (آخر فواتير) */
  useEffect(() => {
    if (!store?.id || storeLoading) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('sales')
          .select('line_items')
          .eq('store_id', store.id)
          .order('created_at', { ascending: false })
          .limit(1200);
        if (cancelled || error) {
          if (error) console.warn('[POS] aggregate sales:', error.message);
          return;
        }
        setSalesQtyMap(aggregateSalesQtyByProduct(data || []));
      } catch (e) {
        console.warn(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store?.id, storeLoading, salesMapVersion]);

  useEffect(() => {
    if (!store?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { settings, missingTable } = await fetchLoyaltySettings(store.id);
        if (cancelled) return;
        setStoreLoyaltySettings(settings);
        setLoyaltyMissingTable(!!missingTable);
      } catch (e) {
        console.warn('[POS] loyalty settings', e);
        if (!cancelled) {
          setStoreLoyaltySettings(DEFAULT_LOYALTY_SETTINGS);
          setLoyaltyMissingTable(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store?.id]);

  useEffect(() => {
    setLoyaltyPointsInput('');
  }, [orderCustomer.contactId]);

  useEffect(() => {
    const el = loadMoreRef.current;
    const root = scrollContainerRef.current;
    if (!el || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setPage((p) => p + 1);
      },
      { root: root || null, rootMargin: '200px', threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, items.length]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search.trim()), 110);
    return () => window.clearTimeout(id);
  }, [search]);

  const searchedItems = useMemo(() => {
    const q = debouncedSearch;
    if (!q) return items;
    return items.filter((i) => productMatchesPosSearch(i, q));
  }, [items, debouncedSearch]);

  /** تطبيق الفلاتر على نتيجة البحث فقط — تفاعل AND (مثلاً Samsung + "65" → سامسونج التي اسمها يحتوي 65) */
  const filteredItems = useMemo(
    () =>
      applyAdvancedProductFilters(searchedItems, {
        categories: posFilterCategories,
        brands: posFilterBrands,
        productTypes: posFilterProductTypes,
        colors: [],
      }),
    [searchedItems, posFilterCategories, posFilterBrands, posFilterProductTypes]
  );

  /** معرّفات المنتجات المشاركة في عروض bundle_pair (اختصار العروض) */
  const promotionProductIdSet = useMemo(() => {
    const s = new Set();
    for (const p of promotions || []) {
      if (!p || p.active === false || p.kind !== 'bundle_pair') continue;
      const cfg = p.config && typeof p.config === 'object' ? p.config : {};
      const tid = normPromotionId(cfg.trigger_product_id);
      const rid = normPromotionId(cfg.reward_product_id);
      if (tid) s.add(tid);
      if (rid) s.add(rid);
    }
    return s;
  }, [promotions]);

  const posSalesQtyFor = useCallback(
    (i) => {
      const a = salesQtyMap.get(String(i.id)) || 0;
      const b = i.barcode ? salesQtyMap.get(`b:${i.barcode}`) || 0 : 0;
      return Math.max(a, b);
    },
    [salesQtyMap]
  );

  const posDisplayItems = useMemo(() => {
    if (posShortcutFilter === 'top_sellers') {
      return [...filteredItems].sort((a, b) => posSalesQtyFor(b) - posSalesQtyFor(a));
    }
    if (posShortcutFilter === 'promo_products') {
      return filteredItems.filter((i) => {
        const id = String(i.id);
        if (promotionProductIdSet.has(id)) return true;
        const bc = i.barcode != null ? String(i.barcode).trim() : '';
        return bc && promotionProductIdSet.has(bc);
      });
    }
    return filteredItems;
  }, [filteredItems, posShortcutFilter, posSalesQtyFor, promotionProductIdSet]);

  const posBrandOptions = useMemo(() => {
    const uniq = [...new Set(items.map((i) => i.group).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b), 'ar')
    );
    const fromData = uniq.map((g) => ({ value: g, label: g }));
    return fromData.length > 0 ? fromData : STATIC_POS_BRAND_OPTIONS;
  }, [items]);

  const posProductTypeOptions = useMemo(
    () => PRODUCT_TYPE_SLUGS.map((value) => ({ value, label: PRODUCT_TYPE_LABEL_AR[value] })),
    []
  );

  /** القوائم الثابتة تُعرض فقط عند غياب بيانات حقيقية من Supabase */
  const posFiltersStaticFallback = useMemo(() => {
    const hasBrandFromDb = items.some((i) => String(i.group || '').trim());
    return { brands: !hasBrandFromDb };
  }, [items]);

  const posFiltersStaticHint = posFiltersStaticFallback.brands
    ? 'عيّن المجموعة (brand_group) في المنتجات لربط فلتر العلامة ببياناتك.'
    : null;

  const posFacetCounts = useMemo(
    () =>
      computeFacetCounts(searchedItems, {
        categories: posFilterCategories,
        brands: posFilterBrands,
        productTypes: posFilterProductTypes,
        colors: [],
      }),
    [searchedItems, posFilterCategories, posFilterBrands, posFilterProductTypes]
  );

  /** بحث أو أي فلتر — يفعّل زر إعادة التعيين ويُحسب في شارة الموبايل */
  const posActiveConstraintCount =
    posFilterCategories.length +
    posFilterBrands.length +
    posFilterProductTypes.length +
    (search.trim() ? 1 : 0) +
    (posShortcutFilter !== 'none' ? 1 : 0);
  const hasPosSearchOrFilters = posActiveConstraintCount > 0;

  const resetPosFilters = useCallback(() => {
    setPosFilterCategories([]);
    setPosFilterBrands([]);
    setPosFilterProductTypes([]);
    setSearch('');
    setPosShortcutFilter('none');
  }, []);

  const togglePosCategory = useCallback((slug) => {
    setPosFilterCategories((prev) =>
      prev.includes(slug) ? prev.filter((x) => x !== slug) : [...prev, slug]
    );
  }, []);
  const togglePosBrand = useCallback((val) => {
    setPosFilterBrands((prev) =>
      prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]
    );
  }, []);
  const togglePosProductType = useCallback((val) => {
    setPosFilterProductTypes((prev) =>
      prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]
    );
  }, []);

  /**
   * POS: أول ضغطة تضيف سطراً بكمية 1؛ الضغطات التالية على نفس المنتج تزيد الكمية.
   * يُحترم سقف المخزون المتاح.
   */
  const addToOrder = useCallback((item, qtyDelta = 1) => {
    setOrderItems((prev) => {
      const unitPrice = roundMoney(item.price ?? item.priceAfterDiscount ?? 0);
      const box = item.box != null && String(item.box).trim() ? String(item.box).trim() : null;
      const stock = Number(item.stock ?? 0);
      const idx = prev.findIndex((x) => x.id === item.id);
      if (idx >= 0) {
        const next = [...prev];
        const nextQty = next[idx].qty + qtyDelta;
        if (stock > 0 && nextQty > stock) {
          toast.warning(
            `لا يمكن إضافة أكثر من ${stock} ${stock === 1 ? 'قطعة' : 'قطع'} (المخزون الحالي).`
          );
          return prev;
        }
        next[idx] = { ...next[idx], qty: nextQty };
        return next;
      }
      const firstQty = Math.max(1, qtyDelta);
      if (stock > 0 && firstQty > stock) {
        toast.warning(
          `لا يمكن إضافة أكثر من ${stock} ${stock === 1 ? 'قطعة' : 'قطع'} (المخزون الحالي).`
        );
        return prev;
      }
      return [
        ...prev,
        {
          id: item.id,
          qty: firstQty,
          unitPrice,
          box,
          item,
          serial: '',
          manualPriceOverride: false,
        },
      ];
    });
  }, [toast]);

  /** إضافة قطعة واحدة — مرجع ثابت لـ memo على ProductCard */
  const posAddOneToCart = useCallback((item) => addToOrder(item, 1), [addToOrder]);

  const removeFromOrder = (itemId) =>
    setOrderItems((prev) => prev.filter((x) => x.id !== itemId));

  const updateLineSerial = (lineId, serial) => {
    setOrderItems((prev) =>
      prev.map((row) => (row.id === lineId ? { ...row, serial } : row))
    );
  };

  /** تعديل سعر بيع الوحدة يدوياً — يتجاوز أسعار العروض التلقائية بعد التعديل */
  const updateLineUnitPrice = (itemId, value) => {
    const n = parseFloat(normalizePriceInput(value).replace(',', '.')) || 0;
    const idStr = String(itemId);
    setOrderItems((prev) =>
      prev.map((x) =>
        String(x.id) === idStr
          ? { ...x, unitPrice: roundMoney(Math.max(0, n)), manualPriceOverride: true }
          : x
      )
    );
  };

  const updateQuantity = (id, amount) => {
    setOrderItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, qty: Math.max(1, (item.qty || 1) + amount) } : item
      )
    );
  };

  const increaseQuantity = (o) => {
    const stock = Number(o.item?.stock ?? 0);
    if (stock > 0 && (o.qty || 1) >= stock) {
      toast.warning(`عذراً، لا يوجد سوى ${stock} ${stock === 1 ? 'قطعة' : 'قطع'} في المخزن!`);
      return;
    }
    updateQuantity(o.id, +1);
  };

  const orderLines = orderItems
    .map((o) => ({
      ...o,
      item: items.find((i) => i.id === o.id) || items.find((i) => i.barcode === o.id),
    }))
    .filter((o) => o.item);

  const posCartQtyById = useMemo(() => {
    const map = new Map();
    for (const line of orderLines) {
      map.set(String(line.id), Math.max(1, Number(line.qty) || 1));
    }
    return map;
  }, [orderLines]);

  useEffect(() => {
    if (orderLines.length === 0) {
      setPosCheckoutOpen(false);
      setPosCartFullOpen(false);
    }
  }, [orderLines.length]);

  useEffect(() => {
    const lock = posCheckoutOpen || posCartFullOpen;
    if (!lock) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [posCheckoutOpen, posCartFullOpen]);

  useEffect(() => {
    const shortcutRoutes = { p: '/pos', i: '/inventory', s: '/sales', h: '/overview' };
    const onKeyDown = (e) => {
      const key = e.key.toLowerCase();
      if (key === 'escape') {
        setPosCheckoutOpen(false);
        setPosCartFullOpen(false);
      }
      if (key === 'f2') {
        e.preventDefault();
        barcodeInputRef.current?.focus();
      }
      if (key === 'f4' && orderLines.length > 0) {
        e.preventDefault();
        setPosCheckoutOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [orderLines.length]);

  const promotionResult = useMemo(
    () => evaluatePromotions(orderLines, promotions),
    [orderLines, promotions]
  );

  const promoSuggestions = useMemo(
    () => getPromotionSuggestions(orderLines, promotions, items),
    [orderLines, promotions, items]
  );

  const getLineUnitPrice = (o) => {
    const catalog = roundMoney(o.item?.price ?? o.item?.priceAfterDiscount ?? 0);
    const fallback = o.unitPrice ?? catalog;
    if (o.manualPriceOverride) return roundMoney(o.unitPrice ?? catalog);
    return effectiveUnitForLine(o.id, promotionResult, fallback);
  };
  const getLineOriginalPrice = (o) => Number(o.item?.price) ?? 0;
  const getLineTotal = (o) => Math.max(0, getLineUnitPrice(o) * (o.qty || 0));

  const cartTotals = useMemo(() => {
    const subtotal = orderLines.reduce(
      (acc, o) => acc + getLineOriginalPrice(o) * (o.qty || 1),
      0
    );
    const finalTotal = orderLines.reduce((acc, o) => acc + getLineTotal(o), 0);
    const totalDiscount = Math.max(0, subtotal - finalTotal);
    return { subtotal, totalDiscount, finalTotal };
  }, [orderLines, promotionResult]);

  /** عدد أسطر السلة وإجمالي القطع — للعرض في الرأس وعرض السلة الكامل */
  const posCartQtyStats = useMemo(() => {
    const lineCount = orderLines.length;
    const unitCount = orderLines.reduce((s, o) => s + Math.max(1, Number(o.qty) || 1), 0);
    return { lineCount, unitCount };
  }, [orderLines]);

  const loyaltyEarnDivisor = (storeLoyaltySettings ?? DEFAULT_LOYALTY_SETTINGS).earn_shekel_per_point;
  const loyaltyRedeemRate = (storeLoyaltySettings ?? DEFAULT_LOYALTY_SETTINGS).redeem_shekel_per_point;

  const loyaltyDerived = useMemo(() => {
    const contact = orderCustomer.contactId
      ? directoryCustomers.find((x) => x.id === orderCustomer.contactId)
      : null;
    const balance = Number(contact?.loyalty_points ?? 0);
    const parsed = parseFloat(String(loyaltyPointsInput).replace(',', '.')) || 0;
    if (!orderCustomer.contactId || contact == null) {
      return {
        payable: cartTotals.finalTotal,
        discountShekel: 0,
        effectivePoints: 0,
        earnPointsPreview: 0,
        balance: 0,
        maxRedeemPoints: 0,
      };
    }
    const { effectivePoints, discountShekel, payable } = computeEffectiveRedemption({
      pointsRequested: parsed,
      balance,
      cartFinalTotal: cartTotals.finalTotal,
      redeemShekelPerPoint: loyaltyRedeemRate,
    });
    const earnPointsPreview = computeEarnedPoints(payable, loyaltyEarnDivisor);
    const r = Math.max(0.0001, Number(loyaltyRedeemRate) || 1);
    const maxByCart = Math.floor(Math.max(0, cartTotals.finalTotal) / r + 1e-9);
    const maxRedeemPoints = Math.min(Math.floor(balance + 1e-9), maxByCart);
    return {
      payable,
      discountShekel,
      effectivePoints,
      earnPointsPreview,
      balance,
      maxRedeemPoints,
    };
  }, [
    orderCustomer.contactId,
    directoryCustomers,
    loyaltyPointsInput,
    cartTotals.finalTotal,
    loyaltyEarnDivisor,
    loyaltyRedeemRate,
  ]);

  const creditLimitBlocked = useMemo(() => {
    if (orderCustomer.salePaymentMode !== 'credit' || !orderCustomer.contactId) return false;
    const c = directoryCustomers.find((x) => x.id === orderCustomer.contactId);
    if (!c) return false;
    return isCreditLimitExceeded(c.outstanding_amount, c.credit_limit, loyaltyDerived.payable);
  }, [
    orderCustomer.salePaymentMode,
    orderCustomer.contactId,
    directoryCustomers,
    loyaltyDerived.payable,
  ]);

  const manualDiscount = roundMoney(Math.min(orderCustomer.manualDiscount ?? 0, cartTotals.finalTotal));
  const invoicePayable = roundMoney(Math.max(0, loyaltyDerived.payable - manualDiscount));

  const getImage = (item) => getPublicImageUrl(item?.image);

  const handlePrintOrder = useCallback(() => {
    if (!orderLines.length) return;
    const lines = orderLines.map((o) => ({
      name: o.item?.name,
      barcode: o.item?.barcode,
      qty: o.qty,
      unitPrice: getLineUnitPrice(o),
      lineTotal: getLineTotal(o),
      originalPrice: getLineOriginalPrice(o),
      discountPercent: getLineOriginalPrice(o) > 0 && getLineUnitPrice(o) < getLineOriginalPrice(o)
        ? Math.round(((getLineOriginalPrice(o) - getLineUnitPrice(o)) / getLineOriginalPrice(o)) * 100)
        : 0,
      imageUrl: getImage(o.item),
      serial: serialForPrint(o.serial),
    }));
    const manualDiscount = roundMoney(Math.min(orderCustomer.manualDiscount ?? 0, cartTotals.finalTotal));
    setPrintInvoiceData({
      storeName: store?.name,
      customerName: orderCustomer.name,
      customerPhone: orderCustomer.phone,
      customerEmail: orderCustomer.email,
      customerAddress: orderCustomer.address?.trim() || undefined,
      customerNotes: orderCustomer.notes,
      posTenderLabel: POS_TENDER_AR[orderCustomer.posTender] || POS_TENDER_AR.cash,
      checkDetailsLines: buildCheckLinesForPrint(orderCustomer),
      visaLast4: orderCustomer.posTender === 'visa' ? orderCustomer.visaLast4 : undefined,
      posWalletLabel:
        orderCustomer.posTender === 'digital_wallet' && String(orderCustomer.walletLabel || '').trim()
          ? String(orderCustomer.walletLabel).trim()
          : undefined,
      pickupDateLabel: orderCustomer.pickupDate?.trim() || undefined,
      pickupLocationLabel:
        orderCustomer.pickupLocation === 'showroom' || orderCustomer.pickupLocation === 'warehouse'
          ? PICKUP_LOC_AR[orderCustomer.pickupLocation]
          : undefined,
      lines,
      subtotal: cartTotals.subtotal,
      manualDiscount,
      totalDiscount: cartTotals.totalDiscount + (loyaltyDerived.discountShekel > 0 ? loyaltyDerived.discountShekel : 0) + manualDiscount,
      finalTotal: roundMoney(loyaltyDerived.payable - manualDiscount),
      loyaltyDiscount: loyaltyDerived.discountShekel > 0 ? loyaltyDerived.discountShekel : undefined,
      printedAtLabel: new Date().toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    });
  }, [orderLines, orderCustomer, store?.name, cartTotals, loyaltyDerived]);

  const openFullPrintFromSnapshot = useCallback(
    (snap) => {
      if (!snap?.orderLines?.length) return;
      const getUP = (o) =>
        o.unitPrice ?? roundMoney(o.item?.priceAfterDiscount ?? o.item?.price ?? 0);
      const getLT = (o) => Math.max(0, getUP(o) * (o.qty || 0));
      const getOP = (o) => Number(o.item?.price) ?? 0;
      const lines = snap.orderLines.map((o) => ({
        name: o.item?.name,
        barcode: o.item?.barcode,
        qty: o.qty,
        unitPrice: getUP(o),
        lineTotal: getLT(o),
        originalPrice: getOP(o),
        discountPercent:
          getOP(o) > 0 && getUP(o) < getOP(o)
            ? Math.round(((getOP(o) - getUP(o)) / getOP(o)) * 100)
            : 0,
        imageUrl: getPublicImageUrl(o.item?.image),
        serial: serialForPrint(o.serial),
      }));
      const oc = snap.orderCustomer;
      const ct = snap.cartTotals;
      const loyaltyDisc = Number(ct.loyaltyDiscount ?? 0);
      const payable = ct.payableTotal != null ? ct.payableTotal : ct.finalTotal;
      setPrintInvoiceData({
        storeName: store?.name,
        customerName: oc.name,
        customerPhone: oc.phone,
        customerEmail: oc.email,
        customerAddress: oc.address?.trim() || undefined,
        customerNotes: oc.notes,
        posTenderLabel: POS_TENDER_AR[oc.posTender] || POS_TENDER_AR.cash,
        checkDetailsLines: buildCheckLinesForPrint(oc),
        visaLast4: oc.posTender === 'visa' ? oc.visaLast4 : undefined,
        posWalletLabel:
          oc.posTender === 'digital_wallet' && String(oc.walletLabel || '').trim()
            ? String(oc.walletLabel).trim()
            : undefined,
        pickupDateLabel: oc.pickupDate?.trim() || undefined,
        pickupLocationLabel:
          oc.pickupLocation === 'showroom' || oc.pickupLocation === 'warehouse'
            ? PICKUP_LOC_AR[oc.pickupLocation]
            : undefined,
        lines,
        subtotal: ct.subtotal,
        totalDiscount: ct.totalDiscount + (loyaltyDisc > 0 ? loyaltyDisc : 0),
        finalTotal: payable,
        loyaltyDiscount: loyaltyDisc > 0 ? loyaltyDisc : undefined,
        printedAtLabel: new Date().toLocaleString('en-GB', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
      });
    },
    [store?.name]
  );

  useEffect(() => {
    if (!successToast) return;
    const timer = setTimeout(() => setSuccessToast(null), 14000);
    return () => clearTimeout(timer);
  }, [successToast]);

  useEffect(() => {
    const printing = printInvoiceData || simpleReceiptPrint;
    if (!printing) return;
    document.body.classList.add('print-invoice-active');
    const t = requestAnimationFrame(() => window.print());
    const onAfterPrint = () => {
      document.body.classList.remove('print-invoice-active');
      setPrintInvoiceData(null);
      setSimpleReceiptPrint(null);
    };
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener('afterprint', onAfterPrint);
      document.body.classList.remove('print-invoice-active');
    };
  }, [printInvoiceData, simpleReceiptPrint]);

  const clearOrder = () => {
    setOrderItems([]);
    setLoyaltyPointsInput('');
  };

  /** مسح الباركود: البحث في القائمة ثم جلب من الخادم إن لزم (كمية > 0 فقط في الاستعلام). */
  const tryAddProductByBarcode = useCallback(
    async (raw) => {
      const norm = normalizeDigitsToLatin(String(raw).trim());
      if (!norm) return false;

      let hit =
        items.find((i) => String(i.barcode).trim() === norm) ||
        items.find((i) => String(i.barcode).replace(/\s/g, '') === norm.replace(/\s/g, ''));

      if (!hit && store?.id) {
        const { data, error } = await runProductsSelectWithFallback((sel) =>
          supabase
            .from(PRODUCTS_TABLE)
            .select(sel)
            .eq('store_id', store.id)
            .eq('barcode', norm)
            .gt(PRODUCTS_STOCK_COLUMN, 0)
            .maybeSingle()
        );
        if (!error && data) {
          const row = normalizeItemFromSupabase(data);
          if (row) {
            hit = row;
            setItems((prev) => (prev.some((i) => i.id === row.id) ? prev : [row, ...prev]));
          }
        }
      }

      if (hit) {
        addToOrder(hit, 1);
        return true;
      }
      return false;
    },
    [items, store?.id, addToOrder]
  );

  const onBarcodeSubmit = async (e) => {
    e.preventDefault();
    const raw = barcodeInputRef.current?.value?.trim() || '';
    if (!raw) return;
    const ok = await tryAddProductByBarcode(raw);
    if (barcodeInputRef.current) barcodeInputRef.current.value = '';
    if (!ok) {
      toast.error('لم يُعثر على منتج بهذا الباركود أو الكمية غير متوفرة.');
    }
  };

  /** بحث: إن كان النص باركوداً رقمياً وضغط Enter نضيف للسلة (يُكمّل حقل المسح). */
  const onSearchKeyDown = async (e) => {
    if (e.key !== 'Enter') return;
    const q = search.trim();
    if (!q) return;
    if (!/^\d[\d\s]*$/.test(normalizeDigitsToLatin(q))) return;
    e.preventDefault();
    const ok = await tryAddProductByBarcode(q);
    if (ok) setSearch('');
  };

  const onPickDirectoryCustomer = (id) => {
    if (!id) {
      setOrderCustomer((p) => ({ ...p, contactId: null }));
      return;
    }
    const c = directoryCustomers.find((x) => x.id === id);
    if (!c) {
      setOrderCustomer((p) => ({ ...p, contactId: null }));
      return;
    }
    setOrderCustomer((p) => ({
      ...p,
      contactId: c.id,
      name: c.name || '',
      phone: normalizeDigitsToLatin(c.phone || ''),
      email: c.email || '',
      address: c.address?.trim() ? String(c.address).trim() : '',
    }));
  };

  const openNewCustomerModal = () => {
    setNewCustomerForm({ name: '', phone: '' });
    setNewCustomerError(null);
    setNewCustomerModalOpen(true);
  };

  const handleSaveNewCustomer = async (e) => {
    e.preventDefault();
    if (!store?.id) return;
    const name = newCustomerForm.name.trim();
    if (!name) {
      setNewCustomerError('يرجى إدخال اسم الزبون');
      return;
    }
    const phone = normalizeDigitsToLatin(newCustomerForm.phone.trim());
    setNewCustomerSaving(true);
    setNewCustomerError(null);
    try {
      const fullRow = {
        store_id: store.id,
        role: 'customer',
        name,
        phone,
        email: '',
        address: '',
        notes: '',
        payment_type: 'credit',
        outstanding_amount: 0,
      };
      let { data, error } = await supabase
        .from('store_contacts')
        .insert([fullRow])
        .select('id, name, phone, email, payment_type, outstanding_amount')
        .maybeSingle();
      if (error && /payment_type|outstanding_amount|column/i.test(String(error.message || ''))) {
        const r2 = await supabase
          .from('store_contacts')
          .insert([
            {
              store_id: store.id,
              role: 'customer',
              name,
              phone,
              email: '',
              address: '',
              notes: '',
            },
          ])
          .select('id, name, phone, email')
          .maybeSingle();
        data = r2.data;
        error = r2.error;
      }
      if (error) throw error;
      if (!data?.id) throw new Error('لم يُرجع الخادم معرف الزبون');

      await fetchDirectoryCustomers();
      setOrderCustomer((p) => ({
        ...p,
        salePaymentMode: 'credit',
        contactId: data.id,
        name: data.name || '',
        phone: normalizeDigitsToLatin(data.phone || ''),
        email: data.email || '',
      }));
      setNewCustomerModalOpen(false);
      setNewCustomerForm({ name: '', phone: '' });
    } catch (err) {
      console.error(err);
      setNewCustomerError(err.message || 'فشل حفظ الزبون');
    } finally {
      setNewCustomerSaving(false);
    }
  };

  const handleCheckout = async () => {
    if (!store?.id || orderLines.length === 0) return;
    setCheckoutLoading(true);
    setCheckoutError(null);

    if (orderCustomer.salePaymentMode === 'credit' && !orderCustomer.contactId) {
      setCheckoutError('للبيع بالذمة يجب اختيار زبون من الدليل.');
      setCheckoutLoading(false);
      return;
    }

    if (orderCustomer.posTender === 'check') {
      const n = Math.max(
        1,
        Math.min(50, Number.parseInt(String(orderCustomer.checkCount ?? 1), 10) || 1)
      );
      const dates = orderCustomer.checkDates || [];
      if (dates.length !== n) {
        setCheckoutError('عدد تواريخ الشيكات يجب أن يطابق عدد الشيكات.');
        setCheckoutLoading(false);
        return;
      }
      for (let i = 0; i < n; i += 1) {
        if (!String(dates[i] || '').trim()) {
          setCheckoutError(`يرجى تعبئة تاريخ الشيك رقم ${i + 1}.`);
          setCheckoutLoading(false);
          return;
        }
      }
    }

    if (orderCustomer.posTender === 'visa') {
      const v4 = normalizeDigitsToLatin(orderCustomer.visaLast4 || '').replace(/\D/g, '');
      if (v4.length !== 4) {
        setCheckoutError('عند الدفع الإلكتروني بالبطاقة يجب إدخال آخر 4 أرقام من البطاقة.');
        setCheckoutLoading(false);
        return;
      }
    }

    try {
      const loyaltyPointsParsed = Math.floor(
        Math.max(0, parseFloat(String(loyaltyPointsInput).replace(',', '.')) || 0)
      );
      if (loyaltyPointsParsed > 0 && !orderCustomer.contactId) {
        setCheckoutError('لاستبدال النقاط اختر زبوناً من الدليل (ربط كاش أو ذمة).');
        setCheckoutLoading(false);
        return;
      }

      let payableAmount = cartTotals.finalTotal;
      let redeemPts = 0;
      let discountShekel = 0;
      let earnPts = 0;
      const settings = storeLoyaltySettings ?? DEFAULT_LOYALTY_SETTINGS;

      if (orderCustomer.contactId) {
        let { data: cLoyal, error: cLoyalErr } = await supabase
          .from('store_contacts')
          .select('loyalty_points, role')
          .eq('id', orderCustomer.contactId)
          .eq('store_id', store.id)
          .maybeSingle();
        if (cLoyalErr && /loyalty_points|column|schema|PGRST204/i.test(String(cLoyalErr.message || ''))) {
          const r2 = await supabase
            .from('store_contacts')
            .select('role')
            .eq('id', orderCustomer.contactId)
            .eq('store_id', store.id)
            .maybeSingle();
          cLoyal = r2.data ? { ...r2.data, loyalty_points: 0 } : null;
          cLoyalErr = r2.error;
        }
        if (cLoyalErr) throw cLoyalErr;
        if (cLoyal?.role === 'customer') {
          const bal = Number(cLoyal?.loyalty_points ?? 0);
          const red = computeEffectiveRedemption({
            pointsRequested: loyaltyPointsParsed,
            balance: bal,
            cartFinalTotal: cartTotals.finalTotal,
            redeemShekelPerPoint: settings.redeem_shekel_per_point,
          });
          redeemPts = red.effectivePoints;
          discountShekel = red.discountShekel;
          payableAmount = red.payable;
          earnPts = computeEarnedPoints(payableAmount, settings.earn_shekel_per_point);
        }
      }

      if (orderCustomer.salePaymentMode === 'credit' && orderCustomer.contactId) {
        const v = await verifyCreditLimitAllowsSale(supabase, {
          storeId: store.id,
          contactId: orderCustomer.contactId,
          saleTotal: payableAmount,
        });
        if (!v.allowed) {
          setCheckoutError(v.message);
          setCheckoutLoading(false);
          return;
        }
      }

      const serialNoteLines = orderLines
        .map((o) => {
          const s = trimSerial(o.serial);
          if (!s) return null;
          return `سيريال — ${o.item?.name || 'صنف'}: ${s.replace(/\n/g, ' | ')}`;
        })
        .filter(Boolean);

      const addrTrim = orderCustomer.address?.trim() || '';
      const tenderKey = POS_TENDER_KEYS.includes(orderCustomer.posTender)
        ? orderCustomer.posTender
        : 'cash';
      const walletTrim =
        tenderKey === 'digital_wallet' ? String(orderCustomer.walletLabel || '').trim() : '';
      const pickupD = orderCustomer.pickupDate?.trim() || '';
      const pickupLoc = orderCustomer.pickupLocation === 'warehouse' ? 'warehouse' : orderCustomer.pickupLocation === 'showroom' ? 'showroom' : '';
      const checkCountNum =
        tenderKey === 'check'
          ? Math.max(1, Math.min(50, Number.parseInt(String(orderCustomer.checkCount ?? 1), 10) || 1))
          : 0;
      const checkDatesArr =
        tenderKey === 'check'
          ? (orderCustomer.checkDates || []).slice(0, checkCountNum).map((d) => String(d || '').trim())
          : [];
      const visa4Norm =
        tenderKey === 'visa'
          ? normalizeDigitsToLatin(orderCustomer.visaLast4 || '').replace(/\D/g, '').slice(0, 4)
          : '';
      const detailLines = [
        `الزبون: ${orderCustomer.name.trim()}`,
        `الهاتف: ${normalizeDigitsToLatin(orderCustomer.phone.trim())}`,
        orderCustomer.email?.trim() && `البريد: ${orderCustomer.email.trim()}`,
        addrTrim && `العنوان: ${addrTrim}`,
        orderCustomer.notes?.trim() && `ملاحظات: ${orderCustomer.notes.trim()}`,
        `الدفع: ${orderCustomer.salePaymentMode === 'credit' ? 'ذمة (دين)' : 'كاش'}`,
        `طريقة التحصيل: ${POS_TENDER_AR[tenderKey] || POS_TENDER_AR.cash}`,
        ...(tenderKey === 'check'
          ? [
              `عدد الشيكات: ${checkCountNum}`,
              ...checkDatesArr.map((d, i) => `شيك ${i + 1} — تاريخ الاستحقاق: ${d}`),
            ]
          : []),
        ...(tenderKey === 'visa' && visa4Norm.length === 4
          ? [`بطاقة / دفع إلكتروني — آخر 4 أرقام: ${visa4Norm}`]
          : []),
        ...(tenderKey === 'digital_wallet' && walletTrim ? [`محفظة رقمية: ${walletTrim}`] : []),
        pickupD && `تاريخ الاستلام المتوقع: ${pickupD}`,
        pickupLoc && `الاستلام من: ${PICKUP_LOC_AR[pickupLoc]}`,
        orderCustomer.contactId && 'الزبون مرتبط بدليل المتجر',
        `عدد الأصناف: ${orderLines.length}`,
        `إجمالي قبل الخصم: ${cartTotals.subtotal.toFixed(2)} | الخصم: ${cartTotals.totalDiscount.toFixed(2)}`,
        cartTotals.totalDiscount > 0.01 && 'تطبيق عروض تلقائية من محرك العروض',
        redeemPts > 0 &&
          `استبدال نقاط ولاء: ${redeemPts} نقطة → خصم ${discountShekel.toFixed(2)} ₪`,
        earnPts > 0 && `نقاط تُضاف بعد البيع: ${earnPts}`,
        ...serialNoteLines,
      ].filter(Boolean);
      const saleNotes = detailLines.join('\n');

      const saleLineItems = orderLines.map((o) => {
        const item = o.item;
        const uuidFromProduct = item && isUuid(item.id) ? String(item.id) : null;
        const barcodeStr = String(
          item?.barcode ?? (!uuidFromProduct && o.id != null ? o.id : '') ?? ''
        );
        const unit = getLineUnitPrice(o);
        const q = Math.max(1, Number(o.qty) || 1);
        const serialSnap = trimSerial(o.serial);
        return {
          product_id: uuidFromProduct,
          barcode: barcodeStr,
          qty: q,
          unit_price: unit,
          line_total: Math.max(0, unit * q),
          serial_numbers: serialSnap || null,
        };
      });

      const base = { store_id: store.id, total_amount: payableAmount };
      const contactId = orderCustomer.contactId || null;
      const paymentMode = orderCustomer.salePaymentMode === 'credit' ? 'credit' : 'cash';
      const posExtras = {
        customer_address: addrTrim || null,
        pos_tender: tenderKey,
        pickup_expected_date: pickupD || null,
        pickup_location: pickupLoc || null,
        pos_check_count: tenderKey === 'check' ? checkCountNum : null,
        pos_check_dates: tenderKey === 'check' ? checkDatesArr : null,
        pos_visa_last4: tenderKey === 'visa' && visa4Norm.length === 4 ? visa4Norm : null,
      };
      const saleVariants = [
        {
          ...base,
          notes: saleNotes,
          line_items: saleLineItems,
          contact_id: contactId,
          payment_mode: paymentMode,
          ...posExtras,
        },
        {
          ...base,
          notes: saleNotes,
          line_items: saleLineItems,
          contact_id: contactId,
          payment_mode: paymentMode,
        },
        { ...base, notes: saleNotes, line_items: saleLineItems },
        { ...base, notes: saleNotes },
        { ...base },
      ];
      let saleId = null;
      let saleError = null;
      for (const row of saleVariants) {
        const { data: saleRow, error } = await supabase
          .from('sales')
          .insert([row])
          .select('id')
          .maybeSingle();
        if (!error && saleRow?.id) {
          saleId = saleRow.id;
          saleError = null;
          break;
        }
        saleError = error;
      }
      if (!saleId) throw saleError || new Error('فشل حفظ الفاتورة في sales');

      if (saleLineItems.length > 0) {
        const itemRows = saleLineItems.map((line) => ({
          sale_id: saleId,
          store_id: store.id,
          product_id: line.product_id || null,
          barcode: String(line.barcode || ''),
          qty: line.qty,
          unit_price: line.unit_price,
          line_total: line.line_total,
          serial_numbers: line.serial_numbers || null,
        }));
        const { error: itemsErr } = await supabase.from('sales_items').insert(itemRows);
        if (itemsErr) {
          console.warn('[POS] sales_items (جدول اختياري):', itemsErr.message);
        }
      }

      for (const o of orderLines) {
        const qty = Math.max(1, Number(o.qty) || 1);
        const rowPk = o.item?.id ?? o.id;
        const byUuid = isUuid(rowPk);
        const barcodeOnly = !byUuid && (o.item?.barcode ?? o.id);
        const itemName = o.item?.name || '';
        let prevStock = 0;
        let newStock = 0;

        if (byUuid) {
          const { data: row0, error: sel0 } = await supabase
            .from(PRODUCTS_TABLE)
            .select(PRODUCTS_STOCK_COLUMN)
            .eq('id', rowPk)
            .single();
          if (sel0) throw sel0;
          prevStock = Number(row0?.[PRODUCTS_STOCK_COLUMN] ?? row0?.stock_count ?? 0);

          const { error: rpcError } = await supabase.rpc('decrement_stock', {
            row_id: rowPk,
            amount: qty,
          });
          if (rpcError) {
            newStock = Math.max(0, prevStock - qty);
            const { error: upErr } = await supabase
              .from(PRODUCTS_TABLE)
              .update({ [PRODUCTS_STOCK_COLUMN]: newStock })
              .eq('id', rowPk);
            if (upErr) throw upErr;
          } else {
            newStock = Math.max(0, prevStock - qty);
          }
        } else {
          const b = String(barcodeOnly);
          const { data: row, error: selErr } = await supabase
            .from(PRODUCTS_TABLE)
            .select(PRODUCTS_STOCK_COLUMN)
            .eq('barcode', b)
            .eq('store_id', store.id)
            .single();
          if (selErr) throw selErr;
          prevStock = Number(row?.[PRODUCTS_STOCK_COLUMN] ?? row?.stock_count ?? 0);
          newStock = Math.max(0, prevStock - qty);
          const { error: upErr } = await supabase
            .from(PRODUCTS_TABLE)
            .update({ [PRODUCTS_STOCK_COLUMN]: newStock })
            .eq('barcode', b)
            .eq('store_id', store.id);
          if (upErr) throw upErr;
        }

        await insertInventoryLog({
          storeId: store.id,
          productId: byUuid ? String(rowPk) : null,
          barcode: o.item?.barcode != null ? String(o.item.barcode) : barcodeOnly ? String(barcodeOnly) : null,
          productName: itemName,
          qtyBefore: prevStock,
          qtyAfter: newStock,
          reason: 'sale',
        });
      }

      if (paymentMode === 'cash') {
        try {
          await applyCashSaleToMainCashFund(supabase, {
            storeId: store.id,
            saleId,
            totalAmount: payableAmount,
            sourceLabel: 'POS',
          });
        } catch (e) {
          console.warn('[POS] ربط صندوق الكاش:', e);
        }
      }

      if (orderCustomer.salePaymentMode === 'credit' && orderCustomer.contactId) {
        const { data: cRow, error: cSelErr } = await supabase
          .from('store_contacts')
          .select('outstanding_amount')
          .eq('id', orderCustomer.contactId)
          .eq('store_id', store.id)
          .eq('role', 'customer')
          .maybeSingle();
        if (cSelErr) throw cSelErr;
        if (!cRow) throw new Error('لم يُعثر على الزبون في الدليل');
        const nextBal =
          Math.max(0, Number(cRow.outstanding_amount ?? 0)) + Number(payableAmount);
        const { error: cUpErr } = await supabase
          .from('store_contacts')
          .update({ outstanding_amount: nextBal, payment_type: 'credit' })
          .eq('id', orderCustomer.contactId)
          .eq('store_id', store.id);
        if (cUpErr) throw cUpErr;

        const amt = Number(payableAmount);
        const { error: ledgerErr } = await supabase.from('customer_ledger').insert([
          {
            store_id: store.id,
            customer_id: orderCustomer.contactId,
            sale_id: saleId,
            debit: amt,
            credit: 0,
            description: `بيع بالذمة — POS — فاتورة ${String(saleId).slice(0, 8)}…`,
          },
        ]);
        if (ledgerErr) {
          console.warn('[POS] customer_ledger (جدول اختياري):', ledgerErr.message);
        }
      }

      if (orderCustomer.contactId && (redeemPts > 0 || earnPts > 0)) {
        const { data: cRow2, error: eBal } = await supabase
          .from('store_contacts')
          .select('loyalty_points')
          .eq('id', orderCustomer.contactId)
          .eq('store_id', store.id)
          .eq('role', 'customer')
          .maybeSingle();
        if (!eBal && cRow2) {
          const startBal = Number(cRow2.loyalty_points ?? 0);
          const nextLoyal = roundMoney(Math.max(0, startBal - redeemPts + earnPts));
          const { error: upL } = await supabase
            .from('store_contacts')
            .update({ loyalty_points: nextLoyal })
            .eq('id', orderCustomer.contactId)
            .eq('store_id', store.id);
          if (upL) {
            console.warn('[POS] loyalty_points update:', upL.message);
          } else {
            const txRows = [];
            if (redeemPts > 0) {
              txRows.push({
                store_id: store.id,
                contact_id: orderCustomer.contactId,
                sale_id: saleId,
                kind: 'redeem',
                points_delta: -redeemPts,
                shekel_amount: discountShekel,
                notes: 'استبدال نقاط — POS',
              });
            }
            if (earnPts > 0) {
              txRows.push({
                store_id: store.id,
                contact_id: orderCustomer.contactId,
                sale_id: saleId,
                kind: 'earn',
                points_delta: earnPts,
                shekel_amount: payableAmount,
                notes: 'شراء — POS',
              });
            }
            if (txRows.length) {
              const { error: txErr } = await supabase.from(LOYALTY_TX_TABLE).insert(txRows);
              if (txErr) console.warn('[POS] loyalty_point_transactions:', txErr.message);
            }
          }
        }
      }

      setSuccessToast({
        message: 'تم حفظ الفاتورة بنجاح.',
        total: payableAmount,
        receiptPayload: {
          storeName: store?.name,
          lines: orderLines.map((o) => ({
            name: o.item?.name,
            qty: o.qty,
            lineTotal: getLineTotal(o),
            serial: serialForPrint(o.serial),
          })),
          total: payableAmount,
          customerName: orderCustomer.name?.trim() || '',
          address: orderCustomer.address?.trim() || undefined,
          tenderLabel: POS_TENDER_AR[orderCustomer.posTender] || POS_TENDER_AR.cash,
          checkLines: buildCheckLinesForPrint(orderCustomer),
          visaLast4: orderCustomer.posTender === 'visa' ? orderCustomer.visaLast4 : undefined,
          walletLabel:
            orderCustomer.posTender === 'digital_wallet' && String(orderCustomer.walletLabel || '').trim()
              ? String(orderCustomer.walletLabel).trim()
              : undefined,
          pickupDate: orderCustomer.pickupDate?.trim() || undefined,
          pickupFromLabel:
            orderCustomer.pickupLocation === 'showroom' || orderCustomer.pickupLocation === 'warehouse'
              ? PICKUP_LOC_AR[orderCustomer.pickupLocation]
              : undefined,
          printedAtLabel: new Date().toLocaleString('en-GB', {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        },
        fullSnapshot: {
          orderLines: orderLines.map((o) => ({ ...o, item: o.item ? { ...o.item } : o.item })),
          orderCustomer: { ...orderCustomer },
          cartTotals: {
            ...cartTotals,
            payableTotal: payableAmount,
            loyaltyDiscount: discountShekel,
            loyaltyRedeemPoints: redeemPts,
            loyaltyEarnPoints: earnPts,
          },
        },
      });

      clearOrder();
      setPosCheckoutOpen(false);
      setOrderCustomer({
        name: '',
        phone: '',
        email: '',
        address: '',
        notes: '',
        contactId: null,
        salePaymentMode: 'cash',
        posTender: 'cash',
        checkCount: 1,
        checkDates: [''],
        visaLast4: '',
        walletLabel: '',
        pickupDate: '',
        pickupLocation: '',
      });
      setItems((prev) =>
        prev.map((item) => {
          const line = orderLines.find((o) => o.id === item.id);
          if (!line) return item;
          return { ...item, stock: Math.max(0, Number(item.stock ?? 0) - (line.qty || 1)) };
        })
      );
      void fetchItems(true);
      void fetchDirectoryCustomers();
      setSalesMapVersion((v) => v + 1);
    } catch (err) {
      console.error(err);
      setCheckoutError(err.message || 'حدث خطأ أثناء عملية البيع');
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (storeLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50" dir="rtl">
        <Loader2 className="animate-spin text-indigo-600" size={40} />
      </div>
    );
  }

  if (!store?.id) {
    return (
      <div className="flex h-screen bg-slate-50 font-arabic" dir="rtl">
        <Sidebar
          collapsible
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
        />
        {sidebarCollapsed && (
          <button
            type="button"
            onClick={toggleSidebar}
            className="fixed z-50 top-1/2 -translate-y-1/2 right-0 flex h-14 w-12 items-center justify-center rounded-l-2xl border border-slate-200/90 border-r-0 bg-white/95 py-3 pl-1 pr-0.5 shadow-[0_4px_24px_-4px_rgba(15,23,42,0.15)] backdrop-blur-md transition hover:bg-indigo-50 dark:border-gray-700/50 dark:bg-gray-900/95 dark:hover:bg-indigo-950/50"
            title="إظهار لوحة التحكم"
            aria-label="إظهار لوحة التحكم والقائمة"
          >
            <Menu className="h-6 w-6 text-indigo-600 dark:text-indigo-400" strokeWidth={2.25} />
          </button>
        )}
        <main className="flex-1 flex items-center justify-center p-8">
          <p className="text-slate-600 font-bold">لا يوجد متجر مرتبط بحسابك.</p>
        </main>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes posCheckoutShine {
          0% { transform: translateX(-170%) skewX(-18deg); }
          45%, 100% { transform: translateX(420%) skewX(-18deg); }
        }
        .pos-checkout-shine {
          animation: posCheckoutShine 2.6s ease-in-out infinite;
        }
        @keyframes posSuccessScaleIn {
          0% { opacity: 0; transform: scale(0.72); }
          70% { opacity: 1; transform: scale(1.06); }
          100% { opacity: 1; transform: scale(1); }
        }
        .pos-success-scale-in {
          animation: posSuccessScaleIn 420ms cubic-bezier(.2,.9,.25,1.25) both;
        }
        @keyframes posFloatSoft {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        .pos-float-soft {
          animation: posFloatSoft 2.8s ease-in-out infinite;
        }
        @keyframes posShimmer {
          0% { background-position: -220% 0; }
          100% { background-position: 220% 0; }
        }
        .pos-shimmer {
          background-image: linear-gradient(110deg, transparent 30%, rgba(255,255,255,.16) 45%, transparent 60%);
          background-size: 220% 100%;
          animation: posShimmer 2.2s linear infinite;
        }
      `}</style>
      <div className="flex h-screen overflow-hidden bg-gray-50 font-arabic text-gray-900 dark:bg-gray-950 dark:text-gray-50" dir="rtl" style={{ fontFamily: 'Cairo, Tajawal, ui-sans-serif, system-ui' }}>
        <Sidebar
          collapsible
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
        />
        {sidebarCollapsed && (
          <button
            type="button"
            onClick={toggleSidebar}
            className="fixed z-50 top-1/2 -translate-y-1/2 right-0 flex h-14 w-12 items-center justify-center rounded-l-2xl border border-white/15 border-r-0 bg-white/10 py-3 pl-1 pr-0.5 text-indigo-200 shadow-lg shadow-indigo-500/10 backdrop-blur-xl transition duration-300 hover:bg-white/15"
            title="إظهار لوحة التحكم"
            aria-label="إظهار لوحة التحكم والقائمة"
          >
            <Menu className="h-6 w-6 text-indigo-300" strokeWidth={2.25} />
          </button>
        )}

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center gap-3 min-w-0">
              {sidebarCollapsed && (
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border shadow-sm transition ${
                    shellDark
                      ? 'border-white/15 bg-white/10 text-indigo-200 hover:bg-white/15'
                      : 'border-slate-200 bg-white text-indigo-600 hover:bg-indigo-50'
                  }`}
                  title="إظهار لوحة التحكم والقائمة"
                  aria-label="إظهار لوحة التحكم والقائمة"
                >
                  <Menu className="h-6 w-6" strokeWidth={2.25} />
                </button>
              )}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
                <ScanLine size={22} />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold text-gray-900 dark:text-gray-50">نقطة البيع</h1>
                <p className="truncate text-sm text-gray-500 dark:text-gray-400" title={store.name}>
                  {store.name}
                </p>
              </div>
            </div>
            <form onSubmit={onBarcodeSubmit} className="w-72 max-w-full">
              <div className="relative">
                <ScanLine className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} aria-hidden />
                  <input
                    ref={barcodeInputRef}
                    type="text"
                    placeholder={
                      barcodeScannerMode ? 'امسح ثم Enter' : 'باركود ثم Enter'
                    }
                    title={
                      barcodeScannerMode
                        ? 'مسار الباركود: امسح الرمز بقارئ يعمل كلوحة مفاتيح ثم Enter لإضافة الصنف للسلة مباشرة'
                        : 'أدخل رمز الباركود يدوياً ثم Enter لإضافة الصنف للسلة'
                    }
                    className="w-full rounded-lg border border-gray-300 bg-gray-50 py-2 pl-3 pr-10 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    dir="ltr"
                    lang="en"
                    autoComplete="off"
                  />
              </div>
            </form>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:border-amber-700/70 dark:bg-amber-900/40 dark:text-amber-300">
                FREE PLAN
              </span>
              <button
                type="button"
                onClick={() => {
                  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
                  else document.exitFullscreen?.();
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                title="ملء الشاشة"
              >
                <Maximize2 size={16} />
              </button>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                title="الحساب"
              >
                <User size={16} />
              </button>
            </div>
          </header>

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <section className="hidden w-[240px] shrink-0 border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 md:flex">
              <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                <div className={`hidden min-h-0 shrink-0 flex-col md:flex md:h-full ${posFiltersCollapsed ? 'w-0 overflow-hidden' : 'w-[240px]'}`}>
                  <PosProductFiltersSidebar
                    shellDark={shellDark}
                    facetCounts={posFacetCounts}
                    brandOptions={posBrandOptions}
                    productTypeOptions={posProductTypeOptions}
                    categories={posFilterCategories}
                    brands={posFilterBrands}
                    productTypes={posFilterProductTypes}
                    onToggleCategory={togglePosCategory}
                    onToggleBrand={togglePosBrand}
                    onToggleProductType={togglePosProductType}
                    onReset={resetPosFilters}
                    hasActiveFilters={hasPosSearchOrFilters}
                    staticFiltersHint={posFiltersStaticHint}
                  />
                </div>
              </div>
            </section>
            <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-gray-50 dark:bg-gray-950">
              <div className="sticky top-0 z-10 shrink-0 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPosFiltersSheetOpen(true)}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 md:hidden"
                      >
                        <SlidersHorizontal size={18} className="shrink-0" />
                        <span>فلاتر</span>
                        {hasPosSearchOrFilters && (
                          <span
                            className={`flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[10px] font-black ${
                              shellDark ? 'bg-indigo-500 text-white' : 'bg-indigo-600 text-white'
                            }`}
                          >
                            {posActiveConstraintCount}
                          </span>
                        )}
                      </button>
                      <div className="relative min-w-0 flex-1">
                        <Search
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                          size={18}
                        />
                        <input
                          type="search"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          onKeyDown={onSearchKeyDown}
                          placeholder="ابحث أو امسح الباركود..."
                          title="تصفية شبكة المنتجات. إن أدخلت باركوداً رقمياً وضغط Enter يُضاف الصنف للسلة إن وُجد."
                          className="w-full rounded-lg border border-gray-300 bg-gray-50 py-2 pl-4 pr-10 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                        />
                      </div>
                      <select
                        value={posShortcutFilter}
                        onChange={(e) => setPosShortcutFilter(e.target.value)}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                      >
                        <option value="top_sellers">الأكثر مبيعاً</option>
                        <option value="none">الكل</option>
                        <option value="promo_products">عروض حالية</option>
                      </select>
                    </div>
              </div>
              <div className="shrink-0 flex items-center gap-2 overflow-x-auto border-b border-gray-200 bg-white px-4 py-2 whitespace-nowrap dark:border-gray-800 dark:bg-gray-900" dir="rtl">
                      <button
                        type="button"
                        aria-pressed={posShortcutFilter === 'none'}
                        onClick={() => setPosShortcutFilter('none')}
                        className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                          posShortcutFilter === 'none'
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : 'border-gray-300 bg-white text-gray-600 hover:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
                        }`}
                      >
                        الكل
                      </button>
                      <button
                        type="button"
                        aria-pressed={posFilterCategories.includes('electrical')}
                        onClick={() => togglePosCategory('electrical')}
                        className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                          posFilterCategories.includes('electrical')
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : 'border-gray-300 bg-white text-gray-600 hover:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
                        }`}
                      >
                        أجهزة كهربائية
                      </button>
                      <button
                        type="button"
                        aria-pressed={posFilterCategories.includes('home')}
                        onClick={() => togglePosCategory('home')}
                        className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                          posFilterCategories.includes('home')
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : 'border-gray-300 bg-white text-gray-600 hover:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
                        }`}
                      >
                        أدوات منزلية
                      </button>
                      <button
                        type="button"
                        aria-pressed={posShortcutFilter === 'top_sellers'}
                        onClick={() =>
                          setPosShortcutFilter((f) => (f === 'top_sellers' ? 'none' : 'top_sellers'))
                        }
                        className={`inline-flex items-center gap-1 rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                          posShortcutFilter === 'top_sellers'
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : 'border-gray-300 bg-white text-gray-600 hover:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
                        }`}
                        title="ترتيب حسب آخر فواتير مُجمّعة"
                      >
                        <TrendingUp size={13} className="shrink-0" />
                        الأكثر مبيعاً
                      </button>
                      <button
                        type="button"
                        aria-pressed={posShortcutFilter === 'promo_products'}
                        disabled={promotionProductIdSet.size === 0}
                        onClick={() =>
                          setPosShortcutFilter((f) =>
                            f === 'promo_products' ? 'none' : 'promo_products'
                          )
                        }
                        className={`inline-flex items-center gap-1 rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                          posShortcutFilter === 'promo_products'
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : 'border-gray-300 bg-white text-gray-600 hover:border-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
                        } ${promotionProductIdSet.size === 0 ? 'opacity-45 cursor-not-allowed' : ''}`}
                        title={
                          promotionProductIdSet.size === 0
                            ? 'لا توجد عروض حزم نشطة بأصناف محددة'
                            : 'أصناف مشمولة بعروض الحزم الحالية'
                        }
                      >
                        <Sparkles size={13} className="shrink-0" />
                        عروض حالية
                      </button>
              </div>

              <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto">
                    {loading ? (
                      <div className="flex justify-center py-20">
                        <Loader2 className="animate-spin text-indigo-500" size={36} />
                      </div>
                    ) : filteredItems.length === 0 ? (
                      <div
                        className={`py-16 text-center text-sm font-bold ${
                          shellDark ? 'text-slate-400' : 'text-slate-500'
                        }`}
                      >
                        لا توجد منتجات مطابقة
                      </div>
                    ) : posDisplayItems.length === 0 ? (
                      <div
                        className={`py-16 text-center text-sm font-bold space-y-2 px-4 ${
                          shellDark ? 'text-slate-400' : 'text-slate-500'
                        }`}
                      >
                        <p>لا توجد أصناف في نطاق «عروض حالية» ضمن البحث والفلاتر الحالية.</p>
                        <p className="text-xs font-bold opacity-80">
                          عروض الخصم على إجمالي السلة لا تظهر هنا — جرّب إلغاء البحث أو راجع إعدادات العروض.
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-3 xl:grid-cols-4">
                        {posDisplayItems.map((item) => (
                          <ProductCard
                            key={item.id}
                            item={item}
                            snappy
                            onAddToCart={posAddOneToCart}
                            onEdit={posAddOneToCart}
                            getStockStatus={getStockStatus}
                            reviewStats={reviewsMap[item.id]}
                            onReview={openReviewModal}
                            cartQty={posCartQtyById.get(String(item.id)) || 0}
                          />
                        ))}
                      </div>
                    )}
                    {hasMore && !loading && (
                      <div ref={loadMoreRef} className="flex justify-center py-6">
                        {loadingMore ? (
                          <Loader2 className="animate-spin text-indigo-400" size={24} />
                        ) : (
                          <span
                            className={`text-xs font-bold ${
                              shellDark ? 'text-slate-500' : 'text-slate-400'
                            }`}
                          >
                            مرّر لتحميل المزيد…
                          </span>
                        )}
                      </div>
                    )}
                  </div>
            </section>

            {/* القسم الأيسر (في RTL): الفاتورة */}
            <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div className="shrink-0 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    <FileText
                      className={`shrink-0 ${shellDark ? 'text-indigo-300' : 'text-indigo-600'}`}
                      size={22}
                    />
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">
                        الفاتورة الحالية
                      </h2>
                      {orderLines.length > 0 ? (
                        <p
                          className={`text-[10px] font-black mt-0.5 ${
                            shellDark ? 'text-indigo-200/90' : 'text-indigo-700'
                          }`}
                          dir="ltr"
                          lang="en"
                        >
                          {posCartQtyStats.lineCount} أصناف · {posCartQtyStats.unitCount} قطعة
                        </p>
                      ) : null}
                    </div>
                    {orderLines.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setPosCartFullOpen(true)}
                        className={`shrink-0 flex h-8 min-w-[2rem] items-center justify-center rounded-full px-2 text-[11px] font-black transition ${
                          shellDark
                            ? 'bg-indigo-500/35 text-indigo-100 hover:bg-indigo-500/50'
                            : 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200'
                        }`}
                        title="عرض السلة كاملة"
                        aria-label="عرض السلة كاملة"
                      >
                        {posCartQtyStats.unitCount}
                      </button>
                    )}
                  </div>
                  {orderLines.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('هل تريد مسح السلة بالكامل وإلغاء جميع المنتجات؟')) clearOrder();
                      }}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-black transition ${
                        shellDark
                          ? 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                          : 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100'
                      }`}
                      title="مسح السلة بالكامل"
                    >
                      <Trash2 size={12} />
                      مسح الكل
                    </button>
                  )}
                </div>
                <p
                  className={`text-[11px] font-bold leading-relaxed ${
                    shellDark ? 'text-slate-400' : 'text-slate-500'
                  }`}
                >
                  أضف الأصناف للسلة، ثم اضغط «الدفع» أدناه.
                </p>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
                {promoSuggestions.length > 0 && (
                  <div
                    className={`rounded-xl border p-2.5 space-y-1.5 ${
                      shellDark
                        ? 'border-amber-500/30 bg-amber-950/25'
                        : 'border-amber-200 bg-amber-50/95'
                    }`}
                  >
                    <p
                      className={`text-[10px] font-black flex items-center gap-1 ${
                        shellDark ? 'text-amber-200' : 'text-amber-900'
                      }`}
                    >
                      <Sparkles size={12} className="shrink-0" />
                      اقتراحات عروض
                    </p>
                    {promoSuggestions.map((s) => (
                      <button
                        key={s.promotionId}
                        type="button"
                        onClick={() => {
                          const p = items.find((i) => String(i.id) === String(s.rewardProductId));
                          if (p) addToOrder(p, 1);
                        }}
                        className={`w-full text-right rounded-lg px-2 py-1.5 text-[11px] font-bold leading-snug transition-colors ${
                          shellDark
                            ? 'bg-amber-900/40 text-amber-100 hover:bg-amber-900/60'
                            : 'bg-white text-amber-950 hover:bg-amber-100/80 border border-amber-100'
                        }`}
                      >
                        {s.message}
                      </button>
                    ))}
                  </div>
                )}
                {promotionResult.cartWideLabels?.length > 0 && orderLines.length > 0 && (
                  <p
                    className={`text-[10px] font-bold px-1 ${
                      shellDark ? 'text-teal-300' : 'text-teal-700'
                    }`}
                  >
                    ✓ {promotionResult.cartWideLabels.join(' · ')}
                  </p>
                )}
                {orderLines.length === 0 ? (
                  <div
                    className={`mx-0.5 flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed px-3 py-10 text-center transition-all ${
                      shellDark
                        ? 'border-indigo-500/15 bg-gradient-to-b from-indigo-500/5 to-transparent'
                        : 'border-indigo-200/50 bg-gradient-to-b from-indigo-50/40 to-transparent'
                    }`}
                  >
                    <div
                      className={`pos-float-soft pos-shimmer mb-4 flex h-20 w-20 items-center justify-center rounded-3xl ${
                        shellDark
                          ? 'bg-indigo-500/10 text-indigo-500/50'
                          : 'bg-indigo-50/80 text-indigo-300 shadow-sm'
                      }`}
                      aria-hidden
                    >
                      <ShoppingCart className="h-10 w-10" strokeWidth={1.25} />
                    </div>
                    <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                      السلة فارغة
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      اضغط على منتج لإضافته
                    </p>
                  </div>
                ) : (
                  orderLines.map((o) => {
                    const promoRow = promotionResult?.byLineId?.get(String(o.id));
                    return (
                      <PosCartLineBlock
                        key={o.id}
                        o={o}
                        shellDark={shellDark}
                        promotionLabels={promoRow?.labels}
                        getLineUnitPrice={getLineUnitPrice}
                        getLineTotal={getLineTotal}
                        removeFromOrder={removeFromOrder}
                        updateQuantity={updateQuantity}
                        increaseQuantity={increaseQuantity}
                        updateLineSerial={updateLineSerial}
                        updateLineUnitPrice={updateLineUnitPrice}
                      />
                    );
                  })
                )}
              </div>

              <div className="sticky bottom-0 shrink-0 space-y-3 border-t border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="px-4 pb-2 space-y-2">
                  <input
                    type="text"
                    placeholder="ملاحظات الفاتورة..."
                    value={orderCustomer.notes}
                    onChange={(e) => setOrderCustomer((p) => ({ ...p, notes: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs font-bold text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-500 shrink-0">خصم يدوي ₪</span>
                    <input
                      type="number"
                      min="0"
                      placeholder="0.00"
                      value={orderCustomer.manualDiscount ?? ''}
                      onChange={(e) => setOrderCustomer((p) => ({ ...p, manualDiscount: parseFloat(e.target.value) || 0 }))}
                      className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs font-bold text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      dir="ltr"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setOrderCustomer((p) => ({ ...p, salePaymentMode: 'cash' }))}
                    className={`rounded-full py-2 text-xs font-semibold transition ${
                      orderCustomer.salePaymentMode === 'cash'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                    }`}
                  >
                    كاش 💵
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderCustomer((p) => ({ ...p, salePaymentMode: 'credit' }))}
                    className={`rounded-full py-2 text-xs font-semibold transition ${
                      orderCustomer.salePaymentMode === 'credit'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                    }`}
                  >
                    ذمة 📋
                  </button>
                </div>
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-sm text-gray-500 dark:text-gray-400">المجموع الفرعي</span>
                    <span className={`font-currency font-bold ${shellDark ? 'text-slate-300' : 'text-slate-700'}`} dir="ltr" lang="en">
                      ₪{cartTotals.subtotal.toFixed(2)}
                    </span>
                  </div>
                  {cartTotals.totalDiscount > 0.005 && (
                    <div className="flex items-baseline justify-between text-xs">
                      <span className={shellDark ? 'text-emerald-300/90' : 'text-emerald-700'}>خصم العروض</span>
                      <span className="font-currency font-black text-emerald-600 dark:text-emerald-400" dir="ltr" lang="en">
                        −₪{cartTotals.totalDiscount.toFixed(2)}
                      </span>
                    </div>
                  )}
                  {loyaltyDerived.discountShekel > 0.005 && (
                    <div className="flex items-baseline justify-between text-xs">
                      <span className={shellDark ? 'text-emerald-300/90' : 'text-emerald-700'}>خصم نقاط الولاء</span>
                      <span className="font-currency font-black text-emerald-600 dark:text-emerald-400" dir="ltr" lang="en">
                        −₪{loyaltyDerived.discountShekel.toFixed(2)}
                      </span>
                    </div>
                  )}
                  {manualDiscount > 0.005 && (
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-rose-500">خصم يدوي</span>
                      <span className="font-currency font-black text-rose-500" dir="ltr">−₪{manualDiscount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex items-baseline justify-between border-t border-gray-200 pt-2 dark:border-gray-800">
                    <span
                      className={`text-base font-black ${shellDark ? 'text-slate-100' : 'text-slate-800'}`}
                    >
                      الإجمالي
                    </span>
                    <span
                      className="font-currency text-2xl font-bold text-gray-900 dark:text-white"
                      dir="ltr"
                      lang="en"
                    >
                      ₪{invoicePayable.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  {orderLines.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('هل تريد مسح السلة بالكامل وإلغاء جميع المنتجات؟')) clearOrder();
                      }}
                      className={`w-full flex items-center justify-center gap-2 rounded-xl border py-2 text-xs font-black transition ${
                        shellDark
                          ? 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                          : 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100'
                      }`}
                    >
                      <Trash2 size={15} />
                      إلغاء وإفراغ السلة
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setCheckoutError(null);
                      setPosCartFullOpen(false);
                      setPosCheckoutOpen(true);
                    }}
                    disabled={orderLines.length === 0}
                    className={`mt-3 w-full rounded-xl py-3 text-base font-bold text-white transition ${
                      orderLines.length > 0
                        ? 'bg-indigo-600 hover:bg-indigo-700'
                        : 'cursor-not-allowed bg-indigo-600 opacity-40'
                    }`}
                    id="pos-checkout-btn"
                  >
                    الدفع — ₪{invoicePayable.toFixed(2)}
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </main>
      </div>

      {posCartFullOpen && !posCheckoutOpen && (
        <div
          className="fixed inset-0 z-[125] flex items-stretch justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pos-cart-full-title"
          onClick={() => setPosCartFullOpen(false)}
        >
          <div
            className={`flex h-full w-full max-w-lg flex-col shadow-2xl sm:max-h-[90vh] sm:rounded-3xl sm:border sm:overflow-hidden ${
              shellDark
                ? 'border-white/10 bg-slate-950 sm:ring-1 sm:ring-white/10'
                : 'border-slate-200 bg-white'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <header
              className={`shrink-0 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 ${
                shellDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <ShoppingBag
                  className={`shrink-0 ${shellDark ? 'text-indigo-300' : 'text-indigo-600'}`}
                  size={22}
                />
                <div className="min-w-0">
                  <h2
                    id="pos-cart-full-title"
                    className={`font-title text-base font-black ${shellDark ? 'text-white' : 'text-slate-900'}`}
                  >
                    السلة
                  </h2>
                  {posCartQtyStats.lineCount > 0 ? (
                    <p
                      className={`text-xs font-black ${shellDark ? 'text-indigo-200' : 'text-indigo-700'}`}
                      dir="ltr"
                      lang="en"
                    >
                      {posCartQtyStats.lineCount} أصناف · {posCartQtyStats.unitCount} قطعة
                    </p>
                  ) : (
                    <p className={`text-xs font-bold ${shellDark ? 'text-slate-500' : 'text-slate-500'}`}>
                      لا توجد أصناف بعد
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPosCartFullOpen(false)}
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-sm font-black ${
                  shellDark
                    ? 'border-white/15 bg-white/10 text-white hover:bg-white/15'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
                aria-label="إغلاق"
              >
                <X size={20} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2">
              {orderLines.length === 0 ? (
                <div
                  className={`mx-1 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed px-3 py-14 text-center transition-all ${
                    shellDark
                      ? 'border-indigo-500/15 bg-gradient-to-b from-indigo-500/5 to-transparent'
                      : 'border-indigo-200/50 bg-gradient-to-b from-indigo-50/40 to-transparent'
                  }`}
                >
                  <div
                    className={`pos-float-soft pos-shimmer mb-4 flex h-20 w-20 items-center justify-center rounded-3xl ${
                      shellDark
                        ? 'bg-indigo-500/10 text-indigo-500/50'
                        : 'bg-indigo-50/80 text-indigo-300 shadow-sm'
                    }`}
                    aria-hidden
                  >
                    <ShoppingCart className="h-10 w-10" strokeWidth={1.25} />
                  </div>
                  <p
                    className={`text-sm font-black ${
                      shellDark ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    السلة فارغة
                  </p>
                  <p
                    className={`mt-1 text-[11px] font-bold ${
                      shellDark ? 'text-slate-600' : 'text-slate-400'
                    }`}
                  >
                    اضغط على منتج لإضافته
                  </p>
                </div>
              ) : (
                orderLines.map((o) => {
                  const promoRow = promotionResult?.byLineId?.get(String(o.id));
                  return (
                    <PosCartLineBlock
                      key={o.id}
                      o={o}
                      shellDark={shellDark}
                      promotionLabels={promoRow?.labels}
                      getLineUnitPrice={getLineUnitPrice}
                      getLineTotal={getLineTotal}
                      removeFromOrder={removeFromOrder}
                      updateQuantity={updateQuantity}
                      increaseQuantity={increaseQuantity}
                      updateLineSerial={updateLineSerial}
                      updateLineUnitPrice={updateLineUnitPrice}
                    />
                  );
                })
              )}
            </div>

            <div
              className={`shrink-0 space-y-3 border-t p-4 ${
                shellDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-baseline justify-between text-xs">
                  <span className={shellDark ? 'text-slate-400' : 'text-slate-500'}>المجموع الفرعي</span>
                  <span className={`font-currency font-bold ${shellDark ? 'text-slate-300' : 'text-slate-700'}`} dir="ltr" lang="en">
                    ₪{cartTotals.subtotal.toFixed(2)}
                  </span>
                </div>
                {cartTotals.totalDiscount > 0.005 && (
                  <div className="flex items-baseline justify-between text-xs">
                    <span className={shellDark ? 'text-emerald-300/90' : 'text-emerald-700'}>خصم العروض</span>
                    <span className="font-currency font-black text-emerald-600 dark:text-emerald-400" dir="ltr" lang="en">
                      −₪{cartTotals.totalDiscount.toFixed(2)}
                    </span>
                  </div>
                )}
                {loyaltyDerived.discountShekel > 0.005 && (
                  <div className="flex items-baseline justify-between text-xs">
                    <span className={shellDark ? 'text-emerald-300/90' : 'text-emerald-700'}>خصم نقاط الولاء</span>
                    <span className="font-currency font-black text-emerald-600 dark:text-emerald-400" dir="ltr" lang="en">
                      −₪{loyaltyDerived.discountShekel.toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="flex items-baseline justify-between border-t border-slate-200/80 pt-2 dark:border-white/10">
                  <span className={`text-base font-black ${shellDark ? 'text-slate-100' : 'text-slate-800'}`}>
                    الإجمالي
                  </span>
                  <span
                    className={`text-2xl font-black font-currency ${
                      shellDark ? 'text-indigo-300' : 'text-indigo-700'
                    }`}
                    dir="ltr"
                    lang="en"
                  >
                    ₪{loyaltyDerived.payable.toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setCheckoutError(null);
                    setPosCartFullOpen(false);
                    setPosCheckoutOpen(true);
                  }}
                  disabled={orderLines.length === 0}
                  className={`flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black text-white shadow-lg transition ${
                    orderLines.length > 0
                      ? shellDark
                        ? 'bg-gradient-to-l from-indigo-500 to-violet-600 hover:opacity-95'
                        : 'bg-gradient-to-l from-indigo-600 to-violet-700 hover:opacity-95'
                      : 'cursor-not-allowed bg-slate-400 opacity-50 dark:bg-slate-600'
                  }`}
                >
                  <CreditCard size={20} />
                  الدفع وإتمام البيع — ₪{loyaltyDerived.payable.toFixed(2)}
                </button>
                <button
                  type="button"
                  onClick={() => setPosCartFullOpen(false)}
                  className={`flex w-full items-center justify-center rounded-2xl border py-3.5 text-sm font-black ${
                    shellDark
                      ? 'border-white/15 bg-white/10 text-white hover:bg-white/15'
                      : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  متابعة التسوق
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {posCheckoutOpen && (
        <div className="fixed inset-0 z-[130] flex flex-col bg-black/50 backdrop-blur-sm" dir="rtl">
          <div
            className={`flex min-h-0 flex-1 flex-col ${shellDark ? 'bg-[#0f172a]' : 'bg-slate-100'}`}
          >
            <header
              className={`shrink-0 flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b ${
                shellDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setPosCheckoutOpen(false);
                  setCheckoutError(null);
                }}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-black ${
                  shellDark
                    ? 'border-white/15 bg-white/10 text-white hover:bg-white/15'
                    : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                }`}
              >
                <ArrowRight size={18} className="shrink-0" />
                العودة للسلة
              </button>
              <h2
                className={`font-title text-base font-black ${
                  shellDark ? 'text-white' : 'text-slate-900'
                }`}
              >
                إتمام بيانات الفاتورة
              </h2>
              <button
                type="button"
                onClick={handlePrintOrder}
                disabled={orderLines.length === 0}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black disabled:opacity-40 ${
                  shellDark
                    ? 'border-white/15 bg-white/10 text-white hover:bg-white/15'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Printer size={16} />
                معاينة فاتورة
              </button>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
              <POSCheckoutFullForm
                shellDark={shellDark}
                orderCustomer={orderCustomer}
                setOrderCustomer={setOrderCustomer}
                directoryCustomers={directoryCustomers}
                onPickDirectoryCustomer={onPickDirectoryCustomer}
                openNewCustomerModal={openNewCustomerModal}
                creditLimitBlocked={creditLimitBlocked}
                loyaltyDerived={loyaltyDerived}
                loyaltyEarnDivisor={loyaltyEarnDivisor}
                loyaltyRedeemRate={loyaltyRedeemRate}
                loyaltyPointsInput={loyaltyPointsInput}
                setLoyaltyPointsInput={setLoyaltyPointsInput}
                loyaltyMissingTable={loyaltyMissingTable}
              />
            </div>
            <footer
              className={`shrink-0 p-4 border-t space-y-3 ${
                shellDark ? 'border-white/10 bg-slate-950/90' : 'border-slate-200 bg-white'
              }`}
            >
              {loyaltyDerived.discountShekel > 0.005 ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between items-baseline text-[11px]">
                    <span className={shellDark ? 'text-slate-400' : 'text-slate-500'}>بعد العروض</span>
                    <span className="font-currency font-bold" dir="ltr">
                      ₪{cartTotals.finalTotal.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline text-[11px]">
                    <span className={shellDark ? 'text-emerald-300/90' : 'text-emerald-800'}>
                      خصم نقاط الولاء
                    </span>
                    <span
                      className="font-currency font-black text-emerald-600 dark:text-emerald-400"
                      dir="ltr"
                    >
                      −₪{loyaltyDerived.discountShekel.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline pt-1 border-t border-slate-200/80 dark:border-white/10">
                    <span
                      className={`text-sm font-black ${shellDark ? 'text-slate-200' : 'text-slate-700'}`}
                    >
                      المستحق
                    </span>
                    <span
                      className={`text-2xl font-black font-currency ${
                        shellDark ? 'text-indigo-300' : 'text-indigo-700'
                      }`}
                      dir="ltr"
                      lang="en"
                    >
                      ₪{loyaltyDerived.payable.toFixed(2)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between items-baseline">
                  <span
                    className={`text-sm font-black ${shellDark ? 'text-slate-300' : 'text-slate-600'}`}
                  >
                    الإجمالي
                  </span>
                  <span
                    className={`text-2xl font-black font-currency ${
                      shellDark ? 'text-indigo-300' : 'text-indigo-700'
                    }`}
                    dir="ltr"
                    lang="en"
                  >
                    ₪{loyaltyDerived.payable.toFixed(2)}
                  </span>
                </div>
              )}
              {checkoutError && (
                <p className="text-xs font-bold text-rose-600 dark:text-rose-400 text-center rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/90 dark:bg-rose-950/40 px-3 py-2">
                  {checkoutError}
                </p>
              )}
              <button
                type="button"
                onClick={handleCheckout}
                disabled={
                  checkoutLoading ||
                  orderLines.length === 0 ||
                  (orderCustomer.salePaymentMode === 'credit' && !orderCustomer.contactId) ||
                  creditLimitBlocked
                }
                className={`relative w-full flex items-center justify-center gap-2 rounded-2xl text-white font-black py-4 text-base shadow-xl transition-all ${
                  !checkoutLoading &&
                  orderLines.length > 0 &&
                  !(orderCustomer.salePaymentMode === 'credit' && !orderCustomer.contactId) &&
                  !creditLimitBlocked
                    ? shellDark
                      ? 'bg-gradient-to-l from-emerald-500 to-teal-600 shadow-emerald-500/40 hover:scale-[1.02] hover:shadow-emerald-500/60 hover:shadow-2xl active:scale-[0.99]'
                      : 'bg-gradient-to-l from-emerald-500 to-teal-600 shadow-emerald-300/60 hover:scale-[1.02] hover:shadow-emerald-400/70 hover:shadow-2xl active:scale-[0.99]'
                    : 'opacity-40 cursor-not-allowed bg-slate-400 dark:bg-slate-600'
                }`}
                id="pos-save-invoice-btn"
              >
                {!checkoutLoading &&
                  !(
                    orderLines.length === 0 ||
                    (orderCustomer.salePaymentMode === 'credit' && !orderCustomer.contactId) ||
                    creditLimitBlocked
                  ) && (
                    <span
                      className="absolute inset-0 rounded-2xl opacity-0 hover:opacity-100 transition-opacity"
                      style={{
                        background: 'radial-gradient(circle at center, rgba(255,255,255,0.18) 0%, transparent 65%)',
                      }}
                      aria-hidden
                    />
                  )}
                {checkoutLoading ? (
                  <Loader2 className="animate-spin" size={22} />
                ) : (
                  <CheckCircle2 size={22} />
                )}
                {checkoutLoading ? 'جاري الحفظ…' : 'تأكيد الدفع وحفظ الفاتورة'}
              </button>
            </footer>
          </div>
        </div>
      )}

      {successToast && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pos-sale-success-title"
        >
          <div
            className={`w-full max-w-md rounded-[2rem] border p-6 text-center shadow-2xl ${
              shellDark
                ? 'border-white/10 bg-slate-950/95 text-white'
                : 'border-white/80 bg-white/95 text-slate-950'
            }`}
          >
            <div className="pos-success-scale-in mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500 text-white shadow-2xl shadow-emerald-500/30">
              <CheckCircle2 size={58} strokeWidth={2.6} />
            </div>

            <h2 id="pos-sale-success-title" className="mt-5 text-3xl font-black">
              تم البيع بنجاح! ✓
            </h2>
            <p
              className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-4xl font-black text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
              dir="ltr"
              lang="en"
            >
              ₪{Number(successToast.total ?? 0).toFixed(2)}
            </p>
            {(successToast.receiptPayload?.customerName || successToast.fullSnapshot?.orderCustomer?.name) && (
              <p className={`mt-3 text-sm font-bold ${shellDark ? 'text-slate-400' : 'text-slate-500'}`}>
                {successToast.receiptPayload?.customerName || successToast.fullSnapshot?.orderCustomer?.name}
              </p>
            )}

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  if (successToast.receiptPayload) setSimpleReceiptPrint(successToast.receiptPayload);
                }}
                className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-sm font-black transition-colors ${
                  shellDark
                    ? 'border-white/10 bg-white/10 hover:bg-white/15'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                }`}
              >
                <Printer size={17} />
                وصل بسيط
              </button>
              <button
                type="button"
                onClick={() => openFullPrintFromSnapshot(successToast.fullSnapshot)}
                className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-sm font-black transition-colors ${
                  shellDark
                    ? 'border-indigo-400/40 bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/30'
                    : 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
                }`}
              >
                <Printer size={17} />
                فاتورة كاملة
              </button>
            </div>

            <button
              type="button"
              onClick={() => setSuccessToast(null)}
              className={`mt-3 w-full rounded-2xl px-4 py-3 text-sm font-black transition-colors ${
                shellDark
                  ? 'bg-white text-slate-950 hover:bg-slate-100'
                  : 'bg-slate-950 text-white hover:bg-slate-800'
              }`}
            >
              إغلاق وبيع جديد
            </button>
          </div>
        </div>
      )}

      {typeof document !== 'undefined' &&
        newCustomerModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-950/45 backdrop-blur-sm"
            dir="rtl"
            onClick={() => {
              if (!newCustomerSaving) setNewCustomerModalOpen(false);
            }}
            role="presentation"
          >
            <div
              className={`relative w-full max-w-md overflow-hidden rounded-3xl border p-6 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.5)] backdrop-blur-2xl ${
                shellDark
                  ? 'border-white/15 bg-white/10 text-white'
                  : 'border-slate-200/90 bg-white/90 text-slate-900'
              }`}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="pos-new-customer-title"
            >
              <div
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.2),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(14,165,233,0.1),transparent_50%)]"
                aria-hidden
              />
              <div className="relative">
                <div className="flex items-start justify-between gap-3 mb-5">
                  <div>
                    <h2
                      id="pos-new-customer-title"
                      className={`text-lg font-black ${shellDark ? 'text-white' : 'text-slate-900'}`}
                    >
                      زبون جديد
                    </h2>
                    <p
                      className={`text-xs font-bold mt-1 ${
                        shellDark ? 'text-slate-400' : 'text-slate-600'
                      }`}
                    >
                      يُحفظ في دليل المتجر ويُربط بهذه الفاتورة (ذمة).
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={newCustomerSaving}
                    onClick={() => setNewCustomerModalOpen(false)}
                    className={`rounded-xl p-2 transition-colors ${
                      shellDark ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-slate-100 text-slate-600'
                    } disabled:opacity-40`}
                    aria-label="إغلاق"
                  >
                    <X size={20} />
                  </button>
                </div>

                <form onSubmit={handleSaveNewCustomer} className="space-y-4">
                  <div>
                    <label
                      className={`block text-[11px] font-black mb-1.5 ${
                        shellDark ? 'text-slate-300' : 'text-slate-700'
                      }`}
                    >
                      اسم الزبون
                    </label>
                    <input
                      type="text"
                      value={newCustomerForm.name}
                      onChange={(e) =>
                        setNewCustomerForm((f) => ({ ...f, name: e.target.value }))
                      }
                      className={`w-full rounded-2xl border px-4 py-3 text-sm font-bold outline-none transition focus:ring-2 ${
                        shellDark
                          ? 'border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400/40 focus:ring-indigo-500/25'
                          : 'border-slate-200 bg-white/80 text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:ring-indigo-200'
                      }`}
                      placeholder="الاسم الكامل"
                      autoComplete="name"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label
                      className={`block text-[11px] font-black mb-1.5 ${
                        shellDark ? 'text-slate-300' : 'text-slate-700'
                      }`}
                    >
                      رقم الهاتف
                    </label>
                    <input
                      type="text"
                      value={newCustomerForm.phone}
                      onChange={(e) =>
                        setNewCustomerForm((f) => ({
                          ...f,
                          phone: normalizeDigitsToLatin(e.target.value),
                        }))
                      }
                      className={`w-full rounded-2xl border px-4 py-3 text-sm font-bold font-currency outline-none transition focus:ring-2 ${
                        shellDark
                          ? 'border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:border-indigo-400/40 focus:ring-indigo-500/25'
                          : 'border-slate-200 bg-white/80 text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:ring-indigo-200'
                      }`}
                      placeholder="اختياري"
                      dir="ltr"
                      lang="en"
                      autoComplete="tel"
                    />
                  </div>
                  {newCustomerError && (
                    <p className="text-xs font-bold text-rose-500 text-center rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2">
                      {newCustomerError}
                    </p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      disabled={newCustomerSaving}
                      onClick={() => setNewCustomerModalOpen(false)}
                      className={`flex-1 rounded-2xl border py-3 text-sm font-black transition ${
                        shellDark
                          ? 'border-white/15 bg-white/5 hover:bg-white/10'
                          : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                      } disabled:opacity-40`}
                    >
                      إلغاء
                    </button>
                    <button
                      type="submit"
                      disabled={newCustomerSaving}
                      className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-indigo-600 to-violet-700 text-white py-3 text-sm font-black shadow-lg disabled:opacity-40"
                    >
                      {newCustomerSaving ? (
                        <Loader2 className="animate-spin" size={18} />
                      ) : (
                        <UserPlus size={18} />
                      )}
                      حفظ واختيار
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>,
          document.body
        )}

      {typeof document !== 'undefined' &&
        createPortal(
          printInvoiceData || simpleReceiptPrint ? (
            <div
              id="print-invoice-mount"
              className="fixed inset-0 z-[9999] overflow-y-auto bg-white print:static print:inset-auto print:z-auto"
            >
              {printInvoiceData ? (
                <PrintInvoice data={printInvoiceData} />
              ) : (
                <PrintPosReceiptSimple data={simpleReceiptPrint} />
              )}
            </div>
          ) : null,
          document.body
        )}

      {typeof document !== 'undefined' &&
        posFiltersSheetOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center md:hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pos-filters-sheet-title"
          >
            <button
              type="button"
              className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px]"
              aria-label="إغلاق"
              onClick={() => setPosFiltersSheetOpen(false)}
            />
            <div
              className={`relative z-[1] flex max-h-[88vh] w-full max-w-lg flex-col rounded-t-3xl border shadow-2xl ${
                shellDark
                  ? 'border-white/10 bg-slate-900/98 text-white'
                  : 'border-slate-200/80 bg-white text-slate-900'
              }`}
              dir="rtl"
            >
              <div
                className={`flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3 ${
                  shellDark ? 'border-white/10' : 'border-slate-200'
                }`}
              >
                <h2 id="pos-filters-sheet-title" className="text-base font-black">
                  فلاتر المنتجات
                </h2>
                <button
                  type="button"
                  onClick={() => setPosFiltersSheetOpen(false)}
                  className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${
                    shellDark ? 'text-slate-300 hover:bg-white/10' : 'text-slate-500 hover:bg-slate-100'
                  }`}
                  aria-label="إغلاق"
                >
                  <X size={22} />
                </button>
              </div>
              <div className="min-h-0 max-h-[min(60vh,480px)] flex-1 overflow-y-auto p-3">
                <PosProductFiltersSidebar
                  shellDark={shellDark}
                  facetCounts={posFacetCounts}
                  brandOptions={posBrandOptions}
                  productTypeOptions={posProductTypeOptions}
                  categories={posFilterCategories}
                  brands={posFilterBrands}
                  productTypes={posFilterProductTypes}
                  onToggleCategory={togglePosCategory}
                  onToggleBrand={togglePosBrand}
                  onToggleProductType={togglePosProductType}
                  onReset={resetPosFilters}
                  hasActiveFilters={hasPosSearchOrFilters}
                  staticFiltersHint={posFiltersStaticHint}
                />
              </div>
              <div
                className={`shrink-0 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))] ${
                  shellDark ? 'border-white/10 bg-slate-900/95' : 'border-slate-200 bg-white'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setPosFiltersSheetOpen(false)}
                  className="w-full rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 py-3.5 text-sm font-black text-white shadow-lg shadow-indigo-500/25"
                >
                  عرض النتائج
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {typeof document !== 'undefined' &&
        reviewModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm"
            dir="rtl"
            onClick={() => { if (!reviewSubmitting) setReviewModal(null); }}
            role="presentation"
          >
            <div
              className={`relative w-full max-w-sm overflow-hidden rounded-3xl border shadow-[0_8px_48px_-12px_rgba(0,0,0,0.55)] backdrop-blur-2xl ${
                shellDark
                  ? 'border-white/15 bg-slate-900/95 text-white'
                  : 'border-slate-200/90 bg-white/98 text-slate-900'
              }`}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="pos-review-modal-title"
            >
              <div
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(251,191,36,0.18),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(99,102,241,0.12),transparent_50%)]"
                aria-hidden
              />
              <div className="relative shrink-0 flex items-center justify-between gap-3 px-5 pt-5 pb-3">
                <div className="min-w-0">
                  <h2
                    id="pos-review-modal-title"
                    className={`text-base font-black truncate ${shellDark ? 'text-white' : 'text-slate-900'}`}
                  >
                    تقييم المنتج
                  </h2>
                  <p className={`text-xs font-bold mt-0.5 truncate ${shellDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {reviewModal.item?.name}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={reviewSubmitting}
                  onClick={() => setReviewModal(null)}
                  className={`rounded-xl p-2 transition-colors shrink-0 ${
                    shellDark ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-slate-100 text-slate-500'
                  } disabled:opacity-40`}
                  aria-label="إغلاق"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="relative px-5 pb-5 space-y-4">
                {reviewDone ? (
                  <div className="flex flex-col items-center gap-3 py-4 text-center">
                    <div className={`flex h-14 w-14 items-center justify-center rounded-full ${shellDark ? 'bg-amber-500/20' : 'bg-amber-50'}`}>
                      <CheckCircle2 className="text-amber-500" size={30} />
                    </div>
                    <p className={`text-base font-black ${shellDark ? 'text-white' : 'text-slate-900'}`}>شكراً على تقييمك!</p>
                    <StarRating value={reviewRating} showCount={false} size="lg" />
                    <button
                      type="button"
                      onClick={() => setReviewModal(null)}
                      className="mt-2 w-full rounded-2xl bg-gradient-to-l from-amber-500 to-orange-500 py-3 text-sm font-black text-white shadow-lg shadow-amber-300/40"
                    >
                      إغلاق
                    </button>
                  </div>
                ) : (
                  <>
                    {reviewsMap[reviewModal.item?.id]?.count > 0 && (
                      <div className={`flex items-center gap-3 rounded-xl border p-3 ${shellDark ? 'border-white/10 bg-white/5' : 'border-slate-100 bg-amber-50/60'}`}>
                        <StarRating value={reviewsMap[reviewModal.item.id].avg} count={reviewsMap[reviewModal.item.id].count} showCount size="md" />
                        <span className={`text-sm font-black ${shellDark ? 'text-amber-300' : 'text-amber-700'}`} dir="ltr">
                          {reviewsMap[reviewModal.item.id].avg.toFixed(1)} / 5
                        </span>
                      </div>
                    )}
                    <div className="space-y-2">
                      <p className={`text-[11px] font-black ${shellDark ? 'text-slate-300' : 'text-slate-600'}`}>اختر تقييمك</p>
                      <div className="flex justify-center py-3">
                        <StarRating value={reviewRating} interactive onChange={setReviewRating} showCount={false} size="lg" />
                      </div>
                      {reviewRating > 0 && (
                        <p className="text-center text-xs font-bold text-amber-500">
                          {['', 'ضعيف جداً ⭐', 'ضعيف ⭐⭐', 'جيد ⭐⭐⭐', 'جيد جداً ⭐⭐⭐⭐', 'ممتاز ⭐⭐⭐⭐⭐'][reviewRating]}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="review-name-input" className={`block text-[11px] font-black ${shellDark ? 'text-slate-300' : 'text-slate-600'}`}>
                        اسمك (اختياري)
                      </label>
                      <input
                        id="review-name-input"
                        type="text"
                        value={reviewName}
                        onChange={(e) => setReviewName(e.target.value)}
                        placeholder="اسم الزبون أو مجهول"
                        className={`w-full rounded-xl border px-3 py-2.5 text-sm font-bold outline-none transition focus:ring-2 ${
                          shellDark
                            ? 'border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:border-amber-400/40 focus:ring-amber-500/20'
                            : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-amber-300 focus:ring-amber-100'
                        }`}
                        autoComplete="name"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        disabled={reviewSubmitting}
                        onClick={() => setReviewModal(null)}
                        className={`flex-1 rounded-2xl border py-2.5 text-sm font-black transition ${
                          shellDark ? 'border-white/15 bg-white/5 hover:bg-white/10' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                        } disabled:opacity-40`}
                      >
                        إلغاء
                      </button>
                      <button
                        type="button"
                        disabled={reviewSubmitting || reviewRating === 0}
                        onClick={handleSubmitReview}
                        className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-amber-500 to-orange-500 text-white py-2.5 text-sm font-black shadow-lg shadow-amber-300/40 disabled:opacity-40 disabled:cursor-not-allowed hover:from-amber-400 hover:to-orange-400 transition"
                        id="pos-submit-review-btn"
                      >
                        {reviewSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Star size={18} />}
                        {reviewSubmitting ? 'جاري الحفظ…' : 'إرسال التقييم'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
