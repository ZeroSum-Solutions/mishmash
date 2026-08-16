import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listSkills } from '../src/skills.js';

// `NewProjectPanel.skillIdForTab` resolves each tab's skill as
// `list.find((s) => s.defaultFor.includes(<surface>))?.id ?? list[0]?.id`.
// When nothing declares the surface, `list[0]` decides — and `list[0]` is
// whatever the merged skills/ + design-templates/ scan happens to yield first.
//
// For the Video surface that is not a cosmetic default. `skillIdForTab` feeds an
// effect that rewrites `videoModel` to `hyperframes-html` when (and only when)
// the winner is `hyperframes`, so catalog order decides which provider a user's
// first video project bills against. It was observed resolving both ways on the
// same commit.
//
// This pins the declaration rather than the winner: any skill may hold the
// default, but exactly one must claim it, so the answer never comes from sort
// order.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const CATALOG_ROOTS = [
  path.join(repoRoot, 'skills'),
  path.join(repoRoot, 'design-templates'),
];

// Surfaces whose resolved skill changes what the user is billed for, so an
// undeclared default is a real defect rather than an arbitrary-but-harmless
// pick. `deck` is here because it already declares one and must not regress;
// `video` is the surface this test was written for.
//
// `image`, `audio`, and `prototype` are deliberately NOT required. They resolve
// through the same `?? list[0]` fallback, but no effect derives a model from
// their skill — the model comes from `DEFAULT_IMAGE_MODEL` /
// `DEFAULT_AUDIO_MODEL` regardless — so order decides only which SKILL.md body
// the agent receives. Recorded as CANVAS-18 rather than fixed here.
const SURFACES_REQUIRING_A_DECLARED_DEFAULT = ['deck', 'video'] as const;

describe('skill catalog default-surface declarations', () => {
  it('every billing-relevant surface has exactly one declared default skill', async () => {
    const skills = await listSkills(CATALOG_ROOTS);
    expect(skills.length).toBeGreaterThan(0);

    for (const surface of SURFACES_REQUIRING_A_DECLARED_DEFAULT) {
      // Mirrors the panel's own candidate filter, so the test fails for the same
      // reason the UI would: a declaration on a skill the panel never considers
      // is not a fix.
      const candidates = skills.filter((s) => s.mode === surface || s.surface === surface);
      expect(candidates.length, `no skill offers the ${surface} surface`).toBeGreaterThan(0);

      const declared = candidates.filter((s) => s.defaultFor.includes(surface));
      expect(
        declared.map((s) => s.id),
        `exactly one ${surface} skill must declare od.default_for: ${surface}`,
      ).toHaveLength(1);
    }
  });

  it('no surface is claimed by two skills at once', async () => {
    const skills = await listSkills(CATALOG_ROOTS);
    const claimants = new Map<string, string[]>();
    for (const skill of skills) {
      for (const surface of skill.defaultFor) {
        claimants.set(surface, [...(claimants.get(surface) ?? []), skill.id]);
      }
    }
    for (const [surface, ids] of claimants) {
      // Two claimants puts us back where we started: `find` returns whichever
      // one the scan reached first.
      expect(ids, `${surface} is claimed by more than one skill`).toHaveLength(1);
    }
  });
});
