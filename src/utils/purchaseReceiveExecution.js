/**
 * تطبيق استلام المشتريات على المخزن والتكلفة والسجلات — يُستدعى بعد إدراج الفاتورة أو عند تأكيد مسودة.
 *
 * ذمة المورد: إما المحفّز trg_store_purchases_credit_update_contact_debt (عند INSERT) أو الزيادة من الواجهة.
 * إن نفّذت المحفّز في Supabase، ضع VITE_SKIP_CLIENT_CREDIT_DEBT=true لتجنّب الازدواجية.
 */
import { supabase, PRODUCTS_TABLE, PRODUCTS_STOCK_COLUMN } from '../lib/supabaseClient';
import { insertInventoryLog } from '../lib/inventoryLogs';
import { normalizeDigitsToLatin } from './normalizeDigits';
import { roundMoney } from './productModel';
import { applyCashPurchaseFromFund, revertCashPurchaseFromFund } from './saleAccounting';
import { syncShopLocationsForProductIds } from './storeLocations';
import { stockQtyFromLine } from './purchaseLinePayloads';

const PRODUCT_SERIALS_TABLE = 'product_serials';
const CONTACTS_TABLE = 'store_contacts';
const SKIP_CLIENT_CREDIT_DEBT = import.meta.env.VITE_SKIP_CLIENT_CREDIT_DEBT === 'true';

function parseSerialList(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(/[\n,;،]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function readProductStock(row) {
  if (!row) return 0;
  const v = row[PRODUCTS_STOCK_COLUMN];
  return Math.max(0, Number(v ?? 0));
}

async function buildPurchaseInventorySnapshots(lines, storeId) {
  const stockByProduct = new Map();
  const snapshots = [];
  for (const row of lines) {
    const qty = stockQtyFromLine(row);
    if (!row.productId || qty <= 0) continue;
    let before = stockByProduct.get(row.productId);
    let pr = null;
    if (before === undefined) {
      const { data: prData } = await supabase
        .from(PRODUCTS_TABLE)
        .select(`${PRODUCTS_STOCK_COLUMN}, eng_name, barcode`)
        .eq('id', row.productId)
        .eq('store_id', storeId)
        .maybeSingle();
      pr = prData;
      before = readProductStock(pr);
      stockByProduct.set(row.productId, before);
    }
    const after = before + qty;
    stockByProduct.set(row.productId, after);
    const nameFromRow = row.productName && String(row.productName).trim();
    snapshots.push({
      productId: row.productId,
      barcode: row.barcode?.trim() || (pr?.barcode != null ? String(pr.barcode) : null),
      productName: nameFromRow || (pr?.eng_name ? String(pr.eng_name).trim() : null),
      qtyBefore: before,
      qtyAfter: after,
    });
  }
  return snapshots;
}

async function applyReceiveIncrementOnly(lines, storeId) {
  const applied = [];
  try {
    for (const row of lines) {
      if (!row.productId) continue;
      const qty = stockQtyFromLine(row);
      if (qty <= 0) continue;
      const pid = row.productId;
      const { error: rpcErr } = await supabase.rpc('increment_stock', {
        row_id: pid,
        amount: qty,
      });
      if (rpcErr) {
        const { data: pr } = await supabase
          .from(PRODUCTS_TABLE)
          .select(PRODUCTS_STOCK_COLUMN)
          .eq('id', pid)
          .eq('store_id', storeId)
          .maybeSingle();
        const next = readProductStock(pr) + qty;
        const { error: u2 } = await supabase
          .from(PRODUCTS_TABLE)
          .update({ [PRODUCTS_STOCK_COLUMN]: next })
          .eq('id', pid)
          .eq('store_id', storeId);
        if (u2) throw u2;
      }
      applied.push({ id: pid, qty });
    }
  } catch (e) {
    for (const { id, qty } of applied.slice().reverse()) {
      const { error: d1 } = await supabase.rpc('decrement_stock', { row_id: id, amount: qty });
      if (d1) {
        const { data: pr } = await supabase
          .from(PRODUCTS_TABLE)
          .select(PRODUCTS_STOCK_COLUMN)
          .eq('id', id)
          .eq('store_id', storeId)
          .maybeSingle();
        const next = Math.max(0, readProductStock(pr) - qty);
        await supabase
          .from(PRODUCTS_TABLE)
          .update({ [PRODUCTS_STOCK_COLUMN]: next })
          .eq('id', id)
          .eq('store_id', storeId);
      }
    }
    throw e;
  }
}

function effectiveUnitCost(row) {
  const up = Math.max(0, parseFloat(String(row.unit_price).replace(',', '.')) || 0);
  const d = Math.min(100, Math.max(0, parseFloat(String(row.discount_percent).replace(',', '.')) || 0));
  return Math.round(up * (1 - d / 100) * 100) / 100;
}

async function applyWeightedAverageBatch(lines, linePayloads, storeId) {
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i];
    const p = linePayloads[i];
    if (!row.productId) continue;
    const qty = stockQtyFromLine(row);
    if (qty <= 0) continue;
    const base = effectiveUnitCost(row);
    const unitExtra = Number(p.landed_unit_extra || 0);
    const unitCost = Math.round((base + unitExtra) * 1000000) / 1000000;
    items.push({ product_id: row.productId, qty, unit_cost: unitCost });
  }
  if (items.length === 0) return;
  const { error: batchErr } = await supabase.rpc('apply_purchase_receive_batch', {
    p_store_id: storeId,
    p_lines: items,
  });
  if (!batchErr) return;
  for (const it of items) {
    const { error: oneErr } = await supabase.rpc('apply_purchase_receive_wac', {
      p_product_id: it.product_id,
      p_store_id: storeId,
      p_qty: it.qty,
      p_unit_cost: it.unit_cost,
    });
    if (oneErr) {
      const { data: pr } = await supabase
        .from(PRODUCTS_TABLE)
        .select(`${PRODUCTS_STOCK_COLUMN}, full_price`)
        .eq('id', it.product_id)
        .eq('store_id', storeId)
        .maybeSingle();
      const sb = readProductStock(pr);
      const cb = Number(pr?.full_price ?? 0);
      const total = sb + it.qty;
      const newAvg = total > 0 ? (sb * cb + it.qty * it.unit_cost) / total : it.unit_cost;
      const { error: u2 } = await supabase
        .from(PRODUCTS_TABLE)
        .update({
          [PRODUCTS_STOCK_COLUMN]: total,
          full_price: Math.round(newAvg * 100) / 100,
        })
        .eq('id', it.product_id)
        .eq('store_id', storeId);
      if (u2) throw u2;
    }
  }
}

