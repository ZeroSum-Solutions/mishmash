/**
 * Pure renderer for the `## Library shortlist` block: the ranked output of
 * `matchCatalogue` (../api/catalogue-match.js), folded into the composed
 * system prompt for runs that have no explicit skill/template/design system
 * (see apps/daemon/src/prompts/system.ts). Lives in contracts (pure TS, no
 * fs/db) so the daemon-side composer stays a thin caller, matching
 * atom-block.ts's `renderActiveStageBlock` pattern.
 *
 * This is a SUGGESTION, not a directive: the daemon never auto-applies a
 * match (see AGENTS.md "Design authority" — this repo has no house
 * aesthetic, and a wrong auto-pick out of 561 candidates is worse than no
 * pick). The block hands the agent a small, ranked, explainable shortlist
 * and leaves the decision to it.
 */

import type { CatalogueMatch } from '../api/catalogue-match.js';

export function renderCatalogueMatchBlock(matches: readonly CatalogueMatch[]): string {
  if (matches.length === 0) return '';
  const lines = matches.map((m) => {
    const kindLabel = m.kind === 'skill' ? 'skill' : 'design template';
    const description = m.description.trim() || m.name;
    return `- \`${m.id}\` (${kindLabel}) — ${description}`;
  });
  return `\n\n## Library shortlist\n\nThe user's brief matched these entries in the design-templates/skills catalogue on keyword/trigger overlap (ranked, not exhaustive — the catalogue holds hundreds more). Nothing here was auto-applied; use your own judgement:\n\n${lines.join('\n')}\n\nIf one is a strong fit for what the user is building, lean into it — mention it to the user, offer to build in its named aesthetic, or draw on its structure/section order as a starting point. If none genuinely fit, ignore this list and proceed with the brief as given.`;
}
