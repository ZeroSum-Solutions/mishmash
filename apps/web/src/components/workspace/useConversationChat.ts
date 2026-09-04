import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchActiveChatRuns,
  fetchChatRunStatus,
  streamViaDaemon,
} from '../../providers/daemon';
import { fetchMessages, listMessages, saveMessage } from '../../state/projects';
import { appendErrorStatusEvent, runFailureFieldsFromError } from '../../runtime/chat-events';
import { agentModelDisplayName } from '../../utils/agentLabels';
import { randomUUID } from '../../utils/uuid';
import { effectiveAgentModelChoice } from '../agentModelSelection';
import {
  createBufferedTextUpdates,
  finalizeActiveAssistantMessagesOnStop,
  mergeServerMessagesIntoConversation,
  resolveRetryTarget,
  resolveSucceededRunStatus,
} from '../ProjectView';
import {
  RUN_FAILURE_RECHECK_DELAY_MS,
  RUN_FAILURE_RECHECK_INTERVAL_MS,
  applyRunTerminalFromStatus,
  conversationAnswersRunCheck,
  isLostRunCreateFailure,
  isUnadjudicatedStreamFailure,
  nextInferredRunFailureStep,
  runCheckWithDaemonReachability,
  retractsStaleRunFailure,
  SEND_PAUSED_UNRESOLVED_RUN_KEY,
} from '../../runtime/run-failure-reconcile';
import type { RunCheckState } from '../../runtime/run-failure-reconcile';
import {
  LOST_RUN_CREATE_PROBE_INTERVAL_MS,
  RUN_NOT_STARTED_ERROR_CODE,
  lostRunCreateCheckWithDaemonReachability,
  matchLostRunCreate,
  nextLostRunCreateStep,
  pinnedRunIdForAssistantRow,
} from '../../runtime/lost-run-create';
import type { LostRunCreateIdentity } from '../../runtime/lost-run-create';
import { useT } from '../../i18n';
import type {
  AgentEvent,
  AgentInfo,
  AppConfig,
  ChatAttachment,
  ChatCommentAttachment,
  ChatMessage,
} from '../../types';
import type { ChatSessionMode } from '@open-design/contracts';

// ---------------------------------------------------------------------------
// useConversationChat — drives a secondary ChatPane bound to a single
// conversation (the Side Chat workspace tab).
//
// ProjectView owns the primary conversation's send/stream loop. That loop is
// deeply entangled with queueing, plugin snapshots, live-artifact parsing,
// design-system auditing, notifications, and route sync — extracting it wholesale
// would gut ProjectView. Instead this hook reuses the SAME daemon primitive the
// primary loop runs on (`streamViaDaemon`) plus the SAME persistence helpers
// (`listMessages` / `saveMessage`), so a side chat behaves like the main chat
// ("chat 和我们已有的 chat 对齐即可"): create a run against the conversation, stream
// deltas into the live assistant message, push tool/status events, persist, and
// finalize on done / error / stop. It deliberately omits the primary loop's
// extras (no live-artifact viewer wiring, no queueing) because a side chat is a
// lightweight scratch conversation.
// ---------------------------------------------------------------------------

