// composeSystemPrompt's `catalogueMatchBlock` splice — the shortlist a
// skill-less run gets when the brief -> library matcher scores well against
// the catalogue (see packages/contracts/src/api/catalogue-match.ts and
// server.ts's composeDaemonSystemPrompt). Pinning the "an explicit skill
// always wins" invariant here (not just in the daemon-side gate that
// computes the block) means a caller mistake can never resurrect the
// silently-null-skillId defect this feature fixes.

import { describe, expect, it } from 'vitest';

import { composeSystemPrompt } from '../../src/prompts/system.js';

const SHORTLIST_BLOCK =
  '\n\n## Library shortlist\n\n- `slate-stone-architectural-h73` (design template) — Gallery Minimalism architectural real-estate landing page.';

describe('composeSystemPrompt — catalogueMatchBlock splice', () => {
  it('is a no-op when catalogueMatchBlock is undefined or empty', () => {
    const baseline = composeSystemPrompt({});
    expect(composeSystemPrompt({ catalogueMatchBlock: undefined })).toBe(baseline);
    expect(composeSystemPrompt({ catalogueMatchBlock: '' })).toBe(baseline);
    expect(composeSystemPrompt({ catalogueMatchBlock: '   ' })).toBe(baseline);
  });

  it('includes the shortlist when there is no active skill', () => {
    const prompt = composeSystemPrompt({ catalogueMatchBlock: SHORTLIST_BLOCK });
    expect(prompt).toContain('## Library shortlist');
    expect(prompt).toContain('slate-stone-architectural-h73');
  });

  it('NEVER includes the shortlist once an explicit skill is active — even if a caller passes both', () => {
    const withSkillOnly = composeSystemPrompt({
      skillBody: 'Follow this exact workflow.',
      skillName: 'some-explicit-skill',
    });
    const withSkillAndShortlist = composeSystemPrompt({
      skillBody: 'Follow this exact workflow.',
      skillName: 'some-explicit-skill',
      catalogueMatchBlock: SHORTLIST_BLOCK,
    });
    // The explicit skill's own block is present either way…
    expect(withSkillAndShortlist).toContain('## Active skill — some-explicit-skill');
    // …but the shortlist a caller mistakenly attached is dropped outright,
    // not merely reordered — the composed prompt is byte-identical to the
    // skill-only run.
    expect(withSkillAndShortlist).not.toContain('## Library shortlist');
    expect(withSkillAndShortlist).toBe(withSkillOnly);
  });

  it('is skipped in ask/chat mode — a chat turn is not building an artifact', () => {
    const prompt = composeSystemPrompt({
      catalogueMatchBlock: SHORTLIST_BLOCK,
      sessionMode: 'chat',
    });
    expect(prompt).not.toContain('## Library shortlist');
  });

  it('is spliced before the semantic-output-file-names guidance', () => {
    const prompt = composeSystemPrompt({ catalogueMatchBlock: SHORTLIST_BLOCK });
    const shortlistIndex = prompt.indexOf('## Library shortlist');
    const semanticIndex = prompt.indexOf('## Semantic output file names');
    expect(shortlistIndex).toBeGreaterThan(-1);
    expect(semanticIndex).toBeGreaterThan(-1);
    expect(shortlistIndex).toBeLessThan(semanticIndex);
  });
});
