// verify-w9-filesystem.ts -- wave mishmash-w9-filesystem-tranche (filesystem
// read/write route hardening) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w9-filesystem.ts [--repo <path>]
//
// This is a PRE-IMPLEMENTATION expansion verifier (docs/plans/waves/
// W9-filesystem-tranche.md). Run against current `main` it is expected to
// exit non-zero (CLEAN-RED): the route snapshot / inclusion classification
// and the exposure self-probes can pass today (they need no implementation),
// but the attribution matrix, threat-model doc extension, and implementation
// review record do not exist yet, so the criteria that depend on them fail
// honestly. The verifier never crashes -- every criterion is wrapped so a
// thrown error becomes a recorded `fail`, and a top-level manifest is always
// written (a `wroteOk:false` placeholder first, then the real result).
//
// Mirrors scripts/waves/verify-w9-ingest.ts's machinery where it fits: the
// same proof-manifest shape, two-phase manifest write, run archival with
// reread-verify, GATE-INTEGRITY / LEASE / HEAD-DRIFT named checks, and the
// same anti-gaming posture (VERIFICATION-CONTRACT.md section 3):
//   - route/registration counts are re-derived from the repo every run,
//     never hardcoded (a literal count appearing in this file is always a
//     SELF-CHECK EXPECTATION, re-validated against a live re-derivation,
//     never trusted on its own);
//   - the inclusion and exposure classifiers are exercised through their own
//     self-probe fixtures, run through the exact same functions real routes
//     use, never a separate mock;
//   - object spreads in a deps object literal are treated as UNRESOLVED,
//     never silently CLEAN (defect-catalog item 2);
//   - diffs are multiset (occurrence-count) comparisons, never Set-based
//     (defect-catalog item 3);
//   - rejection checks assert an EXACT status/error code, paired with an
//     at/below-limit positive control (defect-catalog item 4);
//   - all TypeScript inspection goes through the compiler API, never
//     regex/string scanning (defect-catalog item 5);
//   - route-file resolution is exact-path based, never substring matching
//     (defect-catalog item 7);
//   - any probe fetch uses redirect:'manual' and fail-closed URL validation,
//     refusing non-loopback targets and ports 7456/51012 (defect-catalog
//     item 10);
//   - this verifier never touches the default-namespace daemon (ports
//     7456/51012, pids 16481/16729) and never runs `git fetch`/`git push`.

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type TypeScriptModule from 'typescript';
import type { Node as TsNode, SourceFile as TsSourceFile } from 'typescript';

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx === -1 ? undefined : argv[idx + 1];
}

const WAVE_SLUG = 'mishmash-w9-filesystem-tranche';
const FORBIDDEN_PORTS = new Set([7456, 51012]);

function emergencyExit(errorMessage: string): never {
  try {
    const manifest = {
      wave: 'W9-filesystem',
      commit: 'unknown',
      treeDirty: true,
      baseCommit: 'unknown',
      wroteOk: false,
      gateIntegrityPinned: false,
      archiveOk: false,
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
      path.join(os.tmpdir(), 'verify-w9-filesystem-emergency-manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
  } catch {
    /* truly nothing more we can do */
  }
  console.error(`verify-w9-filesystem: FATAL during init: ${errorMessage}`);
  process.exit(1);
}

let repoRoot: string;
let proofDir: string;
let ts: typeof TypeScriptModule;
try {
  repoRoot = path.resolve(argValue('--repo') ?? process.cwd());
  proofDir = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'proof');
  fs.mkdirSync(proofDir, { recursive: true });
  fs.mkdirSync(path.join(proofDir, 'runs'), { recursive: true });
  ts = createRequire(path.join(repoRoot, 'package.json'))('typescript');
} catch (err) {
  emergencyExit(`init failed: ${String((err as Error)?.stack ?? err)}`);
}

function sh(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): { status: number; stdout: string; stderr: string; processError: boolean } {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? repoRoot,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 10 * 60_000,
    env: opts.env ?? process.env,
  });
  const processError = !!result.error || !!result.signal;
  if (result.error) {
    return { status: 1, stdout: result.stdout ?? '', stderr: `${result.stderr ?? ''}\n${String(result.error)}`, processError: true };
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '', processError };
}

function sha256Bytes(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function sha256File(absPath: string): string {
  return sha256Bytes(fs.readFileSync(absPath));
}
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'unnamed'
  );
}

// 'not-exercised' is a genuine third state, distinct from both 'pass' and
// 'fail': a criterion whose population to check was legitimately empty (a
// mechanical fact, e.g. zero exposure===0 fs-hit routes existed at
// baseCommit), so nothing was actually verified either way. Reporting such
// a case as 'pass' is the exact vacuous-.every()-over-an-empty-array
// failure shape; reporting it as 'fail' would be a false red for a state
// that is not actually wrong. It counts as `!== 'pass'` everywhere a
// consumer checks for green (this file's own exit code, and any future
// downstream consumer following VERIFICATION-CONTRACT.md's own
// `status === 'pass'` definition of green), so it can never silently pass
// as done -- it can only ever be visibly, honestly distinct.
type CriterionStatus = 'pass' | 'fail' | 'not-exercised';

interface CriterionResult {
  id: string;
  command: string;
  assertion: string;
  artifact: string | null;
  artifactSha256: string | null;
  exitCode: number;
  status: CriterionStatus;
  durationMs: number;
  detail?: string | undefined;
}

function artifactFor(id: string, content: string): { artifact: string | null; artifactSha256: string | null } {
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
  const fallbackResult = tryWrite(path.join(os.tmpdir(), 'verify-w9-filesystem-fallback-proof', `${id}.txt`));
  if (fallbackResult) return fallbackResult;
  console.error(`verify-w9-filesystem: artifact write failed for ${id} on both primary and fallback paths`);
  return { artifact: null, artifactSha256: null };
}

const results: CriterionResult[] = [];
function record(
  id: string,
  command: string,
  assertion: string,
  ok: boolean,
  evidence: string,
  opts: { detail?: string | undefined; durationMs?: number; status?: 'not-exercised' } = {},
): void {
  try {
    const wantsNotExercised = opts.status === 'not-exercised';
    const verdictLabel = wantsNotExercised ? 'not-exercised' : ok ? 'pass' : 'fail';
    const { artifact, artifactSha256 } = artifactFor(
      id,
      `# ${id}\n# assertion: ${assertion}\n# verdict: ${verdictLabel}\n${opts.detail ? `# detail: ${opts.detail}\n` : ''}\n${evidence}\n`,
    );
    const artifactWriteFailed = artifact === null;
    const status: CriterionStatus = artifactWriteFailed ? 'fail' : wantsNotExercised ? 'not-exercised' : ok ? 'pass' : 'fail';
    results.push({
      id,
      command,
      assertion,
      artifact,
      artifactSha256,
      exitCode: status === 'pass' ? 0 : 1,
      status,
      durationMs: opts.durationMs ?? 0,
      detail: artifactWriteFailed ? `${opts.detail ? `${opts.detail}; ` : ''}artifact write failed -- forced fail` : opts.detail,
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
    if (results.length === startIndex) {
      // The criterion body never called record() -- that is itself a defect
      // in this verifier, not a legitimate pass. Fail closed.
      record(id, '', '', false, 'criterion body completed without recording a result', {
        detail: 'internal verifier defect: no record() call',
        durationMs,
      });
    }
  } catch (err) {
    record(id, '', '', false, String((err as Error)?.stack ?? err), {
      detail: `criterion check crashed: ${String(err)}`,
      durationMs: Date.now() - startedAt,
    });
  }
}

// -----------------------------------------------------------------------
// Git context -- local refs only, no fetch/push (hard constraint).
// -----------------------------------------------------------------------
function gitOrFail(args: string[], why: string): string {
  const r = sh('git', args);
  if (r.status !== 0 || r.stdout.trim().length === 0) {
    throw new Error(`git ${args.join(' ')} failed (${why}): exit=${r.status} stdout=${r.stdout.trim().slice(0, 200) || '<empty>'}`);
  }
  return r.stdout.trim();
}
function resolveMainRefLocal(): string {
  for (const ref of ['origin/main', 'main']) {
    const verify = sh('git', ['rev-parse', '--verify', ref]);
    if (verify.status === 0 && verify.stdout.trim()) return ref;
  }
  throw new Error('could not resolve "origin/main" or "main" locally (no network ref-check -- this verifier never fetches)');
}
function writeEmergencyManifest(errorMessage: string, partialResults: CriterionResult[] = []): void {
  const manifest = {
    wave: 'W9-filesystem',
    commit: 'unknown',
    treeDirty: true,
    baseCommit: 'unknown',
    wroteOk: false,
    gateIntegrityPinned: false,
    archiveOk: false,
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
    /* fall through */
  }
  if (!wrote) {
    try {
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w9-filesystem-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
    } catch {
      /* last resort: stderr only */
    }
  }
  console.error(`verify-w9-filesystem: FATAL, emergency manifest written=${wrote}: ${errorMessage}`);
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
function isTreeDirty(): boolean {
  const r = sh('git', ['status', '--porcelain']);
  return r.status === 0 && r.stdout.trim().length > 0;
}
const treeDirtyAtStart = isTreeDirty();

/** Collapses ALL whitespace (not just leading/trailing) before lowercasing,
 * so a name/email comparison cannot be dodged by inserting an extra internal
 * space, tab, or non-breaking space -- a `.trim()`-only normalization still
 * lets "John  Doe" (double space) evade a match against committed author
 * "John Doe", which is exactly the kind of whitespace-satisfiable identity
 * check this verifier must not have. Applied identically on both the
 * committed-author side and the accepter/reviewer-field side, so neither can
 * be normalized differently to force a false non-match. */
function normalizeIdentity(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase();
}
function commitAuthorsBetween(fromExclusive: string, toInclusive: string): Set<string> {
  const r = sh('git', ['log', '--format=%an%x00%ae', `${fromExclusive}..${toInclusive}`]);
  const out = new Set<string>();
  if (r.status !== 0) return out;
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\x00');
    if (parts[0]) out.add(normalizeIdentity(parts[0]));
    if (parts[1]) out.add(normalizeIdentity(parts[1]));
  }
  return out;
}
function isAncestor(ancestor: string, descendant: string): boolean {
  return sh('git', ['merge-base', '--is-ancestor', ancestor, descendant]).status === 0;
}
function resolveCommit(sha: string): boolean {
  return sh('git', ['cat-file', '-e', `${sha}^{commit}`]).status === 0;
}

const gateIntegrityPinned = fs.existsSync(path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'approved-gate.sha256'));

// =========================================================================
// Two-phase manifest write (identical pattern to verify-w9-ingest.ts): a
// wroteOk:false placeholder is written IMMEDIATELY, before any criterion
// runs, overwriting whatever a prior run left. If the placeholder write
// itself fails, this run aborts.
// =========================================================================
interface ManifestShape {
  wave: string;
  commit: string;
  treeDirty: boolean;
  baseCommit: string;
  wroteOk: boolean;
  gateIntegrityPinned: boolean;
  archiveOk: boolean;
  toolchain: { node: string; pnpm: string };
  criteria: CriterionResult[];
}
function buildManifest(wroteOk: boolean, treeDirty: boolean, archiveOk: boolean): ManifestShape {
  return {
    wave: 'W9-filesystem',
    commit: headSha,
    treeDirty,
    baseCommit,
    wroteOk,
    gateIntegrityPinned,
    archiveOk,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: results,
  };
}
function writeManifestFile(manifest: ManifestShape): { written: boolean; sha256: string } {
  const manifestPath = path.join(proofDir, 'manifest.json');
  try {
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, manifestPath);
    const sha256 = sha256File(manifestPath);
    fs.writeFileSync(path.join(proofDir, 'manifest.sha256.txt'), `${sha256}\n`);
    return { written: true, sha256 };
  } catch (err) {
    try {
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w9-filesystem-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
      console.error(`verify-w9-filesystem: primary manifest write failed (${String(err)}); wrote fallback`);
    } catch (err2) {
      console.error(`verify-w9-filesystem: manifest write failed everywhere (${String(err)} / ${String(err2)})`);
    }
    return { written: false, sha256: 'unavailable' };
  }
}
function archiveRunArtifacts(manifest: ManifestShape): { runDir: string; ok: boolean } {
  const runDir = path.join(proofDir, 'runs', `${manifest.commit}-${Date.now()}-${process.pid}`);
  try {
    fs.mkdirSync(runDir, { recursive: true });
    const rewrittenCriteria: CriterionResult[] = [];
    for (const r of manifest.criteria) {
      if (!r.artifact || !fs.existsSync(r.artifact)) {
        rewrittenCriteria.push(r);
        continue;
      }
      const dest = path.join(runDir, path.basename(r.artifact));
      fs.copyFileSync(r.artifact, dest);
      rewrittenCriteria.push({ ...r, artifact: dest });
    }
    const selfContainedManifest: ManifestShape = { ...manifest, archiveOk: true, criteria: rewrittenCriteria };
    const manifestJsonPath = path.join(runDir, 'manifest.json');
    const tmpPath = path.join(runDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmpPath, JSON.stringify(selfContainedManifest, null, 2));
    fs.renameSync(tmpPath, manifestJsonPath);
    const computedSha = sha256File(manifestJsonPath);
    fs.writeFileSync(path.join(runDir, 'manifest.sha256.txt'), `${computedSha}\n`);

    const rereadRaw = fs.readFileSync(manifestJsonPath, 'utf8');
    const reread = JSON.parse(rereadRaw) as ManifestShape;
    if (reread.archiveOk !== true) return { runDir, ok: false };
    const rereadHash = sha256Bytes(rereadRaw);
    const recordedHash = fs.readFileSync(path.join(runDir, 'manifest.sha256.txt'), 'utf8').trim();
    if (rereadHash !== recordedHash) return { runDir, ok: false };
    for (const r of reread.criteria) {
      if (!r.artifact) continue;
      if (!fs.existsSync(r.artifact)) return { runDir, ok: false };
      if (!r.artifactSha256 || sha256File(r.artifact) !== r.artifactSha256) return { runDir, ok: false };
    }
    return { runDir, ok: true };
  } catch (err) {
    console.error(`verify-w9-filesystem: run-archive FAILED (this fails the run, no catch may restore ok:true): ${String(err)}`);
    return { runDir, ok: false };
  }
}

// =========================================================================
// SECTION: fs-reachability + exposure classifiers.
//
// Both classifiers operate on a `ts.Program` built from real files on disk
// (never regex/string scanning, per defect-catalog item 5). The inclusion
// (fs-reachability) classifier needs the FULL TypeChecker because most
// register*Routes handlers reach real filesystem code only through their
// own injected ctx/deps parameter (`const { helpers, plugins } = deps;`
// destructured at the top of the function, then `helpers.foo(...)` called
// from a handler) -- a purely syntactic import-following pass measurably
// undercounts (validated during this PRD's own authoring: 63 fs-hit routes
// with import-tracing alone vs. 125 with full TypeChecker resolution over
// the identical candidate set). The exposure classifier does not need this;
// middleware-array membership and the straight-line guard-in-body shape are
// both syntactic and unambiguous.
// =========================================================================
const FS_PRIMITIVE_READ = new Set([
  'readFile', 'readdir', 'stat', 'lstat', 'realpath', 'createReadStream', 'existsSync',
  'readFileSync', 'open', 'opendir', 'watch', 'watchFile',
]);
const FS_PRIMITIVE_WRITE = new Set([
  'writeFile', 'appendFile', 'unlink', 'rm', 'rmdir', 'mkdir', 'mkdtemp', 'rename', 'copyFile',
  'symlink', 'link', 'chmod', 'chown', 'truncate', 'cp', 'createWriteStream', 'writeFileSync',
]);
const FS_PRIMITIVE_NAMES = new Set<string>([...FS_PRIMITIVE_READ, ...FS_PRIMITIVE_WRITE]);
const MAX_CLASSIFY_DEPTH = 10;

function isFsModuleDeclFile(fileName: string): boolean {
  return /\/fs\.d\.ts$/.test(fileName) || /\/fs\/promises\.d\.ts$/.test(fileName);
}
function isMulterDeclFile(fileName: string): boolean {
  return /node_modules\/multer\//.test(fileName);
}
/** Declarations that live in TypeScript's own bundled lib files (JSON,
 * Math, String, Array, Object, Promise, console, ...), in @types/node's
 * non-filesystem, non-process-spawning modules (path, url, crypto, http,
 * buffer, os, querystring, stream, events, ...), or in @types/express's
 * Request/Response/Application/NextFunction surface are inspectable enough
 * to know they are NOT filesystem primitives -- treating them as UNRESOLVED
 * (the generic "any node_modules declaration" fallback) would be wrong in
 * the other direction: it would flag essentially every handler as
 * unresolved, since practically every Express handler calls `res.json`/
 * `res.send`/`res.status` and practically every function uses some JS
 * built-in. These are classified CLEAN-LEAF (contribute neither a hit nor
 * an unresolved mark) rather than recursed into or trusted as a positive
 * fs-hit signal. `child_process` is deliberately EXCLUDED from this
 * allowlist -- spawning is a different, adjacent threat boundary (the
 * agent-spawn tranche), and silently waving it through here would blur
 * that boundary rather than merely avoid a false "unresolved". `fs`/
 * `fs/promises` are excluded too, obviously -- those are the actual
 * positive signal this classifier exists to find, handled separately. */
