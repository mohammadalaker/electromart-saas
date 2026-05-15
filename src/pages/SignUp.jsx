import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useNavigate, Link } from 'react-router-dom';
import { Building2, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import SwiftmLogo from '../components/SwiftmLogo.jsx';
import { BRAND_TAGLINE_EN } from '../constants/brand.js';

// Tracks which step of the two-phase SaaS signup is active.
const STEPS = {
  IDLE: 'idle',
  AUTH: 'auth',       // Step 1 — creating the Auth user
  STORE: 'store',     // Step 2 — creating the store record
};

const ONBOARDING_STEPS = [
  {
    id: 1,
    title: 'سجّل حسابك',
    desc: 'أنشئ حسابك وربط بيانات متجرك خلال دقيقة.',
  },
  {
    id: 2,
    title: 'فعّل متجرك',
    desc: 'يتم تجهيز متجرك تلقائياً ليكون جاهزاً للبيع.',
  },
  {
    id: 3,
    title: 'أضف منتجاتك',
    desc: 'استورد أو أضف منتجاتك بسرعة مع صور وأسعار.',
  },
  {
    id: 4,
    title: 'ابدأ البيع',
    desc: 'استقبل الطلبات وراقب الأداء من لوحة واحدة.',
  },
];

export default function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [storeName, setStoreName] = useState('');
  const [step, setStep] = useState(STEPS.IDLE);
  const [error, setError] = useState('');
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const loading = step !== STEPS.IDLE;
  const heroBackgroundStyle = {
    background:
      'radial-gradient(ellipse at 30% 50%, #1a6fcc 0%, #0a4f92 40%, #062d5f 100%)',
    backgroundSize: '130% 130%',
  };
  const meshAndShineStyles = (
    <style>{`
      @keyframes signInHeroMesh {
        0%, 100% { background-position: 30% 50%; }
        50% { background-position: 48% 42%; }
      }
      .signin-hero-mesh {
        animation: signInHeroMesh 12s ease-in-out infinite;
      }
      @keyframes posCheckoutShine {
        0% { transform: translateX(-170%) skewX(-18deg); }
        45%, 100% { transform: translateX(420%) skewX(-18deg); }
      }
      .pos-checkout-shine {
        animation: posCheckoutShine 2.6s ease-in-out infinite;
      }
    `}</style>
  );
  const fieldClass =
    'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-900 shadow-[0_2px_8px_rgba(0,0,0,0.06)] outline-none ring-0 transition-all placeholder:text-slate-400 focus:border-indigo-300 focus:border-l-4 focus:border-l-indigo-500 focus:bg-white focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] disabled:opacity-60';

  const handleSignUp = async (e) => {
    e.preventDefault();
    setError('');
    const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // ── Step 1: Create the Auth user ────────────────────────────────────────
    setStep(STEPS.AUTH);
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setStep(STEPS.IDLE);
      return;
    }

    const user = authData?.user;

    if (!user) {
      // Edge case: Supabase returned no user and no error (e.g. duplicate email
      // when "Prevent duplicate signups" is off). Treat as already-registered.
      setError('هذا البريد الإلكتروني مسجل مسبقاً. حاول تسجيل الدخول.');
      setStep(STEPS.IDLE);
      return;
    }

    // ── Step 2: Create the store record linked to the new user ───────────────
    setStep(STEPS.STORE);
    const { error: storeError } = await supabase.from('stores').insert({
      name: storeName.trim(),
      owner_id: user.id,   // FK → auth.users.id  (the SaaS ownership link)
      plan: 'trial',
      trial_ends_at: trialEndsAt,
    });

    if (storeError) {
      // The Auth user was created successfully. The store insert failed.
      // We surface a specific message so the user knows their account exists
      // and can contact support or retry — rather than silently losing data.
      setError(
        `تم إنشاء الحساب بنجاح، لكن فشل إنشاء المتجر: ${storeError.message}. ` +
        'يرجى التواصل مع الدعم أو تسجيل الدخول والمحاولة مرة أخرى.'
      );
      setStep(STEPS.IDLE);
      return;
    }

    setStep(STEPS.IDLE);

    // ── Post-signup: handle email-confirmation vs. instant-access ────────────
    // When Supabase requires email confirmation, session is null even though
    // the user object exists. Navigating to /inventory would fail in that case.
    if (!authData.session) {
      setAwaitingConfirmation(true);
    } else {
      navigate('/overview');
    }
  };

  // Shown after signup when Supabase requires email confirmation
  if (awaitingConfirmation) {
    return (
      <div
        className="signin-hero-mesh relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4"
        style={heroBackgroundStyle}
      >
        {meshAndShineStyles}
        <div className="absolute -right-12 top-10 h-40 w-40 rounded-full bg-white opacity-10 blur-sm" aria-hidden />
        <div className="absolute left-10 top-24 h-24 w-24 rounded-full bg-teal-200 opacity-10" aria-hidden />
        <div className="absolute bottom-8 left-1/3 h-56 w-56 rounded-full bg-indigo-200 opacity-10 blur-md" aria-hidden />
        <div
          className="relative z-10 w-full max-w-sm rounded-3xl border border-slate-200/80 border-t-4 border-t-indigo-500/25 bg-white p-8 text-center shadow-2xl shadow-blue-950/25 sm:p-9"
          dir="rtl"
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 ring-1 ring-indigo-100">
            <span className="text-2xl" aria-hidden>
              📧
            </span>
          </div>
          <h2 className="mb-2 bg-gradient-to-l from-indigo-950 to-indigo-600 bg-clip-text text-lg font-bold tracking-tight text-transparent">
            تحقق من بريدك الإلكتروني
          </h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            أرسلنا رابط التفعيل إلى{' '}
            <span className="font-semibold text-slate-700" dir="ltr">{email}</span>.
            <br />
            افتح البريد وانقر على الرابط لتفعيل متجرك.
          </p>
          <Link
            to="/signin"
            className="mt-6 inline-block text-sm font-semibold text-indigo-600 underline-offset-4 transition-colors hover:text-indigo-800 hover:underline"
          >
            العودة إلى تسجيل الدخول
          </Link>
        </div>
      </div>
    );
  }

  const stepLabel =
    step === STEPS.AUTH
      ? '① جاري إنشاء الحساب...'
      : step === STEPS.STORE
      ? '② جاري إنشاء المتجر...'
      : 'ابدأ الآن مجاناً';

  return (
    <div className="min-h-screen bg-slate-100">
      {meshAndShineStyles}
      <section
        className="signin-hero-mesh relative min-h-screen overflow-hidden px-4 py-10 sm:px-6 sm:py-14 lg:px-8"
        style={heroBackgroundStyle}
      >
        <div className="absolute -right-12 top-10 h-40 w-40 rounded-full bg-white opacity-10 blur-sm" aria-hidden />
        <div className="absolute left-10 top-24 h-24 w-24 rounded-full bg-teal-200 opacity-10" aria-hidden />
        <div className="absolute bottom-8 left-1/3 h-56 w-56 rounded-full bg-indigo-200 opacity-10 blur-md" aria-hidden />
        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-6xl items-center">
          <div className="grid w-full gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-12">
            <section
              className="text-white"
              dir="rtl"
            >
            <div className="inline-flex flex-col items-start">
              <SwiftmLogo compact showTagline={false} color="#ffffff" />
              <span className="mt-2 text-[0.72rem] font-semibold tracking-[0.45em] text-blue-100/75" dir="ltr">
                {BRAND_TAGLINE_EN}
              </span>
            </div>
            <p className="mt-8 text-xs font-bold uppercase tracking-widest text-teal-200/90">30 يوم تجربة مجانية</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-white sm:text-5xl">أنشئ متجرك الآن</h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-blue-50/90 sm:text-lg">
              ابدأ تجربة كاملة لمدة 30 يوم لإدارة الطلبات، المنتجات، والمخزون من لوحة واحدة بدون تعقيد.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {ONBOARDING_STEPS.map((stepItem) => (
                <article
                  key={stepItem.id}
                  className="flex gap-3 rounded-2xl border border-white/15 bg-white/10 p-3 text-start shadow-sm backdrop-blur-sm"
                >
                  <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-black text-white shadow-md shadow-indigo-950/20">
                    {stepItem.id}
                  </div>
                  <div>
                    <h2 className="text-base font-black text-white">{stepItem.title}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-blue-50/80">{stepItem.desc}</p>
                  </div>
                </article>
              ))}
            </div>

            <div className="mt-6 inline-flex rounded-full border border-white/20 bg-white/10 px-4 py-2 shadow-sm backdrop-blur-sm">
              <p className="text-sm font-bold text-blue-50">
                بدون بطاقة بنكية - يمكنك الإلغاء في أي وقت - دعم عربي كامل.
              </p>
            </div>
            </section>

            <form
              onSubmit={handleSignUp}
              className="w-full rounded-3xl border border-slate-200/80 border-t-4 border-t-indigo-500/25 bg-white p-8 shadow-2xl shadow-blue-950/25 sm:p-9"
              dir="rtl"
            >
            {/* Logo / brand */}
            <div className="mb-8 flex flex-col items-center gap-2">
              <SwiftmLogo showTagline={false} compact />
              <p className="text-slate-500 text-[0.8125rem] font-medium leading-snug text-center max-w-[16rem]">
                إنشاء حساب تاجر جديد
              </p>
            </div>

            {/* Inline error banner */}
            {error && (
              <div className="mb-5 rounded-xl border border-red-200/90 bg-red-50 p-3.5 text-sm leading-relaxed text-red-900">
                {error}
              </div>
            )}

            {/* Store name */}
            <div className="mb-5">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                اسم المحل / الشركة
              </label>
              <div className="group relative">
                <Building2
                  className="pointer-events-none absolute right-3.5 top-1/2 h-[1.125rem] w-[1.125rem] -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-indigo-600"
                  strokeWidth={2}
                />
                <input
                  type="text"
                  placeholder="مثلاً: متجر الأجهزة الذكية"
                  className={`${fieldClass} pl-4 pr-11`}
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
            </div>

            {/* Email */}
            <div className="mb-5">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                البريد الإلكتروني
              </label>
              <div className="group relative">
                <Mail
                  className="pointer-events-none absolute left-3.5 top-1/2 h-[1.125rem] w-[1.125rem] -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-indigo-600"
                  strokeWidth={2}
                />
                <input
                  type="email"
                  placeholder="you@example.com"
                  dir="ltr"
                  autoComplete="email"
                  className={`${fieldClass} pl-11 pr-4`}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
            </div>

            {/* Password */}
            <div className="mb-6">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                كلمة المرور
              </label>
              <div className="group relative">
                <Lock
                  className="pointer-events-none absolute left-3.5 top-1/2 h-[1.125rem] w-[1.125rem] -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-indigo-600"
                  strokeWidth={2}
                />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="6 أحرف على الأقل"
                  dir="ltr"
                  autoComplete="new-password"
                  className={`${fieldClass} pl-11 pr-12`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={loading}
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 disabled:pointer-events-none disabled:opacity-50"
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  {showPassword ? <EyeOff className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} /> : <Eye className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />}
                </button>
              </div>
            </div>

            {/* Step progress indicator */}
            {loading && (
              <div className="mb-4 flex items-center gap-3">
                <div className="flex gap-1.5">
                  <span
                    className={`h-2.5 w-2.5 rounded-full transition-colors ${
                      step === STEPS.AUTH ? 'animate-pulse bg-indigo-600' : 'bg-indigo-200'
                    }`}
                  />
                  <span
                    className={`h-2.5 w-2.5 rounded-full transition-colors ${
                      step === STEPS.STORE ? 'animate-pulse bg-indigo-600' : 'bg-indigo-200'
                    }`}
                  />
                </div>
                <span className="text-xs text-slate-500">{stepLabel}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="relative w-full overflow-hidden rounded-xl bg-gradient-to-l from-indigo-600 to-violet-700 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:-translate-y-0.5 hover:shadow-indigo-500/35 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
            >
              {stepLabel}
              {!loading && (
                <span
                  className="pos-checkout-shine pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                  aria-hidden
                />
              )}
            </button>

            <p className="mt-6 text-center text-sm text-slate-500">
              لديك حساب بالفعل؟{' '}
              <Link
                to="/signin"
                className="font-semibold text-indigo-600 underline-offset-4 transition-colors hover:text-indigo-800 hover:underline"
              >
                تسجيل الدخول
              </Link>
            </p>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
