// Atom-worker adapter for the a11y audit.
//
// Split from `built-ins.ts` so the decision logic — audit or stay silent —
// is unit-testable without launching a browser: tests inject `runAudit`,
// production gets the axe-core + Playwright analyzer.

import {
  runA11yAudit,
  writeA11yAuditReport,
  type A11yAuditReport,
  type A11yImpact,
} from './a11y-audit.js';
import { playwrightAxeAnalyzer } from './a11y-audit-playwright.js';
import type { AtomOutcome, AtomWorkerContext } from './registry.js';

/**
 * Artifact audited when a pipeline does not say otherwise. Every prototype
 * and deck template in `design-templates/` renders to `index.html` at the
 * project root, so this is the artifact a devloop is iterating on.
 */
export const DEFAULT_A11Y_TARGET = 'index.html';

/** Override for projects whose primary artifact lives elsewhere. */
export const A11Y_TARGET_ENV = 'OD_A11Y_AUDIT_TARGET';

export interface A11yAuditWorkerOptions {
  /** Artifact path relative to the project root. */
  target?: string;
  /** Impacts that fail the gate. Defaults to the runner's serious/critical. */
  failOn?: A11yImpact[];
  /** Injection seam for tests; production uses the Playwright analyzer. */
  runAudit?: (opts: { cwd: string; target: string }) => Promise<A11yAuditReport>;
}

function defaultRunAudit(failOn?: A11yImpact[]) {
  return async ({ cwd, target }: { cwd: string; target: string }) =>
    runA11yAudit({
      cwd,
      target,
      ...(failOn ? { failOn } : {}),
      analyzeFn: playwrightAxeAnalyzer(),
    });
}

function describeOutcome(report: A11yAuditReport): string {
  if (report.status === 'skipped') {
    return `a11y-audit skipped: ${report.reason ?? 'unknown reason'}`;
  }
  return `a11y-audit ${report.status}: ${report.blockingCount} blocking node(s) in ${report.target}`;
}

/**
 * Build the worker `run` function the atom registry invokes.
 *
 * Returns empty signals in exactly two cases — no project root, or an audit
 * that could not measure — because in both the daemon has no observation to
 * report and a fabricated pass would silently defeat the gate.
 */
export function createA11yAuditWorker(options: A11yAuditWorkerOptions = {}) {
  const target =
    options.target ?? process.env[A11Y_TARGET_ENV] ?? DEFAULT_A11Y_TARGET;
  const runAudit = options.runAudit ?? defaultRunAudit(options.failOn);

  return async function a11yAuditWorker(ctx: AtomWorkerContext): Promise<AtomOutcome> {
    const cwd = ctx.projectRoot;
    if (!cwd) {
      return {
        signals: {},
        note: 'a11y-audit skipped: no project root on the atom context',
      };
    }

    const report = await runAudit({ cwd, target });

    // Best-effort persistence: a read-only or full disk must not turn a
    // successful measurement into a failed stage.
    try {
      await writeA11yAuditReport(cwd, report);
    } catch {
      /* report is advisory; the signals below are the load-bearing output */
    }

    return { signals: report.signals, note: describeOutcome(report) };
  };
}
