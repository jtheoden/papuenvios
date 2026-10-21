// Shared CORS allowlist for Supabase Edge Functions (SEC-04).
//
// Only exact origins are echoed back: production (papuenvios.com, www), local
// dev (http://localhost:<port>) and any extra origins listed in the
// ALLOWED_ORIGINS secret (comma-separated, exact match; use it for a Vercel
// preview URL you control). Wildcards such as *.vercel.app are NOT accepted:
// any stranger can host a site there. Anything else gets no ACAO header.
//
// No Access-Control-Allow-Credentials header is set anywhere: this app's
// auth is PKCE + localStorage (see src/lib/supabase.js), not cookies.

import { isOriginAllowed, parseAllowedOrigins } from './corsLogic.js';

const EXTRA_ORIGINS: string[] = parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGINS'));

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
    'Vary': 'Origin',
  };

  if (isOriginAllowed(origin, EXTRA_ORIGINS)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}
