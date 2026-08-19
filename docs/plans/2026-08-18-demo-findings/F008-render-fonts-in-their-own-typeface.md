# F008 — Show every font in its own typeface

| Field | Value |
|---|---|
| Captured | 2026-08-18, post-demo |
| Reported by | Devin |
| Type | **Missing capability** (UI-only gap) |
| Area | `apps/web/src/components/TypefacesSection.tsx` · `apps/daemon/src/routes/typefaces.ts` |
| Severity | Medium — high value, low cost |
| Effort | **S** for P0 — every prerequisite is already indexed; see §2 for a corrected complexity note (the face count assumption in the original note was wrong) |
| Status | 🔬 Scoped — repaired 2026-08-18 for unattended execution; no audit file existed for this finding, so every claim below was re-verified against the repo and a live daemon in this pass (see Revisions) |

---

## 1. Raw note (verbatim)

> We want all the fonts to be shown in their actual font please, that way its super easy to see
> what each looks like

---

## 2. Why this is a small job

Everything needed for P0 is already in place. **Only the rendering is missing.**

| Prerequisite | State |
|---|---|
| Indexed families | ✅ **93**, via `apps/daemon/src/typefaces/catalogue.ts` — verified live this session (`GET /api/typefaces` → `typefaces.length === 93`, `scannedFamilies === 114`) |
| Per-face metadata | ✅ filename, `format`, `weight`, `style`, `unicodeRange` — but **not** bounded at "8 faces/family"; see the corrected note below, it changes R2/R5/R7 |
| Licence metadata | ✅ **OFL-1.1 ×92, Apache-2.0 ×1** — sources: Google Fonts ×91, Inter project (rsms.me) ×2 — verified live against every family's `license.spdx`/`license.sourceLabel` this session |
| A reusable serving *pattern* | ✅ `apps/daemon/src/routes/static-resource.ts:99-159,668-674` already implements the extension-whitelist + path-containment + realpath-check shape a new route needs — but it backs a *different* resource root; see the R1 correction below |
| **Rendering in-face** | ❌ **absent** |

`TypefacesSection.tsx` (`apps/web/src/components/TypefacesSection.tsx`) contains **no `fontFamily`
and no `font-family`** — confirmed by direct search of the file. The only font declaration in
`TypefacesSection.module.css` is `font-family: var(--mono, monospace)` at line 130 — so today the
page lists font *names* set in a monospace UI font. A type catalogue that shows no type.

### Corrected: file/directory counts (re-measure at execution time, don't trust a fixed number)

The original note's counts (5,353 files across 306 `fonts/` directories) do not match a fresh scan
taken during this repair pass, and `design-templates/` is an actively growing tree (see F010,
ingest work) — a hardcoded count will go stale again. Re-run this instead of citing a number:

```bash
find design-templates -iname fonts -type d | wc -l                                           # fonts/ dirs
find design-templates -path '*/fonts/*' -type f \( -iname '*.woff2' -o -iname '*.woff' \
  -o -iname '*.ttf' -o -iname '*.otf' -o -iname '*.eot' \) | wc -l                             # font files
```

Measured during this repair (2026-08-18): **316** `fonts/` directories, **5,181** font-format files
(5,163 `.woff2` + 7 `.woff` + 7 `.ttf` + 4 `.eot`). The **93 licence-cleared families** and the
**OFL-1.1 ×92 / Apache-2.0 ×1** split are API-reported, not a directory scan, and were reconfirmed
live against the running daemon in this same session — trust those two figures over any raw
file/directory count, and re-run `GET /api/typefaces` rather than citing "93" as a permanent fact if
much time has passed.

### Corrected: face count is not "up to 8/family" — this changes R2/R5/R7

The original note's per-face metadata line claimed `faceCount (up to 8/family)`. **That is false**,
and the requirements below are written around the corrected number. Measured live against every one
of the 93 families (`GET /api/typefaces/:id` for each id, this session):

- **48 of 93 families** have more than 8 `@font-face` entries.
- The **maximum is 707** (`Noto Sans SC`), followed by `Noto Serif SC` (606), `Noto Sans JP` (248),
  `Noto Serif JP` (248).
- Cause: these CJK families ship one file **per weight × per Unicode-range subset**, not one file
  per weight — `Noto Sans SC` is 7 weights × 101 subset files, all `style: "normal"`. This is the
  standard Google Fonts subsetting shape, not a data error, and `apps/daemon/src/typefaces/
  catalogue.ts`'s `facesByFamily` map already dedupes by `(weight, style, unicodeRange)` across every
  template that references the family — the 707 count is real, not an artifact of double-counting.
