import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Home, LayoutGrid, ShoppingCart, DollarSign, Users,
  CreditCard, BarChart2, ChevronDown, ChevronLeft,
  ScanLine, Sparkles, LayoutDashboard, History, Truck, MapPin,
  Smartphone, Wrench, Bookmark, ShoppingBag, FileQuestion, Tag,
  ClipboardList, FileText, UserCircle, Wallet, Scale, BookOpen,
  ShieldCheck, Building2, Landmark, CalendarClock, CalendarDays,
  PackageMinus, TrendingUp, Receipt, Banknote, Search, Package,
  Pin, X, LineChart, HeartHandshake, Puzzle, Settings as SettingsIcon,
  Minus, LogOut, Bell,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { isModuleEnabled } from '../utils/storeEntitlements';
import { BRAND_NAME, brandStorageKey } from '../constants/brand.js';
import SwiftmLogo from './SwiftmLogo.jsx';

function isLinkActive(pathname, to) {
  if (to === '/finance') return pathname === '/finance' || pathname === '/finance/cashflow';
  if (to === '/overview') return pathname === '/overview' || pathname === '/dashboard';
  return pathname === to;
}

// 🍀 Greenie Color System
const THEME = {
  primary: '#4CAF50',
  primaryLight: '#E8F5E9',
  primaryDark: '#2E7D32',
  text: '#1C1C1E',
  textSecondary: '#8E8E93',
  textMuted: '#C7C7CC',
  bg: '#FFFFFF',
  bgSecondary: '#F5F5F7',
  border: '#E5E5EA',
  darkBg: '#1C1C1E',
  darkBgSecondary: '#2C2C2E',
};

