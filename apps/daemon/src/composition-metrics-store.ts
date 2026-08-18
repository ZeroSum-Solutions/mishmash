// Local store for rendered composition-metrics reports (see
// `CompositionMetrics` in `@open-design/contracts` and
// `injectCompositionMetricsBridge` in `apps/web/src/runtime/srcdoc.ts` for
// what is measured and why it can only be measured in a browser).
//
// One JSON file mapping `${projectId}::${file}` to its latest reported
// measurement — a "current value" store, not a log: a page's composition
// doesn't have a history worth keeping, only a most-recent reading. Capped
// at MAX_ENTRIES, evicting the oldest report, so a long-running daemon that
// has previewed many projects doesn't grow this file without bound.
//
// Data-directory contract: the store path descends from the data root
// handed in by the caller (the daemon's resolved RUNTIME_DATA_DIR). This
// module never reads `process.env.OD_DATA_DIR` and never falls back to cwd.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { CompositionMetrics, CompositionMetricsRecord } from '@open-design/contracts';

import {
  createFilesystemWriteGateway,
  type FilesystemWriteCapability,
} from './filesystem/write-gateway.js';

/** Above this many distinct (project, file) keys, the oldest report is evicted. */
export const COMPOSITION_METRICS_MAX_ENTRIES = 500;

export interface CompositionMetricsStoreOptions {
  /**
   * The daemon's resolved data root. Required — there is deliberately no
   * default, so a caller cannot accidentally write the store outside the
   * data directory the daemon actually resolved.
   */
  dataDir: string;
  /**
   * Gateway factory used to mint the write capability. Pass the daemon's
   * audit-wrapped factory so this store's writes appear in the same audit
   * stream as every other daemon write.
   */
  createGateway?: typeof createFilesystemWriteGateway;
}

export interface CompositionMetricsStore {
  /** Absolute path of the store file. */
  readonly path: string;
  /**
   * Records a measurement for `(projectId, file)`. `isWebCloneRun` is
   * resolved by the caller (server-side, from the project's own metadata —
   * see `CompositionMetricsRecord`'s docblock) before this is called; the
   * store itself does not know about projects beyond their id.
   */
  set(
    projectId: string,
    file: string,
    metrics: CompositionMetrics,
    isWebCloneRun: boolean,
  ): Promise<CompositionMetricsRecord>;
  /** Returns the last reported measurement, or `null` if none exists yet. */
  get(projectId: string, file: string): Promise<CompositionMetricsRecord | null>;
}

function keyOf(projectId: string, file: string): string {
  return `${projectId}::${file}`;
}

async function readStore(path: string): Promise<Record<string, CompositionMetricsRecord>> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, CompositionMetricsRecord>;
    }
  } catch {
    // A truncated or corrupt file must not crash the daemon — start clean
    // rather than throw; the next successful `set` repairs it on disk.
  }
  return {};
}

export function createCompositionMetricsStore(
  options: CompositionMetricsStoreOptions,
): CompositionMetricsStore {
  const path = join(options.dataDir, 'composition-metrics', 'composition-metrics.json');

  const gateway = (options.createGateway ?? createFilesystemWriteGateway)({
    runtimeDataRoot: options.dataDir,
  });
  let capabilityPromise: Promise<FilesystemWriteCapability> | null = null;
  function writeCapability(): Promise<FilesystemWriteCapability> {
    capabilityPromise ??= gateway.runtimeData();
    return capabilityPromise;
  }

  // Serialise reads-before-write and writes against each other so two
  // concurrent reports (e.g. two preview tabs) never race a lost update.
  let chain: Promise<unknown> = Promise.resolve();
  function serialise<T>(work: () => Promise<T>): Promise<T> {
    const next = chain.then(work, work);
    chain = next.catch(() => undefined);
    return next;
  }

  return {
    path,

    async set(projectId, file, metrics, isWebCloneRun) {
      const record: CompositionMetricsRecord = {
        projectId,
        file,
        metrics,
        isWebCloneRun,
        reportedAt: new Date().toISOString(),
      };
      await serialise(async () => {
        try {
          const capability = await writeCapability();
          await gateway.mkdir(capability, dirname(path), { recursive: true });
          const store = await readStore(path);
          store[keyOf(projectId, file)] = record;
          const keys = Object.keys(store);
          if (keys.length > COMPOSITION_METRICS_MAX_ENTRIES) {
            const oldestFirst = keys.sort(
              (a, b) => Date.parse(store[a]!.reportedAt) - Date.parse(store[b]!.reportedAt),
            );
            for (const stale of oldestFirst.slice(0, keys.length - COMPOSITION_METRICS_MAX_ENTRIES)) {
              delete store[stale];
            }
          }
          await gateway.writeFile(capability, path, JSON.stringify(store), 'utf8');
        } catch (err) {
          // The store must never become a source of anomalies for the run
          // it's reporting on. A failed write is logged and the request
          // still succeeds from the caller's point of view is decided by
          // the route, not here — this function reports the error upward.
          console.warn('[composition-metrics-store] could not write:', err);
          throw err;
        }
      });
      return record;
    },

    async get(projectId, file) {
      const store = await readStore(path);
      return store[keyOf(projectId, file)] ?? null;
    },
  };
}
