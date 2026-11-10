import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BrandLogo, { safeLogoSrc } from '@/components/BrandLogo';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const settings = (extra = {}) => ({ logo: PNG, companyName: 'Acme Envios', logoMaxHeight: 40, ...extra });

describe('safeLogoSrc', () => {
  it.each([
    [PNG, PNG],
    ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['https://cdn.example.com/logo.png', 'https://cdn.example.com/logo.png'],
    ['javascript:alert(1)', ''],
    ['data:text/html;base64,PHNjcmlwdD4=', ''],
    ['http://insecure.example.com/logo.png', ''],
    ['', ''],
    [undefined, ''],
    [42, ''],
  ])('%s -> %s', (input, expected) => {
    expect(safeLogoSrc(input)).toBe(expected);
  });
});

describe('BrandLogo', () => {
  it('shows the cached logo with the company name as alt text', () => {
    render(<BrandLogo settings={settings()} />);
    const img = screen.getByRole('img', { name: 'Acme Envios' });
    expect(img).toHaveAttribute('src', PNG);
  });

  it.each([
    [{ logoMaxHeight: 40 }, 40],
    [{ logoMaxHeight: 200 }, 64],
    [{ logoMaxHeight: '30' }, 30],
    [{ logoMaxHeight: undefined }, 40],
    [{ logoMaxHeight: -5 }, 40],
    [{ logoMaxHeight: 'abc' }, 40],
  ])('caps the height from logoMaxHeight %j at %ipx', (extra, expected) => {
    render(<BrandLogo settings={settings(extra)} />);
    expect(screen.getByRole('img').style.maxHeight).toBe(`${expected}px`);
  });

  it('honours a smaller cap', () => {
    render(<BrandLogo settings={settings({ logoMaxHeight: 60 })} maxHeightCap={48} />);
    expect(screen.getByRole('img').style.maxHeight).toBe('48px');
  });

  it('falls back to the company name wordmark without a logo', () => {
    render(<BrandLogo settings={settings({ logo: '' })} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Acme Envios')).toBeInTheDocument();
  });

  it('falls back to PapuEnvios when there is nothing at all', () => {
    render(<BrandLogo settings={null} />);
    expect(screen.getByText('PapuEnvios')).toBeInTheDocument();
  });

  it('renders nothing when there is no logo and the fallback is null', () => {
    const { container } = render(<BrandLogo settings={settings({ logo: '' })} fallback={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not render a logo source that is not an image data URL or https URL', () => {
    render(<BrandLogo settings={settings({ logo: 'javascript:alert(1)' })} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Acme Envios')).toBeInTheDocument();
  });

  it('swaps to the wordmark when the image fails to load, and tries a new logo again', () => {
    const { rerender } = render(<BrandLogo settings={settings()} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Acme Envios')).toBeInTheDocument();

    rerender(<BrandLogo settings={settings({ logo: 'data:image/webp;base64,UklGRg==' })} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/webp;base64,UklGRg==');
  });
});
