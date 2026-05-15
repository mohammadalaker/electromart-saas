import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  Landmark,
  TrendingDown,
  TrendingUp,
  Wallet,
  ArrowLeft,
  History,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { roundMoney } from '../utils/productModel';
import { FUND_ACCOUNTS_TABLE, FUND_MOVEMENTS_TABLE, ensureDefaultFundAccounts } from '../utils/fundAccounts';

const KIND_LABELS = {
  expense: 'مصروف',
  transfer: 'تحويل',
  adjustment: 'تسوية',
  sale_cash_in: 'بيع كاش',
  sale_cash_return: 'مرتجع كاش',
  purchase_cash_out: 'مشتريات كاش',
};

const EXPENSE_CAT_LABELS = {
  rent: 'إيجار',
  electricity: 'كهرباء ومياه',
  salary: 'رواتب',
  other: 'أخرى',
};

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatShekels(n) {
  return roundMoney(Number(n ?? 0)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * ملخص مالي يركّز على كاش المحل: الرصيد، الوارد، الصادر، والسجل.
 * التسجيل التفصيلي (مصروف/تحويل/تسوية) يبقى في /finance/cashflow
 */
export default function FinancialOverviewPage() {
  const { store, loading: storeLoading } = useStore();
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [period, setPeriod] = useState('today');

  const loadAll = useCallback(async () => {
    if (!store?.id) {
      setAccounts([]);
      setMovements([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setInitError(null);
    try {
      await ensureDefaultFundAccounts(supabase, store.id);
      const { data: acc, error: aErr } = await supabase
        .from(FUND_ACCOUNTS_TABLE)
        .select('id, code, name_ar, balance, sort_order')
        .eq('store_id', store.id)
        .order('sort_order', { ascending: true });
      if (aErr) throw aErr;
      setAccounts(acc || []);

      const since = new Date();
      if (period === 'today') since.setTime(startOfDay(since).getTime());
      else if (period === '7d') since.setDate(since.getDate() - 7);
      else since.setDate(since.getDate() - 30);

      const { data: mov, error: mErr } = await supabase
        .from(FUND_MOVEMENTS_TABLE)
        .select(
          'id, amount, direction, kind, expense_category, description, created_at, fund_account_id, counterparty_fund_id'
        )
        .eq('store_id', store.id)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(400);
      if (mErr) throw mErr;
      setMovements(mov || []);
    } catch (e) {
      console.error(e);
      const msg = e.message || '';
      if (/does not exist|schema cache|PGRST205|42P01/i.test(msg)) {
        setInitError(
          'جدول الصناديق غير مُنشأ. نفّذ store_fund_accounts.sql في Supabase.'
        );
      } else {
        setInitError(msg || 'تعذّر التحميل');
      }
      setAccounts([]);
      setMovements([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id, period]);

  useEffect(() => {
    if (storeLoading) return;
    loadAll();
  }, [storeLoading, loadAll]);

  const cashAccount = useMemo(
    () => accounts.find((a) => a.code === 'cash_shop') || null,
    [accounts]
  );

  const accountNameById = useMemo(() => {
    const m = new Map();
    for (const a of accounts) m.set(a.id, a.name_ar);
    return m;
  }, [accounts]);

  const statsCash = useMemo(() => {
    if (!cashAccount?.id) {
      return { inSum: 0, outSum: 0, expenseSum: 0, saleSum: 0 };
    }
    const cid = cashAccount.id;
    let inSum = 0;
    let outSum = 0;
    let expenseSum = 0;
    let saleSum = 0;
    for (const m of movements) {
      if (m.fund_account_id !== cid) continue;
      const amt = roundMoney(Number(m.amount ?? 0));
      if (m.direction === 'in') {
        inSum += amt;
        if (m.kind === 'sale_cash_in') saleSum += amt;
      } else {
        outSum += amt;
        if (m.kind === 'expense') expenseSum += amt;
      }
    }
    return {
      inSum: roundMoney(inSum),
      outSum: roundMoney(outSum),
      expenseSum: roundMoney(expenseSum),
      saleSum: roundMoney(saleSum),
    };
  }, [movements, cashAccount?.id]);

  const netFlow = roundMoney(statsCash.inSum - statsCash.outSum);

  if (storeLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="animate-spin text-indigo-500" size={40} />
        </div>
      </DashboardLayout>
    );
  }

  if (!store?.id) {
    return (
      <DashboardLayout>
        <div
          className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center font-bold"
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
        <div className="flex flex-wrap items-center gap-3 justify-end">
          <Link
            to="/finance/funds"
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-black text-white hover:bg-teal-700"
          >
            <Landmark size={18} />
            الصناديق والبنوك
          </Link>
          <Link
            to="/finance/cashflow"
            className="inline-flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50/80 px-3 py-2 text-xs font-black text-teal-900 hover:bg-teal-100 dark:border-teal-800/50 dark:bg-teal-950/40 dark:text-teal-100 dark:hover:bg-teal-900/45"
          >
            تسجيل الحركات
          </Link>
          <Link
            to="/reports/profit"
            className="text-sm font-bold text-emerald-700 hover:text-emerald-900 dark:text-emerald-400"
          >
            تقارير الأرباح ←
          </Link>
        </div>
      }
    >
      <div className="max-w-5xl mx-auto space-y-6" dir="rtl">
        <div className="rounded-2xl border border-white/20 dark:border-gray-700/30 bg-white/80 dark:bg-gray-900/50 backdrop-blur-md p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4 justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-700 dark:text-violet-400">
                <Wallet size={28} />
              </div>
              <div>
                <h1 className="text-xl font-black text-slate-900 dark:text-white">
                  المالية والمصروفات
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed max-w-2xl">
                  تعرف كم بعت من الكاش، وكم صرفت من درج المحل، ورصيد كاش المحل الآن. لعرض كل الصناديق
                  والبنوك وعددها استخدم «الصناديق والبنوك»؛ ولتسجيل مصروف أو تحويل استخدم «تسجيل الحركات».
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Link
                to="/finance/funds"
                className="text-sm font-bold text-teal-700 hover:text-teal-900 dark:text-teal-400 inline-flex items-center gap-1"
              >
                <ArrowLeft size={16} className="rotate-180" />
                الصناديق والبنوك
              </Link>
              <span className="text-slate-300 dark:text-slate-600">|</span>
              <Link
                to="/finance/cashflow"
                className="text-sm font-bold text-slate-500 hover:text-teal-600 inline-flex items-center gap-1"
              >
                تسجيل الحركات
              </Link>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { id: 'today', label: 'اليوم' },
            { id: '7d', label: 'آخر 7 أيام' },
            { id: '30d', label: 'آخر 30 يوماً' },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`rounded-xl px-4 py-2 text-sm font-black transition-colors ${
                period === p.id
                  ? 'bg-violet-600 text-white'
                  : 'bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/15'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {initError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm font-bold text-amber-900 dark:text-amber-100">
            {initError}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-violet-500" size={36} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-gradient-to-br from-white to-slate-50/80 dark:from-gray-900/80 dark:to-gray-900/40 p-5 shadow-sm">
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-wide">
                  <Wallet size={14} />
                  كاش المحل الآن
                </div>
                <p
                  className="text-2xl font-black font-currency text-violet-700 dark:text-violet-300 mt-2"
                  dir="ltr"
                  lang="en"
                >
                  ₪ {formatShekels(cashAccount ? cashAccount.balance : 0)}
                </p>
                <p className="text-[10px] text-slate-400 mt-2 font-bold">رصيد الصندوق cash_shop</p>
              </div>

              <div className="rounded-2xl border border-emerald-200/60 dark:border-emerald-900/40 bg-emerald-50/50 dark:bg-emerald-950/20 p-5 shadow-sm">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-xs font-black">
                  <TrendingUp size={14} />
                  وارد كاش (الفترة)
                </div>
                <p
                  className="text-2xl font-black font-currency text-emerald-800 dark:text-emerald-300 mt-2"
                  dir="ltr"
                  lang="en"
                >
                  ₪ {formatShekels(statsCash.inSum)}
                </p>
                <p className="text-[10px] text-slate-500 mt-2">
                  منها بيع كاش: ₪ {formatShekels(statsCash.saleSum)}
                </p>
              </div>

              <div className="rounded-2xl border border-rose-200/60 dark:border-rose-900/40 bg-rose-50/50 dark:bg-rose-950/20 p-5 shadow-sm">
                <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400 text-xs font-black">
                  <TrendingDown size={14} />
                  صادر كاش (الفترة)
                </div>
                <p
                  className="text-2xl font-black font-currency text-rose-800 dark:text-rose-300 mt-2"
                  dir="ltr"
                  lang="en"
                >
                  ₪ {formatShekels(statsCash.outSum)}
                </p>
                <p className="text-[10px] text-slate-500 mt-2">
                  مصروفات مسجّلة: ₪ {formatShekels(statsCash.expenseSum)}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/90 dark:bg-gray-900/40 p-5 shadow-sm">
                <div className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  صافي الحركة (كاش)
                </div>
                <p
                  className={`text-2xl font-black font-currency mt-2 ${
                    netFlow >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-rose-700 dark:text-rose-400'
                  }`}
                  dir="ltr"
                  lang="en"
                >
                  {netFlow >= 0 ? '+' : '−'}₪ {formatShekels(Math.abs(netFlow))}
                </p>
                <p className="text-[10px] text-slate-400 mt-2 font-bold">وارد − صادر على كاش المحل</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white/90 dark:bg-gray-900/40 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-white/10 flex items-center gap-2 bg-slate-50/80 dark:bg-white/5">
                <History size={18} className="text-slate-500" />
                <h2 className="font-black text-slate-900 dark:text-white text-sm">
                  حركات الفترة (كل الصناديق)
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[640px]">
                  <thead>
                    <tr className="bg-slate-100/80 dark:bg-white/5 text-slate-600 dark:text-slate-400">
                      <th className="text-right py-2 px-3 font-black">التاريخ</th>
                      <th className="text-right py-2 px-3 font-black">الصندوق</th>
                      <th className="text-right py-2 px-3 font-black">النوع</th>
                      <th className="text-right py-2 px-3 font-black">الاتجاه</th>
                      <th className="text-left py-2 px-3 font-black font-currency" dir="ltr">
                        المبلغ
                      </th>
                      <th className="text-right py-2 px-3 font-black">تفاصيل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-slate-500 font-bold">
                          لا حركات في هذه الفترة
                        </td>
                      </tr>
                    ) : (
                      movements.map((m) => {
                        const fundName = accountNameById.get(m.fund_account_id) || '—';
                        const other =
                          m.counterparty_fund_id && accountNameById.get(m.counterparty_fund_id);
                        const cat =
                          m.expense_category && EXPENSE_CAT_LABELS[m.expense_category];
                        return (
                          <tr
                            key={m.id}
                            className="border-b border-slate-50 dark:border-white/5 hover:bg-slate-50/50 dark:hover:bg-white/5"
                          >
                            <td className="py-2 px-3 font-currency text-slate-600" dir="ltr">
                              {new Date(m.created_at).toLocaleString('en-GB', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="py-2 px-3 font-bold">{fundName}</td>
                            <td className="py-2 px-3">{KIND_LABELS[m.kind] || m.kind}</td>
                            <td className="py-2 px-3">
                              <span
                                className={
                                  m.direction === 'out'
                                    ? 'text-rose-600 dark:text-rose-400 font-black'
                                    : 'text-emerald-600 dark:text-emerald-400 font-black'
                                }
                              >
                                {m.direction === 'out' ? 'صادر' : 'وارد'}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-currency font-black text-left" dir="ltr" lang="en">
                              ₪{Number(m.amount).toFixed(2)}
                            </td>
                            <td className="py-2 px-3 text-slate-600 max-w-[220px] truncate" title={m.description}>
                              {m.description}
                              {cat && <span className="text-slate-400"> · {cat}</span>}
                              {m.kind === 'transfer' && other && (
                                <span className="text-slate-400">
                                  {' '}
                                  {m.direction === 'out' ? '←' : '←'} {other}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 text-center leading-relaxed px-2">
              مرجع قاعدة البيانات الموحّد: يمكنك تنفيذ{' '}
              <code className="font-mono bg-slate-100 dark:bg-white/10 px-1 rounded">financial_transactions_view.sql</code>{' '}
              لإنشاء عرض <code className="font-mono">financial_transactions</code> للتقارير والتصدير.
            </p>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
