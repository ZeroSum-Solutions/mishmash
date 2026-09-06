// @vitest-environment node
//
// INV-3.7 — a never-settling Vela upstream must not hold either Vela route.
//
// The "upstream" behind `GET /api/integrations/vela/status` is the `vela` CLI:
// `fetchVelaBillingSummary` spawns `vela billing summary --format json` and the
// route awaits it on a cold cache. A CLI that never exits is therefore an
// upstream that never settles, and the route's answer time is whatever bound
// that spawn carries.
//
// The fake below is the only non-settling process this spec is allowed to
// create. It refuses SIGTERM and never writes stdout, so nothing but a SIGKILL
// ends it — which is also what makes its heartbeat file a usable oracle for
// "the stuck child was killed rather than left to outlive the timeout".
//
// The message-center half is a CONTROL, not a second red: that route answers
// locally and synchronously with `emptyMessageCenterPage()`, so it is expected
// to be inside budget on both sides of the fix. It is asserted here anyway
// because INV-3.7 names both Vela routes and a regression on either one is the
// same defect.

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { emptyMessageCenterPage, type MessageCenterPage } from '@open-design/contracts';
import { describe, expect, test } from 'vitest';

import { putAmrAppConfig } from '@/vitest/amr';
import { createSmokeSuite } from '@/vitest/suite';

/** INV-3.7's budget: both Vela routes answer inside this, whatever the CLI does. */
const VELA_ROUTE_BUDGET_MS = 2_000;

/**
 * How long to keep listening before calling an answer "never arrived".
 *
 * Comfortably above the CLI's own subprocess bound, so a route that is merely
 * slow reports as slow (a number over budget) rather than as unanswered.
 */
const NEVER_ANSWERED_AFTER_MS = 25_000;

/** How long to watch the heartbeat file for proof the stuck child is gone. */
const KILL_OBSERVATION_MS = 1_500;

type RouteAnswer<T> = {
  /** Milliseconds until the route answered, or null when it never did. */
  elapsedMs: number | null;
  body: T | null;
};

/**
 * The projection `GET /api/integrations/vela/status` returns.
 *
 * Checked at runtime rather than trusted from a cast: the point of the spec is
 * that the answer stays contract-valid when the CLI never settles, and a body
 * that lost `loggedIn`/`profile` under the budget would satisfy a cast.
 */
