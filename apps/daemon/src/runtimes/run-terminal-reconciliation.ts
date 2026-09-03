import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import { appendMessageStatusEvent } from '../db.js';
import { classifyRunFailure } from '../run-failure-classification.js';
import { deriveRunErrorCode, runResultFromStatus } from '../run-result.js';
import { runAskedUserQuestion } from './run-artifacts.js';

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled']);
const RESTART_ERROR_CODE = 'DAEMON_RESTARTED';
const RESTART_ERROR_MESSAGE = 'Run interrupted because the daemon restarted.';
const RECONCILED_STATUS_MESSAGE = 'Run terminal state reconciled after daemon restart.';
const FOLLOWED_TERMINAL_STATUS_MESSAGE = 'Message reconciled to the run terminal event.';

interface AnalyticsRecovery {
  context: Record<string, unknown>;
  properties: Record<string, unknown>;
  insertId: string;
  completedAt?: number;
}

interface DurableRunState {
  schemaVersion: 1;
  id: string;
  projectId: string | null;
  conversationId: string | null;
  assistantMessageId: string | null;
  agentId: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
  exitCode?: number | null;
  signal?: string | null;
  error?: string | null;
  errorCode?: string | null;
  artifactCount?: number;
  endedWithUnfinishedWork?: boolean;
  userPrompt?: string;
  model?: string;
  reasoning?: string;
  skillId?: string;
  designSystemId?: string;
  designSystemDigest?: string;
  designSystemSelectionSource?: string;
  clientType?: 'desktop' | 'web' | 'unknown';
  analyticsTelemetry?: Record<string, unknown>;
  promptTelemetry?: Record<string, unknown>;
  promptCache?: Record<string, unknown>;
  analyticsRecovery?: AnalyticsRecovery;
  langfuseCompletedAt?: number;
  terminalRecoveryReason?: 'daemon_restart' | 'analytics_incomplete';
}

interface AnalyticsLike {
  capture(args: {
    eventName: string;
    context: Record<string, unknown>;
    appVersion: string;
    properties: Record<string, unknown>;
    insertId: string;
  }): void | Promise<void>;
}

interface ReconciliationOptions {
  analytics: AnalyticsLike;
  appVersion: string;
  appVersionInfo?: unknown;
  db: Database.Database;
  reportLangfuse(args: Record<string, unknown>): unknown | Promise<unknown>;
  runsLogDir: string;
}

export interface RunTerminalReconciliationResult {
  scanned: number;
  interrupted: number;
  messagesReconciled: number;
  messagesFollowedTerminal: number;
  analyticsReplayed: number;
  langfuseReplayed: number;
}

/**
 * An assistant message row must follow the terminal event of the run it
 * belongs to. A row may not stay `failed` beside a run that did not fail.
 *
 * Two writers stamp `failed` onto a row without knowing whether the run is
 * still alive: `reconcileMessages()` below, which fails every `queued` /
 * `running` row it finds at daemon startup, and a chat client whose SSE stream
 * dropped. Neither revisits the row — the startup pass only ever selects
 * `queued` / `running` — so a run that goes on to succeed leaves a row the
 * chat renders as "Task failed" for a turn that finished and wrote files
 * (issue #159 A).
 *
 * This is the single writer that restores the invariant, and it is the only
 * one that needs to be: a `failed` row is only ever repaired towards the run's
 * own terminal status, never away from it. It deliberately does NOT act when
 * the run itself failed — a genuine failure needs no repair, and the existing
 * failure-persistence paths own that row. Repairing only a disagreement makes
 * it idempotent, which is what lets the startup backfill re-run on every boot.
 * `endedAt` is rewritten rather than preserved because the row's current value
 * came from the same wrong write this call is correcting.
 *
 * Called once from the run service's terminal hook (`server.ts`), so a live
 * run repairs its own row the moment it ends, and once per stranded row from
 * `followRunTerminalOnStuckMessages()` below.
 *
 * Every write is inside one guard, and the guard reports rather than swallows.
 * The terminal hook calls this before the run's other terminal bookkeeping, so
 * an exception escaping here would take that bookkeeping down with it; and a
 * silently swallowed failure would leave exactly the stuck row this exists to
 * prevent, with nothing in the daemon log to say so. `repaired` is set from the
 * UPDATE itself, so a row that was fixed before the status-event append threw
 * is still reported as repaired.
 *
 * Returns whether the row was repaired.
 */
