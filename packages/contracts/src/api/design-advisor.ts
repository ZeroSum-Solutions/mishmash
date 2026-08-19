// F001 R6 -- design advisor DTOs, shared by the daemon HTTP route
// (apps/daemon/src/routes/design-advisor.ts) and the CLI
// (`od design-advisor recommend`), per AGENTS.md "Capability exposure": one
// shared shape, two callers.
//
// The actual matching/ranking logic (matchArchetype / rankCandidates) lives
// daemon-side (apps/daemon/src/design/), not here: it depends on the
// Archetype domain model (apps/daemon/src/design/site-archetypes.ts) and
// reads the design-templates/index.json build artifact from disk, neither
// of which a pure contracts package can depend on. This mirrors
// packages/contracts/src/api/catalogue-match.ts's DTO shape, minus the
// scorer, which stays daemon-side here.
//
// R7 (the `gallery-select` GenUI surface + a chat-agent triggering this
// mid-conversation) is intentionally NOT part of this contract yet -- it is
// parked on the still-open GenUI invocation architecture decision
// (CROSS-CUTTING-CORRECTIONS.md "Decisions required" #2). This DTO covers
// only the plain request/response half F001 R6 says is buildable
// independently of that decision.

export interface DesignAdvisorCandidate {
  slug: string;
  name: string;
  /** 0..1. Higher is a stronger fit for the matched archetype. Not a probability. */
  score: number;
  /** Human-readable, names the specific index fields that drove the score (F001 R5). */
  rationale: string[];
}

export interface DesignAdvisorRequest {
  /** The user's brief / prompt text to match against the archetype list, e.g. "best templates for a small business poetry website". */
  prompt: string;
  /** Result cap. Defaults to DESIGN_ADVISOR_DEFAULT_LIMIT, clamped to DESIGN_ADVISOR_MAX_LIMIT. */
  limit?: number;
}

export interface DesignAdvisorResponse {
  /** The archetype the brief resolved to via F001 R4's trigger-overlap matcher, or null if nothing scored above the surfacing floor. */
  archetypeId: string | null;
  /** Ranked highest-score-first. Empty when archetypeId is null. */
  candidates: DesignAdvisorCandidate[];
}

// F001's Open Question #1 provisional P0 default: "cap the grid at ~12
// (Devin's own number from this question), no 'show more' UI yet" -- see
// F001-conversational-template-advisor.md §5. Not formally locked
// (CROSS-CUTTING-CORRECTIONS.md's "Provisional, not formally resolved"
// list), but this is the safe unattended default the PRD itself names.
export const DESIGN_ADVISOR_DEFAULT_LIMIT = 12;
export const DESIGN_ADVISOR_MAX_LIMIT = 12;
