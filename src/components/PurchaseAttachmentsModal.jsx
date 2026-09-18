import { useRef, useState } from 'react';
import { X, Paperclip, Upload, FileText, Image as ImageIcon, Trash2, ExternalLink, Download } from 'lucide-react';
import StorageObjectImage from './StorageObjectImage';

export default function PurchaseAttachmentsModal({
  isOpen,
  onClose,
  scanFile,
  scanPath,
  previewUrl,
  onFileChosen,
  onRemove,
}) {
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);

  if (!isOpen) return null;

  const isPdf =
    (scanFile && scanFile.type === 'application/pdf') ||
    (scanPath && scanPath.toLowerCase().endsWith('.pdf'));

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFileChosen(e.dataTransfer.files[0]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
      dir="rtl"
    >
      <div className="relative w-full max-w-lg rounded-3xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/10 px-6 py-4 bg-slate-50/70 dark:bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
              <Paperclip size={20} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                مرفقات فاتورة المشتريات
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                صورة أو مستند PDF لفاتورة المورد الأصلية
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                onFileChosen(e.target.files[0]);
              }
            }}
          />

          {scanFile || scanPath || previewUrl ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  {isPdf ? (
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
                      <FileText size={20} />
                    </div>
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                      <ImageIcon size={20} />
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-black text-slate-900 dark:text-slate-100 truncate max-w-[220px]">
                      {scanFile?.name || (scanPath ? scanPath.split('/').pop() : 'فاتورة المورد الأصلية')}
                    </p>
                    <p className="text-[11px] text-slate-400 font-mono">
                      {isPdf ? 'مستند PDF' : 'ملف صورة'} {scanFile ? `(${(scanFile.size / 1024).toFixed(0)} KB)` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onRemove}
                    className="p-2 rounded-xl text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                    title="حذف المرفق"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* Preview Container */}
              {previewUrl && !isPdf && (
                <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 max-h-56 flex items-center justify-center bg-black/5 dark:bg-black/40">
                  <img
                    src={previewUrl}
                    alt="معاينة فاتورة المورد"
                    className="max-h-56 w-auto object-contain"
                  />
                </div>
              )}

              {scanPath && !previewUrl && !isPdf && (
                <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 max-h-56 flex items-center justify-center bg-black/5 dark:bg-black/40">
                  <StorageObjectImage
                    storagePath={scanPath}
                    alt="فاتورة المورد المحفوظة"
                    className="max-h-56 w-auto object-contain"
                  />
                </div>
              )}

              {isPdf && (
                <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center">
                  <FileText className="mx-auto text-rose-500 mb-2" size={32} />
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    تم إرفاق مستند PDF بنجاح
                  </p>
                  {previewUrl && (
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-xs font-bold text-violet-600 dark:text-violet-400 hover:underline"
                    >
                      <ExternalLink size={14} />
                      <span>فتح ملف الـ PDF</span>
                    </a>
                  )}
                </div>
              )}

              <div className="pt-2 flex justify-between items-center">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs font-bold text-violet-600 dark:text-violet-400 hover:underline"
                >
                  استبدال الملف بملف آخر
                </button>
              </div>
            </div>
          ) : (
            /* Upload Drop Area */
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-150 ${
                dragActive
                  ? 'border-violet-500 bg-violet-50/70 dark:bg-violet-950/30'
                  : 'border-slate-300 dark:border-slate-700 hover:border-violet-400 dark:hover:border-violet-500 bg-slate-50/60 dark:bg-slate-950/40'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-violet-100 dark:bg-violet-950/60 text-violet-600 dark:text-violet-300 mx-auto flex items-center justify-center mb-3">
                <Upload size={22} />
              </div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">
                اسحب الملف إلى هنا أو <span className="text-violet-600 dark:text-violet-400 underline">تصفح جهازك</span>
              </p>
              <p className="text-xs text-slate-400">
                يدعم ملفات الصور (JPG, PNG) ومستندات PDF حتى 10MB
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-slate-200 dark:border-white/10 px-6 py-4 bg-slate-50/70 dark:bg-slate-950/60">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs shadow-xs transition"
          >
            تم
          </button>
        </div>
      </div>
    </div>
  );
}