async function insertPurchaseSerials(lines, purchaseId, storeId, companyName, invoiceDateVal) {
  if (!storeId || !purchaseId) return;
  const rows = [];
  for (const row of lines) {
    if (!row.productId) continue;
    const serials = parseSerialList(row.serialInput);
    for (const sn of serials) {
      if (!sn) continue;
      rows.push({
        store_id: storeId,
        product_id: row.productId,
        serial: sn.slice(0, 120),
        purchase_id: purchaseId,
        supplier_name: companyName.slice(0, 200),
        invoice_date: invoiceDateVal || null,
      });
    }
  }
  if (rows.length === 0) return;
  const { error } = await supabase.from(PRODUCT_SERIALS_TABLE).insert(rows);
  if (error) console.warn('product_serials', error);
}

async function incrementSupplierDebtForCredit(storeId, contactId, amount) {
  if (!storeId || !contactId || amount <= 0) return;
  const { data: row, error: selErr } = await supabase
    .from(CONTACTS_TABLE)
    .select('outstanding_amount')
    .eq('id', contactId)
    .eq('store_id', storeId)
    .maybeSingle();
  if (selErr) throw selErr;
  const next = Math.max(0, Number(row?.outstanding_amount ?? 0)) + amount;
  const { error: upErr } = await supabase
    .from(CONTACTS_TABLE)
    .update({ outstanding_amount: next, payment_type: 'credit' })
    .eq('id', contactId)
    .eq('store_id', storeId);
  if (upErr) throw upErr;
}

