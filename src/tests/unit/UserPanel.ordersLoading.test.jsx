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
import { useRealtimeOrders } from '@/hooks/useRealtimeSubscription';

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

  it('shows the orders once loaded', async () => {
    const load = pending();
    render(<UserPanel onNavigate={vi.fn()} />);
    await load.resolve([{ id: 'o-1', order_number: 'ORD-LOADED-1', status: 'pending', payment_status: 'pending', created_at: '2026-01-01T00:00:00Z', total_amount: 10, subtotal: 10, order_items: [] }]);
    expect(ordersStatus()).toBeFalsy();
    expect(screen.getAllByText(/ORD-LOADED-1/).length).toBeGreaterThan(0);
  });
  // A reload with the list already on screen (realtime/after an action) must keep it visible: no skeleton.
  it('keeps the orders visible and shows no skeleton while a realtime reload runs', async () => {
    const order = { id: 'o-1', order_number: 'ORD-LOADED-1', status: 'pending', payment_status: 'pending', created_at: '2026-01-01T00:00:00Z', total_amount: 10, subtotal: 10, order_items: [] };
    const first = pending();
    render(<UserPanel onNavigate={vi.fn()} />);
    await first.resolve([order]);

    const reload = pending();
    const { onUpdate } = useRealtimeOrders.mock.calls.at(-1)[0];
    act(() => { onUpdate({ new: { id: 'other' }, old: { id: 'other' } }); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getAllByText(/ORD-LOADED-1/).length).toBeGreaterThan(0);
    expect(ordersStatus()).toBeFalsy();
    await reload.resolve([order]);
  });
});
