import { describe, it, expect } from 'vitest';
import {
  deriveZelleVisibility,
  inferZelleContactType,
  validateZelleContact,
  validateZelleVisibility,
  getZelleAccountPublicContact
} from '@/lib/zelleVisibility';

describe('validateZelleVisibility', () => {
  it('accepts both flags on', () => {
    expect(validateZelleVisibility({ show_email: true, show_phone: true })).toEqual({ valid: true });
  });

  it('accepts email only', () => {
    expect(validateZelleVisibility({ show_email: true, show_phone: false }).valid).toBe(true);
  });

  it('accepts phone only', () => {
    expect(validateZelleVisibility({ show_email: false, show_phone: true }).valid).toBe(true);
  });

  it('rejects both flags off', () => {
    const result = validateZelleVisibility({ show_email: false, show_phone: false });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('atLeastOneVisible');
  });

  it('treats missing flags as visible (legacy rows)', () => {
    expect(validateZelleVisibility({}).valid).toBe(true);
    expect(validateZelleVisibility({ show_email: false }).valid).toBe(true);
  });
});

describe('getZelleAccountPublicContact', () => {
  const account = { email: 'a@b.com', phone: '+1555', show_email: true, show_phone: true };

  it('returns both when both flags are on', () => {
    expect(getZelleAccountPublicContact(account)).toEqual({ email: 'a@b.com', phone: '+1555' });
  });

  it('hides email when show_email is false', () => {
    expect(getZelleAccountPublicContact({ ...account, show_email: false })).toEqual({
      email: null,
      phone: '+1555'
    });
  });

  it('hides phone when show_phone is false', () => {
    expect(getZelleAccountPublicContact({ ...account, show_phone: false })).toEqual({
      email: 'a@b.com',
      phone: null
    });
  });

  it('keeps legacy rows without flags fully visible', () => {
    expect(getZelleAccountPublicContact({ email: 'a@b.com', phone: '+1555' })).toEqual({
      email: 'a@b.com',
      phone: '+1555'
    });
  });

  it('supports alias field names and null account', () => {
    expect(getZelleAccountPublicContact({ zelle_email: 'z@b.com', phone_number: '+1' })).toEqual({
      email: 'z@b.com',
      phone: '+1'
    });
    expect(getZelleAccountPublicContact(null)).toEqual({ email: null, phone: null });
  });
});

describe('Zelle account identifier', () => {
  it.each([
    [undefined, { show_phone: true, show_email: false }],
    ['phone', { show_phone: true, show_email: false }],
    ['email', { show_phone: false, show_email: true }],
    ['both', { show_phone: true, show_email: true }]
  ])('derives visibility for %s', (contactType, flags) => {
    expect(deriveZelleVisibility(contactType)).toEqual(flags);
  });

  it.each([
    [{ show_phone: true, show_email: false }, 'phone'],
    [{ show_phone: false, show_email: true }, 'email'],
    [{ show_phone: true, show_email: true }, 'both'],
    [{}, 'both']
  ])('infers the identifier without losing legacy flags: %j', (flags, type) => {
    expect(inferZelleContactType(flags)).toBe(type);
  });

  it.each([
    ['phone', '+1 (555) 123-4567', ''],
    ['phone', '1234567', null],
    ['email', '', 'pay@example.com'],
    ['email', null, 'pay@example.com'],
    ['both', '1234567', 'pay@example.com'],
    ['phone', '1'.repeat(30), ' pay@example.com ']
  ])('accepts required contact and optional blank: %s / %s / %s', (contactType, phone, email) => {
    expect(validateZelleContact({ contactType, phone, email })).toEqual({ valid: true });
  });

  it.each([
    ['phone', ' ', '', 'phoneRequired'],
    ['email', '', ' ', 'emailRequired'],
    ['both', '', 'pay@example.com', 'phoneRequired'],
    ['both', '1234567', '', 'emailRequired'],
    ['phone', '123456', '', 'invalidPhone'],
    ['phone', '1'.repeat(31), '', 'invalidPhone'],
    ['phone', '-------', '', 'invalidPhone'],
    ['phone', '123abc456', '', 'invalidPhone'],
    ['phone', '1234567', 'invalid@', 'invalidEmail'],
    ['email', 'bad-phone', 'pay@example.com', 'invalidPhone'],
    ['email', '123\t4567', 'pay@example.com', 'invalidPhone'],
    ['email', '', 'a@@example.com', 'invalidEmail']
  ])('rejects missing or malformed contact: %s / %s / %s', (contactType, phone, email, error) => {
    expect(validateZelleContact({ contactType, phone, email })).toEqual({ valid: false, error });
  });
});
