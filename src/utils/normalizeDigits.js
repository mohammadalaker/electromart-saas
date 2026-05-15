/**
 * بدايات كتل الأرقام العشرية في Unicode (كل كتلة بطول 10: 0–9).
 * يُحوَّل كل رقم إلى الأرقام اللاتينية 0–9.
 * @see https://www.unicode.org/charts/ — General Category: Nd
 */
const DECIMAL_DIGIT_BLOCK_STARTS = [
  0x0030, 0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6,
  0x0d66, 0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x104a0, 0x1090, 0x17e0, 0x1810, 0x1946,
  0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0,
  0xa9f0, 0xaa50, 0xabf0, 0xff10, 0x11066, 0x110f0, 0x11136, 0x111d0, 0x112f0, 0x11450,
  0x114d0, 0x11650, 0x116c0, 0x11730, 0x118e0, 0x11c50, 0x11d50, 0x16a60, 0x16b50, 0x1d7ce,
  0x1d7d8, 0x1d7e2, 0x1d7ec, 0x1d7f6,
];

/**
 * تحويل أي أرقام (عربية، فارسية، هندية، عريضة، …) إلى أرقام لاتينية 0–9.
 * آمن للنصوص المختلطة: يُغيّر خانات الأرقام فقط ويترك باقي الرموز كما هي.
 */
export function normalizeDigitsToLatin(str) {
  if (str == null) return '';
  let out = '';
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    let converted = false;
    for (const start of DECIMAL_DIGIT_BLOCK_STARTS) {
      if (cp >= start && cp <= start + 9) {
        out += String.fromCharCode(0x30 + (cp - start));
        converted = true;
        break;
      }
    }
    if (!converted) out += ch;
  }
  return out;
}

/**
 * تجهيز نص السعر للتحليل: أرقام عربية/هندية/فارسية → لاتينية،
 * الفاصلة العشرية العربية (U+066B) → نقطة، إزالة فاصل الآلاف العربي (U+066C).
 * ثم يمكن استخدام .replace(',', '.') للفاصلة الأوروبية.
 */
export function normalizePriceInput(str) {
  if (str == null) return '';
  let s = normalizeDigitsToLatin(String(str).trim());
  s = s.replace(/\u066B/g, '.');
  s = s.replace(/\u066C/g, '');
  return s;
}
