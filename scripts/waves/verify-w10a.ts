// verify-w10a.ts -- wave mishmash-w10a-instatic (Instatic seam: MCP client
// registration + Super Import static export) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// AFTER FREEZE, THIS COMMITTED COPY IS A BASELINE INPUT, NOT AN
// IMPLEMENTATION-LEASE FILE. The proposed lease in W10a-instatic-seam.md
// deliberately excludes this file and the PRD itself -- the implementer
// cannot edit either under lease. Landing REQUIRES running an
// orchestrator-custody copy of this exact approved text (see the PRD's
// "Implementation ceremony" section) and `manifest.gateIntegrityPinned ===
// true` with a matching hash; an unpinned run is advisory evidence only,
// never sufficient to land (round-1 adversarial finding #2).
//
// Run: pnpm exec tsx scripts/waves/verify-w10a.ts [--repo <path>]
// Exit 0 only when every C10A criterion passes, the tree is clean, and the
// manifest placeholder wrote successfully. The commit-bound proof manifest is
// always written to the wave's goal-state proof directory, pass or fail, per
// VERIFICATION-CONTRACT.md section 2.
//
// Scope: docs/plans/waves/W10a-instatic-seam.md, pinned verbatim to the NM-24
// founder ruling ("seam = MCP + Super Import only ... deeper coupling needs
// separate evidence", docs/plans/waves/NM-REGISTER.md).
//
// ROUND-1 ADVERSARIAL FIXES applied in this revision (verbatim findings, see
// PRD "Adversarial review round 1" section for full text):
//   1. C10A-5 rebuilt on an AST added-call/added-import diff (base vs HEAD),
//      not a whole-file regex -- unsatisfiable-with-existing-tokens and
//      porous-to-net/undici/WebSocket/child_process bugs both fixed.
//   3. C10A-2's fixture now covers every classifyFiles.ts role (html, css,
//      js, image, font, ordinary meta/json, binary), a .instatic/
//      site-bundle.json poison-file rejection test, and real HTTP 4xx
//      assertions for BOTH size guards via an injectable-limit env-var
//      contract this PRD pins (S10A-2) -- never source-text-only.
//   4. C10A-4 rebuilt on cross-file AST binding (DesignFilesPanel.tsx's
//      labeled click handler -> the imported apps/web/src/runtime/exports.ts
//      helper -> the route literal inside ITS fetch call), comment-safe by
//      construction (AST node text excludes trivia).
//   6. C10A-1 tightens the header check to the exact "Bearer imcp_pat_"
//      shape, adds a source-level ban on any SpreadAssignment in the new
//      template object literal (carry-forward hardening), and functionally
//      exercises the required new apps/web/src/state/mcpTemplateRow.ts pure
//      module (rowFromTemplate + the URL-edit-sticky authMode fix) instead
//      of checking the static API object alone.
//   7. Every daemon URL (main boot + the two injectable-limit boots) is
//      parsed and validated -- http:, exact loopback host, a nonzero
//      OS-assigned port, and explicit exclusion of 7456/51012 -- BEFORE any
//      request or CLI spawn is issued against it. A validation failure is
//      treated exactly like a boot failure: fail closed, never trusted.
//   8. Template-count citations corrected to the real total (39, re-derived
//      programmatically below, never hand-counted).
//
// PORTABILITY: repoRoot comes from `process.cwd()`/`--repo`, never
// `import.meta.url`. ISOLATION (non-negotiable): every daemon this verifier
// boots uses port 0 (OS-assigned ephemeral port) and a fresh `mkdtemp`
// OD_DATA_DIR, is torn down by its own exact child-process handle (SIGTERM,
// then SIGKILL after a bounded wait), and every `od` CLI subprocess is
// pointed at an already-validated isolated daemon via BOTH `--daemon-url`
// and `OD_DAEMON_URL`. This verifier never resolves, reads, or sends a
// request to ports 7456 or 51012, and never issues `git fetch`/`git push`.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type TypeScriptModule from 'typescript';
import type { Node as TsNode } from 'typescript';

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx === -1 ? undefined : argv[idx + 1];
}

const WAVE_SLUG = 'mishmash-w10a-instatic';
const LEASE_KEY = 'W10a-instatic';

function emergencyExit(errorMessage: string): never {
  try {
    const manifest = {
      wave: 'W10a-instatic',
      commit: 'unknown',
      treeDirty: true,
      baseCommit: 'unknown',
      wroteOk: false,
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
      path.join(os.tmpdir(), 'verify-w10a-emergency-manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
  } catch {
    /* truly nothing more we can do */
  }
  console.error(`verify-w10a: FATAL during init: ${errorMessage}`);
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
  const fallbackResult = tryWrite(path.join(os.tmpdir(), 'verify-w10a-fallback-proof', `${id}.txt`));
  if (fallbackResult) return fallbackResult;
  console.error(`verify-w10a: artifact write failed for ${id} on both primary and fallback paths`);
  return { artifact: null, artifactSha256: null };
}

const results: CriterionResult[] = [];
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
      `# ${id}\n# assertion: ${assertion}\n# verdict: ${ok ? 'pass' : 'fail'}\n${opts.detail ? `# detail: ${opts.detail}\n` : ''}\n${evidence}\n`,
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
      detail: artifact === null ? `${opts.detail ? `${opts.detail}; ` : ''}artifact write failed -- forced fail` : opts.detail,
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
    wave: 'W10a-instatic',
    commit: 'unknown',
    treeDirty: true,
    baseCommit: 'unknown',
    wroteOk: false,
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
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w10a-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
    } catch {
      /* last resort: stderr only */
    }
  }
  console.error(`verify-w10a: FATAL, emergency manifest written=${wrote}: ${errorMessage}`);
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

function readFileAtCommitOrEmpty(commit: string, relPath: string): string {
  const r = sh('git', ['show', `${commit}:${relPath}`]);
  return r.status === 0 ? r.stdout : '';
}
function fileExistsAtCommit(commit: string, relPath: string): boolean {
  return sh('git', ['cat-file', '-e', `${commit}:${relPath}`]).status === 0;
}

const gateIntegrityPinned = fs.existsSync(path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'approved-gate.sha256'));

interface ManifestShape {
  wave: string;
  commit: string;
  treeDirty: boolean;
  baseCommit: string;
  wroteOk: boolean;
  gateIntegrityPinned: boolean;
  toolchain: { node: string; pnpm: string };
  criteria: CriterionResult[];
}
function buildManifest(wroteOk: boolean, treeDirty: boolean): ManifestShape {
  return {
    wave: 'W10a-instatic',
    commit: headSha,
    treeDirty,
    baseCommit,
    wroteOk,
    gateIntegrityPinned,
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
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w10a-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
      console.error(`verify-w10a: primary manifest write failed (${String(err)}); wrote fallback`);
    } catch (err2) {
      console.error(`verify-w10a: manifest write failed everywhere (${String(err)} / ${String(err2)})`);
    }
    return { written: false, sha256: 'unavailable' };
  }
}

// =========================================================================
// AST helpers -- shared by C10A-1 (spread ban), C10A-4 (click-handler
// binding), and C10A-5 (added-call/added-import diff). Every "is this a
// comment" question is answered by the parser itself (node.getText()
// excludes leading/trailing trivia), never by a naive string split -- this
// is what closes the carry-forward hardening note's `${0}// TEXT` template-
// literal-tail failure mode.
// =========================================================================
function parseTs(text: string, fileName: string): TsNode {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS) as unknown as TsNode;
}
function walkAll(root: TsNode, visit: (n: TsNode) => void): void {
  visit(root);
  ts.forEachChild(root as any, (child: any) => walkAll(child as TsNode, visit));
}
function nodeText(sf: TsNode, n: TsNode): string {
  try {
    return (n as any).getText(sf as any) as string;
  } catch {
    return '';
  }
}

// Every CallExpression/NewExpression's own trimmed text, scoped to that node
// only (never the whole file) -- this is what makes the base-vs-head "added
// call" diff meaningful: a call whose exact text already existed at
// baseCommit is NOT newly added, regardless of which OTHER lines around it
// changed.
function collectCallTexts(sf: TsNode): Set<string> {
  const out = new Set<string>();
  walkAll(sf, (n) => {
    if (ts.isCallExpression(n as any) || ts.isNewExpression(n as any)) {
      out.add(nodeText(sf, n).trim());
    }
  });
  return out;
}
function collectImportSpecifiers(sf: TsNode): Set<string> {
  const out = new Set<string>();
  walkAll(sf, (n) => {
    if (ts.isImportDeclaration(n as any)) {
      const spec = (n as any).moduleSpecifier;
      if (spec && ts.isStringLiteral(spec)) out.add((spec as { text: string }).text);
    }
  });
  return out;
}

