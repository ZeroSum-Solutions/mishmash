// W8D / F-03 red spec item 3 — the version store can answer "which versions
// came from this run".
//
// Behavioural red on base d7ff39a36: `createProjectFileVersion` already works
// and already writes a manifest, but the manifest has no run identity at all,
// so there is no way to ask the question. Both halves are asserted:
//   1. a version created with `{ runId, actorName }` reports them back
//      (RED: `publicVersion` does not carry the fields);
//   2. `listProjectFileVersionsForRun` pairs the tagged entry with the entry
//      immediately before it (RED: the export does not exist).
//
// The second half is deliberately read back through a FRESH manifest read, not
// from the create call's return value. `normalizeManifestEntry`
// (`project-file-versions.ts:196-224`) rebuilds every entry field by field and
// drops anything it does not name — so a run tag that is written but not
// normalized is silently erased on the next read. That is the trap this case
// exists to catch.

import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as versions from '../src/project-file-versions.js';

type CreateOptions = Parameters<typeof versions.createProjectFileVersion>[4];

const FILE_NAME = 'page.html';
const RUN_A = 'run-w8d-a';
const RUN_B = 'run-w8d-b';

let projectsRoot = '';
const projectId = 'w8dtagging';

beforeEach(async () => {
  projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'od-w8d-tag-'));
  await mkdir(path.join(projectsRoot, projectId), { recursive: true });
});

afterEach(async () => {
  await rm(projectsRoot, { recursive: true, force: true }).catch(() => {});
});

function createOptions(runId: string, actorName: string | null): CreateOptions {
  return {
    source: 'ai',
    prompt: null,
    runId,
    actorName,
  } as unknown as CreateOptions;
}

describe('W8D: project file versions carry the run and actor that wrote them', () => {
  it('reports runId and actorName back on the created version', async () => {
    const created = await versions.createProjectFileVersion(
      projectsRoot,
      projectId,
      FILE_NAME,
      '<h1>one</h1>',
      createOptions(RUN_A, 'Devin'),
    );
    // RED on base: `publicVersion` builds a ProjectFileVersion with no run
    // identity, so both read `undefined`.
    expect((created as { runId?: string }).runId).toBe(RUN_A);
    expect((created as { actorName?: string | null }).actorName).toBe('Devin');
  });

  it('survives a manifest round-trip instead of being dropped by normalization', async () => {
    await versions.createProjectFileVersion(
      projectsRoot,
      projectId,
      FILE_NAME,
      '<h1>one</h1>',
      createOptions(RUN_A, 'Devin'),
    );
    const listed = await versions.listProjectFileVersions(projectsRoot, projectId, FILE_NAME);
    expect(listed.length).toBe(1);
    expect((listed[0] as { runId?: string }).runId).toBe(RUN_A);
    expect((listed[0] as { actorName?: string | null }).actorName).toBe('Devin');
  });

  it('pairs the run-tagged version with the one immediately before it', async () => {
    await versions.createProjectFileVersion(
      projectsRoot,
      projectId,
      FILE_NAME,
      '<h1>one</h1>',
      createOptions(RUN_A, 'Devin'),
    );
    await versions.createProjectFileVersion(
      projectsRoot,
      projectId,
      FILE_NAME,
      '<h1>two</h1>',
      createOptions(RUN_B, 'Sam'),
    );

    const listForRun = (
      versions as unknown as {
        listProjectFileVersionsForRun?: (
          root: string,
          project: string,
          runId: string,
        ) => Promise<Array<{
          fileName: string;
          before: { id: string; content: string } | null;
          after: { id: string; content: string; actorName?: string | null };
        }>>;
      }
    ).listProjectFileVersionsForRun;
    // RED on base: the export does not exist.
    expect(typeof listForRun).toBe('function');

    const entries = await listForRun!(projectsRoot, projectId, RUN_B);
    expect(entries.length).toBe(1);
    expect(entries[0]?.fileName).toBe(FILE_NAME);
    expect(entries[0]?.after.content).toBe('<h1>two</h1>');
    expect(entries[0]?.after.actorName).toBe('Sam');
    expect(entries[0]?.before?.content).toBe('<h1>one</h1>');
  });

  it('reports the LAST snapshot a run took of a file, not the first', async () => {
    // A run that writes the same file twice tags two entries with the same run
    // id. `after` must be the run's final state; `before` stays the entry
    // immediately preceding the run's FIRST tagged entry, so the pair still
    // reads "what the run found" -> "what the run left".
    await versions.createProjectFileVersion(
      projectsRoot,
      projectId,
      FILE_NAME,
      '<h1>one</h1>',
      createOptions(RUN_A, 'Devin'),
    );
    await versions.createProjectFileVersion(
      projectsRoot,
      projectId,
      FILE_NAME,
      '<h1>two</h1>',
      createOptions(RUN_B, 'Sam'),
    );
    await versions.createProjectFileVersion(
      projectsRoot,
      projectId,
      FILE_NAME,
      '<h1>three</h1>',
      createOptions(RUN_B, 'Sam'),
    );

    const entries = await versions.listProjectFileVersionsForRun(projectsRoot, projectId, RUN_B);
    expect(entries.length).toBe(1);
    // RED before the fix: `findIndex` stops at the run's first tagged entry, so
    // `after` reports '<h1>two</h1>' -- the mid-run snapshot, not the result.
    expect(entries[0]?.after.content).toBe('<h1>three</h1>');
    expect(entries[0]?.before?.content).toBe('<h1>one</h1>');
  });

  it('reports a null before for the first version a run created', async () => {
    await versions.createProjectFileVersion(
      projectsRoot,
      projectId,
      FILE_NAME,
      '<h1>one</h1>',
      createOptions(RUN_A, 'Devin'),
    );
    const listForRun = (
      versions as unknown as {
        listProjectFileVersionsForRun?: (
          root: string,
          project: string,
          runId: string,
        ) => Promise<Array<{ before: unknown | null }>>;
      }
    ).listProjectFileVersionsForRun;
    expect(typeof listForRun).toBe('function');
    const entries = await listForRun!(projectsRoot, projectId, RUN_A);
    expect(entries.length).toBe(1);
    expect(entries[0]?.before).toBeNull();
  });

  it('returns nothing for a run that touched no file', async () => {
    await versions.createProjectFileVersion(
      projectsRoot,
      projectId,
      FILE_NAME,
      '<h1>one</h1>',
      createOptions(RUN_A, 'Devin'),
    );
    const listForRun = (
      versions as unknown as {
        listProjectFileVersionsForRun?: (
          root: string,
          project: string,
          runId: string,
        ) => Promise<unknown[]>;
      }
    ).listProjectFileVersionsForRun;
    expect(typeof listForRun).toBe('function');
    expect(await listForRun!(projectsRoot, projectId, 'run-that-never-ran')).toEqual([]);
  });

  it('leaves an untagged manual save untagged instead of inventing a run', async () => {
    // `routes/project/index.ts:3999,4068,4528` call the version store with no
    // run context at all. Those call sites must keep working.
    const created = await versions.createProjectFileVersion(
      projectsRoot,
      projectId,
      FILE_NAME,
      '<h1>manual</h1>',
      { source: 'manual', promptSource: 'manual' },
    );
    expect((created as { runId?: string }).runId ?? null).toBeNull();
    expect((created as { actorName?: string | null }).actorName ?? null).toBeNull();
  });
});
