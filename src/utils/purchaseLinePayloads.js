/**
 * حساب أسطر الفاتورة + توزيع المصاريف الواصلة (Landed Cost) نسبياً على قيمة كل سطر.
 */

export function computeLineTotal(unitPrice, discountPct, qty) {
  const up = Math.max(0, parseFloat(String(unitPrice).replace(',', '.')) || 0);
  const d = Math.min(100, Math.max(0, parseFloat(String(discountPct).replace(',', '.')) || 0));
  const q = Math.max(0, parseFloat(String(qty).replace(',', '.')) || 0);
  const raw = q * up * (1 - d / 100);
  return Math.round(raw * 100) / 100;
}

/** كمية صحيحة من سطر الفاتورة (للمطابقة مع الأرقام التسلسلية وغيرها). */
export function stockQtyFromLine(row) {
  return Math.floor(Math.max(0, parseFloat(String(row.qty).replace(',', '.')) || 0));
}

/** تكلفة الوحدة بعد خصم سطر الشراء */
export function effectiveUnitCostFromRow(row) {
  const up = Math.max(0, parseFloat(String(row.unit_price).replace(',', '.')) || 0);
  const d = Math.min(100, Math.max(0, parseFloat(String(row.discount_percent).replace(',', '.')) || 0));
  return Math.round(up * (1 - d / 100) * 100) / 100;
}

/**
 * @param {Array} lines — صفوف الواجهة (unit_price, discount_percent, qty, …)
 * @param {string|number} landedCostExtraInput — نص المبلغ الإضافي
 */
export function computePurchaseLinePayloads(lines, landedCostExtraInput) {
  const landing = Math.max(0, parseFloat(String(landedCostExtraInput).replace(',', '.')) || 0);
  const raw = lines.map((row) => {
    const unit_price = Math.max(0, parseFloat(String(row.unit_price).replace(',', '.')) || 0);
    const discount_percent = Math.min(
      100,
      Math.max(0, parseFloat(String(row.discount_percent).replace(',', '.')) || 0)
    );
    const qty = Math.max(0, parseFloat(String(row.qty).replace(',', '.')) || 0);
    const line_total = computeLineTotal(row.unit_price, row.discount_percent, row.qty);
    const serials = parseSerialList(row.serialInput);
    const exp = String(row.expiryDate || '').trim().slice(0, 10);
    return {
      barcode: String(row.barcode || '').trim(),
      reference: String(row.reference || '').trim(),
      unit_price,
      discount_percent,
      qty,
      line_total,
      product_id: row.productId || null,
      expiry_date: exp || null,
      serial_numbers: serials.length > 0 ? serials : null,
      landed_line_share: 0,
      landed_unit_extra: 0,
    };
  });
  const gt = raw.reduce((a, x) => a + x.line_total, 0);
  if (landing <= 0 || gt <= 0) return raw;
  return raw.map((r) => {
    const share = (r.line_total / gt) * landing;
    const lu = share / Math.max(r.qty, 1e-9);
    return {
      ...r,
      landed_line_share: Math.round(share * 100) / 100,
      landed_unit_extra: Math.round(lu * 1000000) / 1000000,
    };
  });
}

export function parseSerialList(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(/[\n,;،]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** تحويل line_items المحفوظة في DB إلى صفوف واجهة لإعادة الاستلام */
export function dbLineItemsToReceiveRows(lineItems) {
  let raw = lineItems;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((item) => {
    const serials = item.serial_numbers;
    const serialInput = Array.isArray(serials)
      ? serials.join('\n')
      : typeof serials === 'string'
        ? serials
        : '';
    return {
      key: crypto.randomUUID(),
      barcode: String(item.barcode ?? ''),
      reference: String(item.reference ?? ''),
      unit_price: String(item.unit_price ?? ''),
      discount_percent: String(item.discount_percent ?? '0'),
      qty: String(item.qty ?? ''),
      productId: item.product_id || null,
      productName: '',
      sellPrice: null,
      stockFullPrice: null,
      brandGroup: '',
      expiryDate: item.expiry_date ? String(item.expiry_date).slice(0, 10) : '',
      serialInput,
    };
  });
}
