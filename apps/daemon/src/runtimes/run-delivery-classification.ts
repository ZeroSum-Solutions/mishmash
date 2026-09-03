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

/**
 * How long the daemon waits after a run's terminal event before deciding that
 * no web client is going to classify the turn.
 *
 * The same question the daemon's Langfuse terminal fallback already asks —
 * "did the attached client ever finalize this turn?" — so it waits the same
 * window (`LANGFUSE_TERMINAL_FALLBACK_DELAY_MS`, `apps/daemon/src/server.ts`).
 * An attached client finalizes within a second or two of the run ending, after
 * its own project-file refresh and artifact save; waiting past that is what
 * keeps the daemon from recording a verdict the client is about to improve on.
 */
export const UNATTENDED_DELIVERY_SETTLE_MS = 15_000;

/** The run's persisted `end` record, as `events.jsonl` stores it. */
interface RunTerminalRecord {
  status: string | null;
  endedWithUnfinishedWork: boolean;
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
): Array<{ event: string; data: unknown }> {
  let lines: string[];
  try {
    lines = fs.readFileSync(path.join(runsLogDir, runId, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
  const records: Array<{ event: string; data: unknown }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    let value: unknown;
    try {
      value = JSON.parse(lines[index] as string) as unknown;
    } catch {
      if (index === lines.length - 1) break;
      return [];
    }
    if (isRecord(value) && typeof value.event === 'string') {
      records.push({ event: value.event, data: value.data });
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
 */
function runTerminalRecord(records: readonly RunEventLike[]): RunTerminalRecord | null {
  let terminal: RunTerminalRecord | null = null;
  for (const record of records) {
    if (record?.event !== 'end') continue;
    const data = isRecord(record.data) ? record.data : {};
    terminal = {
      status: typeof data.status === 'string' ? data.status : null,
      endedWithUnfinishedWork: data.endedWithUnfinishedWork === true,
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
 * The mtime window is coarser than a name diff: it can also catch a file
 * written in the second before the run's recorded start (the grace the shared
 * predicate allows). Over-reporting a neighbouring write is the safe direction
 * here — under-reporting is what leaves the user with a delivered turn recorded
 * as empty.
 */
export function producedFilesForRun(
  files: readonly ProjectFile[],
  runStartedAt: number,
  isRunTouched: (fileMtimeMs: number, runStartTimeMs: number) => boolean,
): ProjectFile[] {
  return files.filter(
    (file) =>
      file.type !== 'dir' &&
      isImplicitProducedFileCandidate(file) &&
      isRunTouched(file.mtime, runStartedAt),
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
  runStartedAt: number;
  sessionMode: ChatSessionMode | null | undefined;
  terminal: RunTerminalRecord;
  isRunTouched: (fileMtimeMs: number, runStartTimeMs: number) => boolean;
}): DesignDeliveryEvidence {
  return {
    sessionMode: args.sessionMode,
    runStatus: args.terminal.status as DesignDeliveryEvidence['runStatus'],
    content: args.content,
    hasUnfinishedTodos: hasUnfinishedTodos(args.records, args.terminal),
    deliveredFileCount: producedFilesForRun(args.files, args.runStartedAt, args.isRunTouched).length,
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
  isRunTouched: (fileMtimeMs: number, runStartTimeMs: number) => boolean,
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
      runStartedAt: run.startedAt,
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
    const produced = JSON.stringify(producedFilesForRun(files, run.startedAt, isRunTouched));
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
