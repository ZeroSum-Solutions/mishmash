// Brief -> catalogue matcher: DTOs + the pure ranking engine.
//
// MishMash ships 561 design templates and 164 functional skills, the large
// majority carrying a curated `triggers` keyword array in their SKILL.md
// frontmatter (see design-templates/AGENTS.md, skills/AGENTS.md). Nothing
// ever compared a user's brief against that array: a project created from
// free-form text got `skillId: null`, no template, no design system, and the
// composed system prompt never mentioned the catalogue existed. An
// architectural-photography brief could sit one keyword away from
// `slate-stone-architectural-h73` or `valmax-photography-landing` and never
// surface either.
//
// This module is the fix's brain: deterministic, local, dependency-free
// keyword/trigger scoring. No embedding model, no network call — grep-grade
// string matching over a small in-memory pool, fast enough to run on every
// composed system prompt. Shared by the daemon HTTP route
// (apps/daemon/src/routes/catalogue-match.ts) and the CLI
// (`od catalogue match`), both of which call it through
// `POST /api/catalogue/match` — see AGENTS.md "Capability exposure".

/** One entry in the matchable pool: a functional skill or a design template. */
export interface CatalogueMatchCandidate {
  id: string;
  kind: 'skill' | 'design-template';
  name: string;
  description: string;
  triggers: string[];
}

/** A candidate that scored above the surfacing threshold, ranked. */
export interface CatalogueMatch {
  id: string;
  kind: CatalogueMatchCandidate['kind'];
  name: string;
  description: string;
  /** Higher is a stronger match. Not normalized/bounded — only meaningful for ranking within one call. */
  score: number;
  /** Normalized terms (triggers and/or description words) that drove the score, for debugging a wrong suggestion. */
  matchedTerms: string[];
}

export interface CatalogueMatchRequest {
  /** The user's brief / prompt text to match against the catalogue. */
  text: string;
  /** Shortlist cap. Defaults to CATALOGUE_MATCH_DEFAULT_LIMIT, clamped to CATALOGUE_MATCH_MAX_LIMIT. */
  limit?: number;
}

export interface CatalogueMatchResponse {
  matches: CatalogueMatch[];
}

// Keep the shortlist small: every entry is a full id + one-line description
// spliced into every composed system prompt for a skill-less run, so it costs
// real tokens on every turn it fires. 5 is enough room for the ranking to
// show a genuine spread (a template pick, a near-miss, an alternate angle)
// without reading as a menu. 6 is the hard ceiling a caller may ask for.
export const CATALOGUE_MATCH_DEFAULT_LIMIT = 5;
export const CATALOGUE_MATCH_MAX_LIMIT = 6;

// A trigger/description term below this score never surfaces at all — an
// empty shortlist is the correct answer for a brief the catalogue has
// nothing good for, and padding the list with a stray one-word overlap would
// make every wrong suggestion look as confident as a real one. Calibrated to
// require either one genuine (non-generic) trigger match, or at least three
// independent description-word overlaps — enough that it isn't just noise.
const MIN_SCORE_TO_SURFACE = 3;

const TRIGGER_SINGLE_WORD_WEIGHT = 3;
// Multi-word triggers ("real estate", "slate & stone") are rarer and more
// specific than any single word in them, so a phrase match is stronger
// evidence than a single-word one — worth more than the sum of two
// single-word matches would be if we scored each word separately (we don't;
// phrase triggers are scored as one unit).
const TRIGGER_PHRASE_BONUS = 2;
const DESCRIPTION_TERM_WEIGHT = 1;

