#!/usr/bin/env node
// Static reachability sweep for generated/sample marketing-page navigation.
//
// Background (see the follow-up issue): a generated site collapsed its
// <nav> to the wordmark plus a single "Contact" link below 760px:
//
//   @media (max-width: 760px){ .nav a:not(.nav__last){ display: none; } }
//
// The sections the hidden links pointed at (#works, #approach, #services,
// #clients) were still on the page; the nav to them was not, on keyboard,
// screen reader, or touch. No hamburger, no disclosure, no in-page menu
// replaced what the media query hid. This is the general shape of that
// defect: a mobile-width CSS rule that drives a <nav>'s reachable link
// count down to (at most) one, with no document-wide sign of a
// replacement mechanism (hamburger/menu toggle, aria-expanded/
// aria-controls disclosure, checkbox-hack menu, <details> menu).
//
// Deliberately narrow, per the two judgement calls this check encodes:
//   - A <nav> is only in scope once it carries >= 3 links. Two links can
//     reasonably sit side by side on a phone with no menu at all, so this
//     check never fires on that shape regardless of what CSS does to it.
//   - A rule that leaves 2+ links reachable is not flagged: some
//     collapsing is a legitimate design choice (e.g. dropping a secondary
//     link), not a dead end. The invariant is REACHABILITY, not a
//     specific widget — this check does not require a hamburger
//     specifically, only *some* generic disclosure/toggle signal in the
//     document once the base nav is down to <= 1 reachable link.
//
// Two CSS-hiding shapes are recognized (both observed in the live
// catalogue):
//   Tier 1 — "<container> a[:not(EXCEPTIONS)]": the rule directly targets
//     anchor descendants of the nav, e.g. `.nav a:not(.nav__last)`. Exempt
//     links are read out of the `:not()` clause and matched against each
//     link's own class list.
//   Tier 2 — "<wrapper>": the rule hides a whole wrapper element nested
//     inside the nav (e.g. `.nav-links{display:none}` next to a
//     `.nav-toggle` that appears). Reachable count is total links minus
//     however many `<a>` tags sit inside that wrapper's own markup.
//
// This is a text-level heuristic, not a real CSS-selector-to-DOM matcher:
// it identifies "this rule concerns THIS nav" by checking whether the
// rule's selector references a class token that actually appears
// somewhere inside that nav's own opening tags — not a bare substring
// search over the whole stylesheet. False negatives (an unrecognized
// hiding shape, or a mobile menu affordance this script doesn't know the
// name of) are possible and are the accepted cost of a cheap, dependency-
// free, whole-catalogue-scanning check; the replacement-mechanism
// allowlist is intentionally broad so it fails open toward "not a
// violation" rather than penalizing an unfamiliar-but-valid pattern.
//
// Usage:
//   node --experimental-strip-types scripts/check-nav-mobile-reachability.ts
//     Scans every design-templates/*/example.html and prints a summary.
//   node --experimental-strip-types scripts/check-nav-mobile-reachability.ts <file...>
//     Scans exactly the given HTML file(s) instead (used to point the
//     same detector at an out-of-repo generated artifact as evidence).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESIGN_TEMPLATES_DIR = path.join(repoRoot, "design-templates");

// A <nav> only needs a replacement mechanism once collapsing it destroys
// most of its meaning — see file header.
const MIN_LINKS_IN_SCOPE = 3;
const MAX_REACHABLE_BEFORE_VIOLATION = 1;
const MOBILE_MAX_WIDTH_PX = 900;

export interface NavReachabilityViolation {
  navIndex: number;
  totalLinks: number;
  reachableLinks: number;
  mediaQuery: string;
  selector: string;
  tier: 1 | 2;
}

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------
function stripHtmlComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, "");
}
function stripCssComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}
function findMatchingBrace(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}
// Splits on top-level commas only — respects nested parens so
// `:not(.a, .b)` doesn't get sliced in half.
function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}
function classTokens(classAttr: string | undefined): string[] {
  if (!classAttr) return [];
  return classAttr.trim().split(/\s+/).filter(Boolean);
}