function isVelaLoginStatusBody(value: unknown): value is {
  loggedIn: boolean;
  profile: string;
  configPath: string;
  user: unknown;
  account?: { plan?: string; balanceUsd?: string | null };
} {
  if (value === null || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  if (typeof body.loggedIn !== 'boolean') return false;
  if (typeof body.profile !== 'string') return false;
  if (typeof body.configPath !== 'string') return false;
  if (!('user' in body)) return false;
  if ('account' in body && (body.account === null || typeof body.account !== 'object')) return false;
  return true;
}

/**
 * GET `path`, giving up after `NEVER_ANSWERED_AFTER_MS`.
 *
 * The give-up is what separates the two failures this spec has to tell apart:
 * a route that answered too slowly reports a number, a route still holding the
 * request open reports null. Without it a held request is only ever a test
 * timeout, which names no cause.
 */
async function answerWithin<T>(baseUrl: string, path: string): Promise<RouteAnswer<T>> {
  const startedAt = Date.now();
  try {
    const response = await fetch(new URL(path, `${baseUrl}/`), {
      signal: AbortSignal.timeout(NEVER_ANSWERED_AFTER_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${path}: ${text.slice(0, 500)}`);
    }
    return { elapsedMs: Date.now() - startedAt, body: (text ? JSON.parse(text) : null) as T };
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return { elapsedMs: null, body: null };
    }
    throw error;
  }
}

/**
 * Write a `vela` stand-in that answers every metadata probe promptly and then
 * hangs forever on `billing summary`, appending a heartbeat line to
 * `heartbeatPath` while it lives. Deliberately ignores SIGTERM: an upstream
 * that stops when politely asked is not the upstream INV-3.7 is about.
 */
async function writeNeverSettlingVelaBin(root: string, heartbeatPath: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const bin = join(root, 'vela');
  const script = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const HEARTBEAT = ${JSON.stringify(heartbeatPath)};
const argv = process.argv;
if (argv[2] === 'billing' && argv[3] === 'summary') {
  process.on('SIGTERM', () => {});
  process.on('SIGINT', () => {});
  appendFileSync(HEARTBEAT, 'pid ' + process.pid + '\\n');
  setInterval(() => { appendFileSync(HEARTBEAT, 'alive ' + Date.now() + '\\n'); }, 100);
} else if (argv[2] === 'models') {
  process.stdout.write('public_model_glm_5    vela\\n');
  process.exit(0);
} else if (argv[2] === 'model' && (argv[3] === 'preset' || argv[3] === 'list')) {
  const source = argv[3] === 'preset' ? 'preset' : 'remote';
  process.stdout.write(JSON.stringify({ source: source, data: [{ id: 'glm-5' }] }) + '\\n');
  process.exit(0);
} else {
  process.stdout.write('vela 0.0.0-w3-never-settling\\n');
  process.exit(0);
}
`;
  await writeFile(bin, script, 'utf8');
  await chmod(bin, 0o755);
  return bin;
}

async function readHeartbeat(path: string): Promise<string[]> {
  return await readFile(path, 'utf8')
    .then((text) => text.split('\n').filter(Boolean))
    .catch(() => []);
}

function heartbeatPid(lines: string[]): number | null {
  const line = lines.find((entry) => entry.startsWith('pid '));
  if (!line) return null;
  const pid = Number.parseInt(line.slice(4), 10);
  return Number.isFinite(pid) ? pid : null;
}

describe('W3D — Vela routes answer inside the budget or say so', () => {
  test(
    '[P1] a never-settling vela CLI still lets both Vela routes answer within 2s',
    { timeout: 300_000 },
    async () => {
      const suite = await createSmokeSuite('w3-vela-timeout');
      const homeDir = join(suite.scratchDir, 'home-vela-timeout');
      const heartbeatPath = join(suite.scratchDir, 'never-settling-vela.heartbeat');
      await mkdir(homeDir, { recursive: true });

      await suite.with.env({ HOME: homeDir, OPEN_DESIGN_AMR_PROFILE: 'local' }, async () => {
        await suite.with.toolsDev(async ({ runtime }) => {
          // Talk to the daemon directly: this spec measures the daemon HTTP
          // boundary's answer time, and the web dev-server proxy is not part of
          // the route's budget.
          const daemonUrl = `http://127.0.0.1:${runtime.daemonPort}`;
          const velaBin = await writeNeverSettlingVelaBin(
            join(suite.scratchDir, 'never-settling-vela'),
            heartbeatPath,
          );

          try {
            // Env-backed AMR credentials make the status read report a signed-in
            // session, which is the only branch that reaches the billing CLI.
            await putAmrAppConfig(daemonUrl, {
              agentId: 'amr',
              agentCliEnv: {
                amr: {
                  VELA_BIN: velaBin,
                  OPEN_DESIGN_AMR_PROFILE: 'local',
                  ...suite.amr.runtimeEnv(),
                },
              },
            });

            // Control: the message center answers locally and synchronously.
            const messages = await answerWithin<MessageCenterPage>(
              daemonUrl,
              '/api/integrations/vela/message-center/messages?locale=en-US&filter=all&limit=100',
            );
            expect(
              messages.elapsedMs,
              'GET /api/integrations/vela/message-center/messages never answered',
            ).not.toBeNull();
            expect(
              messages.elapsedMs,
              `GET /api/integrations/vela/message-center/messages took ${messages.elapsedMs}ms`,
            ).toBeLessThan(VELA_ROUTE_BUDGET_MS);
            expect(messages.body).toEqual(emptyMessageCenterPage());

            const status = await answerWithin<unknown>(daemonUrl, '/api/integrations/vela/status');

            // Prove the never-settling CLI actually ran before believing the
            // timing: a status that never spawned it would pass on a stopwatch
            // and assert nothing about INV-3.7.
            expect(
              heartbeatPid(await readHeartbeat(heartbeatPath)),
              'the status route never spawned the vela billing CLI — the spec would pass vacuously',
            ).not.toBeNull();

            expect(
              status.elapsedMs,
              `GET /api/integrations/vela/status was still unanswered after ${NEVER_ANSWERED_AFTER_MS}ms `
                + 'with a vela CLI that never exits',
            ).not.toBeNull();
            expect(
              status.elapsedMs,
              `GET /api/integrations/vela/status took ${status.elapsedMs}ms with a vela CLI that never exits`,
            ).toBeLessThan(VELA_ROUTE_BUDGET_MS);
            expect(isVelaLoginStatusBody(status.body)).toBe(true);
            if (!isVelaLoginStatusBody(status.body)) throw new Error('unreachable');
            expect(status.body.loggedIn).toBe(true);
            // Nothing settled, so there is no live billing projection to report.
            expect(status.body.account).toBeUndefined();

            // The stuck child must be killed, not left running past the bound it
            // blew through. Sample the heartbeat twice: a live child keeps
            // appending at 100ms, a killed one cannot.
            const beforeWait = await readHeartbeat(heartbeatPath);
            await new Promise((resolve) => setTimeout(resolve, KILL_OBSERVATION_MS));
            const afterWait = await readHeartbeat(heartbeatPath);
            expect(
              afterWait.length,
              'the never-settling vela child outlived its timeout and is still running',
            ).toBe(beforeWait.length);
          } finally {
            // Never leave the deliberately unkillable-by-SIGTERM child behind,
            // on any outcome — including the runs where the product failed to
            // kill it. Before the runtime stops, so a surviving child cannot
            // hold the daemon's log pipe open through shutdown.
            const pid = heartbeatPid(await readHeartbeat(heartbeatPath));
            if (pid !== null) {
              try {
                process.kill(pid, 'SIGKILL');
              } catch {
                // already gone
              }
            }
          }
        });
      });
    },
  );
});
