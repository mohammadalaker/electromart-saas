import { Link } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import SwiftmLogo from '../components/SwiftmLogo.jsx';
import { BRAND_NAME, BRAND_TAGLINE_AR } from '../constants/brand.js';

/**
 * صفحة توضيحية عند زيارة /my-store بدون معرّف متجر.
 */
export default function PublicStoreLanding() {
  return (
    <div
      className="min-h-screen bg-gradient-to-br from-violet-950 via-slate-900 to-indigo-950 text-white flex flex-col items-center justify-center p-6"
      dir="rtl"
    >
      <div className="max-w-md w-full rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md p-8 shadow-2xl text-center space-y-4">
        <SwiftmLogo compact showTagline={false} color="#ffffff" className="mx-auto" />
        <p className="text-xs font-semibold tracking-[0.35em] text-violet-200/80" dir="ltr">
          {BRAND_TAGLINE_AR}
        </p>
        <h1 className="text-2xl font-black">متجر أونلاين — {BRAND_NAME}</h1>
        <p className="text-sm text-slate-300 leading-relaxed">
          افتح الرابط الكامل الذي يشاركه معك التاجر (يحتوي على اسم المتجر في نهاية العنوان). هذا العنوان
          للاستخدام العام ولا يتطلّب تسجيل دخول.
        </p>
        <p className="text-xs text-slate-500 font-mono break-all" dir="ltr">
          مثال: …/my-store/اسم-متجرك
        </p>
        <Link
          to="/signin"
          className="inline-flex items-center justify-center gap-2 w-full rounded-2xl bg-white text-violet-950 font-black py-3.5 hover:bg-violet-100 transition-colors"
        >
          <LogIn size={18} />
          دخول التجار (لوحة التحكم)
        </Link>
      </div>
    </div>
  );
}
