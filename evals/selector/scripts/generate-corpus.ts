// generate-corpus.ts -- deterministic, pinned corpus generator for W7.
//
// Not product code: this is eval-fixture tooling (PRD S7-2 explicitly allows
// hand-authored "minimal-but-real HTML/CSS snapshot fixtures where a live
// capture adds nothing"). It runs ONCE, locally, and its OUTPUT (snapshot
// JSON + IR JSON + manifest.json) is what gets committed and pinned -- the
// corpus does not depend on this script running again, and does not depend
// on any live site. Kept under evals/selector/scripts/ (inside the W7 lease)
// for reproducibility and so a reviewer can see exactly how every hash and
// every "real" computedStyle value was derived.
//
// Run: pnpm exec tsx evals/selector/scripts/generate-corpus.ts
//
// v3 (deliverable-review fix round 1): ONLY generates the 8 NON-SEALED
// cases. sealed-marketing-alt / sealed-docs-widget are frozen forever (the
// orchestrator will not re-seal again -- see the round-1 review response)
// -- their manifest.json sub-objects are spliced back in VERBATIM from the
// currently-committed manifest by splicePreservedSealedCases() below, never
// regenerated, never touched. Genre-specific role vocabularies, captured
// state, snapshot identity, directive-level breakpoints, and per-constraint
// predicates are new in v3 and apply to non-sealed cases only -- the schema
// (docs/specs/selector-composition-ir.schema.json) treats all of it as
// additive/optional so the sealed cases' v1-shape IR still validates.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CORPUS_DIR = path.join(REPO_ROOT, 'evals', 'selector', 'corpus');
const SNAPSHOTS_DIR = path.join(CORPUS_DIR, 'snapshots');
const IR_DIR = path.join(CORPUS_DIR, 'ir');
const MANIFEST_PATH = path.join(CORPUS_DIR, 'manifest.json');
const BRIEFS_DIR = path.join(CORPUS_DIR, 'briefs');

type DirectiveAxis = 'layout' | 'motion' | 'palette' | 'typography' | 'section' | 'interaction';
type LayoutSystem = 'css-grid-first' | 'flex-utility' | 'absolute-canvas';
type Genre = 'marketing' | 'ecommerce' | 'docs' | 'app-dashboard';
type Breakpoint = 'mobile' | 'desktop';
type CapturedState = 'default' | 'hover' | 'scrolled' | 'loaded';

interface SnapshotNode {
  nodeId: string;
  domPath: string;
  state: CapturedState;
  computedStyle: Record<string, string>;
}
interface SnapshotDoc {
  nodes: SnapshotNode[];
  viewportWidth: number;
}

interface StylePreset {
  color: string;
  backgroundColor: string;
  fontFamily: string;
}

const VIEWPORTS: Record<Breakpoint, number> = { mobile: 390, desktop: 1440 };

// Deterministic style presets, one per source, cycled by index. Distinct
// presets are what makes source-bleed fingerprinting (color+background+font)
// meaningful across sources within a case. Only 8 non-sealed sources need
// indices now (sealed sources keep their own, preserved, hashes).
const STYLE_PRESETS: StylePreset[] = [
  { color: '#1a1a2e', backgroundColor: '#f5f5fa', fontFamily: 'Inter, sans-serif' },
  { color: '#2d1b00', backgroundColor: '#fff4e0', fontFamily: 'Georgia, serif' },
  { color: '#0b3d2e', backgroundColor: '#e6f7f0', fontFamily: 'Roboto, sans-serif' },
  { color: '#3a0ca3', backgroundColor: '#f0e9ff', fontFamily: 'Space Grotesk, sans-serif' },
  { color: '#7a1f1f', backgroundColor: '#fdeaea', fontFamily: 'Merriweather, serif' },
  { color: '#123c69', backgroundColor: '#e8f1fb', fontFamily: 'IBM Plex Sans, sans-serif' },
  { color: '#4d2600', backgroundColor: '#fff0d9', fontFamily: 'Source Serif Pro, serif' },
  { color: '#00332e', backgroundColor: '#e3fbf7', fontFamily: 'Manrope, sans-serif' },
  { color: '#331433', backgroundColor: '#f9e9f9', fontFamily: 'Nunito Sans, sans-serif' },
  { color: '#264d00', backgroundColor: '#f0f9e0', fontFamily: 'Fira Sans, sans-serif' },
  { color: '#1c1c1c', backgroundColor: '#f2f2f2', fontFamily: 'Work Sans, sans-serif' },
  { color: '#4a0e0e', backgroundColor: '#fbeaea', fontFamily: 'Lora, serif' },
  { color: '#0e2a4a', backgroundColor: '#e9f1fb', fontFamily: 'DM Sans, sans-serif' },
  { color: '#2a0e4a', backgroundColor: '#f1e9fb', fontFamily: 'Karla, sans-serif' },
];

