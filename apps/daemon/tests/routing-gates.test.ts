// L3 deterministic gate runner + cascade classification coverage (WR wave,
// t8 -- plan docs/plans/2026-08-05-model-routing-system.md §3.2 L3).
//
// Sections: registry class enforcement (type + runtime guard), individual
// gate fixtures (link/form/tokens-schema pass+fail+not-applicable, plus the
// not-applicable-vs-unavailable distinction across several gates),
// classifyCascadeTrigger (escalation ladder, frontier ceiling, gate-tax
// cap), the SSIM baseline lifecycle (bootstrap -> negative-control ->
// active, including the required "perturbed variant must fail" proof),
// telemetry round-trip of gate outcomes, HTTP route validation (traversal
// rejection, 400 shapes), and CLI dispatch.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import url from 'node:url';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getRequiredA1Names, getRequiredA2Names, type StoredRoutingTelemetryRow } from '@open-design/contracts';

import { closeDatabase, openDatabase } from '../src/db.js';
import { registerRoutingRoutes } from '../src/routes/routing.js';
import { ensureRoutingTelemetryTable, getRoutingTelemetryByRunId, recordRoutingTelemetry } from '../src/routing/telemetry.js';
import {
  baselineState,
  classifyCascadeTrigger,
  DETERMINISTIC_GATE_DEFINITIONS,
  DETERMINISTIC_GATE_IDS,
  DEFAULT_SSIM_FLOOR,
  GATE_REGISTRY,
  GateClassificationError,
  GateSelectionError,
  invalidateSsimBaseline,
  recordBootstrapBaseline,
  recordGateOutcomes,
  runGates,
  runNegativeControlCheck,
  STOCHASTIC_GATE_IDS,
  type DeterministicGateId,
  type DeterministicGateResult,
  type RunGatesOptions,
  type StochasticGateResult,
} from '../src/routing/gates.js';

/** Every fixture in this file runs exactly one gate at a time -- this
 * unwraps `runGates`' array result (and asserts the array actually has an
 * element, satisfying `noUncheckedIndexedAccess` honestly rather than with
 * a blind non-null assertion at every call site). */
async function runOneGate(
  artifactDir: string,
  gateSelection: readonly DeterministicGateId[] | 'all',
  opts?: RunGatesOptions,
): Promise<DeterministicGateResult> {
  const results = await runGates(artifactDir, gateSelection, opts);
  const [result] = results;
  if (!result) throw new Error(`runGates returned no result for selection ${JSON.stringify(gateSelection)}`);
  return result;
}

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-gates-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Registry + class enforcement
// ---------------------------------------------------------------------------

describe('L3 gate registry -- class enforcement', () => {
  it('every deterministic gate id has a runnable definition, every stochastic id has none', () => {
    for (const id of DETERMINISTIC_GATE_IDS) {
      expect(DETERMINISTIC_GATE_DEFINITIONS[id].class).toBe('deterministic');
      expect(typeof DETERMINISTIC_GATE_DEFINITIONS[id].run).toBe('function');
    }
    expect(STOCHASTIC_GATE_IDS.length).toBeGreaterThan(0);
    const stochasticInRegistry = GATE_REGISTRY.filter((g) => g.class === 'stochastic');
    for (const gate of stochasticInRegistry) {
      expect('run' in gate).toBe(false);
    }
  });

  it('runGates rejects a stochastic gate id -- it has no run() to execute', async () => {
    await expect(runGates(tempDir, [STOCHASTIC_GATE_IDS[0] as unknown as DeterministicGateId])).rejects.toThrow(GateSelectionError);
  });

  it('runGates rejects an artifactDir that does not exist', async () => {
    await expect(runGates(path.join(tempDir, 'nope'), ['link-smoke'])).rejects.toThrow();
  });

  it('classifyCascadeTrigger throws (type + runtime guard) when a stochastic-classed result is passed in, even via a cast', () => {
    const smuggledStochastic: StochasticGateResult = {
      id: 'vision-conformance',
      class: 'stochastic',
      status: 'fail',
      evidence: ['advisory finding'],
      durationMs: 5,
    };
    // The parameter type declares DeterministicGateResult[]; a caller can
    // still defeat that with a cast (exactly what a bug/regression would
    // look like) -- classifyCascadeTrigger must catch this AT RUNTIME, not
    // merely rely on TypeScript to prevent it.
    expect(() =>
      classifyCascadeTrigger({ gateResults: [smuggledStochastic as unknown as DeterministicGateResult] }),
    ).toThrow(GateClassificationError);
  });
});

