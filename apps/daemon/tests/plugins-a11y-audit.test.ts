// a11y-audit atom — objective WCAG gating for the devloop.
//
// Mirrors the build-test atom's contract (spec §10 / §22.4): the runner
// produces a report on disk plus the `UntilSignals` the devloop's `until`
// evaluator reads. The distinguishing invariant here is that a *skipped*
// audit emits NO signals at all — `evaluateTerm` treats an undefined signal
// as false, so staying silent makes an opted-in plan stall visibly instead
// of converging on an accessibility pass that was never measured.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  runA11yAudit,
  writeA11yAuditReport,
  type AxeRunResult,
} from '../src/plugins/atoms/a11y-audit.js';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'od-a11y-audit-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Build an axe-shaped result with `count` nodes on a single rule. */
function violation(id: string, impact: string | null, count: number) {
  return {
    id,
    impact,
    help: `${id} help`,
    helpUrl: `https://dequeuniversity.com/rules/axe/4.10/${id}`,
    nodes: Array.from({ length: count }, (_, i) => ({
      target: [`#node-${i}`],
      html: `<div id="node-${i}"></div>`,
      failureSummary: `Fix ${id}`,
    })),
  };
}

function axeResult(violations: ReturnType<typeof violation>[]): AxeRunResult {
  return {
    violations,
    testEngine: { name: 'axe-core', version: '4.10.2' },
  } as AxeRunResult;
}

async function writeArtifact(name = 'index.html'): Promise<string> {
  await writeFile(path.join(tmp, name), '<!doctype html><title>t</title>', 'utf8');
  return name;
}

describe('runA11yAudit — signal derivation', () => {
  it('emits a passing gate when the page has no violations', async () => {
    const target = await writeArtifact();
    const report = await runA11yAudit({
      cwd: tmp,
      target,
      analyzeFn: async () => axeResult([]),
    });

    expect(report.status).toBe('passing');
    expect(report.blockingCount).toBe(0);
    expect(report.signals['a11y.passing']).toBe(true);
    expect(report.signals['a11y.violations']).toBe(0);
    // No legacy score on a pass: an accessibility measurement is not an
    // overall quality verdict, and the registry's lowest-wins merge means a
    // 5 here could never raise another atom's real score anyway.
    expect(report.signals['critique.score']).toBeUndefined();
  });

  it('counts violating nodes, not rules, at or above the fail threshold', async () => {
    const target = await writeArtifact();
    const report = await runA11yAudit({
      cwd: tmp,
      target,
      analyzeFn: async () =>
        axeResult([
          violation('color-contrast', 'serious', 3),
          violation('image-alt', 'critical', 2),
        ]),
    });

    // 3 serious nodes + 2 critical nodes = 5 blocking nodes across 2 rules.
    expect(report.blockingCount).toBe(5);
    expect(report.signals['a11y.violations']).toBe(5);
    expect(report.signals['a11y.passing']).toBe(false);
    expect(report.signals['critique.score']).toBe(1);
    expect(report.status).toBe('failing');
  });

  it('does not let sub-threshold impacts fail the gate', async () => {
    const target = await writeArtifact();
    const report = await runA11yAudit({
      cwd: tmp,
      target,
      analyzeFn: async () =>
        axeResult([
          violation('region', 'moderate', 4),
          violation('landmark-one-main', 'minor', 1),
        ]),
    });

    expect(report.blockingCount).toBe(0);
    expect(report.signals['a11y.passing']).toBe(true);
    // The sub-threshold findings are still reported for the agent to read.
    expect(report.counts.moderate).toBe(4);
    expect(report.counts.minor).toBe(1);
    expect(report.violations).toHaveLength(2);
  });

  it('honours an explicit failOn threshold', async () => {
    const target = await writeArtifact();
    const report = await runA11yAudit({
      cwd: tmp,
      target,
      failOn: ['moderate', 'serious', 'critical'],
      analyzeFn: async () => axeResult([violation('region', 'moderate', 2)]),
    });

    expect(report.blockingCount).toBe(2);
    expect(report.signals['a11y.passing']).toBe(false);
  });

  it('treats a null impact as unclassified and never blocking', async () => {
    const target = await writeArtifact();
    const report = await runA11yAudit({
      cwd: tmp,
      target,
      analyzeFn: async () => axeResult([violation('unclassified-rule', null, 3)]),
    });

    expect(report.blockingCount).toBe(0);
    expect(report.signals['a11y.passing']).toBe(true);
    expect(report.counts.unclassified).toBe(3);
  });
});

