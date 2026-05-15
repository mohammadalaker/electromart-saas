/**
 * حساب حالة الضمان من تاريخ البيع ومدة الضمان بالأشهر (من بيانات المنتج).
 */

/** @typedef {{ kind: 'active'|'expired'|'unknown', labelAr: string, endDate: Date|null, daysLeft: number|null }} WarrantyStatus */

/**
 * @param {string|Date|null} saleDateIso — تاريخ/وقت الفاتورة
 * @param {number|null|undefined} warrantyMonths — من products.warranty_months
 * @returns {WarrantyStatus}
 */
export function computeWarrantyStatus(saleDateIso, warrantyMonths) {
  const m = warrantyMonths == null ? null : Number(warrantyMonths);
  if (m == null || Number.isNaN(m) || m < 0) {
    return { kind: 'unknown', labelAr: 'غير محدد في الصنف', endDate: null, daysLeft: null };
  }
  if (m === 0) {
    return { kind: 'unknown', labelAr: 'لا يوجد ضمان (0 شهر)', endDate: null, daysLeft: null };
  }
  if (!saleDateIso) {
    return { kind: 'unknown', labelAr: 'لا تاريخ بيع', endDate: null, daysLeft: null };
  }

  const sale = new Date(saleDateIso);
  if (Number.isNaN(sale.getTime())) {
    return { kind: 'unknown', labelAr: 'تاريخ غير صالح', endDate: null, daysLeft: null };
  }

  const end = new Date(sale);
  end.setMonth(end.getMonth() + m);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(23, 59, 59, 999);

  const expired = today > endDay;
  const msPerDay = 86400000;
  const daysLeft = expired ? 0 : Math.max(0, Math.ceil((endDay.getTime() - today.getTime()) / msPerDay));

  return {
    kind: expired ? 'expired' : 'active',
    labelAr: expired ? 'منتهي' : 'ساري',
    endDate: end,
    daysLeft: expired ? 0 : daysLeft,
  };
}

export function formatWarrantyEndDate(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
  try {
    return d.toLocaleDateString('ar-EG', { dateStyle: 'medium' });
  } catch {
    return '—';
  }
}
