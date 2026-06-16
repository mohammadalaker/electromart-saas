import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, X, Send, Loader2 } from 'lucide-react';
import { supabase, PRODUCTS_TABLE } from '../lib/supabaseClient';
import { useStore } from '../context/StoreContext';

export default function AIAssistant() {
  const { store } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'مرحباً! أنا مساعد Swiftm الذكي 🤖. كيف يمكنني مساعدتك في إدارة متجرك اليوم؟'
    }
  ]);
  const [input, setInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [storeContext, setStoreContext] = useState('');
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  
  const chatEndRef = useRef(null);

  // Auto scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAiLoading]);

  // Fetch store data context on mount or when store changes
  useEffect(() => {
    if (store?.id && isOpen && !storeContext) {
      fetchStoreContext();
    }
  }, [store?.id, isOpen]);

  const fetchStoreContext = async () => {
    setIsLoadingContext(true);
    try {
      const now = new Date();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

      // 1. Fetch Sales and calculate revenue comparisons
      const { data: sales, error: salesErr } = await supabase
        .from('sales')
        .select('created_at, total_amount, line_items')
        .eq('store_id', store.id)
        .gte('created_at', startOfLastMonth.toISOString());

      if (salesErr) throw salesErr;

      // Filter sales for last 30 days
      const last30DaysSales = (sales || []).filter(s => new Date(s.created_at) >= thirtyDaysAgo);
      const totalRevenue = last30DaysSales.reduce((sum, s) => sum + Number(s.total_amount || 0), 0);
      const totalOrders = last30DaysSales.length;
      const avgOrderValue = totalOrders > 0 ? (totalRevenue / totalOrders) : 0;

      // Calculate top products sold (last 30 days) from line_items JSON
      const productQuantities = {};
      last30DaysSales.forEach(sale => {
        let items = [];
        if (sale.line_items) {
          try {
            items = typeof sale.line_items === 'string' ? JSON.parse(sale.line_items) : sale.line_items;
          } catch (e) {
            items = [];
          }
        }
        if (Array.isArray(items)) {
          items.forEach(item => {
            const name = item.product_name || item.name || 'منتج غير معروف';
            const qty = Number(item.qty || item.quantity || 0);
            productQuantities[name] = (productQuantities[name] || 0) + qty;
          });
        }
      });

      const top5Products = Object.entries(productQuantities)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, qty]) => `- ${name}: ${qty} قطعة`)
        .join('\n');

      // Month vs Month revenue comparison
      const thisMonthSales = (sales || [])
        .filter(s => new Date(s.created_at) >= startOfThisMonth)
        .reduce((sum, s) => sum + Number(s.total_amount || 0), 0);

      const lastMonthSales = (sales || [])
        .filter(s => {
          const d = new Date(s.created_at);
          return d >= startOfLastMonth && d < startOfThisMonth;
        })
        .reduce((sum, s) => sum + Number(s.total_amount || 0), 0);

      // 2. Fetch Low stock products (< 10)
      const { data: lowStockProducts, error: prodErr } = await supabase
        .from(PRODUCTS_TABLE)
        .select('eng_name, stock_count')
        .eq('store_id', store.id)
        .lt('stock_count', 10)
        .order('stock_count', { ascending: true })
        .limit(10);

      const lowStockList = (lowStockProducts || [])
        .map(p => `- ${p.eng_name}: المخزون الحالي ${p.stock_count} قطعة`)
        .join('\n') || 'لا يوجد منتجات ناقصة (المخزون كافٍ لجميع المنتجات).';

      // 3. Fetch expenses this month
      const { data: expenses, error: expErr } = await supabase
        .from('expenses')
        .select('amount')
        .eq('store_id', store.id)
        .gte('expense_date', startOfThisMonth.toISOString().slice(0, 10));

      const totalExpenses = (expenses || []).reduce((sum, e) => sum + Number(e.amount || 0), 0);

      // Construct context string
      const contextStr = `
بيانات المتجر الحالي (${store.name || 'متجر Swiftm'}):
1. ملخص مبيعات الـ 30 يوماً الماضية:
   - إجمالي الإيرادات: ₪${totalRevenue.toFixed(2)}
   - عدد الطلبات: ${totalOrders} طلب
   - متوسط قيمة الطلب: ₪${avgOrderValue.toFixed(2)}
2. المنتجات الأكثر مبيعاً (آخر 30 يوماً):
${top5Products || 'لا توجد مبيعات مسجلة في آخر 30 يوماً.'}
3. منتجات منخفضة المخزون (أقل من 10 قطع):
${lowStockList}
4. مقارنة مبيعات هذا الشهر مقابل الشهر الماضي:
   - مبيعات هذا الشهر الحالي: ₪${thisMonthSales.toFixed(2)}
   - مبيعات الشهر الماضي: ₪${lastMonthSales.toFixed(2)}
5. إجمالي المصاريف التشغيلية لشهر الحالي: ₪${totalExpenses.toFixed(2)}
      `;

      setStoreContext(contextStr);
    } catch (e) {
      console.error('Error fetching store context for AI:', e);
      setStoreContext('تعذّر تحميل بيانات المتجر الحالية.');
    } finally {
      setIsLoadingContext(false);
    }
  };

  const handleSend = async (textToSend) => {
    const query = textToSend || input;
    if (!query.trim()) return;

    // Append user message
    setMessages(prev => [...prev, { role: 'user', content: query }]);
    setInput('');
    setIsAiLoading(true);

    try {
      const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
      if (!apiKey) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'عذراً، لم يتم إعداد مفتاح اتصال الذكاء الاصطناعي (VITE_ANTHROPIC_API_KEY) في إعدادات الخادم.'
        }]);
        setIsAiLoading(false);
        return;
      }

      // If context is not loaded yet, fetch it
      let activeContext = storeContext;
      if (!activeContext && store?.id) {
        await fetchStoreContext();
        activeContext = storeContext;
      }

      const systemPrompt = `أنت مساعد ذكي لتاجر يستخدم منصة Swiftm لإدارة متجره.
لديك البيانات التالية عن متجره:
${activeContext || 'بيانات المتجر غير متوفرة حالياً بسبب خطأ في التحميل.'}

أجب على أسئلته بالعربي بشكل مختصر وواضح ومفيد وبلهجة مهنية ودودة.
استخدم الأرقام الحقيقية والعملة (₪) من البيانات في إجاباتك عند السؤال عنها.`;

      // Map messages history to Anthropic API standard
      const apiMessages = messages
        .filter(msg => msg.content)
        .map(msg => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        }));
      
      // Append current user query to history
      apiMessages.push({ role: 'user', content: query });

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'dangerouslyAllowBrowser': 'true' // Bypasses standard SDK blocking warning if client side
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: systemPrompt,
          messages: apiMessages
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || `فشل الاتصال بالخادم (${response.status})`);
      }

      const resData = await response.json();
      const aiResponse = resData?.content?.[0]?.text || 'عذراً، لم أتمكن من صياغة إجابة مناسبة حالياً.';

      setMessages(prev => [...prev, { role: 'assistant', content: aiResponse }]);
    } catch (err) {
      console.error('AI Assistant API error:', err);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `حدث خطأ أثناء الاتصال بالذكاء الاصطناعي: ${err.message || 'يرجى التحقق من الشبكة وإعادة المحاولة.'}`
      }]);
    } finally {
      setIsAiLoading(false);
    }
  };

  const quickQuestions = [
    { text: "شو أكثر منتج اتباع؟", q: "ما هي المنتجات الأكثر مبيعاً في متجري خلال الـ 30 يوماً الماضية؟" },
    { text: "كيف مبيعاتي هالشهر؟", q: "كيف تبدو مبيعات هذا الشهر مقارنة بالشهر الماضي؟" },
    { text: "شو المنتجات الناقصة؟", q: "ما هي المنتجات التي اقترب مخزونها من النفاد (أقل من 10 قطع)؟" },
    { text: "كم ربحت هالأسبوع؟", q: "أعطني ملخصاً مالياً عن أداء المتجر الحالي وإيراداته ومصروفاته." }
  ];

  if (!store?.id) return null;

  return (
    <div className="fixed bottom-6 left-6 z-[999] font-sans" dir="rtl">
      
      {/* Chat Drawer/Modal window */}
      {isOpen && (
        <div className="absolute bottom-16 left-0 w-[400px] h-[520px] bg-white dark:bg-[#0f172a] rounded-3xl border border-slate-200 dark:border-slate-800 shadow-[0_12px_40px_rgba(0,0,0,0.15)] flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-300">
          
          {/* Header */}
          <div className="bg-gradient-to-l from-indigo-600 to-violet-600 px-5 py-4 flex items-center justify-between text-white shadow-md">
            <div className="flex items-center gap-2">
              <div className="bg-white/20 p-1.5 rounded-xl">
                <Sparkles size={18} className="text-yellow-200 fill-yellow-200" />
              </div>
              <div>
                <h3 className="font-black text-sm tracking-wide">Swiftm AI 🤖</h3>
                <span className="text-[10px] text-indigo-100 opacity-90">مساعدك الذكي لإدارة متجرك</span>
              </div>
            </div>
            <button 
              onClick={() => setIsOpen(false)} 
              className="text-white/80 hover:text-white bg-white/10 hover:bg-white/20 p-1.5 rounded-xl transition-all"
              aria-label="Close chat"
            >
              <X size={16} />
            </button>
          </div>

          {/* Messages list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 dark:bg-slate-950/20">
            {messages.map((msg, idx) => (
              <div 
                key={idx} 
                className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
              >
                <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                  msg.role === 'user' 
                    ? 'bg-indigo-600 text-white rounded-br-none' 
                    : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-100 dark:border-slate-800 rounded-bl-none'
                }`}>
                  <p className="whitespace-pre-line">{msg.content}</p>
                </div>
              </div>
            ))}
            
            {/* AI Typing Indicator loading */}
            {isAiLoading && (
              <div className="flex justify-end">
                <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-2xl rounded-bl-none px-4 py-3 shadow-sm flex items-center gap-1.5">
                  <span className="h-2 w-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                  <span className="h-2 w-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                  <span className="h-2 w-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                </div>
              </div>
            )}
            
            <div ref={chatEndRef} />
          </div>

          {/* Quick Questions Chips */}
          <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-[#0f172a] flex gap-2 overflow-x-auto no-scrollbar scroll-smooth">
            {quickQuestions.map((chip, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(chip.q)}
                disabled={isAiLoading || isLoadingContext}
                className="whitespace-nowrap shrink-0 px-3 py-1.5 rounded-full border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-600 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/20 transition-all"
              >
                {chip.text}
              </button>
            ))}
          </div>

          {/* Footer Input Area */}
          <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-[#0f172a] flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="اكتب سؤالك للذكاء الاصطناعي بالعربية..."
              disabled={isAiLoading}
              className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-60 transition-all"
            />
            <button
              onClick={() => handleSend()}
              disabled={isAiLoading || !input.trim()}
              className="h-10 w-10 shrink-0 bg-indigo-600 text-white rounded-2xl flex items-center justify-center hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 shadow-md shadow-indigo-600/15 transition-all"
              aria-label="Send message"
            >
              <Send size={16} className="rotate-180" />
            </button>
          </div>
        </div>
      )}

      {/* Floating Sparkle Action Button */}
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className="w-14 h-14 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center shadow-xl shadow-indigo-600/30 hover:scale-105 active:scale-95 transition-all relative overflow-hidden group"
        aria-label="Open AI Assistant"
      >
        <span className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"></span>
        <div className="absolute inset-0 rounded-full border-2 border-indigo-400/20 scale-100 group-hover:scale-110 transition-transform duration-500 animate-ping"></div>
        {isOpen ? (
          <X size={24} className="transition-transform duration-300 rotate-90" />
        ) : (
          <Sparkles size={24} className="text-yellow-200 fill-yellow-200 animate-pulse" />
        )}
      </button>
      
    </div>
  );
}