// ---------------------------------------------------------------------------
// link-smoke
// ---------------------------------------------------------------------------

describe('link-smoke gate', () => {
  it('passes when every local href resolves', async () => {
    writeFileSync(path.join(tempDir, 'other.html'), '<html></html>');
    writeFileSync(path.join(tempDir, 'index.html'), '<a href="other.html">link</a><a href="https://example.com">external</a><a href="#frag">frag</a>');
    const result = await runOneGate(tempDir, ['link-smoke']);
    expect(result.status).toBe('pass');
  });

  it('fails when a local href target is missing', async () => {
    writeFileSync(path.join(tempDir, 'index.html'), '<a href="missing.html">broken</a>');
    const result = await runOneGate(tempDir, ['link-smoke']);
    expect(result.status).toBe('fail');
    expect(result.evidence.join(' ')).toContain('missing.html');
  });

  it('is skipped-not-applicable when there are no HTML files', async () => {
    writeFileSync(path.join(tempDir, 'style.css'), 'body {}');
    const result = await runOneGate(tempDir, ['link-smoke']);
    expect(result.status).toBe('skipped-not-applicable');
  });

  it('rejects an href that escapes the artifact directory', async () => {
    writeFileSync(path.join(tempDir, 'index.html'), '<a href="../../etc/passwd">escape</a>');
    const result = await runOneGate(tempDir, ['link-smoke']);
    expect(result.status).toBe('fail');
    expect(result.evidence.join(' ')).toContain('escapes the artifact directory');
  });
});

// ---------------------------------------------------------------------------
// form-smoke
// ---------------------------------------------------------------------------

describe('form-smoke gate', () => {
  it('passes a form with action + method', async () => {
    writeFileSync(path.join(tempDir, 'index.html'), '<form action="/submit" method="post"></form>');
    const result = await runOneGate(tempDir, ['form-smoke']);
    expect(result.status).toBe('pass');
  });

  it('passes a form with a JS submit handler and no action/method', async () => {
    writeFileSync(path.join(tempDir, 'index.html'), '<form id="f"></form><script src="app.js"></script>');
    writeFileSync(path.join(tempDir, 'app.js'), "document.getElementById('f').addEventListener('submit', () => {});");
    const result = await runOneGate(tempDir, ['form-smoke']);
    expect(result.status).toBe('pass');
  });

  it('fails a form with neither action+method nor a submit handler', async () => {
    writeFileSync(path.join(tempDir, 'index.html'), '<form id="f"></form>');
    const result = await runOneGate(tempDir, ['form-smoke']);
    expect(result.status).toBe('fail');
  });

  it('is skipped-not-applicable when there are no <form> elements', async () => {
    writeFileSync(path.join(tempDir, 'index.html'), '<p>no forms here</p>');
    const result = await runOneGate(tempDir, ['form-smoke']);
    expect(result.status).toBe('skipped-not-applicable');
  });
});

// ---------------------------------------------------------------------------
// tokens-schema
// ---------------------------------------------------------------------------

