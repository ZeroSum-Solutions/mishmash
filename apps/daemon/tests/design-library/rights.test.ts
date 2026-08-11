import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { designLibraryTreeSha256, resolveCurrentDesignLibraryRights } from '../../src/design-library/rights.js';

// MM-014: `.DS_Store` is OS-generated Finder noise, not licensed-item
// content. Merely browsing a licensed folder in Finder writes/updates
// `.DS_Store`, which must never change the item's rights-authorization hash
// -- otherwise browsing the folder silently revokes an already-proven
// licence (the "Makos" bug).
describe('designLibraryTreeSha256 (MM-014 .DS_Store exclusion)', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it('hashes identically whether or not a top-level .DS_Store is present', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'od-design-library-ds-store-'));
    writeFileSync(path.join(dir, 'reference.html'), '<!doctype html><title>Kit</title>', 'utf8');

    const before = await designLibraryTreeSha256(dir);
    writeFileSync(path.join(dir, '.DS_Store'), 'finder-junk-bytes', 'utf8');
    const after = await designLibraryTreeSha256(dir);

    expect(after).toBe(before);
  });

  it('hashes identically whether or not a nested .DS_Store is present', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'od-design-library-ds-store-nested-'));
    mkdirSync(path.join(dir, 'assets'), { recursive: true });
    writeFileSync(path.join(dir, 'assets', 'logo.svg'), '<svg></svg>', 'utf8');

    const before = await designLibraryTreeSha256(dir);
    writeFileSync(path.join(dir, 'assets', '.DS_Store'), 'finder-junk-bytes', 'utf8');
    const after = await designLibraryTreeSha256(dir);

    expect(after).toBe(before);
  });

  it('a rights record captured before Finder browsed the folder still resolves after .DS_Store appears', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'od-design-library-ds-store-resolve-'));
    const itemRel = '01 Kits/makos';
    const itemDir = path.join(dir, itemRel);
    mkdirSync(itemDir, { recursive: true });
    writeFileSync(path.join(itemDir, 'reference.html'), '<!doctype html><title>Makos</title>', 'utf8');

    // Record captured before any Finder browse ever touched the folder.
    const capturedTreeSha256 = await designLibraryTreeSha256(itemDir);
    const records = {
      [itemRel]: {
        tree_sha256: capturedTreeSha256,
        allowed_use: 'licensed-source-review',
        licence_ref: 'synthetic-test-licence',
        source_url: null,
        captured_at: '2026-06-10T00:00:00.000Z',
        notes: 'Synthetic MM-014 fixture.',
      },
    };
    mkdirSync(path.join(dir, '.catalog'), { recursive: true });
    writeFileSync(path.join(dir, '.catalog', 'rights.json'), JSON.stringify({ version: 1, records }), 'utf8');
    writeFileSync(path.join(dir, 'RIGHTS.md'), [
      '# Synthetic rights ceiling',
      '<!-- OD_RIGHTS_SOURCE_LEDGER_V1',
      JSON.stringify({ version: 1, prefixes: {}, items: { [itemRel]: 'licensed-source-review' } }),
      'OD_RIGHTS_SOURCE_LEDGER_V1 -->',
      '',
    ].join('\n'), 'utf8');

    // Finder browses the licensed folder -- writes .DS_Store, changing
    // nothing about the licensed content.
    writeFileSync(path.join(itemDir, '.DS_Store'), 'finder-junk-bytes', 'utf8');

    const resolved = await resolveCurrentDesignLibraryRights(dir, itemRel);
    expect(resolved.allowedUse).toBe('licensed-source-review');
  });
});
