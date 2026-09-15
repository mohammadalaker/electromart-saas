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
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
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

  const grandTotal = useMemo(
    () => linePayloads.reduce((a, x) => a + x.line_total, 0),
    [linePayloads]
  );

  const subtotalBeforeDiscount = useMemo(() => {
    return lines.reduce((acc, r) => {
      const q = Math.max(0, parseFloat(String(r.qty).replace(',', '.')) || 0);
      const u = Math.max(0, parseFloat(String(r.unit_price).replace(',', '.')) || 0);
      return acc + q * u;
    }, 0);
  }, [lines]);

  const totalDiscountAmount = useMemo(() => {
    return Math.max(0, subtotalBeforeDiscount - grandTotal);
  }, [subtotalBeforeDiscount, grandTotal]);

  const totalUnitsCount = useMemo(() => {
    return lines.reduce((acc, r) => {
      const q = Math.max(0, parseFloat(String(r.qty).replace(',', '.')) || 0);
      return acc + (q > 0 && r.unit_price !== '' ? q : 0);
    }, 0);
  }, [lines]);

  const validItemsCount = useMemo(() => {
    return lines.filter((r) => stockQtyFromLine(r) > 0 && r.unit_price !== '').length;
  }, [lines]);

  const landingTotal = useMemo(
    () => Math.max(0, parseFloat(String(landedCostExtra).replace(',', '.')) || 0),
    [landedCostExtra]
  );

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
      if (!store?.id || term.length < 2) {
        setProductSearchResults([]);
        return;
      }
      setProductSearchLoading(true);
      const safe = escapeIlike(term);
      const pattern = `%${safe}%`;
      const sel = 'id, barcode, reference, eng_name, full_price, price_after_disc, brand_group, stock_count';
      try {
        const [r1, r2, r3, rUnits] = await Promise.all([
          supabase.from(PRODUCTS_TABLE).select(sel).eq('store_id', store.id).ilike('eng_name', pattern).limit(12),
          supabase.from(PRODUCTS_TABLE).select(sel).eq('store_id', store.id).ilike('barcode', pattern).limit(8),
          supabase.from(PRODUCTS_TABLE).select(sel).eq('store_id', store.id).ilike('reference', pattern).limit(8),
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
                brand_group,
                stock_count
              )
            `)
            .eq('store_id', store.id)
            .ilike('barcode', pattern)
            .limit(8)
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
        setProductSearchResults(Array.from(map.values()).slice(0, 20));
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
    const unitCost =
      u && Number(u.cost_price) > 0
        ? Number(u.cost_price)
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
    const grandTotalSave = linePayloadsForSave.reduce((a, x) => a + x.line_total, 0);

    if (grandTotalSave <= 0) {
      toast.warning('أضف أصنافاً بمبالغ صحيحة — إجمالي الفاتورة يجب أن يكون أكبر من صفر');
      return;
    }

    const validLines = linePayloadsForSave.filter((x) => x.qty > 0 && x.unit_price >= 0);
    if (validLines.length === 0) {
      toast.warning('أدخل سطراً واحداً على الأقل بكمية وسعر');
      return;
    }

    setSaving(true);

    try {
      let invoiceScanPath = null;
      if (invoiceScanFile) {
        invoiceScanPath = await uploadPurchaseInvoiceScan(store.id, invoiceScanFile);
      }

      let supplierContactId = selectedSupplierId;
      if (!supplierContactId && company) {
        const { contactId } = await upsertSupplierForCreditDraft(phone, company, store.id);
        supplierContactId = contactId;
      }

      const notesText = [
        `شركة: ${company}`,
        `رقم فاتورة المورد: ${finalInv}`,
        `تاريخ الفاتورة: ${invoiceDateVal}`,
        paymentDueDateVal && `استحقاق السداد: ${paymentDueDateVal}`,
        phone && `هاتف: ${phone}`,
        extraNotes.trim() && `ملاحظات: ${extraNotes.trim()}`,
      ]
        .filter(Boolean)
        .join('\n');

      const landingPart = landingTotal > 0 ? { landed_cost_extra: landingTotal } : {};
      const duePart = paymentDueDateVal ? { payment_due_date: paymentDueDateVal } : {};
      const scanPart = invoiceScanPath ? { invoice_scan_path: invoiceScanPath } : {};

      const rowFull = {
        store_id: store.id,
        supplier_contact_id: supplierContactId,
        supplier_company_name: company,
        invoice_number: finalInv,
        invoice_date: invoiceDateVal,
        supplier_phone: phone,
        total_amount: grandTotalSave,
        payment_mode: paymentMode,
        purchase_status: purchaseStatus === 'draft' ? 'draft' : 'received',
        ...duePart,
        ...scanPart,
        ...landingPart,
        line_items: validLines,
        notes: notesText,
      };

      let purchaseId = null;
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

      toast.success(
        purchaseStatus === 'received'
          ? `تم حفظ الفاتورة (#${finalInv}) واستلام البضاعة للمخزن بنجاح (المجموع: ₪${grandTotalSave.toFixed(2)})`
          : `تم حفظ الفاتورة (#${finalInv}) كمسودة بنجاح (المجموع: ₪${grandTotalSave.toFixed(2)})`
      );

      // Reset form state for a fresh invoice
      setSavedBanner({ total: grandTotalSave, invoiceNumber: finalInv });
      setInvoiceNumber('');
      setLines([newLine()]);
      setExtraNotes('');
      setLandedCostExtra('');
      setSelectedSupplierId(null);
      setSupplierCompanyName('');
      setSupplierPhone('');
      clearInvoiceScan();
      loadSuppliers();
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
          <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-900 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-100 animate-fadeIn">
            <div className="flex items-center gap-2">
              <Check size={18} className="text-emerald-600 dark:text-emerald-400" />
              <span>
                تم حفظ الفاتورة بنجاح {savedBanner.invoiceNumber ? `(#${savedBanner.invoiceNumber})` : ''} — الإجمالي:{' '}
                <span className="font-currency font-black" dir="ltr" lang="en">
                  ₪ {Number(savedBanner.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSavedBanner(null)}
              className="text-emerald-700 hover:text-emerald-900 dark:text-emerald-300"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* 1. HEADER: Single Narrow Horizontal Strip */}
        {/* ------------------------------------------------------------- */}
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-3">
            {/* Title / Icon badge */}
            <div className="flex items-center gap-2 pe-3 border-e border-slate-200 dark:border-slate-800 shrink-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                <ShoppingBag size={17} />
              </div>
              <span className="text-sm font-black text-slate-900 dark:text-white whitespace-nowrap">
                فاتورة مشتريات
              </span>
            </div>

            {/* Supplier Search / Input with Autocomplete */}
            <div className="relative min-w-[200px] flex-1" ref={supplierDropdownRef}>
              <div className="flex items-center justify-between mb-0.5">
                <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  المورد <span className="text-rose-500">*</span>
                </label>
                {selectedSupplierId && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSupplierId(null);
                      setSupplierCompanyName('');
                      setSupplierPhone('');
                    }}
                    className="text-[10px] text-violet-600 dark:text-violet-400 hover:underline font-bold"
                  >
                    تغيير المورد
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  value={supplierCompanyName}
                  onChange={(e) => {
                    setSupplierCompanyName(e.target.value);
                    setSelectedSupplierId(null);
                    setSupplierDropdownOpen(true);
                  }}
                  onFocus={() => setSupplierDropdownOpen(true)}
                  className="h-8.5 w-full rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 text-xs font-bold text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900"
                  placeholder="ابحث أو اكتب اسم المورد…"
                />
                {selectedSupplierId && (
                  <UserCheck size={14} className="absolute left-2.5 top-2 text-emerald-600 dark:text-emerald-400" />
                )}
              </div>

              {/* Autocomplete Dropdown for Suppliers */}
              {supplierDropdownOpen && filteredSuppliers.length > 0 && (
                <ul className="absolute z-50 right-0 left-0 mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800 text-xs">
                  {filteredSuppliers.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="w-full text-right px-3 py-2 hover:bg-violet-50 dark:hover:bg-violet-950/40 border-b border-slate-100 dark:border-slate-700/50 last:border-0 flex items-center justify-between"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectSupplier(s);
                        }}
                      >
                        <span className="font-bold text-slate-900 dark:text-slate-100">{s.name}</span>
                        <div className="flex items-center gap-3 text-[11px] font-currency text-slate-500 dark:text-slate-400" dir="ltr">
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
                </ul>
              )}
            </div>

            {/* Supplier Phone */}
            <div className="w-32 sm:w-36">
              <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">
                هاتف المورد {selectedSupplierId ? '(مسجّل)' : <span className="text-rose-500">*</span>}
              </label>
              <input
                type="tel"
                value={supplierPhone}
                readOnly={Boolean(selectedSupplierId)}
                onChange={(e) => {
                  if (!selectedSupplierId) {
                    setSupplierPhone(normalizeDigitsToLatin(e.target.value));
                  }
                }}
                className={`h-8.5 w-full rounded-lg border px-2.5 text-xs font-currency font-bold outline-none transition-colors ${
                  selectedSupplierId
                    ? 'border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed dark:border-slate-700/60 dark:bg-slate-800/50 dark:text-slate-400 select-none'
                    : 'border-slate-200 bg-slate-50/70 text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900'
                }`}
                dir="ltr"
                lang="en"
                placeholder={selectedSupplierId ? 'مسجل مسبقاً' : '05xxxxxxxx'}
                title={selectedSupplierId ? 'رقم الهاتف مسجل في ملف المورد ولا يمكن تعديله هنا' : 'أدخل هاتف المورد الجديد'}
              />
            </div>

            {/* Invoice Number (Optional) */}
            <div className="w-32 sm:w-36">
              <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">
                رقم الفاتورة <span className="text-slate-400 font-normal">(اختياري)</span>
              </label>
              <input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(normalizeDigitsToLatin(e.target.value))}
                className="h-8.5 w-full rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 text-xs font-currency font-bold text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900"
                dir="ltr"
                lang="en"
                placeholder="تلقائي إن تُرِك فارغاً"
              />
            </div>

            {/* Invoice Date */}
            <div className="w-32 sm:w-36">
              <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">
                تاريخ الفاتورة <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => {
                  setInvoiceDate(e.target.value);
                  if (paymentMode === 'credit') {
                    setPaymentDueDate(addDaysISO(e.target.value, 30));
                  }
                }}
                className="h-8.5 w-full rounded-lg border border-slate-200 bg-slate-50/70 px-2 text-xs font-currency text-slate-800 focus:bg-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark] dark:focus:bg-slate-900"
                dir="ltr"
                lang="en"
              />
            </div>

            {/* Payment Mode (Cash / Credit) */}
            <div className="w-28 sm:w-32">
              <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">
                طريقة الدفع
              </label>
              <select
                value={paymentMode}
                onChange={(e) => {
                  const m = e.target.value;
                  setPaymentMode(m);
                  if (m === 'credit' && !paymentDueDate) {
                    setPaymentDueDate(addDaysISO(invoiceDate, 30));
                  }
                }}
                className={`h-8.5 w-full rounded-lg border px-2 text-xs font-bold outline-none cursor-pointer ${
                  paymentMode === 'credit'
                    ? 'border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-700'
                    : 'border-slate-200 bg-slate-50/70 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                }`}
              >
                <option value="cash">نقداً (كاش)</option>
                <option value="credit">آجل (ذمة)</option>
              </select>
            </div>

            {/* Due Date (only if Credit) */}
            {paymentMode === 'credit' && (
              <div className="w-32 sm:w-36 animate-fadeIn">
                <label className="block text-[11px] font-bold text-amber-800 dark:text-amber-300 mb-0.5">
                  استحقاق السداد <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  value={paymentDueDate}
                  onChange={(e) => setPaymentDueDate(e.target.value)}
                  className="h-8.5 w-full rounded-lg border border-amber-300 bg-amber-50/50 px-2 text-xs font-currency font-bold text-amber-950 focus:bg-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 dark:[color-scheme:dark]"
                  dir="ltr"
                  lang="en"
                />
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* 2. DENSE ACCOUNTING TABLE */}
        {/* ------------------------------------------------------------- */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden dark:border-slate-800 dark:bg-slate-900">
          {/* Table Action Bar */}
          <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/60 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-slate-800 dark:text-slate-200">بنود الفاتورة</span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold">
                ({validItemsCount} صنف مدخل)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setProductSearchOpen(true);
                  setProductSearchQuery('');
                  setProductSearchResults([]);
                  setTimeout(() => productSearchInputRef.current?.focus(), 50);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-black text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800/60 dark:bg-indigo-950/40 dark:text-indigo-300"
                title="بحث عن منتج في المخزن"
              >
                <Search size={14} />
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
          </div>

          {/* Dense Table View */}
          <div className="overflow-x-auto" ref={tableDropdownRef}>
            <table className="w-full text-xs min-w-[1000px] border-collapse text-right">
              <thead>
                <tr className="bg-slate-100/90 text-slate-700 dark:bg-slate-800/90 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 text-[11px] select-none">
                  <th className="py-2 px-2 font-bold w-10 text-center">#</th>
                  <th className="py-2 px-2 font-bold min-w-[150px]" dir="ltr">
                    الباركود
                  </th>
                  <th className="py-2 px-2 font-bold min-w-[220px]">
                    اسم الصنف
                  </th>
                  <th className="py-2 px-2 font-bold w-24 text-center">
                    الوحدة
                  </th>
                  <th className="py-2 px-2 font-bold w-20 text-center" dir="ltr">
                    الكمية
                  </th>
                  <th className="py-2 px-2 font-bold w-28 text-center" dir="ltr">
                    سعر الشراء
                  </th>
                  <th className="py-2 px-2 font-bold w-20 text-center" dir="ltr">
                    خصم %
                  </th>
                  <th className="py-2 px-2 font-bold w-28 text-center" dir="ltr">
                    الإجمالي
                  </th>
                  <th className="py-2 px-2 font-bold w-24 text-center">
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
                            onChange={(e) => {
                              const v = normalizeDigitsToLatin(e.target.value);
                              updateLine(row.key, 'barcode', v);
                              setDropdownRowKey(row.key);
                              setDropdownField('barcode');
                              scheduleSearch(row.key, v);
                            }}
                            onKeyDown={(e) => handleBarcodeKeyDown(e, row)}
                            onFocus={() => {
                              setDropdownRowKey(row.key);
                              setDropdownField('barcode');
                              if ((row.barcode || '').trim().length >= 2) {
                                fetchProductSuggestions(row.key, row.barcode);
                              }
                            }}
                            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-currency font-bold text-slate-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            dir="ltr"
                            lang="en"
                            placeholder="امسح أو اكتب…"
                          />

                          {searchLoadingKey === row.key && dropdownField === 'barcode' && (
                            <Loader2 className="absolute left-3 top-3 w-3.5 h-3.5 animate-spin text-violet-500" />
                          )}

                          {/* Suggestions popup (under barcode) */}
                          {showDrop && dropdownField === 'barcode' && (
                            <ul className="absolute z-50 right-0 left-0 mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800 text-[11px]">
                              {sug.map((p) => (
                                <li key={p.unitData ? `u-${p.unitData.id}` : p.id}>
                                  <button
                                    type="button"
                                    className="w-full text-right px-2.5 py-2 hover:bg-violet-50 dark:hover:bg-violet-950/40 border-b border-slate-50 dark:border-slate-700/50 last:border-0"
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

                        {/* 3. Product Name */}
                        <td className="py-1.5 px-1.5 relative">
                          <input
                            value={row.productName}
                            onChange={(e) => {
                              const v = e.target.value;
                              updateLine(row.key, 'productName', v);
                              setDropdownRowKey(row.key);
                              setDropdownField('name');
                              scheduleSearch(row.key, v);
                            }}
                            onFocus={() => {
                              setDropdownRowKey(row.key);
                              setDropdownField('name');
                              if ((row.productName || '').trim().length >= 2) {
                                fetchProductSuggestions(row.key, row.productName);
                              }
                            }}
                            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-bold text-slate-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            placeholder="اسم الصنف أو الوصف…"
                          />

                          {searchLoadingKey === row.key && dropdownField === 'name' && (
                            <Loader2 className="absolute left-3 top-3 w-3.5 h-3.5 animate-spin text-violet-500" />
                          )}

                          {/* Suggestions popup (under name) */}
                          {showDrop && dropdownField === 'name' && (
                            <ul className="absolute z-50 right-0 left-0 mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800 text-[11px]">
                              {sug.map((p) => (
                                <li key={p.unitData ? `u-${p.unitData.id}` : p.id}>
                                  <button
                                    type="button"
                                    className="w-full text-right px-2.5 py-2 hover:bg-violet-50 dark:hover:bg-violet-950/40 border-b border-slate-50 dark:border-slate-700/50 last:border-0"
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

                        {/* 4. Unit */}
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
                                  onChange={(e) => handleUnitChange(row.key, e.target.value)}
                                  className="h-8 w-full rounded-md border border-violet-300 bg-violet-50/70 px-1 text-center text-xs font-bold text-violet-900 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200 cursor-pointer"
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
                                  onChange={(e) => updateLine(row.key, 'unit', e.target.value)}
                                  className="h-8 w-full rounded-md border border-slate-200 bg-white px-1 text-center text-xs font-bold text-slate-700 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
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

                        {/* 5. Qty */}
                        <td className="py-1.5 px-1.5 text-center">
                          <input
                            value={row.qty}
                            onChange={(e) => updateLine(row.key, 'qty', normalizeDigitsToLatin(e.target.value))}
                            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-center text-xs font-currency font-black text-slate-900 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            dir="ltr"
                            lang="en"
                            inputMode="decimal"
                          />
                        </td>

                        {/* 6. Unit Purchase Price */}
                        <td className="py-1.5 px-1.5 text-center">
                          <input
                            value={row.unit_price}
                            onChange={(e) =>
                              updateLine(row.key, 'unit_price', normalizeDigitsToLatin(e.target.value))
                            }
                            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-center text-xs font-currency font-black text-slate-900 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            dir="ltr"
                            lang="en"
                            inputMode="decimal"
                            placeholder="0.00"
                          />
                        </td>

                        {/* 7. Discount % */}
                        <td className="py-1.5 px-1.5 text-center">
                          <input
                            value={row.discount_percent}
                            onChange={(e) =>
                              updateLine(row.key, 'discount_percent', normalizeDigitsToLatin(e.target.value))
                            }
                            className="h-8 w-full rounded-md border border-slate-200 bg-white px-1 text-center text-xs font-currency font-bold text-slate-700 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
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
                          </div>
                        </td>
                      </tr>

                      {/* Optional Expandable Sub-Row (Shown only when Details button is toggled) */}
                      {row.showDetails && (
                        <tr className="bg-slate-50/70 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700/60">
                          <td className="py-2 px-2" />
                          <td colSpan={8} className="py-2.5 px-3">
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
                                    onChange={(e) => updateLine(row.key, 'expiryDate', e.target.value)}
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
                                      onChange={(e) => updateLine(row.key, 'serialInput', e.target.value)}
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
            </table>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* 3. DENSE BOTTOM TOTALS BAR */}
        {/* ------------------------------------------------------------- */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-4">
          {/* Left summary values */}
          <div className="flex flex-wrap items-center gap-5 text-xs">
            <div>
              <span className="text-[11px] text-slate-400 block font-bold">الأصناف والكمية</span>
              <span className="font-black text-slate-800 dark:text-slate-100">
                {validItemsCount} صنف ({totalUnitsCount} وحدة)
              </span>
            </div>

            <div>
              <span className="text-[11px] text-slate-400 block font-bold">مجموع البضاعة</span>
              <span className="font-currency font-black text-slate-800 dark:text-slate-100" dir="ltr" lang="en">
                ₪ {subtotalBeforeDiscount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            {totalDiscountAmount > 0 && (
              <div>
                <span className="text-[11px] text-slate-400 block font-bold">الخصم</span>
                <span className="font-currency font-black text-rose-600 dark:text-rose-400" dir="ltr" lang="en">
                  - ₪ {totalDiscountAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            )}

            {landingTotal > 0 && (
              <div>
                <span className="text-[11px] text-slate-400 block font-bold">مصاريف واصلة</span>
                <span className="font-currency font-black text-indigo-600 dark:text-indigo-400" dir="ltr" lang="en">
                  + ₪ {landingTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            )}

            <div className="pe-4 border-s border-slate-200 dark:border-slate-800 ps-4">
              <span className="text-[11px] text-violet-600 dark:text-violet-400 block font-bold">
                الصافي النهائي
              </span>
              <span className="text-xl font-black text-violet-700 dark:text-violet-300 font-currency" dir="ltr" lang="en">
                ₪ {grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Right action buttons: Status toggle & Big Save button */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Status Selector */}
            <select
              value={purchaseStatus}
              onChange={(e) => setPurchaseStatus(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 outline-none cursor-pointer"
            >
              <option value="received">تم الاستلام (تحديث المخزون فوراً)</option>
              <option value="draft">مسودة (حفظ دون تحديث المخزون)</option>
            </select>

            {/* Save Button */}
            <button
              type="button"
              onClick={handleSavePurchase}
              disabled={saving || grandTotal <= 0}
              className="h-10 inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-black px-6 text-xs shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {saving ? <Loader2 className="animate-spin" size={17} /> : <Save size={17} />}
              <span>{purchaseStatus === 'draft' ? 'حفظ كمسودة' : 'حفظ واستلام للمخزن'}</span>
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* 4. COLLAPSIBLE ACCORDION FOR EXTRA OPTIONS */}
        {/* ------------------------------------------------------------- */}
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden shadow-xs">
          <button
            type="button"
            onClick={() => setExtraOptionsOpen(!extraOptionsOpen)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span>خيارات إضافية (مصاريف واصلة، صورة الفاتورة، ملاحظات، إعدادات التكلفة)</span>
              {/* Badges for active extra values */}
              {landingTotal > 0 && (
                <span className="rounded-md bg-indigo-100 text-indigo-800 px-2 py-0.5 text-[10px] font-currency dark:bg-indigo-950/60 dark:text-indigo-300">
                  مصاريف: ₪{landingTotal}
                </span>
              )}
              {invoiceScanFile && (
                <span className="rounded-md bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] dark:bg-emerald-950/60 dark:text-emerald-300">
                  صورة مرفقة
                </span>
              )}
              {extraNotes.trim() && (
                <span className="rounded-md bg-slate-200 text-slate-800 px-2 py-0.5 text-[10px] dark:bg-slate-700 dark:text-slate-300">
                  ملاحظات
                </span>
              )}
            </div>

            <div className="text-slate-400">
              {extraOptionsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </button>

          {extraOptionsOpen && (
            <div className="p-4 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 space-y-4 text-xs animate-fadeIn">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Landed Cost Extra */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    مصاريف إضافية واصلة (نقل، شحن، جمارك…) ₪
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={landedCostExtra}
                    onChange={(e) => setLandedCostExtra(normalizeDigitsToLatin(e.target.value))}
                    className="h-8.5 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs font-currency dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    dir="ltr"
                    lang="en"
                    placeholder="0.00"
                  />
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                    تُوزَّع نسبياً على بنود الفاتورة لتقدير تكلفة الوحدة الواصلة الحقيقية.
                  </p>
                </div>

                {/* Notes */}
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    ملاحظات الفاتورة (اختياري)
                  </label>
                  <textarea
                    value={extraNotes}
                    onChange={(e) => setExtraNotes(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
                    placeholder="أي ملاحظات تخص الشحنة أو الاتفاق مع المورد…"
                  />
                </div>
              </div>

              {/* Invoice Scan & WAC cost settings */}
              <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
                {/* Image Scan Upload */}
                <div className="flex items-center gap-3">
                  <input
                    ref={invoiceFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleInvoiceFileChosen}
                  />

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        invoiceFileRef.current?.removeAttribute('capture');
                        invoiceFileRef.current?.click();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      <Upload size={14} />
                      إرفاق صورة الفاتورة
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        invoiceFileRef.current?.setAttribute('capture', 'environment');
                        invoiceFileRef.current?.click();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-100 dark:border-violet-800/60 dark:bg-violet-950/40 dark:text-violet-300"
                    >
                      <Camera size={14} />
                      كاميرا
                    </button>

                    {invoiceScanFile && (
                      <button
                        type="button"
                        onClick={clearInvoiceScan}
                        className="text-xs font-bold text-rose-600 hover:underline px-1.5"
                      >
                        إزالة الصورة
                      </button>
                    )}
                  </div>

                  {invoicePreviewUrl && (
                    <div className="h-10 w-10 rounded-md border border-slate-200 overflow-hidden bg-slate-100 shrink-0">
                      <img src={invoicePreviewUrl} alt="معاينة" className="h-full w-full object-cover" />
                    </div>
                  )}
                </div>

                {/* WAC Checkbox */}
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700 dark:text-slate-300 select-none">
                  <input
                    type="checkbox"
                    checked={updateCatalogCosts}
                    onChange={(e) => setUpdateCatalogCosts(e.target.checked)}
                    className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span>
                    تطبيق <strong>متوسط التكلفة المرجح (WAC)</strong> على أسعار الكتالوج عند الاستلام
                  </span>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------- */}
        {/* MODALS: Product Search & New Product */}
        {/* ------------------------------------------------------------- */}

        {/* Modal: Fast Product Search */}
        {productSearchOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[10vh] bg-black/50 backdrop-blur-xs"
            role="dialog"
            aria-modal="true"
            onClick={() => {
              setProductSearchOpen(false);
              setProductSearchResults([]);
              setProductSearchQuery('');
            }}
          >
            <div
              className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden dark:border-slate-800 dark:bg-slate-900"
              dir="rtl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60">
                <Search size={18} className="text-indigo-500 shrink-0" />
                <input
                  ref={productSearchInputRef}
                  type="text"
                  value={productSearchQuery}
                  onChange={(e) => {
                    setProductSearchQuery(e.target.value);
                    searchProductsForModal(e.target.value);
                  }}
                  placeholder="ابحث بالاسم أو الباركود أو المرجع… (حرفان كحد أدنى)"
                  className="flex-1 bg-transparent text-sm font-bold text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                  autoComplete="off"
                />
                {productSearchLoading && <Loader2 size={16} className="animate-spin text-indigo-400 shrink-0" />}
                <button
                  type="button"
                  onClick={() => {
                    setProductSearchOpen(false);
                    setProductSearchResults([]);
                    setProductSearchQuery('');
                  }}
                  className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shrink-0"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="max-h-[60vh] overflow-y-auto">
                {productSearchQuery.trim().length < 2 ? (
                  <p className="py-10 text-center text-sm text-slate-400 font-bold">
                    اكتب حرفين على الأقل للبحث في منتجات المخزن
                  </p>
                ) : productSearchResults.length === 0 && !productSearchLoading ? (
                  <p className="py-10 text-center text-sm text-slate-400 font-bold">
                    لا توجد منتجات مطابقة
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {productSearchResults.map((p) => {
                      const price =
                        Number(p.price_after_disc) > 0 ? Number(p.price_after_disc) : Number(p.full_price) || 0;
                      const stock = p.stock_count != null ? Number(p.stock_count) : null;
                      return (
                        <li key={p.unitData ? `u_${p.unitData.id}` : p.id}>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              addProductFromSearch(p);
                            }}
                            className="w-full text-right px-4 py-3 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 flex items-start justify-between gap-3"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-black text-sm text-slate-900 dark:text-slate-100 truncate">
                                {p.eng_name || '—'} {p.unitData ? `(${p.unitData.unit_name})` : ''}
                              </p>
                              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5" dir="ltr">
                                {p.unitData?.barcode || p.barcode || '—'}
                                {p.reference ? ` · ${p.reference}` : ''}
                              </p>
                            </div>
                            <div className="text-left shrink-0 space-y-0.5">
                              <p className="text-sm font-black text-indigo-700 dark:text-indigo-400 font-currency" dir="ltr">
                                ₪{price.toFixed(2)}
                              </p>
                              {stock != null && (
                                <p
                                  className={`text-[11px] font-bold ${
                                    stock > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                                  }`}
                                >
                                  مخزون: {stock}
                                </p>
                              )}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-400 text-center font-bold dark:border-slate-800 dark:bg-slate-800/60">
                اضغط على المنتج لإضافته لسطر الفاتورة
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
      </div>
    </DashboardLayout>
  );
}
