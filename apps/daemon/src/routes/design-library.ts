// Design Library — browse of Devin's local curated reference-asset library
// (default `~/Desktop/Design Assets`, see designLibraryRoot() below). This is
// rights-sensitive content that lives entirely on the local machine, gated
// per item via `allowed_use` (see RIGHTS.md): everything is browse/open-only
// EXCEPT `licensed-source-review` and `own-code` items, which may be copied
// into a new managed project via POST /start-project below — every other
// tier keeps zero copy affordance and never leaves the library root.
//
// Deliberately no blanket `express.static` mount — every resource goes
// through its own containment-checked route below, same rationale as
// routes/static-resource.ts.

import fs from 'node:fs';
import { readFile, readdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Express } from 'express';
import type {
  DesignLibraryAllowedUse,
  DesignLibraryCatalog,
  DesignLibraryItem,
  DesignLibraryStartProjectRequest,
  DesignLibraryStartProjectResponse,
  ProjectMetadata,
} from '@open-design/contracts';
import { mimeFor } from '../projects.js';
import { copyDirectoryContents, type CopyDirectoryState } from '../copy-directory.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterDesignLibraryRoutesDeps
  extends RouteDeps<'http' | 'db' | 'paths' | 'ids' | 'projectStore' | 'projectFiles' | 'conversations'> {}

// allowed_use tiers that may be copied out of the library into a project.
// Everything else (`human-local-only`, `blocked-pending-license`) stays
// browse/open-only — see the module header.
const COPYABLE_ALLOWED_USE = new Set<DesignLibraryAllowedUse>(['own-code', 'licensed-source-review']);

// Kept distinct from plugins/duplicate-project.ts's copy caps (3000
// files/160MB) because kits are commonly larger than a plugin example —
// see docs/plans/2026-08-01-ui8-kit-starters-and-home-restructure.md §Stream A.
// Overridable only for tests, same rationale as OD_DESIGN_LIBRARY_DIR: read
// fresh on every call, never cached at registration.
const START_PROJECT_MAX_FILES_DEFAULT = 6000;
const START_PROJECT_MAX_BYTES_DEFAULT = 600 * 1024 * 1024;

function startProjectMaxFiles(): number {
  const raw = Number(process.env.OD_DESIGN_LIBRARY_COPY_MAX_FILES);
  return Number.isFinite(raw) && raw > 0 ? raw : START_PROJECT_MAX_FILES_DEFAULT;
}

function startProjectMaxBytes(): number {
  const raw = Number(process.env.OD_DESIGN_LIBRARY_COPY_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : START_PROJECT_MAX_BYTES_DEFAULT;
}

const START_PROJECT_EXCLUDED_DIR_NAMES = new Set(['.git', 'node_modules', '__MACOSX']);
const START_PROJECT_EXCLUDED_FILE_NAMES = new Set(['.DS_Store']);

// First of these relative to the copied project root wins; otherwise the
// first *.html found at depth <= 2 (project root, then its immediate
// subdirectories); otherwise undefined — see plan §Stream A entryFile
// heuristic.
const ENTRY_FILE_CANDIDATES = ['index.html', 'HTML/index.html', 'build/index.html', 'template/index.html'];

class DesignLibraryStartProjectError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'DesignLibraryStartProjectError';
    this.status = status;
  }
}

function findCatalogItem(catalog: DesignLibraryCatalog, rel: string): DesignLibraryItem | null {
  for (const group of catalog.groups) {
    for (const item of group.items) {
      if (item.rel === rel) return item;
    }
  }
  return null;
}