describe('tokens-schema gate', () => {
  function validTokensJson(): { tokens: Array<{ name: string; value: string }> } {
    const names = new Set([...getRequiredA1Names(), ...getRequiredA2Names()]);
    return { tokens: [...names].map((name) => ({ name, value: '#000' })) };
  }

  it('passes when every required A1/A2 token name is present', async () => {
    writeFileSync(path.join(tempDir, 'design-tokens.json'), JSON.stringify(validTokensJson()));
    const result = await runOneGate(tempDir, ['tokens-schema']);
    expect(result.status).toBe('pass');
  });

  it('fails when a required token name is missing', async () => {
    writeFileSync(path.join(tempDir, 'design-tokens.json'), JSON.stringify({ tokens: [] }));
    const result = await runOneGate(tempDir, ['tokens-schema']);
    expect(result.status).toBe('fail');
  });

  it('fails on unparseable JSON', async () => {
    writeFileSync(path.join(tempDir, 'design-tokens.json'), '{not json');
    const result = await runOneGate(tempDir, ['tokens-schema']);
    expect(result.status).toBe('fail');
  });

  it('is skipped-not-applicable when no design-tokens.json is present', async () => {
    const result = await runOneGate(tempDir, ['tokens-schema']);
    expect(result.status).toBe('skipped-not-applicable');
  });
});

// ---------------------------------------------------------------------------
// not-applicable vs unavailable distinction (this task's brief: a typed
// status distinct from 'unavailable')
// ---------------------------------------------------------------------------

describe('skipped-not-applicable vs unavailable distinction', () => {
  it('ts-compile: skipped-not-applicable with no TS files, unavailable with TS files but no tsconfig', async () => {
    const noFiles = await runOneGate(tempDir, ['ts-compile']);
    expect(noFiles.status).toBe('skipped-not-applicable');

    writeFileSync(path.join(tempDir, 'a.ts'), 'const x: number = 1;');
    const noTsconfig = await runOneGate(tempDir, ['ts-compile']);
    expect(noTsconfig.status).toBe('unavailable');
  });

  it('ts-compile: real tsc pass/fail once a tsconfig is present', async () => {
    writeFileSync(path.join(tempDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noEmit: true, strict: true, skipLibCheck: true } }));
    writeFileSync(path.join(tempDir, 'ok.ts'), 'const x: number = 1;\nexport { x };\n');
    const passResult = await runOneGate(tempDir, ['ts-compile'], { timeoutMs: 20_000 });
    expect(passResult.status).toBe('pass');

    writeFileSync(path.join(tempDir, 'ok.ts'), 'const x: number = "not a number";\nexport { x };\n');
    const failResult = await runOneGate(tempDir, ['ts-compile'], { timeoutMs: 20_000 });
    expect(failResult.status).toBe('fail');
  }, 25_000);

  it('eslint: skipped-not-applicable with no JS/TS files, unavailable with JS files present (ESLint is not installed in this repo)', async () => {
    const noFiles = await runOneGate(tempDir, ['eslint']);
    expect(noFiles.status).toBe('skipped-not-applicable');

    writeFileSync(path.join(tempDir, 'a.js'), 'console.log(1);');
    const withFiles = await runOneGate(tempDir, ['eslint']);
    expect(withFiles.status).toBe('unavailable');
  });

  it('design-md-lint: skipped-not-applicable with no DESIGN.md, unavailable with one present (@google/design.md is not installed)', async () => {
    const noDesignMd = await runOneGate(tempDir, ['design-md-lint']);
    expect(noDesignMd.status).toBe('skipped-not-applicable');

    writeFileSync(path.join(tempDir, 'DESIGN.md'), '# Design contract');
    const withDesignMd = await runOneGate(tempDir, ['design-md-lint']);
    expect(withDesignMd.status).toBe('unavailable');
  });

  it('supabase-migration-dry-run: skipped-not-applicable with no migrations, unavailable when migrations exist', async () => {
    const noMigrations = await runOneGate(tempDir, ['supabase-migration-dry-run']);
    expect(noMigrations.status).toBe('skipped-not-applicable');

    mkdirSync(path.join(tempDir, 'supabase', 'migrations'), { recursive: true });
    writeFileSync(path.join(tempDir, 'supabase', 'migrations', '001_init.sql'), 'select 1;');
    const withMigrations = await runOneGate(tempDir, ['supabase-migration-dry-run']);
    expect(withMigrations.status).toBe('unavailable');
  });

  it('lighthouse-ci is unavailable unconditionally (not a dependency, no config, in this repo)', async () => {
    const result = await runOneGate(tempDir, ['lighthouse-ci']);
    expect(result.status).toBe('unavailable');
  });

  it('screenshot-ssim is unavailable with no buildId/db/screenshot supplied is skipped-not-applicable when buildId is null', async () => {
    const noBuildId = await runOneGate(tempDir, ['screenshot-ssim']);
    expect(noBuildId.status).toBe('skipped-not-applicable');
  });

  it('axe: unavailable when the artifact has no HTML entry file', async () => {
    writeFileSync(path.join(tempDir, 'notes.txt'), 'no html here');
    const result = await runOneGate(tempDir, ['axe']);
    expect(result.status).toBe('unavailable');
  });

  it('axe: scans a real HTML document and reports pass or a genuine violation (never a silent unavailable-as-pass)', async () => {
    writeFileSync(
      path.join(tempDir, 'index.html'),
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body><img src="x.png"></body></html>',
    );
    const result = await runOneGate(tempDir, ['axe'], { timeoutMs: 20_000 });
    // Environment-tolerant: a sandboxed CI runner without a launchable
    // Chromium must degrade to 'unavailable', never fabricate a pass --
    // but where a real browser IS available (as it is on this development
    // machine), the missing alt text on <img> is a genuine axe violation.
    expect(['fail', 'unavailable']).toContain(result.status);
    if (result.status === 'fail') {
      expect(result.evidence.join(' ')).toMatch(/image-alt|alt/i);
    }
  }, 25_000);
});

