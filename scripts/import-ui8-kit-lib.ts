// Pure/testable core for scripts/import-ui8-kit.ts (F010 Phase 1).
//
// Scope (see design-templates repo AGENTS.md + the F010 PRD/audit): this is
// maintainer tooling over `mishmash-assets/` (a non-git, personal reference
// library outside this repo), the same class as `import-claude-directory.ts`
// and `vendor-fonts.ts` — no daemon route, no web surface, no `od` CLI
// subcommand. It only ever calls `.catalog/file_drop.py propose` (read-only
// classification). It never calls `file_drop.py file` — that step writes the
// private rights record and is gated on an unresolved licensing decision
// (see NOTES.md). Phase 2 (filing, committing a code kit into
// design-templates/) is explicitly out of scope for this series.
import { execFile as execFileCb } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

export const execFileAsync = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Kit id derivation
// ---------------------------------------------------------------------------

// Every one of the 19 Desktop UI8 zips carries a long trailing account-token
// segment, e.g. "fushion_NjQ3NTY5MDY2MjAzNzAwMDMyYWI5OGVl.zip" -> "fushion".
// The token is a long, separator-free base64url-ish run. Strip it so staged
// directory names stay readable; keep the whole basename (sanitized) when no
// token-shaped suffix is present rather than guessing wrong silently.
const TRAILING_TOKEN_RE = /^(.+)_[A-Za-z0-9+/=_-]{20,}$/;

export function deriveKitId(zipFileName: string): string {
  const base = zipFileName.replace(/\.zip$/i, '').trim();
  if (!base) throw new Error(`cannot derive a kit id from zip filename: ${JSON.stringify(zipFileName)}`);
  const match = TRAILING_TOKEN_RE.exec(base);
  const stripped = match?.[1] ?? base;
  const safe = stripped
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (!safe) throw new Error(`cannot derive a kit id from zip filename: ${JSON.stringify(zipFileName)}`);
  return safe;
}

// ---------------------------------------------------------------------------
// Post-extraction cruft stripping
// ---------------------------------------------------------------------------
// Audit finding: extraction must remove __MACOSX, AppleDouble files,
// .DS_Store, the 0-byte macOS "Icon\r" marker, .next, and .vercel — not
// merely .git/node_modules (the only two the original PRD named).

const STRIP_DIR_NAMES = new Set(['node_modules', '.git', '.next', '.vercel', '__MACOSX']);

/** `relPosixPath` is the path of the entry relative to the extraction root, using `/` separators. */
export function shouldStripEntry(relPosixPath: string, isDirectory: boolean): boolean {
  const parts = relPosixPath.split('/').filter(Boolean);
  if (parts.some((part) => STRIP_DIR_NAMES.has(part))) return true;
  if (isDirectory) return false;
  const leaf = parts[parts.length - 1] ?? '';
  if (leaf === '.DS_Store') return true;
  if (leaf === 'Icon' || leaf === 'Icon\r') return true;
  if (leaf.startsWith('._')) return true; // AppleDouble resource-fork shadow file
  return false;
}

// ---------------------------------------------------------------------------
// Zip listing safety validation (path traversal / absolute paths / entry
// count / path depth). Runs against `unzip -Z1` output (names only, one per
// line, directories end with "/") BEFORE anything is extracted.
// ---------------------------------------------------------------------------

export interface ZipSafetyLimits {
  maxEntries: number;
  maxPathDepth: number;
}

export const DEFAULT_ZIP_SAFETY_LIMITS: ZipSafetyLimits = {
  maxEntries: 200_000,
  maxPathDepth: 32,
};

export interface ZipSafetyResult {
  ok: boolean;
  reason?: string;
}

