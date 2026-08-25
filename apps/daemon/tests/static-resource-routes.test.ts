import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DesignSystemTokenContractRebuildJobResponse } from '@open-design/contracts';

import { isLocalSameOrigin } from '../src/origin-validation.js';
import { listDesignSystems } from '../src/design-systems/index.js';
import { registerStaticResourceRoutes } from '../src/routes/static-resource.js';
import { listSkills } from '../src/skills.js';

describe('static resource mutation routes', () => {
  let server: http.Server;
  let baseUrl: string;
  let tempRoot: string;
  let catalogReadCount = 0;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-static-routes-'));
        const app = express();
        app.use(express.json({ limit: '4mb' }));
        registerStaticResourceRoutes(app, {
          http: {
            createSseResponse: () => undefined,
            isLocalSameOrigin,
            requireLocalDaemonRequest: (_req: unknown, _res: unknown, next: () => void) => next(),
            resolvedPortRef: {
              get current() {
                const address = server.address();
                return typeof address === 'object' && address ? address.port : 0;
              },
            },
            sendApiError: (res: express.Response, status: number, code: string, message: string) =>
              res.status(status).json({ error: message, code }),
            sendLiveArtifactRouteError: () => undefined,
            sendMulterError: () => undefined,
          },
          paths: {
            ARTIFACTS_DIR: path.join(tempRoot, 'artifacts'),
            BRANDS_DIR: path.join(tempRoot, 'brands'),
            BUNDLED_PETS_DIR: path.join(tempRoot, 'pets'),
            CRAFT_DIR: path.join(tempRoot, 'craft'),
            DESIGN_SYSTEMS_DIR: path.join(tempRoot, 'design-systems'),
            DESIGN_TEMPLATES_DIR: path.join(tempRoot, 'design-templates'),
            LIBRARY_DIR: path.join(tempRoot, 'library'),
            OD_BIN: path.join(tempRoot, 'od'),
            PROJECT_ROOT: tempRoot,
            PROJECTS_DIR: path.join(tempRoot, 'projects'),
            PROMPT_TEMPLATES_DIR: path.join(tempRoot, 'prompt-templates'),
            RUNTIME_DATA_DIR: path.join(tempRoot, 'data'),
            RUNTIME_DATA_DIR_CANONICAL: path.join(tempRoot, 'data'),
            SKILLS_DIR: path.join(tempRoot, 'skills'),
            USER_DESIGN_SYSTEMS_DIR: path.join(tempRoot, 'user-design-systems'),
            USER_DESIGN_TEMPLATES_DIR: path.join(tempRoot, 'user-design-templates'),
            USER_SKILLS_DIR: path.join(tempRoot, 'user-skills'),
          },
          resources: {
            listAllDesignSystems: async () => {
              catalogReadCount += 1;
              return [];
            },
            listAllSkills: async () => {
              catalogReadCount += 1;
              return [];
            },
            listAllDesignTemplates: async () => {
              catalogReadCount += 1;
              return [];
            },
            listAllSkillLikeEntries: async () => [],
            mimeFor: () => 'application/octet-stream',
          },
        });

        server = app.listen(0, '127.0.0.1', () => {
          const addr = server.address() as { port: number };
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      }),
  );

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          resolve();
        });
      }),
  );

  it.each([
    ['POST', '/api/skills/install'],
    ['DELETE', '/api/skills/demo-skill'],
    ['POST', '/api/design-systems/install'],
    ['POST', '/api/design-systems/import/local'],
    ['POST', '/api/design-systems/import/github'],
    ['POST', '/api/design-systems/import/shadcn'],
    ['DELETE', '/api/design-systems/demo-system'],
    // Every route in this table writes to disk or pulls remote content into it,
    // so each must refuse a cross-origin caller before doing any of that work.
    // The list is the contract: a mutation route added to this file without a
    // corresponding row here is the gap this table exists to catch.
    ['POST', '/api/skills/import'],
    ['PUT', '/api/skills/demo-skill'],
    ['POST', '/api/codex-pets/sync'],
  ])('rejects cross-origin %s %s before catalog or filesystem work', async (method, route) => {
    catalogReadCount = 0;
    const init: RequestInit = {
      method,
      headers: {
        Origin: 'https://evil.example',
        'Content-Type': 'application/json',
      },
    };
    if (method === 'POST' || method === 'PUT') {
      init.body = JSON.stringify({
        source: 'local',
        path: tempRoot,
        baseDir: tempRoot,
        githubUrl: 'https://github.com/example/repo',
        reference: 'shadcn/ui/theme-zinc',
      });
    }
    const res = await fetch(`${baseUrl}${route}`, init);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect(catalogReadCount).toBe(0);
  });

  it('returns a bad request for a missing local design-system import path', async () => {
    catalogReadCount = 0;
    const res = await fetch(`${baseUrl}/api/design-systems/import/local`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ baseDir: path.join(tempRoot, 'missing-project') }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'BAD_REQUEST' });
    expect(catalogReadCount).toBe(0);
  });

  it('returns a bad request for a blank shadcn design-system reference', async () => {
    catalogReadCount = 0;
    const res = await fetch(`${baseUrl}/api/design-systems/import/shadcn`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reference: '   ' }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'BAD_REQUEST' });
    expect(catalogReadCount).toBe(0);
  });

  it('reuses one design-template catalogue scan across repeated list requests', async () => {
    catalogReadCount = 0;

    const first = await fetch(`${baseUrl}/api/design-templates`);
    const second = await fetch(`${baseUrl}/api/design-templates`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(catalogReadCount).toBe(1);
  });
});