// ---------------------------------------------------------------------------
// classifyCascadeTrigger
// ---------------------------------------------------------------------------

function det(id: DeterministicGateId, status: DeterministicGateResult['status']): DeterministicGateResult {
  return { id, class: 'deterministic', status, evidence: [], durationMs: 1 };
}

describe('classifyCascadeTrigger (L3 cascade classification)', () => {
  it('does not escalate when every deterministic gate passes', () => {
    const result = classifyCascadeTrigger({ gateResults: [det('link-smoke', 'pass'), det('form-smoke', 'pass')] });
    expect(result.escalate).toBe(false);
    expect(result.triggeringGates).toEqual([]);
  });

  it('escalates cheap -> mid on a single deterministic failure', () => {
    const result = classifyCascadeTrigger({ gateResults: [det('link-smoke', 'fail')], currentTier: 'cheap' });
    expect(result.escalate).toBe(true);
    expect(result.tier).toBe('mid');
    expect(result.triggeringGates).toEqual(['link-smoke']);
  });

  it('escalates mid -> frontier on a failure', () => {
    const result = classifyCascadeTrigger({ gateResults: [det('axe', 'fail')], currentTier: 'mid' });
    expect(result.escalate).toBe(true);
    expect(result.tier).toBe('frontier');
  });

  it('does not escalate further once already at frontier (frontier cap)', () => {
    const result = classifyCascadeTrigger({ gateResults: [det('axe', 'fail')], currentTier: 'frontier' });
    expect(result.escalate).toBe(false);
    expect(result.tier).toBe('frontier');
    expect(result.triggeringGates).toEqual(['axe']);
  });

  it('never escalates on unavailable or skipped-not-applicable results', () => {
    const result = classifyCascadeTrigger({
      gateResults: [det('lighthouse-ci', 'unavailable'), det('ts-compile', 'skipped-not-applicable')],
      currentTier: 'cheap',
    });
    expect(result.escalate).toBe(false);
    expect(result.triggeringGates).toEqual([]);
  });

  it('gate-tax cap boundary: spend exactly at the cap is NOT over cap', () => {
    const result = classifyCascadeTrigger({
      gateResults: [det('link-smoke', 'fail')],
      currentTier: 'cheap',
      gateTaxCapUsd: 5,
      gateSpendSoFarUsd: 5,
    });
    expect(result.gateTax.overCap).toBe(false);
    expect(result.escalate).toBe(true);
  });

  it('gate-tax cap boundary: spend strictly over the cap blocks further escalation, surfaced explicitly', () => {
    const result = classifyCascadeTrigger({
      gateResults: [det('link-smoke', 'fail')],
      currentTier: 'cheap',
      gateTaxCapUsd: 5,
      gateSpendSoFarUsd: 5.01,
    });
    expect(result.gateTax.overCap).toBe(true);
    expect(result.escalate).toBe(false);
    expect(result.triggeringGates).toEqual(['link-smoke']);
    expect(result.reason).toMatch(/gate-tax/i);
  });

  it('gateTaxCapUsd omitted means gate-tax is not evaluated (capUsd: null, never overCap)', () => {
    const result = classifyCascadeTrigger({ gateResults: [det('link-smoke', 'fail')] });
    expect(result.gateTax).toEqual({ capUsd: null, spentUsd: 0, overCap: false });
  });
});

