// Registration-validity guard for the bundled catalog (pairs with the
// gallery roster pin in apps/web/tests/plugins-home/bundled-roster.test.ts).
//
// The roster pin counts manifests by JSON-parsing them, but daemon
// registration additionally rejects unsafe folder names and
// schema-invalid manifests (apps/daemon/src/plugins/bundled.ts
// registerOne → resolvePluginFolder → parseManifest). A manifest that
// fails those gates would satisfy the roster count while never reaching
// `installed_plugins` or the gallery. This repo-resource check closes
// that gap: every bundled manifest folder, in BOTH layouts the daemon
// walker registers (direct plugins/_official/<plugin>/ and tiered
// plugins/_official/<tier>/<plugin>/), must clear the same two gates.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parseManifest } from '@open-design/plugin-runtime';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const bundledRoot = path.join(repoRoot, 'plugins', '_official');

// Mirrors SAFE_BASENAME in apps/daemon/src/plugins/bundled.ts:61 — the
// daemon skips (with a warning) any bundled folder that fails this.
const SAFE_BASENAME = /^[a-z0-9][a-z0-9._-]*$/;

interface ManifestFolder {
  folderId: string;
  manifestPath: string;
}

async function bundledManifestFolders(): Promise<ManifestFolder[]> {
  const folders: ManifestFolder[] = [];
  for (const tier of await readdir(bundledRoot, { withFileTypes: true })) {
    if (!tier.isDirectory()) continue;
    const tierDir = path.join(bundledRoot, tier.name);
    const directManifest = path.join(tierDir, 'open-design.json');
    if (await readFile(directManifest, 'utf8').then(() => true, () => false)) {
      folders.push({ folderId: tier.name, manifestPath: directManifest });
      continue;
    }
    for (const entry of await readdir(tierDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(tierDir, entry.name, 'open-design.json');
      const exists = await readFile(manifestPath, 'utf8').then(() => true, () => false);
      if (!exists) continue; // asset folder without a manifest
      folders.push({ folderId: entry.name, manifestPath });
    }
  }
  return folders;
}

describe('bundled manifest validity', () => {
  it('every bundled manifest clears the daemon registration gates', async () => {
    const folders = await bundledManifestFolders();
    // Keep this in sync with the roster pin (80 visible + 19 flows + 13 atoms).
    expect(folders.length).toBe(112);

    for (const { folderId, manifestPath } of folders) {
      expect(
        SAFE_BASENAME.test(folderId.toLowerCase()),
        `${folderId} must be a registration-safe folder id`,
      ).toBe(true);

      const raw = await readFile(manifestPath, 'utf8');
      const parsed = parseManifest(raw);
      expect(
        parsed.ok,
        `${path.relative(repoRoot, manifestPath)} must parse: ${parsed.ok ? '' : parsed.errors.join('; ')}`,
      ).toBe(true);
      if (parsed.ok) {
        expect(parsed.manifest.name, `${folderId} manifest must declare a name`).toBeTruthy();
      }

      // `publishedAt` is the stable fresh-install signal for the gallery's
      // Newest sort (apps/web sortOrder.ts); an unparseable value silently
      // degrades ordering to per-machine seed timestamps.
      const { publishedAt } = JSON.parse(raw) as { publishedAt?: unknown };
      if (publishedAt !== undefined) {
        expect(
          Number.isFinite(Date.parse(String(publishedAt))),
          `${folderId} publishedAt must be a parseable timestamp, got ${JSON.stringify(publishedAt)}`,
        ).toBe(true);
      }
    }
  });
});
