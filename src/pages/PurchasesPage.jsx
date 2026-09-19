import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import {
  Loader2,
  ShoppingBag,
  Plus,
  PackagePlus,
  Trash2,
  Save,
  TrendingUp,
  Copy,
  Camera,
  ImagePlus,
  X,
  Upload,
  AlertTriangle,
  Search,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileText,
  Check,
  Info,
  Calendar,
  Phone,
  UserCheck,
  Printer,
  ChevronLeft,
  ChevronRight,
  Paperclip,
  Barcode as BarcodeIcon,
  Percent,
  Building2,
  Pencil,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import PrintPurchaseInvoice from '../components/PrintPurchaseInvoice';
import PrintPurchaseBarcodesModal from '../components/PrintPurchaseBarcodesModal';
import PurchaseAttachmentsModal from '../components/PurchaseAttachmentsModal';
import StorageObjectImage from '../components/StorageObjectImage';
import SupplierFormModal from '../components/SupplierFormModal';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { uploadPurchaseInvoiceScan } from '../utils/uploadProductImage';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';
import { addDaysISO } from '../utils/dateIso';
import { isElectricalProduct } from '../utils/electricalProduct';
import {
  computePurchaseLinePayloads,
  computeLineTotal,
  effectiveUnitCostFromRow,
  parseSerialList,
  stockQtyFromLine,
} from '../utils/purchaseLinePayloads';
import {
  fetchPendingReservationsForProducts,
  groupReservationsByProduct,
} from '../utils/preOrders';
import {
  executePurchaseReceiveEffects,
  upsertSupplierForCreditDraft,
} from '../utils/purchaseReceiveExecution';
import {
  resolvePurchaseLinesNewProducts,
  insertNewProductForPurchase,
} from '../utils/resolvePurchaseNewProducts';
import {
  COMMON_UNIT_PRESETS,
  fetchUnitsForProductIds,
  findUnitByBarcode,
  fetchUnitsByProductId,
  PRODUCT_UNITS_TABLE,
} from '../utils/productUnits';

const PURCHASES_TABLE = 'store_purchases';
const CONTACTS_TABLE = 'store_contacts';
const TARGET_MARGIN = 0.2;

const UNIT_OPTIONS = COMMON_UNIT_PRESETS;

function escapeIlike(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function newLine(init = {}) {
  return {
    key: crypto.randomUUID(),
    barcode: init.barcode || '',
    reference: init.reference || '',
    unit: init.unit || 'قطعة',
    conversionFactor: init.conversionFactor || 1,
    unit_price: init.unit_price != null ? String(init.unit_price) : '',
    discount_percent: init.discount_percent != null ? String(init.discount_percent) : '0',
    qty: init.qty != null ? String(init.qty) : '1',
    warehouse: init.warehouse || 'الرئيسي',
    batchNumber: init.batchNumber || '',
    productId: init.productId || null,
    productName: init.productName || '',
    sellPrice: init.sellPrice != null ? init.sellPrice : null,
    stockFullPrice: init.stockFullPrice != null ? init.stockFullPrice : null,
    brandGroup: init.brandGroup || '',
    expiryDate: init.expiryDate || '',
    serialInput: init.serialInput || '',
    showDetails: false,
  };
}

function suggestedSellAtMargin(cost, margin = TARGET_MARGIN) {
  if (cost <= 0) return null;
  return Math.round(cost * (1 + margin) * 100) / 100;
}

function generateAutoInvoiceNumber() {
  const now = new Date();
  const dateStr = now.toISOString().slice(2, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `PUR-${dateStr}-${rand}`;
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
    if (isNaN(num) || num < 0 || num > 100) {
      return 'border-red-400 bg-red-50/50 text-red-700 dark:border-red-500/80 dark:bg-red-950/40 dark:text-red-300 font-bold';
    }
    if (num > 0) {
      return 'border-emerald-400 bg-emerald-50/20 text-emerald-950 dark:border-emerald-500/70 dark:bg-emerald-950/20 dark:text-emerald-200 font-black';
    }
    return 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold';
  }
  return 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white';
}

export default function PurchasesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();

  // -------------------------------------------------------------
  // Header State
  // -------------------------------------------------------------
  const [supplierCompanyName, setSupplierCompanyName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMode, setPaymentMode] = useState('cash');
  const [paymentDueDate, setPaymentDueDate] = useState(() =>
    addDaysISO(new Date().toISOString().slice(0, 10), 30)
  );

  // Suppliers autocomplete
  const [suppliersList, setSuppliersList] = useState([]);
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const supplierDropdownRef = useRef(null);

  // New Supplier Modal State
  const [newSupplierModalOpen, setNewSupplierModalOpen] = useState(false);
  const [newSupplierInitialName, setNewSupplierInitialName] = useState('');

  // View-Only Saved Mode State
  const [isSavedMode, setIsSavedMode] = useState(false);

  // -------------------------------------------------------------
  // Accounting Account, Taxes & Warehouse State
  // -------------------------------------------------------------
  const [purchaseAccountId, setPurchaseAccountId] = useState('1100');
  const [accountsList, setAccountsList] = useState([]);
  const [warehouseOptions, setWarehouseOptions] = useState([{ id: 'default', name: 'الرئيسي' }]);
  const [taxRate, setTaxRate] = useState('0'); // %
  const [isTaxInclusive, setIsTaxInclusive] = useState(false);

  // Modals (Barcodes & Attachments)
  const [barcodeModalOpen, setBarcodeModalOpen] = useState(false);
  const [attachmentsModalOpen, setAttachmentsModalOpen] = useState(false);
  const [loadedScanPath, setLoadedScanPath] = useState(null);

  // -------------------------------------------------------------
  // Invoice Navigation & Active Loaded Record State
  // -------------------------------------------------------------
  const [invoicesNavList, setInvoicesNavList] = useState([]);
  const [navLoading, setNavLoading] = useState(false);
  const [currentPurchaseId, setCurrentPurchaseId] = useState(null);
  const [loadedPurchaseOriginalStatus, setLoadedPurchaseOriginalStatus] = useState(null);
  const [printPurchaseData, setPrintPurchaseData] = useState(null);

  const currentPurchaseIndex = useMemo(() => {
    if (!currentPurchaseId || invoicesNavList.length === 0) return -1;
    return invoicesNavList.findIndex((x) => x.id === currentPurchaseId);
  }, [currentPurchaseId, invoicesNavList]);

  // Sequential Internal Invoice Number (PINV-00001, etc.)
  const internalInvoiceNumber = useMemo(() => {
    const seq = currentPurchaseIndex >= 0 ? currentPurchaseIndex + 1 : (invoicesNavList.length || 0) + 1;
    return `PINV-${String(seq).padStart(5, '0')}`;
  }, [currentPurchaseIndex, invoicesNavList.length]);

  const canGoPrev = useMemo(() => {
    if (invoicesNavList.length === 0) return false;
    if (currentPurchaseId === null) return true;
    return currentPurchaseIndex > 0;
  }, [invoicesNavList.length, currentPurchaseId, currentPurchaseIndex]);

  const canGoNext = useMemo(() => {
    if (invoicesNavList.length === 0) return false;
    if (currentPurchaseId === null) return false;
    return currentPurchaseIndex >= 0 && currentPurchaseIndex < invoicesNavList.length - 1;
  }, [invoicesNavList.length, currentPurchaseId, currentPurchaseIndex]);

  useEffect(() => {
    if (!printPurchaseData) return;
    document.body.classList.add('print-invoice-active');
    const t = requestAnimationFrame(() => window.print());
    const onAfterPrint = () => {
      document.body.classList.remove('print-invoice-active');
      setPrintPurchaseData(null);
    };
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener('afterprint', onAfterPrint);
      document.body.classList.remove('print-invoice-active');
    };
  }, [printPurchaseData]);

  // -------------------------------------------------------------
  // Lines & Table State
  // -------------------------------------------------------------
  const [lines, setLines] = useState([newLine()]);
  const [saving, setSaving] = useState(false);
  const [purchaseStatus, setPurchaseStatus] = useState('received'); // 'received' | 'draft'
  const [updateCatalogCosts, setUpdateCatalogCosts] = useState(true);

  // Product Autocomplete inside Table
  const [suggestionsByRow, setSuggestionsByRow] = useState({});
  const [dropdownRowKey, setDropdownRowKey] = useState(null);
  const [dropdownField, setDropdownField] = useState(null); // 'barcode' | 'name'
  const [searchLoadingKey, setSearchLoadingKey] = useState(null);
  const searchTimersRef = useRef({});
  const tableDropdownRef = useRef(null);

  // Registered units per product: { [productId]: Array<ProductUnit> }
  const [productUnitsMap, setProductUnitsMap] = useState({});

  // Auto-fetch units for products present in invoice lines
  const productIdsInLines = useMemo(() => {
    return Array.from(new Set(lines.map((l) => l.productId).filter(Boolean)));
  }, [lines]);

  useEffect(() => {
    if (!store?.id || productIdsInLines.length === 0) return;
    const missingIds = productIdsInLines.filter((id) => !productUnitsMap[id]);
    if (missingIds.length === 0) return;

    let cancelled = false;
    fetchUnitsForProductIds(missingIds, store.id).then((map) => {
      if (!cancelled && map && Object.keys(map).length > 0) {
        setProductUnitsMap((prev) => ({ ...prev, ...map }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [store?.id, productIdsInLines, productUnitsMap]);

  // Pre-orders reservations
  const [preOrderReservations, setPreOrderReservations] = useState([]);

  // Modals for Fast Search & New Product
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productSearchResults, setProductSearchResults] = useState([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const productSearchInputRef = useRef(null);
  const modalSearchTimerRef = useRef(null);

  useEffect(() => {
    if (productSearchOpen) {
      const t = setTimeout(() => {
        productSearchInputRef.current?.focus();
      }, 60);
      return () => clearTimeout(t);
    }
  }, [productSearchOpen]);

  const [newProductOpen, setNewProductOpen] = useState(false);
  const [newProductSaving, setNewProductSaving] = useState(false);
  const [npEngName, setNpEngName] = useState('');
  const [npRef, setNpRef] = useState('');
  const [npBarcode, setNpBarcode] = useState('');
  const [npUnitPrice, setNpUnitPrice] = useState('');
  const [npDiscount, setNpDiscount] = useState('0');
  const [npQty, setNpQty] = useState('1');

  // -------------------------------------------------------------
  // Collapsible Extra Options (Landed cost, Notes, Scan image)
  // -------------------------------------------------------------
  const [extraOptionsOpen, setExtraOptionsOpen] = useState(false);
  const [landedCostExtra, setLandedCostExtra] = useState('');
  const [extraNotes, setExtraNotes] = useState('');
  const [invoiceScanFile, setInvoiceScanFile] = useState(null);
  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState(null);
  const invoiceFileRef = useRef(null);

  // Banner on save
  const [savedBanner, setSavedBanner] = useState(null);

  // -------------------------------------------------------------
  // Load Suppliers from store_contacts (role = 'supplier')
  // -------------------------------------------------------------
  const loadSuppliers = useCallback(async () => {
    if (!store?.id) return;
    try {
      const { data, error } = await supabase
        .from(CONTACTS_TABLE)
        .select('id, name, phone, outstanding_amount, payment_type')
        .eq('store_id', store.id)
        .eq('role', 'supplier')
        .order('name', { ascending: true });
      if (!error && data) {
        setSuppliersList(data);
      }
    } catch (err) {
      console.warn('Failed to load suppliers', err);
    }
  }, [store?.id]);

  useEffect(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  // -------------------------------------------------------------
  // Load Invoices Sequence for Navigation
  // -------------------------------------------------------------
  const fetchInvoicesNavList = useCallback(async () => {
    if (!store?.id) {
      setInvoicesNavList([]);
      return;
    }
    try {
      const { data, error } = await supabase
        .from(PURCHASES_TABLE)
        .select('id, invoice_number, invoice_date, created_at')
        .eq('store_id', store.id)
        .order('created_at', { ascending: true });
      if (!error && data) {
        setInvoicesNavList(data);
      }
    } catch (err) {
      console.warn('Failed to load invoices nav list', err);
    }
  }, [store?.id]);

  useEffect(() => {
    fetchInvoicesNavList();
  }, [fetchInvoicesNavList]);

  // -------------------------------------------------------------
  // Load Chart of Accounts & Warehouses (store_locations)
  // -------------------------------------------------------------
  useEffect(() => {
    if (!store?.id) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('accounting_accounts')
          .select('id, code, name, type')
          .eq('store_id', store.id)
          .order('code', { ascending: true });
        if (!error && data && data.length > 0) {
          setAccountsList(data);
        } else {
          setAccountsList([
            { id: '1100', code: '1100', name: 'المخزون (أصول)' },
            { id: '5001', code: '5001', name: 'تكلفة البضاعة المباعة / مشتريات (مصروفات)' },
            { id: '1001', code: '1001', name: 'الصندوق النقدي (أصول)' },
            { id: '2100', code: '2100', name: 'ذمم دائنون - موردون (التزامات)' },
          ]);
        }
      } catch (e) {
        console.warn('Failed to load accounts', e);
      }
    })();
  }, [store?.id]);

  useEffect(() => {
    if (!store?.id) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('store_locations')
          .select('id, name, code')
          .eq('store_id', store.id)
          .order('name', { ascending: true });
        if (!error && data && data.length > 0) {
          const list = [{ id: 'default', name: 'الرئيسي' }];
          data.forEach((loc) => {
            if (loc.name && loc.name !== 'الرئيسي') {
              list.push({ id: loc.id, name: loc.name });
            }
          });
          setWarehouseOptions(list);
        } else {
          setWarehouseOptions([{ id: 'default', name: 'الرئيسي' }]);
        }
      } catch (e) {
        console.warn('Failed to load warehouses', e);
      }
    })();
  }, [store?.id]);

  // -------------------------------------------------------------
  // Load a Saved Purchase Invoice by ID (View / Edit Mode)
  // -------------------------------------------------------------
  const loadPurchaseById = useCallback(
    async (purchaseId) => {
      if (!store?.id || !purchaseId) return;
      setNavLoading(true);
      try {
        const { data: p, error } = await supabase
          .from(PURCHASES_TABLE)
          .select('*')
          .eq('id', purchaseId)
          .eq('store_id', store.id)
          .single();

        if (error) throw error;
        if (!p) {
          toast.error('لم يتم العثور على الفاتورة المطلوبة');
          return;
        }

        setCurrentPurchaseId(p.id);
        setLoadedPurchaseOriginalStatus(p.purchase_status || 'received');
        setSupplierCompanyName(p.supplier_company_name || '');
        setSupplierPhone(p.supplier_phone || '');
        setSelectedSupplierId(p.supplier_contact_id || null);
        setInvoiceNumber(p.invoice_number || '');
        setInvoiceDate(p.invoice_date || '');
        setPaymentMode(p.payment_mode || 'cash');
        setPaymentDueDate(p.payment_due_date || '');
        setPurchaseStatus(p.purchase_status || 'received');
        setLandedCostExtra(
          p.landed_cost_extra != null && Number(p.landed_cost_extra) > 0
            ? String(p.landed_cost_extra)
            : ''
        );

        // استخراج المرفق، نسبة الضريبة، حساب المشتريات، والملاحظات الحرة
        const scanMatch = p.notes?.match(/\[مرفق\]:\s*([^\n\r]+)/);
        setLoadedScanPath(scanMatch ? scanMatch[1].trim() : (p.invoice_scan_path || null));

        const taxMatch = p.notes?.match(/الضريبة:\s*([0-9.]+)/);
        if (taxMatch) {
          setTaxRate(taxMatch[1]);
          setIsTaxInclusive(p.notes?.includes('شامل') || false);
        } else if (Number(p.tax_amount) > 0 && Number(p.subtotal) > 0) {
          const calculatedRate = Math.round((Number(p.tax_amount) / Number(p.subtotal)) * 100);
          setTaxRate(String(calculatedRate));
          setIsTaxInclusive(false);
        } else {
          setTaxRate('0');
          setIsTaxInclusive(false);
        }

        const accMatch = p.notes?.match(/حساب المشتريات:\s*([^\n\r]+)/);
        if (accMatch) {
          const accCode = accMatch[1].trim().split(' ')[0];
          setPurchaseAccountId(accCode || '1100');
        } else {
          setPurchaseAccountId('1100');
        }

        const userNotesMatch = p.notes?.split('\nملاحظات: ')[1] || (p.notes?.startsWith('ملاحظات: ') ? p.notes.slice(9) : '');
        setExtraNotes(userNotesMatch ? userNotesMatch.trim() : (p.notes?.includes('ملاحظات: ') ? '' : p.notes || ''));

        if (invoicePreviewUrl) URL.revokeObjectURL(invoicePreviewUrl);
        setInvoicePreviewUrl(null);
        setInvoiceScanFile(null);
        setSavedBanner(null);

        // تحويل أسطر الفاتورة إلى صفوف واجهة
        const rawLines = dbLineItemsToReceiveRows(p.line_items);

        // جلب أسماء وتفاصيل المنتجات في حال عدم توفرها في الأسطر
        const pIds = rawLines.map((r) => r.productId).filter(Boolean);
        const bcs = rawLines.map((r) => r.barcode).filter(Boolean);

        if (pIds.length > 0 || bcs.length > 0) {
          let q = supabase
            .from(PRODUCTS_TABLE)
            .select('id, barcode, reference, eng_name, full_price, price_after_disc, brand_group')
            .eq('store_id', store.id);

          if (pIds.length > 0) {
            q = q.in('id', pIds);
          }
          const { data: prods } = await q;
          if (prods && prods.length > 0) {
            const prodMap = new Map(prods.map((item) => [item.id, item]));
            const bcMap = new Map(prods.map((item) => [item.barcode, item]));
            rawLines.forEach((r) => {
              const found =
                (r.productId && prodMap.get(r.productId)) || (r.barcode && bcMap.get(r.barcode));
              if (found) {
                if (!r.productName) r.productName = found.eng_name || '';
                if (r.sellPrice == null) {
                  r.sellPrice =
                    Number(found.price_after_disc) > 0
                      ? Number(found.price_after_disc)
                      : Number(found.full_price) || 0;
                }
                if (r.stockFullPrice == null) r.stockFullPrice = Number(found.full_price) || 0;
                if (!r.brandGroup) r.brandGroup = found.brand_group || '';
              }
            });
          }
        }

        setLines(rawLines.length > 0 ? rawLines : [newLine()]);
        setIsSavedMode(true);
      } catch (err) {
        console.error('Failed to load purchase invoice', err);
        toast.error('فشل تحميل الفاتورة');
      } finally {
        setNavLoading(false);
      }
    },
    [store?.id, invoicePreviewUrl, toast]
  );

  // Check URL query param ?id=... on mount
  useEffect(() => {
    const qId = searchParams.get('id');
    if (qId && store?.id) {
      loadPurchaseById(qId);
    }
  }, [searchParams, store?.id, loadPurchaseById]);

  // Navigation handlers
  const handlePrevInvoice = async () => {
    if (invoicesNavList.length === 0) return;
    let targetId = null;
    if (currentPurchaseId === null || currentPurchaseIndex === -1) {
      targetId = invoicesNavList[invoicesNavList.length - 1].id;
    } else if (currentPurchaseIndex > 0) {
      targetId = invoicesNavList[currentPurchaseIndex - 1].id;
    }
    if (targetId) {
      await loadPurchaseById(targetId);
    }
  };

  const handleNextInvoice = async () => {
    if (invoicesNavList.length === 0) return;
    if (currentPurchaseIndex >= 0 && currentPurchaseIndex < invoicesNavList.length - 1) {
      const targetId = invoicesNavList[currentPurchaseIndex + 1].id;
      await loadPurchaseById(targetId);
    }
  };

  const handleNewInvoice = () => {
    setCurrentPurchaseId(null);
    setLoadedPurchaseOriginalStatus(null);
    setSupplierCompanyName('');
    setSupplierPhone('');
    setSelectedSupplierId(null);
    setInvoiceNumber('');
    setInvoiceDate(new Date().toISOString().slice(0, 10));
    setPaymentMode('cash');
    setPaymentDueDate(addDaysISO(new Date().toISOString().slice(0, 10), 30));
    setLines([newLine()]);
    setPurchaseStatus('received');
    setLandedCostExtra('');
    setExtraNotes('');
    setTaxRate('0');
    setIsTaxInclusive(false);
    setPurchaseAccountId('1100');
    setInvoiceScanFile(null);
    setLoadedScanPath(null);
    if (invoicePreviewUrl) URL.revokeObjectURL(invoicePreviewUrl);
    setInvoicePreviewUrl(null);
    setSavedBanner(null);
    setIsSavedMode(false);
    toast.info('تم بدء فاتورة جديدة فارغة');
  };

  const handlePrintCurrentInvoice = () => {
    if (!currentPurchaseId) {
      toast.warning('يرجى حفظ الفاتورة أولاً لتتمكن من طباعتها');
      return;
    }
    const linePayloadsForPrint = computePurchaseLinePayloads(lines, landedCostExtra);
    const validLines = linePayloadsForPrint.filter((x) => x.qty > 0);

    setPrintPurchaseData({
      brandName: store?.name || 'شركة سنين',
      brandNameEn: store?.code || 'Senin Company',
      storeName: store?.name,
      supplierCompanyName: supplierCompanyName,
      supplierPhone: supplierPhone,
      invoiceNumber: invoiceNumber,
      internalInvoiceNumber: internalInvoiceNumber,
      invoiceDate: invoiceDate,
      paymentMode: paymentMode,
      paymentDueDate: paymentDueDate,
      lines: validLines,
      subtotalBeforeTax: subtotalBeforeTax,
      taxRate: taxRateNum,
      taxAmount: taxAmount,
      isTaxInclusive: isTaxInclusive,
      totalAmount: grandTotal,
      landedCostExtra: landedCostExtra,
      notes: extraNotes,
      printedAtLabel: new Date().toLocaleString('ar-EG'),
    });
  };

  const handleAttachmentFileChosen = (file) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.warning('حجم الملف كبير جداً (الحد الأقصى 20 ميجابايت).');
      return;
    }
    setInvoiceScanFile(file);
    if (invoicePreviewUrl) URL.revokeObjectURL(invoicePreviewUrl);
    setInvoicePreviewUrl(URL.createObjectURL(file));
    toast.success('تم اختيار الملف، سيتم حفظه ومزامنته مع الفاتورة');
  };

  const handleAttachmentRemove = () => {
    if (invoicePreviewUrl) URL.revokeObjectURL(invoicePreviewUrl);
    setInvoicePreviewUrl(null);
    setInvoiceScanFile(null);
    setLoadedScanPath(null);
    toast.info('تمت إزالة المرفق');
  };

  // Check saved banner from navigation if any
  useEffect(() => {
    if (location.state?.purchaseSaved) {
      setSavedBanner({ total: location.state.total });
      navigate('/purchases', { replace: true, state: {} });
    }
  }, [location.state, navigate]);

  // Clean up invoice preview url on unmount
  useEffect(() => {
    return () => {
      if (invoicePreviewUrl) URL.revokeObjectURL(invoicePreviewUrl);
    };
  }, [invoicePreviewUrl]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (supplierDropdownRef.current && !supplierDropdownRef.current.contains(e.target)) {
        setSupplierDropdownOpen(false);
      }
      if (tableDropdownRef.current && !tableDropdownRef.current.contains(e.target)) {
        setDropdownRowKey(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // -------------------------------------------------------------
  // Handle URL Query Params (e.g. from LowStockPage: ?barcode=...&product=...)
  // -------------------------------------------------------------
  useEffect(() => {
    const qBarcode = searchParams.get('barcode');
    const qProduct = searchParams.get('product');
    if ((!qBarcode && !qProduct) || !store?.id) return;

    (async () => {
      try {
        let query = supabase
          .from(PRODUCTS_TABLE)
          .select('id, barcode, reference, eng_name, full_price, price_after_disc, brand_group')
          .eq('store_id', store.id);

        if (qBarcode) {
          query = query.eq('barcode', qBarcode.trim());
        } else if (qProduct) {
          query = query.ilike('eng_name', `%${escapeIlike(qProduct.trim())}%`);
        }

        const { data } = await query.limit(1);
        if (data && data.length > 0) {
          const p = data[0];
          setLines([
            newLine({
              barcode: p.barcode || '',
              reference: p.reference || '',
              productId: p.id,
              productName: p.eng_name || '',
              sellPrice: Number(p.price_after_disc) > 0 ? Number(p.price_after_disc) : Number(p.full_price) || 0,
              stockFullPrice: Number(p.full_price) || 0,
              brandGroup: p.brand_group || '',
              unit_price: Number(p.full_price) || '',
              qty: '1',
            }),
            newLine(),
          ]);
        }
      } catch (e) {
        console.warn('Error loading product from URL params', e);
      }
    })();
  }, [searchParams, store?.id]);

  // -------------------------------------------------------------
  // Filtered Suppliers for Autocomplete
  // -------------------------------------------------------------
  const filteredSuppliers = useMemo(() => {
    const q = supplierCompanyName.trim().toLowerCase();
    if (!q) return suppliersList.slice(0, 10);
    return suppliersList
      .filter((s) => (s.name || '').toLowerCase().includes(q) || (s.phone || '').includes(q))
      .slice(0, 10);
  }, [supplierCompanyName, suppliersList]);

  const selectSupplier = (s) => {
    setSupplierCompanyName(s.name || '');
    setSupplierPhone(s.phone || '');
    setSelectedSupplierId(s.id);
    setSupplierDropdownOpen(false);
  };

  const openNewSupplierModal = (initialName = '') => {
    setNewSupplierInitialName(initialName || supplierCompanyName.trim());
    setSupplierDropdownOpen(false);
    setNewSupplierModalOpen(true);
  };

  const handleSupplierCreated = (data) => {
    setSuppliersList((prev) => [data, ...prev.filter((s) => s.id !== data.id)]);
    selectSupplier(data);
    setNewSupplierModalOpen(false);
  };

  // -------------------------------------------------------------
  // Product Autocomplete Inside Table
  // -------------------------------------------------------------
  const fetchProductSuggestions = useCallback(
    async (rowKey, rawTerm) => {
      const term = rawTerm.trim();
      if (!store?.id || term.length < 2) {
        setSuggestionsByRow((prev) => ({ ...prev, [rowKey]: [] }));
        return;
      }
      setSearchLoadingKey(rowKey);
      const safe = escapeIlike(term);
      const pattern = `%${safe}%`;
      const sel = 'id, barcode, reference, eng_name, full_price, price_after_disc, brand_group';
      try {
        const [r1, r2, r3, rUnits] = await Promise.all([
          supabase.from(PRODUCTS_TABLE).select(sel).eq('store_id', store.id).ilike('barcode', pattern).limit(8),
          supabase.from(PRODUCTS_TABLE).select(sel).eq('store_id', store.id).ilike('reference', pattern).limit(8),
          supabase.from(PRODUCTS_TABLE).select(sel).eq('store_id', store.id).ilike('eng_name', pattern).limit(8),
          supabase
            .from(PRODUCT_UNITS_TABLE)
            .select(`
              id,
              unit_name,
              conversion_factor,
              barcode,
              sale_price,
              cost_price,
              product_id,
              product:products(
                id,
                barcode,
                reference,
                eng_name,
                full_price,
                price_after_disc,
                brand_group
              )
            `)
            .eq('store_id', store.id)
            .ilike('barcode', pattern)
            .limit(8)
            .then((res) => res)
            .catch(() => ({ data: [] })),
        ]);
        const map = new Map();
        [r1.data, r2.data, r3.data].forEach((arr) => {
          (arr || []).forEach((p) => {
            if (p?.id) map.set(p.id, p);
          });
        });
        (rUnits?.data || []).forEach((u) => {
          if (u?.product?.id) {
            map.set(`unit_${u.id}`, {
              ...u.product,
              unitData: u,
            });
          }
        });
        setSuggestionsByRow((prev) => ({
          ...prev,
          [rowKey]: Array.from(map.values()).slice(0, 15),
        }));
      } catch (e) {
        console.warn('product search error', e);
        setSuggestionsByRow((prev) => ({ ...prev, [rowKey]: [] }));
      } finally {
        setSearchLoadingKey(null);
      }
    },
    [store?.id]
  );

  const scheduleSearch = useCallback(
    (rowKey, term) => {
      if (searchTimersRef.current[rowKey]) clearTimeout(searchTimersRef.current[rowKey]);
      searchTimersRef.current[rowKey] = setTimeout(() => {
        fetchProductSuggestions(rowKey, term);
      }, 250);
    },
    [fetchProductSuggestions]
  );

  // -------------------------------------------------------------
  // Calculations & Totals
  // -------------------------------------------------------------
  const linePayloads = useMemo(
    () => computePurchaseLinePayloads(lines, landedCostExtra),
    [lines, landedCostExtra]
  );

  const subtotalBeforeDiscount = useMemo(() => {
    return lines.reduce((acc, r) => {
      const q = Math.max(0, parseFloat(String(r.qty).replace(',', '.')) || 0);
      const u = Math.max(0, parseFloat(String(r.unit_price).replace(',', '.')) || 0);
      return acc + q * u;
    }, 0);
  }, [lines]);

  const subtotalAfterDiscount = useMemo(() => {
    return linePayloads.reduce((a, x) => a + x.line_total, 0);
  }, [linePayloads]);

  const totalDiscountAmount = useMemo(() => {
    return Math.max(0, subtotalBeforeDiscount - subtotalAfterDiscount);
  }, [subtotalBeforeDiscount, subtotalAfterDiscount]);

  const landingTotal = useMemo(
    () => Math.max(0, parseFloat(String(landedCostExtra).replace(',', '.')) || 0),
    [landedCostExtra]
  );

  // Tax calculations
  const taxRateNum = useMemo(() => {
    return Math.max(0, Math.min(100, parseFloat(String(taxRate).replace(',', '.')) || 0));
  }, [taxRate]);

  const { subtotalBeforeTax, taxAmount, totalAfterTax } = useMemo(() => {
    if (taxRateNum <= 0) {
      return {
        subtotalBeforeTax: subtotalAfterDiscount,
        taxAmount: 0,
        totalAfterTax: subtotalAfterDiscount,
      };
    }
    if (isTaxInclusive) {
      const tot = subtotalAfterDiscount;
      const before = Math.round((tot / (1 + taxRateNum / 100)) * 100) / 100;
      const tax = Math.round((tot - before) * 100) / 100;
      return {
        subtotalBeforeTax: before,
        taxAmount: tax,
        totalAfterTax: tot,
      };
    } else {
      const before = subtotalAfterDiscount;
      const tax = Math.round((before * (taxRateNum / 100)) * 100) / 100;
      const tot = Math.round((before + tax) * 100) / 100;
      return {
        subtotalBeforeTax: before,
        taxAmount: tax,
        totalAfterTax: tot,
      };
    }
  }, [subtotalAfterDiscount, taxRateNum, isTaxInclusive]);

  const grandTotal = useMemo(
    () => Math.round((totalAfterTax + landingTotal) * 100) / 100,
    [totalAfterTax, landingTotal]
  );

  const totalUnitsCount = useMemo(() => {
    return lines.reduce((acc, r) => {
      const q = Math.max(0, parseFloat(String(r.qty).replace(',', '.')) || 0);
      return acc + (q > 0 && r.unit_price !== '' ? q : 0);
    }, 0);
  }, [lines]);

  const validItemsCount = useMemo(() => {
    return lines.filter((r) => stockQtyFromLine(r) > 0 && r.unit_price !== '').length;
  }, [lines]);

  // Pre-orders reservations
  const productIdsForPreOrders = useMemo(
    () => [...new Set(lines.map((l) => l.productId).filter(Boolean))],
    [lines]
  );

  const reservationsByProduct = useMemo(
    () => groupReservationsByProduct(preOrderReservations),
    [preOrderReservations]
  );

  useEffect(() => {
    if (!store?.id || productIdsForPreOrders.length === 0) {
      setPreOrderReservations([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchPendingReservationsForProducts(store.id, productIdsForPreOrders);
        if (!cancelled) setPreOrderReservations(rows);
      } catch (e) {
        console.warn('pre-order reservations error', e);
        if (!cancelled) setPreOrderReservations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store?.id, productIdsForPreOrders]);

  // -------------------------------------------------------------
  // Table Row Actions (Inline Editing & Excel-style Auto Append)
  // -------------------------------------------------------------
  const updateLine = useCallback((key, field, value) => {
    setLines((prev) => {
      const idx = prev.findIndex((r) => r.key === key);
      if (idx === -1) return prev;

      const current = prev[idx];
      const next = { ...current, [field]: value };

      if (field === 'barcode' && current.productId && value !== current.barcode) {
        next.productId = null;
        next.productName = '';
        next.sellPrice = null;
        next.stockFullPrice = null;
        next.brandGroup = '';
        next.expiryDate = '';
        next.serialInput = '';
      }

      const updated = [...prev];
      updated[idx] = next;

      // Excel-style auto append: if editing the last row and it has any data, append a new empty row!
      if (idx === prev.length - 1) {
        const hasContent = Boolean(
          next.barcode?.trim() ||
            next.productName?.trim() ||
            next.reference?.trim() ||
            (next.unit_price && String(next.unit_price).trim() !== '')
        );
        if (hasContent) {
          updated.push(newLine());
        }
      }

      return updated;
    });
  }, []);

  const pickProduct = useCallback(
    (rowKey, p) => {
      const u = p.unitData;
      const factor = u ? Number(u.conversion_factor) || 1 : 1;
      const pad = Number(p.price_after_disc);
      const fp = Number(p.full_price) || 0;
      const unitCost =
        u && Number(u.cost_price) > 0
          ? Number(u.cost_price)
          : fp > 0
            ? fp * factor
            : null;

      setLines((prev) => {
        const idx = prev.findIndex((r) => r.key === rowKey);
        if (idx === -1) return prev;

        const updatedRow = {
          ...prev[idx],
          barcode: String(u?.barcode || p.barcode || '').trim(),
          reference: String(p.reference ?? '').trim(),
          productId: p.id,
          productName: String(p.eng_name ?? '').trim().slice(0, 80),
          unit: u ? u.unit_name : prev[idx].unit || 'قطعة',
          conversionFactor: factor,
          unit_price:
            unitCost != null
              ? String(Math.round(unitCost * 100) / 100)
              : prev[idx].unit_price !== ''
                ? prev[idx].unit_price
                : fp > 0
                  ? String(fp)
                  : '',
          sellPrice: u && Number(u.sale_price) > 0 ? Number(u.sale_price) : pad > 0 ? pad : fp,
          stockFullPrice: fp,
          brandGroup: String(p.brand_group ?? '').trim().slice(0, 80),
        };

        const nextLines = [...prev];
        nextLines[idx] = updatedRow;

        // If this was the last row, auto append another empty row
        if (idx === prev.length - 1) {
          nextLines.push(newLine());
        }

        return nextLines;
      });

      setSuggestionsByRow((prev) => ({ ...prev, [rowKey]: [] }));
      setDropdownRowKey(null);

      // Fetch units for product if not yet loaded
      if (p?.id && store?.id) {
        fetchUnitsByProductId(p.id, store.id).then((units) => {
          if (units && units.length > 0) {
            setProductUnitsMap((prevMap) => ({ ...prevMap, [p.id]: units }));
          }
        });
      }
    },
    [store?.id]
  );

  const handleUnitChange = useCallback(
    (rowKey, newUnitName) => {
      setLines((prev) => {
        return prev.map((r) => {
          if (r.key !== rowKey) return r;
          const units = (r.productId && productUnitsMap[r.productId]) || [];
          const matchedUnit = units.find((u) => u.unit_name === newUnitName);
          if (matchedUnit) {
            const factor = Number(matchedUnit.conversion_factor) || 1;
            let newUnitPrice = r.unit_price;
            if (Number(matchedUnit.cost_price) > 0) {
              newUnitPrice = String(matchedUnit.cost_price);
            } else {
              const oldFactor = Number(r.conversionFactor) || 1;
              const baseCost =
                Number(r.stockFullPrice) ||
                (Number(r.unit_price) > 0 ? Number(r.unit_price) / oldFactor : 0);
              if (baseCost > 0) {
                newUnitPrice = String(Math.round(baseCost * factor * 100) / 100);
              }
            }
            return {
              ...r,
              unit: newUnitName,
              conversionFactor: factor,
              unit_price: newUnitPrice,
              barcode: matchedUnit.barcode || r.barcode,
            };
          }
          return {
            ...r,
            unit: newUnitName,
            conversionFactor: 1,
          };
        });
      });
    },
    [productUnitsMap]
  );

  const handleBarcodeKeyDown = useCallback(
    async (e, row) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const clean = normalizeDigitsToLatin(String(row.barcode || '').trim());
      if (!clean || !store?.id) return;

      // 1. Check products.barcode first
      const { data: prodData } = await supabase
        .from(PRODUCTS_TABLE)
        .select('id, barcode, reference, eng_name, full_price, price_after_disc, brand_group')
        .eq('store_id', store.id)
        .eq('barcode', clean)
        .maybeSingle();

      if (prodData) {
        pickProduct(row.key, prodData);
        return;
      }

      // 2. Check product_units.barcode fallback
      const unitMatch = await findUnitByBarcode(clean, store.id);
      if (unitMatch && unitMatch.product) {
        pickProduct(row.key, {
          ...unitMatch.product,
          unitData: unitMatch,
        });
        return;
      }
    },
    [store?.id, pickProduct]
  );

  const addRow = () => setLines((prev) => [...prev, newLine()]);

  const removeRow = (key) => {
    setLines((prev) => (prev.length <= 1 ? [newLine()] : prev.filter((r) => r.key !== key)));
  };

  const duplicateRow = useCallback((key) => {
    setLines((prev) => {
      const idx = prev.findIndex((r) => r.key === key);
      if (idx === -1) return prev;
      const src = prev[idx];
      const copy = {
        ...newLine(),
        barcode: src.barcode,
        reference: src.reference,
        unit: src.unit,
        conversionFactor: src.conversionFactor || 1,
        unit_price: src.unit_price,
        discount_percent: src.discount_percent,
        qty: src.qty,
        warehouse: src.warehouse || 'الرئيسي',
        batchNumber: src.batchNumber || '',
        productId: src.productId,
        productName: src.productName,
        sellPrice: src.sellPrice,
        stockFullPrice: src.stockFullPrice,
        brandGroup: src.brandGroup,
        expiryDate: '',
        serialInput: '',
        showDetails: src.showDetails,
      };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  }, []);

  const toggleRowDetails = useCallback((key) => {
    setLines((prev) =>
      prev.map((r) => (r.key === key ? { ...r, showDetails: !r.showDetails } : r))
    );
  }, []);

  // -------------------------------------------------------------
  // Modals for Fast Search & New Product
  // -------------------------------------------------------------
  const searchProductsForModal = useCallback(
    async (q) => {
      const term = q.trim();
      if (!store?.id || term.length < 1) {
        setProductSearchResults([]);
        setProductSearchLoading(false);
        return;
      }
      setProductSearchLoading(true);
      const safe = escapeIlike(term);
      const pattern = `%${safe}%`;
      const sel = 'id, barcode, reference, eng_name, full_price, price_after_disc, purchase_price, brand_group, stock_count, image_url';
      try {
        const [r1, r2, r3, rUnits] = await Promise.all([
          supabase.from(PRODUCTS_TABLE).select(sel).eq('store_id', store.id).ilike('eng_name', pattern).limit(15),
          supabase.from(PRODUCTS_TABLE).select(sel).eq('store_id', store.id).ilike('barcode', pattern).limit(10),
          supabase.from(PRODUCTS_TABLE).select(sel).eq('store_id', store.id).ilike('reference', pattern).limit(10),
          supabase
            .from(PRODUCT_UNITS_TABLE)
            .select(`
              id,
              unit_name,
              conversion_factor,
              barcode,
              sale_price,
              cost_price,
              product_id,
              product:products(
                id,
                barcode,
                reference,
                eng_name,
                full_price,
                price_after_disc,
                purchase_price,
                brand_group,
                stock_count,
                image_url
              )
            `)
            .eq('store_id', store.id)
            .ilike('barcode', pattern)
            .limit(10)
            .then((res) => res)
            .catch(() => ({ data: [] })),
        ]);
        const map = new Map();
        [r1.data, r2.data, r3.data].forEach((arr) =>
          (arr || []).forEach((p) => {
            if (p?.id) map.set(p.id, p);
          })
        );
        (rUnits?.data || []).forEach((u) => {
          if (u?.product?.id) {
            map.set(`u_${u.id}`, {
              ...u.product,
              unitData: u,
            });
          }
        });

        // Exact match prioritized at top
        const cleanTerm = normalizeDigitsToLatin(term).toLowerCase();
        const results = Array.from(map.values()).sort((a, b) => {
          const aBc = normalizeDigitsToLatin(String(a.unitData?.barcode || a.barcode || '')).toLowerCase();
          const bBc = normalizeDigitsToLatin(String(b.unitData?.barcode || b.barcode || '')).toLowerCase();
          if (aBc === cleanTerm && bBc !== cleanTerm) return -1;
          if (bBc === cleanTerm && aBc !== cleanTerm) return 1;
          return 0;
        });

        setProductSearchResults(results.slice(0, 30));
      } catch (e) {
        console.warn('product modal search error', e);
        setProductSearchResults([]);
      } finally {
        setProductSearchLoading(false);
      }
    },
    [store?.id]
  );

  const addProductFromSearch = useCallback((p) => {
    const pad = Number(p.price_after_disc);
    const fp = Number(p.full_price) || 0;
    const u = p.unitData;
    const factor = u ? Number(u.conversion_factor) || 1 : 1;
    // Prefer unit cost_price or product purchase_price
    const unitCost =
      u && Number(u.cost_price) > 0
        ? Number(u.cost_price)
        : p.purchase_price != null && Number(p.purchase_price) > 0
          ? Number(p.purchase_price) * factor
          : fp > 0
            ? fp * factor
            : null;

    setLines((prev) => {
      // Find first empty line or append
      const emptyIdx = prev.findIndex((r) => !r.productId && !r.barcode && !r.productName);
      const populated = {
        ...(emptyIdx !== -1 ? prev[emptyIdx] : newLine()),
        barcode: String(u?.barcode || p.barcode || '').trim(),
        reference: String(p.reference ?? '').trim(),
        productId: p.id,
        productName: String(p.eng_name ?? '').trim().slice(0, 80),
        unit: u ? u.unit_name : 'قطعة',
        conversionFactor: factor,
        unit_price:
          unitCost != null
            ? String(Math.round(unitCost * 100) / 100)
            : fp > 0
              ? String(fp)
              : '',
        sellPrice: u && Number(u.sale_price) > 0 ? Number(u.sale_price) : pad > 0 ? pad : fp,
        stockFullPrice: fp,
        brandGroup: String(p.brand_group ?? '').trim().slice(0, 80),
      };

      if (emptyIdx !== -1) {
        const updated = [...prev];
        updated[emptyIdx] = populated;
        if (emptyIdx === prev.length - 1) updated.push(newLine());
        return updated;
      }
      return [...prev, populated, newLine()];
    });

    if (p?.id && store?.id) {
      fetchUnitsByProductId(p.id, store.id).then((units) => {
        if (units && units.length > 0) {
          setProductUnitsMap((prevMap) => ({ ...prevMap, [p.id]: units }));
        }
      });
    }

    setProductSearchOpen(false);
    setProductSearchQuery('');
    setProductSearchResults([]);
  }, [store?.id]);

  const handleModalSearchChange = useCallback(
    (val) => {
      setProductSearchQuery(val);
      if (modalSearchTimerRef.current) {
        clearTimeout(modalSearchTimerRef.current);
      }
      const trimmed = val.trim();
      if (!trimmed) {
        setProductSearchResults([]);
        setProductSearchLoading(false);
        return;
      }
      setProductSearchLoading(true);
      modalSearchTimerRef.current = setTimeout(() => {
        searchProductsForModal(trimmed);
      }, 180);
    },
    [searchProductsForModal]
  );

  const handleModalSearchKeyDown = useCallback(
    async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const raw = productSearchQuery.trim();
      const clean = normalizeDigitsToLatin(raw);
      if (!clean || !store?.id) return;

      // 1. Exact match in current search results
      const exactMatch = productSearchResults.find((p) => {
        const bc = normalizeDigitsToLatin(String(p.unitData?.barcode || p.barcode || '')).trim();
        const ref = normalizeDigitsToLatin(String(p.reference || '')).trim();
        return (
          (bc && bc.toLowerCase() === clean.toLowerCase()) ||
          (ref && ref.toLowerCase() === clean.toLowerCase())
        );
      });

      if (exactMatch) {
        addProductFromSearch(exactMatch);
        return;
      }

      // 2. If only 1 result exists in list, pick it
      if (productSearchResults.length === 1) {
        addProductFromSearch(productSearchResults[0]);
        return;
      }

      // 3. Direct DB lookup for scanned barcode
      setProductSearchLoading(true);
      try {
        const { data: prodData } = await supabase
          .from(PRODUCTS_TABLE)
          .select('id, barcode, reference, eng_name, full_price, price_after_disc, purchase_price, brand_group, stock_count, image_url')
          .eq('store_id', store.id)
          .eq('barcode', clean)
          .maybeSingle();

        if (prodData) {
          addProductFromSearch(prodData);
          return;
        }

        const unitMatch = await findUnitByBarcode(clean, store.id);
        if (unitMatch && unitMatch.product) {
          addProductFromSearch({
            ...unitMatch.product,
            unitData: unitMatch,
          });
          return;
        }
      } catch (err) {
        console.warn('Direct barcode Enter lookup error', err);
      } finally {
        setProductSearchLoading(false);
      }
    },
    [productSearchQuery, store?.id, productSearchResults, addProductFromSearch]
  );

  const handleNewProductSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      if (!store?.id) return;
      if (!npEngName.trim()) {
        toast.warning('أدخل اسم المنتج.');
        return;
      }
      const up0 = parseFloat(String(npUnitPrice).replace(',', '.')) || 0;
      if (up0 < 0) {
        toast.warning('سعر الشراء غير صالح.');
        return;
      }
      const qi0 = Math.max(0, parseFloat(String(npQty).replace(',', '.')) || 0);
      if (qi0 <= 0) {
        toast.warning('الكمية يجب أن تكون أكبر من صفر.');
        return;
      }
      setNewProductSaving(true);
      try {
        const p = await insertNewProductForPurchase(supabase, store.id, {
          engName: npEngName,
          reference: npRef,
          barcode: npBarcode,
          unitPrice: npUnitPrice,
          discountPercent: npDiscount,
        });
        const fp = Number(p.full_price) || 0;
        const pad = Number(p.price_after_disc);
        const refShow = String(p.reference ?? npRef ?? '').trim();
        const nameShow = String(p.eng_name ?? npEngName).slice(0, 80);

        setLines((prev) => [
          ...prev,
          {
            ...newLine(),
            barcode: String(p.barcode || ''),
            reference: refShow || nameShow,
            productId: p.id,
            productName: nameShow,
            sellPrice: pad > 0 ? pad : fp,
            stockFullPrice: fp,
            brandGroup: String(p.brand_group ?? '').trim().slice(0, 80),
            unit_price: npUnitPrice,
            discount_percent: npDiscount,
            qty: npQty,
          },
          newLine(),
        ]);
        setNewProductOpen(false);
        toast.success('تمت إضافة المنتج بنجاح إلى الفاتورة');
      } catch (err) {
        toast.error(err?.message || String(err));
      } finally {
        setNewProductSaving(false);
      }
    },
    [store?.id, npEngName, npRef, npBarcode, npUnitPrice, npDiscount, npQty, toast]
  );

  // -------------------------------------------------------------
  // Invoice Scan Handlers
  // -------------------------------------------------------------
  const handleInvoiceFileChosen = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    invoiceFileRef.current?.removeAttribute('capture');
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      toast.warning('يرجى اختيار ملف صورة.');
      return;
    }
    if (f.size > 12 * 1024 * 1024) {
      toast.warning('حجم الملف كبير جداً (الحد 12 ميجابايت).');
      return;
    }
    setInvoicePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
    setInvoiceScanFile(f);
  };

  const clearInvoiceScan = () => {
    setInvoicePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setInvoiceScanFile(null);
  };

  // -------------------------------------------------------------
  // Save Purchase Invoice
  // -------------------------------------------------------------
  const handleSavePurchase = async () => {
    if (!store?.id) return;

    const company = supplierCompanyName.trim();
    const inv = normalizeDigitsToLatin(invoiceNumber.trim());
    const finalInv = inv || generateAutoInvoiceNumber();
    const phone = normalizeDigitsToLatin(supplierPhone.trim());
    const invoiceDateVal = String(invoiceDate || '').trim().slice(0, 10);
    const paymentDueDateVal =
      paymentMode === 'credit'
        ? String(paymentDueDate || addDaysISO(invoiceDateVal, 30)).trim().slice(0, 10)
        : null;

    if (!company) {
      toast.warning('أدخل اسم المورد أو اختره من القائمة');
      return;
    }
    if (!invoiceDateVal) {
      toast.warning('اختر تاريخ الفاتورة');
      return;
    }
    if (!phone && !selectedSupplierId) {
      toast.warning('أدخل رقم هاتف المورد الجديد');
      return;
    }
    if (paymentMode === 'credit' && !paymentDueDateVal) {
      toast.warning('اختر تاريخ استحقاق سداد الفاتورة الآجلة');
      return;
    }

    let linesForSave = lines;
    try {
      linesForSave = await resolvePurchaseLinesNewProducts(supabase, store.id, lines);
    } catch (e) {
      toast.error(e?.message || String(e));
      return;
    }

    const linePayloadsForSave = computePurchaseLinePayloads(linesForSave, landedCostExtra);
    const subtotalAfterDiscountSave = linePayloadsForSave.reduce((a, x) => a + x.line_total, 0);

    if (subtotalAfterDiscountSave <= 0) {
      toast.warning('أضف أصنافاً بمبالغ صحيحة — إجمالي الفاتورة يجب أن يكون أكبر من صفر');
      return;
    }

    const validLines = linePayloadsForSave.filter((x) => x.qty > 0 && x.unit_price >= 0);
    if (validLines.length === 0) {
      toast.warning('أدخل سطراً واحداً على الأقل بكمية وسعر');
      return;
    }

    // حساب الضريبة والإجمالي النهائي للحفظ
    let subtotalBeforeTaxSave = subtotalAfterDiscountSave;
    let taxAmountSave = 0;
    let totalAfterTaxSave = subtotalAfterDiscountSave;

    if (taxRateNum > 0) {
      if (isTaxInclusive) {
        totalAfterTaxSave = subtotalAfterDiscountSave;
        subtotalBeforeTaxSave = Math.round((totalAfterTaxSave / (1 + taxRateNum / 100)) * 100) / 100;
        taxAmountSave = Math.round((totalAfterTaxSave - subtotalBeforeTaxSave) * 100) / 100;
      } else {
        subtotalBeforeTaxSave = subtotalAfterDiscountSave;
        taxAmountSave = Math.round((subtotalBeforeTaxSave * (taxRateNum / 100)) * 100) / 100;
        totalAfterTaxSave = Math.round((subtotalBeforeTaxSave + taxAmountSave) * 100) / 100;
      }
    }

    const grandTotalSave = Math.round((totalAfterTaxSave + landingTotal) * 100) / 100;

    setSaving(true);

    try {
      let invoiceScanPath = loadedScanPath;
      if (invoiceScanFile) {
        invoiceScanPath = await uploadPurchaseInvoiceScan(store.id, invoiceScanFile);
        setLoadedScanPath(invoiceScanPath);
      }

      let supplierContactId = selectedSupplierId;
      if (!supplierContactId && company) {
        const { contactId } = await upsertSupplierForCreditDraft(phone, company, store.id);
        supplierContactId = contactId;
      }

      const selectedAcc = accountsList.find((a) => a.code === purchaseAccountId || a.id === purchaseAccountId);
      const selectedAccountName = selectedAcc ? `${selectedAcc.code} - ${selectedAcc.name}` : `${purchaseAccountId} - المخزون`;

      const notesText = [
        `شركة: ${company}`,
        `رقم فاتورة المورد: ${finalInv}`,
        `تاريخ الفاتورة: ${invoiceDateVal}`,
        paymentDueDateVal && `استحقاق السداد: ${paymentDueDateVal}`,
        phone && `هاتف: ${phone}`,
        `حساب المشتريات: ${selectedAccountName}`,
        taxRateNum > 0 && `الضريبة: ${taxRateNum}% (${isTaxInclusive ? 'شامل' : 'غير شامل'})`,
        invoiceScanPath && `[مرفق]: ${invoiceScanPath}`,
        extraNotes.trim() && `ملاحظات: ${extraNotes.trim()}`,
      ]
        .filter(Boolean)
        .join('\n');

      const landingPart = landingTotal > 0 ? { landed_cost_extra: landingTotal } : {};
      const duePart = paymentDueDateVal ? { payment_due_date: paymentDueDateVal } : {};

      const rowFull = {
        store_id: store.id,
        supplier_contact_id: supplierContactId,
        supplier_company_name: company,
        invoice_number: finalInv,
        invoice_date: invoiceDateVal,
        supplier_phone: phone,
        total_amount: grandTotalSave,
        subtotal: subtotalBeforeTaxSave,
        tax_amount: taxAmountSave,
        payment_mode: paymentMode,
        purchase_status: purchaseStatus === 'draft' ? 'draft' : 'received',
        ...duePart,
        ...landingPart,
        line_items: validLines,
        notes: notesText,
      };

      let purchaseId = currentPurchaseId;
      if (currentPurchaseId) {
        const { error: updErr } = await supabase
          .from(PURCHASES_TABLE)
          .update(rowFull)
          .eq('id', currentPurchaseId)
          .eq('store_id', store.id);
        if (updErr) throw updErr;

        if (purchaseStatus === 'received' && loadedPurchaseOriginalStatus === 'draft') {
          await executePurchaseReceiveEffects({
            storeId: store.id,
            purchaseId,
            lines: linesForSave,
            linePayloads: linePayloadsForSave,
            updateCatalogCosts,
            companyName: company,
            invoiceDateVal,
            paymentMode,
            supplierContactId,
            grandTotal: grandTotalSave,
          });
          setLoadedPurchaseOriginalStatus('received');
        }
      } else {
        const { data: insData, error: insErr } = await supabase
          .from(PURCHASES_TABLE)
          .insert([rowFull])
          .select('id')
          .single();
        if (insErr) throw insErr;
        purchaseId = insData?.id ?? null;

        if (purchaseStatus === 'received') {
          try {
            await executePurchaseReceiveEffects({
              storeId: store.id,
              purchaseId,
              lines: linesForSave,
              linePayloads: linePayloadsForSave,
              updateCatalogCosts,
              companyName: company,
              invoiceDateVal,
              paymentMode,
              supplierContactId,
              grandTotal: grandTotalSave,
            });
          } catch (stockErr) {
            console.error(stockErr);
            if (purchaseId) {
              await supabase.from(PURCHASES_TABLE).delete().eq('id', purchaseId).eq('store_id', store.id);
            }
            throw stockErr instanceof Error ? stockErr : new Error(String(stockErr?.message || stockErr));
          }
        }
      }

      toast.success(
        currentPurchaseId
          ? `تم تحديث الفاتورة (#${finalInv}) بنجاح (المجموع: ₪${grandTotalSave.toFixed(2)})`
          : purchaseStatus === 'received'
          ? `تم حفظ الفاتورة (#${finalInv}) واستلام البضاعة للمخزن بنجاح (المجموع: ₪${grandTotalSave.toFixed(2)})`
          : `تم حفظ الفاتورة (#${finalInv}) كمسودة بنجاح (المجموع: ₪${grandTotalSave.toFixed(2)})`
      );

      setCurrentPurchaseId(purchaseId);
      setInvoiceNumber(finalInv);
      setSavedBanner({ total: grandTotalSave, invoiceNumber: finalInv });
      setIsSavedMode(true);
      loadSuppliers();
      fetchInvoicesNavList();
    } catch (e) {
      console.error(e);
      const msg = e?.message || e?.details || e?.hint || '';
      toast.error(msg.trim() ? msg : 'فشل حفظ فاتورة المشتريات');
    } finally {
      setSaving(false);
    }
  };

  if (storeLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="animate-spin text-indigo-500 dark:text-indigo-400" size={40} />
        </div>
      </DashboardLayout>
    );
  }

  if (!store?.id) {
    return (
      <DashboardLayout>
        <div
          className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center font-bold dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
          dir="rtl"
        >
          لا يوجد متجر مرتبط بحسابك.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/purchases/history"
            className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-violet-700 hover:bg-violet-50 dark:border-white/10 dark:bg-white/5 dark:text-violet-300 dark:hover:bg-violet-950/40"
          >
            <ClipboardList size={15} />
            سجل المشتريات
          </Link>
          <Link
            to="/purchases/supplier-statement"
            className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
          >
            <FileText size={15} />
            كشف حساب مورد
          </Link>
        </div>
      }
    >
      <div className="w-full max-w-[1550px] mx-auto space-y-3 pb-12" dir="rtl">
        {/* Banner after successful save */}
        {savedBanner && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-950/50 px-5 py-3 text-xs font-bold text-emerald-900 dark:text-emerald-100 shadow-sm animate-fadeIn">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs shrink-0">
                <Check size={20} className="stroke-[3]" />
              </div>
              <div>
                <div className="text-sm font-black flex items-center gap-2">
                  <span>تم حفظ الفاتورة بنجاح</span>
                  {savedBanner.invoiceNumber && (
                    <span className="font-mono text-xs bg-emerald-200/70 dark:bg-emerald-900/60 text-emerald-950 dark:text-emerald-200 px-2 py-0.5 rounded-lg" dir="ltr">
                      #{savedBanner.invoiceNumber}
                    </span>
                  )}
                  <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                    (الفاتورة في وضع العرض فقط — معتمدة ومحفوظة)
                  </span>
                </div>
                <div className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-0.5">
                  الصافي النهائي:{' '}
                  <span className="font-currency font-black text-emerald-950 dark:text-white" dir="ltr" lang="en">
                    ₪ {Number(savedBanner.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  {' '}— للبدء بفاتورة جديدة فارغة اضغط على «فاتورة جديدة».
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrintCurrentInvoice}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs transition shadow-xs"
              >
                <Printer size={14} />
                <span>طباعة</span>
              </button>
              <button
                type="button"
                onClick={handleNewInvoice}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs transition shadow-xs"
              >
                <Plus size={14} />
                <span>فاتورة جديدة</span>
              </button>
              <button
                type="button"
                onClick={() => setSavedBanner(null)}
                className="p-1.5 text-emerald-700 hover:text-emerald-900 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 rounded-lg transition"
                title="إغلاق التنبيه"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* 0. شريط أزرار التنقل والطباعة وفاتورة جديدة (Navigation & Print Bar) */}
        {/* ------------------------------------------------------------- */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/95 dark:bg-slate-900/90 backdrop-blur-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3 transition-colors">
          
          {/* الجانب الأيمن: زر "جديد" + شارة الحالة */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleNewInvoice}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white font-bold text-xs shadow-xs transition-all duration-150 hover:scale-105 active:scale-95"
              title="إنشاء فاتورة مشتريات جديدة فارغة"
            >
              <Plus size={15} />
              <span>فاتورة جديدة</span>
            </button>

            {isSavedMode || currentPurchaseId ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-black text-white bg-emerald-600 px-3 py-1.5 rounded-xl shadow-xs">
                <Check size={14} className="stroke-[3]" />
                <span>محفوظة {purchaseStatus === 'received' ? '(مرحّلة للمخزن)' : '(مسودة)'}</span>
                {invoiceNumber ? <span className="font-mono text-[11px] opacity-90">#{invoiceNumber}</span> : null}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 px-3 py-1 rounded-xl">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span>جديد (مسودة)</span>
              </span>
            )}
          </div>

          {/* المنتصف: أزرار التنقل (◀ السابقة / التالية ▶) مع العداد */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/90 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700/60 shadow-inner">
            {/* زر السابقة ◀ */}
            <button
              type="button"
              onClick={handlePrevInvoice}
              disabled={!canGoPrev || navLoading}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-35 disabled:hover:bg-transparent disabled:cursor-not-allowed transition shadow-xs"
              title="الانتقال للفاتورة السابقة"
            >
              <span>◀</span>
              <span>السابقة</span>
            </button>

            {/* عداد الفاتورة (X من Y) */}
            <div className="px-3 py-1 text-xs font-bold text-slate-700 dark:text-slate-300 min-w-[130px] text-center select-none">
              {navLoading ? (
                <span className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400">
                  <Loader2 size={13} className="animate-spin inline" />
                  <span>جاري التحميل…</span>
                </span>
              ) : invoicesNavList.length === 0 ? (
                <span className="text-slate-400">لا توجد فواتير</span>
              ) : currentPurchaseIndex >= 0 ? (
                <span>
                  فاتورة <span className="text-violet-600 dark:text-violet-400 font-mono font-black">{currentPurchaseIndex + 1}</span> من <span className="font-mono font-black">{invoicesNavList.length}</span>
                </span>
              ) : (
                <span>
                  جديدة <span className="text-slate-400 font-mono">(من {invoicesNavList.length})</span>
                </span>
              )}
            </div>

            {/* زر التالية ▶ */}
            <button
              type="button"
              onClick={handleNextInvoice}
              disabled={!canGoNext || navLoading}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-35 disabled:hover:bg-transparent disabled:cursor-not-allowed transition shadow-xs"
              title="الانتقال للفاتورة التالية"
            >
              <span>التالية</span>
              <span>▶</span>
            </button>
          </div>

          {/* الجانب الأيسر: أزرار المرفقات، طباعة الباركود، والطباعة الرسمية */}
          <div className="flex items-center gap-2">
            {/* زر المرفقات */}
            <button
              type="button"
              onClick={() => setAttachmentsModalOpen(true)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs border ${
                invoiceScanFile || loadedScanPath
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              }`}
              title="إرفاق أو معاينة مستند أو صورة فاتورة المورد"
            >
              <Paperclip size={14} />
              <span>مرفقات</span>
              {(invoiceScanFile || loadedScanPath) && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              )}
            </button>

            {/* زر طباعة باركود للأصناف */}
            <button
              type="button"
              onClick={() => setBarcodeModalOpen(true)}
              disabled={validItemsCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100 dark:border-violet-800/60 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-900/50 shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="طباعة ملصقات الباركود للأصناف المستلمة بعدد حباتها"
            >
              <BarcodeIcon size={15} />
              <span>طباعة باركود</span>
            </button>

            {/* زر طباعة الفاتورة */}
            <button
              type="button"
              onClick={handlePrintCurrentInvoice}
              disabled={!currentPurchaseId}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-black transition-all shadow-xs ${
                currentPurchaseId
                  ? 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 hover:scale-105 active:scale-95 cursor-pointer'
                  : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600 border border-slate-200 dark:border-slate-700 cursor-not-allowed opacity-60'
              }`}
              title={
                currentPurchaseId
                  ? 'طباعة الفاتورة المعروضة حالياً كوثيقة رسمية'
                  : 'زر الطباعة معطل لأن الفاتورة الحالية مسودة غير محفوظة بعد'
              }
            >
              <Printer size={15} />
              <span>طباعة</span>
            </button>
          </div>

        </div>

        {/* ------------------------------------------------------------- */}
        {/* 1. HEADER: Single Narrow Horizontal Strip */}
        {/* ------------------------------------------------------------- */}
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-3.5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-3.5">
            {/* Title / Icon badge */}
            <div className="flex items-center gap-2.5 pe-3.5 border-e border-slate-200 dark:border-slate-800 shrink-0">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                <ShoppingBag size={18} />
              </div>
              <span className="text-sm sm:text-base font-black text-slate-900 dark:text-white whitespace-nowrap">
                فاتورة مشتريات
              </span>
            </div>

            {/* الرقم الداخلي (تسلسلي تلقائي) */}
            <div className="w-32 sm:w-36">
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1 flex items-center justify-between">
                <span>الرقم الداخلي</span>
                <span className="text-[10px] text-violet-600 dark:text-violet-400 font-normal">(تلقائي)</span>
              </label>
              <div
                className="h-10 w-full rounded-xl border border-violet-200/80 bg-violet-50/50 dark:border-violet-900/50 dark:bg-violet-950/30 px-3 flex items-center justify-center font-mono font-black text-xs text-violet-700 dark:text-violet-300 select-all"
                dir="ltr"
                title="الرقم التسلسلي الداخلي لفاتورة المشتريات"
              >
                {internalInvoiceNumber}
              </div>
            </div>

            {/* مؤشر الحالة ملون (جديد / مرحّل / محفوظ) */}
            <div className="w-32 sm:w-36">
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                الحالة
              </label>
              <div
                className={`h-10 w-full rounded-xl px-2.5 flex items-center justify-center gap-1.5 text-xs font-black select-none shadow-xs transition-all ${
                  isSavedMode || currentPurchaseId
                    ? 'bg-emerald-600 text-white border border-emerald-700'
                    : 'bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-700'
                }`}
                title={isSavedMode || currentPurchaseId ? 'فاتورة معتمدة ومحفوظة' : 'مسودة غير محفوظة بعد'}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isSavedMode || currentPurchaseId ? 'bg-white' : 'bg-amber-500'
                  }`}
                />
                <span>
                  {isSavedMode || currentPurchaseId
                    ? (purchaseStatus === 'received' ? 'محفوظة ومرحّلة' : 'محفوظة (مسودة)')
                    : 'جديد (مسودة)'}
                </span>
              </div>
            </div>

            {/* Supplier Search / Input with Autocomplete */}
            <div className="relative min-w-[220px] flex-1" ref={supplierDropdownRef}>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
                  المورد <span className="text-rose-500">*</span>
                </label>
                {selectedSupplierId && !isSavedMode && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSupplierId(null);
                      setSupplierCompanyName('');
                      setSupplierPhone('');
                    }}
                    className="text-xs text-violet-600 dark:text-violet-400 hover:underline font-bold"
                  >
                    تغيير المورد
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  value={supplierCompanyName}
                  readOnly={isSavedMode}
                  disabled={isSavedMode}
                  onChange={(e) => {
                    if (isSavedMode) return;
                    setSupplierCompanyName(e.target.value);
                    setSelectedSupplierId(null);
                    setSupplierDropdownOpen(true);
                  }}
                  onFocus={() => {
                    if (!isSavedMode) setSupplierDropdownOpen(true);
                  }}
                  className={`h-10 w-full rounded-xl border px-3 text-sm font-bold outline-none transition-all ${
                    isSavedMode
                      ? 'border-slate-200 bg-slate-100/90 text-slate-800 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 cursor-default'
                      : 'border-slate-200 bg-slate-50/80 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900'
                  }`}
                  placeholder="ابحث أو اكتب اسم المورد…"
                />
                {selectedSupplierId && (
                  <UserCheck size={16} className="absolute left-3 top-3 text-emerald-600 dark:text-emerald-400" />
                )}
              </div>

              {/* Autocomplete Dropdown for Suppliers with "+ إضافة مورد جديد" */}
              {!isSavedMode && supplierDropdownOpen && (
                <ul className="absolute z-50 right-0 left-0 mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800 text-xs">
                  {filteredSuppliers.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="w-full text-right px-3.5 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 border-b border-slate-100 dark:border-slate-700/50 last:border-0 flex items-center justify-between"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectSupplier(s);
                        }}
                      >
                        <span className="font-bold text-sm text-slate-900 dark:text-slate-100">{s.name}</span>
                        <div className="flex items-center gap-3 text-xs font-currency text-slate-500 dark:text-slate-400" dir="ltr">
                          {s.phone && <span>{s.phone}</span>}
                          {Number(s.outstanding_amount) > 0 && (
                            <span className="text-amber-600 dark:text-amber-400 font-bold">
                              ذمة: ₪{Number(s.outstanding_amount).toFixed(2)}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}

                  {/* خيار إضافة مورد جديد عند الكتابة أو عدم وجود تطابق تام */}
                  {supplierCompanyName.trim() && !filteredSuppliers.some((s) => (s.name || '').toLowerCase() === supplierCompanyName.trim().toLowerCase()) && (
                    <li className="border-t border-slate-200 dark:border-slate-700 bg-violet-50/70 dark:bg-violet-950/30">
                      <button
                        type="button"
                        className="w-full text-right px-3.5 py-2.5 text-violet-700 hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-100 hover:bg-violet-100/70 dark:hover:bg-violet-900/50 flex items-center gap-2 font-black transition-colors"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          openNewSupplierModal(supplierCompanyName.trim());
                        }}
                      >
                        <Plus size={16} className="text-violet-600 dark:text-violet-400 stroke-[3]" />
                        <span>إضافة مورد جديد باسم «<strong className="underline">{supplierCompanyName.trim()}</strong>»</span>
                      </button>
                    </li>
                  )}
                  {filteredSuppliers.length === 0 && !supplierCompanyName.trim() && (
                    <li className="px-3.5 py-3 text-center text-slate-400">
                      لا يوجد موردين مسجلين بعد
                    </li>
                  )}
                </ul>
              )}
            </div>

            {/* Supplier Phone */}
            <div className="w-36 sm:w-44">
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                هاتف المورد {selectedSupplierId ? '(مسجّل)' : <span className="text-rose-500">*</span>}
              </label>
              <input
                type="tel"
                value={supplierPhone}
                readOnly={Boolean(selectedSupplierId) || isSavedMode}
                disabled={isSavedMode}
                onChange={(e) => {
                  if (!selectedSupplierId && !isSavedMode) {
                    setSupplierPhone(normalizeDigitsToLatin(e.target.value));
                  }
                }}
                className={`h-10 w-full rounded-xl border px-3 text-sm font-currency font-bold outline-none transition-all ${
                  selectedSupplierId || isSavedMode
                    ? 'border-slate-200 bg-slate-100 text-slate-600 cursor-not-allowed dark:border-slate-700/60 dark:bg-slate-800/50 dark:text-slate-300 select-none'
                    : 'border-slate-200 bg-slate-50/80 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900'
                }`}
                dir="ltr"
                lang="en"
                placeholder={selectedSupplierId ? 'مسجل مسبقاً' : '05xxxxxxxx'}
                title={selectedSupplierId ? 'رقم الهاتف مسجل في ملف المورد' : 'أدخل هاتف المورد الجديد'}
              />
            </div>

            {/* Invoice Number (Optional) */}
            <div className="w-36 sm:w-44">
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                رقم فاتورة المورد <span className="text-slate-400 font-normal">(اختياري)</span>
              </label>
              <input
                value={invoiceNumber}
                readOnly={isSavedMode}
                disabled={isSavedMode}
                onChange={(e) => !isSavedMode && setInvoiceNumber(normalizeDigitsToLatin(e.target.value))}
                className={`h-10 w-full rounded-xl border px-3 text-sm font-currency font-bold outline-none transition-all ${
                  isSavedMode
                    ? 'border-slate-200 bg-slate-100/90 text-slate-800 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 cursor-default'
                    : 'border-slate-200 bg-slate-50/80 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900'
                }`}
                dir="ltr"
                lang="en"
                placeholder="تلقائي إن تُرِك فارغاً"
              />
            </div>

            {/* Invoice Date */}
            <div className="w-36 sm:w-44">
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                تاريخ الفاتورة <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                value={invoiceDate}
                readOnly={isSavedMode}
                disabled={isSavedMode}
                onChange={(e) => {
                  if (isSavedMode) return;
                  setInvoiceDate(e.target.value);
                  if (paymentMode === 'credit') {
                    setPaymentDueDate(addDaysISO(e.target.value, 30));
                  }
                }}
                className={`h-10 w-full rounded-xl border px-3 text-sm font-currency font-bold outline-none transition-all ${
                  isSavedMode
                    ? 'border-slate-200 bg-slate-100/90 text-slate-800 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 cursor-default'
                    : 'border-slate-200 bg-slate-50/80 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark] dark:focus:bg-slate-900'
                }`}
                dir="ltr"
                lang="en"
              />
            </div>

            {/* Payment Mode (Cash / Credit) */}
            <div className="w-32 sm:w-36">
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
                طريقة الدفع
              </label>
              <select
                value={paymentMode}
                disabled={isSavedMode}
                onChange={(e) => {
                  if (isSavedMode) return;
                  const m = e.target.value;
                  setPaymentMode(m);
                  if (m === 'credit' && !paymentDueDate) {
                    setPaymentDueDate(addDaysISO(invoiceDate, 30));
                  }
                }}
                className={`h-10 w-full rounded-xl border px-3 text-sm font-bold outline-none transition-all ${
                  isSavedMode
                    ? 'border-slate-200 bg-slate-100/90 text-slate-800 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 cursor-default'
                    : paymentMode === 'credit'
                    ? 'border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-700 cursor-pointer'
                    : 'border-slate-200 bg-slate-50/80 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 cursor-pointer'
                }`}
              >
                <option value="cash">نقداً (كاش)</option>
                <option value="credit">آجل (ذمة)</option>
              </select>
            </div>

            {/* Due Date (only if Credit) */}
            {paymentMode === 'credit' && (
              <div className="w-36 sm:w-44 animate-fadeIn">
                <label className="block text-xs font-bold text-amber-800 dark:text-amber-300 mb-1">
                  استحقاق السداد <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  value={paymentDueDate}
                  readOnly={isSavedMode}
                  disabled={isSavedMode}
                  onChange={(e) => !isSavedMode && setPaymentDueDate(e.target.value)}
                  className={`h-10 w-full rounded-xl border px-3 text-sm font-currency font-bold outline-none transition-all ${
                    isSavedMode
                      ? 'border-amber-200 bg-amber-50/60 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100 cursor-default'
                      : 'border-amber-300 bg-amber-50/50 text-amber-950 focus:bg-white focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 dark:[color-scheme:dark]'
                  }`}
                  dir="ltr"
                  lang="en"
                />
              </div>
            )}

            {/* حساب المشتريات (شجرة الحسابات) */}
            <div className="w-48 sm:w-56">
              <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1 flex items-center gap-1">
                <Building2 size={13} className="text-violet-500" />
                <span>حساب المشتريات</span>
              </label>
              <select
                value={purchaseAccountId}
                disabled={isSavedMode}
                onChange={(e) => !isSavedMode && setPurchaseAccountId(e.target.value)}
                className={`h-10 w-full rounded-xl border px-2.5 text-xs font-bold outline-none transition-all ${
                  isSavedMode
                    ? 'border-slate-200 bg-slate-100/90 text-slate-800 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 cursor-default'
                    : 'border-slate-200 bg-slate-50/80 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 cursor-pointer'
                }`}
                title="تحديد حساب الأستاذ / المشتريات المرتبط"
              >
                {accountsList.map((acc) => (
                  <option key={acc.id || acc.code} value={acc.code || acc.id}>
                    {acc.code} - {acc.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* 2. DENSE ACCOUNTING TABLE */}
        {/* ------------------------------------------------------------- */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden dark:border-slate-800 dark:bg-slate-900">
          {/* Table Action Bar */}
          <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/60 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-slate-800 dark:text-slate-200">بنود الفاتورة</span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold">
                ({validItemsCount} صنف مدخل)
              </span>
            </div>

            {!isSavedMode ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setProductSearchOpen(true);
                    setProductSearchQuery('');
                    setProductSearchResults([]);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-black text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800/60 dark:bg-indigo-950/40 dark:text-indigo-300 shadow-xs transition-colors cursor-pointer"
                  title="بحث عن منتج في المخزن"
                >
                  <Search size={15} />
                  بحث صنف
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setNpEngName('');
                    setNpRef('');
                    setNpBarcode('');
                    setNpUnitPrice('');
                    setNpDiscount('0');
                    setNpQty('1');
                    setNewProductOpen(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                  title="إضافة صنف جديد للمخزن والفاتورة"
                >
                  <PackagePlus size={14} />
                  منتج جديد
                </button>

                <button
                  type="button"
                  onClick={addRow}
                  className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1 text-xs font-black text-white hover:bg-violet-700 shadow-xs dark:bg-violet-500 dark:hover:bg-violet-600"
                >
                  <Plus size={14} />
                  سطر جديد
                </button>
              </div>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 font-bold text-xs">
                <Check size={14} className="stroke-[3]" />
                <span>وضع العرض فقط (محفوظة)</span>
              </span>
            )}
          </div>

          {/* Dense Table View */}
          <div className="overflow-x-auto" ref={tableDropdownRef}>
            <table className="w-full text-xs min-w-[1000px] border-collapse text-right">
              <thead>
                <tr className="bg-indigo-600 text-white border-b border-indigo-700 text-xs font-black select-none shadow-xs">
                  <th className="py-2.5 px-2 font-black w-10 text-center text-white">#</th>
                  <th className="py-2.5 px-2 font-black min-w-[130px] text-white" dir="ltr">
                    الباركود
                  </th>
                  <th className="py-2.5 px-2 font-black min-w-[180px] text-white">
                    اسم الصنف
                  </th>
                  <th className="py-2.5 px-2 font-black w-24 text-center text-white">
                    المخزن
                  </th>
                  <th className="py-2.5 px-2 font-black w-24 text-center text-white">
                    التشغيلة
                  </th>
                  <th className="py-2.5 px-2 font-black w-24 text-center text-white">
                    الوحدة
                  </th>
                  <th className="py-2.5 px-2 font-black w-20 text-center text-white" dir="ltr">
                    الكمية
                  </th>
                  <th className="py-2.5 px-2 font-black w-24 text-center text-white" dir="ltr">
                    سعر الشراء
                  </th>
                  <th className="py-2.5 px-2 font-black w-16 text-center text-white" dir="ltr">
                    خصم %
                  </th>
                  <th className="py-2.5 px-2 font-black w-24 text-center text-white" dir="ltr">
                    الإجمالي
                  </th>
                  <th className="py-2.5 px-2 font-black w-20 text-center text-white">
                    إجراءات
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {lines.map((row, idx) => {
                  const pl = linePayloads[idx];
                  const landedU = Number(pl?.landed_unit_extra || 0);
                  const lt = computeLineTotal(row.unit_price, row.discount_percent, row.qty);
                  const cost = effectiveUnitCostFromRow(row);
                  const costLanded = Math.round((cost + landedU) * 10000) / 10000;
                  const sell = row.sellPrice != null ? Number(row.sellPrice) : null;
                  const profit = sell != null && costLanded >= 0 ? Math.round((sell - costLanded) * 100) / 100 : null;
                  const marginPct =
                    profit != null && costLanded > 0 ? Math.round((profit / costLanded) * 10000) / 100 : null;
                  const suggestedSell = suggestedSellAtMargin(costLanded);
                  const storeDiff =
                    row.productId &&
                    row.stockFullPrice != null &&
                    Math.abs(Number(row.stockFullPrice) - costLanded) >= 0.01;

                  const electrical = isElectricalProduct({
                    brandGroup: row.brandGroup,
                    productName: row.productName,
                  });

                  const sug = suggestionsByRow[row.key] || [];
                  const showDrop = dropdownRowKey === row.key && sug.length > 0;
                  const serialsParsed = parseSerialList(row.serialInput);
                  const qtyInt = stockQtyFromLine(row);
                  const serialMismatch = serialsParsed.length > 0 && qtyInt > 0 && serialsParsed.length !== qtyInt;

                  return (
                    <Fragment key={row.key}>
                      <tr className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors group">
                        {/* 1. Row index */}
                        <td className="py-1.5 px-2 text-center text-slate-400 font-bold font-currency" lang="en">
                          {idx + 1}
                        </td>

                        {/* 2. Barcode */}
                        <td className="py-1.5 px-1.5 relative">
                          <input
                            value={row.barcode}
                            readOnly={isSavedMode}
                            disabled={isSavedMode}
                            onChange={(e) => {
                              if (isSavedMode) return;
                              const v = normalizeDigitsToLatin(e.target.value);
                              updateLine(row.key, 'barcode', v);
                              setDropdownRowKey(row.key);
                              setDropdownField('barcode');
                              scheduleSearch(row.key, v);
                            }}
                            onKeyDown={(e) => !isSavedMode && handleBarcodeKeyDown(e, row)}
                            onFocus={() => {
                              if (isSavedMode) return;
                              setDropdownRowKey(row.key);
                              setDropdownField('barcode');
                              if ((row.barcode || '').trim().length >= 2) {
                                fetchProductSuggestions(row.key, row.barcode);
                              }
                            }}
                            className={`h-8 w-full rounded-md border px-2 text-xs font-currency font-bold outline-none transition-all ${
                              isSavedMode
                                ? 'border-transparent bg-slate-50 dark:bg-slate-800/60 text-slate-800 dark:text-slate-200 cursor-default'
                                : 'border-slate-200 bg-white text-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                            }`}
                            dir="ltr"
                            lang="en"
                            placeholder={isSavedMode ? '—' : 'امسح أو اكتب…'}
                          />

                          {searchLoadingKey === row.key && dropdownField === 'barcode' && (
                            <Loader2 className="absolute left-3 top-3 w-3.5 h-3.5 animate-spin text-indigo-600" />
                          )}

                          {/* Suggestions popup (under barcode) */}
                          {!isSavedMode && showDrop && dropdownField === 'barcode' && (
                            <ul className="absolute z-50 right-0 left-0 mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800 text-[11px]">
                              {sug.map((p) => (
                                <li key={p.unitData ? `u-${p.unitData.id}` : p.id}>
                                  <button
                                    type="button"
                                    className="w-full text-right px-2.5 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 border-b border-slate-50 dark:border-slate-700/50 last:border-0"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      pickProduct(row.key, p);
                                    }}
                                  >
                                    <span className="font-bold text-slate-800 dark:text-slate-100 block truncate">
                                      {p.eng_name || '—'} {p.unitData ? `(${p.unitData.unit_name})` : ''}
                                    </span>
                                    <span className="font-currency text-slate-500 dark:text-slate-400" dir="ltr" lang="en">
                                      {p.unitData?.barcode || p.barcode} · مرجع {p.reference || '—'}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>

                        {/* 3. Product Name (Manual Line Edit) */}
                        <td className="py-1.5 px-1.5">
                          <input
                            value={row.productName}
                            readOnly={isSavedMode}
                            disabled={isSavedMode}
                            onChange={(e) => {
                              if (!isSavedMode) updateLine(row.key, 'productName', e.target.value);
                            }}
                            className={`h-8 w-full rounded-md border px-2 text-xs font-bold outline-none transition-all ${
                              isSavedMode
                                ? 'border-transparent bg-slate-50 dark:bg-slate-800/60 text-slate-800 dark:text-slate-100 cursor-default'
                                : 'border-slate-200 bg-white text-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                            }`}
                            placeholder={isSavedMode ? '—' : 'اسم الصنف أو الوصف…'}
                          />
                        </td>

                        {/* 4. Warehouse */}
                        <td className="py-1.5 px-1 text-center">
                          <select
                            value={row.warehouse || 'الرئيسي'}
                            disabled={isSavedMode}
                            onChange={(e) => !isSavedMode && updateLine(row.key, 'warehouse', e.target.value)}
                            className={`h-8 w-full rounded-md border px-1 text-center text-xs font-bold outline-none transition-all ${
                              isSavedMode
                                ? 'border-transparent bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 cursor-default'
                                : 'border-slate-200 bg-white text-slate-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer'
                            }`}
                            title="تحديد مخزن استلام الصنف"
                          >
                            {warehouseOptions.map((wh) => (
                              <option key={wh.id || wh.name} value={wh.name}>
                                {wh.name}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* 5. Batch / Lot Number */}
                        <td className="py-1.5 px-1 text-center">
                          <input
                            value={row.batchNumber || ''}
                            readOnly={isSavedMode}
                            disabled={isSavedMode}
                            onChange={(e) => !isSavedMode && updateLine(row.key, 'batchNumber', e.target.value)}
                            className={`h-8 w-full rounded-md border px-1 text-center text-xs font-currency font-bold outline-none transition-all ${
                              isSavedMode
                                ? 'border-transparent bg-slate-50 dark:bg-slate-800/60 text-slate-800 dark:text-slate-100 cursor-default'
                                : 'border-slate-200 bg-white text-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 placeholder:text-slate-400 placeholder:font-normal'
                            }`}
                            dir="ltr"
                            lang="en"
                            placeholder={isSavedMode ? '—' : 'اختياري'}
                            title="رقم التشغيلة / الدفعة (Batch Number)"
                          />
                        </td>

                        {/* 6. Unit */}
                        <td className="py-1.5 px-1 text-center">
                          {(() => {
                            const regUnits = (row.productId && productUnitsMap[row.productId]) || [];
                            if (regUnits.length > 0) {
                              const unitOptions = [...regUnits];
                              if (row.unit && !unitOptions.some((u) => u.unit_name === row.unit)) {
                                unitOptions.unshift({
                                  id: 'current',
                                  unit_name: row.unit,
                                  conversion_factor: row.conversionFactor || 1,
                                });
                              }
                              return (
                                <select
                                  value={row.unit}
                                  disabled={isSavedMode}
                                  onChange={(e) => !isSavedMode && handleUnitChange(row.key, e.target.value)}
                                  className={`h-8 w-full rounded-md border px-1 text-center text-xs font-bold outline-none transition-all ${
                                    isSavedMode
                                      ? 'border-transparent bg-indigo-50/40 text-indigo-900 dark:bg-indigo-950/20 dark:text-indigo-200 cursor-default'
                                      : 'border-indigo-200 bg-indigo-50/70 text-indigo-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200 cursor-pointer'
                                  }`}
                                  title="اختر وحدة الشراء"
                                >
                                  {unitOptions.map((u) => (
                                    <option key={u.id || u.unit_name} value={u.unit_name}>
                                      {u.unit_name} {Number(u.conversion_factor) > 1 ? `(×${u.conversion_factor})` : ''}
                                    </option>
                                  ))}
                                </select>
                              );
                            }
                            return (
                              <>
                                <input
                                  list={`units-${row.key}`}
                                  value={row.unit}
                                  readOnly={isSavedMode}
                                  disabled={isSavedMode}
                                  onChange={(e) => !isSavedMode && updateLine(row.key, 'unit', e.target.value)}
                                  className={`h-8 w-full rounded-md border px-1 text-center text-xs font-bold outline-none transition-all ${
                                    isSavedMode
                                      ? 'border-transparent bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 cursor-default'
                                      : 'border-slate-200 bg-white text-slate-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                                  }`}
                                />
                                <datalist id={`units-${row.key}`}>
                                  {UNIT_OPTIONS.map((u) => (
                                    <option key={u} value={u} />
                                  ))}
                                </datalist>
                              </>
                            );
                          })()}
                        </td>

                        {/* 7. Qty */}
                        <td className="py-1.5 px-1.5 text-center">
                          <input
                            value={row.qty}
                            readOnly={isSavedMode}
                            disabled={isSavedMode}
                            onChange={(e) => !isSavedMode && updateLine(row.key, 'qty', normalizeDigitsToLatin(e.target.value))}
                            className={`h-8 w-full rounded-md border px-2 text-center text-xs font-currency font-black outline-none transition-all ${
                              isSavedMode
                                ? 'border-transparent bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-slate-100 cursor-default'
                                : getFieldStatusClass(row.qty, 'qty')
                            }`}
                            dir="ltr"
                            lang="en"
                            inputMode="decimal"
                          />
                        </td>

                        {/* 8. Unit Purchase Price */}
                        <td className="py-1.5 px-1.5 text-center">
                          <input
                            value={row.unit_price}
                            readOnly={isSavedMode}
                            disabled={isSavedMode}
                            onChange={(e) =>
                              !isSavedMode && updateLine(row.key, 'unit_price', normalizeDigitsToLatin(e.target.value))
                            }
                            className={`h-8 w-full rounded-md border px-2 text-center text-xs font-currency font-black outline-none transition-all ${
                              isSavedMode
                                ? 'border-transparent bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-slate-100 cursor-default'
                                : getFieldStatusClass(row.unit_price, 'price')
                            }`}
                            dir="ltr"
                            lang="en"
                            inputMode="decimal"
                            placeholder="0.00"
                          />
                        </td>

                        {/* 9. Discount % */}
                        <td className="py-1.5 px-1.5 text-center">
                          <input
                            value={row.discount_percent}
                            readOnly={isSavedMode}
                            disabled={isSavedMode}
                            onChange={(e) =>
                              !isSavedMode && updateLine(row.key, 'discount_percent', normalizeDigitsToLatin(e.target.value))
                            }
                            className={`h-8 w-full rounded-md border px-1 text-center text-xs font-currency font-bold outline-none transition-all ${
                              isSavedMode
                                ? 'border-transparent bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-slate-100 cursor-default'
                                : getFieldStatusClass(row.discount_percent, 'discount')
                            }`}
                            dir="ltr"
                            lang="en"
                            inputMode="decimal"
                          />
                        </td>

                        {/* 8. Line Total */}
                        <td className="py-1.5 px-2 text-center font-currency font-black text-slate-900 dark:text-slate-100 whitespace-nowrap" dir="ltr" lang="en">
                          ₪ {lt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>

                        {/* 9. Actions: Details, Duplicate, Delete */}
                        <td className="py-1.5 px-1 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {/* Details Toggle Button */}
                            <button
                              type="button"
                              onClick={() => toggleRowDetails(row.key)}
                              className={`p-1.5 rounded-md transition-colors ${
                                row.showDetails
                                  ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300'
                                  : 'text-slate-400 hover:text-violet-600 hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                              title={row.showDetails ? 'إخفاء تفاصيل السطر' : 'عرض تفاصيل السطر والربح'}
                            >
                              <Info size={15} />
                            </button>

                            {!isSavedMode && (
                              <>
                                {/* Duplicate */}
                                <button
                                  type="button"
                                  onClick={() => duplicateRow(row.key)}
                                  className="p-1.5 rounded-md text-slate-400 hover:text-violet-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                  title="تكرار السطر"
                                >
                                  <Copy size={14} />
                                </button>

                                {/* Delete */}
                                <button
                                  type="button"
                                  onClick={() => removeRow(row.key)}
                                  className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                                  title="حذف السطر"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Optional Expandable Sub-Row (Shown only when Details button is toggled) */}
                      {row.showDetails && (
                        <tr className="bg-slate-50/70 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700/60">
                          <td className="py-2 px-2" />
                          <td colSpan={10} className="py-2.5 px-3">
                            <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
                              {/* Margin & Sell Price Info */}
                              {row.productId && sell != null && cost >= 0 ? (
                                <div className="flex flex-wrap items-center gap-3">
                                  <span className="inline-flex items-center gap-1 font-bold text-emerald-700 dark:text-emerald-300">
                                    <TrendingUp size={13} />
                                    <span>تكلفة واصلة:</span>
                                    <span className="font-currency" dir="ltr" lang="en">
                                      ₪ {costLanded.toFixed(2)}
                                    </span>
                                  </span>

                                  <span className="text-slate-600 dark:text-slate-400">
                                    بيع حالي:{' '}
                                    <strong className="font-currency text-slate-800 dark:text-slate-200" dir="ltr" lang="en">
                                      ₪ {sell.toFixed(2)}
                                    </strong>
                                  </span>

                                  {profit != null && (
                                    <span className="text-slate-700 dark:text-slate-300">
                                      ربح متوقع:{' '}
                                      <strong className="font-currency text-emerald-600 dark:text-emerald-400" dir="ltr" lang="en">
                                        ₪ {profit.toFixed(2)}
                                      </strong>
                                      {marginPct != null && (
                                        <span className="text-[11px] text-slate-500 font-bold"> ({marginPct}%)</span>
                                      )}
                                    </span>
                                  )}

                                  {suggestedSell != null && (
                                    <span className="text-indigo-700 dark:text-indigo-300 font-bold">
                                      بيع مقترح (+20%):{' '}
                                      <span className="font-currency" dir="ltr" lang="en">
                                        ₪ {suggestedSell.toFixed(2)}
                                      </span>
                                    </span>
                                  )}

                                  {storeDiff && (
                                    <span className="text-amber-700 dark:text-amber-400 text-[11px] font-bold">
                                      (تختلف عن تكلفة المخزن: ₪{Number(row.stockFullPrice).toFixed(2)})
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400 text-[11px]">
                                  اربط الصنف بمنتج من المخزن لعرض معلومات الربح والبيع المقترح.
                                </span>
                              )}

                              {/* Expiry Date & Serials */}
                              <div className="flex flex-wrap items-center gap-3 ms-auto">
                                <div className="flex items-center gap-1.5">
                                  <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                    صلاحية:
                                  </label>
                                  <input
                                    type="date"
                                    value={row.expiryDate}
                                    readOnly={isSavedMode}
                                    disabled={isSavedMode}
                                    onChange={(e) => !isSavedMode && updateLine(row.key, 'expiryDate', e.target.value)}
                                    className="h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 text-[11px] font-currency dark:text-slate-100"
                                    dir="ltr"
                                    lang="en"
                                  />
                                </div>

                                {electrical && (
                                  <div className="flex items-center gap-1.5">
                                    <label className="text-[11px] font-bold text-amber-700 dark:text-amber-300">
                                      سيريال / IMEI:
                                    </label>
                                    <input
                                      type="text"
                                      value={row.serialInput}
                                      readOnly={isSavedMode}
                                      disabled={isSavedMode}
                                      onChange={(e) => !isSavedMode && updateLine(row.key, 'serialInput', e.target.value)}
                                      placeholder="افصل بينها بفاصلة أو سطر"
                                      className="h-7 w-48 rounded-md border border-amber-300 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-950/40 px-2 text-[11px] font-currency dark:text-amber-100"
                                      dir="ltr"
                                      lang="en"
                                    />
                                    {serialMismatch && (
                                      <span className="text-[10px] text-amber-800 dark:text-amber-300 font-bold">
                                        ({serialsParsed.length}/{qtyInt})
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Pre-order warning */}
                            {row.productId && (reservationsByProduct.get(row.productId) || []).length > 0 && (
                              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 dark:bg-amber-950/40 dark:border-amber-800/60 px-2.5 py-1.5 text-[11px] text-amber-950 dark:text-amber-100 flex items-center justify-between">
                                <div>
                                  <span className="font-black">يوجد حجز مسبق لهذا الصنف: </span>
                                  {(reservationsByProduct.get(row.productId) || []).map((r) => (
                                    <span key={r.lineId} className="inline-block ms-2">
                                      {r.customerName} (حجز #{r.orderNo}، كمية {r.qty})
                                    </span>
                                  ))}
                                </div>
                                <Link
                                  to="/sales/preorders"
                                  className="font-bold text-violet-700 dark:text-violet-300 hover:underline"
                                >
                                  صفحة الحجوزات ←
                                </Link>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-indigo-50/90 dark:bg-indigo-950/50 border-t-2 border-indigo-300 dark:border-indigo-800 text-xs font-bold text-indigo-950 dark:text-indigo-100 select-none">
                  <td colSpan={6} className="py-2.5 px-3 text-right">
                    <span className="font-black text-indigo-900 dark:text-indigo-200">
                      مجموع بنود الجدول ({validItemsCount} صنف مدخل)
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-center font-black font-currency text-indigo-950 dark:text-white" dir="ltr" lang="en">
                    {totalUnitsCount}
                  </td>
                  <td className="py-2.5 px-2 text-center font-currency text-slate-400">
                    —
                  </td>
                  <td className="py-2.5 px-2 text-center font-bold font-currency text-rose-600 dark:text-rose-400" dir="ltr" lang="en">
                    {totalDiscountAmount > 0 ? `-₪${totalDiscountAmount.toFixed(2)}` : '—'}
                  </td>
                  <td className="py-2.5 px-2 text-center font-black font-currency text-indigo-950 dark:text-indigo-100 whitespace-nowrap text-sm" dir="ltr" lang="en">
                    ₪ {subtotalAfterDiscount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-2.5 px-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* 3. TAX, EXPENSES & EXPANDED NOTES SECTION */}
        {/* ------------------------------------------------------------- */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
          {/* Card: الضريبة والمصاريف الواصلة */}
          <div className="lg:col-span-6 rounded-xl border border-violet-200/90 dark:border-violet-800/60 bg-white p-4 shadow-xs dark:bg-slate-900 space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                  <Percent size={15} />
                </div>
                <span className="text-xs font-black text-slate-900 dark:text-white">
                  الضريبة والمصاريف الواصلة
                </span>
              </div>
              <span className="text-[11px] text-slate-400 font-bold">حسابات منفصلة عن خصم الأصناف</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* حقل نسبة الضريبة % */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  نسبة الضريبة %
                </label>
                <div className="relative flex items-center">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={taxRate}
                    readOnly={isSavedMode}
                    disabled={isSavedMode}
                    onChange={(e) => !isSavedMode && setTaxRate(normalizeDigitsToLatin(e.target.value))}
                    className={`h-9 w-full rounded-xl border px-3 text-xs font-currency font-black outline-none transition-all ${
                      isSavedMode
                        ? 'border-slate-200 bg-slate-100/90 text-slate-800 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 cursor-default'
                        : 'border-slate-200 bg-slate-50/80 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white'
                    }`}
                    dir="ltr"
                    lang="en"
                    placeholder="0"
                  />
                  {!isSavedMode && (
                    <div className="absolute left-1.5 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setTaxRate('0')}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                          taxRate === '0'
                            ? 'bg-violet-600 text-white'
                            : 'bg-slate-200/70 text-slate-600 hover:bg-slate-300/70 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                      >
                        0%
                      </button>
                      <button
                        type="button"
                        onClick={() => setTaxRate('16')}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                          taxRate === '16'
                            ? 'bg-violet-600 text-white'
                            : 'bg-slate-200/70 text-slate-600 hover:bg-slate-300/70 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                      >
                        16%
                      </button>
                      <button
                        type="button"
                        onClick={() => setTaxRate('17')}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                          taxRate === '17'
                            ? 'bg-violet-600 text-white'
                            : 'bg-slate-200/70 text-slate-600 hover:bg-slate-300/70 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                      >
                        17%
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* مصاريف إضافية واصلة */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  مصاريف واصلة (شحن/جمارك) ₪
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={landedCostExtra}
                  readOnly={isSavedMode}
                  disabled={isSavedMode}
                  onChange={(e) => !isSavedMode && setLandedCostExtra(normalizeDigitsToLatin(e.target.value))}
                  className={`h-9 w-full rounded-xl border px-3 text-xs font-currency font-black outline-none transition-all ${
                    isSavedMode
                      ? 'border-slate-200 bg-slate-100/90 text-slate-800 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 cursor-default'
                      : 'border-slate-200 bg-slate-50/80 text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white'
                  }`}
                  dir="ltr"
                  lang="en"
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* خيار شامل الضريبة */}
            <div className="pt-1 flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-800 dark:text-slate-200 select-none">
                <input
                  type="checkbox"
                  checked={isTaxInclusive}
                  disabled={isSavedMode}
                  onChange={(e) => !isSavedMode && setIsTaxInclusive(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500 cursor-pointer disabled:cursor-default"
                />
                <span>الأسعار المدخلة بالجدول <strong>شاملة الضريبة</strong></span>
              </label>
              <span className="text-[11px] text-slate-400">
                {isTaxInclusive ? '(الضريبة مستخرجة من المجموع)' : '(الضريبة تُضاف فوق المجموع)'}
              </span>
            </div>
          </div>

          {/* Card: ملاحظات الفاتورة موسعة + WAC + المرفقات السريعة */}
          <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between space-y-2">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
              <span className="text-xs font-black text-slate-900 dark:text-white">
                ملاحظات الفاتورة (موسعة)
              </span>
              <button
                type="button"
                onClick={() => setAttachmentsModalOpen(true)}
                className="text-[11px] font-bold text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1"
              >
                <Paperclip size={12} />
                <span>{invoiceScanFile || loadedScanPath ? 'معاينة المرفق 📎' : 'إرفاق مستند/صورة'}</span>
              </button>
            </div>

            <textarea
              value={extraNotes}
              readOnly={isSavedMode}
              disabled={isSavedMode}
              onChange={(e) => !isSavedMode && setExtraNotes(e.target.value)}
              rows={3}
              className={`w-full rounded-xl border px-3 py-2 text-xs outline-none resize-none transition-all flex-1 ${
                isSavedMode
                  ? 'border-slate-200 bg-slate-100/90 text-slate-800 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 cursor-default'
                  : 'border-slate-200 bg-slate-50/80 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900'
              }`}
              placeholder="أدخل أي ملاحظات تفصيلية تخص الشحنة، الاتفاق مع المورد، رقم بوليصة الشحن، أو شروط الاسترجاع والدفع…"
            />

            <div className="pt-1 flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer text-[11px] font-bold text-slate-600 dark:text-slate-300 select-none">
                <input
                  type="checkbox"
                  checked={updateCatalogCosts}
                  disabled={isSavedMode}
                  onChange={(e) => !isSavedMode && setUpdateCatalogCosts(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-violet-600 focus:ring-violet-500 cursor-pointer disabled:cursor-default"
                />
                <span>تطبيق <strong>متوسط التكلفة المرجح (WAC)</strong> على تكلفة الكتالوج عند الاستلام</span>
              </label>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* 4. DENSE BOTTOM TOTALS & POSTING BAR */}
        {/* ------------------------------------------------------------- */}
        <div className="rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/95 dark:bg-slate-900/90 backdrop-blur-xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4 transition-colors">
          {/* Left: Financial Summary Breakdown */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-3.5 text-xs">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 px-3 py-1.5 shadow-xs">
              <span className="text-[11px] text-slate-400 block font-bold">الأصناف والكمية</span>
              <span className="font-black text-slate-800 dark:text-slate-100">
                {validItemsCount} صنف ({totalUnitsCount} وحدة)
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 px-3 py-1.5 shadow-xs">
              <span className="text-[11px] text-slate-400 block font-bold">مجموع البضاعة</span>
              <span className="font-currency font-black text-slate-800 dark:text-slate-100" dir="ltr" lang="en">
                ₪ {subtotalBeforeDiscount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            {totalDiscountAmount > 0 && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700/80 bg-amber-50/80 dark:bg-amber-950/40 px-3 py-1.5 shadow-xs">
                <span className="text-[11px] text-amber-800 dark:text-amber-300 block font-bold">الخصم الإجمالي</span>
                <span className="font-currency font-black text-rose-600 dark:text-rose-400" dir="ltr" lang="en">
                  - ₪ {totalDiscountAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 px-3 py-1.5 shadow-xs">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-bold">
                قبل الضريبة
              </span>
              <span className="font-currency font-black text-slate-800 dark:text-slate-200" dir="ltr" lang="en">
                ₪ {subtotalBeforeTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            {taxRateNum > 0 && (
              <div className="rounded-xl border border-violet-300 dark:border-violet-700/80 bg-violet-50/80 dark:bg-violet-950/40 px-3 py-1.5 shadow-xs">
                <span className="text-[11px] text-violet-800 dark:text-violet-300 block font-bold">
                  الضريبة ({taxRateNum}%)
                </span>
                <span className="font-currency font-black text-violet-900 dark:text-violet-200" dir="ltr" lang="en">
                  {isTaxInclusive ? '(مشمولة)' : '+'} ₪ {taxAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 px-3 py-1.5 shadow-xs">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-bold">
                بعد الضريبة
              </span>
              <span className="font-currency font-black text-slate-900 dark:text-white" dir="ltr" lang="en">
                ₪ {totalAfterTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            {landingTotal > 0 && (
              <div className="rounded-xl border border-indigo-200 dark:border-indigo-800/80 bg-indigo-50/70 dark:bg-indigo-950/40 px-3 py-1.5 shadow-xs">
                <span className="text-[11px] text-indigo-800 dark:text-indigo-300 block font-bold">مصاريف واصلة</span>
                <span className="font-currency font-black text-indigo-700 dark:text-indigo-300" dir="ltr" lang="en">
                  + ₪ {landingTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            )}

            <div className="rounded-2xl border-2 border-emerald-400 dark:border-emerald-500/80 bg-emerald-50/90 dark:bg-emerald-950/50 px-4 py-2 shadow-md shadow-emerald-500/10">
              <span className="text-[11px] text-emerald-800 dark:text-emerald-300 block font-black">
                الصافي النهائي
              </span>
              <span className="text-2xl font-black text-emerald-950 dark:text-emerald-100 font-currency" dir="ltr" lang="en">
                ₪ {grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Right: Status Selector & Save Button OR Saved Mode Controls */}
          <div className="flex flex-wrap items-center gap-3">
            {isSavedMode ? (
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  <Check size={16} className="stroke-[3]" />
                  <span>{purchaseStatus === 'received' ? 'محفوظة ومرحّلة للمخزن' : 'محفوظة كمسودة'}</span>
                </span>

                <button
                  type="button"
                  onClick={() => setIsSavedMode(false)}
                  className="h-11 inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-bold px-4 text-xs shadow-xs transition-all active:scale-95 cursor-pointer"
                  title="تعديل الفاتورة وفك قفل الحقول"
                >
                  <Pencil size={15} />
                  <span>تعديل الفاتورة</span>
                </button>

                <button
                  type="button"
                  onClick={handlePrintCurrentInvoice}
                  className="h-11 inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-bold px-4 text-xs shadow-xs transition-all active:scale-95 cursor-pointer"
                  title="طباعة الفاتورة"
                >
                  <Printer size={15} />
                  <span>طباعة</span>
                </button>

                <button
                  type="button"
                  onClick={handleNewInvoice}
                  className="h-11 inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-black px-5 text-xs shadow-md transition-all hover:scale-105 active:scale-95 cursor-pointer"
                  title="فتح فاتورة شراء جديدة فارغة"
                >
                  <Plus size={16} />
                  <span>فاتورة جديدة</span>
                </button>
              </div>
            ) : (
              <>
                <select
                  value={purchaseStatus}
                  onChange={(e) => setPurchaseStatus(e.target.value)}
                  className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 outline-none cursor-pointer shadow-xs"
                >
                  <option value="received">تم الاستلام (تحديث المخزون فوراً)</option>
                  <option value="draft">مسودة (حفظ دون تحديث المخزون)</option>
                </select>

                <button
                  type="button"
                  onClick={handleSavePurchase}
                  disabled={saving || grandTotal <= 0}
                  className="h-11 inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-black px-7 text-xs shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95"
                >
                  {saving ? <Loader2 className="animate-spin" size={17} /> : <Save size={17} />}
                  <span>{purchaseStatus === 'draft' ? 'حفظ كمسودة' : 'حفظ واستلام للمخزن'}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* MODALS: Product Search & New Product */}
        {/* ------------------------------------------------------------- */}

        {/* Modal: Fast Product Search */}
        {productSearchOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[6vh] sm:pt-[8vh] bg-black/60 backdrop-blur-sm animate-fadeIn"
            role="dialog"
            aria-modal="true"
            onClick={() => {
              setProductSearchOpen(false);
              setProductSearchResults([]);
              setProductSearchQuery('');
            }}
          >
            <div
              className="w-full max-w-2xl sm:max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden dark:border-slate-800 dark:bg-slate-900 flex flex-col max-h-[84vh]"
              dir="rtl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Top Header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/80">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                    <Search size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900 dark:text-white">
                      بحث عن صنف في المخزن
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      ابحث بالاسم أو الباركود أو الموديل — اختر الصنف لإدراجه فوراً بالفاتورة
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setProductSearchOpen(false);
                    setProductSearchResults([]);
                    setProductSearchQuery('');
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Big Search Input */}
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="relative flex items-center">
                  <Search size={20} className="absolute right-3.5 text-indigo-500 pointer-events-none" />
                  <input
                    ref={productSearchInputRef}
                    type="text"
                    value={productSearchQuery}
                    onChange={(e) => handleModalSearchChange(e.target.value)}
                    onKeyDown={handleModalSearchKeyDown}
                    placeholder="امسح الباركود بالسكانر أو اكتب اسم المنتج أو المرجع…"
                    className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50/80 pr-11 pl-20 text-base font-bold text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-100 dark:focus:bg-slate-800 dark:placeholder:text-slate-500 transition-all"
                    autoComplete="off"
                    autoFocus
                  />
                  <div className="absolute left-3 flex items-center gap-1.5">
                    {productSearchLoading && (
                      <Loader2 size={18} className="animate-spin text-indigo-500" />
                    )}
                    {productSearchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setProductSearchQuery('');
                          setProductSearchResults([]);
                          productSearchInputRef.current?.focus();
                        }}
                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md"
                        title="مسح البحث"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Results List */}
              <div className="flex-1 overflow-y-auto min-h-[220px]">
                {productSearchQuery.trim().length === 0 ? (
                  <div className="py-14 text-center px-4">
                    <div className="mx-auto w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-500 flex items-center justify-center mb-3">
                      <Search size={22} />
                    </div>
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                      ابدأ بكتابة اسم المنتج أو مسح الباركود
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                      ستظهر النتائج فورياً أثناء الكتابة
                    </p>
                  </div>
                ) : productSearchResults.length === 0 && !productSearchLoading ? (
                  <div className="py-12 text-center px-6">
                    <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-3 border border-amber-200/60 dark:border-amber-800/40">
                      <AlertTriangle size={24} />
                    </div>
                    <h4 className="text-base font-black text-slate-800 dark:text-slate-100">
                      لا توجد نتائج مطابقة
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-5 max-w-md mx-auto">
                      لم نجد أي صنف يطابق «<span className="font-bold text-slate-700 dark:text-slate-200">{productSearchQuery}</span>» في المخزون الحالي.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const query = productSearchQuery.trim();
                        setProductSearchOpen(false);
                        setProductSearchResults([]);
                        setProductSearchQuery('');
                        const isLikelyBarcode = /^[0-9]+$/.test(query) && query.length >= 4;
                        setNpEngName(isLikelyBarcode ? '' : query);
                        setNpBarcode(isLikelyBarcode ? query : '');
                        setNpRef('');
                        setNpUnitPrice('');
                        setNpDiscount('0');
                        setNpQty('1');
                        setNewProductOpen(true);
                      }}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 text-xs font-black shadow-md hover:shadow-lg transition-all cursor-pointer"
                    >
                      <PackagePlus size={17} />
                      إضافة «{productSearchQuery}» كصنف جديد للمخزن
                    </button>
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {productSearchResults.map((p) => {
                      const u = p.unitData;
                      const factor = u ? Number(u.conversion_factor) || 1 : 1;
                      const unitCost =
                        u && Number(u.cost_price) > 0
                          ? Number(u.cost_price)
                          : p.purchase_price != null && Number(p.purchase_price) > 0
                            ? Number(p.purchase_price) * factor
                            : p.full_price != null && Number(p.full_price) > 0
                              ? Number(p.full_price) * factor
                              : null;
                      const stock = p.stock_count != null ? Number(p.stock_count) : null;

                      return (
                        <li key={u ? `u_${u.id}` : p.id}>
                          <button
                            type="button"
                            onClick={() => addProductFromSearch(p)}
                            className="w-full text-right px-4 py-3 hover:bg-indigo-50/60 dark:hover:bg-indigo-950/30 flex items-center justify-between gap-3 transition-colors group cursor-pointer"
                          >
                            <div className="flex items-center gap-3.5 min-w-0 flex-1">
                              {/* Thumbnail */}
                              <div className="w-12 h-12 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden shrink-0">
                                <StorageObjectImage
                                  srcValue={p.image_url || p.product?.image_url}
                                  alt={p.eng_name}
                                  className="w-full h-full object-cover"
                                  iconSize={20}
                                  fallbackClassName="text-slate-400 dark:text-slate-500"
                                />
                              </div>

                              {/* Product Info */}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">
                                    {p.eng_name || '—'}
                                  </p>
                                  {u && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-300 text-xs font-black shrink-0">
                                      {u.unit_name}
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                  <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[11px]" dir="ltr">
                                    {u?.barcode || p.barcode || 'بدون باركود'}
                                  </span>
                                  {p.reference && <span>· مرجع: {p.reference}</span>}
                                  {p.brand_group && <span>· {p.brand_group}</span>}
                                </div>
                              </div>
                            </div>

                            {/* Price & Stock */}
                            <div className="text-left shrink-0 space-y-1">
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                <span className="me-1">آخر شراء:</span>
                                <span className="text-sm font-black text-indigo-600 dark:text-indigo-400 font-currency" dir="ltr">
                                  {unitCost != null ? `₪${Number(unitCost).toFixed(2)}` : '—'}
                                </span>
                              </div>
                              <div>
                                {stock != null ? (
                                  stock > 0 ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60">
                                      المخزون: {stock}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60">
                                      نافد (0)
                                    </span>
                                  )
                                ) : (
                                  <span className="text-[11px] text-slate-400">—</span>
                                )}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50/90 text-xs text-slate-500 flex items-center justify-between dark:border-slate-800 dark:bg-slate-800/80">
                <span className="font-bold">
                  اضغط على أي صنف لإضافته مباشرة لسطر الفاتورة
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  Enter / نقرة للإضافة
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Modal: New Product Quick Add */}
        {newProductOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
            role="dialog"
            aria-modal="true"
            onClick={() => {
              if (!newProductSaving) setNewProductOpen(false);
            }}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
              dir="rtl"
              onClick={(ev) => ev.stopPropagation()}
            >
              <div className="flex items-start gap-3 mb-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <PackagePlus size={22} strokeWidth={2.25} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-black text-slate-900 dark:text-white">إضافة منتج جديد للمخزن</h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    يُنشأ المنتج فوراً في الكتالوج ويُربط بهذا السطر بالفاتورة.
                  </p>
                </div>
              </div>

              <form onSubmit={handleNewProductSubmit} className="space-y-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    اسم المنتج *
                  </label>
                  <input
                    value={npEngName}
                    onChange={(e) => setNpEngName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-slate-50 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="مثال: تلفزيون سامسونج 55 بوصة"
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      المرجع / الموديل
                    </label>
                    <input
                      value={npRef}
                      onChange={(e) => setNpRef(normalizeDigitsToLatin(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-currency bg-slate-50 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 outline-none"
                      dir="ltr"
                      lang="en"
                      placeholder="REF-123"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      الباركود (فارغ = توليد)
                    </label>
                    <input
                      value={npBarcode}
                      onChange={(e) => setNpBarcode(normalizeDigitsToLatin(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-currency bg-slate-50 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 outline-none"
                      dir="ltr"
                      lang="en"
                      placeholder="تلقائي يبدأ بـ 8"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      سعر الشراء *
                    </label>
                    <input
                      value={npUnitPrice}
                      onChange={(e) => setNpUnitPrice(normalizeDigitsToLatin(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-currency bg-slate-50 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 outline-none"
                      dir="ltr"
                      lang="en"
                      inputMode="decimal"
                      placeholder="0"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      خصم %
                    </label>
                    <input
                      value={npDiscount}
                      onChange={(e) => setNpDiscount(normalizeDigitsToLatin(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-currency bg-slate-50 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 outline-none"
                      dir="ltr"
                      lang="en"
                      inputMode="decimal"
                      placeholder="0"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      الكمية
                    </label>
                    <input
                      value={npQty}
                      onChange={(e) => setNpQty(normalizeDigitsToLatin(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-currency bg-slate-50 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 outline-none"
                      dir="ltr"
                      lang="en"
                      inputMode="numeric"
                      placeholder="1"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (!newProductSaving) setNewProductOpen(false);
                    }}
                    className="flex-1 rounded-xl border border-slate-200 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    إلغاء
                  </button>

                  <button
                    type="submit"
                    disabled={newProductSaving}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-white py-2 text-xs font-black hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {newProductSaving ? <Loader2 className="animate-spin" size={16} /> : <PackagePlus size={16} />}
                    إضافة للفاتورة
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Unified Supplier Form */}
        <SupplierFormModal
          isOpen={newSupplierModalOpen}
          onClose={() => setNewSupplierModalOpen(false)}
          initialName={newSupplierInitialName}
          onSuccess={handleSupplierCreated}
        />

        {/* Modal: Purchase Attachments */}
        <PurchaseAttachmentsModal
          isOpen={attachmentsModalOpen}
          onClose={() => setAttachmentsModalOpen(false)}
          scanFile={invoiceScanFile}
          scanPath={loadedScanPath}
          previewUrl={invoicePreviewUrl}
          onFileChosen={handleAttachmentFileChosen}
          onRemove={handleAttachmentRemove}
        />

        {/* Modal: Barcode Labels Printing */}
        {barcodeModalOpen && (
          <PrintPurchaseBarcodesModal
            lines={lines.filter((x) => Number(x.qty) > 0 && (x.barcode || x.productName))}
            storeName={store?.name || 'شركة سنين'}
            onClose={() => setBarcodeModalOpen(false)}
          />
        )}
      </div>

      {printPurchaseData ? (
        <div
          id="print-invoice-mount"
          className="fixed inset-0 z-[9999] overflow-y-auto bg-white print:static print:inset-auto print:z-auto"
          aria-hidden
        >
          <PrintPurchaseInvoice data={printPurchaseData} />
        </div>
      ) : null}
    </DashboardLayout>
  );
}
