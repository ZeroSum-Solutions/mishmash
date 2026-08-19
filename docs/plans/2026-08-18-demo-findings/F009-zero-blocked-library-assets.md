# F009 — Zero blocked assets: wire the whole library in, usable and iterable

| Field | Value |
|---|---|
| Captured | 2026-08-18, post-demo |
| Reported by | Devin — *"FINAL ANSWER"* |
| Type | **Data gap** + **rights-model redesign** |
| Area | `mishmash-assets/RIGHTS.md` · `.catalog/rights.json` · `apps/daemon/src/routes/design-library.ts` · `apps/daemon/src/design-library/rights.ts` · `packages/contracts/src/api/design-library.ts` |
| Severity | High — gates real work daily |
| Effort | **S** for the 7 blocked (pending 1 decision) · **L** for the model change — see §5.2, larger than the original M estimate: the resolution algorithm is implemented twice (Python + TypeScript) and one gating constant currently covers two routes with different security postures |
| Status | 🔬 Scoped — **2 decisions block parts of this**, rest is executable now (see §6) |

---

## 1. Raw note (verbatim)

> also im seeing some design library assets here and templates that are showin up as blocked or
> pending design licence, nothing should be blocked, at all. zero things, wier them all in. we
> have licences for everythig, FINAL ANSWER. I never want to see a blocker again. fix this and
> make sure that they are all wired up correctly ready to be used and iterated on.

**Directive accepted.** This finding delivers zero blockers wherever that is safe to do
mechanically. §6 flags the two places it genuinely cannot be decided by an agent alone —
scoped narrowly so everything else proceeds tonight regardless.

---

## 2. Measured state — 277 items

Re-measured directly against the live `mishmash-assets/catalog.json` while repairing this
finding (see the reproducible one-liner in §5.5 — same command, same result):

| `allowed_use` | Items | Can copy into a project? | Live preview? |
|---|---:|:---:|:---:|
| `licensed-source-review` | **198** | ✅ | ✅ |
| `human-local-only` | **63** | ❌ | ❌ |
| `own-code` | 9 | ✅ | ✅ |
| **`blocked-pending-license`** | **7** | ❌ | ❌ |

**70 of 277 items (25%) are capability-reduced.** Only **7** carry the literal
*"Blocked — no license record"* label.

### Where the 7 blocked items live

Independently re-derived from `catalog.json`, not carried over from the original note:

| Collection | Blocked | Items |
|---|---:|---|
| Design Systems & UI Kits | 3 | `ai-travel-planner-react-typescript`, `azurio-digital-agency-and-personal-portfolio-html-template`, `mockos` (all under `01 UI8 Kits/`) |
| Icon Sets | 2 | `Nucleus-Icon-Set`, `Stockholm-Icon-Set` (under `07 Icon Sets/`) |
| Design Inspiration Library | 1 | `04 Design Inspiration/ios/savee` |
| **Generated Icons** | **1** | `08 Generated Icons/generated-icons` |

The Generated Icons item is AI-generated icon PNGs (`mobile_app_icon_*.png` etc., verified by
listing the folder) — plausibly Devin's own output, but **not yet recorded as such anywhere**:
see the correction in §6.1 before treating it as settled.

### Where the 63 reference-only items live

Also re-derived directly from `catalog.json` group-by-group:

| Collection | `human-local-only` |
|---|---:|
| Design Inspiration Library | 36 |
| Site Screenshots | 21 |
| App UI References | 6 |

---

## 3. Why the block exists (mechanically) — corrected

**Line citation fix:** the code lives at `apps/daemon/src/routes/design-library.ts:73-86`
(the original note said `73-79`, which stops mid-declaration). `REFERENCEABLE_ALLOWED_USE` is a
multi-line literal in the source; the block below is condensed for readability, not a verbatim
excerpt:

