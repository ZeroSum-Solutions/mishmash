// verify-w10a.ts -- wave mishmash-w10a-instatic (Instatic seam: MCP client
// registration + Super Import static export) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w10a.ts [--repo <path>]
// Exit 0 only when every C10A criterion passes, the tree is clean, and the
// manifest placeholder wrote successfully. The commit-bound proof manifest is
// always written to the wave's goal-state proof directory, pass or fail, per
// VERIFICATION-CONTRACT.md section 2.
//
// Scope: docs/plans/waves/W10a-instatic-seam.md, pinned verbatim to the NM-24
// founder ruling ("seam = MCP + Super Import only ... deeper coupling needs
// separate evidence", docs/plans/waves/NM-REGISTER.md). Six substantive
// criteria (C10A-1..C10A-6) plus the three house infra checks
// (GATE-INTEGRITY/LEASE/HEAD-DRIFT) -- deliberately not the AST-classifier /
// worktree-replay machinery verify-w9-ingest.ts needed for route-hardening
// attribution. That machinery solves a different, larger problem; reusing it
// here would be padding, not discipline.
//
// PORTABILITY: repoRoot comes from `process.cwd()`/`--repo`, never
// `import.meta.url`. ISOLATION (non-negotiable): every daemon this verifier
// boots uses port 0 (OS-assigned ephemeral port) and a fresh `mkdtemp`
// OD_DATA_DIR, is torn down by its own exact child-process handle
// (SIGTERM, then SIGKILL after a bounded wait), and every `od` CLI
// subprocess this verifier spawns is pointed at that isolated daemon via
// BOTH `--daemon-url` and `OD_DAEMON_URL` so it can never fall through to
// the hard-coded `http://127.0.0.1:7456` default. This verifier never
// resolves, reads from, or sends a request to ports 7456 or 51012, and never
// issues a `git fetch`/`git push` -- git context is resolved from local refs
// only.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

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
try {
  repoRoot = path.resolve(argValue('--repo') ?? process.cwd());
  proofDir = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'proof');
  fs.mkdirSync(proofDir, { recursive: true });
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
// jszip -- reused from apps/daemon's own already-installed dependency
// (jszip@3.10.1 in apps/daemon/package.json) via createRequire, never a new
// dependency this verifier adds. Minimal local interface: we only need
// loadAsync + per-entry async('nodebuffer'), never JSZip's full surface.
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
// Isolated daemon boot. Port 0, fresh mkdtemp OD_DATA_DIR, kept alive across
// multiple checks, torn down by its own exact child handle. Never touches
// ports 7456 or 51012.
// =========================================================================
interface BootedDaemon {
  url: string;
  dataDir: string;
  child: ChildProcess;
  scriptPath: string;
}

