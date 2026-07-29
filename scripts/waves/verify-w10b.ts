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
// Prior rounds (1 and 2) are recorded in the PRD's "Round 1/2/3 adversarial
// review" sections; this header covers only what changed in round 3.
//
// Scope note: this verifier never imports apps/daemon/src/mcp-config.ts as a
// live ES module -- that file's own dependency graph is not this script's
// concern to keep resolvable across --repo. It reads the file as TEXT at
// specific commits (git show) and parses it with the TypeScript compiler
// API, matching the pattern in scripts/waves/verify-w9-ingest.ts.
//
// PORTABILITY: repoRoot comes from `process.cwd()`/`--repo`, never
// `import.meta.url`.
//
// RUNTIME SAFETY: this verifier spawns no daemon and binds no port -- every
// criterion is answered from `git show`/`git diff`/`git status` output plus
// in-process TypeScript parsing (no raw scanner loop as of round 3). It
// never touches a default-namespace daemon (ports 7456/51012) because it
// never starts one. Git context is resolved from local refs only (no
// fetch/push). This file never writes generated script content -- only
// `manifest.json` and plain-text proof artifacts under `proofDir` -- so
// there is nothing here for `node --check` to validate.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
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
  node: ObjectLiteralExpression;
}

interface ArrayScan {
  file: SourceFile;
  arrayNode: ArrayLiteralExpression;
  /** Non-empty means the array could NOT be safely reasoned about (round-1
   * finding 3, round-3 finding 1): a spread/call/other non-object-literal
   * element, an object literal with no plain string-literal `id`, a
   * duplicate `id`, or a deep structural anomaly (spread/computed-key/
   * duplicate-key/accessor at ANY nesting depth -- round-3 finding 1). Every
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

/** True iff a property with this name is present at all, any value shape. */
function hasOwnProp(obj: ObjectLiteralExpression, name: string): boolean {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue;
    if (!ts.isIdentifier(prop.name) || prop.name.text !== name) continue;
    return true;
  }
  return false;
}

function shortText(sourceFile: SourceFile, node: TsNode): string {
  return node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 100);
}

/** Round-3 finding 1 (deep spread ban) + its two sibling vulnerabilities in
 * the same class (a later property silently overriding an earlier
 * frozen-looking one at runtime, invisible to a first-match string
 * extractor): computed property names and duplicate property names within
 * one object literal. Walks the WHOLE subtree given (the entire
 * MCP_TEMPLATES array, or any node within it) at every nesting depth --
 * "shallow bans don't count" applies to all three, not just the literally-
 * named spread case. Every object-literal member must be a plain
 * `PropertyAssignment` with an `Identifier`/`StringLiteral`/`NumericLiteral`
 * key; anything else (`SpreadAssignment`, `ShorthandPropertyAssignment`,
 * `MethodDeclaration`, get/set accessors, computed keys) is rejected.
 * `SpreadElement` (array spread) is rejected wherever it appears, including
 * nested inside a hypothetical `headerFields`/`envFields` array. */
function findDeepStructuralAnomalies(root: TsNode, sourceFile: SourceFile): string[] {
  const problems: string[] = [];
  function visit(node: TsNode): void {
    if (ts.isSpreadElement(node)) {
      problems.push(`array spread (SpreadElement) at offset ${node.getStart(sourceFile)}: ${shortText(sourceFile, node)}`);
    } else if (ts.isObjectLiteralExpression(node)) {
      const seenNames = new Set<string>();
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop)) {
          problems.push(
            `non-plain object member (${ts.SyntaxKind[prop.kind]} -- spread/shorthand/method/accessor are all rejected) at offset ${prop.getStart(sourceFile)}: ${shortText(sourceFile, prop)}`,
          );
          continue;
        }
        if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name) && !ts.isNumericLiteral(prop.name)) {
          problems.push(
            `computed or non-literal property name at offset ${prop.getStart(sourceFile)}: ${shortText(sourceFile, prop)}`,
          );
          continue;
        }
        const key = prop.name.text;
        if (seenNames.has(key)) {
          problems.push(
            `duplicate property '${key}' within one object literal at offset ${prop.getStart(sourceFile)}: ${shortText(sourceFile, prop)}`,
          );
        }
        seenNames.add(key);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return problems;
}

