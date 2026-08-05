// Plan §3.D — atom worker registry.
//
// Stage D of plugin-driven-flow-plan replaces the canned stub stage
// runner inside `firePipelineForRun` with a per-atom worker model.
// Each atom can register a `run(ctx)` that observes the run's DB
// state and returns real `UntilSignals`; atoms with no registered
// worker fall through silently so the stage runner keeps converging
// at parity with the v1 stub for unobserved pipelines.
//
// The registry stays intentionally minimal:
//   - module-level `Map<atomId, AtomWorker>` so registration is a
//     simple side-effect (built-ins.ts registers FIRST_PARTY_ATOMS
//     on first use)
//   - `runStageWithRegistry(ctx)` walks `stage.atoms`, asks each
//     registered worker for its signals, then pessimistically
//     merges them (false-wins boolean; for numbers, whichever
//     direction is worse for that signal — see HIGHER_IS_WORSE) so a
//     single atom returning `critique.score: 2` overrides the
//     optimistic defaults
//   - permissive defaults (`critique.score: 4`, `preview.ok: true`,
//     `user.confirmed: true`) keep the happy path converging in one
//     iteration when no atom contradicts them — matches v1 stub
//     behaviour for backwards compatibility.

import type Database from 'better-sqlite3';
import type {
  AppliedPluginSnapshot,
  PipelineStage,
} from '@open-design/contracts';
import type { UntilSignals } from '../until.js';
import {
  scanRunEventsForUsageAnalytics,
  type RunEventForAnalyticsObservability,
} from '../../run-analytics-observability.js';

type SqliteDb = Database.Database;

export interface AtomWorkerContext {
  db:             SqliteDb;
  runId:          string;
  projectId:      string;
  conversationId: string | null;
  stage:          PipelineStage;
  iteration:      number;
  snapshot:       AppliedPluginSnapshot;
  runEvents?:     RunEventForAnalyticsObservability[];
  // Resolved filesystem root of the run's project, for atoms that observe
  // artifacts on disk rather than rows in the run's audit log (`a11y-audit`
  // reads the rendered artifact). Optional because most atoms never touch
  // the filesystem, and because a caller that cannot resolve a root must be
  // able to say so — a filesystem atom given no root stays silent rather
  // than guessing a path.
  projectRoot?:   string | undefined;
}

export interface AtomOutcome {
  signals?: UntilSignals;
  // Optional free-form note appended to the stage's
  // `run_devloop_iterations.critique_summary` audit column.
  note?:    string;
}

export interface AtomWorker {
  id:        string;
  describe?: string;
  run:       (ctx: AtomWorkerContext) => Promise<AtomOutcome> | AtomOutcome;
}

const REGISTRY = new Map<string, AtomWorker>();

export function registerAtomWorker(worker: AtomWorker): void {
  REGISTRY.set(worker.id, worker);
}

export function unregisterAtomWorker(id: string): void {
  REGISTRY.delete(id);
}

export function clearAtomWorkers(): void {
  REGISTRY.clear();
}

export function getAtomWorker(id: string): AtomWorker | undefined {
  return REGISTRY.get(id);
}

export function listRegisteredAtomIds(): string[] {
  return Array.from(REGISTRY.keys()).sort();
}

// Permissive defaults mirror the v1 stub's canned signals so the
// registry runner stays at parity for unobserved atoms — swapping
// from stub → registry never regresses happy-path convergence.
// Real worker observations REPLACE these defaults wholesale (rather
// than min-merging) so a real score of 5 never gets clipped to the
// default 4; cross-worker conflicts inside a single stage still
// pessimistically merge (false-wins boolean, worst-direction number).
export const PERMISSIVE_DEFAULT_SIGNALS: Readonly<UntilSignals> = Object.freeze({
  'critique.score': 4,
  'preview.ok':     true,
  'user.confirmed': true,
});

export interface StageRegistryOutcome {
  signals:         UntilSignals;
  critiqueSummary: string | null;
  notes:           string[];
  observedAtoms:   string[];
  tokensUsed?:     number | null;
}

// Walk every atom in the stage, invoke its registered worker (if
// any), then layer the resulting real-observation map over the
// permissive defaults. Worker failures are captured as notes and
// never crash the stage — the devloop scheduler keeps its
// iteration cap as the safety net.
export async function runStageWithRegistry(
  ctx: AtomWorkerContext,
): Promise<StageRegistryOutcome> {
  const real = new Map<keyof UntilSignals, unknown>();
  const notes: string[] = [];
  const observed: string[] = [];
  for (const atomId of ctx.stage.atoms ?? []) {
    const worker = getAtomWorker(atomId);
    if (!worker) continue;
    observed.push(atomId);
    try {
      const out = await Promise.resolve(worker.run(ctx));
      for (const [k, v] of Object.entries(out.signals ?? {})) {
        const key = k as keyof UntilSignals;
        const prev = real.get(key);
        real.set(key, prev === undefined ? v : mergePessimistic(key, prev, v));
      }
      if (out.note) notes.push(`[${worker.id}] ${out.note}`);
    } catch (err) {
      notes.push(`[${worker.id}] worker error: ${(err as Error).message ?? String(err)}`);
    }
  }
  const accumulated: UntilSignals = { ...PERMISSIVE_DEFAULT_SIGNALS };
  for (const [key, value] of real) {
    accumulated[key] = value as never;
  }
  return {
    signals:         accumulated,
    critiqueSummary: notes.length > 0 ? notes.join('\n') : null,
    notes,
    observedAtoms:   observed,
    tokensUsed:      tokensUsedFromRunEvents(ctx.runEvents),
  };
}

function tokensUsedFromRunEvents(
  events: RunEventForAnalyticsObservability[] | undefined,
): number | null {
  if (!events?.length) return null;
  const usage = scanRunEventsForUsageAnalytics(events, null, 0);
  return usage.total_tokens ?? null;
}

// Signals whose LARGER value is the worse outcome.
//
// Most numeric signals are scores, where lower is worse and `Math.min` is
// therefore the pessimistic choice. A count of problems inverts that: taking
// the minimum of 0 and 5 violations would report the clean observation and
// discard the failing one, which is optimistic merging wearing a pessimistic
// name. Direction has to be declared per signal, not assumed.
const HIGHER_IS_WORSE: ReadonlySet<string> = new Set<keyof UntilSignals>([
  'a11y.violations',
]);

// Pessimistic merge between multiple workers contributing to the same signal
// key. Cross-worker false-wins for booleans; for numbers, whichever direction
// is worse for that particular signal.
function mergePessimistic(key: string, prev: unknown, next: unknown): unknown {
  if (typeof prev === 'boolean' && typeof next === 'boolean') return prev && next;
  if (typeof prev === 'number' && typeof next === 'number') {
    return HIGHER_IS_WORSE.has(key) ? Math.max(prev, next) : Math.min(prev, next);
  }
  return next;
}
