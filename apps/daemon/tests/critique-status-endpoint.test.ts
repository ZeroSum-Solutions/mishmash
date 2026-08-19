/**
 * GET /api/projects/:projectId/critique/status
 *
 * Until this route existed, the only way to learn whether Critique Theater
 * would run for a project was to start a generation and read the daemon's
 * stdout. That is how the feature came to be believed unwired while it was in
 * fact live — the finding this test belongs to.
 *
 * Mounts the handler on a bare express app over a real (temp-file) database so
 * the project read and the resolver run exactly as they do in the daemon.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, insertProject, openDatabase, updateProject } from '../src/db.js';
import { handleCritiqueStatus } from '../src/critique/status-handler.js';

const tempDirs: string[] = [];
let db: Database.Database;
let server: http.Server;
let baseUrl: string;
let skillsRoot: string;
let templatesRoot: string;

function createDb(): Database.Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-critique-status-'));
  tempDirs.push(dir);
  return openDatabase(dir, { dataDir: path.join(dir, '.od') });
}

async function start(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.get(
    '/api/projects/:projectId/critique/status',
    // Both roots, mirroring the daemon: a project may bind its skillId to a
    // design template, and a template's critique policy outranks every other
    // input.
    handleCritiqueStatus(db, { skillsRoots: [skillsRoot, templatesRoot] }),
  );
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
}

beforeEach(async () => {
  delete process.env['OD_CRITIQUE_ENABLED'];
  delete process.env['OD_CRITIQUE_ROLLOUT_PHASE'];
  db = createDb();
  skillsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-critique-skills-'));
  templatesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-critique-templates-'));
  tempDirs.push(skillsRoot, templatesRoot);
  const now = Date.now();
  insertProject(db, { id: 'p1', name: 'Project 1', createdAt: now, updatedAt: now });
  await start();
});

afterEach(async () => {
  delete process.env['OD_CRITIQUE_ENABLED'];
  delete process.env['OD_CRITIQUE_ROLLOUT_PHASE'];
  if (server !== undefined) await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDatabase();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function writeSkill(root: string, id: string, policy: string): void {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    [
      '---',
      `name: ${id}`,
      `description: "Fixture skill for the critique status endpoint."`,
      'od:',
      '  critique:',
      `    policy: ${policy}`,
      '---',
      '',
      `# ${id}`,
      '',
    ].join('\n'),
    'utf8',
  );
}

async function getStatus(projectId: string): Promise<{ status: number; body: any }> {
  const resp = await fetch(`${baseUrl}/api/projects/${projectId}/critique/status`);
  return { status: resp.status, body: await resp.json() };
}

describe('GET /api/projects/:projectId/critique/status', () => {
  it('reports the resolved state and every input that produced it', async () => {
    const { status, body } = await getStatus('p1');
    expect(status).toBe(200);
    expect(body.projectId).toBe('p1');
    expect(body.enabled).toBe(false);
    expect(body.resolution).toEqual({
      phase: 'M0',
      skillPolicy: null,
      projectOverride: null,
      envOverride: null,
      approximate: true,
    });
  });

  it('reflects the Settings toggle, which is the whole point of the route', async () => {
    updateProject(db, 'p1', { metadata: { critiqueTheaterEnabled: true } });
    const { body } = await getStatus('p1');
    expect(body.resolution.projectOverride).toBe(true);
    expect(body.enabled).toBe(true);
  });

  it('reflects the daemon-wide env override', async () => {
    process.env['OD_CRITIQUE_ENABLED'] = '1';
    const { body } = await getStatus('p1');
    expect(body.resolution.envOverride).toBe(true);
    expect(body.enabled).toBe(true);
  });

  it('lets a malformed stored override fall through instead of switching the feature on', async () => {
    updateProject(db, 'p1', { metadata: { critiqueTheaterEnabled: 'true' } });
    const { body } = await getStatus('p1');
    expect(body.resolution.projectOverride).toBeNull();
    expect(body.enabled).toBe(false);
  });

  it('reads a skill policy from every root it is given, not just the first', async () => {
    // The defect this pins: resolving only the functional-skill root made the
    // endpoint report the OPPOSITE of a real run for any project bound to a
    // design template, because a skill policy outranks the env override.
    writeSkill(templatesRoot, 'poster-template', 'opt-out');
    updateProject(db, 'p1', { skillId: 'poster-template' });
    process.env['OD_CRITIQUE_ENABLED'] = '1';

    const { body } = await getStatus('p1');
    expect(body.resolution.skillPolicy).toBe('opt-out');
    expect(body.resolution.envOverride).toBe(true);
    // opt-out vetoes outright; reporting `true` here would be an inverted answer.
    expect(body.enabled).toBe(false);
  });

  it('lets a required skill policy enable a project nothing else would', async () => {
    writeSkill(skillsRoot, 'critique-required', 'required');
    updateProject(db, 'p1', { skillId: 'critique-required' });
    const { body } = await getStatus('p1');
    expect(body.resolution.skillPolicy).toBe('required');
    expect(body.enabled).toBe(true);
  });

  it('resolves an aliased skill id the way the spawn gate does', async () => {
    // Skill ids are aliased. A raw `.find()` on the listing misses every
    // alias, which reproduces the same inverted answer through a different
    // door: the spawn gate resolves `taste-skill` to `design-taste-frontend`
    // and sees its policy; the endpoint saw nothing and said `enabled: true`.
    writeSkill(skillsRoot, 'design-taste-frontend', 'opt-out');
    updateProject(db, 'p1', { skillId: 'taste-skill' });
    process.env['OD_CRITIQUE_ENABLED'] = '1';

    const { body } = await getStatus('p1');
    expect(body.resolution.skillPolicy).toBe('opt-out');
    expect(body.enabled).toBe(false);
  });

  it('404s an unknown project', async () => {
    const { status, body } = await getStatus('does-not-exist');
    expect(status).toBe(404);
    expect(body.error.code).toBe('PROJECT_NOT_FOUND');
  });
});
