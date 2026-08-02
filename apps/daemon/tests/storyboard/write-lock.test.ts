// Real-server route tests for the per-storyboard write lock (BUG1's residual
// window). render-route.test.ts already closed the entry-time race for
// render-shot with a re-read-before-write; that mitigation still leaves a
// narrow window between the re-read and the final `writeStoryboard` rename
// open to a second writer whose OWN read-modify-write cycle lands inside it —
// measured at 10-15% loss under live concurrent load, because the window is
// only about as wide as another writer's full read-validate-write cycle.
// Narrowing it further doesn't close it; only serializing same-id writers
// does.
//
// Same deterministic-gate idiom as render-route.test.ts, but gating the
// LAST step of `writeStoryboard` (the atomic `rename`) instead of
// `realpath`, since PATCH — the simplest mutating route — has no
// containment check to hang a gate on. writeStoryboard has already written
// the full next-document JSON to a temp file by the time `rename` is
// called, so the mock can read that temp file's content to tag which of two
// concurrent requests a given parked rename belongs to — letting the test
// release them in a chosen order regardless of which one the event loop
// happened to schedule first. Every other `rename` call in the process
// passes straight through to the real implementation; only calls whose
// destination is one of the currently "armed" storyboard ids are held.
//
// A second, narrower mock on `readFile` sits alongside it: `readStoryboard`
// is the FIRST fs call inside a PATCH handler's `withStoryboardLock(...)`
// critical section, so counting (never parking) those calls gives a genuine,
// load-independent gate on "has this request entered its critical section
// yet" — see the first test below for why that makes proving B is still
// blocked a real assertion instead of a timing guess.
import type http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startServer } from '../../src/server.js';

const renameMock = vi.fn();
const readFileMock = vi.fn();

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: (...args: Parameters<typeof actual.rename>) => renameMock(...args),
    readFile: (...args: unknown[]) => readFileMock(...args),
  };
});

interface ParkedRename {
  content: string;
  resolve: () => void;
}

interface JsonResponse {
  status: number;
  json: any;
}

