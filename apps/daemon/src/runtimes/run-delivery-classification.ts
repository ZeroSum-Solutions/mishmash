import fs from 'node:fs';
import path from 'node:path';

import type Database from 'better-sqlite3';
import {
  isImplicitProducedFileCandidate,
  isTodoWriteToolName,
  resolveDesignDeliveryOutcomeFromEvidence,
  todoItemsFromTodoWriteInput,
  todoSnapshotHasUnfinishedWork,
  type ChatSessionMode,
  type DesignDeliveryEvidence,
  type DesignDeliveryOutcome,
  type ProjectFile,
} from '@open-design/contracts';

import {
  reconstructAssistantText,
  WRITE_OR_EDIT_TOOL_NAMES,
  type RunEventLike,
} from './run-artifacts.js';

/** The run's persisted `end` record, as `events.jsonl` stores it. */
interface RunTerminalRecord {
  status: string | null;
  endedWithUnfinishedWork: boolean;
  /** The clock `emit()` (`runtimes/runs.ts`) stamped on the `end` record, i.e.
   *  the run's own terminal time. Null for a log whose terminal record predates
   *  that stamp; see `classifyUnattendedRunDelivery`. */
  endedAt: number | null;
}

/** One record as `readRunEventRecords` reads it back off disk. */
interface RunEventRecord {
  event: string;
  data: unknown;
  timestamp?: number;
}

/**
 * The window a run's writes belong to: its own start and its own terminal, both
 * taken from the durable record. Files outside it are another turn's work.
 */
export interface RunInterval {
  startedAt: number;
  endedAt: number;
}

export interface UnattendedDeliveryRun {
  assistantMessageId: string | null | undefined;
  conversationId: string | null | undefined;
  id: string;
  projectId: string | null | undefined;
  sessionMode: ChatSessionMode | null | undefined;
  startedAt: number;
}

export interface UnattendedDeliveryDeps {
  /** Project files as the daemon lists them, newest write first. */
  listProjectFiles(projectId: string): Promise<readonly ProjectFile[]>;
  /** True when a daemon-managed preview server for this project came up during
   *  the run's window (issue #38: the deliverable is the live URL, not a file). */
  previewStartedDuringRun(projectId: string, runStartedAt: number): boolean;
  /** Directory holding one `<runId>/events.jsonl` per run. */
  runsLogDir: string;
}

