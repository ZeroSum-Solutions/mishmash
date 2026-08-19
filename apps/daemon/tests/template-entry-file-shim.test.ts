// F011 — a project started from a user-installed template must open on the real
// site, not on the gallery-preview wrapper that sits at the template root.
//
// Every user-installed template is packaged as `SKILL.md` + `assets/<site>` + a
// root `example.html` whose whole body is one `<iframe src="./assets/index.html">`.
// The old entry heuristic took root-level HTML first, so the wrapper won and the
// canvas opened blank.
//
// This runs against an isolated OD_DATA_DIR rather than the operator's ambient
// `.od/design-templates`, so it neither depends on nor writes into real
// machine-local data, and it behaves identically on CI where that root is absent.

import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SITE_MARKER = 'f011-real-site-marker';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

let dataDir = '';
let baseUrl = '';
let server: http.Server | undefined;
let shutdown: (() => Promise<void> | void) | undefined;

const shimSkillId = `f011-shim-${randomUUID().slice(0, 8)}`;
const plainSkillId = `f011-plain-${randomUUID().slice(0, 8)}`;
const projectsToClean: string[] = [];

// The exact shape all 199 user-installed templates ship: a lone iframe, no
// content of its own, target one directory down.
const shimHtml = (target: string, title: string) =>
  `<!doctype html>\n<html><head><meta charset="utf-8"><title>${title}</title>` +
  `<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style></head>` +
  `<body><iframe src="${target}" title="${title}"></iframe></body></html>\n`;

const siteHtml = (heading: string) =>
  `<!doctype html>\n<html><head><meta charset="utf-8"><title>${heading}</title>` +
  `<link rel="stylesheet" href="./css/site.css"></head>` +
  `<body><h1>${heading}</h1><p>${SITE_MARKER}</p></body></html>\n`;

const skillMd = (id: string, entry: string) =>
  `---\nname: ${id}\ndescription: "F011 fixture template."\nod:\n  category: "landing-page"\n` +
  `  mode: template\n  preview:\n    type: html\n    entry: ${entry}\n  design_system:\n    requires: false\n---\n\n` +
  `# ${id}\n\nFixture used by the F011 regression tests.\n`;

async function writeTemplate(
  root: string,
  id: string,
  opts: { withShim: boolean },
): Promise<void> {
  const dir = path.join(root, id);
  await mkdir(path.join(dir, 'assets', 'css'), { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), skillMd(id, 'assets/index.html'), 'utf8');
  await writeFile(path.join(dir, 'assets', 'index.html'), siteHtml(id), 'utf8');
  await writeFile(path.join(dir, 'assets', 'css', 'site.css'), 'body{font-family:system-ui}\n', 'utf8');
  if (opts.withShim) {
    await writeFile(path.join(dir, 'example.html'), shimHtml('./assets/index.html', id), 'utf8');
  }
}

async function createProject(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-f011-'));
  process.env.OD_DATA_DIR = dataDir;
  const templatesRoot = path.join(dataDir, 'design-templates');
  await mkdir(templatesRoot, { recursive: true });
  await writeTemplate(templatesRoot, shimSkillId, { withShim: true });
  await writeTemplate(templatesRoot, plainSkillId, { withShim: false });

  const { startServer } = await import('../src/server.js');
  const started = (await startServer({ port: 0, host: '127.0.0.1', returnServer: true })) as {
    url: string;
    server: http.Server;
    shutdown?: () => Promise<void> | void;
  };
  baseUrl = started.url;
  server = started.server;
  shutdown = started.shutdown;
}, 120_000);

afterAll(async () => {
  // Unconditional teardown: the whole temporary data root goes, so a failure
  // part-way through beforeAll cannot leave a fixture or a database behind.
  for (const id of projectsToClean) {
    await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(
      () => undefined,
    );
  }
  try {
    await shutdown?.();
  } catch {
    /* already down */
  }
  try {
    server?.close();
  } catch {
    /* already closed */
  }
  if (PREV_DATA_DIR === undefined) delete process.env.OD_DATA_DIR;
  else process.env.OD_DATA_DIR = PREV_DATA_DIR;
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
}, 120_000);

