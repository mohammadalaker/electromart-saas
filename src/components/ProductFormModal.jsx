import { useEffect, useState, useRef, useMemo } from 'react';
import {
  X,
  PackagePlus,
  Pencil,
  Trash2,
  Plus,
  Boxes,
  ScanLine,
  Truck,
  Calendar,
  AlertCircle,
  Check,
  Loader2,
} from 'lucide-react';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { roundMoney, isUuid } from '../utils/productModel';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';
import {
  COMMON_UNIT_PRESETS,
  fetchUnitsByProductId,
  saveProductUnits,
  PRODUCT_UNITS_TABLE,
} from '../utils/productUnits';
import { insertInventoryLog } from '../lib/inventoryLogs';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';

const QUICK_CATEGORIES = [
  'مواد غذائية',
  'مشروبات',
  'ألبان وأجبان',
  'منظفات',
  'حلويات',
  'خضار',
];

/**
 * مكوّن موحّد لإضافة وتعديل الأصناف (Add / Edit Product Modal)
 *
 * @param {boolean} isOpen هل النافذة مفتوحة
 * @param {Function} onClose إغلاق النافذة
 * @param {'add' | 'edit'} mode وضع المودال (إضافة أو تعديل)
 * @param {object} product الصنف المراد تعديله عند mode='edit'
 * @param {string} initialBarcode باركود أولي ممسوح بالسكانر عند mode='add'
 * @param {boolean} isInventoryOnly خاص بنقطة البيع: هل الحفظ للمخزون فقط أم للفاتورة
 * @param {Array} suppliers قائمة الموردين (اختياري - يجلبها تلقائياً إذا لم تُمرر)
 * @param {Function} onSuccess استدعاء عند نجاح الحفظ (savedProduct, isNew, units)
 * @param {Function} onDelete استدعاء عند نجاح الحذف (deletedProduct)
 */
