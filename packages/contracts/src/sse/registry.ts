import type { AgentInfo } from '../api/registry.js';
import type { SseTransportEvent } from './common.js';

/**
 * Payload of the terminal `error` frame on `GET /api/agents?stream=1`.
 *
 * The daemon writes `JSON.stringify({ error: String(err) })`, so this is a
 * single flat string rather than the richer `SseErrorPayload` used by the chat
 * and proxy streams. Typed as the daemon actually emits it; do not widen it
 * here without changing the emitter in the same change.
 */
export interface AgentRegistryStreamErrorPayload {
  error: string;
}

/** Payload of the terminal `done` frame: an empty object, carrying no data. */
export type AgentRegistryStreamDonePayload = Record<string, never>;

/**
 * Frames of the agent-registry SSE stream, in the order a healthy stream emits
 * them: zero or more `agent` frames as each probe settles, then exactly one
 * terminal frame — `done` on success, `error` on failure.
 */
export type AgentRegistrySseEvent =
  | SseTransportEvent<'agent', AgentInfo>
  | SseTransportEvent<'done', AgentRegistryStreamDonePayload>
  | SseTransportEvent<'error', AgentRegistryStreamErrorPayload>;

export const AGENT_REGISTRY_SSE_EVENT_NAMES = ['agent', 'done', 'error'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Decode one raw SSE record of the agent-registry stream.
 *
 * INVARIANT: a consumer never sees a frame it cannot name. An unknown event
 * name, a body that is not JSON, and a body that does not carry the MINIMUM
 * shape of its frame all decode to `null`, so a caller skips the record
 * instead of casting an unvalidated body to `AgentInfo`.
 *
 * "Minimum shape" is deliberate and is less than the full `AgentInfo`: an
 * `agent` frame is accepted on `id` and `available` alone, the two fields every
 * consumer discriminates on. This decoder is a wire guard, not a schema
 * validator; it does not promise that every optional field of `AgentInfo` is
 * present or well-typed.
 *
 * `data` is the joined `data:` payload of the record, exactly as it arrived on
 * the wire.
 */
export function parseAgentRegistrySseEvent(
  event: string,
  data: string,
): AgentRegistrySseEvent | null {
  let body: unknown;
  try {
    body = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(body)) return null;

  if (event === 'agent') {
    if (typeof body.id !== 'string' || typeof body.available !== 'boolean') return null;
    return { event: 'agent', data: body as unknown as AgentInfo };
  }
  if (event === 'done') {
    return { event: 'done', data: {} };
  }
  if (event === 'error') {
    if (typeof body.error !== 'string') return null;
    return { event: 'error', data: { error: body.error } };
  }
  return null;
}