// ---------------------------------------------------------------------------
// CSS: collect every declaration inside a mobile-range @media block whose
// body sets display:none or visibility:hidden.
// ---------------------------------------------------------------------------
interface HidingRule {
  selector: string;
  mediaQuery: string;
}

function mobileMaxWidthPx(query: string): number | null {
  const m = query.match(/max-width\s*:\s*([\d.]+)\s*(px|em|rem)?/i);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = (m[2] ?? "px").toLowerCase();
  if (unit === "em" || unit === "rem") return value * 16;
  return value;
}

function hidingRulesInBody(body: string, mediaQuery: string): HidingRule[] {
  const rules: HidingRule[] = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let r: RegExpExecArray | null;
  while ((r = ruleRe.exec(body))) {
    const declBody = r[2] ?? "";
    if (!/(display\s*:\s*none\b|visibility\s*:\s*hidden\b)/i.test(declBody)) continue;
    for (const selector of splitTopLevelCommas(r[1] ?? "")) {
      rules.push({ selector, mediaQuery });
    }
  }
  return rules;
}

// Removes every `@media (...) { ... }` block from `css`, leaving only the
// rules that apply unconditionally.
function stripAllMediaBlocks(css: string): string {
  let out = "";
  let cursor = 0;
  const mediaRe = /@media[^{]*\{/gi;
  let m: RegExpExecArray | null;
  while ((m = mediaRe.exec(css))) {
    const openBrace = css.indexOf("{", m.index);
    const closeBrace = findMatchingBrace(css, openBrace);
    if (closeBrace === -1) break;
    out += css.slice(cursor, m.index);
    cursor = closeBrace + 1;
    mediaRe.lastIndex = cursor;
  }
  out += css.slice(cursor);
  return out;
}

// A hiding declaration reaches mobile widths two ways real templates both
// use: desktop-first (`@media (max-width: N){ SELECTOR{display:none} }`,
// visible by default) and mobile-first (SELECTOR hidden unconditionally in
// the base stylesheet, restored only inside a wider `@media (min-width)`
// block). Both are collected here so the tier matching below doesn't care
// which direction the template was authored in.
function collectHidingRules(css: string): HidingRule[] {
  const rules: HidingRule[] = [];

  // Mobile-first: unscoped (no @media wrapper) rules are the base/mobile
  // state by construction.
  rules.push(...hidingRulesInBody(stripAllMediaBlocks(css), "(unscoped base rule)"));

  // Desktop-first: rules inside a phone/tablet-range max-width query.
  const mediaRe = /@media([^{]*)\{/gi;
  let m: RegExpExecArray | null;
  while ((m = mediaRe.exec(css))) {
    const query = (m[1] ?? "").trim();
    const maxWidth = mobileMaxWidthPx(query);
    if (maxWidth === null || maxWidth > MOBILE_MAX_WIDTH_PX) continue;

    const openBrace = css.indexOf("{", m.index);
    const closeBrace = findMatchingBrace(css, openBrace);
    if (closeBrace === -1) continue;
    const body = css.slice(openBrace + 1, closeBrace);
    rules.push(...hidingRulesInBody(body, query));
  }
  return rules;
}

// ---------------------------------------------------------------------------
// HTML: locate <nav>...</nav> blocks and their <a> links.
// ---------------------------------------------------------------------------
interface NavBlock {
  navIndex: number;
  openTag: string;
  ownClasses: string[];
  innerHtml: string;
  links: { classes: string[] }[];
}

function findNavBlocks(html: string): NavBlock[] {
  const blocks: NavBlock[] = [];
  const navRe = /<nav\b([^>]*)>([\s\S]*?)<\/nav>/gi;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = navRe.exec(html))) {
    const openAttrs = m[1] ?? "";
    const innerHtml = m[2] ?? "";
    const links: { classes: string[] }[] = [];
    const linkRe = /<a\b([^>]*)>/gi;
    let lm: RegExpExecArray | null;
    while ((lm = linkRe.exec(innerHtml))) {
      const linkClassMatch = (lm[1] ?? "").match(/class\s*=\s*"([^"]*)"/i);
      links.push({ classes: classTokens(linkClassMatch?.[1]) });
    }
    const ownClassMatch = openAttrs.match(/class\s*=\s*"([^"]*)"/i);
    blocks.push({
      navIndex: idx,
      openTag: `<nav${openAttrs}>`,
      ownClasses: classTokens(ownClassMatch?.[1]),
      innerHtml,
      links,
    });
    idx += 1;
  }
  return blocks;
}