function isKnownSafeBuiltinDeclFile(fileName: string): boolean {
  if (isFsModuleDeclFile(fileName)) return false;
  if (/\/typescript\/lib\/lib\.[a-z0-9.]+\.d\.ts$/.test(fileName)) return true;
  if (/node_modules\/@types\/node\/(path|url|crypto|http|https|buffer|os|querystring|stream|events|assert|util|net|dns|zlib|string_decoder|timers|tty)\.d\.ts$/.test(fileName)) {
    return true;
  }
  if (/node_modules\/@types\/node\/globals\.d\.ts$/.test(fileName)) return true;
  if (/node_modules\/@types\/(express|express-serve-static-core|serve-static)\//.test(fileName)) return true;
  return false;
}

interface ClassifyResult {
  fsHit: boolean;
  unresolved: boolean;
  hitPrimitives: Set<string>; // 'read' | 'write' | 'upload' | 'static'
}
function emptyResult(): ClassifyResult {
  return { fsHit: false, unresolved: false, hitPrimitives: new Set() };
}
function mergeInto(target: ClassifyResult, from: ClassifyResult): void {
  if (from.fsHit) target.fsHit = true;
  if (from.unresolved) target.unresolved = true;
  for (const p of from.hitPrimitives) target.hitPrimitives.add(p);
}

interface CallSiteDeps {
  propPathToNode: Map<string, TsNode>;
  spreadPresent: boolean;
}

class FsReachabilityClassifier {
  private checker: TypeScriptModule.TypeChecker;
  private serverSourceFile: TsSourceFile;
  private serverDeps: Map<string, CallSiteDeps[]>;
  private reachCache = new Map<TsNode, ClassifyResult>();
  private currentRegisterFnName = '';
  private currentCtxParamName: string | null = null;
  private currentAliasMap: Map<string, string> = new Map();

  constructor(
    private program: TypeScriptModule.Program,
    serverPath: string,
  ) {
    this.checker = program.getTypeChecker();
    const sf = program.getSourceFile(serverPath);
    if (!sf) throw new Error(`server.ts not found in program at ${serverPath}`);
    this.serverSourceFile = sf;
    this.serverDeps = this.collectServerCallSiteDeps();
  }

  private collectServerCallSiteDeps(): Map<string, CallSiteDeps[]> {
    const out = new Map<string, CallSiteDeps[]>();
    const walkObjectLiteral = (
      obj: TypeScriptModule.ObjectLiteralExpression,
      prefix: string,
      map: Map<string, TsNode>,
      flag: { spread: boolean },
    ): void => {
      for (const prop of obj.properties) {
        if (ts.isSpreadAssignment(prop)) {
          flag.spread = true;
          continue;
        }
        if (ts.isPropertyAssignment(prop)) {
          const key = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : null;
          if (!key) continue;
          const propPath = prefix ? `${prefix}.${key}` : key;
          map.set(propPath, prop.initializer);
          if (ts.isObjectLiteralExpression(prop.initializer)) walkObjectLiteral(prop.initializer, propPath, map, flag);
        } else if (ts.isShorthandPropertyAssignment(prop)) {
          const propPath = prefix ? `${prefix}.${prop.name.text}` : prop.name.text;
          map.set(propPath, prop.name);
        } else if (ts.isMethodDeclaration(prop) && prop.name && ts.isIdentifier(prop.name)) {
          const propPath = prefix ? `${prefix}.${prop.name.text}` : prop.name.text;
          map.set(propPath, prop);
        }
      }
    };
    const visit = (node: TsNode): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^register\w*Routes$/.test(node.expression.text)) {
        const fnName = node.expression.text;
        const depsArg = node.arguments[1];
        const flag = { spread: false };
        const map = new Map<string, TsNode>();
        if (depsArg && ts.isObjectLiteralExpression(depsArg)) walkObjectLiteral(depsArg, '', map, flag);
        else flag.spread = true;
        const arr = out.get(fnName) ?? [];
        arr.push({ propPathToNode: map, spreadPresent: flag.spread });
        out.set(fnName, arr);
      }
      ts.forEachChild(node, visit);
    };
    visit(this.serverSourceFile);
    return out;
  }

  setCurrentRegisterFn(fnName: string, ctxParamName: string | null, body: TsNode): void {
    this.currentRegisterFnName = fnName;
    this.currentCtxParamName = ctxParamName;
    this.currentAliasMap = ctxParamName ? this.collectCtxAliases(body, ctxParamName) : new Map();
  }

  private collectCtxAliases(body: TsNode, ctxName: string): Map<string, string> {
    const aliases = new Map<string, string>();
    const dottedFromCtx = (expr: TypeScriptModule.Expression): string | null => {
      if (ts.isIdentifier(expr)) return expr.text === ctxName ? '' : null;
      if (ts.isPropertyAccessExpression(expr)) {
        const base = dottedFromCtx(expr.expression);
        if (base === null) return null;
        return base ? `${base}.${expr.name.text}` : expr.name.text;
      }
      return null;
    };
    const tryBindingPattern = (name: TypeScriptModule.BindingName, basePath: string): void => {
      if (ts.isIdentifier(name)) {
        aliases.set(name.text, basePath);
        return;
      }
      if (ts.isObjectBindingPattern(name)) {
        for (const el of name.elements) {
          if (el.dotDotDotToken || !ts.isIdentifier(el.name)) continue;
          const propName = el.propertyName ? (ts.isIdentifier(el.propertyName) ? el.propertyName.text : null) : el.name.text;
          if (!propName) continue;
          aliases.set(el.name.text, basePath ? `${basePath}.${propName}` : propName);
        }
      }
    };
    const visit = (node: TsNode): void => {
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (!decl.initializer) continue;
          let basePath: string | null = dottedFromCtx(decl.initializer);
          if (basePath === null && ts.isIdentifier(decl.initializer) && aliases.has(decl.initializer.text)) {
            basePath = aliases.get(decl.initializer.text)!;
          } else if (basePath === null && ts.isPropertyAccessExpression(decl.initializer)) {
            let cur: TypeScriptModule.Expression = decl.initializer;
            const suffix: string[] = [];
            while (ts.isPropertyAccessExpression(cur)) {
              suffix.unshift(cur.name.text);
              cur = cur.expression;
            }
            if (ts.isIdentifier(cur) && aliases.has(cur.text)) basePath = [aliases.get(cur.text)!, ...suffix].filter(Boolean).join('.');
          }
          if (basePath !== null) tryBindingPattern(decl.name, basePath);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
    return aliases;
  }

  private primitiveKindFor(name: string): 'read' | 'write' | null {
    if (FS_PRIMITIVE_READ.has(name)) return 'read';
    if (FS_PRIMITIVE_WRITE.has(name)) return 'write';
    return null;
  }

  private functionLikeBody(decl: TypeScriptModule.Declaration): TsNode | null {
    if (ts.isFunctionDeclaration(decl) || ts.isFunctionExpression(decl) || ts.isArrowFunction(decl) || ts.isMethodDeclaration(decl)) {
      return decl.body ?? null;
    }
    if (ts.isPropertyAssignment(decl) && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
      return decl.initializer.body;
    }
    if (
      ts.isVariableDeclaration(decl) &&
      decl.initializer &&
      (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
    ) {
      return decl.initializer.body;
    }
    return null;
  }
  private isTypeOnlyDeclaration(decl: TypeScriptModule.Declaration): boolean {
    return (
      ts.isPropertySignature(decl) ||
      ts.isMethodSignature(decl) ||
      ts.isParameter(decl) ||
      ts.isInterfaceDeclaration(decl) ||
      ts.isTypeAliasDeclaration(decl)
    );
  }
  private callExpressionsIn(node: TsNode): TypeScriptModule.CallExpression[] {
    const out: TypeScriptModule.CallExpression[] = [];
    const visit = (n: TsNode): void => {
      if (ts.isCallExpression(n)) out.push(n);
      ts.forEachChild(n, visit);
    };
    visit(node);
    return out;
  }

  private classifySymbolDecls(symbol: TypeScriptModule.Symbol, depth: number): ClassifyResult {
    let resolved = symbol;
    if (resolved.flags & ts.SymbolFlags.Alias) {
      try {
        resolved = this.checker.getAliasedSymbol(resolved);
      } catch {
        /* keep original */
      }
    }
    const decls = resolved.declarations ?? [];
    if (decls.length === 0) return { fsHit: false, unresolved: true, hitPrimitives: new Set() };
    const name = resolved.getName();
    if (decls.some((d) => isFsModuleDeclFile(d.getSourceFile().fileName))) {
      const kind = this.primitiveKindFor(name);
      if (kind) return { fsHit: true, unresolved: false, hitPrimitives: new Set([kind]) };
    }
    if (decls.some((d) => isMulterDeclFile(d.getSourceFile().fileName))) {
      return { fsHit: true, unresolved: false, hitPrimitives: new Set(['upload']) };
    }
    const merged = emptyResult();
    let foundBody = false;
    let anyKnownSafe = false;
    for (const decl of decls) {
      const declFile = decl.getSourceFile().fileName;
      if (declFile.includes('/node_modules/')) {
        if (isKnownSafeBuiltinDeclFile(declFile)) {
          anyKnownSafe = true;
        } else {
          merged.unresolved = true;
        }
        continue;
      }
      if (this.isTypeOnlyDeclaration(decl)) {
        merged.unresolved = true;
        continue;
      }
      const body = this.functionLikeBody(decl);
      if (body) {
        foundBody = true;
        mergeInto(merged, this.reachable(body, depth + 1));
      }
    }
    if (!foundBody && !anyKnownSafe) merged.unresolved = true;
    return merged;
  }

  /** Type-based property descent for a bound expression whose own properties
   * were never spelled out at the server.ts call site (e.g. `helpers:
   * pluginRouteHelpers` then `helpers.foo(...)` in the route file). */
  private descendTypeProperties(baseExpr: TypeScriptModule.Expression, segments: string[], depth: number): ClassifyResult {
    if (segments.length === 0) {
      // `checker.getSymbolAtLocation` on a SHORTHAND object-literal property
      // reference (`{ listDir }`) resolves to the PROPERTY's own symbol
      // (declaration: the ShorthandPropertyAssignment itself), not the
      // outer-scope value it actually refers to -- a real TypeScript API
      // distinction, not a bug in the caller's usage. `checker
      // .getShorthandAssignmentValueSymbol` is the dedicated API for
      // resolving through to that real value symbol; without it, every
      // `server.ts` deps object literal using shorthand (`{ helpers,
      // plugins, listDir }` -- the repo's own dominant style) would
      // misresolve to the property declaration and report UNRESOLVED
      // instead of following through to the real, inspectable function.
      const symbol = ts.isShorthandPropertyAssignment(baseExpr.parent)
        ? (this.checker.getShorthandAssignmentValueSymbol(baseExpr.parent) ?? this.checker.getSymbolAtLocation(baseExpr))
        : this.checker.getSymbolAtLocation(baseExpr);
      if (!symbol) return { fsHit: false, unresolved: true, hitPrimitives: new Set() };
      return this.classifySymbolDecls(symbol, depth);
    }
    let currentType = this.checker.getTypeAtLocation(baseExpr);
    let lastSymbol: TypeScriptModule.Symbol | null = null;
    for (const seg of segments) {
      const propSymbol = currentType.getProperty(seg);
      if (!propSymbol) return { fsHit: false, unresolved: true, hitPrimitives: new Set() };
      lastSymbol = propSymbol;
      currentType = this.checker.getTypeOfSymbolAtLocation(propSymbol, baseExpr);
    }
    if (!lastSymbol) return { fsHit: false, unresolved: true, hitPrimitives: new Set() };
    return this.classifySymbolDecls(lastSymbol, depth);
  }

  private resolveBoundNode(boundNode: TsNode, suffix: string[], depth: number): ClassifyResult {
    if (ts.isMethodDeclaration(boundNode)) {
      return boundNode.body ? this.reachable(boundNode.body, depth + 1) : { fsHit: false, unresolved: true, hitPrimitives: new Set() };
    }
    if (ts.isArrowFunction(boundNode) || ts.isFunctionExpression(boundNode)) {
      return boundNode.body ? this.reachable(boundNode.body, depth + 1) : { fsHit: false, unresolved: true, hitPrimitives: new Set() };
    }
    return this.descendTypeProperties(boundNode as TypeScriptModule.Expression, suffix, depth);
  }

  private tryCtxFallback(callee: TypeScriptModule.Expression, depth: number): ClassifyResult | null {
    if (!this.currentCtxParamName) return null;
    const dottedFromCtx = (expr: TypeScriptModule.Expression): string | null => {
      if (ts.isIdentifier(expr)) return expr.text === this.currentCtxParamName ? '' : null;
      if (ts.isPropertyAccessExpression(expr)) {
        const base = dottedFromCtx(expr.expression);
        if (base === null) return null;
        return base ? `${base}.${expr.name.text}` : expr.name.text;
      }
      return null;
    };
    let dotted: string | null = dottedFromCtx(callee);
    if (dotted === null) {
      let cur: TypeScriptModule.Expression = callee;
      const suffix: string[] = [];
      while (ts.isPropertyAccessExpression(cur)) {
        suffix.unshift(cur.name.text);
        cur = cur.expression;
      }
      if (ts.isIdentifier(cur) && this.currentAliasMap.has(cur.text)) {
        dotted = [this.currentAliasMap.get(cur.text)!, ...suffix].filter(Boolean).join('.');
      } else if (ts.isIdentifier(cur) && cur.text === this.currentCtxParamName) {
        dotted = suffix.join('.');
      }
    }
    if (dotted === null) return null;
    const segments = dotted.split('.').filter(Boolean);
    const sites = this.serverDeps.get(this.currentRegisterFnName) ?? [];
    if (sites.length === 0) return { fsHit: false, unresolved: true, hitPrimitives: new Set() };
    const merged = emptyResult();
    for (const site of sites) {
      if (site.spreadPresent) {
        merged.unresolved = true;
        continue;
      }
      let matched = false;
      for (let cut = segments.length; cut >= 1; cut--) {
        const prefixPath = segments.slice(0, cut).join('.');
        const boundNode = site.propPathToNode.get(prefixPath);
        if (boundNode) {
          mergeInto(merged, this.resolveBoundNode(boundNode, segments.slice(cut), depth));
          matched = true;
          break;
        }
      }
      if (!matched) merged.unresolved = true;
    }
    return merged;
  }

  private classifyCallee(callExpr: TypeScriptModule.CallExpression, depth: number): ClassifyResult {
    const callee = callExpr.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      const memberName = callee.name.text;
      if (memberName === 'sendFile' || memberName === 'download') {
        return { fsHit: true, unresolved: false, hitPrimitives: new Set(['read']) };
      }
      if (ts.isIdentifier(callee.expression) && callee.expression.text === 'express' && memberName === 'static') {
        return { fsHit: true, unresolved: false, hitPrimitives: new Set(['static']) };
      }
    }
    const symbol = this.checker.getSymbolAtLocation(callee);
    let decls: readonly TypeScriptModule.Declaration[] = [];
    if (symbol) {
      let resolved = symbol;
      if (resolved.flags & ts.SymbolFlags.Alias) {
        try {
          resolved = this.checker.getAliasedSymbol(resolved);
        } catch {
          /* keep */
        }
      }
      decls = resolved.declarations ?? [];
      const name = resolved.getName();
      if (decls.some((d) => isFsModuleDeclFile(d.getSourceFile().fileName))) {
        const kind = this.primitiveKindFor(name);
        if (kind) return { fsHit: true, unresolved: false, hitPrimitives: new Set([kind]) };
      }
      if (decls.some((d) => isMulterDeclFile(d.getSourceFile().fileName))) {
        return { fsHit: true, unresolved: false, hitPrimitives: new Set(['upload']) };
      }
      // A symbol whose EVERY declaration is a known-safe builtin (TS lib,
      // @types/node's non-fs modules, @types/express's Request/Response
      // surface -- e.g. `res.json`, `res.status`, `JSON.stringify`) is
      // resolved enough to know it is not a filesystem touch. Short-circuit
      // here so it neither falls through to the ctx-fallback machinery
      // (which exists for genuinely UNRESOLVABLE-otherwise calls) nor to
      // the generic node_modules-means-unresolved rule below -- without
      // this, essentially every Express handler (every one calls `res.json`
      // or similar) would register as UNRESOLVED regardless of its real
      // filesystem behavior, which measurably happened during this
      // classifier's own authoring and is exactly the failure mode this
      // check exists to close.
      if (decls.length > 0 && decls.every((d) => isKnownSafeBuiltinDeclFile(d.getSourceFile().fileName))) {
        return { fsHit: false, unresolved: false, hitPrimitives: new Set() };
      }
    }
    const onlyTypeOnly = decls.length > 0 && decls.every((d) => this.isTypeOnlyDeclaration(d));
    if (decls.length === 0 || onlyTypeOnly) {
      const fallback = this.tryCtxFallback(callee, depth);
      if (fallback) return fallback;
    }
    if (decls.length === 0) return { fsHit: false, unresolved: true, hitPrimitives: new Set() };
    const merged = emptyResult();
    let foundBody = false;
    let anyKnownSafe = false;
    for (const decl of decls) {
      const declFile = decl.getSourceFile().fileName;
      if (declFile.includes('/node_modules/')) {
        if (isKnownSafeBuiltinDeclFile(declFile)) {
          anyKnownSafe = true;
        } else {
          merged.unresolved = true;
        }
        continue;
      }
      const body = this.functionLikeBody(decl);
      if (body) {
        foundBody = true;
        mergeInto(merged, this.reachable(body, depth + 1));
      }
    }
    if (!foundBody && !anyKnownSafe) merged.unresolved = true;
    return merged;
  }

  reachable(body: TsNode, depth: number): ClassifyResult {
    if (depth > MAX_CLASSIFY_DEPTH) return { fsHit: false, unresolved: true, hitPrimitives: new Set() };
    if (this.reachCache.has(body)) return this.reachCache.get(body)!;
    this.reachCache.set(body, emptyResult());
    const merged = emptyResult();
    for (const call of this.callExpressionsIn(body)) {
      mergeInto(merged, this.classifyCallee(call, depth));
    }
    this.reachCache.set(body, merged);
    return merged;
  }
}

// -----------------------------------------------------------------------
// Exposure classifier -- syntactic only (middleware-array membership is
// unambiguous; the straight-line in-body grammar mirrors verify-w9-ingest.ts
// exactly). 0 = requireLocalDaemonRequest, 1 = authorizeToolRequest
// (middleware-array OR straight-line in-body guard), 3 = neither. Tier 2 is
// reserved and unused in this tranche (documented in the PRD).
// -----------------------------------------------------------------------
function middlewareArrayHasGuard(middlewareArgs: readonly TsNode[], guardName: string): boolean {
  return middlewareArgs.some((arg) => {
    if (ts.isIdentifier(arg)) return arg.text === guardName;
    if (ts.isPropertyAccessExpression(arg)) return arg.name.text === guardName;
    return false;
  });
}
function isApplyExtensionCorsPrelude(stmt: TsNode): boolean {
  return (
    ts.isExpressionStatement(stmt) &&
    ts.isCallExpression(stmt.expression) &&
    ts.isIdentifier(stmt.expression.expression) &&
    stmt.expression.expression.text === 'applyExtensionCors'
  );
}
function consequentUnconditionallyExits(stmt: TsNode): boolean {
  if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true;
  if (ts.isBlock(stmt)) {
    const stmts = stmt.statements;
    if (stmts.length === 0) return false;
    const last = stmts[stmts.length - 1]!;
    if (!(ts.isReturnStatement(last) || ts.isThrowStatement(last))) return false;
    for (let i = 0; i < stmts.length - 1; i++) {
      const s = stmts[i]!;
      if (
        ts.isIfStatement(s) ||
        ts.isForStatement(s) ||
        ts.isForInStatement(s) ||
        ts.isForOfStatement(s) ||
        ts.isWhileStatement(s) ||
        ts.isDoStatement(s) ||
        ts.isSwitchStatement(s) ||
        ts.isTryStatement(s)
      ) {
        return false;
      }
    }
    return true;
  }
  return false;
}
function bodyHasStraightLineToolTokenGuard(handler: TsNode): boolean {
  if (!(ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) || !handler.body || !ts.isBlock(handler.body)) return false;
  const statements = handler.body.statements;
  const startIdx = statements.length > 0 && isApplyExtensionCorsPrelude(statements[0]!) ? 1 : 0;
  const s0 = statements[startIdx];
  if (!s0 || !ts.isVariableStatement(s0)) return false;
  if ((s0.declarationList.flags & ts.NodeFlags.Const) === 0) return false;
  const decls = s0.declarationList.declarations;
  if (decls.length !== 1) return false;
  const decl = decls[0]!;
  if (!ts.isIdentifier(decl.name) || !decl.initializer || !ts.isCallExpression(decl.initializer)) return false;
  if (!ts.isIdentifier(decl.initializer.expression) || decl.initializer.expression.text !== 'authorizeToolRequest') return false;
  const varName = decl.name.text;
  const s1 = statements[startIdx + 1];
  if (!s1 || !ts.isIfStatement(s1)) return false;
  const isNegation =
    ts.isPrefixUnaryExpression(s1.expression) &&
    s1.expression.operator === ts.SyntaxKind.ExclamationToken &&
    ts.isIdentifier(s1.expression.operand) &&
    s1.expression.operand.text === varName;
  if (!isNegation) return false;
  return consequentUnconditionallyExits(s1.thenStatement);
}
function classifyExposure(middlewareArgs: readonly TsNode[], handler: TsNode): 0 | 1 | 3 {
  if (middlewareArrayHasGuard(middlewareArgs, 'requireLocalDaemonRequest')) return 0;
  if (middlewareArrayHasGuard(middlewareArgs, 'authorizeToolRequest')) return 1;
  if (bodyHasStraightLineToolTokenGuard(handler)) return 1;
  return 3;
}

// -----------------------------------------------------------------------
// SECTION: route universe discovery + registration collection.
// -----------------------------------------------------------------------
const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'options', 'patch']);
const REGISTER_ROUTES_NAME_RE = /^register\w*Routes$/;
function resolveRelativeImportToSrcFile(fromFileAbs: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  let resolved = path.resolve(path.dirname(fromFileAbs), spec);
  if (resolved.endsWith('.js')) resolved = resolved.slice(0, -3) + '.ts';
  else if (!resolved.endsWith('.ts')) resolved = resolved + '.ts';
  if (fs.existsSync(resolved)) return resolved;
  const idx = path.join(resolved.replace(/\.ts$/, ''), 'index.ts');
  if (fs.existsSync(idx)) return idx;
  return null;
}
/** Every relative named import in a file, mapped identifier -> resolved
 * source file. Shared base for both the register*Routes-only universe walk
 * below and the non-Routes-named "helper registrar" recognizer further
 * down -- both are the same "which local identifier points at which file"
 * question, filtered differently. */
function collectRelativeNamedImports(sourceFile: TsSourceFile, fromFileAbs: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const clause = stmt.importClause;
    if (!clause || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    const resolvedFile = resolveRelativeImportToSrcFile(fromFileAbs, stmt.moduleSpecifier.text);
    if (!resolvedFile) continue;
    for (const el of clause.namedBindings.elements) {
      map.set(el.name.text, resolvedFile);
    }
  }
  return map;
}
/** register*Routes-named identifiers CALLED inside a register*Routes
 * function body, that are themselves relative-imported in the SAME file --
 * e.g. routes/project/index.ts's registerProjectRoutes calling
 * registerProjectConversationRoutes(...), imported from ./conversations.ts
 * (which in turn calls registerProjectCommentRoutes(...) from ./comments.ts
 * -- two real hops, both confirmed by reading the source directly, not
 * hypothetical). `server.ts` never imports either file, so the old
 * one-hop-from-server.ts-only walk never visited them. */
