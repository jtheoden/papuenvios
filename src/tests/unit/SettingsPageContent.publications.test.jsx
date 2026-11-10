import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { toastMock, svc } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  svc: {
    getAllPublications: vi.fn(),
    saveAllPublications: vi.fn(),
    uploadPublicationImage: vi.fn(),
    deletePublicationImage: vi.fn()
  }
}));

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/publicationService', async (importActual) => {
  const actual = await importActual();
  return { ...svc, mergeAfterPartialSave: actual.mergeAfterPartialSave, applySaveResult: actual.applySaveResult };
});
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k, language: 'es' }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: { primaryColor: '#000' } }) }));
vi.mock('@/contexts/SettingsContext', () => ({ useSettings: () => ({ refreshNotificationSettings: vi.fn() }) }));
vi.mock('@/lib/notificationSettingsService', () => ({ saveNotificationSettings: vi.fn() }));
vi.mock('@/components/ui/use-toast', () => ({ toast: (...a) => toastMock(...a) }));

import SettingsPageContent from '@/components/settings/SettingsPageContent';

const PUB = { id: 'p1', title_es: 'Guia', title_en: 'Guide', content_es: 'x', content_en: 'y', cover_image_url: '', video_url: '', category: 'general', is_active: true, display_order: 0 };
const renderIt = () => render(<SettingsPageContent localNotifications={{}} setLocalNotifications={vi.fn()} visualSettings={{ primaryColor: '#000' }} setVisualSettings={vi.fn()} />);
const clickPublicationsSave = () => {
  const buttons = screen.getAllByRole('button');
  fireEvent.click(buttons[buttons.length - 1]);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  svc.getAllPublications.mockResolvedValue([PUB]);
});

