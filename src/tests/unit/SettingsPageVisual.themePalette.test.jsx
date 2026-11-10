import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'es' }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({}) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeCarouselSlides: () => {} }));
vi.mock('@/lib/carouselService', () => ({
  getCarouselSlides: vi.fn().mockResolvedValue([]), createCarouselSlide: vi.fn(),
  updateCarouselSlide: vi.fn(), hardDeleteCarouselSlide: vi.fn(), toggleCarouselSlideActive: vi.fn(),
}));
vi.mock('@/lib/businessVisualSettingsService', async (original) => ({
  ...(await original()), saveVisualSettings: vi.fn(), applyVisualSettingsToDOM: vi.fn(), clearVisualSettingsCache: vi.fn(),
}));

import SettingsPageVisual from '@/components/settings/SettingsPageVisual';
import { DEFAULT_VISUAL_SETTINGS, saveVisualSettings, applyVisualSettingsToDOM } from '@/lib/businessVisualSettingsService';
import { BRAND_PRESET } from '@/lib/brandPalette';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';
vi.mock('@/components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) })); // these tests do not exercise confirmations

const K = 'settings.visual.';
const legacyBrand = {
  ...DEFAULT_VISUAL_SETTINGS, ...BRAND_PRESET, primaryColor: '#3499dc',
  secondaryColor: '#9333ea', headerGradientColor: '#9333ea',
};
const setup = (stored = legacyBrand) => {
  const setVisualSettings = vi.fn();
  const ui = (value) => <SettingsPageVisual visualSettings={value} setVisualSettings={setVisualSettings} localVisual={{}} setLocalVisual={vi.fn()} canChangeTheme />;
  const view = render(ui(stored));
  return { setVisualSettings, rerender: (next) => view.rerender(ui(next)) };
};
const input = (key) => screen.getByLabelText(`${K}${key}`);
const apply = () => fireEvent.click(screen.getByRole('button', { name: `${K}brand.applyPalette` }));
const save = () => fireEvent.click(screen.getByText(`${K}saveCustomization`));
const live = () => screen.getByLabelText(`${K}livePreview`);
const editBadge = () => fireEvent.change(screen.getByLabelText(`${K}brand.cartBadgeBg`), { target: { value: '#123456' } });

beforeEach(() => vi.clearAllMocks());

describe('Visual Settings palette draft', () => {
  it('suggests charcoal/warm-gray for a legacy brand row and previews that gradient without writes', () => {
    const { setVisualSettings } = setup();
    expect(input('primaryColor')).toHaveValue('#171717');
    expect(input('secondaryColor')).toHaveValue('#605b52');
    expect(screen.getByTestId('brand-gradient-preview').style.background).toContain('rgb(23, 23, 23)');
    expect(screen.getByTestId('brand-gradient-preview').style.background).toContain('rgb(96, 91, 82)');
    expect(live()).toBeDisabled();
    expect(screen.getByText(`${K}brand.paletteDraft`)).toBeInTheDocument();
    editBadge();
    expect(setVisualSettings).not.toHaveBeenCalled();
    expect(saveVisualSettings).not.toHaveBeenCalled();
    expect(applyVisualSettingsToDOM).not.toHaveBeenCalled();
    expect(legacyBrand.secondaryColor).toBe('#9333ea');
  });

  it('keeps Classic and custom brand colours until Apply is explicitly pressed', () => {
    const custom = { ...legacyBrand, primaryColor: '#123456', secondaryColor: '#abcdef', headerGradientColor: '#334455' };
    const { rerender, setVisualSettings } = setup({ ...custom, activeTheme: 'classic' });
    expect(input('primaryColor')).toHaveValue('#123456');
    expect(input('secondaryColor')).toHaveValue('#abcdef');
    rerender(custom);
    expect(input('primaryColor')).toHaveValue('#123456');
    expect(input('secondaryColor')).toHaveValue('#abcdef');
    apply();
    expect(input('primaryColor')).toHaveValue('#171717');
    expect(input('secondaryColor')).toHaveValue('#605b52');
    expect(setVisualSettings).not.toHaveBeenCalled();
  });

  it('Apply fills the form only and cannot leak through later edits or the live-preview toggle', async () => {
    const { setVisualSettings, rerender } = setup({ ...DEFAULT_VISUAL_SETTINGS, ...BRAND_PRESET });
    apply();
    expect(live()).toBeDisabled();
    expect(live()).not.toBeChecked();
    editBadge();
    // A later external refresh must not replace the palette draft after the old one-second editing guard expires.
    await act(() => new Promise((resolve) => setTimeout(resolve, 1100)));
    rerender({ ...legacyBrand, primaryColor: '#ffffff' });
    expect(input('primaryColor')).toHaveValue('#171717');
    expect(setVisualSettings).not.toHaveBeenCalled();
    expect(saveVisualSettings).not.toHaveBeenCalled();
    save();
    await waitFor(() => expect(setVisualSettings).toHaveBeenCalledTimes(1));
    expect(setVisualSettings.mock.calls[0][0]).toMatchObject({
      primaryColor: '#171717', secondaryColor: '#605B52', headerGradientColor: '#605B52', cartBadgeBgColor: '#123456',
    });
    await waitFor(() => expect(live()).toBeEnabled());
  });

  it('Undo returns to the prior form without enabling persistence of initial suggestions', () => {
    const { setVisualSettings } = setup();
    apply();
    fireEvent.click(screen.getByText(`${K}brand.undoPreset`));
    expect(live()).toBeDisabled();
    editBadge();
    expect(setVisualSettings).not.toHaveBeenCalled();
  });

  it.each([false, true])('Undo restores prior draft ownership (user-owned: %s) before late content refresh', async (owned) => {
    const { setVisualSettings, rerender } = setup({ ...legacyBrand, companyName: 'Cached name', logo: 'cached.png' });
    if (owned) editBadge();
    apply();
    fireEvent.click(screen.getByText(`${K}brand.undoPreset`));
    await act(() => new Promise((resolve) => setTimeout(resolve, 1100)));
    rerender({ ...legacyBrand, companyName: 'Fresh name', logo: 'fresh.png' });
    expect(screen.getByDisplayValue(owned ? 'Cached name' : 'Fresh name')).toBeInTheDocument();
    if (owned) expect(screen.getByLabelText(`${K}brand.cartBadgeBg`)).toHaveValue('#123456');
    expect(live()).toBeDisabled();
    expect(setVisualSettings).not.toHaveBeenCalled();
    save();
    expect(setVisualSettings.mock.calls[0][0]).toMatchObject({
      companyName: owned ? 'Cached name' : 'Fresh name', logo: owned ? 'cached.png' : 'fresh.png',
    });
    await waitFor(() => expect(live()).toBeEnabled());
  });

  it.each([false, true])('Undo replays refresh received during Apply only for an unowned baseline (owned: %s)', async (owned) => {
    const { setVisualSettings, rerender } = setup({ ...legacyBrand, companyName: 'Cached name', logo: 'cached.png' });
    if (owned) editBadge();
    apply();
    rerender({ ...legacyBrand, companyName: 'Fresh name', logo: 'fresh.png' });
    expect(screen.getByDisplayValue('Cached name')).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 1100)));
    fireEvent.click(screen.getByText(`${K}brand.undoPreset`));
    expect(screen.getByDisplayValue(owned ? 'Cached name' : 'Fresh name')).toBeInTheDocument();
    if (owned) expect(screen.getByLabelText(`${K}brand.cartBadgeBg`)).toHaveValue('#123456');
    expect(live()).toBeDisabled();
    expect(setVisualSettings).not.toHaveBeenCalled();
    save();
    expect(setVisualSettings.mock.calls[0][0]).toMatchObject({
      companyName: owned ? 'Cached name' : 'Fresh name', logo: owned ? 'cached.png' : 'fresh.png',
    });
    await waitFor(() => expect(live()).toBeEnabled());
  });

  it('Restore theme also stays in the form until Save', () => {
    const { setVisualSettings } = setup({ ...DEFAULT_VISUAL_SETTINGS, ...BRAND_PRESET });
    fireEvent.click(screen.getByRole('button', { name: `${K}restoreTheme` }));
    fireEvent.click(screen.getByRole('button', { name: `${K}brand.reset.confirm` }));
    editBadge();
    expect(setVisualSettings).not.toHaveBeenCalled();
    expect(saveVisualSettings).not.toHaveBeenCalled();
    expect(applyVisualSettingsToDOM).not.toHaveBeenCalled();
    save();
    expect(setVisualSettings).toHaveBeenCalledTimes(1);
    expect(setVisualSettings.mock.calls[0][0].activeTheme).toBe('classic');
  });

  it('accepts fresh content arriving after automatic suggestions, without saving stale cached content', () => {
    const { setVisualSettings, rerender } = setup({ ...legacyBrand, companyName: 'Cached name' });
    const fresh = {
      ...legacyBrand, companyName: 'Fresh name', logo: 'data:image/png;base64,iVBORw0KGgo=',
      favicon: 'new-favicon.png', carouselAutoplaySpeed: 7000,
    };
    rerender(fresh);
    expect(screen.getByDisplayValue('Fresh name')).toBeInTheDocument();
    expect(input('primaryColor')).toHaveValue('#171717');
    expect(setVisualSettings).not.toHaveBeenCalled();
    save();
    expect(setVisualSettings.mock.calls[0][0]).toMatchObject({
      companyName: fresh.companyName, logo: fresh.logo, favicon: fresh.favicon, carouselAutoplaySpeed: 7000,
    });
  });

  it('owns an automatic-suggestion draft after the user edits, beyond the transient editing guard', async () => {
    const { setVisualSettings, rerender } = setup({ ...legacyBrand, companyName: 'Initial name' });
    editBadge();
    await act(() => new Promise((resolve) => setTimeout(resolve, 1100)));
    rerender({ ...legacyBrand, companyName: 'External name', primaryColor: '#ffffff' });
    expect(screen.getByDisplayValue('Initial name')).toBeInTheDocument();
    expect(input('primaryColor')).toHaveValue('#171717');
    expect(screen.getByLabelText(`${K}brand.cartBadgeBg`)).toHaveValue('#123456');
    expect(setVisualSettings).not.toHaveBeenCalled();
    save();
    expect(setVisualSettings.mock.calls[0][0]).toMatchObject({ companyName: 'Initial name', cartBadgeBgColor: '#123456' });
    await waitFor(() => expect(live()).toBeEnabled());
  });

  it.each(['theme', 'reset'])('retains an intentional %s draft through later external refreshes', async (action) => {
    const { setVisualSettings, rerender } = setup({ ...DEFAULT_VISUAL_SETTINGS, ...BRAND_PRESET });
    if (action === 'theme') {
      fireEvent.click(screen.getByRole('radio', { name: `${K}brand.theme.classic.name` }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: `${K}restoreTheme` }));
      fireEvent.click(screen.getByRole('button', { name: `${K}brand.reset.confirm` }));
    }
    await act(() => new Promise((resolve) => setTimeout(resolve, 1100)));
    rerender({ ...legacyBrand, primaryColor: '#ffffff' });
    expect(input('primaryColor')).toHaveValue('#2563eb');
    expect(live()).toBeDisabled();
    expect(setVisualSettings).not.toHaveBeenCalled();
    save();
    expect(setVisualSettings.mock.calls[0][0].activeTheme).toBe('classic');
    await waitFor(() => expect(screen.queryByText(`${K}brand.paletteDraft`)).not.toBeInTheDocument());
  });

  it.each(['applyPalette', 'paletteDraft'])('has %s copy in Spanish and English', (key) => {
    expect(ES.settings.visual.brand[key]).toBeTypeOf('string');
    expect(EN.settings.visual.brand[key]).toBeTypeOf('string');
    expect(ES.settings.visual.brand[key]).not.toBe(EN.settings.visual.brand[key]);
  });
});
