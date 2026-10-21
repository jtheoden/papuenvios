import { describe, it, expect } from 'vitest';
import { isOriginAllowed, parseAllowedOrigins } from '../../../supabase/functions/_shared/corsLogic.js';

describe('isOriginAllowed', () => {
  it('allows the production origins by default', () => {
    expect(isOriginAllowed('https://www.papuenvios.com')).toBe(true);
    expect(isOriginAllowed('https://papuenvios.com')).toBe(true);
  });

  it('allows localhost dev ports only over http', () => {
    expect(isOriginAllowed('http://localhost:5173')).toBe(true);
    expect(isOriginAllowed('https://localhost:5173')).toBe(false);
    expect(isOriginAllowed('http://localhost.evil.com:5173')).toBe(false);
  });

  it('no longer trusts arbitrary *.vercel.app sites', () => {
    expect(isOriginAllowed('https://evil.vercel.app')).toBe(false);
    expect(isOriginAllowed('https://papuenvios-git-x.vercel.app')).toBe(false);
  });

  it('rejects empty, lookalike and suffix-trick origins', () => {
    expect(isOriginAllowed('')).toBe(false);
    expect(isOriginAllowed('https://papuenvios.com.evil.com')).toBe(false);
    expect(isOriginAllowed('https://evilpapuenvios.com')).toBe(false);
  });

  it('honours extra origins from ALLOWED_ORIGINS (exact match)', () => {
    const extra = parseAllowedOrigins(' https://preview.example.com , ,https://b.example.com/ ');
    expect(extra).toEqual(['https://preview.example.com', 'https://b.example.com']);
    expect(isOriginAllowed('https://preview.example.com', extra)).toBe(true);
    expect(isOriginAllowed('https://preview.example.com.evil.com', extra)).toBe(false);
  });

  it('parseAllowedOrigins tolerates undefined', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});
