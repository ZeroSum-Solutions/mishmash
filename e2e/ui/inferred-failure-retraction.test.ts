import {
  CHECKING_NOTICE_TEXT,
  SEND_PAUSED_TEXT,
  runCheckingNotice,
  runErrorCard,
  runFailureCardSightings,
  watchRunFailureCard,
} from '@/playwright/chat';
import { createFakeAgentRuntimes } from '@/playwright/fake-agents';
import type { FakeAgentId } from '@/playwright/fake-agents';
import { APP_LOADING_TEXT } from '@/playwright/loading';
import { openNewProjectModal as openNewProjectModalFromProjects } from '@/playwright/rail';
import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';
import type { Locator, Page, Response } from '@playwright/test';

const STORAGE_KEY = 'mishmash:config';
const LOAD_COUNTER_KEY = 'od-e2e-document-loads';
// The fake runtime holds this prompt's turn for 1.2s and then exits 0
// (`e2e/lib/fake-agents.ts`), so the run reaches `succeeded` on its own while
// this spec holds the client's event stream open at the transport.
const RUN_PROMPT = 'Create a delayed deterministic smoke artifact';
// What the fake runtime answers that prompt with (`e2e/lib/fake-agents.ts`).
// Asserted after the retraction so a build that merely drops the alert — leaving
// a permanently running, content-less row — cannot pass as a build that
// retracted the failure.
const RUN_ANSWER = 'I recovered the delayed reasoning path';
// W1J.4: what the user types while the run is unresolved. A draft is required
// to see the pause at all — the Send button is also disabled on an empty
// composer, so an empty one cannot tell "paused" from "nothing to send".
const PAUSED_DRAFT = 'A follow-up turn typed while the run is unresolved';
// How many consecutive unanswered status probes the W1H.1 cases force before
// letting the run's real terminal through. Three is what the pre-fix rule
// treated as the end of the recovery, and at `RUN_FAILURE_RECHECK_INTERVAL_MS`
// spacing it is a nine-second daemon hiccup.
const RECHECK_MISSES_UNDER_TEST = 3;
// The reconciliation probes the run's status at `RUN_FAILURE_RECHECK_DELAY_MS`
// (150 ms) and then every `RUN_FAILURE_RECHECK_INTERVAL_MS` (3 s), so a 7.5 s
// outage covers its probes at ~0.15 s, ~3.15 s and ~6.15 s and ends before its
// fourth at ~9.15 s.
const STATUS_OUTAGE_WINDOW_MS = 7_500;
// The prompt the fake runtime answers with a real, daemon-classified failure
// (`e2e/lib/fake-agents.ts`, REPORTED_AGENT_FAILURE_OUTPUT.sleep). Used by the
// verdict cases: a run the daemon adjudicated keeps the failure card.
const FAILING_RUN_PROMPT = 'Return the reported sleep-drop failure';
// The title the honest "the daemon never took this request" failure carries
// (`chat.runError.title.notStarted`). Distinct from the generic "Task failed",
// which is what a client paints when it declares a turn dead without looking.
const RUN_NOT_STARTED_TITLE = 'The run could not be started';
// W1K.2: what the checking notice says once the client has stopped being able
// to read the daemon at all (`chat.runChecking.unreachableTitle`), and the
// action it then offers (`chat.runChecking.checkAgainCta`). Neither is a
// verdict on the run — the wording changes, the neutral outcome does not.
const NOT_ANSWERING_TEXT = 'MishMash is not answering';
const CHECK_AGAIN_LABEL = /check again/i;
// How many consecutive unanswered probes the lost-create lookup makes before it
// says the daemon is not answering (`LOST_RUN_CREATE_MAX_UNANSWERED_PROBES`).
const LOOKUP_UNANSWERED_BOUND = 3;

let fakeRuntimes: Awaited<ReturnType<typeof createFakeAgentRuntimes>>;

test.beforeAll(async () => {
  fakeRuntimes = await createFakeAgentRuntimes();
});

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000);
  await resetDaemonAppConfig(page);
  // Counts documents, not navigations, and survives them: each load bumps a
  // sessionStorage tally, so the assertions below can prove the alert left the
  // DOM of the SAME document that painted it. Top-level documents only —
  // `addInitScript` also runs in the artifact preview iframe, which shares this
  // origin's sessionStorage and would otherwise read as a page reload.
  await page.addInitScript((key) => {
    if (window.top !== window.self) return;
    const previous = Number(window.sessionStorage.getItem(key) ?? '0');
    window.sessionStorage.setItem(key, String((Number.isFinite(previous) ? previous : 0) + 1));
  }, LOAD_COUNTER_KEY);
  await installBrowserAgentConfig(page, 'codex');
  await configureFakeAgent(page, 'codex');
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await resetDaemonAppConfig(page);
});

// SUPERSESSION (W1I.1). W1G.1 and W1H.1 asserted that the generic "Task failed"
// card was PAINTED first and then retracted — `expect(failureAlert).toBeVisible()`
// followed by `toContainText('Task failed')`, before waiting for the same run to
// reach `succeeded`. W1I.1 makes that impossible: a stream failure the daemon has
// not adjudicated is an unresolved state, so the pane shows a neutral checking
// notice and never the failure card. The retraction those two tracks proved is
// now the notice LEAVING, and every terminal assertion they carried is kept
// unchanged below.
//
// W1G.1 browser-level regression, the two halves W1F.1 left open.
//
// `run-failure-retraction.test.ts` covers the REATTACHED stream: a client that
// reloads onto a run in flight, whose reattached stream then answers non-OK.
// That path already schedules one conversation refresh, and W1F.1 taught the
// refresh to retract the pane's error string alongside the row.
//
// Two paths reach the same symptom without that refresh:
//
//   * the LIVE send loop. `consumeDaemonRun` answers a non-OK event-stream
//     response with a plain `daemon <status>` error carrying no disconnect code
//     (apps/web/src/providers/daemon.ts). ProjectView's live `onError` then
//     takes its ordinary branch: it paints the pane's error string, writes a
//     `failed` row, SEALS the run in `completedReattachRunsRef` — so no
//     reattach re-queries it — and schedules no refresh, because only the two
//     generic-disconnect retry-cap branches set that flag.
//   * Side Chat (`useConversationChat`), which holds its own error slot and its
//     own row write and has no reconciliation of any kind.
//
// In both cases the client never receives the run's terminal, while the daemon
// records the run as succeeded and stamps the stored assistant row with that
// terminal (`reconcileAssistantMessageOnRunEnd`, `followRunTerminalOnMessage`).
// The user reads "Task failed" for a turn that succeeded until a page reload.
//
// Ordering is forced at the transport, not faked in state, exactly as the
// sibling spec does it:
//   1. the run's event stream is answered 503 the moment the client OPENS it,
//      which is when this fails in the wild — at the start of a turn that then
//      runs on for seconds or minutes. The client paints the checking notice
//      while the run is still going, so a pane that looked once and gave up
//      would leave it there for the whole run;
//   2. every later request for that same stream is answered 503 too, so nothing
//      recovers by reattaching: following the run is the only route left;
//   3. the client's own conversation read — which it makes only once the run
//      reports a terminal — is HELD until this spec has observed the notice on
//      screen, so the assertion is never a race with the terminal.
// Nothing writes message state from the test: the row is the client's own
// production PUT, and the daemon's write-side hold
// (`holdTerminalRunStatusOnMessageWrite`) is what keeps the stored row on its
// terminal.

