/** Strip RTL marks and spaces that make Auth reject a valid-looking email. */
export function normalizeAuthEmail(value) {
  return String(value || '')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim()
    .toLowerCase();
}

export function mapAuthErrorMessage(error) {
  const raw = String(error?.message || error || '').trim();
  const lower = raw.toLowerCase();

  if (lower.includes('invalid login credentials')) {
    return 'بيانات الدخول غير صحيحة. تأكد من الإيميل وكلمة المرور، أو أنشئ حساباً جديداً إذا ما عندك حساب على هذا المشروع.';
  }
  if (lower.includes('email not confirmed')) {
    return 'الحساب موجود لكن الإيميل غير مؤكد. افتح بريدك وأكد الحساب، أو استخدم «نسيت كلمة المرور».';
  }
  if (lower.includes('user already registered') || lower.includes('already registered')) {
    return 'هذا الإيميل مسجّل مسبقاً. سجّل الدخول أو استخدم «نسيت كلمة المرور».';
  }
  if (lower.includes('password should be at least') || lower.includes('password is known to be weak')) {
    return 'كلمة المرور ضعيفة أو قصيرة. استخدم 6 أحرف على الأقل.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'محاولات كثيرة خلال وقت قصير. انتظر قليلاً ثم أعد المحاولة.';
  }
  if (lower.includes('invalid email')) {
    return 'صيغة الإيميل غير صحيحة.';
  }

  return raw || 'تعذّر تسجيل الدخول.';
}
