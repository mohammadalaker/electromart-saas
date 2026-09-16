import { PRODUCTS_TABLE, PRODUCTS_STOCK_COLUMN } from '../lib/supabaseClient';
import { insertInventoryLog } from '../lib/inventoryLogs';

const CONTACTS_TABLE = 'store_contacts';
const SALES_TABLE = 'sales';
const PURCHASES_TABLE = 'store_purchases';
const CUSTOMER_LEDGER_TABLE = 'customer_ledger';
const PRODUCT_UNITS_TABLE = 'product_units';

/**
 * البحث عن صنف أو وحدة بالباركود المطابق تماماً (للسكانر أو الضغط على Enter)
 */
export async function lookupProductOrUnitByBarcode(barcode, storeId, supabase) {
  const raw = String(barcode || '').trim();
  if (!raw || !storeId) return null;

  const selProd = `id, eng_name, barcode, reference, full_price, price_after_disc, purchase_price, ${PRODUCTS_STOCK_COLUMN}`;

  try {
    // 1. فحص جدول products بالباركود
    const { data: pData, error: pErr } = await supabase
      .from(PRODUCTS_TABLE)
      .select(selProd)
      .eq('store_id', storeId)
      .eq('barcode', raw)
      .maybeSingle();

    if (pErr) {
      console.error('[lookupProductOrUnitByBarcode] products error:', pErr);
    } else if (pData) {
      return {
        id: pData.id,
        productId: pData.id,
        name: pData.eng_name || 'صنف',
        barcode: pData.barcode || raw,
        reference: pData.reference || '',
        unit: 'قطعة',
        conversionFactor: 1,
        price: Number(pData.price_after_disc ?? pData.full_price ?? 0),
        costPrice: Number(pData.purchase_price ?? pData.full_price ?? 0),
        stockCount: Number(pData[PRODUCTS_STOCK_COLUMN] ?? 0),
      };
    }

    // 2. فحص جدول product_units بالباركود
    const selPU = `id, unit_name, conversion_factor, barcode, sale_price, product_id, product:products(${selProd})`;
    const { data: uData, error: uErr } = await supabase
      .from(PRODUCT_UNITS_TABLE)
      .select(selPU)
      .eq('store_id', storeId)
      .eq('barcode', raw)
      .maybeSingle();

    if (uErr) {
      console.error('[lookupProductOrUnitByBarcode] product_units error:', uErr);
    } else if (uData && uData.product) {
      const parent = uData.product;
      const factor = Number(uData.conversion_factor) || 1;
      return {
        id: parent.id,
        productId: parent.id,
        unitId: uData.id,
        name: `${parent.eng_name || 'صنف'} (${uData.unit_name})`,
        barcode: uData.barcode || parent.barcode || raw,
        reference: parent.reference || '',
        unit: uData.unit_name,
        conversionFactor: factor,
        price: Number(uData.sale_price ?? (Number(parent.price_after_disc ?? parent.full_price ?? 0) * factor)),
        costPrice: Number((parent.purchase_price ?? parent.full_price ?? 0) * factor),
        stockCount: Number(parent[PRODUCTS_STOCK_COLUMN] ?? 0),
      };
    }

    return null;
  } catch (err) {
    console.error('[lookupProductOrUnitByBarcode] exception:', err);
    return null;
  }
}

/**
 * دالة مساعدة للبحث السريع عن المنتجات ووحداتها الإضافية (بالاسم أو الباركود)
 */
