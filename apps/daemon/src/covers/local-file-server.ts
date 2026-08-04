// A short-lived, render-job-scoped loopback HTTP server that serves ONLY
// the given project's own files (S4-2/C4-6 -- security-review finding 1,
// "renderer can read and screenshot arbitrary local files").
//
// The renderer used to navigate Chromium straight at a `file://` URL. The
// dead-proxy + host-resolver-rules config in renderer.ts governs only the
// NETWORK stack; it does nothing about `file://`. A hostile project's own
// HTML/CSS could reference `file:///Users/<user>/.ssh/id_rsa` via an
// <img>, a CSS url(), a symlink planted inside the project dir, or a
// same-tab self-navigation (`location.href = 'file:///etc/hosts'`) during
// the render's settle window -- Chromium renders an unknown local file as
// plain text, and `page.screenshot({fullPage:true})` bakes whatever is on
// screen into the cover the daemon then serves back over HTTP as that
// project's cover. Any file the daemon process can read becomes
// exfiltratable pixels.
//
// Fix: navigate to this server instead of `file://`. Every request is
// realpath-checked against the project's own realpath'd root before any
// byte is served, so a symlink planted inside the project dir that points
// outside it cannot escape either -- stronger than hash.ts's safeReadFile
// containment check, which resolves the joined path but does not resolve
// symlinks (that gap is pre-existing, out of this wave's scope to change,
// and lower-severity there since hash.ts only ever hashes bytes, never
// serves or renders them).

import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { mimeFor } from '../projects.js';

export interface LocalProjectFileServer {
  /** e.g. "http://127.0.0.1:53211" -- no trailing slash. */
  origin: string;
  close(): Promise<void>;
}

/**
 * Starts a loopback-only HTTP server rooted at `projectRootReal`, which
 * MUST already be `fs.realpath`-resolved by the caller (renderer.ts
 * resolves it once per render job so every request below re-checks
 * against that same trusted boundary).
 */
export async function startLocalProjectFileServer(projectRootReal: string): Promise<LocalProjectFileServer> {
  const server = http.createServer((req, res) => {
    void handleRequest(projectRootReal, req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = address && typeof address === 'object' && address ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

async function handleRequest(
  projectRootReal: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    const rawPath = (req.url ?? '/').split('?')[0] ?? '/';
    const urlPath = decodeURIComponent(rawPath);
    const joined = path.join(projectRootReal, urlPath);
    // path.join already collapses ".." segments textually, but a clean
    // textual join is not containment on its own -- a symlink under
    // projectRootReal can still point outside it after the join resolves
    // to a real file. fs.realpath is the actual guard: it follows any
    // symlinks in the resolved path and only THEN gets compared against
    // the (already realpath'd) project root.
    const resolved = await fs.realpath(joined).catch(() => null);
    if (
      !resolved
      || (resolved !== projectRootReal && !resolved.startsWith(projectRootReal + path.sep))
    ) {
      res.writeHead(403).end();
      return;
    }
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat || !stat.isFile()) {
      res.writeHead(404).end();
      return;
    }
    const bytes = await fs.readFile(resolved);
    res.writeHead(200, { 'Content-Type': mimeFor(resolved) });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(bytes);
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}