function calledRegisterRoutesImports(body: TsNode, importMap: Map<string, string>): Set<string> {
  const found = new Set<string>();
  const visit = (node: TsNode): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && REGISTER_ROUTES_NAME_RE.test(node.expression.text)) {
      const resolvedFile = importMap.get(node.expression.text);
      if (resolvedFile) found.add(resolvedFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}
/** Route-file universe, discovered TRANSITIVELY: seed from server.ts's own
 * register*Routes imports (as before), then for every register*Routes
 * function body found in a discovered file, follow any FURTHER
 * register*Routes-named call resolved via that file's own relative
 * imports, repeating until no new files appear. A worklist with a visited
 * set, so a cycle (none exist today) can never loop forever.
 *
 * `library.ts` is a TERMINAL node in this walk, never expanded: it is
 * called with `registerBackupRoutes(...)` internally (confirmed by reading
 * the source), and the live-daemon drift comparison in checkC9F1
 * deliberately excludes `/api/backup`/`/api/restore` from the LIVE side as
 * "registered via registerBackupRoutes(...) called from INSIDE the
 * excluded library.ts". Recursing into library.ts's own body would
 * re-discover `apps/daemon/src/backup/routes.ts` as an independent route
 * file and put its two registrations back in the STATIC candidate set,
 * producing a NEW baseCommit=1/live=0 drift entry that fixing item 1 must
 * not introduce -- the sibling tranche's file boundary stays a hard stop
 * for this walk exactly as it already is for the flat per-file loop below. */
function discoverRouteFileUniverse(
  program: TypeScriptModule.Program,
  serverSourceFile: TsSourceFile,
  serverPath: string,
  root: string,
): Set<string> {
  const libraryRoutesAbs = path.join(root, LIBRARY_ROUTES_RELPATH);
  const visited = new Set<string>();
  const worklist: string[] = [];
  for (const [name, file] of collectRelativeNamedImports(serverSourceFile, serverPath)) {
    if (REGISTER_ROUTES_NAME_RE.test(name)) worklist.push(file);
  }
  while (worklist.length > 0) {
    const file = worklist.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    if (file === libraryRoutesAbs) continue;
    const sourceFile = program.getSourceFile(file);
    if (!sourceFile) continue;
    const importMap = collectRelativeNamedImports(sourceFile, file);
    if (importMap.size === 0) continue;
    for (const { body } of findRegisterFunctionBodies(sourceFile)) {
      for (const resolvedFile of calledRegisterRoutesImports(body, importMap)) {
        if (!visited.has(resolvedFile)) worklist.push(resolvedFile);
      }
    }
  }
  return visited;
}
interface RegisterFnBody {
  name: string;
  body: TsNode;
  ctxParamName: string | null;
}
function findRegisterFunctionBodies(sourceFile: TsSourceFile): RegisterFnBody[] {
  const out: RegisterFnBody[] = [];
  const ctxName = (params: readonly TypeScriptModule.ParameterDeclaration[]): string | null => {
    const p1 = params[1];
    return p1 && ts.isIdentifier(p1.name) ? p1.name.text : null;
  };
  const visit = (node: TsNode): void => {
    if (ts.isFunctionDeclaration(node) && node.name && /^register\w*Routes$/.test(node.name.text) && node.body) {
      out.push({ name: node.name.text, body: node.body, ctxParamName: ctxName(node.parameters) });
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          /^register\w*Routes$/.test(decl.name.text) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) &&
          decl.initializer.body
        ) {
          out.push({ name: decl.name.text, body: decl.initializer.body, ctxParamName: ctxName(decl.initializer.parameters) });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}
interface AppCall {
  method: string;
  routePath: string;
  middlewareArgs: TsNode[];
  handler: TsNode;
}
/** Resolves a path argument that is not a literal but IS a named-const
 * string bound elsewhere -- possibly imported cross-file OR cross-package
 * (both real: `DIAGNOSTICS_EXPORT_PATH` from `@open-design/diagnostics`,
 * `ATTRIBUTION_CLAIM_PATH` from `@open-design/contracts`, confirmed by
 * reading both call sites and their packages' own git-tracked `src/*.ts`
 * directly -- `buildDaemonProgram`'s `paths` override, above, is what makes
 * "cross-package" resolve to that package's SOURCE rather than its build
 * artifact; see the F1 fix note there for why that boundary matters). Reading
 * the TYPE at the identifier's use site -- rather than re-deriving it from a
 * same-file AST initializer -- resolves same-file, cross-file, and
 * cross-package consts uniformly, because TypeScript never widens a `const`
 * binding's own inferred type: that holds whether the declaration comes from
 * a `.ts` source file or a rolled-up `.d.ts` (`export declare const X =
 * "literal";`), so this mechanism is unchanged by which of the two the
 * resolved module happens to be. */
function resolveStaticPathLiteral(pathArg: TsNode, checker: TypeScriptModule.TypeChecker): string | null {
  if (ts.isStringLiteral(pathArg)) return pathArg.text;
  if (!ts.isIdentifier(pathArg)) return null;
  const type = checker.getTypeAtLocation(pathArg);
  return type.isStringLiteral() ? type.value : null;
}
function findEnclosingFunctionLike(
  node: TsNode,
): TypeScriptModule.FunctionExpression | TypeScriptModule.ArrowFunction | TypeScriptModule.FunctionDeclaration | null {
  let cur: TsNode | undefined = node.parent;
  while (cur) {
    if (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur) || ts.isFunctionDeclaration(cur)) return cur;
    cur = cur.parent;
  }
  return null;
}
/** When a path argument is an Identifier bound to a PARAMETER of the
 * immediately-enclosing function rather than a module-level const, the
 * literal path values live at THAT function's OWN call sites instead --
 * confirmed by reading routes/chat.ts directly: a local `const
 * registerByokToolChatProxy = (routePath, opts) => { app.post(routePath,
 * ...) }`, defined once inside `registerChatRoutes` and invoked twice with
 * literal paths (`/api/proxy/senseaudio/stream`, `/api/proxy/aihubmix/
 * stream`). Resolves by finding the enclosing function's own const-binding
 * name, then every call to that name within the SAME scanned scope,
 * substituting the literal argument at the matching parameter position. */
function resolveClosureParameterPathLiterals(pathArg: TypeScriptModule.Identifier, scopeRoot: TsNode): string[] {
  const enclosing = findEnclosingFunctionLike(pathArg);
  if (!enclosing) return [];
  const paramIndex = enclosing.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === pathArg.text);
  if (paramIndex === -1) return [];
  let boundName: string | null = null;
  if (ts.isVariableDeclaration(enclosing.parent) && ts.isIdentifier(enclosing.parent.name)) {
    boundName = enclosing.parent.name.text;
  } else if (ts.isFunctionDeclaration(enclosing) && enclosing.name) {
    boundName = enclosing.name.text;
  }
  if (!boundName) return [];
  const literals: string[] = [];
  const visit = (node: TsNode): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === boundName) {
      const arg = node.arguments[paramIndex];
      if (arg && ts.isStringLiteral(arg)) literals.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(scopeRoot);
  return literals;
}
function collectAppCalls(scopeRoot: TsNode, checker: TypeScriptModule.TypeChecker): AppCall[] {
  const out: AppCall[] = [];
  const visit = (node: TsNode): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'app' &&
      HTTP_METHODS.has(node.expression.name.text)
    ) {
      const [pathArg, ...rest] = node.arguments;
      if (pathArg && rest.length > 0) {
        const method = node.expression.name.text.toUpperCase();
        const middlewareArgs = rest.slice(0, -1);
        const handler = rest[rest.length - 1]!;
        const literal = resolveStaticPathLiteral(pathArg, checker);
        if (literal !== null) {
          out.push({ method, routePath: literal, middlewareArgs, handler });
        } else if (ts.isIdentifier(pathArg)) {
          for (const routePath of resolveClosureParameterPathLiterals(pathArg, scopeRoot)) {
            out.push({ method, routePath, middlewareArgs, handler });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scopeRoot);
  return out;
}
interface JsonRouteSpecInfo {
  method: string;
  routePath: string;
  handleExpr: TsNode;
}
/** Resolves a `mountJsonRoute(app, SPEC, ...)` call's SPEC argument back to
 * the `defineJsonRoute({ method, path, handle, ... })` call that produced
 * it (directly inline, or -- the real shape -- through a module-level
 * `const` binding resolved via the checker, which also follows re-exports
 * transparently). Extracts the `method`/`path` string literals and the
 * `handle` expression. */
function resolveJsonRouteSpec(specExpr: TsNode, checker: TypeScriptModule.TypeChecker): JsonRouteSpecInfo | null {
  let initializer: TsNode | null = ts.isCallExpression(specExpr) ? specExpr : null;
  if (!initializer && ts.isIdentifier(specExpr)) {
    let symbol = checker.getSymbolAtLocation(specExpr);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      try {
        symbol = checker.getAliasedSymbol(symbol);
      } catch {
        /* keep original */
      }
    }
    const decl = symbol?.declarations?.find(
      (d): d is TypeScriptModule.VariableDeclaration => ts.isVariableDeclaration(d) && !!d.initializer,
    );
    initializer = decl?.initializer ?? null;
  }
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  if (!ts.isIdentifier(initializer.expression) || initializer.expression.text !== 'defineJsonRoute') return null;
  const specObj = initializer.arguments[0];
  if (!specObj || !ts.isObjectLiteralExpression(specObj)) return null;
  let method: string | null = null;
  let routePath: string | null = null;
  let handleExpr: TsNode | null = null;
  for (const prop of specObj.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    if (prop.name.text === 'method' && ts.isStringLiteral(prop.initializer)) method = prop.initializer.text;
    if (prop.name.text === 'path' && ts.isStringLiteral(prop.initializer)) routePath = prop.initializer.text;
    if (prop.name.text === 'handle') handleExpr = prop.initializer;
  }
  if (!method || !routePath || !handleExpr || !HTTP_METHODS.has(method)) return null;
  return { method: method.toUpperCase(), routePath, handleExpr };
}
/** Resolves a bare identifier reference to the actual function node it
 * names, so `reachable()`/`classifyExposure()` walk real code instead of
 * an identifier leaf with no call-expression descendants. Needed for
 * `defineJsonRoute({ handle: someNamedFn })`, where the handler is
 * referenced by name rather than defined inline. */
function resolveNamedFunctionNode(expr: TsNode, checker: TypeScriptModule.TypeChecker): TsNode {
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr) || ts.isFunctionDeclaration(expr)) return expr;
  if (!ts.isIdentifier(expr)) return expr;
  let symbol = checker.getSymbolAtLocation(expr);
  if (!symbol) return expr;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      symbol = checker.getAliasedSymbol(symbol);
    } catch {
      /* keep original */
    }
  }
  for (const decl of symbol.declarations ?? []) {
    if (ts.isFunctionDeclaration(decl)) return decl;
    if (ts.isVariableDeclaration(decl) && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
      return decl.initializer;
    }
  }
  return expr;
}
/** Recognizes the declarative `defineJsonRoute`/`mountJsonRoute`
 * route-registration shape (`apps/daemon/src/http/adapter.ts`) as an
 * alternative to the literal `app.<method>(pathLiteral, ...)` call the rest
 * of this scan matches -- confirmed by reading routes/active-context.ts
 * directly (`mountJsonRoute(app, postActiveRoute, ...)` where
 * `postActiveRoute = defineJsonRoute({ method: 'post', path: '/api/active',
 * ... })`). The actual `app[spec.method](spec.path, ...)` Express call
 * lives inside `mountJsonRoute`'s OWN body with a COMPUTED method/path, so
 * it can never be discovered by scanning that body -- the literal values
 * only exist at each route's own `defineJsonRoute({...})` call, resolved
 * back through `mountJsonRoute`'s spec argument here instead. */
function collectMountJsonRouteCalls(scopeRoot: TsNode, checker: TypeScriptModule.TypeChecker): AppCall[] {
  const out: AppCall[] = [];
  const visit = (node: TsNode): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'mountJsonRoute' &&
      node.arguments.length >= 2 &&
      ts.isIdentifier(node.arguments[0]!) &&
      node.arguments[0]!.text === 'app'
    ) {
      const spec = resolveJsonRouteSpec(node.arguments[1]!, checker);
      if (spec) {
        out.push({
          method: spec.method,
          routePath: spec.routePath,
          middlewareArgs: [],
          handler: resolveNamedFunctionNode(spec.handleExpr, checker),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scopeRoot);
  return out;
}
/** app.<method>(...) calls at the top level of server.ts, NOT inside any
 * register*Routes-named function -- the 6 bootstrap routes. */
function collectBootstrapAppCalls(sourceFile: TsSourceFile, checker: TypeScriptModule.TypeChecker): AppCall[] {
  const insideRegisterFn = new Set<TsNode>();
  for (const { body } of findRegisterFunctionBodies(sourceFile)) insideRegisterFn.add(body);
  const out: AppCall[] = [];
  const visit = (node: TsNode, inExcluded: boolean): void => {
    const nowExcluded = inExcluded || insideRegisterFn.has(node);
    if (
      !nowExcluded &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'app' &&
      HTTP_METHODS.has(node.expression.name.text)
    ) {
      const [pathArg, ...rest] = node.arguments;
      if (pathArg && rest.length > 0) {
        const literal = resolveStaticPathLiteral(pathArg, checker);
        if (literal !== null) {
          out.push({
            method: node.expression.name.text.toUpperCase(),
            routePath: literal,
            middlewareArgs: rest.slice(0, -1),
            handler: rest[rest.length - 1]!,
          });
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, nowExcluded));
  };
  visit(sourceFile, false);
  return out;
}
/** A route-registration helper called directly from server.ts's own
 * bootstrap code that does NOT match the register*Routes naming convention
 * (so the transitive walk above never visits it), whose own body -- in a
 * DIFFERENT file -- performs its own literal app.<method>() registrations.
 * Confirmed by reading both sides directly:
 * `registerStaticSpaFallback(app, STATIC_DIR)` in server.ts's own bootstrap
 * sequence -> `apps/daemon/src/static-spa.ts`'s own `app.get('/*splat',
 * ...)`. Recognized structurally, not by name: an in-repo,
 * relative-imported function called from server.ts's bootstrap scope
 * (never inside a register*Routes body -- those already get scanned via
 * the recursive walk) with the literal identifier `app` as one of its own
 * arguments -- the same "the callee actually holds the Express app" signal
 * register*Routes functions themselves rely on throughout this file. */
function collectBootstrapHelperRegistrarCalls(
  serverSourceFile: TsSourceFile,
  program: TypeScriptModule.Program,
  root: string,
  serverPath: string,
  checker: TypeScriptModule.TypeChecker,
): Array<{ call: AppCall; relFile: string; fnName: string }> {
  const importMap = collectRelativeNamedImports(serverSourceFile, serverPath);
  const routeFileSet = new Set(
    [...importMap.entries()].filter(([name]) => REGISTER_ROUTES_NAME_RE.test(name)).map(([, file]) => file),
  );
  const insideRegisterFn = new Set<TsNode>();
  for (const { body } of findRegisterFunctionBodies(serverSourceFile)) insideRegisterFn.add(body);

  const out: Array<{ call: AppCall; relFile: string; fnName: string }> = [];
  const seenHelpers = new Set<string>();
  const visit = (node: TsNode, inExcluded: boolean): void => {
    const nowExcluded = inExcluded || insideRegisterFn.has(node);
    if (
      !nowExcluded &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      importMap.has(node.expression.text) &&
      !REGISTER_ROUTES_NAME_RE.test(node.expression.text) &&
      node.arguments.some((a) => ts.isIdentifier(a) && a.text === 'app')
    ) {
      const fnName = node.expression.text;
      const resolvedFile = importMap.get(fnName)!;
      const dedupeKey = `${resolvedFile}::${fnName}`;
      if (!routeFileSet.has(resolvedFile) && !seenHelpers.has(dedupeKey)) {
        seenHelpers.add(dedupeKey);
        const helperSourceFile = program.getSourceFile(resolvedFile);
        const fnBody = helperSourceFile ? findNamedFunctionBody(helperSourceFile, fnName) : null;
        if (fnBody) {
          const relFile = path.relative(root, resolvedFile).split(path.sep).join('/');
          for (const call of collectAppCalls(fnBody, checker)) out.push({ call, relFile, fnName });
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, nowExcluded));
  };
  visit(serverSourceFile, false);
  return out;
}
function findNamedFunctionBody(sourceFile: TsSourceFile, name: string): TsNode | null {
  let found: TsNode | null = null;
  const visit = (node: TsNode): void => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) {
      found = node.body;
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === name &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) &&
          decl.initializer.body
        ) {
          found = decl.initializer.body;
          return;
        }
      }
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

const LIBRARY_ROUTES_RELPATH = 'apps/daemon/src/routes/library.ts';
const SERVER_RELPATH = 'apps/daemon/src/server.ts';
const DAEMON_TSCONFIG_RELPATH = 'apps/daemon/tsconfig.json';

interface RouteRow {
  method: string;
  routePath: string;
  file: string; // repo-relative
  fnName: string;
  exposure: 0 | 1 | 3;
  classification: 'fs-hit' | 'unresolved' | 'clean';
  hitPrimitives: string[];
}
interface UniverseScanResult {
  rows: RouteRow[];
  duplicates: string[];
  chainedDuplicates: string[];
  routeFileCount: number;
  fnCount: number;
}

/** F1 fix (round-1 review, HIGH): a base-commit scan must resolve
 * cross-package path-literal consts (`@open-design/contracts`,
 * `@open-design/diagnostics`, ...) from THAT PACKAGE'S OWN git-tracked
 * `src/*.ts`, inside the SAME worktree being scanned -- never through
 * `node_modules`. The reason node_modules is unsafe here: `withDetachedWorktree`
 * symlinks `node_modules` from the CURRENT checkout (there is no install step
 * in a detached worktree), and every `packages/*` workspace member is itself
 * a RELATIVE symlink inside that node_modules tree (e.g.
 * `apps/daemon/node_modules/@open-design/contracts -> ../../../../packages/contracts`).
 * A relative symlink resolves relative to its own on-disk location, which is
 * always the CURRENT checkout's `apps/daemon/node_modules/@open-design/`
 * regardless of which worktree walked through the outer symlink to reach it
 * -- so it always lands back on the CURRENT checkout's
 * `packages/<pkg>/dist/<file>.d.ts`. `dist/` is gitignored build output: mutating it
 * plus the matching runtime path constant would let both the baseCommit scan
 * and the live daemon report the same post-base path while `git status`
 * stayed clean -- a false `drift=0`.
 *
 * The fix redirects every first-party `@open-design/*` module specifier to
 * that package's own `src/` tree INSIDE `root` (the worktree under scan) via
 * a `paths` compiler-option override built fresh from `root`'s own
 * `packages/<pkg>/package.json` files -- so a base-commit scan only ever reads
 * git-tracked source at that exact commit, never a build artifact from
 * outside the worktree, and no full package rebuild is needed (this stays
 * fast: it is still a single `ts.createProgram` over `apps/daemon`'s own
 * rootDir, exactly as before). This changes WHERE the declaration is read
 * from, not the classifier's own const-literal-type read at the use site
 * (`resolveStaticPathLiteral` below): TypeScript never widens a `const`
 * binding's own inferred type, regardless of whether the declaration lives
 * in a `.ts` source file or a rolled-up `.d.ts` -- so this produces identical
 * type-checking results to the dist-based resolution it replaces (verified
 * directly against this tree: `ATTRIBUTION_CLAIM_PATH` and
 * `DIAGNOSTICS_EXPORT_PATH` both still resolve to their correct literal
 * values, now sourced from `packages/contracts/src/api/attribution.ts` and
 * `packages/diagnostics/src/contract.ts` respectively). Every other
 * specifier (`express`, `zod`, `node:*`, relative imports) still resolves
 * through the ordinary Node algorithm against `root`'s own node_modules
 * exactly as before -- third-party dependencies are pinned by the lockfile,
 * not a mutable build artifact of THIS repo, so they are not the F1 risk and
 * are deliberately left alone.
 *
 * A plain `options.paths` override alone is not enough: empirically, TS
 * 5.9's own default (uncached) `resolveModuleNameLiterals` batching, when
 * driving a program this size, sometimes still resolves an `@open-design/*`
 * subpath specifier through `node_modules`'s package.json `exports` field
 * instead of trying the `paths` substitution first (confirmed by tracing
 * `ts.resolveModuleName` with `traceResolution: true` -- the same call
 * resolves correctly through `paths` in isolation but not when reached via
 * `createProgram`'s own internal resolution path for this program). Providing
 * an explicit `resolveModuleNameLiterals` host override that calls
 * `ts.resolveModuleName` directly (backed by one shared
 * `ModuleResolutionCache` per program, so this costs no real performance
 * versus the default) reproduces the correct, isolated-call behavior
 * consistently -- verified empirically: with this override, zero
 * `packages/<pkg>/dist/<file>` files are pulled into the program at all. */
function buildWorkspaceSourcePathOverrides(root: string): Record<string, string[]> {
  const overrides: Record<string, string[]> = {};
  const packagesDir = path.join(root, 'packages');
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(packagesDir);
  } catch {
    return overrides; // no packages/ dir in this root (e.g. a self-probe scratch dir) -- nothing to override
  }
  for (const entry of entries) {
    const pkgDir = path.join(packagesDir, entry);
    const srcDir = path.join(pkgDir, 'src');
    if (!fs.existsSync(srcDir)) continue;
    let name: string | undefined;
    try {
      name = (JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as { name?: string }).name;
    } catch {
      continue; // not a real workspace package dir (no readable package.json) -- skip
    }
    if (!name) continue;
    const indexTs = path.join(srcDir, 'index.ts');
    if (fs.existsSync(indexTs)) overrides[name] = [indexTs];
    overrides[`${name}/*`] = [path.join(srcDir, '*')];
  }
  return overrides;
}

function buildDaemonProgram(root: string): { program: TypeScriptModule.Program; serverPath: string } {
  const tsconfigPath = path.join(root, DAEMON_TSCONFIG_RELPATH);
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) throw new Error(`failed to read ${tsconfigPath}: ${configFile.error.messageText}`);
  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath));
  const options: TypeScriptModule.CompilerOptions = {
    ...parsedConfig.options,
    noEmit: true,
    paths: { ...(parsedConfig.options.paths ?? {}), ...buildWorkspaceSourcePathOverrides(root) },
  };
  const host = ts.createCompilerHost(options, true);
  const resolutionCache = ts.createModuleResolutionCache(root, host.getCanonicalFileName.bind(host), options);
  host.resolveModuleNameLiterals = (moduleLiterals, containingFile, redirectedReference, opts) =>
    moduleLiterals.map((literal) => ts.resolveModuleName(literal.text, containingFile, opts, host, resolutionCache, redirectedReference));
  const program = ts.createProgram({ rootNames: parsedConfig.fileNames, options, host });
  return { program, serverPath: path.join(root, SERVER_RELPATH) };
}

/** True when the handler declares a third ("next") parameter and actually
 * calls it somewhere in its own body (a direct, generous recursive search --
 * being generous here is the SAFE direction, since this check only ever
 * EXEMPTS a duplicate from the hard-fail path, and the fewer legitimate
 * chains it under-recognizes, the more false hard-fails result, not the
 * reverse). This is how Express deliberately chains two handlers under the
 * SAME {method, path} -- confirmed live in this codebase's own
 * `DELETE /api/design-systems/:id` (registered once in
 * `routes/static-resource.ts`, which calls `next()` for `user:`-prefixed
 * ids, and again in `routes/design-systems.ts`, which has no `next`
 * parameter and is the terminal handler for everything else). Treating
 * every duplicate registration as an unconditional hard fail would make
 * `C9F-1` permanently unsatisfiable against a real, working, deliberate
 * pattern this codebase already uses -- not a hypothetical risk, found by
 * running this exact check against the real tree. */
function handlerAcceptsAndCallsNext(handler: TsNode): boolean {
  if (!(ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) return false;
  const nextParam = handler.parameters[2];
  if (!nextParam || !ts.isIdentifier(nextParam.name)) return false;
  const nextName = nextParam.name.text;
  let found = false;
  const visit = (node: TsNode): void => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === nextName) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (handler.body) visit(handler.body);
  return found;
}

