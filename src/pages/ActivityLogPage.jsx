import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  ShieldCheck,
  Filter,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Info,
  User,
  Clock,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';

const AL_TABLE = 'activity_log';

const ACTION_META = {
  INSERT: { label: 'إنشاء',    tone: 'emerald' },
  UPDATE: { label: 'تعديل',    tone: 'amber' },
  DELETE: { label: 'حذف',      tone: 'rose' },
  LOGIN:  { label: 'دخول',     tone: 'sky' },
  MANUAL: { label: 'يدوي',     tone: 'slate' },
};

const ENTITY_META = {
  sale:          { label: 'فاتورة مبيعات',   tone: 'indigo' },
  product:       { label: 'منتج',             tone: 'violet' },
  contact:       { label: 'زبون / مورد',      tone: 'amber' },
  purchase:      { label: 'فاتورة مشتريات',  tone: 'sky' },
  fund_movement: { label: 'حركة صندوق',       tone: 'teal' },
};

const TONE_CLASSES = {
  emerald: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200',
  amber:   'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
  rose:    'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
  sky:     'bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200',
  indigo:  'bg-indigo-100 text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200',
  violet:  'bg-violet-100 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200',
  teal:    'bg-teal-100 text-teal-900 dark:bg-teal-950/50 dark:text-teal-200',
  slate:   'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200',
};

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return String(iso).slice(0, 16); }
}

function JsonView({ data }) {
  if (!data) return <span className="text-slate-400">—</span>;
  try {
    const obj = typeof data === 'string' ? JSON.parse(data) : data;
    return (
      <ul className="space-y-0.5">
        {Object.entries(obj).map(([k, v]) => (
          <li key={k} className="flex gap-2 text-[11px]">
            <span className="font-bold text-slate-600 dark:text-slate-400 shrink-0">{k}:</span>
            <span className="text-slate-800 dark:text-slate-200 font-currency break-all">
              {v == null ? <em className="text-slate-400">null</em> : String(v)}
            </span>
          </li>
        ))}
      </ul>
    );
  } catch {
    return <span className="text-[11px] break-all">{String(data)}</span>;
  }
}

