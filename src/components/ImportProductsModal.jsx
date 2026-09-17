import React, { useState, useCallback, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  X,
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Table2,
  Percent,
  Layers,
  ArrowRight,
  Check,
  RefreshCw,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';

const BATCH_SIZE = 500;

/**
 * تنظيف وتحويل الباركود لتجنب الصيغ العلمية أو فقدان الأصفار
 */
function parseBarcodeSafe(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number') {
    return Number.isInteger(val) ? String(val) : String(Math.round(val));
  }
  let s = normalizeDigitsToLatin(String(val)).trim();
  if (!s) return null;
  // في حال تحول الرقم الكبير إلى صيغة علمية مثل 6.2811E+12
  if (/^[0-9.]+[eE][+-]?[0-9]+$/.test(s)) {
    try {
      const num = Number(s);
      if (!Number.isNaN(num)) {
        return BigInt(Math.round(num)).toString();
      }
    } catch {
      /* fallback to string */
    }
  }
  return s;
}

/**
 * استخراج رقم عشري آمن
 */
function parseNumSafe(val) {
  if (val == null || val === '') return 0;
  const s = normalizeDigitsToLatin(String(val).replace(/,/g, '')).trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/**
 * احتساب سعر البيع بناءً على التكلفة ونسبة الربح
 */
function calculateSalePrice(costPrice, marginPercent) {
  const cost = Math.max(0, Number(costPrice) || 0);
  const margin = Number(marginPercent) || 0;
  const price = cost * (1 + margin / 100);
  return Math.round(price * 100) / 100;
}

export default function ImportProductsModal({ storeId, onClose, onImported }) {
  // المراحل: 'upload' (اختيار ومعاينة), 'importing' (جاري المعالجة), 'summary' (الملخص)
  const [stage, setStage] = useState('upload');
  const [file, setFile] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);
  const [profitMargin, setProfitMargin] = useState(20);
  const [parseError, setParseError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  // إحصائيات وتقدم المعالجة
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [importSummary, setImportSummary] = useState({ success: 0, failed: 0, errors: [] });

  const fileInputRef = useRef(null);

  const [loadingPreloaded, setLoadingPreloaded] = useState(false);

  /**
   * قراءة ملف الإكسل ومعالجة الأعمدة الـ 7
   * الترتيب المتوقع:
   * 0: اسم الصنف
   * 1: رصيد الصنف
   * 2: الوحدة
   * 3: معدل السعر
   * 4: اجمالي
   * 5: اّخر سعر شراء
   * 6: باركود
   */
  const handleProcessFile = useCallback(async (selectedFile) => {
    if (!selectedFile) return;
    setParseError(null);
    setFile(selectedFile);

    try {
      const buffer = await selectedFile.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const wsName = wb.SheetNames[0];
      const ws = wb.Sheets[wsName];
      if (!ws) throw new Error('الملف لا يحتوي على أوراق عمل صالحة.');

      // جلب جميع الصفوف كمصفوفة مصفوفات (2D Array)
      const rawGrid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      if (rawGrid.length < 2) {
        throw new Error('الملف لا يحتوي على بيانات كافية (يجب توفر صف عناوين وصف بيانات واحد على الأقل).');
      }

      // البحث التلقائي عن صف العناوين لتجاوز أي أسطر فارغة سابقة في ملف الإكسل
      let headerIndex = -1;
      for (let i = 0; i < Math.min(10, rawGrid.length); i++) {
        const r = rawGrid[i];
        if (!Array.isArray(r)) continue;
        const isHeader = r.some((c) => {
          const s = String(c || '').trim();
          return s.includes('اسم الصنف') || s.includes('رصيد الصنف') || s.includes('باركود') || s.includes('سعر شراء');
        });
        if (isHeader) {
          headerIndex = i;
          break;
        }
      }

      const startRowIndex = headerIndex >= 0 ? headerIndex + 1 : 1;
      const dataRows = rawGrid.slice(startRowIndex);
      const items = [];

      for (let r = 0; r < dataRows.length; r++) {
        const row = dataRows[r];
        if (!Array.isArray(row)) continue;

        const name = String(row[0] ?? '').trim();
        const barcode = parseBarcodeSafe(row[6]);

        // تجاهل تكرار سطر العناوين إن وجد
        if (name === 'اسم الصنف' || barcode === 'باركود') continue;

        const stockCount = parseNumSafe(row[1]);
        const unit = String(row[2] ?? '').trim() || 'قطعة';
        const avgPrice = parseNumSafe(row[3]);
        const purchasePrice = parseNumSafe(row[5]);

        // تجاهل الصفوف الفارغة تماماً
        if (!name && !barcode && stockCount === 0 && purchasePrice === 0) {
          continue;
        }

        items.push({
          rowNumber: startRowIndex + r + 1, // رقم الصف الفعلي في ملف الإكسل
          name: name || 'صنف بدون اسم',
          barcode: barcode || null,
          stockCount,
          unit,
          avgPrice: avgPrice || purchasePrice,
          purchasePrice,
        });
      }

      if (items.length === 0) {
        throw new Error('لم يتم العثور على أي صفوف بيانات صالحة في الملف.');
      }

      setParsedRows(items);
    } catch (err) {
      console.error('[ImportProductsModal] parse error:', err);
      setParseError(err.message || 'فشل في قراءة ملف الإكسل.');
      setParsedRows([]);
    }
  }, []);

  /**
   * تحميل ملف كشف ارصدة المخزون المرفق بالنظام مباشرة
   */
  const handleLoadPreloaded = async () => {
    setLoadingPreloaded(true);
    setParseError(null);
    try {
      const res = await fetch('/كشف%20ارصدة%20المخزون.xlsx');
      if (!res.ok) throw new Error('تعذر تحميل الملف مباشرة من مجلد المشروع.');
      const blob = await res.blob();
      const preloadedFile = new File([blob], 'كشف ارصدة المخزون.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      await handleProcessFile(preloadedFile);
    } catch (err) {
      console.error('[ImportProductsModal] preload error:', err);
      setParseError(err.message || 'فشل في تحميل الملف التلقائي.');
    } finally {
      setLoadingPreloaded(false);
    }
  };

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer?.files?.[0];
      if (dropped) {
        handleProcessFile(dropped);
      }
    },
    [handleProcessFile]
  );

  // معاينة أول 10 صفوف مع سعر البيع المحسوب بنسبة الربح الحالية
  const previewRows = useMemo(() => {
    return parsedRows.slice(0, 10).map((row) => ({
      ...row,
      salePrice: calculateSalePrice(row.purchasePrice, profitMargin),
    }));
  }, [parsedRows, profitMargin]);

  /**
   * تنفيذ استيراد جميع الأصناف على دفعات بحجم 500 صف
   */
  const handleExecuteImport = async () => {
    if (!storeId || parsedRows.length === 0) return;

    setStage('importing');
    const total = parsedRows.length;
    setProgress({ current: 0, total, percent: 0 });

    let successCount = 0;
    let failedCount = 0;
    const errorsList = [];

    const margin = Number(profitMargin) || 0;

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const batchSlice = parsedRows.slice(i, i + BATCH_SIZE);

      // بناء السجلات مع إلغاء تكرار الباركود داخل نفس الدفعة
      const seenInBatch = new Set();
      const recordsToInsert = [];
      for (let j = batchSlice.length - 1; j >= 0; j--) {
        const item = batchSlice[j];
        if (item.barcode) {
          if (seenInBatch.has(item.barcode)) continue;
          seenInBatch.add(item.barcode);
        }
        const salePrice = calculateSalePrice(item.purchasePrice, margin);
        recordsToInsert.unshift({
          eng_name: item.name,
          barcode: item.barcode,
          stock_count: Math.round(item.stockCount || 0),
          purchase_price: item.purchasePrice,
          last_purchase_price: item.purchasePrice,
          avg_purchase_price: item.avgPrice || item.purchasePrice,
          full_price: salePrice,
          price_after_disc: salePrice,
          store_id: storeId,
        });
      }

      try {
        const { error } = await supabase
          .from(PRODUCTS_TABLE)
          .upsert(recordsToInsert, { onConflict: 'store_id,barcode' });

        if (error) {
          console.error(`[ImportProductsModal] Batch ${i}-${i + batchSlice.length} error:`, error);
          failedCount += batchSlice.length;
          errorsList.push({
            batch: `${i + 1} - ${Math.min(i + batchSlice.length, total)}`,
            message: error.message || 'خطأ أثناء الإدخال في قاعدة البيانات',
          });
        } else {
          successCount += batchSlice.length;
        }
      } catch (err) {
        console.error(`[ImportProductsModal] Batch ${i} exception:`, err);
        failedCount += batchSlice.length;
        errorsList.push({
          batch: `${i + 1} - ${Math.min(i + batchSlice.length, total)}`,
          message: err.message || 'خطأ غير متوقع في الشبكة',
        });
      }

      const currentProcessed = Math.min(i + batchSlice.length, total);
      const percent = Math.round((currentProcessed / total) * 100);
      setProgress({ current: currentProcessed, total, percent });
    }

    setImportSummary({
      success: successCount,
      failed: failedCount,
      errors: errorsList,
    });
    setStage('summary');
  };

  const handleReset = () => {
    setStage('upload');
    setFile(null);
    setParsedRows([]);
    setParseError(null);
    setProgress({ current: 0, total: 0, percent: 0 });
    setImportSummary({ success: 0, failed: 0, errors: [] });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-md animate-fadeIn"
      dir="rtl"
    >
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl border border-white/20 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95 overflow-hidden transition-all">
        {/* شريط الرأس Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
              <FileSpreadsheet size={24} />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                استيراد مخزون من إكسل
              </h3>
              <p className="text-xs font-bold text-slate-400 flex items-center gap-1.5 flex-wrap">
                <span>إدخال الأصناف والمخزون دفعة واحدة للمتجر</span>
                <code className="text-[11px] font-mono bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 px-1.5 py-0.5 rounded font-bold" dir="ltr">
                  ID: {storeId}
                </code>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={stage === 'importing'}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-400 transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* محتوى النافذة القابل للتمرير */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* مرحلة 1: رفع ومعاينة الملف */}
          {stage === 'upload' && (
            <>
              {/* بطاقة رفع الملف / السحب والإفلات */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 sm:p-8 cursor-pointer text-center transition-all ${
                  dragOver
                    ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20'
                    : file
                    ? 'border-emerald-400/60 bg-emerald-50/20 dark:border-emerald-800/40 dark:bg-emerald-950/10'
                    : 'border-slate-200 hover:border-emerald-400 bg-slate-50/50 hover:bg-emerald-50/20 dark:border-white/10 dark:bg-slate-800/30 dark:hover:bg-slate-800/60'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx, .xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleProcessFile(f);
                  }}
                />

                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <Upload size={26} />
                </div>

                {file ? (
                  <div>
                    <p className="text-sm font-black text-slate-800 dark:text-white">
                      تم اختيار الملف: <span className="text-emerald-600 dark:text-emerald-400">{file.name}</span>
                    </p>
                    <p className="text-xs font-bold text-slate-400 mt-1">
                      تم قراءة {(parsedRows.length).toLocaleString('en-US')} صنف جاهز للاستيراد
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-black text-slate-800 dark:text-white">
                      اسحب وأفلت ملف الإكسل هنا، أو <span className="text-emerald-600 underline">اضغط للاختيار</span>
                    </p>
                    <p className="text-xs font-bold text-slate-400 mt-1">
                      يدعم ملفات بصيغة <span className="font-mono">.xlsx</span> أو <span className="font-mono">.xls</span>
                    </p>
                  </div>
                )}
              </div>

              {/* زر سريع لتحميل ملف كشف أرصدة المخزون المرفق */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl border border-emerald-200/80 bg-emerald-50/50 dark:border-emerald-800/40 dark:bg-emerald-950/20">
                <div className="flex items-center gap-2.5 text-xs">
                  <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
                    <FileSpreadsheet size={16} />
                  </div>
                  <div>
                    <p className="font-black text-slate-800 dark:text-white">
                      ملف &quot;كشف ارصدة المخزون.xlsx&quot; جاهز في مجلد البرنامج
                    </p>
                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                      يحتوي على 10,106 صنف مسجل جاهزة للاستيراد والمعاينة المباشرة
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleLoadPreloaded}
                  disabled={loadingPreloaded}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-black shadow-md shadow-emerald-600/20 transition-all disabled:opacity-50"
                >
                  {loadingPreloaded ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Check size={15} />
                  )}
                  <span>تحميل الملف ومعاينته فوراً</span>
                </button>
              </div>

              {/* تنبيه الخطأ إن وجد */}
              {parseError && (
                <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300 text-xs font-bold">
                  <AlertCircle size={18} className="shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}

              {/* ملاحظة ترتيب الأعمدة المتوقعة */}
              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-slate-800/40 text-xs text-slate-600 dark:text-slate-300">
                <div className="flex items-center gap-2 font-black text-slate-800 dark:text-white mb-2">
                  <Table2 size={16} className="text-emerald-600" />
                  <span>ترتيب الأعمدة المتوقع في ملف الإكسل (يتم تجاهل السطر الأول كعناوين):</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]" dir="ltr">
                  {[
                    '1. اسم الصنف',
                    '2. رصيد الصنف',
                    '3. الوحدة',
                    '4. معدل السعر',
                    '5. اجمالي',
                    '6. اّخر سعر شراء',
                    '7. باركود',
                  ].map((col, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 rounded-lg bg-white border border-slate-200 dark:bg-slate-900 dark:border-white/10 text-slate-700 dark:text-slate-200 font-bold"
                    >
                      {col}
                    </span>
                  ))}
                </div>
              </div>

              {/* معاينة أول 10 صفوف وحقل نسبة الربح */}
              {parsedRows.length > 0 && (
                <div className="space-y-4">
                  {/* شريط التحكم بنسبة الربح ومعلومات الإجمالي */}
                  <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl border border-indigo-100 bg-indigo-50/50 dark:border-white/10 dark:bg-slate-800/50">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300">
                        <Percent size={18} />
                      </div>
                      <div>
                        <label className="block text-xs font-black text-slate-800 dark:text-white">
                          نسبة الربح % المحتسبة لسعر البيع:
                        </label>
                        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                          سعر البيع = آخر سعر شراء × (1 + نسبة الربح/100)
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={profitMargin}
                        onChange={(e) => setProfitMargin(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="w-24 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-center text-sm font-black font-currency text-indigo-700 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-slate-900 dark:text-indigo-300"
                        dir="ltr"
                      />
                      <span className="text-xs font-black text-slate-600 dark:text-slate-400">%</span>
                    </div>
                  </div>

                  {/* جدول معاينة أول 10 صفوف */}
                  <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden dark:border-white/10 dark:bg-slate-900">
                    <div className="p-3 bg-slate-100/70 border-b border-slate-200 dark:bg-slate-800/60 dark:border-white/10 flex items-center justify-between">
                      <span className="text-xs font-black text-slate-800 dark:text-white">
                        معاينة أول 10 صفوف من الملف
                      </span>
                      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        إجمالي الأصناف بالملف: {(parsedRows.length).toLocaleString('en-US')} صنف
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-right min-w-[620px]">
                        <thead>
                          <tr className="bg-slate-900 text-white dark:bg-slate-950 font-black">
                            <th className="p-2.5 w-10 text-center">#</th>
                            <th className="p-2.5">اسم الصنف</th>
                            <th className="p-2.5 font-mono" dir="ltr">الباركود</th>
                            <th className="p-2.5 text-center">الوحدة</th>
                            <th className="p-2.5 text-center">رصيد المخزون</th>
                            <th className="p-2.5 text-center font-currency">سعر الشراء</th>
                            <th className="p-2.5 text-center font-currency text-emerald-300">
                              سعر البيع المحسوب ({profitMargin}%)
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                          {previewRows.map((row, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                              <td className="p-2.5 text-center text-slate-400 font-bold">{idx + 1}</td>
                              <td className="p-2.5 font-black text-slate-900 dark:text-white">{row.name}</td>
                              <td className="p-2.5 font-mono text-slate-500 dark:text-slate-400" dir="ltr">
                                {row.barcode || '—'}
                              </td>
                              <td className="p-2.5 text-center text-slate-600 dark:text-slate-300">{row.unit}</td>
                              <td className="p-2.5 text-center font-black font-currency text-slate-800 dark:text-white" dir="ltr">
                                {row.stockCount}
                              </td>
                              <td className="p-2.5 text-center font-currency text-slate-600 dark:text-slate-400" dir="ltr">
                                ₪{row.purchasePrice.toFixed(2)}
                              </td>
                              <td className="p-2.5 text-center font-black font-currency text-emerald-600 dark:text-emerald-400" dir="ltr">
                                ₪{row.salePrice.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* مرحلة 2: شريط التقدم أثناء الاستيراد */}
          {stage === 'importing' && (
            <div className="py-12 px-4 flex flex-col items-center justify-center text-center space-y-6">
              <div className="relative flex items-center justify-center">
                <Loader2 className="animate-spin text-emerald-600 dark:text-emerald-400" size={54} />
              </div>

              <div className="space-y-2 max-w-md w-full">
                <h4 className="text-lg font-black text-slate-900 dark:text-white">
                  جاري استيراد الأصناف إلى المخزون...
                </h4>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  يتم إدخال البيانات على دفعات بحجم {BATCH_SIZE} صنف بكل دفعة لضمان الاستقرار وسرعة المعالجة
                </p>

                {/* شريط التقدم Progress Bar */}
                <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden dark:bg-slate-800 border border-slate-200 dark:border-white/10 mt-4">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>

                {/* العداد اللحظي */}
                <div className="flex items-center justify-between text-xs font-black text-slate-700 dark:text-slate-300 pt-1">
                  <span>تم استيراد {progress.current.toLocaleString('en-US')} من {progress.total.toLocaleString('en-US')} صنف</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">{progress.percent}%</span>
                </div>
              </div>
            </div>
          )}

          {/* مرحلة 3: ملخص الانتهاء */}
          {stage === 'summary' && (
            <div className="space-y-5 py-4">
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50/70 p-6 text-center dark:border-emerald-900/50 dark:bg-emerald-950/30">
                <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
                  <CheckCircle2 size={36} />
                </div>
                <h4 className="text-xl font-black text-emerald-900 dark:text-emerald-200">
                  اكتملت عملية الاستيراد بنجاح!
                </h4>
                <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400 mt-1">
                  تمت معالجة ملف الإكسل وإضافة الأصناف إلى جدول المخزون.
                </p>
              </div>

              {/* بطاقات الإحصائيات */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold text-slate-400">الأصناف المستوردة بنجاح</p>
                    <p className="text-2xl font-black font-currency text-emerald-600 dark:text-emerald-400 mt-1">
                      {importSummary.success.toLocaleString('en-US')}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-100/60 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                    <Check size={22} />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold text-slate-400">الصفوف التي فشلت</p>
                    <p className={`text-2xl font-black font-currency mt-1 ${importSummary.failed > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                      {importSummary.failed.toLocaleString('en-US')}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <AlertTriangle size={22} />
                  </div>
                </div>
              </div>

              {/* تفاصيل الأخطاء إن وجدت */}
              {importSummary.errors.length > 0 && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-4 dark:border-rose-900/40 dark:bg-rose-950/30 space-y-2">
                  <h5 className="text-xs font-black text-rose-800 dark:text-rose-300 flex items-center gap-2">
                    <AlertCircle size={16} />
                    <span>تفاصيل الصفوف التي تعذر استيرادها:</span>
                  </h5>
                  <div className="max-h-36 overflow-y-auto space-y-1 text-xs text-rose-700 dark:text-rose-400 font-bold">
                    {importSummary.errors.map((err, i) => (
                      <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white/70 dark:bg-slate-900/70">
                        <span>الدفعة: {err.batch}</span>
                        <span className="text-[11px]">{err.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* شريط الإجراءات السفلي Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/50 dark:border-white/10 dark:bg-slate-900/60 shrink-0">
          {stage === 'upload' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-xs font-bold transition-all"
              >
                إلغاء
              </button>

              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={parsedRows.length === 0}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-black shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50 disabled:pointer-events-none"
              >
                <Check size={16} />
                <span>
                  تأكيد استيراد {parsedRows.length > 0 ? `(${parsedRows.length.toLocaleString('en-US')} صنف)` : ''}
                </span>
              </button>
            </>
          )}

          {stage === 'importing' && (
            <div className="w-full text-center text-xs font-bold text-slate-400">
              يرجى عدم إغلاق الصفحة أثناء المعالجة...
            </div>
          )}

          {stage === 'summary' && (
            <div className="w-full flex items-center justify-between">
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-xs font-bold transition-all"
              >
                <RefreshCw size={14} />
                <span>استيراد ملف آخر</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (onImported) onImported();
                  else onClose();
                }}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-black shadow-lg shadow-emerald-600/20 transition-all"
              >
                <Check size={16} />
                <span>إغلاق وتحديث المخزون</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