function analyzeTemplateArray(sourceText: string, syntheticFileName: string): ArrayScan | null {
  const located = locateTemplateArray(sourceText, syntheticFileName);
  if (!located) return null;
  const { file, arrayNode } = located;
  const problems: string[] = [...findDeepStructuralAnomalies(arrayNode, file)];
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
    const block: TemplateBlock = { id, rawText: element.getText(file).trim(), node: element };
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
  // C10B-1 -- registration present: exactly one clean, unambiguous
  // MCP_TEMPLATES element with id 'voicebox'. Fails closed on anything the
  // scan could not safely account for, at any nesting depth (round-1
  // findings 2/3, round-3 finding 1).
  // -----------------------------------------------------------------
  await checkCriterion('C10B-1', () => {
    const headText = readFileAtCommit(headSha, TEMPLATE_FILE);
    if (headText === null) {
      record('C10B-1', `git show ${headSha}:${TEMPLATE_FILE}`, "MCP_TEMPLATES has exactly one clean element with id 'voicebox'", false, '', {
        detail: `${TEMPLATE_FILE} does not exist at HEAD`,
      });
      return;
    }
    const scan = analyzeTemplateArray(headText, TEMPLATE_FILE);
    if (!scan) {
      record('C10B-1', `parse ${TEMPLATE_FILE}@HEAD`, 'MCP_TEMPLATES array literal is found and parseable', false, '', {
        detail: 'could not locate `const MCP_TEMPLATES: McpTemplate[] = [...]` in the file',
      });
      return;
    }
    if (scan.problems.length > 0) {
      record(
        'C10B-1',
        `parse ${TEMPLATE_FILE}@HEAD, analyze every MCP_TEMPLATES element at every nesting depth`,
        "MCP_TEMPLATES has exactly one clean element with id 'voicebox'",
        false,
        scan.problems.join('\n'),
        { detail: `array could not be safely analyzed: ${scan.problems.length} problem(s)` },
      );
      return;
    }
    const clean = scan.clean as Map<string, TemplateBlock>;
    const block = clean.get('voicebox');
    record(
      'C10B-1',
      `parse ${TEMPLATE_FILE}@HEAD, analyze every MCP_TEMPLATES element at every nesting depth, look up id==='voicebox'`,
      "MCP_TEMPLATES has exactly one clean element with id 'voicebox'",
      Boolean(block),
      block ? block.rawText : `MCP_TEMPLATES has ${clean.size} clean entries; ids: ${[...clean.keys()].join(', ')}`,
      { detail: block ? undefined : "no object with id 'voicebox' present -- VoiceBox is not registered yet" },
    );
  });

  // -----------------------------------------------------------------
  // C10B-2 -- correct transport/config shape, exact (round-1 findings 5 +
  // ruling 2): full-string URL equality, authMode exactly 'none', no
  // headerFields property. Depends on C10B-1's deep-anomaly scan, so a
  // spread/computed-key override anywhere is already excluded before these
  // direct-property checks run at all (round-3 finding 1).
  // -----------------------------------------------------------------
  await checkCriterion('C10B-2', () => {
    const headText = readFileAtCommit(headSha, TEMPLATE_FILE);
    const scan = headText === null ? null : analyzeTemplateArray(headText, `${TEMPLATE_FILE}@head-c2`);
    if (!scan || scan.problems.length > 0) {
      record(
        'C10B-2',
        `parse ${TEMPLATE_FILE}@HEAD, analyze every MCP_TEMPLATES element at every nesting depth`,
        'transport/url/category/authMode/headerFields match the frozen configuration exactly',
        false,
        scan ? scan.problems.join('\n') : '',
        { detail: !scan ? 'MCP_TEMPLATES array not found at HEAD' : `array could not be safely analyzed: ${scan.problems.length} problem(s)` },
      );
      return;
    }
    const clean = scan.clean as Map<string, TemplateBlock>;
    const block = clean.get('voicebox');
    if (!block) {
      record(
        'C10B-2',
        '',
        'transport/url/category/authMode/headerFields match the frozen configuration exactly',
        false,
        '',
        { detail: "no object with id 'voicebox' present -- see C10B-1" },
      );
      return;
    }
    const transport = findStringProp(block.node, scan.file, 'transport');
    const url = findStringProp(block.node, scan.file, 'url');
    const category = findStringProp(block.node, scan.file, 'category');
    const authMode = findStringProp(block.node, scan.file, 'authMode');
    const hasHeaderFields = hasOwnProp(block.node, 'headerFields');

    const problems: string[] = [];
    if (transport !== FROZEN.transport) problems.push(`transport=${JSON.stringify(transport)}, want ${JSON.stringify(FROZEN.transport)}`);
    if (url !== FROZEN.url) problems.push(`url=${JSON.stringify(url)}, want exactly ${JSON.stringify(FROZEN.url)} (full-string equality -- credentials/query/fragment are therefore rejected too)`);
    if (category !== FROZEN.category) problems.push(`category=${JSON.stringify(category)}, want ${JSON.stringify(FROZEN.category)}`);
    if (authMode !== FROZEN.authMode) problems.push(`authMode=${JSON.stringify(authMode)}, want exactly ${JSON.stringify(FROZEN.authMode)} (present, not absent)`);
    if (hasHeaderFields) problems.push("'headerFields' property present -- round-1 ruling pins X-Voicebox-Client-Id (and headerFields entirely) absent");

    record(
      'C10B-2',
      `parse ${TEMPLATE_FILE}@HEAD, inspect the id==='voicebox' object's transport/url/category/authMode/headerFields`,
      `transport===${JSON.stringify(FROZEN.transport)}, url===${JSON.stringify(FROZEN.url)} exactly, category===${JSON.stringify(FROZEN.category)}, authMode===${JSON.stringify(FROZEN.authMode)} exactly, no headerFields property`,
      problems.length === 0,
      problems.join('\n') || `transport=${transport} url=${url} category=${category} authMode=${authMode} headerFields=${hasHeaderFields}`,
      { detail: problems.length === 0 ? undefined : problems.join('; ') },
    );
  });

  // -----------------------------------------------------------------
  // C10B-3 -- no extra surface added (round-1 findings 1-3, round-3
  // finding 1 + ruling): lease-glob diff subset check against the NARROWED
  // lease (mcp-config.ts only), asserting BOTH allow===exactly one entry
  // AND deny contains this verifier and the PRD (round-3: "the
  // implementation lease proposal must keep your own PRD + verifier in the
  // DENY list"); both baseCommit and HEAD's MCP_TEMPLATES arrays must
  // analyze cleanly at every nesting depth; the file's text OUTSIDE the
  // array's own span must be byte-identical; every pre-existing entry
  // byte-identical; exactly one net-new id, 'voicebox'.
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
          `array could not be safely analyzed -- base: [${baseScan.problems.join(' | ')}] head: [${headScan.problems.join(' | ')}]`,
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
      `git diff --name-only ${baseCommit}...HEAD subset-of leases.json@baseCommit["W10b"] (allow exactly mcp-config.ts, deny includes this PRD+verifier); MCP_TEMPLATES array analyzed cleanly both sides at every nesting depth; non-array file text byte-identical; additive-only array diff`,
      "diff is within the narrowed W10b lease (exact allow, required deny entries present); both baseCommit and HEAD's MCP_TEMPLATES arrays analyze with zero anomalies at every nesting depth; every file byte outside the array is unchanged; every pre-existing entry is byte-identical; exactly one new entry, id voicebox",
      problems.length === 0,
      problems.join('\n') ||
        (diffNames.length === 0 ? 'no diff between baseCommit and HEAD' : `changed files: ${diffNames.join(', ')}`),
      { detail: problems.length === 0 ? undefined : problems.join('; ') },
    );
  });

  // -----------------------------------------------------------------
  // C10B-4 -- no voiceover-workflow scope creep (round-1 finding 4): byte-
  // exact equality against the ONE frozen string per free-text field.
  // Depends on C10B-1's deep-anomaly scan (round-3 finding 1), so a spread
  // that would otherwise smuggle a different runtime description/example
  // past this check is already excluded before it runs.
  // -----------------------------------------------------------------
  await checkCriterion('C10B-4', () => {
    const headText = readFileAtCommit(headSha, TEMPLATE_FILE);
    const scan = headText === null ? null : analyzeTemplateArray(headText, `${TEMPLATE_FILE}@head-c4`);
    if (!scan || scan.problems.length > 0) {
      record(
        'C10B-4',
        `parse ${TEMPLATE_FILE}@HEAD, analyze every MCP_TEMPLATES element at every nesting depth`,
        'label/description/example/homepage are byte-identical to the frozen strings',
        false,
        scan ? scan.problems.join('\n') : '',
        { detail: !scan ? 'MCP_TEMPLATES array not found at HEAD' : `array could not be safely analyzed: ${scan.problems.length} problem(s)` },
      );
      return;
    }
    const clean = scan.clean as Map<string, TemplateBlock>;
    const block = clean.get('voicebox');
    if (!block) {
      record('C10B-4', '', 'label/description/example/homepage are byte-identical to the frozen strings', false, '', {
        detail: "no object with id 'voicebox' present -- see C10B-1",
      });
      return;
    }
    const label = findStringProp(block.node, scan.file, 'label');
    const description = findStringProp(block.node, scan.file, 'description');
    const example = findStringProp(block.node, scan.file, 'example');
    const homepage = findStringProp(block.node, scan.file, 'homepage');

    const problems: string[] = [];
    if (label !== FROZEN.label) problems.push(`label differs from the frozen string`);
    if (description !== FROZEN.description) problems.push(`description differs from the frozen string`);
    if (example !== FROZEN.example) problems.push(`example differs from the frozen string`);
    if (homepage !== FROZEN.homepage) problems.push(`homepage differs from the frozen string`);

    record(
      'C10B-4',
      `parse ${TEMPLATE_FILE}@HEAD, inspect the id==='voicebox' object's label/description/example/homepage`,
      'label/description/example/homepage are byte-identical to the frozen strings in this PRD\'s "Implementation surface" section',
      problems.length === 0,
      problems.length === 0
        ? `label=${JSON.stringify(label)}\ndescription=${JSON.stringify(description)}\nexample=${JSON.stringify(example)}\nhomepage=${JSON.stringify(homepage)}`
        : `${problems.join('\n')}\n\nactual label=${JSON.stringify(label)}\nactual description=${JSON.stringify(description)}\nactual example=${JSON.stringify(example)}\nactual homepage=${JSON.stringify(homepage)}\n\nfrozen label=${JSON.stringify(FROZEN.label)}\nfrozen description=${JSON.stringify(FROZEN.description)}\nfrozen example=${JSON.stringify(FROZEN.example)}\nfrozen homepage=${JSON.stringify(FROZEN.homepage)}`,
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