- Every one of the 93 families **does** carry, for each weight, one subset whose `unicodeRange` fully
  spans Basic Latin (`U+0000-00FF…`) and is consistently named `<slug>-latin-<hash>.woff2` — verified
  across all 93 (e.g. `noto-sans-sc-latin-a9b0cb83a0.woff2`, `barlow-latin-13717d5594.woff2`). So
  rendering the family name in-face is achievable for all 93 — but **only if face selection is
  Unicode-range-aware**. Picking `faces[0]` (raw array order) will not reliably land on the Latin
  subset for a multi-script family; see R2/R3/R5/R7.
- `classification.weights` / `classification.styles` (same file, `classificationFor()`) are already
  `Set`-backed and therefore already deduplicated per family, unaffected by the subset explosion —
  use those two fields to decide *which* weights to render, never a raw `faces.length`.

### Corrected: R1's "wire a scoped route to it"

`static-resource.ts:668-674` is real, and its safety pattern (`sendSkillSubresource`,
`static-resource.ts:99-159`: extension whitelist + path containment + realpath symlink check) is
exactly the shape a new route needs — **but the existing route it backs, `GET
/api/skills/:id/fonts/*splat` (`static-resource.ts:669`), resolves `:id` through
`listAllSkillLikeEntries()`/`findSkillById` and roots every path under `skill.dir/fonts/`.** It has
no relationship to `DESIGN_TEMPLATES_DIR` or the typeface catalogue's
`IndexedTypefaceFace.sourcePath` map (`apps/daemon/src/typefaces/catalogue.ts`). There is no way to
"wire" the typeface index onto that endpoint by routing through it — a **new** route is required.
Reuse the **pattern**, not the **endpoint**. R1 below gives the corrected shape.

### Prior art to reuse, not duplicate (cross-cutting rule: don't build a parallel mechanism)

`apps/web/src/components/DesignKitView.tsx` (`useBrandFonts`, roughly lines 132-206) already does
almost exactly this on the client, for a different surface: it injects Google Fonts `<link>` tags
and a dynamically-built `<style>` block of `@font-face` rules pointing at a fetchable URL
(`projectRawUrl`, `apps/web/src/providers/registry.ts:2220`), then tears the `<style>` element down
on unmount/change. **Follow this exact technique** — dynamic `@font-face` injection plus a cleanup
effect — for the specimen rendering instead of inventing a new one; factor a shared helper if the
two call sites end up wanting the identical shape, but do not diverge the pattern.
`registry.ts:2220-2232` also shows the codebase's convention for a scoped static-URL builder
(`projectRawUrl`, `designSystemStaticUrl`); add a `typefaceFaceUrl(id, file)` following that same
convention in `apps/web/src/providers/typefaces.ts`, which already owns every other
`/api/typefaces*` client call per its own header comment.

### Licensing: cleared

**Every indexed family is OFL-1.1 or Apache-2.0.** Both licences explicitly permit embedding and
display. There is no rights obstacle to live specimens — reconfirmed this session.

---

## 3. PRD

### 3.1 P0 — specimens on the typefaces page

- **R1 · Serve the faces.** Add `GET /api/typefaces/:id/faces/:file` in
  `apps/daemon/src/routes/typefaces.ts`. Look the family up through the existing index (`getTypeface`
  in `apps/daemon/src/typefaces/catalogue.ts`) and serve `:file` **only** when it exactly matches one
  of that family's already-indexed `face.file` values — match against the pre-built index rather than
  deriving a filesystem path from request input; this has no traversal surface to defend, which is
  strictly simpler than `sendSkillSubresource`'s containment check. Stream the matched
  `face.sourcePath` (already an absolute path, already containment-checked at index-build time —
  `catalogue.ts:146-147` rejects a stylesheet pointing outside its own template directory) with
  `res.type(mimeFor(sourcePath)).sendFile(sourcePath)` — an absolute path is a valid `sendFile` call
  on its own, no `root` option needed, since (unlike the skills route) nothing here is attacker-
  controlled. Reuse `mimeFor` from `apps/daemon/src/projects.ts:1705` (`.woff2` → `font/woff2`); add
  `'resources'` to `RegisterTypefaceRoutesDeps`'s `RouteDeps<...>` list to get `ctx.resources.mimeFor`
  (mirroring how `static-resource.ts` already consumes it), or import it directly from
  `../projects.js`. Every indexed face is `format: "woff2"` today — verified across all 93 families'
  full face lists: 2,634/2,634 faces report `format: "woff2"`. Reject any other extension
  defensively, but the five-extension whitelist at `static-resource.ts:668` does not apply here;
  woff2-only is correct and simpler.
  - **R1a · Dual-track closure, with an explicit carve-out.** `od typefaces list/show/install` already
    exists (registered at `apps/daemon/src/cli.ts:936`, implemented as `runTypefaces` at line 9725)
    and already mirrors `GET /api/typefaces`, `GET /api/typefaces/:id`, `POST
    /api/typefaces/:id/install` with `--json` on every subcommand — the browse/install capability is
    **already** dual-tracked. R1's new route is binary asset-serving plumbing for *rendering* that
    same capability, not a new standalone capability, and a terminal cannot render a font face — so
    it does not need its own `od` subcommand. Per AGENTS.md's own carve-out language ("explain in the
    PR body why the missing surface is genuinely not applicable"), **the PR body must say this
    explicitly**, not leave the CLI checkbox silently unticked.