const SUSPICIOUS_IMPORT_MODULES = new Set([
  'axios', 'undici', 'node:net', 'net', 'node:child_process', 'child_process',
  'ws', 'got', 'node-fetch', 'superagent', 'ky', 'request', 'needle', 'phin',
]);
const CHILD_PROCESS_EXEC_NAMES = new Set(['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync']);
const CURL_LIKE_PATTERN = /\b(curl|wget|nc|netcat)\b/i;

// Classifies a single CallExpression/NewExpression AST node (never raw file
// text) as a forbidden network-egress or live-config-mutation primitive.
// Returns a human reason string when forbidden, null when the node is
// something else entirely (most calls are not primitives at all). Returns
// the sentinel '__FETCH__' for a plain fetch(...) call so the caller can
// apply the allowlist-by-file-and-argument-text rule.
function classifyForbiddenCallNode(sf: TsNode, n: TsNode): string | null {
  const callee = (n as any).expression as TsNode | undefined;
  if (!callee) return null;
  if (ts.isIdentifier(callee as any)) {
    const name = (callee as any).text as string;
    if (name === 'writeMcpConfig') return 'writeMcpConfig(...) call';
    if (name === 'fetch') return '__FETCH__';
    if (CHILD_PROCESS_EXEC_NAMES.has(name)) {
      const argsText = nodeText(sf, n);
      if (CURL_LIKE_PATTERN.test(argsText)) return `${name}(...) invoking curl/wget/nc`;
    }
    return null;
  }
  if (ts.isPropertyAccessExpression(callee as any)) {
    const objText = nodeText(sf, (callee as any).expression as TsNode);
    const propName = ((callee as any).name as { text: string }).text;
    if (propName === 'writeMcpConfig') return 'writeMcpConfig(...) call';
    if ((objText === 'http' || objText === 'https') && propName === 'request') return `${objText}.request(...) call`;
    if (objText === 'net' && (propName === 'connect' || propName === 'createConnection')) return `net.${propName}(...) call`;
    if (objText === 'undici' && (propName === 'request' || propName === 'fetch')) return `undici.${propName}(...) call`;
    if (objText === 'axios') return 'axios call';
    if (CHILD_PROCESS_EXEC_NAMES.has(propName)) {
      const argsText = nodeText(sf, n);
      if (CURL_LIKE_PATTERN.test(argsText)) return `${propName}(...) invoking curl/wget/nc`;
    }
  }
  return null;
}
function isNewWebSocket(n: TsNode): boolean {
  if (!ts.isNewExpression(n as any)) return false;
  const callee = (n as any).expression as TsNode | undefined;
  return !!callee && ts.isIdentifier(callee as any) && (callee as unknown as { text: string }).text === 'WebSocket';
}

function objectLiteralHasSpread(obj: TsNode): boolean {
  const props = (obj as any).properties as TsNode[] | undefined;
  if (!props) return false;
  return props.some((p) => ts.isSpreadAssignment(p as any));
}

// Finds an ObjectLiteralExpression anywhere in the source whose own
// (non-nested) properties include `id: "<expectedId>"` as a plain string
// literal -- used to locate the Instatic MCP_TEMPLATES entry by the id the
// LIVE HTTP check already discovered, bridging live truth to source truth.
function findObjectLiteralWithStringId(sf: TsNode, expectedId: string): TsNode | null {
  let found: TsNode | null = null;
  walkAll(sf, (n) => {
    if (found) return;
    if (!ts.isObjectLiteralExpression(n as any)) return;
    const props = (n as any).properties as TsNode[];
    for (const p of props) {
      if (ts.isPropertyAssignment(p as any)) {
        const name = (p as any).name;
        const init = (p as any).initializer;
        if (name && ts.isIdentifier(name as any) && (name as { text: string }).text === 'id' && init && ts.isStringLiteral(init as any) && (init as { text: string }).text === expectedId) {
          found = n;
          return;
        }
      }
    }
  });
  return found;
}

// -----------------------------------------------------------------------
// C10A-4 cross-file AST binding helpers.
// -----------------------------------------------------------------------
interface ImportedName {
  localName: string;
  moduleSpecifier: string;
}
function collectNamedImports(sf: TsNode): ImportedName[] {
  const out: ImportedName[] = [];
  walkAll(sf, (n) => {
    if (!ts.isImportDeclaration(n as any)) return;
    const spec = (n as any).moduleSpecifier;
    if (!spec || !ts.isStringLiteral(spec)) return;
    const clause = (n as any).importClause;
    const named = clause?.namedBindings;
    if (named && ts.isNamedImports(named as any)) {
      for (const el of (named as any).elements as TsNode[]) {
        out.push({ localName: ((el as any).name as { text: string }).text, moduleSpecifier: (spec as { text: string }).text });
      }
    }
  });
  return out;
}
// True when a JSX element's own attributes/children (not the whole file)
// contain a string mentioning "instatic" or "super import" case-insensitively.
function jsxSubtreeMentionsLabel(jsxNode: TsNode): boolean {
  let hit = false;
  const pattern = /instatic|super\s*import/i;
  walkAll(jsxNode, (n) => {
    if (hit) return;
    if (ts.isStringLiteral(n as any) || ts.isJsxText(n as any) || ts.isNoSubstitutionTemplateLiteral(n as any)) {
      const text = (n as unknown as { text: string }).text;
      if (pattern.test(text)) hit = true;
    }
  });
  return hit;
}
function findEnclosingJsxElement(node: TsNode): TsNode | null {
  let cur: TsNode | undefined = (node as any).parent as TsNode | undefined;
  while (cur) {
    if (ts.isJsxOpeningElement(cur as any) || ts.isJsxSelfClosingElement(cur as any)) return cur;
    cur = (cur as any).parent as TsNode | undefined;
  }
  return null;
}
// Resolves a JsxAttribute's initializer expression to the function BODY node
// it ultimately runs: an inline arrow/function expression's own body, or (if
// the value is a bare identifier) that identifier's top-level function/const
// declaration in the same file.
function resolveHandlerBody(sf: TsNode, attr: TsNode): TsNode | null {
  const init = (attr as any).initializer;
  if (!init || !ts.isJsxExpression(init as any)) return null;
  const expr = (init as any).expression as TsNode | undefined;
  if (!expr) return null;
  if (ts.isArrowFunction(expr as any) || ts.isFunctionExpression(expr as any)) {
    return (expr as any).body as TsNode;
  }
  if (ts.isIdentifier(expr as any)) {
    const wantedName = (expr as unknown as { text: string }).text;
    let foundBody: TsNode | null = null;
    walkAll(sf, (n) => {
      if (foundBody) return;
      if (ts.isFunctionDeclaration(n as any) && (n as any).name && ((n as any).name as { text: string }).text === wantedName) {
        foundBody = (n as any).body as TsNode;
        return;
      }
      if (ts.isVariableDeclaration(n as any) && ts.isIdentifier((n as any).name as any) && ((n as any).name as { text: string }).text === wantedName) {
        const init2 = (n as any).initializer as TsNode | undefined;
        if (init2 && (ts.isArrowFunction(init2 as any) || ts.isFunctionExpression(init2 as any))) {
          foundBody = (init2 as any).body as TsNode;
        }
      }
    });
    return foundBody;
  }
  return null;
}
// Within a resolved handler body, find every identifier NAME that is called
// (as `name(...)`), scoped to that body's own subtree.
function collectCalledIdentifierNames(bodyNode: TsNode): Set<string> {
  const out = new Set<string>();
  walkAll(bodyNode, (n) => {
    if (!ts.isCallExpression(n as any)) return;
    const callee = (n as any).expression as TsNode;
    if (ts.isIdentifier(callee as any)) out.add((callee as unknown as { text: string }).text);
  });
  return out;
}
// Within a resolved handler body, true when a fetch(...)-shaped call's own
// argument text contains `needle`.
function bodyHasFetchCallContaining(sf: TsNode, bodyNode: TsNode, needle: string): boolean {
  let hit = false;
  walkAll(bodyNode, (n) => {
    if (hit || !ts.isCallExpression(n as any)) return;
    const callee = (n as any).expression as TsNode;
    if (ts.isIdentifier(callee as any) && (callee as unknown as { text: string }).text === 'fetch') {
      if (nodeText(sf, n).includes(needle)) hit = true;
    }
  });
  return hit;
}
function findExportedFunctionBody(sf: TsNode, name: string): TsNode | null {
  let body: TsNode | null = null;
  walkAll(sf, (n) => {
    if (body) return;
    if (ts.isFunctionDeclaration(n as any) && (n as any).name && ((n as any).name as { text: string }).text === name) {
      const mods = ts.getCombinedModifierFlags(n as any) & ts.ModifierFlags.Export;
      if (mods) body = (n as any).body as TsNode;
      return;
    }
    if (ts.isVariableStatement(n as any)) {
      const firstDecl = (n as any).declarationList.declarations[0];
      const mods = firstDecl ? ts.getCombinedModifierFlags(firstDecl) : 0;
      if (!(mods & ts.ModifierFlags.Export)) return;
      for (const decl of (n as any).declarationList.declarations as TsNode[]) {
        if (ts.isIdentifier((decl as any).name as any) && ((decl as any).name as { text: string }).text === name) {
          const init = (decl as any).initializer as TsNode | undefined;
          if (init && (ts.isArrowFunction(init as any) || ts.isFunctionExpression(init as any))) {
            body = (init as any).body as TsNode;
          }
        }
      }
    }
  });
  return body;
}

