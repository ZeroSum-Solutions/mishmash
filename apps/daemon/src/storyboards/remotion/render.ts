// Bundles the Remotion composition (entry.tsx) and renders it to an mp4.
//
// Assets: Remotion's asset downloader (used both for <OffthreadVideo> frame
// extraction and final audio muxing — see @remotion/renderer's
// download-and-map-assets-to-file.ts) only accepts http(s):// and data: URLs;
// a plain absolute filesystem path throws. The supported way to feed it
// caller-supplied local files that aren't part of the bundled project is
// bundle()'s `publicDir` + the composition's `staticFile()` calls, which
// resolve against Remotion's own local dev server (a real http://localhost
// origin) instead of the filesystem directly.
//
// Terra re-check (post-T1): bundle() has no cancel hook, so a stuck webpack
// compile can't be killed the way ffprobe/ffmpeg/renderMedia can — closing
// that off by making the concern non-recurring instead: bundle() runs AT
// MOST ONCE per daemon process (module-level promise cache, same
// Map<key,Promise>.finally idiom as whisper.ts's install cache, minus the
// key since there's only ever one entry point). Every request awaits the
// SAME shared promise, each racing it against its OWN withDeadline — a
// per-request timeout never cancels the shared bundle, so a hung bundle()
// just keeps 504ing every request that arrives while it's stuck, with no
// compile pile-up. On a genuine bundle() *failure* the cache is cleared so
// the next request gets a fresh attempt.
//
// This also changes where per-request assets live: bundle()'s `publicDir`
// is symlinked into the bundle ONCE (see @remotion/bundler's bundle.js —
// symlinkPublicDir creates exactly one directory-level symlink, resolved
// LIVE by the filesystem on every read, not a snapshot of today's
// contents), so it must point at a directory that survives for the whole
// process, not a per-request temp dir. Each request gets its own
// subdirectory *under* that stable public root (mkdtemp'd, cleaned up in
// this function's own `finally` — "per-request temp cleanup stays for
// everything else") and references its files via
// `staticFile("<request-subdir>/<file>")`; new subdirectories added after
// the one-time bundle() call are still served correctly because the
// symlink is live, not static. This is the standard Remotion server
// pattern (bundle once, serve per-request dynamic assets from within the
// bundled public root) and a per-request perf win on top of the safety fix.

import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { makeCancelSignal, renderMedia, selectComposition } from '@remotion/renderer';
import type { Caption } from '@remotion/captions';
import type { TimelineClip } from './timeline.js';
import { probeDurationSec } from './probe.js';
import { type Deadline, withDeadline } from './deadline.js';

const COMPOSITION_ID = 'storyboard-finish';

export interface RenderStoryboardFinishInput {
  /** Absolute paths to the ordered, already-validated done-shot clip files. */
  clipPaths: string[];
  titleEnabled: boolean;
  titleText: string;
  transitionsEnabled: boolean;
  /** Absolute path to a narration/voiceover track, already in a Remotion-playable format. */
  audioPath: string | null;
  /** Word-level captions to burn in; null when captions weren't requested. */
  captions: Caption[] | null;
  ratio: string;
  /** Absolute destination path for the rendered mp4. */
  outputPath: string;
  /** Overall finishing-pass time budget (review finding T1) — shared across every stage below. */
  deadline: Deadline;
}

/** entry.tsx source when running from src (tests, dev) or its compiled sibling once built to dist. */
function resolveEntryPoint(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const tsxPath = path.join(dir, 'entry.tsx');
  return existsSync(tsxPath) ? tsxPath : path.join(dir, 'entry.js');
}

interface BundleWorkspace {
  /** bundle()'s own return value — passed to selectComposition/renderMedia as `serveUrl`. */
  bundleLocation: string;
  /** Stable, process-lifetime directory symlinked into the bundle as its public dir. */
  publicRoot: string;
}

// PID-scoped rather than a fixed name: guarantees each daemon process gets
// its own isolated workspace (no cross-instance collision when more than
// one daemon/test-worker process runs on the same machine) and guarantees
// a fresh workspace after every restart (never reuses a stale bundle built
// against a since-changed @remotion/* version).
function bundleWorkspaceRoot(): string {
  return path.join(os.tmpdir(), `od-remotion-bundle-${process.pid}`);
}

let bundlePromise: Promise<BundleWorkspace> | null = null;

/**
 * Runs bundle() at most once for this process's lifetime; every caller
 * shares the same promise. Only a genuine bundle() *rejection* clears the
 * cache (so the next call retries) — a caller's own withDeadline racing
 * this and losing does NOT clear it, since the underlying bundle may still
 * complete just fine; that's the whole point of memoizing it.
 */
