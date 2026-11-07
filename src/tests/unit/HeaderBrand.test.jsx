import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HeaderBrand from '@/components/HeaderBrand';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const WEBP = 'data:image/webp;base64,UklGRg==';
const base = { companyName: 'Acme Envios', showCompanyName: true };

describe('HeaderBrand', () => {
  it('renders a safe logo and hides the name when the logo already contains it', () => {
    render(<HeaderBrand settings={{ ...base, logo: PNG, showCompanyNameWithLogo: false }} />);
    expect(screen.getByRole('img', { name: 'Acme Envios' })).toHaveAttribute('src', PNG);
    expect(screen.queryByText('Acme Envios')).toBeNull();
  });

  it('treats an unsafe logo source as no logo: no <img>, and the name shows even with the checkbox off', () => {
    render(<HeaderBrand settings={{ ...base, logo: 'javascript:alert(1)', showCompanyNameWithLogo: false }} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Acme Envios')).toBeInTheDocument();
  });

  it('falls back to the name when the logo fails to load, even if showCompanyNameWithLogo is off', () => {
    render(<HeaderBrand settings={{ ...base, logo: PNG, showCompanyNameWithLogo: false }} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Acme Envios')).toBeInTheDocument();
  });

  it('still honours "show company name" off after a failed logo, and retries a new logo', () => {
    const { rerender } = render(<HeaderBrand settings={{ ...base, logo: PNG, showCompanyName: false }} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByText('Acme Envios')).toBeNull();
    rerender(<HeaderBrand settings={{ ...base, logo: WEBP, showCompanyName: false }} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', WEBP);
  });
});