type SourceLayoutKind = 'grid' | 'flex' | 'absolute';

interface RoleSpec {
  role: string;
  isContainer: boolean; // carries the layout-system-defining display/position value; gets a 'scrolled' state capture too
  isMotionTarget: boolean; // gets a transitionDuration + a 'hover' state capture
}

// F6 (both review lanes, REJECT): genres were the same eight-role template
// relabeled. Each genre now has its OWN role vocabulary (different
// component names, different information architecture) -- a marketing page
// does not have a "reviews panel" and a docs page does not have a
// "price-badge". Only the STRUCTURAL slots every case needs (a container
// that carries layout evidence, a motion/interaction target) are held in
// common, via the isContainer/isMotionTarget flags, not the role names.
const GENRE_ROLES: Record<Genre, RoleSpec[]> = {
  marketing: [
    { role: 'hero', isContainer: false, isMotionTarget: false },
    { role: 'headline', isContainer: false, isMotionTarget: false },
    { role: 'subheadline', isContainer: false, isMotionTarget: false },
    { role: 'testimonial', isContainer: false, isMotionTarget: false },
    { role: 'features-grid', isContainer: true, isMotionTarget: false },
    { role: 'pricing-cta', isContainer: false, isMotionTarget: true },
    { role: 'footer-nav', isContainer: false, isMotionTarget: false },
  ],
  ecommerce: [
    { role: 'product-gallery', isContainer: false, isMotionTarget: false },
    { role: 'product-title', isContainer: false, isMotionTarget: false },
    { role: 'price-badge', isContainer: false, isMotionTarget: false },
    { role: 'reviews-panel', isContainer: true, isMotionTarget: false },
    { role: 'size-selector', isContainer: false, isMotionTarget: false },
    { role: 'add-to-cart', isContainer: false, isMotionTarget: true },
    { role: 'shipping-footer', isContainer: false, isMotionTarget: false },
  ],
  docs: [
    { role: 'sidebar-nav', isContainer: false, isMotionTarget: false },
    { role: 'breadcrumb-trail', isContainer: false, isMotionTarget: false },
    { role: 'article-title', isContainer: false, isMotionTarget: false },
    { role: 'code-sample', isContainer: false, isMotionTarget: false },
    { role: 'callout-box', isContainer: false, isMotionTarget: false },
    { role: 'toc-panel', isContainer: true, isMotionTarget: false },
    { role: 'edit-link', isContainer: false, isMotionTarget: true },
  ],
  'app-dashboard': [
    { role: 'nav-rail', isContainer: false, isMotionTarget: false },
    { role: 'metric-tile', isContainer: false, isMotionTarget: false },
    { role: 'chart-panel', isContainer: true, isMotionTarget: false },
    { role: 'data-grid', isContainer: false, isMotionTarget: false },
    { role: 'filter-controls', isContainer: false, isMotionTarget: true },
    { role: 'alert-banner', isContainer: false, isMotionTarget: false },
    { role: 'user-menu', isContainer: false, isMotionTarget: false },
  ],
};

// Which role each directive axis addresses, per genre -- the axis
// vocabulary (layout/motion/palette/typography/section/interaction) is
// shared and frozen (schema enum), but WHICH component realizes each axis
// is genre-specific, same as a real design system.
const AXIS_ROLE_BY_GENRE: Record<Genre, Record<DirectiveAxis, string>> = {
  marketing: { layout: 'features-grid', motion: 'pricing-cta', palette: 'hero', typography: 'headline', section: 'features-grid', interaction: 'pricing-cta' },
  ecommerce: { layout: 'reviews-panel', motion: 'add-to-cart', palette: 'price-badge', typography: 'product-title', section: 'reviews-panel', interaction: 'add-to-cart' },
  docs: { layout: 'toc-panel', motion: 'edit-link', palette: 'callout-box', typography: 'article-title', section: 'toc-panel', interaction: 'edit-link' },
  'app-dashboard': { layout: 'chart-panel', motion: 'filter-controls', palette: 'metric-tile', typography: 'alert-banner', section: 'chart-panel', interaction: 'data-grid' },
};

