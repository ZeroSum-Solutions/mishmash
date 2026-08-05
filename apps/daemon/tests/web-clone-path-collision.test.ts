import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Path/directory collision: a mirrored site can serve a URL as BOTH a page
// and a directory prefix (Shopify's `/account` alongside `/account/login`,
// `/products` alongside `/products/<handle>`, etc). On disk, one wants a FILE
// at `site/account`, the other wants a DIRECTORY there -- whichever mirror-
// site.mjs's capture pass writes second used to lose:
//
//   - `fs.writeFileSync` onto an existing directory throws EISDIR.
//   - `fs.mkdirSync` beneath an existing file throws ENOTDIR.
//
// Both were swallowed by mirror-site.mjs's bare `catch`, so the losing page's
// bytes silently never land. The two gates below are where that loss becomes
// externally observable without needing a live browser/Playwright capture
// pass:
//
//   - mirror-manifest.mjs's `isCaptured` decides whether a page still needs
//     fetching. It used to treat ANY existing filesystem entry at the
//     manifest's local path as "captured", including a directory that is
//     only the *sibling* page's container -- so a page whose own write was
//     lost is never retried, and the completeness gate reports a finished
//     mirror that is actually missing content.
//   - static-server.mjs's `resolveRequestPath` decides what a served mirror
//     answers for `/account`. When `/account`'s own content is stored at
//     `account/index.html` (the directory-index convention the fix adopts),
//     the pre-fix resolver has no directory-index fallback and returns the
//     bare directory path, which the server then 404s.
//
// Both tests below construct the on-disk shape a correct capture pass
// produces (or, for the manifest test, the shape a LOST capture leaves
// behind) and assert against the resolved read, not against any particular
// write-path implementation -- so they hold regardless of how the fix
// reconciles the collision at write time.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const mirrorManifestScriptPath = path.join(
  repoRoot,
  'skills',
  'web-clone',
  'scripts',
  'lib',
  'mirror-manifest.mjs',
);
const staticServerScriptPath = path.join(
  repoRoot,
  'skills',
  'web-clone',
  'scripts',
  'lib',
  'static-server.mjs',
);

async function loadMirrorManifest() {
  return (await import(pathToFileURL(mirrorManifestScriptPath).href)) as {
    isCaptured: (input: {
      siteDir: string;
      manifest: { get: (url: string) => string | undefined };
      url: string;
    }) => boolean;
  };
}

async function loadStaticServer() {
  return (await import(pathToFileURL(staticServerScriptPath).href)) as {
    resolveRequestPath: (siteRoot: string, requestPath: string) => string | null;
  };
}

describe('path/directory collision (/account vs /account/login)', () => {
  let siteDir: string;

  beforeEach(() => {
    siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-clone-path-collision-'));
  });

  afterEach(() => {
    fs.rmSync(siteDir, { recursive: true, force: true });
  });

  it('isCaptured does not treat a directory shell (holding only the sibling page) as the page itself being captured', async () => {
    const { isCaptured } = await loadMirrorManifest();

    // The collision left only `/account/login`'s bytes on disk: writing
    // `account/login/index.html` created the `account/` directory, and the
    // separate attempt to write `/account`'s own bytes to that same path
    // silently failed (EISDIR), so `account/index.html` was never created.
    fs.mkdirSync(path.join(siteDir, 'account', 'login'), { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'account', 'login', 'index.html'), '<html>login</html>');

    const manifest = { get: () => 'account' };

    const captured = isCaptured({ siteDir, manifest, url: 'https://example.com/account' });

    // A bare `existsSync(dest) && statSync(dest).size > 0` is true for a
    // directory (a dir's `size` is its non-zero block size) -- that false
    // positive is exactly what let the completeness gate mark `/account` as
    // finished when its own page content was never written.
    expect(captured).toBe(false);
  });

  it('resolveRequestPath serves the directory-index page when a captured page URL is also a directory prefix', async () => {
    const { resolveRequestPath } = await loadStaticServer();

    // The shape a *correct* capture pass produces once the collision is
    // reconciled: `/account`'s own page lives at `account/index.html`
    // (sibling to the `login/` it contains), following the same
    // directory-index convention every real static host uses.
    fs.mkdirSync(path.join(siteDir, 'account', 'login'), { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'account', 'index.html'), '<html>account</html>');
    fs.writeFileSync(path.join(siteDir, 'account', 'login', 'index.html'), '<html>login</html>');

    const resolved = resolveRequestPath(siteDir, '/account');

    // Pre-fix, `resolveRequestPath` has no directory-index fallback: it
    // returns the bare `account/` directory path, which the server then
    // treats as a 404 (`fs.statSync(file).isFile()` is false for a
    // directory) even though the page is sitting right there at
    // `account/index.html`.
    expect(resolved).toBe(path.join(siteDir, 'account', 'index.html'));
  });
});
