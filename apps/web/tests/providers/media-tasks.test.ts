// Red spec for W7C work item 4 / DEF-7.3: `waitForMediaTask` in
// providers/registry.ts casts the daemon's `/wait` response straight to
// `MediaTaskSnapshot` (`(await resp.json()) as MediaTaskSnapshot`, no
// validation) instead of going through a contracts-owned guard. On base a
// malformed body (missing `taskId`/`status`) is returned to the caller as
// though it were valid.
//
// This file does not import `isMediaTaskSnapshot` from `@open-design/
// contracts` — that export does not exist on base, and per
// builder-protocol.md:43-48 the red commit's failure must be behavioural,
// not an import error. `waitForMediaTask` is exercised through its public
// return value instead.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForMediaTask } from '../../src/providers/registry';

const HERE = dirname(fileURLToPath(import.meta.url));
// Recorded from a real daemon — capture command lives inside the fixture's
// own `_capture` metadata record (INV-7.13 F-04 golden, owned by 7C).
const GOLDEN_PATH = join(HERE, '../../../daemon/tests/fixtures/golden/media-task-wait-sequence.json');
const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as {
  sequence: Array<{ label: string; response: Record<string, unknown> }>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('waitForMediaTask — validates the daemon response instead of a bare cast', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects a /wait body missing taskId and status instead of returning it unchanged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ progress: ['whatever'] })),
    );

    // RED on base: waitForMediaTask never rejects — it resolves with the
    // malformed body cast straight to MediaTaskSnapshot.
    await expect(waitForMediaTask('task_missing_fields', { totalBudgetMs: 20 })).rejects.toBeTruthy();
  });

  it('accepts every real /wait shape in the recorded golden sequence without throwing', async () => {
    for (const entry of golden.sequence) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse(entry.response)),
      );
      const snap = await waitForMediaTask(String(entry.response.taskId ?? 'golden'), { totalBudgetMs: 20 });
      expect(snap.status, `golden entry "${entry.label}" must round-trip its status`).toBe(entry.response.status);
    }
  });
});
