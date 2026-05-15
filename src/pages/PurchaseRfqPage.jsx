import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, FileQuestion, Plus, Mail, MessageCircle, Copy, Send } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';
import { useToast } from '../context/ToastContext';
import { normalizeDigitsToLatin } from '../utils/normalizeDigits';
import { buildRfqMessageText, mailtoHref, whatsappHref } from '../utils/rfqShare';

const RFQ_TABLE = 'store_purchase_rfqs';
const LINE_TABLE = 'store_purchase_rfq_lines';
const CONTACTS_TABLE = 'store_contacts';
const STATUS_AR = {
  draft: 'مسودة',
  sent: 'مُرسل للموردين',
  closed: 'مُغلق',
  cancelled: 'ملغى',
};

function isMissing(err) {
  if (!err) return false;
  const m = String(err.message || '');
  return err.code === 'PGRST205' || /does not exist|schema cache/i.test(m);
}

export default function PurchaseRfqPage() {
  const { store, loading: storeLoading } = useStore();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState([]);
  const [lineRows, setLineRows] = useState([{ product_id: '', qty: '1', target_price: '', description: '' }]);
  /** إرسال للمورد: { id, title, currentStatus } */
  const [sendCtx, setSendCtx] = useState(null);
  const [sendLines, setSendLines] = useState([]);
  const [sendSuppliers, setSendSuppliers] = useState([]);
  const [sendLoading, setSendLoading] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [sendPhone, setSendPhone] = useState('');
  const [sendSupplierId, setSendSupplierId] = useState('');

  const load = useCallback(async () => {
    if (!store?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from(RFQ_TABLE)
        .select('*')
        .eq('store_id', store.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) {
        if (isMissing(error)) {
          setMissing(true);
          setRows([]);
          return;
        }
        throw error;
      }
      setMissing(false);
      setRows(data || []);
    } catch (e) {
      setErr(e.message || 'تعذّر التحميل');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [store?.id]);

  useEffect(() => {
    if (storeLoading) return;
    load();
  }, [storeLoading, load]);

  useEffect(() => {
    if (!store?.id || !modal) return;
    (async () => {
      const { data: p } = await supabase
        .from(PRODUCTS_TABLE)
        .select('id, eng_name, barcode')
        .eq('store_id', store.id)
        .order('eng_name')
        .limit(1500);
      setProducts(p || []);
    })();
  }, [store?.id, modal]);

  const submit = async (e) => {
    e.preventDefault();
    if (!store?.id || missing) return;
    setSaving(true);
    try {
      const { data: head, error: hErr } = await supabase
        .from(RFQ_TABLE)
        .insert([
          {
            store_id: store.id,
            title: title.trim() || 'طلب تسعيرة',
            status: 'draft',
          },
        ])
        .select('id')
        .single();
      if (hErr) throw hErr;
      const lines = lineRows
        .filter((r) => r.product_id || String(r.description || '').trim())
        .map((r) => ({
          rfq_id: head.id,
          product_id: r.product_id || null,
          description: String(r.description || '').trim(),
          qty: Math.max(0.0001, parseFloat(String(r.qty).replace(',', '.')) || 1),
          target_price: r.target_price ? parseFloat(String(r.target_price).replace(',', '.')) : null,
        }));
      if (lines.length) {
        const { error: lErr } = await supabase.from(LINE_TABLE).insert(lines);
        if (lErr) throw lErr;
      }
      setModal(false);
      setTitle('');
      setLineRows([{ product_id: '', qty: '1', target_price: '', description: '' }]);
      await load();
    } catch (e2) {
      toast.error(e2.message || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id, status) => {
    await supabase.from(RFQ_TABLE).update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    load();
  };

  const openSendModal = useCallback(
    async (r) => {
      if (!store?.id || missing) return;
      setSendCtx({ id: r.id, title: r.title || '', currentStatus: r.status || 'draft' });
      setSendEmail('');
      setSendPhone('');
      setSendSupplierId('');
      setSendLines([]);
      setSendLoading(true);
      try {
        const [linesRes, supRes] = await Promise.all([
          supabase
            .from(LINE_TABLE)
            .select('id, description, qty, target_price, product_id, products(eng_name, barcode)')
            .eq('rfq_id', r.id),
          supabase
            .from(CONTACTS_TABLE)
            .select('id, name, phone, email')
            .eq('store_id', store.id)
            .eq('role', 'supplier')
            .order('name'),
        ]);
        if (linesRes.error) throw linesRes.error;
        if (supRes.error) throw supRes.error;
        const mapped = (linesRes.data || []).map((row) => ({
          productName: row.products?.eng_name ? String(row.products.eng_name) : '',
          description: row.description || '',
          qty: row.qty,
          target_price: row.target_price,
        }));
        setSendLines(mapped);
        setSendSuppliers(supRes.data || []);
      } catch (e) {
        toast.error(e?.message || 'تعذّر تحميل تفاصيل الطلب');
        setSendCtx(null);
      } finally {
        setSendLoading(false);
      }
    },
    [store?.id, missing, toast]
  );

  const closeSendModal = () => {
    setSendCtx(null);
    setSendLines([]);
    setSendSuppliers([]);
  };

  const sendBody = useMemo(() => {
    if (!sendCtx) return '';
    return buildRfqMessageText({
      storeName: store?.name || '',
      rfqTitle: sendCtx.title,
      lines: sendLines,
    });
  }, [sendCtx, sendLines, store?.name]);

  const sendSubject = useMemo(
    () => (sendCtx ? `طلب تسعيرة — ${sendCtx.title || 'RFQ'}` : ''),
    [sendCtx]
  );

  const openMailto = () => {
    const href = mailtoHref(sendEmail, sendSubject, sendBody);
    if (!href) {
      toast.warning('أدخل بريداً إلكترونياً للمورد في الحقل أدناه.');
      return;
    }
    const a = document.createElement('a');
    a.href = href;
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const openWhatsApp = () => {
    const href = whatsappHref(sendPhone, sendBody);
    if (!href) {
      toast.warning('أدخل رقم واتساب للمورد (مثلاً 05xxxxxxxx).');
      return;
    }
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  const copyRfqText = async () => {
    try {
      await navigator.clipboard.writeText(sendBody);
      toast.success('تم نسخ نص الطلب.');
    } catch {
      toast.warning('تعذّر النسخ من المتصفح — انسخ يدوياً من المعاينة.');
    }
  };

  const markRfqSentAndClose = async () => {
    if (!sendCtx) return;
    await setStatus(sendCtx.id, 'sent');
    closeSendModal();
  };

  if (!store?.id && !storeLoading) {
    return (
      <DashboardLayout>
        <p className="p-8 text-center font-bold font-arabic">لا يوجد متجر.</p>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      actions={
        <div className="flex flex-wrap gap-2 font-arabic">
          <Link to="/purchases/price-history" className="rounded-xl border px-4 py-2 text-sm font-bold dark:border-white/15">
            أسعار الشراء
          </Link>
          <button
            type="button"
            disabled={missing}
            onClick={() => setModal(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            <Plus size={18} />
            طلب تسعيرة (RFQ)
          </button>
        </div>
      }
    >
      <div className="mx-auto max-w-4xl space-y-5 p-2 font-arabic" dir="rtl">
        <header className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-600 text-white">
            <FileQuestion size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white">طلبات التسعيرة (RFQ)</h1>
            <p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-400">
              مسار مبسّط قبل أمر الشراء — جمع أسعار موردين ومقارنة التكلفة (مستوحى من Odoo RFQ).
            </p>
            <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-500">
              عند «إرسال للمورد» يُفتح بريدك أو واتساب على جهازك مع نص جاهز — يُنصح بتسجيل الموردين في الدليل
              (دور مورد) مع البريد والهاتف.
            </p>
          </div>
        </header>

        {missing && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold">
            نفّذ <code className="rounded bg-white px-1">supabase/store_purchase_rfqs.sql</code> في Supabase.
          </p>
        )}
        {err && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold">{err}</p>}

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-indigo-500" size={36} />
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li
                key={r.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-gray-900/50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-black text-slate-900 dark:text-white">{r.title || 'بدون عنوان'}</p>
                    <p className="text-xs text-slate-500">{STATUS_AR[r.status] || r.status}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {r.status === 'draft' && (
                      <button
                        type="button"
                        onClick={() => openSendModal(r)}
                        className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2 py-1 text-[11px] font-bold text-white"
                      >
                        <Send size={12} />
                        إرسال للمورد
                      </button>
                    )}
                    {r.status === 'sent' && (
                      <button
                        type="button"
                        onClick={() => openSendModal(r)}
                        className="inline-flex items-center gap-1 rounded-lg border border-sky-500 bg-sky-50 px-2 py-1 text-[11px] font-bold text-sky-800 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-200"
                      >
                        <Mail size={12} />
                        مشاركة مجدداً
                      </button>
                    )}
                    {['draft', 'sent'].includes(r.status) && (
                      <button
                        type="button"
                        onClick={() => setStatus(r.id, 'closed')}
                        className="rounded-lg bg-emerald-700 px-2 py-1 text-[11px] font-bold text-white"
                      >
                        إغلاق
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 font-arabic" dir="rtl">
          <form
            onSubmit={submit}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border bg-white p-6 dark:border-white/10 dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-black">طلب تسعيرة جديد</h2>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="عنوان (مثلاً: شاشات Q1)"
              className="mb-3 w-full rounded-xl border px-3 py-2 text-sm dark:border-white/15 dark:bg-slate-900"
            />
            {lineRows.map((lr, i) => (
              <div key={i} className="mb-2 grid gap-2 rounded-xl border p-2 dark:border-white/10">
                <select
                  value={lr.product_id}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLineRows((prev) => {
                      const n = [...prev];
                      n[i] = { ...n[i], product_id: v };
                      return n;
                    });
                  }}
                  className="w-full rounded border px-2 py-1 text-xs dark:border-white/15 dark:bg-slate-900"
                >
                  <option value="">— صنف (اختياري) —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.eng_name} {p.barcode ? `(${p.barcode})` : ''}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="وصف يدوي"
                  value={lr.description}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLineRows((prev) => {
                      const n = [...prev];
                      n[i] = { ...n[i], description: v };
                      return n;
                    });
                  }}
                  className="w-full rounded border px-2 py-1 text-xs dark:border-white/15 dark:bg-slate-900"
                />
                <div className="flex gap-2">
                  <input
                    placeholder="كمية"
                    value={lr.qty}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLineRows((prev) => {
                        const n = [...prev];
                        n[i] = { ...n[i], qty: v };
                        return n;
                      });
                    }}
                    className="w-24 rounded border px-2 py-1 text-xs dark:border-white/15 dark:bg-slate-900"
                  />
                  <input
                    placeholder="سعر مستهدف"
                    value={lr.target_price}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLineRows((prev) => {
                        const n = [...prev];
                        n[i] = { ...n[i], target_price: v };
                        return n;
                      });
                    }}
                    className="flex-1 rounded border px-2 py-1 text-xs dark:border-white/15 dark:bg-slate-900"
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setLineRows((p) => [...p, { product_id: '', qty: '1', target_price: '', description: '' }])
              }
              className="mb-3 text-xs font-bold text-indigo-600"
            >
              + سطر
            </button>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModal(false)} className="rounded-xl border px-4 py-2 text-sm font-bold">
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {saving ? '...' : 'حفظ'}
              </button>
            </div>
          </form>
        </div>
      )}

      {sendCtx && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4 font-arabic"
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rfq-send-title"
          onClick={() => !sendLoading && closeSendModal()}
        >
          <div
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="rfq-send-title" className="text-lg font-black text-slate-900 dark:text-white">
              إرسال طلب التسعيرة
            </h2>
            <p className="mt-1 text-[11px] font-bold leading-relaxed text-slate-500 dark:text-slate-400">
              يُفتح تطبيق البريد أو واتساب على جهازك مع النص التالي. لا يُرسل النظام من خادمك تلقائياً — أنت
              تضغط «إرسال» داخل بريدك أو واتساب.
            </p>

            {sendLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="animate-spin text-indigo-500" size={32} />
              </div>
            ) : (
              <>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">مورد من الدليل</label>
                    <select
                      value={sendSupplierId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSendSupplierId(id);
                        const s = sendSuppliers.find((x) => x.id === id);
                        if (s) {
                          setSendEmail(String(s.email || '').trim());
                          setSendPhone(normalizeDigitsToLatin(String(s.phone || '').trim()));
                        }
                      }}
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm dark:border-white/15 dark:bg-slate-900"
                    >
                      <option value="">— اختر مورداً (اختياري) —</option>
                      {sendSuppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name || 'مورد'} {s.phone ? `· ${s.phone}` : ''}
                        </option>
                      ))}
                    </select>
                    {sendSuppliers.length === 0 && (
                      <p className="mt-1 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                        لا يوجد موردون في الدليل — أدخل البريد والهاتف يدوياً أو أضف مورداً بدور «مورد» في
                        شاشة العملاء/الموردين.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">بريد المورد</label>
                    <input
                      type="email"
                      value={sendEmail}
                      onChange={(e) => setSendEmail(e.target.value.trim())}
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-mono dark:border-white/15 dark:bg-slate-900"
                      dir="ltr"
                      placeholder="supplier@example.com"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">واتساب (هاتف)</label>
                    <input
                      value={sendPhone}
                      onChange={(e) => setSendPhone(normalizeDigitsToLatin(e.target.value))}
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-mono dark:border-white/15 dark:bg-slate-900"
                      dir="ltr"
                      placeholder="05xxxxxxxx"
                    />
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={openMailto}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-sm font-black text-white hover:bg-slate-900 dark:bg-slate-700"
                  >
                    <Mail size={18} />
                    فتح البريد الإلكتروني
                  </button>
                  <button
                    type="button"
                    onClick={openWhatsApp}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-700"
                  >
                    <MessageCircle size={18} />
                    فتح واتساب
                  </button>
                  <button
                    type="button"
                    onClick={copyRfqText}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-200 px-4 py-3 text-sm font-black text-slate-800 hover:bg-slate-50 dark:border-white/15 dark:text-slate-100 dark:hover:bg-white/5"
                  >
                    <Copy size={18} />
                    نسخ النص (للصق في أي تطبيق)
                  </button>
                </div>

                <div className="mt-4">
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">معاينة</p>
                  <pre className="max-h-40 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-3 text-[11px] whitespace-pre-wrap break-words text-slate-800 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-200">
                    {sendBody || '—'}
                  </pre>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 justify-end">
                  <button
                    type="button"
                    onClick={closeSendModal}
                    className="rounded-xl border px-4 py-2 text-sm font-bold dark:border-white/15"
                  >
                    إغلاق
                  </button>
                  {sendCtx.currentStatus === 'draft' && (
                    <button
                      type="button"
                      onClick={markRfqSentAndClose}
                      className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-black text-white hover:bg-sky-700"
                    >
                      تسجيل كـ «مُرسل للموردين»
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
