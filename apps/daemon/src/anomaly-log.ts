// Local anomaly log — an append-only JSONL file of things the product got
// wrong, readable after the fact by a person or an agent.
//
// Why on disk and not through analytics: `analytics.ts` is a no-op without a
// build-time POSTHOG_KEY, so during ordinary local use every anomaly the
// observability probes already detected was discarded. This file is the sink
// those probes needed.
//
// Data-directory contract: the log path descends from the data root handed in
// by the caller (the daemon's resolved RUNTIME_DATA_DIR). This module never
// reads `process.env.OD_DATA_DIR` and never falls back to cwd.

import { readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

import {
  type AnomalyRecord,
  type AnomalySource,
  type ListAnomaliesQuery,
  type ReportAnomalyRequest,
  isAnomalyKind,
  isAnomalySeverity,
} from '@open-design/contracts';

import {
  createFilesystemWriteGateway,
  type FilesystemWriteCapability,
} from './filesystem/write-gateway.js';
import { redactSecrets } from './redact.js';

/**
 * Rotate past this size. Large enough to hold a long testing session, small
 * enough that reading the whole file to list records stays cheap — the read
 * path parses every line, so an unbounded log would make `list` progressively
 * slower exactly as it became more useful.
 */
export const ANOMALY_LOG_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Per-record ceiling on the serialised `detail` object. One pathological
 * payload (a whole DOM dump, a base64 image) must not crowd out the hundreds of
 * ordinary records around it.
 */
const MAX_DETAIL_BYTES = 4 * 1024;

/** Summaries are meant to be one skimmable line. */
const MAX_SUMMARY_CHARS = 500;

export interface AnomalyLogOptions {
  /**
   * The daemon's resolved data root. Required — there is deliberately no
   * default, so a caller cannot accidentally write the log outside the data
   * directory the daemon actually resolved.
   */
  dataDir: string;
  /**
   * Gateway factory used to mint the write capability. Pass the daemon's
   * audit-wrapped factory so this log's writes appear in the same audit stream
   * as every other daemon write; the default is the plain factory, which still
   * enforces containment under `dataDir`.
   */
  createGateway?: typeof createFilesystemWriteGateway;
}

export interface AnomalyLog {
  /** Absolute path of the current log file. */
  readonly path: string;
  /** Appends one record and returns its id. Never throws. */
  append(input: ReportAnomalyRequest, source: AnomalySource): Promise<string>;
  /**
   * Reads records newest-first, with the matched total alongside the page and
   * the retained sequence range beside both.
   *
   * The range and the generation count describe the LOG, not the page: they are
   * what lets a reader polling over a long window tell a quiet log from one that
   * rotated between two reads.
   */
  list(query: ListAnomaliesQuery): Promise<{
    anomalies: AnomalyRecord[];
    total: number;
    path: string;
    firstSeq: number | null;
    lastSeq: number | null;
    generations: number;
  }>;
  /** Discards every record, returning how many went away. */
  clear(): Promise<number>;
}

/**
 * Bounds `detail` for storage. Oversized values are replaced by a marker rather
 * than silently dropped, so a reader can tell "no detail was captured" from
 * "the detail was too big to keep".
 *
 * Bounding only — redaction is `redactRecord`'s job, applied once to the whole
 * record on the way to disk so there is a single place responsible for it.
 */
function boundDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (detail == null || typeof detail !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  let budget = MAX_DETAIL_BYTES;
  for (const [key, value] of Object.entries(detail)) {
    if (budget <= 0) {
      out['_truncated'] = true;
      break;
    }
    let serialised: string;
    try {
      serialised = typeof value === 'string' ? value : JSON.stringify(value) ?? 'null';
    } catch {
      // Circular or otherwise unserialisable: name the problem instead of
      // failing the whole append.
      out[key] = '[unserialisable]';
      continue;
    }
    if (serialised.length > budget) {
      out[key] = `${serialised.slice(0, Math.max(0, budget))}…[truncated]`;
      out['_truncated'] = true;
      break;
    }
    budget -= serialised.length;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Redacts a record's free-text surfaces on the way to disk. The log is written
 * during ordinary use and later read by an agent or attached to a diagnostics
 * bundle, so it must not become a place secrets accumulate. Non-string values
 * in `detail` are re-serialised through JSON so a nested string is covered too.
 */
function redactRecord(record: AnomalyRecord): AnomalyRecord {
  const detail = record.detail;
  let redactedDetail: Record<string, unknown> | undefined;
  if (detail != null) {
    try {
      redactedDetail = JSON.parse(redactSecrets(JSON.stringify(detail))) as Record<string, unknown>;
    } catch {
      redactedDetail = { _unreadable: true };
    }
  }
  return {
    ...record,
    summary: redactSecrets(record.summary),
    ...(redactedDetail ? { detail: redactedDetail } : {}),
  };
}

/** One stored line, or null when it is blank, torn, or not a record at all. */
function parseRecordLine(line: string): AnomalyRecord | null {
  if (line.trim() === '') return null;
  let parsed: AnomalyRecord;
  try {
    parsed = JSON.parse(line) as AnomalyRecord;
  } catch {
    // A truncated tail (killed process, full disk) must not make every earlier
    // record unreadable.
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.at !== 'string') return null;
  return parsed;
}

/** A record's stored sequence, or null when it predates the sequence. */
function storedSequence(record: AnomalyRecord): number | null {
  return typeof record.seq === 'number' && Number.isFinite(record.seq) ? record.seq : null;
}

/** Reads a log generation, or null when that generation does not exist. */
async function readGeneration(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

function matchesQuery(record: AnomalyRecord, query: ListAnomaliesQuery): boolean {
  if (query.kind != null && record.kind !== query.kind) return false;
  if (query.severity != null && record.severity !== query.severity) return false;
  if (query.since != null) {
    const floor = Date.parse(query.since);
    if (Number.isFinite(floor) && Date.parse(record.at) < floor) return false;
  }
  return true;
}

export function createAnomalyLog(options: AnomalyLogOptions): AnomalyLog {
  const path = join(options.dataDir, 'anomalies', 'anomalies.jsonl');
  const retainedPath = `${path}.1`;

  // Every mutation goes through the filesystem write gateway rather than
  // `node:fs` directly, so the log is subject to the same containment and audit
  // rules as the rest of the daemon's writes. Minted lazily and cached: minting
  // canonicalises paths on disk, which a pure read (`list`, or the diagnostics
  // bundle asking only for `path`) has no reason to pay for.
  const gateway = (options.createGateway ?? createFilesystemWriteGateway)({
    runtimeDataRoot: options.dataDir,
  });
  let capabilityPromise: Promise<FilesystemWriteCapability> | null = null;
  function writeCapability(): Promise<FilesystemWriteCapability> {
    capabilityPromise ??= gateway.runtimeData();
    return capabilityPromise;
  }

  // Appends are serialised through this chain. `appendFile` on its own is not
  // atomic across concurrent callers, and a torn line is a record nobody can
  // read back — the one failure mode that would make the log untrustworthy.
  let writeChain: Promise<unknown> = Promise.resolve();
  function serialise<T>(work: () => Promise<T>): Promise<T> {
    const next = writeChain.then(work, work);
    // Keep the chain alive after a rejection so one failed write does not wedge
    // every later append.
    writeChain = next.catch(() => undefined);
    return next;
  }

  async function rotateIfNeeded(capability: FilesystemWriteCapability): Promise<void> {
    try {
      const info = await stat(path);
      if (info.size < ANOMALY_LOG_MAX_BYTES) return;
    } catch {
      return; // no file yet — nothing to rotate
    }
    // Keep exactly one previous generation. Rotating rather than truncating
    // means a rotation mid-session does not destroy what was already caught.
    await gateway.rename(capability, path, retainedPath).catch(() => undefined);
  }

  /**
   * Reads the log's whole retained history, oldest generation first.
   *
   * The invariant: a read returns every record the log still holds, not every
   * record in one file. Rotation moves records into the retained generation
   * rather than deleting them, so a reader that opened only the current file
   * would report a smaller answer with nothing in it to say records had moved —
   * data loss that looks exactly like a quiet log. `generations` says how many
   * files the answer came from, which is how a rotation becomes visible to the
   * caller rather than only to whoever reads the directory.
   */
  async function readRetainedHistory(): Promise<{ records: AnomalyRecord[]; generations: number }> {
    const contents = await Promise.all([readGeneration(retainedPath), readGeneration(path)]);
    const records: AnomalyRecord[] = [];
    let generations = 0;
    for (const generation of contents) {
      if (generation == null) continue;
      generations += 1;
      for (const line of generation.split('\n')) {
        const record = parseRecordLine(line);
        if (record != null) records.push(record);
      }
    }
    return { records, generations };
  }

  /**
   * Hands out the next sequence, recovered from disk on first use.
   *
   * What must hold: every appended record carries a number one higher than the
   * record appended before it, for the life of the log and across daemon
   * restarts. A counter that restarted at one after a restart would read to a
   * poller as a rotation that took everything, so the starting point is taken
   * from what is already stored rather than assumed. A number is consumed even
   * if the write that follows fails; the range a reader reconciles against is
   * computed from what is actually on disk, so a burnt number is invisible.
   */
  let nextSequence: number | null = null;
  async function reserveSequence(): Promise<number> {
    nextSequence ??= (await highestStoredSequence()) + 1;
    const reserved = nextSequence;
    nextSequence += 1;
    return reserved;
  }

  /** The highest sequence still on disk, or 0 for a log that has never held one. */
  async function highestStoredSequence(): Promise<number> {
    for (const file of [path, retainedPath]) {
      const generation = await readGeneration(file);
      if (generation == null) continue;
      const lines = generation.split('\n');
      // Records are appended in order, so the last sequenced line of the newest
      // generation carries the highest number; reading from the end keeps a
      // full-size log from being parsed line by line on the first append.
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const record = parseRecordLine(lines[index] ?? '');
        const sequence = record == null ? null : storedSequence(record);
        if (sequence != null) return sequence;
      }
    }
    return 0;
  }

  return {
    path,

    async append(input, source) {
      const record: AnomalyRecord = {
        id: randomUUID(),
        at: new Date().toISOString(),
        // Falls back rather than throwing: `append` is called with `void` from
        // the HTTP observer, so a throw here would surface as an unhandled
        // rejection. The route validates first, so reaching the fallback means a
        // caller went around the contract — which the kind then records.
        kind: isAnomalyKind(input.kind) ? input.kind : 'unhandled-error',
        severity: isAnomalySeverity(input.severity) ? input.severity : 'warn',
        source,
        summary: String(input.summary ?? '').slice(0, MAX_SUMMARY_CHARS),
        ...(input.projectId ? { projectId: String(input.projectId).slice(0, 200) } : {}),
        ...(input.runId ? { runId: String(input.runId).slice(0, 200) } : {}),
        ...(() => {
          const detail = boundDetail(input.detail);
          return detail ? { detail } : {};
        })(),
      };
      await serialise(async () => {
        // Numbered inside the serialised chain, so the order records are written
        // in is the order they are numbered in. `at` stays the moment the caller
        // observed the anomaly, not the moment the queue reached it.
        const sequenced: AnomalyRecord = { ...record, seq: await reserveSequence() };
        const line = `${JSON.stringify(redactRecord(sequenced))}\n`;
        try {
          const capability = await writeCapability();
          await gateway.mkdir(capability, dirname(path), { recursive: true });
          await rotateIfNeeded(capability);
          await gateway.appendFile(capability, path, line, 'utf8');
        } catch (err) {
          // The anomaly log must never become a source of anomalies. A failed
          // write is reported to the daemon console and dropped.
          console.warn('[anomaly-log] could not append:', err);
        }
      });
      return record.id;
    },

    async list(query) {
      const { records, generations } = await readRetainedHistory();
      const matched: AnomalyRecord[] = [];
      let firstSeq: number | null = null;
      let lastSeq: number | null = null;
      for (const record of records) {
        // Measured over every retained record, not over the matches: a filtered
        // read still has to tell its caller what the log could have shown it.
        const sequence = storedSequence(record);
        if (sequence != null) {
          if (firstSeq == null || sequence < firstSeq) firstSeq = sequence;
          if (lastSeq == null || sequence > lastSeq) lastSeq = sequence;
        }
        if (matchesQuery(record, query)) matched.push(record);
      }
      // Newest first: the most recent problem is what a reader wants first.
      matched.reverse();
      const limit = Number.isFinite(query.limit) && (query.limit ?? 0) > 0
        ? Math.floor(query.limit as number)
        : undefined;
      return {
        anomalies: limit == null ? matched : matched.slice(0, limit),
        total: matched.length,
        path,
        firstSeq,
        lastSeq,
        generations,
      };
    },

    async clear() {
      const { total } = await this.list({});
      await serialise(async () => {
        try {
          const capability = await writeCapability();
          await gateway.mkdir(capability, dirname(path), { recursive: true });
          await gateway.writeFile(capability, path, '', 'utf8');
          await gateway.rm(capability, retainedPath, { force: true });
        } catch (err) {
          console.warn('[anomaly-log] could not clear:', err);
        }
      });
      return total;
    },
  };
}
