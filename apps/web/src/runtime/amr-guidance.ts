import type { RunFailureDetail } from '@open-design/contracts';

// Shared logic that maps a failed run's error code + agent into the failure
// UI: which contextual button the gray error card shows, whether to override
// the error text, and whether to show the AMR promotion card below. Kept in
// its own module so ChatPane / ProjectView / AssistantMessage can import it
// without a circular dependency.

// AMR model-gateway console wallet (account, balance, recharge). The
// production console previously lived on the retired open-design.ai domain;
// that host is not this fork's (docs/FORK-PIN.md), so the production link is
// disabled rather than repointed at an invented replacement egress
// destination. `#` renders as an inert same-page anchor everywhere this is
// consumed as an href (AmrLoginPill, AmrBalanceDialog, SettingsDialog,
// ChatPane) and attributedAmrUrl's non-URL fallback branch appends
// attribution params as a harmless fragment query rather than throwing.
export const AMR_CONSOLE_URL = '#';
export const AMR_RECHARGE_URL = AMR_CONSOLE_URL;

const AMR_CONSOLE_URL_BY_PROFILE: Record<string, string> = {
  prod: AMR_CONSOLE_URL,
  test: 'https://vela.powerformer.net/wallet?source=open_design',
  local: 'http://localhost:5173/wallet?source=open_design',
};

export function amrConsoleUrlForProfile(profile: string | null | undefined): string {
  const normalized = profile?.trim() || 'prod';
  return AMR_CONSOLE_URL_BY_PROFILE[normalized] ?? AMR_CONSOLE_URL;
}

export function amrRechargeUrlForProfile(profile: string | null | undefined): string {
  return amrConsoleUrlForProfile(profile);
}

// Console wallet deep-linked to open the subscription/plans modal
// (`view=plans`), used by the "Upgrade" affordances next to the plan tier.
export function amrPlansUrlForProfile(profile: string | null | undefined): string {
  const base = amrConsoleUrlForProfile(profile);
  return base.includes('?') ? `${base}&view=plans` : `${base}?view=plans`;
}

export function amrProfileBadgeLabel(profile: string | null | undefined): string | null {
  if (profile === 'test') return 'TEST';
  if (profile === 'local') return 'LOCAL';
  return null;
}

// Codes that mean a non-AMR agent hit "the model service rejected or could not
// serve the run" — auth missing/invalid, quota/rate exhausted, or the upstream
// model endpoint was unavailable. These are the failures worth promoting AMR
// for. Generic process failures (AGENT_EXECUTION_FAILED) and missing binaries
// (AGENT_UNAVAILABLE) are excluded.
const PROMOTE_AMR_CODES = new Set<string>([
  'AGENT_AUTH_REQUIRED',
  'UNAUTHORIZED',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
]);

// Primary action offered in the gray error card.
//   - retry:                       re-run with the current agent.
//   - authorize:                   AMR sign-in/authorize flow, then auto-retry on success.
//   - recharge:                    open the AMR wallet (manual retry afterwards).
//   - upgrade:                     open the AMR plans view (manual retry afterwards).
//   - launch-terminal-auth:        Antigravity-specific. agy's `-p`
//                                  print mode cannot complete Google
//                                  Sign-In on its own (no input field
//                                  for the auth code), so OD spawns a
//                                  system Terminal running `agy` and
//                                  the user finishes OAuth there.
//   - launch-terminal-switch-model: Antigravity-specific. agy has no
//                                  `--model` flag (upstream #35), so
//                                  switching to a model with available
//                                  quota means opening agy's TUI and
//                                  using its Switch Model picker. The
//                                  daemon spawns the same terminal as
//                                  launch-terminal-auth — the button
//                                  label is the only thing that changes.
// Both terminal-launch actions pair with `secondaryRetry: true` so the
// user has a Retry button after the external step completes (OAuth /
// switching models happens out-of-band; we can't auto-retry from the
// daemon side).
export type RunFailurePrimaryAction =
  | 'retry'
  | 'authorize'
  | 'recharge'
  | 'upgrade'
  | 'launch-terminal-auth'
  | 'launch-terminal-switch-model'
  // No self-contained recovery button. Used when retrying is futile (e.g. a
  // hard quota / exhausted credits) and the only forward path is the AMR switch
  // card rendered below, so the card shows guidance copy without a dead Retry.
  | 'none';

