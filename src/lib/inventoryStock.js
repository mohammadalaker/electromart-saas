/**
 * يطابق المواصفة stock_quantity: يأتي من عمود المخزن في DB (مثل stock_count).
 * يُستخدم في فلتر «منتهية» وبطاقة الإحصائيات لضمان نفس الرقم.
 */
export function inventoryStockQuantity(item) {
  const n = Number(item?.stock);
  return Number.isNaN(n) ? 0 : n;
}

/** نفس منطق زر التصفية «منتهية»: كمية المخزن ≤ 0 */
export function isInventoryOutOfStock(item) {
  return inventoryStockQuantity(item) <= 0;
}
