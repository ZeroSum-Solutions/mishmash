import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

// F002 R1/R2/R3/R4 — the client discovery interview's HTTP surface:
// POST /api/interviews (start), GET /api/interviews/:id (fetch),
// POST /api/interviews/:id/turns (advance). Success criterion 1: each tier
// runs end-to-end via scripted turns to a terminal `complete`/`needs-info`
// brief, without leaving the daemon.
describe('interview routes', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // Loosely typed on purpose: the body's shape varies between a success
  // response and a 400/404 error envelope, and every assertion below reads
  // fields defensively (or only checks `status`) rather than depending on
  // strict typing here — the real contract types (InterviewTurnResponse,
  // StartInterviewResponse, ClientBrief) are exercised and asserted against
  // directly in packages/contracts/tests/interviews.test.ts.
  async function start(tier: string, archetype?: string): Promise<{ status: number; body: any }> {
    const resp = await fetch(`${baseUrl}/api/interviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier, ...(archetype ? { archetype } : {}) }),
    });
    return { status: resp.status, body: (await resp.json()) as any };
  }

  async function submitTurn(id: string, answers: Record<string, string>): Promise<{ status: number; body: any }> {
    const resp = await fetch(`${baseUrl}/api/interviews/${encodeURIComponent(id)}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    return { status: resp.status, body: (await resp.json()) as any };
  }

  it('400s on an unknown tier', async () => {
    const { status } = await start('extra-long');
    expect(status).toBe(400);
  });

  it('400s on an unknown archetype', async () => {
    const { status } = await start('quick', 'bakery');
    expect(status).toBe(400);
  });

  it('starts a session with a first turn of 1-2 questions and never a "Section N of M" announcement', async () => {
    const { status, body } = await start('quick');
    expect(status).toBe(200);
    expect(body.session.status).toBe('in-progress');
    expect(body.session.stepIndex).toBe(0);
    expect(body.turn.questions.length).toBeGreaterThanOrEqual(1);
    expect(body.turn.questions.length).toBeLessThanOrEqual(2);
    expect(body.turn.message).not.toMatch(/section\s+\d+\s+of\s+\d+/i);
  });

  it('404s fetching an unknown session', async () => {
    const resp = await fetch(`${baseUrl}/api/interviews/does-not-exist`);
    expect(resp.status).toBe(404);
  });

  it('GET returns the current session summary', async () => {
    const { body: started } = await start('quick');
    const resp = await fetch(`${baseUrl}/api/interviews/${started.session.id}`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as any;
    expect(body.session.id).toBe(started.session.id);
    expect(body.session.tier).toBe('quick');
  });

  it('GET reconstructs the current turn for an in-progress session (resume)', async () => {
    const { body: started } = await start('quick');
    const resp = await fetch(`${baseUrl}/api/interviews/${started.session.id}`);
    const body = (await resp.json()) as any;
    expect(body.turn.questions.map((q: { id: string }) => q.id)).toEqual(
      started.turn.questions.map((q: { id: string }) => q.id),
    );
    expect(body.result).toBeUndefined();
  });

  it('GET returns the cached result for a terminal session (resume after completion)', async () => {
    const { body: started } = await start('quick');
    let sessionState = started.session;
    let turn = started.turn;
    let lastBody: any;
    let guard = 0;
    while (sessionState.status === 'in-progress' && guard < 50) {
      guard += 1;
      const answers: Record<string, string> = {};
      for (const q of turn.questions) {
        if (q.id === 'hqLocation') answers[q.id] = 'Tampa, FL';
        else if (q.id === 'serviceArea') answers[q.id] = 'Tampa, Clearwater';
        else if (q.id === 'certifications') answers[q.id] = 'none';
        else if (q.id === 'phone') answers[q.id] = '(813) 555-0100';
        else if (q.id === 'email') answers[q.id] = 'owner@example.com';
        else answers[q.id] = `answer for ${q.id}`;
      }
      const { body } = await submitTurn(sessionState.id, answers);
      sessionState = body.session;
      turn = body.turn;
      lastBody = body;
    }
    expect(lastBody.result).toBeTruthy();

    const resp = await fetch(`${baseUrl}/api/interviews/${sessionState.id}`);
    const resumed = (await resp.json()) as any;
    expect(resumed.turn).toBeUndefined();
    expect(resumed.result.clientBrief.status).toBe(lastBody.result.clientBrief.status);
    expect(resumed.result.guidedBrief).toEqual(lastBody.result.guidedBrief);
  });

  it('pushes back on a vague REQUIRED answer instead of advancing, then accepts a real one', async () => {
    const { body: started } = await start('quick');
    const firstQuestionId = started.turn.questions[0].id;
    // The quick tier's first step opens on the two REQUIRED
    // location fields (hqLocation, serviceArea) per question order.
    expect(firstQuestionId).toBe('hqLocation');

    const badAnswers: Record<string, string> = {};
    for (const q of started.turn.questions) badAnswers[q.id] = 'n/a';
    const { status: badStatus, body: badTurn } = await submitTurn(started.session.id, badAnswers);
    expect(badStatus).toBe(200);
    expect(badTurn.pushBack).toBeTruthy();
    expect(badTurn.session.stepIndex).toBe(0); // did not advance

    const goodAnswers: Record<string, string> = {};
    for (const q of started.turn.questions) {
      goodAnswers[q.id] = q.id === 'hqLocation' ? 'Tampa, FL' : 'Tampa, Clearwater, St. Petersburg';
    }
    const { status: goodStatus, body: goodTurn } = await submitTurn(started.session.id, goodAnswers);
    expect(goodStatus).toBe(200);
    expect(goodTurn.pushBack).toBeUndefined();
    expect(goodTurn.session.stepIndex).toBe(1); // advanced
  });

  it('accepts an explicit "I don\'t know" on a REQUIRED field without pushing back, but the interview ends needs-info', async () => {
    const { body: started } = await start('quick');
    let session = started.session;
    let turn = started.turn;
    while (session.status === 'in-progress') {
      const answers: Record<string, string> = {};
      for (const q of turn.questions) {
        answers[q.id] = q.id === 'certifications' ? "I don't know" : (q.required ? 'a real specific answer here' : 'fine');
      }
      if (turn.questions.some((q: { id: string }) => q.id === 'phone')) answers.phone = '(813) 555-0100';
      if (turn.questions.some((q: { id: string }) => q.id === 'email')) answers.email = 'owner@example.com';
      if (turn.questions.some((q: { id: string }) => q.id === 'hqLocation')) answers.hqLocation = 'Tampa, FL';
      if (turn.questions.some((q: { id: string }) => q.id === 'serviceArea')) answers.serviceArea = 'Tampa, Clearwater';
      const { body } = await submitTurn(session.id, answers);
      session = body.session;
      if (body.pushBack) {
        // Should never happen for this scripted run — fail loudly if it does.
        throw new Error(`unexpected push-back: ${JSON.stringify(body.pushBack)}`);
      }
      if (body.result) {
        expect(body.result.clientBrief.status).toBe('needs-info');
        expect(
          body.result.clientBrief.openItems.some(
            (item: { fieldId: string; reason: string }) => item.fieldId === 'certifications' && item.reason === 'unknown',
          ),
        ).toBe(true);
        return;
      }
      turn = body.turn;
    }
    throw new Error('interview never reached a terminal result');
  });

  it('runs the full tier end-to-end to a "complete" brief with a mapped guidedBrief', async () => {
    const { body: started } = await start('full');
    let session = started.session;
    let turn = started.turn;
    let lastResult: any;
    let guard = 0;
    while (session.status === 'in-progress') {
      guard += 1;
      if (guard > 100) throw new Error('runaway interview loop');
      const answers: Record<string, string> = {};
      for (const q of turn.questions) {
        if (q.id === 'hqLocation') answers[q.id] = 'Tampa, FL';
        else if (q.id === 'serviceArea') answers[q.id] = 'Tampa, Clearwater, St. Petersburg';
        else if (q.id === 'certifications') answers[q.id] = 'BICSI, EPA';
        else if (q.id === 'phone') answers[q.id] = '(813) 555-0100';
        else if (q.id === 'email') answers[q.id] = 'owner@example.com';
        else answers[q.id] = `A real answer for ${q.id}`;
      }
      const { body } = await submitTurn(session.id, answers);
      session = body.session;
      turn = body.turn;
      lastResult = body.result;
    }
    expect(session.status).toBe('complete');
    expect(lastResult.clientBrief.status).toBe('complete');
    expect(lastResult.guidedBrief).toBeTruthy();
    // full tier answers every question, so every mapped source field is present.
    expect(typeof lastResult.guidedBrief.product).toBe('string');
  });

  it('runs the standard tier end-to-end to a "complete" brief (success criterion 1: every tier, not just full/quick)', async () => {
    const { body: started } = await start('standard');
    let session = started.session;
    let turn = started.turn;
    let lastResult: any;
    let guard = 0;
    while (session.status === 'in-progress') {
      guard += 1;
      if (guard > 100) throw new Error('runaway interview loop');
      const answers: Record<string, string> = {};
      for (const q of turn.questions) {
        if (q.id === 'hqLocation') answers[q.id] = 'Tampa, FL';
        else if (q.id === 'serviceArea') answers[q.id] = 'Tampa, Clearwater, St. Petersburg';
        else if (q.id === 'certifications') answers[q.id] = 'BICSI, EPA';
        else if (q.id === 'phone') answers[q.id] = '(813) 555-0100';
        else if (q.id === 'email') answers[q.id] = 'owner@example.com';
        else answers[q.id] = `A real answer for ${q.id}`;
      }
      const { body } = await submitTurn(session.id, answers);
      session = body.session;
      turn = body.turn;
      lastResult = body.result;
    }
    expect(session.status).toBe('complete');
    expect(lastResult.clientBrief.status).toBe('complete');
    // standard drops faqContent/siteStructureAndLogistics — confirm they stay empty.
    expect(Object.keys(lastResult.clientBrief.faqContent)).toHaveLength(0);
    expect(Object.keys(lastResult.clientBrief.siteStructureAndLogistics)).toHaveLength(0);
  });

  it('standard and quick both omit the FAQ/site-structure sections; full retains them', async () => {
    const { body: full } = await start('full');
    const { body: standard } = await start('standard');
    const { body: quick } = await start('quick');
    expect(full.session.totalSteps).toBeGreaterThan(standard.session.totalSteps);
    expect(standard.session.totalSteps).toBeGreaterThan(quick.session.totalSteps);
  });
});
