/**
 * نسخ صور مجلد Electric إلى public/electric وبناء خريطة باركود → رابط الصورة.
 * التشغيل من جذر المشروع المعزول: node scripts/syncElectric.cjs
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const defaultElectricSource = path.join(projectRoot, 'Electric');
const fromEnv = process.env.ELECTRIC_SOURCE_DIR;
const ELECTRIC_SOURCE = fromEnv
  ? (path.isAbsolute(fromEnv) ? fromEnv : path.resolve(projectRoot, fromEnv))
  : defaultElectricSource;
const PUBLIC_ELECTRIC = path.join(__dirname, '..', 'public', 'electric');
const OUT_JSON = path.join(__dirname, '..', 'src', 'data', 'electricByBarcode.json');

const IMG_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

function normalizeBarcode(s) {
  return String(s ?? '').replace(/\D/g, '');
}

function runSyncElectric() {
  if (!fs.existsSync(ELECTRIC_SOURCE)) {
    console.warn('مجلد Electric غير موجود:', ELECTRIC_SOURCE);
    fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
    fs.writeFileSync(OUT_JSON, JSON.stringify({}, null, 2), 'utf8');
    console.log('تم كتابة', OUT_JSON, '(فارغ)');
    return {};
  }

  fs.mkdirSync(PUBLIC_ELECTRIC, { recursive: true });
  const names = fs.readdirSync(ELECTRIC_SOURCE);
  const barcodeToUrl = {};

  for (const name of names) {
    const full = path.join(ELECTRIC_SOURCE, name);
    if (!fs.statSync(full).isFile()) continue;
    const ext = path.extname(name).toLowerCase();
    if (!IMG_EXT.includes(ext)) continue;
    const barcodeRaw = path.basename(name, ext);
    const barcodeNorm = normalizeBarcode(barcodeRaw) || barcodeRaw;
    if (!barcodeNorm) continue;
    const dest = path.join(PUBLIC_ELECTRIC, name);
    if (!fs.existsSync(dest) || fs.statSync(full).mtimeMs > fs.statSync(dest).mtimeMs) {
      fs.copyFileSync(full, dest);
    }
    const url = `/electric/${name}`;
    barcodeToUrl[barcodeNorm] = url;
    if (barcodeRaw !== barcodeNorm) barcodeToUrl[barcodeRaw] = url;
    if (barcodeRaw.replace(/\s/g, '') !== barcodeNorm) barcodeToUrl[barcodeRaw.replace(/\s/g, '')] = url;
  }

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(barcodeToUrl, null, 2), 'utf8');
  console.log('Electric: تم نسخ', Object.keys(barcodeToUrl).length, 'صورة حسب الباركود → public/electric و', OUT_JSON);
  return barcodeToUrl;
}

if (require.main === module) {
  runSyncElectric();
}

module.exports = { runSyncElectric };
