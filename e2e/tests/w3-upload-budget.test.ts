// @vitest-environment node

// W3F — the PRD 7.2 upload row, measured through the real route.
//
// `POST /api/projects/:id/upload` is a MEASURE-ONLY row for this wave: Wave 7
// owns upload behaviour (INV-3.8), so nothing in `apps/daemon/src/uploads*`
// or the upload handler changes here. What this spec pins is the pair the
// latency capture needs from the route: the response is the envelope
// `packages/contracts` owns (`UploadProjectFilesResponse`), and the wall
// duration of the upload is recorded as a successful observation rather than
// a censored failure.
//
// Fixture size. Wave 7 has not frozen a fixture yet — `briefs/waves/
// w7-spec-audit.md` still lists DEF-7.2 ("Upload acceptance says 'large'
// without a byte limit or per-file/aggregate distinction") as open, so no
// frozen manifest exists at `e2e/fixtures/w7/manifest.json` to import. The
// PRD 7.2 row itself gives no byte figure either, only the observed
// durations (2 samples, 11 s median, 18 s max). This spec therefore declares
// its own deterministic fixture below and says so; when Wave 7 freezes the
// real manifest, this constant is replaced by it.

import { randomUUID } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import type {
  CreateProjectRequest,
  CreateProjectResponse,
  UploadProjectFilesResponse,
} from '@open-design/contracts';

import { requestJson } from '@/vitest/http';
import { createSmokeSuite } from '@/vitest/suite';

/**
 * Declared fixture, standing in for the not-yet-frozen Wave 7 one: eight
 * files, 1.5 MiB each, 12 MiB aggregate. Deterministic bytes so the recorded
 * duration is comparable between runs.
 */
const FIXTURE_FILE_COUNT = 8;
const FIXTURE_FILE_BYTES = 1_536 * 1_024;

function fixtureBytes(index: number): ArrayBuffer {
  const buffer = new ArrayBuffer(FIXTURE_FILE_BYTES);
  const bytes = new Uint8Array(buffer);
  for (let offset = 0; offset < bytes.length; offset += 1) {
    bytes[offset] = (offset + index * 31) % 251;
  }
  return buffer;
}

describe('W3F upload budget', () => {
  test('[P1] the upload route answers its contracts envelope and its duration is recorded', async () => {
    const suite = await createSmokeSuite('w3-upload-budget');

    await suite.with.toolsDev(async ({ runtime }) => {
      const daemonUrl = `http://127.0.0.1:${runtime.daemonPort}/`;

      const request: CreateProjectRequest = {
        designSystemId: null,
        id: randomUUID(),
        metadata: { kind: 'prototype' },
        name: 'W3F upload budget project',
        pendingPrompt: '',
        skillId: null,
      };
      const created = await requestJson<CreateProjectResponse>(daemonUrl, '/api/projects', {
        body: request,
      });
      const projectId = created.project.id;

      const form = new FormData();
      const expectedNames: string[] = [];
      for (let index = 0; index < FIXTURE_FILE_COUNT; index += 1) {
        const name = `w3f-upload-fixture-${index + 1}.bin`;
        expectedNames.push(name);
        form.append(
          'files',
          new Blob([fixtureBytes(index)], { type: 'application/octet-stream' }),
          name,
        );
      }

      const startedAt = performance.now();
      const response = await fetch(new URL(`/api/projects/${projectId}/upload`, daemonUrl), {
        body: form,
        method: 'POST',
      });
      const text = await response.text();
      const durationMs = performance.now() - startedAt;

      expect(response.status, `upload must succeed: ${text.slice(0, 300)}`).toBe(200);

      const body = JSON.parse(text) as UploadProjectFilesResponse;
      expect(Array.isArray(body.files)).toBe(true);
      expect(body.files.map((file) => file.name).sort()).toEqual([...expectedNames].sort());
      for (const file of body.files) {
        expect(typeof file.path).toBe('string');
        expect(file.size).toBe(FIXTURE_FILE_BYTES);
        expect(typeof file.mtime).toBe('number');
      }

      await suite.report.json('w3/upload-budget.json', {
        aggregateBytes: FIXTURE_FILE_COUNT * FIXTURE_FILE_BYTES,
        durationMs,
        fileBytes: FIXTURE_FILE_BYTES,
        fileCount: FIXTURE_FILE_COUNT,
        fixtureSource: 'declared here; Wave 7 fixture not frozen (DEF-7.2 open)',
      });
    });
  }, 600_000);
});
