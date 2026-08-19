# F011 — 🐞 Projects started from user-installed templates open a blank canvas (entry file resolves to an iframe shim)

| Field | Value |
|---|---|
| Captured | 2026-08-18, live team demo |
| Reported by | Devin |
| Type | **Defect** |
| Area | `apps/daemon/src/routes/design-library.ts` — `detectEntryFile` · `apps/daemon/src/routes/project/index.ts` — `detectTemplateEntryFile` |
| Severity | **High** — affects **199 of 199** user-installed templates; the canvas opens empty on every one |
| Effort | **M** — corrected 2026-08-18 (PRD repair pass): the shape check itself is small, but the fix has three independent consumers to close (`resolveCanvasFile`, the MCP `get_artifact` tool, and the export manifest chooser — see §6.1 R7), plus the catalogue-wide regression test |
| Reproduces on | Every entry in `~/…/.od/design-templates/` (199/199 verified). Confirmed input: project `363cbd2e-67dc-4273-898a-1eb534e8c76b`, template `lexingtonthemes-sandstone` |
| Not affected | The **shipped** catalogue `design-templates/` — 0 of 352 entries affected (verified) |
| Status | 🔬 Root cause confirmed in code and on disk · visual repro pending |

---

## 1. Raw note (verbatim)

> why didnt this show up like its supposed to? its all html

and, on triage:

> please log this into the found bugs log and make sure none of the other templates have this issue

---

## 2. Root cause

A project started from a user-installed design template gets its `entryFile` set to
`example.html` — a **280-byte gallery-preview wrapper** whose entire body is an iframe
pointing at the real site:

```html
<body><iframe src="./assets/index.html" title="lexingtonthemes-sandstone"></iframe></body>
```

The canvas renders that wrapper. The real 127 KB site one directory down is never the
entry, and the nested frame cannot load in the preview sandbox (§2.2). Net result: an
empty canvas on a project the user just created from a template they picked.

### 2.1 Evidence chain — how the shim gets selected

| # | Location | Fact |
|---|---|---|
| 1 | `project/index.ts:1978-1999` | Template start copies the **whole catalogue entry, preserving directory shape** ("Copy the whole catalogue entry, preserving its directory shape," `:1978`, implemented by the `copyDirectoryContents` call at `:1992-1999`) — so `example.html` and `assets/` both land at the project root |
| 2 | `project/index.ts:2000` | `entryFile = await detectTemplateEntryFile(projectRoot)` |
| 3 | `project/index.ts:106-110` | `detectTemplateEntryFile` special-cases exactly **one** filename: `assets/template.html`. Anything else falls through to `detectEntryFile` |
| 4 | `design-library.ts:215` | `ENTRY_FILE_CANDIDATES = ['index.html', 'HTML/index.html', 'build/index.html', 'template/index.html']` — **`assets/index.html` is not in the list** |
| 5 | `design-library.ts:322-325` | No candidate matched → scan **top-level files**, sorted, return the first `.html` → **`example.html`** ← the shim wins here |
| 6 | `design-library.ts:326-335` | The nested-directory scan that *would* have found `assets/index.html` sits **after** step 5 and never runs |

The docblock at `project/index.ts:99-105` already names this exact hazard:

> Ten catalogue entries pair that authored artifact with a root `example.html` that is only
> a gallery preview wrapper — a title bar around an `<iframe src="./assets/template.html">`.
> The generic heuristic takes root-level HTML first and would hand the user the wrapper to
> edit instead of the template.

**The guard was keyed to a filename, not to a shape.** It catches `assets/template.html`
and misses `assets/index.html`, which is what all 199 user-installed templates use.

### 2.2 Why the shim renders blank rather than just "one frame deep"

Even when selected, the wrapper cannot work in the preview surface:

| # | Location | Fact |
|---|---|---|
| 7 | `DesignFilesPanel.tsx:1538-1544` | The preview iframe is `srcDoc` + `sandbox="allow-scripts allow-downloads"` — **no `allow-same-origin`**, so the document has an opaque origin |
| 8 | `srcdoc.ts:100-102` | `injectBaseHref` fixes relative URLs for the **first** document only |
| 9 | `srcdoc.ts:104-113` | A real navigation out of the srcDoc document loads the target "bare, un-injected … with an opaque origin, and Chromium's Opaque Response Blocking refuses its own `<link>`/`<script src>`/`<img>` fetches … so it renders unstyled with broken images" |
| 10 | `srcdoc.ts:115-118` | `injectPreviewNavigationBridge` intercepts **clicks**. A nested `<iframe src>` is not a click, so the bridge never sees it |

So the child document loads (if at all) un-injected and opaque-origin, and every asset it
references — `reference.css`, `assets/css/*`, `assets/js/*`, images — is blocked. The wrapper
carries no content of its own, so the canvas paints nothing.

**Honest limit:** steps 1–6 are proven from code and disk. Steps 7–10 trace the render path
from the code's own documented behaviour for the analogous navigation case; I did **not**
render it — `export --format image` returns `UPSTREAM_UNAVAILABLE: screenshot export is only
available in the desktop runtime`. The user-observed symptom (blank canvas) corroborates it.
A Playwright repro is **R1b** below (§6.1) — corrected 2026-08-18: the original R1 (a daemon
Vitest test asserting `metadata.entryFile`) proves entry-file *selection* only and does not
touch rendering, so it could not have closed this claim on its own. R1b is the piece that
actually exercises the render path this paragraph is about.

---

## 3. Blast radius — full catalogue census

Both catalogue roots were classified by entry-point shape.

### Shipped catalogue — `design-templates/` (in-repo, 352 dirs) — **0 affected**

| Shape | Count | Entry resolution |
|---|---|---|
| `assets/template.html` present | 9 | Guarded by `detectTemplateEntryFile` ✅ |
| Root `example.html` is a **real standalone page** | 337 | Correct — it *is* the artifact ✅ |
| No root HTML (functional skills: `live-artifact`, `hyperframes`, `html-ppt`, `dcf-valuation`, `last30days`, `x-research`) | 6 | Not template-start entries ✅ |
| **Iframe shim** | **0** | — |

### User-installed catalogue — `~/…/.od/design-templates/` (199 dirs) — **199 affected**

Every entry is `SKILL.md` + `assets/<complete static site>` + a root `example.html` iframe
shim. All 199 shims target `./assets/index.html`; all 199 targets exist on disk. None ships
`assets/template.html`, so **none** hits the existing guard.

| Vendor prefix | Affected |
|---|---|
| `lexingtonthemes-` | 45 |
| `nextjstemplates-` | 30 |
| `themefisher-` | 27 |
| `cruip-` | 21 |
| `tailgrids-` | 17 |
| `aceternity-` | 16 |
| `shadcnblocks-` | 15 |
| `tailwindcss-` | 13 |
| `magic-` | 9 |
| `shipxen-` | 6 |
| **Total** | **199 / 199** |

**Zero name overlap** between the two catalogues — these 199 are an entirely separate,
locally-ingested library, which is why the in-repo test suite never caught it.

### Census command (re-runnable)

**Corrected 2026-08-18 (PRD repair pass).** The original script's denominator was
`len(os.listdir(root))` — every top-level entry, not just directories. `design-templates/`
also holds `design-templates/AGENTS.md` (a file, not a catalogue entry), so the original
script actually prints `design-templates: 0 shim(s) of 353`, not `of 352` as the prose above
claims. The directory count (352) is correct and independently re-verified (`find
design-templates -maxdepth 1 -mindepth 1 -type d | wc -l`); the script below fixes the
denominator to match it so the command's own output no longer contradicts the prose.

```bash
cd ~/projects/mishmash && python3 - <<'PY'
import os, re
iframe = re.compile(r'<iframe[^>]*\bsrc=["\']([^"\']+)["\']', re.I)
for root in ('design-templates', '.od/design-templates'):
    if not os.path.isdir(root): continue
    shims = []
    total_dirs = 0
    for n in sorted(os.listdir(root)):
        d = os.path.join(root, n)
        if not os.path.isdir(d): continue
        total_dirs += 1
        ex = os.path.join(d, 'example.html')
        if not os.path.exists(ex): continue
        if os.path.exists(os.path.join(d, 'assets', 'template.html')): continue
        txt = open(ex, encoding='utf-8', errors='ignore').read()
        if iframe.search(txt) and len(txt) < 4000: shims.append(n)
    print(f'{root}: {len(shims)} shim(s) of {total_dirs} dirs')
PY
```

