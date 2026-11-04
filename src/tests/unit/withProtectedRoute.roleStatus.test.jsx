import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const auth = { current: {} };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('@/components/AuthLoadingScreen', () => ({
  default: ({ loadingMessage }) => <div data-testid="loading">{loadingMessage ?? 'loading'}</div>
}));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k }) }));

import { withProtectedRoute } from '@/components/withProtectedRoute';

const Page = () => <div data-testid="page">admin page</div>;
const Protected = withProtectedRoute(Page, 'admin');
const checkRole = (role) => (required) => role === 'super_admin' || role === required;

const setAuth = (userRole, roleStatus, extra = {}) => {
  auth.current = { user: { id: 'u1' }, loading: false, userRole, roleStatus, checkRole: checkRole(userRole), ...extra };
};

describe('withProtectedRoute — role not resolved yet', () => {
  it('shows a verifying state (not "Acceso restringido") while the role is unresolved', () => {
    setAuth(null, 'unresolved');
    render(<Protected />);
    expect(screen.getByTestId('loading').textContent).toBe('auth.verifyingPermissions');
    expect(screen.queryByText('Acceso restringido')).toBeNull();
  });

  it('does not deny a provisional non-admin hint before the fresh profile arrives', () => {
    setAuth('user', 'provisional');
    render(<Protected />);
    expect(screen.getByTestId('loading')).toBeTruthy();
  });

  it('renders the page for a provisional admin hint', () => {
    setAuth('super_admin', 'provisional');
    render(<Protected />);
    expect(screen.getByTestId('page')).toBeTruthy();
  });

  it('still denies a resolved regular user', () => {
    setAuth('user', 'resolved');
    render(<Protected />);
    expect(screen.getByText('Acceso restringido')).toBeTruthy();
  });

  it('after retries are exhausted shows "Acceso restringido" with a retry button instead of an endless spinner', () => {
    const retry = vi.fn();
    setAuth(null, 'unresolved', { roleRetryExhausted: true, retryRoleResolution: retry });
    render(<Protected />);
    expect(screen.getByText('Acceso restringido')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'auth.roleRetry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('after the first failed fetch with no admin hint shows "Acceso restringido" + retry (no long spinner)', () => {
    const retry = vi.fn();
    setAuth(null, 'unresolved', { roleFetchFailed: true, retryRoleResolution: retry });
    render(<Protected />);
    expect(screen.getByText('Acceso restringido')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'auth.roleRetry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('a provisional hint never grants a super_admin route; after a failed fetch it denies with retry', () => {
    const Super = withProtectedRoute(Page, 'super_admin');
    setAuth('super_admin', 'provisional', { roleFetchFailed: true, retryRoleResolution: vi.fn() });
    render(<Super />);
    expect(screen.queryByTestId('page')).toBeNull();
    expect(screen.getByText('Acceso restringido')).toBeTruthy();
  });

  it('a provisional hint keeps the spinner on a super_admin route while the first fetch is still running', () => {
    const Super = withProtectedRoute(Page, 'super_admin');
    setAuth('super_admin', 'provisional');
    render(<Super />);
    expect(screen.getByTestId('loading')).toBeTruthy();
  });

  it('gives up the spinner once the total verification budget elapsed (roleVerifyTimedOut)', () => {
    setAuth(null, 'unresolved', { roleVerifyTimedOut: true, retryRoleResolution: vi.fn() });
    render(<Protected />);
    expect(screen.getByText('Acceso restringido')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'auth.roleRetry' })).toBeTruthy();
  });
});