export async function searchProductsAndUnits(storeId, term, supabase) {
  const q = String(term || '').trim();
  if (!storeId || q.length < 1) return [];

  const pattern = `%${q}%`;
  const selProd = `id, eng_name, barcode, reference, full_price, price_after_disc, purchase_price, ${PRODUCTS_STOCK_COLUMN}`;

  try {
    const [rProducts, rUnits] = await Promise.all([
      supabase
        .from(PRODUCTS_TABLE)
        .select(selProd)
        .eq('store_id', storeId)
        .or(`eng_name.ilike.${pattern},barcode.ilike.${pattern},reference.ilike.${pattern}`)
        .limit(15),
      supabase
        .from(PRODUCT_UNITS_TABLE)
        .select(`
          id,
          unit_name,
          conversion_factor,
          barcode,
          sale_price,
          product_id,
          product:products(${selProd})
        `)
        .eq('store_id', storeId)
        .or(`unit_name.ilike.${pattern},barcode.ilike.${pattern}`)
        .limit(10)
        .then((res) => {
          if (res.error) console.warn('[searchProductsAndUnits] product_units warning:', res.error);
          return res;
        })
        .catch(() => ({ data: [] })),
    ]);

    if (rProducts.error) {
      console.error('[searchProductsAndUnits] products query error:', rProducts.error);
    }

    const map = new Map();
    (rProducts.data || []).forEach((p) => {
      if (p?.id) {
        map.set(String(p.id), {
          id: p.id,
          productId: p.id,
          name: p.eng_name || 'بدون اسم',
          barcode: p.barcode || '',
          reference: p.reference || '',
          unit: 'قطعة',
          conversionFactor: 1,
          price: Number(p.price_after_disc ?? p.full_price ?? 0),
          costPrice: Number(p.purchase_price ?? p.full_price ?? 0),
          stockCount: Number(p[PRODUCTS_STOCK_COLUMN] ?? 0),
        });
      }
    });

    (rUnits?.data || []).forEach((u) => {
      const parent = u.product;
      if (parent?.id) {
        const factor = Number(u.conversion_factor) || 1;
        const uKey = `u_${u.id}`;
        map.set(uKey, {
          id: parent.id,
          productId: parent.id,
          unitId: u.id,
          name: `${parent.eng_name || 'صنف'} (${u.unit_name})`,
          barcode: u.barcode || parent.barcode || '',
          reference: parent.reference || '',
          unit: u.unit_name,
          conversionFactor: factor,
          price: Number(u.sale_price ?? (Number(parent.price_after_disc ?? parent.full_price ?? 0) * factor)),
          costPrice: Number((parent.purchase_price ?? parent.full_price ?? 0) * factor),
          stockCount: Number(parent[PRODUCTS_STOCK_COLUMN] ?? 0),
        });
      }
    });

    return Array.from(map.values()).slice(0, 20);
  } catch (err) {
    console.error('[searchProductsAndUnits] exception:', err);
    return [];
  }
}

/**
 * حساب فروقات الكميات بين الأسطر القديمة والأسطر الجديدة لكل صنف بالوحدة الأساسية
 */
export function calculateStockDeltas(oldLines = [], newLines = []) {
  const map = new Map();

  // تجميع الأسطر القديمة
  for (const line of oldLines) {
    const pid = line.product_id || line.productId;
    if (!pid) continue;
    const factor = Number(line.conversion_factor || line.conversionFactor || 1);
    const baseQty = (Number(line.qty ?? line.quantity ?? 0) || 0) * factor;

    if (!map.has(pid)) {
      map.set(pid, {
        productId: pid,
        name: line.name || line.item_name || line.product_name || '',
        barcode: line.barcode || '',
        oldBaseQty: 0,
        newBaseQty: 0,
        factor,
      });
    }
    const item = map.get(pid);
    item.oldBaseQty += baseQty;
    if (!item.name && line.name) item.name = line.name;
    if (!item.barcode && line.barcode) item.barcode = line.barcode;
  }

  // تجميع الأسطر الجديدة
  for (const line of newLines) {
    const pid = line.product_id || line.productId;
    if (!pid) continue;
    const factor = Number(line.conversion_factor || line.conversionFactor || 1);
    const baseQty = (Number(line.qty ?? line.quantity ?? 0) || 0) * factor;

    if (!map.has(pid)) {
      map.set(pid, {
        productId: pid,
        name: line.name || line.item_name || line.product_name || '',
        barcode: line.barcode || '',
        oldBaseQty: 0,
        newBaseQty: 0,
        factor,
      });
    }
    const item = map.get(pid);
    item.newBaseQty += baseQty;
    if (!item.name && line.name) item.name = line.name;
    if (!item.barcode && line.barcode) item.barcode = line.barcode;
  }

  const result = [];
  map.forEach((val) => {
    const delta = Math.round((val.newBaseQty - val.oldBaseQty) * 1000) / 1000;
    result.push({
      ...val,
      delta, // موجب = زيادة بالكمية المطلوبة، سالب = إنقاص
    });
  });

  return result;
}

/**
 * فحص ما إذا كان التعديل سيتسبب برصيد سالب بالمخزن
 * invoiceType: 'sale' | 'purchase'
 */
