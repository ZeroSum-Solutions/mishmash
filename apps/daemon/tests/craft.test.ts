import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CRAFT_FLOOR, isVisualCraftSurface, loadCraftSections, resolveRequestedCraft } from '../src/craft.js';

let craftDir: string;

beforeAll(async () => {
  craftDir = await mkdtemp(path.join(tmpdir(), 'od-craft-test-'));
  await writeFile(
    path.join(craftDir, 'typography.md'),
    '# typography\n\nALL CAPS ≥ 0.06em.\n',
    'utf8',
  );
  await writeFile(
    path.join(craftDir, 'color.md'),
    '# color\n\nAccent ≤ 2 per screen.\n',
    'utf8',
  );
  await writeFile(path.join(craftDir, 'empty.md'), '   \n\n', 'utf8');
});

afterAll(async () => {
  if (craftDir) await rm(craftDir, { recursive: true, force: true });
});

describe('loadCraftSections', () => {
  it('returns empty when nothing requested', async () => {
    const r = await loadCraftSections(craftDir, []);
    expect(r.body).toBe('');
    expect(r.sections).toEqual([]);
  });

  it('concatenates requested sections in order with section headers', async () => {
    const r = await loadCraftSections(craftDir, ['typography', 'color']);
    expect(r.sections).toEqual(['typography', 'color']);
    expect(r.body.startsWith('### typography')).toBe(true);
    expect(r.body.includes('### color')).toBe(true);
    expect(r.body.indexOf('### typography')).toBeLessThan(r.body.indexOf('### color'));
  });

  it('drops missing files silently (forward-compatible)', async () => {
    const r = await loadCraftSections(craftDir, ['typography', 'motion', 'color']);
    expect(r.sections).toEqual(['typography', 'color']);
  });

  it('drops empty files silently', async () => {
    const r = await loadCraftSections(craftDir, ['empty', 'typography']);
    expect(r.sections).toEqual(['typography']);
  });

  it('rejects bogus slugs (path traversal, special chars)', async () => {
    const r = await loadCraftSections(craftDir, [
      '../etc/passwd',
      'typo/graphy',
      'typography',
    ]);
    expect(r.sections).toEqual(['typography']);
  });

  it('dedupes repeated requests', async () => {
    const r = await loadCraftSections(craftDir, [
      'typography',
      'TYPOGRAPHY',
      'typography',
    ]);
    expect(r.sections).toEqual(['typography']);
  });
});

