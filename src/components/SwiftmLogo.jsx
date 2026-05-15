import React from 'react';
import { BRAND_TAGLINE_EN } from '../constants/brand.js';

export default function SwiftmLogo({ compact = false, showTagline = true, className = '', variant = 'light' }) {
  const iconSize = compact ? 32 : 40;
  const taglineClassName =
    variant === 'dark'
      ? 'mt-0.5 text-xs font-medium uppercase tracking-[0.3em] text-white/60'
      : 'mt-0.5 text-xs font-medium uppercase tracking-[0.3em] text-slate-400';

  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      <div className="flex items-center gap-2">
        <svg width={iconSize} height={iconSize} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#7c3aed" />
            </linearGradient>
          </defs>
          <polyline points="4,20 24,4 44,20" stroke="url(#logoGrad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="31" y="7" width="6" height="9" rx="2" stroke="url(#logoGrad)" strokeWidth="3" strokeLinecap="round" />
          <path d="M10,20 L10,42 Q10,44 12,44 L36,44 Q38,44 38,42 L38,20" stroke="url(#logoGrad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="17" y="27" width="14" height="13" rx="4" stroke="url(#logoGrad)" strokeWidth="2.8" />
          <rect x="20" y="22" width="3" height="7" rx="1.5" fill="url(#logoGrad)" />
          <rect x="25" y="22" width="3" height="7" rx="1.5" fill="url(#logoGrad)" />
          <line x1="24" y1="40" x2="24" y2="44" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="21" y1="44" x2="27" y2="44" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" />
        </svg>

        <span
          style={
            variant === 'dark'
              ? {
                  fontWeight: 700,
                  fontSize: compact ? '18px' : '24px',
                  letterSpacing: '-0.5px',
                  lineHeight: 1.1,
                  color: '#ffffff',
                }
              : {
                  fontWeight: 700,
                  fontSize: compact ? '18px' : '24px',
                  letterSpacing: '-0.5px',
                  lineHeight: 1.1,
                  background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }
          }
        >
          swiftm
        </span>
      </div>

      {showTagline && (
        <span className={taglineClassName} dir="ltr">
          {BRAND_TAGLINE_EN}
        </span>
      )}
    </div>
  );
}