// ---------------------------------------------------------------------------
// SSIM baseline lifecycle
// ---------------------------------------------------------------------------

async function writeSolidPng(filePath: string, rgb: { r: number; g: number; b: number }): Promise<void> {
  await sharp({ create: { width: 8, height: 8, channels: 3, background: rgb } })
    .png()
    .toFile(filePath);
}

describe('SSIM baseline lifecycle (WR-routing.md Screenshot-baseline rules)', () => {
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    db = openDatabase(tempDir, { dataDir: tempDir });
  });

  afterEach(() => {
    closeDatabase();
  });

  it('starts at no-baseline-bootstrap for an unknown build', () => {
    expect(baselineState(db, 'build-1')).toBe('no-baseline-bootstrap');
  });

  it('bootstrap -> negative-control-pending, and refuses a second bootstrap without invalidation', async () => {
    const baselinePng = path.join(tempDir, 'baseline.png');
    await writeSolidPng(baselinePng, { r: 10, g: 10, b: 10 });
    recordBootstrapBaseline(db, { buildId: 'build-1', screenshotPath: baselinePng, tokenFreezeVersion: 'v1' });
    expect(baselineState(db, 'build-1')).toBe('negative-control-pending');
    expect(() =>
      recordBootstrapBaseline(db, { buildId: 'build-1', screenshotPath: baselinePng, tokenFreezeVersion: 'v1' }),
    ).toThrow();
  });

  it('negative control MUST fail (discriminate) a deliberately-perturbed comparison before promoting to active', async () => {
    const baselinePng = path.join(tempDir, 'baseline.png');
    const perturbedPng = path.join(tempDir, 'perturbed.png');
    await writeSolidPng(baselinePng, { r: 10, g: 10, b: 10 });
    // Deliberately perturbed: the opposite corner of the color cube --
    // maximally different from the baseline, so the comparison MUST score
    // below the floor to prove it discriminates at all.
    await writeSolidPng(perturbedPng, { r: 245, g: 245, b: 245 });
    recordBootstrapBaseline(db, { buildId: 'build-1', screenshotPath: baselinePng, tokenFreezeVersion: 'v1' });

    const negativeResult = await runNegativeControlCheck(db, { buildId: 'build-1', perturbedScreenshotPath: perturbedPng });
    expect(negativeResult.discriminates).toBe(true);
    expect(negativeResult.similarity).toBeLessThan(negativeResult.floor);
    expect(baselineState(db, 'build-1')).toBe('active');
  });

  it('a non-discriminating negative control (perturbed variant too similar) does NOT promote to active', async () => {
    const baselinePng = path.join(tempDir, 'baseline.png');
    const almostIdenticalPng = path.join(tempDir, 'almost-identical.png');
    await writeSolidPng(baselinePng, { r: 10, g: 10, b: 10 });
    await writeSolidPng(almostIdenticalPng, { r: 10, g: 10, b: 10 });
    recordBootstrapBaseline(db, { buildId: 'build-1', screenshotPath: baselinePng, tokenFreezeVersion: 'v1' });

    const negativeResult = await runNegativeControlCheck(db, { buildId: 'build-1', perturbedScreenshotPath: almostIdenticalPng });
    expect(negativeResult.discriminates).toBe(false);
    expect(baselineState(db, 'build-1')).toBe('negative-control-pending');
  });

  it('runNegativeControlCheck throws when the build is not awaiting calibration', async () => {
    const somePng = path.join(tempDir, 'x.png');
    await writeSolidPng(somePng, { r: 1, g: 1, b: 1 });
    await expect(runNegativeControlCheck(db, { buildId: 'never-bootstrapped', perturbedScreenshotPath: somePng })).rejects.toThrow();
  });

  it('a token-freeze revision invalidates an active baseline and re-enters bootstrap', async () => {
    const baselinePng = path.join(tempDir, 'baseline.png');
    const perturbedPng = path.join(tempDir, 'perturbed.png');
    await writeSolidPng(baselinePng, { r: 10, g: 10, b: 10 });
    await writeSolidPng(perturbedPng, { r: 245, g: 245, b: 245 });
    recordBootstrapBaseline(db, { buildId: 'build-1', screenshotPath: baselinePng, tokenFreezeVersion: 'v1' });
    await runNegativeControlCheck(db, { buildId: 'build-1', perturbedScreenshotPath: perturbedPng });
    expect(baselineState(db, 'build-1', 'v1')).toBe('active');

    expect(baselineState(db, 'build-1', 'v2')).toBe('no-baseline-bootstrap');
    // The invalidation is persisted, not just reported for this one read.
    expect(baselineState(db, 'build-1')).toBe('no-baseline-bootstrap');
  });

  it('invalidateSsimBaseline forces a return to no-baseline-bootstrap', async () => {
    const baselinePng = path.join(tempDir, 'baseline.png');
    await writeSolidPng(baselinePng, { r: 10, g: 10, b: 10 });
    recordBootstrapBaseline(db, { buildId: 'build-1', screenshotPath: baselinePng, tokenFreezeVersion: 'v1' });
    invalidateSsimBaseline(db, 'build-1');
    expect(baselineState(db, 'build-1')).toBe('no-baseline-bootstrap');
  });

  it('the screenshot-ssim gate is unavailable through bootstrap and negative-control-pending, then real pass/fail once active', async () => {
    const baselinePng = path.join(tempDir, 'baseline.png');
    const perturbedPng = path.join(tempDir, 'perturbed.png');
    await writeSolidPng(baselinePng, { r: 10, g: 10, b: 10 });
    await writeSolidPng(perturbedPng, { r: 245, g: 245, b: 245 });

    const bootstrapResult = await runOneGate(tempDir, ['screenshot-ssim'], {
      buildId: 'build-1',
      db,
      ssim: { screenshotPath: baselinePng, tokenFreezeVersion: 'v1' },
    });
    expect(bootstrapResult.status).toBe('unavailable');

    recordBootstrapBaseline(db, { buildId: 'build-1', screenshotPath: baselinePng, tokenFreezeVersion: 'v1' });
    const pendingResult = await runOneGate(tempDir, ['screenshot-ssim'], {
      buildId: 'build-1',
      db,
      ssim: { screenshotPath: baselinePng, tokenFreezeVersion: 'v1' },
    });
    expect(pendingResult.status).toBe('unavailable');

    await runNegativeControlCheck(db, { buildId: 'build-1', perturbedScreenshotPath: perturbedPng });

    const matchingResult = await runOneGate(tempDir, ['screenshot-ssim'], {
      buildId: 'build-1',
      db,
      ssim: { screenshotPath: baselinePng, tokenFreezeVersion: 'v1' },
    });
    expect(matchingResult.status).toBe('pass');

    const divergentResult = await runOneGate(tempDir, ['screenshot-ssim'], {
      buildId: 'build-1',
      db,
      ssim: { screenshotPath: perturbedPng, tokenFreezeVersion: 'v1', floorOverride: DEFAULT_SSIM_FLOOR },
    });
    expect(divergentResult.status).toBe('fail');
  });
});

