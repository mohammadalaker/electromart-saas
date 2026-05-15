/**
 * إرجاع فاتورة مبيعات كاملة: مخزن + كاش أو ذمة
 */
import { PRODUCTS_TABLE, PRODUCTS_STOCK_COLUMN } from '../lib/supabaseClient';
import { insertInventoryLog } from '../lib/inventoryLogs';
import { isUuid, roundMoney } from './productModel';
import { applyCashSaleReturnFromFund, applyCreditSaleReturn } from './saleAccounting';

export function parseSaleLineItems(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function resolveSaleLines(supabase, saleId, lineItemsColumn) {
  const fromCol = parseSaleLineItems(lineItemsColumn);
  if (fromCol.length) return fromCol;
  const { data, error } = await supabase
    .from('sales_items')
    .select('product_id, barcode, qty, unit_price')
    .eq('sale_id', saleId);
  if (error) {
    const msg = String(error.message || '');
    if (/does not exist|schema cache|PGRST205|42P01/i.test(msg)) return [];
    throw error;
  }
  return data || [];
}

function qtyInt(line) {
  const q = Math.round(Number(line.qty) || 0);
  return Math.max(0, q);
}

/**
 * يزيد المخزن لسطر واحد ويُرجع دالة تراجع. يرمي عند الفشل.
 */
async function restockOneLine(supabase, storeId, line) {
  const qty = qtyInt(line);
  if (qty <= 0) return null;

  const uuidFromProduct = line.product_id && isUuid(line.product_id) ? String(line.product_id) : null;
  const barcodeOnly = !uuidFromProduct && line.barcode != null ? String(line.barcode).trim() : '';

  if (uuidFromProduct) {
    const rowPk = uuidFromProduct;
    const { data: row0, error: sel0 } = await supabase
      .from(PRODUCTS_TABLE)
      .select(PRODUCTS_STOCK_COLUMN)
      .eq('id', rowPk)
      .single();
    if (sel0) throw sel0;
    const prevStock = Number(row0?.[PRODUCTS_STOCK_COLUMN] ?? row0?.stock_count ?? 0);

    const { error: rpcError } = await supabase.rpc('increment_stock', {
      row_id: rowPk,
      amount: qty,
    });
    if (rpcError) {
      const newStock = Math.max(0, prevStock + qty);
      const { error: upErr } = await supabase
        .from(PRODUCTS_TABLE)
        .update({ [PRODUCTS_STOCK_COLUMN]: newStock })
        .eq('id', rowPk);
      if (upErr) throw upErr;
    }

    const newStock = roundMoney(prevStock + qty);
    await insertInventoryLog({
      storeId,
      productId: rowPk,
      barcode: line.barcode != null ? String(line.barcode) : null,
      productName: 'مرتجع فاتورة',
      qtyBefore: prevStock,
      qtyAfter: newStock,
      reason: 'other',
    });

    return async () => {
      const { error: dErr } = await supabase.rpc('decrement_stock', {
        row_id: rowPk,
        amount: qty,
      });
      if (dErr) {
        const { data: r } = await supabase
          .from(PRODUCTS_TABLE)
          .select(PRODUCTS_STOCK_COLUMN)
          .eq('id', rowPk)
          .single();
        const cur = Number(r?.[PRODUCTS_STOCK_COLUMN] ?? 0);
        await supabase
          .from(PRODUCTS_TABLE)
          .update({ [PRODUCTS_STOCK_COLUMN]: Math.max(0, cur - qty) })
          .eq('id', rowPk);
      }
    };
  }

  if (!barcodeOnly) {
    throw new Error('سطر فاتورة بلا منتج ولا باركود — تعذّر إرجاع المخزن.');
  }

  const b = barcodeOnly;
  const { data: row, error: selErr } = await supabase
    .from(PRODUCTS_TABLE)
    .select(PRODUCTS_STOCK_COLUMN)
    .eq('barcode', b)
    .eq('store_id', storeId)
    .single();
  if (selErr) throw selErr;
  const prevStock = Number(row?.[PRODUCTS_STOCK_COLUMN] ?? 0);
  const newStock = Math.max(0, prevStock + qty);
  const { error: upErr } = await supabase
    .from(PRODUCTS_TABLE)
    .update({ [PRODUCTS_STOCK_COLUMN]: newStock })
    .eq('barcode', b)
    .eq('store_id', storeId);
  if (upErr) throw upErr;

  await insertInventoryLog({
    storeId,
    productId: null,
    barcode: b,
    productName: 'مرتجع فاتورة',
    qtyBefore: prevStock,
    qtyAfter: newStock,
    reason: 'other',
  });

  return async () => {
    await supabase
      .from(PRODUCTS_TABLE)
      .update({ [PRODUCTS_STOCK_COLUMN]: prevStock })
      .eq('barcode', b)
      .eq('store_id', storeId);
  };
}

async function unclaimReturn(supabase, saleId, storeId) {
  await supabase
    .from('sales')
    .update({ returned_at: null, return_note: null })
    .eq('id', saleId)
    .eq('store_id', storeId);
}

/**
 * إرجاع كامل: يحجز الفاتورة أولاً (returned_at) ثم المخزن ثم المالية.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} saleRow — صف من sales يتضمن id, store_id, line_items, total_amount, payment_mode, contact_id
 * @param {{ storeId: string, returnNote?: string }} opts
 */
export async function processFullSaleReturn(supabase, saleRow, { storeId, returnNote = '' }) {
  const saleId = saleRow.id;
  if (!saleId || !storeId) throw new Error('بيانات الفاتورة غير كافية.');

  if (saleRow.returned_at) {
    throw new Error('هذه الفاتورة مُرجَعة مسبقاً.');
  }

  const lines = await resolveSaleLines(supabase, saleId, saleRow.line_items);
  if (!lines.length) {
    throw new Error(
      'لا توجد أسطر لهذه الفاتورة (line_items أو sales_items). تعذّر إرجاع المخزن.'
    );
  }

  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimErr } = await supabase
    .from('sales')
    .update({
      returned_at: nowIso,
      return_note: returnNote.trim() || null,
    })
    .eq('id', saleId)
    .eq('store_id', storeId)
    .is('returned_at', null)
    .select('id')
    .maybeSingle();

  if (claimErr) {
    const msg = String(claimErr.message || '');
    if (/returned_at|column|schema|PGRST204/i.test(msg)) {
      throw new Error(
        'عمود إرجاع الفاتورة غير مُنشأ. نفّذ sales_return_columns.sql في Supabase.'
      );
    }
    throw claimErr;
  }
  if (!claimed?.id) {
    throw new Error('تعذّر حجز المرتجع — قد تكون الفاتورة مُرجَعة مسبقاً.');
  }

  const rollbacks = [];
  try {
    for (const line of lines) {
      const rb = await restockOneLine(supabase, storeId, line);
      if (rb) rollbacks.push(rb);
    }
  } catch (e) {
    for (const rb of rollbacks.reverse()) {
      await rb();
    }
    await unclaimReturn(supabase, saleId, storeId);
    throw e;
  }

  const total = roundMoney(Number(saleRow.total_amount ?? 0));
  const paymentMode = saleRow.payment_mode === 'credit' ? 'credit' : 'cash';

  try {
    if (paymentMode === 'cash') {
      await applyCashSaleReturnFromFund(supabase, {
        storeId,
        saleId,
        totalAmount: total,
        sourceLabel: 'مرتجع',
      });
    } else {
      if (!saleRow.contact_id) {
        throw new Error(
          'فاتورة ذمة بلا زبون مربوط — لا يمكن تعديل المديونية آلياً. اربط الزبون أو سجّل تسوية يدوية.'
        );
      }
      await applyCreditSaleReturn(supabase, {
        storeId,
        saleId,
        contactId: saleRow.contact_id,
        totalAmount: total,
        sourceLabel: 'مرتجع',
      });
    }
  } catch (e) {
    for (const rb of rollbacks.reverse()) {
      await rb();
    }
    await unclaimReturn(supabase, saleId, storeId);
    throw e;
  }

  return { ok: true, saleId };
}