// =========================================================================
// jszip -- reused from apps/daemon's own already-installed dependency
// (jszip@3.10.1 in apps/daemon/package.json) via createRequire, never a new
// dependency this verifier adds.
// =========================================================================
interface JSZipEntry {
  dir: boolean;
  async(type: 'nodebuffer'): Promise<Buffer>;
}
interface JSZipInstance {
  files: Record<string, JSZipEntry>;
}
interface JSZipStatic {
  loadAsync(data: Buffer | Uint8Array): Promise<JSZipInstance>;
}
let JSZipMod: JSZipStatic;
try {
  JSZipMod = createRequire(path.join(repoRoot, 'apps/daemon/package.json'))('jszip') as JSZipStatic;
} catch (err) {
  emergencyExit(`could not load jszip from apps/daemon/node_modules: ${String((err as Error)?.stack ?? err)}`);
}

// =========================================================================
// Protected-port isolation (round-1 finding #7). The URL a booted daemon
// reports is NOT trusted implicitly -- server.ts is a leased,
// implementation-controlled file, so its own reported `started.url` could in
// principle be wrong. Every daemon URL is parsed and validated before any
// request or CLI spawn ever targets it.
// =========================================================================
const FORBIDDEN_PORTS = new Set([7456, 51012]);
function validateIsolatedDaemonUrl(rawUrl: string): { ok: boolean; detail: string; port: number } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    return { ok: false, detail: `daemon-reported url does not parse: ${String(err)}`, port: -1 };
  }
  if (parsed.protocol !== 'http:') {
    return { ok: false, detail: `expected http:, got ${parsed.protocol}`, port: -1 };
  }
  if (parsed.hostname !== '127.0.0.1') {
    return { ok: false, detail: `expected exact loopback host 127.0.0.1, got ${parsed.hostname}`, port: -1 };
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { ok: false, detail: `expected a valid OS-assigned nonzero port, got "${parsed.port}"`, port: -1 };
  }
  if (FORBIDDEN_PORTS.has(port)) {
    return { ok: false, detail: `port ${port} is a protected default-namespace daemon port -- refusing to use it under any circumstance`, port };
  }
  return { ok: true, detail: 'validated: http, 127.0.0.1, non-protected nonzero port', port };
}

// =========================================================================
// Isolated daemon boot. Port 0, fresh mkdtemp OD_DATA_DIR, kept alive across
// multiple checks, torn down by its own exact child handle. `envOverrides`
// lets C10A-2 inject the size-guard override env vars for the two rejection-
// path boots without needing a 10,001-file fixture.
// =========================================================================
interface BootedDaemon {
  url: string;
  port: number;
  dataDir: string;
  child: ChildProcess;
  scriptPath: string;
}

async function bootIsolatedDaemon(envOverrides: Record<string, string> = {}): Promise<{ daemon: BootedDaemon | null; detail: string }> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w10a-verify-'));
  const bootScript = `
import { pathToFileURL } from 'node:url';
process.env.OD_DATA_DIR = ${JSON.stringify(dataDir)};
const mod = await import(pathToFileURL(${JSON.stringify(path.join(repoRoot, 'apps/daemon/src/server.ts'))}).href);
const started = await mod.startServer({ port: 0, host: '127.0.0.1', returnServer: true });
console.log('OD_W10A_VERIFIER_READY ' + JSON.stringify({ url: started.url }));
`;
  const scriptPath = path.join(proofDir, `.boot-daemon.${process.pid}.${crypto.randomBytes(3).toString('hex')}.mjs`);
  fs.writeFileSync(scriptPath, bootScript);
  const child = spawn('pnpm', ['exec', 'tsx', scriptPath], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...envOverrides, OD_DATA_DIR: dataDir },
  });
  let buffered = '';
  let stderrBuffered = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffered += chunk.toString('utf8');
  });
  const url = await new Promise<string | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 60_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const line = buffered.split('\n').find((l) => l.startsWith('OD_W10A_VERIFIER_READY '));
      if (line) {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(line.slice('OD_W10A_VERIFIER_READY '.length)) as { url: string };
          resolve(parsed.url);
        } catch {
          resolve(null);
        }
      }
    });
    child.on('exit', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
  if (!url) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    return { daemon: null, detail: `daemon failed to report ready within 60s. stderr:\n${stderrBuffered.slice(-4000)}` };
  }
  const validation = validateIsolatedDaemonUrl(url);
  if (!validation.ok) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    return { daemon: null, detail: `daemon reported an untrusted url, refusing to use it: ${validation.detail} (url=${url})` };
  }
  return { daemon: { url, port: validation.port, dataDir, child, scriptPath }, detail: `ready and validated: ${validation.detail}` };
}

