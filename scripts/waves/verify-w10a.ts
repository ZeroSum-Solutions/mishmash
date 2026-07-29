// verify-w10a.ts -- wave mishmash-w10a-instatic (Instatic seam: MCP client
// registration + Super Import static export) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// AFTER FREEZE, THIS COMMITTED COPY IS A BASELINE INPUT, NOT AN
// IMPLEMENTATION-LEASE FILE. Landing requires running an orchestrator-custody
// copy of this exact approved text and `manifest.gateIntegrityPinned ===
// true` -- see the PRD's "Implementation ceremony" section.
//
// Run: pnpm exec tsx scripts/waves/verify-w10a.ts [--repo <path>]
//
// ROUND-3 FIXES (founder-authorized, strictly scoped to round-2's numbered
// residuals -- see the PRD "Adversarial review" section for the full
// disposition record):
//   1. C10A-5: Set-based added-node diff replaced with a whitespace-
//      normalized MULTISET (occurrence-count) diff, so duplicated/moved
//      calls are visible and pure formatting churn never false-adds. Dynamic
//      import()/require() calls are unconditionally forbidden when newly
//      added (no leased file has a legitimate use for either). An import-
//      alias map resolves aliased named/default/namespace bindings so
//      `import { request as doReq } from 'node:http'; doReq(...)` and an
//      aliased `writeMcpConfig` import are both caught. node:http/https/net
//      joined the blanket-forbidden-import list (no leased file needs them).
//   4. C10A-4: `findEnclosingJsxElement` now returns the FULL JsxElement
//      (including children), not just the opening tag, so a real
//      `<button onClick={...}><span>{t('designFiles.exportSuperImport')}
//      </span></button>` pattern is found. Named-import resolution now also
//      covers default/namespace imports. The handler-body walk no longer
//      descends into dead (never-invoked, never-passed-as-a-callback)
//      nested function declarations. The fetch-URL check now inspects ONLY
//      the call's first argument, not the whole call text, so a decoy route
//      string hidden in a headers object no longer passes.
//   5. C10A-2: every rejection assertion now checks the EXACT expected HTTP
//      status (413 for both size guards, 409 for the poison-file conflict)
//      AND parses the JSON body to assert `error.code` matches the reused
//      `ApiErrorCode` (`PAYLOAD_TOO_LARGE` / `CONFLICT`) -- a 500 crash or
//      any other non-matching status/code now fails the criterion instead
//      of passing as "rejected." Both override daemons also get an
//      AT/BELOW-limit fixture that must SUCCEED (200 + valid zip), so a
//      broken/always-rejecting daemon cannot pass either. The default-
//      constant check is now an AST NumericLiteral scan (comments can never
//      contain a real NumericLiteral node), not a text regex.
//   6. C10A-1: the required pure module (`mcpTemplateRow.ts`) is now BOUND
//      to the production component -- `McpClientSection.tsx` must import
//      `rowFromTemplate`/`authModeAfterUrlChange` from it AND must no
//      longer declare its own same-named local functions, so an unused
//      passing module next to the unchanged buggy component can no longer
//      go green. The spread ban now locates the actual MCP_TEMPLATES array
//      element (not the first same-id object literal anywhere), requires
//      that element to be a direct object literal (rejecting Object.assign/
//      any call-wrapped construction), recursively scans the WHOLE object
//      subtree for a spread at any depth, and separately scans the whole
//      file for any assignment expression targeting MCP_TEMPLATES
//      (satellite mutation).
//   7. Every probe fetch now sets `redirect: 'manual'` and treats any
//      redirect response as a hard failure -- a validated loopback daemon
//      can no longer silently redirect a request to a protected port or an
//      external host.
//   8. Template count is now re-derived at RUNTIME by diffing the AST-
//      parsed MCP_TEMPLATES array at baseCommit against the live HTTP
//      response at HEAD: exactly one new id, every base id still present.
//      No hardcoded number anywhere in this file.
//   Contract export path (round-2 finding #3): resolved by NOT inventing a
//   new contract file. The daemon route reuses the existing, already-
//   publicly-exported `ApiErrorResponse`/`ApiErrorCode`/`sendApiError`
//   envelope (`packages/contracts/src/errors.ts`, barrel-exported from
//   `packages/contracts/src/index.ts:2`) with the existing `PAYLOAD_TOO_
//   LARGE`/`CONFLICT` codes -- there is no new file, so there is no new
//   export-path gap. C10A-2 verifies this by asserting the real response
//   envelope shape and codes.
//
// PORTABILITY: repoRoot comes from `process.cwd()`/`--repo`, never
// `import.meta.url`. ISOLATION (non-negotiable): every daemon this verifier
// boots uses port 0 (OS-assigned ephemeral port) and a fresh `mkdtemp`
// OD_DATA_DIR, is torn down by its own exact child-process handle, and every
// probe fetch/CLI spawn targets an already-validated, redirect-refusing
// isolated daemon. This verifier never resolves, reads, or sends a request
// to ports 7456 or 51012, and never issues `git fetch`/`git push`.

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
// AST helpers
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
function idText(n: TsNode): string {
  return (n as unknown as { text: string }).text;
}
// Collapse all whitespace runs to a single space and trim -- a cheap extra
// safety net layered on top of canonicalNodeText() below, not the primary
// formatting-insensitivity mechanism (see that function's comment).
function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// Canonical (formatting-insensitive) text for a node, used ONLY for the
// added-occurrence multiset diff. A naive text-based normalization (e.g.
// collapsing whitespace runs) still treats `fetch( x )` and `fetch(x)`, or
// a multi-line reflow of the same call, as different strings, because
// single spaces adjacent to punctuation are not "runs." Re-printing the
// node through the TypeScript AST printer instead produces the SAME
// canonical text for any two syntactically-identical trees regardless of
// source formatting (verified live: a multi-line `fetch(\n  x,\n  y\n)`
// and a single-line `fetch(x, y)` both print as `fetch(x, y)`), while
// still preserving string-literal CONTENTS exactly (so two calls whose
// only difference is inside a string, e.g. two different URLs, are never
// conflated) -- this is what actually satisfies round-2 finding #1's
// "formatting churn must not false-add."
const astPrinter = ts.createPrinter({ removeComments: true });
function canonicalNodeText(sf: TsNode, n: TsNode): string {
  try {
    return astPrinter.printNode(ts.EmitHint.Unspecified, n as any, sf as any) as string;
  } catch {
    return normalizeText(nodeText(sf, n));
  }
}

// -----------------------------------------------------------------------
// Import-alias resolution. Maps a local identifier name to the module it
// was imported from and which export it binds (default/namespace/named,
// including a `foo as bar` rename) -- round-2 finding #1: "account for ...
// aliases."
// -----------------------------------------------------------------------
interface ImportBinding {
  module: string;
  imported: string; // 'default' | '*' | <named-export-name>
}
function buildImportAliasMap(sf: TsNode): Map<string, ImportBinding> {
  const out = new Map<string, ImportBinding>();
  walkAll(sf, (n) => {
    if (!ts.isImportDeclaration(n as any)) return;
    const spec = (n as any).moduleSpecifier;
    if (!spec || !ts.isStringLiteral(spec)) return;
    const moduleText = idText(spec as unknown as TsNode);
    const clause = (n as any).importClause;
    if (!clause) return;
    if (clause.name && ts.isIdentifier(clause.name)) {
      out.set(idText(clause.name as TsNode), { module: moduleText, imported: 'default' });
    }
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named as any)) {
      out.set(idText((named as any).name as TsNode), { module: moduleText, imported: '*' });
    } else if (named && ts.isNamedImports(named as any)) {
      for (const el of (named as any).elements as TsNode[]) {
        const localName = idText((el as any).name as TsNode);
        const importedName = (el as any).propertyName ? idText((el as any).propertyName as TsNode) : localName;
        out.set(localName, { module: moduleText, imported: importedName });
      }
    }
  });
  return out;
}

