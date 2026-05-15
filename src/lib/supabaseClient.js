import { createClient } from '@supabase/supabase-js';

/** يتصل بسوبابيس باستخدام المتغيرات من ملف .env */
const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const rawSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const ALLOW_LEGACY_SUPABASE = import.meta.env.VITE_ALLOW_LEGACY_SUPABASE === '1';
const BLOCKED_PROJECT_REFS = ['mjiucapmxwkscsqfgcvx'];

const isBlockedLegacyProject = BLOCKED_PROJECT_REFS.some((ref) =>
  rawSupabaseUrl.includes(`${ref}.supabase.co`)
);

const fallbackIsolatedUrl = 'https://isolated-not-configured.supabase.co';
const fallbackIsolatedAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJpc29sYXRlZC1ub3QtY29uZmlndXJlZCIsInJlZiI6Imlzb2xhdGVkLW5vdC1jb25maWd1cmVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUyNjA4MDAsImV4cCI6MjA2MDYyMDgwMH0.0000000000000000000000000000000000000000000';

const supabaseUrl =
  isBlockedLegacyProject && !ALLOW_LEGACY_SUPABASE ? fallbackIsolatedUrl : rawSupabaseUrl;
const supabaseAnonKey =
  isBlockedLegacyProject && !ALLOW_LEGACY_SUPABASE ? fallbackIsolatedAnonKey : rawSupabaseAnonKey;

if (isBlockedLegacyProject && !ALLOW_LEGACY_SUPABASE) {
  console.error(
    'Blocked legacy Supabase project in isolated app. Set new VITE_SUPABASE_* values for the isolated backend.'
  );
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase env vars. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * اسم جدول المنتجات في PostgREST (تجنّب الخطأ المرجعي لاسم جدول قديم مثل items).
 * غيّره من هنا أو عبر VITE_SUPABASE_PRODUCTS_TABLE في .env
 */
export const PRODUCTS_TABLE =
  import.meta.env.VITE_SUPABASE_PRODUCTS_TABLE?.trim() || 'products';

/** عمود كمية المخزن في جدول المنتجات (مثلاً stock_count أو stock_quantity حسب مخططك). */
export const PRODUCTS_STOCK_COLUMN =
  import.meta.env.VITE_PRODUCTS_STOCK_COLUMN?.trim() || 'stock_count';

/** اسم bucket صور المنتجات في Storage (يجب أن يطابق الاسم في لوحة Supabase) */
export const STORAGE_BUCKET = 'Pic_of_items';