// Sol-N1/Grok-N1: motion_timing must validate motionSignature against REAL
// snapshot-derived transition evidence, not an arbitrary free-form label.
// The convention: a motion-target role's default-state computedStyle
// carries a real `transitionDuration`; the ONLY valid motionSignature for an
// element resolving to that node is the literal string
// `transition:<transitionDuration>`. Deterministic per source (derived from
// its preset index), not a shared constant, so it is genuinely per-source
// evidence, not a corpus-wide password.
function transitionDurationFor(presetIndex: number): string {
  const ms = 120 + (presetIndex % 6) * 40; // 120ms.. 320ms, deterministic
  return `${ms}ms`;
}
function motionSignatureFor(presetIndex: number): string {
  return `transition:${transitionDurationFor(presetIndex)}`;
}

function containerStyleFor(kind: SourceLayoutKind): Record<string, string> {
  if (kind === 'grid') return { display: 'grid' };
  if (kind === 'flex') return { display: 'flex' };
  return { display: 'block', position: 'absolute' };
}

interface SourceSpec {
  id: string;
  layoutKind: SourceLayoutKind;
  presetIndex: number;
  extraCatalogItems?: number; // for the hostile-heavy-dom degenerate case
}

interface DirectiveSpec {
  axis: DirectiveAxis;
  source: string;
  role: string; // 'features-grid' etc for role-scoped, or 'catalog:<i>' for a hostile-dom catalog item
  strength: number;
}

interface CaseSpec {
  id: string;
  genre: Genre;
  layoutSystem: LayoutSystem;
  sources: SourceSpec[];
  breakpoints: Breakpoint[];
  conflict: { axis: DirectiveAxis; winningSource: string; losingSource: string } | null;
  degenerate: 'single-source' | 'nonexistent-element-directive' | 'hostile-heavy-dom' | null;
  skip: { reason: 'login-walled' | 'bot-walled'; target: string } | null;
  directives: DirectiveSpec[];
  brief: string; // F2: independent-in-process NL brief, hand-written, NOT derived from `directives` above
}

const CORPUS_VERSION = 3;