export async function checkNegativeStockIssues(storeId, deltas, invoiceType, supabase) {
  if (!storeId || !deltas?.length) return [];

  // الأصناف التي تحتاج خصم من المخزون:
  // في فاتورة البيع: delta > 0 (الزبون اشترى زيادة) -> يخصم من المخزون بمقدار delta
  // في فاتورة الشراء: delta < 0 (أنقصنا بضاعة المشتريات) -> يخصم من المخزون بمقدار |delta|
  const itemsToCheck = deltas.filter((d) => {
    if (invoiceType === 'sale') return d.delta > 0;
    if (invoiceType === 'purchase') return d.delta < 0;
    return false;
  });

  if (itemsToCheck.length === 0) return [];

  const pids = itemsToCheck.map((it) => it.productId);
  try {
    const { data: prodRows, error } = await supabase
      .from(PRODUCTS_TABLE)
      .select(`id, name, eng_name, barcode, ${PRODUCTS_STOCK_COLUMN}`)
      .eq('store_id', storeId)
      .in('id', pids);

    if (error) throw error;

    const prodMap = new Map();
    (prodRows || []).forEach((p) => prodMap.set(String(p.id), p));

    const negativeIssues = [];
    for (const it of itemsToCheck) {
      const p = prodMap.get(String(it.productId));
      const currentStock = Number(p?.[PRODUCTS_STOCK_COLUMN] ?? 0);
      const neededDeduction =
        invoiceType === 'sale' ? it.delta : Math.abs(it.delta);

      const projectedStock = currentStock - neededDeduction;
      if (projectedStock < 0) {
        negativeIssues.push({
          productId: it.productId,
          name: it.name || p?.name || p?.eng_name || 'صنف',
          barcode: it.barcode || p?.barcode || '',
          currentStock,
          neededDelta: neededDeduction,
          projectedStock,
        });
      }
    }

    return negativeIssues;
  } catch (err) {
    console.warn('[checkNegativeStockIssues] error:', err);
    return [];
  }
}

/**
 * تطبيق تحديثات المخزون لصنف واحد مع معالجة RPC والـ Fallback
 */
async function adjustProductStock({ storeId, productId, deltaQty, reason, productName, barcode, supabase }) {
  if (!productId || deltaQty === 0) return;

  const isIncrement = deltaQty > 0;
  const absQty = Math.abs(deltaQty);

  // جلب المخزون السابق للتوثيق
  let prevStock = 0;
  try {
    const { data: pData } = await supabase
      .from(PRODUCTS_TABLE)
      .select(PRODUCTS_STOCK_COLUMN)
      .eq('id', productId)
      .eq('store_id', storeId)
      .maybeSingle();
    prevStock = Number(pData?.[PRODUCTS_STOCK_COLUMN] ?? 0);
  } catch {
    // continue
  }

  let newStock = prevStock + deltaQty;

  const rpcName = isIncrement ? 'increment_stock' : 'decrement_stock';
  const { error: rpcErr } = await supabase.rpc(rpcName, {
    row_id: productId,
    amount: absQty,
  });

  if (rpcErr) {
    console.warn(`[adjustProductStock] RPC ${rpcName} failed, fallback to direct update:`, rpcErr);
    // تحديث مباشر
    newStock = Math.max(-999999, prevStock + deltaQty);
    await supabase
      .from(PRODUCTS_TABLE)
      .update({ [PRODUCTS_STOCK_COLUMN]: newStock })
      .eq('id', productId)
      .eq('store_id', storeId);
  }

  // توثيق في inventory_logs
  try {
    await insertInventoryLog({
      storeId,
      productId,
      barcode: barcode || null,
      productName: productName || 'صنف معدل',
      qtyBefore: prevStock,
      qtyAfter: newStock,
      reason,
    });
  } catch {
    // inventory_logs اختياري
  }
}

/**
 * تنفيذ تعديل فاتورة مبيعات (sales)
 */
