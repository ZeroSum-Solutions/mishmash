// verify-w10b.ts -- wave mishmash-w10b-voicebox (VoiceBox MCP registration)
// completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w10b.ts [--repo <path>]
// Exit 0 only when C10B-1 through C10B-5 all pass AND the tree is clean
// (treeDirty: false) AND the infra checks (LEASE, GATE-INTEGRITY,
// SCANNER-SELFTEST, HEAD-DRIFT) pass. The commit-bound proof manifest is
// written to the wave's goal-state proof directory either way, per
// docs/plans/waves/W10b-voicebox-registration.md's "Definition of green".
//
// ROUND-3 ADVERSARIAL REVIEW (founder-authorized final round, three closures
// -- see the PRD's "Round 3 adversarial review" section for full detail):
//
//   1. DEEP SPREAD BAN. Round 2 showed a complete false-green: a type-valid
//      object literal with the frozen direct properties (id/label/url/...)
//      followed by `...evilOverride` -- at runtime the spread silently wins
//      (JS last-write-wins), but `findStringProp`'s first-match walk over
//      `.properties` returned the frozen-looking literal and never noticed.
//      `findDeepStructuralAnomalies()` now walks the ENTIRE MCP_TEMPLATES
//      subtree (every object literal, at every nesting depth, including
//      inside array-valued fields like a hypothetical `headerFields`) and
//      fails closed on anything that is not a plain `key: <literal>`
//      PropertyAssignment: SpreadAssignment (object spread), SpreadElement
//      (array spread), a computed/non-literal property name, a method/
//      getter/setter object member, or a duplicate property name within one
//      object literal. The last three are the same vulnerability class as
//      the spread (a later property silently overrides an earlier
//      frozen-looking one at runtime, invisible to a first-match extractor)
//      and are closed by the same mechanism, not left as an adjacent gap
//      right next to the one just fixed.
//   2. SCANNER FIX. Round 2 found that raw `scanner.scan()` calls, without
//      tracking template-substitution context, misclassified text INSIDE a
//      template literal's tail as a real comment once a `${...}`
//      substitution was involved (e.g. `` `${0}// NM-25` ``). Manually
//      reimplementing the stateful re-scan the TypeScript parser does
//      internally (`reScanTemplateToken`) is exactly the kind of thing that
//      is easy to get subtly wrong twice. Instead, `collectComments()` now
//      trusts the ALREADY-CORRECT parser: it walks the parsed AST to record
//      the exact `[start,end)` span of every string/template-piece/regex
//      literal token (the parser resolved template boundaries correctly,
//      substitutions and all -- that is the one thing a hand-rolled scanner
//      loop cannot be trusted to redo), then finds `//`/`/* */`-shaped text
//      in the raw source with a simple regex and discards any match whose
//      start falls inside one of those literal spans. A comment-like
//      sequence can only ever be a real comment if it sits OUTSIDE every
//      literal the parser found. `SCANNER-SELFTEST` below is the
//      template-heavy fixture proving this against the exact two round-2
//      false-positive cases, plus positive/negative controls.
//   3. GATE-INTEGRITY. Round 2: the lease already keeps this file out of the
//      implementer's diff (see finding 1's round-1 fix), but that is a
//      single control, not defense in depth, and the review wanted the same
//      external-immutability shape scripts/waves/verify-w9-ingest.ts already
//      uses. `GATE-INTEGRITY` below self-hashes the file currently
//      executing and compares it against an orchestrator-placed
//      `~/.claude/goal-state/mishmash-w10b-voicebox/approved-gate.sha256` --
//      present only once the orchestrator pins this exact frozen copy.
//      Unpinned (the state before that happens, including every run in this
//      authoring session) passes with `gateIntegrityPinned: false` recorded
//      in the manifest; pinned, it must match exactly. This is explicitly
//      defense in depth, not the PRIMARY control -- the primary control
//      remains C10B-3's lease-subset check, which already keeps this file
//      out of the implementer's own diff. Per the founder's round-3
//      instruction, the proposed lease's `deny` list also now names both
//      this file and the PRD explicitly (see the PRD's "Proposed write
//      lease"), and C10B-3 mechanically checks that `deny` list too.
//
// ROUND-4 (founder-authorized final round, after round 3 REJECTED -- see the
// PRD's "Round 3 verdict" and "Round 4 fix" sections for full detail):
//
//   RUNTIME-IMPORT VERIFICATION. Round 3's REJECT vector: a `__proto__: {
//   toJSON: () => (...) }` property assignment is a uniquely-named
//   PropertyAssignment, so round 3's `findDeepStructuralAnomalies` (an AST
//   shape scan) accepted it, every direct-property FROZEN comparison matched
//   (the frozen-looking fields were still present as OWN properties), and
//   `tsc` was clean -- yet `JSON.stringify` emits different, attacker-
//   chosen values, because a literal `__proto__: value` property in an
//   object literal is special-cased by the ECMAScript grammar (Annex
//   B.3.1) to set the object's [[Prototype]] instead of creating an own
//   property, and `JSON.stringify` (exactly what Express's `res.json` in
//   apps/daemon/src/mcp-routes.ts:151 uses to serve `MCP_TEMPLATES`) calls
//   an INHERITED `toJSON` exactly like an own one. No amount of naming more
//   forbidden AST shapes closes this class -- the founder's ruling was
//   explicit: stop patching source-shape denylists and instead prove the
//   frozen expectations against ACTUAL RUNTIME BEHAVIOR.
//
//   C10B-1/2/4 now dynamically `import()` a throwaway copy of HEAD's
//   committed `apps/daemon/src/mcp-config.ts` as a REAL ES module (see
//   `importRealTemplatesAtHead()`), locate the runtime array element whose
//   real `.id` property equals `'voicebox'`, and round-trip it through
//   `JSON.stringify`/`JSON.parse` -- the exact transform `res.json`
//   performs -- before comparing against `FROZEN`. This closes the ENTIRE
//   class by construction, not by enumerating more forbidden shapes:
//   `__proto__`/inherited `toJSON`, an own `toJSON` method, getters/
//   accessors, a property spread overriding earlier fields (the round-2
//   vector), `Object.defineProperty`/`Object.setPrototypeOf` mutations
//   anywhere in the module's top-level code, and a dead-branch conditional
//   that resolves differently than it appears to a source reader are ALL
//   observed as whatever they actually evaluate to, because nothing here
//   inspects source shape for these checks anymore -- only the real,
//   fully-evaluated, actually-serialized value is. `RUNTIME-SELFTEST`
//   (new infra check, mirroring `SCANNER-SELFTEST`'s pattern) proves this
//   against eight synthetic fixtures, including the exact round-3 vector.
//
//   `findDeepStructuralAnomalies()` (the round-3 object-literal-internal
//   spread/computed-key/duplicate-key/accessor scan) and `hasOwnProp()`
//   (used only for the old static `headerFields`-absence check) are REMOVED
//   as redundant: both existed solely to protect a static, first-match
//   property reader from exactly the class of divergence the runtime check
//   now observes directly and unconditionally. Keeping them would mean two
//   sources of truth for the same fact, one of which (the AST scan) is
//   demonstrably incomplete. `analyzeTemplateArray`'s array-level checks
//   (every element is a plain object literal, has a literal string `id`, no
//   duplicate `id` across the array) are KEPT -- they answer a genuinely
//   different, structural-only question with no runtime equivalent: "which
//   array slots, identified by source text, correspond to which ids, for
//   C10B-3's baseCommit-vs-HEAD byte-diffing." That fact is inherently
//   about a two-commit TEXT comparison, not about what a single commit's
//   code evaluates to, so it stays an AST/text check by necessity (the
//   founder's carve-out: "a structural/AST check may remain only for facts
//   with no runtime observable").
//
// Prior rounds (1, 2, and 3) are recorded in the PRD's "Round 1/2/3
// adversarial review" and "Round 3 verdict" sections; this header covers
// only what changed in round 4.
//
// Scope note: C10B-3 still never imports apps/daemon/src/mcp-config.ts live
// for its baseCommit-side analysis -- it reads both baseCommit's and HEAD's
// text via `git show` and parses each with the TypeScript compiler API,
// matching the pattern in scripts/waves/verify-w9-ingest.ts. Only C10B-1/2/4
// (and RUNTIME-SELFTEST's synthetic fixtures) perform a real dynamic
// `import()`, and only of HEAD's content, materialized into a throwaway
// temp file first (see `importRealTemplatesAtHead()`) -- never a live import
// of the file at its real repository path, so this stays independent of
// `apps/daemon`'s own module-resolution/build graph across `--repo`.
//
// PORTABILITY: repoRoot comes from `process.cwd()`/`--repo`, never
// `import.meta.url`.
//
// RUNTIME SAFETY: this verifier spawns no daemon and binds no port. The
// round-4 dynamic imports load `apps/daemon/src/mcp-config.ts`'s content
// directly (confirmed this session: it imports only `node:fs/promises`,
// `node:fs`, `node:crypto`, `node:path`, and performs no filesystem/network
// I/O or config-directory resolution at module-evaluation time -- every
// data-directory/port-touching call lives inside a function body, never at
// top level) -- so importing it is exactly as safe as any other in-process
// TypeScript parsing this file already does, and never touches a
// default-namespace daemon (ports 7456/51012) because it never starts one.
// Git context is resolved from local refs only (no fetch/push). This file
// never writes generated script content -- only `manifest.json`, plain-text
// proof artifacts under `proofDir`, and throwaway temp files under the OS
// temp directory that are deleted immediately after each import -- so there
// is nothing here for `node --check` to validate.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type TypeScriptModule from 'typescript';
import type {
  ArrayLiteralExpression,
  Node as TsNode,
  ObjectLiteralExpression,
  SourceFile,
} from 'typescript';

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx === -1 ? undefined : argv[idx + 1];
}

