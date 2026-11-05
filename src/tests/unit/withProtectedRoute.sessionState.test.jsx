import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const auth = { current: {} };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('@/components/AuthLoadingScreen', () => ({ default: () => <div data-testid="loading" /> }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (k) => k }) }));

import { withProtectedRoute } from '@/components/withProtectedRoute';

const Page = () => <div data-testid="page">admin page</div>;
const Protected = withProtectedRoute(Page, 'admin');

const setAuth = (extra) => {
  auth.current = { user: null, loading: false, checkRole: () => false, sessionStatus: 'ok', ...extra };
};

describe('withProtectedRoute — no signed-in user', () => {
  it('an expired session says so and offers "sign in again" that goes to the login page', () => {
    const onNavigate = vi.fn();
    setAuth({ sessionStatus: 'expired' });
    render(<Protected onNavigate={onNavigate} />);

    expect(screen.getByText('auth.sessionExpiredTitle')).toBeTruthy();
    expect(screen.queryByText('Autenticación requerida')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'auth.signInAgain' }));
    expect(onNavigate).toHaveBeenCalledWith('login');
  });

  it('while the session is being recovered it explains it is reconnecting (not "authentication required") and still offers sign in', () => {
    const onNavigate = vi.fn();
    setAuth({ sessionStatus: 'reconnecting' });
    render(<Protected onNavigate={onNavigate} />);

    expect(screen.getByText('auth.sessionReconnectingTitle')).toBeTruthy();
    expect(screen.queryByText('Autenticación requerida')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'auth.signInAgain' }));
    expect(onNavigate).toHaveBeenCalledWith('login');
  });

  it('a visitor who never signed in keeps the plain message, now with a sign in button', () => {
    const onNavigate = vi.fn();
    setAuth({});
    render(<Protected onNavigate={onNavigate} />);

    expect(screen.getByText('Autenticación requerida')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'auth.signInAgain' }));
    expect(onNavigate).toHaveBeenCalledWith('login');
  });

  it('does not crash when the page has no onNavigate', () => {
    setAuth({ sessionStatus: 'expired' });
    render(<Protected />);
    fireEvent.click(screen.getByRole('button', { name: 'auth.signInAgain' }));
    expect(screen.getByText('auth.sessionExpiredTitle')).toBeTruthy();
  });

  it('a retained user whose session is reconnecting still gets the page (role was already known)', () => {
    setAuth({ user: { id: 'u1' }, userRole: 'super_admin', roleStatus: 'resolved', sessionStatus: 'reconnecting', checkRole: () => true });
    render(<Protected />);
    expect(screen.getByTestId('page')).toBeTruthy();
  });
});