function isTerminalRunStatus(status: ChatMessage['runStatus']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

function isActiveRunStatus(status: ChatMessage['runStatus']): boolean {
  return status === 'queued' || status === 'running';
}

/**
 * The run a conversation is still waiting on at the moment it mounts.
 *
 * INVARIANT: a conversation that mounts onto one of its own active runs must
 * reach that run's terminal without being remounted. The composer pause below
 * is keyed on the assistant row's status, and for a run this pane did not
 * start, the mount-time message load is its only writer: no stream is attached
 * to that row, and `ProjectView`'s recoverable-run pass speaks for the primary
 * conversation alone. Left unfollowed, the pause outlives the run.
 *
 * Only the LATEST assistant row can be waiting — an earlier one the daemon has
 * already superseded — and it must carry the run id, which is the handle the
 * follow needs. Returns `undefined` when there is nothing to follow.
 */
function activeRunAwaitingTerminal(messages: readonly ChatMessage[]): string | undefined {
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  if (!latestAssistant || !isActiveRunStatus(latestAssistant.runStatus)) return undefined;
  return latestAssistant.runId;
}

export interface ConversationChatContext {
  /** Live app config — selects daemon-vs-api mode and the active agent. */
  config: AppConfig;
  /** Agent metadata map (id → AgentInfo), used to resolve model labels. */
  agentsById: Map<string, AgentInfo>;
  /** UI locale forwarded to the daemon so prompts compose in-language. */
  locale: string;
  sessionMode: ChatSessionMode;
}

export interface UseConversationChatResult {
  messages: ChatMessage[];
  streaming: boolean;
  error: string | null;
  /** Set while a run this hook started has a stream failure the daemon has not
   *  adjudicated. Rendered as a neutral checking notice, never a failure. */
  runCheck: RunCheckState | null;
  /** Re-runs the follow behind that notice. */
  onRunCheckAgain: () => void;
  /**
   * True while this pane's own run is unresolved: its assistant row is still
   * ACTIVE and no stream is attached to it. The same state
   * `ProjectView.currentConversationAwaitingActiveRunAttach` names for the
   * primary chat, and it holds Send for the same reason — a turn sent now would
   * race a run whose verdict has not arrived.
   */
  sendDisabled: boolean;
  /** The sentence the composer shows beside the Send it disabled. */
  sendDisabledReason: string | undefined;
  /** True until the initial message load resolves. */
  loading: boolean;
  onSend: (
    prompt: string,
    attachments: ChatAttachment[],
    commentAttachments: ChatCommentAttachment[],
  ) => void;
  onRetry: (assistantMessage: ChatMessage) => void;
  onStop: () => void;
}

export function useConversationChat(
  projectId: string,
  conversationId: string,
  ctx: ConversationChatContext,
): UseConversationChatResult {
  const { config, agentsById, locale } = ctx;
  const t = useT();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // A run whose event stream failed without the daemon adjudicating it. See
  // `isUnadjudicatedStreamFailure`; `message` is the stream error the follow
  // falls back to if the run turns out to have really failed and its stored row
  // cannot be read.
  const [runCheck, setRunCheck] = useState<(RunCheckState & { message: string }) | null>(null);
  // Residual 8: `error` is one slot, shared with errors no run raised. Remember
  // what a run put there so the run can take back its own value and nothing
  // else.
  const errorCarrierRef = useRef<{ runId: string; message: string } | null>(null);
  // Retires the follow a re-check replaces, so "Check again" cannot leave two
  // loops probing the same run.
  const followGenerationsRef = useRef(new Map<string, number>());

  // Keep the latest config/agent map in refs so the stable `onSend` callback
  // always reads the current agent selection without re-subscribing the SSE.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  // Which conversation this hook currently speaks for, readable from inside an
  // in-flight re-check whose closure was bound to an earlier one.
  const conversationRef = useRef(conversationId);
  conversationRef.current = conversationId;

  const abortRef = useRef<AbortController | null>(null);
  const cancelRef = useRef<AbortController | null>(null);
  // Coalesces streamed deltas into ~one React update per animation frame
  // (same primitive the primary chat loop uses) so a side chat doesn't rebuild
  // the whole messages array on every SSE token.
  const textBufferRef = useRef<ReturnType<typeof createBufferedTextUpdates> | null>(null);
  const failureRecheckTimerRef = useRef<number | null>(null);
  // The lookup that runs when a create response is lost. Its own timer, so the
  // follow's `clearFailureRecheck` cannot cancel it and vice versa.
  const lostRunCreateTimerRef = useRef<number | null>(null);
  // What a running lookup is looking UNDER, kept while it runs so the notice's
  // manual re-check can run it again: before the lookup answers there is no run
  // id to follow, only these two ids.
  const lostRunCreateLookupRef = useRef<
    { identity: LostRunCreateIdentity; message: string } | null
  >(null);
  // Retires the lookup a re-check replaces, so "Check again" cannot leave two
  // loops probing under the same ids.
  const lostRunCreateGenerationRef = useRef(0);

  const clearFailureRecheck = useCallback(() => {
    if (failureRecheckTimerRef.current === null) return;
    window.clearTimeout(failureRecheckTimerRef.current);
    failureRecheckTimerRef.current = null;
  }, []);

  const clearLostRunCreateLookup = useCallback(() => {
    lostRunCreateLookupRef.current = null;
    if (lostRunCreateTimerRef.current === null) return;
    window.clearTimeout(lostRunCreateTimerRef.current);
    lostRunCreateTimerRef.current = null;
  }, []);

  // Residual 8: `error` is a single slot the run shares with errors no run
  // raised. Take back only what this run put there.
  const clearErrorForRun = useCallback((runId: string) => {
    const carried = errorCarrierRef.current;
    if (!carried || carried.runId !== runId) return;
    errorCarrierRef.current = null;
    setError((current) => (current === carried.message ? null : current));
  }, []);

  /**
   * Side Chat's half of the run-resolution invariant.
   *
   * `onError` below is reached for a terminal this pane only INFERRED as well
   * as one the run reported: a non-OK event-stream response surfaces a plain
   * `daemon <status>` error and no terminal event ever arrives
   * (`consumeDaemonRun` in `providers/daemon.ts`), so `onRunStatus` cannot fire
   * either. The run usually keeps going and the daemon stamps the stored
   * assistant row with its real terminal, but nothing here would ever read it.
   *
   * So follow the run until it reports one — `nextInferredRunFailureStep` owns
   * that rule and what bounds it — and let that status settle the row on its
   * own (`applyRunTerminalFromStatus`) before the conversation is read. The
   * inferred failure is never painted, so the follow's other job is to ADOPT
   * the daemon's verdict when the run really did fail: its stored row carries
   * the structured facts this client cannot invent.
   *
   * `stream` is the stream failure this pane raised for the run. It is `null`
   * for the follow's OTHER entry, `activeRunAwaitingTerminal` above: a row that
   * was already active when the conversation mounted. That follow saw no stream
   * error, so it has nothing of its own either to leave standing or to paint —
   * it only carries the run to its terminal.
   */
  const scheduleRunFailureRecheck = useCallback(
    (runId: string | undefined, stream: { unresolved: boolean; message: string } | null) => {
      if (!runId) return;
      const boundConversationId = conversationId;
      const generation = (followGenerationsRef.current.get(runId) ?? 0) + 1;
      followGenerationsRef.current.set(runId, generation);
      const superseded = () =>
        conversationRef.current !== boundConversationId
        || followGenerationsRef.current.get(runId) !== generation;
      let misses = 0;
      const attempt = () => {
        failureRecheckTimerRef.current = null;
        void (async () => {
          const latest = await fetchChatRunStatus(runId).catch(() => null);
          // The read is async, so the tab may have moved to another conversation
          // while it was in flight. A cleared timer cannot catch that one.
          if (superseded()) return;
          misses = latest ? 0 : misses + 1;
          // Any answer at all retires the "not answering" wording, however long
          // the run then takes.
          if (latest) setRunCheck((current) => runCheckWithDaemonReachability(current, runId, true));
          const step = nextInferredRunFailureStep(latest?.status, misses);
          if (step === 'fail') {
            // The run's own verdict, and the only thing that may produce a card
            // for it. A pane that already painted the failure is done; a pane
            // still checking adopts the daemon's row for its facts, and keeps
            // reading for them if that read answers nothing.
            if (stream && !stream.unresolved) return;
            const adopted = await listMessages(projectId, boundConversationId).catch(() => null);
            if (superseded()) return;
            const daemonRow = adopted?.find(
              (message) =>
                message.role === 'assistant'
                && message.runId === runId
                && message.runStatus === 'failed',
            );
            if (adopted && daemonRow) {
              setMessages((current) => mergeServerMessagesIntoConversation(current, adopted));
              // The daemon's words supersede any generic card this run painted
              // while its row was unreadable, so the stream error must not stay
              // in the slot and be shown under the daemon's title.
              clearErrorForRun(runId);
              return;
            }
            if (!stream) {
              // A mount follow has no error of its own, so it has no card to
              // fall back to: the row keeps its active status and the composer
              // stays paused, which is honest while the daemon's own row is
              // unreadable. Keep reading for it.
              failureRecheckTimerRef.current = window.setTimeout(
                attempt,
                RUN_FAILURE_RECHECK_INTERVAL_MS,
              );
              return;
            }
            // A failed run is not a succeeded run, so naming it costs the bar
            // nothing: show the card with the generic title and keep reading for
            // the daemon's own words.
            errorCarrierRef.current = { runId, message: stream.message };
            setError(stream.message);
            setMessages((current) =>
              current.map((message) =>
                message.role === 'assistant' && message.runId === runId
                  ? {
                      ...appendErrorStatusEvent(message, stream.message),
                      endedAt: message.endedAt ?? Date.now(),
                      runStatus: 'failed' as const,
                    }
                  : message,
              ),
            );
            failureRecheckTimerRef.current = window.setTimeout(
              attempt,
              RUN_FAILURE_RECHECK_INTERVAL_MS,
            );
            return;
          }
          if (step === 'retry') {
            failureRecheckTimerRef.current = window.setTimeout(
              attempt,
              RUN_FAILURE_RECHECK_INTERVAL_MS,
            );
            return;
          }
          // 'settle' is the run's own non-failed terminal, and it answers the
          // question on its own: move the row it belongs to and take back this
          // run's error carrier before reading anything. 'reconcile' is the
          // exhausted-probe fallback and carries no status, so it can only fall
          // through to the read.
          const settled = step === 'settle';
          if (settled) {
            setMessages((current) => applyRunTerminalFromStatus(current, runId, latest) ?? current);
            clearErrorForRun(runId);
          }
          const serverMessages = await listMessages(projectId, boundConversationId)
            .catch(() => null);
          if (superseded()) return;
          if (
            serverMessages
            && (settled
              || retractsStaleRunFailure(messagesRef.current, serverMessages)
              || conversationAnswersRunCheck(runId, serverMessages))
          ) {
            setMessages((current) => mergeServerMessagesIntoConversation(current, serverMessages));
            clearErrorForRun(runId);
            return;
          }
          if (settled) return;
          // The 'reconcile' fallback read answered nothing either, so the outage
          // that exhausted the probes is still running and the run is still
          // unresolved. Say so in the notice, and keep following.
          setRunCheck((current) => runCheckWithDaemonReachability(current, runId, false));
          misses = 0;
          failureRecheckTimerRef.current = window.setTimeout(
            attempt,
            RUN_FAILURE_RECHECK_INTERVAL_MS,
          );
        })();
      };
      clearFailureRecheck();
      failureRecheckTimerRef.current = window.setTimeout(attempt, RUN_FAILURE_RECHECK_DELAY_MS);
    },
    [clearErrorForRun, clearFailureRecheck, conversationId, projectId],
  );

  // Load the conversation's persisted messages on mount / conversation switch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setError(null);
    void (async () => {
      const list = await listMessages(projectId, conversationId);
      if (cancelled) return;
      setMessages(list);
      setLoading(false);
      scheduleRunFailureRecheck(activeRunAwaitingTerminal(list), null);
    })();
    return () => {
      cancelled = true;
      clearFailureRecheck();
      clearLostRunCreateLookup();
    };
  }, [
    projectId,
    conversationId,
    clearFailureRecheck,
    clearLostRunCreateLookup,
    scheduleRunFailureRecheck,
  ]);

  // Tear down the live subscription when the tab unmounts. The daemon run
  // keeps going; we only stop the browser-side SSE.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      cancelRef.current = null;
      textBufferRef.current?.cancel();
      textBufferRef.current = null;
    };
  }, []);

  const persist = useCallback(
    (message: ChatMessage) => {
      void saveMessage(projectId, conversationId, message);
    },
    [projectId, conversationId],
  );

  const updateAssistant = useCallback(
    (assistantId: string, updater: (prev: ChatMessage) => ChatMessage) => {
      setMessages((curr) => curr.map((m) => (m.id === assistantId ? updater(m) : m)));
    },
    [],
  );

  /**
   * Side Chat's half of the lost-create-response lookup.
   *
   * The daemon creates and pins the run BEFORE it answers the create request, so
   * a response this pane never read leaves it with a running turn and no run id.
   * It still owns two ids for that run — the `clientRequestId` it minted and the
   * `assistantMessageId` the daemon pinned — and the daemon answers under both.
   * Until one of them does, the row keeps its active status behind the neutral
   * checking notice; once it does, the ordinary follow takes over and its
   * conversation read brings the turn's own output in.
   *
   * The bound running out is the ONE honest failure here: neither read names a
   * run, so nothing is running, and Retry carries no double-send hazard.
   */
  const scheduleLostRunCreateLookup = useCallback(
    (identity: LostRunCreateIdentity, streamMessage: string) => {
      const boundConversationId = conversationId;
      const generation = lostRunCreateGenerationRef.current + 1;
      lostRunCreateGenerationRef.current = generation;
      const superseded = () =>
        conversationRef.current !== boundConversationId
        || lostRunCreateGenerationRef.current !== generation;
      let probes = 0;
      let unanswered = 0;
      const attempt = () => {
        lostRunCreateTimerRef.current = null;
        void (async () => {
          try {
            if (superseded()) return;
            probes += 1;
            const active = await fetchActiveChatRuns(projectId, boundConversationId);
            let runId = active ? matchLostRunCreate(active, identity) : null;
            const stored = runId ? [] : await fetchMessages(projectId, boundConversationId);
            if (!runId && stored) {
              runId = pinnedRunIdForAssistantRow(stored, identity.assistantMessageId);
            }
            if (superseded()) return;
            // Only a probe that READ both surfaces may spend the bound, and a
            // run of probes that read NOTHING is what turns the notice's
            // wording over; see `nextLostRunCreateStep`.
            const answered = active !== null && stored !== null;
            // Two different tests, deliberately. Spending the abandon bound
            // needs BOTH reads; describing the daemon as silent needs neither
            // to have landed, so one read that answered retires that wording
            // even while the other did not. Both reads report a rejected fetch
            // as `null` too (`fetchActiveChatRuns`, `fetchMessages`), so a
            // daemon that is down counts here rather than falling to the catch.
            unanswered = active !== null || stored !== null ? 0 : unanswered + 1;
            const step = nextLostRunCreateStep(runId, probes, answered, unanswered);
            if (step === 'probe' || step === 'unreachable') {
              setRunCheck((current) =>
                lostRunCreateCheckWithDaemonReachability(
                  current,
                  identity.assistantMessageId,
                  step === 'probe',
                ),
              );
              lostRunCreateTimerRef.current = window.setTimeout(
                attempt,
                LOST_RUN_CREATE_PROBE_INTERVAL_MS,
              );
              return;
            }
            lostRunCreateLookupRef.current = null;
            if (step === 'adopt' && runId) {
              const adoptedRunId = runId;
              setMessages((current) =>
                current.map((message) =>
                  message.id === identity.assistantMessageId
                    ? { ...message, runId: adoptedRunId }
                    : message,
                ),
              );
              setRunCheck({
                runId: adoptedRunId,
                assistantMessageId: identity.assistantMessageId,
                unreachable: false,
                message: streamMessage,
              });
              scheduleRunFailureRecheck(adoptedRunId, {
                unresolved: true,
                message: streamMessage,
              });
              return;
            }
            const notStarted = t('chat.runError.notStartedMessage');
            errorCarrierRef.current = null;
            setError(notStarted);
            setMessages((current) => {
              const next = current.map((message) =>
                message.id === identity.assistantMessageId
                  ? {
                      ...appendErrorStatusEvent(message, notStarted, RUN_NOT_STARTED_ERROR_CODE),
                      endedAt: message.endedAt ?? Date.now(),
                      runStatus: 'failed' as const,
                    }
                  : message,
              );
              const finalized = next.find((message) => message.id === identity.assistantMessageId);
              if (finalized) persist(finalized);
              return next;
            });
          } catch (err) {
            // This lookup is the only thing that can resolve the row, so it must
            // never end without an outcome. Anything unexpected is one more
            // inconclusive probe.
            console.warn('Failed to look up a run whose create response was lost', err);
            if (superseded()) return;
            lostRunCreateTimerRef.current = window.setTimeout(
              attempt,
              LOST_RUN_CREATE_PROBE_INTERVAL_MS,
            );
          }
        })();
      };
      clearLostRunCreateLookup();
      lostRunCreateLookupRef.current = { identity, message: streamMessage };
      lostRunCreateTimerRef.current = window.setTimeout(attempt, RUN_FAILURE_RECHECK_DELAY_MS);
    },
    [
      clearLostRunCreateLookup,
      conversationId,
      persist,
      projectId,
      scheduleRunFailureRecheck,
      t,
    ],
  );

  // The manual re-check behind the "MishMash is not answering" notice: look
  // again now instead of waiting out the interval.
  //
  // Both states the notice can be in have something to re-check, and they are
  // not the same thing. A check WITH a run id follows that run; a check with
  // none is still LOOKING for the run its lost create response never named, so
  // what it runs again is the lookup, under the two ids it stored. Either way
  // the neutral state stands and the re-check only takes the wording back.
  const onRunCheckAgain = useCallback(() => {
    const pending = runCheck;
    if (!pending) return;
    if (!pending.runId) {
      const lookup = lostRunCreateLookupRef.current;
      if (!lookup || lookup.identity.assistantMessageId !== pending.assistantMessageId) return;
      setRunCheck({ ...pending, unreachable: false });
      scheduleLostRunCreateLookup(lookup.identity, lookup.message);
      return;
    }
    setRunCheck({ ...pending, unreachable: false });
    scheduleRunFailureRecheck(pending.runId, { unresolved: true, message: pending.message });
  }, [runCheck, scheduleLostRunCreateLookup, scheduleRunFailureRecheck]);

  const runSend = useCallback(
    (
      prompt: string,
      attachments: ChatAttachment[],
      commentAttachments: ChatCommentAttachment[],
      retryOfAssistantId?: string,
    ) => {
      const {
        config: cfg,
        agentsById: agents,
        locale: loc,
        sessionMode,
      } = ctxRef.current;
      if (cfg.mode !== 'daemon') {
        setError('Side Chat needs a local agent. Pick one in the top bar.');
        return;
      }
      if (!cfg.agentId) {
        setError('Pick a local agent first (top bar).');
        return;
      }

      const retryTarget = retryOfAssistantId
        ? resolveRetryTarget(messagesRef.current, retryOfAssistantId)
        : null;
      if (retryOfAssistantId && !retryTarget) return;

      const startedAt = Date.now();
      const selectedAgent = agents.get(cfg.agentId) ?? null;
      const choice = effectiveAgentModelChoice(selectedAgent, cfg.agentModels?.[cfg.agentId]);
      const assistantAgentName = agentModelDisplayName(
        cfg.agentId,
        selectedAgent?.name,
        choice?.model,
      );

      const userMsg: ChatMessage = retryTarget
        ? retryTarget.userMsg
        : {
            id: randomUUID(),
            role: 'user',
            content: prompt,
            createdAt: startedAt,
            ...(attachments.length > 0 ? { attachments } : {}),
            ...(commentAttachments.length > 0 ? { commentAttachments } : {}),
          };
      const assistantId = retryTarget?.failedAssistant.id ?? randomUUID();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        agentId: cfg.agentId,
        agentName: assistantAgentName,
        events: [],
        createdAt: retryTarget?.failedAssistant.createdAt ?? startedAt,
        runStatus: 'running',
        startedAt,
      };

      const history = retryTarget
        ? [...retryTarget.priorMessages, userMsg]
        : [...messagesRef.current, userMsg];
      setMessages([...history, assistantMsg]);
      setStreaming(true);
      setError(null);
      if (!retryTarget) persist(userMsg);

      const controller = new AbortController();
      const cancelController = new AbortController();
      abortRef.current = controller;
      cancelRef.current = cancelController;

      // Frame-batch this run's text deltas. flush() applies any pending content
      // before cancel() tears down, so a terminal status that races onDone
      // can't drop the tail of the answer.
      textBufferRef.current?.cancel();
      const textBuffer = createBufferedTextUpdates({
        updateMessage: (updater) => updateAssistant(assistantId, updater),
        // Side chat persists at done/error (+ onRunCreated), not mid-stream.
        persistSoon: () => {},
      });
      textBufferRef.current = textBuffer;

      // The run this send created, once the daemon has named it. A failure the
      // pane only inferred is re-checked against this run, so a send that never
      // reached `onRunCreated` has nothing to follow.
      let currentRunId: string | undefined;
      // The id this send is known by on the daemon side even when the create
      // response never comes back, so `onError` can look the run up under it.
      const runClientRequestId = randomUUID();

      const clearRefs = () => {
        if (abortRef.current === controller) abortRef.current = null;
        if (cancelRef.current === cancelController) cancelRef.current = null;
        textBufferRef.current?.flush();
        textBufferRef.current?.cancel();
        textBufferRef.current = null;
        setStreaming(false);
      };

      const handlers = {
        onDelta: (delta: string) => {
          textBuffer.appendContent(delta);
        },
        onAgentEvent: (ev: AgentEvent) => {
          textBuffer.appendEvent(ev);
        },
        onDone: () => {
          textBuffer.flush();
          const endedAt = Date.now();
          setMessages((curr) => {
            const next = curr.map((m) =>
              m.id === assistantId
                ? { ...m, endedAt, runStatus: resolveSucceededRunStatus(m.runStatus) }
                : m,
            );
            const finalized = next.find((m) => m.id === assistantId);
            if (finalized) persist(finalized);
            return next;
          });
          clearRefs();
        },
        onError: (err: Error) => {
          textBuffer.flush();
          const endedAt = Date.now();
          const code = (err as Error & { code?: string }).code;
          const resumable = (err as Error & { resumable?: boolean }).resumable === true;
          const failure = runFailureFieldsFromError(err);
          // A stream failure the daemon has not adjudicated says nothing about
          // the run, which is usually still going. It is an UNRESOLVED state:
          // leave the row on its last active status and say so in neutral words
          // until the run itself answers. Only a run this pane can still follow
          // qualifies — an error raised before the daemon named a run has
          // nothing to check.
          const unresolvedRunId = isUnadjudicatedStreamFailure(err) ? currentRunId : undefined;
          // The same claim one step earlier: the create response was lost, so
          // this pane has no run id for a run the daemon may already be running.
          // It owns two ids for it, so look the run up rather than paint
          // anything.
          const lostRunCreate = isLostRunCreateFailure(err) && currentRunId === undefined;
          if (unresolvedRunId !== undefined) {
            setRunCheck({
              runId: unresolvedRunId,
              assistantMessageId: assistantId,
              unreachable: false,
              message: err.message,
            });
          } else if (lostRunCreate) {
            setRunCheck({
              runId: null,
              assistantMessageId: assistantId,
              unreachable: false,
              message: err.message,
            });
          } else {
            errorCarrierRef.current = currentRunId
              ? { runId: currentRunId, message: err.message }
              : null;
            setError(err.message);
            setMessages((curr) => {
              const next = curr.map((m) => {
                if (m.id !== assistantId) return m;
                const withError = appendErrorStatusEvent(m, err.message, code, failure);
                return {
                  ...withError,
                  endedAt,
                  runStatus: 'failed' as const,
                  resumable,
                };
              });
              const finalized = next.find((m) => m.id === assistantId);
              if (finalized) persist(finalized);
              return next;
            });
          }
          clearRefs();
          if (lostRunCreate) {
            scheduleLostRunCreateLookup(
              { clientRequestId: runClientRequestId, assistantMessageId: assistantId },
              err.message,
            );
            return;
          }
          scheduleRunFailureRecheck(currentRunId, {
            unresolved: unresolvedRunId !== undefined,
            message: err.message,
          });
        },
      };

      void streamViaDaemon({
        agentId: cfg.agentId,
        history,
        signal: controller.signal,
        cancelSignal: cancelController.signal,
        handlers,
        projectId,
        conversationId,
        assistantMessageId: assistantId,
        clientRequestId: runClientRequestId,
        skillId: null,
        skillIds: [],
        designSystemId: cfg.designSystemId ?? null,
        attachments: (userMsg.attachments ?? []).map((a) => a.path),
        commentAttachments: userMsg.commentAttachments ?? [],
        model: choice?.model ?? null,
        reasoning: choice?.reasoning ?? null,
        locale: loc,
        sessionMode,
        onRunCreated: (runId) => {
          currentRunId = runId;
          updateAssistant(assistantId, (prev) => ({
            ...prev,
            runId,
            runStatus: 'queued',
          }));
          setMessages((curr) => {
            const pinned = curr.find((m) => m.id === assistantId);
            if (pinned) persist(pinned);
            return curr;
          });
        },
        onRunStatus: (runStatus) => {
          updateAssistant(assistantId, (prev) => ({
            ...prev,
            runStatus,
            endedAt: isTerminalRunStatus(runStatus) ? prev.endedAt ?? Date.now() : prev.endedAt,
          }));
          if (isTerminalRunStatus(runStatus)) clearRefs();
        },
        onRunEventId: (lastRunEventId) => {
          updateAssistant(assistantId, (prev) => ({ ...prev, lastRunEventId }));
        },
      });
    },
    [
      projectId,
      conversationId,
      persist,
      scheduleLostRunCreateLookup,
      scheduleRunFailureRecheck,
      updateAssistant,
    ],
  );

  const onSend = useCallback(
    (prompt: string, attachments: ChatAttachment[], commentAttachments: ChatCommentAttachment[]) => {
      runSend(prompt, attachments, commentAttachments);
    },
    [runSend],
  );

  const onRetry = useCallback(
    (assistantMessage: ChatMessage) => {
      runSend('', [], [], assistantMessage.id);
    },
    [runSend],
  );

  const onStop = useCallback(() => {
    const stoppedAt = Date.now();
    // Abort the cancel signal first so the daemon stops the run (POST cancel),
    // then drop the browser-side SSE subscription.
    cancelRef.current?.abort();
    cancelRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    textBufferRef.current?.flush();
    textBufferRef.current?.cancel();
    textBufferRef.current = null;
    setStreaming(false);
    setMessages((curr) => {
      const { messages: next, finalized } = finalizeActiveAssistantMessagesOnStop(curr, stoppedAt);
      for (const message of finalized) persist(message);
      return next;
    });
  }, [persist]);

  // INVARIANT: an unresolved run pauses sending, and a paused composer says so
  // (`SEND_PAUSED_UNRESOLVED_RUN_KEY`). A side chat that renders its own
  // `useConversationChat` gets no `sendDisabled` from a parent, so without this
  // its Send stayed live for the whole unresolved window while its checking
  // notice was on screen — the notice and the composer disagreeing about the
  // same run.
  const awaitingActiveRunAttach =
    !streaming
    && messages.some((message) => message.role === 'assistant' && isActiveRunStatus(message.runStatus));
  const sendDisabledReason = awaitingActiveRunAttach
    ? t(SEND_PAUSED_UNRESOLVED_RUN_KEY)
    : undefined;

  return {
    messages,
    streaming,
    error,
    runCheck,
    loading,
    onSend,
    onRetry,
    onStop,
    onRunCheckAgain,
    sendDisabled: awaitingActiveRunAttach,
    sendDisabledReason,
  };
}