- **R2 · `@font-face` per family**, generated from the catalogue's real per-face data. For a given
  weight/style, register **every** Unicode-range-partitioned file for that weight/style as its own
  `@font-face` rule sharing one `font-family` name — that is what lets the browser assemble full
  glyph coverage per character, and it is how Google Fonts subsetting is meant to be consumed (see
  the 707-face correction above). Do not collapse a weight to a single file for the detail view.
- **R3 · Render the family name in its own face.** That is the literal ask: the name of the font *is*
  the specimen. For every family, use the weight's Latin-covering subset — `unicodeRange` spanning
  `U+0000-00FF`, filename matching `<slug>-latin-<hash>.woff2`, verified present for all 93 families
  this session — not `faces[0]`.
- **R4 · A specimen line per family — decided by default, not left open.** The original note posed
  this as an open question for Devin ("pangram, weight ramp, or your own words?"). An open question
  is a human gate an unattended run cannot wait on overnight. **Default: the family name, large, plus
  one short fixed phrase used identically across every card** — the note's own stated recommendation
  ("comparability is the point, and a shared phrase makes differences pop"), promoted here from
  suggestion to default so the run is not blocked. Record this default and the exact phrase chosen in
  the PR body under a **"Morning review"** heading so Devin can override the wording later without it
  blocking tonight's build. See §4.
- **R5 · Show real weights.** Use `classification.weights` / `classification.styles` (already
  `Set`-deduplicated, unaffected by the 707-face subset explosion — see above) to decide *which*
  weights to render, and render exactly those. Do **not** synthesise bold/italic — faux-bolding a
  specimen misrepresents the typeface.

### 3.2 Correctness constraint — the important one

- **R6 · A failed font load must be visible.** If a face does not load, the browser silently falls
  back to a system font, and the card then shows a *different typeface under the wrong name*. **That
  is worse than no specimen**, because it actively misinforms a design decision. Detect load failure
  (`document.fonts.check` / `FontFace.load()`) and mark the family unavailable rather than rendering
  a lie.

### 3.3 Performance constraint

- **R7 · Do not load 93 families eagerly, and do not assume 8 faces is the ceiling.** With a verified
  maximum of 707 faces on one family (§2) and 48/93 families over 8 faces, eagerly loading everything
  would be far worse than the original note assumed. Required:
  - Grid view: fetch **one** face per visible family — specifically the Latin-covering, name-
    rendering face from R3 (one `@font-face` rule, one file per family), never an arbitrary index-0
    face.
  - Detail view (explicit user action on one family): fetch every Unicode-range partition for the
    deduplicated weights from R5, per R2's full-coverage rule. For `Noto Sans SC` that is still 7
    weights × ~101 subsets ≈ 700 requests — acceptable for one explicit per-family action, but this
    is exactly why the grid must never do this by default.
  - Lazy-load on viewport intersection.
  - `font-display: swap`, so text is legible while faces load.
- **R8 · Cache-friendly, immutable URLs.** Face filenames are already content-hashed (e.g.
  `albert-sans-latin-acf304385d.woff2`) — serve `GET /api/typefaces/:id/faces/:file` responses with
  `Cache-Control: public, max-age=31536000, immutable`. **Do not copy** the header from the nearest
  existing sibling route, `GET /api/design-systems/:id/static`
  (`apps/daemon/src/routes/design-systems.ts:262-272`), which sets `Cache-Control: no-store` — that
  route serves mutable files; this one serves immutable, hash-named ones, and the two must not share
  a header choice.
