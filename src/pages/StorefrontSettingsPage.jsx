import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Copy, Check, Store, ExternalLink, ChevronLeft, Settings, Upload, Image as ImageIcon, Instagram, Facebook } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/;

function TikTokIcon({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
    </svg>
  );
}

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
  const [instagramUrl, setInstagramUrl] = useState('');
  const [facebookUrl, setFacebookUrl] = useState('');
  const [tiktokUrl, setTiktokUrl] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [badgeLowStockEnabled, setBadgeLowStockEnabled] = useState(true);
  const [badgeLowStockThreshold, setBadgeLowStockThreshold] = useState(3);
  const [badgeNewEnabled, setBadgeNewEnabled] = useState(true);
  const [badgeNewDays, setBadgeNewDays] = useState(30);
  const [badgeLimitedEnabled, setBadgeLimitedEnabled] = useState(false);
  const [badgeBestsellerEnabled, setBadgeBestsellerEnabled] = useState(true);
  const [bannerEnabled, setBannerEnabled] = useState(false);
  const [bannerTitle, setBannerTitle] = useState('');
  const [bannerSubtitle, setBannerSubtitle] = useState('');
  const [bannerCtaText, setBannerCtaText] = useState('');
  const [bannerCtaLink, setBannerCtaLink] = useState('');
  const [bannerBgColor, setBannerBgColor] = useState('#1a1b3d');
  const [bannerTextColor, setBannerTextColor] = useState('#ffffff');
  const [primaryColor, setPrimaryColor] = useState('#5B6BF5');
  const [headerColor, setHeaderColor] = useState('#1a1b3d');

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
        .select('public_slug, public_catalog_enabled, hero_image, logo_url, instagram_url, facebook_url, tiktok_url, whatsapp_number, badge_low_stock_enabled, badge_low_stock_threshold, badge_new_enabled, badge_new_days, badge_limited_enabled, badge_bestseller_enabled, banner_enabled, banner_title, banner_subtitle, banner_cta_text, banner_cta_link, banner_bg_color, banner_text_color, primary_color, header_color')
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
      setInstagramUrl((data?.instagram_url ?? '').toString().trim());
      setFacebookUrl((data?.facebook_url ?? '').toString().trim());
      setTiktokUrl((data?.tiktok_url ?? '').toString().trim());
      setWhatsappNumber((data?.whatsapp_number ?? '').toString().trim());
      setBadgeLowStockEnabled(data?.badge_low_stock_enabled ?? true);
      setBadgeLowStockThreshold(data?.badge_low_stock_threshold ?? 3);
      setBadgeNewEnabled(data?.badge_new_enabled ?? true);
      setBadgeNewDays(data?.badge_new_days ?? 30);
      setBadgeLimitedEnabled(data?.badge_limited_enabled ?? false);
      setBadgeBestsellerEnabled(data?.badge_bestseller_enabled ?? true);
      setBannerEnabled(Boolean(data?.banner_enabled));
      setBannerTitle((data?.banner_title ?? '').toString());
      setBannerSubtitle((data?.banner_subtitle ?? '').toString());
      setBannerCtaText((data?.banner_cta_text ?? '').toString());
      setBannerCtaLink((data?.banner_cta_link ?? '').toString());
      setBannerBgColor((data?.banner_bg_color ?? '#1a1b3d').toString());
      setBannerTextColor((data?.banner_text_color ?? '#ffffff').toString());
      setPrimaryColor(data?.primary_color ?? '#5B6BF5');
      setHeaderColor(data?.header_color ?? '#1a1b3d');
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
          instagram_url: instagramUrl.trim() || null,
          facebook_url: facebookUrl.trim() || null,
          tiktok_url: tiktokUrl.trim() || null,
          whatsapp_number: whatsappNumber.trim() || null,
          badge_low_stock_enabled: badgeLowStockEnabled,
          badge_low_stock_threshold: Number(badgeLowStockThreshold),
          badge_new_enabled: badgeNewEnabled,
          badge_new_days: Number(badgeNewDays),
          badge_limited_enabled: badgeLimitedEnabled,
          badge_bestseller_enabled: badgeBestsellerEnabled,
          banner_enabled: bannerEnabled,
          banner_title: bannerTitle.trim() || null,
          banner_subtitle: bannerSubtitle.trim() || null,
          banner_cta_text: bannerCtaText.trim() || null,
          banner_cta_link: bannerCtaLink.trim() || null,
          banner_bg_color: bannerBgColor || '#1a1b3d',
          banner_text_color: bannerTextColor || '#ffffff',
          primary_color: primaryColor,
          header_color: headerColor,
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
              <h3 className="text-sm font-black text-slate-800 dark:text-white">روابط التواصل الاجتماعي</h3>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <Instagram size={14} />
                    رابط Instagram
                  </span>
                </label>
                <input
                  type="url"
                  value={instagramUrl}
                  onChange={(e) => setInstagramUrl(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950 focus:ring-violet-500 focus:border-violet-500"
                  placeholder="https://instagram.com/your_page"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <Facebook size={14} />
                    رابط Facebook
                  </span>
                </label>
                <input
                  type="url"
                  value={facebookUrl}
                  onChange={(e) => setFacebookUrl(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950 focus:ring-violet-500 focus:border-violet-500"
                  placeholder="https://facebook.com/your_page"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <TikTokIcon />
                    رابط TikTok
                  </span>
                </label>
                <input
                  type="url"
                  value={tiktokUrl}
                  onChange={(e) => setTiktokUrl(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950 focus:ring-violet-500 focus:border-violet-500"
                  placeholder="https://tiktok.com/@your_page"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-emerald-500">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.117 1.528 5.845L.057 23.547a.5.5 0 0 0 .609.61l5.857-1.53A11.943 11.943 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.894a9.894 9.894 0 0 1-5.044-1.376l-.361-.214-3.737.977.999-3.645-.235-.374A9.895 9.895 0 0 1 2.106 12C2.106 6.533 6.533 2.106 12 2.106c5.467 0 9.894 4.427 9.894 9.894 0 5.467-4.427 9.894-9.894 9.894z"/>
                    </svg>
                    رقم واتساب (مع رمز الدولة)
                  </span>
                </label>
                <input
                  type="tel"
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(e.target.value.replace(/[^0-9+]/g, ''))}
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950 focus:ring-violet-500 focus:border-violet-500"
                  placeholder="970591234567"
                  dir="ltr"
                />
                <p className="mt-1 text-[11px] text-slate-400">مثال: 970591234567 — بدون + أو مسافات</p>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-white/5 space-y-4">
              <h3 className="text-sm font-black text-slate-800 dark:text-white">شارات المنتجات</h3>
              <p className="text-xs text-slate-400">تظهر على بطاقات المنتجات في المتجر العام</p>

              {/* آخر قطعة */}
              <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-200">🔴 شارة "آخر قطعة"</span>
                    <p className="text-xs text-slate-400 mt-0.5">تظهر لما المخزون أقل من الحد</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={badgeLowStockEnabled}
                    onChange={(e) => setBadgeLowStockEnabled(e.target.checked)}
                    className="h-5 w-5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                </div>
                {badgeLowStockEnabled && (
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-slate-500 shrink-0">الحد الأقصى للمخزون</label>
                    <input
                      type="number"
                      value={badgeLowStockThreshold}
                      onChange={(e) => setBadgeLowStockThreshold(e.target.value)}
                      min="1" max="20"
                      className="w-20 rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-sm bg-white dark:bg-gray-950 focus:ring-violet-500"
                      dir="ltr"
                    />
                    <span className="text-xs text-slate-400">قطعة أو أقل</span>
                  </div>
                )}
              </div>

              {/* جديد */}
              <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-200">🆕 شارة "جديد"</span>
                    <p className="text-xs text-slate-400 mt-0.5">تظهر على المنتجات المضافة حديثاً</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={badgeNewEnabled}
                    onChange={(e) => setBadgeNewEnabled(e.target.checked)}
                    className="h-5 w-5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                </div>
                {badgeNewEnabled && (
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-slate-500 shrink-0">خلال آخر</label>
                    <input
                      type="number"
                      value={badgeNewDays}
                      onChange={(e) => setBadgeNewDays(e.target.value)}
                      min="1" max="365"
                      className="w-20 rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-sm bg-white dark:bg-gray-950 focus:ring-violet-500"
                      dir="ltr"
                    />
                    <span className="text-xs text-slate-400">يوم</span>
                  </div>
                )}
              </div>

              {/* عرض محدود */}
              <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-200">⚡ شارة "عرض محدود"</span>
                    <p className="text-xs text-slate-400 mt-0.5">تظهر على كل المنتجات التي عليها خصم</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={badgeLimitedEnabled}
                    onChange={(e) => setBadgeLimitedEnabled(e.target.checked)}
                    className="h-5 w-5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                </div>
              </div>

              {/* الأكثر مبيعاً */}
              <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-200">🔥 شارة "الأكثر مبيعاً"</span>
                    <p className="text-xs text-slate-400 mt-0.5">تظهر على أعلى 5 منتجات بالمبيعات</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={badgeBestsellerEnabled}
                    onChange={(e) => setBadgeBestsellerEnabled(e.target.checked)}
                    className="h-5 w-5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-white/5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-slate-800 dark:text-white">بانر إعلاني</h3>
                  <p className="text-xs text-slate-400 mt-0.5">شريط ترويجي يظهر أعلى المتجر العام</p>
                </div>
                <input
                  type="checkbox"
                  checked={bannerEnabled}
                  onChange={(e) => setBannerEnabled(e.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                />
              </div>

              {bannerEnabled && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">العنوان الرئيسي</label>
                    <input
                      type="text"
                      value={bannerTitle}
                      onChange={(e) => setBannerTitle(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950 focus:ring-violet-500 focus:border-violet-500"
                      placeholder="مثال: خصم 20% على كل المنتجات"
                      maxLength={80}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">النص الفرعي (اختياري)</label>
                    <input
                      type="text"
                      value={bannerSubtitle}
                      onChange={(e) => setBannerSubtitle(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950 focus:ring-violet-500 focus:border-violet-500"
                      placeholder="مثال: العرض ساري حتى نهاية الشهر"
                      maxLength={120}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">نص الزر (اختياري)</label>
                      <input
                        type="text"
                        value={bannerCtaText}
                        onChange={(e) => setBannerCtaText(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950 focus:ring-violet-500 focus:border-violet-500"
                        placeholder="تسوق الآن"
                        maxLength={30}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">رابط الزر</label>
                      <input
                        type="text"
                        value={bannerCtaLink}
                        onChange={(e) => setBannerCtaLink(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950 focus:ring-violet-500 focus:border-violet-500"
                        placeholder="#products"
                        dir="ltr"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">لون الخلفية</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={bannerBgColor}
                          onChange={(e) => setBannerBgColor(e.target.value)}
                          className="h-10 w-14 rounded-lg border border-slate-200 dark:border-white/10 cursor-pointer bg-white dark:bg-gray-950 p-1"
                        />
                        <span className="font-mono text-xs text-slate-500" dir="ltr">{bannerBgColor}</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">لون النص</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={bannerTextColor}
                          onChange={(e) => setBannerTextColor(e.target.value)}
                          className="h-10 w-14 rounded-lg border border-slate-200 dark:border-white/10 cursor-pointer bg-white dark:bg-gray-950 p-1"
                        />
                        <span className="font-mono text-xs text-slate-500" dir="ltr">{bannerTextColor}</span>
                      </div>
                    </div>
                  </div>
                  {/* معاينة */}
                  <div
                    className="rounded-xl px-4 py-3 flex flex-wrap items-center justify-center gap-3 text-center"
                    style={{ backgroundColor: bannerBgColor, color: bannerTextColor }}
                  >
                    <div>
                      <p className="text-sm font-black">{bannerTitle || 'العنوان الرئيسي'}</p>
                      {bannerSubtitle && <p className="text-xs opacity-80 mt-0.5">{bannerSubtitle}</p>}
                    </div>
                    {bannerCtaText && (
                      <span
                        className="text-xs font-bold px-4 py-1.5 rounded-full"
                        style={{ backgroundColor: bannerTextColor, color: bannerBgColor }}
                      >
                        {bannerCtaText}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-white/5 space-y-4">
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-white">🎨 ألوان المتجر</h3>
                <p className="text-xs text-slate-400 mt-0.5">تطبّق على الأزرار والأسعار والهيدر</p>
              </div>

              {/* Preview */}
              <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-white/10">
                <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: headerColor }}>
                  <span className="text-white text-sm font-bold">اسم المتجر</span>
                  <div className="flex gap-2">
                    <div className="w-6 h-6 rounded-full bg-white/20" />
                    <div className="w-6 h-6 rounded-full bg-white/20" />
                  </div>
                </div>
                <div className="p-4 bg-white flex items-center gap-3">
                  <div className="w-16 h-16 rounded-lg bg-slate-100" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-slate-100 rounded w-3/4" />
                    <div className="h-3 rounded w-1/3" style={{ backgroundColor: primaryColor + '40' }} />
                    <div className="h-7 rounded-lg w-full mt-2 flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: primaryColor }}>
                      إضافة للسلة
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">اللون الرئيسي (أزرار وأسعار)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="h-10 w-14 rounded-lg border border-slate-200 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="flex-1 rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950 font-mono"
                      dir="ltr"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">لون الهيدر</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={headerColor}
                      onChange={(e) => setHeaderColor(e.target.value)}
                      className="h-10 w-14 rounded-lg border border-slate-200 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={headerColor}
                      onChange={(e) => setHeaderColor(e.target.value)}
                      className="flex-1 rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950 font-mono"
                      dir="ltr"
                    />
                  </div>
                </div>
              </div>

              {/* Reset */}
              <button
                type="button"
                onClick={() => { setPrimaryColor('#5B6BF5'); setHeaderColor('#1a1b3d'); }}
                className="text-xs text-slate-400 hover:text-violet-600 transition-colors"
              >
                إعادة تعيين الألوان الافتراضية
              </button>
            </div>

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
