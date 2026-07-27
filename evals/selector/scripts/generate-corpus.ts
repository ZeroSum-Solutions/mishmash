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
// Non-sealed case output goes straight into the repo tree under
// evals/selector/corpus/{snapshots,ir}/. Sealed case output goes to the
// out-of-repo scratchpad handoff directory instead -- this script never
// writes sealed plaintext into the repo tree, and never touches the seal
// key. The orchestrator encrypts the handoff payload and commits the .enc
// blobs at the intended paths recorded in manifest.json.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CORPUS_DIR = path.join(REPO_ROOT, 'evals', 'selector', 'corpus');
const SNAPSHOTS_DIR = path.join(CORPUS_DIR, 'snapshots');
const IR_DIR = path.join(CORPUS_DIR, 'ir');
const HANDOFF_DIR = '/private/tmp/claude-501/-Users-zero-suminc-/44bcd43c-59a3-443b-ab8b-25629d40a9ab/scratchpad/w7-sealed-handoff';

type DirectiveAxis = 'layout' | 'motion' | 'palette' | 'typography' | 'section' | 'interaction';
type LayoutSystem = 'css-grid-first' | 'flex-utility' | 'absolute-canvas';
type Genre = 'marketing' | 'ecommerce' | 'docs' | 'app-dashboard';
type Breakpoint = 'mobile' | 'desktop';

interface SnapshotNode {
  nodeId: string;
  domPath: string;
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
// meaningful across sources within a case.
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
  { color: '#4a3a0e', backgroundColor: '#fbf5e9', fontFamily: 'PT Serif, serif' },
  { color: '#0e4a3a', backgroundColor: '#e9fbf5', fontFamily: 'Sora, sans-serif' },
  { color: '#3a4a0e', backgroundColor: '#f5fbe9', fontFamily: 'Rubik, sans-serif' },
  { color: '#4a0e3a', backgroundColor: '#fbe9f5', fontFamily: 'Barlow, sans-serif' },
  { color: '#0e1a4a', backgroundColor: '#e9edfb', fontFamily: 'Epilogue, sans-serif' },
];

type SourceLayoutKind = 'grid' | 'flex' | 'absolute';

interface RoleSpec {
  role: string;
  isContainer: boolean; // container role carries the layout-system-defining display/position value
}

const ROLES: RoleSpec[] = [
  { role: 'header', isContainer: false },
  { role: 'hero', isContainer: false },
  { role: 'hero-heading', isContainer: false },
  { role: 'features', isContainer: true },
  { role: 'feature-item-1', isContainer: false },
  { role: 'feature-item-2', isContainer: false },
  { role: 'cta', isContainer: false },
  { role: 'footer', isContainer: false },
];

// Only display/position -- the two properties LAYOUT_SYSTEM_EVIDENCE in
// verify-w7.ts actually checks. Decorative extras (gridTemplateColumns,
// flexDirection) were dropped: with only 3 possible layoutKinds shared
// across many sources, a longer fixed value combination pushed the
// genuinely-identical span (independent of any source-specific byte) past
// 64 bytes even sandwiched between unique sourceTag/color fields, which is
// exactly the collision class the leak-scan fixes above are closing.
function containerStyleFor(kind: SourceLayoutKind): Record<string, string> {
  if (kind === 'grid') return { display: 'grid' };
  if (kind === 'flex') return { display: 'flex' };
  return { display: 'block', position: 'absolute' };
}

interface SourceSpec {
  id: string;
  layoutKind: SourceLayoutKind;
  presetIndex: number;
  extraNodes?: number; // for the hostile-heavy-dom degenerate case
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
  sealed: boolean;
  // directiveInventory, minus the phantom-scope case which is special-cased below
  directives: Array<{ axis: DirectiveAxis; source: string; role: string; strength: number }>;
}