const WAVE_SLUG = 'mishmash-w10b-voicebox';
const TEMPLATE_FILE = 'apps/daemon/src/mcp-config.ts';

// -------------------------------------------------------------------------
// Frozen fields (round-1 finding 4 fix, unchanged in round 3). Copied
// verbatim from the PRD's "Implementation surface" code block -- kept in
// exact byte sync with that file by hand, since neither file may depend on
// the other at runtime (portability; see header). Any wording change to the
// registered template requires updating BOTH the PRD and this file,
// together, in one commit.
// -------------------------------------------------------------------------
const FROZEN = {
  id: 'voicebox',
  label: 'VoiceBox',
  description:
    'Local text-to-speech and voice-cloning MCP from your local VoiceBox app (jamiepine/voicebox on GitHub -- Tauri + Bun + Python, unrelated to the Meta Voicebox research model). Exposes voicebox.speak (speak text in a cloned or preset voice profile), plus voicebox.transcribe, voicebox.list_captures and voicebox.list_profiles. Requires the VoiceBox app running locally on 127.0.0.1:17493 -- this only connects to it; Open Design does not install, launch, or manage it.',
  example: 'Speak "Build complete." using my default VoiceBox voice profile.',
  homepage: 'https://github.com/jamiepine/voicebox',
  transport: 'http',
  authMode: 'none',
  category: 'utilities',
  url: 'http://127.0.0.1:17493/mcp',
} as const;

