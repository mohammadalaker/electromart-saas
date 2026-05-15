import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Tag, Plus, Trash2, Save, Sparkles } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { normalizeItemFromSupabase, runProductsSelectWithFallback } from '../utils/productModel';
import { STORE_PROMOTIONS_TABLE } from '../utils/promotionEngine';

function isMissingTable(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || '');
  return err.code === 'PGRST205' || err.code === '42P01' || /does not exist|schema cache/i.test(msg);
}

export default function PromotionsAdminPage() {
  const { store, loading: storeLoading } = useStore();
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [error, setError] = useState(null);
  const [savingId, setSavingId] = useState(null);

  const [draft, setDraft] = useState({
    name_ar: '',
    kind: 'bundle_pair',
    sort_order: 0,
    trigger_product_id: '',
    reward_product_id: '',
    trigger_min_qty: 1,
    bundle_discount_percent: 50,
    min_total_units: 2,
    cart_discount_percent: 5,
  });

  const loadProducts = useCallback(async () => {
    if (!store?.id) return;
    const { data, error: e } = await runProductsSelectWithFallback((sel) =>
      supabase
        .from(PRODUCTS_TABLE)
        .select(sel)
        .eq('store_id', store.id)
        .order('eng_name', { ascending: true })
        .limit(2000)
    );
    if (!e) setProducts((data || []).map(normalizeItemFromSupabase).filter(Boolean));
  }, [store?.id]);

  const loadPromotions = useCallback(async () => {
    if (!store?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from(STORE_PROMOTIONS_TABLE)
      .select('*')
      .eq('store_id', store.id)
      .order('sort_order', { ascending: true });
    if (qErr) {
      if (isMissingTable(qErr)) {
        setMissingTable(true);
        setRows([]);
      } else {
        setError(qErr.message);
        setRows([]);
      }
    } else {
      setMissingTable(false);
      setRows(data || []);
    }
    setLoading(false);
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    loadProducts();
    loadPromotions();
  }, [storeLoading, loadProducts, loadPromotions]);

  const resetDraft = () => {
    setDraft({
      name_ar: '',
      kind: 'bundle_pair',
      sort_order: rows.length,
      trigger_product_id: '',
      reward_product_id: '',
      trigger_min_qty: 1,
      bundle_discount_percent: 50,
      min_total_units: 2,
      cart_discount_percent: 5,
    });
  };

  const buildConfig = () => {
    if (draft.kind === 'bundle_pair') {
      return {
        trigger_product_id: draft.trigger_product_id || null,
        reward_product_id: draft.reward_product_id || null,
        trigger_min_qty: Math.max(1, Number(draft.trigger_min_qty) || 1),
        discount_percent: Math.min(100, Math.max(0, Number(draft.bundle_discount_percent) || 0)),
      };
    }
    return {
      min_total_units: Math.max(2, Number(draft.min_total_units) || 2),
      discount_percent: Math.min(100, Math.max(0, Number(draft.cart_discount_percent) || 0)),
    };
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!store?.id || missingTable) return;
    const name = draft.name_ar.trim();
    if (!name) {
      setError('أدخل اسماً للعرض');
      return;
    }
    if (draft.kind === 'bundle_pair') {
      if (!draft.trigger_product_id || !draft.reward_product_id) {
        setError('اختر صنف المحفّز والمكافأة');
        return;
      }
      if (draft.trigger_product_id === draft.reward_product_id) {
        setError('لا يمكن أن يكون المحفّز والمكافأة نفس الصنف');
        return;
      }
    }
    setSavingId('new');
    setError(null);
    try {
      const payload = {
        store_id: store.id,
        name_ar: name,
        active: true,
        sort_order: Number(draft.sort_order) || 0,
        kind: draft.kind,
        config: buildConfig(),
      };
      const { error: insErr } = await supabase.from(STORE_PROMOTIONS_TABLE).insert([payload]);
      if (insErr) throw insErr;
      resetDraft();
      await loadPromotions();
    } catch (err) {
      setError(err.message || 'فشل الحفظ');
    } finally {
      setSavingId(null);
    }
  };

  const toggleActive = async (row) => {
    if (!store?.id) return;
    setSavingId(row.id);
    try {
      const { error: uErr } = await supabase
        .from(STORE_PROMOTIONS_TABLE)
        .update({ active: !row.active, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('store_id', store.id);
      if (uErr) throw uErr;
      await loadPromotions();
    } catch (err) {
      setError(err.message || 'فشل التحديث');
    } finally {
      setSavingId(null);
    }
  };

  const removeRow = async (id) => {
    if (!store?.id || !confirm('حذف هذا العرض؟')) return;
    setSavingId(id);
    try {
      const { error: dErr } = await supabase
        .from(STORE_PROMOTIONS_TABLE)
        .delete()
        .eq('id', id)
        .eq('store_id', store.id);
      if (dErr) throw dErr;
      await loadPromotions();
    } catch (err) {
      setError(err.message || 'فشل الحذف');
    } finally {
      setSavingId(null);
    }
  };

  const productLabel = (id) => {
    const p = products.find((x) => x.id === id);
    return p ? `${p.name} (${p.barcode || '—'})` : id?.slice(0, 8) || '—';
  };

  if (storeLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="animate-spin text-indigo-500" size={40} />
        </div>
      </DashboardLayout>
    );
  }

  if (!store?.id) {
    return (
      <DashboardLayout>
        <div
          className="rounded-2xl border border-amber-100 bg-amber-50/90 px-6 py-10 text-center text-amber-950 font-bold"
          dir="rtl"
        >
          لا يوجد متجر مرتبط بحسابك.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      actions={
        <Link
          to="/pos"
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          نقطة البيع (POS)
        </Link>
      }
    >
      <div className="max-w-4xl mx-auto space-y-6" dir="rtl">
        <div className="rounded-2xl border border-white/20 dark:border-gray-700/30 bg-white/80 dark:bg-gray-900/50 backdrop-blur-md p-6 shadow-sm">
          <h1 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
            <Sparkles className="text-amber-500 shrink-0" size={26} />
            العروض والخصومات الذكية
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
            عرّف عروضاً تُطبَّق تلقائياً في السلة: حزمة (اشترِ صنفاً واحصل على خصم على صنف آخر)، أو خصم نسبة
            عند تجاوز عدد قطع معيّن. الترتيب <strong>sort_order</strong> يحدّد أولوية حزم الشراء.
          </p>
        </div>

        {missingTable && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
            جدول العروض غير منشأ. نفّذ{' '}
            <code className="px-1 rounded bg-white/80">supabase/store_promotions.sql</code> في Supabase.
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
            {error}
          </div>
        )}

        <form
          onSubmit={handleCreate}
          className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900/40 p-6 space-y-4 shadow-sm"
        >
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Plus size={20} className="text-indigo-600" />
            عرض جديد
          </h2>

          <label className="block space-y-1">
            <span className="text-xs font-bold text-slate-600">اسم العرض (يظهر للبائع)</span>
            <input
              value={draft.name_ar}
              onChange={(e) => setDraft((p) => ({ ...p, name_ar: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2.5 text-sm"
              placeholder="مثال: غسالة + مكواة بخصم 50٪"
              disabled={missingTable}
            />
          </label>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block space-y-1">
              <span className="text-xs font-bold text-slate-600">نوع العرض</span>
              <select
                value={draft.kind}
                onChange={(e) => setDraft((p) => ({ ...p, kind: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2.5 text-sm"
                disabled={missingTable}
              >
                <option value="bundle_pair">حزمة: شراء صنف ← خصم على صنف آخر</option>
                <option value="cart_qty_discount">خصم على السلة عند عدد قطع</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-bold text-slate-600">ترتيب الأولوية (الأصغر أولاً)</span>
              <input
                type="number"
                value={draft.sort_order}
                onChange={(e) => setDraft((p) => ({ ...p, sort_order: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2.5 text-sm font-mono"
                disabled={missingTable}
              />
            </label>
          </div>

          {draft.kind === 'bundle_pair' ? (
            <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/50 dark:bg-indigo-950/20 dark:border-indigo-900/40 p-4">
              <p className="text-xs font-bold text-indigo-800 dark:text-indigo-200">
                عند وجود المحفّز والمكافأة معاً في السلة، يُطبَّق الخصم على أرخص وحدات المكافأة أولاً (حتى يطابق
                عدد «مجموعات» الحزمة).
              </p>
              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-600">الصنف المحفّز (اشترِ)</span>
                <select
                  value={draft.trigger_product_id}
                  onChange={(e) => setDraft((p) => ({ ...p, trigger_product_id: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2.5 text-sm"
                  disabled={missingTable}
                >
                  <option value="">— اختر —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.barcode}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-600">الصنف المكافأ (خصم عليه)</span>
                <select
                  value={draft.reward_product_id}
                  onChange={(e) => setDraft((p) => ({ ...p, reward_product_id: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2.5 text-sm"
                  disabled={missingTable}
                >
                  <option value="">— اختر —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.barcode}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-600">أقل كمية من المحفّز (لتكوين حزمة)</span>
                  <input
                    type="number"
                    min={1}
                    value={draft.trigger_min_qty}
                    onChange={(e) => setDraft((p) => ({ ...p, trigger_min_qty: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    disabled={missingTable}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-slate-600">نسبة الخصم على المكافأ (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.bundle_discount_percent}
                    onChange={(e) => setDraft((p) => ({ ...p, bundle_discount_percent: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    disabled={missingTable}
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-teal-100 bg-teal-50/50 dark:bg-teal-950/20 dark:border-teal-900/40 p-4">
              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-600">أقل مجموع قطع في السلة</span>
                <input
                  type="number"
                  min={2}
                  value={draft.min_total_units}
                  onChange={(e) => setDraft((p) => ({ ...p, min_total_units: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  disabled={missingTable}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-bold text-slate-600">نسبة الخصم على كل الأصناف (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.cart_discount_percent}
                  onChange={(e) => setDraft((p) => ({ ...p, cart_discount_percent: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  disabled={missingTable}
                />
              </label>
            </div>
          )}

          <button
            type="submit"
            disabled={missingTable || savingId === 'new'}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 text-white font-bold px-5 py-2.5 text-sm disabled:opacity-50"
          >
            {savingId === 'new' ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
            حفظ العرض
          </button>
        </form>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900/40 overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
            <Tag size={18} className="text-slate-500" />
            <h2 className="font-bold text-slate-900 dark:text-white">العروض الحالية</h2>
          </div>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="animate-spin text-indigo-500" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-10">لا توجد عروض بعد.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-600">
                    <th className="text-right py-2 px-3">الاسم</th>
                    <th className="text-right py-2 px-3">النوع</th>
                    <th className="text-right py-2 px-3">التفاصيل</th>
                    <th className="text-right py-2 px-3">حالة</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-2.5 px-3 font-bold">{r.name_ar}</td>
                      <td className="py-2.5 px-3 text-xs">
                        {r.kind === 'bundle_pair' ? 'حزمة' : 'خصم كمية'}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-slate-600 max-w-[280px]">
                        {r.kind === 'bundle_pair' ? (
                          <>
                            {productLabel(r.config?.trigger_product_id)} → {productLabel(r.config?.reward_product_id)}{' '}
                            (خصم {r.config?.discount_percent}%)
                          </>
                        ) : (
                          <>
                            من {r.config?.min_total_units} قطع: خصم {r.config?.discount_percent}%
                          </>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <button
                          type="button"
                          onClick={() => toggleActive(r)}
                          disabled={savingId === r.id}
                          className={`text-xs font-bold px-2 py-1 rounded-lg ${
                            r.active
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {r.active ? 'مفعّل' : 'متوقف'}
                        </button>
                      </td>
                      <td className="py-2.5 px-2">
                        <button
                          type="button"
                          onClick={() => removeRow(r.id)}
                          disabled={savingId === r.id}
                          className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg"
                          title="حذف"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
