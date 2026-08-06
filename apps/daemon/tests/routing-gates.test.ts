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

import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import url from 'node:url';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBSlotNames, getRequiredA1Names, getRequiredA2Names, type StoredRoutingTelemetryRow } from '@open-design/contracts';

import { closeDatabase, openDatabase } from '../src/db.js';
import { loadRoutingPolicy } from '../src/routing/policy.js';
import { registerRoutingRoutes } from '../src/routes/routing.js';
import { computeLaneMeters, ensureRoutingTelemetryTable, getRoutingTelemetryByRunId, recordRoutingTelemetry } from '../src/routing/telemetry.js';
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

  it('skips (never fails, never counts as checked) an href whose target is a SYMLINK, per Sol HIGH-1 (lstat, never follow)', async () => {
    const outsideTarget = path.join(tempDir, '..', `od-link-smoke-symlink-target-${Date.now()}`);
    writeFileSync(outsideTarget, '<html>outside</html>');
    try {
      const symlinkPath = path.join(tempDir, 'linked.html');
      symlinkSync(outsideTarget, symlinkPath, 'file');
      writeFileSync(path.join(tempDir, 'index.html'), '<a href="linked.html">symlinked</a>');
      const result = await runOneGate(tempDir, ['link-smoke']);
      expect(result.status).toBe('pass');
      expect(result.evidence.join(' ')).toMatch(/symlinked target.*skipped/i);
    } finally {
      rmSync(outsideTarget, { force: true });
    }
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
  // t8 fix-round (Sol MED-6): a full, STRUCTURALLY valid od-design-tokens/v1
  // envelope -- name/value/layer/sources on every token, not just a bag of
  // names, since the gate now validates the full shape (envelope, per-token
  // types, duplicate detection), not name presence alone.
  function validTokensJson(): Record<string, unknown> {
    const names = [...new Set([...getRequiredA1Names(), ...getRequiredA2Names(), ...getBSlotNames()])];
    return {
      schemaVersion: 1,
      format: 'od-design-tokens/v1',
      tokens: names.map((name) => ({ name, value: '#000', layer: 'A1-identity', sources: [] })),
    };
  }

  it('passes when every required A1/A2/B-slot token name is present with a fully valid structure', async () => {
    writeFileSync(path.join(tempDir, 'design-tokens.json'), JSON.stringify(validTokensJson()));
    const result = await runOneGate(tempDir, ['tokens-schema']);
    expect(result.status).toBe('pass');
  });

  it('fails when a required token name is missing', async () => {
    writeFileSync(path.join(tempDir, 'design-tokens.json'), JSON.stringify({ schemaVersion: 1, format: 'od-design-tokens/v1', tokens: [] }));
    const result = await runOneGate(tempDir, ['tokens-schema']);
    expect(result.status).toBe('fail');
  });

  it('fails on unparseable JSON', async () => {
    writeFileSync(path.join(tempDir, 'design-tokens.json'), '{not json');
    const result = await runOneGate(tempDir, ['tokens-schema']);
    expect(result.status).toBe('fail');
  });

  // Sol MED-6's named negative test: every required name present, but
  // otherwise malformed (a duplicate entry) -- name-completeness alone must
  // NOT be enough to pass.
  it('fails a document with every required name present but a DUPLICATE token entry (malformed-but-name-complete)', async () => {
    const valid = validTokensJson();
    const tokens = valid.tokens as Array<{ name: string; value: string; layer: string; sources: unknown[] }>;
    const duplicated = { ...valid, tokens: [...tokens, { ...(tokens[0] as object) }] };
    writeFileSync(path.join(tempDir, 'design-tokens.json'), JSON.stringify(duplicated));
    const result = await runOneGate(tempDir, ['tokens-schema']);
    expect(result.status).toBe('fail');
    expect(result.evidence.join(' ')).toMatch(/duplicate/i);
  });

  it('fails a document with every required name present but a non-string token value (malformed-but-name-complete)', async () => {
    const valid = validTokensJson();
    const tokens = valid.tokens as Array<{ name: string; value: unknown; layer: string; sources: unknown[] }>;
    const first = tokens[0] as { name: string; value: unknown; layer: string; sources: unknown[] };
    const malformed = { ...valid, tokens: [{ ...first, value: 42 }, ...tokens.slice(1)] };
    writeFileSync(path.join(tempDir, 'design-tokens.json'), JSON.stringify(malformed));
    const result = await runOneGate(tempDir, ['tokens-schema']);
    expect(result.status).toBe('fail');
    expect(result.evidence.join(' ')).toMatch(/value/i);
  });

  it('fails a document with the wrong envelope format string', async () => {
    const valid = validTokensJson();
    writeFileSync(path.join(tempDir, 'design-tokens.json'), JSON.stringify({ ...valid, format: 'something-else' }));
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

  it('ts-compile: FAILS with a clear reason when tsconfig.json "extends" escapes the artifact directory (Sol HIGH-1)', async () => {
    writeFileSync(path.join(tempDir, 'tsconfig.json'), JSON.stringify({ extends: '../../../some-other-project/tsconfig.json', compilerOptions: { noEmit: true } }));
    writeFileSync(path.join(tempDir, 'ok.ts'), 'const x: number = 1;\nexport { x };\n');
    const result = await runOneGate(tempDir, ['ts-compile']);
    expect(result.status).toBe('fail');
    expect(result.evidence.join(' ')).toMatch(/path-escape|outside the artifact directory/i);
  });

  it('ts-compile: FAILS when tsconfig.json "include" escapes the artifact directory via an absolute path', async () => {
    writeFileSync(path.join(tempDir, 'tsconfig.json'), JSON.stringify({ include: ['/etc/**/*.ts'], compilerOptions: { noEmit: true } }));
    writeFileSync(path.join(tempDir, 'ok.ts'), 'const x: number = 1;\nexport { x };\n');
    const result = await runOneGate(tempDir, ['ts-compile']);
    expect(result.status).toBe('fail');
    expect(result.evidence.join(' ')).toMatch(/absolute path|outside the artifact directory/i);
  });

  it('ts-compile: does NOT flag a benign, self-contained tsconfig with ordinary glob include', async () => {
    writeFileSync(path.join(tempDir, 'tsconfig.json'), JSON.stringify({ include: ['**/*.ts'], compilerOptions: { noEmit: true, strict: true, skipLibCheck: true } }));
    writeFileSync(path.join(tempDir, 'ok.ts'), 'const x: number = 1;\nexport { x };\n');
    const result = await runOneGate(tempDir, ['ts-compile'], { timeoutMs: 20_000 });
    expect(result.status).toBe('pass');
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

  // Sol review HIGH-2: the audited artifact is untrusted code with file:
  // access and (absent this fix) network reach inside a real browser the
  // daemon owns.
  it('axe: blocks external network requests from artifact JS -- completes promptly rather than hanging on a real network/DNS timeout', async () => {
    // A TEST-NET-2 (RFC 5737) address: guaranteed non-routable, so if
    // blocking somehow failed this would hang/fail slowly rather than
    // silently "succeed" against a real host.
    writeFileSync(
      path.join(tempDir, 'index.html'),
      "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>t</title></head><body><script>fetch('http://198.51.100.1/should-be-blocked').catch(() => {});</script></body></html>",
    );
    const startedAt = Date.now();
    const result = await runOneGate(tempDir, ['axe'], { timeoutMs: 5_000 });
    const elapsedMs = Date.now() - startedAt;
    // Chromium's network stack itself needs a moment; 4s is well under a
    // real connect/DNS timeout to a non-routable address (which would
    // otherwise dominate this gate's runtime).
    expect(elapsedMs).toBeLessThan(4_000);
    expect(['pass', 'fail', 'unavailable']).toContain(result.status);
  }, 10_000);

  it('axe: classifies an artifact whose script hangs indefinitely as FAIL, never a fabricated pass/unavailable (Sol HIGH-2, "a page that hangs is a failing artifact")', async () => {
    writeFileSync(
      path.join(tempDir, 'index.html'),
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body><script>while(true){}</script></body></html>',
    );
    const result = await runOneGate(tempDir, ['axe'], { timeoutMs: 3_000 });
    // Environment-tolerant only at the 'unavailable' edge (no launchable
    // Chromium at all) -- when a browser IS available, a hang MUST be
    // 'fail', never 'unavailable' (that would wrongly imply a harness
    // problem instead of an artifact problem) and never 'pass'.
    if (result.status !== 'unavailable') {
      expect(result.status).toBe('fail');
      expect(result.evidence.join(' ')).toMatch(/hang|infinite loop|did not (finish loading|complete)/i);
    }
  }, 10_000);
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
    recordBootstrapBaseline(db, { buildId: 'build-1', screenshotPath: baselinePng, tokenFreezeVersion: 'v1', siblingGateResults: [det('link-smoke', 'pass')] });
    expect(baselineState(db, 'build-1')).toBe('negative-control-pending');
    expect(() =>
      recordBootstrapBaseline(db, { buildId: 'build-1', screenshotPath: baselinePng, tokenFreezeVersion: 'v1', siblingGateResults: [det('link-smoke', 'pass')] }),
    ).toThrow();
  });

  // Sol HIGH-4b: promotion is SERVER-ENFORCED, not trusted -- a caller
  // cannot bootstrap a baseline while claiming (or simply omitting) that a
  // sibling deterministic gate failed.
  it('refuses to bootstrap when a sibling deterministic gate result is not "pass" (Sol HIGH-4b, server-enforced promotion)', async () => {
    const baselinePng = path.join(tempDir, 'baseline.png');
    await writeSolidPng(baselinePng, { r: 10, g: 10, b: 10 });
    expect(() =>
      recordBootstrapBaseline(db, {
        buildId: 'build-1',
        screenshotPath: baselinePng,
        tokenFreezeVersion: 'v1',
        siblingGateResults: [det('link-smoke', 'pass'), det('form-smoke', 'fail')],
      }),
    ).toThrow(/form-smoke=fail/);
    expect(baselineState(db, 'build-1')).toBe('no-baseline-bootstrap');
  });

  it('refuses to bootstrap when a sibling gate is "unavailable" or "skipped-not-applicable" (neither counts as a clean pass)', async () => {
    const baselinePng = path.join(tempDir, 'baseline.png');
    await writeSolidPng(baselinePng, { r: 10, g: 10, b: 10 });
    expect(() =>
      recordBootstrapBaseline(db, {
        buildId: 'build-1',
        screenshotPath: baselinePng,
        tokenFreezeVersion: 'v1',
        siblingGateResults: [det('link-smoke', 'pass'), det('lighthouse-ci', 'unavailable')],
      }),
    ).toThrow(/lighthouse-ci=unavailable/);
    expect(baselineState(db, 'build-1')).toBe('no-baseline-bootstrap');
  });

  it('negative control MUST fail (discriminate) a deliberately-perturbed comparison before promoting to active', async () => {
    const baselinePng = path.join(tempDir, 'baseline.png');
    const perturbedPng = path.join(tempDir, 'perturbed.png');
    await writeSolidPng(baselinePng, { r: 10, g: 10, b: 10 });
    // Deliberately perturbed: the opposite corner of the color cube --
    // maximally different from the baseline, so the comparison MUST score
    // below the floor to prove it discriminates at all.
    await writeSolidPng(perturbedPng, { r: 245, g: 245, b: 245 });
    recordBootstrapBaseline(db, { buildId: 'build-1', screenshotPath: baselinePng, tokenFreezeVersion: 'v1', siblingGateResults: [det('link-smoke', 'pass')] });

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
    recordBootstrapBaseline(db, { buildId: 'build-1', screenshotPath: baselinePng, tokenFreezeVersion: 'v1', siblingGateResults: [det('link-smoke', 'pass')] });

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
    recordBootstrapBaseline(db, { buildId: 'build-1', screenshotPath: baselinePng, tokenFreezeVersion: 'v1', siblingGateResults: [det('link-smoke', 'pass')] });
    await runNegativeControlCheck(db, { buildId: 'build-1', perturbedScreenshotPath: perturbedPng });
    expect(baselineState(db, 'build-1', 'v1')).toBe('active');

    expect(baselineState(db, 'build-1', 'v2')).toBe('no-baseline-bootstrap');
    // The invalidation is persisted, not just reported for this one read.
    expect(baselineState(db, 'build-1')).toBe('no-baseline-bootstrap');
  });

  it('invalidateSsimBaseline forces a return to no-baseline-bootstrap', async () => {
    const baselinePng = path.join(tempDir, 'baseline.png');
    await writeSolidPng(baselinePng, { r: 10, g: 10, b: 10 });
    recordBootstrapBaseline(db, { buildId: 'build-1', screenshotPath: baselinePng, tokenFreezeVersion: 'v1', siblingGateResults: [det('link-smoke', 'pass')] });
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

    recordBootstrapBaseline(db, { buildId: 'build-1', screenshotPath: baselinePng, tokenFreezeVersion: 'v1', siblingGateResults: [det('link-smoke', 'pass')] });
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

// ---------------------------------------------------------------------------
// Sol MED-7: sharp is imported LAZILY inside compareScreenshotsSimilarity --
// a broken native binding must fail only the screenshot-ssim gate (as
// 'unavailable'), never crash this module's own load. Verified here via
// vi.doMock + a fresh dynamic import of the gates module, so the mocked
// 'sharp' import failure is actually exercised end-to-end through
// runGates(['screenshot-ssim']) rather than merely asserted by code
// inspection.
// ---------------------------------------------------------------------------

describe('screenshot-ssim gate -- lazy sharp import (Sol MED-7)', () => {
  afterEach(() => {
    vi.doUnmock('sharp');
    vi.resetModules();
  });

  it('reports unavailable (never a crash, never a fake pass) when sharp fails to load', async () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    try {
      vi.resetModules();
      vi.doMock('sharp', () => {
        throw new Error('simulated broken native binding');
      });
      const freshGates = (await import('../src/routing/gates.js')) as typeof import('../src/routing/gates.js');

      freshGates.recordBootstrapBaseline(db, {
        buildId: 'build-med7',
        screenshotPath: path.join(tempDir, 'placeholder-baseline.png'),
        tokenFreezeVersion: 'v1',
        siblingGateResults: [],
      });
      // Force straight to 'active' by writing the row directly -- this
      // test's only concern is the sharp import failure path inside the
      // comparison itself, not re-proving the lifecycle transitions
      // already covered above.
      freshGates.ensureSsimBaselinesTable(db);
      db.prepare(`UPDATE routing_ssim_baselines SET state = 'active' WHERE build_id = 'build-med7'`).run();

      const results = await freshGates.runGates(tempDir, ['screenshot-ssim'], {
        buildId: 'build-med7',
        db,
        ssim: { screenshotPath: path.join(tempDir, 'placeholder-candidate.png'), tokenFreezeVersion: 'v1' },
      });
      // The exact wording is vitest's own mock-machinery error text (a
      // `vi.doMock` factory that throws doesn't propagate its literal
      // message cleanly through the hoisting machinery) -- what matters,
      // and what THIS test exists to prove, is the status: a broken
      // `sharp` import degrades to 'unavailable' with SOME explanatory
      // evidence, never a crash and never a fabricated pass/fail.
      expect(results[0]?.status).toBe('unavailable');
      expect(results[0]?.evidence.length).toBeGreaterThan(0);
      expect(results[0]?.evidence.join(' ')).toMatch(/comparison failed|mock/i);
    } finally {
      closeDatabase();
    }
  });
});

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

  // Sol MED-8: pass rate must be computed over APPLICABLE gates only --
  // 'unavailable'/'skipped-not-applicable' must never count against it.
  it('computeLaneMeters excludes unavailable/skipped-not-applicable gate outcomes from the pass-rate denominator', () => {
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(
      db,
      completeRow({ runId: 'run-only-unavailable', gateOutcomes: { 'lighthouse-ci': 'unavailable', 'design-md-lint': 'skipped-not-applicable' } }),
    );
    recordRoutingTelemetry(db, completeRow({ runId: 'run-real-pass', gateOutcomes: { 'link-smoke': 'pass', 'lighthouse-ci': 'unavailable' } }));

    const [meter] = computeLaneMeters(db);
    expect(meter?.lane).toBe('claude-code-oauth');
    // Both rows are ATTRIBUTED runs, but only the second row has an
    // applicable (non-unavailable/skipped) gate outcome -- the first row
    // must be excluded from the gated denominator entirely, not counted
    // as a "failed" row the way the pre-fix-round version did.
    expect(meter?.passRate).toBe(1);
  });

  it('computeLaneMeters does NOT count a row as passing when its only applicable gate genuinely failed, even alongside an unavailable one', () => {
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(db, completeRow({ runId: 'run-genuine-fail', gateOutcomes: { 'form-smoke': 'fail', 'lighthouse-ci': 'unavailable' } }));
    const [meter] = computeLaneMeters(db);
    expect(meter?.passRate).toBe(0);
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

    it('rejects a traversal attempt outside the project root (relative path resolving to an existing directory)', async () => {
      // Computed rather than hardcoded ("../../../../etc") so the escape
      // target is GUARANTEED to exist regardless of mkdtemp nesting depth --
      // realpath-based containment (Sol HIGH-1) requires the resolved path
      // to exist to even reach the containment check.
      const escapeRelative = path.relative(projectsRoot, os.tmpdir());
      const resp = await fetch(`${baseUrl}/api/routing/gates/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifactDir: escapeRelative }),
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

    it('rejects an artifactDir that is a SYMLINK pointing outside the project root (Sol HIGH-1, canonical-path check)', async () => {
      const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-gates-outside-'));
      try {
        const symlinkPath = path.join(projectsRoot, 'sneaky-symlink');
        symlinkSync(outsideDir, symlinkPath, 'dir');
        try {
          const resp = await fetch(`${baseUrl}/api/routing/gates/run`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ artifactDir: 'sneaky-symlink' }),
          });
          expect(resp.status).toBe(400);
          const body = (await resp.json()) as { error: { code: string; message: string } };
          expect(body.error.message).toMatch(/project root/i);
        } finally {
          rmSync(symlinkPath, { force: true });
        }
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects an artifactDir whose PARENT directory is a symlink pointing outside the project root', async () => {
      const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-gates-outside-parent-'));
      mkdirSync(path.join(outsideDir, 'nested'), { recursive: true });
      try {
        const symlinkPath = path.join(projectsRoot, 'sneaky-parent-symlink');
        symlinkSync(outsideDir, symlinkPath, 'dir');
        try {
          const resp = await fetch(`${baseUrl}/api/routing/gates/run`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ artifactDir: 'sneaky-parent-symlink/nested' }),
          });
          expect(resp.status).toBe(400);
        } finally {
          rmSync(symlinkPath, { force: true });
        }
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
      }
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

// ---------------------------------------------------------------------------
// HTTP route, WITH a real database: server-persisted cascade state
// (Sol HIGH-5) and gate-outcome telemetry wiring (Sol MED-8).
// ---------------------------------------------------------------------------

describe('POST /api/routing/gates/run -- server-persisted cascade state and gate-outcome telemetry (with a real db)', () => {
  let server: http.Server;
  let baseUrl: string;
  let projectsRoot: string;
  let dbDir: string;
  let db: ReturnType<typeof openDatabase>;

  beforeAll(async () => {
    projectsRoot = mkdtempSync(path.join(os.tmpdir(), 'od-routing-gates-db-root-'));
    mkdirSync(path.join(projectsRoot, 'build-out'), { recursive: true });
    // A form with no handler -- deterministically FAILS form-smoke, so the
    // same fixture drives cascade escalation across repeated calls.
    writeFileSync(path.join(projectsRoot, 'build-out', 'index.html'), '<form id="f"></form>');

    dbDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-gates-db-'));
    db = openDatabase(dbDir, { dataDir: dbDir });

    const app = express();
    registerRoutingRoutes(app, db, projectsRoot);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDatabase();
    rmSync(projectsRoot, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  async function runGatesHttp(body: Record<string, unknown>) {
    const resp = await fetch(`${baseUrl}/api/routing/gates/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: resp.status, body: (await resp.json()) as Record<string, unknown> };
  }

  it('persists the cascade tier across requests for the same buildId (Sol HIGH-5)', async () => {
    const buildId = `build-tier-${randomUUID()}`;
    const first = await runGatesHttp({ artifactDir: 'build-out', gates: ['form-smoke'], buildId });
    expect(first.status).toBe(200);
    expect((first.body.cascade as { escalate: boolean; tier: string }).escalate).toBe(true);
    expect((first.body.cascade as { tier: string }).tier).toBe('mid');

    // Second call for the SAME build: the persisted tier is 'mid', not
    // 'cheap' -- a client can no longer reset progress by omitting a
    // tier (there is no client tier input at all anymore).
    const second = await runGatesHttp({ artifactDir: 'build-out', gates: ['form-smoke'], buildId });
    expect(second.status).toBe(200);
    expect((second.body.cascade as { tier: string }).tier).toBe('frontier');

    // A THIRD call: already at frontier, nowhere higher to escalate.
    const third = await runGatesHttp({ artifactDir: 'build-out', gates: ['form-smoke'], buildId });
    expect(third.status).toBe(200);
    expect((third.body.cascade as { escalate: boolean; tier: string }).escalate).toBe(false);
    expect((third.body.cascade as { tier: string }).tier).toBe('frontier');
  });

  it('two sequential over-cap runs: the second is blocked once persisted spend + estimate exceeds the cap (Sol HIGH-5)', async () => {
    const buildId = `build-cap-${randomUUID()}`;
    // gateTaxCapUsd is fixed by the real shipped policy (routing-policy.json,
    // $5) -- pick an estimate that fits once, then again pushes past it.
    const policyGateTaxCapUsd = loadRoutingPolicy().budgetCeilings.gateTaxCapUsd as number;
    expect(typeof policyGateTaxCapUsd).toBe('number');
    const perCallEstimate = policyGateTaxCapUsd * 0.6;

    const first = await runGatesHttp({
      artifactDir: 'build-out',
      gates: ['form-smoke'],
      buildId,
      nextEstimatedVerificationCostUsd: perCallEstimate,
    });
    expect(first.status).toBe(200);
    expect((first.body.cascade as { escalate: boolean; gateTax: { overCap: boolean } }).escalate).toBe(true);
    expect((first.body.cascade as { gateTax: { overCap: boolean } }).gateTax.overCap).toBe(false);

    const second = await runGatesHttp({
      artifactDir: 'build-out',
      gates: ['form-smoke'],
      buildId,
      nextEstimatedVerificationCostUsd: perCallEstimate,
    });
    expect(second.status).toBe(200);
    const secondCascade = second.body.cascade as { escalate: boolean; gateTax: { overCap: boolean; spentUsd: number } };
    expect(secondCascade.gateTax.overCap).toBe(true);
    expect(secondCascade.escalate).toBe(false);
    expect(secondCascade.gateTax.spentUsd).toBeCloseTo(perCallEstimate, 5);
  });

  it('rejects client-supplied currentTier/gateSpendSoFarUsd even with a real db configured', async () => {
    const { status, body } = await runGatesHttp({ artifactDir: 'build-out', currentTier: 'frontier' });
    expect(status).toBe(400);
    expect((body.error as { message: string }).message).toMatch(/no longer accepted/i);
  });

  it('wires gate outcomes into telemetry with a SERVER-SYNTHESIZED runId when none is supplied (Sol MED-8)', async () => {
    const { status, body } = await runGatesHttp({ artifactDir: 'build-out', gates: ['link-smoke'] });
    expect(status).toBe(200);
    expect(body.runIdSynthetic).toBe(true);
    expect(typeof body.runId).toBe('string');
    expect(body.attempt).toBe(0);
    const stored = getRoutingTelemetryByRunId(db, body.runId as string, body.attempt as number);
    expect(stored?.gateOutcomes).toEqual({ 'link-smoke': 'pass' });
  });

  it('attaches outcomes to an EXISTING (runId, attempt) telemetry row when supplied, transactionally', async () => {
    const runId = `real-dispatch-${randomUUID()}`;
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(db, completeRow({ runId, attempt: 0, gateOutcomes: {} }));

    const { status, body } = await runGatesHttp({ artifactDir: 'build-out', gates: ['link-smoke'], runId, attempt: 0 });
    expect(status).toBe(200);
    expect(body.runId).toBe(runId);
    expect(body.runIdSynthetic).toBe(false);
    const stored = getRoutingTelemetryByRunId(db, runId, 0);
    expect(stored?.gateOutcomes).toEqual({ 'link-smoke': 'pass' });
  });

  it('rejects a supplied runId/attempt with no matching telemetry row (never silently drops the outcomes)', async () => {
    const { status, body } = await runGatesHttp({ artifactDir: 'build-out', gates: ['link-smoke'], runId: 'never-recorded-run', attempt: 0 });
    expect(status).toBe(400);
    expect((body.error as { message: string }).message).toMatch(/no routing_telemetry row/i);
  });
});

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
