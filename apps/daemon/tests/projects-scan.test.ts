// Cold project-file scan cost. A scan walks the whole tree, so every syscall
// it issues per entry is multiplied by the size of the user's project. The
// assertions below pin the shape of that cost: one directory read per
// directory, one stat per reported file, and no speculative open() for a
// manifest the directory listing already proved absent.
//
// D-47 (owner ruling): `RECON/` and mirror folders stay in the project file
// list. Making the walk cheaper must never make it hide a folder.
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const fsCalls = vi.hoisted(() => ({
  stat: [] as string[],
  readFile: [] as string[],
  readdir: [] as string[],
  recording: false,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const record = (bucket: string[]) => (target: unknown) => {
    if (fsCalls.recording) bucket.push(String(target));
  };
  const noteStat = record(fsCalls.stat);
  const noteReadFile = record(fsCalls.readFile);
  const noteReaddir = record(fsCalls.readdir);
  // `stat`, `readFile` and `readdir` are overloaded, so the spies are written
  // untyped and cast back to the real signature — the same shape the design-system
  // cleanup suite uses for its `mkdir` spy.
  const spy = (
    real: (...args: never[]) => unknown,
    note: (target: unknown) => void,
  ) => vi.fn((...args: unknown[]) => {
    note(args[0]);
    return (real as (...rest: unknown[]) => unknown)(...args);
  });
  return {
    ...actual,
    stat: spy(actual.stat as never, noteStat) as unknown as typeof actual.stat,
    lstat: spy(actual.lstat as never, noteStat) as unknown as typeof actual.lstat,
    readFile: spy(actual.readFile as never, noteReadFile) as unknown as typeof actual.readFile,
    readdir: spy(actual.readdir as never, noteReaddir) as unknown as typeof actual.readdir,
  };
});

const { mkdir, mkdtemp, rm, symlink, writeFile } = await import('node:fs/promises');
const { listFiles } = await import('../src/projects.js');
const { IGNORED_PROJECT_DIR_NAMES } = await import('../src/project-ignored-dirs.js');

// A page a Vite dev server owns: the entry classifier reads the body, then
// asks whether the PROJECT is a Vite project. The second half depends on the
// project root alone, so a tree with many such pages must not ask repeatedly.
const VITE_DEV_HTML = '<!doctype html><html><body><script type="module" src="/src/main.js"></script></body></html>';

const SECTION_COUNT = 10;
const FILES_PER_SECTION = 20;

interface ScanMeasurement {
  files: Array<{ path: string; mtime: number }>;
  stat: string[];
  readFile: string[];
  readdir: string[];
}

const roots: string[] = [];
let measurement: ScanMeasurement;

async function buildFixtureTree(projectDir: string) {
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'scan-fixture', devDependencies: { typescript: '5.0.0' } }),
  );
  await writeFile(path.join(projectDir, 'index.html'), VITE_DEV_HTML);
  await writeFile(path.join(projectDir, 'alpha.html'), '<!doctype html><p>alpha</p>');
  await writeFile(
    path.join(projectDir, 'alpha.html.artifact.json'),
    JSON.stringify({ schema: 'open-design.artifact.v1', kind: 'page' }),
  );

  // D-47: both folders carry real content and must survive the walk.
  for (const folder of ['RECON', 'mirror']) {
    const dir = path.join(projectDir, folder);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${folder.toLowerCase()}-notes.md`), `# ${folder}`);
    await writeFile(path.join(dir, 'index.html'), VITE_DEV_HTML);
  }

  for (let section = 0; section < SECTION_COUNT; section += 1) {
    const dir = path.join(projectDir, `section-${String(section).padStart(2, '0')}`);
    await mkdir(dir, { recursive: true });
    for (let file = 0; file < FILES_PER_SECTION; file += 1) {
      await writeFile(path.join(dir, `file-${String(file).padStart(2, '0')}.txt`), 'x');
    }
    if (section < 2) await writeFile(path.join(dir, 'index.html'), VITE_DEV_HTML);
  }
}

