import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Check, 
  ChevronDown, 
  ChevronUp, 
  Menu, 
  X, 
  ArrowLeft,
  ArrowRight,
  ShoppingCart, 
  Package, 
  Globe, 
  Calculator, 
  Users, 
  BarChart3,
  Shield,
  Clock,
  MessageSquare
} from 'lucide-react';

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  // Handle sticky header background change
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 20) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const toggleFaq = (index) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  const faqData = [
    {
      q: "هل يوجد عقد طويل الأمد؟",
      a: "لا، لا يوجد أي التزام طويل الأمد أو عقود مخفية. يمكنك الإلغاء أو تعديل باقتك في أي وقت تريده مباشرة من لوحة التحكم."
    },
    {
      q: "هل بياناتي آمنة؟",
      a: "نعم، نستخدم تشفيراً كاملاً من الطرفين (End-to-End Encryption) ونحتفظ بنسخ احتياطية تلقائية يومية على خوادم سحابية آمنة ومحمية للغاية."
    },
    {
      q: "هل يمكنني تغيير الباقة لاحقاً؟",
      a: "نعم، بكل تأكيد! يمكنك ترقية اشتراكك أو خفضه في أي وقت وسيقوم النظام بتسوية الفروقات المالية المتبقية تلقائياً."
    },
    {
      q: "هل يدعم النظام اللغة العربية؟",
      a: "نعم، منصة سويفتم مصممة ومبنية بالكامل للغة العربية في المقام الأول، مع واجهات وتدفقات عمل متكاملة متوافقة مع متطلبات السوق المحلي."
    },
    {
      q: "ما هي طرق الدفع المتاحة؟",
      a: "نقبل التحويل البنكي المباشر، الدفع عبر بطاقات الائتمان المختلفة (فيزا، ماستركارد)، وعن طريق حساب PayPal لتسهيل تسوية الاشتراكات."
    }
  ];

  const features = [
    {
      title: "نقطة البيع (POS)",
      desc: "نظام كاشير سريع وموثوق يدعم طباعة الفواتير الفورية وإدارة المبيعات اليومية بكفاءة عالية وبخطوات بسيطة.",
      icon: ShoppingCart,
    },
    {
      title: "إدارة المخزون",
      desc: "تتبع مستويات المنتجات والكميات لحظة بلحظة، مع إمكانية إدارة مستودعات متعددة وتلقي تنبيهات عند اقتراب نفاد المخزون.",
      icon: Package,
    },
    {
      title: "متجر إلكتروني",
      desc: "واجهة متجر إلكتروني عامة لعملائك لطلب وتصفح البضائع مباشرة من مخزنك، ومزامنة الفواتير والمبيعات تلقائياً.",
      icon: Globe,
    },
    {
      title: "نظام محاسبي",
      desc: "نظام محاسبي متكامل ومبسط لإصدار قيود اليومية، دليل الحسابات، ميزان المراجعة، ومراقبة الميزانيات وقوائم الدخل.",
      icon: Calculator,
    },
    {
      title: "إدارة العملاء",
      desc: "تتبع حسابات العملاء، المديونيات والذمم، كشوفات الحساب، وسجل المشتريات والمدفوعات لتسهيل التحصيل المالي.",
      icon: Users,
    },
    {
      title: "تقارير ذكية",
      desc: "تحليلات ورسوم بيانية ذكية وواضحة توضح أداء المبيعات، الأرباح، والخسائر لمساعدتك في اتخاذ قراراتك وتطوير عملك.",
      icon: BarChart3,
    }
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900 selection:bg-indigo-100 selection:text-indigo-900 scroll-smooth" dir="rtl">
      
      {/* 1. NAVBAR */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled 
          ? 'bg-white/95 backdrop-blur-md border-b border-slate-200 py-4 shadow-md' 
          : 'bg-white/80 backdrop-blur-sm border-b border-slate-100 py-5 shadow-sm'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center">
              <Link to="/" className="flex items-center gap-3">
                <img src="/logo.png" className="h-8 w-auto" />
                <span className="text-2xl font-black tracking-tight text-slate-900 font-sans">Swiftm</span>
              </Link>
            </div>

            {/* Desktop Navigation Links */}
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-sm font-medium text-slate-600 hover:text-indigo-600 transition-colors">المميزات</a>
              <a href="#pricing" className="text-sm font-medium text-slate-600 hover:text-indigo-600 transition-colors">الباقات</a>
              <a href="#faq" className="text-sm font-medium text-slate-600 hover:text-indigo-600 transition-colors">الأسئلة الشائعة</a>
            </div>

            {/* Action Buttons */}
            <div className="hidden md:flex items-center gap-4">
              <Link to="/login" className="text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors">تسجيل دخول</Link>
              <Link to="/register" className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 transition-all hover:shadow-lg hover:shadow-indigo-600/20">ابدأ مجاناً</Link>
            </div>

            {/* Mobile menu toggle */}
            <div className="md:hidden flex items-center">
              <button 
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} 
                className="text-slate-600 hover:text-slate-900 p-2 rounded-lg"
                aria-label="Toggle menu"
              >
                {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        <div className={`md:hidden fixed inset-x-0 top-[80px] bg-white border-b border-slate-200 p-6 space-y-4 shadow-xl transition-all duration-300 transform ${
          isMobileMenuOpen ? 'opacity-100 translate-y-0 visible' : 'opacity-0 -translate-y-4 invisible'
        }`}>
          <div className="flex flex-col gap-4">
            <a 
              href="#features" 
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-base font-semibold text-slate-600 hover:text-indigo-600 py-2"
            >
              المميزات
            </a>
            <a 
              href="#pricing" 
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-base font-semibold text-slate-600 hover:text-indigo-600 py-2"
            >
              الباقات
            </a>
            <a 
              href="#faq" 
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-base font-semibold text-slate-600 hover:text-indigo-600 py-2"
            >
              الأسئلة الشائعة
            </a>
            <hr className="border-slate-100" />
            <div className="flex flex-col gap-3 pt-2">
              <Link 
                to="/login" 
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center justify-center py-3 rounded-xl text-base font-bold text-slate-600 hover:text-slate-900 border border-slate-200 bg-slate-50"
              >
                تسجيل دخول
              </Link>
              <Link 
                to="/register" 
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center justify-center py-3 rounded-xl text-base font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/20"
              >
                ابدأ مجاناً
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* 2. HERO SECTION */}
      <section className="relative overflow-hidden pt-32 pb-24 md:pt-40 md:pb-32 text-slate-900" style={{ background: "linear-gradient(135deg, #f8f7ff 0%, #ede9fe 50%, #e0e7ff 100%)" }}>
        {/* Background glow animations */}
        <div className="absolute inset-0 z-0 opacity-30 pointer-events-none">
          <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-indigo-200/50 filter blur-[120px]" />
          <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-purple-200/50 filter blur-[100px]" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-4xl mx-auto space-y-8">
            {/* Badge Pill */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-600/10 border border-indigo-600/20 text-indigo-600 text-sm font-bold tracking-wide shadow-inner">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-600"></span>
              </span>
              منصة إدارة الأعمال الذكية 🚀
            </div>

            {/* H1 Heading */}
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-tight text-[#1e1b4b]">
              أدِر متجرك وحساباتك <br className="hidden sm:inline" />
              <span className="text-indigo-600">من مكان واحد</span>
            </h1>

            {/* Subtext */}
            <p className="text-lg sm:text-xl text-[#4b5563] max-w-2xl mx-auto leading-relaxed">
              Swiftm منصة SaaS متكاملة تجمع بين إدارة المتجر ونقطة البيع والنظام المحاسبي في مكان واحد، لتنظيم عملياتك وزيادة أرباحك بكل سهولة.
            </p>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <Link 
                to="/register" 
                className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 rounded-2xl text-base font-bold text-white bg-indigo-600 hover:bg-indigo-500 transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-indigo-600/20"
              >
                ابدأ تجربتك المجانية - 14 يوم
              </Link>
              <a 
                href="#features" 
                className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 rounded-2xl text-base font-bold text-indigo-600 border-2 border-indigo-600 bg-white hover:bg-indigo-50 transition-all"
              >
                شاهد المميزات
              </a>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-16 max-w-3xl mx-auto">
              <div className="p-6 rounded-2xl bg-white border border-slate-100 shadow-md hover:shadow-lg transition-shadow flex flex-col items-center">
                <span className="text-3xl font-black text-indigo-600">+500</span>
                <span className="text-sm font-medium text-slate-600 mt-2">متجر نشط</span>
              </div>
              <div className="p-6 rounded-2xl bg-white border border-slate-100 shadow-md hover:shadow-lg transition-shadow flex flex-col items-center">
                <span className="text-3xl font-black text-indigo-600">99.9%</span>
                <span className="text-sm font-medium text-slate-600 mt-2">وقت تشغيل</span>
              </div>
              <div className="p-6 rounded-2xl bg-white border border-slate-100 shadow-md hover:shadow-lg transition-shadow flex flex-col items-center">
                <span className="text-3xl font-black text-indigo-600">24/7</span>
                <span className="text-sm font-medium text-slate-600 mt-2">دعم متواصل</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. FEATURES SECTION */}
      <section className="py-24 bg-white" id="features">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
            <span className="text-sm font-bold text-indigo-600 uppercase tracking-widest">ميزات المنصة</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              كل ما تحتاجه في منصة واحدة
            </h2>
            <p className="text-lg text-slate-600">
              قمنا بتوفير جميع الأدوات اللازمة لمساعدتك في أتمتة أعمالك اليومية، المحاسبية والمبيعات.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, idx) => {
              const IconComp = feature.icon;
              return (
                <div 
                  key={idx} 
                  className="p-8 rounded-3xl border border-slate-100 bg-white hover:border-indigo-100 hover:shadow-xl transition-all duration-300 group flex flex-col items-start"
                >
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-all duration-300 mb-6">
                    <IconComp size={24} />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-3">{feature.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-600">{feature.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 4. PRICING SECTION */}
      <section className="py-24 bg-slate-50 border-y border-slate-100" id="pricing">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
            <span className="text-sm font-bold text-indigo-600 uppercase tracking-widest">خطط الاشتراك</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              باقات تناسب كل عمل
            </h2>
            <p className="text-lg text-slate-600">
              جرب مجاناً 14 يوم بدون بطاقة ائتمان. اختر الخطة الأنسب لعملك اليوم.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch max-w-6xl mx-auto">
            {/* STARTER Plan */}
            <div className="p-8 sm:p-10 rounded-3xl border border-slate-200/60 bg-white flex flex-col justify-between shadow-sm hover:shadow-lg transition-all">
              <div className="space-y-6">
                <div>
                  <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">STARTER</span>
                  <div className="flex items-baseline mt-4">
                    <span className="text-4xl font-black text-slate-900">49₪</span>
                    <span className="text-sm text-slate-500 mr-2">/ شهر</span>
                  </div>
                </div>
                <hr className="border-slate-100" />
                <ul className="space-y-4">
                  {[
                    "نقطة البيع (POS)",
                    "إدارة المخزون",
                    "متجر إلكتروني",
                    "تقارير المبيعات",
                    "دعم واتساب"
                  ].map((feat, idx) => (
                    <li key={idx} className="flex items-center gap-3 text-sm text-slate-600">
                      <span className="w-5 h-5 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 flex-shrink-0">
                        <Check size={12} strokeWidth={3} />
                      </span>
                      {feat}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="pt-8">
                <Link 
                  to="/register" 
                  className="w-full inline-flex items-center justify-center px-6 py-3.5 rounded-2xl text-sm font-bold text-indigo-600 border border-indigo-200 hover:border-indigo-600 hover:bg-indigo-50 transition-all text-center"
                >
                  ابدأ مجاناً
                </Link>
              </div>
            </div>

            {/* BUSINESS Plan (Indigo card - POPULAR) */}
            <div className="p-8 sm:p-10 rounded-3xl bg-indigo-600 text-white flex flex-col justify-between shadow-xl shadow-indigo-600/20 hover:scale-[1.02] transition-all relative">
              <div className="absolute top-4 left-6 bg-indigo-500 text-white text-xs font-black px-3.5 py-1 rounded-full uppercase tracking-wider">
                الأكثر شعبية
              </div>
              <div className="space-y-6">
                <div>
                  <span className="text-sm font-bold text-indigo-200 uppercase tracking-wider">BUSINESS</span>
                  <div className="flex items-baseline mt-4">
                    <span className="text-4xl font-black">99₪</span>
                    <span className="text-sm text-indigo-200 mr-2">/ شهر</span>
                  </div>
                </div>
                <hr className="border-indigo-500/50" />
                <ul className="space-y-4">
                  {[
                    "كل مميزات Starter",
                    "نظام محاسبي كامل",
                    "قيود وتقارير مالية",
                    "ميزان المراجعة",
                    "أولوية في الدعم",
                    "نسخ احتياطي تلقائي"
                  ].map((feat, idx) => (
                    <li key={idx} className="flex items-center gap-3 text-sm text-indigo-50">
                      <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-white flex-shrink-0">
                        <Check size={12} strokeWidth={3} />
                      </span>
                      {feat}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="pt-8">
                <Link 
                  to="/register" 
                  className="w-full inline-flex items-center justify-center px-6 py-3.5 rounded-2xl text-sm font-bold text-indigo-600 bg-white hover:bg-slate-50 active:bg-slate-100 transition-all text-center"
                >
                  ابدأ مجاناً
                </Link>
              </div>
            </div>

            {/* ACCOUNTING Plan */}
            <div className="p-8 sm:p-10 rounded-3xl border border-slate-200/60 bg-white flex flex-col justify-between shadow-sm hover:shadow-lg transition-all">
              <div className="space-y-6">
                <div>
                  <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">ACCOUNTING</span>
                  <div className="flex items-baseline mt-4">
                    <span className="text-4xl font-black text-slate-900">69₪</span>
                    <span className="text-sm text-slate-500 mr-2">/ شهر</span>
                  </div>
                </div>
                <hr className="border-slate-100" />
                <ul className="space-y-4">
                  {[
                    "دليل الحسابات",
                    "القيود اليومية",
                    "الأستاذ العام",
                    "ميزان المراجعة",
                    "قوائم مالية كاملة",
                    "دعم واتساب"
                  ].map((feat, idx) => (
                    <li key={idx} className="flex items-center gap-3 text-sm text-slate-600">
                      <span className="w-5 h-5 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 flex-shrink-0">
                        <Check size={12} strokeWidth={3} />
                      </span>
                      {feat}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="pt-8">
                <Link 
                  to="/register" 
                  className="w-full inline-flex items-center justify-center px-6 py-3.5 rounded-2xl text-sm font-bold text-indigo-600 border border-indigo-200 hover:border-indigo-600 hover:bg-indigo-50 transition-all text-center"
                >
                  ابدأ مجاناً
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. FAQ SECTION */}
      <section className="py-24 bg-white" id="faq">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 space-y-4">
            <span className="text-sm font-bold text-indigo-600 uppercase tracking-widest">الأسئلة الشائعة</span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900">
              إجابات لأبرز استفساراتك
            </h2>
            <p className="text-lg text-slate-600">
              كل ما تود معرفته عن منصة سويفتم وبوابات الاشتراك.
            </p>
          </div>

          <div className="space-y-4">
            {faqData.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div 
                  key={idx} 
                  className="border border-slate-100 rounded-2xl bg-slate-50/50 overflow-hidden transition-all duration-300"
                >
                  <button 
                    onClick={() => toggleFaq(idx)}
                    className="w-full flex items-center justify-between p-6 text-right font-bold text-base sm:text-lg text-slate-900 hover:text-indigo-600 transition-colors"
                  >
                    <span>{faq.q}</span>
                    <span className="w-8 h-8 rounded-full bg-white border border-slate-100 flex items-center justify-center text-slate-400">
                      {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </span>
                  </button>
                  <div className={`transition-all duration-300 overflow-hidden ${
                    isOpen ? 'max-h-60 border-t border-slate-100/80 p-6 bg-white' : 'max-h-0'
                  }`}>
                    <p className="text-sm sm:text-base leading-relaxed text-slate-600">{faq.a}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 6. CTA SECTION */}
      <section className="py-20 text-white relative overflow-hidden" style={{ background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)" }}>
        <div className="absolute inset-0 z-0 opacity-10 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-white filter blur-[120px]" />
        </div>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10 space-y-6">
          <h2 className="text-3xl sm:text-5xl font-black">جاهز للبدء؟</h2>
          <p className="text-lg sm:text-xl text-indigo-100 max-w-2xl mx-auto leading-relaxed">
            سجل الآن وابدأ تجربتك المجانية لمدة 14 يوم. لا توجد أي التزامات ولا نطلب بطاقة ائتمان.
          </p>
          <div className="pt-4">
            <Link 
              to="/register" 
              className="inline-flex items-center justify-center gap-3 px-8 py-4 rounded-2xl text-base font-bold text-indigo-600 bg-white hover:bg-slate-50 transition-all shadow-xl shadow-indigo-600/10 hover:scale-[1.02] active:scale-[0.98]"
            >
              ابدأ مجاناً الآن
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* 7. FOOTER */}
      <footer className="bg-[#111827] text-slate-400 border-t border-slate-800 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <img src="/logo.png" className="h-8 w-auto" />
                <span className="text-xl font-bold tracking-tight text-white font-sans">Swiftm</span>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed max-w-xs">
                منصة إدارة الأعمال الذكية المتكاملة للمؤسسات والشركات والمتاجر في العالم العربي.
              </p>
            </div>
            
            <div className="grid grid-cols-2 gap-8 md:col-span-2">
              <div>
                <h4 className="text-white font-bold text-sm tracking-wider uppercase mb-4">الروابط</h4>
                <ul className="space-y-3 text-sm">
                  <li><a href="#features" className="hover:text-white transition-colors">المميزات</a></li>
                  <li><a href="#pricing" className="hover:text-white transition-colors">الباقات</a></li>
                  <li><a href="#faq" className="hover:text-white transition-colors">الأسئلة الشائعة</a></li>
                </ul>
              </div>
              <div>
                <h4 className="text-white font-bold text-sm tracking-wider uppercase mb-4">قانوني</h4>
                <ul className="space-y-3 text-sm">
                  <li><a href="#" className="hover:text-white transition-colors">سياسة الخصوصية</a></li>
                  <li><a href="#" className="hover:text-white transition-colors">الشروط والأحكام</a></li>
                  <li><a href="#faq" className="hover:text-white transition-colors">تواصل معنا</a></li>
                </ul>
              </div>
            </div>
          </div>
          
          <hr className="border-slate-800 mb-8" />
          
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
            <span>© 2026 Swiftm. جميع الحقوق محفوظة.</span>
            <span style={{ direction: 'ltr' }}>Made with ♥ by Swiftm Team</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
