import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { importUi8Kit, type ImportUi8KitOptions } from './import-ui8-kit.ts';
import type { ProposeReport, RunResult } from './import-ui8-kit-lib.ts';

const execFileAsync = promisify(execFileCb);

async function buildZipFixture(files: Record<string, string>): Promise<{ zipPath: string; workDir: string }> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-cli-fixture-'));
  const srcDir = path.join(workDir, 'src');
  await mkdir(srcDir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(srcDir, relPath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  const zipPath = path.join(workDir, path.basename(workDir) + '.zip');
  await execFileAsync('zip', ['-qr', zipPath, '.'], { cwd: srcDir });
  return { zipPath, workDir };
}

function fakeProposeRecording(): { propose: (dir: string) => Promise<ProposeReport>; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    propose: async (dir: string) => {
      calls.push(dir);
      return {
        route: null,
        destination_parent: null,
        proposed_leaf: path.basename(dir),
        confidence: 0,
        requires_confirmation: true,
      };
    },
  };
}

async function makeLibraryDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-library-'));
  await mkdir(path.join(dir, '_inbox'), { recursive: true, mode: 0o700 });
  await mkdir(path.join(dir, '.catalog'), { recursive: true });
  return dir;
}

async function withCleanup(dirs: string[], fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } finally {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

test('stages a design-source kit into _inbox/<kitId>, strips cruft, and calls propose (never file)', async () => {
  const { zipPath, workDir } = await buildZipFixture({
    'landscape.fig': 'fake-fig-bytes',
    'assets/hero.jpg': 'jpg-bytes',
    '__MACOSX/._landscape.fig': 'resource-fork',
    '.DS_Store': 'ds-store',
  });
  const libraryDir = await makeLibraryDir();
  const zipWithToken = path.join(workDir, 'landscape-figma_NjQ3NTY5MDY2MjAzNzAwMDMyYWI5OGVl.zip');
  await execFileAsync('cp', [zipPath, zipWithToken]);

  await withCleanup([workDir, libraryDir], async () => {
    const { propose, calls } = fakeProposeRecording();
    const options: ImportUi8KitOptions = { libraryDir, renderCheck: false, renderCheckTimeoutMs: 60_000, dryRun: false };
    const report = await importUi8Kit(zipWithToken, options, { propose, run: async () => { throw new Error('run should not be called'); } });

    assert.equal(report.kitId, 'landscape-figma');
    assert.equal(report.shape, 'design-source');
    assert.equal(report.alreadyStaged, false);
    assert.deepEqual(calls, [path.join(libraryDir, '_inbox', 'landscape-figma')]);

    const staged = await readdir(path.join(libraryDir, '_inbox', 'landscape-figma'));
    assert.ok(staged.includes('landscape.fig'));
    assert.ok(!staged.includes('__MACOSX'));
    assert.ok(!staged.includes('.DS_Store'));

    // never a rights-mutating call: nothing in this test's fake deps has a
    // "file" mode, and the receipts only ever hold propose/render-check output.
    const receiptFiles = await readdir(path.join(libraryDir, '.catalog', 'import-ui8-kit-receipts', 'landscape-figma'));
    assert.deepEqual(receiptFiles, ['propose.json']);
  });
});

test('is idempotent: a second run against the same zip does not create a duplicate _inbox entry', async () => {
  const { zipPath, workDir } = await buildZipFixture({ 'package.json': '{}', 'src/index.ts': 'export {}' });
  const libraryDir = await makeLibraryDir();
  const zipWithToken = path.join(workDir, 'planix_NjQ3NTY5MDY2MjAzNzAwMDMyYWI5OGVl.zip');
  await execFileAsync('cp', [zipPath, zipWithToken]);

  await withCleanup([workDir, libraryDir], async () => {
    const { propose, calls } = fakeProposeRecording();
    const options: ImportUi8KitOptions = { libraryDir, renderCheck: false, renderCheckTimeoutMs: 60_000, dryRun: false };

    const first = await importUi8Kit(zipWithToken, options, { propose, run: async () => { throw new Error('unused'); } });
    assert.equal(first.alreadyStaged, false);

    const second = await importUi8Kit(zipWithToken, options, { propose, run: async () => { throw new Error('unused'); } });
    assert.equal(second.alreadyStaged, true);
    assert.ok(second.notes.some((n) => n.includes('already exists')));

    const inboxEntries = await readdir(path.join(libraryDir, '_inbox'));
    assert.deepEqual(inboxEntries.sort(), ['planix']);
    assert.equal(calls.length, 2, 'propose is safely re-run each time (read-only) but staging is not duplicated');
  });
});

test('dry-run never moves anything into _inbox/ and never calls propose', async () => {
  const { zipPath, workDir } = await buildZipFixture({ 'readme.txt': 'hello' });
  const libraryDir = await makeLibraryDir();
  const zipWithToken = path.join(workDir, 'stellar_NjQ3NTY5MDY2MjAzNzAwMDMyYWI5OGVl.zip');
  await execFileAsync('cp', [zipPath, zipWithToken]);

  await withCleanup([workDir, libraryDir], async () => {
    let proposeCalled = false;
    const options: ImportUi8KitOptions = { libraryDir, renderCheck: false, renderCheckTimeoutMs: 60_000, dryRun: true };
    const report = await importUi8Kit(zipWithToken, options, {
      propose: async () => { proposeCalled = true; throw new Error('should not be called in dry-run'); },
      run: async () => { throw new Error('unused'); },
    });

    assert.equal(proposeCalled, false);
    assert.equal(report.propose, null);
    const inboxEntries = await readdir(path.join(libraryDir, '_inbox'));
    assert.deepEqual(inboxEntries, []);
  });
});

test('extracts one level of nested archive (main-file shape) before classifying', async () => {
  const { zipPath: innerZip, workDir: innerWorkDir } = await buildZipFixture({ 'public/images/hero.png': 'png-bytes' });
  const { workDir } = await buildZipFixture({ 'documentation/old-glyphicons.txt': 'legacy' });
  const outerSrcDir = path.join(workDir, 'src');
  const nestedDir = path.join(outerSrcDir, 'Main-File');
  await mkdir(nestedDir, { recursive: true });
  await execFileAsync('cp', [innerZip, path.join(nestedDir, 'zuzu-next-app.zip')]);
  const outerZipWithToken = path.join(workDir, 'main-file_NjQ3NTY5MDY2MjAzNzAwMDMyYWI5OGVl.zip');
  await execFileAsync('zip', ['-qr', outerZipWithToken, '.'], { cwd: outerSrcDir });

  const libraryDir = await makeLibraryDir();

  await withCleanup([workDir, innerWorkDir, libraryDir], async () => {
    const { propose } = fakeProposeRecording();
    const options: ImportUi8KitOptions = { libraryDir, renderCheck: false, renderCheckTimeoutMs: 60_000, dryRun: false };
    const report = await importUi8Kit(outerZipWithToken, options, { propose, run: async () => { throw new Error('unused'); } });

    assert.deepEqual(report.nestedArchivesExpanded, [path.join('Main-File', 'zuzu-next-app')]);
    const hero = await stat(path.join(libraryDir, '_inbox', 'main-file', 'Main-File', 'zuzu-next-app', 'public', 'images', 'hero.png'));
    assert.ok(hero.isFile());
  });
});

test('render-check is skipped without --render-check, even for a code kit', async () => {
  const { zipPath, workDir } = await buildZipFixture({ 'package.json': '{}', 'package-lock.json': '{}' });
  const libraryDir = await makeLibraryDir();
  const zipWithToken = path.join(workDir, 'fushion_NjQ3NTY5MDY2MjAzNzAwMDMyYWI5OGVl.zip');
  await execFileAsync('cp', [zipPath, zipWithToken]);

  await withCleanup([workDir, libraryDir], async () => {
    const { propose } = fakeProposeRecording();
    const runCalls: Array<{ cmd: string; args: string[] }> = [];
    const run = async (cmd: string, args: string[]): Promise<RunResult> => {
      runCalls.push({ cmd, args });
      return { code: 0, stdout: 'ok', stderr: '', timedOut: false };
    };

    const withoutFlag = await importUi8Kit(zipWithToken, { libraryDir, renderCheck: false, renderCheckTimeoutMs: 60_000, dryRun: false }, { propose, run });
    assert.equal(withoutFlag.renderCheck, null);
    assert.equal(runCalls.length, 0);
    assert.ok(withoutFlag.notes.some((n) => n.includes('--render-check was not passed')));
  });
});

test('render-check is skipped for a design-source kit even when --render-check is passed', async () => {
  const { zipPath, workDir } = await buildZipFixture({ 'wyr.fig': 'fig-bytes' });
  const libraryDir = await makeLibraryDir();
  const zipWithToken = path.join(workDir, 'wyr-design-system-personalfig_NjQ3NTY5MDY2MjAzNzAwMDMyYWI5OGVl.zip');
  await execFileAsync('cp', [zipPath, zipWithToken]);

  await withCleanup([workDir, libraryDir], async () => {
    const { propose } = fakeProposeRecording();
    const runCalls: Array<{ cmd: string; args: string[] }> = [];
    const run = async (cmd: string, args: string[]): Promise<RunResult> => {
      runCalls.push({ cmd, args });
      return { code: 0, stdout: 'ok', stderr: '', timedOut: false };
    };

    const report = await importUi8Kit(zipWithToken, { libraryDir, renderCheck: true, renderCheckTimeoutMs: 60_000, dryRun: false }, { propose, run });
    assert.equal(report.shape, 'design-source');
    assert.equal(report.renderCheck, null);
    assert.equal(runCalls.length, 0);
  });
});

test('render-check runs at the actual code root, not the staged kit root, for a deeply-nested package.json (real main-file shape)', async () => {
  const { zipPath: innerZip, workDir: innerWorkDir } = await buildZipFixture({
    'zuzu-next-app/package.json': '{}',
    'zuzu-next-app/package-lock.json': '{}',
  });
  const { workDir } = await buildZipFixture({ 'documentation/old-glyphicons.txt': 'legacy' });
  const outerSrcDir = path.join(workDir, 'src');
  const nestedDir = path.join(outerSrcDir, 'Main-File');
  await mkdir(nestedDir, { recursive: true });
  await execFileAsync('cp', [innerZip, path.join(nestedDir, 'zuzu-next-app.zip')]);
  const outerZipWithToken = path.join(workDir, 'main-file_NjQ3NTY5MDY2MjAzNzAwMDMyYWI5OGVl.zip');
  await execFileAsync('zip', ['-qr', outerZipWithToken, '.'], { cwd: outerSrcDir });

  const libraryDir = await makeLibraryDir();

  await withCleanup([workDir, innerWorkDir, libraryDir], async () => {
    const { propose } = fakeProposeRecording();
    const runCalls: Array<{ cmd: string; cwd?: string }> = [];
    const run = async (cmd: string, _args: string[], opts: { cwd: string; timeoutMs: number }): Promise<RunResult> => {
      runCalls.push({ cmd, cwd: opts.cwd });
      return { code: 0, stdout: 'ok', stderr: '', timedOut: false };
    };

    const report = await importUi8Kit(
      outerZipWithToken,
      { libraryDir, renderCheck: true, renderCheckTimeoutMs: 60_000, dryRun: false },
      { propose, run },
    );

    assert.equal(report.shape, 'code');
    // The nested zip's OWN internal top-level folder is also named
    // "zuzu-next-app" (matches the real kit), so the true code root sits
    // three levels down: the outer wrapper, this script's nested-zip dest
    // dir, and the zip's own internal folder.
    assert.equal(report.codeRootRelative, path.join('Main-File', 'zuzu-next-app', 'zuzu-next-app'));
    assert.equal(report.renderCheck?.pass, true);
    const expectedCwd = path.join(libraryDir, '_inbox', 'main-file', 'Main-File', 'zuzu-next-app', 'zuzu-next-app');
    assert.ok(runCalls.length > 0, 'render-check must actually run');
    for (const call of runCalls) assert.equal(call.cwd, expectedCwd);
  });
});

test('render-check pass writes a draft stub receipt; render-check fail does not', async () => {
  const { zipPath: passZip, workDir: passWorkDir } = await buildZipFixture({ 'package.json': '{}', 'package-lock.json': '{}' });
  const { zipPath: failZip, workDir: failWorkDir } = await buildZipFixture({ 'package.json': '{}', 'package-lock.json': '{}' });
  const libraryDir = await makeLibraryDir();
  const passZipWithToken = path.join(passWorkDir, 'krafty-resources_NjQ3NTY5MDY2MjAzNzAwMDMyYWI5OGVl.zip');
  const failZipWithToken = path.join(failWorkDir, 'main-file_NjQ3NTY5MDY2MjAzNzAwMDMyYWI5OGVl.zip');
  await execFileAsync('cp', [passZip, passZipWithToken]);
  await execFileAsync('cp', [failZip, failZipWithToken]);

  await withCleanup([passWorkDir, failWorkDir, libraryDir], async () => {
    const { propose } = fakeProposeRecording();

    const passingRun = async (): Promise<RunResult> => ({ code: 0, stdout: 'ok', stderr: '', timedOut: false });
    const passReport = await importUi8Kit(
      passZipWithToken,
      { libraryDir, renderCheck: true, renderCheckTimeoutMs: 60_000, dryRun: false },
      { propose, run: passingRun },
    );
    assert.equal(passReport.renderCheck?.pass, true);
    assert.equal(passReport.draftPrepared, true);
    const passReceipts = await readdir(path.join(libraryDir, '.catalog', 'import-ui8-kit-receipts', 'krafty-resources'));
    assert.ok(passReceipts.includes('draft-template.json'));
    assert.ok(passReceipts.includes('render-check.json'));

    let callCount = 0;
    const failingRun = async (): Promise<RunResult> => {
      callCount += 1;
      return callCount === 1 ? { code: 0, stdout: 'installed', stderr: '', timedOut: false } : { code: 1, stdout: '', stderr: 'build failed', timedOut: false };
    };
    const failReport = await importUi8Kit(
      failZipWithToken,
      { libraryDir, renderCheck: true, renderCheckTimeoutMs: 60_000, dryRun: false },
      { propose, run: failingRun },
    );
    assert.equal(failReport.renderCheck?.pass, false);
    assert.equal(failReport.draftPrepared, false);
    const failReceipts = await readdir(path.join(libraryDir, '.catalog', 'import-ui8-kit-receipts', 'main-file'));
    assert.ok(!failReceipts.includes('draft-template.json'));
    assert.ok(failReceipts.includes('render-check.json'));
  });
});

test('receipts are written under .catalog/, never inside the staged _inbox/ collection tree', async () => {
  const { zipPath, workDir } = await buildZipFixture({ 'kloset.fig': 'fig-bytes' });
  const libraryDir = await makeLibraryDir();
  const zipWithToken = path.join(workDir, 'kloset-ui8-marketplacefig_NjQ3NTY5MDY2MjAzNzAwMDMyYWI5OGVl.zip');
  await execFileAsync('cp', [zipPath, zipWithToken]);

  await withCleanup([workDir, libraryDir], async () => {
    const { propose } = fakeProposeRecording();
    const report = await importUi8Kit(
      zipWithToken,
      { libraryDir, renderCheck: false, renderCheckTimeoutMs: 60_000, dryRun: false },
      { propose, run: async () => { throw new Error('unused'); } },
    );
    const stagedFiles = await readdir(path.join(libraryDir, '_inbox', report.kitId));
    assert.ok(!stagedFiles.some((f) => f.startsWith('.import-ui8-kit') || f.includes('receipt')));
    const receiptStat = await stat(path.join(libraryDir, '.catalog', 'import-ui8-kit-receipts', report.kitId, 'propose.json'));
    assert.ok(receiptStat.isFile());
  });
});
