import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, symlink, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  DEFAULT_ZIP_SAFETY_LIMITS,
  availableDiskBytes,
  classifyKitShape,
  deriveKitId,
  detectPackageManager,
  evaluateDiskSpace,
  extractFigThumbnail,
  extractZip,
  findNestedZips,
  installBuildCommandsFor,
  isAlreadyStaged,
  listZipEntryNames,
  parseZipEntryNames,
  renderCheckKit,
  shouldStripEntry,
  stripCruftTree,
  validateZipEntryNames,
  type RunResult,
} from './import-ui8-kit-lib.ts';

const execFileAsync = promisify(execFileCb);

/** Builds a real zip fixture (via the system `zip` CLI) from a map of relPath -> content. */
async function buildZipFixture(files: Record<string, string>): Promise<{ zipPath: string; workDir: string }> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-fixture-'));
  const srcDir = path.join(workDir, 'src');
  await mkdir(srcDir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(srcDir, relPath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  const zipPath = path.join(workDir, 'fixture.zip');
  await execFileAsync('zip', ['-qr', zipPath, '.'], { cwd: srcDir });
  return { zipPath, workDir };
}

// ---------------------------------------------------------------------------
// deriveKitId
// ---------------------------------------------------------------------------

test('deriveKitId strips the trailing UI8 account token', () => {
  assert.equal(
    deriveKitId('fushion_NjQ3NTY5MDY2MjAzNzAwMDMyYWI5OGVl.zip'),
    'fushion',
  );
  assert.equal(
    deriveKitId('awesome-ios-ui-kit-psd_NjQ3NTY5MDY2MjAzNzAwMDMyYWI5OGVl.zip'),
    'awesome-ios-ui-kit-psd',
  );
  assert.equal(
    deriveKitId('kloset-ui8-marketplacefig_NjQ3NTY5MDY2MjAzNzAwMDMyYWI5OGVl.zip'),
    'kloset-ui8-marketplacefig',
  );
});

test('deriveKitId keeps the sanitized basename when no token-shaped suffix exists', () => {
  assert.equal(deriveKitId('plain-kit-name.zip'), 'plain-kit-name');
});

test('deriveKitId is deterministic and produces a safe path leaf (no slashes/dots-only)', () => {
  const id = deriveKitId('Weird Name!! (2).zip');
  assert.match(id, /^[A-Za-z0-9._-]+$/);
  assert.equal(deriveKitId('Weird Name!! (2).zip'), id);
});

test('deriveKitId throws rather than silently returning an empty id', () => {
  assert.throws(() => deriveKitId('.zip'));
});

// ---------------------------------------------------------------------------
// shouldStripEntry
// ---------------------------------------------------------------------------

test('shouldStripEntry strips node_modules, .git, .next, .vercel, __MACOSX at any depth', () => {
  assert.equal(shouldStripEntry('node_modules', true), true);
  assert.equal(shouldStripEntry('app/node_modules/foo', true), true);
  assert.equal(shouldStripEntry('.git', true), true);
  assert.equal(shouldStripEntry('a/b/.git/objects', true), true);
  assert.equal(shouldStripEntry('.next', true), true);
  assert.equal(shouldStripEntry('.vercel', true), true);
  assert.equal(shouldStripEntry('__MACOSX', true), true);
  assert.equal(shouldStripEntry('__MACOSX/._foo.png', false), true);
});

test('shouldStripEntry strips .DS_Store, the Icon marker, and AppleDouble ._* files', () => {
  assert.equal(shouldStripEntry('.DS_Store', false), true);
  assert.equal(shouldStripEntry('a/b/.DS_Store', false), true);
  assert.equal(shouldStripEntry('Icon\r', false), true);
  assert.equal(shouldStripEntry('a/._resource.psd', false), true);
});

test('shouldStripEntry keeps real project files', () => {
  assert.equal(shouldStripEntry('src/index.ts', false), false);
  assert.equal(shouldStripEntry('package.json', false), false);
  assert.equal(shouldStripEntry('assets/hero.png', false), false);
});

// ---------------------------------------------------------------------------
// zip listing safety
// ---------------------------------------------------------------------------

test('parseZipEntryNames splits unzip -Z1 output into trimmed non-empty lines', () => {
  const stdout = 'a.txt\nb/\nb/c.txt\n\n';
  assert.deepEqual(parseZipEntryNames(stdout), ['a.txt', 'b/', 'b/c.txt']);
});

test('validateZipEntryNames rejects path traversal entries', () => {
  const result = validateZipEntryNames(['ok.txt', '../../etc/passwd']);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /traversal/);
});