/**
 * @param {object} p
 * @param {string} p.storeId
 * @param {string} p.purchaseId
 * @param {Array} p.lines — صفوف واجهة (بعد dbLineItemsToReceiveRows أو من النموذج)
 * @param {Array} p.linePayloads — من computePurchaseLinePayloads
 * @param {boolean} p.updateCatalogCosts
 * @param {string} p.companyName
 * @param {string} p.invoiceDateVal
 * @param {'cash'|'credit'} p.paymentMode
 * @param {string|null} p.supplierContactId
 * @param {number} p.grandTotal — لزيادة ذمة المورد عند الآجل
 */
export async function executePurchaseReceiveEffects({
  storeId,
  purchaseId,
  lines,
  linePayloads,
  updateCatalogCosts,
  companyName,
  invoiceDateVal,
  paymentMode,
  supplierContactId,
  grandTotal,
}) {
  const purchaseSnapshots = await buildPurchaseInventorySnapshots(lines, storeId);

  const total = roundMoney(Number(grandTotal ?? 0));
  let cashPurchaseApplied = false;

  try {
    if (paymentMode === 'cash' && total > 0) {
      await applyCashPurchaseFromFund(supabase, {
        storeId,
        purchaseId,
        totalAmount: total,
        sourceLabel: 'استلام مخزن',
      });
      cashPurchaseApplied = true;
    }

    if (updateCatalogCosts) {
      await applyWeightedAverageBatch(lines, linePayloads, storeId);
    } else {
      await applyReceiveIncrementOnly(lines, storeId);
    }
  } catch (stockErr) {
    if (cashPurchaseApplied) {
      try {
        await revertCashPurchaseFromFund(supabase, {
          storeId,
          purchaseId,
          totalAmount: total,
          sourceLabel: 'تراجع بعد فشل المخزن',
        });
      } catch (revErr) {
        console.error('[purchase] تراجع صندوق الكاش:', revErr);
      }
    }
    throw new Error(
      stockErr.message?.includes('increment_stock') ||
        stockErr.message?.includes('apply_purchase') ||
        stockErr.code === '42883'
        ? 'تعذّر تحديث المخزن — تحقق من دوال increment_stock و apply_purchase_receive في قاعدة البيانات'
        : stockErr.message || 'تعذّر زيادة كميات المخزن'
    );
  }

  for (const snap of purchaseSnapshots) {
    await insertInventoryLog({
      storeId,
      productId: snap.productId,
      barcode: snap.barcode,
      productName: snap.productName,
      qtyBefore: snap.qtyBefore,
      qtyAfter: snap.qtyAfter,
      reason: 'purchase',
    });
  }

  await syncShopLocationsForProductIds(
    storeId,
    purchaseSnapshots.map((s) => s.productId)
  );

  await insertPurchaseSerials(
    lines,
    purchaseId,
    storeId,
    String(companyName || ''),
    invoiceDateVal
  );

  if (paymentMode === 'credit' && supplierContactId && !SKIP_CLIENT_CREDIT_DEBT) {
    await incrementSupplierDebtForCredit(storeId, supplierContactId, grandTotal);
  }
}

/** عند تأكيد مسودة آجل: ربط المورد وزيادة الذمة بدون تكرار إن وُجد محفّز */
export async function upsertSupplierForCreditDraft(phoneNorm, companyName, storeId) {
  const { data: list, error: listErr } = await supabase
    .from(CONTACTS_TABLE)
    .select('id, phone, outstanding_amount, name')
    .eq('store_id', storeId)
    .eq('role', 'supplier');
  if (listErr) throw listErr;

  const match = (list || []).find(
    (r) => normalizeDigitsToLatin(String(r.phone || '').trim()) === phoneNorm
  );

  if (match) {
    const { error: upErr } = await supabase
      .from(CONTACTS_TABLE)
      .update({
        payment_type: 'credit',
        name: companyName.trim() || match.name,
      })
      .eq('id', match.id)
      .eq('store_id', storeId);
    if (upErr) throw upErr;
    return { contactId: match.id };
  }

  const { data: inserted, error: insErr } = await supabase
    .from(CONTACTS_TABLE)
    .insert([
      {
        store_id: storeId,
        role: 'supplier',
        name: companyName.trim() || 'مورد',
        phone: phoneNorm,
        email: '',
        address: '',
        notes: '',
        payment_type: 'credit',
        outstanding_amount: 0,
      },
    ])
    .select('id')
    .single();
  if (insErr) throw insErr;
  return { contactId: inserted?.id ?? null };
}
