#!/usr/bin/env node
// Generates design-templates/index.json -- the structured design index F001
// R1 asks for: one row per design-templates/*/SKILL.md, carrying a
// best-effort-extracted, role-labeled palette and typography, a controlled
// mood tag set, density/motion_level three-point scales, and a preview
// pointer. Nothing here is fabricated: every low-confidence guess is
// labeled `confidence: 'low'` rather than presented as certain (F001 R1's
// own requirement).
//
// This artifact is COMMITTED to git, not built at request time -- this repo
// has no root aggregate build step (AGENTS.md:137: "Do not add root
// aggregate `pnpm build` ... aliases"). Regenerate by hand after touching
// any design-templates/*/SKILL.md or template.json:
//
//   node scripts/build-design-index.ts
//
// scripts/validate-design-catalog.ts's checkDesignIndex (F001 R2) is the
// drift gate: it recomputes each row's sourceHash from the CURRENT on-disk
// SKILL.md/template.json bytes and fails `pnpm guard` if a row was not
// regenerated after its source changed. generatedAt intentionally changes
// on every run and is NOT part of that hash comparison.
//
// Usage:
//   node scripts/build-design-index.ts

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MOODS,
  type ConfidenceLevel,
  type DensityLevel,
  type MotionLevel,
  type PaletteRole,
  type TypographyRole,
} from './design-taxonomy.ts';
// Type-only: avoids a runtime import cycle. validate-design-catalog.ts
// imports the DesignIndex/DesignIndexEntry types defined below for its own
// F001 R2 checks; this file imports parseSkillFrontmatter (a runtime value)
// from there. Type-only imports are erased at compile time, so there is no
// circular runtime dependency, only a mutual type reference.
import { parseSkillFrontmatter } from './validate-design-catalog.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES_DIR = path.join(ROOT, 'design-templates');
const INDEX_PATH = path.join(TEMPLATES_DIR, 'index.json');

// ---------------------------------------------------------------------------
// Schema (F001 R1) -- shared with scripts/validate-design-catalog.ts
// ---------------------------------------------------------------------------

export interface DesignIndexPaletteEntry {
  hex: string;
  role: PaletteRole;
  provenance: string;
  confidence: ConfidenceLevel;
}

export interface DesignIndexTypographyRoleValue {
  family: string | null;
  confidence: ConfidenceLevel;
}

export interface DesignIndexTypography {
  body: DesignIndexTypographyRoleValue;
  body_alt?: DesignIndexTypographyRoleValue;
  headings: DesignIndexTypographyRoleValue;
  ui: DesignIndexTypographyRoleValue;
}

export interface DesignIndexPreview {
  path: string | null;
  hasExampleHtml: boolean;
  thumbnail: null;
}

// Scoreable typesetting/layout facts (F001 R1, Addendum A.3 / R5). R5's
// poetry ranker must "deterministically penalize an 80ch or centered-text
// template" -- these are the per-template fields it checks against an
// archetype's ArchetypeTypesettingConstraints
// (apps/daemon/src/design/site-archetypes.ts). Most SKILL.md bodies never
// state a body-text measure or alignment explicitly, and a bare `max-width`
// or `text-align` mention in the source may describe an unrelated page
// element rather than the reading column -- so every field here stays
// `confidence: 'low'` unless the doc uses a typesetting term specific enough
// that it isn't plausibly about anything else (`pre-wrap`, "hanging
// indent"). Absence (null) is the expected common case, not a bug -- R15
// (P2, rendered-page sampling) is the real fix for raising this past a text
// scan's ceiling.
export interface DesignIndexLayout {
  measureCh: number | null;
  textAlign: 'left' | 'center' | 'justify' | 'mixed' | null;
  preservesLineBreaks: boolean | null;
  hangingIndent: boolean | null;
  confidence: ConfidenceLevel;
}

export interface DesignIndexEntry {
  slug: string;
  name: string;
  category: string | null;
  scenario: string | null;
  family: string | null;
  tags: string[];
  palette: DesignIndexPaletteEntry[];
  typography: DesignIndexTypography;
  mood: string[];
  density: DensityLevel;
  motion_level: MotionLevel;
  layout: DesignIndexLayout;
  preview: DesignIndexPreview;
  sourceHash: string;
}

