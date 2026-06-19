import { supabase } from '../../lib/supabaseClient';
import { normalizeDigitsToLatin } from '../../utils/normalizeDigits';

export const CHECKS_REGISTRY_TABLE = 'checks_registry';
export const CONTACTS_TABLE = 'store_contacts';

export const STATUS_LABELS = {
  pending: 'قيد الانتظار',
  cashed: 'تم الصرف',
  bounced: 'مرتجع',
  cancelled: 'ملغي',
};

export const STATUS_BADGE = {
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  cashed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  bounced: 'bg-red-100 text-red-800 border-red-200',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
};

export const DIRECTION_LABELS = {
  incoming: 'وارد',
  outgoing: 'صادر',
};

export const DIRECTION_BADGE = {
  incoming: 'bg-blue-100 text-blue-800 border-blue-200',
  outgoing: 'bg-violet-100 text-violet-800 border-violet-200',
};

export const CHECK_SELECT = `
  id,
  store_id,
  direction,
  status,
  contact_id,
  check_number,
  bank_name,
  amount,
  issue_date,
  due_date,
  notes,
  created_at,
  store_contacts ( id, name, role )
`;

export function parseMoney(v) {
  const n = parseFloat(normalizeDigitsToLatin(String(v ?? '')).replace(',', '.'));
  return Number.isNaN(n) ? 0 : Math.round(Math.max(0, n) * 100) / 100;
}

export function formatMoney(n) {
  return parseMoney(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

export function weekEndYmd() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export function isOverdue(row) {
  if (!row?.due_date || row.status !== 'pending') return false;
  return String(row.due_date).slice(0, 10) < todayYmd();
}

export function isDueThisWeek(row) {
  if (!row?.due_date || row.status !== 'pending') return false;
  const due = String(row.due_date).slice(0, 10);
  return due >= todayYmd() && due <= weekEndYmd();
}

export function contactName(row) {
  const c = row?.store_contacts;
  if (c?.name) return c.name;
  return '—';
}

export function normalizeCheckRow(row) {
  if (!row) return row;
  const contact = Array.isArray(row.store_contacts) ? row.store_contacts[0] : row.store_contacts;
  return { ...row, store_contacts: contact || null };
}

export async function fetchChecksRegistry(storeId, { direction } = {}) {
  let q = supabase
    .from(CHECKS_REGISTRY_TABLE)
    .select(CHECK_SELECT)
    .eq('store_id', storeId)
    .order('due_date', { ascending: true })
    .order('created_at', { ascending: false });

  if (direction) q = q.eq('direction', direction);

  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(normalizeCheckRow);
}

export async function fetchContactsByRole(storeId, role) {
  const { data, error } = await supabase
    .from(CONTACTS_TABLE)
    .select('id, name, phone')
    .eq('store_id', storeId)
    .eq('role', role)
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export function computeSummary(checks) {
  const pending = checks.filter((c) => c.status === 'pending');
  const sum = (rows) => rows.reduce((acc, r) => acc + parseMoney(r.amount), 0);

  return {
    incomingPending: sum(pending.filter((c) => c.direction === 'incoming')),
    outgoingPending: sum(pending.filter((c) => c.direction === 'outgoing')),
    dueThisWeek: sum(pending.filter(isDueThisWeek)),
    overdue: sum(pending.filter(isOverdue)),
  };
}

export function formatDateAr(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso).slice(0, 10));
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}