export default function ProductFormModal({
  isOpen,
  onClose,
  mode = 'add',
  product = null,
  initialBarcode = '',
  isInventoryOnly = false,
  suppliers = null,
  onSuccess,
  onDelete,
}) {
  const { store } = useStore();
  const toast = useToast();

  const nameInputRef = useRef(null);
  const barcodeInputRef = useRef(null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [suppliersList, setSuppliersList] = useState(suppliers || []);

  const [form, setForm] = useState({
    name: '',
    barcode: '',
    unit: 'قطعة',
    price: '',
    costPrice: '',
    stock: '0',
    minStockAlert: '5',
    expiryDate: '',
    supplierId: '',
    category: '',
    additionalUnits: [],
  });

  // جلب قائمة الموردين إذا لم تُمرر عبر الخاصية
  useEffect(() => {
    if (suppliers && suppliers.length > 0) {
      setSuppliersList(suppliers);
      return;
    }
    if (!store?.id || !isOpen) return;

    supabase
      .from('suppliers')
      .select('id, name, phone')
      .eq('store_id', store.id)
      .order('name')
      .then(({ data, error }) => {
        if (!error && data) {
          setSuppliersList(data);
        }
      });
  }, [store?.id, suppliers, isOpen]);

  // تهيئة الحقول عند الفتح أو تغير المنتج / الوضع
  useEffect(() => {
    if (!isOpen) return;

    setConfirmDeleteOpen(false);

    if (mode === 'edit' && product) {
      const pName = product.name || product.eng_name || '';
      const pBc = product.barcode || '';
      const pPrice =
        product.price != null && product.price !== ''
          ? String(product.price)
          : product.full_price != null && product.full_price !== ''
          ? String(product.full_price)
          : '';
      const pCost =
        product.purchasePrice != null && product.purchasePrice !== ''
          ? String(product.purchasePrice)
          : product.purchase_price != null && product.purchase_price !== ''
          ? String(product.purchase_price)
          : '';
      const pStock =
        product.stock != null && product.stock !== ''
          ? String(product.stock)
          : product.stock_count != null && product.stock_count !== ''
          ? String(product.stock_count)
          : '0';
      const pMinStock =
        product.minStockAlert != null && product.minStockAlert !== ''
          ? String(product.minStockAlert)
          : product.min_stock_alert != null && product.min_stock_alert !== ''
          ? String(product.min_stock_alert)
          : '5';
      const pExpiry = product.expiryDate || product.expiry_date || '';
      const pSupplier = product.supplierId || product.supplier_id || '';
      const pCat = product.group || product.brand_group || '';
      const pUnit = product.unit || 'قطعة';

      setForm({
        name: pName,
        barcode: pBc,
        unit: pUnit,
        price: pPrice,
        costPrice: pCost,
        stock: pStock,
        minStockAlert: pMinStock,
        expiryDate: pExpiry ? pExpiry.split('T')[0] : '',
        supplierId: pSupplier,
        category: pCat,
        additionalUnits: [],
      });

      // جلب الوحدات المسجلة للصنف من جدول product_units
      const prodId = product.id;
      if (prodId) {
        setLoadingUnits(true);
        fetchUnitsByProductId(prodId, store?.id)
          .then((units) => {
            if (Array.isArray(units) && units.length > 0) {
              const baseU = units.find((u) => u.is_base_unit);
              if (baseU?.unit_name) {
                setForm((prev) => ({ ...prev, unit: baseU.unit_name }));
              }
              const extras = units
                .filter((u) => !u.is_base_unit)
                .map((u) => ({
                  id: u.id || String(Date.now() + Math.random()),
                  unit_name: u.unit_name || '',
                  conversion_factor: u.conversion_factor || 1,
                  sale_price: u.sale_price != null ? String(u.sale_price) : '',
                  barcode: u.barcode || '',
                }));
              setForm((prev) => ({ ...prev, additionalUnits: extras }));
            }
          })
          .catch((err) => {
            console.warn('[ProductFormModal] fetchUnitsByProductId failed:', err);
          })
          .finally(() => {
            setLoadingUnits(false);
          });
      }
    } else {
      // mode === 'add'
      setForm({
        name: '',
        barcode: initialBarcode || '',
        unit: 'قطعة',
        price: '',
        costPrice: '',
        stock: '0',
        minStockAlert: '5',
        expiryDate: '',
        supplierId: '',
        category: '',
        additionalUnits: [],
      });
    }

    // التركيز التلقائي
    const timer = setTimeout(() => {
      if (mode === 'add' && !initialBarcode) {
        barcodeInputRef.current?.focus();
      } else {
        nameInputRef.current?.focus();
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [isOpen, mode, product, initialBarcode, store?.id]);

  if (!isOpen) return null;

  // ── إدارة أسطر الوحدات الإضافية ──
  const handleAddUnitRow = () => {
    setForm((prev) => ({
      ...prev,
      additionalUnits: [
        ...prev.additionalUnits,
        {
          id: String(Date.now() + Math.random()),
          unit_name: '',
          conversion_factor: 12,
          sale_price: '',
          barcode: '',
        },
      ],
    }));
  };

  const handleUpdateUnitRow = (id, field, value) => {
    setForm((prev) => ({
      ...prev,
      additionalUnits: prev.additionalUnits.map((u) =>
        u.id === id ? { ...u, [field]: value } : u
      ),
    }));
  };

  const handleRemoveUnitRow = (id) => {
    setForm((prev) => ({
      ...prev,
      additionalUnits: prev.additionalUnits.filter((u) => u.id !== id),
    }));
  };

  // ── تنفيذ عملية الحفظ (Add أو Edit) ──
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!store?.id || saving) return;

    const name = form.name.trim();
    if (!name) {
      toast.error('يرجى كتابة اسم المنتج');
      nameInputRef.current?.focus();
      return;
    }

    const priceNum = roundMoney(parseFloat(normalizeDigitsToLatin(form.price)));
    if (isNaN(priceNum) || priceNum < 0) {
      toast.error('يرجى إدخال سعر بيع صحيح (0 أو أكثر)');
      return;
    }

    const rawCost = normalizeDigitsToLatin(form.costPrice);
    const costPriceNum = rawCost !== '' ? roundMoney(parseFloat(rawCost)) : 0;
    if (isNaN(costPriceNum) || costPriceNum < 0) {
      toast.error('يرجى إدخال سعر تكلفة صحيح (0 أو أكثر)');
      return;
    }

    const parsedStock = parseFloat(normalizeDigitsToLatin(form.stock));
    const stockNum = isNaN(parsedStock) || parsedStock < 0 ? 0 : roundMoney(parsedStock);

    const parsedMinStock = parseFloat(normalizeDigitsToLatin(form.minStockAlert));
    const minStockVal = isNaN(parsedMinStock) || parsedMinStock < 0 ? 5 : roundMoney(parsedMinStock);

    const supplierVal = form.supplierId?.trim() || null;
    const expiryVal = form.expiryDate?.trim() || null;
    const unitVal = form.unit?.trim() || 'قطعة';
    const catVal = form.category?.trim() || null;
    const cleanMainBc = normalizeDigitsToLatin(String(form.barcode || '').trim());

    // تجهيز وفحص وحدات البيع الإضافية
    const rawAdditionalUnits = (form.additionalUnits || [])
      .map((u) => ({
        unit_name: String(u.unit_name || '').trim(),
        barcode: normalizeDigitsToLatin(String(u.barcode || '').trim()),
        conversion_factor: Number(u.conversion_factor) || 1,
        sale_price: u.sale_price !== '' ? Number(u.sale_price) || 0 : priceNum,
      }))
      .filter((u) => u.unit_name);

    const unitBarcodes = rawAdditionalUnits.filter((u) => Boolean(u.barcode));

    // 1. فحص تعارض داخلي: هل باركود الوحدة الإضافية يطابق باركود الصنف الأساسي؟
    if (cleanMainBc) {
      const sameAsMain = unitBarcodes.find((u) => u.barcode === cleanMainBc);
      if (sameAsMain) {
        toast.error(`الباركود (${cleanMainBc}) مستخدم للوحدة الأساسية لنفس المنتج، يرجى اختيار باركود مختلف.`);
        return;
      }
    }

    // 2. فحص تعارض داخلي: هل هناك تكرار بين باركودات الوحدات الإضافية؟
    const seenUnitBc = new Set();
    for (const u of unitBarcodes) {
      if (seenUnitBc.has(u.barcode)) {
        toast.error(`الباركود (${u.barcode}) مكرر في أكثر من وحدة لنفس المنتج.`);
        return;
      }
      seenUnitBc.add(u.barcode);
    }

    setSaving(true);
    try {
      const currentProductId = mode === 'edit' && product?.id ? product.id : null;

      // 3. فحص قاعدة البيانات: هل باركود أي وحدة إضافية مستخدم في products.barcode لصنف آخر؟
      for (const u of unitBarcodes) {
        let q = supabase
          .from(PRODUCTS_TABLE)
          .select('id, eng_name')
          .eq('store_id', store.id)
          .eq('barcode', u.barcode);
        if (currentProductId) q = q.neq('id', currentProductId);
        const { data: prodBcMatch } = await q.maybeSingle();

        if (prodBcMatch) {
          toast.error(`الباركود (${u.barcode}) مسجل كباركود صنف للصنف «${prodBcMatch.eng_name || ''}».`);
          setSaving(false);
          return;
        }
      }

      // 4. فحص قاعدة البيانات: هل باركود أي وحدة مستخدم في product_units.barcode لصنف آخر؟
      for (const u of unitBarcodes) {
        let q = supabase
          .from(PRODUCT_UNITS_TABLE)
          .select('id, unit_name, product_id, product:products(eng_name)')
          .eq('store_id', store.id)
          .eq('barcode', u.barcode);
        if (currentProductId) q = q.neq('product_id', currentProductId);
        const { data: puMatch } = await q.maybeSingle();

        if (puMatch) {
          const prodTitle = puMatch.product?.eng_name ? ` للصنف «${puMatch.product.eng_name}»` : '';
          toast.error(`الباركود (${u.barcode}) مسجل لوحدة «${puMatch.unit_name}»${prodTitle}.`);
          setSaving(false);
          return;
        }
      }

      // 5. فحص باركود الصنف الأساسي: هل هو مستخدم مسبقاً لصنف آخر أو وحدة صنف آخر؟
      if (cleanMainBc) {
        let qProd = supabase
          .from(PRODUCTS_TABLE)
          .select('id, eng_name')
          .eq('store_id', store.id)
          .eq('barcode', cleanMainBc);
        if (currentProductId) qProd = qProd.neq('id', currentProductId);
        const { data: mainMatch } = await qProd.maybeSingle();

        if (mainMatch) {
          toast.error(`الباركود (${cleanMainBc}) مسجل مسبقاً للصنف «${mainMatch.eng_name || ''}».`);
          setSaving(false);
          return;
        }

        let qUnit = supabase
          .from(PRODUCT_UNITS_TABLE)
          .select('id, unit_name, product_id, product:products(eng_name)')
          .eq('store_id', store.id)
          .eq('barcode', cleanMainBc);
        if (currentProductId) qUnit = qUnit.neq('product_id', currentProductId);
        const { data: mainPuMatch } = await qUnit.maybeSingle();

        if (mainPuMatch) {
          const prodTitle = mainPuMatch.product?.eng_name ? ` للصنف «${mainPuMatch.product.eng_name}»` : '';
          toast.error(`الباركود (${cleanMainBc}) مسجل لوحدة «${mainPuMatch.unit_name}»${prodTitle}.`);
          setSaving(false);
          return;
        }
      }

      // ── تجهيز كائن الوحدات للحفظ ──
      const buildUnitsList = (targetProdId) => [
        {
          unit_name: unitVal,
          conversion_factor: 1,
          barcode: cleanMainBc || null,
          sale_price: priceNum,
          cost_price: costPriceNum,
          is_base_unit: true,
        },
        ...rawAdditionalUnits.map((u) => ({
          unit_name: u.unit_name,
          conversion_factor: u.conversion_factor || 1,
          barcode: u.barcode || null,
          sale_price: u.sale_price || priceNum,
          cost_price: costPriceNum * (u.conversion_factor || 1),
          is_base_unit: false,
        })),
      ];

      // ══════════════════════════════════════════════════════════════
      // أ. وضع الإضافة (mode === 'add')
      // ══════════════════════════════════════════════════════════════
      if (mode === 'add') {
        const payloadBase = {
          store_id: store.id,
          barcode: cleanMainBc || null,
          eng_name: name,
          full_price: priceNum,
          price_after_disc: priceNum,
          purchase_price: costPriceNum,
          last_purchase_price: costPriceNum,
          avg_purchase_price: costPriceNum,
          stock_count: stockNum,
          box_count: 1,
          brand_group: catVal,
        };

        const payloadWithExtras = {
          ...payloadBase,
          ...(supplierVal ? { supplier_id: supplierVal } : {}),
          ...(expiryVal ? { expiry_date: expiryVal } : {}),
          ...(minStockVal != null ? { min_stock_alert: minStockVal } : {}),
        };

        const payloadMinimal = {
          store_id: store.id,
          barcode: cleanMainBc || null,
          eng_name: name,
          full_price: priceNum,
          price_after_disc: priceNum,
          purchase_price: costPriceNum,
          stock_count: stockNum,
        };

        let inserted = null;
        let insErr = null;

        for (const p of [payloadWithExtras, payloadBase, payloadMinimal]) {
          const res = await supabase.from(PRODUCTS_TABLE).insert([p]).select().maybeSingle();
          if (!res.error && res.data) {
            inserted = res.data;
            insErr = null;
            break;
          }
          insErr = res.error;
        }

        if (insErr && !inserted) throw insErr;

        // حفظ الوحدات بجدول product_units
        const unitsToSave = buildUnitsList(inserted.id);
        await saveProductUnits(inserted.id, store.id, unitsToSave);

        // توثيق حركة المخزون الافتتاحي
        if (stockNum > 0 && inserted.id) {
          try {
            await insertInventoryLog({
              storeId: store.id,
              productId: inserted.id,
              barcode: cleanMainBc || null,
              productName: name,
              qtyBefore: 0,
              qtyAfter: stockNum,
              reason: 'initial',
            });
          } catch (logErr) {
            console.warn('[ProductFormModal] inventory log error:', logErr);
          }
        }

        toast.success(`✓ تمت إضافة الصنف «${name}» إلى المخزون بنجاح`);
        onSuccess?.(inserted, true, unitsToSave);
        onClose();
      }

      // ══════════════════════════════════════════════════════════════
      // ب. وضع التعديل (mode === 'edit')
      // ══════════════════════════════════════════════════════════════
      else {
        const targetId = product?.id;
        const prevStock =
          product?.stock != null
            ? Number(product.stock)
            : product?.stock_count != null
            ? Number(product.stock_count)
            : 0;

        const updateBase = {
          barcode: cleanMainBc || null,
          eng_name: name,
          full_price: priceNum,
          price_after_disc: priceNum,
          purchase_price: costPriceNum,
          last_purchase_price: costPriceNum,
          avg_purchase_price: costPriceNum,
          stock_count: stockNum,
          brand_group: catVal,
        };

        const updateWithExtras = {
          ...updateBase,
          supplier_id: supplierVal,
          expiry_date: expiryVal,
          min_stock_alert: minStockVal,
        };

        let updated = null;
        let updErr = null;

        for (const p of [updateWithExtras, updateBase]) {
          let q = supabase
            .from(PRODUCTS_TABLE)
            .update(p)
            .eq('store_id', store.id);

          if (targetId && isUuid(targetId)) {
            q = q.eq('id', targetId);
          } else if (product?.barcode) {
            q = q.eq('barcode', product.barcode);
          } else {
            break;
          }

          const res = await q.select().maybeSingle();
          if (!res.error && res.data) {
            updated = res.data;
            updErr = null;
            break;
          }
          updErr = res.error;
        }

        if (updErr && !updated) throw updErr;

        const savedProdId = updated?.id || targetId;

        // حفظ وتحديث الوحدات
        const unitsToSave = buildUnitsList(savedProdId);
        if (savedProdId) {
          await saveProductUnits(savedProdId, store.id, unitsToSave);
        }

        // توثيق تعديل المخزون إذا تغيرت الكمية
        if (savedProdId && prevStock !== stockNum) {
          try {
            await insertInventoryLog({
              storeId: store.id,
              productId: savedProdId,
              barcode: cleanMainBc || null,
              productName: name,
              qtyBefore: prevStock,
              qtyAfter: stockNum,
              reason: 'adjustment',
            });
          } catch (logErr) {
            console.warn('[ProductFormModal] inventory adjustment log error:', logErr);
          }
        }

        toast.success(`✓ تم تحديث بيانات الصنف «${name}» بنجاح`);
        onSuccess?.(updated || { ...product, ...updateWithExtras, id: savedProdId }, false, unitsToSave);
        onClose();
      }
    } catch (err) {
      console.error('[ProductFormModal] Save error:', err);
      toast.error(err.message || 'حدث خطأ أثناء حفظ الصنف');
    } finally {
      setSaving(false);
    }
  };

  // ── تنفيذ حذف الصنف (في وضع Edit فقط) ──
  const handleDeleteProduct = async () => {
    if (!store?.id || !product) return;
    setDeleting(true);
    try {
      const prodId = product.id;
      const prodBc = product.barcode;

      // 1. حذف الوحدات التابعة للصنف أولاً
      if (prodId) {
        await supabase
          .from(PRODUCT_UNITS_TABLE)
          .delete()
          .eq('product_id', prodId);
      }

      // 2. حذف الصنف من جدول products
      let q = supabase.from(PRODUCTS_TABLE).delete().eq('store_id', store.id);
      if (prodId && isUuid(prodId)) {
        q = q.eq('id', prodId);
      } else if (prodBc) {
        q = q.eq('barcode', prodBc);
      } else {
        throw new Error('تعذر تحديد الصنف للحذف');
      }

      const { error } = await q;
      if (error) throw error;

      toast.success(`✓ تم حذف الصنف «${form.name || product.name}» من المخزون`);
      onDelete?.(product);
      onClose();
    } catch (err) {
      console.error('[ProductFormModal] Delete error:', err);
      toast.error(err.message || 'فشل حذف الصنف');
    } finally {
      setDeleting(false);
      setConfirmDeleteOpen(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 dark:bg-slate-950/85 backdrop-blur-md p-4"
      dir="rtl"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-2xl p-6 text-right text-slate-900 dark:text-white transition-colors flex flex-col max-h-[92vh]">
        {/* رأس المودال (Header) */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3 mb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-2xl shadow-sm ${
                mode === 'add'
                  ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400'
                  : 'bg-amber-50 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400'
              }`}
            >
              {mode === 'add' ? <PackagePlus size={22} /> : <Pencil size={20} />}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {mode === 'add'
                  ? isInventoryOnly
                    ? 'إضافة صنف جديد للمخزون'
                    : initialBarcode
                    ? 'تسجيل منتج جديد'
                    : 'إضافة صنف جديد للمخزون'
                  : 'تعديل الصنف'}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {mode === 'add'
                  ? isInventoryOnly
                    ? 'أدخل بيانات الصنف لإضافته للمخزون (لن يُضاف للفاتورة الحالية)'
                    : initialBarcode
                    ? 'الباركود غير موجود، سجله الآن لإضافته للفاتورة فوراً'
                    : 'أدخل بيانات وتفاصيل الصنف والوحدات لحفظه في المخزون'
                  : 'تعديل بيانات وأسعار ووحدات الصنف في المخزون'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* جسم النموذج (Form Body) */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto pr-1 pl-1 space-y-3">
          {/* 1. حقل الباركود */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
              الباركود (امسحه بالسكانر أو اكتبه)
            </label>
            <div className="relative">
              <ScanLine className="absolute right-3 top-1/2 -translate-y-1/2 text-indigo-500" size={16} />
              <input
                ref={barcodeInputRef}
                type="text"
                value={form.barcode}
                onChange={(e) => setForm((p) => ({ ...p, barcode: e.target.value }))}
                placeholder="امسح بالسكانر أو اكتب الباركود..."
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pr-9 pl-3 py-2 text-xs font-mono font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
                dir="ltr"
              />
            </div>
          </div>

          {/* 2. اسم المنتج (إجباري) */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
              اسم المنتج *
            </label>
            <input
              ref={nameInputRef}
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="مثال: شيبس دوريتوس حار 100 غم..."
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2 text-sm font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
            />
          </div>

          {/* 3. الوحدة الأساسية + سعر البيع في صف واحد */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                الوحدة الأساسية
              </label>
              <select
                value={form.unit}
                onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-bold text-slate-800 dark:text-white focus:border-indigo-500 focus:outline-none"
              >
                <option value="قطعة">قطعة</option>
                <option value="علبة">علبة</option>
                <option value="كرتونة">كرتونة</option>
                <option value="كغم">كغم</option>
                <option value="غرام">غرام</option>
                <option value="لتر">لتر</option>
                <option value="باكيت">باكيت</option>
                <option value="بكت">بكت</option>
                <option value="طقم">طقم</option>
                <option value="شوال">شوال</option>
                <option value="حبة">حبة</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                سعر البيع (شيكل) *
              </label>
              <input
                type="number"
                step="any"
                min="0"
                required
                value={form.price}
                onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))}
                placeholder="0.00"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                dir="ltr"
              />
            </div>
          </div>

          {/* 4. قسم وحدات بيع إضافية (قابل للتوسيع) */}
          <div className="rounded-2xl border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/40 dark:bg-indigo-950/20 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Boxes size={15} className="text-indigo-600 dark:text-indigo-400" />
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  وحدات بيع إضافية (اختياري)
                </span>
                {loadingUnits && <Loader2 size={13} className="animate-spin text-indigo-500" />}
              </div>
              <button
                type="button"
                onClick={handleAddUnitRow}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 shadow-xs transition"
              >
                <Plus size={13} />
                إضافة وحدة
              </button>
            </div>

            {form.additionalUnits.length === 0 ? (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 py-0.5">
                لا توجد وحدات إضافية. اضغط «+ إضافة وحدة» لإضافة كرتونة، علبة، بكت... بنسبة تحويل وسعر خاص.
              </p>
            ) : (
              <div className="space-y-2">
                {form.additionalUnits.map((u, idx) => (
                  <div
                    key={u.id || idx}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5 space-y-2 shadow-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                        وحدة إضافية #{idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveUnitRow(u.id)}
                        className="rounded p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                        title="حذف هذه الوحدة"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">
                          اسم الوحدة *
                        </label>
                        <input
                          type="text"
                          list="unit-presets-modal"
                          required
                          value={u.unit_name}
                          onChange={(e) => handleUpdateUnitRow(u.id, 'unit_name', e.target.value)}
                          placeholder="مثال: كرتونة"
                          className="h-8 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 text-xs font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                        />
                        <datalist id="unit-presets-modal">
                          {COMMON_UNIT_PRESETS.map((preset) => (
                            <option key={preset} value={preset} />
                          ))}
                        </datalist>
                      </div>
                      <div>
                        <label
                          className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5"
                          title="كم قطعة من الوحدة الأساسية تعادل هذه الوحدة"
                        >
                          نسبة التحويل *
                        </label>
                        <input
                          type="number"
                          step="any"
                          min="0.001"
                          required
                          value={u.conversion_factor}
                          onChange={(e) => handleUpdateUnitRow(u.id, 'conversion_factor', e.target.value)}
                          placeholder="مثال: 24"
                          className="h-8 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 text-xs font-mono font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                          dir="ltr"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">
                          سعر البيع (₪) *
                        </label>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          required
                          value={u.sale_price}
                          onChange={(e) => handleUpdateUnitRow(u.id, 'sale_price', e.target.value)}
                          placeholder="0.00"
                          className="h-8 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 text-xs font-mono font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                          dir="ltr"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">
                          الباركود (اختياري)
                        </label>
                        <input
                          type="text"
                          value={u.barcode}
                          onChange={(e) => handleUpdateUnitRow(u.id, 'barcode', e.target.value)}
                          placeholder="باركود الوحدة..."
                          className="h-8 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 text-xs font-mono text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                          dir="ltr"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 5. سعر التكلفة + الكمية بالمخزون في صف واحد */}
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
                value={form.costPrice}
                onChange={(e) => setForm((p) => ({ ...p, costPrice: e.target.value }))}
                placeholder="0.00"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                dir="ltr"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                {mode === 'add' ? 'الكمية الافتتاحية بالمخزون *' : 'الكمية الحالية بالمخزون *'}
              </label>
              <input
                type="number"
                step="any"
                min="0"
                required
                value={form.stock}
                onChange={(e) => setForm((p) => ({ ...p, stock: e.target.value }))}
                placeholder="0"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm font-mono font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
                dir="ltr"
              />
            </div>
          </div>

          {/* 6. حد أدنى تنبيه المخزون + تاريخ انتهاء الصلاحية */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                حد أدنى تنبيه المخزون
              </label>
              <input
                type="number"
                step="1"
                min="0"
                value={form.minStockAlert}
                onChange={(e) => setForm((p) => ({ ...p, minStockAlert: e.target.value }))}
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
                value={form.expiryDate}
                onChange={(e) => setForm((p) => ({ ...p, expiryDate: e.target.value }))}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-mono font-bold text-slate-900 dark:text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* 7. المورد */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
              المورد (اختياري)
            </label>
            <div className="relative">
              <Truck className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
              <select
                value={form.supplierId}
                onChange={(e) => setForm((p) => ({ ...p, supplierId: e.target.value }))}
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

          {/* 8. القسم / التصنيف */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
              القسم / التصنيف (اختياري)
            </label>
            <div className="space-y-1.5">
              <input
                type="text"
                value={form.category}
                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                placeholder="اكتب القسم أو اختر من الأدنى..."
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 focus:border-indigo-500 focus:outline-none"
              />
              {/* أزرار خيارات سريعة للتصنيف */}
              <div className="flex flex-wrap gap-1 pt-1">
                {QUICK_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, category: cat }))}
                    className={`text-[10px] px-2 py-0.5 rounded-lg border transition ${
                      form.category === cat
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

          {/* مربع تأكيد الحذف عند النقر على حذف الصنف */}
          {confirmDeleteOpen && (
            <div className="rounded-2xl border border-rose-300 dark:border-rose-900/80 bg-rose-50/90 dark:bg-rose-950/40 p-3.5 space-y-2.5 transition animate-in fade-in">
              <div className="flex items-start gap-2 text-rose-700 dark:text-rose-300">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-bold">هل أنت متأكد من حذف الصنف «{form.name}» نهائياً؟</p>
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5">
                    سيتم حذف بيانات الصنف وجميع وحداته المرتبطة من المخزون، ولا يمكن التراجع عن هذه العملية.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOpen(false)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  تراجع
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleDeleteProduct}
                  className="rounded-xl bg-rose-600 hover:bg-rose-700 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition disabled:opacity-50 flex items-center gap-1"
                >
                  {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  <span>{deleting ? 'جاري الحذف...' : 'تأكيد الحذف نهائياً'}</span>
                </button>
              </div>
            </div>
          )}

          {/* أزرار الإجراءات السفلية */}
          <div className="flex items-center justify-between gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800 shrink-0">
            {mode === 'edit' ? (
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                disabled={saving || deleting}
                className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/50 py-2.5 px-3 text-xs font-bold transition flex items-center gap-1.5 shrink-0"
                title="حذف هذا الصنف من المخزون"
              >
                <Trash2 size={14} />
                <span className="hidden sm:inline">حذف الصنف</span>
              </button>
            ) : null}

            <div className="flex items-center gap-2 flex-1 justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={saving || deleting}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 py-2.5 px-4 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving || deleting}
                className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 py-2.5 px-5 text-xs font-bold text-white shadow-lg shadow-indigo-500/25 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {saving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : mode === 'add' ? (
                  <Plus size={14} />
                ) : (
                  <Check size={14} />
                )}
                <span>
                  {saving
                    ? 'جاري الحفظ...'
                    : mode === 'add'
                    ? isInventoryOnly
                      ? 'حفظ في المخزون ✓'
                      : initialBarcode
                      ? 'حفظ وإضافة للفاتورة ✓'
                      : 'حفظ في المخزون ✓'
                    : 'حفظ التعديلات ✓'}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
