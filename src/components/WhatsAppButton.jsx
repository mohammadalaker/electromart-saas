import { sendWhatsApp, hasValidPhone } from '../utils/whatsapp';

export function WhatsAppIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.117 1.528 5.845L.057 23.547a.5.5 0 0 0 .609.61l5.857-1.53A11.943 11.943 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.894a9.894 9.894 0 0 1-5.044-1.376l-.361-.214-3.737.977.999-3.645-.235-.374A9.895 9.895 0 0 1 2.106 12C2.106 6.533 6.533 2.106 12 2.106c5.467 0 9.894 4.427 9.894 9.894 0 5.467-4.427 9.894-9.894 9.894z" />
    </svg>
  );
}

export default function WhatsAppButton({ phone, message, children, className = '', onClick }) {
  if (!hasValidPhone(phone)) return null;

  return (
    <button
      type="button"
      onClick={() => {
        onClick?.();
        sendWhatsApp(phone, message);
      }}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white transition-all hover:opacity-90 ${className}`}
      style={{ backgroundColor: '#22c55e' }}
    >
      <WhatsAppIcon />
      {children}
    </button>
  );
}
