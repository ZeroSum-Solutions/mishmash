// Boundary hardening for the caller-supplied routing identity fields
// (WR wave, P1 tranche, Amendment 1).
//
// Amendment 1 let `/api/chat` bodies carry templateId/buildClass/taskClass.
// That turned three previously-ignored fields into UNTRUSTED input on the
// dispatch path, and an adversarial review of the tranche found three real
// consequences of taking them at face value:
//
//   1. An unknown taskClass is a terminal 'error' inside decideRouting, which
//      the dispatch layer surfaces as a BLOCKED run -- so one stale or
//      garbage string would fail an otherwise ordinary chat turn outright.
//   2. templateId lands in the routing_telemetry `template_id` column on
//      EVERY turn, including runtime-default ones, with only the route's 4mb
//      JSON body limit bounding it.
//   3. Naming a task class selects a real policy candidate, so cost
//      containment has to actually work on that path -- which requires a
//      non-zero token estimate reaching admission control.
//
// These tests pin the boundary behavior that answers 1 and 2, and the
// estimate plumbing that answers 3.

import { describe, expect, it } from 'vitest';

import { knownTaskClasses, loadRoutingPolicy } from '../src/routing/policy.js';
import { estimatePromptTokens } from '../src/routing/decision.js';

const policy = loadRoutingPolicy();

// Mirror of the server-side normalizer at the /api/chat dispatch hook. Kept
// in lockstep with it deliberately: server.ts is a BYTE-PRESERVE overlap file
// whose hook body cannot be extracted into an exported helper without
// modifying frozen lines, so the contract is pinned here instead of imported.
const WR_IDENTITY_MAX_LEN = 200;
function identityField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > WR_IDENTITY_MAX_LEN) return null;
  return trimmed;
}
function resolveTaskClass(raw: unknown): string | null {
  const requested = identityField(raw);
  return requested && knownTaskClasses(policy).has(requested) ? requested : null;
}

describe('knownTaskClasses', () => {
  it('covers both §2 model-table rows and §15 program assignments', () => {
    const known = knownTaskClasses(policy);

    // A model-table row's own match value.
    expect(known.has('long-horizon-autonomous-builds')).toBe(true);
    // A program-assignment selector, which is NOT a model-table taskClass.
    expect(known.has('code-adversary')).toBe(true);
    expect(known.size).toBeGreaterThanOrEqual(10);
  });

  it('does not admit an unknown class', () => {
    expect(knownTaskClasses(policy).has('not-a-real-task-class')).toBe(false);
  });
});

describe('caller-supplied taskClass degrades instead of failing the turn', () => {
  it('keeps a task class the policy can actually resolve', () => {
    expect(resolveTaskClass('long-horizon-autonomous-builds')).toBe('long-horizon-autonomous-builds');
    expect(resolveTaskClass('  code-adversary  ')).toBe('code-adversary');
  });

  it('drops an unknown task class to null (Fallback B) rather than passing it to decideRouting', () => {
    // Passing this through would make decideRouting return a terminal error
    // and BLOCK the run -- the whole point is that plain chat still works.
    expect(resolveTaskClass('not-a-real-task-class')).toBeNull();
    expect(resolveTaskClass('')).toBeNull();
    expect(resolveTaskClass('   ')).toBeNull();
    expect(resolveTaskClass(42)).toBeNull();
    expect(resolveTaskClass(null)).toBeNull();
    expect(resolveTaskClass({ taskClass: 'long-context-ops' })).toBeNull();
  });
});

describe('identity fields are length-bounded before they reach telemetry', () => {
  it('rejects an over-long value instead of writing it to the telemetry column', () => {
    expect(identityField('x'.repeat(WR_IDENTITY_MAX_LEN))).toHaveLength(WR_IDENTITY_MAX_LEN);
    expect(identityField('x'.repeat(WR_IDENTITY_MAX_LEN + 1))).toBeNull();
    // The shape of the abuse the bound exists for: megabytes of junk aimed at
    // routing_telemetry.template_id on every single chat turn.
    expect(identityField('a'.repeat(1_000_000))).toBeNull();
  });

  it('trims rather than storing caller whitespace verbatim', () => {
    expect(identityField('  section-component-codegen  ')).toBe('section-component-codegen');
  });
});

describe('admission control receives a real token estimate', () => {
  it('estimatePromptTokens turns the user message into a non-zero estimate', () => {
    // With promptText null the estimate is 0, every estimatedRunCostUsd() is
    // $0, and the per-stage ceiling can never trip. Supplying the message is
    // what keeps the ceiling meaningful.
    expect(estimatePromptTokens('write me a long-horizon build plan'.repeat(40))).toBeGreaterThan(0);
  });
});