// ---------------------------------------------------------------------------
// Telemetry round-trip
// ---------------------------------------------------------------------------

function completeRow(overrides: Partial<StoredRoutingTelemetryRow> = {}): StoredRoutingTelemetryRow {
  return {
    runId: 'run-gates-1',
    projectId: 'proj-1',
    attempt: 0,
    buildId: null,
    stage: 'section-fanout',
    templateId: null,
    designSystem: null,
    routedModel: 'claude-sonnet-5',
    observedModel: null,
    routedLane: 'claude-code-oauth',
    observedLane: null,
    tokens: { input: 100, output: 50, cacheReadInput: 0 },
    cacheHits: 0,
    latencyMs: 100,
    costUsd: 0,
    costEstimated: true,
    gateOutcomes: {},
    escalated: false,
    policyVersion: 1,
    createdAt: '2026-08-05T00:00:00.000Z',
    recordedAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('recordGateOutcomes telemetry round-trip', () => {
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    db = openDatabase(tempDir, { dataDir: tempDir });
  });

  afterEach(() => {
    closeDatabase();
  });

  it('persists a mix of deterministic and stochastic gate results onto the telemetry row', () => {
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(db, completeRow());
    recordGateOutcomes(db, 'run-gates-1', 0, [
      det('link-smoke', 'pass'),
      det('form-smoke', 'fail'),
      { id: 'vision-conformance', class: 'stochastic', status: 'unavailable', evidence: [], durationMs: 1 },
    ]);
    const stored = getRoutingTelemetryByRunId(db, 'run-gates-1', 0);
    expect(stored?.gateOutcomes).toEqual({
      'link-smoke': 'pass',
      'form-smoke': 'fail',
      'vision-conformance': 'unavailable',
    });
  });

  it('throws when recording outcomes for a run/attempt that was never recorded', () => {
    expect(() => recordGateOutcomes(db, 'never-recorded', 0, [det('link-smoke', 'pass')])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// HTTP route validation
// ---------------------------------------------------------------------------

describe('GET /api/routing/gates and POST /api/routing/gates/run', () => {
  it('GET /api/routing/gates returns every registry entry with a correct runnable flag', async () => {
    const app = express();
    registerRoutingRoutes(app);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const resp = await fetch(`${baseUrl}/api/routing/gates`);
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as { gates: Array<{ id: string; class: string; runnable: boolean }> };
      expect(body.gates.length).toBe(DETERMINISTIC_GATE_IDS.length + STOCHASTIC_GATE_IDS.length);
      for (const gate of body.gates) {
        expect(gate.runnable).toBe(gate.class === 'deterministic');
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('POST /api/routing/gates/run is a 400 when no project root is configured', async () => {
    const app = express();
    registerRoutingRoutes(app); // no projectsRoot
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const resp = await fetch(`${baseUrl}/api/routing/gates/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifactDir: 'anything' }),
      });
      expect(resp.status).toBe(400);
      const body = (await resp.json()) as { error: { code: string } };
      expect(body.error.code).toBe('gates-run-unavailable');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  describe('with a configured project root', () => {
    let server: http.Server;
    let baseUrl: string;
    let projectsRoot: string;
    let artifactSubdir: string;

    beforeAll(async () => {
      projectsRoot = mkdtempSync(path.join(os.tmpdir(), 'od-routing-gates-root-'));
      artifactSubdir = path.join(projectsRoot, 'proj-1', 'build-out');
      mkdirSync(artifactSubdir, { recursive: true });
      writeFileSync(path.join(artifactSubdir, 'index.html'), '<a href="index.html">self</a>');
      const app = express();
      registerRoutingRoutes(app, undefined, projectsRoot);
      server = app.listen(0);
      await new Promise<void>((resolve) => server.once('listening', () => resolve()));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(projectsRoot, { recursive: true, force: true });
    });

    it('runs the selected gates and returns a cascade classification', async () => {
      const resp = await fetch(`${baseUrl}/api/routing/gates/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifactDir: 'proj-1/build-out', gates: ['link-smoke', 'form-smoke'] }),
      });
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as { results: Array<{ id: string; status: string }>; cascade: { escalate: boolean } };
      expect(body.results.map((r) => r.id).sort()).toEqual(['form-smoke', 'link-smoke']);
      expect(body.results.find((r) => r.id === 'link-smoke')?.status).toBe('pass');
      expect(typeof body.cascade.escalate).toBe('boolean');
    });

    it('rejects a traversal attempt outside the project root', async () => {
      const resp = await fetch(`${baseUrl}/api/routing/gates/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifactDir: '../../../../etc' }),
      });
      expect(resp.status).toBe(400);
      const body = (await resp.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('invalid-query-param');
      expect(body.error.message).toMatch(/traversal|project root/i);
    });

    it('rejects an absolute path outside the project root', async () => {
      const resp = await fetch(`${baseUrl}/api/routing/gates/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifactDir: '/etc' }),
      });
      expect(resp.status).toBe(400);
    });

    it('rejects an unknown gate id in `gates`', async () => {
      const resp = await fetch(`${baseUrl}/api/routing/gates/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifactDir: 'proj-1/build-out', gates: ['not-a-real-gate'] }),
      });
      expect(resp.status).toBe(400);
    });

    it('rejects an invalid currentTier', async () => {
      const resp = await fetch(`${baseUrl}/api/routing/gates/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifactDir: 'proj-1/build-out', currentTier: 'ludicrous' }),
      });
      expect(resp.status).toBe(400);
    });

    it('rejects a missing artifactDir', async () => {
      const resp = await fetch(`${baseUrl}/api/routing/gates/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(resp.status).toBe(400);
    });
  });
});

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CLI_SRC = path.join(__dirname, '../src/cli.ts');
const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, CLI_SRC, ...args], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, TMPDIR: '/tmp', TMP: '/tmp', TEMP: '/tmp' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI timed out: od ${args.join(' ')}`));
    }, 20_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, code });
    });
  });
}