// Plan A1 — the craft floor. Before this change, `requestedCraft` in
// server.ts was `isWebCloneRun ? [] : union(skillCraftRequires,
// designSystemCraftApplies).filter(...)`: a plain website brief (no
// skill picked, no design system selected) resolved to zero craft
// sections on the single most common path in the product. See
// AGENTS.md "Design authority" for why web-clone must stay exempt.
describe('resolveRequestedCraft', () => {
  const noExplicitCraft = {
    isWebCloneRun: false,
    skillCraftRequires: [],
    designSystemCraftApplies: [],
    designSystemCraftExemptions: [],
  };

  it('the defect: with the pre-fix inputs (no skill, no design system) a visual run got nothing', () => {
    // This is the exact `union(...).filter(...)` server.ts used to run,
    // with none of `isVisualSurface` in play — reproduced here as the
    // "before" baseline so the floor test below reads as its fix.
    const preFixFormula = ({ isWebCloneRun, skillCraftRequires, designSystemCraftApplies, designSystemCraftExemptions }: {
      isWebCloneRun: boolean;
      skillCraftRequires: string[];
      designSystemCraftApplies: string[];
      designSystemCraftExemptions: string[];
    }) => {
      const excluded = new Set(designSystemCraftExemptions);
      return isWebCloneRun
        ? []
        : Array.from(new Set([...skillCraftRequires, ...designSystemCraftApplies])).filter(
            (slug) => !excluded.has(slug),
          );
    };
    expect(preFixFormula(noExplicitCraft)).toEqual([]);
  });

  it('applies the craft floor for a skill-less, design-system-less visual run', () => {
    const r = resolveRequestedCraft({ ...noExplicitCraft, isVisualSurface: true });
    expect(r).toEqual([...CRAFT_FLOOR]);
    expect(r.length).toBeGreaterThan(0);
  });

  it('keeps web-clone runs at zero craft even when the run is visual', () => {
    const r = resolveRequestedCraft({
      ...noExplicitCraft,
      isWebCloneRun: true,
      isVisualSurface: true,
    });
    expect(r).toEqual([]);
  });

  it('keeps a non-visual run (audio/video/chat/plan) at zero craft even with no explicit request', () => {
    const r = resolveRequestedCraft({ ...noExplicitCraft, isVisualSurface: false });
    expect(r).toEqual([]);
  });

  it('an explicit skill request wins outright and is NOT unioned with the floor', () => {
    const r = resolveRequestedCraft({
      isWebCloneRun: false,
      skillCraftRequires: ['motion'],
      designSystemCraftApplies: [],
      designSystemCraftExemptions: [],
      isVisualSurface: true,
    });
    // The skill deliberately requires only `motion` — the floor must not
    // silently add typography/color/anti-ai-slop on top of that choice.
    expect(r).toEqual(['motion']);
  });

  it('unions an explicit skill request with an explicit design-system request', () => {
    const r = resolveRequestedCraft({
      isWebCloneRun: false,
      skillCraftRequires: ['typography'],
      designSystemCraftApplies: ['motion'],
      designSystemCraftExemptions: [],
      isVisualSurface: true,
    });
    expect(r.sort()).toEqual(['motion', 'typography']);
  });

  it('design-system exemptions win over an explicit request', () => {
    const r = resolveRequestedCraft({
      isWebCloneRun: false,
      skillCraftRequires: ['typography', 'color'],
      designSystemCraftApplies: [],
      designSystemCraftExemptions: ['color'],
      isVisualSurface: true,
    });
    expect(r).toEqual(['typography']);
  });

  it('design-system exemptions also win over the floor', () => {
    const r = resolveRequestedCraft({
      ...noExplicitCraft,
      designSystemCraftExemptions: ['anti-ai-slop'],
      isVisualSurface: true,
    });
    expect(r).toEqual(['typography', 'color', 'composition', 'animation-discipline']);
  });

  // Plan A11 — `animation-discipline` joined the floor alongside `composition`.
  // A blind critic scored a default-path build against a commercial Framer
  // template and lost only on motion; driving both pages in a real browser
  // showed the generated page moved zero elements on scroll while the
  // Framer page moved 285. See `craft/animation-discipline.md`'s
  // "Scroll-triggered entrance" section for the default the floor now
  // injects, and `apps/daemon/src/craft.ts`'s `CRAFT_FLOOR` comment for the
  // full rationale.
  it('the floor is small and defensible: exactly typography, color, anti-ai-slop, composition, animation-discipline', () => {
    expect([...CRAFT_FLOOR].sort()).toEqual([
      'animation-discipline',
      'anti-ai-slop',
      'color',
      'composition',
      'typography',
    ]);
  });
});

describe('isVisualCraftSurface', () => {
  it('is true for a plain design-mode run (the default, no media surface)', () => {
    expect(isVisualCraftSurface({ isMediaSurface: false, sessionMode: 'design' })).toBe(true);
  });

  it('is false for image/video/audio media generation', () => {
    expect(isVisualCraftSurface({ isMediaSurface: true, sessionMode: 'design' })).toBe(false);
  });

  it('is false for a chat-only (Ask mode) turn', () => {
    expect(isVisualCraftSurface({ isMediaSurface: false, sessionMode: 'chat' })).toBe(false);
  });

  it('is false for a plan-only turn', () => {
    expect(isVisualCraftSurface({ isMediaSurface: false, sessionMode: 'plan' })).toBe(false);
  });
});
