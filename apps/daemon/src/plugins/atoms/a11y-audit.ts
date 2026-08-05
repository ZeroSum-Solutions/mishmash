// a11y-audit atom runner — objective WCAG gating for the devloop.
//
// Spec-side atom contract lives in `plugins/_official/atoms/a11y-audit/SKILL.md`.
// This module is the daemon-side implementation: given a project cwd and a
// rendered artifact, run axe-core against it, write `critique/a11y-audit.json`,
// and return the signals the devloop's `until` evaluator reads
// (`a11y.violations`, `a11y.passing`, plus the legacy `critique.score`).
//
// It exists because `craft/accessibility-baseline.md` had no runtime
// enforcement: the a11y panelist score was model self-assessment, so a
// generated artifact could ship with unreadable contrast and still converge.
//
// The load-bearing invariant is in `deriveSignals`: an audit that could not
// run emits NO signals. `evaluateTerm` in `../until.ts` treats an undefined
// signal as false, so silence makes a plan that opted into `a11y.passing`
// stall visibly rather than converge on a pass that was never measured.

import path from 'node:path';
import { promises as fsp } from 'node:fs';
import type { UntilSignals } from '../until.js';

export type A11yImpact = 'minor' | 'moderate' | 'serious' | 'critical';

/** Impact buckets in ascending severity. `unclassified` holds axe's `null`. */
export const A11Y_IMPACTS: readonly A11yImpact[] = ['minor', 'moderate', 'serious', 'critical'];

export type A11yCountKey = A11yImpact | 'unclassified';

export type A11yAuditStatus = 'passing' | 'failing' | 'skipped';

/** The subset of axe-core's node shape this atom persists. */
export interface A11yViolationNode {
  target: string[];
  html: string;
  failureSummary?: string | undefined;
}

/** The subset of axe-core's `Result` shape this atom persists. */
export interface A11yViolation {
  id: string;
  impact: A11yImpact | null;
  help: string;
  helpUrl: string;
  nodes: A11yViolationNode[];
}

/** Structural subset of axe-core's `AxeResults` the runner consumes. */
export interface AxeRunResult {
  violations: A11yViolation[];
  /**
   * Checks axe could not decide (a contrast check over a gradient or an
   * image background, for example). Carried through rather than dropped —
   * see `incompleteCount` on the report.
   */
  incomplete?: A11yViolation[] | undefined;
  testEngine?: { name: string; version: string } | undefined;
}

export interface A11yAuditReport {
  /** The target as passed in, for provenance in the written report. */
  target: string;
  status: A11yAuditStatus;
  /** Present when status='skipped'; explains why nothing was measured. */
  reason?: string | undefined;
  /** Violating *node* counts per impact bucket, across all rules. */
  counts: Record<A11yCountKey, number>;
  /** Violating nodes at or above the fail threshold. Drives the gate. */
  blockingCount: number;
  /** Violations retained in the report, capped by `maxViolations`. */
  violations: A11yViolation[];
  /** How many violation rules were dropped from `violations` by the cap. */
  truncatedViolations: number;
  /**
   * Nodes axe could not decide, at or above the fail threshold.
   *
   * These deliberately do NOT block. axe reports `incomplete` for checks it
   * genuinely cannot evaluate — contrast over a gradient or a background
   * image is the common case — and blocking on them would make the gate
   * unusable on exactly the visually rich artifacts this product generates.
   *
   * They are surfaced instead of dropped because "axe could not tell" is not
   * the same as "this passed", and the operator reading `a11y-audit.json`
   * deserves to see the difference.
   */
  incompleteCount: number;
  /** Signals the pipeline runner forwards into the devloop `until` eval. */
  signals: UntilSignals;
  engine?: { name: string; version: string } | undefined;
  /** ISO timestamp of when the audit completed. */
  endedAt: string;
}

export interface A11yAnalyzeOptions {
  timeoutMs: number;
  /**
   * Aborted when the runner gives up waiting. An analyzer that owns external
   * resources (the production one owns a headless Chromium) MUST tear them
   * down on abort: the runner abandons the promise, so nothing else will.
   */
  signal: AbortSignal;
}

export type A11yAnalyzeFn = (
  target: string,
  opts: A11yAnalyzeOptions,
) => Promise<AxeRunResult>;

