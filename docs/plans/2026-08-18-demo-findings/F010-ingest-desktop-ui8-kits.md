# F010 — Ingest the 19 unwired UI8 kits from the Desktop

| Field | Value |
|---|---|
| Captured | 2026-08-18, post-demo |
| Reported by | Devin |
| Type | **Unwired assets** — content gap |
| Source | `~/Desktop/design extras/UI Kits and Design Systems` — 19 zips, 3.2 GB (re-verified live) |
| Severity | Medium — paid assets sitting unused |
| Effort | **M** for Phase 1 (safe tonight) · **Phase 2 blocked** on 2 owner decisions — see §5.1 |
| Status | 🔬 Scoped — 2 decisions required before full completion |

---

## 1. Raw note (verbatim)

> can we make sure that all these are also wierd in correctly if that havent been already?
> `/Users/zero-suminc./Desktop/design extras/UI Kits and Design Systems`

**Direct answer: none of them have been. All 19 are new** — zero overlap with the 47 kits
already extracted in `mishmash-assets/01 UI8 Kits/`, and none appear in its `_zips/` staging
folder (44 zips).

---

## 2. What is actually in there — re-verified this session, two corrections

Re-measured directly against the live Desktop folder, `mishmash-assets/01 UI8 Kits/`, and the
actual zip contents (not just filenames). Two corrections to the numbers above §1 states them
(§1 is preserved verbatim per this repo's editing convention — the numbers below supersede it):

- **`01 UI8 Kits/` holds 45 kit directories, not 47.** `ls` shows 47 entries because it also
  lists the `_zips/` staging folder and a 0-byte macOS `Icon` marker file alongside the 45 real
  kits. RIGHTS.md's own ledger says it too: **"explicitly authorized each of the 45 current
  collections"** (`mishmash-assets/RIGHTS.md:71`). `_zips/` staging: 44 archives, unchanged.
- **Every per-kit file-type count below was inflated** — `unzip -l` on these Mac-zipped
  archives lists a shadow `__MACOSX/._<name>` AppleDouble resource-fork entry next to almost
  every real file, and the original count included both. Confirmed directly by re-listing and
  excluding `__MACOSX/`:

  | Kit | Original claim | Real count |
  |---|---|---|
  | `awesome-ios-ui-kit-psd` | 42 PSDs | **21 PSDs** — exactly the double-count |
  | `landscape-figma` | 26 `.fig`, 121 `.jpg`, 36 `.ttf` | **13 `.fig`, 120 `.jpg`, 18 `.ttf`** — fig and ttf are exactly halved |

All 19 carry the **same UI8 account token** in their filename, confirmed again this session —
that part of the original claim holds and matters for §3.

### 2a. "Renderable — 4 code kits" — re-examined, not as clean as the label suggested

Actually opening these archives (not just counting extensions) changes the picture for all
four, not just the two the original note flagged:

| Kit | What's actually in the archive |
|---|---|
| `fushion` | A **git checkout** of a Next.js app — `.git/` (462 objects) with real commit history ("fix(app): resolve TypeScript type issues... Pass category parameter to ToolsGrid component... Cast salt parameter to ArrayBuffer in PBKDF2"), a `.vercel/` deploy folder, and a fully-installed `node_modules/` — **22,729 of the archive's 23,520 entries**. Real app source outside `node_modules`/`.git`: ~103 files (40 `.js`, 22 `.ts`, 41 `.tsx`), not the "10,840 `.js` · 3,028 `.ts`" originally claimed (that count was almost entirely `node_modules`). Reads like a working SaaS/tools-directory codebase someone deployed, not a UI8 marketplace "kit" — see §5.5 morning-review item 3. |
| `krafty-resources` | Same pattern — `node_modules/` is **19,790 of 21,115 entries**, plus a full `.git/` history (3,744 objects). It also ships a `.fig` file (`Seraphim personal template.fig`) alongside the code, so it is not cleanly "code-only" either — the 2a/2b split undersells this one. Real source outside `node_modules`/`.git`: ~615 files (605 `.js`, 10 `.ts`), not "10,134 `.js` · 2,549 `.ts`." |
| `planix` | Clean of `node_modules`/`.git`, but it is a **full-stack** Next.js app with live backend API routes (`app/api/messages/threads/[contactId]/meeting/participants/route.ts` and siblings), not a static landing template. 136 `.ts` + 67 `.tsx` (original claimed 152/79). Needs the same render-check scrutiny as `fushion`/`krafty-resources` — the original note only flagged those two. |
| `main-file` | The outer zip's visible content (~71 entries — a `documention/` folder of old Bootstrap-era glyphicon assets) is **not the kit**. The real payload is a nested archive, `Main-File/zuzu-next-app.zip` (393 files, mostly `public/images/`), never inventoried by the original "92 `.png` · 12 `.js` · 8 `.css`" count. Extraction needs an explicit nested-unzip step or this kit ships empty. |

**Net effect:** none of the 4 candidates is a simple drop-in static template. The render check
(R3 / P1b below) has to actually attempt a render for all four, and extraction (R1) needs an
explicit `node_modules/`- and `.git/`-stripping step plus a nested-archive-unzip step — neither
was in the original plan.

### 2b. Not renderable — 15 kits (design source)

`.fig`, `.psd`, `.sketch`, `.xd` files: `athlo`, `awesome-ios-ui-kit-psd` (**21** PSDs, not 42),
`daility-2`, `dashcube`, `glitch-ui-kit-10`, `holo-music-design-system`, `kloset`,
`landscape-figma` (**13** `.fig`, **120** `.jpg`, **18** `.ttf`, not 26/121/36),
`main_file_3in1`, `mentora`, `riskora`, `sienna_social`, `stellar`, `theshoopy`,
`wyr-design-system`.

**A `.fig` cannot be previewed or copied into a project.** MishMash's library serves renderable
assets — `example.html` and friends. So "wire them in" means something genuinely different for
these 15, and treating both groups the same would fail.

**The designated home already exists and is empty:** `mishmash-assets/09 Figma Files/` holds
**0 items** (re-verified this session). Fifteen Figma/Sketch/XD kits are sitting on the Desktop
while the collection built for them is bare. **See §5.3 R5 — this folder has no rights-ledger
prefix entry today, which the original plan did not account for.**

---

## 3. Rights — corrected: NOT already answered, RIGHTS.md itself gates this

The original text (§3, unchanged above) asserted the 19 new kits automatically inherit the
`"01 UI8 Kits/"` → `licensed-source-review` prefix rule because they share a purchase account
with the existing 45. **That conclusion is wrong, and RIGHTS.md says so in its own words:**

> "Devin supplied private UI8 All-Access Basic single-license invoice evidence and explicitly
> authorized each of the 45 current collections... **Future drops remain blocked until
> separately recorded.**"
> — `mishmash-assets/RIGHTS.md:71-75`

And from `.catalog/README.md`: "An explicit private `blocked-pending-license` record is a
universal safe downgrade... **Every non-blocked state still requires an exact matching
ceiling.**" The prefix ceiling can *validate* a claim already made; it cannot *manufacture* one
for an item nobody has recorded yet.

The same-account-token match (re-verified in §2 above) is real, relevant evidence — it's the
exact fact that justified the existing 45. But it is evidence supporting an authorization, not
the authorization act RIGHTS.md requires, and that act is explicitly reserved ("Future drops
remain blocked until separately recorded") rather than automatic.

> **DECISION REQUIRED (blocks R2's licence field, R5, R9, and success criteria 1/3/4 — see
> §5.1).** Does Devin want these 19 new collections recorded `licensed-source-review` on the
> strength of the matching account token alone (extending the exact reasoning already accepted
> for the 45), or does he want to personally confirm before any of them leave
> `blocked-pending-license`? An autonomous agent has no standing to make this call unattended —
> RIGHTS.md's "Future drops remain blocked" line reads as a deliberate control on precisely this
> scenario, not an oversight. **Do not invent an answer.** §5.2 scopes Phase 1 to proceed
> without it.

**Ties to F009 — a *different*, still-real dependency.** F009's own measured state (verified
live this session, see §5.6 baseline) currently has **7** pre-existing `blocked-pending-license`
items, unrelated to this finding. Ingesting 19 new items without a rights decision would add to
that count, re-creating the exact state Devin said he never wants to see. **F009 must resolve
its 7, and the decision above must resolve, before this finding's success criteria 4 ("zero
blocked") can be true — these are two separate blockers, not one.**

---

## 4. What already exists to build on — corrected

The original table cited `POST /api/library/ingest` (`routes/library.ts:538`) as the ingest
mechanism to build on. **That endpoint is the wrong system.** Verified by reading it: it backs
the product's own in-app Library feature (browser-clipper and manual-upload captures), is
explicitly restricted to images/fonts/text/HTML/JSON ("audio, video, and other binaries are
rejected"), and writes into the daemon's SQLite-backed store under `RUNTIME_DATA_DIR`. That is a
completely different system from `mishmash-assets/` — Devin's personal, non-git reference
library that `RIGHTS.md`/`catalog.json` govern — and it cannot ingest a 187 MB UI8 kit zip.

The tooling that actually matches this job already exists in `mishmash-assets/.catalog/`:

| Capability | Where |
|---|---|
| Classify-and-file staging pipeline | `python3 .catalog/file_drop.py propose _inbox/<drop> --json` (read-only route + confidence report) and `python3 .catalog/file_drop.py file _inbox/<drop> --source <url> --licence-ref <ref> --captured-at <RFC3339> [--confirm-route figma\|ui-kit\|site-clone\|app-captures\|site-capture\|icon-set] [--confirm-collision] --json` (atomically files + writes the private hash-bound rights record) |
| Catalog rebuild / consistency check | `python3 .catalog/build_catalog.py` and `python3 .catalog/build_catalog.py --check` |
| Staging areas | `_inbox/` (mode 0700) and `_quarantine/` — both already exist, both empty, re-verified |
| Bulk-import precedent (different system, same shape) | `scripts/import-claude-directory.ts` — how the 353 `design-templates/` entries arrived; not wired into `od` CLI or the web UI (maintainer script) — R10 should follow this precedent, not `/api/library/ingest`'s |
| Font vendoring | `scripts/vendor-fonts.ts` + `vendor-fonts-lib.ts` — also a maintainer script, no CLI/UI surface |
| Validator | `node scripts/validate-design-catalog.ts --library-dir <path>` — **confirmed working right now**: 0 violations across 352 templates / 277 catalog items (see §5.6 baseline) |
| Kit count | **45** current collections in `01 UI8 Kits/` (RIGHTS.md's own count, not 47 — see §2) |
| **UI8-specific batch driver over `file_drop.py`** | ❌ **none** — the existing 45 were filed one at a time by hand. This is the real gap R10 should close (as a thin wrapper — see §5.2 P1c). |

**Figma consumers, corrected.** The original R8 named `figma-plugin/` and the `understand-figma`
skill as the intended consumers of the 15 `.fig`/`.sketch`/`.xd` files. Neither can actually do
that job, verified by reading each:
- `figma-plugin/` runs the *opposite* direction — it rebuilds an OD web capture into Figma
  layers, from inside Figma. Its own README: **"You cannot open `.od-figma.json` by dragging it
  into Figma... a native `.fig` can't be produced outside Figma."**
- `understand-figma` (global skill) drives the Figma REST API, which requires the file to
  already be hosted on Figma's own servers with an accessible file key — it cannot point at a
  local downloaded `.fig` binary.

Getting a `.fig` file in front of either tool requires a human to open it in the Figma desktop
app (or upload it to a Figma account) first. That's a human-in-the-loop step no autonomous agent
can complete overnight — corrected in §5.3 R8 and moved to §5.5 morning review.

**Dual-track closure — considered, does not apply here.** AGENTS.md's UI/CLI dual-track rule
governs user-facing product capabilities. This finding's ingest tooling (`file_drop.py` wrapper,
`scripts/import-ui8-kit.ts`) operates on `mishmash-assets/` the same way `import-claude-
directory.ts` and `vendor-fonts.ts` already do: neither has an `od` subcommand or a web surface,
and `.catalog/promote.py`'s own header says it is "intentionally external to the daemon... never
launched, supervised, or imported by MishMash." That precedent is consistent — this class of
tooling is not a dual-track capability. Where Phase 2 adds entries to `design-templates/` (the
*already* dual-tracked, UI/advisor-browsable catalogue per F001/F007), no new endpoint/DTO/CLI/UI
work is needed; the existing surfaces just get more data, gated on §5.1 decision 2.

---

## 5. PRD

**Two decisions block full completion (§5.1) and must not be invented — see §3 and below. The
plan is split into Phase 1, safe to run unattended tonight regardless of those decisions, and
Phase 2, gated on them.**

### 5.1 DECISION REQUIRED — blocks Phase 2 only

1. **Rights authorization for the 19 new UI8 collections** (§3). Blocks: recording any of the 19
   as `licensed-source-review`; therefore blocks success criteria 1/3/4 and R5/R9's final state.
2. **Licensing architecture for "code kit → MishMash template."** Every existing
   `design-templates/<id>/` entry is self-contained and **committed to git** in
   `wiggdevin/mishmash` (confirmed live: `origin` = `git@github.com:wiggdevin/mishmash.git`,
   a real remote, not a fork sandbox), including a baked `example.html`. RIGHTS.md is explicit
   that UI8 source files are "never redistributed, never committed to any git repo" — it allows
   "adapted code... fine in a client repo" but says the *original kit archive* is not. Whether a
   MishMash-shipped template (visible to every MishMash user, in that same repo) counts as
   permitted "adaptation into an end-product" or forbidden "redistribution of source" is not
   resolved by anything in this repo today. The original R1–R4 quietly assumed the permissive
   reading by proposing the exact pipeline used for the MIT-licensed `claude-directory` imports —
   a different license entirely. **This is a legal-exposure question, not a technical one; an
   autonomous agent must not resolve it by proceeding anyway.** Blocks: R1–R4 in full (committing
   any of the 4 code kits into `design-templates/`).

Answering these two turns Phase 2 back on. Nothing else in this PRD depends on them.

### 5.2 Phase 1 — safe to run unattended tonight, no decision needed

- **P1a · Stage the 19 drops through the existing filer (R1, corrected scope).** For each zip:
  unzip to a scratch dir, strip `node_modules/` and `.git/` (confirmed dominant in `fushion` and
  `krafty-resources` — see §2a), unzip any nested archives found (confirmed needed for
  `main-file`), then move the cleaned tree into `_inbox/` and run
  `python3 .catalog/file_drop.py propose _inbox/<drop> --json` for a read-only route +
  confidence report. **Do not run `file_drop.py file` yet** — that step writes the rights record
  and is gated by §5.1 decision 1.
- **P1b · Render-check all four code-kit candidates (R3, corrected scope).** `fushion`,
  `krafty-resources`, `planix`, `main-file` — all four, not just the two the original note
  flagged (§2a). For each: attempt `pnpm install && pnpm build` (or the kit's own build script)
  in an isolated scratch checkout, serve the output, and record pass/fail plus a screenshot. A
  kit that needs a database, auth provider, or other unavailable backend to render (plausible for
  `planix` and `fushion`, both of which ship live API routes) fails this check and routes to the
  "not a template" pile. This is the automated oracle replacing the original's human "say so"
  judgment call (cross-cutting rule: no human gates).
- **P1c · Build the repeatable driver (R10, scoped as a thin wrapper, not a rewrite — see §4).**
  `scripts/import-ui8-kit.ts`: unzip → strip `node_modules/`/`.git/` → unzip nested archives →
  shell out to `file_drop.py propose`/`file` (do not reimplement its classify/hash/collision
  logic, which already exists and is battle-tested) → for a kit that passes P1b, prepare (but do
  not commit — gated by §5.1 decision 2) a draft `design-templates/<id>/` entry. `--json` output,
  one invocation per zip, idempotent on re-run.
- **P1d · Extract preview images / generate thumbnails for the 15 design-source kits (R6,
  unchanged in intent).** Stage into `_inbox/` trees, ready for `file_drop.py file` once §5.1
  decision 1 resolves.
- **P1e · Harvest fonts (R11, corrected count).** `landscape-figma` carries the Montserrat family
  — **18 `.ttf` files** (6 weights × regular/italic + the OFL license, re-verified — not "36
  `.ttf`"), not a separate 36-file font drop. Route through `vendor-fonts.ts`. State the outcome
  as "adds Montserrat if not already vendored," not a fixed increment to a specific family total
  — the typefaces catalogue is built by scanning `design-templates/*/fonts/fonts.css` at runtime
  (`apps/daemon/src/typefaces/catalogue.ts`), so any hardcoded "current total" (the original's
  "93 families," itself a claim from F008, a sibling finding not yet built) is stale the moment
  it's written. Measure it live with the command in §5.6 instead of citing a number here.
- **P1f · F007 dependency, scoped down (R2, corrected).** R2's `section`/`style`/`theme`/`mood`
  facets are real — confirmed in `F007-filter-standardization-and-section-facets.md`'s Addendum
  A — but **not implemented anywhere in this repo yet**: `scripts/design-taxonomy.ts` today
  exports only `CATEGORIES`/`CATEGORY_LABELS`/`LEGACY_CATEGORY_MAP`, and F007 itself is still
  status "🔬 Scoped." Populate `od.category` and `od.scenario` (both exist today, confirmed) on
  every new entry; leave the four new facets as an explicit `// TODO(F007)` marker rather than
  fabricating values against a vocabulary that doesn't exist yet. **This is a second, previously
  unstated hard dependency (alongside F009) — do not block Phase 1 on it; just don't invent the
  facet values.**

### 5.3 Phase 2 — gated on §5.1's two decisions

- **R5 · File the 15 design-source kits into `09 Figma Files/`** via
  `file_drop.py file --licence-ref <per decision 1> --confirm-route figma`, once decision 1
  resolves. **Correction: `09 Figma Files/` has no prefix entry in RIGHTS.md's machine ceiling**
  (only `01`–`06` are listed, re-verified) — filing here with any `licensed-source-review` claim
  will be rejected by the ceiling check unless RIGHTS.md's embedded ledger also gets a
  `"09 Figma Files/": "licensed-source-review"` prefix added. Add that prefix as part of R5, not
  as an afterthought discovered mid-run.
- **R7 · Mark them honestly** as reference/handoff assets, not buildable templates — unchanged
  from the original, already correct.
- **R8 · Figma-tool routing, corrected scope (see §4).** Drop the "route through `figma-plugin/`
  or `understand-figma`" requirement from the automated run — neither tool can consume a raw
  `.fig` file unattended. Replaced by a morning-review item (§5.5).
- **R1–R4, final commit step.** Once decision 2 resolves, whichever of `fushion` /
  `krafty-resources` / `planix` / `main-file` passed P1b's render check gets its prepared draft
  committed into `design-templates/`, validated
  (`node scripts/validate-design-catalog.ts`), and indexed.
- **R9 · Rights records, final state.** Every one of the 19 items gets a `file_drop.py file` call
  with an explicit `--licence-ref`, once decision 1 resolves.

### 5.4 Success criteria — Phase 1 (verifiable unattended tonight)

1. All 19 zips have a `file_drop.py propose --json` report on file. Verify:
   `for d in _inbox/*/; do python3 .catalog/file_drop.py propose "$d" --json || exit 1; done`
   exits 0 and prints 19 reports.
2. All four code-kit candidates (`fushion`, `krafty-resources`, `planix`, `main-file`) have a
   P1b render-check result recorded — pass or documented fail, none left uninspected.
3. Staging for all 15 design-source kits is prepared under `_inbox/` with thumbnails generated
   where source material allows — file-existence check, not a human look.
4. `scripts/import-ui8-kit.ts` exists, runs with `--json`, and is idempotent on a second run
   against the same zip (exit 0, no duplicate `_inbox/` entries created).
5. No `file_drop.py file` (as opposed to `propose`) call was made for any of the 19 items — i.e.
   Phase 2's rights-writing step genuinely did not run, honoring §5.1's gate. Verify by confirming
   `.catalog/rights.json`'s modification time is unchanged from session start.
6. `pnpm guard` and `node scripts/validate-design-catalog.ts --library-dir ~/projects/mishmash-assets`
   both exit 0. **Baseline measured live this session: 0 violations, 352 templates, 277 catalog
   items** — re-run and diff against this baseline; don't assume it still holds by the time this
   PRD executes.

**Full-completion criteria — blocked on §5.1, do not attempt tonight:** zero
`blocked-pending-license` items among the 19 new kits; `09 Figma Files/` populated with filed,
rights-recorded entries; any render-passing code kit committed into `design-templates/`.

### 5.5 Morning review (Devin — not the agent, does not block Phase 1)

1. Answer §5.1's two decisions so Phase 2 can run.
2. Open each of the 15 `.fig`/`.sketch`/`.xd` files in the Figma desktop app once, so
   `understand-figma`'s REST-API path can reach them afterward (R8's real unblock — a human
   action, not an automatable one).
3. `fushion` reads like a real, previously-deployed SaaS/tools-directory codebase — full git
   history, a `.vercel/` deploy folder, commit messages about "ToolsGrid" and PBKDF2 auth.
   Confirm it's actually a UI8 purchase (same account token, matching §2/§3's evidence) and not
   something else that landed in this folder, before deciding whether P1b's render-check result
   for it should ever reach Phase 2.

### 5.6 Verification

Baseline, measured live this session before any change:

```
pnpm guard exit code: (run and record before starting — not re-verified in this pass)
validate-design-catalog.ts: 0 violations, 352 templates, 277 catalog items
catalog.json allowed_use breakdown: {'licensed-source-review': 198, 'blocked-pending-license': 7,
                                      'human-local-only': 63, 'own-code': 9}
```

```bash
cd ~/projects/mishmash
node scripts/validate-design-catalog.ts --library-dir ~/projects/mishmash-assets

python3 - <<'PY'
import json, collections
d = json.load(open('/Users/zero-suminc./projects/mishmash-assets/catalog.json'))
c = collections.Counter(i.get('allowed_use') for g in d['groups'] for i in g.get('items', []))
print(dict(c))
print('total items:', sum(len(g.get('items', [])) for g in d['groups']))
# NOTE: this assert only becomes meaningful once F009's 7 pre-existing blocked items are
# resolved AND §5.1 decision 1 is answered. Running it before either is done will correctly
# fail — that is not a bug in this finding, it's F009's and this finding's actual dependency
# made visible. Do not weaken the assert to make it pass early.
assert not c.get('blocked-pending-license'), 'BLOCKED ITEMS PRESENT'
PY

# Phase 1 criterion 1 — all 19 proposed
cd ~/projects/mishmash-assets
for d in _inbox/*/; do python3 .catalog/file_drop.py propose "$d" --json || exit 1; done

# Phase 1 criterion 3 — Figma staging folder still correctly empty of *filed* entries pre-decision
find "09 Figma Files" -mindepth 1 | wc -l   # expect 0 until §5.1 decision 1 resolves and R5 runs
```

---

## 6. Notes for Devin

1. **3.2 GB lands in `mishmash-assets/`, which is non-git staging — correct, and it must stay
   that way.** F009's `redistribute: no` axis is what keeps UI8 source files out of the public
   repo automatically. Re-verified this session: `mishmash-assets/` has no `.git` of its own, and
   `pnpm guard` (scoped to `~/projects/mishmash`) never touches it — nothing that happens there
   affects that check.
2. **The licensing question for the 4 code kits is bigger than "will they render."** See §5.1
   decision 2: committing a UI8-licensed kit's code into `design-templates/` means committing it
   to a public git repo, which RIGHTS.md's own text forbids for "the original kit archive." I'd
   rather ask than assume the same rule that applies to MIT-licensed community templates also
   covers a paid UI8 purchase.
3. **Is the Desktop folder the only unwired stash?** If there are others, name them and I'll
   sweep them in the same pass rather than one finding at a time.

---

## Revisions

- 2026-08-18 — captured post-demo. Archive contents, overlap against the indexed 47, rights
  prefix rule, and available ingest tooling all verified the same session. Nothing extracted or
  changed.
- 2026-08-18 (repair pass, no audit file existed for F010 — corrections below are from direct
  verification against the live repo/filesystem, run this session):
  - **Kit count corrected 47 → 45.** `01 UI8 Kits/` has 45 real kit directories; `_zips/` and
    `Icon` inflated the `ls`-based count. RIGHTS.md's own text says "45 current collections."
    §1's raw-note wording ("the 47 kits") is preserved verbatim per this repo's editing rule and
    is now superseded by §2's corrected count — read §2, not §1, for the number.
  - **Rights claim reversed.** §3 originally said the 19 new kits automatically inherit
    `licensed-source-review`. RIGHTS.md's own text ("Future drops remain blocked until separately
    recorded") says the opposite — this is a genuine, unmade decision, now flagged as
    **DECISION REQUIRED** in §5.1, not resolved by this pass.
  - **§4's cited "existing capability" was wrong.** `POST /api/library/ingest` is the product's
    own in-app Library feature (SQLite-backed, images/fonts/text/HTML/JSON only) — a different
    system from `mishmash-assets/`. Replaced with the actual matching tooling:
    `mishmash-assets/.catalog/file_drop.py` (`propose`/`file`) and `build_catalog.py`, both
    read and confirmed working.
  - **R8's named tools corrected.** `figma-plugin/` exports OD captures *into* Figma (opposite
    direction) and `understand-figma` requires a file already hosted on Figma's servers — neither
    can consume a raw downloaded `.fig`. This was an unstated human-in-the-loop gate; moved to
    §5.5 morning review.
  - **Per-kit file counts were systematically inflated**, several by exactly 2x, from counting
    macOS `__MACOSX/._*` resource-fork shadow files as real content. Confirmed and corrected for
    `awesome-ios-ui-kit-psd` (42→21 PSDs) and `landscape-figma` (26→13 `.fig`, 36→18 `.ttf`); the
    same defect is flagged (not hand-corrected) for the 4 code kits, whose counts were dominated
    by a different, more consequential problem below.
  - **`fushion` and `krafty-resources` ship complete `node_modules/` and `.git/` histories** —
    verified by unzip listing: 22,729/23,520 and 19,790/21,115 entries respectively are
    `node_modules`, undiscussed in the original plan. `krafty-resources` also ships a `.fig`
    file alongside its code. `planix` has live backend API routes, not a static template.
    `main-file`'s real payload is a nested zip never inventoried by the original count. All four
    corrected in §2a; R1/R3/R10 rescoped in §5.2 to handle stripping, nesting, and full-app
    render checks.
  - **New DECISION REQUIRED (licensing architecture, §5.1 item 2):** turning a UI8-licensed code
    kit into a git-committed `design-templates/` entry was not checked against RIGHTS.md's
    "never committed to any git repo" rule for UI8 source files. Flagged, not resolved.
  - **New unstated dependency on F007:** R2's four new facets (`section`/`style`/`theme`/`mood`)
    are defined in F007 Addendum A but not yet implemented in `scripts/design-taxonomy.ts`. Phase
    1 is rescoped to populate only the facets that exist today (`od.category`, `od.scenario`) and
    mark the rest `// TODO(F007)` rather than fabricate values.
  - **Removed the stale "93 families" cross-reference** (from sibling finding F008, itself
    unshipped) in favor of a live-measurement instruction, per the no-unverified-counts rule.
  - **09 Figma Files/ has no RIGHTS.md prefix entry** — filing the 15 design-source kits there
    under the existing `01 UI8 Kits/` reasoning would be rejected by the machine ceiling. R5 now
    includes adding the missing prefix.
  - Restructured §5 into Phase 1 (unattended-safe tonight) / Phase 2 (gated on §5.1) and replaced
    the two human-judgment success criteria (render "looks right," rights "confirmed correct")
    with automated oracles; the genuine human steps moved to §5.5 morning review, which does not
    block Phase 1.
