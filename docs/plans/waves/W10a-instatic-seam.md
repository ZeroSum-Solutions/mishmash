# Wave 10a — Instatic seam (MCP registration + Super Import export)

**Slug:** `mishmash-w10a-instatic`
**Gates on:** founder ruling only (NM-24, resolved 2026-07-27 — no wave-code dependency; may run
independently of W1/W3/W4/W6a/W8).
**Loop:** `loop:red-green-review` (`VERIFICATION-CONTRACT.md` §6).
**Verifier:** `scripts/waves/verify-w10a.ts`
**Write lease:** proposed below — **not yet applied to `docs/plans/waves/leases.json`**; this PRD
does not edit that file per its authoring mandate.
**Status: DRAFT.** Written under the NM-41C expansion gate (`W5-W11-gated.md` lines 8–24): frozen
only after an independent reviewer who will not implement it returns a machine-readable `APPROVE`
(`VERIFICATION-CONTRACT.md` §6, `loop:red-green-review`). No implementation work may start from
this text before that review lands. This document is an **expansion**, not an implementation —
zero product code accompanies it; every criterion below currently fails, honestly, by design (see
**Verified baseline**).

---

## Founder-pinned scope (binding, quoted verbatim)

> seam = MCP + Super Import only; W10a pinned to that seam; deeper coupling needs separate evidence

Source: `docs/plans/waves/NM-REGISTER.md`, NM-24 row — "**Resolved 2026-07-27**". The same ruling
is echoed in `docs/plans/waves/GLOBAL-GOAL.md:124` and `docs/plans/2026-07-26-mishmash-completion-
assessment.md:12` ("Founder-delegated to GPT-5.6 Sol; verdict adopted per founder instruction").

This PRD's scope is **exactly** the two halves that quote names — an MCP client registration, and
a static export shaped for Instatic's own "Super Import" feature — and nothing past them. See
**Explicitly out of scope** for what that excludes.

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

**Correction (this revision):** the "static zip → pages/tokens/media" phrase quoted above is an
executive-summary gloss from the assessment, not a read of Instatic's own docs — the assessment
itself only claims Instatic was "cloned and evaluated," not that its Super Import wire format was
inspected. This revision reads the actual Instatic checkout (read-only, at
`~/projects/tools/third-party/instatic`) and corrects S10A-1/S10A-2 below to match; see **Ground
facts** for the citations and **Open questions** items 1–2 for what remains genuinely open.

## Ground facts (verified directly in this tree)