// i18n keys for the gray-card text override (null = show the raw error).
// Keys ending in a value with `{agent}` are interpolated at render time via
// t(key, { agent }) (see ChatPane displayError).
export type RunFailureMessageKey =
  | 'chat.amrError.authMessage'
  | 'chat.amrError.balanceMessage'
  | 'chat.connectionDropped'
  | 'chat.runError.signInMessage.amr'
  | 'chat.runError.signInMessage.other'
  | 'chat.runError.cliMissingMessage'
  | 'chat.runError.promptTooLargeMessage'
  | 'chat.runError.modelUnavailableMessage'
  | 'chat.runError.rateLimitedMessage'
  | 'chat.runError.upstreamUnavailableMessage'
  | 'chat.runError.toolLoopMessage'
  | 'chat.runError.outputInvalidMessage'
  | 'chat.runError.runtimeConfigMessage'
  | 'chat.runError.quotaExhaustedMessage'
  | 'chat.runError.workspaceCreditsMessage'
  | 'chat.runError.timedOutMessage'
  | 'chat.runError.inactivityTimeoutMessage'
  | 'chat.runError.emptyOutputMessage'
  | 'chat.runError.sessionExpiredMessage'
  | 'chat.runError.gitBashMissingMessage'
  | 'chat.runError.cpuUnsupportedMessage'
  | 'chat.runError.stoppedBySystemMessage'
  | null;

// i18n keys for the unified error card's TITLE (the "error type" line above the
// detail message). Frontend-only mapping from error code → human-readable type;
// the daemon does not yet emit a type name (the raw status label is just the
// word "error"). A full backend type ⇄ frontend pairing is a later effort.
export type RunFailureTitleKey =
  | 'chat.runError.title.authRequired'
  | 'chat.runError.title.balance'
  | 'chat.runError.title.connectionDropped'
  | 'chat.runError.title.signInRequired'
  | 'chat.runError.title.rateLimited'
  | 'chat.amrBalanceGate.title'
  | 'chat.runError.title.cliMissing'
  | 'chat.runError.title.promptTooLarge'
  | 'chat.runError.title.modelUnavailable'
  | 'chat.runError.title.upstreamUnavailable'
  | 'chat.runError.title.toolLoop'
  | 'chat.runError.title.outputInvalid'
  | 'chat.runError.title.runtimeConfig'
  | 'chat.runError.title.quotaExhausted'
  | 'chat.runError.title.timedOut'
  | 'chat.runError.title.emptyOutput'
  | 'chat.runError.title.sessionExpired'
  | 'chat.runError.title.gitBashMissing'
  | 'chat.runError.title.artifactMissing'
  | 'chat.runError.title.cpuUnsupported'
  | 'chat.runError.title.cliOutdated'
  | 'chat.runError.title.attachmentUnsupported'
  | 'chat.runError.title.requestRejected'
  | 'chat.runError.title.toolFailed'
  | 'chat.runError.title.agentDidNotStart'
  | 'chat.runError.title.agentStopped'
  | 'chat.runError.title.agentCrashed'
  | 'chat.runError.title.stoppedBySystem'
  | 'chat.runError.title.permissionBlocked'
  | 'chat.runError.title.stopped'
  | 'chat.runError.title.generic';

export interface RunFailureUi {
  primaryAction: RunFailurePrimaryAction;
  // Title shown above the detail message — names the failure type.
  titleKey: RunFailureTitleKey;
  // Override the gray error card's text (e.g. AMR auth / balance get a clearer
  // explanation than the raw upstream string).
  messageKey: RunFailureMessageKey;
  // Show a secondary plain "retry" button alongside the primary action (used
  // by the recharge case, where retry is manual after topping up).
  secondaryRetry: boolean;
  // Show the AMR promotion card under the gray error card.
  showSwitchCard: boolean;
}