describe('project created from a wrapper-shaped template', () => {
  it('sets entryFile to the wrapper target, not the wrapper', async () => {
    const id = `p-${randomUUID()}`;
    const resp = await createProject({
      id,
      name: 'F011 shim template',
      skillId: shimSkillId,
      designSystemId: null,
      metadata: { kind: 'template', animations: false },
    });
    expect(resp.status).toBe(200);
    projectsToClean.push(id);

    const body = (await resp.json()) as { project: { metadata: { entryFile?: string } } };
    // Red on main: the generic heuristic takes root-level HTML first and
    // returns 'example.html', the 280-byte wrapper.
    expect(body.project.metadata.entryFile).toBe('assets/index.html');
  }, 60_000);

  it('serves the real site at the resolved entry file', async () => {
    const id = `p-${randomUUID()}`;
    const resp = await createProject({
      id,
      name: 'F011 shim template render',
      skillId: shimSkillId,
      designSystemId: null,
      metadata: { kind: 'template', animations: false },
    });
    expect(resp.status).toBe(200);
    projectsToClean.push(id);
    const body = (await resp.json()) as { project: { metadata: { entryFile?: string } } };
    const entry = body.project.metadata.entryFile as string;

    const raw = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}/raw/${entry}`);
    expect(raw.status).toBe(200);
    const html = await raw.text();
    // The whole point: what the canvas opens carries the site's own content,
    // not a frame around it.
    expect(html).toContain(SITE_MARKER);
    expect(html).not.toContain('<iframe');

    // R4 — the wrapper is a frame the catalogue draws around the artifact, so
    // it never reaches the user's file tree where it would shadow the real page.
    const filesResp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}/files`);
    const filesBody = (await filesResp.json()) as { files: Array<{ name: string }> };
    const names = filesBody.files.map((f) => f.name);
    expect(names).toContain('assets/index.html');
    expect(names).not.toContain('example.html');
  }, 60_000);

  it('leaves a template without a wrapper on the generic heuristic', async () => {
    const id = `p-${randomUUID()}`;
    const resp = await createProject({
      id,
      name: 'F011 plain template',
      skillId: plainSkillId,
      designSystemId: null,
      metadata: { kind: 'template', animations: false },
    });
    expect(resp.status).toBe(200);
    projectsToClean.push(id);
    const body = (await resp.json()) as { project: { metadata: { entryFile?: string } } };
    // No root HTML at all here, so the nested scan is what answers — unchanged
    // behaviour, proving the wrapper check did not take over resolution.
    expect(body.project.metadata.entryFile).toBe('assets/index.html');
  }, 60_000);
});

// Projects created before this fix recorded the wrapper as their entry file and
// still carry it on disk. Nothing rewrites that metadata — the repair is on the
// read path — so every surface that answers "what does this project open?" has
// to unwrap it independently. There are four, and each is checked here.
describe('a project created before the fix repairs itself on read', () => {
  let staleId = '';

  beforeAll(async () => {
    staleId = `p-${randomUUID()}`;
    const resp = await createProject({
      id: staleId,
      name: 'F011 pre-fix project',
      skillId: shimSkillId,
      designSystemId: null,
      metadata: { kind: 'template', animations: false },
    });
    expect(resp.status).toBe(200);
    projectsToClean.push(staleId);

    // Reconstruct exactly what the old code left behind: the wrapper present in
    // the project tree, and metadata.entryFile naming it. No production flow can
    // produce this any more — R4 skips the wrapper — so the pre-fix state has to
    // be written directly rather than requested through an API that no longer
    // does it.
    const projectRoot = path.join(dataDir, 'projects', staleId);
    await writeFile(
      path.join(projectRoot, 'example.html'),
      shimHtml('./assets/index.html', 'stale wrapper'),
      'utf8',
    );
    const patch = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(staleId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        metadata: { kind: 'template', animations: false, entryFile: 'example.html' },
      }),
    });
    expect(patch.status).toBe(200);
  }, 120_000);

  it('leaves the stale metadata field untouched', async () => {
    const resp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(staleId)}`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { project: { metadata: { entryFile?: string } } };
    // The repair is read-only on purpose: no migration, no write, nothing to
    // corrupt if the heuristic is ever wrong about a project.
    expect(body.project.metadata.entryFile).toBe('example.html');
  }, 60_000);

  it('resolves the canvas to the wrapper target', async () => {
    const resp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(staleId)}`);
    const body = (await resp.json()) as { resolvedCanvasFile: string | null };
    expect(body.resolvedCanvasFile).toBe('assets/index.html');
  }, 60_000);

  it('points the preview URL at the wrapper target', async () => {
    const resp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(staleId)}/preview-url`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { file: string };
    expect(body.file).toBe('assets/index.html');
  }, 60_000);

  it('still honours an explicit ?file= on the preview URL', async () => {
    const resp = await fetch(
      `${baseUrl}/api/projects/${encodeURIComponent(staleId)}/preview-url?file=example.html`,
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { file: string };
    // An explicit request is not a stale default; the caller asked for that page.
    expect(body.file).toBe('example.html');
  }, 60_000);

  it('names the wrapper target as the export manifest entry', async () => {
    const resp = await fetch(
      `${baseUrl}/api/projects/${encodeURIComponent(staleId)}/export/manifest`,
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { entryFile: string | null };
    expect(body.entryFile).toBe('assets/index.html');
  }, 60_000);
});
