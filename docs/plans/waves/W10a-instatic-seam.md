# Wave 10a — Instatic seam (MCP registration + Super Import export)

**Slug:** `mishmash-w10a-instatic`
**Gates on:** founder ruling only (NM-24, resolved 2026-07-27 — no wave-code dependency; may run
independently of W1/W3/W4/W6a/W8).
**Loop:** `loop:red-green-review` (`VERIFICATION-CONTRACT.md` §6).
**Verifier:** `scripts/waves/verify-w10a.ts` — **but see "Implementation ceremony" below: the
committed in-tree copy is a baseline input after freeze, not what landing runs.**
**Write lease:** proposed below — **not yet applied to `docs/plans/waves/leases.json`**; this PRD
does not edit that file per its authoring mandate.
**Status: DRAFT, round 3 delivered, confirmation review pending.** Round 1 adversarial review
(GPT-5.6 Sol) returned **REJECT** with 8 findings, 3 rulings, and one carry-forward hardening
requirement. Round 2 (same reviewer) re-reviewed the round-1 fixes and returned **REJECT** again:
of the 8 findings, #2 was **FIXED**, #3/#7/#8 were **FIXED-WITH-DEFECT**, and #1/#4/#5/#6 were **NOT
FIXED** — plus four **open-question rulings** (stickiness, contract shape, `registry.ts`, fixture
scale). Founder authorized round 3 (2026-07-28) scoped strictly to the round-2 residuals, explicitly
as the **final** fix round: one confirmation review follows delivery, then freeze or park — there is
no round 4. All round-1 AND round-2 findings are disposed in **Adversarial review** below, with the
fixed criterion/verifier line cited for each. Written under the NM-41C expansion gate
(`W5-W11-gated.md` lines 8–24): frozen only after an independent reviewer who will not implement it
returns a machine-readable `APPROVE`. No implementation work may start from this text before that
review lands. This document is an **expansion**, not an implementation — zero product code
accompanies it; every criterion below currently fails, honestly, by design (see **Verified
baseline**).

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
- **`AGENTS.md`'s capability-exposure rule requires a contract type for the new HTTP endpoint — but
  not necessarily a NEW contract file.** (`AGENTS.md`, "Capability exposure (UI/CLI dual-track)"):
  "Adding a new capability is a three-step closure: HTTP endpoint in `apps/daemon/src/*-routes.ts`
  (with a contract type in `packages/contracts/src/api/`), UI surface in `apps/web/src/`, and
  `od <capability>` subcommand … registered through `SUBCOMMAND_MAP`. Land all three in the same
  PR." Round 1 finding #3 first tried to satisfy this with a **new, bespoke** file
  (`packages/contracts/src/api/project-super-import.ts`, a hand-rolled
  `SuperImportExportErrorResponse` shape) — round 2's open-question ruling on contract shape
  rejected that: "reject the bespoke envelope. The repository already has `ApiErrorResponse`,
  `ApiErrorCode`, `details`, and `sendApiError`. Reuse that envelope, adding properly leased domain
  codes/details only if necessary." Direct research (this round) into whether new codes are
  actually *necessary* found they are not:
  - `packages/contracts/src/errors.ts` already declares a closed `API_ERROR_CODES` union that
    includes `PAYLOAD_TOO_LARGE` and `CONFLICT` among its members, plus `ApiError { code, message,
    details? }` / `ApiErrorResponse { error: ApiError }` — exactly the two rejection shapes this
    route needs (a size-guard rejection and the poison-file conflict), with `details` already
    available to carry which guard/limit/actual value fired.
  - `apps/daemon/src/http/api-errors.ts` already exports the real send helper every other route
    uses: `sendApiError(res, status, code, message, init)`, which `.status(status).json({error:
    {code, message, ...init}})`s — no new response-building code is needed either.
  - `apps/daemon/src/http/response.ts`'s `ERROR_STATUS_BY_CODE` map already pins
    `PAYLOAD_TOO_LARGE → 413` and `CONFLICT → 409`, matching this route's two rejection cases
    exactly.
  - Real, existing precedent for this exact reuse pattern: `apps/daemon/src/import-export-
    routes.ts:1255`, `apps/daemon/src/routes/project/index.ts:3935`, and `apps/daemon/src/routes/
    library.ts:468` all call `sendApiError` with codes from this same closed union — this wave's
    route is not inventing a new pattern, it is following the majority-existing one.
  - Both `ApiErrorCode` and `ApiErrorResponse` are **already fully public**: `packages/contracts/
    src/index.ts:2` reads `export * from './errors.js';`, so `import { sendApiError } from
    '@open-design/contracts'`-shaped access already works with zero new barrel line, zero new
    `package.json` `exports` subpath, and zero new `esbuild.config.mjs` entry point. (Direct
    inspection this round: `packages/contracts/package.json`'s `exports` map only lists individual
    subpaths for 8 of the ~40 files under `src/api/`; `esbuild.config.mjs`'s `entryPoints` matches
    those same 8. Every other api file — including `errors.ts`, already-barrel-exported — needs no
    subpath or bundler entry at all, only the barrel re-export it already has.)
  - **Net effect: this wave needs zero new files under `packages/contracts/`, and therefore zero
    changes to `packages/contracts/src/index.ts`, `package.json`, or `esbuild.config.mjs` either.**
    Round 2 finding #3's defect — "the contract cannot be consumed through the supported package
    surface without also exporting it from `src/index.ts` or adding a package subpath; neither is
    leased" — is closed by removing the thing that needed exporting, not by leasing more files.
    S10A-2's route handler imports `sendApiError`/`ApiErrorCode` from `@open-design/contracts`
    (already public) and calls it with `'PAYLOAD_TOO_LARGE'` (for either size guard, distinguished
    via `details.limit`/`details.actual`) or `'CONFLICT'` (for the poison-file case). C10A-2 asserts
    the real response envelope shape and exact codes at runtime (see **Success criteria**).
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
  never a silent fallback to the default port. Round 2 finding #7's residual: every subsequent probe
  `fetch` used the runtime default (`redirect: 'follow'`), so a validated loopback route could still
  redirect a request to a protected port or an external host mid-flight, and "the spawned CLI is
  likewise trusted to honor its URL flags rather than falling back" was unproven. **Fixed:** every
  probe fetch in the verifier now sets `redirect: 'manual'` and hard-fails on any redirect-shaped
  response (see C10A-1..C10A-3's shared isolation note). The CLI-fallback half is deliberately
  **not** independently re-provoked with new detection machinery: doing so would require either
  disabling `7456`'s reachability check (unacceptable — that daemon is absolutely protected) or
  intentionally trying to make the CLI fall through to it, which risks actually reaching a
  protected daemon if the fallback bug were real. Instead, C10A-3's existing byte-identical-to-
  fixture requirement already transitively proves the CLI honored `--daemon-url`/`OD_DAEMON_URL`:
  the isolated daemon's fixture project id is freshly random per run and exists on no other daemon,
  so a CLI that silently fell back to `7456` (or any other daemon) would 404 or return unrelated
  content instead of byte-matching the HTTP baseline — C10A-3 would fail, not pass, under that
  failure mode. This reasoning is deliberately documented here rather than hidden, per round 2's
  "no unrelated failures admitted as pass" pressure.

## Scope

**S10A-1 — Register Instatic as a selectable MCP client template, with a working PAT-mode row
model bound to the production component.** Exactly one new entry in `MCP_TEMPLATES` (`apps/daemon/
src/mcp-config.ts`), category `publishing` **exactly** (not merely "a valid category" — round 2
finding #8's fresh-pressure blocker: "It also does not enforce the PRD's exact `publishing`
category"), structurally valid under the same rules every existing template already satisfies (id
matches `SERVER_ID_PATTERN` `^[a-z0-9][a-z0-9_-]{0,63}$`; non-placeholder `label`/`description`/
`homepage`). **Deep-spread ban at all depths, scoped to the actual `MCP_TEMPLATES` array element,
with a satellite-mutation check** (round 2 finding #6: "the spread ban checks only the first
matching object's direct properties, not nested spreads, `Object.assign`, satellite mutation, or a
decoy object with the same ID" — carry-forward hardening from round 1 confirmed still incomplete):
the Instatic entry must be located as its own **array element** of the real `MCP_TEMPLATES`
declaration (not merely "any object literal anywhere in the file with a matching id" — closes the
decoy-object evasion); that element must be a **direct object literal**, not a call-wrapped
construction (`Object.assign(...)`, a factory function, etc. — a call-wrapped element is rejected
outright as non-frozen shape); its entire object subtree, at any depth (e.g. inside a nested
`headerFields` array entry), must contain **zero** `SpreadAssignment`/`SpreadElement` nodes — a
runtime spread anywhere in the subtree could override `id`/`url`/`authMode` even when the top-level
properties look frozen; and the whole file is separately scanned for any assignment expression
whose left-hand side mentions `MCP_TEMPLATES` (a satellite mutation executed elsewhere in the
module, after the array declaration, that could rewrite the frozen-looking literal at runtime).
Per the evidence in **Ground facts**: `transport: 'http'`; `url` defaulting to
`http://localhost:3000/_instatic/mcp` **exactly** (Instatic's own documented local example —
self-hosted, so unlike every other current `http` template this field is a *starting point* the
user edits to their real deployment host — round 2 finding #8 flagged this default was not
enforced exactly either); `authMode: 'none'` **explicitly set**; a required `headerFields` entry
`{key: 'Authorization', ...}` whose placeholder/label matches the **exact** evidenced shape
`/bearer\s+imcp_pat_/i` (not merely the bare substring `imcp_pat`).

**New required file: `apps/web/src/state/mcpTemplateRow.ts`** — a pure module (no React/DOM/CSS
imports) exporting at minimum `rowFromTemplate` and `authModeAfterUrlChange`, extracted from
`McpClientSection.tsx`'s existing local functions of the same names (`inferMcpAuthMode` and
`effectiveMcpAuthMode` move too, since `authModeAfterUrlChange` depends on the first).
`McpClientSection.tsx` **must import these from the module and must no longer declare its own
same-named local functions** — round 2's open-question ruling on stickiness was explicit: "freeze
behavior, not `_authModeExplicit` or another private mechanism. Requiring the exact
`mcpTemplateRow.ts` extraction is over-prescriptive; if retained, the verifier must prove the
production component imports and uses it," and finding #6 independently confirmed the gap this
closes: "C10A-1 exercises a new module without proving `McpClientSection.tsx` imports or uses it
… an unused passing module alongside the unchanged buggy component goes green."

**Design choice (round 3, answering the ruling's "pick one"): retain the module (Option A), not
drop it for direct production-component testing (Option B).** Reasoning: `McpClientSection.tsx` is
**out of this wave's write lease under every other criterion except this one narrow import-swap**
(the lease explicitly scopes it to swapping in the module's functions, not general edits — see
**Proposed lease row**'s note), so a verifier that tested the buggy behavior directly against the
component's current, unfixed internals would either have to (a) statically re-implement/duplicate
the fix logic inside the verifier itself to know what "correct" looks like, which is far more
fragile and implementation-shaped than testing an explicit contract, or (b) require the component
itself to be more broadly re-writable, widening the lease beyond the founder-pinned seam. Retaining
the pure module keeps the **behavioral contract** (points 1–3 below) as the frozen, tested surface
— satisfying the ruling's "freeze behavior, not private mechanism" — while the **new** binding
check (below) closes the exact "unused passing module" gap the ruling anticipated, without
widening scope. The illustrative `_authModeExplicit` mechanism mentioned below remains exactly
that — illustrative, not mandated; the verifier never inspects it.

**Behavioral contract (what C10A-1 tests, black-box — the mechanism is the implementer's choice):**
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

**New production-binding check (round 3, closes round 2 finding #6's residual):** C10A-1 additionally
parses `McpClientSection.tsx` at HEAD and asserts (a) it imports both `rowFromTemplate` and
`authModeAfterUrlChange` from a `state/mcpTemplateRow` module specifier, and (b) it no longer
declares its own local function of either name — an unused-but-passing module sitting beside an
unchanged, still-buggy component now fails this check even though the module-level behavioral
contract (points 1–3) independently passes.

Selecting the template must never write to a user's live `mcp-config.json` on its own — it only
ever pre-fills a form the user saves explicitly (C10A-5 checks nothing new violates it).

**S10A-2 — Super Import–compatible static export.** Per the real contract in **Ground facts**,
Instatic's Super Import needs nothing more than a flat, relative-path static-site zip inside its own
size guards — which is structurally what `GET /api/projects/:id/archive` (`buildProjectArchive`)
already produces today. **No `pages/`/`tokens/`/`media/` restructuring.** A new, dedicated,
discoverable route, **`GET /api/projects/:id/export/super-import`**, is added to:

- Give the seam an intentional, discoverable name distinct from "Download as .zip."
- **Reject a project containing a file at the exact path `.instatic/site-bundle.json`** with
  **exactly HTTP 409**, `error.code === 'CONFLICT'` (the reused envelope — see below), rather than
  silently including it — that path would make Instatic treat the whole zip as its different native
  CMS-transfer archive format, per `site-import.md:302` (round 1 finding #5). Round 2 finding #5: a
  route that crashed with a 500 for ANY reason previously satisfied "rejected"; that is no longer
  sufficient — the exact status and code must match, or the criterion fails (`VERIFICATION-CONTRACT`
  R4).
- **Proactively enforce Instatic's own documented ingestion guards before the round trip**, via an
  **injectable override contract this PRD pins exactly** so the rejection path is testable without
  a 10,001-file fixture: the route reads `process.env.SUPER_IMPORT_MAX_FILES_OVERRIDE` and
  `process.env.SUPER_IMPORT_MAX_BYTES_OVERRIDE`; each, if set to a valid positive integer string, is
  the limit for that guard; otherwise the route falls back to Instatic's real defaults, bound to a
  **named** constant (`10_000` / `1024*1024*1024` respectively, `ingestInput.ts:39-41`) — never a
  bare number floating in the file with no assignment context, comment, or dead branch (round 2
  finding #5: "the supposedly comment/dead-code-safe default check is still a raw regex over
  source, so a comment or unused assignment passes" — the verifier's check is now a genuine AST
  `NumericLiteral`/multiplication-chain scan, which a comment can never satisfy because a comment
  has no AST node at all). Exceeding either limit returns **exactly HTTP 413**, `error.code ===
  'PAYLOAD_TOO_LARGE'`, with `details` distinguishing which guard fired (`kind: 'files' | 'bytes'`,
  `limit`, `actual`). **A fixture at or below the active override limit, on the same override
  daemon, must SUCCEED** (200 + a valid, loadable zip) — round 2's open-question ruling on fixture
  scale: "`2/100` is sufficient and cheap. The missing requirement is same-daemon at/below-limit
  positive controls plus exact 4xx/code assertions, not larger fixtures" — this positive control is
  what actually distinguishes correct guard discrimination from a daemon that is simply broken or
  always-rejecting under the override env vars.
- Response content shape: identical to `/api/projects/:id/archive` — every project file at its
  natural relative path (dotfiles and `*.artifact.json` sidecars excluded, matching
  `collectArchiveEntries`'s existing rule). MishMash's own injected `DESIGN-HANDOFF.md`/
  `DESIGN-MANIFEST.json` sidecars (`apps/web/src/runtime/exports.ts:27-28`) are harmless here: both
  classify as Instatic's `meta` role, never a stray page or asset.

**No new contract file.** Round 1 finding #3 originally required a new
`packages/contracts/src/api/project-super-import.ts` with a bespoke `SuperImportExportErrorResponse`
shape; round 2 found this both under-leased (finding #3: not exported from `packages/contracts/src/
index.ts`, no package subpath, no esbuild entry, so "the contract cannot be consumed through the
supported package surface") and, per its own open-question ruling, wrong in kind ("reject the
bespoke envelope … reuse [`ApiErrorResponse`]"). **This wave now reuses the existing, already-fully-
public `ApiErrorResponse`/`ApiErrorCode`/`sendApiError` envelope** (`packages/contracts/src/
errors.ts`, `apps/daemon/src/http/api-errors.ts`) with its existing `PAYLOAD_TOO_LARGE` and
`CONFLICT` codes — see **Ground facts** for the full citation trail (including three real existing
call sites using this exact reuse pattern) and for why this closes round 2 finding #3 by *removing*
the thing that needed a new export path, rather than by leasing more files under
`packages/contracts/`. The daemon route and the web UI's error handling both import
`ApiErrorCode`/`ApiErrorResponse`/`sendApiError` from `@open-design/contracts` — never a divergent
locally-declared shape on either side (`AGENTS.md` Boundary constraints: "update contracts before
wiring divergent web/daemon request or response shapes"; there is nothing to update here, the
shared shape already exists). C10A-2 asserts the real response envelope and exact codes at runtime,
closing round 2 finding #3's "the verifier contains no contract/i18n existence or consumption
check" for the contract half (the i18n half is closed structurally by C10A-6/typecheck, unchanged
from round 1 — see **Ground facts**).

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
  binding structurally (AST: the click handler's own **reachably-called** body — dead/never-invoked
  nested function declarations are excluded, only the entry body, IIFEs, and callback arguments
  actually passed to another call are walked, round 2 finding #4 — calls the imported identifier,
  which may be a default, namespace, or named import, round 2 finding #4; that identifier resolves
  to an exported function in `runtime/exports.ts`; that function's own reachable body contains a
  `fetch(...)` call whose **first (URL) argument specifically** — not the call's headers or any
  other argument, round 2 finding #4 — names the `/export/super-import` route; the owning JSX
  element **including its children** (round 2 finding #4: the prior check inspected only the
  opening tag and so missed the repository's natural `<button onClick={...}><span>{t(...)}</span>
  </button>` child-span pattern) has attributes or text mentioning "Instatic" or "Super Import").
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
  code path fires correctly at a cheap, deterministic scale; see **Adversarial review** round-1
  finding #5 and round-2's fixture-scale ruling (both disposed in **Adversarial review**).

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
    "apps/daemon/tests/project-super-import-*.test.ts",
    "apps/daemon/tests/mcp-templates-instatic.test.ts",
    "apps/web/tests/mcpTemplateRow-*.test.ts",
    "scripts/waves/capability-manifest.json"
  ],
  "deny": [
    "apps/web/src/providers/registry.ts",
    "packages/contracts/**",
    "scripts/waves/verify-w10a.ts",
    "docs/plans/waves/W10a-instatic-seam.md",
    "docs/plans/waves/leases.json",
    "docs/plans/waves/DECISIONS.md",
    "docs/security/**"
  ],
  "note": "Round-1 fix: scripts/waves/verify-w10a.ts and this PRD are REMOVED from allow and explicitly denied -- the house rule is that a wave's own PRD/verifier are baseline inputs after freeze, never implementation-lease files (see the PRD's 'Implementation ceremony' section for what landing actually runs). apps/daemon/src/routes/project-super-import.ts is a NEW dedicated route file (house pattern: one module per route concern, matching routes/library.ts, routes/covers*.ts). registry.ts stays denied -- ruling confirmed DesignFilesPanel.tsx already performs a direct archive-shaped fetch (handleBatchDownload) and the REUSABLE full-project downloader precedent (downloadProjectArchive) lives in runtime/exports.ts, not registry.ts; this wave's new export helper follows that exact precedent. McpClientSection.tsx is leased narrowly for the import-swap onto the new mcpTemplateRow.ts module (its own local rowFromTemplate/authModeAfterUrlChange/inferMcpAuthMode/effectiveMcpAuthMode functions move out, the component imports them). Round-3 fix: packages/contracts/src/api/project-super-import.ts is REMOVED from allow -- round 2's open-question ruling on contract shape rejected the bespoke envelope this file would have held ('reuse [ApiErrorResponse] ... adding properly leased domain codes/details only if necessary'), and direct research found new codes are not necessary (packages/contracts/src/errors.ts's existing PAYLOAD_TOO_LARGE/CONFLICT codes suffice). packages/contracts/** is now explicitly DENIED, not merely absent from allow: this wave adds zero new files there and needs zero changes to src/index.ts, package.json, or esbuild.config.mjs (see the PRD's Ground facts contract-file citation trail) -- an explicit deny closes round 2 finding #3's 'cannot be consumed through the supported package surface' gap by removing the need for any export-path change, and blocks a future implementation from quietly reopening it by adding a bespoke contract file after all. The two i18n files remain leased per AGENTS.md's three-step-closure rule. server.ts is leased narrowly for the one new route-registration call site only."
}
```

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-w10a.ts`,
runnable now via `pnpm exec tsx scripts/waves/verify-w10a.ts` for authoring-time dry runs — **landing
requires the orchestrator-custody copy per "Implementation ceremony," never this working-tree file.**

| ID | Criterion | Verification |
|---|---|---|
| C10A-1 | Instatic MCP template registered, real-transport shape, deep-spread-safe, satellite-mutation-safe, production-bound, URL-edit-sticky, count re-derived | Isolated daemon boot, URL validated (protected-port check, see shared isolation note below) before any request; `GET /api/mcp/servers`; exactly one `templates[]` entry identifiable as Instatic; `category==='publishing'` exactly; `transport==='http'`; `url==='http://localhost:3000/_instatic/mcp'` exactly; `authMode==='none'`; `headerFields` entry `key==='Authorization'` whose placeholder/label matches `/bearer\s+imcp_pat_/i` exactly; **AST-located as its own `MCP_TEMPLATES` array element** (not any object literal anywhere), rejected outright if that element is call-wrapped (`Object.assign(...)`/factory) rather than a direct object literal, recursively scanned for **zero** `SpreadAssignment`/`SpreadElement` nodes at any depth, plus a whole-file scan for any assignment expression mutating `MCP_TEMPLATES` post-declaration (satellite mutation); **runtime count re-derivation**: AST-diffs the `MCP_TEMPLATES` id set at `baseCommit` against the live HTTP id set at HEAD, asserting every base id survives and exactly one new id was added, matching the Instatic candidate (never a hardcoded number); **functional** check that dynamically imports `apps/web/src/state/mcpTemplateRow.ts` and calls its real `rowFromTemplate`/`authModeAfterUrlChange` — asserts `authMode==='none'` immediately after template selection AND stays `'none'` after simulating a URL edit to a non-loopback host, and that no header text leaks the placeholder token verbatim; **production-binding check**: parses `McpClientSection.tsx` and asserts it imports both functions from `state/mcpTemplateRow` and no longer declares its own same-named local functions |
| C10A-2 | Super Import export matches Instatic's real ingestion contract, provably, at runtime, with exact-status/code rejection and positive controls | Real HTTP `GET /api/projects/:id/export/super-import` against a fixture project covering **every** `classifyFiles.ts` role (html, css, js, font, image, ordinary meta/json, binary) at natural relative paths, byte-identical (sha256) to fixture, no `pages/`/`tokens`/`media/` prefix; `index.html.artifact.json` sidecar absent (negative control); a **separate** fixture project containing a file at the exact path `.instatic/site-bundle.json` is rejected with **exactly HTTP 409** and `error.code === 'CONFLICT'` (parsed from the real, reused `ApiErrorResponse` body — a 500 or any other status/code fails the criterion, never counts as "rejected"); **two additional isolated daemon boots**, each with one size guard overridden via `SUPER_IMPORT_MAX_FILES_OVERRIDE=2` / `SUPER_IMPORT_MAX_BYTES_OVERRIDE=100`: an over-limit fixture on each asserts **exactly HTTP 413** and `error.code === 'PAYLOAD_TOO_LARGE'`; an **at/below-limit fixture on the same daemon must additionally SUCCEED** (200 + a valid, loadable zip) — the positive control that distinguishes correct guard discrimination from a broken/always-rejecting override daemon; source-level check that the route's default fallbacks contain a genuine **AST `NumericLiteral`** (or `1024*1024*1024`-shaped multiplication chain) equal to Instatic's real `10_000`/`1073741824` — immune to a comment or dead assignment, which have no AST node — and that both override env var names are referenced |
| C10A-3 | CLI parity, real subprocess, no `--root` | `od project export-super-import <fixtureId> --daemon-url <validated-isolated-url> --out <tmp> --json`, real child process, `OD_DAEMON_URL` also set, never falling through to `127.0.0.1:7456`; exit 0; saved file sha256-identical to C10A-2's HTTP response body for the same fixture. This byte-identity-against-a-random-fixture-id requirement is also the criterion's transitive proof the CLI honored its explicit daemon-url flags rather than any fallback — see **Ground facts**' CLI-subprocess bullet for why this is deliberately not independently re-probed with new detection machinery |
| C10A-4 | Super Import UI entry point — structural AST binding, comment-safe, decoy-safe, dead-code-safe, URL-argument-scoped | Parses `DesignFilesPanel.tsx`; finds an `onClick`/`onSelect`/`onPress` JSX attribute whose resolved handler body (inline arrow or a same-file named function/const it points to) **reachably** calls an identifier imported (named, default, or namespace) from a `runtime/exports` module specifier — a nested function declaration that is never invoked and never passed as a callback argument is excluded from the walk, so a dead decoy hiding the real call no longer passes; resolves that identifier to an **exported** function in `runtime/exports.ts` and requires a reachable `fetch(...)` call whose **first argument** (the URL, not headers or any other argument) names `/export/super-import`; requires the owning JSX element **including its children** (not just its opening tag) to have attributes or text mentioning "Instatic" or "Super Import." All matching is via TypeScript AST node text (`getText()`), which excludes comments/trivia by construction — no line-proximity heuristic, no naive `//`-split |
| C10A-5 | No deeper coupling (founder-pin scope fence) — AST added-OCCURRENCE (multiset) diff, alias-resolved, redirect-safe | For every changed product `.ts`/`.tsx` file (excluding `scripts/waves/**`, `docs/**`), parses BOTH `git show <baseCommit>:<file>` and the HEAD version, re-prints every call/new-expression and import declaration through the TypeScript AST printer for a formatting-insensitive canonical form (a multi-line reflow of an unchanged call prints identically to its single-line original; a genuinely different call, including one differing only in a string-literal argument, prints differently), then diffs **occurrence counts** (multiset, not a Set) of that canonical text between base and head — so a call newly duplicated or moved is visible as an added occurrence, while pure reformatting never registers as one; classifies each added occurrence by AST shape (identifier/property-access name, resolved through an **import-alias map** covering default/namespace/named-with-rename bindings, not raw text) against `fetch`/`axios`/`http(s).request`/`net.connect`/`net.createConnection`/`undici.request`/`undici.fetch`/`new WebSocket`/`writeMcpConfig`(including any alias)/any `child_process` exec-family call whose arguments mention curl/wget/nc/**dynamic `import(...)`/`require(...)`** (unconditionally forbidden when newly added — no leased file needs either); flags any newly-added import occurrence of `axios`/`undici`/`net`/`node:net`/`http`/`node:http`/`https`/`node:https`/`child_process`/`ws`/`got`/`node-fetch`/`superagent`/`ky`/etc.; a newly-added `fetch(...)` occurrence is allowed **only** in `apps/web/src/runtime/exports.ts` or `apps/daemon/src/cli.ts`, and only when its own first-argument text names `/export/super-import` and never names `instatic` directly. **Disclosed residual limitation** (not solved, not hidden): arbitrary local-variable aliasing of a raw egress primitive (e.g. `const f = fetch; f(...)`, indirection through a locally-defined wrapper function) is out of proportion for this wave's verifier and is not detected — see **Adversarial review** round 3 disposition and the closing note below the table |
| C10A-6 | Gates | `pnpm guard` and `pnpm typecheck` both exit 0 on the current tree — this also mechanically forces `capability-manifest.json`'s `project` row to list the new route, and fails closed if either i18n key is missing while imported/referenced. No `packages/contracts` gate is needed for this criterion: this wave adds no new file there (see **Ground facts**) |

Plus the three named infra checks (house pattern, `verify-w9-ingest.ts` precedent):
**GATE-INTEGRITY** (self-hash pin; see **Implementation ceremony** — `false` is legal for advisory
dry-runs only, never for a landing decision), **LEASE** (`git diff --name-only <baseCommit>...HEAD`
⊆ `leases.json@baseCommit`'s `W10a-instatic.allow`, read via `git show`, never the working tree —
**expected to fail honestly until this PRD lands on `main` and the lease row above is actually
added**), **HEAD-DRIFT** (HEAD must not move mid-run).

**Shared isolation note (round 1 finding #7 + round 2 finding #7, applies to every criterion above
that touches a daemon):** every daemon URL this verifier uses — the main fixture daemon plus the two
size-guard override daemons — is parsed and validated (`http:` scheme, exact `127.0.0.1` host, a
valid nonzero port, explicitly excluding 7456 and 51012) immediately after boot, before any request
or CLI spawn is issued against it. A validation failure is treated exactly like a boot failure: the
daemon is killed immediately and every criterion depending on it fails closed with the validation
reason recorded, never a silent fallback to a default port. **Round 3 addition (round 2 finding #7's
residual):** every subsequent probe `fetch` the verifier issues against any daemon sets
`redirect: 'manual'` and hard-fails on any redirect-shaped response (a 3xx with a `Location` header,
or an opaque redirect) — a validated loopback route can no longer silently steer a request to a
protected port or an external host mid-flight. The CLI-subprocess half of this same finding is
closed by C10A-3's transitive byte-identity proof, documented in **Ground facts**' CLI-subprocess
bullet, deliberately without new fallback-provocation machinery (touching the actual fallback path
would risk reaching a protected daemon if the bug were real).

## Verified baseline (this run, pre-implementation, post round-3 fixes)

Captured by actually running `pnpm exec tsx scripts/waves/verify-w10a.ts` against this branch
before any product code exists (an authoring-time dry run — `gateIntegrityPinned: false` is expected
and legal here per **Implementation ceremony**; this run is never landing evidence).
`pnpm exec tsc -p scripts/tsconfig.json --noEmit` passes clean. `4/9` pass, exit code 1, confirmed
via direct (non-teed) redirection:

- **C10A-1 — fail, 4 problems**, each now a real, specific reason rather than the round-1/2 shape:
  no `MCP_TEMPLATES` entry identifiable as Instatic; the runtime count re-derivation independently
  reports 0 newly-added ids vs `baseCommit` (expected exactly 1) and a HEAD count of 39, not
  `baseCommit`'s 39 + 1 — proving the re-derivation genuinely runs, not merely a hardcoded "39" in a
  comment (closing round 2 finding #8's "its only `39` is a comment"); `apps/web/src/state/
  mcpTemplateRow.ts` does not exist.
- **C10A-2 — fail, 7 problems**: the export route itself 400s (not yet implemented); the poison-file
  probe gets HTTP 400 where the criterion now demands **exactly** 409 (proving the exact-status
  assertion is live, not a blanket `!ok` check); both size-guard over-limit probes get HTTP 400
  where exactly 413 is required; **both new at/below-limit positive controls independently fail**
  (HTTP 400 instead of a 2xx zip) — proving those controls actually execute and are not vacuously
  satisfied; the route file does not exist to check its size-guard AST numeric literals.
- **C10A-3 — fail**: HTTP baseline unavailable (400) — cannot assess CLI parity before the route
  exists.
- **C10A-4 — fail, 2 problems**: `DesignFilesPanel.tsx` imports nothing (named, default, or
  namespace) from a `runtime/exports` module specifier; no `onClick`/`onSelect`/`onPress` handler
  reachably calls such an import.
- **LEASE — fail**: no `"W10a-instatic"` entry in `leases.json@baseCommit` — expected until this PRD
  lands on `main`.
- **C10A-5, C10A-6, GATE-INTEGRITY, HEAD-DRIFT — pass.** C10A-5's pass is a **legitimate, disclosed
  vacuous pass** (zero product `.ts`/`.tsx` files touched yet, so the added-occurrence multiset diff
  finds nothing to classify) — not a loophole; C10A-1..C10A-4 independently carry the burden of
  proving the features exist. `pnpm guard`/`pnpm typecheck` (C10A-6) pass today since this PRD and
  its verifier are the only new files and both are within repo conventions — this run's own C10A-6
  evidence is a real, full-repo pass, not merely assumed.

Beyond the end-to-end run, this round's AST-logic changes (multiset diff via the TypeScript printer,
import-alias resolution, `findEnclosingJsxElement`'s full-element fix, dead-nested-decoy exclusion,
AST `NumericLiteral` detection, deep-spread detection, satellite-mutation detection, `Object.assign`-
wrapped-element rejection) were additionally exercised against 14 hand-built synthetic fixtures in a
standalone scratch harness (not part of either deliverable file, discarded after use) before this
baseline run — every one passed, including the specific case round 2's literal probe cited (a
multi-line-reflowed call must diff to zero added occurrences against its single-line original; a
call whose only difference is a distinct string-literal argument must still be detected as newly
added). Manifest carries all 9 required criterion IDs exactly; no leftover boot-script process or
`OD_DATA_DIR` temp directory after teardown; ports 7456/51012 (pids 16481/16729) confirmed listening
and untouched, both before and after every run in this round.

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

**Round 2 — GPT-5.6 Sol (Codex) — REJECT.** Re-reviewed the round-1 fixes against
`c8c8ca4a4b9cc851993455d92becad34b3ab20a9` (parent `cec9c45c7c5c4cf6b16ca08fa3662da39f8f2efc`),
confirmed the Instatic citations, `pnpm typecheck`/direct `tsc`/direct `guard.ts` invocation, and
worktree/`leases.json` integrity, but explicitly did not run the verifier or contact either
protected daemon port. Verdict quoted verbatim: "the freeze gate remains bypassable and
repository-inconsistent, principally because C10A-2 accepts 500s as rejection, C10A-4/C10A-5 admit
decoys and indirect egress, production MCP stickiness is unbound, and the required contract lacks a
leased public export path." Per-finding fidelity rulings and this round's disposition:

1. **Finding 1 — NOT FIXED.** "C10A-5 now uses ASTs, but its `Set<string>` comparison is not an
   occurrence diff: adding a second identical forbidden call or moving an existing call is
   invisible, while formatting-only changes create a false 'addition.' … Dynamic
   `import('node:net')`, `require('node:https')`, aliased primitives, local wrappers, and
   template-built specifiers evade `ImportDeclaration` collection and callee-name classification."
   **Fixed:** the Set replaced with an **occurrence-count (multiset) diff** over TypeScript-printer
   canonical text (`canonicalNodeText`, `verify-w10a.ts:432`; `occurrenceCounts`/
   `addedOccurrenceCounts`, `:561`/`:572`) — formatting-insensitive by construction (verified: a
   multi-line reflow of an unchanged call prints identical canonical text to its single-line
   original) while still treating a duplicated/moved call as a genuine new occurrence, and still
   distinguishing two calls whose only difference is a string-literal argument. Dynamic
   `import(...)` is detected via the public AST shape (a `CallExpression` whose callee has kind
   `ImportKeyword` — `ts.isImportCall` exists at runtime but is not part of the public
   `typescript.d.ts` surface, confirmed by direct inspection) and `require(...)` by identifier name,
   both unconditionally forbidden when newly added (`classifyForbiddenCallNode`, `:496`). An
   **import-alias map** (`buildImportAliasMap`, `:450`) resolves default/namespace/named-with-rename
   bindings so an aliased `writeMcpConfig` import, or an aliased `node:http`/`node:https` import, is
   still caught; `node:http`/`http`/`node:https`/`https`/`node:net`/`net` joined
   `SUSPICIOUS_IMPORT_MODULES` (`:483`) since no leased file in this wave needs raw Node HTTP/net
   primitives. **Disclosed, not solved:** arbitrary local-variable aliasing of a raw primitive
   (`const f = fetch; f(...)`) or an indirection through a locally-defined wrapper function remains
   undetected — documented openly in the C10A-5 criteria-table row and here rather than claimed as
   closed.
2. **Finding 2 — FIXED (round 2 confirmed, unchanged this round).** No round-3 action needed —
   **Implementation ceremony** and the lease `deny` list are unchanged from round 1.
3. **Finding 3 — FIXED-WITH-DEFECT → FIXED differently.** "The contract cannot be consumed through
   the supported package surface without also exporting it from `packages/contracts/src/index.ts`
   or adding a package subpath; neither … is leased. … typecheck does not force a missing file to
   exist … The verifier contains no contract/i18n existence or consumption check." **Fixed by
   removal, not by leasing more files:** the bespoke `packages/contracts/src/api/project-super-
   import.ts` this finding's export-path gap was about no longer exists in this design at all (see
   round 2's own contract-shape ruling, disposed below) — S10A-2 now reuses the already-fully-public
   `ApiErrorResponse`/`ApiErrorCode` (barrel-exported, `packages/contracts/src/index.ts:2`), so there
   is no new export path to leave unleased. `packages/contracts/**` is now explicitly **denied**
   (**Proposed lease row**), foreclosing a future implementation from quietly reopening the gap by
   adding a bespoke file after all. C10A-2 now asserts the real response envelope and exact
   `error.code` at runtime (`assertApiErrorCode`, `verify-w10a.ts:1905`), closing "the verifier
   contains no contract … consumption check" directly — the i18n half was never in question (C10A-6/
   typecheck fails closed on it, unchanged since round 1).
4. **Finding 4 — NOT FIXED.** "`findEnclosingJsxElement` returns the opening element, so it does not
   traverse ordinary button children such as `<span>{t('designFiles.exportSuperImport')}</span>`…
   Aliased/default imports are not correctly resolved. … both handler and export scans descend into
   unused nested functions, and the route needle may occur anywhere in `fetch(...)`, not necessarily
   its URL argument. … Dead decoys and `fetch(realRemoteUrl, {headers:{x:'/export/super-
   import'}})` pass." **Fixed:** `findEnclosingJsxElement` (`verify-w10a.ts:736`) now returns the
   full `JsxElement` (opening tag's parent when it is a `JsxElement`, including children) instead of
   the bare opening element — verified live against exactly the cited `<button onClick={...}>
   <span>{t(...)}</span></button>` shape. `collectRuntimeExportsImports` now captures default and
   namespace bindings alongside named imports. `isReachableNestedFunction` (`:783`) excludes any
   nested function declaration that is neither an IIFE nor a callback argument actually passed to
   another call from both the handler-body walk and the exported-function-body walk, so a dead
   decoy no longer counts. `findFetchUrlArgContaining` (`:821`) inspects only the call's **first
   argument** for the route needle, so a route string hidden in a `headers` object (or any other
   non-URL argument) no longer passes.
5. **Finding 5 — NOT FIXED.** "Every rejection check merely tests `response.ok`; HTTP 500 and other
   non-4xx failures pass as successful rejection. … neither override daemon gets a below-limit
   success control. … the supposedly comment/dead-code-safe default check is still a raw regex over
   source, so a comment or unused assignment passes. This violates `VERIFICATION-CONTRACT` R4."
   **Fixed:** every rejection check now asserts the **exact** status (409 for the poison file, 413
   for both size guards — `verify-w10a.ts:1411`/`:1424`) and parses the body to assert the exact
   `error.code` (`CONFLICT`/`PAYLOAD_TOO_LARGE`) via `assertApiErrorCode` (`:1905`) — a 500 or any
   other status/code now fails the criterion outright. Both override daemons now additionally get an
   **at/below-limit fixture that must SUCCEED** (200 + a loadable zip), per round 2's own
   fixture-scale ruling (disposed below). The default-constant check is now a genuine **AST
   `NumericLiteral`/multiplication-chain scan** (`astContainsNumericLiteral`, `:664`) — a comment can
   never contain a `NumericLiteral` AST node, closing the regex gap structurally rather than by a
   smarter regex.
6. **Finding 6 — NOT FIXED.** "C10A-1 exercises a new module without proving `McpClientSection.tsx`
   imports or uses it; an unused passing module alongside the unchanged buggy component goes green.
   The spread ban checks only the first matching object's direct properties, not nested spreads,
   `Object.assign`, satellite mutation, or a decoy object with the same ID." **Fixed:** a new
   production-binding check (`verify-w10a.ts:1317`) parses `McpClientSection.tsx` and asserts it
   imports both `rowFromTemplate` and `authModeAfterUrlChange` from `state/mcpTemplateRow`
   (`fileImportsFrom`, `:871`) and no longer declares its own same-named locals
   (`fileDeclaresLocalFunction`, `:889`). The spread ban is rebuilt end to end: the Instatic entry is
   located as its own `MCP_TEMPLATES` array element (`findMcpTemplatesArrayElements`, `:597`;
   `findTemplateElementById`, `:617` — rejects a call-wrapped element such as `Object.assign(...)`
   outright as `wrappedInCall`), its whole subtree is recursively scanned for a spread at any depth
   (`objectLiteralHasSpreadDeep`, `:584`), and the whole file is separately scanned for a satellite
   mutation assigning into `MCP_TEMPLATES` post-declaration (`findMcpTemplatesSatelliteMutations`,
   `:646`).
7. **Finding 7 — FIXED-WITH-DEFECT.** "All subsequent `fetch` calls use default redirect-following,
   so a validated loopback route can redirect to either protected port or an external host. The
   spawned CLI is likewise trusted to honor its URL flags rather than falling back." **Fixed (fetch
   half):** every probe fetch now goes through `probeFetch` (`verify-w10a.ts:944`), which sets
   `redirect: 'manual'` and throws `RedirectRefusedError` (`:940`) on any redirect-shaped response.
   **Documented, not independently re-probed (CLI half):** see **Ground facts**' CLI-subprocess
   bullet — C10A-3's byte-identity-against-a-random-fixture-id requirement is the transitive proof
   used instead of new fallback-provocation machinery, to avoid deliberately trying to reach the
   protected daemon.
8. **Finding 8 — FIXED-WITH-DEFECT.** "Independent AST counting confirms exactly 39 current
   templates … All textual '25' claims are gone. However, the PRD says the verifier re-derives the
   count at runtime; it does not — its only `39` is a comment. It also never proves exactly one new
   template was added rather than deleting/replacing existing entries." **Fixed:** C10A-1 now
   AST-parses `mcp-config.ts` at `baseCommit`, extracts its `MCP_TEMPLATES` id set, and diffs it
   against the live HTTP id set at HEAD (`verify-w10a.ts:1283`), asserting every base id survives
   and exactly one new id was added matching the Instatic candidate — the **Verified baseline**
   section's actual pre-implementation run independently confirms this re-derivation executes (it
   reports "0 newly-added ids" and "39 is not 39+1," not a silently-passing hardcoded check). The
   PRD's own restated `39` in **Ground facts** is now explicitly labeled "re-derived programmatically
   … not trusting either number," not the sole source of truth.

**Open-question rulings (round 2, applied verbatim):**
- **Stickiness:** "freeze behavior, not `_authModeExplicit` or another private mechanism. Requiring
  the exact `mcpTemplateRow.ts` extraction is over-prescriptive; if retained, the verifier must
  prove the production component imports and uses it." **Disposition:** retained the module (Option
  A) with the new production-binding check — see S10A-1's "Design choice" paragraph for the
  explicit A-vs-B reasoning this ruling required.
- **Contract shape:** "reject the bespoke envelope. The repository already has `ApiErrorResponse`,
  `ApiErrorCode`, `details`, and `sendApiError`. Reuse that envelope, adding properly leased domain
  codes/details only if necessary." **Disposition:** reused verbatim; researched whether new codes
  were necessary and found they are not (`PAYLOAD_TOO_LARGE`/`CONFLICT` already fit both cases) — see
  **Ground facts**' contract-file citation trail.
- **`registry.ts`:** "keep denied. Future collision is handled by explicit lease amendment and
  serialization; it is not grounds for a speculative widen." **Disposition:** unchanged, no action
  needed — the former open question #3 asking round 2 to weigh in on this is resolved by this
  ruling and is not re-asked.
- **Fixture scale:** "`2/100` is sufficient and cheap. The missing requirement is same-daemon
  at/below-limit positive controls plus exact 4xx/code assertions, not larger fixtures."
  **Disposition:** `2`/`100` unchanged; added the positive controls and exact assertions — see
  finding 5's disposition above. The former open question #4 asking round 2 to weigh in on fixture
  scale is resolved by this ruling and is not re-asked.

**Round 3 close-out note.** Founder-authorized round 3 (2026-07-28) is scoped strictly to these
eight findings and four rulings, and is explicitly the **final** fix round — the coordinator's own
framing: "one confirmation review after delivery, then freeze or park." Accordingly this document
does not pose a fresh "open questions for round 4" list; the one disclosed, intentionally-unsolved
residual (C10A-5's arbitrary local-variable-aliasing gap, finding 1's disposition above) is carried
forward as a documented limitation for the confirmation reviewer to weigh, not a question awaiting a
further fix round.