// PARKED, not omitted by oversight: F001 Addendum B says this index is
// shared with F007 and should also carry `sections[]`, `style`, and
// `theme`. None of those three has a ratified vocabulary yet --
// CROSS-CUTTING-CORRECTIONS.md's "Decisions required" #12-15 name exactly
// this gap (`grid` as a Section value unratified; Style descriptor curation
// undecided; Theme luminance thresholds unset; F007 states outright "none
// of this vocabulary exists yet"). Addendum B's own binding rule -- "any
// facet the advisor ranks on must be exposed to the filters, and any facet
// the filters expose must be rankable" -- means adding these fields here
// would mean inventing the vocabulary decision, not implementing it. Per
// F001 Addendum A.3, this branch instead ships the typesetting/layout
// fields above, which R5 does specify completely (measure, alignment,
// line-break handling) and which need no owner decision. See NOTES.md.

export interface DesignIndex {
  generatedAt: string;
  templates: DesignIndexEntry[];
}

// ---------------------------------------------------------------------------
// Palette extraction
// ---------------------------------------------------------------------------

const HEX_RE = /#[0-9A-Fa-f]{6}\b/g;

// Keyword -> role mapping for the "## COLOR PALETTE" build-spec section
// style used by the better-documented templates (see
// design-templates/almond-hours-h65/SKILL.md, "## COLOR PALETTE (EXACT)").
//
// Calibrated against every distinct label across the committed catalogue
// (`grep`-style scan over every "## COLOR..." section), not just the two
// examples the audit cited, because the two examples pull in opposite
// directions and a naive single-tier reorder that fixes one breaks the
// other:
//   - "SECONDARY WARM ACCENT" (aegis-console-h39) must resolve 'accent' --
//     SECONDARY here qualifies a real, explicitly-named accent colour.
//   - "TEXT-SECONDARY / SAGE" (citron-atlas-h79, value confirms "MUTED
//     SAGE-GREY -- BODY COPY") must resolve 'muted', not the primary text
//     colour -- this is the case the *previous* commit on this branch fixed
//     ("stop the index labelling muted greys as the primary text colour"),
//     and a same-shape catalogue label ("SECONDARY TEXT / GRAY") appears
//     elsewhere in the corpus too.
//
// Three tiers, checked in order, resolve both without regressing the other:
//
// 1. STRONG explicit role words -- naming the role unambiguously enough
//    that a co-occurring SECONDARY/SUBTLE/TERTIARY/DIM qualifier does not
//    override it (MUTED, ACCENT/CTA/HIGHLIGHT, BORDER/RULE, BACKGROUND,
//    INK). BRAND was previously grouped into this tier as an accent
//    synonym; it is a generic company-name prefix that appears on every
//    role in the corpus (BRAND BACKGROUND, BRAND BORDER, BRAND PRIMARY /
//    TEXT-PRIMARY, BRAND ACCENT, ...) and grouping it with ACCENT caused
//    many non-accent, no-real-signal labels ("BRAND DARK (CHARCOAL)") to
//    read as a confident accent match -- exactly the "unmatched labels
//    default to accent while retaining high confidence" failure named
//    alongside the SECONDARY/ACCENT swap. It is dropped rather than moved.
// 2. GENERIC qualifiers (SECONDARY, SUBTLE, TERTIARY, DIM) -- consulted only
//    when tier 1 found nothing, at 'medium' rather than 'high' confidence:
//    the label never states a role outright, this tier infers one from a
//    de-emphasis word, and that inference deserves less certainty than an
//    explicit statement even when the inference is probably right.
// 3. WEAK explicit -- bare TEXT on its own, checked last: it names a role,
//    but "TEXT-SECONDARY" and "SECONDARY TEXT" show SECONDARY overriding it
//    in real catalogue data, so it must lose to tier 2 while still beating
//    tier 4's fallback for a label that mentions TEXT and nothing else
//    (e.g. "BRAND PRIMARY / TEXT-PRIMARY").
//
// A label that matches no tier carries no real evidence for any role; it
// returns 'accent' (the least assumptive bucket) at 'low' confidence,
// never at the same confidence an actual match would carry.
const STRONG_PALETTE_LABEL_KEYWORDS: [RegExp, PaletteRole][] = [
  [/MUTED\b/i, 'muted'],
  [/ACCENT|CTA|HIGHLIGHT/i, 'accent'],
  [/BORDER|HAIRLINE|RULE|DIVIDER/i, 'rule'],
  [/PAPER|BACKGROUND|\bBG\b/i, 'background'],
  [/INK/i, 'text'],
];

