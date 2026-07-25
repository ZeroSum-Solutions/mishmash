# Fork pin policy — MishMash

**Decision (founder, 2026-07-23):** this repository is a HARD-PINNED fork of
nexu-io/open-design, frozen at commit `b9f550854` — our last full upstream sync
(branch `merge/upstream-v0.15.1`, 2026-07-22). We own it. It is the MishMash
studio: the one-stop workbench for the team.

> Precision note (adversarial review, 2026-07-23): the pin point is the
> COMMIT, not a release tag. `b9f550854` diverges from upstream's tagged
> `open-design-v0.15.1` line (110/17 commits since their common ancestor).
> Any future cherry-pick reasoning starts from the commit, never "v0.15.1".

## Rules

1. **No full upstream merges, ever again.** The upstream remote exists only for
   cherry-picks: `upstream-pinned` (push disabled at the URL level).
2. **Cherry-pick-only lane.** When upstream ships something we need — an
   agent-CLI adapter fix (claude/codex/kimi/deepseek), a security patch —
   fetch and cherry-pick the specific commits:
   `git fetch upstream-pinned && git cherry-pick <sha>`.
   Each cherry-pick gets a one-line entry in the log below.
3. **`origin` is our private repo** (`wiggdevin/mishmash`, PRIVATE — created
   2026-07-23 after the public GitHub fork `open-design-upstream` was found
   un-privatizable and deleted; full history migrated). Push there.
   Local `main` and all working branches track `origin`, never
   `upstream-pinned` (fixed 2026-07-23 — `main` previously tracked upstream,
   making a bare `git pull` a policy violation).
4. **Enforcement:** `.git/hooks/pre-merge-commit` rejects any merge whose
   MERGE_MSG references `upstream-pinned` (cherry-picks unaffected). The
   hook is unversioned — reinstall it on fresh clones (see this doc).
   `upstream-pinned`'s push URL is the literal string `DISABLED-no-push`.
5. **Push status:** as of 2026-07-23 local `main` is ~208 commits ahead of
   `origin/main` — founder to push when ready (repo visibility is his call).
4. **The one dependency to watch:** agent-CLI runtime adapters rot as the CLIs
   evolve. We maintain only the lanes we use (claude, codex, kimi, deepseek,
   hermes, antigravity, cursor-agent). Adapter definitions for uninstalled
   CLIs were deliberately NOT deleted in the 2026-07 de-bloat (small files,
   breakage risk outweighs bloat win) — revisit only if they cause noise.

## De-bloat log (2026-07)

Removed as owned-surface reduction: non-English locales + localized docs,
GitHub/Teams/Discord top-bar buttons, `apps/desktop` and `apps/packaged`
(team uses the web Studio only), `apps/landing-page` (the Astro marketing
site was upstream's, not ours) — including their packaged/release CI
workflows, e2e Electron specs, and CODEOWNERS/allowlist entries. Also:
language-targeted plugins/templates, the od-branded landing template pair +
atelier-zero marketplace copy, and user-facing "Open Design" branding
(→ MishMash). See branch `feat/debloat`.

### Gallery previews + example content (2026-07-24)

**Baked previews are OFF in this fork.** `data/plugin-previews/manifest.json` was
emptied to `{"previews": {}}` (the file must still exist and parse or
`scripts/check-plugin-preview-manifest.ts` fails). Upstream's entries named clips
on THEIR bucket (`repo-assets.open-design.ai`), so every gallery card rendered
their branding — and for some, Chinese copy — baked into the poster pixels, which
we cannot re-bake on a bucket we don't own. With no bake, `inferPluginPreview`
falls back to an iframe on `/api/plugins/<id>/preview`, rendering each plugin's
own local example HTML. Cost: live iframes are heavier than flat posters. To undo,
bake locally (`scripts/bake-plugin-previews.mjs`; needs `puppeteer-core`, Chrome
and `ffmpeg`) and point `OD_PLUGIN_PREVIEWS_DIR` at the output — the daemon serves
on-disk clips from `/api/plugin-previews` in preference to the public origin.
`apps/daemon/tests/plugin-preview-bakes.test.ts` deliberately no longer asserts
the manifest is non-empty.

**Example content is de-branded to a fictional client, not to MishMash.** The
plugin examples are demo decks carrying invented financials ("$81K MRR", "340
paying teams", "Series A $18M Ask"). Renaming those to MishMash would have
fabricated revenue and funding claims attributed to us inside a client-facing
tool, so all of it — visible text, `aria-label`s, outbound `href`s, `mailto:`,
social handles — became **Northwind Design** / `northwind.design`, the fictional
brand the demo content already used. "MishMash" is used ONLY where the text
describes the host app itself (the preview `<title>` in
`apps/daemon/src/routes/static-resource.ts`, host-bridge code comments). Internal
identifiers are untouched: `@open-design/*` packages, `open-design.json`
filenames, `open-design.ai/schemas/*` `$schema` URLs, CSS classes, and each
plugin's `name`. `plugins/_official/examples/open-design-homepage` was deleted
outright — a pixel clone of upstream's marketing site whose factual claims
(Apache-2.0, "64,000+ repos", "30K stars") cannot honestly carry any other name.

**CI needs `OD_CI_RUNNER_MODE=economic` on this fork.** `.github/scripts/runners.py`
defaults to mode `default`, which resolves the `control` runner profile to
upstream's self-hosted Contabo labels (`self-hosted`, `od-persistent-ci`,
`od-ci-hot-poc`) and the hot-path profiles to the paid `blacksmith-4vcpu-ubuntu-2404`
service. Neither exists for this repo, so `Static gate` and `Detect validation
scopes` sit queued forever and no PR can ever go green. Mode `economic` resolves
every Linux profile to GitHub-hosted `ubuntu-24.04`. Set as a repo variable
(`gh variable set OD_CI_RUNNER_MODE --body economic`); re-set it on any new
clone or fork. Note that a run already queued against a missing self-hosted
runner cannot be cancelled promptly — push a new commit to get a fresh run.

**Deleting a bundled plugin needs a daemon restart.** The plugin registry is
cached: after removing the directory the daemon kept serving the entry with a
`fsPath` that no longer existed (a card that renders nothing). `pnpm tools-dev
restart` re-scans. Likewise, daemon source edits need
`pnpm --filter @open-design/daemon build` — a running daemon serves stale `dist`.

**Known-dead surface (dispositioned, 2026-07-23 Luna audit):** `tools/pack`
and `tools/release` source still references the deleted Electron packages
(`@open-design/desktop`, `@open-design/packaged`). They compile and their
builds pass; they fail only if a packaging/release command is actually run —
a lane this fork never uses (web Studio via `tools-dev` only). Left in place
deliberately: deleting them ripples into `scripts/scopes.ts`, guard tests,
and CI topology for zero operational win. Revisit only if packaging is ever
resurrected.

## Cherry-pick log

| Date | Upstream sha | What | Why |
|---|---|---|---|
