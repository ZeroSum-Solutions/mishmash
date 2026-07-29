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
- **This repo's own claim about Instatic's Super Import format is a three-word gloss, not a
  fetched schema.** The only description available anywhere in this repo is "static zip →
  pages/tokens/media" (`NM-REGISTER.md`, `GLOBAL-GOAL.md`, the completion assessment). No Instatic
  source is present in this environment to confirm the exact contract Instatic's own parser
  expects — the register itself resolved the *seam*, not Instatic's *wire format*. This PRD treats
  that gloss as the target shape and defines a precise, mechanically-checkable interpretation of it
  below (**S10A-2**), grounded in `projectFileMap()`'s existing classifier. Whether Instatic's real
  parser needs something more specific is flagged as an **open question**, not silently assumed
  (see **Open questions**).
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
`^[a-z0-9][a-z0-9_-]{0,63}$`; a transport-appropriate field set — `command`/`args` for `stdio`, or
`url` for `http`/`sse`; non-placeholder `label`/`description`/`homepage`). **The exact transport,
command, or URL is deliberately not pinned here** — this repo has no verified record of Instatic's
actual MCP invocation (stdio launch command vs. a local HTTP endpoint the user starts separately),
and asserting one would be inventing a fact this document cannot check. The implementer confirms
the real invocation against Instatic's own install docs at build time; C10A-1 verifies *shape and
discoverability*, not a specific hardcoded command. Selecting the template must never write to a
user's live `mcp-config.json` on its own — it only ever pre-fills a form the user saves explicitly
(already true structurally, per **Ground facts**; C10A-5 checks nothing new violates it).

**S10A-2 — Super Import–shaped static export.** A new route, **`GET /api/projects/:id/export/
super-import`**, produces `application/zip` (same auth/param/Content-Disposition conventions as the
existing `/api/projects/:id/archive`) containing, for the *entire* project tree (dotfiles and
`*.artifact.json` sidecars excluded, matching `collectArchiveEntries`'s existing rule):

- `pages/<relative-path>` — every file `projectFileMap()` already classifies as `htmlFiles`,
  `cssFiles`, or `jsFiles` (the exact same three regexes, reused verbatim, not reinvented), with
  relative directory structure preserved so intra-page relative references keep resolving.
- `media/<relative-path>` — every file `projectFileMap()` already classifies as `assetFiles`
  (everything not html/css/js), relative structure preserved.
- `tokens/design-tokens.json` — copied verbatim if the project tree contains a `design-tokens.json`
  file (the same filename `apps/daemon/src/design-systems/import.ts:166` already writes for an
  applied design system); if none exists, `tokens/NO_TOKENS.txt` is written instead — the directory
  is never silently absent (`VERIFICATION-CONTRACT.md` §3 R5: an unenforced/absent guarantee must
  be stated, not hidden).
- `super-import-manifest.json` at the zip root, schema `mishmash.super-import-manifest.v1`, fields
  `{schema, projectId, projectLabel, generatedAt, pageCount, mediaCount, hasTokens, entryPage}`,
  where `pageCount` counts only true `.html`/`.htm` files (not every file physically under `pages/
  `), `mediaCount` counts files under `media/`, and `entryPage` reuses `projectFileMap()`'s existing
  `entryFile` resolution (prefers `index.html`, falls back to the first HTML file).

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
- A round-trip test against a real running Instatic instance or its actual Super Import parser.
  No Instatic checkout exists in this environment to test against; this is flagged as an open
  question for follow-up evidence, not something this wave fabricates a fake pass for.
- Instatic's Core Framework token engine or QuickJS-WASM plugin sandbox — no coupling to either is
  designed or implied here.
- Closing the pre-existing "no CLI for managing external MCP client entries" gap identified above.
  It predates this wave, applies uniformly to all 25 templates, and fixing it is a general MCP-
  client capability change, not an Instatic-specific one.
- Any new workflow, wizard, onboarding step, or persisted "this project is linked to Instatic"
  state. The export is a one-shot, stateless artifact — no relationship survives past the download.
- Extending `tokens/` beyond a single `design-tokens.json` copy (no design-system bundling, no
  brand-kit asset packaging) — that is W5/W6a territory, not this seam.
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
| C10A-1 | Instatic MCP template registered and live-discoverable | Isolated daemon boot (port 0, fresh `mkdtemp OD_DATA_DIR`); `GET /api/mcp/servers`; exactly one `templates[]` entry whose `id`/`label`/`description` identify it as Instatic (case-insensitive `instatic` match); entry structurally valid (`SERVER_ID_PATTERN`, valid `category` ∈ the real `McpTemplateCategory` union, transport-appropriate required fields present and non-placeholder, `homepage` present) |
| C10A-2 | Super Import export is correctly shaped and content-faithful | Real HTTP `GET /api/projects/:id/export/super-import` against a fixture project (created via real `POST /api/projects` + `POST /api/projects/:id/files`, never a DB-level stub); response unzipped via the daemon's own already-installed `jszip`; `pages/index.html`, `pages/docs/about.html`, `pages/style.css` present byte-identical (sha256) to the fixture; `media/images/logo.png` present byte-identical; `tokens/design-tokens.json` present byte-identical; `super-import-manifest.json` present, parses, `schema` exact, `pageCount===2`, `mediaCount===1`, `hasTokens===true`, `entryPage==="index.html"`; **negative control**: a fixture `index.html.artifact.json` sidecar is absent from every path in the zip |
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

## Verified baseline (this run, pre-implementation)

Captured by actually running `pnpm exec tsx scripts/waves/verify-w10a.ts` against this branch
before any product code exists — see the run tail in the handoff message for the live output. All
six substantive criteria and LEASE are expected to, and do, report `fail` (no template exists, no
route exists, no CLI case exists, no UI call site exists — C10A-5 alone reports a **legitimate,
disclosed pass**, since zero leased product files are yet touched so zero violations exist to find;
this is not a loophole, it is the expected pre-implementation shape of a pure negative control, and
C10A-1..C10A-4 independently carry the burden of proving the features exist). `pnpm guard`/`pnpm
typecheck` (C10A-6) are expected to pass today since this PRD and its verifier are the only new
files and both are within repo conventions.

## Open questions for adversarial review

1. **Instatic's real Super Import wire format is unverified from this repo.** S10A-2's
   `pages/tokens/media` interpretation is this document's best-defensible reading of a three-word
   gloss (`NM-REGISTER.md`), built by reusing `projectFileMap()`'s existing classifier rather than
   inventing a new one — but nothing here confirms it against Instatic's actual parser. Should
   landing this wave require fetching/reading Instatic's own Super Import source first (a research
   step, not implementation), or is the gloss-level contract an acceptable target for this seam,
   with fidelity verification deferred to a founder-visible manual check post-landing?
2. **Transport for the MCP template (S10A-1) is deliberately left unpinned.** Is a structural-only
   C10A-1 (valid shape, discoverable, identifiably Instatic) sufficient for "registered," or does
   the founder want the exact stdio/http invocation nailed down as a hard criterion before this
   lands — which would require sourcing Instatic's actual MCP entry point first?
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
