import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useUserAlerts: () => ({
    alerts: [{ id: 'a1', message: 'Zelle account disabled', metadata: { operationType: 'order', operationId: 'o1', amount: 10 } }],
    loading: false,
    hasAlerts: true,
    dismissAlert: vi.fn(),
    dismissByOperation: vi.fn(),
  }),
}));

import ZelleAccountAlert from '@/components/ZelleAccountAlert';

describe('ZelleAccountAlert position', () => {
  const wrapperClasses = () => {
    const { container } = render(<ZelleAccountAlert />);
    return container.firstChild.className.split(/\s+/);
  };

  it('sits below the fixed header (real height, or the 4.5rem + role banner fallback), not at top-4', () => {
    const list = wrapperClasses();
    expect(list).toContain('fixed');
    expect(list).not.toContain('top-4');
    expect(list).toContain('top-[calc(var(--header-h,calc(4.5rem+var(--role-banner-h,0px)))+0.5rem)]');
  });

  it('stacks under the header (z-40) so its dropdowns and the role banner stay on top', () => {
    const list = wrapperClasses();
    expect(list).toContain('z-30');
    expect(list).not.toContain('z-50');
  });
});