test('validateZipEntryNames rejects absolute path entries', () => {
  const result = validateZipEntryNames(['ok.txt', '/etc/passwd']);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /absolute/);
});

test('validateZipEntryNames rejects when entry count exceeds the limit', () => {
  const names = Array.from({ length: 5 }, (_, i) => `f${i}.txt`);
  const result = validateZipEntryNames(names, { ...DEFAULT_ZIP_SAFETY_LIMITS, maxEntries: 3 });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /entry count/);
});

test('validateZipEntryNames rejects when path depth exceeds the limit', () => {
  const deep = Array.from({ length: 5 }, (_, i) => `d${i}`).join('/') + '/file.txt';
  const result = validateZipEntryNames([deep], { ...DEFAULT_ZIP_SAFETY_LIMITS, maxPathDepth: 3 });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /max path depth/);
});

test('validateZipEntryNames accepts a normal, safe listing', () => {
  const result = validateZipEntryNames(['package.json', 'src/', 'src/index.ts', 'assets/hero.png']);
  assert.equal(result.ok, true);
});

test('validateZipEntryNames rejects an empty listing', () => {
  const result = validateZipEntryNames([]);
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// disk space guard
// ---------------------------------------------------------------------------

test('evaluateDiskSpace fails when free space is below the safety multiplier', () => {
  const result = evaluateDiskSpace(1000, 4000, 8);
  assert.equal(result.ok, false);
  assert.equal(result.requiredBytes, 8000);
});

test('evaluateDiskSpace passes when there is ample free space', () => {
  const result = evaluateDiskSpace(1000, 100_000, 8);
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// classifyKitShape
// ---------------------------------------------------------------------------

test('classifyKitShape detects a code kit from a root package.json', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-shape-'));
  try {
    await writeFile(path.join(dir, 'package.json'), '{}');
    assert.equal(await classifyKitShape(dir), 'code');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('classifyKitShape detects a design-source kit from a root .fig file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-shape-'));
  try {
    await writeFile(path.join(dir, 'landscape.fig'), 'fake-fig-bytes');
    assert.equal(await classifyKitShape(dir), 'design-source');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('classifyKitShape looks one level into a single wrapper directory (main-file shape)', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-shape-'));
  try {
    await mkdir(path.join(dir, 'documentation'));
    await mkdir(path.join(dir, 'Main-File'));
    await writeFile(path.join(dir, 'Main-File', 'package.json'), '{}');
    assert.equal(await classifyKitShape(dir), 'code');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('classifyKitShape walks past a shallow wrapper to find a package.json three levels down (real main-file shape)', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-shape-'));
  try {
    // Mirrors the real extracted tree: Main-File/ (wrapper) -> zuzu-next-app/
    // (this script's nested-zip dest dir) -> zuzu-next-app/ (the zip's own
    // internal top-level folder) -> package.json.
    await mkdir(path.join(dir, 'Main-File', 'documention'), { recursive: true });
    await writeFile(path.join(dir, 'Main-File', 'documention', 'index.html'), '<html></html>');
    const deep = path.join(dir, 'Main-File', 'zuzu-next-app', 'zuzu-next-app');
    await mkdir(deep, { recursive: true });
    await writeFile(path.join(deep, 'package.json'), '{}');
    assert.equal(await classifyKitShape(dir), 'code');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('classifyKitShape gives up past maxDepth rather than searching forever', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-shape-'));
  try {
    const tooDeep = path.join(dir, 'a', 'b', 'c', 'd', 'e', 'f', 'g');
    await mkdir(tooDeep, { recursive: true });
    await writeFile(path.join(tooDeep, 'package.json'), '{}');
    assert.equal(await classifyKitShape(dir, 3), 'unknown');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('classifyKitShape returns unknown when neither signal is present', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-shape-'));
  try {
    await writeFile(path.join(dir, 'readme.txt'), 'hi');
    assert.equal(await classifyKitShape(dir), 'unknown');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// package manager detection
// ---------------------------------------------------------------------------

test('detectPackageManager prefers the locked package manager over a blind default', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-pm-'));
  try {
    await writeFile(path.join(dir, 'pnpm-lock.yaml'), '');
    assert.equal(await detectPackageManager(dir), 'pnpm');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detectPackageManager falls back to npm when only package-lock.json (or nothing) is present', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-pm-'));
  try {
    await writeFile(path.join(dir, 'package-lock.json'), '{}');
    assert.equal(await detectPackageManager(dir), 'npm');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('installBuildCommandsFor uses the locked/frozen install form per package manager', () => {
  assert.deepEqual(installBuildCommandsFor('npm').install, { cmd: 'npm', args: ['ci'] });
  assert.deepEqual(installBuildCommandsFor('pnpm').install, { cmd: 'pnpm', args: ['install', '--frozen-lockfile'] });
  assert.deepEqual(installBuildCommandsFor('yarn').install, { cmd: 'yarn', args: ['install', '--frozen-lockfile'] });
});

// ---------------------------------------------------------------------------
// renderCheckKit
// ---------------------------------------------------------------------------

function fakeRun(script: RunResult[]): { run: (cmd: string, args: string[], opts: { cwd: string; timeoutMs: number }) => Promise<RunResult>; calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  let i = 0;
  return {
    calls,
    run: async (cmd, args) => {
      calls.push({ cmd, args });
      const result = script[i];
      i += 1;
      if (!result) throw new Error('fakeRun called more times than scripted');
      return result;
    },
  };
}

test('renderCheckKit fails fast on install failure without attempting build', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-render-'));
  try {
    await writeFile(path.join(dir, 'package-lock.json'), '{}');
    const { run, calls } = fakeRun([{ code: 1, stdout: '', stderr: 'boom', timedOut: false }]);
    const result = await renderCheckKit(dir, 'fake-kit', run, 60_000);
    assert.equal(result.pass, false);
    assert.equal(result.installOk, false);
    assert.match(result.reason, /install failed/);
    assert.equal(calls.length, 1, 'build must not run after a failed install');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('renderCheckKit reports a documented timeout, not an unhandled hang', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-render-'));
  try {
    await writeFile(path.join(dir, 'package-lock.json'), '{}');
    const { run } = fakeRun([{ code: null, stdout: '', stderr: '', timedOut: true }]);
    const result = await renderCheckKit(dir, 'fake-kit', run, 1_000);
    assert.equal(result.pass, false);
    assert.match(result.reason, /timed out/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('renderCheckKit passes only when both install and build succeed', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-render-'));
  try {
    await writeFile(path.join(dir, 'package-lock.json'), '{}');
    const { run } = fakeRun([
      { code: 0, stdout: 'installed', stderr: '', timedOut: false },
      { code: 0, stdout: 'built', stderr: '', timedOut: false },
    ]);
    const result = await renderCheckKit(dir, 'fake-kit', run, 60_000);
    assert.equal(result.pass, true);
    assert.equal(result.installOk, true);
    assert.equal(result.buildOk, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('renderCheckKit records a documented fail when build fails after a successful install', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-render-'));
  try {
    await writeFile(path.join(dir, 'package-lock.json'), '{}');
    const { run } = fakeRun([
      { code: 0, stdout: 'installed', stderr: '', timedOut: false },
      { code: 1, stdout: '', stderr: 'type error', timedOut: false },
    ]);
    const result = await renderCheckKit(dir, 'fake-kit', run, 60_000);
    assert.equal(result.pass, false);
    assert.equal(result.installOk, true);
    assert.equal(result.buildOk, false);
    assert.match(result.reason, /build failed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// idempotency
// ---------------------------------------------------------------------------

test('isAlreadyStaged is false for a fresh inbox and true once the kit directory exists', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-inbox-'));
  try {
    assert.equal(await isAlreadyStaged(dir, 'fushion'), false);
    await mkdir(path.join(dir, 'fushion'));
    assert.equal(await isAlreadyStaged(dir, 'fushion'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// real filesystem/zip operations (against real fixture zips built with the
// system `zip`/`unzip` CLIs — no mocking of the extraction path itself)
// ---------------------------------------------------------------------------

test('listZipEntryNames + validateZipEntryNames accept a normal real zip', async () => {
  const { zipPath, workDir } = await buildZipFixture({
    'package.json': '{}',
    'src/index.ts': 'export {}',
  });
  try {
    const names = await listZipEntryNames(zipPath);
    assert.ok(names.includes('package.json'));
    assert.ok(names.some((n) => n.startsWith('src/')));
    assert.equal(validateZipEntryNames(names).ok, true);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test('availableDiskBytes returns a positive number for a real directory', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-df-'));
  try {
    const bytes = await availableDiskBytes(dir);
    assert.ok(bytes > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('extractZip extracts a real zip onto disk', async () => {
  const { zipPath, workDir } = await buildZipFixture({ 'a/b.txt': 'hello' });
  const destDir = path.join(workDir, 'dest');
  try {
    await mkdir(destDir, { recursive: true });
    await extractZip(zipPath, destDir);
    const content = await readFile(path.join(destDir, 'a', 'b.txt'), 'utf8');
    assert.equal(content, 'hello');
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test('stripCruftTree removes node_modules/.git/__MACOSX/.DS_Store/Icon/AppleDouble but keeps real files', async () => {
  const { zipPath, workDir } = await buildZipFixture({
    'package.json': '{}',
    'src/index.ts': 'export {}',
    'node_modules/some-dep/index.js': 'module.exports = {}',
    '.git/HEAD': 'ref: refs/heads/main',
    '__MACOSX/._package.json': 'resource-fork-bytes',
    '.DS_Store': 'ds-store-bytes',
    'assets/._hero.png': 'resource-fork-bytes',
  });
  const destDir = path.join(workDir, 'dest');
  try {
    await mkdir(destDir, { recursive: true });
    await extractZip(zipPath, destDir);
    const result = await stripCruftTree(destDir);
    assert.ok(result.removedCruftPaths.some((p) => p.startsWith('node_modules')));
    assert.ok(result.removedCruftPaths.some((p) => p.startsWith('.git')));
    assert.ok(result.removedCruftPaths.some((p) => p.startsWith('__MACOSX')));
    assert.ok(result.removedCruftPaths.includes('.DS_Store'));
    assert.ok(result.removedCruftPaths.some((p) => p.endsWith('._hero.png')));

    const remaining = await readdir(destDir);
    assert.ok(!remaining.includes('node_modules'));
    assert.ok(!remaining.includes('.git'));
    assert.ok(!remaining.includes('__MACOSX'));
    assert.ok(!remaining.includes('.DS_Store'));
    await assert.doesNotReject(readFile(path.join(destDir, 'package.json'), 'utf8'));
    await assert.doesNotReject(readFile(path.join(destDir, 'src', 'index.ts'), 'utf8'));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test('stripCruftTree rejects (deletes) a symlink anywhere in the tree', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-symlink-'));
  try {
    await writeFile(path.join(dir, 'real.txt'), 'hi');
    await symlink(path.join(dir, 'real.txt'), path.join(dir, 'evil-link'));
    const result = await stripCruftTree(dir);
    assert.deepEqual(result.removedSymlinkPaths, ['evil-link']);
    const remaining = await readdir(dir);
    assert.ok(!remaining.includes('evil-link'));
    assert.ok(remaining.includes('real.txt'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findNestedZips finds a zip nested inside the extracted tree (main-file shape)', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-nested-'));
  try {
    const { zipPath: innerZip } = await buildZipFixture({ 'public/images/hero.png': 'bytes' });
    const nestedDir = path.join(dir, 'Main-File');
    await mkdir(nestedDir, { recursive: true });
    const nestedZipPath = path.join(nestedDir, 'zuzu-next-app.zip');
    await execFileAsync('cp', [innerZip, nestedZipPath]);

    const found = await findNestedZips(dir);
    assert.deepEqual(found, [nestedZipPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('extractFigThumbnail extracts an embedded thumbnail.png from a .fig zip container', async () => {
  const { zipPath: figLikeZip, workDir } = await buildZipFixture({ 'thumbnail.png': 'fake-png-bytes' });
  const figPath = path.join(workDir, 'kit.fig');
  const destPngPath = path.join(workDir, 'kit.thumbnail.png');
  try {
    await execFileAsync('cp', [figLikeZip, figPath]);
    const found = await extractFigThumbnail(figPath, destPngPath);
    assert.equal(found, true);
    assert.equal(await readFile(destPngPath, 'utf8'), 'fake-png-bytes');
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test('extractFigThumbnail returns false (not throw) when the .fig has no embedded thumbnail', async () => {
  const { zipPath: figLikeZip, workDir } = await buildZipFixture({ 'document.json': '{}' });
  const figPath = path.join(workDir, 'kit.fig');
  const destPngPath = path.join(workDir, 'kit.thumbnail.png');
  try {
    await execFileAsync('cp', [figLikeZip, figPath]);
    const found = await extractFigThumbnail(figPath, destPngPath);
    assert.equal(found, false);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
