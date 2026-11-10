import { describe, it, expect } from 'vitest';
import {
  UNIT_CODES,
  isKnownUnit,
  getUnitOptions,
  getUnitLabel,
  normalizeUnitCode,
  formatQuantityWithUnit
} from '@/lib/productUnits';

describe('productUnits catalog', () => {
  it('exposes the allowed codes', () => {
    expect(UNIT_CODES).toEqual([
      'unit', 'lb', 'kg', 'g', 'oz', 'l', 'ml', 'pack', 'box', 'can', 'bottle', 'dozen', 'bag'
    ]);
  });

  it('knows its codes and rejects anything else', () => {
    expect(isKnownUnit('lb')).toBe(true);
    expect(isKnownUnit('furlong')).toBe(false);
    expect(isKnownUnit(null)).toBe(false);
  });

  it('builds select options with a label per language', () => {
    const es = getUnitOptions('es');
    const en = getUnitOptions('en');
    expect(es).toHaveLength(UNIT_CODES.length);
    expect(es.find((o) => o.value === 'pack').label).toMatch(/paquete/i);
    expect(en.find((o) => o.value === 'pack').label).toMatch(/pack/i);
    es.concat(en).forEach((o) => expect(o.label.length).toBeGreaterThan(0));
  });

  it('getUnitLabel falls back to the raw code for unknown units and empty for null', () => {
    expect(getUnitLabel('bag', 'es')).toMatch(/bolsa/i);
    expect(getUnitLabel('furlong', 'es')).toBe('furlong');
    expect(getUnitLabel(null, 'es')).toBe('');
  });

  it('normalizeUnitCode trims and maps blank values to null', () => {
    expect(normalizeUnitCode(' lb ')).toBe('lb');
    expect(normalizeUnitCode('')).toBeNull();
    expect(normalizeUnitCode('   ')).toBeNull();
    expect(normalizeUnitCode(undefined)).toBeNull();
    expect(normalizeUnitCode(5)).toBeNull();
  });
});

describe('formatQuantityWithUnit', () => {
  it('appends invariant abbreviations', () => {
    expect(formatQuantityWithUnit(2, 'lb', 'es')).toBe('2 lb');
    expect(formatQuantityWithUnit(5, 'kg', 'en')).toBe('5 kg');
    expect(formatQuantityWithUnit(1, 'lb', 'es')).toBe('1 lb');
  });

  it('pluralizes word units by language', () => {
    expect(formatQuantityWithUnit(1, 'pack', 'es')).toBe('1 paquete');
    expect(formatQuantityWithUnit(3, 'pack', 'es')).toBe('3 paquetes');
    expect(formatQuantityWithUnit(1, 'box', 'en')).toBe('1 box');
    expect(formatQuantityWithUnit(2, 'box', 'en')).toBe('2 boxes');
    expect(formatQuantityWithUnit(2, 'unit', 'en')).toBe('2 units');
    expect(formatQuantityWithUnit(2, 'unit', 'es')).toBe('2 ud');
  });

  it('handles decimals', () => {
    expect(formatQuantityWithUnit(1.5, 'lb', 'es')).toBe('1.5 lb');
    expect(formatQuantityWithUnit(1.5, 'bag', 'es')).toBe('1.5 bolsas');
    expect(formatQuantityWithUnit(0.1 * 3, 'kg', 'en')).toBe('0.3 kg');
  });

  it('returns the plain quantity when there is no unit (never invents one)', () => {
    expect(formatQuantityWithUnit(4, null, 'es')).toBe('4');
    expect(formatQuantityWithUnit(4, undefined, 'en')).toBe('4');
    expect(formatQuantityWithUnit(4, '', 'es')).toBe('4');
    expect(formatQuantityWithUnit(4, '  ', 'es')).toBe('4');
  });

  it('shows the raw code for unknown units', () => {
    expect(formatQuantityWithUnit(2, 'furlong', 'es')).toBe('2 furlong');
  });

  it('renders nothing for a missing quantity instead of "null"/"undefined"', () => {
    expect(formatQuantityWithUnit(null, null, 'es')).toBe('');
    expect(formatQuantityWithUnit(undefined, undefined, 'es')).toBe('');
  });

  it('defaults to Spanish when the language is missing', () => {
    expect(formatQuantityWithUnit(2, 'bag')).toBe('2 bolsas');
  });
});