export function followRunTerminalOnMessage(
  db: Database.Database,
  args: { assistantMessageId: string | null | undefined; endedAt: number; status: string },
): boolean {
  const { assistantMessageId, endedAt, status } = args;
  if (!assistantMessageId) return false;
  if (!TERMINAL_STATUSES.has(status) || status === 'failed') return false;
  let repaired = false;
  try {
    repaired = db.prepare(
      `UPDATE messages
          SET run_status = ?, ended_at = ?
        WHERE id = ?
          AND role = 'assistant'
          AND run_status = 'failed'`,
    ).run(status, endedAt, assistantMessageId).changes > 0;
    if (repaired) {
      appendMessageStatusEvent(db, assistantMessageId, {
        label: status,
        detail: FOLLOWED_TERMINAL_STATUS_MESSAGE,
      });
    }
  } catch (err) {
    console.warn('[runs] message terminal reconciliation failed', err);
  }
  return repaired;
}

/**
 * A message write may move an assistant row's run status TOWARDS its run's
 * terminal event, never away from it.
 *
 * `followRunTerminalOnMessage` above repairs the row from inside the run's
 * terminal hook, which fires while `finish()` is still running (`runtimes/
 * runs.ts`). A chat client that already gave up on the turn holds its own copy
 * of the row and can flush it afterwards — a retried PUT, a queued offline
 * write, a second tab — and the message route upserts whatever it is handed
 * (`routes/project/conversations.ts` -> `upsertMessage` in `db.ts`). Nothing
 * revisits the row after that: the startup pass below only selects
 * `queued`/`running` rows, and so does the post-end reconciler in
 * `plugins/share-helpers.ts`. A write that lands one second late would make
 * "Task failed" permanent again for a turn that succeeded (issue #159 A).
 *
 * So the invariant this holds is the write-side half of the same rule: once a
 * row follows a non-failed terminal run status, only that status can be
 * written onto it. Any disagreeing claim is held, not only a `failed` one — a
 * stale copy that still believes the turn is `running`, or one carrying no run
 * status at all (which `upsertMessage` stores as NULL), takes the row off its
 * terminal just as effectively. `run_status` and `ended_at` are pinned back to
 * the stored values and every other field passes through untouched, so a late
 * write still delivers the content, events and produced files it carries.
 *
 * The row's `ended_at` is held on the same terms as its status, against the
 * writes that are not the row's own run speaking: a stale copy that agrees the
 * turn succeeded but carries the timestamp its own writer stamped would drag
 * the row off the run's terminal clock. What separates that copy from the live
 * client's final save is which run each one names, not which clock reads later
 * — see `heldTerminalEndedAt` and `writeNamesRowRun` below.
 *
 * Two writes are deliberately let through. A write that already agrees on both
 * status and timestamp has nothing to correct. And a write naming a DIFFERENT
 * run is a new turn on that row, not a stale copy of the finished one, so it
 * owns the row; only a write for the same run, or one that names no run at
 * all, is held. It never invents a status either — a row with no non-failed
 * terminal status stored is written exactly as sent.
 *
 * The ANSWER is held on the same terms as the status. A write that had to be
 * held is by definition a copy of the turn made before it finished, so the
 * body it carries is whatever that writer had when it gave up — for the
 * dropped chat client, the empty string and the stale "daemon restarted"
 * status event. Pinning only the status left the user reading a succeeded turn
 * with no answer in it and two contradictory status events under it: the
 * symptom moved rather than closing. So when the row already stores an answer
 * and the held write carries none, the stored body and the events that belong
 * to it stay. This never blocks a real late delivery: a write carrying content
 * keeps its own content, and stored events replace nothing when there are
 * none.
 *
 * Failing open is deliberate: a read error here must not reject the user's
 * message write, so it warns and returns the write unchanged, which is exactly
 * the behaviour that preceded this guard.
 */