test('[P0] a non-ok live event stream leaves no failure alert once the run reaches succeeded', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Live run failure retraction smoke');
  await expectWorkspaceReady(page);

  const { conversationId, projectId } = await currentProjectContext(page);
  const streamHold = holdRunEventStream(page);
  const refreshGate = holdConversationRead(page, () => streamHold.failed);

  streamHold.arm();
  const runResponse = await sendPrompt(page, page.getByTestId('chat-composer').first(), RUN_PROMPT);
  const { runId } = (await runResponse.json()) as { runId: string };

  const failureAlert = runErrorCard(page);
  const checkingNotice = runCheckingNotice(page);
  await expect(checkingNotice, 'the non-ok live event stream must paint the neutral checking notice')
    .toBeVisible({ timeout: 120_000 });
  await expect(checkingNotice).toContainText(CHECKING_NOTICE_TEXT);
  await expect(failureAlert, 'an unresolved stream failure must not paint the failure card')
    .toHaveCount(0);

  // The notice is already on screen while the run is still going. Let the run
  // finish under it; that is the state the client has to notice on its own.
  await waitForDaemonRunStatus(page, runId, 'succeeded');

  // Preconditions for the assertion below, asserted separately so a failure
  // names its own cause: the run really did succeed, the stored row really is
  // on that terminal, and the alert is up in the document about to receive it.
  expect(await daemonRunStatus(page, runId), 'precondition: the run must have succeeded').toBe('succeeded');
  expect(
    await storedAssistantRunStatus(page, projectId, conversationId),
    'precondition: the daemon must hold the stored assistant row on the run terminal',
  ).toBe('succeeded');
  const documentLoads = await documentLoadCount(page);

  refreshGate.release();

  // The alert must leave the DOM on the authoritative terminal alone: no page
  // reload, no manual refetch, nothing but the re-check the client schedules
  // for itself.
  await expect(checkingNotice, 'the checking notice must leave once the run answers')
    .toHaveCount(0, { timeout: T.long });
  await expect(failureAlert, 'the retracted run failure must leave the DOM')
    .toHaveCount(0, { timeout: T.long });
  // The pane must land on the turn the run actually delivered, not on a blank
  // row that merely stopped saying "failed".
  await expect(
    page.getByText(RUN_ANSWER).first(),
    'the retracted turn must show the answer the run delivered',
  ).toBeVisible({ timeout: T.long });
  expect(await documentLoadCount(page), 'the alert must clear without a page reload').toBe(documentLoads);
  expect(await storedAssistantRunStatus(page, projectId, conversationId)).toBe('succeeded');
});

test('[P0] a non-ok Side Chat event stream leaves no failure alert once the run reaches succeeded', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Side chat run failure retraction smoke');
  await expectWorkspaceReady(page);

  const { conversationId, projectId } = await currentProjectContext(page);
  // A Side Chat tab is only ever restored from persisted tab state — the
  // workspace has no launcher affordance for one (`FileWorkspace.tsx`). Open it
  // the way the product does, through the same `PUT /api/projects/:id/tabs`
  // endpoint the client writes, on a conversation of its own so the tab runs
  // its own `useConversationChat` rather than mirroring the primary chat.
  const sideConversationId = await createConversation(page, projectId, 'Side chat');
  await openSideChatTab(page, projectId, conversationId, sideConversationId);

  const sideChat = page.getByTestId('side-chat-tab');
  await expect(sideChat, 'the persisted side chat tab must mount').toBeVisible({ timeout: T.long });

  const streamHold = holdRunEventStream(page);
  const refreshGate = holdConversationRead(page, () => streamHold.failed);

  streamHold.arm();
  const runResponse = await sendPrompt(page, await composerInside(page, sideChat), RUN_PROMPT);
  const { runId } = (await runResponse.json()) as { runId: string };

  const failureAlert = runErrorCard(sideChat);
  const checkingNotice = runCheckingNotice(sideChat);
  await expect(checkingNotice, 'the non-ok Side Chat event stream must paint the neutral checking notice')
    .toBeVisible({ timeout: 120_000 });
  await expect(checkingNotice).toContainText(CHECKING_NOTICE_TEXT);
  await expect(failureAlert, 'an unresolved stream failure must not paint the failure card')
    .toHaveCount(0);

  await waitForDaemonRunStatus(page, runId, 'succeeded');

  expect(await daemonRunStatus(page, runId), 'precondition: the run must have succeeded').toBe('succeeded');
  expect(
    await storedAssistantRunStatus(page, projectId, sideConversationId),
    'precondition: the daemon must hold the stored assistant row on the run terminal',
  ).toBe('succeeded');
  const documentLoads = await documentLoadCount(page);

  refreshGate.release();

  await expect(checkingNotice, 'the checking notice must leave once the run answers')
    .toHaveCount(0, { timeout: T.long });
  await expect(failureAlert, 'the retracted Side Chat run failure must leave the DOM')
    .toHaveCount(0, { timeout: T.long });
  await expect(
    sideChat.getByText(RUN_ANSWER).first(),
    'the retracted Side Chat turn must show the answer the run delivered',
  ).toBeVisible({ timeout: T.long });
  expect(await documentLoadCount(page), 'the alert must clear without a page reload').toBe(documentLoads);
  expect(await storedAssistantRunStatus(page, projectId, sideConversationId)).toBe('succeeded');
});

// W1H.1 — the two ways the follow itself quits early.
//
// W1G.1 (above) made both panes FOLLOW the run instead of looking once. Its two
// cases answer every status probe and every conversation read, so they only
// exercise the happy path of that follow. Two transient failures inside it are
// still terminal:
//
//   * three status probes that answer nothing END the follow for good.
//     `fetchChatRunStatus` turns a network error and a non-OK response alike
//     into `null` (`providers/daemon.ts`), which the rule counts as a miss, and
//     three misses used to be `'stop'`. Three misses is a nine-second daemon
//     hiccup — the very outage class that produced the inferred failure — after
//     which nothing retracts: the live `onError` sealed the run in
//     `completedReattachRunsRef`, so no reattach re-queries it either;
//   * ONE failed conversation read after the run reports success ends it too.
//     `listMessages` returns `[]` on a thrown fetch and on `!resp.ok`
//     (`state/projects.ts`), so `retractsStaleRunFailure` sees nothing to
//     retract and the pane returns — still holding the authoritative
//     `succeeded` it had just read, and still painting "Task failed".
//
// Both are forced at the transport, on the same live-send and Side Chat paths,
// with the same production writes as the cases above.

test('[P0] a live inferred failure is retracted after three status probes answer nothing', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Live status-probe miss retraction smoke');
  await expectWorkspaceReady(page);

  const { conversationId, projectId } = await currentProjectContext(page);
  const streamHold = holdRunEventStream(page);
  const probeHold = holdRunStatusProbes(page, STATUS_OUTAGE_WINDOW_MS, () => streamHold.runId);

  streamHold.arm();
  const runResponse = await sendPrompt(page, page.getByTestId('chat-composer').first(), RUN_PROMPT);
  const { runId } = (await runResponse.json()) as { runId: string };

  const failureAlert = runErrorCard(page);
  const checkingNotice = runCheckingNotice(page);
  await expect(checkingNotice, 'the non-ok live event stream must paint the neutral checking notice')
    .toBeVisible({ timeout: 120_000 });
  await expect(checkingNotice).toContainText(CHECKING_NOTICE_TEXT);
  await expect(failureAlert, 'an unresolved stream failure must not paint the failure card')
    .toHaveCount(0);

  // W1J.4: the unresolved window pauses sending, and the user must be able to
  // read that. The probe allowance lets this window last minutes, so a Send
  // that is merely disabled is a silent lock.
  const composer = page.getByTestId('chat-composer').first();
  const sendButton = composer.getByTestId('chat-send').first();
  await composer.getByTestId('chat-composer-input').first().fill(PAUSED_DRAFT);
  await expect(sendButton, 'an unresolved run must hold Send even with a draft ready')
    .toBeDisabled();
  await expect(checkingNotice, 'the checking notice must say sending is paused')
    .toContainText(SEND_PAUSED_TEXT);
  await expect(
    composer.getByText(SEND_PAUSED_TEXT).first(),
    'the composer must explain why its Send is disabled',
  ).toBeVisible();

  await waitForDaemonRunStatus(page, runId, 'succeeded');
  // A coarse gate, not the mechanism: `refused` also counts the unrelated
  // per-message status read described on `holdRunStatusProbes`. What makes the
  // reconciliation meet three misses is the window's length, and what proves it
  // is that this case is red on a build whose rule stops at three.
  await expect
    .poll(() => probeHold.refused, { intervals: [250], timeout: 60_000 })
    .toBeGreaterThanOrEqual(RECHECK_MISSES_UNDER_TEST);
  // Let the outage end before asserting, so the retraction below can only come
  // from a probe ANSWERED after the three that were not.
  await expect
    .poll(() => probeHold.outageOpen, { intervals: [250], timeout: 60_000 })
    .toBe(false);

  expect(await daemonRunStatus(page, runId), 'precondition: the run must have succeeded').toBe('succeeded');
  expect(
    await storedAssistantRunStatus(page, projectId, conversationId),
    'precondition: the daemon must hold the stored assistant row on the run terminal',
  ).toBe('succeeded');
  const documentLoads = await documentLoadCount(page);

  // Every probe from here answers. The pane must still be following the run,
  // so the very next one is the terminal that retracts the alert.
  await expect(checkingNotice, 'the checking notice must leave once the run answers')
    .toHaveCount(0, { timeout: T.long });
  await expect(failureAlert, 'three unanswered probes must not end the recovery')
    .toHaveCount(0, { timeout: T.long });
  await expect(
    page.getByText(RUN_ANSWER).first(),
    'the retracted turn must show the answer the run delivered',
  ).toBeVisible({ timeout: T.long });
  // W1J.4: the pause ends with the run, and its explanation leaves with it.
  await expect(sendButton, 'sending must resume once the run answers')
    .toBeEnabled({ timeout: T.long });
  await expect(
    composer.getByText(SEND_PAUSED_TEXT),
    'the paused sentence must not outlive the pause',
  ).toHaveCount(0, { timeout: T.long });
  expect(await documentLoadCount(page), 'the alert must clear without a page reload').toBe(documentLoads);
});

