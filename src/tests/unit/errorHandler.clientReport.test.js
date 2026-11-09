import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reportClientError, sanitizeMessage } from '@/lib/errorHandler';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl';
const logged = (spy) => spy.mock.calls[0][1];

describe('reportClientError (no-PII client error report)', () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports route (path only, no query/hash), error name, truncated message, device class and source', () => {
    window.history.replaceState({}, '', '/dashboard?code=SECRET123&email=a@b.c#frag');
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:159.0) Gecko/159.0 Firefox/159.0' });

    const report = reportClientError(new TypeError('x'.repeat(500)), 'ErrorBoundary');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(report.route).toBe('/dashboard');
    expect(report.name).toBe('TypeError');
    expect(report.message.length).toBeLessThanOrEqual(200);
    expect(report.device).toBe('mobile');
    expect(report.context.source).toBe('ErrorBoundary');
    expect(JSON.stringify(logged(errorSpy))).not.toMatch(/SECRET123|a@b\.c|Firefox/);
  });

  it('classifies a desktop browser', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0 Safari/537.36' });
    expect(reportClientError(new Error('boom'), 'x').device).toBe('desktop');
  });

  it('redacts emails and JWT-looking strings from the message and never carries the stack', () => {
    const error = new Error(`failed for juan@example.com with ${JWT}`);

    const report = reportClientError(error, 'x');

    expect(report.message).not.toContain('juan@example.com');
    expect(report.message).not.toContain(JWT);
    expect(report.stack).toBeUndefined();
  });

  it('accepts a plain message (no Error object) and non-Error values', () => {
    expect(reportClientError({ name: 'AuthRecoveryExhausted', message: 'gave up' }, 'auth').name).toBe('AuthRecoveryExhausted');
    expect(reportClientError('just text', 'x').message).toBe('just text');
    expect(reportClientError(undefined, 'x').message).toBe('');
  });

  it('sanitizeMessage truncates to 200 characters', () => {
    expect(sanitizeMessage('y'.repeat(1000))).toHaveLength(200);
  });
});
