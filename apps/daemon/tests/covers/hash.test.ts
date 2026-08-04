// Transitive content hash (C4-3 / C4-4). Real files on a real temp
// directory -- no mocked filesystem.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeTransitiveSourceHash } from '../../src/covers/hash.js';

let dir = '';

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'od-covers-hash-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(relPath: string, content: string | Buffer): Promise<void> {
  const abs = path.join(dir, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}

describe('computeTransitiveSourceHash', () => {
  it('changes when the entry HTML changes', async () => {
    await write('index.html', '<html><body>v1</body></html>');
    const before = await computeTransitiveSourceHash(dir, 'index.html');
    await write('index.html', '<html><body>v2</body></html>');
    const after = await computeTransitiveSourceHash(dir, 'index.html');
    expect(after.sourceHash).not.toBe(before.sourceHash);
  });

  it('changes when a linked local CSS file changes but index.html does not', async () => {
    await write('index.html', '<html><head><link rel="stylesheet" href="styles.css"></head><body>x</body></html>');
    await write('styles.css', 'body{background:#000}');
    const before = await computeTransitiveSourceHash(dir, 'index.html');
    await write('styles.css', 'body{background:#fff}');
    const after = await computeTransitiveSourceHash(dir, 'index.html');
    expect(after.sourceHash).not.toBe(before.sourceHash);
  });

  it('changes when a linked local image changes but index.html and CSS do not', async () => {
    await write('index.html', '<html><body><img src="hero.png"></body></html>');
    await write('hero.png', Buffer.from('fake-png-v1'));
    const before = await computeTransitiveSourceHash(dir, 'index.html');
    await write('hero.png', Buffer.from('fake-png-v2'));
    const after = await computeTransitiveSourceHash(dir, 'index.html');
    expect(after.sourceHash).not.toBe(before.sourceHash);
  });

  it('changes when a font file referenced via @font-face changes', async () => {
    await write('index.html', '<html><head><link rel="stylesheet" href="styles.css"></head><body>x</body></html>');
    await write('styles.css', "@font-face{font-family:'X';src:url('font.woff2') format('woff2');}");
    await write('font.woff2', Buffer.from('font-v1'));
    const before = await computeTransitiveSourceHash(dir, 'index.html');
    await write('font.woff2', Buffer.from('font-v2'));
    const after = await computeTransitiveSourceHash(dir, 'index.html');
    expect(after.sourceHash).not.toBe(before.sourceHash);
  });

  it('is stable across repeated calls when nothing changed', async () => {
    await write('index.html', '<html><body>stable</body></html>');
    const a = await computeTransitiveSourceHash(dir, 'index.html');
    const b = await computeTransitiveSourceHash(dir, 'index.html');
    expect(a.sourceHash).toBe(b.sourceHash);
  });

  it('never follows a remote URL, data: URI, or protocol-relative reference', async () => {
    await write(
      'index.html',
      `<html><head>
        <link rel="stylesheet" href="https://evil.example.com/tracker.css">
        <link rel="stylesheet" href="//evil.example.com/protocol-relative.css">
      </head><body>
        <img src="data:image/png;base64,AAAA">
      </body></html>`,
    );
    const result = await computeTransitiveSourceHash(dir, 'index.html');
    expect(result.files).toEqual(['index.html']);
  });

  it('produces a hash at least 8 characters long (contract minimum)', async () => {
    await write('index.html', '<html></html>');
    const result = await computeTransitiveSourceHash(dir, 'index.html');
    expect(result.sourceHash.length).toBeGreaterThanOrEqual(8);
  });
});