test('[P0] a live inferred failure is retracted when the first message read after success fails', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Live failed-read retraction smoke');
  await expectWorkspaceReady(page);

  const { conversationId, projectId } = await currentProjectContext(page);
  const streamHold = holdRunEventStream(page);
  const readRefusal = refuseFirstConversationRead(page, () => streamHold.failed);

  streamHold.arm();
  const runResponse = await sendPrompt(page, page.getByTestId('chat-composer').first(), RUN_PROMPT);
  const { runId } = (await runResponse.json()) as { runId: string };

  const failureAlert = runErrorCard(page);
  const checkingNotice = runCheckingNotice(page);
  await expect(checkingNotice, 'the non-ok live event stream must paint the neutral checking notice')
    .toBeVisible({ timeout: 120_000 });
  await expect(checkingNotice).toContainText(CHECKING_NOTICE_TEXT);
  await expect(failureAlert, 'an unresolved stream failure must not paint the failure card')
    .toHaveCount(0);

  await waitForDaemonRunStatus(page, runId, 'succeeded');
  await expect
    .poll(() => readRefusal.refused, { intervals: [250], timeout: 60_000 })
    .toBe(1);

  expect(await daemonRunStatus(page, runId), 'precondition: the run must have succeeded').toBe('succeeded');
  expect(
    await storedAssistantRunStatus(page, projectId, conversationId),
    'precondition: the daemon must hold the stored assistant row on the run terminal',
  ).toBe('succeeded');
  const documentLoads = await documentLoadCount(page);

  // The pane already holds the authoritative `succeeded`. A conversation read
  // that failed cannot take that fact away from it.
  await expect(checkingNotice, 'the checking notice must leave once the run answers')
    .toHaveCount(0, { timeout: T.long });
  await expect(failureAlert, 'a failed message read must not leave the retracted failure on screen')
    .toHaveCount(0, { timeout: T.long });
  expect(await documentLoadCount(page), 'the alert must clear without a page reload').toBe(documentLoads);
  expect(await storedAssistantRunStatus(page, projectId, conversationId)).toBe('succeeded');
});

test('[P0] a Side Chat inferred failure is retracted after three status probes answer nothing', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Side chat status-probe miss retraction smoke');
  await expectWorkspaceReady(page);

  const { conversationId, projectId } = await currentProjectContext(page);
  const sideConversationId = await createConversation(page, projectId, 'Side chat');
  await openSideChatTab(page, projectId, conversationId, sideConversationId);

  const sideChat = page.getByTestId('side-chat-tab');
  await expect(sideChat, 'the persisted side chat tab must mount').toBeVisible({ timeout: T.long });

  const streamHold = holdRunEventStream(page);
  const probeHold = holdRunStatusProbes(page, STATUS_OUTAGE_WINDOW_MS, () => streamHold.runId);

  streamHold.arm();
  const runResponse = await sendPrompt(page, await composerInside(page, sideChat), RUN_PROMPT);
  const { runId } = (await runResponse.json()) as { runId: string };

  const failureAlert = runErrorCard(sideChat);
  const checkingNotice = runCheckingNotice(sideChat);
  await expect(checkingNotice, 'the non-ok Side Chat event stream must paint the neutral checking notice')
    .toBeVisible({ timeout: 120_000 });
  await expect(checkingNotice).toContainText(CHECKING_NOTICE_TEXT);
  await expect(failureAlert, 'an unresolved stream failure must not paint the failure card')
    .toHaveCount(0);

  await waitForDaemonRunStatus(page, runId, 'succeeded');
  // A coarse gate, not the mechanism: `refused` also counts the unrelated
  // per-message status read described on `holdRunStatusProbes`. What makes the
  // reconciliation meet three misses is the window's length, and what proves it
  // is that this case is red on a build whose rule stops at three.
  await expect
    .poll(() => probeHold.refused, { intervals: [250], timeout: 60_000 })
    .toBeGreaterThanOrEqual(RECHECK_MISSES_UNDER_TEST);
  // Let the outage end before asserting, so the retraction below can only come
  // from a probe ANSWERED after the three that were not.
  await expect
    .poll(() => probeHold.outageOpen, { intervals: [250], timeout: 60_000 })
    .toBe(false);

  expect(await daemonRunStatus(page, runId), 'precondition: the run must have succeeded').toBe('succeeded');
  expect(
    await storedAssistantRunStatus(page, projectId, sideConversationId),
    'precondition: the daemon must hold the stored assistant row on the run terminal',
  ).toBe('succeeded');
  const documentLoads = await documentLoadCount(page);

  await expect(checkingNotice, 'the checking notice must leave once the run answers')
    .toHaveCount(0, { timeout: T.long });
  await expect(failureAlert, 'three unanswered probes must not end the Side Chat recovery')
    .toHaveCount(0, { timeout: T.long });
  await expect(
    sideChat.getByText(RUN_ANSWER).first(),
    'the retracted Side Chat turn must show the answer the run delivered',
  ).toBeVisible({ timeout: T.long });
  expect(await documentLoadCount(page), 'the alert must clear without a page reload').toBe(documentLoads);
});

test('[P0] a Side Chat inferred failure is retracted when the first message read after success fails', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Side chat failed-read retraction smoke');
  await expectWorkspaceReady(page);

  const { conversationId, projectId } = await currentProjectContext(page);
  const sideConversationId = await createConversation(page, projectId, 'Side chat');
  await openSideChatTab(page, projectId, conversationId, sideConversationId);

  const sideChat = page.getByTestId('side-chat-tab');
  await expect(sideChat, 'the persisted side chat tab must mount').toBeVisible({ timeout: T.long });

  const streamHold = holdRunEventStream(page);
  const readRefusal = refuseFirstConversationRead(page, () => streamHold.failed);

  streamHold.arm();
  const runResponse = await sendPrompt(page, await composerInside(page, sideChat), RUN_PROMPT);
  const { runId } = (await runResponse.json()) as { runId: string };

  const failureAlert = runErrorCard(sideChat);
  const checkingNotice = runCheckingNotice(sideChat);
  await expect(checkingNotice, 'the non-ok Side Chat event stream must paint the neutral checking notice')
    .toBeVisible({ timeout: 120_000 });
  await expect(checkingNotice).toContainText(CHECKING_NOTICE_TEXT);
  await expect(failureAlert, 'an unresolved stream failure must not paint the failure card')
    .toHaveCount(0);

  await waitForDaemonRunStatus(page, runId, 'succeeded');
  await expect
    .poll(() => readRefusal.refused, { intervals: [250], timeout: 60_000 })
    .toBe(1);

  expect(await daemonRunStatus(page, runId), 'precondition: the run must have succeeded').toBe('succeeded');
  expect(
    await storedAssistantRunStatus(page, projectId, sideConversationId),
    'precondition: the daemon must hold the stored assistant row on the run terminal',
  ).toBe('succeeded');
  const documentLoads = await documentLoadCount(page);

  await expect(checkingNotice, 'the checking notice must leave once the run answers')
    .toHaveCount(0, { timeout: T.long });
  await expect(failureAlert, 'a failed Side Chat message read must not leave the retracted failure on screen')
    .toHaveCount(0, { timeout: T.long });
  expect(await documentLoadCount(page), 'the alert must clear without a page reload').toBe(documentLoads);
  expect(await storedAssistantRunStatus(page, projectId, sideConversationId)).toBe('succeeded');
});

