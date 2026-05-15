import { useEffect, useState, useRef, useMemo } from 'react';
import { useStore } from '../context/StoreContext';
import StorageObjectImage from './StorageObjectImage';
import {
  X,
  Package,
  Barcode,
  Image as ImageIcon,
  Save,
  Loader2,
  Boxes,
  Layers,
  Link2,
  Upload,
  Shield,
  Search,
  Plus,
  Filter,
  ExternalLink,
} from 'lucide-react';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';
import {
  APPLIANCE_SIZE_FORM_OPTIONS,
  buildProductTypeSelectOptions,
  loadCustomProductTypes,
  addCustomProductType,
} from '../utils/productTypes';
import { fetchProductImageByReference, fetchProductImageCandidates } from '../utils/fetchProductImageByReference';

function normalizeBrandGroupOptions(options) {
  if (!Array.isArray(options)) return [];
  const seen = new Set();
  const out = [];
  for (const g of options) {
    const s = String(g ?? '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  out.sort((a, b) => a.localeCompare(b, 'ar'));
  return out;
}

/** كتابة عشرية آمنة في RTL — تجنّب أعطال type="number" مع dir="rtl" على الصفحة */
function handleDecimalInput(next) {
  const v = normalizeDigitsToLatin(next).replace(/,/g, '.').replace(/[^\d.]/g, '');
  if (!v) return '';
  const i = v.indexOf('.');
  if (i === -1) return v;
  return v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '');
}

function handleIntInput(next) {
  return normalizeDigitsToLatin(next).replace(/\D/g, '');
}

/**
 * نافذة إضافة/تعديل صنف — Tailwind + Lucide، متصلة بـ StoreContext وبيانات النموذج من الأب.
 */
export default function AddProductModal({
  isOpen,
  onClose,
  editingItem,
  formData,
  setFormData,
  onSubmit,
  onImageFileSelect,
  saving = false,
  brandGroupOptions = [],
}) {
  const { store } = useStore();
  const [selectedFile, setSelectedFile] = useState(null); // الملف الفعلي لرفعه عند الحفظ (يُمرَّر للأب أيضاً)
  const [previewUrl, setPreviewUrl] = useState(null); // رابط معاينة مؤقت (blob)
  const [autoImageStatus, setAutoImageStatus] = useState({ loading: false, hint: '' });
  const [imageCandidates, setImageCandidates] = useState([]);
  const [customProductTypes, setCustomProductTypes] = useState(() => loadCustomProductTypes());
  const editSessionReferenceRef = useRef('');
  const groupList = useMemo(() => normalizeBrandGroupOptions(brandGroupOptions), [brandGroupOptions]);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [groupCustomPill, setGroupCustomPill] = useState(false);
  const currentGroup = String(formData.brand_group ?? '').trim();
  const currentInGroupList = currentGroup && groupList.includes(currentGroup);
  const filteredGroupList = useMemo(() => {
    const q = groupSearchQuery.trim().toLowerCase();
    if (!q) return groupList;
    return groupList.filter((g) => String(g).toLowerCase().includes(q));
  }, [groupList, groupSearchQuery]);

  const groupPillClass = (active) =>
    `rounded-full px-3 py-1.5 text-xs font-black transition-all border ${
      active
        ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white border-violet-400/70 shadow-[0_0_22px_rgba(139,92,246,0.55)] ring-2 ring-violet-400/45 dark:from-violet-500 dark:to-purple-600 dark:shadow-[0_0_28px_rgba(167,139,250,0.5)] dark:ring-violet-300/35'
        : 'bg-white/80 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-violet-300 dark:hover:border-violet-500/50'
    }`;

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedFile(null);
      setPreviewUrl(null);
      setAutoImageStatus({ loading: false, hint: '' });
      setImageCandidates([]);
      setGroupSearchQuery('');
      setGroupCustomPill(false);
    } else {
      setCustomProductTypes(loadCustomProductTypes());
    }
  }, [isOpen]);

  const brandGroupModalKey = editingItem?.barcode ?? '__new__';
  useEffect(() => {
    if (!isOpen) return;
    const cur = String(formData.brand_group ?? '').trim();
    setGroupCustomPill(cur !== '' && !groupList.includes(cur));
  }, [isOpen, brandGroupModalKey, groupList]);

  useEffect(() => {
    if (!isOpen) return;
    editSessionReferenceRef.current = editingItem
      ? normalizeDigitsToLatin(String(editingItem.reference ?? '').trim())
      : '';
  }, [isOpen, editingItem]);

  useEffect(() => {
    if (!isOpen) return;
    const ref = normalizeDigitsToLatin(String(formData.reference ?? '').trim());
    if (ref.length < 2) {
      setAutoImageStatus({ loading: false, hint: '' });
      return;
    }
    if (editingItem && ref === editSessionReferenceRef.current) {
      setAutoImageStatus({ loading: false, hint: '' });
      return;
    }

    let cancelled = false;
    const t = setTimeout(async () => {
      setAutoImageStatus({ loading: true, hint: '' });
      const res = await fetchProductImageByReference(ref, String(formData.name ?? '').trim());
      if (cancelled) return;
      if (res.ok && res.url) {
        setFormData((p) => ({ ...p, image_url: res.url }));
        onImageFileSelect(null);
        setSelectedFile(null);
        setPreviewUrl(null);
        setAutoImageStatus({
          loading: false,
          hint:
            res.source === 'openfoodfacts'
              ? 'تم جلب صورة (Open Food Facts) حسب أرقام المرجع (باركود غذائي).'
              : res.source === 'wikimedia_commons'
                ? 'تم جلب صورة من Wikimedia Commons حسب المرجع — راجع المعاينة.'
                : 'تم جلب صورة حسب رقم المرجع — راجع المعاينة.',
        });
      } else {
        const hint =
          res.code === 'NO_SOURCE'
            ? 'لم نعثر على صورة تلقائية. تأكد من إضافة VITE_SERPAPI_KEY في .env أو جرّب مرجعاً أدق.'
            : res.code === 'SERP_EMPTY'
              ? 'بحث الصور لم يعثر على نتائج لهذا المرجع.'
              : res.code === 'SHORT_REFERENCE'
                ? ''
                : '';
        setAutoImageStatus({ loading: false, hint: hint || 'تعذر جلب صورة تلقائياً.' });
      }
    }, 650);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isOpen, formData.reference, formData.name, editingItem?.id, setFormData, onImageFileSelect]);

  /** تصفير حالة الصورة المحلية — يُستدعى بعد الإغلاق أو نجاح الحفظ */
  const resetImageState = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
  };

  if (!isOpen) return null;

  /** تحديث الحقول عبر name — معالجة خاصة للعشرية والأعداد الصحيحة */
  const handleFileChange = (e) => {
    const file = e.target.files[0]; // الحصول على أول ملف مختار

    if (file) {
      setSelectedFile(file); // حفظ الملف لعملية الـ Upload لاحقاً
    }
  };

  /** يُغلف onSubmit ليضمن تصفير الصورة بعد نجاح الحفظ */
  const handleSubmit = async (e) => {
    await onSubmit(e, selectedFile);
    resetImageState();
  };

  const handleChange = (e) => {
    const { name, value: raw } = e.target;
    const value = normalizeDigitsToLatin(raw);
    if (!name) return;
    if (name === 'price' || name === 'price_after_disc') {
      setFormData((prev) => ({ ...prev, [name]: handleDecimalInput(value) }));
      return;
    }
    if (name === 'stock_count' || name === 'warranty_months') {
      setFormData((prev) => ({ ...prev, [name]: handleIntInput(value) }));
      return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const pickBrandGroupNone = () => {
    setGroupCustomPill(false);
    setFormData((p) => ({ ...p, brand_group: '' }));
  };

  const pickBrandGroupFromList = (g) => {
    setGroupCustomPill(false);
    setFormData((p) => ({ ...p, brand_group: g }));
  };

  const pickBrandGroupCustom = () => {
    setGroupCustomPill(true);
    setFormData((p) => {
      const cur = String(p.brand_group ?? '').trim();
      return { ...p, brand_group: groupList.includes(cur) ? '' : cur };
    });
  };

  const showBrandGroupCustomInput = groupCustomPill || (!!currentGroup && !currentInGroupList);

  const handleAddNewProductType = () => {
    const name = window.prompt('اسم نوع المنتج الجديد (مثل: مكيفات):', '');
    if (name == null) return;
    const t = String(name).trim();
    if (!t) return;
    const next = addCustomProductType(t);
    setCustomProductTypes(next);
    setFormData((p) => ({ ...p, product_type: t }));
  };

  const handleFetchImageByReferenceManual = async () => {
    const ref = normalizeDigitsToLatin(String(formData.reference ?? '').trim());
    if (ref.length < 2) {
      setAutoImageStatus({ loading: false, hint: 'أدخل مرجعاً واضحاً (حرفان على الأقل) ثم أعد المحاولة.' });
      return;
    }
    setAutoImageStatus({ loading: true, hint: '' });
    setImageCandidates([]);
    const candidates = await fetchProductImageCandidates(ref, String(formData.name ?? '').trim());
    if (candidates.length > 0) {
      const first = candidates[0];
      setFormData((p) => ({ ...p, image_url: first.url }));
      onImageFileSelect(null);
      setSelectedFile(null);
      setPreviewUrl(null);
      setImageCandidates(candidates);
      setAutoImageStatus({
        loading: false,
        hint: candidates.length > 1
          ? `تم العثور على ${candidates.length} صور — الأولى محددة تلقائياً.`
          : 'تم جلب صورة حسب رقم المرجع.',
      });
    } else {
      setAutoImageStatus({ loading: false, hint: 'لم يعثر Google على صور لهذا المرجع. جرّب مرجعاً أدق (موديل + ماركة).' });
    }
  };

  const handlePickCandidate = (candidate) => {
    setFormData((p) => ({ ...p, image_url: candidate.url }));
    onImageFileSelect(null);
    setSelectedFile(null);
    setPreviewUrl(null);
  };


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-arabic" dir="rtl">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={() => !saving && onClose()}
        aria-hidden
      />

      <div
        className="relative bg-white/80 dark:bg-gray-900/50 backdrop-blur-md border border-white/20 dark:border-gray-700/30 w-full max-w-2xl max-h-[92vh] flex flex-col rounded-[32px] shadow-2xl overflow-hidden transition-all duration-300"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-product-modal-title"
      >
        {/* الهيدر */}
        <div className="flex-shrink-0 p-6 border-b border-slate-100 dark:border-gray-700/40 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shrink-0">
              <Package size={20} />
            </div>
            <div className="min-w-0">
              <h3
                id="add-product-modal-title"
                className="text-xl font-black text-gray-900 dark:text-white truncate"
              >
                {editingItem ? 'تعديل الصنف' : 'إضافة صنف جديد'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {store?.name
                  ? `يُحفظ في مخزن ${store.name}`
                  : 'أدخل تفاصيل المنتج'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-2 hover:bg-slate-200 rounded-full transition-colors shrink-0 disabled:opacity-50"
            aria-label="إغلاق"
          >
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        {/* الفورم — قابل للتمرير */}
        <form
          onSubmit={handleSubmit}
          className="p-6 sm:p-8 space-y-6 overflow-y-auto flex-1 min-h-0"
          aria-busy={saving}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="sm:col-span-2 space-y-2">
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-200">اسم المنتج</label>
              <div className="relative">
                <input
                  type="text"
                  name="name"
                  placeholder="مثال: ثلاجة KMG"
                  required
                  value={formData.name ?? ''}
                  onChange={handleChange}
                  className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all pr-12 text-gray-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
                <Package className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={20} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-200">الباركود</label>
              <div className="relative">
                <input
                  type="text"
                  name="barcode"
                  placeholder="000000"
                  required
                  value={formData.barcode}
                  onChange={handleChange}
                  disabled={!!editingItem}
                  dir="ltr"
                  lang="en"
                  className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all pr-12 font-currency text-left text-gray-900 dark:text-white placeholder:text-slate-400 disabled:opacity-60"
                />
                <Barcode className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={20} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-200">المرجع</label>
              <div className="relative">
                <input
                  type="text"
                  name="reference"
                  placeholder="رقم أو كود المرجع"
                  value={formData.reference ?? ''}
                  onChange={handleChange}
                  dir="ltr"
                  lang="en"
                  className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all pr-12 font-currency text-left text-gray-900 dark:text-white placeholder:text-slate-400"
                />
                <Link2 className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={20} />
              </div>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <Filter size={16} className="text-violet-500 shrink-0" />
                المجموعة
              </label>
              <div className="rounded-xl border border-white/20 bg-white/25 p-2 dark:border-white/5 dark:bg-white/[0.04]">
                {groupList.length > 0 && (
                  <div className="relative mb-2">
                    <Search
                      className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                      aria-hidden
                    />
                    <input
                      type="search"
                      value={groupSearchQuery}
                      onChange={(e) => setGroupSearchQuery(e.target.value)}
                      placeholder="ابحث عن مجموعة…"
                      className="w-full rounded-xl border border-white/25 bg-white/50 py-2 pr-8 pl-2 text-xs font-bold text-slate-800 placeholder:text-slate-400 focus:border-indigo-400/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-white/10 dark:bg-slate-800/50 dark:text-white dark:placeholder:text-slate-500"
                      dir="rtl"
                      autoComplete="off"
                    />
                  </div>
                )}
                <div className="max-h-[min(200px,44vh)] space-y-2 overflow-y-auto">
                  <div className="flex flex-wrap gap-2" dir="rtl">
                    <button
                      type="button"
                      aria-pressed={!currentGroup && !groupCustomPill}
                      onClick={pickBrandGroupNone}
                      disabled={saving}
                      className={groupPillClass(!currentGroup && !groupCustomPill)}
                    >
                      بدون مجموعة
                    </button>
                    <button
                      type="button"
                      aria-pressed={showBrandGroupCustomInput}
                      onClick={pickBrandGroupCustom}
                      disabled={saving}
                      className={groupPillClass(showBrandGroupCustomInput)}
                    >
                      كتابة يدوية
                    </button>
                  </div>
                  {groupList.length > 0 && (
                    <div className="flex flex-wrap gap-2 border-t border-white/15 pt-2 dark:border-white/5" dir="rtl">
                      {filteredGroupList.length === 0 ? (
                        <p className="w-full py-2 text-center text-xs font-bold text-slate-400 dark:text-slate-500">
                          لا توجد مجموعات مطابقة
                        </p>
                      ) : (
                        filteredGroupList.map((g) => (
                          <button
                            key={g}
                            type="button"
                            aria-pressed={currentGroup === g}
                            onClick={() => pickBrandGroupFromList(g)}
                            disabled={saving}
                            className={groupPillClass(currentGroup === g)}
                          >
                            {g}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
              {showBrandGroupCustomInput ? (
                <div className="relative">
                  <input
                    type="text"
                    name="brand_group"
                    placeholder="اكتب اسم المجموعة"
                    value={formData.brand_group}
                    onChange={handleChange}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all pr-12 text-gray-900 dark:text-white placeholder:text-slate-400"
                  />
                  <Layers className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={20} />
                </div>
              ) : null}
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                نفس أسلوب «تصفية سريعة» في المخزن — اضغط مجموعة واحدة أو «كتابة يدوية» لاسم جديد.
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-200">سعر البيع (₪)</label>
              <div className="relative">
                <input
                  type="text"
                  name="price"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  required
                  value={String(formData.price ?? '')}
                  onChange={handleChange}
                  dir="ltr"
                  lang="en"
                  className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all pr-12 font-currency text-gray-900 dark:text-white placeholder:text-slate-400"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-currency text-lg pointer-events-none" lang="en">
                  ₪
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-200">بعد الخصم (₪)</label>
              <div className="relative">
                <input
                  type="text"
                  name="price_after_disc"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={String(formData.price_after_disc ?? '')}
                  onChange={handleChange}
                  dir="ltr"
                  lang="en"
                  className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all pr-12 font-currency text-gray-900 dark:text-white placeholder:text-slate-400"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-currency text-lg pointer-events-none" lang="en">
                  ₪
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-200">الكمية (المخزون)</label>
              <div className="relative">
                <input
                  type="text"
                  name="stock_count"
                  inputMode="numeric"
                  autoComplete="off"
                  value={String(formData.stock_count ?? '')}
                  onChange={handleChange}
                  dir="ltr"
                  lang="en"
                  className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all pr-12 font-currency text-gray-900 dark:text-white placeholder:text-slate-400"
                />
                <Boxes className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={20} />
              </div>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <Shield size={16} className="text-violet-500 shrink-0" />
                مدة الضمان (بالأشهر)
              </label>
              <input
                type="text"
                name="warranty_months"
                inputMode="numeric"
                autoComplete="off"
                placeholder="مثال: 12 — اتركه فارغاً أو 0 إن لم يكن هناك ضمان"
                value={String(formData.warranty_months ?? '')}
                onChange={handleChange}
                dir="ltr"
                lang="en"
                className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-currency text-gray-900 dark:text-white placeholder:text-slate-400"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                تُستخدم لحساب «حالة الضمان» في حركات المبيعات من تاريخ الفاتورة.
              </p>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <Layers size={16} className="text-indigo-500 shrink-0" />
                نوع المنتج
              </label>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-stretch">
                <select
                  name="product_type"
                  value={String(formData.product_type ?? '')}
                  onChange={handleChange}
                  className="w-full min-w-0 flex-1 p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-gray-900 dark:text-white"
                >
                  {buildProductTypeSelectOptions(customProductTypes, formData.product_type).map(
                    (o) => (
                      <option key={o.value || '_empty'} value={o.value}>
                        {o.label}
                      </option>
                    )
                  )}
                </select>
                <button
                  type="button"
                  onClick={handleAddNewProductType}
                  disabled={saving}
                  className="shrink-0 inline-flex items-center justify-center gap-2 rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 px-4 py-3 text-sm font-black text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-all disabled:opacity-50 whitespace-nowrap"
                >
                  <Plus size={18} strokeWidth={2.5} />
                  إضافة نوع جديد
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                اختر نوعاً جاهزاً أو أضف اسماً جديداً (يُحفظ في قائمتك على هذا المتصفح). القيم الغريبة من Excel — مثل Sheet1 — تظهر كـ «قيمة حالية» حتى تستبدلها.
              </p>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <Layers size={16} className="text-amber-600 shrink-0" />
                حجم القطعة (صغيرة / كبيرة)
              </label>
              <select
                name="appliance_size"
                value={String(formData.appliance_size ?? '')}
                onChange={handleChange}
                className="w-full p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-gray-900 dark:text-white"
              >
                {APPLIANCE_SIZE_FORM_OPTIONS.map((o) => (
                  <option key={o.value || '_empty'} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                مستقل عن «نوع المنتج» (تلفزيون، غسالة، …) — للتصنيف المنزلي مقابل الكبير.
              </p>
            </div>
          </div>

          {/* الصورة — تُرفع إلى Storage عند «حفظ» (مسار: مجلد المتجر / اسم فريد) */}
          <div className="space-y-4">
            <label className="block text-[14px] font-black text-slate-700 dark:text-slate-200">صورة المنتج</label>

            <div className="flex items-center gap-6 p-4 bg-slate-50 dark:bg-slate-800/30 rounded-3xl border border-slate-100 dark:border-gray-700/40">
              {/* مربع المعاينة */}
              <div className="w-28 h-28 bg-white/80 dark:bg-gray-900/50 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-600 flex items-center justify-center overflow-hidden shadow-inner shrink-0">
                {previewUrl ? (
                  <img src={previewUrl} className="w-full h-full object-cover" alt="Preview" />
                ) : formData.image_url?.trim() ? (
                  <StorageObjectImage
                    srcValue={formData.image_url}
                    className="w-full h-full object-cover"
                    iconSize={32}
                  />
                ) : (
                  <div className="text-center text-slate-400">
                    <ImageIcon size={32} className="mx-auto mb-1 opacity-20" />
                    <span className="text-[10px] font-bold">لا توجد صورة</span>
                  </div>
                )}
              </div>

              {/* أزرار الاختيار */}
              <div className="flex-1 flex flex-col gap-2">
                <p className="text-xs text-slate-500 font-bold">يفضل أن تكون الصورة مربعة وبحجم أقل من 2MB</p>
                <label
                  className={`cursor-pointer inline-flex items-center gap-2 bg-white/80 dark:bg-gray-900/50 border border-white/20 dark:border-gray-700/30 px-4 py-2 rounded-xl text-sm font-black text-gray-900 dark:text-white hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-600 hover:border-indigo-200 transition-all shadow-sm ${
                    saving || !store?.id ? 'opacity-50 pointer-events-none' : ''
                  }`}
                >
                  <Upload size={16} />
                  اختيار من الجهاز
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*"
                    disabled={saving || !store?.id}
                    onChange={handleFileChange}
                  />
                </label>

                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                  يُجلب رابط الصورة تلقائياً من الإنترنت باستخدام <strong className="text-slate-700 dark:text-slate-200">رقم المرجع</strong> بعد حوالي ثانية من توقف الكتابة — دون فتح نافذة Google.
                </p>
                {(autoImageStatus.loading || autoImageStatus.hint) && (
                  <div className="flex items-start gap-2 text-[11px] rounded-xl bg-slate-100/90 dark:bg-slate-800/80 px-3 py-2 border border-slate-200/80 dark:border-slate-600/50">
                    {autoImageStatus.loading ? (
                      <Loader2 size={14} className="animate-spin text-indigo-500 shrink-0 mt-0.5" />
                    ) : null}
                    <span className={`text-slate-600 dark:text-slate-300 ${autoImageStatus.loading ? 'font-bold' : ''}`}>
                      {autoImageStatus.loading ? 'جاري جلب صورة حسب المرجع…' : autoImageStatus.hint}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleFetchImageByReferenceManual()}
                    disabled={
                      saving ||
                      autoImageStatus.loading ||
                      normalizeDigitsToLatin(String(formData.reference ?? '').trim()).length < 2
                    }
                    className="inline-flex items-center gap-2 bg-white/80 dark:bg-gray-900/50 border border-white/20 dark:border-gray-700/30 px-4 py-2 rounded-xl text-sm font-black text-slate-700 dark:text-white hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all shadow-sm disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <Search size={16} />
                    إعادة جلب صورة بالمرجع
                  </button>
                  {normalizeDigitsToLatin(String(formData.reference ?? '').trim()).length >= 2 && (
                    <a
                      href={`https://www.google.com/search?q=${encodeURIComponent(
                        (formData.name ? formData.name + ' ' : '') +
                          normalizeDigitsToLatin(String(formData.reference ?? '').trim())
                      )}&tbm=isch`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 bg-white/80 dark:bg-gray-900/50 border border-white/20 dark:border-gray-700/30 px-4 py-2 rounded-xl text-sm font-black text-slate-700 dark:text-white hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 transition-all shadow-sm"
                    >
                      <ExternalLink size={16} />
                      بحث Google للصور
                    </a>
                  )}
                </div>

                {formData.image_url?.trim() && (
                  <button
                    type="button"
                    onClick={() => setFormData((p) => ({ ...p, image_url: '' }))}
                    className="text-[11px] text-red-400 hover:text-red-600 font-bold text-right"
                  >
                    × حذف الصورة الحالية
                  </button>
                )}
                {!store?.id && (
                  <p className="text-[11px] text-amber-600">يتطلب وجود متجر مرتبط بالحساب.</p>
                )}
              </div>
            </div>


            {/* شبكة نتائج Google CSE */}
            {imageCandidates.length > 1 && (
              <div className="space-y-2">
                <p className="text-[11px] font-black text-slate-600 dark:text-slate-300">
                  اختر صورة من نتائج Google
                </p>
                <div className="grid grid-cols-5 gap-1.5">
                  {imageCandidates.map((c, i) => {
                    const isSelected = formData.image_url === c.url;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handlePickCandidate(c)}
                        className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all ${
                          isSelected
                            ? 'border-indigo-500 ring-2 ring-indigo-300 dark:ring-indigo-700 scale-105 shadow-lg'
                            : 'border-slate-200 dark:border-slate-600 hover:border-indigo-300 hover:scale-105'
                        }`}
                        title={`صورة ${i + 1}`}
                      >
                        <img
                          src={c.thumb || c.url}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                        {isSelected && (
                          <div className="absolute inset-0 bg-indigo-600/20 flex items-center justify-center">
                            <div className="bg-indigo-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-black">✓</div>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {/* حقل رابط الصورة — للصق رابط من Google Images */}
            <div className="relative">
              <input
                type="text"
                name="image_url"
                placeholder="الصق رابط الصورة هنا (https://...)"
                value={formData.image_url ?? ''}
                onChange={(e) => {
                  setFormData((p) => ({ ...p, image_url: e.target.value }));
                  setPreviewUrl(null);
                }}
                dir="ltr"
                lang="en"
                className={`w-full p-3 bg-slate-50 dark:bg-slate-800/50 border rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all pr-10 text-sm font-currency text-gray-900 dark:text-white placeholder:text-slate-400 ${
                  autoImageStatus.hint && !autoImageStatus.hint.startsWith('تم') && !autoImageStatus.loading
                    ? 'border-orange-300 dark:border-orange-600 ring-1 ring-orange-200 dark:ring-orange-900/50'
                    : 'border-slate-200 dark:border-slate-600'
                }`}
              />
              <Link2 className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
            </div>
          </div>

          {/* أزرار */}
          <div className="flex flex-col-reverse sm:flex-row gap-3 sm:gap-4 pt-4 border-t border-slate-100 dark:border-gray-700/40">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="sm:px-8 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all disabled:opacity-50"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-indigo-600 text-white py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-indigo-700 shadow-lg shadow-indigo-200/80 transition-all active:scale-[0.98] disabled:opacity-70 disabled:pointer-events-none"
            >
              {saving ? (
                <Loader2 size={20} className="animate-spin shrink-0" />
              ) : (
                <Save size={20} />
              )}
              {saving ? 'جاري الحفظ…' : editingItem ? 'حفظ التعديلات' : 'حفظ المنتج في النظام'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
