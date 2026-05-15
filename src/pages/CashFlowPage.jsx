import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Landmark, ArrowLeftRight, MinusCircle, History, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';
import { roundMoney } from '../utils/productModel';
import { FUND_ACCOUNTS_TABLE, FUND_MOVEMENTS_TABLE, ensureDefaultFundAccounts } from '../utils/fundAccounts';

const EXPENSE_CATEGORIES = [
  { value: 'rent', label: 'إيجار المحل' },
  { value: 'electricity', label: 'كهرباء ومياه' },
  { value: 'salary', label: 'رواتب' },
  { value: 'other', label: 'أخرى' },
];

const KIND_LABELS = {
  expense: 'مصروف',
  transfer: 'تحويل',
  adjustment: 'تسوية',
  sale_cash_in: 'بيع كاش',
  sale_cash_return: 'مرتجع كاش',
  purchase_cash_out: 'مشتريات كاش',
};

function parseAmount(raw) {
  const n = parseFloat(normalizeDigitsToLatin(String(raw || '').replace(',', '.')));
  return Number.isFinite(n) ? roundMoney(n) : 0;
}

export default function CashFlowPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [movements, setMovements] = useState([]);

  const [expenseFundId, setExpenseFundId] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('rent');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseNote, setExpenseNote] = useState('');
  const [expenseSaving, setExpenseSaving] = useState(false);

  const [fromFundId, setFromFundId] = useState('');
  const [toFundId, setToFundId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [transferSaving, setTransferSaving] = useState(false);

  const [adjFundId, setAdjFundId] = useState('');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjNote, setAdjNote] = useState('');
  const [adjSaving, setAdjSaving] = useState(false);

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
      if ((acc || []).length) {
        const cash = acc.find((x) => x.code === 'cash_shop') || acc[0];
        const bank = acc.find((x) => x.code === 'bank');
        setExpenseFundId((prev) => prev || cash?.id || '');
        setFromFundId((prev) => prev || cash?.id || '');
        setToFundId((prev) => (prev && acc.some((a) => a.id === prev) ? prev : bank?.id || acc[1]?.id || ''));
        setAdjFundId((prev) => prev || cash?.id || '');
      }

      const { data: mov, error: mErr } = await supabase
        .from(FUND_MOVEMENTS_TABLE)
        .select(
          'id, amount, direction, kind, expense_category, description, created_at, fund_account_id, counterparty_fund_id, transfer_batch_id'
        )
        .eq('store_id', store.id)
        .order('created_at', { ascending: false })
        .limit(80);
      if (mErr) throw mErr;
      setMovements(mov || []);
    } catch (e) {
      console.error(e);
      const msg = e.message || '';
      if (/does not exist|schema cache|PGRST205|42P01/i.test(msg)) {
        setInitError(
          'جدول الصناديق غير مُنشأ في قاعدة البيانات. نفّذ الملف store_fund_accounts.sql في Supabase.'
        );
      } else {
        setInitError(msg || 'تعذّر التحميل');
      }
      setAccounts([]);
      setMovements([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    loadAll();
  }, [storeLoading, loadAll]);

  const accountNameById = useMemo(() => {
    const m = new Map();
    for (const a of accounts) m.set(a.id, a.name_ar);
    return m;
  }, [accounts]);

  const submitExpense = async (e) => {
    e.preventDefault();
    if (!store?.id || !expenseFundId) return;
    const amt = parseAmount(expenseAmount);
    if (amt <= 0) {
      toast.warning('أدخل مبلغاً صحيحاً');
      return;
    }
    const fund = accounts.find((x) => x.id === expenseFundId);
    if (!fund) return;
    if (roundMoney(Number(fund.balance)) < amt) {
      toast.warning('الرصيد في هذا الصندوق غير كافٍ.');
      return;
    }
    setExpenseSaving(true);
    try {
      const prev = roundMoney(Number(fund.balance));
      const nextBal = roundMoney(prev - amt);
      const { error: uErr } = await supabase
        .from(FUND_ACCOUNTS_TABLE)
        .update({ balance: nextBal })
        .eq('id', expenseFundId)
        .eq('store_id', store.id);
      if (uErr) throw uErr;

      const { error: mErr } = await supabase.from(FUND_MOVEMENTS_TABLE).insert([
        {
          store_id: store.id,
          fund_account_id: expenseFundId,
          amount: amt,
          direction: 'out',
          kind: 'expense',
          expense_category: expenseCategory,
          description: expenseNote.trim() || EXPENSE_CATEGORIES.find((c) => c.value === expenseCategory)?.label || 'مصروف',
        },
      ]);
      if (mErr) {
        await supabase
          .from(FUND_ACCOUNTS_TABLE)
          .update({ balance: prev })
          .eq('id', expenseFundId)
          .eq('store_id', store.id);
        throw mErr;
      }

      setExpenseAmount('');
      setExpenseNote('');
      await loadAll();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'فشل تسجيل المصروف');
    } finally {
      setExpenseSaving(false);
    }
  };

  const submitTransfer = async (e) => {
    e.preventDefault();
    if (!store?.id || !fromFundId || !toFundId) return;
    if (fromFundId === toFundId) {
      toast.warning('اختر صندوقين مختلفين');
      return;
    }
    const amt = parseAmount(transferAmount);
    if (amt <= 0) {
      toast.warning('أدخل مبلغاً صحيحاً');
      return;
    }
    const fromAcc = accounts.find((x) => x.id === fromFundId);
    const toAcc = accounts.find((x) => x.id === toFundId);
    if (!fromAcc || !toAcc) return;
    if (roundMoney(Number(fromAcc.balance)) < amt) {
      toast.warning('رصيد الصندوق المصدر غير كافٍ.');
      return;
    }
    setTransferSaving(true);
    const batchId = crypto.randomUUID();
    const note = transferNote.trim() || 'تحويل بين الصناديق';
    const prevFrom = roundMoney(Number(fromAcc.balance));
    const prevTo = roundMoney(Number(toAcc.balance));

    try {
      const { error: u1 } = await supabase
        .from(FUND_ACCOUNTS_TABLE)
        .update({ balance: roundMoney(prevFrom - amt) })
        .eq('id', fromFundId)
        .eq('store_id', store.id);
      if (u1) throw u1;
      const { error: u2 } = await supabase
        .from(FUND_ACCOUNTS_TABLE)
        .update({ balance: roundMoney(prevTo + amt) })
        .eq('id', toFundId)
        .eq('store_id', store.id);
      if (u2) {
        await supabase
          .from(FUND_ACCOUNTS_TABLE)
          .update({ balance: prevFrom })
          .eq('id', fromFundId)
          .eq('store_id', store.id);
        throw u2;
      }

      const { error: mErr } = await supabase.from(FUND_MOVEMENTS_TABLE).insert([
        {
          store_id: store.id,
          fund_account_id: fromFundId,
          amount: amt,
          direction: 'out',
          kind: 'transfer',
          description: note,
          counterparty_fund_id: toFundId,
          transfer_batch_id: batchId,
        },
        {
          store_id: store.id,
          fund_account_id: toFundId,
          amount: amt,
          direction: 'in',
          kind: 'transfer',
          description: note,
          counterparty_fund_id: fromFundId,
          transfer_batch_id: batchId,
        },
      ]);
      if (mErr) {
        await supabase
          .from(FUND_ACCOUNTS_TABLE)
          .update({ balance: prevFrom })
          .eq('id', fromFundId)
          .eq('store_id', store.id);
        await supabase
          .from(FUND_ACCOUNTS_TABLE)
          .update({ balance: prevTo })
          .eq('id', toFundId)
          .eq('store_id', store.id);
        throw mErr;
      }

      setTransferAmount('');
      setTransferNote('');
      await loadAll();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'فشل التحويل');
    } finally {
      setTransferSaving(false);
    }
  };

  const submitOpeningAdjustment = async (e) => {
    e.preventDefault();
    if (!store?.id || !adjFundId) return;
    const amt = parseAmount(adjAmount);
    if (amt <= 0) {
      toast.warning('أدخل مبلغاً صحيحاً');
      return;
    }
    const fund = accounts.find((x) => x.id === adjFundId);
    if (!fund) return;
    setAdjSaving(true);
    const prev = roundMoney(Number(fund.balance));
    try {
      const { error: uErr } = await supabase
        .from(FUND_ACCOUNTS_TABLE)
        .update({ balance: roundMoney(prev + amt) })
        .eq('id', adjFundId)
        .eq('store_id', store.id);
      if (uErr) throw uErr;
      const { error: mErr } = await supabase.from(FUND_MOVEMENTS_TABLE).insert([
        {
          store_id: store.id,
          fund_account_id: adjFundId,
          amount: amt,
          direction: 'in',
          kind: 'adjustment',
          description: adjNote.trim() || 'تسوية رصيد / إيداع افتتاحي',
        },
      ]);
      if (mErr) {
        await supabase
          .from(FUND_ACCOUNTS_TABLE)
          .update({ balance: prev })
          .eq('id', adjFundId)
          .eq('store_id', store.id);
        throw mErr;
      }
      setAdjAmount('');
      setAdjNote('');
      await loadAll();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'فشل التسوية');
    } finally {
      setAdjSaving(false);
    }
  };

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
        <div className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center font-bold" dir="rtl">
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
            className="text-sm font-bold text-teal-700 hover:text-teal-900 dark:text-teal-400"
          >
            ← الصناديق والبنوك
          </Link>
          <Link
            to="/finance"
            className="text-sm font-bold text-violet-700 hover:text-violet-900 dark:text-violet-400"
          >
            ← الملخص المالي
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
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-700 dark:text-teal-400">
              <Landmark size={28} />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 dark:text-white">الصناديق والمالية</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed max-w-3xl">
                تتبّع أين يوجد النقد الآن عبر صناديق متعددة، وسجّل المصروفات التشغيلية (إيجار، كهرباء، رواتب) لخصمها
                من صافي الربح في التقارير، وحرّك الأموال بين كاش المحل والبنك.
              </p>
            </div>
          </div>
        </div>

        {initError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm font-bold text-amber-900 dark:text-amber-100">
            {initError}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-teal-500" size={36} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {accounts.map((a) => (
                <div
                  key={a.id}
                  className="rounded-2xl border border-slate-200/80 dark:border-white/10 bg-gradient-to-br from-white to-slate-50/80 dark:from-gray-900/80 dark:to-gray-900/40 p-5 shadow-sm"
                >
                  <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-wide">
                    <Wallet size={14} />
                    {a.name_ar}
                  </div>
                  <p className="text-2xl font-black font-currency text-teal-700 dark:text-teal-300 mt-2" dir="ltr" lang="en">
                    ₪{' '}
                    {roundMoney(Number(a.balance ?? 0)).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-2 font-bold">{a.code}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <form
                onSubmit={submitExpense}
                className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white/90 dark:bg-gray-900/40 p-5 space-y-4"
              >
                <div className="flex items-center gap-2 text-slate-900 dark:text-white font-black text-sm">
                  <MinusCircle className="text-rose-500" size={20} />
                  تسجيل مصروف
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  يُخصم من صندوق تختاره (غالباً كاش المحل) ويُستخدم في تقرير الأرباح كمصروف تشغيلي.
                </p>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">الصندوق</label>
                  <select
                    value={expenseFundId}
                    onChange={(e) => setExpenseFundId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-950 px-3 py-2.5 text-sm font-bold"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name_ar}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">التصنيف</label>
                  <select
                    value={expenseCategory}
                    onChange={(e) => setExpenseCategory(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-950 px-3 py-2.5 text-sm font-bold"
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">المبلغ ₪</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm font-currency bg-white dark:bg-gray-950"
                    dir="ltr"
                    lang="en"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">ملاحظة (اختياري)</label>
                  <input
                    type="text"
                    value={expenseNote}
                    onChange={(e) => setExpenseNote(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm"
                    placeholder="مثال: إيجار يناير"
                  />
                </div>
                <button
                  type="submit"
                  disabled={expenseSaving || !expenseFundId}
                  className="w-full rounded-xl bg-rose-600 text-white font-black py-3 hover:bg-rose-700 disabled:opacity-50"
                >
                  {expenseSaving ? <Loader2 className="animate-spin inline" size={18} /> : 'تسجيل المصروف'}
                </button>
              </form>

              <form
                onSubmit={submitTransfer}
                className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white/90 dark:bg-gray-900/40 p-5 space-y-4"
              >
                <div className="flex items-center gap-2 text-slate-900 dark:text-white font-black text-sm">
                  <ArrowLeftRight className="text-indigo-500" size={20} />
                  تحويل بين الصناديق
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  مثال: إيداع كاش المحل في البنك — يُنقص صندوق المصدر ويُزاد صندوق الوجهة.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">من</label>
                    <select
                      value={fromFundId}
                      onChange={(e) => setFromFundId(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-950 px-3 py-2.5 text-sm font-bold"
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name_ar}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">إلى</label>
                    <select
                      value={toFundId}
                      onChange={(e) => setToFundId(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-950 px-3 py-2.5 text-sm font-bold"
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name_ar}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">المبلغ ₪</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm font-currency bg-white dark:bg-gray-950"
                    dir="ltr"
                    lang="en"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">ملاحظة</label>
                  <input
                    type="text"
                    value={transferNote}
                    onChange={(e) => setTransferNote(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm"
                    placeholder="مثال: إيداع بنكي"
                  />
                </div>
                <button
                  type="submit"
                  disabled={transferSaving || fromFundId === toFundId}
                  className="w-full rounded-xl bg-indigo-600 text-white font-black py-3 hover:bg-indigo-700 disabled:opacity-50"
                >
                  {transferSaving ? <Loader2 className="animate-spin inline" size={18} /> : 'تنفيذ التحويل'}
                </button>
              </form>
            </div>

            <form
              onSubmit={submitOpeningAdjustment}
              className="rounded-2xl border border-dashed border-slate-300 dark:border-white/20 bg-slate-50/80 dark:bg-white/5 p-5 flex flex-wrap items-end gap-4"
            >
              <div className="flex-1 min-w-[200px]">
                <p className="text-xs font-black text-slate-700 dark:text-slate-300 mb-2">رصيد افتتاحي أو تسوية (+)</p>
                <p className="text-[11px] text-slate-500 mb-3">
                  تبدأ الأرصدة من صفر — سجّل هنا النقد الموجود فعلياً في الصندوق أو البنك.
                </p>
                <div className="flex flex-wrap gap-3 mt-2">
                  <select
                    value={adjFundId}
                    onChange={(e) => setAdjFundId(e.target.value)}
                    className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-gray-950 px-3 py-2 text-sm font-bold min-w-[140px]"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name_ar}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={adjAmount}
                    onChange={(e) => setAdjAmount(e.target.value)}
                    className="rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2 text-sm font-currency bg-white dark:bg-gray-950 w-32"
                    dir="ltr"
                    placeholder="المبلغ"
                  />
                  <input
                    type="text"
                    value={adjNote}
                    onChange={(e) => setAdjNote(e.target.value)}
                    className="flex-1 min-w-[160px] rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2 text-sm"
                    placeholder="ملاحظة"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={adjSaving || !adjFundId}
                className="rounded-xl bg-slate-600 text-white font-black px-6 py-2.5 hover:bg-slate-700 disabled:opacity-50 shrink-0"
              >
                {adjSaving ? <Loader2 className="animate-spin inline" size={18} /> : 'تسجيل الإيداع'}
              </button>
            </form>

            <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white/90 dark:bg-gray-900/40 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-white/10 flex items-center gap-2 bg-slate-50/80 dark:bg-white/5">
                <History size={18} className="text-slate-500" />
                <h2 className="font-black text-slate-900 dark:text-white text-sm">آخر الحركات</h2>
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
                          لا حركات بعد
                        </td>
                      </tr>
                    ) : (
                      movements.map((m) => {
                        const fundName = accountNameById.get(m.fund_account_id) || '—';
                        const other =
                          m.counterparty_fund_id && accountNameById.get(m.counterparty_fund_id);
                        const cat =
                          m.expense_category &&
                          EXPENSE_CATEGORIES.find((c) => c.value === m.expense_category)?.label;
                        return (
                          <tr key={m.id} className="border-b border-slate-50 dark:border-white/5 hover:bg-slate-50/50 dark:hover:bg-white/5">
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
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
