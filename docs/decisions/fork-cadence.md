# Fork maintenance cadence

**Status:** Accepted
**Date:** 2026-07-28
**Context:** [`docs/FORK-PIN.md`](../FORK-PIN.md) establishes that this
repository is a hard-pinned fork of the upstream open-source project, frozen
at commit `b9f550854`, with no further full upstream merges. This document is
the lightweight operational half: how a maintainer actually pulls in a
specific upstream fix, and what compatibility aliases exist so a stale
mental model of "we renamed everything" doesn't cause a bad cherry-pick.

## Cherry-pick playbook

The pin point is the **commit** `b9f550854`, not a release tag — see the
precision note in `docs/FORK-PIN.md`. All cherry-picks are evaluated against
that commit, never against a later upstream tag.

1. **Identify the fix.** Find the upstream commit(s) that fix the issue —
   typically an agent-CLI adapter fix (claude/codex/kimi/deepseek/…) or a
   security patch. The upstream remote is read-only for this purpose:

   ```bash
   git fetch upstream-pinned
   git log upstream-pinned/main --oneline -- <path-of-interest>
   ```

2. **Cherry-pick onto a branch, never straight to `main`.**

   ```bash
   git checkout -b cherry-pick/<short-description>
   git cherry-pick <upstream-sha>
   ```

   A multi-commit fix uses `git cherry-pick <first-sha>^..<last-sha>`.

3. **Resolve conflicts against this fork's shape, not upstream's.** The
   internal-identifier surface (`open-design` / `OD_*` / `@open-design/*`) is
   deliberately unchanged from upstream (see
   [`docs/decisions/internal-identifiers.md`](internal-identifiers.md)), so
   most cherry-picks apply cleanly on that axis. Conflicts instead come from
   the compatibility aliases below — anywhere upstream's file still exists
   but this fork's has been removed, trimmed, or restructured (the
   de-bloat log in `docs/FORK-PIN.md`), the cherry-pick needs a manual
   re-target rather than a blind `git cherry-pick --continue`.
4. **Run the gate before landing.** `pnpm guard && pnpm typecheck` plus the
   package-scoped tests for anything the cherry-pick touched. A cherry-pick
   is a normal PR — it does not skip review because it "came from upstream."
5. **Never push to `upstream-pinned`.** Its push URL is the literal string
   `DISABLED-no-push` and `.git/hooks/pre-merge-commit` rejects any merge
   whose message references it — cherry-picks are unaffected by that hook,
   full merges are exactly what it exists to block.
6. **Log it.** Add a one-line entry to the "De-bloat log" section of
   `docs/FORK-PIN.md` (or a new dated section there) naming the upstream
   SHA(s) and what was pulled in, so the next reader can tell this fork's
   history apart from upstream's without re-deriving it from `git log`.

## Compatibility-alias inventory

These are the concrete places upstream's shape and this fork's shape
deliberately still line up — either because renaming them is out of scope
(NM-01, deferred) or because keeping the alias is what makes future
cherry-picks tractable. A cherry-pick that appears to conflict on one of
these is very likely conflicting because upstream assumes the *other* side
of the alias; check this table before resolving by hand.

| Alias | This fork | Upstream | Why the alias exists |
|---|---|---|---|
| npm package scope | `@open-design/*` (`@open-design/web`, `@open-design/daemon`, `@open-design/contracts`, …) | `@open-design/*` | NM-01, deferred (see `docs/decisions/internal-identifiers.md`) — renaming is a ~760-import-site change with near-zero user value and maximal cherry-pick conflict cost. |
| Daemon/server internal name | `SERVER_NAME = 'open-design'` | same | Internal identifier, not user-visible; NM-03 KEEP ruling. |
| Environment variable prefix | `OD_*` (`OD_DATA_DIR`, `OD_BIND_HOST`, `OD_ALLOWED_ORIGINS`, `OD_ALLOWED_INTERNAL_HOSTS`, …) | same | Internal identifier; changing it would break every operator's existing `.env` and deployment config for no user-visible gain. |
| CLI binary name | `od` | `od` | Documented explicitly in the README/QUICKSTART "shadowed by `/usr/bin/od`" caveat; renaming the binary is a bigger compatibility break than the shadowing annoyance it would fix. |
| Runtime directory convention | `.od/`, `.od-brand-glyph` CSS hook | same | Internal identifier; NM-03 KEEP ruling. |
| Sidecar/IPC protocol constants | `packages/sidecar-proto` (stamp fields, message kinds) | same | Protocol-level identifiers exchanged between this fork's own processes only; not a user-visible brand surface, so out of scope for W2's display-name and egress fixes. |

Anything **not** in this table — a display name, a provider attribution
header, a public metadata endpoint's payload, a community link — is a real
brand surface and is not an alias; see W2's brand-surface inventory
(`scripts/check-brand-surfaces.ts`) and
[`docs/decisions/internal-identifiers.md`](internal-identifiers.md) for the
line between the two.