// Small helper for the common shape: a named failure type + actionable copy,
// recovered by re-running once the user has followed the instruction. No AMR
// promotion (these root causes aren't "switch to hosted model" cases).
function retryWithGuidance(
  titleKey: RunFailureTitleKey,
  messageKey: RunFailureMessageKey,
): RunFailureUi {
  return {
    primaryAction: 'retry',
    titleKey,
    messageKey,
    secondaryRetry: false,
    showSwitchCard: false,
  };
}

// Agent-agnostic failure codes that carry a clear root cause and a concrete
// fix, mapped the same way regardless of which agent produced them. The daemon
// already classifies these into failure_category / user_action
// (apps/daemon/src/run-failure-classification.ts); this is the user-facing half
// of that taxonomy — a human-readable type name plus a one-line instruction,
// with the raw upstream string preserved in the card's collapsible source area.
const AGENT_AGNOSTIC_FAILURE_UI: Record<string, RunFailureUi> = {
  // The run completed but did not leave a deliverable file. Name the actual
  // missing outcome in the compact card and keep the raw reason in details.
  ARTIFACT_NOT_FOUND: retryWithGuidance(
    'chat.runError.title.artifactMissing',
    null,
  ),
  // CLI binary not found on PATH (user_action: install_cli).
  AGENT_UNAVAILABLE: retryWithGuidance(
    'chat.runError.title.cliMissing',
    'chat.runError.cliMissingMessage',
  ),
  // Input exceeded the model context window (user_action: reduce_context).
  AGENT_PROMPT_TOO_LARGE: retryWithGuidance(
    'chat.runError.title.promptTooLarge',
    'chat.runError.promptTooLargeMessage',
  ),
  // Selected model is missing/disabled (user_action: switch_model).
  AMR_MODEL_UNAVAILABLE: retryWithGuidance(
    'chat.runError.title.modelUnavailable',
    'chat.runError.modelUnavailableMessage',
  ),
  // Guard halted a repeating, non-progressing tool loop (user_action: retry
  // after checking the real target).
  TOOL_LOOP_DETECTED: retryWithGuidance(
    'chat.runError.title.toolLoop',
    'chat.runError.toolLoopMessage',
  ),
  // Model emitted a fabricated role marker and was aborted; a plain retry
  // usually recovers.
  ROLE_MARKER_HALLUCINATION: retryWithGuidance(
    'chat.runError.title.outputInvalid',
    'chat.runError.outputInvalidMessage',
  ),
  // Checked-in runtime def failed strict validation (user_action: fix_config);
  // the user can't self-repair, so the copy points at update/support.
  AGENT_RUNTIME_DEF_INVALID: retryWithGuidance(
    'chat.runError.title.runtimeConfig',
    'chat.runError.runtimeConfigMessage',
  ),
};

// Same "switch to the hosted alternative" shape for causes where retrying with
// the current provider is futile (hard quota / exhausted credits): no plain
// Retry button, just guidance copy + the AMR promotion card below.
function switchToAlternative(
  titleKey: RunFailureTitleKey,
  messageKey: RunFailureMessageKey,
): RunFailureUi {
  return {
    primaryAction: 'none',
    titleKey,
    messageKey,
    secondaryRetry: false,
    showSwitchCard: true,
  };
}

// Failure causes keyed by the daemon's fine-grained `failure_detail`, for the
// cases where the coarse `error_code` alone is wrong or too vague. This layer
// can OVERRIDE a code mapping — e.g. `hard_quota` and a transient 429 share
// `error_code: RATE_LIMITED`, but only the transient one should offer Retry.
// Applied after AMR/Antigravity agent-specific handling (which own their own
// quota/auth flows) and before the generic code branches.
const DETAIL_FAILURE_UI: Record<string, RunFailureUi> = {
  // Provider quota / billing hard-stop: retrying reproduces the failure, so
  // drop Retry and steer to the hosted-AMR switch card.
  hard_quota: switchToAlternative(
    'chat.runError.title.quotaExhausted',
    'chat.runError.quotaExhaustedMessage',
  ),
  workspace_credits_exhausted: switchToAlternative(
    'chat.runError.title.quotaExhausted',
    'chat.runError.workspaceCreditsMessage',
  ),
  // CLI binary missing detected only from text (leaks in as the opaque
  // AGENT_EXECUTION_FAILED code, not AGENT_UNAVAILABLE) — reuse the same
  // "install the CLI, then retry" card the code path already renders.
  cli_not_installed: retryWithGuidance(
    'chat.runError.title.cliMissing',
    'chat.runError.cliMissingMessage',
  ),
};