- **R-i18n · New UI strings need typed keys.** Any new user-facing string this adds (the R6/R9
  "specimen unavailable" marker, a loading state, etc.) must be added to
  `apps/web/src/i18n/types.ts` first, then `apps/web/src/i18n/locales/en.ts`, per AGENTS.md's
  English-only i18n rule — `pnpm i18n:check` fails on a key that is used but not typed.

### 3.4 P1 — everywhere else a font is named

*"all the fonts"* is broader than one page. Once R1–R3 exist:

- **DECISION REQUIRED (blocks this bullet) — F001's advisor output.** The original note proposed
  applying the same treatment to "the font pairing table (`EB Garamond`, `Crimson Pro`, `Fraunces`,
  `Inter`…)" in F001's conversational template advisor. **F001 does not exist in the codebase yet** —
  `docs/plans/2026-08-18-demo-findings/F001-conversational-template-advisor.md` is itself an unbuilt
  finding, status "📝 Captured → 🔬 Scoped." There is no advisor-output component to touch tonight.
  This bullet is **out of scope for an unattended run** until F001 lands; do not let an executing
  agent go looking for a component that doesn't exist.
- **`MissingBrandFontsBanner.tsx`** — this one is real:
  `apps/web/src/components/MissingBrandFontsBanner.tsx` exists (tested at
  `apps/web/tests/components/MissingBrandFontsBanner.test.tsx`). Naming an absent font is exactly
  when seeing it helps. In scope as genuine P1 follow-up once R1–R3 land.
- **R9 · Graceful degradation for un-indexed families.** A recommended font may not be among the 93.
  The original note's example, `Söhne`, is unverifiable today (F001 doesn't exist yet to actually
  recommend anything, and `Söhne` is not vendored anywhere in `design-templates/`, confirmed by
  search) — treat it as illustrative, not a tested case. Un-indexed families render in the UI font
  with an explicit "specimen unavailable" marker — never silently unstyled, per R6.

### 3.5 Success criteria

Every criterion has a machine oracle. None of these are "look at it and judge" — see §3.6 for how
each one is actually checked.

1. `GET /api/typefaces` reports `typefaces.length === 93` (re-run the §2 measurement first if the
   template set has changed since this pass), and for each returned family:
   `document.fonts.check('16px "<family>"', family)` returns `true` in the rendered page, **and**
   the specimen element's computed `font-family` includes that family name.
2. For each family, the number of distinct rendered weights in the DOM equals
   `classification.weights.length` (or the variable range renders as one control) — no extra
   synthesised weight/style is present.
3. Simulate a load failure via Playwright route interception (abort or 404 one family's face
   request) and assert (a) the unavailable marker is present in the DOM for that family, and (b) no
   element for that family has `font-family` resolving to the failed family name.
4. Load the typefaces page and assert, via Playwright request capture (`page.on('request')` /
   `waitForRequest` counts — not manual DevTools inspection), that **at most one**
   `/api/typefaces/:id/faces/:file` request fires per family visible without scrolling.
5. A response from `GET /api/typefaces/:id/faces/:file` carries `Cache-Control: public,
   max-age=31536000, immutable` — asserted directly on the response headers in a Vitest daemon-route
   test.
6. `pnpm guard`, `pnpm typecheck`, `pnpm i18n:check` exit 0.

### 3.6 Verification

