# Wave 10a — Instatic seam (MCP registration + Super Import export)

**Slug:** `mishmash-w10a-instatic`
**Gates on:** founder ruling only (NM-24, resolved 2026-07-27 — no wave-code dependency; may run
independently of W1/W3/W4/W6a/W8).
**Loop:** `loop:red-green-review` (`VERIFICATION-CONTRACT.md` §6).
**Verifier:** `scripts/waves/verify-w10a.ts` — **but see "Implementation ceremony" below: the
committed in-tree copy is a baseline input after freeze, not what landing runs.**
**Write lease:** proposed below — **not yet applied to `docs/plans/waves/leases.json`**; this PRD
does not edit that file per its authoring mandate.
**Status: DRAFT, round 2 pending.** Round 1 adversarial review (GPT-5.6 Sol) returned **REJECT**
with 8 findings, 3 rulings, and one carry-forward hardening requirement; all are disposed in
**Adversarial review** below, with the fixed criterion/verifier line cited for each. Fix-round cap
is 2 before founder escalation (`VERIFICATION-CONTRACT.md` §6) — this is fix round 1. Written under
the NM-41C expansion gate (`W5-W11-gated.md` lines 8–24): frozen only after an independent reviewer
who will not implement it returns a machine-readable `APPROVE`. No implementation work may start
from this text before that review lands. This document is an **expansion**, not an implementation —
zero product code accompanies it; every criterion below currently fails, honestly, by design (see
**Verified baseline**).

---

## Founder-pinned scope (binding, quoted verbatim)

> seam = MCP + Super Import only; W10a pinned to that seam; deeper coupling needs separate evidence

Source: `docs/plans/waves/NM-REGISTER.md`, NM-24 row — "**Resolved 2026-07-27**". The same ruling
is echoed in `docs/plans/waves/GLOBAL-GOAL.md:124` and `docs/plans/2026-07-26-mishmash-completion-
assessment.md:12` ("Founder-delegated to GPT-5.6 Sol; verdict adopted per founder instruction").

This PRD's scope is **exactly** the two halves that quote names — an MCP client registration, and
a static export shaped for Instatic's own "Super Import" feature — and nothing past them. Round 1
found the export half needs one small, real, non-optional UI-logic correctness fix
(`authModeAfterUrlChange`, S10A-1) for the MCP half to actually function as specified; that is
scoped in, not scope creep — see **Explicitly out of scope** for what is genuinely excluded.

## Why this wave exists

`W5-W11-gated.md`'s W10 section: "**NM-24 Instatic** — zero repo references today. Recommended
seam: its **MCP server** + **Super Import** (static zip → pages/tokens/media). MishMash produces a
static site; Instatic imports it as a CMS-backed site. Bun-only (`engines.bun >=1.3.0 <1.4.0`) — it
stays a companion service, not a dependency." The completion assessment
(`docs/plans/2026-07-26-mishmash-completion-assessment.md:264-269`) adds: Instatic ships a Core
Framework token engine, a QuickJS-WASM plugin sandbox, an MCP server, and "Super Import" (static
zip → pages/tokens/media); it was cloned and evaluated 2026-07-25, and "priority is functionality
over shared brand identity."

Confirmed independently in this tree: `grep -rli "instatic"` across `*.ts`/`*.tsx`/`*.md`/`*.json`
(excluding `node_modules`) returns **zero hits outside `docs/plans/`** — the register's "zero repo
references today" claim holds at this branch's `baseCommit`.

**Correction (evidence-grounding revision):** the "static zip → pages/tokens/media" phrase quoted
above is an executive-summary gloss from the assessment, not a read of Instatic's own docs — the
assessment itself only claims Instatic was "cloned and evaluated," not that its Super Import wire
format was inspected. That revision read the actual Instatic checkout (read-only, at
`~/projects/tools/third-party/instatic`) and corrected S10A-1/S10A-2 to match; round 1 then found
and fixed further defects in the resulting criteria — see **Ground facts** for citations and
**Adversarial review** for the full disposition record.

## Ground facts (verified directly in this tree)

