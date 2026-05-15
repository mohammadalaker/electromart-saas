import { useEffect, useState } from 'react';

import { brandStorageKey } from '../constants/brand.js';

const STORAGE_KEY = brandStorageKey('barcode-mode');

/** @returns {'scanner' | 'manual'} */
export function getBarcodeInputMode() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'manual' || v === 'scanner') return v;
  } catch {
    /* ignore */
  }
  return 'scanner';
}

/** @param {'scanner' | 'manual'} mode */
export function setBarcodeInputMode(mode) {
  if (mode !== 'manual' && mode !== 'scanner') return;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('inventory-barcode-mode-change'));
}

/** true = تركيز تلقائي على حقل الباركود لقارئ يعمل كلوحة مفاتيح */
export function useBarcodeScannerMode() {
  const [scanner, setScanner] = useState(() => getBarcodeInputMode() === 'scanner');
  useEffect(() => {
    const sync = () => setScanner(getBarcodeInputMode() === 'scanner');
    window.addEventListener('inventory-barcode-mode-change', sync);
    return () => window.removeEventListener('inventory-barcode-mode-change', sync);
  }, []);
  return scanner;
}