// Agent-agnostic failure causes keyed by the daemon's `failure_detail`, resolved
// BEFORE the AMR/Antigravity agent branches (unlike DETAIL_FAILURE_UI above).
// These are engine-neutral run outcomes — a timeout, an empty result, a stale
// resumed session, a missing Git Bash — that carry the same named type + fix for
// every agent, including AMR. They leak in under the opaque AGENT_EXECUTION_FAILED
// / process-exit codes, so without this the card would only show the raw stderr.
const AGENT_AGNOSTIC_DETAIL_FAILURE_UI: Record<string, RunFailureUi> = {
  // Hard wall-clock timeout for the run (daemon user_action: retry). A plain
  // retry — optionally with a smaller task — usually gets through.
  timeout: retryWithGuidance(
    'chat.runError.title.timedOut',
    'chat.runError.timedOutMessage',
  ),
  // The agent stalled (no new output for too long) and was cut off as a
  // timeout. Distinct copy from a hard timeout, same retry recovery.
  inactivity_timeout: retryWithGuidance(
    'chat.runError.title.timedOut',
    'chat.runError.inactivityTimeoutMessage',
  ),
  // Run terminated without producing any output (daemon user_action: retry);
  // usually transient, so name it and offer a straight retry.
  empty_output: retryWithGuidance(
    'chat.runError.title.emptyOutput',
    'chat.runError.emptyOutputMessage',
  ),
  // A resumed agent session id went stale; the daemon already cleared it so the
  // next run starts fresh (#3408). Name it as recoverable and offer Retry.
  session_resume_expired: retryWithGuidance(
    'chat.runError.title.sessionExpired',
    'chat.runError.sessionExpiredMessage',
  ),
  // Windows: the agent needs Git Bash to spawn and it isn't installed
  // (daemon user_action: install_cli). Point at installing Git for Windows,
  // then retry — same "install the dependency, then re-run" shape as cli_missing.
  git_bash_missing: retryWithGuidance(
    'chat.runError.title.gitBashMissing',
    'chat.runError.gitBashMissingMessage',
  ),
  // The bundled agent binary needs a CPU instruction set (AVX2) this device
  // doesn't have, so it crashes on launch — retrying reproduces the crash and
  // switching hosted models doesn't help (the runtime binary is the problem).
  // The fix is updating MishMash to a build that bundles a compatible
  // (baseline) runtime, so show guidance copy without a dead Retry button.
  // The OS killed a step in the run (SIGKILL / exit 137) — the case behind the
  // 77s ffmpeg encode that died with no message. Name it and point at the
  // documented subprocess limits (docs/subprocess-limits.md) instead of
  // leaving the user with a silent kill.
  signal_killed: retryWithGuidance(
    'chat.runError.title.stoppedBySystem',
    'chat.runError.stoppedBySystemMessage',
  ),
  cpu_unsupported: {
    primaryAction: 'none',
    titleKey: 'chat.runError.title.cpuUnsupported',
    messageKey: 'chat.runError.cpuUnsupportedMessage',
    secondaryRetry: false,
    showSwitchCard: false,
  },
};

/**
 * Every failure cause the daemon classifies has a user-facing name.
 *
 * `failureDetail` is a closed union owned by `packages/contracts`. Typing this
 * map as a TOTAL `Record` over that union is what enforces the invariant: a
 * cause cannot be added upstream without this file naming it, so a classified
 * failure can never reach the user as the catch-all "Task failed". `unknown` is
 * the single deliberate exception — it is the daemon saying it could not tell,
 * and the generic title is then the honest answer.
 *
 * This map supplies the TITLE only. Which button the card offers, and any copy
 * override, stay with the precedence rules in `resolveRunFailureUi` below; this
 * fills the title the generic fallbacks would otherwise use.
 */
