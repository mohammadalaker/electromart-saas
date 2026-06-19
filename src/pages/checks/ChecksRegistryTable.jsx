import { Loader2, Trash2 } from 'lucide-react';
import {
  STATUS_LABELS,
  STATUS_BADGE,
  DIRECTION_LABELS,
  DIRECTION_BADGE,
  formatMoney,
  formatDateAr,
  isOverdue,
  contactName,
} from './checksRegistryUtils';

export default function ChecksRegistryTable({
  rows,
  loading,
  emptyMessage = 'لا توجد شيكات',
  showDirection = true,
  onStatusChange,
  onDelete,
  updatingId,
  deletingId,
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="animate-spin text-indigo-500" size={36} />
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="py-16 text-center text-sm font-bold text-slate-400">{emptyMessage}</div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px]">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/80">
            {showDirection && (
              <th className="py-3.5 px-4 text-right text-xs font-bold text-slate-600">نوع الشيك</th>
            )}
            <th className="py-3.5 px-4 text-right text-xs font-bold text-slate-600">الجهة</th>
            <th className="py-3.5 px-4 text-right text-xs font-bold text-slate-600">رقم الشيك</th>
            <th className="py-3.5 px-4 text-right text-xs font-bold text-slate-600">البنك</th>
            <th className="py-3.5 px-4 text-right text-xs font-bold text-slate-600">المبلغ</th>
            <th className="py-3.5 px-4 text-right text-xs font-bold text-slate-600">تاريخ الاستحقاق</th>
            <th className="py-3.5 px-4 text-right text-xs font-bold text-slate-600">الحالة</th>
            <th className="py-3.5 px-4 text-right text-xs font-bold text-slate-600">إجراءات</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const overdue = isOverdue(row);
            return (
              <tr
                key={row.id}
                className={`border-b border-slate-50 transition hover:bg-slate-50/60 ${
                  overdue ? 'border-r-4 border-r-red-500 bg-red-50/40' : ''
                }`}
              >
                {showDirection && (
                  <td className="py-3.5 px-4">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                        DIRECTION_BADGE[row.direction] || DIRECTION_BADGE.incoming
                      }`}
                    >
                      {DIRECTION_LABELS[row.direction] || row.direction}
                    </span>
                  </td>
                )}
                <td className="py-3.5 px-4 text-sm font-bold text-slate-800">{contactName(row)}</td>
                <td className="py-3.5 px-4 font-mono text-sm text-slate-600" dir="ltr">
                  {row.check_number || '—'}
                </td>
                <td className="py-3.5 px-4 text-sm text-slate-600">{row.bank_name || '—'}</td>
                <td className="py-3.5 px-4 font-mono text-sm font-bold text-slate-900" dir="ltr">
                  ₪ {formatMoney(row.amount)}
                </td>
                <td className={`py-3.5 px-4 text-sm ${overdue ? 'font-bold text-red-600' : 'text-slate-600'}`}>
                  {formatDateAr(row.due_date)}
                </td>
                <td className="py-3.5 px-4">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                      STATUS_BADGE[row.status] || STATUS_BADGE.pending
                    }`}
                  >
                    {STATUS_LABELS[row.status] || row.status}
                  </span>
                </td>
                <td className="py-3.5 px-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {row.status === 'pending' && onStatusChange && (
                      <select
                        value=""
                        disabled={updatingId === row.id}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v) onStatusChange(row.id, v);
                          e.target.value = '';
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50"
                      >
                        <option value="">تحديث الحالة</option>
                        <option value="cashed">تم الصرف</option>
                        <option value="bounced">مرتجع</option>
                        <option value="cancelled">ملغي</option>
                      </select>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        onClick={() => onDelete(row)}
                        disabled={deletingId === row.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-100 bg-red-50 px-2 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100 disabled:opacity-50"
                      >
                        <Trash2 size={13} />
                        حذف
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
