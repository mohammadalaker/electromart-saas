/**
 * دين عالي (>50k) = أحمر، متوسط (10k–50k) = برتقالي، منخفض (<10k) = أخضر.
 * @param {unknown} amount — outstanding_amount
 */
export function getDebtColor(amount) {
  const debt = Math.max(0, Number(amount) || 0);
  if (debt > 50000) return 'bg-rose-100 text-rose-700 border border-rose-200';
  if (debt > 10000) return 'bg-amber-100 text-amber-700 border border-amber-200';
  return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
}

/**
 * شارة المبلغ (مع فئات الوضع الداكن).
 * @param {unknown} amount — outstanding_amount
 */
export function outstandingDebtBadgeClasses(amount) {
  const debt = Math.max(0, Number(amount) || 0);
  if (debt > 50000) {
    return 'border border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-800/40 dark:bg-rose-950/50 dark:text-rose-200';
  }
  if (debt > 10000) {
    return 'border border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/50 dark:text-amber-200';
  }
  return 'border border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/45 dark:text-emerald-200';
}

/** حدود/خلفية خفيفة لصندوق المبلغ المستحق */
export function outstandingDebtPanelClasses(amount) {
  const debt = Math.max(0, Number(amount) || 0);
  if (debt > 50000) {
    return 'border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/30';
  }
  if (debt > 10000) {
    return 'border-amber-200 bg-amber-50 dark:border-amber-900/35 dark:bg-amber-950/30';
  }
  return 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/35 dark:bg-emerald-950/30';
}

/** لون نص قوي داخل اللوحة (سقف الذمة إلخ) */
export function outstandingDebtMutedLabelClasses(amount) {
  const debt = Math.max(0, Number(amount) || 0);
  if (debt > 50000) {
    return 'text-rose-800/90 dark:text-rose-200/90';
  }
  if (debt > 10000) {
    return 'text-amber-800/90 dark:text-amber-200/90';
  }
  return 'text-emerald-800/90 dark:text-emerald-200/90';
}
