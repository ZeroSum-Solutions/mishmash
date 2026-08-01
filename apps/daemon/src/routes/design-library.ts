// Design Library — read-only browse of Devin's local curated reference-asset
// library (default `~/Desktop/Design Assets`, see designLibraryRoot() below).
// This is rights-sensitive content that lives entirely on the local machine:
// no library bytes are ever copied into a project, `.od/`, or the repo. The
// UI enforces per-item usage rights (allowed_use) on top of what this route
// module returns; this module only ever reads and streams bytes back.
//
// Deliberately no blanket `express.static` mount — every resource goes
// through its own containment-checked route below, same rationale as
// routes/static-resource.ts.

import fs from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Express } from 'express';
import { mimeFor } from '../projects.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterDesignLibraryRoutesDeps extends RouteDeps<'http'> {}

// Root resolution mirrors the OD_MEDIA_CONFIG_DIR precedent (media/config.ts):
// a narrow, single-purpose env override, not a second daemon data root. Read
// fresh on every call (never cached at registration) so a test can point
// OD_DESIGN_LIBRARY_DIR at a fixture directory per run.
function designLibraryRoot(): string {
  const raw = process.env.OD_DESIGN_LIBRARY_DIR;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return path.join(os.homedir(), 'Desktop', 'Design Assets');
}

// Thumbnails are generated images; anything else under thumbs/ (an .html or
// .svg dropped there) must not be served with a script-executing Content-Type.
const THUMB_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

// Symlink-aware re-validation. The lexical prefix check is fooled by a
// symlink *inside* the base pointing outside it — the literal path stays
// under base but the OS follows the link at open() time. Same attack class
// projects.ts's resolveSafeReal guards against; here the target must
// already exist (routes 404 first), so the read-path realpath suffices.
async function withinReal(base: string, target: string): Promise<boolean> {
  const baseReal = await realpath(base).catch(() => base);
  let targetReal: string;
  try {
    targetReal = await realpath(target);
  } catch {
    return false;
  }
  return targetReal === baseReal || targetReal.startsWith(baseReal + path.sep);
}

export function registerDesignLibraryRoutes(app: Express, ctx: RegisterDesignLibraryRoutesDeps) {
  const { isLocalSameOrigin, resolvedPortRef } = ctx.http;
  const getResolvedPort = () => resolvedPortRef.current;

  app.get('/api/design-library/catalog', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const root = designLibraryRoot();
    try {
      const raw = await readFile(path.join(root, 'catalog.json'), 'utf8');
      const catalog = JSON.parse(raw);
      // Passthrough of the on-disk catalog plus `root` so the web UI can
      // label where the library came from.
      res.json({ ...catalog, root });
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return res.status(404).json({ error: 'design library not found' });
      }
      res.status(500).json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.get('/api/design-library/thumb/:file', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const root = designLibraryRoot();
    // Exact containment pattern from static-resource.ts's
    // /api/skills/:id/assets/* route: resolve, then require the resolved
    // path to equal the base or sit strictly under it.
    const thumbsBase = path.resolve(root, '.catalog', 'thumbs');
    const target = path.resolve(thumbsBase, req.params.file);
    if (target !== thumbsBase && !target.startsWith(thumbsBase + path.sep)) {
      return res.status(400).json({ error: 'invalid thumb path' });
    }
    if (!THUMB_EXTENSIONS.has(path.extname(target).toLowerCase())) {
      return res.status(400).json({ error: 'unsupported thumb type' });
    }
    if (!fs.existsSync(target)) {
      return res.status(404).json({ error: 'thumb not found' });
    }
    if (!(await withinReal(thumbsBase, target))) {
      return res.status(400).json({ error: 'invalid thumb path' });
    }
    try {
      // The real library nests thumbs under `.catalog/thumbs` (a dot-
      // prefixed directory) -- Express's `send` defaults to `dotfiles:
      // 'ignore'`, which 404s any path with a dot-segment ancestor. The
      // containment check above already constrains `target` to sit inside
      // thumbsBase, so allowing dotfiles here does not reopen path
      // traversal.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      await res.type(mimeFor(target)).sendFile(target, { dotfiles: 'allow' });
    } catch (err: any) {
      res.status(500).json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.post('/api/design-library/open', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const root = designLibraryRoot();
    const rel = typeof req.body?.rel === 'string' ? req.body.rel : '';
    if (!rel) {
      return res.status(400).json({ error: 'rel is required' });
    }
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) {
      return res.status(400).json({ error: 'invalid path' });
    }
    if (!fs.existsSync(target)) {
      return res.status(404).json({ error: 'path not found' });
    }
    if (!(await withinReal(root, target))) {
      return res.status(400).json({ error: 'invalid path' });
    }
    // Detached, fire-and-forget — same shape as host-tools.ts's launch of an
    // external editor. macOS `open` hands off to Finder immediately.
    const child = spawn('open', [target], { detached: true, stdio: 'ignore' });
    // A spawn failure (e.g. ENOENT) emits an unhandled 'error' event with no
    // listener otherwise, which crashes the daemon — the 204 below may
    // already be on the wire by the time it fires, which is fine.
    child.on('error', () => {});
    child.unref();
    res.status(204).end();
  });
}
