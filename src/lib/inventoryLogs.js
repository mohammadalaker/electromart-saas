import { supabase } from './supabaseClient';

const TABLE = 'inventory_logs';

function isMissingTable(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || '');
  return err.code === 'PGRST205' || err.code === '42P01' || /does not exist|schema cache/i.test(msg);
}

/** اسم للعرض من جلسة المستخدم الحالي */
export async function getActorDisplayName() {
  try {
    const { data } = await supabase.auth.getUser();
    const u = data?.user;
    if (!u) return null;
    const m = u.user_metadata || {};
    const name = [m.full_name, m.name, m.display_name].find((x) => String(x || '').trim());
    if (name) return String(name).trim();
    return u.email?.split('@')[0] || 'مستخدم';
  } catch {
    return null;
  }
}

/**
 * تسجيل حركة مخزن — يتجاهل الصمت إن لم يُنفَّذ الجدول في Supabase.
 */
export async function insertInventoryLog({
  storeId,
  productId,
  barcode,
  productName,
  qtyBefore,
  qtyAfter,
  reason = 'adjustment',
}) {
  if (!storeId) return;
  const { data: userData } = await supabase.auth.getUser();
  const u = userData?.user;
  const userId = u?.id ?? null;
  const m = u?.user_metadata || {};
  const actorName =
    [m.full_name, m.name, m.display_name].find((x) => String(x || '').trim()) ||
    u?.email?.split('@')[0] ||
    'مستخدم';

  const { error } = await supabase.from(TABLE).insert([
    {
      store_id: storeId,
      user_id: userId,
      actor_name: actorName,
      product_id: productId && /^[0-9a-f-]{36}$/i.test(String(productId)) ? productId : null,
      barcode: barcode != null ? String(barcode) : null,
      product_name: productName != null ? String(productName).slice(0, 500) : null,
      qty_before: Number(qtyBefore) || 0,
      qty_after: Number(qtyAfter) || 0,
      reason,
    },
  ]);

  if (error && !isMissingTable(error)) {
    console.warn('[inventory_logs]', error.message);
  }
}