- **MCP client registration is a data problem, not a new subsystem.** `apps/daemon/src/mcp-
  config.ts` defines `McpServerConfig` (a user's live, persisted connection) and a separate,
  read-only `MCP_TEMPLATES: McpTemplate[]` array (`mcp-config.ts:567+`) — curated presets the
  Settings → MCP "Add server" picker renders. 25 templates exist today across 8 categories
  (`image-generation`(8), `image-editing`(5), `web-capture`(3), `design-systems`(5), `ui-
  components`(3), `data-viz`(4), **`publishing`(7)**, `utilities`(4)). `publishing` already holds
  the closest neighbors: `edgeone-pages` (stdio, `npx -y edgeone-pages-mcp@latest`), `pagedrop`
  (stdio, `npx -y pagedrop-mcp`), `pdfspark` (stdio, `npx -y pdfspark-api`) — all "hand a static
  artifact to a hosted service" tools, the same shape as an Instatic tether. `McpTemplateCategory`
  is defined identically in `packages/contracts/src/api/mcp.ts` and mirrored in `mcp-config.ts`
  (file header: "Both sides MUST stay in sync") — `publishing` already exists on both sides, so
  reusing it needs **zero** contract change.
- **The template list is served live, not baked into the UI.** `apps/daemon/src/mcp-
  routes.ts:150-163`: `GET /api/mcp/servers` (gated by `isLocalSameOrigin`) returns `{ servers:
  cfg.servers, templates: MCP_TEMPLATES }` straight from the constant. `apps/web/src/components/
  McpClientSection.tsx` renders whatever it receives generically — adding one array entry to `MCP_
  TEMPLATES` is sufficient for the entry to appear in the picker with no web-side code change.
  **Adding a template never touches a user's live `mcp-config.json`** — `McpTemplateConfig` and
  `McpServerConfig` are different arrays; picking a template only pre-fills a form the user still
  saves explicitly. This is why NM-25's ruling ("register the MCP and stop") and this wave's MCP
  half are legitimately this small.
- **There is no CLI surface for managing external MCP client entries today**, template or custom
  (`grep -n "api/mcp/servers" apps/daemon/src/cli.ts` → zero hits). `od mcp` and `od mcp install
  <agent>` are a **different direction** — MishMash's own daemon acting as an MCP *server* for
  other agents (`apps/daemon/src/mcp.ts`, 1861 lines) — not the client-registration surface this
  wave touches. This is a pre-existing, wave-wide gap across all 25 current templates, not
  something introduced by or specific to an Instatic row; this PRD does not attempt to close it
  (see **Out of scope**).
- **"MishMash produces a static site" already has a real precedent to extend, not invent.**
  `GET /api/projects/:id/archive` (`apps/daemon/src/import-export-routes.ts:858-892`, backed by
  `buildProjectArchive` in `apps/daemon/src/projects.ts:307-368`) already zips a project's on-disk
  tree via `JSZip` (an existing direct dependency of `apps/daemon/package.json`, `jszip@3.10.1` —
  no new dependency needed anywhere in this wave). It already classifies project files through
  `projectFileMap()` (`projects.ts:541-555`) into `htmlFiles` (`/\.html?$/i`), `cssFiles`
  (`/\.css$/i`), `jsFiles` (`/\.[cm]?[jt]sx?$/i`), and `assetFiles` (everything else), and already
  injects a generated manifest into the zip (`buildDesignManifest`, schema `open-design.design-
  manifest.v1`) describing `entryFile` and per-screen roles. `collectArchiveEntries` already
  excludes dotfiles and `*.artifact.json` sidecars from any project archive. A CLI sibling already
  exists for the base case: `od project archive <id> [--root <dir>] [--out <path>] [--json]`
  (`cli.ts:6043` usage string, `case 'archive'` at `cli.ts:6200`), which does nothing more than
  `fetch()` the same HTTP route and save the response — proving CLI/HTTP parity for a zip export is
  a thin, already-proven pattern here, not new machinery.
- **Instatic's real Super Import contract, read from source (`~/projects/tools/third-party/
  instatic`, read-only).** Per `docs/features/site-import.md`: "Super Import" is `src/core/
  siteImport/` — the module's own barrel doc-comment points there (`src/core/siteImport/index.ts:9`,
  `@see docs/features/site-import.md`). It is triggered whenever a dropped ZIP is **not** an
  Instatic-native "site-transfer" archive (`.instatic/site-bundle.json` as first entry — a
  *different* feature, `docs/features/site-transfer.md`, MishMash does not need to produce):
  "A single ZIP is classified before analysis: an Instatic transfer archive has
  `.instatic/site-bundle.json` as its first stored entry and routes to the CMS bundle review path;
  **any other ZIP is treated as a static-site import** and normalized through `ingestInput` to
  `FileMap`" (`site-import.md:302`). **There is no `pages/`/`tokens/`/`media/` folder convention and
  no manifest file Instatic reads** — the earlier gloss-based design below was wrong on this point.
  The real contract, per `src/core/siteImport/ingestInput.ts` and `classifyFiles.ts`:
  - Input is a flat, relative-path tree (loose files, a folder, or a `.zip` — `ingestInput.ts:47-51`
    `IngestInput` union); at most ONE shared top-level wrapper folder is auto-detected and stripped
    if every path shares it (`detectSharedTopLevel`/`stripTopLevelFolder`, `ingestInput.ts:107-132`)
    — no wrapper at all is equally fine.
  - Every file is classified by extension, MIME as fallback: `html`/`htm`→**html** (pages),
    `css`→**css**, `js`/`mjs`/`cjs`→**js**, `png`/`jpg`/`jpeg`/`webp`/`avif`/`svg`/`gif`/`ico`→
    **image**, `woff`/`woff2`/`ttf`/`otf`/`eot`→**font**, **`txt`/`md`/`json`→`meta`** ("informational
    — not imported"), everything else→**binary** ("uploaded as raw media assets")
    (`classifyFiles.ts:9-16,25-54`).
  - **Design tokens are never read from a file.** Color/font tokens are auto-extracted from CSS
    custom properties on `:root`/`html`/`body` selectors inside the site's own linked/`@import`ed
    CSS (`extractRootColorTokens`/`extractRootFontTokens`; `site-import.md`'s "Color tokens"/"Font
    tokens" table rows). A `design-tokens.json` file would classify as `meta` and be **silently
    ignored**, not parsed — the original S10A-2 design below assumed the opposite and was wrong.
  - Pages: every `.html` file becomes a page; slug derives from its relative path
    (`documentation/index.html` → `documentation`; root `index.html` → homepage slug `index`) —
    `site-import.md`'s "Pages" table row.
  - Hidden paths (dot-prefixed, `__MACOSX`, `Thumbs.db`) are silently dropped; a path containing
    `..`, a leading `/`, or a Windows drive letter throws `PathTraversalError`
    (`ingestInput.ts:75-97`).
  - **Real, cited size guards** (`ingestInput.ts:39-41`): `DEFAULT_MAX_BYTES = 1024*1024*1024`
    (1 GB compressed) → `OversizeImportError`; `DEFAULT_MAX_FILES = 10_000` → `TooManyFilesError`;
    `DEFAULT_MAX_ZIP_UNCOMPRESSED = 5*1024*1024*1024` (5 GB uncompressed, zip-bomb guard) →
    `ZipBombError`.

  This supersedes S10A-2's folder-restructuring design; see the corrected version below.
- **Instatic ships a real MCP server — confirmed, not assumed.** `CLAUDE.md` (Instatic repo) states
  directly: "**MCP server:** Instatic exposes its CMS tools to external MCP clients (Claude Code,
  Codex, remote agents) at `/_instatic/mcp`, authenticated by per-connector bearer tokens." Full wire
  contract, `docs/features/mcp-connectors.md`: transport is **Streamable HTTP** (the doc's own
  architecture diagram: `"MCP client │ Streamable HTTP + OAuth/PAT bearer"`), endpoint always
  `https://<your-host>/_instatic/mcp` (lines 20-24), two auth modes — hosted OAuth (S256 PKCE,
  requires a public HTTPS deployment: "Hosted clients... cannot reach `localhost`, a private LAN
  address, or an HTTP-only deployment") and **personal access token**, the mode the doc itself
  demonstrates for a CLI-shaped client:
  ```sh
  claude mcp add instatic --transport http http://localhost:3000/_instatic/mcp \
    --header "Authorization: Bearer imcp_pat_…"
  ```
  (`docs/features/mcp-connectors.md:81-86`, "Claude Code example"). This is the evidence S10A-1
  pins below: `transport: 'http'`, endpoint suffix `/_instatic/mcp`, a required `Authorization`
  header carrying an `imcp_pat_…` token — not MishMash's generic OAuth automation, since hosted
  OAuth assumes public HTTPS MishMash cannot assume for a local companion service, and confirming
  wire-compatibility with Instatic's *specific* RFC 9728 + dynamic-registration flow is exactly the
  kind of deeper-coupling evidence this wave's founder pin excludes (see **Open questions**).
- **`pnpm guard` already enforces CLI\<->route parity generically.** `scripts/guard.ts` reads
  `scripts/waves/capability-manifest.json` (54.9 KB, already exists — W0/W1/W4 have landed in this
  tree) and asserts every `SUBCOMMAND_MAP` capability in `cli.ts` has exactly one manifest row, and
  every `/api/` route `cli.ts` reaches stays inside that row's committed `knownNamespaceRoutes`
  snapshot. `project` is an existing `SUBCOMMAND_MAP` capability with its own row (24
  `knownNamespaceRoutes` today) — adding a new `case` under the *existing* `project` dispatcher
  needs a manifest **row update**, not a new row, and `pnpm guard` fails closed if that update is
  missing. This wave's C10A-6 (`pnpm guard` passing) already leans on that mechanism; this PRD does
  not re-invent a bespoke parity prober for it.
- **CLI subprocesses must be pointed explicitly at a target daemon.** Every `od` HTTP subcommand
  resolves its base URL through a shared helper honoring, in order, `--daemon-url`, `OD_DAEMON_URL`,
  `OD_SIDECAR_IPC_PATH` discovery, then a **hard-coded default of `http://127.0.0.1:7456`**
  (`cli.ts:1059`, `:2353`, `:5199`, `:5250`). The verifier below never lets a spawned `od` process
  fall through to that default — every invocation passes `--daemon-url` **and** sets
  `OD_DAEMON_URL` to its own isolated daemon's URL, matching the isolation `verify-w9-ingest.ts`
  already establishes as house pattern (port 0, fresh `mkdtemp` `OD_DATA_DIR`, teardown by the
  child's own exact PID). This verifier never resolves, reads, or sends a request to ports 7456 or
  51012.

## Scope

**S10A-1 — Register Instatic as a selectable MCP client template.** Exactly one new entry in
`MCP_TEMPLATES` (`apps/daemon/src/mcp-config.ts`), category `publishing`, structurally valid under
the same rules every existing template already satisfies (id matches `SERVER_ID_PATTERN`
`^[a-z0-9][a-z0-9_-]{0,63}$`; non-placeholder `label`/`description`/`homepage`). Per the evidence in
**Ground facts**: `transport: 'http'`; `url` defaulting to `http://localhost:3000/_instatic/mcp`
(Instatic's own documented local example — self-hosted, so unlike every other current `http`
template this field is a *starting point* the user edits to their real deployment host, not a fixed
hosted-service endpoint; this is a genuinely new template shape for this catalog, not a copy of an
existing row); `authMode: 'none'` **explicitly set** (the personal-access-token path is a
manually-pasted header, not MishMash's `mcp-oauth.ts` OAuth automation — see **Open questions** item
2 for why hosted OAuth is deliberately not attempted); and a required `headerFields` entry
`{key: 'Authorization', ...}` whose placeholder names the real `imcp_pat_…` token prefix, mirroring
the exact pattern the existing `nanobanana` template already uses for a manually-pinned bearer
token. C10A-1 checks this shape mechanically — including that `url` ends with the real
`/_instatic/mcp` suffix and the header placeholder names the real token prefix, not just "some url"
and "some header." Selecting the template must never write to a user's live `mcp-config.json` on
its own — it only ever pre-fills a form the user saves explicitly (already true structurally, per
**Ground facts**; C10A-5 checks nothing new violates it).

**S10A-2 — Super Import–compatible static export.** Per the real contract in **Ground facts**,
Instatic's Super Import needs nothing more than a flat, relative-path static-site zip inside its own
size guards — which is structurally what `GET /api/projects/:id/archive` (`buildProjectArchive`)
already produces today. **No `pages/`/`tokens/`/`media/` restructuring** — the evidence shows
reshaping would be actively wrong, since Instatic classifies purely by extension at whatever path a
file sits. A new, dedicated, discoverable route, **`GET /api/projects/:id/export/super-import`**, is
still added — not to reshape the zip, but to:

- Give the seam an intentional, discoverable name distinct from the generic "Download as .zip"
  action (C10A-4 checks this is reachable).
- **Proactively enforce Instatic's own documented ingestion guards before the round trip.** If the
  project's file count would exceed `ingestInput.ts`'s `DEFAULT_MAX_FILES = 10_000`, or the
  archive's compressed size would exceed `DEFAULT_MAX_BYTES = 1024*1024*1024` (1 GB), the route
  returns a 4xx explaining why instead of generating a zip Instatic would reject outright — a real
  behavior difference from the base `/archive` route, which has no such guard today. C10A-2 checks
  the route's own source cites Instatic's real constants (`10_000`, `1073741824`), not invented or
  absent thresholds; the oversize *rejection path itself* is not runtime-exercised by the verifier
  (generating 10,001 real fixture files over HTTP is disproportionate to this wave) — see **Open
  questions** item 5.

Content shape: identical to `/api/projects/:id/archive` — every project file at its natural relative
path (dotfiles and `*.artifact.json` sidecars excluded, matching `collectArchiveEntries`'s existing
rule), no injected `pages/`/`tokens/`/`media/` prefix. MishMash's own injected
`DESIGN-HANDOFF.md`/`DESIGN-MANIFEST.json` sidecars (`projects.ts:39-40` — see **Ground facts**) are
harmless here: both classify as Instatic's `meta` role ("informational — not imported"), never as a
stray page or asset, so nothing needs to strip them for this route specifically.

**S10A-3 — Capability-exposure parity (repo-standing rule, not new to this wave).** Per `AGENTS.md`
"Capability exposure (UI/CLI dual-track)", the new export is a genuinely new capability and needs
all three surfaces landed together: the HTTP route above; `od project export-super-import <id>
[--out <path>] [--json]` (mirrors `od project archive`'s existing flag shape exactly, same
dispatcher, `case` added beside `'archive'`); and a UI entry point reachable from the same surface
that already exposes "Download as .zip" — the Design Files panel
(`apps/web/src/components/DesignFilesPanel.tsx`) is the natural, low-collision landing spot (see
**Proposed lease**, and the `registry.ts` warning under **Open questions**).

## Explicitly out of scope

Everything past the two seam halves the founder ruling named. Concretely, none of the following are
this wave's job, and this PRD does not design extension points for any of them:

- Any Instatic-initiated network call into MishMash, or any MishMash-initiated call *into* a live
  Instatic instance (auto-push, auto-publish, "send to Instatic" one-click deploy). The MCP
  registration is a **selectable preset**; the export route is a **local zip generation with no
  network egress**. C10A-5 checks both mechanically.
- Auto-connecting, auto-enabling, or defaulting the Instatic template into any user's live server
  list. Template selection stays an explicit, user-driven save, unchanged from every other of the
  25 existing templates.
- A live round-trip through a *running* Instatic instance's actual admin UI / Site Import wizard.
  A read-only source checkout exists at `~/projects/tools/third-party/instatic` and was read for
  the evidence above, but this wave never installs, starts, or drives a running Instatic instance
  (browser automation against someone else's admin UI is genuine deeper-coupling evidence, not a
  mechanical verifier's job) — flagged as an open question for follow-up, not fabricated as a pass.
- Instatic's Core Framework token engine, QuickJS-WASM plugin sandbox, or CMS-native site-transfer
  bundle format (`docs/features/site-transfer.md` in the Instatic repo — a different feature from
  Super Import; MishMash does not need to produce an Instatic-native `.instatic/site-bundle.json`
  transfer archive) — no coupling to any of these is designed or implied here.
- Instatic's hosted-OAuth MCP mode (`authMode: 'oauth'`) — deliberately not pinned; see **Open
  questions** item 2.
- Closing the pre-existing "no CLI for managing external MCP client entries" gap identified above.
  It predates this wave, applies uniformly to all 25 templates, and fixing it is a general MCP-
  client capability change, not an Instatic-specific one.
- Any new workflow, wizard, onboarding step, or persisted "this project is linked to Instatic"
  state. The export is a one-shot, stateless artifact — no relationship survives past the download.
- Any `pages/`/`tokens/`/`media/` folder restructuring, a separate tokens manifest file, or any
  other reshaping of the exported file tree. The evidence in **Ground facts** shows Instatic wants
  the flat, natural-path tree MishMash already produces — inventing a different shape would be
  scope creep in the other direction (unrequested product surface), not fidelity to the seam.
- Any change to `apps/daemon/src/routes/library.ts`, `brands/**`, `design-systems/**` internals, or
  any file this wave does not explicitly lease.

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
    "apps/daemon/tests/project-super-import-*.test.ts",
    "apps/daemon/tests/mcp-templates-instatic.test.ts",
    "scripts/waves/capability-manifest.json",
    "scripts/waves/verify-w10a.ts",
    "docs/plans/waves/W10a-instatic-seam.md"
  ],
  "deny": [
    "apps/web/src/providers/registry.ts",
    "docs/plans/waves/leases.json",
    "docs/plans/waves/DECISIONS.md",
    "docs/security/**"
  ],
  "note": "apps/daemon/src/routes/project-super-import.ts is a NEW dedicated route file (house pattern: one module per route concern, matching routes/library.ts, routes/covers*.ts) rather than growing the already-large routes/project/index.ts. registry.ts is denied deliberately -- it is a live cross-wave hotspot (W2/W3/W4 all touch it under VERIFICATION-CONTRACT.md 4.1's serialization); DesignFilesPanel.tsx is the lower-collision UI landing spot for the new export action. server.ts is leased narrowly for the one new route-registration call site only, mirroring how registerMcpRoutes/registerLibraryRoutes are already wired in -- not a broad grant."
}
```

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-w10a.ts`,
runnable now via `pnpm exec tsx scripts/waves/verify-w10a.ts`.

| ID | Criterion | Verification |
|---|---|---|
| C10A-1 | Instatic MCP template registered, real-transport shape | Isolated daemon boot (port 0, fresh `mkdtemp OD_DATA_DIR`); `GET /api/mcp/servers`; exactly one `templates[]` entry identifiable as Instatic; `transport==='http'`; `url` ends with the real `/_instatic/mcp` suffix (`mcp-connectors.md:20-24`); `authMode==='none'` (explicit, not OAuth); a `headerFields` entry with `key==='Authorization'` whose `placeholder`/`label` names `imcp_pat` case-insensitively (`mcp-connectors.md:79,85` — proves the real token format was used, not a placeholder); plus the structural checks every template must pass (`SERVER_ID_PATTERN`, valid `category`, non-placeholder `label`/`description`/`homepage`) |
| C10A-2 | Super Import export matches Instatic's real ingestion contract | Real HTTP `GET /api/projects/:id/export/super-import` against a fixture project (created via real `POST /api/projects` + `POST /api/projects/:id/files`, never a DB-level stub); response unzipped via the daemon's own already-installed `jszip`; entries present at their **natural relative paths** — `index.html`, `docs/about.html`, `style.css`, `images/logo.png` — byte-identical (sha256) to the fixture, **no** `pages/`/`media/`/`tokens/` prefix; every entry's extension maps to Instatic's real `classifyFiles.ts:9-16,25-54` role table (html/css/js/image/font/meta/binary, cited exactly, not reinvented); **negative control**: a fixture `index.html.artifact.json` sidecar is absent from every path in the zip (MishMash's own pre-existing hygiene rule, re-verified for the new route, not an Instatic requirement); the route's own source contains the literal Instatic size-guard constants `10_000` and `1073741824` (`ingestInput.ts:39-41`), evidencing the guard uses Instatic's real numbers |
| C10A-3 | CLI parity, real subprocess | `od project export-super-import <fixtureId> --daemon-url <isolated-url> --out <tmp> --json`, spawned as a real child process (never an in-process function call) with `OD_DAEMON_URL` also set to the isolated daemon and never falling through to `127.0.0.1:7456`; exit 0; saved file sha256-identical to C10A-2's HTTP response body |
| C10A-4 | Super Import UI entry point wired | Source scan of `apps/web/src/**/*.ts(x)`: the literal route substring `/export/super-import` appears outside a comment line, within 3 lines of a recognizable call-site pattern (`fetch(`, `.get(`, or a named API-helper call) — existence-of-wiring only, not visual/aesthetic review (that stays a human PR-screenshot check per the repo's own PR template, not a mechanical criterion here) |
| C10A-5 | No deeper coupling (founder-pin scope fence) | Over `git diff --name-only <baseCommit>...HEAD` intersected with this wave's own lease `allow` globs (excluding `scripts/waves/**` and `docs/**`, which are verifier/PRD scaffolding, not shipped product surface): zero occurrences of an outbound-call primitive (`fetch(`, `axios`, `http.request(`, `https.request(`, `XMLHttpRequest`) naming a non-loopback host; zero writes to a live `mcp-config.json` `servers` array originating from template-selection code outside the existing, unchanged user-save path. Legitimately vacuous (0 files, 0 violations) pre-implementation — see **Verified baseline** |
| C10A-6 | Gates | `pnpm guard` and `pnpm typecheck` both exit 0 on the current tree (this also mechanically forces `capability-manifest.json`'s `project` row to list the new route before guard passes, per **Ground facts**) |

Plus the three named infra checks (house pattern, `verify-w9-ingest.ts` precedent):
**GATE-INTEGRITY** (advisory self-hash pin, `manifest.gateIntegrityPinned` reports whether an
orchestrator-approved hash exists yet), **LEASE** (`git diff --name-only <baseCommit>...HEAD` ⊆
`leases.json@baseCommit`'s `W10a-instatic.allow`, read via `git show`, never the working tree —
**expected to fail honestly until this PRD lands on `main` and the lease row above is actually
added**, the same self-resolving gap `W9-ingest-tranche.md`'s ruling 3 recorded for its own PRD
file), **HEAD-DRIFT** (HEAD must not move mid-run).

## Verified baseline (this run, pre-implementation, post evidence-grounding revision)

Captured by actually running `pnpm exec tsx scripts/waves/verify-w10a.ts` against this branch
before any product code exists — see the run tail in the handoff message for the live output.
`4/9` pass: C10A-1..C10A-4 and LEASE report `fail` honestly (no template exists, no route exists,
no CLI case exists, no UI call site exists, no lease row landed yet), while C10A-5, C10A-6,
GATE-INTEGRITY, and HEAD-DRIFT report `pass`. C10A-5's pass is a **legitimate, disclosed vacuous
pass** (zero leased product files touched yet, so zero violations exist to find) — not a loophole;
C10A-1..C10A-4 independently carry the burden of proving the features exist. `pnpm guard`/`pnpm
typecheck` (C10A-6) pass today since this PRD and its verifier are the only new files and both are
within repo conventions — this run's own C10A-6 evidence is a real, full-repo `pnpm guard` + `pnpm
typecheck` pass, not merely assumed. This baseline was re-captured after the evidence-grounding
revision (real Instatic ingestion contract + real MCP transport, replacing the earlier
best-defensible guesses) — the criteria fail for the same underlying reason (nothing implemented
yet) but now assert the *correct* target shape.

## Open questions for adversarial review

1. **RESOLVED — Instatic's real Super Import wire format.** Confirmed by direct read of
   `~/projects/tools/third-party/instatic` (`docs/features/site-import.md`, `src/core/siteImport/
   ingestInput.ts`, `classifyFiles.ts` — see **Ground facts**). S10A-2 is corrected accordingly: no
   `pages/tokens/media` folders, no manifest file, tokens auto-extracted from CSS by Instatic itself.
   **Residual:** this wave verifies the *contract* (extension classification, size guards, path
   safety) mechanically; it does not drive a live round-trip through a *running* Instatic instance's
   actual import wizard — that needs a live install and browser automation against someone else's
   admin UI, which is genuine additional evidence beyond a mechanical verifier's reach and is out of
   scope per the founder's "deeper coupling needs separate evidence" pin.
2. **RESOLVED — outcome (a): Instatic ships a real MCP server.** Confirmed by `CLAUDE.md` +
   `docs/features/mcp-connectors.md` in the Instatic repo (see **Ground facts**). S10A-1 is pinned to
   `transport: 'http'`, endpoint suffix `/_instatic/mcp`, personal-access-token header auth.
   **New residual, replacing the old one:** Instatic's hosted-OAuth mode (`authMode: 'oauth'`,
   MishMash's existing generic MCP OAuth automation in `mcp-oauth.ts`) is deliberately **not**
   pinned or attempted here. It requires a public HTTPS Instatic deployment (the doc's own words:
   hosted clients "cannot reach `localhost`... or an HTTP-only deployment"), which doesn't fit a
   local companion service, and confirming MishMash's generic OAuth client is wire-compatible with
   Instatic's *specific* RFC 9728 + dynamic-client-registration flow is itself deeper-coupling
   evidence this wave does not gather. If the founder wants OAuth-mode registration too, that is a
   founder-scoped follow-up, not a silent addition here.
3. **`registry.ts` collision risk.** The proposed lease denies `apps/web/src/providers/registry.ts`
   and routes the UI touchpoint through `DesignFilesPanel.tsx` instead, to dodge the W2/W3/W4
   hotspot `VERIFICATION-CONTRACT.md` §4.1 already had to resolve once. If the real implementation
   turns out to need `registry.ts` after all (e.g. because project-action fetch helpers live there
   and duplicating one in `DesignFilesPanel.tsx` would be worse than reusing it), this needs an
   explicit lease amendment and burst-ordering decision before it lands, not a silent lease-glob
   change mid-implementation.
4. **`export-super-import`'s CLI/HTTP byte-identity bar (C10A-3).** This assumes the CLI
   implementation will be a thin `fetch`-and-save wrapper, exactly like the existing `archive`
   case. If a reviewer wants the CLI to support something the HTTP route doesn't (e.g. `--root`
   scoping, mirroring `archive`), that changes C10A-3's exact-identity assertion into a looser
   contract and should be decided before freeze, not discovered as a false-negative during
   implementation.
5. **C10A-2's size-guard check is source-level, not runtime-exercised.** The verifier confirms the
   route's source literally contains Instatic's real guard constants (`10_000`, `1073741824`) but
   does not generate a real >10,000-file or >1 GB fixture and confirm the route actually rejects it
   over HTTP — doing so would mean the verifier itself creates and uploads a disproportionate amount
   of fixture data for a small wave. If a reviewer considers the rejection *behavior* (not just the
   presence of the right numbers) load-bearing, this needs either a cheaper synthetic test seam
   (e.g. an injectable/overridable limit for tests) or an explicit founder-accepted gap — not
   something this PRD should silently leave to the implementer's discretion.
