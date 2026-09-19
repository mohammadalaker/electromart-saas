import { useState, useEffect, useRef } from 'react';
import {
  Building2,
  User,
  Phone,
  Smartphone,
  MapPin,
  Building,
  ShieldCheck,
  FileText,
  X,
  Loader2,
  Save,
  Plus,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';

const CONTACTS_TABLE = 'store_contacts';

const emptyForm = {
  name: '',
  contact_person_name: '',
  phone: '',
  mobile_phone: '',
  city: '',
  address: '',
  licensed_operator: '',
  notes: '',
};

/**
 * مكون موحد لإضافة أو تعديل مورد
 * يتضمن الحقول الثمانية:
 * 1. اسم المورد أو الشركة (name) - إلزامي
 * 2. اسم مسؤول الحساب (contact_person_name) - اختياري
 * 3. رقم هاتف الشركة (phone) - اختياري
 * 4. رقم الهاتف النقال (mobile_phone) - اختياري
 * 5. المدينة (city) - اختياري
 * 6. العنوان (address) - اختياري
 * 7. المشغل المرخص (licensed_operator) - اختياري (نص حر)
 * 8. ملاحظات على هذا المورد (notes) - اختياري
 */
export default function SupplierFormModal({
  isOpen,
  onClose,
  onSuccess,
  initialName = '',
  supplierToEdit = null,
}) {
  const { store } = useStore();
  const toast = useToast();

  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [dbColumnsWarning, setDbColumnsWarning] = useState(null);

  const nameInputRef = useRef(null);

  const isEdit = Boolean(supplierToEdit?.id);

  // تحديث الفورم عند فتح المودال أو تغير بيانات التعديل
  useEffect(() => {
    if (!isOpen) {
      setDbColumnsWarning(null);
      return;
    }

    if (supplierToEdit) {
      setForm({
        name: supplierToEdit.name || '',
        contact_person_name: supplierToEdit.contact_person_name || '',
        phone: supplierToEdit.phone || '',
        mobile_phone: supplierToEdit.mobile_phone || '',
        city: supplierToEdit.city || '',
        address: supplierToEdit.address || '',
        licensed_operator: supplierToEdit.licensed_operator || '',
        notes: supplierToEdit.notes || '',
      });
    } else {
      setForm({
        ...emptyForm,
        name: (initialName || '').trim(),
      });
    }

    // التركيز التلقائي على حقل الاسم
    const timer = setTimeout(() => {
      nameInputRef.current?.focus();
    }, 80);
    return () => clearTimeout(timer);
  }, [isOpen, supplierToEdit, initialName]);

  if (!isOpen) return null;

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();

    const name = form.name.trim();
    if (!name) {
      toast.warning('يرجى إدخال اسم المورد أو الشركة');
      nameInputRef.current?.focus();
      return;
    }

    if (!store?.id) {
      toast.error('لم يتم تحديد المتجر الحالي');
      return;
    }

    setSaving(true);
    setDbColumnsWarning(null);

    const payload = {
      store_id: store.id,
      role: 'supplier',
      name,
      contact_person_name: form.contact_person_name.trim(),
      phone: normalizeDigitsToLatin(form.phone.trim()),
      mobile_phone: normalizeDigitsToLatin(form.mobile_phone.trim()),
      city: form.city.trim(),
      address: form.address.trim(),
      licensed_operator: form.licensed_operator.trim(),
      notes: form.notes.trim(),
      ...(!isEdit
        ? {
            payment_type: 'credit',
            outstanding_amount: 0,
          }
        : {}),
    };

    try {
      let savedData = null;

      if (isEdit) {
        // محاولة التحديث بكافة الحقول
        let { data, error } = await supabase
          .from(CONTACTS_TABLE)
          .update(payload)
          .eq('id', supplierToEdit.id)
          .eq('store_id', store.id)
          .select('*')
          .single();

        // في حال عدم وجود الأعمدة الجديدة في قاعدة البيانات، التحديث بالحقول الأساسية
        if (error && /contact_person_name|mobile_phone|city|licensed_operator|column/i.test(String(error.message || ''))) {
          setDbColumnsWarning('تنبيه: الأعمدة الجديدة غير مضافة في Supabase بعد. تم حفظ البيانات الأساسية فقط. يرجى تنفيذ ملف store_contacts_supplier_details.sql.');
          const basicPayload = {
            store_id: store.id,
            role: 'supplier',
            name,
            phone: normalizeDigitsToLatin(form.phone.trim()),
            address: form.address.trim(),
            notes: form.notes.trim(),
          };
          const fallbackRes = await supabase
            .from(CONTACTS_TABLE)
            .update(basicPayload)
            .eq('id', supplierToEdit.id)
            .eq('store_id', store.id)
            .select('*')
            .single();
          if (fallbackRes.error) throw fallbackRes.error;
          savedData = fallbackRes.data;
        } else if (error) {
          throw error;
        } else {
          savedData = data;
        }
      } else {
        // إضافة مورد جديد
        let { data, error } = await supabase
          .from(CONTACTS_TABLE)
          .insert([payload])
          .select('*')
          .single();

        // في حال عدم وجود الأعمدة الجديدة، الإدراج بالحقول الأساسية كحل بديل آمن
        if (error && /contact_person_name|mobile_phone|city|licensed_operator|column/i.test(String(error.message || ''))) {
          setDbColumnsWarning('تنبيه: الأعمدة الجديدة غير مضافة في Supabase بعد. تم حفظ البيانات الأساسية فقط. يرجى تنفيذ ملف store_contacts_supplier_details.sql.');
          const basicPayload = {
            store_id: store.id,
            role: 'supplier',
            name,
            phone: normalizeDigitsToLatin(form.phone.trim()),
            address: form.address.trim(),
            notes: form.notes.trim(),
            payment_type: 'credit',
            outstanding_amount: 0,
          };
          const fallbackRes = await supabase
            .from(CONTACTS_TABLE)
            .insert([basicPayload])
            .select('*')
            .single();
          if (fallbackRes.error) throw fallbackRes.error;
          savedData = fallbackRes.data;
        } else if (error) {
          throw error;
        } else {
          savedData = data;
        }
      }

      toast.success(
        isEdit
          ? `تم تحديث بيانات المورد «${name}» بنجاح`
          : `تمت إضافة المورد «${name}» بنجاح`
      );

      if (onSuccess && savedData) {
        onSuccess(savedData);
      }
      onClose();
    } catch (err) {
      console.error('Failed to save supplier:', err);
      toast.error(err?.message || 'فشل حفظ بيانات المورد');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs transition-opacity"
      dir="rtl"
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-w-xl rounded-3xl border border-slate-200/80 bg-white/95 shadow-2xl backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(ev) => ev.stopPropagation()}
      >
        {/* رأس المودال */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-l from-violet-50/50 via-slate-50/20 to-transparent dark:from-violet-950/20 dark:via-slate-900/40">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300 shadow-inner">
              {isEdit ? <Building2 size={22} /> : <Plus size={22} className="stroke-[2.5]" />}
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                {isEdit ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isEdit
                  ? 'تحديث بيانات التواصل ومعلومات الترخيص للمورد الحالي'
                  : 'تسجيل مورد جديد وحفظ بيانات التواصل والترخيص في النظام'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-400 transition-colors disabled:opacity-40"
            title="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        {/* تنبيه في حال عدم وجود الأعمدة بقاعدة البيانات */}
        {dbColumnsWarning && (
          <div className="mx-6 mt-3 flex items-start gap-2.5 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-200">
            <AlertCircle size={16} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <p>{dbColumnsWarning}</p>
          </div>
        )}

        {/* جسم الفورم */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* اسم المورد أو الشركة (إلزامي) */}
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-1.5">
              <Building2 size={14} className="text-violet-600 dark:text-violet-400" />
              اسم المورد أو الشركة <span className="text-rose-500">*</span>
            </label>
            <input
              ref={nameInputRef}
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              className="w-full rounded-2xl border border-slate-200 px-4 py-2.5 text-sm bg-slate-50/70 focus:bg-white text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
              placeholder="مثال: شركة التوريدات الهندسية أو اسم المورد"
              required
            />
          </div>

          {/* شبكة الحقول الثنائية */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* اسم مسؤول الحساب */}
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-1.5">
                <User size={14} className="text-slate-400" />
                مسؤول الحساب
              </label>
              <input
                value={form.contact_person_name}
                onChange={(e) => handleChange('contact_person_name', e.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-3.5 py-2.5 text-sm bg-slate-50/70 focus:bg-white text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
                placeholder="اسم جهة الاتصال لدى المورد"
              />
            </div>

            {/* المدينة */}
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-1.5">
                <MapPin size={14} className="text-slate-400" />
                المدينة
              </label>
              <input
                value={form.city}
                onChange={(e) => handleChange('city', e.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-3.5 py-2.5 text-sm bg-slate-50/70 focus:bg-white text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
                placeholder="مثال: رام الله، نابلس، الخليل..."
              />
            </div>

            {/* رقم هاتف الشركة */}
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-1.5">
                <Phone size={14} className="text-slate-400" />
                هاتف الشركة / الثابت
              </label>
              <input
                value={form.phone}
                onChange={(e) => handleChange('phone', normalizeDigitsToLatin(e.target.value))}
                className="w-full rounded-2xl border border-slate-200 px-3.5 py-2.5 text-sm font-currency bg-slate-50/70 focus:bg-white text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
                dir="ltr"
                lang="en"
                type="tel"
                placeholder="02xxxxxxx أو 09xxxxxxx"
              />
            </div>

            {/* رقم الهاتف النقال */}
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-1.5">
                <Smartphone size={14} className="text-slate-400" />
                الهاتف النقال
              </label>
              <input
                value={form.mobile_phone}
                onChange={(e) => handleChange('mobile_phone', normalizeDigitsToLatin(e.target.value))}
                className="w-full rounded-2xl border border-slate-200 px-3.5 py-2.5 text-sm font-currency bg-slate-50/70 focus:bg-white text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
                dir="ltr"
                lang="en"
                type="tel"
                placeholder="059xxxxxxx أو 056xxxxxxx"
              />
            </div>
          </div>

          {/* المشغل المرخص */}
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-1.5">
              <ShieldCheck size={14} className="text-slate-400" />
              المشغل المرخص
            </label>
            <input
              value={form.licensed_operator}
              onChange={(e) => handleChange('licensed_operator', e.target.value)}
              className="w-full rounded-2xl border border-slate-200 px-3.5 py-2.5 text-sm bg-slate-50/70 focus:bg-white text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
              placeholder="مثال: شركة الاتصالات، الوطنية، جوال... (نص حر)"
            />
          </div>

          {/* العنوان التفصيلي */}
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-1.5">
              <Building size={14} className="text-slate-400" />
              العنوان
            </label>
            <textarea
              value={form.address}
              onChange={(e) => handleChange('address', e.target.value)}
              rows={2}
              className="w-full rounded-2xl border border-slate-200 px-3.5 py-2.5 text-sm resize-none bg-slate-50/70 focus:bg-white text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
              placeholder="الشارع، البناية، الطابق، أو أي تفاصيل عنوان..."
            />
          </div>

          {/* ملاحظات على هذا المورد */}
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-1.5">
              <FileText size={14} className="text-slate-400" />
              ملاحظات على هذا المورد
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              rows={2}
              className="w-full rounded-2xl border border-slate-200 px-3.5 py-2.5 text-sm resize-none bg-slate-50/70 focus:bg-white text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800/80 dark:text-white dark:placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
              placeholder="شروط التوريد، مواعيد التسليم، أو أي ملاحظات أخرى..."
            />
          </div>
        </form>

        {/* أزرار الإجراءات أسفل المودال */}
        <div className="flex items-center gap-2.5 px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 sm:flex-initial sm:px-6 rounded-2xl border border-slate-200 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            إلغاء
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !form.name.trim()}
            className="flex-1 sm:flex-initial sm:px-8 inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-600 text-white py-2.5 text-xs font-black hover:bg-violet-700 disabled:opacity-50 transition-all shadow-md shadow-violet-600/20 hover:shadow-violet-600/30"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>جاري الحفظ…</span>
              </>
            ) : (
              <>
                <Save size={16} />
                <span>{isEdit ? 'حفظ التعديلات' : 'حفظ المورد'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
