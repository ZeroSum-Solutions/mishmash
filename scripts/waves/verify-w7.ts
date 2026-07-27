// verify-w7.ts -- wave W7 (selector foundations: spec + grader) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w7.ts
//
// W7 ships zero product code -- its deliverable is a specification (the
// composition IR + JSON Schema), a frozen eval corpus, and a grader shipped
// as tested code under evals/selector/. This verifier is also the place
// that DEFINES the file-layout contract those deliverables must land at,
// since nothing under docs/specs/ or evals/ exists yet. Every path below is
// stated in its criterion's assertion string, not just in this comment, so
// the implementing agent can grep the assertions and build to the gate.
//
// Anti-gaming posture (VERIFICATION-CONTRACT.md S3), revised after round-1
// adversarial review (round1-verify-w7.json, 15 HIGH + 2 MED, all fixed
// here): wherever a criterion names a specific gaming vector, this verifier
// (a) constructs the adversarial input ITSELF from real corpus data at run
// time and calls the implementer's exported functions on it -- not trusting
// implementer-authored fixtures for the load-bearing evidence -- and (b)
// still requires implementer unit tests / fixtures as an ADDITIONAL, non-
// load-bearing check. A "population" fixture that reaches the scorer is
// first blinded down to a minimal schema {caseId, composition} so a label
// field (fixtureKind/expected/marker) can never influence the score.
//
// Gate self-integrity (F1): this file's own sha256 is recorded in every
// manifest. Once an approval round writes
// ~/.claude/goal-state/mishmash-w7-selector-foundations/approved-gate.sha256,
// every later run hard-fails if this file no longer matches that hash --
// closing the hole where an implementation commit could rewrite the
// verifier to record unconditional passes (the lease legitimately allows
// W7 to touch this file, so R9 alone cannot catch that).
//
// Held-out sealing (F11): sealed cases' IR/snapshot payloads are committed
// ONLY as AES-256-CBC blobs (openssl, key at
// ~/.claude/goal-state/mishmash-w7-selector-foundations/seal.key, outside
// the repo). The verifier decrypts to a proof-dir temp file, hash-checks
// against the plaintext hash recorded in the manifest, and separately scans
// every git-tracked file under evals/ for accidental plaintext leakage.
//
// Exit code: 0 only when every criterion is "pass" or "blocked-on-founder"
// (R7: a wave must be able to reach "all mechanical criteria green, N
// founder items pending" without a person) AND the tree is clean. Any
// "fail" or a dirty tree forces non-zero, unconditionally.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const WAVE_SLUG = 'mishmash-w7-selector-foundations';
const goalStateDir = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG);
const proofDir = path.join(goalStateDir, 'proof');
fs.mkdirSync(proofDir, { recursive: true });

function sh(cmd: string, args: string[], cwd: string = repoRoot): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60_000 });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function abs(rel: string): string {
  return path.join(repoRoot, rel);
}

function exists(rel: string): boolean {
  return fs.existsSync(abs(rel));
}

function readText(rel: string): string | null {
  try {
    return fs.readFileSync(abs(rel), 'utf8');
  } catch {
    return null;
  }
}

function readJson<T>(rel: string): T | null {
  const text = readText(rel);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function sha256File(rel: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(abs(rel))).digest('hex');
  } catch {
    return null;
  }
}

function sha256Buffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  function sort(v: unknown): unknown {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v as object)) throw new Error('cannot stably stringify a cyclic structure');
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(sort);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sort((v as Record<string, unknown>)[k]);
    return out;
  }
  return JSON.stringify(sort(value));
}

function sha256Of(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

async function importEvalModule(rel: string): Promise<{ ok: true; mod: Record<string, unknown> } | { ok: false; error: string }> {
  if (!exists(rel)) return { ok: false, error: `module not found: ${rel}` };
  try {
    const mod = (await import(pathToFileURL(abs(rel)).href + `?t=${Date.now()}`)) as Record<string, unknown>;
    return { ok: true, mod };
  } catch (error) {
    return { ok: false, error: `import threw: ${(error as Error).stack ?? String(error)}` };
  }
}

// --- result plumbing -------------------------------------------------------

interface CriterionResult {
  id: string;
  command: string;
  assertion: string;
  artifact: string | null;
  artifactSha256: string | null;
  exitCode: number;
  status: 'pass' | 'fail' | 'blocked-on-founder';
  durationMs: number;
  detail?: string | undefined;
}

const results: CriterionResult[] = [];

// F16: artifactFor/record must never throw. A write failure falls back to a
// different path, then to a fully in-memory hash if even that fails -- the
// catch path in probe() calls record() again on failure, so record() itself
// recursing into the same failing writer would crash the whole run.
function artifactFor(id: string, content: string): { artifact: string | null; artifactSha256: string } {
  const primary = path.join(proofDir, `${id}.txt`);
  try {
    fs.writeFileSync(primary, content);
    return { artifact: primary, artifactSha256: crypto.createHash('sha256').update(content).digest('hex') };
  } catch {
    // fall through to fallback path
  }
  try {
    const fallbackDir = path.join(os.tmpdir(), `verify-w7-fallback-${process.pid}`);
    fs.mkdirSync(fallbackDir, { recursive: true });
    const fallback = path.join(fallbackDir, `${id}-${Date.now()}.txt`);
    fs.writeFileSync(fallback, content);
    return { artifact: fallback, artifactSha256: crypto.createHash('sha256').update(content).digest('hex') };
  } catch {
    // last resort: no artifact written to disk, but the hash is still real
    // and the manifest write still succeeds.
    return { artifact: null, artifactSha256: crypto.createHash('sha256').update(content).digest('hex') };
  }
}

function record(
  id: string,
  command: string,
  assertion: string,
  status: 'pass' | 'fail' | 'blocked-on-founder',
  evidence: string,
  startedAt: number,
  detail?: string,
): void {
  const { artifact, artifactSha256 } = artifactFor(
    id,
    `# ${id}\n# assertion: ${assertion}\n# verdict: ${status}\n${detail ? `# detail: ${detail}\n` : ''}\n${evidence}\n`,
  );
  results.push({
    id,
    command,
    assertion,
    artifact,
    artifactSha256,
    exitCode: status === 'fail' ? 1 : 0,
    status,
    durationMs: Date.now() - startedAt,
    detail,
  });
}

// Every probe is wrapped so a thrown exception becomes a recorded "fail",
// never a crashed process. record() itself is now failure-safe (F16), so
// this catch path can never recurse into the same failing writer.
async function probe(id: string, command: string, assertion: string, fn: () => Promise<{ ok: boolean; evidence: string; detail?: string | undefined }>): Promise<void> {
  const startedAt = Date.now();
  try {
    const { ok, evidence, detail } = await fn();
    record(id, command, assertion, ok ? 'pass' : 'fail', evidence, startedAt, detail);
  } catch (error) {
    record(id, command, assertion, 'fail', `probe threw: ${(error as Error).stack ?? String(error)}`, startedAt, 'probe crashed instead of failing cleanly');
  }
}

// --- minimal JSON Schema interpreter (subset) ------------------------------
// Supports: type, required, properties, items, enum, minItems, minLength,
// minimum, maximum, pattern.
type JsonSchema = Record<string, unknown>;

function validateAgainstSchema(schema: JsonSchema, data: unknown, at = '$'): string[] {
  const errors: string[] = [];
  const type = schema['type'];
  if (typeof type === 'string') {
    const actual = data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data;
    const expected = type === 'integer' ? 'number' : type;
    if (actual !== expected) errors.push(`${at}: expected type ${type}, got ${actual}`);
  }
  if (Array.isArray(schema['enum']) && !(schema['enum'] as unknown[]).some((v) => stableStringify(v) === stableStringify(data))) {
    errors.push(`${at}: value not in enum`);
  }
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const required = schema['required'];
    if (Array.isArray(required)) {
      for (const key of required as string[]) {
        if (!(key in obj)) errors.push(`${at}: missing required property "${key}"`);
      }
    }
    const properties = schema['properties'];
    if (properties && typeof properties === 'object') {
      for (const [key, subSchema] of Object.entries(properties as Record<string, JsonSchema>)) {
        if (key in obj) errors.push(...validateAgainstSchema(subSchema, obj[key], `${at}.${key}`));
      }
    }
  }
  if (Array.isArray(data)) {
    const minItems = schema['minItems'];
    if (typeof minItems === 'number' && data.length < minItems) errors.push(`${at}: expected >= ${minItems} items, got ${data.length}`);
    const items = schema['items'];
    if (items && typeof items === 'object') {
      data.forEach((el, i) => errors.push(...validateAgainstSchema(items as JsonSchema, el, `${at}[${i}]`)));
    }
  }
  if (typeof data === 'string') {
    const minLength = schema['minLength'];
    if (typeof minLength === 'number' && data.length < minLength) errors.push(`${at}: string shorter than minLength ${minLength}`);
    const pattern = schema['pattern'];
    if (typeof pattern === 'string' && !new RegExp(pattern).test(data)) errors.push(`${at}: does not match pattern ${pattern}`);
  }
  if (typeof data === 'number') {
    const minimum = schema['minimum'];
    if (typeof minimum === 'number' && data < minimum) errors.push(`${at}: below minimum ${minimum}`);
    const maximum = schema['maximum'];
    if (typeof maximum === 'number' && data > maximum) errors.push(`${at}: above maximum ${maximum}`);
  }
  return errors;
}

// --- corpus manifest contract ----------------------------------------------
// evals/selector/corpus/manifest.json -- the machine-readable corpus index.
// Shape mandated here (restated in each criterion's assertion string):
//
// interface DirectiveClaim { axis: DirectiveAxis; source: string; scope: string; strength: number }
// interface SnapshotRef { path: string; sha256: string; viewportWidth: number }
//   -- for a sealed case, `path` MUST end in `.enc` (AES-256-CBC blob) and
//      `sha256` is still the PLAINTEXT content hash, checked post-decrypt.
// interface CorpusSource { id: string; snapshots: Record<breakpoint, SnapshotRef> }
// interface CorpusCase {
//   id: string; genre: one of ALLOWED_GENRES; layoutSystem: one of ALLOWED_LAYOUT_SYSTEMS;
//   breakpoints: string[]; sources: CorpusSource[];
//   directiveInventory: DirectiveClaim[];   // ground truth: what the case's brief actually asks for
//   conflict: { axis; winningSource; losingSource } | null;
//   degenerate: 'single-source' | 'nonexistent-element-directive' | 'hostile-heavy-dom' | null;
//   skip: { reason: 'login-walled' | 'bot-walled'; target: string } | null;
//   sealed: boolean;
//   irPath: string;      // for a sealed case, MUST end in `.enc`
//   irSha256: string;    // plaintext IR content hash, always
// }
// interface CorpusManifest { version: number; sealedFraction: number; cases: CorpusCase[] }

const DIRECTIVE_AXES = ['layout', 'motion', 'palette', 'typography', 'section', 'interaction'] as const;
type DirectiveAxis = (typeof DIRECTIVE_AXES)[number];
const ALLOWED_LAYOUT_SYSTEMS = ['css-grid-first', 'flex-utility', 'absolute-canvas'] as const;
const ALLOWED_GENRES = ['marketing', 'ecommerce', 'docs', 'app-dashboard'] as const;

interface DirectiveClaim {
  axis: string;
  source: string;
  scope: string;
  strength: number;
}
interface SnapshotRef {
  path: string;
  sha256: string;
  viewportWidth: number;
}
interface CorpusSource {
  id: string;
  snapshots: Record<string, SnapshotRef>;
}
interface CorpusCase {
  id: string;
  genre: string;
  layoutSystem: string;
  breakpoints: string[];
  sources: CorpusSource[];
  directiveInventory: DirectiveClaim[];
  conflict: { axis: string; winningSource: string; losingSource: string } | null;
  degenerate: 'single-source' | 'nonexistent-element-directive' | 'hostile-heavy-dom' | null;
  skip: { reason: 'login-walled' | 'bot-walled'; target: string } | null;
  sealed: boolean;
  irPath: string;
  irSha256: string;
}
interface CorpusManifest {
  version: number;
  sealedFraction: number;
  cases: CorpusCase[];
}

const MANIFEST_PATH = 'evals/selector/corpus/manifest.json';
const CORPUS_MD_PATH = 'evals/selector/CORPUS.md';
const IR_SPEC_PATH = 'docs/specs/selector-composition-ir.md';
const IR_SCHEMA_PATH = 'docs/specs/selector-composition-ir.schema.json';
const FLOORS_PATH = 'evals/selector/floors.json';
const EVAL_MANIFEST_PATH = 'evals/selector/eval-manifest.json';
const SCORER_INDEX_PATH = 'evals/selector/scorer/index.ts';
const SOURCE_BLEED_PATH = 'evals/selector/scorer/source-bleed.ts';
const SOURCE_BLEED_TEST_PATH = 'evals/selector/tests/source-bleed.test.ts';
const DIVERSITY_PATH = 'evals/selector/scorer/diversity.ts';
const DIVERSITY_TEST_PATH = 'evals/selector/tests/diversity.test.ts';
const DIVERSITY_AXES_PATH = 'evals/selector/diversity-axes.json';
const PROVENANCE_RESOLVE_PATH = 'evals/selector/scorer/provenance-resolve.ts';
const RESOLVE_CONFLICTS_PATH = 'evals/selector/scorer/resolve-conflicts.ts';
const SEALED_ACCESS_PATH = 'evals/selector/SEALED-ACCESS.md';
const NL_GOLDENS_PATH = 'evals/selector/nl-to-ir/goldens.json';
const NL_PARSER_PATH = 'evals/selector/nl-to-ir/parser.ts';
const SPIKE_DOC_PATH = 'docs/specs/selector-feasibility-spike.md';
const GO_NO_GO_PATH = 'docs/specs/selector-go-no-go.md';
const POPULATION_DIR = 'evals/selector/fixtures/population';
const DIRECTIVE_FIXTURES_DIR = 'evals/selector/fixtures/directive-coverage';
const COUNTERFACTUAL_DIR = 'evals/selector/fixtures/counterfactual';
const DETERMINISM_FIXTURE_PATH = 'evals/selector/fixtures/determinism/input.json';

const SEAL_KEY_PATH = path.join(goalStateDir, 'seal.key');
const APPROVED_GATE_SHA_PATH = path.join(goalStateDir, 'approved-gate.sha256');

const REQUIRED_IR_TOP_KEYS = ['sourceSlots', 'directives', 'constraints', 'conflictResolution', 'provenance', 'variantAxes'];
const REQUIRED_PROVENANCE_ENTRY_KEYS = ['elementId', 'sourceId', 'nodeId', 'domPath', 'breakpoint'];
const REQUIRED_AXES = [
  'layout_geometry',
  'palette_fidelity',
  'type_fidelity',
  'motion_timing',
  'section_identity',
  'responsiveness',
  'broken_assets',
  'a11y',
  'source_bleed',
  'structural_variant_diversity',
  'directive_claim_coverage',
] as const;

