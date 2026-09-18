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
  Banknote,
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
  Pencil,
  Pause,
  Volume2,
  VolumeX,
  Clock,
  History,
  MoreHorizontal,
  Palette,
} from 'lucide-react';
import { supabase, PRODUCTS_TABLE, PRODUCTS_STOCK_COLUMN } from '../lib/supabaseClient';
import { normalizeItemFromSupabase, isUuid, roundMoney, runProductsSelectWithFallback } from '../utils/productModel';
import { normalizeDigitsToLatin, normalizePriceInput } from '../utils/normalizeDigits';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import {
  applyCashSaleToMainCashFund,
  applyCashSaleReturnFromFund,
  applyCreditSaleReturn,
} from '../utils/saleAccounting';
import { insertInventoryLog } from '../lib/inventoryLogs';
import { useHtmlDarkClass, applyExplicitTheme } from '../lib/theme';
import Sidebar from '../components/Sidebar';
import PrintPosReceiptSimple from '../components/PrintPosReceiptSimple';
import POSCheckoutFullForm from '../components/POSCheckoutFullForm';
import ProductFormModal from '../components/ProductFormModal';
import ProductSearchModal from '../components/ProductSearchModal';
import HeldInvoicesModal from '../components/HeldInvoicesModal';
import RecentInvoicesModal from '../components/RecentInvoicesModal';
import { uploadProductImageFile } from '../utils/uploadProductImage';
import { normalizeProductTypeForDb, productTypeToFormDisplay } from '../utils/productTypes';
import { syncShopLocationStockFromProductRow } from '../utils/storeLocations';
import { brandStorageKey } from '../constants/brand.js';
import {
  COMMON_UNIT_PRESETS,
  findUnitByBarcode,
  fetchUnitsForProductIds,
  fetchUnitsByProductId,
  saveProductUnits,
  PRODUCT_UNITS_TABLE,
} from '../utils/productUnits';

const SIDEBAR_COLLAPSED_KEY = brandStorageKey('sidebar-collapsed');

function readSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

const getDraftInvoiceStorageKey = (storeId, sessionId) =>
  brandStorageKey(`pos_draft_invoice_${storeId || 'default'}_${sessionId || 'default'}`);

const getHeldInvoicesStorageKey = (storeId, sessionId) =>
  brandStorageKey(`pos_held_invoices_${storeId || 'default'}_${sessionId || 'default'}`);

const getLastSessionStorageKey = (storeId) =>
  brandStorageKey(`pos_last_session_${storeId || 'default'}`);

const SOUND_ENABLED_KEY = brandStorageKey('pos_sound_enabled');

let globalSoundEnabled = true;
try {
  const savedSound = localStorage.getItem(SOUND_ENABLED_KEY);
  if (savedSound !== null) globalSoundEnabled = savedSound === 'true';
} catch {}