- **MCP client registration is a data problem, not a new subsystem.** `apps/daemon/src/mcp-
  config.ts` defines `McpServerConfig` (a user's live, persisted connection) and a separate,
  read-only `MCP_TEMPLATES: McpTemplate[]` array (`mcp-config.ts:567+`) — curated presets the
  Settings → MCP "Add server" picker renders. **39 templates exist today** (re-derived
  programmatically — `grep -c "^\s*id: '"` and a category tally both independently agree at 39;
  round 1 caught this doc's earlier "25" as a hand-count error against its own listed category
  breakdown) across 8 categories (`image-generation`(8), `image-editing`(5), `web-capture`(3),
  `design-systems`(5), `ui-components`(3), `data-viz`(4), **`publishing`(7)**, `utilities`(4)) — the
  verifier re-derives this count at run time rather than trusting either number. `publishing`
  already holds the closest neighbors: `edgeone-pages` (stdio, `npx -y edgeone-pages-mcp@latest`),
  `pagedrop` (stdio, `npx -y pagedrop-mcp`), `pdfspark` (stdio, `npx -y pdfspark-api`) — all "hand a
  static artifact to a hosted service" tools, the same shape as an Instatic tether.
  `McpTemplateCategory` is defined identically in `packages/contracts/src/api/mcp.ts` and mirrored
  in `mcp-config.ts` (file header: "Both sides MUST stay in sync") — `publishing` already exists on
  both sides, so reusing it needs **zero** contract change.
- **The template list is served live, not baked into the UI.** `apps/daemon/src/mcp-
  routes.ts:150-163`: `GET /api/mcp/servers` (gated by `isLocalSameOrigin`) returns `{ servers:
  cfg.servers, templates: MCP_TEMPLATES }` straight from the constant. `apps/web/src/components/
  McpClientSection.tsx` renders whatever it receives generically — adding one array entry to `MCP_
  TEMPLATES` is sufficient for the entry to appear in the picker with no other web-side code change
  beyond the S10A-1 logic fix below. **Adding a template never touches a user's live
  `mcp-config.json`** — `McpTemplateConfig` and `McpServerConfig` are different arrays; picking a
  template only pre-fills a form the user still saves explicitly.
- **`McpClientSection.tsx`'s own row-model logic has a real, evidenced correctness gap** (round 1
  finding #6, confirmed by direct read): `authModeAfterUrlChange(row, nextUrl)`
  (`McpClientSection.tsx:108-117`) is:
  ```ts
  function authModeAfterUrlChange(row, nextUrl) {
    const previousInferred = inferMcpAuthMode(row.url);
    if (!row.authMode || row.authMode === previousInferred) {
      return inferMcpAuthMode(nextUrl);
    }
    return row.authMode;
  }
  ```
  and `inferMcpAuthMode(url)` (`:97-99`) returns `'none'` for a loopback url, `'oauth'` otherwise.
  `rowFromTemplate` (`:177-203`) seeds a template row's `authMode` from `tpl.authMode ??
  inferMcpAuthMode(tpl.url)` — for the Instatic template (S10A-1: default url
  `http://localhost:3000/_instatic/mcp`, a loopback host, explicit `authMode: 'none'`), the seeded
  value (`'none'`) is **identical** to what inference would have produced for that same url anyway.
  `authModeAfterUrlChange` cannot distinguish "explicitly set to none" from "merely defaulted to
  none via inference" — so the FIRST time the user edits the url to their real, non-loopback,
  self-hosted deployment (the **normal, expected, day-one action** for this specific template,
  unlike every other current template's fixed hosted-service url), `row.authMode === previousInferred`
  is true and the function falls through to `inferMcpAuthMode(nextUrl)`, which returns `'oauth'` for
  any non-loopback host — **silently discarding the PAT mode the whole S10A-1 design depends on**.
  This is a real, narrow, in-scope correctness fix, not new product surface: without it, the MCP
  registration this wave delivers does not actually work the way it is specified to. See S10A-1 for
  the fix contract and **Adversarial review** finding #6 for the full round-1 record.
- **The header-field `placeholder` is UI hint text, never seeded data — this is existing, correct,
  universal behavior, not a bug.** `rowFromTemplate` (`:182-185`) seeds every `headerFields` key
  with an **empty string**, never the placeholder text — the same pattern every other secret-bearing
  template (e.g. `nanobanana`'s `Authorization` header) already uses. C10A-1 checks the *template
  object's* placeholder/label text (what the picker shows before the user types anything), never a
  saved server's actual header value — the two are deliberately different layers.
- **"MishMash produces a static site" already has a real precedent to extend, not invent.**
  `GET /api/projects/:id/archive` (`apps/daemon/src/import-export-routes.ts:858-892`, backed by
  `buildProjectArchive` in `apps/daemon/src/projects.ts:307-368`) already zips a project's on-disk
  tree via `JSZip` (an existing direct dependency of `apps/daemon/package.json`, `jszip@3.10.1` —
  no new dependency needed anywhere in this wave). `od project archive <id> [--root <dir>] [--out
  <path>] [--json]` (`cli.ts:6043`, `case 'archive'` at `cli.ts:6200`) does nothing more than
  `fetch()` the same HTTP route and save the response.
- **The reusable "download the whole project" client-side helper lives in `apps/web/src/runtime/
  exports.ts`, not `DesignFilesPanel.tsx` and not `registry.ts`** (round 1 ruling, confirmed by
  direct read). `downloadProjectArchive(opts: {projectId, fallbackTitle, root?}): Promise<boolean>`
  (`exports.ts:1135-1154`) `fetch()`es `/api/projects/:id/archive`, converts the response to a blob,
  and triggers a browser download — called from `FileWorkspace.tsx`/`DesignSystemsTab.tsx`.
  `DesignFilesPanel.tsx` separately performs its OWN direct `fetch('/api/projects/:id/archive/
  batch', …)` inline in `handleBatchDownload()` (`:807-onward`) for the multi-select case — both
  patterns coexist for different scenarios in this codebase today. S10A-3 follows the
  `downloadProjectArchive` precedent exactly: a new exported helper in `runtime/exports.ts` owns the
  `fetch`, `DesignFilesPanel.tsx` owns only the labeled click wiring that calls it.
- **`AGENTS.md`'s capability-exposure rule is explicit about a required contract file**
  (`AGENTS.md`, "Capability exposure (UI/CLI dual-track)"): "Adding a new capability is a
  three-step closure: HTTP endpoint in `apps/daemon/src/*-routes.ts` (with a contract type in
  `packages/contracts/src/api/`), UI surface in `apps/web/src/`, and `od <capability>` subcommand
  … registered through `SUBCOMMAND_MAP`. Land all three in the same PR." Round 1 finding #3: the
  original lease proposal omitted the contract path entirely — fixed below (S10A-2/S10A-3, proposed
  lease).
- **i18n keys are typed and English-only, with an established naming convention right next to
  where this action belongs.** `apps/web/src/i18n/types.ts:3284-3285` declares
  `'designFiles.downloadProject': string;` / `'designFiles.downloadProjectFailed': string;`;
  `apps/web/src/i18n/locales/en.ts:2523-2524` gives their English text (`'Download project (.zip)'`
  / `"Couldn't download the project archive."`). Per `AGENTS.md`'s "i18n keys" section, "Add the key
  to `types.ts` first; a missing translation produces a typecheck error" — meaning **C10A-6 (`pnpm
  typecheck`) already fails closed if a key lands in one file but not the other**, and fails closed
  if any web code imports a `packages/contracts` type that does not exist. S10A-3's proposed sibling
  keys (`designFiles.exportSuperImport` / `designFiles.exportSuperImportFailed`) are deliberately
  named so the literal key string itself contains "SuperImport," which is exactly the substring
  C10A-4's label-detection regex (`instatic|super\s*import`, case-insensitive, matches
  "superimport" with zero intervening characters) already looks for — so a `t('designFiles.
  exportSuperImport')` call satisfies the "labeled, discoverable" check even before resolving the
  translated text. This is why round 1 finding #3 needed a **lease/scope fix**, not a new bespoke
  verifier check: the existing mechanisms (typecheck + C10A-4's regex) already close the gap once
  the files are in scope to be written at all.
- **Instatic's real Super Import contract, read from source (`~/projects/tools/third-party/
  instatic`, read-only).** Per `docs/features/site-import.md`: "Super Import" is `src/core/
  siteImport/` — the module's own barrel doc-comment points there (`src/core/siteImport/index.ts:9`,
  `@see docs/features/site-import.md`). It is triggered whenever a dropped ZIP is **not** an
  Instatic-native "site-transfer" archive (`.instatic/site-bundle.json` as first entry — a
  *different* feature, `docs/features/site-transfer.md`, MishMash does not need to produce):
  "A single ZIP is classified before analysis: an Instatic transfer archive has
  `.instatic/site-bundle.json` as its first stored entry and routes to the CMS bundle review path;
  **any other ZIP is treated as a static-site import**" (`site-import.md:302`). Round 1 finding #5:
  if a MishMash project's own tree happened to contain a file at that exact path, silently including
  it in the export would produce a zip Instatic misroutes entirely to the wrong import path — the
  export route must reject that case (S10A-2), not just avoid emitting it itself. **There is no
  `pages/`/`tokens/`/`media/` folder convention and no manifest file Instatic reads.** The real
  contract, per `src/core/siteImport/ingestInput.ts` and `classifyFiles.ts`:
  - Input is a flat, relative-path tree (loose files, a folder, or a `.zip` — `ingestInput.ts:47-51`
    `IngestInput` union); at most ONE shared top-level wrapper folder is auto-detected and stripped
    if every path shares it (`ingestInput.ts:107-132`) — no wrapper at all is equally fine.
  - Every file is classified by extension, MIME as fallback: `html`/`htm`→**html** (pages),
    `css`→**css**, `js`/`mjs`/`cjs`→**js**, `png`/`jpg`/`jpeg`/`webp`/`avif`/`svg`/`gif`/`ico`→
    **image**, `woff`/`woff2`/`ttf`/`otf`/`eot`→**font**, **`txt`/`md`/`json`→`meta`** ("informational
    — not imported"), everything else→**binary** ("uploaded as raw media assets")
    (`classifyFiles.ts:9-16,25-54`). Round 1 finding #5: the original fixture only exercised
    html/css/image, silently allowing an exporter that drops js/font/ordinary-meta/binary files to
    pass — fixed by covering all seven roles with distinct positive controls.
  - **Design tokens are never read from a file.** Color/font tokens are auto-extracted from CSS
    custom properties on `:root`/`html`/`body` selectors inside the site's own linked/`@import`ed
    CSS (`extractRootColorTokens`/`extractRootFontTokens`; `site-import.md`'s "Color tokens"/"Font
    tokens" table rows). A `design-tokens.json` file classifies as `meta` and is **silently
    ignored**, not parsed.
  - Pages: every `.html` file becomes a page; slug derives from its relative path — `site-import.md`'s
    "Pages" table row.
  - Hidden paths (dot-prefixed, `__MACOSX`, `Thumbs.db`) are silently dropped; a path containing
    `..`, a leading `/`, or a Windows drive letter throws `PathTraversalError`
    (`ingestInput.ts:75-97`).
  - **Real, cited size guards** (`ingestInput.ts:39-41`): `DEFAULT_MAX_BYTES = 1024*1024*1024`
    (1 GB compressed) → `OversizeImportError`; `DEFAULT_MAX_FILES = 10_000` → `TooManyFilesError`;
    `DEFAULT_MAX_ZIP_UNCOMPRESSED = 5*1024*1024*1024` (5 GB uncompressed, zip-bomb guard) →
    `ZipBombError`. Round 1 finding #5 + ruling: checking these numbers only appear *somewhere* in
    the route's source text is not acceptable evidence for a PRD that claims real 4xx rejection —
    S10A-2 now pins an **injectable override contract** so the verifier exercises the real rejection
    HTTP response, not source text alone.
- **Instatic ships a real MCP server — confirmed, not assumed.** `CLAUDE.md` (Instatic repo) states
  directly: "**MCP server:** Instatic exposes its CMS tools to external MCP clients (Claude Code,
  Codex, remote agents) at `/_instatic/mcp`, authenticated by per-connector bearer tokens." Full wire
  contract, `docs/features/mcp-connectors.md`: transport is **Streamable HTTP** (the doc's own
  architecture diagram: `"MCP client │ Streamable HTTP + OAuth/PAT bearer"`), endpoint always
  `https://<your-host>/_instatic/mcp` (lines 20-24), two auth modes — hosted OAuth (S256 PKCE,
  requires a public HTTPS deployment: "Hosted clients... cannot reach `localhost`, a private LAN
  address, or an HTTP-only deployment") and **personal access token**, documented exactly as:
  ```sh
  claude mcp add instatic --transport http http://localhost:3000/_instatic/mcp \
    --header "Authorization: Bearer imcp_pat_…"
  ```
  (`docs/features/mcp-connectors.md:81-86`, "Claude Code example" — line 16 states the same header
  shape in prose). Round 1 finding #6: the header check must bind the **exact** documented shape
  "Bearer imcp_pat_", not merely the bare substring "imcp_pat" anywhere in the placeholder text —
  fixed in C10A-1.
- **`pnpm guard` already enforces CLI\<->route parity generically.** `scripts/guard.ts` reads
  `scripts/waves/capability-manifest.json` (54.9 KB, already exists — W0/W1/W4 have landed in this
  tree) and asserts every `SUBCOMMAND_MAP` capability in `cli.ts` has exactly one manifest row, and
  every `/api/` route `cli.ts` reaches stays inside that row's committed `knownNamespaceRoutes`
  snapshot. `project` is an existing `SUBCOMMAND_MAP` capability — adding a new `case` under the
  *existing* `project` dispatcher needs a manifest **row update**, and `pnpm guard` fails closed if
  that update is missing. C10A-6 leans on this mechanism directly.
- **CLI subprocesses must be pointed explicitly at a target daemon, and the verifier must not trust
  a booted daemon's own self-reported URL blindly** (round 1 finding #7). Every `od` HTTP subcommand
  resolves its base URL through a shared helper honoring, in order, `--daemon-url`, `OD_DAEMON_URL`,
  `OD_SIDECAR_IPC_PATH` discovery, then a **hard-coded default of `http://127.0.0.1:7456`**
  (`cli.ts:1059`, `:2353`, `:5199`, `:5250`). `server.ts` (the file that produces `started.url`) is
  itself a leased, implementation-controlled file — the verifier does not merely pass `--daemon-url`
  and hope; it **parses and validates** every booted daemon's reported URL (`http:` scheme, exact
  `127.0.0.1` host, a valid nonzero port, explicitly excluding 7456 and 51012) before issuing any
  request or CLI spawn, and treats a validation failure exactly like a boot failure — fail closed,
  never a silent fallback to the default port.

## Scope

**S10A-1 — Register Instatic as a selectable MCP client template, with a working PAT-mode row
model.** Exactly one new entry in `MCP_TEMPLATES` (`apps/daemon/src/mcp-config.ts`), category
`publishing`, structurally valid under the same rules every existing template already satisfies (id
matches `SERVER_ID_PATTERN` `^[a-z0-9][a-z0-9_-]{0,63}$`; non-placeholder `label`/`description`/
`homepage`; **no `SpreadAssignment` in the object literal** — a runtime spread could override
`id`/`url`/`authMode` even when the literal's own properties look frozen, carry-forward hardening
from a sibling wave's round-1 review). Per the evidence in **Ground facts**: `transport: 'http'`;
`url` defaulting to `http://localhost:3000/_instatic/mcp` (Instatic's own documented local example —
self-hosted, so unlike every other current `http` template this field is a *starting point* the
user edits to their real deployment host); `authMode: 'none'` **explicitly set**; a required
`headerFields` entry `{key: 'Authorization', ...}` whose placeholder/label matches the **exact**
evidenced shape `/bearer\s+imcp_pat_/i` (not merely the bare substring `imcp_pat`).

**New required file: `apps/web/src/state/mcpTemplateRow.ts`** — a pure module (no React/DOM/CSS
imports) exporting at minimum `rowFromTemplate` and `authModeAfterUrlChange`, extracted from
`McpClientSection.tsx`'s existing local functions of the same names (`inferMcpAuthMode` and
`effectiveMcpAuthMode` move too, since `authModeAfterUrlChange` depends on the first).
`McpClientSection.tsx` imports these instead of defining them locally. **Behavioral contract (what
C10A-1 tests, black-box — the mechanism is the implementer's choice):**
1. `rowFromTemplate(instaticTemplate, new Set())` produces a row whose `authMode === 'none'`.
2. Calling `authModeAfterUrlChange(row, '<any non-loopback URL>')` on that row's own return value
   (not a hand-picked subset of its fields) **still returns `'none'`** — editing the url to a real,
   non-loopback, self-hosted deployment host must never silently flip an explicitly-template-set
   PAT mode into OAuth mode. (One acceptable, non-mandated mechanism: `rowFromTemplate` stamps an
   extra field such as `_authModeExplicit: true` whenever `tpl.authMode !== undefined`, and
   `authModeAfterUrlChange` checks that field first, before its existing infer-from-url fallback —
   the user can still change auth mode manually via the UI's own selector, a separate code path.)
3. The row's header text never contains the placeholder token `imcp_pat` verbatim (secret fields
   seed empty, matching every other template's existing behavior — a regression guard, not a new
   rule).

Selecting the template must never write to a user's live `mcp-config.json` on its own — it only
ever pre-fills a form the user saves explicitly (C10A-5 checks nothing new violates it).

**S10A-2 — Super Import–compatible static export.** Per the real contract in **Ground facts**,
Instatic's Super Import needs nothing more than a flat, relative-path static-site zip inside its own
size guards — which is structurally what `GET /api/projects/:id/archive` (`buildProjectArchive`)
already produces today. **No `pages/`/`tokens/`/`media/` restructuring.** A new, dedicated,
discoverable route, **`GET /api/projects/:id/export/super-import`**, is added to:

- Give the seam an intentional, discoverable name distinct from "Download as .zip."
- **Reject a project containing a file at the exact path `.instatic/site-bundle.json`** with a 4xx,
  rather than silently including it — that path would make Instatic treat the whole zip as its
  different native CMS-transfer archive format, per `site-import.md:302` (round 1 finding #5).
- **Proactively enforce Instatic's own documented ingestion guards before the round trip**, via an
  **injectable override contract this PRD pins exactly** so the rejection path is testable without
  a 10,001-file fixture: the route reads `process.env.SUPER_IMPORT_MAX_FILES_OVERRIDE` and
  `process.env.SUPER_IMPORT_MAX_BYTES_OVERRIDE`; each, if set to a valid positive integer string, is
  the limit for that guard; otherwise the route falls back to Instatic's real defaults, bound to a
  **named** constant (`10_000` / `1024*1024*1024` respectively, `ingestInput.ts:39-41`) — never a
  bare number floating in the file with no assignment context. Exceeding either limit returns a 4xx.
  A response body shape for this belongs in the new contract file below (`SuperImportExportErrorResponse`).
- Response content shape: identical to `/api/projects/:id/archive` — every project file at its
  natural relative path (dotfiles and `*.artifact.json` sidecars excluded, matching
  `collectArchiveEntries`'s existing rule). MishMash's own injected `DESIGN-HANDOFF.md`/
  `DESIGN-MANIFEST.json` sidecars (`apps/web/src/runtime/exports.ts:27-28`) are harmless here: both
  classify as Instatic's `meta` role, never a stray page or asset.

**New required file: `packages/contracts/src/api/project-super-import.ts`** — per `AGENTS.md`'s
three-step-closure rule, the shared contract type for this endpoint. At minimum:
```ts
export type SuperImportExportErrorCode =
  | 'FILE_COUNT_LIMIT_EXCEEDED'
  | 'BYTE_SIZE_LIMIT_EXCEEDED'
  | 'INSTATIC_TRANSFER_ARCHIVE_CONFLICT';

export interface SuperImportExportErrorResponse {
  error: { code: SuperImportExportErrorCode; message: string; limit?: number; actual?: number };
}
```
The daemon route and the web UI's error handling both import this type — never a divergent
locally-declared shape on either side (`AGENTS.md` Boundary constraints: "update contracts before
wiring divergent web/daemon request or response shapes"). **No bespoke verifier check enforces this
file's existence directly** — `pnpm typecheck` (C10A-6) already fails closed the moment any web code
imports it and it does not exist, which it must, to render the 4xx error message; see **Ground
facts** for why this is real enforcement, not a gap.

**S10A-3 — Capability-exposure parity (repo-standing rule, not new to this wave).** Per `AGENTS.md`
"Capability exposure (UI/CLI dual-track)," the new export is a genuinely new capability and needs
all three surfaces landed together:
- HTTP route above (`apps/daemon/src/routes/project-super-import.ts`, registered from `server.ts`).
- `od project export-super-import <id> [--out <path>] [--json]` — mirrors `od project archive`'s
  flag shape exactly, same dispatcher, `case` added beside `'archive'`. **`--root` is deliberately
  absent** (round 1 ruling: "`--root` should remain absent for a complete-site seam" — this export
  is always the whole project, never a scoped subdirectory, unlike `archive`).
- UI: a new exported helper in **`apps/web/src/runtime/exports.ts`** (matching the
  `downloadProjectArchive` precedent exactly — see **Ground facts**), and a labeled click handler in
  **`apps/web/src/components/DesignFilesPanel.tsx`** that imports and calls it. C10A-4 checks this
  binding structurally (AST: the click handler's own body calls the imported identifier; that
  identifier resolves to an exported function in `runtime/exports.ts`; that function's own body
  contains a `fetch(...)` call naming the `/export/super-import` route; the owning JSX element's
  attributes/children mention "Instatic" or "Super Import").
- New i18n keys `designFiles.exportSuperImport` / `designFiles.exportSuperImportFailed` in
  `apps/web/src/i18n/types.ts` and `apps/web/src/i18n/locales/en.ts`, sibling to the existing
  `designFiles.downloadProject` / `downloadProjectFailed` pair (`types.ts:3284-3285`,
  `en.ts:2523-2524`) — see **Ground facts** for why this exact naming also satisfies C10A-4's label
  check.

## Implementation ceremony (round 1 finding #2 + ruling — binding)

**`docs/plans/waves/leases.json`'s house rule: a wave's own PRD and verifier are never in that
wave's implementation lease.** After this PRD is approved and frozen, `scripts/waves/verify-w10a.ts`
and this file are **baseline inputs**, read but never written by the implementation branch — the
proposed lease below excludes both. This alone is necessary but not sufficient: the committed
in-tree verifier still *physically* exists and is runnable by anyone with repo access, so landing
requires more than "the lease would catch an edit."

**Landing requires ALL of:**
1. Before implementation starts, the orchestrator copies this frozen, approved
   `scripts/waves/verify-w10a.ts` to a location the implementation branch cannot write to (or
   otherwise pins its hash) and writes `~/.claude/goal-state/mishmash-w10a-instatic/
   approved-gate.sha256` containing that file's sha256.
2. The run that decides landing executes **that external, orchestrator-custody copy** — never the
   implementation branch's own working-tree copy of the file, even though the two are expected to be
   byte-identical (the point is provenance, not content).
3. The resulting `manifest.json` reports `gateIntegrityPinned: true` **and** `GATE-INTEGRITY.status
   === 'pass'` (the self-hash matches the pinned approval).
4. `manifest.gateIntegrityPinned === false` is legal only for pre-approval, advisory dry-runs (e.g.
   the runs this PRD's own author performed while drafting it, and the baseline captured below) —
   **never for a landing decision.** A run with `gateIntegrityPinned: false` proves nothing about
   provenance and must not be cited as landing evidence.

This makes GATE-INTEGRITY's role explicit rather than merely present-but-unused: the field already
existed in the manifest shape; this section is what turns it into an enforced gate for *this* wave's
landing, matching the same clause pattern `W9-ingest-tranche.md`'s "Definition of green" used for
its own downstream consumer.

## Explicitly out of scope

Everything past the two seam halves the founder ruling named, plus the one narrow correctness fix
S10A-1 requires to make the MCP half actually work. Concretely, none of the following are this
wave's job, and this PRD does not design extension points for any of them:

- Any Instatic-initiated network call into MishMash, or any MishMash-initiated call *into* a live
  Instatic instance (auto-push, auto-publish, "send to Instatic" one-click deploy). The MCP
  registration is a **selectable preset**; the export route is a **local zip generation with no
  network egress**. C10A-5 checks both mechanically via an AST added-call diff, not a raw grep.
- Auto-connecting, auto-enabling, or defaulting the Instatic template into any user's live server
  list. Template selection stays an explicit, user-driven save, unchanged from every other of the
  39 existing templates.
- A live round-trip through a *running* Instatic instance's actual admin UI / Site Import wizard.
  A read-only source checkout exists at `~/projects/tools/third-party/instatic` and was read for
  the evidence above, but this wave never installs, starts, or drives a running Instatic instance.
- Instatic's Core Framework token engine, QuickJS-WASM plugin sandbox, or CMS-native site-transfer
  bundle format (`docs/features/site-transfer.md` in the Instatic repo — a different feature from
  Super Import) — no coupling to any of these is designed or implied here.
- Instatic's hosted-OAuth MCP mode (`authMode: 'oauth'`) — deliberately not pinned; requires a
  public HTTPS Instatic deployment and unverified wire-compatibility with MishMash's generic OAuth
  client against Instatic's specific RFC 9728 + dynamic-registration flow. A founder-scoped
  follow-up, not a silent addition here.
- Closing the pre-existing "no CLI for managing external MCP client entries" gap. It predates this
  wave, applies uniformly to all 39 templates, and fixing it is a general MCP-client capability
  change, not an Instatic-specific one.
- Any new workflow, wizard, onboarding step, or persisted "this project is linked to Instatic"
  state. The export is a one-shot, stateless artifact — no relationship survives past the download.
- Any change to `apps/daemon/src/routes/library.ts`, `brands/**`, `design-systems/**` internals, or
  any file this wave does not explicitly lease.
- Generating a 10,001-file or >1 GB real fixture to runtime-prove the size-guard rejection path at
  Instatic's actual default thresholds — the injectable-override contract (S10A-2) proves the same
  code path fires correctly at a cheap, deterministic scale; see **Adversarial review** finding #5.

## Proposed lease row (text only — `leases.json` is not edited by this PRD)

```jsonc
"W10a-instatic": {
  "slug": "mishmash-w10a-instatic",
  "allow": [
    "apps/daemon/src/mcp-config.ts",
    "apps/daemon/src/routes/project-super-import.ts",
    "apps/daemon/src/server.ts",
    "apps/daemon/src/cli.ts",
    "apps/web/src/components/DesignFilesPanel.tsx",
    "apps/web/src/components/McpClientSection.tsx",
    "apps/web/src/runtime/exports.ts",
    "apps/web/src/state/mcpTemplateRow.ts",
    "apps/web/src/i18n/types.ts",
    "apps/web/src/i18n/locales/en.ts",
    "packages/contracts/src/api/project-super-import.ts",
    "apps/daemon/tests/project-super-import-*.test.ts",
    "apps/daemon/tests/mcp-templates-instatic.test.ts",
    "apps/web/tests/mcpTemplateRow-*.test.ts",
    "scripts/waves/capability-manifest.json"
  ],
  "deny": [
    "apps/web/src/providers/registry.ts",
    "scripts/waves/verify-w10a.ts",
    "docs/plans/waves/W10a-instatic-seam.md",
    "docs/plans/waves/leases.json",
    "docs/plans/waves/DECISIONS.md",
    "docs/security/**"
  ],
  "note": "Round-1 fix: scripts/waves/verify-w10a.ts and this PRD are REMOVED from allow and explicitly denied -- the house rule is that a wave's own PRD/verifier are baseline inputs after freeze, never implementation-lease files (see the PRD's 'Implementation ceremony' section for what landing actually runs). apps/daemon/src/routes/project-super-import.ts is a NEW dedicated route file (house pattern: one module per route concern, matching routes/library.ts, routes/covers*.ts). registry.ts stays denied -- ruling confirmed DesignFilesPanel.tsx already performs a direct archive-shaped fetch (handleBatchDownload) and the REUSABLE full-project downloader precedent (downloadProjectArchive) lives in runtime/exports.ts, not registry.ts; this wave's new export helper follows that exact precedent. McpClientSection.tsx is leased narrowly for the import-swap onto the new mcpTemplateRow.ts module (its own local rowFromTemplate/authModeAfterUrlChange/inferMcpAuthMode/effectiveMcpAuthMode functions move out, the component imports them). packages/contracts/src/api/project-super-import.ts and the two i18n files were missing from the original proposal (round-1 finding #3) -- added per AGENTS.md's three-step-closure rule. server.ts is leased narrowly for the one new route-registration call site only."
}
```

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-w10a.ts`,
runnable now via `pnpm exec tsx scripts/waves/verify-w10a.ts` for authoring-time dry runs — **landing
requires the orchestrator-custody copy per "Implementation ceremony," never this working-tree file.**

| ID | Criterion | Verification |
|---|---|---|
| C10A-1 | Instatic MCP template registered, real-transport shape, spread-safe, URL-edit-sticky | Isolated daemon boot, URL validated (protected-port check, see C10A-*'s shared isolation note below) before any request; `GET /api/mcp/servers`; exactly one `templates[]` entry identifiable as Instatic; `transport==='http'`; `url` ends `/_instatic/mcp`; `authMode==='none'`; `headerFields` entry `key==='Authorization'` whose placeholder/label matches `/bearer\s+imcp_pat_/i` exactly (not the bare substring); source-level AST check that the template's own object literal in `mcp-config.ts` contains **zero** `SpreadAssignment` nodes; **functional** check that dynamically imports `apps/web/src/state/mcpTemplateRow.ts` and calls its real `rowFromTemplate`/`authModeAfterUrlChange` — asserts `authMode==='none'` immediately after template selection AND stays `'none'` after simulating a URL edit to a non-loopback host, and that no header text leaks the placeholder token verbatim |
| C10A-2 | Super Import export matches Instatic's real ingestion contract, provably, at runtime | Real HTTP `GET /api/projects/:id/export/super-import` against a fixture project covering **every** `classifyFiles.ts` role (html, css, js, font, image, ordinary meta/json, binary) at natural relative paths, byte-identical (sha256) to fixture, no `pages/`/`tokens`/`media/` prefix; `index.html.artifact.json` sidecar absent (negative control); a **separate** fixture project containing a file at the exact path `.instatic/site-bundle.json` is rejected with a 4xx (not silently exported); **two additional isolated daemon boots**, each with one size guard overridden via `SUPER_IMPORT_MAX_FILES_OVERRIDE=2` / `SUPER_IMPORT_MAX_BYTES_OVERRIDE=100`, each fed a tiny fixture that exceeds only that guard, each asserting a real HTTP 4xx — never source-text-only; source-level check that the route's default fallbacks are bound to named `MAX_FILES`/`MAX_BYTES`-shaped assignments equal to Instatic's real `10_000`/`1073741824` (not merely present in a comment or dead branch), and that both override env var names are referenced |
| C10A-3 | CLI parity, real subprocess, no `--root` | `od project export-super-import <fixtureId> --daemon-url <validated-isolated-url> --out <tmp> --json`, real child process, `OD_DAEMON_URL` also set, never falling through to `127.0.0.1:7456`; exit 0; saved file sha256-identical to C10A-2's HTTP response body for the same fixture |
| C10A-4 | Super Import UI entry point — structural AST binding, comment-safe, decoy-safe | Parses `DesignFilesPanel.tsx`; finds an `onClick`/`onSelect`/`onPress` JSX attribute whose resolved handler body (inline arrow or a same-file named function/const it points to) calls an identifier imported from a `runtime/exports` module specifier; resolves that identifier to an **exported** function in `runtime/exports.ts` and requires a `fetch(...)` call inside *that function's own body* naming `/export/super-import`; requires the owning JSX element's attributes/children to mention "Instatic" or "Super Import." All matching is via TypeScript AST node text (`getText()`), which excludes comments/trivia by construction — no line-proximity heuristic, no naive `//`-split |
| C10A-5 | No deeper coupling (founder-pin scope fence) — AST added-call/added-import diff | For every changed product `.ts`/`.tsx` file (excluding `scripts/waves/**`, `docs/**`), parses BOTH `git show <baseCommit>:<file>` and the HEAD version, diffs the **set of call/new-expression node texts** (added = present at HEAD, absent at base) and **import module specifiers** (added the same way); classifies each added call by AST shape (identifier/property-access name, not raw text) against `fetch`/`axios`/`http(s).request`/`net.connect`/`net.createConnection`/`undici.request`/`undici.fetch`/`new WebSocket`/`writeMcpConfig`/any `child_process` exec-family call whose arguments mention curl/wget/nc; flags any newly-added import of `axios`/`undici`/`net`/`child_process`/`ws`/`got`/`node-fetch`/`superagent`/`ky`/etc. `writeMcpConfig` and non-fetch primitives are unconditionally forbidden when newly added; a newly-added `fetch(...)` is allowed **only** in `apps/web/src/runtime/exports.ts` or `apps/daemon/src/cli.ts`, and only when its own argument text names `/export/super-import` and never names `instatic` directly |
| C10A-6 | Gates | `pnpm guard` and `pnpm typecheck` both exit 0 on the current tree — this also mechanically forces `capability-manifest.json`'s `project` row to list the new route, and fails closed if `packages/contracts/src/api/project-super-import.ts` or either i18n key is missing while imported/referenced |

Plus the three named infra checks (house pattern, `verify-w9-ingest.ts` precedent):
**GATE-INTEGRITY** (self-hash pin; see **Implementation ceremony** — `false` is legal for advisory
dry-runs only, never for a landing decision), **LEASE** (`git diff --name-only <baseCommit>...HEAD`
⊆ `leases.json@baseCommit`'s `W10a-instatic.allow`, read via `git show`, never the working tree —
**expected to fail honestly until this PRD lands on `main` and the lease row above is actually
added**), **HEAD-DRIFT** (HEAD must not move mid-run).

**Shared isolation note (round 1 finding #7, applies to every criterion above that touches a
daemon):** every daemon URL this verifier uses — the main fixture daemon plus the two size-guard
override daemons — is parsed and validated (`http:` scheme, exact `127.0.0.1` host, a valid nonzero
port, explicitly excluding 7456 and 51012) immediately after boot, before any request or CLI spawn
is issued against it. A validation failure is treated exactly like a boot failure: the daemon is
killed immediately and every criterion depending on it fails closed with the validation reason
recorded, never a silent fallback to a default port.

## Verified baseline (this run, pre-implementation, post round-1 fixes)

Captured by actually running `pnpm exec tsx scripts/waves/verify-w10a.ts` against this branch
before any product code exists (an authoring-time dry run — `gateIntegrityPinned: false` is expected
and legal here per **Implementation ceremony**; this run is never landing evidence). `4/9` pass:
C10A-1 (2 problems: no Instatic template found; `mcpTemplateRow.ts` does not exist), C10A-2 (2
problems: export route 400s; route file does not exist to check its size-guard constants), C10A-3
(HTTP baseline unavailable), C10A-4 (2 problems: `DesignFilesPanel.tsx` imports nothing from
`runtime/exports`; no handler calls such an import), and LEASE (no lease row landed yet) all report
`fail` honestly. C10A-5, C10A-6, GATE-INTEGRITY, and HEAD-DRIFT report `pass`. C10A-5's pass is a
**legitimate, disclosed vacuous pass** (zero product `.ts`/`.tsx` files touched yet, so the added-
call/added-import diff finds nothing to classify) — not a loophole; C10A-1..C10A-4 independently
carry the burden of proving the features exist. Within C10A-2, the poison-file and both size-guard
sub-checks currently report no violation **only because the blanket route-not-found 4xx already
satisfies "was rejected"** for every sub-check — this is the same honest pre-implementation shape as
C10A-5, not evidence those specific behaviors work; the criterion's overall verdict is still `fail`
via the primary content check. `pnpm guard`/`pnpm typecheck` (C10A-6) pass today since this PRD and
its verifier are the only new files and both are within repo conventions — this run's own C10A-6
evidence is a real, full-repo pass, not merely assumed. Manifest carries all 9 required criterion
IDs exactly.

## Adversarial review

**Round 1 — GPT-5.6 Sol — REJECT.** Verbatim findings, rulings, and disposition (fix-round cap 2 per
`VERIFICATION-CONTRACT.md` §6; this is fix round 1 of 2 before founder escalation):

1. **"C10A-5 is unsatisfiable and porous."** Whole-file regex over entire changed files flagged
   pre-existing `fetch`/`writeMcpConfig` tokens in files a correct implementation must touch
   (`mcp-config.ts`, `cli.ts`, `DesignFilesPanel.tsx`), making C10A-1/3/4 and C10A-5 mutually
   unsatisfiable; conversely `net`/`undici`/`WebSocket`/`child_process curl`/an imported wrapper
   evaded the regex entirely. **Fixed:** C10A-5 rebuilt on an AST added-call/added-import diff
   (base vs HEAD, per file), classifying by AST node shape with an allowlist scoped to the two real
   local-daemon call sites — see the criteria table row above.
2. **"The proposed lease violates the approved-copy house rule."** Included both the wave verifier
   and PRD; after freeze they are baseline inputs, not implementation writes; the PRD also
   instructed running the in-tree verifier while GATE-INTEGRITY passes with no approved hash.
   **Fixed:** both files removed from `allow` and added to `deny`; new **Implementation ceremony**
   section names and requires the orchestrator-custody external copy and a hard
   `gateIntegrityPinned: true` + `GATE-INTEGRITY: pass` requirement for any landing decision.
3. **"The product write set omits required capability-contract and UI ownership files."** No
   `packages/contracts/src/api/` contract path leased; no typed i18n keys leased beside the existing
   `designFiles.downloadProject` pair. **Fixed:** `packages/contracts/src/api/project-super-
   import.ts` (with a minimal pinned shape) and both i18n files added to scope and lease; explained
   in **Ground facts** why no additional bespoke verifier check was needed (C10A-6's typecheck
   already fails closed on either gap once the files are in scope).
4. **"C10A-4 admits trivial decoys."** Any `/export/super-import` string within three lines of an
   unrelated `fetch`/`.get`/`*Api(` passed; block comments were not stripped. **Fixed:** rebuilt on
   cross-file AST binding (click handler's own resolved function body → an identifier imported from
   `runtime/exports` → that exported function's own body contains the route literal in a `fetch`
   call), comment-safe by construction (AST `getText()` excludes trivia).
5. **"C10A-2 does not prove the promised export or rejection behavior."** Limit check accepted
   constants in comments/dead code; fixture covered only html/css/image, so an exporter dropping
   js/fonts/ordinary-json/binary would still pass; no explicit rejection of a poisoned
   `.instatic/site-bundle.json`. **Fixed:** fixture now covers every `classifyFiles.ts` role with
   distinct positive controls; a separate poison-file fixture asserts 4xx; an injectable-override
   env-var contract (pinned in S10A-2) lets the verifier boot two more isolated daemons and assert
   real HTTP 4xx for both size guards; the source check now requires a *named-assignment-bound*
   match, not bare presence.
6. **"C10A-1 does not bind the evidenced PAT header and can silently enter deferred OAuth."**
   Accepted the bare substring `imcp_pat` instead of the documented `Bearer imcp_pat_...`; a direct
   read of `McpClientSection.tsx` confirmed `authModeAfterUrlChange` silently flips an explicit
   `authMode:'none'` to `'oauth'` the moment the loopback default url is edited to a real host,
   because the seeded value happens to equal what inference would have produced anyway; the header
   placeholder is (correctly) never seeded as real data, so a criterion must test the row-logic
   function, not the static API object. **Fixed:** header regex tightened to `/bearer\s+imcp_pat_/
   i`; new required pure module `apps/web/src/state/mcpTemplateRow.ts` with a black-box behavioral
   contract (S10A-1) the verifier dynamically imports and exercises; the SpreadAssignment ban
   (carry-forward hardening) added to the same criterion.
7. **"Protected-port isolation is not fail-closed."** The verifier trusted `started.url` from a
   leased, implementation-controlled `server.ts` without parsing/rejecting 7456/51012. **Fixed:**
   `validateIsolatedDaemonUrl` parses and validates every booted daemon's URL (scheme, exact host, a
   valid nonzero non-protected port) before any request or CLI spawn; a failure is treated exactly
   like a boot failure.
8. **"The self-evidencing template inventory is inaccurate."** PRD said 25 templates while its own
   listed category counts summed to 39, and the real array has 39 entries. **Fixed:** every
   occurrence corrected to 39; the count is additionally re-derived, not hand-counted, wherever this
   document restates it.

**Rulings (applied verbatim):**
- **registry.ts:** "The denial is architecturally honest; `DesignFilesPanel.tsx` already performs a
  direct archive request, while the reusable full-project downloader actually lives in
  `runtime/exports.ts`, not `registry.ts`. If implementation needs another owner, amend and
  serialize the lease before work; do not force duplication or widen it silently." Confirmed by
  direct read (see **Ground facts**); the proposed lease and S10A-3 now name `runtime/exports.ts`
  explicitly as the new helper's home, matching the `downloadProjectArchive` precedent exactly.
- **CLI/HTTP byte identity:** "Keep the exact bar. `buildProjectArchive` uses stable file mtimes and
  epoch dates for generated metadata (`projects.ts:351`), and the archive CLI is already a thin
  fetch-and-save wrapper (`cli.ts:6200`). `--root` should remain absent for a complete-site seam."
  C10A-3 unchanged in strictness; S10A-3 now states the `--root` omission is deliberate, not an
  oversight.
- **Size-guard rejection:** "Source-only checking is not acceptable while the PRD claims operational
  4xx rejection. Use injectable limits or a pure guard helper and assert the real route's error
  response." Implemented exactly as the injectable-override contract in S10A-2/C10A-2.
- **House-rule lease:** "FAIL. Remove the verifier and PRD from the implementation lease and bind
  execution to the approved external verifier copy." Implemented per finding #2's disposition above.

**Carry-forward hardening (program-wide, from a sibling-wave round-1 review by the same reviewer;
round 2 explicitly stated it will probe this wave for the same class of defect):** C10A-1's template
projection must fail closed on any `SpreadAssignment` inside the new template object (a runtime
spread can override `id`/`url`/`authMode` even when the literal properties look frozen) — added as
a source-level AST check in C10A-1. Any comment-detection must handle template-literal tails
correctly (a naive scanner misclassifies `` `${0}// TEXT` `` as a comment token) — closed by
replacing every prior line-based `.split('//')` heuristic (C10A-4's original design) with AST
`getText()`-based matching throughout, which never treats template-literal interpolation content as
a comment because the parser itself draws that boundary, not a string scan.

## Open questions for adversarial review (round 2)

1. **`mcpTemplateRow.ts`'s exact stickiness mechanism is illustrative, not mandated.** S10A-1
   suggests one shape (`_authModeExplicit` stamped by `rowFromTemplate`) but the verifier only
   tests black-box input/output behavior. Is a behavioral contract sufficient here, or does round 2
   want the mechanism itself pinned (e.g. to guarantee it also fixes the same latent bug for any
   *future* template with an explicit `authMode` and a url the user is expected to edit)?
2. **The contract file's exact shape (`SuperImportExportErrorResponse`) is this document's design
   choice, not derived from an existing sibling contract file for a binary-response route** — no
   other route in this repo returns a raw zip stream *and* a typed JSON error body, so there was no
   existing pattern to mirror exactly. Is the minimal three-error-code shape sufficient, or should
   round 2 require additional fields (e.g. a machine-readable list of offending paths for the
   poison-file case)?
3. **`registry.ts` collision risk (carried from round 1, unresolved by the ruling, which only
   confirmed the denial is correct — not that no future collision is possible).** If a later wave's
   own work legitimately needs to touch `runtime/exports.ts` or `DesignFilesPanel.tsx` concurrently
   with this one, that needs an explicit lease amendment and burst-ordering decision before it
   lands, not a silent widen.
4. **C10A-2's size-guard rejection tests use `3 files / 16 bytes each` and `1 file / >400 bytes`
   against overrides of `2` and `100` respectively** — arbitrary-but-small numbers chosen only to be
   cheap and to isolate one guard from the other. If round 2 wants a specific minimum fixture
   scale (e.g. to also prove the guard fires correctly near a boundary, not just "some large-enough
   number"), that should be pinned explicitly rather than left to this document's arbitrary choice.
