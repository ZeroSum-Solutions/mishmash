/**
 * @module design/brief-extraction
 *
 * F001 R4 -- brief -> archetype extraction. Reuses `matchCatalogue`'s
 * proven, deterministic trigger-overlap scoring
 * (packages/contracts/src/api/catalogue-match.ts, already shared by
 * `POST /api/catalogue/match` and `od catalogue match`) instead of building
 * a second tokenizer/scorer: each Archetype's `triggers` array becomes a
 * matchable candidate, exactly the shape `matchCatalogue` already scores
 * skills/templates against. This is the "same way matchCatalogue already
 * works" pattern R4 asks for, not the unimplemented `evals/selector/nl-to-ir/`
 * stub the original draft of this finding cited.
 */

import { matchCatalogue, type CatalogueMatchCandidate } from '@open-design/contracts';

import type { Archetype } from './site-archetypes.js';

export interface ArchetypeMatch {
  archetypeId: string;
  /** Higher is a stronger match -- not normalized, only meaningful for ranking within one call (mirrors CatalogueMatch.score). */
  score: number;
  /** Trigger terms from the archetype that matched the brief, for a human-readable rationale. */
  matchedTriggers: string[];
}

/**
 * Matches free-text `brief` against every archetype's `triggers`, returning
 * the single best-scoring archetype, or `null` when nothing scored above
 * `matchCatalogue`'s surfacing floor -- a brief with no real overlap
 * anywhere in the archetype list legitimately has no archetype match.
 * Deterministic: same inputs always produce the same result.
 */
export function matchArchetype(archetypes: readonly Archetype[], brief: string): ArchetypeMatch | null {
  const candidates: CatalogueMatchCandidate[] = archetypes.map((archetype) => ({
    id: archetype.id,
    kind: 'skill',
    name: archetype.name,
    description: '',
    triggers: archetype.triggers,
  }));
  const [best] = matchCatalogue(candidates, brief, { limit: 1 });
  if (!best) return null;
  return { archetypeId: best.id, score: best.score, matchedTriggers: best.matchedTerms };
}
