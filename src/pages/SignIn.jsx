import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import SwiftmLogo from '../components/SwiftmLogo.jsx';
import { useToast } from '../context/ToastContext';

import { brandCopyright, brandStorageKey } from '../constants/brand.js';

const REMEMBER_EMAIL_KEY = brandStorageKey('remember-email');
const ONBOARDING_STEPS = [
  { id: 1, title: 'سجّل حسابك', desc: 'أنشئ حساب جديد خلال دقيقة.' },
  { id: 2, title: 'فعّل متجرك', desc: 'نجهز متجرك ليكون جاهزاً للبيع.' },
  { id: 3, title: 'أضف منتجاتك', desc: 'أضف الأصناف والأسعار بسهولة.' },
  { id: 4, title: 'ابدأ البيع', desc: 'استقبل الطلبات وتابع الأداء.' },
];
const PROJECT_HIGHLIGHTS = [
  {
    icon: '💸',
    title: 'أسعار مرنة حسب الباقة',
    desc: 'اختر الباقة المناسبة لحجم نشاطك مع إمكانية الترقية لاحقاً بدون تعقيد.',
  },
  {
    icon: '📦',
    title: 'كتالوج منظم وحديث',
    desc: 'عرض احترافي للمنتجات مع صور واضحة وتصنيفات تسهّل التصفح على الزبائن.',
  },
  {
    icon: '🚚',
    title: 'إدارة طلبات أسرع',
    desc: 'تابع حالة الطلب من الاستلام حتى التسليم من لوحة واحدة ومباشرة.',
  },
  {
    icon: '🧾',
    title: 'طلبات واضحة ومتكاملة',
    desc: 'كل طلب يحتوي بيانات العميل والمنتجات والكميات لتجهيز أدق وأسرع.',
  },
  {
    icon: '🔄',
    title: 'تتبع الطلبات لحظة بلحظة',
    desc: 'اعرف أي طلب جديد أو قيد التنفيذ فوراً بدون ضياع أو تكرار.',
  },
  {
    icon: '🤝',
    title: 'دعم فعلي لفريقك',
    desc: 'نظام مصمم ليكون سهل الاستخدام لفريق المبيعات والمخزن والإدارة.',
  },
];

function HeadingScribble() {
  return (
    <svg
      className="ms-1 inline-block h-8 w-8 shrink-0 text-teal-600/75"
      viewBox="0 0 36 36"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 11c5-8 17-9 21-1s-1 14-9 16-15-1-12-8" />
      <path d="M13 23l-3.5 4.5" />
    </svg>
  );
}

