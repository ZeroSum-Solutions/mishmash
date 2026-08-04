import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importFigmaFromBytes } from '../src/figma/figma-import.js';
import { liftTokens, walkNode, type FigmaNode } from '../src/plugins/atoms/figma-extract.js';
import { decodeFigFile } from '../src/figma/fig-decode.js';
import { assembleCanvas, buildFig, type FigDoc } from './helpers/fig-fixture.js';

let cwd = '';

afterEach(async () => {
  vi.unstubAllGlobals();
  if (cwd) await rm(cwd, { recursive: true, force: true });
  cwd = '';
});

function paint(r: number, g: number, b: number) {
  return [{ type: 'SOLID', color: { r, g, b, a: 1 }, visible: true }];
}

function multiPageDocument(palettes: Array<Array<[number, number, number]>>): FigDoc {
  let localID = 1;
  const nodeChanges: FigDoc['nodeChanges'] = [
    { guid: { sessionID: 0, localID: 0 }, type: 'DOCUMENT', name: 'Document' },
  ];
  for (const [pageIndex, palette] of palettes.entries()) {
    const pageId = localID++;
    nodeChanges.push({
      guid: { sessionID: 0, localID: pageId },
      parentIndex: { guid: { sessionID: 0, localID: 0 }, position: `${pageIndex}` },
      type: 'CANVAS',
      name: `Style ${pageIndex + 1}`,
    });
    for (const [colorIndex, [r, g, b]] of palette.entries()) {
      const frameId = localID++;
      nodeChanges.push({
        guid: { sessionID: 0, localID: frameId },
        parentIndex: { guid: { sessionID: 0, localID: pageId }, position: `${colorIndex}` },
        type: 'FRAME',
        name: `Surface ${colorIndex + 1}`,
        size: { x: 120, y: 40 },
        fillPaints: paint(r, g, b),
      });
    }
  }
  return { nodeChanges };
}

async function importFixture(doc: FigDoc, page?: string) {
  cwd = await mkdtemp(path.join(tmpdir(), 'od-figma-pages-'));
  const bytes = await buildFig({ canvas: assembleCanvas(doc) });
  return importFigmaFromBytes(bytes, { cwd, ...(page ? { page } : {}) });
}

describe('offline .fig page style inventory', () => {
  it('reports clearly different pages as distinct styles with their own lifted tokens', async () => {
    const result = await importFixture(multiPageDocument([
      [[1, 0, 0], [0.8, 0.1, 0.1]],
      [[0, 0, 1], [0.1, 0.1, 0.8]],
    ]));

    expect(result.inventory.looksMultiStyle).toBe(true);
    expect(result.inventory.styleCount).toBe(2);
    expect(result.inventory.styles).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Style 1', distinct: true, tokens: expect.objectContaining({ colors: ['#ff0000', '#cc1a1a'] }) }),
      expect.objectContaining({ name: 'Style 2', distinct: true, tokens: expect.objectContaining({ colors: ['#0000ff', '#1a1acc'] }) }),
    ]));
  });

  it('does not call pages with a shared palette distinct styles', async () => {
    const result = await importFixture(multiPageDocument([
      [[0.2, 0.4, 1], [0.1, 0.2, 0.5]],
      [[0.2, 0.4, 1], [0.1, 0.2, 0.5]],
    ]));

    expect(result.inventory.looksMultiStyle).toBe(false);
    expect(result.inventory.styleCount).toBe(1);
    expect(result.inventory.styles.map((style) => style.distinct)).toEqual([false, false]);
  });

  it('keeps a single-page import as one style', async () => {
    const result = await importFixture(multiPageDocument([[[0.2, 0.4, 1], [0.1, 0.2, 0.5]]]));

    expect(result.inventory.looksMultiStyle).toBe(false);
    expect(result.inventory.styleCount).toBe(1);
    expect(result.inventory.styles).toHaveLength(1);
  });

  it('keeps the document-wide token file byte-identical to the existing aggregate', async () => {
    const realDate = Date;
    const fixedTime = new realDate('2026-08-04T00:00:00.000Z').valueOf();
    vi.stubGlobal('Date', class extends realDate {
      constructor(...args: ConstructorParameters<typeof realDate>) {
        super(args.length ? args[0] : fixedTime);
      }
      static now() { return fixedTime; }
    });
    const doc = multiPageDocument([
      [[1, 0, 0], [0.8, 0.1, 0.1]],
      [[0, 0, 1], [0.1, 0.1, 0.8]],
    ]);
    const bytes = await buildFig({ canvas: assembleCanvas(doc) });
    const decoded = await decodeFigFile(bytes);
    const tree: FigmaNode[] = [];
    const unsupported: Array<{ id: string; type: string; reason: string }> = [];
    walkNode(decoded.document!, undefined, tree, unsupported);
    const previousAggregate = JSON.stringify(liftTokens(tree), null, 2) + '\n';

    cwd = await mkdtemp(path.join(tmpdir(), 'od-figma-pages-'));
    await importFigmaFromBytes(bytes, { cwd });

    expect(await readFile(path.join(cwd, 'figma', 'tokens.json'), 'utf8')).toBe(previousAggregate);
  });

  it('scopes an import to one page and lifts only that page tokens', async () => {
    const result = await importFixture(multiPageDocument([
      [[1, 0, 0], [0.8, 0.1, 0.1]],
      [[0, 0, 1], [0.1, 0.1, 0.8]],
    ]), 'Style 2');

    const tokens = JSON.parse(await readFile(path.join(cwd, 'figma', 'tokens.json'), 'utf8')) as { colors: Array<{ value: string }> };
    expect(tokens.colors.map((token) => token.value)).toEqual(['#0000ff', '#1a1acc']);
    expect(result.inventory.pageCount).toBe(1);
    expect(result.inventory.styles.map((style) => style.name)).toEqual(['Style 2']);
  });
});
