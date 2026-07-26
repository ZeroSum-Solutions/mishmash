/**
 * Every "still loading" text the app can show before the workspace is usable.
 *
 * Boot passes through two of them, in order:
 *
 *   1. `Loading MishMash…` — the dynamic-import fallback in
 *      `apps/web/app/[[...slug]]/client-app.tsx`, on screen until the App
 *      chunk mounts.
 *   2. `Loading workspace…` — the in-app `CenteredLoader`
 *      (i18n `entry.loadingWorkspace`), on screen while the workspace loads.
 *
 * This is one constant because naming only one of them is worse than not
 * waiting at all. Playwright reports a locator matching zero nodes as already
 * `hidden`/`detached`, and `toHaveCount(0)` passes against it — so a wait that
 * names a string the app no longer renders returns instantly, every run, and
 * the assertions after it race the boot. That failure is invisible while the
 * machine is fast enough to win the race, which is why it survived: it passed
 * locally and went red only on loaded CI runners.
 *
 * It has already happened twice. The de-brand moved the shell text from
 * `Loading Open Design…` to `Loading MishMash…` without touching the 41 copies
 * of the old literal spread across 36 e2e files, and the follow-up sweep
 * repointed those copies at `Loading workspace…` — the other loader — leaving
 * them just as vacuous. Both times the literal and the app drifted apart
 * silently. Import this instead of writing either string inline.
 */
export const APP_LOADING_TEXT = /Loading MishMash…|Loading workspace…/;