function emergencyExit(errorMessage: string): never {
  try {
    const manifest = {
      wave: 'W10b',
      commit: 'unknown',
      treeDirty: true,
      baseCommit: 'unknown',
      gateIntegrityPinned: false,
      toolchain: { node: process.version, pnpm: 'unknown' },
      criteria: [
        {
          id: 'INIT-FAILURE',
          command: 'module init',
          assertion: 'the verifier can initialize before any criterion runs',
          artifact: null,
          artifactSha256: null,
          exitCode: 1,
          status: 'fail',
          durationMs: 0,
          detail: errorMessage,
        },
      ],
    };
    fs.writeFileSync(
      path.join(os.tmpdir(), 'verify-w10b-emergency-manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
  } catch {
    /* truly nothing more we can do */
  }
  console.error(`verify-w10b: FATAL during init: ${errorMessage}`);
  process.exit(1);
}

let repoRoot: string;
let proofDir: string;
let ts: typeof TypeScriptModule;
try {
  repoRoot = path.resolve(argValue('--repo') ?? process.cwd());
  proofDir = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'proof');
  fs.mkdirSync(proofDir, { recursive: true });
  ts = createRequire(path.join(repoRoot, 'package.json'))('typescript');
} catch (err) {
  emergencyExit(`init failed: ${String((err as Error)?.stack ?? err)}`);
}

function sh(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 30_000,
  });
  if (result.error) {
    return {
      status: 1,
      stdout: result.stdout ?? '',
      stderr: `${result.stderr ?? ''}\n${String(result.error)}`,
    };
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function sha256Bytes(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function sha256File(absPath: string): string {
  return sha256Bytes(fs.readFileSync(absPath));
}

interface CriterionResult {
  id: string;
  command: string;
  assertion: string;
  artifact: string | null;
  artifactSha256: string | null;
  exitCode: number;
  status: 'pass' | 'fail';
  durationMs: number;
  detail?: string | undefined;
}

const results: CriterionResult[] = [];

function artifactFor(
  id: string,
  content: string,
): { artifact: string | null; artifactSha256: string | null } {
  const primary = path.join(proofDir, `${id}.txt`);
  const tryWrite = (target: string): { artifact: string; artifactSha256: string } | null => {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      return { artifact: target, artifactSha256: sha256Bytes(fs.readFileSync(target)) };
    } catch {
      return null;
    }
  };
  const primaryResult = tryWrite(primary);
  if (primaryResult) return primaryResult;
  const fallbackResult = tryWrite(
    path.join(os.tmpdir(), 'verify-w10b-fallback-proof', `${id}.txt`),
  );
  if (fallbackResult) return fallbackResult;
  console.error(`verify-w10b: artifact write failed for ${id} on both primary and fallback paths`);
  return { artifact: null, artifactSha256: null };
}

function record(
  id: string,
  command: string,
  assertion: string,
  ok: boolean,
  evidence: string,
  opts: { detail?: string | undefined; durationMs?: number } = {},
): void {
  try {
    const { artifact, artifactSha256 } = artifactFor(
      id,
      `# ${id}\n# assertion: ${assertion}\n# verdict: ${ok ? 'pass' : 'fail'}\n${
        opts.detail ? `# detail: ${opts.detail}\n` : ''
      }\n${evidence}\n`,
    );
    const effectiveOk = ok && artifact !== null;
    results.push({
      id,
      command,
      assertion,
      artifact,
      artifactSha256,
      exitCode: effectiveOk ? 0 : 1,
      status: effectiveOk ? 'pass' : 'fail',
      durationMs: opts.durationMs ?? 0,
      detail:
        artifact === null
          ? `${opts.detail ? `${opts.detail}; ` : ''}artifact write failed -- forced fail`
          : opts.detail,
    });
  } catch (err) {
    results.push({
      id,
      command,
      assertion,
      artifact: null,
      artifactSha256: null,
      exitCode: 1,
      status: 'fail',
      durationMs: opts.durationMs ?? 0,
      detail: `record() itself failed: ${String(err)}`,
    });
  }
}

async function checkCriterion(id: string, fn: () => Promise<void> | void): Promise<void> {
  const startedAt = Date.now();
  const startIndex = results.length;
  try {
    await fn();
    const durationMs = Date.now() - startedAt;
    for (let i = startIndex; i < results.length; i++) {
      const r = results[i];
      if (r) r.durationMs = durationMs;
    }
  } catch (err) {
    record(id, '', '', false, String((err as Error)?.stack ?? err), {
      detail: `criterion check crashed: ${String(err)}`,
      durationMs: Date.now() - startedAt,
    });
  }
}

// ---------------------------------------------------------------------
// Git context -- local refs only, no fetch/push.
// ---------------------------------------------------------------------
function gitOrFail(args: string[], why: string): string {
  const r = sh('git', args);
  if (r.status !== 0 || r.stdout.trim().length === 0) {
    throw new Error(
      `git ${args.join(' ')} failed (${why}): exit=${r.status} stdout=${
        r.stdout.trim().slice(0, 200) || '<empty>'
      }`,
    );
  }
  return r.stdout.trim();
}
function resolveMainRefLocal(): string {
  for (const ref of ['origin/main', 'main']) {
    const verify = sh('git', ['rev-parse', '--verify', ref]);
    if (verify.status === 0 && verify.stdout.trim()) return ref;
  }
  throw new Error(
    'could not resolve "origin/main" or "main" locally (no network ref-check -- this verifier never fetches)',
  );
}
function writeEmergencyManifest(errorMessage: string, partialResults: CriterionResult[] = []): void {
  const manifest = {
    wave: 'W10b',
    commit: 'unknown',
    treeDirty: true,
    baseCommit: 'unknown',
    gateIntegrityPinned: false,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: [
      ...partialResults,
      {
        id: 'GIT-RESOLUTION',
        command: 'git rev-parse HEAD / git merge-base',
        assertion: 'HEAD and baseCommit resolve to real, non-empty commits before any criterion runs',
        artifact: null,
        artifactSha256: null,
        exitCode: 1,
        status: 'fail',
        durationMs: 0,
        detail: errorMessage,
      },
    ],
  };
  let wrote = false;
  try {
    fs.mkdirSync(proofDir, { recursive: true });
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, path.join(proofDir, 'manifest.json'));
    wrote = true;
  } catch {
    /* fall through to guarded fallback */
  }
  if (!wrote) {
    try {
      fs.writeFileSync(
        path.join(os.tmpdir(), 'verify-w10b-emergency-manifest.json'),
        JSON.stringify(manifest, null, 2),
      );
    } catch {
      /* last resort: stderr only */
    }
  }
  console.error(`verify-w10b: FATAL, emergency manifest written=${wrote}: ${errorMessage}`);
}
function resolveGitContextOrExit(): { headSha: string; baseCommit: string } {
  try {
    const resolvedHeadSha = gitOrFail(['rev-parse', 'HEAD'], 'resolving HEAD commit');
    const mainRef = resolveMainRefLocal();
    const mainSha = gitOrFail(['rev-parse', mainRef], 'resolving main ref');
    const resolvedBaseCommit = gitOrFail(['merge-base', mainSha, resolvedHeadSha], 'computing baseCommit');
    return { headSha: resolvedHeadSha, baseCommit: resolvedBaseCommit };
  } catch (err) {
    writeEmergencyManifest(String((err as Error)?.stack ?? err));
    process.exit(1);
  }
}
const { headSha, baseCommit } = resolveGitContextOrExit();

const gateIntegrityPinned = fs.existsSync(
  path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'approved-gate.sha256'),
);

function readFileAtCommit(commit: string, relPath: string): string | null {
  const r = sh('git', ['show', `${commit}:${relPath}`]);
  if (r.status !== 0) return null;
  return r.stdout;
}

// ---------------------------------------------------------------------
// AST analysis over apps/daemon/src/mcp-config.ts's MCP_TEMPLATES array.
// Read-as-text + TypeScript compiler API -- never a live import of daemon
// source (see header note).
// ---------------------------------------------------------------------
interface TemplateBlock {
  id: string;
  rawText: string; // exact source text of the object literal, trimmed
}

interface ArrayScan {
  file: SourceFile;
  arrayNode: ArrayLiteralExpression;
  /** Non-empty means the array could NOT be safely reasoned about BY ID
   * (round-1 finding 3): a spread/call/other non-object-literal element, an
   * object literal with no plain string-literal `id`, or a duplicate `id`
   * across the array. This is a purely structural, text-identification fact
   * -- "which array slots correspond to which ids" -- used ONLY by C10B-3's
   * baseCommit-vs-HEAD byte-diffing, which has no runtime equivalent (it is
   * inherently a two-commit TEXT comparison; see the header's round-4 note).
   * It is deliberately NOT used to validate the frozen fields of the
   * `voicebox` entry itself -- as of round 4, that is proven at runtime (see
   * `importRealTemplatesAtHead()` / `serializeAsWireWould()` below), which is
   * why the round-3 per-object deep-anomaly scan (spread/computed-key/
   * duplicate-key/accessor INSIDE one object literal) was removed rather
   * than kept alongside the runtime check as a second source of truth. Every
   * consumer below must check this is empty before trusting `clean`. */
  problems: string[];
  /** One block per id, populated only when `problems` is empty. */
  clean: Map<string, TemplateBlock> | null;
}

function locateTemplateArray(
  sourceText: string,
  syntheticFileName: string,
): { file: SourceFile; arrayNode: ArrayLiteralExpression } | null {
  const sourceFile = ts.createSourceFile(syntheticFileName, sourceText, ts.ScriptTarget.Latest, true);
  let found: ArrayLiteralExpression | null = null;
  const visit = (node: TsNode): void => {
    if (found) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'MCP_TEMPLATES' &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!found) return null;
  // Explicit assertion, not a narrowed read: `found` is assigned inside the
  // `visit` closure above, and TS does not reliably narrow a `let` binding's
  // type across a closure boundary. `visit(sourceFile)` has already returned
  // synchronously by this point, so the null check above is a real runtime
  // guarantee even though TS can't see it that way.
  return { file: sourceFile, arrayNode: found as ArrayLiteralExpression };
}

function findStringProp(
  obj: ObjectLiteralExpression,
  sourceFile: SourceFile,
  name: string,
): string | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!ts.isIdentifier(prop.name) || prop.name.text !== name) continue;
    const init = prop.initializer;
    if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return init.text;
    return undefined; // present but not a plain string literal -- caller treats as absent
  }
  return undefined;
}

function shortText(sourceFile: SourceFile, node: TsNode): string {
  return node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 100);
}

// NOTE (round 4): `findDeepStructuralAnomalies()` and `hasOwnProp()` --
// round 3's per-object-literal spread/computed-key/duplicate-key/accessor
// scan, and the static `headerFields`-presence check it protected -- were
// REMOVED here. Both existed only to defend a static, first-match property
// reader (`findStringProp`, still below, now used solely for `id`) against
// exactly the class of divergence round 3's REJECT demonstrated it cannot
// fully enumerate (`__proto__`/inherited `toJSON`). C10B-1/2/4 now prove the
// frozen fields against the real, imported, fully-evaluated runtime value
// instead (see `importRealTemplatesAtHead()` / `serializeAsWireWould()` /
// `compareFrozenFields()` below) -- keeping the AST scan alongside that
// would be a second, weaker source of truth for the same fact, which the
// founder's round-4 ruling was explicit should not happen.

function analyzeTemplateArray(sourceText: string, syntheticFileName: string): ArrayScan | null {
  const located = locateTemplateArray(sourceText, syntheticFileName);
  if (!located) return null;
  const { file, arrayNode } = located;
  const problems: string[] = [];
  const byId = new Map<string, TemplateBlock[]>();

  for (const element of arrayNode.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      problems.push(
        `MCP_TEMPLATES element is not a plain object literal (SyntaxKind=${ts.SyntaxKind[element.kind]}): ${shortText(file, element)}`,
      );
      continue;
    }
    const id = findStringProp(element, file, 'id');
    if (id === undefined) {
      problems.push(
        `object literal in MCP_TEMPLATES has no plain string-literal 'id' property: ${shortText(file, element)}`,
      );
      continue;
    }
    const block: TemplateBlock = { id, rawText: element.getText(file).trim() };
    const list = byId.get(id);
    if (list) list.push(block);
    else byId.set(id, [block]);
  }

  for (const [id, list] of byId) {
    if (list.length > 1) {
      problems.push(`duplicate MCP_TEMPLATES id '${id}' appears ${list.length} times`);
    }
  }

  const clean =
    problems.length === 0
      ? new Map(
          [...byId.entries()].map(([id, list]) => {
            const first = list[0];
            if (!first) throw new Error(`unreachable: byId group for '${id}' was empty`);
            return [id, first] as const;
          }),
        )
      : null;

  return { file, arrayNode, problems, clean };
}

/** Everything in the file's own text OUTSIDE the array literal's span (round-1
 * finding 2): required to be byte-identical across baseCommit/HEAD so a new
 * export, function, import, or any other surface elsewhere in the same file
 * cannot pass as part of "one additive change." */
function splitAroundArray(
  sourceText: string,
  scan: ArrayScan,
): { before: string; after: string } {
  const start = scan.arrayNode.getStart(scan.file);
  const end = scan.arrayNode.getEnd();
  return { before: sourceText.slice(0, start), after: sourceText.slice(end) };
}

// ---------------------------------------------------------------------
// RUNTIME-IMPORT VERIFICATION (round 4 -- see the header's "ROUND-4" note
// for the full rationale). C10B-1/2/4 no longer trust a static AST read for
// the frozen fields of the `voicebox` entry; they import the REAL module and
// observe what it actually evaluates to and actually serializes.
// ---------------------------------------------------------------------
interface RuntimeImportResult {
  ok: boolean;
  templates?: unknown[];
  error?: string;
}

/** Materializes HEAD's committed text for TEMPLATE_FILE into a throwaway
 * `.mts` file (the `.mts` extension forces ESM regardless of any nearby
 * package.json, since the temp directory has none of its own) and
 * dynamically `import()`s it as a REAL module -- the same module
 * apps/daemon/src/mcp-routes.ts imports and re-exports through
 * `res.json({ servers: cfg.servers, templates: MCP_TEMPLATES })`
 * (mcp-routes.ts:151). Confirmed this session: TEMPLATE_FILE's only imports
 * are `node:fs/promises`, `node:fs`, `node:crypto`, and `node:path` -- no
 * workspace-package resolution needed, no I/O or port binding at
 * module-evaluation time -- so this import is safe to perform from a
 * throwaway path outside the real repository layout, and never touches a
 * daemon or a port (see header "RUNTIME SAFETY"). A fresh cache-busted
 * import every call (`?bust=<hrtime>`), matching this file's existing
 * "every criterion independently re-reads/re-scans, never shares state
 * across criteria" principle (see the comment above `main()`'s criteria). */
async function importRealTemplatesAtHead(): Promise<RuntimeImportResult> {
  const headText = readFileAtCommit(headSha, TEMPLATE_FILE);
  if (headText === null) return { ok: false, error: `${TEMPLATE_FILE} does not exist at HEAD` };
  return importTemplatesModuleFromSource(headText, `HEAD's ${TEMPLATE_FILE}`);
}

/** Shared by `importRealTemplatesAtHead()` and `RUNTIME-SELFTEST`'s
 * synthetic fixtures -- both need "write this exact source text to a
 * throwaway `.mts` file, import it fresh, hand back its `MCP_TEMPLATES`
 * export" and must go through the identical mechanism for the selftest to
 * actually prove anything about the real path. */
async function importTemplatesModuleFromSource(
  sourceText: string,
  label: string,
): Promise<RuntimeImportResult> {
  let tmpDir: string | null = null;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-w10b-runtime-'));
    const tmpFile = path.join(tmpDir, 'mcp-config.mts');
    fs.writeFileSync(tmpFile, sourceText);
    const url = `${pathToFileURL(tmpFile).href}?bust=${process.hrtime.bigint()}`;
    const mod = (await import(url)) as { MCP_TEMPLATES?: unknown };
    if (!Array.isArray(mod.MCP_TEMPLATES)) {
      return {
        ok: false,
        error: `${label}'s MCP_TEMPLATES export is not an array (got ${typeof mod.MCP_TEMPLATES})`,
      };
    }
    return { ok: true, templates: mod.MCP_TEMPLATES };
  } catch (err) {
    return { ok: false, error: `dynamic import of ${label} failed: ${String((err as Error)?.stack ?? err)}` };
  } finally {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup, never fails the check */
      }
    }
  }
}