function loadManifest(): { manifest: CorpusManifest | null; error: string | null } {
  if (!exists(MANIFEST_PATH)) return { manifest: null, error: `${MANIFEST_PATH} does not exist` };
  const parsed = readJson<CorpusManifest>(MANIFEST_PATH);
  if (parsed === null) return { manifest: null, error: `${MANIFEST_PATH} is not valid JSON` };
  if (!Array.isArray(parsed.cases)) return { manifest: null, error: `${MANIFEST_PATH} has no "cases" array` };
  return { manifest: parsed, error: null };
}

// --- sealing (F11): sealed payloads live in-tree only as AES-256-CBC blobs -
function ensureSealKey(): void {
  if (fs.existsSync(SEAL_KEY_PATH)) return;
  fs.mkdirSync(path.dirname(SEAL_KEY_PATH), { recursive: true });
  fs.writeFileSync(SEAL_KEY_PATH, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
}

function decryptToBytes(encRel: string, label: string): { ok: true; bytes: Buffer } | { ok: false; error: string } {
  ensureSealKey();
  const outPath = path.join(proofDir, `decrypted-${label.replace(/[^a-zA-Z0-9_-]/g, '_')}-${crypto.randomBytes(4).toString('hex')}.tmp`);
  const result = sh('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-in', abs(encRel), '-out', outPath, '-pass', `file:${SEAL_KEY_PATH}`]);
  if (result.status !== 0) return { ok: false, error: `openssl decrypt failed for ${encRel} (status=${result.status}): ${result.stderr || result.stdout}` };
  try {
    const bytes = fs.readFileSync(outPath);
    fs.unlinkSync(outPath);
    return { ok: true, bytes };
  } catch (e) {
    return { ok: false, error: `failed reading decrypted temp for ${encRel}: ${(e as Error).message}` };
  }
}

function loadCaseIRBytes(c: CorpusCase): { ok: true; bytes: Buffer } | { ok: false; error: string } {
  if (!c.sealed) {
    try {
      return { ok: true, bytes: fs.readFileSync(abs(c.irPath)) };
    } catch {
      return { ok: false, error: `IR file missing at ${c.irPath}` };
    }
  }
  if (!c.irPath.endsWith('.enc')) return { ok: false, error: `sealed case ${c.id}: irPath must end in .enc, got ${c.irPath}` };
  return decryptToBytes(c.irPath, `${c.id}-ir`);
}

function loadSnapshotBytes(ref: SnapshotRef, sealed: boolean, label: string): { ok: true; bytes: Buffer } | { ok: false; error: string } {
  if (!sealed) {
    try {
      return { ok: true, bytes: fs.readFileSync(abs(ref.path)) };
    } catch {
      return { ok: false, error: `snapshot file missing at ${ref.path}` };
    }
  }
  if (!ref.path.endsWith('.enc')) return { ok: false, error: `sealed snapshot ${label}: path must end in .enc, got ${ref.path}` };
  return decryptToBytes(ref.path, label);
}

interface SnapshotDoc {
  nodes?: Array<{ nodeId: string; domPath: string }>;
  viewportWidth?: number;
}

function loadSnapshotDoc(ref: SnapshotRef, sealed: boolean, label: string): { ok: true; bytes: Buffer; doc: SnapshotDoc } | { ok: false; error: string } {
  const loaded = loadSnapshotBytes(ref, sealed, label);
  if (!loaded.ok) return loaded;
  try {
    const doc = JSON.parse(loaded.bytes.toString('utf8')) as SnapshotDoc;
    return { ok: true, bytes: loaded.bytes, doc };
  } catch (e) {
    return { ok: false, error: `${label}: snapshot is not valid JSON (${(e as Error).message})` };
  }
}

// --- scoring input contract (F7/F9 blinding) --------------------------------
// Every fixture passed to scoreComposition is reduced to exactly this shape
// before scoring -- any other field an implementer-authored fixture carries
// (fixtureKind, expected, label, marker, ...) is stripped so it can never
// influence the score.
const SCORING_INPUT_ALLOWED_KEYS = ['caseId', 'composition'] as const;
interface CompositionElement {
  elementId: string;
  sourceId: string;
  domPath: string;
}
interface ScoringInput {
  caseId: string;
  composition: CompositionElement[];
}

function blindInput(raw: unknown): { ok: true; input: ScoringInput; extraKeys: string[] } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'input.json is not an object' };
  const obj = raw as Record<string, unknown>;
  const extraKeys = Object.keys(obj).filter((k) => !(SCORING_INPUT_ALLOWED_KEYS as readonly string[]).includes(k));
  const caseId = obj['caseId'];
  const composition = obj['composition'];
  if (typeof caseId !== 'string' || caseId.length === 0) return { ok: false, error: 'input.json.caseId must be a non-empty string' };
  if (!Array.isArray(composition)) return { ok: false, error: 'input.json.composition must be an array' };
  return { ok: true, input: { caseId, composition: composition as CompositionElement[] }, extraKeys };
}

function scoreRangeErrors(result: { overall?: unknown; axes?: unknown }): string[] {
  const errors: string[] = [];
  if (typeof result.overall !== 'number' || Number.isNaN(result.overall) || result.overall < 0 || result.overall > 1) {
    errors.push(`overall must be a number in [0,1], got ${String(result.overall)}`);
  }
  if (!result.axes || typeof result.axes !== 'object') {
    errors.push('axes object missing');
    return errors;
  }
  const axesObj = result.axes as Record<string, unknown>;
  for (const axis of REQUIRED_AXES) {
    const v = axesObj[axis];
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 1) errors.push(`axes.${axis} must be a number in [0,1], got ${String(v)}`);
  }
  return errors;
}

// --- verifier-constructed synthetic composites (F8/F9/F10) -----------------
// Built from REAL corpus directiveInventory + source data, never from
// implementer-authored fixtures, so a label-keyed or name-grep scorer has
// nothing to key off.
function pickCaseWithDirectives(manifest: CorpusManifest, minSources = 2): CorpusCase | null {
  return manifest.cases.find((c) => !c.sealed && !c.skip && c.sources.length >= minSources && c.directiveInventory.length >= 1) ?? null;
}

function faithfulComposition(c: CorpusCase): CompositionElement[] {
  return c.directiveInventory.map((d, i) => ({ elementId: `di-${i}-${d.axis}`, sourceId: d.source, domPath: d.scope }));
}

function houseStyleComposition(c: CorpusCase): CompositionElement[] {
  const sourceIds = c.sources.map((s) => s.id);
  return c.directiveInventory.map((d, i) => {
    const others = sourceIds.filter((id) => id !== d.source);
    const blended = others.length > 0 ? others[i % others.length]! : d.source;
    return { elementId: `di-${i}-${d.axis}`, sourceId: blended, domPath: d.scope };
  });
}

function swapOneDirective(c: CorpusCase): { base: CompositionElement[]; swapped: CompositionElement[]; axis: string; diffCount: number } | null {
  const base = faithfulComposition(c);
  const idx = c.directiveInventory.findIndex((d) => c.sources.some((s) => s.id !== d.source));
  if (idx === -1) return null;
  const d = c.directiveInventory[idx]!;
  const altSource = c.sources.map((s) => s.id).find((id) => id !== d.source);
  if (!altSource) return null;
  const swapped = base.map((el, i) => (i === idx ? { ...el, sourceId: altSource } : el));
  const diffCount = base.filter((el, i) => stableStringify(el) !== stableStringify(swapped[i])).length;
  return { base, swapped, axis: d.axis, diffCount };
}