function ensureBundled(): Promise<BundleWorkspace> {
  if (bundlePromise) return bundlePromise;
  const task = (async (): Promise<BundleWorkspace> => {
    const root = bundleWorkspaceRoot();
    const publicRoot = path.join(root, 'public');
    const bundleOutDir = path.join(root, 'bundle');
    // Only reachable on the very first call, or a retry after a previous
    // failure cleared the cache below — i.e. "clean the bundle dir only
    // when (re)bundling", never per-request.
    await rm(root, { recursive: true, force: true });
    await mkdir(publicRoot, { recursive: true });
    const bundleLocation = await bundle({
      entryPoint: resolveEntryPoint(),
      publicDir: publicRoot,
      // Live directory symlink, not a snapshot — see the module doc
      // comment above for why this is what makes a one-time bundle() call
      // still see per-request subdirectories added afterward.
      symlinkPublicDir: true,
      outDir: bundleOutDir,
      // entry.tsx/composition.tsx import each other with the daemon's usual
      // NodeNext `.js`-suffixed specifiers (e.g. './composition.js') even
      // though the real file is composition.tsx — tsc requires that suffix
      // under NodeNext resolution, but webpack (which is what actually
      // bundles these two files; Node's own resolver never touches them)
      // doesn't know to try .tsx/.ts for a literal .js specifier without
      // this alias. Falls back through .tsx/.ts only when a real sibling
      // .js doesn't exist, so the compiled-dist case (where composition.tsx
      // -> composition.js really exists) still resolves normally too.
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          extensionAlias: {
            ...config.resolve?.extensionAlias,
            '.js': ['.js', '.tsx', '.ts'],
          },
        },
      }),
    });
    return { bundleLocation, publicRoot };
  })();
  bundlePromise = task;
  task.catch(() => {
    if (bundlePromise === task) bundlePromise = null;
  });
  return task;
}

/**
 * Test-only escape hatch: clears the module-level bundle() memoization so
 * each test case can exercise independent bundle behavior (hung, resolved,
 * rejected) without bleeding into the next. Never called from production
 * code paths.
 */
export function resetBundleCacheForTests(): void {
  bundlePromise = null;
}

export async function renderStoryboardFinish(input: RenderStoryboardFinishInput): Promise<void> {
  const { deadline } = input;

  deadline.assertNotExpired('bundle');
  // bundle() (webpack) has no native timeout/cancel option — the deadline
  // race below stops THIS request waiting on it past its own budget, but an
  // already-started webpack compile keeps running (that's now fine: it's
  // shared and memoized, so it isn't started again per request, and it
  // isn't stranded per request either since nothing here owns its
  // lifecycle beyond the shared cache above).
  const { bundleLocation, publicRoot } = await withDeadline(ensureBundled(), deadline, 'bundle');

  // Per-request subdirectory under the stable, symlinked public root — see
  // the module doc comment for why this (rather than a fresh top-level temp
  // dir) is what lets bundle() stay a one-time call.
  const requestPublicDir = await mkdtemp(path.join(publicRoot, 'req-'));
  const requestDirName = path.basename(requestPublicDir);

  try {
    const clips: TimelineClip[] = [];
    for (const [index, source] of input.clipPaths.entries()) {
      deadline.assertNotExpired('ffprobe');
      const fileName = path.posix.join(requestDirName, `clip-${index}${path.extname(source) || '.mp4'}`);
      await cp(source, path.join(publicRoot, fileName));
      const durationSec = await probeDurationSec(source, deadline.remainingMs());
      clips.push({ fileName, durationSec });
    }

    let audioFileName: string | null = null;
    if (input.audioPath) {
      audioFileName = path.posix.join(requestDirName, `narration${path.extname(input.audioPath) || '.wav'}`);
      await cp(input.audioPath, path.join(publicRoot, audioFileName));
    }

    const inputProps = {
      clips,
      ratio: input.ratio,
      title: { enabled: input.titleEnabled, text: input.titleText },
      transitionsEnabled: input.transitionsEnabled,
      audioFileName,
      captions: input.captions,
    };

    deadline.assertNotExpired('selectComposition');
    const composition = await withDeadline(
      selectComposition({
        serveUrl: bundleLocation,
        id: COMPOSITION_ID,
        inputProps,
        // Native ceiling in addition to the deadline race below — belt and
        // suspenders, since this call briefly runs Chrome to evaluate
        // calculateMetadata and IS cancelable this way.
        timeoutInMilliseconds: deadline.remainingMs(),
      }),
      deadline,
      'selectComposition',
    );

    deadline.assertNotExpired('renderMedia');
    // renderMedia genuinely supports cancellation via cancelSignal — wire it
    // to the same deadline so an expiry actually stops the Chrome render/
    // encode in progress instead of merely abandoning our await of it.
    const { cancelSignal, cancel } = makeCancelSignal();
    const cancelTimer = setTimeout(cancel, deadline.remainingMs());
    cancelTimer.unref?.();
    try {
      await withDeadline(
        renderMedia({
          composition,
          serveUrl: bundleLocation,
          codec: 'h264',
          outputLocation: input.outputPath,
          inputProps,
          cancelSignal,
        }),
        deadline,
        'renderMedia',
      );
    } finally {
      clearTimeout(cancelTimer);
    }
  } finally {
    // Per-request cleanup only — the stable public root and the bundle
    // output dir are process-lifetime resources, not per-request ones.
    await rm(requestPublicDir, { recursive: true, force: true });
  }
}