export function parseZipEntryNames(zipinfoStdout: string): string[] {
  return zipinfoStdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

export function validateZipEntryNames(
  names: readonly string[],
  limits: ZipSafetyLimits = DEFAULT_ZIP_SAFETY_LIMITS,
): ZipSafetyResult {
  if (names.length === 0) return { ok: false, reason: 'zip has no entries' };
  if (names.length > limits.maxEntries) {
    return { ok: false, reason: `entry count ${names.length} exceeds limit ${limits.maxEntries}` };
  }
  for (const name of names) {
    if (name.startsWith('/') || /^[A-Za-z]:[\\/]/.test(name)) {
      return { ok: false, reason: `absolute path entry rejected: ${name}` };
    }
    const segments = name.split('/').filter(Boolean);
    if (segments.includes('..')) {
      return { ok: false, reason: `path traversal entry rejected: ${name}` };
    }
    if (segments.length > limits.maxPathDepth) {
      return { ok: false, reason: `entry exceeds max path depth ${limits.maxPathDepth}: ${name}` };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Disk space guard (a coarse zip-bomb / scratch-space defense, not a byte-
// exact accounting — good enough for trusted-but-unvetted purchased kits).
// ---------------------------------------------------------------------------

export interface DiskSpaceCheck {
  ok: boolean;
  reason?: string;
  availableBytes: number;
  requiredBytes: number;
}

export function evaluateDiskSpace(
  zipSizeBytes: number,
  availableBytes: number,
  expansionSafetyMultiplier = 8,
): DiskSpaceCheck {
  const requiredBytes = zipSizeBytes * expansionSafetyMultiplier;
  if (availableBytes < requiredBytes) {
    return {
      ok: false,
      reason: `only ${availableBytes} bytes free, want ${requiredBytes} bytes headroom (zip is ${zipSizeBytes} bytes)`,
      availableBytes,
      requiredBytes,
    };
  }
  return { ok: true, availableBytes, requiredBytes };
}

// ---------------------------------------------------------------------------
// Kit shape classification: "code" (has a root package.json — one of the
// four render-check candidates) vs "design-source" (.fig/.psd/.sketch/.xd,
// no root package.json) vs "unknown" (neither signal found).
// ---------------------------------------------------------------------------

export type KitShape = 'code' | 'design-source' | 'unknown';

export interface KitSignalLocation {
  shape: KitShape;
  /** For shape "code": the directory that actually contains package.json (where a render-check must run). Null otherwise. */
  signalDir: string | null;
}

const DESIGN_SOURCE_EXTENSIONS = new Set(['.fig', '.psd', '.sketch', '.xd']);

// Breadth-first, depth-bounded: returns the signal found at the SHALLOWEST
// depth (code wins ties over design-source at the same depth), plus the
// exact directory it was found in. Bounded because real UI8 zips nest their
// payload behind wrapper directories at varying depth — confirmed against
// the real "main-file" kit, whose actual package.json sits three
// directories down (Main-File/zuzu-next-app/zuzu-next-app/package.json: an
// outer wrapper folder, the dest directory this script's own nested-zip
// extraction creates, and the zip's own internal top-level folder). Reporting
// signalDir matters as much as the shape itself: a render-check that blindly
// `npm ci`s at the staged root would find no package.json there and record a
// false "install failed" for a kit that actually has one, just nested.
export async function locateKitSignal(rootDir: string, maxDepth = 6): Promise<KitSignalLocation> {
  let level: string[] = [rootDir];
  for (let depth = 0; depth <= maxDepth && level.length > 0; depth += 1) {
    const nextLevel: string[] = [];
    let designSourceDir: string | null = null;
    for (const dir of level) {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      if (entries.some((entry) => entry.isFile() && entry.name === 'package.json')) {
        return { shape: 'code', signalDir: dir };
      }
      if (designSourceDir === null && entries.some((entry) => entry.isFile() && DESIGN_SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))) {
        designSourceDir = dir;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) nextLevel.push(path.join(dir, entry.name));
      }
    }
    if (designSourceDir !== null) return { shape: 'design-source', signalDir: null };
    level = nextLevel;
  }
  return { shape: 'unknown', signalDir: null };
}

/** Convenience wrapper over {@link locateKitSignal} for callers that only need the shape. */
export async function classifyKitShape(rootDir: string, maxDepth = 6): Promise<KitShape> {
  return (await locateKitSignal(rootDir, maxDepth)).shape;
}

// ---------------------------------------------------------------------------
// Package manager detection for the render-check (P1b). Audit finding: use
// the locked workflow, not a blind `pnpm install`.
// ---------------------------------------------------------------------------

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

export async function detectPackageManager(rootDir: string): Promise<PackageManager> {
  if (await pathExists(path.join(rootDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await pathExists(path.join(rootDir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

export interface InstallBuildCommands {
  install: { cmd: string; args: string[] };
  build: { cmd: string; args: string[] };
}

export function installBuildCommandsFor(pm: PackageManager): InstallBuildCommands {
  switch (pm) {
    case 'pnpm':
      return { install: { cmd: 'pnpm', args: ['install', '--frozen-lockfile'] }, build: { cmd: 'pnpm', args: ['run', 'build'] } };
    case 'yarn':
      return { install: { cmd: 'yarn', args: ['install', '--frozen-lockfile'] }, build: { cmd: 'yarn', args: ['run', 'build'] } };
    case 'npm':
    default:
      return { install: { cmd: 'npm', args: ['ci'] }, build: { cmd: 'npm', args: ['run', 'build'] } };
  }
}

// ---------------------------------------------------------------------------
// Render-check (P1b): the automated pass/fail oracle replacing the original
// PRD's human "say so" judgment call.
// ---------------------------------------------------------------------------

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type RunFn = (cmd: string, args: string[], opts: { cwd: string; timeoutMs: number }) => Promise<RunResult>;

export interface RenderCheckResult {
  kitId: string;
  packageManager: PackageManager;
  installOk: boolean;
  buildOk: boolean;
  pass: boolean;
  reason: string;
  installTail: string;
  buildTail: string;
}

function tail(text: string, maxChars = 4000): string {
  return text.length > maxChars ? text.slice(text.length - maxChars) : text;
}

export async function renderCheckKit(
  rootDir: string,
  kitId: string,
  run: RunFn,
  timeoutMs: number,
): Promise<RenderCheckResult> {
  const pm = await detectPackageManager(rootDir);
  const { install, build } = installBuildCommandsFor(pm);
  const installResult = await run(install.cmd, install.args, { cwd: rootDir, timeoutMs });
  if (installResult.timedOut || installResult.code !== 0) {
    return {
      kitId,
      packageManager: pm,
      installOk: false,
      buildOk: false,
      pass: false,
      reason: installResult.timedOut
        ? `install timed out after ${timeoutMs}ms`
        : `install failed (exit ${installResult.code})`,
      installTail: tail(installResult.stdout + installResult.stderr),
      buildTail: '',
    };
  }
  const buildResult = await run(build.cmd, build.args, { cwd: rootDir, timeoutMs });
  const pass = !buildResult.timedOut && buildResult.code === 0;
  return {
    kitId,
    packageManager: pm,
    installOk: true,
    buildOk: pass,
    pass,
    reason: pass
      ? 'install and build both succeeded'
      : buildResult.timedOut
        ? `build timed out after ${timeoutMs}ms`
        : `build failed (exit ${buildResult.code})`,
    installTail: tail(installResult.stdout + installResult.stderr),
    buildTail: tail(buildResult.stdout + buildResult.stderr),
  };
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

export async function isAlreadyStaged(inboxDir: string, kitId: string): Promise<boolean> {
  return pathExists(path.join(inboxDir, kitId));
}

// ---------------------------------------------------------------------------
// file_drop.py propose — dependency-injected so tests never need a real
// Python interpreter or a real mishmash-assets checkout. The real
// implementation shells out; see runFileDropPropose in import-ui8-kit.ts.
// ---------------------------------------------------------------------------

export interface ProposeReport {
  route: string | null;
  destination_parent: string | null;
  proposed_leaf: string;
  confidence: number;
  requires_confirmation: boolean;
  [key: string]: unknown;
}

export type ProposeFn = (stagedDir: string) => Promise<ProposeReport>;

// ---------------------------------------------------------------------------
// Real filesystem/process operations. Kept thin and shell-out based (matching
// this repo's existing `.catalog/file_drop.py` / `python3` precedent) rather
// than adding a new zip-library dependency for a root-level maintainer script.
// ---------------------------------------------------------------------------

/** `unzip -Z1 <zip>`: entry names only, one per line, directories end with "/". Never extracts anything. */
export async function listZipEntryNames(zipPath: string): Promise<string[]> {
  const { stdout } = await execFileAsync('unzip', ['-Z1', zipPath]);
  return parseZipEntryNames(stdout);
}

/** Parses `df -k <dir>` "Available" column (1024-byte blocks) into bytes. */
export async function availableDiskBytes(dir: string): Promise<number> {
  const { stdout } = await execFileAsync('df', ['-k', dir]);
  const lines = stdout.trim().split('\n');
  const dataLine = lines[lines.length - 1] ?? '';
  const fields = dataLine.trim().split(/\s+/);
  const availableKb = Number(fields[3]);
  if (!Number.isFinite(availableKb)) {
    throw new Error(`could not parse df -k output for ${dir}: ${JSON.stringify(stdout)}`);
  }
  return availableKb * 1024;
}

/** Extracts a zip into an existing empty destination directory. */
export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  await execFileAsync('unzip', ['-q', '-o', zipPath, '-d', destDir]);
}

export interface StripResult {
  removedCruftPaths: string[];
  removedSymlinkPaths: string[];
}

/**
 * Walks `rootDir` bottom-up, deleting cruft (node_modules/.git/.next/.vercel/
 * __MACOSX, .DS_Store, the Icon marker, AppleDouble `._*` files) and any
 * symlink found anywhere in the tree (rejected outright — this script never
 * follows or preserves a symlink from an untrusted archive).
 */
export async function stripCruftTree(rootDir: string): Promise<StripResult> {
  const removedCruftPaths: string[] = [];
  const removedSymlinkPaths: string[] = [];

  async function walk(dir: string, relDir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        await fs.rm(abs, { force: true, recursive: true });
        removedSymlinkPaths.push(rel);
        continue;
      }
      if (entry.isDirectory()) {
        if (shouldStripEntry(rel, true)) {
          await fs.rm(abs, { recursive: true, force: true });
          removedCruftPaths.push(rel);
          continue;
        }
        await walk(abs, rel);
        continue;
      }
      if (shouldStripEntry(rel, false)) {
        await fs.rm(abs, { force: true });
        removedCruftPaths.push(rel);
      }
    }
  }

  await walk(rootDir, '');
  return { removedCruftPaths, removedSymlinkPaths };
}

/** Finds nested `.zip` files remaining in the tree after cruft-stripping (breadth-first, depth-bounded). */
export async function findNestedZips(rootDir: string, maxDepth = 2): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
        found.push(abs);
      }
    }
  }

  await walk(rootDir, 0);
  return found;
}

/**
 * Best-effort embedded-thumbnail extraction for a `.fig` file. A `.fig` is
 * itself a zip container holding Figma's own render at `thumbnail.png`
 * (`.catalog/README.md`, "How previews are chosen"). Returns false (without
 * throwing) when no such entry exists — most other design-source formats
 * (.psd/.sketch/.xd) have no equivalent, and this function is never called
 * for those; the caller documents the absence rather than fabricating one.
 */
export async function extractFigThumbnail(figPath: string, destPngPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('unzip', ['-p', figPath, 'thumbnail.png'], {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (!stdout || (stdout as Buffer).length === 0) return false;
    await fs.writeFile(destPngPath, stdout as Buffer);
    return true;
  } catch {
    return false;
  }
}