// Every class token that appears anywhere in the nav's own markup (its own
// opening tag plus every descendant's class attribute), used to decide
// whether a CSS rule elsewhere in the document is "about" this nav.
function referenceTokens(block: NavBlock): Set<string> {
  const tokens = new Set<string>(["nav"]);
  const attrRe = /class\s*=\s*"([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(block.openTag))) for (const t of classTokens(m[1])) tokens.add(t);
  while ((m = attrRe.exec(block.innerHtml))) for (const t of classTokens(m[1])) tokens.add(t);
  return tokens;
}

// Extracts the inner markup of the first element within `container` whose
// class attribute carries `token`, using a simple same-tag-name depth
// counter (adequate for the flat header markup real templates use; it is
// not a general HTML parser).
function extractWrapperInnerHtml(container: string, token: string): string | null {
  const openRe = new RegExp(`<([a-zA-Z][\\w-]*)\\b[^>]*class\\s*=\\s*"[^"]*\\b${escapeRe(token)}\\b[^"]*"[^>]*>`, "i");
  const openMatch = container.match(openRe);
  if (!openMatch || openMatch.index === undefined) return null;
  const tagName = openMatch[1] ?? "";
  const startAfterOpen = openMatch.index + openMatch[0].length;
  const tagRe = new RegExp(`<${tagName}\\b[^>]*>|</${tagName}>`, "gi");
  tagRe.lastIndex = startAfterOpen;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(container))) {
    if (m[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return container.slice(startAfterOpen, m.index);
    } else if (!m[0].endsWith("/>")) {
      depth += 1;
    }
  }
  return container.slice(startAfterOpen);
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Replacement-mechanism detector — deliberately widget-agnostic per
// "Design authority": the invariant is reachability, not a prescribed
// pattern. Any one signal is enough.
// ---------------------------------------------------------------------------
function hasReplacementMechanism(html: string): boolean {
  const nameSignal =
    /\b(?:menu[-_]?toggle|nav[-_]?toggle|hamburger|burger|mobile[-_]?menu|mobile[-_]?nav|menu[-_]?btn|nav[-_]?drawer|menu[-_]?trigger|menu[-_]?panel|menu[-_]?open|nav[-_]?open|menu[-_]?icon)\b/i;
  if (nameSignal.test(html)) return true;
  if (/aria-expanded\s*=/i.test(html)) return true;
  if (/aria-controls\s*=/i.test(html)) return true;
  if (/<details[\s>]/i.test(html)) return true;
  if (/<input[^>]*type\s*=\s*["']checkbox["'][^>]*>/i.test(html) && /<label[\s>]/i.test(html)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Main detector
// ---------------------------------------------------------------------------
export function findNavMobileReachabilityViolations(rawHtml: string): NavReachabilityViolation[] {
  const html = stripHtmlComments(rawHtml);
  const styleBodies = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? "");
  const css = stripCssComments(styleBodies.join("\n"));
  const hidingRules = collectHidingRules(css);
  const navBlocks = findNavBlocks(html);
  const docHasReplacement = hasReplacementMechanism(html);

  const violations: NavReachabilityViolation[] = [];
  for (const block of navBlocks) {
    const totalLinks = block.links.length;
    if (totalLinks < MIN_LINKS_IN_SCOPE) continue;

    const tokens = referenceTokens(block);
    let bestReachable: number | null = null;
    let matchedRule: HidingRule | null = null;
    let matchedTier: 1 | 2 = 1;

    for (const rule of hidingRules) {
      const selector = rule.selector.trim();

      // Tier 1: "<container> a[:not(...)]" or "<container>a[:not(...)]"
      const tier1 = selector.match(/^([.#]?[\w-]+)\s*>?\s*a(\s*:not\(([^)]*)\))?\s*$/i);
      if (tier1) {
        const containerToken = (tier1[1] ?? "").replace(/^[.#]/, "");
        if (!tokens.has(containerToken)) continue;
        const exceptionsRaw = tier1[3] ?? "";
        const exceptionTokens = splitTopLevelCommas(exceptionsRaw)
          .map((e) => e.trim().replace(/^\./, ""))
          .filter(Boolean);
        const reachable =
          exceptionTokens.length === 0
            ? 0
            : block.links.filter((l) => l.classes.some((c) => exceptionTokens.includes(c))).length;
        if (bestReachable === null || reachable < bestReachable) {
          bestReachable = reachable;
          matchedRule = rule;
          matchedTier = 1;
        }
        continue;
      }

      // Tier 2: bare wrapper selector, e.g. ".nav-links". Two shapes:
      // the class sits on the <nav> tag itself (whole nav hidden -> every
      // link is covered), or on a descendant wrapper nested inside it
      // (only that wrapper's links are covered).
      const tier2 = selector.match(/^([.#])([\w-]+)$/);
      if (tier2) {
        const containerToken = tier2[2] ?? "";
        if (containerToken === "nav") continue;
        let covered: number;
        if (block.ownClasses.includes(containerToken)) {
          covered = totalLinks;
        } else if (tokens.has(containerToken)) {
          const wrapperHtml = extractWrapperInnerHtml(block.innerHtml, containerToken);
          if (wrapperHtml === null) continue;
          covered = (wrapperHtml.match(/<a\b/gi) ?? []).length;
        } else {
          continue;
        }
        if (covered === 0) continue; // wrapper hides something other than links (e.g. a CTA button)
        const reachable = totalLinks - covered;
        if (bestReachable === null || reachable < bestReachable) {
          bestReachable = reachable;
          matchedRule = rule;
          matchedTier = 2;
        }
      }
    }

    if (bestReachable === null || matchedRule === null) continue;
    if (bestReachable > MAX_REACHABLE_BEFORE_VIOLATION) continue;
    if (docHasReplacement) continue;

    violations.push({
      navIndex: block.navIndex,
      totalLinks,
      reachableLinks: bestReachable,
      mediaQuery: matchedRule.mediaQuery,
      selector: matchedRule.selector.trim(),
      tier: matchedTier,
    });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function defaultTargets(): string[] {
  const entries = readdirSync(DESIGN_TEMPLATES_DIR, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const examplePath = path.join(DESIGN_TEMPLATES_DIR, entry.name, "example.html");
    if (existsSync(examplePath)) files.push(examplePath);
  }
  return files.sort();
}

function runCli(): void {
  const argv = process.argv.slice(2);
  const targets = argv.length > 0 ? argv.map((p) => path.resolve(p)) : defaultTargets();

  let violatingFiles = 0;
  let totalViolations = 0;
  for (const file of targets) {
    const html = readFileSync(file, "utf8");
    const violations = findNavMobileReachabilityViolations(html);
    if (violations.length === 0) continue;
    violatingFiles += 1;
    totalViolations += violations.length;
    const rel = path.relative(repoRoot, file);
    for (const v of violations) {
      console.log(
        `[FAIL] ${rel} — nav#${v.navIndex}: ${v.totalLinks} links, ${v.reachableLinks} reachable at ${v.mediaQuery} ` +
          `(tier ${v.tier} selector "${v.selector}"), no replacement mechanism found`,
      );
    }
  }

  console.log(
    `\n${violatingFiles} of ${targets.length} scanned file(s) violate nav mobile reachability ` +
      `(${totalViolations} nav element(s) total).`,
  );
}

const isDirectRun = process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) runCli();
