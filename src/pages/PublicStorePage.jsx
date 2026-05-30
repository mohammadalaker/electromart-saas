import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Loader2,
  ShoppingCart,
  Plus,
  Minus,
  X,
  Search,
  Package,
  Sparkles,
  User,
  Menu,
  ChevronLeft,
  Instagram,
  Facebook,
} from 'lucide-react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { normalizeItemFromSupabase, roundMoney, isUuid, runProductsSelectWithFallback } from '../utils/productModel';
import { getPublicImageUrl } from '../utils/storageImageUrl';
import { isInventoryOutOfStock } from '../lib/inventoryStock';
import { STORE_CATEGORY_TILES, itemMatchesStoreCategory, getProductTypeLabel } from '../utils/productTypes';
import { brandPublicCartKey } from '../constants/brand.js';
import heroKitchenImage from '../assets/store-hero-kitchen.jpg';

gsap.registerPlugin(ScrollTrigger);

const FETCH_PAGE_SIZE = 500;
const PRODUCTS_PER_PAGE = 24;

function cartStorageKey(slug) {
  return brandPublicCartKey(slug);
}

function mapRpcError(msg) {
  const m = String(msg || '');
  if (/store_not_found|invalid_slug/i.test(m)) return 'المتجر غير متاح أو الرابط غير صحيح.';
  if (/empty_cart/i.test(m)) return 'سلة التسوق فارغة.';
  if (/invalid_product/i.test(m)) return 'أحد الأصناف غير صالح.';
  if (/insufficient_stock/i.test(m)) return 'الكمية غير متوفرة في المخزن.';
  if (/invalid_name/i.test(m)) return 'يرجى إدخال الاسم بشكل صحيح.';
  if (/invalid_phone/i.test(m)) return 'يرجى إدخال رقم هاتف صالح.';
  return m || 'تعذّر إرسال الطلب.';
}

