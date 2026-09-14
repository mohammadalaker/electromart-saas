import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ScanLine,
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  Lock,
  Unlock,
  Coins,
  CheckCircle2,
  Printer,
  X,
  Maximize2,
  Menu,
  ShoppingBag,
  AlertCircle,
  TrendingUp,
  Scale,
  Receipt,
  DollarSign,
  CreditCard,
  Tag,
  Store,
  RotateCcw,
  Sparkles,
  Sun,
  Moon,
  PackagePlus,
  User,
  UserPlus,
  Users,
  Phone,
  MapPin,
  Calendar,
  Truck,
  Boxes,
} from 'lucide-react';
import { supabase, PRODUCTS_TABLE, PRODUCTS_STOCK_COLUMN } from '../lib/supabaseClient';
import { normalizeItemFromSupabase, isUuid, roundMoney, runProductsSelectWithFallback } from '../utils/productModel';
import { normalizeDigitsToLatin, normalizePriceInput } from '../utils/normalizeDigits';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { applyCashSaleToMainCashFund } from '../utils/saleAccounting';
import { insertInventoryLog } from '../lib/inventoryLogs';
import { useHtmlDarkClass, applyExplicitTheme } from '../lib/theme';
import Sidebar from '../components/Sidebar';
import PrintPosReceiptSimple from '../components/PrintPosReceiptSimple';
import POSCheckoutFullForm from '../components/POSCheckoutFullForm';
import { brandStorageKey } from '../constants/brand.js';

const SIDEBAR_COLLAPSED_KEY = brandStorageKey('sidebar-collapsed');

function readSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** نغمة صوتية سريعة لمسح الباركود */
function playScanBeep(success = true) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(success ? 1046.5 : 220, ctx.currentTime);
    gain.setValueAtTime(0.12, ctx.currentTime);
    gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (success ? 0.09 : 0.2));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (success ? 0.09 : 0.2));
  } catch {
    /* ignore audio error */
  }
}

/** نغمة تأكيد إتمام الفاتورة (صوت كاشير مميز) */
function playCashChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.frequency.setValueAtTime(523.25, now); // C5
    osc2.frequency.setValueAtTime(659.25, now + 0.08); // E5

    gain.setValueAtTime(0.15, now);
    gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.12);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.35);
  } catch {
    /* ignore */
  }
}

// أقسام السوبرماركت السريعة الافتراضية
const QUICK_SECTIONS = [
  { id: 'produce', label: 'خضار وفواكه 🥬', defaultUnit: 'كغم', defaultPrice: 5 },
  { id: 'bakery', label: 'مخبز ومعجنات 🥖', defaultUnit: 'قطعة', defaultPrice: 2 },
  { id: 'weight', label: 'بيع بالوزن / ميزان ⚖️', defaultUnit: 'كغم', defaultPrice: 10 },
  { id: 'dairy', label: 'ألبان وأجبان 🧀', defaultUnit: 'كغم', defaultPrice: 15 },
  { id: 'custom', label: 'صنف يدوي ⚡', defaultUnit: 'قطعة', defaultPrice: 0 },
];