export interface A11yAuditRunOptions {
  /** Project cwd. Relative targets resolve against it; the report lands here. */
  cwd: string;
  /**
   * Artifact to audit: a path relative to `cwd`, an absolute path, or an
   * `http(s)://` / `file://` URL. Local paths are existence-checked before
   * the analyzer is invoked so a missing artifact skips instead of failing.
   */
  target: string;
  /** Impacts that fail the gate. Default `['serious', 'critical']`. */
  failOn?: A11yImpact[];
  /** Analyzer timeout (ms). Default 60s. */
  timeoutMs?: number;
  /** Cap on violation rules retained in the report. Default 50. */
  maxViolations?: number;
  /**
   * Permit an `http(s)://` / `file://` target. Off by default: the analyzer
   * loads the target in a browser inside the privileged daemon, so a remote
   * or absolute URL is an SSRF / arbitrary-file-read primitive. Local paths
   * are additionally confined to `cwd`.
   */
  allowRemoteTarget?: boolean;
  /**
   * Pluggable analyzer so unit tests don't boot Chromium. Production passes
   * `playwrightAxeAnalyzer()` from `./a11y-audit-playwright.js`.
   */
  analyzeFn?: A11yAnalyzeFn;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_VIOLATIONS = 50;
const DEFAULT_FAIL_ON: readonly A11yImpact[] = ['serious', 'critical'];

/** Legacy score emitted only on failure — see `deriveSignals`. */
const FAILING_SCORE = 1;

function emptyCounts(): Record<A11yCountKey, number> {
  return { minor: 0, moderate: 0, serious: 0, critical: 0, unclassified: 0 };
}

function isRemoteTarget(target: string): boolean {
  return /^(?:https?|file):\/\//iu.test(target);
}

/** Reject axe impacts we don't model rather than trusting the string. */
function normalizeImpact(raw: unknown): A11yImpact | null {
  return typeof raw === 'string' && (A11Y_IMPACTS as readonly string[]).includes(raw)
    ? (raw as A11yImpact)
    : null;
}

/** True when `child` is `parent` itself or sits underneath it. */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function resolveTarget(
  cwd: string,
  target: string,
  allowRemote: boolean,
): Promise<{ resolved: string; missingReason?: string }> {
  if (isRemoteTarget(target)) {
    return allowRemote
      ? { resolved: target }
      : {
          resolved: target,
          missingReason:
            `remote audit target refused (pass allowRemoteTarget to permit): ${target}`,
        };
  }

  const abs = path.resolve(cwd, target);
  // Confinement before stat: the audit target is loaded by a browser running
  // inside the privileged daemon, so `../../../etc/passwd` must be refused
  // rather than merely reported as missing.
  if (!isInside(cwd, abs)) {
    return { resolved: abs, missingReason: `audit target is outside the project root: ${target}` };
  }

  // Resolve symlinks before re-checking. A lexical check alone is bypassed by
  // a link that lives inside the project but points outside it, which would
  // hand the privileged browser an arbitrary host file.
  let real: string;
  try {
    real = await fsp.realpath(abs);
  } catch {
    return { resolved: abs, missingReason: `audit target not found: ${target}` };
  }
  const realRoot = await fsp.realpath(cwd).catch(() => cwd);
  if (!isInside(realRoot, real)) {
    return {
      resolved: real,
      missingReason: `audit target resolves outside the project root: ${target}`,
    };
  }

  try {
    const stat = await fsp.stat(real);
    if (!stat.isFile()) {
      return { resolved: real, missingReason: `audit target is not a file: ${target}` };
    }
  } catch {
    return { resolved: real, missingReason: `audit target not found: ${target}` };
  }
  return { resolved: real };
}

/**
 * Resolve `promise`, or abort `controller` and reject once `timeoutMs` passes.
 *
 * Aborting is the load-bearing part. Rejecting alone would abandon a promise
 * that still owns a browser, and nothing downstream would ever close it — the
 * timeout would convert a hung audit into a permanent resource leak. The
 * abort gives the analyzer its only chance to tear down.
 *
 * The timer is unref'd and always cleared so a pending audit cannot by itself
 * keep the daemon's event loop alive.
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`a11y audit timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err: unknown) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Signals for a measured audit. A skipped audit never reaches here — see the
 * module docblock for why silence is the correct output in that case.
 */
function deriveSignals(blockingCount: number): UntilSignals {
  const passing = blockingCount === 0;
  return {
    'a11y.passing': passing,
    'a11y.violations': blockingCount,
    // Only the failing direction carries a legacy score. Emitting a 5 on a
    // pass would assert an overall quality verdict from an accessibility
    // measurement alone, and the registry's pessimistic merge (lowest number
    // wins) means it could never raise a real score anyway — so it would be
    // pure overclaim. A failure at 1 does pull the merged score down, which
    // is the direction worth wiring.
    //
    // Note what this does NOT do: a *skipped* audit emits nothing here, and
    // the registry then layers its permissive `critique.score: 4` default on
    // top. A plan gated only on `critique.score >= 4` therefore still
    // converges when accessibility was never measured. Gate on
    // `a11y.passing == true` to get the real guarantee.
    ...(passing ? {} : { 'critique.score': FAILING_SCORE }),
  };
}

function skipped(target: string, reason: string): A11yAuditReport {
  return {
    target,
    status: 'skipped',
    reason,
    counts: emptyCounts(),
    blockingCount: 0,
    violations: [],
    truncatedViolations: 0,
    incompleteCount: 0,
    // Deliberately empty: nothing was measured, so nothing is asserted.
    signals: {},
    endedAt: new Date().toISOString(),
  };
}

export async function runA11yAudit(opts: A11yAuditRunOptions): Promise<A11yAuditReport> {
  const cwd = path.resolve(opts.cwd);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxViolations = opts.maxViolations ?? DEFAULT_MAX_VIOLATIONS;
  const failOn = new Set<A11yImpact>(opts.failOn ?? DEFAULT_FAIL_ON);

  const { resolved, missingReason } = await resolveTarget(
    cwd,
    opts.target,
    opts.allowRemoteTarget === true,
  );
  if (missingReason) return skipped(opts.target, missingReason);

  const analyze = opts.analyzeFn;
  if (!analyze) {
    return skipped(opts.target, 'no analyzer supplied (pass analyzeFn)');
  }

  let result: AxeRunResult;
  const controller = new AbortController();
  try {
    result = await withTimeout(
      analyze(resolved, { timeoutMs, signal: controller.signal }),
      timeoutMs,
      controller,
    );
  } catch (err) {
    return skipped(opts.target, err instanceof Error ? err.message : String(err));
  }

  const rawViolations = Array.isArray(result?.violations) ? result.violations : [];
  const counts = emptyCounts();
  let blockingCount = 0;

  const violations: A11yViolation[] = rawViolations.map((v) => {
    const impact = normalizeImpact(v?.impact);
    const nodes = Array.isArray(v?.nodes) ? v.nodes : [];
    counts[impact ?? 'unclassified'] += nodes.length;
    if (impact !== null && failOn.has(impact)) blockingCount += nodes.length;
    return {
      id: String(v?.id ?? 'unknown'),
      impact,
      help: String(v?.help ?? ''),
      helpUrl: String(v?.helpUrl ?? ''),
      nodes: nodes.map((n) => ({
        target: Array.isArray(n?.target) ? n.target.map(String) : [],
        html: String(n?.html ?? ''),
        failureSummary: n?.failureSummary,
      })),
    };
  });

  // Cap the *report*, never the counts the gate reads.
  const retained = violations.slice(0, maxViolations);

  let incompleteCount = 0;
  for (const item of Array.isArray(result?.incomplete) ? result.incomplete : []) {
    const impact = normalizeImpact(item?.impact);
    if (impact !== null && failOn.has(impact)) {
      incompleteCount += Array.isArray(item?.nodes) ? item.nodes.length : 0;
    }
  }

  return {
    target: opts.target,
    status: blockingCount === 0 ? 'passing' : 'failing',
    counts,
    blockingCount,
    violations: retained,
    truncatedViolations: violations.length - retained.length,
    incompleteCount,
    signals: deriveSignals(blockingCount),
    engine: result?.testEngine,
    endedAt: new Date().toISOString(),
  };
}

/** Persist the report next to build-test's, under `<cwd>/critique/`. */
export async function writeA11yAuditReport(
  cwd: string,
  report: A11yAuditReport,
): Promise<string> {
  const dir = path.join(path.resolve(cwd), 'critique');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'a11y-audit.json');
  await fsp.writeFile(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return file;
}
