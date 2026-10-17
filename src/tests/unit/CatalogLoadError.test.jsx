import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'en' })
}));

import CatalogLoadError from '@/components/CatalogLoadError';

describe('CatalogLoadError', () => {
  const originalLocation = window.location;
  afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation, configurable: true });
  });

  it('renders nothing without an error', () => {
    const { container } = render(<CatalogLoadError error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the permission message as an alert', () => {
    render(<CatalogLoadError error={{ kind: 'permission' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('products.catalogError.permission');
  });

  it('shows the generic message for other failures', () => {
    render(<CatalogLoadError error={{ kind: 'load' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('products.catalogError.load');
  });

  it('shows the admin message when the cost data source is unavailable', () => {
    render(<CatalogLoadError error={{ kind: 'adminCosts' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('products.catalogError.adminCosts');
  });

  it('reloads the page from the button (a stale cached bundle is the likely cause)', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...originalLocation, reload }, configurable: true });
    render(<CatalogLoadError error={{ kind: 'permission' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'products.catalogError.reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
