// resolve-conflicts.test.ts -- Sol-N4 (round 4): "scopeOverlap is ignored."
// Grouping must consult ir.conflictResolution[].scopeOverlap as the PRIMARY
// signal for whether an axis's claims form a genuine contest, not just a
// role-key string heuristic.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveConflicts, type DirectiveClaim, type ConflictResolutionRecord } from '../scorer/resolve-conflicts.ts';
import { loadCaseIR, loadManifest } from '../scorer/corpus-loader.ts';

test('a declared same-role-different-source overlap groups its claims into one contest with a winner and a loser', () => {
  const directives: DirectiveClaim[] = [
    { axis: 'layout', source: 'site-a', scope: 'body > div.site-a-shell > hero.site-a-hero', strength: 0.9 },
    { axis: 'layout', source: 'site-b', scope: 'body > div.site-b-shell > hero.site-b-hero', strength: 0.6 },
  ];
  const conflictResolution: ConflictResolutionRecord[] = [{ axis: 'layout', winningSource: 'site-a', losingSource: 'site-b', scopeOverlap: 'same-role-different-source' }];
  const out = resolveConflicts({ directives, conflictResolution });
  assert.equal(out.losingClaims.length, 1, `expected exactly one losing claim, got ${JSON.stringify(out.losingClaims)}`);
  assert.deepEqual(out.losingClaims[0], { axis: 'layout', winningSource: 'site-a', losingSource: 'site-b' });
});

test('a declared single-claimant scopeOverlap is the PRIMARY signal -- overrides a role-key match that would otherwise suggest a contest', () => {
  // Sol-N4's exact gap: two claims on the same axis, from two DIFFERENT
  // sources, sharing the SAME role-key (same scope with source id stripped)
  // -- a role-key-ONLY heuristic (round 2's behavior) would treat this as a
  // genuine contest and manufacture a losing claim. The IR itself declares
  // scopeOverlap: 'single-claimant' for this axis (asserting there is no
  // real overlap -- e.g. two independent single-source directives that
  // happen to target visually-similar-looking scopes in different cases'
  // generation passes). The declared signal must win: NO losing claim.
  const directives: DirectiveClaim[] = [
    { axis: 'palette', source: 'site-a', scope: 'body > div.site-a-shell > hero.site-a-hero', strength: 0.5 },
    { axis: 'palette', source: 'site-b', scope: 'body > div.site-b-shell > hero.site-b-hero', strength: 0.5 },
  ];
  const conflictResolution: ConflictResolutionRecord[] = [{ axis: 'palette', winningSource: 'site-a', scopeOverlap: 'single-claimant' }];
  const out = resolveConflicts({ directives, conflictResolution });
  assert.equal(out.losingClaims.length, 0, `expected zero losing claims (declared single-claimant overrides role-key contest), got ${JSON.stringify(out.losingClaims)}`);
});

test('no declared conflictResolution entry falls back to role-key grouping (unchanged round-2 behavior)', () => {
  // hostile-heavy-dom-catalog-shaped scenario: same axis, unrelated scopes
  // (different role keys), no declared entry for the axis at all -- each
  // role-key group is independent, no contest manufactured.
  const directives: DirectiveClaim[] = [
    { axis: 'palette', source: 'hostile-abs-a', scope: 'body > div.hostile-abs-a-shell > section.hostile-abs-a-catalog > div.hostile-abs-a-item-0', strength: 0.4 },
    { axis: 'palette', source: 'hostile-grid-b', scope: 'body > div.hostile-grid-b-shell > section.hostile-grid-b-catalog > div.hostile-grid-b-item-4', strength: 0.5 },
  ];
  const out = resolveConflicts({ directives, conflictResolution: [] });
  assert.equal(out.losingClaims.length, 0, `expected zero losing claims (unrelated role keys, no declared entry), got ${JSON.stringify(out.losingClaims)}`);
});

test('real overlap case: marketing-hero-grid\'s live corpus IR resolves its declared layout conflict correctly', () => {
  // "Test with a real overlap case" -- the actual generated IR, not a
  // synthetic fixture, exercising resolveConflicts against real
  // scopeOverlap='same-role-different-source' data from generate-corpus.ts.
  const manifest = loadManifest();
  const c = manifest.cases.find((cc) => cc.id === 'marketing-hero-grid')!;
  const ir = loadCaseIR(c);
  const layoutEntry = ir.conflictResolution.find((r) => r.axis === 'layout');
  assert.equal(layoutEntry?.scopeOverlap, 'same-role-different-source', 'fixture sanity: marketing-hero-grid declares a real layout overlap');
  const out = resolveConflicts(ir);
  const layoutLosses = out.losingClaims.filter((lc) => lc.axis === 'layout');
  assert.equal(layoutLosses.length, 1, `expected exactly one losing layout claim, got ${JSON.stringify(layoutLosses)}`);
  assert.deepEqual(layoutLosses[0], { axis: 'layout', winningSource: 'mkt-grid-a', losingSource: 'mkt-flex-b' });
});
