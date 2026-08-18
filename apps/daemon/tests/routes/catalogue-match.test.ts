// POST /api/catalogue/match — end-to-end proof against the REAL
// design-templates/ and skills/ catalogue on disk (not a fixture), so this
// pins the actual defect: an architectural-photography brief used to match
// nothing, `slate-stone-architectural-h73` and `valmax-photography-landing`
// were unreachable, and skillId stayed null. See
// packages/contracts/tests/catalogue-match.test.ts for the ranking
// algorithm's isolated property tests (synthetic fixtures).

import type http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listSkills } from '../../src/skills.js';
import { registerCatalogueMatchRoutes } from '../../src/routes/catalogue-match.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
const skillsRoot = path.join(repoRoot, 'skills');
const designTemplatesRoot = path.join(repoRoot, 'design-templates');

let server: http.Server | null = null;
let baseUrl = '';

beforeAll(async () => {
  const app = express();
  registerCatalogueMatchRoutes(app, {
    // Real registry scan spanning both roots, exactly like
    // roots.ALL_SKILL_LIKE_ROOTS in server.ts (skills/ shadows nothing here
    // since there's no user root ahead of it in this test).
    listAllSkillLikeEntries: () => listSkills([skillsRoot, designTemplatesRoot]),
    designTemplateRoots: [designTemplatesRoot],
  });
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server?.address();
      if (!addr || typeof addr !== 'object') {
        reject(new Error('could not bind'));
        return;
      }
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
    server?.on('error', reject);
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
});

async function match(body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}/api/catalogue/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

describe('POST /api/catalogue/match', () => {
  it('surfaces slate-stone-architectural-h73 and/or valmax-photography-landing for a real architectural-photography brief', async () => {
    const { status, json } = await match({
      text:
        "I run an architectural photography studio and need a landing page — moody, cinematic, editorial " +
        "black-and-white portfolio showcasing real estate and residential architecture work, elegant serif " +
        "typography, minimal navigation.",
    });
    expect(status).toBe(200);
    const ids: string[] = json.matches.map((m: any) => m.id);
    const hitOne = ids.includes('slate-stone-architectural-h73') || ids.includes('valmax-photography-landing');
    expect(hitOne).toBe(true);
    // Every match must be traceable — the whole point of the ranking is
    // that a wrong suggestion is debuggable, not a black box.
    for (const m of json.matches) {
      expect(typeof m.score).toBe('number');
      expect(m.score).toBeGreaterThan(0);
      expect(Array.isArray(m.matchedTerms)).toBe(true);
      expect(m.matchedTerms.length).toBeGreaterThan(0);
      expect(['skill', 'design-template']).toContain(m.kind);
    }
    // Shortlist, not a dump of the 561+164-entry catalogue.
    expect(json.matches.length).toBeLessThanOrEqual(6);
  });

  it('returns an empty shortlist for a brief built only from generic/stopword vocabulary', async () => {
    const { status, json } = await match({ text: 'Build me a landing page template for my website' });
    expect(status).toBe(200);
    expect(json.matches).toEqual([]);
  });

  it('returns an empty shortlist for a brief with no catalogue overlap at all', async () => {
    const { status, json } = await match({ text: 'Xyzzy qwerty foobar plugh grault corge' });
    expect(status).toBe(200);
    expect(json.matches).toEqual([]);
  });

  it('rejects a request with no text', async () => {
    expect((await match({})).status).toBe(400);
    expect((await match({ text: '' })).status).toBe(400);
    expect((await match({ text: '   ' })).status).toBe(400);
  });

  it('clamps an oversized requested limit to the max, and honors a smaller one', async () => {
    const brief =
      'A cinematic photography studio landing page, architectural real estate advisory, ' +
      'saas hero section, employee onboarding training deck.';
    const wide = await match({ text: brief, limit: 100 });
    const narrow = await match({ text: brief, limit: 1 });
    expect(wide.json.matches.length).toBeLessThanOrEqual(6);
    expect(narrow.json.matches.length).toBeLessThanOrEqual(1);
  });
});