// W1I.1 — the card is not merely retracted, it is never painted.
//
// W1G.1 and W1H.1 made both panes follow the run to its own terminal, so the
// alert left the screen for a turn that succeeded. It was still PAINTED first:
// both clients wrote the pane error, stamped the local assistant row `failed`
// and showed the generic "Task failed" card the moment the event stream
// answered non-OK — which is the start of a turn that then runs for seconds or
// minutes. The wave bar admits no "Task failed" for a turn that succeeded, so a
// temporary one is still a violation.
//
// The two cases below hold the whole outage class open at once — the event
// stream answered non-OK, the status probes answered 503 three times, and the
// first message read after the run succeeded answered 503 — and watch the DOM
// continuously from the send, failing on the first sighting rather than on a
// single count at the end.

test('[P0] a live stream failure with no run verdict never paints the failure card', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Live unresolved stream checking smoke');
  await expectWorkspaceReady(page);

  const { conversationId, projectId } = await currentProjectContext(page);
  const streamHold = holdRunEventStream(page);
  const probeHold = holdRunStatusProbes(page, STATUS_OUTAGE_WINDOW_MS, () => streamHold.runId);
  const readRefusal = refuseFirstConversationRead(page, () => streamHold.failed);
  await watchRunFailureCard(page);

  streamHold.arm();
  const runResponse = await sendPrompt(page, page.getByTestId('chat-composer').first(), RUN_PROMPT);
  const { runId } = (await runResponse.json()) as { runId: string };

  const failureAlert = runErrorCard(page);
  const checkingNotice = runCheckingNotice(page);

  // Whatever the pane paints for an unresolved stream failure, it paints here:
  // within a beat of the stream answering non-OK, while the run is still going.
  await expect
    .poll(
      async () =>
        (await runFailureCardSightings(page)).length > 0 || (await checkingNotice.count()) > 0,
      { intervals: [200], timeout: T.long },
    )
    .toBe(true);
  expect(
    await runFailureCardSightings(page),
    'a stream failure with no run verdict must never paint the failure card',
  ).toEqual([]);
  await expect(checkingNotice, 'the unresolved stream failure must read as a neutral checking state')
    .toBeVisible();
  await expect(checkingNotice).toContainText(CHECKING_NOTICE_TEXT);
  await expect(
    checkingNotice.getByRole('button', { name: /retry/i }),
    'a run that may still be running must not offer Retry (the B-02 double-send hazard)',
  ).toHaveCount(0);

  await waitForDaemonRunStatus(page, runId, 'succeeded');
  await expect
    .poll(() => probeHold.refused, { intervals: [250], timeout: 60_000 })
    .toBeGreaterThanOrEqual(RECHECK_MISSES_UNDER_TEST);
  await expect
    .poll(() => probeHold.outageOpen, { intervals: [250], timeout: 60_000 })
    .toBe(false);
  await expect
    .poll(() => readRefusal.refused, { intervals: [250], timeout: 60_000 })
    .toBe(1);

  await expect(checkingNotice, 'the checking notice must leave once the run answers')
    .toHaveCount(0, { timeout: T.long });
  expect(
    await storedAssistantRunStatus(page, projectId, conversationId),
    'the row must read succeeded once the run answers',
  ).toBe('succeeded');
  expect(
    await runFailureCardSightings(page),
    'the failure card must never have appeared at any point during a run that succeeded',
  ).toEqual([]);
  await expect(failureAlert).toHaveCount(0);
});

test('[P0] a Side Chat stream failure with no run verdict never paints the failure card', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Side chat unresolved stream checking smoke');
  await expectWorkspaceReady(page);

  const { conversationId, projectId } = await currentProjectContext(page);
  const sideConversationId = await createConversation(page, projectId, 'Side chat');
  await openSideChatTab(page, projectId, conversationId, sideConversationId);

  const sideChat = page.getByTestId('side-chat-tab');
  await expect(sideChat, 'the persisted side chat tab must mount').toBeVisible({ timeout: T.long });

  const streamHold = holdRunEventStream(page);
  const probeHold = holdRunStatusProbes(page, STATUS_OUTAGE_WINDOW_MS, () => streamHold.runId);
  const readRefusal = refuseFirstConversationRead(page, () => streamHold.failed);
  // Installed after the last navigation, so the watcher lives in the document
  // that receives the run.
  await watchRunFailureCard(page);

  streamHold.arm();
  const runResponse = await sendPrompt(page, await composerInside(page, sideChat), RUN_PROMPT);
  const { runId } = (await runResponse.json()) as { runId: string };

  const failureAlert = runErrorCard(sideChat);
  const checkingNotice = runCheckingNotice(sideChat);

  await expect
    .poll(
      async () =>
        (await runFailureCardSightings(page)).length > 0 || (await checkingNotice.count()) > 0,
      { intervals: [200], timeout: T.long },
    )
    .toBe(true);
  expect(
    await runFailureCardSightings(page),
    'a Side Chat stream failure with no run verdict must never paint the failure card',
  ).toEqual([]);
  await expect(checkingNotice, 'the unresolved stream failure must read as a neutral checking state')
    .toBeVisible();
  await expect(checkingNotice).toContainText(CHECKING_NOTICE_TEXT);
  await expect(
    checkingNotice.getByRole('button', { name: /retry/i }),
    'a run that may still be running must not offer Retry (the B-02 double-send hazard)',
  ).toHaveCount(0);

  await waitForDaemonRunStatus(page, runId, 'succeeded');
  await expect
    .poll(() => probeHold.refused, { intervals: [250], timeout: 60_000 })
    .toBeGreaterThanOrEqual(RECHECK_MISSES_UNDER_TEST);
  await expect
    .poll(() => probeHold.outageOpen, { intervals: [250], timeout: 60_000 })
    .toBe(false);
  await expect
    .poll(() => readRefusal.refused, { intervals: [250], timeout: 60_000 })
    .toBe(1);

  await expect(checkingNotice, 'the checking notice must leave once the run answers')
    .toHaveCount(0, { timeout: T.long });
  expect(
    await storedAssistantRunStatus(page, projectId, sideConversationId),
    'the row must read succeeded once the run answers',
  ).toBe('succeeded');
  expect(
    await runFailureCardSightings(page),
    'the failure card must never have appeared at any point during a run that succeeded',
  ).toEqual([]);
  await expect(failureAlert).toHaveCount(0);
});

// The other half of the rule: a verdict is still a verdict. Nothing is
// intercepted in these two — the fake runtime fails the way the team daemon
// recorded, the daemon classifies it, and the card must appear with the
// daemon's own facts rather than a neutral notice.

test('[P0] a stream failure whose run then really fails adopts the daemon verdict', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Live unresolved then failed smoke');
  await expectWorkspaceReady(page);

  const streamHold = holdRunEventStream(page);

  streamHold.arm();
  // The stream is refused for the life of the run, so the client never receives
  // the daemon's error frame. The card below can only come from the follow
  // reading the daemon's own stored row after the run reported `failed`.
  await sendPrompt(page, page.getByTestId('chat-composer').first(), FAILING_RUN_PROMPT);

  const failureAlert = runErrorCard(page);
  await expect(failureAlert, 'the run own failed verdict must still reach the user')
    .toBeVisible({ timeout: 120_000 });
  await expect(
    failureAlert.locator('[data-run-failure-step]'),
    'the adopted card must carry the daemon facts, not a client-invented one',
  ).toHaveCount(1);
  await expect(runCheckingNotice(page), 'the verdict ends the checking state').toHaveCount(0);
});

test('[P1] a run the daemon reported failed still shows the failure card with its facts', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Live adjudicated failure smoke');
  await expectWorkspaceReady(page);

  await sendPrompt(page, page.getByTestId('chat-composer').first(), FAILING_RUN_PROMPT);

  const failureAlert = runErrorCard(page);
  await expect(failureAlert, 'a run the daemon adjudicated must show the failure card')
    .toBeVisible({ timeout: 120_000 });
  await expect(
    failureAlert.locator('[data-run-failure-step]'),
    'the card must state the step the daemon says stopped, not a client-invented one',
  ).toHaveCount(1);
  await expect(runCheckingNotice(page), 'a verdict is not a checking state').toHaveCount(0);
});

test('[P1] a Side Chat run the daemon reported failed still shows the failure card with its facts', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Side chat adjudicated failure smoke');
  await expectWorkspaceReady(page);

  const { conversationId, projectId } = await currentProjectContext(page);
  const sideConversationId = await createConversation(page, projectId, 'Side chat');
  await openSideChatTab(page, projectId, conversationId, sideConversationId);

  const sideChat = page.getByTestId('side-chat-tab');
  await expect(sideChat, 'the persisted side chat tab must mount').toBeVisible({ timeout: T.long });

  await sendPrompt(page, await composerInside(page, sideChat), FAILING_RUN_PROMPT);

  const failureAlert = runErrorCard(sideChat);
  await expect(failureAlert, 'a run the daemon adjudicated must show the failure card')
    .toBeVisible({ timeout: 120_000 });
  await expect(
    failureAlert.locator('[data-run-failure-step]'),
    'the card must state the step the daemon says stopped, not a client-invented one',
  ).toHaveCount(1);
  await expect(runCheckingNotice(sideChat), 'a verdict is not a checking state').toHaveCount(0);
});