export default function SupermarketPOS() {
  const { store } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const isDark = useHtmlDarkClass();

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

  // ─────────────────────────────────────────────────────────────
  // 1. إدارة جلسة الصندوق والشيفت (Cash Register Shift)
  // ─────────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState(null);
  const [activeShift, setActiveShift] = useState(null); // null = جاري الفحص, false = لا يوجد شيفت, object = شيفت مفتوح
  const [checkingShift, setCheckingShift] = useState(true);

  // حقول فتح الصندوق
  const [openingAmountInput, setOpeningAmountInput] = useState('');
  const [openingNotes, setOpeningNotes] = useState('');
  const [submittingOpenShift, setSubmittingOpenShift] = useState(false);

  // حقول إغلاق الصندوق
  const [closeShiftModalOpen, setCloseShiftModalOpen] = useState(false);
  const [closingAmountInput, setClosingAmountInput] = useState('');
  const [closingNotes, setClosingNotes] = useState('');
  const [shiftSummary, setShiftSummary] = useState({
    openingAmount: 0,
    cashSales: 0,
    cardSales: 0,
    creditSales: 0,
    otherSales: 0,
    totalSales: 0,
    salesCount: 0,
    expectedAmount: 0,
  });
  const [lastReceiptData, setLastReceiptData] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [submittingCloseShift, setSubmittingCloseShift] = useState(false);

  // فحص الشيفت عند التحميل
  const checkActiveShift = useCallback(async () => {
    if (!store?.id) return;
    setCheckingShift(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setCheckingShift(false);
        return;
      }
      setCurrentUser(user);

      const { data, error } = await supabase
        .from('cash_register_sessions')
        .select('*')
        .eq('store_id', store.id)
        .eq('user_id', user.id)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .maybeSingle();

      if (error) {
        console.error('Error fetching cash register session:', error);
      }

      if (data) {
        setActiveShift(data);
      } else {
        setActiveShift(false);
      }
    } catch (err) {
      console.error(err);
      setActiveShift(false);
    } finally {
      setCheckingShift(false);
    }
  }, [store?.id]);

  useEffect(() => {
    checkActiveShift();
  }, [checkActiveShift]);

  // تنفيذ فتح الصندوق
  const handleOpenShift = async (e) => {
    e.preventDefault();
    const amt = parseFloat(normalizeDigitsToLatin(openingAmountInput));
    if (isNaN(amt) || amt < 0) {
      toast.error('يرجى إدخال مبلغ افتتاحي صحيح (0 أو أكثر)');
      return;
    }
    setSubmittingOpenShift(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const payload = {
        store_id: store.id,
        user_id: user.id,
        opening_amount: roundMoney(amt),
        status: 'open',
        opened_at: new Date().toISOString(),
        notes: openingNotes.trim() || null,
      };

      const { data, error } = await supabase
        .from('cash_register_sessions')
        .insert([payload])
        .select()
        .single();

      if (error) throw error;

      setActiveShift(data);
      toast.success('تم فتح الصندوق وبدء الشيفت بنجاح!');
      setTimeout(() => barcodeInputRef.current?.focus(), 150);
    } catch (err) {
      console.error('Error opening shift:', err);
      toast.error('حدث خطأ أثناء فتح الصندوق: ' + (err.message || ''));
    } finally {
      setSubmittingOpenShift(false);
    }
  };

  // فتح نافذة إغلاق الصندوق وجلب ملخص المبيعات (كاش وبطاقة)
  const openCloseShiftModal = async () => {
    if (!activeShift || !store?.id) return;
    setCloseShiftModalOpen(true);
    setLoadingSummary(true);
    try {
      const { data: sales, error } = await supabase
        .from('sales')
        .select('id, total_amount, payment_mode, payment_method, notes, created_at')
        .eq('store_id', store.id)
        .gte('created_at', activeShift.opened_at);

      if (error) throw error;

      let cashTotal = 0;
      let cardTotal = 0;
      let creditTotal = 0;
      let otherTotal = 0;
      let count = 0;

      for (const s of sales || []) {
        const notesStr = String(s.notes || '');
        // مطابقة الفواتير التابعة لهذا الشيفت
        const matchesSession =
          (s.session_id && s.session_id === activeShift.id) ||
          notesStr.includes(activeShift.id) ||
          (!notesStr.includes('جلسة الصندوق') && new Date(s.created_at) >= new Date(activeShift.opened_at));

        if (!matchesSession) continue;

        count++;
        const val = Number(s.total_amount || 0);
        const mode = (s.payment_mode || '').toLowerCase();
        const method = (s.payment_method || '').toLowerCase();

        const isCard = mode === 'visa' || mode === 'card' || method === 'card' || method === 'visa';
        const isCredit = mode === 'credit' || method === 'deferred' || method === 'credit';
        const isCash = !isCard && !isCredit && (mode === 'cash' || method === 'cash' || !mode);

        if (isCard) {
          cardTotal += val;
        } else if (isCredit) {
          creditTotal += val;
        } else if (isCash) {
          cashTotal += val;
        } else {
          otherTotal += val;
        }
      }

      const openAmt = Number(activeShift.opening_amount || 0);
      const expected = roundMoney(openAmt + cashTotal);

      setShiftSummary({
        openingAmount: openAmt,
        cashSales: roundMoney(cashTotal),
        cardSales: roundMoney(cardTotal),
        creditSales: roundMoney(creditTotal),
        otherSales: roundMoney(otherTotal),
        totalSales: roundMoney(cashTotal + cardTotal + creditTotal + otherTotal),
        salesCount: count,
        expectedAmount: expected,
      });
      setClosingAmountInput('');
    } catch (err) {
      console.error('Error fetching shift summary:', err);
      toast.error('تعذر جلب مبيعات الشيفت الحالية: ' + (err.message || ''));
    } finally {
      setLoadingSummary(false);
    }
  };

  // تأكيد إغلاق الصندوق وتحديث السجل
  const handleConfirmCloseShift = async (e) => {
    e.preventDefault();
    if (!activeShift) return;

    const actual = parseFloat(normalizeDigitsToLatin(closingAmountInput));
    if (isNaN(actual) || actual < 0) {
      toast.error('يرجى إدخال المبلغ الفعلي الموجود في الدرج (0 أو أكثر)');
      return;
    }

    const expected = shiftSummary.expectedAmount;
    const diff = roundMoney(actual - expected);

    setSubmittingCloseShift(true);
    try {
      const notesCombined = closingNotes.trim()
        ? `${activeShift.notes ? activeShift.notes + ' | ' : ''}إغلاق: ${closingNotes.trim()}`
        : activeShift.notes;

      const { error } = await supabase
        .from('cash_register_sessions')
        .update({
          closing_amount: roundMoney(actual),
          expected_amount: roundMoney(expected),
          difference: diff,
          status: 'closed',
          closed_at: new Date().toISOString(),
          notes: notesCombined,
        })
        .eq('id', activeShift.id);

      if (error) throw error;

      playCashChime();
      toast.success('تم إغلاق الصندوق وإنهاء الشيفت بنجاح!');
      setCloseShiftModalOpen(false);
      clearInvoice();
      setActiveShift(false);
      setOpeningAmountInput('');
      setOpeningNotes('');
    } catch (err) {
      console.error('Error closing shift:', err);
      toast.error('حدث خطأ أثناء إغلاق الصندوق: ' + (err.message || ''));
    } finally {
      setSubmittingCloseShift(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 2. إدارة الأصناف والبحث الدائم بالباركود
  // ─────────────────────────────────────────────────────────────
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activeDropdownIndex, setActiveDropdownIndex] = useState(-1);
  const barcodeInputRef = useRef(null);
  const searchContainerRef = useRef(null);

  // جلب المنتجات المسجلة في المتجر للاقتراحات والباركود السريع
  useEffect(() => {
    if (!store?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await runProductsSelectWithFallback((sel) =>
        supabase
          .from(PRODUCTS_TABLE)
          .select(sel)
          .eq('store_id', store.id)
          .order('created_at', { ascending: false })
          .limit(300)
      );
      if (cancelled) return;
      if (!error && Array.isArray(data)) {
        setItems(data.map(normalizeItemFromSupabase).filter(Boolean));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store?.id]);

  // البحث الجزئي للاقتراحات
  const partialMatches = useMemo(() => {
    const q = normalizeDigitsToLatin(String(search || '').trim()).toLowerCase();
    if (!q) return [];
    return items
      .filter((i) => {
        const fields = [i.name, i.barcode, i.reference, i.group];
        return fields.some((f) =>
          normalizeDigitsToLatin(String(f ?? '')).toLowerCase().includes(q)
        );
      })
      .slice(0, 8);
  }, [items, search]);

  // ─────────────────────────────────────────────────────────────
  // 3. بنود جدول الفاتورة المباشر (Direct Invoice Table)
  // ─────────────────────────────────────────────────────────────
  // كل سطر: { id, barcode, name, unit, qty, unitPrice, discount, lineTotal }
  const [orderItems, setOrderItems] = useState([]);
  const [tenderedAmount, setTenderedAmount] = useState('');
  const [isSubmittingSale, setIsSubmittingSale] = useState(false);
  const [simpleReceiptPrint, setSimpleReceiptPrint] = useState(null);

  // إضافة منتج بالباركود (إن وُجد يزيد الكمية +1 وإلا يضيف سطراً جديداً)
  const addOrIncrementProduct = useCallback(
    (product, customQty = 1) => {
      const normBc = normalizeDigitsToLatin(String(product.barcode || '').trim());
      const unitPrice = roundMoney(product.priceAfterDiscount ?? product.price ?? 0);

      setOrderItems((prev) => {
        const existingIdx = prev.findIndex((line) => {
          if (normBc && line.barcode === normBc) return true;
          if (line.productId && line.productId === product.id) return true;
          return false;
        });

        if (existingIdx >= 0) {
          const next = [...prev];
          const cur = next[existingIdx];
          const nextQty = roundMoney(cur.qty + customQty);
          const lineTotal = roundMoney(Math.max(0, nextQty * cur.unitPrice - cur.discount));
          next[existingIdx] = { ...cur, qty: nextQty, lineTotal };
          return next;
        }

        const newQty = customQty;
        const lineTotal = roundMoney(Math.max(0, newQty * unitPrice));
        const newLine = {
          id: 'item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          productId: product.id || null,
          barcode: normBc || '—',
          name: product.name || 'منتج',
          unit: product.box ? 'كرتونة' : 'قطعة',
          qty: newQty,
          unitPrice: unitPrice,
          discount: 0,
          lineTotal: lineTotal,
        };
        return [newLine, ...prev];
      });

      playScanBeep(true);
      toast.success(`✓ أُضيف: ${product.name || normBc}`);
      setSearch('');
      setIsDropdownOpen(false);
      setActiveDropdownIndex(-1);
      setTimeout(() => barcodeInputRef.current?.focus(), 30);
    },
    [toast]
  );

  // معالجة مسح الباركود أو الضغط على Enter في الحقل
  const handleBarcodeSubmit = async (e) => {
    if (e) e.preventDefault();
    const raw = search.trim();
    if (!raw) return;

    const norm = normalizeDigitsToLatin(raw);

    // 1. فحص التطابق التام في المنتجات المحملة محلياً
    let hit =
      items.find((i) => normalizeDigitsToLatin(String(i.barcode || '').trim()) === norm) ||
      items.find(
        (i) =>
          normalizeDigitsToLatin(String(i.barcode || '').replace(/\s/g, '')) ===
          norm.replace(/\s/g, '')
      );

    // 2. إذا لم يُعثر عليه، استعلام مباشر من قاعدة بيانات Supabase
    if (!hit && store?.id) {
      try {
        const { data, error } = await runProductsSelectWithFallback((sel) =>
          supabase
            .from(PRODUCTS_TABLE)
            .select(sel)
            .eq('store_id', store.id)
            .eq('barcode', norm)
            .maybeSingle()
        );
        if (!error && data) {
          const row = normalizeItemFromSupabase(data);
          if (row) {
            hit = row;
            setItems((prev) => (prev.some((i) => i.id === row.id) ? prev : [row, ...prev]));
          }
        }
      } catch (err) {
        console.error('Error searching barcode:', err);
      }
    }

    if (hit) {
      addOrIncrementProduct(hit, 1);
      return;
    }

    // 3. إذا كان هناك عنصر محدد في القائمة المنسدلة بالأسهم
    if (activeDropdownIndex >= 0 && partialMatches[activeDropdownIndex]) {
      addOrIncrementProduct(partialMatches[activeDropdownIndex], 1);
      return;
    }

    // 4. إذا كانت هناك نتيجة جزئية وحيدة وضغط Enter (وليست أرقام باركود صرف)
    if (partialMatches.length === 1 && !/^\d{5,}$/.test(norm)) {
      addOrIncrementProduct(partialMatches[0], 1);
      return;
    }

    if (partialMatches.length > 1 && !/^\d{5,}$/.test(norm)) {
      setIsDropdownOpen(true);
      return;
    }

    // 5. في حال عدم العثور على المنتج أصلاً (غير معروف): فتح نافذة تسجيل منتج جديد تلقائياً
    playScanBeep(false);
    openNewProductModal(norm);
  };

  // ─────────────────────────────────────────────────────────────
  // 2.5 إدارة مودال تسجيل صنف جديد (بالسكانر أو مباشرة للمخزون)
  // ─────────────────────────────────────────────────────────────
  const [newProductModal, setNewProductModal] = useState(null); // { barcode: string, isInventoryOnly?: boolean } | null
  const initialNewProductForm = {
    name: '',
    unit: 'قطعة',
    price: '',
    costPrice: '',
    initialStock: '0',
    minStockAlert: '5',
    supplierId: '',
    expiryDate: '',
    category: 'مواد غذائية',
    barcode: '',
  };
  const [newProductForm, setNewProductForm] = useState(initialNewProductForm);
  const [suppliersList, setSuppliersList] = useState([]);
  const [savingNewProduct, setSavingNewProduct] = useState(false);
  const newProductNameInputRef = useRef(null);
  const newProductBarcodeInputRef = useRef(null);

  // جلب قائمة الموردين للمتجر الحالي
  useEffect(() => {
    if (!store?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('store_contacts')
          .select('id, name, phone')
          .eq('store_id', store.id)
          .eq('role', 'supplier')
          .order('name');
        if (cancelled) return;
        if (!error && Array.isArray(data)) {
          setSuppliersList(data);
        }
      } catch (err) {
        console.error('Error fetching suppliers for product modal:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store?.id]);

  // فتح المودال عند مسح باركود غير معروف (يُضاف تلقائياً للفاتورة بعد الحفظ)
  const openNewProductModal = (barcode) => {
    setIsDropdownOpen(false);
    setSearch('');
    const cleanBc = String(barcode || '').trim();
    setNewProductModal({ barcode: cleanBc, isInventoryOnly: false });
    setNewProductForm({
      ...initialNewProductForm,
      barcode: cleanBc,
    });
    setTimeout(() => newProductNameInputRef.current?.focus(), 120);
  };

  // فتح المودال من زر "إضافة صنف للمخزون" (حفظ للمخزون فقط دون إضافته للفاتورة الحالية)
  const openNewProductForInventoryOnly = () => {
    setIsDropdownOpen(false);
    setSearch('');
    setNewProductModal({ barcode: '', isInventoryOnly: true });
    setNewProductForm({
      ...initialNewProductForm,
      barcode: '',
    });
    setTimeout(() => {
      if (newProductBarcodeInputRef.current) {
        newProductBarcodeInputRef.current.focus();
      } else {
        newProductNameInputRef.current?.focus();
      }
    }, 120);
  };

  const handleCancelNewProduct = () => {
    setNewProductModal(null);
    setNewProductForm(initialNewProductForm);
    setTimeout(() => barcodeInputRef.current?.focus(), 50);
  };

  const handleSaveNewProduct = async (e) => {
    if (e) e.preventDefault();
    if (!newProductModal || savingNewProduct) return;

    const name = newProductForm.name.trim();
    if (!name) {
      toast.error('يرجى كتابة اسم المنتج');
      newProductNameInputRef.current?.focus();
      return;
    }

    const priceNum = roundMoney(parseFloat(normalizeDigitsToLatin(newProductForm.price)));
    if (isNaN(priceNum) || priceNum < 0) {
      toast.error('يرجى إدخال سعر بيع صحيح (0 أو أكثر)');
      return;
    }

    const costPriceNum = roundMoney(parseFloat(normalizeDigitsToLatin(newProductForm.costPrice)));
    if (isNaN(costPriceNum) || costPriceNum < 0) {
      toast.error('يرجى إدخال سعر تكلفة صحيح (0 أو أكثر)');
      return;
    }

    const parsedStock = parseFloat(normalizeDigitsToLatin(newProductForm.initialStock));
    const stockNum = isNaN(parsedStock) || parsedStock < 0 ? 0 : roundMoney(parsedStock);

    const parsedMinStock = parseFloat(normalizeDigitsToLatin(newProductForm.minStockAlert));
    const minStockVal = isNaN(parsedMinStock) || parsedMinStock < 0 ? 5 : roundMoney(parsedMinStock);

    const supplierVal = newProductForm.supplierId?.trim() || null;
    const expiryVal = newProductForm.expiryDate?.trim() || null;

    setSavingNewProduct(true);
    try {
      const isInvOnly = Boolean(newProductModal.isInventoryOnly);
      const barcodeStr = isInvOnly
        ? String(newProductForm.barcode || '').trim()
        : String(newProductModal.barcode || '').trim();

      const unitVal = newProductForm.unit || 'قطعة';
      const catVal = newProductForm.category?.trim() || null;

      // ── ربط الحقول بالأعمدة المطابقة في جدول products ──
      // سعر البيع -> full_price و price_after_disc
      // سعر التكلفة -> purchase_price و last_purchase_price و avg_purchase_price
      // الكمية الافتتاحية -> stock_count
      const confirmedPayload = {
        store_id: store.id,
        barcode: barcodeStr || null,
        eng_name: name,
        full_price: priceNum,
        price_after_disc: priceNum,
        purchase_price: costPriceNum,
        last_purchase_price: costPriceNum,
        avg_purchase_price: costPriceNum,
        stock_count: stockNum,
        box_count: 1, // حقل box_count في قاعدة البيانات نوعه integer
        brand_group: catVal,
      };

      const payloadWithExtras = {
        ...confirmedPayload,
        ...(supplierVal ? { supplier_id: supplierVal } : {}),
        ...(expiryVal ? { expiry_date: expiryVal } : {}),
        ...(minStockVal != null ? { min_stock_alert: minStockVal } : {}),
      };

      const payloadMinimal = {
        store_id: store.id,
        barcode: barcodeStr || null,
        eng_name: name,
        full_price: priceNum,
        price_after_disc: priceNum,
        purchase_price: costPriceNum,
        stock_count: stockNum,
      };

      const attempts = [payloadWithExtras, confirmedPayload, payloadMinimal];
      let inserted = null;
      let insErr = null;

      for (const p of attempts) {
        const res = await supabase
          .from(PRODUCTS_TABLE)
          .insert([p])
          .select()
          .maybeSingle();

        if (!res.error && res.data) {
          inserted = res.data;
          insErr = null;
          break;
        }
        insErr = res.error;
      }

      if (insErr && !inserted) {
        throw insErr;
      }

      // توثيق حركة المخزون الافتتاحي في inventory_logs إذا كانت الكمية أكبر من 0
      if (stockNum > 0 && inserted?.id) {
        try {
          await insertInventoryLog({
            storeId: store.id,
            productId: inserted.id,
            barcode: barcodeStr,
            productName: name,
            qtyBefore: 0,
            qtyAfter: stockNum,
            reason: 'initial',
          });
        } catch (logErr) {
          /* جدول inventory_logs اختياري */
        }
      }

      // إضافة الصنف للذاكرة المحلية ليتعرف عليه السكانر فوراً في نفس الجلسة
      const normProduct = inserted
        ? normalizeItemFromSupabase(inserted)
        : {
            id: 'prod-' + Date.now(),
            barcode: barcodeStr || '',
            name: name,
            price: priceNum,
            priceAfterDiscount: priceNum,
            stock: stockNum,
            box: unitVal,
          };

      if (normProduct) {
        setItems((prev) => [normProduct, ...prev]);
      }

      if (isInvOnly) {
        // حالة: إضافة للمخزون فقط بدون إدراج بالفاتورة
        playCashChime();
        toast.success(`✓ تم حفظ الصنف "${name}" في المخزون بنجاح (الكمية: ${stockNum})`);
      } else {
        // حالة مسح باركود جديد: إضافة السطر للفاتورة الحالية مباشرة
        const newLine = {
          id: 'item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          productId: inserted?.id || null,
          barcode: barcodeStr || '—',
          name: name,
          unit: unitVal,
          qty: 1,
          unitPrice: priceNum,
          discount: 0,
          lineTotal: priceNum,
        };

        setOrderItems((prev) => [newLine, ...prev]);
        playScanBeep(true);
        toast.success(`✓ تم تسجيل الصنف وإضافته للفاتورة: ${name}`);
      }

      setNewProductModal(null);
      setNewProductForm(initialNewProductForm);
      setTimeout(() => barcodeInputRef.current?.focus(), 80);
    } catch (err) {
      console.error('Error saving new product:', err);
      toast.error('حدث خطأ أثناء حفظ الصنف: ' + (err.message || ''));
    } finally {
      setSavingNewProduct(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 2.7 إدارة مودال البيع بالآجل / الذمم (اختيار زبون أو إضافة جديد)
  // ─────────────────────────────────────────────────────────────
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerList, setCustomerList] = useState([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [showAddCustomerForm, setShowAddCustomerForm] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({
    name: '',
    phone: '',
    address: '',
    notes: '',
  });
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const customerSearchInputRef = useRef(null);
  const newCustomerNameInputRef = useRef(null);

  // جلب وتصفية الزبائن
  const fetchCustomers = useCallback(
    async (query = '') => {
      if (!store?.id) return;
      setLoadingCustomers(true);
      try {
        let q = supabase
          .from('store_contacts')
          .select('id, name, phone, address, notes, balance, outstanding_amount, debt_amount')
          .eq('store_id', store.id)
          .eq('role', 'customer');

        const trimmed = query.trim();
        if (trimmed) {
          q = q.or(`name.ilike.%${trimmed}%,phone.ilike.%${trimmed}%`);
        } else {
          q = q.order('name', { ascending: true }).limit(30);
        }

        const { data, error } = await q;
        if (error) throw error;
        setCustomerList(data || []);
      } catch (err) {
        console.error('Error fetching customers:', err);
      } finally {
        setLoadingCustomers(false);
      }
    },
    [store?.id]
  );

  const handleOpenCreditModal = () => {
    if (!orderItems.length) {
      toast.warning('الفاتورة فارغة. يرجى مسح باركود أو إضافة أصناف أولاً قبل اختيار البيع بالآجل.');
      return;
    }
    if (!activeShift) {
      toast.error('يجب أن يكون الصندوق مفتوحاً لإتمام عملية البيع.');
      return;
    }
    setCreditModalOpen(true);
    setShowAddCustomerForm(false);
    setCustomerSearchQuery('');
    setNewCustomerForm({ name: '', phone: '', address: '', notes: '' });
    fetchCustomers('');
    setTimeout(() => customerSearchInputRef.current?.focus(), 120);
  };

  const handleCloseCreditModal = () => {
    setCreditModalOpen(false);
    setShowAddCustomerForm(false);
    setTimeout(() => barcodeInputRef.current?.focus(), 60);
  };

  const handleSelectCustomerForCredit = async (customer) => {
    setCreditModalOpen(false);
    await handleExecuteSale('credit', customer);
  };

  const handleCreateCustomerAndCredit = async (e) => {
    if (e) e.preventDefault();
    const name = newCustomerForm.name.trim();
    if (!name) {
      toast.error('يرجى إدخال اسم الزبون');
      newCustomerNameInputRef.current?.focus();
      return;
    }
    setCreatingCustomer(true);
    try {
      const payload = {
        store_id: store.id,
        role: 'customer',
        name: name,
        phone: newCustomerForm.phone.trim() || null,
        address: newCustomerForm.address.trim() || null,
        notes: newCustomerForm.notes.trim() || null,
        outstanding_amount: 0,
        balance: 0,
        debt_amount: 0,
        payment_type: 'credit',
      };

      const { data, error } = await supabase
        .from('store_contacts')
        .insert([payload])
        .select()
        .single();

      if (error) throw error;

      toast.success(`✓ تم إنشاء الزبون: ${name}`);
      setCreditModalOpen(false);
      await handleExecuteSale('credit', data);
    } catch (err) {
      console.error('Error creating customer:', err);
      toast.error('تعذر حفظ الزبون الجديد: ' + (err.message || ''));
    } finally {
      setCreatingCustomer(false);
    }
  };

  // تعديل مباشر لحقول السطر في الجدول (الكمية، السعر، الخصم، الوحدة)
  const updateLineDirect = (lineId, field, value) => {
    setOrderItems((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        const updated = { ...line };

        if (field === 'qty') {
          const val = parseFloat(normalizeDigitsToLatin(value));
          updated.qty = isNaN(val) ? 0 : Math.max(0.001, val);
        } else if (field === 'unitPrice') {
          const val = parseFloat(normalizeDigitsToLatin(value));
          updated.unitPrice = isNaN(val) ? 0 : Math.max(0, val);
        } else if (field === 'discount') {
          const val = parseFloat(normalizeDigitsToLatin(value));
          updated.discount = isNaN(val) ? 0 : Math.max(0, val);
        } else if (field === 'unit' || field === 'name') {
          updated[field] = value;
        }

        updated.lineTotal = roundMoney(
          Math.max(0, updated.qty * updated.unitPrice - (updated.discount || 0))
        );
        return updated;
      })
    );
  };

  const removeLine = (lineId) => {
    setOrderItems((prev) => prev.filter((x) => x.id !== lineId));
    setTimeout(() => barcodeInputRef.current?.focus(), 30);
  };

  const clearInvoice = () => {
    setOrderItems([]);
    setTenderedAmount('');
    setTimeout(() => barcodeInputRef.current?.focus(), 30);
  };

  // ─────────────────────────────────────────────────────────────
  // 4. مودال الأقسام السريعة (خضار، مخبز، بيع بالوزن، يدوي)
  // ─────────────────────────────────────────────────────────────
  const [quickSectionModal, setQuickSectionModal] = useState(null); // { section } | null
  const [quickItemForm, setQuickItemForm] = useState({
    name: '',
    unit: 'كغم',
    qty: '1',
    price: '',
  });

  const openQuickSectionModal = (section) => {
    setQuickSectionModal(section);
    setQuickItemForm({
      name: '',
      unit: section.defaultUnit || 'قطعة',
      qty: '1',
      price: section.defaultPrice ? String(section.defaultPrice) : '',
    });
  };

  const handleConfirmQuickItem = (e) => {
    e.preventDefault();
    const name = quickItemForm.name.trim();
    if (!name) {
      toast.error('يرجى إدخال اسم الصنف');
      return;
    }
    const qty = parseFloat(normalizeDigitsToLatin(quickItemForm.qty)) || 1;
    const price = parseFloat(normalizeDigitsToLatin(quickItemForm.price)) || 0;
    const lineTotal = roundMoney(qty * price);

    const newLine = {
      id: 'quick-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      productId: null,
      barcode: quickSectionModal.label.split(' ')[0] || 'وزن/يدوي',
      name: name,
      unit: quickItemForm.unit || 'قطعة',
      qty: qty,
      unitPrice: price,
      discount: 0,
      lineTotal: lineTotal,
    };

    setOrderItems((prev) => [newLine, ...prev]);
    playScanBeep(true);
    toast.success(`✓ أُضيف: ${name}`);
    setQuickSectionModal(null);
    setTimeout(() => barcodeInputRef.current?.focus(), 30);
  };

  // ─────────────────────────────────────────────────────────────
  // 5. حسابات شريط الإجماليات والمبلغ المدفوع والباقي
  // ─────────────────────────────────────────────────────────────
  const invoiceTotals = useMemo(() => {
    let subtotal = 0;
    let totalDiscount = 0;
    let totalUnits = 0;
    for (const line of orderItems) {
      subtotal += line.qty * line.unitPrice;
      totalDiscount += line.discount || 0;
      totalUnits += line.qty;
    }
    const payable = roundMoney(Math.max(0, subtotal - totalDiscount));
    return {
      subtotal: roundMoney(subtotal),
      totalDiscount: roundMoney(totalDiscount),
      totalUnits: roundMoney(totalUnits),
      payable,
    };
  }, [orderItems]);

  const changeDue = useMemo(() => {
    const paid = parseFloat(normalizeDigitsToLatin(tenderedAmount));
    if (isNaN(paid)) return 0;
    return roundMoney(paid - invoiceTotals.payable);
  }, [tenderedAmount, invoiceTotals.payable]);

  // تعبئة سريعة لفئات النقدية
  const setQuickCash = (amt) => {
    setTenderedAmount(String(amt));
    setTimeout(() => barcodeInputRef.current?.focus(), 30);
  };

  // ─────────────────────────────────────────────────────────────
  // 6. تنفيذ عملية البيع (نقدي / بطاقة / آجل)
  // ─────────────────────────────────────────────────────────────
  const handleExecuteSale = async (paymentMode = 'cash', selectedCustomer = null) => {
    if (isSubmittingSale) return;
    if (!orderItems.length) {
      toast.warning('الفاتورة فارغة. يرجى مسح باركود أو إضافة أصناف أولاً.');
      return;
    }
    if (!store?.id || !activeShift) {
      toast.error('يجب أن يكون الصندوق مفتوحاً لإتمام عملية البيع.');
      return;
    }

    // إذا كان الدفع آجل ولم يُحدد زبون بعد، افتح مودال اختيار الزبون
    if (paymentMode === 'credit' && !selectedCustomer) {
      handleOpenCreditModal();
      return;
    }

    const payable = invoiceTotals.payable;

    // احتساب المدفوع والباقي
    let paidAmt = payable;
    let changeAmt = 0;

    if (paymentMode === 'cash') {
      const tenderedNum = parseFloat(normalizeDigitsToLatin(tenderedAmount));
      if (!isNaN(tenderedNum) && tenderedAmount.trim() !== '') {
        if (tenderedNum < payable) {
          toast.warning(`المبلغ المستلم (${tenderedNum} ₪) أقل من إجمالي الفاتورة (${payable} ₪)`);
          return;
        }
        paidAmt = roundMoney(tenderedNum);
        changeAmt = roundMoney(paidAmt - payable);
      }
    } else if (paymentMode === 'credit') {
      paidAmt = 0;
      changeAmt = 0;
    }

    setIsSubmittingSale(true);
    try {
      // معرف الكاشير الحالي
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const cashierId = user?.id || currentUser?.id || null;

      // أسطر الفاتورة
      const saleLineItems = orderItems.map((o) => ({
        product_id: o.productId && isUuid(o.productId) ? o.productId : null,
        barcode: String(o.barcode || ''),
        name: o.name || '',
        unit: o.unit || 'قطعة',
        qty: Number(o.qty) || 1,
        unit_price: Number(o.unitPrice) || 0,
        discount: Number(o.discount) || 0,
        line_total: Number(o.lineTotal) || 0,
      }));

      const tenderLabel =
        paymentMode === 'credit'
          ? 'آجل / دين'
          : paymentMode === 'visa'
          ? 'بطاقة / فيزا'
          : 'نقدي (كاش)';

      const saleNotes = [
        'نقطة بيع سوبرماركت — فاتورة مباشرة',
        `جلسة الصندوق: [session_id:${activeShift.id}]`,
        cashierId ? `الكاشير: [cashier_id:${cashierId}]` : null,
        selectedCustomer
          ? `الزبون: ${selectedCustomer.name} (${selectedCustomer.phone || 'بدون هاتف'}) [contact_id:${selectedCustomer.id}]`
          : null,
        `طريقة الدفع: ${tenderLabel}`,
        `المجموع: ${payable} ₪`,
        paymentMode === 'credit'
          ? `المبلغ المستحق على الزبون كدين: ${payable} ₪`
          : `المدفوع: ${paidAmt} ₪`,
        paymentMode !== 'credit' ? `الباقي: ${changeAmt} ₪` : null,
        `عدد البنود: ${orderItems.length}`,
      ]
        .filter(Boolean)
        .join('\n');

      const basePayload = {
        store_id: store.id,
        total_amount: payable,
        payment_mode: paymentMode === 'credit' ? 'credit' : paymentMode === 'visa' ? 'visa' : 'cash',
        payment_method: paymentMode === 'credit' ? 'deferred' : paymentMode === 'visa' ? 'card' : 'cash',
        contact_id: selectedCustomer?.id || null,
        notes: saleNotes,
        line_items: saleLineItems,
      };

      // تجربة الحفظ مع status: 'confirmed' (القيمة المعتمدة للمبيعات المكتملة)
      // مع الرجوع التدريجي لنفس صيغة صفحة /pos الأصلية
      const variants = [
        {
          ...basePayload,
          session_id: activeShift.id,
          cashier_id: cashierId,
          paid_amount: paidAmt,
          change_amount: changeAmt,
          status: 'confirmed',
          order_status: 'confirmed',
        },
        {
          ...basePayload,
          session_id: activeShift.id,
          cashier_id: cashierId,
          status: 'confirmed',
        },
        {
          ...basePayload,
          status: 'confirmed',
        },
        // صيغة POS الأصلية (بدون إرسال عمود status نهائياً)
        {
          ...basePayload,
        },
        {
          store_id: store.id,
          total_amount: payable,
          payment_mode: paymentMode === 'credit' ? 'credit' : paymentMode === 'visa' ? 'visa' : 'cash',
          payment_method: paymentMode === 'credit' ? 'deferred' : paymentMode === 'visa' ? 'card' : 'cash',
          contact_id: selectedCustomer?.id || null,
          notes: saleNotes,
          line_items: saleLineItems,
        },
      ];

      let saleRow = null;
      let lastErr = null;
      for (const variant of variants) {
        const { data, error } = await supabase
          .from('sales')
          .insert([variant])
          .select('id, created_at')
          .maybeSingle();

        if (!error && data?.id) {
          saleRow = data;
          lastErr = null;
          break;
        }
        lastErr = error;
      }

      if (!saleRow?.id) {
        throw lastErr || new Error('فشل حفظ الفاتورة في قاعدة البيانات');
      }

      // إدراج بنود الفاتورة في sales_items إن وُجد
      try {
        const itemRows = saleLineItems.map((l) => ({
          sale_id: saleRow.id,
          store_id: store.id,
          product_id: l.product_id,
          barcode: l.barcode,
          qty: l.qty,
          unit_price: l.unit_price,
          line_total: l.line_total,
        }));
        await supabase.from('sales_items').insert(itemRows);
      } catch (err) {
        /* sales_items جدول اختياري */
      }

      // خصم المخزون للأصناف المرتبطة بمنتج في قاعدة البيانات
      for (const line of orderItems) {
        if (line.productId && isUuid(line.productId)) {
          supabase.rpc('decrement_stock', {
            row_id: line.productId,
            amount: Math.ceil(Number(line.qty) || 1),
          }).catch(() => {});
        }
      }

      // ربط محاسبي لصندوق كاش المتجر إذا كان الدفع نقدي
      if (paymentMode === 'cash') {
        try {
          await applyCashSaleToMainCashFund(supabase, {
            storeId: store.id,
            saleId: saleRow.id,
            totalAmount: payable,
            sourceLabel: 'سوبرماركت POS',
          });
        } catch (fundErr) {
          console.warn('Cash fund sync:', fundErr);
        }
      }

      // في حالة البيع الآجل: تحديث رصيد دين الزبون وتسجيل الحركة في customer_ledger
      if (paymentMode === 'credit' && selectedCustomer?.id) {
        try {
          const { data: cRow } = await supabase
            .from('store_contacts')
            .select('outstanding_amount, balance')
            .eq('id', selectedCustomer.id)
            .eq('store_id', store.id)
            .maybeSingle();

          const curOut = Number(cRow?.outstanding_amount ?? selectedCustomer.outstanding_amount ?? 0);
          const curBal = Number(cRow?.balance ?? selectedCustomer.balance ?? 0);
          const nextOut = roundMoney(Math.max(0, curOut) + payable);
          const nextBal = roundMoney(curBal + payable);

          await supabase
            .from('store_contacts')
            .update({
              outstanding_amount: nextOut,
              balance: nextBal,
              debt_amount: nextOut,
              payment_type: 'credit',
            })
            .eq('id', selectedCustomer.id)
            .eq('store_id', store.id);
        } catch (cErr) {
          console.error('Error updating customer debt:', cErr);
        }

        try {
          await supabase.from('customer_ledger').insert([
            {
              store_id: store.id,
              customer_id: selectedCustomer.id,
              sale_id: saleRow.id,
              debit: payable,
              credit: 0,
              description: `فاتورة سوبرماركت آجل #${String(saleRow.id).slice(0, 8).toUpperCase()}`,
            },
          ]);
        } catch (ledgerErr) {
          console.warn('Customer ledger insert:', ledgerErr);
        }
      }

      // تشغيل الصوت التفاعلي وإظهار toast النجاح فوراً
      playCashChime();
      const invoiceRef = saleRow.id ? `#${saleRow.id.slice(0, 8).toUpperCase()}` : '';
      if (paymentMode === 'credit' && selectedCustomer) {
        toast.success(`✓ تم حفظ الفاتورة بالآجل ${invoiceRef} بنجاح للزبون: ${selectedCustomer.name} (${payable} ₪)`);
      } else {
        toast.success(`تم حفظ الفاتورة ${invoiceRef} بنجاح بقيمة ${payable} ₪ (${tenderLabel})`);
      }

      // حفظ بيانات آخر فاتورة للطباعة السريعة الاختيارية
      setLastReceiptData({
        storeName: store.name,
        invoiceId: invoiceRef,
        customerName: selectedCustomer ? selectedCustomer.name : null,
        lines: orderItems.map((o) => ({
          name: o.name,
          qty: o.qty,
          unit: o.unit,
          unitPrice: o.unitPrice,
          lineTotal: o.lineTotal,
        })),
        total: payable,
        paid: paidAmt,
        change: changeAmt,
        tenderLabel: tenderLabel,
        printedAtLabel: new Date().toLocaleTimeString('ar-EG', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      });

      // تفريغ السلة/الجدول بالكامل بعد نجاح الحفظ
      clearInvoice();

      // إعادة التركيز لحقل الباركود فوراً لمسح الزبون التالي
      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 80);
    } catch (err) {
      console.error('Error submitting sale:', err);
      toast.error(
        'حدث خطأ أثناء حفظ الفاتورة: ' +
          (err.message || 'تعذر الاتصال بالخادم') +
          '. تم الحفاظ على السلة دون فقدان البيانات.'
      );
    } finally {
      setIsSubmittingSale(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 7. التركيز الدائم الذكي واختصارات لوحة المفاتيح
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeShift) return;
    const t = setTimeout(() => barcodeInputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, [activeShift]);

  useEffect(() => {
    const handleGlobalClick = (e) => {
      if (
        !activeShift ||
        closeShiftModalOpen ||
        quickSectionModal ||
        newProductModal ||
        creditModalOpen
      )
        return;
      const target = e.target;
      if (!target) return;
      const interactive = target.closest(
        'input, textarea, select, button, a, [role="dialog"], [role="button"], [contenteditable="true"]'
      );
      if (interactive) return;
      barcodeInputRef.current?.focus();
    };
    document.addEventListener('click', handleGlobalClick);
    return () => document.removeEventListener('click', handleGlobalClick);
  }, [activeShift, closeShiftModalOpen, quickSectionModal, newProductModal, creditModalOpen]);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (creditModalOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          handleCloseCreditModal();
        }
        return;
      }

      if (newProductModal) {
        if (e.key === 'Escape') {
          e.preventDefault();
          handleCancelNewProduct();
        }
        return;
      }

      if (!activeShift || closeShiftModalOpen || quickSectionModal) return;

      // اختصارات F1 نقدي، F2 بطاقة، F3 آجل
      if (e.key === 'F1') {
        e.preventDefault();
        handleExecuteSale('cash');
        return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        handleExecuteSale('visa');
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        handleOpenCreditModal();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (['Escape', 'Tab', 'CapsLock', 'Shift', 'Control', 'Alt'].includes(e.key)) return;
      if (e.key.startsWith('F') && e.key.length > 1) return;

      const activeEl = document.activeElement;
      const isOtherInput =
        activeEl &&
        activeEl !== barcodeInputRef.current &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName);

      if (!isOtherInput && barcodeInputRef.current && activeEl !== barcodeInputRef.current) {
        barcodeInputRef.current.focus();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    activeShift,
    closeShiftModalOpen,
    quickSectionModal,
    newProductModal,
    creditModalOpen,
    invoiceTotals.payable,
    orderItems,
  ]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ─────────────────────────────────────────────────────────────
  // 8. الرندرة وحالة فحص الشيفت
  // ─────────────────────────────────────────────────────────────
  if (checkingShift) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-white font-arabic" dir="rtl">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center animate-pulse shadow-lg shadow-indigo-500/25">
            <Store size={26} className="text-white" />
          </div>
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">جاري التحقق من جلسة الصندوق...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-screen overflow-hidden bg-slate-100 dark:bg-slate-950 font-arabic text-slate-900 dark:text-slate-100"
      dir="rtl"
      style={{ fontFamily: 'Cairo, Tajawal, ui-sans-serif, system-ui' }}
    >
      {/* السايدبار الرئيسي */}
      <Sidebar collapsible collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} />

      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
        {/* ── شريط الرأس العلوي الثابت مع حقل الباركود الدائم التركيز ── */}
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 dark:border-white/10 bg-white/90 dark:bg-slate-900/80 px-4 backdrop-blur-xl transition-colors">
          {/* يمين: شعار ونوع نقطة البيع */}
          <div className="flex items-center gap-3 shrink-0">
            {sidebarCollapsed && (
              <button
                type="button"
                onClick={toggleSidebar}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-indigo-300 hover:bg-slate-100 dark:hover:bg-white/10 transition"
                title="إظهار القائمة"
              >
                <Menu size={20} />
              </button>
            )}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/20">
              <Store size={22} />
            </div>
            <div className="hidden sm:block">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-black text-slate-900 dark:text-white">كاشير سوبرماركت</h1>
                <span className="rounded-full bg-emerald-500/10 dark:bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                  سريع
                </span>
              </div>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{store?.name || 'المتجر'}</p>
            </div>
          </div>

          {/* منتصف: حقل إدخال الباركود فائق السرعة والدائم التركيز */}
          <div ref={searchContainerRef} className="relative flex-1 max-w-2xl mx-2 md:mx-6">
            <form onSubmit={handleBarcodeSubmit} className="relative w-full">
              <div className="relative flex items-center">
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none text-indigo-500 dark:text-indigo-400">
                  <ScanLine size={20} className="animate-pulse" />
                  <span className="h-4 w-px bg-slate-300 dark:bg-slate-700 hidden sm:inline-block" />
                  <Search size={16} className="text-slate-400 dark:text-slate-500 hidden sm:inline-block" />
                </div>

                <input
                  ref={barcodeInputRef}
                  type="text"
                  value={search}
                  disabled={!activeShift}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSearch(val);
                    if (val.trim()) {
                      setIsDropdownOpen(true);
                      setActiveDropdownIndex(-1);
                    } else {
                      setIsDropdownOpen(false);
                      setActiveDropdownIndex(-1);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      if (!isDropdownOpen) setIsDropdownOpen(true);
                      else if (partialMatches.length > 0) {
                        setActiveDropdownIndex((prev) =>
                          prev < partialMatches.length - 1 ? prev + 1 : 0
                        );
                      }
                      return;
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      if (isDropdownOpen && partialMatches.length > 0) {
                        setActiveDropdownIndex((prev) =>
                          prev > 0 ? prev - 1 : partialMatches.length - 1
                        );
                      }
                      return;
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setIsDropdownOpen(false);
                      return;
                    }
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleBarcodeSubmit(e);
                      return;
                    }
                  }}
                  placeholder="امسح الباركود بالسكانر أو اكتب للبحث السريع (دايماً بالفوكس)..."
                  className="w-full h-11 rounded-2xl border border-indigo-500/30 bg-slate-50 dark:bg-slate-900/90 pr-12 pl-24 text-sm font-medium text-slate-900 dark:text-white shadow-inner backdrop-blur-md transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-4 focus:ring-indigo-500/20"
                  autoComplete="off"
                  spellCheck="false"
                />

                <div className="absolute left-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                  {search ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch('');
                        setIsDropdownOpen(false);
                        barcodeInputRef.current?.focus();
                      }}
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white transition"
                    >
                      <X size={15} />
                    </button>
                  ) : null}
                  <span className="hidden sm:inline-flex items-center gap-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800/60 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                    السكانر جاهز
                  </span>
                </div>
              </div>
            </form>

            {/* قائمة نتائج البحث الجزئي بالاسم */}
            {isDropdownOpen && search.trim() && (
              <div className="absolute top-full right-0 left-0 mt-2 z-50 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white/95 dark:bg-slate-900/95 shadow-2xl backdrop-blur-2xl transition-colors">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/60">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {partialMatches.length > 0
                      ? `نتائج البحث (${partialMatches.length})`
                      : 'لا توجد نتائج مطابقة'}
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">اضغط Enter أو انقر للإضافة</span>
                </div>

                <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
                  {partialMatches.length > 0 ? (
                    partialMatches.map((item, idx) => {
                      const isSelected = idx === activeDropdownIndex;
                      const price = item.priceAfterDiscount ?? item.price ?? 0;
                      return (
                        <div
                          key={item.id || idx}
                          onClick={() => addOrIncrementProduct(item, 1)}
                          onMouseEnter={() => setActiveDropdownIndex(idx)}
                          className={`group flex items-center justify-between gap-3 px-4 py-3 cursor-pointer transition ${
                            isSelected
                              ? 'bg-indigo-50 dark:bg-indigo-950/70 border-r-4 border-indigo-500'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-300">
                              {item.name}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-400 mt-0.5">
                              {item.barcode && (
                                <span className="font-mono text-[11px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300">
                                  {item.barcode}
                                </span>
                              )}
                              {item.reference && (
                                <span className="truncate text-[11px] text-slate-400 dark:text-slate-500">
                                  {item.reference}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 text-left">
                            <span className="text-sm font-bold text-indigo-600 dark:text-indigo-300 font-mono">
                              {roundMoney(price)} ₪
                            </span>
                            <button
                              type="button"
                              className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition shadow-sm"
                            >
                              <Plus size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-5 text-center text-slate-500 dark:text-slate-400 text-xs">
                      لم يتم العثور على صنف مطابق بالاسم أو الباركود
                    </div>
                  )}
                </div>

                {/* خيار سريع لتسجيل هذا الباركود/النص كمنتج جديد */}
                <div className="border-t border-slate-100 dark:border-slate-800 p-2 bg-slate-50/80 dark:bg-slate-950/60">
                  <button
                    type="button"
                    onClick={() => openNewProductModal(search)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-xs font-bold hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition"
                  >
                    <PackagePlus size={14} />
                    <span>تسجيل «{search.trim()}» كمنتج جديد في المخزون</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* يسار: تفاصيل الشيفت، زر المظهر (داكن/فاتح)، إغلاق الصندوق والتكبير */}
          <div className="flex items-center gap-2 shrink-0">
            {activeShift ? (
              <div className="hidden xl:flex items-center gap-2 rounded-xl bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/60 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300">
                <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>الافتتاحي: <strong className="font-mono font-bold text-slate-900 dark:text-white">{activeShift.opening_amount} ₪</strong></span>
              </div>
            ) : null}

            {lastReceiptData && (
              <button
                type="button"
                onClick={() => setSimpleReceiptPrint(lastReceiptData)}
                className="flex items-center gap-1.5 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 px-3 py-2 text-xs font-bold text-indigo-700 dark:text-indigo-300 shadow-sm transition"
                title="عرض وطباعة آخر وصل بيع"
              >
                <Printer size={15} className="text-indigo-600 dark:text-indigo-400" />
                <span className="hidden md:inline">وصل {lastReceiptData.invoiceId}</span>
              </button>
            )}

            {activeShift ? (
              <button
                type="button"
                onClick={openCloseShiftModal}
                className="flex items-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 px-3 py-2 text-xs font-bold text-rose-700 dark:text-rose-300 shadow-sm transition"
                title="إغلاق الصندوق وإنهاء الشيفت"
              >
                <Lock size={15} className="text-rose-600 dark:text-rose-400" />
                <span className="hidden sm:inline">إغلاق الصندوق</span>
              </button>
            ) : null}

            {/* ── زر التبديل بين الوضع الليلي والنهاري (شمس/قمر) ── */}
            <button
              type="button"
              onClick={() => applyExplicitTheme(isDark ? 'light' : 'dark')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-amber-300 hover:bg-slate-100 dark:hover:bg-white/10 shadow-sm transition"
              title={isDark ? 'التبديل إلى الوضع الفاتح (Light Mode)' : 'التبديل إلى الوضع الداكن (Dark Mode)'}
            >
              {isDark ? (
                <Sun size={18} className="text-amber-400" />
              ) : (
                <Moon size={18} className="text-indigo-600" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
                else document.exitFullscreen?.();
              }}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white transition"
              title="ملء الشاشة"
            >
              <Maximize2 size={16} />
            </button>
          </div>
        </header>

        {/* ── شريط الأقسام السريعة وزر إضافة صنف للمخزون ── */}
        <div className="shrink-0 border-b border-slate-200 dark:border-white/10 bg-white/70 dark:bg-slate-900/60 px-4 py-2 overflow-x-auto flex items-center justify-between gap-3 transition-colors">
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0 ml-1">أقسام سريعة:</span>
            {QUICK_SECTIONS.map((sec) => (
              <button
                key={sec.id}
                type="button"
                onClick={() => openQuickSectionModal(sec)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700/70 bg-slate-100 dark:bg-slate-800/80 hover:bg-indigo-50 dark:hover:bg-indigo-600/30 hover:border-indigo-400 dark:hover:border-indigo-500/50 px-3.5 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 transition shrink-0 shadow-sm"
              >
                <span>{sec.label}</span>
              </button>
            ))}
          </div>

          {/* زر ثابت لإضافة صنف جديد للمخزون */}
          <button
            type="button"
            onClick={openNewProductForInventoryOnly}
            className="flex items-center gap-1.5 rounded-xl border border-indigo-300 dark:border-indigo-500/50 bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-950/60 dark:to-violet-950/60 hover:from-indigo-100 hover:to-violet-100 dark:hover:from-indigo-900/70 dark:hover:to-violet-900/70 text-indigo-700 dark:text-indigo-300 px-3.5 py-1.5 text-xs font-black transition shrink-0 shadow-sm"
            title="إضافة صنف جديد إلى المخزون (بدون إضافته للفاتورة الحالية)"
          >
            <PackagePlus size={16} className="text-indigo-600 dark:text-indigo-400" />
            <span>إضافة صنف للمخزون 📦+</span>
          </button>
        </div>

        {/* ── تخطيط الشاشة الرئيسي: جدول الفاتورة (معظم المساحة) + شريط الإجماليات ── */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* 1. جدول بنود الفاتورة المباشر (Full Screen Direct Items Table) */}
          <section className="flex flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-slate-950 p-4 transition-colors">
            <div className="flex items-center justify-between pb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black text-slate-900 dark:text-white">فاتورة البيع الحالية</h2>
                <span className="rounded-full bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-mono text-xs px-2 py-0.5 font-bold border border-indigo-200 dark:border-indigo-500/30">
                  {orderItems.length} صنف ({invoiceTotals.totalUnits} قطعة/وحدة)
                </span>
              </div>
              {orderItems.length > 0 && (
                <button
                  type="button"
                  onClick={clearInvoice}
                  className="flex items-center gap-1 text-xs font-bold text-rose-600 dark:text-rose-400 hover:text-rose-500 transition"
                >
                  <Trash2 size={14} />
                  <span>تفريغ الفاتورة</span>
                </button>
              )}
            </div>

            {/* الحاوية الجدولية */}
            <div className="flex-1 overflow-y-auto rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/50 shadow-sm transition-colors">
              {orderItems.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center p-12 text-center text-slate-400 dark:text-slate-500">
                  <div className="h-20 w-20 rounded-3xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4 animate-pulse">
                    <ScanLine size={40} />
                  </div>
                  <h3 className="text-base font-bold text-slate-700 dark:text-slate-300">الفاتورة فارغة وجاهزة للمسح</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-500 max-w-sm">
                    امسح باركود أي منتج مباشرة بالسكانر، أو اختر من الأقسام السريعة بالأعلى (خضار، مخبز، بيع بالوزن).
                  </p>
                </div>
              ) : (
                <table className="w-full text-right text-xs border-collapse table-fixed">
                  <thead className="sticky top-0 z-10 border-b border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 font-bold uppercase backdrop-blur-sm">
                    <tr>
                      <th className="py-2.5 px-1.5 w-10 text-center">#</th>
                      <th className="py-2.5 px-2 w-28">الباركود</th>
                      <th className="py-2.5 px-3">اسم المنتج</th>
                      <th className="py-2.5 px-1 w-20 text-center">الوحدة</th>
                      <th className="py-2.5 px-1 w-28 text-center">الكمية</th>
                      <th className="py-2.5 px-1 w-20 text-center">السعر</th>
                      <th className="py-2.5 px-1 w-16 text-center">الخصم</th>
                      <th className="py-2.5 px-2 w-24 text-left font-black text-slate-800 dark:text-slate-200">الإجمالي</th>
                      <th className="py-2.5 px-1 w-10 text-center">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {orderItems.map((line, idx) => (
                      <tr
                        key={line.id}
                        className="hover:bg-indigo-50/70 dark:hover:bg-indigo-950/30 transition group"
                      >
                        {/* تسلسل */}
                        <td className="py-2.5 px-1.5 w-10 text-center font-mono text-slate-400 dark:text-slate-500 font-bold text-[11px]">
                          {orderItems.length - idx}
                        </td>

                        {/* كود الصنف / الباركود */}
                        <td className="py-2.5 px-2 w-28">
                          <span
                            className="block font-mono text-[11px] bg-slate-100 dark:bg-slate-800/80 px-1.5 py-0.5 rounded text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700/60 truncate"
                            title={line.barcode}
                          >
                            {line.barcode}
                          </span>
                        </td>

                        {/* اسم المنتج (المساحة الأكبر + يقص بـ ellipsis مع تعديل مباشر) */}
                        <td className="py-2.5 px-3 max-w-0">
                          <input
                            type="text"
                            value={line.name}
                            title={line.name}
                            onChange={(e) => updateLineDirect(line.id, 'name', e.target.value)}
                            className="w-full bg-transparent font-bold text-slate-800 dark:text-slate-100 text-sm truncate focus:bg-slate-100 dark:focus:bg-slate-800/80 focus:px-2 focus:py-1 rounded-lg outline-none transition"
                          />
                        </td>

                        {/* الوحدة */}
                        <td className="py-2.5 px-1 w-20 text-center">
                          <select
                            value={line.unit}
                            onChange={(e) => updateLineDirect(line.id, 'unit', e.target.value)}
                            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/90 px-1 py-1 text-xs font-bold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-indigo-500 text-center"
                          >
                            <option value="قطعة">قطعة</option>
                            <option value="كرتونة">كرتونة</option>
                            <option value="كغم">كغم</option>
                            <option value="غرام">غرام</option>
                            <option value="لتر">لتر</option>
                            <option value="علبة">علبة</option>
                            <option value="باكيت">باكيت</option>
                          </select>
                        </td>

                        {/* الكمية (تعديل مباشر + أزرار زيادة ونقصان) */}
                        <td className="py-2.5 px-1 w-28 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => updateLineDirect(line.id, 'qty', Math.max(0.001, line.qty - 1))}
                              className="h-6 w-6 shrink-0 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition"
                            >
                              <Minus size={11} />
                            </button>
                            <input
                              type="number"
                              step="any"
                              min="0.001"
                              value={line.qty}
                              onChange={(e) => updateLineDirect(line.id, 'qty', e.target.value)}
                              className="w-12 h-6 text-center font-mono font-bold text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                              dir="ltr"
                            />
                            <button
                              type="button"
                              onClick={() => updateLineDirect(line.id, 'qty', line.qty + 1)}
                              className="h-6 w-6 shrink-0 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition"
                            >
                              <Plus size={11} />
                            </button>
                          </div>
                        </td>

                        {/* السعر الفردي (تعديل مباشر) */}
                        <td className="py-2.5 px-1 w-20 text-center">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={line.unitPrice}
                            onChange={(e) => updateLineDirect(line.id, 'unitPrice', e.target.value)}
                            className="w-16 h-6 text-center font-mono font-bold text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-indigo-600 dark:text-indigo-300 focus:border-indigo-500 focus:outline-none mx-auto block"
                            dir="ltr"
                          />
                        </td>

                        {/* الخصم (تعديل مباشر) */}
                        <td className="py-2.5 px-1 w-16 text-center">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={line.discount}
                            onChange={(e) => updateLineDirect(line.id, 'discount', e.target.value)}
                            className="w-14 h-6 text-center font-mono font-bold text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-rose-600 dark:text-rose-400 focus:border-rose-500 focus:outline-none mx-auto block"
                            dir="ltr"
                          />
                        </td>

                        {/* الإجمالي */}
                        <td className="py-2.5 px-2 w-24 text-left font-mono text-sm font-black text-emerald-600 dark:text-emerald-400 truncate">
                          {roundMoney(line.lineTotal)} ₪
                        </td>

                        {/* حذف */}
                        <td className="py-2.5 px-1 w-10 text-center">
                          <button
                            type="button"
                            onClick={() => removeLine(line.id)}
                            className="rounded-lg p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                            title="حذف السطر"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* 2. شريط الإجماليات والدفع السريع (Prominent Totals & Checkout Sidebar) */}
          <section className="flex w-[380px] shrink-0 flex-col border-r border-slate-200 dark:border-white/10 bg-white/95 dark:bg-slate-900/80 backdrop-blur-xl p-5 justify-between transition-colors">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-3">
                <h3 className="text-sm font-black text-slate-900 dark:text-white">إجماليات الفاتورة والدفع</h3>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                  {orderItems.length} بنود
                </span>
              </div>

              {/* تفاصيل المجموع والخصم */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 space-y-2 text-xs">
                <div className="flex justify-between text-slate-500 dark:text-slate-400">
                  <span>المجموع الفرعي:</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{invoiceTotals.subtotal} ₪</span>
                </div>
                {invoiceTotals.totalDiscount > 0 && (
                  <div className="flex justify-between text-rose-600 dark:text-rose-400">
                    <span>إجمالي الخصم:</span>
                    <span className="font-mono font-bold">-{invoiceTotals.totalDiscount} ₪</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-500 dark:text-slate-400">
                  <span>الكمية الإجمالية:</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{invoiceTotals.totalUnits}</span>
                </div>
              </div>

              {/* ── المبلغ المطلوب سداده (خط عريض وبارز جداً) ── */}
              <div className="rounded-3xl border-2 border-indigo-500/40 bg-gradient-to-br from-indigo-50 via-white to-slate-50 dark:from-indigo-950/60 dark:via-slate-900 dark:to-slate-950 p-5 shadow-lg dark:shadow-2xl text-center">
                <span className="block text-xs font-bold text-indigo-600 dark:text-indigo-300 mb-1 uppercase tracking-wider">
                  المبلغ المطلوب سداده
                </span>
                <div className="text-4xl font-black text-emerald-600 dark:text-emerald-400 font-mono tracking-tight">
                  {invoiceTotals.payable} <span className="text-2xl font-bold text-emerald-500">₪</span>
                </div>
              </div>

              {/* ── المبلغ المدفوع من الزبون (Input يدخله الكاشير) ── */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  المبلغ المدفوع كاش (استلام من الزبون):
                </label>
                <div className="relative">
                  <Coins className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={tenderedAmount}
                    onChange={(e) => setTenderedAmount(e.target.value)}
                    placeholder={String(invoiceTotals.payable)}
                    className="w-full h-12 rounded-2xl border-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pr-11 pl-4 text-xl font-mono font-black text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                    dir="ltr"
                  />
                </div>

                {/* أزرار الفئات النقدية السريعة */}
                <div className="grid grid-cols-4 gap-1.5 mt-2">
                  <button
                    type="button"
                    onClick={() => setQuickCash(invoiceTotals.payable)}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                  >
                    بالضبط
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuickCash(50)}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                  >
                    50 ₪
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuickCash(100)}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                  >
                    100 ₪
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuickCash(200)}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                  >
                    200 ₪
                  </button>
                </div>
              </div>

              {/* ── الباقي للزبون (يُحسب تلقائياً) ── */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">الباقي للزبون:</span>
                  <span
                    className={`text-2xl font-black font-mono ${
                      changeDue >= 0 ? 'text-teal-600 dark:text-cyan-400' : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {changeDue >= 0 ? `${changeDue} ₪` : `متبقي: ${Math.abs(changeDue)} ₪`}
                  </span>
                </div>
              </div>
            </div>

            {/* ── أزرار الدفع الكبيرة (F1 نقدي / F2 بطاقة / F3 آجل) ── */}
            <div className="space-y-2 pt-4 border-t border-slate-200 dark:border-white/10">
              <div className="grid grid-cols-3 gap-2">
                {/* زر نقدي كاش */}
                <button
                  type="button"
                  disabled={!orderItems.length || isSubmittingSale}
                  onClick={() => handleExecuteSale('cash')}
                  className="h-14 flex flex-col items-center justify-center rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black shadow-lg shadow-emerald-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed px-1 text-center"
                >
                  <div className="flex items-center gap-1 text-sm sm:text-base">
                    <DollarSign size={18} />
                    <span>نقدي 💵</span>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-100">F1 / Enter</span>
                </button>

                {/* زر بطاقة / فيزا */}
                <button
                  type="button"
                  disabled={!orderItems.length || isSubmittingSale}
                  onClick={() => handleExecuteSale('visa')}
                  className="h-14 flex flex-col items-center justify-center rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-black shadow-lg shadow-indigo-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed px-1 text-center"
                >
                  <div className="flex items-center gap-1 text-sm sm:text-base">
                    <CreditCard size={18} />
                    <span>بطاقة 💳</span>
                  </div>
                  <span className="text-[10px] font-bold text-indigo-100">F2</span>
                </button>

                {/* زر آجل / دين */}
                <button
                  type="button"
                  disabled={!orderItems.length || isSubmittingSale}
                  onClick={handleOpenCreditModal}
                  className="h-14 flex flex-col items-center justify-center rounded-2xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-black shadow-lg shadow-amber-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed px-1 text-center"
                >
                  <div className="flex items-center gap-1 text-sm sm:text-base">
                    <User size={18} />
                    <span>آجل 👤</span>
                  </div>
                  <span className="text-[10px] font-bold text-amber-100">F3</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* ─────────────────────────────────────────────────────────────
          مودال 1: فتح الصندوق وبدء الشيفت (إلزامي ولا يمكن تجاوزه)
      ───────────────────────────────────────────────────────────── */}
      {activeShift === false && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 dark:bg-slate-950/90 backdrop-blur-xl p-4">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 dark:border-indigo-500/30 bg-white dark:bg-slate-900 shadow-2xl p-6 text-right transition-colors">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white shadow-xl shadow-indigo-500/30 mb-4 mx-auto">
              <Unlock size={28} />
            </div>

            <h2 className="text-center text-xl font-black text-slate-900 dark:text-white">فتح الصندوق — بدء الشيفت</h2>
            <p className="mt-1 text-center text-xs text-slate-500 dark:text-slate-400">
              يرجى إدخال الرصيد الافتتاحي في درج الكاش للبدء بعمليات البيع
            </p>

            <form onSubmit={handleOpenShift} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  المبلغ الافتتاحي في الصندوق (شيكل) *
                </label>
                <div className="relative">
                  <Coins className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    autoFocus
                    value={openingAmountInput}
                    onChange={(e) => setOpeningAmountInput(e.target.value)}
                    placeholder="مثال: 200"
                    className="w-full rounded-xl border border-slate-300 dark:border-indigo-500/40 bg-slate-50 dark:bg-slate-950 pr-10 pl-4 py-3 text-base font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/20"
                    dir="ltr"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  ملاحظات الافتتاح (اختياري)
                </label>
                <textarea
                  rows={2}
                  value={openingNotes}
                  onChange={(e) => setOpeningNotes(e.target.value)}
                  placeholder="أي ملاحظات حول عهدة الكاشير أو حالة الدرج..."
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-medium text-slate-900 dark:text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="pt-2 space-y-2.5">
                <button
                  type="submit"
                  disabled={submittingOpenShift}
                  className="w-full h-12 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-sm shadow-xl shadow-indigo-500/30 transition disabled:opacity-50"
                >
                  <Unlock size={18} />
                  <span>{submittingOpenShift ? 'جاري الفتح...' : 'بدء الشيفت وفتح الصندوق 🚀'}</span>
                </button>

                <div className="flex items-center gap-2 pt-1 border-t border-slate-200 dark:border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => navigate('/pos-classic')}
                    className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-slate-100 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-700 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 transition"
                  >
                    نقطة البيع الكلاسيكية (/pos-classic)
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/overview')}
                    className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-slate-100 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-700 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 transition"
                  >
                    لوحة التحكم الرئيسية
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          مودال 2: إغلاق الصندوق وإنهاء الشيفت
      ───────────────────────────────────────────────────────────── */}
      {closeShiftModalOpen && activeShift && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 dark:bg-slate-950/80 backdrop-blur-md p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-6 text-right text-slate-900 dark:text-white transition-colors">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400">
                  <Lock size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">إغلاق الصندوق وإنهاء الشيفت</h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    بدأ في: {new Date(activeShift.opened_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCloseShiftModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {loadingSummary ? (
              <div className="py-10 text-center text-slate-500 dark:text-slate-400">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent mx-auto mb-2" />
                <p className="text-xs">جاري حساب مبيعات الشيفت...</p>
              </div>
            ) : (
              <form onSubmit={handleConfirmCloseShift} className="space-y-4">
                {/* ملخص المبالغ المحسوبة تلقائياً */}
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 p-4 space-y-3 text-xs">
                  <div className="flex justify-between items-center text-slate-700 dark:text-slate-300">
                    <span className="flex items-center gap-1.5 font-bold">
                      <span>المبلغ الافتتاحي (عهدة البداية):</span>
                      <span className="text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 py-0.5 rounded font-normal">للقراءة فقط</span>
                    </span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white text-sm">{activeShift.opening_amount} ₪</span>
                  </div>

                  <div className="flex justify-between items-center text-emerald-600 dark:text-emerald-400">
                    <span className="flex items-center gap-1.5 font-bold">
                      <DollarSign size={14} />
                      <span>مجموع مبيعات الكاش بالشيفت:</span>
                    </span>
                    <span className="font-mono font-bold text-sm">+{shiftSummary.cashSales} ₪</span>
                  </div>

                  <div className="flex justify-between items-center text-indigo-600 dark:text-indigo-400">
                    <span className="flex items-center gap-1.5 font-bold">
                      <CreditCard size={14} />
                      <span>مجموع مبيعات البطاقة بالشيفت:</span>
                    </span>
                    <span className="font-mono font-bold text-sm">{shiftSummary.cardSales} ₪</span>
                  </div>

                  <div className="flex justify-between items-center text-amber-600 dark:text-amber-400">
                    <span className="flex items-center gap-1.5 font-bold">
                      <User size={14} />
                      <span>مجموع مبيعات الآجل (ذمم):</span>
                    </span>
                    <span className="font-mono font-bold text-sm">{shiftSummary.creditSales || 0} ₪</span>
                  </div>

                  <div className="flex justify-between items-baseline pt-2.5 border-t border-slate-200 dark:border-slate-800 text-sm">
                    <div>
                      <span className="font-bold text-slate-900 dark:text-white block">المبلغ المتوقع بالصندوق (الكاش):</span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">يساوي (الافتتاحي + مجموع الكاش)</span>
                    </div>
                    <span className="font-mono text-xl font-black text-amber-600 dark:text-amber-300">
                      {shiftSummary.expectedAmount} ₪
                    </span>
                  </div>
                </div>

                {/* إدخال المبلغ الفعلي بالصندوق */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                    المبلغ الفعلي الموجود بالصندوق حالياً (العد اليدوي) *
                  </label>
                  <div className="relative">
                    <Coins className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      type="number"
                      step="any"
                      min="0"
                      required
                      autoFocus
                      value={closingAmountInput}
                      onChange={(e) => setClosingAmountInput(e.target.value)}
                      placeholder="أدخل ناتج عد النقود بالدرج..."
                      className="w-full rounded-xl border border-slate-300 dark:border-indigo-500/40 bg-slate-50 dark:bg-slate-950 pr-10 pl-4 py-2.5 text-sm font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                      dir="ltr"
                    />
                  </div>
                </div>

                {/* عرض الفارق اللحظي (عجز / زيادة / تطابق) */}
                {closingAmountInput !== '' && !isNaN(parseFloat(closingAmountInput)) && (
                  (() => {
                    const act = parseFloat(normalizeDigitsToLatin(closingAmountInput));
                    const diff = roundMoney(act - shiftSummary.expectedAmount);
                    if (diff === 0) {
                      return (
                        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 p-3 text-xs text-emerald-800 dark:text-emerald-300">
                          <CheckCircle2 size={16} />
                          <span>المبلغ متطابق تماماً مع المتوقع (لا يوجد عجز أو زيادة)</span>
                        </div>
                      );
                    }
                    if (diff < 0) {
                      return (
                        <div className="flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800/60 p-3 text-xs text-rose-800 dark:text-rose-300">
                          <AlertCircle size={16} />
                          <span>يوجد عجز في الصندوق بقيمة: <strong className="font-mono font-black">{Math.abs(diff)} ₪</strong></span>
                        </div>
                      );
                    }
                    return (
                      <div className="flex items-center gap-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/60 p-3 text-xs text-indigo-800 dark:text-indigo-300">
                        <TrendingUp size={16} />
                        <span>يوجد فائض في الصندوق بقيمة: <strong className="font-mono font-black">+{diff} ₪</strong></span>
                      </div>
                    );
                  })()
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    ملاحظات الإغلاق أو تبرير الفارق (اختياري)
                  </label>
                  <textarea
                    rows={2}
                    value={closingNotes}
                    onChange={(e) => setClosingNotes(e.target.value)}
                    placeholder="ملاحظات حول سبب الفارق أو تسليم العهدة..."
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-medium text-slate-900 dark:text-slate-200 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setCloseShiftModalOpen(false)}
                    className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 py-3 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={submittingCloseShift}
                    className="flex-2 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 py-3 text-xs font-bold text-white shadow-lg shadow-rose-500/20 transition disabled:opacity-50"
                  >
                    {submittingCloseShift ? 'جاري الإغلاق...' : 'تأكيد إغلاق الصندوق وإنهاء الشيفت'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          مودال 3: إضافة صنف من الأقسام السريعة (خضار، مخبز، بالوزن)
      ───────────────────────────────────────────────────────────── */}
      {quickSectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 dark:bg-slate-950/80 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-6 text-right text-slate-900 dark:text-white transition-colors">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-indigo-50 dark:bg-indigo-600/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <Scale size={18} />
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  إضافة صنف من قسم: {quickSectionModal.label}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setQuickSectionModal(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmQuickItem} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  اسم الصنف * (مثال: طماطم، خبز بلدي، لبنة...)
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={quickItemForm.name}
                  onChange={(e) => setQuickItemForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="اكتب اسم الصنف..."
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    الوحدة
                  </label>
                  <select
                    value={quickItemForm.unit}
                    onChange={(e) => setQuickItemForm((p) => ({ ...p, unit: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-xs font-bold text-slate-800 dark:text-white focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="كغم">كغم</option>
                    <option value="قطعة">قطعة</option>
                    <option value="غرام">غرام</option>
                    <option value="كرتونة">كرتونة</option>
                    <option value="لتر">لتر</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    الوزن أو الكمية *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.001"
                    required
                    value={quickItemForm.qty}
                    onChange={(e) => setQuickItemForm((p) => ({ ...p, qty: e.target.value }))}
                    placeholder="1"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm font-mono font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                    dir="ltr"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  السعر الفردي للوحدة (شيكل) *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  value={quickItemForm.price}
                  onChange={(e) => setQuickItemForm((p) => ({ ...p, price: e.target.value }))}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm font-mono font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                  dir="ltr"
                />
              </div>

              {/* معاينة الإجمالي */}
              <div className="rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 flex justify-between items-center text-xs">
                <span className="text-slate-500 dark:text-slate-400 font-bold">إجمالي هذا الصنف:</span>
                <span className="font-mono text-base font-black text-emerald-600 dark:text-emerald-400">
                  {roundMoney((parseFloat(quickItemForm.qty) || 0) * (parseFloat(quickItemForm.price) || 0))} ₪
                </span>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setQuickSectionModal(null)}
                  className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-indigo-600 hover:bg-indigo-500 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-600/30"
                >
                  إضافة للفاتورة ✓
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          مودال 4: وصل الطباعة الحراري البسيط
      ───────────────────────────────────────────────────────────── */}
      {simpleReceiptPrint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 dark:bg-slate-950/80 backdrop-blur-md p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-slate-900 shadow-2xl">
            <PrintPosReceiptSimple data={simpleReceiptPrint} />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white hover:bg-indigo-700 transition"
              >
                طباعة الآن 🖨️
              </button>
              <button
                type="button"
                onClick={() => setSimpleReceiptPrint(null)}
                className="rounded-xl border border-slate-200 py-2.5 px-4 text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          مودال 5: تسجيل منتج جديد (سكانر أو إضافة مباشرة للمخزون)
      ───────────────────────────────────────────────────────────── */}
      {newProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 dark:bg-slate-950/85 backdrop-blur-md p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-6 text-right text-slate-900 dark:text-white transition-colors flex flex-col max-h-[92vh]">
            {/* رأس المودال */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3 mb-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400">
                  <PackagePlus size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {newProductModal.isInventoryOnly ? 'إضافة صنف جديد للمخزون' : 'تسجيل منتج جديد'}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {newProductModal.isInventoryOnly
                      ? 'أدخل بيانات الصنف لإضافته إلى المخزون (لن يُضاف إلى الفاتورة الحالية)'
                      : 'الباركود غير موجود، سجله الآن لإضافته للفاتورة فوراً'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCancelNewProduct}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white transition"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveNewProduct} className="flex-1 overflow-y-auto pr-1 pl-1 space-y-3">
              {/* حقل الباركود */}
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                  {newProductModal.isInventoryOnly
                    ? 'الباركود (اختياري - امسحه بالسكانر أو اتركه فارغاً)'
                    : 'الباركود (للقراءة فقط)'}
                </label>
                <div className="relative">
                  <ScanLine className="absolute right-3 top-1/2 -translate-y-1/2 text-indigo-500" size={16} />
                  {newProductModal.isInventoryOnly ? (
                    <input
                      ref={newProductBarcodeInputRef}
                      type="text"
                      value={newProductForm.barcode}
                      onChange={(e) => setNewProductForm((p) => ({ ...p, barcode: e.target.value }))}
                      placeholder="امسح بالسكانر أو اكتب الباركود..."
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pr-9 pl-3 py-2 text-xs font-mono font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
                      dir="ltr"
                    />
                  ) : (
                    <input
                      type="text"
                      readOnly
                      value={newProductModal.barcode}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 pr-9 pl-3 py-2 text-xs font-mono font-bold text-slate-700 dark:text-indigo-300 select-all cursor-not-allowed"
                      dir="ltr"
                    />
                  )}
                </div>
              </div>

              {/* اسم المنتج (إجباري) */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                  اسم المنتج *
                </label>
                <input
                  ref={newProductNameInputRef}
                  type="text"
                  required
                  autoFocus={!newProductModal.isInventoryOnly}
                  value={newProductForm.name}
                  onChange={(e) => setNewProductForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="مثال: شيبس دوريتوس حار 100 غم..."
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
                />
              </div>

              {/* الوحدة + سعر البيع في صف واحد */}
              <div className="grid grid-cols-2 gap-3">
                {/* الوحدة */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    الوحدة
                  </label>
                  <select
                    value={newProductForm.unit}
                    onChange={(e) => setNewProductForm((p) => ({ ...p, unit: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-bold text-slate-800 dark:text-white focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="قطعة">قطعة</option>
                    <option value="كرتونة">كرتونة</option>
                    <option value="كغم">كغم</option>
                    <option value="غرام">غرام</option>
                    <option value="لتر">لتر</option>
                    <option value="علبة">علبة</option>
                    <option value="باكيت">باكيت</option>
                  </select>
                </div>

                {/* سعر البيع (إجباري) */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    سعر البيع (شيكل) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={newProductForm.price}
                    onChange={(e) => setNewProductForm((p) => ({ ...p, price: e.target.value }))}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                    dir="ltr"
                  />
                </div>
              </div>

              {/* 1. سعر التكلفة (شيكل) * + 2. الكمية الافتتاحية بالمخزون * */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    سعر التكلفة (شيكل) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={newProductForm.costPrice}
                    onChange={(e) => setNewProductForm((p) => ({ ...p, costPrice: e.target.value }))}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    الكمية الافتتاحية بالمخزون *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={newProductForm.initialStock}
                    onChange={(e) => setNewProductForm((p) => ({ ...p, initialStock: e.target.value }))}
                    placeholder="0"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                    dir="ltr"
                  />
                </div>
              </div>

              {/* 3. حد أدنى تنبيه المخزون (اختياري) + 5. تاريخ انتهاء الصلاحية (اختياري) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    حد أدنى تنبيه المخزون (اختياري)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={newProductForm.minStockAlert}
                    onChange={(e) => setNewProductForm((p) => ({ ...p, minStockAlert: e.target.value }))}
                    placeholder="5"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    تاريخ انتهاء الصلاحية (اختياري)
                  </label>
                  <input
                    type="date"
                    value={newProductForm.expiryDate}
                    onChange={(e) => setNewProductForm((p) => ({ ...p, expiryDate: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-mono font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* 4. المورد (اختياري) */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                  المورد (اختياري)
                </label>
                <div className="relative">
                  <Truck className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                  <select
                    value={newProductForm.supplierId}
                    onChange={(e) => setNewProductForm((p) => ({ ...p, supplierId: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pr-9 pl-3 py-2 text-xs font-bold text-slate-800 dark:text-white focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">— بدون مورد محدد (اختياري) —</option>
                    {suppliersList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.phone ? `(${s.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* القسم / التصنيف (اختياري) */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                  القسم / التصنيف (اختياري)
                </label>
                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={newProductForm.category}
                    onChange={(e) => setNewProductForm((p) => ({ ...p, category: e.target.value }))}
                    placeholder="اكتب القسم أو اختر من الأدنى..."
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 focus:border-indigo-500 focus:outline-none"
                  />
                  {/* أزرار خيارات سريعة للتصنيف */}
                  <div className="flex flex-wrap gap-1 pt-1">
                    {['مواد غذائية', 'مشروبات', 'ألبان وأجبان', 'منظفات', 'حلويات', 'خضار'].map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setNewProductForm((p) => ({ ...p, category: cat }))}
                        className={`text-[10px] px-2 py-0.5 rounded-lg border transition ${
                          newProductForm.category === cat
                            ? 'bg-indigo-600 border-indigo-600 text-white font-bold'
                            : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* أزرار الإجراءات */}
              <div className="flex items-center gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800 shrink-0">
                <button
                  type="button"
                  onClick={handleCancelNewProduct}
                  className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingNewProduct}
                  className="flex-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 py-2.5 px-4 text-xs font-bold text-white shadow-lg shadow-indigo-500/25 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <Plus size={15} />
                  <span>
                    {savingNewProduct
                      ? 'جاري الحفظ...'
                      : newProductModal.isInventoryOnly
                      ? 'حفظ في المخزون ✓'
                      : 'حفظ وإضافة للفاتورة ✓'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          مودال 6: اختيار الزبون للبيع بالآجل (دين) + إضافة زبون سريع
      ───────────────────────────────────────────────────────────── */}
      {creditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 dark:bg-slate-950/85 backdrop-blur-md p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-6 text-right text-slate-900 dark:text-white transition-colors flex flex-col max-h-[90vh]">
            {/* رأس المودال */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3 mb-4 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 dark:bg-amber-600/20 text-amber-600 dark:text-amber-400">
                  <User size={22} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">البيع بالآجل (تسجيل دين)</h3>
                    <span className="rounded-full bg-amber-100 dark:bg-amber-950/80 border border-amber-300 dark:border-amber-700 px-2 py-0.5 text-xs font-mono font-black text-amber-700 dark:text-amber-300">
                      {invoiceTotals.payable} ₪
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    ابحث عن زبون مسجل أو سجّل زبوناً جديداً واختاره فوراً
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseCreditModal}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* شريط البحث وزر إضافة زبون جديد */}
            {!showAddCustomerForm && (
              <div className="space-y-3 shrink-0 mb-3">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                      ref={customerSearchInputRef}
                      type="text"
                      value={customerSearchQuery}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCustomerSearchQuery(val);
                        fetchCustomers(val);
                      }}
                      placeholder="ابحث بالاسم أو رقم الهاتف..."
                      className="w-full h-11 rounded-2xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pr-10 pl-3 text-xs font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-amber-500 focus:outline-none"
                      autoComplete="off"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddCustomerForm(true);
                      setNewCustomerForm((p) => ({ ...p, name: customerSearchQuery.trim() }));
                      setTimeout(() => newCustomerNameInputRef.current?.focus(), 80);
                    }}
                    className="flex items-center gap-1.5 h-11 px-3.5 rounded-2xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition shadow-sm shrink-0"
                  >
                    <UserPlus size={16} />
                    <span>زبون جديد +</span>
                  </button>
                </div>
              </div>
            )}

            {/* نموذج إضافة زبون جديد سريع */}
            {showAddCustomerForm ? (
              <form
                onSubmit={handleCreateCustomerAndCredit}
                className="space-y-3 shrink-0 overflow-y-auto p-4 rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/40 dark:bg-amber-950/20 mb-3"
              >
                <div className="flex items-center justify-between pb-2 border-b border-amber-200/60 dark:border-amber-800/40">
                  <span className="text-xs font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                    <UserPlus size={15} />
                    بيانات الزبون الجديد
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAddCustomerForm(false)}
                    className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    الرجوع للبحث ✕
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    اسم الزبون *
                  </label>
                  <input
                    ref={newCustomerNameInputRef}
                    type="text"
                    required
                    value={newCustomerForm.name}
                    onChange={(e) => setNewCustomerForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="مثال: أحمد محمود، أبو علي..."
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      رقم الهاتف (اختياري)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={newCustomerForm.phone}
                      onChange={(e) => setNewCustomerForm((p) => ({ ...p, phone: e.target.value }))}
                      placeholder="059xxxxxxx"
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono font-bold text-slate-900 dark:text-white focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      العنوان (اختياري)
                    </label>
                    <input
                      type="text"
                      value={newCustomerForm.address}
                      onChange={(e) => setNewCustomerForm((p) => ({ ...p, address: e.target.value }))}
                      placeholder="الحارة، الشارع..."
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-900 dark:text-white focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddCustomerForm(false)}
                    className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={creatingCustomer}
                    className="flex-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 py-2.5 text-xs font-bold text-white shadow-md shadow-amber-600/30 transition disabled:opacity-50"
                  >
                    {creatingCustomer ? 'جاري الحفظ...' : 'حفظ واختيار للبيع الآجل ✓'}
                  </button>
                </div>
              </form>
            ) : (
              /* قائمة نتائج الزبائن */
              <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 divide-y divide-slate-100 dark:divide-slate-800/80">
                {loadingCustomers ? (
                  <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    جاري جلب قائمة الزبائن...
                  </div>
                ) : customerList.length > 0 ? (
                  customerList.map((cust) => {
                    const curDebt = Number(cust.outstanding_amount || cust.balance || cust.debt_amount || 0);
                    return (
                      <div
                        key={cust.id}
                        onClick={() => handleSelectCustomerForCredit(cust)}
                        className="flex items-center justify-between p-3.5 hover:bg-amber-50/70 dark:hover:bg-amber-950/30 cursor-pointer transition group"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-slate-800 dark:text-slate-100 group-hover:text-amber-600 dark:group-hover:text-amber-400">
                              {cust.name}
                            </span>
                            {cust.phone && (
                              <span className="font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                                {cust.phone}
                              </span>
                            )}
                          </div>
                          {cust.address && (
                            <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                              {cust.address}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-left">
                            {curDebt > 0 ? (
                              <span className="inline-block rounded-lg bg-rose-100 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-800 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:text-rose-400 font-mono">
                                دين سابق: {roundMoney(curDebt)} ₪
                              </span>
                            ) : (
                              <span className="inline-block rounded-lg bg-emerald-100 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                                لا يوجد دين سابق
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="rounded-xl bg-amber-600 group-hover:bg-amber-500 text-white px-3 py-1.5 text-xs font-bold shadow-sm transition"
                          >
                            اختيار ⬅
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center space-y-3">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      لم يتم العثور على أي زبون مطابق لـ «{customerSearchQuery || 'البحث'}»
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddCustomerForm(true);
                        setNewCustomerForm((p) => ({ ...p, name: customerSearchQuery.trim() }));
                        setTimeout(() => newCustomerNameInputRef.current?.focus(), 80);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 text-xs font-bold transition shadow-sm"
                    >
                      <UserPlus size={15} />
                      <span>إضافة «{customerSearchQuery || 'زبون جديد'}» كزبون جديد الآن</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* زر إلغاء السفلي */}
            <div className="pt-3 mt-3 border-t border-slate-200 dark:border-slate-800 shrink-0 flex justify-end">
              <button
                type="button"
                onClick={handleCloseCreditModal}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-5 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
