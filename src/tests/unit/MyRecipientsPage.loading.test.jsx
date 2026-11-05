import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ getMyRecipients: vi.fn() }));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => ({ showModal: vi.fn() }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/recipientService', () => ({
  getMyRecipients: (...a) => mocks.getMyRecipients(...a),
  createRecipient: vi.fn(),
  updateRecipient: vi.fn(),
  deleteRecipient: vi.fn(),
  addRecipientAddress: vi.fn(),
  updateRecipientAddress: vi.fn(),
  deleteRecipientAddress: vi.fn()
}));

import MyRecipientsPage from '@/components/MyRecipientsPage';

const pending = () => {
  let resolve;
  let reject;
  mocks.getMyRecipients.mockReturnValue(new Promise((res, rej) => { resolve = res; reject = rej; }));
  return { resolve: (v) => act(async () => { resolve(v); }), reject: (e) => act(async () => { reject(e); }) };
};

describe('MyRecipientsPage loading state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('shows a busy skeleton with the label (not the empty state) while recipients load, then the list', async () => {
    const load = pending();
    render(<MyRecipientsPage />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('recipients.noRecipientsSaved')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByText('common.loading')).toBeInTheDocument();

    await load.resolve([{ id: 'r-1', full_name: 'Ana Pérez', phone: '5355555555', addresses: [] }]);
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the empty state only once loading ends with no recipients', async () => {
    const load = pending();
    render(<MyRecipientsPage />);
    await load.resolve([]);
    expect(screen.getByText('recipients.noRecipientsSaved')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('drops the skeleton when the load fails', async () => {
    const load = pending();
    render(<MyRecipientsPage />);
    await load.reject(new Error('boom'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
