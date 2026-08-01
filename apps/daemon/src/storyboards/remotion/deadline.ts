// Shared timeout budget for the whole Remotion finishing pass (goal-run C5,
// review finding T1). Without this, a stuck ffprobe/ffmpeg spawn, a stuck
// webpack bundle, or a stuck headless-Chrome render holds the assemble HTTP
// request open forever and can strand an expensive background process.
// ONE overall, env-tunable budget is created per finish call and threaded
// through every stage (audio probe/convert, whisper install/download/
// transcribe, bundle, selectComposition, renderMedia); each stage consumes
// from the same remaining-time pool rather than getting its own full budget.

const DEFAULT_MAX_MS = 15 * 60 * 1000; // 15 minutes
// Floor guard: a misconfigured near-zero OD_REMOTION_FINISH_MAX_MS would
// otherwise kill every real render before whisper.cpp's cold build (which
// alone can take 30-90s) ever gets a chance to finish.
const MIN_MAX_MS = 60 * 1000; // 1 minute

export class RemotionFinishTimeoutError extends Error {
  readonly code = 'REMOTION_FINISH_TIMEOUT';
  readonly stage: string;

  constructor(stage: string) {
    super(
      `Remotion finishing pass timed out during "${stage}" — the overall budget ` +
        `(see OD_REMOTION_FINISH_MAX_MS) was exceeded.`,
    );
    this.name = 'RemotionFinishTimeoutError';
    this.stage = stage;
  }
}

/** Reads OD_REMOTION_FINISH_MAX_MS, applying the default/floor for anything missing, non-numeric, or <= 0. */
export function getFinishMaxMs(): number {
  const raw = process.env.OD_REMOTION_FINISH_MAX_MS;
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_MS;
  return Math.max(MIN_MAX_MS, parsed);
}

export interface Deadline {
  /** Milliseconds remaining before the deadline, clamped to >= 0. */
  remainingMs(): number;
  /** Throws RemotionFinishTimeoutError(stage) if the deadline has already passed. */
  assertNotExpired(stage: string): void;
}

export function createDeadline(totalMs: number = getFinishMaxMs()): Deadline {
  const deadlineAt = Date.now() + Math.max(0, totalMs);
  return {
    remainingMs: () => Math.max(0, deadlineAt - Date.now()),
    assertNotExpired(stage: string) {
      if (Date.now() >= deadlineAt) throw new RemotionFinishTimeoutError(stage);
    },
  };
}

/**
 * Races `promise` against the deadline's remaining time, labeled with
 * `stage`. This alone does NOT cancel `promise` — it only stops THIS
 * function from waiting on it, so the HTTP request can't hang forever. Any
 * underlying process/render capable of real cancellation (a spawned child,
 * an AbortSignal-aware call, Remotion's cancelSignal) must still be wired to
 * the same deadline separately so it doesn't keep running in the
 * background after this rejects.
 */
export function withDeadline<T>(promise: Promise<T>, deadline: Deadline, stage: string): Promise<T> {
  deadline.assertNotExpired(stage);
  const remaining = deadline.remainingMs();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RemotionFinishTimeoutError(stage)), remaining);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
