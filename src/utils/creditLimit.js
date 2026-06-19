import { roundMoney } from './productModel';

function parseCreditLimit(creditLimitRaw) {
  if (creditLimitRaw == null || creditLimitRaw === '') return 0;
  const lim = Number(creditLimitRaw);
  return Number.isFinite(lim) ? lim : 0;
}

/**
 * هل يتجاوز (المستحق الحالي + مبلغ البيع الجديد) سقف الذمة؟
 * @param {unknown} outstanding — outstanding_amount
 * @param {unknown} creditLimitRaw — credit_limit من قاعدة البيانات؛ 0 = بدون سقف
 * @param {number} saleTotal — إجمالي الفاتورة الحالية
 */
export function isCreditLimitExceeded(outstanding, creditLimitRaw, saleTotal) {
  const lim = parseCreditLimit(creditLimitRaw);
  if (lim <= 0) return false;
  const out = Math.max(0, Number(outstanding ?? 0));
  const after = roundMoney(out + Number(saleTotal ?? 0));
  return after > lim + 1e-6;
}

/**
 * تفاصيل التحذير عند تجاوز الحد — null إن لم يكن هناك تجاوز أو لا يوجد حد.
 */
export function getCreditLimitWarning({ outstanding, creditLimitRaw, saleTotal }) {
  const lim = parseCreditLimit(creditLimitRaw);
  if (lim <= 0) return null;
  const currentBalance = roundMoney(Math.max(0, Number(outstanding ?? 0)));
  const afterSale = roundMoney(currentBalance + Number(saleTotal ?? 0));
  if (afterSale <= lim + 1e-6) return null;
  return {
    creditLimit: lim,
    currentBalance,
    afterSale,
  };
}

/** شارة في تقارير الذمم */
export function getCreditLimitBadgeStatus(outstanding, creditLimit) {
  const limit = Number(creditLimit);
  const balance = Math.max(0, Number(outstanding ?? 0));
  if (!limit || limit <= 0) return null;

  const percentage = (balance / limit) * 100;

  if (balance > limit) {
    return { label: 'تجاوز الحد', color: 'red' };
  }
  if (percentage >= 80) {
    return { label: 'قريب من الحد', color: 'amber' };
  }
  return null;
}

export const CREDIT_LIMIT_EXCEEDED_MESSAGE =
  'عذراً، هذا الزبون تجاوز حد الدين المسموح به';

/**
 * تحقق من السقف من قاعدة البيانات (يُفضّل عند إتمام البيع).
 * إن لم يكن عمود credit_limit موجوداً يُعاد السماح دون فحص السقف.
 */
export async function verifyCreditLimitAllowsSale(
  supabase,
  { storeId, contactId, saleTotal },
  { bypassWarning = false } = {}
) {
  if (bypassWarning) return { allowed: true };
  if (!contactId || !storeId) return { allowed: true };
  let { data, error } = await supabase
    .from('store_contacts')
    .select('outstanding_amount, credit_limit')
    .eq('id', contactId)
    .eq('store_id', storeId)
    .maybeSingle();
  if (error && /credit_limit|column|schema|PGRST204/i.test(String(error.message || ''))) {
    ({ data, error } = await supabase
      .from('store_contacts')
      .select('outstanding_amount')
      .eq('id', contactId)
      .eq('store_id', storeId)
      .maybeSingle());
  }
  if (error) throw error;
  if (!data) return { allowed: true };
  const warning = getCreditLimitWarning({
    outstanding: data.outstanding_amount,
    creditLimitRaw: data.credit_limit,
    saleTotal,
  });
  if (warning) {
    return { allowed: false, message: CREDIT_LIMIT_EXCEEDED_MESSAGE, warning };
  }
  return { allowed: true };
}
