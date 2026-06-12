import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Truck, Phone, ChevronDown, ChevronUp, Package } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';

const DELIVERY_METHOD_MAP = {
  cod: 'دفع عند الاستلام',
  prepaid: 'دفع مسبق',
  both: 'كلاهما',
};

const COLLECTION_METHOD_MAP = {
  from_customer: 'التحصيل من الزبون',
  from_store: 'التحصيل من المتجر',
  both: 'كلاهما',
};

export default function DeliveryZonesPage() {
  const { store } = useStore();
  const [companies, setCompanies] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedCompany, setExpandedCompany] = useState(null);
  
  const [companyForm, setCompanyForm] = useState({
    name: '', phone: '', delivery_method: 'cod',
    collection_method: 'from_customer', notes: '',
  });
  
  const [zoneForm, setZoneForm] = useState({ name: '', fee: '', company_id: '' });

  useEffect(() => {
    if (!store?.id) return;
    fetchAll();
  }, [store?.id]);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: comp }, { data: zon }] = await Promise.all([
      supabase.from('store_delivery_companies').select('*').eq('store_id', store.id).order('created_at'),
      supabase.from('store_delivery_zones').select('*').eq('store_id', store.id).order('sort_order'),
    ]);
    setCompanies(comp || []);
    setZones(zon || []);
    setLoading(false);
  };

  const addCompany = async (e) => {
    e.preventDefault();
    if (!companyForm.name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('store_delivery_companies').insert({
      store_id: store.id,
      ...companyForm,
      name: companyForm.name.trim(),
      phone: companyForm.phone.trim() || null,
      notes: companyForm.notes.trim() || null,
    });
    if (!error) {
      setCompanyForm({ name: '', phone: '', delivery_method: 'cod', collection_method: 'from_customer', notes: '' });
      fetchAll();
    }
    setSaving(false);
  };

  const addZone = async (e) => {
    e.preventDefault();
    if (!zoneForm.name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('store_delivery_zones').insert({
      store_id: store.id,
      name: zoneForm.name.trim(),
      fee: Number(zoneForm.fee || 0),
      company_id: zoneForm.company_id || null,
      sort_order: zones.length,
    });
    if (!error) {
      setZoneForm({ name: '', fee: '', company_id: '' });
      fetchAll();
    }
    setSaving(false);
  };

  const deleteCompany = async (id) => {
    if (!confirm('حذف الشركة وكل مناطقها؟')) return;
    await supabase.from('store_delivery_companies').delete().eq('id', id);
    fetchAll();
  };

  const deleteZone = async (id) => {
    await supabase.from('store_delivery_zones').delete().eq('id', id);
    setZones((prev) => prev.filter((z) => z.id !== id));
  };

  const toggleCompany = async (id, current) => {
    await supabase.from('store_delivery_companies').update({ is_active: !current }).eq('id', id);
    setCompanies((prev) => prev.map((c) => c.id === id ? { ...c, is_active: !current } : c));
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
      <div className="space-y-6" dir="rtl">
        {/* Header */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden dark:bg-gray-900/40 dark:border-white/10">
          <div className="px-6 py-4 flex items-center gap-3 bg-gradient-to-l from-violet-50/50 to-white dark:from-violet-950/30 dark:to-gray-900">
            <div className="h-11 w-11 rounded-xl bg-violet-600 text-white flex items-center justify-center shadow-lg">
              <Truck size={22} />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 dark:text-white">شركات ومناطق التوصيل</h1>
              <p className="text-xs text-slate-500 mt-0.5">أدر شركات التوصيل والمناطق والرسوم</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* إضافة شركة */}
          <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-gray-900/40 dark:border-white/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/5">
              <h2 className="text-sm font-black text-slate-800 dark:text-white">➕ إضافة شركة توصيل</h2>
            </div>
            <form onSubmit={addCompany} className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">اسم الشركة</label>
                  <input
                    type="text"
                    value={companyForm.name}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950"
                    placeholder="شركة التوصيل السريع"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">رقم الهاتف</label>
                  <input
                    type="tel"
                    value={companyForm.phone}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950"
                    placeholder="05xxxxxxxx"
                    dir="ltr"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">طريقة التسليم</label>
                  <select
                    value={companyForm.delivery_method}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, delivery_method: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950"
                  >
                    <option value="cod">دفع عند الاستلام</option>
                    <option value="prepaid">دفع مسبق</option>
                    <option value="both">كلاهما</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">تحصيل المبلغ</label>
                  <select
                    value={companyForm.collection_method}
                    onChange={(e) => setCompanyForm((f) => ({ ...f, collection_method: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950"
                  >
                    <option value="from_customer">من الزبون</option>
                    <option value="from_store">من المتجر</option>
                    <option value="both">كلاهما</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">ملاحظات (اختياري)</label>
                <textarea
                  value={companyForm.notes}
                  onChange={(e) => setCompanyForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950 resize-none"
                  placeholder="أي تفاصيل إضافية..."
                  rows={2}
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full bg-violet-600 text-white rounded-xl py-2.5 text-sm font-bold hover:bg-violet-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                إضافة الشركة
              </button>
            </form>
          </div>

          {/* إضافة منطقة */}
          <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-gray-900/40 dark:border-white/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/5">
              <h2 className="text-sm font-black text-slate-800 dark:text-white">📍 إضافة منطقة توصيل</h2>
            </div>
            <form onSubmit={addZone} className="p-5 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">اسم المنطقة</label>
                <input
                  type="text"
                  value={zoneForm.name}
                  onChange={(e) => setZoneForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950"
                  placeholder="نابلس، رام الله، جنين..."
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">رسوم التوصيل (₪)</label>
                  <input
                    type="number"
                    value={zoneForm.fee}
                    onChange={(e) => setZoneForm((f) => ({ ...f, fee: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950"
                    placeholder="0 = مجاني"
                    min="0" dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">الشركة (اختياري)</label>
                  <select
                    value={zoneForm.company_id}
                    onChange={(e) => setZoneForm((f) => ({ ...f, company_id: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2.5 text-sm bg-white dark:bg-gray-950"
                  >
                    <option value="">بدون شركة</option>
                    {companies.filter((c) => c.is_active).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full bg-violet-600 text-white rounded-xl py-2.5 text-sm font-bold hover:bg-violet-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                إضافة المنطقة
              </button>
            </form>
          </div>
        </div>

        {/* قائمة الشركات */}
        {companies.length > 0 && (
          <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-gray-900/40 dark:border-white/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/5">
              <h2 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                <Truck size={16} className="text-violet-500" />
                شركات التوصيل ({companies.length})
              </h2>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-white/5">
              {companies.map((c) => {
                const companyZones = zones.filter((z) => z.company_id === c.id);
                const expanded = expandedCompany === c.id;
                return (
                  <div key={c.id}>
                    <div className="px-5 py-4 flex items-center gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-800 dark:text-slate-200">{c.name}</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${c.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            {c.is_active ? 'نشطة' : 'معطّلة'}
                          </span>
                          <span className="text-xs text-slate-400 bg-slate-50 dark:bg-white/5 px-2 py-0.5 rounded-full">
                            {DELIVERY_METHOD_MAP[c.delivery_method]}
                          </span>
                          <span className="text-xs text-slate-400 bg-slate-50 dark:bg-white/5 px-2 py-0.5 rounded-full">
                            {COLLECTION_METHOD_MAP[c.collection_method]}
                          </span>
                        </div>
                        {c.phone && (
                          <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-xs text-slate-400 hover:text-violet-600 mt-1 w-fit">
                            <Phone size={11} />
                            <span dir="ltr">{c.phone}</span>
                          </a>
                        )}
                        {c.notes && <p className="text-xs text-slate-400 mt-1">{c.notes}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {companyZones.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setExpandedCompany(expanded ? null : c.id)}
                            className="text-xs font-bold text-slate-500 hover:text-violet-600 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 flex items-center gap-1 transition-colors"
                          >
                            <Package size={12} />
                            {companyZones.length} منطقة
                            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </button>
                        )}
                        <button type="button" onClick={() => toggleCompany(c.id, c.is_active)} className="text-xs font-bold text-slate-500 hover:text-violet-600 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 transition-colors">
                          {c.is_active ? 'تعطيل' : 'تفعيل'}
                        </button>
                        <button type="button" onClick={() => deleteCompany(c.id)} className="text-rose-400 hover:text-rose-600 transition-colors p-1">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    {expanded && companyZones.length > 0 && (
                      <div className="px-5 pb-4 space-y-2">
                        {companyZones.map((z) => (
                          <div key={z.id} className="flex items-center justify-between bg-slate-50 dark:bg-white/5 rounded-xl px-4 py-2.5">
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{z.name}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-black text-violet-600" dir="ltr">
                                {z.fee > 0 ? `₪ ${z.fee}` : 'مجاني'}
                              </span>
                              <button type="button" onClick={() => deleteZone(z.id)} className="text-rose-400 hover:text-rose-600 transition-colors">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* مناطق بدون شركة */}
        {zones.filter((z) => !z.company_id).length > 0 && (
          <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-gray-900/40 dark:border-white/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-white/5">
              <h2 className="text-sm font-black text-slate-800 dark:text-white">📍 مناطق بدون شركة محددة</h2>
            </div>
            <div className="p-4 space-y-2">
              {zones.filter((z) => !z.company_id).map((z) => (
                <div key={z.id} className="flex items-center justify-between bg-slate-50 dark:bg-white/5 rounded-xl px-4 py-2.5">
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{z.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-black text-violet-600" dir="ltr">
                      {z.fee > 0 ? `₪ ${z.fee}` : 'مجاني'}
                    </span>
                    <button type="button" onClick={() => deleteZone(z.id)} className="text-rose-400 hover:text-rose-600 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
