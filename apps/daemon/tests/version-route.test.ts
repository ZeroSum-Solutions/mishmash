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
    // SUPERSEDED (W2K.3). This assertion used to read
    // `toEqual({ ok: true, version: version.version?.version })`, which claimed
    // the health body carries exactly `ok` and `version` and nothing else. That
    // claim was only ever true of the shape of the day: `/api/health` is the
    // liveness probe every client already calls, so it is where the daemon now
    // publishes `bootId`, the identity of the answering PROCESS, which lets a
    // browser session that outlives a daemon restart notice the process it
    // cached an answer from is gone. The invariant this case exists for --
    // health and `/api/version` never disagree about the version -- is kept
    // exactly; only the closed-world claim about the other fields is replaced
    // by the contracts DTO `DaemonHealthResponse`.
    expect(health).toEqual({
      ok: true,
      version: version.version?.version,
      bootId: expect.any(String),
    });
    expect(health.bootId.length).toBeGreaterThan(0);
  });
});