// Node builtins / third-party client libraries no leased file in this wave
// has any legitimate reason to import at all -- importing ANY of these
// (regardless of local alias) is unconditionally forbidden when newly
// added. node:http/https/net joined this list in round 3 (round-2 finding
// #1): none of this wave's files need raw Node HTTP/net primitives, so
// blanket-forbidding the import closes the alias problem for them without
// needing per-call-site resolution.
const SUSPICIOUS_IMPORT_MODULES = new Set([
  'axios', 'undici', 'ws', 'got', 'node-fetch', 'superagent', 'ky', 'request', 'needle', 'phin',
  'node:http', 'http', 'node:https', 'https', 'node:net', 'net', 'node:dgram', 'dgram', 'node:tls', 'tls',
]);
const CHILD_PROCESS_EXEC_NAMES = new Set(['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync']);
const CURL_LIKE_PATTERN = /\b(curl|wget|nc|netcat)\b/i;

// Classifies a single CallExpression/NewExpression AST node (never raw file
// text) as a forbidden network-egress, dynamic-module-load, or live-config-
// mutation primitive, resolving through the import-alias map so a renamed
// binding is still caught. Returns a human reason string when forbidden,
// null otherwise. Returns the sentinel '__FETCH__' for a plain fetch(...)
// call so the caller can apply the allowlist-by-file-and-URL-argument rule.
function classifyForbiddenCallNode(sf: TsNode, n: TsNode, aliasMap: Map<string, ImportBinding>): string | null {
  // Dynamic import()/require(...) -- unconditionally forbidden when newly
  // added; no leased file has a legitimate use for either (round-2 #1).
  // NOTE: `ts.isImportCall` exists at runtime but is NOT part of the public
  // typescript.d.ts surface (confirmed by direct inspection of the
  // installed 5.9.3 .d.ts), so it is detected via the public, documented
  // AST shape instead: a CallExpression whose callee node has kind
  // ImportKeyword (verified live against a real `import(...)` parse).
  const callee = (n as any).expression as TsNode | undefined;
  if (ts.isCallExpression(n as any) && callee && (callee as any).kind === ts.SyntaxKind.ImportKeyword) {
    return 'dynamic import(...) call';
  }
  if (!callee) return null;
  if (ts.isIdentifier(callee as any)) {
    const name = idText(callee);
    if (name === 'require') return 'require(...) call';
    const bound = aliasMap.get(name);
    if (bound?.imported === 'writeMcpConfig') return `writeMcpConfig(...) call (imported as "${name}")`;
    if (name === 'writeMcpConfig') return 'writeMcpConfig(...) call';
    if (name === 'fetch') return '__FETCH__';
    if (bound && (bound.module === 'axios' || (bound.module === 'ws' && bound.imported !== undefined))) {
      return `${bound.module} call (imported as "${name}")`;
    }
    if (CHILD_PROCESS_EXEC_NAMES.has(name)) {
      const argsText = nodeText(sf, n);
      if (CURL_LIKE_PATTERN.test(argsText)) return `${name}(...) invoking curl/wget/nc`;
    }
    return null;
  }
  if (ts.isPropertyAccessExpression(callee as any)) {
    const objNode = (callee as any).expression as TsNode;
    const objText = nodeText(sf, objNode);
    const propName = idText((callee as any).name as TsNode);
    if (propName === 'writeMcpConfig') return 'writeMcpConfig(...) call';
    const objBound = ts.isIdentifier(objNode as any) ? aliasMap.get(idText(objNode)) : undefined;
    const effectiveModule = objBound?.module ?? objText;
    if ((effectiveModule === 'http' || effectiveModule === 'node:http' || effectiveModule === 'https' || effectiveModule === 'node:https') && propName === 'request') {
      return `${objText}.request(...) call`;
    }
    if ((effectiveModule === 'net' || effectiveModule === 'node:net') && (propName === 'connect' || propName === 'createConnection')) {
      return `net.${propName}(...) call`;
    }
    if (effectiveModule === 'undici' && (propName === 'request' || propName === 'fetch')) {
      return `undici.${propName}(...) call`;
    }
    if (effectiveModule === 'axios') return 'axios call';
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
  return !!callee && ts.isIdentifier(callee as any) && idText(callee) === 'WebSocket';
}

// -----------------------------------------------------------------------
// Occurrence-count (multiset) diff, whitespace-normalized. Fixes round-2
// finding #1's two concrete bugs: a Set silently collapses a genuinely
// duplicated/moved call to "already present, not added"; comparing raw
// (non-normalized) text turns pure reformatting into a false "addition."
// -----------------------------------------------------------------------
function occurrenceCounts(texts: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const raw of texts) {
    const t = normalizeText(raw);
    out.set(t, (out.get(t) ?? 0) + 1);
  }
  return out;
}
// For each distinct normalized text, how many MORE occurrences exist at
// head than at base (never negative) -- the count of genuinely new
// occurrences of that exact call/import shape.
function addedOccurrenceCounts(baseTexts: string[], headTexts: string[]): Map<string, number> {
  const baseCounts = occurrenceCounts(baseTexts);
  const headCounts = occurrenceCounts(headTexts);
  const out = new Map<string, number>();
  for (const [text, headCount] of headCounts) {
    const baseCount = baseCounts.get(text) ?? 0;
    const added = headCount - baseCount;
    if (added > 0) out.set(text, added);
  }
  return out;
}

function objectLiteralHasSpreadDeep(node: TsNode): boolean {
  let hit = false;
  walkAll(node, (n) => {
    if (hit) return;
    if (ts.isSpreadAssignment(n as any) || ts.isSpreadElement(n as any)) hit = true;
  });
  return hit;
}

// Locates the MCP_TEMPLATES array declaration and returns its element list
// -- round-2 finding #6: scoping to the ACTUAL template array (not "any
// object literal anywhere with a matching id") closes the decoy-object
// evasion.
function findMcpTemplatesArrayElements(sf: TsNode): TsNode[] | null {
  let elements: TsNode[] | null = null;
  walkAll(sf, (n) => {
    if (elements) return;
    if (!ts.isVariableDeclaration(n as any)) return;
    const nameNode = (n as any).name;
    if (!nameNode || !ts.isIdentifier(nameNode as any) || idText(nameNode as TsNode) !== 'MCP_TEMPLATES') return;
    const init = (n as any).initializer as TsNode | undefined;
    if (init && ts.isArrayLiteralExpression(init as any)) {
      elements = (init as any).elements as TsNode[];
    }
  });
  return elements;
}
// Finds the template's own array ELEMENT (not any nested object) whose
// direct `id` property equals expectedId. Requires the element to be a
// DIRECT object literal -- an element wrapped in ANY call expression
// (Object.assign, a factory function, etc.) is rejected outright as
// non-frozen shape, closing the "Object.assign" evasion without needing to
// model arbitrary function semantics.
function findTemplateElementById(elements: TsNode[], expectedId: string): { element: TsNode | null; wrappedInCall: boolean } {
  for (const el of elements) {
    const candidate = ts.isObjectLiteralExpression(el as any) ? el : null;
    const isCallWrapped = ts.isCallExpression(el as any) || ts.isNewExpression(el as any);
    // Only inspect direct object literals or call-wrapped elements for the
    // id -- anything else (spread element, identifier reference, etc.) is
    // not a literal-shaped template entry at all.
    const inspectTarget = candidate ?? (isCallWrapped ? el : null);
    if (!inspectTarget) continue;
    let idMatches = false;
    walkAll(inspectTarget, (n) => {
      if (idMatches) return;
      if (!ts.isPropertyAssignment(n as any)) return;
      const pname = (n as any).name;
      const pinit = (n as any).initializer;
      if (pname && ts.isIdentifier(pname as any) && idText(pname as TsNode) === 'id' && pinit && ts.isStringLiteral(pinit as any) && idText(pinit as TsNode) === expectedId) {
        idMatches = true;
      }
    });
    if (!idMatches) continue;
    if (isCallWrapped) return { element: null, wrappedInCall: true };
    return { element: candidate, wrappedInCall: false };
  }
  return { element: null, wrappedInCall: false };
}
// Scans the WHOLE file for any assignment expression whose left-hand side
// text mentions MCP_TEMPLATES -- round-2 finding #6's "satellite mutation"
// (e.g. `MCP_TEMPLATES.find(t => t.id === 'instatic').authMode = 'oauth'`
// executed elsewhere in the module, after the array is declared).
function findMcpTemplatesSatelliteMutations(sf: TsNode): string[] {
  const hits: string[] = [];
  walkAll(sf, (n) => {
    if (!ts.isBinaryExpression(n as any)) return;
    const op = (n as any).operatorToken;
    if (!op || op.kind !== ts.SyntaxKind.EqualsToken) return;
    const lhsText = nodeText(sf, (n as any).left as TsNode);
    if (lhsText.includes('MCP_TEMPLATES')) hits.push(nodeText(sf, n));
  });
  return hits;
}

