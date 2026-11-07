// Browser-only component fixture: no application login or real data is used.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '../../../contexts/LanguageContext';
import SettingsPageVisual from '../../../components/settings/SettingsPageVisual';
import { DEFAULT_VISUAL_SETTINGS } from '../../../lib/businessVisualSettingsService';
import { BRAND_PRESET } from '../../../lib/brandPalette';
import { CLASSIC_ROW } from '../../fixtures/classicVisualRow';

const theme = window.__previewTheme;
const stored = {
  ...DEFAULT_VISUAL_SETTINGS,
  ...(theme === 'classic' ? CLASSIC_ROW : BRAND_PRESET),
  // The brand row still contains these historical values until the owner explicitly saves.
  primaryColor: CLASSIC_ROW.primaryColor,
  secondaryColor: CLASSIC_ROW.secondaryColor,
  headerGradientColor: CLASSIC_ROW.headerGradientColor,
};
document.documentElement.dataset.theme = theme;
window.__visualSaves = [];
createRoot(document.getElementById('preview-root')).render(
  <LanguageProvider>
    <main className="p-4">
      <SettingsPageVisual
        visualSettings={stored}
        setVisualSettings={(settings) => { window.__visualSaves.push(settings); }}
        localVisual={{}}
        setLocalVisual={() => {}}
        canChangeTheme
      />
    </main>
  </LanguageProvider>
);
