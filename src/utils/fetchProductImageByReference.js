import { normalizeDigitsToLatin } from './normalizeDigits';
import { supabase } from '../lib/supabaseClient';

const MIN_REFERENCE_LEN = 2;

/**
 * جلب رابط صورة واحدة للمنتج اعتماداً على رقم المرجع.
 * يُستخدم للجلب التلقائي (debounce) عند الكتابة.
 */
export async function fetchProductImageByReference(rawReference, productName = '') {
  const ref = normalizeDigitsToLatin(String(rawReference ?? '').trim());
  if (!ref || ref.length < MIN_REFERENCE_LEN) {
    return { ok: false, url: null, source: null, code: 'SHORT_REFERENCE' };
  }
  const results = await fetchProductImageCandidates(rawReference, productName);
  if (results.length > 0) {
    return { ok: true, url: results[0].url, source: results[0].source, code: null };
  }
  return { ok: false, url: null, source: null, code: 'SERP_EMPTY' };
}

/**
 * جلب قائمة مرشحين (حتى 5 صور) لعرضها كـ thumbnails.
 * يُستخدم عند الضغط على زر "إعادة جلب".
 */
export async function fetchProductImageCandidates(rawReference, productName = '') {
  const ref = normalizeDigitsToLatin(String(rawReference ?? '').trim());
  if (!ref || ref.length < MIN_REFERENCE_LEN) return [];

  const candidates = [];

  // 1) Open Food Facts — للباركودات الغذائية الرقمية (8+ أرقام)
  const digitsOnly = ref.replace(/\D/g, '');
  if (digitsOnly.length >= 8) {
    try {
      const offUrl = await tryOpenFoodFactsImage(digitsOnly);
      if (offUrl) candidates.push({ url: offUrl, source: 'openfoodfacts', thumb: offUrl });
    } catch {
      /* ignore */
    }
  }

  // 2) Supabase Edge Function → ScaleSerp — الخيار الأساسي للإلكترونيات
  try {
    const query = buildSearchQuery(ref, String(productName ?? '').trim());
    const edgeResults = await tryEdgeFunctionImages(query);
    for (const r of edgeResults) {
      candidates.push({ url: r.src, thumb: r.thumb || r.src, source: 'scaleserp' });
    }
  } catch {
    /* ignore */
  }

  // 3) Wikimedia Commons — احتياطي مجاني إذا لم تكفِ النتائج
  if (candidates.length < 3) {
    try {
      const wikiUrl = await tryWikimediaCommonsImage(ref);
      if (wikiUrl) candidates.push({ url: wikiUrl, source: 'wikimedia_commons', thumb: wikiUrl });
    } catch {
      /* ignore */
    }
  }

  return candidates;
}

/**
 * بناء استعلام البحث بالإنجليزية:
 * استخراج الكلمات اللاتينية من اسم المنتج (ماركة/فئة) ودمجها مع المرجع.
 * مثال: ref="55C69B", name="تلفزيون TCL" → "55C69B TCL product"
 */
function buildSearchQuery(ref, productName) {
  const latinTokens = productName
    .split(/\s+/)
    .filter((t) => /^[A-Za-z0-9\-_.]+$/.test(t) && t.toLowerCase() !== ref.toLowerCase())
    .slice(0, 3);

  return [ref, ...latinTokens, 'product'].join(' ');
}

async function tryEdgeFunctionImages(query) {
  const { data, error } = await supabase.functions.invoke('image-search', {
    body: { query },
  });

  if (error || !data?.images) return [];

  return (data.images ?? []).filter((r) => r?.src && /^https?:\/\//i.test(r.src));
}

async function tryOpenFoodFactsImage(barcode) {
  const res = await fetch(
    `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  const p = data.product;
  return p.image_front_url || p.image_url || null;
}

async function tryWikimediaCommonsImage(query) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  u.searchParams.set('action', 'query');
  u.searchParams.set('generator', 'search');
  u.searchParams.set('gsrsearch', query);
  u.searchParams.set('gsrnamespace', '6');
  u.searchParams.set('gsrlimit', '5');
  u.searchParams.set('prop', 'imageinfo');
  u.searchParams.set('iiprop', 'url');
  u.searchParams.set('format', 'json');
  u.searchParams.set('origin', '*');

  const res = await fetch(u.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const data = await res.json();
  const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
  for (const page of pages) {
    const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
    const url = info?.url ? String(info.url).trim() : '';
    if (url && /^https:\/\//i.test(url)) return url;
  }
  return null;
}