describe('Settings > Contenido > Publicaciones', () => {
  it('lists existing publications', async () => {
    renderIt();
    expect(await screen.findByText('Guia')).toBeTruthy();
  });

  it('shows a success toast when the save succeeds', async () => {
    svc.saveAllPublications.mockResolvedValue({ success: true });
    renderIt();
    await screen.findByText('Guia');
    clickPublicationsSave();
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ title: 'settings.content.pubSaved' }));
  });

  it('does NOT claim success on failure and never shows the raw database message', async () => {
    svc.saveAllPublications.mockResolvedValue({ success: false, failedCount: 1, failedIds: ['p1'], failedTitles: ['Guia'], error: 'new row violates row-level security policy' });
    renderIt();
    await screen.findByText('Guia');
    clickPublicationsSave();
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    const arg = toastMock.mock.calls[0][0];
    expect(arg.title).not.toBe('settings.content.pubSaved');
    expect(arg.variant).toBe('destructive');
    expect(arg.description).toContain('settings.content.pubSaveFailed');
    expect(arg.description).toContain('settings.content.pubSaveFailedList');
    expect(JSON.stringify(arg)).not.toMatch(/row-level/);
  });

  it('keeps what the user typed in failed rows after a partial save and does not duplicate created rows on retry', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(111);
    const created = { ...PUB, id: 'r2', title_es: 'Nueva' };
    svc.getAllPublications.mockResolvedValueOnce([PUB]).mockResolvedValue([PUB, created]);
    svc.saveAllPublications
      .mockResolvedValueOnce({ success: false, failedCount: 1, failedIds: ['p1'], failedTitles: ['Editado'] })
      .mockResolvedValue({ success: true });
    renderIt();
    await screen.findByText('Guia');

    // edit the existing row
    fireEvent.click(screen.getByText('Guia'));
    fireEvent.change(screen.getByDisplayValue('Guia'), { target: { value: 'Editado' } });
    // add a new row and name it
    fireEvent.click(screen.getByText('settings.content.addPublication'));
    fireEvent.change(screen.getByPlaceholderText('Título en español'), { target: { value: 'Nueva' } });

    clickPublicationsSave();
    await waitFor(() => expect(svc.saveAllPublications).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Editado')).toBeTruthy());
    expect(screen.getAllByText('Nueva')).toHaveLength(1);

    clickPublicationsSave();
    await waitFor(() => expect(svc.saveAllPublications).toHaveBeenCalledTimes(2));
    const [current, original] = svc.saveAllPublications.mock.calls[1];
    expect(current.map((p) => p.id)).toEqual(['p1', 'r2']);
    expect(current.some((p) => p._isNew)).toBe(false);
    expect(original.map((p) => p.id)).toEqual(['p1', 'r2']);
  });

  const editFirstRow = async () => {
    await screen.findByText('Guia');
    fireEvent.click(screen.getByText('Guia'));
    fireEvent.change(screen.getByDisplayValue('Guia'), { target: { value: 'Editado' } });
  };

  it('keeps the list and what was typed when the reload after a partial save fails', async () => {
    svc.getAllPublications.mockResolvedValueOnce([PUB]).mockResolvedValue(null);
    svc.saveAllPublications.mockResolvedValue({ success: false, failedCount: 1, failedIds: ['p1'], failedTitles: ['Editado'] });
    renderIt();
    await editFirstRow();
    clickPublicationsSave();
    await waitFor(() => expect(svc.getAllPublications).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
    expect(screen.getByDisplayValue('Editado')).toBeTruthy();
  });

  it('disables the form fields while saving so edits are not overwritten', async () => {
    let release;
    svc.saveAllPublications.mockReturnValue(new Promise((r) => { release = r; }));
    renderIt();
    await editFirstRow();
    clickPublicationsSave();
    await waitFor(() => expect(screen.getByDisplayValue('Editado').matches(':disabled')).toBe(true));
    release({ success: true });
    await waitFor(() => expect(screen.getByDisplayValue('Guia').matches(':disabled')).toBe(false));
  });

  it('keeps a row that another admin deleted and says it no longer exists on the server', async () => {
    svc.getAllPublications.mockResolvedValueOnce([PUB]).mockResolvedValue([]);
    svc.saveAllPublications.mockResolvedValue({ success: false, failedCount: 1, failedIds: ['p1'], failedTitles: ['Editado'], missingIds: ['p1'] });
    renderIt();
    await editFirstRow();
    clickPublicationsSave();
    await waitFor(() => expect(screen.getByText('Editado')).toBeTruthy());
    expect(toastMock.mock.calls[0][0].description).toContain('settings.content.pubMissingOnServer');
  });

  it('saved OK + reload fails: the next Save does not recreate rows already created', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(111);
    const created = { ...PUB, id: 'r2', title_es: 'Nueva' };
    svc.getAllPublications.mockResolvedValueOnce([PUB]).mockResolvedValue(null);
    svc.saveAllPublications.mockResolvedValue({ success: true, failedCount: 0, failedIds: [], failedTitles: [], created: { new_111: created } });
    renderIt();
    await screen.findByText('Guia');
    fireEvent.click(screen.getByText('settings.content.addPublication'));
    fireEvent.change(screen.getByPlaceholderText('Título en español'), { target: { value: 'Nueva' } });
    clickPublicationsSave();
    await waitFor(() => expect(svc.getAllPublications).toHaveBeenCalledTimes(2));
    // only the success toast: no misleading "list not updated" next to it
    expect(toastMock.mock.calls.map((c) => c[0].title)).toEqual(['settings.content.pubSaved']);
    await waitFor(() => expect(screen.getAllByText('Nueva')).toHaveLength(1));
    clickPublicationsSave();
    await waitFor(() => expect(svc.saveAllPublications).toHaveBeenCalledTimes(2));
    const [current, original] = svc.saveAllPublications.mock.calls[1];
    expect(current.map((p) => p.id)).toEqual(['p1', 'r2']);
    expect(current.some((p) => p._isNew)).toBe(false);
    expect(original.map((p) => p.id)).toEqual(['p1', 'r2']);
  });

  it('partial save + reload fails: created rows are not recreated and failed text is kept', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(111);
    const created = { ...PUB, id: 'r2', title_es: 'Nueva' };
    svc.getAllPublications.mockResolvedValueOnce([PUB]).mockResolvedValue(null);
    svc.saveAllPublications
      .mockResolvedValueOnce({ success: false, failedCount: 1, failedIds: ['p1'], failedTitles: ['Editado'], missingIds: [], created: { new_111: created } })
      .mockResolvedValue({ success: true, failedCount: 0, failedIds: [], failedTitles: [], created: {} });
    renderIt();
    await editFirstRow();
    fireEvent.click(screen.getByText('settings.content.addPublication'));
    fireEvent.change(screen.getByPlaceholderText('Título en español'), { target: { value: 'Nueva' } });
    clickPublicationsSave();
    await waitFor(() => expect(svc.getAllPublications).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText('Nueva')).toHaveLength(1));
    expect(toastMock.mock.calls.map((c) => c[0].title)).toEqual(['common.error']);
    clickPublicationsSave();
    await waitFor(() => expect(svc.saveAllPublications).toHaveBeenCalledTimes(2));
    const [current] = svc.saveAllPublications.mock.calls[1];
    expect(current.map((p) => [p.id, p.title_es])).toEqual([['p1', 'Editado'], ['r2', 'Nueva']]);
  });

  it('disables the visibility toggle while saving', async () => {
    let release;
    svc.saveAllPublications.mockReturnValue(new Promise((r) => { release = r; }));
    renderIt();
    await screen.findByText('Guia');
    clickPublicationsSave();
    await waitFor(() => expect(screen.getAllByTitle('settings.content.featureActive').at(-1).disabled).toBe(true));
    release({ success: true, created: {} });
  });

  it('removing a saved cover image does not touch storage until the save succeeds', async () => {
    const withCover = { ...PUB, cover_image_url: 'https://x/storage/v1/object/public/publications/c.jpg' };
    svc.getAllPublications.mockResolvedValue([withCover]);
    const { container } = renderIt();
    await screen.findByText('Guia');
    fireEvent.click(screen.getByText('Guia'));
    fireEvent.click(container.querySelector('button.absolute'));
    await waitFor(() => expect(container.querySelector('button.absolute')).toBeNull());
    expect(svc.deletePublicationImage).not.toHaveBeenCalled();
  });
});
