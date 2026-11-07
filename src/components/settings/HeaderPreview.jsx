import React from 'react';
import HeaderBrand, { NAV_IDLE, NAV_ACTIVE } from '@/components/HeaderBrand';
import { buildHeaderTheme } from '@/lib/headerTheme';

const NAV_LABELS = ['Home', 'Products', 'Admin'];

/**
 * Visual settings preview of the real Header for the (possibly unsaved) form state. Colours come from the same
 * buildHeaderTheme as Header.jsx and the brand block from the same HeaderBrand, so it cannot drift from it.
 */
const HeaderPreview = ({ settings, className = '' }) => {
  const theme = buildHeaderTheme(settings);
  return (
    <div
      data-testid="header-preview"
      className={`rounded-xl border border-gray-200 shadow-sm overflow-hidden ${className}`}
      style={theme}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <HeaderBrand settings={settings} legacyMark={Boolean(theme['--hdr-mark-from'])} />
        <div className="flex-1" />
        <div className="flex gap-1" aria-hidden="true">
          {NAV_LABELS.map((label, index) => (
            <span
              key={label}
              className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-default transition-colors ${index === NAV_LABELS.length - 1 ? NAV_ACTIVE : NAV_IDLE}`}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default HeaderPreview;