function scanUniverse(root: string): UniverseScanResult {
  const { program, serverPath } = buildDaemonProgram(root);
  const serverSourceFile = program.getSourceFile(serverPath);
  if (!serverSourceFile) throw new Error(`server.ts not present in program built from ${root}`);
  const classifier = new FsReachabilityClassifier(program, serverPath);
  const checker = program.getTypeChecker();

  const routeFiles = discoverRouteFileUniverse(program, serverSourceFile, serverPath, root);
  const rows: RouteRow[] = [];
  const seen = new Map<string, number>();
  const handlersByKey = new Map<string, TsNode[]>();

  const classifyOne = (call: AppCall, file: string, fnName: string): RouteRow => {
    const result = classifier.reachable(call.handler, 0);
    const classification: RouteRow['classification'] = result.fsHit ? 'fs-hit' : result.unresolved ? 'unresolved' : 'clean';
    const exposure = classifyExposure(call.middlewareArgs, call.handler);
    const key = `${call.method} ${call.routePath}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    const handlers = handlersByKey.get(key) ?? [];
    handlers.push(call.handler);
    handlersByKey.set(key, handlers);
    return {
      method: call.method,
      routePath: call.routePath,
      file,
      fnName,
      exposure,
      classification,
      hitPrimitives: [...result.hitPrimitives].sort(),
    };
  };

  let fnCount = 0;
  for (const routeFile of routeFiles) {
    const relFile = path.relative(root, routeFile).split(path.sep).join('/');
    if (relFile === LIBRARY_ROUTES_RELPATH) continue; // sibling tranche, hard exclusion
    const sourceFile = program.getSourceFile(routeFile);
    if (!sourceFile) throw new Error(`route file not present in program: ${routeFile}`);
    for (const { name, body, ctxParamName } of findRegisterFunctionBodies(sourceFile)) {
      fnCount++;
      classifier.setCurrentRegisterFn(name, ctxParamName, body);
      for (const call of collectAppCalls(body, checker)) rows.push(classifyOne(call, relFile, name));
      for (const call of collectMountJsonRouteCalls(body, checker)) rows.push(classifyOne(call, relFile, name));
    }
  }
  // bootstrap routes: no ctx param.
  classifier.setCurrentRegisterFn('__bootstrap__', null, serverSourceFile);
  for (const call of collectBootstrapAppCalls(serverSourceFile, checker)) {
    rows.push(classifyOne(call, SERVER_RELPATH, '__bootstrap__'));
  }
  // Non-Routes-named helper registrars invoked directly from server.ts's
  // bootstrap code (e.g. registerStaticSpaFallback -> static-spa.ts's own
  // literal app.get('/*splat', ...)) -- see collectBootstrapHelperRegistrarCalls.
  for (const { call, relFile, fnName } of collectBootstrapHelperRegistrarCalls(serverSourceFile, program, root, serverPath, checker)) {
    classifier.setCurrentRegisterFn(fnName, null, serverSourceFile);
    rows.push(classifyOne(call, relFile, fnName));
  }

  // A duplicate {method,path} group is a genuine hazard (hard fail) only
  // when FEWER than (count-1) of its handlers fall through via `next()` --
  // i.e. two or more handlers that NEVER fall through, meaning at least one
  // of them is unconditionally unreachable dead code. A group where exactly
  // one handler is the non-chaining terminal stop is the deliberate Express
  // pattern above and is ALLOWED, but still reported in evidence as a
  // "chained duplicate" -- visible and counted, never silently invisible.
  const duplicates: string[] = [];
  const chainedDuplicates: string[] = [];
  for (const [key, count] of seen.entries()) {
    if (count <= 1) continue;
    const handlers = handlersByKey.get(key) ?? [];
    const nonChaining = handlers.filter((h) => !handlerAcceptsAndCallsNext(h));
    if (nonChaining.length > 1) duplicates.push(key);
    else chainedDuplicates.push(`${key} (${count} handlers, Express next()-chain, allowed)`);
  }
  return { rows, duplicates, chainedDuplicates, routeFileCount: routeFiles.size, fnCount };
}

// -----------------------------------------------------------------------
// Self-probe fixtures for BOTH classifiers, run through the exact same
// scanUniverse()/classifyExposure() code path real routes use -- never a
// separate mock. Fixtures are written as real files into a throwaway temp
// project (symlinked node_modules from the live worktree so 'node:fs'/
// 'express'/'multer' types resolve), mirroring a minimal register*Routes
// file + a server.ts stub with a matching call site.
// -----------------------------------------------------------------------
interface SelfProbeCase {
  name: string;
  serverCallSite: string; // the registerXRoutes(app, {...}) call body in the stub server.ts
  routeFileBody: string; // the full route file content
  expected: { classification: RouteRow['classification']; exposure: 0 | 1 | 3 };
}
const SELF_PROBES: SelfProbeCase[] = [
  {
    name: 'direct-fs-readFile-hit',
    serverCallSite: `registerProbeRoutes(app, {});`,
    routeFileBody: `
import { readFile } from 'node:fs/promises';
export function registerProbeRoutes(app, ctx) {
  app.get('/probe/direct-read', async (req, res) => {
    const data = await readFile('/tmp/x', 'utf8');
    res.send(data);
  });
}`,
    expected: { classification: 'fs-hit', exposure: 3 },
  },
  {
    name: 'same-file-helper-write-hit',
    serverCallSite: `registerProbeRoutes(app, {});`,
    routeFileBody: `
import { writeFile } from 'node:fs/promises';
async function persist(x) { await writeFile('/tmp/x', x); }
export function registerProbeRoutes(app, ctx) {
  app.post('/probe/same-file-write', async (req, res) => {
    await persist(req.body);
    res.json({ ok: true });
  });
}`,
    expected: { classification: 'fs-hit', exposure: 3 },
  },
  {
    name: 'relative-import-two-hop-unlink-hit',
    serverCallSite: `registerProbeRoutes(app, {});`,
    routeFileBody: `
import { deleteThing } from './probe-helper.js';
export function registerProbeRoutes(app, ctx) {
  app.delete('/probe/two-hop-delete', async (req, res) => {
    await deleteThing(req.params.id);
    res.json({ ok: true });
  });
}`,
    expected: { classification: 'fs-hit', exposure: 3 },
  },
  {
    name: 'ctx-nested-object-literal-readdir-hit',
    serverCallSite: `
registerProbeRoutes(app, {
  paths: { listDir },
});`,
    routeFileBody: `
export function registerProbeRoutes(app, ctx) {
  app.get('/probe/ctx-nested', async (req, res) => {
    const entries = await ctx.paths.listDir('/tmp');
    res.json(entries);
  });
}`,
    expected: { classification: 'fs-hit', exposure: 3 },
  },
  {
    name: 'ctx-destructured-alias-type-descent-mkdir-hit',
    serverCallSite: `
registerProbeRoutes(app, {
  helpers: probeHelpers,
});`,
    routeFileBody: `
export function registerProbeRoutes(app, deps) {
  const { helpers } = deps;
  app.post('/probe/ctx-alias-descent', async (req, res) => {
    await helpers.ensureDir(req.body.path);
    res.json({ ok: true });
  });
}`,
    expected: { classification: 'fs-hit', exposure: 3 },
  },
  {
    name: 'express-static-hit',
    serverCallSite: `registerProbeRoutes(app, {});`,
    routeFileBody: `
import express from 'express';
export function registerProbeRoutes(app, ctx) {
  app.get('/probe/static', express.static('/tmp'));
}`,
    expected: { classification: 'fs-hit', exposure: 3 },
  },
  {
    name: 'res-sendFile-hit',
    serverCallSite: `registerProbeRoutes(app, {});`,
    routeFileBody: `
export function registerProbeRoutes(app, ctx) {
  app.get('/probe/sendfile', (req, res) => {
    res.sendFile('/tmp/x');
  });
}`,
    expected: { classification: 'fs-hit', exposure: 3 },
  },
  {
    name: 'unresolvable-third-party-call-stays-unresolved-never-clean',
    serverCallSite: `registerProbeRoutes(app, {});`,
    routeFileBody: `
import { someExternalThing } from 'probe-external-pkg';
export function registerProbeRoutes(app, ctx) {
  app.get('/probe/external', async (req, res) => {
    const r = await someExternalThing(req.query.x);
    res.json(r);
  });
}`,
    expected: { classification: 'unresolved', exposure: 3 },
  },
  {
    name: 'deps-spread-fails-open-to-unresolved-never-clean',
    serverCallSite: `
const commonDeps = { helpers: probeHelpers };
registerProbeRoutes(app, { ...commonDeps });`,
    routeFileBody: `
export function registerProbeRoutes(app, deps) {
  const { helpers } = deps;
  app.post('/probe/spread', async (req, res) => {
    await helpers.ensureDir(req.body.path);
    res.json({ ok: true });
  });
}`,
    expected: { classification: 'unresolved', exposure: 3 },
  },
  {
    name: 'zero-calls-clean',
    serverCallSite: `registerProbeRoutes(app, {});`,
    routeFileBody: `
export function registerProbeRoutes(app, ctx) {
  app.get('/probe/noop', (req, res) => {
    res.json({ ok: true });
  });
}`,
    expected: { classification: 'clean', exposure: 3 },
  },
  {
    name: 'require-local-daemon-request-middleware-array-exposure-0',
    serverCallSite: `registerProbeRoutes(app, { requireLocalDaemonRequest });`,
    routeFileBody: `
export function registerProbeRoutes(app, ctx) {
  app.get('/probe/loopback', ctx.requireLocalDaemonRequest, (req, res) => {
    res.json({ ok: true });
  });
}`,
    expected: { classification: 'clean', exposure: 0 },
  },
  {
    name: 'authorize-tool-request-straight-line-body-exposure-1',
    serverCallSite: `registerProbeRoutes(app, {});`,
    routeFileBody: `
import { authorizeToolRequest } from './probe-authz.js';
export function registerProbeRoutes(app, ctx) {
  app.post('/probe/tool-token', (req, res) => {
    const grant = authorizeToolRequest(req, res, 'probe:x');
    if (!grant) return;
    res.json({ ok: true });
  });
}`,
    expected: { classification: 'clean', exposure: 1 },
  },
];

function runSelfProbes(root: string): { pass: boolean; report: string[]; passCount: number; total: number } {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w9fs-selfprobe-'));
  const report: string[] = [];
  let passCount = 0;
  try {
    const srcDir = path.join(scratchDir, 'apps/daemon/src');
    fs.mkdirSync(srcDir, { recursive: true });
    const realNodeModules = path.join(root, 'node_modules');
    const daemonNodeModules = path.join(root, 'apps/daemon/node_modules');
    try {
      fs.symlinkSync(realNodeModules, path.join(scratchDir, 'node_modules'), 'dir');
    } catch {
      /* best-effort; program build will surface a clear error if this matters */
    }
    try {
      fs.mkdirSync(path.join(scratchDir, 'apps/daemon'), { recursive: true });
      fs.symlinkSync(daemonNodeModules, path.join(scratchDir, 'apps/daemon/node_modules'), 'dir');
    } catch {
      /* best-effort */
    }
    fs.writeFileSync(
      path.join(scratchDir, 'apps/daemon/tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            skipLibCheck: true,
            esModuleInterop: true,
            resolveJsonModule: true,
            types: ['node'],
          },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(srcDir, 'probe-helper.ts'), `import { unlink } from 'node:fs/promises';\nexport async function deleteThing(id) { await unlink('/tmp/' + id); }\n`);
    fs.writeFileSync(
      path.join(srcDir, 'probe-authz.ts'),
      `export function authorizeToolRequest(req, res, scope) { return { scope }; }\n`,
    );

    for (const probe of SELF_PROBES) {
      // Real implementations, not \`declare const\` ambient stubs -- an
      // ambient declaration has no function body for the classifier to
      // inspect and would itself resolve as UNRESOLVED, which is a fixture
      // defect (testing "reaches a declare-only stub", not the intended
      // "reaches a real implementation") rather than a classifier defect.
      const stub = `
import type { Express } from 'express';
import { readdir, mkdir } from 'node:fs/promises';
import { registerProbeRoutes } from './probe-route.js';
declare const app: Express;
function requireLocalDaemonRequest(req: unknown, res: unknown, next: () => void) { next(); }
const probeHelpers = { ensureDir: async (p: string) => { await mkdir(p, { recursive: true }); } };
async function listDir(p: string) { return await readdir(p); }
export function registerAllRoutes() {
  ${probe.serverCallSite}
}
`;
      fs.writeFileSync(path.join(srcDir, 'server.ts'), stub);
      // Fixtures must type `app: Express` the way real route files do
      // (`export function registerXRoutes(app: Express, ctx: ...)`) --
      // without it, `app.get(...)`'s callback parameters (`req`, `res`)
      // have no contextual type, `res.json`/`res.send`/etc. resolve to no
      // symbol at all (an `any`-typed property access), and the classifier
      // falls into the SAME "no symbol -> unresolved" path a genuinely
      // untraceable call would -- which is a fixture defect (testing
      // untyped-`any` resolution, not the real route-file shape every
      // register*Routes function actually has) rather than evidence the
      // known-safe-builtin check doesn't work.
      const typedRouteFileBody = `import type { Express } from 'express';\n${probe.routeFileBody.replace(
        /export function registerProbeRoutes\(app, (ctx|deps)\)/,
        'export function registerProbeRoutes(app: Express, $1: any)',
      )}`;
      fs.writeFileSync(path.join(srcDir, 'probe-route.ts'), typedRouteFileBody);
      try {
        const scan = scanUniverse(scratchDir);
        const row = scan.rows.find((r) => r.fnName === 'registerProbeRoutes');
        if (!row) {
          report.push(`FAIL ${probe.name}: no route row produced`);
          continue;
        }
        const okClass = row.classification === probe.expected.classification;
        const okExposure = row.exposure === probe.expected.exposure;
        if (okClass && okExposure) {
          passCount++;
          report.push(`PASS ${probe.name}: classification=${row.classification} exposure=${row.exposure}`);
        } else {
          report.push(
            `FAIL ${probe.name}: expected classification=${probe.expected.classification} exposure=${probe.expected.exposure}, got classification=${row.classification} exposure=${row.exposure}`,
          );
        }
      } catch (err) {
        report.push(`FAIL ${probe.name}: threw ${String((err as Error)?.message ?? err)}`);
      }
    }
  } finally {
    try {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
  return { pass: passCount === SELF_PROBES.length, report, passCount, total: SELF_PROBES.length };
}

// -----------------------------------------------------------------------
// Detached git worktree helper -- used to freeze C9F-1's classification at
// baseCommit rather than the (possibly-mutated) working tree, and reused by
// C9F-5's red-evidence replay. Isolated: a fresh mkdtemp path, torn down via
// `git worktree remove --force` in a finally block.
// -----------------------------------------------------------------------
async function withDetachedWorktree<T>(commit: string, fn: (worktreeDir: string) => Promise<T> | T): Promise<T> {
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w9fs-worktree-'));
  fs.rmdirSync(worktreeDir); // git worktree add refuses a pre-existing non-empty dir; mkdtemp's own dir must go
  const add = sh('git', ['worktree', 'add', '--detach', worktreeDir, commit], { timeoutMs: 60_000 });
  if (add.status !== 0) {
    throw new Error(`git worktree add --detach ${worktreeDir} ${commit} failed: ${add.stderr.slice(0, 500)}`);
  }
  try {
    // A fresh worktree's mise.toml is untrusted by default.
    sh('mise', ['trust', worktreeDir], { cwd: worktreeDir, timeoutMs: 30_000 });
    // Symlink node_modules from the current (already-installed) worktree so
    // the classifier's TypeChecker resolves the same installed THIRD-PARTY
    // types (express, zod, node:* ambient libs, ...) without a real install
    // -- this pass never executes baseCommit's own code, only reads its
    // AST/type shape, so sharing installed packages is safe for THOSE
    // (lockfile-pinned, not part of this repo's own git history).
    //
    // First-party `@open-design/*` workspace packages are the one category
    // this symlink must NOT be trusted for: pnpm's own node_modules layout
    // makes every `packages/*` entry a RELATIVE symlink
    // (`apps/daemon/node_modules/@open-design/contracts -> ../../../../packages/contracts`),
    // which resolves relative to its own on-disk location -- always the
    // CURRENT checkout, regardless of which worktree walked through the
    // outer symlink above to reach it -- landing on the CURRENT checkout's
    // gitignored `packages/*/dist/*.d.ts` rather than baseCommit's own
    // tracked source. `buildDaemonProgram`'s `paths` override intercepts
    // `@open-design/*` specifiers before they ever reach this symlink chain
    // for exactly that reason (F1 fix, round-1 review) -- see its doc
    // comment for the full mechanism. This symlink stays in place only for
    // the third-party fallback path.
    try {
      fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(worktreeDir, 'node_modules'), 'dir');
    } catch {
      /* best-effort */
    }
    try {
      fs.symlinkSync(path.join(repoRoot, 'apps/daemon/node_modules'), path.join(worktreeDir, 'apps/daemon/node_modules'), 'dir');
    } catch {
      /* best-effort */
    }
    return await fn(worktreeDir);
  } finally {
    sh('git', ['worktree', 'remove', '--force', worktreeDir], { timeoutMs: 30_000 });
    try {
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// -----------------------------------------------------------------------
// Live daemon boot -- REAL CHILD PROCESS, never in-process.
//
// An earlier version of this verifier dynamically `import()`ed server.ts
// into the VERIFIER'S OWN process and mutated `process.env.OD_DATA_DIR`
// globally. That is a "bounded from outside" pattern, not a structurally
// safe one: (a) the mutated env var leaked into every subsequent spawnSync
// call in the same process (pnpm guard, git, worktree installs -- all of
// them would have inherited a stale/removed OD_DATA_DIR), and (b) "teardown"
// was a same-process function call with no real process to confirm dead --
// a resolved shutdown() promise is not proof nothing survives, and there was
// no process GROUP to even check. Both are exactly the failure shape this
// this program's own safety review flags: bounding a risk from outside instead of
// making it structurally impossible.
//
// This version spawns the daemon as a genuine, `detached: true` child
// process with its OWN process group (pgid === its own pid on POSIX),
// receiving OD_DATA_DIR/OD_BIND_HOST only through that child's OWN `env`
// object -- a fresh shallow copy, never an assignment to this process's own
// `process.env`. Teardown signals the WHOLE GROUP (`-pid`), polls for real
// exit, escalates SIGTERM -> SIGKILL, and then independently RE-SCANS the
// system process table for any surviving member of that group before
// declaring success. A partial or unconfirmed teardown returns `ok: false`;
// every call site below treats that as a criterion FAILURE, never as
// evidence to route around.
// -----------------------------------------------------------------------
interface LiveDaemon {
  url: string;
  port: number;
  pid: number;
  routeInventory: Array<{ method: string; path: string }>;
  shutdown: () => Promise<{ ok: boolean; detail: string }>;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code !== 'ESRCH'; // ESRCH = no such process; anything else (e.g. EPERM) means it still exists
  }
}
interface ProcessTableScanResult {
  /** True only when the scan itself is TRUSTWORTHY (exit 0, this verifier's
   * own known-alive pid is visible somewhere in the output, every row
   * parsed) -- never merely "found zero matching rows." `survivors` is only
   * meaningful when this is true. */
  ok: boolean;
  survivors: string[];
  detail: string;
}
/** Pure, deterministic classification over a `ps -Ao pid=,pgid=,comm=`-shaped
 * invocation's raw exit status + stdout -- separated from the actual `ps`
 * call below so its trustworthiness logic can be exercised with SYNTHETIC
 * input (`PROCESS_TABLE_SELF_PROBES`), the same self-probe discipline this
 * file already applies to the inclusion/exposure classifier (`SELF_PROBES` /
 * `runSelfProbes`).
 *
 * F4 fix (round-2 review, MED): the old version of this scan treated
 * exit-zero-but-EMPTY output, and exit-zero output whose rows fail to parse,
 * as a genuinely empty group -- `ps` returning nothing (or garbage) with a
 * 0 exit code is NOT proof the group is empty, it is proof the SCAN ITSELF
 * is broken, and the two must never be conflated. The required mechanism is
 * a SELF-VISIBILITY CONTROL: this verifier's own process (`selfPid`,
 * definitely alive -- it is running this very check) must appear SOMEWHERE
 * in the same enumeration. If it does not, or if any row fails to parse,
 * enumeration itself is untrustworthy and this returns `ok: false` --
 * callers must treat that as a RUN FAILURE, never as "confirmed empty."
 * Validated end-to-end against a real spawned sentinel process plus a
 * PATH-shimmed fake `ps` returning exit-0-empty and exit-0-malformed output
 * before this was wired in: both were correctly rejected as untrustworthy,
 * never reported as an empty group. */
function classifyProcessTableScan(status: number, stdout: string, selfPid: number, targetPgid: number): ProcessTableScanResult {
  if (status !== 0) {
    return { ok: false, survivors: [], detail: `ps scan itself failed (exit=${status}) -- treated as unconfirmed, not as proof of a clean exit` };
  }
  const survivors: string[] = [];
  const malformed: string[] = [];
  let sawSelf = false;
  let rowCount = 0;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rowCount++;
    const parts = trimmed.split(/\s+/);
    const rowPid = Number(parts[0]);
    const rowPgid = Number(parts[1]);
    if (parts.length < 3 || !Number.isFinite(rowPid) || !Number.isFinite(rowPgid)) {
      malformed.push(trimmed.slice(0, 160));
      continue;
    }
    if (rowPid === selfPid) sawSelf = true;
    if (rowPgid === targetPgid) survivors.push(`pid=${rowPid} pgid=${rowPgid} comm=${parts.slice(2).join(' ')}`);
  }
  if (malformed.length > 0) {
    return {
      ok: false,
      survivors: [],
      detail: `ps output contained ${malformed.length} unparseable row(s) out of ${rowCount} -- enumeration integrity not confirmed, treated as a scan failure, never as proof of an empty group: ${malformed.slice(0, 3).join(' | ')}`,
    };
  }
  if (!sawSelf) {
    return {
      ok: false,
      survivors: [],
      detail: `ps output (exit=0, ${rowCount} row(s)) never included this verifier's own pid=${selfPid} -- a process KNOWN to be alive right now -- so enumeration itself is broken (self-visibility control failed), treated as a scan failure, never as proof of an empty group`,
    };
  }
  return { ok: true, survivors, detail: `ps scan trustworthy: self pid=${selfPid} visible among ${rowCount} row(s), 0 malformed` };
}
/** Synthetic-input self-probes for `classifyProcessTableScan`, run once per
 * verifier process (memoized) and gating `killGroupFailClosed` below -- a
 * teardown scan is never trusted for a real verdict in a run where the
 * classification logic behind it cannot classify its own known fixtures
 * correctly, mirroring `runSelfProbes`'s gate on `checkC9F1`. */
