// Plugin upload/import — zip and folder staging security (plugin-import).
//
// POST /api/plugins/upload-zip and /api/plugins/upload-folder (registered in
// routes/plugins/index.ts) hand the raw uploaded bytes to
// services/plugin-installation.ts before anything is installed. That module
// is the ENTIRE security boundary between a client-supplied zip entry name /
// multipart file path and the real filesystem: `safeUploadRelativePath` and
// `extractPluginZipToFolder` are what stand between an untrusted archive and
// writing outside the staging directory. No test exercises this module at
// all (server-bootstrap-regression.test.ts only asserts the routes exist).
//
// These are RED-SPEC-style proofs: each traversal/size/symlink case is
// asserted to be REJECTED, and — for the traversal case — that nothing
// landed outside the staging directory, not just that a promise rejected.

import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createPluginInstallationHelpers,
  extractPluginZipToFolder,
  safeUploadRelativePath,
} from '../src/services/plugin-installation.js';

describe('safeUploadRelativePath', () => {
  it('accepts a simple relative path and normalizes separators', () => {
    expect(safeUploadRelativePath('skill/SKILL.md')).toBe(path.join('skill', 'SKILL.md'));
  });

  it('rejects a parent-traversal path', () => {
    expect(() => safeUploadRelativePath('../secret.txt')).toThrow(/unsafe upload path/);
  });

  it('rejects a traversal segment buried mid-path', () => {
    expect(() => safeUploadRelativePath('foo/../../etc/passwd')).toThrow(/unsafe upload path/);
  });

  it('rejects an absolute POSIX path', () => {
    expect(() => safeUploadRelativePath('/etc/passwd')).toThrow(/invalid upload path/);
  });

  it('rejects a Windows absolute path even after backslash normalization', () => {
    expect(() => safeUploadRelativePath('C:\\Windows\\System32\\evil.dll')).toThrow(/invalid upload path/);
  });

  it('rejects a Windows-style traversal path (backslash separators)', () => {
    expect(() => safeUploadRelativePath('..\\..\\etc\\passwd')).toThrow(/unsafe upload path/);
  });

  it('rejects an embedded null byte', () => {
    expect(() => safeUploadRelativePath('ok.txt\0.png')).toThrow(/invalid upload path/);
  });

  it('rejects an empty path', () => {
    expect(() => safeUploadRelativePath('')).toThrow(/invalid upload path/);
  });
});