```ts
const COPYABLE_ALLOWED_USE = new Set<DesignLibraryAllowedUse>(['own-code', 'licensed-source-review']);
const REFERENCEABLE_ALLOWED_USE = new Set<DesignLibraryAllowedUse>(['own-code', 'licensed-source-review', 'human-local-only']);
const LIVE_PREVIEWABLE_ALLOWED_USE = COPYABLE_ALLOWED_USE;
```

**Resolution has two layers, and the original note only described the first one.** The
`RIGHTS.md` embedded ledger ("A source not listed here has no supported rights claim and
remains `blocked-pending-license`" — quote verified verbatim) is a **validation ceiling only**.
It can downgrade or reject a claim, but it can never authorize one by itself. The binding gate
is a **required per-item record** in the private `.catalog/rights.json` registry, keyed by
exact `rel` and bound to a `tree_sha256`. Missing record ⇒ `blocked-pending-license`,
unconditionally — see `mishmash-assets/.catalog/build_catalog.py:373-382`
(`resolved_allowed_use`) and its independent TypeScript re-implementation,
`apps/daemon/src/design-library/rights.ts:243` (`resolveCurrentDesignLibraryRights`), which the
route calls at every action boundary via the `resolveCurrentRights` alias at
`apps/daemon/src/routes/design-library.ts:502`.

**Proof this is a per-item gap, not a per-source gap:** 3 of the 7 blocked items
(`ai-travel-planner-react-typescript`, `azurio-...`, `mockos`) sit under `01 UI8 Kits/`, a
prefix **already present** in the `RIGHTS.md` ceiling at `licensed-source-review`. They are
still blocked because no per-item record for them exists in `.catalog/rights.json` yet — not
because their source is unlisted. This directly corrects R2 below.

---

## 4. Two facts worth separating

### 4.1 The 198 "licensed" items were never blocked

`licensed-source-review` already means *"Paid license held (UI8 purchase, or NeuForm Pro
subscription). May inform and be adapted into client end-products."* — quote verified verbatim
against `mishmash-assets/RIGHTS.md`. Those 198 are **fully copyable and previewable today**. If
any of them *appear* blocked in the UI, that is a labelling bug worth fixing on its own — see
R6.

### 4.2 The one addition — stated once, scoped precisely

The current model conflates two different questions in one field:

| Question | Who set the rule |
|---|---|
| **Can I use this in MishMash?** — open, preview, copy into a project, iterate | MishMash's own policy |
| **Can this file be committed / published / re-hosted?** | The vendors' license terms — UI8 and NeuForm both say source files are *"never redistributed, never committed to any git repo"* |

**Scope correction on the "public repo" framing.** `mishmash-assets` is a **sibling directory**
to this repository (`~/projects/mishmash-assets`, verified: it is not itself a git repository,
and it sits outside the `wiggdevin/mishmash` working tree). There is also no built-in
"push project to git" capability in this product (verified: no route or CLI path creates a git
remote or pushes a generated project). So the redistribution risk this finding is guarding
against is narrower than "the library enters the public repo": it is specifically *a human
manually committing a copied file into `wiggdevin/mishmash`'s own tracked tree* (e.g. dropping
a UI8 template into `design-templates/` as a fixture). R8 is rewritten below to protect exactly
that surface, honestly, rather than implying a broader guarantee the product cannot deliver —
it cannot stop a `redistribute:no` file from being committed to some *other* repo Devin creates
from a copied project; that is outside this product's control plane.

**The simpler fix, corrected from two axes to one field.** Under Devin's directive every one of
the 277 items becomes usable in-product — there is no item where "use" is anything other than
full. A `use` field that is `full` for literally all 277 items, always, never varies — that is
dead schema weight per this repo's own Simplicity-First default, not a real axis. Keep
`allowed_use` exactly as it exists today (shrunk to 3 values once `blocked-pending-license` is
retired: `own-code` / `licensed-source-review` / `human-local-only`) as a **provenance label**,
and add exactly **one** new field:

