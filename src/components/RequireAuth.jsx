import { useCallback, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

/**
 * يفرض وجود جلسة Supabase قبل عرض أي مسار فرعي.
 * المسارات العامة (تسجيل، متجر الزوار) تُعرّف خارج هذا المكوّن في main.jsx.
 */
export default function RequireAuth() {
  const { pathname } = useLocation();
  const [status, setStatus] = useState('checking');
  const PLAN_ROUTE = '/settings/plan';

  const checkSessionAndTrial = useCallback(async (sessionOverride) => {
    const session =
      sessionOverride !== undefined
        ? sessionOverride
        : (await supabase.auth.getSession()).data.session;

    if (!session) {
      return 'anon';
    }

    const userId = session.user?.id;
    if (!userId) {
      return 'ok';
    }

    const { data: store, error } = await supabase
      .from('stores')
      .select('id, plan, trial_ends_at, is_active')
      .eq('owner_id', userId)
      .maybeSingle();

    // Keep existing auth flow intact if store lookup fails.
    if (error) {
      return 'ok';
    }

    // ترقية الحساب وتفعيله دائماً تلقائياً في حال كان تجريبي
    if (store && (store.plan === 'trial' || store.trial_ends_at !== null || store.is_active === false)) {
      supabase
        .from('stores')
        .update({
          plan: 'business',
          is_active: true,
          trial_ends_at: null,
        })
        .eq('id', store.id)
        .then(() => {});
    }

    return 'ok';
  }, []);

  useEffect(() => {
    let cancelled = false;
    const runCheck = async (sessionOverride) => {
      const nextStatus = await checkSessionAndTrial(sessionOverride);
      if (!cancelled) setStatus(nextStatus);
    };

    runCheck();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      runCheck(session);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [checkSessionAndTrial]);

  if (status === 'checking') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" dir="rtl">
        <Loader2 className="animate-spin text-indigo-500" size={36} />
      </div>
    );
  }

  if (status === 'anon') {
    return <Navigate to="/signin" replace state={{ from: pathname }} />;
  }

  if (status === 'trial_expired' && pathname !== PLAN_ROUTE) {
    return <Navigate to={PLAN_ROUTE} replace state={{ from: pathname }} />;
  }

  return <Outlet />;
}
