import { describe, it, expect } from 'vitest';
import {
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
