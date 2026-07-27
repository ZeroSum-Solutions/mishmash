# Selector eval corpus (W7 / S7-2)

**Corpus freeze sha256: 09a184b4afefbe964eca6ae8118992be447bfa55346b4923edfb7ad7a1f4f2c8**

That hash is `sha256(evals/selector/corpus/manifest.json)` at the commit that freezes this
document. `scripts/waves/verify-w7.ts` re-hashes the manifest at HEAD and requires an exact match
— if the manifest changes after this point, the freeze hash goes stale and the gate fails, which
is the point: everything downstream (per-case IR instances, the scorer's population/counterfactual
controls) is built against this exact, pinned manifest state.

*Re-frozen once*, before any scorer/metrics work landed: the original generator hardcoded every
IR's `provenance[].breakpoint` to `"desktop"`, which made `verify-w7.ts` C7-4's breakpoint-only
field-derangement control mechanically unconstructible (no fixed-point-free permutation exists
over an all-identical array). Fixed by alternating breakpoint per provenance entry
(`evals/selector/scripts/generate-corpus.ts`); every **non-sealed** case's IR was regenerated and
re-committed. The two sealed cases' ciphertext was already committed and is frozen under the
verifier's own frozen-path rule (F18) — their `manifest.json` entries intentionally still record
the **original** (pre-fix) `irSha256`, matching the ciphertext that is actually sealed. Those two
cases will fail C7-4's breakpoint-derangement control until a founder-authorized re-seal lands;
see the milestone report to the orchestrator for the corrected plaintext, already prepared.

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
deterministic (no randomness, no network) — running it again reproduces byte-identical output. The
corpus is pinned regardless: nothing here depends on any site staying unchanged, because nothing
here was captured from a live site.

Every snapshot node carries real, structurally meaningful `computedStyle` values (`display`,
`position`, `color`, `backgroundColor`, `fontFamily`) — a css-grid-first case has a real node with
`display: grid` somewhere in its capture, a flex-utility case a real node with `display: flex`, an
absolute-canvas case a real node with `position: absolute`. These are checked mechanically by
`verify-w7.ts` C7-5 against the corpus's own captured data, not asserted by label.

## Quota table (S7-2)

| Dimension | Minimum | Actual |
|---|---|---|
| Layout systems | ≥3 distinct | 3: `css-grid-first`, `flex-utility`, `absolute-canvas` — each backed by a real captured `display`/`position` value |
| Page genres | ≥4 | 4: `marketing`, `ecommerce`, `docs`, `app-dashboard` |
| Breakpoints scored | ≥2 per case | 2 per case (`mobile` @ 390px, `desktop` @ 1440px) for every non-skip case; every source has a pinned snapshot at every declared breakpoint |
| Conflict pairs | ≥3 | 4 (`marketing-hero-grid` on `layout`, `ecommerce-product-flex` on `palette`, `dashboard-canvas-widgets` on `typography`, `docs-api-reference` on `section`) — each cross-referenced against that case's own IR `conflictResolution` record |
| Degenerate cases | n=1 source; nonexistent-element directive; hostile/heavy DOM | 3: `single-source-landing` (1 source), `phantom-element-directive` (a directive scoped to a domPath that resolves to no captured node), `hostile-heavy-dom-catalog` (232 captured nodes across its sources/breakpoints) |
| Documented skips | ≥1 | 1: `single-source-landing` also documents a bot-walled companion target (`skip.reason = "bot-walled"`) that was attempted and explicitly not captured, rather than silently ignored |

## Held-out split

`manifest.json.sealedFraction = 0.2` (2 of 10 cases): `sealed-marketing-alt` and
`sealed-docs-widget`. Sealed cases' IR and snapshot payloads are committed only as AES-256-CBC
ciphertext (`.enc`) — see `evals/selector/SEALED-ACCESS.md` once the seal commit lands. The
implementing agent for this wave authored the sealed cases' plaintext and handed it off
out-of-band for encryption; it was never committed to this repository in plaintext and the
implementing agent never held the seal key.

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
| `sealed-marketing-alt` | marketing | flex-utility | sealed-mkt-a, sealed-mkt-b | — | — | — | **yes** |
| `sealed-docs-widget` | docs | absolute-canvas | sealed-docs-a, sealed-docs-b | — | — | — | **yes** |

Every case's `directiveInventory` (in `manifest.json`) is the ground truth for what the case's IR
must express — cross-checked field-by-field (`axis`, `source`, `scope`, `strength`) by
`verify-w7.ts` C7-2. Every conflict case's `directiveInventory` contains **two** claims sharing the
declared conflict axis, one from the winning source and one from the losing source — the conflict
is a real property of two competing directive claims, not a label bolted onto an unrelated case.