- `redistribute: 'yes' | 'no'` — `'yes'` only for `own-code`; `'no'` for everything else.

Capability gating becomes: every `Set` literal in §3 simply drops
`'blocked-pending-license'` and keeps the other three values — no new axis, no field that never
varies. Same outcome (zero blockers, all 277 usable, vendor redistribution terms respected),
less schema surface.

---

## 5. PRD

### 5.1 P0 — zero blocked items, permanently

- **R1 · Resolve all 7 — mechanism corrected.** There is no CLI command that authorizes an
  item; per `mishmash-assets/.catalog/README.md`, `.catalog/rights.json` is *"maintained by
  hand."* For each of the 7, add a record to `.catalog/rights.json` keyed by its exact `rel`
  (`{tree_sha256, allowed_use, licence_ref, source_url, captured_at, notes}`, computed via the
  same tree-hash algorithm `designLibraryTreeSha256` in
  `apps/daemon/src/design-library/rights.ts` uses), plus a matching entry in `RIGHTS.md`'s
  embedded ledger for any item whose `allowed_use` will be something other than
  `blocked-pending-license` (the ceiling must agree or the record is rejected — see §3).
  **6 of the 7 need Devin's source per item — this is DECISION REQUIRED, see §6.1.** Do not
  mark the Generated Icons item `own-code` without confirmation either — see §6.1.
