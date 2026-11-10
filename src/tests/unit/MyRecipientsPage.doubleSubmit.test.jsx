import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getMyRecipients: vi.fn(),
  createRecipient: vi.fn(),
  updateRecipient: vi.fn(),
  toast: vi.fn()
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => ({ showModal: vi.fn() }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: (...a) => mocks.toast(...a) }));
vi.mock('@/lib/recipientService', () => ({
  getMyRecipients: (...a) => mocks.getMyRecipients(...a),
  createRecipient: (...a) => mocks.createRecipient(...a),
  updateRecipient: (...a) => mocks.updateRecipient(...a),
  deleteRecipient: vi.fn(),
  addRecipientAddress: vi.fn(),
  updateRecipientAddress: vi.fn(),
  deleteRecipientAddress: vi.fn()
}));

import MyRecipientsPage from '@/components/MyRecipientsPage';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMyRecipients.mockResolvedValue([]);
});

describe('MyRecipientsPage double submit guard', () => {
  it('calls createRecipient once when Save is clicked twice while the request is pending', async () => {
    let resolveCreate;
    mocks.createRecipient.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    render(<MyRecipientsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'recipients.newRecipientButton' }));
    const [name, phone] = screen.getAllByRole('textbox');
    fireEvent.change(name, { target: { value: 'Ana Pérez' } });
    fireEvent.change(phone, { target: { value: '+53 5555 5555' } });

    const save = screen.getByRole('button', { name: 'common.save' });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(mocks.createRecipient).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();

    await act(async () => { resolveCreate({ success: false, error: 'boom' }); });
    expect(screen.getByRole('button', { name: 'common.save' })).not.toBeDisabled();
  });
});

describe('MyRecipientsPage edit collides with another recipient', () => {
  it('shows a clear duplicate message when the update hits the unique identity (23505)', async () => {
    mocks.getMyRecipients.mockResolvedValue([{ id: 'r-1', full_name: 'Ana Pérez', phone: '5355555555', addresses: [] }]);
    // updateRecipient resolves to the AppError produced by the service (no `error` field)
    mocks.updateRecipient.mockResolvedValue(Object.assign(new Error('This value already exists'), { code: 'DB_UNIQUE_VIOLATION' }));
    render(<MyRecipientsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'recipients.editAction' }));
    fireEvent.click(screen.getByRole('button', { name: 'recipients.updateButton' }));

    await act(async () => {});
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'recipients.recipientDuplicateOnEdit', variant: 'destructive' })
    );
  });
});
