import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// Dead functions must not reappear without review: adding a function means adding it here on purpose.
const ALLOWED = ['_shared', 'bank-account-crypto', 'notification-settings', 'notify-zelle-deactivation', 'purge-refund-proofs'];

describe('supabase/functions allowlist', () => {
  it('only contains reviewed function directories', () => {
    const root = resolve(process.cwd(), 'supabase/functions');
    const dirs = readdirSync(root).filter((n) => statSync(resolve(root, n)).isDirectory());
    expect(dirs.sort()).toEqual([...ALLOWED].sort());
  });
});
