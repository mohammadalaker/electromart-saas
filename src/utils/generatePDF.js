import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export async function generateInvoicePDF(sale, store) {
  if (!sale) return;

  // 1. Create a container element positioned off-screen
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '-9999px';
  container.style.width = '800px'; // A4 proportional width in pixels
  container.style.padding = '40px';
  container.style.backgroundColor = 'white';
  container.style.color = '#1f2937';
  container.style.fontFamily = "'Cairo', 'Arial', sans-serif";
  container.style.direction = 'rtl';
  container.style.boxSizing = 'border-box';

  // Format Date
  const dateStr = sale.created_at
    ? new Date(sale.created_at).toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : new Date().toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

  // Parse items
  const lines = Array.isArray(sale.line_items) ? sale.line_items : [];

  // Subtotal & Discount calculations
  const subtotal = lines.reduce((sum, item) => sum + (Number(item.original_price ?? item.originalPrice ?? item.unit_price ?? item.unitPrice ?? 0) * Number(item.qty ?? item.quantity ?? 1)), 0);
  const totalAmount = Number(sale.total_amount ?? 0);
  const totalDiscount = Math.max(0, subtotal - totalAmount);

  // Dynamic content HTML
  container.innerHTML = `
    <!-- Header -->
    <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #4f46e5; padding-bottom: 20px; margin-bottom: 30px;">
      <div style="display: flex; align-items: center; gap: 15px;">
        ${
          store?.logo_url
            ? `<img src="${store.logo_url}" alt="logo" style="max-height: 60px; max-width: 120px; object-fit: contain; border-radius: 8px;" />`
            : `<div style="width: 50px; height: 50px; border-radius: 12px; background-color: #4f46e5; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 20px;">S</div>`
        }
        <div>
          <h1 style="margin: 0; font-size: 24px; font-weight: 900; color: #111827;">${store?.name || 'المتجر'}</h1>
          <p style="margin: 4px 0 0 0; font-size: 13px; color: #6b7280; font-weight: bold;">فاتورة مبيعات</p>
        </div>
      </div>
      <div style="text-align: left; font-size: 13px; color: #4b5563;">
        <p style="margin: 0; font-weight: bold;">رقم الفاتورة: <span style="font-family: monospace; font-size: 14px; color: #111827;">#${sale.id.slice(0, 8).toUpperCase()}</span></p>
        <p style="margin: 4px 0 0 0;">تاريخ الفاتورة: <span>${dateStr}</span></p>
      </div>
    </div>

    <!-- Info Section (Store & Customer) -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 30px;">
      <!-- Store Info -->
      <div style="background-color: #f9fafb; padding: 16px; border-radius: 12px; border: 1px solid #f3f4f6;">
        <h3 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 800; color: #4f46e5;">تفاصيل المتجر</h3>
        <p style="margin: 0; font-size: 13px; font-weight: bold; color: #1f2937;">${store?.name || 'المتجر'}</p>
        ${store?.address ? `<p style="margin: 4px 0 0 0; font-size: 12px; color: #6b7280;">📌 ${store.address}</p>` : ''}
        ${(store?.phone || store?.whatsapp_number) ? `<p style="margin: 4px 0 0 0; font-size: 12px; color: #6b7280;">📞 ${store.phone || store.whatsapp_number}</p>` : ''}
      </div>

      <!-- Customer Info -->
      <div style="background-color: #f9fafb; padding: 16px; border-radius: 12px; border: 1px solid #f3f4f6;">
        <h3 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 800; color: #4f46e5;">بيانات العميل</h3>
        ${sale.customer_name ? `<p style="margin: 0; font-size: 13px; font-weight: bold; color: #1f2937;">👤 ${sale.customer_name}</p>` : ''}
        ${sale.customer_phone ? `<p style="margin: 4px 0 0 0; font-size: 12px; color: #6b7280;">📞 ${sale.customer_phone}</p>` : ''}
        ${sale.customer_address ? `<p style="margin: 4px 0 0 0; font-size: 12px; color: #6b7280;">📌 ${sale.customer_address}</p>` : ''}
        ${!sale.customer_name && !sale.customer_phone && !sale.customer_address ? '<p style="margin: 0; font-size: 12px; color: #9ca3af;">زبون عام / غير محدد</p>' : ''}
      </div>
    </div>

    <!-- Items Table -->
    <div style="border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; margin-bottom: 30px;">
      <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 13px;">
        <thead>
          <tr style="background-color: #4f46e5; color: white;">
            <th style="padding: 12px; font-weight: 800; width: 40px; text-align: center;">#</th>
            <th style="padding: 12px; font-weight: 800;">المنتج</th>
            <th style="padding: 12px; font-weight: 800; width: 60px; text-align: center;">الكمية</th>
            <th style="padding: 12px; font-weight: 800; width: 100px;">السعر الفردي</th>
            <th style="padding: 12px; font-weight: 800; width: 120px;">المجموع</th>
          </tr>
        </thead>
        <tbody>
          ${lines
            .map((line, idx) => {
              const name = line.name || line.product_name || line.barcode || `صنف ${idx + 1}`;
              const qty = line.qty ?? line.quantity ?? 1;
              const unitPrice = line.unit_price ?? line.unitPrice ?? 0;
              const total = unitPrice * qty;
              return `
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 12px; text-align: center; color: #6b7280; font-weight: bold;">${idx + 1}</td>
                <td style="padding: 12px; font-weight: bold; color: #1f2937;">${name}</td>
                <td style="padding: 12px; text-align: center; font-weight: bold; color: #1f2937;">${qty}</td>
                <td style="padding: 12px; color: #4b5563;">₪${Number(unitPrice).toFixed(2)}</td>
                <td style="padding: 12px; font-weight: 800; color: #111827;">₪${Number(total).toFixed(2)}</td>
              </tr>
            `;
            })
            .join('')}
        </tbody>
      </table>
    </div>

    <!-- Totals & Summary -->
    <div style="display: flex; justify-content: flex-end; margin-bottom: 40px;">
      <div style="width: 300px; display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
        <div style="display: flex; justify-content: space-between; color: #4b5563; font-weight: bold;">
          <span>الإجمالي الفرعي:</span>
          <span>₪${Number(subtotal).toFixed(2)}</span>
        </div>
        ${
          totalDiscount > 0
            ? `
          <div style="display: flex; justify-content: space-between; color: #10b981; font-weight: bold;">
            <span>الخصم المطبق:</span>
            <span>− ₪${Number(totalDiscount).toFixed(2)}</span>
          </div>
        `
            : ''
        }
        <div style="display: flex; justify-content: space-between; align-items: center; background-color: #f5f3ff; border: 1px solid #ddd6fe; padding: 12px; border-radius: 12px; margin-top: 8px;">
          <span style="font-size: 15px; font-weight: 800; color: #1f2937;">المجموع النهائي:</span>
          <span style="font-size: 18px; font-weight: 900; color: #4f46e5;">₪${Number(totalAmount).toFixed(2)}</span>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; text-align: center; color: #9ca3af; font-size: 12px; font-weight: bold;">
      شكراً لتعاملكم معنا — نسعد بخدمتكم دائماً
    </div>
  `;

  document.body.appendChild(container);

  try {
    // 2. Render to canvas
    const canvas = await html2canvas(container, {
      useCORS: true,
      scale: 2, // Retain high quality on render
      logging: false,
    });

    const imgData = canvas.toDataURL('image/png');

    // 3. Convert to PDF
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth(); // 210mm
    const pdfHeight = pdf.internal.pageSize.getHeight(); // 297mm
    const imgWidth = pdfWidth;
    const imgHeight = (canvas.height * pdfWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pdfHeight;

    while (heightLeft >= 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;
    }

    // 4. Trigger download
    const invoiceNum = sale.id.slice(0, 8).toUpperCase();
    pdf.save(`invoice-${invoiceNum}.pdf`);
  } catch (err) {
    console.error('Failed to generate PDF:', err);
  } finally {
    document.body.removeChild(container);
  }
}
