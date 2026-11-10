import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const WORKFLOW = path.resolve(process.cwd(), '.github/workflows/ci.yml');
const raw = () => readFileSync(WORKFLOW, 'utf8');
const usedActions = (doc) =>
  Object.values(doc.jobs)
    .flatMap((job) => job.steps ?? [])
    .map((step) => step.uses)
    .filter(Boolean);

describe('CI workflow security invariants', () => {
  it('does not reference secrets', () => {
    expect(raw()).not.toMatch(/secrets\./);
  });

  it('does not use pull_request_target', () => {
    expect(raw()).not.toMatch(/pull_request_target/);
  });

  it('declares workflow-level read-only permissions', () => {
    expect(parse(raw()).permissions).toEqual({ contents: 'read' });
  });

  it('only uses official actions/* actions', () => {
    const uses = usedActions(parse(raw()));
    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses) expect(ref).toMatch(/^actions\/[\w.-]+@/);
  });

  it('bounds the job runtime and cancels superseded runs', () => {
    const doc = parse(raw());
    expect(doc.concurrency['cancel-in-progress']).toBe(true);
    for (const job of Object.values(doc.jobs)) expect(job['timeout-minutes']).toBeLessThanOrEqual(20);
  });
});