async function bootIsolatedDaemon(): Promise<{ daemon: BootedDaemon | null; detail: string }> {
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
    env: { ...process.env, OD_DATA_DIR: dataDir },
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
  return { daemon: { url, dataDir, child, scriptPath }, detail: 'ready' };
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
// Fixture project -- created through the REAL HTTP surface (POST
// /api/projects, POST /api/projects/:id/files) against the isolated daemon,
// never a database-level stub (VERIFICATION-CONTRACT.md section 3 R2: real
// transport at the boundary under test).
// =========================================================================
// Fixture content mirrors a real static site: index.html links style.css,
// which carries a :root color custom property -- Instatic's own
// extractRootColorTokens would pull that out automatically at import time.
// Nothing in this verifier parses tokens (that is Instatic's job, not
// MishMash's export's job) -- the fixture just needs to be a realistic
// small site so the "natural relative paths, no reshaping" assertion below
// means something.
const FIXTURE_INDEX_HTML =
  '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body>Fixture Home</body></html>\n';
const FIXTURE_ABOUT_HTML = '<!doctype html><html><body>Fixture About</body></html>\n';
const FIXTURE_STYLE_CSS = ':root { --color-brand: #111111; }\nbody { color: var(--color-brand); }\n';
const FIXTURE_MEDIA_BYTES = crypto.randomBytes(256);
const FIXTURE_SIDECAR_JSON = `${JSON.stringify({ note: 'sidecar -- must never appear in any export path' })}\n`;
// Negative control (VERIFICATION-CONTRACT.md section 3 R4): a real project
// file that must be excluded from the export under the SAME rule
// collectArchiveEntries() already applies to *.artifact.json sidecars --
// this is MishMash's own pre-existing hygiene rule, re-verified for the new
// route, not something Instatic's ingestion itself requires (a stray .json
// sidecar would just classify as Instatic's harmless 'meta' role -- see
// W10a-instatic-seam.md "Ground facts"). A "zip everything, unfiltered"
// implementation fails this; only one that reuses the real exclusion rule
// passes it.
const FIXTURE_SIDECAR_NAME = 'index.html.artifact.json';

// Expected shape per the REAL Instatic ingestion contract (site-import.md,
// ingestInput.ts, classifyFiles.ts): a flat, relative-path tree, NOT
// restructured into pages/tokens/media folders -- see W10a-instatic-seam.md
// "Ground facts" for the citations that corrected this from an earlier,
// wrong pages/tokens/media design.
const EXPECTED_ZIP_ENTRIES: Record<string, Buffer> = {
  'index.html': Buffer.from(FIXTURE_INDEX_HTML, 'utf8'),
  'docs/about.html': Buffer.from(FIXTURE_ABOUT_HTML, 'utf8'),
  'style.css': Buffer.from(FIXTURE_STYLE_CSS, 'utf8'),
  'images/logo.png': FIXTURE_MEDIA_BYTES,
};

// Instatic's own real size guards (src/core/siteImport/ingestInput.ts:39-41
// in the Instatic checkout) -- the export route's OWN source must cite
// these same numbers, not invented or absent thresholds. Accepts either a
// bare decimal or the multiplication form Instatic's own source uses
// (`1024 * 1024 * 1024`), since an implementer may write either.
const INSTATIC_MAX_FILES_PATTERN = /10[_,]?000\b/;
const INSTATIC_MAX_BYTES_PATTERN = /1073741824\b|1024\s*\*\s*1024\s*\*\s*1024\b/;
const SUPER_IMPORT_ROUTE_REL_PATH = 'apps/daemon/src/routes/project-super-import.ts';

interface FixtureProject {
  id: string;
}

async function createFixtureProject(baseUrl: string): Promise<{ fixture: FixtureProject | null; detail: string }> {
  const id = `w10a-fixture-${crypto.randomBytes(6).toString('hex')}`;
  const createResp = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, name: id, skipDiscoveryBrief: true }),
  }).catch((err: unknown) => {
    throw new Error(`POST /api/projects network error: ${String(err)}`);
  });
  if (!createResp.ok) {
    return { fixture: null, detail: `POST /api/projects -> HTTP ${createResp.status}: ${await createResp.text().catch(() => '<unreadable>')}` };
  }
  const files: Array<{ name: string; content: string; encoding?: 'base64' }> = [
    { name: 'index.html', content: FIXTURE_INDEX_HTML },
    { name: 'docs/about.html', content: FIXTURE_ABOUT_HTML },
    { name: 'style.css', content: FIXTURE_STYLE_CSS },
    { name: 'images/logo.png', content: FIXTURE_MEDIA_BYTES.toString('base64'), encoding: 'base64' },
    { name: FIXTURE_SIDECAR_NAME, content: FIXTURE_SIDECAR_JSON },
  ];
  for (const f of files) {
    const body: Record<string, string> = { name: f.name, content: f.content };
    if (f.encoding) body.encoding = f.encoding;
    const resp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch((err: unknown) => {
      throw new Error(`POST .../files (${f.name}) network error: ${String(err)}`);
    });
    if (!resp.ok) {
      return { fixture: null, detail: `POST /api/projects/${id}/files (${f.name}) -> HTTP ${resp.status}: ${await resp.text().catch(() => '<unreadable>')}` };
    }
  }
  return { fixture: { id }, detail: 'fixture project created with 5 files (4 real + 1 sidecar negative control)' };
}

