import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ExcelJS from 'exceljs';
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  X,
  Package,
  Loader2,
  Zap,
  Home,
  Plug,
  Power,
  Cable,
  Battery,
  BatteryCharging,
  PlugZap,
  Cpu,
  Utensils,
  UtensilsCrossed,
  ChefHat,
  Wine,
  Flame,
  Cookie,
  ShoppingCart,
  LayoutGrid,
  LayoutList,
  ArrowLeft,
  CreditCard,
  Wallet,
  Tag,
  CheckCircle,
  Filter,
  Layers,
  FileSpreadsheet,
} from 'lucide-react';
import { supabase, PRODUCTS_TABLE } from './lib/supabaseClient';
import { isInventoryOutOfStock } from './lib/inventoryStock';
import { getPublicImageUrl } from './utils/storageImageUrl';
import { uploadProductImageFile } from './utils/uploadProductImage';
import { BARCODE_ORDER, sortByBarcodeOrder } from './barcodeOrder';
import { getProductTypeLabel, productTypeToFormDisplay, normalizeProductTypeForDb } from './utils/productTypes';
import { useStore } from './context/StoreContext';
import { useToast } from './context/ToastContext';
import DashboardLayout from './components/DashboardLayout';
import StatsBar from './components/StatsBar';
import ProductsTable from './components/ProductsTable';
import ProductCard from './components/ProductCard';
import AddProductModal from './components/AddProductModal';
import StorageObjectImage from './components/StorageObjectImage';
import PrintInvoice from './components/PrintInvoice';
import { createPortal } from 'react-dom';
import { normalizeDigitsToLatin, normalizePriceInput } from './utils/normalizeDigits';
import {
  normalizeItemFromSupabase,
  isUuid,
  roundMoney,
  runProductsSelectWithFallback,
} from './utils/productModel';
import { insertInventoryLog } from './lib/inventoryLogs';
import InventoryCyclePanel from './components/InventoryCyclePanel';
import ImportProductsModal from './components/ImportProductsModal';
import { syncShopLocationStockFromProductRow } from './utils/storeLocations';
import { applyCashSaleToMainCashFund } from './utils/saleAccounting';
import { isCreditLimitExceeded, verifyCreditLimitAllowsSale } from './utils/creditLimit';

const PAGE_SIZE = 80;

/** تجميع كميات المبيعات من line_items لترتيب «الأكثر مبيعاً» */
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

const ELECTRICAL_GROUPS = [
  'Tefal Electric', 'Tefal', 'Moulinex', 'Mounliex', 'Babyliss', 'Babyliss Pro', 'Kenwood', 'Braun',
  'KMG midea SDA', 'KMG midea VC', 'KMG ACE', 'KMG midea MWO',
].map((s) => s.trim().toLowerCase());

const isElectricalGroup = (g) =>
  g && ELECTRICAL_GROUPS.some((eg) => String(g).trim().toLowerCase() === eg);

