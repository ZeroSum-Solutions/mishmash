import type http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { startServer } from '../../src/server.js';

const dataDirEnv = process.env.OD_DATA_DIR;
if (!dataDirEnv) throw new Error('OD_DATA_DIR is required for daemon route tests');
const dataDir: string = dataDirEnv;

const commercialRequest = {
  recipe: 'hero-product-commercial',
  ratio: '9:16',
  commercialBrief: {
    productName: 'Luma Bottle',
    audience: 'Busy commuters',
    promise: 'Cold water all day',
    visualDirection: 'Clean daylight with tactile close-ups',
    callToAction: 'Take cold water anywhere',
  },
};

describe('hero product commercial routes', () => {
  let server: http.Server | null = null;
  let base = '';

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
  });

  async function boot() {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;
    base = started.url;
  }

  async function api(method: string, route: string, body?: unknown) {
    const response = await fetch(`${base}${route}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { response, body: text ? JSON.parse(text) : null };
  }

  async function createCommercial() {
    const created = await api('POST', '/api/storyboards', commercialRequest);
    expect(created.response.status).toBe(201);
    return created.body.storyboard as any;
  }

  async function installCompletedTake(storyboard: any) {
    const shot = storyboard.shots[0];
    const take = {
      id: 'task-take-1',
      taskId: 'task-take-1',
      status: 'done',
      startedAt: '2026-08-11T12:00:00.000Z',
      completedAt: '2026-08-11T12:00:03.000Z',
      renderDurationMs: 3000,
      providerId: 'higgsfield',
      modelId: shot.model,
      motionPrompt: shot.motionPrompt,
      effectivePrompt: shot.motionPrompt,
      inputs: { startFrame: 'upload.png', aspect: storyboard.ratio, durationSec: shot.durationSec },
      output: 'shot-one-take-one.mp4',
      cost: {
        status: 'subscription-credits',
        note: 'Uses Higgsfield subscription credits; dollar cost was not reported.',
      },
      usageRights: {
        status: 'unverified',
        note: 'Verify the selected model and provider terms before client delivery.',
      },
    };
    storyboard.shots[0] = { ...shot, status: 'done', output: take.output, takes: [take] };
    storyboard.updatedAt = '2026-08-11T12:00:04.000Z';
    const dir = path.join(dataDir, 'storyboards');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${storyboard.id}.json`), `${JSON.stringify(storyboard, null, 2)}\n`, 'utf8');
    return { shot: storyboard.shots[0], take };
  }

  it('creates a guided commercial with a stored brief and four seeded shots', async () => {
    await boot();
    const storyboard = await createCommercial();

    expect(storyboard.recipe).toBe('hero-product-commercial');
    expect(storyboard.commercialBrief.productName).toBe('Luma Bottle');
    expect(storyboard.ratio).toBe('9:16');
    expect(storyboard.shots).toHaveLength(4);
    expect(storyboard.shots.map((shot: any) => shot.title)).toEqual([
      'Product reveal',
      'Benefit in action',
      'Proof and detail',
      'Closing frame',
    ]);
  });

  it('rejects an incomplete commercial brief with field-specific copy', async () => {
    await boot();
    const created = await api('POST', '/api/storyboards', {
      ...commercialRequest,
      commercialBrief: { ...commercialRequest.commercialBrief, promise: '' },
    });

    expect(created.response.status).toBe(400);
    expect(JSON.stringify(created.body)).toMatch(/promise/i);
  });

  it('keeps receipts daemon-owned while preserving them through older-client PATCHes', async () => {
    await boot();
    const storyboard = await createCommercial();
    const { shot, take } = await installCompletedTake(storyboard);

    const tampered = await api('PATCH', `/api/storyboards/${storyboard.id}`, {
      shots: [{ ...shot, takes: [{ ...take, providerId: 'made-up-provider' }] }],
    });
    expect(tampered.response.status).toBe(400);
    expect(JSON.stringify(tampered.body)).toMatch(/take history.*daemon-owned/i);

    const legacyPatch = await api('PATCH', `/api/storyboards/${storyboard.id}`, {
      shots: [{ ...shot, title: 'Renamed by an older client', takes: undefined }],
    });
    expect(legacyPatch.response.status).toBe(200);
    expect(legacyPatch.body.storyboard.shots[0].takes).toEqual([take]);
  });

  it('records an explicit take decision and simple comparison scores', async () => {
    await boot();
    const storyboard = await createCommercial();
    const { shot, take } = await installCompletedTake(storyboard);

    const reviewed = await api(
      'PUT',
      `/api/storyboards/${storyboard.id}/shots/${shot.id}/takes/${take.id}/review`,
      {
        decision: 'approved',
        note: 'Best product silhouette and cleanest motion.',
        scores: { brandFit: 5, motionQuality: 4, artifactControl: 5, revisionEase: 4 },
      },
    );

    expect(reviewed.response.status).toBe(200);
    const reviewedShot = reviewed.body.storyboard.shots[0];
    expect(reviewedShot.selectedTakeId).toBe(take.id);
    expect(reviewedShot.output).toBe(take.output);
    expect(reviewedShot.takeReviews[take.id]).toMatchObject({
      decision: 'approved',
      note: 'Best product silhouette and cleanest motion.',
      scores: { brandFit: 5, motionQuality: 4, artifactControl: 5, revisionEase: 4 },
    });
  });

  it('blocks commercial assembly until every recipe shot has an approved take', async () => {
    await boot();
    const storyboard = await createCommercial();
    await installCompletedTake(storyboard);

    const assembled = await api('POST', `/api/storyboards/${storyboard.id}/assemble`);
    expect(assembled.response.status).toBe(400);
    expect(JSON.stringify(assembled.body)).toMatch(/choose a take.*each shot/i);
  });
});
