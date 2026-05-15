import { useCallback, useEffect, useState } from 'react';
import { Camera, Loader2, CalendarClock, ChevronDown } from 'lucide-react';
import {
  fetchCycleSettings,
  upsertCycleSettings,
  fetchLastCycleSnapshotMeta,
  runManualCycleSnapshot,
} from '../lib/inventoryCycleSnapshots';

const INTERVAL_OPTIONS = [
  { value: 7, label: 'كل 7 أيام' },
  { value: 14, label: 'كل 14 يوماً' },
  { value: 30, label: 'كل 30 يوماً' },
];

/**
 * لوحة جرد دوري: إعدادات لقطات تلقائية + زر لقطة يدوية.
 */
export default function InventoryCyclePanel({ storeId }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [schemaReady, setSchemaReady] = useState(true);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [intervalDays, setIntervalDays] = useState(7);
  const [lastMeta, setLastMeta] = useState(null);
  const [message, setMessage] = useState(null);

  const refresh = useCallback(async () => {
    if (!storeId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const [sRes, mRes] = await Promise.all([
        fetchCycleSettings(storeId),
        fetchLastCycleSnapshotMeta(storeId),
      ]);
      if (sRes.missingSchema || mRes.missingSchema) {
        setSchemaReady(false);
        return;
      }
      setSchemaReady(true);
      if (sRes.data) {
        setAutoEnabled(!!sRes.data.auto_snapshot_enabled);
        setIntervalDays(Number(sRes.data.interval_days) || 7);
      }
      setLastMeta(mRes.data);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const persistAuto = async (enabled) => {
    if (!storeId || !schemaReady) return;
    setSaving(true);
    setMessage(null);
    const { error } = await upsertCycleSettings(storeId, {
      auto_snapshot_enabled: enabled,
      interval_days: intervalDays,
    });
    setSaving(false);
    if (error) {
      setMessage({ type: 'err', text: error.message || 'تعذر حفظ الإعدادات' });
      return;
    }
    setAutoEnabled(enabled);
    setMessage({ type: 'ok', text: enabled ? 'تم تفعيل اللقطات التلقائية.' : 'تم إيقاف اللقطات التلقائية.' });
  };

  const persistInterval = async (days) => {
    if (!storeId || !schemaReady) return;
    setIntervalDays(days);
    setSaving(true);
    setMessage(null);
    const { error } = await upsertCycleSettings(storeId, {
      auto_snapshot_enabled: autoEnabled,
      interval_days: days,
    });
    setSaving(false);
    if (error) {
      setMessage({ type: 'err', text: error.message || 'تعذر حفظ الفترة' });
      return;
    }
    setMessage({ type: 'ok', text: 'تم حفظ فترة الجرد.' });
  };

  const onSnapshotNow = async () => {
    if (!storeId || !schemaReady) return;
    setSnapshotting(true);
    setMessage(null);
    const { batchId, error } = await runManualCycleSnapshot(storeId);
    setSnapshotting(false);
    if (error) {
      setMessage({ type: 'err', text: error.message });
      return;
    }
    setMessage({ type: 'ok', text: `تم تسجيل لقطة الجرد (دفعة ${batchId?.slice(0, 8) ?? '—'}…).` });
    void refresh();
  };

  if (!storeId) return null;

  if (!schemaReady) {
    return (
      <div
        className="rounded-2xl border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/90 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-100 mb-4"
        dir="rtl"
      >
        <p className="font-bold">جرد دوري — يتطلب خطوة في قاعدة البيانات</p>
        <p className="mt-1 text-xs opacity-90">
          نفّذ ملف{' '}
          <code className="px-1 rounded bg-white/70 dark:bg-black/30">swiftm/supabase/inventory_cycle_snapshots.sql</code>{' '}
          في SQL Editor في Supabase، ثم أعد تحميل الصفحة.
        </p>
      </div>
    );
  }

  const lastLabel = lastMeta?.created_at
    ? new Date(lastMeta.created_at).toLocaleString('ar', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'لا توجد لقطات بعد';

  return (
    <div
      className="rounded-2xl border border-violet-200/60 dark:border-violet-900/40 bg-gradient-to-l from-violet-50/90 to-white/90 dark:from-violet-950/40 dark:to-slate-900/50 p-3 mb-4 shadow-sm"
      dir="rtl"
    >
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-violet-200/80 bg-white/80 text-violet-700 transition hover:bg-violet-50 dark:border-violet-800/60 dark:bg-slate-800/80 dark:text-violet-300 dark:hover:bg-violet-950/50"
            aria-expanded={expanded}
            aria-label={expanded ? 'طي الإعدادات' : 'إظهار الإعدادات'}
          >
            <ChevronDown size={18} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 shrink-0">
            <CalendarClock size={18} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-black text-slate-800 dark:text-slate-100">جرد دوري للمخزون</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              آخر لقطة:{' '}
              <span className="font-bold text-slate-700 dark:text-slate-300">{lastLabel}</span>
              {lastMeta?.source === 'scheduled' && (
                <span className="text-violet-600 dark:text-violet-400 mr-1">(تلقائي)</span>
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={loading || snapshotting}
          onClick={onSnapshotNow}
          className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-black px-3 py-2 shadow-sm transition-colors shrink-0"
        >
          {snapshotting ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
          تسجيل لقطة الآن
        </button>
      </div>

      {expanded && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-violet-200/50 dark:border-violet-800/40 pt-3">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none text-xs font-bold text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={autoEnabled}
              disabled={loading || saving}
              onChange={(e) => void persistAuto(e.target.checked)}
              className="rounded border-violet-300 text-violet-600 focus:ring-violet-500"
            />
            لقطات تلقائية على الخادم
          </label>

          <select
            value={intervalDays}
            disabled={loading || saving || !autoEnabled}
            onChange={(e) => void persistInterval(Number(e.target.value))}
            className="text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-slate-800 dark:text-slate-200 disabled:opacity-45"
          >
            {INTERVAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {saving && <Loader2 size={14} className="animate-spin text-violet-500" aria-hidden />}
        </div>
      )}

      {message && (
        <p
          className={`text-xs font-bold mt-2 ${message.type === 'err' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
