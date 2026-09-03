import { describe, expect, it } from 'vitest';
import type { RunFailureDetail } from '@open-design/contracts';

import { resolveRunFailureUi } from '../../src/runtime/amr-guidance';

// The invariant behind W1.4 (B-04): a failure the daemon classified must never
// reach the user as the catch-all "Task failed". `unknown` is the one honest
// exception — it is the daemon saying it could not tell.

const ALL_DETAILS: RunFailureDetail[] = [
  'auth_required',
  'stale_profile',
  'refresh_token_reused',
  'missing_api_key',
  'invalid_api_key',
  'hard_quota',
  'workspace_credits_exhausted',
  'rate_limit_429',
  'amr_insufficient_balance',
  'amr_tier_upgrade_required',
  'model_not_found',
  'model_not_supported',
  'model_disabled',
  'local_model_not_loaded',
  'cli_version_incompatible',
  'prompt_too_large',
  'request_too_large',
  'attachment_media_type_unsupported',
  'tool_schema_invalid',
  'prompt_tokenization_failed',
  'provider_resource_not_found',
  'upstream_5xx',
  'upstream_client_error',
  'stream_disconnected',
  'network_error',
  'provider_high_demand',
  'provider_routing_error',
  'inactivity_timeout',
  'timeout',
  'empty_output',
  'tool_error',
  'plugin_artifact_missing',
  'cli_not_installed',
  'git_bash_missing',
  'agent_config_invalid',
  'spawn_failed',
  'spawn_enoexec',
  'spawn_ebadf',
  'spawn_eperm',
  'stdin_write_eof',
  'agent_protocol_error',
  'session_resume_expired',
  'fabricated_role_marker',
  'permission_request_not_found',
  'permission_denied',
  'qoder_stop_sequence',
  'signal_killed',
  'process_crashed',
  'cpu_unsupported',
  'interrupted',
  'exit_code',
  'terminated_unknown',
  'stream_error',
  'exit_nonzero',
  'fatal_rpc_error',
  'execution_failed',
  'user_cancelled',
  'unknown',
];

describe('every classified failure cause has a name', () => {
  it.each(['claude', 'codex', 'amr', 'antigravity', null])(
    'never falls back to "Task failed" for a classified cause (agent %s)',
    (agent) => {
      for (const detail of ALL_DETAILS) {
        if (detail === 'unknown') continue;
        const ui = resolveRunFailureUi('AGENT_EXECUTION_FAILED', detail, agent);
        expect(
          ui.titleKey,
          `failureDetail "${detail}" on agent "${agent}" has no name`,
        ).not.toBe('chat.runError.title.generic');
      }
    },
  );

  it('keeps the generic title when the daemon itself could not classify', () => {
    expect(resolveRunFailureUi('AGENT_EXECUTION_FAILED', 'unknown', 'claude').titleKey)
      .toBe('chat.runError.title.generic');
    expect(resolveRunFailureUi('AGENT_EXECUTION_FAILED', null, 'claude').titleKey)
      .toBe('chat.runError.title.generic');
  });

  it('names the causes behind the reported failures verbatim', () => {
    // The four shapes the team daemon's run log actually produced.
    expect(resolveRunFailureUi('AGENT_EXECUTION_FAILED', 'stream_error', 'claude').titleKey)
      .toBe('chat.runError.title.connectionDropped');
    expect(resolveRunFailureUi('AGENT_EXECUTION_FAILED', 'exit_nonzero', 'claude').titleKey)
      .toBe('chat.runError.title.agentStopped');
    expect(resolveRunFailureUi('AGENT_EXECUTION_FAILED', 'auth_required', 'claude').titleKey)
      .toBe('chat.runError.title.signInRequired');
    expect(resolveRunFailureUi('AGENT_EXECUTION_FAILED', 'inactivity_timeout', 'claude').titleKey)
      .toBe('chat.runError.title.timedOut');
  });

  it('explains an exit-137 kill instead of leaving it silent', () => {
    // B-04's 77s ffmpeg encode: SIGKILL from the OS, no message at all.
    const ui = resolveRunFailureUi('AGENT_EXECUTION_FAILED', 'signal_killed', 'claude');
    expect(ui.titleKey).toBe('chat.runError.title.stoppedBySystem');
    expect(ui.messageKey).toBe('chat.runError.stoppedBySystemMessage');
    expect(ui.primaryAction).toBe('retry');
  });
});