async function detectEntryFile(projectRoot: string): Promise<string | undefined> {
  for (const candidate of ENTRY_FILE_CANDIDATES) {
    if (fs.existsSync(path.join(projectRoot, candidate))) return candidate;
  }
  const topLevel = await readdir(projectRoot, { withFileTypes: true }).catch(() => []);
  const topFiles = topLevel.filter((e) => e.isFile()).map((e) => e.name).sort();
  const direct = topFiles.find((name) => /\.html?$/i.test(name));
  if (direct) return direct;
  const topDirs = topLevel.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const dirName of topDirs) {
    const nested = await readdir(path.join(projectRoot, dirName), { withFileTypes: true }).catch(() => []);
    const nestedFile = nested
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort()
      .find((name) => /\.html?$/i.test(name));
    if (nestedFile) return `${dirName}/${nestedFile}`;
  }
  return undefined;
}

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

  // Start a new project from a licensed kit. Only `licensed-source-review`
  // and `own-code` allowed_use items reach here — see COPYABLE_ALLOWED_USE
  // and the module header. Mirrors routes/plugins/index.ts's
  // POST /api/plugins/:id/duplicate-project (ensureProject → copy →
  // insertProject → insertConversation, cleanup on any failure).
  app.post('/api/design-library/start-project', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const root = designLibraryRoot();
    const body: DesignLibraryStartProjectRequest =
      req.body && typeof req.body === 'object' ? req.body : { rel: '' };
    const rel = typeof body.rel === 'string' ? body.rel : '';
    if (!rel) {
      return res.status(400).json({ error: 'rel is required' });
    }
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) {
      return res.status(400).json({ error: 'invalid path' });
    }

    let catalog: DesignLibraryCatalog;
    try {
      const raw = await readFile(path.join(root, 'catalog.json'), 'utf8');
      catalog = JSON.parse(raw);
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return res.status(404).json({ error: 'design library not found' });
      }
      return res.status(500).json({ error: String(err && err.message ? err.message : err) });
    }

    const item = findCatalogItem(catalog, rel);
    if (!item) {
      return res.status(404).json({ error: 'item not found in catalog' });
    }
    if (!COPYABLE_ALLOWED_USE.has(item.allowed_use)) {
      return res.status(403).json({
        error: `items with allowed_use "${item.allowed_use}" cannot start a project`,
      });
    }
    if (!fs.existsSync(target)) {
      return res.status(404).json({ error: 'path not found' });
    }
    if (!(await withinReal(root, target))) {
      return res.status(400).json({ error: 'invalid path' });
    }

    const { db, paths, ids, projectStore, projectFiles, conversations } = ctx;
    let cleanupProjectId: string | null = null;
    let insertedProject = false;
    try {
      const now = Date.now();
      const projectId = ids.randomId();
      const conversationId = ids.randomId();
      cleanupProjectId = projectId;
      const projectName =
        typeof body.name === 'string' && body.name.trim().length > 0
          ? body.name.trim().slice(0, 120)
          : item.label;
      const metadata: ProjectMetadata = {
        kind: 'prototype',
        templateId: `design-library:${item.id}`,
        templateLabel: item.label,
        duplicatedFromDesignLibraryRel: item.rel,
        skipDiscoveryBrief: true,
      };
      const projectRoot: string = await projectFiles.ensureProject(paths.PROJECTS_DIR, projectId, metadata);

      const state: CopyDirectoryState = { copiedFiles: 0, copiedBytes: 0, skippedFiles: 0, warnings: [] };
      await copyDirectoryContents(target, projectRoot, state, {
        excludedDirNames: START_PROJECT_EXCLUDED_DIR_NAMES,
        excludedFileNames: START_PROJECT_EXCLUDED_FILE_NAMES,
        limits: { maxFiles: startProjectMaxFiles(), maxBytes: startProjectMaxBytes() },
        onIncomplete: (reason, relPath) => {
          throw new DesignLibraryStartProjectError(
            422,
            `This kit cannot be copied completely: ${reason} (${relPath}).`,
          );
        },
      });

      const entryFile = await detectEntryFile(projectRoot);
      if (entryFile) metadata.entryFile = entryFile;

      const project = projectStore.insertProject(db, {
        id: projectId,
        name: projectName,
        skillId: null,
        designSystemId: null,
        pendingPrompt: null,
        metadata,
        createdAt: now,
        updatedAt: now,
      });
      insertedProject = true;
      conversations.insertConversation(db, {
        id: conversationId,
        projectId,
        title: null,
        createdAt: now,
        updatedAt: now,
      });
      const loadedProject = projectStore.getProject(db, projectId) ?? project;
      if (!loadedProject) {
        throw new DesignLibraryStartProjectError(500, 'created project could not be loaded');
      }

      const response: DesignLibraryStartProjectResponse = {
        ok: true,
        projectId,
        conversationId,
        project: loadedProject,
        ...(entryFile ? { entryFile } : {}),
        copiedFiles: state.copiedFiles,
        skippedFiles: state.skippedFiles,
        warnings: state.warnings,
      };
      res.status(201).json(response);
    } catch (err: unknown) {
      if (cleanupProjectId) {
        if (insertedProject) projectStore.dbDeleteProject(db, cleanupProjectId);
        await projectStore.removeProjectDir(paths.PROJECTS_DIR, cleanupProjectId).catch(() => {});
      }
      if (err instanceof DesignLibraryStartProjectError) {
        return res.status(err.status).json({ error: err.message });
      }
      res.status(500).json({ error: String(err && (err as Error).message ? (err as Error).message : err) });
    }
  });
}
