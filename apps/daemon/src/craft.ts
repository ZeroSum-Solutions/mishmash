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
export const CRAFT_FLOOR: readonly string[] = ["typography", "color", "anti-ai-slop"];

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