// =========================================================================
// UI wiring scan helper (C10A-4). Best-effort mechanical check, not a full
// parser: strips a naive `//` trailing comment per line and requires the
// route substring to appear near a recognizable call-site pattern. This can
// in principle be gamed by a string hidden inside an unrelated call; that
// limitation is disclosed in the PRD's Open questions, not hidden here.
// =========================================================================
function findFilesRecursive(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findFilesRecursive(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function checkUiWiring(): { ok: boolean; evidence: string } {
  const webSrc = path.join(repoRoot, 'apps/web/src');
  const files = findFilesRecursive(webSrc, ['.ts', '.tsx']);
  const needle = '/export/super-import';
  const callPattern = /\bfetch\(|\.get\(|Api\(/;
  const hits: string[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const codePart = line.split('//')[0] ?? '';
      if (!codePart.includes(needle)) continue;
      const windowStart = Math.max(0, i - 3);
      const windowEnd = Math.min(lines.length - 1, i + 3);
      const windowText = lines.slice(windowStart, windowEnd + 1).join('\n');
      if (callPattern.test(windowText)) {
        hits.push(`${path.relative(repoRoot, file)}:${i + 1}`);
      }
    }
  }
  return {
    ok: hits.length > 0,
    evidence: hits.length > 0
      ? `call-site-adjacent matches:\n${hits.join('\n')}`
      : `scanned ${files.length} apps/web/src .ts(x) files; no "${needle}" occurrence found near a fetch/.get(/Api( call site`,
  };
}

async function main(): Promise<void> {
  const placeholderWrite = writeManifestFile(buildManifest(false, true));
  if (!placeholderWrite.written) {
    console.error('verify-w10a: FATAL: could not write the initial wroteOk:false placeholder manifest -- aborting rather than risk leaving a stale prior manifest unflagged.');
    process.exit(1);
  }

  const { daemon: booted, detail: bootDetail } = await bootIsolatedDaemon();
  let fixture: FixtureProject | null = null;
  let fixtureDetail = 'daemon unavailable -- fixture project was never attempted';
  if (booted) {
    const created = await createFixtureProject(booted.url).catch((err: unknown) => ({ fixture: null, detail: `fixture creation threw: ${String(err)}` }));
    fixture = created.fixture;
    fixtureDetail = created.detail;
  }

  try {
    // -----------------------------------------------------------------
    // C10A-1: Instatic MCP template registered and live-discoverable.
    // -----------------------------------------------------------------
    await checkCriterion('C10A-1', async () => {
      if (!booted) {
        record('C10A-1', 'GET /api/mcp/servers', 'exactly one structurally-valid, discoverable Instatic MCP_TEMPLATES entry', false, '', { detail: `isolated daemon unavailable: ${bootDetail}` });
        return;
      }
      const resp = await fetch(`${booted.url}/api/mcp/servers`);
      if (!resp.ok) {
        record('C10A-1', `GET ${booted.url}/api/mcp/servers`, 'exactly one structurally-valid, discoverable Instatic MCP_TEMPLATES entry', false, '', { detail: `HTTP ${resp.status}` });
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
      for (const t of candidates) {
        const id = String(t.id ?? '');
        if (!SERVER_ID_PATTERN.test(id)) problems.push(`template id "${id}" fails SERVER_ID_PATTERN`);
        const category = String(t.category ?? '');
        if (!VALID_CATEGORIES.has(category)) problems.push(`template category "${category}" is not a valid McpTemplateCategory`);
        const label = String(t.label ?? '');
        const description = String(t.description ?? '');
        const homepage = String(t.homepage ?? '');
        if (label.trim().length < 3) problems.push(`template "${id}" label missing/too short`);
        if (description.trim().length < 20) problems.push(`template "${id}" description missing/too short (placeholder-shaped)`);
        if (!/^https?:\/\//.test(homepage)) problems.push(`template "${id}" homepage missing or not a real URL`);
        // Evidenced shape (docs/features/mcp-connectors.md in the Instatic
        // checkout, ~/projects/tools/third-party/instatic, read-only -- see
        // W10a-instatic-seam.md "Ground facts"): Streamable HTTP, endpoint
        // suffix /_instatic/mcp, personal-access-token bearer header. Not
        // MishMash's generic OAuth automation (authMode must be 'none').
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
          problems.push(`template "${id}" authMode is "${authMode}", expected "none" (personal-access-token via header, not MishMash's OAuth automation -- Instatic's hosted-OAuth mode needs public HTTPS and is deliberately out of scope, see W10a-instatic-seam.md Open questions #2)`);
        }
        const headerFields = Array.isArray(t.headerFields) ? (t.headerFields as Array<Record<string, unknown>>) : [];
        const authHeader = headerFields.find((h) => String(h.key ?? '') === 'Authorization');
        if (!authHeader) {
          problems.push(`template "${id}" has no headerFields entry with key "Authorization" for the personal access token`);
        } else {
          const hint = `${String(authHeader.placeholder ?? '')} ${String(authHeader.label ?? '')}`.toLowerCase();
          if (!hint.includes('imcp_pat')) {
            problems.push(`template "${id}" Authorization header field does not name the real token prefix "imcp_pat_..." (mcp-connectors.md:79,85) in its placeholder/label`);
          }
        }
      }
      record(
        'C10A-1',
        `GET ${booted.url}/api/mcp/servers`,
        'exactly one structurally-valid, discoverable Instatic MCP_TEMPLATES entry: transport=http, url ends with /_instatic/mcp, authMode=none, Authorization header names imcp_pat_...',
        problems.length === 0,
        problems.join('\n') || `found exactly one valid candidate: ${JSON.stringify(candidates[0])}`,
        { detail: problems.length > 0 ? `${problems.length} problem(s)` : undefined },
      );
    });

    // -----------------------------------------------------------------
    // C10A-2: Super Import export -- shape, byte fidelity, negative control.
    // -----------------------------------------------------------------
    await checkCriterion('C10A-2', async () => {
      const assertionText =
        'index.html, docs/about.html, style.css, images/logo.png present at NATURAL relative paths (no pages/tokens/media prefix), byte-identical to fixture; index.html.artifact.json sidecar excluded; route source cites Instatic\'s real 10_000-file / 1 GB size-guard constants';
      if (!booted || !fixture) {
        record('C10A-2', 'GET /api/projects/:id/export/super-import', assertionText, false, '', {
          detail: !booted ? `isolated daemon unavailable: ${bootDetail}` : `fixture project unavailable: ${fixtureDetail}`,
        });
        return;
      }
      const exportUrl = `${booted.url}/api/projects/${encodeURIComponent(fixture.id)}/export/super-import`;
      const resp = await fetch(exportUrl);
      if (!resp.ok) {
        record('C10A-2', `GET ${exportUrl}`, assertionText, false, `HTTP ${resp.status}`, {
          detail: 'route not implemented (or errored) -- expected pre-implementation',
        });
        return;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      let zip: JSZipInstance;
      try {
        zip = await JSZipMod.loadAsync(buf);
      } catch (err) {
        record('C10A-2', `GET ${exportUrl}`, 'response parses as a valid zip', false, '', { detail: `response was not a valid zip: ${String(err)}` });
        return;
      }
      const problems: string[] = [];
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
      if (sidecarLeak.length > 0) {
        problems.push(`negative control failed -- sidecar leaked into zip: ${sidecarLeak.join(', ')}`);
      }
      // No pages/tokens/media prefix should exist anywhere -- the real
      // Instatic contract (site-import.md, ingestInput.ts, classifyFiles.ts;
      // see W10a-instatic-seam.md "Ground facts") wants a flat, natural-path
      // tree. A "reshaped" implementation (the earlier, wrong design this
      // wave started from) fails this negative check even if its content is
      // otherwise byte-correct.
      const reshapedPaths = allNames.filter((n) => /^(pages|tokens|media)\//.test(n));
      if (reshapedPaths.length > 0) {
        problems.push(`export reshapes the tree into pages/tokens/media folders, which Instatic's real ingestion does not want: ${reshapedPaths.join(', ')}`);
      }
      // Source-level check: the route's own implementation must cite
      // Instatic's REAL size-guard numbers (ingestInput.ts:39-41 in the
      // Instatic checkout), not invented or absent thresholds. This does not
      // runtime-exercise the rejection path itself (see
      // W10a-instatic-seam.md "Open questions" #5).
      const routeAbsPath = path.join(repoRoot, SUPER_IMPORT_ROUTE_REL_PATH);
      let routeSource = '';
      try {
        routeSource = fs.readFileSync(routeAbsPath, 'utf8');
      } catch {
        problems.push(`could not read ${SUPER_IMPORT_ROUTE_REL_PATH} to check for Instatic's real size-guard constants`);
      }
      if (routeSource) {
        if (!INSTATIC_MAX_FILES_PATTERN.test(routeSource)) {
          problems.push(`${SUPER_IMPORT_ROUTE_REL_PATH} does not cite Instatic's real DEFAULT_MAX_FILES (10_000, ingestInput.ts:40)`);
        }
        if (!INSTATIC_MAX_BYTES_PATTERN.test(routeSource)) {
          problems.push(`${SUPER_IMPORT_ROUTE_REL_PATH} does not cite Instatic's real DEFAULT_MAX_BYTES (1024*1024*1024 / 1073741824, ingestInput.ts:39)`);
        }
      }
      record(
        'C10A-2',
        `GET ${exportUrl}`,
        assertionText,
        problems.length === 0,
        problems.join('\n') || `all ${Object.keys(EXPECTED_ZIP_ENTRIES).length} expected entries present and byte-faithful at natural paths; sidecar correctly excluded; size-guard constants cited (${allNames.length} total zip entries)`,
        { detail: problems.length > 0 ? `${problems.length} problem(s)` : undefined },
      );
    });

    // -----------------------------------------------------------------
    // C10A-3: CLI parity, real subprocess, pointed only at the isolated
    // daemon (never the 7456 default).
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
        'exec',
        'tsx',
        path.join(repoRoot, 'apps/daemon/src/cli.ts'),
        'project',
        'export-super-import',
        fixture.id,
        '--daemon-url',
        booted.url,
        '--out',
        outPath,
        '--json',
      ];
      const cliResult = sh('pnpm', cliArgs, {
        cwd: repoRoot,
        timeoutMs: 60_000,
        env: { ...process.env, OD_DAEMON_URL: booted.url },
      });
      if (cliResult.status !== 0) {
        record(
          'C10A-3',
          `pnpm ${cliArgs.join(' ')}`,
          'CLI output byte-identical to the HTTP route it wraps',
          false,
          `exit=${cliResult.status}\nstdout=${cliResult.stdout.slice(-2000)}\nstderr=${cliResult.stderr.slice(-2000)}`,
          { detail: 'od project export-super-import did not exit 0 -- subcommand likely does not exist yet (expected pre-implementation)' },
        );
        try {
          fs.rmSync(outDir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
        return;
      }
      if (!fs.existsSync(outPath)) {
        record('C10A-3', `pnpm ${cliArgs.join(' ')}`, 'CLI output byte-identical to the HTTP route it wraps', false, cliResult.stdout, {
          detail: `CLI exited 0 but did not write ${outPath}`,
        });
        try {
          fs.rmSync(outDir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
        return;
      }
      const cliBuf = fs.readFileSync(outPath);
      const cliSha = sha256Bytes(cliBuf);
      record(
        'C10A-3',
        `pnpm ${cliArgs.join(' ')}`,
        'CLI output byte-identical to the HTTP route it wraps',
        cliSha === httpSha,
        `http sha256=${httpSha}\ncli sha256=${cliSha}`,
        { detail: cliSha === httpSha ? undefined : 'CLI-saved output diverges from the HTTP route it should thinly wrap' },
      );
      try {
        fs.rmSync(outDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    });

    // -----------------------------------------------------------------
    // C10A-4: Super Import UI entry point wired (mechanical, best-effort).
    // -----------------------------------------------------------------
    await checkCriterion('C10A-4', () => {
      const { ok, evidence } = checkUiWiring();
      record(
        'C10A-4',
        'grep apps/web/src/**/*.ts(x) for "/export/super-import" near a fetch/.get(/Api( call site, outside a // comment',
        'at least one real call-site-adjacent occurrence exists (existence-of-wiring only, not visual/aesthetic review)',
        ok,
        evidence,
        { detail: ok ? undefined : 'no UI call site found -- expected pre-implementation' },
      );
    });

    // -----------------------------------------------------------------
    // C10A-5: No deeper coupling (founder-pin scope fence). Legitimately
    // vacuous pre-implementation -- see PRD "Verified baseline".
    // -----------------------------------------------------------------
    await checkCriterion('C10A-5', () => {
      const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
      if (diffResult.status !== 0) {
        record('C10A-5', `git diff --name-only ${baseCommit}...HEAD`, 'no new outbound network call or live-config auto-write in any product file this wave touched', false, diffResult.stdout, {
          detail: `git diff exited ${diffResult.status}`,
        });
        return;
      }
      const changedFiles = diffResult.stdout.trim().split('\n').filter(Boolean);
      // Scaffolding/docs are excluded: the constraint is about shipped
      // product surface, not the verifier that legitimately fetches its own
      // isolated fixture daemon, or this PRD's prose.
      const productFiles = changedFiles.filter((f) => !f.startsWith('scripts/waves/') && !f.startsWith('docs/'));
      const FORBIDDEN_PATTERN = /\bfetch\s*\(|\baxios[.(]|\bhttp\.request\s*\(|\bhttps\.request\s*\(|\bnew XMLHttpRequest\s*\(|\bwriteMcpConfig\s*\(/;
      const problems: string[] = [];
      for (const f of productFiles) {
        const abs = path.join(repoRoot, f);
        if (!fs.existsSync(abs)) continue; // deleted file
        let text: string;
        try {
          text = fs.readFileSync(abs, 'utf8');
        } catch {
          continue; // binary or unreadable -- not a source file this check applies to
        }
        const lines = text.split('\n');
        lines.forEach((line, i) => {
          if (FORBIDDEN_PATTERN.test(line)) {
            problems.push(`${f}:${i + 1}: forbidden pattern (outbound call or live-config auto-write): ${line.trim().slice(0, 160)}`);
          }
        });
      }
      record(
        'C10A-5',
        `git diff --name-only ${baseCommit}...HEAD, product paths only (scripts/waves/** and docs/** excluded)`,
        'no new outbound network call (fetch/axios/http(s).request/XMLHttpRequest) or writeMcpConfig() call in any product file this wave touched',
        problems.length === 0,
        problems.join('\n') || `${productFiles.length} product file(s) touched, 0 violations (0 files pre-implementation is expected -- vacuous pass, documented in the PRD, not a loophole: C10A-1..C10A-4 independently carry the burden of proving the features exist)`,
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
        `sha256: ${selfSha256}\nUNPINNED -- no approved-gate.sha256 present. This verifier is not tamper-protected by this check until the orchestrator pins one post-approval; see manifest.gateIntegrityPinned=false.`,
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
        detail: `no "${LEASE_KEY}" entry in leases.json@baseCommit -- expected pre-landing: this PRD proposes the lease row as text but does not edit leases.json (see W10a-instatic-seam.md "Proposed lease row"), the same self-resolving gap W9-ingest-tranche.md's ruling 3 recorded for its own PRD file`,
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