- **R2 · Corrected: stop conflating "unlisted source" with "missing per-item record."**
  The original R2 ("add missing sources to the ledger ceiling... this is what stops the state
  recurring") is mechanically wrong — proven in §3: 3 of the 7 blocked items are already under
  a listed, licensed prefix and are still blocked, because the ceiling never authorizes
  anything by itself. Adding sources to the ceiling changes nothing about recurrence. What
  actually recurs the state: `mishmash-assets/.catalog/file_drop.py`'s `file` subcommand
  **always** stages a newly-filed collection with a private `blocked-pending-license` record
  (by design, per its own README) — every new asset starts blocked until someone hand-adds the
  real record. There is no code fix for this within `mishmash-assets/.catalog/`; the process
  fix is R3 below (fail loudly instead of silently rendering blocked), and — optionally, not
  required for tonight — documenting the two-step "file, then record rights" workflow in
  `mishmash-assets/.catalog/README.md`.
- **R3 · Enforce zero — scope corrected to what's actually achievable.**
  `scripts/validate-design-catalog.ts` currently does **not** check `allowed_use` at all
  (verified: zero matches for `allowed_use`/`blocked-pending-license` in that file). Add a
  check that fails when any item in `catalog.json` resolves to `blocked-pending-license`.
  **This cannot become a `pnpm guard`/CI gate** — the script hard-codes
  `DEFAULT_LIBRARY_DIR = '/Users/zero-suminc./projects/mishmash-assets'`, a machine-local path
  that does not exist in CI, and `mishmash-assets` is not itself a git repository (confirmed:
  `git rev-parse --is-inside-work-tree` fails there), so it cannot host its own pre-commit
  hook either. State this plainly instead of promising CI enforcement: R3 makes the check
  *available* and reliable when run; it is a command Devin or an agent runs after any library
  change, not an automatic gate. Success criterion 1 below is scoped to match.
- **R4 · Retire the state from the UI — exact removal list.** With R3 making zero the norm,
  remove the label from every place it's wired:
  - `apps/web/src/i18n/locales/en.ts:4388` (`'designLibrary.allowedUse.blockedPendingLicense'`)
  - `apps/web/src/i18n/types.ts:4507` (matching type entry — removing the key here is what
    makes a stray reference a typecheck error, per this repo's i18n contract)
  - `apps/web/src/components/DesignLibrarySection.tsx:84`
    (`ALLOWED_USE_TOOLTIP_KEY['blocked-pending-license']`)
  - `apps/web/src/components/DesignLibrarySection.tsx:72-77` — this component **duplicates**
    `COPYABLE_ALLOWED_USE`/`REFERENCEABLE_ALLOWED_USE` locally (its own comment says
    *"mirrors ... in apps/daemon/src/routes/design-library.ts"*) — update this copy in the same
    PR or the web UI and the daemon disagree about what's copyable.
  - `packages/contracts/src/api/design-library.ts:14` — `DesignLibraryAllowedUse` shrinks to 3
    values once `blocked-pending-license` is retired from live data (R1 clears the only 7
    instances; R3 stops new ones).

### 5.2 P0 — the model change (one field, not two axes — see §4.2)

- **R5 · Add `redistribute: 'yes' | 'no'`, keep `allowed_use` as a 3-value provenance label.**
  Touch every one of these — the resolution algorithm is implemented **twice**, and missing
  one produces a daemon/web disagreement or a route that silently keeps enforcing the old rule:
  1. `mishmash-assets/.catalog/build_catalog.py` — Python catalog builder (outside this repo).
  2. `apps/daemon/src/design-library/rights.ts` — TypeScript runtime resolver, re-validated
     live at every action boundary (`resolveCurrentDesignLibraryRights`).
  3. `packages/contracts/src/api/design-library.ts` — add `redistribute` to `DesignLibraryItem`
     (line 32 area); update the file's header comment (lines 1-8), which currently documents
     the old single-field gating rule and would otherwise ship stale.
  4. `apps/daemon/src/routes/design-library.ts` — the three `Set` literals at lines 73/74/86.
  5. `apps/web/src/components/DesignLibrarySection.tsx` — its mirrored copies (lines 72-77) and
     display logic for the new field.
- **R6 · Everything copyable and previewable — except the one unsandboxed route, see R7.**
  `COPYABLE_ALLOWED_USE` and `REFERENCEABLE_ALLOWED_USE` drop `'blocked-pending-license'` and
  keep the other three values — no capability-reduced tier remains for those two sets.
- **R7 · `LIVE_PREVIEWABLE_ALLOWED_USE` must be split, not broadened as one set — DECISION
  REQUIRED for one specific action, see §6.2.** The single constant at
  `apps/daemon/src/routes/design-library.ts:86` currently gates **two different routes with
  different security postures**:
  - `POST /api/design-library/live-preview` (line ~729) calls `openBrowser(entryPath)` — opens
    the item's raw `file://` HTML directly in Devin's real system browser, with **no CSP and no
    sandbox** of any kind.
  - `GET /api/design-library/preview-asset/:rel/*` (line ~821) is served with
    `SANDBOXED_PREVIEW_CSP` and is loaded by the web UI into an iframe with
    `sandbox="allow-scripts allow-popups"` and no `allow-same-origin` — an opaque-origin
    sandbox that already exists today (Devin approved this exact divergence 2026-08-10, MM-019,
    per the route's own code comment).
  Broadening the shared constant to "all items" per the original R6/R7 would silently widen the
  **unsandboxed** route too — meaning the 63 `human-local-only` third-party captures' scripts
  and trackers, plus whatever the 7 previously-blocked items contain, would start executing
  with `file://` privileges in Devin's real browser the moment this ships. That contradicts R7's
  own stated principle ("preserve the security note by sandboxing... not by keeping the
  block") for the one route that isn't actually sandboxed. Split the constant into two — broaden
  the iframe route's set freely per R6; leave the raw `openBrowser` route's set at today's
  `COPYABLE_ALLOWED_USE` until §6.2 is answered.
- **R8 · `redistribute: no` guards this repo's own tracked tree — scope stated honestly.**
  No git hook infrastructure exists in this repo (no husky/lefthook wired in `package.json`),
  and `mishmash-assets` cannot host its own hook (it isn't a git repo). The only real
  enforcement point that runs in this repo's CI is `pnpm guard` (`scripts/guard.ts`, which
  already composes ~15 named `check*` functions the same way). Add one more —
  `scripts/check-design-library-redistribution.ts`, following the existing naming pattern
  (`check-brand-surfaces.ts` etc.) — that fails if any file tracked in `wiggdevin/mishmash`
  matches a `redistribute: no` catalog item's content or path fingerprint. This protects only
  this repository's own tree; it cannot stop a copied file from being committed to some other
  repo Devin creates from a project built here — name that boundary in the PR description so it
  isn't read as a broader guarantee than it is.

### 5.3 P0 — verify they actually work

*"make sure that they are all wired up correctly ready to be used and iterated on"* is a
separate claim from "not blocked," and needs its own check.

- **R9 · Resolution sweep.** For all 277: the file exists at its `rel` path, the tree hash
  matches, the preview renders, and copy-into-project produces a working file. Drive this
  through the existing CLI, not a new script: `od design-library start-project --rel <rel>
  --mode copy` (confirmed present at `apps/daemon/src/cli.ts:9992`) into a scratch project per
  item, check exit 0, then discard the scratch project. **Report every failure** — an item that
  is unblocked but broken is still not usable.
- **R10 · Fix or quarantine.** Anything failing R9 gets repaired, or moved to `_quarantine/`
  with a reason. Never left half-wired.

### 5.4 Dual-track closure (this extends an existing capability — do not build a parallel one)

`od design-library catalog|show|start-project|live-preview|promote|promotions` already exists
(`apps/daemon/src/cli.ts:9990-9995`), already backed by `/api/design-library/*` routes, already
surfaced in `apps/web/src/components/DesignLibrarySection.tsx`, and already typed in
`packages/contracts/src/api/design-library.ts`. R5-R8 are a **schema extension** of that
existing four-surface capability, not a new capability — no new endpoint, CLI subcommand, or
web route is required. Close the loop by verifying the extension reached all four existing
surfaces:

- **R11 · CLI surfaces the new field.** `od design-library catalog --json` and
  `od design-library show <rel> --json` output must include `redistribute`. Extend the existing
  `apps/daemon/tests/design-library/cli.test.ts` with an assertion for it — do not write a new
  test file for something the existing suite already covers the shape of.
- **R12 · Web surfaces the new field.** Extend the existing
  `apps/web/tests/components/DesignLibrarySection.test.tsx` (already mocks a full catalog
  fixture) rather than adding a Playwright spec — no browser interaction is needed to prove a
  label renders or doesn't; this is app-local Vitest + Testing Library, the correct path per
  this repo's test-layout convention (Playwright UI tests are flat files at `e2e/ui/*.test.ts`
  importing from `@/playwright/suite`; this is not that).

### 5.5 Success criteria

1. **Zero** items resolve to `blocked-pending-license` in `catalog.json`, reproducible with the
   command below. The validator (R3) fails when run against a catalog that has one — this is a
   command Devin/an agent runs on demand, **not** a `pnpm guard`/CI gate (see R3's scope note).
2. All 277 items are copyable into a project and referenceable (R6). The sandboxed live-preview
   route (`GET /api/design-library/preview-asset/*`) is live-previewable for all 277; the raw
   `openBrowser` live-preview route (`POST /api/design-library/live-preview`) stays scoped to
   today's `COPYABLE_ALLOWED_USE` pending §6.2.
3. The R9 sweep (via `od design-library start-project --mode copy`) passes for all 277, or every
   exception is quarantined with a written reason.
4. A file whose catalog item has `redistribute: no` cannot be committed into `wiggdevin/mishmash`
   — proven by `scripts/check-design-library-redistribution.test.ts` (R8), wired into `pnpm guard`.
5. `grep -rn "blockedPendingLicense" apps/web/src apps/daemon/src` returns nothing (R4).
6. `pnpm guard`, `pnpm typecheck`, `pnpm i18n:check` exit 0 — all three commands verified to
   exist in `package.json` (lines 20, 22, 30).
7. `apps/daemon/tests/design-library/cli.test.ts` and
   `apps/web/tests/components/DesignLibrarySection.test.tsx` assert `redistribute` is present
   in CLI `--json` output and web display respectively (R11, R12).

### 5.6 Verification

```bash
cd ~/projects/mishmash

# §2/§5.5.1 — item-count and blocked-state re-measurement (reproducible, not a stale number)
python3 - <<'PY'
import json, collections
d = json.load(open('/Users/zero-suminc./projects/mishmash-assets/catalog.json'))
c = collections.Counter(i.get('allowed_use') for g in d['groups'] for i in g.get('items', []))
print(dict(c)); assert not c.get('blocked-pending-license'), 'STILL BLOCKED'
PY

# R3 — the enforcement script, run directly (not part of pnpm guard — see R3's scope note)
node scripts/validate-design-catalog.ts --library-dir ~/projects/mishmash-assets

# R4 — confirm the removed label leaves no dangling reference anywhere
grep -rn "blockedPendingLicense" apps/web/src apps/daemon/src && echo "FAIL: reference remains" || echo "OK: fully removed"

# R8 — repo-guard check runs as part of guard once wired
pnpm guard && pnpm typecheck && pnpm i18n:check

# R11/R12 — package-scoped tests carrying the new field's assertions
pnpm --filter @open-design/daemon test -- design-library/cli
pnpm --filter @open-design/web test -- DesignLibrarySection
```

---

## 6. Decisions required (blocks part of this, not all of it)

### 6.1 DECISION REQUIRED (blocks R1 for 7 items, and therefore success criterion 1 fully)

**Which license covers each of the 6 non-`own-code` blocked items — and is the Generated
Icons item actually `own-code`?**

The original note treated Generated Icons as an obvious, foregone `own-code` classification.
It is not settled: `RIGHTS.md`'s own ledger explicitly declines to classify it —
*"No canonical per-source rights evidence currently supports these ... collections. They
intentionally have no private authorization records and remain blocked until Devin supplies
per-item provenance and rights"* — and the embedded ledger's 9-item `own-code` list (verified
against `catalog.json`'s 9 `own-code` items — exact match) does not include it. It is plausible
(the folder contains AI-generated icon PNGs) but not yet Devin's word on record.

Tell me, per item:
- `01 UI8 Kits/ai-travel-planner-react-typescript`
- `01 UI8 Kits/azurio-digital-agency-and-personal-portfolio-html-template`
- `01 UI8 Kits/mockos`
- `07 Icon Sets/Nucleus-Icon-Set`
- `07 Icon Sets/Stockholm-Icon-Set`
- `04 Design Inspiration/ios/savee`
- `08 Generated Icons/generated-icons` — confirm `own-code`, or name the actual source

the source (UI8 purchase, NeuForm Pro, OFL, a specific vendor, or confirmed own output), and R1
is mechanical for all 7. Alternatively: *"everything in this library is covered, record them
all as licensed"* — say that and R1 applies it uniformly, still excluding Generated Icons
unless separately confirmed `own-code`.

**Until answered:** R2-R6, R8-R12 proceed independently — none of them depend on which license
covers which of these 7 items, only on the field/route mechanics.

### 6.2 DECISION REQUIRED (blocks only the raw-`openBrowser` half of R6/R7 — everything else in
§5 ships regardless)

**Should the unsandboxed `POST /api/design-library/live-preview` route be broadened to all 277
items, matching the letter of "zero blockers, I never want to see a blocker again"?**

Broadening it means previously-restricted third-party content's scripts and trackers execute
with `file://` privileges in Devin's real browser profile the moment this ships — a real,
not hypothetical, exposure for the 63 `human-local-only` items in particular. Three honest
options, in order of effort:

- **(A) Broaden it anyway.** Matches the directive exactly, accepts the exposure.
- **(B) Leave this one action narrowly scoped** (today's `COPYABLE_ALLOWED_USE`) while
  everything else — copy-into-project, referencing, and the already-sandboxed "Explore kit"
  iframe preview — opens up fully for all 277. A single, named, security-motivated exception.
- **(C) Migrate this action to route through the already-sandboxed mechanism** (R7's iframe
  route) instead of opening a raw file — closes the gap properly, larger lift, not scoped here.

Say which. **Until answered, R6 and R7 ship with option (B) as the default** (see §5.5 success
criterion 2) — the safe, non-regressive interpretation — and everything else in this PRD is
unaffected either way.

---

## Revisions

- 2026-08-18 — captured post-demo. Item counts, tier distribution, gating logic, and the rights
  ledger all measured against the live library the same session. No code or records changed.
- 2026-08-18 — repaired for unattended execution (no audit file existed for F009; every claim
  below was re-verified directly against the repo and `mishmash-assets` in this pass):
  - Fixed the `design-library.ts` line citation (`73-79` → `73-86`) and flagged the quoted code
    block as condensed, not verbatim.
  - Re-derived every count and every breakdown table (§2) directly from `catalog.json` rather
    than carrying them over — all matched the original note exactly, so the numbers stand, now
    with a reproducible command attached.
  - **Corrected R2**: proved by direct code reading (`build_catalog.py:373-382` and its TS
    mirror) that "add sources to the ceiling" does not stop new assets from landing blocked —
    3 of the 7 blocked items already sit under a listed, licensed prefix. Replaced with the
    real mechanism (missing per-item `.catalog/rights.json` record, by design of
    `file_drop.py`) and scoped R3 as the actual backstop.
  - **Corrected R3's enforcement claim**: `validate-design-catalog.ts` hard-codes a
    machine-local path and cannot run in CI; it is not, and cannot become, a `pnpm guard`
    gate. Restated as a reliable on-demand command, not automatic enforcement.
  - **Corrected R5**: replaced the proposed two-axis model (`use` + `redistribute`) with one
    new field (`redistribute` only) — the `use` axis was always `full` for every item under
    Devin's own directive and carried no information. Added the full list of files the
    resolution algorithm is duplicated across (Python builder, TS runtime resolver, contracts
    type, route gating sets, web component's mirrored gating sets) so an agent doesn't update
    one and miss the others.
  - **Corrected R6/R7**: found that `LIVE_PREVIEWABLE_ALLOWED_USE` gates two routes with
    different security postures (one CSP-sandboxed iframe, one raw unsandboxed `file://` open)
    and that broadening the shared constant as originally written would silently remove
    protection from the unsandboxed route. Split the requirement and raised it as §6.2 —
    genuinely unresolved, not invented an answer, defaulted to the non-regressive option so the
    rest of the PRD is unblocked.
  - **Corrected §4.2's "public repo" framing**: `mishmash-assets` is not part of any git repo
    (verified) and this product has no project→git-push feature (verified); rescoped R8 to what
    a `pnpm guard` check can actually protect — this repo's own tracked tree — and named that
    boundary instead of implying a broader guarantee.
  - **Corrected R1's Generated Icons assumption**: `RIGHTS.md` explicitly declines to classify
    it `own-code` pending Devin's provenance; folded it into the existing open question rather
    than treating it as settled (§6.1).
  - Added §5.4 (dual-track closure) confirming this finding extends an existing four-surface
    capability (`od design-library ...`) rather than requiring a new one, with exact files/tests
    to extend for each surface (R11, R12) — avoids building a parallel capability per the
    cross-cutting no-duplication rule.
  - Rewrote §6 as two explicitly scoped `DECISION REQUIRED` items, each naming exactly which
    requirements they block and confirming everything else proceeds independently tonight.
  - Updated Effort/Status in the header table to reflect the corrected scope.
