import React, { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { showNameWithLogo, safeLogoSrc } from '@/lib/brandingDisplay';

// shortcut: legacy wordmark gradient (see buildHeaderTheme), until S5 brings the official logo.
export const MARK_GRADIENT = 'bg-[linear-gradient(to_right,var(--hdr-mark-from),var(--hdr-mark-to))]';
// Colours come from CSS variables set on the header root (see buildHeaderTheme). Shared by Header and the Visual settings preview.
export const NAV_IDLE = 'text-[color:var(--hdr-text)] hover:bg-[color:var(--hdr-hover-bg)] hover:text-[color:var(--hdr-hover-text)]';
// The active state does not rely on colour alone: bold + underline (WCAG 1.4.1).
export const ACTIVE_CUE = 'font-semibold underline decoration-2 underline-offset-4';
export const NAV_ACTIVE = `${ACTIVE_CUE} [background:var(--hdr-active-background)] text-[color:var(--hdr-active-text)] hover:bg-[color:var(--hdr-active-bg)] hover:text-[color:var(--hdr-active-text)]`;

/**
 * Logo (or legacy mark) plus company name, exactly as the Header draws them. Header and the Visual settings preview
 * both render this, so what the admin previews cannot drift from the real thing. `legacyMark` = buildHeaderTheme
 * produced --hdr-mark-from. The name is hidden when the admin said the logo already contains it, but only with a logo.
 */
const HeaderBrand = ({ settings, legacyMark }) => {
  const [failedSrc, setFailedSrc] = useState('');
  const src = safeLogoSrc(settings?.logo);
  const hasLogo = Boolean(src) && failedSrc !== src; // an unsafe or broken logo counts as no logo: the brand is never empty
  const showName = settings?.showCompanyName !== false && (!hasLogo || showNameWithLogo(settings));
  return (
    <>
      {hasLogo ? (
        <img
          src={src}
          alt={settings.companyName || 'Logo'}
          onError={() => setFailedSrc(src)}
          className="object-contain flex-shrink-0"
          style={{
            maxHeight: `${settings.logoMaxHeight || 40}px`,
            width: 'auto'
          }}
        />
      ) : legacyMark && (
        <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${MARK_GRADIENT}`}>
          <ShoppingBag className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
        </div>
      )}
      {showName && (
        <span
          className={`text-sm sm:text-xl font-bold truncate max-w-[100px] sm:max-w-none ${legacyMark ? `${MARK_GRADIENT} bg-clip-text text-transparent` : ''}`}
        >
          {settings?.companyName || 'PapuEnvíos'}
        </span>
      )}
    </>
  );
};

export default HeaderBrand;
