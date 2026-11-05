import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Stable objects: the panel's effects depend on them, a fresh object per render would reload forever.
const mocks = vi.hoisted(() => ({
  getUserOrders: vi.fn(),
  auth: { user: { id: 'u-1' }, userRole: 'user', userCategory: 'regular' },
  business: { visualSettings: {}, notificationSettings: {} },
  modal: { showModal: () => {} },
  language: { t: (key) => key, language: 'es' }
}));

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => mocks.language }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => mocks.business }));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => mocks.modal }));
vi.mock('@/hooks/useUserDiscounts', () => ({ useUserDiscounts: () => ({ categoryDiscountPercent: 0 }) }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeRemittances: vi.fn(), useRealtimeOrders: vi.fn() }));
vi.mock('@/hooks/useOrderItemLines', () => ({ useOrderItemLines: () => ({ lines: [], comboLookupDone: true }) }));
vi.mock('@/hooks/usePaymentProofUrl', () => ({ usePaymentProofUrl: () => ({ url: null, error: null }) }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/orderService', async (importOriginal) => ({
  ...(await importOriginal()),
  getUserOrders: (...a) => mocks.getUserOrders(...a)
}));
vi.mock('@/lib/testimonialService', () => ({ getUserTestimonial: vi.fn().mockResolvedValue(null), createTestimonial: vi.fn() }));
vi.mock('@/lib/remittanceService', () => ({ getMyRemittances: vi.fn().mockResolvedValue([]), generateProofSignedUrl: vi.fn() }));
vi.mock('@/lib/publicationService', () => ({ getPublications: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/notificationSettingsService', () => ({ getActiveWhatsappRecipient: vi.fn() }));
vi.mock('@/components/admin/AdminWorkTabs', () => ({ default: ({ children }) => children }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));

import UserPanel from '@/components/UserPanel';

const pending = () => {
  let resolve;
  let reject;
  mocks.getUserOrders.mockReturnValue(new Promise((res, rej) => { resolve = res; reject = rej; }));
  return { resolve: (v) => act(async () => { resolve(v); }), reject: (e) => act(async () => { reject(e); }) };
};
const ordersStatus = () => screen.queryAllByRole('status').find(el => el.getAttribute('aria-busy') === 'true');

describe('UserPanel orders loading state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('shows a busy skeleton with the label while orders load, never the empty state', async () => {
    const load = pending();
    render(<UserPanel onNavigate={vi.fn()} />);
    expect(ordersStatus()).toBeTruthy();
    expect(screen.queryByText('userPanel.noOrders')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByText('common.loading')).toBeInTheDocument();

    await load.resolve([]);
    act(() => { vi.advanceTimersByTime(400); });
    expect(ordersStatus()).toBeFalsy();
    expect(screen.getByText('userPanel.noOrders')).toBeInTheDocument();
  });

  it('drops the skeleton when loading the orders fails', async () => {
    const load = pending();
    render(<UserPanel onNavigate={vi.fn()} />);
    await load.reject(new Error('boom'));
    expect(ordersStatus()).toBeFalsy();
  });
});
