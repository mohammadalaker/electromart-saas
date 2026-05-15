/** إضافة أيام إلى تاريخ ISO (yyyy-mm-dd) */
export function addDaysISO(isoDate, days) {
  if (!isoDate) return '';
  const d = new Date(`${String(isoDate).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + Number(days) || 0);
  return d.toISOString().slice(0, 10);
}
