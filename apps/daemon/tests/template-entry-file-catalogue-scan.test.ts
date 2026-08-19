// Catalogue-wide guard for F011.
//
// A project started from a catalogue entry must never open on a gallery-preview
// wrapper — a file whose whole body is one <iframe> pointing at the real
// artifact. Every user-installed template ships exactly that shape, and before
// the fix all of them opened a blank canvas.
//
// This scans the catalogue roots directly rather than creating 500+ projects:
// `detectTemplateEntryFile` is a pure function of a directory, and a catalogue
// entry's directory shape is what a fresh project's directory shape is copied
// from. Read-only — it never writes into either root.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { detectTemplateEntryFile } from '../src/routes/project/index.js';
import { resolveWrapperTargetOnDisk } from '../src/entry-file-wrapper.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// The shipped catalogue is in-repo and always present. The user-installed root
// is runtime data — absent on CI — so it is skipped gracefully, the same idiom
// `scripts/template-render-report.ts`'s scanOnDisk uses for the same two roots.
const SHIPPED_ROOT = path.join(repoRoot, 'design-templates');

// Two user-installed roots are worth scanning, and they are not the same place.
//
// `OD_DATA_DIR` is the daemon's own truth source, so a root under it is what a
// running daemon would actually resolve — but the test harness points that at a
// throwaway temp dir, so relying on it alone would make this suite skip exactly
// where the bug was reported. The repo-relative `.od/` is where a local dev
// daemon puts its 199 templates, and scanning it is what makes this test worth
// having on a developer machine. Whichever exists gets scanned; both are absent
// on CI, where the shipped catalogue alone still runs and is not vacuous.
const dataDirRoot =
  process.env.OD_DATA_DIR && process.env.OD_DATA_DIR.length > 0
    ? path.join(process.env.OD_DATA_DIR, 'design-templates')
    : null;
const LOCAL_DEV_ROOT = path.join(repoRoot, '.od', 'design-templates');
const CATALOGUE_ROOTS: readonly string[] = Array.from(
  new Set([SHIPPED_ROOT, LOCAL_DEV_ROOT, ...(dataDirRoot ? [dataDirRoot] : [])]),
);

function entryDirs(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

describe('catalogue entries never resolve a project to a preview wrapper', () => {
  for (const root of CATALOGUE_ROOTS) {
    const names = entryDirs(root);
    const label = path.relative(repoRoot, root);

    // An empty root means "not installed on this machine", not "nothing to
    // check" — describe.skipIf keeps that visible in the report instead of
    // silently reporting a green suite that scanned zero entries.
    describe.skipIf(names.length === 0)(`${label} (${names.length} entries)`, () => {
      it('resolves every entry to a file that is not a wrapper', async () => {
        const offenders: Array<{ entry: string; resolved: string; target: string }> = [];
        for (const name of names) {
          const dir = path.join(root, name);
          const resolved = await detectTemplateEntryFile(dir);
          if (!resolved) continue;
          const target = await resolveWrapperTargetOnDisk(dir, resolved);
          if (target) offenders.push({ entry: name, resolved, target });
        }
        expect(offenders).toEqual([]);
      }, 120_000);

      it('resolves every entry to a file that exists on disk', async () => {
        const missing: Array<{ entry: string; resolved: string }> = [];
        for (const name of names) {
          const dir = path.join(root, name);
          const resolved = await detectTemplateEntryFile(dir);
          if (!resolved) continue;
          if (!fs.existsSync(path.join(dir, ...resolved.split('/')))) {
            missing.push({ entry: name, resolved });
          }
        }
        expect(missing).toEqual([]);
      }, 120_000);
    });
  }
});

describe('the shipped catalogue keeps resolving to its authored artifacts', () => {
  const shipped = SHIPPED_ROOT;

  // The 9 entries that keep their artifact inside assets/. Their root
  // example.html is the wrong file to open even when it is substantive — and
  // for 6 of the 9 it IS substantive, which is why the literal preference in
  // detectTemplateEntryFile cannot be replaced by the wrapper shape check.
  it('prefers assets/template.html for every entry that ships one', async () => {
    const withAuthored = entryDirs(shipped).filter((name) =>
      fs.existsSync(path.join(shipped, name, 'assets', 'template.html')),
    );
    expect(withAuthored.length).toBeGreaterThan(0);
    for (const name of withAuthored) {
      await expect(detectTemplateEntryFile(path.join(shipped, name))).resolves.toBe(
        'assets/template.html',
      );
    }
  }, 120_000);

  // The dominant shape: example.html at the root IS the artifact. This is the
  // regression the wrapper check must not cause — a false positive here would
  // redirect a template to some nested file instead of the page it ships.
  it('keeps root example.html for every entry whose example.html is the artifact', async () => {
    const wrong: Array<{ entry: string; resolved: string | undefined }> = [];
    let checked = 0;
    for (const name of entryDirs(shipped)) {
      const dir = path.join(shipped, name);
      if (fs.existsSync(path.join(dir, 'assets', 'template.html'))) continue;
      if (!fs.existsSync(path.join(dir, 'example.html'))) continue;
      // Only entries whose example.html is NOT a wrapper are expected to keep
      // it; a genuine wrapper is precisely what this change redirects.
      if (await resolveWrapperTargetOnDisk(dir, 'example.html')) continue;
      checked += 1;
      const resolved = await detectTemplateEntryFile(dir);
      if (resolved !== 'example.html') wrong.push({ entry: name, resolved });
    }
    expect(checked).toBeGreaterThan(300);
    expect(wrong).toEqual([]);
  }, 120_000);
});
