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
import { THEME_PRESETS } from '@/lib/visualThemes';
import { CLASSIC_ROW } from '../fixtures/classicVisualRow';
vi.mock('@/components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) })); // these tests do not exercise confirmations

const T = 'settings.visual.brand.theme.';
const PROD = { ...DEFAULT_VISUAL_SETTINGS, ...CLASSIC_ROW };

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
    expect(radio('classic')).toHaveAccessibleDescription(`${T}classic.description ${T}inUse`); // classic is the saved theme
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
    expect(payload.classicSnapshot).toEqual(Object.fromEntries(Object.keys(BRAND_PRESET).map((key) => [key, PROD[key]])));
    expect(payload.primaryColor).toBe('#171717');
    expect(payload.secondaryColor).toBe('#605B52');
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

  it('an old classic row without the key saves as classic', () => {
    const { setVisualSettings } = setup();
    save();
    expect(setVisualSettings.mock.calls[0][0].activeTheme).toBe('classic');
  });
});

describe('theme selector - the real production row (brand values, no activeTheme)', () => {
  const REAL = { ...BRAND_PRESET, logo: 'x.png', homeFeatures: [{ id: 'custom' }] };

  it('shows papuenvios as selected and in use, and describes the badge', () => {
    setup(REAL);
    expect(radio('papuenvios')).toBeChecked();
    expect(radio('classic')).not.toBeChecked();
    expect(radio('papuenvios').closest('label')).toHaveTextContent(`${T}inUse`);
    expect(radio('papuenvios')).toHaveAccessibleDescription(`${T}papuenvios.description ${T}inUse`);
    expect(radio('classic')).toHaveAccessibleDescription(`${T}classic.description`);
  });

  it('clicking Clasico really switches the form and saves classic with the content untouched', () => {
    const { setVisualSettings } = setup(REAL);
    fireEvent.click(radio('classic'));
    expect(radio('classic')).toBeChecked();
    expect(legacyInput('settings.visual.pageBackground').value).toBe('#f9fafb');
    save();
    const payload = setVisualSettings.mock.calls[0][0];
    expect(payload.activeTheme).toBe('classic');
    expect(payload).toMatchObject(THEME_PRESETS.classic);
    expect(payload.logo).toBe('x.png');
    expect(payload.homeFeatures).toEqual([{ id: 'custom' }]);
  });
});

describe('theme selector - hand-edited colours notice', () => {
  const notice = () => screen.queryByTestId('theme-customized');

  it('is silent while the form equals the preset of its theme', () => {
    setup(THEME_PRESETS.classic);
    expect(notice()).not.toBeInTheDocument();
  });

  it('appears when a preset colour is edited by hand, and goes away when the edit is undone', () => {
    setup(THEME_PRESETS.classic);
    fireEvent.change(screen.getByLabelText('settings.visual.brand.cartBadgeBg'), { target: { value: '#123456' } });
    expect(notice()).toHaveAttribute('role', 'status');
    expect(notice()).toHaveTextContent(`${T}customized`);
    fireEvent.change(screen.getByLabelText('settings.visual.brand.cartBadgeBg'), { target: { value: '#dc2626' } });
    expect(notice()).not.toBeInTheDocument();
  });

  it('is cleared by choosing a theme (its preset replaces the edits)', () => {
    setup({ cartBadgeBgColor: '#123456' });
    expect(notice()).toBeInTheDocument();
    fireEvent.click(radio('papuenvios'));
    expect(notice()).not.toBeInTheDocument();
  });
});

describe('Restore theme (form-only reset to the code defaults)', () => {
  const STORED = {
    ...BRAND_PRESET,
    activeTheme: 'papuenvios',
    classicSnapshot: { buttonBgColor: '#123456' },
    primaryColor: '#abcdef',
    logo: 'x.png',
    favicon: 'y.png',
    siteTitle: 'Acme - tienda',
    companyName: 'Acme',
    carouselAutoplaySpeed: 9000,
    homeFeatures: [{ id: 'custom', titleEs: 'Mio' }],
  };
  const restoreButton = () => screen.queryByRole('button', { name: 'settings.visual.restoreTheme' });
  const confirmButton = () => screen.getByRole('button', { name: `${'settings.visual.brand.'}reset.confirm` });

  it('is hidden for anyone without theme permission, so an admin cannot run it', () => {
    setup(STORED, { canChangeTheme: false });
    expect(restoreButton()).not.toBeInTheDocument();
    expect(saveVisualSettings).not.toHaveBeenCalled();
  });

  it('has an accessible name even when only the icon shows, different from the harmless undo text', () => {
    setup(STORED);
    const button = restoreButton();
    expect(button).toHaveAttribute('aria-label', 'settings.visual.restoreTheme');
    expect(button.getAttribute('aria-label')).not.toBe('settings.visual.brand.undoPreset');
  });

  it('asks for confirmation first and explains the consequences; nothing is saved before confirming', () => {
    setup(STORED);
    fireEvent.click(restoreButton());
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('settings.visual.brand.reset.title')).toBeInTheDocument();
    expect(within(dialog).getByText('settings.visual.brand.reset.description')).toBeInTheDocument();
    expect(saveVisualSettings).not.toHaveBeenCalled();
  });

  it('cancelling closes the dialog and saves nothing', () => {
    const { setVisualSettings } = setup(STORED);
    fireEvent.click(restoreButton());
    fireEvent.click(screen.getByRole('button', { name: 'settings.visual.brand.reset.cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(saveVisualSettings).not.toHaveBeenCalled();
    expect(setVisualSettings).not.toHaveBeenCalled();
    expect(radio('papuenvios')).toBeChecked();
  });

  it('confirming resets the theme keys to the code defaults and keeps all content keys', async () => {
    const { setVisualSettings } = setup(STORED);
    fireEvent.click(restoreButton());
    fireEvent.click(confirmButton());
    expect(saveVisualSettings).not.toHaveBeenCalled();
    expect(setVisualSettings).not.toHaveBeenCalled();
    save();
    expect(setVisualSettings).toHaveBeenCalledTimes(1);
    const saved = setVisualSettings.mock.calls[0][0];
    expect(saved).toMatchObject(THEME_PRESETS.classic);
    expect(saved.primaryColor).toBe(DEFAULT_VISUAL_SETTINGS.primaryColor);
    expect(saved.activeTheme).toBe('classic');
    expect(saved.classicSnapshot).toBeNull();
    for (const key of ['logo', 'favicon', 'siteTitle', 'companyName', 'carouselAutoplaySpeed', 'homeFeatures']) {
      expect(saved[key], key).toEqual(STORED[key]);
    }
    expect(setVisualSettings).toHaveBeenCalledWith(saved);
    await waitFor(() => expect(radio('classic')).toBeChecked());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