const CATEGORIES = [
  {
    title: 'رئيسي',
    sections: [
      {
        id: 'home',
        title: 'الرئيسية',
        icon: Home,
        items: [
          { to: '/overview', icon: LayoutGrid, label: 'المركز التنفيذي' },
          { to: '/alerts', icon: Bell, label: 'الإشعارات والتنبيهات' },
        ],
      },
    ],
  },
  {
    title: 'العمليات',
    sections: [
      {
        id: 'pos',
        title: 'نقطة البيع',
        icon: ShoppingCart,
        items: [
          { to: '/pos', icon: ScanLine, label: 'نقطة البيع (POS)', module: 'pos' },
          { to: '/promotions', icon: Sparkles, label: 'العروض الذكية', module: 'promotions' },
        ],
      },
      {
        id: 'inventory',
        title: 'المخزون',
        icon: LayoutDashboard,
        badge: '12',
        items: [
          { to: '/inventory', icon: LayoutDashboard, label: 'لوحة التحكم والمخزن' },
          { to: '/inventory/low-stock', icon: PackageMinus, label: 'تنبيهات المخزون المنخفض' },
          { to: '/inventory/logs', icon: History, label: 'سجل حركات المخزن', module: 'inventory_logs' },
          { to: '/inventory/transfers', icon: Truck, label: 'تحويل مخزني', module: 'stock_transfers' },
          { to: '/inventory/locations', icon: MapPin, label: 'مواقع المخزن', module: 'warehouse_locations' },
          { to: '/warehouse/quick', icon: Smartphone, label: 'الجرد السريع', module: 'quick_inventory' },
          { to: '/service/warranty', icon: Wrench, label: 'طلبات الصيانة', module: 'service_warranty' },
        ],
      },
      {
        id: 'sales',
        title: 'المبيعات والمشتريات',
        icon: DollarSign,
        items: [
          { to: '/sales', icon: ShoppingCart, label: 'المبيعات', module: 'sales_movements' },
          { to: '/online-orders', icon: Package, label: 'الطلبات الأونلاين' },
          { to: '/sales/preorders', icon: Bookmark, label: 'الحجز المسبق', module: 'preorders' },
          { to: '/purchases', icon: ShoppingBag, label: 'المشتريات', module: 'purchases' },
          { to: '/purchases/rfq', icon: FileQuestion, label: 'طلبات عرض سعر', module: 'purchase_rfq' },
          { to: '/purchases/price-history', icon: Tag, label: 'آخر أسعار شراء', module: 'purchase_price_history' },
          { to: '/purchases/history', icon: ClipboardList, label: 'سجل المشتريات', module: 'purchase_history' },
          { to: '/purchases/supplier-statement', icon: FileText, label: 'كشف مورد', module: 'supplier_statement' },
          { to: '/sales/customer-statement', icon: UserCircle, label: 'كشف زبون', module: 'customer_statement' },
        ],
      },
    ],
  },
  {
    title: 'الإدارة',
    sections: [
      {
        id: 'customers',
        title: 'العملاء والذمم',
        icon: Users,
        items: [
          { to: '/customers', icon: Users, label: 'الزبائن والموردين', module: 'customers' },
          { to: '/customers/crm', icon: HeartHandshake, label: 'إدارة العملاء (CRM)', module: 'customers' },
          { to: '/customers/debt', icon: Wallet, label: 'الذمم والديون', module: 'debt_ledger' },
        ],
      },
      {
        id: 'finance',
        title: 'المالية',
        icon: CreditCard,
        items: [
          { to: '/finance/center', icon: Scale, label: 'المركز المالي', module: 'financial_center' },
          { to: '/finance/trial-balance', icon: Scale, label: 'ميزان المراجعة', module: 'trial_balance' },
          { to: '/finance/journal', icon: BookOpen, label: 'القيود اليومية', module: 'journal_entries' },
          { to: '/finance/activity-log', icon: ShieldCheck, label: 'سجل التدقيق', module: 'activity_log' },
          { to: '/finance/funds', icon: Building2, label: 'الصناديق والبنوك', module: 'funds' },
          { to: '/finance', icon: Landmark, label: 'المالية والمصروفات', module: 'finance_overview' },
          { to: '/finance/income-statement', icon: TrendingUp, label: 'قائمة الدخل', module: 'finance_overview' },
          { to: '/finance/debt-aging', icon: CalendarClock, label: 'أعمار الديون', module: 'debt_aging' },
          { to: '/vouchers', icon: Receipt, label: 'سندات الصرف والقبض', module: 'vouchers' },
          { to: '/finance/checks', icon: Banknote, label: 'الشيكات', module: 'checks' },
        ],
      },
      {
        id: 'reports',
        title: 'التقارير',
        icon: BarChart2,
        badge: 'جديد',
        items: [
          { to: '/reports/eod', icon: CalendarDays, label: 'تقرير نهاية اليوم (Z)', module: 'sales_movements' },
          { to: '/reports/analytics', icon: LineChart, label: 'تحليل الأداء التفاعلي', module: 'profit_reports' },
          { to: '/reports/profit', icon: TrendingUp, label: 'تقارير الأرباح', module: 'profit_reports' },
        ],
      },
    ],
  },
  {
    title: 'النظام',
    sections: [
      {
        id: 'settings',
        title: 'الإعدادات العامة',
        icon: SettingsIcon,
        items: [
          { to: '/settings', icon: SettingsIcon, label: 'إعدادات النظام', module: 'system_settings' },
          { to: '/settings/integrations', icon: Puzzle, label: 'التطبيقات والربط', module: 'integrations' },
        ],
      },
    ],
  },
];

const MOBILE_NAV_ITEMS = [
  { to: '/overview', icon: LayoutGrid, label: 'الرئيسية' },
  { to: '/pos', icon: ScanLine, label: 'POS', module: 'pos' },
  { to: '/inventory', icon: LayoutDashboard, label: 'المخزون' },
  { to: '/sales', icon: ShoppingCart, label: 'المبيعات', module: 'sales_movements' },
  { to: '/customers', icon: Users, label: 'العملاء', module: 'customers' },
];

const RECENT_PAGES_KEY = brandStorageKey('sidebar-recent-pages');
const PINNED_PAGES_KEY = brandStorageKey('sidebar-pinned-pages');

