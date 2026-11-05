import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';
import ErrorBoundary from '@/components/ErrorBoundary';

const Boom = ({ message }) => {
  throw new TypeError(message);
};

const renderBoom = (message) =>
  render(
    <ErrorBoundary>
      <Boom message={message} />
    </ErrorBoundary>,
  );

const STALE = 'Failed to fetch dynamically imported module: https://x.app/assets/DashboardPage-abc.js';

describe('ErrorBoundary', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the Spanish stale-version message by default (outside LanguageProvider)', () => {
    renderBoom(STALE);
    expect(screen.getByText(ES.errorBoundary.title)).toBeInTheDocument();
    expect(screen.getByText(ES.errorBoundary.staleVersion)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ES.errorBoundary.reload })).toBeInTheDocument();
    expect(screen.queryByText(/dynamically imported/)).not.toBeInTheDocument();
  });

  it('uses the stored language preference (EN)', () => {
    localStorage.setItem('preferredLanguage', 'en');
    renderBoom(STALE);
    expect(screen.getByText(EN.errorBoundary.title)).toBeInTheDocument();
    expect(screen.getByText(EN.errorBoundary.staleVersion)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EN.errorBoundary.reload })).toBeInTheDocument();
  });

  it('falls back to Spanish when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    renderBoom(STALE);
    expect(screen.getByText(ES.errorBoundary.staleVersion)).toBeInTheDocument();
  });

  it('shows the generic translated message for other errors', () => {
    renderBoom('Something exploded');
    expect(screen.getByText(ES.errorBoundary.generic)).toBeInTheDocument();
    expect(screen.queryByText(ES.errorBoundary.staleVersion)).not.toBeInTheDocument();
  });

  it('reloads the page from the button', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    renderBoom(STALE);
    fireEvent.click(screen.getByRole('button', { name: ES.errorBoundary.reload }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('has ES/EN parity for the errorBoundary keys', () => {
    expect(Object.keys(EN.errorBoundary).sort()).toEqual(Object.keys(ES.errorBoundary).sort());
    expect(ES.errorBoundary.staleVersion).toBe('Hay una versión nueva del sitio. Recargue la página para continuar.');
  });
});