export default function ActivityLogPage() {
  const { store, loading: storeLoading } = useStore();
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [expanded, setExpanded] = useState({});

  const [filterAction, setFilterAction] = useState('');
  const [filterEntity, setFilterEntity] = useState('');
  const [filterFrom,   setFilterFrom]   = useState('');
  const [filterTo,     setFilterTo]     = useState('');

  const load = useCallback(async () => {
    if (!store?.id) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      let q = supabase
        .from(AL_TABLE)
        .select('id, action_type, entity_type, entity_id, description, old_data, new_data, created_at, user_id')
        .eq('store_id', store.id)
        .order('created_at', { ascending: false })
        .limit(400);

      if (filterAction) q = q.eq('action_type', filterAction);
      if (filterEntity) q = q.eq('entity_type', filterEntity);
      if (filterFrom)   q = q.gte('created_at', filterFrom + 'T00:00:00');
      if (filterTo)     q = q.lte('created_at', filterTo   + 'T23:59:59');

      const { data, error: qErr } = await q;
      if (qErr) throw qErr;
      setRows(data || []);
    } catch (e) {
      console.error(e);
      if (/does not exist|schema cache|PGRST205|42P01/i.test(e.message || '')) {
        setError('جدول سجل التدقيق غير مُنشأ — نفّذ activity_log.sql في Supabase.');
      } else {
        setError(e.message || 'تعذّر التحميل');
      }
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id, filterAction, filterEntity, filterFrom, filterTo]);

  useEffect(() => {
    if (storeLoading) return;
    load();
  }, [storeLoading, load]);

  const toggle = (id) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/finance/journal"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
          >
            القيود اليومية
          </Link>
          <button type="button" onClick={load}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 text-white px-4 py-2.5 text-sm font-black hover:bg-indigo-700"
          >
            <RefreshCw size={16} /> تحديث
          </button>
        </div>
      }
    >
      <div className="max-w-6xl mx-auto space-y-6" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-white shadow-lg">
            <ShieldCheck size={26} />
          </div>
          <div>
            <h1 className="font-title text-2xl font-black text-slate-900 dark:text-white">سجل التدقيق (Audit Log)</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 font-bold mt-0.5">
              رقابة داخلية — كل تغيير على المنتجات والفواتير والزبائن مسجَّل ومتابَع
            </p>
          </div>
        </div>

        {!error && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 dark:border-slate-700/50 dark:bg-white/5 px-4 py-3 flex gap-3 items-start">
            <Info className="shrink-0 text-slate-500 mt-0.5" size={18} />
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300 leading-relaxed">
              <strong>للتفعيل:</strong> نفّذ ملف{' '}
              <code className="bg-white dark:bg-slate-800 px-1 rounded">activity_log.sql</code> في Supabase SQL Editor.
              بعدها، كل تعديل سعر أو إنشاء فاتورة أو تغيير رصيد سيُسجَّل تلقائياً مع الوقت ومن قام به.
            </p>
          </div>
        )}

        {/* فلاتر */}
        <div className="flex flex-wrap gap-3 items-end rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-white/10 dark:bg-gray-900/60">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <Filter size={18} />
            <span className="text-xs font-black">فلترة</span>
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 mb-1">نوع الإجراء</label>
            <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-bold dark:text-slate-100"
            >
              <option value="">الكل</option>
              {Object.entries(ACTION_META).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 mb-1">نوع الكيان</label>
            <select value={filterEntity} onChange={(e) => setFilterEntity(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-bold dark:text-slate-100"
            >
              <option value="">الكل</option>
              {Object.entries(ENTITY_META).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 mb-1">من</label>
            <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-500 dark:text-slate-400 mb-1">إلى</label>
            <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm dark:text-slate-100"
            />
          </div>
          <button type="button" onClick={load}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 text-white px-4 py-2.5 text-sm font-black hover:bg-indigo-700"
          >
            <RefreshCw size={16} /> تحديث
          </button>
          {(filterAction || filterEntity || filterFrom || filterTo) && (
            <button type="button"
              onClick={() => { setFilterAction(''); setFilterEntity(''); setFilterFrom(''); setFilterTo(''); }}
              className="text-xs font-bold text-rose-600 hover:underline dark:text-rose-400"
            >
              مسح الفلاتر
            </button>
          )}
        </div>

        {error ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800/50 px-4 py-4 text-sm font-bold text-amber-950 dark:text-amber-100">
            {error}
          </div>
        ) : loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-slate-500 dark:text-slate-400" size={40} />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-slate-500 dark:text-slate-400 font-bold">
            لا توجد سجلات بعد. نفّذ activity_log.sql ثم قم بأي عملية (بيع، تعديل منتج، …).
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200/80 bg-white dark:border-gray-700/50 dark:bg-gray-900/70 overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-white/10 bg-slate-50/90 dark:bg-white/5 flex justify-between items-center">
              <span className="font-black text-slate-900 dark:text-white text-sm">{rows.length} حدث</span>
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                افتح كل سطر للاطلاع على القيم القديمة والجديدة
              </span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {rows.map((row) => {
                const actionMeta = ACTION_META[row.action_type] ?? { label: row.action_type, tone: 'slate' };
                const entityMeta = ENTITY_META[row.entity_type] ?? { label: row.entity_type, tone: 'slate' };
                const isOpen = !!expanded[row.id];
                return (
                  <div key={row.id}>
                    <button
                      type="button"
                      onClick={() => toggle(row.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-right hover:bg-slate-50/70 dark:hover:bg-white/5 transition-colors"
                    >
                      <span className={`shrink-0 ${isOpen ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'}`}>
                        {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </span>
                      <span className={`shrink-0 inline-block rounded-full px-2 py-0.5 text-[10px] font-black ${TONE_CLASSES[actionMeta.tone] ?? TONE_CLASSES.slate}`}>
                        {actionMeta.label}
                      </span>
                      <span className={`shrink-0 inline-block rounded-full px-2 py-0.5 text-[10px] font-black ${TONE_CLASSES[entityMeta.tone] ?? TONE_CLASSES.slate}`}>
                        {entityMeta.label}
                      </span>
                      <span className="flex-1 min-w-0 text-sm font-bold text-slate-900 dark:text-white truncate">
                        {row.description || '—'}
                      </span>
                      <span className="shrink-0 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        <Clock size={13} />
                        {formatDate(row.created_at)}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-8 pb-4 bg-slate-50/50 dark:bg-slate-800/30 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                        {row.user_id && (
                          <div className="sm:col-span-2 flex items-center gap-2 text-slate-600 dark:text-slate-300">
                            <User size={14} />
                            <span className="font-bold">معرّف المستخدم:</span>
                            <span className="font-mono break-all" dir="ltr">{row.user_id}</span>
                          </div>
                        )}
                        {row.entity_id && (
                          <div className="sm:col-span-2 flex items-center gap-2 text-slate-500 dark:text-slate-400">
                            <span className="font-bold">معرّف الكيان:</span>
                            <span className="font-mono break-all text-[11px]" dir="ltr">{row.entity_id}</span>
                          </div>
                        )}
                        {row.old_data && (
                          <div>
                            <p className="font-black text-rose-700 dark:text-rose-300 mb-2">القيم القديمة (قبل التعديل)</p>
                            <div className="rounded-xl border border-rose-100 dark:border-rose-900/40 bg-white/90 dark:bg-rose-950/20 p-2">
                              <JsonView data={row.old_data} />
                            </div>
                          </div>
                        )}
                        {row.new_data && (
                          <div>
                            <p className="font-black text-emerald-700 dark:text-emerald-300 mb-2">القيم الجديدة (بعد التعديل)</p>
                            <div className="rounded-xl border border-emerald-100 dark:border-emerald-900/40 bg-white/90 dark:bg-emerald-950/20 p-2">
                              <JsonView data={row.new_data} />
                            </div>
                          </div>
                        )}
                        {!row.old_data && !row.new_data && (
                          <p className="text-slate-400 dark:text-slate-500 italic">لا توجد تفاصيل إضافية.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
