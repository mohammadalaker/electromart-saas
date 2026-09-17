const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const SUPABASE_URL = 'https://mjiucapmxwkscsqfgcvx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qaXVjYXBteHdrc2NzcWZnY3Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxOTk1NTEsImV4cCI6MjA5MDc3NTU1MX0.8FjHgYsSx375Gc7AMGHcBofc_dp3gh45MI4XFLaFzVY';
const STORE_ID = process.argv[2] || 'd3acecd5-7908-40c4-89b2-54308ba14529'; // سوبر ماركت مرمش
const PROFIT_MARGIN = 20; // 20%
const BATCH_SIZE = 500;

function parseBarcodeSafe(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number') {
    return Number.isInteger(val) ? String(val) : String(Math.round(val));
  }
  let s = String(val).trim();
  if (!s) return null;
  if (/^[0-9.]+[eE][+-]?[0-9]+$/.test(s)) {
    try {
      const num = Number(s);
      if (!Number.isNaN(num)) {
        return BigInt(Math.round(num)).toString();
      }
    } catch {}
  }
  return s;
}

function parseNumSafe(val) {
  if (val == null || val === '') return 0;
  const s = String(val).replace(/,/g, '').trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function calculateSalePrice(costPrice, marginPercent) {
  const cost = Math.max(0, Number(costPrice) || 0);
  const margin = Number(marginPercent) || 0;
  const price = cost * (1 + margin / 100);
  return Math.round(price * 100) / 100;
}

async function runImport() {
  const filePath = path.resolve(__dirname, '../كشف ارصدة المخزون.xlsx');
  console.log('Reading file:', filePath);

  if (!fs.existsSync(filePath)) {
    throw new Error('File not found: ' + filePath);
  }

  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawGrid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  console.log('Total raw rows in worksheet:', rawGrid.length);

  // البحث التلقائي عن صف العناوين
  let headerIndex = -1;
  for (let i = 0; i < Math.min(10, rawGrid.length); i++) {
    const r = rawGrid[i];
    if (!Array.isArray(r)) continue;
    const isHeader = r.some((c) => {
      const s = String(c || '').trim();
      return s.includes('اسم الصنف') || s.includes('رصيد الصنف') || s.includes('باركود') || s.includes('سعر شراء');
    });
    if (isHeader) {
      headerIndex = i;
      break;
    }
  }

  const startRowIndex = headerIndex >= 0 ? headerIndex + 1 : 1;
  const dataRows = rawGrid.slice(startRowIndex);
  console.log(`Header found at row ${headerIndex}. Parsing data rows starting from row ${startRowIndex}...`);

  const items = [];
  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    if (!Array.isArray(row)) continue;

    const name = String(row[0] ?? '').trim();
    const barcode = parseBarcodeSafe(row[6]);

    if (name === 'اسم الصنف' || barcode === 'باركود') continue;

    // تحويل رصيد المخزون لعدد صحيح ليتوافق مع عمود integer في قاعدة البيانات
    const stockCount = Math.round(parseNumSafe(row[1]));
    const avgPrice = parseNumSafe(row[3]);
    const purchasePrice = parseNumSafe(row[5]);

    if (!name && !barcode && stockCount === 0 && purchasePrice === 0) {
      continue;
    }

    const salePrice = calculateSalePrice(purchasePrice, PROFIT_MARGIN);

    items.push({
      eng_name: name || 'صنف بدون اسم',
      barcode: barcode || null,
      stock_count: stockCount,
      purchase_price: purchasePrice,
      last_purchase_price: purchasePrice,
      avg_purchase_price: avgPrice || purchasePrice,
      full_price: salePrice,
      price_after_disc: salePrice,
      store_id: STORE_ID,
    });
  }

  const total = items.length;
  console.log(`Ready to import/upsert ${total} items in batches of ${BATCH_SIZE} with ${PROFIT_MARGIN}% profit margin.`);

  let successCount = 0;
  let failedCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batchSlice = items.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(total / BATCH_SIZE);

    // إلغاء تكرار الباركود داخل نفس الدفعة لتفادي خطأ ON CONFLICT في PostgreSQL
    const seenBarcodes = new Set();
    const batch = [];
    for (let j = batchSlice.length - 1; j >= 0; j--) {
      const it = batchSlice[j];
      if (it.barcode) {
        if (seenBarcodes.has(it.barcode)) continue;
        seenBarcodes.add(it.barcode);
      }
      batch.unshift(it);
    }

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/products?on_conflict=store_id,barcode`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Batch ${batchNum}/${totalBatches} FAILED (HTTP ${res.status}):`, errText);
        failedCount += batch.length;
      } else {
        successCount += batch.length;
        const percent = Math.round(((i + batch.length) / total) * 100);
        console.log(`Batch ${batchNum}/${totalBatches} (${batch.length} items) succeeded. Total processed: ${successCount}/${total} (${percent}%)`);
      }
    } catch (err) {
      console.error(`Batch ${batchNum}/${totalBatches} EXCEPTION:`, err.message);
      failedCount += batch.length;
    }
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('====================================================');
  console.log(`IMPORT COMPLETE in ${elapsedSec}s!`);
  console.log(`Successfully processed: ${successCount}`);
  console.log(`Failed: ${failedCount}`);
  console.log('====================================================');
}

runImport().catch((err) => {
  console.error('Fatal import error:', err);
  process.exit(1);
});
