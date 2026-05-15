import DashboardLayout from '../components/DashboardLayout';

/** صفحة مؤقتة للروابط التي ستُفعّل لاحقاً */
export default function ComingSoon({ title }) {
  return (
    <DashboardLayout>
      <div
        className="rounded-2xl border border-dashed border-slate-200 bg-white p-16 text-center"
        dir="rtl"
      >
        <p className="text-lg font-bold text-slate-800">{title}</p>
        <p className="text-sm text-slate-500 mt-2">هذا القسم قيد التطوير — قريباً</p>
      </div>
    </DashboardLayout>
  );
}
