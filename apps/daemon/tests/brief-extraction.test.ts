import { describe, expect, it } from 'vitest';
import { matchArchetype } from '../src/design/brief-extraction.js';
import { ARCHETYPES, POETRY_ARCHETYPE, type Archetype } from '../src/design/index.js';

describe('brief-extraction: matchArchetype (F001 R4)', () => {
  const archetypes = Object.values(ARCHETYPES);

  it('resolves the literal demo query to the poetry archetype', () => {
    const demoQuery =
      'hey, can you please tell me the best templates to use for a small business poetry website? please let me know colors and fonts too.';
    const match = matchArchetype(archetypes, demoQuery);
    expect(match?.archetypeId).toBe('poetry');
    expect(match?.matchedTriggers).toContain('poetry');
  });

  it('resolves two independent paraphrases of the demo query to poetry (F001 R4 P0 accuracy bar)', () => {
    const paraphrases = [
      'I run a tiny poetry press and need a simple website for my chapbooks.',
      'Looking for a clean site design for my poet portfolio with a few featured poems.',
    ];
    for (const brief of paraphrases) {
      const match = matchArchetype(archetypes, brief);
      expect(match?.archetypeId, `expected "${brief}" to resolve to poetry`).toBe('poetry');
    }
  });

  it('returns null for a brief with no real overlap against any archetype', () => {
    const match = matchArchetype(archetypes, 'zzz qqq xyz nonsense gibberish');
    expect(match).toBeNull();
  });

  it('is deterministic -- identical input always produces identical output', () => {
    const brief = 'a small business poetry website';
    expect(matchArchetype(archetypes, brief)).toEqual(matchArchetype(archetypes, brief));
  });

  it('mirrors CatalogueMatchCandidate shape closely enough to reuse matchCatalogue directly (no second tokenizer)', () => {
    const synthetic: Archetype = { ...POETRY_ARCHETYPE, id: 'synthetic-test-archetype', triggers: ['zzzznonsense'] };
    const match = matchArchetype([synthetic], 'zzzznonsense everywhere in this brief');
    expect(match?.archetypeId).toBe('synthetic-test-archetype');
  });
});
