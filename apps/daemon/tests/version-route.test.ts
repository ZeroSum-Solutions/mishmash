import type http from 'node:http';
import type { DaemonHealthResponse } from '@open-design/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../src/server.js';

describe('/api/version', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = await startServer({ port: 0, returnServer: true }) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('returns current app version info', async () => {
    const res = await fetch(`${baseUrl}/api/version`);
    const json = await res.json() as unknown;

    expect(res.ok).toBe(true);
    expect(json).toEqual({
      version: {
        version: expect.any(String),
        channel: expect.any(String),
        packaged: expect.any(Boolean),
        platform: expect.any(String),
        arch: expect.any(String),
      },
    });
  });

  it('keeps health version aligned with version endpoint', async () => {
    const [healthRes, versionRes] = await Promise.all([
      fetch(`${baseUrl}/api/health`),
      fetch(`${baseUrl}/api/version`),
    ]);
    const health = await healthRes.json() as DaemonHealthResponse;
    const version = await versionRes.json() as { version?: { version?: unknown } };

    expect(healthRes.ok).toBe(true);
    expect(versionRes.ok).toBe(true);
    // SUPERSEDED (W2K.3), then SUPERSEDED AGAIN (W8C). This assertion used to
    // read `toEqual({ ok: true, version: version.version?.version })`, which
    // claimed the health body carries exactly `ok` and `version` and nothing
    // else. That claim was only ever true of the shape of the day:
    // `/api/health` is the liveness probe every client already calls, so it
    // is where the daemon now publishes `bootId`, the identity of the
    // answering PROCESS, which lets a browser session that outlives a daemon
    // restart notice the process it cached an answer from is gone. The
    // invariant this case exists for -- health and `/api/version` never
    // disagree about the version -- is kept exactly; only the closed-world
    // claim about the other fields is replaced by the contracts DTO
    // `DaemonHealthResponse`.
    //
    // W8C adds `commit`/`builtAt` -- the git commit and build time the
    // running `dist` was built from (`'unknown'`/`'unknown'` here, since this
    // test runs `src/server.ts` directly under tsx/vitest with no sibling
    // `dist/build-stamp.json`) -- so a post-restart smoke can prove which
    // build is actually live. Widening this `toEqual` again, the same way,
    // rather than dropping it to a partial match, keeps the exact-shape
    // guarantee this test exists for.
    expect(health).toEqual({
      ok: true,
      version: version.version?.version,
      bootId: expect.any(String),
      commit: expect.any(String),
      builtAt: expect.any(String),
    });
    expect(health.bootId.length).toBeGreaterThan(0);
  });

  it('reports unknown commit/builtAt when no build stamp exists (tsx/vitest environment)', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const health = await res.json() as DaemonHealthResponse;

    expect(res.ok).toBe(true);
    expect(health.commit).toBe('unknown');
    expect(health.builtAt).toBe('unknown');
  });
});
