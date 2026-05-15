import { useState } from 'react';

/**
 * عرض النجوم — قراءة فقط أو تفاعلي.
 * @param {number} value - القيمة الحالية (0-5)
 * @param {number} count - عدد التقييمات (يُعرض بجانب النجوم)
 * @param {boolean} interactive - هل يمكن للمستخدم تغيير القيمة؟
 * @param {function} onChange - دالة تُستدعى عند تغيير التقييم (interactive فقط)
 * @param {'sm'|'md'|'lg'} size - حجم النجوم
 * @param {boolean} showCount - هل يُعرض عدد التقييمات؟
 */
export default function StarRating({
  value = 0,
  count,
  interactive = false,
  onChange,
  size = 'sm',
  showCount = true,
  className = '',
}) {
  const [hovered, setHovered] = useState(0);

  const sizePx = size === 'lg' ? 24 : size === 'md' ? 18 : 13;
  const gap = size === 'lg' ? 'gap-1' : 'gap-0.5';

  const effective = interactive && hovered > 0 ? hovered : value;

  return (
    <div className={`flex items-center ${gap} ${className}`} dir="ltr">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = effective >= star;
        const half = !filled && effective >= star - 0.5;
        return (
          <button
            key={star}
            type="button"
            disabled={!interactive}
            onClick={() => interactive && onChange?.(star)}
            onMouseEnter={() => interactive && setHovered(star)}
            onMouseLeave={() => interactive && setHovered(0)}
            className={`relative shrink-0 transition-transform ${
              interactive ? 'cursor-pointer hover:scale-125 active:scale-110' : 'cursor-default'
            }`}
            aria-label={`${star} نجوم`}
            style={{ width: sizePx, height: sizePx }}
          >
            {/* نجمة فارغة */}
            <svg
              width={sizePx}
              height={sizePx}
              viewBox="0 0 24 24"
              fill="none"
              stroke={filled || half ? '#f59e0b' : '#cbd5e1'}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>

            {/* تعبئة حسب القيمة */}
            {(filled || half) && (
              <svg
                width={sizePx}
                height={sizePx}
                viewBox="0 0 24 24"
                className="absolute inset-0"
                style={{ clipPath: half ? 'inset(0 50% 0 0)' : undefined }}
              >
                <polygon
                  points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                  fill="#f59e0b"
                  stroke="#f59e0b"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        );
      })}

      {showCount && count != null && (
        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mr-0.5">
          ({count})
        </span>
      )}
    </div>
  );
}