**Re-run 2026-08-18 (PRD repair pass), same machine, same repo checkout:**

```
design-templates: 0 shim(s) of 352 dirs
.od/design-templates: 199 shim(s) of 199 dirs
```

Confirms the header's 199/199 and 0/352 exactly. The per-vendor breakdown in the table above
was also independently re-derived (`ls .od/design-templates | sed -E 's/^([a-z]+)-.*/\1/' |
sort | uniq -c`) and matches all ten rows exactly (45/30/27/21/17/16/15/13/9/6 = 199).

Expected after the fix ships: the counts may stay the same (the packaging is not
itself wrong) — what must change is that **no project started from those entries
resolves `entryFile` to the shim**. R6 asserts that directly.

---

## 4. Ruled out, with evidence

| Hypothesis | Verdict |
|---|---|
| The template HTML is broken / assets missing | **No.** 860 local `href`/`src`/`poster` refs checked across the sandstone tree: 1 missing (`system/overview.html → ../rss.xml`, a feed never captured at vendor time). 0 missing CSS `url()` refs. |
| Absolute paths break when the payload moves | **No.** 0 absolute `href="/…"` / `src="/…"` refs anywhere in the tree. |
| The copy step drops files | **No.** `copyDirectoryContents` throws on incomplete copy (`project/index.ts:1997`); the tree is complete on disk. |
| It only affects Lexington Themes | **No.** All 10 vendor prefixes, 199/199. |
| It affects the shipped catalogue too | **No.** 0 of 352 — see §3. |

---

## 5. Confidence

**High** on selection (§2.1) — read directly from `ENTRY_FILE_CANDIDATES` and the ordering
of the two scans in `detectEntryFile`, and confirmed against the on-disk shape of all 199.

**Medium-high** on the render mechanism (§2.2) — traced from the code's own comments about
opaque-origin navigation out of a srcDoc preview, not from a capture. R1b (§6.1, corrected
2026-08-18 — the original pointed at R1, which as scoped only ever tested `entryFile`
selection and never touched rendering) converts this to proven or corrects it.

---

## 6. PRD — the fix

**Rewritten 2026-08-18 (PRD repair pass).** No audit file existed for F011 — every claim in
this section, and every line/count citation in §§1-5 above, was independently re-verified
against the running repo (grep/read plus a live sqlite query against this machine's own
`.od/app.sqlite`, not asserted from the raw note). All header numbers checked out exactly. The
original §6 had four real problems, all confirmed during this pass: (1) R1 promised a
"fixture shaped like the 199" without saying where that fixture lives, and the test file it
names does not use the isolated-`OD_DATA_DIR` pattern the rest of the daemon test suite uses,
so "just add a fixture" was underspecified; (2) R2's shape check ("no meaningful content of
its own") was not machine-checkable as written; (3) R7 described a vague "re-run resolution
on open" without naming what function that is or where it lives — there already **is** such a
function, and it does not yet do what R7 needs; (4) R7 as scoped would have left two other
real consumers of `metadata.entryFile` still serving the shim after the fix. Rewritten below
with concrete file/line targets for all four.

**Dual-track check (per `AGENTS.md` "Capability exposure (UI/CLI dual-track)"): N/A.** This
PRD fixes entry-file *resolution* for an existing capability (starting a project from a
template); it adds no new HTTP endpoint, contract DTO, web surface, or `od` subcommand.
`ProjectMetadata.entryFile` already exists in `packages/contracts/src/api/projects.ts:157`.
The repair mechanism in R7 below is even more clearly dual-track-safe than it first
appears: `resolveCanvasFile` (`apps/daemon/src/projects.ts:234`) is already, by its own
docblock, "the one answer the web UI, MCP studio links, and `od project info` must all agree
on" — fixing it once fixes all three surfaces without touching any of them individually.