export async function executeSaleInvoiceEdit({
  storeId,
  saleId,
  oldSale,
  newLines,
  newTotal,
  supabase,
}) {
  const oldLines = oldSale.line_items || [];
  const deltas = calculateStockDeltas(oldLines, newLines);

  let netStockImpact = 0;

  // 1. تحديث المخزون لكل صنف:
  // في البيع: delta موجب (طلب أكثر) -> إنقاص المخزون بمقدار delta (deltaQty = -delta)
  // delta سالب (أرجع كمية) -> زيادة المخزون بمقدار |delta| (deltaQty = +|delta|)
  for (const d of deltas) {
    if (d.delta !== 0) {
      const stockChange = -d.delta;
      netStockImpact += stockChange;
      await adjustProductStock({
        storeId,
        productId: d.productId,
        deltaQty: stockChange,
        reason: 'sale_edit',
        productName: d.name,
        barcode: d.barcode,
        supabase,
      });
    }
  }

  // 2. تحديث الرصيد والذمة
  const oldTotal = Number(oldSale.total_amount ?? 0);
  const diffTotal = Math.round((newTotal - oldTotal) * 100) / 100;
  const isCredit =
    oldSale.payment_mode === 'credit' ||
    oldSale.payment_method === 'deferred' ||
    Boolean(oldSale.contact_id);

  if (isCredit && oldSale.contact_id && diffTotal !== 0) {
    try {
      const { data: contactRow } = await supabase
        .from(CONTACTS_TABLE)
        .select('outstanding_amount, balance')
        .eq('id', oldSale.contact_id)
        .eq('store_id', storeId)
        .maybeSingle();

      const curDebt = Number(contactRow?.outstanding_amount ?? 0);
      const curBal = Number(contactRow?.balance ?? 0);
      const nextDebt = Math.max(0, Math.round((curDebt + diffTotal) * 100) / 100);
      const nextBal = Math.round((curBal + diffTotal) * 100) / 100;

      await supabase
        .from(CONTACTS_TABLE)
        .update({
          outstanding_amount: nextDebt,
          balance: nextBal,
          debt_amount: nextDebt,
        })
        .eq('id', oldSale.contact_id)
        .eq('store_id', storeId);
    } catch (cErr) {
      console.warn('[executeSaleInvoiceEdit] update contact error:', cErr);
    }

    // تحديث أو إدراج في customer_ledger إن وُجد
    try {
      const { data: ledgerRow } = await supabase
        .from(CUSTOMER_LEDGER_TABLE)
        .select('id')
        .eq('sale_id', saleId)
        .eq('store_id', storeId)
        .maybeSingle();

      if (ledgerRow?.id) {
        await supabase
          .from(CUSTOMER_LEDGER_TABLE)
          .update({ debit: newTotal })
          .eq('id', ledgerRow.id);
      } else {
        await supabase.from(CUSTOMER_LEDGER_TABLE).insert([
          {
            store_id: storeId,
            customer_id: oldSale.contact_id,
            sale_id: saleId,
            debit: newTotal,
            credit: 0,
            description: `فاتورة مبيعات معدّلة #${saleId.slice(0, 8)}`,
          },
        ]);
      }
    } catch {
      // ledger اختياري
    }
  }

  // 3. تجهيز أسطر الفاتورة النظيفة للتخزين
  const cleanLineItems = newLines.map((l) => ({
    product_id: l.product_id || l.productId || null,
    barcode: String(l.barcode || ''),
    name: l.name || l.item_name || '',
    unit: l.unit || 'قطعة',
    conversion_factor: Number(l.conversion_factor || l.conversionFactor || 1),
    qty: Number(l.qty ?? l.quantity ?? 1),
    unit_price: Number(l.unit_price ?? l.unitPrice ?? 0),
    discount: Number(l.discount || 0),
    line_total: Number(l.line_total ?? l.lineTotal ?? 0),
  }));

  const nowStamp = new Date().toLocaleString('ar-EG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const updatedNotes = (oldSale.notes ? oldSale.notes + '\n' : '') +
    `[تم تعديل الفاتورة في ${nowStamp} — الفرق المالي: ₪${diffTotal.toFixed(2)}]`;

  // 4. تحديث سجل الفاتورة في جدول sales
  let updatePayload = {
    line_items: cleanLineItems,
    total_amount: newTotal,
    notes: updatedNotes,
    edited_at: new Date().toISOString(),
  };

  let { error: updateErr } = await supabase
    .from(SALES_TABLE)
    .update(updatePayload)
    .eq('id', saleId)
    .eq('store_id', storeId);

  if (updateErr && /edited_at/i.test(updateErr.message || '')) {
    delete updatePayload.edited_at;
    const { error: retryErr } = await supabase
      .from(SALES_TABLE)
      .update(updatePayload)
      .eq('id', saleId)
      .eq('store_id', storeId);
    if (retryErr) throw retryErr;
  } else if (updateErr) {
    throw updateErr;
  }

  return {
    deltas,
    totalStockDiff: netStockImpact, // التغير الكلي في المخزون
    debtDiff: diffTotal, // التغير في الرصيد
  };
}

/**
 * تنفيذ تعديل فاتورة مشتريات (store_purchases)
 */
export async function executePurchaseInvoiceEdit({
  storeId,
  purchaseId,
  oldPurchase,
  newLines,
  newTotal,
  supabase,
}) {
  const oldLines = oldPurchase.line_items || [];
  const deltas = calculateStockDeltas(oldLines, newLines);

  let netStockImpact = 0;

  // 1. تحديث المخزون لكل صنف:
  // في المشتريات: delta موجب (اشترينا أكثر) -> زيادة المخزون بمقدار delta (deltaQty = +delta)
  // delta سالب (أنقصنا مشتريات) -> إنقاص المخزون بمقدار |delta| (deltaQty = -|delta|)
  for (const d of deltas) {
    if (d.delta !== 0) {
      const stockChange = d.delta;
      netStockImpact += stockChange;
      await adjustProductStock({
        storeId,
        productId: d.productId,
        deltaQty: stockChange,
        reason: 'purchase_edit',
        productName: d.name,
        barcode: d.barcode,
        supabase,
      });
    }
  }

  // 2. تحديث رصيد ذمة المورد
  const oldTotal = Number(oldPurchase.total_amount ?? 0);
  const diffTotal = Math.round((newTotal - oldTotal) * 100) / 100;
  const isCredit =
    oldPurchase.payment_mode === 'credit' ||
    Boolean(oldPurchase.supplier_contact_id);

  if (isCredit && oldPurchase.supplier_contact_id && diffTotal !== 0) {
    try {
      const { data: contactRow } = await supabase
        .from(CONTACTS_TABLE)
        .select('outstanding_amount')
        .eq('id', oldPurchase.supplier_contact_id)
        .eq('store_id', storeId)
        .maybeSingle();

      const curDebt = Number(contactRow?.outstanding_amount ?? 0);
      const nextDebt = Math.max(0, Math.round((curDebt + diffTotal) * 100) / 100);

      await supabase
        .from(CONTACTS_TABLE)
        .update({ outstanding_amount: nextDebt })
        .eq('id', oldPurchase.supplier_contact_id)
        .eq('store_id', storeId);
    } catch (cErr) {
      console.warn('[executePurchaseInvoiceEdit] update supplier contact error:', cErr);
    }
  }

  // 3. تجهيز أسطر الفاتورة للتخزين
  const cleanLineItems = newLines.map((l) => ({
    product_id: l.product_id || l.productId || null,
    barcode: String(l.barcode || ''),
    reference: String(l.reference || ''),
    name: l.name || l.item_name || '',
    unit: l.unit || 'قطعة',
    conversion_factor: Number(l.conversion_factor || l.conversionFactor || 1),
    qty: Number(l.qty ?? l.quantity ?? 1),
    unit_price: Number(l.unit_price ?? l.unitPrice ?? 0),
    discount_percent: Number(l.discount_percent || 0),
    line_total: Number(l.line_total ?? l.lineTotal ?? 0),
  }));

  const nowStamp = new Date().toLocaleString('ar-EG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const updatedNotes = (oldPurchase.notes ? oldPurchase.notes + '\n' : '') +
    `[تم تعديل الفاتورة في ${nowStamp} — الفرق المالي: ₪${diffTotal.toFixed(2)}]`;

  // 4. تحديث سجل الفاتورة في جدول store_purchases
  let updatePayload = {
    line_items: cleanLineItems,
    total_amount: newTotal,
    notes: updatedNotes,
    edited_at: new Date().toISOString(),
  };

  let { error: updateErr } = await supabase
    .from(PURCHASES_TABLE)
    .update(updatePayload)
    .eq('id', purchaseId)
    .eq('store_id', storeId);

  if (updateErr && /edited_at/i.test(updateErr.message || '')) {
    delete updatePayload.edited_at;
    const { error: retryErr } = await supabase
      .from(PURCHASES_TABLE)
      .update(updatePayload)
      .eq('id', purchaseId)
      .eq('store_id', storeId);
    if (retryErr) throw retryErr;
  } else if (updateErr) {
    throw updateErr;
  }

  return {
    deltas,
    totalStockDiff: netStockImpact, // التغير الكلي في المخزون
    debtDiff: diffTotal, // التغير في الرصيد
  };
}