const RUN_FAILURE_TITLE_BY_DETAIL: Record<RunFailureDetail, RunFailureTitleKey> = {
  // Sign-in and credentials.
  auth_required: 'chat.runError.title.signInRequired',
  stale_profile: 'chat.runError.title.signInRequired',
  refresh_token_reused: 'chat.runError.title.signInRequired',
  missing_api_key: 'chat.runError.title.authRequired',
  invalid_api_key: 'chat.runError.title.authRequired',
  // Quota, billing, and rate limits.
  hard_quota: 'chat.runError.title.quotaExhausted',
  workspace_credits_exhausted: 'chat.runError.title.quotaExhausted',
  rate_limit_429: 'chat.runError.title.rateLimited',
  amr_insufficient_balance: 'chat.runError.title.balance',
  amr_tier_upgrade_required: 'chat.amrBalanceGate.title',
  // Model selection.
  model_not_found: 'chat.runError.title.modelUnavailable',
  model_not_supported: 'chat.runError.title.modelUnavailable',
  model_disabled: 'chat.runError.title.modelUnavailable',
  local_model_not_loaded: 'chat.runError.title.modelUnavailable',
  cli_version_incompatible: 'chat.runError.title.cliOutdated',
  // What we sent.
  prompt_too_large: 'chat.runError.title.promptTooLarge',
  request_too_large: 'chat.runError.title.promptTooLarge',
  attachment_media_type_unsupported: 'chat.runError.title.attachmentUnsupported',
  tool_schema_invalid: 'chat.runError.title.requestRejected',
  prompt_tokenization_failed: 'chat.runError.title.requestRejected',
  provider_resource_not_found: 'chat.runError.title.requestRejected',
  upstream_client_error: 'chat.runError.title.requestRejected',
  // The model service.
  upstream_5xx: 'chat.runError.title.upstreamUnavailable',
  provider_high_demand: 'chat.runError.title.upstreamUnavailable',
  provider_routing_error: 'chat.runError.title.upstreamUnavailable',
  stream_disconnected: 'chat.runError.title.connectionDropped',
  network_error: 'chat.runError.title.connectionDropped',
  // A dropped stream mid-response: the shape a sleeping machine produces.
  stream_error: 'chat.runError.title.connectionDropped',
  stdin_write_eof: 'chat.runError.title.connectionDropped',
  // Time.
  inactivity_timeout: 'chat.runError.title.timedOut',
  timeout: 'chat.runError.title.timedOut',
  // What came back.
  empty_output: 'chat.runError.title.emptyOutput',
  tool_error: 'chat.runError.title.toolFailed',
  plugin_artifact_missing: 'chat.runError.title.artifactMissing',
  agent_protocol_error: 'chat.runError.title.outputInvalid',
  fabricated_role_marker: 'chat.runError.title.outputInvalid',
  qoder_stop_sequence: 'chat.runError.title.outputInvalid',
  // The local agent process.
  cli_not_installed: 'chat.runError.title.cliMissing',
  git_bash_missing: 'chat.runError.title.gitBashMissing',
  agent_config_invalid: 'chat.runError.title.runtimeConfig',
  spawn_failed: 'chat.runError.title.agentDidNotStart',
  spawn_enoexec: 'chat.runError.title.agentDidNotStart',
  spawn_ebadf: 'chat.runError.title.agentDidNotStart',
  spawn_eperm: 'chat.runError.title.agentDidNotStart',
  cpu_unsupported: 'chat.runError.title.cpuUnsupported',
  session_resume_expired: 'chat.runError.title.sessionExpired',
  permission_request_not_found: 'chat.runError.title.permissionBlocked',
  process_crashed: 'chat.runError.title.agentCrashed',
  // SIGKILL / exit 137 — the OS, not the agent, ended the step.
  signal_killed: 'chat.runError.title.stoppedBySystem',
  // Someone or something stopped the run on purpose.
  interrupted: 'chat.runError.title.stopped',
  user_cancelled: 'chat.runError.title.stopped',
  // The agent exited badly and said why only in its own text, which the card
  // shows verbatim under the title.
  exit_code: 'chat.runError.title.agentStopped',
  exit_nonzero: 'chat.runError.title.agentStopped',
  terminated_unknown: 'chat.runError.title.agentStopped',
  fatal_rpc_error: 'chat.runError.title.agentStopped',
  execution_failed: 'chat.runError.title.agentStopped',
  // The daemon could not classify it; "Task failed" is then the honest title.
  unknown: 'chat.runError.title.generic',
};