**Duplicate-capability check: one related-but-distinct piece of prior art, not a duplicate.**
`scripts/template-render-report.ts` (run as part of `pnpm guard`) already renders every entry
in **both** `design-templates/` and `.od/design-templates` and already treats root
`example.html` as the file to render (`:202-207`) — but that is the catalogue **gallery-card
preview** surface (`GET /api/design-templates`), a deliberately different question from "what
entry file does a *new project* get." Its own on-disk scan (`scanOnDisk`, `:173-181`) already
skips gracefully when a root doesn't exist (`if (!existsSync(dir)) return [];`) — R6 below
copies that exact idiom for the same two roots rather than inventing a new one. This script
treating `example.html` as authoritative for gallery cards is independent evidence for R3's
boundary decision: the preview/ingest path is supposed to show the wrapper's own preview
behavior, so it must stay untouched.

### 6.1 Requirements

- **R1a · Failing test first, cheapest layer.** Per `superpowers:test-driven-development` and
  root `AGENTS.md`'s "Try the cheapest layer first." Home:
  `apps/daemon/tests/project-create-from-catalogue-template.test.ts`. **Fixture setup, made
  concrete:** this file does not isolate `OD_DATA_DIR` (unlike most daemon tests — see
  `anomaly-cli-subprocess.test.ts:23-27` for that pattern) and instead runs against the real,
  ambient `design-templates` catalogue via real skill ids (`ROOT_EXAMPLE_TEMPLATE_SKILL_ID`
  etc., `:100-102`). Match that file's own convention rather than switching patterns
  mid-file: in `beforeAll`, create a uniquely-named directory
  (`__f011-fixture-${randomUUID()}__`) under `USER_DESIGN_TEMPLATES_DIR`'s on-disk location
  (the same root `resolveSkillDir` resolves against — with no `OD_DATA_DIR` override this is
  `<repo>/.od/design-templates/`) shaped like the 199: `SKILL.md`, `assets/index.html` (real
  content), and a root `example.html` iframe shim pointing at `./assets/index.html` (same
  ~300-byte shape the census in §3 detects). Delete it in `afterAll`, unconditionally, even on
  test failure. Assert `body.project.metadata.entryFile === 'assets/index.html'`. Must fail on
  `main`.