/** Finds every runtime array element whose real `.id` property (ordinary JS
 * property access -- follows the prototype chain exactly like any other
 * reader, including apps/daemon/src/mcp-routes.ts) equals 'voicebox'. */
function findVoiceboxRuntimeEntries(templates: unknown[]): unknown[] {
  return templates.filter(
    (t) => t !== null && typeof t === 'object' && (t as Record<string, unknown>)['id'] === 'voicebox',
  );
}

/** Round-trips `entry` through the exact transformation Express's `res.json`
 * performs: `JSON.stringify`, then whatever a wire client would
 * `JSON.parse` back. This is precisely what makes a `__proto__`/inherited-
 * `toJSON`/accessor/`defineProperty` trick visible -- `JSON.stringify`
 * resolves an inherited `toJSON` exactly like an own one and REPLACES the
 * entire serialized value with its return, discarding whatever the object's
 * own properties looked like to a static reader. */
function serializeAsWireWould(entry: unknown): { value: Record<string, unknown> | null; problem?: string } {
  let json: string | undefined;
  try {
    json = JSON.stringify(entry);
  } catch (err) {
    return { value: null, problem: `JSON.stringify(entry) threw: ${String(err)}` };
  }
  if (json === undefined) {
    return { value: null, problem: 'JSON.stringify(entry) returned undefined -- entry serializes to nothing' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { value: null, problem: `JSON.parse(JSON.stringify(entry)) threw: ${String(err)}` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { value: null, problem: `serialized entry is not a plain object: ${json}` };
  }
  return { value: parsed as Record<string, unknown> };
}

/** Compares the actually-served (wire-serialized) shape of the voicebox
 * entry against FROZEN, restricted to `fields`. Empty return = exact match:
 * every named field is present with a value strictly equal to FROZEN's. */
function compareFrozenFields(
  wireShape: Record<string, unknown>,
  fields: readonly (keyof typeof FROZEN)[],
): string[] {
  const problems: string[] = [];
  for (const field of fields) {
    const actual = wireShape[field];
    const expected = FROZEN[field];
    if (actual !== expected) {
      problems.push(
        `runtime-serialized ${String(field)}=${JSON.stringify(actual)}, want exactly ${JSON.stringify(expected)}`,
      );
    }
  }
  return problems;
}

/** Used only by `RUNTIME-SELFTEST`: writes a synthetic module `source` to a
 * throwaway file, imports it through the identical mechanism
 * `importRealTemplatesAtHead()` uses, and runs it through the same
 * find/serialize/compare pipeline C10B-1/2/4 use -- so the selftest proves
 * something about the REAL path, not a reimplementation of it. `expectClean`
 * says whether this fixture is supposed to compare byte-for-byte equal to
 * FROZEN (the legitimate-entry control) or supposed to be DETECTED as
 * diverging (every attack-shape fixture) -- either outcome not matching
 * `expectClean` is a selftest failure, including a fixture that was
 * expected to diverge but compared clean (a false green in the mechanism
 * itself, which is exactly what round 4 exists to rule out). */
async function runOneRuntimeSelftestCase(
  name: string,
  source: string,
  expectClean: boolean,
): Promise<{ name: string; ok: boolean; detail: string }> {
  const runtime = await importTemplatesModuleFromSource(source, `RUNTIME-SELFTEST fixture '${name}'`);
  if (!runtime.ok || !runtime.templates) {
    return { name, ok: false, detail: `fixture import failed: ${runtime.error ?? 'unknown error'}` };
  }
  const matches = findVoiceboxRuntimeEntries(runtime.templates);
  if (matches.length !== 1) {
    return {
      name,
      ok: false,
      detail: `expected exactly 1 runtime element with id 'voicebox' in the fixture, found ${matches.length}`,
    };
  }
  const wire = serializeAsWireWould(matches[0]);
  if (!wire.value) {
    return { name, ok: false, detail: `fixture entry did not serialize to a plain object: ${wire.problem}` };
  }
  const actualKeys = Object.keys(wire.value).sort();
  const frozenKeys = Object.keys(FROZEN).sort();
  const keySetProblems =
    actualKeys.join(',') !== frozenKeys.join(',')
      ? [`key set mismatch: actual=[${actualKeys.join(', ')}] frozen=[${frozenKeys.join(', ')}]`]
      : [];
  const fieldProblems = compareFrozenFields(wire.value, frozenKeys as (keyof typeof FROZEN)[]);
  const allProblems = [...keySetProblems, ...fieldProblems];
  const isClean = allProblems.length === 0;
  const matchesExpectation = isClean === expectClean;
  return {
    name,
    ok: matchesExpectation,
    detail: matchesExpectation
      ? isClean
        ? 'correctly detected as clean (matches FROZEN exactly)'
        : `correctly detected ${allProblems.length} divergence(s) from FROZEN: ${allProblems.join(' | ')}`
      : isClean
        ? 'FALSE GREEN -- fixture should have diverged from FROZEN but compared clean'
        : `expected clean but found divergence(s): ${allProblems.join(' | ')}`,
  };
}

// ---------------------------------------------------------------------
// Comment collection (round-3 finding 2 fix). See the header note for why
// this trusts the parser's own literal boundaries instead of hand-rolling a
// stateful scanner loop.
// ---------------------------------------------------------------------
const COMMENT_LIKE_PATTERN = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

/** Exact `[start,end)` span of every string/template-piece/regex literal
 * token in the file, as determined by the real parser -- template
 * substitution boundaries included, correctly, because the parser (not a
 * hand-rolled re-scan) resolved them. */
function collectOpaqueLiteralRanges(sourceFile: SourceFile): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  function visit(node: TsNode): void {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isRegularExpressionLiteral(node)
    ) {
      ranges.push([node.getStart(sourceFile), node.getEnd()]);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return ranges;
}

function isInsideAnyRange(pos: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => pos >= start && pos < end);
}

/** All real comments in a file. A comment-shaped regex match is discarded
 * unless its start position falls OUTSIDE every literal token span the
 * parser found -- so text inside a template literal (including the tail
 * following a `${...}` substitution) can never be misread as a comment,
 * regardless of what it looks like. */
function collectComments(sourceText: string, sourceFile: SourceFile): string[] {
  const opaque = collectOpaqueLiteralRanges(sourceFile);
  const comments: string[] = [];
  COMMENT_LIKE_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COMMENT_LIKE_PATTERN.exec(sourceText)) !== null) {
    if (!isInsideAnyRange(m.index, opaque)) comments.push(m[0]);
  }
  return comments;
}

