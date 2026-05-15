import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Layers, RefreshCw, Save, Settings } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import {
  MODULE_GROUPS,
  MODULE_LABELS_AR,
  getDisabledModuleSet,
  normalizeDisabledModules,
} from '../utils/storeEntitlements';

export default function SubscriptionPlanPage() {
  const { store, loading: storeLoading, refreshStore } = useStore();
  const navigate = useNavigate();
  const [localDisabled, setLocalDisabled] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedOk, setSavedOk] = useState(false);

  const disabledSignature = useMemo(
    () => normalizeDisabledModules(store?.disabled_modules).join('\0'),
    [store?.disabled_modules]
  );

  useEffect(() => {
    if (!store?.id) return;
    setLocalDisabled(getDisabledModuleSet(store));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- المزامنة عند تغيّر البيانات من الخادم (disabledSignature) فقط
  }, [store?.id, disabledSignature]);

  const dirty = useMemo(() => {
    const localSig = normalizeDisabledModules([...localDisabled]).join('\0');
    return localSig !== disabledSignature;
  }, [localDisabled, disabledSignature]);

  const setModuleEnabled = useCallback((key, enabled) => {
    setLocalDisabled((prev) => {
      const next = new Set(prev);
      if (enabled) next.delete(key);
      else next.add(key);
      return next;
    });
    setSavedOk(false);
  }, []);

  const enableAllInGroup = useCallback((keys, enabled) => {
    setLocalDisabled((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (enabled) next.delete(k);
        else next.add(k);
      }
      return next;
    });
    setSavedOk(false);
  }, []);

  const resetFromServer = useCallback(() => {
    if (store) setLocalDisabled(getDisabledModuleSet(store));
    setError(null);
    setSavedOk(false);
  }, [store]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!store?.id) return;
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const arr = normalizeDisabledModules([...localDisabled]);
      const { error: uErr } = await supabase
        .from('stores')
        .update({ disabled_modules: arr })
        .eq('id', store.id)
        .eq('owner_id', store.owner_id);
      if (uErr) {
        if (/disabled_modules|column|schema|PGRST204/i.test(String(uErr.message || ''))) {
          throw new Error(
            'عمود الوحدات غير موجود. نفّذ الملف supabase/store_entitlements.sql في Supabase ثم أعد المحاولة.'
          );
        }
        throw uErr;
      }
      await refreshStore();
      setSavedOk(true);
    } catch (err) {
      console.error(err);
      setError(err.message || 'تعذّر الحفظ');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (storeLoading) return;
    if (!store?.id) navigate('/signin');
  }, [storeLoading, store?.id, navigate]);

  if (storeLoading || !store?.id) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24" dir="rtl">
          <Loader2 className="animate-spin text-indigo-500" size={40} />
        </div>
      </DashboardLayout>
    );
  }

  const planLabel = (store.plan || 'free').toString();
  const isTrial = planLabel.toLowerCase() === 'trial';
  const trialEndsAt = store?.trial_ends_at ? new Date(store.trial_ends_at) : null;
  const hasValidTrialDate = trialEndsAt instanceof Date && !Number.isNaN(trialEndsAt.getTime());
  const trialExpired = isTrial && hasValidTrialDate && trialEndsAt.getTime() <= Date.now();
  const trialDaysRemaining =
    isTrial && hasValidTrialDate
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : null;
  const trialEndDateLabel =
    hasValidTrialDate
      ? trialEndsAt.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : null;

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/settings"
            className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-600 hover:text-indigo-600 dark:text-slate-400"
          >
            <Settings size={16} />
            إعدادات النظام
          </Link>
          <button
            type="button"
            onClick={resetFromServer}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold disabled:opacity-45 dark:border-slate-600 dark:bg-gray-900"
          >
            <RefreshCw size={16} />
            إلغاء التعديلات
          </button>
          <button
            type="submit"
            form="plan-modules-form"
            disabled={!dirty || saving}
            className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-45"
          >
            <Save size={16} />
            {saving ? 'جاري الحفظ…' : 'حفظ الوحدات'}
          </button>
        </div>
      }
    >
      <div className="max-w-3xl mx-auto space-y-6" dir="rtl">
        {isTrial && (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm font-bold ${
              trialExpired
                ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200'
                : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'
            }`}
          >
            {trialExpired ? (
              <p>Your trial has ended. Please choose a plan to continue.</p>
            ) : (
              <p>
                {trialEndDateLabel
                  ? `Your free trial ends on ${trialEndDateLabel} — ${trialDaysRemaining} day${
                      trialDaysRemaining === 1 ? '' : 's'
                    } remaining`
                  : 'Your free trial is active.'}
              </p>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-white/20 bg-white/80 p-6 shadow-sm backdrop-blur-md dark:border-gray-700/30 dark:bg-gray-900/50">
          <h1 className="flex items-center gap-2 text-xl font-black text-gray-900 dark:text-white">
            <Layers className="shrink-0 text-indigo-600" size={28} />
            الباقة والوحدات
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            النظام شامل؛ هنا تتحكم بظهور الوحدات في القائمة وصلاحية الدخول لها. الوحدات المفعّلة = تظهر
            وتعمل. المعطّلة = تُخفى ويُمنع الوصول المباشر للصفحة.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-200">
            اسم الباقة الحالية:{' '}
            <span className="font-mono uppercase text-indigo-600 dark:text-indigo-400">{planLabel}</span>
            <span className="text-slate-500 dark:text-slate-400 font-normal">
              (للعرض؛ التفعيل الفعلي بالوحدات أدناه)
            </span>
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </div>
        )}

        {savedOk && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
            تم حفظ الوحدات بنجاح.
          </div>
        )}

        <form id="plan-modules-form" onSubmit={handleSave} className="space-y-5">
          {MODULE_GROUPS.map((group) => {
            const groupKeys = group.keys;
            const enabledCount = groupKeys.filter((k) => !localDisabled.has(k)).length;
            const allOn = enabledCount === groupKeys.length;
            const allOff = enabledCount === 0;

            return (
              <div
                key={group.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-gray-900/40"
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-700/80">
                  <h2 className="text-base font-black text-slate-900 dark:text-white">{group.title}</h2>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => enableAllInGroup(groupKeys, true)}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      تفعيل الكل
                    </button>
                    <button
                      type="button"
                      onClick={() => enableAllInGroup(groupKeys, false)}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      تعطيل الكل
                    </button>
                  </div>
                </div>
                <ul className="space-y-2">
                  {groupKeys.map((key) => {
                    const enabled = !localDisabled.has(key);
                    const label = MODULE_LABELS_AR[key] || key;
                    return (
                      <li
                        key={key}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-700/60 dark:bg-slate-800/30"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{label}</p>
                          <p className="font-mono text-[10px] text-slate-500 ltr:text-left" dir="ltr">
                            {key}
                          </p>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 shrink-0">
                          <span className="text-xs font-bold text-slate-600 dark:text-slate-400">
                            {enabled ? 'مفعّل' : 'معطّل'}
                          </span>
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(ev) => setModuleEnabled(key, ev.target.checked)}
                            className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                  {allOn && 'كل وحدات هذا القسم مفعّلة.'}
                  {allOff && 'كل وحدات هذا القسم معطّلة.'}
                  {!allOn && !allOff && `${enabledCount} من ${groupKeys.length} مفعّلة.`}
                </p>
              </div>
            );
          })}
        </form>

        <p className="text-center text-xs text-slate-500 dark:text-slate-400 pb-8">
          للترقية أو تغيير اسم الباقة عبر مزوّد الخدمة، يمكن لاحقاً ربط هذا الحقل ببوابة دفع أو لوحة مشرف.
        </p>
      </div>
    </DashboardLayout>
  );
}
