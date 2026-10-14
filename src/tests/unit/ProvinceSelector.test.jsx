import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' }),
}));

import ProvinceSelector from '@/components/ProvinceSelector';
import { getSelectableProvinces } from '@/lib/shippingZoneRules';

let nextId = 1;
const zone = (province, municipality, cost, { free = false, active = true } = {}) => ({
  id: nextId++,
  province_name: province,
  municipality_name: municipality,
  shipping_cost: cost,
  free_shipping: free,
  is_active: active,
});

const liveZones = [
  zone('Artemisa', null, 0),
  zone('La Habana', null, 0),
  zone('Camagüey', null, 0),
  zone('Camagüey', 'Camagüey', 5),
  zone('Camagüey', 'Guáimaro', 6),
  zone('Ciego de Ávila', null, 20),
  zone('Ciego de Ávila', 'Bolivia', 10),
  zone('Ciego de Ávila', 'Primero de Enero', 0, { free: true }),
  zone('Matanzas', null, 0, { active: false }),
];

const noop = () => {};

const renderSelector = (props = {}) =>
  render(
    <ProvinceSelector
      shippingZones={getSelectableProvinces(liveZones)}
      onProvinceChange={noop}
      onMunicipalityChange={noop}
      {...props}
    />
  );

describe('ProvinceSelector - province list (decision D3, interpretation B)', () => {
  it('lists Camagüey, which is only selectable through its municipalities', () => {
    renderSelector();
    const option = screen.getByRole('option', { name: /Camagüey/ });
    expect(option).not.toBeDisabled();
  });

  it('does not offer Artemisa, La Habana or inactive provinces', () => {
    renderSelector();
    expect(screen.queryByRole('option', { name: /Artemisa/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /La Habana/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Matanzas/ })).toBeNull();
  });

  it('applies the rule itself when handed unfiltered zones', () => {
    renderSelector({ shippingZones: liveZones });
    expect(screen.getByRole('option', { name: /Camagüey/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Artemisa/ })).toBeNull();
  });

  it('keeps the province fee label for a province priced at province level', () => {
    renderSelector();
    expect(screen.getByRole('option', { name: /Ciego de Ávila - \$20\.00/ })).toBeInTheDocument();
  });
});

describe('ProvinceSelector - municipality list', () => {
  it('shows municipality prices for Camagüey', () => {
    renderSelector({
      selectedProvince: 'Camagüey',
      municipalities: ['Camagüey', 'Guáimaro'],
    });
    expect(screen.getByRole('option', { name: /^Camagüey - \$5\.00/ })).not.toBeDisabled();
    expect(screen.getByRole('option', { name: /^Guáimaro - \$6\.00/ })).not.toBeDisabled();
  });

  it('reports a municipality without its own row and a province fee of 0 as unavailable, not free', () => {
    renderSelector({
      selectedProvince: 'Camagüey',
      municipalities: ['Camagüey', 'Najasa'],
    });
    const najasa = screen.getByRole('option', { name: /Najasa/ });
    expect(najasa).toBeDisabled();
    expect(najasa).toHaveTextContent('cart.shippingUnavailableShort');
    expect(najasa).not.toHaveTextContent(/Free Shipping|Envío Gratis/);
  });

  it('falls back to the province fee for a municipality without its own row', () => {
    renderSelector({
      selectedProvince: 'Ciego de Ávila',
      municipalities: ['Morón'],
    });
    expect(screen.getByRole('option', { name: /Morón - \$20\.00/ })).not.toBeDisabled();
  });

  it('still shows a genuinely free municipality as free', () => {
    renderSelector({
      selectedProvince: 'Ciego de Ávila',
      municipalities: ['Primero de Enero'],
    });
    expect(screen.getByRole('option', { name: /Primero de Enero - Envío Gratis/ })).not.toBeDisabled();
  });
});
