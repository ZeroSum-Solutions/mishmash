# Selector eval corpus (W7 / S7-2)

**Corpus freeze sha256: 6e699a6105b99d44e2f4b8770d19bf51448e9ca284056c9551ed3af001bbd78e**

That hash is `sha256(evals/selector/corpus/manifest.json)` at the commit that freezes this
document. `scripts/waves/verify-w7.ts` re-hashes the manifest at HEAD and requires an exact match
— if the manifest changes after this point, the freeze hash goes stale and the gate fails, which
is the point: everything downstream (per-case IR instances, the scorer's population/counterfactual
controls) is built against this exact, pinned manifest state.

## Revision history

**v4 (deliverable-review fix round 2, corpus side).** Three fixes bundled into one regen of the 8
non-sealed cases (sealed cases untouched, spliced back in verbatim as always):

- **Genuinely distinct genre structure, not just distinct names (Sol REJECT on F6, round 2).** v3's
  genre vocabularies were four differently-NAMED instances of the same seven-slot template with
  exactly one container and one motion target each — "unique role nouns do not establish
  structurally distinct information architectures," per the review. Genres now differ in shape:
  `marketing` stays the 7-slot/1-container/1-motion-target baseline; `ecommerce` is 9 slots/2
  containers with `trust-badges` genuinely NESTED inside `reviews-panel`'s own DOM subtree (an extra
  real domPath segment, not a relabel); `docs` is 6 slots (the leanest) with 2 motion targets; `app-
  dashboard` is 8 slots/2 containers with `data-grid` nested inside `chart-panel`. See the Quota
  table below for the full per-genre role lists.
- **Real per-breakpoint divergence (Sol HIGH on N1, prerequisite for the round-2 scorer rewrite).**
  Every container role now renders `display: block` (stacked) on `mobile` regardless of its
  `layoutSystem`, and its real `layoutSystem` value on `desktop` — the SAME domPath's mobile and
  desktop captures genuinely differ now, checkable evidence of responsive behavior, not identical
  `computedStyle` tagged with two different breakpoint strings.
- **Brief binding (Sol REJECT on F2, deliverable side, round 2).** Briefs moved out of
  `generate-corpus.ts`'s `CaseSpec` (where they lived beside `directives` in the same object) into a
  separate top-level `CASE_BRIEFS` map. `manifest.json` now records each non-sealed case's
  `briefPath` + `briefSha256`, freeze-covering brief content exactly the way `irPath`/`irSha256`
  already cover the IR — a brief edit is now visible to the freeze hash, same as an IR edit. This is
  the MECHANICAL half of the fix; the deeper authorship-independence question (same session writes
  both artifacts) is explicitly out of scope this round, closed instead by a separate
  orchestrator-dispatched independent audit agent.

**Known residual, declared not hidden:** both review lanes ruled the C7-2 freeze-commit-ordering
mechanical gap (see the git-ancestry note in the round-1 fix-round history) a GATE-DEFECT, not a
deliverable-side defect — it is being amended on the verifier side, not fixed here. `manifest.json`'s
hash is kept current above regardless (that half of C7-2's check is unaffected by the ordering
issue).

**v3 (deliverable-review fix round 1).** The sealed held-out split is DONE and STABLE: the v2
re-seal completed (seal commits `5abb5e357`/`d8caf813d`), and `sealed-marketing-alt` /
`sealed-docs-widget` pass C7-1 (schema+hash), C7-4 (provenance resolution, including the
breakpoint-derangement control), and C7-11 (content-binding, leak-scan, key permissions) as of that
re-seal — this is settled, not open. `manifest.json.version` moves 2 → 3 for this revision; the two
sealed cases' sub-objects are untouched (spliced back in byte-for-byte by
`evals/selector/scripts/generate-corpus.ts`'s preserved-sealed-case step) — they will **not** be
re-sealed again. Everything below in this section describes what changed for the **8 non-sealed**
cases only, responding to both lanes' deliverable review
(`~/.claude/goal-state/mishmash-w7-selector-foundations/reviews/`):

- **Genre-specific structure (F6, both lanes REJECT → fixed).** Each genre now has its own role
  vocabulary and information architecture — see the Quota table below. A marketing page has a
  `hero`/`pricing-cta`/`testimonial`; an ecommerce page has a `product-gallery`/`price-badge`/
  `add-to-cart`; a docs page has a `sidebar-nav`/`code-sample`/`toc-panel`; a dashboard has a
  `nav-rail`/`metric-tile`/`chart-panel`. No two genres share a role name. The two SEALED cases
  (`sealed-marketing-alt`, `sealed-docs-widget`) still use the original universal 8-role template —
  frozen, not retrofitted — so `marketing`/`docs` genuinely have two role vocabularies in this
  corpus (sealed vs. non-sealed) until/unless a future wave re-seals. That inconsistency is
  disclosed, not hidden.
