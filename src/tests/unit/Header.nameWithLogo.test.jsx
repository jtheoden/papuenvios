import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ settings: {} }));

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/orderService', () => ({ getPendingOrdersCount: vi.fn(async () => 0) }));
vi.mock('@/lib/refundService', () => ({
  REFUNDS_CHANGED_EVENT: 'papuenvios:refunds-changed',
  getRefundCounts: vi.fn(async () => ({ actionable: 0, overdue: 0 })),
}));
vi.mock('@/lib/remittanceService', () => ({ getPendingRemittancesCount: vi.fn(async () => 0) }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeOrders: vi.fn(() => ({ isSubscribed: true })),
  useRealtimeRemittances: vi.fn(() => ({ isSubscribed: true })),
}));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'es', setLanguage: vi.fn(), t: (k) => k }),
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ cart: [], visualSettings: state.settings }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    isAdmin: false,
    userRole: 'user',
    userCategory: null,
    roleStatus: 'resolved',
    roleFetchFailed: false,
    retryRoleResolution: vi.fn(),
  }),
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/ui/user-avatar', () => ({ UserAvatar: () => <span /> }));

import Header from '@/components/Header';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const mount = (settings) => {
  state.settings = { companyName: 'Acme Envios', showCompanyName: true, ...settings };
  return render(<Header currentPage="home" onNavigate={() => {}} />);
};

describe('Header company name beside the logo', () => {
  it('shows logo and name when the new setting is absent (existing rows keep their behaviour)', () => {
    mount({ logo: PNG });
    expect(screen.getByRole('img', { name: 'Acme Envios' })).toBeInTheDocument();
    expect(screen.getByText('Acme Envios')).toBeInTheDocument();
  });

  it('hides the name, keeping the logo and its alt text, when the logo already contains it', () => {
    mount({ logo: PNG, showCompanyNameWithLogo: false });
    expect(screen.getByRole('img', { name: 'Acme Envios' })).toBeInTheDocument();
    expect(screen.queryByText('Acme Envios')).toBeNull();
  });

  it('still shows the name without a logo, so the brand is never empty', () => {
    mount({ logo: '', showCompanyNameWithLogo: false });
    expect(screen.getByText('Acme Envios')).toBeInTheDocument();
  });

  it('keeps honouring the older "show company name" switch', () => {
    mount({ logo: PNG, showCompanyName: false });
    expect(screen.queryByText('Acme Envios')).toBeNull();
  });
});