// W1J.2 — the create response the client never read.
//
// The two cases above start from a run the client KNOWS the id of: the 202 was
// read, `onRunCreated` fired, and only the event stream then failed. One door is
// still open before that point. `apps/daemon/src/routes/runs.ts` creates the
// run, pins it onto the stored assistant row, and only then sends the 202 —
// starting the turn AFTER the response is on the wire. A client that never reads
// that response therefore holds no run id for a run that is already going, and
// `providers/daemon.ts` surfaced the transport error with `onRunCreated` never
// called: `currentRunId` is undefined, so both panes fall through to the pane
// error and the failed row, and neither schedules a follow. The daemon runs the
// turn to success under a "Task failed" card.
//
// Both halves are forced at the transport, on the real create request:
//   * the response is LOST after the daemon accepted it — the request is
//     forwarded with `route.fetch()`, so the run is really created, pinned and
//     started, and the body the client reads back is truncated so its `json()`
//     throws. The client is left with exactly the two ids it minted itself;
//   * the request is never DELIVERED — `route.abort()` with no fetch, so the
//     daemon never sees it and no run exists. That one is an honest failure, and
//     the spec asserts it is named as one rather than dressed up as a turn that
//     might still be running.

test('[P0] a live create response lost after the daemon accepted the run never paints the failure card', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Live lost create response smoke');
  await expectWorkspaceReady(page);

  const { conversationId, projectId } = await currentProjectContext(page);
  const createHold = dropCreateRunResponseBody(page);
  await watchRunFailureCard(page);

  createHold.arm();
  await sendPrompt(page, page.getByTestId('chat-composer').first(), RUN_PROMPT);
  await expect
    .poll(() => createHold.acceptedRunId, { intervals: [100], timeout: T.medium })
    .not.toBeNull();
  const runId = createHold.acceptedRunId as string;

  const failureAlert = runErrorCard(page);
  const checkingNotice = runCheckingNotice(page);

  // Whatever the pane paints for a create response it could not read, it paints
  // here: within a beat of the send, while the run is still going.
  await expect
    .poll(
      async () =>
        (await runFailureCardSightings(page)).length > 0 || (await checkingNotice.count()) > 0,
      { intervals: [200], timeout: T.long },
    )
    .toBe(true);
  expect(
    await runFailureCardSightings(page),
    'a create response the client lost must never paint the failure card',
  ).toEqual([]);
  await expect(checkingNotice, 'the lost create response must read as a neutral checking state')
    .toBeVisible();
  await expect(checkingNotice).toContainText(CHECKING_NOTICE_TEXT);
  await expect(
    checkingNotice.getByRole('button', { name: /retry/i }),
    'a run that may exist must not offer Retry (the B-02 double-send hazard)',
  ).toHaveCount(0);

  await waitForDaemonRunStatus(page, runId, 'succeeded');

  await expect(checkingNotice, 'the checking notice must leave once the looked-up run answers')
    .toHaveCount(0, { timeout: T.long });
  // The pane must land on the turn the run actually delivered, not on a blank
  // row that merely stopped saying "failed".
  await expect(
    page.getByText(RUN_ANSWER).first(),
    'the adopted turn must show the answer the run delivered',
  ).toBeVisible({ timeout: T.long });
  expect(
    await storedAssistantRunStatus(page, projectId, conversationId),
    'the row must read succeeded once the looked-up run answers',
  ).toBe('succeeded');
  expect(
    await runFailureCardSightings(page),
    'the failure card must never have appeared at any point during a run that succeeded',
  ).toEqual([]);
  await expect(failureAlert).toHaveCount(0);
});

test('[P0] a Side Chat create response lost after the daemon accepted the run never paints the failure card', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Side chat lost create response smoke');
  await expectWorkspaceReady(page);

  const { conversationId, projectId } = await currentProjectContext(page);
  const sideConversationId = await createConversation(page, projectId, 'Side chat');
  await openSideChatTab(page, projectId, conversationId, sideConversationId);

  const sideChat = page.getByTestId('side-chat-tab');
  await expect(sideChat, 'the persisted side chat tab must mount').toBeVisible({ timeout: T.long });

  const createHold = dropCreateRunResponseBody(page);
  // Installed after the last navigation, so the watcher lives in the document
  // that receives the run.
  await watchRunFailureCard(page);

  createHold.arm();
  await sendPrompt(page, await composerInside(page, sideChat), RUN_PROMPT);
  await expect
    .poll(() => createHold.acceptedRunId, { intervals: [100], timeout: T.medium })
    .not.toBeNull();
  const runId = createHold.acceptedRunId as string;

  const failureAlert = runErrorCard(sideChat);
  const checkingNotice = runCheckingNotice(sideChat);

  await expect
    .poll(
      async () =>
        (await runFailureCardSightings(page)).length > 0 || (await checkingNotice.count()) > 0,
      { intervals: [200], timeout: T.long },
    )
    .toBe(true);
  expect(
    await runFailureCardSightings(page),
    'a Side Chat create response the client lost must never paint the failure card',
  ).toEqual([]);
  await expect(checkingNotice, 'the lost create response must read as a neutral checking state')
    .toBeVisible();
  await expect(checkingNotice).toContainText(CHECKING_NOTICE_TEXT);
  await expect(
    checkingNotice.getByRole('button', { name: /retry/i }),
    'a run that may exist must not offer Retry (the B-02 double-send hazard)',
  ).toHaveCount(0);

  await waitForDaemonRunStatus(page, runId, 'succeeded');

  await expect(checkingNotice, 'the checking notice must leave once the looked-up run answers')
    .toHaveCount(0, { timeout: T.long });
  await expect(
    sideChat.getByText(RUN_ANSWER).first(),
    'the adopted Side Chat turn must show the answer the run delivered',
  ).toBeVisible({ timeout: T.long });
  expect(
    await storedAssistantRunStatus(page, projectId, sideConversationId),
    'the row must read succeeded once the looked-up run answers',
  ).toBe('succeeded');
  expect(
    await runFailureCardSightings(page),
    'the failure card must never have appeared at any point during a run that succeeded',
  ).toEqual([]);
  await expect(failureAlert).toHaveCount(0);
});

test('[P0] a live create the daemon never received reads as a run that could not be started', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Live create never delivered smoke');
  await expectWorkspaceReady(page);

  const { conversationId } = await currentProjectContext(page);
  const createRefusal = refuseCreateRunRequest(page);
  await watchRunFailureCard(page);

  createRefusal.arm();
  await sendPromptWithoutCreateResponse(page, page.getByTestId('chat-composer').first(), RUN_PROMPT);

  const checkingNotice = runCheckingNotice(page);
  const failureAlert = runErrorCard(page);

  // The client cannot tell this apart from a lost response until it has looked,
  // so it must look before it names anything.
  await expect(
    checkingNotice,
    'a create with no answer is unresolved until the lookup has ruled a run out',
  ).toBeVisible({ timeout: T.long });
  expect(
    await runFailureCardSightings(page),
    'the failure card must not be painted before the lookup has ruled a run out',
  ).toEqual([]);

  // Once the lookup finds no run under either of the client's own ids, nothing
  // ran and the honest answer is a real failure — not a generic "Task failed".
  await expect(
    failureAlert,
    'a request the daemon never took must end as a named "could not be started" failure',
  ).toBeVisible({ timeout: T.long });
  await expect(failureAlert).toContainText(RUN_NOT_STARTED_TITLE);
  await expect(
    failureAlert.getByRole('button', { name: /retry/i }),
    'no run exists, so Retry carries no double-send hazard',
  ).toHaveCount(1);
  await expect(checkingNotice, 'the named failure ends the checking state').toHaveCount(0);
  expect(
    await conversationRunCount(page, conversationId),
    'precondition: the daemon must never have accepted the refused request',
  ).toBe(0);
});

