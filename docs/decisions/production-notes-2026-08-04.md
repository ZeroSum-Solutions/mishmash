# Decision: dispositions for the eight production-testing notes (2026-08-04)

**Status:** Accepted
**Date:** 2026-08-04
**Resolves:** the six founder decisions left open by the 2026-08-03 production-notes
triage (items 1, 2, 3, 5, 7, 8). Items 4 and 6 carried no open decision and shipped
already.

## The question

On 2026-08-03 the founder filed eight notes from a production-testing pass. Each was
investigated read-only and then independently audited by a second model; all eight
audits came back `PARTLY_WRONG` — core findings intact, with material corrections.
Six of the eight ended in a founder decision rather than an obvious fix, and the
implementation lane parked on them.

This document records those decisions so the remaining PRs have a scope to hold to,
and so the closed items stay closed.

## Rulings

### 1. Kit screenshots — per-kit descriptions stay external

The clickable screenshot lightbox shipped (`d87fc4a04`), and `DesignLibraryItem`
already carries an optional `description` field that the card and dialog render when
present. The open question was who authors the ~118 descriptions.

**Ruling:** description text is authored outside this repository, in the catalog
generator (`~/Desktop/Design Assets/.catalog/build_catalog.py`), via an override map
following the existing `KIND_OVERRIDES` pattern. MishMash renders what the catalog
supplies and generates nothing itself.

**Why:** `RIGHTS.md` keeps the licensed kit bytes out of every git tree, and the
catalog is generated entirely outside this repo. Authoring descriptions in app code
would mean either shipping curation data with no source of truth or running an LLM
pass over licensed content from inside the daemon. Neither is worth it for a field
that already flows through `GET /api/design-library/catalog` and `od design-library
catalog --json` verbatim.

**Consequence:** no further MishMash change. Item closed in-repo.

### 2. Kit style split — target the product's Figma import, not the private catalog

The note asks for detecting and labelling the 2-5 distinct styles bundled inside one
kit. The word "kit" maps to the Design Library, whose data is generated outside this
repo; but the same defect exists in a surface that every MishMash user touches:
`figma-import.ts` flattens every page of a multi-page `.fig` into one blended token
set, so a file holding three styles produces one muddled average of all three.

**Ruling:** build per-page (top-level `CANVAS`) clustering in the product's Figma
import path. Devin's personal catalog script is out of scope for this repo.

**Why:** the in-repo gap is real, general, and hits every user; the catalog-side gap
is a one-person curation tool. Fixing the product surface is what a PR here can
actually own.

### 3. Figma fidelity — no deterministic renderer; invest in node scoping

**Ruling (a), "true source fidelity":** MishMash's Figma import is, and remains, an
LLM-assisted rebuild from an extracted token/tree snapshot. We are not building a
deterministic Figma-tree-to-pixel renderer. Say so plainly in the scenario docs and
the contract DTOs instead of implying otherwise.

**Why:** the extraction schema is lossy before any rendering step begins — it keeps
boxes, solid colors, text and component references, and explicitly records gradients
and image fills as unsupported. A pixel-exact renderer downstream of a lossy
extractor cannot deliver fidelity; it would need the extractor rewritten first. That
is a different, much larger project than this note.

**Ruling (b):** the fidelity lever we do invest in is scoping. A pasted URL that
names a node (`?node-id=...`) must extract that node, not the whole 62-screen
document. Ship it dual-track (HTTP + UI + CLI).

**Consequence:** the contract/implementation drift the audit found — DTO docs
claiming URL imports route through `figma-extract` while the endpoint 409s them — is
corrected as part of the same PR.

### 5. Bug-report tracker — expose the capability that exists, don't build a new one

The investigation concluded no bug-report mechanism existed; the audit proved that
wrong. `POST /api/runs/:id/feedback` exists, persists to `messages.feedback_json`,
and has a full UI in `AssistantMessage.tsx`. What it does not have is a CLI leg,
which makes it a dual-track violation.

**Ruling:** no new in-app bug-report system. Give the existing feedback capability
its missing `od` subcommand, and fix the "Submit a feature request" item that links
to `/pulls` instead of a feature-request form. The wrong-repo help links were already
repointed to this fork (`1d35af9e2`).

**Why:** the founder's question was "where do my reports go", not "build me a
tracker". The answer is that they go to a real endpoint with real storage — which
external agents could not reach, because the CLI leg was missing.

### 7. Storyboard style reference — reuse Brand, text-augmentation only

**Ruling (extraction depth):** reuse the existing Brand extraction engine. Do not
build a second extractor and do not block the storyboard flow on a full agent-driven
extraction.

**Ruling (what counts as a "design file"):** the existing paste-DESIGN.md precedent
already supported by `BrandCreateRequest.designMd`. No new upload path.

**Ruling (how literally the reference steers generation):** text-prompt style
augmentation only. No image-to-image style transfer or reference-screenshot
conditioning in this pass.

**Why:** visual conditioning is provider-dependent and heavy, and the cheap path is
reversible — if augmented prompts prove too weak, conditioning can be added later
behind the same contract. The reverse is not true.

**Consequence:** the slider export ("scrollable video") inherits the style for free,
since it packages already-generated frames.

### 8. Large kit import — keep the cap, keep failing loudly

The reported "silent skip" was not silent: the copy engine already aborts with a 422
naming the offending file. The real defects were a build-cache directory inflating a
54 MB kit to 801 MB, an unlocatable bare-filename error message, and one UI surface
discarding the specific reason. All three shipped (`68ffb1482`, `67dc91bab`).

**Ruling:** keep the 600 MB copy cap (already overridable via
`OD_DESIGN_LIBRARY_COPY_MAX_BYTES`) and keep failing loudly. Do not add a
partial-import-with-warnings mode.

**Why:** a partial import that proceeds with a warnings list is precisely the
behaviour the founder reported as the bug. Re-introducing it as a feature — after
fixing it — trades a loud, locatable failure for a quiet, wrong success.

**Consequence:** no further change. Item closed.

## What this leaves

Items 1 and 8 are closed with no further code. Items 2, 3, 5 and 7 each get their own
PR, dual-track, per the one-item-one-branch convention the lane has followed
throughout.
