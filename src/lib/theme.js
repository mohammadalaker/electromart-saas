import { useEffect, useState } from 'react';
import { BRAND_THEME_EVENT, brandStorageKey } from '../constants/brand.js';

/** تفضيل المظهر: يُطبَّق على `html` ليعمل `dark:` في كل التطبيق (لوحة التحكم، POS، إلخ). */
const STORAGE_KEY = brandStorageKey('theme');

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function setStoredTheme(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function applyExplicitTheme(mode) {
  document.documentElement.classList.toggle('dark', mode === 'dark');
  setStoredTheme(mode);
  window.dispatchEvent(new Event(BRAND_THEME_EVENT));
}

/** إزالة التفضيل المحفوظ ومزامنة المظهر مع إعدادات النظام (فاتح/داكن). */
export function applySystemTheme() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  document.documentElement.classList.toggle('dark', getSystemPrefersDark());
  window.dispatchEvent(new Event(BRAND_THEME_EVENT));
}

export function getSystemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** تهيئة أول تحميل: إن وُجد اختيار محفوظ يُستخدم، وإلا يتبع وضع النظام مع الاستماع للتغيير. */
export function initThemeOnBoot() {
  const stored = getStoredTheme();
  if (stored === 'dark' || stored === 'light') {
    document.documentElement.classList.toggle('dark', stored === 'dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

/** يتبع فئة `dark` على `document.documentElement` (من إعدادات النظام فقط، بدون أزرار في الصفحات). */
export function useHtmlDarkClass() {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
  );
  useEffect(() => {
    const sync = () => setDark(document.documentElement.classList.contains('dark'));
    window.addEventListener(BRAND_THEME_EVENT, sync);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onMq = () => {
      if (getStoredTheme() == null) sync();
    };
    mq.addEventListener('change', onMq);
    return () => {
      window.removeEventListener(BRAND_THEME_EVENT, sync);
      mq.removeEventListener('change', onMq);
    };
  }, []);
  return dark;
}