describe('extractPluginZipToFolder', () => {
  let stagedFolder: string;
  let outsideMarker: string;

  afterEach(async () => {
    if (stagedFolder) await rm(stagedFolder, { recursive: true, force: true }).catch(() => {});
    if (outsideMarker) await rm(outsideMarker, { force: true }).catch(() => {});
  });

  // Discovery while writing this spec: JSZip's own `generateAsync`/`loadAsync`
  // round-trip already collapses a `../` entry name against the archive
  // root — `zip.file('../marker.txt', ...)` round-trips as the entry name
  // "marker.txt", not "../marker.txt" (verified directly against the `jszip`
  // dependency, including a raw hand-built ZIP central directory to rule out
  // JSZip's OWN writer being the thing doing the sanitizing). So a zip built
  // with any zip-writing tool that produces a spec-valid central directory
  // can never hand `extractPluginZipToFolder` a `..`-bearing entry name in
  // the first place — `safeUploadRelativePath`'s traversal check on the zip
  // path is real defense-in-depth, but not independently provable by
  // mutating our own source (the containment for THIS input class holds
  // even with that check deleted, because the malicious segment never
  // survives to reach it). This test locks in the observed-safe outcome;
  // the mutation-provable traversal guard for plugin uploads lives in the
  // `stageUploadedPluginFolder` specs below, where a client-supplied `paths`
  // entry reaches `safeUploadRelativePath` with no zip-format normalization
  // in front of it.
  it('contains a zip entry whose written name used a traversal prefix (JSZip strips it before extraction sees it)', async () => {
    stagedFolder = await mkdtemp(path.join(os.tmpdir(), 'od-plugin-zip-security-'));
    const markerName = `escaped-${randomUUID()}.txt`;
    outsideMarker = path.join(path.dirname(stagedFolder), markerName);

    const zip = new JSZip();
    zip.file(`../${markerName}`, 'PWNED');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await extractPluginZipToFolder(buffer, stagedFolder, 50 * 1024 * 1024);

    // Landed safely inside the staging dir under the normalized name...
    const landed = await stat(path.join(stagedFolder, markerName));
    expect(landed.isFile()).toBe(true);
    // ...and never one level up, where the traversal was aimed.
    await expect(stat(outsideMarker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a zip entry that is a symbolic link instead of following it', async () => {
    stagedFolder = await mkdtemp(path.join(os.tmpdir(), 'od-plugin-zip-security-'));
    const zip = new JSZip();
    // A symlink zip entry whose target points at an absolute path outside
    // the staging dir. unixPermissions must be written with platform:'UNIX'
    // for the S_IFLNK bit to round-trip through loadAsync.
    zip.file('sneaky-link', '/etc/passwd', { unixPermissions: 0o120777 });
    const buffer = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' });

    await expect(
      extractPluginZipToFolder(buffer, stagedFolder, 50 * 1024 * 1024),
    ).rejects.toThrow(/symbolic link/);
  });

  it('rejects a zip whose extracted (decompressed) content exceeds the byte cap', async () => {
    stagedFolder = await mkdtemp(path.join(os.tmpdir(), 'od-plugin-zip-security-'));
    const zip = new JSZip();
    // Highly-compressible content: DEFLATE shrinks the on-disk zip buffer to
    // well under maxBytes, so only the in-loop EXTRACTED-size accumulator
    // (not the upfront `buffer.length > maxBytes` guard) can catch this —
    // isolating the specific check this test targets.
    zip.file('big.bin', Buffer.alloc(2000, 9), { compression: 'DEFLATE' });
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    expect(buffer.length).toBeLessThan(500);

    await expect(extractPluginZipToFolder(buffer, stagedFolder, 500)).rejects.toThrow(
      /extracted size exceeds/,
    );
  });

  it('rejects an empty zip archive', async () => {
    stagedFolder = await mkdtemp(path.join(os.tmpdir(), 'od-plugin-zip-security-'));
    const zip = new JSZip();
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(
      extractPluginZipToFolder(buffer, stagedFolder, 50 * 1024 * 1024),
    ).rejects.toThrow(/no files/);
  });

  it('accepts a well-formed plugin zip and writes it under the staging directory', async () => {
    stagedFolder = await mkdtemp(path.join(os.tmpdir(), 'od-plugin-zip-security-'));
    const zip = new JSZip();
    zip.file('SKILL.md', '# My Plugin\n');
    zip.file('assets/icon.svg', '<svg></svg>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await extractPluginZipToFolder(buffer, stagedFolder, 50 * 1024 * 1024);

    const entries = await readdir(stagedFolder);
    expect(entries.sort()).toEqual(['SKILL.md', 'assets']);
  });
});

// POST /api/plugins/upload-folder sends a `paths[]` field alongside each
// multipart file part (routes/plugins/index.ts's `helpers.pluginUpload
// .array('files', 500)`), and `stageUploadedPluginFolder` writes each file
// at `path.join(stagedFolder, safeUploadRelativePath(paths[i] ||
// file.originalname))`. Unlike the zip-entry path above, NOTHING normalizes
// `paths[i]` before it reaches `safeUploadRelativePath` — it is a raw
// client-supplied string — so this is the genuinely reachable, mutation-
// provable traversal surface for plugin uploads.
describe('stageUploadedPluginFolder', () => {
  function fakeHelpers() {
    // installFromLocalFolder must never be reached by the traversal/size
    // specs below: staging fails before finishUploadedPluginInstall ever
    // calls it. It throws if invoked, so an unexpected call surfaces as a
    // loud test failure instead of a silent false-positive.
    async function* neverCalled(): AsyncIterable<{ kind?: string; message?: string }> {
      throw new Error('installFromLocalFolder must not run when staging itself rejects');
      // eslint-disable-next-line no-unreachable
      yield { kind: 'error' };
    }
    return createPluginInstallationHelpers({
      db: { prepare: () => ({ all: () => [], get: () => undefined, run: () => undefined }) },
      installFromLocalFolder: neverCalled,
      PLUGIN_REGISTRY_ROOTS: [],
      PLUGIN_LOCKFILE_PATH: path.join(os.tmpdir(), 'od-plugin-lockfile-unused.json'),
      PLUGIN_UPLOAD_MAX_BYTES: 50 * 1024 * 1024,
    });
  }

  it('rejects a client-supplied paths[] entry that traverses out of the staging directory', async () => {
    const { stageUploadedPluginFolder } = fakeHelpers();
    const files = [{ buffer: Buffer.from('PWNED'), originalname: 'harmless.txt' }];
    await expect(
      stageUploadedPluginFolder(files, ['../../../../etc/passwd']),
    ).rejects.toThrow(/unsafe upload path/);
  });

  it('rejects a traversal in the fallback originalname when paths[] is omitted', async () => {
    const { stageUploadedPluginFolder } = fakeHelpers();
    const files = [{ buffer: Buffer.from('PWNED'), originalname: '../../etc/passwd' }];
    await expect(stageUploadedPluginFolder(files, undefined)).rejects.toThrow(/unsafe upload path/);
  });

  it('rejects an absolute paths[] entry', async () => {
    const { stageUploadedPluginFolder } = fakeHelpers();
    const files = [{ buffer: Buffer.from('PWNED'), originalname: 'harmless.txt' }];
    await expect(stageUploadedPluginFolder(files, ['/etc/passwd'])).rejects.toThrow(/invalid upload path/);
  });

  it('rejects a folder upload once the running byte total exceeds PLUGIN_UPLOAD_MAX_BYTES', async () => {
    async function* neverCalled(): AsyncIterable<{ kind?: string; message?: string }> {
      throw new Error('installFromLocalFolder must not run when the size cap rejects first');
      // eslint-disable-next-line no-unreachable
      yield { kind: 'error' };
    }
    const helpers = createPluginInstallationHelpers({
      db: { prepare: () => ({ all: () => [], get: () => undefined, run: () => undefined }) },
      installFromLocalFolder: neverCalled,
      PLUGIN_REGISTRY_ROOTS: [],
      PLUGIN_LOCKFILE_PATH: path.join(os.tmpdir(), 'od-plugin-lockfile-unused.json'),
      PLUGIN_UPLOAD_MAX_BYTES: 10,
    });
    const files = [{ buffer: Buffer.alloc(11, 1), originalname: 'too-big.bin' }];
    await expect(helpers.stageUploadedPluginFolder(files, undefined)).rejects.toThrow(
      /folder upload exceeds/,
    );
  });
});
