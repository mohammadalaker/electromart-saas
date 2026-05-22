import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Copy, Check, Store, ExternalLink, ChevronLeft, Settings, Upload, Image as ImageIcon } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/;

export default function StorefrontSettingsPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [slug, setSlug] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [paymentLink, setPaymentLink] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedOk, setSavedOk] = useState(false);
  const [copied, setCopied] = useState(false);
  const [heroImage, setHeroImage] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [uploadingHero, setUploadingHero] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    if (storeLoading) return;
    if (!store?.id) {
      navigate('/signin');
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: qErr } = await supabase
        .from('stores')
        .select('public_slug, public_catalog_enabled, hero_image, logo_url')
        .eq('id', store.id)
        .single();
      if (cancelled) return;
      if (qErr) {
        if (/public_slug|public_catalog|column|schema|PGRST204/i.test(String(qErr.message || ''))) {
          setError(
            'لم تُنفَّذ بعد هجرة قاعدة البيانات للمتجر العام. نفّذ الملف supabase/public_store_catalog.sql في Supabase.'
          );
        } else {
          setError(qErr.message);
        }
        setLoading(false);
        return;
      }
      setSlug((data?.public_slug ?? '').toString().trim());
      setEnabled(Boolean(data?.public_catalog_enabled));
      setHeroImage((data?.hero_image ?? '').toString().trim());
      setLogoUrl((data?.logo_url ?? '').toString().trim());
      try {
          const lPay = localStorage.getItem(`store-payment-config-${store.id}`);
          if (lPay) setPaymentLink(lPay);
      } catch (e) {}
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [store?.id, storeLoading, navigate]);

  const publicUrl =
    typeof window !== 'undefined' && slug
      ? `${window.location.origin}/${encodeURIComponent(slug.trim().toLowerCase())}`
      : '';

  const handleSave = async (e) => {
    e.preventDefault();
    if (!store?.id) return;
    const t = slug.trim().toLowerCase();
    if (enabled && t && !SLUG_RE.test(t)) {
      setError(
        'معرّف الرابط: 3–40 حرفاً، أحرف إنجليزية صغيرة وأرقام وشرطة، يبدأ وينتهي بحرف أو رقم.'
      );
      return;
    }
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const { error: uErr } = await supabase
        .from('stores')
        .update({
          public_slug: enabled && t ? t : null,
          public_catalog_enabled: enabled && !!t,
        })
        .eq('id', store.id);
      if (uErr) throw uErr;
      try {
         localStorage.setItem(`store-payment-config-${store.id}`, paymentLink.trim());
      } catch (err) {}
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } catch (err) {
      setError(err.message || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.info(`تعذّر النسخ تلقائياً. الرابط: ${publicUrl}`);
    }
  };

  const uploadImage = async (file, type) => {
    if (!store?.id || !file) return;
    const isHero = type === 'hero';
    isHero ? setUploadingHero(true) : setUploadingLogo(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `stores/${store.id}/${type}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('store-assets')
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage
        .from('store-assets')
        .getPublicUrl(path);
      const url = urlData.publicUrl;
      await supabase.from('stores').update(
        isHero ? { hero_image: url } : { logo_url: url }
      ).eq('id', store.id);
      isHero ? setHeroImage(url) : setLogoUrl(url);
    } catch (err) {
      setError(err.message || 'فشل رفع الصورة');
    } finally {
      isHero ? setUploadingHero(false) : setUploadingLogo(false);
    }
  };

  if (storeLoading || loading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24" dir="rtl">
          <Loader2 className="animate-spin text-violet-500" size={40} />
        </div>
      </DashboardLayout>
    );
  }

  if (!store?.id) {
    return null;
  }

  return (
    <DashboardLayout
      actions={
        <Link
          to="/settings"
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-violet-600 dark:text-slate-400 dark:hover:text-violet-400"
        >
          <Settings size={16} />
          إعدادات النظام
          <ChevronLeft size={16} />
        </Link>
      }
    >
      <div className="max-w-xl mx-auto space-y-6" dir="rtl">
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden dark:bg-gray-900/40 dark:border-white/10">
          <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-l from-violet-50/50 to-white dark:from-violet-950/30 dark:to-gray-900 flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-violet-600 text-white flex items-center justify-center shadow-lg shadow-violet-200/50">
              <Store size={22} />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 dark:text-white">متجري العام</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                رابط للزبائن لتصفح الكاتالوج وطلب الشراء بالدفع عند الاستلام
              </p>
            </div>
          </div>

          <form onSubmit={handleSave} className="p-6 space-y-5">
            {error && (
              <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
                {error}
              </div>
            )}
            {savedOk && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
                تم حفظ الإعدادات.
              </div>
            )}

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              <span className="text-sm font-bold text-slate-800 dark:text-slate-200">
                تفعيل المتجر العام (الزوار بدون تسجيل دخول)
              </span>
            </label>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">معرّف الرابط (بالإنجليزية)</label>
              <div className="flex flex-wrap items-center gap-2" dir="ltr">
                <span className="text-xs text-slate-400 font-mono truncate max-w-[200px] sm:max-w-none">
                  {typeof window !== 'undefined' ? `${window.location.origin}/` : ''}
                </span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  className="flex-1 min-w-[120px] rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm font-mono bg-white dark:bg-gray-950"
                  placeholder="my-shop"
                  maxLength={40}
                  disabled={!enabled}
                />
              </div>
            </div>

            {publicUrl && enabled ? (
              <div className="rounded-xl border border-violet-100 bg-violet-50/80 dark:bg-violet-950/30 dark:border-violet-800 p-4 flex flex-wrap items-center gap-3">
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-black text-violet-700 dark:text-violet-300 hover:underline break-all"
                >
                  {publicUrl}
                  <ExternalLink size={14} />
                </a>
                <button
                  type="button"
                  onClick={() => void copyUrl()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-bold text-violet-800 hover:bg-violet-100/80"
                >
                  {copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                  {copied ? 'تم النسخ' : 'نسخ الرابط'}
                </button>
              </div>
            ) : null}

            <div className="pt-4 border-t border-slate-100 dark:border-white/5 space-y-4">
                <div>
                   <h3 className="text-sm font-black text-slate-800 dark:text-white mb-1">بوابات الدفع الإلكتروني</h3>
                   <p className="text-xs text-slate-500 mb-3">ضع رابط فاتورة مفتوح (مثل رابط الدفع عبر Stripe Checkout Link أو PayPal.me). عند تفعيله، سيظهر للزبون كخيار دفع بدلاً من الدفع عند الاستلام حصراً.</p>
                   <input
                      type="url"
                      value={paymentLink}
                      onChange={(e) => setPaymentLink(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950 focus:ring-violet-500 focus:border-violet-500"
                      placeholder="https://buy.stripe.com/test_..."
                      dir="ltr"
                   />
                </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-white/5 space-y-4">
              <h3 className="text-sm font-black text-slate-800 dark:text-white">صور المتجر</h3>

              {/* Hero Image */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-2">صورة الغلاف (Banner)</label>
                {heroImage && (
                  <img src={heroImage} alt="hero" className="w-full h-32 object-cover rounded-xl mb-2 border border-slate-200" />
                )}
                <label className="flex items-center gap-2 cursor-pointer rounded-xl border-2 border-dashed border-slate-200 hover:border-violet-400 px-4 py-3 transition-all">
                  {uploadingHero ? <Loader2 size={18} className="animate-spin text-violet-500" /> : <Upload size={18} className="text-slate-400" />}
                  <span className="text-sm font-bold text-slate-500">{uploadingHero ? 'جاري الرفع...' : 'رفع صورة الغلاف'}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0], 'hero')} />
                </label>
              </div>

              {/* Logo */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-2">لوجو المتجر</label>
                {logoUrl && (
                  <img src={logoUrl} alt="logo" className="h-16 w-16 object-contain rounded-xl mb-2 border border-slate-200 bg-slate-50 p-1" />
                )}
                <label className="flex items-center gap-2 cursor-pointer rounded-xl border-2 border-dashed border-slate-200 hover:border-violet-400 px-4 py-3 transition-all">
                  {uploadingLogo ? <Loader2 size={18} className="animate-spin text-violet-500" /> : <Upload size={18} className="text-slate-400" />}
                  <span className="text-sm font-bold text-slate-500">{uploadingLogo ? 'جاري الرفع...' : 'رفع لوجو المتجر'}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0], 'logo')} />
                </label>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-600 text-white font-black px-6 py-3 hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={20} /> : null}
                حفظ
              </button>
              <Link
                to="/sales"
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 dark:border-white/15 px-6 py-3 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
              >
                حركات المبيعات
              </Link>
            </div>
          </form>
        </div>
      </div>
    </DashboardLayout>
  );
}