describe('storyboard writes — per-id lock', () => {
  let server: http.Server | null = null;
  let base: string;

  /** Storyboard ids whose `rename` calls should be parked instead of completing immediately. `null` disables gating entirely. */
  let armedFor: Set<string> | null = null;
  let parked: ParkedRename[] = [];
  /**
   * Per-storyboard-id count of real `readFile` calls against that
   * storyboard's document — never parked, always passed straight through.
   * Used as a deterministic proxy for "has this request's critical section
   * started running yet" (see the first test's use of it below).
   */
  const readCounts = new Map<string, number>();

  function storyboardIdFromPath(p: unknown): string | null {
    if (typeof p !== 'string') return null;
    const match = /\/storyboards\/([^/]+)\.json$/.exec(p);
    return match?.[1] ?? null;
  }

  renameMock.mockImplementation(async (...args: unknown[]) => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const [tempPath, dest] = args as [string, string];
    const id = storyboardIdFromPath(dest);
    if (armedFor && id && armedFor.has(id)) {
      const content = await actual.readFile(tempPath, 'utf8').catch(() => '');
      await new Promise<void>((resolve) => {
        parked.push({ content, resolve });
      });
    }
    return (actual.rename as (...a: unknown[]) => Promise<void>)(...args);
  });

  readFileMock.mockImplementation(async (...args: unknown[]) => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const [source] = args as [string, ...unknown[]];
    const id = storyboardIdFromPath(source);
    if (id) readCounts.set(id, (readCounts.get(id) ?? 0) + 1);
    return (actual.readFile as (...a: unknown[]) => Promise<string>)(...args);
  });

  afterEach(async () => {
    armedFor = null;
    parked = [];
    readCounts.clear();
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
  });

  async function boot() {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;
    base = started.url;
  }

  async function api(method: string, path: string, body?: unknown): Promise<JsonResponse> {
    const resp = await fetch(`${base}${path}`, {
      method,
      ...(body !== undefined
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
    const text = await resp.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    return { status: resp.status, json };
  }

  async function createStoryboard(title: string) {
    const created = await api('POST', '/api/storyboards', { title });
    expect(created.status).toBe(201);
    return created.json.storyboard as { id: string; updatedAt: string };
  }

  /** Polls until `predicate()` is true or `timeoutMs` elapses; returns whether it was met. */
  async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return true;
  }

  /** Removes and releases the first parked rename whose temp-file content matches `needle`. */
  function releaseMatching(needle: string) {
    const index = parked.findIndex((entry) => entry.content.includes(needle));
    expect(index).toBeGreaterThanOrEqual(0);
    const [entry] = parked.splice(index, 1);
    entry!.resolve();
  }

  it('does not silently drop a concurrent PATCH write to the same storyboard', async () => {
    await boot();
    const created = await createStoryboard('lock probe');
    const id = created.id;
    armedFor = new Set([id]);

    // A: renames the storyboard. No expectedUpdatedAt — this reproduces the
    // race for the unconditional caller shape too, not just the
    // optimistic-concurrency-token shape. Parked right before its rename
    // commits; its temp file (containing the new title) already exists.
    const patchA = api('PATCH', `/api/storyboards/${id}`, { title: 'RENAMED BY A' });
    const aParked = await waitUntil(() => parked.length >= 1, 5_000);
    expect(aParked).toBe(true);

    // A's own readStoryboard() already fired above — it's the first thing
    // the PATCH handler does inside the lock, well before it can reach
    // `rename` — so this baseline reflects exactly A's one read.
    const readsBeforeB = readCounts.get(id) ?? 0;

    // B: adds a shot. Fired while A is still parked, still holding the lock
    // (A's `fn()` hasn't settled, so `release()` hasn't run).
    const patchB = api('PATCH', `/api/storyboards/${id}`, {
      shots: [
        {
          id: 'shot-from-b',
          order: 0,
          title: 'Added by B',
          motionPrompt: 'slow dolly in',
          model: 'this-model-does-not-exist',
          resolution: '720p',
          durationSec: 5,
          status: 'draft',
        },
      ],
    });

    // Deterministic gate: readStoryboard() is the first fs call inside B's
    // own critical section, and withStoryboardLock will not even invoke B's
    // fn() until A's fn() has settled and called release() — see store.ts.
    // With the lock intact this is not a race that might resolve late under
    // load; B's read for this id structurally cannot fire before we release
    // A below, no matter how long we wait. So this bound only needs to
    // comfortably exceed how long an UNLOCKED implementation's dispatch +
    // JSON body parse + readFile would take (low single-digit ms even under
    // load) — it is not tuned against the lock's own behavior, and a broken
    // (unlocked) `withStoryboardLock` makes this assertion fail every time,
    // not just under bad luck.
    const bReadWhileALocked = await waitUntil(() => (readCounts.get(id) ?? 0) > readsBeforeB, 1_000);
    expect(bReadWhileALocked).toBe(false);
    // B must also not have reached its own write yet — implied by the read
    // check above (the write is downstream of the read), but this is the
    // actual property the test exists to guard, so assert it directly too.
    expect(parked.length).toBe(1);

    // Release A. Only now can B's read (and therefore its write) proceed.
    releaseMatching('RENAMED BY A');
    const respA = await patchA;
    expect(respA.status).toBe(200);

    const bRead = await waitUntil(() => (readCounts.get(id) ?? 0) > readsBeforeB, 5_000);
    expect(bRead).toBe(true);
    const bParkedAfter = await waitUntil(() => parked.length >= 1, 5_000);
    expect(bParkedAfter).toBe(true);
    releaseMatching('shot-from-b');
    const respB = await patchB;
    expect(respB.status).toBe(200);

    const final = await api('GET', `/api/storyboards/${id}`);
    // Both writes must survive: A's rename and B's added shot are not
    // silently erased by the other writer's stale snapshot.
    expect(final.json.storyboard.title).toBe('RENAMED BY A');
    expect(final.json.storyboard.shots).toHaveLength(1);
    expect(final.json.storyboard.shots[0]?.id).toBe('shot-from-b');
  });

  it('does not serialize writes to different storyboard ids behind the same lock', async () => {
    await boot();
    const s1 = await createStoryboard('lock isolation probe 1');
    const s2 = await createStoryboard('lock isolation probe 2');
    armedFor = new Set([s1.id]);

    const patch1 = api('PATCH', `/api/storyboards/${s1.id}`, { title: 'S1 RENAMED' });
    const s1Parked = await waitUntil(() => parked.length >= 1, 5_000);
    expect(s1Parked).toBe(true);

    // S2's write must complete promptly even while S1's write sits parked
    // mid-flight — a per-storyboard lock must not become a global
    // bottleneck serializing unrelated storyboards.
    const start = Date.now();
    const resp2 = await api('PATCH', `/api/storyboards/${s2.id}`, { title: 'S2 RENAMED' });
    const elapsedMs = Date.now() - start;
    expect(resp2.status).toBe(200);
    expect(elapsedMs).toBeLessThan(1_000);

    releaseMatching('S1 RENAMED');
    const resp1 = await patch1;
    expect(resp1.status).toBe(200);

    const final1 = await api('GET', `/api/storyboards/${s1.id}`);
    expect(final1.json.storyboard.title).toBe('S1 RENAMED');
    const final2 = await api('GET', `/api/storyboards/${s2.id}`);
    expect(final2.json.storyboard.title).toBe('S2 RENAMED');
  });
});
