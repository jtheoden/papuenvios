import { describe, it, expect } from 'vitest';
import {
  isZoneAvailable,
  isProvinceSelectable,
  getSelectableProvinces,
  getShippingState,
  isShippingBlocked,
  isCashDeliveryBlocked,
  resolveShippingZone,
} from '@/lib/shippingZoneRules';

let nextId = 1;
const zone = (province, municipality, cost, { free = false, active = true } = {}) => ({
  id: nextId++,
  province_name: province,
  municipality_name: municipality,
  shipping_cost: cost,
  free_shipping: free,
  is_active: active,
});

// Live dataset (subset)
const inactiveProvinces = [
  'Cienfuegos', 'Granma', 'Guantánamo', 'Holguín', 'Isla de la Juventud', 'Las Tunas',
  'Matanzas', 'Mayabeque', 'Pinar del Río', 'Sancti Spíritus', 'Santiago de Cuba', 'Villa Clara',
];

const buildZones = () => [
  zone('Artemisa', null, 0),
  zone('La Habana', null, 0),
  zone('Camagüey', null, 0),
  zone('Camagüey', 'Camagüey', 5),
  zone('Camagüey', 'Guáimaro', 6),
  zone('Ciego de Ávila', null, 20),
  zone('Ciego de Ávila', 'Bolivia', 10),
  zone('Ciego de Ávila', 'Chambas', 25),
  zone('Ciego de Ávila', 'Primero de Enero', 0, { free: true }),
  zone('Ciego de Ávila', 'Venezuela', 25),
  ...inactiveProvinces.map((p) => zone(p, null, 0, { active: false })),
];

describe('isZoneAvailable', () => {
  it('is available when free or priced above 0', () => {
    expect(isZoneAvailable(zone('X', null, 0, { free: true }))).toBe(true);
    expect(isZoneAvailable(zone('X', null, 5))).toBe(true);
    expect(isZoneAvailable(zone('X', null, '12.50'))).toBe(true);
  });

  it('treats cost 0 without free flag as disabled, not free', () => {
    expect(isZoneAvailable(zone('X', null, 0))).toBe(false);
    expect(isZoneAvailable(zone('X', null, '0.00'))).toBe(false);
    expect(isZoneAvailable(zone('X', null, null))).toBe(false);
  });

  it('never treats an inactive zone as available, even if free or priced', () => {
    expect(isZoneAvailable(zone('X', null, 10, { active: false }))).toBe(false);
    expect(isZoneAvailable(zone('X', null, 0, { free: true, active: false }))).toBe(false);
  });

  it('handles missing zones', () => {
    expect(isZoneAvailable(null)).toBe(false);
    expect(isZoneAvailable(undefined)).toBe(false);
  });
});

describe('isProvinceSelectable / getSelectableProvinces (live dataset)', () => {
  const zones = buildZones();

  it('Camagüey is selectable through its priced municipalities', () => {
    expect(isProvinceSelectable(zones, 'Camagüey')).toBe(true);
  });

  it('Artemisa and La Habana are not selectable (no municipality rows)', () => {
    expect(isProvinceSelectable(zones, 'Artemisa')).toBe(false);
    expect(isProvinceSelectable(zones, 'La Habana')).toBe(false);
  });

  it('inactive provinces are not selectable', () => {
    inactiveProvinces.forEach((p) => expect(isProvinceSelectable(zones, p)).toBe(false));
  });

  it('Ciego de Ávila is selectable', () => {
    expect(isProvinceSelectable(zones, 'Ciego de Ávila')).toBe(true);
  });

  it('keeps province and municipality rows of selectable provinces only', () => {
    const result = getSelectableProvinces(zones);
    const provinces = new Set(result.map((z) => z.province_name));
    expect([...provinces].sort()).toEqual(['Camagüey', 'Ciego de Ávila']);
    // Camagüey province row (cost 0) is kept so the selector can list it
    expect(result.some((z) => z.province_name === 'Camagüey' && z.municipality_name === null)).toBe(true);
    expect(result.filter((z) => z.province_name === 'Camagüey')).toHaveLength(3);
    // the free municipality of Ciego de Ávila is kept and available
    const free = result.find((z) => z.municipality_name === 'Primero de Enero');
    expect(isZoneAvailable(free)).toBe(true);
  });

  it('does not make a province free because one municipality is free', () => {
    const result = getSelectableProvinces(zones);
    const province = result.find((z) => z.province_name === 'Ciego de Ávila' && z.municipality_name === null);
    expect(province.free_shipping).toBe(false);
    expect(province.shipping_cost).toBe(20);
  });

  it('does not mutate the input and returns a new array', () => {
    const input = buildZones();
    const snapshot = JSON.parse(JSON.stringify(input));
    const result = getSelectableProvinces(input);
    expect(input).toEqual(snapshot);
    expect(result).not.toBe(input);
  });

  it('copes with empty or missing input', () => {
    expect(getSelectableProvinces([])).toEqual([]);
    expect(getSelectableProvinces(undefined)).toEqual([]);
  });
});

