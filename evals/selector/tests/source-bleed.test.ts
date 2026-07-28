import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreSourceBleed, type BleedCompositionElement } from '../scorer/source-bleed.ts';

const sourceDomPaths: Record<string, string[]> = {
  'site-a': ['body > header.a', 'body > section.hero.a', 'body > footer.a'],
  'site-b': ['body > header.b', 'body > section.hero.b', 'body > footer.b'],
};
const sourceStyleFingerprints: Record<string, string[]> = {
  'site-a': ['#111111|#eeeeee|Inter, sans-serif'],
  'site-b': ['#222222|#dddddd|Georgia, serif'],
};

test('scores a clean composition with zero bleed', () => {
  const composition: BleedCompositionElement[] = [
    { elementId: 'e0', sourceId: 'site-a', domPath: 'body > header.a', styleFingerprint: '#111111|#eeeeee|Inter, sans-serif' },
    { elementId: 'e1', sourceId: 'site-a', domPath: 'body > section.hero.a', styleFingerprint: '#111111|#eeeeee|Inter, sans-serif' },
  ];
  const result = scoreSourceBleed({ composition, sourceDomPaths, sourceStyleFingerprints });
  assert.equal(result.bleedCount, 0);
  assert.deepEqual(result.violatingElementIds, []);
});

test('detects an injected style-fingerprint bleed even when domPath membership is correct', () => {
  // e0's domPath genuinely belongs to site-a (structurally attributed
  // correctly), but its styleFingerprint has been injected from site-b's
  // real captured style cluster -- this is NOT a domPath-membership
  // failure, so a bleed metric that only checks domPath set membership
  // would miss it entirely.
  const composition: BleedCompositionElement[] = [
    { elementId: 'e0', sourceId: 'site-a', domPath: 'body > header.a', styleFingerprint: '#222222|#dddddd|Georgia, serif' },
    { elementId: 'e1', sourceId: 'site-a', domPath: 'body > section.hero.a', styleFingerprint: '#111111|#eeeeee|Inter, sans-serif' },
  ];
  const result = scoreSourceBleed({ composition, sourceDomPaths, sourceStyleFingerprints });
  assert.equal(result.bleedCount, 1);
  assert.deepEqual(result.violatingElementIds, ['e0']);
});

test('flags a structurally bled element even when the other source name is absent from every comment or label', () => {
  // The composition below carries NO textual mention of "site-b" anywhere
  // (no comment, no label, no name field at all -- BleedCompositionElement
  // doesn't even have a place to put one). e0's domPath was nonetheless
  // pulled from site-b's real DOM structure while claiming sourceId
  // 'site-a'. A "does the string 'site-b' appear anywhere" implementation
  // would report clean; scoreSourceBleed must still catch it via structural
  // (domPath) membership against the CLAIMED source's own captured paths.
  const composition: BleedCompositionElement[] = [{ elementId: 'e0', sourceId: 'site-a', domPath: 'body > footer.b' }];
  const result = scoreSourceBleed({ composition, sourceDomPaths, sourceStyleFingerprints });
  assert.equal(result.bleedCount, 1);
  assert.deepEqual(result.violatingElementIds, ['e0']);
});

test('an element with correct domPath membership but a missing styleFingerprint is flagged, not scored clean (Sol-N2)', () => {
  // Sol-N2's repro exactly: a claimed-source element with no fingerprint at
  // all used to short-circuit to "clean" regardless of what was actually
  // rendered. Missing evidence is unverifiable, not clean -- domPath
  // membership alone is no longer sufficient.
  const composition: BleedCompositionElement[] = [{ elementId: 'e0', sourceId: 'site-a', domPath: 'body > header.a' }];
  const result = scoreSourceBleed({ composition, sourceDomPaths, sourceStyleFingerprints });
  assert.equal(result.bleedCount, 1);
  assert.deepEqual(result.violatingElementIds, ['e0']);
});

test('a fingerprint the claimed source genuinely has at a DIFFERENT region is region-bound bleed, not clean (Sol-N2, round 2)', () => {
  // site-a really renders '#111111|...' at header AND a SECOND, distinct
  // fingerprint '#333333|...' at its footer. An element claims sourceId
  // site-a, domPath = header, but supplies the footer's fingerprint --
  // source-wide membership alone (sourceStyleFingerprints['site-a'] now
  // contains BOTH real fingerprints) would call this clean, since the
  // fingerprint genuinely belongs to site-a SOMEWHERE. sourceRegionFingerprints
  // makes the check region-bound: site-a's REAL fingerprint at header is
  // '#111111|...', not '#333333|...', so this is bleed.
  const twoFingerprintSourceStyleFingerprints: Record<string, string[]> = {
    'site-a': ['#111111|#eeeeee|Inter, sans-serif', '#333333|#cccccc|Inter, sans-serif'],
    'site-b': ['#222222|#dddddd|Georgia, serif'],
  };
  const sourceRegionFingerprints: Record<string, Record<string, string>> = {
    'site-a': {
      'body > header.a': '#111111|#eeeeee|Inter, sans-serif',
      'body > footer.a': '#333333|#cccccc|Inter, sans-serif',
    },
    'site-b': { 'body > header.b': '#222222|#dddddd|Georgia, serif' },
  };
  const composition: BleedCompositionElement[] = [{ elementId: 'e0', sourceId: 'site-a', domPath: 'body > header.a', styleFingerprint: '#333333|#cccccc|Inter, sans-serif' }];

  // Without the region mapping: source-wide membership alone reports clean
  // (the fingerprint IS one of site-a's real fingerprints, just not at this
  // domPath) -- this is the exact gap Sol-N2 (round 2) flagged.
  const withoutRegionMap = scoreSourceBleed({ composition, sourceDomPaths, sourceStyleFingerprints: twoFingerprintSourceStyleFingerprints });
  assert.equal(withoutRegionMap.bleedCount, 0);

  // With the region mapping supplied: the same input is caught as bleed.
  const withRegionMap = scoreSourceBleed({ composition, sourceDomPaths, sourceStyleFingerprints: twoFingerprintSourceStyleFingerprints, sourceRegionFingerprints });
  assert.equal(withRegionMap.bleedCount, 1);
  assert.deepEqual(withRegionMap.violatingElementIds, ['e0']);
});
