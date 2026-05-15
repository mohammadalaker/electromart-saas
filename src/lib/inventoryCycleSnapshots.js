import { supabase } from './supabaseClient';

function isMissingFn(err) {
  if (!err) return false;
  const msg = String(err.message || '');
  return /function .* does not exist|42883|PGRST202/i.test(msg);
}

function isMissingTable(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || '');
  return err.code === 'PGRST205' || err.code === '42P01' || /does not exist|schema cache/i.test(msg);
}

/**
 * @param {string} storeId
 * @returns {Promise<{ auto_snapshot_enabled: boolean, interval_days: number, last_auto_snapshot_at: string | null } | null>}
 */
export async function fetchCycleSettings(storeId) {
  if (!storeId) return { data: null, missingSchema: false };
  const { data, error } = await supabase
    .from('store_inventory_cycle_settings')
    .select('auto_snapshot_enabled, interval_days, last_auto_snapshot_at')
    .eq('store_id', storeId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { data: null, missingSchema: true };
    console.warn('[cycle_settings]', error.message);
    return { data: null, missingSchema: false };
  }
  return { data, missingSchema: false };
}

/**
 * @param {string} storeId
 * @param {{ auto_snapshot_enabled?: boolean, interval_days?: number }} patch
 */
export async function upsertCycleSettings(storeId, patch) {
  if (!storeId) return { error: new Error('no store') };
  const row = {
    store_id: storeId,
    updated_at: new Date().toISOString(),
    ...patch,
  };
  const { error } = await supabase.from('store_inventory_cycle_settings').upsert([row], {
    onConflict: 'store_id',
  });
  return { error };
}

/**
 * @param {string} storeId
 * @returns {Promise<{ batch_id: string, created_at: string, source: string } | null>}
 */
export async function fetchLastCycleSnapshotMeta(storeId) {
  if (!storeId) return { data: null, missingSchema: false };
  const { data, error } = await supabase
    .from('inventory_cycle_snapshots')
    .select('batch_id, created_at, source')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { data: null, missingSchema: true };
    console.warn('[cycle_snapshots]', error.message);
    return { data: null, missingSchema: false };
  }
  return { data, missingSchema: false };
}

/**
 * استدعاء دالة قاعدة البيانات لتسجيل لقطة جرد لكل المنتجات.
 * @param {string} storeId
 * @returns {Promise<{ batchId: string | null, error: Error | null }>}
 */
export async function runManualCycleSnapshot(storeId) {
  if (!storeId) return { batchId: null, error: new Error('no store') };
  const { data, error } = await supabase.rpc('create_inventory_cycle_snapshot', {
    p_store_id: storeId,
    p_source: 'manual',
  });
  if (error) {
    if (isMissingFn(error) || isMissingTable(error)) {
      return { batchId: null, error: new Error('لم يُنفَّذ ملف SQL للجرد في Supabase بعد.') };
    }
    return { batchId: null, error: new Error(error.message || 'فشل تسجيل اللقطة') };
  }
  const batchId = data != null ? String(data) : null;
  return { batchId, error: null };
}
