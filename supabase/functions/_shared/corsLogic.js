// Pure CORS origin logic (no Deno APIs, testable with Vitest).

const DEFAULT_ORIGINS = ['https://www.papuenvios.com', 'https://papuenvios.com'];

/** Parse the ALLOWED_ORIGINS env var: comma-separated exact origins. */
export function parseAllowedOrigins(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function isOriginAllowed(origin, extraOrigins = []) {
  if (!origin) return false;
  if (DEFAULT_ORIGINS.includes(origin) || extraOrigins.includes(origin)) return true;
  return /^http:\/\/localhost:\d+$/.test(origin); // local dev
}
