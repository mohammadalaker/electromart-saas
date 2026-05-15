const XLSX = require('xlsx');
const JSZip = require('jszip');
const path = require('path');
const fs = require('fs');

const NAME_KEYS = ['Eng-Name', 'Eng Name', 'الوصف', 'Description', 'Name', 'Item', 'اسم القطعة'];
const QTY_KEYS = ['Qty', 'Quantity', 'الكمية', 'Count'];
const PRICE_KEYS = ['Price', 'price', 'السعر', 'Unit Price', 'Cost'];
const PRICE_AFTER_DISCOUNT_KEYS = ['Price after dic', 'price after dic', 'Price after discount', 'price after discount', 'السعر بعد الخصم', 'سعر بعد الخصم', 'بعد الخصم', 'السعر النهائي', 'Net price'];
const GROUP_KEYS = ['group', 'Group', 'المجموعة', 'الفئة', 'Category', 'صنف', 'ماركة', 'Brand', 'الصنف'];
const BARCODE_KEYS = ['Barcode', 'barcode', 'باركود', 'الباركود', 'Barcode number', 'رمز الباركود', 'Code', 'كود'];
const BOX_KEYS = ['Box', 'box', 'صندوق', 'الصندوق', 'الخانة', 'خانة', 'مربع', 'المربع', 'ص.'];
const STOCK_KEYS = ['Stock', 'stock', 'المخزون', 'الكمية المخزنة', 'Inventory', 'Qty stock'];
const DISCOUNT_AMOUNT_KEYS = ['مبلغ الخصم', 'مبلغ خصم', 'Discount amount', 'discount amount', 'Discount', 'discount', 'الخصم', 'خصم', 'Discount value'];
/** عمود اختياري في ورقة المنتجات — يُخزَّن في JSON كـ productType (مثل tv, fridge) */
const PRODUCT_TYPE_COL_KEYS = [
  'product_type',
  'Product type',
  'نوع الجهاز',
  'نوع المنتج',
  'مفتاح النوع',
  'نوع',
  'النوع',
];
/** ورقة «جدول الأصناف» — لا تُعامل كصفوف منتجات */
const CATEGORY_SHEET_NAMES = new Set([
  'categories',
  'Categories',
  'CATEGORY',
  'category',
  'أصناف',
  'الأصناف',
  'التصنيفات',
  'تصنيفات',
]);
const CATEGORY_NAME_KEYS = ['name', 'Name', 'الاسم', 'اسم الصنف', 'التصنيف', 'المجموعة', 'الصنف', 'الوصف'];
const CATEGORY_SLUG_KEYS = ['slug', 'Slug', 'مفتاح', 'معرف', 'كود الصنف', 'رمز'];
const CATEGORY_TYPE_KEYS = [
  'product_type',
  'Product type',
  'نوع الجهاز',
  'نوع المنتج',
  'مفتاح النوع',
  'نوع',
];

const KNOWN_PRODUCT_TYPE_SLUGS = new Set(['tv', 'fridge', 'washer', 'dryer', 'dishwasher', 'oven']);
const AR_LABEL_TO_PRODUCT_SLUG = {
  تلفزيونات: 'tv',
  تليفزيونات: 'tv',
  ثلاجات: 'fridge',
  غسالات: 'washer',
  نشافات: 'dryer',
  جلايات: 'dishwasher',
  'أفران + ميكروويف بلت إن': 'oven',
  أفران: 'oven',
  ميكروويف: 'oven',
};

