import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

// MM-001 defect #1 / MM-007 — starting a project from the Templates page
// (EntryShell.startProjectFromTemplate -> metadataForSkill) produced an
// empty canvas: the daemon validated and stored the catalogue skill's id as
// the project's skillId, but never copied that skill's assets/ files onto
// disk. This is the red-then-green spec for the daemon-side copy step,
// exercised at the real HTTP boundary against the real design-templates
// catalogue (no fixtures/mocks) per AGENTS.md's "cheapest layer" guidance.
describe('POST /api/projects — catalogue template start', () => {
  let server: http.Server;
  let baseUrl: string;
  const projectsToClean: string[] = [];

  // A real, on-disk design-templates catalogue entry with `od.mode: template`
  // and a single-file assets/template.html — see
  // design-templates/trading-analysis-dashboard-template/. This is the same
  // catalogue project-skill-id-validation.test.ts already exercises
  // (e.g. 'saas-landing'), just one whose mode is 'template' rather than
  // 'prototype' so it matches EntryShell's kindForSkill('template') path.
  const CATALOGUE_TEMPLATE_SKILL_ID = 'trading-analysis-dashboard-template';

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterAll(async () => {
    for (const id of projectsToClean.splice(0)) {
      await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function uniqueId(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }

  async function createProject(body: Record<string, unknown>) {
    return fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('copies the catalogue template files into the new project and sets entryFile', async () => {
    const id = uniqueId('p');
    // Mirrors metadataForSkill's kind:'template' output — no templateId,
    // that field belongs to the unrelated "save as template" feature.
    const resp = await createProject({
      id,
      name: 'Trading dashboard from catalogue',
      skillId: CATALOGUE_TEMPLATE_SKILL_ID,
      designSystemId: null,
      metadata: { kind: 'template', animations: false },
    });
    expect(resp.status).toBe(200);
    projectsToClean.push(id);
    const body = (await resp.json()) as {
      project: { skillId: string; metadata: { kind: string; entryFile?: string } };
    };
    expect(body.project.skillId).toBe(CATALOGUE_TEMPLATE_SKILL_ID);
    // Was 'template.html' when the copy step flattened assets/ into the project
    // root. The copy now preserves the catalogue entry's directory shape, because
    // flattening is what made `example.html`'s `./assets/...` references
    // unresolvable and blocked the fix for the other 342 entries. Same artifact,
    // now at the path it actually occupies.
    expect(body.project.metadata.entryFile).toBe('assets/template.html');

    const filesResp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}/files`);
    expect(filesResp.status).toBe(200);
    const filesBody = (await filesResp.json()) as { files: Array<{ name: string }> };
    const names = filesBody.files.map((f) => f.name);
    expect(names).toContain('assets/template.html');
  });

  // The spec above passes because `trading-analysis-dashboard-template` keeps its
  // HTML *inside* assets/ (assets/template.html) — one of only 10 templates in the
  // 352-entry catalogue shaped that way. The other 342 keep `example.html` at the
  // template root, beside assets/, and the copy step only ever reads assets/. So
  // those projects were created with no HTML at all and the canvas opened empty:
  // 242 got assets with no entry file, and 100 that ship no assets/ dir got a
  // completely empty project. Measured 2026-08-17 against the on-disk catalogue.
  //
  // These two specs pin the dominant shape rather than the convenient one.
  const ROOT_EXAMPLE_TEMPLATE_SKILL_ID = 'aethera-cinematic-hero'; // kind: vite, example.html + assets/
  const NO_ASSETS_TEMPLATE_SKILL_ID = 'animated-text-rotate-hero'; // example.html only, no assets/ dir
  const REMOTE_FONT_TEMPLATE_SKILL_ID = 'lexington-enlightr';

  it('copies a root-level example.html template and sets entryFile', async () => {
    const id = uniqueId('p');
    const resp = await createProject({
      id,
      name: 'Aethera from catalogue',
      skillId: ROOT_EXAMPLE_TEMPLATE_SKILL_ID,
      designSystemId: null,
      metadata: { kind: 'template', animations: false },
    });
    expect(resp.status).toBe(200);
    projectsToClean.push(id);
    const body = (await resp.json()) as {
      project: { metadata: { entryFile?: string } };
    };
    // Without an entry file the canvas has nothing to open.
    expect(body.project.metadata.entryFile).toBeDefined();

    const filesResp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}/files`);
    const filesBody = (await filesResp.json()) as { files: Array<{ name: string }> };
    const names = filesBody.files.map((f) => f.name);
    expect(names.some((name) => /\.html?$/i.test(name))).toBe(true);

    // The bundle the page mounts into must travel with it, at the path the
    // HTML actually references — a vite template renders <div id="root"></div>
    // and nothing else, so a missing or moved bundle is a blank white page.
    const entry = body.project.metadata.entryFile as string;
    const rawResp = await fetch(
      `${baseUrl}/api/projects/${encodeURIComponent(id)}/raw/${entry}`,
    );
    expect(rawResp.status).toBe(200);
    const html = await rawResp.text();
    const scriptSrc = /<script[^>]*\ssrc="([^"]+)"/i.exec(html)?.[1];
    expect(scriptSrc).toBeDefined();
    const assetResp = await fetch(
      `${baseUrl}/api/projects/${encodeURIComponent(id)}/raw/${(scriptSrc as string).replace(/^\.\//, '')}`,
    );
    expect(assetResp.status).toBe(200);
  });

  it('copies a template that ships no assets/ directory at all', async () => {
    const id = uniqueId('p');
    const resp = await createProject({
      id,
      name: 'Animated text from catalogue',
      skillId: NO_ASSETS_TEMPLATE_SKILL_ID,
      designSystemId: null,
      metadata: { kind: 'template', animations: false },
    });
    expect(resp.status).toBe(200);
    projectsToClean.push(id);
    const body = (await resp.json()) as { project: { metadata: { entryFile?: string } } };
    expect(body.project.metadata.entryFile).toBeDefined();

    const filesResp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}/files`);
    const filesBody = (await filesResp.json()) as { files: Array<{ name: string }> };
    expect(filesBody.files.length).toBeGreaterThan(0);
  });

  it('copies self-hosted catalogue fonts and serves every referenced font file', async () => {
    const templateDir = fileURLToPath(
      new URL(`../../../design-templates/${REMOTE_FONT_TEMPLATE_SKILL_ID}/`, import.meta.url),
    );
    const entryHtml = fs.readFileSync(path.join(templateDir, 'example.html'), 'utf8');
    expect(entryHtml).not.toMatch(
      /fonts\.googleapis\.com|fonts\.gstatic\.com|rsms\.me|api\.fontshare\.com/i,
    );

    const stylesheetHref = /<link[^>]+href="([^"]*fonts\/fonts\.css)"[^>]*>/i.exec(entryHtml)?.[1];
    expect(stylesheetHref).toBe('fonts/fonts.css');
    if (!stylesheetHref) throw new Error('Expected vendored font stylesheet link');

    const stylesheetPath = path.resolve(templateDir, stylesheetHref);
    const stylesheet = fs.readFileSync(stylesheetPath, 'utf8');
    const fontRefs = [...stylesheet.matchAll(/url\(["']?([^"')]+)["']?\)/gi)].flatMap(
      (match) => (match[1] ? [match[1]] : []),
    );
    expect(fontRefs.length).toBeGreaterThan(0);
    for (const fontRef of fontRefs) {
      expect(fs.existsSync(path.resolve(path.dirname(stylesheetPath), fontRef))).toBe(true);
    }

    const id = uniqueId('p');
    const resp = await createProject({
      id,
      name: 'Enlightr self-hosted font check',
      skillId: REMOTE_FONT_TEMPLATE_SKILL_ID,
      designSystemId: null,
      metadata: { kind: 'template', animations: false },
    });
    expect(resp.status).toBe(200);
    projectsToClean.push(id);

    for (const fontRef of fontRefs) {
      const projectFontPath = `fonts/${fontRef.replace(/^\.\//, '')}`;
      const fontResp = await fetch(
        `${baseUrl}/api/projects/${encodeURIComponent(id)}/raw/${projectFontPath}`,
      );
      expect(fontResp.status, projectFontPath).toBe(200);
    }
  });

  it('does not copy authoring metadata into the project', async () => {
    const id = uniqueId('p');
    const resp = await createProject({
      id,
      name: 'Aethera metadata check',
      skillId: ROOT_EXAMPLE_TEMPLATE_SKILL_ID,
      designSystemId: null,
      metadata: { kind: 'template', animations: false },
    });
    expect(resp.status).toBe(200);
    projectsToClean.push(id);

    const filesResp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}/files`);
    const filesBody = (await filesResp.json()) as { files: Array<{ name: string }> };
    const names = filesBody.files.map((f) => f.name);
    // SKILL.md is agent instruction, not project content, and it is large.
    expect(names).not.toContain('SKILL.md');
    expect(names).not.toContain('template.json');
  });

  it('does not affect the unrelated saved-template flow (metadata.templateId set, skillId null)', async () => {
    const id = uniqueId('p');
    const resp = await createProject({
      id,
      name: 'Blank saved-template project',
      skillId: null,
      designSystemId: null,
      metadata: { kind: 'template', animations: false, templateId: 'not-a-real-saved-template' },
    });
    expect(resp.status).toBe(200);
    projectsToClean.push(id);
    const body = (await resp.json()) as { project: { skillId: string | null; metadata: { entryFile?: string } } };
    expect(body.project.skillId).toBeNull();
    expect(body.project.metadata.entryFile).toBeUndefined();
  });
});
