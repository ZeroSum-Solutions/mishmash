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
  preview: DesignIndexPreview;
  sourceHash: string;
}

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
// First keyword match wins; unmatched labels fall back to 'accent'.
const PALETTE_LABEL_KEYWORDS: [RegExp, PaletteRole][] = [
  [/PAPER|BACKGROUND|\bBG\b/i, 'background'],
  [/INK|TEXT\b/i, 'text'],
  [/MUTED|SECONDARY|SUBTLE/i, 'muted'],
  [/BORDER|HAIRLINE|RULE|DIVIDER/i, 'rule'],
  [/ACCENT|CTA|HIGHLIGHT|BRAND/i, 'accent'],
];

function roleForLabel(label: string): PaletteRole {
  for (const [re, role] of PALETTE_LABEL_KEYWORDS) {
    if (re.test(label)) return role;
  }
  return 'accent';
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
  for (const line of section.split(/\r?\n/)) {
    const m = line.match(/^-\s*([^:`]+):\s*`?(#[0-9A-Fa-f]{6})/);
    if (!m) continue;
    const label = (m[1] ?? '').trim();
    const hex = (m[2] ?? '').toUpperCase();
    entries.push({ hex, role: roleForLabel(label), provenance: line.trim(), confidence: 'high' });
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

// High-confidence path: parse a "## TYPOGRAPHY" section for
// `- LABEL: **FONT NAME** ...` lines (design-templates/almond-hours-h65/
// SKILL.md's "## TYPOGRAPHY" section is the model).
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
    if (!family) continue;
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
