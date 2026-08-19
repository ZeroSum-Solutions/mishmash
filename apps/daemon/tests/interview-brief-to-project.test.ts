import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

// F002 R6, success criterion 5 — a completed interview brief starts a
// project with zero re-typing. This exercises the REAL end-to-end path: run
// a full interview to completion over /api/interviews, take the
// server-computed `guidedBrief` (the R6 mapping function's output) exactly
// as the web/CLI surfaces would, and POST it through the EXISTING
// POST /api/projects endpoint (packages/contracts's `CreateProjectRequest.
// brief: GuidedCreateBrief`) with `skipDiscoveryBrief: true` so the new
// project does not immediately re-ask its own discovery form. Asserts the
// created project's `pendingPrompt` contains every field the mapping
// function populated — proving the mapped brief actually reaches the
// project, not just that the pure function produces the right shape (that
// is covered separately in packages/contracts/tests/interviews.test.ts).
describe('a completed interview brief starts a project with zero re-typing (R6)', () => {
  let server: http.Server;
  let baseUrl: string;
  const projectsToClean: string[] = [];

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
      await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('maps SERVICES/TARGET CUSTOMER/VISUAL DIRECTION into pendingPrompt and skips re-asking discovery', async () => {
    const startResp = await fetch(`${baseUrl}/api/interviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'quick' }),
    });
    let started: any = await startResp.json();

    const answerSets: Array<Record<string, string>> = [];
    while (started.session ? started.session.status === 'in-progress' : true) {
      const turn = started.turn;
      if (!turn) break;
      const answers: Record<string, string> = {};
      for (const q of turn.questions) {
        if (q.id === 'hqLocation') answers[q.id] = 'Tampa, FL';
        else if (q.id === 'serviceArea') answers[q.id] = 'Tampa, Clearwater, St. Petersburg';
        else if (q.id === 'certifications') answers[q.id] = 'BICSI, EPA';
        else if (q.id === 'phone') answers[q.id] = '(813) 555-0100';
        else if (q.id === 'email') answers[q.id] = 'owner@example.com';
        else if (q.id === 'services') answers[q.id] = 'Structured cabling, fiber splicing';
        else if (q.id === 'idealCustomer') answers[q.id] = 'Commercial property managers';
        else if (q.id === 'backgroundPreference') answers[q.id] = 'light background';
        else if (q.id === 'threeWordsFeel') answers[q.id] = 'clean and professional';
        else if (q.id === 'primaryCta') answers[q.id] = 'Call for an estimate';
        else answers[q.id] = `answer for ${q.id}`;
      }
      answerSets.push(answers);
      const turnResp = await fetch(`${baseUrl}/api/interviews/${started.session.id}/turns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      started = { ...started, ...((await turnResp.json()) as any) };
      if (started.result) break;
    }

    expect(started.result).toBeTruthy();
    expect(started.result.clientBrief.status).toBe('complete');
    const guidedBrief = started.result.guidedBrief;
    expect(guidedBrief.product).toBeTruthy();
    expect(guidedBrief.audience).toBeTruthy();
    expect(guidedBrief.direction).toBeTruthy();

    const projectId = `interview-brief-${randomUUID()}`;
    projectsToClean.push(projectId);
    const createResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        name: 'Started from a client interview',
        brief: guidedBrief,
        skipDiscoveryBrief: true,
      }),
    });
    expect(createResp.status).toBe(200);
    const created = (await createResp.json()) as any;
    const prompt: string = created.project.pendingPrompt;
    expect(prompt).toContain('Design brief:');
    for (const field of ['product', 'audience', 'useCase', 'direction'] as const) {
      const value = guidedBrief[field];
      if (value) expect(prompt).toContain(value);
    }
    expect(created.project.metadata?.skipDiscoveryBrief).toBe(true);
    // Zero re-typing: none of the client's raw contact info leaked into the
    // generation prompt (R6 deliberately excludes CONTACT AND CALL TO ACTION).
    expect(prompt).not.toContain('813');
    expect(prompt).not.toContain('owner@example.com');
  });
});