export function holdTerminalRunStatusOnMessageWrite(
  db: Database.Database,
  message: Record<string, unknown>,
): Record<string, unknown> {
  const id = message.id;
  if (typeof id !== 'string' || !id) return message;
  try {
    const stored = db.prepare(
      `SELECT run_status AS runStatus, ended_at AS endedAt, run_id AS runId,
              started_at AS startedAt, content AS content, events_json AS eventsJson
         FROM messages
        WHERE id = ? AND role = 'assistant'`,
    ).get(id) as {
      runStatus: string | null;
      endedAt: number | null;
      runId: string | null;
      startedAt: number | null;
      content: string | null;
      eventsJson: string | null;
    } | undefined;
    const held = stored?.runStatus;
    if (!held || held === 'failed' || !TERMINAL_STATUSES.has(held)) return message;
    if (
      typeof message.runId === 'string'
      && typeof stored?.runId === 'string'
      && message.runId !== stored.runId
    ) return message;
    const endedAt = heldTerminalEndedAt(stored, message, held);
    if (message.runStatus === held && message.endedAt === endedAt) return message;
    return { ...message, ...heldTerminalBody(stored, message), runStatus: held, endedAt };
  } catch (err) {
    console.warn('[runs] terminal run status hold failed', err);
    return message;
  }
}

/**
 * Whether a write is the row's OWN run speaking — the live client's final save
 * for the terminal the row already follows — rather than a copy of the turn
 * some earlier writer is flushing late.
 *
 * A write names the row's run when it carries the row's `run_id`, or, for a
 * save that carries no run id, the row's `started_at`. Both are stamped onto
 * the row per run by `pinAssistantMessageOnRunCreate` (`runtimes/
 * chat-run-messages.ts`), so a copy made under an earlier run of the same row
 * carries neither and cannot claim to be this run's writer.
 */
function writeNamesRowRun(
  stored: { runId: string | null; startedAt: number | null } | undefined,
  message: Record<string, unknown>,
): boolean {
  if (!stored) return false;
  if (typeof message.runId === 'string' && message.runId) return message.runId === stored.runId;
  return typeof message.startedAt === 'number' && message.startedAt === stored.startedAt;
}

/**
 * The `ended_at` a held write leaves on the row.
 *
 * A write that agrees with the row's terminal status and NAMES the row's run is
 * that run's own final save, not a stale copy of the turn: it saw the end the
 * daemon saw, so it keeps the timestamp it carries. Which way that timestamp
 * falls against the stored one decides nothing, because the two stamps come
 * from independent clocks — the daemon stamps the row from its own `Date.now()`
 * the moment the run ends (`reconcileAssistantMessageOnRunEnd` in
 * `plugins/share-helpers.ts`), and the client's onDone save carries the
 * completion time it rendered. Ordering them made the live save lose its own
 * `endedAt` by one millisecond in CI, which
 * `e2e/tests/dialog/retry-after-stop.test.ts` asserts must not happen for a
 * retried turn.
 *
 * A write that agrees on the status but names no run at all is the one case
 * identity cannot settle. It keeps the narrower allowance this hold shipped
 * with: it may move the terminal clock FORWARDS, never back.
 *
 * Every other write keeps the stored timestamp. A write that disagrees on the
 * status is a stale copy whose clock is not evidence of anything, a write that
 * names an earlier run of the row is the backwards drift this hold exists to
 * stop, and a write carrying no timestamp of its own takes the row's, as
 * before.
 */
function heldTerminalEndedAt(
  stored: { endedAt: number | null; runId: string | null; startedAt: number | null } | undefined,
  message: Record<string, unknown>,
  held: string,
): unknown {
  const storedEndedAt = stored?.endedAt ?? null;
  const incoming = message.endedAt;
  if (message.runStatus !== held || typeof incoming !== 'number') {
    return storedEndedAt ?? incoming ?? null;
  }
  if (writeNamesRowRun(stored, message)) return incoming;
  const namesNoRun = typeof message.runId !== 'string' && typeof message.startedAt !== 'number';
  if (namesNoRun && (storedEndedAt === null || incoming > storedEndedAt)) return incoming;
  return storedEndedAt ?? incoming;
}

