import { useCallback, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import {
  X,
  Upload,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Table2,
  Settings2,
  Download,
} from 'lucide-react';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';

/** أسماء الأعمدة الشائعة مع الحقل المقابل في الـ DB */
const FIELD_HINTS = {
  eng_name: ['الاسم', 'اسم المنتج', 'name', 'product name', 'الصنف', 'اسم الصنف', 'المنتج'],
  barcode: ['باركود', 'barcode', 'رمز', 'كود', 'code', 'sku', 'رقم الصنف'],
  full_price: ['السعر', 'سعر القائمة', 'price', 'full price', 'سعر الشراء', 'سعر البيع', 'التكلفة'],
  price_after_disc: ['سعر البيع', 'بعد الخصم', 'sale price', 'discount price', 'سعر العرض', 'final price'],
  stock_count: ['المخزون', 'الكمية', 'stock', 'quantity', 'qty', 'كمية', 'العدد'],
  brand_group: ['المجموعة', 'العلامة', 'brand', 'group', 'ماركة', 'الفئة', 'التصنيف'],
  reference: ['المرجع', 'reference', 'ref', 'رقم المرجع', 'كود المرجع', 'الرقم'],
  box_count: ['الكرتون', 'box', 'عدد الكرتون', 'boxes', 'كرتون'],
  warranty_months: ['الضمان', 'warranty', 'ضمان', 'مدة الضمان'],
};

const FIELD_LABELS = {
  eng_name: 'اسم المنتج *',
  barcode: 'الباركود *',
  full_price: 'السعر الأصلي',
  price_after_disc: 'سعر البيع / بعد الخصم',
  stock_count: 'المخزون (الكمية)',
  brand_group: 'المجموعة / الماركة',
  reference: 'رقم المرجع',
  box_count: 'عدد الكرتون',
  warranty_months: 'الضمان (أشهر)',
};

const ALL_FIELDS = Object.keys(FIELD_LABELS);
const IGNORE = '__ignore__';

function guessFieldForHeader(header) {
  const h = normalizeDigitsToLatin(String(header ?? '').trim()).toLowerCase();
  if (!h) return IGNORE;
  for (const [field, hints] of Object.entries(FIELD_HINTS)) {
    if (hints.some((hint) => h.includes(hint.toLowerCase()) || hint.toLowerCase().includes(h))) {
      return field;
    }
  }
  return IGNORE;
}

function parseNumSafe(v) {
  if (v == null || v === '') return null;
  const s = normalizeDigitsToLatin(String(v).replace(/,/g, '.')).trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function cellToString(v) {
  if (v == null) return '';
  if (typeof v === 'object' && v.text != null) return String(v.text);
  if (typeof v === 'object' && v.result != null) return String(v.result);
  return String(v);
}

export default function ImportProductsModal({ storeId, onClose, onImported }) {
  const [step, setStep] = useState(1); // 1=upload 2=map 3=preview 4=result
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [parseError, setParseError] = useState(null);
  const fileInputRef = useRef(null);

  const parseFile = useCallback(async (f) => {
    setParseError(null);
    try {
      const buffer = await f.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const ws = wb.worksheets[0];
      if (!ws) throw new Error('الملف فارغ أو لا يحتوي على ورقة عمل.');

      const allRows = [];
      ws.eachRow((row) => {
        allRows.push(row.values.slice(1).map(cellToString));
      });
      if (allRows.length < 2) throw new Error('الملف يحتاج على الأقل صف عناوين + صف بيانات.');

      const hdrs = allRows[0];
      const data = allRows.slice(1).filter((r) => r.some((c) => c.trim()));

      setHeaders(hdrs);
      setRawRows(data);

      // Auto-detect mapping
      const auto = {};
      const usedFields = new Set();
      hdrs.forEach((h, idx) => {
        const field = guessFieldForHeader(h);
        if (field !== IGNORE && !usedFields.has(field)) {
          auto[idx] = field;
          usedFields.add(field);
        } else {
          auto[idx] = IGNORE;
        }
      });
      setMapping(auto);
      setStep(2);
    } catch (e) {
      setParseError(e.message || 'فشل قراءة الملف');
    }
  }, []);

  const handleFileChange = useCallback((f) => {
    if (!f) return;
    if (!/\.(xlsx|xls|csv)$/i.test(f.name)) {
      setParseError('يُقبل فقط ملفات .xlsx أو .xls أو .csv');
      return;
    }
    setFile(f);
    parseFile(f);
  }, [parseFile]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileChange(f);
  }, [handleFileChange]);

  /** تحويل صف Excel إلى record DB */
  function rowToRecord(row) {
    const rec = {};
    Object.entries(mapping).forEach(([idx, field]) => {
      if (field === IGNORE) return;
      const val = (row[Number(idx)] ?? '').trim();
      if (!val) return;
      if (['full_price', 'price_after_disc', 'stock_count', 'box_count', 'warranty_months'].includes(field)) {
        const n = parseNumSafe(val);
        if (n !== null) rec[field] = n;
      } else {
        rec[field] = val;
      }
    });
    return rec;
  }

  const previewRows = rawRows.slice(0, 10).map(rowToRecord);

  const handleImport = async () => {
    setImporting(true);
    let inserted = 0, updated = 0, errors = 0;
    const errorList = [];

    for (const row of rawRows) {
      const rec = rowToRecord(row);
      if (!rec.barcode && !rec.eng_name) { errors++; continue; }

      try {
        const payload = { ...rec, store_id: storeId };

        if (rec.barcode) {
          // Upsert by barcode
          const { data: existing } = await supabase
            .from(PRODUCTS_TABLE)
            .select('id')
            .eq('barcode', String(rec.barcode))
            .eq('store_id', storeId)
            .maybeSingle();

          if (existing?.id) {
            const { error } = await supabase
              .from(PRODUCTS_TABLE)
              .update(rec)
              .eq('barcode', String(rec.barcode))
              .eq('store_id', storeId);
            if (error) throw error;
            updated++;
          } else {
            const { error } = await supabase
              .from(PRODUCTS_TABLE)
              .insert([payload]);
            if (error) throw error;
            inserted++;
          }
        } else {
          const { error } = await supabase
            .from(PRODUCTS_TABLE)
            .insert([payload]);
          if (error) throw error;
          inserted++;
        }
      } catch (e) {
        errors++;
        errorList.push({ row: rec.eng_name || rec.barcode || '?', msg: e.message });
      }
    }

    setResult({ inserted, updated, errors, errorList });
    setImporting(false);
    setStep(4);
    if (inserted + updated > 0) onImported?.();
  };

  const downloadTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('منتجات', { views: [{ rightToLeft: true }] });
    const headers = [
      'اسم المنتج', 'باركود', 'السعر الأصلي', 'سعر البيع',
      'المخزون', 'المجموعة', 'المرجع', 'عدد الكرتون', 'الضمان (أشهر)',
    ];
    const headerRow = ws.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
      cell.alignment = { horizontal: 'center' };
    });
    ws.addRow(['سماعات سوني WH-1000XM5', '12345678', '450', '380', '10', 'Sony', 'WH1000XM5', '1', '12']);
    ws.columns.forEach((col) => { col.width = 20; });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'قالب-استيراد-منتجات.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  const colSpanByMapping = ALL_FIELDS.filter((f) => Object.values(mapping).includes(f));

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      dir="rtl"
      onClick={() => !importing && onClose()}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-gray-700/60 dark:bg-gray-900 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-100 dark:border-slate-700/60 bg-gradient-to-l from-indigo-50/50 to-white dark:from-indigo-950/30 dark:to-gray-900">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md">
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <h2 className="font-black text-slate-900 dark:text-white text-base">استيراد منتجات من Excel</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                {step === 1 && 'ارفع ملف .xlsx أو .xls'}
                {step === 2 && 'ربط الأعمدة بحقول المنتج'}
                {step === 3 && `معاينة — ${rawRows.length} صف`}
                {step === 4 && 'نتيجة الاستيراد'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Step indicator */}
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4].map((s) => (
                <div
                  key={s}
                  className={`h-2 rounded-full transition-all ${
                    s === step ? 'w-6 bg-indigo-600' : s < step ? 'w-2 bg-indigo-300 dark:bg-indigo-700' : 'w-2 bg-slate-200 dark:bg-slate-700'
                  }`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => !importing && onClose()}
              disabled={importing}
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 disabled:opacity-40 dark:hover:bg-slate-800 dark:text-slate-400"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* Step 1: Upload */}
          {step === 1 && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-8 py-14 text-center cursor-pointer transition-all ${
                  dragOver
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
                    : 'border-slate-200 bg-slate-50/60 hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-indigo-500/50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="sr-only"
                  onChange={(e) => handleFileChange(e.target.files?.[0])}
                />
                <div className={`mb-4 flex h-16 w-16 items-center justify-center rounded-2xl ${dragOver ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-300' : 'bg-white text-slate-400 shadow-sm dark:bg-slate-700 dark:text-slate-400'}`}>
                  <Upload size={32} strokeWidth={1.5} />
                </div>
                <p className="font-black text-slate-700 dark:text-slate-200 text-base">
                  {dragOver ? 'أسقط الملف هنا' : 'اسحب وأسقط ملف Excel هنا'}
                </p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">أو اضغط لاختيار ملف</p>
                <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">.xlsx / .xls / .csv</p>
              </div>

              {parseError && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-200">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  {parseError}
                </div>
              )}

              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-700/60 dark:bg-slate-800/40">
                <p className="text-xs font-black text-slate-600 dark:text-slate-300 mb-2">متطلبات الملف:</p>
                <ul className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <li>• أول صف = عناوين الأعمدة (اسم المنتج، باركود، السعر…)</li>
                  <li>• باركود فريد لكل منتج — لو الباركود موجود مسبقاً يتحدّث المنتج</li>
                  <li>• لو ما عنده باركود يُضاف كمنتج جديد</li>
                </ul>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); downloadTemplate(); }}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800/50 dark:bg-indigo-950/30 dark:text-indigo-300 transition-colors"
                >
                  <Download size={13} />
                  تحميل قالب جاهز
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Map columns */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs font-bold text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-200 flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                اسم المنتج والباركود حقلان أساسيان — ربط على الأقل واحداً منهما.
              </div>

              <div className="space-y-2">
                {headers.map((header, idx) => (
                  <div key={idx} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3 dark:border-slate-700/50 dark:bg-slate-800/40">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black text-slate-700 dark:text-slate-200 truncate" title={header}>
                        {header || `عمود ${idx + 1}`}
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                        {[rawRows[0]?.[idx], rawRows[1]?.[idx]].filter(Boolean).join(' / ') || '—'}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <ArrowLeft size={14} className="text-slate-300 dark:text-slate-600" />
                      <select
                        value={mapping[idx] ?? IGNORE}
                        onChange={(e) => setMapping((prev) => ({ ...prev, [idx]: e.target.value }))}
                        className={`rounded-xl border px-3 py-2 text-xs font-bold outline-none transition-colors focus:ring-2 focus:ring-indigo-500/20 ${
                          mapping[idx] && mapping[idx] !== IGNORE
                            ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700/50 dark:bg-indigo-950/30 dark:text-indigo-300'
                            : 'border-slate-200 bg-white text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400'
                        }`}
                      >
                        <option value={IGNORE}>تجاهل هذا العمود</option>
                        {ALL_FIELDS.map((f) => (
                          <option key={f} value={f}>{FIELD_LABELS[f]}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Preview */}
          {step === 3 && (
            <div className="space-y-3">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                معاينة أول {Math.min(10, rawRows.length)} صفوف من أصل {rawRows.length} — اضغط «استيراد» لبدء الرفع الكامل.
              </p>
              <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700/60">
                <table className="w-full text-xs min-w-[500px]">
                  <thead>
                    <tr className="bg-gradient-to-r from-indigo-50/80 to-transparent text-slate-700 border-b border-slate-200/70 dark:from-indigo-950/40 dark:to-transparent dark:text-slate-200 dark:border-slate-700/60">
                      {colSpanByMapping.map((f) => (
                        <th key={f} className="text-right py-2.5 px-3 font-semibold whitespace-nowrap">
                          {FIELD_LABELS[f]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((rec, idx) => (
                      <tr key={idx} className={`border-b border-slate-100/70 dark:border-slate-700/40 ${idx % 2 === 0 ? 'bg-white dark:bg-slate-900/50' : 'bg-slate-50/40 dark:bg-slate-800/30'}`}>
                        {colSpanByMapping.map((f) => (
                          <td key={f} className="py-2.5 px-3 text-slate-700 dark:text-slate-300 max-w-[160px] truncate" title={String(rec[f] ?? '')}>
                            {rec[f] != null ? String(rec[f]) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step 4: Result */}
          {step === 4 && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center dark:border-emerald-800/40 dark:bg-emerald-950/20">
                  <p className="text-3xl font-black text-emerald-700 dark:text-emerald-300 font-currency">{result.inserted}</p>
                  <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-1">منتج جديد أُضيف</p>
                </div>
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-center dark:border-indigo-800/40 dark:bg-indigo-950/20">
                  <p className="text-3xl font-black text-indigo-700 dark:text-indigo-300 font-currency">{result.updated}</p>
                  <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mt-1">منتج مُحدَّث</p>
                </div>
                <div className={`rounded-2xl border p-4 text-center ${result.errors > 0 ? 'border-rose-200 bg-rose-50 dark:border-rose-800/40 dark:bg-rose-950/20' : 'border-slate-200 bg-slate-50 dark:border-slate-700/50 dark:bg-slate-800/40'}`}>
                  <p className={`text-3xl font-black font-currency ${result.errors > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-slate-400 dark:text-slate-500'}`}>{result.errors}</p>
                  <p className={`text-xs font-bold mt-1 ${result.errors > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>خطأ</p>
                </div>
              </div>

              {result.inserted + result.updated > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 dark:border-emerald-800/40 dark:bg-emerald-950/20">
                  <CheckCircle2 className="text-emerald-600 dark:text-emerald-400 shrink-0" size={18} />
                  <p className="text-sm font-black text-emerald-800 dark:text-emerald-200">
                    تم الاستيراد بنجاح — المنتجات ظهرت في المخزن
                  </p>
                </div>
              )}

              {result.errorList.length > 0 && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-3 dark:border-rose-800/40 dark:bg-rose-950/20 space-y-1.5 max-h-40 overflow-y-auto">
                  <p className="text-xs font-black text-rose-800 dark:text-rose-200 mb-2">تفاصيل الأخطاء:</p>
                  {result.errorList.map((e, i) => (
                    <p key={i} className="text-[11px] text-rose-700 dark:text-rose-300">
                      <span className="font-bold">{e.row}</span>: {e.msg}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/30">
          <div>
            {step > 1 && step < 4 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                disabled={importing}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                <ChevronRight size={16} />
                رجوع
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step < 4 && (
              <button
                type="button"
                onClick={() => !importing && onClose()}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300"
              >
                إلغاء
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                onClick={() => setStep(3)}
                disabled={!Object.values(mapping).some((v) => v !== IGNORE)}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-md"
              >
                معاينة
                <ChevronLeft size={16} />
              </button>
            )}

            {step === 3 && (
              <button
                type="button"
                onClick={handleImport}
                disabled={importing}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-md"
              >
                {importing ? (
                  <>
                    <Loader2 className="animate-spin" size={16} />
                    جاري الاستيراد…
                  </>
                ) : (
                  <>
                    <Table2 size={16} />
                    استيراد {rawRows.length} منتج
                  </>
                )}
              </button>
            )}

            {step === 4 && (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white hover:bg-indigo-700 transition-colors"
              >
                <CheckCircle2 size={16} />
                إغلاق
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
