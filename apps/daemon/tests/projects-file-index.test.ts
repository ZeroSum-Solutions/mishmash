import { mkdtemp, rm, writeFile as writeRawFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProjectFileWatchEvent,
  deleteProjectFile,
  listFiles,
  renameProjectFile,
  writeProjectFile,
} from '../src/projects.js';

const roots: string[] = [];

async function createProjectsRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'od-project-file-index-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('listFiles project index integration', () => {
  it('keeps cached listings current across direct write, rename, and delete operations', async () => {
    const projectsRoot = await createProjectsRoot();
    const projectId = 'project-1';

    await expect(listFiles(projectsRoot, projectId)).resolves.toEqual([]);
    await writeProjectFile(projectsRoot, projectId, 'index.html', '<main>one</main>');
    await expect(listFiles(projectsRoot, projectId)).resolves.toMatchObject([
      { path: 'index.html', size: 16 },
    ]);

    await writeProjectFile(projectsRoot, projectId, 'index.html', '<main>two is longer</main>');
    await expect(listFiles(projectsRoot, projectId)).resolves.toMatchObject([
      { path: 'index.html', size: 26 },
    ]);

    await renameProjectFile(projectsRoot, projectId, 'index.html', 'home.html');
    await expect(listFiles(projectsRoot, projectId)).resolves.toMatchObject([
      { path: 'home.html', size: 26 },
    ]);

    await deleteProjectFile(projectsRoot, projectId, 'home.html');
    await expect(listFiles(projectsRoot, projectId)).resolves.toEqual([]);
  });

  it('applies an external watcher event before the next cached listing', async () => {
    const projectsRoot = await createProjectsRoot();
    const projectId = 'project-2';

    await writeProjectFile(projectsRoot, projectId, 'index.html', '<main>one</main>');
    await listFiles(projectsRoot, projectId);
    await writeRawFile(path.join(projectsRoot, projectId, 'index.html'), '<main>external update</main>');
    await applyProjectFileWatchEvent(projectsRoot, projectId, {
      type: 'file-changed',
      path: 'index.html',
      kind: 'change',
    });

    await expect(listFiles(projectsRoot, projectId)).resolves.toMatchObject([
      { path: 'index.html', size: 28 },
    ]);
  });
});
