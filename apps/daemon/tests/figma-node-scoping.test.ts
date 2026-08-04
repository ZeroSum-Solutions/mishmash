import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFigmaExtract } from '../src/plugins/atoms/figma-extract.js';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), 'od-figma-node-scoping-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const wholeFile = {
  document: {
    id: '0:0', name: 'Document', type: 'DOCUMENT', children: [{
      id: '1:1', name: 'Page', type: 'CANVAS', children: [
        { id: '2:1', name: 'Dashboard', type: 'FRAME', children: [{ id: '3:1', name: 'Dashboard title', type: 'TEXT', characters: 'Dashboard' }] },
        { id: '2:2', name: 'Settings', type: 'FRAME', children: [{ id: '3:2', name: 'Settings title', type: 'TEXT', characters: 'Settings' }] },
      ],
    }],
  },
};

const scopedNode = {
  id: '1314:7264', name: 'Dashboard', type: 'FRAME', children: [
    { id: '1314:7265', name: 'Dashboard title', type: 'TEXT', characters: 'Dashboard' },
  ],
};

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => body,
    text: async () => '',
  } as unknown as Response;
}

describe('runFigmaExtract node and frame scoping', () => {
  it.each([
    'https://figma.com/design/ABC123/Kit?node-id=1314%3A7264',
    'https://figma.com/design/ABC123/Kit?node-id=1314-7264',
  ])('normalizes node id from %s and fetches only that node subtree', async (fileUrl) => {
    const fetchFn = vi.fn(async (_url: string) => response({ nodes: { '1314:7264': { document: scopedNode } } }));

    const report = await runFigmaExtract({ cwd, fileUrl, token: 'tok', fetchFn: fetchFn as unknown as typeof fetch });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://api.figma.com/v1/files/ABC123/nodes?ids=1314%3A7264');
    expect(report.tree.map((node) => node.id)).toEqual(['1314:7264', '1314:7265']);
    expect(report.meta.scope).toEqual({ kind: 'node', nodeId: '1314:7264' });
  });

  it('selects a top-level frame by exact name', async () => {
    const fetchFn = vi.fn(async (_url: string) => response(wholeFile));

    const report = await runFigmaExtract({ cwd, fileKey: 'ABC123', frameName: 'Settings', token: 'tok', fetchFn: fetchFn as unknown as typeof fetch });

    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://api.figma.com/v1/files/ABC123');
    expect(report.tree.map((node) => node.id)).toEqual(['2:2', '3:2']);
    expect(report.meta.scope).toEqual({ kind: 'frame', frameName: 'Settings' });
  });

  it('selects a top-level frame by case-insensitive name', async () => {
    const fetchFn = vi.fn(async (_url: string) => response(wholeFile));

    const report = await runFigmaExtract({ cwd, fileKey: 'ABC123', frameName: 'dashboard', token: 'tok', fetchFn: fetchFn as unknown as typeof fetch });

    expect(report.tree.map((node) => node.id)).toEqual(['2:1', '3:1']);
    expect(report.meta.scope).toEqual({ kind: 'frame', frameName: 'Dashboard' });
  });

  it('names the missing frame and available top-level frames in the error', async () => {
    const fetchFn = vi.fn(async (_url: string) => response(wholeFile));

    await expect(runFigmaExtract({ cwd, fileKey: 'ABC123', frameName: 'Profile', token: 'tok', fetchFn: fetchFn as unknown as typeof fetch }))
      .rejects.toThrow('frame "Profile" not found; available top-level frames: Dashboard, Settings');
  });

  it('keeps the whole-file fetch and full document walk when no scope is supplied', async () => {
    const fetchFn = vi.fn(async (_url: string) => response(wholeFile));

    const report = await runFigmaExtract({ cwd, fileKey: 'ABC123', token: 'tok', fetchFn: fetchFn as unknown as typeof fetch });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://api.figma.com/v1/files/ABC123');
    expect(report.tree.map((node) => node.id)).toEqual(['0:0', '1:1', '2:1', '3:1', '2:2', '3:2']);
    expect(report.meta.scope).toEqual({ kind: 'whole-file' });
  });
});
