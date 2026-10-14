import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';
import RecipientLocation from '@/components/RecipientLocation';

describe('RecipientLocation', () => {
  it('renders municipality and province from a remittance without recipient_city', () => {
    render(
      <RecipientLocation
        label="Location:"
        remittance={{ recipient_municipality: 'Plaza', recipient_province: 'La Habana' }}
      />
    );
    expect(screen.getByText('Location:')).toBeInTheDocument();
    expect(screen.getByText(/Plaza, La Habana/)).toBeInTheDocument();
  });

  it('renders only the province when municipality is missing', () => {
    render(<RecipientLocation label="Location:" remittance={{ recipient_province: 'Cienfuegos' }} />);
    expect(screen.getByText(/Cienfuegos/)).toBeInTheDocument();
  });

  it('renders nothing when both are missing', () => {
    const { container } = render(<RecipientLocation label="Location:" remittance={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('has the i18n labels used by the remittance views in both locales', () => {
    expect(ES.remittances.user.recipientLocation).toBeTruthy();
    expect(EN.remittances.user.recipientLocation).toBeTruthy();
  });
});
