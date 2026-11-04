import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' }),
}));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({}) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeCarouselSlides: () => {} }));
vi.mock('@/lib/carouselService', () => ({
  getCarouselSlides: vi.fn().mockResolvedValue([]),
  createCarouselSlide: vi.fn(),
  updateCarouselSlide: vi.fn(),
  hardDeleteCarouselSlide: vi.fn(),
  toggleCarouselSlideActive: vi.fn(),
}));
vi.mock('@/lib/businessVisualSettingsService', async (importOriginal) => ({
  ...(await importOriginal()),
  saveVisualSettings: vi.fn().mockResolvedValue({ success: true }),
  applyVisualSettingsToDOM: vi.fn(),
  clearVisualSettingsCache: vi.fn(),
}));

import SettingsPageVisual from '@/components/settings/SettingsPageVisual';
import { DEFAULT_VISUAL_SETTINGS, saveVisualSettings } from '@/lib/businessVisualSettingsService';
import { BRAND_PRESET } from '@/lib/brandPalette';

const P = 'settings.visual.brand.';
const NEW_CONTROLS = {
  cartBadgeBgColor: `${P}cartBadgeBg`,
  cartBadgeTextColor: `${P}cartBadgeText`,
  carouselDotActiveColor: `${P}carouselDotActive`,
  borderColor: `${P}border`,
  mutedTextColor: `${P}mutedText`,
  softAccentColor: `${P}softAccent`,
  focusRingColor: `${P}focusRing`,
};

const setup = (overrides = {}) => {
  const setVisualSettings = vi.fn();
  const visualSettings = { ...DEFAULT_VISUAL_SETTINGS, ...overrides };
  const ui = (vs) => (
    <SettingsPageVisual
      localVisual={vs}
      setLocalVisual={vi.fn()}
      visualSettings={vs}
      setVisualSettings={setVisualSettings}
    />
  );
  const { rerender } = render(ui(visualSettings));
  return { setVisualSettings, rerender: (next) => rerender(ui({ ...DEFAULT_VISUAL_SETTINGS, ...next })) };
};

// The legacy colour inputs are not associated to their label; find them through the label text.
const legacyInput = (labelKey) => screen.getByText(labelKey).parentElement.querySelector('input');
const warning = () => screen.getByTestId('brand-contrast-warning');

beforeEach(() => vi.clearAllMocks());

describe('SettingsPageVisual - new brand controls', () => {
  it('renders one colour control per new key with the current value', () => {
    setup();
    for (const [key, label] of Object.entries(NEW_CONTROLS)) {
      expect(screen.getByLabelText(label).value, key).toBe(DEFAULT_VISUAL_SETTINGS[key].toLowerCase());
    }
  });

  it('changes form state and persists the new keys on Save', () => {
    const { setVisualSettings } = setup({ useGradient: false });
    fireEvent.click(screen.getByLabelText('settings.visual.livePreview')); // live preview off: nothing persists yet
    fireEvent.change(screen.getByLabelText(NEW_CONTROLS.cartBadgeBgColor), { target: { value: '#123456' } });
    expect(screen.getByLabelText(NEW_CONTROLS.cartBadgeBgColor).value).toBe('#123456');
    expect(setVisualSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('settings.visual.saveCustomization'));
    const payload = setVisualSettings.mock.calls[0][0];
    expect(payload.cartBadgeBgColor).toBe('#123456');
    for (const key of Object.keys(NEW_CONTROLS)) expect(payload, key).toHaveProperty(key);
  });
});