beforeAll(async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'od-project-scan-cost-'));
  roots.push(root);
  const projectsRoot = path.join(root, 'projects');
  const projectId = 'scan-cost';
  await buildFixtureTree(path.join(projectsRoot, projectId));

  fsCalls.stat.length = 0;
  fsCalls.readFile.length = 0;
  fsCalls.readdir.length = 0;
  fsCalls.recording = true;
  const files = await listFiles(projectsRoot, projectId);
  fsCalls.recording = false;

  measurement = {
    files: files.map((file) => ({ path: String(file.path), mtime: Number(file.mtime) })),
    stat: [...fsCalls.stat],
    readFile: [...fsCalls.readFile],
    readdir: [...fsCalls.readdir],
  };
});

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('cold project file scan cost', () => {
  const EXPECTED_DIRECTORIES = 1 + 2 + SECTION_COUNT;
  const EXPECTED_FILES = 3 + 2 * 2 + SECTION_COUNT * FILES_PER_SECTION + 2;

  it('lists every entry, with RECON and mirror folders intact', () => {
    const paths = measurement.files.map((file) => file.path);
    expect(paths).toContain('RECON/recon-notes.md');
    expect(paths).toContain('RECON/index.html');
    expect(paths).toContain('mirror/mirror-notes.md');
    expect(paths).toContain('mirror/index.html');
    expect(paths).toHaveLength(EXPECTED_FILES);
    expect(IGNORED_PROJECT_DIR_NAMES.has('recon')).toBe(false);
    expect(IGNORED_PROJECT_DIR_NAMES.has('mirror')).toBe(false);
  });

  it('reads each directory exactly once', () => {
    expect(measurement.readdir).toHaveLength(EXPECTED_DIRECTORIES);
    expect(new Set(measurement.readdir).size).toBe(EXPECTED_DIRECTORIES);
  });

  it('stats only the entries it reports with an mtime', () => {
    const reportedWithMtime = measurement.files.filter((file) => Number.isFinite(file.mtime)).length;
    expect(reportedWithMtime).toBe(EXPECTED_FILES);
    expect(measurement.stat.length).toBeLessThanOrEqual(reportedWithMtime);
  });

  it('never reads the same file twice in one scan', () => {
    const seen = new Map<string, number>();
    for (const target of measurement.readFile) seen.set(target, (seen.get(target) ?? 0) + 1);
    const repeated = [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([target, count]) => `${path.basename(target)} read ${count} times`);
    expect(repeated).toEqual([]);
  });

  it('opens a manifest only for the entries that have one on disk', () => {
    const manifestReads = measurement.readFile.filter((target) => target.endsWith('.artifact.json'));
    // `alpha.html.artifact.json` is the only sidecar the fixture writes.
    expect(manifestReads).toHaveLength(1);
    expect(path.basename(manifestReads[0] ?? '')).toBe('alpha.html.artifact.json');
  });
});

describe('artifact manifests the directory listing reaches through a symlink', () => {
  it('still reads a sidecar that is a symlink, not a plain file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'od-project-scan-symlink-'));
    roots.push(root);
    const projectsRoot = path.join(root, 'projects');
    const projectId = 'symlinked-sidecar';
    const projectDir = path.join(projectsRoot, projectId);
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'page.html'), '<!doctype html><p>page</p>');
    await writeFile(
      path.join(projectDir, 'shared.artifact.json'),
      JSON.stringify({
        version: 1,
        kind: 'html',
        title: 'SIDECAR VIA SYMLINK',
        entry: 'page.html',
        renderer: 'html',
        status: 'complete',
        exports: ['html', 'pdf', 'zip'],
      }),
    );
    await symlink(
      path.join(projectDir, 'shared.artifact.json'),
      path.join(projectDir, 'page.html.artifact.json'),
    );

    const files = await listFiles(projectsRoot, projectId);
    const page = files.find((file) => String(file.path) === 'page.html');

    expect((page?.artifactManifest as { title?: string } | undefined)?.title)
      .toBe('SIDECAR VIA SYMLINK');
  });
});