- **Independent NL briefs (F2, both lanes REJECT → partially addressed).** `evals/selector/corpus/briefs/<case>.md`
  now holds a hand-written natural-language brief per case, composed BEFORE cross-checking it
  against `directiveInventory` (not derived from the JSON — contrast the prose below with the
  field-by-field table). See "Brief grounding" below for the explicit sentence → directive trace.
  **Standing limitation, stated plainly:** the brief and the inventory are still authored by the
  same agent in the same session; this is process discipline (write brief first, trace second), not
  a different author. A genuinely independent brief (a different session, a different model, or a
  human) is a real gap this fix round narrows but does not close.
- **Directive strength is consumed, not stored-and-ignored (Grok-N8).** `evals/selector/scorer/index.ts`
  weights `directive_claim_coverage` and the per-axis fidelity scores by each claim's `strength`.
- **Proportional hostile-DOM exercise (Grok-N5).** `hostile-heavy-dom-catalog` now carries 12
  directive claims / 12 provenance entries (up from 2), 10 of them scoped to specific catalog rows
  across both sources — against 236 total captured nodes, not 2 claims regardless of corpus size.
- **Even-length provenance arrays (mechanical fix).** `ecommerce-product-flex` gained a 6th
  directive claim (`typography`, `ecom-grid-b`, `product-title`) — its previous 5-claim, 3-vs-2
  mobile/desktop split mathematically admits NO fixed-point-free rotation (verified by brute
  force), which made C7-4's breakpoint-only derangement control unconstructible for this one case.
  `generate-corpus.ts`'s `assertBreakpointRotationDerangeable` now asserts this at generation time.
- **v3 IR shape (Sol-N4, Grok-N7, item 7).** `snapshotIdentity` per source slot, a `state` dimension
  on evidence pointers (`default`/`hover`/`scrolled` captured; `loaded` enumerated but not yet
  captured — disclosed gap, not silent), directive-level `breakpoint` scoping, `scopeOverlap` on
  conflict-resolution records, and a machine-checkable `predicate` on every constraint. All additive
  and optional in the schema — see `docs/specs/selector-composition-ir.schema.json`'s per-field
  "v3+, optional" notes — so the frozen sealed IR (v1 shape) still validates unchanged.

*Re-frozen five times before v3* (v1/v2 history, kept for the record): (1)+(2) provenance
breakpoints were hardcoded / nodeId was breakpoint-shared, both defeating C7-4's breakpoint-only
derangement control; (3)+(4) pretty-printed JSON and near-identical boilerplate prose produced
>64-byte spans that false-positived C7-11's leak scanner — fixed by compact JSON, short
case-tagged tokens, and a string-array `evidencePointers` shape; (5) the v2 re-seal itself required
a fresh freeze once `manifest.json`'s sealed-case hashes were updated to match the newly-sealed
ciphertext.

## Provenance of the data

Every case in this corpus is a **hand-authored, pinned fixture** — not a live capture. That choice
is explicit and within the PRD's own allowance (S7-2: "hand-author minimal-but-real HTML/CSS
snapshot fixtures where a live capture adds nothing (degenerate cases, conflict pairs)"), extended
here to the whole corpus for one reason: this wave's deliverable is the IR and the grader, not
content fidelity to any particular real site. A hand-authored corpus lets every adversarial control
this wave's grader must survive — cross-case foreign attribution, in-case misattribution,
domPath-membership bleed, style-fingerprint bleed, single-axis-isolated diversity trios, single-
element counterfactual swaps — be constructed with **exact, deliberate, reproducible** node
identity, which a live capture cannot guarantee case-by-case. The generator that produced every
snapshot and IR file is committed at `evals/selector/scripts/generate-corpus.ts` and is
deterministic (no randomness, no network) — running it again reproduces byte-identical output for
the 8 non-sealed cases (the 2 sealed cases are spliced in from the existing manifest, never
regenerated). The corpus is pinned regardless: nothing here depends on any site staying unchanged,
because nothing here was captured from a live site.

Every snapshot node carries real, structurally meaningful `computedStyle` values (`display`,
`position`, `color`, `backgroundColor`, `fontFamily`, and — on each genre's motion-target role —
`transitionDuration`) — a css-grid-first case has a real node with `display: grid` somewhere in its
capture, a flex-utility case a real node with `display: flex`, an absolute-canvas case a real node
with `position: absolute`. These are checked mechanically by `verify-w7.ts` C7-5 against the
corpus's own captured data, not asserted by label. `transitionDuration` is what
`evals/selector/scorer/index.ts`'s `motion_timing` axis validates a composition's `motionSignature`
against (`transition:<duration>`) — an arbitrary free-form label no longer scores as validated
motion evidence.

