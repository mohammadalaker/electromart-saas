import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Loader2, ShoppingBag, ArrowLeft, ClipboardList } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';
import { addDaysISO } from '../utils/dateIso';
import { brandStorageKey } from '../constants/brand.js';

export default function PurchasesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();
  const [supplierCompanyName, setSupplierCompanyName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [paymentDueDate, setPaymentDueDate] = useState(() =>
    addDaysISO(new Date().toISOString().slice(0, 10), 30)
  );
  const [supplierPhone, setSupplierPhone] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [savedBanner, setSavedBanner] = useState(null);

  useEffect(() => {
    if (location.state?.purchaseSaved) {
      setSavedBanner({
        total: location.state.total,
      });
      navigate('/purchases', { replace: true, state: {} });
    }
  }, [location.state, navigate]);

  const handleContinue = (e) => {
    e.preventDefault();
    const company = supplierCompanyName.trim();
    const inv = normalizeDigitsToLatin(invoiceNumber.trim());
    const phone = normalizeDigitsToLatin(supplierPhone.trim());
    if (!company) {
      toast.warning('أدخل اسم الشركة');
      return;
    }
    if (!inv) {
      toast.warning('أدخل رقم الفاتورة');
      return;
    }
    if (!invoiceDate?.trim()) {
      toast.warning('اختر تاريخ الفاتورة');
      return;
    }
    if (!phone) {
      toast.warning('أدخل رقم هاتف المورد');
      return;
    }
    if (paymentMode === 'credit' && !paymentDueDate?.trim()) {
      toast.warning('اختر تاريخ استحقاق سداد المورد للفاتورة الآجلة');
      return;
    }
    const header = {
      supplierCompanyName: company,
      invoiceNumber: inv,
      invoiceDate: invoiceDate.trim(),
      supplierPhone: phone,
      paymentMode,
      ...(paymentMode === 'credit'
        ? { paymentDueDate: paymentDueDate.trim().slice(0, 10) }
        : {}),
    };
    sessionStorage.setItem(brandStorageKey('purchase-invoice-header'), JSON.stringify(header));
    navigate('/purchases/lines', { state: { header } });
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
    <DashboardLayout>
      <div className="max-w-lg mx-auto space-y-6" dir="rtl">
        <Link
          to="/purchases/history"
          className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl border border-slate-200 bg-white text-sm font-black text-violet-700 hover:bg-violet-50 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-violet-300 dark:hover:bg-violet-950/40 dark:shadow-none"
        >
          <ClipboardList size={18} />
          سجل المشتريات ومرتجعات الموردين
        </Link>

        {savedBanner && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-100">
            تم حفظ فاتورة المشتريات بنجاح — إجمالي{' '}
            <span className="font-currency" dir="ltr" lang="en">
              ₪{' '}
              {Number(savedBanner.total).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-gray-700/50 dark:bg-gray-900/70 dark:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.35)]">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
              <ShoppingBag size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white">فاتورة مشتريات جديدة</h2>
              <p className="text-xs text-slate-500 mt-0.5 dark:text-slate-400">
                املأ رأس الفاتورة ثم الأسطر؛ يمكن حفظ <strong className="text-slate-700 dark:text-slate-200">مسودة</strong> قبل وصول البضاعة، وتسجيل{' '}
                <strong className="text-slate-700 dark:text-slate-200">مصاريف واصلة</strong> تُوزَّع على تكلفة القطعة للربح الصافي.
              </p>
            </div>
          </div>

          <form onSubmit={handleContinue} className="space-y-4 mt-6">
            <div>
              <label className="text-sm font-bold text-slate-700 dark:text-slate-200 block mb-1.5">
                اسم الشركة الموردة <span className="text-rose-500 dark:text-rose-400">*</span>
              </label>
              <input
                value={supplierCompanyName}
                onChange={(e) => setSupplierCompanyName(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-violet-200 outline-none dark:border-white/10 dark:bg-slate-800/80 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:bg-slate-900 dark:focus:ring-violet-500/35"
                placeholder="اسم الشركة أو المورد"
              />
            </div>

            <div>
              <label className="text-sm font-bold text-slate-700 dark:text-slate-200 block mb-1.5">
                رقم الفاتورة <span className="text-rose-500 dark:text-rose-400">*</span>
              </label>
              <input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(normalizeDigitsToLatin(e.target.value))}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-currency bg-slate-50 focus:bg-white focus:ring-2 focus:ring-violet-200 outline-none dark:border-white/10 dark:bg-slate-800/80 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:bg-slate-900 dark:focus:ring-violet-500/35"
                dir="ltr"
                lang="en"
                placeholder="رقم فاتورة المورد"
              />
            </div>

            <div>
              <label className="text-sm font-bold text-slate-700 dark:text-slate-200 block mb-1.5">
                تاريخ الفاتورة <span className="text-rose-500 dark:text-rose-400">*</span>
              </label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-currency bg-slate-50 focus:bg-white focus:ring-2 focus:ring-violet-200 outline-none dark:border-white/10 dark:bg-slate-800/80 dark:text-slate-100 dark:[color-scheme:dark] dark:focus:bg-slate-900 dark:focus:ring-violet-500/35"
                dir="ltr"
                lang="en"
              />
            </div>

            <div>
              <label className="text-sm font-bold text-slate-700 dark:text-slate-200 block mb-1.5">
                رقم هاتف المورد <span className="text-rose-500 dark:text-rose-400">*</span>
              </label>
              <input
                type="tel"
                value={supplierPhone}
                onChange={(e) => setSupplierPhone(normalizeDigitsToLatin(e.target.value))}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-currency bg-slate-50 focus:bg-white focus:ring-2 focus:ring-violet-200 outline-none dark:border-white/10 dark:bg-slate-800/80 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:bg-slate-900 dark:focus:ring-violet-500/35"
                dir="ltr"
                lang="en"
                placeholder="05xxxxxxxx"
              />
            </div>

            <div>
              <label className="text-sm font-bold text-slate-700 dark:text-slate-200 block mb-2">طريقة الدفع</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMode('cash')}
                  className={`flex-1 py-3 rounded-2xl text-sm font-black border-2 transition-all ${
                    paymentMode === 'cash'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100 dark:border-emerald-500'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-white/20'
                  }`}
                >
                  كاش
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaymentMode('credit');
                    setPaymentDueDate((prev) =>
                      prev?.trim() ? prev : addDaysISO(invoiceDate, 30)
                    );
                  }}
                  className={`flex-1 py-3 rounded-2xl text-sm font-black border-2 transition-all ${
                    paymentMode === 'credit'
                      ? 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/45 dark:text-amber-100 dark:border-amber-500'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-white/20'
                  }`}
                >
                  آجل (ذمة)
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-2 leading-relaxed dark:text-slate-400">
                مبلغ الفاتورة يُحسب تلقائياً من مجموع أسطر الأصناف في الخطوة التالية. عند الآجل يُسجَّل
                على ذمة المورد بعد الحفظ ويُزاد رصيد المديونية في دليل الموردين.
              </p>
            </div>

            {paymentMode === 'credit' && (
              <div>
                <label className="text-sm font-bold text-slate-700 dark:text-slate-200 block mb-1.5">
                  تاريخ استحقاق السداد <span className="text-rose-500 dark:text-rose-400">*</span>
                </label>
                <input
                  type="date"
                  value={paymentDueDate}
                  onChange={(e) => setPaymentDueDate(e.target.value)}
                  className="w-full rounded-2xl border border-amber-200 px-4 py-3 text-sm font-currency bg-amber-50/50 focus:bg-white focus:ring-2 focus:ring-amber-200 outline-none dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-slate-100 dark:[color-scheme:dark] dark:focus:bg-amber-950/50 dark:focus:ring-amber-500/40"
                  dir="ltr"
                  lang="en"
                />
                <p className="text-[11px] text-amber-900/80 mt-2 leading-relaxed dark:text-amber-200/90">
                  يُستخدم للتذكير عند حلول موعد الدفع (مثلاً شركة المسلماني). الافتراضي +30 يوماً من تاريخ
                  الفاتورة عند اختيار آجل.
                </p>
                <button
                  type="button"
                  onClick={() => setPaymentDueDate(addDaysISO(invoiceDate, 30))}
                  className="mt-2 text-xs font-bold text-violet-600 hover:underline dark:text-violet-400"
                >
                  إعادة ضبط الاستحقاق = تاريخ الفاتورة + 30 يوماً
                </button>
              </div>
            )}

            <button
              type="submit"
              className="w-full py-4 rounded-2xl bg-violet-600 text-white font-black hover:bg-violet-700 flex items-center justify-center gap-2 shadow-lg dark:shadow-violet-950/50"
            >
              متابعة — إدخال الأصناف والمبالغ
              <ArrowLeft size={20} />
            </button>
          </form>
        </div>
      </div>
    </DashboardLayout>
  );
}