// F2 (both lanes REJECT): each case's directiveInventory must be grounded in
// an independent artifact. `brief` below is written FIRST, in free natural
// language a real user might type, deliberately NOT as a template over
// {axis,source,role} tuples -- contrast blog-content-grid's brief prose with
// its `directives` array below and the correspondence is legible but not
// mechanical. See evals/selector/CORPUS.md's "brief grounding" table for the
// explicit brief-sentence -> directiveInventory-entry trace, and the
// standing limitation this does NOT resolve (same author for both
// artifacts, unlike a real independent-user brief) stated there plainly.
const CASES: CaseSpec[] = [
  {
    id: 'marketing-hero-grid',
    genre: 'marketing',
    layoutSystem: 'css-grid-first',
    sources: [
      { id: 'mkt-grid-a', layoutKind: 'grid', presetIndex: 0 },
      { id: 'mkt-flex-b', layoutKind: 'flex', presetIndex: 1 },
    ],
    breakpoints: ['mobile', 'desktop'],
    conflict: { axis: 'layout', winningSource: 'mkt-grid-a', losingSource: 'mkt-flex-b' },
    degenerate: null,
    skip: null,
    brief:
      "I want the grid features layout from mkt-grid-a -- mkt-flex-b has its own features layout too but I don't want that one, mkt-grid-a's should win. " +
      "For the rest: use mkt-flex-b's colour palette on the hero, and keep mkt-grid-a's headline typography as-is.",
    directives: [
      { axis: 'layout', source: 'mkt-grid-a', role: 'features-grid', strength: 0.9 },
      { axis: 'layout', source: 'mkt-flex-b', role: 'features-grid', strength: 0.6 },
      { axis: 'palette', source: 'mkt-flex-b', role: 'hero', strength: 0.8 },
      { axis: 'typography', source: 'mkt-grid-a', role: 'headline', strength: 0.7 },
    ],
  },
  {
    id: 'ecommerce-product-flex',
    genre: 'ecommerce',
    layoutSystem: 'flex-utility',
    sources: [
      { id: 'ecom-flex-a', layoutKind: 'flex', presetIndex: 2 },
      { id: 'ecom-grid-b', layoutKind: 'grid', presetIndex: 3 },
    ],
    breakpoints: ['mobile', 'desktop'],
    conflict: { axis: 'palette', winningSource: 'ecom-flex-a', losingSource: 'ecom-grid-b' },
    degenerate: null,
    skip: null,
    brief:
      "Use ecom-flex-a's colour palette on the price badge -- I looked at ecom-grid-b's price styling too but I'm going with ecom-flex-a's. " +
      "Also carry over ecom-grid-b's add-to-cart button motion, keep ecom-flex-a's reviews panel section structure and overall layout, and use " +
      "ecom-grid-b's product title typography.",
    // 6 directives (even count) -- see the breakpoint-derangement comment on
    // `directiveInventory` below for why an EVEN count matters mechanically,
    // not just for richness.
    directives: [
      { axis: 'palette', source: 'ecom-flex-a', role: 'price-badge', strength: 0.85 },
      { axis: 'palette', source: 'ecom-grid-b', role: 'price-badge', strength: 0.5 },
      { axis: 'motion', source: 'ecom-grid-b', role: 'add-to-cart', strength: 0.6 },
      { axis: 'section', source: 'ecom-flex-a', role: 'reviews-panel', strength: 0.7 },
      { axis: 'layout', source: 'ecom-flex-a', role: 'reviews-panel', strength: 0.55 },
      { axis: 'typography', source: 'ecom-grid-b', role: 'product-title', strength: 0.6 },
    ],
  },
  {
    id: 'dashboard-canvas-widgets',
    genre: 'app-dashboard',
    layoutSystem: 'absolute-canvas',
    sources: [
      { id: 'dash-abs-a', layoutKind: 'absolute', presetIndex: 4 },
      { id: 'dash-grid-b', layoutKind: 'grid', presetIndex: 5 },
    ],
    breakpoints: ['mobile', 'desktop'],
    conflict: { axis: 'typography', winningSource: 'dash-abs-a', losingSource: 'dash-grid-b' },
    degenerate: null,
    skip: null,
    brief:
      "Use dash-abs-a's typography on the alert banner -- dash-grid-b had its own competing type treatment there that I'm not choosing. " +
      "Carry over dash-abs-a's data-grid interaction behaviour too, and its chart panel layout.",
    directives: [
      { axis: 'typography', source: 'dash-abs-a', role: 'alert-banner', strength: 0.9 },
      { axis: 'typography', source: 'dash-grid-b', role: 'alert-banner', strength: 0.55 },
      { axis: 'interaction', source: 'dash-abs-a', role: 'data-grid', strength: 0.75 },
      { axis: 'layout', source: 'dash-abs-a', role: 'chart-panel', strength: 0.8 },
    ],
  },
  {
    id: 'docs-api-reference',
    genre: 'docs',
    layoutSystem: 'flex-utility',
    sources: [
      { id: 'docs-flex-a', layoutKind: 'flex', presetIndex: 6 },
      { id: 'docs-grid-b', layoutKind: 'grid', presetIndex: 7 },
    ],
    breakpoints: ['mobile', 'desktop'],
    conflict: { axis: 'section', winningSource: 'docs-flex-a', losingSource: 'docs-grid-b' },
    degenerate: null,
    skip: null,
    brief:
      "I like docs-flex-a's table-of-contents section structure best -- docs-grid-b organizes its TOC differently and I don't want that version. " +
      "Use docs-flex-a's overall layout too, and pull the callout box colours from docs-grid-b.",
    directives: [
      { axis: 'section', source: 'docs-flex-a', role: 'toc-panel', strength: 0.8 },
      { axis: 'section', source: 'docs-grid-b', role: 'toc-panel', strength: 0.45 },
      { axis: 'layout', source: 'docs-flex-a', role: 'toc-panel', strength: 0.65 },
      { axis: 'palette', source: 'docs-grid-b', role: 'callout-box', strength: 0.6 },
    ],
  },
  {
    id: 'blog-content-grid',
    genre: 'marketing',
    layoutSystem: 'css-grid-first',
    sources: [
      { id: 'blog-grid-a', layoutKind: 'grid', presetIndex: 8 },
      { id: 'blog-flex-b', layoutKind: 'flex', presetIndex: 9 },
    ],
    breakpoints: ['mobile', 'desktop'],
    conflict: null,
    degenerate: null,
    skip: null,
    brief: "Use blog-grid-a's features grid layout, and blog-flex-b's hero colour palette. No conflicts here, just those two picks.",
    directives: [
      { axis: 'layout', source: 'blog-grid-a', role: 'features-grid', strength: 0.85 },
      { axis: 'palette', source: 'blog-flex-b', role: 'hero', strength: 0.7 },
    ],
  },
  {
    id: 'single-source-landing',
    genre: 'marketing',
    layoutSystem: 'flex-utility',
    sources: [{ id: 'land-solo-a', layoutKind: 'flex', presetIndex: 10 }],
    breakpoints: ['mobile', 'desktop'],
    conflict: null,
    degenerate: 'single-source',
    skip: { reason: 'bot-walled', target: 'https://example-walled-admin.test/dashboard (Cloudflare-challenged second reference the user asked for; single-source capture proceeded and this skip is recorded rather than silently ignored)' },
    brief: "Just use land-solo-a for the layout and colour palette. I wanted a second reference to compare against but that site wouldn't let the crawler in.",
    directives: [
      { axis: 'layout', source: 'land-solo-a', role: 'features-grid', strength: 0.8 },
      { axis: 'palette', source: 'land-solo-a', role: 'hero', strength: 0.6 },
    ],
  },
  {
    id: 'phantom-element-directive',
    genre: 'ecommerce',
    layoutSystem: 'css-grid-first',
    sources: [
      { id: 'phantom-grid-a', layoutKind: 'grid', presetIndex: 11 },
      { id: 'phantom-flex-b', layoutKind: 'flex', presetIndex: 12 },
    ],
    breakpoints: ['mobile', 'desktop'],
    conflict: null,
    degenerate: 'nonexistent-element-directive',
    skip: null,
    brief:
      "Use phantom-grid-a's reviews panel layout and its product title typography. Also grab the colour palette from phantom-flex-b's promo ribbon " +
      "banner -- the one that runs across the top of the page above the nav.",
    directives: [
      { axis: 'layout', source: 'phantom-grid-a', role: 'reviews-panel', strength: 0.75 },
      { axis: 'typography', source: 'phantom-grid-a', role: 'product-title', strength: 0.65 },
    ],
    // "promo ribbon" from the brief has no corresponding role anywhere in
    // GENRE_ROLES.ecommerce -- the user asked for something that was never
    // captured, which is exactly the degenerate case. Appended below on a
    // separate axis ('palette') so it never collides with a real claim.
  },
  {
    id: 'hostile-heavy-dom-catalog',
    genre: 'app-dashboard',
    layoutSystem: 'absolute-canvas',
    sources: [
      { id: 'hostile-abs-a', layoutKind: 'absolute', presetIndex: 13, extraCatalogItems: 50 },
      { id: 'hostile-grid-b', layoutKind: 'grid', presetIndex: 0, extraCatalogItems: 50 },
    ],
    breakpoints: ['mobile', 'desktop'],
    conflict: null,
    degenerate: 'hostile-heavy-dom',
    skip: null,
    brief:
      "This dashboard has a huge data table -- use hostile-abs-a's chart panel layout and hostile-grid-b's data-grid interaction. " +
      "For the styling, carry over the look of the first ten rows of BOTH catalogs (hostile-abs-a and hostile-grid-b) -- those set the visual tone " +
      "for the rest of the table, row by row, alternating which source's row styling wins.",
    // Grok-N5: provenance/directives must be PROPORTIONAL to the node-count
    // claim, not 2 claims regardless of size. Generated programmatically
    // below (10 catalog rows x 2 sources = 20 additional claims, cycling
    // through the 6 directive axes) so the "first ten rows of both
    // catalogs" sentence in the brief above has real referents.
    directives: [
      { axis: 'layout', source: 'hostile-abs-a', role: 'chart-panel', strength: 0.7 },
      { axis: 'interaction', source: 'hostile-grid-b', role: 'data-grid', strength: 0.55 },
      ...Array.from({ length: 10 }, (_, i) => ({
        axis: (['palette', 'typography', 'motion', 'section', 'palette', 'typography'] as DirectiveAxis[])[i % 6]!,
        source: i % 2 === 0 ? 'hostile-abs-a' : 'hostile-grid-b',
        role: `catalog:${i}`,
        strength: 0.4 + (i % 5) * 0.1,
      })),
    ],
  },
];

