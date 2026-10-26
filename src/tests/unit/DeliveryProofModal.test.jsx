/**
 * W6a: the delivery photo is OPTIONAL. One dialog serves orders and remittances.
 * States: no photo / photo chosen / reading / uploading or saving / upload error (Retry | Confirm without photo) / done.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import DeliveryProofModal from '@/components/admin/modals/DeliveryProofModal';

vi.mock('@/lib/courierService', () => ({ listDeliveryCouriers: vi.fn(async () => []), assignDeliveryCourier: vi.fn() }));

const t = (key) => key;
const K = 'adminOrders.deliveryModal.';
const png = (name = 'p.png', size = 1000, type = 'image/png') => {
  const file = new File(['x'.repeat(10)], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

const setup = (props = {}) => {
  const onClose = vi.fn();
  const onConfirm = props.onConfirm ?? vi.fn(async () => {});
  render(
    <DeliveryProofModal
      summary={[{ label: 'adminOrders.deliveryModal.orderLabel', value: 'ORD-1' }]}
      onClose={onClose}
      onConfirm={onConfirm}
      t={t}
      {...props}
    />
  );
  return { onClose, onConfirm };
};
const input = () => document.querySelector('input[type="file"]');
const choose = async (file) => {
  fireEvent.change(input(), { target: { files: [file] } });
};
const primary = () => screen.getByRole('button', { name: K + 'submit' });

beforeEach(() => vi.clearAllMocks());

describe('no photo (default state)', () => {
  it('labels the photo as optional, offers camera capture and keeps the primary action enabled', () => {
    setup();
    expect(screen.getByText(K + 'photoLabel')).toBeTruthy();
    expect(screen.getByText(K + 'photoHelp')).toBeTruthy();
    expect(input().getAttribute('accept')).toBe('image/*');
    expect(input().getAttribute('capture')).toBe('environment');
    expect(primary().disabled).toBe(false);
  });

  it('confirms without a photo', async () => {
    const { onConfirm } = setup();
    fireEvent.click(primary());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ file: null, notes: '' }));
  });

  it('is an accessible dialog with translated labels (no hardcoded Spanish)', () => {
    setup();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(dialog.getAttribute('aria-labelledby'));
    expect(title.textContent).toContain(K + 'title');
    expect(screen.getByRole('button', { name: K + 'closeLabel' })).toBeTruthy();
    expect(screen.queryByLabelText(/Cerrar modal/i)).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/comprobante de entrega|Cargando|Cancelar carga/i);
  });
});

describe('photo chosen', () => {
  it('shows a preview, lets the admin remove it, and confirms with the file', async () => {
    const { onConfirm } = setup();
    const file = png();
    await choose(file);
    await screen.findByRole('img', { name: K + 'previewAlt' });
    fireEvent.click(primary());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ file, notes: '' }));
  });

  it('"remove photo" returns to the empty state and then confirms without a file', async () => {
    const { onConfirm } = setup();
    await choose(png());
    await screen.findByRole('img', { name: K + 'previewAlt' });
    fireEvent.click(screen.getByRole('button', { name: K + 'removePhoto' }));
    expect(screen.queryByRole('img', { name: K + 'previewAlt' })).toBeNull();
    fireEvent.click(primary());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ file: null, notes: '' }));
  });

  it('rejects a non-image with an inline role=alert and does not attach it', async () => {
    const { onConfirm } = setup();
    await choose(png('a.pdf', 100, 'application/pdf'));
    expect((await screen.findByRole('alert')).textContent).toContain('adminOrders.messages.invalidImage');
    expect(primary().disabled).toBe(false);
    fireEvent.click(primary());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ file: null, notes: '' }));
  });

  it('rejects an image above 5 MB with an inline role=alert', async () => {
    setup();
    await choose(png('big.png', 5 * 1024 * 1024 + 1));
    expect((await screen.findByRole('alert')).textContent).toContain('adminOrders.messages.imageTooLarge');
    expect(screen.queryByRole('img', { name: K + 'previewAlt' })).toBeNull();
  });
});

describe('notes (remittances)', () => {
  it('has no notes field by default', () => {
    setup();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('sends the notes when notesEnabled', async () => {
    const { onConfirm } = setup({ notesEnabled: true });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'left with the sister' } });
    fireEvent.click(primary());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ file: null, notes: 'left with the sister' }));
  });
});

describe('working', () => {
  const pending = () => {
    let resolve;
    const p = new Promise((r) => { resolve = r; });
    return { onConfirm: vi.fn(() => p), resolve };
  };

  it('locks everything and ignores Escape / backdrop while saving without a photo', async () => {
    const { onConfirm } = pending();
    const { onClose } = setup({ onConfirm });
    fireEvent.click(primary());
    await waitFor(() => expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe('true'));
    expect(screen.getByText(K + 'saving')).toBeTruthy();
    expect(screen.getByRole('button', { name: K + 'saving' }).disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says "uploading" when there is a photo', async () => {
    const { onConfirm } = pending();
    setup({ onConfirm });
    await choose(png());
    await screen.findByRole('img', { name: K + 'previewAlt' });
    fireEvent.click(primary());
    expect(await screen.findByText(K + 'uploading')).toBeTruthy();
  });
});

describe('closing', () => {
  it('Escape and the Cancel button close the dialog while idle', () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('errors', () => {
  const uploadError = () => Object.assign(new Error('storage down'), { stage: 'upload' });

  it('upload failure with a photo offers Retry and Confirm without photo', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(uploadError()).mockResolvedValue(undefined);
    setup({ onConfirm });
    const file = png();
    await choose(file);
    await screen.findByRole('img', { name: K + 'previewAlt' });
    fireEvent.click(primary());
    const banner = await screen.findByRole('alert');
    expect(within(banner).getByText(K + 'uploadFailed')).toBeTruthy();

    fireEvent.click(within(banner).getByRole('button', { name: K + 'retry' }));
    await waitFor(() => expect(onConfirm).toHaveBeenLastCalledWith({ file, notes: '' }));
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('"Confirm without photo" drops the file and confirms', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(uploadError()).mockResolvedValue(undefined);
    setup({ onConfirm });
    await choose(png());
    await screen.findByRole('img', { name: K + 'previewAlt' });
    fireEvent.click(primary());
    const banner = await screen.findByRole('alert');
    fireEvent.click(within(banner).getByRole('button', { name: K + 'continueWithout' }));
    await waitFor(() => expect(onConfirm).toHaveBeenLastCalledWith({ file: null, notes: '' }));
  });

  it('a transition failure (someone else moved it) shows the translated conflict message, no retry offer', async () => {
    const conflict = Object.assign(new Error('x'), { code: 'CONFLICT', context: { reason: 'invalid_transition' } });
    const onConfirm = vi.fn().mockRejectedValue(conflict);
    setup({ onConfirm });
    fireEvent.click(primary());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('common.statusConflict');
    expect(screen.queryByRole('button', { name: K + 'retry' })).toBeNull();
    expect(primary().disabled).toBe(false);
  });
});
