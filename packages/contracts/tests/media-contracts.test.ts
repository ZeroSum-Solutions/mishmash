import { describe, expect, it } from 'vitest';

import type { CreateMediaJobRequest } from '../src/api/media';
import {
  CHAT_RUN_STATUSES,
  DEFAULT_MEDIA_EXECUTION_POLICY,
  MEDIA_EXECUTION_MODES,
  MEDIA_POLICY_DENIAL_CODES,
  PROJECT_EXPORT_MANIFEST_SCHEMA,
  buildProjectRawFileUrl,
  exampleChatRunStatusResponse,
  exampleMediaExecutionDisabledErrorResponse,
  exampleProjectExportManifestResponse,
  exampleProjectRawPreviewUrl,
  mediaExecutionPolicyDenial,
  type MediaExecutionPolicy,
} from '../src/index';
import type { ChatRunStatusResponse } from '../src/api/chat';

describe('media execution contracts', () => {
  it('keeps enabled as the default run policy', () => {
    expect(DEFAULT_MEDIA_EXECUTION_POLICY).toEqual({ mode: 'enabled' });
    expect(MEDIA_EXECUTION_MODES).toEqual(['enabled', 'disabled']);
    expect(MEDIA_POLICY_DENIAL_CODES).toEqual([
      'MEDIA_EXECUTION_DISABLED',
      'MEDIA_SURFACE_DENIED',
      'MEDIA_MODEL_DENIED',
    ]);
  });

  it('allows run status responses to carry the effective media policy', () => {
    const mediaExecution: MediaExecutionPolicy = {
      mode: 'enabled',
      allowedSurfaces: ['image', 'video'],
    };
    const status: ChatRunStatusResponse = {
      id: 'run_1',
      projectId: 'project_1',
      conversationId: 'conversation_1',
      assistantMessageId: 'assistant_1',
      agentId: 'codex',
      status: 'queued',
      createdAt: 1,
      updatedAt: 1,
      mediaExecution,
    };

    expect(status.mediaExecution).toEqual(mediaExecution);
  });

  it('pins media denial envelopes in the contract layer', () => {
    expect(mediaExecutionPolicyDenial({ mode: 'disabled' }, {
      surface: 'image',
      model: 'gpt-image-2',
    })).toEqual({
      code: 'MEDIA_EXECUTION_DISABLED',
      message: 'media generation is disabled for this run',
    });
    expect(mediaExecutionPolicyDenial({
      mode: 'enabled',
      allowedSurfaces: ['video'],
    }, {
      surface: 'image',
      model: 'gpt-image-2',
    })).toEqual({
      code: 'MEDIA_SURFACE_DENIED',
      message: 'media surface "image" is not allowed for this run',
    });
    expect(mediaExecutionPolicyDenial({
      mode: 'enabled',
      allowedModels: ['gpt-image-2'],
    }, {
      surface: 'image',
      model: 'dall-e-3',
    })).toEqual({
      code: 'MEDIA_MODEL_DENIED',
      message: 'media model "dall-e-3" is not allowed for this run',
    });
    expect(exampleMediaExecutionDisabledErrorResponse).toEqual({
      error: {
        code: 'MEDIA_EXECUTION_DISABLED',
        message: 'media generation is disabled for this run',
        retryable: false,
      },
    });
  });

  it('pins run status, manifest, and raw preview URL examples', () => {
    expect(CHAT_RUN_STATUSES).toEqual(['queued', 'running', 'succeeded', 'failed', 'canceled']);
    expect(exampleChatRunStatusResponse).toMatchObject({
      id: 'run_1',
      projectId: 'project_1',
      conversationId: 'conversation_1',
      assistantMessageId: 'assistant_1',
      agentId: 'codex',
      status: 'succeeded',
      mediaExecution: { mode: 'enabled' },
      toolBundle: { mcpServers: [] },
    });
    expect(exampleChatRunStatusResponse.eventsLogPath).toBeNull();
    expect(exampleProjectExportManifestResponse.schema).toBe(PROJECT_EXPORT_MANIFEST_SCHEMA);
    expect(exampleProjectExportManifestResponse.files).toEqual([
      expect.objectContaining({
        name: 'index.html',
        included: true,
        role: 'entry',
        reasons: ['project-entry-file'],
      }),
    ]);
    expect(exampleProjectRawPreviewUrl).toBe(
      'http://127.0.0.1:17456/api/projects/project_1/raw/screens/main%20page.html',
    );
    expect(buildProjectRawFileUrl(
      'http://127.0.0.1:17456/',
      'project 1',
      'screens/main page.html',
    )).toBe('http://127.0.0.1:17456/api/projects/project%201/raw/screens/main%20page.html');
  });
});

// W8B work item 1: `CreateMediaJobRequest`'s encode branch declares
// `input: string` unconditionally (api/media.ts:292), but the daemon's own
// validator requires `input` only for `h264-web` (routes/media.ts:54);
// `concat-copy` requires `inputs` (:57) and `frames-to-mp4` requires `frames`
// (:60), and the encode runner already guards `if (!request.input)`
// (media/jobs.ts:494). The contract is stricter than every consumer.
//
// Nothing in this package validates the union at RUNTIME (the type is erased
// by the transpiler), so these two cases pass on base by construction and are
// marked VERIFIED rather than claimed as the red. The type-level failure is
// captured by `tsc --noEmit` on this package, and the BEHAVIOURAL red for the
// defect is the CLI/daemon case in
// apps/daemon/tests/cli-media-jobs.test.ts ("concat-copy --inputs"), per the
// launch-gate override that a compile-only failure is never a red.
describe('CreateMediaJobRequest — `input` is required only by the preset that uses it (W8B item 1)', () => {
  it('accepts a concat-copy request that carries inputs and no input', () => {
    const request: CreateMediaJobRequest = {
      kind: 'encode',
      preset: 'concat-copy',
      inputs: ['clips/a.mp4', 'clips/b.mp4'],
      output: 'out/joined.mp4',
    };
    expect(request).toEqual({
      kind: 'encode',
      preset: 'concat-copy',
      inputs: ['clips/a.mp4', 'clips/b.mp4'],
      output: 'out/joined.mp4',
    });
    expect('input' in request).toBe(false);
  });

  it('accepts a frames-to-mp4 request that carries frames and no input', () => {
    const request: CreateMediaJobRequest = {
      kind: 'encode',
      preset: 'frames-to-mp4',
      frames: [
        { path: 'frames/001.png', durationMs: 100 },
        { path: 'frames/002.png', durationMs: 100 },
      ],
      output: 'out/anim.mp4',
    };
    expect(request.kind).toBe('encode');
    expect('input' in request).toBe(false);
  });

  it('still accepts an h264-web request that carries input', () => {
    const request: CreateMediaJobRequest = {
      kind: 'encode',
      preset: 'h264-web',
      input: 'raw/clip.mov',
      output: 'out/clip.mp4',
    };
    expect(request).toMatchObject({ preset: 'h264-web', input: 'raw/clip.mov' });
  });
});
