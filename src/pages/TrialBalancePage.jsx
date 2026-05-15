import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  Scale,
  BookOpen,
  Info,
  RefreshCw,
  TrendingUp,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { roundMoney } from '../utils/productModel';
import { FUND_ACCOUNTS_TABLE, ensureDefaultFundAccounts } from '../utils/fundAccounts';

const JEL = 'journal_entry_lines';
const JE  = 'journal_entries';
const CONTACTS = 'store_contacts';

function fmt(n) {
  return roundMoney(Number(n ?? 0)).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

/** حساب قيمة المخزن — صفحة بصفحة لأي حجم */
async function sumInventoryValue(supabaseClient, storeId) {
  const PAGE = 1000;
  let from = 0, total = 0;
  for (;;) {
    const { data, error } = await supabaseClient
      .from(PRODUCTS_TABLE).select('stock_count, full_price')
      .eq('store_id', storeId).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data)
      total += Math.max(0, Number(r.stock_count ?? 0)) * Math.max(0, Number(r.full_price ?? 0));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return roundMoney(total);
}

async function sumContactOutstanding(supabaseClient, storeId, role) {
  const { data, error } = await supabaseClient
    .from(CONTACTS).select('outstanding_amount')
    .eq('store_id', storeId).eq('role', role);
  if (error) throw error;
  return roundMoney((data || []).reduce((s, r) => s + Math.max(0, Number(r.outstanding_amount ?? 0)), 0));
}

async function sumFundBalances(supabaseClient, storeId) {
  await ensureDefaultFundAccounts(supabaseClient, storeId);
  const { data, error } = await supabaseClient
    .from(FUND_ACCOUNTS_TABLE).select('id, code, name_ar, balance')
    .eq('store_id', storeId).order('sort_order', { ascending: true });
  if (error) throw error;
  const rows = (data || []).map((a) => ({
    id: a.id, name: a.name_ar || a.code,
    balance: roundMoney(Math.max(0, Number(a.balance ?? 0))),
  }));
  const total = roundMoney(rows.reduce((s, r) => s + r.balance, 0));
  return { rows, total };
}

/** قراءة مجاميع مدين/دائن من journal_entry_lines إن كانت موجودة */
async function tryJournalTotals(supabaseClient, storeId) {
  try {
    const { data: entries, error: eErr } = await supabaseClient
      .from(JE).select('id')
      .eq('store_id', storeId).limit(1);
    if (eErr || !entries?.length) return null;
    const { data, error } = await supabaseClient
      .from(JEL).select('account_code, account_name, debit, credit')
      .in('entry_id',
        (await supabaseClient.from(JE).select('id').eq('store_id', storeId).limit(2000)).data?.map((x) => x.id) ?? []
      );
    if (error) return null;
    const byCode = {};
    for (const l of data || []) {
      if (!byCode[l.account_code]) byCode[l.account_code] = { code: l.account_code, name: l.account_name, debit: 0, credit: 0 };
      byCode[l.account_code].debit  += Number(l.debit  ?? 0);
      byCode[l.account_code].credit += Number(l.credit ?? 0);
    }
    return Object.values(byCode).sort((a, b) => a.code.localeCompare(b.code));
  } catch {
    return null;
  }
}

const SECTION_ORDER = ['1001','1002','1100','1200','2100','4001','5001','6001'];

export default function TrialBalancePage() {
  const { store, loading: storeLoading } = useStore();
  const [loading, setLoading] = useState(true);
  const [data, setData]       = useState(null);
  const [errors, setErrors]   = useState({});

  const load = useCallback(async () => {
    if (!store?.id) { setLoading(false); return; }
    setLoading(true);
    const errs = {};

    let inv = 0, funds = { rows: [], total: 0 }, ar = 0, ap = 0, journalRows = null;
    try { inv = await sumInventoryValue(supabase, store.id); } catch (e) { errs.inv = e.message; }
    try { funds = await sumFundBalances(supabase, store.id); } catch (e) { errs.funds = e.message; }
    try { ar = await sumContactOutstanding(supabase, store.id, 'customer'); } catch (e) { errs.ar = e.message; }
    try { ap = await sumContactOutstanding(supabase, store.id, 'supplier'); } catch (e) { errs.ap = e.message; }
    try { journalRows = await tryJournalTotals(supabase, store.id); } catch { /* optional */ }

    setData({ inv, funds, ar, ap, journalRows });
    setErrors(errs);
    setLoading(false);
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    load();
  }, [storeLoading, load]);

  const computed = useMemo(() => {
    if (!data) return null;
    const assets = roundMoney(data.inv + data.funds.total + data.ar);
    const liabilities = roundMoney(data.ap);
    const equity = roundMoney(assets - liabilities);
    return { assets, liabilities, equity };
  }, [data]);

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/finance/journal"
            className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-black text-indigo-900 hover:bg-indigo-100 dark:border-indigo-800/50 dark:bg-indigo-950/40 dark:text-indigo-100"
          >
            <BookOpen size={18} />
            دفتر القيود اليومية
          </Link>
          <button type="button" onClick={load}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 text-white px-4 py-2.5 text-sm font-black hover:bg-indigo-700"
          >
            <RefreshCw size={18} />
            تحديث
          </button>
        </div>
      }
    >
      <div className="max-w-5xl mx-auto space-y-8" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center text-white shadow-lg shadow-violet-500/20">
            <Scale size={26} />
          </div>
          <div>
            <h1 className="font-title text-2xl font-black text-slate-900 dark:text-white">ميزان المراجعة اللحظي</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 font-bold mt-0.5">
              أصول الشركة مقابل الخصوم — المركز المالي الحقيقي الآن
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="animate-spin text-violet-500 dark:text-violet-400" size={40} />
            <p className="text-sm font-bold text-slate-500">جاري إعداد الميزان…</p>
          </div>
        ) : computed ? (
          <>
            {/* ملخص صافي */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: 'إجمالي الأصول', value: computed.assets,      bg: 'from-emerald-50 to-emerald-100/40 dark:from-emerald-950/30 dark:to-emerald-950/10', border: 'border-emerald-200/70 dark:border-emerald-800/50', text: 'text-emerald-900 dark:text-emerald-100', icon: <TrendingUp size={22} className="text-emerald-600 dark:text-emerald-300" /> },
                { label: 'إجمالي الخصوم', value: computed.liabilities, bg: 'from-rose-50 to-rose-100/40 dark:from-rose-950/30 dark:to-rose-950/10',     border: 'border-rose-200/70 dark:border-rose-800/50',     text: 'text-rose-900 dark:text-rose-100',     icon: <AlertTriangle size={22} className="text-rose-600 dark:text-rose-300" /> },
                { label: 'صافي القيمة (حقوق الملكية)', value: computed.equity, bg: 'from-violet-50 to-violet-100/40 dark:from-violet-950/30 dark:to-violet-950/10', border: 'border-violet-200/70 dark:border-violet-800/50', text: computed.equity >= 0 ? 'text-violet-900 dark:text-violet-100' : 'text-rose-700 dark:text-rose-300', icon: <ShieldCheck size={22} className="text-violet-600 dark:text-violet-300" /> },
              ].map((card) => (
                <div key={card.label} className={`rounded-2xl border p-5 bg-gradient-to-br shadow-sm ${card.bg} ${card.border}`}>
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wide">{card.label}</p>
                    {card.icon}
                  </div>
                  <p className={`text-3xl font-black font-currency tracking-tight ${card.text}`} dir="ltr">
                    ₪{fmt(card.value)}
                  </p>
                </div>
              ))}
            </div>

            {/* جدول الأصول */}
            <section>
              <h2 className="font-black text-lg text-emerald-800 dark:text-emerald-300 mb-3 flex items-center gap-2">
                <TrendingUp size={20} />
                الأصول التشغيلية
              </h2>
              <div className="rounded-2xl border border-emerald-200/70 dark:border-emerald-800/50 overflow-hidden">
                <table className="w-full text-sm text-right">
                  <thead>
                    <tr className="bg-emerald-700 text-white">
                      <th className="py-3 px-4 font-black">البند</th>
                      <th className="py-3 px-4 font-black">التفاصيل</th>
                      <th className="py-3 px-4 font-black text-center" dir="ltr">المبلغ ₪</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* الصناديق */}
                    {data.funds.rows.map((f) => (
                      <tr key={f.id} className="border-t border-emerald-100 dark:border-emerald-900/40 odd:bg-white even:bg-emerald-50/30 dark:odd:bg-gray-900/40 dark:even:bg-emerald-950/20">
                        <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-100">{f.name}</td>
                        <td className="py-3 px-4 text-slate-500 dark:text-slate-400 text-xs">سيولة — صندوق / بنك</td>
                        <td className="py-3 px-4 text-center font-currency font-black text-emerald-900 dark:text-emerald-100" dir="ltr">
                          {fmt(f.balance)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-emerald-100 dark:border-emerald-900/40 odd:bg-white even:bg-emerald-50/30 dark:odd:bg-gray-900/40 dark:even:bg-emerald-950/20">
                      <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-100">المخزون</td>
                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400 text-xs">كمية × تكلفة مرجّحة (full_price)</td>
                      <td className="py-3 px-4 text-center font-currency font-black text-emerald-900 dark:text-emerald-100" dir="ltr">
                        {fmt(data.inv)}
                      </td>
                    </tr>
                    <tr className="border-t border-emerald-100 dark:border-emerald-900/40 odd:bg-white even:bg-emerald-50/30 dark:odd:bg-gray-900/40 dark:even:bg-emerald-950/20">
                      <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-100">ذمم المدينون</td>
                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400 text-xs">مستحقات الزبائن الآجلين</td>
                      <td className="py-3 px-4 text-center font-currency font-black text-emerald-900 dark:text-emerald-100" dir="ltr">
                        {fmt(data.ar)}
                      </td>
                    </tr>
                    <tr className="bg-emerald-100 dark:bg-emerald-900/40 border-t-2 border-emerald-300 dark:border-emerald-700">
                      <td colSpan={2} className="py-3 px-4 font-black text-emerald-900 dark:text-emerald-100">إجمالي الأصول</td>
                      <td className="py-3 px-4 text-center font-black font-currency text-2xl text-emerald-900 dark:text-emerald-100" dir="ltr">
                        ₪{fmt(computed.assets)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* جدول الخصوم */}
            <section>
              <h2 className="font-black text-lg text-rose-700 dark:text-rose-300 mb-3 flex items-center gap-2">
                <AlertTriangle size={20} />
                الخصوم
              </h2>
              <div className="rounded-2xl border border-rose-200/70 dark:border-rose-800/50 overflow-hidden">
                <table className="w-full text-sm text-right">
                  <thead>
                    <tr className="bg-rose-700 text-white">
                      <th className="py-3 px-4 font-black">البند</th>
                      <th className="py-3 px-4 font-black">التفاصيل</th>
                      <th className="py-3 px-4 font-black text-center" dir="ltr">المبلغ ₪</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-white dark:bg-gray-900/40">
                      <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-100">ذمم الدائنون</td>
                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400 text-xs">مستحقات الموردين الآجلين</td>
                      <td className="py-3 px-4 text-center font-currency font-black text-rose-800 dark:text-rose-200" dir="ltr">
                        {fmt(data.ap)}
                      </td>
                    </tr>
                    <tr className="bg-rose-100 dark:bg-rose-900/40 border-t-2 border-rose-300 dark:border-rose-700">
                      <td colSpan={2} className="py-3 px-4 font-black text-rose-900 dark:text-rose-100">إجمالي الخصوم</td>
                      <td className="py-3 px-4 text-center font-black font-currency text-2xl text-rose-900 dark:text-rose-100" dir="ltr">
                        ₪{fmt(computed.liabilities)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* ميزان التحقق */}
            <div className={`relative overflow-hidden rounded-3xl border-2 p-8 ${
              computed.equity >= 0
                ? 'border-violet-200/90 bg-gradient-to-br from-violet-50 via-white to-indigo-50/80 dark:border-violet-800/50 dark:from-violet-950/40 dark:via-gray-900/90 dark:to-indigo-950/30'
                : 'border-rose-200/90 bg-rose-50/80 dark:border-rose-800/50 dark:bg-rose-950/30'
            }`}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="text-violet-600 dark:text-violet-300" size={22} />
                    <h3 className="font-title text-lg font-black text-slate-900 dark:text-white">صافي القيمة (حقوق الملكية)</h3>
                  </div>
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-400 font-mono" dir="ltr">
                    ₪{fmt(computed.assets)} (أصول) − ₪{fmt(computed.liabilities)} (خصوم)
                  </p>
                </div>
                <p className={`text-5xl font-black font-currency tracking-tight ${
                  computed.equity >= 0 ? 'text-violet-700 dark:text-violet-200' : 'text-rose-700 dark:text-rose-300'
                }`} dir="ltr">
                  ₪{fmt(computed.equity)}
                </p>
              </div>
            </div>

            {/* ميزان القيود اليومية (إن وُجد) */}
            {data.journalRows?.length > 0 && (
              <section>
                <h2 className="font-black text-sm text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                  <BookOpen size={18} className="text-indigo-500" />
                  ميزان المراجعة من القيود اليومية (مدين / دائن بالحساب)
                </h2>
                <div className="rounded-2xl border border-indigo-200/60 dark:border-indigo-800/40 overflow-hidden">
                  <table className="w-full text-sm text-right">
                    <thead>
                      <tr className="bg-indigo-700 text-white">
                        <th className="py-2.5 px-4 font-black w-20">كود</th>
                        <th className="py-2.5 px-4 font-black">اسم الحساب</th>
                        <th className="py-2.5 px-4 font-black text-center" dir="ltr">مجموع مدين ₪</th>
                        <th className="py-2.5 px-4 font-black text-center" dir="ltr">مجموع دائن ₪</th>
                        <th className="py-2.5 px-4 font-black text-center" dir="ltr">رصيد ₪</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.journalRows.map((r, i) => {
                        const bal = roundMoney(r.debit - r.credit);
                        return (
                          <tr key={r.code} className="border-t border-indigo-100 dark:border-indigo-900/40 odd:bg-white even:bg-indigo-50/25 dark:odd:bg-gray-900/30 dark:even:bg-indigo-950/20">
                            <td className="py-2.5 px-4 font-mono text-slate-500 dark:text-slate-400">{r.code}</td>
                            <td className="py-2.5 px-4 font-bold text-slate-800 dark:text-slate-100">{r.name}</td>
                            <td className="py-2.5 px-4 text-center font-currency font-bold text-emerald-800 dark:text-emerald-300" dir="ltr">{fmt(r.debit)}</td>
                            <td className="py-2.5 px-4 text-center font-currency font-bold text-rose-700 dark:text-rose-300" dir="ltr">{fmt(r.credit)}</td>
                            <td className={`py-2.5 px-4 text-center font-currency font-black ${bal >= 0 ? 'text-emerald-900 dark:text-emerald-200' : 'text-rose-700 dark:text-rose-300'}`} dir="ltr">
                              {fmt(Math.abs(bal))} {bal < 0 ? 'د' : 'م'}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="border-t-2 border-indigo-300 dark:border-indigo-700 bg-indigo-100/80 dark:bg-indigo-900/40 font-black text-slate-900 dark:text-white">
                        <td colSpan={2} className="py-2.5 px-4 text-left text-xs">الإجمالي</td>
                        <td className="py-2.5 px-4 text-center font-currency" dir="ltr">
                          {fmt(data.journalRows.reduce((s, r) => s + r.debit, 0))}
                        </td>
                        <td className="py-2.5 px-4 text-center font-currency" dir="ltr">
                          {fmt(data.journalRows.reduce((s, r) => s + r.credit, 0))}
                        </td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
