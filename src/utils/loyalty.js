import { supabase } from '../lib/supabaseClient';
import { roundMoney } from './productModel';

export const LOYALTY_SETTINGS_TABLE = 'store_loyalty_settings';
export const LOYALTY_TX_TABLE = 'loyalty_point_transactions';

export const DEFAULT_LOYALTY_SETTINGS = {
  earn_shekel_per_point: 100,
  redeem_shekel_per_point: 1,
};

function isMissingTable(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || '');
  return err.code === 'PGRST205' || err.code === '42P01' || /does not exist|schema cache/i.test(msg);
}

/**
 * إعدادات الولاء للمتجر — أو افتراضي إذا لم يُنشَأ الصف بعد.
 */
export async function fetchLoyaltySettings(storeId) {
  if (!storeId) return { settings: DEFAULT_LOYALTY_SETTINGS, missingTable: false };
  const { data, error } = await supabase
    .from(LOYALTY_SETTINGS_TABLE)
    .select('earn_shekel_per_point, redeem_shekel_per_point')
    .eq('store_id', storeId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { settings: DEFAULT_LOYALTY_SETTINGS, missingTable: true };
    throw error;
  }
  if (!data) return { settings: DEFAULT_LOYALTY_SETTINGS, missingTable: false };
  return {
    settings: {
      earn_shekel_per_point: Number(data.earn_shekel_per_point) || DEFAULT_LOYALTY_SETTINGS.earn_shekel_per_point,
      redeem_shekel_per_point:
        Number(data.redeem_shekel_per_point) || DEFAULT_LOYALTY_SETTINGS.redeem_shekel_per_point,
    },
    missingTable: false,
  };
}

/**
 * كم نقطة يُسمح باستبدالها والخصم الناتج والمبلغ النهائي.
 */
export function computeEffectiveRedemption({
  pointsRequested,
  balance,
  cartFinalTotal,
  redeemShekelPerPoint,
}) {
  const r = Math.max(0.0001, Number(redeemShekelPerPoint) || 1);
  const bal = Math.max(0, Number(balance) || 0);
  const cart = Math.max(0, roundMoney(cartFinalTotal));
  const maxByCart = Math.floor(cart / r + 1e-9);
  const maxPts = Math.min(Math.floor(bal + 1e-9), maxByCart);
  const want = Math.floor(Math.max(0, Number(pointsRequested) || 0));
  const effectivePoints = Math.min(want, maxPts);
  const discountShekel = roundMoney(effectivePoints * r);
  const payable = Math.max(0, roundMoney(cart - discountShekel));
  return { effectivePoints, discountShekel, payable };
}

/** نقاط تُكتسب من مبلغ الفاتورة بعد خصم النقاط (المبلغ الفعلي المدفوع). */
export function computeEarnedPoints(payableAfterLoyalty, earnShekelPerPoint) {
  const d = Math.max(0.0001, Number(earnShekelPerPoint) || 100);
  const p = Math.max(0, roundMoney(payableAfterLoyalty));
  return Math.floor(p / d + 1e-9);
}
