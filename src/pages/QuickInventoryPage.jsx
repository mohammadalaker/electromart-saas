import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  ScanLine,
  MapPin,
  Package,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useStore } from '../context/StoreContext';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';
import { roundMoney } from '../utils/productModel';
import {
  applyPhysicalCount,
  fetchStockByLocation,
  lookupProductByBarcode,
} from '../utils/quickInventory';
import { useBarcodeScannerMode } from '../lib/barcodeInputPrefs';

export default function QuickInventoryPage() {
  const { store, loading: storeLoading } = useStore();
  const barcodeScannerMode = useBarcodeScannerMode();
  const [barcodeInput, setBarcodeInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [product, setProduct] = useState(null);
  const [rawRow, setRawRow] = useState(null);
  const [locRows, setLocRows] = useState([]);
  const [locMissing, setLocMissing] = useState(false);
  const [countInput, setCountInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [successMsg, setSuccessMsg] = useState(null);
  const inputRef = useRef(null);

  const focusScan = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    if (!storeLoading && store?.id && barcodeScannerMode) focusScan();
  }, [storeLoading, store?.id, barcodeScannerMode, focusScan]);

  const loadLocations = useCallback(
    async (productId) => {
      if (!store?.id || !productId) {
        setLocRows([]);
        setLocMissing(false);
        return;
      }
      const { rows, missingTable } = await fetchStockByLocation(store.id, productId);
      setLocRows(rows);
      setLocMissing(!!missingTable);
    },
    [store?.id]
  );

  const runLookup = async (e) => {
    e?.preventDefault();
    setSuccessMsg(null);
    const raw = normalizeDigitsToLatin(String(barcodeInput).trim());
    if (!store?.id || !raw) {
      setErr('أدخل باركوداً أو امسح القطعة.');
      return;
    }
    setLoading(true);
    setErr(null);
    setProduct(null);
    setRawRow(null);
    setLocRows([]);
    setLocMissing(false);
    try {
      const { product: p, raw, error } = await lookupProductByBarcode(store.id, raw);
      if (error) throw error;
      if (!p || !raw) {
        setErr('لا يوجد صنف بهذا الباركود في هذا المتجر.');
        setCountInput('');
        return;
      }
      setProduct(p);
      setRawRow(raw);
      const stockN = roundMoney(Number(p.stock ?? 0));
      setCountInput(String(stockN));
      await loadLocations(raw.id);
    } catch (ex) {
      console.error(ex);
      setErr(ex.message || 'فشل البحث');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyCount = async () => {
    if (!store?.id || !rawRow || !product) return;
    const prev = roundMoney(Number(product.stock ?? 0));
    const next = roundMoney(parseFloat(String(countInput).replace(',', '.')) || 0);
    if (Number.isNaN(next) || next < 0) {
      setErr('أدخل كمية رقمية صحيحة.');
      return;
    }
    if (next === prev) {
      setErr('الكمية مطابقة لرصيد النظام — لا حاجة للحفظ.');
      return;
    }
    if (!window.confirm(`تأكيد: تغيير الرصيد من ${prev} إلى ${next}؟`)) return;

    setSaving(true);
    setErr(null);
    setSuccessMsg(null);
    try {
      const updatedNorm = await applyPhysicalCount(store.id, rawRow, prev, next);
      const { raw: newRaw, product: p2 } = await lookupProductByBarcode(store.id, updatedNorm.barcode);
      setProduct(p2 || updatedNorm);
      setRawRow(newRaw || rawRow);
      const merged = p2 || updatedNorm;
      setCountInput(String(roundMoney(Number(merged.stock ?? 0))));
      await loadLocations((newRaw || rawRow).id);
      setSuccessMsg('تم حفظ التصحيح وتحديث المخزن.');
      if (autoNext) {
        setBarcodeInput('');
        setProduct(null);
        setRawRow(null);
        setLocRows([]);
        setCountInput('');
        setSuccessMsg(null);
        if (barcodeScannerMode) focusScan();
      }
    } catch (ex) {
      console.error(ex);
      setErr(ex.message || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  if (storeLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24" dir="rtl">
          <Loader2 className="animate-spin text-indigo-500" size={40} />
        </div>
      </DashboardLayout>
    );
  }

  if (!store?.id) {
    return (
      <DashboardLayout>
        <div className="max-w-lg mx-auto rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center font-bold" dir="rtl">
          لا يوجد متجر مرتبط بحسابك.
        </div>
      </DashboardLayout>
    );
  }

  const stockNum = product ? roundMoney(Number(product.stock ?? 0)) : 0;
  const sell = product ? roundMoney(Number(product.priceAfterDiscount ?? product.price ?? 0)) : 0;
  const listPrice = product ? roundMoney(Number(product.price ?? 0)) : 0;

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap gap-2 items-center">
          <Link
            to="/inventory"
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 text-xs font-black text-slate-700 dark:text-slate-200"
          >
            <ArrowRight size={16} className="rotate-180" />
            لوحة المخزن
          </Link>
          <Link
            to="/pos"
            className="text-xs font-bold text-violet-600 dark:text-violet-400 hover:underline"
          >
            POS
          </Link>
        </div>
      }
    >
      <div className="max-w-lg mx-auto space-y-4 pb-12 px-1 sm:px-0" dir="rtl">
        <div className="rounded-2xl border border-white/20 dark:border-gray-700/30 bg-white/80 dark:bg-gray-900/50 backdrop-blur-md p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-md">
              <ClipboardCheck size={24} strokeWidth={2.25} />
            </div>
            <div>
              <h1 className="text-lg font-black text-gray-900 dark:text-white">الجرد السريع</h1>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
                {barcodeScannerMode
                  ? 'امسح الباركود بقارئ أو اكتبه — يظهر الرصيد والمواقع. يمكنك تسجيل العد الفعلي للجرد.'
                  : 'اضغط على الحقل أدناه ثم أدخل الباركود يدوياً — يظهر الرصيد والمواقع. غيّر الوضع من إعدادات النظام إن استخدمت قارئاً.'}
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={runLookup} className="space-y-3">
          <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400">
            {barcodeScannerMode ? 'مسح الباركود (قارئ)' : 'الباركود (يدوي)'}
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <ScanLine className="absolute right-3 top-1/2 -translate-y-1/2 text-teal-600 dark:text-teal-400" size={22} />
              <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={
                  barcodeScannerMode
                    ? 'امسح بقارئ أو اكتب ثم Enter'
                    : 'اضغط هنا ثم اكتب الباركود و Enter'
                }
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(normalizeDigitsToLatin(e.target.value))}
                className="w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950/40 py-4 pr-12 pl-4 text-lg font-black font-mono tracking-wide text-slate-900 dark:text-white placeholder:text-slate-400 shadow-inner"
                dir="ltr"
                lang="en"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="shrink-0 rounded-2xl bg-teal-600 text-white px-5 py-3 text-sm font-black shadow-md disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={22} /> : 'بحث'}
            </button>
          </div>
        </form>

        {err && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-900/50 px-4 py-3 text-sm font-bold text-rose-800 dark:text-rose-200 flex gap-2 items-start">
            <AlertTriangle className="shrink-0 mt-0.5" size={18} />
            <span>{err}</span>
          </div>
        )}

        {successMsg && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 dark:bg-emerald-950/30 dark:border-emerald-800/50 px-4 py-3 text-sm font-bold text-emerald-900 dark:text-emerald-100 flex gap-2 items-center">
            <CheckCircle2 size={18} className="shrink-0" />
            {successMsg}
          </div>
        )}

        {product && rawRow && (
          <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-900/40 overflow-hidden shadow-sm">
            <div className="p-4 space-y-3 border-b border-slate-100 dark:border-white/10">
              <div className="flex items-start gap-2">
                <Package className="text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" size={20} />
                <div className="min-w-0">
                  <p className="font-black text-slate-900 dark:text-white text-base leading-snug">
                    {product.name || '—'}
                  </p>
                  <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1" dir="ltr">
                    {product.barcode}
                  </p>
                  {product.group ? (
                    <span className="inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300">
                      {product.group}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 dark:bg-white/5 p-3">
                  <p className="text-[10px] font-black text-slate-500 dark:text-slate-400">الكمية المتوفرة</p>
                  <p className="text-2xl font-black font-currency text-teal-700 dark:text-teal-300 mt-1" dir="ltr">
                    {stockNum}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-white/5 p-3">
                  <p className="text-[10px] font-black text-slate-500 dark:text-slate-400">سعر البيع</p>
                  <p className="text-xl font-black font-currency text-indigo-700 dark:text-indigo-300 mt-1" dir="ltr">
                    ₪{sell.toFixed(2)}
                  </p>
                  {listPrice !== sell && listPrice > 0 ? (
                    <p className="text-[10px] text-slate-400 line-through font-currency mt-0.5" dir="ltr">
                      ₪{listPrice.toFixed(2)}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="p-4 space-y-2">
              <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <MapPin size={12} className="shrink-0" />
                أماكن التخزين
              </p>
              {locMissing ? (
                <p className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 rounded-lg px-3 py-2">
                  جداول المواقع غير مفعّلة — الرصيد يظهر من المخزن العام فقط. نفّذ ملفات{' '}
                  <code className="text-[10px]">store_locations.sql</code> و{' '}
                  <code className="text-[10px]">product_stock_locations.sql</code> عند الحاجة.
                </p>
              ) : locRows.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">لا يوجد توزيع مواقع — الكل في المخزن.</p>
              ) : (
                <ul className="space-y-2">
                  {locRows.map((r) => (
                    <li
                      key={`${r.code}-${r.name}`}
                      className="flex justify-between items-center rounded-xl border border-slate-100 dark:border-white/10 px-3 py-2.5 text-sm"
                    >
                      <span className="font-bold text-slate-800 dark:text-slate-200">{r.name}</span>
                      <span className="font-currency font-black text-slate-900 dark:text-white" dir="ltr">
                        {r.qty}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="p-4 bg-slate-50/90 dark:bg-black/20 border-t border-slate-100 dark:border-white/10 space-y-3">
              <p className="text-sm font-black text-slate-800 dark:text-slate-100">تصحيح الجرد (العد الفعلي)</p>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                إذا كان العدّ اليدوي يختلف عن رصيد النظام، أدخل الكمية الفعلية ثم احفظ. يُسجَّل السبب كـ «تعديل» في
                سجل المخزن.
              </p>
              <input
                type="text"
                inputMode="decimal"
                value={countInput}
                onChange={(e) => setCountInput(e.target.value.replace(/[^\d.,]/g, ''))}
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950/50 px-4 py-3 text-lg font-black font-currency text-center"
                dir="ltr"
                lang="en"
                placeholder="الكمية الموجودة فعلياً"
              />
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoNext}
                  onChange={(e) => setAutoNext(e.target.checked)}
                  className="rounded border-slate-300"
                />
                بعد الحفظ: مسح الباركود للقطعة التالية (جرد متواصل)
              </label>
              <button
                type="button"
                onClick={handleApplyCount}
                disabled={saving}
                className="w-full rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3.5 text-sm shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
                تطبيق التصحيح على المخزن
              </button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
