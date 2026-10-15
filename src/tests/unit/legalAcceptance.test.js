import { describe, it, expect } from 'vitest';
import {
  MIN_AGE,
  ACCEPTANCE_SOURCES,
  validateBirthDate,
  mapAcceptanceError,
} from '@/lib/legalAcceptance';

const at = (iso) => new Date(`${iso}T12:00:00`);

describe('MIN_AGE', () => {
  it('is 18', () => expect(MIN_AGE).toBe(18));
});

describe('ACCEPTANCE_SOURCES', () => {
  it('matches the sources accepted by the RPC', () => {
    expect(ACCEPTANCE_SOURCES).toEqual(['login', 'checkout', 'remittance', 'profile']);
  });
});

describe('validateBirthDate', () => {
  it('accepts someone turning 18 today', () => {
    expect(validateBirthDate('2008-10-15', at('2026-10-15'))).toEqual({ ok: true, age: 18 });
  });

  it('rejects someone turning 18 tomorrow', () => {
    expect(validateBirthDate('2008-10-16', at('2026-10-15'))).toEqual({ ok: false, code: 'under_age' });
  });

  it('accepts adults well over 18', () => {
    expect(validateBirthDate('1980-01-31', at('2026-10-15'))).toEqual({ ok: true, age: 46 });
  });

  it('handles a Feb 29 birthday: still 17 on Feb 28, 18 on Mar 1 of a non-leap year', () => {
    expect(validateBirthDate('2008-02-29', at('2026-02-28'))).toEqual({ ok: false, code: 'under_age' });
    expect(validateBirthDate('2008-02-29', at('2026-03-01'))).toEqual({ ok: true, age: 18 });
  });

  it('handles a Feb 29 birthday in a leap year', () => {
    expect(validateBirthDate('2008-02-29', at('2028-02-29'))).toEqual({ ok: true, age: 20 });
  });

  it('rejects future dates', () => {
    expect(validateBirthDate('2026-10-16', at('2026-10-15'))).toEqual({ ok: false, code: 'future' });
    expect(validateBirthDate('2999-01-01', at('2026-10-15'))).toEqual({ ok: false, code: 'future' });
  });

  it('rejects implausible ages (over 120)', () => {
    expect(validateBirthDate('1900-01-01', at('2026-10-15'))).toEqual({ ok: false, code: 'invalid' });
  });

  it.each([
    [''],
    [null],
    [undefined],
    ['abc'],
    ['2026-13-01'],
    ['2026-02-30'],
    ['2025-02-29'],
    ['15/10/2000'],
    ['2000-1-1'],
    [20001015],
  ])('rejects invalid input %j', (value) => {
    expect(validateBirthDate(value, at('2026-10-15'))).toEqual({ ok: false, code: 'invalid' });
  });
});

describe('mapAcceptanceError', () => {
  it.each([
    ['LEGAL_UNDER_AGE', 'under_age'],
    ['LEGAL_BIRTH_DATE_REQUIRED', 'invalid'],
    ['LEGAL_BIRTH_DATE_INVALID', 'invalid'],
    ['LEGAL_BIRTH_DATE_CONFLICT', 'birth_date_conflict'],
    ['LEGAL_NOT_AUTHENTICATED', 'not_authenticated'],
    ['LEGAL_PROFILE_NOT_FOUND', 'profile_not_found'],
    ['LEGAL_INVALID_VERSION', 'invalid_version'],
  ])('maps message %s to %s', (message, code) => {
    expect(mapAcceptanceError({ message })).toBe(code);
  });

  it('maps a missing function (42883 / PGRST202) to unavailable', () => {
    expect(mapAcceptanceError({ code: '42883', message: 'function does not exist' })).toBe('unavailable');
    expect(mapAcceptanceError({ code: 'PGRST202', message: 'Could not find the function' })).toBe('unavailable');
  });

  it('maps anything else to unknown', () => {
    expect(mapAcceptanceError({ message: 'boom' })).toBe('unknown');
    expect(mapAcceptanceError(null)).toBe('unknown');
    expect(mapAcceptanceError(undefined)).toBe('unknown');
  });
});
