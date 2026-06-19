/**
 * فتح محادثة واتساب مع رسالة جاهزة (wa.me — بدون API).
 */
export function sendWhatsApp(phone, message) {
  const cleanPhone = String(phone || '').replace(/[^0-9]/g, '');
  if (!cleanPhone || cleanPhone.length < 9) return;
  const encodedMsg = encodeURIComponent(message);
  window.open(`https://wa.me/${cleanPhone}?text=${encodedMsg}`, '_blank');
}

export function hasValidPhone(phone) {
  const cleanPhone = String(phone || '').replace(/[^0-9]/g, '');
  return cleanPhone.length >= 9;
}

/** استخراج اسم/هاتف الزبون من الطلب (أعمدة أو notes) */
export function parseOrderCustomer(order) {
  let name = order?.customer_name?.trim() || '';
  let phone = order?.customer_phone?.trim() || '';
  const notes = String(order?.notes || '');
  if (!name) {
    const m = notes.match(/الزبون:\s*([^\n]+)/);
    if (m) name = m[1].trim();
  }
  if (!phone) {
    const m = notes.match(/الهاتف:\s*([^\n]+)/);
    if (m) phone = m[1].trim();
    else {
      const d = notes.match(/(\d{9,12})/);
      if (d) phone = d[1];
    }
  }
  return { name, phone };
}

export function buildInvoiceWhatsAppMessage({ customerName, storeName, invoiceNumber, total }) {
  const amt = Number(total);
  const totalStr = Number.isFinite(amt) ? amt.toFixed(2) : String(total ?? '');
  return [
    `مرحباً ${customerName || 'عزيزنا'}،`,
    `شكراً لتعاملك مع ${storeName || 'متجرنا'} 🙏`,
    `فاتورتك رقم #${invoiceNumber}`,
    `الإجمالي: ${totalStr} شيكل`,
    'نتمنى لك يوم سعيد!',
  ].join('\n');
}

export function buildPaymentReminderMessage({ customerName, storeName, amount }) {
  const amt = Number(amount);
  const amountStr = Number.isFinite(amt) ? amt.toFixed(2) : String(amount ?? '');
  return [
    `مرحباً ${customerName || 'عزيزنا'}،`,
    `نود تذكيرك بأن لديك مستحقات بقيمة ${amountStr} شيكل لدى ${storeName || 'متجرنا'}.`,
    'نقدر تعاونك بالتسديد في أقرب وقت ممكن 🙏',
  ].join('\n');
}

export function buildOrderReadyMessage({ customerName, orderNumber, total }) {
  const amt = Number(total);
  const totalStr = Number.isFinite(amt) ? amt.toFixed(2) : String(total ?? '');
  return [
    `مرحباً ${customerName || 'عزيزنا'}،`,
    `طلبك رقم #${orderNumber} جاهز للاستلام/التوصيل! 📦`,
    `الإجمالي: ${totalStr} شيكل`,
  ].join('\n');
}

export function buildDeliveryAssignedMessage({
  customerName,
  orderNumber,
  lineItems,
  total,
  deliveryCompanyName,
}) {
  const lines = Array.isArray(lineItems) ? lineItems : [];
  const products = lines
    .map((l) => `- ${l.name || l.barcode || 'صنف'} × ${l.qty}`)
    .join('\n');
  const amt = Number(total);
  const totalStr = Number.isFinite(amt) ? amt.toFixed(2) : String(total ?? '');
  return [
    `مرحباً ${customerName || ''}،`,
    '',
    `طلبك رقم: ${orderNumber} تم تسليمه لشركة التوصيل.`,
    '',
    '📦 المنتجات:',
    products,
    '',
    `💰 المبلغ: ₪${totalStr}`,
    `🚚 شركة التوصيل: ${deliveryCompanyName || ''}`,
    '',
    'شكراً لثقتك! 🙏',
  ].join('\n');
}
