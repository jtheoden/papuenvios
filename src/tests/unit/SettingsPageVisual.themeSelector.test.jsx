import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

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
import { THEME_PRESETS } from '@/lib/visualThemes';
import { PROD_ROW } from '../fixtures/prodVisualRow';

const T = 'settings.visual.brand.theme.';
const PROD = { ...DEFAULT_VISUAL_SETTINGS, ...PROD_ROW };

const setup = (overrides = {}, props = {}) => {
  const setVisualSettings = vi.fn();
  render(
    <SettingsPageVisual
      localVisual={{}}
      setLocalVisual={vi.fn()}
      visualSettings={{ ...PROD, ...overrides }}
      setVisualSettings={setVisualSettings}
      canChangeTheme
      {...props}
    />
  );
  return { setVisualSettings };
};

const radio = (id) => screen.getByRole('radio', { name: `${T}${id}.name` });
const legacyInput = (labelKey) => screen.getByText(labelKey).parentElement.querySelector('input');
const livePreview = () => screen.getByLabelText('settings.visual.livePreview');
const save = () => fireEvent.click(screen.getByText('settings.visual.saveCustomization'));

beforeEach(() => vi.clearAllMocks());

describe('theme selector - accessibility', () => {
  it('is a named radiogroup with two native radios sharing one name, each with a description', () => {
    setup();
    const group = screen.getByRole('radiogroup', { name: `${T}title` });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(new Set(radios.map((r) => r.getAttribute('name'))).size).toBe(1);
    for (const r of radios) expect(r).toHaveAttribute('type', 'radio'); // native: arrow keys and Space work
    expect(radio('classic')).toHaveAccessibleDescription(`${T}classic.description`);
    expect(radio('papuenvios')).toHaveAccessibleDescription(`${T}papuenvios.description`);
  });

  it('selects classic when the stored row has no theme key', () => {
    setup();
    expect(radio('classic')).toBeChecked();
    expect(radio('papuenvios')).not.toBeChecked();
  });

  it('selects papuenvios when it is the saved theme, and says so in text (not only by colour)', () => {
    setup({ activeTheme: 'papuenvios' });
    expect(radio('papuenvios')).toBeChecked();
    const group = screen.getByRole('radiogroup');
    expect(within(group).getAllByText(`${T}inUse`)).toHaveLength(1);
    expect(radio('papuenvios').closest('label')).toHaveTextContent(`${T}inUse`);
    expect(radio('classic').closest('label')).not.toHaveTextContent(`${T}inUse`);
  });

  it('shows colour swatches for each theme, hidden from assistive tech', () => {
    setup();
    const swatches = radio('papuenvios').closest('label').querySelectorAll('[data-testid="theme-swatch"]');
    expect(swatches.length).toBeGreaterThanOrEqual(3);
    for (const s of swatches) expect(s).toHaveAttribute('aria-hidden', 'true');
    expect([...swatches].map((s) => s.style.backgroundColor)).toContain('rgb(255, 165, 0)'); // gold
  });

  it('explains what a theme change replaces and what it keeps', () => {
    setup();
    expect(screen.getByText(`${T}changes`)).toBeInTheDocument();
  });
});

describe('theme selector - permissions', () => {
  it('is read-only for anyone who is not a super admin, with an explanation', () => {
    setup({}, { canChangeTheme: false });
    expect(radio('classic')).toBeDisabled();
    expect(radio('papuenvios')).toBeDisabled();
    expect(screen.getByText(`${T}restricted`)).toBeInTheDocument();
    fireEvent.click(radio('papuenvios'));
    expect(radio('classic')).toBeChecked();
  });

  it('is read-only when the prop is not passed at all (safe default)', () => {
    setup({}, { canChangeTheme: undefined });
    expect(radio('papuenvios')).toBeDisabled();
  });

  it('is enabled for a super admin without the restriction note', () => {
    setup();
    expect(radio('papuenvios')).toBeEnabled();
    expect(screen.queryByText(`${T}restricted`)).not.toBeInTheDocument();
  });
});

