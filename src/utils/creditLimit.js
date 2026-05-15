import { roundMoney } from './productModel';

/**
 * هل يتجاوز (المستحق الحالي + مبلغ البيع الجديد) سقف الذمة؟
 * @param {unknown} outstanding — outstanding_amount
 * @param {unknown} creditLimitRaw — credit_limit من قاعدة البيانات؛ null/فارغ = بدون سقف
 * @param {number} saleTotal — إجمالي الفاتورة الحالية
 */
export function isCreditLimitExceeded(outstanding, creditLimitRaw, saleTotal) {
  const lim =
    creditLimitRaw != null && creditLimitRaw !== ''
      ? Number(creditLimitRaw)
      : null;
  if (lim == null || !Number.isFinite(lim) || lim <= 0) return false;
  const out = Math.max(0, Number(outstanding ?? 0));
  const after = roundMoney(out + Number(saleTotal ?? 0));
  return after > lim + 1e-6;
}

export const CREDIT_LIMIT_EXCEEDED_MESSAGE =
  'عذراً، هذا الزبون تجاوز حد الدين المسموح به';

/**
 * تحقق من السقف من قاعدة البيانات (يُفضّل عند إتمام البيع).
 * إن لم يكن عمود credit_limit موجوداً يُعاد السماح دون فحص السقف.
 */
export async function verifyCreditLimitAllowsSale(supabase, { storeId, contactId, saleTotal }) {
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
  if (isCreditLimitExceeded(data.outstanding_amount, data.credit_limit, saleTotal)) {
    return { allowed: false, message: CREDIT_LIMIT_EXCEEDED_MESSAGE };
  }
  return { allowed: true };
}
