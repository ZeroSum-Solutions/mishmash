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

test('an element with no styleFingerprint at all is judged on domPath membership alone', () => {
  const composition: BleedCompositionElement[] = [{ elementId: 'e0', sourceId: 'site-a', domPath: 'body > header.a' }];
  const result = scoreSourceBleed({ composition, sourceDomPaths, sourceStyleFingerprints });
  assert.equal(result.bleedCount, 0);
});
