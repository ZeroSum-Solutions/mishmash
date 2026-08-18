// Craft references loader. The active skill declares which sections it
// needs via `od.craft.requires`; this module reads the matching files
// from <projectRoot>/craft/<slug>.md and returns a single concatenated
// body ready to splice into the system prompt. Missing files are
// dropped silently — a skill that lists `motion` before we ship a
// motion.md should still work, just without the motion section.

import { readFile } from "node:fs/promises";
import path from "node:path";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * @param {string} craftDir absolute path to the craft/ directory
 * @param {string[]} requested slugs from `od.craft.requires`
 * @returns {Promise<{ body: string, sections: string[] }>}
 *   body is the concatenated markdown (each file preceded by a level-3
 *   section header). sections lists which slugs actually resolved.
 */
export async function loadCraftSections(craftDir: string, requested: unknown[]) {
  if (!craftDir || !Array.isArray(requested) || requested.length === 0) {
    return { body: "", sections: [] };
  }
  const seen = new Set<string>();
  const parts: string[] = [];
  const sections: string[] = [];
  for (const raw of requested) {
    if (typeof raw !== "string") continue;
    const slug = raw.trim().toLowerCase();
    if (!SLUG_RE.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    try {
      const filePath = path.join(craftDir, `${slug}.md`);
      const text = await readFile(filePath, "utf8");
      const trimmed = text.trim();
      if (!trimmed) continue;
      parts.push(`### ${slug}\n\n${trimmed}`);
      sections.push(slug);
    } catch {
      // File doesn't exist or unreadable — skip silently. Skills can
      // forward-reference future craft sections without breaking.
    }
  }
  return { body: parts.join("\n\n---\n\n"), sections };
}

// Craft floor: when no skill or design system opts into craft rules, and
// the run will still emit styled visual output, inject this default set
// instead of nothing. Kept small — every slug costs prompt tokens on every
// floor run. This exact trio (typography + color + anti-ai-slop) is what
// `skills/frontend-design/SKILL.md` already opts into by hand; the floor
// just extends that same default consideration to runs where no skill or
// design system made the request explicitly (e.g. a plain website brief
// with no skill and no design system selected).
// `composition` is here for a measured reason rather than symmetry. Two
// independent blind comparisons against professionally designed, commercially
// sold templates scored generated output 0/1 on layout risk and 2-3/5 on
// typographic authority, and both named the same cause unprompted: every
// section keeps equal symmetric margins and no headline ever spikes to a
// dominant display size. That is page-level composition, and it is the single
// largest measured quality gap on the default path -- which is precisely the
// path the floor governs. A skill that opts in explicitly still wins outright,
// so a skill deliberately omitting composition keeps that choice.
//
// `animation-discipline` joined for the same class of reason. A blind critic
// scored a default-path build against a commercial Framer template and lost
// only on motion; driving both pages in a real browser (not a screenshot)
// showed why -- the Framer page moves 285 elements on scroll, the generated
// page moved zero, on both builds measured. Nothing else on the page was
// deficient: it declared *more* CSS transitions than the Framer page, just
// none of them scroll-triggered. `craft/animation-discipline.md`'s "Scroll-
// triggered entrance" section is what the floor now injects to close that
// gap -- a single default reveal pattern, gated so it degrades to fully
// visible content with no JS, no IntersectionObserver, or
// prefers-reduced-motion set.
//
// `typography-hierarchy` joins for the same measured reason, not a new one.
// `composition.md`'s hero rule explicitly delegates the actual scale ratio
// to this file ("typography.md and typography-hierarchy.md govern the
// actual scale ratios and vectors once a vector has been chosen to carry
// the hero") -- but until now that delegation target was never loaded on
// the same default path composition.md ships on, so a floor run got the
// requirement ("roughly 8:1 or higher") with none of the genre-banded
// guidance for satisfying it. Measured output against a real commercial
// "restrained" template (Framer "Salix", 5.3:1) confirmed the flat number
// was also the wrong universal target, not just unreachable in isolation --
// see typography-hierarchy.md's "Hero display ratio" section.
//
// `accessibility-baseline` is here because a real floor-path run shipped a
// <nav> that collapsed to the wordmark plus one link below 760px with no
// hamburger, disclosure, or any other replacement -- a keyboard and
// screen-reader dead end to sections that were still on the page. No skill
// or design system had requested the craft section that would have told the
// model to avoid it, and the floor is exactly the path that had nothing to
// fall back on. See craft/accessibility-baseline.md's "Mobile nav
// reachability" rule.
export const CRAFT_FLOOR: readonly string[] = [
  "typography",
  "typography-hierarchy",
  "color",
  "anti-ai-slop",
  "composition",
  "animation-discipline",
  "accessibility-baseline",
];

/**
 * Whether a run will emit styled visual output eligible for the craft
 * floor. Deliberately reuses signals server.ts already resolves for other
 * gates instead of inventing a new one:
 *   - `isMediaSurface` — the same `resolvedExclusiveSurface === 'image' |
 *     'video' | 'audio'` check the critique-panel gate uses. `deck` is
 *     excluded on purpose: a deck still renders as styled HTML/CSS
 *     slides, so typography/color rules still apply to it.
 *   - `sessionMode` — the normalized chat session mode (`design | chat |
 *     plan`). `chat` (Ask mode) and `plan` produce no styled artifact, so
 *     the floor would be dead weight; `design` is the only mode that
 *     builds one.
 *
 * @param {boolean} args.isMediaSurface
 * @param {'design' | 'chat' | 'plan'} args.sessionMode
 * @returns {boolean}
 */
export function isVisualCraftSurface(args: {
  isMediaSurface: boolean;
  sessionMode: "design" | "chat" | "plan";
}): boolean {
  return !args.isMediaSurface && args.sessionMode !== "chat" && args.sessionMode !== "plan";
}

/**
 * Resolves the final list of craft slugs to inject into the system prompt
 * for one run.
 *
 * Precedence, highest to lowest:
 *   1. Web-clone runs never get craft — the target's own computed CSS is
 *      the specification (see AGENTS.md "Design authority"); craft rules
 *      would fight the target's own choices.
 *   2. An explicit request — the active skill's `od.craft.requires` unioned
 *      with the active design system's `craft.applies` — always wins
 *      outright. The floor is a fallback, not a union: it never adds
 *      slugs on top of an explicit request, so a skill that deliberately
 *      requires a narrower set (or none) keeps exactly that set.
 *   3. Only when nothing explicit was requested AND the run is a styled
 *      visual surface (not audio/video/image generation, not a chat-only
 *      or plan-only turn) does the floor apply.
 * `designSystemCraftExemptions` is subtracted at every tier, including the
 * floor, so a design system that exempts a slug keeps that exemption even
 * when the floor would otherwise have added it.
 *
 * @param {boolean} args.isWebCloneRun
 * @param {unknown[]} args.skillCraftRequires slugs from the active skill's `od.craft.requires`
 * @param {unknown[]} args.designSystemCraftApplies slugs the active design system opts into
 * @param {unknown[]} args.designSystemCraftExemptions slugs the active design system exempts
 * @param {boolean} args.isVisualSurface whether this run will emit styled visual output
 * @returns {string[]}
 */
export function resolveRequestedCraft(args: {
  isWebCloneRun: boolean;
  skillCraftRequires: unknown[];
  designSystemCraftApplies: unknown[];
  designSystemCraftExemptions: unknown[];
  isVisualSurface: boolean;
}): string[] {
  if (args.isWebCloneRun) return [];
  const exempt = new Set(
    (Array.isArray(args.designSystemCraftExemptions) ? args.designSystemCraftExemptions : [])
      .filter((slug): slug is string => typeof slug === "string"),
  );
  const explicit = Array.from(
    new Set([
      ...(Array.isArray(args.skillCraftRequires) ? args.skillCraftRequires : []),
      ...(Array.isArray(args.designSystemCraftApplies) ? args.designSystemCraftApplies : []),
    ]),
  ).filter((slug): slug is string => typeof slug === "string" && !exempt.has(slug));
  if (explicit.length > 0) return explicit;
  if (!args.isVisualSurface) return [];
  return CRAFT_FLOOR.filter((slug) => !exempt.has(slug));
}
