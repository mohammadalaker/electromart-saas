import { getCreditLimitBadgeStatus } from '../utils/creditLimit';

export function CreditLimitBadge({ outstanding, creditLimit }) {
  const status = getCreditLimitBadgeStatus(outstanding, creditLimit);
  if (!status) return null;

  const classes =
    status.color === 'red'
      ? 'border-red-200 bg-red-100 text-red-700'
      : 'border-amber-200 bg-amber-100 text-amber-800';

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${classes}`}>
      {status.label}
    </span>
  );
}