test('[P0] a Side Chat create the daemon never received reads as a run that could not be started', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Side chat create never delivered smoke');
  await expectWorkspaceReady(page);

  const { conversationId, projectId } = await currentProjectContext(page);
  const sideConversationId = await createConversation(page, projectId, 'Side chat');
  await openSideChatTab(page, projectId, conversationId, sideConversationId);

  const sideChat = page.getByTestId('side-chat-tab');
  await expect(sideChat, 'the persisted side chat tab must mount').toBeVisible({ timeout: T.long });

  const createRefusal = refuseCreateRunRequest(page);
  await watchRunFailureCard(page);

  createRefusal.arm();
  await sendPromptWithoutCreateResponse(page, await composerInside(page, sideChat), RUN_PROMPT);

  const checkingNotice = runCheckingNotice(sideChat);
  const failureAlert = runErrorCard(sideChat);

  await expect(
    checkingNotice,
    'a create with no answer is unresolved until the lookup has ruled a run out',
  ).toBeVisible({ timeout: T.long });
  expect(
    await runFailureCardSightings(page),
    'the failure card must not be painted before the lookup has ruled a run out',
  ).toEqual([]);

  await expect(
    failureAlert,
    'a request the daemon never took must end as a named "could not be started" failure',
  ).toBeVisible({ timeout: T.long });
  await expect(failureAlert).toContainText(RUN_NOT_STARTED_TITLE);
  await expect(
    failureAlert.getByRole('button', { name: /retry/i }),
    'no run exists, so Retry carries no double-send hazard',
  ).toHaveCount(1);
  await expect(checkingNotice, 'the named failure ends the checking state').toHaveCount(0);
  expect(
    await conversationRunCount(page, sideConversationId),
    'precondition: the daemon must never have accepted the refused request',
  ).toBe(0);
});

// W1K.2 — the lookup that cannot READ the daemon.
//
// The two lost-response cases above give the lookup a daemon that answers. Take
// that away and the client is left with the honest state it must never leave:
// an unanswered read rules nothing out, so the lookup keeps looking and never
// names a failure — while the row it is looking for keeps Send disabled
// (W1J.4). Before this track the notice said only "Checking its result…" for as
// long as that lasted and offered no action, because `unreachable` was reachable
// only from the follow, which this lookup has not reached yet.
//
// The outage is forced at the transport on BOTH reads the lookup makes — the
// conversation's active runs and the stored messages — because either one
// answering would resolve the lookup and end the state under test. It is
// released only when this case is ready to use the manual re-check.

test('[P0] a live lost create whose lookup cannot read the daemon says so and its Check again adopts the run', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Live unreadable lookup smoke');
  await expectWorkspaceReady(page);

  const { conversationId, projectId } = await currentProjectContext(page);
  const createHold = dropCreateRunResponseBody(page);
  const lookupOutage = refuseLostRunCreateReads(page);
  await watchRunFailureCard(page);

  createHold.arm();
  lookupOutage.arm();
  await sendPrompt(page, page.getByTestId('chat-composer').first(), RUN_PROMPT);
  await expect
    .poll(() => createHold.acceptedRunId, { intervals: [100], timeout: T.medium })
    .not.toBeNull();
  const runId = createHold.acceptedRunId as string;

  const checkingNotice = runCheckingNotice(page);
  const composer = page.getByTestId('chat-composer').first();
  const sendButton = composer.getByTestId('chat-send').first();

  await expect(checkingNotice, 'the lost create response must read as a neutral checking state')
    .toBeVisible({ timeout: T.long });

  // The bound is LOST_RUN_CREATE_MAX_UNANSWERED_PROBES consecutive unanswered
  // probes at LOST_RUN_CREATE_PROBE_INTERVAL_MS spacing — about six seconds of
  // a daemon that answers nothing.
  await expect(
    checkingNotice,
    'a lookup that has stopped being able to read the daemon must say the daemon is not answering',
  ).toContainText(NOT_ANSWERING_TEXT, { timeout: T.long });
  const checkAgain = checkingNotice.getByRole('button', { name: CHECK_AGAIN_LABEL });
  await expect(
    checkAgain,
    'a notice with no action leaves a paused composer with no way out',
  ).toHaveCount(1);
  await expect(
    checkingNotice.getByRole('button', { name: /retry/i }),
    'the run may still be running, so Retry stays absent (the B-02 double-send hazard)',
  ).toHaveCount(0);
  expect(
    await runFailureCardSightings(page),
    'a daemon that answers nothing is not a run that failed',
  ).toEqual([]);
  expect(
    lookupOutage.refusedRunLists,
    'precondition: the lookup reads must really have gone unanswered past the bound',
  ).toBeGreaterThanOrEqual(LOOKUP_UNANSWERED_BOUND);

  // B-02: the pause stands until an authoritative lookup answers, and it still
  // says why.
  await composer.getByTestId('chat-composer-input').first().fill(PAUSED_DRAFT);
  await expect(sendButton, 'a run that may be running must still hold Send').toBeDisabled();
  await expect(checkingNotice, 'the notice must still say sending is paused')
    .toContainText(SEND_PAUSED_TEXT);
  await expect(
    composer.getByText(SEND_PAUSED_TEXT).first(),
    'the composer must still explain why its Send is disabled',
  ).toBeVisible();

  // The daemon comes back, and the user takes the action the notice offered.
  lookupOutage.release();
  await checkAgain.click();

  await expect(checkingNotice, 'the checking notice must leave once the looked-up run answers')
    .toHaveCount(0, { timeout: T.long });
  await expect(
    page.getByText(RUN_ANSWER).first(),
    'the adopted turn must show the answer the run delivered',
  ).toBeVisible({ timeout: T.long });
  expect(
    await storedAssistantRunStatus(page, projectId, conversationId),
    'the row must read succeeded once the looked-up run answers',
  ).toBe('succeeded');
  expect(
    await runFailureCardSightings(page),
    'the failure card must never have appeared at any point during a run that succeeded',
  ).toEqual([]);
  await expect(runErrorCard(page)).toHaveCount(0);
  expect(
    await conversationRunCount(page, conversationId),
    'the manual re-check must adopt the run the daemon already had, never send a second one',
  ).toBe(1);
  expect(runId, 'precondition: the daemon really accepted the create it never answered').toBeTruthy();
});

interface LostRunCreateReadOutage {
  /** Start refusing every read that could resolve a lost create. */
  arm: () => void;
  /** Let those reads through again. */
  release: () => void;
  /** How many active-run reads have been answered 503 — one per lookup probe. */
  readonly refusedRunLists: number;
}

/**
 * Answer every read that can resolve a lost create with 503 until released.
 *
 * `fetchActiveChatRuns` and `fetchMessages` each report a non-OK response as
 * `null` (`providers/daemon.ts`, `state/projects.ts`), which is what the lookup
 * counts as a probe that could not read — so a 503 here is indistinguishable
 * from the daemon outage this reproduces. Both are held because either one
 * answering resolves the lookup on the spot: the run really exists, so a
 * readable daemon names it immediately.
 *
 * The bare `GET /api/runs` list is held for the same reason and not as extra
 * strictness. `attachRecoverableRuns` reads it through `listProjectRuns`
 * (`ProjectView.tsx`) and adopts the run onto the row by its
 * `assistantMessageId`, which releases the lookup before it has probed at all —
 * a first draft of this case that let that list through never reached the state
 * it names. A daemon that is not answering answers neither list.
 *
 * `route.fallback()` rather than `route.continue()` for everything it does not
 * refuse: the create hold is registered on the same `/api/runs` path, and
 * `continue()` would send the create straight to the network instead of letting
 * that earlier handler lose its response.
 */
function refuseLostRunCreateReads(page: Page): LostRunCreateReadOutage {
  let armed = false;
  let refusedRunLists = 0;
  void page.route(
    (url) => url.pathname === '/api/runs',
    async (route) => {
      const requested = new URL(route.request().url());
      if (!armed || route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      if (requested.searchParams.get('status') === 'active') refusedRunLists += 1;
      await route.fulfill({ status: 503, body: '' });
    },
  );
  void page.route(
    (url) => /^\/api\/projects\/[^/]+\/conversations\/[^/]+\/messages$/.test(url.pathname),
    async (route) => {
      if (!armed || route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 503, body: '' });
    },
  );
  return {
    arm: () => {
      armed = true;
    },
    release: () => {
      armed = false;
    },
    get refusedRunLists() {
      return refusedRunLists;
    },
  };
}

interface RunEventStreamHold {
  /** Start refusing the next run event stream this page opens. */
  arm: () => void;
  /** True once the stream has been answered non-OK at least once. */
  readonly failed: boolean;
  /** The run whose stream is held, known from the first refused request. */
  readonly runId: string | null;
}

