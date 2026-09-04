import type { ChatRunStatusResponse } from '@open-design/contracts';
import type { ChatMessage } from '../types';
import { RUN_FAILURE_RECHECK_INTERVAL_MS } from './run-failure-reconcile';

/**
 * The two ids a client owns for a run whose create response it never read.
 *
 * `apps/daemon/src/routes/runs.ts` creates the run, pins it onto the stored
 * assistant row and only then sends the 202 — the turn starts AFTER the
 * response is on the wire. So a create call that fails once the request was
 * committed says nothing about whether the run exists: the turn may already be
 * running to success while this client holds no run id at all.
 *
 * A client in that position is not without a handle on the run. It minted
 * `clientRequestId` itself and sent it with the create, and it owns the
 * `assistantMessageId` the daemon pinned onto the row. Either one identifies
 * the run the daemon may have accepted, so the honest response to a lost create
 * response is to LOOK THE RUN UP under these ids — never to declare the turn
 * failed.
 */
export interface LostRunCreateIdentity {
  clientRequestId: string;
  assistantMessageId: string;
}

/**
 * The run in `runs` that this client's create request made, or null.
 *
 * `clientRequestId` decides first: it is unique to one create call, so it
 * cannot be confused by a retry that reused the same assistant row.
 * `assistantMessageId` is the fallback for a run a daemon reported without the
 * request id — the pin makes it just as much this client's own id.
 */
export function matchLostRunCreate(
  runs: readonly ChatRunStatusResponse[],
  identity: LostRunCreateIdentity,
): string | null {
  const byRequest = runs.find((run) => run.clientRequestId === identity.clientRequestId);
  if (byRequest) return byRequest.id;
  const byMessage = runs.find((run) => run.assistantMessageId === identity.assistantMessageId);
  return byMessage ? byMessage.id : null;
}

/**
 * The run id the daemon stamped onto this client's own assistant row.
 *
 * The durable half of the lookup. `pinAssistantMessageOnRunCreate` writes
 * `run_id` on the row before the 202 leaves the daemon, so this answers even
 * for a run the in-memory list has already dropped — a daemon restart between
 * the lost response and the lookup, say. Runs are in-memory in v1; the pinned
 * row is not.
 */
export function pinnedRunIdForAssistantRow(
  messages: readonly ChatMessage[],
  assistantMessageId: string,
): string | null {
  const row = messages.find((message) => message.id === assistantMessageId);
  return row?.runId ?? null;
}

/** Spacing between lookups; matches the follow's own re-check cadence. */
export const LOST_RUN_CREATE_PROBE_INTERVAL_MS = RUN_FAILURE_RECHECK_INTERVAL_MS;

/**
 * How many lookups answer nothing before the client accepts that no run exists.
 *
 * Short on purpose, and short for a different reason than the follow's bound.
 * The follow waits out a daemon that is not answering; this lookup only has to
 * outlast the window in which the daemon has ALREADY committed the run but the
 * client's own two reads have not caught up — the run is created and pinned
 * before the 202, so it is visible to both reads by the time the client can
 * make them. Three probes at `LOST_RUN_CREATE_PROBE_INTERVAL_MS` is about six
 * seconds of a daemon that answers and reports no such run.
 *
 * Reaching the bound is the ONE case in which naming a failure is honest here:
 * neither the conversation's active runs nor the client's own pinned row names
 * a run, so nothing is running and Retry carries no double-send hazard.
 */
export const LOST_RUN_CREATE_MAX_PROBES = 3;

export type LostRunCreateStep = 'adopt' | 'probe' | 'abandon';

/**
 * What a client does next with a create response it lost, given what the lookup
 * just found.
 *
 * A run found under either id is adopted, however late. Nothing found means
 * only that this probe found nothing — the client keeps looking until the bound
 * above, and only then may it say the run was never started.
 *
 * `answered` is what makes the bound safe to spend. Both reads report a failed
 * request as "nothing here" unless asked through their answering forms
 * (`fetchActiveChatRuns`, `fetchMessages`), and the outage that loses a create
 * response is exactly the one that fails the reads after it. A probe that could
 * not read has ruled NOTHING out, so it never counts: it keeps the client
 * looking rather than letting it offer Retry for a run that may be running,
 * which is the B-02 double-send hazard. That means an unbroken outage keeps the
 * neutral checking state indefinitely — the honest state, because the client
 * cannot tell whether the turn is running.
 */
export function nextLostRunCreateStep(
  runId: string | null,
  probes: number,
  answered: boolean,
): LostRunCreateStep {
  if (runId) return 'adopt';
  if (!answered) return 'probe';
  return probes < LOST_RUN_CREATE_MAX_PROBES ? 'probe' : 'abandon';
}

/**
 * The failure code a client stamps when the lookup ruled every run out.
 *
 * Agent-agnostic and client-minted: the daemon never saw the request, so it has
 * no verdict to lend. `resolveRunFailureUi` maps it to the named
 * "could not be started" card with Retry (`runtime/amr-guidance.ts`).
 */
export const RUN_NOT_STARTED_ERROR_CODE = 'RUN_NOT_STARTED';
