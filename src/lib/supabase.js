import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const allowLegacy = import.meta.env.VITE_ALLOW_LEGACY_SUPABASE === '1';
const isLegacyProject = String(supabaseUrl || '').includes('mjiucapmxwkscsqfgcvx.supabase.co');

if (isLegacyProject && !allowLegacy) {
  console.error(
    'Blocked legacy Supabase project in isolated app. Update VITE_SUPABASE_* in .env to isolated backend.'
  );
}

export const supabase =
  supabaseUrl && supabaseAnonKey && (!isLegacyProject || allowLegacy)
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export const isSupabaseConfigured = () => !!supabase;