const PROCESS_TABLE_SELF_PROBES: Array<{ name: string; status: number; stdout: string; expectOk: boolean; expectSurvivorCount?: number }> = [
  {
    name: 'well-formed output, self visible, no target-pgid match',
    status: 0,
    stdout: '    1     1 launchd\n 4242   999 node\n  555   555 sh\n',
    expectOk: true,
    expectSurvivorCount: 0,
  },
  {
    name: 'well-formed output, self visible, target-pgid HAS a survivor',
    status: 0,
    stdout: '    1     1 launchd\n 4242   999 node\n 6001   777 hermes-agent\n',
    expectOk: true,
    expectSurvivorCount: 1,
  },
  {
    name: 'F4: exit-zero but EMPTY output (enumeration silently produced nothing)',
    status: 0,
    stdout: '',
    expectOk: false,
  },
  {
    name: 'F4: exit-zero, well-formed OTHER rows, but self pid missing entirely',
    status: 0,
    stdout: '    1     1 launchd\n  555   555 sh\n',
    expectOk: false,
  },
  {
    name: 'F4: exit-zero, garbage/malformed rows',
    status: 0,
    stdout: 'not-a-pid not-a-pgid garbage\n 4242   999 node\n',
    expectOk: false,
  },
  {
    name: 'nonzero exit (ps itself failed)',
    status: 1,
    stdout: '',
    expectOk: false,
  },
];
let processTableSelfProbeResult: { pass: boolean; report: string[]; passCount: number; total: number } | null = null;
function runProcessTableSelfProbes(): { pass: boolean; report: string[]; passCount: number; total: number } {
  if (processTableSelfProbeResult) return processTableSelfProbeResult;
  const SELF_PID = 4242;
  const TARGET_PGID = 777;
  const report: string[] = [];
  let passCount = 0;
  for (const c of PROCESS_TABLE_SELF_PROBES) {
    const result = classifyProcessTableScan(c.status, c.stdout, SELF_PID, TARGET_PGID);
    const okMatches = result.ok === c.expectOk;
    const survivorMatches = c.expectSurvivorCount === undefined || (result.ok && result.survivors.length === c.expectSurvivorCount);
    if (okMatches && survivorMatches) {
      passCount++;
      report.push(`PASS ${c.name}: ok=${result.ok} survivors=${result.survivors.length}`);
    } else {
      report.push(`FAIL ${c.name}: expected ok=${c.expectOk}${c.expectSurvivorCount !== undefined ? ` survivors=${c.expectSurvivorCount}` : ''}, got ok=${result.ok} survivors=${result.survivors.length} detail=${result.detail}`);
    }
  }
  processTableSelfProbeResult = { pass: passCount === PROCESS_TABLE_SELF_PROBES.length, report, passCount, total: PROCESS_TABLE_SELF_PROBES.length };
  return processTableSelfProbeResult;
}
/** Scans the REAL system process table (never trusts a single leader's
 * `exit` event as proof the whole group is gone) for any process still
 * reporting the given process-group id, via the self-visibility-checked
 * classifier above. */
function processGroupSurvivors(pgid: number): ProcessTableScanResult {
  const r = sh('ps', ['-Ao', 'pid=,pgid=,comm='], { timeoutMs: 15_000 });
  return classifyProcessTableScan(r.status, r.stdout, process.pid, pgid);
}

interface TargetVisibilityResult {
  ok: boolean;
  detail: string;
}
/** INVARIANT 1 fix (round-3 founder ruling W9FS-R2, upgrades the round-2
 * self-visibility control): self-visibility alone proves the scan sees the
 * CALLER (this verifier's own pid) -- it says nothing about whether the
 * scan can see the TARGET's session at all. `bootIsolatedDaemon` spawns the
 * daemon `detached: true` (its own session, pgid === its own pid), which is
 * a DIFFERENT session than the caller's. A session-scoped `ps` invocation
 * (or shim) could enumerate only the CALLER's own session -- passing the
 * self-visibility control every time, since the caller genuinely is visible
 * -- while never showing so much as one row for the daemon's session,
 * regardless of whether the daemon actually has survivors. Every such scan
 * would then read as "self visible, zero target rows" -- exactly the shape
 * `PROCESS_TABLE_SELF_PROBES`' first fixture (below) already accepts as
 * trustworthy, because in ISOLATION that shape genuinely is a well-formed,
 * self-consistent scan result; the gap is architectural, not a parsing bug.
 *
 * The fix is a POSITIVE control, evaluated once per teardown BEFORE any
 * kill signal is sent: while the target is independently (kernel-level,
 * `process.kill(pid, 0)`, session/`ps`-agnostic) confirmed alive, the SAME
 * `ps`-based scan mechanism must ALSO show a row for that exact pgid --
 * trivially true for a healthy target, since `detached: true` makes the
 * leader its own pgid. A later "zero target rows" result (post-kill) is
 * trusted as "confirmed empty" ONLY when this same-run, same-mechanism
 * target-visibility check passed; a target that was never shown to be
 * visible in the first place can never be "confirmed" absent later. Proven
 * against a real spawned sentinel plus a PATH-shimmed `ps` that filters out
 * a specific pgid (simulating a session-scoped-blind scan) before being
 * wired in: the OLD self-visibility-only logic was fooled (`ok: true` even
 * though the target's entire session was invisible to the scan); this
 * control correctly rejects the identical exploit, while a real healthy
 * teardown against real `ps` still confirms normally. */
function evaluateTargetVisibility(targetAliveAtStart: boolean, preKillScan: ProcessTableScanResult | null): TargetVisibilityResult {
  if (!targetAliveAtStart) {
    return {
      ok: false,
      detail: 'target-visibility not established: the target was not independently confirmed alive (process.kill(pid,0)) at teardown start -- a later "confirmed empty" verdict cannot be trusted without this positive control',
    };
  }
  if (!preKillScan || !preKillScan.ok || preKillScan.survivors.length === 0) {
    return {
      ok: false,
      detail: `target-visibility FAILED: process.kill(pid,0) confirms the target is alive, but the ps-based scan for its own pgid found ${!preKillScan || !preKillScan.ok ? `an untrustworthy scan (${preKillScan?.detail ?? 'no scan performed'})` : 'zero rows'} -- the scan mechanism may be blind to this target's session (e.g. a session-scoped ps)`,
    };
  }
  return {
    ok: true,
    detail: `target-visibility confirmed: ${preKillScan.survivors.length} row(s) for the target's own pgid seen while it was independently confirmed alive`,
  };
}
const TARGET_VISIBILITY_SELF_PROBES: Array<{
  name: string;
  targetAliveAtStart: boolean;
  preKillScan: ProcessTableScanResult | null;
  expectOk: boolean;
}> = [
  {
    name: 'normal healthy case: target alive, scan sees its own pgid row',
    targetAliveAtStart: true,
    preKillScan: { ok: true, survivors: ['pid=999 pgid=999 node'], detail: 'ok' },
    expectOk: true,
  },
  {
    name: 'INVARIANT 1 exploit: session-scoped-blind scan -- target alive, self visible, but 0 target rows',
    targetAliveAtStart: true,
    preKillScan: { ok: true, survivors: [], detail: 'trustworthy: self visible, 0 target rows' },
    expectOk: false,
  },
  {
    name: 'target alive, but the pre-kill scan itself was untrustworthy',
    targetAliveAtStart: true,
    preKillScan: { ok: false, survivors: [], detail: 'malformed rows' },
    expectOk: false,
  },
  {
    name: 'target already not alive at teardown start -- no positive control possible',
    targetAliveAtStart: false,
    preKillScan: null,
    expectOk: false,
  },
];
let targetVisibilitySelfProbeResult: { pass: boolean; report: string[]; passCount: number; total: number } | null = null;
function runTargetVisibilitySelfProbes(): { pass: boolean; report: string[]; passCount: number; total: number } {
  if (targetVisibilitySelfProbeResult) return targetVisibilitySelfProbeResult;
  const report: string[] = [];
  let passCount = 0;
  for (const c of TARGET_VISIBILITY_SELF_PROBES) {
    const result = evaluateTargetVisibility(c.targetAliveAtStart, c.preKillScan);
    if (result.ok === c.expectOk) {
      passCount++;
      report.push(`PASS ${c.name}: ok=${result.ok}`);
    } else {
      report.push(`FAIL ${c.name}: expected ok=${c.expectOk}, got ok=${result.ok} detail=${result.detail}`);
    }
  }
  targetVisibilitySelfProbeResult = { pass: passCount === TARGET_VISIBILITY_SELF_PROBES.length, report, passCount, total: TARGET_VISIBILITY_SELF_PROBES.length };
  return targetVisibilitySelfProbeResult;
}
async function waitForCondition(check: () => boolean, timeoutMs: number, intervalMs = 200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return check();
}
/** Teardown fix (round-1 review, routed item b -- genuine leak, ruled
 * blocking for eventual wave freeze): escalate on process-group EMPTINESS,
 * never on leader liveness alone. Daemon startup fires a fire-and-forget
 * agent-detection probe (`void readAppConfig(...).then(... detectAgents
 * ...)` in `apps/daemon/src/server.ts`, never awaited by `startServer`) that
 * can spawn a `hermes-agent`/`node`/`cursor-agent` child concurrently with,
 * or just after, this function's own SIGTERM lands. That child inherits the
 * leader's process group but was never itself signaled -- and the OLD
 * version of this function stopped watching as soon as `isPidAlive(pid)`
 * (the LEADER only) went false, then did exactly one final group scan, which
 * could catch that straggler mid-flight and report it as an unconfirmed
 * teardown even though nothing further was ever done about it. Polling
 * GROUP EMPTINESS (this same `processGroupSurvivors` scan, the same one the
 * final verdict uses) as the escalation condition instead means a straggler
 * that appears mid-teardown still gets escalated against -- SIGKILL is
 * re-sent to the whole group, not just quietly observed -- before this
 * function gives up. The group can never read as "empty" while the leader
 * itself is still running (the leader's own pgid is its own pid), so this is
 * a strict superset of the old leader-liveness check, not a narrowing of it:
 * still signals the whole group by its one exact known pid (never a
 * broader/fuzzy match), still kills by exact PID only, still fails closed on
 * any unconfirmed or partial result. */
async function killGroupFailClosed(pid: number): Promise<{ ok: boolean; detail: string }> {
  // Gate on BOTH self-probe suites FIRST (F4 fix round-2 + INVARIANT 1
  // round-3): a survivor scan is never trusted for a real teardown verdict
  // in a run where the classification logic behind it cannot classify its
  // own known-broken fixtures correctly. Both memoized -- run once per
  // verifier process, not once per teardown call.
  const selfProbes = runProcessTableSelfProbes();
  const targetVisibilityProbes = runTargetVisibilitySelfProbes();
  const selfProbeSummary = `process-table self-probes ${selfProbes.passCount}/${selfProbes.total} pass, target-visibility self-probes ${targetVisibilityProbes.passCount}/${targetVisibilityProbes.total} pass`;
  if (!selfProbes.pass || !targetVisibilityProbes.pass) {
    const failures = [...selfProbes.report, ...targetVisibilityProbes.report].filter((l) => l.startsWith('FAIL'));
    return {
      ok: false,
      detail: `${selfProbeSummary} -- refusing to trust any survivor scan this run: ${failures.join(' | ')}`,
    };
  }
  // INVARIANT 1 (round-3 founder ruling): establish the target-visibility
  // positive control BEFORE sending any signal, while the target is still
  // whatever it currently is -- see `evaluateTargetVisibility`'s doc comment
  // for the full mechanism and the exploit this closes.
  const targetAliveAtStart = isPidAlive(pid);
  const preKillScan = targetAliveAtStart ? processGroupSurvivors(pid) : null;
  const targetVisibility = evaluateTargetVisibility(targetAliveAtStart, preKillScan);
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (err) {
    // ESRCH here means the group is already gone -- proceed to the
    // confirmation scan rather than assuming success from the throw alone.
    if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
      return { ok: false, detail: `${selfProbeSummary}; ${targetVisibility.detail}; SIGTERM to group -${pid} failed: ${String(err)}` };
    }
  }
  const emptyAfterTerm = await waitForCondition(() => {
    const scan = processGroupSurvivors(pid);
    return scan.ok && scan.survivors.length === 0;
  }, 8_000);
  if (!emptyAfterTerm) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
        return { ok: false, detail: `${selfProbeSummary}; ${targetVisibility.detail}; SIGKILL to group -${pid} failed: ${String(err)}` };
      }
    }
    const emptyAfterKill = await waitForCondition(() => {
      const scan = processGroupSurvivors(pid);
      return scan.ok && scan.survivors.length === 0;
    }, 5_000);
    if (!emptyAfterKill) {
      const scan = processGroupSurvivors(pid);
      if (!scan.ok) {
        return { ok: false, detail: `${selfProbeSummary}; ${targetVisibility.detail}; SCAN UNTRUSTWORTHY after SIGTERM+SIGKILL -- teardown NOT confirmed, never treated as an empty group: ${scan.detail}` };
      }
      return { ok: false, detail: `${selfProbeSummary}; ${targetVisibility.detail}; process group -${pid} still has survivors after SIGTERM+SIGKILL -- teardown NOT confirmed: ${scan.survivors.join('; ')}` };
    }
  }
  // waitForCondition's own successful exit already re-scanned and found the
  // group empty, but re-derive the scan one more time explicitly rather than
  // trusting a boolean alone -- never trust a resolved check as proof on its
  // own, the same posture the rest of this teardown path takes.
  const finalScan = processGroupSurvivors(pid);
  if (!finalScan.ok) {
    return { ok: false, detail: `${selfProbeSummary}; ${targetVisibility.detail}; FINAL SCAN UNTRUSTWORTHY -- teardown NOT confirmed, never treated as an empty group: ${finalScan.detail}` };
  }
  if (finalScan.survivors.length > 0) {
    return { ok: false, detail: `${selfProbeSummary}; ${targetVisibility.detail}; process group -${pid} has survivors after kill+wait: ${finalScan.survivors.join('; ')}` };
  }
  // A "zero survivors" result from the SAME scan mechanism is only trusted
  // as "confirmed empty" when the target-visibility positive control above
  // actually passed -- otherwise this scan mechanism was never shown to be
  // able to see this target's session at all, and "zero rows" is exactly
  // what a session-scoped-blind scan would ALWAYS report, empty or not.
  if (!targetVisibility.ok) {
    return {
      ok: false,
      detail: `${selfProbeSummary}; ${targetVisibility.detail}; post-kill scan shows zero survivors, but that result is NOT TRUSTED without a passing target-visibility positive control -- teardown NOT confirmed`,
    };
  }
  return { ok: true, detail: `${selfProbeSummary}; ${targetVisibility.detail}; process group -${pid} confirmed empty (${finalScan.detail})` };
}

/** F3 fix (round-2 review, HIGH), WIDENED by INVARIANT 2 (round-3 founder
 * ruling W9FS-R2, closes F5 HIGH): every evidence-bearing path this verifier
 * runs must resolve first-party `@open-design/*` packages from freshly
 * rebuilt output, never a possibly-stale or mutated gitignored `dist`
 * bundle. The round-2 fix rebuilt only `apps/daemon`'s OWN dependency
 * closure (`@open-design/daemon^...`, 10 packages) before booting the live
 * daemon (`bootIsolatedDaemon`) -- correct for THAT evidence path, but round
 * 3's reviewer found a second, distinct evidence path this missed entirely:
 * `checkC9F9` runs `pnpm typecheck`, which is `pnpm -r --if-present run
 * typecheck` across EVERY workspace package, including `apps/web` --
 * outside `apps/daemon`'s own dependency graph -- which depends on
 * `@open-design/components` and `@open-design/host`. Neither was covered by
 * the daemon-scoped filter, so C9F-9's own evidence could still be produced
 * against unpinned mutable dist.
 *
 * Fix: widen to the union rather than track two closures. This now rebuilds
 * every `packages/*` workspace member with a `build` script
 * (`pnpm --filter "./packages/*" run build`, currently all 14: agui-adapter,
 * components, contracts, diagnostics, download, host, launcher-proto,
 * metatool, platform, plugin-runtime, registry-protocol, release, sidecar,
 * sidecar-proto) rather than `apps/daemon`'s narrower dependency closure --
 * a strict superset, so this still covers `bootIsolatedDaemon`'s needs
 * exactly as before. Chosen over hand-tracking "the union of every evidence
 * path's own dependency graph" because that union is exactly as fragile as
 * the single-package list F3's original finding rejected: a THIRD evidence
 * path added later, consuming a FIFTEENTH package, would silently reopen
 * the same gap. A full workspace-wide rebuild has no such blind spot by
 * construction. Still fast enough to unconditionally force every run: ~13s
 * wall clock for all 14 packages, measured directly against this tree.
 * Called from both `bootIsolatedDaemon` (via the live-daemon-boot call
 * sites, `checkC9F1`/`checkC9F8`) and `checkC9F9` (before `pnpm
 * guard`/`pnpm typecheck`), memoized so it still only runs ONCE per
 * verifier process regardless of how many criteria need it. A failed
 * rebuild throws, which every caller already treats as a hard criterion
 * failure. */
let firstPartyPackagesRebuiltFromHead: Promise<void> | null = null;
function ensureFirstPartyPackagesRebuiltFromHead(): Promise<void> {
  if (!firstPartyPackagesRebuiltFromHead) {
    firstPartyPackagesRebuiltFromHead = (async () => {
      const r = sh('pnpm', ['--filter', './packages/*', 'run', 'build'], { timeoutMs: 5 * 60_000 });
      if (r.status !== 0) {
        throw new Error(
          `rebuilding every first-party packages/* workspace member from the current checkout failed (exit=${r.status}) -- refusing to trust any evidence path that could consume their gitignored dist output: ${(r.stderr || r.stdout).slice(-2000)}`,
        );
      }
    })();
  }
  return firstPartyPackagesRebuiltFromHead;
}

async function bootIsolatedDaemon(): Promise<LiveDaemon> {
  await ensureFirstPartyPackagesRebuiltFromHead();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w9fs-daemon-data-'));
  const serverTsPath = path.join(repoRoot, 'apps/daemon/src/server.ts');
  const marker = crypto.randomBytes(16).toString('hex');
  const bootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w9fs-daemon-boot-'));
  const bootScriptPath = path.join(bootDir, 'boot.mjs');
  // Generated content: every dynamic value is JSON.stringify'd, never
  // interpolated raw (defect-catalog item 1). Plain ESM, no TS syntax, so
  // `node --check` (below) validates it directly even though it is actually
  // executed via `pnpm exec tsx` (needed only so the dynamic import of the
  // .ts sibling resolves through tsx's own loader).
  const bootScript = [
    `const SERVER_TS_PATH = ${JSON.stringify(serverTsPath)};`,
    `const MARKER = ${JSON.stringify(marker)};`,
    'const mod = await import(SERVER_TS_PATH);',
    'const result = await mod.startServer({ port: 0, returnServer: true });',
    'const address = result.server.address();',
    'const port = address && typeof address === "object" ? address.port : 0;',
    'const routeInventory = (result.routeInventory ?? []).map((r) => ({ method: r.method, path: r.path }));',
    'process.stdout.write(MARKER + JSON.stringify({ port, routeInventory }) + MARKER + "\\n");',
    'let shuttingDown = false;',
    'async function gracefulExit() {',
    '  if (shuttingDown) return;',
    '  shuttingDown = true;',
    '  try { await result.shutdown(); } catch {}',
    '  process.exit(0);',
    '}',
    'process.on("SIGTERM", gracefulExit);',
    'process.on("SIGINT", gracefulExit);',
  ].join('\n');
  fs.writeFileSync(bootScriptPath, bootScript);
  const checkResult = sh('node', ['--check', bootScriptPath], { timeoutMs: 15_000 });
  if (checkResult.status !== 0) {
    throw new Error(`generated daemon-boot script failed node --check: ${checkResult.stderr.slice(0, 500)}`);
  }

  // A fresh env OBJECT for the child only -- this process's own `process.env`
  // is never assigned to, so nothing spawned later in this same verifier run
  // (pnpm guard, git, worktree installs, ...) can inherit a stray
  // OD_DATA_DIR/OD_BIND_HOST from an isolated daemon boot.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, OD_DATA_DIR: dataDir, OD_BIND_HOST: '127.0.0.1' };
  delete childEnv.OD_API_TOKEN;

  const child = spawn('pnpm', ['exec', 'tsx', bootScriptPath], {
    cwd: repoRoot,
    detached: true, // own process group: pgid === child.pid on POSIX
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv,
  });
  if (!child.pid) {
    throw new Error('daemon-boot child process failed to spawn (no pid)');
  }
  const childPid = child.pid;

  let stdoutBuf = '';
  let stderrBuf = '';
  child.stdout?.on('data', (d: Buffer) => {
    stdoutBuf += d.toString('utf8');
  });
  child.stderr?.on('data', (d: Buffer) => {
    stderrBuf += d.toString('utf8');
  });
  let exited = false;
  let exitInfo = '';
  child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    exited = true;
    exitInfo = `exit code=${code} signal=${signal}`;
  });

  const readyPayload = await waitForCondition(
    () => stdoutBuf.split(marker).length - 1 >= 2,
    30_000,
    100,
  ).then((found) => {
    if (!found) return null;
    const occurrences = stdoutBuf.split(marker).length - 1;
    if (occurrences !== 2) return null; // exactly two, never a first-match trust
    const re = new RegExp(`${marker}(.*?)${marker}`, 's');
    const match = re.exec(stdoutBuf);
    return match ? match[1] ?? null : null;
  });

  if (exited || readyPayload === null) {
    // Boot never confirmed ready -- best-effort kill, then fail closed. This
    // failure path still goes through the same confirmed-teardown routine so
    // a half-started daemon is never left running.
    const teardown = await killGroupFailClosed(childPid);
    throw new Error(
      `daemon boot did not produce a ready marker within timeout (exited=${exited} ${exitInfo}); teardown ok=${teardown.ok} (${teardown.detail}); stdout tail: ${stdoutBuf.slice(-1000)}; stderr tail: ${stderrBuf.slice(-1000)}`,
    );
  }

  let parsed: { port: number; routeInventory: Array<{ method: string; path: string }> };
  try {
    parsed = JSON.parse(readyPayload);
  } catch {
    const teardown = await killGroupFailClosed(childPid);
    throw new Error(`daemon boot ready marker payload was not valid JSON; teardown ok=${teardown.ok}`);
  }
  if (!parsed.port || parsed.port === 0 || FORBIDDEN_PORTS.has(parsed.port)) {
    const teardown = await killGroupFailClosed(childPid);
    throw new Error(`isolated daemon boot resolved to an unacceptable port: ${parsed.port}; teardown ok=${teardown.ok}`);
  }

  return {
    url: `http://127.0.0.1:${parsed.port}`,
    port: parsed.port,
    pid: childPid,
    routeInventory: parsed.routeInventory,
    shutdown: async () => {
      const result = await killGroupFailClosed(childPid);
      // INVARIANT 3 fix (round-3 founder ruling, F6 MED): an UNCONFIRMED
      // teardown must never destroy the only forensic evidence of what
      // actually happened. Delete `bootDir`/`dataDir` ONLY when the
      // teardown itself is confirmed (`result.ok === true`) -- on any
      // unconfirmed/partial result, RETAIN both directories (the generated
      // boot script + captured stdout/stderr context, and the daemon's own
      // data root) and surface their paths in the failure detail so a human
      // or agent investigating this run knows exactly where to look. This
      // was previously unconditional, silently discarding evidence on
      // exactly the runs that most needed it kept.
      if (!result.ok) {
        return { ok: false, detail: `${result.detail}; forensic evidence RETAINED (not deleted): bootDir=${bootDir} dataDir=${dataDir}` };
      }
      try {
        fs.rmSync(bootDir, { recursive: true, force: true });
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup; does not affect the fail-closed teardown verdict */
      }
      return result;
    },
  };
}

