import { supabase, STORAGE_BUCKET } from '../lib/supabaseClient';

/**
 * رفع صورة المنتج إلى Storage تحت مجلد المتجر، وإرجاع المسار النسبي لحفظه في image_url.
 * مثال: "uuid-store-id/550e8400-e29b-41d4-a716-446655440000.jpg"
 */
export async function uploadProductImageFile(storeId, file) {
  if (!storeId || !file) {
    throw new Error('متجر غير متوفر أو لم يُختر ملف صورة.');
  }
  const rawExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const safeExt = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'jpg';
  const filePath = `${storeId}/${crypto.randomUUID()}.${safeExt}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(filePath, file, {
    upsert: false,
  });
  if (error) throw error;
  return filePath;
}

/**
 * رفع صورة فاتورة المورد الأصلية (مرجع) — مجلد purchase-invoices داخل نفس الـ bucket.
 */
export async function uploadPurchaseInvoiceScan(storeId, file) {
  if (!storeId || !file) {
    throw new Error('متجر غير متوفر أو لم يُختر ملف.');
  }
  const rawExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const safeExt = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'jpg';
  const filePath = `${storeId}/purchase-invoices/${crypto.randomUUID()}.${safeExt}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(filePath, file, {
    upsert: false,
  });
  if (error) throw error;
  return filePath;
}