function StoreProductCard({ item, inCart, onAddToCart, showNewBadge = false, showBestSellerBadge = false, scrollAnimate = false }) {
  const img = getPublicImageUrl(item.image);
  const out = isInventoryOutOfStock(item);
  const fullPrice = roundMoney(item.price ?? 0);
  const salePrice = roundMoney(item.priceAfterDiscount ?? item.price ?? 0);
  const discountPercent =
    fullPrice > 0 && salePrice < fullPrice
      ? Math.round(((fullPrice - salePrice) / fullPrice) * 100)
      : 0;

  return (
    <article
      {...(scrollAnimate ? { 'data-product-card': true } : {})}
      className="group relative bg-white rounded-xl border border-[#E8E8EC] overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300 p-3"
    >
      <div className="relative aspect-square bg-[#F5F5F7] p-3 flex items-center justify-center">
        {discountPercent > 0 ? (
          <span className="absolute top-2 left-2 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md z-10 group-hover:animate-pulse">
            -{discountPercent}%
          </span>
        ) : null}
        {showNewBadge ? (
          <span className="absolute top-2 right-2 bg-orange-500 text-white text-[10px] px-2 py-0.5 rounded-md z-10">
            جديد
          </span>
        ) : null}
        {showBestSellerBadge ? (
          <span className="absolute top-2 right-2 bg-amber-500 text-white text-[10px] px-2 py-0.5 rounded-md z-10">
            الأكثر مبيعاً
          </span>
        ) : null}
        {img ? (
          <img src={img} alt="" className="max-w-full max-h-full object-contain group-hover:scale-110 transition-transform duration-500" loading="lazy" />
        ) : (
          <Package className="text-[#5B6BF5]/20" size={48} />
        )}
      </div>
      {item.group ? (
        <p className="mt-2 text-center font-bold text-sm text-[#0D0E13]">{item.group}</p>
      ) : null}
      <h3 className="mt-1 text-[12px] text-[#0D0E13] line-clamp-2 text-center min-h-[36px]">
        {item.name || '—'}
      </h3>
      <div className="mt-2 flex items-center justify-center gap-2">
        <span className="text-[#5B6BF5] font-bold text-base font-currency" lang="en" dir="ltr">
          ₪ {salePrice.toFixed(2)}
        </span>
        {discountPercent > 0 ? (
          <span className="text-[#B0B2C3] line-through text-xs font-currency" lang="en" dir="ltr">
            ₪ {fullPrice.toFixed(2)}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        disabled={out}
        onClick={() => onAddToCart(item)}
        className="mt-3 w-full bg-[#1a1b3d] text-white rounded-lg py-2.5 text-sm font-bold hover:bg-[#5B6BF5] transition-all active:scale-95 hover:shadow-lg flex items-center justify-center gap-2 disabled:opacity-30 disabled:pointer-events-none"
      >
        <ShoppingCart size={16} />
        {inCart ? `في السلة (${inCart.qty})` : 'إضافة إلى السلة'}
      </button>
    </article>
  );
}

export default function PublicStorePage() {
  const { slug: slugParam } = useParams();
  const navigate = useNavigate();
  const slug = (slugParam || '').trim().toLowerCase();

  const [storeId, setStoreId] = useState(null);
  const [storeName, setStoreName] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [facebookUrl, setFacebookUrl] = useState('');
  const [tiktokUrl, setTiktokUrl] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [brandFilter, setBrandFilter] = useState('');
  const [categoryTile, setCategoryTile] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);

  const [cart, setCart] = useState(() => []);
  const [cartOpen, setCartOpen] = useState(false);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custAddress, setCustAddress] = useState('');
  const [custNotes, setCustNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitDone, setSubmitDone] = useState(false);
  const [paymentLink, setPaymentLink] = useState('');
  const [useElectronicPayment, setUseElectronicPayment] = useState(false);

  useEffect(() => {
    if (!slug) {
      setLoadError('رابط غير صالح');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const { data: st, error: e1 } = await supabase
          .from('stores')
          .select('id, name, instagram_url, facebook_url, tiktok_url')
          .eq('public_slug', slug)
          .eq('public_catalog_enabled', true)
          .maybeSingle();
        if (cancelled) return;
        if (e1) throw e1;
        if (!st?.id) {
          setLoadError('المتجر غير متاح أو المتجر العام غير مفعّل.');
          setLoading(false);
          return;
        }
        setStoreId(st.id);
        setStoreName((st.name || '').toString());
        setInstagramUrl((st.instagram_url ?? '').toString().trim());
        setFacebookUrl((st.facebook_url ?? '').toString().trim());
        setTiktokUrl((st.tiktok_url ?? '').toString().trim());

        const { data: products, error: e2 } = await runProductsSelectWithFallback((sel) =>
          supabase
            .from(PRODUCTS_TABLE)
            .select(sel)
            .eq('store_id', st.id)
            .order('brand_group', { ascending: true })
            .order('eng_name', { ascending: true })
            .range(0, FETCH_PAGE_SIZE - 1)
        );
        if (e2) throw e2;
        const normalized = (products || []).map(normalizeItemFromSupabase).filter(Boolean);
        if (cancelled) return;
        setItems(normalized);
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setLoadError(err.message || 'تعذّر تحميل المتجر');
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!storeId || typeof window === 'undefined') return;
    try {
      const link = window.localStorage.getItem(`store-payment-config-${storeId}`);
      if (link) setPaymentLink(link);
    } catch {
       /* ignore */
    }
  }, [storeId]);

  useEffect(() => {
    if (!slug || typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(cartStorageKey(slug));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setCart(parsed);
      }
    } catch {
      /* ignore */
    }
  }, [slug]);

  useEffect(() => {
    if (!slug || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(cartStorageKey(slug), JSON.stringify(cart));
    } catch {
      /* ignore */
    }
  }, [cart, slug]);

  useEffect(() => {
    if (storeName) {
      document.title = storeName;
    }
    return () => {
      document.title = 'Swiftm — إدارة تجارة ذكية';
    };
  }, [storeName]);

  const allBrands = useMemo(
    () => [...new Set(items.map((i) => i.group).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b))),
    [items]
  );
  const tilePreviewById = useMemo(() => {
    const map = {};
    for (const tile of STORE_CATEGORY_TILES) {
      if (tile.id === 'all') continue;
      const found = items.find(
        (i) => itemMatchesStoreCategory(tile.id, i) && getPublicImageUrl(i.image)
      );
      map[tile.id] = found ? getPublicImageUrl(found.image) : null;
    }
    return map;
  }, [items]);

  const filteredItems = useMemo(() => {
    let list = items;
    if (categoryTile !== 'all') {
      list = list.filter((i) => itemMatchesStoreCategory(categoryTile, i));
    }
    if (brandFilter) {
      list = list.filter((i) => String(i.group || '').trim() === brandFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (i) =>
          (i.name || '').toLowerCase().includes(q) ||
          (i.barcode || '').toString().toLowerCase().includes(q) ||
          (i.reference || '').toLowerCase().includes(q) ||
          (i.group || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, search, brandFilter, categoryTile]);

  useEffect(() => {
    setCurrentPage(1);
  }, [items.length, search, brandFilter, categoryTile]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PRODUCTS_PER_PAGE));
  const currentPageClamped = Math.min(currentPage, totalPages);
  const pagedItems = useMemo(() => {
    const start = (currentPageClamped - 1) * PRODUCTS_PER_PAGE;
    return filteredItems.slice(start, start + PRODUCTS_PER_PAGE);
  }, [filteredItems, currentPageClamped]);
  const pageTokens = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const tokens = new Set([1, totalPages]);
    const start = Math.max(2, currentPageClamped - 1);
    const end = Math.min(totalPages - 1, currentPageClamped + 1);
    for (let p = start; p <= end; p += 1) tokens.add(p);

    const sorted = [...tokens].sort((a, b) => a - b);
    const withDots = [];
    for (let i = 0; i < sorted.length; i += 1) {
      const cur = sorted[i];
      const prev = sorted[i - 1];
      if (i > 0 && cur - prev > 1) withDots.push(`dots-${prev}-${cur}`);
      withDots.push(cur);
    }
    return withDots;
  }, [totalPages, currentPageClamped]);

  const cartLineById = useMemo(() => new Map(cart.map((c) => [c.id, c])), [cart]);
  const newArrivals = items.slice(0, 5);
  const bestSellers = items.filter((i) => !isInventoryOutOfStock(i)).slice(0, 5);

  const cartTotals = useMemo(() => {
    let sub = 0;
    for (const line of cart) {
      const unit = roundMoney(line.unitPrice ?? 0);
      const q = Math.max(1, Number(line.qty) || 1);
      sub += unit * q;
    }
    return { subtotal: roundMoney(sub) };
  }, [cart]);

  const addToCart = useCallback((item) => {
    if (!isUuid(String(item.id))) return;
    const unitPrice = roundMoney(item.priceAfterDiscount ?? item.price ?? 0);
    const stock = Number(item.stock ?? 0);
    if (stock <= 0) return;
    setCart((prev) => {
      const i = prev.findIndex((x) => x.id === item.id);
      if (i >= 0) {
        const next = [...prev];
        const cur = next[i];
        if (cur.qty >= stock) return prev;
        next[i] = { ...cur, qty: Math.min(stock, cur.qty + 1) };
        return next;
      }
      return [...prev, { id: item.id, qty: 1, unitPrice, item }];
    });
  }, []);

  const inc = (id) => {
    setCart((prev) => {
      const line = prev.find((x) => x.id === id);
      if (!line) return prev;
      const row = items.find((i) => i.id === id);
      const stock = Number(row?.stock ?? line.item?.stock ?? 0);
      if (stock > 0 && line.qty >= stock) return prev;
      return prev.map((x) => (x.id === id ? { ...x, qty: x.qty + 1 } : x));
    });
  };

  const dec = (id) => {
    setCart((prev) => {
      const line = prev.find((x) => x.id === id);
      if (!line) return prev;
      if (line.qty <= 1) return prev.filter((x) => x.id !== id);
      return prev.map((x) => (x.id === id ? { ...x, qty: x.qty - 1 } : x));
    });
  };

  const removeLine = (id) => setCart((prev) => prev.filter((x) => x.id !== id));

  const handleSubmitOrder = async (e) => {
    e.preventDefault();
    if (!slug || cart.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const p_items = cart.map((c) => ({
        product_id: c.id,
        qty: Math.max(1, Number(c.qty) || 1),
      }));
      const { data, error } = await supabase.rpc('submit_online_order', {
        p_slug: slug,
        p_items,
        p_customer_name: custName.trim(),
        p_customer_phone: custPhone.trim(),
        p_customer_address: custAddress.trim(),
        p_notes: custNotes.trim() || null,
      });
      if (error) throw error;
      if (!data) throw new Error('لم يُرجع الخادم رقم الطلب');
      setSubmitDone(true);
      setCart([]);
      try {
        if (typeof window !== 'undefined') window.localStorage.removeItem(cartStorageKey(slug));
      } catch {
        /* ignore */
      }
      setCheckoutOpen(false);
      setCustName('');
      setCustPhone('');
      setCustAddress('');
      setCustNotes('');

      if (useElectronicPayment && paymentLink) {
         window.location.href = paymentLink;
      }
    } catch (err) {
      setSubmitError(mapRpcError(err.message));
    } finally {
      setSubmitting(false);
      setUseElectronicPayment(false);
    }
  };

  const cartCount = cart.reduce((a, c) => a + Math.max(1, Number(c.qty) || 1), 0);

  const heroT1 = useRef(null);
  const heroT2 = useRef(null);
  const heroSub = useRef(null);
  const heroImg = useRef(null);
  const productsGridRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    if (!storeId) return;
    document.documentElement.style.scrollBehavior = 'smooth';
    if (heroT1.current) gsap.set(heroT1.current, { opacity: 1, color: '#ffffff' });
    if (heroT2.current) gsap.set(heroT2.current, { opacity: 1 });
    const tl = gsap.timeline({ delay: 0.4 });
    if (heroT1.current) {
      tl.fromTo(heroT1.current, { opacity: 0, y: 50, clipPath: 'inset(100% 0 0 0)' }, { opacity: 1, y: 0, clipPath: 'inset(0% 0 0 0)', duration: 1, ease: 'power4.out' });
    }
    if (heroT2.current) {
      tl.fromTo(heroT2.current, { opacity: 0, y: 50, clipPath: 'inset(100% 0 0 0)' }, { opacity: 1, y: 0, clipPath: 'inset(0% 0 0 0)', duration: 1, ease: 'power4.out' }, '-=0.7');
    }
    if (heroSub.current) {
      tl.fromTo(heroSub.current, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, '-=0.4');
    }
    if (heroImg.current) {
      tl.fromTo(heroImg.current, { opacity: 0, scale: 1.03 }, { opacity: 1, scale: 1, duration: 1, ease: 'power3.out' }, '-=0.5');
    }
    return () => {
      tl.kill();
      document.documentElement.style.scrollBehavior = 'auto';
    };
  }, [storeId]);

  useEffect(() => {
    if (!storeId || !productsGridRef.current) return;
    const cards = productsGridRef.current.querySelectorAll('[data-product-card]');
    const tweens = [];
    cards.forEach((card, i) => {
      tweens.push(
        gsap.fromTo(
          card,
          { opacity: 0, y: 30, scale: 0.96 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.5,
            delay: i * 0.04,
            ease: 'power3.out',
            scrollTrigger: { trigger: card, start: 'top 92%' },
          },
        ),
      );
    });
    return () => {
      tweens.forEach((t) => {
        t.scrollTrigger?.kill();
        t.kill();
      });
    };
  }, [storeId, pagedItems]);

  useEffect(() => {
    if (!storeId) return;
    const titles = document.querySelectorAll('[data-section-title]');
    const tweens = [];
    titles.forEach((title) => {
      tweens.push(
        gsap.fromTo(
          title,
          { opacity: 0, y: 30 },
          {
            opacity: 1,
            y: 0,
            duration: 0.6,
            ease: 'power3.out',
            scrollTrigger: { trigger: title, start: 'top 90%' },
          },
        ),
      );
    });
    return () => {
      tweens.forEach((t) => {
        t.scrollTrigger?.kill();
        t.kill();
      });
    };
  }, [storeId, items.length, allBrands.length]);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F7]" dir="rtl" style={{ fontFamily: "'Inter Tight', sans-serif" }}>
        <Loader2 className="animate-spin text-[#5B6BF5]" size={48} />
      </div>
    );
  }

  if (loadError || !storeId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#F5F5F7] text-[#0D0E13]" dir="rtl" style={{ fontFamily: "'Inter Tight', sans-serif" }}>
        <Package className="text-[#6E7278] mb-4" size={48} />
        <p className="text-lg font-bold text-center">{loadError || 'المتجر غير متاح'}</p>
        <Link to="/" className="mt-6 text-[#5B6BF5] font-bold hover:underline">
          العودة
        </Link>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-[#F5F5F7] text-slate-900"
      dir="rtl"
      style={{ fontFamily: "'Inter Tight', sans-serif", backgroundColor: '#F5F5F7' }}
    >
      {/* SocialBar */}
      <div className="w-full bg-[#1a1b3d] text-white text-[11px] font-mono py-1.5">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between">
          {(tiktokUrl || facebookUrl || instagramUrl) ? (
            <div className="flex items-center gap-4">
              {tiktokUrl ? (
                <a href={tiktokUrl} target="_blank" rel="noopener noreferrer" className="text-[#8b8ec2] hover:text-white cursor-pointer transition-colors">
                  TikTok
                </a>
              ) : null}
              {facebookUrl ? (
                <a href={facebookUrl} target="_blank" rel="noopener noreferrer" className="text-[#8b8ec2] hover:text-white cursor-pointer transition-colors">
                  Facebook
                </a>
              ) : null}
              {instagramUrl ? (
                <a href={instagramUrl} target="_blank" rel="noopener noreferrer" className="text-[#8b8ec2] hover:text-white cursor-pointer transition-colors">
                  Instagram
                </a>
              ) : null}
            </div>
          ) : null}
          <span className="text-[#8b8ec2]">العربية ▾</span>
        </div>
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#1a1b3d] border-b border-[#2a2b50] backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              aria-label="فتح السلة"
              className="relative text-white/80 hover:text-white transition-colors"
            >
              <ShoppingCart size={20} />
              {cartCount > 0 ? (
                <span
                  className="absolute -top-1.5 -right-1.5 min-w-[1rem] h-4 px-1 inline-flex items-center justify-center rounded-full bg-[#5B6BF5] text-white text-[9px] font-bold font-currency"
                  lang="en"
                >
                  {cartCount}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setSearchOpen(!searchOpen)}
              className="text-white/80 hover:text-white transition-colors"
              aria-label="بحث"
            >
              <Search size={20} />
            </button>
          </div>
          <div className="text-center">
            <div className="text-[15px] font-bold text-white tracking-wide">{storeName || 'OnElect Company'}</div>
            <div className="text-[9px] text-[#8b8ec2] -mt-0.5">
              {paymentLink ? 'الدفع عند الاستلام أو إلكترونياً' : 'منتج المنزليات والكهربائيات عند الاستلام'}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-white/80 hover:text-white hidden sm:block transition-colors"
              aria-label="حسابي"
            >
              <User size={20} />
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="text-white/80 hover:text-white sm:hidden transition-colors"
              aria-label="القائمة"
            >
              <Menu size={20} />
            </button>
          </div>
        </div>
      </header>

      {searchOpen ? (
        <div className="fixed top-[108px] left-0 right-0 z-50 bg-[#1a1b3d] px-4 py-3 border-b border-[#2a2b50]">
          <div className="max-w-7xl mx-auto flex items-center gap-2">
            <input
              ref={searchInputRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث عن منتج..."
              className="w-full rounded-xl bg-white/10 text-white placeholder:text-white/40 px-4 py-2.5 outline-none focus:ring-2 focus:ring-[#5B6BF5]"
            />
            <button
              type="button"
              onClick={() => setSearchOpen(false)}
              className="shrink-0 text-white/70 hover:text-white transition-colors p-1"
              aria-label="إغلاق البحث"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      ) : null}

      {mobileMenuOpen ? (
        <div className="sm:hidden bg-[#1a1b3d] border-b border-[#2a2b50] py-2">
          <div className="max-w-7xl mx-auto px-4 flex flex-col gap-1">
            {STORE_CATEGORY_TILES.map((tile) => {
              const active = categoryTile === tile.id;
              return (
                <button
                  key={`mobile-nav-${tile.id}`}
                  type="button"
                  onClick={() => {
                    setCategoryTile(tile.id);
                    setMobileMenuOpen(false);
                    document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className={`text-[13px] font-medium whitespace-nowrap px-3 py-2 rounded-lg transition-all cursor-pointer text-right ${
                    active
                      ? 'bg-[#5B6BF5] text-white'
                      : 'text-white/80 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {tile.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <nav className="bg-[#252654] border-b border-[#2a2b50]">
        <div className="max-w-7xl mx-auto px-4 py-2.5">
          <div className="hidden sm:flex gap-1 overflow-x-auto justify-center [scrollbar-width:none]">
            {STORE_CATEGORY_TILES.map((tile) => {
              const active = categoryTile === tile.id;
              return (
                <button
                  key={`nav-${tile.id}`}
                  type="button"
                  onClick={() => {
                    setCategoryTile(tile.id);
                    document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className={`text-[13px] font-medium whitespace-nowrap px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    active
                      ? 'bg-[#5B6BF5] text-white'
                      : 'text-white/80 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {tile.label}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {submitDone && (
        <div className="max-w-6xl mx-auto px-4 pt-4">
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 text-center">
            تم استلام طلبك. سيتواصل معك المتجر قريباً. شكراً لثقتك.
          </div>
        </div>
      )}

      {/* Hero */}
      <section className="relative z-10 overflow-x-hidden">
        <div className="relative h-[85vh] w-full overflow-hidden">
          <div ref={heroImg} className="absolute inset-0">
            <img
              src={heroKitchenImage}
              alt="بانر أجهزة مطبخ"
              className="absolute inset-0 w-full h-full object-cover"
              loading="eager"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0D0E13]/80 via-[#0D0E13]/30 to-[#0D0E13]/50" />
          </div>

          <div className="relative z-10 flex flex-col items-center justify-center h-full px-4 text-center">
            <div
              ref={heroT1}
              className="w-full text-center text-[14vw] md:text-[11vw] font-black uppercase leading-[0.85] text-white tracking-[-0.04em]"
            >
              ONELECT
            </div>
            <div
              ref={heroT2}
              className="w-full text-center text-[14vw] md:text-[11vw] font-black uppercase leading-[0.85] tracking-[-0.04em]"
              style={{
                backgroundColor: 'transparent',
                background: 'linear-gradient(135deg, #5B6BF5, #8B9DF5)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                color: 'transparent',
              }}
            >
              COMPANY
            </div>
            <p ref={heroSub} className="mt-4 font-mono text-sm text-white/90 tracking-wider max-w-xl">
              منتجات المنزليات والكهربائيات — الدفع عند الاستلام
            </p>
            <div className="mt-5 flex gap-3">
              <a href="#products" className="px-6 py-2.5 bg-[#5B6BF5] text-white font-mono text-sm rounded-full hover:bg-[#4a59d9] transition-all active:scale-95 hover:shadow-lg">
                تسوق الآن
              </a>
              <a href="#categories" className="px-6 py-2.5 border border-white/30 text-white font-mono text-sm rounded-full hover:bg-white/10 transition-all active:scale-95">
                تصفح التصنيفات
              </a>
            </div>
          </div>

          <div className="absolute bottom-0 right-0 z-10 p-6 md:p-10 text-right pointer-events-none">
            <span className="text-[10px] font-mono text-[#8b9df5] tracking-wider uppercase block mb-1">مجموعة مميزة</span>
            <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-white leading-tight mb-1">أجهزة مطبخ أذكى</h2>
            <h3 className="text-base sm:text-lg md:text-xl font-bold text-white/90 leading-tight mb-2">لأداء أفضل</h3>
            <p className="font-mono text-[10px] sm:text-xs text-white/60">ذوق رفيع، وأداء أذكى</p>
          </div>
        </div>
      </section>

      {/* Products section */}
      <section id="products" className="bg-white py-12 md:py-16 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl md:text-3xl font-bold text-[#0D0E13]">منتجاتنا</h2>
              <p className="font-mono text-xs text-[#6E7278] mt-1">أفضل الماركات العالمية بأفضل الأسعار</p>
            </div>
            {filteredItems.length > PRODUCTS_PER_PAGE && (
              <span className="font-mono text-[10px] text-[#5B6BF5] bg-[#5B6BF5]/8 px-2 py-1 rounded-full">
                صفحة {currentPageClamped} من {totalPages}
              </span>
            )}
          </div>

          {/* Search + brand filter */}
          <div className="bg-white rounded-xl border border-[#E8E8EC] p-3 mb-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B0B2C3]" size={16} />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث بالاسم أو الباركود…"
                  className="w-full rounded-lg border border-[#E8E8EC] bg-[#F5F5F7] pl-3 pr-10 py-2.5 text-sm placeholder:text-[#B0B2C3] focus:ring-2 focus:ring-[#5B6BF5]/30 focus:border-[#5B6BF5] transition-all"
                />
              </div>
              <select
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
                className="rounded-lg border border-[#E8E8EC] bg-[#F5F5F7] px-3 py-2.5 text-sm text-[#0D0E13] focus:ring-2 focus:ring-[#5B6BF5]/30 focus:border-[#5B6BF5] transition-all"
              >
                <option value="">كل الماركات</option>
                {allBrands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filteredItems.length > PRODUCTS_PER_PAGE && (
            <div className="mb-6 flex items-center justify-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPageClamped <= 1}
                className="px-3 py-1.5 text-[11px] font-mono text-[#6E7278] bg-[#F5F5F7] border border-[#E8E8EC] rounded-lg hover:border-[#5B6BF5] transition-colors disabled:opacity-40"
              >
                السابقة
              </button>
              {pageTokens.map((token) => {
                if (typeof token === 'string') {
                  return (
                    <span key={token} className="text-[#B0B2C3] text-xs">
                      ...
                    </span>
                  );
                }
                return (
                  <button
                    key={token}
                    type="button"
                    onClick={() => setCurrentPage(token)}
                    className={`w-7 h-7 flex items-center justify-center text-[11px] font-mono rounded-lg transition-colors ${
                      token === currentPageClamped
                        ? 'text-white bg-[#5B6BF5]'
                        : 'text-[#6E7278] bg-[#F5F5F7] border border-[#E8E8EC] hover:border-[#5B6BF5]'
                    }`}
                  >
                    {token}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPageClamped >= totalPages}
                className="px-3 py-1.5 text-[11px] font-mono text-[#6E7278] bg-[#F5F5F7] border border-[#E8E8EC] rounded-lg hover:border-[#5B6BF5] transition-colors disabled:opacity-40"
              >
                التالية
              </button>
            </div>
          )}

          <div ref={productsGridRef} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {pagedItems.map((item) => (
              <StoreProductCard
                key={item.id}
                item={item}
                inCart={cartLineById.get(item.id)}
                onAddToCart={addToCart}
                scrollAnimate
              />
            ))}
          </div>

          {filteredItems.length === 0 && (
            <div className="text-center py-20 text-[#6E7278] font-mono text-sm">لا توجد منتجات مطابقة للتصفية.</div>
          )}

          {filteredItems.length > PRODUCTS_PER_PAGE && (
            <div className="mt-6 flex items-center justify-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPageClamped <= 1}
                className="px-3 py-1.5 text-[11px] font-mono text-[#6E7278] bg-[#F5F5F7] border border-[#E8E8EC] rounded-lg hover:border-[#5B6BF5] transition-colors disabled:opacity-40"
              >
                السابقة
              </button>
              {pageTokens.map((token) => {
                if (typeof token === 'string') {
                  return (
                    <span key={`bottom-${token}`} className="text-[#B0B2C3] text-xs">
                      ...
                    </span>
                  );
                }
                return (
                  <button
                    key={`bottom-${token}`}
                    type="button"
                    onClick={() => setCurrentPage(token)}
                    className={`w-7 h-7 flex items-center justify-center text-[11px] font-mono rounded-lg transition-colors ${
                      token === currentPageClamped
                        ? 'text-white bg-[#5B6BF5]'
                        : 'text-[#6E7278] bg-[#F5F5F7] border border-[#E8E8EC] hover:border-[#5B6BF5]'
                    }`}
                  >
                    {token}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPageClamped >= totalPages}
                className="px-3 py-1.5 text-[11px] font-mono text-[#6E7278] bg-[#F5F5F7] border border-[#E8E8EC] rounded-lg hover:border-[#5B6BF5] transition-colors disabled:opacity-40"
              >
                التالية
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Categories grid */}
      <section id="categories" className="bg-[#F5F5F7] py-14 md:py-20 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center gap-4 mb-10">
            <div className="flex-1 border-t border-dashed border-slate-300" />
            <h2 data-section-title className="font-bold text-2xl text-orange-500 whitespace-nowrap">تصفح التصنيفات</h2>
            <div className="flex-1 border-t border-dashed border-slate-300" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
            {[...STORE_CATEGORY_TILES]
              .filter((tile) => tile.id !== 'all')
              .sort((a, b) => {
                const order = [
                  'تلفزيونات',
                  'ثلاجات',
                  'غسالات',
                  'نشافات',
                  'جلايات',
                  'أفران + ميكرويف',
                  'غلاية مياه',
                  'مكانس كهربائية',
                  'ماكنات قهوة',
                  'العناية بالشعر',
                  'خلاطات',
                  'المقالي الهوائية',
                ];
                const rank = (label) => {
                  const i = order.findIndex((o) => label === o || label.includes(o) || o.includes(label));
                  return i === -1 ? order.length : i;
                };
                return rank(a.label) - rank(b.label);
              })
              .map((tile) => {
              const preview = tilePreviewById[tile.id];
              return (
                <button
                  key={tile.id}
                  type="button"
                  onClick={() => {
                    setCategoryTile(tile.id);
                    document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="group flex flex-col items-center bg-white rounded-2xl border border-[#E8E8EC] p-4 hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
                >
                  <div className="w-full aspect-square p-3 flex items-center justify-center overflow-hidden">
                    {preview ? (
                      <img src={preview} alt={tile.label} className="max-w-full max-h-full object-contain group-hover:scale-110 transition-transform duration-500" loading="lazy" />
                    ) : (
                      <Package className="text-[#5B6BF5]/30" size={32} />
                    )}
                  </div>
                  <span className="mt-3 text-[14px] font-bold text-[#0D0E13] text-center line-clamp-2">
                    {tile.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {allBrands.length > 0 && (
        <section className="bg-[#1a1b3d] py-8">
          <div className="max-w-6xl mx-auto px-4">
            <h2 data-section-title className="text-center text-white font-bold text-xl mb-6">الماركات</h2>
            <div className="flex gap-4 overflow-x-auto justify-center flex-wrap pb-2">
              {allBrands.map((brand) => (
                <button
                  key={brand}
                  type="button"
                  onClick={() => {
                    setBrandFilter(brand);
                    document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="bg-white rounded-xl px-6 py-3 hover:scale-105 transition-all duration-200 cursor-pointer shrink-0"
                >
                  <span className="text-[#1a1b3d] font-bold text-sm whitespace-nowrap">{brand}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {items.length > 0 && (
        <section className="bg-white py-12">
          <div className="max-w-6xl mx-auto px-4">
            <div className="flex items-center gap-4 mb-8">
              <div className="flex-1 border-t border-dotted border-[#D1D5DB]" />
              <h2 data-section-title className="font-bold text-2xl text-[#0D0E13] whitespace-nowrap">وصل حديثاً</h2>
              <div className="flex-1 border-t border-dotted border-[#D1D5DB]" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {newArrivals.map((item) => (
                <StoreProductCard
                  key={`new-${item.id}`}
                  item={item}
                  inCart={cartLineById.get(item.id)}
                  onAddToCart={addToCart}
                  showNewBadge
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Brand banner */}
      <section className="relative overflow-hidden h-[400px] md:h-[500px] shadow-xl group">
        <img src="/banners/babyliss-banner.jpg" alt="Featured" className="absolute inset-0 w-full h-full object-cover object-bottom group-hover:scale-105 transition-transform duration-700" />
        <div className="absolute inset-0 bg-gradient-to-l from-[#0D0E13]/70 via-transparent to-transparent" />
        <div className="absolute bottom-0 right-0 p-6 md:p-10 text-right">
          <span className="text-[10px] font-mono text-[#5B6BF5] tracking-[0.15em] uppercase block mb-2">Featured Brand</span>
          <h2 className="text-2xl md:text-4xl font-black text-white mb-1">Babyliss Pro</h2>
          <p className="text-sm md:text-lg text-[#8b9df5] mb-4">أدوات تصفيف احترافية بجودة عالمية</p>
          <a href="#products" className="inline-flex items-center gap-2 px-5 py-2 bg-[#5B6BF5] text-white font-mono text-xs rounded-full hover:bg-[#4a59d9] transition-all active:scale-95 hover:shadow-lg">
            تسوق الآن <ChevronLeft size={14} />
          </a>
        </div>
      </section>

      {bestSellers.length > 0 && (
        <section className="bg-[#F5F5F7] py-12">
          <div className="max-w-6xl mx-auto px-4">
            <div className="flex items-center gap-4 mb-8">
              <div className="flex-1 border-t border-dotted border-[#D1D5DB]" />
              <h2 data-section-title className="font-bold text-2xl text-[#0D0E13] whitespace-nowrap">الأكثر مبيعاً</h2>
              <div className="flex-1 border-t border-dotted border-[#D1D5DB]" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {bestSellers.map((item) => (
                <StoreProductCard
                  key={`best-${item.id}`}
                  item={item}
                  inCart={cartLineById.get(item.id)}
                  onAddToCart={addToCart}
                  showBestSellerBadge
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* TV video showcase */}
      <section className="bg-[#0D0E13] py-8">
        <div className="max-w-6xl mx-auto px-4 text-center mb-8">
          <h2 className="font-bold text-2xl md:text-3xl text-white">تلفزيونات بتقنية عالية</h2>
          <p className="text-[#8b9df5] text-sm mt-2">شاشات ذكية بجودة 4K وألوان نابضة بالحياة</p>
        </div>
        <div className="relative w-full h-[70vh] overflow-hidden">
          <iframe
            src="https://www.youtube.com/embed/0fPL6Bq_2JE?autoplay=1&mute=1&loop=1&playlist=0fPL6Bq_2JE&controls=0&modestbranding=1&rel=0&showinfo=0&disablekb=1"
            title="عرض التلفزيونات"
            className="absolute inset-0 w-full h-full"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
        <div className="px-4 text-center">
          <p className="text-[#8b9df5] text-xs mt-3">الفيديو يعمل بدون صوت — اضغط للتشغيل بالصوت</p>
          <button
            type="button"
            onClick={() => {
              const tvTile = STORE_CATEGORY_TILES.find((t) => t.label === 'تلفزيونات');
              setCategoryTile(tvTile?.id ?? 'tv');
              document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="block bg-[#5B6BF5] text-white rounded-full px-6 py-3 mt-6 mx-auto hover:bg-[#4a59d9] transition-all active:scale-95 hover:shadow-lg"
          >
            تصفح التلفزيونات
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#1a1b3d] border-t border-[#2a2b50] pt-10">
        <div className="max-w-6xl mx-auto px-4 pb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <div className="text-sm font-bold text-white mb-1">{storeName || 'OnElect Company'}</div>
              <p className="text-[9px] text-[#8b8ec2] mb-3">منتج المنزليات والكهربائيات عند الاستلام</p>
              <p className="font-mono text-[10px] text-[#8b8ec2] leading-relaxed mb-3">
                وجهتك الأولى للأجهزة المنزلية والأجهزة الكهربائية.
              </p>
              <div className="flex gap-2">
                <a
                  href={instagramUrl || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 rounded-full bg-white/10 hover:bg-[#5B6BF5] flex items-center justify-center text-[#8b8ec2] hover:text-white transition-all"
                  aria-label="Instagram"
                >
                  <Instagram size={16} />
                </a>
                <a
                  href={facebookUrl || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 rounded-full bg-white/10 hover:bg-[#5B6BF5] flex items-center justify-center text-[#8b8ec2] hover:text-white transition-all"
                  aria-label="Facebook"
                >
                  <Facebook size={16} />
                </a>
                <a
                  href={tiktokUrl || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 rounded-full bg-white/10 hover:bg-[#5B6BF5] flex items-center justify-center text-[#8b8ec2] hover:text-white transition-all"
                  aria-label="TikTok"
                >
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
                  </svg>
                </a>
              </div>
            </div>
            {[
              { title: 'تسوق', items: ['أحدث المنتجات', 'العروض الخاصة', 'Babyliss', 'الأكثر مبيعاً'] },
              { title: 'خدمة العملاء', items: ['تواصل معنا', 'الأسئلة الشائعة', 'سياسة الإرجاع', 'الشحن والتوصيل'] },
              { title: 'عن الشركة', items: ['من نحن', storeName || 'OnElect Company', 'الوظائف', 'الشروط والأحكام'] },
            ].map((col) => (
              <div key={col.title}>
                <h4 className="text-[11px] font-bold text-white tracking-wider uppercase mb-3">{col.title}</h4>
                <ul className="space-y-2">
                  {col.items.map((item) => (
                    <li key={item}>
                      <span className="font-mono text-[10px] text-[#8b8ec2] hover:text-white cursor-pointer transition-colors">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-[#0D0E13] py-4 px-4 border-t border-[#2a2b50]">
          <div className="max-w-6xl mx-auto flex justify-between items-center flex-wrap gap-3" dir="ltr">
            <a
              href="https://swiftm.app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-[#1a1b3d] border border-[#2a2b50] rounded-full px-4 py-1.5 hover:border-[#5B6BF5] transition-all group"
            >
              <span className="text-[11px] text-[#8b8ec2] group-hover:text-white transition-colors">
                مدعوم بواسطة
              </span>
              <span className="text-[12px] font-black text-[#5B6BF5] group-hover:text-white transition-colors">
                Swiftm
              </span>
              <span className="text-[10px] text-[#6E7278]">إدارة تجارة ذكية</span>
            </a>
            <p className="text-[10px] text-[#6E7278] font-mono text-center">
              © {new Date().getFullYear()} {storeName}. جميع الحقوق محفوظة.
            </p>
            <div className="flex gap-4">
              <span className="text-[10px] text-[#6E7278] hover:text-white cursor-pointer transition-colors">
                سياسة الخصوصية
              </span>
              <span className="text-[10px] text-[#6E7278] hover:text-white cursor-pointer transition-colors">
                الشروط والأحكام
              </span>
            </div>
          </div>
        </div>
      </footer>

      {/* Cart drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-label="إغلاق"
            onClick={() => setCartOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-full max-w-[30rem] border-r border-[#E8E8EC] bg-[#F5F5F7] shadow-2xl flex flex-col">
            <div className="bg-[#1a1b3d] text-white px-4 py-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">عربة السوق</h2>
                <button
                  type="button"
                  onClick={() => setCartOpen(false)}
                  className="rounded-xl p-2 text-white/70 transition-colors hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>
              {cart.length > 0 ? (
                <p className="text-sm font-medium text-white/80">
                  تم إضافة "{cart[cart.length - 1]?.item?.name || 'منتج'}" إلى سلة مشترياتك.
                </p>
              ) : (
                <p className="text-sm text-white/70">سلتك فارغة حالياً.</p>
              )}
            </div>
            <div className="flex items-center justify-between border-b border-[#E8E8EC] bg-white px-4 py-2 text-sm font-bold text-[#0D0E13]">
              <span>العناصر</span>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="text-xs text-[#6E7278] underline decoration-[#E8E8EC] underline-offset-2 hover:text-[#5B6BF5]"
              >
                إغلاق
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-[#F5F5F7]">
              {cart.length === 0 ? (
                <p className="py-12 text-center text-[#6E7278]">السلة فارغة</p>
              ) : (
                cart.map((line) => {
                  const item = line.item;
                  const name = item?.name || '—';
                  return (
                    <div
                      key={line.id}
                      className="rounded-xl border border-[#E8E8EC] bg-white p-3"
                    >
                      <div className="flex gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="line-clamp-2 text-sm font-bold text-[#0D0E13]">{name}</p>
                          <p className="mt-1 text-sm font-bold text-[#5B6BF5] font-currency" lang="en">
                            ₪ {line.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => dec(line.id)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#E8E8EC] bg-white text-[#0D0E13] hover:border-[#5B6BF5] transition-colors"
                            >
                              <Minus size={15} />
                            </button>
                            <span className="min-w-6 text-center text-sm font-bold text-[#0D0E13] font-currency" lang="en">
                              {line.qty}
                            </span>
                            <button
                              type="button"
                              onClick={() => inc(line.id)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#E8E8EC] bg-white text-[#0D0E13] hover:border-[#5B6BF5] transition-colors"
                            >
                              <Plus size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeLine(line.id)}
                              className="mr-auto text-xs font-bold text-[#6E7278] hover:text-red-500 transition-colors"
                            >
                              إزالة
                            </button>
                          </div>
                        </div>
                        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-[#E8E8EC] bg-white flex items-center justify-center">
                          {getPublicImageUrl(item?.image) ? (
                            <img src={getPublicImageUrl(item.image)} alt="" className="max-h-full max-w-full object-contain" />
                          ) : (
                            <Package size={24} className="text-[#B0B2C3]" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="border-t border-[#E8E8EC] bg-white p-4 space-y-3">
              <div className="flex justify-between items-center text-[#0D0E13] font-bold">
                <span>الإجمالي</span>
                <span className="text-[#5B6BF5] font-currency text-2xl font-bold" lang="en">
                  ₪ {cartTotals.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <button
                type="button"
                disabled={cart.length === 0}
                onClick={() => {
                  setCartOpen(false);
                  setCheckoutOpen(true);
                }}
                className="w-full rounded-xl bg-[#1a1b3d] hover:bg-[#5B6BF5] py-3 text-sm font-bold text-white transition-all active:scale-95 hover:shadow-lg disabled:opacity-40"
              >
                إتمام الطلب
              </button>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="w-full rounded-xl border border-[#E8E8EC] bg-white py-2.5 text-sm font-bold text-[#0D0E13] hover:border-[#5B6BF5] transition-colors"
              >
                إضافة منتجات أخرى للطلب
              </button>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="w-full text-center text-sm font-bold text-[#6E7278] underline decoration-[#E8E8EC] underline-offset-2 hover:text-[#5B6BF5]"
              >
                عرض السلة
              </button>
            </div>
          </div>
        </div>
      )}

      {checkoutOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div
            className="w-full max-w-md rounded-2xl border border-indigo-500/20 bg-gradient-to-b from-slate-950 to-indigo-950 p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
            dir="rtl"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-black text-white">بيانات التوصيل</h2>
              <button
                type="button"
                onClick={() => setCheckoutOpen(false)}
                className="p-2 rounded-xl hover:bg-white/10 text-slate-400"
              >
                <X size={22} />
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              {paymentLink ? 'يمكنك اختيار الدفع عبر بطاقتك البنكية بأمان (عبر بواباتنا) أو الدفع عند الاستلام.' : 'الدفع عند الاستلام. لا يُطلب منك إدخال بطاقة بنكية.'}
            </p>
            <form onSubmit={handleSubmitOrder} className="space-y-3">
              {submitError && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-bold text-rose-200">
                  {submitError}
                </div>
              )}
              <label className="block">
                <span className="text-xs font-bold text-slate-400">الاسم الكامل</span>
                <input
                  required
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-slate-400">رقم الهاتف</span>
                <input
                  required
                  type="tel"
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white font-mono focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                  dir="ltr"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-slate-400">العنوان</span>
                <textarea
                  required
                  rows={3}
                  value={custAddress}
                  onChange={(e) => setCustAddress(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white resize-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-slate-400">ملاحظات (اختياري)</span>
                <textarea
                  rows={2}
                  value={custNotes}
                  onChange={(e) => setCustNotes(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white resize-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                />
              </label>
              <div className="flex flex-col gap-2 pt-2">
                 <button
                   type="submit"
                   onClick={() => setUseElectronicPayment(false)}
                   disabled={submitting || cart.length === 0}
                   className="w-full rounded-2xl bg-gradient-to-l from-amber-500 to-orange-400 hover:from-amber-400 hover:to-orange-300 text-slate-950 font-black py-3.5 flex items-center justify-center gap-2 shadow-lg shadow-amber-500/30 transition-all active:scale-95 hover:shadow-xl disabled:opacity-50"
                 >
                   {submitting && !useElectronicPayment ? <Loader2 className="animate-spin" size={22} /> : null}
                   تأكيد الطلب (الدفع عند الاستلام)
                 </button>
                 
                 {paymentLink && (
                    <button
                      type="submit"
                      onClick={() => setUseElectronicPayment(true)}
                      disabled={submitting || cart.length === 0}
                      className="w-full rounded-2xl bg-violet-600 hover:bg-violet-500 text-white font-black py-3.5 flex items-center justify-center gap-2 transition-all active:scale-95 hover:shadow-lg disabled:opacity-50 border border-violet-400/30"
                    >
                      {submitting && useElectronicPayment ? <Loader2 className="animate-spin" size={22} /> : null}
                      تأكيد الطلب والدفع إلكترونياً
                    </button>
                 )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
