# Decision: internal identifiers stay `open-design` / `OD_*`

**Status:** Accepted
**Date:** 2026-07-27
**Resolves:** NM-03 (internal-identifier policy) and NM-01 (the `@open-design/*`
package-scope rename), both raised by the rebrand backlog audit and carried
forward as founder decisions to record in W2 (brand honesty).

## The question

The rebrand audits found the user-visible product name fully migrated to
"MishMash" (README, UI copy, provider attribution headers, share prompts —
see W2's own criteria for the remaining tail), but a large surface of
**internal, non-user-facing identifiers** still reads `open-design` /
`Open Design` / `OD_*`:

- `SERVER_NAME = 'open-design'` and related daemon internals.
- `OPEN_DESIGN_GITHUB_REPO_URL`-shaped constants and other `OPEN_DESIGN_*`
  names.
- The `.od-brand-glyph` CSS hook and the `.od/` runtime directory convention.
- `OD_*` environment variables (`OD_DATA_DIR`, `OD_BIND_HOST`,
  `OD_ALLOWED_ORIGINS`, …) throughout the daemon, CLI, and docs.
- The `od` CLI binary name itself.
- The `@open-design/*` npm package scope — every workspace package
  (`@open-design/web`, `@open-design/daemon`, `@open-design/contracts`, …),
  roughly 760 import sites across ~20 packages (NM-01).

Should these be renamed to match the `MishMash` / `MM_*` / `mm` surface, for
full internal consistency with the user-visible brand?

## Ruling: **KEEP**

Internal identifiers and the `@open-design` package scope are **retained**,
not renamed. This is a deliberate decision, not an oversight — recording it
here stops future agents from re-litigating it as an open TODO.

## Rationale

1. **This repository is a hard-pinned fork.** Per [`docs/FORK-PIN.md`](../FORK-PIN.md),
   `main` is frozen against upstream at a specific commit, and the only
   update lane is `git fetch upstream-pinned && git cherry-pick <sha>`. A
   package-scope and identifier-name rename touching ~760 import sites across
   ~20 packages would diverge this fork from upstream's own file shapes at
   nearly every touched file, maximizing conflict surface on every future
   cherry-pick for close to zero user-visible benefit — none of these
   identifiers are seen by a person using the product.
2. **Both auditors that raised NM-03/NM-01 recommended keeping them.** The
   rebrand backlog audit that surfaced this question flagged the internal
   surface as *technically* inconsistent but explicitly did not recommend
   fixing it, precisely because of the cherry-pick-conflict cost above.
3. **NM-01 is explicitly out of scope for this wave.** The W2 PRD
   ([`docs/plans/waves/W2-brand-honesty.md`](../plans/waves/W2-brand-honesty.md),
   "Explicitly out of scope") defers the `@open-design/*` rename to a future
   wave (W11) "or never" — this ruling makes that deferral a recorded
   decision rather than a silent gap.
4. **Brand honesty, this wave's actual goal, is about what a user or a
   network peer observes** — display names, provider attribution headers,
   community links, marketing copy. An `OPEN_DESIGN_DISCORD_INVITE_URL`
   constant name or an `@open-design/contracts` import specifier is neither;
   it is source-code plumbing a contributor reads, not a claim a user or a
   third-party service sees. W2's own brand-surface inventory
   (`scripts/check-brand-surfaces.ts`) is written to this exact boundary: it
   flags the retired `open-design.ai` host and the retired "Open Design"
   display name, and explicitly does not flag kebab-case internal
   identifiers, `SERVER_NAME`, `OD_*` constants, or `@open-design/*` package
   specifiers.

## What this does not cover

This ruling is scoped to identifiers and package names. It does not bless
any *user-visible* string that happens to reuse the same words — a UI label,
an error message, a provider header, or a network request still carrying the
literal display name "Open Design" or the `open-design.ai` host remains a
real finding, tracked and fixed under W2's other criteria (C2-1, C2-2, C2-9).

## Consequence

- No blanket rename of `open-design` / `OD_*` / `@open-design/*` identifiers
  is scheduled. NM-01 stays deferred (W11 or never).
- Any future agent proposing this rename should treat it as re-opening a
  closed decision, not a routine cleanup — it needs a new founder decision
  weighing the (now presumably larger) conflict surface against the
  (still zero) user-visible benefit.