function normKey(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeProductTypeSlug(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (KNOWN_PRODUCT_TYPE_SLUGS.has(low)) return low;
  if (AR_LABEL_TO_PRODUCT_SLUG[s]) return AR_LABEL_TO_PRODUCT_SLUG[s];
  for (const [ar, slug] of Object.entries(AR_LABEL_TO_PRODUCT_SLUG)) {
    if (normKey(ar) === normKey(s)) return slug;
  }
  if (/^[a-z][a-z0-9_-]{0,30}$/i.test(s)) return low;
  return null;
}

function isCategorySheetName(sheetName) {
  const n = String(sheetName ?? '').trim();
  if (CATEGORY_SHEET_NAMES.has(n)) return true;
  if (/^أصناف/i.test(n)) return true;
  if (/^تصنيف/i.test(n)) return true;
  return false;
}

function pickXlsxFromDir(dataImportDir) {
  if (!fs.existsSync(dataImportDir)) return null;
  const files = fs
    .readdirSync(dataImportDir)
    .filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$'));
  if (!files.length) return null;
  const dataNamed = files.find((f) => /^data\.xlsx$/i.test(f));
  if (dataNamed) return path.join(dataImportDir, dataNamed);
  if (files.length === 1) return path.join(dataImportDir, files[0]);
  files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  console.warn(
    'Several .xlsx in',
    dataImportDir,
    '— using:',
    files[0],
    '(use data.xlsx to force)'
  );
  return path.join(dataImportDir, files[0]);
}

function resolveExcelPath(projectRoot) {
  const projectRootNorm = path.resolve(projectRoot);
  const isInsideProject = (targetPath) => {
    const resolved = path.resolve(targetPath);
    return resolved === projectRootNorm || resolved.startsWith(projectRootNorm + path.sep);
  };

  const fromEnv = process.env.EXCEL_IMPORT_PATH;
  if (fromEnv) {
    const p = path.isAbsolute(fromEnv) ? fromEnv : path.resolve(projectRoot, fromEnv);
    if (!fs.existsSync(p)) {
      console.error('EXCEL_IMPORT_PATH not found:', p);
      process.exit(1);
    }
    if (!isInsideProject(p) && process.env.ALLOW_EXTERNAL_IMPORT !== '1') {
      console.error('EXCEL_IMPORT_PATH must be inside this isolated project:');
      console.error(' ', projectRootNorm);
      console.error('Set ALLOW_EXTERNAL_IMPORT=1 only if you intentionally want external import.');
      process.exit(1);
    }
    return p;
  }

  const searchDirs = [
    path.join(projectRoot, 'data-import'),
  ];
  const tried = new Set();
  for (const dir of searchDirs) {
    const norm = path.normalize(dir);
    if (tried.has(norm)) continue;
    tried.add(norm);
    const found = pickXlsxFromDir(norm);
    if (found) {
      return found;
    }
  }

  console.error('No Excel file found inside this isolated project.\n');
  console.error('  1) Save your file in:', path.join(projectRoot, 'data-import', 'data.xlsx'));
  console.error('  2) Or run: EXCEL_IMPORT_PATH="data-import/your-file.xlsx" npm run update-products');
  console.error('  3) External path is blocked by default (set ALLOW_EXTERNAL_IMPORT=1 to override).');
  process.exit(1);
}

function findCol(row, keys) {
  if (!row || !Array.isArray(row)) return -1;
  const low = (v) => String(v ?? '').toLowerCase().trim();
  for (let i = 0; i < row.length; i++) {
    const c = low(row[i]);
    if (
      keys.some(
        (k) =>
          c === k.toLowerCase() ||
          (k.split(/[\s/]+/)[0] && c.includes(k.toLowerCase().split(/[\s/]+/)[0]))
      )
    )
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

function sanitizeBarcode(s) {
  return String(s ?? '')
    .replace(/[^0-9A-Za-z_-]/g, '')
    .slice(0, 48);
}

function loadElectricByBarcode() {
  const jsonPath = path.join(__dirname, '..', 'src', 'data', 'electricByBarcode.json');
  if (!fs.existsSync(jsonPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    console.warn('Could not load electricByBarcode.json:', e.message);
    return {};
  }
}

function normalizeBarcode(s) {
  return String(s ?? '').replace(/\D/g, '');
}

async function extractImages(buf, outDir, barcodesByRowIndex) {
  const images = [];
  const barcodeToUrl = {};
  const used = new Set();
  try {
    const zip = await JSZip.loadAsync(buf);
    const xl = zip.folder('xl');
    if (!xl) return { urls: images, barcodeToUrl };
    const media = xl.folder('media');
    if (!media) return { urls: images, barcodeToUrl };
    const names = [];
    media.forEach((p, file) => {
      if (!file.dir) names.push(p);
    });
    names.sort((a, b) => String(a).localeCompare(b, undefined, { numeric: true }));
    fs.mkdirSync(outDir, { recursive: true });
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const ext = path.extname(name) || '.png';
      const barcode = barcodesByRowIndex && barcodesByRowIndex[i] ? toStr(barcodesByRowIndex[i]) : '';
      const sb = sanitizeBarcode(barcode);
      let outName;
      if (sb && barcode) {
        if (used.has(sb + ext)) {
          outName = `image${i + 1}${ext}`;
        } else {
          used.add(sb + ext);
          outName = sb + ext;
          barcodeToUrl[barcode] = `/inventory-images/${outName}`;
        }
      } else {
        outName = `image${i + 1}${ext}`;
      }
      const outPath = path.join(outDir, outName);
      const blob = await media.file(name).async('nodebuffer');
      fs.writeFileSync(outPath, blob);
      images.push(`/inventory-images/${outName}`);
    }
  } catch (e) {
    console.warn('Could not extract images:', e.message);
  }
  return { urls: images, barcodeToUrl };
}

function parseCategorySheet(sheetName, data) {
  if (!data || data.length < 2) return [];
  const header = data[0];
  const nameIdx = findCol(header, CATEGORY_NAME_KEYS);
  const slugIdx = findCol(header, CATEGORY_SLUG_KEYS);
  const typeIdx = findCol(header, CATEGORY_TYPE_KEYS);
  if (nameIdx < 0) return [];

  const out = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const name = toStr(row[nameIdx]);
    if (!name) continue;
    const slugRaw = slugIdx >= 0 ? toStr(row[slugIdx]) : '';
    const typeRaw = typeIdx >= 0 ? toStr(row[typeIdx]) : '';
    out.push({
      name,
      slug: slugRaw || name,
      productType: normalizeProductTypeSlug(typeRaw),
      sheet: sheetName,
    });
  }
  return out;
}

function buildCategoryLookup(categories) {
  const map = new Map();
  for (const c of categories) {
    if (c.name) map.set(normKey(c.name), c);
    if (c.slug) map.set(normKey(c.slug), c);
  }
  return map;
}

function parseSheetRows(sheetName, data) {
  if (!data || data.length < 2) return { rows: [], barcodes: [] };
  const header = data[0];
  const nameIdx = findCol(header, NAME_KEYS);
  const qtyIdx = findCol(header, QTY_KEYS);
  const priceIdx = findCol(header, PRICE_KEYS);
  const groupIdx = findCol(header, GROUP_KEYS);
  const barcodeIdx = findCol(header, BARCODE_KEYS);
  let boxIdx = findCol(header, BOX_KEYS);
  if (boxIdx < 0 && header.length > 5) boxIdx = 5;
  const priceAfterFromHeader = findCol(header, PRICE_AFTER_DISCOUNT_KEYS);
  const priceAfterDiscountIdx = priceAfterFromHeader >= 0 ? priceAfterFromHeader : 6;
  const stockFromHeader = findCol(header, STOCK_KEYS);
  const stockIdx = stockFromHeader >= 0 ? stockFromHeader : 9;
  const discountAmountIdx = findCol(header, DISCOUNT_AMOUNT_KEYS);
  const productTypeIdx = findCol(header, PRODUCT_TYPE_COL_KEYS);

  const rows = [];
  const barcodes = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const name = nameIdx >= 0 ? toStr(row[nameIdx]) : toStr(row[0]);
    const qty = qtyIdx >= 0 ? toNum(row[qtyIdx]) : toNum(row[1]);
    const price = priceIdx >= 0 ? toNum(row[priceIdx]) : toNum(row[2]);
    if (!name && qty === 0 && price === 0) continue;
    const barcode = barcodeIdx >= 0 ? toStr(row[barcodeIdx]) : '';
    barcodes.push(barcode);
    let priceAfterDiscount = priceAfterDiscountIdx >= 0 ? toNum(row[priceAfterDiscountIdx]) : null;
    if (discountAmountIdx >= 0) {
      const discountAmount = toNum(row[discountAmountIdx]);
      if (discountAmount > 0 && price > 0) {
        const fromDiscount = Math.max(0, price - discountAmount);
        priceAfterDiscount =
          priceAfterDiscount != null && priceAfterDiscount > 0 ? priceAfterDiscount : fromDiscount;
      }
    }
    const productTypeRaw = productTypeIdx >= 0 ? toStr(row[productTypeIdx]) : '';
    rows.push({
      sheetName,
      name,
      qty,
      price,
      priceAfterDiscount,
      group: groupIdx >= 0 ? toStr(row[groupIdx]) || '—' : '—',
      barcode,
      boxRaw: boxIdx >= 0 ? row[boxIdx] : '',
      stock: stockIdx >= 0 ? toNum(row[stockIdx]) : null,
      productTypeRaw,
    });
  }
  return { rows, barcodes };
}

async function main() {
  const runSyncElectric = require('./syncElectric.cjs').runSyncElectric;
  runSyncElectric();

  const projectRoot = path.join(__dirname, '..');
  const excelPath = resolveExcelPath(projectRoot);
  console.log('Using Excel:', excelPath);

  const buf = fs.readFileSync(excelPath);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheetNames = wb.SheetNames || [];
  if (!sheetNames.length) {
    console.error('No sheets in workbook');
    process.exit(1);
  }

  const allRows = [];
  const barcodesByRowIndex = [];
  let categories = [];

  for (const sheetName of sheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (isCategorySheetName(sheetName)) {
      const catRows = parseCategorySheet(sheetName, data);
      if (catRows.length) {
        categories = categories.concat(catRows);
        console.log('Category sheet', JSON.stringify(sheetName), '→', catRows.length, 'row(s)');
      }
      continue;
    }

    const { rows, barcodes } = parseSheetRows(sheetName, data);
    for (let i = 0; i < rows.length; i++) {
      allRows.push(rows[i]);
      barcodesByRowIndex.push(barcodes[i]);
    }
  }

  const categoryLookup = buildCategoryLookup(categories);

  const imagesDir = path.join(__dirname, '..', 'public', 'inventory-images');
  const { urls: imageUrls, barcodeToUrl } = await extractImages(buf, imagesDir, barcodesByRowIndex);
  const byBarcodeCount = Object.keys(barcodeToUrl).length;
  console.log(
    'Extracted',
    imageUrls.length,
    'images;',
    byBarcodeCount,
    'linked by barcode from Excel → public/inventory-images/'
  );
  console.log('Sheets in file:', sheetNames.join(', '));

  const electricByBarcode = loadElectricByBarcode();
  const electricCount = Object.keys(electricByBarcode).length;
  if (electricCount > 0)
    console.log(
      'Loaded',
      electricCount,
      'image(s) from Electric (electricByBarcode.json) — الصور حسب الباركود من Electric لها الأولوية.'
    );

  const items = [];
  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    const boxRaw = row.boxRaw;
    const box =
      boxRaw !== undefined && boxRaw !== null && String(boxRaw).trim() !== ''
        ? String(boxRaw).trim()
        : null;
    const excelImage =
      row.barcode && barcodeToUrl[row.barcode] ? barcodeToUrl[row.barcode] : imageUrls[i] || null;
    const bcNorm = row.barcode ? normalizeBarcode(row.barcode) : '';
    const electricImage =
      (row.barcode && electricByBarcode[row.barcode]) || (bcNorm && electricByBarcode[bcNorm]) || null;
    const imageUrl = electricImage || excelImage;
    const pad = row.priceAfterDiscount != null && row.priceAfterDiscount > 0 ? Math.round(row.priceAfterDiscount) : null;

    let productType = normalizeProductTypeSlug(row.productTypeRaw);
    if (!productType && row.group && row.group !== '—') {
      const cat = categoryLookup.get(normKey(row.group));
      if (cat?.productType) productType = cat.productType;
    }

    items.push({
      id: i + 1,
      name: row.name || '—',
      group: row.group,
      box,
      price: Math.max(0, row.price),
      priceAfterDiscount: pad,
      qty: Math.max(0, row.qty),
      stock: row.stock != null && row.stock > 0 ? Math.round(row.stock) : null,
      status: row.qty <= 2 ? 'Low Stock' : row.qty <= 5 ? 'Good' : 'Excellent',
      image: imageUrl,
      barcode: row.barcode || null,
      sheet: row.sheetName,
      productType,
    });
  }

  const dataDir = path.join(__dirname, '..', 'src', 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const outPath = path.join(dataDir, 'inventoryFromExcel.json');
  fs.writeFileSync(outPath, JSON.stringify(items, null, 2), 'utf8');
  console.log('Written', items.length, 'products to', outPath);

  const categoriesPath = path.join(dataDir, 'categoriesFromExcel.json');
  fs.writeFileSync(categoriesPath, JSON.stringify(categories, null, 2), 'utf8');
  console.log('Written', categories.length, 'category row(s) to', categoriesPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
