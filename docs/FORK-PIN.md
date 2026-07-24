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
3. **`origin` is our fork** (`wiggdevin/open-design-upstream`). Push there.
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
