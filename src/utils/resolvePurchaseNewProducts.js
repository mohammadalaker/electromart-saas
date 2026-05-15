/**
 * قبل حفظ فاتورة المشتريات: إنشاء منتجات جديدة للأسطر المربوطة بكمية وسعر دون productId.
 * إن وُجد باركود يُتحقق من عدم تكراره؛ إن وُجد تكرار يُرمى خطأ يطلب الربط من البحث.
 * إن كان الباركود فارغاً يُولَّد باركود رقمي داخلي فريد للمتجر.
 */
import { PRODUCTS_TABLE } from '../lib/supabaseClient';
import { normalizeDigitsToLatin } from './normalizeDigits';
import { stockQtyFromLine, effectiveUnitCostFromRow } from './purchaseLinePayloads';

function randomDigits(n) {
  let s = '';
  for (let i = 0; i < n; i += 1) s += Math.floor(Math.random() * 10);
  return s;
}

export async function allocateUniqueProductBarcode(supabase, storeId, maxAttempts = 30) {
  for (let a = 0; a < maxAttempts; a += 1) {
    const candidate = `8${randomDigits(11)}`;
    const { data } = await supabase
      .from(PRODUCTS_TABLE)
      .select('id')
      .eq('store_id', storeId)
      .eq('barcode', candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  throw new Error('تعذّر توليد باركود فريد — أعد المحاولة.');
}

/** @param {object} supabase — عميل Supabase */
export async function resolvePurchaseLinesNewProducts(supabase, storeId, lines) {
  const out = [];
  for (const row of lines) {
    if (row.productId) {
      out.push(row);
      continue;
    }
    const qty = stockQtyFromLine(row);
    const unitPrice = Math.max(0, parseFloat(String(row.unit_price).replace(',', '.')) || 0);
    if (qty <= 0 || unitPrice < 0) {
      out.push(row);
      continue;
    }

    let bc = normalizeDigitsToLatin(String(row.barcode || '').trim());
    if (bc) {
      const { data: exists, error: exErr } = await supabase
        .from(PRODUCTS_TABLE)
        .select('id, eng_name')
        .eq('store_id', storeId)
        .eq('barcode', bc)
        .maybeSingle();
      if (exErr) throw exErr;
      if (exists) {
        const nm = String(exists.eng_name || '—').trim() || '—';
        throw new Error(
          `الباركود ${bc} مسجّل مسبقاً للصنف «${nm}». ابحث عنه في السطر واربطه من القائمة بدلاً من إنشاء صنف جديد.`
        );
      }
    } else {
      bc = await allocateUniqueProductBarcode(supabase, storeId);
    }

    const refRaw = String(row.reference || '').trim();
    const nameRaw = String(row.productName || '').trim();
    const title = (refRaw || nameRaw || `صنف ${bc}`).slice(0, 200);
    const cost = effectiveUnitCostFromRow(row);
    const refDb = normalizeDigitsToLatin(refRaw) || null;

    const payload = {
      store_id: storeId,
      barcode: bc,
      reference: refDb,
      eng_name: title,
      brand_group: null,
      product_type: null,
      full_price: cost,
      price_after_disc: cost,
      stock_count: 0,
      warranty_months: null,
      image_url: null,
    };

    const { data: inserted, error: insErr } = await supabase
      .from(PRODUCTS_TABLE)
      .insert([payload])
      .select('id, barcode, reference, eng_name, full_price, price_after_disc, brand_group')
      .single();
    if (insErr) throw insErr;

    const p = inserted;
    const fp = Number(p.full_price) || 0;
    const pad = Number(p.price_after_disc);
    out.push({
      ...row,
      productId: p.id,
      barcode: String(p.barcode || bc),
      reference: String(p.reference ?? refRaw ?? '').trim() || refRaw,
      productName: String(p.eng_name ?? title).slice(0, 80),
      sellPrice: pad > 0 ? pad : fp,
      stockFullPrice: fp,
      brandGroup: String(p.brand_group ?? '').trim().slice(0, 80),
    });
  }
  return out;
}

/**
 * إنشاء صنف جديد من واجهة «منتج جديد» في فاتورة المشتريات.
 * @returns {Promise<object>} صف المنتج بعد الإدراج (للربط في السطر)
 */
export async function insertNewProductForPurchase(supabase, storeId, fields) {
  const nameRaw = String(fields.engName || '').trim();
  if (!nameRaw) throw new Error('أدخل اسم المنتج.');

  const up = Math.max(0, parseFloat(String(fields.unitPrice || '').replace(',', '.')) || 0);
  const d = Math.min(
    100,
    Math.max(0, parseFloat(String(fields.discountPercent ?? '0').replace(',', '.')) || 0)
  );
  const cost = Math.round(up * (1 - d / 100) * 100) / 100;

  let bc = normalizeDigitsToLatin(String(fields.barcode || '').trim());
  if (bc) {
    const { data: exists, error: exErr } = await supabase
      .from(PRODUCTS_TABLE)
      .select('id, eng_name')
      .eq('store_id', storeId)
      .eq('barcode', bc)
      .maybeSingle();
    if (exErr) throw exErr;
    if (exists) {
      const nm = String(exists.eng_name || '—').trim() || '—';
      throw new Error(`الباركود ${bc} مسجّل للصنف «${nm}» — ابحث عنه واربطه من الجدول.`);
    }
  } else {
    bc = await allocateUniqueProductBarcode(supabase, storeId);
  }

  const refRaw = String(fields.reference || '').trim();
  const refDb = normalizeDigitsToLatin(refRaw) || null;
  const title = nameRaw.slice(0, 200);

  const payload = {
    store_id: storeId,
    barcode: bc,
    reference: refDb,
    eng_name: title,
    brand_group: null,
    product_type: null,
    full_price: cost,
    price_after_disc: cost,
    stock_count: 0,
    warranty_months: null,
    image_url: null,
  };

  const { data: inserted, error: insErr } = await supabase
    .from(PRODUCTS_TABLE)
    .insert([payload])
    .select('id, barcode, reference, eng_name, full_price, price_after_disc, brand_group')
    .single();
  if (insErr) throw insErr;
  return inserted;
}