describe('theme selector - preview does not persist', () => {
  it('choosing a theme only fills the form: nothing is saved or applied', () => {
    const { setVisualSettings } = setup();
    fireEvent.click(radio('papuenvios'));
    expect(radio('papuenvios')).toBeChecked();
    expect(legacyInput('settings.visual.pageBackground').value).toBe(BRAND_PRESET.pageBgColor.toLowerCase());
    expect(setVisualSettings).not.toHaveBeenCalled();
    expect(saveVisualSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId('brand-preset-applied')).toHaveTextContent(`${T}pending`);
  });

  it('turns live preview off and locks it while the choice is unsaved, so an edit cannot persist it', () => {
    const { setVisualSettings } = setup();
    expect(livePreview()).toBeChecked();
    fireEvent.click(radio('papuenvios'));
    expect(livePreview()).not.toBeChecked();
    expect(livePreview()).toBeDisabled();
    fireEvent.click(livePreview()); // a disabled checkbox ignores clicks
    fireEvent.change(screen.getByLabelText('settings.visual.brand.cartBadgeBg'), { target: { value: '#123456' } });
    expect(setVisualSettings).not.toHaveBeenCalled();
  });

  it('the undo button reverts the choice and unlocks live preview', () => {
    setup();
    fireEvent.click(radio('papuenvios'));
    fireEvent.click(screen.getByText(`${'settings.visual.brand.'}undoPreset`));
    expect(radio('classic')).toBeChecked();
    expect(legacyInput('settings.visual.pageBackground').value).toBe('#f9fafb');
    expect(livePreview()).toBeChecked();
    expect(livePreview()).toBeEnabled();
  });
});

describe('theme selector - what Save persists', () => {
  it('papuenvios: brand values, activeTheme and a snapshot of the previous values', () => {
    const { setVisualSettings } = setup();
    fireEvent.click(radio('papuenvios'));
    save();
    expect(setVisualSettings).toHaveBeenCalledTimes(1);
    const payload = setVisualSettings.mock.calls[0][0];
    expect(payload).toMatchObject(BRAND_PRESET);
    expect(payload.activeTheme).toBe('papuenvios');
    expect(payload.classicSnapshot).toEqual(THEME_PRESETS.classic);
    // custom values outside the preset survive
    expect(payload.primaryColor).toBe('#3499dc');
    expect(payload.secondaryColor).toBe('#9333ea');
  });

  it('classic round trip: unsaved papuenvios -> classic saves the original values and no snapshot', () => {
    const { setVisualSettings } = setup({ buttonBgColor: '#abcdef' });
    fireEvent.click(radio('papuenvios'));
    fireEvent.click(radio('classic'));
    expect(legacyInput('settings.visual.buttonColor').value).toBe('#abcdef');
    save();
    const payload = setVisualSettings.mock.calls[0][0];
    expect(payload.activeTheme).toBe('classic');
    expect(payload.buttonBgColor).toBe('#abcdef');
    expect(payload.classicSnapshot).toBeNull();
  });

  it('going back to classic from a saved papuenvios restores the snapshot and saves classicSnapshot as null', () => {
    const classicSnapshot = { ...THEME_PRESETS.classic, buttonBgColor: '#abcdef', pageBgColor: '#eeeeee' };
    const { setVisualSettings } = setup({ ...BRAND_PRESET, activeTheme: 'papuenvios', classicSnapshot });
    expect(radio('papuenvios')).toBeChecked();
    fireEvent.click(radio('classic'));
    expect(legacyInput('settings.visual.buttonColor').value).toBe('#abcdef');
    expect(legacyInput('settings.visual.pageBackground').value).toBe('#eeeeee');
    save();
    const payload = setVisualSettings.mock.calls[0][0];
    expect(payload.activeTheme).toBe('classic');
    expect(payload.buttonBgColor).toBe('#abcdef');
    expect(payload.pageBgColor).toBe('#eeeeee');
    expect(payload.useGradient).toBe(true);
    expect(payload.classicSnapshot).toBeNull(); // explicit null: the old snapshot must not survive the merge
  });

  it('saving without touching the selector keeps the stored theme and snapshot', () => {
    const classicSnapshot = { ...THEME_PRESETS.classic };
    const { setVisualSettings } = setup({ ...BRAND_PRESET, activeTheme: 'papuenvios', classicSnapshot });
    save();
    const payload = setVisualSettings.mock.calls[0][0];
    expect(payload.activeTheme).toBe('papuenvios');
    expect(payload.classicSnapshot).toEqual(classicSnapshot);
  });

  it('an old row without the key saves as classic', () => {
    const { setVisualSettings } = setup();
    save();
    expect(setVisualSettings.mock.calls[0][0].activeTheme).toBe('classic');
  });
});
