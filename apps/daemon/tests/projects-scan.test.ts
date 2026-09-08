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

  it('one readdir per traversed directory, one stat per reported regular file, no speculative absent-manifest open, each existing sidecar/package file read at most once', () => {
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

describe('Vite dev project detection with symlinked vite.config.*', () => {
  async function setupViteSymlinkProject(projectId: string) {
    const root = await mkdtemp(path.join(tmpdir(), 'od-project-scan-vite-symlink-'));
    roots.push(root);
    const projectsRoot = path.join(root, 'projects');
    const projectDir = path.join(projectsRoot, projectId);
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: projectId, devDependencies: { typescript: '5.0.0' } }),
    );
    await writeFile(path.join(projectDir, 'index.html'), VITE_DEV_HTML);
    await writeFile(
      path.join(projectDir, 'index.html.artifact.json'),
      JSON.stringify({
        version: 1,
        kind: 'html',
        title: 'STANDALONE MANIFEST',
        entry: 'index.html',
        renderer: 'html',
        status: 'complete',
        exports: ['html'],
      }),
    );
    return { projectsRoot, projectId, projectDir };
  }

  it('accepts a symlink pointing to a regular file as a Vite config (suppressing artifact manifest)', async () => {
    const { projectsRoot, projectId, projectDir } = await setupViteSymlinkProject('symlink-file');
    const targetConfig = path.join(projectDir, 'actual.vite.config.ts');
    await writeFile(targetConfig, 'export default {};');
    await symlink(targetConfig, path.join(projectDir, 'vite.config.ts'));

    const files = await listFiles(projectsRoot, projectId);
    const index = files.find((file) => String(file.path) === 'index.html');
    expect(index).toBeDefined();
    expect(index?.artifactManifest).toBeNull();
  });

  it('rejects a symlink pointing to a directory as a Vite config (returns artifact manifest)', async () => {
    const { projectsRoot, projectId, projectDir } = await setupViteSymlinkProject('symlink-dir');
    const targetDir = path.join(projectDir, 'vite-config-folder');
    await mkdir(targetDir, { recursive: true });
    await symlink(targetDir, path.join(projectDir, 'vite.config.ts'));

    const files = await listFiles(projectsRoot, projectId);
    const index = files.find((file) => String(file.path) === 'index.html');
    expect(index).toBeDefined();
    expect((index?.artifactManifest as { title?: string } | undefined)?.title)
      .toBe('STANDALONE MANIFEST');
  });

  it('rejects a broken symlink as a Vite config (returns artifact manifest)', async () => {
    const { projectsRoot, projectId, projectDir } = await setupViteSymlinkProject('symlink-broken');
    await symlink(path.join(projectDir, 'nonexistent.vite.config.ts'), path.join(projectDir, 'vite.config.ts'));

    const files = await listFiles(projectsRoot, projectId);
    const index = files.find((file) => String(file.path) === 'index.html');
    expect(index).toBeDefined();
    expect((index?.artifactManifest as { title?: string } | undefined)?.title)
      .toBe('STANDALONE MANIFEST');
  });
});

describe('vite config symlink stat cost stays bounded', () => {
  // Every recognized vite.config.* name present as a rejected symlink (half to
  // a directory, half broken) so the loop in readsViteDevProject examines all
  // six candidates instead of stopping at the first accepted file.
  const VITE_CONFIG_FILENAMES = [
    'vite.config.js',
    'vite.config.mjs',
    'vite.config.cjs',
    'vite.config.ts',
    'vite.config.mts',
    'vite.config.cts',
  ];

  it('pays exactly one targeted stat per present symlinked candidate, capped at six, regardless of how many pages are in the tree', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'od-project-scan-vite-symlink-cost-'));
    roots.push(root);
    const projectsRoot = path.join(root, 'projects');
    const projectId = 'vite-symlink-cost';
    const projectDir = path.join(projectsRoot, projectId);
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: projectId, devDependencies: { typescript: '5.0.0' } }),
    );

    const rejectedDir = path.join(projectDir, 'not-a-config');
    await mkdir(rejectedDir, { recursive: true });
    for (const [i, name] of VITE_CONFIG_FILENAMES.entries()) {
      const target = i % 2 === 0 ? rejectedDir : path.join(projectDir, `missing-${name}`);
      await symlink(target, path.join(projectDir, name));
    }

    // Several index.html pages: the per-project answer is memoized once, so the
    // symlink-examination cost must not scale with page count (no per-tree
    // amplification).
    for (let i = 0; i < 5; i += 1) {
      const dir = path.join(projectDir, `page-${i}`);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'index.html'), VITE_DEV_HTML);
    }

    fsCalls.stat.length = 0;
    fsCalls.recording = true;
    const files = await listFiles(projectsRoot, projectId);
    fsCalls.recording = false;

    const reportedRegularFiles = files.filter((file) => Number.isFinite(Number(file.mtime))).length;
    const symlinkTargets = new Set(VITE_CONFIG_FILENAMES.map((name) => path.join(projectDir, name)));
    const symlinkStats = fsCalls.stat.filter((target) => symlinkTargets.has(target));

    expect(symlinkStats).toHaveLength(6);
    expect(new Set(symlinkStats).size).toBe(6);
    // Total cost is exactly base (one stat per reported regular file) plus the
    // bounded symlink-examination cost — never more, and never scaled by the
    // 5 pages in the tree.
    expect(fsCalls.stat.length).toBe(reportedRegularFiles + 6);
  });
});
