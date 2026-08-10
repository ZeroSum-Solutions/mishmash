# Project loops

Saved Loop Library loops, adapted to MishMash's real commands and surfaces.
Source catalog: https://signals.forwardfuture.com/loop-library/ (85 loops,
catalog updated 2026-07-07 at save time). Saved 2026-08-10.

## The production data cleanup loop (014)

Source: https://signals.forwardfuture.com/loop-library/loops/production-data-cleanup-loop/

Keeps the curated design catalog matching its taxonomy and quality definition
after every import batch; stops at a clean validator pass or at a record that
needs a human curation call.

Prompt:
> After each design-kit import batch, run
> `pnpm exec tsx scripts/validate-design-catalog.ts`. Repair or remove every
> record that fails it (missing categories, thin descriptions, contact-sheet
> covers, fingerprint collisions). When a violation class recurs, improve the
> classification logic in `../mishmash-assets/.catalog/build_catalog.py` so it
> cannot come back. Rerun the validator until it passes clean. Stop at zero
> violations, or ask Devin when a record needs a curation judgment.

Run history: 2026-08-09/10 (this session) — evidence receipt returned in
conversation.

## The full product evaluation loop (010)

Source: https://signals.forwardfuture.com/loop-library/loops/full-product-evaluation-loop/

Exhaustive as-a-real-user QA pass over every Studio surface against documented
acceptance criteria; stops at a clean pass or a blocked handoff. Run as the
pre-land gate for large branches, then per release.

Prompt:
> With the local stack running (`pnpm tools-dev`; daemon :17456, web :17573),
> inventory every Studio surface — the Templates, Library, and Design Systems
> tabs, storyboard, guided create, and the project cards and dialogs — with
> documented acceptance criteria and finite risk-based edge cases for each.
> Exercise each one as a real user in real Chrome, logging every bug with
> reproduction evidence. Group findings by shared cause, fix with regression
> tests, then rerun the full inventory. Stop at a clean pass or a blocked
> handoff. Ask before destructive or data-changing actions, and never trigger
> real model-billed generation runs.

Run history: 2026-08-09/10 (this session) — receipt returned in conversation;
its triage items (AMR catalog 500, vela proxy 502, cover 404s, duplicate
Templates nav entry, empty storyboards) were all fixed on
`feat/design-library-standardization`.

## The Groundtruth loop (048)

Source: https://signals.forwardfuture.com/loop-library/loops/groundtruth-audit-loop/

Evidence-first, read-only audit of the privileged daemon surface; stops when
every audit area carries a severity and direct evidence, or returns unverified
areas as blocked. Its output is the red-spec backlog for follow-up work.

Prompt:
> Audit `apps/daemon` from its actual code and configuration, not framework
> assumptions — emphasis on file-path handling in every file-serving route,
> iframe/CSP boundaries, and RIGHTS.md compliance (nothing licensed leaves the
> machine). For architecture, platform compatibility, security, privileged
> areas, performance, deployment, jobs, business logic, and code quality,
> record proved, no issue, weak, or N/A with direct evidence; verify external
> limits from current primary sources and calculate numbers. Ask before
> changing code. Stop when every area is logged with severity, or return
> unverified areas as blocked. Finish with a plain-language overview and an
> area-to-evidence table.

Run history: 2026-08-10 — first run (receipt returned in conversation).