// Calibrated against the shipped catalogue (~493 SKILL.md files carry a
// `triggers:` array as of 2026-08). These are the terms that matched almost
// everything and therefore told us almost nothing:
//   'landing'       104/493 (21%)   'landing page'   96/493 (19%)
//   'hero'           42/493 (9%)    'hero section'   40/493 (8%)
//   'section'        29/493 (6%)    'website'        21/493 (4%)
// Plus the generic marketing/product filler the task named explicitly
// ("landing", "template", "web") and ordinary English function words, which
// exist to make descriptions readable, not to discriminate between them.
// A term in this set contributes zero score whether it appears as a trigger
// or inside a description — so a brief that never leaves this vocabulary
// ("build me a landing page template for my website") returns an empty
// shortlist rather than a list padded with meaningless overlap.
const STOPWORDS = new Set<string>([
  // English function words.
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'be', 'this', 'that', 'these', 'those', 'your', 'you', 'our',
  'we', 'it', 'as', 'at', 'by', 'from', 'into', 'using', 'use', 'used',
  'uses', 'me', 'my', 'i', 'want', 'need', 'like', 'please', 'some', 'any',
  // Near-universal product/marketing filler — see calibration note above.
  'build', 'create', 'make', 'made', 'design', 'designed', 'page', 'pages',
  'site', 'sites', 'web', 'website', 'websites', 'app', 'apps',
  'application', 'applications', 'template', 'templates', 'landing',
  'landing page', 'hero', 'hero section', 'section', 'sections',
  'responsive', 'modern', 'clean', 'simple', 'single', 'single page',
]);

/** Lowercase, strip punctuation/hyphens to spaces, collapse whitespace. */
function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(input: string): string[] {
  const normalized = normalizeText(input);
  return normalized.length > 0 ? normalized.split(' ') : [];
}

/** Non-generic, non-trivial description words — the pool description-term overlap scoring draws from. */
function descriptionTermSet(description: string): Set<string> {
  return new Set(tokenize(description).filter((t) => t.length >= 3 && !STOPWORDS.has(t)));
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return CATALOGUE_MATCH_DEFAULT_LIMIT;
  return Math.max(1, Math.min(CATALOGUE_MATCH_MAX_LIMIT, Math.floor(limit)));
}

export interface CatalogueMatchOptions {
  limit?: number;
}

/**
 * Rank `candidates` against `text` by trigger and description-word overlap.
 *
 * Deterministic and pure: same inputs always produce the same ranked list in
 * the same order (ties broken by id). No entry below MIN_SCORE_TO_SURFACE is
 * returned — a brief with no strong overlap anywhere in the catalogue
 * legitimately returns an empty array, which callers must treat as "nothing
 * to suggest", not as a bug.
 */
export function matchCatalogue(
  candidates: readonly CatalogueMatchCandidate[],
  text: string,
  options: CatalogueMatchOptions = {},
): CatalogueMatch[] {
  const briefTokens = tokenize(text);
  if (briefTokens.length === 0) return [];
  const briefNormalized = ` ${briefTokens.join(' ')} `;
  const briefTermSet = new Set(briefTokens.filter((t) => t.length >= 3 && !STOPWORDS.has(t)));

  const scored: CatalogueMatch[] = [];
  for (const candidate of candidates) {
    let score = 0;
    const matchedTerms = new Set<string>();

    for (const rawTrigger of candidate.triggers) {
      const normalizedTrigger = normalizeText(rawTrigger);
      if (!normalizedTrigger || STOPWORDS.has(normalizedTrigger)) continue;
      const isPhrase = normalizedTrigger.includes(' ');
      // Word-boundary-safe substring check: padding both sides with a space
      // stops "art" inside "chart" (or a trigger word inside a longer brief
      // word) from counting as a match.
      if (briefNormalized.includes(` ${normalizedTrigger} `)) {
        score += TRIGGER_SINGLE_WORD_WEIGHT + (isPhrase ? TRIGGER_PHRASE_BONUS : 0);
        matchedTerms.add(normalizedTrigger);
      }
    }

    if (candidate.description) {
      const descTerms = descriptionTermSet(candidate.description);
      for (const term of briefTermSet) {
        if (descTerms.has(term)) {
          score += DESCRIPTION_TERM_WEIGHT;
          matchedTerms.add(term);
        }
      }
    }

    if (score >= MIN_SCORE_TO_SURFACE && matchedTerms.size > 0) {
      scored.push({
        id: candidate.id,
        kind: candidate.kind,
        name: candidate.name,
        description: candidate.description,
        score,
        matchedTerms: Array.from(matchedTerms),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, clampLimit(options.limit));
}
