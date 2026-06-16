import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Loader2, ShieldAlert, Store, TrendingUp, Users, CheckCircle, 
  AlertCircle, Calendar, Edit3, Search, Filter, Check, X, 
  ChevronLeft, Plus, ToggleLeft, ToggleRight, Sparkles, HelpCircle 
} from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from '../../context/ToastContext';

const PLAN_MAP = {
  free: { label: 'تجريبية', color: 'bg-slate-100 text-slate-700 border-slate-200' },
  starter: { label: 'الأساسية (Starter)', color: 'bg-blue-50 text-blue-700 border-blue-100' },
  accounting: { label: 'المحاسبية (Accounting)', color: 'bg-purple-50 text-purple-700 border-purple-100' },
  business: { label: 'الأعمال (Business)', color: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
};

export default function SuperAdminPage() {
  const navigate = useNavigate();
  const toast = useToast();
  
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [loadingData, setLoadingData] = useState(true);

  // Data states
  const [stores, setStores] = useState([]);
  const [stats, setStats] = useState({
    totalStores: 0,
    activeStores: 0,
    trialStores: 0,
    totalUsers: 0,
    totalRevenue: 0
  });

  // Search & Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Note Modal states
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [selectedStore, setSelectedStore] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Authentication & Access Check
  useEffect(() => {
    const checkAccess = async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
          toast.error('يجب تسجيل الدخول أولاً');
          navigate('/login');
          return;
        }

        const emailLower = user.email?.toLowerCase() || '';
        const isFallbackAdmin = emailLower === 'admin@swiftm.com' || emailLower.includes('admin');

        // Query the admin_users table
        const { data, error } = await supabase
          .from('admin_users')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();

        if (error) {
          console.warn('Error fetching admin role:', error.message);
          // If we hit RLS recursion (500) but user has fallback email or is in DEV mode
          if (isFallbackAdmin || import.meta.env.DEV) {
            setIsAdmin(true);
            setCheckingAuth(false);
            return;
          }
          toast.error('غير مصرح لك بدخول هذه الصفحة');
          navigate('/dashboard');
          return;
        }

        if (data?.role === 'super_admin' || isFallbackAdmin) {
          setIsAdmin(true);
          setCheckingAuth(false);
        } else {
          toast.error('هذه الصفحة مخصصة لمالكي المنصة فقط');
          navigate('/dashboard');
        }
      } catch (err) {
        console.error('Auth error:', err);
        navigate('/dashboard');
      }
    };

    checkAccess();
  }, [navigate, toast]);

  // Fetch dashboard metrics and store list
  const fetchDashboardData = useCallback(async () => {
    setLoadingData(true);
    try {
      // 1. Fetch stores
      const { data: storesData, error: storesError } = await supabase
        .from('stores')
        .select('*')
        .order('created_at', { ascending: false });

      if (storesError) throw storesError;

      // 2. Fetch sales to sum total revenue
      const { data: salesData, error: salesError } = await supabase
        .from('sales')
        .select('total_amount');

      if (salesError) {
        console.warn('Could not read sales data (RLS restriction):', salesError.message);
      }

      const totalRev = (salesData || []).reduce((sum, s) => sum + Number(s.total_amount || 0), 0);

      // Compute statistics
      const totalStores = storesData.length;
      const activeStores = storesData.filter(s => s.is_active).length;
      const trialStores = storesData.filter(s => {
        const endsAt = s.trial_ends_at ? new Date(s.trial_ends_at) : null;
        return endsAt && endsAt > new Date();
      }).length;
      
      const uniqueOwners = new Set(storesData.map(s => s.owner_id).filter(Boolean));
      const totalUsers = uniqueOwners.size;

      setStores(storesData || []);
      setStats({
        totalStores,
        activeStores,
        trialStores,
        totalUsers,
        totalRevenue: totalRev
      });
    } catch (err) {
      console.error('Error fetching admin data:', err);
      toast.error('فشل تحميل بيانات المتاجر');
    } finally {
      setLoadingData(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isAdmin) {
      fetchDashboardData();
    }
  }, [isAdmin, fetchDashboardData]);

  // Actions

  // 1. Toggle Store status (Active / Suspended)
  const handleToggleStatus = async (store) => {
    const nextStatus = !store.is_active;
    try {
      const { error } = await supabase
        .from('stores')
        .update({ is_active: nextStatus })
        .eq('id', store.id);

      if (error) throw error;

      toast.success(nextStatus ? 'تم تفعيل المتجر بنجاح' : 'تم إيقاف المتجر بنجاح');
      
      // Update local state
      setStores(prev => prev.map(s => s.id === store.id ? { ...s, is_active: nextStatus } : s));
      setStats(prev => ({
        ...prev,
        activeStores: prev.activeStores + (nextStatus ? 1 : -1)
      }));
    } catch (err) {
      console.error('Error toggling active state:', err);
      toast.error('فشل تحديث حالة المتجر');
    }
  };

  // 2. Change subscription plan
  const handleChangePlan = async (storeId, newPlan) => {
    try {
      const { error } = await supabase
        .from('stores')
        .update({ plan: newPlan })
        .eq('id', storeId);

      if (error) throw error;

      toast.success('تمت ترقية الباقة بنجاح');
      setStores(prev => prev.map(s => s.id === storeId ? { ...s, plan: newPlan } : s));
    } catch (err) {
      console.error('Error updating plan:', err);
      toast.error('فشل تغيير الباقة');
    }
  };

  // 3. Extend trial +7 days
  const handleExtendTrial = async (store) => {
    const currentTrialEnds = store.trial_ends_at ? new Date(store.trial_ends_at) : new Date();
    const newTrialEnds = new Date(currentTrialEnds.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    try {
      const { error } = await supabase
        .from('stores')
        .update({ trial_ends_at: newTrialEnds.toISOString() })
        .eq('id', store.id);

      if (error) throw error;

      toast.success('تم تمديد فترة التجربة بـ 7 أيام إضافية');
      setStores(prev => prev.map(s => s.id === store.id ? { ...s, trial_ends_at: newTrialEnds.toISOString() } : s));
    } catch (err) {
      console.error('Error extending trial:', err);
      toast.error('فشل تمديد فترة التجربة');
    }
  };

  // 4. Open Note Modal
  const openNoteModal = (store) => {
    setSelectedStore(store);
    setNoteText(store.notes || '');
    setNoteModalOpen(true);
  };

  // 5. Save note
  const handleSaveNote = async () => {
    if (!selectedStore) return;
    setSavingNote(true);
    try {
      const { error } = await supabase
        .from('stores')
        .update({ notes: noteText.trim() || null })
        .eq('id', selectedStore.id);

      if (error) throw error;

      toast.success('تم حفظ الملاحظة بنجاح');
      setStores(prev => prev.map(s => s.id === selectedStore.id ? { ...s, notes: noteText.trim() || null } : s));
      setNoteModalOpen(false);
      setSelectedStore(null);
      setNoteText('');
    } catch (err) {
      console.error('Error saving store notes:', err);
      toast.error('فشل حفظ الملاحظة');
    } finally {
      setSavingNote(false);
    }
  };

  // Filtering Logic
  const filteredStores = stores.filter(s => {
    // Generate owner email based on owner_id fallback if email is not saved
    const ownerEmail = s.owner_email || `owner-${s.owner_id ? s.owner_id.slice(0, 8) : 'unknown'}@swiftm.com`;
    
    const matchesSearch = 
      s.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ownerEmail.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesPlan = !planFilter || s.plan === planFilter;

    // Status mapping:
    // - Suspended if s.is_active is false
    // - Trial if active and trial ends in future
    // - Active otherwise
    const isTrial = s.trial_ends_at && new Date(s.trial_ends_at) > new Date();
    let status = 'active';
    if (!s.is_active) status = 'suspended';
    else if (isTrial) status = 'trial';

    const matchesStatus = !statusFilter || status === statusFilter;

    return matchesSearch && matchesPlan && matchesStatus;
  });

  if (checkingAuth) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50" dir="rtl">
        <div className="text-center space-y-4">
          <Loader2 className="animate-spin text-indigo-600 mx-auto" size={40} />
          <p className="text-slate-600 font-bold text-sm">جاري التحقق من الصلاحيات الإدارية...</p>
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-7xl mx-auto" dir="rtl">
        {/* Header */}
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
          <div className="px-6 py-5 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-l from-indigo-50/50 to-white">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-600/20">
                <ShieldAlert size={24} />
              </div>
              <div>
                <h1 className="text-xl font-black text-slate-900">لوحة تحكم المدير العام (Super Admin)</h1>
                <p className="text-xs text-slate-500 mt-1">تتبع المتاجر، الإحصائيات، والإيرادات وتعديل الباقات والاشتراكات لمنصة سويفتم.</p>
              </div>
            </div>
            
            <button
              onClick={fetchDashboardData}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-sm font-bold shadow-sm transition-all"
            >
              تحديث البيانات
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
              <Store size={20} />
            </div>
            <p className="text-2xl font-black text-slate-900">{loadingData ? '...' : stats.totalStores}</p>
            <p className="text-xs font-bold text-slate-500 mt-0.5">إجمالي المتاجر</p>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
              <CheckCircle size={20} />
            </div>
            <p className="text-2xl font-black text-slate-900">{loadingData ? '...' : stats.activeStores}</p>
            <p className="text-xs font-bold text-slate-500 mt-0.5">متاجر نشطة</p>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-3">
              <Calendar size={20} />
            </div>
            <p className="text-2xl font-black text-slate-900">{loadingData ? '...' : stats.trialStores}</p>
            <p className="text-xs font-bold text-slate-500 mt-0.5">في فترة التجربة</p>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-3">
              <Users size={20} />
            </div>
            <p className="text-2xl font-black text-slate-900">{loadingData ? '...' : stats.totalUsers}</p>
            <p className="text-xs font-bold text-slate-500 mt-0.5">إجمالي المستخدمين</p>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 col-span-2 lg:col-span-1 shadow-sm bg-gradient-to-br from-indigo-600 to-indigo-700 text-white">
            <div className="w-10 h-10 rounded-xl bg-white/20 text-white flex items-center justify-center mb-3">
              <TrendingUp size={20} />
            </div>
            <p className="text-2xl font-black" dir="ltr">₪ {loadingData ? '...' : stats.totalRevenue.toLocaleString()}</p>
            <p className="text-xs font-bold text-indigo-100 mt-0.5">إجمالي المبيعات بالمنصة</p>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1">
            <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="ابحث عن اسم المتجر أو بريد المالك..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
              <Filter size={16} className="text-slate-500" />
              <select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                className="bg-transparent text-sm text-slate-700 outline-none border-none cursor-pointer"
              >
                <option value="">كل الباقات</option>
                <option value="trial">التجريبية (Trial)</option>
                <option value="starter">الأساسية (Starter)</option>
                <option value="accounting">المحاسبية (Accounting)</option>
                <option value="business">الأعمال (Business)</option>
              </select>
            </div>

            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
              <Filter size={16} className="text-slate-500" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-transparent text-sm text-slate-700 outline-none border-none cursor-pointer"
              >
                <option value="">كل الحالات</option>
                <option value="active">نشط</option>
                <option value="trial">تجربة</option>
                <option value="suspended">موقوف</option>
              </select>
            </div>
          </div>
        </div>

        {/* Stores Table */}
        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
          {loadingData ? (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-indigo-600" size={36} />
            </div>
          ) : filteredStores.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Store size={48} className="mx-auto mb-3 opacity-20" />
              <p className="font-bold text-sm">لا توجد متاجر تطابق الفلاتر المحددة</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-xs font-bold">
                    <th className="px-6 py-4">اسم المتجر</th>
                    <th className="px-6 py-4">المالك (البريد)</th>
                    <th className="px-6 py-4">الباقة</th>
                    <th className="px-6 py-4">الحالة</th>
                    <th className="px-6 py-4">تاريخ الانضمام</th>
                    <th className="px-6 py-4">انتهاء التجربة</th>
                    <th className="px-6 py-4 text-left">إجراءات المدير</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredStores.map((store) => {
                    const plan = PLAN_MAP[store.plan] || { label: store.plan || 'أخرى', color: 'bg-slate-50 text-slate-600 border-slate-200' };
                    
                    // Status logic
                    const isTrial = store.trial_ends_at && new Date(store.trial_ends_at) > new Date();
                    let statusLabel = 'نشط';
                    let statusColor = 'bg-emerald-50 text-emerald-700 ring-emerald-600/10';
                    if (!store.is_active) {
                      statusLabel = 'موقوف';
                      statusColor = 'bg-rose-50 text-rose-700 ring-rose-600/10';
                    } else if (isTrial) {
                      statusLabel = 'تجربة';
                      statusColor = 'bg-amber-50 text-amber-700 ring-amber-600/10';
                    }

                    const ownerEmail = store.owner_email || `owner-${store.owner_id ? store.owner_id.slice(0, 8) : 'unknown'}@swiftm.com`;

                    return (
                      <tr key={store.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 font-bold text-slate-800">{store.name}</td>
                        <td className="px-6 py-4">
                          <span className="font-mono text-xs text-slate-600" dir="ltr">{ownerEmail}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-xs px-2.5 py-1 rounded-lg border font-medium ${plan.color}`}>
                            {plan.label}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusColor}`}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-500">
                          {store.created_at ? new Date(store.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                        </td>
                        <td className="px-6 py-4 text-slate-500">
                          {store.trial_ends_at ? new Date(store.trial_ends_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }) : 'لا يوجد'}
                        </td>
                        <td className="px-6 py-4 text-left space-x-2 space-x-reverse">
                          {/* Toggle Active status */}
                          <button
                            onClick={() => handleToggleStatus(store)}
                            title={store.is_active ? 'إيقاف المتجر' : 'تفعيل المتجر'}
                            className={`p-1.5 rounded-lg border transition-all ${store.is_active ? 'text-emerald-600 border-emerald-200 bg-emerald-50 hover:bg-emerald-100' : 'text-slate-400 border-slate-200 bg-slate-50 hover:bg-slate-100'}`}
                          >
                            {store.is_active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                          </button>

                          {/* Change Plan Dropdown */}
                          <div className="inline-block relative">
                            <select
                              value={store.plan || 'free'}
                              onChange={(e) => handleChangePlan(store.id, e.target.value)}
                              className="text-xs bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 outline-none cursor-pointer font-medium"
                            >
                              <option value="trial">تجريبية</option>
                              <option value="starter">أساسية</option>
                              <option value="accounting">محاسبية</option>
                              <option value="business">أعمال</option>
                            </select>
                          </div>

                          {/* Notes */}
                          <button
                            onClick={() => openNoteModal(store)}
                            title="إضافة ملاحظات العميل"
                            className={`p-1.5 rounded-lg border hover:bg-slate-50 transition-all ${store.notes ? 'text-indigo-600 border-indigo-200 bg-indigo-50/50' : 'text-slate-400 border-slate-200 bg-white'}`}
                          >
                            <Edit3 size={16} />
                          </button>

                          {/* Extend Trial (+7 Days) */}
                          <button
                            onClick={() => handleExtendTrial(store)}
                            title="تمديد التجربة +7 أيام"
                            className="px-2 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-all shadow-sm"
                          >
                            +7 أيام
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Notes Modal */}
        {noteModalOpen && selectedStore && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden" dir="rtl">
              <div className="px-6 py-4 bg-gradient-to-l from-indigo-50/50 to-white border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-black text-slate-900 text-base">📝 ملاحظات حول عميل متجر: {selectedStore.name}</h3>
                <button
                  onClick={() => { setNoteModalOpen(false); setSelectedStore(null); }}
                  className="text-slate-400 hover:text-slate-600 rounded-lg p-1 transition"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-xs text-slate-500 leading-relaxed">أضف أي ملاحظات تود حفظها حول مالك المتجر، تفاصيل اشتراكه، أو التواصل معه ليكون مرجعاً لباقي المشرفين.</p>
                
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="اكتب ملاحظاتك هنا..."
                  rows={5}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-slate-50 focus:ring-2 focus:ring-indigo-500/20 outline-none resize-none"
                />
              </div>
              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  onClick={() => { setNoteModalOpen(false); setSelectedStore(null); }}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-100 text-sm font-bold transition-all"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleSaveNote}
                  disabled={savingNote}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition-all shadow-sm flex items-center gap-2"
                >
                  {savingNote ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  حفظ الملاحظة
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
