import { describe, expect, it } from 'vitest';
import {
  nativeSessionRecoveryNotice,
  type NativeSessionRecoveryMetadata,
  type NativeSessionRecoveryState,
} from '../src/api/chat';

// Canonical reading of a run's native-session recovery state, shared by the web
// chat (AssistantMessage) and `od run info` so the two surfaces can never
// disagree about which states a user is told about (T-05).

function metadata(state: NativeSessionRecoveryState): NativeSessionRecoveryMetadata {
  return {
    agentId: 'claude',
    state,
    acquisition: 'stream-captured',
    continuation: 'native-resume-by-id',
    handle: { present: true, kind: 'opaque-id', display: null, sha256: null, redacted: true },
    guardReason: null,
    fallbackReason: null,
    updatedAt: 1,
  };
}

describe('nativeSessionRecoveryNotice', () => {
  it('reports the two states that changed what the agent could see', () => {
    expect(nativeSessionRecoveryNotice(metadata('resumed'))).toBe('resumed');
    expect(nativeSessionRecoveryNotice(metadata('auto_reseeded'))).toBe('reseeded');
  });

  it('stays silent for ordinary operation', () => {
    const quiet: NativeSessionRecoveryState[] = [
      'not_applicable',
      'no_recoverable_session',
      'captured_not_resumed',
      'resume_attempted',
      'resume_skipped',
    ];
    for (const state of quiet) {
      expect(nativeSessionRecoveryNotice(metadata(state)), state).toBeNull();
    }
  });

  it('stays silent when a daemon reports no recovery metadata at all', () => {
    expect(nativeSessionRecoveryNotice(null)).toBeNull();
    expect(nativeSessionRecoveryNotice(undefined)).toBeNull();
  });
});
