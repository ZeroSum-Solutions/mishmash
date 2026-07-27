// verify-w7.ts -- wave W7 (selector foundations: spec + grader) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w7.ts [repoRootOverride]
//
// GATE-OF-RECORD EXECUTION POLICY (round-2 F-review, F19 hardened in round
// 3): repoRoot is derived from an explicit CLI argument or process.cwd() --
// NEVER from import.meta.url. This file is expected to be copyable to a
// pinned out-of-repo location (e.g. once approved) and still operate
// correctly against whatever worktree it is invoked with cwd set to.
// F19: round 2 still used `fileURLToPath(import.meta.url)` to hash this
// file's own bytes for the GATE-INTEGRITY self-check -- but that use of
// import.meta.url is ITSELF what breaks the out-of-repo CJS-transform path
// this file claims to support (esbuild empties import.meta under a CJS
// transform, so fileURLToPath(undefined) throws). Fixed by using
// process.argv[1] (the invoked script path, standard Node CLI convention)
// instead -- import.meta.url no longer appears anywhere in this file.
//
// Anti-gaming posture (VERIFICATION-CONTRACT.md S3), twice-revised after
// adversarial review (round1: 15 HIGH + 2 MED, all fixed; round2:
// round2-verify-w7.json, 14 HIGH + 2 MED surviving round-1's fixes, all
// addressed here -- this is the final round before founder escalation, so
// fixes target the exploit CLASS, not just the literal repro):
// - Every load-bearing adversarial control (population ground truth,
//   source-bleed, diversity axes, directive-claim-coverage,
//   counterfactual pairs) is now VERIFIER-CONSTRUCTED from real corpus
//   snapshot/directive data with genuine resolvable node identity
//   (nodeId+domPath+breakpoint), not implementer-authored fixtures.
//   Implementer fixtures remain required but are additional/non-load-bearing.
// - Fixture blinding is now a recursive per-element whitelist (elementId,
//   sourceId, domPath, nodeId, breakpoint, + optional motionSignature/
//   styleFingerprint), not just a top-level {caseId,composition} shape --
//   no nested marker field can reach the scorer.
// - The directiveInventory ground truth is bound to a corpus-freeze commit
//   in CORPUS.md; every case's IR must be a STRICT DESCENDANT of that
//   freeze commit, and all four claim fields (axis/source/scope/strength)
//   are cross-checked, not three.
// - Sealed-payload ancestry is bound to CONTENT (the current ciphertext
//   must equal the git blob at the seal commit's PARENT), not just to
//   when the file path was first added.
// - Every numeric score consumed anywhere (scorer axes, diversity, bleed
//   counts) is range/finiteness-checked; floors carry a named epsilon
//   (0.05) so denormalized-positive floors can't pass.
//
// Gate self-integrity (F1): this file's own sha256 is recorded in every
// manifest. Once an approval round writes
// ~/.claude/goal-state/mishmash-w7-selector-foundations/approved-gate.sha256,
// every later run hard-fails if this file no longer matches that hash.
//
// Held-out sealing (F3/F11): sealed cases' IR/snapshot payloads are
// committed ONLY as AES-256-CBC blobs (openssl, key at
// ~/.claude/goal-state/mishmash-w7-selector-foundations/seal.key, outside
// the repo, chmod 0600 and verified). The verifier decrypts, hash-checks,
// content-binds ciphertext to the seal commit's parent blob, and scans
// every git-tracked file under evals/ for plaintext leakage using
// multiple content windows (not whole-file hashes). The manifest records
// an explicit, honest boundary statement (R7): mechanical checks cover
// in-repo leakage and key permissions; same-user out-of-repo access to the
// key/proof directory is an ORCHESTRATION invariant, not something file
// permissions alone can enforce, and is declared as such, never disguised
// as a mechanical guarantee.
//
// Exit code: 0 only when every criterion is "pass" or "blocked-on-founder"
// (R7: a wave must be able to reach "all mechanical criteria green, N
// founder items pending" without a person), the tree is clean, AND the
// proof manifest itself was written without degrading to a fallback path
// (F16). Any "fail", a dirty tree, or a degraded manifest write forces
// non-zero, unconditionally.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// GATE-OF-RECORD EXECUTION POLICY, continued: everything below runs inside a
// single async IIFE rather than using top-level await. This file must stay
// runnable when copied to an out-of-repo pinned location (e.g. once
// approved) and invoked from an arbitrary directory -- tsx/esbuild decide
// CJS vs ESM output per-file based on the nearest package.json, and a file
// living outside any Node project (no ancestor package.json declaring
// "type": "module") gets compiled as CJS, where top-level await is a syntax
// error. An async IIFE has no such restriction. Verified by reproduction:
// running an out-of-repo copy with top-level await failed with esbuild's
// "Top-level await is currently not supported with the cjs output format";
// wrapping in this IIFE fixed it.
void (async () => {
const repoRoot = path.resolve(process.argv[2] ?? process.cwd());
const WAVE_SLUG = 'mishmash-w7-selector-foundations';
const goalStateDir = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG);

// F16: proof-dir creation is guarded. If the primary location can't be
// created (permission issue, a file blocking the path, ...), fall back to
// a temp location rather than crashing the whole process before any
// criterion has run. F16 (round 3): the fallback itself must not be
// forgotten -- `canonicalProofDirFailed` is threaded through to the final
// manifest AND the exit code, so a run that silently landed in a fallback
// dir (and then reported wroteOk:true writing there) can never pass.
let proofDir = path.join(goalStateDir, 'proof');
let canonicalProofDirFailed = false;
try {
  fs.mkdirSync(proofDir, { recursive: true });
} catch (e) {
  canonicalProofDirFailed = true;
  const fallback = path.join(os.tmpdir(), `verify-w7-proof-fallback-${process.pid}`);
  console.error(`verify-w7: could not create primary proof dir ${proofDir} (${(e as Error).message}); falling back to ${fallback}`);
  fs.mkdirSync(fallback, { recursive: true });
  proofDir = fallback;
}

function sh(cmd: string, args: string[], cwd: string = repoRoot, env?: NodeJS.ProcessEnv): { status: number; stdout: string; stderr: string } {
  try {
    const options: { cwd: string; encoding: 'utf8'; maxBuffer: number; timeout: number; env?: NodeJS.ProcessEnv } = {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15 * 60_000,
    };
    if (env) options.env = { ...process.env, ...env };
    const stdout = execFileSync(cmd, args, options);
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

// Binary-safe variant for reading git blob content (e.g. an encrypted .enc
// payload via `git show <rev>:<path>`) -- `sh()` forces utf8 decoding, which
// is lossy for arbitrary ciphertext bytes and would make hash comparisons
// meaningless (F3 content-binding needs the real bytes).
function shBuffer(cmd: string, args: string[], cwd: string = repoRoot): { status: number; stdout: Buffer; stderr: string } {
  try {
    const stdout = execFileSync(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60_000 });
    return { status: 0, stdout: stdout as Buffer, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { status: e.status ?? 1, stdout: e.stdout instanceof Buffer ? e.stdout : Buffer.alloc(0), stderr: e.stderr ? e.stderr.toString('utf8') : '' };
  }
}

// HEAD is resolved here (early) rather than only at the LEASE check at the
// end of the file, because the Phase-2 reviewer-disposition gate (item 8,
// added per the gate-scope ruling) needs it inside several C7-* criteria to
// verify commitReviewed's ancestry against HEAD before those criteria run.
const headShaResult = sh('git', ['rev-parse', 'HEAD']);
const headSha = headShaResult.status === 0 ? headShaResult.stdout.trim() : '';
const gitIdentityOk = /^[0-9a-f]{40}$/i.test(headSha);

// F20 (round 5): dispositionPath() now returns an ABSOLUTE path outside the
// repo (goal-state, orchestrator-only-writable) rather than a repo-relative
// path -- path.join(repoRoot, absolutePath) would silently mangle it (join
// does not reset to root on an absolute-looking segment the way resolve
// does), so every existing repo-relative caller of abs()/readJson()/
// readText()/exists() keeps working unchanged while an absolute path now
// passes through untouched.
function abs(rel: string): string {
  return path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
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

// F14 (round 5): the TypeScript compiler API is loaded by an ABSOLUTE path
// into repoRoot's own node_modules, dynamically, at call time -- a static
// top-level `import ts from 'typescript'` would be resolved by Node relative
// to THIS FILE's own location, which breaks the out-of-repo execution mode
// (F19) exactly like every other repo-relative resource here, so it has to
// go through the same repoRoot-derived absolute-path pattern as
// importEvalModule above.
let cachedTsCompilerApi: typeof import('typescript') | null = null;
async function loadTypeScriptCompilerApi(): Promise<{ ok: true; ts: typeof import('typescript') } | { ok: false; error: string }> {
  if (cachedTsCompilerApi) return { ok: true, ts: cachedTsCompilerApi };
  const tsMainPath = path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'typescript.js');
  if (!fs.existsSync(tsMainPath)) return { ok: false, error: `typescript compiler module not found at ${tsMainPath}` };
  try {
    const mod = (await import(pathToFileURL(tsMainPath).href)) as { default?: typeof import('typescript') };
    const ts = (mod.default ?? (mod as unknown)) as typeof import('typescript');
    cachedTsCompilerApi = ts;
    return { ok: true, ts };
  } catch (error) {
    return { ok: false, error: `import of typescript compiler API threw: ${(error as Error).stack ?? String(error)}` };
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
// different path, then to a fully in-memory hash if even that fails.
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
  // F16: a criterion with no real, readable artifact backing it may never
  // be reported as anything but "fail" -- contract S2 rule 4 requires a
  // non-empty, hash-matched artifact, and "artifact: null" cannot satisfy
  // that no matter what the probe computed.
  const effectiveStatus: 'pass' | 'fail' | 'blocked-on-founder' = artifact === null ? 'fail' : status;
  const effectiveDetail = artifact === null ? `${detail ? `${detail}; ` : ''}artifact could not be written to any location (F16: forced fail, no artifact-less pass permitted)` : detail;
  results.push({
    id,
    command,
    assertion,
    artifact,
    artifactSha256,
    exitCode: effectiveStatus === 'fail' ? 1 : 0,
    status: effectiveStatus,
    durationMs: Date.now() - startedAt,
    detail: effectiveDetail,
  });
}

// Every probe is wrapped so a thrown exception becomes a recorded "fail",
// never a crashed process. record() itself is failure-safe.
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

// Recursively enumerate every JSON-Schema property NAME anywhere in the
// schema tree (F17: insufficiency/response items must name a field that
// really exists in the committed schema, not a token from a hardcoded list).
function enumerateSchemaFieldNames(schema: JsonSchema, acc: Set<string> = new Set()): Set<string> {
  const properties = schema['properties'];
  if (properties && typeof properties === 'object') {
    for (const [key, sub] of Object.entries(properties as Record<string, JsonSchema>)) {
      acc.add(key);
      enumerateSchemaFieldNames(sub, acc);
    }
  }
  const items = schema['items'];
  if (items && typeof items === 'object') enumerateSchemaFieldNames(items as JsonSchema, acc);
  return acc;
}

// =============================================================================
// corpus manifest contract
// =============================================================================
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
const SCORER_DIR = 'evals/selector/scorer';
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
const SPIKE_OUTPUT_PATH = 'evals/selector/spike/composed-output.json';
const SPIKE_RUNLOG_PATH = 'evals/selector/spike/run-log.txt';
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
type ScorerAxis = (typeof REQUIRED_AXES)[number];

// F10: the directive-axis vocabulary (layout/motion/palette/...) is NOT the
// same vocabulary as the scorer's registered axis ids (layout_geometry/...).
// C7-10 indexed axes[] with the wrong vocabulary in round 1, silently always
// reading undefined. This explicit map is the only place that bridges them,
// and every value in it is validated against floors.json's actual keys at
// runtime so a future drift fails loudly instead of silently.
const DIRECTIVE_AXIS_TO_SCORER_AXIS: Record<DirectiveAxis, ScorerAxis> = {
  layout: 'layout_geometry',
  motion: 'motion_timing',
  palette: 'palette_fidelity',
  typography: 'type_fidelity',
  section: 'section_identity',
  interaction: 'responsiveness',
};

// F12: named epsilon -- a floor or delta must be meaningfully above zero,
// not merely "> 0" (which a denormalized 5e-324 would satisfy).
const MIN_MEANINGFUL_THRESHOLD = 0.05;

function loadManifest(): { manifest: CorpusManifest | null; error: string | null } {
  if (!exists(MANIFEST_PATH)) return { manifest: null, error: `${MANIFEST_PATH} does not exist` };
  const parsed = readJson<CorpusManifest>(MANIFEST_PATH);
  if (parsed === null) return { manifest: null, error: `${MANIFEST_PATH} is not valid JSON` };
  if (!Array.isArray(parsed.cases)) return { manifest: null, error: `${MANIFEST_PATH} has no "cases" array` };
  return { manifest: parsed, error: null };
}

// --- sealing (F3/F11): sealed payloads live in-tree only as AES-256-CBC
// blobs, content-bound to a commit ancestry, key permissions enforced -----
function ensureSealKey(): void {
  if (!fs.existsSync(SEAL_KEY_PATH)) {
    fs.mkdirSync(path.dirname(SEAL_KEY_PATH), { recursive: true });
    fs.writeFileSync(SEAL_KEY_PATH, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  // F11: verify (not just set-on-create) the permission mode every run --
  // re-assert 0600 unconditionally so a prior looser mode doesn't linger.
  fs.chmodSync(SEAL_KEY_PATH, 0o600);
}

function sealKeyModeOk(): { ok: boolean; mode: string } {
  ensureSealKey();
  const mode = fs.statSync(SEAL_KEY_PATH).mode & 0o777;
  return { ok: mode === 0o600, mode: mode.toString(8) };
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

interface SnapshotNode {
  nodeId: string;
  domPath: string;
  computedStyle?: Record<string, string>;
}
interface SnapshotDoc {
  nodes?: SnapshotNode[];
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

// F3: prove the CURRENT ciphertext blob is content-identical to the blob
// that existed at the seal commit's PARENT -- not merely that the file path
// was "added" at some ancestor commit (which a swap-in-place inside the
// seal commit itself would still satisfy).
function blobHashAtRevision(rev: string, relPath: string): { ok: true; hash: string } | { ok: false; error: string } {
  const result = shBuffer('git', ['show', `${rev}:${relPath}`]);
  if (result.status !== 0) return { ok: false, error: `git show ${rev}:${relPath} failed (status=${result.status}): ${result.stderr}` };
  return { ok: true, hash: sha256Buffer(result.stdout) };
}

function contentBoundBeforeSeal(sealCommit: string, relEncPath: string): { ok: boolean; detail: string } {
  const parentRev = `${sealCommit}^`;
  const parentBlob = blobHashAtRevision(parentRev, relEncPath);
  if (!parentBlob.ok) return { ok: false, detail: `no blob for ${relEncPath} at ${parentRev} (${parentBlob.error}) -- payload not provably present before the seal commit` };
  const currentHash = sha256File(relEncPath);
  if (!currentHash) return { ok: false, detail: `cannot read current ${relEncPath}` };
  if (currentHash !== parentBlob.hash) {
    return { ok: false, detail: `ciphertext at HEAD (${currentHash}) differs from the blob at ${parentRev} (${parentBlob.hash}) -- payload was swapped at/after the seal commit (F3)` };
  }
  return { ok: true, detail: `ciphertext content-bound: identical at ${parentRev} and HEAD (${currentHash})` };
}

// Resolve "the commit that currently defines <path>'s content" -- the most
// recent commit touching it, used both for the corpus-freeze commit (F2)
// and the seal commit (F3). Deliberately NOT "first added": a file that is
// legitimately edited once after creation should be judged by its latest
// state, and this is simpler/more robust than the round-1
// diff-filter=A-then-pop() pattern.
function latestCommitTouching(relPath: string): string | null {
  const result = sh('git', ['log', '-1', '--format=%H', '--', relPath]);
  if (result.status !== 0) return null;
  const sha = result.stdout.trim();
  return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
}

function strictDescendant(ancestorRev: string, descendantRev: string): { ok: boolean; detail: string } {
  if (ancestorRev === descendantRev) return { ok: false, detail: `same commit (${ancestorRev}) -- not a strict descendant` };
  const check = sh('git', ['merge-base', '--is-ancestor', ancestorRev, descendantRev]);
  if (check.status !== 0) return { ok: false, detail: `${ancestorRev} is NOT an ancestor of ${descendantRev}` };
  return { ok: true, detail: `${descendantRev} strictly descends from ${ancestorRev}` };
}

// F18 fix (gate-scope ruling, round 3): a SEALED payload's history proof is
// the OPPOSITE direction from the freeze-descendant check above. Round 2
// required a sealed case's IR commit to be a strict DESCENDANT of the seal
// commit -- but sealing something requires it to already exist, so ordinary
// compliant history (capture the payload, THEN seal it later) can never
// satisfy "IR commit comes after the seal commit." That contradicted
// content-binding (which anchors to the seal commit's PARENT, i.e. the
// state immediately BEFORE sealing) and a post-seal change-and-revert could
// game both checks at once. The ruling's correction: require the CURRENT
// ciphertext to equal the blob at sealCommit^ (content-binding, unchanged)
// AND require the commit that actually DEFINES that content (found by
// walking history from sealCommit^ backwards) to be an ANCESTOR of --
// i.e. to PRECEDE -- the seal commit. No "descends from" requirement
// remains for sealed payloads; freeze-descendant ancestry is kept for
// NON-sealed IR instances only (see C7-2). F18 (round 5, revert-after-seal):
// round 4's defining-commit search is backward-only from sealCommit^, so it
// cannot detect a LATER, post-seal touch that re-establishes the exact
// pre-seal bytes (commit X, seal, commit Y, revert to X -- HEAD equals
// sealCommit^ again while the backward search still finds the original,
// legitimate pre-seal commit). A frozen-path rule closes this: zero commits
// strictly after the seal commit may touch the sealed path at all.
function sealedPayloadPrecedesSeal(sealCommit: string, relEncPath: string): { ok: boolean; detail: string } {
  const contentBinding = contentBoundBeforeSeal(sealCommit, relEncPath);
  if (!contentBinding.ok) return contentBinding;
  const definingLog = sh('git', ['log', `${sealCommit}^`, '-1', '--format=%H', '--', relEncPath]);
  if (definingLog.status !== 0 || !definingLog.stdout.trim()) {
    return { ok: false, detail: `no commit reachable from ${sealCommit}^ (history before the seal) touches ${relEncPath} -- content-binding passed but no defining commit could be resolved` };
  }
  const definingCommit = definingLog.stdout.trim();
  if (definingCommit === sealCommit) return { ok: false, detail: `defining commit resolved to the seal commit itself -- not a strict ancestor (precedes, not descends)` };
  const ancestorCheck = sh('git', ['merge-base', '--is-ancestor', definingCommit, sealCommit]);
  if (ancestorCheck.status !== 0) return { ok: false, detail: `defining commit ${definingCommit} is not an ancestor of (does not precede) the seal commit ${sealCommit}` };

  // F18 (round 5, revert-after-seal): the backward-only defining-commit
  // search above is tautological on its own -- it can prove A pre-seal
  // commit touched the path, but says nothing about whether a LATER,
  // post-seal commit re-touched it, including reverting a post-seal tamper
  // back to the original bytes (repro: commit ciphertext X, seal, commit
  // ciphertext Y, then revert to X -- HEAD equals the pre-seal blob again
  // while two commits strictly after the seal touched the path). The
  // frozen-path invariant is required directly and unconditionally: ZERO
  // commits strictly after the seal commit may touch this path at all. A
  // legitimate re-seal is a NEW seal commit (a new ${SEALED_ACCESS_PATH}
  // entry) plus a founder decision record -- not a same-seal-commit touch.
  const postSealTouches = sh('git', ['log', `${sealCommit}..HEAD`, '--format=%H', '--', relEncPath]);
  if (postSealTouches.status !== 0) {
    return { ok: false, detail: `git log ${sealCommit}..HEAD -- ${relEncPath} failed (status=${postSealTouches.status}): ${postSealTouches.stderr}` };
  }
  const postSealCommits = postSealTouches.stdout.trim().split('\n').filter(Boolean);
  if (postSealCommits.length > 0) {
    return {
      ok: false,
      detail: `${postSealCommits.length} commit(s) strictly after the seal commit ${sealCommit} touch ${relEncPath} (${postSealCommits.join(', ')}) -- the frozen-path invariant requires ZERO post-seal touches (a legitimate re-seal needs a new seal commit + founder decision record, not a same-seal-era touch)`,
    };
  }

  return { ok: true, detail: `${contentBinding.detail}; defining commit ${definingCommit} precedes (is an ancestor of) the seal commit ${sealCommit}; zero commits strictly after the seal touch ${relEncPath}` };
}

// =============================================================================
// scoring input contract (F7/F9 deep blinding; F5/F8/F9 real resolvable
// node identity; F8 axis-isolation fields)
// =============================================================================
interface CompositionElement {
  elementId: string;
  sourceId: string;
  domPath: string;
  nodeId: string;
  breakpoint: string;
  motionSignature?: string;
  styleFingerprint?: string;
}
interface ScoringInput {
  caseId: string;
  composition: CompositionElement[];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

// F7: deep-strip, not just top-level. Every composition element is rebuilt
// field-by-field from a fixed whitelist -- a marker smuggled into elementId,
// an extra nested field, or any nested object is never forwarded to the
// scorer. Malformed elements make the whole fixture invalid rather than
// being silently dropped (so a fixture can't "average away" a bad element).
function blindInput(raw: unknown): { ok: true; input: ScoringInput; extraTopKeys: string[]; extraElementKeys: string[] } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'input.json is not an object' };
  const obj = raw as Record<string, unknown>;
  const ALLOWED_TOP = ['caseId', 'composition'];
  const extraTopKeys = Object.keys(obj).filter((k) => !ALLOWED_TOP.includes(k));
  const caseId = obj['caseId'];
  const compositionRaw = obj['composition'];
  if (!isNonEmptyString(caseId)) return { ok: false, error: 'input.json.caseId must be a non-empty string' };
  if (!Array.isArray(compositionRaw)) return { ok: false, error: 'input.json.composition must be an array' };

  const ALLOWED_ELEMENT_KEYS = ['elementId', 'sourceId', 'domPath', 'nodeId', 'breakpoint', 'motionSignature', 'styleFingerprint'];
  const extraElementKeys: string[] = [];
  const composition: CompositionElement[] = [];
  for (const [i, elRaw] of compositionRaw.entries()) {
    if (elRaw === null || typeof elRaw !== 'object' || Array.isArray(elRaw)) return { ok: false, error: `composition[${i}] is not an object` };
    const el = elRaw as Record<string, unknown>;
    for (const k of Object.keys(el)) if (!ALLOWED_ELEMENT_KEYS.includes(k)) extraElementKeys.push(`composition[${i}].${k}`);
    if (!isNonEmptyString(el['elementId']) || !isNonEmptyString(el['sourceId']) || !isNonEmptyString(el['domPath']) || !isNonEmptyString(el['nodeId']) || !isNonEmptyString(el['breakpoint'])) {
      return { ok: false, error: `composition[${i}] missing/invalid required string field(s) among elementId/sourceId/domPath/nodeId/breakpoint` };
    }
    const rebuilt: CompositionElement = {
      elementId: el['elementId'] as string,
      sourceId: el['sourceId'] as string,
      domPath: el['domPath'] as string,
      nodeId: el['nodeId'] as string,
      breakpoint: el['breakpoint'] as string,
    };
    if (isNonEmptyString(el['motionSignature'])) rebuilt.motionSignature = el['motionSignature'] as string;
    if (isNonEmptyString(el['styleFingerprint'])) rebuilt.styleFingerprint = el['styleFingerprint'] as string;
    composition.push(rebuilt);
  }
  return { ok: true, input: { caseId, composition }, extraTopKeys, extraElementKeys };
}

// F12: a [0,1] score must be a real, finite number in range -- Infinity,
// -Infinity, NaN, and out-of-range values are all rejected explicitly.
function isValidUnitScore(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}
function isValidCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function scoreRangeErrors(result: { overall?: unknown; axes?: unknown }): string[] {
  const errors: string[] = [];
  if (!isValidUnitScore(result.overall)) errors.push(`overall must be a finite number in [0,1], got ${String(result.overall)}`);
  if (!result.axes || typeof result.axes !== 'object') {
    errors.push('axes object missing');
    return errors;
  }
  const axesObj = result.axes as Record<string, unknown>;
  for (const axis of REQUIRED_AXES) {
    if (!isValidUnitScore(axesObj[axis])) errors.push(`axes.${axis} must be a finite number in [0,1], got ${String(axesObj[axis])}`);
  }
  return errors;
}

// =============================================================================
// shared resolution machinery (F5/F9): a "resolvable node" is a real
// captured (nodeId, domPath, breakpoint) triple from a source's snapshot.
// C7-4 (provenance), C7-9 (directive-claim-coverage), and the verifier-
// constructed composites (C7-7/8/9/10) all use this SAME function, so
// "resolves" means the same thing everywhere in this file.
// =============================================================================
interface ResolvableNode {
  nodeId: string;
  domPath: string;
  breakpoint: string;
  computedStyle: Record<string, string>;
}

function buildSnapshotsBySource(c: CorpusCase): { ok: true; bySource: Record<string, ResolvableNode[]> } | { ok: false; error: string } {
  const bySource: Record<string, ResolvableNode[]> = {};
  for (const source of c.sources) {
    const nodes: ResolvableNode[] = [];
    for (const [bp, ref] of Object.entries(source.snapshots)) {
      const loaded = loadSnapshotDoc(ref, c.sealed, `${c.id}-${source.id}-${bp}`);
      if (!loaded.ok) return { ok: false, error: `${c.id}/${source.id}/${bp}: ${loaded.error}` };
      for (const n of loaded.doc.nodes ?? []) {
        nodes.push({ nodeId: n.nodeId, domPath: n.domPath, breakpoint: bp, computedStyle: n.computedStyle ?? {} });
      }
    }
    bySource[source.id] = nodes;
  }
  return { ok: true, bySource };
}

function resolves(el: { sourceId: string; nodeId: string; domPath: string; breakpoint: string }, bySource: Record<string, ResolvableNode[]>): boolean {
  const nodes = bySource[el.sourceId] ?? [];
  return nodes.some((n) => n.nodeId === el.nodeId && n.domPath === el.domPath && n.breakpoint === el.breakpoint);
}

function styleFingerprintOf(style: Record<string, string>): string | null {
  const keys = ['color', 'backgroundColor', 'fontFamily'];
  const parts = keys.map((k) => style[k]).filter((v): v is string => typeof v === 'string' && v.length > 0);
  return parts.length > 0 ? parts.join('|') : null;
}

// F5: generic field-derangement -- produce a permutation of just ONE field's
// values across entries (a fixed-point-free rotation), leaving every other
// field untouched. Used to build three INDEPENDENT negative controls
// (nodeId-only, domPath-only, breakpoint-only), each of which must
// independently drive resolution to zero.
function derangeField<T extends Record<string, unknown>, K extends keyof T>(entries: T[], field: K): T[K][] | null {
  const original = entries.map((e) => e[field]);
  const n = original.length;
  if (n < 2) return null;
  for (let shift = 1; shift < n; shift++) {
    const candidate = original.map((_, i) => original[(i + shift) % n]!);
    if (candidate.every((v, i) => v !== original[i])) return candidate;
  }
  return null;
}

// F11: deterministic-but-unpredictable 64-byte content windows sampled
// across a plaintext buffer, used to scan tracked files for byte-substring
// leakage rather than trusting a whole-file hash (which a single altered
// framing byte, or embedding inside a larger file, would defeat).
function sampleWindows(buf: Buffer, windowSize = 64, count = 5): Buffer[] {
  if (buf.length <= windowSize) return buf.length > 0 ? [buf] : [];
  const maxStart = buf.length - windowSize;
  const windows: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const seed = crypto.createHash('sha256').update(buf.subarray(0, Math.min(4096, buf.length))).update(String(i)).digest();
    const offset = seed.readUInt32BE(0) % (maxStart + 1);
    windows.push(buf.subarray(offset, offset + windowSize));
  }
  return windows;
}

// =============================================================================
// verifier-constructed synthetic composites (F7/F8/F9/F10) -- built from
// REAL corpus directiveInventory + captured snapshot node data, never from
// implementer-authored fixtures, so a label-keyed or name-grep scorer has
// nothing to key off and every element is genuinely resolvable (or
// deliberately not, by construction).
// =============================================================================
function findRealNode(c: CorpusCase, sourceId: string, domPath: string): { nodeId: string; breakpoint: string } | null {
  const source = c.sources.find((s) => s.id === sourceId);
  if (!source) return null;
  for (const [bp, ref] of Object.entries(source.snapshots)) {
    const loaded = loadSnapshotDoc(ref, c.sealed, `${c.id}-${sourceId}-${bp}`);
    if (!loaded.ok) continue;
    const node = (loaded.doc.nodes ?? []).find((n) => n.domPath === domPath);
    if (node) return { nodeId: node.nodeId, breakpoint: bp };
  }
  return null;
}

// A composition where every directiveInventory claim is attributed to
// EXACTLY the source/scope it names, with REAL nodeId/breakpoint pulled from
// that source's own capture -- genuinely resolvable by construction. Returns
// null if any directive's scope doesn't resolve against its own claimed
// source (e.g. a degenerate "nonexistent-element-directive" case -- not a
// usable case for building a faithful control).
function faithfulComposition(c: CorpusCase): CompositionElement[] | null {
  const elements: CompositionElement[] = [];
  for (const [i, d] of c.directiveInventory.entries()) {
    const real = findRealNode(c, d.source, d.scope);
    if (!real) return null;
    elements.push({ elementId: `di-${i}-${d.axis}`, sourceId: d.source, domPath: d.scope, nodeId: real.nodeId, breakpoint: real.breakpoint, motionSignature: 'timeline-a' });
  }
  return elements;
}

// Same underlying (nodeId, domPath, breakpoint) data, but every element's
// sourceId is deliberately reassigned to a DIFFERENT source than the one
// that actually captured it -- modeling "ignores the directive, blends a
// house style instead" while still looking structurally complete. Because
// the node data genuinely came from a different source, this composition
// will NOT resolve against its (false) claimed attribution.
function houseStyleComposition(c: CorpusCase): CompositionElement[] | null {
  const faithful = faithfulComposition(c);
  if (!faithful) return null;
  const sourceIds = c.sources.map((s) => s.id);
  return faithful.map((el, i) => {
    const others = sourceIds.filter((id) => id !== el.sourceId);
    const blended = others.length > 0 ? others[i % others.length]! : el.sourceId;
    return { ...el, sourceId: blended };
  });
}

function pickCaseWithDirectives(manifest: CorpusManifest, minSources = 2): CorpusCase | null {
  return manifest.cases.find((c) => !c.sealed && !c.skip && c.sources.length >= minSources && c.directiveInventory.length >= 1 && faithfulComposition(c) !== null) ?? null;
}

function swapOneDirective(c: CorpusCase): { base: CompositionElement[]; swapped: CompositionElement[]; axis: string; diffCount: number } | null {
  const base = faithfulComposition(c);
  if (!base) return null;
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
// PHASE-2 MECHANISM (gate-scope ruling, item 8): C7-2/C7-3/C7-5/C7-6/C7-7/
// C7-8/C7-9 each name a semantic property (does directiveInventory reflect
// an independent brief; does the conflict resolver apply real precedence;
// are genre/conflict quotas substantive; is the wrong population plausible
// rather than foreign-id-keyed; do the diversity/bleed axes have semantic
// implementations; does directive_claim_coverage correspond to the actual
// directive claims) that the ruling found CANNOT be mechanically proven by
// generic fixtures alone -- every round-1/2/3 attempt to encode it
// structurally was met with a new adversarial construction that satisfies
// the letter while defeating the intent (Class S). The ruling's fix is
// CONTROL SUBSTITUTION, not severity laundering: these criteria now ALSO
// require a commit-bound, dual-reviewer APPROVE record explicitly disposing
// the verbatim round-3 finding, produced during the wave by deliverable
// review. Until that record exists, the criteria fail outright --
// EVERY existing structural check above stays in force as necessary-but-
// insufficient; this is an ADDITIONAL gate, not a replacement.
const ROUND3_FINDING_TEXT = {
  F2: 'The freeze establishes chronology but directiveInventory remains implementer-authored and unverified against an independent corpus brief.',
  F4: 'C7-3 still does not prove that result applies the declared conflict resolution.',
  F6: 'Genre and conflict quotas remain labels rather than substantive properties of the captured cases.',
  F7: 'The verifier-built wrong population tests foreign source identifiers rather than plausible wrong compositions within each case.',
  F8: 'The isolation trios prove only that some serialized field changed and do not require semantic implementations of the four structural axes.',
  F9: 'C7-9 distinguishes resolvable from unresolvable attribution but still does not prove correspondence to directive claims.',
} as const;
type Round3FindingId = keyof typeof ROUND3_FINDING_TEXT;

interface DispositionReviewer {
  identity?: string;
  model?: string;
  verdict?: string;
  // F20 (round 5): the orchestrator attaches the actual codex/grok job id
  // that produced this review as a receipt. This verifier can only check
  // that a receipt is PRESENT and non-empty (structure only, per R7/S1) --
  // it does not call out to codex/grok to authenticate the job id itself;
  // that remains a human/orchestrator responsibility, same as GATE-INTEGRITY
  // trusting approved-gate.sha256's location rather than re-deriving it.
  jobId?: string;
}
interface DispositionRecord {
  finding?: string;
  commitReviewed?: string;
  date?: string;
  reviewers?: DispositionReviewer[];
}

// F20 (round 5): implementer-authored JSON at an in-repo path is
// unauthenticated -- nothing stopped the wave implementer from writing
// their own "APPROVE" record naming arbitrary reviewer identities and an
// old ancestor commit. The load-bearing copy is relocated to a directory
// under goal-state that ONLY the orchestrator writes -- the identical
// trust model as approved-gate.sha256 (GATE-INTEGRITY, above): the
// verifier trusts this location because the implementation agent's lease
// (leases.json[W7]) never grants write access outside docs/specs/**,
// evals/**, scripts/waves/verify-w7.ts, and docs/plans/waves/**, so it
// cannot forge a record here even if it wanted to. Any docs/specs/
// selector-reviews/*.json copy left in the repo is optional
// documentation for humans only -- it is never read by this check and
// carries no authority.
const DISPOSITIONS_DIR = path.join(goalStateDir, 'dispositions');
function dispositionPath(findingId: Round3FindingId): string {
  return path.join(DISPOSITIONS_DIR, `${findingId}.json`);
}
const PHASE2_TRUST_BOUNDARY_NOTE =
  'TRUST BOUNDARY (F20): this record is read from an orchestrator-only-writable directory OUTSIDE the repo (the same trust model as approved-gate.sha256) -- the W7 implementation lease never grants write access there, so it cannot be forged by the implementer; any docs/specs/selector-reviews/*.json copy in the repo is optional human documentation only and is never read or trusted by this check';

// Structure-only check, per R7/S1: this NEVER judges whether the reviewers
// were RIGHT to approve -- only that a genuine, commit-bound, dual-lane
// APPROVE record disposing the exact pinned finding text exists. Judgment
// stays with the reviewers; the verifier stays mechanical.
function checkReviewerDisposition(findingId: Round3FindingId): { ok: boolean; detail: string } {
  const relPath = dispositionPath(findingId);
  const record = readJson<DispositionRecord>(relPath);
  if (record === null) return { ok: false, detail: `missing or invalid JSON at ${relPath} -- reviewer disposition records missing` };
  const pinned = ROUND3_FINDING_TEXT[findingId];
  if (record.finding !== pinned) {
    return { ok: false, detail: `${relPath}.finding does not match the pinned verbatim round-3 text for ${findingId} -- reviewer disposition records missing (or do not dispose the right finding)` };
  }
  if (!record.commitReviewed || !/^[0-9a-f]{40}$/i.test(record.commitReviewed)) {
    return { ok: false, detail: `${relPath}.commitReviewed is not a full 40-hex git sha -- reviewer disposition records missing (or malformed)` };
  }
  if (!gitIdentityOk) {
    return { ok: false, detail: `cannot verify ${relPath}.commitReviewed ancestry -- HEAD is unresolvable` };
  }
  if (record.commitReviewed !== headSha) {
    const anc = sh('git', ['merge-base', '--is-ancestor', record.commitReviewed, headSha]);
    if (anc.status !== 0) {
      return { ok: false, detail: `${relPath}.commitReviewed (${record.commitReviewed}) is neither HEAD nor an ancestor of HEAD (${headSha}) -- reviewer disposition records missing (or stale)` };
    }
  }
  if (!record.date || typeof record.date !== 'string' || record.date.length === 0) {
    return { ok: false, detail: `${relPath}.date is missing -- reviewer disposition records missing` };
  }
  if (!Array.isArray(record.reviewers) || record.reviewers.length < 2) {
    return { ok: false, detail: `${relPath}.reviewers must be an array with >=2 entries (one Sol-lane, one Grok-lane) -- reviewer disposition records missing` };
  }
  const approved = record.reviewers.filter((r) => r.verdict === 'APPROVE');
  const identityText = (r: DispositionReviewer): string => `${r.identity ?? ''} ${r.model ?? ''}`;
  const solLane = approved.find((r) => /sol/i.test(identityText(r)) && /gpt-?5\.6/i.test(identityText(r)));
  const grokLane = approved.find((r) => /grok/i.test(identityText(r)));
  if (!solLane) return { ok: false, detail: `${relPath}.reviewers has no APPROVE record identifying a Sol-lane (GPT-5.6 Sol) reviewer -- reviewer disposition records missing` };
  if (!grokLane) return { ok: false, detail: `${relPath}.reviewers has no APPROVE record identifying a Grok-lane reviewer -- reviewer disposition records missing` };
  // F20: each lane's job-id receipt must be present and non-empty.
  if (!solLane.jobId || solLane.jobId.trim().length === 0) return { ok: false, detail: `${relPath}'s Sol-lane reviewer record has no non-empty jobId receipt -- reviewer disposition records missing (or incomplete)` };
  if (!grokLane.jobId || grokLane.jobId.trim().length === 0) return { ok: false, detail: `${relPath}'s Grok-lane reviewer record has no non-empty jobId receipt -- reviewer disposition records missing (or incomplete)` };
  return {
    ok: true,
    detail: `${relPath}: verbatim finding matched, commitReviewed (${record.commitReviewed}) ancestry OK, both Sol-lane (jobId=${solLane.jobId}) and Grok-lane (jobId=${grokLane.jobId}) APPROVE present with job-id receipts (dated ${record.date})`,
  };
}

// Wraps an existing probe body (verbatim, unchanged -- the "necessary but
// insufficient" structural checks) with the additional Phase-2 gate. The
// overall result is "pass" only if BOTH the existing checks AND the
// disposition record hold; a missing/invalid record fails the criterion
// with detail "reviewer disposition records missing" regardless of how the
// existing checks fared.
async function withReviewerDisposition(
  findingId: Round3FindingId,
  existingLogic: () => Promise<{ ok: boolean; evidence: string; detail?: string | undefined }>,
): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  const existing = await existingLogic();
  const disposition = checkReviewerDisposition(findingId);
  const ok = existing.ok && disposition.ok;
  return {
    ok,
    evidence: `${existing.evidence}\n\n--- Phase-2 gate (additional; the checks above remain necessary but insufficient): reviewer disposition record for ${findingId} ---\n${disposition.detail}`,
    detail: ok ? undefined : !disposition.ok ? 'reviewer disposition records missing' : existing.detail,
  };
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

    const topRequiredArr = schema['required'];
    const topRequired = new Set(Array.isArray(topRequiredArr) ? (topRequiredArr as string[]) : []);
    const missingTop = REQUIRED_IR_TOP_KEYS.filter((k) => !topRequired.has(k));
    if (missingTop.length > 0) {
      return { ok: false, evidence: `${IR_SCHEMA_PATH} does not list these top-level keys in "required": ${missingTop.join(', ')}` };
    }
    const topProps = schema['properties'] as Record<string, JsonSchema> | undefined;
    const minItemsProblems: string[] = [];
    for (const arrKey of ['sourceSlots', 'directives', 'provenance', 'variantAxes', 'conflictResolution']) {
      const sub = topProps?.[arrKey];
      const minItems = sub?.['minItems'];
      if (typeof minItems !== 'number' || minItems < 1) minItemsProblems.push(arrKey);
    }
    if (minItemsProblems.length > 0) {
      return { ok: false, evidence: `${IR_SCHEMA_PATH} properties.{${minItemsProblems.join(',')}}.minItems must be >= 1` };
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
// C7-2 -- IR expresses every corpus directive: the directiveInventory ground
// truth is bound to a CORPUS-FREEZE COMMIT recorded in CORPUS.md (F2), all
// FOUR claim fields (axis/source/scope/strength) are cross-checked. F18
// (round 3, gate-scope ruling): non-sealed cases' IR must be a STRICT
// DESCENDANT of the freeze commit (inventory precedes IR); sealed cases are
// EXEMPT from that check and instead require their ciphertext to be
// content-bound to, and defined by a commit that PRECEDES, the seal commit
// -- requiring both directions on the same case was the contradiction F18
// found real, since ordinary compliant history (capture, then seal later)
// cannot satisfy "descends from seal" at all. F18 (round 5): the backward-
// only defining-commit search cannot detect a post-seal touch that reverts
// the payload back to its original bytes, so sealedPayloadPrecedesSeal now
// additionally requires ZERO commits strictly after the seal commit to
// touch the sealed path at all (frozen-path rule).
// =============================================================================
await probe(
  'C7-2',
  `read the corpus-freeze hash line in ${CORPUS_MD_PATH}; resolve the freeze commit (latest commit touching ${CORPUS_MD_PATH}); for every case, cross-check directiveInventory (all 4 fields) against ir.directives; for NON-SEALED cases require the IR commit to be a STRICT DESCENDANT of the freeze commit; for SEALED cases require the ciphertext to be content-bound to, and its defining commit to PRECEDE (be an ancestor of, not descend from), the seal commit, AND require zero commits strictly after the seal commit to touch the sealed path (frozen-path rule)`,
  `${CORPUS_MD_PATH} contains a line "Corpus freeze sha256: <hex>" equal to sha256(${MANIFEST_PATH}) at HEAD (proving the manifest has not silently changed since the stated freeze); every case's directiveInventory entry (axis in [${DIRECTIVE_AXES.join('/')}], source a real source id, scope non-empty, strength in [0,1]) has a matching ir.directives entry on ALL FOUR fields (axis+source+scope+strength, exact); for non-sealed cases, the commit that last-touched the IR file must be a STRICT descendant of the corpus-freeze commit (same-commit or ancestor-only fails); for SEALED cases (F18-corrected), the current ciphertext must equal the blob at the seal commit's parent AND the commit that defines that content must be an ANCESTOR of (precede) the seal commit AND git log <sealCommit>..HEAD -- <path> must be EMPTY (frozen-path rule -- a legitimate re-seal is a new seal commit + founder decision record, not a same-seal-era touch; this closes the revert-after-seal repro where a post-seal tamper is reverted back to the pre-seal bytes) -- no descend-from requirement applies to sealed payloads; ADDITIONALLY (Phase-2, gate-scope ruling item 8, necessary but not sufficient with the checks above): ${dispositionPath('F2')} must record a commit-bound, dual-reviewer (Sol-lane + Grok-lane) APPROVE disposing the verbatim round-3 F2 finding -- until it exists this criterion fails with "reviewer disposition records missing"; ${PHASE2_TRUST_BOUNDARY_NOTE}`,
  async () => withReviewerDisposition('F2', async () => {
    const corpusMdText = readText(CORPUS_MD_PATH);
    if (corpusMdText === null) return { ok: false, evidence: `missing ${CORPUS_MD_PATH}` };
    const manifestHash = sha256File(MANIFEST_PATH);
    if (!manifestHash) return { ok: false, evidence: `cannot hash ${MANIFEST_PATH}` };
    const freezeLineMatch = /Corpus freeze sha256:\s*([0-9a-f]{64})/i.exec(corpusMdText);
    if (!freezeLineMatch) return { ok: false, evidence: `${CORPUS_MD_PATH} does not contain a "Corpus freeze sha256: <64-hex>" line` };
    if (freezeLineMatch[1]!.toLowerCase() !== manifestHash.toLowerCase()) {
      return { ok: false, evidence: `${CORPUS_MD_PATH}'s stated freeze hash (${freezeLineMatch[1]}) does not match the current ${MANIFEST_PATH} content hash (${manifestHash}) -- manifest changed since the stated freeze` };
    }
    const freezeCommit = latestCommitTouching(CORPUS_MD_PATH);
    if (!freezeCommit) return { ok: false, evidence: `could not resolve a git commit for ${CORPUS_MD_PATH} (uncommitted?)` };

    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot check coverage: ${error}` };
    if (manifest.cases.length === 0) return { ok: false, evidence: `${MANIFEST_PATH} has zero cases` };

    const sealCommit = latestCommitTouching(SEALED_ACCESS_PATH);

    const lines: string[] = [`freeze commit: ${freezeCommit} (hash-verified against current manifest)`, `seal commit: ${sealCommit ?? '(none/unresolved)'}`];
    let failures = 0;
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
        lines.push(`${c.id}: ${invalidEntries.length} directiveInventory entries are structurally invalid: ${JSON.stringify(invalidEntries)}`);
        continue;
      }
      const irDirectives = Array.isArray(parsed.directives) ? parsed.directives : [];
      // F2: cross-check ALL FOUR fields, including strength (round 1 only
      // checked axis+source+scope).
      const unexpressed = c.directiveInventory.filter((d) => !irDirectives.some((ird) => ird.axis === d.axis && ird.source === d.source && ird.scope === d.scope && ird.strength === d.strength));
      if (unexpressed.length > 0) {
        failures++;
        lines.push(`${c.id}: ${unexpressed.length}/${c.directiveInventory.length} ground-truth directives (incl. strength) have no matching ir.directives entry: ${JSON.stringify(unexpressed)}`);
        continue;
      }

      // F18 (gate-scope ruling): sealed and non-sealed cases now take
      // DIFFERENT, non-contradictory ordering proofs. Non-sealed cases keep
      // the freeze-descendant check (IR must come AFTER the frozen ground
      // truth). Sealed cases are EXEMPT from freeze-descendant ancestry --
      // instead their ciphertext must be content-bound to, and its defining
      // commit must PRECEDE, the seal commit (sealedPayloadPrecedesSeal).
      // Applying both directions to the same case is exactly the
      // contradiction round 3 found real: ordinary compliant history
      // (capture first, seal later) cannot be both a descendant of the
      // freeze commit and pre-date the seal commit's parent when freeze and
      // seal are unrelated anchors -- so sealed cases rely solely on the
      // seal-relative proof.
      if (c.sealed) {
        if (!c.irPath.endsWith('.enc')) {
          failures++;
          lines.push(`${c.id}: sealed but irPath does not end in .enc (${c.irPath})`);
          continue;
        }
        if (!sealCommit) {
          failures++;
          lines.push(`${c.id}: sealed but ${SEALED_ACCESS_PATH} has no resolvable commit to anchor an ordering check`);
          continue;
        }
        const precedence = sealedPayloadPrecedesSeal(sealCommit, c.irPath);
        if (!precedence.ok) {
          failures++;
          lines.push(`${c.id}: F18/F3 sealed-payload precedence failed -- ${precedence.detail}`);
          continue;
        }
        lines.push(`${c.id}: directiveInventory expressed (4/4 fields); sealed payload precedes the seal commit ${sealCommit} (${precedence.detail})`);
      } else {
        const irCommit = latestCommitTouching(c.irPath);
        if (!irCommit) {
          failures++;
          lines.push(`${c.id}: could not resolve a git commit for ${c.irPath}`);
          continue;
        }
        const freezeOrdering = strictDescendant(freezeCommit, irCommit);
        if (!freezeOrdering.ok) {
          failures++;
          lines.push(`${c.id}: IR commit ${irCommit} is not a strict descendant of the freeze commit ${freezeCommit} (${freezeOrdering.detail}) -- directiveInventory does not provably precede the IR`);
          continue;
        }
        lines.push(`${c.id}: directiveInventory expressed (4/4 fields); IR (${irCommit}) strictly descends from freeze (${freezeCommit})`);
      }
    }
    return { ok: failures === 0, evidence: lines.join('\n'), detail: failures > 0 ? `${failures}/${manifest.cases.length} cases failed directive-inventory coverage, freeze ordering, or seal precedence` : undefined };
  }),
);

// =============================================================================
// C7-3 -- conflicts resolve deterministically to the DECLARED conflict,
// per the IR's OWN precedence rule (F4: non-null result, winningSource
// required, exactly-one matching claim per axis, cross-checked against
// ir.conflictResolution)
// =============================================================================
await probe(
  'C7-3',
  `dynamic-import ${RESOLVE_CONFLICTS_PATH}, call resolveConflicts(ir) three times per conflict case; require a non-null result, exactly one losingClaims entry for the declared axis naming BOTH the declared winningSource and losingSource, and a matching entry in the IR's own conflictResolution array`,
  `${RESOLVE_CONFLICTS_PATH} exports resolveConflicts(ir): { result: unknown; losingClaims: Array<{axis,winningSource,losingSource}> }; for every conflict-marked case: result is not null/undefined; losingClaims.filter(axis===declaredAxis) has length EXACTLY 1 (a cross-product-of-every-axis-and-source stub fails this); that one entry has winningSource===declared.winningSource AND losingSource===declared.losingSource; the case's own ir.conflictResolution array has a matching entry for the same axis/winningSource/losingSource (three-way consistency: manifest ground truth, IR's own recorded precedence, and the live resolver all agree); three calls in this process are hash-identical; ADDITIONALLY (Phase-2, gate-scope ruling item 8, necessary but not sufficient with the checks above): ${dispositionPath('F4')} must record a commit-bound, dual-reviewer (Sol-lane + Grok-lane) APPROVE disposing the verbatim round-3 F4 finding -- until it exists this criterion fails with "reviewer disposition records missing"; ${PHASE2_TRUST_BOUNDARY_NOTE}`,
  async () => withReviewerDisposition('F4', async () => {
    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot run: ${error}` };
    const conflictCases = manifest.cases.filter((c) => c.conflict !== null);
    if (conflictCases.length < 3) return { ok: false, evidence: `only ${conflictCases.length} conflict-marked cases in manifest; C7-5 quota requires >=3` };

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
      let ir: { conflictResolution?: Array<{ axis?: string; winningSource?: string; losingSource?: string }> };
      try {
        ir = JSON.parse(loaded.bytes.toString('utf8'));
      } catch {
        failures++;
        lines.push(`${c.id}: IR is not valid JSON`);
        continue;
      }
      const irEntry = (ir.conflictResolution ?? []).find((e) => e.axis === conflict.axis);
      const irMatches = !!irEntry && irEntry.winningSource === conflict.winningSource && irEntry.losingSource === conflict.losingSource;

      const hashes: string[] = [];
      let liveMatches = true;
      for (let run = 0; run < 3; run++) {
        // eslint-disable-next-line no-await-in-loop
        const out = await (resolveConflicts as (ir: unknown) => unknown | Promise<unknown>)(structuredClone(ir));
        const resolvedOut = out as { result?: unknown; losingClaims?: Array<{ axis?: string; losingSource?: string; winningSource?: string }> };
        const nonNull = resolvedOut.result !== null && resolvedOut.result !== undefined;
        const matchingForAxis = Array.isArray(resolvedOut.losingClaims) ? resolvedOut.losingClaims.filter((lc) => lc.axis === conflict.axis) : [];
        const exactlyOne = matchingForAxis.length === 1;
        const fieldsMatch = exactlyOne && matchingForAxis[0]!.winningSource === conflict.winningSource && matchingForAxis[0]!.losingSource === conflict.losingSource;
        if (!nonNull || !fieldsMatch) liveMatches = false;
        hashes.push(sha256Of(resolvedOut));
      }
      const allSame = hashes.every((h) => h === hashes[0]);
      const ok = allSame && liveMatches && irMatches;
      if (!ok) failures++;
      lines.push(`${c.id}: allSame=${allSame} liveResolverMatches=${liveMatches} irConflictResolutionMatches=${irMatches} (declared axis=${conflict.axis} winning=${conflict.winningSource} losing=${conflict.losingSource}) hashes=${hashes.join(',')} -- ${ok ? 'OK' : 'FAIL'}`);
    }
    return { ok: failures === 0, evidence: lines.join('\n'), detail: failures > 0 ? `${failures}/${conflictCases.length} conflict cases failed non-null-result, exactly-one-matching-claim, or IR-self-consistency` : undefined };
  }),
);

// =============================================================================
// C7-4 -- provenance pointers resolve on the FULL (nodeId, domPath,
// breakpoint) triple; THREE independent derangement controls (nodeId-only,
// domPath-only, breakpoint-only) each drive resolution to zero (F5)
// =============================================================================
await probe(
  'C7-4',
  `dynamic-import ${PROVENANCE_RESOLVE_PATH}; call resolveProvenance(ir, snapshotsBySource) on the real IR (expect resolved===total===provenance.length) and on THREE independently-deranged controls -- nodeId-only, domPath-only, breakpoint-only -- each expecting resolved===0`,
  `${PROVENANCE_RESOLVE_PATH} exports resolveProvenance(ir, snapshots): { total, resolved, unresolvedPointers }; snapshots carry the FULL captured node record (nodeId, domPath, breakpoint) per source, not nodeId alone; for every non-skip corpus case, total === ir.provenance.length and resolved === total > 0 on the real IR; on a control IR with ONLY nodeId deranged (domPath/breakpoint left correct), resolved === 0; independently, on a control with ONLY domPath deranged, resolved === 0; independently, on a control with ONLY breakpoint deranged, resolved === 0 -- a resolver that checks nodeId alone (ignoring domPath/breakpoint) passes the real case but fails at least one of the domPath-only/breakpoint-only controls, since those leave nodeId correct`,
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
      const ir = JSON.parse(loaded.bytes.toString('utf8')) as { provenance?: Array<{ sourceId: string; nodeId: string; domPath: string; breakpoint: string }> };
      if (!Array.isArray(ir.provenance) || ir.provenance.length < 2) {
        failures++;
        lines.push(`${c.id}: IR has fewer than 2 provenance entries -- cannot build fixed-point-free derangement controls`);
        continue;
      }
      const snaps = buildSnapshotsBySource(c);
      if (!snaps.ok) {
        failures++;
        lines.push(`${c.id}: ${snaps.error}`);
        continue;
      }
      const snapshotsBySource: Record<string, Array<{ nodeId: string; domPath: string; breakpoint: string }>> = {};
      for (const [sourceId, nodes] of Object.entries(snaps.bySource)) snapshotsBySource[sourceId] = nodes.map((n) => ({ nodeId: n.nodeId, domPath: n.domPath, breakpoint: n.breakpoint }));

      const call = async (testIr: unknown) =>
        (await (resolveProvenance as (ir: unknown, snaps: unknown) => unknown | Promise<unknown>)(testIr, snapshotsBySource)) as { total: number; resolved: number };

      // eslint-disable-next-line no-await-in-loop
      const real = await call(ir);
      const realOk = real.total === ir.provenance.length && real.resolved === real.total && real.total > 0;

      const controls: { label: string; deranged: string[] | null; field: 'nodeId' | 'domPath' | 'breakpoint' }[] = [
        { label: 'nodeId-only', deranged: derangeField(ir.provenance, 'nodeId'), field: 'nodeId' },
        { label: 'domPath-only', deranged: derangeField(ir.provenance, 'domPath'), field: 'domPath' },
        { label: 'breakpoint-only', deranged: derangeField(ir.provenance, 'breakpoint'), field: 'breakpoint' },
      ];
      let controlsOk = true;
      const controlLines: string[] = [];
      for (const ctl of controls) {
        if (!ctl.deranged) {
          controlsOk = false;
          controlLines.push(`${ctl.label}: could not construct derangement`);
          continue;
        }
        const derangedIr = { ...ir, provenance: ir.provenance.map((p, i) => ({ ...p, [ctl.field]: ctl.deranged![i] })) };
        // eslint-disable-next-line no-await-in-loop
        const control = await call(derangedIr);
        const ok = control.total === ir.provenance.length && control.resolved === 0;
        if (!ok) controlsOk = false;
        controlLines.push(`${ctl.label}: total=${control.total} resolved=${control.resolved} (expect total=${ir.provenance.length}, resolved=0) -- ${ok ? 'OK' : 'FAIL'}`);
      }

      const ok = realOk && controlsOk;
      if (!ok) failures++;
      lines.push(`${c.id}: real(total=${real.total},resolved=${real.resolved},expectedTotal=${ir.provenance.length},ok=${realOk})\n  ${controlLines.join('\n  ')} -- case ${ok ? 'OK' : 'FAIL'}`);
    }
    return { ok: failures === 0, evidence: lines.join('\n'), detail: failures > 0 ? `${failures}/${nonSkipCases.length} cases failed real-resolve or one of the 3 independent field-derangement controls` : undefined };
  },
);

// =============================================================================
// C7-5 -- corpus pinned, quota-satisfying, reproducible, and SUBSTANTIVE
// (F6: every declared breakpoint has a snapshot per source; layoutSystem is
// validated against real captured computed-style evidence; conflict
// metadata cross-references the IR's own conflictResolution record)
// =============================================================================
const LAYOUT_SYSTEM_EVIDENCE: Record<string, (style: Record<string, string>) => boolean> = {
  'css-grid-first': (s) => /grid/i.test(s['display'] ?? ''),
  'flex-utility': (s) => /flex/i.test(s['display'] ?? ''),
  'absolute-canvas': (s) => /absolute|fixed/i.test(s['position'] ?? ''),
};

await probe(
  'C7-5',
  `read ${MANIFEST_PATH} + ${CORPUS_MD_PATH}; assert each S7-2 quota row against a CLOSED genre/layout-system vocabulary; require every source to have a snapshot for every declared breakpoint (cross-checked, not just counted); validate declared layoutSystem against real captured computedStyle evidence; decrypt+re-hash every snapshot; require global content-hash distinctness, per-case distinct viewportWidths, a minimum node count; conflict metadata cross-references the case's own IR conflictResolution record`,
  `${CORPUS_MD_PATH} exists; layoutSystem in [${ALLOWED_LAYOUT_SYSTEMS.join(', ')}] (all 3 appear), genre in [${ALLOWED_GENRES.join(', ')}] (all 4 appear); every non-skip case's breakpoints has no duplicates, >=2 entries, and for EVERY source in that case, Object.keys(source.snapshots) is EXACTLY that breakpoint set (not merely >=2 in count -- a source missing one declared breakpoint's snapshot fails); css-grid-first cases have >=1 captured node with computedStyle.display matching /grid/, flex-utility have >=1 node with display matching /flex/, absolute-canvas have >=1 node with position matching /absolute|fixed/; >=3 conflict cases with a real axis + real distinct source ids, AND each case's decrypted IR has a conflictResolution entry matching that exact axis/winningSource/losingSource (cross-referencing the same record C7-3 exercises live); degenerate cases are semantically real; >=1 documented skip; every snapshot's re-computed plaintext sha256 matches the manifest, every snapshot has >=5 nodes, and NO TWO snapshot files anywhere in the corpus share a content hash; ADDITIONALLY (Phase-2, gate-scope ruling item 8, necessary but not sufficient with the checks above): ${dispositionPath('F6')} must record a commit-bound, dual-reviewer (Sol-lane + Grok-lane) APPROVE disposing the verbatim round-3 F6 finding -- until it exists this criterion fails with "reviewer disposition records missing"; ${PHASE2_TRUST_BOUNDARY_NOTE}`,
  async () => withReviewerDisposition('F6', async () => {
    if (!exists(CORPUS_MD_PATH)) return { ok: false, evidence: `missing ${CORPUS_MD_PATH}` };
    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot check quotas: ${error}` };
    const cases = manifest.cases;
    const nonSkip = cases.filter((c) => c.skip === null);

    const rows: { row: string; ok: boolean; detail: string }[] = [];

    const badLayout = nonSkip.filter((c) => !(ALLOWED_LAYOUT_SYSTEMS as readonly string[]).includes(c.layoutSystem));
    const layoutSystems = new Set(nonSkip.map((c) => c.layoutSystem));
    rows.push({ row: 'layoutSystem is closed-vocabulary and >=3 distinct', ok: badLayout.length === 0 && layoutSystems.size >= 3, detail: `values=[${[...layoutSystems].join(', ')}] offVocab=${badLayout.map((c) => c.id).join(',') || 'none'}` });

    const badGenre = nonSkip.filter((c) => !(ALLOWED_GENRES as readonly string[]).includes(c.genre));
    const genres = new Set(nonSkip.map((c) => c.genre));
    rows.push({ row: 'genre is closed-vocabulary and >=4 distinct', ok: badGenre.length === 0 && genres.size >= 4, detail: `values=[${[...genres].join(', ')}] offVocab=${badGenre.map((c) => c.id).join(',') || 'none'}` });

    const under2bp = nonSkip.filter((c) => c.breakpoints.length < 2);
    const dupBp = nonSkip.filter((c) => new Set(c.breakpoints).size !== c.breakpoints.length);
    // F6: cross-check, not just count -- every source's snapshot key set
    // must be EXACTLY the case's declared breakpoint set. A case that
    // declares 2 breakpoints but a source only captured 1 now fails here.
    const missingBpCoverage: string[] = [];
    for (const c of nonSkip) {
      const declared = new Set(c.breakpoints);
      for (const source of c.sources) {
        const have = new Set(Object.keys(source.snapshots));
        const missing = [...declared].filter((bp) => !have.has(bp));
        const extra = [...have].filter((bp) => !declared.has(bp));
        if (missing.length > 0 || extra.length > 0) missingBpCoverage.push(`${c.id}/${source.id}: missing=[${missing.join(',')}] extra=[${extra.join(',')}]`);
      }
    }
    rows.push({
      row: 'breakpoints >=2 per non-skip case, no duplicates, and EVERY source has a snapshot for EVERY declared breakpoint (cross-checked)',
      ok: under2bp.length === 0 && dupBp.length === 0 && missingBpCoverage.length === 0,
      detail: `under2=${under2bp.map((c) => c.id).join(',') || 'none'} dup=${dupBp.map((c) => c.id).join(',') || 'none'} coverageGaps=${missingBpCoverage.join('; ') || 'none'}`,
    });

    const conflictCases = cases.filter((c) => c.conflict !== null);
    const badConflictSemantics = conflictCases.filter((c) => {
      const conflict = c.conflict!;
      const sourceIds = new Set(c.sources.map((s) => s.id));
      return !DIRECTIVE_AXES.includes(conflict.axis as DirectiveAxis) || !sourceIds.has(conflict.winningSource) || !sourceIds.has(conflict.losingSource) || conflict.winningSource === conflict.losingSource;
    });
    // F6: conflict metadata must cross-reference the case's OWN IR
    // conflictResolution record (the same thing C7-3 exercises live).
    const conflictCrossRefProblems: string[] = [];
    for (const c of conflictCases) {
      const loaded = loadCaseIRBytes(c);
      if (!loaded.ok) {
        conflictCrossRefProblems.push(`${c.id}: ${loaded.error}`);
        continue;
      }
      let ir: { conflictResolution?: Array<{ axis?: string; winningSource?: string; losingSource?: string }> };
      try {
        ir = JSON.parse(loaded.bytes.toString('utf8'));
      } catch {
        conflictCrossRefProblems.push(`${c.id}: IR not valid JSON`);
        continue;
      }
      const entry = (ir.conflictResolution ?? []).find((e) => e.axis === c.conflict!.axis);
      if (!entry || entry.winningSource !== c.conflict!.winningSource || entry.losingSource !== c.conflict!.losingSource) {
        conflictCrossRefProblems.push(`${c.id}: ir.conflictResolution has no entry matching declared axis=${c.conflict!.axis} winning=${c.conflict!.winningSource} losing=${c.conflict!.losingSource}`);
      }
    }
    rows.push({
      row: 'conflict pairs >=3 cases, real axis + real distinct source ids, AND cross-referenced against the case IR conflictResolution record',
      ok: conflictCases.length >= 3 && badConflictSemantics.length === 0 && conflictCrossRefProblems.length === 0,
      detail: `count=${conflictCases.length} semanticallyInvalid=${badConflictSemantics.map((c) => c.id).join(',') || 'none'} crossRefProblems=${conflictCrossRefProblems.join('; ') || 'none'}`,
    });

    const skipCases = cases.filter((c) => c.skip !== null);
    const skipReasonsOk = skipCases.every((c) => c.skip && ['login-walled', 'bot-walled'].includes(c.skip.reason) && c.skip.target.length > 0);
    rows.push({ row: 'documented skip >=1 with valid reason+target', ok: skipCases.length >= 1 && skipReasonsOk, detail: `count=${skipCases.length}, reasonsOk=${skipReasonsOk}` });

    // Snapshot decrypt + integrity + node-count + viewportWidth-distinctness
    // + global content-hash distinctness + layoutSystem-content evidence +
    // degenerate-kind semantic checks, in one pass over the snapshot data.
    let hashChecked = 0;
    let hashMismatches = 0;
    let tinySnapshots = 0;
    const hashLines: string[] = [];
    const globalHashLocations = new Map<string, string[]>();
    const caseNodeTotals = new Map<string, number>();
    const caseDomPaths = new Map<string, Set<string>>();
    const caseLayoutEvidence = new Map<string, boolean>();
    const perCaseBreakpointWidths = new Map<string, Map<string, Set<number>>>();

    for (const c of cases) {
      let nodeTotal = 0;
      const domPaths = new Set<string>();
      const bpWidths = new Map<string, Set<number>>();
      const evidenceCheck = LAYOUT_SYSTEM_EVIDENCE[c.layoutSystem];
      let layoutEvidenceFound = false;
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
            hashLines.push(`${label}: only ${nodes.length} nodes (< 5)`);
          }
          nodeTotal += nodes.length;
          for (const n of nodes) {
            domPaths.add(n.domPath);
            if (evidenceCheck && n.computedStyle && evidenceCheck(n.computedStyle)) layoutEvidenceFound = true;
          }
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
      caseLayoutEvidence.set(c.id, layoutEvidenceFound);
      perCaseBreakpointWidths.set(c.id, bpWidths);
    }
    rows.push({ row: 'snapshot content-hashes match manifest (pinned, post-decrypt for sealed)', ok: hashChecked > 0 && hashMismatches === 0, detail: `checked=${hashChecked} mismatches=${hashMismatches}` });
    rows.push({ row: 'every snapshot has >=5 nodes (not a tiny placeholder)', ok: tinySnapshots === 0, detail: `tinySnapshots=${tinySnapshots}` });

    const layoutEvidenceProblems = nonSkip.filter((c) => LAYOUT_SYSTEM_EVIDENCE[c.layoutSystem] && !caseLayoutEvidence.get(c.id));
    rows.push({
      row: 'declared layoutSystem is backed by real captured computedStyle evidence (grid/flex/absolute-position presence)',
      ok: layoutEvidenceProblems.length === 0,
      detail: layoutEvidenceProblems.length ? layoutEvidenceProblems.map((c) => `${c.id}: no node evidences layoutSystem="${c.layoutSystem}"`).join('; ') : 'all cases have supporting evidence',
    });

    const duplicateHashes = [...globalHashLocations.entries()].filter(([, locs]) => locs.length > 1);
    rows.push({
      row: 'snapshot content is GLOBALLY distinct across the whole corpus',
      ok: duplicateHashes.length === 0,
      detail: duplicateHashes.length ? duplicateHashes.map(([h, locs]) => `${h.slice(0, 12)}...: ${locs.join(', ')}`).join('; ') : `all ${globalHashLocations.size} snapshot hashes distinct`,
    });

    let widthCollisions = 0;
    const widthLines: string[] = [];
    for (const [caseId, bpWidths] of perCaseBreakpointWidths) {
      const allWidths = [...bpWidths.values()].flatMap((s) => [...s]);
      if (new Set(allWidths).size !== allWidths.length) {
        widthCollisions++;
        widthLines.push(`${caseId}: duplicate viewportWidth across declared breakpoints (${allWidths.join(',')})`);
      }
    }
    rows.push({ row: 'each case has a distinct viewportWidth per breakpoint', ok: widthCollisions === 0, detail: widthLines.join('; ') || 'no collisions' });

    const degenerateProblems: string[] = [];
    for (const kind of ['single-source', 'nonexistent-element-directive', 'hostile-heavy-dom'] as const) {
      const matching = cases.filter((c) => c.degenerate === kind);
      if (matching.length === 0) {
        degenerateProblems.push(`no case declares degenerate="${kind}"`);
        continue;
      }
      for (const c of matching) {
        if (kind === 'single-source' && c.sources.length !== 1) degenerateProblems.push(`${c.id}: degenerate="single-source" but sources.length=${c.sources.length}`);
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
    rows.push({ row: 'degenerate cases are semantically real', ok: degenerateProblems.length === 0, detail: degenerateProblems.join('; ') || 'all degenerate cases verified' });

    const failed = rows.filter((r) => !r.ok);
    const evidence = [...rows.map((r) => `[${r.ok ? 'OK' : 'FAIL'}] ${r.row} -- ${r.detail}`), ...hashLines].join('\n');
    return { ok: failed.length === 0, evidence, detail: failed.length > 0 ? `failed rows: ${failed.map((r) => r.row).join('; ')}` : undefined };
  }),
);

// Shared fixture loader for the implementer-fixture (non-load-bearing)
// checks below: reads input.json, deep-blinds it (F7), requires the caseId
// to reference a real corpus case, and returns the blinded content's stable
// hash for cross-fixture uniqueness checks.
function loadBlindedFixture(relDir: string, manifest: CorpusManifest): { ok: true; input: ScoringInput; blindHash: string } | { ok: false; error: string } {
  const raw = readJson<unknown>(path.join(relDir, 'input.json'));
  if (raw === null) return { ok: false, error: `${relDir}: missing or invalid input.json` };
  const blinded = blindInput(raw);
  if (!blinded.ok) return { ok: false, error: `${relDir}: ${blinded.error}` };
  if (!manifest.cases.some((c) => c.id === blinded.input.caseId)) return { ok: false, error: `${relDir}: caseId "${blinded.input.caseId}" is not a real corpus case` };
  return { ok: true, input: blinded.input, blindHash: sha256Of(blinded.input) };
}

// =============================================================================
// C7-6 -- grader discriminates on a population, not an example. F7: the
// "wrong" population is now VERIFIER-BUILT by mutating real faithful
// compositions (cross-case attribution swap), removing the implementer from
// authoring ground truth entirely; implementer-provided fixtures (if any)
// remain non-load-bearing extras reported alongside.
// =============================================================================
await probe(
  'C7-6',
  `dynamic-import ${SCORER_INDEX_PATH}; for >=5 eligible corpus cases build a real faithfulComposition (verifier-built, "faithful" population) and a cross-case-attribution-swapped mutation of it (verifier-built, "wrong" population -- every element's sourceId replaced with a source id belonging to a DIFFERENT case entirely); score both populations and assert zero distribution overlap; also score any implementer-provided fixtures under ${POPULATION_DIR} as an additional, non-load-bearing check`,
  `>=5 corpus cases (non-sealed, non-skip, directiveInventory-resolvable) each yield a faithful composition and a cross-case-mutated "wrong" counterpart (every sourceId replaced by a source id foreign to that case); scoreComposition(input).overall in [0,1] (F12) for all 10; max(wrong scores) < min(faithful scores); implementer fixtures under ${POPULATION_DIR}/{wrong,faithful} (if present) must also be corpus-derived + blinded + mutually unique and are scored as an additional, non-load-bearing signal; ADDITIONALLY (Phase-2, gate-scope ruling item 8, necessary but not sufficient with the checks above): ${dispositionPath('F7')} must record a commit-bound, dual-reviewer (Sol-lane + Grok-lane) APPROVE disposing the verbatim round-3 F7 finding -- until it exists this criterion fails with "reviewer disposition records missing"; ${PHASE2_TRUST_BOUNDARY_NOTE}`,
  async () => withReviewerDisposition('F7', async () => {
    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot run: ${error}` };
    const imported = await importEvalModule(SCORER_INDEX_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const scoreComposition = imported.mod['scoreComposition'];
    if (typeof scoreComposition !== 'function') return { ok: false, evidence: `${SCORER_INDEX_PATH} does not export scoreComposition` };

    const eligible = manifest.cases.filter((c) => !c.sealed && !c.skip && c.directiveInventory.length >= 1 && faithfulComposition(c) !== null);
    if (eligible.length < 5) return { ok: false, evidence: `only ${eligible.length} eligible (non-sealed, non-skip, resolvable) corpus cases, need >=5` };

    const scoreOne = async (caseId: string, composition: CompositionElement[]): Promise<{ score: number; errors: string[] }> => {
      const input: ScoringInput = { caseId, composition };
      const out = (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(input)) as { overall?: unknown; axes?: unknown };
      const errs = scoreRangeErrors(out);
      return { score: errs.length === 0 ? (out.overall as number) : NaN, errors: errs };
    };

    const faithfulScores: number[] = [];
    const wrongScores: number[] = [];
    const lines: string[] = [];
    const errors: string[] = [];
    for (let i = 0; i < Math.min(eligible.length, 8); i++) {
      const c = eligible[i]!;
      const faithful = faithfulComposition(c)!;
      // eslint-disable-next-line no-await-in-loop
      const faithfulResult = await scoreOne(c.id, faithful);
      if (faithfulResult.errors.length > 0) {
        errors.push(`${c.id} faithful: ${faithfulResult.errors.join('; ')}`);
      } else {
        faithfulScores.push(faithfulResult.score);
        lines.push(`${c.id} faithful=${faithfulResult.score.toFixed(3)}`);
      }

      const foreign = eligible.find((other) => other.id !== c.id && !c.sources.some((s) => other.sources.some((os) => os.id === s.id)));
      if (!foreign) {
        errors.push(`${c.id}: no foreign case with a disjoint source-id set to build a cross-case mutation from`);
        continue;
      }
      const foreignSourceId = foreign.sources[0]!.id;
      const wrong = faithful.map((el) => ({ ...el, sourceId: foreignSourceId }));
      // eslint-disable-next-line no-await-in-loop
      const wrongResult = await scoreOne(c.id, wrong);
      if (wrongResult.errors.length > 0) {
        errors.push(`${c.id} wrong (foreign source ${foreignSourceId} from ${foreign.id}): ${wrongResult.errors.join('; ')}`);
      } else {
        wrongScores.push(wrongResult.score);
        lines.push(`${c.id} wrong(foreignSource=${foreignSourceId} from ${foreign.id})=${wrongResult.score.toFixed(3)}`);
      }
    }
    if (faithfulScores.length < 5) errors.push(`only ${faithfulScores.length} valid verifier-built "faithful" scores, need >=5`);
    if (wrongScores.length < 5) errors.push(`only ${wrongScores.length} valid verifier-built "wrong" scores, need >=5`);
    if (errors.length > 0) return { ok: false, evidence: [...lines, ...errors].join('\n') };

    const maxWrong = Math.max(...wrongScores);
    const minFaithful = Math.min(...faithfulScores);
    const separated = maxWrong < minFaithful;

    // Additional, non-load-bearing: implementer fixtures, if provided.
    const seenHashes = new Map<string, string>();
    const fixtureLines: string[] = [];
    const scoreImplementerGroup = async (subdir: 'wrong' | 'faithful'): Promise<number> => {
      const dir = abs(path.join(POPULATION_DIR, subdir));
      if (!fs.existsSync(dir)) {
        fixtureLines.push(`${subdir}: no implementer fixtures present (not required)`);
        return 0;
      }
      let count = 0;
      for (const entry of fs.readdirSync(dir)) {
        const relDir = path.join(POPULATION_DIR, subdir, entry);
        const loaded = loadBlindedFixture(relDir, manifest);
        if (!loaded.ok) {
          fixtureLines.push(`${relDir}: ${loaded.error}`);
          continue;
        }
        const dup = seenHashes.get(loaded.blindHash);
        if (dup) {
          fixtureLines.push(`${relDir}: blinded content identical to ${dup}`);
          continue;
        }
        seenHashes.set(loaded.blindHash, relDir);
        // eslint-disable-next-line no-await-in-loop
        const out = (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(loaded.input)) as { overall?: unknown; axes?: unknown };
        const re = scoreRangeErrors(out);
        fixtureLines.push(`${relDir}: score=${re.length === 0 ? (out.overall as number).toFixed(3) : `INVALID (${re.join('; ')})`}`);
        count++;
      }
      return count;
    };
    const implementerWrongCount = await scoreImplementerGroup('wrong');
    const implementerFaithfulCount = await scoreImplementerGroup('faithful');

    const evidence = [
      ...lines,
      `verifier-built: wrong max=${maxWrong.toFixed(3)} faithful min=${minFaithful.toFixed(3)} separated=${separated}`,
      `implementer fixtures (additional, non-load-bearing): wrong=${implementerWrongCount} faithful=${implementerFaithfulCount}`,
      ...fixtureLines,
    ].join('\n');
    return { ok: separated, evidence, detail: separated ? undefined : 'verifier-built score distributions overlap' };
  }),
);

// =============================================================================
// C7-7 -- source bleed: verifier-constructed controls now cover BOTH a
// domPath-membership bleed AND a style-fingerprint bleed (F8) -- an element
// can be correctly attributed by domPath yet still carry a computed-style
// cluster injected from a non-selected source, and the metric must catch
// that too, not just DOM-path set membership.
// =============================================================================
await probe(
  'C7-7',
  `dynamic-import ${SOURCE_BLEED_PATH}; build THREE verifier compositions from real captured node+style data -- clean, domPath-membership-bled (one element's domPath/nodeId genuinely belongs to a different source), and style-fingerprint-bled (one element's domPath/nodeId are correct but its styleFingerprint is injected from a non-selected source's real captured style cluster) -- call scoreSourceBleed directly on all three; ALSO run the implementer test suite as an additional, non-load-bearing check`,
  `${SOURCE_BLEED_PATH} exports scoreSourceBleed({composition, sourceDomPaths, sourceStyleFingerprints}): {bleedCount, violatingElementIds}; clean composition scores bleedCount===0; domPath-membership-bled scores bleedCount>=1 including "bleed-el-0"; style-fingerprint-bled (domPath/nodeId correct, only styleFingerprint injected from a different real source) ALSO scores bleedCount>=1 including "bleed-el-0" -- a domPath-set-membership-only implementation passes the second control but fails the third by construction; ${SOURCE_BLEED_TEST_PATH} additionally passes with named clean/injected-bleed/absent-name control cases; ADDITIONALLY (Phase-2, gate-scope ruling item 8, necessary but not sufficient with the checks above -- C7-7 and C7-8 share the F8 disposition, which historically covered both bleed and diversity semantics): ${dispositionPath('F8')} must record a commit-bound, dual-reviewer (Sol-lane + Grok-lane) APPROVE disposing the verbatim round-3 F8 finding -- until it exists this criterion fails with "reviewer disposition records missing"; ${PHASE2_TRUST_BOUNDARY_NOTE}`,
  async () => withReviewerDisposition('F8', async () => {
    if (!exists(SOURCE_BLEED_PATH)) return { ok: false, evidence: `missing ${SOURCE_BLEED_PATH}` };
    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot run: ${error}` };

    let target: { c: CorpusCase; bySource: Record<string, ResolvableNode[]>; sourceA: string; sourceB: string; nodeA: ResolvableNode; nodeB: ResolvableNode; fpA: string; fpB: string } | null = null;
    for (const c of manifest.cases.filter((cc) => !cc.sealed && !cc.skip)) {
      const snaps = buildSnapshotsBySource(c);
      if (!snaps.ok) continue;
      const sourceIds = Object.keys(snaps.bySource).filter((id) => (snaps.bySource[id]?.length ?? 0) > 0);
      if (sourceIds.length < 2) continue;
      const [sourceA, sourceB] = sourceIds;
      const nodesA = snaps.bySource[sourceA!]!;
      const nodesB = snaps.bySource[sourceB!]!;
      const nodeA = nodesA.find((n) => styleFingerprintOf(n.computedStyle));
      if (!nodeA) continue;
      const fpA = styleFingerprintOf(nodeA.computedStyle)!;
      const nodeB = nodesB.find((n) => {
        const fp = styleFingerprintOf(n.computedStyle);
        return fp && fp !== fpA;
      });
      if (!nodeB) continue;
      target = { c, bySource: snaps.bySource, sourceA: sourceA!, sourceB: sourceB!, nodeA, nodeB, fpA, fpB: styleFingerprintOf(nodeB.computedStyle)! };
      break;
    }
    if (!target) return { ok: false, evidence: 'no corpus case with >=2 sources each carrying distinct real computedStyle fingerprints was found to build bleed controls from' };

    const nodesA = target.bySource[target.sourceA]!;
    const cleanPool = nodesA.filter((n) => n.nodeId !== target!.nodeA.nodeId).slice(0, 4);
    const clean: CompositionElement[] = [target.nodeA, ...cleanPool].map((n, i) => {
      const fp = styleFingerprintOf(n.computedStyle);
      const el: CompositionElement = { elementId: `bleed-el-${i}`, sourceId: target!.sourceA, domPath: n.domPath, nodeId: n.nodeId, breakpoint: n.breakpoint };
      if (fp) el.styleFingerprint = fp;
      return el;
    });
    const domPathBled = clean.map((el, i) => (i === 0 ? { ...el, domPath: target!.nodeB.domPath, nodeId: target!.nodeB.nodeId, breakpoint: target!.nodeB.breakpoint } : el));
    const styleBled = clean.map((el, i) => (i === 0 ? { ...el, styleFingerprint: target!.fpB } : el));

    const sourceDomPaths: Record<string, string[]> = {};
    const sourceStyleFingerprints: Record<string, string[]> = {};
    for (const [sourceId, nodes] of Object.entries(target.bySource)) {
      sourceDomPaths[sourceId] = nodes.map((n) => n.domPath);
      sourceStyleFingerprints[sourceId] = [...new Set(nodes.map((n) => styleFingerprintOf(n.computedStyle)).filter((v): v is string => v !== null))];
    }

    const imported = await importEvalModule(SOURCE_BLEED_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const scoreSourceBleed = imported.mod['scoreSourceBleed'];
    if (typeof scoreSourceBleed !== 'function') return { ok: false, evidence: `${SOURCE_BLEED_PATH} does not export a scoreSourceBleed function` };
    const call = async (composition: CompositionElement[]) =>
      (await (scoreSourceBleed as (i: unknown) => unknown | Promise<unknown>)({ composition, sourceDomPaths, sourceStyleFingerprints })) as { bleedCount?: unknown; violatingElementIds?: unknown };

    const cleanResult = await call(clean);
    const domPathBledResult = await call(domPathBled);
    const styleBledResult = await call(styleBled);
    const validCounts = isValidCount(cleanResult.bleedCount) && isValidCount(domPathBledResult.bleedCount) && isValidCount(styleBledResult.bleedCount);
    const cleanOk = validCounts && cleanResult.bleedCount === 0;
    const domPathOk = validCounts && (domPathBledResult.bleedCount as number) >= 1 && Array.isArray(domPathBledResult.violatingElementIds) && domPathBledResult.violatingElementIds.includes('bleed-el-0');
    const styleOk = validCounts && (styleBledResult.bleedCount as number) >= 1 && Array.isArray(styleBledResult.violatingElementIds) && styleBledResult.violatingElementIds.includes('bleed-el-0');

    const testRun = runNodeTest([SOURCE_BLEED_TEST_PATH]);
    const needles = ['clean', 'inject', 'absent'];
    const missingNeedles = needles.filter((n) => !testRun.tests.some((t) => t.name.toLowerCase().includes(n) && t.pass));
    const testsOk = testRun.status === 0 && testRun.tests.length > 0 && missingNeedles.length === 0;

    const ok = cleanOk && domPathOk && styleOk && testsOk;
    const evidence = [
      `case=${target.c.id} sourceA=${target.sourceA} sourceB=${target.sourceB}`,
      `clean -> ${JSON.stringify(cleanResult)} (expect bleedCount=0): ${cleanOk ? 'OK' : 'FAIL'}`,
      `domPath-membership-bled -> ${JSON.stringify(domPathBledResult)} (expect bleedCount>=1 incl. bleed-el-0): ${domPathOk ? 'OK' : 'FAIL'}`,
      `style-fingerprint-bled -> ${JSON.stringify(styleBledResult)} (expect bleedCount>=1 incl. bleed-el-0): ${styleOk ? 'OK' : 'FAIL'}`,
      `implementer test suite (additional, non-load-bearing): exit=${testRun.status} missingNeedles=${missingNeedles.join(',') || 'none'}`,
    ].join('\n');
    return { ok, evidence, detail: ok ? undefined : `cleanOk=${cleanOk} domPathOk=${domPathOk} styleOk=${styleOk} testsOk=${testsOk}` };
  }),
);

// =============================================================================
// C7-8 -- diversity: FOUR independent axis-isolation trios (F8), one per
// pre-registered axis (section-order, layout-skeleton, motion-timeline,
// breakpoint-behavior), each varying ONLY that axis and required to move
// the metric on its own; plus the identical-trio negative control.
// =============================================================================
function rotateArray<T>(arr: T[], shift: number): T[] {
  const n = arr.length;
  return arr.map((_, i) => arr[(i + shift) % n]!);
}

await probe(
  'C7-8',
  `read ${DIVERSITY_AXES_PATH}; dynamic-import ${DIVERSITY_PATH}; build 4 INDEPENDENT axis-isolated trios from a real faithful composition (section order permuted alone / domPath-skeleton varied alone / motionSignature varied alone / breakpoint varied alone) plus the identical-trio control; call scoreDiversity directly on all 5; ALSO run the implementer test suite as an additional, non-load-bearing check`,
  `${DIVERSITY_AXES_PATH} freezes >=4 pre-registered axes (layout-skeleton/section-order/motion-timeline/breakpoint-behavior); ${DIVERSITY_PATH} exports scoreDiversity(compositions[]): {score}, a finite number in [0,1] (F12); the fully-identical trio scores < floors.structural_variant_diversity; EACH of the 4 axis-isolated trios (holding every other axis fixed) independently scores >= that floor -- a scorer testing only "any change" or only 2 of the 4 axes fails at least one isolated case; ${DIVERSITY_TEST_PATH} additionally passes with named recolor-only/class-names-only control cases; ADDITIONALLY (Phase-2, gate-scope ruling item 8, necessary but not sufficient with the checks above -- C7-7 and C7-8 share the F8 disposition, which historically covered both bleed and diversity semantics): ${dispositionPath('F8')} must record a commit-bound, dual-reviewer (Sol-lane + Grok-lane) APPROVE disposing the verbatim round-3 F8 finding -- until it exists this criterion fails with "reviewer disposition records missing"; ${PHASE2_TRUST_BOUNDARY_NOTE}`,
  async () => withReviewerDisposition('F8', async () => {
    const axes = readJson<{ axes?: Array<{ name: string }> }>(DIVERSITY_AXES_PATH);
    if (axes === null || !Array.isArray(axes.axes)) return { ok: false, evidence: `missing or invalid ${DIVERSITY_AXES_PATH}` };
    const names = axes.axes.map((a) => a.name.toLowerCase());
    const requiredAxisNames = ['layout-skeleton', 'section-order', 'motion-timeline', 'breakpoint-behavior'];
    const missingAxes = requiredAxisNames.filter((req) => !names.some((n) => n.includes(req.split('-')[0] ?? req)));
    if (missingAxes.length > 0) return { ok: false, evidence: `${DIVERSITY_AXES_PATH} is missing pre-registered axes matching: ${missingAxes.join(', ')} (found: ${names.join(', ')})` };
    if (!exists(DIVERSITY_PATH)) return { ok: false, evidence: `missing ${DIVERSITY_PATH}` };

    const floorsDoc = readJson<{ floors?: Record<string, number> }>(FLOORS_PATH);
    const floor = floorsDoc?.floors?.['structural_variant_diversity'];
    if (typeof floor !== 'number') return { ok: false, evidence: `${FLOORS_PATH} missing numeric floors.structural_variant_diversity` };

    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot run: ${error}` };
    const c = pickCaseWithDirectives(manifest, 2);
    if (!c) return { ok: false, evidence: 'no non-sealed, non-skip corpus case with >=2 sources and a resolvable faithful composition to build diversity controls from' };
    const base = faithfulComposition(c)!;
    if (base.length < 2) return { ok: false, evidence: `case ${c.id}'s faithful composition has fewer than 2 elements -- cannot vary section order meaningfully` };
    if (c.breakpoints.length < 2) return { ok: false, evidence: `case ${c.id} declares fewer than 2 breakpoints -- cannot build an independent breakpoint-behavior trio` };

    const identicalTrio = [base, base.map((e) => ({ ...e })), base.map((e) => ({ ...e }))];
    const sectionOrderTrio = [base, rotateArray(base, 1), [...base].reverse()];
    const skeletonTrio = [base, base.map((e) => ({ ...e, domPath: `${e.domPath}#skeleton-b` })), base.map((e) => ({ ...e, domPath: `${e.domPath}#skeleton-c` }))];
    const motionTrio = [base.map((e) => ({ ...e, motionSignature: 'timeline-a' })), base.map((e) => ({ ...e, motionSignature: 'timeline-b' })), base.map((e) => ({ ...e, motionSignature: 'timeline-c' }))];
    const [bpA, bpB] = c.breakpoints;
    const breakpointTrio = [base.map((e) => ({ ...e, breakpoint: bpA! })), base.map((e) => ({ ...e, breakpoint: bpB! })), base.map((e, i) => ({ ...e, breakpoint: c.breakpoints[(i + 1) % c.breakpoints.length]! }))];

    const imported = await importEvalModule(DIVERSITY_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const scoreDiversity = imported.mod['scoreDiversity'];
    if (typeof scoreDiversity !== 'function') return { ok: false, evidence: `${DIVERSITY_PATH} does not export a scoreDiversity function` };
    const call = async (trio: CompositionElement[][]) => (await (scoreDiversity as (v: unknown) => unknown | Promise<unknown>)(trio)) as { score?: unknown };

    const checks: { label: string; result: { score?: unknown }; expectBelow: boolean }[] = [
      { label: 'identical (expect below floor)', result: await call(identicalTrio), expectBelow: true },
      { label: 'section-order-only (expect >= floor)', result: await call(sectionOrderTrio), expectBelow: false },
      { label: 'layout-skeleton-only (expect >= floor)', result: await call(skeletonTrio), expectBelow: false },
      { label: 'motion-timeline-only (expect >= floor)', result: await call(motionTrio), expectBelow: false },
      { label: 'breakpoint-behavior-only (expect >= floor)', result: await call(breakpointTrio), expectBelow: false },
    ];
    const lines: string[] = [];
    let failures = 0;
    for (const chk of checks) {
      const scoreValid = isValidUnitScore(chk.result.score);
      const ok = scoreValid && (chk.expectBelow ? (chk.result.score as number) < floor : (chk.result.score as number) >= floor);
      if (!ok) failures++;
      lines.push(`${chk.label}: score=${String(chk.result.score)} -- ${ok ? 'OK' : 'FAIL'}`);
    }

    const testRun = runNodeTest([DIVERSITY_TEST_PATH]);
    const needles = ['recolor', 'class'];
    const missingNeedles = needles.filter((n) => !testRun.tests.some((t) => t.name.toLowerCase().includes(n) && t.pass));
    const testsOk = testRun.status === 0 && testRun.tests.length > 0 && missingNeedles.length === 0;

    const ok = failures === 0 && testsOk;
    const evidence = [`axis set: ${names.join(', ')}; floor=${floor}; case=${c.id}`, ...lines, `implementer test suite (additional, non-load-bearing): exit=${testRun.status} missingNeedles=${missingNeedles.join(',') || 'none'}`].join('\n');
    return { ok, evidence, detail: ok ? undefined : `${failures} axis-isolation checks failed; testsOk=${testsOk}` };
  }),
);

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
// C7-9 -- directive_claim_coverage: cited evidence must RESOLVE through the
// SAME resolution machinery as C7-4, and the cited output element must
// exist in the composition (F9). The verifier independently resolves
// faithful vs house-style compositions against real snapshot data BEFORE
// trusting the scorer's self-reported axis value -- if the verifier's own
// resolution doesn't match the expected pattern, the criterion fails
// outright regardless of what the scorer claims.
// =============================================================================
await probe(
  'C7-9',
  `build a verifier faithful composition (every directiveInventory claim's cited evidence resolves against its OWN claimed source via the C7-4 resolution machinery) and a house-style composition (same underlying nodes, sourceId misattributed -- so resolution against the claimed source fails); independently verify this resolution pattern BEFORE checking the scorer; then require axes.directive_claim_coverage to be low/high accordingly while geometry/palette/type stay high on house-style; also score implementer fixtures as an additional, non-load-bearing check`,
  `every faithful-composition element's (nodeId,domPath,breakpoint) resolves against its claimed sourceId's real captured nodes (100%, same resolves() function as C7-4) and each directiveInventory[i] has a corresponding composition[i] with matching domPath (cited output element exists); every house-style element's claimed attribution does NOT resolve (0%) since the underlying node data is real but misattributed -- if either resolution check fails, this criterion fails outright before the scorer is even consulted; GIVEN that resolution pattern holds, scoreComposition's axes.directive_claim_coverage is < floor for house-style (while layout_geometry/palette_fidelity/type_fidelity are >= floor) and >= floor for faithful; implementer fixtures under ${DIRECTIVE_FIXTURES_DIR} (if present) are scored as an additional, non-load-bearing signal; ADDITIONALLY (Phase-2, gate-scope ruling item 8, necessary but not sufficient with the checks above): ${dispositionPath('F9')} must record a commit-bound, dual-reviewer (Sol-lane + Grok-lane) APPROVE disposing the verbatim round-3 F9 finding -- until it exists this criterion fails with "reviewer disposition records missing"; ${PHASE2_TRUST_BOUNDARY_NOTE}`,
  async () => withReviewerDisposition('F9', async () => {
    const floors = readJson<{ floors?: Record<string, number> }>(FLOORS_PATH);
    if (floors === null || !floors.floors) return { ok: false, evidence: `missing or invalid ${FLOORS_PATH}` };
    const missingFloorAxes = REQUIRED_AXES.filter((a) => typeof floors.floors?.[a] !== 'number');
    if (missingFloorAxes.length > 0) return { ok: false, evidence: `${FLOORS_PATH} missing numeric floors for: ${missingFloorAxes.join(', ')}` };
    const f = floors.floors;

    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot run: ${error}` };
    const c = pickCaseWithDirectives(manifest, 2);
    if (!c) return { ok: false, evidence: 'no non-sealed, non-skip corpus case with >=2 sources and a resolvable faithful composition to build coverage controls from' };
    const faithful = faithfulComposition(c)!;
    const houseStyle = houseStyleComposition(c)!;
    const snaps = buildSnapshotsBySource(c);
    if (!snaps.ok) return { ok: false, evidence: snaps.error };

    // Independent verifier-side resolution, BEFORE consulting the scorer.
    const faithfulResolved = faithful.filter((el) => resolves(el, snaps.bySource)).length;
    const houseStyleResolved = houseStyle.filter((el) => resolves(el, snaps.bySource)).length;
    const citedElementsExist = c.directiveInventory.every((d, i) => faithful[i] !== undefined && faithful[i]!.domPath === d.scope);
    const setupOk = faithfulResolved === faithful.length && houseStyleResolved === 0 && citedElementsExist;
    if (!setupOk) {
      return {
        ok: false,
        evidence: `verifier-side resolution setup is broken (before the scorer was even consulted): faithfulResolved=${faithfulResolved}/${faithful.length} (want all) houseStyleResolved=${houseStyleResolved}/${houseStyle.length} (want 0) citedElementsExist=${citedElementsExist}`,
        detail: 'F9: cited evidence did not resolve as expected -- cannot trust a coverage-axis test built on unresolvable evidence',
      };
    }

    const imported = await importEvalModule(SCORER_INDEX_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const scoreComposition = imported.mod['scoreComposition'];
    if (typeof scoreComposition !== 'function') return { ok: false, evidence: `${SCORER_INDEX_PATH} does not export scoreComposition` };
    const scoreOf = async (composition: CompositionElement[]) => (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)({ caseId: c.id, composition })) as { axes?: Record<string, number> };

    const houseResult = await scoreOf(houseStyle);
    const faithfulResult = await scoreOf(faithful);
    const rangeErrors = [...scoreRangeErrors(houseResult), ...scoreRangeErrors(faithfulResult)];
    if (rangeErrors.length > 0) return { ok: false, evidence: rangeErrors.join('\n') };

    const dccBelow = houseResult.axes!['directive_claim_coverage']! < f['directive_claim_coverage']!;
    const othersAboveFloor = houseResult.axes!['layout_geometry']! >= f['layout_geometry']! && houseResult.axes!['palette_fidelity']! >= f['palette_fidelity']! && houseResult.axes!['type_fidelity']! >= f['type_fidelity']!;
    const faithfulAbove = faithfulResult.axes!['directive_claim_coverage']! >= f['directive_claim_coverage']!;
    const verifierOk = dccBelow && othersAboveFloor && faithfulAbove;

    // Additional, non-load-bearing: implementer fixtures.
    const scoreGroup = async (subdir: string, seenHashes: Map<string, string>): Promise<{ count: number; lines: string[] }> => {
      const dir = abs(path.join(DIRECTIVE_FIXTURES_DIR, subdir));
      const lines: string[] = [];
      if (!fs.existsSync(dir)) {
        lines.push(`${subdir}: no implementer fixtures present (not required)`);
        return { count: 0, lines };
      }
      let count = 0;
      for (const entry of fs.readdirSync(dir)) {
        const relDir = path.join(DIRECTIVE_FIXTURES_DIR, subdir, entry);
        const loaded = loadBlindedFixture(relDir, manifest);
        if (!loaded.ok) {
          lines.push(`${relDir}: ${loaded.error}`);
          continue;
        }
        const dup = seenHashes.get(loaded.blindHash);
        if (dup) {
          lines.push(`${relDir}: blinded content identical to ${dup}`);
          continue;
        }
        seenHashes.set(loaded.blindHash, relDir);
        // eslint-disable-next-line no-await-in-loop
        const result = await scoreOf(loaded.input.composition);
        const re = scoreRangeErrors(result);
        lines.push(`${relDir}: dcc=${re.length === 0 ? result.axes!['directive_claim_coverage'] : `INVALID (${re.join('; ')})`}`);
        count++;
      }
      return { count, lines };
    };
    const seen = new Map<string, string>();
    const houseFixtures = await scoreGroup('house-style', seen);
    const faithfulFixtures = await scoreGroup('faithful', seen);

    const ok = verifierOk;
    const evidence = [
      `case=${c.id}`,
      `resolution setup: faithfulResolved=${faithfulResolved}/${faithful.length} houseStyleResolved=${houseStyleResolved}/${houseStyle.length} citedElementsExist=${citedElementsExist}`,
      `house-style axes=${JSON.stringify(houseResult.axes)} dccBelow=${dccBelow} othersAboveFloor=${othersAboveFloor}`,
      `faithful axes=${JSON.stringify(faithfulResult.axes)} faithfulAbove=${faithfulAbove}`,
      `implementer fixtures (additional, non-load-bearing): house-style=${houseFixtures.count} faithful=${faithfulFixtures.count}`,
      ...houseFixtures.lines,
      ...faithfulFixtures.lines,
    ].join('\n');
    return { ok, evidence, detail: ok ? undefined : `dccBelow=${dccBelow} othersAboveFloor=${othersAboveFloor} faithfulAbove=${faithfulAbove}` };
  }),
);

// =============================================================================
// C7-10 -- counterfactual separation, indexed by the CORRECT registered
// scorer axis id (F10: round-1 indexed axes[] with the directive-axis
// vocabulary, e.g. axes['layout'], which is never a key the scorer
// populates -- always undefined, so the check silently never worked).
// The mapping is validated against floors.json's own keys so a future
// name drift fails loudly instead of reading undefined again.
// =============================================================================
await probe(
  'C7-10',
  `validate DIRECTIVE_AXIS_TO_SCORER_AXIS's values all appear in ${FLOORS_PATH}'s floors keys (fail loudly on drift); require counterfactualMinDelta >= ${MIN_MEANINGFUL_THRESHOLD} (named epsilon, F12); for >=3 corpus cases build a verifier base/swapped pair differing in EXACTLY one composition element (mechanically diff-checked) and assert the CORRECTLY-MAPPED scorer axis moves by more than the delta; also score implementer fixtures as an additional, non-load-bearing check`,
  `every value in the directive-axis-to-scorer-axis map (layout->layout_geometry, motion->motion_timing, palette->palette_fidelity, typography->type_fidelity, section->section_identity, interaction->responsiveness) is a real key in ${FLOORS_PATH}.floors; ${FLOORS_PATH}.counterfactualMinDelta is a finite number >= ${MIN_MEANINGFUL_THRESHOLD} (not merely > 0); for >=3 eligible corpus cases, a verifier-built pair whose composition arrays differ in EXACTLY 1 of N elements (mechanically diff-counted) produces |scoreComposition(base).axes[mappedAxis] - scoreComposition(swapped).axes[mappedAxis]| > counterfactualMinDelta; implementer-provided ${COUNTERFACTUAL_DIR} fixtures (if present) are scored as an additional, non-load-bearing signal`,
  async () => {
    const floorsDoc = readJson<{ floors?: Record<string, number>; counterfactualMinDelta?: number }>(FLOORS_PATH);
    if (floorsDoc === null || !floorsDoc.floors) return { ok: false, evidence: `missing or invalid ${FLOORS_PATH}` };
    const floorsKeys = new Set(Object.keys(floorsDoc.floors));
    const mappingProblems = Object.entries(DIRECTIVE_AXIS_TO_SCORER_AXIS).filter(([, scorerAxis]) => !floorsKeys.has(scorerAxis));
    if (mappingProblems.length > 0) {
      return { ok: false, evidence: `DIRECTIVE_AXIS_TO_SCORER_AXIS references scorer axis ids not present in ${FLOORS_PATH}.floors (name drift): ${JSON.stringify(mappingProblems)}` };
    }
    if (typeof floorsDoc.counterfactualMinDelta !== 'number' || !Number.isFinite(floorsDoc.counterfactualMinDelta) || floorsDoc.counterfactualMinDelta < MIN_MEANINGFUL_THRESHOLD) {
      return { ok: false, evidence: `${FLOORS_PATH}.counterfactualMinDelta must be a finite number >= ${MIN_MEANINGFUL_THRESHOLD}, got ${floorsDoc.counterfactualMinDelta}` };
    }
    const minDelta = floorsDoc.counterfactualMinDelta;

    const imported = await importEvalModule(SCORER_INDEX_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const scoreComposition = imported.mod['scoreComposition'];
    if (typeof scoreComposition !== 'function') return { ok: false, evidence: `${SCORER_INDEX_PATH} does not export scoreComposition` };

    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot run: ${error}` };
    const eligibleCases = manifest.cases.filter((c) => !c.sealed && !c.skip && c.sources.length >= 2 && c.directiveInventory.length >= 1 && faithfulComposition(c) !== null);
    if (eligibleCases.length < 3) return { ok: false, evidence: `only ${eligibleCases.length} eligible corpus cases, need >=3` };

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
      const scorerAxis = DIRECTIVE_AXIS_TO_SCORER_AXIS[pair.axis as DirectiveAxis];
      // eslint-disable-next-line no-await-in-loop
      const baseResult = (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)({ caseId: c.id, composition: pair.base })) as { axes?: Record<string, number> };
      // eslint-disable-next-line no-await-in-loop
      const swappedResult = (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)({ caseId: c.id, composition: pair.swapped })) as { axes?: Record<string, number> };
      const rangeErrors = [...scoreRangeErrors(baseResult), ...scoreRangeErrors(swappedResult)];
      if (rangeErrors.length > 0) {
        verifierFailures++;
        lines.push(`${c.id}: ${rangeErrors.join('; ')}`);
        continue;
      }
      const baseScore = baseResult.axes![scorerAxis]!;
      const swappedScore = swappedResult.axes![scorerAxis]!;
      const delta = Math.abs(baseScore - swappedScore);
      const ok = delta > minDelta;
      if (!ok) verifierFailures++;
      lines.push(`${c.id}: directiveAxis=${pair.axis} -> scorerAxis=${scorerAxis} diffCount=${pair.diffCount} base=${baseScore.toFixed(3)} swapped=${swappedScore.toFixed(3)} delta=${delta.toFixed(3)} (min ${minDelta}) -- ${ok ? 'OK' : 'FAIL'}`);
    }
    if (verifierAttempts < 3) verifierFailures++;

    // Additional, non-load-bearing: implementer fixtures.
    const fixtureLines: string[] = [];
    const dir = abs(COUNTERFACTUAL_DIR);
    const pairIds = fs.existsSync(dir) ? fs.readdirSync(dir).filter((e) => fs.statSync(path.join(dir, e)).isDirectory()) : [];
    if (pairIds.length === 0) {
      fixtureLines.push('no implementer counterfactual fixtures present (not required)');
    }
    for (const pairId of pairIds) {
      const meta = readJson<{ swappedAxis?: string }>(path.join(COUNTERFACTUAL_DIR, pairId, 'meta.json'));
      const axis = meta?.swappedAxis;
      const scorerAxis = axis && DIRECTIVE_AXES.includes(axis as DirectiveAxis) ? DIRECTIVE_AXIS_TO_SCORER_AXIS[axis as DirectiveAxis] : axis;
      const baseLoaded = loadBlindedFixture(path.join(COUNTERFACTUAL_DIR, pairId, 'base'), manifest);
      const swappedLoaded = loadBlindedFixture(path.join(COUNTERFACTUAL_DIR, pairId, 'swapped'), manifest);
      if (!scorerAxis || !baseLoaded.ok || !swappedLoaded.ok) {
        fixtureLines.push(`${pairId}: incomplete (axis=${axis}, base=${baseLoaded.ok}, swapped=${swappedLoaded.ok})`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const baseResult = (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(baseLoaded.input)) as { axes?: Record<string, number> };
      // eslint-disable-next-line no-await-in-loop
      const swappedResult = (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(swappedLoaded.input)) as { axes?: Record<string, number> };
      const baseScore = baseResult.axes?.[scorerAxis];
      const swappedScore = swappedResult.axes?.[scorerAxis];
      if (typeof baseScore !== 'number' || typeof swappedScore !== 'number' || Math.abs(baseScore - swappedScore) <= minDelta) {
        fixtureLines.push(`${pairId}: axis=${axis}->${scorerAxis} base=${baseScore} swapped=${swappedScore} did not separate beyond minDelta`);
      } else {
        fixtureLines.push(`${pairId}: axis=${axis}->${scorerAxis} base=${baseScore.toFixed(3)} swapped=${swappedScore.toFixed(3)} -- OK`);
      }
    }

    const ok = verifierFailures === 0;
    const evidence = [`verifier-constructed pairs (${verifierAttempts} attempted):`, ...lines, `implementer fixtures (additional, non-load-bearing, ${pairIds.length} pairs):`, ...fixtureLines].join('\n');
    return { ok, evidence, detail: ok ? undefined : `verifierFailures=${verifierFailures}` };
  },
);

// =============================================================================
// C7-11 -- held-out split is REALLY sealed. F3: ciphertext is content-bound
// to the seal commit's parent blob (a swap-in-the-seal-commit no longer
// passes). F11: the leak scan samples multiple content windows from each
// sealed plaintext rather than trusting whole-file hashes (catches
// embedding inside a larger file, or a single altered framing byte); the
// seal key's 0600 permission is verified every run; the manifest records
// an HONEST boundary statement (R7) -- mechanical checks cover in-repo
// leakage and key perms, while same-user out-of-repo access to the key or
// proof directory is an orchestration invariant, not something file
// permissions can enforce, and is declared as such rather than disguised.
// F18 (round 6, confirmed real): both the IR check and the per-source
// per-breakpoint snapshot check below now call sealedPayloadPrecedesSeal
// (the FULL check: content-binding + defining-commit-precedes-seal + empty
// post-seal touch history) instead of the weaker contentBoundBeforeSeal --
// the reviewer's repro left a sealed IR untouched but tampered and then
// reverted a sealed SNAPSHOT after the seal, which passed under content-
// binding alone since HEAD's bytes end up identical to the pre-seal blob.
// =============================================================================
const SEAL_ACCESS_BOUNDARY = {
  mechanicallyVerified: [
    'sealed .enc ciphertext is content-bound to the git blob at the seal commit\'s parent (F3)',
    'decrypting every sealed .enc blob and re-hashing yields exactly the manifest\'s recorded plaintext hash',
    'no git-tracked file under evals/ contains a CONTIGUOUS content window (raw, base64, or hex) sampled from any sealed plaintext (F11)',
    `seal.key file mode is exactly 0600 (verified every run, not just set-on-create)`,
  ],
  orchestrationInvariant:
    'Same-user, out-of-repo access to seal.key or the proof directory (~/.claude/goal-state/mishmash-w7-selector-foundations/) cannot be prevented by file permissions alone -- any process running as this OS user can read those paths. The held-out guarantee therefore also depends on an ORCHESTRATION invariant outside this verifier\'s mechanical reach: the orchestrator must never expose goal-state paths (or the seal key material) to a W8 implementing agent\'s context or sandbox. This is declared here per R7 (human/process assumptions must be declared, not disguised as mechanical guarantees) -- it is NOT mechanically checked by this criterion.',
  // F11 (round 5, deliberate-evasion static-analysis arms race): round 4's
  // preflight review showed that ANY contiguous-needle scan is defeatable
  // by fragmenting the encoded plaintext (e.g. concatenated 8-character
  // string literals that reconstruct exactly but match no single
  // contiguous needle). Chasing this mechanically is an unwinnable arms
  // race against an adversarial author -- per the gate-scope ruling this is
  // declared as an R7 boundary rather than attempted again: the mechanical
  // scan's REAL coverage is contiguous plaintext/base64/hex leakage; a
  // DELIBERATE fragmentation evasion is outside static reach and is
  // governed by (i) the orchestration invariant above (implementation
  // agents never receive goal-state paths, so they never have the sealed
  // plaintext to fragment and leak in the first place) and (ii) the
  // mandatory adversarial deliverable reviews, whose charters (the
  // commit-bound disposition records under DISPOSITIONS_DIR) explicitly
  // include checking for exactly this evasion.
  deliberateEvasionBoundary:
    'F11: the leak scan mechanically covers CONTIGUOUS plaintext/base64/hex leakage only. Deliberate fragmentation (e.g. concatenated short string-literal chunks that reconstruct the sealed plaintext without ever appearing as one contiguous needle) is a static-analysis arms race this verifier does not attempt to win mechanically. Coverage of that residual instead comes from (i) the orchestration invariant above -- an implementation agent that never receives goal-state paths never has the sealed plaintext to fragment and leak -- and (ii) the mandatory adversarial deliverable reviews, whose charters explicitly include checking for this evasion. Declared per R7, not disguised as mechanical.',
};

await probe(
  'C7-11',
  `read ${SEALED_ACCESS_PATH}; decrypt every sealed case's IR + snapshot blobs and hash-check against the manifest's recorded plaintext hashes; apply the FULL sealedPayloadPrecedesSeal check (content-bound to the seal commit's parent blob + defining commit precedes the seal + EMPTY post-seal touch history) to every sealed .enc path -- IR AND every snapshot; scan every git-tracked file under evals/ for content-window leakage of any sealed plaintext; verify seal.key is mode 0600`,
  `${SEALED_ACCESS_PATH} names every sealed case id, records its plaintext irSha256, and states an access-control statement; manifest.sealedFraction matches the actual sealed fraction within 0.02; every sealed path ends in ".enc"; decrypting + re-hashing yields exactly the manifest's recorded plaintext hash; EVERY sealed .enc path -- the case's irPath AND every one of its sources' per-breakpoint snapshot paths, not just the IR -- passes the FULL sealedPayloadPrecedesSeal check: current ciphertext equals sha256(git show <sealCommit>^:<path>) (F3), the defining commit precedes (is an ancestor of) the seal commit, AND git log <sealCommit>..HEAD -- <path> is EMPTY (F18, round 6: closes the gap where a sealed SNAPSHOT tampered post-seal and then reverted to its pre-seal bytes passed under content-binding alone); a content-window scan (5 x 64-byte windows per sealed plaintext, plus base64/hex encodings of each window and a base64-full-payload prefix, F11) finds NO match in any git-tracked evals/ file other than the .enc blobs themselves; ${SEAL_KEY_PATH} is mode 0600; the manifest records the explicit orchestration-invariant boundary statement above (R7) alongside the mechanical results; R7 BOUNDARY (F11, round 5 -- declared, not mechanically closed): ${SEAL_ACCESS_BOUNDARY.deliberateEvasionBoundary}`,
  async () => {
    const text = readText(SEALED_ACCESS_PATH);
    if (text === null) return { ok: false, evidence: `missing ${SEALED_ACCESS_PATH}` };
    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot cross-check: ${error}` };
    const sealedCases = manifest.cases.filter((c) => c.sealed);
    if (sealedCases.length === 0) return { ok: false, evidence: 'manifest has zero sealed cases' };

    const sealCommit = latestCommitTouching(SEALED_ACCESS_PATH);
    if (!sealCommit) return { ok: false, evidence: `could not resolve a git commit for ${SEALED_ACCESS_PATH}` };

    const actualFraction = sealedCases.length / manifest.cases.length;
    const fractionOk = Math.abs(actualFraction - manifest.sealedFraction) <= 0.02;
    const missingFromDoc = sealedCases.filter((c) => !text.includes(c.id));
    const hasAccessStatement = /must not|forbidden|access.?control|not readable|no access/i.test(text);

    const plaintextBuffers: { label: string; bytes: Buffer }[] = [];
    const lines: string[] = [];
    let decryptFailures = 0;
    let contentBindingFailures = 0;
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
            plaintextBuffers.push({ label: `${c.id}/ir`, bytes: decrypted.bytes });
          }
        }
        // F18 (round 6): every sealed payload path -- IR here, snapshots
        // below -- must get the FULL sealedPayloadPrecedesSeal check
        // (content-binding + defining-commit-precedes-seal + EMPTY
        // post-seal touch history), not the weaker content-binding-only
        // contentBoundBeforeSeal. Content-binding alone cannot detect a
        // post-seal tamper-then-revert (HEAD ends up byte-identical to the
        // pre-seal blob again while two commits touched the path after the
        // seal).
        const binding = sealedPayloadPrecedesSeal(sealCommit, c.irPath);
        if (!binding.ok) {
          contentBindingFailures++;
          lines.push(`${c.id}/ir: ${binding.detail}`);
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
          } else {
            const actualHash = sha256Buffer(decrypted.bytes);
            if (actualHash !== ref.sha256) {
              decryptFailures++;
              lines.push(`${label}: decrypted snapshot hash mismatch (manifest=${ref.sha256} actual=${actualHash})`);
            } else {
              plaintextBuffers.push({ label, bytes: decrypted.bytes });
            }
          }
          // F18 (round 6, confirmed real): this was the actual gap --
          // sealed SNAPSHOTS only ever got contentBoundBeforeSeal (content
          // equality alone), so a snapshot tampered post-seal and then
          // reverted to its sealCommit^ bytes passed unconditionally.
          // sealedPayloadPrecedesSeal additionally requires zero commits
          // strictly after the seal to touch this exact snapshot path.
          const binding = sealedPayloadPrecedesSeal(sealCommit, ref.path);
          if (!binding.ok) {
            contentBindingFailures++;
            lines.push(`${label}: ${binding.detail}`);
          }
        }
      }
    }

    // F11 (round 3): the leak scan must also catch ENCODED forms of a
    // sealed plaintext -- round-2's raw-byte-window scan missed "commit the
    // sealed plaintext base64-encoded under evals" (the exact round-3
    // repro), since a base64/hex re-encoding of the same bytes shares no
    // raw byte substring with the original. For every sampled raw window we
    // also derive its base64 and hex text forms, plus a base64 prefix of
    // the FULL plaintext (catching a whole-payload embed), and search
    // tracked file TEXT for those forms case-insensitively.
    const tracked = sh('git', ['ls-files', 'evals']);
    const trackedFiles = tracked.status === 0 ? tracked.stdout.split('\n').filter(Boolean) : [];
    const leaks: string[] = [];
    if (tracked.status !== 0) {
      leaks.push(`could not run git ls-files evals to scan for leaks (status=${tracked.status})`);
    } else {
      const rawWindows: { source: string; window: Buffer }[] = [];
      const encodedNeedles: { source: string; form: string; needle: string }[] = [];
      for (const { label, bytes } of plaintextBuffers) {
        for (const w of sampleWindows(bytes)) {
          rawWindows.push({ source: label, window: w });
          if (w.length > 0) {
            encodedNeedles.push({ source: label, form: 'base64-window', needle: w.toString('base64') });
            encodedNeedles.push({ source: label, form: 'hex-window', needle: w.toString('hex') });
          }
        }
        const fullBase64 = bytes.toString('base64');
        if (fullBase64.length > 0) {
          encodedNeedles.push({ source: label, form: 'base64-full-payload-prefix', needle: fullBase64.slice(0, Math.min(64, fullBase64.length)) });
        }
      }
      for (const rel of trackedFiles) {
        if (rel.endsWith('.enc')) continue;
        let fileBytes: Buffer;
        try {
          fileBytes = fs.readFileSync(abs(rel));
        } catch {
          continue;
        }
        for (const { source, window } of rawWindows) {
          if (window.length > 0 && fileBytes.includes(window)) leaks.push(`${rel} contains a RAW content window sampled from sealed plaintext ${source}`);
        }
        const fileTextLower = fileBytes.toString('utf8').toLowerCase();
        for (const { source, form, needle } of encodedNeedles) {
          if (needle.length > 0 && fileTextLower.includes(needle.toLowerCase())) leaks.push(`${rel} contains a ${form} encoding of sealed plaintext ${source} (case-insensitive match)`);
        }
      }
    }

    const keyMode = sealKeyModeOk();

    const evidence = [
      `sealedFraction manifest=${manifest.sealedFraction} actual=${actualFraction.toFixed(3)} ok=${fractionOk}`,
      `sealed cases named in ${SEALED_ACCESS_PATH}: ${sealedCases.length - missingFromDoc.length}/${sealedCases.length}`,
      `access-control statement present: ${hasAccessStatement}`,
      `decrypt+hash checks: ${decryptFailures === 0 ? 'all OK' : `${decryptFailures} failures`}`,
      `F3 content-binding (ciphertext === blob at ${sealCommit}^): ${contentBindingFailures === 0 ? 'all OK' : `${contentBindingFailures} failures`}`,
      `F11 leak scan (raw windows + base64/hex-window encodings + base64-full-payload-prefix, case-insensitive) over ${trackedFiles.length} tracked evals/ files, ${plaintextBuffers.length} sealed plaintexts sampled: ${leaks.length === 0 ? 'clean' : leaks.join('; ')}`,
      `seal.key mode: ${keyMode.mode} (want 0600): ${keyMode.ok ? 'OK' : 'FAIL'}`,
      `honest boundary (R7, not mechanically enforced): ${SEAL_ACCESS_BOUNDARY.orchestrationInvariant}`,
      ...lines,
    ].join('\n');
    const ok = fractionOk && missingFromDoc.length === 0 && hasAccessStatement && decryptFailures === 0 && contentBindingFailures === 0 && leaks.length === 0 && keyMode.ok;
    return { ok, evidence, detail: ok ? undefined : 'seal record incomplete, decrypt/hash/content-binding mismatch, leak detected, or key mode wrong' };
  },
);

// =============================================================================
// C7-12 -- absolute floors frozen and non-vacuous. F12: a floor must be
// >= a NAMED epsilon (0.05), not merely "> 0" (a denormalized 5e-324
// satisfies ">0" but is functionally zero).
// =============================================================================
await probe(
  'C7-12',
  `read ${FLOORS_PATH}; assert version + all 11 axis floors present, finite, and >= the named epsilon ${MIN_MEANINGFUL_THRESHOLD}; assert counterfactualMinDelta >= ${MIN_MEANINGFUL_THRESHOLD}; record its sha256`,
  `${FLOORS_PATH} has a numeric "version", a "floors" object with a FINITE numeric entry >= ${MIN_MEANINGFUL_THRESHOLD} (named epsilon, and <= 1) for every axis in [${REQUIRED_AXES.join(', ')}] -- a floor of 0, or a denormalized near-zero positive number, is vacuous and fails -- and a finite numeric "counterfactualMinDelta" >= ${MIN_MEANINGFUL_THRESHOLD}; its sha256 is recorded so a later silent edit is detectable by hash drift`,
  async () => {
    const raw = readText(FLOORS_PATH);
    if (raw === null) return { ok: false, evidence: `missing ${FLOORS_PATH}` };
    const parsed = readJson<{ version?: number; floors?: Record<string, number>; counterfactualMinDelta?: number }>(FLOORS_PATH);
    if (parsed === null) return { ok: false, evidence: `${FLOORS_PATH} is not valid JSON` };
    if (typeof parsed.version !== 'number') return { ok: false, evidence: `${FLOORS_PATH} missing numeric "version"` };
    if (!parsed.floors) return { ok: false, evidence: `${FLOORS_PATH} missing "floors" object` };
    const bad = REQUIRED_AXES.filter((a) => {
      const v = parsed.floors?.[a];
      return typeof v !== 'number' || !Number.isFinite(v) || v < MIN_MEANINGFUL_THRESHOLD || v > 1;
    });
    const deltaOk = typeof parsed.counterfactualMinDelta === 'number' && Number.isFinite(parsed.counterfactualMinDelta) && parsed.counterfactualMinDelta >= MIN_MEANINGFUL_THRESHOLD;
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const ok = bad.length === 0 && deltaOk;
    return {
      ok,
      evidence: `version=${parsed.version}\nfloors=${JSON.stringify(parsed.floors, null, 2)}\ncounterfactualMinDelta=${parsed.counterfactualMinDelta}\nepsilon=${MIN_MEANINGFUL_THRESHOLD}\nsha256=${hash}`,
      detail: ok ? undefined : `axes below epsilon/out-of-range/non-finite: ${bad.join(', ')}${deltaOk ? '' : '; counterfactualMinDelta must be finite and >= epsilon'}`,
    };
  },
);

// F13 (round 3): a two-process check on ONE machine cannot prove
// cross-machine determinism -- both the parent and the subprocess still
// share the real os.hostname()/os.networkInterfaces() of this single host,
// only the env VARS were overridden. The claim is narrowed to what is
// actually mechanically provable: (a) determinism under an env override
// (kept, unchanged), (b) a recorded machine fingerprint of the host this
// run executed on (so a human comparing two runs' manifests can SEE
// whether they ran on different machines -- this verifier cannot force
// that to happen), and (c) a static, mechanical gate that the scorer
// source contains no direct machine-identity reads that env overrides
// cannot reach (os.hostname(), os.networkInterfaces(), raw process.env.*
// outside an explicit allowlist). (b)+(c) are structural; they do not
// themselves prove cross-machine determinism, which remains a residual,
// human-verifiable boundary stated in the assertion string below.
const MACHINE_IDENTITY_ENV_ALLOWLIST: readonly string[] = [];
function scanScorerForMachineIdentityRefs(): { ok: boolean; violations: string[]; filesScanned: number } {
  const violations: string[] = [];
  const scorerFiles = exists(SCORER_DIR) ? listFilesRecursive(abs(SCORER_DIR)).filter((f) => f.endsWith('.ts')) : [];
  for (const file of scorerFiles) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      violations.push(`${rel}: could not be read for the machine-identity static scan`);
      continue;
    }
    if (/\bos\s*\.\s*hostname\s*\(/.test(text)) violations.push(`${rel}: references os.hostname()`);
    if (/\bos\s*\.\s*networkInterfaces\s*\(/.test(text)) violations.push(`${rel}: references os.networkInterfaces()`);
    const envRefs = [...text.matchAll(/\bprocess\s*\.\s*env\s*(?:\.\s*([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g)];
    for (const m of envRefs) {
      const key = m[1] ?? m[2] ?? '';
      if (!MACHINE_IDENTITY_ENV_ALLOWLIST.includes(key)) violations.push(`${rel}: references process.env.${key || '(dynamic key)'} which is not in the allowlist (${JSON.stringify(MACHINE_IDENTITY_ENV_ALLOWLIST)})`);
    }
  }
  return { ok: violations.length === 0, violations, filesScanned: scorerFiles.length };
}

// F13 (round 5, deliberate-evasion static-analysis arms race): round 4's
// preflight review showed the identifier-name regex scan is bypassed by
// `import { hostname as machineId } from "node:os"` or `os["hostname"]()`
// -- an alias, a computed property access, or a machine-identity read
// relocated to an imported module outside scorer/ all observe the same
// real hostname while the static regex reports clean. As with F11, this is
// declared as an R7 boundary rather than chased further: the mechanical
// scan's REAL coverage is direct, syntactically literal identifier reads
// (os.hostname(), os.networkInterfaces(), process.env.<literal-key>) in
// scorer/ itself. A DELIBERATE evasion (aliasing, computed access, an
// indirection through another module) is outside static reach and is
// governed by the same two controls as F11: (i) the orchestration
// invariant (an implementation agent never receives goal-state paths, so
// it has no sealed cross-machine ground truth to game in the first place)
// and (ii) the mandatory adversarial deliverable reviews, whose charters
// explicitly include checking for exactly this evasion.
const MACHINE_IDENTITY_BOUNDARY = {
  mechanicallyVerified: [
    'scoreComposition is byte-identical across two in-process calls and one freshly-spawned subprocess with HOSTNAME/TZ/LANG genuinely overridden (verified actually passed, not inherited)',
    'no .ts file under evals/selector/scorer/ contains a DIRECT, syntactically literal reference to os.hostname(), os.networkInterfaces(), or process.env.<literal-key> outside the allowlist',
    "this run's machine fingerprint (hostname/platform/arch/node version) is recorded in the proof manifest",
  ],
  deliberateEvasionBoundary:
    'F13: the static scan mechanically covers only DIRECT, syntactically literal machine-identity reads inside evals/selector/scorer/ itself. Deliberate evasion -- import aliasing (`import { hostname as x }`), computed property access (`os["hostname"]`), or relocating the read to an imported module outside scorer/ -- is a static-analysis arms race this verifier does not attempt to win mechanically. Coverage of that residual instead comes from (i) the orchestration invariant (an implementation agent never receives goal-state paths, so it has no sealed cross-machine ground truth to exploit) and (ii) the mandatory adversarial deliverable reviews, whose charters explicitly include checking for this evasion. Declared per R7, not disguised as mechanical.',
};

// =============================================================================
// C7-13 -- scorer versioned (real semver), pinned in a dedicated
// eval-manifest.json cross-checked against floors/corpus versions, and
// deterministic across the SAME process AND a freshly-spawned subprocess
// that ACTUALLY receives altered HOSTNAME/TZ/LANG env (F13: round 1's sh()
// had no env parameter, so the subprocess silently inherited unchanged env
// and the cross-machine check never exercised anything). F13 (round 3):
// narrowed further -- see the comment above scanScorerForMachineIdentityRefs.
// F13 (round 5): the static scan's own coverage limits are now declared as
// an R7 boundary -- see MACHINE_IDENTITY_BOUNDARY above.
// =============================================================================
await probe(
  'C7-13',
  `dynamic-import ${SCORER_INDEX_PATH}; require SCORER_VERSION matches semver; cross-check ${EVAL_MANIFEST_PATH} pins the same scorer/floors/corpus versions; call scoreComposition twice in-process AND once more in a freshly-spawned node subprocess ACTUALLY started with HOSTNAME/TZ/LANG overridden via sh()'s env parameter; require all three results are byte-identical; statically scan every .ts file under ${SCORER_DIR} for os.hostname()/os.networkInterfaces()/process.env.* references outside an explicit allowlist; record this run's machine fingerprint (hostname/platform/arch/node version) in the proof manifest`,
  `${SCORER_INDEX_PATH} exports SCORER_VERSION matching /^\\d+\\.\\d+\\.\\d+$/; ${EVAL_MANIFEST_PATH} has {scorerVersion, floorsVersion, corpusVersion} matching the live SCORER_VERSION, ${FLOORS_PATH}.version, and ${MANIFEST_PATH}.version; scoreComposition(${DETERMINISM_FIXTURE_PATH}) called twice in this process AND once in a child process spawned with env={HOSTNAME:'verifier-control-host',TZ:'UTC',LANG:'C'} (verified actually passed, not inherited) yields stable-stringify-identical results across all three; no .ts file under ${SCORER_DIR} references os.hostname(), os.networkInterfaces(), or process.env.<key> for a key outside the (currently empty) allowlist -- RESIDUAL BOUNDARY (not mechanically provable by this verifier, R7): the env-override check and the static scan together rule out the mechanisms this verifier can reach, but true execution on a physically distinct second machine is not exercised here; the recorded machine fingerprint lets a human compare two independent runs' manifests to check that boundary; R7 BOUNDARY (F13, round 5 -- declared, not mechanically closed): ${MACHINE_IDENTITY_BOUNDARY.deliberateEvasionBoundary}`,
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

    // F13: build a tiny runner script and spawn it with an ACTUALLY-altered
    // environment via sh()'s env parameter -- a scorer reading
    // process.env.TZ/HOSTNAME/LANG, os.hostname(), or locale-sensitive
    // Date formatting will now genuinely diverge here.
    const controlEnv = { HOSTNAME: 'verifier-control-host', TZ: 'UTC', LANG: 'C' };
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
        `fs.writeFileSync(${JSON.stringify(outPath)}, JSON.stringify({ result, env: { HOSTNAME: process.env.HOSTNAME, TZ: process.env.TZ, LANG: process.env.LANG } }));`,
      ].join('\n'),
    );
    const subprocess = sh('node', ['--import', 'tsx', runnerPath], repoRoot, controlEnv);
    let subprocessEqual = false;
    let envActuallyChanged = false;
    let subprocessDetail = `subprocess exit=${subprocess.status}`;
    if (subprocess.status === 0 && fs.existsSync(outPath)) {
      try {
        const parsedOut = JSON.parse(fs.readFileSync(outPath, 'utf8')) as { result: unknown; env: Record<string, string | undefined> };
        subprocessEqual = stableStringify(parsedOut.result) === stableStringify(run1);
        envActuallyChanged = parsedOut.env.HOSTNAME === controlEnv.HOSTNAME && parsedOut.env.TZ === controlEnv.TZ && parsedOut.env.LANG === controlEnv.LANG;
        subprocessDetail += ` result=${stableStringify(parsedOut.result)} observedEnv=${JSON.stringify(parsedOut.env)} envActuallyChanged=${envActuallyChanged}`;
      } catch (e) {
        subprocessDetail += ` (failed to read/parse subprocess result: ${(e as Error).message})`;
      }
    } else {
      subprocessDetail += ` stderr=${subprocess.stderr}`;
    }

    // The env-override plumbing itself must have worked, or this whole
    // check proves nothing (exactly the F13 bug).
    const machineScan = scanScorerForMachineIdentityRefs();
    const machineFingerprint = { hostname: os.hostname(), platform: os.platform(), arch: os.arch(), nodeVersion: process.version };

    // ok is written this way so a coincidental empty scorer/ directory
    // (filesScanned===0) is NOT treated as a pass-by-vacuity for the static
    // gate -- the scorer must exist (index.ts already required above) and
    // be scanned.
    const ok = inProcessEqual && subprocessEqual && envActuallyChanged && machineScan.ok && machineScan.filesScanned > 0;
    return {
      ok,
      evidence: `SCORER_VERSION=${version}\nrun1=${stableStringify(run1)}\nrun2=${stableStringify(run2)}\ninProcessEqual=${inProcessEqual}\n${subprocessDetail}\nsubprocessEqual=${subprocessEqual}\nmachine-identity static scan: ${machineScan.filesScanned} file(s) under ${SCORER_DIR} scanned, ${machineScan.violations.length === 0 ? 'clean' : machineScan.violations.join('; ')}\nmachine fingerprint of this run (recorded in the proof manifest; residual cross-machine boundary is human-verifiable, not mechanically enforced -- see assertion): ${JSON.stringify(machineFingerprint)}`,
      detail: ok
        ? undefined
        : `inProcessEqual=${inProcessEqual} subprocessEqual=${subprocessEqual} envActuallyChanged=${envActuallyChanged} machineScanOk=${machineScan.ok} filesScanned=${machineScan.filesScanned}${machineScan.violations.length > 0 ? ` violations=${JSON.stringify(machineScan.violations)}` : ''}`,
    };
  },
);

// F14 (round 5): Parameters<>/ReturnType<> only ever see the LAST declared
// overload signature of a function -- `function parse(input:any):any;
// function parse(input:string):CompositionIR; function parse(input:any):any
// { throw ... }` types as the well-behaved last signature under
// Parameters<>/ReturnType<> even though the actual runtime export is the
// any/any implementation, so round 3's conditional-type probe never sees
// the problem. This can only be closed by inspecting the SOURCE STRUCTURE
// (the compiler API's AST), not by asking TypeScript to resolve a type: we
// require exactly one top-level declaration of "parse" (rejecting the
// overload shape outright, regardless of what any individual signature
// says) with explicit, non-"any" parameter and return type annotations.
function collectAnyKeywordNodes(ts: typeof import('typescript'), node: import('typescript').Node): import('typescript').Node[] {
  const found: import('typescript').Node[] = [];
  const visit = (n: import('typescript').Node): void => {
    if (n.kind === ts.SyntaxKind.AnyKeyword) found.push(n);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function checkParseSignatureAst(ts: typeof import('typescript'), parserSourceText: string, parserPath: string): { ok: boolean; detail: string } {
  const sourceFile = ts.createSourceFile(parserPath, parserSourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const parseFunctionDecls: import('typescript').FunctionDeclaration[] = [];
  const parseVarDecls: import('typescript').VariableDeclaration[] = [];
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === 'parse') {
      parseFunctionDecls.push(stmt);
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === 'parse') parseVarDecls.push(decl);
      }
    }
  }
  const totalDecls = parseFunctionDecls.length + parseVarDecls.length;
  if (totalDecls === 0) {
    return { ok: false, detail: `no top-level "function parse(...)" or "const parse = ..." declaration found in ${parserPath} for the AST probe (an indirect export -- re-export, destructuring, computed property -- cannot be followed by this static check)` };
  }
  if (totalDecls > 1) {
    return {
      ok: false,
      detail: `${totalDecls} top-level declarations of "parse" found in ${parserPath} (${parseFunctionDecls.length} function declaration(s), ${parseVarDecls.length} const declaration(s)) -- overload signatures are rejected outright regardless of what any individual signature declares; exactly one call signature is required`,
    };
  }

  let paramTypeNodes: (import('typescript').TypeNode | undefined)[] = [];
  let returnTypeNode: import('typescript').TypeNode | undefined;
  const missingAnnotations: string[] = [];
  let signatureSource = 'function declaration';

  if (parseFunctionDecls.length === 1) {
    const fn = parseFunctionDecls[0]!;
    if (!fn.body) return { ok: false, detail: `"parse" function declaration in ${parserPath} has no body (a bodyless overload signature) -- exactly one call signature WITH an implementation is required` };
    paramTypeNodes = fn.parameters.map((p) => p.type);
    returnTypeNode = fn.type;
    if (!returnTypeNode) missingAnnotations.push('return type');
    fn.parameters.forEach((p, i) => {
      if (!p.type) missingAnnotations.push(`parameter ${i} (${p.name.getText(sourceFile)})`);
    });
  } else {
    const decl = parseVarDecls[0]!;

    // F14 (round 6): reject an `as`-cast on the initializer outright -- a
    // cast (`(impl) as SomeWiderType`, `impl as any`, ...) can smuggle a
    // type looser than what the implementation actually is, and this probe
    // has no way to know the cast is "safe" without a full type-checker
    // program (out of scope here; a bare rejection is the sound default).
    if (decl.initializer) {
      let unwrapped: import('typescript').Expression = decl.initializer;
      while (ts.isParenthesizedExpression(unwrapped)) unwrapped = unwrapped.expression;
      if (ts.isAsExpression(unwrapped) || ts.isTypeAssertionExpression(unwrapped)) {
        return {
          ok: false,
          detail: `"const parse" in ${parserPath}'s initializer contains an "as"-cast (${unwrapped.getText(sourceFile)}) -- a cast that could smuggle a wider/looser type than the real implementation is rejected outright`,
        };
      }
    }

    // F14 (round 6): the DECLARED TYPE, when present, is authoritative --
    // round 5's bug fell through to inspecting only the initializer's own
    // signature whenever the declared type wasn't a bare FunctionTypeNode,
    // silently ignoring an overload-bearing type-literal annotation (the
    // reviewer's exact repro: `const parse: {(input:any):any;
    // (input:string):CompositionIR} = function(input:string):
    // CompositionIR{...}`). Anything this probe cannot structurally
    // resolve is now a REJECT, never a silent fall-through to the
    // initializer.
    if (decl.type) {
      if (ts.isFunctionTypeNode(decl.type)) {
        paramTypeNodes = decl.type.parameters.map((p) => p.type);
        returnTypeNode = decl.type.type;
        decl.type.parameters.forEach((p, i) => {
          if (!p.type) missingAnnotations.push(`parameter ${i}`);
        });
        if (!returnTypeNode) missingAnnotations.push('return type');
        signatureSource = 'declared function-type annotation';
      } else if (ts.isTypeLiteralNode(decl.type)) {
        const callSignatures = decl.type.members.filter((m) => ts.isCallSignatureDeclaration(m));
        if (callSignatures.length !== 1) {
          return {
            ok: false,
            detail: `"const parse" in ${parserPath}'s declared type literal (${decl.type.getText(sourceFile)}) has ${callSignatures.length} call signature(s) -- exactly one is required; an overload-bearing callable type literal is rejected outright regardless of what the initializer implements`,
          };
        }
        // Any "any" ANYWHERE in the declared type literal fails it, not
        // merely within the one call signature selected below.
        if (collectAnyKeywordNodes(ts, decl.type).length > 0) {
          return { ok: false, detail: `"any" type node(s) found somewhere in "const parse"'s declared type literal in ${parserPath}: ${decl.type.getText(sourceFile)}` };
        }
        const sig = callSignatures[0] as import('typescript').CallSignatureDeclaration;
        paramTypeNodes = sig.parameters.map((p) => p.type);
        returnTypeNode = sig.type;
        sig.parameters.forEach((p, i) => {
          if (!p.type) missingAnnotations.push(`parameter ${i}`);
        });
        if (!returnTypeNode) missingAnnotations.push('return type');
        signatureSource = 'declared type-literal call signature';
      } else {
        return {
          ok: false,
          detail: `"const parse" in ${parserPath} has a declared type annotation (${decl.type.getText(sourceFile)}) this AST probe cannot structurally resolve (not a bare function type or an object type literal) -- rejected rather than silently falling back to the initializer`,
        };
      }
    } else if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
      const fn = decl.initializer;
      paramTypeNodes = fn.parameters.map((p) => p.type);
      returnTypeNode = fn.type;
      fn.parameters.forEach((p, i) => {
        if (!p.type) missingAnnotations.push(`parameter ${i}`);
      });
      if (!returnTypeNode) missingAnnotations.push('return type');
      signatureSource = 'initializer (no declared type annotation)';
    } else {
      return { ok: false, detail: `"const parse" in ${parserPath} is neither a function-type/type-literal annotation nor a function/arrow-function initializer this AST probe can inspect` };
    }
  }

  if (missingAnnotations.length > 0) {
    return { ok: false, detail: `"parse" in ${parserPath} is missing explicit type annotations for: ${missingAnnotations.join(', ')} -- an unannotated parameter/return is implicit "any" and is rejected the same as an explicit "any"` };
  }

  const anyLocations: string[] = [];
  paramTypeNodes.forEach((t, i) => {
    if (t && collectAnyKeywordNodes(ts, t).length > 0) anyLocations.push(`parameter ${i} type (${t.getText(sourceFile)})`);
  });
  if (returnTypeNode && collectAnyKeywordNodes(ts, returnTypeNode).length > 0) anyLocations.push(`return type (${returnTypeNode.getText(sourceFile)})`);
  if (anyLocations.length > 0) {
    return { ok: false, detail: `"any" type node(s) found in parse's signature in ${parserPath}: ${anyLocations.join('; ')}` };
  }

  return {
    ok: true,
    detail: `exactly one call signature for "parse" in ${parserPath} via ${signatureSource} (${parseFunctionDecls.length} function decl, ${parseVarDecls.length} const decl), no "any" type node anywhere in its parameter/return types or (for a type-literal annotation) anywhere in the declared type`,
  };
}

// =============================================================================
// C7-14 -- NL->IR goldens exist with a REAL typed parse interface. F14: a
// raw-text regex over the parser file accepted a signature sitting in a
// COMMENT, and calling the function without awaiting let an async function
// resolving undefined masquerade as "returned an object" (a Promise is an
// object). Fixed with (a) a GENERATED .ts probe file that imports the
// runtime export and assigns it to a declared function type -- comments
// have zero effect on an assignment TypeScript actually checks -- and
// (b) an AWAITED runtime call requiring the RESOLVED value to be non-
// undefined (a throw is still acceptable stub behavior). F14 (round 3):
// round 2's declared-type assignment (`const typedParse: (input: string)
// => CompositionIR | Promise<CompositionIR> = parse;`) still typechecks
// when the REAL export is `(input: any) => any` -- `any` is bidirectionally
// assignable to anything, so it silently satisfies a stricter declared
// type at the assignment site. Fixed with a conditional-type probe applied
// to the ACTUAL inferred parameter/return types (via Parameters<>/
// ReturnType<>), not to a hopeful re-declaration: (1) a NotAny/IsAny check
// on both the parameter and the resolved return type, using a literal
// true/false assignment (never an `as` cast, which would itself route
// through `any`'s bypass and prove nothing); (2) the resolved return type
// must be assignable to CompositionIR; (3) the bare empty-object type `{}`
// must NOT be assignable to the resolved return type (rejects a return
// type so loose -- e.g. `Record<string, unknown>` or `object` -- that an
// empty object would satisfy it even though it isn't literally `any`,
// which is the exact round-3 repro: "returning an empty object"). Runtime:
// the awaited resolved value, when non-undefined, is additionally
// validated against the committed IR JSON schema. F14 (round 5): the
// conditional-type probe only sees Parameters<>/ReturnType<>'s LAST
// resolved overload signature, so an any/any overload declared ahead of a
// well-typed one evades it entirely -- checkParseSignatureAst() above is a
// SECOND, independent layer that inspects the parser file's own AST for
// the overload structure itself (round 3's probe is kept as a second
// layer, not replaced, per the round-5 scope). Runtime: a thrown error is
// only acceptable stub behavior when it identifies itself as
// NotImplemented (name or message) -- an arbitrary throw is no longer a
// free pass, closing the round-4 repro where "implement parse by
// throwing" satisfied the runtime check unconditionally.
// =============================================================================
await probe(
  'C7-14',
  `read ${NL_GOLDENS_PATH} (>=5 pairs); AST-check ${NL_PARSER_PATH} (compiler API) for exactly one top-level "parse" declaration (no overload signatures) with zero "any" type nodes in its parameter/return types; write a generated .ts probe that derives parse's ACTUAL parameter/return types via Parameters<>/ReturnType<> and (a) asserts both are not "any" via a NotAny conditional-type + literal true/false assignment, (b) asserts the resolved return type is assignable to CompositionIR, (c) asserts the bare "{}" type is NOT assignable to the resolved return type; typecheck it plus all evals/**/*.ts; dynamic-import the parser and AWAIT parse(), requiring EITHER a non-undefined resolved value valid against ${IR_SCHEMA_PATH} OR a thrown error whose name/message matches NotImplemented`,
  `${NL_GOLDENS_PATH} has >=5 { id, nlDirective, expectedIR } pairs with an "axis" and "source" field; ${NL_PARSER_PATH}'s AST has exactly one top-level declaration of "parse" (an overload-signature shape -- multiple declarations sharing the name, regardless of what any individual signature says -- is rejected outright) with explicit, non-"any" parameter and return type annotations (an unannotated parameter/return is treated as implicit "any"); SEPARATELY, a generated probe file computes ParamType=Parameters<typeof parse>[0] and ReturnTypeResolved=Awaited<ReturnType<typeof parse>> and requires: IsAny<ParamType> and IsAny<ReturnTypeResolved> both compute to the literal type false (a second, independent layer -- kept because Parameters<>/ReturnType<> alone only see the last overload signature, which the AST check above closes); ReturnTypeResolved extends CompositionIR (all 6 IR top-level array keys); "{}" does NOT extend ReturnTypeResolved (rejects a vacuous/empty-object-shaped return even when it is not literally "any"); calling parse() and AWAITING the result requires EITHER the resolved value to be non-undefined AND pass validateAgainstSchema against the committed ${IR_SCHEMA_PATH} with zero errors, OR a thrown error whose name or message matches /NotImplemented/i (an arbitrary throw is no longer acceptable stub behavior); every .ts file under evals/ typechecks cleanly`,
  async () => {
    const goldens = readJson<Array<{ id?: string; nlDirective?: string; expectedIR?: { axis?: string; source?: string } }>>(NL_GOLDENS_PATH);
    if (goldens === null || !Array.isArray(goldens)) return { ok: false, evidence: `missing or invalid ${NL_GOLDENS_PATH}` };
    if (goldens.length < 5) return { ok: false, evidence: `only ${goldens.length} golden pairs, need >=5` };
    const malformed = goldens.filter((g) => !g.id || !g.nlDirective || !g.expectedIR?.axis || !g.expectedIR?.source);
    if (malformed.length > 0) return { ok: false, evidence: `${malformed.length} golden(s) missing id/nlDirective/expectedIR.axis/expectedIR.source` };

    if (!exists(NL_PARSER_PATH)) return { ok: false, evidence: `missing ${NL_PARSER_PATH}` };
    const irSchema = readJson<JsonSchema>(IR_SCHEMA_PATH);
    if (irSchema === null) return { ok: false, evidence: `missing or invalid ${IR_SCHEMA_PATH}` };

    // F14 (round 5): AST layer, independent of the conditional-type probe
    // below -- rejects the overload-evasion shape by construction.
    const tsApi = await loadTypeScriptCompilerApi();
    if (!tsApi.ok) return { ok: false, evidence: tsApi.error };
    const parserSource = readText(NL_PARSER_PATH);
    if (parserSource === null) return { ok: false, evidence: `could not read ${NL_PARSER_PATH} for the AST probe` };
    const astCheck = checkParseSignatureAst(tsApi.ts, parserSource, NL_PARSER_PATH);
    if (!astCheck.ok) return { ok: false, evidence: `AST signature check: ${astCheck.detail}` };

    const evalsTsFiles = listFilesRecursive(abs('evals')).filter((f) => f.endsWith('.ts'));
    if (evalsTsFiles.length === 0) return { ok: false, evidence: 'no .ts files found under evals/ to typecheck' };

    const probeTsPath = path.join(proofDir, 'C7-14-parse-signature-probe.ts');
    const importSpecifierRaw = path.relative(proofDir, abs(NL_PARSER_PATH)).split(path.sep).join('/');
    const importSpecifier = importSpecifierRaw.startsWith('.') ? importSpecifierRaw : `./${importSpecifierRaw}`;
    fs.writeFileSync(
      probeTsPath,
      [
        `import { parse } from ${JSON.stringify(importSpecifier)};`,
        `type CompositionIR = {`,
        `  sourceSlots: unknown[];`,
        `  directives: unknown[];`,
        `  constraints: unknown[];`,
        `  conflictResolution: unknown[];`,
        `  provenance: unknown[];`,
        `  variantAxes: unknown[];`,
        `};`,
        // F14 (round 3): probe the ACTUAL inferred types of the runtime
        // export, not a re-declared hopeful type -- an `as`-cast approach
        // would route through the same any-bypass this is meant to close.
        `type ParamType = Parameters<typeof parse>[0];`,
        `type ReturnTypeResolved = Awaited<ReturnType<typeof parse>>;`,
        `type IsAny<T> = 0 extends (1 & T) ? true : false;`,
        `type ReturnAssignableToIR = ReturnTypeResolved extends CompositionIR ? true : false;`,
        `type EmptyAssignableToReturn = {} extends ReturnTypeResolved ? true : false;`,
        `const _paramIsNotAny: IsAny<ParamType> = false;`,
        `const _returnIsNotAny: IsAny<ReturnTypeResolved> = false;`,
        `const _returnAssignableToIR: ReturnAssignableToIR = true;`,
        `const _emptyNotAssignableToReturn: EmptyAssignableToReturn = false;`,
        `void _paramIsNotAny; void _returnIsNotAny; void _returnAssignableToIR; void _emptyNotAssignableToReturn;`,
      ].join('\n'),
    );

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
            // This generated tsconfig lives in proofDir, OUTSIDE the repo --
            // TypeScript's default typeRoots search walks up from the
            // tsconfig file's own location, not from cwd or repoRoot, so
            // "types": ["node"] silently fails to resolve @types/node
            // unless typeRoots is pointed at the repo's own node_modules
            // explicitly. Verified by direct reproduction before this fix.
            typeRoots: [path.join(repoRoot, 'node_modules', '@types')],
            types: ['node'],
          },
          include: [...evalsTsFiles, probeTsPath],
        },
        null,
        2,
      ),
    );
    const tsc = sh('pnpm', ['exec', 'tsc', '-p', tmpTsconfig, '--noEmit']);
    if (tsc.status !== 0) {
      return { ok: false, evidence: `golden pairs: ${goldens.length}\ntsc exit=${tsc.status}\n${tsc.stdout}`, detail: 'evals/**/*.ts (including the generated parse-signature type-assertion probe) does not typecheck' };
    }

    const imported = await importEvalModule(NL_PARSER_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const parseFn = imported.mod['parse'];
    if (typeof parseFn !== 'function') return { ok: false, evidence: `${NL_PARSER_PATH} does not export a callable "parse" function at runtime` };
    let callBehavior: string;
    let runtimeOk: boolean;
    let schemaErrors: string[] = [];
    try {
      const resolved = await (parseFn as (s: string) => unknown | Promise<unknown>)(goldens[0]!.nlDirective!);
      const resolvedOk = resolved !== undefined;
      // F14 (round 3): a non-undefined resolved value is no longer
      // sufficient on its own -- it must additionally validate against the
      // committed IR JSON schema, or an empty/garbage object still passes
      // the old "typeof !== undefined" bar.
      if (resolvedOk) schemaErrors = validateAgainstSchema(irSchema, resolved);
      runtimeOk = resolvedOk && schemaErrors.length === 0;
      callBehavior = !resolvedOk
        ? 'FAIL: parse() resolved to undefined (awaited)'
        : schemaErrors.length === 0
          ? `resolved to ${typeof resolved}, valid against ${IR_SCHEMA_PATH}`
          : `FAIL: resolved to ${typeof resolved} but is invalid against ${IR_SCHEMA_PATH}: ${schemaErrors.join('; ')}`;
    } catch (e) {
      // F14 (round 5): a throw is acceptable stub behavior ONLY when it
      // identifies itself as NotImplemented -- round 4's "implement parse
      // by throwing" repro exploited an unconditional throw-is-fine rule to
      // dodge the schema backstop entirely with a real, working overload
      // hidden behind an any/any signature (now also blocked by the AST
      // check above). An arbitrary throw (a genuine bug, a wrong-argument
      // TypeError, etc.) is no longer a free pass.
      const err = e as Error;
      const isNotImplemented = /NotImplemented/i.test(err.name ?? '') || /NotImplemented/i.test(err.message ?? '');
      runtimeOk = isNotImplemented;
      callBehavior = isNotImplemented
        ? `threw NotImplemented (acceptable stub behavior): name=${err.name} message=${err.message}`
        : `FAIL: threw an error that does not identify itself as NotImplemented (name=${err.name} message=${err.message}) -- an arbitrary throw is no longer acceptable stub behavior`;
    }

    const ok = runtimeOk;
    return {
      ok,
      evidence: `golden pairs: ${goldens.length}\nAST signature check: ${astCheck.detail}\ntype-assertion probe typechecked OK (tsc exit=${tsc.status})\nawaited runtime call: ${callBehavior}`,
      detail: ok ? undefined : callBehavior,
    };
  },
);

// F17 (round 6): a naive "does the file contain an exit-code-shaped
// substring equal to 0" check is defeated by an earlier NARRATIVE line
// ("expected exit code: 0") that the first-match regex finds before the
// real, terminal, non-zero result. terminalExitZero() pairs each "$ <cmd>"
// line with the NEXT exit-code-shaped line after it (only the first such
// line following a command pairs with it -- a further stray exit-code-
// shaped line before the next command is left unpaired) and requires the
// LAST such pair's code to be 0 AND that pair's exit-code line to be the
// true final non-blank content of the log (only trailing whitespace
// allowed after it). This closes both named gaps at once: a narrative
// line elsewhere in the log can no longer masquerade as the result, and a
// free-floating "exit code: 0" appended without ever following a real
// "$ <cmd>" line cannot pair at all. F17 (round 7): the pairing logic
// still classified "expected exit code: 0" itself AS an exit-code-shaped
// line (the old regex matched it as a SUBSTRING anywhere on the line), so
// a two-line log with only that narrative line after "$ <cmd>" -- no real
// result at all -- still paired and passed. EXIT_LINE_RE is now strictly
// anchored to the WHOLE line: case-sensitive, line-start anchored, no
// preceding words permitted. "expected exit code: 0" no longer matches
// the exit-code pattern at all, so it can never pair with anything.
function terminalExitZero(runLogText: string): { ok: boolean; detail: string } {
  const lines = runLogText.split('\n');
  const CMD_LINE_RE = /^\s*\$\s+(.+?)\s*$/;
  // F17 (round 7): the previous \bexit(?:\s*code)?...\b pattern matched
  // "exit code: 0" as a SUBSTRING anywhere on a line -- including inside
  // narrative prose like "expected exit code: 0", which is not a real
  // result. Strictly anchored: the ENTIRE line (ignoring only trailing
  // whitespace) must be exactly "exit code: <digits>", case-sensitive, no
  // preceding words. "expected exit code: 0" no longer matches at all.
  const EXIT_LINE_RE = /^exit code: (\d+)\s*$/;
  const pairs: { cmd: string; exitLineIndex: number; code: string }[] = [];
  let pendingCmd: string | null = null;
  let totalExitLines = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const cmdMatch = CMD_LINE_RE.exec(line);
    if (cmdMatch) {
      pendingCmd = cmdMatch[1]!;
      continue;
    }
    const exitMatch = EXIT_LINE_RE.exec(line);
    if (exitMatch) {
      totalExitLines++;
      if (pendingCmd !== null) {
        pairs.push({ cmd: pendingCmd, exitLineIndex: i, code: exitMatch[1]! });
        pendingCmd = null; // only the first exit-code line after a command pairs with it
      }
    }
  }
  if (pairs.length === 0) {
    return { ok: false, detail: `no "$ <cmd>" line is paired with a following exit-code-shaped line (${totalExitLines} exit-code-shaped line(s) found, none tied to an executed command)` };
  }
  const lastPair = pairs[pairs.length - 1]!;
  if (lastPair.code !== '0') {
    return { ok: false, detail: `last command/exit-code pair ("$ ${lastPair.cmd}" -> exit code ${lastPair.code}) is not 0` };
  }
  let lastNonBlankLineIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.trim().length > 0) {
      lastNonBlankLineIndex = i;
      break;
    }
  }
  if (lastPair.exitLineIndex !== lastNonBlankLineIndex) {
    return {
      ok: false,
      detail: `winning pair's exit-code line ("${lines[lastPair.exitLineIndex]}") is not the final non-blank content of the log (found ${totalExitLines} exit-code-shaped line(s) total; content follows the paired result at line ${lastPair.exitLineIndex + 1}, log ends at line ${lastNonBlankLineIndex + 1})`,
    };
  }
  return { ok: true, detail: `"$ ${lastPair.cmd}" -> exit code 0, anchored as the final content of the log (${totalExitLines} exit-code-shaped line(s) total, ${pairs.length} paired to a command)` };
}

// =============================================================================
// C7-15 -- feasibility spike documented with EXECUTED evidence (F17): a real
// composed-output artifact must exist with its hash recorded in the doc;
// every insufficiency item must name a field that actually exists in the
// committed schema (enumerated from the schema itself, not a hardcoded
// token list); every response item must either cite such a real field or
// carry an explicit >=80-char no-change rationale. F17 (round 3): a
// hash-bound output file alone is still not CAUSAL evidence that the spike
// executed end to end -- an arbitrary/empty output object can be committed
// and hashed without ever running anything. A committed run-log file
// (a command transcript with an exit code) is now also required, and the
// doc must cross-reference the case id, the output hash, AND the run-log
// hash together in one place, closing the gap where an unrelated log and
// an unrelated output could each be hashed and cited independently without
// ever having produced each other. F17 (round 5): a hash-bound, cross-
// referenced but ARBITRARY output (round-4 repro: `{}`) and a run-log that
// need not report success are still not causal proof. The run-log's exit
// code must now be exactly 0, and composed-output.json must (a) validate
// against the real composition shape (blindInput/ScoringInput) and (b)
// have every element's provenance RESOLVE into the referenced spike case's
// own captured snapshots via the same resolves()/buildSnapshotsBySource()
// machinery C7-4 uses -- an empty `{}` fails at the very first structural
// check by construction. F17 (round 6): the exit-code check is replaced
// with terminalExitZero() above -- see its comment for the pairing +
// end-of-log anchoring it now requires.
// =============================================================================
const MIN_SPIKE_ITEM_LENGTH = 40;
const MIN_NO_CHANGE_RATIONALE_LENGTH = 80;

await probe(
  'C7-15',
  `read ${SPIKE_DOC_PATH} + ${IR_SCHEMA_PATH} + ${SPIKE_RUNLOG_PATH} + ${SPIKE_OUTPUT_PATH}; require ${SPIKE_OUTPUT_PATH} exists, validates against the composition shape (blindInput), has every element resolve into the referenced case's captured snapshots (buildSnapshotsBySource/resolves, same as C7-4), and its sha256 is recorded verbatim in the doc; require ${SPIKE_RUNLOG_PATH} exists, looks like a command transcript, and has a terminal "$ <cmd>"-paired exit code of 0 anchored to the final non-blank content of the log (terminalExitZero); require the case id + output hash + run-log hash all appear together in one paragraph of the doc; enumerate real schema field names; require EVERY substantive insufficiency item to name a real field; require EVERY substantive response item to name a real field OR carry an explicit >=${MIN_NO_CHANGE_RATIONALE_LENGTH}-char no-change rationale`,
  `${SPIKE_OUTPUT_PATH} exists, parses via blindInput() into a valid {caseId, composition[]} (a bare "{}" fails immediately -- no non-empty caseId), every composition element's (sourceId,nodeId,domPath,breakpoint) RESOLVES against the referenced spike case's real captured snapshots (buildSnapshotsBySource + resolves(), the identical machinery C7-4 uses), and its sha256 is recorded verbatim in ${SPIKE_DOC_PATH}; ${SPIKE_RUNLOG_PATH} exists, contains a recognizable command-invocation line, and terminalExitZero() finds a "$ <cmd>" line paired with the NEXT line matching the STRICTLY anchored, case-sensitive pattern /^exit code: (\\d+)\\s*$/ (the whole line, ignoring only trailing whitespace -- a narrative line like "expected exit code: 0" does not match at all), that pair's code is EXACTLY 0, AND that pair's exit-code line is the true final non-blank content of the log (F17); the doc contains one paragraph naming the referenced case id, the output hash, AND the run-log hash together (F17: prevents citing a real output hash and a real run-log hash from two unrelated executions); "## Case" names a real corpus case id; EVERY list item under "## IR insufficiencies found" (>=1 item, each >= ${MIN_SPIKE_ITEM_LENGTH} chars) names at least one field name that is enumerated from the ACTUAL committed ${IR_SCHEMA_PATH} (not a fixed token list) -- a generic bullet or a field name in unrelated prose elsewhere in the doc does not count; EVERY list item under "## Responses" (>=1 item, each >= ${MIN_SPIKE_ITEM_LENGTH} chars) EITHER names a real schema field OR is itself >= ${MIN_NO_CHANGE_RATIONALE_LENGTH} chars (an explicit no-change rationale) -- a short token-only response line fails both branches`,
  async () => {
    const text = readText(SPIKE_DOC_PATH);
    if (text === null) return { ok: false, evidence: `missing ${SPIKE_DOC_PATH}` };
    const schema = readJson<JsonSchema>(IR_SCHEMA_PATH);
    if (schema === null) return { ok: false, evidence: `missing or invalid ${IR_SCHEMA_PATH}` };
    const schemaFields = enumerateSchemaFieldNames(schema);
    if (schemaFields.size === 0) return { ok: false, evidence: `${IR_SCHEMA_PATH} has no enumerable property names` };

    if (!exists(SPIKE_OUTPUT_PATH)) return { ok: false, evidence: `missing ${SPIKE_OUTPUT_PATH} -- the spike must produce a real composed-output artifact, not just a narrative` };
    const outputHash = sha256File(SPIKE_OUTPUT_PATH);
    if (!outputHash || !text.includes(outputHash)) {
      return { ok: false, evidence: `${SPIKE_OUTPUT_PATH}'s sha256 (${outputHash ?? '(unreadable)'}) is not recorded verbatim in ${SPIKE_DOC_PATH}` };
    }

    // F17: causal spike evidence -- a committed run-log (command transcript
    // with an exit code) that the doc cross-references alongside the
    // output hash and case id.
    const runLogText = readText(SPIKE_RUNLOG_PATH);
    if (runLogText === null) return { ok: false, evidence: `missing ${SPIKE_RUNLOG_PATH} -- causal evidence the spike executed end to end (a command transcript with exit code) is required` };
    const looksLikeCommandTranscript = /^\s*[$#>]\s*\S+/m.test(runLogText) || /\b(npx|pnpm|node|tsx|npm)\b/.test(runLogText);
    if (!looksLikeCommandTranscript) {
      return { ok: false, evidence: `${SPIKE_RUNLOG_PATH} does not look like a command transcript (no "$ <cmd>"/"# <cmd>"/">" prompt line and no recognizable tool invocation)` };
    }
    // F17 (round 6): round 5's exitCodeMatch took the FIRST exit-code-shaped
    // substring anywhere in the file -- the repro embeds "expected exit
    // code: 0" (a narrative line, not a real result) BEFORE the real,
    // terminal "exit code: 1", and the first-match regex reported success.
    // terminalExitZero() instead pairs each "$ <cmd>" line with the NEXT
    // exit-code-shaped line after it (only the first such line pairs; a
    // later stray exit-code-shaped line is left unpaired), requires the
    // LAST such pair's code to be 0, AND requires that pair's exit-code
    // line to be the true final non-blank content of the log (only
    // trailing whitespace allowed after it) -- so an extra line appended
    // after a legitimate 0 (like the repro's trailing "exit code: 1", or a
    // free-floating "exit code: 0" not actually tied to any "$ <cmd>")
    // fails outright.
    const terminalExit = terminalExitZero(runLogText);
    if (!terminalExit.ok) {
      return { ok: false, evidence: `${SPIKE_RUNLOG_PATH} does not have a terminal, command-paired "exit code: 0" as its final content: ${terminalExit.detail}` };
    }
    const runLogHash = sha256File(SPIKE_RUNLOG_PATH);
    if (!runLogHash || !text.includes(runLogHash)) {
      return { ok: false, evidence: `${SPIKE_RUNLOG_PATH}'s sha256 (${runLogHash ?? '(unreadable)'}) is not recorded verbatim in ${SPIKE_DOC_PATH}` };
    }

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
    const namesRealField = (item: string): string | null => [...schemaFields].find((f) => new RegExp(`\\b${f}\\b`, 'i').test(item)) ?? null;

    const problems: string[] = [];
    if (caseSection.length === 0) problems.push('"## Case" section missing or empty');
    if (insufficiencyItems.length === 0) problems.push('"## IR insufficiencies found" has no list items');
    const insuffFieldProblems = insufficiencyItems.filter((item) => item.length < MIN_SPIKE_ITEM_LENGTH || !namesRealField(item));
    if (insuffFieldProblems.length > 0) {
      problems.push(`${insuffFieldProblems.length}/${insufficiencyItems.length} insufficiency items are too short or name no real schema field: ${JSON.stringify(insuffFieldProblems.map((i) => i.slice(0, 60)))}`);
    }
    if (responseItems.length === 0) problems.push('"## Responses" has no list items');
    const responseProblems = responseItems.filter((item) => {
      if (namesRealField(item) && item.length >= MIN_SPIKE_ITEM_LENGTH) return false;
      if (item.length >= MIN_NO_CHANGE_RATIONALE_LENGTH) return false;
      return true;
    });
    if (responseProblems.length > 0) {
      problems.push(`${responseProblems.length}/${responseItems.length} response items neither cite a real schema field (>= ${MIN_SPIKE_ITEM_LENGTH} chars) NOR carry a >= ${MIN_NO_CHANGE_RATIONALE_LENGTH}-char no-change rationale: ${JSON.stringify(responseProblems.map((i) => i.slice(0, 60)))}`);
    }

    const { manifest } = loadManifest();
    const caseIdMatch = caseSection.match(/[a-zA-Z0-9_-]+/);
    const referencedId = caseIdMatch?.[0];
    const caseExists = manifest ? manifest.cases.some((c) => c.id === referencedId) : false;
    if (!caseExists) problems.push(`referenced case id "${referencedId ?? '(none found)'}" not present in ${MANIFEST_PATH}`);

    // F17 (round 5): a hash-bound, cross-referenced output file is still
    // not proof the spike is REAL -- round 4's repro committed a bare `{}`
    // as composed-output.json and passed once its hash was cited. The
    // artifact must (a) validate against the same composition shape the
    // scorer consumes (ScoringInput/CompositionElement, via the existing
    // blindInput() deep-whitelist parser -- a bare `{}` fails immediately
    // since it has no non-empty "caseId" string) AND (b) have every
    // element's provenance RESOLVE into the referenced spike case's own
    // captured snapshots, using the exact same resolves()/
    // buildSnapshotsBySource() machinery C7-4 uses.
    let composedOutputSummary = '(not checked -- see problems)';
    const composedOutputRaw = readJson<unknown>(SPIKE_OUTPUT_PATH);
    if (composedOutputRaw === null) {
      problems.push(`${SPIKE_OUTPUT_PATH} is missing or invalid JSON`);
    } else {
      const blinded = blindInput(composedOutputRaw);
      if (!blinded.ok) {
        problems.push(`${SPIKE_OUTPUT_PATH} does not validate against the composition shape: ${blinded.error}`);
      } else if (blinded.input.composition.length === 0) {
        problems.push(`${SPIKE_OUTPUT_PATH}.composition is empty -- a real spike output must have at least one element`);
      } else {
        const spikeCase = manifest?.cases.find((c) => c.id === referencedId);
        if (!spikeCase) {
          problems.push(`cannot resolve composed-output provenance -- referenced case "${referencedId ?? '(none)'}" not found in ${MANIFEST_PATH}`);
        } else {
          const snapshotsResult = buildSnapshotsBySource(spikeCase);
          if (!snapshotsResult.ok) {
            problems.push(`could not build snapshots for case ${spikeCase.id}: ${snapshotsResult.error}`);
          } else {
            const unresolved = blinded.input.composition.filter((el) => !resolves(el, snapshotsResult.bySource));
            if (unresolved.length > 0) {
              problems.push(`${unresolved.length}/${blinded.input.composition.length} composed-output elements do not resolve against case ${spikeCase.id}'s captured snapshots: ${JSON.stringify(unresolved.map((el) => el.elementId))}`);
            }
            composedOutputSummary = `${blinded.input.composition.length} element(s), ${blinded.input.composition.length - unresolved.length}/${blinded.input.composition.length} resolve against case ${spikeCase.id}'s captured snapshots`;
          }
        }
      }
    }

    // F17: the case id, output hash, and run-log hash must cross-reference
    // CONSISTENTLY -- i.e. appear together in one place -- not merely be
    // present somewhere each in the document independently (which would
    // still allow citing hashes from three unrelated executions).
    const paragraphs = text.split(/\n\s*\n/);
    const crossReferenced = !!referencedId && paragraphs.some((p) => p.includes(referencedId) && p.includes(outputHash) && p.includes(runLogHash));
    if (!crossReferenced) {
      problems.push(`no single paragraph in ${SPIKE_DOC_PATH} cross-references the case id (${referencedId ?? '(none)'}), output hash, and run-log hash together`);
    }

    return {
      ok: problems.length === 0,
      evidence: `composed-output hash recorded: yes (${outputHash})\ncomposed-output shape + provenance: ${composedOutputSummary}\nrun-log (${SPIKE_RUNLOG_PATH}) hash recorded: yes (${runLogHash}), terminal exit-code pairing: ${terminalExit.detail}\ncase id + output hash + run-log hash cross-referenced in one paragraph: ${crossReferenced}\nschema fields enumerated: ${schemaFields.size}\ncase section: ${caseSection.slice(0, 200)}\ninsufficiency items: ${insufficiencyItems.length} (field-grounded: ${insufficiencyItems.length - insuffFieldProblems.length})\nresponse items: ${responseItems.length} (valid: ${responseItems.length - responseProblems.length})\nreferenced case exists in manifest: ${caseExists}`,
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
    const verdictBlock = (needle: RegExp): { present: boolean; verdictOk: boolean; rationaleOk: boolean } => {
      const m = needle.exec(text);
      if (!m) return { present: false, verdictOk: false, rationaleOk: false };
      const block = m[0];
      const verdict = /Verdict:\s*(GO|NO-GO)/i.exec(block);
      const rationaleLen = block.replace(/##[^\n]*\n/, '').replace(/Verdict:[^\n]*\n?/i, '').trim().length;
      return { present: true, verdictOk: !!verdict, rationaleOk: rationaleLen > 20 };
    };
    const r1 = verdictBlock(/##\s*Reviewer 1[^\n]*\n([\s\S]*?)(\n##\s|$)/i);
    const r2 = verdictBlock(/##\s*Reviewer 2[^\n]*\n([\s\S]*?)(\n##\s|$)/i);
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

// =============================================================================
// GATE-INTEGRITY (F1) -- once an approval round pins this file's sha256,
// every later run hard-fails on any drift. Before any approval exists, this
// is advisory only (the hash is simply recorded for the orchestrator).
// F19: self-path is resolved via process.argv[1] (the invoked script path),
// NOT fileURLToPath(import.meta.url) -- the latter is empty/undefined under
// the CJS transform tsx/esbuild apply to an out-of-repo file with no
// ancestor package.json declaring ESM, which is exactly the execution mode
// this file must support. import.meta.url no longer appears in this file.
const selfScriptPath = path.resolve(process.argv[1] ?? '');
const selfBytes = fs.readFileSync(selfScriptPath);
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
// LEASE check (R9) -- F15: ls-remote failure is now a HARD FAIL with no
// local-ref advisory fallback (landing context always has network); a
// failed rev-list is a HARD FAIL, never silently converted to -1 (which
// round 1 did, defeating the "empty diff vs non-empty history" guard
// whenever rev-list happened to fail).
// =============================================================================
function resolveRemoteMainShaOrFail(): { ok: true; sha: string } | { ok: false; error: string } {
  const lsRemote = sh('git', ['ls-remote', 'origin', 'main']);
  if (lsRemote.status !== 0) return { ok: false, error: `git ls-remote origin main failed (status=${lsRemote.status}): ${lsRemote.stderr} -- F15: no local-ref fallback permitted, landing context always has network` };
  const sha = lsRemote.stdout.trim().split('\n')[0]?.split('\t')[0]?.trim();
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) return { ok: false, error: `git ls-remote origin main returned unparseable output: "${lsRemote.stdout}"` };
  const catCheck = sh('git', ['cat-file', '-e', sha]);
  if (catCheck.status !== 0) return { ok: false, error: `remote origin/main (${sha}) is not present locally -- fetch required before verification` };
  return { ok: true, sha };
}

const remoteMain = resolveRemoteMainShaOrFail();
let baseCommit = '';
if (remoteMain.ok) {
  const mb = sh('git', ['merge-base', remoteMain.sha, 'HEAD']);
  if (mb.status === 0 && mb.stdout.trim()) baseCommit = mb.stdout.trim();
}
// headSha/headShaResult/gitIdentityOk are resolved once, near the top of
// the file, so the Phase-2 reviewer-disposition checks can use them too.

const LEASE_ALLOW = ['docs/specs/', 'evals/', 'docs/plans/waves/'];
const LEASE_ALLOW_EXACT = ['scripts/waves/verify-w7.ts'];

await (async () => {
  const startedAt = Date.now();
  const command = `git diff --name-only <base resolved ONLY via git ls-remote origin main>...HEAD ⊆ leases.json[W7].allow`;
  const assertion = `no writes outside docs/specs/**, evals/**, scripts/waves/verify-w7.ts, docs/plans/waves/**; the base commit is resolved EXCLUSIVELY from git ls-remote origin main (F15: no local-ref advisory fallback -- landing context always has network, so an unreachable remote is itself a fail, not a downgrade); every git invocation's exit status is checked including rev-list (F15: a failed rev-list is a hard fail, never silently treated as -1); an empty diff against a non-empty commit range fails closed`;
  try {
    if (!remoteMain.ok) {
      record('LEASE', command, assertion, 'fail', remoteMain.error, startedAt, 'F15: git ls-remote origin main is required and failed -- no fallback');
      return;
    }
    if (!gitIdentityOk) {
      record('LEASE', command, assertion, 'fail', `cannot resolve HEAD sha (status=${headShaResult.status}, stdout="${headShaResult.stdout}")`, startedAt, 'unresolvable HEAD');
      return;
    }
    if (!baseCommit) {
      record('LEASE', command, assertion, 'fail', `merge-base against verified remote main sha ${remoteMain.sha} failed to resolve`, startedAt, 'unresolvable base commit');
      return;
    }
    const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
    if (diffResult.status !== 0) {
      record('LEASE', command, assertion, 'fail', `git diff --name-only ${baseCommit}...HEAD failed (status=${diffResult.status}): ${diffResult.stderr}`, startedAt, 'git diff failed');
      return;
    }
    const commitCountResult = sh('git', ['rev-list', '--count', `${baseCommit}..HEAD`]);
    if (commitCountResult.status !== 0) {
      record('LEASE', command, assertion, 'fail', `git rev-list --count ${baseCommit}..HEAD failed (status=${commitCountResult.status}): ${commitCountResult.stderr} -- F15: a failed rev-list is a hard fail, never treated as -1`, startedAt, 'rev-list failed');
      return;
    }
    const commitCount = parseInt(commitCountResult.stdout.trim(), 10);
    if (!Number.isFinite(commitCount) || commitCount < 0) {
      record('LEASE', command, assertion, 'fail', `git rev-list --count returned unparseable output: "${commitCountResult.stdout}"`, startedAt, 'rev-list unparseable');
      return;
    }
    const diffNames = diffResult.stdout.trim().split('\n').filter(Boolean);
    if (diffNames.length === 0 && commitCount > 0) {
      record('LEASE', command, assertion, 'fail', `empty file diff but ${commitCount} commit(s) between verified base ${baseCommit} and HEAD -- refusing to pass an empty lease diff against non-empty branch history`, startedAt, 'suspicious empty diff');
      return;
    }
    const leaseViolations = diffNames.filter((f) => !LEASE_ALLOW.some((prefix) => f.startsWith(prefix)) && !LEASE_ALLOW_EXACT.includes(f));
    const evidence = [`base resolution: ls-remote-verified, baseCommit=${baseCommit}`, `commits base..HEAD: ${commitCount}`, leaseViolations.join('\n') || `all ${diffNames.length} changed files inside the W7 lease`].join('\n');
    record('LEASE', command, assertion, leaseViolations.length === 0 ? 'pass' : 'fail', evidence, startedAt);
  } catch (error) {
    record('LEASE', command, assertion, 'fail', `probe threw: ${(error as Error).stack ?? String(error)}`, startedAt, 'probe crashed instead of failing cleanly');
  }
})();

// =============================================================================
// commit-bound manifest -- F16: guarded temp+rename write with a fallback
// dir and an emergency last-resort path; the exit code accounts for a
// degraded manifest write (never exit 0 on a manifest that didn't land at
// its primary, real location).
// =============================================================================
function writeManifestSafely(data: unknown): { path: string; wroteOk: boolean } {
  const content = JSON.stringify(data, null, 2);
  const primary = path.join(proofDir, 'manifest.json');
  try {
    const tmp = `${primary}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, primary);
    return { path: primary, wroteOk: true };
  } catch (e1) {
    console.error(`verify-w7: primary manifest write failed (${(e1 as Error).message}), trying fallback`);
  }
  try {
    const fallbackDir = path.join(os.tmpdir(), `verify-w7-fallback-${process.pid}`);
    fs.mkdirSync(fallbackDir, { recursive: true });
    const fallbackPath = path.join(fallbackDir, 'manifest.json');
    fs.writeFileSync(fallbackPath, content);
    return { path: fallbackPath, wroteOk: false };
  } catch (e2) {
    console.error(`verify-w7: fallback manifest write failed (${(e2 as Error).message}), trying emergency path`);
  }
  try {
    const emergencyPath = path.join(os.tmpdir(), `verify-w7-EMERGENCY-manifest-${Date.now()}.json`);
    fs.writeFileSync(emergencyPath, content);
    return { path: emergencyPath, wroteOk: false };
  } catch (e3) {
    console.error('verify-w7: CATASTROPHIC -- could not write the proof manifest anywhere:', e3);
    return { path: '(none)', wroteOk: false };
  }
}

const statusResult = sh('git', ['status', '--porcelain']);
const treeDirty = statusResult.status !== 0 || statusResult.stdout.trim().length > 0;
// F13: record this run's machine fingerprint at the top level of the proof
// manifest (alongside toolchain) so a human can compare two independent
// runs' manifests to check the residual cross-machine boundary that this
// verifier cannot mechanically force (see C7-13's assertion string).
const machineFingerprint = { hostname: os.hostname(), platform: os.platform(), arch: os.arch(), nodeVersion: process.version };
const manifestOut = {
  wave: 'W7',
  commit: headSha,
  treeDirty,
  baseCommit,
  verifierSha256: selfSha256,
  sealAccessBoundary: SEAL_ACCESS_BOUNDARY,
  machineIdentityBoundary: MACHINE_IDENTITY_BOUNDARY,
  toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
  machineFingerprint,
  // F16: a run whose canonical proof dir couldn't be created (fell back to
  // a temp dir) must be visible in the manifest itself, not just a
  // console.error that scrolls by -- and per the exit-code line below, such
  // a run can never report success even if the fallback write technically
  // "worked" (wroteOk true at the fallback location).
  canonicalProofDirFailed,
  criteria: results,
};
const manifestWrite = writeManifestSafely(manifestOut);

const hardFailures = results.filter((r) => r.status === 'fail');
const blocked = results.filter((r) => r.status === 'blocked-on-founder');
const passed = results.filter((r) => r.status === 'pass');
console.log(`\nverify-w7: ${passed.length} pass, ${blocked.length} blocked-on-founder, ${hardFailures.length} fail (of ${results.length}); treeDirty=${treeDirty}; manifest=${manifestWrite.path} (wroteOk=${manifestWrite.wroteOk}); canonicalProofDirFailed=${canonicalProofDirFailed}`);
for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id} — ${r.assertion.slice(0, 140)}${r.assertion.length > 140 ? '…' : ''}`);
if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT §2)');
if (!manifestWrite.wroteOk) console.log('  ⚠ proof manifest degraded to a fallback/emergency path -- never a wave pass (F16)');
if (canonicalProofDirFailed) console.log(`  ⚠ canonical proof dir ${path.join(goalStateDir, 'proof')} could not be created; this run wrote proofs to a temp fallback -- never a wave pass (F16)`);
process.exit(hardFailures.length === 0 && !treeDirty && manifestWrite.wroteOk && !canonicalProofDirFailed ? 0 : 1);
})().catch((e) => {
  console.error('verify-w7: fatal error escaped the async IIFE', e);
  process.exit(1);
});