async function teardownDaemon(booted: BootedDaemon | null): Promise<void> {
  if (!booted) return;
  await new Promise<void>((resolve) => {
    if (booted.child.exitCode !== null) return resolve();
    const t = setTimeout(() => {
      try {
        booted.child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      resolve();
    }, 5_000);
    booted.child.kill('SIGTERM');
    booted.child.on('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
  try {
    fs.unlinkSync(booted.scriptPath);
  } catch {
    /* best effort */
  }
  try {
    fs.rmSync(booted.dataDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

// =========================================================================
// Fixture project creation -- through the REAL HTTP surface (POST
// /api/projects, POST /api/projects/:id/files), never a database-level
// stub (VERIFICATION-CONTRACT.md section 3 R2).
// =========================================================================
const FIXTURE_INDEX_HTML =
  '<!doctype html><html><head><link rel="stylesheet" href="style.css"><script src="script.js"></script></head><body>Fixture Home</body></html>\n';
const FIXTURE_ABOUT_HTML = '<!doctype html><html><body>Fixture About</body></html>\n';
const FIXTURE_STYLE_CSS = ':root { --color-brand: #111111; }\nbody { color: var(--color-brand); }\n';
const FIXTURE_SCRIPT_JS = "console.log('fixture script');\n";
const FIXTURE_FONT_BYTES = crypto.randomBytes(64);
const FIXTURE_MEDIA_BYTES = crypto.randomBytes(256);
const FIXTURE_JSON_META = `${JSON.stringify({ note: 'ordinary project data file, not a sidecar' }, null, 2)}\n`;
const FIXTURE_PDF_BYTES = crypto.randomBytes(128);
const FIXTURE_SIDECAR_JSON = `${JSON.stringify({ note: 'sidecar -- must never appear in any export path' })}\n`;
const FIXTURE_SIDECAR_NAME = 'index.html.artifact.json';
const FIXTURE_POISON_BUNDLE_JSON = `${JSON.stringify({ schemaVersion: 1, tables: [], rows: [] })}\n`;
const FIXTURE_POISON_PATH = '.instatic/site-bundle.json';

// Expected shape per the REAL Instatic ingestion contract (site-import.md,
// ingestInput.ts, classifyFiles.ts): a flat, relative-path tree covering
// EVERY classifyFiles role, NOT restructured into pages/tokens/media
// folders -- see W10a-instatic-seam.md "Ground facts". Round-1 finding #5:
// the original fixture only covered html/css/image; this now covers every
// role in classifyFiles.ts's table (html, css, js, image, font, ordinary
// meta/json, binary), each a distinct positive control.
const EXPECTED_ZIP_ENTRIES: Record<string, Buffer> = {
  'index.html': Buffer.from(FIXTURE_INDEX_HTML, 'utf8'),
  'docs/about.html': Buffer.from(FIXTURE_ABOUT_HTML, 'utf8'),
  'style.css': Buffer.from(FIXTURE_STYLE_CSS, 'utf8'),
  'script.js': Buffer.from(FIXTURE_SCRIPT_JS, 'utf8'),
  'fonts/brand.woff2': FIXTURE_FONT_BYTES,
  'images/logo.png': FIXTURE_MEDIA_BYTES,
  'data.json': Buffer.from(FIXTURE_JSON_META, 'utf8'),
  'documents/handout.pdf': FIXTURE_PDF_BYTES,
};

interface FixtureProject {
  id: string;
}

async function postFile(baseUrl: string, id: string, name: string, content: string, encoding?: 'base64'): Promise<{ ok: boolean; detail: string }> {
  const body: Record<string, string> = { name, content };
  if (encoding) body.encoding = encoding;
  const resp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}/files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch((err: unknown) => {
    throw new Error(`POST .../files (${name}) network error: ${String(err)}`);
  });
  if (!resp.ok) return { ok: false, detail: `POST /api/projects/${id}/files (${name}) -> HTTP ${resp.status}: ${await resp.text().catch(() => '<unreadable>')}` };
  return { ok: true, detail: 'ok' };
}

async function createProjectShell(baseUrl: string, id: string): Promise<{ ok: boolean; detail: string }> {
  const resp = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, name: id, skipDiscoveryBrief: true }),
  }).catch((err: unknown) => {
    throw new Error(`POST /api/projects network error: ${String(err)}`);
  });
  if (!resp.ok) return { ok: false, detail: `POST /api/projects -> HTTP ${resp.status}: ${await resp.text().catch(() => '<unreadable>')}` };
  return { ok: true, detail: 'ok' };
}

async function createFixtureProject(baseUrl: string): Promise<{ fixture: FixtureProject | null; detail: string }> {
  const id = `w10a-fixture-${crypto.randomBytes(6).toString('hex')}`;
  const shell = await createProjectShell(baseUrl, id);
  if (!shell.ok) return { fixture: null, detail: shell.detail };
  const files: Array<{ name: string; content: string; encoding?: 'base64' }> = [
    { name: 'index.html', content: FIXTURE_INDEX_HTML },
    { name: 'docs/about.html', content: FIXTURE_ABOUT_HTML },
    { name: 'style.css', content: FIXTURE_STYLE_CSS },
    { name: 'script.js', content: FIXTURE_SCRIPT_JS },
    { name: 'fonts/brand.woff2', content: FIXTURE_FONT_BYTES.toString('base64'), encoding: 'base64' },
    { name: 'images/logo.png', content: FIXTURE_MEDIA_BYTES.toString('base64'), encoding: 'base64' },
    { name: 'data.json', content: FIXTURE_JSON_META },
    { name: 'documents/handout.pdf', content: FIXTURE_PDF_BYTES.toString('base64'), encoding: 'base64' },
    { name: FIXTURE_SIDECAR_NAME, content: FIXTURE_SIDECAR_JSON },
  ];
  for (const f of files) {
    const r = await postFile(baseUrl, id, f.name, f.content, f.encoding);
    if (!r.ok) return { fixture: null, detail: r.detail };
  }
  return { fixture: { id }, detail: `fixture project created with ${files.length} files (8 real, covering every classifyFiles role, + 1 sidecar negative control)` };
}

// A second, minimal project whose tree contains a file at the EXACT path an
// Instatic-native transfer archive's manifest lives at. Per site-import.md
// line 302, a ZIP whose first entry is .instatic/site-bundle.json routes to
// the DIFFERENT CMS-bundle import path, not Super Import -- if this project
// tree happened to contain such a file, silently including it would produce
// a zip Instatic would misinterpret entirely. The export route must reject
// this case (round-1 finding #5), not silently ship it.
async function createPoisonFixtureProject(baseUrl: string): Promise<{ fixture: FixtureProject | null; detail: string }> {
  const id = `w10a-poison-${crypto.randomBytes(6).toString('hex')}`;
  const shell = await createProjectShell(baseUrl, id);
  if (!shell.ok) return { fixture: null, detail: shell.detail };
  const r1 = await postFile(baseUrl, id, 'index.html', FIXTURE_INDEX_HTML);
  if (!r1.ok) return { fixture: null, detail: r1.detail };
  const r2 = await postFile(baseUrl, id, FIXTURE_POISON_PATH, FIXTURE_POISON_BUNDLE_JSON);
  if (!r2.ok) return { fixture: null, detail: r2.detail };
  return { fixture: { id }, detail: `poison fixture created with a file at the exact ${FIXTURE_POISON_PATH} path` };
}

// A tiny fixture used against an injectable-limit-overridden daemon boot to
// exercise a size-guard rejection branch for real, over real HTTP -- never
// source-text-only (round-1 finding #5 + ruling: "Use injectable limits or
// a pure guard helper and assert the real route's error response").
async function createTinyFixtureProject(baseUrl: string, fileCount: number, bytesPerFile: number): Promise<{ fixture: FixtureProject | null; detail: string }> {
  const id = `w10a-tiny-${crypto.randomBytes(6).toString('hex')}`;
  const shell = await createProjectShell(baseUrl, id);
  if (!shell.ok) return { fixture: null, detail: shell.detail };
  for (let i = 0; i < fileCount; i++) {
    const content = 'x'.repeat(bytesPerFile);
    const r = await postFile(baseUrl, id, `page-${i}.html`, `<!doctype html><html><body>${content}</body></html>`);
    if (!r.ok) return { fixture: null, detail: r.detail };
  }
  return { fixture: { id }, detail: `tiny fixture created with ${fileCount} files x ~${bytesPerFile} bytes each` };
}

const SUPER_IMPORT_ROUTE_REL_PATH = 'apps/daemon/src/routes/project-super-import.ts';
const DESIGN_FILES_PANEL_REL_PATH = 'apps/web/src/components/DesignFilesPanel.tsx';
const RUNTIME_EXPORTS_REL_PATH = 'apps/web/src/runtime/exports.ts';
const MCP_TEMPLATE_ROW_REL_PATH = 'apps/web/src/state/mcpTemplateRow.ts';
const MCP_CONFIG_REL_PATH = 'apps/daemon/src/mcp-config.ts';
// Injectable size-guard override contract (round-1 finding #5, pinned in the
// PRD S10A-2): the route reads these if set to a positive integer, else
// falls back to Instatic's real defaults (10_000 files / 1073741824 bytes).
const MAX_FILES_OVERRIDE_ENV = 'SUPER_IMPORT_MAX_FILES_OVERRIDE';
const MAX_BYTES_OVERRIDE_ENV = 'SUPER_IMPORT_MAX_BYTES_OVERRIDE';

async function main(): Promise<void> {
  const placeholderWrite = writeManifestFile(buildManifest(false, true));
  if (!placeholderWrite.written) {
    console.error('verify-w10a: FATAL: could not write the initial wroteOk:false placeholder manifest -- aborting rather than risk leaving a stale prior manifest unflagged.');
    process.exit(1);
  }

  const { daemon: booted, detail: bootDetail } = await bootIsolatedDaemon();
  let fixture: FixtureProject | null = null;
  let fixtureDetail = 'daemon unavailable -- fixture project was never attempted';
  let poisonFixture: FixtureProject | null = null;
  let poisonDetail = 'daemon unavailable -- poison fixture was never attempted';
  if (booted) {
    const created = await createFixtureProject(booted.url).catch((err: unknown) => ({ fixture: null, detail: `fixture creation threw: ${String(err)}` }));
    fixture = created.fixture;
    fixtureDetail = created.detail;
    const poison = await createPoisonFixtureProject(booted.url).catch((err: unknown) => ({ fixture: null, detail: `poison fixture creation threw: ${String(err)}` }));
    poisonFixture = poison.fixture;
    poisonDetail = poison.detail;
  }

  // Two additional isolated daemons, each with ONE size guard overridden to
  // a tiny number, used ONLY by C10A-2's rejection-path checks below.
  const { daemon: filesGuardDaemon, detail: filesGuardBootDetail } = await bootIsolatedDaemon({ [MAX_FILES_OVERRIDE_ENV]: '2' });
  const { daemon: bytesGuardDaemon, detail: bytesGuardBootDetail } = await bootIsolatedDaemon({ [MAX_BYTES_OVERRIDE_ENV]: '100' });

  try {
    // -----------------------------------------------------------------
    // C10A-1: Instatic MCP template registered, real-transport shape,
    // spread-safe, and functionally sticky through a URL edit.
    // -----------------------------------------------------------------
    await checkCriterion('C10A-1', async () => {
      if (!booted) {
        record('C10A-1', 'GET /api/mcp/servers', 'template shape + source spread-safety + URL-edit-sticky PAT mode', false, '', { detail: `isolated daemon unavailable: ${bootDetail}` });
        return;
      }
      const resp = await fetch(`${booted.url}/api/mcp/servers`);
      if (!resp.ok) {
        record('C10A-1', `GET ${booted.url}/api/mcp/servers`, 'template shape + source spread-safety + URL-edit-sticky PAT mode', false, '', { detail: `HTTP ${resp.status}` });
        return;
      }
      const body = (await resp.json()) as { templates?: unknown };
      const templates = Array.isArray(body.templates) ? (body.templates as Array<Record<string, unknown>>) : [];
      const candidates = templates.filter((t) => {
        const hay = `${String(t.id ?? '')} ${String(t.label ?? '')} ${String(t.description ?? '')}`.toLowerCase();
        return hay.includes('instatic');
      });
      const problems: string[] = [];
      if (candidates.length === 0) problems.push('no MCP_TEMPLATES entry identifiable as Instatic (id/label/description all lack "instatic")');
      if (candidates.length > 1) problems.push(`expected exactly one Instatic template, found ${candidates.length}: ${candidates.map((c) => String(c.id)).join(', ')}`);
      const VALID_CATEGORIES = new Set(['image-generation', 'image-editing', 'web-capture', 'design-systems', 'ui-components', 'data-viz', 'publishing', 'utilities']);
      const SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
      // Round-1 finding #6: require the EXACT documented shape "Bearer
      // imcp_pat_", not merely the bare substring "imcp_pat" anywhere.
      const BEARER_IMCP_PAT_PATTERN = /bearer\s+imcp_pat_/i;
      let candidateId = '';
      const firstCandidate = candidates.length > 0 ? candidates[0] : undefined;
      for (const t of candidates) {
        const id = String(t.id ?? '');
        candidateId = id;
        if (!SERVER_ID_PATTERN.test(id)) problems.push(`template id "${id}" fails SERVER_ID_PATTERN`);
        const category = String(t.category ?? '');
        if (!VALID_CATEGORIES.has(category)) problems.push(`template category "${category}" is not a valid McpTemplateCategory`);
        const label = String(t.label ?? '');
        const description = String(t.description ?? '');
        const homepage = String(t.homepage ?? '');
        if (label.trim().length < 3) problems.push(`template "${id}" label missing/too short`);
        if (description.trim().length < 20) problems.push(`template "${id}" description missing/too short (placeholder-shaped)`);
        if (!/^https?:\/\//.test(homepage)) problems.push(`template "${id}" homepage missing or not a real URL`);
        const transport = String(t.transport ?? '');
        if (transport !== 'http') {
          problems.push(`template "${id}" transport is "${transport}", expected "http" (Instatic's MCP server is Streamable HTTP per mcp-connectors.md, not stdio)`);
        } else {
          const url = typeof t.url === 'string' ? t.url : '';
          if (!/^https?:\/\//.test(url)) problems.push(`template "${id}" has no valid http(s) url`);
          if (!url.endsWith('/_instatic/mcp')) problems.push(`template "${id}" url "${url}" does not end with the real Instatic MCP endpoint suffix "/_instatic/mcp" (mcp-connectors.md:20-24)`);
        }
        const authMode = String(t.authMode ?? '');
        if (authMode !== 'none') {
          problems.push(`template "${id}" authMode is "${authMode}", expected "none" (personal-access-token via header, not MishMash's OAuth automation)`);
        }
        const headerFields = Array.isArray(t.headerFields) ? (t.headerFields as Array<Record<string, unknown>>) : [];
        const authHeader = headerFields.find((h) => String(h.key ?? '') === 'Authorization');
        if (!authHeader) {
          problems.push(`template "${id}" has no headerFields entry with key "Authorization" for the personal access token`);
        } else {
          const hint = `${String(authHeader.placeholder ?? '')} ${String(authHeader.label ?? '')}`;
          if (!BEARER_IMCP_PAT_PATTERN.test(hint)) {
            problems.push(`template "${id}" Authorization header field does not name the exact evidenced shape "Bearer imcp_pat_..." (mcp-connectors.md:16,84-85) in its placeholder/label -- got: ${JSON.stringify(hint)}`);
          }
        }
      }
      // Source-level: no SpreadAssignment in the template object literal
      // (carry-forward hardening -- a runtime spread could override
      // id/url/authMode even when the literal properties look frozen).
      if (candidateId && fileExistsAtCommit(headSha, MCP_CONFIG_REL_PATH)) {
        const src = readFileAtCommitOrEmpty(headSha, MCP_CONFIG_REL_PATH);
        const sf = parseTs(src, MCP_CONFIG_REL_PATH);
        const obj = findObjectLiteralWithStringId(sf, candidateId);
        if (!obj) {
          problems.push(`could not locate the Instatic template's own object literal in ${MCP_CONFIG_REL_PATH} by id "${candidateId}" for the spread-safety check`);
        } else if (objectLiteralHasSpread(obj)) {
          problems.push(`the Instatic template object literal in ${MCP_CONFIG_REL_PATH} contains a SpreadAssignment (...) -- a runtime spread can override id/url/authMode even when the literal properties look frozen; use only plain PropertyAssignment members`);
        }
      } else if (candidateId) {
        problems.push(`${MCP_CONFIG_REL_PATH} does not exist at HEAD -- cannot run the spread-safety check`);
      }
      // Functional: exercise the required pure row-logic module directly.
      // Round-1 finding #6: McpClientSection.tsx's own authModeAfterUrlChange
      // silently flips an explicit authMode:'none' to 'oauth' the moment the
      // user edits a loopback-default url to their real (non-loopback)
      // deployment host, because `row.authMode === previousInferred` is true
      // for a loopback default -- the heuristic can't tell "explicit" from
      // "merely defaulted." The fix must live in a pure, verifier-importable
      // module so this is testable without a DOM/React renderer.
      const rowLogicAbsPath = path.join(repoRoot, MCP_TEMPLATE_ROW_REL_PATH);
      if (!fs.existsSync(rowLogicAbsPath)) {
        problems.push(`${MCP_TEMPLATE_ROW_REL_PATH} does not exist -- required pure module for rowFromTemplate/authModeAfterUrlChange is missing`);
      } else if (!firstCandidate) {
        problems.push('no Instatic template candidate available to functionally exercise mcpTemplateRow.ts against');
      } else {
        try {
          const modUrl = `${pathToFileURL(rowLogicAbsPath).href}?t=${Date.now()}`;
          const mod = (await import(modUrl)) as {
            rowFromTemplate?: (tpl: unknown, taken: Set<string>) => Record<string, unknown> & { authMode?: string; url?: string; _headersText?: string };
            authModeAfterUrlChange?: (row: Record<string, unknown>, nextUrl: string) => string;
          };
          if (typeof mod.rowFromTemplate !== 'function' || typeof mod.authModeAfterUrlChange !== 'function') {
            problems.push(`${MCP_TEMPLATE_ROW_REL_PATH} does not export both rowFromTemplate and authModeAfterUrlChange`);
          } else {
            // Pass the FULL row object (not a hand-picked {url, authMode}
            // subset) to authModeAfterUrlChange -- a correct implementation
            // may carry its own stickiness signal (e.g. keyed off the row's
            // templateId) as an extra field on the row, and stripping it
            // down here would fail that reasonable design even though it
            // is correct.
            const row = mod.rowFromTemplate(firstCandidate, new Set());
            if (row.authMode !== 'none') {
              problems.push(`rowFromTemplate(instaticTemplate) produced authMode="${String(row.authMode)}", expected "none" immediately after template selection`);
            }
            if (row._headersText && /imcp_pat/i.test(row._headersText)) {
              problems.push('rowFromTemplate seeded the Authorization header with placeholder-looking text instead of an empty value -- secret fields must never be pre-filled with example data');
            }
            const afterEdit = mod.authModeAfterUrlChange(row, 'https://real-instatic-host.example.com/_instatic/mcp');
            if (afterEdit !== 'none') {
              problems.push(`authModeAfterUrlChange(row, <non-loopback real host>) returned "${afterEdit}", expected "none" to be retained -- editing the URL must not silently flip an explicit PAT-mode template into OAuth mode`);
            }
          }
        } catch (err) {
          problems.push(`could not import/exercise ${MCP_TEMPLATE_ROW_REL_PATH}: ${String((err as Error)?.stack ?? err)}`);
        }
      }
      record(
        'C10A-1',
        `GET ${booted.url}/api/mcp/servers`,
        'exactly one structurally-valid Instatic MCP_TEMPLATES entry (transport=http, url ends /_instatic/mcp, authMode=none, header names exact "Bearer imcp_pat_..."), no SpreadAssignment in its source object literal, and mcpTemplateRow.ts keeps authMode="none" sticky across a URL edit to a non-loopback host',
        problems.length === 0,
        problems.join('\n') || `found exactly one valid, spread-safe, URL-edit-sticky candidate: ${JSON.stringify(firstCandidate)}`,
        { detail: problems.length > 0 ? `${problems.length} problem(s)` : undefined },
      );
    });

    // -----------------------------------------------------------------
    // C10A-2: Super Import export -- full role coverage, poison-file
    // rejection, and REAL HTTP 4xx assertions for both size guards via
    // injectable overrides (never source-text-only).
    // -----------------------------------------------------------------
    await checkCriterion('C10A-2', async () => {
      const assertionText =
        'every classifyFiles.ts role (html/css/js/font/image/ordinary-json/binary) present at NATURAL relative paths, byte-identical to fixture; index.html.artifact.json sidecar excluded; a project containing .instatic/site-bundle.json is rejected with 4xx; both size guards reject with a real HTTP 4xx through an injectable-limit override; route source cites Instatic\'s real 10_000-file / 1 GB default constants';
      if (!booted || !fixture) {
        record('C10A-2', 'GET /api/projects/:id/export/super-import', assertionText, false, '', {
          detail: !booted ? `isolated daemon unavailable: ${bootDetail}` : `fixture project unavailable: ${fixtureDetail}`,
        });
        return;
      }
      const problems: string[] = [];
      const exportUrl = `${booted.url}/api/projects/${encodeURIComponent(fixture.id)}/export/super-import`;
      const resp = await fetch(exportUrl);
      if (!resp.ok) {
        problems.push(`GET ${exportUrl} -> HTTP ${resp.status} (route not implemented or errored -- expected pre-implementation)`);
      } else {
        const buf = Buffer.from(await resp.arrayBuffer());
        let zip: JSZipInstance | null = null;
        try {
          zip = await JSZipMod.loadAsync(buf);
        } catch (err) {
          problems.push(`response was not a valid zip: ${String(err)}`);
        }
        if (zip) {
          for (const [expectedPath, expectedContent] of Object.entries(EXPECTED_ZIP_ENTRIES)) {
            const entry = zip.files[expectedPath];
            if (!entry || entry.dir) {
              problems.push(`missing entry: ${expectedPath}`);
              continue;
            }
            const actual = await entry.async('nodebuffer');
            if (!actual.equals(expectedContent)) {
              problems.push(`content mismatch: ${expectedPath} (expected sha256 ${sha256Bytes(expectedContent)}, got ${sha256Bytes(actual)})`);
            }
          }
          const allNames = Object.keys(zip.files);
          const sidecarLeak = allNames.filter((n) => n.includes(FIXTURE_SIDECAR_NAME));
          if (sidecarLeak.length > 0) problems.push(`negative control failed -- sidecar leaked into zip: ${sidecarLeak.join(', ')}`);
          const reshapedPaths = allNames.filter((n) => /^(pages|tokens|media)\//.test(n));
          if (reshapedPaths.length > 0) problems.push(`export reshapes the tree into pages/tokens/media folders, which Instatic's real ingestion does not want: ${reshapedPaths.join(', ')}`);
        }
      }
      // Poison-file rejection: a project containing .instatic/site-bundle.json
      // must be REJECTED (4xx), not silently zipped -- that path would
      // misroute the whole archive to Instatic's different CMS-transfer
      // import path (site-import.md:302).
      if (!poisonFixture) {
        problems.push(`poison fixture unavailable: ${poisonDetail}`);
      } else {
        const poisonUrl = `${booted.url}/api/projects/${encodeURIComponent(poisonFixture.id)}/export/super-import`;
        const poisonResp = await fetch(poisonUrl);
        if (poisonResp.ok) {
          problems.push(`GET ${poisonUrl} -> HTTP ${poisonResp.status} (expected 4xx: a project containing ${FIXTURE_POISON_PATH} must be rejected, not silently exported as a Super Import zip)`);
        }
      }
      // Real HTTP 4xx assertions for BOTH size guards, via the injectable
      // override env vars this PRD pins. Never source-text-only.
      if (!filesGuardDaemon) {
        problems.push(`files-guard isolated daemon unavailable: ${filesGuardBootDetail}`);
      } else {
        const tiny = await createTinyFixtureProject(filesGuardDaemon.url, 3, 16).catch((err: unknown) => ({ fixture: null, detail: `tiny fixture threw: ${String(err)}` }));
        if (!tiny.fixture) {
          problems.push(`could not create files-guard tiny fixture: ${tiny.detail}`);
        } else {
          const r = await fetch(`${filesGuardDaemon.url}/api/projects/${encodeURIComponent(tiny.fixture.id)}/export/super-import`);
          if (r.ok) problems.push(`file-count guard did not reject: with ${MAX_FILES_OVERRIDE_ENV}=2 and a 3-file project, GET .../export/super-import returned HTTP ${r.status} instead of a 4xx`);
        }
      }
      if (!bytesGuardDaemon) {
        problems.push(`bytes-guard isolated daemon unavailable: ${bytesGuardBootDetail}`);
      } else {
        const tiny = await createTinyFixtureProject(bytesGuardDaemon.url, 1, 400).catch((err: unknown) => ({ fixture: null, detail: `tiny fixture threw: ${String(err)}` }));
        if (!tiny.fixture) {
          problems.push(`could not create bytes-guard tiny fixture: ${tiny.detail}`);
        } else {
          const r = await fetch(`${bytesGuardDaemon.url}/api/projects/${encodeURIComponent(tiny.fixture.id)}/export/super-import`);
          if (r.ok) problems.push(`byte-size guard did not reject: with ${MAX_BYTES_OVERRIDE_ENV}=100 and a >400-byte project, GET .../export/super-import returned HTTP ${r.status} instead of a 4xx`);
        }
      }
      // Source-level: the DEFAULT fallback must be Instatic's real numbers,
      // bound to a named assignment (not merely present anywhere in the
      // file, which could be a comment or dead code -- round-1 finding #5).
      const routeAbsPath = path.join(repoRoot, SUPER_IMPORT_ROUTE_REL_PATH);
      let routeSource = '';
      try {
        routeSource = fs.readFileSync(routeAbsPath, 'utf8');
      } catch {
        problems.push(`could not read ${SUPER_IMPORT_ROUTE_REL_PATH} to check for Instatic's real size-guard default constants`);
      }
      if (routeSource) {
        const FILES_DEFAULT_BOUND = /(MAX_FILES|maxFiles)[^=\n]*=.{0,80}?10[_,]?000\b/;
        const BYTES_DEFAULT_BOUND = /(MAX_BYTES|maxBytes)[^=\n]*=.{0,80}?(1073741824\b|1024\s*\*\s*1024\s*\*\s*1024\b)/;
        if (!FILES_DEFAULT_BOUND.test(routeSource)) problems.push(`${SUPER_IMPORT_ROUTE_REL_PATH} does not bind a named MAX_FILES-shaped default to Instatic's real 10_000 (ingestInput.ts:40)`);
        if (!BYTES_DEFAULT_BOUND.test(routeSource)) problems.push(`${SUPER_IMPORT_ROUTE_REL_PATH} does not bind a named MAX_BYTES-shaped default to Instatic's real 1073741824/1024*1024*1024 (ingestInput.ts:39)`);
        if (!routeSource.includes(MAX_FILES_OVERRIDE_ENV) || !routeSource.includes(MAX_BYTES_OVERRIDE_ENV)) {
          problems.push(`${SUPER_IMPORT_ROUTE_REL_PATH} does not reference both injectable override env vars (${MAX_FILES_OVERRIDE_ENV}, ${MAX_BYTES_OVERRIDE_ENV}) the PRD pins for testability`);
        }
      }
      record('C10A-2', `GET ${exportUrl}`, assertionText, problems.length === 0, problems.join('\n') || `all ${Object.keys(EXPECTED_ZIP_ENTRIES).length} role-representative entries byte-faithful; sidecar excluded; poison file rejected; both size guards reject over real HTTP; defaults cite Instatic's real constants`, {
        detail: problems.length > 0 ? `${problems.length} problem(s)` : undefined,
      });
    });

    // -----------------------------------------------------------------
    // C10A-3: CLI parity, real subprocess, pointed only at the validated
    // isolated daemon (never the 7456 default).
    // -----------------------------------------------------------------
    await checkCriterion('C10A-3', async () => {
      if (!booted || !fixture) {
        record('C10A-3', 'od project export-super-import <id> --daemon-url <isolated>', 'CLI output byte-identical to the HTTP route it wraps', false, '', {
          detail: !booted ? `isolated daemon unavailable: ${bootDetail}` : `fixture project unavailable: ${fixtureDetail}`,
        });
        return;
      }
      const exportUrl = `${booted.url}/api/projects/${encodeURIComponent(fixture.id)}/export/super-import`;
      const httpResp = await fetch(exportUrl);
      if (!httpResp.ok) {
        record('C10A-3', `GET ${exportUrl}`, 'CLI output byte-identical to the HTTP route it wraps', false, '', {
          detail: `HTTP baseline unavailable (HTTP ${httpResp.status}) -- cannot assess CLI parity until the route exists`,
        });
        return;
      }
      const httpBuf = Buffer.from(await httpResp.arrayBuffer());
      const httpSha = sha256Bytes(httpBuf);

      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w10a-cli-out-'));
      const outPath = path.join(outDir, 'export.zip');
      const cliArgs = [
        'exec', 'tsx', path.join(repoRoot, 'apps/daemon/src/cli.ts'),
        'project', 'export-super-import', fixture.id,
        '--daemon-url', booted.url, '--out', outPath, '--json',
      ];
      const cliResult = sh('pnpm', cliArgs, { cwd: repoRoot, timeoutMs: 60_000, env: { ...process.env, OD_DAEMON_URL: booted.url } });
      if (cliResult.status !== 0) {
        record('C10A-3', `pnpm ${cliArgs.join(' ')}`, 'CLI output byte-identical to the HTTP route it wraps', false, `exit=${cliResult.status}\nstdout=${cliResult.stdout.slice(-2000)}\nstderr=${cliResult.stderr.slice(-2000)}`, {
          detail: 'od project export-super-import did not exit 0 -- subcommand likely does not exist yet (expected pre-implementation)',
        });
        try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* best effort */ }
        return;
      }
      if (!fs.existsSync(outPath)) {
        record('C10A-3', `pnpm ${cliArgs.join(' ')}`, 'CLI output byte-identical to the HTTP route it wraps', false, cliResult.stdout, { detail: `CLI exited 0 but did not write ${outPath}` });
        try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* best effort */ }
        return;
      }
      const cliBuf = fs.readFileSync(outPath);
      const cliSha = sha256Bytes(cliBuf);
      record('C10A-3', `pnpm ${cliArgs.join(' ')}`, 'CLI output byte-identical to the HTTP route it wraps', cliSha === httpSha, `http sha256=${httpSha}\ncli sha256=${cliSha}`, {
        detail: cliSha === httpSha ? undefined : 'CLI-saved output diverges from the HTTP route it should thinly wrap',
      });
      try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    // -----------------------------------------------------------------
    // C10A-4: Super Import UI entry point -- cross-file AST binding.
    // DesignFilesPanel.tsx's labeled click handler must call an identifier
    // imported from apps/web/src/runtime/exports.ts, and THAT exported
    // function's own body must fetch() the route literal. Comment-safe by
    // construction (AST node text excludes trivia) and decoy-safe (the
    // route string must live inside the resolved handler's own function
    // body, not merely be textually nearby).
    // -----------------------------------------------------------------
    await checkCriterion('C10A-4', () => {
      const panelAbsPath = path.join(repoRoot, DESIGN_FILES_PANEL_REL_PATH);
      const exportsAbsPath = path.join(repoRoot, RUNTIME_EXPORTS_REL_PATH);
      const problems: string[] = [];
      if (!fs.existsSync(panelAbsPath)) problems.push(`${DESIGN_FILES_PANEL_REL_PATH} does not exist`);
      if (!fs.existsSync(exportsAbsPath)) problems.push(`${RUNTIME_EXPORTS_REL_PATH} does not exist`);
      if (problems.length === 0) {
        const panelSrc = fs.readFileSync(panelAbsPath, 'utf8');
        const panelSf = parseTs(panelSrc, DESIGN_FILES_PANEL_REL_PATH);
        const importedFromExports = new Set(
          collectNamedImports(panelSf)
            .filter((i) => i.moduleSpecifier.replace(/^\.\//, '').includes('runtime/exports'))
            .map((i) => i.localName),
        );
        if (importedFromExports.size === 0) {
          problems.push(`${DESIGN_FILES_PANEL_REL_PATH} imports nothing from a "runtime/exports" module specifier`);
        }
        const onClickAttrs: TsNode[] = [];
        walkAll(panelSf, (n) => {
          if (ts.isJsxAttribute(n as any)) {
            const name = ((n as any).name as { text?: string }).text;
            if (name === 'onClick' || name === 'onSelect' || name === 'onPress') onClickAttrs.push(n);
          }
        });
        if (onClickAttrs.length === 0) {
          problems.push(`${DESIGN_FILES_PANEL_REL_PATH} has no onClick/onSelect/onPress JSX attribute at all`);
        }
        let boundHandler: TsNode | null = null;
        let boundCalledName = '';
        let boundElement: TsNode | null = null;
        for (const attr of onClickAttrs) {
          const bodyNode = resolveHandlerBody(panelSf, attr);
          if (!bodyNode) continue;
          const calledNames = collectCalledIdentifierNames(bodyNode);
          for (const name of calledNames) {
            if (importedFromExports.has(name)) {
              boundHandler = bodyNode;
              boundCalledName = name;
              boundElement = findEnclosingJsxElement(attr);
              break;
            }
          }
          if (boundHandler) break;
        }
        if (!boundHandler) {
          problems.push(`no onClick/onSelect/onPress handler in ${DESIGN_FILES_PANEL_REL_PATH} calls an identifier imported from "runtime/exports"`);
        } else {
          if (!boundElement || !jsxSubtreeMentionsLabel(boundElement)) {
            problems.push(`the JSX element wiring "${boundCalledName}" has no visible/attribute text mentioning "Instatic" or "Super Import" nearby -- the action must be a labeled, discoverable menu entry, not an anonymous handler`);
          }
          const exportsSrc = fs.readFileSync(exportsAbsPath, 'utf8');
          const exportsSf = parseTs(exportsSrc, RUNTIME_EXPORTS_REL_PATH);
          const fnBody = findExportedFunctionBody(exportsSf, boundCalledName);
          if (!fnBody) {
            problems.push(`${RUNTIME_EXPORTS_REL_PATH} has no exported function/const named "${boundCalledName}" (the name DesignFilesPanel.tsx calls)`);
          } else if (!bodyHasFetchCallContaining(exportsSf, fnBody, '/export/super-import')) {
            problems.push(`${RUNTIME_EXPORTS_REL_PATH}'s exported "${boundCalledName}" does not contain a fetch(...) call referencing "/export/super-import" inside its own body`);
          }
        }
      }
      record(
        'C10A-4',
        `AST: ${DESIGN_FILES_PANEL_REL_PATH} onClick -> imported runtime/exports helper -> fetch('/export/super-import')`,
        'a labeled (Instatic/Super Import) click handler in DesignFilesPanel.tsx calls a function imported from runtime/exports.ts, and that exported function itself fetches the /export/super-import route -- structural AST binding, comment-safe, decoy-safe',
        problems.length === 0,
        problems.join('\n') || `bound: DesignFilesPanel.tsx onClick -> ${RUNTIME_EXPORTS_REL_PATH}'s exported handler -> fetch(.../export/super-import)`,
        { detail: problems.length > 0 ? `${problems.length} problem(s)` : undefined },
      );
    });

    // -----------------------------------------------------------------
    // C10A-5: No deeper coupling (founder-pin scope fence). AST added-call /
    // added-import diff (base vs HEAD) per product file -- fixes both the
    // "unsatisfiable" bug (pre-existing writeMcpConfig/fetch definitions in
    // touched files no longer trip it) and the "porous regex" bug (net/
    // undici/WebSocket/child_process-curl/suspicious-import coverage).
    // -----------------------------------------------------------------
    await checkCriterion('C10A-5', () => {
      const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
      if (diffResult.status !== 0) {
        record('C10A-5', `git diff --name-only ${baseCommit}...HEAD`, 'no NEWLY ADDED outbound-call primitive or writeMcpConfig() call outside the allowlisted local-daemon call sites', false, diffResult.stdout, { detail: `git diff exited ${diffResult.status}` });
        return;
      }
      const changedFiles = diffResult.stdout.trim().split('\n').filter(Boolean);
      const productFiles = changedFiles.filter((f) => !f.startsWith('scripts/waves/') && !f.startsWith('docs/') && (f.endsWith('.ts') || f.endsWith('.tsx')));
      // Only these two files may add a NEW fetch(...) call, and only when
      // that call's own text names the local export route and never names
      // Instatic directly (egress) -- everything else, and every added
      // writeMcpConfig(...) call anywhere, is unconditionally forbidden.
      const ALLOWLISTED_FETCH_FILES = new Set([RUNTIME_EXPORTS_REL_PATH, 'apps/daemon/src/cli.ts']);
      const problems: string[] = [];
      for (const f of productFiles) {
        const abs = path.join(repoRoot, f);
        if (!fs.existsSync(abs)) continue; // deleted file
        let headText: string;
        try {
          headText = fs.readFileSync(abs, 'utf8');
        } catch {
          continue; // binary or unreadable
        }
        const baseText = readFileAtCommitOrEmpty(baseCommit, f);
        let headSf: TsNode;
        let baseSf: TsNode;
        try {
          headSf = parseTs(headText, f);
          baseSf = parseTs(baseText, f);
        } catch (err) {
          problems.push(`${f}: could not parse for the AST diff: ${String(err)}`);
          continue;
        }
        const baseCalls = collectCallTexts(baseSf);
        const headCalls = collectCallTexts(headSf);
        const addedCallTexts = new Set([...headCalls].filter((c) => !baseCalls.has(c)));
        const baseImports = collectImportSpecifiers(baseSf);
        const headImports = collectImportSpecifiers(headSf);
        const addedImports = [...headImports].filter((i) => !baseImports.has(i));
        for (const spec of addedImports) {
          const normalized = spec.replace(/^node:/, '');
          if (SUSPICIOUS_IMPORT_MODULES.has(spec) || SUSPICIOUS_IMPORT_MODULES.has(normalized)) {
            problems.push(`${f}: newly added import of suspicious module "${spec}" -- no leased file in this wave needs a network-client or child_process library`);
          }
        }
        // Re-walk HEAD's call/new-expression nodes and classify only the
        // ones whose OWN text is in addedCallTexts (newly added or modified).
        walkAll(headSf, (n) => {
          if (!ts.isCallExpression(n as any) && !ts.isNewExpression(n as any)) return;
          const text = nodeText(headSf, n).trim();
          if (!addedCallTexts.has(text)) return;
          if (isNewWebSocket(n)) {
            problems.push(`${f}: newly added "new WebSocket(...)" call -- direct egress primitive, not allowlisted anywhere in this wave`);
            return;
          }
          const reason = classifyForbiddenCallNode(headSf, n);
          if (!reason) return;
          if (reason === '__FETCH__') {
            if (!ALLOWLISTED_FETCH_FILES.has(f)) {
              problems.push(`${f}: newly added fetch(...) call outside the two allowlisted local-daemon call sites (${[...ALLOWLISTED_FETCH_FILES].join(', ')})`);
              return;
            }
            const lower = text.toLowerCase();
            if (!lower.includes('/export/super-import')) {
              problems.push(`${f}: newly added fetch(...) call does not name the local "/export/super-import" route: ${text.slice(0, 160)}`);
            }
            if (lower.includes('instatic')) {
              problems.push(`${f}: newly added fetch(...) call names "instatic" directly -- this wave's export is local-only, never a direct call to an Instatic host: ${text.slice(0, 160)}`);
            }
            return;
          }
          problems.push(`${f}: newly added ${reason}: ${text.slice(0, 160)}`);
        });
      }
      record(
        'C10A-5',
        `AST added-call/added-import diff, git show ${baseCommit}:<file> vs HEAD, product .ts/.tsx paths only`,
        'no NEWLY ADDED outbound-call primitive (fetch/axios/http(s).request/net.*/undici/WebSocket/child_process-curl) or writeMcpConfig() call, except fetch(...) in the two allowlisted local-daemon files naming the local /export/super-import route and never naming Instatic directly; no newly added import of a suspicious network/process module',
        problems.length === 0,
        problems.join('\n') || `${productFiles.length} product .ts/.tsx file(s) touched, 0 violations in added AST nodes (0 files pre-implementation is expected -- vacuous pass, documented in the PRD, not a loophole: C10A-1..C10A-4 independently carry the burden of proving the features exist)`,
        {},
      );
    });

    // -----------------------------------------------------------------
    // C10A-6: Gates.
    // -----------------------------------------------------------------
    await checkCriterion('C10A-6', () => {
      const guardResult = sh('pnpm', ['guard'], { timeoutMs: 10 * 60_000 });
      const typecheckResult = sh('pnpm', ['typecheck'], { timeoutMs: 10 * 60_000 });
      const ok = guardResult.status === 0 && typecheckResult.status === 0;
      record(
        'C10A-6',
        'pnpm guard && pnpm typecheck',
        'both exit 0 on the current tree',
        ok,
        `guard exit=${guardResult.status}\n${guardResult.stdout.slice(-4000)}\n${guardResult.stderr.slice(-2000)}\n---\ntypecheck exit=${typecheckResult.status}\n${typecheckResult.stdout.slice(-4000)}\n${typecheckResult.stderr.slice(-2000)}`,
        { detail: ok ? undefined : `guard exit=${guardResult.status}, typecheck exit=${typecheckResult.status}` },
      );
    });
  } finally {
    await teardownDaemon(booted);
    await teardownDaemon(filesGuardDaemon);
    await teardownDaemon(bytesGuardDaemon);
  }

  // =======================================================================
  // GATE-INTEGRITY / LEASE / HEAD-DRIFT
  // =======================================================================
  await checkCriterion('GATE-INTEGRITY', () => {
    const selfPath = process.argv[1] ? path.resolve(process.argv[1]) : path.join(repoRoot, 'scripts/waves/verify-w10a.ts');
    let selfSha256: string;
    try {
      selfSha256 = sha256File(selfPath);
    } catch (err) {
      record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check; the PRIMARY control is baseCommit-derived route/lease truth, not this pin', false, '', {
        detail: `could not hash self at ${selfPath}: ${String(err)}`,
      });
      return;
    }
    const approvedHashPath = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'approved-gate.sha256');
    if (!gateIntegrityPinned) {
      record(
        'GATE-INTEGRITY',
        '',
        'defense-in-depth self-hash check',
        true,
        `sha256: ${selfSha256}\nUNPINNED -- no approved-gate.sha256 present. Per round-1 finding #2, an unpinned run is ADVISORY ONLY and may never be treated as landing-eligible evidence regardless of this field's pass/fail; see the PRD's "Implementation ceremony" section.`,
      );
      return;
    }
    const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
    const gateOk = approved === selfSha256;
    record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check', gateOk, `sha256: ${selfSha256}\napproved: ${approved}\nPINNED`, {
      detail: gateOk ? undefined : 'verify-w10a.ts modified since orchestrator approval',
    });
  });

  function globToRegExp(glob: string): RegExp {
    let re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    re = re.replace(/\*\*/g, ' GLOBSTAR ');
    re = re.replace(/\*/g, '[^/]*');
    re = re.replace(/ GLOBSTAR /g, '.*');
    return new RegExp(`^${re}$`);
  }
  await checkCriterion('LEASE', () => {
    let leasesRaw: { waves: Record<string, { allow: string[]; deny?: string[] }> };
    try {
      const r = sh('git', ['show', `${baseCommit}:docs/plans/waves/leases.json`]);
      if (r.status !== 0) throw new Error(`git show exited ${r.status}: ${r.stdout.slice(0, 300)}`);
      leasesRaw = JSON.parse(r.stdout) as typeof leasesRaw;
    } catch (err) {
      record('LEASE', `git show ${baseCommit}:docs/plans/waves/leases.json`, 'no writes outside the W10a-instatic lease, read from baseCommit', false, '', {
        detail: `could not read/parse leases.json at baseCommit: ${String(err)}`,
      });
      return;
    }
    const lease = leasesRaw.waves[LEASE_KEY];
    if (!lease) {
      record('LEASE', '', 'no writes outside the W10a-instatic lease, read from baseCommit', false, '', {
        detail: `no "${LEASE_KEY}" entry in leases.json@baseCommit -- expected pre-landing: this PRD proposes the lease row as text but does not edit leases.json`,
      });
      return;
    }
    const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
    const diffNames = diffResult.stdout.trim().split('\n').filter(Boolean);
    if (diffResult.status !== 0) {
      record('LEASE', '', '', false, diffResult.stdout, { detail: `git diff exited ${diffResult.status}` });
      return;
    }
    const allowRe = lease.allow.map(globToRegExp);
    const denyRe = (lease.deny ?? []).map(globToRegExp);
    const violations = diffNames.filter((f) => !allowRe.some((re) => re.test(f)) || denyRe.some((re) => re.test(f)));
    record(
      'LEASE',
      `git diff --name-only ${baseCommit}...HEAD subset-of leases.json[${LEASE_KEY}] read via git show ${baseCommit}:docs/plans/waves/leases.json`,
      'no writes outside the W10a-instatic lease, read from baseCommit so the wave cannot widen its own lease',
      violations.length === 0,
      violations.join('\n') || (diffNames.length === 0 ? 'no diff between baseCommit and HEAD' : `all ${diffNames.length} changed files inside the lease`),
      { detail: violations.length === 0 ? undefined : 'files changed outside the proposed lease allow-list' },
    );
  });

  const headShaFinal = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  await checkCriterion('HEAD-DRIFT', () => {
    record('HEAD-DRIFT', 'git rev-parse HEAD (re-resolved at end)', 'HEAD must not move during the run', headShaFinal === headSha, `initial=${headSha} final=${headShaFinal}`, {
      detail: headShaFinal === headSha ? undefined : 'HEAD moved during the run',
    });
  });

  // -----------------------------------------------------------------------
  // Tamper re-check, then the final canonical manifest write.
  // -----------------------------------------------------------------------
  for (const r of results) {
    if (!r.artifact || !r.artifactSha256) continue;
    try {
      const currentHash = sha256File(r.artifact);
      if (currentHash !== r.artifactSha256) {
        r.status = 'fail';
        r.detail = `${r.detail ? `${r.detail}; ` : ''}TAMPER DETECTED`;
      }
    } catch {
      r.status = 'fail';
      r.detail = `${r.detail ? `${r.detail}; ` : ''}artifact disappeared before final integrity re-check`;
    }
  }

  const treeDirtyResult = sh('git', ['status', '--porcelain=v1']);
  const treeDirty = treeDirtyResult.status !== 0 || treeDirtyResult.stdout.trim().length > 0;
  const finalManifest = buildManifest(true, treeDirty);
  const { written: manifestWritten, sha256: manifestSha256 } = writeManifestFile(finalManifest);

  const failures = results.filter((r) => r.status === 'fail');
  console.log(`\nverify-w10a: ${results.length - failures.length}/${results.length} criteria pass (treeDirty=${treeDirty}, wroteOk=true, gateIntegrityPinned=${gateIntegrityPinned})`);
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id}${r.detail ? ` (${r.detail})` : ''}`);
  if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md section 2)');
  console.log(`MANIFEST_SHA256=${manifestSha256}`);
  console.log(`MANIFEST_PATH=${path.join(proofDir, 'manifest.json')}`);
  process.exit(failures.length === 0 && !treeDirty && manifestWritten ? 0 : 1);
}

main().catch((err) => {
  writeEmergencyManifest(`unhandled error in main(): ${String((err as Error)?.stack ?? err)}`, results);
  process.exit(1);
});