**v4 addition (Sol-N1, round 2):** a container role's `display` value is no longer identical across
breakpoints — `mobile` always captures `block` (stacked) regardless of the source's declared
`layoutSystem`, while `desktop` captures the real `grid`/`flex`/`absolute` value. The SAME domPath's
mobile and desktop nodes genuinely differ, so a scorer can verify real responsive divergence instead
of trusting a breakpoint string tag on otherwise-identical data.

## Quota table (S7-2)

| Dimension | Minimum | Actual |
|---|---|---|
| Layout systems | ≥3 distinct | 3: `css-grid-first`, `flex-utility`, `absolute-canvas` — each backed by a real captured `display`/`position` value |
| Page genres | ≥4, structurally distinct | 4, each with its OWN role vocabulary AND its own structural shape (no shared role names, no shared slot/container/motion-target count — see "Genuinely distinct genre structure" above): `marketing` — 7 slots, 1 container, 1 motion target, flat (hero/headline/subheadline/testimonial/features-grid/pricing-cta/footer-nav); `ecommerce` — 9 slots, 2 containers, 1 role genuinely NESTED (`trust-badges` inside `reviews-panel`), 1 motion target (product-gallery/product-title/price-badge/reviews-panel/**trust-badges (nested)**/size-selector/add-to-cart/related-products/shipping-footer); `docs` — 6 slots (leanest), 1 container, 2 motion targets (sidebar-nav/article-title/code-sample/**callout-box (motion)**/toc-panel/**edit-link (motion)**); `app-dashboard` — 8 slots, 2 containers, 1 role genuinely NESTED (`data-grid` inside `chart-panel`), 1 motion target (nav-rail/metric-tile/chart-panel/**data-grid (nested)**/filter-controls/alert-banner/user-menu/export-button) |
| Breakpoints scored | ≥2 per case | 2 per case (`mobile` @ 390px, `desktop` @ 1440px) for every non-skip case; every source has a pinned snapshot at every declared breakpoint |
| Conflict pairs | ≥3 | 4 (`marketing-hero-grid` on `layout`, `ecommerce-product-flex` on `palette`, `dashboard-canvas-widgets` on `typography`, `docs-api-reference` on `section`) — each cross-referenced against that case's own IR `conflictResolution` record, each with `scopeOverlap: "same-role-different-source"` |
| Degenerate cases | n=1 source; nonexistent-element directive; hostile/heavy DOM | 3: `single-source-landing` (1 source), `phantom-element-directive` (a directive scoped to a domPath — a "promo ribbon" the brief asks for — that resolves to no captured node in the ecommerce role vocabulary), `hostile-heavy-dom-catalog` (244 captured nodes as of v4's app-dashboard structural changes, 12 directive claims / 12 provenance entries proportional to that size) |
| Documented skips | ≥1 | 1: `single-source-landing` also documents a bot-walled companion target (`skip.reason = "bot-walled"`) that was attempted and explicitly not captured, rather than silently ignored |

## Held-out split

`manifest.json.sealedFraction = 0.2` (2 of 10 cases): `sealed-marketing-alt` and
`sealed-docs-widget`. Sealed cases' IR and snapshot payloads are committed only as AES-256-CBC
ciphertext (`.enc`) — see `evals/selector/SEALED-ACCESS.md`. This split is settled: v2 re-seal
completed, sealed cases pass C7-1/C7-4/C7-11, and per the deliverable-review response they will not
be re-sealed again — any further corpus evolution applies to the 8 non-sealed cases only.

## Cases

| id | genre | layoutSystem | sources | conflict axis | degenerate | skip | sealed |
|---|---|---|---|---|---|---|---|
| `marketing-hero-grid` | marketing | css-grid-first | mkt-grid-a, mkt-flex-b | layout | — | — | no |
| `ecommerce-product-flex` | ecommerce | flex-utility | ecom-flex-a, ecom-grid-b | palette | — | — | no |
| `dashboard-canvas-widgets` | app-dashboard | absolute-canvas | dash-abs-a, dash-grid-b | typography | — | — | no |
| `docs-api-reference` | docs | flex-utility | docs-flex-a, docs-grid-b | section | — | — | no |
| `blog-content-grid` | marketing | css-grid-first | blog-grid-a, blog-flex-b | — | — | — | no |
| `single-source-landing` | marketing | flex-utility | land-solo-a | — | single-source | bot-walled | no |
| `phantom-element-directive` | ecommerce | css-grid-first | phantom-grid-a, phantom-flex-b | — | nonexistent-element-directive | — | no |
| `hostile-heavy-dom-catalog` | app-dashboard | absolute-canvas | hostile-abs-a, hostile-grid-b | — | hostile-heavy-dom | — | no |
| `sealed-marketing-alt` | marketing (v1 role shape) | flex-utility | sealed-mkt-a, sealed-mkt-b | — | — | — | **yes** |
| `sealed-docs-widget` | docs (v1 role shape) | absolute-canvas | sealed-docs-a, sealed-docs-b | — | — | — | **yes** |

Every case's `directiveInventory` (in `manifest.json`) is the ground truth for what the case's IR
must express — cross-checked field-by-field (`axis`, `source`, `scope`, `strength`) by
`verify-w7.ts` C7-2. Every conflict case's `directiveInventory` contains **two** claims sharing the
declared conflict axis, one from the winning source and one from the losing source — the conflict
is a real property of two competing directive claims, not a label bolted onto an unrelated case.

## Brief grounding (F2)

Each non-sealed case's brief (`evals/selector/corpus/briefs/<id>.md`) was written first, as free
natural-language prose. This table traces each brief's claims to the `directiveInventory` entries
they ground, by hand, so the correspondence is auditable rather than asserted:

| Case | Brief clause | directiveInventory entry |
|---|---|---|
| `marketing-hero-grid` | "grid features layout from mkt-grid-a... should win" | `layout, mkt-grid-a, strength 0.9` (winner) |
| | "mkt-flex-b has its own features layout too but I don't want that one" | `layout, mkt-flex-b, strength 0.6` (loser) |
| | "mkt-flex-b's colour palette on the hero" | `palette, mkt-flex-b` |
| | "mkt-grid-a's headline typography as-is" | `typography, mkt-grid-a` |
| `ecommerce-product-flex` | "ecom-flex-a's colour palette on the price badge... going with ecom-flex-a's" | `palette, ecom-flex-a, strength 0.85` (winner) |
| | "looked at ecom-grid-b's price styling too" | `palette, ecom-grid-b, strength 0.5` (loser) |
| | "ecom-grid-b's add-to-cart button motion" | `motion, ecom-grid-b` |
| | "ecom-flex-a's reviews panel section structure and overall layout" | `section, ecom-flex-a` + `layout, ecom-flex-a` |
| `dashboard-canvas-widgets` | "dash-abs-a's typography on the alert banner" | `typography, dash-abs-a, strength 0.9` (winner) |
| | "dash-grid-b had its own competing type treatment... not choosing" | `typography, dash-grid-b, strength 0.55` (loser) |
| | "dash-abs-a's data-grid interaction behaviour" | `interaction, dash-abs-a` |
| | "its chart panel layout" | `layout, dash-abs-a` |
| `docs-api-reference` | "docs-flex-a's table-of-contents section structure best" | `section, docs-flex-a, strength 0.8` (winner) |
| | "docs-grid-b organizes its TOC differently... don't want that version" | `section, docs-grid-b, strength 0.45` (loser) |
| | "docs-flex-a's overall layout" | `layout, docs-flex-a` |
| | "callout box colours from docs-grid-b" | `palette, docs-grid-b` |
| `blog-content-grid` | "blog-grid-a's features grid layout" | `layout, blog-grid-a` |
| | "blog-flex-b's hero colour palette" | `palette, blog-flex-b` |
| `single-source-landing` | "land-solo-a for the layout and colour palette" | `layout, land-solo-a` + `palette, land-solo-a` |
| | "wanted a second reference... wouldn't let the crawler in" | `skip: {reason: "bot-walled"}` |
| `phantom-element-directive` | "phantom-grid-a's reviews panel layout" | `layout, phantom-grid-a` |
| | "its product title typography" | `typography, phantom-grid-a` |
| | "phantom-flex-b's promo ribbon banner" | `palette, phantom-flex-b, scope=...promo-ribbon` (unresolvable — no such role exists; the degenerate case) |
| `hostile-heavy-dom-catalog` | "hostile-abs-a's chart panel layout" | `layout, hostile-abs-a` |
| | "hostile-grid-b's data-grid interaction" | `interaction, hostile-grid-b` |
| | "first ten rows of BOTH catalogs... row by row, alternating" | 10 catalog-scoped entries (`catalog:0`..`catalog:9`), alternating `hostile-abs-a`/`hostile-grid-b`, cycling `palette`/`typography`/`motion`/`section` |