// =============================================================================
// C7-1 -- IR schema exists and is serializable
// =============================================================================
await probe(
  'C7-1',
  `read ${IR_SPEC_PATH}, ${IR_SCHEMA_PATH}; JSON round-trip + schema-validate every corpus IR instance (decrypting sealed cases)`,
  `${IR_SPEC_PATH} documents the six IR concepts; ${IR_SCHEMA_PATH} is a JSON Schema whose top-level "required" array (not merely "properties") lists [${REQUIRED_IR_TOP_KEYS.join(', ')}], whose array-typed sourceSlots/directives/provenance/variantAxes/conflictResolution each declare minItems >= 1, and whose provenance.items.required lists [${REQUIRED_PROVENANCE_ENTRY_KEYS.join(', ')}]; every corpus IR instance (via ${MANIFEST_PATH}, sealed cases decrypted with the seal key) JSON-round-trips AND validates against the committed schema with zero errors, and its plaintext sha256 matches the manifest's recorded irSha256`,
  async () => {
    const specText = readText(IR_SPEC_PATH);
    if (specText === null) return { ok: false, evidence: `missing ${IR_SPEC_PATH}` };
    const requiredSections = ['source slot', 'directive', 'constraint', 'conflict', 'provenance', 'variant'];
    const specLower = specText.toLowerCase();
    const missingSections = requiredSections.filter((s) => !specLower.includes(s));
    if (missingSections.length > 0) {
      return { ok: false, evidence: `${IR_SPEC_PATH} exists but is missing coverage of: ${missingSections.join(', ')}` };
    }

    const schema = readJson<JsonSchema>(IR_SCHEMA_PATH);
    if (schema === null) return { ok: false, evidence: `missing or invalid JSON at ${IR_SCHEMA_PATH}` };

    // F2: top-level keys must be strictly REQUIRED, not merely declared as
    // optional properties -- a schema that lists them only under
    // "properties" without "required" would let a vacuous {} instance pass.
    const topRequiredArr = schema['required'];
    const topRequired = new Set(Array.isArray(topRequiredArr) ? (topRequiredArr as string[]) : []);
    const missingTop = REQUIRED_IR_TOP_KEYS.filter((k) => !topRequired.has(k));
    if (missingTop.length > 0) {
      return { ok: false, evidence: `${IR_SCHEMA_PATH} does not list these top-level keys in "required" (declaring them only as optional properties does not count): ${missingTop.join(', ')}` };
    }
    const topProps = schema['properties'] as Record<string, JsonSchema> | undefined;
    const minItemsProblems: string[] = [];
    for (const arrKey of ['sourceSlots', 'directives', 'provenance', 'variantAxes', 'conflictResolution']) {
      const sub = topProps?.[arrKey];
      const minItems = sub?.['minItems'];
      if (typeof minItems !== 'number' || minItems < 1) minItemsProblems.push(arrKey);
    }
    if (minItemsProblems.length > 0) {
      return { ok: false, evidence: `${IR_SCHEMA_PATH} properties.{${minItemsProblems.join(',')}}.minItems must be >= 1 -- otherwise an empty array vacuously satisfies "type: array"` };
    }
    const provenanceItemSchema = topProps?.['provenance']?.['items'] as JsonSchema | undefined;
    const provenanceRequired = provenanceItemSchema?.['required'];
    const declaredProvenanceKeys = new Set(Array.isArray(provenanceRequired) ? (provenanceRequired as string[]) : []);
    const missingProvenanceKeys = REQUIRED_PROVENANCE_ENTRY_KEYS.filter((k) => !declaredProvenanceKeys.has(k));
    if (missingProvenanceKeys.length > 0) {
      return { ok: false, evidence: `${IR_SCHEMA_PATH} properties.provenance.items.required is missing: ${missingProvenanceKeys.join(', ')}` };
    }

    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot round-trip corpus IR instances: ${error}` };
    if (manifest.cases.length === 0) return { ok: false, evidence: `${MANIFEST_PATH} has zero cases -- nothing to round-trip` };

    const lines: string[] = [];
    let failures = 0;
    for (const c of manifest.cases) {
      if (!c.irPath) {
        failures++;
        lines.push(`${c.id}: manifest entry has no irPath`);
        continue;
      }
      const loaded = loadCaseIRBytes(c);
      if (!loaded.ok) {
        failures++;
        lines.push(`${c.id}: ${loaded.error}`);
        continue;
      }
      const actualHash = sha256Buffer(loaded.bytes);
      if (!c.irSha256 || actualHash !== c.irSha256) {
        failures++;
        lines.push(`${c.id}: irSha256 mismatch (manifest=${c.irSha256 ?? '(missing)'} actual=${actualHash})`);
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(loaded.bytes.toString('utf8'));
      } catch (e) {
        failures++;
        lines.push(`${c.id}: ${c.irPath} is not valid JSON (${(e as Error).message})`);
        continue;
      }
      const roundTripped = JSON.parse(JSON.stringify(parsed)) as unknown;
      if (stableStringify(roundTripped) !== stableStringify(parsed)) {
        failures++;
        lines.push(`${c.id}: ${c.irPath} is not stable under JSON round-trip`);
        continue;
      }
      const schemaErrors = validateAgainstSchema(schema, parsed);
      if (schemaErrors.length > 0) {
        failures++;
        lines.push(`${c.id}: ${c.irPath} fails schema validation:\n  ${schemaErrors.join('\n  ')}`);
        continue;
      }
      lines.push(`${c.id}: round-trip + schema + irSha256 OK (sealed=${c.sealed})`);
    }
    return { ok: failures === 0, evidence: lines.join('\n'), detail: failures > 0 ? `${failures}/${manifest.cases.length} corpus IR instances failed round-trip, hash, or schema validation` : undefined };
  },
);

// =============================================================================
// C7-2 -- IR expresses every corpus directive (directiveInventory cross-check
// + strict sealed-before-seal ancestry)
// =============================================================================
await probe(
  'C7-2',
  `for every case in ${MANIFEST_PATH}, cross-check its directiveInventory ground truth against ir.directives; for sealed cases, require STRICT ancestry (irAddedCommit != sealAddedCommit) via git history`,
  `every case's directiveInventory (>=1 entries, axis in [${DIRECTIVE_AXES.join('/')}], source a real source id, scope non-empty, strength in [0,1]) has a matching entry in that case's IR "directives" array (same axis+source+scope) -- an IR that vacuously omits a directive fails even if it validates against the schema; sealed cases' IR files must be added in a commit that is a STRICT ancestor of the ${SEALED_ACCESS_PATH} commit (same-commit does not count -- F3)`,
  async () => {
    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot check coverage: ${error}` };
    if (manifest.cases.length === 0) return { ok: false, evidence: `${MANIFEST_PATH} has zero cases` };

    const lines: string[] = [];
    let failures = 0;
    const sealLog = sh('git', ['log', '--diff-filter=A', '--format=%H', '--', SEALED_ACCESS_PATH]);
    const sealAddedCommit = sealLog.status === 0 ? sealLog.stdout.trim().split('\n').filter(Boolean).pop() : undefined;

    for (const c of manifest.cases) {
      const loaded = loadCaseIRBytes(c);
      if (!loaded.ok) {
        failures++;
        lines.push(`${c.id}: ${loaded.error}`);
        continue;
      }
      let parsed: { directives?: Array<{ axis?: string; source?: string; scope?: string; strength?: number }> };
      try {
        parsed = JSON.parse(loaded.bytes.toString('utf8'));
      } catch {
        failures++;
        lines.push(`${c.id}: IR is not valid JSON`);
        continue;
      }

      // F2: directiveInventory ground-truth structural validity + cross-check.
      if (!Array.isArray(c.directiveInventory) || c.directiveInventory.length === 0) {
        failures++;
        lines.push(`${c.id}: manifest directiveInventory is empty -- no ground truth to express`);
        continue;
      }
      const sourceIds = new Set(c.sources.map((s) => s.id));
      const invalidEntries = c.directiveInventory.filter(
        (d) => !DIRECTIVE_AXES.includes(d.axis as DirectiveAxis) || !sourceIds.has(d.source) || !d.scope || typeof d.strength !== 'number' || d.strength < 0 || d.strength > 1,
      );
      if (invalidEntries.length > 0) {
        failures++;
        lines.push(`${c.id}: ${invalidEntries.length} directiveInventory entries are structurally invalid (bad axis/source/scope/strength): ${JSON.stringify(invalidEntries)}`);
        continue;
      }
      const irDirectives = Array.isArray(parsed.directives) ? parsed.directives : [];
      const unexpressed = c.directiveInventory.filter((d) => !irDirectives.some((ird) => ird.axis === d.axis && ird.source === d.source && ird.scope === d.scope));
      if (unexpressed.length > 0) {
        failures++;
        lines.push(`${c.id}: ${unexpressed.length}/${c.directiveInventory.length} ground-truth directives have no matching entry in ir.directives: ${JSON.stringify(unexpressed)}`);
        continue;
      }

      if (c.sealed) {
        if (!c.irPath.endsWith('.enc')) {
          failures++;
          lines.push(`${c.id}: sealed but irPath does not end in .enc (${c.irPath})`);
          continue;
        }
        if (!sealAddedCommit) {
          failures++;
          lines.push(`${c.id}: sealed but ${SEALED_ACCESS_PATH} has no git "added" commit to anchor an ordering check`);
          continue;
        }
        const irLog = sh('git', ['log', '--diff-filter=A', '--format=%H', '--', c.irPath]);
        const irAddedCommit = irLog.status === 0 ? irLog.stdout.trim().split('\n').filter(Boolean).pop() : undefined;
        if (!irAddedCommit) {
          failures++;
          lines.push(`${c.id}: sealed IR has no "added" commit in git history`);
          continue;
        }
        if (irAddedCommit === sealAddedCommit) {
          failures++;
          lines.push(`${c.id}: sealed IR added in the SAME commit as the seal record (${irAddedCommit}) -- F3 requires strict ancestry, not same-commit`);
          continue;
        }
        const ancestorCheck = sh('git', ['merge-base', '--is-ancestor', irAddedCommit, sealAddedCommit]);
        if (ancestorCheck.status !== 0) {
          failures++;
          lines.push(`${c.id}: sealed IR added at ${irAddedCommit} which is NOT a strict ancestor of the seal commit ${sealAddedCommit} -- looks backfilled after sealing`);
          continue;
        }
        lines.push(`${c.id}: directiveInventory fully expressed; sealed IR (${irAddedCommit}) is a strict ancestor of the seal commit (${sealAddedCommit})`);
      } else {
        lines.push(`${c.id}: directiveInventory fully expressed in IR`);
      }
    }
    return { ok: failures === 0, evidence: lines.join('\n'), detail: failures > 0 ? `${failures}/${manifest.cases.length} cases failed directive-inventory coverage or seal ordering` : undefined };
  },
);

// =============================================================================
// C7-3 -- conflicts resolve deterministically and visibly, to the DECLARED
// conflict (F4: a constant {result:null, losingClaims:[{}]} must fail)
// =============================================================================
await probe(
  'C7-3',
  `dynamic-import ${RESOLVE_CONFLICTS_PATH}, call resolveConflicts(ir) three times per conflict case, hash each result, and require the losing claim to name the manifest-declared conflict axis+losingSource`,
  `${RESOLVE_CONFLICTS_PATH} exports resolveConflicts(ir): { result: unknown; losingClaims: Array<{axis,winningSource,losingSource}> }; for every conflict-marked case, three independent calls in this process yield an identical stable hash AND at least one losingClaims entry has axis === manifest.conflict.axis && losingSource === manifest.conflict.losingSource -- a constant stub with a generic/empty losing claim fails this by construction`,
  async () => {
    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot run: ${error}` };
    const conflictCases = manifest.cases.filter((c) => c.conflict !== null);
    if (conflictCases.length < 3) return { ok: false, evidence: `only ${conflictCases.length} conflict-marked cases in manifest; C7-5 quota requires >=3`, detail: 'fewer than 3 conflict cases to test determinism against' };

    const imported = await importEvalModule(RESOLVE_CONFLICTS_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const resolveConflicts = imported.mod['resolveConflicts'];
    if (typeof resolveConflicts !== 'function') return { ok: false, evidence: `${RESOLVE_CONFLICTS_PATH} does not export a resolveConflicts function` };

    const lines: string[] = [];
    let failures = 0;
    for (const c of conflictCases) {
      const conflict = c.conflict!;
      const loaded = loadCaseIRBytes(c);
      if (!loaded.ok) {
        failures++;
        lines.push(`${c.id}: ${loaded.error}`);
        continue;
      }
      const ir = JSON.parse(loaded.bytes.toString('utf8')) as unknown;
      const hashes: string[] = [];
      let matchesDeclaredConflict = true;
      for (let run = 0; run < 3; run++) {
        // eslint-disable-next-line no-await-in-loop
        const out = await (resolveConflicts as (ir: unknown) => unknown | Promise<unknown>)(structuredClone(ir));
        const resolvedOut = out as { result?: unknown; losingClaims?: Array<{ axis?: string; losingSource?: string; winningSource?: string }> };
        const hasMatch = Array.isArray(resolvedOut.losingClaims) && resolvedOut.losingClaims.some((lc) => lc.axis === conflict.axis && lc.losingSource === conflict.losingSource);
        if (!hasMatch) matchesDeclaredConflict = false;
        hashes.push(sha256Of(resolvedOut));
      }
      const allSame = hashes.every((h) => h === hashes[0]);
      if (!allSame || !matchesDeclaredConflict) {
        failures++;
        lines.push(`${c.id}: allSame=${allSame} matchesDeclaredConflict=${matchesDeclaredConflict} (expected axis=${conflict.axis} losingSource=${conflict.losingSource}) hashes=${hashes.join(',')}`);
      } else {
        lines.push(`${c.id}: deterministic across 3 runs (hash ${hashes[0]}), losing claim matches declared conflict (${conflict.axis}/${conflict.losingSource})`);
      }
    }
    return { ok: failures === 0, evidence: lines.join('\n'), detail: failures > 0 ? `${failures}/${conflictCases.length} conflict cases not deterministic or did not name the declared losing claim` : undefined };
  },
);

// =============================================================================
// C7-4 -- provenance pointers resolve; a REAL-nodeId-derangement control
// scores zero (F5: no predictable sentinel, total checked both ways)
// =============================================================================
function derangeNodeIds(entries: Array<{ nodeId: string }>): string[] | null {
  const original = entries.map((e) => e.nodeId);
  const n = original.length;
  if (n < 2) return null;
  for (let shift = 1; shift < n; shift++) {
    const candidate = original.map((_, i) => original[(i + shift) % n]!);
    if (candidate.every((v, i) => v !== original[i])) return candidate;
  }
  return null;
}

await probe(
  'C7-4',
  `dynamic-import ${PROVENANCE_RESOLVE_PATH}, call resolveProvenance(ir, snapshotsBySource) on real IR (expect total===provenance.length, resolved===total) and on a verifier-deranged IR built by permuting the REAL nodeIds among entries (expect resolved===0, total unchanged)`,
  `${PROVENANCE_RESOLVE_PATH} exports resolveProvenance(ir, snapshots): { total, resolved, unresolvedPointers }; for every non-skip corpus case, total === ir.provenance.length on both the real and deranged IR, resolved === total > 0 on the real IR, and resolved === 0 on a control IR where every provenance[].nodeId is replaced by another entry's REAL nodeId (a permutation with no fixed points) rather than a synthetic sentinel string that could be special-cased`,
  async () => {
    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot run: ${error}` };
    const imported = await importEvalModule(PROVENANCE_RESOLVE_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const resolveProvenance = imported.mod['resolveProvenance'];
    if (typeof resolveProvenance !== 'function') return { ok: false, evidence: `${PROVENANCE_RESOLVE_PATH} does not export a resolveProvenance function` };

    const nonSkipCases = manifest.cases.filter((c) => c.skip === null);
    if (nonSkipCases.length === 0) return { ok: false, evidence: 'no non-skip cases in manifest to test provenance resolution against' };

    const lines: string[] = [];
    let failures = 0;
    for (const c of nonSkipCases) {
      const loaded = loadCaseIRBytes(c);
      if (!loaded.ok) {
        failures++;
        lines.push(`${c.id}: ${loaded.error}`);
        continue;
      }
      const ir = JSON.parse(loaded.bytes.toString('utf8')) as { provenance?: Array<{ sourceId: string; nodeId: string }> };
      if (!Array.isArray(ir.provenance) || ir.provenance.length < 2) {
        failures++;
        lines.push(`${c.id}: IR has fewer than 2 provenance entries -- cannot build a fixed-point-free derangement control`);
        continue;
      }
      const snapshotsBySource: Record<string, Array<{ nodeId: string }>> = {};
      let snapshotLoadError: string | null = null;
      for (const source of c.sources) {
        const nodes: Array<{ nodeId: string }> = [];
        for (const [bp, ref] of Object.entries(source.snapshots)) {
          const snapDoc = loadSnapshotDoc(ref, c.sealed, `${c.id}-${source.id}-${bp}`);
          if (!snapDoc.ok) {
            snapshotLoadError = snapDoc.error;
            break;
          }
          if (snapDoc.doc.nodes) nodes.push(...snapDoc.doc.nodes);
        }
        snapshotsBySource[source.id] = nodes;
        if (snapshotLoadError) break;
      }
      if (snapshotLoadError) {
        failures++;
        lines.push(`${c.id}: ${snapshotLoadError}`);
        continue;
      }

      const deranged = derangeNodeIds(ir.provenance);
      if (!deranged) {
        failures++;
        lines.push(`${c.id}: could not construct a derangement (all provenance nodeIds identical?)`);
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const real = (await (resolveProvenance as (ir: unknown, snaps: unknown) => unknown | Promise<unknown>)(ir, snapshotsBySource)) as {
        total: number;
        resolved: number;
      };
      const realOk = real.total === ir.provenance.length && real.resolved === real.total && real.total > 0;

      const derangedIr = { ...ir, provenance: ir.provenance.map((p, i) => ({ ...p, nodeId: deranged[i]! })) };
      // eslint-disable-next-line no-await-in-loop
      const control = (await (resolveProvenance as (ir: unknown, snaps: unknown) => unknown | Promise<unknown>)(derangedIr, snapshotsBySource)) as {
        total: number;
        resolved: number;
      };
      const controlOk = control.total === ir.provenance.length && control.resolved === 0;

      if (!realOk || !controlOk) {
        failures++;
        lines.push(`${c.id}: real(total=${real.total},resolved=${real.resolved},expectedTotal=${ir.provenance.length}) deranged-control(total=${control.total},resolved=${control.resolved}) -- expected real fully resolved with matching total, control zero`);
      } else {
        lines.push(`${c.id}: real fully resolves (${real.resolved}/${real.total}); nodeId-derangement control resolves to 0/${control.total}`);
      }
    }
    return { ok: failures === 0, evidence: lines.join('\n'), detail: failures > 0 ? `${failures}/${nonSkipCases.length} cases failed real-resolve, total-check, or derangement-control-zero` : undefined };
  },
);

// =============================================================================
// C7-5 -- corpus pinned, quota-satisfying, reproducible, and SUBSTANTIVE
// (F6: closed genre/layout enums, distinct breakpoint widths, globally
// distinct snapshot content, real degenerate/conflict semantics)
// =============================================================================
await probe(
  'C7-5',
  `read ${MANIFEST_PATH} + ${CORPUS_MD_PATH}; assert each S7-2 quota row against a CLOSED genre/layout-system vocabulary; decrypt+re-hash every snapshot; require global content-hash distinctness, per-case distinct viewportWidths, a minimum node count, and real degenerate/conflict semantics`,
  `${CORPUS_MD_PATH} exists; layoutSystem is drawn from [${ALLOWED_LAYOUT_SYSTEMS.join(', ')}] (>=3 distinct, i.e. all of them appear), genre from [${ALLOWED_GENRES.join(', ')}] (>=4 distinct, i.e. all of them appear); every non-skip case has >=2 breakpoints with no duplicate breakpoint names and each source's snapshot set for that case has a DISTINCT viewportWidth per breakpoint; >=3 cases with conflict!=null whose axis is in [${DIRECTIVE_AXES.join('/')}] and whose winningSource/losingSource are real source ids in that case; degenerate cases are semantically real -- single-source has exactly 1 source, nonexistent-element-directive has a directiveInventory scope matching no captured domPath, hostile-heavy-dom has >=200 total captured nodes; >=1 documented skip; every snapshot's re-computed plaintext sha256 (post-decrypt for sealed cases) matches the manifest, every snapshot has >=5 nodes, and NO TWO snapshot files anywhere in the corpus share a content hash`,
  async () => {
    if (!exists(CORPUS_MD_PATH)) return { ok: false, evidence: `missing ${CORPUS_MD_PATH}` };
    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot check quotas: ${error}` };
    const cases = manifest.cases;
    const nonSkip = cases.filter((c) => c.skip === null);

    const rows: { row: string; ok: boolean; detail: string }[] = [];

    const badLayout = nonSkip.filter((c) => !(ALLOWED_LAYOUT_SYSTEMS as readonly string[]).includes(c.layoutSystem));
    const layoutSystems = new Set(nonSkip.map((c) => c.layoutSystem));
    rows.push({ row: `layoutSystem is closed-vocabulary and >=3 distinct`, ok: badLayout.length === 0 && layoutSystems.size >= 3, detail: `values=[${[...layoutSystems].join(', ')}] offVocab=${badLayout.map((c) => c.id).join(',') || 'none'}` });

    const badGenre = nonSkip.filter((c) => !(ALLOWED_GENRES as readonly string[]).includes(c.genre));
    const genres = new Set(nonSkip.map((c) => c.genre));
    rows.push({ row: `genre is closed-vocabulary and >=4 distinct`, ok: badGenre.length === 0 && genres.size >= 4, detail: `values=[${[...genres].join(', ')}] offVocab=${badGenre.map((c) => c.id).join(',') || 'none'}` });

    const under2bp = nonSkip.filter((c) => c.breakpoints.length < 2);
    const dupBp = nonSkip.filter((c) => new Set(c.breakpoints).size !== c.breakpoints.length);
    rows.push({
      row: 'breakpoints >=2 per non-skip case, no literal duplicates',
      ok: under2bp.length === 0 && dupBp.length === 0,
      detail: `under2=${under2bp.map((c) => c.id).join(',') || 'none'} dup=${dupBp.map((c) => c.id).join(',') || 'none'}`,
    });

    const conflictCases = cases.filter((c) => c.conflict !== null);
    const badConflictSemantics = conflictCases.filter((c) => {
      const conflict = c.conflict!;
      const sourceIds = new Set(c.sources.map((s) => s.id));
      return !DIRECTIVE_AXES.includes(conflict.axis as DirectiveAxis) || !sourceIds.has(conflict.winningSource) || !sourceIds.has(conflict.losingSource) || conflict.winningSource === conflict.losingSource;
    });
    rows.push({
      row: 'conflict pairs >=3 cases, each with a real axis + real distinct winning/losing source ids',
      ok: conflictCases.length >= 3 && badConflictSemantics.length === 0,
      detail: `count=${conflictCases.length} semanticallyInvalid=${badConflictSemantics.map((c) => c.id).join(',') || 'none'}`,
    });

    const skipCases = cases.filter((c) => c.skip !== null);
    const skipReasonsOk = skipCases.every((c) => c.skip && ['login-walled', 'bot-walled'].includes(c.skip.reason) && c.skip.target.length > 0);
    rows.push({ row: 'documented skip >=1 with valid reason+target', ok: skipCases.length >= 1 && skipReasonsOk, detail: `count=${skipCases.length}, reasonsOk=${skipReasonsOk}` });

    // Snapshot decrypt + integrity + node-count + viewportWidth-distinctness +
    // global content-hash distinctness, and degenerate-kind semantic checks,
    // all in one pass over the (possibly-sealed) snapshot data.
    let hashChecked = 0;
    let hashMismatches = 0;
    let tinySnapshots = 0;
    const hashLines: string[] = [];
    const globalHashLocations = new Map<string, string[]>();
    const caseNodeTotals = new Map<string, number>();
    const caseDomPaths = new Map<string, Set<string>>();
    const perCaseBreakpointWidths = new Map<string, Map<string, Set<number>>>(); // caseId -> breakpoint -> widths seen

    for (const c of cases) {
      let nodeTotal = 0;
      const domPaths = new Set<string>();
      const bpWidths = new Map<string, Set<number>>();
      for (const source of c.sources) {
        for (const [bp, ref] of Object.entries(source.snapshots)) {
          hashChecked++;
          const label = `${c.id}/${source.id}/${bp}`;
          const loaded = loadSnapshotDoc(ref, c.sealed, label);
          if (!loaded.ok) {
            hashMismatches++;
            hashLines.push(`${label}: ${loaded.error}`);
            continue;
          }
          const actualHash = sha256Buffer(loaded.bytes);
          if (actualHash !== ref.sha256) {
            hashMismatches++;
            hashLines.push(`${label}: hash mismatch (manifest=${ref.sha256} actual=${actualHash})`);
          }
          const nodes = loaded.doc.nodes ?? [];
          if (nodes.length < 5) {
            tinySnapshots++;
            hashLines.push(`${label}: only ${nodes.length} nodes (< 5, looks like a placeholder capture)`);
          }
          nodeTotal += nodes.length;
          for (const n of nodes) domPaths.add(n.domPath);
          const locs = globalHashLocations.get(actualHash) ?? [];
          locs.push(label);
          globalHashLocations.set(actualHash, locs);
          if (typeof loaded.doc.viewportWidth === 'number') {
            const widths = bpWidths.get(bp) ?? new Set<number>();
            widths.add(loaded.doc.viewportWidth);
            bpWidths.set(bp, widths);
          } else {
            hashMismatches++;
            hashLines.push(`${label}: snapshot missing numeric viewportWidth`);
          }
        }
      }
      caseNodeTotals.set(c.id, nodeTotal);
      caseDomPaths.set(c.id, domPaths);
      perCaseBreakpointWidths.set(c.id, bpWidths);
    }
    rows.push({ row: 'snapshot content-hashes match manifest (pinned, post-decrypt for sealed)', ok: hashChecked > 0 && hashMismatches === 0, detail: `checked=${hashChecked} mismatches=${hashMismatches}` });
    rows.push({ row: 'every snapshot has >=5 nodes (not a tiny placeholder)', ok: tinySnapshots === 0, detail: `tinySnapshots=${tinySnapshots}` });

    const duplicateHashes = [...globalHashLocations.entries()].filter(([, locs]) => locs.length > 1);
    rows.push({
      row: 'snapshot content is GLOBALLY distinct across the whole corpus (no reused/duplicate captures)',
      ok: duplicateHashes.length === 0,
      detail: duplicateHashes.length ? duplicateHashes.map(([h, locs]) => `${h.slice(0, 12)}...: ${locs.join(', ')}`).join('; ') : `all ${globalHashLocations.size} snapshot hashes distinct`,
    });

    // Cross-breakpoint viewportWidth must actually differ within a case+source
    // set -- otherwise "mobile" and "desktop" could be the same capture twice.
    let widthCollisions = 0;
    const widthLines: string[] = [];
    for (const [caseId, bpWidths] of perCaseBreakpointWidths) {
      const allWidths = [...bpWidths.values()].flatMap((s) => [...s]);
      if (new Set(allWidths).size !== allWidths.length) {
        widthCollisions++;
        widthLines.push(`${caseId}: duplicate viewportWidth across declared breakpoints (${allWidths.join(',')})`);
      }
    }
    rows.push({ row: 'each case has a distinct viewportWidth per breakpoint (not the same capture relabeled)', ok: widthCollisions === 0, detail: widthLines.join('; ') || 'no collisions' });

    // Degenerate-kind substantive checks.
    const degenerateProblems: string[] = [];
    for (const kind of ['single-source', 'nonexistent-element-directive', 'hostile-heavy-dom'] as const) {
      const matching = cases.filter((c) => c.degenerate === kind);
      if (matching.length === 0) {
        degenerateProblems.push(`no case declares degenerate="${kind}"`);
        continue;
      }
      for (const c of matching) {
        if (kind === 'single-source' && c.sources.length !== 1) {
          degenerateProblems.push(`${c.id}: degenerate="single-source" but sources.length=${c.sources.length}`);
        }
        if (kind === 'nonexistent-element-directive') {
          const domPaths = caseDomPaths.get(c.id) ?? new Set();
          const hasUnresolvableScope = c.directiveInventory.some((d) => !domPaths.has(d.scope));
          if (!hasUnresolvableScope) degenerateProblems.push(`${c.id}: degenerate="nonexistent-element-directive" but every directiveInventory scope resolves to a real captured domPath`);
        }
        if (kind === 'hostile-heavy-dom') {
          const total = caseNodeTotals.get(c.id) ?? 0;
          if (total < 200) degenerateProblems.push(`${c.id}: degenerate="hostile-heavy-dom" but only ${total} total captured nodes (< 200)`);
        }
      }
    }
    rows.push({ row: 'degenerate cases are semantically real (single-source/nonexistent-element/hostile-heavy-dom actually hold)', ok: degenerateProblems.length === 0, detail: degenerateProblems.join('; ') || 'all degenerate cases verified' });

    const failed = rows.filter((r) => !r.ok);
    const evidence = [...rows.map((r) => `[${r.ok ? 'OK' : 'FAIL'}] ${r.row} -- ${r.detail}`), ...hashLines].join('\n');
    return { ok: failed.length === 0, evidence, detail: failed.length > 0 ? `failed rows: ${failed.map((r) => r.row).join('; ')}` : undefined };
  },
);