function isBlankText(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

/**
 * The stored answer of a row whose write is being held, when the held write
 * would erase it: the body plus the events recorded beside it. Empty when the
 * row has no answer to protect or the write brings one of its own.
 */
function heldTerminalBody(
  stored: { content: string | null; eventsJson: string | null } | undefined,
  message: Record<string, unknown>,
): Record<string, unknown> {
  if (!stored || isBlankText(stored.content)) return {};
  if (!isBlankText(message.content)) return {};
  const held: Record<string, unknown> = { content: stored.content };
  const events = storedEvents(stored.eventsJson);
  if (events) held.events = events;
  return held;
}

function storedEvents(eventsJson: string | null): unknown[] | null {
  if (typeof eventsJson !== 'string' || !eventsJson) return null;
  try {
    const parsed = JSON.parse(eventsJson) as unknown;
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The status the run's own durable terminal record carries: the last `end`
 * event in its `events.jsonl`.
 *
 * `emit()` (`runtimes/runs.ts`) persists `state.json` BEFORE it appends the
 * record to the event log, so a terminal `state.json` can exist with no `end`
 * line behind it — the process died between the two writes, the stream never
 * flushed, or the run directory was restored without its log. Reading history,
 * `state.json` alone is therefore not proof the run reached that terminal.
 * Returns null when the log carries no `end` record at all.
 */
function durableTerminalStatus(runsLogDir: string, runId: string): string | null {
  let status: string | null = null;
  for (const record of readEvents(runsLogDir, runId)) {
    if (record.event !== 'end') continue;
    const candidate = isObject(record.data) ? record.data.status : null;
    if (typeof candidate === 'string') status = candidate;
  }
  return status;
}

/**
 * Backfill for rows stranded before the terminal hook above existed: assistant
 * rows still `failed` with EMPTY content whose run reached a non-failed
 * terminal. Idempotent, so it can run on every daemon boot.
 *
 * The empty-content narrowing is what separates this pass from the live hook.
 * At terminal time the hook knows the row's `failed` predates the run's
 * terminal event, so the row is provably stale whatever it holds. Reading
 * history, that ordering is unrecoverable — so this pass only touches rows
 * that carry no answer body at all, and never rewrites a stored error the user
 * may still be reading.
 *
 * It also requires the run's terminal to be durably RECORDED, not merely
 * declared: `state.json` and the log's last `end` event must agree. A
 * `state.json` written without the matching `end` line (see
 * `durableTerminalStatus` above) says only that the daemon intended a
 * terminal, and this pass rewrites a row the user reads — a repair is worth
 * making only against the same evidence the symptom was measured against.
 * Returns how many rows it repaired.
 */
function followRunTerminalOnStuckMessages(
  db: Database.Database,
  statesByRunId: Map<string, DurableRunState>,
  runsLogDir: string,
): number {
  let rows: Array<{ id: string; runId: string }> = [];
  try {
    rows = db.prepare(
      `SELECT id, run_id AS runId
         FROM messages
        WHERE role = 'assistant'
          AND run_status = 'failed'
          AND run_id IS NOT NULL
          AND TRIM(COALESCE(content, '')) = ''`,
    ).all() as Array<{ id: string; runId: string }>;
  } catch (err) {
    console.warn('[runs] stranded message scan failed', err);
    return 0;
  }
  let repaired = 0;
  for (const row of rows) {
    const state = statesByRunId.get(row.runId);
    if (!state) continue;
    if (durableTerminalStatus(runsLogDir, row.runId) !== state.status) continue;
    if (followRunTerminalOnMessage(db, {
      assistantMessageId: row.id,
      endedAt: state.updatedAt,
      status: state.status,
    })) {
      repaired += 1;
    }
  }
  return repaired;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readState(filePath: string): DurableRunState | null {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!isObject(value) || value.schemaVersion !== 1) return null;
    if (typeof value.id !== 'string' || typeof value.status !== 'string') return null;
    if (typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number') return null;
    return value as unknown as DurableRunState;
  } catch {
    return null;
  }
}

function writeState(filePath: string, state: DurableRunState): void {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } catch {
    try { fs.unlinkSync(tempPath); } catch { /* best-effort cleanup */ }
  }
}

/**
 * The run's event log, read as far as it is intact.
 *
 * A half-written LAST line is the ordinary shape of a log whose daemon was
 * killed mid-append: every record before it is complete, and the run's `end`
 * record is usually one of them. Discarding the whole file over that trailing
 * fragment made `durableTerminalStatus` report no terminal, which left the
 * stranded row unrepaired — the exact symptom the backfill exists to clear —
 * with nothing to say why.
 *
 * A malformed line anywhere ELSE means damage this reader cannot reason about:
 * records may be missing or interleaved, so the log is not evidence and the
 * whole file is discarded exactly as before. Under-repairing is the safe
 * direction; mis-repairing a row the user reads is not.
 */
function readEvents(runsLogDir: string, runId: string): Array<{
  id: number;
  event: string;
  data: unknown;
  timestamp?: number;
}> {
  let lines: string[];
  try {
    lines = fs.readFileSync(path.join(runsLogDir, runId, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
  const records: Array<{ id: number; event: string; data: unknown; timestamp?: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    let value: unknown;
    try {
      value = JSON.parse(lines[index] as string) as unknown;
    } catch {
      if (index === lines.length - 1) break;
      return [];
    }
    if (isObject(value) && typeof value.id === 'number' && typeof value.event === 'string') {
      records.push(value as { id: number; event: string; data: unknown; timestamp?: number });
    }
  }
  return records;
}

function hydrateRun(state: DurableRunState, events: ReturnType<typeof readEvents>) {
  return {
    id: state.id,
    projectId: state.projectId ?? null,
    conversationId: state.conversationId ?? null,
    assistantMessageId: state.assistantMessageId ?? null,
    agentId: state.agentId ?? null,
    status: state.status,
    exitCode: state.exitCode ?? null,
    signal: state.signal ?? null,
    error: state.error ?? null,
    errorCode: state.errorCode ?? null,
    analyticsTelemetry: state.analyticsTelemetry ?? null,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    events,
    ...(state.userPrompt !== undefined ? { userPrompt: state.userPrompt } : {}),
    ...(state.model !== undefined ? { model: state.model } : {}),
    ...(state.reasoning !== undefined ? { reasoning: state.reasoning } : {}),
    ...(state.skillId !== undefined ? { skillId: state.skillId } : {}),
    ...(state.designSystemId !== undefined ? { designSystemId: state.designSystemId } : {}),
    ...(state.designSystemDigest !== undefined ? { designSystemDigest: state.designSystemDigest } : {}),
    ...(state.designSystemSelectionSource !== undefined
      ? { designSystemSelectionSource: state.designSystemSelectionSource }
      : {}),
    ...(state.clientType !== undefined ? { clientType: state.clientType } : {}),
    ...(state.promptTelemetry !== undefined ? { promptTelemetry: state.promptTelemetry } : {}),
    ...(state.promptCache !== undefined ? { promptCache: state.promptCache } : {}),
  };
}

function reconcileMessages(
  db: Database.Database,
  statesByRunId: Map<string, DurableRunState>,
  now: number,
): number {
  let rows: Array<{ id: string; runId: string | null }> = [];
  try {
    rows = db.prepare(
      `SELECT id, run_id AS runId
         FROM messages
        WHERE run_status IN ('queued', 'running')`,
    ).all() as Array<{ id: string; runId: string | null }>;
  } catch {
    return 0;
  }
  for (const row of rows) {
    const state = row.runId ? statesByRunId.get(row.runId) : undefined;
    const status = state && TERMINAL_STATUSES.has(state.status) ? state.status : 'failed';
    db.prepare(
      `UPDATE messages
          SET run_status = ?, ended_at = COALESCE(ended_at, ?)
        WHERE id = ? AND run_status IN ('queued', 'running')`,
    ).run(status, state?.updatedAt ?? now, row.id);
    const isDaemonRestart = state?.terminalRecoveryReason === 'daemon_restart'
      || state?.errorCode === RESTART_ERROR_CODE;
    appendMessageStatusEvent(db, row.id, status === 'failed'
      ? {
          label: 'error',
          detail: isDaemonRestart
            ? RESTART_ERROR_MESSAGE
            : state?.error ?? RECONCILED_STATUS_MESSAGE,
        }
      : { label: status, detail: RECONCILED_STATUS_MESSAGE });
  }
  return rows.length;
}

export async function reconcileDurableRunTerminals(
  options: ReconciliationOptions,
): Promise<RunTerminalReconciliationResult> {
  const result: RunTerminalReconciliationResult = {
    scanned: 0,
    interrupted: 0,
    messagesReconciled: 0,
    messagesFollowedTerminal: 0,
    analyticsReplayed: 0,
    langfuseReplayed: 0,
  };
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(options.runsLogDir, { withFileTypes: true });
  } catch {
    entries = [];
  }

  const states = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      filePath: path.join(options.runsLogDir, entry.name, 'state.json'),
      state: readState(path.join(options.runsLogDir, entry.name, 'state.json')),
    }))
    .filter((entry): entry is { filePath: string; state: DurableRunState } => entry.state !== null);
  result.scanned = states.length;
  const now = Date.now();

  for (const entry of states) {
    if (TERMINAL_STATUSES.has(entry.state.status)) continue;
    entry.state.status = 'failed';
    entry.state.updatedAt = now;
    entry.state.exitCode = 1;
    entry.state.signal = null;
    entry.state.error = RESTART_ERROR_MESSAGE;
    entry.state.errorCode = RESTART_ERROR_CODE;
    entry.state.terminalRecoveryReason = 'daemon_restart';
    writeState(entry.filePath, entry.state);
    result.interrupted += 1;
  }

  const statesByRunId = new Map(states.map((entry) => [entry.state.id, entry.state]));
  result.messagesReconciled = reconcileMessages(options.db, statesByRunId, now);
  result.messagesFollowedTerminal = followRunTerminalOnStuckMessages(
    options.db,
    statesByRunId,
    options.runsLogDir,
  );

  for (const entry of states) {
    const { state } = entry;
    const needsAnalytics = Boolean(
      state.analyticsRecovery && !state.analyticsRecovery.completedAt,
    );
    const needsLangfuse = !state.langfuseCompletedAt;
    if (!needsAnalytics && !needsLangfuse) continue;

    const recoveryReason = state.terminalRecoveryReason ?? 'analytics_incomplete';
    const events = readEvents(options.runsLogDir, state.id);
    if (needsAnalytics && state.analyticsRecovery) {
      const failed = state.status === 'failed';
      const runResult = runResultFromStatus(state.status);
      const errorCode = failed
        ? recoveryReason === 'daemon_restart'
          ? state.errorCode ?? RESTART_ERROR_CODE
          : deriveRunErrorCode(state)
        : undefined;
      const failure = failed
        ? recoveryReason === 'daemon_restart'
          ? {
              failure_category: 'process_exit' as const,
              failure_detail: 'interrupted' as const,
              failure_stage: 'finalize' as const,
              retryable: true,
              user_action: 'retry' as const,
            }
          : classifyRunFailure({
              result: runResult,
              status: state,
              ...(errorCode ? { errorCode } : {}),
              agentId: state.agentId,
              events,
            })
        : undefined;
      await Promise.resolve(options.analytics.capture({
        eventName: 'run_finished',
        context: state.analyticsRecovery.context,
        appVersion: options.appVersion,
        properties: {
          ...state.analyticsRecovery.properties,
          area: state.analyticsRecovery.properties.area === 'design_system_generation'
            ? 'design_system_generation'
            : 'chat_panel',
          result: runResult,
          artifact_count: state.artifactCount ?? 0,
          asked_user_question: runAskedUserQuestion(events),
          total_duration_ms: Math.max(0, state.updatedAt - state.createdAt),
          langfuse_trace_id: state.id,
          terminal_reconciled: true,
          terminal_recovery_reason: recoveryReason,
          ...(errorCode ? { error_code: errorCode } : {}),
          ...(failure ?? {}),
        },
        insertId: `${state.analyticsRecovery.insertId}-finish`,
      }));
      state.analyticsRecovery.completedAt = Date.now();
      writeState(entry.filePath, state);
      result.analyticsReplayed += 1;
    }

    if (needsLangfuse) {
      const delivery = await Promise.resolve(options.reportLangfuse({
        db: options.db,
        dataDir: path.dirname(options.runsLogDir),
        run: hydrateRun(state, events),
        persistedRunStatus: state.status,
        persistedEndedAt: state.updatedAt,
        appVersion: options.appVersionInfo ?? null,
      }));
      if (
        isObject(delivery)
        && (delivery.langfuse_expected === false
          || delivery.langfuse_delivery_status === 'accepted')
      ) {
        state.langfuseCompletedAt = Date.now();
        writeState(entry.filePath, state);
      }
      result.langfuseReplayed += 1;
    }
  }

  return result;
}