async function main(): Promise<void> {
  // Two-phase manifest write: a dirty placeholder goes down IMMEDIATELY,
  // before any criterion runs, so a crash/interruption mid-run can never
  // leave a stale-but-complete-looking prior green manifest on disk.
  const placeholder = {
    wave: 'W10b',
    commit: headSha,
    treeDirty: true,
    baseCommit,
    gateIntegrityPinned,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: [] as CriterionResult[],
  };
  try {
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify(placeholder, null, 2));
    fs.renameSync(tmp, path.join(proofDir, 'manifest.json'));
  } catch (err) {
    writeEmergencyManifest(`could not write placeholder manifest: ${String(err)}`);
    process.exit(1);
  }

  // Each criterion below independently re-reads and re-scans HEAD (and, for
  // C10B-3, baseCommit too) rather than sharing state from an earlier
  // criterion -- every check must stand on its own regardless of run order.

  // -----------------------------------------------------------------
  // C10B-1 -- registration present, proven at RUNTIME (round 4 -- see the
  // header's "ROUND-4" note): dynamically imports HEAD's real
  // MCP_TEMPLATES, requires exactly one runtime element whose real `.id`
  // equals 'voicebox', and requires its wire-serialized (JSON.stringify,
  // exactly like res.json) own-key set to be EXACTLY FROZEN's key set -- no
  // more, no fewer. The key-set check is what closes the round-3 vector at
  // this criterion: a __proto__/inherited-toJSON override, an accessor, a
  // spread, or a post-declaration defineProperty/setPrototypeOf mutation
  // cannot smuggle an extra or missing wire field past this check, because
  // it inspects the actually-serialized value, not source shape.
  // -----------------------------------------------------------------
  await checkCriterion('C10B-1', async () => {
    const runtime = await importRealTemplatesAtHead();
    if (!runtime.ok || !runtime.templates) {
      record(
        'C10B-1',
        `dynamic import() of a throwaway copy of HEAD's ${TEMPLATE_FILE}`,
        "MCP_TEMPLATES has exactly one runtime element with id === 'voicebox'",
        false,
        '',
        { detail: runtime.error ?? 'runtime import failed for an unknown reason' },
      );
      return;
    }
    const matches = findVoiceboxRuntimeEntries(runtime.templates);
    if (matches.length !== 1) {
      record(
        'C10B-1',
        `import HEAD's real MCP_TEMPLATES module, filter runtime elements by (t.id === 'voicebox')`,
        "MCP_TEMPLATES has exactly one runtime element with id === 'voicebox'",
        false,
        `${runtime.templates.length} total runtime template(s); ${matches.length} with id === 'voicebox'`,
        {
          detail:
            matches.length === 0
              ? "no runtime element with id 'voicebox' -- VoiceBox is not registered yet"
              : `${matches.length} runtime elements claim id 'voicebox' -- ambiguous`,
        },
      );
      return;
    }
    const wire = serializeAsWireWould(matches[0]);
    if (!wire.value) {
      record(
        'C10B-1',
        'JSON.stringify(entry) then JSON.parse -- the same transform res.json performs',
        "the voicebox entry serializes to a plain object exactly as apps/daemon/src/mcp-routes.ts:151's res.json would send it",
        false,
        '',
        { detail: wire.problem },
      );
      return;
    }
    const actualKeys = Object.keys(wire.value).sort();
    const frozenKeys = Object.keys(FROZEN).sort();
    const extra = actualKeys.filter((k) => !frozenKeys.includes(k));
    const missing = frozenKeys.filter((k) => !actualKeys.includes(k));
    const keySetOk = extra.length === 0 && missing.length === 0;
    record(
      'C10B-1',
      "import HEAD's real MCP_TEMPLATES module, find the id==='voicebox' element, JSON.stringify it exactly as res.json would",
      `exactly one runtime element has id === 'voicebox', and its wire-serialized own-key set is exactly {${frozenKeys.join(', ')}} -- no more, no fewer`,
      keySetOk,
      `wire-serialized keys: [${actualKeys.join(', ')}]${extra.length ? `\nEXTRA keys not in FROZEN: [${extra.join(', ')}]` : ''}${missing.length ? `\nMISSING frozen keys: [${missing.join(', ')}]` : ''}`,
      { detail: keySetOk ? undefined : `extra=${JSON.stringify(extra)} missing=${JSON.stringify(missing)}` },
    );
  });

  // -----------------------------------------------------------------
  // C10B-2 -- correct transport/config shape, exact, proven at RUNTIME
  // (round 4): the same wire-serialized voicebox entry C10B-1 established
  // must have transport/url/category/authMode strictly equal to FROZEN and
  // no 'headerFields' key at all. Depends on C10B-1 for the key-set
  // guarantee (an extra/missing field is already caught there); this
  // criterion checks the specific VALUES of the config-shape fields.
  // -----------------------------------------------------------------
  await checkCriterion('C10B-2', async () => {
    const runtime = await importRealTemplatesAtHead();
    if (!runtime.ok || !runtime.templates) {
      record(
        'C10B-2',
        '',
        'transport/url/category/authMode match FROZEN exactly at runtime; no headerFields key is served',
        false,
        '',
        { detail: runtime.error ?? 'runtime import failed for an unknown reason' },
      );
      return;
    }
    const matches = findVoiceboxRuntimeEntries(runtime.templates);
    if (matches.length !== 1) {
      record(
        'C10B-2',
        '',
        'transport/url/category/authMode match FROZEN exactly at runtime; no headerFields key is served',
        false,
        '',
        { detail: `see C10B-1 -- ${matches.length} runtime element(s) with id 'voicebox'` },
      );
      return;
    }
    const wire = serializeAsWireWould(matches[0]);
    if (!wire.value) {
      record(
        'C10B-2',
        '',
        'transport/url/category/authMode match FROZEN exactly at runtime; no headerFields key is served',
        false,
        '',
        { detail: wire.problem },
      );
      return;
    }
    const problems = compareFrozenFields(wire.value, ['transport', 'url', 'category', 'authMode']);
    if ('headerFields' in wire.value) {
      problems.push(
        `runtime-serialized entry has a 'headerFields' key (value=${JSON.stringify(wire.value['headerFields'])}) -- round-1 ruling pins X-Voicebox-Client-Id (and headerFields entirely) absent`,
      );
    }
    record(
      'C10B-2',
      "import HEAD's real MCP_TEMPLATES module, JSON.stringify the id==='voicebox' entry exactly as res.json would, inspect transport/url/category/authMode/headerFields",
      `runtime-serialized transport===${JSON.stringify(FROZEN.transport)}, url===${JSON.stringify(FROZEN.url)} exactly, category===${JSON.stringify(FROZEN.category)}, authMode===${JSON.stringify(FROZEN.authMode)} exactly, no headerFields key served`,
      problems.length === 0,
      problems.join('\n') || JSON.stringify(wire.value),
      { detail: problems.length === 0 ? undefined : problems.join('; ') },
    );
  });

  // -----------------------------------------------------------------
  // C10B-3 -- no extra surface added (round-1 findings 1-3, round-3
  // finding 1 + ruling): lease-glob diff subset check against the NARROWED
  // lease (mcp-config.ts only), asserting BOTH allow===exactly one entry
  // AND deny contains this verifier and the PRD (round-3: "the
  // implementation lease proposal must keep your own PRD + verifier in the
  // DENY list"); both baseCommit and HEAD's MCP_TEMPLATES arrays must be
  // structurally identifiable by id (every element a plain object literal
  // with a literal string id, no duplicate id across the array -- see
  // `ArrayScan.problems`' doc comment for why this stays AST/text-based
  // post-round-4); the file's text OUTSIDE the array's own span must be
  // byte-identical; every pre-existing entry byte-identical; exactly one
  // net-new id, 'voicebox'.
  // -----------------------------------------------------------------
  function globToRegExp(glob: string): RegExp {
    let re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    re = re.replace(/\*\*/g, ' GLOBSTAR ');
    re = re.replace(/\*/g, '[^/]*');
    re = re.replace(/ GLOBSTAR /g, '.*');
    return new RegExp(`^${re}$`);
  }

  await checkCriterion('C10B-3', () => {
    const problems: string[] = [];

    const leasesText = readFileAtCommit(baseCommit, 'docs/plans/waves/leases.json');
    let lease: { allow: string[]; deny?: string[] } | undefined;
    if (leasesText === null) {
      problems.push(`could not read docs/plans/waves/leases.json at baseCommit ${baseCommit}`);
    } else {
      try {
        const parsedLeases = JSON.parse(leasesText) as {
          waves: Record<string, { allow: string[]; deny?: string[] }>;
        };
        lease = parsedLeases.waves['W10b'];
      } catch (err) {
        problems.push(`leases.json@baseCommit did not parse: ${String(err)}`);
      }
      if (!lease) {
        problems.push(
          'no "W10b" entry in leases.json@baseCommit -- expected until the orchestrator adds the entry proposed in docs/plans/waves/W10b-voicebox-registration.md\'s "Proposed write lease" section (fails closed by design; see that PRD\'s "Verified baseline" section)',
        );
      } else {
        if (lease.allow.length !== 1 || lease.allow[0] !== TEMPLATE_FILE) {
          problems.push(
            `leases.json@baseCommit["W10b"].allow is ${JSON.stringify(lease.allow)}, want exactly ["${TEMPLATE_FILE}"] -- this verifier must not be implementer-writable (round-1 finding 1)`,
          );
        }
        const denyList = lease.deny ?? [];
        const requiredDeny = ['docs/plans/waves/W10b-voicebox-registration.md', 'scripts/waves/verify-w10b.ts'];
        const missingDeny = requiredDeny.filter((p) => !denyList.includes(p));
        if (missingDeny.length > 0) {
          problems.push(
            `leases.json@baseCommit["W10b"].deny is missing ${JSON.stringify(missingDeny)} -- round-3 requires the PRD and this verifier both explicitly denied, not merely omitted from allow`,
          );
        }
      }
    }

    const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
    const diffNames = diffResult.stdout.trim().split('\n').filter(Boolean);
    if (diffResult.status !== 0) problems.push(`git diff exited ${diffResult.status}: ${diffResult.stderr}`);
    if (lease) {
      const allowRe = lease.allow.map(globToRegExp);
      const denyRe = (lease.deny ?? []).map(globToRegExp);
      const violations = diffNames.filter(
        (f) => !allowRe.some((re) => re.test(f)) || denyRe.some((re) => re.test(f)),
      );
      if (violations.length > 0) problems.push(`outside W10b lease: ${violations.join(', ')}`);
    }

    const baseText = readFileAtCommit(baseCommit, TEMPLATE_FILE);
    const headText = readFileAtCommit(headSha, TEMPLATE_FILE);
    if (baseText === null || headText === null) {
      problems.push(`could not read ${TEMPLATE_FILE} at baseCommit and/or HEAD`);
    } else {
      const baseScan = analyzeTemplateArray(baseText, `${TEMPLATE_FILE}@base`);
      const headScan = analyzeTemplateArray(headText, `${TEMPLATE_FILE}@head`);
      if (!baseScan || !headScan) {
        problems.push('could not locate MCP_TEMPLATES at baseCommit and/or HEAD');
      } else if (baseScan.problems.length > 0 || headScan.problems.length > 0) {
        problems.push(
          `array elements could not be identified by id -- base: [${baseScan.problems.join(' | ')}] head: [${headScan.problems.join(' | ')}]`,
        );
      } else {
        const baseSplit = splitAroundArray(baseText, baseScan);
        const headSplit = splitAroundArray(headText, headScan);
        if (baseSplit.before !== headSplit.before) {
          problems.push('file text BEFORE the MCP_TEMPLATES array changed -- only the array may change (round-1 finding 2)');
        }
        if (baseSplit.after !== headSplit.after) {
          problems.push('file text AFTER the MCP_TEMPLATES array changed -- only the array may change (round-1 finding 2)');
        }
        const baseClean = baseScan.clean as Map<string, TemplateBlock>;
        const headClean = headScan.clean as Map<string, TemplateBlock>;
        for (const [id, baseBlock] of baseClean) {
          const headBlock = headClean.get(id);
          if (!headBlock) {
            problems.push(`pre-existing template '${id}' was removed`);
          } else if (headBlock.rawText !== baseBlock.rawText) {
            problems.push(`pre-existing template '${id}' was modified (not byte-identical)`);
          }
        }
        const newIds = [...headClean.keys()].filter((id) => !baseClean.has(id));
        if (newIds.length !== 1) {
          problems.push(`expected exactly 1 new MCP_TEMPLATES entry, found ${newIds.length}: ${newIds.join(', ') || '<none>'}`);
        } else if (newIds[0] !== 'voicebox') {
          problems.push(`the one new entry is '${newIds[0]}', expected 'voicebox'`);
        }
      }
    }

    record(
      'C10B-3',
      `git diff --name-only ${baseCommit}...HEAD subset-of leases.json@baseCommit["W10b"] (allow exactly mcp-config.ts, deny includes this PRD+verifier); MCP_TEMPLATES array elements identifiable by id both sides; non-array file text byte-identical; additive-only array diff`,
      "diff is within the narrowed W10b lease (exact allow, required deny entries present); both baseCommit and HEAD's MCP_TEMPLATES arrays are structurally identifiable by id with zero ambiguity; every file byte outside the array is unchanged; every pre-existing entry is byte-identical; exactly one new entry, id voicebox",
      problems.length === 0,
      problems.join('\n') ||
        (diffNames.length === 0 ? 'no diff between baseCommit and HEAD' : `changed files: ${diffNames.join(', ')}`),
      { detail: problems.length === 0 ? undefined : problems.join('; ') },
    );
  });

  // -----------------------------------------------------------------
  // C10B-4 -- no voiceover-workflow scope creep (round-1 finding 4), proven
  // at RUNTIME (round 4): byte-exact equality against the ONE frozen string
  // per free-text field, checked on the actually-served (wire-serialized)
  // value rather than a static AST read -- the same mechanism as C10B-2, so
  // a __proto__/inherited-toJSON override, a spread, an accessor, or a
  // post-declaration mutation cannot smuggle different wording past this
  // check either.
  // -----------------------------------------------------------------
  await checkCriterion('C10B-4', async () => {
    const runtime = await importRealTemplatesAtHead();
    if (!runtime.ok || !runtime.templates) {
      record(
        'C10B-4',
        '',
        'label/description/example/homepage are byte-identical to the frozen strings, at runtime',
        false,
        '',
        { detail: runtime.error ?? 'runtime import failed for an unknown reason' },
      );
      return;
    }
    const matches = findVoiceboxRuntimeEntries(runtime.templates);
    if (matches.length !== 1) {
      record(
        'C10B-4',
        '',
        'label/description/example/homepage are byte-identical to the frozen strings, at runtime',
        false,
        '',
        { detail: `see C10B-1 -- ${matches.length} runtime element(s) with id 'voicebox'` },
      );
      return;
    }
    const wire = serializeAsWireWould(matches[0]);
    if (!wire.value) {
      record(
        'C10B-4',
        '',
        'label/description/example/homepage are byte-identical to the frozen strings, at runtime',
        false,
        '',
        { detail: wire.problem },
      );
      return;
    }
    const problems = compareFrozenFields(wire.value, ['label', 'description', 'example', 'homepage']);

    record(
      'C10B-4',
      "import HEAD's real MCP_TEMPLATES module, JSON.stringify the id==='voicebox' entry exactly as res.json would, inspect label/description/example/homepage",
      'runtime-serialized label/description/example/homepage are byte-identical to the frozen strings in this PRD\'s "Implementation surface" section',
      problems.length === 0,
      problems.join('\n') || JSON.stringify(wire.value),
      { detail: problems.length === 0 ? undefined : problems.join('; ') },
    );
  });

  // -----------------------------------------------------------------
  // C10B-5 -- documentation record (round-1 finding 6, round-2 finding 6 /
  // round-3 finding 2 fix): a genuinely NEW comment token (never a string or
  // template-literal token, at any nesting depth of interpolation) must
  // exist at HEAD but not at baseCommit.
  // -----------------------------------------------------------------
  await checkCriterion('C10B-5', () => {
    const baseText = readFileAtCommit(baseCommit, TEMPLATE_FILE);
    const headText = readFileAtCommit(headSha, TEMPLATE_FILE);
    if (baseText === null || headText === null) {
      record('C10B-5', '', "a comment token added to the file contains the literal substring 'NM-25'", false, '', {
        detail: `could not read ${TEMPLATE_FILE} at baseCommit and/or HEAD`,
      });
      return;
    }
    const baseSf = ts.createSourceFile(`${TEMPLATE_FILE}@base-c5`, baseText, ts.ScriptTarget.Latest, true);
    const headSf = ts.createSourceFile(`${TEMPLATE_FILE}@head-c5`, headText, ts.ScriptTarget.Latest, true);
    const baseComments = new Set(collectComments(baseText, baseSf));
    const headComments = collectComments(headText, headSf);
    const newNm25Comments = headComments.filter((c) => c.includes('NM-25') && !baseComments.has(c));
    record(
      'C10B-5',
      `parse ${TEMPLATE_FILE}@baseCommit and @HEAD, collect real comment tokens via collectComments() (round-3: literal-boundary-aware, not raw scanning)`,
      "a comment token added to the file (present at HEAD, absent at baseCommit) contains the literal substring 'NM-25' -- text inside a string or template literal, at any interpolation depth, does not count",
      newNm25Comments.length > 0,
      newNm25Comments.length > 0
        ? newNm25Comments.join('\n')
        : `${headComments.length} total comment(s) at HEAD, ${baseComments.size} at baseCommit; none newly-added contain 'NM-25'`,
      { detail: newNm25Comments.length > 0 ? undefined : 'no newly-added NM-25 comment found' },
    );
  });

  // -----------------------------------------------------------------
  // GATE-INTEGRITY -- infra check, not a PRD criterion (round-3 finding 3;
  // mirrors scripts/waves/verify-w9-ingest.ts's own GATE-INTEGRITY shape).
  // Defense in depth: self-hashes the file currently executing and compares
  // against an orchestrator-placed approved-gate.sha256. The PRIMARY control
  // remains C10B-3's lease-subset check (this file is not in the
  // implementer's allow list); this check adds an independent layer that
  // does not depend on lease/diff semantics at all.
  // -----------------------------------------------------------------
  await checkCriterion('GATE-INTEGRITY', () => {
    const selfPath = process.argv[1] ? path.resolve(process.argv[1]) : path.join(repoRoot, 'scripts/waves/verify-w10b.ts');
    let selfSha256: string;
    try {
      selfSha256 = sha256File(selfPath);
    } catch (err) {
      record(
        'GATE-INTEGRITY',
        '',
        'defense-in-depth self-hash check; the PRIMARY control is the lease-subset check in C10B-3, not this pin',
        false,
        '',
        { detail: `could not hash self at ${selfPath}: ${String(err)}` },
      );
      return;
    }
    const approvedHashPath = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'approved-gate.sha256');
    if (!gateIntegrityPinned) {
      record(
        'GATE-INTEGRITY',
        '',
        'defense-in-depth self-hash check',
        true,
        `sha256: ${selfSha256}\nUNPINNED -- no approved-gate.sha256 present. This file is not tamper-protected by this specific check until the orchestrator pins one post-approval; see manifest.gateIntegrityPinned=false. C10B-3's lease-subset check is the primary control regardless.`,
      );
      return;
    }
    const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
    const gateOk = approved === selfSha256;
    record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check', gateOk, `sha256: ${selfSha256}\napproved: ${approved}\nPINNED`, {
      detail: gateOk ? undefined : 'verify-w10b.ts modified since orchestrator approval',
    });
  });

  // -----------------------------------------------------------------
  // SCANNER-SELFTEST -- infra check, not a PRD criterion (round-3 finding 2:
  // "add a template-heavy fixture proving the fix"). Two-file constraint
  // means the fixture lives here, in-process, rather than as a third file.
  // Exercises collectComments() against the exact round-2 false-positive
  // cases plus positive/negative controls.
  // -----------------------------------------------------------------
  await checkCriterion('SCANNER-SELFTEST', () => {
    const cases: Array<{ name: string; source: string; expectNm25Comments: string[] }> = [
      {
        name: 'real-line-comment',
        source: 'const x = 1; // NM-25\n',
        expectNm25Comments: ['// NM-25'],
      },
      {
        name: 'real-block-comment',
        source: 'const x = 1; /* NM-25 */\n',
        expectNm25Comments: ['/* NM-25 */'],
      },
      {
        name: 'template-tail-after-substitution-line-comment-lookalike (round-2 false-positive)',
        source: 'const x = `${0}// NM-25`;\n',
        expectNm25Comments: [],
      },
      {
        name: 'template-tail-after-substitution-block-comment-lookalike (round-2 false-positive)',
        source: 'const x = `before ${0} /* NM-25 */ after`;\n',
        expectNm25Comments: [],
      },
      {
        name: 'no-substitution-template-literal-text',
        source: 'const x = `// NM-25`;\n',
        expectNm25Comments: [],
      },
      {
        name: 'plain-string-literal-text',
        source: "const x = 'NM-25 inside a plain string, not a comment';\n",
        expectNm25Comments: [],
      },
      {
        name: 'real-comment-immediately-after-a-template-literal',
        source: 'const x = `${0}`; // NM-25\n',
        expectNm25Comments: ['// NM-25'],
      },
      {
        name: 'nested-template-substitution-with-comment-lookalike-in-inner-tail',
        source: 'const x = `${`${0}// NM-25`}`;\n',
        expectNm25Comments: [],
      },
    ];
    const problems: string[] = [];
    for (const c of cases) {
      const sf = ts.createSourceFile('selftest.ts', c.source, ts.ScriptTarget.Latest, true);
      const actual = collectComments(c.source, sf).filter((s) => s.includes('NM-25'));
      const expected = c.expectNm25Comments;
      const match = actual.length === expected.length && actual.every((v, i) => v === expected[i]);
      if (!match) {
        problems.push(`${c.name}: source=${JSON.stringify(c.source)} expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
      }
    }
    record(
      'SCANNER-SELFTEST',
      'in-process fixture cases exercising collectComments() against template-literal edge cases, including the exact two round-2 false-positive shapes',
      'collectComments() correctly distinguishes real comments from comment-shaped text inside string/template literals, at every interpolation depth, in both directions (no false positive, no false negative on a real adjacent comment)',
      problems.length === 0,
      problems.join('\n') || `${cases.length} fixture cases all matched expected output`,
      { detail: problems.length === 0 ? undefined : `${problems.length}/${cases.length} fixture case(s) failed` },
    );
  });

  // -----------------------------------------------------------------
  // RUNTIME-SELFTEST -- infra check, not a PRD criterion (round 4: proves
  // the runtime-import mechanism C10B-1/2/4 now depend on actually detects
  // the round-3 REJECT vector and its sibling shapes, rather than merely
  // asserting it does in a comment). Exercises the EXACT same pipeline
  // C10B-1/2/4 use (importTemplatesModuleFromSource ->
  // findVoiceboxRuntimeEntries -> serializeAsWireWould -> compareFrozenFields)
  // against eight synthetic module sources -- never touching this
  // repository's real mcp-config.ts -- mirroring SCANNER-SELFTEST's
  // established in-process-fixture pattern (the two-file constraint means
  // the fixtures live here, not as a third file).
  // -----------------------------------------------------------------
  await checkCriterion('RUNTIME-SELFTEST', async () => {
    const frozenKeysOrdered = Object.keys(FROZEN) as (keyof typeof FROZEN)[];
    const frozenFieldsSource = frozenKeysOrdered.map((k) => `    ${k}: ${JSON.stringify(FROZEN[k])},`).join('\n');
    const frozenFieldsSourceNoUrl = frozenKeysOrdered
      .filter((k) => k !== 'url')
      .map((k) => `    ${k}: ${JSON.stringify(FROZEN[k])},`)
      .join('\n');
    const evilObjectLiteral =
      "{ id: 'voicebox', label: 'EVIL', description: 'evil', example: 'evil', homepage: 'https://evil.invalid', transport: 'http', authMode: 'oauth', category: 'utilities', url: 'http://evil.invalid' }";

    const cases: Array<{ name: string; source: string; expectClean: boolean }> = [
      {
        name: 'clean-legitimate-entry',
        source: `export const MCP_TEMPLATES = [\n  {\n${frozenFieldsSource}\n  },\n];\n`,
        expectClean: true,
      },
      {
        name: 'round3-proto-inherited-tojson (the exact round-3 REJECT vector)',
        source: `export const MCP_TEMPLATES = [\n  {\n${frozenFieldsSource}\n    __proto__: { toJSON: () => (${evilObjectLiteral}) },\n  },\n];\n`,
        expectClean: false,
      },
      {
        name: 'own-method-toJSON',
        source: `export const MCP_TEMPLATES = [\n  {\n${frozenFieldsSource}\n    toJSON() { return ${evilObjectLiteral}; },\n  },\n];\n`,
        expectClean: false,
      },
      {
        name: 'round2-spread-override (regression)',
        source: `export const MCP_TEMPLATES = [\n  {\n${frozenFieldsSource}\n    ...{ url: 'http://evil.invalid', authMode: 'oauth' },\n  },\n];\n`,
        expectClean: false,
      },
      {
        name: 'getter-accessor-override',
        source: `export const MCP_TEMPLATES = [\n  {\n${frozenFieldsSourceNoUrl}\n    get url() { return 'http://evil.invalid'; },\n  },\n];\n`,
        expectClean: false,
      },
      {
        name: 'defineProperty-after-declaration',
        source: `export const MCP_TEMPLATES = [\n  {\n${frozenFieldsSource}\n  },\n];\nObject.defineProperty(MCP_TEMPLATES[0], 'url', { value: 'http://evil.invalid', enumerable: true, configurable: true });\n`,
        expectClean: false,
      },
      {
        name: 'setPrototypeOf-after-declaration',
        source: `export const MCP_TEMPLATES = [\n  {\n${frozenFieldsSource}\n  },\n];\nObject.setPrototypeOf(MCP_TEMPLATES[0], { toJSON: () => (${evilObjectLiteral}) });\n`,
        expectClean: false,
      },
      {
        name: 'dead-branch-lookalike-ternary',
        source: `const ALWAYS_EVIL = (1 === 1);\nexport const MCP_TEMPLATES = [\n  {\n${frozenFieldsSourceNoUrl}\n    url: (ALWAYS_EVIL ? 'http://evil.invalid' : ${JSON.stringify(FROZEN.url)}),\n  },\n];\n`,
        expectClean: false,
      },
    ];

    const outcomes: Array<{ name: string; ok: boolean; detail: string }> = [];
    for (const c of cases) {
      // eslint-disable-next-line no-await-in-loop -- fixtures must run
      // sequentially: each writes to its own throwaway temp dir and cleans
      // up before the next starts, so there is no benefit to parallelizing
      // and it keeps failure attribution unambiguous.
      const outcome = await runOneRuntimeSelftestCase(c.name, c.source, c.expectClean);
      outcomes.push(outcome);
    }
    const failures = outcomes.filter((o) => !o.ok);
    record(
      'RUNTIME-SELFTEST',
      'in-process fixture cases: write a synthetic MCP_TEMPLATES module, dynamically import it exactly like importRealTemplatesAtHead() does, run it through the same findVoiceboxRuntimeEntries/serializeAsWireWould/compareFrozenFields pipeline C10B-1/2/4 use',
      'the runtime-import mechanism correctly passes a clean legitimate entry and correctly DETECTS every named divergence vector as a mismatch (no false green): __proto__/inherited toJSON (the exact round-3 vector), an own toJSON method, a property spread overriding earlier fields (round-2 regression), a getter/accessor, a post-declaration Object.defineProperty mutation, a post-declaration Object.setPrototypeOf mutation, and a dead-branch-lookalike conditional',
      failures.length === 0,
      outcomes.map((o) => `[${o.ok ? 'OK' : 'FAIL'}] ${o.name}: ${o.detail}`).join('\n'),
      {
        detail:
          failures.length === 0
            ? undefined
            : `${failures.length}/${cases.length} fixture case(s) failed: ${failures.map((f) => f.name).join(', ')}`,
      },
    );
  });

  // -----------------------------------------------------------------
  // HEAD-DRIFT -- infra check, not a PRD criterion (mirrors the pattern in
  // scripts/waves/verify-w9-ingest.ts).
  // -----------------------------------------------------------------
  const headShaFinal = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  await checkCriterion('HEAD-DRIFT', () => {
    record(
      'HEAD-DRIFT',
      'git rev-parse HEAD (re-resolved at end)',
      'HEAD must not move during the run',
      headShaFinal === headSha,
      `initial=${headSha} final=${headShaFinal}`,
      { detail: headShaFinal === headSha ? undefined : 'HEAD moved during the run' },
    );
  });

  // -----------------------------------------------------------------
  // Final manifest.
  // -----------------------------------------------------------------
  const treeDirtyResult = sh('git', ['status', '--porcelain=v1']);
  const treeDirty = treeDirtyResult.status !== 0 || treeDirtyResult.stdout.trim().length > 0;
  const finalManifest = {
    wave: 'W10b',
    commit: headSha,
    treeDirty,
    baseCommit,
    gateIntegrityPinned,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: results,
  };
  let manifestWritten = false;
  let manifestSha256 = '';
  try {
    const manifestJson = JSON.stringify(finalManifest, null, 2);
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, manifestJson);
    fs.renameSync(tmp, path.join(proofDir, 'manifest.json'));
    manifestSha256 = sha256Bytes(manifestJson);
    manifestWritten = true;
  } catch (err) {
    console.error(`verify-w10b: FAILED to write final manifest: ${String(err)}`);
  }

  const failures = results.filter((r) => r.status === 'fail');
  console.log(
    `\nverify-w10b: ${results.length - failures.length}/${results.length} criteria pass (treeDirty=${treeDirty}, gateIntegrityPinned=${gateIntegrityPinned})`,
  );
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id}${r.detail ? ` (${r.detail})` : ''}`);
  if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md §2)');
  console.log(`MANIFEST_SHA256=${manifestSha256}`);
  console.log(`MANIFEST_PATH=${path.join(proofDir, 'manifest.json')}`);
  process.exit(failures.length === 0 && !treeDirty && manifestWritten ? 0 : 1);
}

main().catch((err) => {
  writeEmergencyManifest(`unhandled error in main(): ${String((err as Error)?.stack ?? err)}`, results);
  process.exit(1);
});
