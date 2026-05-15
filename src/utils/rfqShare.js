import { normalizeDigitsToLatin } from './normalizeDigits';

/**
 * تحويل هاتف محلي (مثل 05…) إلى صيغة wa.me (972…).
 */
export function normalizePhoneForWhatsApp(raw) {
  if (!raw) return '';
  let d = normalizeDigitsToLatin(String(raw)).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('972')) return d;
  if (d.startsWith('0') && d.length >= 9 && d.length <= 11) {
    return `972${d.slice(1)}`;
  }
  if (d.length === 9) {
    return `972${d}`;
  }
  return d;
}

/**
 * نص عربي جاهز لطلب التسعيرة (بريد / واتساب / نسخ).
 */
export function buildRfqMessageText({ storeName, rfqTitle, lines }) {
  const head = storeName ? `من: ${storeName}\n` : '';
  let s = `${head}\nطلب تسعيرة (RFQ): ${rfqTitle || '—'}\n\nالأصناف المطلوب تسعيرها:\n`;
  (lines || []).forEach((ln, i) => {
    const namePart = (ln.productName || '').trim() || (ln.description || '').trim() || '—';
    const tp =
      ln.target_price != null && ln.target_price !== '' && !Number.isNaN(Number(ln.target_price))
        ? ` — سعر مستهدف: \u20aa${Number(ln.target_price).toFixed(2)}`
        : '';
    s += `${i + 1}) ${namePart} — الكمية: ${ln.qty}${tp}\n`;
  });
  s += '\nنرجو إرسال عرض السعر والمدة المتوقعة.\nمع الشكر.';
  return s;
}

export function mailtoHref(email, subject, body) {
  const em = String(email || '').trim();
  if (!em) return '';
  const s = encodeURIComponent(subject);
  const b = encodeURIComponent(body);
  return `mailto:${em}?subject=${s}&body=${b}`;
}

export function whatsappHref(phoneDigits, body) {
  const p = normalizePhoneForWhatsApp(phoneDigits);
  if (!p) return '';
  const t = encodeURIComponent(body);
  return `https://wa.me/${p}?text=${t}`;
}
