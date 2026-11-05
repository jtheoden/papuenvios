import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { buildFooterTheme } from '@/lib/footerTheme';
import { SIGNATURE, MUTED, BRAND, FOOTER_ROOT } from '@/lib/footerStyles';

/**
 * Settings > Visual footer preview. It resolves colours with buildFooterTheme and paints with the same
 * classes as Footer.jsx, so what the super admin sees is what the footer shows (border, company name,
 * text opacity, signature underline and hover included).
 */
const FooterPreview = ({ settings }) => {
  const { t } = useLanguage();
  const companyName = settings.companyName || 'PapuEnvíos';

  return (
    <div data-testid="footer-preview" className={`rounded-lg overflow-hidden ${FOOTER_ROOT}`} style={buildFooterTheme(settings)}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
        <span data-testid="footer-preview-text" className={MUTED}>© 2026 {companyName}</span>
        <span data-testid="footer-preview-signature" className={`${SIGNATURE} cursor-default`}>
          {t('settings.visual.footerPreviewLink')}
        </span>
        <span data-testid="footer-preview-name" className={BRAND}>{companyName}</span>
      </div>
    </div>
  );
};

export default FooterPreview;
