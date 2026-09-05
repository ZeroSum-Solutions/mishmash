// @vitest-environment node

// W3F red spec — every PRD 7.2 read route (plus the five routes D-20 added)
// answers with the envelope `packages/contracts` owns for it, inside the
// INV-3.6 per-request budget, with the origin/containment gates untouched.
//
// Three claims, one per `test` below, so each fails on its own evidence
// rather than hiding behind whichever aborts first.
//
// 1. Contracts ownership. DEF-3.3: the prompt-template and public
//    media-provider-config envelopes had no `packages/contracts` export at
//    all — the web app carried private copies (`apps/web/src/types.ts`,
//    `apps/web/src/state/config.ts`), so no test could validate what the
//    daemon actually sends. A TypeScript interface is erased at runtime, so
//    the falsifiable form of "contracts owns this envelope" is a runtime type
//    guard, the shape the package already ships for other response families.
//
// 2. Envelope and budget. INV-3.6 / DEF-3.4: each normalized route is judged
//    on its own, never inside a grouped row, and must answer under
//    ROUTE_BUDGET_MS. `/api/projects/:id` is measured twice — cold (file-index
//    cache miss, owned by track 3B) and warm — and both numbers are reported.
//    Every row's problems are collected and asserted once, so one run names
//    every route that is wrong instead of only the first.
//
// 3. FU-28 and containment. The Templates gallery derives an
//    `assets/poster.jpg` URL from every entry id, but only one of the shipped
//    design templates has that file, so nearly every gallery paint fired a 404
//    through `sendSkillSubresource` — the busiest slow route in the wave-2
//    window. A 404 is a failed observation, not a sample, so the listing must
//    not advertise a poster the daemon cannot serve. INV-3.9: the local-origin
//    gate and the skill sub-resource path-containment check must still reject
//    what they rejected before.

import { randomUUID } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import * as contracts from '@open-design/contracts';
import type {
  AnalyticsConfigResponse,
  ConnectorDiscoveryResponse,
  ConnectorListResponse,
  ConnectorStatus,
  ConnectorStatusResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  DesignSystemsResponse,
  DesignTemplatesResponse,
  LiveArtifactListResponse,
  ProjectDetailResponse,
  ProjectsResponse,
  RecentLinkedDirsResponse,
  SkillsResponse,
} from '@open-design/contracts';

import { requestJson } from '@/vitest/http';
import { createSmokeSuite } from '@/vitest/suite';

/** INV-3.6: every normalized 7.2/D-20 read route answers under this on its own. */
const ROUTE_BUDGET_MS = 2_000;

/** Projects seeded before the table runs, so no row measures an empty daemon. */
const SEEDED_PROJECTS = 12;

/** The `ConnectorStatus` union, spelled out so a bad value reads as data. */
const CONNECTOR_STATUS_VALUES: ConnectorStatus[] = [
  'available',
  'connected',
  'disabled',
  'error',
];

/**
 * Design template that ships `assets/poster.jpg` and a `fonts/` directory —
 * the two skill sub-resource routes D-20 added to the bar need a request that
 * really resolves, not a 404 dressed up as a sample.
 */
const POSTER_TEMPLATE_ID = 'lexington-westend';
const FONTS_TEMPLATE_ID = 'lexington-sandstone';

/**
 * Runtime validators `packages/contracts` must own for the two DEF-3.3
 * families. Named as strings rather than imported so this file reports a
 * missing export as an assertion about the symptom instead of crashing at
 * import time.
 */
const REQUIRED_CONTRACT_GUARDS = [
  'isPromptTemplatesResponse',
  'isPromptTemplateResponse',
  'isPublicMediaProviderConfigResponse',
] as const;

type ContractGuard = (value: unknown) => boolean;

/** The exported guard, or `null` when `packages/contracts` does not own it. */
function contractGuard(name: string): ContractGuard | null {
  const guard = (contracts as unknown as Record<string, unknown>)[name];
  return typeof guard === 'function' ? (guard as ContractGuard) : null;
}

type Measurement = {
  route: string;
  contract: string;
  durationMs: number;
  status: number;
  bytes: number;
};

type TimedResponse = {
  body: unknown;
  bytes: number;
  durationMs: number;
  status: number;
  text: string;
};

async function timedGet(baseUrl: string, path: string): Promise<TimedResponse> {
  const startedAt = performance.now();
  const response = await fetch(new URL(path, baseUrl));
  const buffer = Buffer.from(await response.arrayBuffer());
  const durationMs = performance.now() - startedAt;
  const text = buffer.toString('utf8');
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { body, bytes: buffer.byteLength, durationMs, status: response.status, text };
}