/** The assistant row this classification would write to. */
interface AssistantRow {
  content: string | null;
  producedFilesJson: string | null;
  resultDeliveryState: string | null;
  sessionMode: string | null;
  traceObjectFilesJson: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The run's own durable event log, read as far as it is intact.
 *
 * A half-written LAST line is the ordinary shape of a log whose daemon was
 * killed mid-append, and every record before it is complete. A malformed line
 * anywhere else means damage this reader cannot reason about, so the file is
 * discarded rather than half-believed. Mirrors `readEvents` in
 * `run-terminal-reconciliation.ts`, which reads the same file for the same
 * reason.
 */
export function readRunEventRecords(
  runsLogDir: string,
  runId: string,
): RunEventRecord[] {
  let lines: string[];
  try {
    lines = fs.readFileSync(path.join(runsLogDir, runId, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
  const records: RunEventRecord[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    let value: unknown;
    try {
      value = JSON.parse(lines[index] as string) as unknown;
    } catch {
      if (index === lines.length - 1) break;
      return [];
    }
    if (isRecord(value) && typeof value.event === 'string') {
      records.push({
        event: value.event,
        data: value.data,
        ...(typeof value.timestamp === 'number' ? { timestamp: value.timestamp } : {}),
      });
    }
  }
  return records;
}

/**
 * The run's terminal verdict as the log recorded it: the last `end` record.
 *
 * `endedWithUnfinishedWork` is read from that record rather than recomputed —
 * `finish()` (`runtimes/runs.ts`) derives it once at the terminal choke point
 * through the canonical `todoSnapshotHasUnfinishedWork` predicate and stamps it
 * onto the `end` event, so reading it back is the only way to stay in lockstep
 * with the chat footer and the project pill (#1247 / #1060).
 *
 * `endedAt` comes from the record's own `timestamp`, which `emit()` stamps on
 * every event it writes. That is the run's terminal clock as the run itself
 * recorded it, so it stays true however long afterwards this is read.
 */
function runTerminalRecord(records: readonly RunEventRecord[]): RunTerminalRecord | null {
  let terminal: RunTerminalRecord | null = null;
  for (const record of records) {
    if (record?.event !== 'end') continue;
    const data = isRecord(record.data) ? record.data : {};
    terminal = {
      status: typeof data.status === 'string' ? data.status : null,
      endedWithUnfinishedWork: data.endedWithUnfinishedWork === true,
      endedAt: Number.isFinite(record.timestamp) ? (record.timestamp as number) : null,
    };
  }
  return terminal;
}

/** A live artifact the run created or refreshed. Mirrors the web's
 *  `hasLiveArtifactDelivery`: a deletion is not a delivery, and only a
 *  succeeded refresh counts. */
function hasLiveArtifactDelivery(records: readonly RunEventLike[]): boolean {
  return records.some((record) => {
    const data = isRecord(record?.data) ? record.data : null;
    const type = record?.event === 'live_artifact' ? 'live_artifact' : data?.type;
    if (type === 'live_artifact') return data?.action !== 'deleted';
    if (type === 'live_artifact_refresh') return data?.phase === 'succeeded';
    return false;
  });
}

/** A write or edit tool call, successful or not. `WRITE_OR_EDIT_TOOL_NAMES`
 *  carries the same membership as the web's write/edit classification in
 *  `apps/web/src/runtime/file-ops.ts`. */
function attemptedFileWrite(records: readonly RunEventLike[]): boolean {
  return records.some((record) => {
    if (record?.event !== 'agent') return false;
    const data = isRecord(record.data) ? record.data : null;
    if (data?.type !== 'tool_use') return false;
    return typeof data.name === 'string' && WRITE_OR_EDIT_TOOL_NAMES.has(data.name);
  });
}

/** The run's last declared task list still carries unfinished work. Falls back
 *  to the log when the terminal record predates the stamped flag. */
function hasUnfinishedTodos(
  records: readonly RunEventLike[],
  terminal: RunTerminalRecord,
): boolean {
  if (terminal.endedWithUnfinishedWork) return true;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record?.event !== 'agent') continue;
    const data = isRecord(record.data) ? record.data : null;
    if (data?.type !== 'tool_use' || !isTodoWriteToolName(data.name)) continue;
    return todoSnapshotHasUnfinishedWork(todoItemsFromTodoWriteInput(data.input));
  }
  return false;
}

/**
 * The project files this run handed the user.
 *
 * The daemon has no pre-turn file-name snapshot to diff against — that snapshot
 * is taken by the chat client, and an unattended turn has no client — so
 * delivery is judged the way the daemon already judges run authorship
 * elsewhere: a project file whose mtime falls inside the run's window was
 * written by the run (`isRunTouchedProjectFile`, `apps/daemon/src/projects.ts`,
 * used by the run-end artifact-manifest reconciliation). That covers every file
 * signal the client computes separately — files that appeared, files rewritten
 * in place through `cp` / `magick` / `ffmpeg`, and touched trace objects —
 * because all three end as a project file written during the turn.
 *
 * The mtime window is coarser than a name diff: it also catches a file written
 * in the second either side of the run's own boundaries (the grace the shared
 * predicate allows). Over-reporting a neighbouring write by that second is the
 * safe direction — under-reporting is what leaves the user with a delivered
 * turn recorded as empty.
 *
 * The window is the run's INTERVAL, not everything after its start. Reading the
 * tree at the run's terminal, the two are the same; reading it later — the
 * startup replay deciding a backlog row — they are not, and a lower bound alone
 * would hand this run every file written by every turn that came after it.
 */
export function producedFilesForRun(
  files: readonly ProjectFile[],
  interval: RunInterval,
  isRunTouched: (fileMtimeMs: number, runStartTimeMs: number, runEndTimeMs: number) => boolean,
): ProjectFile[] {
  return files.filter(
    (file) =>
      file.type !== 'dir' &&
      isImplicitProducedFileCandidate(file) &&
      isRunTouched(file.mtime, interval.startedAt, interval.endedAt),
  );
}

/**
 * The daemon half of the shared delivery decision: reduce the run's own durable
 * event log, artifact writes and preview servers to the evidence
 * `resolveDesignDeliveryOutcomeFromEvidence` reads.
 *
 * `persistenceSucceeded` / `persistenceFailed` are always false. They describe
 * the chat client saving a turn's inline `<artifact>` block into the project,
 * which is the client's own step — and this classification only ever runs when
 * no client took it. A turn whose only deliverable was an unsaved inline
 * artifact therefore reads as `report_only`, not as a delivery failure the user
 * never saw.
 */
export function deliveryEvidenceForRun(args: {
  content: string;
  files: readonly ProjectFile[];
  previewStarted: boolean;
  records: readonly RunEventLike[];
  runInterval: RunInterval;
  sessionMode: ChatSessionMode | null | undefined;
  terminal: RunTerminalRecord;
  isRunTouched: (fileMtimeMs: number, runStartTimeMs: number, runEndTimeMs: number) => boolean;
}): DesignDeliveryEvidence {
  return {
    sessionMode: args.sessionMode,
    runStatus: args.terminal.status as DesignDeliveryEvidence['runStatus'],
    content: args.content,
    hasUnfinishedTodos: hasUnfinishedTodos(args.records, args.terminal),
    deliveredFileCount: producedFilesForRun(args.files, args.runInterval, args.isRunTouched).length,
    hasLiveArtifactDelivery: hasLiveArtifactDelivery(args.records),
    hasPreviewServerStart: args.previewStarted,
    persistenceSucceeded: false,
    persistenceFailed: false,
    attemptedFileWrite: attemptedFileWrite(args.records),
  };
}

/** Only these three outcomes are a recorded delivery state; the rest are
 *  intermediate and stay unset, exactly as `applyDesignDeliveryOutcome`
 *  (`apps/web/src/components/ProjectView.tsx`) leaves them. */
function storableDeliveryState(outcome: DesignDeliveryOutcome): string | null {
  return outcome === 'delivered' || outcome === 'no_result' || outcome === 'delivery_failed'
    ? outcome
    : null;
}

/**
 * A succeeded design turn records its delivery classification and its file list
 * whether or not a web client was watching it.
 *
 * The classifier used to live only in the chat client, so a turn that finished
 * while nobody had the project open was never classified at all: the daemon
 * stored whatever the client sent it, and an absent client sends nothing. The
 * row kept a NULL `result_delivery_state` and a NULL `produced_files_json`
 * forever, and the chat showed the turn stuck in its `verifying` phase
 * (`apps/web/src/runtime/preview-run-status.ts`).
 *
 * This is the daemon's own answer to the same question, from the run's own
 * durable events and the project files the run wrote. It is deliberately the
 * SECOND writer, not the first: it runs one settle window after the run's
 * terminal event and only claims a row that still carries neither a delivery
 * state nor a file list, so an attached client's richer verdict — which knows
 * the pre-turn file names and the outcome of its own artifact save — always
 * wins, and a stale copy of a finished turn is never re-decided.
 *
 * Every write is inside one guard that reports rather than swallows: a failure
 * here must not take down the run's other terminal bookkeeping, and a silent
 * one would leave exactly the unclassified row this exists to prevent.
 *
 * Returns whether the row was classified.
 */
export async function classifyUnattendedRunDelivery(
  db: Database.Database,
  run: UnattendedDeliveryRun,
  deps: UnattendedDeliveryDeps,
  isRunTouched: (fileMtimeMs: number, runStartTimeMs: number, runEndTimeMs: number) => boolean,
): Promise<boolean> {
  if (!run.assistantMessageId || !run.projectId) return false;
  try {
    const row = db.prepare(
      `SELECT content AS content,
              produced_files_json AS producedFilesJson,
              result_delivery_state AS resultDeliveryState,
              session_mode AS sessionMode,
              trace_object_files_json AS traceObjectFilesJson
         FROM messages
        WHERE id = ? AND role = 'assistant' AND run_id = ?`,
    ).get(run.assistantMessageId, run.id) as AssistantRow | undefined;
    if (!row) return false;
    if (
      row.resultDeliveryState !== null
      || row.producedFilesJson !== null
      || row.traceObjectFilesJson !== null
    ) return false;

    const records = readRunEventRecords(deps.runsLogDir, run.id);
    const terminal = runTerminalRecord(records);
    if (!terminal || terminal.status !== 'succeeded') return false;
    // No terminal clock, no interval, and file attribution by lower bound alone
    // would hand this run every later turn's work. There is no truthful list to
    // store instead: the chat reads a succeeded design turn missing either list
    // as still verifying, so a verdict without one is not a verdict. Decline the
    // row on the same terms as one whose run log did not survive at all.
    if (terminal.endedAt === null) return false;
    const runInterval: RunInterval = { startedAt: run.startedAt, endedAt: terminal.endedAt };

    // The row's own session mode is what the chat renders against; the run's is
    // the fallback for a row a client never stamped.
    const sessionMode = (row.sessionMode ?? run.sessionMode) as ChatSessionMode | null;
    if (sessionMode !== 'design') return false;

    const files = await deps.listProjectFiles(run.projectId);
    // The stored answer when a client wrote one, otherwise the text the run
    // itself streamed — the same body the client would have classified on.
    const content = row.content && row.content.trim() !== ''
      ? row.content
      : reconstructAssistantText(records);
    const evidence = deliveryEvidenceForRun({
      content,
      files,
      previewStarted: deps.previewStartedDuringRun(run.projectId, run.startedAt),
      records,
      runInterval,
      sessionMode,
      terminal,
      isRunTouched,
    });
    const outcome = resolveDesignDeliveryOutcomeFromEvidence(evidence);
    // One file signal fills both columns. The client can tell a file that
    // APPEARED from one the run merely touched, because it holds the pre-turn
    // file names; the daemon has only the run's write window, so it records the
    // same set for both and assigns no `traceObjectReason` it cannot stand
    // behind. Leaving the trace column NULL is not an option: the chat treats a
    // succeeded design turn missing either list as still verifying
    // (`designDeliveryVerificationPending`, `apps/web/src/runtime/
    // design-delivery.ts`), which is the stuck state this classification exists
    // to clear.
    const produced = JSON.stringify(producedFilesForRun(files, runInterval, isRunTouched));
    return db.prepare(
      `UPDATE messages
          SET result_delivery_state = ?, produced_files_json = ?, trace_object_files_json = ?
        WHERE id = ?
          AND role = 'assistant'
          AND run_id = ?
          AND result_delivery_state IS NULL
          AND produced_files_json IS NULL
          AND trace_object_files_json IS NULL`,
    ).run(
      storableDeliveryState(outcome),
      produced,
      produced,
      run.assistantMessageId,
      run.id,
    ).changes > 0;
  } catch (err) {
    console.warn('[runs] unattended delivery classification failed', err);
    return false;
  }
}

/**
 * How many still-unclassified turns one startup replay will consider, newest
 * first. Each candidate costs one event-log read and one project-file listing,
 * so the pass is bounded rather than proportional to the whole message history;
 * newest first because those are the turns a user can still have on screen.
 */
const DELIVERY_REPLAY_SCAN_LIMIT = 500;

/** A succeeded design turn the daemon has no delivery verdict for. */
interface UnclassifiedDeliveryRow {
  assistantMessageId: string;
  conversationId: string | null;
  createdAt: number;
  projectId: string | null;
  runId: string;
  sessionMode: string | null;
  startedAt: number | null;
}

export interface DeliveryClassificationReplayResult {
  candidates: number;
  classified: number;
}

/**
 * Invariant: a succeeded design turn ends with a recorded delivery verdict even
 * when the daemon that ran it exited before it could write one.
 *
 * `scheduleUnattendedDeliveryClassification` (`apps/daemon/src/server.ts`) holds
 * the daemon's verdict in an unref'd timer for one client-finalize settle
 * window, so an attached client always writes first and a pending timer never
 * holds the daemon open. Both are deliberate, and together they leave a window
 * after every successful turn in which the verdict exists nowhere but in
 * memory. A daemon exit inside it used to lose the verdict permanently: the row
 * kept a NULL `result_delivery_state` and NULL file lists, which the chat reads
 * as still verifying (`designDeliveryVerificationPending`,
 * `apps/web/src/runtime/design-delivery.ts`).
 *
 * Nothing extra has to be persisted at the run's terminal to make that
 * replayable. `classifyUnattendedRunDelivery` already decides from durable
 * state alone -- the run's own `events.jsonl`, the assistant row, and the
 * project's files -- so startup simply asks it again for every row that still
 * carries no verdict. Asking the same function is what keeps the decision in
 * one place: a replay cannot reach an answer the timer would not have reached.
 * Its claim guard is what makes the replay safe: it writes only a row with a
 * NULL delivery state and NULL file lists, so the pass is idempotent and can
 * never overwrite a verdict a client already wrote.
 *
 * Run this AFTER `reconcileDurableRunTerminals`: that pass repairs an assistant
 * row still stamped `running` by the process that died, using the durable run
 * state, and this pass reads the repaired status to find succeeded turns.
 *
 * What a replay must not borrow from the timer is the timer's sense of "now".
 * The timer reads the project tree seconds after the run ended, so a run's
 * interval and the tree's state coincide; a replay may read it days later, over
 * a backlog, with every later turn's files present. Attribution is therefore
 * bounded by the run's own interval — its start and the terminal clock on its
 * `end` record — and a row whose terminal record carries no clock is declined
 * rather than attributed by lower bound alone.
 *
 * A row whose `session_mode` is not `design` is skipped in SQL rather than
 * handed to the classifier, which would decline it anyway. The run's own
 * session mode is not a fallback here the way it is for the timer: the timer
 * holds the live run object, while a replay has only the durable record, and
 * `state.json` does not carry the session mode.
 */
export async function replayUnattendedDeliveryClassifications(
  db: Database.Database,
  deps: UnattendedDeliveryDeps,
  isRunTouched: (fileMtimeMs: number, runStartTimeMs: number, runEndTimeMs: number) => boolean,
): Promise<DeliveryClassificationReplayResult> {
  const result: DeliveryClassificationReplayResult = { candidates: 0, classified: 0 };
  let rows: UnclassifiedDeliveryRow[];
  try {
    rows = db.prepare(
      `SELECT m.id AS assistantMessageId,
              m.run_id AS runId,
              m.conversation_id AS conversationId,
              c.project_id AS projectId,
              m.session_mode AS sessionMode,
              m.started_at AS startedAt,
              m.created_at AS createdAt
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE m.role = 'assistant'
          AND m.run_id IS NOT NULL
          AND m.run_status = 'succeeded'
          AND m.session_mode = 'design'
          AND m.result_delivery_state IS NULL
          AND m.produced_files_json IS NULL
          AND m.trace_object_files_json IS NULL
        ORDER BY m.created_at DESC
        LIMIT ?`,
    ).all(DELIVERY_REPLAY_SCAN_LIMIT) as UnclassifiedDeliveryRow[];
  } catch (err) {
    console.warn('[runs] unattended delivery classification replay failed', err);
    return result;
  }
  result.candidates = rows.length;
  for (const row of rows) {
    const classified = await classifyUnattendedRunDelivery(
      db,
      {
        assistantMessageId: row.assistantMessageId,
        conversationId: row.conversationId,
        id: row.runId,
        projectId: row.projectId,
        sessionMode: row.sessionMode as ChatSessionMode | null,
        // The run's own start, as `pinAssistantMessageOnRunCreate` stamped it
        // (`apps/daemon/src/runtimes/chat-run-messages.ts`), which is the same
        // `run.createdAt` the timer passes. The row's creation time is the
        // fallback for a row written before that stamp existed.
        startedAt: typeof row.startedAt === 'number' ? row.startedAt : row.createdAt,
      },
      deps,
      isRunTouched,
    );
    if (classified) result.classified += 1;
  }
  return result;
}