function readStoredPaths(key) {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch {
    return [];
  }
}

export default function Sidebar({ collapsible = false, collapsed = false, onToggleCollapse }) {
  const { store } = useStore();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState({ name: 'مستخدم النظام', role: 'مدير النظام' });
  const [searchQuery, setSearchQuery] = useState('');
  const [recentPages, setRecentPages] = useState(() => readStoredPaths(RECENT_PAGES_KEY));
  const [pinnedPages, setPinnedPages] = useState(() => readStoredPaths(PINNED_PAGES_KEY));

  const [openSections, setOpenSections] = useState(() => {
    const initialState = {};
    CATEGORIES.forEach(cat => {
      cat.sections.forEach(sec => {
        initialState[sec.id] = sec.items.some(item => isLinkActive(pathname, item.to));
      });
    });
    return initialState;
  });

  const allNavItems = useMemo(() =>
    CATEGORIES.flatMap((category) =>
      category.sections.flatMap((section) =>
        section.items
          .filter((item) => !item.module || isModuleEnabled(store, item.module))
          .map((item) => ({ ...item, categoryTitle: category.title, sectionId: section.id, sectionTitle: section.title }))
      )
    ), [store]);

  const searchTerm = searchQuery.trim();
  const searchResults = useMemo(() =>
    searchTerm ? allNavItems.filter((item) =>
      String(item.label || '').toLocaleLowerCase().includes(searchTerm.toLocaleLowerCase())
    ) : [], [allNavItems, searchTerm]);

  const pinnedItems = useMemo(() =>
    pinnedPages.map((path) => allNavItems.find((item) => item.to === path)).filter(Boolean), [allNavItems, pinnedPages]);

  const recentItems = useMemo(() =>
    recentPages.map((path) => allNavItems.find((item) => item.to === path)).filter(Boolean), [allNavItems, recentPages]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setUser({
          name: data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'مستخدم النظام',
          role: 'مدير النظام',
        });
      }
    });
  }, []);

  useEffect(() => {
    const current = allNavItems.find((item) => isLinkActive(pathname, item.to));
    if (!current) return;
    setRecentPages((prev) => {
      const next = [current.to, ...prev.filter((path) => path !== current.to)].slice(0, 3);
      if (typeof window !== 'undefined') window.localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(next));
      return next;
    });
  }, [allNavItems, pathname]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      const shortcutRoutes = { p: '/pos', i: '/inventory', s: '/sales', h: '/overview' };
      const target = shortcutRoutes[key];
      if (!target) return;
      event.preventDefault();
      navigate(target);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  const toggleSection = (id) => setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  const isHidden = collapsible && collapsed;

  const togglePinned = (to) => {
    setPinnedPages((prev) => {
      const exists = prev.includes(to);
      const next = exists ? prev.filter((path) => path !== to) : [to, ...prev];
      if (typeof window !== 'undefined') window.localStorage.setItem(PINNED_PAGES_KEY, JSON.stringify(next));
      return next;
    });
  };

  // 🍀 Greenie Style Link
  const renderCompactLink = (item, { showPin = false, showUnpin = false } = {}) => {
    const active = isLinkActive(pathname, item.to);
    const ItemIcon = item.icon;
    const pinned = pinnedPages.includes(item.to);

    return (
      <Link
        key={item.to}
        to={item.to}
        className={`group/item relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition-all duration-200 ${
          active
            ? 'bg-[#E8F5E9] text-[#2E7D32] font-bold'
            : 'text-[#1C1C1E] hover:bg-[#F5F5F7]'
        }`}
      >
        <ItemIcon size={18} strokeWidth={active ? 2.5 : 1.5} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {showPin && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePinned(item.to); }}
            className={`shrink-0 rounded-md p-1 opacity-0 transition-all group-hover/item:opacity-100 ${pinned ? 'text-[#4CAF50]' : 'text-[#C7C7CC] hover:text-[#4CAF50]'}`}
            title={pinned ? 'إزالة من المفضلة' : 'تثبيت'}
          >
            <Pin size={12} fill={pinned ? 'currentColor' : 'none'} />
          </button>
        )}
        {showUnpin && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePinned(item.to); }}
            className="shrink-0 rounded-md p-1 text-[#C7C7CC] opacity-0 transition-all hover:text-[#FF3B30] group-hover/item:opacity-100"
            title="إزالة من المفضلة"
          >
            <X size={12} />
          </button>
        )}
      </Link>
    );
  };

  return (
    <>
      {/* Mobile Nav */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex h-16 items-center justify-around bg-white px-3 shadow-[0_-4px_20px_-4px_rgba(0,0,0,0.08)] md:hidden" dir="rtl" aria-label="التنقل الرئيسي">
        {MOBILE_NAV_ITEMS.filter((item) => !item.module || isModuleEnabled(store, item.module)).map((item) => {
          const active = isLinkActive(pathname, item.to);
          const Icon = item.icon;
          return (
            <Link key={item.to} to={item.to} aria-label={item.label} title={item.label}
              className="flex flex-col items-center justify-center gap-1 rounded-xl px-3 py-2 transition-all duration-200"
              style={{ color: active ? THEME.primary : THEME.textMuted }}>
              <Icon size={22} strokeWidth={active ? 2.5 : 2} />
              <span className="text-[10px] font-bold">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Desktop Sidebar — Greenie Style */}
      <aside dir="rtl" aria-hidden={isHidden}
        className={`font-arabic relative hidden flex-col h-screen shrink-0 bg-white transition-all duration-300 md:flex ${
          isHidden ? 'w-0 overflow-hidden opacity-0' : 'w-[280px] opacity-100'
        }`}
        style={{ boxShadow: '1px 0 20px -5px rgba(0,0,0,0.05)' }}>
        
        <div className="flex flex-col h-full">
          
          {/* Logo */}
          <div className="flex items-center gap-3 px-6 pt-6 pb-2">
            <SwiftmLogo compact={false} showTagline={false} className="" />
            <span className="sr-only">{BRAND_NAME}</span>
            {collapsible && (
              <button type="button" onClick={onToggleCollapse} className="mr-auto flex h-8 w-8 items-center justify-center rounded-lg text-[#C7C7CC] transition hover:bg-[#F5F5F7] hover:text-[#1C1C1E]">
                <ChevronLeft size={18} />
              </button>
            )}
          </div>

          {/* Search */}
          <div className="px-6 pb-3">
            <div className="relative rounded-xl" style={{ backgroundColor: THEME.bgSecondary, border: `1px solid ${THEME.border}` }}>
              <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: THEME.textMuted }} />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث..."
                className="w-full rounded-xl bg-transparent py-2.5 pl-9 pr-10 text-[13px] outline-none transition placeholder:text-[#C7C7CC] focus:ring-2 focus:ring-[#E5E5EA]"
                style={{ color: THEME.text }}
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')}
                  className="absolute left-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md transition hover:bg-white/80"
                  style={{ color: THEME.textMuted }}>
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto px-4 [scrollbar-width:thin] [scrollbar-color:#E5E5EA_transparent] pb-2 space-y-6 mt-2">
            {searchTerm ? (
              <div className="space-y-1">
                {searchResults.length > 0 ? (
                  searchResults.map((item) => renderCompactLink(item, { showPin: true }))
                ) : (
                  <p className="py-8 text-center text-[13px] text-[#C7C7CC]">لا توجد نتائج</p>
                )}
              </div>
            ) : (
              <>
                {pinnedItems.length > 0 && (
                  <div className="space-y-1">
                    <div className="px-3 mb-2">
                      <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#C7C7CC]">المفضلة</h3>
                    </div>
                    {pinnedItems.map((item) => renderCompactLink(item, { showUnpin: true }))}
                  </div>
                )}

                {recentItems.length > 0 && (
                  <div className="space-y-1">
                    <div className="px-3 mb-2">
                      <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#C7C7CC]">الأخيرة</h3>
                    </div>
                    {recentItems.map((item) => renderCompactLink(item))}
                  </div>
                )}

                {CATEGORIES.map((category, idx) => {
                  const visibleSections = category.sections.map(sec => {
                    const visItems = sec.items.filter(item => !item.module || isModuleEnabled(store, item.module));
                    return { ...sec, items: visItems };
                  }).filter(sec => sec.items.length > 0);
                  if (!visibleSections.length) return null;

                  return (
                    <div key={idx} className="space-y-1">
                      <div className="px-3 mb-2">
                        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#C7C7CC]">{category.title}</h3>
                      </div>
                      <div className="space-y-1">
                        {visibleSections.map((section) => {
                          const isOpen = openSections[section.id];
                          const hasActiveChild = section.items.some((item) => isLinkActive(pathname, item.to));
                          const MainIcon = section.icon;

                          return (
                            <div key={section.id} className="flex flex-col">
                              {/* Parent Item */}
                              <button type="button" onClick={() => toggleSection(section.id)}
                                className={`flex items-center justify-between rounded-xl px-3 py-2.5 transition-all duration-200 ${
                                  hasActiveChild
                                    ? 'text-[#4CAF50]'
                                    : 'text-[#1C1C1E] hover:bg-[#F5F5F7]'
                                }`}>
                                <div className="flex items-center gap-3">
                                  <MainIcon size={18} strokeWidth={hasActiveChild ? 2.5 : 1.5} />
                                  <span className={`truncate text-[13px] ${hasActiveChild ? 'font-bold' : 'font-medium'}`}>
                                    {section.title}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {section.badge && (
                                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#FF3B30] text-[10px] font-bold text-white">
                                      {section.badge}
                                    </span>
                                  )}
                                  {isOpen ? (
                                    <Minus size={14} className="text-[#C7C7CC]" />
                                  ) : (
                                    <ChevronDown size={14} className="text-[#C7C7CC]" />
                                  )}
                                </div>
                              </button>

                              {/* Sub Items with vertical line */}
                              <div className="overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
                                style={{ maxHeight: isOpen ? '600px' : '0', opacity: isOpen ? 1 : 0 }}>
                                <div className="relative mr-[26px] mt-1 space-y-[2px] pr-3">
                                  {/* Vertical line */}
                                  <div className="absolute right-0 top-2 bottom-2 w-px bg-[#E5E5EA]" />
                                  {section.items.map((item) => {
                                    const active = isLinkActive(pathname, item.to);
                                    const ItemIcon = item.icon;
                                    return (
                                      <Link key={item.to} to={item.to}
                                        className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-all duration-200 ${
                                          active
                                            ? 'bg-[#E8F5E9] text-[#2E7D32] font-bold'
                                            : 'text-[#8E8E93] hover:bg-[#F5F5F7] hover:text-[#1C1C1E]'
                                        }`}>
                                        {active && (
                                          <span className="absolute right-[-13px] top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-[#4CAF50]" />
                                        )}
                                        <ItemIcon size={15} strokeWidth={active ? 2.5 : 1.5} />
                                        <span className="min-w-0 flex-1 truncate font-medium">
                                          {item.label}
                                        </span>
                                      </Link>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </nav>

          {/* Profile + Sign Out — Greenie Style */}
          <div className="shrink-0 p-4">
            <div className="h-px bg-[#E5E5EA] mb-4" />
            <div className="flex items-center gap-3 px-2">
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#FF6B6B] to-[#FF8E53] text-sm font-bold text-white">
                {user.name.charAt(0).toUpperCase()}
                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-white" />
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="truncate text-[13px] font-bold text-[#1C1C1E]">{user.name}</span>
                <span className="text-[11px] text-[#8E8E93]">{user.role}</span>
              </div>
              <button
                type="button"
                title="تسجيل الخروج"
                onClick={async () => {
                  const { supabase: sb } = await import('../lib/supabaseClient');
                  await sb.auth.signOut();
                  window.location.href = '/signin';
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-rose-400 transition hover:bg-rose-50 hover:text-rose-600"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
