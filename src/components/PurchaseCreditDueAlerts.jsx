import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bell, CalendarClock, CheckCircle2, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';

const PURCHASES_TABLE = 'store_purchases';
const CONTACTS_TABLE = 'store_contacts';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysFromToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatMoney(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return '0.00';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * تنبيهات فواتير مشتريات آجل: مستحقة أو قريبة، ولم تُسدَّد بعد.
 */
export default function PurchaseCreditDueAlerts() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [schemaOk, setSchemaOk] = useState(true);
  const [settlingId, setSettlingId] = useState(null);

  const fetchDue = useCallback(async () => {
    if (!store?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const until = addDaysFromToday(7);
    try {
      const { data, error } = await supabase
        .from(PURCHASES_TABLE)
        .select(
          'id, total_amount, supplier_company_name, payment_mode, payment_due_date, credit_settled_at, invoice_number, supplier_contact_id'
        )
        .eq('store_id', store.id)
        .eq('payment_mode', 'credit')
        .is('credit_settled_at', null)
        .not('payment_due_date', 'is', null)
        .lte('payment_due_date', until)
        .order('payment_due_date', { ascending: true });

      if (error) {
        if (error.code === '42703' || String(error.message || '').includes('does not exist')) {
          setSchemaOk(false);
          setRows([]);
          return;
        }
        throw error;
      }
      setSchemaOk(true);
      setRows(data || []);
    } catch (e) {
      console.warn('PurchaseCreditDueAlerts', e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    fetchDue();
  }, [storeLoading, fetchDue]);

  const { overdue, upcoming } = useMemo(() => {
    const t = todayISO();
    const ov = [];
    const up = [];
    for (const r of rows) {
      const due = r.payment_due_date ? String(r.payment_due_date).slice(0, 10) : '';
      if (!due) continue;
      if (due <= t) ov.push(r);
      else up.push(r);
    }
    return { overdue: ov, upcoming: up };
  }, [rows]);

  const markSettled = async (row) => {
    if (!store?.id || !row?.id) return;
    const ok = window.confirm(
      'تأكيد تسديد هذه الفاتورة في النظام؟ سيتم خصم مبلغها من ذمة المورد إن كان مرتبطاً بجهة اتصال.'
    );
    if (!ok) return;
    setSettlingId(row.id);
    try {
      const now = new Date().toISOString();
      const { error: u1 } = await supabase
        .from(PURCHASES_TABLE)
        .update({ credit_settled_at: now })
        .eq('id', row.id)
        .eq('store_id', store.id);
      if (u1) throw u1;

      if (row.supplier_contact_id) {
        const amt = Math.max(0, Number(row.total_amount ?? 0));
        const { data: c, error: e2 } = await supabase
          .from(CONTACTS_TABLE)
          .select('outstanding_amount')
          .eq('id', row.supplier_contact_id)
          .eq('store_id', store.id)
          .maybeSingle();
        if (!e2 && c) {
          const next = Math.max(0, Number(c.outstanding_amount ?? 0) - amt);
          await supabase
            .from(CONTACTS_TABLE)
            .update({ outstanding_amount: next })
            .eq('id', row.supplier_contact_id)
            .eq('store_id', store.id);
        }
      }
      await fetchDue();
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'تعذّر التحديث');
    } finally {
      setSettlingId(null);
    }
  };

  if (storeLoading || !store?.id || !schemaOk) return null;
  if (loading) return null;

  if (rows.length === 0) return null;

  return (
    <div className="mb-8 space-y-3" dir="rtl">
      {overdue.length > 0 && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-gradient-to-l from-rose-50 to-white dark:from-rose-950/40 dark:to-gray-900/30 p-4 shadow-sm backdrop-blur-md">
          <div className="flex items-center gap-2 text-rose-900 font-black text-sm mb-3">
            <Bell className="shrink-0 text-rose-600" size={20} />
            استحقاق سداد موردين (متأخر)
          </div>
          <ul className="space-y-2">
            {overdue.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-100 dark:border-rose-900/40 bg-white/80 dark:bg-gray-900/40 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-black text-gray-900 dark:text-white">{r.supplier_company_name || 'مورد'}</span>
                  <span className="text-slate-500 mx-1">·</span>
                  <span className="font-currency text-slate-700" dir="ltr" lang="en">
                    ₪ {formatMoney(r.total_amount)}
                  </span>
                  <div className="text-[11px] text-rose-700 mt-0.5 flex items-center gap-1">
                    <AlertTriangle size={12} />
                    استحقاق:{' '}
                    <span className="font-currency font-bold" dir="ltr" lang="en">
                      {r.payment_due_date}
                    </span>
                    {r.invoice_number ? (
                      <>
                        {' '}
                        — فاتورة <span dir="ltr">{r.invoice_number}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => markSettled(r)}
                    disabled={settlingId === r.id}
                    className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 text-white text-[11px] font-black px-3 py-2 hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {settlingId === r.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 size={14} />
                    )}
                    تسديد
                  </button>
                  <Link
                    to="/purchases"
                    className="text-[11px] font-bold text-indigo-600 hover:underline"
                  >
                    المشتريات
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-gradient-to-l from-amber-50/90 to-white dark:from-amber-950/30 dark:to-gray-900/30 p-4 shadow-sm backdrop-blur-md">
          <div className="flex items-center gap-2 text-amber-950 font-black text-sm mb-2">
            <CalendarClock className="shrink-0 text-amber-600" size={20} />
            قريب الاستحقاق (خلال 7 أيام)
          </div>
          <ul className="space-y-1.5 text-xs text-amber-950">
            {upcoming.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 font-currency" dir="ltr" lang="en">
                <span className="text-right font-bold text-gray-900 dark:text-white" dir="rtl">
                  {r.supplier_company_name || 'مورد'}
                </span>
                <span>
                  ₪ {formatMoney(r.total_amount)} — استحقاق {r.payment_due_date}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