describe('od route gates dispatch', () => {
  let server: http.Server;
  let baseUrl: string;
  let projectsRoot: string;

  beforeAll(async () => {
    projectsRoot = mkdtempSync(path.join(os.tmpdir(), 'od-routing-gates-cli-'));
    mkdirSync(path.join(projectsRoot, 'build-out'), { recursive: true });
    writeFileSync(path.join(projectsRoot, 'build-out', 'index.html'), '<p>hello</p>');
    const app = express();
    registerRoutingRoutes(app, undefined, projectsRoot);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(projectsRoot, { recursive: true, force: true });
  });

  it('od route gates list --json prints the registry', async () => {
    const { stdout, stderr, code } = await runCli(['route', 'gates', 'list', '--json', '--daemon-url', baseUrl]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { gates: unknown[] };
    expect(Array.isArray(parsed.gates)).toBe(true);
    expect(parsed.gates.length).toBeGreaterThan(0);
  });

  it('od route gates run --artifact-dir <path> --json executes gates and prints the cascade classification', async () => {
    const { stdout, stderr, code } = await runCli([
      'route', 'gates', 'run', '--json', '--daemon-url', baseUrl,
      '--artifact-dir', 'build-out', '--gates', 'link-smoke,form-smoke',
    ]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { results: unknown[]; cascade: { escalate: boolean } };
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(typeof parsed.cascade.escalate).toBe('boolean');
  });

  it('od route gates run without --artifact-dir exits nonzero', async () => {
    const { code } = await runCli(['route', 'gates', 'run', '--json', '--daemon-url', baseUrl]);
    expect(code).toBe(2);
  });

  it('od route gates <unknown> exits nonzero', async () => {
    const { code, stderr } = await runCli(['route', 'gates', 'bogus', '--daemon-url', baseUrl]);
    expect(code).toBe(2);
    expect(stderr).toContain('unknown subcommand');
  });
});
