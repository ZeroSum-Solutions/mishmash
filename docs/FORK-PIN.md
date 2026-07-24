# Fork pin policy — MishMash

**Decision (founder, 2026-07-23):** this repository is a HARD-PINNED fork of
nexu-io/open-design, frozen at the v0.15.1 merge base (`b9f550854`). We own it.
It is the MishMash studio: the one-stop workbench for the team.

## Rules

1. **No full upstream merges, ever again.** The upstream remote exists only for
   cherry-picks: `upstream-pinned` (push disabled at the URL level).
2. **Cherry-pick-only lane.** When upstream ships something we need — an
   agent-CLI adapter fix (claude/codex/kimi/deepseek), a security patch —
   fetch and cherry-pick the specific commits:
   `git fetch upstream-pinned && git cherry-pick <sha>`.
   Each cherry-pick gets a one-line entry in the log below.
3. **`origin` is our fork** (`wiggdevin/open-design-upstream`). Push there.
4. **The one dependency to watch:** agent-CLI runtime adapters rot as the CLIs
   evolve. We maintain only the lanes we use (claude, codex, kimi, deepseek,
   hermes, antigravity, cursor-agent). Adapter definitions for uninstalled
   CLIs were deliberately NOT deleted in the 2026-07 de-bloat (small files,
   breakage risk outweighs bloat win) — revisit only if they cause noise.

## De-bloat log (2026-07)

Removed as owned-surface reduction: non-English locales + localized docs,
GitHub/Teams/Discord top-bar buttons, `apps/desktop` (team uses the web
Studio). See branch `feat/debloat`.

## Cherry-pick log

| Date | Upstream sha | What | Why |
|---|---|---|---|