describe('getShippingState', () => {
  const zones = buildZones();

  it('returns none without a province', () => {
    expect(getShippingState(zones, '', null).status).toBe('none');
  });

  it('uses the municipality row price', () => {
    expect(getShippingState(zones, 'Camagüey', 'Guáimaro')).toMatchObject({
      status: 'available', cost: 6, freeShipping: false, source: 'municipality',
    });
  });

  it('a genuinely free municipality is free', () => {
    expect(getShippingState(zones, 'Ciego de Ávila', 'Primero de Enero')).toMatchObject({
      status: 'available', cost: 0, freeShipping: true, source: 'municipality',
    });
  });

  it('a municipality without its own row falls back to the province fee', () => {
    expect(getShippingState(zones, 'Ciego de Ávila', 'Morón')).toMatchObject({
      status: 'available', cost: 20, source: 'province',
    });
  });

  it('a municipality without its own row under a province fee of 0 is unavailable, not free', () => {
    const state = getShippingState(zones, 'Camagüey', 'Najasa');
    expect(state.status).toBe('unavailable');
    expect(state.cost).toBe(0);
    expect(state.freeShipping).toBe(false);
    expect(isShippingBlocked(state)).toBe(true);
  });

  it('an own municipality row with cost 0 and not free is unavailable', () => {
    const local = [zone('P', null, 20), zone('P', 'M', 0)];
    expect(getShippingState(local, 'P', 'M').status).toBe('unavailable');
  });

  it('province with no row of its own is unavailable', () => {
    expect(getShippingState(zones, 'Narnia', 'X').status).toBe('unavailable');
    expect(getShippingState(zones, 'Artemisa', null).status).toBe('unavailable');
    expect(getShippingState(zones, 'Matanzas', 'Cárdenas').status).toBe('unavailable');
  });

  it('judges a province alone by its province row', () => {
    expect(getShippingState(zones, 'Ciego de Ávila', null)).toMatchObject({ status: 'available', cost: 20 });
    expect(getShippingState(zones, 'Camagüey', null).status).toBe('unavailable');
  });

  it('isShippingBlocked is false for available and none', () => {
    expect(isShippingBlocked({ status: 'available' })).toBe(false);
    expect(isShippingBlocked({ status: 'none' })).toBe(false);
    expect(isShippingBlocked(undefined)).toBe(false);
  });
});

describe('isCashDeliveryBlocked', () => {
  const zones = buildZones();

  it('blocks cash deliveries to an unavailable destination', () => {
    expect(isCashDeliveryBlocked({ zones, deliveryMethod: 'cash', province: 'Artemisa', municipality: 'Artemisa' })).toBe(true);
    expect(isCashDeliveryBlocked({ zones, deliveryMethod: 'cash', province: 'Camagüey', municipality: 'Najasa' })).toBe(true);
  });

  it('allows cash deliveries to an available destination', () => {
    expect(isCashDeliveryBlocked({ zones, deliveryMethod: 'cash', province: 'Camagüey', municipality: 'Guáimaro' })).toBe(false);
  });

  it('never blocks non-cash deliveries', () => {
    expect(isCashDeliveryBlocked({ zones, deliveryMethod: 'transfer', province: 'Artemisa', municipality: 'Artemisa' })).toBe(false);
  });

  it('does not block while no recipient province is chosen', () => {
    expect(isCashDeliveryBlocked({ zones, deliveryMethod: 'cash', province: '', municipality: '' })).toBe(false);
  });
});

describe('resolveShippingZone', () => {
  const zones = buildZones();
  const byName = (province, municipality) =>
    zones.find((z) => z.province_name === province && z.municipality_name === municipality);

  it('returns the municipality row when it exists (the row that prices the order)', () => {
    expect(resolveShippingZone(zones, 'Ciego de Ávila', 'Bolivia')).toBe(byName('Ciego de Ávila', 'Bolivia'));
  });

  it('falls back to the province row when the municipality has no row', () => {
    expect(resolveShippingZone(zones, 'Ciego de Ávila', 'Baraguá')).toBe(byName('Ciego de Ávila', null));
  });

  it('returns the province row when no municipality is chosen', () => {
    expect(resolveShippingZone(zones, 'Ciego de Ávila', '')).toBe(byName('Ciego de Ávila', null));
  });

  it('ignores inactive rows and returns null for an unknown or empty province', () => {
    expect(resolveShippingZone(zones, 'Matanzas', 'Matanzas')).toBeNull();
    expect(resolveShippingZone(zones, 'Atlantis', null)).toBeNull();
    expect(resolveShippingZone(zones, '', null)).toBeNull();
    expect(resolveShippingZone(null, 'Camagüey', null)).toBeNull();
  });

  it('agrees with getShippingState on which row is used', () => {
    const resolved = resolveShippingZone(zones, 'Ciego de Ávila', 'Primero de Enero');
    expect(resolved.free_shipping).toBe(true);
    expect(getShippingState(zones, 'Ciego de Ávila', 'Primero de Enero').freeShipping).toBe(true);
  });
});
