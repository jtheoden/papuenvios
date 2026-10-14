import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_DIR = join(process.cwd(), 'src');
const MONEY_COLUMNS =
  /\b(amount_sent|amount_to_deliver|exchange_rate|commission_\w+|discount_amount|offer_id|delivery_cost|shipping_zone_id)\b/;

// Money columns of `remittances` must be written server-side only (creation INSERT,
// SECURITY DEFINER RPC). No client .update() on remittances may carry them. If an
// admin-only flow ever needs to, list the exact file here and justify it in review.
const ALLOWED_FILES = new Set([]);

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === 'tests' ? [] : walk(full);
    }
    return /\.(js|jsx)$/.test(entry) ? [full] : [];
  });

// Extract the argument of every `.from('remittances').update(<payload>)` call.
const findRemittanceUpdatePayloads = (source) => {
  const payloads = [];
  const fromRe = /\.from\(\s*['"]remittances['"]\s*\)/g;
  let match = fromRe.exec(source);
  while (match !== null) {
    const start = match.index + match[0].length;
    const rest = source.slice(start, start + 600);
    const upd = /^\s*\.update\(/.exec(rest);
    if (upd) {
      let depth = 1;
      let i = upd[0].length;
      while (i < rest.length && depth > 0) {
        if (rest[i] === '(') depth += 1;
        if (rest[i] === ')') depth -= 1;
        i += 1;
      }
      payloads.push(rest.slice(upd[0].length, i - 1));
    }
    match = fromRe.exec(source);
  }
  return payloads;
};

describe('client code never writes remittance money columns directly', () => {
  it('has no .from("remittances").update(...) containing money columns', () => {
    const offenders = [];
    for (const file of walk(SRC_DIR)) {
      const rel = relative(process.cwd(), file);
      if (ALLOWED_FILES.has(rel)) continue;
      const source = readFileSync(file, 'utf8');
      for (const payload of findRemittanceUpdatePayloads(source)) {
        if (MONEY_COLUMNS.test(payload)) {
          offenders.push(`${rel}: ${payload.slice(0, 80).replace(/\s+/g, ' ')}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('scanner detects a money update (self-check)', () => {
    const sample = "supabase.from('remittances').update({ exchange_rate: 1 }).eq('id', 1)";
    const payloads = findRemittanceUpdatePayloads(sample);
    expect(payloads).toHaveLength(1);
    expect(MONEY_COLUMNS.test(payloads[0])).toBe(true);
  });
});