/**
 * Seed enough projects that no row measures an empty daemon, and return the id
 * the per-project rows address.
 */
async function seedProjects(daemonUrl: string): Promise<string> {
  const ids: string[] = [];
  for (let index = 0; index < SEEDED_PROJECTS; index += 1) {
    const request: CreateProjectRequest = {
      designSystemId: null,
      id: randomUUID(),
      metadata: { kind: 'prototype' },
      name: `W3F read-route seed ${index + 1}`,
      pendingPrompt: '',
      skillId: null,
    };
    const created = await requestJson<CreateProjectResponse>(daemonUrl, '/api/projects', {
      body: request,
    });
    ids.push(created.project.id);
  }
  return ids[0]!;
}

describe('W3F read-route contracts, budget and containment', () => {
  test('[P1] contracts owns a runtime validator for every W3 read-route envelope', () => {
    const missing = REQUIRED_CONTRACT_GUARDS.filter((name) => contractGuard(name) == null);
    expect(
      missing,
      'DEF-3.3: the prompt-template and public media-config envelopes were web-private, so no spec could validate what the daemon sends',
    ).toEqual([]);
  });

  test('[P1] every W3 read route returns its contracts envelope under budget', async () => {
    const suite = await createSmokeSuite('w3-read-endpoints');

    await suite.with.toolsDev(async ({ runtime }) => {
      const daemonUrl = `http://127.0.0.1:${runtime.daemonPort}/`;
      const seededProjectId = await seedProjects(daemonUrl);

      // Each row names the `packages/contracts` export that owns its
      // envelope. `validate` reports what is wrong rather than throwing, so
      // one run names every bad route instead of only the first (DEF-3.4:
      // rows are judged one at a time, never grouped).
      const rows: Array<{
        route: string;
        contract: string;
        path: string;
        validate: (body: unknown) => string | null;
      }> = [
        {
          route: 'GET /api/projects',
          contract: 'ProjectsResponse',
          path: '/api/projects',
          validate: (body) => {
            const value = body as ProjectsResponse;
            if (!Array.isArray(value?.projects)) return 'projects is not an array';
            if (value.projects.length < SEEDED_PROJECTS) {
              return `expected at least ${SEEDED_PROJECTS} projects, saw ${value.projects.length}`;
            }
            const bad = value.projects.find(
              (project) =>
                typeof project.id !== 'string'
                || typeof project.name !== 'string'
                || typeof project.hasCover !== 'boolean',
            );
            return bad ? `project ${String(bad.id)} does not match ProjectsResponse` : null;
          },
        },
        {
          route: 'GET /api/projects/:id (cold)',
          contract: 'ProjectDetailResponse',
          path: `/api/projects/${seededProjectId}`,
          validate: (body) => {
            const value = body as ProjectDetailResponse;
            if (value?.project?.id !== seededProjectId) return 'project.id does not match';
            return typeof value.resolvedDir === 'string' ? null : 'resolvedDir is not a string';
          },
        },
        {
          route: 'GET /api/projects/:id (warm)',
          contract: 'ProjectDetailResponse',
          path: `/api/projects/${seededProjectId}`,
          validate: (body) => {
            const value = body as ProjectDetailResponse;
            if (value?.project?.id !== seededProjectId) return 'project.id does not match';
            return typeof value.resolvedDir === 'string' ? null : 'resolvedDir is not a string';
          },
        },
        {
          route: 'GET /api/live-artifacts',
          contract: 'LiveArtifactListResponse',
          path: `/api/live-artifacts?projectId=${encodeURIComponent(seededProjectId)}`,
          validate: (body) =>
            Array.isArray((body as LiveArtifactListResponse)?.artifacts)
              ? null
              : 'artifacts is not an array',
        },
        {
          route: 'GET /api/design-systems',
          contract: 'DesignSystemsResponse',
          path: '/api/design-systems',
          validate: (body) => {
            const value = body as DesignSystemsResponse;
            if (!Array.isArray(value?.designSystems)) return 'designSystems is not an array';
            if (value.designSystems.length === 0) return 'no design systems listed';
            return value.designSystems.every((system) => typeof system.id === 'string')
              ? null
              : 'a design system has no string id';
          },
        },
        {
          route: 'GET /api/skills',
          contract: 'SkillsResponse',
          path: '/api/skills',
          validate: (body) => {
            const value = body as SkillsResponse;
            if (!Array.isArray(value?.skills)) return 'skills is not an array';
            if (value.skills.length === 0) return 'no skills listed';
            return value.skills.every((skill) => typeof skill.id === 'string')
              ? null
              : 'a skill has no string id';
          },
        },
        {
          route: 'GET /api/prompt-templates',
          contract: 'PromptTemplatesResponse',
          path: '/api/prompt-templates',
          validate: (body) => {
            const guard = contractGuard('isPromptTemplatesResponse');
            if (!guard) return 'packages/contracts exports no isPromptTemplatesResponse (DEF-3.3)';
            return guard(body) ? null : 'body does not satisfy PromptTemplatesResponse';
          },
        },
        {
          route: 'GET /api/recent-dirs',
          contract: 'RecentLinkedDirsResponse',
          path: '/api/recent-dirs',
          validate: (body) => {
            const value = body as RecentLinkedDirsResponse;
            if (!Array.isArray(value?.dirs)) return 'dirs is not an array';
            return value.dirs.every((dir) => typeof dir === 'string')
              ? null
              : 'a recent dir is not a string';
          },
        },
        {
          route: 'GET /api/analytics/config',
          contract: 'AnalyticsConfigResponse',
          path: '/api/analytics/config',
          validate: (body) => {
            const value = body as AnalyticsConfigResponse;
            if (typeof value?.enabled !== 'boolean') return 'enabled is not a boolean';
            return typeof value.env === 'string' ? null : 'env is not a string';
          },
        },
        {
          route: 'GET /api/media/config',
          contract: 'PublicMediaProviderConfigResponse',
          path: '/api/media/config',
          validate: (body) => {
            const guard = contractGuard('isPublicMediaProviderConfigResponse');
            if (!guard) {
              return 'packages/contracts exports no isPublicMediaProviderConfigResponse (DEF-3.3)';
            }
            return guard(body)
              ? null
              : 'body does not satisfy PublicMediaProviderConfigResponse, including the aliases the daemon emits';
          },
        },
        {
          route: 'GET /api/connectors',
          contract: 'ConnectorListResponse',
          path: '/api/connectors',
          validate: (body) =>
            Array.isArray((body as ConnectorListResponse)?.connectors)
              ? null
              : 'connectors is not an array',
        },
        {
          route: 'GET /api/connectors/status',
          contract: 'ConnectorStatusResponse',
          path: '/api/connectors/status',
          // `statuses` is keyed by connector id, not a list.
          validate: (body) => {
            const statuses = (body as ConnectorStatusResponse)?.statuses;
            if (typeof statuses !== 'object' || statuses === null || Array.isArray(statuses)) {
              return 'statuses is not a record keyed by connector id';
            }
            const bad = Object.entries(statuses).find(
              ([, summary]) => !CONNECTOR_STATUS_VALUES.includes(summary?.status),
            );
            return bad ? `connector ${bad[0]} has status ${String(bad[1]?.status)}` : null;
          },
        },
        {
          route: 'GET /api/connectors/discovery',
          contract: 'ConnectorDiscoveryResponse',
          path: '/api/connectors/discovery',
          validate: (body) =>
            Array.isArray((body as ConnectorDiscoveryResponse)?.connectors)
              ? null
              : 'connectors is not an array',
        },
      ];

      const measurements: Measurement[] = [];
      const envelopeProblems: string[] = [];
      const overBudget: string[] = [];

      const record = (
        route: string,
        contract: string,
        response: TimedResponse,
        problem: string | null,
      ): void => {
        measurements.push({
          bytes: response.bytes,
          contract,
          durationMs: response.durationMs,
          route,
          status: response.status,
        });
        if (problem) envelopeProblems.push(`${route}: ${problem}`);
        if (response.durationMs >= ROUTE_BUDGET_MS) {
          overBudget.push(`${route} ${response.durationMs.toFixed(0)}ms`);
        }
      };

      for (const row of rows) {
        const response = await timedGet(daemonUrl, row.path);
        const problem = response.status !== 200
          ? `answered ${response.status}, expected 200`
          : row.validate(response.body);
        record(row.route, row.contract, response, problem);
      }

      // The two skill sub-resource routes D-20 added answer bytes, not JSON,
      // so their envelope claim is "a real sub-resource resolves".
      for (const [route, path] of [
        ['GET /api/skills/:id/assets/*', `/api/skills/${POSTER_TEMPLATE_ID}/assets/poster.jpg`],
        ['GET /api/skills/:id/fonts/*', `/api/skills/${FONTS_TEMPLATE_ID}/fonts/fonts.css`],
      ] as const) {
        const response = await timedGet(daemonUrl, path);
        const problem = response.status !== 200
          ? `answered ${response.status}, expected 200`
          : response.bytes > 0
            ? null
            : 'answered 200 with an empty body';
        record(route, 'raw bytes (no JSON envelope)', response, problem);
      }

      await suite.report.json('w3/read-endpoints.json', {
        budgetMs: ROUTE_BUDGET_MS,
        measurements,
        seededProjects: SEEDED_PROJECTS,
      });

      expect(
        envelopeProblems,
        'every W3 read route must answer the envelope packages/contracts owns for it (DEF-3.3)',
      ).toEqual([]);
      expect(
        overBudget,
        `every normalized route must answer under ${ROUTE_BUDGET_MS} ms on its own (INV-3.6, DEF-3.4)`,
      ).toEqual([]);
    });
  }, 600_000);

  test('[P1] the listing advertises only posters that resolve, and containment still refuses', async () => {
    const suite = await createSmokeSuite('w3-poster-containment');

    await suite.with.toolsDev(async ({ runtime }) => {
      const daemonUrl = `http://127.0.0.1:${runtime.daemonPort}/`;

      // --- FU-28 ----------------------------------------------------------
      // The gallery asks for `assets/poster.jpg` for every listed entry. The
      // listing must therefore say which entries have one; an advertised
      // poster that 404s is a failed observation the latency capture cannot
      // count.
      const templates = await requestJson<DesignTemplatesResponse>(
        daemonUrl,
        '/api/design-templates',
      );
      expect(templates.designTemplates.length).toBeGreaterThan(0);
      // Read through a structural cast rather than the contracts type: this
      // spec has to run unchanged on the base commit, where the field does
      // not exist yet, and report a missing flag as an assertion failure
      // instead of a compile error.
      const posterFlag = (entry: unknown): unknown => (entry as { hasPoster?: unknown }).hasPoster;
      const missingFlag = templates.designTemplates.filter(
        (entry) => typeof posterFlag(entry) !== 'boolean',
      );
      expect(
        missingFlag.map((entry) => entry.id).slice(0, 5),
        `every listing entry must declare whether it ships assets/poster.jpg (FU-28); ${missingFlag.length} of ${templates.designTemplates.length} do not`,
      ).toEqual([]);

      const advertised = templates.designTemplates.filter((entry) => posterFlag(entry) === true);
      expect(advertised.length, 'the shipped poster must still be advertised').toBeGreaterThan(0);

      const brokenPosters: string[] = [];
      for (const entry of advertised) {
        const response = await fetch(
          new URL(`/api/skills/${encodeURIComponent(entry.id)}/assets/poster.jpg`, daemonUrl),
        );
        if (response.status !== 200) brokenPosters.push(`${entry.id} -> ${response.status}`);
      }
      expect(
        brokenPosters,
        'the listing must not advertise a poster the daemon answers 404 for (FU-28)',
      ).toEqual([]);

      // --- INV-3.9 containment --------------------------------------------
      // A cross-site request to a gated route is still refused.
      const crossOrigin = await fetch(new URL('/api/recent-dirs', daemonUrl), {
        headers: { origin: 'http://attacker.example', 'sec-fetch-site': 'cross-site' },
      });
      expect(crossOrigin.status, 'the local-origin gate must still refuse a cross-site read').toBe(
        403,
      );

      // A skill sub-resource path may not escape the entry's own root.
      //
      // Both cases assert 400 exactly, not "400 or 404". 404 is also what the
      // handler answers when the entry resolves and the file simply is not
      // there, so accepting it would let a future edit that dropped the
      // containment check pass this assertion unnoticed. 400 is reachable only
      // from the containment branch.
      //
      // The `assets` route carries no extension allowlist
      // (`static-resource.ts` registers it without one), so containment is the
      // only thing that can reject this request.
      const escapedAsset = await fetch(
        new URL(`/api/skills/${POSTER_TEMPLATE_ID}/assets/..%2F..%2F..%2Fpackage.json`, daemonUrl),
      );
      expect(
        escapedAsset.status,
        'skill asset containment must refuse a traversal out of the entry root',
      ).toBe(400);

      // The `fonts` route does carry an allowlist, so this traversal uses an
      // allowlisted extension (`.css`): the allowlist cannot be what rejects
      // it, and containment must be.
      const escapedFont = await fetch(
        new URL(`/api/skills/${FONTS_TEMPLATE_ID}/fonts/..%2F..%2F..%2Fpackage.css`, daemonUrl),
      );
      expect(
        escapedFont.status,
        'skill font containment must refuse a traversal whose extension the allowlist permits',
      ).toBe(400);
    });
  }, 600_000);
});