/** نغمة صوتية سريعة لمسح الباركود */
function playScanBeep(success = true) {
  if (!globalSoundEnabled) return;
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
  if (!globalSoundEnabled) return;
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

function getFieldStatusClass(val, type = 'number') {
  const str = val == null ? '' : String(val).trim();
  if (str === '') {
    return 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white';
  }
  const num = parseFloat(str.replace(',', '.'));
  if (type === 'qty') {
    if (isNaN(num) || num <= 0) {
      return 'border-red-400 bg-red-50/50 text-red-700 dark:border-red-500/80 dark:bg-red-950/40 dark:text-red-300 font-bold';
    }
    return 'border-emerald-400 bg-emerald-50/20 text-emerald-950 dark:border-emerald-500/70 dark:bg-emerald-950/20 dark:text-emerald-200 font-black';
  }
  if (type === 'price') {
    if (isNaN(num) || num <= 0) {
      return 'border-red-400 bg-red-50/50 text-red-700 dark:border-red-500/80 dark:bg-red-950/40 dark:text-red-300 font-bold';
    }
    return 'border-emerald-400 bg-emerald-50/20 text-emerald-950 dark:border-emerald-500/70 dark:bg-emerald-950/20 dark:text-emerald-200 font-black';
  }
  if (type === 'discount') {
    if (isNaN(num) || num < 0) {
      return 'border-red-400 bg-red-50/50 text-red-700 dark:border-red-500/80 dark:bg-red-950/40 dark:text-red-300 font-bold';
    }
    if (num > 0) {
      return 'border-emerald-400 bg-emerald-50/20 text-emerald-950 dark:border-emerald-500/70 dark:bg-emerald-950/20 dark:text-emerald-200 font-black';
    }
    return 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold';
  }
  return 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white';
}

// أقسام السوبرماركت السريعة الافتراضية
const QUICK_SECTIONS = [
  { id: 'produce', label: 'خضار وفواكه 🥬', defaultUnit: 'كغم', defaultPrice: 5 },
  { id: 'bakery', label: 'مخبز ومعجنات 🥖', defaultUnit: 'قطعة', defaultPrice: 2 },
  { id: 'weight', label: 'بيع بالوزن / ميزان ⚖️', defaultUnit: 'كغم', defaultPrice: 10 },
  { id: 'dairy', label: 'ألبان وأجبان 🧀', defaultUnit: 'كغم', defaultPrice: 15 },
  { id: 'custom', label: 'صنف يدوي ⚡', defaultUnit: 'قطعة', defaultPrice: 0 },
];

// ثيمات وألوان شاشة نقطة البيع
const POS_THEME_STORAGE_KEY = 'pos_color_theme';

const POS_COLOR_THEMES = {
  emerald: {
    id: 'emerald',
    name: 'الأخضر التجاري (Fresh Emerald)',
    shortName: 'أخضر تجاري 🌿',
    dotColor: 'bg-emerald-500',
    darkBg: 'bg-[linear-gradient(135deg,#061a17_0%,#04231f_40%,#063b33_100%)]',
    lightBg: 'bg-gradient-to-br from-slate-100 via-emerald-50/25 to-teal-50/35',
    brandGradient: 'from-emerald-600 via-emerald-500 to-teal-600 shadow-emerald-500/20',
    accentText: 'text-emerald-600 dark:text-emerald-400',
    accentBg: 'bg-emerald-600',
    accentBorder: 'border-emerald-500',
    inputBorder: 'border-emerald-500/40 dark:border-emerald-500/30',
    inputBg: 'from-slate-50 via-white to-emerald-50/40 dark:from-slate-900/95 dark:via-slate-900/85 dark:to-emerald-950/70',
    inputFocus: 'focus:border-emerald-500 focus:ring-emerald-500 focus:shadow-emerald-500/10',
    inputIcon: 'text-emerald-500 dark:text-emerald-400',
    totalBox: 'border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 via-white to-teal-50/40 dark:from-emerald-950/80 dark:via-slate-900 dark:to-teal-950/60 shadow-lg dark:shadow-emerald-950/40 ring-1 ring-emerald-500/30',
    totalLabel: 'text-emerald-700 dark:text-emerald-300',
    searchBtn: 'border-emerald-200/90 dark:border-emerald-800/60 bg-emerald-50/90 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300',
    searchKbd: 'bg-emerald-200/60 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 border-emerald-300/40 dark:border-emerald-700/40',
    tabActive: 'bg-white dark:bg-emerald-600 text-emerald-700 dark:text-white shadow-sm',
    tabBadge: 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-300',
    dropdownActive: 'bg-emerald-50 dark:bg-emerald-950/70 border-r-4 border-emerald-500',
    dropdownBtn: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    salesBadgeBorder: 'border-r-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300',
    salesText: 'text-emerald-700 dark:text-emerald-300',
    salesIcon: 'text-emerald-600 dark:text-emerald-400',
    cardBtn: 'bg-teal-600 hover:bg-teal-700 active:bg-teal-800 shadow-teal-600/30 hover:shadow-teal-600/40 border-t border-teal-400/30',
  },
  indigo: {
    id: 'indigo',
    name: 'النيلي الكلاسيكي (Classic Indigo)',
    shortName: 'نيلي كلاسيكي 🟣',
    dotColor: 'bg-indigo-500',
    darkBg: 'bg-[linear-gradient(135deg,#0f172a_0%,#0f172a_40%,#1e1b4b_100%)]',
    lightBg: 'bg-gradient-to-br from-slate-100 via-slate-50 to-indigo-50/25',
    brandGradient: 'from-indigo-600 to-violet-600 shadow-indigo-500/20',
    accentText: 'text-indigo-600 dark:text-indigo-400',
    accentBg: 'bg-indigo-600',
    accentBorder: 'border-indigo-500',
    inputBorder: 'border-indigo-500/40 dark:border-indigo-500/30',
    inputBg: 'from-slate-50 via-white to-indigo-50/40 dark:from-slate-900/95 dark:via-slate-900/85 dark:to-indigo-950/70',
    inputFocus: 'focus:border-indigo-500 focus:ring-indigo-500 focus:shadow-indigo-500/10',
    inputIcon: 'text-indigo-500 dark:text-indigo-400',
    totalBox: 'border-indigo-500/40 bg-gradient-to-br from-indigo-50 via-white to-slate-50 dark:from-indigo-950/60 dark:via-slate-900 dark:to-slate-950 shadow-lg dark:shadow-2xl ring-1 ring-indigo-500/20',
    totalLabel: 'text-indigo-600 dark:text-indigo-300',
    searchBtn: 'border-indigo-200/90 dark:border-indigo-800/60 bg-indigo-50/90 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300',
    searchKbd: 'bg-indigo-200/60 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-200 border-indigo-300/40 dark:border-indigo-700/40',
    tabActive: 'bg-white dark:bg-indigo-600 text-indigo-700 dark:text-white shadow-sm',
    tabBadge: 'bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300',
    dropdownActive: 'bg-indigo-50 dark:bg-indigo-950/70 border-r-4 border-indigo-500',
    dropdownBtn: 'bg-indigo-600 hover:bg-indigo-500 text-white',
    salesBadgeBorder: 'border-r-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20 text-slate-700 dark:text-slate-200',
    salesText: 'text-indigo-700 dark:text-indigo-300',
    salesIcon: 'text-indigo-600 dark:text-indigo-400',
    cardBtn: 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 shadow-indigo-600/30 hover:shadow-indigo-600/40 border-t border-indigo-400/30',
  },
  charcoal: {
    id: 'charcoal',
    name: 'الفحمي الهادئ (Dark Charcoal)',
    shortName: 'فحمي هادئ ⚫',
    dotColor: 'bg-zinc-500',
    darkBg: 'bg-[linear-gradient(135deg,#09090b_0%,#18181b_50%,#09090b_100%)]',
    lightBg: 'bg-gradient-to-br from-zinc-100 via-stone-50 to-zinc-200/40',
    brandGradient: 'from-zinc-700 to-zinc-900 shadow-zinc-500/20',
    accentText: 'text-zinc-600 dark:text-zinc-300',
    accentBg: 'bg-zinc-700',
    accentBorder: 'border-zinc-500',
    inputBorder: 'border-zinc-500/40 dark:border-zinc-600/40',
    inputBg: 'from-zinc-50 via-white to-zinc-100/50 dark:from-zinc-900 dark:via-zinc-900/90 dark:to-zinc-950',
    inputFocus: 'focus:border-zinc-400 focus:ring-zinc-400 focus:shadow-zinc-500/10',
    inputIcon: 'text-zinc-400 dark:text-zinc-400',
    totalBox: 'border-zinc-500/40 bg-gradient-to-br from-zinc-100 via-white to-zinc-50 dark:from-zinc-900 dark:via-zinc-950 dark:to-black shadow-lg dark:shadow-black/50 ring-1 ring-zinc-500/30',
    totalLabel: 'text-zinc-700 dark:text-zinc-300',
    searchBtn: 'border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200',
    searchKbd: 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-600',
    tabActive: 'bg-white dark:bg-zinc-700 text-zinc-800 dark:text-white shadow-sm',
    tabBadge: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300',
    dropdownActive: 'bg-zinc-100 dark:bg-zinc-800 border-r-4 border-zinc-500',
    dropdownBtn: 'bg-zinc-700 hover:bg-zinc-600 text-white',
    salesBadgeBorder: 'border-r-zinc-500 bg-zinc-100/70 dark:bg-zinc-800/40 text-slate-700 dark:text-slate-200',
    salesText: 'text-zinc-800 dark:text-zinc-200',
    salesIcon: 'text-zinc-600 dark:text-zinc-400',
    cardBtn: 'bg-slate-700 hover:bg-slate-800 active:bg-slate-900 shadow-slate-700/30 hover:shadow-slate-700/40 border-t border-slate-500/30',
  },
};

export default function SupermarketPOS() {
  const { store } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const isDark = useHtmlDarkClass();

  // ثيم الألوان المختار (افتراضياً: الأخضر التجاري)
  const [colorTheme, setColorTheme] = useState(() => {
    try {
      return localStorage.getItem(POS_THEME_STORAGE_KEY) || 'emerald';
    } catch {
      return 'emerald';
    }
  });
  const [paletteMenuOpen, setPaletteMenuOpen] = useState(false);
  const paletteMenuRef = useRef(null);

  const activeTheme = POS_COLOR_THEMES[colorTheme] || POS_COLOR_THEMES.emerald;

  const changeColorTheme = (themeId) => {
    setColorTheme(themeId);
    try {
      localStorage.setItem(POS_THEME_STORAGE_KEY, themeId);
    } catch {}
    toast.success(`تم تفعيل ثيم: ${POS_COLOR_THEMES[themeId]?.name || themeId}`);
  };

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
      if (store?.id && activeShift?.id) {
        try {
          localStorage.removeItem(getHeldInvoicesStorageKey(store.id, activeShift.id));
        } catch {
          /* ignore */
        }
      }
      setHeldInvoices([]);
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
  const moreMenuRef = useRef(null);

  // جلب المنتجات المسجلة في المتجر للاقتراحات والباركود السريع
  const fetchStoreProducts = useCallback(async () => {
    if (!store?.id) return;
    try {
      const { data, error } = await runProductsSelectWithFallback((sel) =>
        supabase
          .from(PRODUCTS_TABLE)
          .select(sel)
          .eq('store_id', store.id)
          .order('created_at', { ascending: false })
          .limit(300)
      );
      if (!error && Array.isArray(data)) {
        setItems(data.map(normalizeItemFromSupabase).filter(Boolean));
      }
    } catch (err) {
      console.error('Error fetching store products:', err);
    }
  }, [store?.id]);

  useEffect(() => {
    fetchStoreProducts();
  }, [fetchStoreProducts]);

  const [serverSearchResults, setServerSearchResults] = useState([]);

  // استعلام مباشر من قاعدة البيانات لكافة الـ 10,715 صنفاً حتى تظهر الأصناف ذات الرصيد 0 وغير المحمّلة محلياً
  useEffect(() => {
    const raw = normalizeDigitsToLatin(String(search || '').trim());
    if (!raw || raw.length < 2 || !store?.id) {
      setServerSearchResults([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data } = await runProductsSelectWithFallback((sel) =>
          supabase
            .from(PRODUCTS_TABLE)
            .select(sel)
            .eq('store_id', store.id)
            .or(`eng_name.ilike.%${raw}%,barcode.ilike.%${raw}%,reference.ilike.%${raw}%`)
            .limit(20)
        );
        if (!cancelled && data) {
          const norm = data.map(normalizeItemFromSupabase).filter(Boolean);
          setServerSearchResults(norm);
        }
      } catch (err) {
        console.error('SupermarketPOS server search error:', err);
      }
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, store?.id]);

  // البحث الجزئي للاقتراحات (دمج الذاكرة مع نتائج قاعدة البيانات لكامل الأصناف)
  const partialMatches = useMemo(() => {
    const q = normalizeDigitsToLatin(String(search || '').trim()).toLowerCase();
    if (!q) return [];
    const map = new Map();
    items
      .filter((i) => {
        const fields = [i.name, i.barcode, i.reference, i.group];
        return fields.some((f) =>
          normalizeDigitsToLatin(String(f ?? '')).toLowerCase().includes(q)
        );
      })
      .forEach((i) => map.set(i.id || i.barcode, i));

    serverSearchResults.forEach((i) => map.set(i.id || i.barcode, i));
    return Array.from(map.values()).slice(0, 15);
  }, [items, search, serverSearchResults]);

  // ─────────────────────────────────────────────────────────────
  // 3. بنود جدول الفاتورة المباشر (Direct Invoice Table)
  // ─────────────────────────────────────────────────────────────
  // كل سطر: { id, barcode, name, unit, qty, unitPrice, discount, lineTotal, conversionFactor }
  const [orderItems, setOrderItems] = useState([]);
  const [tenderedAmount, setTenderedAmount] = useState('');
  const [isSubmittingSale, setIsSubmittingSale] = useState(false);
  const [simpleReceiptPrint, setSimpleReceiptPrint] = useState(null);

  // ── الفواتير المعلّقة (Parked / Held Invoices) ──
  const [heldInvoices, setHeldInvoices] = useState([]);
  const [heldInvoicesModalOpen, setHeldInvoicesModalOpen] = useState(false);

  // استرجاع الفواتير المعلقة الخاصة بالشيفت الحالي
  useEffect(() => {
    if (!activeShift?.id || !store?.id) {
      setHeldInvoices([]);
      return;
    }
    const heldKey = getHeldInvoicesStorageKey(store.id, activeShift.id);
    try {
      const raw = localStorage.getItem(heldKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setHeldInvoices(parsed);
        } else {
          setHeldInvoices([]);
        }
      } else {
        setHeldInvoices([]);
      }
    } catch (err) {
      console.warn('[SupermarketPOS] Error restoring held invoices:', err);
      setHeldInvoices([]);
    }
  }, [activeShift?.id, store?.id]);

  // ── تفضيل كتم / تشغيل صوت التنبيه ──
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem(SOUND_ENABLED_KEY);
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  const toggleSound = () => {
    setSoundEnabled((prev) => {
      const next = !prev;
      globalSoundEnabled = next;
      try {
        localStorage.setItem(SOUND_ENABLED_KEY, String(next));
      } catch {}
      return next;
    });
  };

  // ── قائمة "..." للشاشات الصغيرة في الشريط العلوي ──
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // ── آخر فواتير الشيفت الحالي (Recent Invoices) ──
  const [recentInvoicesModalOpen, setRecentInvoicesModalOpen] = useState(false);
  const [shiftRecentInvoices, setShiftRecentInvoices] = useState([]);
  const [loadingRecentInvoices, setLoadingRecentInvoices] = useState(false);

  // جلب آخر 5 فواتير في الشيفت الحالي
  const fetchShiftRecentInvoices = useCallback(async () => {
    if (!activeShift?.id || !store?.id) {
      setShiftRecentInvoices([]);
      return;
    }
    setLoadingRecentInvoices(true);
    try {
      const { data, error } = await supabase
        .from('sales')
        .select('id, total_amount, payment_mode, payment_method, contact_id, notes, line_items, created_at, session_id')
        .eq('store_id', store.id)
        .gte('created_at', activeShift.opened_at)
        .order('created_at', { ascending: false })
        .limit(20);

      if (!error && Array.isArray(data)) {
        const filtered = data
          .filter((s) => {
            const notesStr = String(s.notes || '');
            return (
              (s.session_id && s.session_id === activeShift.id) ||
              notesStr.includes(activeShift.id) ||
              (!notesStr.includes('جلسة الصندوق') && new Date(s.created_at) >= new Date(activeShift.opened_at))
            );
          })
          .slice(0, 5);
        setShiftRecentInvoices(filtered);
      }
    } catch (err) {
      console.warn('Error fetching recent shift invoices:', err);
    } finally {
      setLoadingRecentInvoices(false);
    }
  }, [activeShift?.id, activeShift?.opened_at, store?.id]);

  useEffect(() => {
    fetchShiftRecentInvoices();
  }, [fetchShiftRecentInvoices]);

  // ── عداد مبيعات الوردية اللحظي ──
  const [shiftSalesTotals, setShiftSalesTotals] = useState({
    paidTotal: 0,
    creditTotal: 0,
    count: 0,
  });

  const fetchShiftSalesTotals = useCallback(async () => {
    if (!activeShift?.id || !store?.id) {
      setShiftSalesTotals({ paidTotal: 0, creditTotal: 0, count: 0 });
      return;
    }
    try {
      const { data: sales, error } = await supabase
        .from('sales')
        .select('id, total_amount, payment_mode, payment_method, notes, created_at, session_id')
        .eq('store_id', store.id)
        .gte('created_at', activeShift.opened_at);

      if (error || !sales) return;

      let paid = 0;
      let credit = 0;
      let count = 0;

      for (const s of sales) {
        const notesStr = String(s.notes || '');
        const matchesSession =
          (s.session_id && s.session_id === activeShift.id) ||
          notesStr.includes(activeShift.id) ||
          (!notesStr.includes('جلسة الصندوق') && new Date(s.created_at) >= new Date(activeShift.opened_at));

        if (!matchesSession) continue;

        count++;
        const val = Number(s.total_amount || 0);
        const mode = (s.payment_mode || '').toLowerCase();
        const method = (s.payment_method || '').toLowerCase();

        const isCredit = mode === 'credit' || method === 'deferred' || method === 'credit';
        if (isCredit) {
          credit += val;
        } else {
          paid += val;
        }
      }

      setShiftSalesTotals({
        paidTotal: roundMoney(paid),
        creditTotal: roundMoney(credit),
        count,
      });
    } catch (err) {
      console.warn('Error fetching shift sales totals:', err);
    }
  }, [activeShift?.id, activeShift?.opened_at, store?.id]);

  useEffect(() => {
    fetchShiftSalesTotals();
  }, [fetchShiftSalesTotals]);

  // ── أصناف سريعة (الأكثر مبيعاً + آخر أصناف الفاتورة السابقة) ──
  const [quickItemsTab, setQuickItemsTab] = useState('top_selling');
  const [topSellingProducts, setTopSellingProducts] = useState([]);
  const [loadingTopSelling, setLoadingTopSelling] = useState(false);

  // جلب أكثر 8 أصناف مبيعاً في آخر 7 أيام
  const fetchTopSellingProducts = useCallback(async () => {
    if (!store?.id) return;
    setLoadingTopSelling(true);
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recentSales, error } = await supabase
        .from('sales')
        .select('line_items')
        .eq('store_id', store.id)
        .gte('created_at', sevenDaysAgo)
        .limit(150);

      if (!error && Array.isArray(recentSales)) {
        const countMap = new Map();
        for (const s of recentSales) {
          let lines = [];
          if (Array.isArray(s.line_items)) lines = s.line_items;
          else if (typeof s.line_items === 'string') {
            try {
              lines = JSON.parse(s.line_items);
            } catch {}
          }

          for (const line of lines) {
            const key = line.product_id || line.barcode || line.name;
            if (!key) continue;
            const existing = countMap.get(key) || {
              id: line.product_id || null,
              productId: line.product_id || null,
              barcode: line.barcode || '',
              name: line.name || '',
              price: Number(line.unit_price || line.price || 0),
              priceAfterDiscount: Number(line.unit_price || line.price || 0),
              unit: line.unit || 'قطعة',
              totalSold: 0,
            };
            existing.totalSold += Number(line.qty || 1);
            countMap.set(key, existing);
          }
        }

        const sorted = Array.from(countMap.values())
          .sort((a, b) => b.totalSold - a.totalSold)
          .slice(0, 8);

        setTopSellingProducts(sorted);
      }
    } catch (err) {
      console.warn('Error fetching top selling products:', err);
    } finally {
      setLoadingTopSelling(false);
    }
  }, [store?.id]);

  useEffect(() => {
    fetchTopSellingProducts();
  }, [fetchTopSellingProducts]);

  // أصناف آخر فاتورة سابقة
  const lastInvoiceProducts = useMemo(() => {
    if (lastReceiptData?.lines && lastReceiptData.lines.length > 0) {
      return lastReceiptData.lines.map((l, i) => ({
        id: l.productId || l.id || `last-${i}`,
        productId: l.productId || null,
        name: l.name,
        barcode: l.barcode || '',
        price: l.unitPrice,
        priceAfterDiscount: l.unitPrice,
        unit: l.unit || 'قطعة',
      }));
    }
    if (shiftRecentInvoices.length > 0) {
      const first = shiftRecentInvoices[0];
      let lines = [];
      if (Array.isArray(first.line_items)) lines = first.line_items;
      else if (typeof first.line_items === 'string') {
        try {
          lines = JSON.parse(first.line_items);
        } catch {}
      }
      return lines.map((l, i) => ({
        id: l.product_id || l.id || `last-inv-${i}`,
        productId: l.product_id || null,
        name: l.name,
        barcode: l.barcode || '',
        price: Number(l.unit_price || l.price || 0),
        priceAfterDiscount: Number(l.unit_price || l.price || 0),
        unit: l.unit || 'قطعة',
      }));
    }
    return [];
  }, [lastReceiptData, shiftRecentInvoices]);

  // استرجاع وحفظ مسودة الفاتورة في localStorage لضمان عدم ضياع الأصناف عند التنقل
  const invoiceRestoredRef = useRef(false);

  // استرجاع الفاتورة عند توفر الشيفت الحالي للمتجر
  useEffect(() => {
    if (!activeShift?.id || !store?.id) return;

    // حفظ معرف الشيفت النشط للمتجر
    try {
      localStorage.setItem(getLastSessionStorageKey(store.id), activeShift.id);
    } catch {
      /* ignore */
    }

    if (invoiceRestoredRef.current) return;

    const draftKey = getDraftInvoiceStorageKey(store.id, activeShift.id);
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setOrderItems((current) => {
            if (current.length === 0) return parsed;
            return current;
          });
        }
      }
    } catch (err) {
      console.warn('[SupermarketPOS] Error restoring draft invoice:', err);
    } finally {
      invoiceRestoredRef.current = true;
    }
  }, [activeShift?.id, store?.id]);

  // حفظ الفاتورة تلقائياً عند أي تعديل (إضافة، تعديل، حذف) بـ debounce لمنع التأخير
  useEffect(() => {
    if (!activeShift?.id || !store?.id) return;
    if (!invoiceRestoredRef.current) return;

    const draftKey = getDraftInvoiceStorageKey(store.id, activeShift.id);

    const timer = setTimeout(() => {
      try {
        if (orderItems && orderItems.length > 0) {
          localStorage.setItem(draftKey, JSON.stringify(orderItems));
        } else {
          localStorage.removeItem(draftKey);
        }
      } catch (err) {
        console.warn('[SupermarketPOS] Error saving draft invoice:', err);
      }
    }, 150);

    return () => {
      clearTimeout(timer);
      try {
        if (orderItems && orderItems.length > 0) {
          localStorage.setItem(draftKey, JSON.stringify(orderItems));
        } else {
          localStorage.removeItem(draftKey);
        }
      } catch {
        /* ignore */
      }
    };
  }, [orderItems, activeShift?.id, store?.id]);

  // ── قائمة السياق وتعديل الصنف من جدول الفاتورة ──
  const [contextMenu, setContextMenu] = useState({
    isOpen: false,
    x: 0,
    y: 0,
    line: null,
  });

  const [editProductModalOpen, setEditProductModalOpen] = useState(false);
  const [editingProductItem, setEditingProductItem] = useState(null);

  // إغلاق قائمة السياق بـ Escape
  useEffect(() => {
    if (!contextMenu.isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setContextMenu({ isOpen: false, x: 0, y: 0, line: null });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [contextMenu.isOpen]);

  // فتح قائمة السياق عند النقر بالزر الأيمن على أي صف بجدول الفاتورة
  const handleRowContextMenu = (e, line) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 230;
    const menuHeight = 90;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 12);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 12);
    setContextMenu({
      isOpen: true,
      x: Math.max(12, x),
      y: Math.max(12, y),
      line,
    });
  };

  // فتح مودال تعديل الصنف وجلب بياناته الكاملة
  const handleOpenEditProductModal = async (line) => {
    if (!line) return;

    let productData = null;
    try {
      if (line.productId && isUuid(line.productId)) {
        const { data, error } = await runProductsSelectWithFallback((sel) =>
          supabase
            .from(PRODUCTS_TABLE)
            .select(sel)
            .eq('id', line.productId)
            .eq('store_id', store.id)
            .maybeSingle()
        );
        if (!error && data) productData = normalizeItemFromSupabase(data);
      }
      if (!productData && line.barcode && line.barcode !== '—') {
        const { data, error } = await runProductsSelectWithFallback((sel) =>
          supabase
            .from(PRODUCTS_TABLE)
            .select(sel)
            .eq('barcode', line.barcode)
            .eq('store_id', store.id)
            .maybeSingle()
        );
        if (!error && data) productData = normalizeItemFromSupabase(data);
      }
    } catch (err) {
      console.warn('[SupermarketPOS] Error fetching product for edit modal:', err);
    }

    if (!productData) {
      productData =
        items.find(
          (i) =>
            (line.productId && i.id === line.productId) ||
            (line.barcode && line.barcode !== '—' && i.barcode === line.barcode)
        ) || {
          id: line.productId,
          barcode: line.barcode !== '—' ? line.barcode : '',
          name: line.baseName || line.name,
          price: line.basePrice || line.unitPrice,
          priceAfterDiscount: line.unitPrice,
          stock: 0,
        };
    }

    setEditingProductItem(productData);
    setEditProductModalOpen(true);
  };

  // مزامنة الصنف المعدل في الفاتورة الحالية وقائمة الأصناف
  const handleProductEditSuccess = async (updatedProd, isNew, unitsToSave) => {
    await fetchStoreProducts();

    if (updatedProd?.id && unitsToSave) {
      setProductUnitsMap((prev) => ({
        ...prev,
        [updatedProd.id]: unitsToSave,
      }));
    }

    const newSalePrice = roundMoney(
      updatedProd.price_after_disc != null && updatedProd.price_after_disc !== ''
        ? Number(updatedProd.price_after_disc)
        : Number(updatedProd.full_price ?? updatedProd.price ?? 0)
    );
    const newProdName = updatedProd.eng_name || updatedProd.name || '';

    setOrderItems((prev) =>
      prev.map((line) => {
        const isTargetLine =
          (updatedProd.id && line.productId === updatedProd.id) ||
          (updatedProd.barcode && line.barcode === updatedProd.barcode) ||
          (editingProductItem?.id && line.productId === editingProductItem.id) ||
          (editingProductItem?.barcode && line.barcode === editingProductItem.barcode);

        if (!isTargetLine) return line;

        let updatedUnitPrice = newSalePrice;
        if (line.conversionFactor && line.conversionFactor > 1 && line.unit && line.unit !== 'قطعة') {
          const units = unitsToSave || (line.productId && productUnitsMap[line.productId]) || [];
          const foundUnit = units.find((u) => u.unit_name === line.unit);
          if (foundUnit && foundUnit.sale_price != null) {
            updatedUnitPrice = Number(foundUnit.sale_price);
          } else {
            updatedUnitPrice = roundMoney(newSalePrice * line.conversionFactor);
          }
        }

        const baseTitle = newProdName || line.baseName || line.name;
        const displayTitle =
          line.unit && line.unit !== 'قطعة' ? `${baseTitle} (${line.unit})` : baseTitle;
        const updatedLineTotal = roundMoney(
          Math.max(0, line.qty * updatedUnitPrice - (line.discount || 0))
        );

        return {
          ...line,
          name: displayTitle,
          baseName: baseTitle,
          barcode: updatedProd.barcode || line.barcode,
          basePrice: newSalePrice,
          unitPrice: updatedUnitPrice,
          lineTotal: updatedLineTotal,
        };
      })
    );

    setEditProductModalOpen(false);
    setEditingProductItem(null);
  };

  const handleProductDeleteSuccess = async (deletedProd) => {
    setOrderItems((prev) =>
      prev.filter(
        (it) =>
          it.productId !== deletedProd?.id &&
          it.barcode !== deletedProd?.barcode &&
          it.productId !== editingProductItem?.id
      )
    );
    await fetchStoreProducts();
    setEditProductModalOpen(false);
    setEditingProductItem(null);
  };

  // خريطة وحدات المنتجات المسجلة في جدول product_units للأصناف الحالية
  const [productUnitsMap, setProductUnitsMap] = useState({});

  // جلب الوحدات المسجلة لأصناف الفاتورة تلقائياً عند إضافتها
  useEffect(() => {
    const missingIds = orderItems
      .map((o) => o.productId)
      .filter((id) => id && isUuid(id) && !productUnitsMap[id]);

    if (missingIds.length > 0 && store?.id) {
      fetchUnitsForProductIds(missingIds, store.id).then((map) => {
        if (map && Object.keys(map).length > 0) {
          setProductUnitsMap((prev) => ({ ...prev, ...map }));
        }
      });
    }
  }, [orderItems, store?.id, productUnitsMap]);

  // مزامنة وتثبيت باركود مستقل لكرتونة دخان امبريال لمنع التعارض مع باركود الصنف
  useEffect(() => {
    if (!store?.id) return;
    const imperialId = '623f38f2-8bb6-4a0c-a2a4-7dbb0546e984';
    fetchUnitsByProductId(imperialId, store.id).then(async (units) => {
      const cartonUnit = (units || []).find((u) => u.unit_name === 'كرتونة');
      if (!cartonUnit || cartonUnit.barcode === '1212121212' || (units || []).length === 0) {
        const fixedUnits = [
          {
            unit_name: 'قطعة',
            conversion_factor: 1,
            barcode: '1212121212',
            sale_price: 27,
            is_base_unit: true,
          },
          {
            unit_name: 'كرتونة',
            conversion_factor: 10,
            barcode: '1212121212-BOX',
            sale_price: 270,
            is_base_unit: false,
          },
        ];
        const res = await saveProductUnits(imperialId, store.id, fixedUnits);
        if (res?.success) {
          setProductUnitsMap((prev) => ({ ...prev, [imperialId]: fixedUnits }));
        }
      } else {
        setProductUnitsMap((prev) => ({ ...prev, [imperialId]: units }));
      }
    }).catch((err) => {
      console.warn('[SupermarketPOS] Error syncing imperial units:', err);
    });
  }, [store?.id]);

  // تغيير الوحدة يدوياً من سطر الفاتورة
  const handleUnitChange = (lineId, newUnitName) => {
    setOrderItems((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        const units = productUnitsMap[line.productId] || [];
        const foundUnit = units.find((u) => u.unit_name === newUnitName);

        let newPrice = line.unitPrice;
        let newConv = 1;
        if (foundUnit) {
          newPrice = Number(foundUnit.sale_price) || line.unitPrice;
          newConv = Number(foundUnit.conversion_factor) || 1;
        } else if (newUnitName === 'قطعة') {
          newPrice = line.basePrice ?? line.unitPrice;
          newConv = 1;
        }

        const lineTotal = roundMoney(Math.max(0, line.qty * newPrice - (line.discount || 0)));
        const baseTitle = line.baseName || line.name.replace(/\s*\([^)]*\)$/, '');
        const displayName =
          newUnitName && newUnitName !== 'قطعة' ? `${baseTitle} (${newUnitName})` : baseTitle;

        return {
          ...line,
          name: displayName,
          unit: newUnitName,
          unitPrice: newPrice,
          conversionFactor: newConv,
          lineTotal,
        };
      })
    );
  };

  // إضافة منتج بالباركود (إن وُجد يزيد الكمية +1 وإلا يضيف سطراً جديداً)
  const addOrIncrementProduct = useCallback(
    (product, customQty = 1, unitOverride = null) => {
      const normBc = normalizeDigitsToLatin(String(product.barcode || '').trim());
      const defaultPrice = roundMoney(product.priceAfterDiscount ?? product.price ?? 0);
      const targetUnit = unitOverride?.unit || (product.box ? 'كرتونة' : 'قطعة');
      const targetPrice = unitOverride?.unitPrice != null ? unitOverride.unitPrice : defaultPrice;
      const targetConv = unitOverride?.conversionFactor != null ? unitOverride.conversionFactor : 1;
      const displayName =
        unitOverride?.unit && unitOverride.unit !== 'قطعة'
          ? `${product.name} (${unitOverride.unit})`
          : (product.name || 'منتج');

      setOrderItems((prev) => {
        const existingIdx = prev.findIndex((line) => {
          if (line.productId && line.productId === product.id && line.unit === targetUnit) return true;
          if (!line.productId && normBc && line.barcode === normBc && line.unit === targetUnit) return true;
          return false;
        });

        if (existingIdx >= 0) {
          const next = [...prev];
          const cur = next[existingIdx];
          const nextQty = roundMoney(cur.qty + customQty);
          const lineTotal = roundMoney(Math.max(0, nextQty * cur.unitPrice - (cur.discount || 0)));
          next[existingIdx] = { ...cur, qty: nextQty, lineTotal };
          return next;
        }

        const newQty = customQty;
        const lineTotal = roundMoney(Math.max(0, newQty * targetPrice));
        const newLine = {
          id: 'item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          productId: product.id || null,
          barcode: normBc || '—',
          name: displayName,
          baseName: product.name || 'منتج',
          unit: targetUnit,
          basePrice: defaultPrice,
          conversionFactor: targetConv,
          qty: newQty,
          unitPrice: targetPrice,
          discount: 0,
          lineTotal: lineTotal,
        };
        return [newLine, ...prev];
      });

      playScanBeep(true);
      toast.success(`✓ أُضيف: ${displayName}`);
      setSearch('');
      setIsDropdownOpen(false);
      setActiveDropdownIndex(-1);
      setTimeout(() => barcodeInputRef.current?.focus(), 30);
    },
    [toast]
  );

  // ── مودال البحث الشامل عن صنف في المخزون (F4 / Ctrl+K) ──
  const [productSearchModalOpen, setProductSearchModalOpen] = useState(false);

  const handleSelectProductFromSearch = useCallback(
    (product, unitOverride) => {
      addOrIncrementProduct(product, 1, unitOverride);
      setProductSearchModalOpen(false);
      setTimeout(() => barcodeInputRef.current?.focus(), 80);
    },
    [addOrIncrementProduct]
  );

  // معالجة مسح الباركود أو الضغط على Enter في الحقل
  const handleBarcodeSubmit = async (e) => {
    if (e) e.preventDefault();
    const raw = search.trim();
    if (!raw) return;

    const norm = normalizeDigitsToLatin(raw);

    // 1. فحص التطابق التام في المنتجات المحملة محلياً (الوحدة الأساسية)
    let hit =
      items.find((i) => normalizeDigitsToLatin(String(i.barcode || '').trim()) === norm) ||
      items.find(
        (i) =>
          normalizeDigitsToLatin(String(i.barcode || '').replace(/\s/g, '')) ===
          norm.replace(/\s/g, '')
      );

    // 2. إذا لم يُعثر عليه، استعلام مباشر من جدول products
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
        console.error('Error searching barcode in products:', err);
      }
    }

    if (hit) {
      if (hit.id && store?.id && !productUnitsMap[hit.id]) {
        fetchUnitsByProductId(hit.id, store.id).then((units) => {
          if (units && units.length > 0) {
            setProductUnitsMap((prev) => ({ ...prev, [hit.id]: units }));
          }
        });
      }
      addOrIncrementProduct(hit, 1);
      return;
    }

    // 2.5. فحص جدول الوحدات الإضافية product_units بالباركود
    if (store?.id) {
      try {
        const unitHit = await findUnitByBarcode(norm, store.id);
        if (unitHit && unitHit.product) {
          const prodRow = normalizeItemFromSupabase(unitHit.product);
          if (prodRow) {
            setProductUnitsMap((prev) => ({
              ...prev,
              [prodRow.id]: [
                ...(prev[prodRow.id] || []).filter((u) => u.id !== unitHit.id),
                unitHit,
              ],
            }));
            addOrIncrementProduct(prodRow, 1, {
              unit: unitHit.unit_name,
              unitPrice: Number(unitHit.sale_price) || prodRow.price,
              conversionFactor: Number(unitHit.conversion_factor) || 1,
            });
            return;
          }
        }
      } catch (unitErr) {
        console.warn('Error searching barcode in product_units:', unitErr);
      }
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
  const [suppliersList, setSuppliersList] = useState([]);

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

  const openNewProductModal = (barcode) => {
    setIsDropdownOpen(false);
    setSearch('');
    const cleanBc = String(barcode || '').trim();
    setNewProductModal({ barcode: cleanBc, isInventoryOnly: false });
  };

  // فتح المودال من زر "إضافة صنف للمخزون" (حفظ للمخزون فقط دون إضافته للفاتورة الحالية)
  const openNewProductForInventoryOnly = () => {
    setIsDropdownOpen(false);
    setSearch('');
    setNewProductModal({ barcode: '', isInventoryOnly: true });
  };

  const handleCancelNewProduct = () => {
    setNewProductModal(null);
    setTimeout(() => barcodeInputRef.current?.focus(), 50);
  };

  const handleNewProductSuccess = async (inserted, isNew, unitsToSave) => {
    await fetchStoreProducts();
    if (inserted?.id && unitsToSave) {
      setProductUnitsMap((prev) => ({ ...prev, [inserted.id]: unitsToSave }));
    }

    if (newProductModal && !newProductModal.isInventoryOnly) {
      const unitVal =
        unitsToSave?.find((u) => u.is_base_unit)?.unit_name ||
        inserted?.product_units?.[0]?.unit_name ||
        'قطعة';
      const priceVal =
        inserted?.full_price != null && inserted?.full_price !== ''
          ? Number(inserted.full_price)
          : Number(inserted?.price ?? 0);
      const prodName = inserted?.eng_name || inserted?.name || 'منتج جديد';
      const newLine = {
        id: 'item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        productId: inserted?.id || null,
        barcode: inserted?.barcode || '—',
        name: prodName,
        baseName: prodName,
        unit: unitVal,
        baseUnit: unitVal,
        conversionFactor: 1,
        unitPrice: priceVal,
        basePrice: priceVal,
        qty: 1,
        discount: 0,
        lineTotal: priceVal,
      };

      setOrderItems((prev) => [newLine, ...prev]);
      playScanBeep(true);
    }

    setNewProductModal(null);
    setTimeout(() => barcodeInputRef.current?.focus(), 80);
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
    if (activeShift?.id && store?.id) {
      try {
        localStorage.removeItem(getDraftInvoiceStorageKey(store.id, activeShift.id));
      } catch {
        /* ignore */
      }
    }
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


  // ─────────────────────────────────────────────────────────────
  // 5.5 إدارة الفواتير المعلّقة (Hold / Park Sales)
  // ─────────────────────────────────────────────────────────────
  const saveHeldInvoices = useCallback(
    (newHeldList) => {
      setHeldInvoices(newHeldList);
      if (!activeShift?.id || !store?.id) return;
      const key = getHeldInvoicesStorageKey(store.id, activeShift.id);
      try {
        if (newHeldList && newHeldList.length > 0) {
          localStorage.setItem(key, JSON.stringify(newHeldList));
        } else {
          localStorage.removeItem(key);
        }
      } catch (err) {
        console.warn('[SupermarketPOS] Error persisting held invoices:', err);
      }
    },
    [activeShift?.id, store?.id]
  );

  // تعليق الفاتورة الحالية (Hold Sale)
  const handleHoldCurrentInvoice = () => {
    if (!orderItems || orderItems.length === 0) {
      toast.warning('لا توجد أصناف في الفاتورة الحالية لتعليقها.');
      return;
    }
    const maxNum = heldInvoices.reduce((max, inv) => Math.max(max, Number(inv.number) || 0), 0);
    const holdNum = maxNum + 1;
    const now = new Date();
    const newHeld = {
      id: 'held-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      number: holdNum,
      heldAt: now.toISOString(),
      displayTime: now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
      items: [...orderItems],
      tenderedAmount: tenderedAmount || '',
      totalAmount: invoiceTotals.payable,
      totalUnits: invoiceTotals.totalUnits,
      itemCount: orderItems.length,
    };

    const nextList = [newHeld, ...heldInvoices];
    saveHeldInvoices(nextList);
    clearInvoice();
    toast.success(`✓ تم تعليق الفاتورة #${holdNum} بنجاح! الشاشة جاهزة لزبون جديد`);
    setTimeout(() => barcodeInputRef.current?.focus(), 50);
  };

  // استرجاع فاتورة معلقة مباشرة (عندما تكون السلة الحالية فارغة)
  const handleDirectRestoreHeldInvoice = (targetInv) => {
    if (!targetInv) return;
    const nextList = heldInvoices.filter((i) => i.id !== targetInv.id);
    saveHeldInvoices(nextList);
    setOrderItems(targetInv.items || []);
    setTenderedAmount(targetInv.tenderedAmount || '');
    setHeldInvoicesModalOpen(false);
    toast.success(`✓ تم استرجاع الفاتورة المعلّقة #${targetInv.number}`);
    setTimeout(() => barcodeInputRef.current?.focus(), 80);
  };

  // تعليق الفاتورة الحالية الجارية واسترجاع الفاتورة المعلّقة المختارة
  const handleHoldCurrentAndRestore = (targetInv) => {
    if (!targetInv) return;
    const maxNum = heldInvoices.reduce((max, inv) => Math.max(max, Number(inv.number) || 0), 0);
    const newHoldNum = maxNum + 1;
    const now = new Date();
    const currentHeld = {
      id: 'held-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      number: newHoldNum,
      heldAt: now.toISOString(),
      displayTime: now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
      items: [...orderItems],
      tenderedAmount: tenderedAmount || '',
      totalAmount: invoiceTotals.payable,
      totalUnits: invoiceTotals.totalUnits,
      itemCount: orderItems.length,
    };

    const nextList = [currentHeld, ...heldInvoices.filter((i) => i.id !== targetInv.id)];
    saveHeldInvoices(nextList);
    setOrderItems(targetInv.items || []);
    setTenderedAmount(targetInv.tenderedAmount || '');
    setHeldInvoicesModalOpen(false);
    toast.success(`✓ عُلّقت الفاتورة السابقة (#${newHoldNum}) واستُرجعت الفاتورة #${targetInv.number}`);
    setTimeout(() => barcodeInputRef.current?.focus(), 80);
  };

  // تفريغ الفاتورة الحالية واسترجاع الفاتورة المعلّقة المختارة
  const handleDiscardCurrentAndRestore = (targetInv) => {
    if (!targetInv) return;
    const nextList = heldInvoices.filter((i) => i.id !== targetInv.id);
    saveHeldInvoices(nextList);
    setOrderItems(targetInv.items || []);
    setTenderedAmount(targetInv.tenderedAmount || '');
    setHeldInvoicesModalOpen(false);
    toast.success(`✓ تم تفريغ الحالية واسترجاع الفاتورة #${targetInv.number}`);
    setTimeout(() => barcodeInputRef.current?.focus(), 80);
  };

  // حذف فاتورة معلقة
  const handleDeleteHeldInvoice = (invoiceId) => {
    const nextList = heldInvoices.filter((i) => i.id !== invoiceId);
    saveHeldInvoices(nextList);
    toast.success('تم حذف الفاتورة المعلّقة');
  };

  // ─────────────────────────────────────────────────────────────
  // 5.6 تنفيذ إرجاع صنف من فاتورة مكتملة بالشيفت
  // ─────────────────────────────────────────────────────────────
  const handleReturnItemFromSale = async (sale, item, returnQty, returnAmount, reason = '') => {
    if (!sale?.id || !item || !store?.id) return;

    try {
      // 1. زيادة المخزون للصنف المرتجع
      const prodId = item.product_id && isUuid(item.product_id) ? item.product_id : null;
      const factor = Number(item.conversion_factor || item.conversionFactor || 1);
      const restockQty = Math.max(0.001, returnQty * factor);

      if (prodId) {
        const { error: rpcErr } = await supabase.rpc('increment_stock', {
          row_id: prodId,
          amount: restockQty,
        });

        let prevStock = 0;
        let newStock = 0;
        try {
          const { data: prodRow } = await supabase
            .from(PRODUCTS_TABLE)
            .select(PRODUCTS_STOCK_COLUMN)
            .eq('id', prodId)
            .maybeSingle();

          prevStock = Number(prodRow?.[PRODUCTS_STOCK_COLUMN] ?? 0);
          if (rpcErr) {
            newStock = prevStock + restockQty;
            await supabase
              .from(PRODUCTS_TABLE)
              .update({ [PRODUCTS_STOCK_COLUMN]: newStock })
              .eq('id', prodId);
          } else {
            newStock = prevStock;
          }
        } catch {}

        try {
          await insertInventoryLog({
            storeId: store.id,
            productId: prodId,
            barcode: item.barcode || null,
            productName: `مرتجع من فاتورة #${String(sale.id).slice(0, 8).toUpperCase()}: ${item.name} (${returnQty} ${item.unit || 'قطعة'})`,
            qtyBefore: prevStock,
            qtyAfter: newStock,
            reason: 'sale_return',
          });
        } catch {}

        // تحديث المخزون في الذاكرة الحالية
        setItems((prev) =>
          prev.map((it) => (it.id === prodId ? { ...it, stock: (it.stock ?? 0) + restockQty } : it))
        );
      }

      // 2. التسوية المالية: إذا كانت الفاتورة آجل، تنقص من دين الزبون
      const mode = (sale.payment_mode || '').toLowerCase();
      const method = (sale.payment_method || '').toLowerCase();
      const isCredit = mode === 'credit' || method === 'deferred' || method === 'credit';

      if (isCredit && sale.contact_id) {
        try {
          await applyCreditSaleReturn(supabase, {
            storeId: store.id,
            saleId: sale.id,
            contactId: sale.contact_id,
            totalAmount: returnAmount,
            sourceLabel: `إرجاع صنف ${item.name}`,
          });
        } catch (creditErr) {
          console.warn('Error applying credit return:', creditErr);
        }
      } else {
        // نقدي / بطاقة: عكس المبلغ من صندوق الكاش إن أمكن
        try {
          await applyCashSaleReturnFromFund(supabase, {
            storeId: store.id,
            saleId: sale.id,
            totalAmount: returnAmount,
            sourceLabel: `إرجاع صنف ${item.name}`,
          });
        } catch (cashErr) {
          console.warn('Error applying cash return fund deduction:', cashErr);
        }
      }

      // 3. توثيق المرتجع في سجل الفاتورة نفسها (تحديث الملاحظات وبنود الفاتورة)
      try {
        const returnNote = `[مرتجع: تم إرجاع ${returnQty} من "${item.name}" بقيمة ${returnAmount} ₪${reason ? ` (السبب: ${reason})` : ''} في ${new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}]`;
        const updatedNotes = sale.notes ? `${sale.notes}\n${returnNote}` : returnNote;

        // تحديث line_items لتحديد الكمية المرتجعة
        let lines = [];
        if (Array.isArray(sale.line_items)) lines = [...sale.line_items];
        else if (typeof sale.line_items === 'string') {
          try { lines = JSON.parse(sale.line_items); } catch {}
        }

        const matchedLineIdx = lines.findIndex(
          (l) =>
            (l.product_id && l.product_id === item.product_id) ||
            (l.barcode && l.barcode === item.barcode) ||
            l.name === item.name
        );
        if (matchedLineIdx >= 0) {
          lines[matchedLineIdx] = {
            ...lines[matchedLineIdx],
            returned_qty: Number(lines[matchedLineIdx].returned_qty || 0) + returnQty,
          };
        }

        await supabase
          .from('sales')
          .update({
            notes: updatedNotes,
            line_items: lines,
          })
          .eq('id', sale.id);
      } catch (saleUpErr) {
        console.warn('Error updating sale record with return details:', saleUpErr);
      }

      // 4. تحديث العدادات اللحظية
      if (isCredit) {
        setShiftSalesTotals((prev) => ({
          ...prev,
          creditTotal: roundMoney(Math.max(0, prev.creditTotal - returnAmount)),
        }));
      } else {
        setShiftSalesTotals((prev) => ({
          ...prev,
          paidTotal: roundMoney(Math.max(0, prev.paidTotal - returnAmount)),
        }));
      }

      toast.success(
        `✓ تم إرجاع ${returnQty} من (${item.name}) بقيمة ${returnAmount} ₪ بنجاح وتحديث المخزون والمالية`
      );

      // إعادة جلب فواتير الشيفت المحدثة
      fetchShiftRecentInvoices();
      setTimeout(() => barcodeInputRef.current?.focus(), 80);
    } catch (err) {
      console.error('Failed to process item return:', err);
      toast.error('حدث خطأ أثناء تنفيذ الإرجاع: ' + (err.message || ''));
      throw err;
    }
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
        conversion_factor: Number(o.conversionFactor) || 1,
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

      // خصم المخزون للأصناف المرتبطة بمنتج في قاعدة البيانات (ضرب الكمية × نسبة التحويل)
      for (const line of orderItems) {
        if (line.productId && isUuid(line.productId)) {
          const factor = Number(line.conversionFactor) || 1;
          const baseQty = Math.max(0.001, (Number(line.qty) || 1) * factor);
          let prevStock = 0;
          let newStock = 0;
          try {
            // جلب المخزون الحالي للمقارنة والتوثيق
            const { data: prodRow } = await supabase
              .from(PRODUCTS_TABLE)
              .select(PRODUCTS_STOCK_COLUMN)
              .eq('id', line.productId)
              .maybeSingle();

            prevStock = Number(prodRow?.[PRODUCTS_STOCK_COLUMN] ?? 0);

            // استدعاء دالة decrement_stock الرسمية من Supabase RPC
            const { error: rpcError } = await supabase.rpc('decrement_stock', {
              row_id: line.productId,
              amount: baseQty,
            });

            if (rpcError) {
              console.warn('[SupermarketPOS] RPC decrement_stock warning, falling back to direct update:', rpcError);
              newStock = Math.max(0, prevStock - baseQty);
              await supabase
                .from(PRODUCTS_TABLE)
                .update({ [PRODUCTS_STOCK_COLUMN]: newStock })
                .eq('id', line.productId);
            } else {
              newStock = Math.max(0, prevStock - baseQty);
            }

            // توثيق حركة المخزون في inventory_logs إن وُجد الجدول
            try {
              await insertInventoryLog({
                storeId: store.id,
                productId: line.productId,
                barcode: line.barcode ? String(line.barcode) : null,
                productName: factor > 1
                  ? `${line.name} (${line.qty} ${line.unit} = ${baseQty} قطعة)`
                  : (line.name || ''),
                qtyBefore: prevStock,
                qtyAfter: newStock,
                reason: 'sale',
              });
            } catch (logErr) {
              /* inventory_logs جدول اختياري */
            }
          } catch (stockErr) {
            console.warn('[SupermarketPOS] Error decrementing stock for item:', line.name, stockErr);
          }
        }
      }

      // تحديث المخزون في الذاكرة المحلية فوراً مع احتساب نسبة التحويل
      setItems((prev) =>
        prev.map((it) => {
          const matched = orderItems.find((o) => o.productId === it.id);
          if (matched) {
            const factor = Number(matched.conversionFactor) || 1;
            const baseQty = Math.max(1, Math.round((Number(matched.qty) || 1) * factor));
            const curStock = Number(it.stock ?? it.stock_count ?? 0);
            const nextStock = Math.max(0, curStock - baseQty);
            return { ...it, stock: nextStock, stock_count: nextStock };
          }
          return it;
        })
      );

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

      // تحديث عداد مبيعات الوردية اللحظي وقائمة آخر الفواتير
      if (paymentMode === 'credit') {
        setShiftSalesTotals((prev) => ({
          ...prev,
          creditTotal: roundMoney(prev.creditTotal + payable),
          count: prev.count + 1,
        }));
      } else {
        setShiftSalesTotals((prev) => ({
          ...prev,
          paidTotal: roundMoney(prev.paidTotal + payable),
          count: prev.count + 1,
        }));
      }
      fetchShiftRecentInvoices();
      fetchTopSellingProducts();

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
        creditModalOpen ||
        productSearchModalOpen ||
        heldInvoicesModalOpen ||
        recentInvoicesModalOpen
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
  }, [
    activeShift,
    closeShiftModalOpen,
    quickSectionModal,
    newProductModal,
    creditModalOpen,
    productSearchModalOpen,
    heldInvoicesModalOpen,
    recentInvoicesModalOpen,
  ]);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (recentInvoicesModalOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setRecentInvoicesModalOpen(false);
          setTimeout(() => barcodeInputRef.current?.focus(), 60);
        }
        return;
      }

      if (heldInvoicesModalOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setHeldInvoicesModalOpen(false);
          setTimeout(() => barcodeInputRef.current?.focus(), 60);
        }
        return;
      }

      if (moreMenuOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setMoreMenuOpen(false);
          return;
        }
      }

      if (paletteMenuOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setPaletteMenuOpen(false);
          return;
        }
      }

      if (productSearchModalOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setProductSearchModalOpen(false);
          setTimeout(() => barcodeInputRef.current?.focus(), 60);
        }
        return;
      }

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

      // اختصارات F1 نقدي، F2 بطاقة، F3 آجل، F4 / Ctrl+K بحث صنف
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
      if (e.key === 'F4' || ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K'))) {
        e.preventDefault();
        e.stopPropagation();
        setProductSearchModalOpen((prev) => !prev);
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
    productSearchModalOpen,
    heldInvoicesModalOpen,
    recentInvoicesModalOpen,
    moreMenuOpen,
    paletteMenuOpen,
    invoiceTotals.payable,
    orderItems,
  ]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setIsDropdownOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
        setMoreMenuOpen(false);
      }
      if (paletteMenuRef.current && !paletteMenuRef.current.contains(e.target)) {
        setPaletteMenuOpen(false);
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
      <div className={`flex h-screen w-full items-center justify-center ${isDark ? activeTheme.darkBg : activeTheme.lightBg} text-slate-900 dark:text-white font-arabic transition-colors duration-300`} dir="rtl">
        <div className="flex flex-col items-center gap-4">
          <div className={`h-12 w-12 rounded-2xl bg-gradient-to-tr ${activeTheme.brandGradient} flex items-center justify-center animate-pulse shadow-lg`}>
            <Store size={26} className="text-white" />
          </div>
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">جاري التحقق من جلسة الصندوق...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-screen overflow-hidden ${isDark ? activeTheme.darkBg : activeTheme.lightBg} font-arabic text-slate-900 dark:text-slate-100 transition-colors duration-300`}
      dir="rtl"
      style={{ fontFamily: 'Cairo, Tajawal, ui-sans-serif, system-ui' }}
    >
      {/* السايدبار الرئيسي */}
      <Sidebar collapsible collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} />

      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
        {/* ── شريط الرأس العلوي المنظم بصفين: صف الحالة والمعلومات + صف البحث والمسح ── */}
        <header className="shrink-0 border-b border-slate-200/80 dark:border-white/10 bg-white/95 dark:bg-slate-900/90 backdrop-blur-xl transition-colors">
          {/* الصف الأول: معلومات وحالة — أزرار وبطاقات صغيرة */}
          <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-1.5 border-b border-slate-200/60 dark:border-white/5 text-xs">
            {/* يمين: الشعار، زر الصوت، إغلاق الصندوق، بدء الشيفت، مبيعات الوردية، الافتتاحي */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 min-w-0 flex-wrap">
              {sidebarCollapsed && (
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-indigo-300 hover:bg-slate-100 dark:hover:bg-white/10 transition"
                  title="إظهار القائمة"
                >
                  <Menu size={15} />
                </button>
              )}

              {/* شعار واسم نقطة البيع */}
              <div className="flex items-center gap-1.5 shrink-0">
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr ${activeTheme.brandGradient} text-white shadow-2xs`}>
                  <Store size={15} />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-black text-slate-900 dark:text-white">كاشير سوبرماركت</span>
                  <span className="hidden sm:inline-block rounded-full bg-emerald-500/10 dark:bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.2 text-[9px] font-bold text-emerald-700 dark:text-emerald-300">
                    سريع
                  </span>
                  {store?.name && (
                    <span className="hidden md:inline-block text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                      • {store.name}
                    </span>
                  )}
                </div>
              </div>

              <span className="h-3.5 w-px bg-slate-200 dark:bg-white/10 mx-0.5 shrink-0" />

              {/* 1. زر الصوت 🔊 (مكتوم أو مفعل) */}
              <button
                type="button"
                onClick={toggleSound}
                className={`inline-flex items-center gap-1 h-7 px-2 rounded-lg border text-[11px] font-bold transition shadow-2xs cursor-pointer shrink-0 ${
                  soundEnabled
                    ? 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'
                    : 'border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10'
                }`}
                title={soundEnabled ? 'كتم صوت الإشعارات والمسح (🔊 مفعّل)' : 'تشغيل صوت الإشعارات والمسح (🔇 مكتوم)'}
              >
                {soundEnabled ? (
                  <>
                    <Volume2 size={13} className="text-emerald-600 dark:text-emerald-400" />
                    <span className="hidden sm:inline">صوت: شغال</span>
                  </>
                ) : (
                  <>
                    <VolumeX size={13} />
                    <span className="hidden sm:inline">صوت: صامت</span>
                  </>
                )}
              </button>

              {/* 2. إغلاق الصندوق */}
              {activeShift ? (
                <button
                  type="button"
                  onClick={openCloseShiftModal}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-rose-200/80 dark:border-rose-500/30 bg-rose-50/80 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-[11px] font-bold text-rose-700 dark:text-rose-300 shadow-2xs transition shrink-0 cursor-pointer"
                  title="إغلاق الصندوق وإنهاء الشيفت"
                >
                  <Lock size={12} className="text-rose-600 dark:text-rose-400" />
                  <span>إغلاق الصندوق</span>
                </button>
              ) : null}

              {/* 3. بدء الشيفت (الوقت) */}
              {activeShift?.opened_at ? (
                <div className="hidden min-[1400px]:inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-slate-200/80 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-[11px] text-slate-700 dark:text-slate-200 shadow-2xs shrink-0">
                  <Calendar size={12} className="text-emerald-500 dark:text-emerald-400 shrink-0" />
                  <span className="text-slate-500 dark:text-slate-400">بدء الشيفت:</span>
                  <strong className="font-mono font-bold text-slate-800 dark:text-slate-200">
                    {new Date(activeShift.opened_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                  </strong>
                </div>
              ) : null}

              {/* 4. مبيعات الوردية */}
              {activeShift ? (
                <div className={`hidden md:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border-r-2 ${activeTheme.salesBadgeBorder} border border-slate-200/80 dark:border-white/10 text-[11px] shadow-2xs shrink-0`}>
                  <TrendingUp size={12} className={`shrink-0 ${activeTheme.salesIcon}`} />
                  <span className="text-slate-500 dark:text-slate-400">مبيعات الوردية:</span>
                  <strong className={`font-mono font-bold ${activeTheme.salesText}`}>
                    {shiftSalesTotals.paidTotal} ₪
                  </strong>
                  {shiftSalesTotals.creditTotal > 0 && (
                    <span
                      className="inline-flex items-center rounded bg-amber-100 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-700/80 px-1 py-0.2 text-[9px] font-bold font-mono text-amber-800 dark:text-amber-300"
                      title="مبيعات بالآجل (ذمم)"
                    >
                      آجل: {shiftSalesTotals.creditTotal} ₪
                    </span>
                  )}
                </div>
              ) : null}

              {/* 5. الافتتاحي */}
              {activeShift ? (
                <div className="hidden lg:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border-r-2 border-r-emerald-500 border border-slate-200/80 dark:border-white/10 bg-emerald-50/40 dark:bg-emerald-950/20 text-[11px] text-slate-700 dark:text-slate-200 shadow-2xs shrink-0">
                  <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  <span className="text-slate-500 dark:text-slate-400">الافتتاحي:</span>
                  <strong className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                    {activeShift.opening_amount} ₪
                  </strong>
                </div>
              ) : null}

              {/* وصل آخر عملية إن وجد */}
              {lastReceiptData && (
                <button
                  type="button"
                  onClick={() => setSimpleReceiptPrint(lastReceiptData)}
                  className="hidden xl:inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-violet-200 dark:border-violet-500/30 bg-violet-50/70 dark:bg-violet-950/30 hover:bg-violet-100 dark:hover:bg-violet-900/50 text-[11px] font-bold text-violet-700 dark:text-violet-300 shadow-2xs transition shrink-0 cursor-pointer"
                  title="عرض وطباعة آخر وصل بيع"
                >
                  <Printer size={12} className="text-violet-600 dark:text-violet-400" />
                  <span>وصل {lastReceiptData.invoiceId}</span>
                </button>
              )}
            </div>

            {/* يسار: منتقي الثيم 🎨، قائمة (...) للشاشات الصغيرة، تبديل الوضع الداكن/الفاتح، وتكبير الشاشة */}
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 relative">
              {/* منتقي ثيم الألوان السريع 🎨 */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPaletteMenuOpen((prev) => !prev)}
                  className={`flex h-7 items-center gap-1.5 px-2 rounded-lg border transition shadow-2xs cursor-pointer text-[11px] font-bold ${
                    paletteMenuOpen
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                      : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
                  }`}
                  title="تغيير ثيم وألوان شاشة البيع"
                >
                  <Palette size={13} className={activeTheme.accentText} />
                  <span className="hidden lg:inline">{activeTheme.shortName}</span>
                  <span className={`h-2 w-2 rounded-full ${activeTheme.dotColor}`} />
                </button>

                {paletteMenuOpen && (
                  <div
                    ref={paletteMenuRef}
                    className="absolute left-0 top-full mt-1.5 z-50 w-60 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 shadow-2xl backdrop-blur-2xl text-xs space-y-1 animate-in fade-in zoom-in-95 duration-100"
                  >
                    <div className="px-2.5 py-1 text-[11px] font-bold text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800">
                      ثيم شاشة البيع:
                    </div>
                    {Object.values(POS_COLOR_THEMES).map((th) => (
                      <button
                        key={th.id}
                        type="button"
                        onClick={() => {
                          changeColorTheme(th.id);
                          setPaletteMenuOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl transition font-bold text-xs cursor-pointer ${
                          colorTheme === th.id
                            ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white ring-1 ring-emerald-500/40'
                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`h-3 w-3 rounded-full ${th.dotColor}`} />
                          <span>{th.name}</span>
                        </div>
                        {colorTheme === th.id && <CheckCircle2 size={14} className="text-emerald-500" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* قائمة (...) للشاشات الأصغر من 1400px */}
              <div className="relative min-[1400px]:hidden">
                <button
                  type="button"
                  onClick={() => setMoreMenuOpen((prev) => !prev)}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg border transition shadow-2xs cursor-pointer ${
                    moreMenuOpen
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300'
                      : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
                  }`}
                  title="عرض تفاصيل الوردية والخيارات الإضافية"
                >
                  <MoreHorizontal size={15} />
                </button>

                {moreMenuOpen && (
                  <div
                    ref={moreMenuRef}
                    className="absolute left-0 top-full mt-1.5 z-50 w-72 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-2xl backdrop-blur-2xl text-xs space-y-2.5 animate-in fade-in zoom-in-95 duration-100"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                      <span className="font-bold text-slate-800 dark:text-slate-100">تفاصيل الوردية الحالية</span>
                      <button
                        type="button"
                        onClick={() => setMoreMenuOpen(false)}
                        className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {activeShift ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                          <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            <Calendar size={13} className="text-emerald-500" />
                            بدء الشيفت:
                          </span>
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                            {activeShift.opened_at
                              ? new Date(activeShift.opened_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
                              : '—'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between p-2 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/30">
                          <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" />
                            المبلغ الافتتاحي:
                          </span>
                          <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                            {activeShift.opening_amount} ₪
                          </span>
                        </div>

                        <div className="flex items-center justify-between p-2 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/30">
                          <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            <TrendingUp size={13} className="text-emerald-600 dark:text-emerald-400" />
                            مبيعات الوردية (مدفوع):
                          </span>
                          <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                            {shiftSalesTotals.paidTotal} ₪
                          </span>
                        </div>

                        {shiftSalesTotals.creditTotal > 0 && (
                          <div className="flex items-center justify-between p-2 rounded-xl bg-amber-50/50 dark:bg-amber-950/30">
                            <span className="text-slate-500 dark:text-slate-400">مبيعات بالآجل (ذمم):</span>
                            <span className="font-mono font-bold text-amber-700 dark:text-amber-300">
                              {shiftSalesTotals.creditTotal} ₪
                            </span>
                          </div>
                        )}

                        {lastReceiptData && (
                          <button
                            type="button"
                            onClick={() => {
                              setSimpleReceiptPrint(lastReceiptData);
                              setMoreMenuOpen(false);
                            }}
                            className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-violet-200 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 font-bold hover:bg-violet-100 dark:hover:bg-violet-900/60 transition cursor-pointer"
                          >
                            <Printer size={14} />
                            <span>طباعة آخر وصل ({lastReceiptData.invoiceId})</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-slate-500 dark:text-slate-400 text-center py-2">لا توجد جلسة صندوق نشطة حالياً</p>
                    )}
                  </div>
                )}
              </div>

              {/* زر التبديل بين الوضع الليلي والنهاري (شمس/قمر) */}
              <button
                type="button"
                onClick={() => applyExplicitTheme(isDark ? 'light' : 'dark')}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-amber-300 hover:bg-slate-100 dark:hover:bg-white/10 shadow-2xs transition cursor-pointer"
                title={isDark ? 'التبديل إلى الوضع الفاتح (Light Mode)' : 'التبديل إلى الوضع الداكن (Dark Mode)'}
              >
                {isDark ? <Sun size={14} className="text-amber-400" /> : <Moon size={14} className="text-indigo-600" />}
              </button>

              {/* زر ملء الشاشة */}
              <button
                type="button"
                onClick={() => {
                  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
                  else document.exitFullscreen?.();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white transition cursor-pointer"
                title="ملء الشاشة"
              >
                <Maximize2 size={13} />
              </button>
            </div>
          </div>

          {/* الصف الثاني: البحث والمسح — العنصر الأهم، ياخد أوسع مساحة */}
          <div className="flex items-center gap-2.5 px-3 sm:px-4 py-2">
            {/* حقل إدخال الباركود فائق السرعة والدائم التركيز - يأخذ العرض الأكبر flex-1 */}
            <div ref={searchContainerRef} className="relative flex-1 min-w-0">
              <form onSubmit={handleBarcodeSubmit} className="relative w-full">
                <div className="relative flex items-center">
                  <div className={`absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none ${activeTheme.inputIcon}`}>
                    <ScanLine size={19} className="animate-pulse" />
                    <span className="h-4 w-px bg-slate-300 dark:bg-slate-700 hidden sm:inline-block" />
                    <Search size={15} className="text-slate-400 dark:text-slate-500 hidden sm:inline-block" />
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
                    className={`w-full h-11 rounded-xl border ${activeTheme.inputBorder} bg-gradient-to-r ${activeTheme.inputBg} pr-12 pl-10 text-sm font-medium text-slate-900 dark:text-white shadow-inner backdrop-blur-md transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 ${activeTheme.inputFocus} focus:outline-none focus:ring-2`}
                    autoComplete="off"
                    spellCheck="false"
                  />

                  {search ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch('');
                        setIsDropdownOpen(false);
                        barcodeInputRef.current?.focus();
                      }}
                      className="absolute left-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white transition cursor-pointer"
                      title="مسح البحث"
                    >
                      <X size={15} />
                    </button>
                  ) : null}
                </div>
              </form>

              {/* قائمة نتائج البحث الجزئي بالاسم */}
              {isDropdownOpen && search.trim() && (
                <div className="absolute top-[calc(100%+6px)] right-0 left-0 z-50 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white/95 dark:bg-slate-900/95 shadow-2xl backdrop-blur-2xl transition-colors">
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
                                ? activeTheme.dropdownActive
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className={`truncate text-sm font-semibold text-slate-800 dark:text-slate-100 group-hover:${activeTheme.accentText}`}>
                                {item.name}
                              </p>
                              <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-400 mt-0.5">
                                {item.barcode && (
                                  <span className="font-mono text-[11px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300">
                                    {item.barcode}
                                  </span>
                                )}
                                {Number(item.stock ?? item.stock_count ?? 0) <= 0 ? (
                                  <span className="font-bold text-[10px] bg-rose-100/70 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 px-1.5 py-0.5 rounded">
                                    رصيد: 0
                                  </span>
                                ) : (
                                  <span className="font-bold text-[10px] bg-emerald-100/70 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 px-1.5 py-0.5 rounded">
                                    رصيد: {item.stock ?? item.stock_count}
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
                              <span className={`text-sm font-bold ${activeTheme.accentText} font-mono`}>
                                {roundMoney(price)} ₪
                              </span>
                              <button
                                type="button"
                                className={`flex h-8 w-8 items-center justify-center rounded-xl ${activeTheme.dropdownBtn} transition shadow-sm cursor-pointer`}
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
                      className={`w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border ${activeTheme.searchBtn} text-xs font-bold transition cursor-pointer`}
                    >
                      <PackagePlus size={14} />
                      <span>تسجيل «{search.trim()}» كمنتج جديد في المخزون</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* شارة "السكانر جاهز" بجانب حقل الباركود مباشرة */}
            <div
              className="hidden sm:inline-flex items-center gap-1.5 h-11 px-3 rounded-xl border border-emerald-300 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/60 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 shrink-0 select-none shadow-2xs"
              title="قارئ الباركود متصل وجاهز للاستقبال مباشرة"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span>السكانر جاهز</span>
            </div>

            {/* زر "بحث صنف F4" بجانب شارة السكانر مباشرة */}
            <button
              type="button"
              onClick={() => setProductSearchModalOpen(true)}
              className={`inline-flex items-center gap-2 h-11 px-3.5 sm:px-4 rounded-xl border ${activeTheme.searchBtn} font-bold text-xs shadow-2xs hover:shadow-md transition-all shrink-0 cursor-pointer active:scale-95`}
              title="بحث عن صنف في المخزون (F4 أو Ctrl+K)"
            >
              <Search size={16} className={activeTheme.accentText} />
              <span className="font-bold">بحث صنف</span>
              <kbd className={`hidden md:inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-mono font-bold border ${activeTheme.searchKbd}`}>
                F4
              </kbd>
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
          <section className="flex flex-1 flex-col overflow-hidden bg-slate-100/40 dark:bg-slate-950/30 p-4 transition-colors">
            <div className="flex items-center justify-between pb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black text-slate-900 dark:text-white">فاتورة البيع الحالية</h2>
                <span className="rounded-xl border-r-4 border-r-indigo-500 bg-white/90 dark:bg-slate-900/90 text-indigo-700 dark:text-indigo-300 font-mono text-xs px-2.5 py-1 font-bold border border-slate-200/90 dark:border-white/10 shadow-xs">
                  {orderItems.length} صنف ({invoiceTotals.totalUnits} قطعة/وحدة)
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* زر آخر فواتير الشيفت (استرجاع ومراجعة وإرجاع صنف) */}
                <button
                  type="button"
                  onClick={() => setRecentInvoicesModalOpen(true)}
                  className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-700 shadow-xs transition cursor-pointer active:scale-95"
                  title="عرض ومراجعة آخر فواتير الشيفت وإرجاع أصناف"
                >
                  <History size={13} className="text-indigo-600 dark:text-indigo-400" />
                  <span>آخر الفواتير</span>
                  {shiftRecentInvoices.length > 0 && (
                    <span className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-mono text-[10px] font-black px-1 border border-indigo-200 dark:border-indigo-800">
                      {shiftRecentInvoices.length}
                    </span>
                  )}
                </button>

                {heldInvoices.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setHeldInvoicesModalOpen(true)}
                    className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-300 dark:border-amber-700/80 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-xs font-bold hover:bg-amber-100 dark:hover:bg-amber-900/60 shadow-xs transition cursor-pointer active:scale-95"
                    title="عرض الفواتير المعلّقة واسترجاعها"
                  >
                    <Pause size={13} className="text-amber-600 dark:text-amber-400" />
                    <span>فواتير معلّقة</span>
                    <span className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-rose-500 text-white font-mono text-[10px] font-black px-1 shadow-xs animate-pulse">
                      {heldInvoices.length}
                    </span>
                  </button>
                )}
                {orderItems.length > 0 && (
                  <button
                    type="button"
                    onClick={handleHoldCurrentInvoice}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-xs font-bold hover:bg-indigo-100 dark:hover:bg-indigo-900/60 shadow-xs transition cursor-pointer active:scale-95"
                    title="تعليق الفاتورة الحالية لبدء فاتورة جديدة (Hold Sale)"
                  >
                    <Pause size={13} className="text-indigo-600 dark:text-indigo-400" />
                    <span>تعليق الفاتورة</span>
                  </button>
                )}
                {orderItems.length > 0 && (
                  <button
                    type="button"
                    onClick={clearInvoice}
                    className="flex items-center gap-1 text-xs font-bold text-rose-600 dark:text-rose-400 hover:text-rose-500 transition px-2 py-1.5 cursor-pointer"
                  >
                    <Trash2 size={14} />
                    <span>تفريغ الفاتورة</span>
                  </button>
                )}
              </div>
            </div>

            {/* الحاوية الجدولية */}
            <div className="flex-1 overflow-y-auto rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-slate-900/40 shadow-sm backdrop-blur-md transition-colors">
              {orderItems.length === 0 ? (
                <div className="flex h-full flex-col p-4 sm:p-6 overflow-y-auto">
                  {/* شريط تبويبات الأصناف السريعة */}
                  <div className="w-full max-w-3xl mx-auto space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 dark:border-white/10 pb-2.5">
                      <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-2xl border border-slate-200/60 dark:border-white/5 shadow-inner">
                        <button
                          type="button"
                          onClick={() => setQuickItemsTab('top_selling')}
                          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                            quickItemsTab === 'top_selling'
                              ? 'bg-white dark:bg-indigo-600 text-indigo-700 dark:text-white shadow-sm'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          <TrendingUp size={14} className={quickItemsTab === 'top_selling' ? 'text-indigo-600 dark:text-white' : ''} />
                          <span>الأكثر مبيعاً (آخر 7 أيام)</span>
                          {topSellingProducts.length > 0 && (
                            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300">
                              {topSellingProducts.length}
                            </span>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => setQuickItemsTab('last_sale')}
                          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                            quickItemsTab === 'last_sale'
                              ? 'bg-white dark:bg-indigo-600 text-indigo-700 dark:text-white shadow-sm'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          <Receipt size={14} className={quickItemsTab === 'last_sale' ? 'text-indigo-600 dark:text-white' : ''} />
                          <span>آخر أصناف الفاتورة السابقة</span>
                          {lastInvoiceProducts.length > 0 && (
                            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300">
                              {lastInvoiceProducts.length}
                            </span>
                          )}
                        </button>
                      </div>

                      <span className="text-[11px] text-slate-400 hidden sm:inline">
                        اضغط على أي صنف لإضافته فوراً للفاتورة
                      </span>
                    </div>

                    {/* شبكة أزرار الأصناف السريعة */}
                    {quickItemsTab === 'top_selling' ? (
                      <div>
                        {loadingTopSelling ? (
                          <div className="py-8 text-center text-xs text-slate-400">جاري جلب الأصناف الأكثر مبيعاً...</div>
                        ) : topSellingProducts.length === 0 ? (
                          <div className="py-8 text-center text-xs text-slate-400">
                            لا توجد مبيعات مسجلة في آخر 7 أيام بعد. امسح الباركود للبدء.
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                            {topSellingProducts.map((p, idx) => (
                              <button
                                key={p.id || p.barcode || idx}
                                type="button"
                                onClick={() => addOrIncrementProduct(p, 1)}
                                className="group flex flex-col justify-between p-3 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white dark:bg-slate-900 hover:border-indigo-400 dark:hover:border-indigo-600 hover:shadow-md hover:bg-indigo-50/40 dark:hover:bg-indigo-950/40 text-right transition cursor-pointer active:scale-95 shadow-xs"
                              >
                                <div className="flex items-start justify-between gap-1 w-full">
                                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 line-clamp-2 leading-snug">
                                    {p.name}
                                  </span>
                                  <span className="h-6 w-6 rounded-lg bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition">
                                    <Plus size={14} />
                                  </span>
                                </div>
                                <div className="flex items-center justify-between w-full mt-2 pt-1 border-t border-slate-100 dark:border-white/5">
                                  <span className="font-mono text-xs font-black text-emerald-600 dark:text-emerald-400">
                                    {p.price} ₪
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-medium">
                                    {p.unit || 'قطعة'}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        {lastInvoiceProducts.length === 0 ? (
                          <div className="py-8 text-center text-xs text-slate-400">
                            لا توجد أصناف من فاتورة سابقة بعد.
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                            {lastInvoiceProducts.map((p, idx) => (
                              <button
                                key={p.id || idx}
                                type="button"
                                onClick={() => addOrIncrementProduct(p, 1)}
                                className="group flex flex-col justify-between p-3 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white dark:bg-slate-900 hover:border-violet-400 dark:hover:border-violet-600 hover:shadow-md hover:bg-violet-50/40 dark:hover:bg-violet-950/40 text-right transition cursor-pointer active:scale-95 shadow-xs"
                              >
                                <div className="flex items-start justify-between gap-1 w-full">
                                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-violet-600 dark:group-hover:text-violet-400 line-clamp-2 leading-snug">
                                    {p.name}
                                  </span>
                                  <span className="h-6 w-6 rounded-lg bg-violet-50 dark:bg-violet-950/80 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0 group-hover:bg-violet-600 group-hover:text-white transition">
                                    <Plus size={14} />
                                  </span>
                                </div>
                                <div className="flex items-center justify-between w-full mt-2 pt-1 border-t border-slate-100 dark:border-white/5">
                                  <span className="font-mono text-xs font-black text-emerald-600 dark:text-emerald-400">
                                    {p.price} ₪
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-medium">
                                    {p.unit || 'قطعة'}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* تنبيه المسح بالسكانر الأنيق بالأسفل */}
                    <div className="flex items-center justify-center gap-3 pt-6 pb-2 text-slate-400 dark:text-slate-500 text-xs">
                      <div className="h-8 w-8 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
                        <ScanLine size={18} className="animate-pulse" />
                      </div>
                      <span>أو امسح باركود أي منتج مباشرة بالسكانر في أي وقت لبدء الفاتورة</span>
                    </div>
                  </div>
                </div>
              ) : (
                <table className="w-full text-right text-xs border-collapse table-fixed">
                  <thead className="sticky top-0 z-10 bg-indigo-600 text-white border-b border-indigo-700 select-none shadow-xs">
                    <tr className="bg-indigo-600 text-white border-b border-indigo-700 text-xs font-black select-none shadow-xs">
                      <th className="bg-indigo-600 text-white py-2.5 px-1.5 w-10 text-center font-black">#</th>
                      <th className="bg-indigo-600 text-white py-2.5 px-2 w-28 font-black">الباركود</th>
                      <th className="bg-indigo-600 text-white py-2.5 px-3 font-black">اسم المنتج</th>
                      <th className="bg-indigo-600 text-white py-2.5 px-1 w-20 text-center font-black">الوحدة</th>
                      <th className="bg-indigo-600 text-white py-2.5 px-1 w-28 text-center font-black">الكمية</th>
                      <th className="bg-indigo-600 text-white py-2.5 px-1 w-20 text-center font-black">السعر</th>
                      <th className="bg-indigo-600 text-white py-2.5 px-1 w-16 text-center font-black">الخصم</th>
                      <th className="bg-indigo-600 text-white py-2.5 px-2 w-24 text-left font-black">الإجمالي</th>
                      <th className="bg-indigo-600 text-white py-2.5 px-1 w-10 text-center font-black">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {orderItems.map((line, idx) => (
                      <tr
                        key={line.id}
                        onContextMenu={(e) => handleRowContextMenu(e, line)}
                        className={`border-b border-slate-100/80 dark:border-white/5 transition-colors group cursor-pointer ${
                          idx % 2 === 0
                            ? 'bg-white/90 dark:bg-slate-900/50'
                            : 'bg-slate-50/75 dark:bg-slate-800/30'
                        } hover:bg-indigo-50/80 dark:hover:bg-indigo-950/60`}
                        title="انقر بالزر الأيمن لعرض / تعديل تفاصيل وسعر الصنف"
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
                            className="w-full bg-transparent font-bold text-slate-800 dark:text-slate-100 text-sm truncate focus:bg-white dark:focus:bg-slate-800 focus:px-2 focus:py-1 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 rounded-lg outline-none transition"
                          />
                        </td>

                        {/* الوحدة - ديناميكية حسب الوحدات المسجلة للصنف */}
                        <td className="py-2.5 px-1 w-24 text-center">
                          {(() => {
                            const extraUnits = (line.productId && productUnitsMap[line.productId]) || [];
                            const unitNames = new Set(extraUnits.map((u) => u.unit_name));
                            if (!unitNames.has('قطعة')) {
                              unitNames.add('قطعة');
                            }
                            if (line.unit) {
                              unitNames.add(line.unit);
                            }
                            const list = Array.from(unitNames);

                            return (
                              <select
                                value={line.unit}
                                onChange={(e) => handleUnitChange(line.id, e.target.value)}
                                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/90 px-1 py-1 text-xs font-bold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 text-center cursor-pointer hover:border-indigo-400 transition"
                              >
                                {list.map((uName) => {
                                  const uObj = extraUnits.find((eu) => eu.unit_name === uName);
                                  const priceHint = uObj?.sale_price != null ? ` (${uObj.sale_price}₪)` : '';
                                  return (
                                    <option key={uName} value={uName}>
                                      {uName}{priceHint}
                                    </option>
                                  );
                                })}
                              </select>
                            );
                          })()}
                        </td>

                        {/* الكمية (تعديل مباشر + أزرار زيادة ونقصان مع ترميز لوني) */}
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
                              className={`w-14 h-7 text-center font-mono font-black text-xs rounded-lg border outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 transition-all ${getFieldStatusClass(line.qty, 'qty')}`}
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

                        {/* السعر الفردي (تعديل مباشر مع ترميز لوني) */}
                        <td className="py-2.5 px-1 w-20 text-center">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={line.unitPrice}
                            onChange={(e) => updateLineDirect(line.id, 'unitPrice', e.target.value)}
                            className={`w-16 h-7 text-center font-mono font-black text-xs rounded-lg border outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 transition-all mx-auto block ${getFieldStatusClass(line.unitPrice, 'price')}`}
                            dir="ltr"
                          />
                        </td>

                        {/* الخصم (تعديل مباشر مع ترميز لوني) */}
                        <td className="py-2.5 px-1 w-16 text-center">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={line.discount}
                            onChange={(e) => updateLineDirect(line.id, 'discount', e.target.value)}
                            className={`w-14 h-7 text-center font-mono font-bold text-xs rounded-lg border outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 transition-all mx-auto block ${getFieldStatusClass(line.discount, 'discount')}`}
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
                  <tfoot className="sticky bottom-0 z-10 select-none shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
                    <tr className="bg-indigo-50/95 dark:bg-indigo-950/90 border-t-2 border-indigo-300 dark:border-indigo-800 text-xs font-bold text-indigo-950 dark:text-indigo-100 backdrop-blur-md">
                      <td colSpan={4} className="py-2.5 px-3 text-right">
                        <span className="font-black text-indigo-900 dark:text-indigo-200">
                          مجموع بنود الفاتورة ({orderItems.length} بنود)
                        </span>
                      </td>
                      <td className="py-2.5 px-1 text-center font-black font-mono text-indigo-950 dark:text-white text-xs" dir="ltr">
                        {invoiceTotals.totalUnits}
                      </td>
                      <td className="py-2.5 px-1 text-center font-mono text-slate-400">
                        —
                      </td>
                      <td className="py-2.5 px-1 text-center font-bold font-mono text-rose-600 dark:text-rose-400" dir="ltr">
                        {invoiceTotals.totalDiscount > 0 ? `-₪${invoiceTotals.totalDiscount}` : '—'}
                      </td>
                      <td className="py-2.5 px-2 text-left font-black font-mono text-indigo-950 dark:text-indigo-100 whitespace-nowrap text-sm" dir="ltr">
                        {invoiceTotals.payable} ₪
                      </td>
                      <td className="py-2.5 px-1 text-center" />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </section>

          {/* 2. شريط الإجماليات والدفع السريع (Prominent Totals & Checkout Sidebar) */}
          <section className="flex w-[390px] shrink-0 flex-col border-r border-slate-200/90 dark:border-white/10 dark:border-r-indigo-500/20 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl p-6 justify-between transition-colors shadow-[-4px_0_24px_-4px_rgba(0,0,0,0.06)] dark:shadow-[-4px_0_30px_-4px_rgba(0,0,0,0.5)]">
            <div className="space-y-5 overflow-y-auto custom-scrollbar pr-0.5">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-3.5">
                <h3 className="text-base font-black text-slate-900 dark:text-white">إجماليات الفاتورة والدفع</h3>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono font-bold bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full border border-slate-200/60 dark:border-slate-700/60">
                  {orderItems.length} بنود
                </span>
              </div>

              {/* تفاصيل المجموع والخصم والكمية */}
              <div className="rounded-2xl border border-indigo-200/80 dark:border-indigo-800/80 bg-indigo-50/90 dark:bg-indigo-950/40 p-4 space-y-2.5 text-xs shadow-xs backdrop-blur-sm transition-all text-indigo-950 dark:text-indigo-100">
                <div className="flex items-center justify-between text-indigo-950 dark:text-indigo-200">
                  <span className="flex items-center gap-2 font-bold">
                    <Receipt size={15} className="text-indigo-600 dark:text-indigo-400" />
                    <span>المجموع الفرعي:</span>
                  </span>
                  <span className="font-mono font-black text-indigo-950 dark:text-indigo-100 text-sm">
                    {invoiceTotals.subtotal} <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">₪</span>
                  </span>
                </div>
                {invoiceTotals.totalDiscount > 0 && (
                  <div className="flex items-center justify-between rounded-xl border border-amber-300 dark:border-amber-700/80 bg-amber-50/80 dark:bg-amber-950/40 px-3 py-2 text-amber-900 dark:text-amber-200 shadow-xs">
                    <span className="font-bold flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                      <Tag size={13} />
                      <span>إجمالي الخصم:</span>
                    </span>
                    <span className="font-mono font-black text-sm text-rose-600 dark:text-rose-400">
                      -{invoiceTotals.totalDiscount} ₪
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between text-indigo-900 dark:text-indigo-200 border-t border-indigo-200/60 dark:border-indigo-900/60 pt-2">
                  <span className="font-bold">الكمية الإجمالية:</span>
                  <span className="font-mono font-black text-indigo-950 dark:text-white bg-indigo-200/70 dark:bg-indigo-900/60 px-2.5 py-0.5 rounded-lg text-xs">
                    {invoiceTotals.totalUnits}
                  </span>
                </div>
              </div>

              {/* ── بطاقة "المبلغ المطلوب سداده" (الصافي النهائي) ── */}
              <div className="relative overflow-hidden rounded-3xl border-2 border-emerald-400 dark:border-emerald-500/80 bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 p-6 text-center text-white shadow-2xl shadow-indigo-500/30 ring-2 ring-emerald-400/20 transition-all select-none">
                {/* أيقونات زخرفية مائية شفافة في الزوايا */}
                <Receipt className="absolute -left-4 -bottom-4 w-32 h-32 text-white/[0.08] pointer-events-none -rotate-12" />
                <Sparkles className="absolute -right-3 -top-3 w-24 h-24 text-white/[0.08] pointer-events-none rotate-12" />

                {/* شارة العنوان */}
                <div className="relative z-10 inline-flex items-center gap-1.5 text-xs font-bold text-indigo-100 uppercase tracking-wider mb-2.5 bg-white/15 px-4 py-1.5 rounded-full backdrop-blur-md border border-white/20 shadow-xs">
                  <Sparkles size={13} className="text-amber-300" />
                  <span>المبلغ المطلوب سداده</span>
                </div>

                {/* الرقم بحجم كبير جداً 6xl وعريض باللون الأبيض */}
                <div className="relative z-10 flex items-baseline justify-center gap-2 font-mono tracking-tight text-white py-1">
                  <span className="text-6xl font-black drop-shadow-md">
                    {invoiceTotals.payable}
                  </span>
                  <span className="text-2xl font-black text-indigo-200">
                    ₪
                  </span>
                </div>
              </div>

              {/* ── حقل "المبلغ المدفوع كاش" (مساحة أكبر كنقطة إدخال وحيدة) ── */}
              <div className="rounded-3xl border-2 border-slate-200/90 dark:border-white/10 bg-slate-50/80 dark:bg-slate-950/60 p-6 space-y-3 shadow-xs backdrop-blur-sm transition-all">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                  <span className="flex items-center gap-2">
                    <Coins size={17} className="text-indigo-600 dark:text-indigo-400" />
                    <span className="text-sm font-black">المبلغ المدفوع كاش:</span>
                  </span>
                  {tenderedAmount && (
                    <button
                      type="button"
                      onClick={() => setTenderedAmount('')}
                      className="text-xs font-bold text-rose-500 hover:text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 px-2.5 py-1 rounded-xl border border-rose-200/60 dark:border-rose-900/50 transition shadow-xs"
                    >
                      مسح المبلغ
                    </button>
                  )}
                </div>

                <div className="relative">
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 font-bold text-xl font-mono pointer-events-none select-none">
                    ₪
                  </span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={tenderedAmount}
                    onChange={(e) => setTenderedAmount(e.target.value)}
                    placeholder={String(invoiceTotals.payable)}
                    className="w-full h-16 rounded-2xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pr-11 pl-4 text-2xl font-mono font-black text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-600 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500 focus:outline-none transition shadow-inner"
                    dir="ltr"
                  />
                </div>
              </div>

              {/* ── بطاقة "الباقي للزبون" ── */}
              <div
                className={`rounded-3xl border-2 p-6 transition-all duration-200 shadow-xs ${
                  changeDue > 0
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 shadow-emerald-500/10'
                    : changeDue < 0
                    ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950/60'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3.5">
                    <span
                      className={`flex h-12 w-12 items-center justify-center rounded-2xl text-2xl shrink-0 shadow-xs ${
                        changeDue > 0
                          ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200'
                          : changeDue < 0
                          ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      💵
                    </span>
                    <div>
                      <span
                        className={`flex items-center gap-1.5 text-xs font-black uppercase tracking-wider ${
                          changeDue > 0
                            ? 'text-emerald-800 dark:text-emerald-200'
                            : changeDue < 0
                            ? 'text-amber-800 dark:text-amber-200'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        <Banknote size={15} />
                        <span>الباقي للزبون:</span>
                      </span>
                      <span
                        className={`text-xs ${
                          changeDue > 0
                            ? 'font-black text-emerald-700 dark:text-emerald-300'
                            : changeDue < 0
                            ? 'font-bold text-amber-700 dark:text-amber-300'
                            : 'font-medium text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {changeDue > 0
                          ? 'يجب إرجاعه للزبون'
                          : changeDue < 0
                          ? 'المبلغ المدفوع غير كافٍ'
                          : 'مدفوع بالكامل بدون باقي'}
                      </span>
                    </div>
                  </div>

                  <div
                    className={`font-mono font-black ${
                      changeDue > 0
                        ? 'text-4xl text-emerald-700 dark:text-emerald-400'
                        : changeDue < 0
                        ? 'text-2xl text-amber-600 dark:text-amber-400'
                        : 'text-2xl text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {changeDue >= 0 ? (
                      <span>
                        {changeDue} <span className="text-xl font-bold">₪</span>
                      </span>
                    ) : (
                      <span>
                        متبقي: {Math.abs(changeDue)} <span className="text-lg font-bold">₪</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── أزرار الدفع الكبيرة (F1 نقدي / F2 بطاقة / F3 آجل) ── */}
            <div className="space-y-2 pt-4 border-t border-slate-200 dark:border-white/10">
              <div className="grid grid-cols-3 gap-2.5">
                {/* زر نقدي كاش */}
                <button
                  type="button"
                  disabled={!orderItems.length || isSubmittingSale}
                  onClick={() => handleExecuteSale('cash')}
                  className="h-14 flex flex-col items-center justify-center rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black shadow-lg shadow-emerald-600/30 hover:shadow-emerald-600/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none px-1 text-center border-t border-emerald-400/30"
                >
                  <div className="flex items-center gap-1 text-sm sm:text-base">
                    <DollarSign size={18} />
                    <span>نقدي 💵</span>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-100/90">F1 / Enter</span>
                </button>

                {/* زر بطاقة / فيزا */}
                <button
                  type="button"
                  disabled={!orderItems.length || isSubmittingSale}
                  onClick={() => handleExecuteSale('visa')}
                  className={`h-14 flex flex-col items-center justify-center rounded-2xl ${activeTheme.cardBtn} text-white font-black shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none px-1 text-center`}
                >
                  <div className="flex items-center gap-1 text-sm sm:text-base">
                    <CreditCard size={18} />
                    <span>بطاقة 💳</span>
                  </div>
                  <span className="text-[10px] font-bold text-white/90">F2</span>
                </button>

                {/* زر آجل / دين */}
                <button
                  type="button"
                  disabled={!orderItems.length || isSubmittingSale}
                  onClick={handleOpenCreditModal}
                  className="h-14 flex flex-col items-center justify-center rounded-2xl bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-black shadow-lg shadow-amber-600/30 hover:shadow-amber-600/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none px-1 text-center border-t border-amber-400/30"
                >
                  <div className="flex items-center gap-1 text-sm sm:text-base">
                    <User size={18} />
                    <span>آجل 👤</span>
                  </div>
                  <span className="text-[10px] font-bold text-amber-100/90">F3</span>
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
        <ProductFormModal
          isOpen={Boolean(newProductModal)}
          mode="add"
          initialBarcode={newProductModal.barcode || ''}
          isInventoryOnly={Boolean(newProductModal.isInventoryOnly)}
          suppliers={suppliersList}
          onClose={handleCancelNewProduct}
          onSuccess={handleNewProductSuccess}
        />
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

      {/* ─────────────────────────────────────────────────────────────
          قائمة السياق (Context Menu) بالزر الأيمن على سطر الفاتورة
         ───────────────────────────────────────────────────────────── */}
      {contextMenu.isOpen && contextMenu.line && (
        <>
          <div
            className="fixed inset-0 z-50 bg-transparent"
            onClick={() => setContextMenu({ isOpen: false, x: 0, y: 0, line: null })}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ isOpen: false, x: 0, y: 0, line: null });
            }}
          />
          <div
            style={{
              top: contextMenu.y,
              left: contextMenu.x,
            }}
            className="fixed z-50 min-w-[210px] rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/95 dark:bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100 select-none text-right"
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-white/5 truncate max-w-[230px]">
              {contextMenu.line.name || contextMenu.line.baseName || 'خيارات السطر'}
            </div>
            <button
              type="button"
              onClick={() => {
                const targetLine = contextMenu.line;
                setContextMenu({ isOpen: false, x: 0, y: 0, line: null });
                handleOpenEditProductModal(targetLine);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-xl transition text-right group"
            >
              <Pencil size={15} className="text-indigo-500 shrink-0 group-hover:scale-110 transition" />
              <span>تفاصيل الصنف / تعديل</span>
            </button>
          </div>
        </>
      )}

      {/* ─────────────────────────────────────────────────────────────
          مودال تعديل الصنف (ProductFormModal)
         ───────────────────────────────────────────────────────────── */}
      <ProductFormModal
        isOpen={editProductModalOpen}
        mode="edit"
        product={editingProductItem}
        suppliers={suppliersList}
        onClose={() => {
          setEditProductModalOpen(false);
          setEditingProductItem(null);
        }}
        onSuccess={handleProductEditSuccess}
        onDelete={handleProductDeleteSuccess}
      />

      {/* ─────────────────────────────────────────────────────────────
          مودال البحث الشامل عن صنف في المخزون (ProductSearchModal)
         ───────────────────────────────────────────────────────────── */}
      <ProductSearchModal
        isOpen={productSearchModalOpen}
        onClose={() => {
          setProductSearchModalOpen(false);
          setTimeout(() => barcodeInputRef.current?.focus(), 60);
        }}
        onSelectProduct={handleSelectProductFromSearch}
        storeId={store?.id}
        onAddNewProduct={(searchQuery) => {
          setProductSearchModalOpen(false);
          openNewProductModal(searchQuery);
        }}
      />

      {/* ─────────────────────────────────────────────────────────────
          مودال الفواتير المعلّقة (HeldInvoicesModal)
         ───────────────────────────────────────────────────────────── */}
      <HeldInvoicesModal
        isOpen={heldInvoicesModalOpen}
        onClose={() => {
          setHeldInvoicesModalOpen(false);
          setTimeout(() => barcodeInputRef.current?.focus(), 60);
        }}
        heldInvoices={heldInvoices}
        hasCurrentActiveItems={orderItems.length > 0}
        onDirectRestore={handleDirectRestoreHeldInvoice}
        onHoldCurrentAndRestore={handleHoldCurrentAndRestore}
        onDiscardCurrentAndRestore={handleDiscardCurrentAndRestore}
        onDeleteHeld={handleDeleteHeldInvoice}
      />

      {/* ─────────────────────────────────────────────────────────────
          مودال آخر فواتير الشيفت وإرجاع الأصناف (RecentInvoicesModal)
         ───────────────────────────────────────────────────────────── */}
      <RecentInvoicesModal
        isOpen={recentInvoicesModalOpen}
        onClose={() => {
          setRecentInvoicesModalOpen(false);
          setTimeout(() => barcodeInputRef.current?.focus(), 60);
        }}
        invoices={shiftRecentInvoices}
        loading={loadingRecentInvoices}
        onReturnItem={handleReturnItemFromSale}
      />
    </div>
  );
}