// Shared fixture loader for the criteria below: reads input.json, blinds it
// down to {caseId, composition} (F9), requires the caseId to reference a
// real corpus case (F7 corpus-membership), and returns the blinded content's
// stable hash for cross-fixture uniqueness checks (F7).
function loadBlindedFixture(relDir: string, manifest: CorpusManifest): { ok: true; input: ScoringInput; blindHash: string; extraKeys: string[] } | { ok: false; error: string } {
  const raw = readJson<unknown>(path.join(relDir, 'input.json'));
  if (raw === null) return { ok: false, error: `${relDir}: missing or invalid input.json` };
  const blinded = blindInput(raw);
  if (!blinded.ok) return { ok: false, error: `${relDir}: ${blinded.error}` };
  if (!manifest.cases.some((c) => c.id === blinded.input.caseId)) return { ok: false, error: `${relDir}: caseId "${blinded.input.caseId}" is not a real corpus case (not corpus-derived)` };
  return { ok: true, input: blinded.input, blindHash: sha256Of(blinded.input), extraKeys: blinded.extraKeys };
}

// =============================================================================
// C7-6 -- grader discriminates on a population, not an example (F7: corpus
// membership + uniqueness required; F9/F12: blinded input + range-checked)
// =============================================================================
await probe(
  'C7-6',
  `dynamic-import ${SCORER_INDEX_PATH}; blind + corpus-membership-check + uniqueness-check every fixture under ${POPULATION_DIR}/{wrong,faithful}; score the blinded {caseId,composition} only; assert no overlap between the two score distributions`,
  `${POPULATION_DIR}/wrong/<id>/input.json (>=5) and ${POPULATION_DIR}/faithful/<id>/input.json (>=5) each declare a caseId that is a real ${MANIFEST_PATH} case; after blinding to {caseId,composition} (F9), no two fixtures across BOTH groups share an identical blinded content hash (F7 uniqueness); each blinded fixture scores via scoreComposition(input).overall, in [0,1] (F12); max(wrong scores) < min(faithful scores) -- zero distribution overlap`,
  async () => {
    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot run: ${error}` };
    const imported = await importEvalModule(SCORER_INDEX_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const scoreComposition = imported.mod['scoreComposition'];
    if (typeof scoreComposition !== 'function') return { ok: false, evidence: `${SCORER_INDEX_PATH} does not export scoreComposition` };

    const seenHashes = new Map<string, string>(); // blindHash -> first location
    const scoreGroup = async (subdir: 'wrong' | 'faithful'): Promise<{ ids: string[]; scores: number[]; errors: string[] }> => {
      const dir = abs(path.join(POPULATION_DIR, subdir));
      const ids: string[] = [];
      const scores: number[] = [];
      const errors: string[] = [];
      if (!fs.existsSync(dir)) return { ids, scores, errors: [`missing directory ${POPULATION_DIR}/${subdir}`] };
      for (const entry of fs.readdirSync(dir)) {
        const relDir = path.join(POPULATION_DIR, subdir, entry);
        const loaded = loadBlindedFixture(relDir, manifest);
        if (!loaded.ok) {
          errors.push(loaded.error);
          continue;
        }
        const dupLocation = seenHashes.get(loaded.blindHash);
        if (dupLocation) {
          errors.push(`${relDir}: blinded content is identical to ${dupLocation} -- not a distinct population member`);
          continue;
        }
        seenHashes.set(loaded.blindHash, relDir);
        // eslint-disable-next-line no-await-in-loop
        const out = (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(loaded.input)) as { overall?: number; axes?: unknown };
        const rangeErrors = scoreRangeErrors(out);
        if (rangeErrors.length > 0) {
          errors.push(`${relDir}: ${rangeErrors.join('; ')}`);
          continue;
        }
        ids.push(entry);
        scores.push(out.overall as number);
      }
      return { ids, scores, errors };
    };

    const wrong = await scoreGroup('wrong');
    const faithful = await scoreGroup('faithful');
    const errors = [...wrong.errors, ...faithful.errors];
    if (wrong.scores.length < 5) errors.push(`only ${wrong.scores.length} valid "wrong" fixtures, need >=5`);
    if (faithful.scores.length < 5) errors.push(`only ${faithful.scores.length} valid "faithful" fixtures, need >=5`);
    if (errors.length > 0) return { ok: false, evidence: errors.join('\n') };

    const maxWrong = Math.max(...wrong.scores);
    const minFaithful = Math.min(...faithful.scores);
    const separated = maxWrong < minFaithful;
    const evidence = [
      `wrong: [${wrong.ids.map((id, i) => `${id}=${wrong.scores[i]?.toFixed(3)}`).join(', ')}] max=${maxWrong.toFixed(3)}`,
      `faithful: [${faithful.ids.map((id, i) => `${id}=${faithful.scores[i]?.toFixed(3)}`).join(', ')}] min=${minFaithful.toFixed(3)}`,
      `separated (max(wrong) < min(faithful)): ${separated}`,
    ].join('\n');
    return { ok: separated, evidence, detail: separated ? undefined : 'score distributions overlap' };
  },
);

// =============================================================================
// C7-7 -- source bleed metric: LOAD-BEARING check is a verifier-constructed
// control built from real corpus snapshot domPaths (F8); implementer unit
// tests remain required but are additional, non-load-bearing (F8)
// =============================================================================
await probe(
  'C7-7',
  `dynamic-import ${SOURCE_BLEED_PATH} and call its bleed-scoring export DIRECTLY on a verifier-built clean composition (all elements' domPaths genuinely belong to their attributed source's own snapshot) vs a verifier-built injected-bleed composition (one element's sourceId is reassigned to a source whose snapshot does NOT contain that domPath); ALSO run \`node --import tsx --test ${SOURCE_BLEED_TEST_PATH}\` as an additional, non-load-bearing check`,
  `${SOURCE_BLEED_PATH} exports scoreSourceBleed({composition, sourceDomPaths}): {bleedCount, violatingElementIds} (or equivalent violation list); on the verifier-built clean composition bleedCount === 0; on the verifier-built injected-bleed composition bleedCount >= 1 and the injected element id appears in the violation list -- this uses no source "name" field at all, so a name-grep implementation cannot pass by construction; ${SOURCE_BLEED_TEST_PATH} additionally passes with named clean/injected-bleed/absent-name control cases`,
  async () => {
    if (!exists(SOURCE_BLEED_PATH)) return { ok: false, evidence: `missing ${SOURCE_BLEED_PATH}` };
    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot run: ${error}` };

    let target: { c: CorpusCase; domPathsBySource: Record<string, string[]> } | null = null;
    for (const c of manifest.cases.filter((cc) => !cc.sealed && !cc.skip)) {
      const domPathsBySource: Record<string, string[]> = {};
      let loadError: string | null = null;
      for (const source of c.sources) {
        const set = new Set<string>();
        for (const [bp, ref] of Object.entries(source.snapshots)) {
          const loaded = loadSnapshotDoc(ref, c.sealed, `${c.id}-${source.id}-${bp}`);
          if (!loaded.ok) {
            loadError = loaded.error;
            break;
          }
          for (const n of loaded.doc.nodes ?? []) set.add(n.domPath);
        }
        domPathsBySource[source.id] = [...set];
        if (loadError) break;
      }
      if (loadError) continue;
      const usable = Object.entries(domPathsBySource).filter(([, paths]) => paths.length > 0);
      if (usable.length >= 2) {
        target = { c, domPathsBySource };
        break;
      }
    }
    if (!target) return { ok: false, evidence: 'no corpus case with >=2 sources each having >=1 captured domPath was found to build a bleed control from' };

    const [sourceA, sourceB] = Object.entries(target.domPathsBySource).filter(([, p]) => p.length > 0);
    const pathsA = sourceA![1];
    const clean: CompositionElement[] = pathsA.slice(0, Math.min(5, pathsA.length)).map((p, i) => ({ elementId: `bleed-el-${i}`, sourceId: sourceA![0], domPath: p }));
    const bled: CompositionElement[] = clean.map((el, i) => (i === 0 ? { ...el, sourceId: sourceB![0] } : el));

    const imported = await importEvalModule(SOURCE_BLEED_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const scoreSourceBleed = imported.mod['scoreSourceBleed'];
    if (typeof scoreSourceBleed !== 'function') return { ok: false, evidence: `${SOURCE_BLEED_PATH} does not export a scoreSourceBleed function` };

    const call = async (composition: CompositionElement[]) =>
      (await (scoreSourceBleed as (i: unknown) => unknown | Promise<unknown>)({ composition, sourceDomPaths: target!.domPathsBySource })) as { bleedCount?: number; violatingElementIds?: string[] };
    const cleanResult = await call(clean);
    const bledResult = await call(bled);
    const cleanOk = cleanResult.bleedCount === 0;
    const bledOk = (bledResult.bleedCount ?? 0) >= 1 && Array.isArray(bledResult.violatingElementIds) && bledResult.violatingElementIds.includes('bleed-el-0');

    const testRun = runNodeTest([SOURCE_BLEED_TEST_PATH]);
    const needles = ['clean', 'inject', 'absent'];
    const missingNeedles = needles.filter((n) => !testRun.tests.some((t) => t.name.toLowerCase().includes(n) && t.pass));
    const testsOk = testRun.status === 0 && testRun.tests.length > 0 && missingNeedles.length === 0;

    const ok = cleanOk && bledOk && testsOk;
    const evidence = [
      `case=${target.c.id}`,
      `clean composition -> ${JSON.stringify(cleanResult)} (expect bleedCount=0): ${cleanOk ? 'OK' : 'FAIL'}`,
      `injected-bleed composition -> ${JSON.stringify(bledResult)} (expect bleedCount>=1 incl. bleed-el-0): ${bledOk ? 'OK' : 'FAIL'}`,
      `implementer test suite (additional, non-load-bearing): exit=${testRun.status} missingNeedles=${missingNeedles.join(',') || 'none'}`,
      testRun.tests.map((t) => `  ${t.pass ? 'PASS' : 'FAIL'} ${t.name}`).join('\n'),
    ].join('\n');
    return { ok, evidence, detail: ok ? undefined : `cleanOk=${cleanOk} bledOk=${bledOk} testsOk=${testsOk}` };
  },
);

// =============================================================================
// C7-8 -- diversity: LOAD-BEARING check is a verifier-constructed structural
// identity control (F8); implementer unit tests remain required, additional
// =============================================================================
await probe(
  'C7-8',
  `read ${DIVERSITY_AXES_PATH}; dynamic-import ${DIVERSITY_PATH} and call its scoring export DIRECTLY on a verifier-built structurally-IDENTICAL trio (proxy for recolor/class-only variation, since the composition contract carries no color/class data -- three identical structures) vs a verifier-built structurally-DIFFERENT trio (different source attribution per element + reversed section order); ALSO run \`node --import tsx --test ${DIVERSITY_TEST_PATH}\` as an additional, non-load-bearing check`,
  `${DIVERSITY_AXES_PATH} freezes >=4 pre-registered axes including layout-skeleton/section-order/motion-timeline/breakpoint-behavior; ${DIVERSITY_PATH} exports a diversity-scoring function taking an array of compositions; on the identical trio the score is < floors.structural_variant_diversity; on the structurally-different trio the score is >= that floor; ${DIVERSITY_TEST_PATH} additionally passes with named recolor-only/class-names-only control cases`,
  async () => {
    const axes = readJson<{ axes?: Array<{ name: string }> }>(DIVERSITY_AXES_PATH);
    if (axes === null || !Array.isArray(axes.axes)) return { ok: false, evidence: `missing or invalid ${DIVERSITY_AXES_PATH}` };
    const names = axes.axes.map((a) => a.name.toLowerCase());
    const requiredAxisNames = ['layout-skeleton', 'section-order', 'motion-timeline', 'breakpoint-behavior'];
    const missingAxes = requiredAxisNames.filter((req) => !names.some((n) => n.includes(req.split('-')[0] ?? req)));
    if (missingAxes.length > 0) return { ok: false, evidence: `${DIVERSITY_AXES_PATH} is missing pre-registered axes matching: ${missingAxes.join(', ')} (found: ${names.join(', ')})` };
    if (!exists(DIVERSITY_PATH)) return { ok: false, evidence: `missing ${DIVERSITY_PATH}` };

    const floors = readJson<{ floors?: Record<string, number> }>(FLOORS_PATH);
    const floor = floors?.floors?.['structural_variant_diversity'];
    if (typeof floor !== 'number') return { ok: false, evidence: `${FLOORS_PATH} missing numeric floors.structural_variant_diversity` };

    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot run: ${error}` };
    const c = pickCaseWithDirectives(manifest, 2);
    if (!c) return { ok: false, evidence: 'no non-sealed, non-skip corpus case with >=2 sources and >=1 directiveInventory entries to build a diversity control from' };

    const base = faithfulComposition(c);
    const identicalTrio = [base, base.map((e) => ({ ...e })), base.map((e) => ({ ...e }))];
    const sourceIds = c.sources.map((s) => s.id);
    const rotated = base.map((el) => ({ ...el, sourceId: sourceIds[(sourceIds.indexOf(el.sourceId) + 1) % sourceIds.length]! }));
    const reversed = [...base].reverse();
    const diverseTrio = [base, rotated, reversed];

    const imported = await importEvalModule(DIVERSITY_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const scoreDiversity = imported.mod['scoreDiversity'];
    if (typeof scoreDiversity !== 'function') return { ok: false, evidence: `${DIVERSITY_PATH} does not export a scoreDiversity function` };

    const identicalResult = (await (scoreDiversity as (v: unknown) => unknown | Promise<unknown>)(identicalTrio)) as { score?: number };
    const diverseResult = (await (scoreDiversity as (v: unknown) => unknown | Promise<unknown>)(diverseTrio)) as { score?: number };
    const identicalOk = typeof identicalResult.score === 'number' && identicalResult.score < floor;
    const diverseOk = typeof diverseResult.score === 'number' && diverseResult.score >= floor;

    const testRun = runNodeTest([DIVERSITY_TEST_PATH]);
    const needles = ['recolor', 'class'];
    const missingNeedles = needles.filter((n) => !testRun.tests.some((t) => t.name.toLowerCase().includes(n) && t.pass));
    const testsOk = testRun.status === 0 && testRun.tests.length > 0 && missingNeedles.length === 0;

    const ok = identicalOk && diverseOk && testsOk;
    const evidence = [
      `axis set: ${names.join(', ')}; floor=${floor}; case=${c.id}`,
      `identical-trio score=${identicalResult.score} (expect < ${floor}): ${identicalOk ? 'OK' : 'FAIL'}`,
      `diverse-trio score=${diverseResult.score} (expect >= ${floor}): ${diverseOk ? 'OK' : 'FAIL'}`,
      `implementer test suite (additional, non-load-bearing): exit=${testRun.status} missingNeedles=${missingNeedles.join(',') || 'none'}`,
    ].join('\n');
    return { ok, evidence, detail: ok ? undefined : `identicalOk=${identicalOk} diverseOk=${diverseOk} testsOk=${testsOk}` };
  },
);

// =============================================================================
// C7-9 -- directive_claim_coverage: LOAD-BEARING check is a verifier-built
// house-style-vs-faithful composite pair from REAL directiveInventory data
// (F9 -- no fixtureKind field exists for a scorer to key off); implementer
// fixtures remain required, blinded + corpus-membership + uniqueness-checked
// (F7), as an additional, non-load-bearing check
// =============================================================================
await probe(
  'C7-9',
  `dynamic-import ${SCORER_INDEX_PATH}; score a verifier-built house-style composite (every directiveInventory entry deliberately attributed to a DIFFERENT source than requested) vs a verifier-built faithful composite (every entry attributed exactly as requested) for a real corpus case; ALSO blind+corpus-check+uniqueness-check+score implementer fixtures under ${DIRECTIVE_FIXTURES_DIR}/{house-style,faithful} as an additional, non-load-bearing check`,
  `the verifier-built house-style composite scores axes.directive_claim_coverage < floors.directive_claim_coverage while axes.layout_geometry/palette_fidelity/type_fidelity are each >= their floor; the verifier-built faithful composite scores axes.directive_claim_coverage >= floor; implementer fixtures (>=3 each group, blinded to {caseId,composition}, corpus-derived, mutually unique) show the same pattern`,
  async () => {
    const floors = readJson<{ floors?: Record<string, number> }>(FLOORS_PATH);
    if (floors === null || !floors.floors) return { ok: false, evidence: `missing or invalid ${FLOORS_PATH}` };
    const missingFloorAxes = REQUIRED_AXES.filter((a) => typeof floors.floors?.[a] !== 'number');
    if (missingFloorAxes.length > 0) return { ok: false, evidence: `${FLOORS_PATH} missing numeric floors for: ${missingFloorAxes.join(', ')}` };
    const f = floors.floors;

    const imported = await importEvalModule(SCORER_INDEX_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const scoreComposition = imported.mod['scoreComposition'];
    if (typeof scoreComposition !== 'function') return { ok: false, evidence: `${SCORER_INDEX_PATH} does not export scoreComposition` };

    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot run: ${error}` };
    const c = pickCaseWithDirectives(manifest, 2);
    if (!c) return { ok: false, evidence: 'no non-sealed, non-skip corpus case with >=2 sources and >=1 directiveInventory entries to build house-style/faithful composites from' };

    const scoreOf = async (composition: CompositionElement[]) => {
      const input: ScoringInput = { caseId: c.id, composition };
      return (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(input)) as { axes?: Record<string, number> };
    };
    const rangeCheck = (label: string, out: { axes?: Record<string, number> }): string[] => scoreRangeErrors(out).map((e) => `${label}: ${e}`);

    const houseResult = await scoreOf(houseStyleComposition(c));
    const faithfulResult = await scoreOf(faithfulComposition(c));
    const rangeErrors = [...rangeCheck('verifier house-style', houseResult), ...rangeCheck('verifier faithful', faithfulResult)];
    if (rangeErrors.length > 0) return { ok: false, evidence: rangeErrors.join('\n') };

    const dccBelow = (houseResult.axes?.['directive_claim_coverage'] ?? 1) < (f['directive_claim_coverage'] ?? 0);
    const othersAboveFloor =
      (houseResult.axes?.['layout_geometry'] ?? -1) >= (f['layout_geometry'] ?? 0) &&
      (houseResult.axes?.['palette_fidelity'] ?? -1) >= (f['palette_fidelity'] ?? 0) &&
      (houseResult.axes?.['type_fidelity'] ?? -1) >= (f['type_fidelity'] ?? 0);
    const faithfulAbove = (faithfulResult.axes?.['directive_claim_coverage'] ?? -1) >= (f['directive_claim_coverage'] ?? 0);
    const verifierOk = dccBelow && othersAboveFloor && faithfulAbove;

    // Additional, non-load-bearing: implementer fixtures.
    const scoreGroup = async (subdir: string, seenHashes: Map<string, string>): Promise<{ items: { id: string; axes: Record<string, number> }[]; errors: string[] }> => {
      const dir = abs(path.join(DIRECTIVE_FIXTURES_DIR, subdir));
      const items: { id: string; axes: Record<string, number> }[] = [];
      const errors: string[] = [];
      if (!fs.existsSync(dir)) return { items, errors: [`missing ${DIRECTIVE_FIXTURES_DIR}/${subdir}`] };
      for (const entry of fs.readdirSync(dir)) {
        const relDir = path.join(DIRECTIVE_FIXTURES_DIR, subdir, entry);
        const loaded = loadBlindedFixture(relDir, manifest);
        if (!loaded.ok) {
          errors.push(loaded.error);
          continue;
        }
        const dup = seenHashes.get(loaded.blindHash);
        if (dup) {
          errors.push(`${relDir}: blinded content identical to ${dup}`);
          continue;
        }
        seenHashes.set(loaded.blindHash, relDir);
        // eslint-disable-next-line no-await-in-loop
        const result = (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(loaded.input)) as { axes?: Record<string, number> };
        const re = scoreRangeErrors(result);
        if (re.length > 0) {
          errors.push(`${relDir}: ${re.join('; ')}`);
          continue;
        }
        items.push({ id: entry, axes: result.axes! });
      }
      return { items, errors };
    };
    const seen = new Map<string, string>();
    const houseStyleFixtures = await scoreGroup('house-style', seen);
    const faithfulFixtures = await scoreGroup('faithful', seen);
    const fixtureErrors = [...houseStyleFixtures.errors, ...faithfulFixtures.errors];
    if (houseStyleFixtures.items.length < 3) fixtureErrors.push(`only ${houseStyleFixtures.items.length} valid house-style fixtures, need >=3`);
    if (faithfulFixtures.items.length < 3) fixtureErrors.push(`only ${faithfulFixtures.items.length} valid faithful fixtures, need >=3`);
    let fixtureFailures = 0;
    for (const h of houseStyleFixtures.items) {
      const ok = (h.axes['directive_claim_coverage'] ?? 1) < (f['directive_claim_coverage'] ?? 0) && (h.axes['layout_geometry'] ?? -1) >= (f['layout_geometry'] ?? 0) && (h.axes['palette_fidelity'] ?? -1) >= (f['palette_fidelity'] ?? 0) && (h.axes['type_fidelity'] ?? -1) >= (f['type_fidelity'] ?? 0);
      if (!ok) fixtureFailures++;
    }
    for (const g of faithfulFixtures.items) {
      if ((g.axes['directive_claim_coverage'] ?? -1) < (f['directive_claim_coverage'] ?? 0)) fixtureFailures++;
    }
    const fixturesOk = fixtureErrors.length === 0 && fixtureFailures === 0;

    const ok = verifierOk && fixturesOk;
    const evidence = [
      `case=${c.id}`,
      `verifier house-style axes=${JSON.stringify(houseResult.axes)} dccBelow=${dccBelow} othersAboveFloor=${othersAboveFloor}`,
      `verifier faithful axes=${JSON.stringify(faithfulResult.axes)} faithfulAbove=${faithfulAbove}`,
      `implementer fixtures (additional, non-load-bearing): house-style=${houseStyleFixtures.items.length} faithful=${faithfulFixtures.items.length} failures=${fixtureFailures} errors=${fixtureErrors.join('; ') || 'none'}`,
    ].join('\n');
    return { ok, evidence, detail: ok ? undefined : `verifierOk=${verifierOk} fixturesOk=${fixturesOk}` };
  },
);

// =============================================================================
// C7-10 -- counterfactual separation: LOAD-BEARING check is a verifier-built
// pair differing in EXACTLY one composition element (mechanically diffed --
// F10 "only one axis changed"), from real directiveInventory data
// =============================================================================
await probe(
  'C7-10',
  `dynamic-import ${SCORER_INDEX_PATH}; build a verifier base/swapped pair from real directiveInventory data where EXACTLY ONE composition element's sourceId differs (mechanically diff-checked); score both and assert the swapped axis's score moves by more than floors.counterfactualMinDelta (> 0, F10/F12); repeat over every eligible corpus case (>=3) for population-style coverage; ALSO score implementer fixtures under ${COUNTERFACTUAL_DIR} (blinded + corpus-checked) as an additional, non-load-bearing check`,
  `floors.counterfactualMinDelta is a number > 0; for >=3 corpus cases, a verifier-built pair whose composition arrays differ in exactly 1 of N elements produces |scoreComposition(base).axes[axis] - scoreComposition(swapped).axes[axis]| > counterfactualMinDelta on the swapped directive's axis; implementer-provided ${COUNTERFACTUAL_DIR}/<pair-id>/{base,swapped}/input.json fixtures (>=3 pairs) show the same separation as an additional check`,
  async () => {
    const floors = readJson<{ counterfactualMinDelta?: number }>(FLOORS_PATH);
    if (floors === null || typeof floors.counterfactualMinDelta !== 'number' || floors.counterfactualMinDelta <= 0) {
      return { ok: false, evidence: `${FLOORS_PATH}.counterfactualMinDelta must be a number > 0, got ${floors?.counterfactualMinDelta}` };
    }
    const minDelta = floors.counterfactualMinDelta;

    const imported = await importEvalModule(SCORER_INDEX_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const scoreComposition = imported.mod['scoreComposition'];
    if (typeof scoreComposition !== 'function') return { ok: false, evidence: `${SCORER_INDEX_PATH} does not export scoreComposition` };

    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot run: ${error}` };
    const eligibleCases = manifest.cases.filter((c) => !c.sealed && !c.skip && c.sources.length >= 2 && c.directiveInventory.length >= 1);
    if (eligibleCases.length < 3) return { ok: false, evidence: `only ${eligibleCases.length} eligible corpus cases (non-sealed, non-skip, >=2 sources, >=1 directiveInventory entries), need >=3` };

    const lines: string[] = [];
    let verifierFailures = 0;
    let verifierAttempts = 0;
    for (const c of eligibleCases) {
      const pair = swapOneDirective(c);
      if (!pair) {
        lines.push(`${c.id}: could not construct a single-element swap`);
        continue;
      }
      verifierAttempts++;
      if (pair.diffCount !== 1) {
        verifierFailures++;
        lines.push(`${c.id}: base/swapped composition differ in ${pair.diffCount} elements, expected exactly 1`);
        continue;
      }
      const baseInput: ScoringInput = { caseId: c.id, composition: pair.base };
      const swappedInput: ScoringInput = { caseId: c.id, composition: pair.swapped };
      // eslint-disable-next-line no-await-in-loop
      const baseResult = (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(baseInput)) as { axes?: Record<string, number> };
      // eslint-disable-next-line no-await-in-loop
      const swappedResult = (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(swappedInput)) as { axes?: Record<string, number> };
      const rangeErrors = [...scoreRangeErrors(baseResult), ...scoreRangeErrors(swappedResult)];
      if (rangeErrors.length > 0) {
        verifierFailures++;
        lines.push(`${c.id}: ${rangeErrors.join('; ')}`);
        continue;
      }
      const baseScore = baseResult.axes?.[pair.axis];
      const swappedScore = swappedResult.axes?.[pair.axis];
      if (typeof baseScore !== 'number' || typeof swappedScore !== 'number') {
        verifierFailures++;
        lines.push(`${c.id}: axis "${pair.axis}" not scored on one side`);
        continue;
      }
      const delta = Math.abs(baseScore - swappedScore);
      const ok = delta > minDelta;
      if (!ok) verifierFailures++;
      lines.push(`${c.id}: axis=${pair.axis} diffCount=${pair.diffCount} base=${baseScore.toFixed(3)} swapped=${swappedScore.toFixed(3)} delta=${delta.toFixed(3)} (min ${minDelta}) -- ${ok ? 'OK' : 'FAIL'}`);
    }
    if (verifierAttempts < 3) verifierFailures++;

    // Additional, non-load-bearing: implementer fixtures.
    const fixtureLines: string[] = [];
    let fixtureFailures = 0;
    const dir = abs(COUNTERFACTUAL_DIR);
    const pairIds = fs.existsSync(dir) ? fs.readdirSync(dir).filter((e) => fs.statSync(path.join(dir, e)).isDirectory()) : [];
    if (pairIds.length < 3) {
      fixtureFailures++;
      fixtureLines.push(`only ${pairIds.length} counterfactual fixture pairs, need >=3`);
    }
    for (const pairId of pairIds) {
      const meta = readJson<{ swappedAxis?: string }>(path.join(COUNTERFACTUAL_DIR, pairId, 'meta.json'));
      const axis = meta?.swappedAxis;
      const baseLoaded = loadBlindedFixture(path.join(COUNTERFACTUAL_DIR, pairId, 'base'), manifest);
      const swappedLoaded = loadBlindedFixture(path.join(COUNTERFACTUAL_DIR, pairId, 'swapped'), manifest);
      if (!axis || !baseLoaded.ok || !swappedLoaded.ok) {
        fixtureFailures++;
        fixtureLines.push(`${pairId}: incomplete (axis=${axis}, base=${baseLoaded.ok}, swapped=${swappedLoaded.ok})`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const baseResult = (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(baseLoaded.input)) as { axes?: Record<string, number> };
      // eslint-disable-next-line no-await-in-loop
      const swappedResult = (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(swappedLoaded.input)) as { axes?: Record<string, number> };
      const baseScore = baseResult.axes?.[axis];
      const swappedScore = swappedResult.axes?.[axis];
      if (typeof baseScore !== 'number' || typeof swappedScore !== 'number' || Math.abs(baseScore - swappedScore) <= minDelta) {
        fixtureFailures++;
        fixtureLines.push(`${pairId}: axis=${axis} base=${baseScore} swapped=${swappedScore} did not separate beyond minDelta`);
      } else {
        fixtureLines.push(`${pairId}: axis=${axis} base=${baseScore.toFixed(3)} swapped=${swappedScore.toFixed(3)} -- OK`);
      }
    }

    const ok = verifierFailures === 0 && fixtureFailures === 0;
    const evidence = [`verifier-constructed pairs (${verifierAttempts} attempted):`, ...lines, `implementer fixtures (additional, non-load-bearing, ${pairIds.length} pairs):`, ...fixtureLines].join('\n');
    return { ok, evidence, detail: ok ? undefined : `verifierFailures=${verifierFailures} fixtureFailures=${fixtureFailures}` };
  },
);

// =============================================================================
// C7-11 -- held-out split is REALLY sealed: encrypted-blob-only in-tree,
// decrypt-and-hash-verify, and a repo-wide plaintext-leak scan (F11)
// =============================================================================
await probe(
  'C7-11',
  `read ${SEALED_ACCESS_PATH}; decrypt every sealed case's IR + snapshot blobs with the seal key and hash-check against the manifest's recorded plaintext hashes; scan every git-tracked file under evals/ for accidental plaintext leakage of any sealed hash`,
  `${SEALED_ACCESS_PATH} names every sealed case id, records its plaintext irSha256, and states an access-control statement; manifest.sealedFraction matches the actual sealed fraction within 0.02; every sealed case's irPath and every sealed snapshot path end in ".enc"; decrypting each blob with the seal key (${SEAL_KEY_PATH}) and re-hashing yields exactly the manifest's recorded plaintext hash; NO git-tracked file under evals/ (other than the .enc blobs themselves) has content matching any sealed case's plaintext irSha256 or snapshot sha256 -- a plaintext leak anywhere is a hard fail`,
  async () => {
    const text = readText(SEALED_ACCESS_PATH);
    if (text === null) return { ok: false, evidence: `missing ${SEALED_ACCESS_PATH}` };
    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot cross-check: ${error}` };
    const sealedCases = manifest.cases.filter((c) => c.sealed);
    if (sealedCases.length === 0) return { ok: false, evidence: 'manifest has zero sealed cases' };

    const actualFraction = sealedCases.length / manifest.cases.length;
    const fractionOk = Math.abs(actualFraction - manifest.sealedFraction) <= 0.02;
    const missingFromDoc = sealedCases.filter((c) => !text.includes(c.id));
    const hasAccessStatement = /must not|forbidden|access.?control|not readable|no access/i.test(text);

    const forbiddenHashes = new Set<string>();
    const lines: string[] = [];
    let decryptFailures = 0;
    for (const c of sealedCases) {
      if (!c.irPath.endsWith('.enc')) {
        decryptFailures++;
        lines.push(`${c.id}: irPath does not end in .enc (${c.irPath})`);
      } else {
        const decrypted = decryptToBytes(c.irPath, `${c.id}-seal-verify`);
        if (!decrypted.ok) {
          decryptFailures++;
          lines.push(`${c.id}: ${decrypted.error}`);
        } else {
          const actualHash = sha256Buffer(decrypted.bytes);
          if (actualHash !== c.irSha256) {
            decryptFailures++;
            lines.push(`${c.id}: decrypted IR hash mismatch (manifest=${c.irSha256} actual=${actualHash})`);
          } else {
            lines.push(`${c.id}: decrypted IR hash confirmed`);
          }
          forbiddenHashes.add(c.irSha256);
        }
      }
      if (!text.includes(c.irSha256 ?? '')) {
        decryptFailures++;
        lines.push(`${c.id}: irSha256 not recorded verbatim in ${SEALED_ACCESS_PATH}`);
      }
      for (const source of c.sources) {
        for (const [bp, ref] of Object.entries(source.snapshots)) {
          const label = `${c.id}/${source.id}/${bp}`;
          if (!ref.path.endsWith('.enc')) {
            decryptFailures++;
            lines.push(`${label}: snapshot path does not end in .enc (${ref.path})`);
            continue;
          }
          const decrypted = decryptToBytes(ref.path, label);
          if (!decrypted.ok) {
            decryptFailures++;
            lines.push(`${label}: ${decrypted.error}`);
            continue;
          }
          const actualHash = sha256Buffer(decrypted.bytes);
          if (actualHash !== ref.sha256) {
            decryptFailures++;
            lines.push(`${label}: decrypted snapshot hash mismatch (manifest=${ref.sha256} actual=${actualHash})`);
          }
          forbiddenHashes.add(ref.sha256);
        }
      }
    }

    // Repo-wide plaintext-leak scan over every git-tracked file under evals/.
    const tracked = sh('git', ['ls-files', 'evals']);
    const leaks: string[] = [];
    if (tracked.status === 0) {
      for (const rel of tracked.stdout.split('\n').filter(Boolean)) {
        if (rel.endsWith('.enc')) continue;
        const h = sha256File(rel);
        if (h && forbiddenHashes.has(h)) leaks.push(`${rel} (hash ${h}) matches a sealed plaintext hash`);
      }
    } else {
      leaks.push(`could not run git ls-files evals to scan for leaks (status=${tracked.status})`);
    }

    const evidence = [
      `sealedFraction manifest=${manifest.sealedFraction} actual=${actualFraction.toFixed(3)} ok=${fractionOk}`,
      `sealed cases named in ${SEALED_ACCESS_PATH}: ${sealedCases.length - missingFromDoc.length}/${sealedCases.length} (missing: ${missingFromDoc.map((c) => c.id).join(', ') || 'none'})`,
      `access-control statement present: ${hasAccessStatement}`,
      `decrypt+hash checks: ${decryptFailures === 0 ? 'all OK' : `${decryptFailures} failures`}`,
      `plaintext-leak scan over ${tracked.status === 0 ? tracked.stdout.split('\n').filter(Boolean).length : 0} tracked evals/ files: ${leaks.length === 0 ? 'clean' : leaks.join('; ')}`,
      ...lines,
    ].join('\n');
    const ok = fractionOk && missingFromDoc.length === 0 && hasAccessStatement && decryptFailures === 0 && leaks.length === 0;
    return { ok, evidence, detail: ok ? undefined : 'seal record incomplete, decrypt/hash mismatch, or plaintext leak detected' };
  },
);

// =============================================================================
// C7-12 -- absolute floors frozen and non-vacuous (F12: every floor > 0)
// =============================================================================
await probe(
  'C7-12',
  `read ${FLOORS_PATH}; assert version + all 11 axis floors present, numeric, and STRICTLY > 0; assert counterfactualMinDelta > 0; record its sha256`,
  `${FLOORS_PATH} has a numeric "version", a "floors" object with a numeric entry STRICTLY > 0 (and <= 1) for every axis in [${REQUIRED_AXES.join(', ')}] -- a floor of exactly 0 is vacuous and fails -- and a numeric "counterfactualMinDelta" > 0; its sha256 is recorded in this criterion's artifact so a later silent edit is detectable by hash drift`,
  async () => {
    const raw = readText(FLOORS_PATH);
    if (raw === null) return { ok: false, evidence: `missing ${FLOORS_PATH}` };
    const parsed = readJson<{ version?: number; floors?: Record<string, number>; counterfactualMinDelta?: number }>(FLOORS_PATH);
    if (parsed === null) return { ok: false, evidence: `${FLOORS_PATH} is not valid JSON` };
    if (typeof parsed.version !== 'number') return { ok: false, evidence: `${FLOORS_PATH} missing numeric "version"` };
    if (!parsed.floors) return { ok: false, evidence: `${FLOORS_PATH} missing "floors" object` };
    const bad = REQUIRED_AXES.filter((a) => typeof parsed.floors?.[a] !== 'number' || (parsed.floors[a] as number) <= 0 || (parsed.floors[a] as number) > 1);
    const deltaOk = typeof parsed.counterfactualMinDelta === 'number' && parsed.counterfactualMinDelta > 0;
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const ok = bad.length === 0 && deltaOk;
    return {
      ok,
      evidence: `version=${parsed.version}\nfloors=${JSON.stringify(parsed.floors, null, 2)}\ncounterfactualMinDelta=${parsed.counterfactualMinDelta}\nsha256=${hash}`,
      detail: ok ? undefined : `axes with missing/zero/out-of-range floors: ${bad.join(', ')}${deltaOk ? '' : '; counterfactualMinDelta must be > 0'}`,
    };
  },
);

// =============================================================================
// C7-13 -- scorer versioned (real semver) and deterministic across the SAME
// process, a FRESH subprocess with different env (F13 cross-run proxy), and
// pinned in a dedicated eval-manifest.json cross-checked against floors/corpus
// =============================================================================
await probe(
  'C7-13',
  `dynamic-import ${SCORER_INDEX_PATH}; require SCORER_VERSION matches semver; cross-check ${EVAL_MANIFEST_PATH} pins the same scorer/floors/corpus versions; call scoreComposition twice in-process AND once more in a freshly-spawned node subprocess with different HOSTNAME/TZ/LANG env, and require all three results are byte-identical`,
  `${SCORER_INDEX_PATH} exports SCORER_VERSION matching /^\\d+\\.\\d+\\.\\d+$/; ${EVAL_MANIFEST_PATH} has {scorerVersion, floorsVersion, corpusVersion} matching the live SCORER_VERSION, ${FLOORS_PATH}.version, and ${MANIFEST_PATH}.version respectively; scoreComposition(${DETERMINISM_FIXTURE_PATH}) called twice in this process AND once in a child process spawned with HOSTNAME=verifier-control-host TZ=UTC LANG=C yields stable-stringify-identical results across all three`,
  async () => {
    const imported = await importEvalModule(SCORER_INDEX_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const version = imported.mod['SCORER_VERSION'];
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return { ok: false, evidence: `${SCORER_INDEX_PATH} SCORER_VERSION must be a semver string (X.Y.Z), got ${JSON.stringify(version)}` };
    const scoreComposition = imported.mod['scoreComposition'];
    if (typeof scoreComposition !== 'function') return { ok: false, evidence: `${SCORER_INDEX_PATH} does not export scoreComposition` };

    const evalManifest = readJson<{ scorerVersion?: string; floorsVersion?: number; corpusVersion?: number }>(EVAL_MANIFEST_PATH);
    if (evalManifest === null) return { ok: false, evidence: `missing or invalid ${EVAL_MANIFEST_PATH}` };
    const floorsDoc = readJson<{ version?: number }>(FLOORS_PATH);
    const { manifest } = loadManifest();
    const pinProblems: string[] = [];
    if (evalManifest.scorerVersion !== version) pinProblems.push(`scorerVersion ${evalManifest.scorerVersion} !== live SCORER_VERSION ${version}`);
    if (!floorsDoc || evalManifest.floorsVersion !== floorsDoc.version) pinProblems.push(`floorsVersion ${evalManifest.floorsVersion} !== ${FLOORS_PATH}.version ${floorsDoc?.version}`);
    if (!manifest || evalManifest.corpusVersion !== manifest.version) pinProblems.push(`corpusVersion ${evalManifest.corpusVersion} !== ${MANIFEST_PATH}.version ${manifest?.version}`);
    if (pinProblems.length > 0) return { ok: false, evidence: pinProblems.join('; ') };

    const input = readJson<unknown>(DETERMINISM_FIXTURE_PATH);
    if (input === null) return { ok: false, evidence: `missing or invalid ${DETERMINISM_FIXTURE_PATH}` };

    const run1 = await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(structuredClone(input));
    const run2 = await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(structuredClone(input));
    const inProcessEqual = stableStringify(run1) === stableStringify(run2);

    // Fresh subprocess with deliberately different hostname/timezone/locale
    // env -- a scorer that reads process.platform/os.hostname()/Date-locale
    // instead of pure input data will diverge here even though it can't
    // diverge across two in-process calls.
    const runnerPath = path.join(proofDir, 'C7-13-subprocess-runner.mjs');
    const outPath = path.join(proofDir, 'C7-13-subprocess-result.json');
    fs.writeFileSync(
      runnerPath,
      [
        `import { pathToFileURL } from 'node:url';`,
        `import fs from 'node:fs';`,
        `const mod = await import(pathToFileURL(${JSON.stringify(abs(SCORER_INDEX_PATH))}).href);`,
        `const input = JSON.parse(fs.readFileSync(${JSON.stringify(abs(DETERMINISM_FIXTURE_PATH))}, 'utf8'));`,
        `const result = await mod.scoreComposition(input);`,
        `fs.writeFileSync(${JSON.stringify(outPath)}, JSON.stringify(result));`,
      ].join('\n'),
    );
    const subprocess = sh('node', ['--import', 'tsx', runnerPath], repoRoot);
    let subprocessEqual = false;
    let subprocessDetail = `subprocess exit=${subprocess.status}`;
    if (subprocess.status === 0 && fs.existsSync(outPath)) {
      try {
        const run3 = JSON.parse(fs.readFileSync(outPath, 'utf8')) as unknown;
        subprocessEqual = stableStringify(run3) === stableStringify(run1);
        subprocessDetail += ` result=${stableStringify(run3)}`;
      } catch (e) {
        subprocessDetail += ` (failed to read/parse subprocess result: ${(e as Error).message})`;
      }
    } else {
      subprocessDetail += ` stderr=${subprocess.stderr}`;
    }

    const ok = inProcessEqual && subprocessEqual;
    return {
      ok,
      evidence: `SCORER_VERSION=${version}\nrun1=${stableStringify(run1)}\nrun2=${stableStringify(run2)}\ninProcessEqual=${inProcessEqual}\n${subprocessDetail}\nsubprocessEqual=${subprocessEqual}`,
      detail: ok ? undefined : `inProcessEqual=${inProcessEqual} subprocessEqual=${subprocessEqual}`,
    };
  },
);

// =============================================================================
// C7-14 -- NL->IR goldens exist with a REAL typed parse interface (F14: an
// `export {}` stub must fail)
// =============================================================================
await probe(
  'C7-14',
  `read ${NL_GOLDENS_PATH} (>=5 pairs); statically require a typed "parse(input: string): <IR-referencing type>" export in ${NL_PARSER_PATH}; dynamic-import it and call parse() (a NotImplemented throw is acceptable, silent absence is not); typecheck all evals/**/*.ts`,
  `${NL_GOLDENS_PATH} has >=5 { id, nlDirective, expectedIR } pairs where expectedIR contains at least an "axis" and "source" field; ${NL_PARSER_PATH} contains a source-level \`export function parse(input: string): ...\` or \`export const parse: (input: string) => ...\` signature whose return type is not void/any/unknown and whose text references an IR-shaped type -- a file containing only \`export {}\` fails this by construction; the exported parse is actually a function and either returns or throws (never undefined/missing) when called; every .ts file under evals/ typechecks cleanly`,
  async () => {
    const goldens = readJson<Array<{ id?: string; nlDirective?: string; expectedIR?: { axis?: string; source?: string } }>>(NL_GOLDENS_PATH);
    if (goldens === null || !Array.isArray(goldens)) return { ok: false, evidence: `missing or invalid ${NL_GOLDENS_PATH}` };
    if (goldens.length < 5) return { ok: false, evidence: `only ${goldens.length} golden pairs, need >=5` };
    const malformed = goldens.filter((g) => !g.id || !g.nlDirective || !g.expectedIR?.axis || !g.expectedIR?.source);
    if (malformed.length > 0) return { ok: false, evidence: `${malformed.length} golden(s) missing id/nlDirective/expectedIR.axis/expectedIR.source` };

    const parserText = readText(NL_PARSER_PATH);
    if (parserText === null) return { ok: false, evidence: `missing ${NL_PARSER_PATH}` };
    const sigMatch = /export\s+(?:async\s+)?function\s+parse\s*\(\s*\w+\s*:\s*string\s*\)\s*:\s*([^{;]+)/.exec(parserText) ?? /export\s+const\s+parse\s*:\s*\(\s*\w+\s*:\s*string\s*\)\s*=>\s*([^;=]+)/.exec(parserText);
    if (!sigMatch) {
      return { ok: false, evidence: `${NL_PARSER_PATH} does not contain a source-level "export function parse(input: string): ..." or "export const parse: (input: string) => ..." signature -- an \`export {}\`-only file (or any file lacking a typed parse export) fails this criterion by construction (F14)` };
    }
    const returnType = sigMatch[1]!.trim();
    if (/^(void|any|unknown)\b/.test(returnType)) {
      return { ok: false, evidence: `${NL_PARSER_PATH} parse() return type "${returnType}" is void/any/unknown -- must reference a concrete IR-shaped type` };
    }

    const imported = await importEvalModule(NL_PARSER_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const parseFn = imported.mod['parse'];
    if (typeof parseFn !== 'function') return { ok: false, evidence: `${NL_PARSER_PATH} does not export a callable "parse" function at runtime` };
    let callBehavior: string;
    try {
      const out = (parseFn as (s: string) => unknown)(goldens[0]!.nlDirective!);
      callBehavior = out === undefined ? 'FAIL: parse() returned undefined' : `returned ${typeof out}`;
    } catch (e) {
      callBehavior = `threw (acceptable stub behavior): ${(e as Error).message}`;
    }
    if (callBehavior.startsWith('FAIL')) return { ok: false, evidence: callBehavior };

    const evalsTsFiles = listFilesRecursive(abs('evals')).filter((f) => f.endsWith('.ts'));
    if (evalsTsFiles.length === 0) return { ok: false, evidence: 'no .ts files found under evals/ to typecheck' };
    const tmpTsconfig = path.join(proofDir, 'C7-14-tsconfig.json');
    fs.writeFileSync(
      tmpTsconfig,
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            lib: ['ES2022'],
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            noUncheckedIndexedAccess: true,
            exactOptionalPropertyTypes: true,
            allowImportingTsExtensions: true,
            noEmit: true,
            isolatedModules: true,
            esModuleInterop: true,
            skipLibCheck: true,
            types: ['node'],
          },
          include: evalsTsFiles,
        },
        null,
        2,
      ),
    );
    const tsc = sh('pnpm', ['exec', 'tsc', '-p', tmpTsconfig, '--noEmit']);
    const ok = tsc.status === 0;
    return {
      ok,
      evidence: `golden pairs: ${goldens.length}\nparse() signature return type: ${returnType}\nruntime call: ${callBehavior}\ntsc exit=${tsc.status}\n${tsc.stdout}`,
      detail: ok ? undefined : 'evals/**/*.ts does not typecheck',
    };
  },
);

// =============================================================================
// C7-15 -- feasibility spike documented, SUBSTANTIVELY (F17: "- none" fails)
// =============================================================================
const IR_FIELD_TOKENS = [...REQUIRED_IR_TOP_KEYS, ...REQUIRED_PROVENANCE_ENTRY_KEYS, 'axis', 'scope', 'strength', 'source'];
const MIN_SPIKE_ITEM_LENGTH = 40;

await probe(
  'C7-15',
  `read ${SPIKE_DOC_PATH}; require non-empty "## Case", and >=1 SUBSTANTIVE (>=${MIN_SPIKE_ITEM_LENGTH} chars) list item under "## IR insufficiencies found" grounded in a concrete IR field name, and >=1 substantive item under "## Responses" likewise grounded; the case id must exist in ${MANIFEST_PATH}`,
  `"## Case" names a real corpus case id; "## IR insufficiencies found" has >=1 list item of length >= ${MIN_SPIKE_ITEM_LENGTH} chars, and the section's text mentions >=2 distinct IR field-name tokens from [${IR_FIELD_TOKENS.join(', ')}]; "## Responses" has >=1 list item of length >= ${MIN_SPIKE_ITEM_LENGTH} chars and mentions >=1 such token -- a placeholder like "- none" fails both the length and the field-grounding check`,
  async () => {
    const text = readText(SPIKE_DOC_PATH);
    if (text === null) return { ok: false, evidence: `missing ${SPIKE_DOC_PATH}` };
    const section = (heading: string): string => {
      const re = new RegExp(`##\\s*${heading}[^\\n]*\\n([\\s\\S]*?)(\\n##\\s|$)`, 'i');
      return (text.match(re)?.[1] ?? '').trim();
    };
    const caseSection = section('Case');
    const insufficienciesSection = section('IR insufficiencies');
    const responsesSection = section('Responses');
    const listItemTexts = (s: string): string[] =>
      s
        .split(/\n(?=[-*]\s|\d+\.\s)/)
        .map((item) => item.replace(/^[-*]\s|^\d+\.\s/, '').trim())
        .filter(Boolean);
    const insufficiencyItems = listItemTexts(insufficienciesSection);
    const responseItems = listItemTexts(responsesSection);
    const substantive = (items: string[]): string[] => items.filter((i) => i.length >= MIN_SPIKE_ITEM_LENGTH);
    const tokensIn = (s: string): number => IR_FIELD_TOKENS.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(s)).length;

    const problems: string[] = [];
    if (caseSection.length === 0) problems.push('"## Case" section missing or empty');
    const substantiveInsuff = substantive(insufficiencyItems);
    if (substantiveInsuff.length === 0) problems.push(`"## IR insufficiencies found" has no list item >= ${MIN_SPIKE_ITEM_LENGTH} chars (found ${insufficiencyItems.length} items, longest=${Math.max(0, ...insufficiencyItems.map((i) => i.length))})`);
    if (tokensIn(insufficienciesSection) < 2) problems.push(`"## IR insufficiencies found" mentions fewer than 2 distinct IR field-name tokens`);
    const substantiveResp = substantive(responseItems);
    if (substantiveResp.length === 0) problems.push(`"## Responses" has no list item >= ${MIN_SPIKE_ITEM_LENGTH} chars (found ${responseItems.length} items, longest=${Math.max(0, ...responseItems.map((i) => i.length))})`);
    if (tokensIn(responsesSection) < 1) problems.push(`"## Responses" mentions no IR field-name token`);

    const { manifest } = loadManifest();
    const caseIdMatch = caseSection.match(/[a-zA-Z0-9_-]+/);
    const referencedId = caseIdMatch?.[0];
    const caseExists = manifest ? manifest.cases.some((c) => c.id === referencedId) : false;
    if (!caseExists) problems.push(`referenced case id "${referencedId ?? '(none found)'}" not present in ${MANIFEST_PATH}`);

    return {
      ok: problems.length === 0,
      evidence: `case section: ${caseSection.slice(0, 200)}\ninsufficiency items: ${insufficiencyItems.length} (substantive: ${substantiveInsuff.length}), field tokens: ${tokensIn(insufficienciesSection)}\nresponse items: ${responseItems.length} (substantive: ${substantiveResp.length}), field tokens: ${tokensIn(responsesSection)}\nreferenced case exists in manifest: ${caseExists}`,
      detail: problems.length > 0 ? problems.join('; ') : undefined,
    };
  },
);

// =============================================================================
// C7-16 -- human: go/no-go recorded (never mechanically "pass")
// =============================================================================
await (async () => {
  const startedAt = Date.now();
  const command = `read ${GO_NO_GO_PATH}`;
  const assertion = `${GO_NO_GO_PATH} is the founder go/no-go record. Structure only, never judgment: requires a non-empty "## Founder" line naming an identity, a "## Reviewer 1" section (GPT-5.6 Sol) with a "Verdict: GO" or "Verdict: NO-GO" line plus non-empty rationale, a "## Reviewer 2" section (Grok 4.5) with the same shape, and a "## Overall decision" with "Decision: GO" or "Decision: NO-GO". This criterion NEVER reports "pass": it is "fail" while the record is missing/incomplete and "blocked-on-founder" once structurally complete -- only a human landing decision outside this verifier can close it (VERIFICATION-CONTRACT.md S2 rule 3, S3 R7)`;
  try {
    const text = readText(GO_NO_GO_PATH);
    if (text === null) {
      record('C7-16', command, assertion, 'fail', `missing ${GO_NO_GO_PATH}`, startedAt, 'go/no-go record does not exist yet');
      return;
    }
    const founderLine = /##\s*Founder[^\n]*\n+([^\n#]+)/i.exec(text);
    const founderOk = !!founderLine && founderLine[1]!.trim().length > 0;
    const verdictBlock = (label: string, needle: RegExp): { present: boolean; verdictOk: boolean; rationaleOk: boolean } => {
      const m = needle.exec(text);
      if (!m) return { present: false, verdictOk: false, rationaleOk: false };
      const block = m[0];
      const verdict = /Verdict:\s*(GO|NO-GO)/i.exec(block);
      const rationaleLen = block.replace(/##[^\n]*\n/, '').replace(/Verdict:[^\n]*\n?/i, '').trim().length;
      return { present: true, verdictOk: !!verdict, rationaleOk: rationaleLen > 20 };
    };
    const r1 = verdictBlock('Reviewer 1', /##\s*Reviewer 1[^\n]*\n([\s\S]*?)(\n##\s|$)/i);
    const r2 = verdictBlock('Reviewer 2', /##\s*Reviewer 2[^\n]*\n([\s\S]*?)(\n##\s|$)/i);
    const overallMatch = /##\s*Overall decision[^\n]*\n([\s\S]*?)(\n##\s|$)/i.exec(text);
    const overallDecisionOk = !!overallMatch && /Decision:\s*(GO|NO-GO)/i.test(overallMatch[1] ?? '');
    const sol = /sol/i.test(text) && /gpt-?5\.6/i.test(text);
    const grok = /grok/i.test(text);

    const problems: string[] = [];
    if (!founderOk) problems.push('missing/empty "## Founder" identity line');
    if (!r1.present || !r1.verdictOk || !r1.rationaleOk) problems.push(`Reviewer 1 section incomplete (present=${r1.present} verdict=${r1.verdictOk} rationale=${r1.rationaleOk})`);
    if (!r2.present || !r2.verdictOk || !r2.rationaleOk) problems.push(`Reviewer 2 section incomplete (present=${r2.present} verdict=${r2.verdictOk} rationale=${r2.rationaleOk})`);
    if (!overallDecisionOk) problems.push('missing "## Overall decision" with a Decision: GO|NO-GO line');
    if (!sol) problems.push('Reviewer 1 does not identify GPT-5.6 Sol');
    if (!grok) problems.push('Reviewer 2 does not identify Grok');

    const evidence = `founderOk=${founderOk}\nreviewer1=${JSON.stringify(r1)}\nreviewer2=${JSON.stringify(r2)}\noverallDecisionOk=${overallDecisionOk}\nidentifiesSol=${sol}\nidentifiesGrok=${grok}`;
    if (problems.length > 0) {
      record('C7-16', command, assertion, 'fail', evidence, startedAt, problems.join('; '));
    } else {
      record('C7-16', command, assertion, 'blocked-on-founder', evidence, startedAt, 'record is structurally complete; awaiting/reflecting the human landing decision, never auto-passed');
    }
  } catch (error) {
    record('C7-16', command, assertion, 'fail', `probe threw: ${(error as Error).stack ?? String(error)}`, startedAt, 'probe crashed instead of failing cleanly');
  }
})();

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

function runNodeTest(files: string[]): { status: number; stdout: string; tests: { name: string; pass: boolean }[] } {
  const run = sh('node', ['--import', 'tsx', '--test', ...files.map((f) => abs(f))]);
  const tests: { name: string; pass: boolean }[] = [];
  // Node's built-in test runner default ("spec") reporter emits lines like
  // "  ✔ test name (1.2ms)" / "  ✖ test name (1.2ms)" for both TTY and
  // piped/non-TTY output on Node 24 -- not the TAP "ok N - name" format.
  const re = /^\s*(✔|✖)\s+(.+?)(?:\s+\([\d.]+m?s\))?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(run.stdout)) !== null) {
    tests.push({ name: m[2]!.trim(), pass: m[1] === '✔' });
  }
  return { status: run.status, stdout: run.stdout, tests };
}

// =============================================================================
// GATE-INTEGRITY (F1) -- once an approval round pins this file's sha256,
// every later run hard-fails on any drift. Before any approval exists, this
// is advisory only (the hash is simply recorded for the orchestrator).
// =============================================================================
const selfBytes = fs.readFileSync(fileURLToPath(import.meta.url));
const selfSha256 = sha256Buffer(selfBytes);
await (async () => {
  const startedAt = Date.now();
  const command = `sha256(scripts/waves/verify-w7.ts) vs ${APPROVED_GATE_SHA_PATH}`;
  const assertion = `once an approval round writes approved-gate.sha256, this verifier's own sha256 must match it on every subsequent run -- a post-approval edit to verify-w7.ts (e.g. to fake unconditional passes) is a hard fail, closing the hole where the wave's own lease legitimately permits editing this file (VERIFICATION-CONTRACT S1); before any approval exists (file missing) this is advisory only`;
  try {
    if (!fs.existsSync(APPROVED_GATE_SHA_PATH)) {
      record('GATE-INTEGRITY', command, assertion, 'pass', `no ${APPROVED_GATE_SHA_PATH} yet -- advisory only. current self sha256=${selfSha256} (recorded here for the orchestrator to pin after this round's approval)`, startedAt);
    } else {
      const approved = fs.readFileSync(APPROVED_GATE_SHA_PATH, 'utf8').trim();
      const match = approved === selfSha256;
      record('GATE-INTEGRITY', command, assertion, match ? 'pass' : 'fail', `approved=${approved}\nactual=${selfSha256}\nmatch=${match}`, startedAt, match ? undefined : 'verify-w7.ts has been modified since gate approval -- possible gate tampering (F1)');
    }
  } catch (error) {
    record('GATE-INTEGRITY', command, assertion, 'fail', `probe threw: ${(error as Error).stack ?? String(error)}`, startedAt, 'probe crashed instead of failing cleanly');
  }
})();

// =============================================================================
// LEASE check (R9) -- F15: every git call's exit status is checked; the base
// commit is resolved from the REAL remote (git ls-remote) rather than a
// potentially-tampered local origin/main ref; an empty diff against
// non-empty branch history, or any unresolvable git identity, fails closed.
// =============================================================================
function resolveRemoteMainSha(): { sha: string | null; source: 'ls-remote' | 'local-ref' | 'unavailable'; warning: string } {
  const lsRemote = sh('git', ['ls-remote', 'origin', 'main']);
  if (lsRemote.status === 0 && lsRemote.stdout.trim().length > 0) {
    const sha = lsRemote.stdout.trim().split('\n')[0]?.split('\t')[0]?.trim();
    if (sha && /^[0-9a-f]{40}$/i.test(sha)) {
      const catCheck = sh('git', ['cat-file', '-e', sha]);
      if (catCheck.status === 0) return { sha, source: 'ls-remote', warning: '' };
      return { sha: null, source: 'unavailable', warning: `remote origin/main resolved to ${sha} via ls-remote but that commit is not present locally (needs fetch)` };
    }
  }
  const localRef = sh('git', ['rev-parse', 'origin/main']);
  if (localRef.status === 0 && localRef.stdout.trim().length > 0) {
    return { sha: localRef.stdout.trim(), source: 'local-ref', warning: 'git ls-remote origin main was unavailable/unparseable -- fell back to the local refs/remotes/origin/main ref, which a local ref update could tamper with' };
  }
  return { sha: null, source: 'unavailable', warning: 'neither git ls-remote origin main nor local origin/main ref resolved' };
}

const remoteMain = resolveRemoteMainSha();
let baseCommit = '';
let baseWarning = remoteMain.warning;
if (remoteMain.sha) {
  const mb = sh('git', ['merge-base', remoteMain.sha, 'HEAD']);
  if (mb.status === 0 && mb.stdout.trim()) baseCommit = mb.stdout.trim();
  else baseWarning += `${baseWarning ? '; ' : ''}merge-base against resolved main sha ${remoteMain.sha} failed (status=${mb.status}): ${mb.stderr}`;
}
const headShaResult = sh('git', ['rev-parse', 'HEAD']);
const headSha = headShaResult.status === 0 ? headShaResult.stdout.trim() : '';
const gitIdentityOk = /^[0-9a-f]{40}$/i.test(headSha);

const LEASE_ALLOW = ['docs/specs/', 'evals/', 'docs/plans/waves/'];
const LEASE_ALLOW_EXACT = ['scripts/waves/verify-w7.ts'];

await (async () => {
  const startedAt = Date.now();
  const command = `git diff --name-only <base resolved via git ls-remote origin main>...HEAD ⊆ leases.json[W7].allow`;
  const assertion = 'no writes outside docs/specs/**, evals/**, scripts/waves/verify-w7.ts, docs/plans/waves/**; the base commit is resolved from the real remote when reachable (never silently trusted from a possibly-tampered local ref), every git invocation`s exit status is checked, and an empty diff against a non-empty commit range fails closed';
  try {
    if (!gitIdentityOk) {
      record('LEASE', command, assertion, 'fail', `cannot resolve HEAD sha (status=${headShaResult.status}, stdout="${headShaResult.stdout}"); refusing to trust an empty/ambiguous git identity`, startedAt, 'unresolvable HEAD');
      return;
    }
    if (!baseCommit) {
      record('LEASE', command, assertion, 'fail', `cannot resolve a trustworthy base commit for the lease diff (${baseWarning || 'no remote/local main ref resolved'}); refusing to silently trust an empty diff`, startedAt, 'unresolvable base commit');
      return;
    }
    const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
    if (diffResult.status !== 0) {
      record('LEASE', command, assertion, 'fail', `git diff --name-only ${baseCommit}...HEAD failed (status=${diffResult.status}): ${diffResult.stderr}`, startedAt, 'git diff failed');
      return;
    }
    const diffNames = diffResult.stdout.trim().split('\n').filter(Boolean);
    const commitCountResult = sh('git', ['rev-list', '--count', `${baseCommit}..HEAD`]);
    const commitCount = commitCountResult.status === 0 ? parseInt(commitCountResult.stdout.trim(), 10) || 0 : -1;
    if (diffNames.length === 0 && commitCount > 0) {
      record('LEASE', command, assertion, 'fail', `empty file diff but ${commitCount} commit(s) between base and HEAD -- refusing to pass an empty lease diff against non-empty branch history (base=${baseCommit} source=${remoteMain.source})`, startedAt, 'suspicious empty diff');
      return;
    }
    if (baseCommit === headSha && remoteMain.source !== 'ls-remote') {
      record('LEASE', command, assertion, 'fail', `base commit equals HEAD and the base could not be cross-verified against the real remote (source=${remoteMain.source}, warning=${baseWarning}); refusing to trust a possibly-tampered local origin/main ref`, startedAt, 'unverified base==HEAD');
      return;
    }
    const leaseViolations = diffNames.filter((f) => !LEASE_ALLOW.some((prefix) => f.startsWith(prefix)) && !LEASE_ALLOW_EXACT.includes(f));
    const evidence = [
      `base resolution: source=${remoteMain.source} baseCommit=${baseCommit}${baseWarning ? ` (warning: ${baseWarning})` : ''}`,
      `commits base..HEAD: ${commitCount}`,
      leaseViolations.join('\n') || `all ${diffNames.length} changed files inside the W7 lease`,
    ].join('\n');
    record('LEASE', command, assertion, leaseViolations.length === 0 ? 'pass' : 'fail', evidence, startedAt);
  } catch (error) {
    record('LEASE', command, assertion, 'fail', `probe threw: ${(error as Error).stack ?? String(error)}`, startedAt, 'probe crashed instead of failing cleanly');
  }
})();

// =============================================================================
// commit-bound manifest
// =============================================================================
const statusResult = sh('git', ['status', '--porcelain']);
// Fail-closed: if `git status` itself errors, treat the tree as dirty rather
// than silently assuming clean.
const treeDirty = statusResult.status !== 0 || statusResult.stdout.trim().length > 0;
const manifestOut = {
  wave: 'W7',
  commit: headSha,
  treeDirty,
  baseCommit,
  verifierSha256: selfSha256,
  toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
  criteria: results,
};
fs.writeFileSync(path.join(proofDir, 'manifest.json'), JSON.stringify(manifestOut, null, 2));

const hardFailures = results.filter((r) => r.status === 'fail');
const blocked = results.filter((r) => r.status === 'blocked-on-founder');
const passed = results.filter((r) => r.status === 'pass');
console.log(`\nverify-w7: ${passed.length} pass, ${blocked.length} blocked-on-founder, ${hardFailures.length} fail (of ${results.length}); treeDirty=${treeDirty}`);
for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id} — ${r.assertion.slice(0, 140)}${r.assertion.length > 140 ? '…' : ''}`);
if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT §2)');
process.exit(hardFailures.length === 0 && !treeDirty ? 0 : 1);
