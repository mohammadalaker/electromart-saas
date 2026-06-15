import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Scale,
  BookOpen,
  TrendingUp,
  Landmark,
  ArrowLeft,
  Loader2,
  RefreshCw,
  FolderTree,
  FileText,
  FileSpreadsheet,
  BarChart3,
  Coins,
  ChevronLeft,
  CheckCircle,
} from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { supabase } from '../../lib/supabaseClient';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';
import { roundMoney } from '../../utils/productModel';

const NAV_CARDS = [
  {
    to: '/finance/accounts',
    icon: FolderTree,
    title: 'دليل الحسابات',
    description: 'إدارة شجرة الحسابات المالية وتصنيفاتها هرمياً (أصول، خصوم، حقوق ملكية، إيرادات، مصروفات).',
    colorClass: 'text-indigo-600 bg-indigo-50 border-indigo-100',
  },
  {
    to: '/finance/journal',
    icon: FileText,
    title: 'القيود اليومية',
    description: 'تسجيل وترحيل قيود اليومية المزدوجة، مراجعة وتعديل مسودات القيود وحفظ الحركات.',
    colorClass: 'text-emerald-600 bg-emerald-50 border-emerald-100',
  },
  {
    to: '/finance/ledger',
    icon: FileSpreadsheet,
    title: 'الأستاذ العام',
    description: 'كشوف تفصيلية حرة لكل حساب مالي بالأرصدة التراكمية التاريخية مع فلاتر مخصصة.',
    colorClass: 'text-amber-600 bg-amber-50 border-amber-100',
  },
  {
    to: '/finance/trial-balance',
    icon: Scale,
    title: 'ميزان المراجعة',
    description: 'موازنة الحركات والتحقق المباشر من تطابق الأرصدة المدينة والدائنة الإجمالية.',
    colorClass: 'text-sky-600 bg-sky-50 border-sky-100',
  },
  {
    to: '/finance/profit-loss',
    icon: TrendingUp,
    title: 'قائمة الأرباح والخسائر',
    description: 'قياس الأداء التشغيلي بمقارنة الإيرادات بالمصروفات واحتساب صافي هامش الربح.',
    colorClass: 'text-violet-600 bg-violet-50 border-violet-100',
  },
  {
    to: '/finance/balance-sheet',
    icon: Landmark,
    title: 'الميزانية العمومية',
    description: 'كشف المركز المالي الإجمالي الشامل للأصول مقابل الخصوم وحقوق الملكية للمتجر.',
    colorClass: 'text-rose-600 bg-rose-50 border-rose-100',
  },
];