- **R1b · Playwright repro of the actual render path.** New flat file
  `e2e/ui/template-entry-file-shim.test.ts` importing `test`/`expect` from
  `@/playwright/suite` (never `e2e/specs/*.spec.ts` — that is the Vitest business-spec tree,
  see root `AGENTS.md`'s Validation strategy section). Start a project from the same
  shim-shaped fixture as R1a (write it under the Playwright worker's own tools-dev data root,
  matching the isolation model other real-daemon UI specs use), open it, and assert the
  rendered preview iframe's content does **not** match the shim (e.g. its `srcdoc`/loaded
  document does not contain the shim's `<iframe src="./assets/index.html">` markup and does
  contain a marker string unique to the fixture's `assets/index.html`). This is the piece that
  actually proves success criterion 2 (§6.2) and closes the "visual repro pending" status in
  the header — R1a alone only proves `entryFile` selection, not what paints.
- **R2 · Detect the shape, not the filename — concrete algorithm.** Replace the
  `assets/template.html` literal in `detectTemplateEntryFile` (`project/index.ts:106-110`)
  with a shape check, factored into a new shared helper (not left inline in
  `project/index.ts`, since R7 needs the same check from two other files — see below).
  Suggested home: `apps/daemon/src/entry-file-wrapper.ts`, exporting
  `resolveWrapperTarget(html: string, fileDir: string, projectRoot: string): string | null`.
  Concrete, machine-checkable test (derived directly from the census script in §3, which
  already proves this heuristic separates all 352 shipped entries from all 199 shimmed ones
  correctly): the HTML's `<body>` contains **exactly one** element, and that element is an
  `<iframe>` with a `src` attribute; resolve that `src` relative to the HTML file's own
  directory; if the resolved path exists inside `projectRoot`, return the resolved path
  relative to `projectRoot` (the **target**) — otherwise return `null` (not a wrapper, or a
  wrapper pointing outside the tree, which must not be followed). This subsumes the existing
  `assets/template.html` case rather than sitting beside it.
- **R3 · Do not silently reorder `detectEntryFile`.** `design-library.ts:322-335` puts the
  top-level file scan ahead of the nested scan, and **337 shipped templates depend on that
  order** (their root `example.html` is the real artifact — independently corroborated by
  `scripts/template-render-report.ts:202-207` treating root `example.html` as the canonical
  preview file for the same 337). Fix in `detectTemplateEntryFile`, the template-start-specific
  layer. Do not "fix" it by adding `assets/index.html` to `ENTRY_FILE_CANDIDATES` — that
  changes the design-library ingest path too, and its blast radius has not been assessed here.
  Confirmed this stays isolated: `folder-import-projects.test.ts:169-205` unit-tests
  `detectEntryFile` directly and touches neither `detectTemplateEntryFile` nor the new R2
  helper, so it is unaffected by this fix.
- **R4 · Keep the wrapper out of the project.** Once R2 resolves the entry correctly, a copied
  shim is dead weight that still shows in the files panel and still shadows the real page for
  anyone who opens it. Exclude it from the copy **only when** `resolveWrapperTarget` (R2)
  returns non-null for it — `TEMPLATE_AUTHORING_FILE_NAMES` (`project/index.ts:84`) is
  unconditional and must not gain a bare `example.html`, or all 337 shipped templates lose
  their artifact.
- **R5 · Preserve the existing guarantees.** The test at
  `project-create-from-catalogue-template.test.ts:104` ("copies a root-level example.html
  template and sets entryFile") asserts today's behaviour for the 337 legitimate cases. It
  must still pass unchanged.
- **R6 · Catalogue-wide regression test.** New file
  `apps/daemon/tests/template-entry-file-catalogue-scan.test.ts`. Iterate **every** entry in
  both catalogue roots (`design-templates/`, `.od/design-templates`) and assert
  `resolveWrapperTarget` never leaves a project-start resolution pointed at a wrapper. Skip
  the user-installed root gracefully when absent, copying the exact idiom
  `scripts/template-render-report.ts`'s `scanOnDisk` already uses (`:173-174`:
  `if (!existsSync(dir)) return [];`) rather than inventing a new one — CI has no
  `.od/design-templates`.
- **R7 · Self-heal already-created projects — no migration script, no metadata write.**
  Rewritten 2026-08-18: the original wording ("re-run resolution on open... metadata-only")
  did not name a mechanism. There already is one, and fixing it is strictly simpler and safer
  than a migration:
  - **Primary fix.** `resolveCanvasFile` (`apps/daemon/src/projects.ts:234-251`) is the
    existing "what should the canvas open" resolver every surface already defers to (its own
    docblock, `:226-233`). Today its first check is only "does the declared `entryFile` still
    exist on disk" (`:243-244`) — it does not ask whether that file is a wrapper. Extend that
    check to also call R2's `resolveWrapperTarget`: when the declared entry exists **and**
    resolves to a wrapper target, use the target instead of the declared file, then continue
    the function's existing fallback chain (artifact-manifest primary → root `index.html` →
    single root `.html`) unchanged. This is a **pure read-path fix — no database write, no
    migration script, no risk of corrupting project metadata.** Every existing broken project
    self-heals on its very next `GET /api/projects/:id`, forever, including ones that don't
    exist yet.
  - **Two other consumers found that bypass `resolveCanvasFile` and must get the same fix,**
    or they will keep serving the shim even after R1-R6 land:
    1. `getArtifact` in `apps/daemon/src/mcp.ts:1645` reads `project.metadata?.entryFile`
       directly instead of preferring the GET response's `resolvedCanvasFile` field. Its
       sibling function 200 lines up, `resolveProjectEntry` (`mcp.ts:1298-1312`), already gets
       this right — it prefers `resolvedCanvasFile` first and only falls back to `declared`
       (`:1310-1313`). Make `getArtifact` do the same instead of duplicating the unfixed check.
    2. `chooseExportManifestEntryFile` in `apps/daemon/src/import-export-routes.ts:1446-1454`
       has its own independent "declared entry exists in the file map" check with no
       wrapper-awareness — an exported project's manifest would still name the shim as
       primary. Route it through R2's `resolveWrapperTarget` the same way.
  - **Confirmed against this machine's real, local `.od/app.sqlite` (not hypothetical):**
    project `363cbd2e-67dc-4273-898a-1eb534e8c76b` (the reporting project, see §7) has
    `metadata_json: {"entryFile":"example.html", ...}` **today**, but `example.html` was
    deleted from that project's directory by the §7 hand-workaround — only
    `.od-skills/lexingtonthemes-sandstone-*/example.html` (an unrelated cached skill snapshot)
    still has that name. So `resolveCanvasFile`'s *existing* `files.some((f) => f.path ===
    declared)` check already fails for this project today, and it already falls through to
    `index.html` at root — meaning **the canvas for this specific project is not actually
    broken right now**, only its raw `metadata.entryFile` field is stale. The two consumers
    above, which don't do that existence check, would still get it wrong. This is direct
    evidence for why R7 needs all three fixes, not just `resolveCanvasFile`.
  - Also found, for context and explicitly **out of scope**: two other real projects in this
    same local database — `c4002a67-decd-405f-bd3e-a41b3750b7ae` and
    `13a08d42-87b2-4bba-8e24-a2861ad19f18` — both started from catalogue entries in the
    affected 199 (`aceternity-nodus-agent-template`, `aceternity-cryptgen-marketing-aceternity`)
    and both already carry a correct `entryFile: "index.html"` with a flattened file layout —
    almost certainly hand-fixed the same way as §7's project, not evidence of a different code
    path. And two unrelated, already-empty projects (`1267015b-6bb1-4cae-9939-b6a8468a8560`,
    `59f84041-649a-4d07-ad3e-0d56ee39638f`) with no `entryFile` at all and zero files on disk —
    these are leftovers from the **older, already-patched** "zero files copied" bug the code
    comment at `project/index.ts:1980-1987` documents (MM-001/MM-007), not this defect. R7's
    wrapper check does not and should not try to repair them; flagging only so nobody mistakes
    them for new F011 damage during tonight's run.
  - Test: a Vitest daemon test (co-located with R6 or R1a) that creates a project from the
    R1a-style fixture, hand-corrupts its stored `metadata.entryFile` back to the shim path
    (simulating a pre-fix project) via direct DB/API patch, then asserts
    `GET /api/projects/:id` returns the correct `resolvedCanvasFile`, and separately asserts
    the MCP `getArtifact` tool and `chooseExportManifestEntryFile` both resolve to the same
    non-wrapper target for that same corrupted project.

### 6.2 Success criteria

1. R1a's test fails on `main`, passes after the fix.
2. R1b's Playwright test fails on `main` (or would, once its fixture exists), passes after the
   fix — the automated replacement for "a project started from any of the 199 opens with the
   real site painted, not a blank canvas." No human is needed to eyeball this.
3. All 337 shipped `example.html` templates still resolve to `example.html` (R5 green).
4. The 9 `assets/template.html` templates still resolve to `assets/template.html`.
5. R6 passes across both catalogue roots: 0 entries resolve to a wrapper.
6. `resolveCanvasFile`, the MCP `getArtifact` tool, and `chooseExportManifestEntryFile` all
   self-repair a project carrying a stale/wrapper `entryFile`, with no file moved or deleted
   and no metadata write required (R7).
7. `pnpm guard`, `pnpm typecheck`, `pnpm i18n:check` exit 0. (This PRD introduces no new i18n
   keys — it is a backend resolution fix plus a Playwright assertion with no new user-facing
   copy — so `i18n:check` is a non-regression gate here, not a new-key check.)

### 6.3 Verification

```bash
cd ~/projects/mishmash
pnpm guard && pnpm typecheck && pnpm i18n:check
pnpm --filter @open-design/daemon test -- project-create-from-catalogue-template
pnpm --filter @open-design/daemon test -- template-entry-file-catalogue-scan
pnpm --filter @open-design/e2e exec playwright test -c playwright.config.ts ui/template-entry-file-shim.test.ts
# then the §3 census command — expect 0 entries resolving to a wrapper
```

### 6.4 Phasing

No requirement below is blocked on an open product/architecture decision — every judgment
call the original draft left implicit (fixture location, shape-check algorithm, repair
mechanism, and its full consumer list) was resolved above by reading the actual code, not
invented. All three phases are buildable tonight.

| Phase | Scope |
|---|---|
| **P0** | R1a, R1b, R2, R3, R5 — new projects resolve correctly and visibly render; nothing regresses |
| **P1** | R4, R6 — wrapper stops being copied; catalogue-wide guard lands |
| **P2** | R7 — self-heal for already-created projects, all three consumers |

### 6.5 Follow-up worth filing separately

- **Ingest packaging.** The 199 were vendored as `assets/<site>` + a shim, while the 337
  shipped entries put the artifact at the root. Two packaging shapes for one catalogue is the
  upstream cause; one shape would make R2 unnecessary. Touching `design-templates/` content is
  forbidden under this log's guardrails, so this is a **separate finding about the ingest
  path**, not a change to the library.
- **Preview sandbox and nested frames.** `injectPreviewNavigationBridge` handles clicks but
  not nested `<iframe src>`. Any artifact a user legitimately authors with a nested frame hits
  the same wall. Worth deciding deliberately: support it, or fail loudly instead of blank.
- **Vendor gap.** `system/overview.html` links `../rss.xml`, which no Lexington Themes entry
  ships. Cosmetic, pre-existing, unrelated to this defect.

---

## 7. Workaround applied to the reporting project (not a fix)

Project `363cbd2e-…` was repaired by hand so the demo could continue: `assets/*` moved to the
project root (making the site's own `index.html` the entry), and the shim deleted. All 860
local refs re-verified after the move. **This is a one-project workaround. It does not touch
the daemon, the catalogue, or the other 198 templates** — those still reproduce.

**Verified still in place, 2026-08-18 (PRD repair pass).** Confirmed against the real files on
this machine: `.od/projects/363cbd2e-67dc-4273-898a-1eb534e8c76b/` has no `example.html` at
its root (only a stale copy inside `.od-skills/lexingtonthemes-sandstone-6cc0b73a97/`, an
unrelated cached skill snapshot), `assets/` now holds `css/js/images/video` directly, and
`index.html` at the root is the real 126.9 KB site (not a title-bar-and-iframe wrapper) — the
workaround holds.

**One gap the workaround left, found this pass:** the project's row in `.od/app.sqlite`
(`projects.metadata_json`) still reads `{"entryFile":"example.html", ...}` — the hand-fix
moved files but never patched the database, so the recorded entry now names a file that does
not exist at all. This does not break the canvas today, because `resolveCanvasFile` already
falls through to `index.html` when the declared file is missing (see §6.1 R7) — but it does
mean this project's raw metadata is a live, real-world instance of exactly the inconsistency
R7's fix needs to handle, and it will still mislead the two consumers R7 identifies that don't
do `resolveCanvasFile`'s existence check (the MCP `get_artifact` tool, the export manifest
chooser) until R7 ships. **Interaction with the regression tests: none.** R6 scans the
catalogue roots (`design-templates/`, `.od/design-templates`), not individual project
directories, and R1a/R1b build their own disposable fixtures — this project's state, patched
or not, is invisible to both.

---

## Revisions

- 2026-08-18 — captured during team demo. Root cause traced through `detectEntryFile` /
  `detectTemplateEntryFile` the same session; full 551-entry census run across both catalogue
  roots. No daemon or catalogue code changed.
- 2026-08-18 — **PRD repair pass.** No audit file existed for F011 (unlike F001-F010); this
  pass independently re-verified every factual claim against the live repo and this machine's
  real `.od/app.sqlite`/`.od/design-templates`, applying the same standards
  `CROSS-CUTTING-CORRECTIONS.md` recorded for the other ten findings. No source, test, or
  config file was changed — docs only. Summary of corrections:
  - **Factual accuracy.** All header numbers (199/199, 0/352) and both function
    citations (`detectEntryFile`, `detectTemplateEntryFile`) confirmed exact. Two real errors
    found and fixed: (1) the §2.1 evidence-table citation `project/index.ts:1991-1998`
    actually points past the line that states the fact being cited — corrected to
    `:1978-1999`; (2) the §3 census script's own denominator (`len(os.listdir(root))`) counts
    `design-templates/AGENTS.md` as an entry, so running the script exactly as written prints
    "0 shim(s) of **353**", contradicting the prose's "352" — script fixed to count
    directories only, matching the independently-verified 352/199 dir counts, and a fresh
    re-run's output recorded in §3.
  - **Unattended executability.** The original R1 promised a "fixture shaped like the 199"
    without saying where it lives, given the target test file doesn't use the isolated-
    `OD_DATA_DIR` pattern most daemon tests use — made concrete (R1a). R2's shape check ("no
    meaningful content of its own") was not machine-checkable — replaced with a precise,
    derivable algorithm (single `<iframe>` child of `<body>`, `src` resolves inside the copied
    tree). Success criterion 2 ("real site painted, not blank") had **no requirement that
    actually tested rendering** — R1a is a metadata-only Vitest test, so §2.2's own promise
    that "R1 converts this to proven or corrects it" was never true as scoped. Added R1b, a
    Playwright test at the correct path (`e2e/ui/template-entry-file-shim.test.ts` via
    `@/playwright/suite` — the original had no Playwright requirement at all, so there was no
    wrong-path bug to fix here, just a missing one) that actually exercises the render path
    and gives an automated pass/fail oracle instead of leaving this for a human to eyeball.
  - **Repo-rule compliance.** Dual-track check added explicitly (N/A, with reasoning: no new
    endpoint/DTO/surface/CLI subcommand). Duplicate-capability check added: found
    `scripts/template-render-report.ts` renders both catalogue roots already, confirmed it's
    solving a different problem (gallery-card preview, not project-start resolution) and is
    independent corroboration for R3, not a duplicate to build against.
  - **Missing work.** R7 ("re-run resolution on open") named no actual mechanism. Found the
    real one: `resolveCanvasFile` (`apps/daemon/src/projects.ts:234`), already the documented
    single source of truth for "what the canvas opens" across web/MCP/CLI — extending its
    existing "does the declared entry still exist" check to also reject a *wrapper* entry is a
    pure read-path fix with no migration script and no metadata write. Also found, by reading
    every other call site of `metadata.entryFile`, two consumers that bypass
    `resolveCanvasFile` and would keep serving the shim even after R7's primary fix: the MCP
    `getArtifact` tool (`mcp.ts:1645`) and the export manifest chooser
    (`import-export-routes.ts:1446-1454`) — both added to R7. Confirmed via this machine's
    real `.od/app.sqlite` that the reporting project's hand-workaround (§7) left its DB
    metadata stale (`entryFile` still names a now-deleted file) — documented in §7 with the
    exact interaction (harmless for `resolveCanvasFile`'s existing fallback, still a problem
    for the two other consumers). Found two more real projects in the same database that
    appear separately hand-fixed, and two unrelated empty leftover projects from an older,
    already-patched bug — both noted as out-of-scope context in R7 so tonight's run doesn't
    mistake them for new damage. Confirmed no i18n keys are introduced (backend fix, no new
    copy) and confirmed via `folder-import-projects.test.ts:169-205` that the generic
    `detectEntryFile` unit tests are unaffected by this fix (R2/R3 touch only
    `detectTemplateEntryFile` and the new shared helper).
  - **No unverified numbers.** Every count in this document is now either independently
    re-run in this pass (352/199 dirs, the ten-vendor breakdown, the rss.xml gap) or was
    already a re-runnable command; none were taken on the raw note's word alone.
  - Effort raised from **S** to **M** in the header to reflect the three-consumer scope R7
    actually has, not the one-function fix the original description assumed.
  - **No decision was found to be genuinely unmade after verification.** Every place the
    original draft was vague (fixture location, shape-check precision, repair mechanism and
    its consumers) turned out to be resolvable by reading the existing code, not a real open
    product/architecture question — so, unlike F001/F007/F010, this finding is not blocked
    and needs no "DECISION REQUIRED" marker anywhere in this document.