// -----------------------------------------------------------------------
// Fail-closed probe fetch: parse + resolve, refuse non-loopback and refuse
// FORBIDDEN_PORTS, redirect:'manual' (defect-catalog item 10, verbatim).
// -----------------------------------------------------------------------
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  if (net.isIP(hostname) === 4) return hostname.startsWith('127.');
  if (net.isIP(hostname) === 6) return hostname === '::1';
  return false;
}
async function safeProbeFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`probe fetch refused: unparsable URL ${rawUrl}`);
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error(`probe fetch refused: non-loopback host ${parsed.hostname}`);
  }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  if (FORBIDDEN_PORTS.has(port)) {
    throw new Error(`probe fetch refused: forbidden port ${port}`);
  }
  return fetch(parsed.toString(), { ...init, redirect: 'manual' });
}

// =========================================================================
// C9F-1 -- route snapshot + three-bucket inclusion classification.
// =========================================================================
let cachedUniverseAtBase: UniverseScanResult | null = null;
async function getUniverseAtBaseCommit(): Promise<UniverseScanResult> {
  if (cachedUniverseAtBase) return cachedUniverseAtBase;
  cachedUniverseAtBase = await withDetachedWorktree(baseCommit, (worktreeDir) => scanUniverse(worktreeDir));
  return cachedUniverseAtBase;
}

async function checkC9F1(): Promise<void> {
  const startedAt = Date.now();
  try {
    const selfProbes = runSelfProbes(repoRoot);
    if (!selfProbes.pass) {
      record(
        'C9F-1',
        'self-probes over classifyRegistration/classifyExposure',
        `inclusion + exposure classifier self-probes all pass (${SELF_PROBES.length}/${SELF_PROBES.length}) before any route verdict is trusted`,
        false,
        selfProbes.report.join('\n'),
        { detail: `self-probes ${selfProbes.passCount}/${selfProbes.total}`, durationMs: Date.now() - startedAt },
      );
      return;
    }

    const atBase = await getUniverseAtBaseCommit();
    if (atBase.duplicates.length > 0) {
      record(
        'C9F-1',
        'scanUniverse(baseCommit worktree)',
        'no HAZARDOUS duplicate {method,path} registrations at baseCommit (a legitimate Express next()-chain, where all but one handler falls through, is reported separately and does not fail this check)',
        false,
        [
          `hazardous duplicates (2+ handlers that never fall through -- at least one is unreachable): ${atBase.duplicates.join(', ')}`,
          `chained duplicates (allowed, reported for visibility): ${atBase.chainedDuplicates.join(', ') || 'none'}`,
        ].join('\n'),
        { durationMs: Date.now() - startedAt },
      );
      return;
    }

    const fsHit = atBase.rows.filter((r) => r.classification === 'fs-hit');
    const unresolved = atBase.rows.filter((r) => r.classification === 'unresolved');
    const clean = atBase.rows.filter((r) => r.classification === 'clean');
    const partitionOk = fsHit.length + unresolved.length + clean.length === atBase.rows.length;

    let live: LiveDaemon | null = null;
    let driftLines: string[] = [];
    let driftOk = true;
    try {
      live = await bootIsolatedDaemon();
      // Three exclusions, all confirmed by directly reading the runtime
      // inventory guard (route-registration-guard.ts) and the source:
      //  - /api/library/* and /api/tools/library/* -- sibling tranche.
      //  - /api/backup and /api/restore -- registered via
      //    registerBackupRoutes(...) called from INSIDE the excluded
      //    library.ts (W0-owned; confirmed identical to the ingest
      //    tranche's own documented exclusion for the same file boundary).
      //  - USE/ALL registrations -- route-registration-guard.ts tracks
      //    app.use(stringPath, ...)/app.all(...) the same as
      //    get/post/put/patch/delete/options, but these mount routers or
      //    apply middleware across many routes rather than a single
      //    classifiable handler; this tranche's classification model is
      //    scoped to the leaf HTTP_METHODS set (S1 of the inclusion rule),
      //    so both sides of the drift comparison exclude them uniformly.
      const liveFiltered = live.routeInventory.filter(
        (r) =>
          !(r.path.startsWith('/api/library/') || r.path.startsWith('/api/tools/library/')) &&
          !(r.method === 'POST' && (r.path === '/api/backup' || r.path === '/api/restore')) &&
          r.method !== 'USE' &&
          r.method !== 'ALL',
      );
      const baseKeys = new Map<string, number>();
      for (const r of atBase.rows) {
        const k = `${r.method} ${r.routePath}`;
        baseKeys.set(k, (baseKeys.get(k) ?? 0) + 1);
      }
      const liveKeys = new Map<string, number>();
      for (const r of liveFiltered) {
        const k = `${r.method} ${r.path}`;
        liveKeys.set(k, (liveKeys.get(k) ?? 0) + 1);
      }
      // Multiset comparison, never Set-based (defect-catalog item 3):
      // occurrence counts must match exactly on both sides.
      const allKeys = new Set([...baseKeys.keys(), ...liveKeys.keys()]);
      for (const k of allKeys) {
        const b = baseKeys.get(k) ?? 0;
        const l = liveKeys.get(k) ?? 0;
        if (b !== l) {
          driftOk = false;
          driftLines.push(`DRIFT ${k}: baseCommit=${b} live=${l}`);
        }
      }
    } catch (err) {
      driftOk = false;
      driftLines.push(`live daemon boot/inventory failed: ${String((err as Error)?.message ?? err)}`);
    } finally {
      if (live) {
        const teardown = await live.shutdown();
        // A failed or partial teardown FAILS the run -- it is never merely
        // logged. A leader process's own exit is not proof the whole group
        // exited; killGroupFailClosed() already re-scanned the real process
        // table, and its verdict is what gates this criterion, not whether
        // the shutdown() promise merely resolved.
        if (!teardown.ok) {
          driftOk = false;
          driftLines.push(`daemon teardown NOT confirmed: ${teardown.detail}`);
        }
      }
    }

    const ok = partitionOk && driftOk;
    const evidence = [
      `route-file universe: ${atBase.routeFileCount} files, ${atBase.fnCount} register*Routes function bodies`,
      `candidate registrations (excl. library.ts): ${atBase.rows.length}`,
      `fs-hit: ${fsHit.length}`,
      `unresolved: ${unresolved.length}`,
      `clean: ${clean.length}`,
      `partition check: ${partitionOk ? 'ok' : 'FAILED'}`,
      `chained (allowed) duplicates: ${atBase.chainedDuplicates.join(', ') || 'none'}`,
      `self-probes: ${selfProbes.passCount}/${selfProbes.total} pass`,
      `live-daemon drift check: ${driftOk ? 'ok' : 'FAILED'}`,
      ...driftLines,
      '--- fs-hit rows ---',
      ...fsHit.map((r) => `${r.method} ${r.routePath} [${r.file}::${r.fnName}] exposure=${r.exposure} primitives=${r.hitPrimitives.join(',')}`),
      '--- unresolved rows ---',
      ...unresolved.map((r) => `${r.method} ${r.routePath} [${r.file}::${r.fnName}]`),
      '--- clean rows ---',
      ...clean.map((r) => `${r.method} ${r.routePath} [${r.file}::${r.fnName}]`),
    ].join('\n');

    record(
      'C9F-1',
      'scanUniverse(baseCommit worktree) + bootIsolatedDaemon().routeInventory',
      `route snapshot frozen at baseCommit, drift-checked against a live daemon boot (multiset-exact), duplicate-checked, partition-checked, classifier self-probed ${SELF_PROBES.length}/${SELF_PROBES.length}`,
      ok,
      evidence,
      { durationMs: Date.now() - startedAt },
    );
  } catch (err) {
    record('C9F-1', 'checkC9F1', 'route snapshot + inclusion classification', false, String((err as Error)?.stack ?? err), {
      detail: `crashed: ${String(err)}`,
      durationMs: Date.now() - startedAt,
    });
  }
}

// =========================================================================
// C9F-2 -- risk-ranking formula. Exposure/impact self-probes always run;
// per-row formula enforcement additionally requires the attribution matrix.
// =========================================================================
const ATTRIBUTION_MATRIX_RELPATH = 'docs/security/filesystem-tranche-attribution.json';
const THREAT_MODEL_DOC_RELPATH = 'docs/security/daemon-threat-model.md';
const DECISIONS_RELPATH = 'docs/plans/waves/DECISIONS.md';
const IMPLEMENTATION_REVIEW_RELPATH = 'docs/security/filesystem-tranche-implementation-review.json';

function mechanicalImpactFor(row: RouteRow): 0 | 1 | 2 | 3 {
  if (row.hitPrimitives.includes('upload')) return 3;
  if (row.hitPrimitives.includes('write')) return 2;
  if (row.hitPrimitives.includes('read') || row.hitPrimitives.includes('static')) return 1;
  return 0;
}
function tierFor(score: number): 'P0' | 'P1' | 'P2' {
  if (score >= 5) return 'P0';
  if (score === 4) return 'P1';
  return 'P2';
}

interface AttributionRow {
  method?: unknown;
  path?: unknown;
  owner?: unknown;
  authn?: unknown;
  authz?: unknown;
  inputValidation?: unknown;
  sizeRateLimit?: unknown;
  testRef?: unknown;
  riskScore?: { exposure?: unknown; impact?: unknown; score?: unknown; tier?: unknown };
  control?: { mechanism?: unknown; testRef?: unknown };
  acceptedRisk?: { decisionRef?: unknown };
  impactOverrideReason?: unknown;
}
function loadAttributionMatrix(): { rows: AttributionRow[] } | null {
  const abs = path.join(repoRoot, ATTRIBUTION_MATRIX_RELPATH);
  if (!fs.existsSync(abs)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (!Array.isArray(parsed)) return null;
    return { rows: parsed as AttributionRow[] };
  } catch {
    return null;
  }
}

async function checkC9F2(): Promise<void> {
  const startedAt = Date.now();
  try {
    const atBase = await getUniverseAtBaseCommit();
    const fsHitByKey = new Map<string, RouteRow>();
    for (const r of atBase.rows.filter((x) => x.classification === 'fs-hit')) {
      fsHitByKey.set(`${r.method} ${r.routePath}`, r);
    }

    const matrix = loadAttributionMatrix();
    if (!matrix) {
      record(
        'C9F-2',
        'loadAttributionMatrix()',
        'risk-ranking formula (exposure+impact=score, tier) enforced exactly per confirmed-in-scope row',
        false,
        `${ATTRIBUTION_MATRIX_RELPATH} does not exist yet -- no rows to check (expected pre-implementation)`,
        { durationMs: Date.now() - startedAt },
      );
      return;
    }

    const problems: string[] = [];
    for (const row of matrix.rows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      const baseline = fsHitByKey.get(key);
      if (!baseline) {
        problems.push(`${key}: not a confirmed in-scope (fs-hit) route at baseCommit`);
        continue;
      }
      const rs = row.riskScore;
      if (!rs) {
        problems.push(`${key}: missing riskScore`);
        continue;
      }
      const mechExposure = baseline.exposure;
      const mechImpact = mechanicalImpactFor(baseline);
      const declaredImpact = typeof rs.impact === 'number' ? rs.impact : NaN;
      if (rs.exposure !== mechExposure) problems.push(`${key}: exposure ${String(rs.exposure)} !== mechanical ${mechExposure}`);
      if (declaredImpact < mechImpact) {
        problems.push(`${key}: declared impact ${String(rs.impact)} below mechanical floor ${mechImpact}`);
      }
      if (declaredImpact > mechImpact) {
        const reason = typeof row.impactOverrideReason === 'string' ? row.impactOverrideReason.trim() : '';
        if (reason.length < 20) problems.push(`${key}: declared impact ${String(rs.impact)} exceeds mechanical floor ${mechImpact} without a >=20-char impactOverrideReason`);
      }
      const expectedScore = mechExposure + (Number.isFinite(declaredImpact) ? declaredImpact : mechImpact);
      if (rs.score !== expectedScore) problems.push(`${key}: score ${String(rs.score)} !== exposure+impact ${expectedScore}`);
      if (typeof rs.score === 'number' && rs.tier !== tierFor(rs.score)) {
        problems.push(`${key}: tier ${String(rs.tier)} !== tierFor(score) ${tierFor(rs.score as number)}`);
      }
    }

    const selfProbes = runSelfProbes(repoRoot);
    // matrix.rows.length > 0 is a real gate, not a defensive no-op: an
    // empty matrix means the per-row formula loop below never ran, so
    // `problems.length === 0` would otherwise pass vacuously despite
    // checking nothing. Unlike C9F-8's exposure-0 case, an empty matrix is
    // never a legitimate population here (C9F-3 independently requires it
    // to be non-empty against the real, always-nonzero fs-hit set) -- so
    // this is a genuine FAIL, not a not-exercised state.
    const ok = problems.length === 0 && selfProbes.pass && matrix.rows.length > 0;
    record(
      'C9F-2',
      'per-row formula check against attribution matrix + exposure self-probes',
      `exposure/impact/score/tier formula enforced exactly per row; escalation-only impact override; exposure self-probes ${SELF_PROBES.length}/${SELF_PROBES.length}`,
      ok,
      [`matrix rows checked: ${matrix.rows.length}`, `self-probes: ${selfProbes.passCount}/${selfProbes.total}`, ...problems].join('\n'),
      { durationMs: Date.now() - startedAt },
    );
  } catch (err) {
    record('C9F-2', 'checkC9F2', 'risk-ranking formula', false, String((err as Error)?.stack ?? err), {
      detail: `crashed: ${String(err)}`,
      durationMs: Date.now() - startedAt,
    });
  }
}

// =========================================================================
// C9F-3 / C9F-4 -- attribution matrix structure + per-row attribution.
// =========================================================================
const PLACEHOLDER_DENYLIST = new Set(['x', 'n/a', 'na', 'tbd', 'none', 'unknown', 'todo', '-', '?']);
function isPlaceholder(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length < 12) return true;
  if (PLACEHOLDER_DENYLIST.has(trimmed)) return true;
  const uniqueChars = new Set(trimmed.replace(/\s/g, '').split(''));
  if (uniqueChars.size <= 2) return true; // repeated-character check
  return false;
}
const EXPOSURE_KEYWORDS: Record<number, string[]> = {
  0: ['requirelocaldaemonrequest', 'loopback'],
  1: ['authorizetoolrequest', 'tool token', 'tool-token'],
  3: ['none', 'no gate', 'zero-config', 'zero config'],
};
function authnNamesExposureClass(authn: string, exposure: number): boolean {
  const lower = authn.toLowerCase();
  const keywords = EXPOSURE_KEYWORDS[exposure] ?? [];
  return keywords.some((k) => lower.includes(k));
}

async function checkC9F3(): Promise<void> {
  const startedAt = Date.now();
  try {
    const atBase = await getUniverseAtBaseCommit();
    const fsHit = atBase.rows.filter((r) => r.classification === 'fs-hit');
    const matrix = loadAttributionMatrix();
    if (!matrix) {
      record(
        'C9F-3',
        'loadAttributionMatrix()',
        'attribution matrix exists and covers exactly the confirmed in-scope (fs-hit) set',
        false,
        `${ATTRIBUTION_MATRIX_RELPATH} does not exist yet (expected pre-implementation); expected ${fsHit.length} rows once it does`,
        { durationMs: Date.now() - startedAt },
      );
      return;
    }
    // Presence, not occurrence count: the matrix attributes a ROUTE, not a
    // handler registration. A {method,path} key registered twice (e.g. a
    // legitimate Express next()-chain -- see `handlerAcceptsAndCallsNext`)
    // still needs exactly ONE matrix row. `actualKeys` below still counts
    // occurrences, so a matrix that itself contains two rows for the same
    // key is still caught as a real duplicate (expected 1, matrix has 2).
    const expectedKeys = new Map<string, number>();
    for (const r of fsHit) {
      const k = `${r.method} ${r.routePath}`;
      expectedKeys.set(k, 1);
    }
    const actualKeys = new Map<string, number>();
    for (const row of matrix.rows) {
      const k = `${String(row.method)} ${String(row.path)}`;
      actualKeys.set(k, (actualKeys.get(k) ?? 0) + 1);
    }
    const problems: string[] = [];
    const allKeys = new Set([...expectedKeys.keys(), ...actualKeys.keys()]);
    for (const k of allKeys) {
      const e = expectedKeys.get(k) ?? 0;
      const a = actualKeys.get(k) ?? 0;
      if (e !== a) problems.push(`${k}: expected ${e} row(s), matrix has ${a}`);
    }
    // fsHit.length > 0 is a defensive assertion, not a real gate in
    // practice: it is re-derived from the real, always-populated route
    // surface (never user input, never optional), so it should never
    // actually be zero. Guarded anyway so a `problems.length === 0`
    // vacuous pass can never occur even in a scenario this run did not
    // anticipate.
    record(
      'C9F-3',
      'multiset key comparison: matrix rows vs confirmed in-scope set',
      'exactly one row per fs-hit route, no orphans, no gaps, no duplicates',
      problems.length === 0 && fsHit.length > 0,
      [`expected fs-hit routes: ${fsHit.length}`, `matrix rows: ${matrix.rows.length}`, ...problems].join('\n'),
      { durationMs: Date.now() - startedAt },
    );
  } catch (err) {
    record('C9F-3', 'checkC9F3', 'attribution matrix coverage', false, String((err as Error)?.stack ?? err), {
      detail: `crashed: ${String(err)}`,
      durationMs: Date.now() - startedAt,
    });
  }
}