const AXIS_ROLE: Record<DirectiveAxis, string> = {
  layout: 'features',
  motion: 'cta',
  palette: 'header',
  typography: 'hero-heading',
  section: 'features',
  interaction: 'cta',
};

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
    sealed: false,
    directives: [
      { axis: 'layout', source: 'mkt-grid-a', role: 'features', strength: 0.9 },
      { axis: 'layout', source: 'mkt-flex-b', role: 'features', strength: 0.6 },
      { axis: 'palette', source: 'mkt-flex-b', role: 'header', strength: 0.8 },
      { axis: 'typography', source: 'mkt-grid-a', role: 'hero-heading', strength: 0.7 },
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
    sealed: false,
    directives: [
      { axis: 'palette', source: 'ecom-flex-a', role: 'header', strength: 0.85 },
      { axis: 'palette', source: 'ecom-grid-b', role: 'header', strength: 0.5 },
      { axis: 'motion', source: 'ecom-grid-b', role: 'cta', strength: 0.6 },
      { axis: 'section', source: 'ecom-flex-a', role: 'features', strength: 0.7 },
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
    sealed: false,
    directives: [
      { axis: 'typography', source: 'dash-abs-a', role: 'hero-heading', strength: 0.9 },
      { axis: 'typography', source: 'dash-grid-b', role: 'hero-heading', strength: 0.55 },
      { axis: 'interaction', source: 'dash-abs-a', role: 'cta', strength: 0.75 },
      { axis: 'layout', source: 'dash-abs-a', role: 'features', strength: 0.8 },
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
    sealed: false,
    directives: [
      { axis: 'section', source: 'docs-flex-a', role: 'features', strength: 0.8 },
      { axis: 'section', source: 'docs-grid-b', role: 'features', strength: 0.45 },
      { axis: 'layout', source: 'docs-flex-a', role: 'features', strength: 0.65 },
      { axis: 'palette', source: 'docs-grid-b', role: 'header', strength: 0.6 },
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
    sealed: false,
    directives: [
      { axis: 'layout', source: 'blog-grid-a', role: 'features', strength: 0.85 },
      { axis: 'palette', source: 'blog-flex-b', role: 'header', strength: 0.7 },
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
    sealed: false,
    directives: [
      { axis: 'layout', source: 'land-solo-a', role: 'features', strength: 0.8 },
      { axis: 'palette', source: 'land-solo-a', role: 'header', strength: 0.6 },
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
    sealed: false,
    directives: [
      { axis: 'layout', source: 'phantom-grid-a', role: 'features', strength: 0.75 },
      { axis: 'typography', source: 'phantom-grid-a', role: 'hero-heading', strength: 0.65 },
    ],
    // the phantom (unresolvable) directive is appended separately below, on
    // a DIFFERENT axis ('palette') so it never collides with the two real
    // claims above and never manufactures a false 2-claimant "conflict" on
    // an axis this case does not declare one for.
  },
  {
    id: 'hostile-heavy-dom-catalog',
    genre: 'app-dashboard',
    layoutSystem: 'absolute-canvas',
    sources: [
      { id: 'hostile-abs-a', layoutKind: 'absolute', presetIndex: 13, extraNodes: 50 },
      { id: 'hostile-grid-b', layoutKind: 'grid', presetIndex: 14, extraNodes: 50 },
    ],
    breakpoints: ['mobile', 'desktop'],
    conflict: null,
    degenerate: 'hostile-heavy-dom',
    skip: null,
    sealed: false,
    directives: [
      { axis: 'layout', source: 'hostile-abs-a', role: 'features', strength: 0.7 },
      { axis: 'interaction', source: 'hostile-grid-b', role: 'cta', strength: 0.55 },
    ],
  },
  {
    id: 'sealed-marketing-alt',
    genre: 'marketing',
    layoutSystem: 'flex-utility',
    sources: [
      { id: 'sealed-mkt-a', layoutKind: 'flex', presetIndex: 15 },
      { id: 'sealed-mkt-b', layoutKind: 'grid', presetIndex: 16 },
    ],
    breakpoints: ['mobile', 'desktop'],
    conflict: null,
    degenerate: null,
    skip: null,
    sealed: true,
    directives: [
      { axis: 'layout', source: 'sealed-mkt-a', role: 'features', strength: 0.8 },
      { axis: 'palette', source: 'sealed-mkt-b', role: 'header', strength: 0.65 },
    ],
  },
  {
    id: 'sealed-docs-widget',
    genre: 'docs',
    layoutSystem: 'absolute-canvas',
    sources: [
      { id: 'sealed-docs-a', layoutKind: 'absolute', presetIndex: 17 },
      { id: 'sealed-docs-b', layoutKind: 'grid', presetIndex: 18 },
    ],
    breakpoints: ['mobile', 'desktop'],
    conflict: null,
    degenerate: null,
    skip: null,
    sealed: true,
    directives: [
      { axis: 'typography', source: 'sealed-docs-a', role: 'hero-heading', strength: 0.7 },
      { axis: 'interaction', source: 'sealed-docs-b', role: 'cta', strength: 0.6 },
    ],
  },
];

function sha256(bytes: Buffer | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// COMPACT (no indentation), not pretty-printed. Nothing downstream cares
// about whitespace -- verify-w7.ts only ever JSON.parse()s these files --
// but pretty-printing pads every record with ~10-15 lines of pure
// indentation/punctuation between field values, which is exactly the kind
// of long, byte-identical, content-free span that let generic (non-secret)
// JSON structure alone satisfy a 64-byte leak-scan window (see the C7-11
// commits above this one for the multi-round story). Compact JSON packs
// every field value up against its neighbors, so any 64-byte window
// necessarily includes multiple field values -- and nearly every field value in this
// corpus (nodeId, domPath, sourceTag, elementId, sourceId, case-tagged
// constraint/variantAxes text) is source- or case-specific.
function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

// nodeId is BREAKPOINT-SPECIFIC (a capture is a per-breakpoint session, even
// though the DOM structure -- domPath -- is the same element across
// viewports). This matters mechanically: a resolver checking the full
// (nodeId, domPath, breakpoint) triple must be defeatable by deranging ANY
// ONE field independently, including breakpoint alone -- which requires the
// SAME domPath to have genuinely DIFFERENT nodeIds at different breakpoints,
// or a breakpoint-only derangement has nothing to break (the node would
// still validly exist, just "at the wrong breakpoint" in name only).
function buildSourceNodes(source: SourceSpec, breakpoint: Breakpoint): SnapshotNode[] {
  const preset = STYLE_PRESETS[source.presetIndex % STYLE_PRESETS.length]!;
  // computedStyle's FIRST key is always source-id-tagged (a plausible real
  // custom-property-style marker, not just filler) and its LAST keys are
  // always the source's unique color/background/font preset. Only the
  // MIDDLE (a container's layout properties -- display/position/etc, drawn
  // from just 3 fixed possibilities shared by many sources) can ever be
  // byte-identical to another source's; bookending it with unique content
  // on both sides bounds how long any purely-shared run can get, closing
  // the same >64-byte collision class the case-tagging fix closed for
  // constraints/variantAxes above (see that comment for the full story).
  const nodes: SnapshotNode[] = ROLES.map((r) => {
    const style: Record<string, string> = { sourceTag: source.id };
    if (r.isContainer) Object.assign(style, containerStyleFor(source.layoutKind));
    Object.assign(style, { color: preset.color, backgroundColor: preset.backgroundColor, fontFamily: preset.fontFamily });
    return {
      nodeId: `${source.id}-${r.role}-${breakpoint}`,
      domPath: `body > div.${source.id}-shell > ${r.role.replace(/-/g, '_')}.${source.id}-${r.role}`,
      computedStyle: style,
    };
  });
  const extra = source.extraNodes ?? 0;
  for (let i = 0; i < extra; i++) {
    nodes.push({
      nodeId: `${source.id}-list-item-${i}-${breakpoint}`,
      domPath: `body > div.${source.id}-shell > section.${source.id}-catalog > div.${source.id}-item-${i}`,
      computedStyle: { sourceTag: source.id, display: 'block', color: preset.color, backgroundColor: preset.backgroundColor, fontFamily: preset.fontFamily },
    });
  }
  return nodes;
}

function main(): void {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  fs.mkdirSync(IR_DIR, { recursive: true });
  fs.rmSync(HANDOFF_DIR, { recursive: true, force: true });
  fs.mkdirSync(HANDOFF_DIR, { recursive: true });

  const manifestCases: unknown[] = [];
  const handoffManifestLines: string[] = [];
  let sealedCount = 0;

  for (const c of CASES) {
    // nodesBySourceByBp[sourceId][breakpoint] -- see buildSourceNodes for
    // why nodeId must vary per breakpoint even though domPath does not.
    const nodesBySourceByBp: Record<string, Partial<Record<Breakpoint, SnapshotNode[]>>> = {};
    for (const s of c.sources) {
      nodesBySourceByBp[s.id] = {};
      for (const bp of c.breakpoints) nodesBySourceByBp[s.id]![bp] = buildSourceNodes(s, bp);
    }
    // Flat, breakpoint-agnostic view (by domPath) used only for the
    // sourceSlots evidence-pointer listing and the phantom-scope check --
    // domPath itself is identical across breakpoints, so any one
    // breakpoint's list is representative for domPath enumeration.
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
        if (c.sealed) {
          const handoffRel = `${c.id}/${s.id}-${bp}.json`;
          fs.mkdirSync(path.join(HANDOFF_DIR, c.id), { recursive: true });
          fs.writeFileSync(path.join(HANDOFF_DIR, handoffRel), content);
          handoffManifestLines.push(`${handoffRel}\tsha256=${hash}\tintended-repo-path=${relPath}.enc`);
          snapshots[bp] = { path: `${relPath}.enc`, sha256: hash, viewportWidth: VIEWPORTS[bp] };
        } else {
          const abs = path.join(REPO_ROOT, relPath);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, content);
          snapshots[bp] = { path: relPath, sha256: hash, viewportWidth: VIEWPORTS[bp] };
        }
      }
      sourcesOut.push({ id: s.id, snapshots });
    }

    // --- directiveInventory ---------------------------------------------
    const directiveInventory = c.directives.map((d) => ({
      axis: d.axis,
      source: d.source,
      scope: `body > div.${d.source}-shell > ${AXIS_ROLE[d.axis].replace(/-/g, '_')}.${d.source}-${AXIS_ROLE[d.axis]}`,
      strength: d.strength,
    }));
    if (c.degenerate === 'nonexistent-element-directive') {
      const phantomSource = c.sources[1]!.id;
      directiveInventory.push({
        axis: 'palette',
        source: phantomSource,
        scope: `body > div.${phantomSource}-shell > section.${phantomSource}-nonexistent-widget-xyz`,
        strength: 0.5,
      });
    }

    // --- IR ---------------------------------------------------------------
    // Every text field below that is not intrinsically case-specific (constraint
    // rules, variant-axis distance-metric descriptions) has the case id folded
    // in. This is not cosmetic: two sealed cases and eight non-sealed cases all
    // sharing byte-IDENTICAL boilerplate prose would give verify-w7.ts C7-11's
    // content-window leak scanner nothing but false positives to report (a
    // 64-byte window of shared schema prose, not an actual secret, "matching"
    // across every file) -- folding the case id into otherwise-generic text
    // keeps every file's byte content genuinely distinct without changing its
    // meaning.
    // evidencePointers is a compact "<domPath>@<breakpoint>" string array,
    // not an array of {domPath,breakpoint} objects -- the repeated object
    // shape (same two key names, same indentation, at this nesting depth)
    // produced a >64-byte run of PURE JSON structural boilerplate between
    // consecutive entries, with no case-specific byte anywhere in it,
    // regardless of what the field VALUES were. A flat string array's
    // between-element glue is short enough (~12 bytes) that any 64-byte
    // window necessarily dips into a domPath value, which is source-id-
    // prefixed and therefore case-specific from its first character.
    const sourceSlots = c.sources.map((s) => ({
      id: s.id,
      breakpoints: c.breakpoints,
      evidencePointers: c.breakpoints.flatMap((bp) => nodesBySource[s.id]!.map((n) => `${n.domPath}@${bp}`)),
    }));

    // Field VALUES (not just a prefix) carry the case id throughout -- a
    // case-id-only prefix still leaves a >64-byte IDENTICAL suffix ("no
    // container overlap..."), which is exactly the kind of window the leak
    // scanner would flag. Keeping every value short (well under 64 bytes)
    // and case-tagged from the first character means no 64-byte window can
    // land entirely inside a value, and the JSON structural glue between
    // fields (key names, punctuation, indentation) is itself under 64 bytes
    // per gap, so a window spanning it always dips into case-specific text.
    // Full prose lives in docs/specs/selector-composition-ir.md's "Constraints"
    // section (the shared, canonical description); each IR instance embeds
    // only a short case-tagged reference token. Kept deliberately under ~40
    // bytes total (well inside the 64-byte leak-scan window) so the WHOLE
    // value -- not just a prefix -- differs by case; a longer shared prose
    // suffix (tried in an earlier round) still collided past the case-id tag.
    const constraints = [
      { type: `${c.id}#grid-integrity`, rule: `${c.id}#no-overlap-at-any-breakpoint` },
      { type: `${c.id}#contrast-minimum`, rule: `${c.id}#wcag-aa-4.5-1-contrast` },
      { type: `${c.id}#responsive-behavior`, rule: `${c.id}#styled-at-every-breakpoint` },
    ];

    // conflictResolution: one entry per axis present in directiveInventory.
    // Axes with a single claimant get a trivial entry (winner only); the
    // declared conflict axis gets winner+loser+rationale.
    // Same short-token, case-id-woven-throughout rationale for the SAME
    // leak-scan reason as constraints/variantAxes above -- a fixed English
    // sentence with the varying source names only interpolated once still
    // leaves a >64-byte shared suffix ("axis in this case; no contention to
    // resolve.", "takes precedence per the frozen corpus ground truth for
    // this case.") that collided across cases even after the first
    // case-tagging pass.
    const axesPresent = [...new Set(directiveInventory.map((d) => d.axis))];
    const conflictResolution = axesPresent.map((axis) => {
      if (c.conflict && c.conflict.axis === axis) {
        return {
          axis,
          winningSource: c.conflict.winningSource,
          losingSource: c.conflict.losingSource,
          losingClaim: `${c.id}#${axis}#lost:${c.conflict.losingSource}`,
          rationale: `${c.id}#${axis}#won:${c.conflict.winningSource}#lost:${c.conflict.losingSource}`,
        };
      }
      const claimants = [...new Set(directiveInventory.filter((d) => d.axis === axis).map((d) => d.source))];
      return { axis, winningSource: claimants[0]!, rationale: `${c.id}#${axis}#sole-claimant:${claimants[0]}` };
    });

    // provenance: one resolvable entry per directiveInventory claim whose
    // scope corresponds to a REAL captured node. The phantom claim (if any)
    // deliberately gets no provenance entry -- there is no real evidence to
    // point at, which is the entire point of the degenerate case. Breakpoint
    // is ALTERNATED across entries (not a single hardcoded value) -- every
    // role node exists at every declared breakpoint, so this stays
    // resolvable, and it is what makes a breakpoint-only field derangement
    // control constructible at all (a uniform breakpoint value across every
    // entry has no fixed-point-free permutation).
    const provenance: Array<{ elementId: string; sourceId: string; nodeId: string; domPath: string; breakpoint: string }> = [];
    let provenanceIndex = 0;
    for (const [i, d] of directiveInventory.entries()) {
      const bp = c.breakpoints[provenanceIndex % c.breakpoints.length]!;
      const node = nodesBySourceByBp[d.source]?.[bp]?.find((n) => n.domPath === d.scope);
      if (!node) continue; // phantom / unresolvable claim -- no provenance manufactured
      provenanceIndex++;
      provenance.push({ elementId: `${c.id}-di-${i}-${d.axis}`, sourceId: d.source, nodeId: node.nodeId, domPath: node.domPath, breakpoint: bp });
    }

    // Same case-id-tagging rationale as constraints above; the canonical,
    // shared prose descriptions of these four axes live in
    // evals/selector/diversity-axes.json (frozen once, referenced here) --
    // duplicating that exact prose into every IR instance is both redundant
    // and (per the comment above) a leak-scan false-positive generator.
    const variantAxes = [
      { name: `${c.id}#layout-skeleton`, distanceMetric: `${c.id}#jaccard-domPath-set` },
      { name: `${c.id}#section-order`, distanceMetric: `${c.id}#position-diff-scope-order` },
      { name: `${c.id}#motion-timeline`, distanceMetric: `${c.id}#position-diff-motionSignature` },
      { name: `${c.id}#breakpoint-behavior`, distanceMetric: `${c.id}#position-diff-breakpoint` },
    ];

    const ir = { sourceSlots, directives: directiveInventory, constraints, conflictResolution, provenance, variantAxes };
    const irContent = canonicalJson(ir);
    const irHash = sha256(irContent);
    const irRelPath = `evals/selector/corpus/ir/${c.id}.json`;
    let irManifestPath: string;
    if (c.sealed) {
      fs.mkdirSync(path.join(HANDOFF_DIR, c.id), { recursive: true });
      fs.writeFileSync(path.join(HANDOFF_DIR, `${c.id}/ir.json`), irContent);
      handoffManifestLines.push(`${c.id}/ir.json\tsha256=${irHash}\tintended-repo-path=${irRelPath}.enc`);
      irManifestPath = `${irRelPath}.enc`;
      sealedCount++;
    } else {
      const abs = path.join(REPO_ROOT, irRelPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, irContent);
      irManifestPath = irRelPath;
    }

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
      sealed: c.sealed,
      irPath: irManifestPath,
      irSha256: irHash,
    });
  }

  const sealedFraction = Math.round((sealedCount / CASES.length) * 1000) / 1000;
  const manifest = { version: 1, sealedFraction, cases: manifestCases };
  const manifestContent = canonicalJson(manifest);
  fs.writeFileSync(path.join(CORPUS_DIR, 'manifest.json'), manifestContent);

  fs.writeFileSync(
    path.join(HANDOFF_DIR, 'MANIFEST.txt'),
    [
      '# W7 sealed-corpus handoff manifest',
      '#',
      '# Each line: <plaintext file relative to this dir>\\tsha256=<hex>\\tintended-repo-path=<repo-relative .enc path>',
      '#',
      '# COMMIT ORDER (required by verify-w7.ts C7-2/C7-11 F18 ordering rules):',
      '#   1. Encrypt each plaintext file (AES-256-CBC, openssl enc -pbkdf2, seal.key) to its',
      '#      intended-repo-path and commit ALL .enc blobs (one or more commits is fine).',
      '#   2. THEN commit evals/selector/SEALED-ACCESS.md (draft alongside this manifest) as the',
      '#      final "seal commit" -- verify-w7.ts resolves the seal commit as the latest commit',
      '#      touching that path.',
      '#   3. After the seal commit, make ZERO further commits touching any of the .enc paths',
      '#      below (the frozen-path invariant; a legitimate re-seal needs a NEW seal commit and',
      '#      a founder decision record, not a same-seal-era touch).',
      '#',
      ...handoffManifestLines,
    ].join('\n') + '\n',
  );

  console.log(`generated ${manifestCases.length} cases (${sealedCount} sealed, fraction=${sealedFraction})`);
  console.log(`manifest: ${path.join(CORPUS_DIR, 'manifest.json')}`);
  console.log(`handoff:  ${HANDOFF_DIR}`);
}

main();
