import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const StoreContext = createContext(null);

// Supabase error code returned by .single() when no rows match the query.
const NO_ROWS = 'PGRST116';

export function StoreProvider({ children }) {
  const [store, setStore]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // Each fetch increments this counter. The closure captures its value at call
  // time so a stale response from a previous fetch can detect it was superseded
  // and discard its result — preventing out-of-order state updates.
  const fetchIdRef = useRef(0);

  const fetchStore = async () => {
    const currentId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    // ── Step 1: Resolve the current Auth user ────────────────────────────────
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      // Not authenticated — clear everything and stop loading.
      if (currentId === fetchIdRef.current) {
        setStore(null);
        setError(null);
        setLoading(false);
      }
      return;
    }

    // ── Step 2: Fetch the store owned by this user ───────────────────────────
    const { data, error: storeError } = await supabase
      .from('stores')
      .select('*')
      .eq('owner_id', user.id)
      .single();

    // Discard result if a newer fetch has already been initiated.
    if (currentId !== fetchIdRef.current) return;

    if (storeError) {
      if (storeError.code === NO_ROWS) {
        // User is authenticated but hasn't created a store yet (e.g. store
        // insert failed during signup). Store null, no error — callers can
        // check `!store && !loading` to show an onboarding prompt.
        setStore(null);
      } else {
        // A real database or network error.
        setError(storeError.message);
        setStore(null);
      }
    } else {
      setStore(data);
    }

    setLoading(false);
  };

  useEffect(() => {
    // Run immediately on mount to hydrate the context.
    fetchStore();

    // Re-run whenever the auth session changes (sign-in, sign-out, token
    // refresh, email confirmation redirect). This keeps the context in sync
    // without requiring a full page reload.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        // Clear store instantly on logout without a round-trip.
        fetchIdRef.current++;
        setStore(null);
        setError(null);
        setLoading(false);
      } else {
        // SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED, PASSWORD_RECOVERY, etc.
        fetchStore();
      }
    });

    // Clean up the listener when the provider unmounts.
    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <StoreContext.Provider
      value={{
        store,           // The store record from the 'stores' table, or null
        loading,         // True while either auth or DB query is in flight
        error,           // Non-null only on a real DB/network failure
        refreshStore: fetchStore,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (ctx === null) {
    throw new Error('useStore must be used inside <StoreProvider>');
  }
  return ctx;
}
