import { supabase, STORAGE_BUCKET } from '../lib/supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';

/**
 * رابط عرض عام للصورة — مسار نسبي أو رابط https كامل.
 */
export function getPublicImageUrl(imageValue) {
  if (!imageValue || typeof imageValue !== 'string') return null;
  const img = String(imageValue).trim();
  if (!img) return null;
  if (img.startsWith('http://') || img.startsWith('https://')) return img;
  const path = img.replace(/^\//, '');
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return (
    data?.publicUrl ??
    (SUPABASE_URL
      ? `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`
      : img)
  );
}

/**
 * استخراج مسار الملف داخل الـ bucket من رابط تخزين Supabase أو إرجاع المسار كما هو.
 */
export function extractStoragePath(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  if (!s.startsWith('http')) return s.replace(/^\//, '');
  const m = s.match(/\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/);
  return m ? decodeURIComponent(m[1]) : null;
}