/** تحويل المبلغ إلى كتابة عربية (شيقل وأغورة) */
function amountToArabicWords(amount) {
  const n = Math.max(0, Number(amount));
  const intPart = Math.floor(n);
  const decPart = Math.round((n - intPart) * 100);
  const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
  const tens = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const teens = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const hundreds = ['', 'مائة', 'مئتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
  function toWords(num) {
    if (num === 0) return 'صفر';
    if (num < 10) return ones[num];
    if (num < 20) return teens[num - 10];
    if (num < 100) {
      const t = Math.floor(num / 10);
      const o = num % 10;
      if (o === 0) return tens[t];
      return ones[o] + ' و' + tens[t];
    }
    if (num < 1000) {
      const h = Math.floor(num / 100);
      const rest = num % 100;
      if (rest === 0) return hundreds[h];
      return hundreds[h] + ' و' + toWords(rest);
    }
    if (num < 1000000) {
      const th = Math.floor(num / 1000);
      const rest = num % 1000;
      const thWord = th === 1 ? 'ألف' : th === 2 ? 'ألفان' : th < 11 ? ones[th] + ' آلاف' : toWords(th) + ' ألف';
      if (rest === 0) return thWord;
      return thWord + ' و' + toWords(rest);
    }
    if (num < 1000000000) {
      const m = Math.floor(num / 1000000);
      const rest = num % 1000000;
      const mWord = m === 1 ? 'مليون' : m === 2 ? 'مليونان' : m < 11 ? ones[m] + ' ملايين' : toWords(m) + ' مليون';
      if (rest === 0) return mWord;
      return mWord + ' و' + toWords(rest);
    }
    return String(num);
  }
  let str = toWords(intPart) + ' شيقل';
  if (decPart > 0) str += ' و' + toWords(decPart) + ' أغورة';
  return str + ' فقط';
}

function App() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [viewMode, setViewMode] = useState('table'); // 'table' | 'grid'

  const [showOrderPanel, setShowOrderPanel] = useState(false);
  const [orderItems, setOrderItems] = useState([]);
  const [orderInfo, setOrderInfo] = useState(() => ({
    companyName: '',
    merchantName: '',
    phone: '',
    address: '',
    orderDate: new Date().toISOString().slice(0, 10),
    customerNumber: '',
    paymentMethod: '',
    checksCount: '',
  }));

  const [modalOpen, setModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState({
    barcode: '',
    reference: '',
    brand_group: '',
    name: '',
    product_type: '',
    price: '',
    price_after_disc: '',
    stock_count: '',
    warranty_months: '',
    image_url: '',
  });
  /** ملف صورة يُرفع إلى Storage عند الضغط على «حفظ» (مسار store_id/uuid.ext) */
  const [pendingImageFile, setPendingImageFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showOrderInfoModal, setShowOrderInfoModal] = useState(false);
  const [orderCustomer, setOrderCustomer] = useState({
    name: '',
    phone: '',
    email: '',
    notes: '',
    contactId: null,
    salePaymentMode: 'cash',
  });
  /** زبائن الدليل لربط الفاتورة والذمة */
  const [directoryCustomers, setDirectoryCustomers] = useState([]);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const [printInvoiceData, setPrintInvoiceData] = useState(null);
  /** مجموع مبيعات اليوم من جدول sales (null = جاري التحميل) */
  const [salesTodayNis, setSalesTodayNis] = useState(null);

  /**
   * أزرار التصفية السريعة ↔ جدول الأصناف (فلترة محلية على المصفوفة بعد الجلب)
   *
   * - all (الكل): كل المنتجات دون استثناء (بعد فلترة المجموعة + البحث إن وُجد).
   * - out (منتهية): فقط حيث كمية المخزن ≤ 0. في قاعدة البيانات العمود هو عادة
   *   `stock_count`؛ في الواجهة: `item.stock` (نفس معنى stock_quantity في المواصفات).
   * - in_stock (متوفر): فقط حيث كمية المخزن > 0.
   * - top (الأكثر مبيعاً): إن وُجد جدول/حقول المبيعات (`sales.line_items`) يُعاد ترتيب
   *   الأصناف تنازلياً حسب إجمالي القطع المباعة لكل صنف (ليس استعلام Supabase جديد عند كل زر).
   * - stale (راكد): مخزون موجب وبدون مبيعات مسجّلة في نفس نافذة التجميع (آخر فواتير).
   *
   * القيمة: 'all' | 'out' | 'in_stock' | 'top' | 'stale'
   */
  const [inventoryFilter, setInventoryFilter] = useState('all');
  /** '' = كل المجموعات، '__none__' = بدون مجموعة، وإلا اسم المجموعة كما في العمود */
  const [inventoryGroupFilter, setInventoryGroupFilter] = useState('');
  /** خريطة uuid أو b:barcode → إجمالي قطع مباعة (آخر فواتير) */
  const [salesQtyMap, setSalesQtyMap] = useState(() => new Map());
  const [salesMapVersion, setSalesMapVersion] = useState(0);

  const setOrderInfoField = (key, value) =>
    setOrderInfo((prev) => ({ ...prev, [key]: value }));

  const fetchItems = useCallback(
    async (reset = false, options = {}) => {
      const { ensureInListRow } = options;
      // Wait silently while StoreContext is still resolving.
      if (storeLoading) return;

      // Store resolved but this user has no store record yet.
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
            .order('brand_group', { ascending: true })
            .order('eng_name', { ascending: true })
            .range(from, to)
        );
        if (error) throw error;
        const normalized = (data || []).map(normalizeItemFromSupabase).filter(Boolean);
        if (reset) {
          let list = normalized;
          // الصفحة الأولى فقط (PAGE_SIZE) — صنف جديد قد يكون مرتباً خارجها فلا يُجلب؛ نُضيف الصف المحفوظ يدوياً.
          if (ensureInListRow) {
            const extra = normalizeItemFromSupabase(ensureInListRow);
            if (extra && !list.some((i) => i.barcode === extra.barcode)) {
              list = [extra, ...list];
            }
          }
          setItems(list);
          setPage(0);
        } else {
          setItems((prev) => [...prev, ...normalized]);
        }
        setHasMore((data?.length || 0) === PAGE_SIZE);
      } catch (err) {
        console.error('Supabase fetch error:', err);
        setItems([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [page, store, storeLoading]
  );

  /** مجموع total_amount لبيعات اليوم (نفس يوم التقويم المحلي) لهذا المتجر */
  const fetchSalesTodayTotal = useCallback(async ({ silent = false } = {}) => {
    if (!store?.id) {
      setSalesTodayNis(0);
      return;
    }
    if (!silent) setSalesTodayNis(null);
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      const { data, error } = await supabase
        .from('sales')
        .select('total_amount')
        .eq('store_id', store.id)
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString());

      if (error) throw error;
      const sum = (data || []).reduce((acc, row) => acc + Number(row.total_amount ?? 0), 0);
      setSalesTodayNis(sum);
    } catch (e) {
      console.error('fetchSalesTodayTotal:', e);
      setSalesTodayNis(0);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    if (!store?.id) {
      setSalesTodayNis(0);
      return;
    }
    void fetchSalesTodayTotal({ silent: false });
  }, [store?.id, storeLoading, fetchSalesTodayTotal]);

  /** تجميع مبيعات حسب الصنف لزر «الأكثر مبيعاً» */
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
          if (error) console.warn('aggregate sales for filter:', error.message);
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

  /** جلب زبائن الدليل عند فتح مودال إتمام البيع */
  useEffect(() => {
    if (!store?.id || !showOrderInfoModal) return;
    let cancelled = false;
    (async () => {
      let { data, error } = await supabase
        .from('store_contacts')
        .select('id, name, phone, email, payment_type, outstanding_amount, credit_limit')
        .eq('store_id', store.id)
        .eq('role', 'customer')
        .order('name');
      if (error && /credit_limit|column|schema|PGRST204/i.test(String(error.message || ''))) {
        ({ data, error } = await supabase
          .from('store_contacts')
          .select('id, name, phone, email, payment_type, outstanding_amount')
          .eq('store_id', store.id)
          .eq('role', 'customer')
          .order('name'));
      }
      if (!cancelled && !error) setDirectoryCustomers(data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [store?.id, showOrderInfoModal]);

  // البحث يُصفّي محلياً فقط (searchedItems) دون إعادة جلب من السيرفر — إعادة الجلب كانت تمسح
  // الصفحات المحمّلة وتعيد التمرير لأعلى وتُزعج العمل ضمن فلتر المجموعة.

  // Trigger a fetch whenever the store finishes resolving (whether found or not).
  useEffect(() => {
    fetchItems(true);
  }, [store?.id, storeLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (page > 0) fetchItems(false);
  }, [page]);

  const loadMore = () => {
    if (!loadingMore && hasMore) setPage((p) => p + 1);
  };

  const loadMoreRef = useRef(null);
  const scrollContainerRef = useRef(null);
  /** يُحفظ موضع التمرير عند فتح مودال التعديل ويُستعاد عند الإغلاق حتى لا «يقفز» الجدول لأعلى */
  const listScrollPositionRef = useRef(0);
  const prevModalOpenRef = useRef(false);
  useEffect(() => {
    const el = loadMoreRef.current;
    const root = scrollContainerRef.current;
    if (!el || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { root: root || null, rootMargin: '200px', threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, items.length]);

  const searchedItems = search.trim()
    ? (() => {
        const q = search.trim().toLowerCase();
        return items.filter((i) => {
          const typeLabel = getProductTypeLabel(i.productType || '').toLowerCase();
          return (
            (i.name || '').toLowerCase().includes(q) ||
            (i.barcode || '').toString().toLowerCase().includes(q) ||
            (i.reference || '').toString().toLowerCase().includes(q) ||
            (i.group || '').toLowerCase().includes(q) ||
            (typeLabel && typeLabel.includes(q))
          );
        });
      })()
    : items;

  const groupFilteredSearchedItems = useMemo(() => {
    if (!inventoryGroupFilter) return searchedItems;
    if (inventoryGroupFilter === '__none__') {
      return searchedItems.filter((i) => !String(i.group ?? '').trim());
    }
    return searchedItems.filter((i) => String(i.group ?? '') === inventoryGroupFilter);
  }, [searchedItems, inventoryGroupFilter]);

  const searchedGroupCounts = useMemo(() => {
    const m = new Map();
    for (const i of searchedItems) {
      const g = String(i.group ?? '').trim();
      const key = g || '__none__';
      m.set(key, (m.get(key) || 0) + 1);
    }
    return m;
  }, [searchedItems]);

  const salesQtyFor = useCallback(
    (i) => {
      const a = salesQtyMap.get(String(i.id)) || 0;
      const b = i.barcode ? salesQtyMap.get(`b:${i.barcode}`) || 0 : 0;
      return Math.max(a, b);
    },
    [salesQtyMap]
  );

  const stagnantStockValue = useCallback((i) => {
    const q = i.stock != null && i.stock !== '' ? Number(i.stock) : 0;
    const p = Number(i.priceAfterDiscount ?? i.price ?? 0) || 0;
    return Number.isFinite(q) && q > 0 ? q * p : 0;
  }, []);

  const filteredItems = useMemo(() => {
    let list = groupFilteredSearchedItems;
    if (inventoryFilter === 'out') {
      list = list.filter((i) => isInventoryOutOfStock(i));
    } else if (inventoryFilter === 'in_stock') {
      list = list.filter((i) => !isInventoryOutOfStock(i));
    } else if (inventoryFilter === 'top') {
      list = [...list].sort((a, b) => salesQtyFor(b) - salesQtyFor(a));
    } else if (inventoryFilter === 'stale') {
      list = list.filter((i) => {
        if (isInventoryOutOfStock(i)) return false;
        const q = i.stock != null && i.stock !== '' ? Number(i.stock) : NaN;
        if (!Number.isFinite(q) || q <= 0) return false;
        return salesQtyFor(i) <= 0;
      });
      list = [...list].sort((a, b) => stagnantStockValue(b) - stagnantStockValue(a));
    }
    return list;
  }, [groupFilteredSearchedItems, inventoryFilter, salesQtyFor, stagnantStockValue]);

  const showSalesInsightColumn = inventoryFilter === 'top' || inventoryFilter === 'stale';

  /** الحفاظ على ترتيب «الأكثر مبيعاً» و«راكد» دون إعادة ترتيب بالباركود */
  const orderedDisplayItems = useMemo(() => {
    if (inventoryFilter === 'top' || inventoryFilter === 'stale') return filteredItems;
    return sortByBarcodeOrder(filteredItems, BARCODE_ORDER, { unknownBarcodesFirst: true });
  }, [filteredItems, inventoryFilter]);

  const allGroups = useMemo(
    () =>
      [...new Set(items.map((i) => i.group).filter(Boolean))].sort((a, b) =>
        String(a).localeCompare(String(b))
      ),
    [items]
  );

  /** يبقى خيار الفلتر الحالي في القائمة حتى لو المجموعة غير ظاهرة في الصفحات المحمّلة بعد */
  const groupFilterSelectOptions = useMemo(() => {
    const s = new Set(allGroups);
    if (inventoryGroupFilter && inventoryGroupFilter !== '__none__') s.add(inventoryGroupFilter);
    return [...s].sort((a, b) => String(a).localeCompare(String(b), 'ar'));
  }, [allGroups, inventoryGroupFilter]);
  const visibleGroupPills = groupFilterSelectOptions.slice(0, 8);
  const moreGroupOptions = groupFilterSelectOptions.slice(8);

  useEffect(() => {
    if (modalOpen) {
      const el = scrollContainerRef.current;
      if (el) listScrollPositionRef.current = el.scrollTop;
    } else if (prevModalOpenRef.current) {
      const y = listScrollPositionRef.current;
      requestAnimationFrame(() => {
        const el = scrollContainerRef.current;
        if (el) el.scrollTop = y;
      });
    }
    prevModalOpenRef.current = modalOpen;
  }, [modalOpen]);
  const electricalGroups = allGroups.filter(isElectricalGroup);
  const electricalGroupsSorted = [...electricalGroups].sort((a, b) => {
    const ia = ELECTRICAL_GROUPS.indexOf(String(a).trim().toLowerCase());
    const ib = ELECTRICAL_GROUPS.indexOf(String(b).trim().toLowerCase());
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return String(a).localeCompare(String(b));
  });
  const electricalIcons = [Zap, Plug, Power, Cable, Battery, BatteryCharging, PlugZap, Cpu];
  const kitchenwareGroups = allGroups.filter((g) => !isElectricalGroup(g));
  const kitchenwareGroupsSorted = [...kitchenwareGroups];
  const kitchenwareIcons = [Home, Utensils, UtensilsCrossed, ChefHat, Wine, Flame, Cookie, Package];

  /** مخزون > 0 = موجود (سابقاً كان > 1 فكانت القطعة الواحدة تظهر «غير موجود») */
  const getStockStatus = (item) => {
    const s = item?.stock;
    if (s == null || s === '') return 'غير موجود';
    const n = Number(s);
    if (isNaN(n)) return 'غير موجود';
    return n > 0 ? 'موجود' : 'غير موجود';
  };

  /** عرض المخزون حسب الصناديق */
  const getStockByBoxes = (item) => {
    const s = item?.stock;
    const box = item?.box;
    if (s == null || s === '') return { text: '—', hasStock: false };
    const stockNum = Number(s);
    if (isNaN(stockNum)) return { text: '—', hasStock: false };
    const hasStock = stockNum > 0;
    if (stockNum <= 0) return { text: '—', hasStock: false };
    const boxNum = box != null && String(box).trim() !== '' && !isNaN(Number(box)) ? Math.max(1, Math.round(Number(box))) : null;
    if (boxNum != null && boxNum > 0) {
      const boxesCount = Math.floor(stockNum / boxNum);
      const plural = boxesCount === 1 ? 'صندوق' : boxesCount === 2 ? 'صندوقان' : 'صناديق';
      return { text: `${boxesCount} ${plural}`, hasStock };
    }
    return { text: `${stockNum} قطعة`, hasStock };
  };

  const getImage = (item) => getPublicImageUrl(item?.image);

  const addToOrder = useCallback((item, qty = 1) => {
    setOrderItems((prev) => {
      const unitPrice = roundMoney(item.priceAfterDiscount ?? item.price ?? 0);
      const box = item.box != null && String(item.box).trim() ? String(item.box).trim() : null;
      const qtyFromBox =
        box && !isNaN(Number(box)) ? Math.max(1, Math.round(Number(box))) : 1;
      const i = prev.findIndex((x) => x.id === item.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], qty: next[i].qty + qty };
        return next;
      }
      return [
        ...prev,
        { id: item.id, qty: qtyFromBox, unitPrice, box, item },
      ];
    });
  }, []);

  const removeFromOrder = (itemId) =>
    setOrderItems((prev) => prev.filter((x) => x.id !== itemId));

  /** زيادة أو إنقاص الكمية بمقدار amount (+1 أو -1) — الحد الأدنى 1 */
  const updateQuantity = (id, amount) => {
    setOrderItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, qty: Math.max(1, (item.qty || 1) + amount) }
          : item
      )
    );
  };

  /** زيادة الكمية مع التحقق من المخزن — يمنع البيع أكثر مما هو متوفر */
  const increaseQuantity = (o) => {
    const stock = Number(o.item?.stock ?? 0);
    if (stock > 0 && (o.qty || 1) >= stock) {
      toast.warning(`عذراً، لا يوجد سوى ${stock} ${stock === 1 ? 'قطعة' : 'قطع'} في المخزن!`);
      return;
    }
    updateQuantity(o.id, +1);
  };

  const setOrderQty = (itemId, qty) => {
    const n = Math.max(0, parseInt(normalizeDigitsToLatin(String(qty)), 10) || 0);
    if (n === 0) setOrderItems((prev) => prev.filter((x) => x.id !== itemId));
    else setOrderItems((prev) => prev.map((x) => (x.id === itemId ? { ...x, qty: n } : x)));
  };

  const setOrderLinePrice = (itemId, value) => {
    const n = parseFloat(normalizePriceInput(value).replace(',', '.')) || 0;
    const idStr = String(itemId);
    setOrderItems((prev) =>
      prev.map((x) =>
        String(x.id) === idStr ? { ...x, unitPrice: roundMoney(Math.max(0, n)) } : x
      )
    );
  };

  const clearOrder = () => setOrderItems([]);

  /**
   * إتمام عملية البيع:
   * 1. تسجيل فاتورة في جدول sales
   * 2. خصم الكمية من stock_count لكل منتج بشكل متوازٍ
   * 3. طباعة الفاتورة وتفريغ السلة عند النجاح
   */
  const handleCheckout = async () => {
    if (!store?.id || orderLines.length === 0) return;
    setCheckoutLoading(true);
    setCheckoutError(null);

    if (orderCustomer.salePaymentMode === 'credit' && !orderCustomer.contactId) {
      setCheckoutError('للبيع بالذمة يجب اختيار زبون من الدليل.');
      setCheckoutLoading(false);
      return;
    }

    try {
      if (orderCustomer.salePaymentMode === 'credit' && orderCustomer.contactId) {
        const v = await verifyCreditLimitAllowsSale(supabase, {
          storeId: store.id,
          contactId: orderCustomer.contactId,
          saleTotal: cartTotals.finalTotal,
        });
        if (!v.allowed) {
          setCheckoutError(v.message);
          setCheckoutLoading(false);
          return;
        }
      }

      // نص واحد يجمع كل تفاصيل الزبون (لأن جدول sales قد لا يحتوي أعمدة customer_name / phone / email)
      const detailLines = [
        `الزبون: ${orderCustomer.name.trim()}`,
        `الهاتف: ${normalizeDigitsToLatin(orderCustomer.phone.trim())}`,
        orderCustomer.email?.trim() && `البريد: ${orderCustomer.email.trim()}`,
        orderCustomer.notes?.trim() && `ملاحظات: ${orderCustomer.notes.trim()}`,
        `الدفع: ${orderCustomer.salePaymentMode === 'credit' ? 'ذمة (دين)' : 'كاش'}`,
        orderCustomer.contactId && 'الزبون مرتبط بدليل المتجر',
        `عدد الأصناف: ${orderLines.length}`,
        `إجمالي قبل الخصم: ${cartTotals.subtotal.toFixed(2)} | الخصم: ${cartTotals.totalDiscount.toFixed(2)}`,
      ].filter(Boolean);
      const saleNotes = detailLines.join('\n');

      /**
       * أسطر الفاتورة لعمود JSON (مثل line_items jsonb في sales).
       * مهم: product_id = UUID صف المنتج في products فقط، أو null — لا تُمرَّر الباركود هنا.
       * الباركود دائماً في الحقل barcode كنص (string) حتى لا يُفسَّر كـ UUID.
       */
      const saleLineItems = orderLines.map((o) => {
        const item = o.item;
        const uuidFromProduct = item && isUuid(item.id) ? String(item.id) : null;
        const barcodeStr = String(
          item?.barcode ?? (!uuidFromProduct && o.id != null ? o.id : '') ?? ''
        );
        const unit =
          o.unitPrice ?? roundMoney(item?.priceAfterDiscount ?? item?.price ?? 0);
        const q = Math.max(1, Number(o.qty) || 1);
        return {
          product_id: uuidFromProduct,
          barcode: barcodeStr,
          qty: q,
          unit_price: unit,
          line_total: Math.max(0, unit * q),
        };
      });

      // 1. تسجيل الفاتورة — تدرّج: كامل (مع line_items + ذمة) ← بدون أعمدة جديدة ← بدون JSON ← الحد الأدنى
      const base = { store_id: store.id, total_amount: cartTotals.finalTotal };
      const contactId = orderCustomer.contactId || null;
      const paymentMode = orderCustomer.salePaymentMode === 'credit' ? 'credit' : 'cash';
      const saleVariants = [
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
      if (!saleId) throw saleError || new Error('فشل حفظ الفاتورة');

      // 2. خصم المخزن + تسجيل inventory_logs (سبب: بيع)
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
            .select('stock_count')
            .eq('id', rowPk)
            .single();
          if (sel0) throw sel0;
          prevStock = Number(row0?.stock_count ?? 0);

          const { error: rpcError } = await supabase.rpc('decrement_stock', {
            row_id: rowPk,
            amount: qty,
          });
          if (rpcError) {
            newStock = Math.max(0, prevStock - qty);
            const { error: upErr } = await supabase
              .from(PRODUCTS_TABLE)
              .update({ stock_count: newStock })
              .eq('id', rowPk);
            if (upErr) throw upErr;
          } else {
            newStock = Math.max(0, prevStock - qty);
          }
        } else {
          const b = String(barcodeOnly);
          const { data: row, error: selErr } = await supabase
            .from(PRODUCTS_TABLE)
            .select('stock_count')
            .eq('barcode', b)
            .eq('store_id', store.id)
            .single();
          if (selErr) throw selErr;
          prevStock = Number(row?.stock_count ?? 0);
          newStock = Math.max(0, prevStock - qty);
          const { error: upErr } = await supabase
            .from(PRODUCTS_TABLE)
            .update({ stock_count: newStock })
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
            totalAmount: cartTotals.finalTotal,
            sourceLabel: 'لوحة المخزن',
          });
        } catch (e) {
          console.warn('[inventory] صندوق الكاش:', e);
        }
      }

      // 2ب. تحديث ذمة الزبون بعد نجاح البيع وخصم المخزن
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
          Math.max(0, Number(cRow.outstanding_amount ?? 0)) + Number(cartTotals.finalTotal);
        const { error: cUpErr } = await supabase
          .from('store_contacts')
          .update({ outstanding_amount: nextBal, payment_type: 'credit' })
          .eq('id', orderCustomer.contactId)
          .eq('store_id', store.id);
        if (cUpErr) throw cUpErr;
      }

      // 3. طباعة ثم تفريغ السلة
      handlePrintOrder();
      clearOrder();
      setShowOrderInfoModal(false);
      setOrderCustomer({
        name: '',
        phone: '',
        email: '',
        notes: '',
        contactId: null,
        salePaymentMode: 'cash',
      });
      // تحديث القائمة المحلية فوراً
      setItems((prev) =>
        prev.map((item) => {
          const line = orderLines.find((o) => o.id === item.id);
          if (!line) return item;
          return { ...item, stock: Math.max(0, Number(item.stock ?? 0) - (line.qty || 1)) };
        })
      );

      void fetchSalesTodayTotal({ silent: true });
      setSalesMapVersion((v) => v + 1);

    } catch (err) {
      console.error('Checkout error:', err);
      setCheckoutError(err.message || 'حدث خطأ أثناء عملية البيع');
    } finally {
      setCheckoutLoading(false);
    }
  };

  const orderLines = orderItems
    .map((o) => ({
      ...o,
      item:
        items.find((i) => i.id === o.id) ||
        items.find((i) => i.barcode === o.id),
    }))
    .filter((o) => o.item);

  const getLineBox = (o) =>
    o.box ?? (o.item?.box != null ? String(o.item.box) : '—');
  const getLineUnitPrice = (o) =>
    o.unitPrice ?? roundMoney(o.item?.priceAfterDiscount ?? o.item?.price ?? 0);
  const getLineOriginalPrice = (o) =>
    Number(o.item?.price) ?? 0;
  const getLineDiscountPercent = (o) => {
    const orig = getLineOriginalPrice(o);
    const after = getLineUnitPrice(o);
    if (orig <= 0 || after >= orig) return 0;
    return Math.round(((orig - after) / orig) * 100);
  };
  const getLineTotal = (o) =>
    Math.max(0, getLineUnitPrice(o) * (o.qty || 0));

  // العقل الحسابي للسلة — يُعاد الحساب فقط عند تغيير المنتجات أو أسعارها
  const cartTotals = useMemo(() => {
    const subtotal = orderLines.reduce(
      (acc, o) => acc + getLineOriginalPrice(o) * (o.qty || 1),
      0
    );
    const finalTotal = orderLines.reduce((acc, o) => acc + getLineTotal(o), 0);
    const totalDiscount = Math.max(0, subtotal - finalTotal);
    return { subtotal, totalDiscount, finalTotal };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderLines]);

  const creditLimitBlocked = useMemo(() => {
    if (orderCustomer.salePaymentMode !== 'credit' || !orderCustomer.contactId) return false;
    const c = directoryCustomers.find((x) => x.id === orderCustomer.contactId);
    if (!c) return false;
    return isCreditLimitExceeded(c.outstanding_amount, c.credit_limit, cartTotals.finalTotal);
  }, [
    orderCustomer.salePaymentMode,
    orderCustomer.contactId,
    directoryCustomers,
    cartTotals.finalTotal,
  ]);

  const orderTotal = cartTotals.finalTotal;

  const orderLinesByBox = [...orderLines].sort((a, b) =>
    String(getLineBox(a)).localeCompare(String(getLineBox(b)), undefined, {
      numeric: true,
    })
  );

  /** فاتورة طباعة (React + Cairo) — يُستدعى بعد إتمام البيع أو عند الحاجة */
  const handlePrintOrder = useCallback(() => {
    if (!orderLines.length) return;
    const lines = orderLines.map((o) => ({
      name: o.item?.name,
      barcode: o.item?.barcode,
      qty: o.qty,
      unitPrice: getLineUnitPrice(o),
      lineTotal: getLineTotal(o),
      originalPrice: getLineOriginalPrice(o),
      discountPercent: getLineDiscountPercent(o),
      imageUrl: getImage(o.item),
    }));
    setPrintInvoiceData({
      storeName: store?.name,
      customerName: orderCustomer.name,
      customerPhone: orderCustomer.phone,
      customerEmail: orderCustomer.email,
      customerNotes: orderCustomer.notes,
      lines,
      subtotal: cartTotals.subtotal,
      totalDiscount: cartTotals.totalDiscount,
      finalTotal: cartTotals.finalTotal,
      printedAtLabel: new Date().toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    });
  }, [orderLines, orderCustomer, store?.name, cartTotals]);

  useEffect(() => {
    if (!printInvoiceData) return;
    document.body.classList.add('print-invoice-active');
    const t = requestAnimationFrame(() => window.print());
    const onAfterPrint = () => {
      document.body.classList.remove('print-invoice-active');
      setPrintInvoiceData(null);
    };
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener('afterprint', onAfterPrint);
      document.body.classList.remove('print-invoice-active');
    };
  }, [printInvoiceData]);

  const getInventoryHtml = useCallback(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const safeSrc = (s) => {
      if (!s) return '';
      const str = String(s);
      return str.startsWith('data:')
        ? str
        : str.startsWith('/')
          ? origin + str
          : str;
    };
    const sortedLines = sortByBarcodeOrder(orderLines, BARCODE_ORDER);
    const cards = sortedLines
      .map((o, idx) => {
        const total = getLineTotal(o);
        const unitPrice = getLineUnitPrice(o);
        const discPercent = getLineDiscountPercent(o);
        const imgSrc = getImage(o.item);
        const imgHtml = imgSrc
          ? `<div class="inv-img"><img src="${safeSrc(imgSrc)}" alt="" /></div>`
          : '<div class="inv-img"><span class="inv-no-img">📦</span></div>';
        const name = (o.item?.name || '').replace(/</g, '&lt;').slice(0, 40);
        return `<article class="inv-card">
          <span class="inv-num" dir="ltr" lang="en">${idx + 1}</span>
          ${imgHtml}
          <div class="inv-details">
            ${name ? `<div class="inv-name">${name}</div>` : ''}
            <div class="inv-barcode">${(o.item?.barcode || '—').replace(/</g, '&lt;')}</div>
            <div class="inv-meta">
              <span class="inv-price" dir="ltr" lang="en">₪${unitPrice}</span>
              <span class="inv-qty" dir="ltr" lang="en">× ${o.qty}</span>
              ${discPercent > 0 ? `<span class="inv-disc" dir="ltr" lang="en">خصم ${discPercent}%</span>` : ''}
            </div>
          </div>
          <div class="inv-total" dir="ltr" lang="en">₪${total.toFixed(2)}</div>
        </article>`;
      })
      .join('');
    const cust = (orderInfo.companyName || orderInfo.merchantName || '—').replace(/</g, '&lt;');
    const date = (orderInfo.orderDate || '—').replace(/</g, '&lt;');
    return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>المنتجات المختارة</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',system-ui,sans-serif;padding:28px;max-width:720px;margin:0 auto;background:linear-gradient(160deg,#f8faff 0%,#f1f5f9 50%,#e2e8f0 100%);min-height:100vh}
.inv-wrap{background:#fff;border-radius:24px;box-shadow:0 20px 60px -15px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.04);padding:32px;overflow:hidden}
.inv-header{background:linear-gradient(135deg,#ea580c 0%,#f97316 50%,#fb923c 100%);color:#fff;padding:28px 24px;text-align:center;border-radius:16px;margin-bottom:24px;box-shadow:0 10px 30px -5px rgba(234,88,12,.4)}
.inv-title{font-size:1.75rem;font-weight:800;margin:0;letter-spacing:-0.02em}
.inv-sub{font-size:.9rem;opacity:.9;margin-top:6px}
.inv-info{display:flex;gap:16px;flex-wrap:wrap;padding:16px 20px;background:#f8fafc;border-radius:12px;margin-bottom:24px;font-size:.95rem;color:#475569;border:1px solid #e2e8f0}
.inv-info span{font-weight:600;color:#334155}
.inv-cards{display:flex;flex-direction:column;gap:14px}
.inv-card{display:flex;align-items:center;gap:16px;padding:16px 20px;background:#fff;border-radius:14px;border:1px solid #e2e8f0;box-shadow:0 2px 8px rgba(0,0,0,.04);transition:box-shadow .2s}
.inv-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.08)}
.inv-num{min-width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f1f5f9,#e2e8f0);color:#64748b;font-weight:700;font-size:.8rem;border-radius:8px}
.inv-img{width:64px;height:64px;flex-shrink:0;border-radius:12px;overflow:hidden;background:linear-gradient(145deg,#f8fafc,#f1f5f9);border:1px solid #e2e8f0;display:flex;align-items:center;justify-content:center}
.inv-img img{width:100%;height:100%;object-fit:contain;padding:4px}
.inv-no-img{font-size:1.8rem;opacity:.5}
.inv-details{flex:1;min-width:0}
.inv-name{font-weight:600;color:#1e293b;font-size:.95rem;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.inv-barcode{font-family:ui-monospace,monospace;font-size:.8rem;color:#64748b;font-weight:600}
.inv-meta{display:flex;gap:12px;align-items:center;margin-top:8px;flex-wrap:wrap}
.inv-price{font-weight:700;color:#ea580c;font-size:1rem}
.inv-qty{font-size:.85rem;color:#64748b}
.inv-disc{font-size:.75rem;background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:6px;font-weight:600}
.inv-total{font-weight:800;font-size:1.15rem;color:#ea580c;white-space:nowrap}
.inv-total-card{background:linear-gradient(135deg,#fff7ed,#ffedd5);border:2px solid #ea580c;border-radius:16px;padding:20px 24px;margin-top:24px;display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:1.25rem;color:#c2410c;box-shadow:0 4px 12px rgba(234,88,12,.15)}
.btn-print{padding:14px 32px;background:linear-gradient(135deg,#ea580c,#f97316);color:#fff;border:none;border-radius:12px;cursor:pointer;font-weight:700;font-size:1rem;margin-top:20px;display:block;margin-left:auto;margin-right:auto;box-shadow:0 4px 14px rgba(234,88,12,.35);transition:transform .15s,box-shadow .15s}
.btn-print:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(234,88,12,.4)}
@media print{body{background:#fff;padding:16px}.inv-wrap{box-shadow:none;border:1px solid #e2e8f0}.btn-print{display:none}.inv-card:hover{box-shadow:none}}
</style></head><body>
<div class="inv-wrap">
  <div class="inv-header"><h1 class="inv-title">المنتجات المختارة</h1><p class="inv-sub">Selected Products</p></div>
  <div class="inv-info"><span>الزبون:</span> ${cust} &nbsp;|&nbsp; <span>رقم الهاتف:</span> <span dir="ltr" lang="en">${(orderInfo.phone || '—').replace(/</g, '&lt;')}</span> &nbsp;|&nbsp; <span>التاريخ:</span> <span dir="ltr" lang="en">${date}</span>${orderInfo.paymentMethod === 'شيكات' && orderInfo.checksCount ? ` &nbsp;|&nbsp; <span>عدد الشيكات:</span> <span dir="ltr" lang="en">${String(orderInfo.checksCount).replace(/</g, '&lt;')}</span>` : ''}</div>
  <div class="inv-cards">${cards}</div>
  <div class="inv-total-card"><span>الإجمالي</span><span dir="ltr" lang="en">₪${orderTotal.toFixed(2)}</span></div>
  <button class="btn-print" onclick="window.print()">طباعة</button>
</div></body></html>`;
  }, [orderLines, orderTotal, orderInfo]);

  const handleExportExcel = useCallback(async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('سلة الطلبية', { views: [{ rightToLeft: true }] });
    const colors = {
      primary: 'FFea580c',
      primaryDark: 'FFc2410c',
      light: 'FFfff7ed',
      lightAlt: 'FFffedd5',
      border: 'FFe2e8f0',
      borderDark: 'FFcbd5e1',
      white: 'FFFFFFFF',
      textDark: 'FF1e293b',
      textMuted: 'FF64748b',
      success: 'FFdcfce7',
      successText: 'FF15803d',
    };
    const thin = { style: 'thin', color: { argb: colors.border } };
    const border = (c) => {
      c.border = { top: thin, left: thin, bottom: thin, right: thin };
    };
    const styleCell = (cell, opts = {}) => {
      if (opts.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
      if (opts.font) cell.font = opts.font;
      if (opts.alignment) cell.alignment = opts.alignment;
      border(cell);
    };
    ws.addRow(['سلة الطلبية']);
    ws.getCell(1, 1).font = { bold: true, size: 20, color: { argb: colors.white } };
    ws.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.primary } };
    ws.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.mergeCells(1, 1, 1, 7);
    ws.getRow(1).height = 36;
    let r = 3;
    ws.getCell(r, 1).value = 'معلومات المشتري';
    ws.getCell(r, 1).font = { bold: true, size: 12, color: { argb: colors.primary } };
    ws.getCell(r, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.light } };
    ws.mergeCells(r, 1, r, 7);
    ws.getCell(r, 1).alignment = { horizontal: 'right' };
    border(ws.getCell(r, 1));
    r++;
    const excelInfoRows = [['اسم الشركة', orderInfo.companyName], ['اسم التاجر', orderInfo.merchantName], ['التلفون', orderInfo.phone], ['العنوان', orderInfo.address], ['التاريخ', orderInfo.orderDate], ['طريقة الدفع', orderInfo.paymentMethod], ...(orderInfo.paymentMethod === 'شيكات' && orderInfo.checksCount ? [['عدد الشيكات', orderInfo.checksCount]] : [])];
    excelInfoRows.forEach(([l, v], i) => {
      ws.getCell(r, 1).value = l;
      ws.getCell(r, 2).value = v || '';
      styleCell(ws.getCell(r, 1), { fill: i % 2 === 0 ? colors.light : colors.lightAlt, font: { bold: true, color: { argb: colors.textDark } }, alignment: { horizontal: 'right' } });
      styleCell(ws.getCell(r, 2), { fill: colors.white, font: { color: { argb: colors.textDark } }, alignment: { horizontal: 'right' } });
      ws.mergeCells(r, 2, r, 7);
      r++;
    });
    r += 1;
    ws.getCell(r, 1).value = 'تفاصيل الأصناف';
    ws.getCell(r, 1).font = { bold: true, size: 12, color: { argb: colors.primary } };
    ws.getCell(r, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.light } };
    ws.mergeCells(r, 1, r, 7);
    ws.getCell(r, 1).alignment = { horizontal: 'right' };
    border(ws.getCell(r, 1));
    r++;
    const headers = ['الاسم', 'الباركود', 'الكمية', 'السعر', 'بعد الخصم', 'نسبة الخصم %', 'المجموع'];
    headers.forEach((h, c) => {
      ws.getCell(r, c + 1).value = h;
      styleCell(ws.getCell(r, c + 1), { fill: colors.primary, font: { bold: true, color: { argb: colors.white }, size: 11 }, alignment: { horizontal: 'center', vertical: 'middle' } });
    });
    ws.getRow(r).height = 24;
    r++;
    const sortedLines = sortByBarcodeOrder(orderLines, BARCODE_ORDER);
    sortedLines.forEach((o, i) => {
      const discPct = getLineDiscountPercent(o);
      ws.getCell(r, 1).value = (o.item?.name || '').slice(0, 50);
      ws.getCell(r, 2).value = o.item?.barcode || '';
      ws.getCell(r, 3).value = o.qty;
      ws.getCell(r, 4).value = Number(o.item?.price) ?? 0;
      ws.getCell(r, 5).value = getLineUnitPrice(o);
      ws.getCell(r, 6).value = discPct > 0 ? discPct + '%' : '—';
      ws.getCell(r, 7).value = parseFloat(getLineTotal(o).toFixed(2));
      const rowFill = i % 2 === 0 ? colors.white : 'FFF8fafc';
      for (let c = 1; c <= 7; c++) {
        const cell = ws.getCell(r, c);
        styleCell(cell, {
          fill: rowFill,
          font: c === 7 ? { bold: true, color: { argb: colors.primary } } : { color: { argb: colors.textDark } },
          alignment: c <= 2 ? { horizontal: 'right' } : { horizontal: 'center' },
        });
      }
      r++;
    });
    ws.getCell(r, 1).value = '';
    ws.getCell(r, 5).value = 'الإجمالي';
    ws.getCell(r, 7).value = parseFloat(orderTotal.toFixed(2));
    for (let c = 1; c <= 7; c++) {
      const cell = ws.getCell(r, c);
      styleCell(cell, {
        fill: colors.light,
        font: c >= 5 ? { bold: true, size: 12, color: { argb: colors.primary } } : {},
        alignment: c === 5 ? { horizontal: 'right' } : c === 7 ? { horizontal: 'center' } : {},
      });
    }
    ws.getRow(r).height = 28;
    ws.getColumn(1).width = 32;
    ws.getColumn(2).width = 16;
    ws.getColumn(3).width = 10;
    ws.getColumn(4).width = 12;
    ws.getColumn(5).width = 12;
    ws.getColumn(6).width = 14;
    ws.getColumn(7).width = 14;
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `طلب-${(orderInfo.companyName || orderInfo.merchantName || 'طلب').replace(/[/\\:*?"<>|]/g, '')}-${orderInfo.orderDate || new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [orderLines, orderTotal, orderInfo]);

  const handleOpenInventory = () => {
    const html = getInventoryHtml();
    const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const openAddModal = () => {
    setEditingItem(null);
    setPendingImageFile(null);
    setFormData({
      barcode: '',
      reference: '',
      brand_group: '',
      name: '',
      product_type: '',
      appliance_size: '',
      price: '',
      price_after_disc: '',
      stock_count: '',
      warranty_months: '',
      image_url: '',
    });
    setModalOpen(true);
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    setPendingImageFile(null);
    setFormData({
      barcode: item.barcode || '',
      reference: item.reference ?? '',
      brand_group: item.group || '',
      name: item.name || '',
      product_type: productTypeToFormDisplay(item.productType || ''),
      appliance_size: item.applianceSize || '',
      price:
        item.price != null && item.price !== '' ? String(item.price) : '',
      price_after_disc:
        item.priceAfterDiscount != null && item.priceAfterDiscount !== ''
          ? String(item.priceAfterDiscount)
          : '',
      stock_count:
        item.stock != null && item.stock !== '' ? String(item.stock) : '',
      warranty_months:
        item.warrantyMonths != null && item.warrantyMonths !== ''
          ? String(item.warrantyMonths)
          : '',
      image_url: item.image || '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e, selectedImageFile = pendingImageFile) => {
    e.preventDefault();

    if (!store?.id) {
      toast.error('خطأ: لا يوجد متجر مرتبط بهذا الحساب.');
      return;
    }

    setSaving(true);
    try {
      let imageUrlValue = formData.image_url.trim() || null;
      if (selectedImageFile) {
        imageUrlValue = await uploadProductImageFile(store.id, selectedImageFile);
      }

      const payload = {
        barcode: normalizeDigitsToLatin(formData.barcode.trim()),
        reference: normalizeDigitsToLatin(formData.reference.trim()) || null,
        brand_group: formData.brand_group.trim() || null,
        eng_name: formData.name.trim() || null,
        product_type: normalizeProductTypeForDb(formData.product_type),
        appliance_size: String(formData.appliance_size || '').trim() || null,
        full_price: formData.price
          ? parseFloat(normalizeDigitsToLatin(String(formData.price)))
          : null,
        price_after_disc: formData.price_after_disc
          ? parseFloat(normalizeDigitsToLatin(String(formData.price_after_disc)))
          : null,
        stock_count: formData.stock_count
          ? parseInt(normalizeDigitsToLatin(String(formData.stock_count)), 10)
          : 0,
        warranty_months: (() => {
          const t = String(formData.warranty_months ?? '').trim();
          if (!t) return null;
          const n = parseInt(normalizeDigitsToLatin(t), 10);
          if (Number.isNaN(n)) return null;
          return Math.min(240, Math.max(0, n));
        })(),
        image_url: imageUrlValue,
      };
      let savedRow = null;
      if (editingItem) {
        const { data, error } = await runProductsSelectWithFallback((sel) =>
          supabase
            .from(PRODUCTS_TABLE)
            .update(payload)
            .eq('barcode', editingItem.barcode)
            .eq('store_id', store.id)
            .select(sel)
            .single()
        );
        if (error) throw error;
        savedRow = data;
      } else {
        const { data, error } = await runProductsSelectWithFallback((sel) =>
          supabase
            .from(PRODUCTS_TABLE)
            .insert({ ...payload, store_id: store.id })
            .select(sel)
            .single()
        );
        if (error) throw error;
        savedRow = data;
      }

      const afterSaveTasks = [];
      if (editingItem && savedRow) {
        const oldStock = Number(editingItem.stock ?? 0);
        const newStock = Number(savedRow.stock_count ?? 0);
        if (oldStock !== newStock) {
          const normForLog = normalizeItemFromSupabase(savedRow);
          afterSaveTasks.push(
            insertInventoryLog({
              storeId: store.id,
              productId: normForLog && isUuid(normForLog.id) ? normForLog.id : null,
              barcode: normForLog?.barcode ?? editingItem.barcode,
              productName: normForLog?.name ?? editingItem.name,
              qtyBefore: oldStock,
              qtyAfter: newStock,
              reason: 'adjustment',
            })
          );
        }
      }
      if (savedRow) {
        afterSaveTasks.push(syncShopLocationStockFromProductRow(store.id, savedRow));
      }
      await Promise.all(afterSaveTasks);

      const merged = savedRow ? normalizeItemFromSupabase(savedRow) : null;
      if (merged) {
        setItems((prev) => {
          const idx = prev.findIndex((i) => String(i.barcode) === String(merged.barcode));
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = merged;
            return next;
          }
          if (!editingItem && !prev.some((i) => String(i.barcode) === String(merged.barcode))) {
            return [merged, ...prev];
          }
          return prev;
        });
      }

      if (!editingItem) {
        setSearch('');
      }
      setPendingImageFile(null);
      setModalOpen(false);
      toast.success('تم حفظ الصنف بنجاح');
    } catch (err) {
      toast.error(err.message || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (barcode) => {
    if (!store?.id || !confirm('حذف هذا الصنف؟')) return;
    try {
      await supabase
        .from(PRODUCTS_TABLE)
        .delete()
        .eq('barcode', barcode)
        .eq('store_id', store.id);   // ← prevents deleting another tenant's item
      setItems((prev) => prev.filter((i) => i.barcode !== barcode));
      toast.success('تم حذف الصنف');
    } catch (err) {
      toast.error(err.message || 'فشل الحذف');
    }
  };

  const handleImageFileSelect = (file) => {
    setPendingImageFile(file || null);
  };

  return (
    <>
    <DashboardLayout
      actions={
        <>
          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-black text-emerald-800 shadow-sm hover:bg-emerald-100 transition-all dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
          >
            <FileSpreadsheet size={18} />
            استيراد Excel
          </button>
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-l from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-violet-500/30 transition hover:brightness-110 active:scale-[0.98]"
          >
            <Plus size={18} strokeWidth={2.5} />
            إضافة صنف
          </button>
        </>
      }
    >
    <div
      className={`flex h-full overflow-hidden ${showOrderPanel ? 'flex-row' : 'flex-col'}`}
    >
      <div
        className="-mt-4 flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden pt-0 px-3 pb-3 sm:px-4 sm:pb-4"
      >
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <header className="mb-2 flex-shrink-0 rounded-3xl border border-white/20 bg-white/75 px-4 py-3 shadow-[0_8px_30px_-24px_rgba(15,23,42,0.35)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45 dark:shadow-black/20 sm:px-5">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="text-slate-500 dark:text-slate-400 text-xs shrink-0 hidden sm:inline">
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:min-w-[120px]">
              <div className="relative min-w-[120px] max-w-xs flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-indigo-400" size={14} aria-hidden />
                <input
                  type="text"
                  placeholder="بحث بالاسم، الباركود، المجموعة…"
                  value={search}
                  dir="ltr"
                  onChange={(e) => setSearch(normalizeDigitsToLatin(e.target.value))}
                  className="w-full min-w-0 rounded-xl border border-slate-200 bg-white/95 py-2 pl-9 pr-3 text-sm text-gray-900 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20 dark:border-white/10 dark:bg-slate-900/70 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-indigo-400/50 dark:focus:ring-indigo-500/20"
                />
              </div>
              {/* تبديل طريقة العرض */}
              <div className="flex shrink-0 bg-slate-100 dark:bg-slate-900/80 p-1.5 rounded-2xl gap-1">
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`p-2 rounded-2xl transition-all ${viewMode === 'table' ? 'bg-white dark:bg-white/10 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}
                  title="عرض جدول"
                >
                  <LayoutList size={20} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded-2xl transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-white/10 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}
                  title="عرض شبكي"
                >
                  <LayoutGrid size={20} />
                </button>
              </div>

              <button
                type="button"
                onClick={openAddModal}
                className="relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-2xl bg-gradient-to-l from-violet-600 to-indigo-600 px-3 text-xs font-black text-white shadow-md shadow-indigo-500/20 transition hover:brightness-110"
                title="إضافة صنف جديد — صورة وتصنيف وسعر"
              >
                <Plus size={16} strokeWidth={2.5} />
                <span className="hidden sm:inline">إضافة صنف</span>
              </button>

              {/* زر السلة */}
              <button
                type="button"
                onClick={() => setShowOrderPanel(!showOrderPanel)}
                className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-orange-200 bg-orange-100 text-orange-600 shadow-sm transition-all hover:bg-orange-200 dark:border-orange-500/20 dark:bg-orange-500/10 dark:text-orange-300"
                title="سلة الطلبية"
              >
                <ShoppingCart size={18} />
                {orderTotal > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-rose-500 text-[10px] font-bold text-white dark:border-gray-800">
                    {orderLines.length}
                  </span>
                )}
              </button>
            </div>
          </div>
        </header>

        <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto pt-0">
          <div className="w-full space-y-4">
              <div className="flex flex-wrap items-center gap-2 mb-4" dir="rtl">
                <span className="text-xs font-black text-slate-500 dark:text-slate-400 flex items-center gap-1 shrink-0">
                  <Filter size={14} />
                  تصفية سريعة:
                </span>
                {[
                  { id: 'all', label: 'الكل' },
                  { id: 'out', label: 'منتهية' },
                  { id: 'in_stock', label: 'متوفر' },
                  { id: 'top', label: 'الأكثر مبيعاً' },
                  { id: 'stale', label: 'راكد' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={inventoryFilter === f.id}
                    onClick={() => setInventoryFilter(f.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-black transition-all border ${
                      inventoryFilter === f.id
                        ? 'border-slate-900 bg-slate-900 text-white dark:border-white/15 dark:bg-white/15'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-white/10'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
                <span className="text-[10px] text-slate-400 dark:text-slate-500 max-w-[220px] leading-snug">
                  «الأكثر مبيعاً» و«راكد» يعتمدان على آخر فواتير مُجمّعة؛ الأصناف تظهر حسب ما تم تحميله في القائمة.
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-2" dir="rtl">
                {/* Label + active indicator */}
                <span className="text-xs font-black text-slate-500 dark:text-slate-400 flex items-center gap-1.5 shrink-0">
                  <Layers size={14} className="text-violet-500 shrink-0" />
                  فلتر المجموعة:
                  {inventoryGroupFilter && (
                    <span className="flex h-2 w-2 rounded-full bg-violet-500 animate-pulse" aria-hidden />
                  )}
                </span>

                {/* Pinned active-from-more chip */}
                {inventoryGroupFilter && moreGroupOptions.includes(inventoryGroupFilter) && (
                  <button
                    type="button"
                    onClick={() => setInventoryGroupFilter('')}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-violet-500 bg-violet-600 px-3 py-1.5 text-xs font-black text-white shadow-sm ring-2 ring-violet-500/20 transition-all hover:bg-violet-700 dark:bg-violet-500 dark:border-violet-400 dark:ring-violet-400/20"
                    title="اضغط لإلغاء الفلتر"
                  >
                    {inventoryGroupFilter}
                    <span className="opacity-70">×</span>
                  </button>
                )}

                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
                  {/* All groups */}
                  <button
                    type="button"
                    onClick={() => setInventoryGroupFilter('')}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-black transition-all ${
                      !inventoryGroupFilter
                        ? 'border-violet-600 bg-violet-600 text-white shadow-sm ring-2 ring-violet-500/20 dark:border-violet-400 dark:bg-violet-500 dark:ring-violet-400/20'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-violet-200 hover:bg-violet-50/50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-white/10'
                    }`}
                  >
                    كل المجموعات ({searchedItems.length.toLocaleString('en-US')})
                  </button>

                  {/* No-group */}
                  {(searchedGroupCounts.get('__none__') ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => setInventoryGroupFilter('__none__')}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-black transition-all ${
                        inventoryGroupFilter === '__none__'
                          ? 'border-violet-600 bg-violet-600 text-white shadow-sm ring-2 ring-violet-500/20 dark:border-violet-400 dark:bg-violet-500 dark:ring-violet-400/20'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-violet-200 hover:bg-violet-50/50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-white/10'
                      }`}
                    >
                      بدون مجموعة ({(searchedGroupCounts.get('__none__') ?? 0).toLocaleString('en-US')})
                    </button>
                  )}

                  {/* Visible group pills */}
                  {visibleGroupPills.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setInventoryGroupFilter(inventoryGroupFilter === g ? '' : g)}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-black transition-all ${
                        inventoryGroupFilter === g
                          ? 'border-violet-600 bg-violet-600 text-white shadow-sm ring-2 ring-violet-500/20 dark:border-violet-400 dark:bg-violet-500 dark:ring-violet-400/20'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-violet-200 hover:bg-violet-50/50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-white/10'
                      }`}
                      title={g}
                    >
                      {g} ({(searchedGroupCounts.get(g) ?? 0).toLocaleString('en-US')})
                    </button>
                  ))}
                </div>

                {/* More groups dropdown */}
                {moreGroupOptions.length > 0 && (
                  <select
                    value={moreGroupOptions.includes(inventoryGroupFilter) ? inventoryGroupFilter : ''}
                    onChange={(e) => {
                      if (e.target.value) setInventoryGroupFilter(e.target.value);
                    }}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-black outline-none transition-all focus:ring-2 focus:ring-violet-500/20 ${
                      moreGroupOptions.includes(inventoryGroupFilter)
                        ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/50 dark:bg-violet-950/30 dark:text-violet-300'
                        : 'border-slate-200 bg-white text-slate-600 focus:border-violet-300 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-300'
                    }`}
                    aria-label="مجموعات إضافية"
                  >
                    <option value="">
                      {moreGroupOptions.includes(inventoryGroupFilter) ? `✓ ${inventoryGroupFilter}` : `المزيد (${moreGroupOptions.length}+)`}
                    </option>
                    {moreGroupOptions.map((g) => (
                      <option key={g} value={g}>
                        {g} ({(searchedGroupCounts.get(g) ?? 0).toLocaleString('en-US')})
                      </option>
                    ))}
                  </select>
                )}

                {/* Clear filter button */}
                {inventoryGroupFilter && (
                  <button
                    type="button"
                    onClick={() => setInventoryGroupFilter('')}
                    className="shrink-0 inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-bold text-rose-600 hover:bg-rose-100 dark:border-rose-800/40 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-900/40 transition-all"
                    title="مسح الفلتر"
                  >
                    <X size={11} />
                    مسح
                  </button>
                )}
              </div>

              <InventoryCyclePanel storeId={store?.id} />
              <StatsBar
                items={items}
                itemsForOutOfStockCount={searchedItems}
                loading={loading}
                salesTodayNis={salesTodayNis}
              />

              {loading ? (
                <div className="flex justify-center py-20">
                  <Loader2 className="animate-spin text-indigo-500" size={40} />
                </div>
              ) : viewMode === 'grid' ? (
                <div className="pb-8 px-4">
                  {orderedDisplayItems.length === 0 ? (
                    <p className="text-center text-slate-400 dark:text-slate-500 py-20 font-bold">لا توجد منتجات</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                      {orderedDisplayItems.map((item) => (
                        <ProductCard
                          key={item.id}
                          item={item}
                          getStockStatus={getStockStatus}
                          onEdit={openEditModal}
                          onAddToCart={(i) => addToOrder(i, 1)}
                          salesSoldQty={showSalesInsightColumn ? salesQtyFor(item) : undefined}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="pb-8">
                  <ProductsTable
                    items={orderedDisplayItems}
                    getStockStatus={getStockStatus}
                    isElectricalGroup={isElectricalGroup}
                    onEdit={openEditModal}
                    onDelete={handleDelete}
                    onRowClick={setSelectedItem}
                    onAddToCart={(item) => addToOrder(item, 1)}
                    showSalesColumn={showSalesInsightColumn}
                    getSalesQty={salesQtyFor}
                  />
                </div>
              )}

              {hasMore && items.length > 0 && (
                <div ref={loadMoreRef} className="flex justify-center py-8 min-h-[60px]">
                  {loadingMore && <Loader2 className="animate-spin text-indigo-500" size={32} />}
                </div>
              )}
          </div>
        </div>
        </div>
      </div>



      {showOrderPanel && (
        <aside className="flex-shrink-0 min-h-0 w-[min(480px,40vw)] min-w-[320px] flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-950/90 border-r border-white/20 dark:border-gray-700/30 shadow-[-4px_0_24px_-8px_rgba(0,0,0,0.08)] dark:shadow-[-4px_0_24px_-8px_rgba(0,0,0,0.45)] backdrop-blur-md" dir="rtl">

          {/* هيدر */}
          <div className="flex-shrink-0 px-5 py-4 flex justify-between items-center bg-white/80 dark:bg-gray-900/50 border-b border-slate-100 dark:border-gray-700/40 backdrop-blur-md">
            <h2 className="text-base font-black text-gray-900 dark:text-white">
              سلة الطلبية{' '}
              <span className="text-indigo-500 font-black" dir="ltr" lang="en">({orderLines.length})</span>
            </h2>
            <button
              onClick={() => setShowOrderPanel(false)}
              className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors flex items-center justify-center font-bold text-sm"
            >✕</button>
          </div>

          {/* قائمة المنتجات */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
            {orderLines.length === 0 ? (
              <div className="text-center py-16 rounded-3xl bg-white/80 dark:bg-gray-900/40 border-2 border-dashed border-slate-200 dark:border-gray-700/50 text-slate-400 dark:text-slate-500 backdrop-blur-sm">
                <Package className="mx-auto mb-3 text-slate-300 dark:text-slate-600" size={40} />
                <p className="text-sm font-bold">الأصناف المضافة ستظهر هنا</p>
              </div>
            ) : (
              orderLinesByBox.map((o) => (
                <div
                  key={o.id}
                  className="group rounded-2xl border border-slate-100 bg-white p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-lg hover:shadow-slate-200/60 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20 dark:hover:shadow-black/20"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-black leading-snug text-gray-900 dark:text-white">
                        {o.item?.name || '—'}
                      </p>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px]" dir="ltr" lang="en">
                        <span className="text-slate-400 dark:text-slate-500">₪</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={getLineUnitPrice(o)}
                          onChange={(e) => setOrderLinePrice(o.id, e.target.value)}
                          dir="ltr"
                          lang="en"
                          className="w-16 rounded-md border-0 bg-transparent p-0 text-[11px] font-bold text-slate-500 outline-none focus:ring-2 focus:ring-indigo-500/20 dark:text-slate-400"
                        />
                        <span className="text-slate-400 dark:text-slate-600">سعر الوحدة</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-sm font-black text-indigo-700 dark:text-indigo-200" dir="ltr" lang="en">
                      ₪{getLineTotal(o).toFixed(2)}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 p-1 dark:border-white/10 dark:bg-white/10">
                      <button
                        type="button"
                        onClick={() => updateQuantity(o.id, -1)}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-slate-700 transition hover:bg-white hover:shadow-sm dark:text-slate-200 dark:hover:bg-white/15"
                      >
                        −
                      </button>
                      <span className="min-w-8 px-2 text-center text-sm font-black text-slate-900 dark:text-white" dir="ltr">
                        {o.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => increaseQuantity(o)}
                        disabled={(o.qty || 1) >= Number(o.item?.stock ?? 0) && Number(o.item?.stock ?? 0) > 0}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-indigo-700 transition hover:bg-white hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-30 dark:text-indigo-200 dark:hover:bg-indigo-500/25"
                      >
                        +
                      </button>
                    </div>
                    <button
                      onClick={() => removeFromOrder(o.id)}
                      className="text-[11px] font-bold text-slate-400 opacity-0 transition-all hover:text-rose-600 group-hover:opacity-100 dark:text-slate-500 dark:hover:text-rose-300"
                    >
                      حذف
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ملخص الحساب */}
          {orderLines.length > 0 && (
            <div className="flex-shrink-0 space-y-3 border-t border-slate-200 bg-slate-50/90 p-4 backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
              <div className="space-y-2">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">المجموع الفرعي</span>
                  <span className="font-bold text-slate-700 dark:text-slate-300" dir="ltr" lang="en">
                    ₪{cartTotals.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                {cartTotals.totalDiscount > 0 && (
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-emerald-700 dark:text-emerald-300/90">خصم العروض</span>
                    <span className="font-black text-emerald-600 dark:text-emerald-400" dir="ltr" lang="en">
                      −₪{cartTotals.totalDiscount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                <div className="flex items-baseline justify-between border-t border-slate-200/80 pt-2 dark:border-white/10">
                  <span className="text-base font-black text-slate-800 dark:text-slate-100">الإجمالي</span>
                  <div className="text-left">
                    <span className="text-2xl font-black text-indigo-600 tracking-tight" dir="ltr" lang="en">
                      ₪{cartTotals.finalTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold text-left">{amountToArabicWords(orderTotal)}</p>
                  </div>
                </div>
              </div>

              {/* أزرار الإجراءات */}
              <button
                onClick={() => setShowOrderInfoModal(true)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-indigo-600 to-violet-700 py-4 text-sm font-black text-white shadow-xl shadow-indigo-300/50 transition-all hover:scale-[1.02] hover:shadow-indigo-400/60 active:scale-[0.99] dark:from-indigo-500 dark:to-violet-600 dark:shadow-indigo-500/30"
              >
                إتمام عملية البيع
                <ArrowLeft size={18} />
              </button>

              <div className="flex flex-wrap gap-2 mt-2">
                <button onClick={handleOpenInventory} className="flex-1 py-2 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black transition-all">المنتجات</button>
                <button onClick={handleExportExcel} className="flex-1 py-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition-all">Excel</button>
                <button onClick={clearOrder} className="flex-1 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-black transition-all">تفريغ</button>
              </div>

              <div className="mt-4 flex justify-center gap-4 opacity-25">
                <CreditCard size={22} />
                <Wallet size={22} />
              </div>
            </div>
          )}

        </aside>
      )}

      {/* مودال معلومات الطلبية */}
      {showOrderInfoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => setShowOrderInfoModal(false)}
          dir="rtl"
        >
          <div
            className="bg-white/80 dark:bg-gray-900/50 backdrop-blur-md border border-white/20 dark:border-gray-700/30 rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* هيدر */}
            <div className="flex items-center justify-between px-7 py-5 border-b border-slate-100 dark:border-gray-700/40">
              <h2 className="text-xl font-black text-gray-900 dark:text-white">معلومات الطلبية</h2>
              <button
                onClick={() => setShowOrderInfoModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* الفورم */}
            <div className="px-7 py-6 space-y-5">
              {/* دليل الزبائن + الذمة */}
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                  <Wallet size={16} className="text-indigo-500 dark:text-indigo-400" />
                  زبون من الدليل
                </label>
                <select
                  value={orderCustomer.contactId || ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) {
                      setOrderCustomer((p) => ({ ...p, contactId: null }));
                      return;
                    }
                    const c = directoryCustomers.find((x) => x.id === id);
                    if (c) {
                      setOrderCustomer((p) => ({
                        ...p,
                        contactId: id,
                        name: c.name || '',
                        phone: normalizeDigitsToLatin(c.phone || ''),
                        email: c.email || '',
                      }));
                    }
                  }}
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 focus:border-indigo-300 outline-none text-sm text-gray-900 dark:text-white"
                >
                  <option value="">— بدون ربط —</option>
                  {directoryCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.phone ? ` · ${c.phone}` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">لربط الفاتورة بالذمة أضف الزبائن من «الزبائن والموردين»</p>
              </div>

              {/* اسم الزبون */}
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                  اسم الزبون <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="أدخل اسم الزبون"
                  value={orderCustomer.name}
                  onChange={(e) => setOrderCustomer((p) => ({ ...p, name: e.target.value }))}
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 focus:border-indigo-300 outline-none transition-all text-sm text-gray-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-500"
                />
              </div>

              {/* رقم الهاتف */}
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                  رقم الهاتف <span className="text-rose-500">*</span>
                </label>
                <input
                  type="tel"
                  placeholder="أدخل رقم الهاتف"
                  value={orderCustomer.phone}
                  onChange={(e) =>
                    setOrderCustomer((p) => ({ ...p, phone: normalizeDigitsToLatin(e.target.value) }))
                  }
                  dir="ltr"
                  lang="en"
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 focus:border-indigo-300 outline-none transition-all text-sm text-gray-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-500"
                />
              </div>

              {/* البريد الإلكتروني */}
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-200">البريد الإلكتروني <span className="text-slate-400 dark:text-slate-500 font-normal">(اختياري)</span></label>
                <input
                  type="email"
                  placeholder="أدخل البريد الإلكتروني"
                  value={orderCustomer.email}
                  onChange={(e) => setOrderCustomer((p) => ({ ...p, email: e.target.value }))}
                  dir="ltr"
                  lang="en"
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 focus:border-indigo-300 outline-none transition-all text-sm text-gray-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-500"
                />
              </div>

              {/* كاش / ذمة */}
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-200">طريقة الدفع</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOrderCustomer((p) => ({ ...p, salePaymentMode: 'cash' }))}
                    className={`flex-1 py-3 rounded-2xl text-sm font-black border-2 transition-all ${
                      orderCustomer.salePaymentMode === 'cash'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-500'
                    }`}
                  >
                    كاش
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderCustomer((p) => ({ ...p, salePaymentMode: 'credit' }))}
                    className={`flex-1 py-3 rounded-2xl text-sm font-black border-2 transition-all ${
                      orderCustomer.salePaymentMode === 'credit'
                        ? 'border-amber-500 bg-amber-50 text-amber-900'
                        : 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-500'
                    }`}
                  >
                    دين (ذمة)
                  </button>
                </div>
                {orderCustomer.salePaymentMode === 'credit' && (
                  <p className="text-xs text-amber-800 font-bold bg-amber-50 rounded-xl px-3 py-2 border border-amber-100 leading-relaxed">
                    يجب اختيار زبون من الدليل أعلاه؛ يُضاف المطلوب لرصيد ذمته تلقائياً بعد إتمام البيع.
                  </p>
                )}
                {creditLimitBlocked && (
                  <p
                    className="text-xs font-black text-rose-700 bg-rose-50 rounded-xl px-3 py-2 border border-rose-200 leading-relaxed"
                    role="alert"
                  >
                    عذراً، هذا الزبون تجاوز حد الدين المسموح به
                  </p>
                )}
              </div>

              {/* ملاحظات */}
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-200">ملاحظات خاصة <span className="text-slate-400 dark:text-slate-500 font-normal">(اختياري)</span></label>
                <textarea
                  placeholder="أدخل أي ملاحظات خاصة بالطلبية"
                  value={orderCustomer.notes}
                  onChange={(e) => setOrderCustomer((p) => ({ ...p, notes: e.target.value }))}
                  rows={4}
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 focus:border-indigo-300 outline-none transition-all text-sm text-gray-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-500 resize-none"
                />
              </div>
            </div>

            {/* أزرار */}
            <div className="flex flex-col gap-3 px-7 pb-7">
              {checkoutError && (
                <p className="text-xs text-rose-500 font-bold text-center bg-rose-50 px-4 py-2 rounded-2xl border border-rose-100">
                  {checkoutError}
                </p>
              )}
              <div className="flex gap-3">
              <button
                onClick={handleCheckout}
                disabled={
                  !orderCustomer.name.trim() ||
                  !orderCustomer.phone.trim() ||
                  checkoutLoading ||
                  (orderCustomer.salePaymentMode === 'credit' && !orderCustomer.contactId) ||
                  creditLimitBlocked
                }
                className={`w-full py-5 rounded-[2rem] font-black text-lg shadow-2xl transition-all flex items-center justify-center gap-3
                  ${
                    checkoutLoading ||
                    !orderCustomer.name.trim() ||
                    !orderCustomer.phone.trim() ||
                    (orderCustomer.salePaymentMode === 'credit' && !orderCustomer.contactId) ||
                    creditLimitBlocked
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                      : 'bg-indigo-600 text-white hover:bg-slate-800 hover:-translate-y-1 active:scale-95 shadow-indigo-200'
                  }`}
              >
                {checkoutLoading ? (
                  <div className="w-6 h-6 border-4 border-slate-300 border-t-indigo-400 rounded-full animate-spin" />
                ) : (
                  <>
                    تأكيد وطباعة الفاتورة
                    <CheckCircle size={22} />
                  </>
                )}
              </button>
              <button
                onClick={() => { setShowOrderInfoModal(false); setCheckoutError(null); }}
                disabled={checkoutLoading}
                className="w-full border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 py-3 rounded-2xl font-black text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-all disabled:opacity-40"
              >
                إلغاء
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setSelectedItem(null)}>
          <div className="bg-white/80 dark:bg-gray-900/50 backdrop-blur-md border border-white/20 dark:border-gray-700/30 rounded-3xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between mb-4">
              <h3 className="font-bold text-gray-900 dark:text-white">تفاصيل المنتج</h3>
              <button onClick={() => setSelectedItem(null)} className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">✕</button>
            </div>
            <div className="aspect-square max-h-48 rounded-xl bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center mb-4">
              <StorageObjectImage
                srcValue={selectedItem?.image}
                className="w-full h-full object-contain max-h-48"
                iconSize={64}
                fallbackClassName="text-slate-300"
              />
            </div>
            <p className="text-slate-700 dark:text-slate-200 mb-2">{selectedItem.name}</p>
            <div className="flex flex-wrap gap-2 mb-1">
              {getProductTypeLabel(selectedItem.productType) ? (
                <span className="text-xs font-black bg-indigo-100 text-indigo-900 dark:bg-indigo-950/80 dark:text-indigo-200 px-2 py-1 rounded-lg">
                  {getProductTypeLabel(selectedItem.productType)}
                </span>
              ) : null}
              {selectedItem.group ? (
                <span className="text-xs bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300 px-2 py-1 rounded-lg">
                  {selectedItem.group}
                </span>
              ) : null}
            </div>
            <p className="mt-2">السعر: <span className="font-currency" dir="ltr" lang="en">₪{roundMoney(selectedItem.price ?? 0).toFixed(2)}</span> | السعر بعد الخصم: <span className="font-currency" dir="ltr" lang="en">₪{roundMoney(selectedItem.priceAfterDiscount ?? selectedItem.price ?? 0).toFixed(2)}</span></p>
            <p className="mt-1 text-slate-600 dark:text-slate-400 text-sm">المخزون: <span className={getStockStatus(selectedItem) === 'موجود' ? 'text-emerald-600 dark:text-emerald-400 font-medium' : ''}>{getStockStatus(selectedItem)}</span></p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  const it = selectedItem;
                  setSelectedItem(null);
                  openEditModal(it);
                }}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center justify-center gap-2"
              >
                <Pencil size={18} />
                تعديل الصنف (صورة وتصنيف)
              </button>
              <button
                type="button"
                onClick={() => { addToOrder(selectedItem, 1); setSelectedItem(null); }}
                className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-bold"
              >
                إضافة للسلة
              </button>
            </div>
          </div>
        </div>
      )}

      <AddProductModal
        isOpen={modalOpen}
        onClose={() => {
          setPendingImageFile(null);
          setModalOpen(false);
        }}
        editingItem={editingItem}
        formData={formData}
        setFormData={setFormData}
        onSubmit={handleSubmit}
        onImageFileSelect={handleImageFileSelect}
        saving={saving}
        brandGroupOptions={allGroups}
      />
    </div>
    </DashboardLayout>
    {typeof document !== 'undefined' &&
      createPortal(
        printInvoiceData ? (
          <div
            id="print-invoice-mount"
            className="fixed inset-0 z-[9999] overflow-y-auto bg-white print:static print:inset-auto print:z-auto"
          >
            <PrintInvoice data={printInvoiceData} />
          </div>
        ) : null,
        document.body
      )}
    {importModalOpen && store?.id && (
      <ImportProductsModal
        storeId={store.id}
        onClose={() => setImportModalOpen(false)}
        onImported={() => {
          setImportModalOpen(false);
          fetchItems();
        }}
      />
    )}
    </>
  );
}

export default App;