```bash
cd ~/projects/mishmash

# Start a local daemon+web explicitly — do not assume one is already listening on a guessed port.
pnpm tools-dev start web --daemon-port 17456 --web-port 17573
sleep 3

# Family/licence counts — the stable, API-reported facts (re-confirm, don't hardcode).
curl -s http://127.0.0.1:17456/api/typefaces \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d['typefaces']),'families')"

# New face-serving route (R1) returns a real font with the right headers, not JSON/HTML.
FID=$(curl -s http://127.0.0.1:17456/api/typefaces \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['typefaces'][0]['id'])")
FFILE=$(curl -s http://127.0.0.1:17456/api/typefaces/$FID \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['typeface']['faces'][0]['file'])")
curl -sI "http://127.0.0.1:17456/api/typefaces/$FID/faces/$FFILE" | grep -i '^content-type: font/woff2'
curl -sI "http://127.0.0.1:17456/api/typefaces/$FID/faces/$FFILE" \
  | grep -i '^cache-control: public, max-age=31536000, immutable'

pnpm tools-dev stop

pnpm guard && pnpm typecheck && pnpm i18n:check

# Playwright UI test — flat file under e2e/ui/, NOT e2e/specs/ (specs/ is the Vitest tree; a
# `specs/*.spec.ts` Playwright invocation is not a valid path in this repo). Import test/expect
# from '@/playwright/suite' per AGENTS.md and e2e/AGENTS.md.
pnpm --filter @open-design/e2e exec playwright test -c playwright.config.ts ui/typeface-specimens.test.ts

# Daemon-side route/index test — Vitest, app-local, sibling to src/ per the AGENTS.md boundary rule.
pnpm --filter @open-design/daemon test -- typefaces
```

`e2e/ui/typeface-specimens.test.ts` and the daemon route test (extend
`apps/daemon/tests/typefaces-catalogue.test.ts`, or add a sibling
`apps/daemon/tests/typefaces-serve-face.test.ts` following that file's existing fixture pattern) do
not exist yet — writing them is part of this PRD's own scope (R1/R2/R6/R7), not a pre-existing check
to merely re-run.

---

## 4. Decisions

- **Specimen text (R4): decided, not open.** The original note's open question ("pangram, weight
  ramp, or your own words?") is resolved by default per the no-human-gates rule: family name + one
  shared fixed phrase across every card. This does not block execution. Log the exact phrase chosen
  in the PR body's "Morning review" section so Devin can change it later without re-opening the
  feature.
- **DECISION REQUIRED (blocks the F001 bullet in §3.4).** Whether and how to apply in-face rendering
  to F001's font-pairing table cannot be decided or built tonight — F001 itself does not exist in the
  codebase yet (see §3.4). Scope tonight's unattended run to R1–R9 plus the real
  `MissingBrandFontsBanner` P1 item, and leave the F001 bullet for a future pass once F001 lands.

---

## Revisions

- 2026-08-18 — captured post-demo. Font-file count, family count, per-face metadata, licence spread,
  and the absence of `font-family` in `TypefacesSection` all verified against the repo and the
  running daemon the same session.
- 2026-08-18 (repair pass — no audit file existed for F008; every claim below was independently
  re-verified against the repo and a live daemon, `pnpm tools-dev start web` + `GET /api/typefaces`
  across all 93 families, in this session):
  - Corrected the file/directory counts (316 `fonts/` dirs / 5,181 font-format files measured today,
    not 306/5,353) and replaced the fixed number with a re-runnable command, since `design-templates/`
    is an actively growing tree (see F010).
  - Corrected "faceCount up to 8/family" — 48 of 93 families exceed 8 faces, the true maximum is 707
    (`Noto Sans SC`, driven by per-script Unicode-range subsetting) — and rewrote R2/R3/R5/R7 around
    the corrected number, including the discovery that every family does carry a Latin-covering
    subset, consistently named, so R3 is achievable for all 93 provided selection is Unicode-range-
    aware.
  - Corrected R1's "wire a scoped route to it": the existing whitelist at `static-resource.ts:668`
    backs `/api/skills/:id/fonts/*splat`, rooted at `skill.dir`, with no relationship to the typeface
    catalogue — a new route is required. Gave R1 a concrete, safe route shape (index-matched filename,
    no traversal surface) plus an explicit R1a dual-track-closure justification per AGENTS.md.
  - Added a "prior art" note pointing at `useBrandFonts` in `DesignKitView.tsx`, which already does
    client-side `@font-face` injection for a different surface, so this isn't built as a parallel
    mechanism (cross-cutting no-duplication rule).
  - Fixed the Playwright verify command: `e2e/specs/*.spec.ts` was never a valid Playwright
    invocation in this repo (`specs/` is the Vitest tree; Playwright UI tests are flat `.test.ts`
    files under `e2e/ui/` importing from `@/playwright/suite`). Corrected the daemon test-path
    convention and package filter accordingly.
  - Replaced every human-judgment success criterion (including "verified by network panel") with an
    automated Playwright/Vitest oracle.
  - Flagged the P1 F001 advisor-output bullet as blocked on F001, which does not exist in the
    codebase yet; confirmed the sibling `MissingBrandFontsBanner` P1 item is real and in scope.
  - Converted the open specimen-text question into a decided default per the no-human-gates rule,
    moving the actual wording choice to a non-blocking "Morning review" note.
  - Added the missing i18n-key requirement for new UI strings, and a `Cache-Control` header
    correction (R8) so the new route doesn't copy a sibling route's `no-store` header by mistake.
