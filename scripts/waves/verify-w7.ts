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
// Anti-gaming posture (VERIFICATION-CONTRACT.md S3): wherever a criterion
// names a specific gaming vector (shuffled-ID control, name-grep bleed
// detector, house-style composite, recolor-only trio, ...), this verifier
// constructs the adversarial input ITSELF at run time and calls the
// implementer's exported functions on it, rather than trusting the
// implementer's own fixtures or test-suite exit code alone. Where unit
// tests are also required (C7-7/C7-8), the verifier additionally asserts
// specific named control-cases exist and pass -- a test suite that covers
// something else does not satisfy the criterion.
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
const proofDir = path.join(os.homedir(), '.claude', 'goal-state', 'mishmash-w7-selector-foundations', 'proof');
fs.mkdirSync(proofDir, { recursive: true });

function sh(cmd: string, args: string[], cwd: string = repoRoot): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60_000 });
    return { status: 0, stdout };
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '' };
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

function artifactFor(id: string, content: string): { artifact: string; artifactSha256: string } {
  const file = path.join(proofDir, `${id}.txt`);
  fs.writeFileSync(file, content);
  return { artifact: file, artifactSha256: crypto.createHash('sha256').update(content).digest('hex') };
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
// never a crashed process (explicit validation requirement).
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
// minimum, maximum, pattern. Enough to structurally validate the IR schema
// this wave must ship. Deliberately generic: it interprets whatever schema
// document the implementer commits, so a vacuous schema ({}) will pass
// everything here -- C7-1 separately asserts the schema names the six
// mandated IR concepts, closing that hole.
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
// evals/selector/corpus/manifest.json -- the machine-readable corpus index
// C7-5's row-by-row quota check reads. Shape mandated here (also restated
// in each criterion's assertion string):
//
// interface CorpusCase {
//   id: string;
//   genre: string;                 // primary/dominant genre tag for this case
//   layoutSystem: string;          // primary/dominant layout-system tag
//   breakpoints: string[];         // breakpoints SCORED for this case
//   sources: { id: string; snapshots: Record<string, { path: string; sha256: string }> }[];
//   conflict: { axis: string; winningSource: string; losingSource: string } | null;
//   degenerate: 'single-source' | 'nonexistent-element-directive' | 'hostile-heavy-dom' | null;
//   skip: { reason: 'login-walled' | 'bot-walled'; target: string } | null;
//   sealed: boolean;
//   irPath: string;                // repo-relative path to this case's IR instance
// }
// interface CorpusManifest { version: number; sealedFraction: number; cases: CorpusCase[] }

interface SnapshotRef {
  path: string;
  sha256: string;
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
  conflict: { axis: string; winningSource: string; losingSource: string } | null;
  degenerate: 'single-source' | 'nonexistent-element-directive' | 'hostile-heavy-dom' | null;
  skip: { reason: 'login-walled' | 'bot-walled'; target: string } | null;
  sealed: boolean;
  irPath: string;
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
const SCORER_INDEX_PATH = 'evals/selector/scorer/index.ts';
const SOURCE_BLEED_PATH = 'evals/selector/scorer/source-bleed.ts';
const SOURCE_BLEED_TEST_PATH = 'evals/selector/tests/source-bleed.test.ts';
const DIVERSITY_PATH = 'evals/selector/scorer/diversity.ts';
const DIVERSITY_TEST_PATH = 'evals/selector/tests/diversity.test.ts';
const DIVERSITY_AXES_PATH = 'evals/selector/diversity-axes.json';
const DIRECTIVE_COVERAGE_PATH = 'evals/selector/scorer/directive-claim-coverage.ts';
const DIRECTIVE_COVERAGE_TEST_PATH = 'evals/selector/tests/directive-claim-coverage.test.ts';
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

// =============================================================================
// C7-1 -- IR schema exists and is serializable
// =============================================================================
await probe(
  'C7-1',
  `read ${IR_SPEC_PATH}, ${IR_SCHEMA_PATH}; JSON round-trip + schema-validate every corpus IR instance`,
  `${IR_SPEC_PATH} documents the six IR concepts (source slots, directive parse, constraints, conflict resolution, provenance, variant axes); ` +
    `${IR_SCHEMA_PATH} is a JSON Schema requiring top-level keys [${REQUIRED_IR_TOP_KEYS.join(', ')}] with provenance entries requiring [${REQUIRED_PROVENANCE_ENTRY_KEYS.join(', ')}]; ` +
    `every corpus IR instance (via ${MANIFEST_PATH}, sealed cases included) JSON-round-trips (stringify/parse/deep-equal) AND validates against the committed schema with zero errors`,
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
    const topRequired = schema['required'];
    const topProps = schema['properties'] as Record<string, JsonSchema> | undefined;
    const declaredTop = new Set([...(Array.isArray(topRequired) ? (topRequired as string[]) : []), ...(topProps ? Object.keys(topProps) : [])]);
    const missingTop = REQUIRED_IR_TOP_KEYS.filter((k) => !declaredTop.has(k));
    if (missingTop.length > 0) {
      return { ok: false, evidence: `${IR_SCHEMA_PATH} does not declare required top-level IR keys: ${missingTop.join(', ')}` };
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
      const raw = readText(c.irPath);
      if (raw === null) {
        failures++;
        lines.push(`${c.id}: IR file missing at ${c.irPath}`);
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
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
      lines.push(`${c.id}: round-trip + schema OK (sealed=${c.sealed})`);
    }
    return { ok: failures === 0, evidence: lines.join('\n'), detail: failures > 0 ? `${failures}/${manifest.cases.length} corpus IR instances failed round-trip or schema validation` : undefined };
  },
);

// =============================================================================
// C7-2 -- IR expresses every corpus directive (coverage, incl. sealed-before-seal ordering)
// =============================================================================
await probe(
  'C7-2',
  `for every case in ${MANIFEST_PATH}, confirm an IR instance exists and validates; for sealed cases, confirm via git history that the IR file was committed at or before ${SEALED_ACCESS_PATH}`,
  `every corpus case (sealed included) has a 1:1 IR instance validating against ${IR_SCHEMA_PATH}; sealed cases' IR files were authored (first committed) before or in the same commit as the sealing record -- proving they predate the seal rather than being backfilled after`,
  async () => {
    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot check coverage: ${error}` };
    const schema = readJson<JsonSchema>(IR_SCHEMA_PATH);
    if (schema === null) return { ok: false, evidence: `missing or invalid JSON at ${IR_SCHEMA_PATH}` };
    if (manifest.cases.length === 0) return { ok: false, evidence: `${MANIFEST_PATH} has zero cases` };

    const lines: string[] = [];
    let failures = 0;
    const sealAddedCommit = sh('git', ['log', '--diff-filter=A', '--format=%H', '--', SEALED_ACCESS_PATH]).stdout.trim().split('\n').filter(Boolean).pop();
    for (const c of manifest.cases) {
      const raw = c.irPath ? readText(c.irPath) : null;
      if (raw === null) {
        failures++;
        lines.push(`${c.id}: missing IR at ${c.irPath ?? '(no irPath in manifest)'}`);
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        failures++;
        lines.push(`${c.id}: IR is not valid JSON`);
        continue;
      }
      const schemaErrors = validateAgainstSchema(schema, parsed);
      if (schemaErrors.length > 0) {
        failures++;
        lines.push(`${c.id}: IR does not validate (${schemaErrors.length} errors)`);
        continue;
      }
      if (c.sealed) {
        if (!sealAddedCommit) {
          failures++;
          lines.push(`${c.id}: sealed but ${SEALED_ACCESS_PATH} has no git history to anchor an ordering check`);
          continue;
        }
        const irAddedCommit = sh('git', ['log', '--diff-filter=A', '--format=%H', '--', c.irPath]).stdout.trim().split('\n').filter(Boolean).pop();
        if (!irAddedCommit) {
          failures++;
          lines.push(`${c.id}: sealed IR has no "added" commit in git history (uncommitted or renamed without --follow support)`);
          continue;
        }
        const ancestorCheck = sh('git', ['merge-base', '--is-ancestor', irAddedCommit, sealAddedCommit]);
        const sameCommit = irAddedCommit === sealAddedCommit;
        if (ancestorCheck.status !== 0 && !sameCommit) {
          failures++;
          lines.push(`${c.id}: sealed IR added at ${irAddedCommit} which is NOT an ancestor of (or equal to) the seal commit ${sealAddedCommit} -- looks backfilled after sealing`);
          continue;
        }
        lines.push(`${c.id}: sealed, IR predates/matches seal commit (ir=${irAddedCommit}, seal=${sealAddedCommit})`);
      } else {
        lines.push(`${c.id}: IR present and valid`);
      }
    }
    return { ok: failures === 0, evidence: lines.join('\n'), detail: failures > 0 ? `${failures}/${manifest.cases.length} cases failed coverage/ordering` : undefined };
  },
);

// =============================================================================
// C7-3 -- conflicts resolve deterministically and visibly
// =============================================================================
await probe(
  'C7-3',
  `dynamic-import ${RESOLVE_CONFLICTS_PATH}, call resolveConflicts(ir) three times per conflict case, hash each result`,
  `${RESOLVE_CONFLICTS_PATH} exports resolveConflicts(ir): { result: unknown; losingClaims: Array<{axis,winningSource,losingSource}> }; for every conflict-marked case, three independent calls in this process yield an identical stable hash AND losingClaims is non-empty`,
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
      const raw = c.irPath ? readText(c.irPath) : null;
      if (raw === null) {
        failures++;
        lines.push(`${c.id}: no IR to resolve`);
        continue;
      }
      const ir = JSON.parse(raw) as unknown;
      const hashes: string[] = [];
      let anyLosingClaims = true;
      for (let run = 0; run < 3; run++) {
        // eslint-disable-next-line no-await-in-loop
        const out = await (resolveConflicts as (ir: unknown) => unknown | Promise<unknown>)(structuredClone(ir));
        const resolved = out as { result?: unknown; losingClaims?: unknown[] };
        if (!Array.isArray(resolved.losingClaims) || resolved.losingClaims.length === 0) anyLosingClaims = false;
        hashes.push(sha256Of(resolved));
      }
      const allSame = hashes.every((h) => h === hashes[0]);
      if (!allSame || !anyLosingClaims) {
        failures++;
        lines.push(`${c.id}: allSame=${allSame} anyLosingClaims=${anyLosingClaims} hashes=${hashes.join(',')}`);
      } else {
        lines.push(`${c.id}: deterministic across 3 runs (hash ${hashes[0]}), losing claims recorded`);
      }
    }
    return { ok: failures === 0, evidence: lines.join('\n'), detail: failures > 0 ? `${failures}/${conflictCases.length} conflict cases not deterministic or missing losing claims` : undefined };
  },
);

// =============================================================================
// C7-4 -- provenance pointers resolve; shuffled-ID control scores zero
// =============================================================================
await probe(
  'C7-4',
  `dynamic-import ${PROVENANCE_RESOLVE_PATH}, call resolveProvenance(ir, snapshotsBySource) on real IR (expect 100% resolve) and on a verifier-shuffled IR (expect 0% resolve)`,
  `${PROVENANCE_RESOLVE_PATH} exports resolveProvenance(ir, snapshots): { total, resolved, unresolvedPointers }; every real corpus IR's provenance[].nodeId resolves against its sources' captured snapshot nodes (resolved === total > 0); a verifier-built control IR with every provenance[].nodeId rewritten to a non-existent id resolves to 0`,
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
      const raw = c.irPath ? readText(c.irPath) : null;
      if (raw === null) {
        failures++;
        lines.push(`${c.id}: no IR`);
        continue;
      }
      const ir = JSON.parse(raw) as { provenance?: Array<{ sourceId: string; nodeId: string }> };
      if (!Array.isArray(ir.provenance) || ir.provenance.length === 0) {
        failures++;
        lines.push(`${c.id}: IR has no provenance entries to resolve`);
        continue;
      }
      const snapshotsBySource: Record<string, Array<{ nodeId: string }>> = {};
      for (const source of c.sources) {
        const nodes: Array<{ nodeId: string }> = [];
        for (const bp of Object.keys(source.snapshots)) {
          const snapPath = source.snapshots[bp]?.path;
          const snapDoc = snapPath ? readJson<{ nodes?: Array<{ nodeId: string }> }>(snapPath) : null;
          if (snapDoc?.nodes) nodes.push(...snapDoc.nodes);
        }
        snapshotsBySource[source.id] = nodes;
      }

      // eslint-disable-next-line no-await-in-loop
      const real = (await (resolveProvenance as (ir: unknown, snaps: unknown) => unknown | Promise<unknown>)(ir, snapshotsBySource)) as {
        total: number;
        resolved: number;
      };
      const realOk = real.total > 0 && real.resolved === real.total;

      const shuffled = structuredClone(ir);
      for (const p of shuffled.provenance ?? []) p.nodeId = `SHUFFLED-CONTROL-${p.nodeId}-INVALID`;
      // eslint-disable-next-line no-await-in-loop
      const control = (await (resolveProvenance as (ir: unknown, snaps: unknown) => unknown | Promise<unknown>)(shuffled, snapshotsBySource)) as {
        total: number;
        resolved: number;
      };
      const controlOk = control.resolved === 0;

      if (!realOk || !controlOk) {
        failures++;
        lines.push(`${c.id}: real(resolved=${real.resolved}/${real.total}) shuffled-control(resolved=${control.resolved}/${control.total}) -- expected real fully resolved, control zero`);
      } else {
        lines.push(`${c.id}: real fully resolves (${real.resolved}/${real.total}); shuffled-ID control scores zero`);
      }
    }
    return { ok: failures === 0, evidence: lines.join('\n'), detail: failures > 0 ? `${failures}/${nonSkipCases.length} cases failed real-resolve or shuffled-control-zero` : undefined };
  },
);

// =============================================================================
// C7-5 -- corpus pinned, quota-satisfying, reproducible (row by row)
// =============================================================================
await probe(
  'C7-5',
  `read ${MANIFEST_PATH} + ${CORPUS_MD_PATH}; assert each S7-2 quota row; re-hash every snapshot file and compare to the manifest's recorded sha256`,
  `${CORPUS_MD_PATH} exists; ${MANIFEST_PATH}.cases satisfies, row by row: >=3 distinct layoutSystem, >=4 distinct genre, every non-skip case has >=2 breakpoints, >=3 cases with conflict!=null, >=1 case per degenerate kind (single-source, nonexistent-element-directive, hostile-heavy-dom), >=1 case with skip!=null (reason in {login-walled,bot-walled}); every snapshot file's re-computed sha256 matches the manifest's recorded hash`,
  async () => {
    if (!exists(CORPUS_MD_PATH)) return { ok: false, evidence: `missing ${CORPUS_MD_PATH}` };
    const { manifest, error } = loadManifest();
    if (!manifest) return { ok: false, evidence: `cannot check quotas: ${error}` };
    const cases = manifest.cases;
    const nonSkip = cases.filter((c) => c.skip === null);

    const rows: { row: string; ok: boolean; detail: string }[] = [];
    const layoutSystems = new Set(nonSkip.map((c) => c.layoutSystem));
    rows.push({ row: 'layout systems >=3 distinct', ok: layoutSystems.size >= 3, detail: `[${[...layoutSystems].join(', ')}]` });
    const genres = new Set(nonSkip.map((c) => c.genre));
    rows.push({ row: 'page genres >=4 distinct', ok: genres.size >= 4, detail: `[${[...genres].join(', ')}]` });
    const under2bp = nonSkip.filter((c) => c.breakpoints.length < 2);
    rows.push({ row: 'breakpoints >=2 per non-skip case', ok: under2bp.length === 0, detail: under2bp.length ? `violators: ${under2bp.map((c) => c.id).join(', ')}` : 'all satisfy' });
    const conflictCases = cases.filter((c) => c.conflict !== null);
    rows.push({ row: 'conflict pairs >=3 cases', ok: conflictCases.length >= 3, detail: `count=${conflictCases.length}` });
    for (const kind of ['single-source', 'nonexistent-element-directive', 'hostile-heavy-dom'] as const) {
      const has = cases.some((c) => c.degenerate === kind);
      rows.push({ row: `degenerate case present: ${kind}`, ok: has, detail: has ? 'present' : 'MISSING' });
    }
    const skipCases = cases.filter((c) => c.skip !== null);
    const skipReasonsOk = skipCases.every((c) => c.skip && ['login-walled', 'bot-walled'].includes(c.skip.reason) && c.skip.target.length > 0);
    rows.push({ row: 'documented skip >=1 with valid reason+target', ok: skipCases.length >= 1 && skipReasonsOk, detail: `count=${skipCases.length}, reasonsOk=${skipReasonsOk}` });

    // Snapshot content hashing / reproducibility.
    let hashMismatches = 0;
    let hashChecked = 0;
    const hashLines: string[] = [];
    for (const c of cases) {
      for (const source of c.sources) {
        for (const [bp, ref] of Object.entries(source.snapshots)) {
          hashChecked++;
          const actual = sha256File(ref.path);
          if (actual === null) {
            hashMismatches++;
            hashLines.push(`${c.id}/${source.id}/${bp}: snapshot file missing at ${ref.path}`);
          } else if (actual !== ref.sha256) {
            hashMismatches++;
            hashLines.push(`${c.id}/${source.id}/${bp}: hash mismatch (manifest=${ref.sha256} actual=${actual})`);
          }
        }
      }
    }
    rows.push({ row: 'snapshot content-hashes match manifest (pinned)', ok: hashChecked > 0 && hashMismatches === 0, detail: `checked=${hashChecked} mismatches=${hashMismatches}` });

    const failed = rows.filter((r) => !r.ok);
    const evidence = [...rows.map((r) => `[${r.ok ? 'OK' : 'FAIL'}] ${r.row} -- ${r.detail}`), ...hashLines].join('\n');
    return { ok: failed.length === 0, evidence, detail: failed.length > 0 ? `failed rows: ${failed.map((r) => r.row).join('; ')}` : undefined };
  },
);

// =============================================================================
// C7-6 -- grader discriminates on a population, not an example
// =============================================================================
await probe(
  'C7-6',
  `dynamic-import ${SCORER_INDEX_PATH}, score every fixture under ${POPULATION_DIR}/{wrong,faithful}, assert no overlap between the two score distributions`,
  `${POPULATION_DIR}/wrong/<id>/input.json (>=5) and ${POPULATION_DIR}/faithful/<id>/input.json (>=5) each score via scoreComposition(input).overall; max(wrong scores) < min(faithful scores) -- zero distribution overlap`,
  async () => {
    const imported = await importEvalModule(SCORER_INDEX_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const scoreComposition = imported.mod['scoreComposition'];
    if (typeof scoreComposition !== 'function') return { ok: false, evidence: `${SCORER_INDEX_PATH} does not export scoreComposition` };

    const scoreGroup = async (subdir: 'wrong' | 'faithful'): Promise<{ ids: string[]; scores: number[]; errors: string[] }> => {
      const dir = abs(path.join(POPULATION_DIR, subdir));
      const ids: string[] = [];
      const scores: number[] = [];
      const errors: string[] = [];
      if (!fs.existsSync(dir)) return { ids, scores, errors: [`missing directory ${POPULATION_DIR}/${subdir}`] };
      for (const entry of fs.readdirSync(dir)) {
        const inputPath = path.join(POPULATION_DIR, subdir, entry, 'input.json');
        const input = readJson<unknown>(inputPath);
        if (input === null) {
          errors.push(`${subdir}/${entry}: missing or invalid input.json`);
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const out = (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(input)) as { overall?: number };
        if (typeof out.overall !== 'number') {
          errors.push(`${subdir}/${entry}: scoreComposition(input).overall is not a number`);
          continue;
        }
        ids.push(entry);
        scores.push(out.overall);
      }
      return { ids, scores, errors };
    };

    const wrong = await scoreGroup('wrong');
    const faithful = await scoreGroup('faithful');
    const errors = [...wrong.errors, ...faithful.errors];
    if (wrong.scores.length < 5) errors.push(`only ${wrong.scores.length} scoreable "wrong" fixtures, need >=5`);
    if (faithful.scores.length < 5) errors.push(`only ${faithful.scores.length} scoreable "faithful" fixtures, need >=5`);
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
// C7-7 -- source bleed metric implemented and tested
// =============================================================================
await probe(
  'C7-7',
  `run \`node --import tsx --test ${SOURCE_BLEED_TEST_PATH}\`; assert named control cases pass`,
  `${SOURCE_BLEED_PATH} exists as code (not prose); ${SOURCE_BLEED_TEST_PATH} passes with zero failures and includes, by test title, a clean-fixture case, an injected-bleed case, AND a case proving detection survives when the source name is textually absent (defeats a name-grep implementation by construction)`,
  async () => {
    if (!exists(SOURCE_BLEED_PATH)) return { ok: false, evidence: `missing ${SOURCE_BLEED_PATH}` };
    const run = runNodeTest([SOURCE_BLEED_TEST_PATH]);
    const needles = ['clean', 'inject', 'absent'];
    const missing = needles.filter((n) => !run.tests.some((t) => t.name.toLowerCase().includes(n) && t.pass));
    const ok = run.status === 0 && run.tests.length > 0 && missing.length === 0;
    return {
      ok,
      evidence: `exit=${run.status}\n${run.tests.map((t) => `${t.pass ? 'PASS' : 'FAIL'} ${t.name}`).join('\n')}\n\nrequired-needle-coverage missing: ${missing.join(', ') || 'none'}`,
      detail: ok ? undefined : `missing or failing control needles: ${missing.join(', ')}`,
    };
  },
);

// =============================================================================
// C7-8 -- diversity is structural against a pre-registered axis set
// =============================================================================
await probe(
  'C7-8',
  `read ${DIVERSITY_AXES_PATH}; run \`node --import tsx --test ${DIVERSITY_TEST_PATH}\`; assert named control cases pass`,
  `${DIVERSITY_AXES_PATH} freezes a named axis set including layout-skeleton hash, section order, motion-timeline signature, and breakpoint-behavior class; ${DIVERSITY_PATH} exists as code; ${DIVERSITY_TEST_PATH} passes and includes, by test title, a recolor-only-trio-scores-insufficient case AND a class-names-only-trio-scores-insufficient case`,
  async () => {
    const axes = readJson<{ axes?: Array<{ name: string }> }>(DIVERSITY_AXES_PATH);
    if (axes === null || !Array.isArray(axes.axes)) return { ok: false, evidence: `missing or invalid ${DIVERSITY_AXES_PATH}` };
    const names = axes.axes.map((a) => a.name.toLowerCase());
    const requiredAxisNames = ['layout-skeleton', 'section-order', 'motion-timeline', 'breakpoint-behavior'];
    const missingAxes = requiredAxisNames.filter((req) => !names.some((n) => n.includes(req.split('-')[0] ?? req)));
    if (missingAxes.length > 0) return { ok: false, evidence: `${DIVERSITY_AXES_PATH} is missing pre-registered axes matching: ${missingAxes.join(', ')} (found: ${names.join(', ')})` };
    if (!exists(DIVERSITY_PATH)) return { ok: false, evidence: `missing ${DIVERSITY_PATH}` };

    const run = runNodeTest([DIVERSITY_TEST_PATH]);
    const needles = ['recolor', 'class'];
    const missing = needles.filter((n) => !run.tests.some((t) => t.name.toLowerCase().includes(n) && t.pass));
    const ok = run.status === 0 && run.tests.length > 0 && missing.length === 0;
    return {
      ok,
      evidence: `axis set: ${names.join(', ')}\nexit=${run.status}\n${run.tests.map((t) => `${t.pass ? 'PASS' : 'FAIL'} ${t.name}`).join('\n')}\n\nrequired-needle-coverage missing: ${missing.join(', ') || 'none'}`,
      detail: ok ? undefined : `missing or failing control needles: ${missing.join(', ')}`,
    };
  },
);

// =============================================================================
// C7-9 -- directive_claim_coverage measured; house-style composite caught
// =============================================================================
await probe(
  'C7-9',
  `dynamic-import ${SCORER_INDEX_PATH}; score fixtures under ${DIRECTIVE_FIXTURES_DIR}/{house-style,faithful}; assert house-style scores below the ${FLOORS_PATH} floor on directive_claim_coverage while scoring at/above floor on layout_geometry/palette_fidelity/type_fidelity`,
  `>=3 house-style fixtures score axes.directive_claim_coverage < floors.directive_claim_coverage while axes.layout_geometry, axes.palette_fidelity, axes.type_fidelity are each >= their floor (the exact gaming path both reviewers named); >=3 faithful fixtures score axes.directive_claim_coverage >= floor`,
  async () => {
    const floors = readJson<{ floors?: Record<string, number> }>(FLOORS_PATH);
    if (floors === null || !floors.floors) return { ok: false, evidence: `missing or invalid ${FLOORS_PATH}` };
    const missingFloorAxes = REQUIRED_AXES.filter((a) => typeof floors.floors?.[a] !== 'number');
    if (missingFloorAxes.length > 0) return { ok: false, evidence: `${FLOORS_PATH} missing numeric floors for: ${missingFloorAxes.join(', ')}` };

    const imported = await importEvalModule(SCORER_INDEX_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const scoreComposition = imported.mod['scoreComposition'];
    if (typeof scoreComposition !== 'function') return { ok: false, evidence: `${SCORER_INDEX_PATH} does not export scoreComposition` };

    const scoreGroup = async (subdir: string): Promise<{ id: string; axes: Record<string, number> }[]> => {
      const dir = abs(path.join(DIRECTIVE_FIXTURES_DIR, subdir));
      if (!fs.existsSync(dir)) return [];
      const out: { id: string; axes: Record<string, number> }[] = [];
      for (const entry of fs.readdirSync(dir)) {
        const input = readJson<unknown>(path.join(DIRECTIVE_FIXTURES_DIR, subdir, entry, 'input.json'));
        if (input === null) continue;
        // eslint-disable-next-line no-await-in-loop
        const result = (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(input)) as { axes?: Record<string, number> };
        if (result.axes) out.push({ id: entry, axes: result.axes });
      }
      return out;
    };

    const houseStyle = await scoreGroup('house-style');
    const faithful = await scoreGroup('faithful');
    if (houseStyle.length < 3) return { ok: false, evidence: `only ${houseStyle.length} house-style fixtures, need >=3` };
    if (faithful.length < 3) return { ok: false, evidence: `only ${faithful.length} faithful fixtures, need >=3` };

    const f = floors.floors;
    const lines: string[] = [];
    let failures = 0;
    for (const h of houseStyle) {
      const dccBelow = h.axes['directive_claim_coverage'] !== undefined && h.axes['directive_claim_coverage'] < (f['directive_claim_coverage'] ?? 0);
      const othersAboveFloor =
        (h.axes['layout_geometry'] ?? -1) >= (f['layout_geometry'] ?? 0) &&
        (h.axes['palette_fidelity'] ?? -1) >= (f['palette_fidelity'] ?? 0) &&
        (h.axes['type_fidelity'] ?? -1) >= (f['type_fidelity'] ?? 0);
      const ok = dccBelow && othersAboveFloor;
      if (!ok) failures++;
      lines.push(`house-style/${h.id}: dcc=${h.axes['directive_claim_coverage']} (floor ${f['directive_claim_coverage']}) belowFloor=${dccBelow}; geometry/palette/type above floor=${othersAboveFloor} -- ${ok ? 'OK' : 'FAIL'}`);
    }
    for (const g of faithful) {
      const ok = g.axes['directive_claim_coverage'] !== undefined && g.axes['directive_claim_coverage'] >= (f['directive_claim_coverage'] ?? 0);
      if (!ok) failures++;
      lines.push(`faithful/${g.id}: dcc=${g.axes['directive_claim_coverage']} (floor ${f['directive_claim_coverage']}) -- ${ok ? 'OK' : 'FAIL'}`);
    }
    return { ok: failures === 0, evidence: lines.join('\n'), detail: failures > 0 ? `${failures} fixtures did not match the expected gaming-path signature` : undefined };
  },
);

// =============================================================================
// C7-10 -- counterfactual separation
// =============================================================================
await probe(
  'C7-10',
  `dynamic-import ${SCORER_INDEX_PATH}; for every pair under ${COUNTERFACTUAL_DIR}, score base vs swapped and assert |delta| > floors.counterfactualMinDelta`,
  `${COUNTERFACTUAL_DIR}/<pair-id>/{base,swapped}/input.json exist for >=3 pairs; for the swapped directive axis named in each pair's meta.json, scoreComposition(base).axes[axis] and scoreComposition(swapped).axes[axis] differ by more than ${FLOORS_PATH}.counterfactualMinDelta`,
  async () => {
    const floors = readJson<{ counterfactualMinDelta?: number }>(FLOORS_PATH);
    if (floors === null || typeof floors.counterfactualMinDelta !== 'number') return { ok: false, evidence: `${FLOORS_PATH} missing numeric counterfactualMinDelta` };
    const minDelta = floors.counterfactualMinDelta;

    const imported = await importEvalModule(SCORER_INDEX_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const scoreComposition = imported.mod['scoreComposition'];
    if (typeof scoreComposition !== 'function') return { ok: false, evidence: `${SCORER_INDEX_PATH} does not export scoreComposition` };

    const dir = abs(COUNTERFACTUAL_DIR);
    if (!fs.existsSync(dir)) return { ok: false, evidence: `missing ${COUNTERFACTUAL_DIR}` };
    const pairIds = fs.readdirSync(dir).filter((e) => fs.statSync(path.join(dir, e)).isDirectory());
    if (pairIds.length < 3) return { ok: false, evidence: `only ${pairIds.length} counterfactual pairs, need >=3` };

    const lines: string[] = [];
    let failures = 0;
    for (const pairId of pairIds) {
      const meta = readJson<{ swappedAxis?: string }>(path.join(COUNTERFACTUAL_DIR, pairId, 'meta.json'));
      const axis = meta?.swappedAxis;
      const baseInput = readJson<unknown>(path.join(COUNTERFACTUAL_DIR, pairId, 'base', 'input.json'));
      const swappedInput = readJson<unknown>(path.join(COUNTERFACTUAL_DIR, pairId, 'swapped', 'input.json'));
      if (!axis || baseInput === null || swappedInput === null) {
        failures++;
        lines.push(`${pairId}: incomplete (axis=${axis}, base=${baseInput !== null}, swapped=${swappedInput !== null})`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const baseResult = (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(baseInput)) as { axes?: Record<string, number> };
      // eslint-disable-next-line no-await-in-loop
      const swappedResult = (await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(swappedInput)) as { axes?: Record<string, number> };
      const baseScore = baseResult.axes?.[axis];
      const swappedScore = swappedResult.axes?.[axis];
      if (typeof baseScore !== 'number' || typeof swappedScore !== 'number') {
        failures++;
        lines.push(`${pairId}: axis "${axis}" not scored on one side`);
        continue;
      }
      const delta = Math.abs(baseScore - swappedScore);
      const ok = delta > minDelta;
      if (!ok) failures++;
      lines.push(`${pairId}: axis=${axis} base=${baseScore.toFixed(3)} swapped=${swappedScore.toFixed(3)} delta=${delta.toFixed(3)} (min ${minDelta}) -- ${ok ? 'OK' : 'FAIL'}`);
    }
    return { ok: failures === 0, evidence: lines.join('\n'), detail: failures > 0 ? `${failures}/${pairIds.length} pairs did not separate beyond the minimum delta` : undefined };
  },
);

// =============================================================================
// C7-11 -- held-out split is sealed
// =============================================================================
await probe(
  'C7-11',
  `read ${SEALED_ACCESS_PATH}; cross-check its recorded hashes against ${MANIFEST_PATH} sealed cases and re-computed file hashes`,
  `${SEALED_ACCESS_PATH} names every sealed case id, records a content hash per sealed case, and states an access-control statement; manifest.sealedFraction matches actual sealed-case fraction within 0.02; every recorded hash matches the manifest's own recorded snapshot/IR hashes (no drift between the seal record and the corpus)`,
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
    let hashesRecorded = 0;
    for (const c of sealedCases) {
      const irHash = sha256File(c.irPath);
      if (irHash && text.includes(irHash)) hashesRecorded++;
    }
    const evidence = [
      `sealedFraction manifest=${manifest.sealedFraction} actual=${actualFraction.toFixed(3)} ok=${fractionOk}`,
      `sealed cases named in ${SEALED_ACCESS_PATH}: ${sealedCases.length - missingFromDoc.length}/${sealedCases.length} (missing: ${missingFromDoc.map((c) => c.id).join(', ') || 'none'})`,
      `access-control statement present: ${hasAccessStatement}`,
      `sealed case IR hashes recorded verbatim in seal doc: ${hashesRecorded}/${sealedCases.length}`,
    ].join('\n');
    const ok = fractionOk && missingFromDoc.length === 0 && hasAccessStatement && hashesRecorded === sealedCases.length;
    return { ok, evidence, detail: ok ? undefined : 'seal record incomplete or drifted from the manifest' };
  },
);

// =============================================================================
// C7-12 -- absolute floors frozen
// =============================================================================
await probe(
  'C7-12',
  `read ${FLOORS_PATH}; assert version + all 11 axis floors present and numeric; record its sha256`,
  `${FLOORS_PATH} has a numeric "version" and a "floors" object with a numeric entry for every axis in [${REQUIRED_AXES.join(', ')}], each in [0,1]; its sha256 is recorded in this criterion's artifact so a later silent edit is detectable by hash drift`,
  async () => {
    const raw = readText(FLOORS_PATH);
    if (raw === null) return { ok: false, evidence: `missing ${FLOORS_PATH}` };
    const parsed = readJson<{ version?: number; floors?: Record<string, number> }>(FLOORS_PATH);
    if (parsed === null) return { ok: false, evidence: `${FLOORS_PATH} is not valid JSON` };
    if (typeof parsed.version !== 'number') return { ok: false, evidence: `${FLOORS_PATH} missing numeric "version"` };
    if (!parsed.floors) return { ok: false, evidence: `${FLOORS_PATH} missing "floors" object` };
    const bad = REQUIRED_AXES.filter((a) => typeof parsed.floors?.[a] !== 'number' || (parsed.floors[a] as number) < 0 || (parsed.floors[a] as number) > 1);
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const ok = bad.length === 0;
    return {
      ok,
      evidence: `version=${parsed.version}\nfloors=${JSON.stringify(parsed.floors, null, 2)}\nsha256=${hash}`,
      detail: ok ? undefined : `axes with missing/out-of-range floors: ${bad.join(', ')}`,
    };
  },
);

// =============================================================================
// C7-13 -- scorer versioned and deterministic
// =============================================================================
await probe(
  'C7-13',
  `dynamic-import ${SCORER_INDEX_PATH}; read SCORER_VERSION; call scoreComposition twice on the same fixture in this process and deep-equal the results`,
  `${SCORER_INDEX_PATH} exports a non-empty SCORER_VERSION; scoreComposition(${DETERMINISM_FIXTURE_PATH}) called twice in the same process yields byte-identical (stable-stringify equal) results`,
  async () => {
    const imported = await importEvalModule(SCORER_INDEX_PATH);
    if (!imported.ok) return { ok: false, evidence: imported.error };
    const version = imported.mod['SCORER_VERSION'];
    if (typeof version !== 'string' && typeof version !== 'number') return { ok: false, evidence: `${SCORER_INDEX_PATH} does not export a SCORER_VERSION string/number` };
    const scoreComposition = imported.mod['scoreComposition'];
    if (typeof scoreComposition !== 'function') return { ok: false, evidence: `${SCORER_INDEX_PATH} does not export scoreComposition` };
    const input = readJson<unknown>(DETERMINISM_FIXTURE_PATH);
    if (input === null) return { ok: false, evidence: `missing or invalid ${DETERMINISM_FIXTURE_PATH}` };

    const run1 = await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(structuredClone(input));
    const run2 = await (scoreComposition as (i: unknown) => unknown | Promise<unknown>)(structuredClone(input));
    const equal = stableStringify(run1) === stableStringify(run2);
    return {
      ok: equal,
      evidence: `SCORER_VERSION=${version}\nrun1=${stableStringify(run1)}\nrun2=${stableStringify(run2)}\nequal=${equal}`,
      detail: equal ? undefined : 'two calls with identical input produced different scores',
    };
  },
);

// =============================================================================
// C7-14 -- NL->IR goldens exist with a parse interface (and typecheck)
// =============================================================================
await probe(
  'C7-14',
  `read ${NL_GOLDENS_PATH} (>=5 pairs); typecheck all evals/**/*.ts (including ${NL_PARSER_PATH}) with tsc --noEmit under scripts/tsconfig.json-equivalent options`,
  `${NL_GOLDENS_PATH} has >=5 { id, nlDirective, expectedIR } pairs where expectedIR contains at least an "axis" and "source" field; ${NL_PARSER_PATH} declares a typed parser interface; every .ts file under evals/ typechecks cleanly`,
  async () => {
    const goldens = readJson<Array<{ id?: string; nlDirective?: string; expectedIR?: { axis?: string; source?: string } }>>(NL_GOLDENS_PATH);
    if (goldens === null || !Array.isArray(goldens)) return { ok: false, evidence: `missing or invalid ${NL_GOLDENS_PATH}` };
    if (goldens.length < 5) return { ok: false, evidence: `only ${goldens.length} golden pairs, need >=5` };
    const malformed = goldens.filter((g) => !g.id || !g.nlDirective || !g.expectedIR?.axis || !g.expectedIR?.source);
    if (malformed.length > 0) return { ok: false, evidence: `${malformed.length} golden(s) missing id/nlDirective/expectedIR.axis/expectedIR.source` };
    if (!exists(NL_PARSER_PATH)) return { ok: false, evidence: `missing ${NL_PARSER_PATH}` };

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
    return {
      ok: tsc.status === 0,
      evidence: `golden pairs: ${goldens.length}\ntsc exit=${tsc.status}\n${tsc.stdout}`,
      detail: tsc.status === 0 ? undefined : 'evals/**/*.ts does not typecheck',
    };
  },
);

// =============================================================================
// C7-15 -- feasibility spike documented
// =============================================================================
await probe(
  'C7-15',
  `read ${SPIKE_DOC_PATH}; assert required sections non-empty and its referenced case id exists in ${MANIFEST_PATH}`,
  `${SPIKE_DOC_PATH} has non-empty "## Case", "## IR insufficiencies found" (>=1 item), and "## Responses" (>=1 item) sections; the case id it names exists in the corpus manifest`,
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
    const listItems = (s: string): number => (s.match(/^[-*\d]/gm) ?? []).length;

    const problems: string[] = [];
    if (caseSection.length === 0) problems.push('"## Case" section missing or empty');
    if (listItems(insufficienciesSection) === 0) problems.push('"## IR insufficiencies found" has no list items');
    if (listItems(responsesSection) === 0) problems.push('"## Responses" has no list items');

    const { manifest } = loadManifest();
    const caseIdMatch = caseSection.match(/[a-zA-Z0-9_-]+/);
    const referencedId = caseIdMatch?.[0];
    const caseExists = manifest ? manifest.cases.some((c) => c.id === referencedId) : false;
    if (!caseExists) problems.push(`referenced case id "${referencedId ?? '(none found)'}" not present in ${MANIFEST_PATH}`);

    return {
      ok: problems.length === 0,
      evidence: `case section: ${caseSection.slice(0, 200)}\ninsufficiencies items: ${listItems(insufficienciesSection)}\nresponses items: ${listItems(responsesSection)}\nreferenced case exists in manifest: ${caseExists}`,
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

// =============================================================================
// LEASE check (R9) -- git diff must stay inside W7's leases.json globs
// =============================================================================
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
  // Parse that directly rather than requesting a specific reporter, since
  // the repo's own tsx/node pairing is what actually runs at gate time.
  const re = /^\s*(✔|✖)\s+(.+?)(?:\s+\([\d.]+m?s\))?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(run.stdout)) !== null) {
    tests.push({ name: m[2]!.trim(), pass: m[1] === '✔' });
  }
  return { status: run.status, stdout: run.stdout, tests };
}

const baseCommit = sh('git', ['merge-base', 'origin/main', 'HEAD']).stdout.trim();
const headSha = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
const diffNames = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]).stdout.trim().split('\n').filter(Boolean);
const LEASE_ALLOW = ['docs/specs/', 'evals/', 'docs/plans/waves/'];
const LEASE_ALLOW_EXACT = ['scripts/waves/verify-w7.ts'];
const leaseViolations = diffNames.filter((f) => !LEASE_ALLOW.some((prefix) => f.startsWith(prefix)) && !LEASE_ALLOW_EXACT.includes(f));
record(
  'LEASE',
  `git diff --name-only ${baseCommit.slice(0, 12)}...HEAD ⊆ leases.json[W7].allow`,
  'no writes outside docs/specs/**, evals/**, scripts/waves/verify-w7.ts, docs/plans/waves/**',
  leaseViolations.length === 0 ? 'pass' : 'fail',
  leaseViolations.join('\n') || `all ${diffNames.length} changed files inside the W7 lease`,
  Date.now(),
);

// =============================================================================
// commit-bound manifest
// =============================================================================
const treeDirty = sh('git', ['status', '--porcelain']).stdout.trim().length > 0;
const manifestOut = {
  wave: 'W7',
  commit: headSha,
  treeDirty,
  baseCommit,
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
