import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Tag, Copy, Check } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';

export default function CouponsPage() {
  const { store } = useStore();
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [form, setForm] = useState({
    code: '', discount_type: 'percent', discount_value: '',
    min_order_amount: '', max_uses: '', expires_at: '', is_active: true,
  });

  useEffect(() => {
    if (!store?.id) return;
    fetchCoupons();
  }, [store?.id]);

  const fetchCoupons = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('store_coupons')
      .select('*')
      .eq('store_id', store.id)
      .order('created_at', { ascending: false });
    setCoupons(data || []);
    setLoading(false);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.code || !form.discount_value) return;
    setSaving(true);
    const { error } = await supabase.from('store_coupons').insert({
      store_id: store.id,
      code: form.code.toUpperCase().trim(),
      discount_type: form.discount_type,
      discount_value: Number(form.discount_value),
      min_order_amount: Number(form.min_order_amount || 0),
      max_uses: form.max_uses ? Number(form.max_uses) : null,
      expires_at: form.expires_at || null,
      is_active: form.is_active,
    });
    if (!error) {
      setForm({ code: '', discount_type: 'percent', discount_value: '', min_order_amount: '', max_uses: '', expires_at: '', is_active: true });
      fetchCoupons();
    }
    setSaving(false);
  };

  const toggleActive = async (id, current) => {
    await supabase.from('store_coupons').update({ is_active: !current }).eq('id', id);
    setCoupons((prev) => prev.map((c) => c.id === id ? { ...c, is_active: !current } : c));
  };

  const deleteCoupon = async (id) => {
    if (!confirm('حذف الكوبون؟')) return;
    await supabase.from('store_coupons').delete().eq('id', id);
    setCoupons((prev) => prev.filter((c) => c.id !== id));
  };

  const copyCode = (id, code) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const generateCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    setForm((f) => ({ ...f, code }));
  };

  if (loading) return (
    <DashboardLayout>
      <div className="flex justify-center py-24" dir="rtl">
        <Loader2 className="animate-spin text-violet-500" size={40} />
      </div>
    </DashboardLayout>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl mx-auto" dir="rtl">
        {/* Header */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden dark:bg-gray-900/40 dark:border-white/10">
          <div className="px-6 py-4 flex items-center gap-3 bg-gradient-to-l from-violet-50/50 to-white dark:from-violet-950/30 dark:to-gray-900">
            <div className="h-11 w-11 rounded-xl bg-violet-600 text-white flex items-center justify-center shadow-lg">
              <Tag size={22} />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 dark:text-white">كوبونات الخصم</h1>
              <p className="text-xs text-slate-500 mt-0.5">أنشئ وأدر كوبونات لزبائن المتجر العام</p>
            </div>
          </div>

          {/* Add Form */}
          <form onSubmit={handleAdd} className="p-6 space-y-4 border-t border-slate-100 dark:border-white/5">
            <h3 className="text-sm font-black text-slate-700 dark:text-slate-200">إضافة كوبون جديد</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">كود الكوبون</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                    className="flex-1 rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm font-mono bg-white dark:bg-gray-950 uppercase"
                    placeholder="SAVE20"
                    dir="ltr"
                    required
                  />
                  <button type="button" onClick={generateCode} className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                    عشوائي
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">نوع الخصم</label>
                <select
                  value={form.discount_type}
                  onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950"
                >
                  <option value="percent">نسبة مئوية (%)</option>
                  <option value="fixed">مبلغ ثابت (₪)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">
                  قيمة الخصم {form.discount_type === 'percent' ? '(%)' : '(₪)'}
                </label>
                <input
                  type="number"
                  value={form.discount_value}
                  onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950"
                  placeholder={form.discount_type === 'percent' ? '20' : '50'}
                  min="1" max={form.discount_type === 'percent' ? '100' : undefined}
                  dir="ltr" required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">الحد الأدنى للطلب (₪)</label>
                <input
                  type="number"
                  value={form.min_order_amount}
                  onChange={(e) => setForm((f) => ({ ...f, min_order_amount: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950"
                  placeholder="0 (بدون حد)"
                  min="0" dir="ltr"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">عدد الاستخدامات (اختياري)</label>
                <input
                  type="number"
                  value={form.max_uses}
                  onChange={(e) => setForm((f) => ({ ...f, max_uses: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950"
                  placeholder="غير محدود"
                  min="1" dir="ltr"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">تاريخ الانتهاء (اختياري)</label>
                <input
                  type="datetime-local"
                  value={form.expires_at}
                  onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950"
                  dir="ltr"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full bg-violet-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-violet-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              إضافة الكوبون
            </button>
          </form>
        </div>

        {/* Coupons List */}
        <div className="space-y-3">
          {coupons.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Tag size={48} className="mx-auto mb-3 opacity-30" />
              <p className="font-bold">لا توجد كوبونات بعد</p>
            </div>
          ) : (
            coupons.map((c) => {
              const expired = c.expires_at && new Date(c.expires_at) < new Date();
              const exhausted = c.max_uses && c.used_count >= c.max_uses;
              return (
                <div key={c.id} className={`rounded-2xl border bg-white dark:bg-gray-900/40 dark:border-white/10 overflow-hidden ${!c.is_active || expired || exhausted ? 'opacity-60' : 'border-slate-200/80'}`}>
                  <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="bg-violet-50 dark:bg-violet-950/30 rounded-xl px-4 py-2 flex items-center gap-2">
                        <Tag size={14} className="text-violet-600" />
                        <span className="font-black text-violet-700 dark:text-violet-300 font-mono tracking-wider">{c.code}</span>
                      </div>
                      <button type="button" onClick={() => copyCode(c.id, c.code)} className="text-slate-400 hover:text-violet-600 transition-colors">
                        {copiedId === c.id ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${c.is_active && !expired && !exhausted ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {expired ? 'منتهي' : exhausted ? 'نفد' : c.is_active ? 'نشط' : 'معطّل'}
                      </span>
                      <button type="button" onClick={() => toggleActive(c.id, c.is_active)} className="text-xs font-bold text-slate-500 hover:text-violet-600 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1 transition-colors">
                        {c.is_active ? 'تعطيل' : 'تفعيل'}
                      </button>
                      <button type="button" onClick={() => deleteCoupon(c.id)} className="text-rose-400 hover:text-rose-600 transition-colors p-1">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="px-5 py-3 border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/2 flex flex-wrap gap-4 text-xs text-slate-500">
                    <span>خصم: <strong className="text-slate-700 dark:text-slate-200">{c.discount_value}{c.discount_type === 'percent' ? '%' : '₪'}</strong></span>
                    {c.min_order_amount > 0 && <span>حد أدنى: <strong className="text-slate-700 dark:text-slate-200">₪{c.min_order_amount}</strong></span>}
                    <span>استخدم: <strong className="text-slate-700 dark:text-slate-200">{c.used_count}{c.max_uses ? `/${c.max_uses}` : ''}</strong> مرة</span>
                    {c.expires_at && <span>ينتهي: <strong className="text-slate-700 dark:text-slate-200">{new Date(c.expires_at).toLocaleDateString('ar-EG')}</strong></span>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