// AST scan for a genuine NumericLiteral node with the given numeric value
// (accepting JS numeric separators like `10_000`), or -- for the byte
// guard -- a `1024 * 1024 * 1024`-shaped multiplication chain evaluating to
// it. A comment can never contain a NumericLiteral AST node, closing
// round-2 finding #5's "comment or dead-code" regex gap without needing
// full reachability analysis.
function astContainsNumericLiteral(sf: TsNode, value: number): boolean {
  let hit = false;
  walkAll(sf, (n) => {
    if (hit) return;
    if (ts.isNumericLiteral(n as any)) {
      const raw = idText(n as unknown as TsNode).replace(/_/g, '');
      if (Number(raw) === value) hit = true;
      return;
    }
    if (ts.isBinaryExpression(n as any)) {
      const op = (n as any).operatorToken;
      if (op && op.kind === ts.SyntaxKind.AsteriskToken) {
        const text = nodeText(sf, n).replace(/\s+/g, '');
        const parts = text.split('*').map((p) => Number(p.replace(/_/g, '')));
        if (parts.every((p) => Number.isFinite(p)) && parts.reduce((a, b) => a * b, 1) === value) hit = true;
      }
    }
  });
  return hit;
}

// -----------------------------------------------------------------------
// C10A-4 cross-file AST binding helpers.
// -----------------------------------------------------------------------
interface ImportedName {
  localName: string;
  moduleSpecifier: string;
}
// Round-2 finding #4: also capture default and namespace-import bindings,
// not only named imports.
function collectRuntimeExportsImports(sf: TsNode): { named: ImportedName[]; namespaces: ImportedName[]; defaults: ImportedName[] } {
  const named: ImportedName[] = [];
  const namespaces: ImportedName[] = [];
  const defaults: ImportedName[] = [];
  walkAll(sf, (n) => {
    if (!ts.isImportDeclaration(n as any)) return;
    const spec = (n as any).moduleSpecifier;
    if (!spec || !ts.isStringLiteral(spec)) return;
    const moduleSpecifier = idText(spec as unknown as TsNode);
    if (!moduleSpecifier.replace(/^\.\//, '').includes('runtime/exports')) return;
    const clause = (n as any).importClause;
    if (!clause) return;
    if (clause.name && ts.isIdentifier(clause.name)) {
      defaults.push({ localName: idText(clause.name as TsNode), moduleSpecifier });
    }
    const nb = clause.namedBindings;
    if (nb && ts.isNamespaceImport(nb as any)) {
      namespaces.push({ localName: idText((nb as any).name as TsNode), moduleSpecifier });
    } else if (nb && ts.isNamedImports(nb as any)) {
      for (const el of (nb as any).elements as TsNode[]) {
        named.push({ localName: idText((el as any).name as TsNode), moduleSpecifier });
      }
    }
  });
  return { named, namespaces, defaults };
}
function jsxSubtreeMentionsLabel(jsxNode: TsNode): boolean {
  let hit = false;
  const pattern = /instatic|super\s*import/i;
  walkAll(jsxNode, (n) => {
    if (hit) return;
    if (ts.isStringLiteral(n as any) || ts.isJsxText(n as any) || ts.isNoSubstitutionTemplateLiteral(n as any)) {
      if (pattern.test(idText(n as unknown as TsNode))) hit = true;
    }
  });
  return hit;
}
// Round-2 finding #4: return the FULL JsxElement (opening tag + children +
// closing tag), not just the JsxOpeningElement -- the opening element node
// does not contain its own children in the AST, so a naive "return the
// opening element" implementation can never see `<button onClick={...}>
// <span>{t('designFiles.exportSuperImport')}</span></button>`'s label.
function findEnclosingJsxElement(node: TsNode): TsNode | null {
  let cur: TsNode | undefined = (node as any).parent as TsNode | undefined;
  while (cur) {
    if (ts.isJsxSelfClosingElement(cur as any)) return cur;
    if (ts.isJsxOpeningElement(cur as any)) {
      const parent = (cur as any).parent as TsNode | undefined;
      if (parent && ts.isJsxElement(parent as any)) return parent;
      return cur;
    }
    cur = (cur as any).parent as TsNode | undefined;
  }
  return null;
}
function resolveHandlerBody(sf: TsNode, attr: TsNode): TsNode | null {
  const init = (attr as any).initializer;
  if (!init || !ts.isJsxExpression(init as any)) return null;
  const expr = (init as any).expression as TsNode | undefined;
  if (!expr) return null;
  if (ts.isArrowFunction(expr as any) || ts.isFunctionExpression(expr as any)) {
    return (expr as any).body as TsNode;
  }
  if (ts.isIdentifier(expr as any)) {
    const wantedName = idText(expr as TsNode);
    let foundBody: TsNode | null = null;
    walkAll(sf, (n) => {
      if (foundBody) return;
      if (ts.isFunctionDeclaration(n as any) && (n as any).name && idText((n as any).name as TsNode) === wantedName) {
        foundBody = (n as any).body as TsNode;
        return;
      }
      if (ts.isVariableDeclaration(n as any) && ts.isIdentifier((n as any).name as any) && idText((n as any).name as TsNode) === wantedName) {
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
// Round-2 finding #4: do NOT descend into a nested function/arrow's body
// unless it is reachably invoked -- an IIFE, or a callback argument passed
// directly to some other call (`.then(cb)`, `setTimeout(cb)`, …). A bare
// nested function DECLARATION that is never called or passed anywhere (a
// "dead nested decoy") is skipped entirely, so hiding the real call inside
// one no longer passes.
function isReachableNestedFunction(n: TsNode): boolean {
  const parent = (n as any).parent as TsNode | undefined;
  if (!parent) return false;
  // IIFE: the function is the callee of its own immediately-enclosing call.
  if (ts.isCallExpression(parent as any) && (parent as any).expression === n) return true;
  // Callback argument: the function is one of the arguments of a call.
  if (ts.isCallExpression(parent as any)) {
    const args = (parent as any).arguments as TsNode[] | undefined;
    if (args?.includes(n)) return true;
  }
  return false;
}
function collectReachableCalledIdentifierNamesAndProps(bodyNode: TsNode): { calledNames: Set<string>; calledProps: Array<{ obj: string; prop: string }> } {
  const calledNames = new Set<string>();
  const calledProps: Array<{ obj: string; prop: string }> = [];
  function walk(n: TsNode, isEntry: boolean): void {
    if (!isEntry && (ts.isFunctionDeclaration(n as any) || ts.isFunctionExpression(n as any) || ts.isArrowFunction(n as any)) && !isReachableNestedFunction(n)) {
      return; // dead nested function -- do not descend
    }
    if (ts.isCallExpression(n as any)) {
      const callee = (n as any).expression as TsNode;
      if (ts.isIdentifier(callee as any)) calledNames.add(idText(callee));
      if (ts.isPropertyAccessExpression(callee as any)) {
        const objNode = (callee as any).expression as TsNode;
        if (ts.isIdentifier(objNode as any)) {
          calledProps.push({ obj: idText(objNode), prop: idText((callee as any).name as TsNode) });
        }
      }
    }
    ts.forEachChild(n as any, (child: any) => walk(child as TsNode, false));
  }
  walk(bodyNode, true);
  return { calledNames, calledProps };
}
// Round-2 finding #4: inspect ONLY the fetch call's FIRST argument (the URL)
// for the route needle -- a decoy like `fetch(realUrl, {headers:
// {x:'/export/super-import'}})` must not pass just because the substring
// appears somewhere in the call.
function findFetchUrlArgContaining(sf: TsNode, bodyNode: TsNode, needle: string): { found: boolean; sawFetch: boolean } {
  let found = false;
  let sawFetch = false;
  function walk(n: TsNode, isEntry: boolean): void {
    if (!isEntry && (ts.isFunctionDeclaration(n as any) || ts.isFunctionExpression(n as any) || ts.isArrowFunction(n as any)) && !isReachableNestedFunction(n)) {
      return;
    }
    if (ts.isCallExpression(n as any)) {
      const callee = (n as any).expression as TsNode;
      if (ts.isIdentifier(callee as any) && idText(callee) === 'fetch') {
        sawFetch = true;
        const args = (n as any).arguments as TsNode[] | undefined;
        const firstArg = args && args.length > 0 ? args[0] : undefined;
        if (firstArg && nodeText(sf, firstArg).includes(needle)) found = true;
      }
    }
    ts.forEachChild(n as any, (child: any) => walk(child as TsNode, false));
  }
  walk(bodyNode, true);
  return { found, sawFetch };
}
function findExportedFunctionBody(sf: TsNode, name: string): TsNode | null {
  let body: TsNode | null = null;
  walkAll(sf, (n) => {
    if (body) return;
    if (ts.isFunctionDeclaration(n as any) && (n as any).name && idText((n as any).name as TsNode) === name) {
      const mods = ts.getCombinedModifierFlags(n as any) & ts.ModifierFlags.Export;
      if (mods) body = (n as any).body as TsNode;
      return;
    }
    if (ts.isVariableStatement(n as any)) {
      const firstDecl = (n as any).declarationList.declarations[0];
      const mods = firstDecl ? ts.getCombinedModifierFlags(firstDecl) : 0;
      if (!(mods & ts.ModifierFlags.Export)) return;
      for (const decl of (n as any).declarationList.declarations as TsNode[]) {
        if (ts.isIdentifier((decl as any).name as any) && idText((decl as any).name as TsNode) === name) {
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
// Round-2 finding #6: verify McpClientSection.tsx actually imports the
// named function from mcpTemplateRow.ts AND no longer declares its own
// same-named local function -- otherwise an unused-but-passing module can
// sit beside an unchanged, still-buggy component.
function fileImportsFrom(sf: TsNode, moduleSuffix: string, names: string[]): Set<string> {
  const found = new Set<string>();
  walkAll(sf, (n) => {
    if (!ts.isImportDeclaration(n as any)) return;
    const spec = (n as any).moduleSpecifier;
    if (!spec || !ts.isStringLiteral(spec)) return;
    if (!idText(spec as unknown as TsNode).replace(/^\.\//, '').includes(moduleSuffix)) return;
    const clause = (n as any).importClause;
    const nb = clause?.namedBindings;
    if (nb && ts.isNamedImports(nb as any)) {
      for (const el of (nb as any).elements as TsNode[]) {
        const local = idText((el as any).name as TsNode);
        if (names.includes(local)) found.add(local);
      }
    }
  });
  return found;
}
function fileDeclaresLocalFunction(sf: TsNode, name: string): boolean {
  let found = false;
  walkAll(sf, (n) => {
    if (found) return;
    if (ts.isFunctionDeclaration(n as any) && (n as any).name && idText((n as any).name as TsNode) === name) found = true;
  });
  return found;
}

// =========================================================================
// jszip -- reused from apps/daemon's own already-installed dependency
// (jszip@3.10.1 in apps/daemon/package.json) via createRequire.
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
// Protected-port isolation + redirect safety (round-2 finding #7). Every
// daemon URL is parsed and validated before use; every probe fetch refuses
// to follow a redirect, so a validated loopback route can never be silently
// steered to a protected port or an external host mid-request.
// =========================================================================
const FORBIDDEN_PORTS = new Set([7456, 51012]);
function validateIsolatedDaemonUrl(rawUrl: string): { ok: boolean; detail: string; port: number } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    return { ok: false, detail: `daemon-reported url does not parse: ${String(err)}`, port: -1 };
  }
  if (parsed.protocol !== 'http:') return { ok: false, detail: `expected http:, got ${parsed.protocol}`, port: -1 };
  if (parsed.hostname !== '127.0.0.1') return { ok: false, detail: `expected exact loopback host 127.0.0.1, got ${parsed.hostname}`, port: -1 };
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return { ok: false, detail: `expected a valid OS-assigned nonzero port, got "${parsed.port}"`, port: -1 };
  if (FORBIDDEN_PORTS.has(port)) return { ok: false, detail: `port ${port} is a protected default-namespace daemon port -- refusing to use it under any circumstance`, port };
  return { ok: true, detail: 'validated: http, 127.0.0.1, non-protected nonzero port', port };
}
class RedirectRefusedError extends Error {}
// Every probe fetch in this verifier goes through this wrapper: `redirect:
// 'manual'` plus an explicit check for a redirect-shaped response, so a
// validated loopback daemon can never silently steer a request elsewhere.
async function probeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const resp = await fetch(url, { ...init, redirect: 'manual' });
  const isRedirect = resp.type === 'opaqueredirect' || (resp.status >= 300 && resp.status < 400 && resp.headers.has('location'));
  if (isRedirect) {
    throw new RedirectRefusedError(`refused to follow a redirect from ${url} (status=${resp.status}, type=${resp.type}, location=${resp.headers.get('location') ?? '<none>'})`);
  }
  return resp;
}

// =========================================================================
// Isolated daemon boot.
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
// Fixture project creation -- through the REAL HTTP surface, never a
// database-level stub (VERIFICATION-CONTRACT.md section 3 R2).
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
  const resp = await probeFetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}/files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) return { ok: false, detail: `POST /api/projects/${id}/files (${name}) -> HTTP ${resp.status}: ${await resp.text().catch(() => '<unreadable>')}` };
  return { ok: true, detail: 'ok' };
}

async function createProjectShell(baseUrl: string, id: string): Promise<{ ok: boolean; detail: string }> {
  const resp = await probeFetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, name: id, skipDiscoveryBrief: true }),
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
const MCP_CLIENT_SECTION_REL_PATH = 'apps/web/src/components/McpClientSection.tsx';
const MCP_CONFIG_REL_PATH = 'apps/daemon/src/mcp-config.ts';
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
  // a tiny number, used by C10A-2's rejection AND at/below-limit-success
  // checks (round-2 finding #5).
  const { daemon: filesGuardDaemon, detail: filesGuardBootDetail } = await bootIsolatedDaemon({ [MAX_FILES_OVERRIDE_ENV]: '2' });
  const { daemon: bytesGuardDaemon, detail: bytesGuardBootDetail } = await bootIsolatedDaemon({ [MAX_BYTES_OVERRIDE_ENV]: '100' });

  try {
    // -----------------------------------------------------------------
    // C10A-1: Instatic MCP template registered, real-transport shape,
    // deep-spread-safe, satellite-mutation-safe, and bound to a
    // production-component fix for the URL-edit authMode flip.
    // -----------------------------------------------------------------
    await checkCriterion('C10A-1', async () => {
      if (!booted) {
        record('C10A-1', 'GET /api/mcp/servers', 'template shape + deep-spread safety + production binding + count re-derivation', false, '', { detail: `isolated daemon unavailable: ${bootDetail}` });
        return;
      }
      const resp = await probeFetch(`${booted.url}/api/mcp/servers`);
      if (!resp.ok) {
        record('C10A-1', `GET ${booted.url}/api/mcp/servers`, 'template shape + deep-spread safety + production binding + count re-derivation', false, '', { detail: `HTTP ${resp.status}` });
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
      const BEARER_IMCP_PAT_PATTERN = /bearer\s+imcp_pat_/i;
      let candidateId = '';
      const firstCandidate = candidates.length > 0 ? candidates[0] : undefined;
      for (const t of candidates) {
        const id = String(t.id ?? '');
        candidateId = id;
        if (!SERVER_ID_PATTERN.test(id)) problems.push(`template id "${id}" fails SERVER_ID_PATTERN`);
        const category = String(t.category ?? '');
        // PRD S10A-1 pins category exactly 'publishing' -- not merely "any valid category."
        if (category !== 'publishing') problems.push(`template "${id}" category is "${category}", the PRD pins exactly "publishing"`);
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
          // PRD S10A-1 pins the exact documented local default.
          if (url !== 'http://localhost:3000/_instatic/mcp') problems.push(`template "${id}" url "${url}" is not the PRD-pinned default "http://localhost:3000/_instatic/mcp" (mcp-connectors.md's own local example)`);
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
            problems.push(`template "${id}" Authorization header field does not name the exact evidenced shape "Bearer imcp_pat_..." in its placeholder/label -- got: ${JSON.stringify(hint)}`);
          }
        }
      }
      // Deep-spread + satellite-mutation safety, scoped to the ACTUAL
      // MCP_TEMPLATES array (round-2 finding #6).
      if (candidateId && fileExistsAtCommit(headSha, MCP_CONFIG_REL_PATH)) {
        const src = readFileAtCommitOrEmpty(headSha, MCP_CONFIG_REL_PATH);
        const sf = parseTs(src, MCP_CONFIG_REL_PATH);
        const elements = findMcpTemplatesArrayElements(sf);
        if (!elements) {
          problems.push(`could not locate a top-level "const MCP_TEMPLATES = [...]" array literal in ${MCP_CONFIG_REL_PATH}`);
        } else {
          const { element, wrappedInCall } = findTemplateElementById(elements, candidateId);
          if (wrappedInCall) {
            problems.push(`the Instatic entry in MCP_TEMPLATES is constructed via a call expression (Object.assign/factory/etc.), not a direct object literal -- cannot be statically proven frozen`);
          } else if (!element) {
            problems.push(`could not locate the Instatic entry as a direct object literal element of MCP_TEMPLATES (id "${candidateId}")`);
          } else if (objectLiteralHasSpreadDeep(element)) {
            problems.push(`the Instatic MCP_TEMPLATES element contains a spread (object or array) at some depth -- a runtime spread can override id/url/authMode even when the top-level properties look frozen`);
          }
        }
        const mutations = findMcpTemplatesSatelliteMutations(sf);
        if (mutations.length > 0) {
          problems.push(`${mutations.length} assignment(s) elsewhere in ${MCP_CONFIG_REL_PATH} target MCP_TEMPLATES after declaration (satellite mutation): ${mutations.slice(0, 3).join(' | ')}`);
        }
      } else if (candidateId) {
        problems.push(`${MCP_CONFIG_REL_PATH} does not exist at HEAD -- cannot run the spread/mutation safety checks`);
      }
      // Runtime re-derivation of the template count/id-set diff -- never a
      // hardcoded number (round-2 finding #8).
      if (fileExistsAtCommit(baseCommit, MCP_CONFIG_REL_PATH)) {
        const baseSrc = readFileAtCommitOrEmpty(baseCommit, MCP_CONFIG_REL_PATH);
        const baseSf = parseTs(baseSrc, MCP_CONFIG_REL_PATH);
        const baseElements = findMcpTemplatesArrayElements(baseSf) ?? [];
        const baseIds = new Set<string>();
        for (const el of baseElements) {
          walkAll(el, (n) => {
            if (!ts.isPropertyAssignment(n as any)) return;
            const pname = (n as any).name;
            const pinit = (n as any).initializer;
            if (pname && ts.isIdentifier(pname as any) && idText(pname as TsNode) === 'id' && pinit && ts.isStringLiteral(pinit as any)) {
              baseIds.add(idText(pinit as TsNode));
            }
          });
        }
        const headIds = new Set(templates.map((t) => String(t.id ?? '')));
        const missingFromHead = [...baseIds].filter((id) => !headIds.has(id));
        const addedAtHead = [...headIds].filter((id) => !baseIds.has(id));
        if (missingFromHead.length > 0) {
          problems.push(`${missingFromHead.length} baseCommit template id(s) are missing at HEAD (deleted/renamed, not additive): ${missingFromHead.join(', ')}`);
        }
        if (addedAtHead.length !== 1) {
          problems.push(`expected exactly 1 newly-added template id vs baseCommit, found ${addedAtHead.length}: ${addedAtHead.join(', ') || '<none>'}`);
        } else if (candidateId && addedAtHead[0] !== candidateId) {
          problems.push(`the one newly-added template id ("${addedAtHead[0]}") does not match the Instatic candidate id ("${candidateId}")`);
        }
        if (headIds.size !== baseIds.size + 1) {
          problems.push(`HEAD template count (${headIds.size}) is not exactly baseCommit's count (${baseIds.size}) + 1`);
        }
      } else {
        problems.push(`${MCP_CONFIG_REL_PATH} does not exist at baseCommit -- cannot re-derive the template-count diff`);
      }
      // Production binding: McpClientSection.tsx must import the fixed
      // functions from the required pure module and must no longer declare
      // its own same-named local copies (round-2 finding #6).
      const rowLogicAbsPath = path.join(repoRoot, MCP_TEMPLATE_ROW_REL_PATH);
      const clientSectionAbsPath = path.join(repoRoot, MCP_CLIENT_SECTION_REL_PATH);
      if (!fs.existsSync(rowLogicAbsPath)) {
        problems.push(`${MCP_TEMPLATE_ROW_REL_PATH} does not exist -- required pure module for rowFromTemplate/authModeAfterUrlChange is missing`);
      } else if (!firstCandidate) {
        problems.push('no Instatic template candidate available to functionally exercise mcpTemplateRow.ts against');
      } else {
        if (!fs.existsSync(clientSectionAbsPath)) {
          problems.push(`${MCP_CLIENT_SECTION_REL_PATH} does not exist`);
        } else {
          const clientSrc = fs.readFileSync(clientSectionAbsPath, 'utf8');
          const clientSf = parseTs(clientSrc, MCP_CLIENT_SECTION_REL_PATH);
          const imported = fileImportsFrom(clientSf, 'state/mcpTemplateRow', ['rowFromTemplate', 'authModeAfterUrlChange']);
          if (!imported.has('rowFromTemplate')) problems.push(`${MCP_CLIENT_SECTION_REL_PATH} does not import "rowFromTemplate" from state/mcpTemplateRow`);
          if (!imported.has('authModeAfterUrlChange')) problems.push(`${MCP_CLIENT_SECTION_REL_PATH} does not import "authModeAfterUrlChange" from state/mcpTemplateRow`);
          if (fileDeclaresLocalFunction(clientSf, 'rowFromTemplate')) problems.push(`${MCP_CLIENT_SECTION_REL_PATH} still declares its own local "rowFromTemplate" -- the extraction must replace it, not sit unused beside it`);
          if (fileDeclaresLocalFunction(clientSf, 'authModeAfterUrlChange')) problems.push(`${MCP_CLIENT_SECTION_REL_PATH} still declares its own local "authModeAfterUrlChange" -- the extraction must replace it, not sit unused beside it`);
        }
        try {
          const modUrl = `${pathToFileURL(rowLogicAbsPath).href}?t=${Date.now()}`;
          const mod = (await import(modUrl)) as {
            rowFromTemplate?: (tpl: unknown, taken: Set<string>) => Record<string, unknown> & { authMode?: string; url?: string; _headersText?: string };
            authModeAfterUrlChange?: (row: Record<string, unknown>, nextUrl: string) => string;
          };
          if (typeof mod.rowFromTemplate !== 'function' || typeof mod.authModeAfterUrlChange !== 'function') {
            problems.push(`${MCP_TEMPLATE_ROW_REL_PATH} does not export both rowFromTemplate and authModeAfterUrlChange`);
          } else {
            const row = mod.rowFromTemplate(firstCandidate, new Set());
            if (row.authMode !== 'none') problems.push(`rowFromTemplate(instaticTemplate) produced authMode="${String(row.authMode)}", expected "none" immediately after template selection`);
            if (row._headersText && /imcp_pat/i.test(row._headersText)) problems.push('rowFromTemplate seeded the Authorization header with placeholder-looking text instead of an empty value');
            const afterEdit = mod.authModeAfterUrlChange(row, 'https://real-instatic-host.example.com/_instatic/mcp');
            if (afterEdit !== 'none') problems.push(`authModeAfterUrlChange(row, <non-loopback real host>) returned "${afterEdit}", expected "none" to be retained`);
          }
        } catch (err) {
          problems.push(`could not import/exercise ${MCP_TEMPLATE_ROW_REL_PATH}: ${String((err as Error)?.stack ?? err)}`);
        }
      }
      record(
        'C10A-1',
        `GET ${booted.url}/api/mcp/servers`,
        'exactly one structurally-valid Instatic entry (category=publishing, transport=http, url=http://localhost:3000/_instatic/mcp, authMode=none, header names exact "Bearer imcp_pat_..."), deep-spread-safe and satellite-mutation-safe in its own MCP_TEMPLATES array element, exactly +1 vs baseCommit with no ids lost, and McpClientSection.tsx imports the fixed row-logic module instead of keeping its own local (buggy) copy',
        problems.length === 0,
        problems.join('\n') || `found exactly one valid, spread-safe, bound, count-verified candidate: ${JSON.stringify(firstCandidate)}`,
        { detail: problems.length > 0 ? `${problems.length} problem(s)` : undefined },
      );
    });

    // -----------------------------------------------------------------
    // C10A-2: Super Import export -- full role coverage, poison-file
    // rejection, EXACT status/code assertions, and at/below-limit success
    // controls on both override daemons.
    // -----------------------------------------------------------------
    await checkCriterion('C10A-2', async () => {
      const assertionText =
        'every classifyFiles.ts role present at NATURAL relative paths, byte-identical; sidecar excluded; poison-file project rejected with EXACTLY 409 + ApiErrorCode CONFLICT; both size guards reject with EXACTLY 413 + ApiErrorCode PAYLOAD_TOO_LARGE (never a 500 or other status); an at/below-limit fixture on each override daemon SUCCEEDS; route defaults cite Instatic\'s real constants via genuine AST numeric literals';
      if (!booted || !fixture) {
        record('C10A-2', 'GET /api/projects/:id/export/super-import', assertionText, false, '', {
          detail: !booted ? `isolated daemon unavailable: ${bootDetail}` : `fixture project unavailable: ${fixtureDetail}`,
        });
        return;
      }
      const problems: string[] = [];
      const exportUrl = `${booted.url}/api/projects/${encodeURIComponent(fixture.id)}/export/super-import`;
      const resp = await probeFetch(exportUrl);
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
            if (!actual.equals(expectedContent)) problems.push(`content mismatch: ${expectedPath} (expected sha256 ${sha256Bytes(expectedContent)}, got ${sha256Bytes(actual)})`);
          }
          const allNames = Object.keys(zip.files);
          const sidecarLeak = allNames.filter((n) => n.includes(FIXTURE_SIDECAR_NAME));
          if (sidecarLeak.length > 0) problems.push(`negative control failed -- sidecar leaked into zip: ${sidecarLeak.join(', ')}`);
          const reshapedPaths = allNames.filter((n) => /^(pages|tokens|media)\//.test(n));
          if (reshapedPaths.length > 0) problems.push(`export reshapes the tree into pages/tokens/media folders: ${reshapedPaths.join(', ')}`);
        }
      }
      // Poison-file rejection: EXACT 409 + ApiErrorCode CONFLICT.
      if (!poisonFixture) {
        problems.push(`poison fixture unavailable: ${poisonDetail}`);
      } else {
        const poisonUrl = `${booted.url}/api/projects/${encodeURIComponent(poisonFixture.id)}/export/super-import`;
        const poisonResp = await probeFetch(poisonUrl);
        if (poisonResp.status !== 409) {
          problems.push(`GET ${poisonUrl} -> HTTP ${poisonResp.status}, expected EXACTLY 409 (CONFLICT) for a project containing ${FIXTURE_POISON_PATH} -- a 500 or any other status is NOT a valid rejection`);
        } else {
          const codeCheck = await assertApiErrorCode(poisonResp, 'CONFLICT');
          if (!codeCheck.ok) problems.push(`poison-file rejection body: ${codeCheck.detail}`);
        }
      }
      // Size guards: EXACT 413 + ApiErrorCode PAYLOAD_TOO_LARGE on the
      // over-limit fixture, AND a real SUCCESS on an at/below-limit fixture
      // on the SAME override daemon (round-2 finding #5's missing positive
      // control -- distinguishes correct discrimination from a
      // broken/always-rejecting daemon).
      if (!filesGuardDaemon) {
        problems.push(`files-guard isolated daemon unavailable: ${filesGuardBootDetail}`);
      } else {
        const over = await createTinyFixtureProject(filesGuardDaemon.url, 3, 16).catch((err: unknown) => ({ fixture: null, detail: `tiny fixture threw: ${String(err)}` }));
        if (!over.fixture) {
          problems.push(`could not create files-guard OVER-limit tiny fixture: ${over.detail}`);
        } else {
          const r = await probeFetch(`${filesGuardDaemon.url}/api/projects/${encodeURIComponent(over.fixture.id)}/export/super-import`);
          if (r.status !== 413) {
            problems.push(`file-count guard: with ${MAX_FILES_OVERRIDE_ENV}=2 and a 3-file project, GET .../export/super-import returned HTTP ${r.status}, expected EXACTLY 413 -- a 500 is NOT a valid rejection`);
          } else {
            const codeCheck = await assertApiErrorCode(r, 'PAYLOAD_TOO_LARGE');
            if (!codeCheck.ok) problems.push(`file-count guard rejection body: ${codeCheck.detail}`);
          }
        }
        const under = await createTinyFixtureProject(filesGuardDaemon.url, 2, 16).catch((err: unknown) => ({ fixture: null, detail: `tiny fixture threw: ${String(err)}` }));
        if (!under.fixture) {
          problems.push(`could not create files-guard AT-limit tiny fixture: ${under.detail}`);
        } else {
          const r = await probeFetch(`${filesGuardDaemon.url}/api/projects/${encodeURIComponent(under.fixture.id)}/export/super-import`);
          if (!r.ok) problems.push(`file-count guard positive control FAILED: with ${MAX_FILES_OVERRIDE_ENV}=2 and a 2-file (at-limit) project, GET .../export/super-import returned HTTP ${r.status} instead of success -- the daemon may be broken/always-rejecting, not correctly discriminating`);
          else {
            try {
              await JSZipMod.loadAsync(Buffer.from(await r.arrayBuffer()));
            } catch (err) {
              problems.push(`file-count guard positive control: response was 2xx but not a valid zip: ${String(err)}`);
            }
          }
        }
      }
      if (!bytesGuardDaemon) {
        problems.push(`bytes-guard isolated daemon unavailable: ${bytesGuardBootDetail}`);
      } else {
        const over = await createTinyFixtureProject(bytesGuardDaemon.url, 1, 400).catch((err: unknown) => ({ fixture: null, detail: `tiny fixture threw: ${String(err)}` }));
        if (!over.fixture) {
          problems.push(`could not create bytes-guard OVER-limit tiny fixture: ${over.detail}`);
        } else {
          const r = await probeFetch(`${bytesGuardDaemon.url}/api/projects/${encodeURIComponent(over.fixture.id)}/export/super-import`);
          if (r.status !== 413) {
            problems.push(`byte-size guard: with ${MAX_BYTES_OVERRIDE_ENV}=100 and a >400-byte project, GET .../export/super-import returned HTTP ${r.status}, expected EXACTLY 413`);
          } else {
            const codeCheck = await assertApiErrorCode(r, 'PAYLOAD_TOO_LARGE');
            if (!codeCheck.ok) problems.push(`byte-size guard rejection body: ${codeCheck.detail}`);
          }
        }
        const under = await createTinyFixtureProject(bytesGuardDaemon.url, 1, 20).catch((err: unknown) => ({ fixture: null, detail: `tiny fixture threw: ${String(err)}` }));
        if (!under.fixture) {
          problems.push(`could not create bytes-guard AT/BELOW-limit tiny fixture: ${under.detail}`);
        } else {
          const r = await probeFetch(`${bytesGuardDaemon.url}/api/projects/${encodeURIComponent(under.fixture.id)}/export/super-import`);
          if (!r.ok) problems.push(`byte-size guard positive control FAILED: with ${MAX_BYTES_OVERRIDE_ENV}=100 and a well-under-limit project, GET .../export/super-import returned HTTP ${r.status} instead of success`);
          else {
            try {
              await JSZipMod.loadAsync(Buffer.from(await r.arrayBuffer()));
            } catch (err) {
              problems.push(`byte-size guard positive control: response was 2xx but not a valid zip: ${String(err)}`);
            }
          }
        }
      }
      // Source-level: AST NumericLiteral presence for the real defaults
      // (round-2 finding #5 -- a comment can never contain a NumericLiteral
      // AST node, so this is immune to the "comment/dead-code" evasion a
      // text regex admitted).
      const routeAbsPath = path.join(repoRoot, SUPER_IMPORT_ROUTE_REL_PATH);
      if (!fs.existsSync(routeAbsPath)) {
        problems.push(`could not read ${SUPER_IMPORT_ROUTE_REL_PATH} to check for Instatic's real size-guard default constants`);
      } else {
        const routeSource = fs.readFileSync(routeAbsPath, 'utf8');
        const routeSf = parseTs(routeSource, SUPER_IMPORT_ROUTE_REL_PATH);
        if (!astContainsNumericLiteral(routeSf, 10000)) problems.push(`${SUPER_IMPORT_ROUTE_REL_PATH} contains no genuine AST numeric literal equal to Instatic's real default file-count limit 10_000 (ingestInput.ts:40)`);
        if (!astContainsNumericLiteral(routeSf, 1073741824)) problems.push(`${SUPER_IMPORT_ROUTE_REL_PATH} contains no genuine AST numeric literal (or 1024*1024*1024 product) equal to Instatic's real default byte limit 1073741824 (ingestInput.ts:39)`);
        if (!routeSource.includes(MAX_FILES_OVERRIDE_ENV) || !routeSource.includes(MAX_BYTES_OVERRIDE_ENV)) {
          problems.push(`${SUPER_IMPORT_ROUTE_REL_PATH} does not reference both injectable override env vars (${MAX_FILES_OVERRIDE_ENV}, ${MAX_BYTES_OVERRIDE_ENV})`);
        }
      }
      record('C10A-2', `GET ${exportUrl}`, assertionText, problems.length === 0, problems.join('\n') || `all ${Object.keys(EXPECTED_ZIP_ENTRIES).length} role-representative entries byte-faithful; poison + both size guards reject with exact status/code; both at/below-limit positive controls succeed; defaults are genuine AST literals`, {
        detail: problems.length > 0 ? `${problems.length} problem(s)` : undefined,
      });
    });

    // -----------------------------------------------------------------
    // C10A-3: CLI parity, real subprocess, pointed only at the validated
    // isolated daemon. C10A-3's own byte-identity-against-the-same-fixture-
    // id requirement is the practical proof the CLI honored --daemon-url
    // rather than falling back to the 7456 default: a fallback would hit an
    // entirely different (and in this environment, forbidden-to-touch) real
    // daemon where this randomly-generated fixture id does not exist,
    // which would 404/error rather than byte-match -- see the PRD's
    // "Ground facts" for why this verifier does not attempt to directly
    // provoke that fallback path (doing so risks actually reaching a
    // protected daemon if the fallback bug were real).
    // -----------------------------------------------------------------
    await checkCriterion('C10A-3', async () => {
      if (!booted || !fixture) {
        record('C10A-3', 'od project export-super-import <id> --daemon-url <isolated>', 'CLI output byte-identical to the HTTP route it wraps', false, '', {
          detail: !booted ? `isolated daemon unavailable: ${bootDetail}` : `fixture project unavailable: ${fixtureDetail}`,
        });
        return;
      }
      const exportUrl = `${booted.url}/api/projects/${encodeURIComponent(fixture.id)}/export/super-import`;
      const httpResp = await probeFetch(exportUrl);
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
    // C10A-4: Super Import UI entry point -- cross-file AST binding, fixed
    // for the full-element traversal, default/namespace imports, dead-
    // nested-decoy exclusion, and URL-argument-only fetch matching.
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
        const { named, namespaces, defaults } = collectRuntimeExportsImports(panelSf);
        const namedNames = new Set(named.map((i) => i.localName));
        const namespaceNames = new Set(namespaces.map((i) => i.localName));
        const defaultNames = new Set(defaults.map((i) => i.localName));
        if (namedNames.size === 0 && namespaceNames.size === 0 && defaultNames.size === 0) {
          problems.push(`${DESIGN_FILES_PANEL_REL_PATH} imports nothing (named, default, or namespace) from a "runtime/exports" module specifier`);
        }
        const onClickAttrs: TsNode[] = [];
        walkAll(panelSf, (n) => {
          if (ts.isJsxAttribute(n as any)) {
            const name = ((n as any).name as { text?: string }).text;
            if (name === 'onClick' || name === 'onSelect' || name === 'onPress') onClickAttrs.push(n);
          }
        });
        if (onClickAttrs.length === 0) problems.push(`${DESIGN_FILES_PANEL_REL_PATH} has no onClick/onSelect/onPress JSX attribute at all`);
        let boundHandler: TsNode | null = null;
        let boundCalledName = '';
        let boundElement: TsNode | null = null;
        for (const attr of onClickAttrs) {
          const bodyNode = resolveHandlerBody(panelSf, attr);
          if (!bodyNode) continue;
          const { calledNames, calledProps } = collectReachableCalledIdentifierNamesAndProps(bodyNode);
          for (const name of calledNames) {
            if (namedNames.has(name) || defaultNames.has(name)) {
              boundHandler = bodyNode;
              boundCalledName = name;
              boundElement = findEnclosingJsxElement(attr);
              break;
            }
          }
          if (!boundHandler) {
            for (const { obj, prop } of calledProps) {
              if (namespaceNames.has(obj)) {
                boundHandler = bodyNode;
                boundCalledName = prop;
                boundElement = findEnclosingJsxElement(attr);
                break;
              }
            }
          }
          if (boundHandler) break;
        }
        if (!boundHandler) {
          problems.push(`no onClick/onSelect/onPress handler in ${DESIGN_FILES_PANEL_REL_PATH} REACHABLY calls an identifier imported from "runtime/exports" (dead/never-invoked nested functions are not counted)`);
        } else {
          if (!boundElement || !jsxSubtreeMentionsLabel(boundElement)) {
            problems.push(`the JSX element wiring "${boundCalledName}" (including its children) has no visible/attribute text mentioning "Instatic" or "Super Import"`);
          }
          const exportsSrc = fs.readFileSync(exportsAbsPath, 'utf8');
          const exportsSf = parseTs(exportsSrc, RUNTIME_EXPORTS_REL_PATH);
          const fnBody = findExportedFunctionBody(exportsSf, boundCalledName);
          if (!fnBody) {
            problems.push(`${RUNTIME_EXPORTS_REL_PATH} has no exported function/const named "${boundCalledName}"`);
          } else {
            const { found, sawFetch } = findFetchUrlArgContaining(exportsSf, fnBody, '/export/super-import');
            if (!sawFetch) problems.push(`${RUNTIME_EXPORTS_REL_PATH}'s exported "${boundCalledName}" contains no reachable fetch(...) call`);
            else if (!found) problems.push(`${RUNTIME_EXPORTS_REL_PATH}'s exported "${boundCalledName}" calls fetch(...), but no call's FIRST ARGUMENT (the URL) contains "/export/super-import" -- a route string elsewhere in the call (e.g. headers) does not count`);
          }
        }
      }
      record(
        'C10A-4',
        `AST: ${DESIGN_FILES_PANEL_REL_PATH} onClick -> imported runtime/exports helper -> fetch(URL) naming '/export/super-import'`,
        'a labeled (Instatic/Super Import) click handler, including its JSX children, in DesignFilesPanel.tsx REACHABLY calls a function imported (named, default, or namespace) from runtime/exports.ts, and that exported function itself fetches the /export/super-import route in its URL argument specifically',
        problems.length === 0,
        problems.join('\n') || `bound: DesignFilesPanel.tsx onClick -> ${RUNTIME_EXPORTS_REL_PATH}'s exported handler -> fetch(URL containing .../export/super-import)`,
        { detail: problems.length > 0 ? `${problems.length} problem(s)` : undefined },
      );
    });

    // -----------------------------------------------------------------
    // C10A-5: No deeper coupling (founder-pin scope fence). Multiset
    // (occurrence-count) AST diff, whitespace-normalized, alias-aware.
    // -----------------------------------------------------------------
    await checkCriterion('C10A-5', () => {
      const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
      if (diffResult.status !== 0) {
        record('C10A-5', `git diff --name-only ${baseCommit}...HEAD`, 'no NEWLY ADDED (occurrence-count-wise) outbound-call primitive, dynamic import()/require(), or writeMcpConfig() call outside the allowlisted local-daemon call sites', false, diffResult.stdout, { detail: `git diff exited ${diffResult.status}` });
        return;
      }
      const changedFiles = diffResult.stdout.trim().split('\n').filter(Boolean);
      const productFiles = changedFiles.filter((f) => !f.startsWith('scripts/waves/') && !f.startsWith('docs/') && (f.endsWith('.ts') || f.endsWith('.tsx')));
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
        const aliasMap = buildImportAliasMap(headSf);
        // Import occurrence diff (multiset, normalized) -- catches a
        // suspicious module imported a SECOND time (e.g. re-imported after
        // a prior removal) as well as a first-time addition.
        const baseImportTexts: string[] = [];
        walkAll(baseSf, (n) => {
          if (ts.isImportDeclaration(n as any)) baseImportTexts.push(canonicalNodeText(baseSf, n));
        });
        const headImportTexts: string[] = [];
        walkAll(headSf, (n) => {
          if (ts.isImportDeclaration(n as any)) headImportTexts.push(canonicalNodeText(headSf, n));
        });
        const addedImportOccurrences = addedOccurrenceCounts(baseImportTexts, headImportTexts);
        for (const importText of addedImportOccurrences.keys()) {
          const specMatch = /from\s+['"]([^'"]+)['"]/.exec(importText) ?? /import\s*\(\s*['"]([^'"]+)['"]/.exec(importText);
          const spec = specMatch?.[1] ?? '';
          const normalized = spec.replace(/^node:/, '');
          if (SUSPICIOUS_IMPORT_MODULES.has(spec) || SUSPICIOUS_IMPORT_MODULES.has(normalized)) {
            problems.push(`${f}: newly added import occurrence of suspicious module "${spec}": ${importText.slice(0, 160)}`);
          }
        }
        // Call/new-expression occurrence diff (multiset, canonical-printed
        // so pure formatting/reflow changes never register as an addition
        // -- see canonicalNodeText()'s comment for why this replaced a
        // plain whitespace-collapsing normalization).
        const baseCallTexts: string[] = [];
        walkAll(baseSf, (n) => {
          if (ts.isCallExpression(n as any) || ts.isNewExpression(n as any)) baseCallTexts.push(canonicalNodeText(baseSf, n));
        });
        const headCallNodes: TsNode[] = [];
        walkAll(headSf, (n) => {
          if (ts.isCallExpression(n as any) || ts.isNewExpression(n as any)) headCallNodes.push(n);
        });
        const headCallTexts = headCallNodes.map((n) => canonicalNodeText(headSf, n));
        const addedCallOccurrences = addedOccurrenceCounts(baseCallTexts, headCallTexts);
        if (addedCallOccurrences.size > 0) {
          // Walk HEAD nodes once more, classifying each occurrence whose
          // normalized text still has remaining "added" budget -- this
          // correctly attributes N added occurrences of an identical shape
          // (duplication/move) rather than only the first instance found.
          const remaining = new Map(addedCallOccurrences);
          for (const n of headCallNodes) {
            const norm = canonicalNodeText(headSf, n);
            const left = remaining.get(norm);
            if (!left || left <= 0) continue;
            remaining.set(norm, left - 1);
            if (isNewWebSocket(n)) {
              problems.push(`${f}: newly added occurrence of "new WebSocket(...)" -- direct egress primitive, not allowlisted anywhere in this wave`);
              continue;
            }
            const reason = classifyForbiddenCallNode(headSf, n, aliasMap);
            if (!reason) continue;
            const rawText = nodeText(headSf, n);
            if (reason === '__FETCH__') {
              if (!ALLOWLISTED_FETCH_FILES.has(f)) {
                problems.push(`${f}: newly added fetch(...) occurrence outside the two allowlisted local-daemon call sites (${[...ALLOWLISTED_FETCH_FILES].join(', ')})`);
                continue;
              }
              const args = (n as any).arguments as TsNode[] | undefined;
              const firstArg = args && args.length > 0 ? args[0] : undefined;
              const firstArgText = firstArg ? nodeText(headSf, firstArg) : '';
              const lower = firstArgText.toLowerCase();
              if (!lower.includes('/export/super-import')) problems.push(`${f}: newly added fetch(...) occurrence's URL argument does not name the local "/export/super-import" route: ${firstArgText.slice(0, 160)}`);
              if (lower.includes('instatic')) problems.push(`${f}: newly added fetch(...) occurrence's URL argument names "instatic" directly: ${firstArgText.slice(0, 160)}`);
              continue;
            }
            problems.push(`${f}: newly added occurrence of ${reason}: ${rawText.slice(0, 160)}`);
          }
        }
      }
      record(
        'C10A-5',
        `AST added-OCCURRENCE (multiset, whitespace-normalized) diff, git show ${baseCommit}:<file> vs HEAD, product .ts/.tsx paths only, import-alias-resolved`,
        'no newly added occurrence (duplicated, moved, or first-time) of an outbound-call primitive, dynamic import()/require(), or writeMcpConfig() call, except fetch(...) in the two allowlisted local-daemon files whose URL argument specifically names the local /export/super-import route and never names Instatic directly; no newly added occurrence of an import from a suspicious network/process module (including node:http/https/net); pure formatting/reflow changes never count',
        problems.length === 0,
        problems.join('\n') || `${productFiles.length} product .ts/.tsx file(s) touched, 0 violations in added AST-node occurrences (0 files pre-implementation is expected -- vacuous pass, documented in the PRD, not a loophole)`,
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
        `sha256: ${selfSha256}\nUNPINNED -- no approved-gate.sha256 present. An unpinned run is ADVISORY ONLY and may never be treated as landing-eligible evidence; see the PRD's "Implementation ceremony" section.`,
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
        detail: `no "${LEASE_KEY}" entry in leases.json@baseCommit -- expected pre-landing`,
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

// Parses a probeFetch()'d error response body and asserts it matches the
// REUSED ApiErrorResponse envelope with the expected code -- round-2
// finding #5: proving the real reason, not just an HTTP status number.
async function assertApiErrorCode(resp: Response, expectedCode: string): Promise<{ ok: boolean; detail: string }> {
  let body: unknown;
  try {
    body = await resp.json();
  } catch (err) {
    return { ok: false, detail: `response body did not parse as JSON: ${String(err)}` };
  }
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  if (code !== expectedCode) {
    return { ok: false, detail: `expected ApiErrorResponse.error.code === "${expectedCode}", got ${JSON.stringify(code)} (body: ${JSON.stringify(body).slice(0, 300)})` };
  }
  return { ok: true, detail: 'ok' };
}

main().catch((err) => {
  writeEmergencyManifest(`unhandled error in main(): ${String((err as Error)?.stack ?? err)}`, results);
  process.exit(1);
});