describe('runA11yAudit — refusing to assert what it did not measure', () => {
  it('emits no signals at all when the target artifact is missing', async () => {
    const report = await runA11yAudit({
      cwd: tmp,
      target: 'does-not-exist.html',
      analyzeFn: async () => axeResult([]),
    });

    expect(report.status).toBe('skipped');
    expect(report.reason).toMatch(/not found/i);
    // The critical invariant: silence, not a fabricated pass.
    expect(report.signals['a11y.passing']).toBeUndefined();
    expect(report.signals['a11y.violations']).toBeUndefined();
    expect(report.signals['critique.score']).toBeUndefined();
  });

  it('emits no signals when the analyzer itself throws', async () => {
    const target = await writeArtifact();
    const report = await runA11yAudit({
      cwd: tmp,
      target,
      analyzeFn: async () => {
        throw new Error('browser launch failed');
      },
    });

    expect(report.status).toBe('skipped');
    expect(report.reason).toMatch(/browser launch failed/);
    expect(report.signals['a11y.passing']).toBeUndefined();
    expect(report.signals['critique.score']).toBeUndefined();
  });

  it('skips rather than hangs when the analyzer exceeds the timeout', async () => {
    const target = await writeArtifact();
    const report = await runA11yAudit({
      cwd: tmp,
      target,
      timeoutMs: 20,
      analyzeFn: () => new Promise<AxeRunResult>(() => { /* never settles */ }),
    });

    expect(report.status).toBe('skipped');
    expect(report.reason).toMatch(/timed out/i);
    expect(report.signals['a11y.passing']).toBeUndefined();
  });

  it('signals the analyzer to abort when it times out', async () => {
    // Abandoning the promise is not enough: the production analyzer owns a
    // headless Chromium, and a hung `axe.run` would leak the whole browser
    // for the life of the daemon. The runner must tell it to tear down.
    const target = await writeArtifact();
    let aborted = false;

    await runA11yAudit({
      cwd: tmp,
      target,
      timeoutMs: 20,
      analyzeFn: (_target, { signal }) =>
        new Promise<AxeRunResult>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    });

    expect(aborted).toBe(true);
  });

  it('does not abort the analyzer on the success path', async () => {
    const target = await writeArtifact();
    let aborted = false;

    const report = await runA11yAudit({
      cwd: tmp,
      target,
      analyzeFn: async (_target, { signal }) => {
        signal.addEventListener('abort', () => { aborted = true; });
        return axeResult([]);
      },
    });

    expect(report.status).toBe('passing');
    expect(aborted).toBe(false);
  });
});

describe('runA11yAudit — target confinement', () => {
  it('refuses a path that escapes the project root', async () => {
    // `target` is operator-controlled today (OD_A11Y_AUDIT_TARGET), but it
    // is loaded by a browser running inside the privileged daemon, so it
    // must not be able to address arbitrary host files.
    const report = await runA11yAudit({
      cwd: tmp,
      target: '../../../../etc/passwd',
      analyzeFn: async () => axeResult([]),
    });

    expect(report.status).toBe('skipped');
    expect(report.reason).toMatch(/outside the project/i);
    expect(report.signals).toEqual({});
  });

  it('refuses a remote target by default', async () => {
    const report = await runA11yAudit({
      cwd: tmp,
      target: 'http://169.254.169.254/latest/meta-data/',
      analyzeFn: async () => axeResult([]),
    });

    expect(report.status).toBe('skipped');
    expect(report.reason).toMatch(/remote/i);
  });

  it('refuses an absolute file: url by default', async () => {
    const report = await runA11yAudit({
      cwd: tmp,
      target: 'file:///etc/passwd',
      analyzeFn: async () => axeResult([]),
    });

    expect(report.status).toBe('skipped');
    expect(report.reason).toMatch(/remote/i);
  });

  it('allows a remote target only when the caller opts in', async () => {
    const report = await runA11yAudit({
      cwd: tmp,
      target: 'https://example.test/page',
      allowRemoteTarget: true,
      analyzeFn: async () => axeResult([]),
    });

    expect(report.status).toBe('passing');
  });
});

describe('runA11yAudit — checks axe could not decide', () => {
  it('counts blocking-impact incomplete nodes without failing the gate', async () => {
    // axe reports `incomplete` when it genuinely cannot evaluate a rule —
    // contrast over a gradient is the common case. Blocking on those would
    // make the gate unusable on exactly the visually rich artifacts this
    // product generates, but silently dropping them would turn "could not
    // tell" into "passed", which is the failure this atom exists to prevent.
    const target = await writeArtifact();
    const report = await runA11yAudit({
      cwd: tmp,
      target,
      analyzeFn: async () => ({
        ...axeResult([]),
        incomplete: [violation('color-contrast', 'serious', 2)],
      }) as AxeRunResult,
    });

    expect(report.status).toBe('passing');
    expect(report.signals['a11y.passing']).toBe(true);
    expect(report.incompleteCount).toBe(2);
  });

  it('ignores incomplete entries below the fail threshold', async () => {
    const target = await writeArtifact();
    const report = await runA11yAudit({
      cwd: tmp,
      target,
      analyzeFn: async () => ({
        ...axeResult([]),
        incomplete: [violation('region', 'moderate', 3)],
      }) as AxeRunResult,
    });

    expect(report.incompleteCount).toBe(0);
  });
});

describe('runA11yAudit — report budget', () => {
  it('truncates the violation list and records how many were dropped', async () => {
    const target = await writeArtifact();
    const many = Array.from({ length: 40 }, (_, i) =>
      violation(`rule-${i}`, 'serious', 1),
    );
    const report = await runA11yAudit({
      cwd: tmp,
      target,
      maxViolations: 10,
      analyzeFn: async () => axeResult(many),
    });

    expect(report.violations).toHaveLength(10);
    expect(report.truncatedViolations).toBe(30);
    // Truncating the *report* must not distort the *count* the gate reads.
    expect(report.blockingCount).toBe(40);
    expect(report.signals['a11y.violations']).toBe(40);
  });
});

describe('writeA11yAuditReport', () => {
  it('writes critique/a11y-audit.json under the project root', async () => {
    const target = await writeArtifact();
    const report = await runA11yAudit({
      cwd: tmp,
      target,
      analyzeFn: async () => axeResult([violation('image-alt', 'critical', 1)]),
    });

    const written = await writeA11yAuditReport(tmp, report);
    expect(written).toBe(path.join(tmp, 'critique', 'a11y-audit.json'));

    const parsed = JSON.parse(await readFile(written, 'utf8'));
    expect(parsed.blockingCount).toBe(1);
    expect(parsed.violations[0].id).toBe('image-alt');
    expect(parsed.engine.name).toBe('axe-core');
    expect(typeof parsed.endedAt).toBe('string');
  });
});
