// Shared CORS allowlist for Supabase Edge Functions (SEC-04).
//
// Reflecting the request's Origin header verbatim (as some functions did
// before, and as notify-order/notify-zelle-deactivation still do with a
// bare '*') means any site can read the response. This module replaces
// both patterns with an explicit allowlist: known production/preview
// origins get the ACAO header back, anything else gets none — the browser
// then blocks cross-origin JS from reading the response, same as a
// same-origin failure.
//
// No Access-Control-Allow-Credentials header is set anywhere: this app's
// auth is PKCE + localStorage (see src/lib/supabase.js), not cookies, so
// credentialed cross-origin requests are not part of this app's auth flow.

const ALLOWED_ORIGINS = new Set([
  'https://www.papuenvios.com',
  'https://papuenvios.com',
]);

function isOriginAllowed(origin: string): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (origin.endsWith('.vercel.app')) return true; // Vercel preview deployments
  if (/^http:\/\/localhost:\d+$/.test(origin)) return true; // local dev
  return false;
}

/**
 * Build CORS headers for a single request. Call once per request (not as a
 * module-level constant) since the allowed origin depends on the caller.
 */
export function buildCorsHeaders(req: Request, methods: string): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Max-Age': '86400',
  };

  if (isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }

  return headers;
}
