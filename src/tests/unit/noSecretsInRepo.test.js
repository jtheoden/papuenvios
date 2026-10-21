import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Patterns are built in parts so this file never trips secret scanners itself.
const PAT_PREFIX = ['sb', 'p_'].join('');
const PAT_RE = new RegExp(`${PAT_PREFIX}[0-9a-fA-F]{30,}`);
const JWT_RE = /eyJ[\w-]+\.([\w-]+)\.[\w-]*/g;
const PEM_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

const SKIPPED = /(^|\/)package-lock\.json$|\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|eot|zip|mp4)$/i;

const jwtRole = (payload) => {
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role;
  } catch {
    return undefined;
  }
};

// Returns secret TYPES only, never values.
const scanLine = (line) => {
  const found = [];
  for (const m of line.matchAll(JWT_RE)) {
    if (jwtRole(m[1]) === 'service_role') found.push('Supabase service_role JWT');
  }
  if (PAT_RE.test(line)) found.push('Supabase personal access token');
  if (PEM_RE.test(line)) found.push('private key block');
  return found;
};

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const fakeJwt = (role) => `${b64url({ alg: 'HS256' })}.${b64url({ role })}.fakesig`;

describe('secret detector', () => {
  it('detects a synthetic service_role JWT', () => {
    expect(scanLine(`KEY="${fakeJwt('service_role')}"`)).toEqual(['Supabase service_role JWT']);
  });

  it('ignores an anon JWT', () => {
    expect(scanLine(fakeJwt('anon'))).toEqual([]);
  });

  it('detects a synthetic personal access token', () => {
    expect(scanLine(`T=${PAT_PREFIX}${'a'.repeat(40)}`)).toEqual(['Supabase personal access token']);
  });

  it('ignores short or placeholder tokens', () => {
    expect(scanLine(`${PAT_PREFIX}...`)).toEqual([]);
    expect(scanLine(`${PAT_PREFIX}<your-token>`)).toEqual([]);
    expect(scanLine(`${PAT_PREFIX}${'a'.repeat(10)}`)).toEqual([]);
  });

  it('detects a private key header', () => {
    expect(scanLine(`-----BEGIN ${'RSA '}PRIVATE KEY-----`)).toEqual(['private key block']);
  });
});

describe('tracked files contain no secrets', () => {
  it('has no service_role JWTs, personal access tokens or private keys', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0')
      .filter((f) => f && !SKIPPED.test(f));

    const findings = [];
    for (const file of files) {
      let text;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue; // deleted in the working tree or unreadable
      }
      if (text.includes('\0')) continue; // binary
      text.split('\n').forEach((line, i) => {
        for (const type of scanLine(line)) findings.push(`${file}:${i + 1} ${type}`);
      });
    }

    expect(findings, `Secrets found (values hidden):\n${findings.join('\n')}`).toEqual([]);
  });
});
