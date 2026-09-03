import type { ChatMessage } from '../types';
import type { RunFailureCategory, RunFailureDetail, RunFailureStage } from '@open-design/contracts';

export interface RunFailureClassificationFields {
  failureCategory?: RunFailureCategory | null;
  failureDetail?: RunFailureDetail | null;
  failureStage?: RunFailureStage | null;
  artifactCount?: number | null;
}

/** Read the daemon failure classification the streaming layer stamped onto a
 *  surfaced run error (see markErrorRunFailure in providers/daemon.ts) — the
 *  cause, the step that stopped, and how many files the run changed. Returns
 *  undefined when no field is present so callers pass nothing through. */
export function runFailureFieldsFromError(
  err: unknown,
): RunFailureClassificationFields | undefined {
  const e = err as {
    failureCategory?: RunFailureCategory | null;
    failureDetail?: RunFailureDetail | null;
    failureStage?: RunFailureStage | null;
    artifactCount?: number | null;
  } | null;
  const artifactCount = typeof e?.artifactCount === 'number' ? e.artifactCount : null;
  if (!e || (!e.failureCategory && !e.failureDetail && !e.failureStage && artifactCount === null)) {
    return undefined;
  }
  return {
    ...(e.failureCategory ? { failureCategory: e.failureCategory } : {}),
    ...(e.failureDetail ? { failureDetail: e.failureDetail } : {}),
    ...(e.failureStage ? { failureStage: e.failureStage } : {}),
    ...(artifactCount === null ? {} : { artifactCount }),
  };
}

export function appendErrorStatusEvent(
  message: ChatMessage,
  detail: string,
  code?: string,
  failure?: RunFailureClassificationFields,
): ChatMessage {
  if (!detail.trim()) return message;
  const events = message.events ?? [];
  const lastIndex = events.length - 1;
  const last = events[lastIndex];
  if (last?.kind === 'status' && last.label === 'error' && last.detail === detail) {
    // The same terminal error is already recorded, but a later pass can bring
    // the finalize-time classification the first pass lacked — e.g. a reload
    // reads the daemon-persisted `error` frame, then the run finishes and
    // `onError` fires with `code` / `failureCategory` / `failureDetail`
    // attached. Merge those into the existing event instead of dropping them,
    // so the specific quota / CLI / long-tail card survives; no-op only when
    // the new pass adds nothing.
    const merged = {
      ...last,
      ...(code ? { code } : {}),
      ...(failure?.failureCategory ? { failureCategory: failure.failureCategory } : {}),
      ...(failure?.failureDetail ? { failureDetail: failure.failureDetail } : {}),
      ...(failure?.failureStage ? { failureStage: failure.failureStage } : {}),
      ...(typeof failure?.artifactCount === 'number'
        ? { artifactCount: failure.artifactCount }
        : {}),
    };
    if (JSON.stringify(merged) === JSON.stringify(last)) return message;
    const nextEvents = events.slice();
    nextEvents[lastIndex] = merged;
    return { ...message, events: nextEvents };
  }
  return {
    ...message,
    events: [
      ...events,
      {
        kind: 'status',
        label: 'error',
        detail,
        ...(code ? { code } : {}),
        ...(failure?.failureCategory ? { failureCategory: failure.failureCategory } : {}),
        ...(failure?.failureDetail ? { failureDetail: failure.failureDetail } : {}),
        ...(failure?.failureStage ? { failureStage: failure.failureStage } : {}),
        ...(typeof failure?.artifactCount === 'number'
          ? { artifactCount: failure.artifactCount }
          : {}),
      },
    ],
  };
}

export function removeErrorStatusEvent(
  message: ChatMessage,
  detail: string,
  code?: string,
): ChatMessage {
  if (!detail) return message;
  const events = message.events ?? [];
  const nextEvents = events.filter((event) => {
    if (event.kind !== 'status' || event.label !== 'error') return true;
    if (event.detail !== detail) return true;
    if (code !== undefined && event.code !== code) return true;
    return false;
  });
  if (nextEvents.length === events.length) return message;
  return {
    ...message,
    events: nextEvents,
  };
}
