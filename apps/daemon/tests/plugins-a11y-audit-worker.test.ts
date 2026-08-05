// The a11y-audit atom worker — the glue that turns the audit runner into a
// devloop signal source.
//
// The worker is the piece that decides *whether to speak*. Its contract:
// audit only when the caller supplied a project root, forward the runner's
// signals verbatim when it did, and stay silent (empty signals + an
// explanatory note) whenever it could not measure. Silence matters because
// `evaluateTerm` reads an undefined signal as false, so a plan gated on
// `a11y.passing` stalls visibly instead of converging on an unmeasured pass.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { AppliedPluginSnapshot, PipelineStage } from '@open-design/contracts';
import type { AtomWorkerContext } from '../src/plugins/atoms/registry.js';
import { createA11yAuditWorker } from '../src/plugins/atoms/a11y-audit-worker.js';
import type { A11yAuditReport } from '../src/plugins/atoms/a11y-audit.js';

let tmp: string;
let db: Database.Database;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'od-a11y-worker-'));
  db = new Database(path.join(tmp, 'test.sqlite'));
});

afterEach(async () => {
  db.close();
  await rm(tmp, { recursive: true, force: true });
});

const STAGE = { id: 'stage-1', atoms: ['a11y-audit'] } as unknown as PipelineStage;

function context(overrides: Partial<AtomWorkerContext> = {}): AtomWorkerContext {
  return {
    db,
    runId: 'run-1',
    projectId: 'proj-1',
    conversationId: null,
    stage: STAGE,
    iteration: 0,
    snapshot: {} as AppliedPluginSnapshot,
    ...overrides,
  };
}

function report(overrides: Partial<A11yAuditReport> = {}): A11yAuditReport {
  return {
    target: 'index.html',
    status: 'passing',
    counts: { minor: 0, moderate: 0, serious: 0, critical: 0, unclassified: 0 },
    blockingCount: 0,
    violations: [],
    truncatedViolations: 0,
    incompleteCount: 0,
    signals: { 'a11y.passing': true, 'a11y.violations': 0, 'critique.score': 5 },
    endedAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('createA11yAuditWorker', () => {
  it('stays silent when the context carries no project root', async () => {
    let called = false;
    const worker = createA11yAuditWorker({
      runAudit: async () => { called = true; return report(); },
    });

    const outcome = await worker(context());

    expect(called).toBe(false);
    expect(outcome.signals).toEqual({});
    expect(outcome.note).toMatch(/no project root/i);
  });

  it('forwards the runner signals when a project root is present', async () => {
    const worker = createA11yAuditWorker({
      runAudit: async () =>
        report({
          status: 'failing',
          blockingCount: 4,
          signals: { 'a11y.passing': false, 'a11y.violations': 4, 'critique.score': 1 },
        }),
    });

    const outcome = await worker(context({ projectRoot: tmp }));

    expect(outcome.signals).toEqual({
      'a11y.passing': false,
      'a11y.violations': 4,
      'critique.score': 1,
    });
    expect(outcome.note).toMatch(/4/);
  });

  it('audits the project root it was handed, at the configured target', async () => {
    const seen: Array<{ cwd: string; target: string }> = [];
    const worker = createA11yAuditWorker({
      target: 'dist/report.html',
      runAudit: async (opts) => { seen.push(opts); return report(); },
    });

    await worker(context({ projectRoot: tmp }));

    expect(seen).toEqual([{ cwd: tmp, target: 'dist/report.html' }]);
  });

  it('persists the report under the project root', async () => {
    const worker = createA11yAuditWorker({
      runAudit: async () => report({ status: 'failing', blockingCount: 2 }),
    });

    await worker(context({ projectRoot: tmp }));

    const written = await readFile(
      path.join(tmp, 'critique', 'a11y-audit.json'),
      'utf8',
    );
    expect(JSON.parse(written).blockingCount).toBe(2);
  });

  it('stays silent when the audit itself could not measure anything', async () => {
    // A skipped audit returns empty signals; the worker must not invent any.
    const worker = createA11yAuditWorker({
      runAudit: async () =>
        report({ status: 'skipped', reason: 'audit target not found: index.html', signals: {} }),
    });

    const outcome = await worker(context({ projectRoot: tmp }));

    expect(outcome.signals).toEqual({});
    expect(outcome.note).toMatch(/not found/);
  });
});