// Route-level coverage for POST /api/skills/import, the daemon side of the
// skill-package-import capability (web entry point:
// apps/web/src/components/SkillsSection.tsx -> importSkill() in
// apps/web/src/providers/registry.ts). importUserSkill()'s own unit tests
// (apps/daemon/tests/skills.test.ts) already prove slugifySkillName strips
// traversal sequences; this block proves the same containment guarantee
// survives the real HTTP boundary (lexical + realpath) and locks in two
// route-level behaviors that had no coverage: the missing local-origin gate
// (every sibling mutation route in this file calls requireLocalOrigin; this
// route silently did not) and the wrong HTTP status a duplicate-name import
// was mapped to.
describe('POST /api/skills/import', () => {
  let server: http.Server;
  let baseUrl: string;
  let tempRoot: string;
  let userSkillsDir: string;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-skills-import-'));
        userSkillsDir = path.join(tempRoot, 'user-skills');
        const app = express();
        app.use(express.json({ limit: '4mb' }));
        registerStaticResourceRoutes(app, {
          http: {
            createSseResponse: () => undefined,
            isLocalSameOrigin,
            requireLocalDaemonRequest: (_req: unknown, _res: unknown, next: () => void) => next(),
            resolvedPortRef: {
              get current() {
                const address = server.address();
                return typeof address === 'object' && address ? address.port : 0;
              },
            },
            sendApiError: (res: express.Response, status: number, code: string, message: string) =>
              res.status(status).json({ error: message, code }),
            sendLiveArtifactRouteError: () => undefined,
            sendMulterError: () => undefined,
          },
          paths: {
            ARTIFACTS_DIR: path.join(tempRoot, 'artifacts'),
            BRANDS_DIR: path.join(tempRoot, 'brands'),
            BUNDLED_PETS_DIR: path.join(tempRoot, 'pets'),
            CRAFT_DIR: path.join(tempRoot, 'craft'),
            DESIGN_SYSTEMS_DIR: path.join(tempRoot, 'design-systems'),
            DESIGN_TEMPLATES_DIR: path.join(tempRoot, 'design-templates'),
            LIBRARY_DIR: path.join(tempRoot, 'library'),
            OD_BIN: path.join(tempRoot, 'od'),
            PROJECT_ROOT: tempRoot,
            PROJECTS_DIR: path.join(tempRoot, 'projects'),
            PROMPT_TEMPLATES_DIR: path.join(tempRoot, 'prompt-templates'),
            RUNTIME_DATA_DIR: path.join(tempRoot, 'data'),
            RUNTIME_DATA_DIR_CANONICAL: path.join(tempRoot, 'data'),
            SKILLS_DIR: path.join(tempRoot, 'skills'),
            USER_DESIGN_SYSTEMS_DIR: path.join(tempRoot, 'user-design-systems'),
            USER_DESIGN_TEMPLATES_DIR: path.join(tempRoot, 'user-design-templates'),
            USER_SKILLS_DIR: userSkillsDir,
          },
          resources: {
            listAllDesignSystems: async () => [],
            // Wired to the real listSkills() (not a hand-rolled stub) so a
            // successful import's catalog round-trip is genuine, matching how
            // server.ts wires listAllSkills in production.
            listAllSkills: () => listSkills(userSkillsDir),
            listAllDesignTemplates: async () => [],
            listAllSkillLikeEntries: async () => [],
            mimeFor: () => 'application/octet-stream',
          },
        });

        server = app.listen(0, '127.0.0.1', () => {
          const addr = server.address() as { port: number };
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      }),
  );

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          resolve();
        });
      }),
  );

  it('writes SKILL.md under USER_SKILLS_DIR and returns the imported catalog entry with 201', async () => {
    const res = await fetch(`${baseUrl}/api/skills/import`, {
      method: 'POST',
      headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Route Import Test',
        description: 'Imported via the HTTP route.',
        body: '# Route Import Test\n\nDo the thing.',
        triggers: ['route import'],
      }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { skill: { id: string; source: string; triggers: string[] } };
    expect(data.skill.id).toBe('Route Import Test');
    expect(data.skill.source).toBe('user');
    expect(data.skill.triggers).toEqual(['route import']);
    expect(fs.existsSync(path.join(userSkillsDir, 'route-import-test', 'SKILL.md'))).toBe(true);
  });

  // Path containment, proven at the HTTP boundary the way the task requires:
  // lexically (the slug the route derives from a traversal-shaped name has no
  // path separators left) AND by realpath (the directory actually written
  // resolves strictly inside USER_SKILLS_DIR even after symlink resolution).
  it('contains a traversal-shaped skill name inside USER_SKILLS_DIR (lexical + realpath)', async () => {
    const res = await fetch(`${baseUrl}/api/skills/import`, {
      method: 'POST',
      headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '../../etc/passwd', body: '# traversal-shaped body' }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { skill: { id: string } };
    expect(data.skill.id).toBe('../../etc/passwd');

    const writtenDir = path.join(userSkillsDir, 'etc-passwd');
    expect(fs.existsSync(path.join(writtenDir, 'SKILL.md'))).toBe(true);
    // Nothing was written outside the sandboxed root at all.
    expect(fs.existsSync(path.join(tempRoot, 'etc'))).toBe(false);
    expect(fs.existsSync('/tmp/etc-passwd')).toBe(false);

    const realWrittenDir = fs.realpathSync(writtenDir);
    const realUserSkillsDir = fs.realpathSync(userSkillsDir);
    expect(realWrittenDir.startsWith(`${realUserSkillsDir}${path.sep}`)).toBe(true);
  });

  it('rejects a same-name import that already exists with 409 CONFLICT (not the catch-all 500)', async () => {
    const body = JSON.stringify({ name: 'Duplicate Skill', body: '# first body' });
    const first = await fetch(`${baseUrl}/api/skills/import`, {
      method: 'POST',
      headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
      body,
    });
    expect(first.status).toBe(201);

    const second = await fetch(`${baseUrl}/api/skills/import`, {
      method: 'POST',
      headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
      body,
    });
    expect(second.status).toBe(409);
    const data = (await second.json()) as { code: string };
    expect(data.code).toBe('CONFLICT');
  });

  it('rejects an empty body with 400 BAD_REQUEST and writes nothing', async () => {
    const res = await fetch(`${baseUrl}/api/skills/import`, {
      method: 'POST',
      headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Empty Body Skill', body: '   ' }),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { code: string };
    expect(data.code).toBe('BAD_REQUEST');
    expect(fs.existsSync(path.join(userSkillsDir, 'empty-body-skill'))).toBe(false);
  });

  // Every other mutation route in this file (skills install/delete,
  // design-system install/import/delete) rejects a cross-origin request with
  // 403 before doing any filesystem work — see the `it.each` block above.
  // /api/skills/import writes to the same USER_SKILLS_DIR through the same
  // kind of daemon-only mutation and must be gated the same way.
  it('rejects a cross-origin import with 403 before writing anything', async () => {
    const res = await fetch(`${baseUrl}/api/skills/import`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cross Origin Skill', body: '# should never land' }),
    });
    expect(res.status).toBe(403);
    const data = (await res.json()) as { code: string };
    expect(data.code).toBe('FORBIDDEN');
    expect(fs.existsSync(path.join(userSkillsDir, 'cross-origin-skill'))).toBe(false);
  });
});

describe('design system import catalog lookup', () => {
  let server: http.Server;
  let baseUrl: string;
  let tempRoot: string;
  let sourceRoot: string;
  let userDesignSystemsDir: string;
  let maybeStartTokenContractRebuild:
    | ((designSystemId: string) => Promise<DesignSystemTokenContractRebuildJobResponse | undefined>)
    | undefined;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-static-import-'));
        sourceRoot = path.join(tempRoot, 'source-app');
        userDesignSystemsDir = path.join(tempRoot, 'user-design-systems');
        fs.mkdirSync(path.join(sourceRoot, 'src', 'styles'), { recursive: true });
        fs.writeFileSync(
          path.join(sourceRoot, 'package.json'),
          JSON.stringify({ name: 'demo-app', description: 'Demo import source.' }),
        );
        fs.writeFileSync(
          path.join(sourceRoot, 'README.md'),
          '# Demo App\n\nA simple import fixture.\n',
        );
        fs.writeFileSync(
          path.join(sourceRoot, 'src', 'styles', 'tokens.css'),
          ':root { --color-primary: #3366ff; }',
        );

        const app = express();
        app.use(express.json({ limit: '4mb' }));
        registerStaticResourceRoutes(app, {
          http: {
            createSseResponse: () => undefined,
            isLocalSameOrigin,
            requireLocalDaemonRequest: (_req: unknown, _res: unknown, next: () => void) => next(),
            resolvedPortRef: {
              get current() {
                const address = server.address();
                return typeof address === 'object' && address ? address.port : 0;
              },
            },
            sendApiError: (res: express.Response, status: number, code: string, message: string) =>
              res.status(status).json({ error: message, code }),
            sendLiveArtifactRouteError: () => undefined,
            sendMulterError: () => undefined,
          },
          paths: {
            ARTIFACTS_DIR: path.join(tempRoot, 'artifacts'),
            BRANDS_DIR: path.join(tempRoot, 'brands'),
            BUNDLED_PETS_DIR: path.join(tempRoot, 'pets'),
            CRAFT_DIR: path.join(tempRoot, 'craft'),
            DESIGN_SYSTEMS_DIR: path.join(tempRoot, 'design-systems'),
            DESIGN_TEMPLATES_DIR: path.join(tempRoot, 'design-templates'),
            LIBRARY_DIR: path.join(tempRoot, 'library'),
            OD_BIN: path.join(tempRoot, 'od'),
            PROJECT_ROOT: tempRoot,
            PROJECTS_DIR: path.join(tempRoot, 'projects'),
            PROMPT_TEMPLATES_DIR: path.join(tempRoot, 'prompt-templates'),
            RUNTIME_DATA_DIR: path.join(tempRoot, 'data'),
            RUNTIME_DATA_DIR_CANONICAL: path.join(tempRoot, 'data'),
            SKILLS_DIR: path.join(tempRoot, 'skills'),
            USER_DESIGN_SYSTEMS_DIR: userDesignSystemsDir,
            USER_DESIGN_TEMPLATES_DIR: path.join(tempRoot, 'user-design-templates'),
            USER_SKILLS_DIR: path.join(tempRoot, 'user-skills'),
          },
          resources: {
            listAllDesignSystems: async () =>
              listDesignSystems(userDesignSystemsDir, {
                idPrefix: 'user:',
                source: 'user',
                isEditable: true,
                defaultStatus: 'draft',
              }),
            listAllSkills: async () => [],
            listAllDesignTemplates: async () => [],
            listAllSkillLikeEntries: async () => [],
            mimeFor: () => 'application/octet-stream',
          },
          tokenContractRebuild: {
            maybeStartForImportedDesignSystem: async (designSystemId) =>
              maybeStartTokenContractRebuild?.(designSystemId),
          },
        });

        server = app.listen(0, '127.0.0.1', () => {
          const addr = server.address() as { port: number };
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      }),
  );

  afterEach(() => {
    maybeStartTokenContractRebuild = undefined;
    vi.restoreAllMocks();
  });

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          resolve();
        });
      }),
  );

  it('returns the imported user design system with its user: catalog id', async () => {
    const res = await fetch(`${baseUrl}/api/design-systems/import/local`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ baseDir: sourceRoot }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { designSystem: { id: string; title: string } };
    expect(body.designSystem.id).toBe('user:demo-app');
    expect(body.designSystem.title).toBe('demo app');
    expect(fs.existsSync(path.join(userDesignSystemsDir, 'demo-app', 'DESIGN.md'))).toBe(true);
  });

  it('keeps local design-system import successful when token contract auto-queue fails', async () => {
    maybeStartTokenContractRebuild = async () => {
      throw new Error('token report stat failed');
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await fetch(`${baseUrl}/api/design-systems/import/local`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ baseDir: sourceRoot }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      designSystem: { id: string; title: string };
      tokenContractRebuild?: unknown;
    };
    expect(body.designSystem.id).toMatch(/^user:demo-app(?:-\d+)?$/u);
    expect(body.designSystem.title).toBe('demo app');
    expect(body.tokenContractRebuild).toBeUndefined();
    expect(fs.existsSync(path.join(userDesignSystemsDir, body.designSystem.id.replace(/^user:/u, ''), 'DESIGN.md'))).toBe(true);
  });

  it('imports a shadcn registry item served from a loopback registry URL', async () => {
    const item = {
      name: 'theme-loopback',
      type: 'registry:theme',
      title: 'Theme Loopback',
      description: 'Served from a loopback fixture.',
      cssVars: { light: { background: '0 0% 100%', primary: '262 83% 58%' } },
    };
    const fixture = http.createServer((req, res) => {
      if (req.url === '/r/theme-loopback.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(item));
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', () => resolve()));

    try {
      const fixturePort = (fixture.address() as { port: number }).port;
      const reference = `http://127.0.0.1:${fixturePort}/r/theme-loopback.json`;
      const res = await fetch(`${baseUrl}/api/design-systems/import/shadcn`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reference }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { designSystem: { id: string; title: string } };
      expect(body.designSystem.id).toBe('user:theme-loopback');
      expect(body.designSystem.title).toBe('Theme Loopback');
      const tokens = fs.readFileSync(
        path.join(userDesignSystemsDir, 'theme-loopback', 'tokens.css'),
        'utf8',
      );
      expect(tokens).toContain('--accent: hsl(262 83% 58%)');
    } finally {
      await new Promise<void>((resolve) => fixture.close(() => resolve()));
    }
  });
});
