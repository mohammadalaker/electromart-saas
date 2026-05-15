import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  Package,
  Wallet,
  Users,
  Truck,
  Landmark,
  ArrowLeft,
  Info,
  Scale,
  BookOpen,
  Receipt,
  Banknote,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { roundMoney } from '../utils/productModel';
import { FUND_ACCOUNTS_TABLE, ensureDefaultFundAccounts } from '../utils/fundAccounts';

const CONTACTS_TABLE = 'store_contacts';
const JE_TABLE = 'journal_entries';

const ENTRY_TYPE_LABELS = {
  cash_sale: 'بيع كاش',
  credit_sale: 'بيع ذمة',
  sale_return: 'مرتجع',
  cash_purchase: 'شراء كاش',
  credit_purchase: 'شراء آجل',
  expense: 'مصروف',
  transfer: 'تحويل',
  adjustment: 'تسوية',
  opening_balance: 'رصيد افتتاحي',
  manual: 'يدوي',
};

function formatShekels(n) {
  return roundMoney(Number(n ?? 0)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** مجموع قيمة المخزن: كمية × متوسط تكلفة (full_price) */
async function sumInventoryValueByStore(supabaseClient, storeId) {
  const pageSize = 1000;
  let from = 0;
  let total = 0;
  for (;;) {
    const { data, error } = await supabaseClient
      .from(PRODUCTS_TABLE)
      .select('stock_count, full_price')
      .eq('store_id', storeId)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      const q = Math.max(0, Number(row.stock_count ?? 0));
      const cost = Math.max(0, Number(row.full_price ?? 0));
      total += q * cost;
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return roundMoney(total);
}

async function sumOutstandingByRole(supabaseClient, storeId, role) {
  const { data, error } = await supabaseClient
    .from(CONTACTS_TABLE)
    .select('outstanding_amount')
    .eq('store_id', storeId)
    .eq('role', role);
  if (error) throw error;
  let sum = 0;
  for (const row of data || []) {
    sum += Math.max(0, Number(row.outstanding_amount ?? 0));
  }
  return roundMoney(sum);
}

export default function FinancialCenterPage() {
  const { store, loading: storeLoading } = useStore();
  const [loading, setLoading] = useState(true);
  const [inventoryValue, setInventoryValue] = useState(0);
  const [liquidityTotal, setLiquidityTotal] = useState(0);
  const [fundBreakdown, setFundBreakdown] = useState([]);
  const [receivables, setReceivables] = useState(0);
  const [payables, setPayables] = useState(0);
  const [errors, setErrors] = useState({});
  const [recentJournal, setRecentJournal] = useState([]);

  const load = useCallback(async () => {
    if (!store?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const nextErrors = {};

    let inv = 0;
    try {
      inv = await sumInventoryValueByStore(supabase, store.id);
      setInventoryValue(inv);
    } catch (e) {
      console.error('[FinancialCenter] inventory', e);
      nextErrors.inventory = e.message || 'تعذّر حساب المخزون';
      setInventoryValue(0);
    }

    let liq = 0;
    const breakdown = [];
    try {
      await ensureDefaultFundAccounts(supabase, store.id);
      const { data: acc, error: aErr } = await supabase
        .from(FUND_ACCOUNTS_TABLE)
        .select('id, code, name_ar, balance, sort_order')
        .eq('store_id', store.id)
        .order('sort_order', { ascending: true });
      if (aErr) throw aErr;
      for (const row of acc || []) {
        const b = Math.max(0, Number(row.balance ?? 0));
        liq += b;
        breakdown.push({
          id: row.id,
          name: row.name_ar || row.code,
          balance: roundMoney(b),
        });
      }
      setLiquidityTotal(roundMoney(liq));
      setFundBreakdown(breakdown);
    } catch (e) {
      console.error('[FinancialCenter] funds', e);
      nextErrors.liquidity = e.message || 'تعذّر تحميل الصناديق';
      setLiquidityTotal(0);
      setFundBreakdown([]);
    }

    let ar = 0;
    try {
      ar = await sumOutstandingByRole(supabase, store.id, 'customer');
      setReceivables(ar);
    } catch (e) {
      console.error('[FinancialCenter] AR', e);
      nextErrors.receivables = e.message || 'تعذّر تحميل ذمم الزبائن';
      setReceivables(0);
    }

    let ap = 0;
    try {
      ap = await sumOutstandingByRole(supabase, store.id, 'supplier');
      setPayables(ap);
    } catch (e) {
      console.error('[FinancialCenter] AP', e);
      nextErrors.payables = e.message || 'تعذّر تحميل ذمم الموردين';
      setPayables(0);
    }

    try {
      const { data: je } = await supabase
        .from(JE_TABLE)
        .select('id, entry_date, entry_type, description, total_amount, created_at')
        .eq('store_id', store.id)
        .order('created_at', { ascending: false })
        .limit(8);
      setRecentJournal(je || []);
    } catch (e) {
      console.warn('[FinancialCenter] journal_entries', e);
      setRecentJournal([]);
    }

    setErrors(nextErrors);
    setLoading(false);
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    load();
  }, [storeLoading, load]);

  const netCompanyValue = useMemo(() => {
    return roundMoney(
      Number(inventoryValue) + Number(liquidityTotal) + Number(receivables) - Number(payables)
    );
  }, [inventoryValue, liquidityTotal, receivables, payables]);

  const assetsSubtotal = useMemo(
    () => roundMoney(Number(inventoryValue) + Number(liquidityTotal) + Number(receivables)),
    [inventoryValue, liquidityTotal, receivables]
  );

  if (storeLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="animate-spin text-indigo-500 dark:text-indigo-400" size={40} />
        </div>
      </DashboardLayout>
    );
  }

  if (!store?.id) {
    return (
      <DashboardLayout>
        <div
          className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center font-bold dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
          dir="rtl"
        >
          لا يوجد متجر مرتبط بحسابك.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/finance"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <ArrowLeft size={18} />
            المالية والمصروفات
          </Link>
          <Link
            to="/finance/cashflow"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
          >
            التدفق النقدي
          </Link>
          <Link
            to="/finance/journal"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <BookOpen size={18} />
            القيود اليومية
          </Link>
          <Link
            to="/vouchers"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <Receipt size={18} />
            السندات
          </Link>
          <Link
            to="/finance/checks"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <Banknote size={18} />
            الشيكات
          </Link>
        </div>
      }
    >
      <div className="max-w-5xl mx-auto space-y-8" dir="rtl">
        <header className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25">
              <Scale size={26} strokeWidth={2} />
            </div>
            <div>
              <h1 className="font-title text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                المركز المالي
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 font-bold mt-0.5">
                لقطة محاسبية للمتجر — مستوحاة من لوحات المركز المالي في أنظمة مثل Odoo
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 dark:border-indigo-900/40 dark:bg-indigo-950/30 px-4 py-3 flex gap-3 items-start">
            <Info className="shrink-0 text-indigo-600 dark:text-indigo-400 mt-0.5" size={18} />
            <p className="text-xs font-bold text-indigo-950 dark:text-indigo-100/90 leading-relaxed">
              قيمة المخزن = مجموع (الكمية × <code className="px-1 rounded bg-white/70 dark:bg-indigo-900/50">full_price</code>) لكل
              الأصناف؛ يُفترض أن <strong>full_price</strong> يعكس متوسط تكلفة مرجحاً بعد الاستلامات. السيولة = مجموع أرصدة
              صناديق المتجر (كاش، بنك، عهدة…). الذمم من حقل <strong>المستحق</strong> في دليل الزبائن والموردين.
            </p>
          </div>
        </header>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-2xl border border-slate-200/80 bg-white dark:border-gray-700/50 dark:bg-gray-900/70">
            <Loader2 className="animate-spin text-indigo-500 dark:text-indigo-400" size={40} />
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400">جاري حساب المؤشرات…</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900/70 dark:shadow-[0_4px_32px_-8px_rgba(0,0,0,0.45)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      قيمة المخزون (بالتكلفة)
                    </p>
                    <p className="text-2xl sm:text-3xl font-black font-currency text-slate-900 dark:text-white mt-1" dir="ltr">
                      ₪{formatShekels(inventoryValue)}
                    </p>
                  </div>
                  <div className="w-11 h-11 rounded-xl bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-700 dark:text-emerald-300">
                    <Package size={22} />
                  </div>
                </div>
                {errors.inventory ? (
                  <p className="mt-3 text-xs font-bold text-rose-600 dark:text-rose-300">{errors.inventory}</p>
                ) : null}
              </div>

              <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900/70 dark:shadow-[0_4px_32px_-8px_rgba(0,0,0,0.45)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      إجمالي السيولة (صناديق وبنوك)
                    </p>
                    <p className="text-2xl sm:text-3xl font-black font-currency text-slate-900 dark:text-white mt-1" dir="ltr">
                      ₪{formatShekels(liquidityTotal)}
                    </p>
                  </div>
                  <div className="w-11 h-11 rounded-xl bg-sky-100 dark:bg-sky-950/50 flex items-center justify-center text-sky-700 dark:text-sky-300">
                    <Landmark size={22} />
                  </div>
                </div>
                {errors.liquidity ? (
                  <p className="mt-3 text-xs font-bold text-rose-600 dark:text-rose-300">{errors.liquidity}</p>
                ) : fundBreakdown.length > 0 ? (
                  <ul className="mt-3 space-y-1.5 text-xs font-bold text-slate-600 dark:text-slate-400 border-t border-slate-100 dark:border-slate-700/60 pt-3">
                    {fundBreakdown.map((f) => (
                      <li key={f.id} className="flex justify-between gap-2">
                        <span>{f.name}</span>
                        <span className="font-currency text-slate-800 dark:text-slate-200" dir="ltr">
                          ₪{formatShekels(f.balance)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {!errors.liquidity ? (
                  <Link
                    to="/finance/funds"
                    className="mt-3 inline-block text-[11px] font-black text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    عرض الصناديق والبنوك بالتفصيل ←
                  </Link>
                ) : null}
              </div>

              <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900/70 dark:shadow-[0_4px_32px_-8px_rgba(0,0,0,0.45)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      ديون الزبائن (لنا)
                    </p>
                    <p className="text-2xl sm:text-3xl font-black font-currency text-amber-800 dark:text-amber-200 mt-1" dir="ltr">
                      ₪{formatShekels(receivables)}
                    </p>
                  </div>
                  <div className="w-11 h-11 rounded-xl bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center text-amber-800 dark:text-amber-200">
                    <Users size={22} />
                  </div>
                </div>
                {errors.receivables ? (
                  <p className="mt-3 text-xs font-bold text-rose-600 dark:text-rose-300">{errors.receivables}</p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      to="/customers/debt"
                      className="text-[11px] font-black text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      الذمم والديون ←
                    </Link>
                    <Link
                      to="/sales/customer-statement"
                      className="text-[11px] font-black text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      كشف حساب زبون ←
                    </Link>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-gray-900/70 dark:shadow-[0_4px_32px_-8px_rgba(0,0,0,0.45)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      ديون الموردين (علينا)
                    </p>
                    <p className="text-2xl sm:text-3xl font-black font-currency text-rose-800 dark:text-rose-200 mt-1" dir="ltr">
                      ₪{formatShekels(payables)}
                    </p>
                  </div>
                  <div className="w-11 h-11 rounded-xl bg-rose-100 dark:bg-rose-950/40 flex items-center justify-center text-rose-700 dark:text-rose-300">
                    <Truck size={22} />
                  </div>
                </div>
                {errors.payables ? (
                  <p className="mt-3 text-xs font-bold text-rose-600 dark:text-rose-300">{errors.payables}</p>
                ) : (
                  <div className="mt-3">
                    <Link
                      to="/purchases/supplier-statement"
                      className="text-[11px] font-black text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      كشف حساب مورد ←
                    </Link>
                  </div>
                )}
              </div>
            </div>

            <div className="relative overflow-hidden rounded-3xl border-2 border-indigo-200/90 bg-gradient-to-br from-indigo-50 via-white to-violet-50/80 dark:from-indigo-950/50 dark:via-gray-900/90 dark:to-violet-950/40 dark:border-indigo-800/50 dark:shadow-[0_8px_40px_-12px_rgba(0,0,0,0.5)] px-6 py-10">
              <div className="absolute top-0 right-0 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="relative space-y-6">
                <div className="flex items-center gap-2 text-indigo-900 dark:text-indigo-100">
                  <Wallet className="shrink-0" size={22} />
                  <h2 className="font-title text-lg font-black">صافي قيمة الشركة (تقديرية)</h2>
                </div>

                <div className="rounded-2xl bg-white/80 dark:bg-gray-950/50 border border-indigo-100 dark:border-indigo-900/40 px-4 py-4 font-mono text-sm sm:text-base space-y-2 text-slate-800 dark:text-slate-100" dir="ltr">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-slate-500 dark:text-slate-400">(</span>
                    <span className="font-currency font-black">₪{formatShekels(inventoryValue)}</span>
                    <span className="text-slate-500 dark:text-slate-400">مخزون</span>
                    <span className="text-slate-400">+</span>
                    <span className="font-currency font-black">₪{formatShekels(liquidityTotal)}</span>
                    <span className="text-slate-500 dark:text-slate-400">سيولة</span>
                    <span className="text-slate-400">+</span>
                    <span className="font-currency font-black">₪{formatShekels(receivables)}</span>
                    <span className="text-slate-500 dark:text-slate-400">ذمم زبائن</span>
                    <span className="text-slate-400">)</span>
                    <span className="text-slate-400">−</span>
                    <span className="font-currency font-black text-rose-700 dark:text-rose-300">₪{formatShekels(payables)}</span>
                    <span className="text-slate-500 dark:text-slate-400">ذمم موردين</span>
                  </p>
                  <p className="text-xs font-sans font-bold text-slate-500 dark:text-slate-400 text-right" dir="rtl">
                    أي مجموع أصول تشغيلية تقريبية (مخزون + نقد + مستحقات) ناقص الالتزامات تجاه الموردين.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200/90 bg-white/90 p-4 dark:border-white/10 dark:bg-gray-950/40">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                      <BookOpen size={18} className="text-indigo-600 dark:text-indigo-400" />
                      أحدث القيود المحاسبية (تلقائية من البيع والشراء والصناديق)
                    </h3>
                    <Link
                      to="/finance/journal"
                      className="text-[11px] font-black text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      الكل ←
                    </Link>
                  </div>
                  {recentJournal.length === 0 ? (
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      لا قيود بعد — نفّذ <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">journal_entries_auto_triggers.sql</code> لربط المبيعات بالقيود.
                    </p>
                  ) : (
                    <ul className="space-y-2 text-xs">
                      {recentJournal.map((j) => (
                        <li
                          key={j.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-white/10 dark:bg-white/5"
                        >
                          <span className="font-bold text-slate-700 dark:text-slate-200">
                            {ENTRY_TYPE_LABELS[j.entry_type] || j.entry_type}
                          </span>
                          <span className="font-currency text-slate-900 dark:text-white" dir="ltr">
                            {'\u20AA'}
                            {formatShekels(j.total_amount)}
                          </span>
                          <span className="w-full text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            {String(j.description || '').slice(0, 120)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-t border-indigo-200/60 dark:border-indigo-800/50 pt-6">
                  <div>
                    <p className="text-[11px] font-black text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">
                      المجموع قبل الموردين
                    </p>
                    <p className="text-2xl font-black font-currency text-indigo-900 dark:text-indigo-100" dir="ltr">
                      ₪{formatShekels(assetsSubtotal)}
                    </p>
                  </div>
                  <div className="text-center sm:text-left">
                    <p className="text-[11px] font-black text-violet-800 dark:text-violet-200 uppercase tracking-wider mb-1">
                      صافي قيمة الشركة
                    </p>
                    <p
                      className={`text-4xl sm:text-5xl font-black font-currency tracking-tight ${
                        netCompanyValue >= 0
                          ? 'text-indigo-700 dark:text-indigo-200'
                          : 'text-rose-600 dark:text-rose-300'
                      }`}
                      dir="ltr"
                    >
                      ₪{formatShekels(netCompanyValue)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
