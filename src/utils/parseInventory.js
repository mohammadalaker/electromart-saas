<<<<<<< HEAD
import * as XLSX from 'xlsx';

const NAME_KEYS = ['Eng-Name', 'Eng Name', 'eng-name', 'Description', 'الوصف', 'الوصف / Description', 'Name', 'Item'];
const QTY_KEYS = ['Qty', 'Quantity', 'qty', 'quantity', 'الكمية', 'الكمية / Qty', 'Count'];
const PRICE_KEYS = ['Price', 'price', 'السعر', 'السعر / Price', 'Unit Price', 'Cost'];

function findColumn(row, keys) {
  if (!row || !Array.isArray(row)) return -1;
  const lower = (v) => String(v ?? '').toLowerCase().trim();
  for (let i = 0; i < row.length; i++) {
    const cell = lower(row[i]);
    if (keys.some(k => cell === k.toLowerCase() || cell.includes(k.toLowerCase().split(/[\s/]+/)[0])))
      return i;
  }
  return -1;
}

function toNum(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function toStr(v) {
  return String(v ?? '').trim();
}

/**
 * Parse Excel/CSV workbook and return { items, totalValue, totalQty }
 * Expects columns for name (Eng-Name/Description), Qty, Price.
 */
export function parseWorkbook(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!data.length) return { items: [], totalValue: 0, totalQty: 0 };

  const header = data[0];
  const nameIdx = findColumn(header, NAME_KEYS);
  const qtyIdx = findColumn(header, QTY_KEYS);
  const priceIdx = findColumn(header, PRICE_KEYS);

  const items = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const name = nameIdx >= 0 ? toStr(row[nameIdx]) : (row[0] != null ? toStr(row[0]) : '');
    const qty = qtyIdx >= 0 ? toNum(row[qtyIdx]) : toNum(row[1]);
    const price = priceIdx >= 0 ? toNum(row[priceIdx]) : toNum(row[2]);
    if (!name && qty === 0 && price === 0) continue;
    items.push({
      id: `row-${r}`,
      engName: name || 'Unnamed',
      qty: Math.max(0, qty),
      price: Math.max(0, price),
      value: Math.max(0, qty) * Math.max(0, price),
    });
  }

  const totalValue = items.reduce((s, i) => s + i.value, 0);
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  return { items, totalValue, totalQty };
}

/**
 * Parse a File (Excel or CSV) and return the same shape.
 */
export function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        resolve(parseWorkbook(wb));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}
=======
import * as XLSX from 'xlsx';

const NAME_KEYS = ['Eng-Name', 'Eng Name', 'eng-name', 'Description', 'الوصف', 'الوصف / Description', 'Name', 'Item'];
const QTY_KEYS = ['Qty', 'Quantity', 'qty', 'quantity', 'الكمية', 'الكمية / Qty', 'Count'];
const PRICE_KEYS = ['Price', 'price', 'السعر', 'السعر / Price', 'Unit Price', 'Cost'];

function findColumn(row, keys) {
  if (!row || !Array.isArray(row)) return -1;
  const lower = (v) => String(v ?? '').toLowerCase().trim();
  for (let i = 0; i < row.length; i++) {
    const cell = lower(row[i]);
    if (keys.some(k => cell === k.toLowerCase() || cell.includes(k.toLowerCase().split(/[\s/]+/)[0])))
      return i;
  }
  return -1;
}

function toNum(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function toStr(v) {
  return String(v ?? '').trim();
}

/**
 * Parse Excel/CSV workbook and return { items, totalValue, totalQty }
 * Expects columns for name (Eng-Name/Description), Qty, Price.
 */
export function parseWorkbook(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!data.length) return { items: [], totalValue: 0, totalQty: 0 };

  const header = data[0];
  const nameIdx = findColumn(header, NAME_KEYS);
  const qtyIdx = findColumn(header, QTY_KEYS);
  const priceIdx = findColumn(header, PRICE_KEYS);

  const items = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const name = nameIdx >= 0 ? toStr(row[nameIdx]) : (row[0] != null ? toStr(row[0]) : '');
    const qty = qtyIdx >= 0 ? toNum(row[qtyIdx]) : toNum(row[1]);
    const price = priceIdx >= 0 ? toNum(row[priceIdx]) : toNum(row[2]);
    if (!name && qty === 0 && price === 0) continue;
    items.push({
      id: `row-${r}`,
      engName: name || 'Unnamed',
      qty: Math.max(0, qty),
      price: Math.max(0, price),
      value: Math.max(0, qty) * Math.max(0, price),
    });
  }

  const totalValue = items.reduce((s, i) => s + i.value, 0);
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  return { items, totalValue, totalQty };
}

/**
 * Parse a File (Excel or CSV) and return the same shape.
 */
export function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        resolve(parseWorkbook(wb));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}
>>>>>>> fea0a82cfd606a9ad96144983f837e51af84636f
