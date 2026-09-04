import type { ChatRunStatusResponse } from '@open-design/contracts';
import type { ChatMessage } from '../types';
import { RUN_FAILURE_RECHECK_INTERVAL_MS } from './run-failure-reconcile';
import type { RunCheckState } from './run-failure-reconcile';

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

/**
 * How many CONSECUTIVE probes may fail to READ the daemon before the lookup
 * says so.
 *
 * A different bound for a different question, and a LOOSER one. The bound above
 * spends probes that read BOTH surfaces and ends in a verdict, so it can only be
 * spent by a conclusive read. This one counts probes where NEITHER read
 * answered, and ends in a WORDING. Reaching it changes no outcome at all: no
 * failure, no Retry, the lookup keeps probing, and the row it holds keeps
 * preventing a second send. It only lets the notice say what is true — the
 * daemon is not answering — and offer the manual re-check that goes with that
 * sentence.
 *
 * The looser test is what makes the sentence honest. A probe that read one
 * surface and not the other has ruled nothing out, so it still may not spend
 * the bound above — but the daemon plainly answered it, and a daemon that is
 * answering must never be described as silent. So any read that lands resets
 * this count, and only a probe that read nothing at all raises it. Three at
 * `LOST_RUN_CREATE_PROBE_INTERVAL_MS` is about six seconds of a daemon
 * answering nothing at all.
 *
 * Short, because this state has no other recovery. The row the lookup is
 * holding disables the composer's Send (`SEND_PAUSED_UNRESOLVED_RUN_KEY`), and
 * until the notice turns over there is no action on screen to take. The
 * follow's much longer `RUN_FAILURE_RECHECK_MAX_MISSES` is not the comparison:
 * it already knows its run id, and it has a fallback conversation read behind
 * its probes.
 */
export const LOST_RUN_CREATE_MAX_UNANSWERED_PROBES = 3;

export type LostRunCreateStep = 'adopt' | 'probe' | 'unreachable' | 'abandon';

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
 *
 * Honest is not the same as usable, which is what `'unreachable'` is for. The
 * state above holds the composer, so an outage that never breaks leaves a
 * paused conversation behind a notice that claims to be checking and offers
 * nothing. Past `LOST_RUN_CREATE_MAX_UNANSWERED_PROBES` consecutive probes that
 * read NOTHING the client says the daemon is not answering instead — the same
 * neutral outcome, kept probing, with the manual re-check the wording implies.
 * `probes` still decides nothing while `answered` is false, so no run of
 * unanswered probes can reach `'abandon'`.
 *
 * `unanswered` is therefore counted on a looser test than `answered`: the
 * caller resets it whenever either read lands, because that is the question the
 * wording asks. See `LOST_RUN_CREATE_MAX_UNANSWERED_PROBES`.
 */
export function nextLostRunCreateStep(
  runId: string | null,
  probes: number,
  answered: boolean,
  unanswered: number,
): LostRunCreateStep {
  if (runId) return 'adopt';
  if (!answered) {
    return unanswered < LOST_RUN_CREATE_MAX_UNANSWERED_PROBES ? 'probe' : 'unreachable';
  }
  return probes < LOST_RUN_CREATE_MAX_PROBES ? 'probe' : 'abandon';
}

/**
 * The lookup's own checking notice, told whether the daemon is answering it.
 *
 * `runCheckWithDaemonReachability` cannot say this for a lookup: it matches a
 * check by run id, and a lookup still LOOKING for one has none. The check that
 * belongs to a lookup is the one with NO run id carrying this client's own
 * assistant row — the same pair `answersRunCheck` picks the notice's row by.
 *
 * INVARIANT: this wording follows the DAEMON's answers and nothing else. It
 * turns on only where `nextLostRunCreateStep` says `'unreachable'`, and off
 * again on the first probe that reads ANYTHING at all, however long the lookup
 * then takes. Returns `current` unchanged when it belongs to another row or
 * already says the right thing, so a lookup can call it on every probe.
 */
export function lostRunCreateCheckWithDaemonReachability<T extends RunCheckState>(
  current: T | null,
  assistantMessageId: string,
  reachable: boolean,
): T | null {
  if (!current || current.runId !== null) return current;
  if (current.assistantMessageId !== assistantMessageId) return current;
  if (current.unreachable !== reachable) return current;
  return { ...current, unreachable: !reachable };
}

/**
 * The failure code a client stamps when the lookup ruled every run out.
 *
 * Agent-agnostic and client-minted: the daemon never saw the request, so it has
 * no verdict to lend. `resolveRunFailureUi` maps it to the named
 * "could not be started" card with Retry (`runtime/amr-guidance.ts`).
 */
export const RUN_NOT_STARTED_ERROR_CODE = 'RUN_NOT_STARTED';