async function checkC9F4(): Promise<void> {
  const startedAt = Date.now();
  try {
    const matrix = loadAttributionMatrix();
    if (!matrix) {
      record('C9F-4', 'loadAttributionMatrix()', 'every matrix row fully, structurally attributed', false, `${ATTRIBUTION_MATRIX_RELPATH} does not exist yet`, {
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    // Read at baseCommit directly (never gated on working-tree presence,
    // which is a different, irrelevant question -- `git show` itself
    // fails closed to an empty string if the path never existed there).
    const decisionsAtBaseResult = sh('git', ['show', `${baseCommit}:${DECISIONS_RELPATH}`]);
    const decisionsAtBase = decisionsAtBaseResult.status === 0 ? decisionsAtBaseResult.stdout : '';
    const acceptHeadings = new Map<string, string>(); // heading -> block text
    {
      const re = /^### (W9F-ACCEPT-[a-zA-Z0-9-]+)\s*$/gm;
      let m: RegExpExecArray | null;
      const indices: { heading: string; index: number }[] = [];
      while ((m = re.exec(decisionsAtBase))) indices.push({ heading: m[1]!, index: m.index });
      for (let i = 0; i < indices.length; i++) {
        const start = indices[i]!.index;
        const end = i + 1 < indices.length ? indices[i + 1]!.index : decisionsAtBase.length;
        const block = decisionsAtBase.slice(start, end);
        if (acceptHeadings.has(indices[i]!.heading)) acceptHeadings.set(indices[i]!.heading, '__DUPLICATE__');
        else acceptHeadings.set(indices[i]!.heading, block);
      }
    }
    const authorsInRange = commitAuthorsBetween(baseCommit, headSha);

    let attributed = 0;
    let unattributed = 0;
    let knownVulnerable = 0;
    const problems: string[] = [];

    for (const row of matrix.rows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      const fields: [string, unknown][] = [
        ['owner', row.owner],
        ['authn', row.authn],
        ['authz', row.authz],
        ['inputValidation', row.inputValidation],
        ['sizeRateLimit', row.sizeRateLimit],
        ['testRef', row.testRef],
      ];
      let fieldsOk = true;
      for (const [name, value] of fields) {
        if (typeof value !== 'string' || isPlaceholder(value)) {
          problems.push(`${key}: field "${name}" missing or placeholder-shaped`);
          fieldsOk = false;
        }
      }
      const exposure = row.riskScore?.exposure;
      if (fieldsOk && typeof exposure === 'number' && typeof row.authn === 'string' && !authnNamesExposureClass(row.authn, exposure)) {
        problems.push(`${key}: authn does not name exposure class ${exposure}`);
        fieldsOk = false;
      }

      if (exposure === 3) {
        const hasControl = !!row.control?.mechanism && !!row.control?.testRef;
        const hasAccepted = !!row.acceptedRisk?.decisionRef;
        if (hasControl && hasAccepted) {
          problems.push(`${key}: both control and acceptedRisk present (mutually exclusive)`);
        } else if (hasAccepted) {
          const ref = String(row.acceptedRisk!.decisionRef);
          const block = acceptHeadings.get(ref);
          if (!block || block === '__DUPLICATE__') {
            problems.push(`${key}: acceptedRisk.decisionRef "${ref}" not a unique heading in DECISIONS.md@baseCommit`);
          } else {
            const routeMatch = /- Route: `([^`]+)`/.exec(block);
            const accepterMatch = /- Accepter: (.+)/.exec(block);
            const hasRationale = /- Rationale: .+/.test(block);
            const hasDate = /- Date: \d{4}-\d{2}-\d{2}/.test(block);
            const hasAcceptedRiskField = /- Accepted risk: .+/.test(block);
            if (!routeMatch || routeMatch[1] !== key) problems.push(`${key}: DECISIONS.md entry's Route field does not exactly match`);
            if (!accepterMatch || authorsInRange.has(normalizeIdentity(accepterMatch[1]!))) {
              problems.push(`${key}: DECISIONS.md Accepter missing or matches a commit author in baseCommit..HEAD`);
            }
            if (!hasRationale || !hasDate || !hasAcceptedRiskField) problems.push(`${key}: DECISIONS.md entry incomplete`);
            if (fieldsOk) knownVulnerable++;
          }
        } else if (hasControl) {
          if (fieldsOk) attributed++;
        } else {
          if (fieldsOk) unattributed++;
        }
      } else if (fieldsOk) {
        attributed++;
      }
    }

    record(
      'C9F-4',
      'per-row field/exposure-keyword/acceptedRisk checks',
      'every field clears the placeholder floor; authn names exposure class; acceptedRisk resolves to a unique, route-bound, non-self-accepted DECISIONS.md entry',
      problems.length === 0 && matrix.rows.length > 0,
      [`attributed: ${attributed}`, `unattributed: ${unattributed}`, `known-vulnerable: ${knownVulnerable}`, ...problems].join('\n'),
      { durationMs: Date.now() - startedAt },
    );
  } catch (err) {
    record('C9F-4', 'checkC9F4', 'per-row attribution', false, String((err as Error)?.stack ?? err), {
      detail: `crashed: ${String(err)}`,
      durationMs: Date.now() - startedAt,
    });
  }
}

// =========================================================================
// C9F-5 -- testRef integrity: real, passing, globally-unique-per-route,
// route-associated; new citations independently replayed.
// =========================================================================
function routeAssociationTerms(routePath: string): string[] {
  return routePath
    .split('/')
    .filter(Boolean)
    .filter((seg) => !seg.startsWith(':') && seg !== 'api')
    .map((seg) => seg.toLowerCase());
}
function extractStaticTestTitlesFromSource(sourceText: string, filename: string): Set<string> {
  const titles = new Set<string>();
  const sourceFile = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true);
  const isItOrTest = (expr: TypeScriptModule.Expression): boolean => {
    if (ts.isIdentifier(expr)) return expr.text === 'it' || expr.text === 'test';
    if (ts.isPropertyAccessExpression(expr)) return isItOrTest(expr.expression);
    if (ts.isCallExpression(expr)) return isItOrTest(expr.expression);
    return false;
  };
  const visit = (node: TsNode): void => {
    if (ts.isCallExpression(node) && isItOrTest(node.expression)) {
      const first = node.arguments[0];
      if (first && ts.isStringLiteral(first)) titles.add(first.text);
      else if (first && ts.isNoSubstitutionTemplateLiteral(first)) titles.add(first.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return titles;
}
function testTitleExistsAtCommit(testFileRelPath: string, title: string, commit: string): boolean {
  const show = sh('git', ['show', `${commit}:${testFileRelPath}`]);
  if (show.status !== 0) return false;
  return extractStaticTestTitlesFromSource(show.stdout, testFileRelPath).has(title);
}
function findTestIntroductionCommit(testFileRelPath: string, title: string): string | null {
  const log = sh('git', ['log', '--format=%H', `${baseCommit}..${headSha}`, '--', testFileRelPath]);
  if (log.status !== 0) return null;
  const commits = log.stdout.split('\n').filter(Boolean).reverse(); // oldest first
  for (const c of commits) {
    const show = sh('git', ['show', `${c}:${testFileRelPath}`]);
    if (show.status !== 0) continue;
    const titles = extractStaticTestTitlesFromSource(show.stdout, testFileRelPath);
    if (titles.has(title)) return c;
  }
  return null;
}

interface VitestJsonSummary {
  numFailedTests: number;
  numPassedTests: number;
  testResults: Array<{
    name: string;
    assertionResults: Array<{ fullName: string; status: string }>;
  }>;
}
function runVitestFileJson(filePathAbs: string, cwd: string): VitestJsonSummary | null {
  const relFromCwd = path.relative(cwd, filePathAbs);
  const r = sh(
    'pnpm',
    ['exec', 'vitest', 'run', relFromCwd, '--reporter=json', '--no-color'],
    { cwd, timeoutMs: 5 * 60_000 },
  );
  const lines = r.stdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.startsWith('{')) continue;
    try {
      return JSON.parse(line) as VitestJsonSummary;
    } catch {
      continue;
    }
  }
  return null;
}

// Memoized per file (never per-row) -- several matrix rows can cite the same
// test file, and vitest is genuinely expensive to invoke; the memoization is
// purely a performance measure, not a correctness one (the cached value is
// still a REAL run's own result, not a stub).
const vitestFileSummaryCache = new Map<string, VitestJsonSummary | null>();
function getVitestFileSummary(fileRelPath: string): VitestJsonSummary | null {
  if (vitestFileSummaryCache.has(fileRelPath)) return vitestFileSummaryCache.get(fileRelPath)!;
  const abs = path.join(repoRoot, fileRelPath);
  const summary = fs.existsSync(abs) ? runVitestFileJson(abs, repoRoot) : null;
  vitestFileSummaryCache.set(fileRelPath, summary);
  return summary;
}
function allAssertionsIn(summary: VitestJsonSummary | null): Array<{ fullName: string; status: string }> {
  if (!summary) return [];
  const out: Array<{ fullName: string; status: string }> = [];
  for (const tr of summary.testResults) for (const ar of tr.assertionResults) out.push(ar);
  return out;
}
function findAssertionStatus(summary: VitestJsonSummary | null, fullName: string): string | null {
  const found = allAssertionsIn(summary).find((a) => a.fullName === fullName);
  return found ? found.status : null;
}
interface ParsedTestRef {
  file: string;
  fullName: string;
}
/** testRef shape: "relative/test/file.test.ts :: exact full test name". */
function parseTestRef(ref: string): ParsedTestRef | null {
  const idx = ref.indexOf('::');
  if (idx === -1) return null;
  const file = ref.slice(0, idx).trim();
  const fullName = ref.slice(idx + 2).trim();
  if (!file || !fullName) return null;
  return { file, fullName };
}

async function replayRedEvidence(
  testFileRelPath: string,
  targetFullName: string,
  controlFullName: string,
): Promise<{ ok: boolean; detail: string }> {
  const introCommit = findTestIntroductionCommit(testFileRelPath, targetFullName);
  if (!introCommit) return { ok: false, detail: 'could not determine introduction commit via AST title match' };
  const parentSha = sh('git', ['rev-parse', `${introCommit}^`]).stdout.trim();
  if (!parentSha) return { ok: false, detail: `could not resolve parent of introduction commit ${introCommit}` };

  return withDetachedWorktree(parentSha, async (worktreeDir) => {
    const install = sh('pnpm', ['install', '--offline', '--frozen-lockfile'], { cwd: worktreeDir, timeoutMs: 10 * 60_000 });
    if (install.status !== 0) return { ok: false, detail: `frozen offline install failed at parent commit: ${install.stderr.slice(0, 500)}` };

    const headFileContent = sh('git', ['show', `${headSha}:${testFileRelPath}`]);
    if (headFileContent.status !== 0) return { ok: false, detail: 'could not read HEAD version of the test file to overlay' };
    fs.writeFileSync(path.join(worktreeDir, testFileRelPath), headFileContent.stdout);

    const marker = crypto.randomBytes(16).toString('hex');
    const runnerRelPath = 'scripts/waves/.w9fs-replay-runner.mjs';
    const runnerAbsPath = path.join(worktreeDir, runnerRelPath);
    fs.mkdirSync(path.dirname(runnerAbsPath), { recursive: true });
    // Generated content: every dynamic value is JSON.stringify'd, never
    // interpolated as a raw template literal, so no escape sequence can be
    // "cooked" a second time (defect-catalog item 1).
    const runnerSource = [
      "import { startVitest } from 'vitest/node';",
      `const TARGET_FILE = ${JSON.stringify(path.join(worktreeDir, testFileRelPath))};`,
      `const MARKER = ${JSON.stringify(marker)};`,
      'const ctx = await startVitest("test", [TARGET_FILE], { watch: false, reporters: [] });',
      'await ctx.close();',
      'function walk(task, out) {',
      '  out.push(task);',
      '  const children = task.children ? task.children.getTests ? task.children.getTests() : task.children : [];',
      '  for (const c of (task.children ?? [])) walk(c, out);',
      '}',
      'const modules = ctx.state.getTestModules ? ctx.state.getTestModules() : [];',
      'const forest = [];',
      'for (const mod of modules) {',
      '  function visit(task) {',
      '    const state = task.state ? task.state() : task.result?.().state;',
      '    const errors = task.errors ? task.errors() : (task.result?.().errors ?? []);',
      '    forest.push({ type: task.type, name: task.name, fullName: task.fullName ?? task.name, state, errors: (errors ?? []).map(e => String(e && e.message || e)) });',
      '    for (const child of (task.children ? [...task.children] : [])) visit(child);',
      '  }',
      '  visit(mod);',
      '}',
      'const unhandled = ctx.state.getUnhandledErrors ? ctx.state.getUnhandledErrors() : [];',
      'process.stdout.write(MARKER + JSON.stringify({ moduleCount: modules.length, forest, unhandledCount: unhandled.length }) + MARKER + "\\n");',
      'process.exitCode = process.exitCode ?? (forest.some(t => t.type === "test" && t.state === "failed") ? 1 : 0);',
    ].join('\n');
    fs.writeFileSync(runnerAbsPath, runnerSource);

    const checkResult = sh('node', ['--check', runnerAbsPath], { cwd: worktreeDir, timeoutMs: 30_000 });
    if (checkResult.status !== 0) return { ok: false, detail: `generated runner script failed node --check: ${checkResult.stderr.slice(0, 500)}` };

    const run = sh('node', [runnerRelPath], { cwd: worktreeDir, timeoutMs: 5 * 60_000 });
    const combined = `${run.stdout}\n${run.stderr}`;
    const markerRe = new RegExp(`${marker}(.*?)${marker}`, 's');
    const occurrences = combined.split(marker).length - 1;
    if (occurrences !== 2) return { ok: false, detail: `marker occurred ${occurrences} times on combined output, expected exactly 2` };
    const match = markerRe.exec(combined);
    if (!match || !match[1]) return { ok: false, detail: 'marker present but payload unparsable' };
    let payload: { moduleCount: number; forest: Array<{ type: string; fullName: string; state?: string; errors: string[] }>; unhandledCount: number };
    try {
      payload = JSON.parse(match[1]);
    } catch {
      return { ok: false, detail: 'marker payload was not valid JSON' };
    }
    if (payload.moduleCount !== 1) return { ok: false, detail: `expected exactly one module task, got ${payload.moduleCount}` };
    const failedLeaves = payload.forest.filter((t) => t.type === 'test' && t.state === 'failed');
    if (failedLeaves.length !== 1) return { ok: false, detail: `expected exactly one failed test leaf, got ${failedLeaves.length}` };
    if (failedLeaves[0]!.fullName !== targetFullName) {
      return { ok: false, detail: `failed leaf fullName "${failedLeaves[0]!.fullName}" !== target "${targetFullName}"` };
    }
    const anyOtherError = payload.forest.some((t) => t.fullName !== targetFullName && t.errors.length > 0);
    if (anyOtherError) return { ok: false, detail: 'a non-target task carried an error' };
    if (payload.unhandledCount !== 0) return { ok: false, detail: `unhandled-errors collection non-empty (${payload.unhandledCount})` };
    const control = payload.forest.find((t) => t.type === 'test' && t.fullName === controlFullName);
    if (!control || control.state !== 'passed') return { ok: false, detail: `control test "${controlFullName}" did not report passed` };
    if (run.status === 0) return { ok: false, detail: 'replay process exited 0 -- a genuine red replay must preserve a nonzero exit code' };
    if (run.processError) return { ok: false, detail: 'replay process errored/timed out rather than completing a real run' };
    return { ok: true, detail: `replay confirmed: target failed, control passed, exit=${run.status}` };
  });
}

async function checkC9F5(): Promise<void> {
  const startedAt = Date.now();
  try {
    const matrix = loadAttributionMatrix();
    if (!matrix) {
      record(
        'C9F-5',
        'loadAttributionMatrix()',
        'every testRef/control.testRef real, passing, globally-unique, route-associated',
        false,
        `${ATTRIBUTION_MATRIX_RELPATH} does not exist yet -- no citations to check`,
        { durationMs: Date.now() - startedAt },
      );
      return;
    }
    const citationToRoute = new Map<string, string>();
    const problems: string[] = [];
    const runDetails: string[] = [];
    for (const row of matrix.rows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      const terms = routeAssociationTerms(String(row.path));
      const refEntries: Array<{ ref: string; isControl: boolean }> = [];
      if (typeof row.testRef === 'string') refEntries.push({ ref: row.testRef, isControl: false });
      if (typeof row.control?.testRef === 'string') refEntries.push({ ref: row.control.testRef, isControl: true });

      for (const { ref, isControl } of refEntries) {
        const existing = citationToRoute.get(ref);
        if (existing && existing !== key) {
          problems.push(`citation "${ref}" reused across routes "${existing}" and "${key}"`);
          continue;
        }
        citationToRoute.set(ref, key);
        const associates = terms.some((t) => ref.toLowerCase().includes(t));
        if (!associates) {
          problems.push(`${key}: citation "${ref}" has no path-derived association term (expected one of: ${terms.join(', ')})`);
        }

        const parsed = parseTestRef(ref);
        if (!parsed) {
          problems.push(`${key}: citation "${ref}" not in "<file> :: <fullName>" shape`);
          continue;
        }

        // REAL runtime check -- this fact (does the cited assertion, when
        // actually executed, report passed) HAS a runtime observable, so a
        // structural/text-presence check is not legitimate here. Actually
        // executes the cited file via vitest and requires the exact
        // fullName to be present AND currently passing; a citation whose
        // name merely appears as a string somewhere is never sufficient.
        const summary = getVitestFileSummary(parsed.file);
        if (!summary) {
          problems.push(`${key}: citation "${ref}" -- could not execute ${parsed.file} via a live vitest run`);
          continue;
        }
        const status = findAssertionStatus(summary, parsed.fullName);
        if (status !== 'passed') {
          problems.push(`${key}: citation "${ref}" -- assertion not found or not passed in a live run (status=${status ?? 'not found'})`);
          continue;
        }
        runDetails.push(`${key}: "${ref}" confirmed passed in a live vitest run of ${parsed.file}`);

        if (!isControl) continue;

        // "New" is decided by an AST-derived title match at baseCommit
        // (never a raw string-appears-somewhere-in-the-file scan). A
        // genuinely new control citation requires an independently
        // replayed red-then-green spec -- the checked-in test file's own
        // text is never trusted as proof on its own.
        const existedAtBase = testTitleExistsAtCommit(parsed.file, parsed.fullName, baseCommit);
        if (!existedAtBase) {
          const controlCandidate = allAssertionsIn(summary).find(
            (a) => a.status === 'passed' && a.fullName !== parsed.fullName,
          );
          if (!controlCandidate) {
            problems.push(
              `${key}: new control "${ref}" has no second passing assertion in the same file to serve as the replay's own control test`,
            );
          } else {
            const replay = await replayRedEvidence(parsed.file, parsed.fullName, controlCandidate.fullName);
            if (!replay.ok) {
              problems.push(`${key}: new control "${ref}" failed independent red-evidence replay: ${replay.detail}`);
            } else {
              runDetails.push(`${key}: new control "${ref}" replay confirmed red-then-green (${replay.detail})`);
            }
          }
        }

        // Paired positive+negative control (applies to every control
        // citation, new or pre-existing): two DISTINCT passing assertions
        // in the same file, one accept-shaped, one reject-shaped by name.
        // This is a name-pattern proxy, not semantic verification of what
        // each assertion's body actually proves -- the same
        // mechanically-feasible-signal limitation the sibling ingest
        // tranche's own paired-control check accepts and documents rather
        // than hides.
        const passed = allAssertionsIn(summary).filter((a) => a.status === 'passed');
        const positive = passed.find((a) => /accept|allow|control:|valid|success/i.test(a.fullName));
        const negative = passed.find(
          (a) => /reject|deny|refus|invalid|traversal|escape|block/i.test(a.fullName) && a.fullName !== positive?.fullName,
        );
        if (!positive || !negative) {
          problems.push(
            `${key}: control "${ref}"'s file lacks a paired positive+negative PASSING assertion (found positive=${!!positive} negative=${!!negative})`,
          );
        }
      }
    }
    // citationToRoute.size > 0 guards against the same vacuous-pass shape:
    // an attribution matrix with rows but no testRef/control.testRef
    // strings at all would leave `problems` empty (the citation loop never
    // executes) without a single real Vitest run ever happening.
    record(
      'C9F-5',
      'live vitest execution of every cited file (memoized per file) + independent worktree replay for new controls',
      'every testRef/control.testRef confirmed passed in a REAL run, globally unique, route-associated; new controls independently replayed red-then-green; paired positive+negative control required in-file',
      problems.length === 0 && citationToRoute.size > 0,
      [`distinct citations: ${citationToRoute.size}`, ...runDetails, ...problems].join('\n'),
      { durationMs: Date.now() - startedAt },
    );
  } catch (err) {
    record('C9F-5', 'checkC9F5', 'testRef integrity', false, String((err as Error)?.stack ?? err), {
      detail: `crashed: ${String(err)}`,
      durationMs: Date.now() - startedAt,
    });
  }
}

// =========================================================================
// C9F-6 / C9F-7 -- threat-class coverage (containment; size limits).
//
// Both criteria check REAL PASSED assertion titles from a live vitest run
// (via getVitestFileSummary/allAssertionsIn), never raw file text. This is
// still a NAME-PATTERN PROXY, not semantic verification that an assertion's
// BODY actually performs the described attack and observes the described
// rejection -- stated plainly, per this program's own rule that a
// structural/pattern check may never imply it proves runtime behavior on its
// own. What IS a genuine runtime fact here: the cited assertion, under that
// name, actually executed moments ago and reported "passed" -- not merely
// present as inert text, not inside a comment, not inside a skipped/todo
// block, and not failing.
// =========================================================================
const ENFORCED_GRAMMAR =
  /^ENFORCED kind=(request-rate|byte-volume|pair-attempt) scope=(token-hash|origin|pairing-attempt) limit=(\d+) windowMs=(none|\d+) overflow=(reject-429|reject-413)$/;

async function checkC9F6(): Promise<void> {
  const startedAt = Date.now();
  try {
    const matrix = loadAttributionMatrix();
    if (!matrix) {
      record(
        'C9F-6',
        'loadAttributionMatrix()',
        'containment threat class (path traversal + symlink escape + baseDir exception) covered per attributed row',
        false,
        `${ATTRIBUTION_MATRIX_RELPATH} does not exist yet`,
        { durationMs: Date.now() - startedAt },
      );
      return;
    }
    const requiredPatterns: Array<{ label: string; re: RegExp }> = [
      { label: 'traversal (../)', re: /\.\.\// },
      { label: 'encoded traversal', re: /%2e%2e|%252e%252e/i },
      { label: 'absolute path', re: /absolute/i },
      { label: 'null byte', re: /null.?byte|%00|\\x00|\\0/i },
      { label: 'symlink escape', re: /symlink/i },
    ];
    const problems: string[] = [];
    const runDetails: string[] = [];
    let checkedRows = 0;
    for (const row of matrix.rows) {
      const rs = row.riskScore;
      if (!rs || (rs.tier !== 'P0' && rs.tier !== 'P1')) continue;
      // Scoped to rows whose OWN route path carries a caller-supplied
      // `:param` segment -- a mechanical, re-derivable proxy for "this
      // route resolves a caller-influenced identifier into a filesystem
      // path" (a project id, file name, plugin id, ...). A P0/P1 row
      // reachable at a fully-static path (no `:param` anywhere) has no
      // caller-controlled path component for a traversal/symlink/baseDir
      // spec to exercise in the first place -- requiring one anyway would
      // be an UNSATISFIABLE criterion for that row, not a stronger one.
      if (!/:[A-Za-z0-9_]+/.test(String(row.path))) continue;
      checkedRows++;
      const key = `${String(row.method)} ${String(row.path)}`;
      const testRef = typeof row.testRef === 'string' ? row.testRef : null;
      if (!testRef) {
        problems.push(`${key}: no testRef to inspect for containment coverage`);
        continue;
      }
      const parsed = parseTestRef(testRef);
      if (!parsed) {
        problems.push(`${key}: testRef "${testRef}" not in "<file> :: <fullName>" shape`);
        continue;
      }
      const summary = getVitestFileSummary(parsed.file);
      if (!summary) {
        problems.push(`${key}: could not execute cited file ${parsed.file} via a live vitest run`);
        continue;
      }
      const passedTitles = allAssertionsIn(summary)
        .filter((a) => a.status === 'passed')
        .map((a) => a.fullName);
      for (const { label, re } of requiredPatterns) {
        if (!passedTitles.some((t) => re.test(t))) {
          problems.push(`${key}: no PASSING assertion title in ${parsed.file} matches "${label}"`);
        }
      }
      // T3 -- the imported-folder `metadata.baseDir` exception, handled
      // precisely: a NEGATIVE assertion (a managed project cannot spoof the
      // imported-folder branch to escape PROJECTS_DIR) paired with a
      // POSITIVE assertion (a genuine imported-folder project's legitimate
      // baseDir access still succeeds). Over-containment (breaking the
      // sanctioned exception) is caught exactly as reliably as
      // under-containment, because both sides are required as DISTINCT
      // passing assertions, never a single title satisfying both regexes.
      const baseDirSpoofRejected = passedTitles.find((t) => /basedir/i.test(t) && /spoof|escape|managed|reject|denied/i.test(t));
      const baseDirLegitimateAccepted = passedTitles.find(
        (t) => (/basedir/i.test(t) || /imported.?folder/i.test(t)) && /legitimate|allow|succeed|control|accept/i.test(t) && t !== baseDirSpoofRejected,
      );
      if (!baseDirSpoofRejected) {
        problems.push(`${key}: no PASSING assertion title proves a spoofed baseDir on a managed project is rejected`);
      }
      if (!baseDirLegitimateAccepted) {
        problems.push(`${key}: no PASSING assertion title proves a genuine imported-folder project's baseDir access still succeeds (over-containment check)`);
      }
      runDetails.push(`${key}: ${passedTitles.length} passing assertions checked in ${parsed.file}`);
    }
    record(
      'C9F-6',
      'name-pattern match against REAL PASSED assertion titles from a live vitest run of each P0/P1 row\'s cited file',
      'every P0/P1 row has a currently-passing, named assertion for ../, encoded, absolute, null-byte, and symlink-escape forms, PLUS a paired baseDir-spoof-rejected/baseDir-legitimate-accepted pair -- title-pattern proxy over real runtime pass status, not semantic body verification',
      problems.length === 0 && checkedRows > 0,
      [`P0/P1 rows checked: ${checkedRows}`, ...runDetails, ...problems].join('\n'),
      { durationMs: Date.now() - startedAt },
    );
  } catch (err) {
    record('C9F-6', 'checkC9F6', 'containment threat class', false, String((err as Error)?.stack ?? err), {
      detail: `crashed: ${String(err)}`,
      durationMs: Date.now() - startedAt,
    });
  }
}

async function checkC9F7(): Promise<void> {
  const startedAt = Date.now();
  try {
    const matrix = loadAttributionMatrix();
    if (!matrix) {
      record(
        'C9F-7',
        'loadAttributionMatrix()',
        'size-limit threat class resolved for every P0 row with mechanical impact 3',
        false,
        `${ATTRIBUTION_MATRIX_RELPATH} does not exist yet`,
        { durationMs: Date.now() - startedAt },
      );
      return;
    }
    const atBase = await getUniverseAtBaseCommit();
    const fsHitByKey = new Map<string, RouteRow>();
    for (const r of atBase.rows.filter((x) => x.classification === 'fs-hit')) fsHitByKey.set(`${r.method} ${r.routePath}`, r);

    const problems: string[] = [];
    const runDetails: string[] = [];
    let checkedRows = 0;
    for (const row of matrix.rows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      const baseline = fsHitByKey.get(key);
      if (!baseline || mechanicalImpactFor(baseline) !== 3) continue;
      const rs = row.riskScore;
      if (!rs || rs.tier !== 'P0') continue;
      checkedRows++;
      if (row.acceptedRisk?.decisionRef) continue; // resolved via accepted risk, checked by C9F-4
      const mechanism = row.control?.mechanism;
      if (typeof mechanism !== 'string' || !ENFORCED_GRAMMAR.test(mechanism)) {
        problems.push(`${key}: control.mechanism does not match the anchored ENFORCED grammar exactly`);
        continue;
      }
      const match = ENFORCED_GRAMMAR.exec(mechanism)!;
      const kind = match[1]!;
      const windowMs = match[4]!;
      if (kind === 'byte-volume' && windowMs !== 'none') problems.push(`${key}: byte-volume must declare windowMs=none`);
      if ((kind === 'request-rate' || kind === 'pair-attempt') && windowMs === 'none') {
        problems.push(`${key}: ${kind} requires a positive windowMs`);
      }
      const testRef = typeof row.control?.testRef === 'string' ? row.control.testRef : null;
      if (!testRef) {
        problems.push(`${key}: control.testRef missing`);
        continue;
      }
      const parsed = parseTestRef(testRef);
      if (!parsed) {
        problems.push(`${key}: control.testRef "${testRef}" not in "<file> :: <fullName>" shape`);
        continue;
      }
      const summary = getVitestFileSummary(parsed.file);
      if (!summary) {
        problems.push(`${key}: could not execute control.testRef file ${parsed.file} via a live vitest run`);
        continue;
      }
      const passedTitles = allAssertionsIn(summary)
        .filter((a) => a.status === 'passed')
        .map((a) => a.fullName);
      const limit = match[3]!;
      const overflow = match[5]!;
      const expectedStatus = overflow === 'reject-429' ? '429' : '413';
      const limitTokenRe = new RegExp(`(?<![0-9])${limit}(?![0-9])`);
      const statusTokenRe = new RegExp(`(?<![0-9])${expectedStatus}(?![0-9])`);
      const acceptedTitle = passedTitles.find((t) => limitTokenRe.test(t) && !statusTokenRe.test(t));
      const rejectedTitle = passedTitles.find((t) => limitTokenRe.test(t) && statusTokenRe.test(t));
      if (!acceptedTitle) {
        problems.push(`${key}: no PASSING assertion title names the declared limit ${limit} as an exact digit-bounded token on an accept-shaped case`);
      }
      if (!rejectedTitle) {
        problems.push(`${key}: no PASSING assertion title names both the declared limit ${limit} AND overflow status ${expectedStatus} as exact digit-bounded tokens`);
      }
      runDetails.push(`${key}: ${passedTitles.length} passing assertions checked in ${parsed.file}`);
    }
    record(
      'C9F-7',
      'anchored ENFORCED-grammar match + digit-bounded limit/overflow token check against REAL PASSED assertion titles',
      'every P0 row with mechanical impact 3 resolves size/rate limit via the anchored grammar with a currently-passing, digit-bound accept/reject control pair, or a verified acceptedRisk',
      problems.length === 0 && checkedRows > 0,
      [`P0 upload-surface rows checked: ${checkedRows}`, ...runDetails, ...problems].join('\n'),
      { durationMs: Date.now() - startedAt },
    );
  } catch (err) {
    record('C9F-7', 'checkC9F7', 'size-limit threat class', false, String((err as Error)?.stack ?? err), {
      detail: `crashed: ${String(err)}`,
      durationMs: Date.now() - startedAt,
    });
  }
}


// =========================================================================
// C9F-8 -- loopback-gating threat class: a REAL HTTP probe against an
// isolated daemon, never a static-code-only claim.
// =========================================================================
async function checkC9F8(): Promise<void> {
  const startedAt = Date.now();
  let live: LiveDaemon | null = null;
  try {
    const atBase = await getUniverseAtBaseCommit();
    const exposure0 = atBase.rows.filter((r) => r.classification === 'fs-hit' && r.exposure === 0);
    if (exposure0.length === 0) {
      // Genuinely empty population, not a pass: no daemon boots, no HTTP
      // request is issued, nothing about the loopback-gating threat class is
      // actually exercised. Recording this as 'pass' would be exactly the
      // vacuous-.every()-over-an-empty-set shape (0/0 probes "pass" without
      // anything having been tested) -- reported as 'not-exercised' instead,
      // which is neither a false green nor a false red.
      record(
        'C9F-8',
        'no exposure-0 rows found -- probe loop never runs',
        'loopback-gating threat class',
        false,
        'no exposure===0 fs-hit routes at baseCommit -- the probe loop has zero rows to exercise; nothing was tested either way',
        { durationMs: Date.now() - startedAt, status: 'not-exercised' },
      );
      return;
    }
    live = await bootIsolatedDaemon();
    const results: string[] = [];
    let anyFail = false;
    // Probe a small representative sample (all of them, capped, to bound
    // runtime) rather than every one of a potentially large set.
    const sample = exposure0.slice(0, 15);
    for (const row of sample) {
      const testPath = row.routePath.replace(/:[^/]+/g, 'probe-id');
      const url = `${live.url}${testPath}`;
      try {
        const nonLoopback = await safeProbeFetch(url, {
          method: row.method,
          headers: { Origin: 'http://example.com', 'X-Forwarded-Host': 'example.com' },
        });
        const exactRejection = nonLoopback.status === 401 || nonLoopback.status === 403;
        if (!exactRejection) {
          anyFail = true;
          results.push(`${row.method} ${row.routePath}: non-loopback-shaped request got status ${nonLoopback.status}, expected exact 401/403`);
        } else {
          results.push(`${row.method} ${row.routePath}: non-loopback-shaped request correctly rejected with ${nonLoopback.status}`);
        }
      } catch (err) {
        anyFail = true;
        results.push(`${row.method} ${row.routePath}: probe error ${String((err as Error)?.message ?? err)}`);
      }
    }
    // Teardown is checked and folded into THIS criterion's own verdict
    // before record() runs -- a resolved shutdown() promise from a single
    // leader is not proof the whole process group exited; a failed or
    // partial teardown fails C9F-8 outright, never merely logged after the
    // fact where it can no longer affect the recorded status.
    const teardown = await live.shutdown();
    live = null; // teardown already ran; the finally block below must not repeat it
    if (!teardown.ok) {
      anyFail = true;
      results.push(`daemon teardown NOT confirmed: ${teardown.detail}`);
    }
    record(
      'C9F-8',
      'safeProbeFetch against bootIsolatedDaemon() for every mechanically exposure===0 row, teardown confirmed group-empty',
      'a non-loopback-shaped request receives an exact 401/403; redirect:manual, fail-closed URL validation, refuses ports 7456/51012; daemon process-group teardown independently confirmed empty',
      !anyFail,
      [`exposure-0 fs-hit rows total: ${exposure0.length} (sampled ${sample.length})`, `teardown: ok=${teardown.ok} (${teardown.detail})`, ...results].join('\n'),
      { durationMs: Date.now() - startedAt },
    );
  } catch (err) {
    record('C9F-8', 'checkC9F8', 'loopback-gating threat class', false, String((err as Error)?.stack ?? err), {
      detail: `crashed: ${String(err)}`,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    // Safety net only -- the success path already tore down and nulled
    // `live` above. This only fires on an exception path where teardown
    // never ran; it is best-effort and does not retroactively change the
    // already-recorded criterion result (the exception path already
    // recorded fail via the catch block above).
    if (live) await live.shutdown().catch(() => {});
  }
}

// =========================================================================
// C9F-9 -- gates.
// =========================================================================
async function checkC9F9(): Promise<void> {
  const startedAt = Date.now();
  // INVARIANT 2 fix (round-3 founder ruling, F5 HIGH): `pnpm typecheck`
  // below is itself an evidence-bearing path -- it typechecks every
  // workspace package (`pnpm -r --if-present run typecheck`), including
  // packages outside `apps/daemon`'s own dependency graph (e.g. `apps/web`,
  // which depends on `@open-design/components`/`@open-design/host`). Ensure
  // the SAME workspace-wide rebuild `bootIsolatedDaemon` uses has run first,
  // so this evidence path also never resolves unpinned mutable dist.
  await ensureFirstPartyPackagesRebuiltFromHead();
  const guard = sh('pnpm', ['guard'], { timeoutMs: 15 * 60_000 });
  const typecheck = sh('pnpm', ['typecheck'], { timeoutMs: 15 * 60_000 });
  const ok = guard.status === 0 && typecheck.status === 0;
  record(
    'C9F-9',
    'pnpm guard && pnpm typecheck',
    'both gates exit 0 on the current tree',
    ok,
    [`pnpm guard: exit=${guard.status}`, guard.stdout.slice(-2000), guard.stderr.slice(-2000), `pnpm typecheck: exit=${typecheck.status}`, typecheck.stdout.slice(-2000), typecheck.stderr.slice(-2000)].join('\n'),
    { durationMs: Date.now() - startedAt },
  );
}

// =========================================================================
// C9F-10 -- adversarial review of the implementation on record.
// =========================================================================
async function checkC9F10(): Promise<void> {
  const startedAt = Date.now();
  const abs = path.join(repoRoot, IMPLEMENTATION_REVIEW_RELPATH);
  if (!fs.existsSync(abs)) {
    record('C9F-10', 'read implementation review record', 'adversarial review of the implementation on record, non-spoofable', false, `${IMPLEMENTATION_REVIEW_RELPATH} does not exist yet`, {
      durationMs: Date.now() - startedAt,
    });
    return;
  }
  try {
    const review = JSON.parse(fs.readFileSync(abs, 'utf8')) as {
      reviewer?: string;
      model?: string;
      reviewedCommit?: string;
      verdict?: string;
    };
    const problems: string[] = [];
    if (!review.reviewedCommit || !resolveCommit(review.reviewedCommit)) problems.push('reviewedCommit does not resolve to a real commit');
    else {
      if (review.reviewedCommit === headSha) problems.push('reviewedCommit must be a STRICT ancestor of HEAD, not HEAD itself');
      else if (!isAncestor(review.reviewedCommit, headSha)) problems.push('reviewedCommit is not an ancestor of HEAD');
      else {
        const ownedPaths = [
          ...new Set(
            (await getUniverseAtBaseCommit()).rows.filter((r) => r.classification === 'fs-hit').map((r) => r.file),
          ),
          ATTRIBUTION_MATRIX_RELPATH,
          THREAT_MODEL_DOC_RELPATH,
        ];
        const diff = sh('git', ['diff', '--name-only', review.reviewedCommit, headSha, '--', ...ownedPaths]);
        if (diff.status === 0 && diff.stdout.trim().length > 0) {
          problems.push(`owned-path diff between reviewedCommit and HEAD is non-empty: ${diff.stdout.trim().split('\n').join(', ')}`);
        }
        const authors = commitAuthorsBetween(baseCommit, review.reviewedCommit);
        if (review.reviewer && authors.has(normalizeIdentity(review.reviewer))) {
          problems.push('reviewer matches a commit author in baseCommit..reviewedCommit');
        }
      }
    }
    if (!review.reviewer) problems.push('reviewer missing');
    if (review.verdict !== 'APPROVE') problems.push(`verdict is "${String(review.verdict)}", not APPROVE`);
    record(
      'C9F-10',
      'validate implementation review record',
      'reviewedCommit is a strict ancestor of HEAD with an empty owned-path diff since; reviewer distinct from every author in baseCommit..reviewedCommit; verdict APPROVE',
      problems.length === 0,
      problems.join('\n') || 'review record valid',
      { durationMs: Date.now() - startedAt },
    );
  } catch (err) {
    record('C9F-10', 'checkC9F10', 'implementation review record', false, String((err as Error)?.stack ?? err), {
      detail: `crashed: ${String(err)}`,
      durationMs: Date.now() - startedAt,
    });
  }
}

// =========================================================================
// Named infra checks: GATE-INTEGRITY, LEASE, HEAD-DRIFT.
// =========================================================================
function checkGateIntegrity(): void {
  record(
    'GATE-INTEGRITY',
    'check for ~/.claude/goal-state/<slug>/approved-gate.sha256',
    'an orchestrator-held approved-gate pin exists for this PRD+verifier pair (advisory)',
    true, // advisory: absence does not fail the run; C9F-1/C9F-2 anchor to baseCommit regardless of pin timing
    `gateIntegrityPinned=${gateIntegrityPinned}`,
  );
}
const PROPOSED_LEASE_ALLOW = [
  'apps/daemon/src/brand-routes.ts',
  'apps/daemon/src/connectors/routes.ts',
  'apps/daemon/src/import-export-routes.ts',
  'apps/daemon/src/mcp-routes.ts',
  'apps/daemon/src/routes/automation.ts',
  'apps/daemon/src/routes/daemon.ts',
  'apps/daemon/src/routes/design-system-tool.ts',
  'apps/daemon/src/routes/design-systems.ts',
  'apps/daemon/src/routes/genui.ts',
  'apps/daemon/src/routes/media.ts',
  'apps/daemon/src/routes/memory.ts',
  'apps/daemon/src/routes/plugins/assets.ts',
  'apps/daemon/src/routes/plugins/index.ts',
  'apps/daemon/src/routes/project/index.ts',
  'apps/daemon/src/routes/routine.ts',
  'apps/daemon/src/routes/runs.ts',
  'apps/daemon/src/routes/static-resource.ts',
  'apps/daemon/src/routes/vela.ts',
  'apps/daemon/src/routes/whats-new.ts',
  'apps/daemon/src/routes/xai.ts',
  'apps/daemon/src/server.ts',
  'apps/daemon/tests/',
  'docs/security/',
  'docs/plans/waves/DECISIONS.md',
];
const PROPOSED_LEASE_DENY = [
  'apps/daemon/src/routes/library.ts',
  'apps/daemon/src/library-store.ts',
  'apps/daemon/src/backup/',
  'docs/plans/waves/W9-filesystem-tranche.md',
  'scripts/waves/verify-w9-filesystem.ts',
];
function checkLease(): void {
  // leases.json does not yet carry a "W9-filesystem" entry -- this PRD's
  // lease is PROPOSED text only (see the PRD's "Proposed lease" section),
  // not yet a granted, machine-checked lease. Until a maintainer amends
  // leases.json, this check validates the branch diff against the PROPOSED
  // allow/deny lists above (parity with what LEASE will assert once real),
  // and always passes the deny-list half unconditionally (the deny list is
  // this document's own house rule and needs no external grant to enforce).
  const diff = sh('git', ['diff', '--name-only', `${baseCommit}...${headSha}`]);
  const changed = diff.status === 0 ? diff.stdout.split('\n').filter(Boolean) : [];
  const deniedHit = changed.filter((f) => PROPOSED_LEASE_DENY.some((d) => f === d || f.startsWith(d)));
  const leasesJsonPath = path.join(repoRoot, 'docs/plans/waves/leases.json');
  let realLeaseGranted = false;
  try {
    const leasesAtBase = sh('git', ['show', `${baseCommit}:docs/plans/waves/leases.json`]);
    if (leasesAtBase.status === 0) {
      const parsed = JSON.parse(leasesAtBase.stdout) as { waves?: Record<string, unknown> };
      realLeaseGranted = !!parsed.waves?.['W9-filesystem'];
    }
  } catch {
    realLeaseGranted = false;
  }
  const ok = deniedHit.length === 0 && (changed.length === 0 || realLeaseGranted || changed.every((f) => PROPOSED_LEASE_ALLOW.some((a) => f === a || f.startsWith(a))));
  record(
    'LEASE',
    'git diff --name-only <baseCommit>...HEAD against the proposed/granted lease',
    'branch diff never touches the deny list (this PRD + its own verifier); once leases.json@baseCommit grants a real W9-filesystem entry, the diff is a subset of it',
    ok,
    [`changed files: ${changed.length}`, `denied-path hits: ${deniedHit.join(', ') || 'none'}`, `real leases.json entry present at baseCommit: ${realLeaseGranted}`, fs.existsSync(leasesJsonPath) ? '' : 'leases.json missing entirely'].join('\n'),
  );
}
function checkHeadDrift(headAtStart: string): void {
  const now = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  record('HEAD-DRIFT', 'git rev-parse HEAD (start vs. end)', 'HEAD does not move during the verifier run', now === headAtStart, `start=${headAtStart} end=${now}`);
}

// =========================================================================
// main
// =========================================================================
async function main(): Promise<void> {
  const headAtStart = headSha;

  // Placeholder write BEFORE any criterion runs (F5-style fix, identical to
  // verify-w9-ingest.ts): if this fails, abort rather than risk a stale
  // prior-run manifest looking current.
  const placeholder = writeManifestFile(buildManifest(false, treeDirtyAtStart, false));
  if (!placeholder.written) {
    console.error('verify-w9-filesystem: FATAL: could not write the initial wroteOk:false placeholder manifest; aborting.');
    process.exit(1);
  }

  checkGateIntegrity();
  await checkCriterion('C9F-1', checkC9F1);
  await checkCriterion('C9F-2', checkC9F2);
  await checkCriterion('C9F-3', checkC9F3);
  await checkCriterion('C9F-4', checkC9F4);
  await checkCriterion('C9F-5', checkC9F5);
  await checkCriterion('C9F-6', checkC9F6);
  await checkCriterion('C9F-7', checkC9F7);
  await checkCriterion('C9F-8', checkC9F8);
  await checkCriterion('C9F-9', checkC9F9);
  await checkCriterion('C9F-10', checkC9F10);
  checkLease();
  checkHeadDrift(headAtStart);

  const treeDirtyAtEnd = isTreeDirty();
  const manifest = buildManifest(true, treeDirtyAtStart || treeDirtyAtEnd, false);
  const archive = archiveRunArtifacts(manifest);
  const finalManifest: ManifestShape = { ...manifest, archiveOk: archive.ok };
  const written = writeManifestFile(finalManifest);

  console.log('\n=== verify-w9-filesystem scoreboard ===');
  for (const r of results) {
    const label = r.status === 'pass' ? 'PASS' : r.status === 'not-exercised' ? 'N/EX' : 'FAIL';
    console.log(`${label}  ${r.id.padEnd(14)} ${r.assertion}`);
  }
  console.log(`\nmanifest: ${path.join(proofDir, 'manifest.json')} (written=${written.written}, sha256=${written.sha256})`);
  console.log(`archive: ${archive.runDir} (ok=${archive.ok})`);
  console.log(`treeDirty: ${finalManifest.treeDirty}`);

  const anyFail = results.some((r) => r.status !== 'pass') || !written.written || !archive.ok || finalManifest.treeDirty;
  process.exit(anyFail ? 1 : 0);
}

main().catch((err) => {
  writeEmergencyManifest(String((err as Error)?.stack ?? err), results);
  console.error(`verify-w9-filesystem: FATAL in main(): ${String((err as Error)?.stack ?? err)}`);
  process.exit(1);
});