const QUALIFIER_PALETTE_LABEL_KEYWORDS: [RegExp, PaletteRole][] = [
  [/SECONDARY|SUBTLE|TERTIARY|DIM\b/i, 'muted'],
];

const WEAK_PALETTE_LABEL_KEYWORDS: [RegExp, PaletteRole][] = [
  [/TEXT\b/i, 'text'],
];

interface PaletteRoleMatch {
  role: PaletteRole;
  confidence: ConfidenceLevel;
}

function roleForLabel(label: string): PaletteRoleMatch {
  for (const [re, role] of STRONG_PALETTE_LABEL_KEYWORDS) {
    if (re.test(label)) return { role, confidence: 'high' };
  }
  for (const [re, role] of QUALIFIER_PALETTE_LABEL_KEYWORDS) {
    if (re.test(label)) return { role, confidence: 'medium' };
  }
  for (const [re, role] of WEAK_PALETTE_LABEL_KEYWORDS) {
    if (re.test(label)) return { role, confidence: 'high' };
  }
  return { role: 'accent', confidence: 'low' };
}

// High-confidence path: parse a "## COLOR PALETTE" (or "## COLORS") section
// body for `- LABEL: \`#HEX\`` lines, mapping each label to a role by
// keyword. Returns null when the section heading itself is absent.
export function extractStructuredPalette(body: string): DesignIndexPaletteEntry[] | null {
  const sectionMatch = body.match(/^##\s*COLOR(S)?(\s+PALETTE)?.*$/im);
  if (!sectionMatch || sectionMatch.index === undefined) return null;
  const rest = body.slice(sectionMatch.index + sectionMatch[0].length);
  const nextHeading = rest.search(/^##\s+/m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  const entries: DesignIndexPaletteEntry[] = [];
  const seen = new Set<string>();
  for (const line of section.split(/\r?\n/)) {
    if (!/^-\s*[^:`]+:\s*`?#[0-9A-Fa-f]{6}/.test(line)) continue;
    // A palette line is not one label and one hex. Real ones carry several
    // labelled colours ("TEXT PRIMARY: #a; TEXT SECONDARY: #b") and several
    // hexes under one label (a cycling accent set). Splitting on the
    // separators first keeps each hex with the label that actually describes
    // it: taking the line's first label for everything called every secondary
    // and muted grey the primary text colour, and taking only the first hex
    // dropped 59 lines' worth of accents on the floor.
    for (const segment of line.replace(/^-\s*/, '').split(/[;.]\s+|;\s*/)) {
      const labelled = segment.match(/^\s*([^:`]+):\s*(.*)$/);
      if (!labelled) continue;
      const { role, confidence } = roleForLabel((labelled[1] ?? '').trim());
      for (const hexMatch of (labelled[2] ?? '').matchAll(/#[0-9A-Fa-f]{6}/g)) {
        const hex = hexMatch[0].toUpperCase();
        const key = `${hex}:${role}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ hex, role, provenance: segment.trim(), confidence });
      }
    }
  }
  return entries.length > 0 ? entries : null;
}

// Fallback path: every distinct hex anywhere in the document (frontmatter
// description or body), capped at 5, all tagged 'accent'/'low' because we
// have no structural evidence for a real role. R15 (P2, out of scope here)
// replaces this with rendered-page sampling.
export function extractFallbackPalette(fullText: string): DesignIndexPaletteEntry[] {
  const seen = new Set<string>();
  const entries: DesignIndexPaletteEntry[] = [];
  for (const match of fullText.matchAll(HEX_RE)) {
    const hex = match[0].toUpperCase();
    if (seen.has(hex)) continue;
    seen.add(hex);
    const lineStart = fullText.lastIndexOf('\n', match.index ?? 0) + 1;
    const lineEndIdx = fullText.indexOf('\n', match.index ?? 0);
    const provenance = fullText.slice(lineStart, lineEndIdx === -1 ? undefined : lineEndIdx).trim();
    entries.push({ hex, role: 'accent', provenance, confidence: 'low' });
    if (entries.length >= 5) break;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Typography extraction
// ---------------------------------------------------------------------------

const TYPE_LABEL_KEYWORDS: [RegExp, TypographyRole][] = [
  [/DISPLAY|HEADING/i, 'headings'],
  [/ALT|ALTERNATIVE/i, 'body_alt'],
  [/BODY/i, 'body'],
  [/NAV|LABEL|UI\b|CAPTION|EYEBROW/i, 'ui'],
];

function roleForTypeLabel(label: string): TypographyRole | null {
  for (const [re, role] of TYPE_LABEL_KEYWORDS) {
    if (re.test(label)) return role;
  }
  return null;
}

// The "- LABEL: <capture>" line shape captures everything up to the next
// `(`/`,`/end of line after a role label, which is right for a real font
// name ("PLUS JAKARTA SANS (700/800)" -> "PLUS JAKARTA SANS") but also
// matches the typesetting-prose lines that follow the same "LABEL: value,
// value, value." shape a font-pairing line uses -- "BODY: 18PX, SAGE-GREY,
// RELAXED LEADING." captures "18PX"; "DISPLAY HEADLINES: WEIGHT 400
// (NORMAL), ..." captures "WEIGHT 400". Neither is a font family. Reject
// anything that reads as a CSS size, a font-weight instruction, or a bare
// casing/weight descriptor rather than accept any alphanumeric text as a
// name -- R1's own rule is that a low-confidence field is marked, never
// silently guessed at high confidence.
const CSS_SIZE_RE = /\d\s*(PX|EM|REM|PT|VW|VH|%)\b/i;
const PURE_NUMBER_RE = /^-?\d+(\.\d+)?$/;
const WEIGHT_PREFIX_RE = /^WEIGHT\b/i;
// Words that describe size, weight, or casing rather than naming a family.
// A capture that is ENTIRELY made of these words (e.g. "SMALL", "WEIGHT
// 300", "UPPERCASE") is prose, not a name -- but a real family that happens
// to contain one of them as part of its actual name ("Inter Tight") is not
// rejected, because at least one word in the phrase isn't in this set.
const NON_FAMILY_WORDS = new Set([
  'WEIGHT', 'UPPERCASE', 'LOWERCASE', 'CAPS', 'SMALL', 'MEDIUM',
  'LARGE', 'BOLD', 'LIGHT', 'REGULAR', 'NORMAL', 'TIGHT', 'WIDE', 'RELAXED',
  'LOOSE', 'THIN', 'BLACK', 'SEMIBOLD', 'ITALIC', 'DESKTOP', 'MOBILE',
]);

export function looksLikeFontFamily(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (CSS_SIZE_RE.test(trimmed)) return false;
  if (PURE_NUMBER_RE.test(trimmed)) return false;
  if (WEIGHT_PREFIX_RE.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.every((w) => NON_FAMILY_WORDS.has(w.toUpperCase()))) return false;
  return true;
}

// High-confidence path: parse a "## TYPOGRAPHY" section for
// `- LABEL: **FONT NAME** ...` lines (design-templates/almond-hours-h65/
// SKILL.md's "## TYPOGRAPHY" section is the model). A line whose captured
// value fails looksLikeFontFamily is skipped rather than accepted -- a later
// line for the same role can still fill it in, and if none ever does,
// buildTypography's cdn_fonts fallback (low confidence) applies instead of a
// fabricated high-confidence family.
export function extractStructuredTypography(
  body: string,
): Partial<Record<TypographyRole, DesignIndexTypographyRoleValue>> {
  const sectionMatch = body.match(/^##\s*TYPOGRAPHY.*$/im);
  const result: Partial<Record<TypographyRole, DesignIndexTypographyRoleValue>> = {};
  if (!sectionMatch || sectionMatch.index === undefined) return result;
  const rest = body.slice(sectionMatch.index + sectionMatch[0].length);
  const nextHeading = rest.search(/^##\s+/m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  for (const line of section.split(/\r?\n/)) {
    const m = line.match(/^-\s*([^:]+):\s*\**([A-Za-z0-9 '&-]+?)\**(?:\s*\(|,|$)/);
    if (!m) continue;
    const role = roleForTypeLabel((m[1] ?? '').trim());
    if (!role || result[role]) continue; // first match per role wins
    const family = (m[2] ?? '').trim();
    if (!family || !looksLikeFontFamily(family)) continue;
    result[role] = { family, confidence: 'high' };
  }
  return result;
}

// Fallback path: template.json#cdn_fonts is an unordered family-name list
// with no roles (F001 §2). Positional guess only -- always 'low' confidence.
function fallbackTypographyFromCdnFonts(
  cdnFonts: string[],
): Partial<Record<TypographyRole, DesignIndexTypographyRoleValue>> {
  const result: Partial<Record<TypographyRole, DesignIndexTypographyRoleValue>> = {};
  if (cdnFonts[0]) result.headings = { family: cdnFonts[0], confidence: 'low' };
  if (cdnFonts[1]) result.body = { family: cdnFonts[1], confidence: 'low' };
  if (cdnFonts[2]) result.ui = { family: cdnFonts[2], confidence: 'low' };
  return result;
}

export function buildTypography(
  structured: Partial<Record<TypographyRole, DesignIndexTypographyRoleValue>>,
  fallback: Partial<Record<TypographyRole, DesignIndexTypographyRoleValue>>,
): DesignIndexTypography {
  const pick = (role: TypographyRole): DesignIndexTypographyRoleValue =>
    structured[role] ?? fallback[role] ?? { family: null, confidence: 'low' };
  const typography: DesignIndexTypography = {
    body: pick('body'),
    headings: pick('headings'),
    ui: pick('ui'),
  };
  const bodyAlt = structured.body_alt ?? fallback.body_alt;
  if (bodyAlt) typography.body_alt = bodyAlt;
  return typography;
}

// ---------------------------------------------------------------------------
// Mood / density / motion (best-effort heuristics -- see module doc)
// ---------------------------------------------------------------------------

export function extractMoods(description: string, tags: string[], body: string): string[] {
  const haystackHigh = `${description} ${tags.join(' ')}`.toLowerCase();
  const haystackBody = body.toLowerCase();
  const found: string[] = [];
  for (const mood of MOODS) {
    if (haystackHigh.includes(mood) || haystackBody.includes(mood)) found.push(mood);
  }
  return found;
}

const MOTION_KEYWORDS = [
  'motion', 'animate', 'animation', 'hover', 'transition', 'parallax', 'marquee',
  'scroll reveal', 'cursor',
];

export function estimateMotionLevel(body: string): MotionLevel {
  const lower = body.toLowerCase();
  const hits = MOTION_KEYWORDS.reduce((n, kw) => n + (lower.includes(kw) ? 1 : 0), 0);
  if (hits >= 7) return 'high';
  if (hits >= 3) return 'medium';
  return 'low';
}

export function estimateDensity(body: string): DensityLevel {
  const headings = (body.match(/^##\s+/gm) ?? []).length;
  if (headings >= 9) return 'high';
  if (headings >= 5) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Layout / typesetting extraction (F001 R1 Addendum A.3, scored by R5)
// ---------------------------------------------------------------------------

const MEASURE_RE = /max-width:\s*([\d.]+)\s*(ch|rem|px)\b/i;
// Addendum A.3 states the poetry archetype's own measure target both ways --
// "~62 characters (`max-width: 34rem`)" -- so 34rem == 62ch is a ratio taken
// directly from the PRD, reused here to convert any OTHER template's
// rem-expressed measure onto the same ch scale.
const REM_TO_CH = 62 / 34;
// Addendum A.3's own body size (19-21px) puts roughly 8px per character at
// typical prose weights -- used only as a coarse px->ch approximation to
// flag an unusually wide column, never to assert an exact character count.
const PX_TO_CH_DIVISOR = 8;

function measureToCh(value: number, unit: string): number | null {
  if (!Number.isFinite(value)) return null;
  const lower = unit.toLowerCase();
  if (lower === 'ch') return value;
  if (lower === 'rem') return value * REM_TO_CH;
  return value / PX_TO_CH_DIVISOR;
}

const CENTER_RE = /text-align:\s*center\b|\bcentered\b|\bcenter-align/i;
const JUSTIFY_RE = /text-align:\s*justify\b|\bjustified\b/i;
const LEFT_RE = /text-align:\s*left\b|\bleft-align/i;
const PRE_WRAP_RE = /white-space:\s*pre-wrap|\bpreserv\w*\s+line[- ]?breaks?\b/i;
const HANGING_INDENT_RE = /hanging[- ]indent/i;

export function extractLayout(body: string): DesignIndexLayout {
  const measureMatch = body.match(MEASURE_RE);
  const measureCh = measureMatch ? measureToCh(Number(measureMatch[1]), measureMatch[2] ?? 'ch') : null;

  const hasCenter = CENTER_RE.test(body);
  const hasJustify = JUSTIFY_RE.test(body);
  const hasLeft = LEFT_RE.test(body);
  const alignSignals = [hasCenter, hasJustify, hasLeft].filter(Boolean).length;
  const textAlign: DesignIndexLayout['textAlign'] =
    alignSignals === 0 ? null : alignSignals > 1 ? 'mixed' : hasCenter ? 'center' : hasJustify ? 'justify' : 'left';

  const preservesLineBreaks = PRE_WRAP_RE.test(body) ? true : null;
  const hangingIndent = HANGING_INDENT_RE.test(body) ? true : null;

  // `measureCh`/`textAlign` come from a bare text scan that cannot tell a
  // reading column's max-width/text-align from an unrelated element's, so
  // they never raise confidence above 'low' on their own. `preservesLineBreaks`/
  // `hangingIndent` use unambiguous typesetting terms -- when either is
  // found, the row overall gets 'medium'.
  const confidence: ConfidenceLevel = preservesLineBreaks || hangingIndent ? 'medium' : 'low';

  return { measureCh, textAlign, preservesLineBreaks, hangingIndent, confidence };
}

// ---------------------------------------------------------------------------
// Per-template build
// ---------------------------------------------------------------------------

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function buildEntry(slug: string): DesignIndexEntry | null {
  const dir = path.join(TEMPLATES_DIR, slug);
  const skillPath = path.join(dir, 'SKILL.md');
  if (!existsSync(skillPath)) return null;
  const skillText = readFileSync(skillPath, 'utf8');
  const parsed = parseSkillFrontmatter(skillText);

  const templateJsonPath = path.join(dir, 'template.json');
  const hasTemplateJson = existsSync(templateJsonPath);
  const templateJsonText = hasTemplateJson ? readFileSync(templateJsonPath, 'utf8') : '';
  const templateJson = hasTemplateJson
    ? (JSON.parse(templateJsonText) as { family?: string; cdn_fonts?: string[] })
    : null;

  const structuredPalette = extractStructuredPalette(skillText);
  const palette = structuredPalette ?? extractFallbackPalette(`${parsed?.description ?? ''}\n${skillText}`);

  const structuredTypography = extractStructuredTypography(skillText);
  const fallbackTypography = fallbackTypographyFromCdnFonts(templateJson?.cdn_fonts ?? []);
  const typography = buildTypography(structuredTypography, fallbackTypography);

  const examplePath = path.join(dir, 'example.html');
  const hasExampleHtml = existsSync(examplePath);

  return {
    slug,
    name: parsed?.name ?? slug,
    category: parsed?.category ?? null,
    scenario: parsed?.scenario ?? null,
    family: templateJson?.family ?? null,
    tags: parsed?.tags ?? [],
    palette,
    typography,
    mood: extractMoods(parsed?.description ?? '', parsed?.tags ?? [], skillText),
    density: estimateDensity(skillText),
    motion_level: estimateMotionLevel(skillText),
    layout: extractLayout(skillText),
    preview: {
      path: hasExampleHtml ? `design-templates/${slug}/example.html` : null,
      hasExampleHtml,
      thumbnail: null,
    },
    sourceHash: sha256Hex(`${skillText}\u0000${templateJsonText}`),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const slugs = readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const templates: DesignIndexEntry[] = [];
  for (const slug of slugs) {
    const entry = buildEntry(slug);
    if (entry) templates.push(entry);
  }

  const index: DesignIndex = { generatedAt: new Date().toISOString(), templates };
  writeFileSync(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${templates.length} rows to ${path.relative(ROOT, INDEX_PATH)}`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
