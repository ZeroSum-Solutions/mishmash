import { createServer, get as httpGet, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Page } from '@playwright/test';

/** `GET /api/runs/:id/events` — the only path this proxy forwards. */
const RUN_EVENTS_PATH = /^\/api\/runs\/([^/]+)\/events$/;

/** Run statuses the daemon reports while a run is still going. */
const ACTIVE_RUN_STATUSES = new Set(['queued', 'running']);

export interface RunStreamTransportCut {
  /** Start forwarding (and cutting) the next run event stream this page opens. */
  arm: () => void;
  /** How many event-stream connections have been forwarded to the daemon. */
  readonly forwarded: number;
  /** How many of them were cut mid-body after the daemon's own `error` frame. */
  readonly cuts: number;
  /** The run whose stream is forwarded, learned from the first forwarded request. */
  readonly runId: string | null;
  /** The daemon bytes the client received before the cut, `error` frame included. */
  readonly cutFrame: string | null;
  /** Stop the proxy. Also runs automatically when the page closes. */
  close: () => Promise<void>;
}

export interface RunStreamTransportCutOptions {
  /** Base URL of the daemon this page's runs live on (`toolsDev.daemonUrl`). */
  daemonUrl: string;
  /**
   * Withhold the stream until the daemon has adjudicated the run, so the
   * client's post-stream status read lands on that terminal instead of racing a
   * still-running turn.
   */
  holdUntilRunIsTerminal?: boolean;
}

/**
 * The only wire that can deliver a daemon `error` frame with no terminal `end`:
 * the daemon's real bytes, and then an actual transport failure.
 *
 * `apps/daemon/src/runtimes/runs.ts` emits `end` and closes every client at its
 * single terminal choke point, so no completed response the daemon writes can
 * carry an `error` frame alone. A test that fulfils one has invented a wire.
 * This helper instead forwards the daemon's own event stream byte for byte and
 * destroys the client socket immediately after the first complete `event: error`
 * frame, mid-body — the browser reports a broken response body, which is what
 * `consumeDaemonRun` meets when a connection drops between a failed attempt and
 * the same run's retry (`apps/web/src/providers/daemon.ts`).
 *
 * The frame itself is therefore the daemon's, classification and all: nothing
 * here writes an event body. Only the FIRST forwarded stream is cut; later
 * reattaches pass through whole, so the run's own terminal can still reach the
 * page once the test releases its other holds.
 *
 * Arm it BEFORE the send, not after the create-run response, because the client
 * opens the stream the moment that response lands.
 */
export async function cutRunStreamAfterDaemonErrorFrame(
  page: Page,
  options: RunStreamTransportCutOptions,
): Promise<RunStreamTransportCut> {
  const daemonUrl = options.daemonUrl.replace(/\/+$/, '');
  let armed = false;
  let heldRunId: string | null = null;
  let forwarded = 0;
  let cuts = 0;
  let cutFrame: string | null = null;

  const server: Server = createServer((req, res) => {
    void forward(req, res).catch(() => {
      try { res.destroy(); } catch { /* the client is already gone */ }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const proxyOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function forward(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requested = new URL(req.url ?? '/', proxyOrigin);
    const match = RUN_EVENTS_PATH.exec(requested.pathname);
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    if (options.holdUntilRunIsTerminal) await waitForRunTerminal(daemonUrl, match[1]!);
    forwarded += 1;
    const cutThisStream = cuts === 0;
    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const upstream = httpGet(
        `${daemonUrl}${requested.pathname}${requested.search}`,
        { headers: { accept: 'text/event-stream' } },
        (response) => {
          res.writeHead(response.statusCode ?? 200, {
            'content-type': String(response.headers['content-type'] ?? 'text/event-stream'),
            'cache-control': 'no-cache',
            // The page reaches this proxy through a request URL override, so the
            // response must be readable from the app's own origin either way.
            'access-control-allow-origin': '*',
          });
          res.flushHeaders();
          let received = '';
          let relayed = 0;
          const cut = () => {
            cuts += 1;
            cutFrame = received.slice(0, relayed);
            upstream.destroy();
            res.socket?.destroy();
            settle();
          };
          response.on('data', (chunk: Buffer) => {
            if (settled) return;
            received += chunk.toString('utf8');
            const cutAt = cutThisStream ? errorFrameEnd(received) : -1;
            const upTo = cutAt === -1 ? received.length : cutAt;
            if (upTo > relayed) {
              const pending = received.slice(relayed, upTo);
              relayed = upTo;
              // Cut from the write callback: the daemon's bytes must have left
              // this process before the socket dies, or the client never sees
              // the frame the case is about.
              res.write(pending, () => {
                if (cutAt !== -1) cut();
              });
              return;
            }
            if (cutAt !== -1) cut();
          });
          response.on('end', () => {
            if (!settled) res.end();
            settle();
          });
          response.on('error', () => {
            if (!settled) res.destroy();
            settle();
          });
        },
      );
      upstream.on('error', () => {
        if (!settled) res.destroy();
        settle();
      });
      req.on('close', () => {
        upstream.destroy();
        settle();
      });
    });
  }

  await page.route(
    (url) => RUN_EVENTS_PATH.test(url.pathname),
    async (route) => {
      const url = new URL(route.request().url());
      const requestedRunId = RUN_EVENTS_PATH.exec(url.pathname)?.[1] ?? '';
      if (!armed || (heldRunId !== null && requestedRunId !== heldRunId)) {
        await route.continue();
        return;
      }
      heldRunId = heldRunId ?? requestedRunId;
      await route.continue({ url: `${proxyOrigin}${url.pathname}${url.search}` });
    },
  );

  const close = () => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  page.once('close', () => { void close(); });

  return {
    arm: () => {
      armed = true;
    },
    get forwarded() {
      return forwarded;
    },
    get cuts() {
      return cuts;
    },
    get runId() {
      return heldRunId;
    },
    get cutFrame() {
      return cutFrame;
    },
    close,
  };
}

/**
 * Index just past the first complete `event: error` frame in an SSE stream, or
 * `-1` while none has arrived whole. Frames are `\n\n`-separated, so a partial
 * trailing frame is never mistaken for a complete one.
 */
function errorFrameEnd(stream: string): number {
  for (let from = 0; ; ) {
    const end = stream.indexOf('\n\n', from);
    if (end === -1) return -1;
    const frame = stream.slice(from, end);
    if (frame.split('\n').some((line) => line.trim() === 'event: error')) return end + 2;
    from = end + 2;
  }
}

/** Block until the daemon reports a terminal status for this run. */
async function waitForRunTerminal(daemonUrl: string, runId: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const status = await fetch(`${daemonUrl}/api/runs/${encodeURIComponent(runId)}`)
      .then(async (response) => (
        response.ok ? ((await response.json()) as { status?: string }).status ?? null : null
      ))
      .catch(() => null);
    if (status !== null && !ACTIVE_RUN_STATUSES.has(status)) return;
    if (Date.now() > deadline) {
      throw new Error(`run ${runId} never reached a terminal status (last: ${status ?? 'unreadable'})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
