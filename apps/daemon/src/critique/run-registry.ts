/**
 * In-process registry of in-flight critique runs. The daemon process is the
 * single owner of all critique state; the registry exists so the interrupt
 * endpoint can cascade an AbortController to the orchestrator that owns the
 * spawned CLI. The registry is intentionally NOT persisted: a daemon restart
 * mid-run is handled by reconcileStaleRuns on boot, not by recovering live
 * AbortControllers.
 *
 * All lookup operations require BOTH projectId and runId. The composite key
 * prevents a request to interrupt project p1's runId from accidentally
 * aborting project p2's run that happens to share the same id (defense in
 * depth on top of the HTTP handler's own DB-row projectId check).
 *
 * @see specs/current/critique-theater.md § Failure modes (interrupt)
 */

/** Handle for a single in-flight critique run. */
export interface RunHandle {
  runId: string;
  projectId: string;
  abort: AbortController;
  startedAt: number;
  /**
   * True while the slot is claimed but the child has not spawned yet. Set by
   * `reserve()`, cleared by `register()`. Diagnostics-only elsewhere.
   */
  reserved?: boolean;
}

/** Public surface of the in-process run registry. */
export interface RunRegistry {
  /**
   * Atomically claim one of the `maxConcurrentRuns` slots for a run that has
   * not spawned yet. Returns false when the registry is already at capacity.
   *
   * This exists because capacity has to be decided BEFORE the critique panel
   * addendum is composed into the prompt, not at spawn time. A run that is
   * told to emit <CRITIQUE_RUN> tags and then denied an orchestrator streams
   * raw protocol back to the user as assistant text; deciding first keeps the
   * prompt and the orchestrator in lockstep. A successful reservation is
   * upgraded in place by `register()` and freed by `unregister()` — callers
   * must release on every termination path or the slot leaks for the life of
   * the daemon.
   */
  reserve(projectId: string, runId: string): boolean;

  /**
   * Register a new in-flight handle. Upgrades a reservation made by
   * `reserve()` for the same (projectId, runId) in place, so a reserved run
   * does not consume two slots. Throws if a LIVE handle for the same pair is
   * already registered (indicates a bug in the caller, not a user error).
   */
  register(handle: RunHandle): void;

  /**
   * Returns the handle if the (projectId, runId) pair is registered; null
   * otherwise. A runId from a different project will not match.
   */
  get(projectId: string, runId: string): RunHandle | null;

  /**
   * Signals the AbortController for the given (projectId, runId).
   * Returns true if the pair was found and aborted; false otherwise. A
   * runId-only match against a different project does NOT abort.
   */
  interrupt(projectId: string, runId: string, reason?: string): boolean;

  /**
   * Removes the entry for the given (projectId, runId). Called by the server
   * after the orchestrator settles. No-op if the pair is not registered.
   */
  unregister(projectId: string, runId: string): void;

  /**
   * Snapshot for diagnostics only. Returns a defensive copy so callers cannot
   * mutate the registry's internal state.
   */
  list(): RunHandle[];
}

/**
 * Builds the internal composite key for a (projectId, runId) pair. Pipe is
 * not a legal character in either projectId or runId per the daemon's id
 * generation rules, so collisions across pairs are impossible.
 */
function compositeKey(projectId: string, runId: string): string {
  return `${projectId}|${runId}`;
}

/**
 * Creates an in-memory RunRegistry backed by a Map.
 * Node is single-threaded; no locking is needed.
 *
 * @see specs/current/critique-theater.md § interrupt endpoint (Task 6.1)
 */
export function createRunRegistry(maxConcurrentRuns: number = Infinity): RunRegistry {
  const store = new Map<string, RunHandle>();

  return {
    reserve(projectId: string, runId: string): boolean {
      const key = compositeKey(projectId, runId);
      // Re-reserving the same pair is a no-op success rather than a second
      // slot, so a retried compose cannot consume capacity twice.
      if (store.has(key)) return true;
      if (store.size >= maxConcurrentRuns) return false;
      store.set(key, {
        runId,
        projectId,
        abort: new AbortController(),
        startedAt: Date.now(),
        reserved: true,
      });
      return true;
    },

    register(handle: RunHandle): void {
      const key = compositeKey(handle.projectId, handle.runId);
      const existing = store.get(key);
      if (existing !== undefined) {
        if (!existing.reserved) {
          throw new Error(
            `RunRegistry: duplicate (projectId="${handle.projectId}", runId="${handle.runId}"); unregister before re-registering`,
          );
        }
        // Upgrade the reservation in place — the slot is already counted.
        // An interrupt that landed during the reservation window aborted the
        // placeholder controller; carry that decision onto the real one so a
        // cancel issued microseconds before spawn is not silently dropped.
        if (existing.abort.signal.aborted) {
          handle.abort.abort(existing.abort.signal.reason);
        }
        store.set(key, { ...handle, reserved: false });
        return;
      }
      // Backstop for callers that register without reserving first.
      if (store.size >= maxConcurrentRuns) {
        throw new Error(
          `RunRegistry: at capacity (max=${maxConcurrentRuns}, active=${store.size}); cannot register (projectId="${handle.projectId}", runId="${handle.runId}")`,
        );
      }
      store.set(key, { ...handle, reserved: false });
    },

    get(projectId: string, runId: string): RunHandle | null {
      return store.get(compositeKey(projectId, runId)) ?? null;
    },

    interrupt(projectId: string, runId: string, reason?: string): boolean {
      const handle = store.get(compositeKey(projectId, runId));
      if (handle === undefined) return false;
      handle.abort.abort(reason);
      return true;
    },

    unregister(projectId: string, runId: string): void {
      store.delete(compositeKey(projectId, runId));
    },

    list(): RunHandle[] {
      return [...store.values()];
    },
  };
}