/**
 * Answer the held run's event stream 503, starting with the very first request —
 * the client's own live stream, opened the moment the run is created and long
 * before the run finishes. Later requests for the same stream are refused too,
 * so no reattach can recover what following the run is supposed to.
 *
 * Armed BEFORE the send, not after the create-run response, because the client
 * opens the stream the moment that response lands.
 */
function holdRunEventStream(page: Page): RunEventStreamHold {
  let armed = false;
  let heldRunId: string | null = null;
  let failed = false;
  void page.route(
    (url) => /^\/api\/runs\/[^/]+\/events$/.test(url.pathname),
    async (route) => {
      const requestedRunId = new URL(route.request().url()).pathname.split('/')[3] ?? '';
      if (!armed || (heldRunId !== null && requestedRunId !== heldRunId)) {
        await route.continue();
        return;
      }
      heldRunId = heldRunId ?? requestedRunId;
      failed = true;
      await route.fulfill({ status: 503, body: '' });
    },
  );
  return {
    arm: () => {
      armed = true;
    },
    get failed() {
      return failed;
    },
    get runId() {
      return heldRunId;
    },
  };
}

/**
 * Hold the conversation read the client schedules for itself after the stream
 * failed, so the alert can be observed on screen before the retraction lands.
 * Reads issued before the failure (the pane's own initial load) pass through.
 */