function sha256(bytes: Buffer | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// COMPACT (no indentation) -- see CORPUS.md's re-freeze history for why.
function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function domPathFor(sourceId: string, role: string): string {
  if (role.startsWith('catalog:')) {
    const i = role.slice('catalog:'.length);
    return `body > div.${sourceId}-shell > section.${sourceId}-catalog > div.${sourceId}-item-${i}`;
  }
  return `body > div.${sourceId}-shell > ${role.replace(/-/g, '_')}.${sourceId}-${role}`;
}

// nodeId is BREAKPOINT-SPECIFIC (a capture is a per-breakpoint session, even
// though domPath -- the structural path -- is the same element across
// viewports); this is what makes C7-4's breakpoint-only field-derangement
// control constructible at all (see the round-1 corpus fix history).
// state-specific nodes (hover/scrolled) get their OWN nodeId too, tagged
// with the state, and share the SAME domPath+breakpoint as the default
// capture -- multiple real, distinct captures of the same element.
function buildSourceNodes(genre: Genre, source: SourceSpec, breakpoint: Breakpoint): SnapshotNode[] {
  const preset = STYLE_PRESETS[source.presetIndex % STYLE_PRESETS.length]!;
  const roles = GENRE_ROLES[genre];
  const nodes: SnapshotNode[] = [];
  for (const r of roles) {
    const domPath = domPathFor(source.id, r.role);
    const baseStyle: Record<string, string> = { sourceTag: source.id };
    if (r.isContainer) Object.assign(baseStyle, containerStyleFor(source.layoutKind));
    if (r.isMotionTarget) baseStyle['transitionDuration'] = transitionDurationFor(source.presetIndex);
    Object.assign(baseStyle, { color: preset.color, backgroundColor: preset.backgroundColor, fontFamily: preset.fontFamily });
    nodes.push({ nodeId: `${source.id}-${r.role}-${breakpoint}-default`, domPath, state: 'default', computedStyle: baseStyle });

    // Grok-N7: captured-state, enumerated and genuinely exercised (not just
    // declared in the schema) -- a motion-target role gets a real 'hover'
    // capture (shorter transition, distinct from default), and the layout
    // container gets a real 'scrolled' capture (position becomes sticky on
    // top of whatever the layoutKind already set, a real scroll-lock
    // pattern) -- 'loaded' is enumerated in the schema/spec but not
    // captured by this corpus; see docs/specs/selector-composition-ir.md.
    if (r.isMotionTarget) {
      const hoverStyle = { ...baseStyle, transitionDuration: `${Math.max(60, parseInt(transitionDurationFor(source.presetIndex), 10) - 60)}ms` };
      nodes.push({ nodeId: `${source.id}-${r.role}-${breakpoint}-hover`, domPath, state: 'hover', computedStyle: hoverStyle });
    }
    if (r.isContainer) {
      const scrolledStyle = { ...baseStyle, position: 'sticky' };
      nodes.push({ nodeId: `${source.id}-${r.role}-${breakpoint}-scrolled`, domPath, state: 'scrolled', computedStyle: scrolledStyle });
    }
  }
  const extra = source.extraCatalogItems ?? 0;
  for (let i = 0; i < extra; i++) {
    nodes.push({
      nodeId: `${source.id}-list-item-${i}-${breakpoint}-default`,
      domPath: domPathFor(source.id, `catalog:${i}`),
      state: 'default',
      computedStyle: { sourceTag: source.id, display: 'block', color: preset.color, backgroundColor: preset.backgroundColor, fontFamily: preset.fontFamily },
    });
  }
  return nodes;
}

// F2 grounding table + a light sanity check that the brief at least
// mentions every REAL source id it makes claims about (a cheap, honest,
// mechanical floor under the hand-written independence -- not a substitute
// for the human trace table in CORPUS.md).
function assertBriefMentionsSources(c: CaseSpec): void {
  for (const s of c.sources) {
    if (!c.brief.includes(s.id)) throw new Error(`case ${c.id}: brief does not mention source id "${s.id}" -- grounding check failed`);
  }
}

function assertBreakpointRotationDerangeable(caseId: string, breakpoints: string[]): void {
  const n = breakpoints.length;
  if (n < 2) return; // C7-4 skips derangement construction below n=2 anyway
  for (let shift = 1; shift < n; shift++) {
    const rotated = breakpoints.map((_, i) => breakpoints[(i + shift) % n]!);
    if (rotated.every((v, i) => v !== breakpoints[i])) return; // found a fixed-point-free rotation
  }
  throw new Error(`case ${caseId}: provenance breakpoint sequence [${breakpoints.join(',')}] admits NO fixed-point-free rotation -- C7-4's breakpoint-only derangement control would be unconstructible`);
}

function main(): void {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  fs.mkdirSync(IR_DIR, { recursive: true });
  fs.mkdirSync(BRIEFS_DIR, { recursive: true });

  // Preserve the 2 sealed cases' manifest sub-objects VERBATIM -- read them
  // from whatever is currently committed before this run touches anything.
  const existingManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as { cases: Array<{ id: string; sealed: boolean }> };
  const preservedSealedCases = existingManifest.cases.filter((c) => c.sealed);
  if (preservedSealedCases.length !== 2) throw new Error(`expected exactly 2 preserved sealed cases in the existing manifest, found ${preservedSealedCases.length}`);

  const manifestCases: unknown[] = [];

  for (const c of CASES) {
    assertBriefMentionsSources(c);
    fs.writeFileSync(path.join(BRIEFS_DIR, `${c.id}.md`), `${c.brief}\n`);

    const nodesBySourceByBp: Record<string, Partial<Record<Breakpoint, SnapshotNode[]>>> = {};
    for (const s of c.sources) {
      nodesBySourceByBp[s.id] = {};
      for (const bp of c.breakpoints) nodesBySourceByBp[s.id]![bp] = buildSourceNodes(c.genre, s, bp);
    }
    const nodesBySource: Record<string, SnapshotNode[]> = {};
    for (const s of c.sources) nodesBySource[s.id] = nodesBySourceByBp[s.id]![c.breakpoints[0]!]!;

    // --- snapshots -----------------------------------------------------
    const sourcesOut: Array<{ id: string; snapshots: Record<string, { path: string; sha256: string; viewportWidth: number }> }> = [];
    for (const s of c.sources) {
      const snapshots: Record<string, { path: string; sha256: string; viewportWidth: number }> = {};
      for (const bp of c.breakpoints) {
        const doc: SnapshotDoc = { nodes: nodesBySourceByBp[s.id]![bp]!, viewportWidth: VIEWPORTS[bp] };
        const content = canonicalJson(doc);
        const hash = sha256(content);
        const relPath = `evals/selector/corpus/snapshots/${c.id}/${s.id}/${bp}.json`;
        const abs = path.join(REPO_ROOT, relPath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
        snapshots[bp] = { path: relPath, sha256: hash, viewportWidth: VIEWPORTS[bp] };
      }
      sourcesOut.push({ id: s.id, snapshots });
    }

    // --- directiveInventory (breakpoint alternated per entry; Sol-N4/coord
    // item 7: directive-level breakpoint scoping) -------------------------
    const directiveInventory = c.directives.map((d, i) => ({
      axis: d.axis,
      source: d.source,
      scope: domPathFor(d.source, d.role),
      strength: d.strength,
      breakpoint: c.breakpoints[i % c.breakpoints.length]!,
    }));
    if (c.degenerate === 'nonexistent-element-directive') {
      const phantomSource = c.sources[1]!.id;
      directiveInventory.push({
        axis: 'palette',
        source: phantomSource,
        scope: `body > div.${phantomSource}-shell > section.${phantomSource}-promo-ribbon`,
        strength: 0.5,
        breakpoint: c.breakpoints[0]!,
      });
    }

    // --- IR ---------------------------------------------------------------
    const sourceSlots = c.sources.map((s) => ({
      id: s.id,
      snapshotIdentity: `${s.id}-capture-v${CORPUS_VERSION}`,
      breakpoints: c.breakpoints,
      evidencePointers: c.breakpoints.flatMap((bp) => nodesBySourceByBp[s.id]![bp]!.map((n) => `${n.domPath}@${bp}@${n.state}`)),
    }));

    const constraints = [
      { type: `${c.id}#grid-integrity`, rule: `${c.id}#no-overlap-at-any-breakpoint`, predicate: { property: 'display', pattern: '^(grid|flex|block)$' } },
      { type: `${c.id}#contrast-minimum`, rule: `${c.id}#wcag-aa-4.5-1-contrast`, predicate: { property: 'color', pattern: '^#[0-9a-fA-F]{6}$' } },
      { type: `${c.id}#responsive-behavior`, rule: `${c.id}#styled-at-every-breakpoint`, predicate: { property: 'display', pattern: '.+' } },
    ];

    const axesPresent = [...new Set(directiveInventory.map((d) => d.axis))];
    const conflictResolution = axesPresent.map((axis) => {
      if (c.conflict && c.conflict.axis === axis) {
        return {
          axis,
          winningSource: c.conflict.winningSource,
          losingSource: c.conflict.losingSource,
          losingClaim: `${c.id}#${axis}#lost:${c.conflict.losingSource}`,
          rationale: `${c.id}#${axis}#won:${c.conflict.winningSource}#lost:${c.conflict.losingSource}`,
          // Coordinator item 7: scope-overlap semantics for conflict
          // grouping, as an IR-SPEC-level clarification -- NOT a change to
          // resolve-conflicts.ts's actual grouping algorithm (dual-APPROVED
          // under F4, left untouched). Every conflict in this corpus is two
          // claims on the SAME axis whose scopes point at each source's own
          // (different) node for the SAME semantic role -- overlap is
          // role-level, not string-identical domPath.
          scopeOverlap: 'same-role-different-source',
        };
      }
      const claimants = [...new Set(directiveInventory.filter((d) => d.axis === axis).map((d) => d.source))];
      return { axis, winningSource: claimants[0]!, rationale: `${c.id}#${axis}#sole-claimant:${claimants[0]}`, scopeOverlap: 'single-claimant' };
    });

    const provenance: Array<{ elementId: string; sourceId: string; nodeId: string; domPath: string; breakpoint: string }> = [];
    for (const [i, d] of directiveInventory.entries()) {
      const node = nodesBySourceByBp[d.source]?.[d.breakpoint as Breakpoint]?.find((n) => n.domPath === d.scope && n.state === 'default');
      if (!node) continue; // phantom / unresolvable claim -- no provenance manufactured
      provenance.push({ elementId: `${c.id}-di-${i}-${d.axis}`, sourceId: d.source, nodeId: node.nodeId, domPath: node.domPath, breakpoint: d.breakpoint });
    }
    // verify-w7.ts C7-4's breakpoint-only derangement control needs a
    // fixed-point-free ROTATION of provenance[].breakpoint to exist -- with
    // only 2 breakpoint values, an ODD-length provenance array where one
    // value has a majority (e.g. 3-of-5) can make that mathematically
    // impossible (verified by brute force; see the generator commit history
    // for the ecommerce-product-flex repro). Assert it at generation time so
    // a future edit that reintroduces the imbalance fails loudly here, not
    // silently until the gate runs.
    assertBreakpointRotationDerangeable(c.id, provenance.map((p) => p.breakpoint));

    const variantAxes = [
      { name: `${c.id}#layout-skeleton`, distanceMetric: `${c.id}#jaccard-domPath-set` },
      { name: `${c.id}#section-order`, distanceMetric: `${c.id}#position-diff-scope-order` },
      { name: `${c.id}#motion-timeline`, distanceMetric: `${c.id}#position-diff-motionSignature` },
      { name: `${c.id}#breakpoint-behavior`, distanceMetric: `${c.id}#position-diff-breakpoint` },
    ];

    const ir = { corpusVersion: CORPUS_VERSION, sourceSlots, directives: directiveInventory, constraints, conflictResolution, provenance, variantAxes };
    const irContent = canonicalJson(ir);
    const irHash = sha256(irContent);
    const irRelPath = `evals/selector/corpus/ir/${c.id}.json`;
    const irAbs = path.join(REPO_ROOT, irRelPath);
    fs.mkdirSync(path.dirname(irAbs), { recursive: true });
    fs.writeFileSync(irAbs, irContent);

    manifestCases.push({
      id: c.id,
      genre: c.genre,
      layoutSystem: c.layoutSystem,
      breakpoints: c.breakpoints,
      sources: sourcesOut,
      directiveInventory,
      conflict: c.conflict,
      degenerate: c.degenerate,
      skip: c.skip,
      sealed: false,
      irPath: irRelPath,
      irSha256: irHash,
    });
  }

  // Splice the 2 preserved sealed cases back in, byte-for-byte from the
  // manifest as it existed before this run -- never regenerated.
  for (const sealedCase of preservedSealedCases) manifestCases.push(sealedCase);

  const sealedFraction = Math.round((preservedSealedCases.length / manifestCases.length) * 1000) / 1000;
  const manifest = { version: CORPUS_VERSION, sealedFraction, cases: manifestCases };
  fs.writeFileSync(MANIFEST_PATH, canonicalJson(manifest));

  console.log(`generated ${CASES.length} non-sealed cases + preserved ${preservedSealedCases.length} sealed cases (fraction=${sealedFraction})`);
  console.log(`manifest: ${MANIFEST_PATH}`);
  console.log(`briefs:   ${BRIEFS_DIR}`);
}

main();