export default function SignIn() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetSending, setResetSending] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const rawFrom = typeof location.state?.from === 'string' ? location.state.from : '/overview';
  const from =
    rawFrom.startsWith('/') && !rawFrom.startsWith('//') ? rawFrom : '/overview';

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_EMAIL_KEY);
      if (saved) {
        setEmail(saved);
        setRememberMe(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const handleForgotPassword = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      toast.warning('يرجى إدخال البريد الإلكتروني أولاً.');
      return;
    }
    setResetSending(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: `${window.location.origin}/signin`,
      });
      if (error) throw error;
      toast.success('تحقق من بريدك — أرسلنا رابط إعادة تعيين كلمة المرور.');
    } catch (err) {
      toast.error(err.message || String(err));
    } finally {
      setResetSending(false);
    }
  };

  const handleSignIn = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      try {
        if (rememberMe) {
          localStorage.setItem(REMEMBER_EMAIL_KEY, email.trim());
        } else {
          localStorage.removeItem(REMEMBER_EMAIL_KEY);
        }
      } catch {
        /* ignore */
      }
      navigate(from === '/signin' ? '/overview' : from, { replace: true });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const fieldClass =
    'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 shadow-[0_2px_8px_rgba(0,0,0,0.06)] outline-none ring-0 transition-all placeholder:text-slate-400 focus:border-indigo-300 focus:border-l-4 focus:border-l-indigo-500 focus:bg-white focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]';

  return (
    <div className="min-h-screen bg-slate-100">
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
      <section
        className="signin-hero-mesh relative overflow-hidden px-4 py-10 sm:py-14"
        style={{
          background:
            'radial-gradient(ellipse at 30% 50%, #1a6fcc 0%, #0a4f92 40%, #062d5f 100%)',
          backgroundSize: '130% 130%',
        }}
      >
        <div className="absolute -right-12 top-10 h-40 w-40 rounded-full bg-white opacity-10 blur-sm" aria-hidden />
        <div className="absolute left-10 top-24 h-24 w-24 rounded-full bg-teal-200 opacity-10" aria-hidden />
        <div className="absolute bottom-8 left-1/3 h-56 w-56 rounded-full bg-indigo-200 opacity-10 blur-md" aria-hidden />
        <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center" dir="rtl">
          <div className="text-white">
            <div className="inline-flex flex-col items-start">
              <SwiftmLogo variant="dark" className="items-start" />
            </div>
            <h1 className="mt-4 text-4xl font-black leading-tight sm:text-5xl">
              <span className="inline-flex flex-col align-middle">
                <span>دليلك الأول</span>
                <span className="mt-2 h-1 w-20 rounded-full bg-teal-400/60 shadow-[0_0_18px_rgba(45,212,191,0.65)]" aria-hidden />
              </span>{' '}
              لإدارة متجرك
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-blue-50/95 sm:text-lg">
              منصة تجارة B2B عربية تجمع إدارة الكتالوج، الطلبات، والمخزون في نظام واحد منظم وسهل.
            </p>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-blue-100/85 sm:text-base">
              رتّب شغلك اليومي، تتبّع كل عملية بيع، وخذ قرارك بثقة من لوحة تحكم واحدة.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                to="/signup"
                className="inline-flex min-w-[9.5rem] items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-black text-[#0a4f92] shadow-lg shadow-blue-950/20 transition-transform hover:-translate-y-0.5"
              >
                سجل كمتجر
              </Link>
              <a
                href="#signin-form"
                className="inline-flex min-w-[9.5rem] items-center justify-center rounded-xl border border-white/45 bg-transparent px-5 py-3 text-sm font-black text-white transition-colors hover:bg-white/10"
              >
                عندي حساب - دخول
              </a>
            </div>
          </div>

          <form
            id="signin-form"
            onSubmit={handleSignIn}
            className="w-full rounded-3xl border-t-4 border-t-indigo-500/25 bg-white px-6 py-7 shadow-2xl shadow-blue-950/25 sm:px-8 sm:py-8"
            dir="rtl"
          >
            <div className="mb-4 ml-4 flex justify-center">
              <SwiftmLogo variant="light" className="justify-center" />
            </div>

            <h2 className="text-center text-xl font-black leading-snug tracking-tight text-slate-900 sm:text-2xl">
              <span className="text-slate-900">تسجيل الدخول إلى </span>
              <span className="inline-flex items-center justify-center gap-0.5 text-teal-700">
                حسابك
                <HeadingScribble />
              </span>
            </h2>

            <p className="mt-2 text-center text-sm text-slate-600">
              ليس لديك حساب؟{' '}
              <Link
                to="/signup"
                className="font-semibold text-blue-600 underline decoration-blue-600/40 underline-offset-2 transition-colors hover:text-blue-700"
              >
                إنشاء حساب
              </Link>
            </p>

            <div className="mt-6 space-y-3.5">
              <input
                type="email"
                dir="ltr"
                autoComplete="email"
                placeholder="example@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={fieldClass}
              />
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  dir="ltr"
                  autoComplete="current-password"
                  placeholder="كلمة المرور"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={`${fieldClass} pl-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute left-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-800"
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  {showPassword ? <EyeOff className="h-[1.05rem] w-[1.05rem]" strokeWidth={2} /> : <Eye className="h-[1.05rem] w-[1.05rem]" strokeWidth={2} />}
                </button>
              </div>
            </div>

            <label className="mt-4 flex cursor-pointer select-none items-center justify-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-400 bg-white text-slate-900 focus:ring-2 focus:ring-slate-400/40"
              />
              تذكرني
            </label>

            <button
              type="submit"
              disabled={loading}
              className="relative mt-5 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-l from-indigo-600 to-violet-700 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:-translate-y-0.5 hover:shadow-indigo-500/35 disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? (
                'جاري تسجيل الدخول…'
              ) : (
                <>
                  <span>دخول</span>
                  <ArrowLeft className="h-4 w-4 stroke-[1.75]" aria-hidden />
                </>
              )}
              {!loading && (
                <span
                  className="pos-checkout-shine pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                  aria-hidden
                />
              )}
            </button>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={resetSending}
                className="text-sm font-medium text-blue-600 underline decoration-blue-600/35 underline-offset-2 transition-colors hover:text-blue-700 disabled:opacity-50"
              >
                {resetSending ? 'جاري الإرسال…' : 'نسيت كلمة المرور؟'}
              </button>
            </div>
          </form>
        </div>
      </section>

      <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-10 sm:py-12">
        <section className="rounded-3xl border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-8" dir="rtl">
          <h2 className="text-center text-3xl font-black text-slate-900">ليش تشتغل مع مشروعنا؟</h2>
          <p className="mt-2 text-center text-sm font-medium text-slate-500">
            كل اللي تحتاجه لإدارة الطلبات والمخزون في نظام واحد.
          </p>

          <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {PROJECT_HIGHLIGHTS.map((item) => (
              <article key={item.title} className="rounded-2xl border border-t-2 border-slate-200 border-t-indigo-500/40 bg-white p-4 text-center transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
                <span className="mb-2 inline-block rounded-xl bg-indigo-50 p-2 text-2xl" aria-hidden>
                  {item.icon}
                </span>
                <h3 className="text-xl font-black text-slate-900">{item.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.desc}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-8" dir="rtl">
          <h2 className="text-center text-3xl font-black text-slate-900">كيف تبدأ؟</h2>
          <p className="mt-2 text-center text-sm font-medium text-slate-500">خطوات بسيطة وسريعة.</p>

          <div className="relative mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="pointer-events-none absolute left-[12.5%] right-[12.5%] top-9 hidden h-px bg-gradient-to-l from-indigo-500/10 via-indigo-500/35 to-violet-500/10 lg:block" aria-hidden />
            {ONBOARDING_STEPS.map((stepItem) => (
              <article key={stepItem.id} className="relative rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
                <div className="relative z-10 mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-base font-black text-white shadow-md shadow-indigo-500/25">
                  {stepItem.id}
                </div>
                <h3 className="text-base font-black text-slate-900">{stepItem.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{stepItem.desc}</p>
              </article>
            ))}
          </div>
        </section>

      </main>

      <footer className="overflow-hidden border-t border-blue-900/30 bg-gradient-to-b from-[#04177a] via-[#03115f] to-[#020a41] text-white">
        <div className="mx-auto max-w-6xl px-4 py-12 text-center sm:px-8">
          <div className="flex justify-center">
            <SwiftmLogo variant="dark" />
          </div>
          <p className="mx-auto mt-5 max-w-xl text-sm text-blue-100/80">
            منصة موحدة لإدارة متجرك، الطلبات، والمخزون بسهولة وسرعة.
          </p>
          <div className="mx-auto mt-6 h-px w-full max-w-md bg-white/15" />
          <p className="mt-4 text-xs text-blue-100/70">
            {brandCopyright()}
          </p>
        </div>
      </footer>
    </div>
  );
}
