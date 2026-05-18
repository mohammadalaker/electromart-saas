import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Loader2,
  ShoppingCart,
  Plus,
  Minus,
  X,
  Search,
  Filter,
  Package,
  Sparkles,
} from 'lucide-react';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { normalizeItemFromSupabase, roundMoney, isUuid, runProductsSelectWithFallback } from '../utils/productModel';
import { getPublicImageUrl } from '../utils/storageImageUrl';
import { isInventoryOutOfStock } from '../lib/inventoryStock';
import { STORE_CATEGORY_TILES, itemMatchesStoreCategory, getProductTypeLabel } from '../utils/productTypes';
import SwiftmLogo from '../components/SwiftmLogo.jsx';
import {
  BRAND_FOOTER_AR,
  BRAND_NAME,
  BRAND_NAME_LOWER,
  BRAND_TAGLINE_EN,
  brandCopyright,
  brandPublicCartKey,
} from '../constants/brand.js';
import heroKitchenImage from '../assets/store-hero-kitchen.jpg';

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

export default function PublicStorePage() {
  const { slug: slugParam } = useParams();
  const slug = (slugParam || '').trim().toLowerCase();

  const [storeId, setStoreId] = useState(null);
  const [storeName, setStoreName] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [search, setSearch] = useState('');
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
          .select('id,name')
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100" dir="rtl">
        <Loader2 className="animate-spin text-blue-700" size={48} />
      </div>
    );
  }

  if (loadError || !storeId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-100 text-slate-800" dir="rtl">
        <Package className="text-slate-400 mb-4" size={48} />
        <p className="text-lg font-black text-center">{loadError || 'المتجر غير متاح'}</p>
        <Link to="/" className="mt-6 text-blue-700 font-bold hover:underline">
          العودة
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 text-slate-900" dir="rtl">
      <header className="sticky top-0 z-40 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-2xl border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3">
            <div>
              <h1 className="text-sm sm:text-base font-black truncate text-white">{storeName || 'متجر إلكتروني'}</h1>
              <p className="text-[11px] text-indigo-300/80 mt-0.5">
                {paymentLink ? 'الدفع عند الاستلام أو إلكترونياً' : 'تصفّح المنتجات — الدفع عند الاستلام'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            aria-label="فتح السلة"
            className="order-first relative inline-flex w-11 h-11 shrink-0 items-center justify-center rounded-2xl bg-white/5 text-white/90 transition-colors hover:bg-white/15 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <ShoppingCart size={22} strokeWidth={1.75} />
            {cartCount > 0 ? (
              <span
                className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 inline-flex items-center justify-center rounded-full bg-white text-blue-800 text-[10px] font-black font-currency shadow"
                lang="en"
              >
                {cartCount}
              </span>
            ) : null}
          </button>
        </div>
      </header>

      {submitDone && (
        <div className="max-w-6xl mx-auto px-4 pt-4">
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 text-center">
            تم استلام طلبك. سيتواصل معك المتجر قريباً. شكراً لثقتك.
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <section className="relative overflow-hidden rounded-3xl shadow-2xl border border-slate-200">
          <img
            src={heroKitchenImage}
            alt="بانر أجهزة مطبخ"
            className="block h-[420px] sm:h-[500px] w-full object-cover brightness-125 contrast-100 saturate-110"
            loading="eager"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-black/20 to-black/10" />
          <div className="absolute inset-0 bg-black/20" />
          <div className="absolute bottom-8 right-8 z-10 text-right max-w-xs">
            <span className="inline-block text-[10px] font-bold tracking-[0.35em] text-white/70 uppercase mb-2">مجموعة مختارة</span>
            <h2 className="text-4xl sm:text-5xl font-black text-white leading-tight" style={{ textShadow: '0 2px 20px rgba(0,0,0,0.5)' }}>أجهزة مطبخ أذكى<br/>لأداء أفضل.</h2>
            <p className="mt-3 text-sm text-white/80">ذوق رفيع.. وأداء أذكى.</p>
          </div>
        </section>

        <div className="space-y-4">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-slate-100 shadow-sm">
            <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-2 pt-1 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.4)_transparent]">
              {STORE_CATEGORY_TILES.map((tile) => {
                const active = categoryTile === tile.id;
                const preview = tile.id === 'all' ? null : tilePreviewById[tile.id];
                return (
                  <button
                    key={tile.id}
                    type="button"
                    onClick={() => setCategoryTile(tile.id)}
                    className={`flex shrink-0 flex-col items-center gap-2 w-[4.75rem] sm:w-[5.75rem] text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-xl pb-1 transition-all duration-200 ${
                      active ? 'opacity-100' : 'opacity-90 hover:opacity-100'
                    }`}
                  >
                    <span
                      className={`flex h-[4.5rem] w-[4.5rem] sm:h-[5.25rem] sm:w-[5.25rem] items-center justify-center overflow-hidden rounded-[1.35rem] border transition-all duration-200 ${
                        active
                          ? 'border-indigo-500 ring-2 ring-indigo-200 shadow-md bg-gradient-to-br from-indigo-50 to-blue-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      {tile.id === 'all' ? (
                        <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-100 to-slate-100">
                          <Sparkles className="text-blue-600" size={28} strokeWidth={2} />
                        </span>
                      ) : preview ? (
                        <img src={preview} alt="" className="h-full w-full object-contain p-1.5" />
                      ) : (
                        <Package className="text-slate-500" size={32} />
                      )}
                    </span>
                    <span
                      className={`max-w-[5.75rem] px-0.5 text-[10px] sm:text-[11px] font-black leading-tight ${
                        active ? 'text-slate-900' : 'text-slate-600'
                      }`}
                    >
                      {tile.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/60 bg-white/90 backdrop-blur-sm p-4 space-y-3 shadow-sm">
            <div className="flex items-center gap-2 text-blue-700 font-bold text-xs">
              <Filter size={16} />
              بحث وتصفية إضافية
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث بالاسم أو الباركود…"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 pl-3 pr-10 py-2.5 text-sm font-medium placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 transition-all"
                />
              </div>
              <select
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 transition-all"
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
        </div>

        {filteredItems.length > PRODUCTS_PER_PAGE && (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPageClamped <= 1}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-40 transition-all hover:shadow-md"
            >
              الصفحة السابقة
            </button>
            <p className="text-sm font-bold text-slate-700">
              صفحة {currentPageClamped} من {totalPages}
            </p>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPageClamped >= totalPages}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-40 transition-all hover:shadow-md"
            >
              الصفحة التالية
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {pagedItems.map((item) => {
            const img = getPublicImageUrl(item.image);
            const out = isInventoryOutOfStock(item);
            const inCart = cartLineById.get(item.id);
            return (
              <article
                key={item.id}
                className="group relative rounded-3xl border border-slate-100 bg-white overflow-hidden hover:border-indigo-200 hover:shadow-2xl hover:shadow-indigo-100/50 hover:-translate-y-2 transition-all duration-300 flex flex-col"
              >
                <div className="aspect-[4/3] bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 flex items-center justify-center p-6 border-b border-slate-100/60">
                  {img ? (
                    <img src={img} alt="" className="max-h-full max-w-full object-contain drop-shadow-lg" />
                  ) : (
                    <Package className="text-slate-300" size={64} />
                  )}
                </div>
                <div className="p-4 flex-1 flex flex-col">
                  <p className="text-[10px] font-black text-indigo-500 mb-1 tracking-wide uppercase">
                    {getProductTypeLabel(item.productType) || '—'}
                  </p>
                  {item.group ? (
                    <p className="text-[10px] font-bold text-slate-500 mb-1">{item.group}</p>
                  ) : null}
                  <h2 className="text-base font-black text-slate-900 leading-snug line-clamp-2 min-h-[2.5rem]">
                    {item.name || '—'}
                  </h2>
                  <p className="text-[11px] text-slate-400 font-mono mt-1" dir="ltr">
                    {item.barcode}
                  </p>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <div>
                      <p className="text-xs text-slate-500">السعر</p>
                      <p className="text-2xl font-black text-slate-900 font-currency" lang="en">
                        ₪ {roundMoney(item.priceAfterDiscount ?? item.price ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <span
                      className={`text-[11px] font-bold px-2 py-1 rounded-lg ${
                        out ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {out ? 'غير متوفر' : `متوفر: ${Number(item.stock ?? 0)}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={out}
                    onClick={() => addToCart(item)}
                    className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-indigo-600 to-blue-500 hover:from-indigo-500 hover:to-blue-400 active:scale-[0.98] text-white font-black py-3.5 shadow-lg shadow-indigo-200/60 transition-all duration-200 disabled:opacity-30 disabled:pointer-events-none disabled:bg-slate-300 disabled:shadow-none"
                  >
                    <Plus size={18} />
                    {inCart ? `في السلة (${inCart.qty})` : 'أضف للسلة'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        {filteredItems.length === 0 && (
          <div className="text-center py-20 text-slate-500 font-bold">لا توجد منتجات مطابقة للتصفية.</div>
        )}

        {filteredItems.length > PRODUCTS_PER_PAGE && (
          <div className="flex items-center justify-center gap-2">
            {pageTokens.map((token) => {
              if (typeof token === 'string') {
                return (
                  <span key={token} className="px-1 text-sm font-black text-slate-400">
                    ...
                  </span>
                );
              }

              return (
                <button
                  key={token}
                  type="button"
                  onClick={() => setCurrentPage(token)}
                  className={`h-9 min-w-9 px-2 text-sm font-black transition-all ${
                    token === currentPageClamped
                      ? 'rounded-xl bg-gradient-to-l from-indigo-600 to-blue-500 text-white shadow-md shadow-indigo-200'
                      : 'rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:shadow-md'
                  }`}
                >
                  {token}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <footer className="mt-8 text-white">
        <div className="h-16 bg-white border-t border-slate-200" />
        <div className="relative overflow-hidden border-t border-white/10 bg-gradient-to-b from-[#04177a] via-[#03115f] to-[#020a41]">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 -rotate-90 text-[94px] font-semibold tracking-[-0.02em] text-white/15 hidden xl:block">
            {BRAND_NAME_LOWER}
          </span>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-[94px] font-semibold tracking-[-0.02em] text-white/15 hidden xl:block">
            {BRAND_NAME_LOWER}
          </span>

          <div className="max-w-6xl mx-auto px-4 py-12 relative z-10">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
              <div>
                <h3 className="text-sm font-black mb-4 text-blue-100">خدمة العملاء</h3>
                <ul className="space-y-2.5 text-sm text-blue-100/85">
                  <li>الشحن والتوصيل</li>
                  <li>الاستبدال والاسترجاع</li>
                  <li>دعم المنتجات</li>
                  <li>تواصل معنا</li>
                  <li>موقع المتجر</li>
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-black mb-4 text-blue-100">سياساتنا</h3>
                <ul className="space-y-2.5 text-sm text-blue-100/85">
                  <li>سياسة الاستخدام</li>
                  <li>إعدادات ملفات الارتباط</li>
                  <li>سياسة الكوكيز</li>
                  <li>سياسة الخصوصية</li>
                  <li>الشروط والأحكام</li>
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-black mb-4 text-blue-100">عن الشركة</h3>
                <ul className="space-y-2.5 text-sm text-blue-100/85">
                  <li>عن {BRAND_NAME}</li>
                  <li>المسؤولية المجتمعية</li>
                  <li>الاستثمار</li>
                  <li>الوظائف</li>
                  <li>الأخبار</li>
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-black mb-4 text-blue-100">روابط التواصل</h3>
                <ul className="space-y-2.5 text-sm text-blue-100/85">
                  <li>Facebook</li>
                  <li>Instagram</li>
                  <li>LinkedIn</li>
                  <li>YouTube</li>
                  <li>TikTok</li>
                </ul>
              </div>
            </div>

            <div className="mt-12 text-center">
              <p className="text-[2.3rem] font-semibold tracking-[-0.02em] text-white/90 leading-none">{BRAND_NAME_LOWER}</p>
              <p className="mt-2 text-[0.7rem] font-semibold tracking-[0.45em] text-blue-100/65">{BRAND_TAGLINE_EN}</p>
            </div>

            <div className="mt-12 pt-5 border-t border-white/15 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs sm:text-sm text-blue-100/75">
                {brandCopyright()}
              </p>
              <p className="text-xs text-blue-200/70">{BRAND_FOOTER_AR}</p>
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
          <div className="absolute left-0 top-0 h-full w-full max-w-[30rem] border-r border-slate-200 bg-gradient-to-b from-white to-slate-50/80 shadow-2xl flex flex-col">
            <div className="border-b border-indigo-100 bg-gradient-to-l from-indigo-50 to-white px-4 py-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xl font-black text-slate-900">عربة السوق</h2>
                <button
                  type="button"
                  onClick={() => setCartOpen(false)}
                  className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                >
                  <X size={20} />
                </button>
              </div>
              {cart.length > 0 ? (
                <p className="text-sm font-bold text-slate-700">
                  تم إضافة "{cart[cart.length - 1]?.item?.name || 'منتج'}" إلى سلة مشترياتك.
                </p>
              ) : (
                <p className="text-sm text-slate-500">سلتك فارغة حالياً.</p>
              )}
            </div>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-sm font-bold text-slate-700">
              <span>العناصر</span>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="text-xs text-slate-500 underline decoration-slate-300 underline-offset-2"
              >
                إغلاق
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-slate-50/60">
              {cart.length === 0 ? (
                <p className="py-12 text-center text-slate-500">السلة فارغة</p>
              ) : (
                cart.map((line) => {
                  const item = line.item;
                  const name = item?.name || '—';
                  return (
                    <div
                      key={line.id}
                      className="rounded-2xl border border-slate-200 bg-white p-3"
                    >
                      <div className="flex gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="line-clamp-2 text-sm font-bold text-slate-900">{name}</p>
                          <p className="mt-1 text-sm font-black text-[#ff6b00] font-currency" lang="en">
                            ₪ {line.unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => dec(line.id)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700"
                            >
                              <Minus size={15} />
                            </button>
                            <span className="min-w-6 text-center text-sm font-black text-slate-900 font-currency" lang="en">
                              {line.qty}
                            </span>
                            <button
                              type="button"
                              onClick={() => inc(line.id)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700"
                            >
                              <Plus size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeLine(line.id)}
                              className="mr-auto text-xs font-bold text-slate-500 underline underline-offset-2"
                            >
                              إزالة
                            </button>
                          </div>
                        </div>
                        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white flex items-center justify-center">
                          {getPublicImageUrl(item?.image) ? (
                            <img src={getPublicImageUrl(item.image)} alt="" className="max-h-full max-w-full object-contain" />
                          ) : (
                            <Package size={24} className="text-slate-300" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="border-t border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 font-bold text-slate-700"
                >
                  <span className="text-base" aria-hidden>
                    📝
                  </span>
                  ملاحظة
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 font-bold text-slate-700"
                >
                  <span className="text-base" aria-hidden>
                    🎟️
                  </span>
                  كوبون
                </button>
              </div>
              <div className="flex justify-between items-center text-slate-900 font-black">
                <span>الإجمالي</span>
                <span className="text-[#ff6b00] font-currency text-2xl" lang="en">
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
                className="w-full rounded-2xl bg-gradient-to-l from-indigo-700 to-blue-600 py-3 text-sm font-black text-white shadow-lg disabled:opacity-40"
              >
                إتمام الطلب
              </button>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="w-full rounded-xl border border-slate-300 bg-white py-2.5 text-sm font-bold text-slate-700 hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
              >
                إضافة منتجات أخرى للطلب
              </button>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="w-full text-center text-sm font-bold text-slate-900 underline decoration-slate-300 underline-offset-2"
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
                   className="w-full rounded-2xl bg-gradient-to-l from-amber-500 to-orange-400 hover:from-amber-400 hover:to-orange-300 text-slate-950 font-black py-3.5 flex items-center justify-center gap-2 shadow-lg shadow-amber-500/30 disabled:opacity-50"
                 >
                   {submitting && !useElectronicPayment ? <Loader2 className="animate-spin" size={22} /> : null}
                   تأكيد الطلب (الدفع عند الاستلام)
                 </button>
                 
                 {paymentLink && (
                    <button
                      type="submit"
                      onClick={() => setUseElectronicPayment(true)}
                      disabled={submitting || cart.length === 0}
                      className="w-full rounded-2xl bg-violet-600 hover:bg-violet-500 text-white font-black py-3.5 flex items-center justify-center gap-2 disabled:opacity-50 border border-violet-400/30"
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
