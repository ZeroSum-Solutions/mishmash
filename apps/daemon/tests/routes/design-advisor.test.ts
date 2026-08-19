// POST /api/design-advisor/recommend — end-to-end proof against the REAL
// design-templates/index.json artifact on disk (F001 R1's build output),
// not a fixture, so this pins F001 success criterion 3 (>=6 ranked
// candidates for the literal demo query) via the actual HTTP closure `od
// design-advisor recommend` also calls. See
// apps/daemon/tests/rank-candidates.test.ts for the ranking algorithm's
// isolated property tests and success criterion 4's >=0.5-score check.

import type http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerDesignAdvisorRoutes } from '../../src/routes/design-advisor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
const designIndexPath = path.join(repoRoot, 'design-templates/index.json');

let server: http.Server | null = null;
let baseUrl = '';

beforeAll(async () => {
  const app = express();
  registerDesignAdvisorRoutes(app, { designIndexPath });
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

async function recommend(body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}/api/design-advisor/recommend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

describe('POST /api/design-advisor/recommend', () => {
  it('resolves the literal F001 demo query to the poetry archetype with >=6 ranked candidates, >=4 scoring >=0.5', async () => {
    const { status, json } = await recommend({
      prompt:
        'hey, can you please tell me the best templates to use for a small business poetry website? ' +
        'please let me know colors and fonts too.',
    });
    expect(status).toBe(200);
    expect(json.archetypeId).toBe('poetry');
    // F001 success criterion 3.
    expect(json.candidates.length).toBeGreaterThanOrEqual(6);
    // F001 success criterion 4.
    const passing = json.candidates.filter((c: any) => c.score >= 0.5);
    expect(passing.length).toBeGreaterThanOrEqual(4);
    // Every result is debuggable, not a black box (F001 R5: "a rationale
    // naming the specific matched fields").
    for (const c of json.candidates) {
      expect(typeof c.slug).toBe('string');
      expect(typeof c.score).toBe('number');
      expect(Array.isArray(c.rationale)).toBe(true);
    }
  });

  it('returns a null archetype and empty candidates for a brief with no archetype overlap', async () => {
    const { status, json } = await recommend({ prompt: 'xyzzy qwerty foobar plugh grault corge' });
    expect(status).toBe(200);
    expect(json.archetypeId).toBeNull();
    expect(json.candidates).toEqual([]);
  });

  it('rejects a request with no prompt', async () => {
    expect((await recommend({})).status).toBe(400);
    expect((await recommend({ prompt: '' })).status).toBe(400);
    expect((await recommend({ prompt: '   ' })).status).toBe(400);
  });

  it('caps the result list at DESIGN_ADVISOR_MAX_LIMIT regardless of an oversized requested limit', async () => {
    const { json } = await recommend({
      prompt: 'a small business poetry website with poems and verse',
      limit: 999,
    });
    expect(json.candidates.length).toBeLessThanOrEqual(12);
  });
});