function holdConversationRead(page: Page, isArmed: () => boolean): { release: () => void } {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  void page.route(
    (url) => /^\/api\/projects\/[^/]+\/conversations\/[^/]+\/messages$/.test(url.pathname),
    async (route) => {
      if (!isArmed() || route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await gate;
      await route.continue();
    },
  );
  return { release: () => release() };
}

interface RunStatusProbeHold {
  /** How many status probes have been answered 503 so far. */
  readonly refused: number;
  /** True while the outage is still running; false before it and after it. */
  readonly outageOpen: boolean;
}

/**
 * Answer every status probe for the held run 503 for `windowMs` after the first
 * one, then let every later probe through.
 *
 * `fetchChatRunStatus` turns a non-OK response and a thrown fetch alike into
 * `null` (`apps/web/src/providers/daemon.ts`), which is exactly what the
 * reconciliation counts as a miss — so a 503 here is indistinguishable from the
 * daemon hiccup this reproduces.
 *
 * A time window rather than a probe count because the page has a second,
 * unrelated reader of the same endpoint: `AssistantMessage` fetches
 * `GET /api/runs/:id` once per settled message (`useRunStatusForRun`), so a
 * count would be spent by whichever reader asked first and the reconciliation
 * would meet fewer misses than the case names. The window is scoped to the run
 * whose event stream is held; the spec reads run status through `page.request`,
 * which does not pass through `page.route` at all.
 */
function holdRunStatusProbes(
  page: Page,
  windowMs: number,
  heldRunId: () => string | null,
): RunStatusProbeHold {
  let refused = 0;
  let outageStartedAt: number | null = null;
  const outageOpen = () => outageStartedAt !== null && Date.now() - outageStartedAt < windowMs;
  void page.route(
    (url) => /^\/api\/runs\/[^/]+$/.test(url.pathname),
    async (route) => {
      const requestedRunId = new URL(route.request().url()).pathname.split('/')[3] ?? '';
      const held = heldRunId();
      if (held === null || requestedRunId !== held || (outageStartedAt !== null && !outageOpen())) {
        await route.continue();
        return;
      }
      outageStartedAt = outageStartedAt ?? Date.now();
      refused += 1;
      await route.fulfill({ status: 503, body: '' });
    },
  );
  return {
    get refused() {
      return refused;
    },
    get outageOpen() {
      return outageOpen();
    },
  };
}

interface ConversationReadRefusal {
  /** How many conversation reads have been answered 503 so far. */
  readonly refused: number;
}

/**
 * Answer the FIRST conversation read the client makes after the stream failed
 * with 503, and let every later one through.
 *
 * `listMessages` swallows that into an empty array (`state/projects.ts`), which
 * is the read the pane makes once the run reports its terminal. Reads issued
 * before the failure (the pane's own initial load) pass through.
 */
function refuseFirstConversationRead(page: Page, isArmed: () => boolean): ConversationReadRefusal {
  let refused = 0;
  void page.route(
    (url) => /^\/api\/projects\/[^/]+\/conversations\/[^/]+\/messages$/.test(url.pathname),
    async (route) => {
      if (!isArmed() || route.request().method() !== 'GET' || refused >= 1) {
        await route.continue();
        return;
      }
      refused += 1;
      await route.fulfill({ status: 503, body: '' });
    },
  );
  return {
    get refused() {
      return refused;
    },
  };
}

/**
 * The composer laid out inside `container`.
 *
 * Every `ChatPane` portals its composer to `document.body`
 * (`chat-composer-fixed-layer` in `ChatPane.tsx`), so the side chat's composer
 * is not a DOM descendant of its tab and cannot be reached by scoping. Two
 * panes are on screen here, so pick by geometry: the one whose box sits inside
 * the container's own box.
 */
async function composerInside(page: Page, container: Locator): Promise<Locator> {
  const containerBox = await container.boundingBox();
  if (!containerBox) throw new Error('the container has no layout box');
  const composers = page.getByTestId('chat-composer');
  await expect(composers.first()).toBeVisible({ timeout: T.medium });
  const count = await composers.count();
  for (let index = 0; index < count; index += 1) {
    const box = await composers.nth(index).boundingBox();
    if (!box) continue;
    const centre = box.x + box.width / 2;
    if (centre >= containerBox.x && centre <= containerBox.x + containerBox.width) {
      return composers.nth(index);
    }
  }
  throw new Error(`no composer is laid out inside the container (${count} on screen)`);
}

async function waitForDaemonRunStatus(page: Page, runId: string, status: string): Promise<void> {
  await expect
    .poll(async () => daemonRunStatus(page, runId), { intervals: [250], timeout: 120_000 })
    .toBe(status);
}

async function daemonRunStatus(page: Page, runId: string): Promise<string> {
  const response = await page.request.get(`/api/runs/${runId}`);
  if (!response.ok()) return `http-${response.status()}`;
  return ((await response.json()) as { status: string }).status;
}

async function storedAssistantRunStatus(
  page: Page,
  projectId: string,
  conversationId: string,
): Promise<string | null> {
  const response = await page.request.get(
    `/api/projects/${projectId}/conversations/${conversationId}/messages`,
  );
  expect(response.ok()).toBeTruthy();
  const { messages } = (await response.json()) as {
    messages: Array<{ role: string; runStatus?: string }>;
  };
  return messages.filter((message) => message.role === 'assistant').pop()?.runStatus ?? null;
}

async function documentLoadCount(page: Page): Promise<number> {
  return page.evaluate((key) => Number(window.sessionStorage.getItem(key) ?? '0'), LOAD_COUNTER_KEY);
}

async function createConversation(page: Page, projectId: string, title: string): Promise<string> {
  const response = await page.request.post(`/api/projects/${projectId}/conversations`, {
    data: { title },
  });
  expect(response.ok()).toBeTruthy();
  const { conversation } = (await response.json()) as { conversation: { id: string } };
  return conversation.id;
}

async function openSideChatTab(
  page: Page,
  projectId: string,
  primaryConversationId: string,
  sideConversationId: string,
) {
  const tabId = `chat:${sideConversationId}`;
  const response = await page.request.put(`/api/projects/${projectId}/tabs`, {
    data: { tabs: [tabId], active: tabId, updatedAt: Date.now() },
  });
  expect(response.ok()).toBeTruthy();
  // `loadTabs` reconciles the daemon record against a per-project localStorage
  // cache by `updatedAt`; dropping the cache leaves the daemon record as the
  // only claim, which is what a browser that never opened this project sees.
  await page.evaluate(
    (id) => window.localStorage.removeItem(`mishmash:tabs:${id}`),
    projectId,
  );
  // Deep-link the PRIMARY conversation back into the route. The side chat is
  // newer, and a project opened without a conversation segment selects the
  // newest one — which would make the tab mirror the primary chat's state
  // (`activeConversationChat` in `SideChatTab`) instead of running its own
  // `useConversationChat`.
  await page.goto(`/projects/${projectId}/conversations/${primaryConversationId}`, {
    waitUntil: 'domcontentloaded',
  });
  await expectWorkspaceReady(page);
}

async function createProject(page: Page, name: string, agentId: FakeAgentId = 'codex') {
  await configureFakeAgent(page, agentId);
  await installBrowserAgentConfig(page, agentId);
  await gotoEntryHome(page);
  await setBrowserAgentConfig(page, agentId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForLoadingToClear(page);
  await setBrowserAgentConfig(page, agentId);
  await configureFakeAgent(page, agentId);
  await dismissPrivacyDialog(page);
  await openNewProjectModalFromProjects(page);
  await page.getByTestId('new-project-tab-prototype').click();
  await page.getByTestId('new-project-name').fill(name);
  await page.getByTestId('create-project').click();
}

async function gotoEntryHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForLoadingToClear(page);
  await dismissPrivacyDialog(page);
  await expect(page.getByTestId('home-hero')).toBeVisible();
  await expect(page.getByTestId('home-hero-input')).toBeVisible();
}

async function dismissPrivacyDialog(page: Page) {
  const privacyDialog = page.getByRole('dialog').filter({ hasText: 'Help us improve MishMash' });
  if (await privacyDialog.isVisible()) {
    await privacyDialog.getByRole('button', { name: /I get it|not now|got it|don't share/i }).click();
    await expect(privacyDialog).toHaveCount(0);
  }
}

async function expectWorkspaceReady(page: Page) {
  await waitForLoadingToClear(page);
  await expect(page).toHaveURL(/\/projects\//);
  await expect(page.getByTestId('chat-composer').first()).toBeVisible();
  await expect(page.getByTestId('file-workspace')).toBeVisible();
}

async function waitForLoadingToClear(page: Page) {
  await page.getByText(APP_LOADING_TEXT).first().waitFor({ state: 'hidden', timeout: T.long });
}

async function sendPrompt(page: Page, composer: Locator, prompt: string) {
  const input = composer.getByTestId('chat-composer-input').first();
  const sendButton = composer.getByTestId('chat-send').first();
  await expect(input).toBeVisible({ timeout: T.medium });
  await input.click();
  await input.fill(prompt);
  await expect(input).toHaveText(prompt);
  await expect(sendButton).toBeEnabled();
  const response = await Promise.race([
    page.waitForResponse(isCreateRunResponse, { timeout: T.medium }),
    (async () => {
      await sendButton.click();
      return page.waitForResponse(isCreateRunResponse, { timeout: T.medium });
    })(),
  ]);
  expect(response.ok()).toBeTruthy();
  return response;
}

function isCreateRunResponse(response: Response): boolean {
  const url = new URL(response.url());
  return url.pathname === '/api/runs' && response.request().method() === 'POST';
}

async function configureFakeAgent(page: Page, agentId: FakeAgentId) {
  const runtime = fakeRuntimes[agentId];
  const response = await page.request.put('/api/app-config', {
    data: {
      onboardingCompleted: true,
      agentId,
      agentModels: { [agentId]: { model: 'default', reasoning: 'default' } },
      agentCliEnv: { [agentId]: runtime.env },
      skillId: null,
      designSystemId: null,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function setBrowserAgentConfig(page: Page, agentId: FakeAgentId) {
  await installBrowserAgentConfig(page, agentId);
  await page.evaluate(installConfig, { key: STORAGE_KEY, id: agentId, env: fakeRuntimes[agentId].env });
}

async function installBrowserAgentConfig(page: Page, agentId: FakeAgentId) {
  await page.addInitScript(installConfig, {
    key: STORAGE_KEY,
    id: agentId,
    env: fakeRuntimes[agentId].env,
  });
}

function installConfig({ key, id, env }: { key: string; id: FakeAgentId; env: Record<string, string> }) {
  window.localStorage.setItem(
    key,
    JSON.stringify({
      mode: 'daemon',
      apiKey: '',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
      agentId: id,
      skillId: null,
      designSystemId: null,
      onboardingCompleted: true,
      agentModels: { [id]: { model: 'default', reasoning: 'default' } },
      agentCliEnv: { [id]: env },
    }),
  );
}

async function resetDaemonAppConfig(page: Page) {
  const response = await page.request.put('/api/app-config', {
    data: {
      onboardingCompleted: true,
      agentId: 'mock',
      agentModels: {},
      agentCliEnv: {},
      skillId: null,
      designSystemId: null,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function currentProjectContext(
  page: Page,
): Promise<{ conversationId: string; projectId: string }> {
  const current = new URL(page.url());
  const [, projects, projectId] = current.pathname.split('/');
  if (projects !== 'projects' || !projectId) {
    throw new Error(`unexpected project route: ${current.pathname}`);
  }
  const response = await page.request.get(`/api/projects/${projectId}/conversations`);
  expect(response.ok()).toBeTruthy();
  const { conversations } = (await response.json()) as {
    conversations: Array<{ id: string; updatedAt: number }>;
  };
  const active = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!active) {
    throw new Error(`no conversations found for project ${projectId}`);
  }
  return { conversationId: active.id, projectId };
}

interface CreateResponseHold {
  /** Lose the body of the next create response this page reads. */
  arm: () => void;
  /** The run the daemon really created for the request whose body was lost. */
  readonly acceptedRunId: string | null;
}

/**
 * Let the create request through to the daemon, then give the client back a
 * truncated body so `createResp.json()` throws.
 *
 * This is the wire shape of the door under test and not a simulation of it: the
 * daemon receives the request, creates the run, pins it onto the stored
 * assistant row and starts the turn (`apps/daemon/src/routes/runs.ts`), while
 * the client is left holding only the `clientRequestId` and
 * `assistantMessageId` it minted itself. Only the FIRST create is held, so a
 * Retry offered afterwards would reach the daemon normally.
 */
function dropCreateRunResponseBody(page: Page): CreateResponseHold {
  let armed = false;
  let acceptedRunId: string | null = null;
  void page.route(
    (url) => url.pathname === '/api/runs',
    async (route) => {
      if (!armed || route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      armed = false;
      const response = await route.fetch();
      const body = await response.text();
      acceptedRunId = (JSON.parse(body) as { runId: string }).runId;
      await route.fulfill({
        status: response.status(),
        headers: { 'content-type': 'application/json' },
        // Truncated at the first key: a 202 whose body cannot be parsed is the
        // same to the client as a connection dropped after the commit.
        body: body.slice(0, 9),
      });
    },
  );
  return {
    arm: () => {
      armed = true;
    },
    get acceptedRunId() {
      return acceptedRunId;
    },
  };
}

interface CreateRequestRefusal {
  /** Refuse to deliver the next create request this page makes. */
  arm: () => void;
  /** True once a create request has been refused. */
  readonly refused: boolean;
}

/**
 * Fail the create request before it reaches the daemon, so no run is ever
 * created. The other half of the ambiguity: the client sees the same transport
 * error as the lost-response case and must not name either outcome before it
 * has looked.
 */
function refuseCreateRunRequest(page: Page): CreateRequestRefusal {
  let armed = false;
  let refused = false;
  void page.route(
    (url) => url.pathname === '/api/runs',
    async (route) => {
      if (!armed || route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      armed = false;
      refused = true;
      await route.abort();
    },
  );
  return {
    arm: () => {
      armed = true;
    },
    get refused() {
      return refused;
    },
  };
}

/**
 * Send a prompt whose create request never produces a response.
 *
 * `sendPrompt` waits for the create RESPONSE, which never arrives when the
 * request is aborted at the transport; wait for the request leaving the page
 * instead.
 */
async function sendPromptWithoutCreateResponse(page: Page, composer: Locator, prompt: string) {
  const input = composer.getByTestId('chat-composer-input').first();
  const sendButton = composer.getByTestId('chat-send').first();
  await expect(input).toBeVisible({ timeout: T.medium });
  await input.click();
  await input.fill(prompt);
  await expect(input).toHaveText(prompt);
  await expect(sendButton).toBeEnabled();
  const request = page.waitForRequest(
    (candidate) =>
      new URL(candidate.url()).pathname === '/api/runs' && candidate.method() === 'POST',
    { timeout: T.medium },
  );
  await sendButton.click();
  await request;
}

/**
 * How many runs the daemon holds for a conversation. Read through
 * `page.request`, which does not pass through `page.route`, so a refused create
 * cannot hide behind the same interception that refused it.
 */
async function conversationRunCount(page: Page, conversationId: string): Promise<number> {
  const response = await page.request.get(
    `/api/runs?conversationId=${encodeURIComponent(conversationId)}`,
  );
  expect(response.ok()).toBeTruthy();
  const { runs } = (await response.json()) as { runs: unknown[] };
  return runs.length;
}
