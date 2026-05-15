import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  Landmark,
  Building2,
  Wallet,
  ArrowLeft,
  Info,
  Pencil,
  Check,
  X,
  Banknote,
  Receipt,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { roundMoney } from '../utils/productModel';
import { FUND_ACCOUNTS_TABLE, ensureDefaultFundAccounts } from '../utils/fundAccounts';

const VOUCHERS_TABLE = import.meta.env.VITE_SUPABASE_VOUCHERS_TABLE?.trim() || 'vouchers';
const CONTACTS_TABLE = 'store_contacts';

function parseCheckLinesRaw(v) {
  const raw = v?.check_lines;
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function isPendingCollectionVoucher(v) {
  const t = String(v.voucher_tender || '').toLowerCase();
  const lines = parseCheckLinesRaw(v);
  if (t === 'checks' || t === 'mixed' || lines.length > 0) return true;
  // سندات حُفظت قبل تفعيل أعمدة tender/check_lines — الوصف يحتوي تفاصيل الشيكات
  const desc = String(v.description || '');
  if (/\[تفاصيل الشيكات\]/i.test(desc)) return true;
  if (/\[طريقة الدفع:\s*شيكات\]/i.test(desc)) return true;
  if (/\[طريقة الدفع:\s*كاش\s*\+\s*شيكات\]/i.test(desc)) return true;
  return false;
}

function formatShekels(n) {
  return roundMoney(Number(n ?? 0)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** تصنيف الحساب للعرض — يعتمد على code (مخزّن في قاعدة البيانات) */
function classifyByCode(code) {
  const c = String(code || '');
  if (c === 'cash_shop') return { key: 'cash', label: 'صندوق نقدي', icon: Wallet, tone: 'emerald' };
  if (c === 'bank') return { key: 'bank', label: 'حساب بنكي', icon: Building2, tone: 'sky' };
  if (c === 'employee_petty') return { key: 'petty', label: 'عهدة / صندوق فرعي', icon: Banknote, tone: 'amber' };
  return { key: 'other', label: 'حساب آخر', icon: Landmark, tone: 'slate' };
}

export default function FundAccountsPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [nameDrafts, setNameDrafts] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [savingId, setSavingId] = useState(null);
  /** سندات قبض بشيكات — لم تُودَع بعد نقداً في الصندوق */
  const [pendingChecks, setPendingChecks] = useState([]);
  /** فشل جلب جدول vouchers (أعمدة ناقصة / RLS / الجدول غير موجود) */
  const [vouchersFetchError, setVouchersFetchError] = useState(null);

  const loadAll = useCallback(async () => {
    if (!store?.id) {
      setAccounts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setInitError(null);
    setVouchersFetchError(null);
    try {
      await ensureDefaultFundAccounts(supabase, store.id);
      const { data: acc, error: aErr } = await supabase
        .from(FUND_ACCOUNTS_TABLE)
        .select('id, code, name_ar, balance, sort_order')
        .eq('store_id', store.id)
        .order('sort_order', { ascending: true });
      if (aErr) throw aErr;
      const list = acc || [];
      setAccounts(list);
      setNameDrafts((prev) => {
        const next = { ...prev };
        for (const row of list) {
          if (next[row.id] === undefined) next[row.id] = row.name_ar || '';
        }
        return next;
      });

      const { data: voucherRows, error: vouchersErr } = await supabase
        .from(VOUCHERS_TABLE)
        .select('*')
        .eq('store_id', store.id)
        .eq('voucher_type', 'receipt')
        .order('date', { ascending: false });
      if (vouchersErr) {
        console.warn('[funds] vouchers', vouchersErr);
        setVouchersFetchError(vouchersErr.message || String(vouchersErr));
        setPendingChecks([]);
      } else {
        const { data: contactRows } = await supabase
          .from(CONTACTS_TABLE)
          .select('id, name')
          .eq('store_id', store.id);

        const nameById = Object.fromEntries((contactRows || []).map((c) => [c.id, c.name]));

        const pending = (voucherRows || [])
          .filter(isPendingCollectionVoucher)
          .map((v) => {
            const pid = v.account_id || v.supplier_contact_id || v.supplier_id;
            return {
              ...v,
              partyName: pid ? nameById[String(pid)] || '—' : '—',
            };
          });
        setPendingChecks(pending);
      }
    } catch (e) {
      console.error(e);
      const msg = e.message || '';
      if (/does not exist|schema cache|PGRST205|42P01/i.test(msg)) {
        setInitError('جدول الصناديق غير مُنشأ. نفّذ store_fund_accounts.sql في Supabase.');
      } else {
        setInitError(msg || 'تعذّر التحميل');
      }
      setAccounts([]);
      setPendingChecks([]);
      setVouchersFetchError(null);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    loadAll();
  }, [storeLoading, loadAll]);

  const counts = useMemo(() => {
    let cash = 0;
    let bank = 0;
    let petty = 0;
    let other = 0;
    for (const a of accounts) {
      const c = classifyByCode(a.code);
      if (c.key === 'cash') cash += 1;
      else if (c.key === 'bank') bank += 1;
      else if (c.key === 'petty') petty += 1;
      else other += 1;
    }
    const totalLiquidity = accounts.reduce((s, a) => s + Math.max(0, Number(a.balance ?? 0)), 0);
    return {
      cash,
      bank,
      petty,
      other,
      total: accounts.length,
      totalLiquidity: roundMoney(totalLiquidity),
    };
  }, [accounts]);

  const saveName = async (id) => {
    if (!store?.id) return;
    const name = String(nameDrafts[id] ?? '').trim();
    if (!name) {
      toast.warning('أدخل اسماً للحساب.');
      return;
    }
    setSavingId(id);
    try {
      const { error } = await supabase
        .from(FUND_ACCOUNTS_TABLE)
        .update({ name_ar: name })
        .eq('id', id)
        .eq('store_id', store.id);
      if (error) throw error;
      setEditingId(null);
      await loadAll();
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'فشل حفظ الاسم');
    } finally {
      setSavingId(null);
    }
  };

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
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <Link
            to="/finance/cashflow"
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-black text-white hover:bg-teal-700 shadow-sm"
          >
            <Landmark size={18} />
            تسجيل الحركات والمصروفات
          </Link>
          <Link
            to="/finance"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <ArrowLeft size={18} />
            المالية والمصروفات
          </Link>
        </div>
      }
    >
      <div className="max-w-5xl mx-auto space-y-8" dir="rtl">
        <header className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-600 to-emerald-700 flex items-center justify-center text-white shadow-lg shadow-teal-500/20">
              <Landmark size={26} strokeWidth={2} />
            </div>
            <div>
              <h1 className="font-title text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                الصناديق والبنوك
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 font-bold mt-0.5">
                عرض كل حسابات السيولة للمتجر: صناديق نقدية، بنوك، وعهدة — مع إمكانية تسمية كل حساب (مثلاً اسم البنك).
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-teal-100 bg-teal-50/70 dark:border-teal-900/40 dark:bg-teal-950/25 px-4 py-3 flex gap-3 items-start">
            <Info className="shrink-0 text-teal-700 dark:text-teal-400 mt-0.5" size={18} />
            <p className="text-xs font-bold text-teal-950 dark:text-teal-100/90 leading-relaxed">
              النظام الافتراضي يوفّر <strong>حساباً نقدياً واحداً</strong> و<strong>حساب بنكي واحداً</strong> و<strong>عهدة</strong> لكل
              متجر (رمز داخلي: <code className="px-1 rounded bg-white/70 dark:bg-teal-900/50">cash_shop</code>،{' '}
              <code className="px-1 rounded bg-white/70 dark:bg-teal-900/50">bank</code>، إلخ). عدّل الاسم الظاهر ليعكس البنك أو
              نقطة الصندوق الفعلية. لإضافة حسابات إضافية لاحقاً لازم توسيع المخطط في قاعدة البيانات.
            </p>
          </div>
        </header>

        {initError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm font-bold text-amber-950 dark:text-amber-100">
            {initError}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 rounded-2xl border border-slate-200/80 bg-white dark:border-gray-700/50 dark:bg-gray-900/70">
            <Loader2 className="animate-spin text-teal-500 dark:text-teal-400" size={40} />
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400">جاري تحميل الحسابات…</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="rounded-2xl border border-slate-200/90 bg-white p-4 dark:border-white/10 dark:bg-gray-900/70 shadow-sm">
                <p className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">إجمالي السيولة</p>
                <p className="text-xl font-black font-currency text-slate-900 dark:text-white mt-1" dir="ltr">
                  ₪{formatShekels(counts.totalLiquidity)}
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-200/60 bg-emerald-50/70 dark:bg-emerald-950/25 dark:border-emerald-900/40 p-4">
                <p className="text-[10px] font-black text-emerald-800 dark:text-emerald-300">صناديق نقدية</p>
                <p className="text-2xl font-black text-emerald-900 dark:text-emerald-100 mt-1" dir="ltr">
                  {counts.cash}
                </p>
                <p className="text-[10px] text-emerald-700/80 dark:text-emerald-400/90 mt-0.5">حساب كاش المحل</p>
              </div>
              <div className="rounded-2xl border border-sky-200/60 bg-sky-50/70 dark:bg-sky-950/25 dark:border-sky-900/40 p-4">
                <p className="text-[10px] font-black text-sky-800 dark:text-sky-300">حسابات بنكية</p>
                <p className="text-2xl font-black text-sky-900 dark:text-sky-100 mt-1" dir="ltr">
                  {counts.bank}
                </p>
                <p className="text-[10px] text-sky-700/80 dark:text-sky-400/90 mt-0.5">البنوك التي تتعامل معها</p>
              </div>
              <div className="rounded-2xl border border-amber-200/60 bg-amber-50/70 dark:bg-amber-950/25 dark:border-amber-900/40 p-4">
                <p className="text-[10px] font-black text-amber-900 dark:text-amber-300">عهدة / أخرى</p>
                <p className="text-2xl font-black text-amber-950 dark:text-amber-100 mt-1" dir="ltr">
                  {counts.petty + counts.other}
                </p>
                <p className="text-[10px] text-amber-800/80 dark:text-amber-400/90 mt-0.5">إجمالي عدد الحسابات: {counts.total}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white dark:border-gray-700/50 dark:bg-gray-900/70 overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-white/10 bg-slate-50/90 dark:bg-white/5">
                <h2 className="font-black text-slate-900 dark:text-white text-sm">تفاصيل الحسابات</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[520px]">
                  <thead>
                    <tr className="bg-slate-100/90 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 text-right">
                      <th className="py-3 px-4 font-black">النوع</th>
                      <th className="py-3 px-4 font-black">الاسم الظاهر</th>
                      <th className="py-3 px-4 font-black font-mono text-xs" dir="ltr">
                        الرمز (داخلي)
                      </th>
                      <th className="py-3 px-4 font-black text-center" dir="ltr">
                        الرصيد ₪
                      </th>
                      <th className="py-3 px-4 font-black w-32">تعديل الاسم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-slate-500 dark:text-slate-400 font-bold">
                          لا توجد حسابات.
                        </td>
                      </tr>
                    ) : (
                      accounts.map((a) => {
                        const meta = classifyByCode(a.code);
                        const Icon = meta.icon;
                        const isEditing = editingId === a.id;
                        return (
                          <tr
                            key={a.id}
                            className="border-b border-slate-100 dark:border-slate-700/80 odd:bg-white even:bg-slate-50/50 dark:odd:bg-gray-900/40 dark:even:bg-slate-800/30"
                          >
                            <td className="py-3 px-4">
                              <span
                                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black ${
                                  meta.tone === 'emerald'
                                    ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200'
                                    : meta.tone === 'sky'
                                      ? 'bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200'
                                      : meta.tone === 'amber'
                                        ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200'
                                        : 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200'
                                }`}
                              >
                                <Icon size={14} className="shrink-0" />
                                {meta.label}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={nameDrafts[a.id] ?? ''}
                                  onChange={(e) =>
                                    setNameDrafts((prev) => ({ ...prev, [a.id]: e.target.value }))
                                  }
                                  className="w-full max-w-[220px] rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
                                  dir="rtl"
                                  autoFocus
                                />
                              ) : (
                                <span title={a.name_ar}>{a.name_ar || '—'}</span>
                              )}
                            </td>
                            <td className="py-3 px-4 font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                              {a.code}
                            </td>
                            <td className="py-3 px-4 text-center font-black font-currency text-slate-900 dark:text-white" dir="ltr">
                              {formatShekels(a.balance)}
                            </td>
                            <td className="py-3 px-4">
                              {isEditing ? (
                                <div className="flex items-center gap-1 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => saveName(a.id)}
                                    disabled={savingId === a.id}
                                    className="p-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                                    title="حفظ"
                                  >
                                    {savingId === a.id ? (
                                      <Loader2 className="animate-spin" size={16} />
                                    ) : (
                                      <Check size={16} />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingId(null);
                                      setNameDrafts((prev) => ({ ...prev, [a.id]: a.name_ar || '' }));
                                    }}
                                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-white/5"
                                    title="إلغاء"
                                  >
                                    <X size={16} />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setEditingId(a.id)}
                                  className="inline-flex items-center gap-1 text-xs font-black text-indigo-600 hover:underline dark:text-indigo-400"
                                >
                                  <Pencil size={14} />
                                  تعديل
                                </button>
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

            <div className="rounded-2xl border border-amber-200/80 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20 overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-amber-100 dark:border-amber-900/40 bg-amber-100/50 dark:bg-amber-950/40 flex flex-wrap items-center gap-2">
                <Receipt className="text-amber-800 dark:text-amber-300 shrink-0" size={20} />
                <h2 className="font-black text-amber-950 dark:text-amber-100 text-sm">
                  شيكات قيد التحصيل (سندات قبض بالشيك)
                </h2>
              </div>
              <div className="p-4">
                {pendingChecks.length === 0 ? (
                  <div className="space-y-2">
                    {vouchersFetchError ? (
                      <p className="text-sm font-bold text-rose-800 dark:text-rose-200/90">
                        تعذّر قراءة جدول السندات ({VOUCHERS_TABLE}): {vouchersFetchError}. نفّذ{' '}
                        <code className="text-xs bg-white/60 dark:bg-black/20 px-1 rounded">vouchers.sql</code> وملفات
                        التوسعة إن لزم، أو راجع صلاحيات RLS.
                      </p>
                    ) : (
                      <p className="text-sm font-bold text-amber-900/80 dark:text-amber-200/90">
                        لا توجد سندات قبض <span className="text-amber-950 dark:text-amber-100">بالشيك أو مختلط (كاش+شيك)</span>{' '}
                        لهذا المتجر. سجّل من صفحة{' '}
                        <Link to="/vouchers" className="text-amber-800 underline dark:text-amber-300">
                          سندات القبض والصرف
                        </Link>{' '}
                        مع اختيار طريقة دفع «شيكات» أو «مختلط» (أو فعّل أعمدة الشيكات في Supabase إن كانت السندات القديمة
                        تظهر في الوصف فقط).
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-amber-100 dark:border-amber-900/30">
                    <table className="w-full text-sm min-w-[640px] text-right">
                      <thead>
                        <tr className="bg-amber-200/60 dark:bg-amber-950/60 text-amber-950 dark:text-amber-100">
                          <th className="py-2 px-3 font-black">التاريخ</th>
                          <th className="py-2 px-3 font-black">الطرف</th>
                          <th className="py-2 px-3 font-black text-center" dir="ltr">
                            المبلغ
                          </th>
                          <th className="py-2 px-3 font-black">الشيكات</th>
                          <th className="py-2 px-3 font-black w-24">مرجع</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingChecks.map((v) => {
                          const lines = parseCheckLinesRaw(v);
                          const sym =
                            v.currency_code === 'JOD' ? 'د.أ' : v.currency_code === 'USD' ? '$' : '₪';
                          return (
                            <tr
                              key={v.id}
                              className="border-b border-amber-100/80 odd:bg-white even:bg-amber-50/40 dark:border-amber-900/25 dark:odd:bg-slate-900/40 dark:even:bg-slate-800/30"
                            >
                              <td className="py-2 px-3 font-currency whitespace-nowrap" dir="ltr">
                                {v.date || String(v.created_at || '').slice(0, 10)}
                              </td>
                              <td className="py-2 px-3 font-bold text-slate-900 dark:text-slate-100">
                                {v.partyName}
                              </td>
                              <td className="py-2 px-3 text-center font-black font-currency" dir="ltr">
                                {sym}
                                {Number(v.amount ?? 0).toFixed(2)}
                              </td>
                              <td className="py-2 px-3 text-xs font-bold text-slate-700 dark:text-slate-300">
                                {lines.length === 0 ? (
                                  <span className="text-amber-800 dark:text-amber-300">شيكات — راجع وصف السند</span>
                                ) : (
                                  <ul className="space-y-1">
                                    {lines.map((ln, i) => (
                                      <li key={i} dir="rtl">
                                        #{ln.check_number ?? '—'} — {ln.bank_name ?? '—'} —{' '}
                                        <span dir="ltr" className="font-currency">
                                          {sym}
                                          {ln.amount != null ? Number(ln.amount).toFixed(2) : '—'} — {ln.check_date ?? ''}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                              <td className="py-2 px-3 font-mono text-[11px]" dir="ltr">
                                {String(v.id).slice(0, 8)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="mt-3 text-[11px] font-bold text-amber-900/75 dark:text-amber-200/80 leading-relaxed">
                  هذه الشيكات تُظهر المبالغ المستحقة التحصيل لاحقاً؛ الرصيد النقدي في الصناديق أعلاه لا يشملها حتى يتم خصمها نقداً أو
                  تسويتها يدوياً عند التحصيل.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 justify-center sm:justify-start">
              <Link
                to="/finance/cashflow"
                className="inline-flex items-center gap-2 rounded-2xl bg-teal-600 text-white px-4 py-2.5 text-sm font-black hover:bg-teal-700"
              >
                الانتقال لتسجيل مصروف أو تحويل بين صناديق
                <ArrowLeft size={18} className="rotate-180" />
              </Link>
              <Link
                to="/finance/center"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-white/10 px-4 py-2.5 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
              >
                المركز المالي
              </Link>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