/** The named title for a classified cause, or null when the daemon reported no
 *  cause (or only `unknown`) and the generic title is the truthful one. */
function namedTitleForDetail(
  detail: string | null | undefined,
): RunFailureTitleKey | null {
  if (typeof detail !== 'string') return null;
  const titleKey = RUN_FAILURE_TITLE_BY_DETAIL[detail as RunFailureDetail];
  if (!titleKey || titleKey === 'chat.runError.title.generic') return null;
  return titleKey;
}

// Resolve the failure UI for a failed run:
//   - agent-agnostic root cause (cli missing, prompt too large, model
//     unavailable, tool loop, bad output, bad runtime def) → named type + fix
//   - agent-agnostic failure_detail (timeout, empty output, stale resumed
//     session, missing Git Bash) → named type + retry, for every agent
//   - AMR agent, auth required      → authorize-and-retry button, clearer copy
//   - AMR agent, insufficient funds → recharge button + manual retry, clearer copy
//   - AMR agent, tier entitlement   → upgrade button + manual retry
//   - AMR agent, anything else      → plain retry
//   - fine-grained failure_detail (hard quota, workspace credits, text-detected
//     cli-missing) → named type + fix, overriding a too-coarse code
//   - non-AMR agent, model/auth/quota error → plain retry + promotion card
//   - non-AMR agent, generic failure        → plain retry
export function resolveRunFailureUi(
  code: string | null | undefined,
  detail: string | null | undefined,
  agentId: string | null | undefined,
): RunFailureUi {
  // Agent-agnostic codes resolve first so an AMR/Antigravity run that hits one
  // of them still gets the specific guidance instead of the generic fallback.
  const agnostic = typeof code === 'string' ? AGENT_AGNOSTIC_FAILURE_UI[code] : undefined;
  if (agnostic) return agnostic;
  // Engine-neutral failure_detail (timeout, empty output, stale resumed session,
  // missing Git Bash) resolves before the agent branches so it applies to every
  // agent — including AMR, whose branch below otherwise returns a generic retry.
  const agnosticDetail =
    typeof detail === 'string' ? AGENT_AGNOSTIC_DETAIL_FAILURE_UI[detail] : undefined;
  if (agnosticDetail) return agnosticDetail;
  if (agentId === 'amr') {
    if (code === 'AMR_AUTH_REQUIRED') {
      return {
        primaryAction: 'authorize',
        // PRD「需要登录」type — shared title with the non-AMR sign-in case.
        titleKey: 'chat.runError.title.signInRequired',
        // "MishMash 智能体尚未登录，前往登录即可正常使用" — single CTA, no
        // AMR promotion (the agent already IS AMR). The authorize action reuses
        // the inline AmrLoginPill (sign-in + auto-retry on success).
        messageKey: 'chat.runError.signInMessage.amr',
        secondaryRetry: false,
        showSwitchCard: false,
      };
    }
    if (code === 'AMR_INSUFFICIENT_BALANCE') {
      return {
        primaryAction: 'recharge',
        titleKey: 'chat.runError.title.balance',
        messageKey: 'chat.amrError.balanceMessage',
        secondaryRetry: true,
        showSwitchCard: false,
      };
    }
    if (code === 'AMR_TIER_UPGRADE_REQUIRED') {
      return {
        primaryAction: 'upgrade',
        titleKey: 'chat.amrBalanceGate.title',
        messageKey: null,
        secondaryRetry: true,
        showSwitchCard: false,
      };
    }
    return {
      primaryAction: 'retry',
      titleKey: namedTitleForDetail(detail) ?? 'chat.runError.title.generic',
      messageKey: null,
      secondaryRetry: false,
      showSwitchCard: false,
    };
  }
  // Antigravity's auth flow is terminal-only — see the
  // `launch-terminal-auth` action comment for why. Without this branch
  // the user sees the daemon-emitted guidance text and would have to
  // open a terminal themselves; with it they get a one-click button
  // that opens Terminal.app / x-terminal-emulator / cmd with `agy`
  // running, and a Retry button to redo the chat after OAuth completes.
  if (agentId === 'antigravity') {
    if (code === 'AGENT_AUTH_REQUIRED') {
      return {
        primaryAction: 'launch-terminal-auth',
        titleKey: 'chat.runError.title.signInRequired',
        messageKey: null,
        secondaryRetry: true,
        showSwitchCard: false,
      };
    }
    // Quota: each Antigravity model has its own quota, so the action
    // is "open agy, switch model" rather than "sign in." Same handler
    // spawns the same terminal; only the label changes.
    if (code === 'RATE_LIMITED') {
      return {
        primaryAction: 'launch-terminal-switch-model',
        titleKey: 'chat.runError.title.rateLimited',
        messageKey: null,
        secondaryRetry: true,
        showSwitchCard: false,
      };
    }
  }
  // Fine-grained daemon classification overrides a too-coarse code (e.g.
  // hard_quota vs a transient 429 both arriving as RATE_LIMITED). Placed after
  // the AMR/Antigravity agent branches so their bespoke quota/auth flows still
  // win, and before the generic code branches so it can correct them.
  const detailUi = typeof detail === 'string' ? DETAIL_FAILURE_UI[detail] : undefined;
  if (detailUi) return detailUi;
  // Agent-neutral: a mid-response connection drop (any agent) gets a clear,
  // localized "lost connection — retry" message instead of the raw SDK string.
  // Not an AMR-promotable case: the break is the user's own network path, which
  // switching model service wouldn't fix.
  if (code === 'AGENT_CONNECTION_DROPPED') {
    return {
      primaryAction: 'retry',
      titleKey: 'chat.runError.title.connectionDropped',
      messageKey: 'chat.connectionDropped',
      secondaryRetry: false,
      showSwitchCard: false,
    };
  }
  // Non-AMR sign-in required (any non-amr, non-antigravity agent — those two are
  // handled above). The agent's login lives in the user's own terminal, so
  // MishMash can't sign in for them: surface a "{agent} 尚未登录，请本地检查登录状态"
  // message, offer Retry as the primary action (re-run after they log in
  // locally), and promote AMR as the steadier alternative via the switch card.
  if (code === 'AGENT_AUTH_REQUIRED' || code === 'UNAUTHORIZED') {
    return {
      primaryAction: 'retry',
      titleKey: 'chat.runError.title.signInRequired',
      messageKey: 'chat.runError.signInMessage.other',
      secondaryRetry: false,
      showSwitchCard: true,
    };
  }
  // Non-antigravity rate limit / upstream outage: name the type and explain the
  // recovery (wait & retry / switch service), and still promote AMR as the
  // steadier hosted alternative. Antigravity's own RATE_LIMITED was handled
  // above (per-model quota → switch model in terminal).
  if (code === 'RATE_LIMITED') {
    return {
      primaryAction: 'retry',
      titleKey: 'chat.runError.title.rateLimited',
      messageKey: 'chat.runError.rateLimitedMessage',
      secondaryRetry: false,
      showSwitchCard: true,
    };
  }
  if (code === 'UPSTREAM_UNAVAILABLE') {
    return {
      primaryAction: 'retry',
      titleKey: 'chat.runError.title.upstreamUnavailable',
      messageKey: 'chat.runError.upstreamUnavailableMessage',
      secondaryRetry: false,
      showSwitchCard: true,
    };
  }
  const promote = typeof code === 'string' && PROMOTE_AMR_CODES.has(code);
  return {
    primaryAction: 'retry',
    // Last stop before the catch-all: name the cause the daemon classified.
    titleKey: namedTitleForDetail(detail) ?? 'chat.runError.title.generic',
    messageKey: null,
    secondaryRetry: false,
    showSwitchCard: promote,
  };
}
