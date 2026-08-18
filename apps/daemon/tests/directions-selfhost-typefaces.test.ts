// Regression guard for the design-direction library's font choices.
//
// Measured defect (gauntlet A5): every built-in direction named a
// platform-locked font (Apple-only 'Iowan Old Style' / 'SF Pro Display', or
// the commercial 'Söhne') as its FIRST display-font choice, with no
// self-hosting step. Nothing rendered it — the browser silently fell
// through to whatever font the visitor's OS happened to ship, so the
// approved preview and what a Windows/Linux visitor saw were two different
// sites. This file pins the fix: every direction that names a self-hostable
// family must actually be able to self-host it (a real, license-cleared
// catalogue entry), and the generated instruction must tell the agent to
// install it before binding the stacks.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { DESIGN_DIRECTIONS, renderDirectionSpec } from '../src/prompts/directions.js';
import { buildTypefaceIndex } from '../src/typefaces/catalogue.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const realCatalogueRoot = path.join(repoRoot, 'design-templates');

describe('design directions self-host their named webfonts', () => {
  it('every declared selfHostTypefaces id resolves to a real, license-cleared catalogue family', async () => {
    const index = await buildTypefaceIndex(realCatalogueRoot);
    for (const direction of DESIGN_DIRECTIONS) {
      for (const id of direction.selfHostTypefaces ?? []) {
        expect(
          index.families.has(id),
          `direction "${direction.id}" declares selfHostTypefaces id "${id}", which is not in the installable typeface index`,
        ).toBe(true);
      }
    }
  });

  it('every direction with selfHostTypefaces emits an install instruction naming each id', () => {
    for (const direction of DESIGN_DIRECTIONS) {
      if (!direction.selfHostTypefaces?.length) continue;
      const spec = renderDirectionSpec(direction);
      expect(spec).toMatch(/typefaces install/);
      for (const id of direction.selfHostTypefaces) {
        expect(
          spec.includes(`typefaces install ${id} --project`),
          `${direction.id}'s rendered spec should instruct installing "${id}"`,
        ).toBe(true);
      }
    }
  });

  it('directions with no selfHostTypefaces render no install instruction (nothing to fabricate)', () => {
    for (const direction of DESIGN_DIRECTIONS) {
      if (direction.selfHostTypefaces?.length) continue;
      expect(renderDirectionSpec(direction)).not.toMatch(/typefaces install/);
    }
  });

  it('no display/body/mono font stack leads with a platform-locked or commercial-only face', () => {
    // Regression pin for the measured defect: 'Iowan Old Style' and 'SF Pro
    // Display'/'SF Pro Text' are Apple-only; 'Söhne' is a paid commercial
    // face. None may be the FIRST (i.e. actually-attempted-to-render) name
    // in any stack — a safe cross-platform or self-hosted name must lead.
    const bannedFirst = ['Iowan Old Style', 'SF Pro Display', 'SF Pro Text', 'Söhne'];
    const firstFamily = (stack: string): string | undefined => stack.split(',')[0]?.trim().replace(/^'|'$/g, '');
    for (const direction of DESIGN_DIRECTIONS) {
      for (const stack of [direction.displayFont, direction.bodyFont, direction.monoFont].filter(
        (s): s is string => typeof s === 'string',
      )) {
        expect(
          bannedFirst.includes(firstFamily(stack) ?? ''),
          `direction "${direction.id}" leads a font stack with a platform-locked/commercial face: "${stack}"`,
        ).toBe(false);
      }
    }
  });
});
