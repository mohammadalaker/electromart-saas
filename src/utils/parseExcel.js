import * as XLSX from 'xlsx';
import JSZip from 'jszip';

const NAME_KEYS = ['Eng-Name', 'Eng Name', 'الوصف', 'Description', 'الوصف / Description', 'Name', 'Item', 'اسم القطعة'];
const QTY_KEYS = ['Qty', 'Quantity', 'الكمية', 'الكمية / Qty', 'Count'];
const PRICE_KEYS = ['Price', 'price', 'السعر', 'السعر / Price', 'Unit Price', 'Cost'];
const GROUP_KEYS = ['group', 'Group', 'المجموعة', 'الفئة', 'Category', 'صنف'];
const IMAGE_KEYS = ['Image', 'image', 'صورة', 'رابط الصورة', 'Photo', 'Picture', 'URL', 'رابط'];
const STATUS_KEYS = ['Status', 'status', 'الحالة', 'الحالة / Status', 'State'];

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

function findColumn(row, keys) {
  if (!row || !Array.isArray(row)) return -1;
  const lower = (v) => String(v ?? '').toLowerCase().trim();
  for (let i = 0; i < row.length; i++) {
    const cell = lower(row[i]);
    const found = keys.some((k) => {
      const part = k.toLowerCase().split(/[\s/]+/)[0];
      return cell === k.toLowerCase() || (part && cell.includes(part));
    });
    if (found) return i;
  }
  return -1;
}

function toNum(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

function toStr(v) {
  return String(v ?? '').trim();
}

/**
 * استخراج الصور المضمنة من ملف xlsx (مجلد xl/media)
 * ترتيب الصور حسب اسم الملف ثم ربطها بالصفوف بالترتيب: الصورة الأولى → الصف الأول، إلخ.
 */
async function extractEmbeddedImages(arrayBuffer) {
  const out = [];
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xl = zip.folder('xl');
    if (!xl) return out;
    const media = xl.folder('media');
    if (!media) return out;

    const names = [];
    media.forEach((path, file) => {
      if (!file.dir) names.push(path);
    });
    names.sort((a, b) => String(a).localeCompare(b, undefined, { numeric: true }));

    for (const name of names) {
      const ext = (name.split('.').pop() || '').toLowerCase();
      const mime = MIME[ext] || 'image/png';
      const base64 = await media.file(name)?.async('base64');
      if (base64) out.push(`data:${mime};base64,${base64}`);
    }
  } catch (_) {}
  return out;
}

export function parseWorkbook(workbook, embeddedImages = []) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!data.length) return { items: [], totalValue: 0, totalQty: 0 };

  const header = data[0];
  const nameIdx = findColumn(header, NAME_KEYS);
  const qtyIdx = findColumn(header, QTY_KEYS);
  const priceIdx = findColumn(header, PRICE_KEYS);
  const groupIdx = findColumn(header, GROUP_KEYS);
  const imageIdx = findColumn(header, IMAGE_KEYS);
  const statusIdx = findColumn(header, STATUS_KEYS);

  const items = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const name = nameIdx >= 0 ? toStr(row[nameIdx]) : toStr(row[0]);
    const qty = qtyIdx >= 0 ? toNum(row[qtyIdx]) : toNum(row[1]);
    const price = priceIdx >= 0 ? toNum(row[priceIdx]) : toNum(row[2]);
    const group = groupIdx >= 0 ? toStr(row[groupIdx]) : '';
    let image = imageIdx >= 0 ? toStr(row[imageIdx]) : '';
    const status = statusIdx >= 0 ? toStr(row[statusIdx]) : '';

    if (!name && qty === 0 && price === 0) continue;

    const rowIndex = items.length;
    if (!image && embeddedImages[rowIndex]) {
      image = embeddedImages[rowIndex];
    }

    items.push({
      id: `row-${r}`,
      name: name || 'بدون اسم',
      group: group || '—',
      price: Math.max(0, price),
      qty: Math.max(0, qty),
      value: Math.max(0, qty) * Math.max(0, price),
      image: image || null,
      status: status || (qty <= 2 ? 'Critical' : qty <= 5 ? 'Low Stock' : 'In Stock'),
    });
  }

  const totalValue = items.reduce((s, i) => s + i.value, 0);
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  return { items, totalValue, totalQty };
}

export function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const buf = e.target.result;
        const data = new Uint8Array(buf);
        const wb = XLSX.read(data, { type: 'array' });

        let embedded = [];
        const name = (file.name || '').toLowerCase();
        if (name.endsWith('.xlsx') && !name.endsWith('.xls')) {
          embedded = await extractEmbeddedImages(buf);
        }

        const result = parseWorkbook(wb, embedded);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('فشل قراءة الملف'));
    reader.readAsArrayBuffer(file);
  });
}

/** لاستخدامه عند التحميل من fetch (مثلاً من /inventory.xlsx) مع استخراج الصور المضمنة */
export async function parseFromArrayBuffer(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  const wb = XLSX.read(data, { type: 'array' });
  const embedded = await extractEmbeddedImages(arrayBuffer);
  return parseWorkbook(wb, embedded);
}
