#!/usr/bin/env node
// static-server.mjs -- ephemeral local static file server for a mirrored
// site directory, shared by verify-mirror.mjs (the gate) and mirror-site.mjs
// (post-clamp re-measurement, see lib/gate-decision.mjs's clamp contract).
//
// `resolveRequestPath` and `contentTypeFor` are extracted as directly
// importable, testable functions rather than living inline in verify-mirror.mjs
// -- a gate whose own path-guard and MIME table are never exercised by a test
// can regress silently (e.g. weakening the traversal guard) while every gate
// test still passes, because none of them import or launch the real server.
//
// Traversal guard is real-path aware, not lexical-only: a symlink inside
// siteDir whose target resolves outside siteDir is rejected even though its
// own path lexically starts with siteDir, because `fs.realpathSync` follows
// the link before the containment check runs.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

/** @param {string} file */
export function contentTypeFor(file) {
  return MIME_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
}

/**
 * Resolves an incoming request path to a real, in-root file, or `null` when
 * it doesn't exist, is malformed, or escapes `siteRoot` (lexically or via a
 * symlink).
 *
 * @param {string} siteRoot
 * @param {string} requestPath - `req.url`, e.g. `/images/logo.png?x=1`
 * @returns {string | null}
 */
export function resolveRequestPath(siteRoot, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent((requestPath || "/").split("?")[0] || "/");
  } catch {
    // Malformed percent-escape (e.g. a lone `%E0%A4%A`) -- an invalid request
    // path, not a server crash.
    return null;
  }

  let rel = decoded.replace(/^\/+/, "");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";

  const root = path.resolve(siteRoot);
  const resolved = path.resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;

  // Lexical containment only proves the *literal* path stays under the
  // root -- it says nothing about a symlink at or inside that path pointing
  // somewhere else entirely. Resolve the real path and re-check containment
  // against the real root before trusting it.
  let real;
  let realRoot;
  try {
    real = fs.realpathSync(resolved);
    realRoot = fs.realpathSync(root);
  } catch {
    return null; // doesn't exist (or root itself is unreadable); caller treats as 404
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;

  return resolved;
}

/**
 * Starts an ephemeral localhost static server for `siteRoot`. Caller is
 * responsible for closing it (`close()`) once done -- see verify-mirror.mjs
 * and mirror-site.mjs for the try/finally that guarantees this on every path,
 * including a throw mid-verification.
 *
 * @param {string} siteRoot
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>}
 */
export async function startStaticServer(siteRoot) {
  const server = http.createServer((req, res) => {
    const file = resolveRequestPath(siteRoot, req.url || "/");
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": contentTypeFor(file) });
    fs.createReadStream(file).pipe(res);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
