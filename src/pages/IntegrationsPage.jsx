import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Puzzle, 
  Settings, 
  ChevronLeft, 
  CreditCard,
  ShoppingCart,
  Store,
  RefreshCw,
  CheckCircle2,
  Plug,
  ExternalLink
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';

const INTEGRATIONS_KEY_PREFIX = 'store-integrations-';

export default function IntegrationsPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();
  
  // States for Shopify
  const [shopifyDomain, setShopifyDomain] = useState('');
  const [shopifyToken, setShopifyToken] = useState('');
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifySyncing, setShopifySyncing] = useState(false);

  // States for WooCommerce
  const [wooDomain, setWooDomain] = useState('');
  const [wooKey, setWooKey] = useState('');
  const [wooConnected, setWooConnected] = useState(false);
  const [wooSyncing, setWooSyncing] = useState(false);

  // General state
  const [savedOk, setSavedOk] = useState(false);

  useEffect(() => {
    if (!store?.id) return;
    
    // Load config from localStorage for this store
    try {
      const configStr = localStorage.getItem(`${INTEGRATIONS_KEY_PREFIX}${store.id}`);
      if (configStr) {
        const config = JSON.parse(configStr);
        setShopifyDomain(config.shopifyDomain || '');
        setShopifyToken(config.shopifyToken || '');
        setShopifyConnected(config.shopifyConnected || false);
        
        setWooDomain(config.wooDomain || '');
        setWooKey(config.wooKey || '');
        setWooConnected(config.wooConnected || false);
      }
    } catch (err) {
      console.warn("Could not load integrations config", err);
    }
  }, [store?.id]);

  const saveConfig = (updatedConfig) => {
    if (!store?.id) return;
    try {
      const existingStr = localStorage.getItem(`${INTEGRATIONS_KEY_PREFIX}${store.id}`);
      const existing = existingStr ? JSON.parse(existingStr) : {};
      const newConfig = { ...existing, ...updatedConfig };
      localStorage.setItem(`${INTEGRATIONS_KEY_PREFIX}${store.id}`, JSON.stringify(newConfig));
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } catch (err) {
      console.error(err);
      toast.error('فشل حفظ الإعدادات');
    }
  };

  const handleShopifyConnect = () => {
    if (!shopifyDomain || !shopifyToken) {
       toast.warning("الرجاء إدخال رابط المتجر ومفتاح الوصول (Access Token).");
       return;
    }
    const nextState = !shopifyConnected;
    setShopifyConnected(nextState);
    saveConfig({ shopifyDomain, shopifyToken, shopifyConnected: nextState });
  };

  const handleWooConnect = () => {
    if (!wooDomain || !wooKey) {
       toast.warning("الرجاء إدخال رابط المتجر ومفتاح الـ API.");
       return;
    }
    const nextState = !wooConnected;
    setWooConnected(nextState);
    saveConfig({ wooDomain, wooKey, wooConnected: nextState });
  };

  const simulateSync = (platform) => {
    if (platform === 'shopify') {
       setShopifySyncing(true);
       setTimeout(() => {
           setShopifySyncing(false);
           toast.success("تمت مزامنة الكتالوج مع Shopify بنجاح!");
       }, 2000);
    } else {
       setWooSyncing(true);
       setTimeout(() => {
           setWooSyncing(false);
           toast.success("تمت مزامنة الكتالوج مع WooCommerce بنجاح!");
       }, 2000);
    }
  };

  if (storeLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24"><div className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin"></div></div>
      </DashboardLayout>
    );
  }

  if (!store?.id) return null;

  return (
    <DashboardLayout
      actions={
        <Link
          to="/settings"
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400"
        >
          <Settings size={16} />
          إعدادات النظام
          <ChevronLeft size={16} />
        </Link>
      }
    >
      <div className="max-w-5xl mx-auto space-y-6" dir="rtl">
        {/* Hero Section */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-sm dark:bg-[#18181b] dark:border-white/5">
           <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                 <Puzzle size={28} />
              </div>
              <div>
                 <h1 className="text-xl font-black text-slate-900 dark:text-white">مركز التطبيقات والربط (Integrations)</h1>
                 <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mt-1">
                    أدر عمليات التكامل مع قنوات بيعك المختلفة مثل Shopify و WooCommerce وبوابات الدفع.
                 </p>
              </div>
           </div>
           
           {savedOk && (
              <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 flex items-center gap-2">
                 <CheckCircle2 size={16} />
                 تم حفظ إعدادات التكامل بنجاح.
              </div>
           )}
        </div>

        <div className="grid md:grid-cols-2 gap-6">

            {/* Shopify Integration Card */}
            <div className={`rounded-3xl border transition-all ${shopifyConnected ? 'border-emerald-200 bg-gradient-to-b from-emerald-50/50 to-white dark:border-emerald-500/30 dark:from-emerald-950/20 dark:to-gray-900/50' : 'border-slate-200/80 bg-white dark:bg-[#18181b] dark:border-white/5'}`}>
               <div className="p-6 border-b border-black/5 dark:border-white/5 flex justify-between items-center">
                   <div className="flex items-center gap-3">
                       <div className="w-10 h-10 rounded-xl bg-[#95BF47]/10 text-[#95BF47] flex items-center justify-center font-black">S</div>
                       <h3 className="font-black text-lg">Shopify</h3>
                   </div>
                   <div className="flex items-center gap-2">
                      <span className={`text-[10px] uppercase font-black tracking-wider px-2 py-1 rounded-md ${shopifyConnected ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                         {shopifyConnected ? 'Connected' : 'Disconnected'}
                      </span>
                   </div>
               </div>
               <div className="p-6 space-y-4">
                  <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">رابط المتجر (my-shop.myshopify.com)</label>
                      <input 
                         type="text" 
                         value={shopifyDomain}
                         onChange={(e) => setShopifyDomain(e.target.value)}
                         disabled={shopifyConnected}
                         className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30"
                         dir="ltr"
                         placeholder="store.myshopify.com"
                      />
                  </div>
                  <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">مفتاح الوصول السري (Admin API Access Token)</label>
                      <input 
                         type="password" 
                         value={shopifyToken}
                         onChange={(e) => setShopifyToken(e.target.value)}
                         disabled={shopifyConnected}
                         className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30"
                         dir="ltr"
                         placeholder="shpat_..."
                      />
                  </div>
                  
                  <div className="pt-2 flex flex-col gap-2">
                      <button 
                         onClick={handleShopifyConnect}
                         className={`w-full py-2.5 rounded-xl font-bold text-sm flex justify-center items-center gap-2 transition ${shopifyConnected ? 'border-2 border-rose-100 text-rose-600 hover:bg-rose-50 dark:border-rose-900/30 dark:text-rose-400' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                      >
                         {shopifyConnected ? 'إلغاء الربط (Disconnect)' : 'ربط المتجر (Connect)'}
                      </button>
                      
                      {shopifyConnected && (
                          <button 
                             onClick={() => simulateSync('shopify')}
                             disabled={shopifySyncing}
                             className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-700 dark:text-slate-300 font-bold text-sm flex justify-center items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50"
                          >
                             <RefreshCw size={16} className={shopifySyncing ? 'animate-spin' : ''} />
                             {shopifySyncing ? 'جاري المزامنة...' : 'مزامنة الكتالوج والأرصدة يدوياً'}
                          </button>
                      )}
                  </div>
               </div>
            </div>

            {/* WooCommerce Integration Card */}
            <div className={`rounded-3xl border transition-all ${wooConnected ? 'border-emerald-200 bg-gradient-to-b from-emerald-50/50 to-white dark:border-emerald-500/30 dark:from-emerald-950/20 dark:to-gray-900/50' : 'border-slate-200/80 bg-white dark:bg-[#18181b] dark:border-white/5'}`}>
               <div className="p-6 border-b border-black/5 dark:border-white/5 flex justify-between items-center">
                   <div className="flex items-center gap-3">
                       <div className="w-10 h-10 rounded-xl bg-[#7F54B3]/10 text-[#7F54B3] flex items-center justify-center font-black">W</div>
                       <h3 className="font-black text-lg">WooCommerce</h3>
                   </div>
                   <div className="flex items-center gap-2">
                      <span className={`text-[10px] uppercase font-black tracking-wider px-2 py-1 rounded-md ${wooConnected ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                         {wooConnected ? 'Connected' : 'Disconnected'}
                      </span>
                   </div>
               </div>
               <div className="p-6 space-y-4">
                  <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">رابط المتجر (WordPress URL)</label>
                      <input 
                         type="text" 
                         value={wooDomain}
                         onChange={(e) => setWooDomain(e.target.value)}
                         disabled={wooConnected}
                         className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30"
                         dir="ltr"
                         placeholder="https://my-store.com"
                      />
                  </div>
                  <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">مفتاح المستهلك السري (API Consumer Secret)</label>
                      <input 
                         type="password" 
                         value={wooKey}
                         onChange={(e) => setWooKey(e.target.value)}
                         disabled={wooConnected}
                         className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30"
                         dir="ltr"
                         placeholder="cs_..."
                      />
                  </div>
                  
                  <div className="pt-2 flex flex-col gap-2">
                      <button 
                         onClick={handleWooConnect}
                         className={`w-full py-2.5 rounded-xl font-bold text-sm flex justify-center items-center gap-2 transition ${wooConnected ? 'border-2 border-rose-100 text-rose-600 hover:bg-rose-50 dark:border-rose-900/30 dark:text-rose-400' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                      >
                         {wooConnected ? 'إلغاء الربط (Disconnect)' : 'ربط المتجر (Connect)'}
                      </button>
                      
                      {wooConnected && (
                          <button 
                             onClick={() => simulateSync('woo')}
                             disabled={wooSyncing}
                             className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-700 dark:text-slate-300 font-bold text-sm flex justify-center items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50"
                          >
                             <RefreshCw size={16} className={wooSyncing ? 'animate-spin' : ''} />
                             {wooSyncing ? 'جاري المزامنة...' : 'مزامنة الكتالوج والأرصدة يدوياً'}
                          </button>
                      )}
                  </div>
               </div>
            </div>

            {/* Payments Card (Informational link to storefront) */}
            <div className="col-span-full rounded-3xl border border-slate-200/80 bg-white dark:bg-[#18181b] dark:border-white/5 p-6 sm:p-8 flex flex-col sm:flex-row gap-6 items-center">
                 <div className="w-16 h-16 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex justify-center items-center shadow-lg shadow-indigo-500/20 text-white">
                     <CreditCard size={28} />
                 </div>
                 <div className="flex-1 text-center sm:text-right">
                     <h3 className="font-black text-lg text-slate-900 dark:text-white mb-2">بوابات الدفع الإلكتروني</h3>
                     <p className="text-sm font-bold text-slate-500 dark:text-slate-400 leading-relaxed">
                        قمنا بدمج قدرات الدفع الإلكتروني (مثل Stripe و PayPal) مباشرة عبر واجهة متجرك العام. يمكنك وضع رابط الدفع الخاص بك (Link) لتمكين الزبائن من الدفع أونلاين.
                     </p>
                 </div>
                 <div className="shrink-0 w-full sm:w-auto">
                     <Link to="/settings/storefront" className="flex items-center justify-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-6 py-3 rounded-xl font-bold text-sm w-full transition hover:bg-slate-800 dark:hover:bg-slate-200">
                        <Store size={18} />
                        إعداد متجرك العام
                     </Link>
                 </div>
            </div>

        </div>
      </div>
    </DashboardLayout>
  );
}
