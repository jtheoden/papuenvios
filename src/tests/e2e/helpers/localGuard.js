// Safety guard: E2E suites mutate data and log in with QA users, so they must
// only ever run against a LOCAL Supabase stack, never a hosted project.
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function assertLocalSupabaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Refusing to run E2E: VITE_SUPABASE_URL is missing or not a valid URL (a local stack is required)');
  }
  // `username`/`password` rule out `http://localhost@evil.com`-style tricks; hostname is the real host.
  if (parsed.protocol !== 'http:' || parsed.username || parsed.password || !LOCAL_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(
      `Refusing to run E2E against non-local Supabase host "${parsed.hostname}" (only http://127.0.0.1 or http://localhost are allowed)`
    );
  }
}
