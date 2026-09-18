const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

// تحميل إعدادات البيئة من .env
const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = envContent.split('\n').reduce((acc, line) => {
  const [k, ...v] = line.split('=');
  if (k && v.length) acc[k.trim()] = v.join('=').trim();
  return acc;
}, {});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;
const STORE_ID = process.argv[2] || 'd3acecd5-7908-40c4-89b2-54308ba14529';
const BATCH_SIZE = 500;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

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

async function main() {
  console.log('====================================================');
  console.log('STARTING DIRECT INVENTORY WIPE & IMPORT');
  console.log('Store ID:', STORE_ID);
  console.log('Supabase URL:', supabaseUrl);
  console.log('====================================================');

  // 1. فحص المخزون الحالي
  const { count: beforeCount, error: countErr } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', STORE_ID);

  if (countErr) {
    console.error('Error counting products before wipe:', countErr);
    process.exit(1);
  }
  console.log(`Current products in store: ${beforeCount}`);

  // 2. مسح وحدات الأصناف التابعة للمتجر
  console.log('1/4: Deleting product_units for store...');
  try {
    const { error: puErr } = await supabase.from('product_units').delete().eq('store_id', STORE_ID);
    if (puErr) console.warn('Warning deleting product_units:', puErr.message);
    else console.log('Successfully cleared product_units.');
  } catch (e) {
    console.warn('Exception deleting product_units:', e.message);
  }

  // 3. مسح جميع أصناف المتجر من جدول products على دفعات لتجنب statement timeout وطول الرابط
  console.log('2/4: Deleting ALL products for store in chunks...');
  let totalDeleted = 0;
  while (true) {
    const { data: rows, error: fetchErr } = await supabase
      .from('products')
      .select('id')
      .eq('store_id', STORE_ID)
      .limit(100);

    if (fetchErr) {
      console.error('Error fetching chunk for deletion:', fetchErr);
      process.exit(1);
    }
    if (!rows || rows.length === 0) break;

    const ids = rows.map((r) => r.id);
    const { error: chunkDelErr } = await supabase
      .from('products')
      .delete()
      .in('id', ids);

    if (chunkDelErr) {
      console.error('Error deleting chunk:', chunkDelErr);
      process.exit(1);
    }

    totalDeleted += ids.length;
    if (totalDeleted % 1000 === 0 || ids.length < 100) {
      console.log(`Deleted ${totalDeleted} products so far...`);
    }
  }

  // التأكد من أن الحذف تم بنجاح
  const { count: checkCount } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', STORE_ID);
  console.log(`Products remaining after wipe: ${checkCount ?? 0} (should be 0)`);

  // 4. قراءة ملف الإكسل
  const excelPath = 'c:/Users/User/Desktop/كشف ارصدة المخزون.xls';
  console.log('3/4: Reading Excel file:', excelPath);

  if (!fs.existsSync(excelPath)) {
    console.error('Excel file not found at:', excelPath);
    process.exit(1);
  }

  const wb = XLSX.readFile(excelPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawGrid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  console.log(`Total rows in Excel sheet: ${rawGrid.length}`);

  // البحث التلقائي عن صف العناوين
  let headerIndex = -1;
  for (let i = 0; i < Math.min(10, rawGrid.length); i++) {
    const r = rawGrid[i];
    if (!Array.isArray(r)) continue;
    const isHeader = r.some((c) => {
      const s = String(c || '').trim();
      return s.includes('اسم الصنف') || s.includes('رصيد الصنف') || s.includes('باركود') || s.includes('سعر البيع') || s.includes('سعر التكلفة');
    });
    if (isHeader) {
      headerIndex = i;
      break;
    }
  }

  let colIdxName = 0;
  let colIdxStock = 1;
  let colIdxUnit = 2;
  let colIdxSalePrice = 3;
  let colIdxTotal = 4;
  let colIdxCostPrice = 5;
  let colIdxBarcode = 6;

  if (headerIndex >= 0) {
    const headerRow = rawGrid[headerIndex];
    headerRow.forEach((val, idx) => {
      const s = String(val || '').trim();
      if (s.includes('رصيد') || s.includes('كمية') || s.toLowerCase().includes('stock') || s.toLowerCase().includes('qty')) {
        colIdxStock = idx;
      } else if (s.includes('اسم') || s.toLowerCase() === 'name' || s.toLowerCase().includes('title')) {
        colIdxName = idx;
      } else if (s.includes('وحدة') || s.includes('الوحدة') || s.toLowerCase().includes('unit')) {
        colIdxUnit = idx;
      } else if (s.includes('سعر البيع') || s.includes('سعر بيع') || s.includes('معدل السعر') || s.toLowerCase().includes('sale')) {
        colIdxSalePrice = idx;
      } else if (s.includes('اجمالي') || s.includes('الإجمالي') || s.toLowerCase().includes('total')) {
        colIdxTotal = idx;
      } else if (s.includes('تكلفة') || s.includes('التكلفة') || s.includes('سعر شراء') || s.includes('سعر الشراء') || s.toLowerCase().includes('cost')) {
        colIdxCostPrice = idx;
      } else if (s.includes('باركود') || s.toLowerCase().includes('barcode')) {
        colIdxBarcode = idx;
      }
    });
  }

  const startRowIndex = headerIndex >= 0 ? headerIndex + 1 : 1;
  const dataRows = rawGrid.slice(startRowIndex);

  console.log(`Parsed column mapping:
  - Name: col ${colIdxName}
  - Stock: col ${colIdxStock}
  - Unit: col ${colIdxUnit}
  - Sale Price: col ${colIdxSalePrice}
  - Total: col ${colIdxTotal}
  - Cost Price: col ${colIdxCostPrice}
  - Barcode: col ${colIdxBarcode}`);

  const items = [];
  const barcodeMap = new Map();

  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    if (!Array.isArray(row)) continue;

    const name = String(row[colIdxName] ?? '').trim();
    const barcode = parseBarcodeSafe(row[colIdxBarcode]);

    // تجنب تكرار سطر العناوين
    if (
      name === 'اسم الصنف' ||
      barcode === 'باركود' ||
      String(row[colIdxSalePrice] || '').includes('سعر') ||
      String(row[colIdxCostPrice] || '').includes('تكلفة')
    ) {
      continue;
    }

    const stockCount = Math.round(parseNumSafe(row[colIdxStock]));
    const salePrice = parseNumSafe(row[colIdxSalePrice]);
    const purchasePrice = parseNumSafe(row[colIdxCostPrice]);

    if (!name && !barcode && stockCount === 0 && purchasePrice === 0 && salePrice === 0) {
      continue;
    }

    const record = {
      eng_name: name || 'صنف بدون اسم',
      barcode: barcode || null,
      stock_count: stockCount,
      purchase_price: purchasePrice,
      last_purchase_price: purchasePrice,
      avg_purchase_price: purchasePrice,
      full_price: salePrice,
      price_after_disc: salePrice,
      store_id: STORE_ID,
    };

    // معالجة تكرار الباركود: الاحتفاظ بآخر سجل للباركود نفسه
    if (barcode) {
      if (barcodeMap.has(barcode)) {
        const oldIndex = barcodeMap.get(barcode);
        items[oldIndex] = record;
      } else {
        barcodeMap.set(barcode, items.length);
        items.push(record);
      }
    } else {
      items.push(record);
    }
  }

  const total = items.length;
  console.log(`Ready to insert ${total} unique items into products table.`);

  // 5. إدخال السجلات على دفعات بحجم 500
  console.log('4/4: Batch inserting products...');
  let successCount = 0;
  let failedCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(total / BATCH_SIZE);

    try {
      let { error } = await supabase.from('products').insert(batch);

      if (error) {
        console.error(`Batch ${batchNum}/${totalBatches} error on insert, trying upsert:`, error.message);
        const upRes = await supabase.from('products').upsert(batch, { onConflict: 'store_id,barcode' });
        error = upRes.error;
      }

      if (error) {
        console.error(`Batch ${batchNum}/${totalBatches} FAILED:`, error.message);
        failedCount += batch.length;
      } else {
        successCount += batch.length;
        const percent = Math.round(((i + batch.length) / total) * 100);
        console.log(`Batch ${batchNum}/${totalBatches} (${batch.length} items) succeeded. Total: ${successCount}/${total} (${percent}%)`);
      }
    } catch (err) {
      console.error(`Batch ${batchNum}/${totalBatches} EXCEPTION:`, err.message);
      failedCount += batch.length;
    }
  }

  // 6. التحقق النهائي من قاعدة البيانات
  const { count: finalCount } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', STORE_ID);

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('====================================================');
  console.log(`IMPORT COMPLETE in ${elapsedSec}s!`);
  console.log(`Successfully imported: ${successCount}`);
  console.log(`Failed: ${failedCount}`);
  console.log(`Final verified count in DB: ${finalCount} items`);
  console.log('====================================================');

  // 7. نسخ وتحديث ملف الإكسل في public و dist حتى تتطابق المعاينة والتحميل الفوري
  try {
    XLSX.writeFile(wb, path.resolve(__dirname, '../public/كشف ارصدة المخزون.xlsx'));
    if (fs.existsSync(path.resolve(__dirname, '../dist'))) {
      XLSX.writeFile(wb, path.resolve(__dirname, '../dist/كشف ارصدة المخزون.xlsx'));
    }
    console.log('Updated public/كشف ارصدة المخزون.xlsx with the new file structure.');
  } catch (e) {
    console.warn('Could not update public xlsx file:', e.message);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