describe('SettingsPageVisual - brand preset', () => {
  it('fills the form state without saving anything', () => {
    const { setVisualSettings } = setup();
    expect(legacyInput('settings.visual.pageBackground').value).toBe('#f9fafb');

    fireEvent.click(screen.getByText(`${P}applyPreset`));

    expect(legacyInput('settings.visual.pageBackground').value).toBe(BRAND_PRESET.pageBgColor.toLowerCase());
    expect(legacyInput('settings.visual.buttonColor').value).toBe('#ffa500');
    expect(legacyInput('settings.visual.buttonHoverColor').value).toBe('#e59400');
    expect(screen.getByLabelText(NEW_CONTROLS.focusRingColor).value).toBe('#171717');
    expect(setVisualSettings).not.toHaveBeenCalled();
    expect(saveVisualSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId('brand-preset-applied')).toHaveTextContent(`${P}applied`);
  });

  it('turns live preview off so a later edit cannot persist the preset behind the Save button', () => {
    const { setVisualSettings } = setup();
    expect(screen.getByLabelText('settings.visual.livePreview')).toBeChecked();
    fireEvent.click(screen.getByText(`${P}applyPreset`));
    expect(screen.getByLabelText('settings.visual.livePreview')).not.toBeChecked();
    fireEvent.change(screen.getByLabelText(NEW_CONTROLS.cartBadgeBgColor), { target: { value: '#123456' } });
    expect(setVisualSettings).not.toHaveBeenCalled();
  });

  it('persists the preset only through the existing Save button', () => {
    const { setVisualSettings } = setup();
    fireEvent.click(screen.getByText(`${P}applyPreset`));
    fireEvent.click(screen.getByText('settings.visual.saveCustomization'));
    expect(setVisualSettings).toHaveBeenCalledTimes(1);
    expect(setVisualSettings.mock.calls[0][0]).toMatchObject(BRAND_PRESET);
  });

  it('restores the previous values (and live preview) with the undo button', () => {
    setup({ pageBgColor: '#f9fafb', buttonBgColor: '#2563eb' });
    fireEvent.click(screen.getByText(`${P}applyPreset`));
    fireEvent.click(screen.getByText(`${P}undoPreset`));

    expect(legacyInput('settings.visual.pageBackground').value).toBe('#f9fafb');
    expect(legacyInput('settings.visual.buttonColor').value).toBe('#2563eb');
    expect(screen.getByLabelText('settings.visual.livePreview')).toBeChecked();
    expect(screen.queryByText(`${P}undoPreset`)).not.toBeInTheDocument();
  });
});

describe('SettingsPageVisual - preset lifecycle', () => {
  it('clears the applied notice and undo after Save', async () => {
    setup();
    fireEvent.click(screen.getByText(`${P}applyPreset`));
    fireEvent.click(screen.getByText('settings.visual.saveCustomization'));
    await waitFor(() => expect(screen.queryByTestId('brand-preset-applied')).not.toBeInTheDocument());
    expect(screen.queryByText(`${P}undoPreset`)).not.toBeInTheDocument();
  });

  it('clears the applied notice and undo after Restore theme', async () => {
    setup();
    fireEvent.click(screen.getByText(`${P}applyPreset`));
    fireEvent.click(screen.getByText('settings.visual.restoreTheme'));
    await waitFor(() => expect(screen.queryByText(`${P}undoPreset`)).not.toBeInTheDocument());
    expect(screen.queryByTestId('brand-preset-applied')).not.toBeInTheDocument();
  });

  it('keeps the preset in the form when visualSettings is refreshed externally', () => {
    const { rerender } = setup();
    fireEvent.click(screen.getByText(`${P}applyPreset`));
    rerender({ pageBgColor: '#f9fafb', logo: 'x.png' });
    expect(legacyInput('settings.visual.pageBackground').value).toBe('#faf7f0');
    expect(screen.getByText(`${P}undoPreset`)).toBeInTheDocument();
  });
});

describe('SettingsPageVisual - contrast warning', () => {
  it('stays silent for the legacy production colours', () => {
    setup();
    expect(warning()).toBeEmptyDOMElement();
    expect(warning()).toHaveAttribute('role', 'status');
  });

  it('warns (without blocking) when white text sits on the gold button: 1.97:1', () => {
    const { setVisualSettings } = setup({ buttonBgColor: '#FFA500', buttonTextColor: '#FFFFFF' });
    expect(within(warning()).getByText(new RegExp(`${P}pair\\.button.*1\\.97`))).toBeInTheDocument();
    expect(screen.getByText('settings.visual.saveCustomization').closest('button')).toBeEnabled();
    expect(setVisualSettings).not.toHaveBeenCalled();
  });

  it('does not warn for charcoal text on the gold button: 9.08:1', () => {
    setup({ buttonBgColor: '#FFA500', buttonTextColor: '#171717' });
    expect(warning()).toBeEmptyDOMElement();
  });

  it('reacts to edits of the new cart badge pair', () => {
    setup();
    fireEvent.change(screen.getByLabelText(NEW_CONTROLS.cartBadgeTextColor), { target: { value: '#ffffff' } });
    expect(within(warning()).getByText(new RegExp(`${P}pair\\.cartBadge`))).toBeInTheDocument();
  });
});
