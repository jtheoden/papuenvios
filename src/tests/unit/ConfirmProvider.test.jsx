import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ConfirmProvider, useConfirm } from '@/components/ui/ConfirmDialog';

let lastResult;
const Harness = ({ options, second }) => {
  const confirm = useConfirm();
  return (
    <>
      <button onClick={async () => { lastResult = await confirm(options); }}>open</button>
      <button onClick={async () => { lastResult = await confirm(second); }}>open-second</button>
    </>
  );
};

const setup = (options = {}, second = {}) => {
  lastResult = undefined;
  localStorage.setItem('preferredLanguage', 'en');
  return render(
    <LanguageProvider>
      <ConfirmProvider>
        <Harness options={{ title: 'Delete it', description: 'This is permanent', ...options }} second={second} />
      </ConfirmProvider>
    </LanguageProvider>
  );
};

describe('ConfirmDialog / useConfirm', () => {
  it('renders an accessible alertdialog labelled by title and description', async () => {
    setup();
    fireEvent.click(screen.getByText('open'));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveAccessibleName('Delete it');
    expect(dialog).toHaveAccessibleDescription('This is permanent');
  });

  it('resolves true on confirm', async () => {
    setup({ confirmLabel: 'Yes, delete' });
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(lastResult).toBe(true));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('resolves false on cancel', async () => {
    setup();
    fireEvent.click(screen.getByText('open'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(lastResult).toBe(false));
  });

  it('resolves false on Escape', async () => {
    setup();
    fireEvent.click(screen.getByText('open'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(lastResult).toBe(false));
  });

  it('resolves false on overlay click', async () => {
    setup();
    fireEvent.click(screen.getByText('open'));
    await screen.findByRole('alertdialog');
    const overlay = document.querySelector('[data-confirm-overlay]');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay);
    await waitFor(() => expect(lastResult).toBe(false));
  });

  it('focuses Cancel for destructive variants and the confirm button otherwise', async () => {
    const { unmount } = setup({ variant: 'destructive' });
    fireEvent.click(screen.getByText('open'));
    await screen.findByRole('alertdialog');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    unmount();
    setup({ variant: 'default', confirmLabel: 'Go' });
    fireEvent.click(screen.getByText('open'));
    await screen.findByRole('alertdialog');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Go' })).toHaveFocus());
  });

  it('uses the destructive button variant and a warning icon for destructive', async () => {
    setup({ variant: 'destructive', confirmLabel: 'Remove' });
    fireEvent.click(screen.getByText('open'));
    const btn = await screen.findByRole('button', { name: 'Remove' });
    expect(btn.className).toMatch(/bg-destructive/);
    expect(screen.getByRole('alertdialog').querySelector('[data-confirm-icon]')).not.toBeNull();
  });

  it('resolves a concurrent call with false while one dialog is open', async () => {
    setup();
    fireEvent.click(screen.getByText('open'));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByText('open-second'), { force: true });
    await waitFor(() => expect(lastResult).toBe(false));
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  });

  it('useConfirm throws a clear error without a provider', () => {
    const Bare = () => { useConfirm(); return null; };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Bare />)).toThrow(/ConfirmProvider/);
    spy.mockRestore();
  });
});