export default function AccountingDashboardPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();

  const [stats, setStats] = useState({
    accounts: 0,
    posted: 0,
    draft: 0,
    debitsThisMonth: 0,
  });
  const [recentEntries, setRecentEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch parallel stats and recent entries
  const loadData = useCallback(async () => {
    if (!store?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // 1. Fetch active accounts count
      const { count: accountsCount, error: accErr } = await supabase
        .from('accounting_accounts')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store.id)
        .eq('is_active', true);
      if (accErr) throw accErr;

      // 2. Fetch posted journal entries count
      const { count: postedCount, error: postedErr } = await supabase
        .from('accounting_journal')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store.id)
        .eq('status', 'posted');
      if (postedErr) throw postedErr;

      // 3. Fetch draft journal entries count
      const { count: draftCount, error: draftErr } = await supabase
        .from('accounting_journal')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store.id)
        .eq('status', 'draft');
      if (draftErr) throw draftErr;

      // 4. Calculate total debit movements this month
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const lastDay = `${year}-${String(month + 1).padStart(2, '0')}-${new Date(year, month + 1, 0).getDate()}`;

      const { data: monthLines, error: linesErr } = await supabase
        .from('accounting_journal_lines')
        .select(`
          debit,
          accounting_journal!inner (
            date,
            status,
            store_id
          )
        `)
        .eq('accounting_journal.store_id', store.id)
        .eq('accounting_journal.status', 'posted')
        .gte('accounting_journal.date', firstDay)
        .lte('accounting_journal.date', lastDay);

      if (linesErr) throw linesErr;
      const totalDebits = (monthLines || []).reduce((sum, l) => sum + Number(l.debit || 0), 0);

      // 5. Fetch last 5 posted journal entries
      const { data: recentJournals, error: recentErr } = await supabase
        .from('accounting_journal')
        .select(`
          id,
          entry_number,
          date,
          description,
          lines:accounting_journal_lines (
            debit
          )
        `)
        .eq('store_id', store.id)
        .eq('status', 'posted')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(5);

      if (recentErr) throw recentErr;

      const processedRecent = (recentJournals || []).map((entry) => {
        const sumDebit = (entry.lines || []).reduce((sum, l) => sum + Number(l.debit || 0), 0);
        return {
          id: entry.id,
          entry_number: entry.entry_number,
          date: entry.date,
          description: entry.description,
          amount: roundMoney(sumDebit),
        };
      });

      setStats({
        accounts: accountsCount || 0,
        posted: postedCount || 0,
        draft: draftCount || 0,
        debitsThisMonth: roundMoney(totalDebits),
      });
      setRecentEntries(processedRecent);
    } catch (e) {
      console.error(e);
      toast.error('تعذر تحميل إحصائيات لوحة التحكم');
    } finally {
      setLoading(false);
    }
  }, [store?.id, toast]);

  useEffect(() => {
    if (storeLoading) return;
    loadData();
  }, [storeLoading, loadData]);

  const fmt = (n) => {
    return roundMoney(Number(n ?? 0)).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="inline-flex items-center justify-center p-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
            title="تحديث البيانات"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      }
    >
      <div className="max-w-6xl mx-auto space-y-6" dir="rtl">
        {/* Header Block */}
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/10 shrink-0">
            <Coins size={26} />
          </div>
          <div>
            <h1 className="font-title text-2xl font-black text-slate-800 font-arabic">لوحة التحكم المحاسبية</h1>
            <p className="text-sm text-slate-500 font-bold mt-0.5 leading-relaxed font-arabic">
              مرحباً بك في النظام المحاسبي المزدوج. يمكنك تتبع دليل الحسابات، تسجيل القيود، ومطالعة التقارير الختامية.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col justify-center items-center py-24 gap-3">
            <Loader2 className="animate-spin text-indigo-500" size={40} />
            <span className="text-sm font-bold text-slate-500">جاري تحميل لوحة التحكم...</span>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Active Accounts Count */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3 border border-indigo-100">
                  <FolderTree size={20} />
                </div>
                <p className="text-2xl font-black text-slate-900 font-mono">{stats.accounts}</p>
                <p className="text-xs font-bold text-slate-500 mt-1 font-arabic">الحسابات النشطة بالدليل</p>
              </div>

              {/* Posted Entries Count */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3 border border-emerald-100">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                </div>
                <p className="text-2xl font-black text-slate-900 font-mono">{stats.posted}</p>
                <p className="text-xs font-bold text-slate-500 mt-1 font-arabic">القيود اليومية المُرَحَّلة</p>
              </div>

              {/* Draft Entries Count */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-3 border border-amber-100">
                  <FileText size={20} />
                </div>
                <p className="text-2xl font-black text-slate-900 font-mono">{stats.draft}</p>
                <p className="text-xs font-bold text-slate-500 mt-1 font-arabic">القيود المسودة (قيد الانتظار)</p>
              </div>

              {/* Debit Movements This Month */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center mb-3 border border-sky-100">
                  <BarChart3 size={20} />
                </div>
                <p className="text-lg font-black text-slate-900 font-mono" dir="ltr">₪{fmt(stats.debitsThisMonth)}</p>
                <p className="text-xs font-bold text-slate-500 mt-1.5 font-arabic">إجمالي حركات هذا الشهر</p>
              </div>
            </div>

            {/* Quick Navigation Cards Grid (2x3) */}
            <div className="space-y-3">
              <h3 className="font-black text-slate-800 text-sm font-arabic px-1">شاشات وتطبيقات النظام المالي</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {NAV_CARDS.map((card) => {
                  const CardIcon = card.icon;
                  return (
                    <Link
                      key={card.to}
                      to={card.to}
                      className="group rounded-2xl border border-slate-200 bg-white p-5 hover:border-indigo-500 hover:shadow-md transition-all flex flex-col justify-between text-right"
                    >
                      <div className="space-y-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${card.colorClass}`}>
                          <CardIcon size={20} />
                        </div>
                        <h4 className="font-black text-sm text-slate-800 font-arabic group-hover:text-indigo-600 transition-colors">
                          {card.title}
                        </h4>
                        <p className="text-xs text-slate-500 font-bold leading-relaxed font-arabic">
                          {card.description}
                        </p>
                      </div>
                      <div className="flex justify-end items-center gap-1 text-[11px] font-black text-indigo-600 mt-4 opacity-70 group-hover:opacity-100 transition-opacity font-arabic">
                        <span>انتقل الآن</span>
                        <ArrowLeft size={12} className="group-hover:translate-x-[-3px] transition-transform" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Recent Activities Section */}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <span className="font-black text-slate-700 text-sm font-arabic">آخر 5 قيود محاسبية مُرَحَّلة</span>
                <Link
                  to="/finance/journal"
                  className="text-xs font-black text-indigo-600 hover:text-indigo-700 hover:underline flex items-center gap-0.5 font-arabic"
                >
                  <span>عرض الكل</span>
                  <ChevronLeft size={14} />
                </Link>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right divide-y divide-slate-100">
                  <thead className="bg-slate-50">
                    <tr className="text-slate-500 font-black border-b border-slate-200">
                      <th className="py-3 px-5 text-xs font-arabic w-36">رقم القيد</th>
                      <th className="py-3 px-5 text-xs font-arabic w-32">التاريخ</th>
                      <th className="py-3 px-5 text-xs font-arabic">البيان العام للقيد</th>
                      <th className="py-3 px-5 text-xs font-arabic text-left w-36" dir="ltr">المبلغ الإجمالي ₪</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentEntries.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-12 text-center text-slate-400 font-bold font-arabic">
                          لا توجد أي قيود مرحّلة مسجّلة في النظام لعرضها هنا.
                        </td>
                      </tr>
                    ) : (
                      recentEntries.map((entry) => (
                        <tr key={entry.id} className="hover:bg-slate-50/30 transition-colors">
                          <td className="py-3 px-5 font-mono text-xs">
                            <span className="font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded">
                              {entry.entry_number}
                            </span>
                          </td>
                          <td className="py-3 px-5 font-mono text-xs" dir="ltr">
                            {entry.date}
                          </td>
                          <td className="py-3 px-5 font-bold text-slate-700 max-w-sm truncate">
                            {entry.description || '—'}
                          </td>
                          <td className="py-3 px-5 text-left font-mono font-black text-slate-800" dir="ltr">
                            ₪{fmt(entry.amount)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
