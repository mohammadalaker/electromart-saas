import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Scale,
  Plus,
  Edit2,
  Trash2,
  Search,
  ChevronDown,
  ChevronRight,
  Loader2,
  Folder,
  FileText,
  AlertCircle,
  HelpCircle,
  RefreshCw,
} from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { supabase } from '../../lib/supabaseClient';
import { useStore } from '../../context/StoreContext';
import { useToast } from '../../context/ToastContext';

const ACCOUNTS_TABLE = 'accounting_accounts';

const toEnglishNumbers = (str) => {
  return String(str).replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => d.charCodeAt(0) - 1632)
                    .replace(/[۰۱۲۳۴۵۶۷۸۹]/g, d => d.charCodeAt(0) - 1776);
};

const TYPE_LABELS = {
  asset: { label: 'أصول', colorClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  liability: { label: 'خصوم', colorClass: 'bg-rose-500/10 text-rose-400 border-rose-500/20' },
  equity: { label: 'حقوق الملكية', colorClass: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  revenue: { label: 'إيرادات', colorClass: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
  expense: { label: 'مصروفات', colorClass: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
};

const DEFAULT_ACCOUNTS = [
  { code: '1000', name: 'الأصول المتداولة', type: 'asset', category: 'أصول متداولة', parent_code: null },
  { code: '1001', name: 'الصندوق النقدي', type: 'asset', category: 'نقدية وما يعادلها', parent_code: '1000' },
  { code: '1002', name: 'البنك', type: 'asset', category: 'نقدية وما يعادلها', parent_code: '1000' },
  { code: '1100', name: 'المخزون', type: 'asset', category: 'مخزون', parent_code: '1000' },
  { code: '1200', name: 'ذمم مدينون (العملاء)', type: 'asset', category: 'ذمم مدينة', parent_code: '1000' },
  { code: '2000', name: 'الالتزامات المتداولة', type: 'liability', category: 'التزامات متداولة', parent_code: null },
  { code: '2100', name: 'ذمم دائنون (الموردون)', type: 'liability', category: 'ذمم دائنة', parent_code: '2000' },
  { code: '3000', name: 'حقوق الملكية', type: 'equity', category: 'حقوق ملكية', parent_code: null },
  { code: '3001', name: 'رأس المال', type: 'equity', category: 'رأس المال', parent_code: '3000' },
  { code: '4000', name: 'الإيرادات', type: 'revenue', category: 'إيرادات', parent_code: null },
  { code: '4001', name: 'إيرادات المبيعات', type: 'revenue', category: 'إيرادات مبيعات', parent_code: '4000' },
  { code: '5000', name: 'تكلفة المبيعات', type: 'expense', category: 'تكلفة البضاعة المباعة', parent_code: null },
  { code: '5001', name: 'تكلفة البضاعة المباعة', type: 'expense', category: 'تكلفة البضاعة المباعة', parent_code: '5000' },
  { code: '6000', name: 'المصروفات التشغيلية', type: 'expense', category: 'مصروفات', parent_code: null },
  { code: '6001', name: 'المصروفات العمومية والإدارية', type: 'expense', category: 'مصروفات تشغيلية', parent_code: '6000' },
];

export default function ChartOfAccountsPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Expand/collapse tree state
  const [expandedNodes, setExpandedNodes] = useState({});

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editAccount, setEditAccount] = useState(null);

  // Form fields
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('asset');
  const [category, setCategory] = useState('');
  const [parentId, setParentId] = useState('');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);

  // Fetch accounts
  const loadAccounts = useCallback(async () => {
    if (!store?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from(ACCOUNTS_TABLE)
        .select('*')
        .eq('store_id', store.id)
        .order('code', { ascending: true });

      if (fetchErr) throw fetchErr;
      setAccounts(data || []);
    } catch (e) {
      console.error(e);
      if (/does not exist|schema cache|PGRST205|42P01/i.test(e.message || '')) {
        setError('جدول دليل الحسابات غير منشأ في قاعدة البيانات. يرجى تنفيذ ملف accounting_accounts.sql.');
      } else {
        setError(e.message || 'تعذر تحميل دليل الحسابات');
      }
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    loadAccounts();
  }, [storeLoading, loadAccounts]);

  // Handle Seeding
  const handleSeedDefaults = async () => {
    if (!store?.id) return;
    setSaving(true);
    try {
      const roots = DEFAULT_ACCOUNTS.filter((a) => !a.parent_code);
      const children = DEFAULT_ACCOUNTS.filter((a) => a.parent_code);

      // Insert roots
      const rootsToInsert = roots.map(({ code, name, type, category }) => ({
        store_id: store.id,
        code,
        name,
        type,
        category,
        is_active: true,
      }));
      const { data: createdRoots, error: rootsErr } = await supabase
        .from(ACCOUNTS_TABLE)
        .insert(rootsToInsert)
        .select('id, code');
      if (rootsErr) throw rootsErr;

      // Map root codes to IDs
      const codeToId = {};
      createdRoots.forEach((r) => {
        codeToId[r.code] = r.id;
      });

      // Insert children
      const childrenToInsert = children.map(({ code, name, type, category, parent_code }) => ({
        store_id: store.id,
        code,
        name,
        type,
        category,
        is_active: true,
        parent_id: codeToId[parent_code] || null,
      }));
      const { error: childrenErr } = await supabase
        .from(ACCOUNTS_TABLE)
        .insert(childrenToInsert);
      if (childrenErr) throw childrenErr;

      toast.success('تم إنشاء دليل الحسابات الافتراضي بنجاح');
      loadAccounts();
    } catch (e) {
      console.error(e);
      toast.error('حدث خطأ أثناء استيراد الحسابات: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Open Modal for Add
  const handleOpenAddModal = (initialParentId = '') => {
    setEditAccount(null);
    setCode('');
    setName('');
    setType('asset');
    setCategory('');
    setParentId(initialParentId);
    setNotes('');
    setIsActive(true);
    setModalOpen(true);
  };

  // Open Modal for Edit
  const handleOpenEditModal = (account) => {
    setEditAccount(account);
    setCode(account.code);
    setName(account.name);
    setType(account.type);
    setCategory(account.category);
    setParentId(account.parent_id || '');
    setNotes(account.notes || '');
    setIsActive(account.is_active);
    setModalOpen(true);
  };

  // Check recursive parent cycle
  const isDescendant = useCallback((parentIdToCheck, currentAccountId) => {
    if (!parentIdToCheck) return false;
    let curr = accounts.find((a) => a.id === parentIdToCheck);
    while (curr) {
      if (curr.id === currentAccountId) return true;
      if (!curr.parent_id) break;
      curr = accounts.find((a) => a.id === curr.parent_id);
    }
    return false;
  }, [accounts]);

  // Save Account (Add or Edit)
  const handleSaveAccount = async (e) => {
    e.preventDefault();
    if (!store?.id) return;
    if (!code.trim() || !name.trim()) {
      toast.warning('يرجى ملء الحقول المطلوبة (الرمز والاسم)');
      return;
    }

    // Check code uniqueness local pre-check (only for adding or code change)
    if (!editAccount || editAccount.code !== code.trim()) {
      const codeExists = accounts.some((a) => a.code === code.trim());
      if (codeExists) {
        toast.error('رمز الحساب هذا مستخدم بالفعل. يرجى اختيار رمز فريد.');
        return;
      }
    }

    // Avoid self-parenting and recursive loops
    if (editAccount) {
      if (parentId === editAccount.id) {
        toast.warning('لا يمكن للحساب أن يكون أباً لنفسه.');
        return;
      }
      if (parentId && isDescendant(parentId, editAccount.id)) {
        toast.warning('لا يمكن اختيار حساب تابع كحساب أب (سيؤدي ذلك إلى حلقة تكرارية).');
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        code: code.trim(),
        name: name.trim(),
        type,
        category: category.trim(),
        parent_id: parentId || null,
        notes: notes.trim(),
        is_active: isActive,
      };

      if (editAccount) {
        const { error: updateErr } = await supabase
          .from(ACCOUNTS_TABLE)
          .update(payload)
          .eq('id', editAccount.id);
        if (updateErr) throw updateErr;
        toast.success('تم تعديل الحساب بنجاح');
      } else {
        const { error: insertErr } = await supabase
          .from(ACCOUNTS_TABLE)
          .insert({
            ...payload,
            store_id: store.id,
          });
        if (insertErr) throw insertErr;
        toast.success('تم إضافة الحساب بنجاح');
      }
      setModalOpen(false);
      loadAccounts();
    } catch (err) {
      console.error(err);
      toast.error('فشل في حفظ الحساب: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Delete Account
  const handleDeleteAccount = async (account) => {
    // Check if account has children
    const hasChildren = accounts.some((a) => a.parent_id === account.id);
    if (hasChildren) {
      toast.error('لا يمكن حذف هذا الحساب لأنه يحتوي على حسابات تابعة. يرجى حذف التوابع أو تغيير آبائها أولاً.');
      return;
    }

    if (!window.confirm(`هل أنت متأكد من رغبتك في حذف الحساب: ${account.name} (${account.code})؟`)) {
      return;
    }

    try {
      const { error: delErr } = await supabase
        .from(ACCOUNTS_TABLE)
        .delete()
        .eq('id', account.id);
      if (delErr) throw delErr;
      toast.success('تم حذف الحساب بنجاح');
      loadAccounts();
    } catch (err) {
      console.error(err);
      toast.error('فشل في حذف الحساب: ' + err.message);
    }
  };

  const toggleExpand = (id) => {
    setExpandedNodes((prev) => ({
      ...prev,
      [id]: prev[id] === false ? true : false, // Defaults to expanded (true)
    }));
  };

  // Build Hierarchy for each type
  const groupedTrees = useMemo(() => {
    // 1. Filter raw list based on query
    const filtered = accounts.filter((a) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.category && a.category.toLowerCase().includes(q))
      );
    });

    // Helper to build tree per type
    const buildTree = (typeAccounts) => {
      const map = {};
      const roots = [];

      typeAccounts.forEach((a) => {
        map[a.id] = { ...a, children: [] };
      });

      typeAccounts.forEach((a) => {
        // If it has a parent and the parent is also in our current filtered list, nest it
        if (a.parent_id && map[a.parent_id]) {
          map[a.parent_id].children.push(map[a.id]);
        } else {
          roots.push(map[a.id]);
        }
      });

      // Sort children by code
      const sortCode = (arr) => {
        arr.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
        arr.forEach((item) => {
          if (item.children.length > 0) {
            sortCode(item.children);
          }
        });
      };
      sortCode(roots);
      return roots;
    };

    const types = ['asset', 'liability', 'equity', 'revenue', 'expense'];
    const result = {};
    types.forEach((t) => {
      const typeAccs = filtered.filter((a) => a.type === t);
      result[t] = buildTree(typeAccs);
    });

    return result;
  }, [accounts, searchQuery]);

  // List of potential parent accounts (of same type, excluding current editing node & descendants)
  const parentCandidates = useMemo(() => {
    return accounts.filter((a) => {
      if (a.type !== type) return false;
      if (editAccount) {
        if (a.id === editAccount.id) return false;
        if (isDescendant(a.id, editAccount.id)) return false;
      }
      return true;
    });
  }, [accounts, type, editAccount, isDescendant]);

  // Recursive Tree Component Renderer
  const renderTreeNode = (node, depth = 0) => {
    const isExpanded = expandedNodes[node.id] !== false;
    const hasChildren = node.children && node.children.length > 0;

    return (
      <div key={node.id} className="relative">
        <div className="flex items-center justify-between py-2.5 px-4 rounded-xl hover:bg-white/5 transition-all group border-b border-white/[0.03]">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Collapse/Expand Toggle */}
            <button
              onClick={() => toggleExpand(node.id)}
              disabled={!hasChildren}
              className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                hasChildren ? 'text-indigo-400 hover:bg-white/10' : 'text-slate-600'
              }`}
            >
              {hasChildren ? (
                isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
              )}
            </button>

            {/* Folder/File Icon */}
            <span className={hasChildren ? 'text-indigo-400' : 'text-slate-400'}>
              {hasChildren ? <Folder size={18} /> : <FileText size={18} />}
            </span>

            {/* Code */}
            <span className="font-mono text-xs font-bold text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 shrink-0">
              {node.code}
            </span>

            {/* Name */}
            <span className="text-sm font-bold text-slate-100 truncate">
              {node.name}
            </span>

            {/* Category */}
            {node.category && (
              <span className="text-[11px] font-bold text-slate-400 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                {node.category}
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {/* Status Dot */}
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${node.is_active ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-rose-400'}`} />
              <span className="text-[11px] font-bold text-slate-400 hidden sm:inline">
                {node.is_active ? 'نشط' : 'معطل'}
              </span>
            </span>

            {/* Hover Actions */}
            <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={() => handleOpenAddModal(node.id)}
                title="إضافة حساب تابع"
                className="p-1.5 rounded-lg hover:bg-indigo-500/20 text-indigo-300 hover:text-indigo-200 transition-colors"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                onClick={() => handleOpenEditModal(node)}
                title="تعديل الحساب"
                className="p-1.5 rounded-lg hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 transition-colors"
              >
                <Edit2 size={14} />
              </button>
              <button
                type="button"
                onClick={() => handleDeleteAccount(node)}
                title="حذف الحساب"
                className="p-1.5 rounded-lg hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Children Container */}
        {hasChildren && isExpanded && (
          <div className="relative pr-5 mr-3 mt-1 border-r border-white/5">
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleOpenAddModal()}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-black text-white hover:from-indigo-700 hover:to-violet-700 shadow-md shadow-indigo-500/10 hover:shadow-indigo-500/20 transition-all"
          >
            <Plus size={16} />
            إضافة حساب جديد
          </button>
          <button
            type="button"
            onClick={loadAccounts}
            className="inline-flex items-center justify-center p-2.5 rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            title="تحديث البيانات"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      }
    >
      <div className="max-w-6xl mx-auto space-y-6" dir="rtl">
        {/* Header Block */}
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 shrink-0">
            <Scale size={26} />
          </div>
          <div>
            <h1 className="font-title text-2xl font-black text-slate-100">دليل الحسابات (Chart of Accounts)</h1>
            <p className="text-sm text-slate-400 font-bold mt-0.5 leading-relaxed">
              إدارة شجرة الحسابات المالية للمتجر. تصفح، أضف، وعدّل الحسابات للأصول، الخصوم، حقوق الملكية، الإيرادات، والمصروفات بشكل هرمي.
            </p>
          </div>
        </div>

        {/* Database missing notification */}
        {error && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 backdrop-blur-md px-5 py-4 flex gap-3 items-start text-amber-200">
            <AlertCircle className="shrink-0 text-amber-400 mt-0.5" size={20} />
            <div>
              <p className="text-sm font-black leading-snug">{error}</p>
              <p className="text-xs text-amber-400/80 font-bold mt-1.5">
                تأكد من تنفيذ ملف SQL في محرر سوبابيس لتفعيل شاشة دليل الحسابات.
              </p>
            </div>
          </div>
        )}

        {/* Search Bar */}
        {!error && (
          <div className="relative rounded-2xl border border-white/10 bg-slate-900/40 backdrop-blur-md p-4 shadow-xl">
            <div className="relative">
              <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="ابحث برمز الحساب، الاسم، أو التصنيف..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 pr-11 pl-4 py-3 text-sm font-bold text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
              />
            </div>
          </div>
        )}

        {/* Loader */}
        {loading ? (
          <div className="flex flex-col justify-center items-center py-24 gap-3">
            <Loader2 className="animate-spin text-indigo-400" size={40} />
            <span className="text-sm font-bold text-slate-400">جاري تحميل دليل الحسابات...</span>
          </div>
        ) : !error && accounts.length === 0 ? (
          /* Empty Seeding Panel */
          <div className="rounded-2xl border border-dashed border-white/15 bg-slate-900/30 p-12 text-center flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400">
              <Scale size={32} />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-200">دليل الحسابات فارغ</h3>
              <p className="text-sm text-slate-400 font-bold max-w-md mx-auto mt-1 leading-relaxed">
                لم يتم إعداد أي حسابات محاسبية لمتجرك حتى الآن. يمكنك استيراد دليل الحسابات الافتراضي المكون من 15 حساباً قياسياً.
              </p>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={handleSeedDefaults}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-lg shadow-indigo-600/10 hover:shadow-indigo-600/20"
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
              استيراد دليل الحسابات الافتراضي
            </button>
          </div>
        ) : !error ? (
          /* Tree Sections grouped by type */
          <div className="grid grid-cols-1 gap-6">
            {Object.entries(TYPE_LABELS).map(([typeKey, typeMeta]) => {
              const typeRoots = groupedTrees[typeKey] || [];
              const hasNoRoots = typeRoots.length === 0;

              return (
                <div
                  key={typeKey}
                  className="rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-md overflow-hidden shadow-xl"
                >
                  {/* Category Header */}
                  <div className="px-5 py-4 border-b border-white/5 bg-white/[0.02] flex justify-between items-center">
                    <div className="flex items-center gap-2.5">
                      <span className={`inline-block rounded-full px-3 py-1 text-xs font-black border ${typeMeta.colorClass}`}>
                        {typeMeta.label}
                      </span>
                      <span className="text-xs font-bold text-slate-400">
                        {accounts.filter((a) => a.type === typeKey).length} حساب
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setType(typeKey);
                        handleOpenAddModal();
                      }}
                      className="text-xs font-bold text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1"
                    >
                      <Plus size={14} />
                      إضافة حساب
                    </button>
                  </div>

                  {/* Node Tree list */}
                  <div className="p-4 space-y-1">
                    {hasNoRoots ? (
                      <p className="text-xs text-slate-500 font-bold py-6 text-center">
                        لا توجد حسابات مضافة من نوع {typeMeta.label}.
                      </p>
                    ) : (
                      typeRoots.map((root) => renderTreeNode(root))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Add / Edit Glassmorphic Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" dir="rtl">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900/90 backdrop-blur-xl p-6 shadow-2xl space-y-5">
            {/* Header */}
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-black text-slate-100">
                {editAccount ? `تعديل الحساب: ${editAccount.name}` : 'إضافة حساب مالي جديد'}
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
              >
                &times;
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveAccount} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Code */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5">رمز الحساب *</label>
                  <input
                    type="text"
                    required
                    placeholder="مثال: 1001"
                    value={code}
                    onInput={(e) => { e.target.value = toEnglishNumbers(e.target.value); }}
                    onChange={(e) => { e.target.value = toEnglishNumbers(e.target.value); setCode(e.target.value); }}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm font-bold text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50"
                  />
                </div>

                {/* Name */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5">اسم الحساب *</label>
                  <input
                    type="text"
                    required
                    placeholder="مثال: الصندوق"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm font-bold text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Type */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5">نوع الحساب *</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm font-bold text-slate-200 focus:outline-none focus:border-indigo-500/50"
                  >
                    {Object.entries(TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k} className="bg-slate-900 text-slate-200">
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Category */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1.5">التصنيف</label>
                  <input
                    type="text"
                    placeholder="مثال: نقدية، ذمم مدينة"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm font-bold text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50"
                  />
                </div>
              </div>

              {/* Parent Account */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1.5 flex items-center gap-1">
                  الحساب الأب (إن وجد)
                  <span className="text-[10px] text-slate-500">(يقتصر على حسابات نفس النوع)</span>
                </label>
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm font-bold text-slate-200 focus:outline-none focus:border-indigo-500/50"
                >
                  <option value="" className="bg-slate-900 text-slate-400">بدون حساب أب (حساب رئيسي)</option>
                  {parentCandidates.map((cand) => (
                    <option key={cand.id} value={cand.id} className="bg-slate-900 text-slate-200">
                      [{cand.code}] - {cand.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1.5">ملاحظات الحساب</label>
                <textarea
                  rows={2}
                  placeholder="ملاحظات تفصيلية..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm font-bold text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 resize-none"
                />
              </div>

              {/* Is Active Toggle */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active_chk"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 bg-black/40 border-white/10 rounded focus:ring-indigo-500"
                />
                <label htmlFor="is_active_chk" className="text-xs font-bold text-slate-300 cursor-pointer select-none">
                  حساب نشط ومتاح للاستخدام في القيود
                </label>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-3 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 px-5 py-2.5 text-xs font-bold transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 text-xs font-black transition-all shadow-md shadow-indigo-600/10"
                >
                  {saving && <Loader2 className="animate-spin" size={14} />}
                  {editAccount ? 'تعديل الحساب' : 'إضافة الحساب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
