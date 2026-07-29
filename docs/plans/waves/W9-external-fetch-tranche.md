# Wave 9 — External-fetch tranche (route hardening, SSRF)

**Slug:** `mishmash-w9-external-fetch-tranche`
**Gates on:** W0 (landed)
**Relationship to sibling W9 tranches:** `W5-W11-gated.md`'s Wave 9 section orders the rolling
program by threat boundary — agent spawn → filesystem → deploy (BYOK tokens) → **external fetch
(SSRF)** → Library ingest → imports → long tail. Library ingest was pulled out as its own gated
slug (`mishmash-w9-ingest-tranche`) and has already landed; this document does not assume agent
spawn, filesystem, or deploy(BYOK) have landed, does not depend on their artifacts, and does not
re-attribute anything Library ingest already attributed (`apps/daemon/src/routes/library.ts`,
`library-store.ts` are out of scope here — see "Explicitly out of scope").
**Blocks:** `docs/plans/waves/W5-W11-gated.md` names Wave 6b (`mishmash-w6b-capture-isolation`) as
gated on "**W-C landed** + **W9's external-fetch tranche green**" — this document's own green
manifest is that prerequisite. W6b's capture-isolation service may not begin until this tranche's
verifier is green on `main`.
**Loop:** `loop:tranche` (`VERIFICATION-CONTRACT.md` §6)
**Verifier:** `scripts/waves/verify-w9-external-fetch.ts`
**Write lease:** none granted yet — this document is an expansion, not an implementation. A
**proposed** lease is recorded as text in "Proposed lease for the implementation" below; it is not
written into `docs/plans/waves/leases.json` by this PRD, and no source file outside
`docs/plans/waves/W9-external-fetch-tranche.md` and `scripts/waves/verify-w9-external-fetch.ts`
is touched by this change.

**Status: DRAFT — first expansion, not yet adversarially reviewed.** Per the NM-41C gate
(`W5-W11-gated.md` lines 8–24), this document is written and frozen *before* any implementation
work starts, and is reviewed by a reviewer who did not write it and will not implement it, before
it is unfrozen for a `/goal` run. Unlike the sibling `W9-ingest-tranche.md` (now at round 8 of its
own ceremony), this is the **first** draft of this document — no adversarial round has run against
it yet. It does not claim any review history it does not have. An agent may not begin
implementation from this page until that review has happened and the document + verifier are
frozen on `main`.

---

## Why this tranche exists

`W5-W11-gated.md` records Sol's finding that route hardening is not executable as one "harden all
routes" wave — the real daemon HTTP surface is 340 method registrations (334 excluding `OPTIONS`)
across 35 route files plus 6 bootstrap routes in `server.ts`, ordered by threat boundary. The task
brief that authorized this expansion names the central technical risk directly: **request forgery
through caller-influenced outbound URLs** — private-address/loopback/link-local/metadata-endpoint
reachability, redirect-following into private space, and DNS-rebinding — reachable through
URL-based imports, connector/webhook calls, and remote asset retrieval performed by the daemon on
a caller's behalf. The brief also names the exact house pattern this tranche must follow:
`docs/plans/waves/VERIFICATION-CONTRACT.md` §6's definition of "attributed", and
`scripts/waves/verify-w9-ingest.ts` as the canonical frozen-gate machinery (per-criterion
scoreboard, GATE-INTEGRITY/LEASE/HEAD-DRIFT, proof-artifact manifest with archived runs).

This is not a hypothetical risk in this repository. `docs/plans/waves/W9-ingest-tranche.md`
documents a real, already-fixed SSRF in `POST /api/library/ingest` with read-back exfiltration
through the (then-unauthenticated) `/raw` route. `apps/daemon/tests/aihubmix-asset-ssrf.test.ts`,
`apps/daemon/tests/marketplace-install-ssrf.test.ts`, and `apps/daemon/tests/brand-safe-fetch.test.ts`
exist precisely because this class of bug has already been found and fixed more than once. This
tranche's job is **not** to rediscover those already-fixed cases — it is to turn the daemon's
*entire* remaining outbound-fetch surface (outside Library ingest, which already has its own
attribution matrix) into one mechanically-generated, complete attribution matrix, with an
independently-reviewed implementation before it counts as done.

## Ground facts (verified directly in this tree, this run)

**There is no single file to scope this tranche to** — unlike Library ingest (one
`registerLibraryRoutes` function), outbound-fetch call sites are spread across roughly 20 files.
This document freezes an explicit **file set** and **route set** (S9XF-1) rather than a single
function, and states that choice as a deliberate scoping decision, not an oversight.

**At least four independently-implemented SSRF guards already exist in this codebase, with
materially different protection levels — this duplication is itself a finding:**

- `apps/daemon/src/brands/safe-fetch.ts` — `assertPublicBrandUrl` + `fetchExternalBrandAsset`.
  Rejects non-public hosts (loopback, RFC1918, CGNAT, link-local/metadata, multicast) by literal
  check AND by resolving every DNS answer; **pins DNS resolution to the actual connecting socket**
  via an undici `Agent` with a `connect.lookup` override (`createValidatingLookup`), so the address
  validated is the address connected to — this is what defeats DNS rebinding. Follows redirects
  manually with re-validation per hop, capped at `MAX_BRAND_REDIRECTS = 5`.
- `apps/daemon/src/plugins/plugin-asset-cache.ts` — `safeExternalFetch` / `assertSafePublicUrl` /
  `createValidatingLookup` (line 200). Same design as `safe-fetch.ts` — its own header comment says
  so directly ("SSRF is the load-bearing risk here… same pattern as `plugins/plugin-asset-cache.ts`"
  is literally quoted in `safe-fetch.ts`'s own header, confirming the two were written as siblings).
  **Independently re-implemented rather than shared** — a second copy of the same pinned-lookup
  logic, not a shared primitive.
- `apps/daemon/src/connectionTest.ts` — `assertExternalAssetUrl` / `assertAndFetchExternalAsset` /
  `validateBaseUrlResolved` / `validateUserProviderBaseUrl`. Validates via a **separate** DNS
  lookup (`validateBaseUrlResolved`, line 134: `dnsPromises`/`lookup(hostname)`, then checks each
  resolved address), then calls plain `fetch(url, { redirect: 'error' })` afterward — **the
  validated address is never pinned to the connecting socket**. This is a real, structural
  DNS-rebinding / TOCTOU gap: a hostname that resolves public at validation time and private at
  connect time (an attacker-controlled low-TTL DNS record) defeats this guard in a way `safe-fetch.ts`
  and `plugin-asset-cache.ts` are specifically built not to be defeated by. `validateUserProviderBaseUrl`
  additionally allows loopback (an intentional exception for local model providers like Ollama) and
  supports an operator opt-in allowlist (`OD_ALLOWED_INTERNAL_HOSTS`) that `assertExternalAssetUrl`
  does not honor — two different policies live in the same file, selected by which wrapper a call
  site chooses.
- `apps/daemon/src/design-systems/shadcn-import.ts` — `classifyHost` (its own local guard for the
  shadcn/npm design-system-import path). Blocks obfuscated/IP-literal hosts and link-local/CGNAT-ish
  ranges by string/IP classification, uses `redirect: 'error'`, and enforces its own request-count
  and wall-clock fetch budget (`withFetchBudget`) plus byte-size caps and include-depth/breadth
  limits — real, meaningful controls. But it performs **no DNS resolution and no connection-time
  pin at all**, and **deliberately allows loopback** ("self-hosted local registry/tests" — the
  opposite policy from `safe-fetch.ts`, which explicitly blocks loopback even though a public brand
  site is never legitimately on it). This is the weakest of the four guards on the DNS-rebinding
  axis specifically, and its own code comments admit as much.

**At least five caller-reachable outbound-fetch call sites have no SSRF guard at all today** (verified
by reading the call site and confirming no reachable call to any of the four guard families above):

- `apps/daemon/src/mcp-oauth.ts` `beginAuth()` (reached from `POST /api/mcp/oauth/start`,
  `apps/daemon/src/mcp-routes.ts:190`) — `discoverProtectedResource(serverUrl)` →
  `discoverAuthServer(issuer)` → OAuth dynamic client registration is **3+ unguarded fetches to a
  fully caller-supplied `serverUrl`** in the request body. No `validateBaseUrl`/host-allowlist call
  anywhere in `mcp-oauth.ts`. This is the strongest unguarded finding in this tranche.
- `apps/daemon/src/deploy.ts:1738` `requestDeploymentUrl()` (reached from
  `POST /api/projects/:id/deployments/:deploymentId/check-link`,
  `apps/daemon/src/routes/deploy.ts:225`, `registerDeploymentCheckRoutes`) — plain
  `fetch(url, { redirect: 'manual', ... })`, no guard call anywhere near it. `url` traces back to
  `checkDeploymentUrl` candidates, which can include a **caller-configured custom domain** wired
  through this same file's Cloudflare DNS-record routes (lines 834–915). `redirect: 'manual'` stops
  redirect-chasing but does nothing about the initial host.
- `apps/daemon/src/media/index.ts` — roughly 40 provider-specific `renderXxx()` functions (image,
  video, audio generation across OpenAI/Azure/ImageRouter/Ark/x.ai/NanoBanana/OpenRouter/Leonardo/
  ElevenLabs/MiniMax/aihubmix/SenseAudio and others), each building its outbound base URL from
  `credentials.baseUrl` (or equivalent) — a field the caller sets via `PUT /api/media/config`
  (`apps/daemon/src/media/config.ts`, `writeConfig`, no host allowlist). The dispatcher used
  (`openAIImageDispatcher`, line 869: `new UndiciAgent({...})`) has **no `connect.lookup`** —
  unlike `brands/safe-fetch.ts`'s `brandAssetDispatcher`. Reached from
  `POST /api/projects/:id/media/generate` and `POST /api/tools/media/generate`
  (`apps/daemon/src/routes/media.ts:619,654`). The daemon attaches the provider's own API key to
  this request, so a caller who points `baseUrl` at an internal service gets that request replayed
  there **with the stored credential attached** — a credential-to-SSRF-target leak, not only a
  blind SSRF. **`apps/daemon/src/routes/media.ts`'s own `GET /api/media/providers/aihubmix/models`
  handler (lines 371–420) explicitly refuses a caller-supplied `baseUrl` override for exactly this
  reason** — its comment says so directly ("to avoid an SSRF hole… pointing the daemon at
  `http://169.254.169.254/`") — proving the risk was already understood for one provider and not
  applied to the rest.
- `apps/daemon/src/byok-tools.ts` — a parallel, narrower instance of the same pattern: asset-URL
  retrieval call sites (lines 701, 934, 1320) correctly call `assertExternalAssetUrl` first, but the
  **provider base-URL** call sites (lines 504, 652, 828, 1062, 1196, 1237, 1523 and their polling
  siblings 869, 1551, 1667) build the request from `ctx.upstreamBaseUrl` / stored media-config —
  the same user-editable field `media/index.ts` uses — with no guard at all.
- `apps/daemon/src/integrations/elevenlabs-voices.ts:127` — `fetch(`${baseUrl}/v2/voices...`)`,
  `baseUrl` from `resolveProviderConfig(projectRoot, 'elevenlabs')` (also user-set via
  `PUT /api/media/config`), no guard call anywhere in the file. Reached from
  `GET /api/media/providers/elevenlabs/voices` (`apps/daemon/src/routes/media.ts:447`).

**Existing test coverage this tranche may cite directly, per the same "may cite directly" allowance
`W9-ingest-tranche.md` used (S9-3/S9-5):**
`apps/daemon/tests/aihubmix-asset-ssrf.test.ts` (5 assertions: literal internal/metadata host
rejection, `redirect:'error'` pinning on both chat video and image download paths),
`apps/daemon/tests/marketplace-install-ssrf.test.ts` (3 assertions: `POST /api/marketplaces` and
`POST /api/plugins/install` both refuse a loopback/internal source, plus a sibling-guard control),
`apps/daemon/tests/brand-safe-fetch.test.ts` (8 assertions: non-public host / malformed URL / public→
public redirect / redirect-into-non-public refusal / DNS-rebinding-pin rejection / genuine-public
pass-through), `apps/daemon/tests/brand-prefetch.test.ts`, `apps/daemon/tests/brands-prefetch-abort.test.ts`,
`apps/daemon/tests/plugin-asset-cache.test.ts`. None of these cover the five unguarded call sites
above — confirmed by reading every test title in each file; no title names `mcp-oauth`,
`check-link`/`deployment`, `media/index`/media-provider-baseUrl, `byok-tools` upstream base URL, or
`elevenlabs`.

**`docs/plans/waves/DECISIONS.md` carries zero `### W9-ACCEPT-*` entries today**, confirmed by
direct scan of the file at this branch's `baseCommit` — no accepted-risk record exists yet for any
route this tranche will attribute.

## Scope

**S9XF-1 — Freeze the route/call-site snapshot at baseCommit, with drift detection.** The frozen
unit is the **HTTP route** (`{method, path}`), not the raw fetch call site — the attribution matrix
row is what an owner/authn/authz/input-validation/size-rate-limit/test-ref sextuple naturally
attaches to, matching the ingest tranche's precedent. A route is in the frozen set only if it is
registered by one of the **named route-registration functions** below, in one of the **named
files** below, and its handler — directly, or via a same-file helper function reachable by a
bounded intra-file call-graph walk from the handler (function-name → function-names-it-calls,
built by scanning `CallExpression`s inside each function body; **no cross-file resolution** is
attempted beyond the specific traced edges named in this document) — reaches a `CallExpression`
whose callee is the bare identifier `fetch`, or a call to one of the enumerated
`KNOWN_SAFE_WRAPPERS` (below). This is a real, bounded, mechanical algorithm; it is not exhaustive
whole-program taint analysis, and this document says so rather than implying otherwise.

Frozen registration functions and their files (also the frozen **file set** for CXF-1's scan,
comment-blind since it is a real `ts.forEachChild` AST walk, never a text search):

| Registration function | File |
|---|---|
| `registerMcpRoutes` | `apps/daemon/src/mcp-routes.ts` |
| `registerDeploymentCheckRoutes` | `apps/daemon/src/routes/deploy.ts` |
| `registerMediaRoutes` | `apps/daemon/src/routes/media.ts` |
| `registerBrandRoutes` | `apps/daemon/src/brand-routes.ts` |
| `registerPluginMarketplaceRoutes` | `apps/daemon/src/routes/plugins/marketplaces.ts` |
| `registerPluginRoutes` | `apps/daemon/src/routes/plugins/index.ts` |
| `registerConnectorRoutes` | `apps/daemon/src/connectors/routes.ts` |
| `registerStaticResourceRoutes` | `apps/daemon/src/routes/static-resource.ts` |
| `registerLiveArtifactRoutes` | `apps/daemon/src/routes/live-artifact.ts` |
| `registerChatRoutes` | `apps/daemon/src/routes/chat.ts` |

`apps/daemon/src/routes/design-systems.ts` (`registerDesignSystemRoutes`) is **deliberately not** in
this table — see the correction noted at S9XF-2's frozen table below; it was in an earlier pass of
this document and was removed after actually running the verifier against it, not left in on an
unchecked assumption.

Plus the traced same-file/1-hop-import edges each row's fetch reachability actually depends on
(named explicitly so the verifier can check the edge still exists, rather than trusting a stale
claim): `routes/media.ts` → `media/index.ts` (provider render functions) and →
`integrations/elevenlabs-voices.ts`; `routes/deploy.ts` → `deploy.ts` (`requestDeploymentUrl`);
`mcp-routes.ts` → `mcp-oauth.ts` (`beginAuth`); `brand-routes.ts` → `brands/prefetch.ts` →
`brands/safe-fetch.ts` (+ `fonts.ts`/`imagery-fallback.ts`/`logo-fallback.ts`/`seed-fallback.ts`,
all consuming `fetchExternalBrandAsset`); `routes/static-resource.ts` →
`design-systems/shadcn-import.ts` / `source-context.ts` / `github-import.ts` (the real
design-system-import entry points, registered in `static-resource.ts` despite the "design-systems"
name suggesting otherwise — see S9XF-2) and → `community-pets-sync.ts`;
`routes/plugins/marketplaces.ts` and `routes/plugins/index.ts` → `plugins/marketplaces.ts` /
`plugins/plugin-asset-cache.ts` (`safeExternalFetch`); `connectors/routes.ts` →
`connectors/composio.ts`;
`routes/live-artifact.ts` → `live-artifacts/refresh.ts`; `routes/media.ts` → `research/tavily.ts`;
`routes/chat.ts` → `connectionTest.ts` / `integrations/provider-models.ts`.

`KNOWN_SAFE_WRAPPERS` (a call to one of these counts as reaching a fetch, and is guard-tier `0` by
construction — see S9XF-2): `fetchExternalBrandAsset`, `safeExternalFetch`,
`assertAndFetchExternalAsset`. `KNOWN_VALIDATING_GUARDS` (a reachable call to one of these, ahead
of a raw `fetch(`, is guard-tier `1` — see S9XF-2): `assertExternalAssetUrl`,
`validateBaseUrlResolved`, `validateUserProviderBaseUrl`, `validateBaseUrl`, `classifyHost`,
`assertPublicBrandUrl`, `assertSafePublicUrl`, `validateExternalApiBaseUrl` (a local closure in
`routes/chat.ts` wrapping `validateUserProviderBaseUrl` under its own name — every BYOK proxy/
connection-test route calls it under this name, not the wrapped one, and it would be silently
missed without listing it explicitly; found by running the verifier against the real source, not
assumed).

Any duplicate `{method, path}` registration among the **frozen route set** — at baseCommit or at
HEAD — is a hard fail, same rule as the ingest tranche's S9-1, but scoped to the 31 rows this tranche actually
attributes rather than every registration in every frozen file. That scoping is deliberate, not an
oversight: `apps/daemon/src/routes/static-resource.ts` and `apps/daemon/src/routes/design-systems.ts`
both legitimately register `DELETE /api/design-systems/:id` — confirmed by direct reading, the
`static-resource.ts` handler explicitly calls `next()` for one ID shape and falls through to the
other file's handler for the rest, a deliberate two-handler Express chain. That pair is real but
irrelevant here (`DELETE` performs no outbound fetch, so it is not one of this tranche's rows); an
earlier draft of this document's verifier scoped the duplicate check to *every* registration in
every frozen file and failed CXF-1 on exactly this pair — running the verifier caught its own
over-broad check, which is now fixed to scope duplicate detection to the frozen route keys only.
`apps/daemon/src/routes/library.ts` and `library-store.ts` are excluded by the file
list itself, not by a path filter that could silently drop something else too — see "Explicitly out
of scope".

**Scope reduction, flagged explicitly:** the ingest tranche's S9-1 cross-checks its route set
against a **live daemon boot's own `routeInventory`** as a third, independent verification method
beyond baseCommit and HEAD source reads. This tranche's verifier, as built this round, does **not**
boot a real daemon — CXF-1 is a two-way check (baseCommit source AST vs. HEAD source AST), not the
ingest tranche's three-way one. This is a genuine, disclosed scope reduction, not an oversight
papered over: a live boot would catch a route registered dynamically (not as a literal
`app.METHOD('/literal/path', ...)` call this scanner can see) or mounted through middleware this
scanner does not walk. A reviewer may reasonably require porting `bootDaemonForRouteInventory` from
`verify-w9-ingest.ts` before approving CXF-1 as equally strong evidence.

**S9XF-2 — State the risk-ranking rule: exposure reuses the ingest tranche's mechanical
classifier; impact is SSRF-specific, frozen, and reviewer-owned.**
Score = `exposure(0–3) + impact(0–3)`. Tiers: `score 5–6 = P0`, `score 4 = P1`, `score 0–3 = P2` —
identical tiering to the ingest tranche, deliberately reused rather than invented, since both
tranches score the same underlying quantity (how exposed is the caller class, how bad is the
outcome).

- **Exposure** — the weakest caller class that can reach the route, using the **same** guard
  vocabulary the ingest tranche's classifier already proved mechanical in this codebase (this repo
  has one shared set of guard functions, not one per tranche):
  - `0` — `requireLocalDaemonRequest` is a real Express middleware argument on the route, OR the
    handler's own straight-line prefix (after at most one CORS-prelude statement) checks
    `isLocalSameOrigin(req, ...)` before any fetch-reaching code runs.
  - `1` — the handler's straight-line prefix is `const grant = authorizeToolRequest(...)` followed
    by an unconditional-exit `if (!grant)` — tool-token gated.
  - `2` — the handler's straight-line prefix is a bearer/self-service token check
    (`bearerToken`/token-validation pair) with an unconditional-exit failure branch, and no
    reachable `isLocalSameOrigin` veto.
  - `3` — none of the above; the route relies on `server.ts`'s global `/api` origin middleware,
    which lets any request with no `Origin` header through.

  The verifier ports the ingest tranche's straight-line dominance grammar (`matchToolTokenGuard`,
  `matchBearerGuard`, `consequentUnconditionallyExits`, the bounded `isLocalSameOriginReachable`
  dead-branch-eliminating walk) rather than re-deriving it, generalized to scan **multiple** route-
  registration functions instead of one. The same self-probe discipline applies: fixture-driven
  self-probes (real shapes plus the decoy classes named in the ingest tranche — dead-branch guard,
  ignored-result guard, post-response guard, vetoed bearer shape) must pass before any route verdict
  in a run counts; a failed self-probe fails CXF-1 and CXF-8 outright.

- **Impact — SSRF-specific, a FROZEN reviewer-owned floor per route**, exactly the same mechanism as
  the ingest tranche's impact floors (a row may claim higher, never lower; changing a floor requires
  a reviewed gate amendment to this document, never an implementation-branch edit). This dimension
  answers "how directly can a caller steer this route's outbound fetch toward a private/internal
  target", **not** "does a guard exist" — guard existence is a separate question, resolved by
  `control`/`acceptedRisk` in S9XF-3, exactly as impact and control were separate questions in the
  ingest tranche. Floor definitions:
  - `0` — the fetch target's host is a hardcoded constant; the caller has no influence over it at
    all (not even the path).
  - `1` — the host is hardcoded; the caller supplies only a path segment or query value on that
    fixed host.
  - `2` — the host comes from a **persisted, caller-editable configuration field** (a BYOK provider
    `baseUrl`, a stored connector/media-provider config) — reaching the target requires the caller
    to have previously set that field through a separate write path, and to then trigger a route
    that consumes it.
  - `3` — the host is supplied **directly in the same request** that triggers the fetch, or is
    discovered from content the daemon itself fetched at the caller's direction (second-order —
    e.g. an `href`/`src` parsed out of attacker-influenced HTML).

  **The full frozen table** (`FROZEN_CALLER_INFLUENCE_FLOORS`, **31 routes** — see "Ground facts":
  this count is the frozen route count for this tranche, verified against the file set above by
  actually running the verifier this round, not assumed from any prior estimate. **This table was
  corrected once already, by that same run**: an earlier pass of this document had a
  `POST /api/design-systems/generation-jobs` row citing `shadcn-import.ts`/`source-context.ts`/
  `github-import.ts` — but `generation-jobs` only calls `designSystemGenerationJobs.start(...)`, an
  AI-generation job-queue abstraction with no traced outbound-fetch reachability. The REAL
  shadcn/GitHub import entry points are `POST /api/design-systems/import/shadcn` and
  `POST /api/design-systems/import/github`, both registered in
  `apps/daemon/src/routes/static-resource.ts`'s `registerStaticResourceRoutes` — confirmed by
  direct reading after the verifier's own drift/self-consistency check forced a re-check. This is
  exactly the failure mode the mechanical gate exists to catch: a plausible-sounding row that does
  not survive contact with the actual AST.):

  | Route | Reaches (file) | Impact floor | Rationale |
  |---|---|---|---|
  | `POST /api/mcp/oauth/start` | `mcp-oauth.ts` `beginAuth` | 3 | caller-supplied `serverUrl` in body |
  | `POST /api/projects/:id/deployments/:deploymentId/check-link` | `deploy.ts` `requestDeploymentUrl` | 3 | caller-configurable custom domain / stored deployment URL |
  | `POST /api/projects/:id/media/generate` | `media/index.ts` (~40 provider fns) | 3 | persisted, caller-editable `credentials.baseUrl` |
  | `POST /api/tools/media/generate` | `media/index.ts` (same fns) | 3 | same |
  | `GET /api/media/providers/elevenlabs/voices` | `integrations/elevenlabs-voices.ts` | 2 | persisted, caller-editable `baseUrl` |
  | `GET /api/media/providers/aihubmix/models` | `routes/media.ts` (deliberately hardcoded) | 0 | model positive control — caller override explicitly refused |
  | `POST /api/design-systems/import/github` | `design-systems/github-import.ts` (via `static-resource.ts`) | 1 | host hardcoded to `github.com` (`git clone` subprocess); only owner/repo caller-supplied |
  | `POST /api/design-systems/import/shadcn` | `shadcn-import.ts` / `source-context.ts` (via `static-resource.ts`) | 3 | caller-supplied registry ref/URL plus second-order `include` resolution; `classifyHost`'s own guard allows loopback and does no DNS resolution — the weakest of the four known guards |
  | `POST /api/brands` | `brands/prefetch.ts` chain | 3 | direct caller site URL + second-order hrefs (`<link>`/`@font-face`/`<img>`/favicon) |
  | `POST /api/brands/:id/continue-extraction` | same chain | 3 | same |
  | `POST /api/brands/:id/preview` | same chain | 3 | same |
  | `POST /api/brands/:id/finalize` | same chain | 3 | same |
  | `POST /api/brands/:id/extract-from-html` | same chain (second-order only) | 3 | sub-resource hrefs inside caller-supplied HTML — **reachability not independently re-verified this round; the mechanical S9XF-1 scan is the authority, not this table** |
  | `POST /api/marketplaces` | `plugins/marketplaces.ts` via `safeExternalFetch` | 3 | direct caller marketplace URL |
  | `POST /api/plugins/install` | same guard, `routes/plugins/index.ts` | 3 | direct caller plugin-source URL |
  | `GET /api/connectors/logos/:slug` | `connectors/routes.ts` `fetchComposioLogo` | 1 | fixed host, caller-supplied path segment only |
  | `POST /api/tools/connectors/execute` | `connectors/composio.ts` | 0 | fixed `DEFAULT_COMPOSIO_BASE_URL` |
  | `POST /api/connectors/:connectorId/connect` | `connectors/composio.ts` | 0 | same fixed host |
  | `POST /api/research/search` | `research/tavily.ts` | 2 | persisted `baseUrl`; route itself loopback-gated (`isLocalSameOrigin`) |
  | `POST /api/codex-pets/sync` | `community-pets-sync.ts` | 0 | fixed third-party hosts (`PETSHARE_BASE`/`HATCHERY_LIST`); no caller influence over target — flagged separately as an unauthenticated-trigger/resource-abuse row, not classic SSRF |
  | `POST /api/live-artifacts/:artifactId/refresh` | `live-artifacts/refresh.ts` | 3 | caller-supplied url in stored refresh-source config — but route is `requireLocalDaemonRequest`-gated (mechanically confirmed exposure 0) |
  | `POST /api/tools/live-artifacts/refresh` | same | 3 | same, tool-token gated (mechanically confirmed exposure 1) |
  | `POST /api/provider/models` | `connectionTest.ts` family | 2 | persisted BYOK `baseUrl` |
  | `POST /api/test/connection` | `connectionTest.ts` family | 2 | same |
  | `POST /api/proxy/anthropic/stream` | `connectionTest.ts` family | 2 | same |
  | `POST /api/proxy/openai/stream` | same | 2 | same |
  | `POST /api/proxy/azure/stream` | same | 2 | same |
  | `POST /api/proxy/google/stream` | same | 2 | same |
  | `POST /api/proxy/ollama/stream` | same | 2 | same |
  | `POST /api/proxy/senseaudio/stream` | same (`registerByokToolChatProxy` factory, not a direct `app.post`) | 2 | same |
  | `POST /api/proxy/aihubmix/stream` | same | 2 | same |

  **Mechanically confirmed P0 today (this run, actually executed against this worktree — not a
  ground-facts guess):** 23 of the 31 frozen routes score P0: `mcp/oauth/start`, `check-link`,
  `media/generate` (the `/projects/:id/` entry; the `/tools/` entry scores P1, exposure `1` via
  `authorizeToolRequest`), `elevenlabs/voices`, `design-systems/import/shadcn`, all five brand
  routes, `marketplaces`, `plugins/install`, `research/search`, `tools/live-artifacts/refresh` (the
  `requireLocalDaemonRequest`-gated `/live-artifacts/:artifactId/refresh` entry scores P2 instead,
  exposure `0` — confirming the exposure/impact independence the ingest tranche's S9-2 established
  for `pair/revoke`/`pair/rotate`), and all 9 `connectionTest.ts`-family routes
  (`provider/models`, `test/connection`, all 7 `proxy/*/stream`). This large P0 count is the honest
  mechanical output, not a target to shrink by construction — several of these rows (the five brand
  routes, `marketplaces`, `plugins/install`) already have a real DNS-pinned guard
  (`fetchExternalBrandAsset`/`safeExternalFetch`) and will resolve cleanly through `control` once
  implemented; they are still P0 because tier is `exposure + impact`, not "has a control yet" — the
  same separation of concerns S9-2 established for the ingest tranche. C9XF-6's per-P0-row control
  requirement and the threat-model bullet requirement key off this mechanically-verified tier.

**S9XF-3 — Mechanically-generated attribution matrix, structured, six required fields per
`VERIFICATION-CONTRACT.md` §6.** A companion file, `docs/security/external-fetch-attribution.json`,
one row per frozen route (exactly 31, no orphans/gaps/duplicates), each row carrying `owner`,
`authn`, `authz`, `inputValidation`, `sizeRateLimit`, `testRef`. None of the six may be a bare
placeholder (12-character floor, stock-filler denylist, anti-repetition check — same mechanism as
the ingest tranche's S9-3). `authn` must name the row's mechanically-derived exposure class
(`requireLocalDaemonRequest`/`loopback` for `0`, `authorizeToolRequest`/"tool token" for `1`,
`bearer`/"self-service" for `2`, `none`/"no gate"/"global bypass" for `3`) — reused verbatim from
the ingest tranche's mechanism. **`inputValidation` must name the row's mechanically-derived guard
status** (the analogous, tranche-specific check): one of the `KNOWN_SAFE_WRAPPERS`/"dns-pinned" for
guard-tier `0`, one of the `KNOWN_VALIDATING_GUARDS`/"validated-unpinned" for guard-tier `1`, or
"none"/"unguarded"/"no validation" for guard-tier `2` (raw `fetch` with no reachable guard call and
no hardcoded-host classification) — checked against the mechanism the AST scan actually found
reachable from that route, not merely present as a keyword. `sizeRateLimit` documents any response
size cap, redirect-hop cap, or request-volume/wall-clock budget on the outbound fetch itself (e.g.
`fetchExternalBrandAsset`'s `MAX_BRAND_REDIRECTS = 5`, `shadcn-import.ts`'s `withFetchBudget` and
byte caps) — most rows in the "guaranteed P0 today" list have **no such cap today**, which S9XF-4
forces a real resolution for.

Every row also carries `riskScore` (`{exposure, impact, score, tier}`, formula-enforced) and, for
every row whose mechanically-derived **guard-tier is `2` (unguarded)**, exactly one of:

- `control: { mechanism: string, testRef: string }` — the exact same global-uniqueness,
  path-derived-association-term, paired-positive/negative-control, AST-derived historical-title,
  and replay-red-evidence machinery `W9-ingest-tranche.md`'s S9-3 defined, reused verbatim (the
  verifier ports the relevant functions rather than re-deriving them — `extractStaticTestTitlesFromSource`,
  `findIntroductionCommit`, `replayRedEvidence`, `buildReplayRunnerScript`,
  `evaluateTaskForestConsistency`, `hasDistinctSignalPair`). "New" is decided the same
  AST-derived-title-at-baseCommit way; a genuinely new control requires the same structured
  red-transcript artifact at `docs/security/external-fetch-red/<slug(testRef)>.txt` (descriptive
  only — the verifier's own detached-worktree replay is the proof, never the checked-in text).
- `acceptedRisk: { decisionRef: string }` — must exactly equal a unique `### W9XF-ACCEPT-<slug>`
  heading in `docs/plans/waves/DECISIONS.md` **as read at baseCommit**, with the same five required
  fields (`Route`, `Accepted risk`, `Accepter`, `Date`, `Rationale`) and the same non-self-accepted /
  route-bound / globally-unresolvable-on-duplicate rules the ingest tranche's S9-3 established.

A row with all six fields populated but no `control`/`acceptedRisk` on a guard-tier-`2` row does
**not** count as attributed. The verifier reports three counts every run, same as the ingest
tranche: **attributed**, **unattributed** (guard-tier `2`, neither control nor accepted risk — a
true, uncontrolled gap), and **known-vulnerable** (guard-tier `2`, a verified accepted risk on
file). Given the five confirmed-unguarded call sites in "Ground facts", a green run of this tranche
is only possible with real controls landed for at least `mcp/oauth/start`, `check-link`,
`media/generate` (×2 routes), and `elevenlabs/voices` — or founder-signed accepted risk for
whichever of those the implementer does not close.

`docs/security/daemon-threat-model.md` is extended with a "Wave 9 — External fetch" section, in the
same `[CXF-N]`-tagged, exact-`fullName`-citing style as the existing `[C0-N]`/`[C9-N]` sections.
Each P0-tier route requires its own bullet naming exactly that one P0 route key and citing exactly
that row's expected reference — the same per-P0-bullet uniqueness rule the ingest tranche's S9-3
"Per-P0-route bullet association" established.

**S9XF-4 — Resolve the guard gap explicitly, for every P0 row.** Applies to every row whose
mechanically-verified `riskScore.tier === 'P0'`. `inputValidation`'s companion `control.mechanism`
must match, in full, an anchored declaration grammar (the same anti-gaming shape as the ingest
tranche's `ENFORCED` grammar, adapted to this domain):

```
GUARDED mechanism=<dns-pinned|validated-unpinned|hostname-allowlist|hardcoded-host> fn=<function-name> pinsConnection=<true|false>
```

`dns-pinned` and `hostname-allowlist` require `pinsConnection=true`; `validated-unpinned` requires
`pinsConnection=false`. `fn` must be a real, non-empty identifier and must exactly match the guard
function name the S9XF-1 reachability scan actually found reachable from that route — a declaration
naming a guard the scan did not find on that route's own reachability path fails closed, exactly
like the ingest tranche's rejection of an unbound rate-limit declaration. The declaration remains
descriptive evidence only; C9XF-6 passes only when, in addition, `control.testRef` passes the full
C9XF-5 bar (exact-pass, global-uniqueness, route-association, historical-title check, replay for a
genuinely new control) **and** the same file's real-transport coverage shows a paired
positive-control (a passing assertion proving a legitimate public/hardcoded target still succeeds)
and negative-control (a passing assertion proving a private/loopback/metadata target is refused) —
the same two-distinct-assertions bar the ingest tranche's C9-6 enforced, adapted from
rate-limit-pair to accept/reject-pair.

**S9XF-5 — Endpoint tests per tranche.** Every attributed row's `testRef` must name a real,
currently-passing, route-associated, globally-unique test. Existing coverage may be cited directly
per S9XF-3's allowance (`aihubmix-asset-ssrf.test.ts` for byok-tools asset-retrieval,
`marketplace-install-ssrf.test.ts` for `POST /api/marketplaces`/`POST /api/plugins/install`,
`brand-safe-fetch.test.ts`/`brand-prefetch.test.ts` for the brand-extraction chain,
`plugin-asset-cache.test.ts` for `safeExternalFetch`). The five confirmed-unguarded call sites named
in "Ground facts" have no existing coverage — S9XF-4 forces a real resolution (control or accepted
risk) for whichever of them land as P0 under the mechanical classifier.

**S9XF-6 — Adversarial verification of the implementation, not just this expansion.** Identical
design to the ingest tranche's S9-6: `docs/security/external-fetch-implementation-review.json` —
`{reviewer, model, reviewedCommit, verdict}`, `reviewedCommit` a strict ancestor of `HEAD`, the
owned-path diff between `reviewedCommit` and `HEAD` empty, `reviewer` distinct from every commit
author across `baseCommit..reviewedCommit`, `verdict === "APPROVE"`.

## Explicitly out of scope

- **`apps/daemon/src/routes/library.ts`, `library-store.ts`, `library.ts`, `library-tokens.ts`,
  `library-sync.ts`** — owned and already attributed by the landed `mishmash-w9-ingest-tranche`.
  Re-deriving these here would duplicate ownership and risk a lease conflict; this tranche cites
  the ingest tranche's own manifest as evidence that URL-based library ingest is already covered,
  and does not re-score it.
- **`apps/daemon/src/mcp.ts`, `mcp-live-artifacts-server.ts`, `tools-live-artifacts-cli.ts`** —
  loopback-only calls back into the daemon's own API (`OD_DAEMON_URL`), not third-party egress. Zero
  SSRF relevance, confirmed by reading every call site in these three files.
- **`apps/daemon/src/artifacts/create.ts`** (`postCreateArtifactRequest`) — an internal same-process
  HTTP client hitting the daemon's own `/api/projects/:id/files`, not attacker-influenced target
  selection.
- **`apps/daemon/src/deploy/cloudflare-pages-helpers.ts`, `plugins/publish.ts`,
  `plugins/skill-candidates.ts`, `inline-assets.ts`** — no direct outbound-fetch call site found
  (verified: no `fetch`/`axios`/`http(s).request`/undici match, and no import of any of the four
  guard families).
- **`apps/daemon/src/services/whats-new.ts`, `routes/whats-new.ts`,
  `routes/open-design-public-metadata.ts`, `storage/project-storage.ts`, `trace-object-manifest.ts`,
  `reasoning-egress.ts`, `langfuse-bridge.ts`** — zero outbound-fetch call sites, confirmed the same
  way.
- **`apps/daemon/src/memory-llm.ts`** — the `baseUrl` values visible at this layer are hardcoded
  vendor constants; the actual network call happens through the already-inventoried
  `routes/chat.ts` proxy machinery, not independently here.
- **`PUT /api/media/config`, `PUT /api/deploy/config`, `PUT /api/connectors/composio/config`,
  `PUT /api/mcp/servers`** — these routes **write** the caller-editable configuration fields several
  P0 rows above depend on, but do not themselves perform an outbound fetch, so they fall outside
  this tranche's row scope by the WAVE SCOPE's own definition ("route/code path that performs an
  OUTBOUND network fetch"). They are cited as evidence inside the relevant downstream row's impact
  rationale, not attributed as their own row. Whether these write paths need their own input
  validation is a legitimate finding for a **different** tranche (filesystem/deploy-BYOK) or a
  follow-up, not silently dropped — noted here so it is visible, not assumed out of scope by
  omission.
- **Agent spawn, filesystem read/write, deploy (BYOK token handling itself, as opposed to the one
  outbound-fetch call site inside `deploy.ts` this tranche does attribute), Library ingest (landed),
  imports/long tail** — the other tranches in `W5-W11-gated.md`'s rolling W9 order. Not this
  document's job.

## Definition of "green" (for W6b's gate to consume mechanically)

W6b's own verifier must implement every one of the following predicates against
`~/.claude/goal-state/mishmash-w9-external-fetch-tranche/proof/manifest.json` before treating this
tranche as a satisfied precondition — every predicate is required, none is advisory. This list is
the same shape as `W9-ingest-tranche.md`'s "Definition of green" for W3, adapted to this tranche's
slug and evidence paths:

1. The file exists and parses as JSON.
2. `manifest.wave === "W9-external-fetch"`.
3. `manifest.wroteOk === true` (a `wroteOk:false` placeholder is written before any criterion runs,
   overwriting any prior run's manifest; a run that never completes leaves `wroteOk:false`, which
   must read as not green).
4. `manifest.treeDirty === false`.
5. The **set** of `manifest.criteria[].id` equals **exactly**: `{CXF-1, CXF-2, CXF-3, CXF-4, CXF-5,
   CXF-6, CXF-7, CXF-8, CXF-9, CXF-10, GATE-INTEGRITY, LEASE, HEAD-DRIFT}` — 13 IDs, no fewer, no
   more, no duplicates.
6. Every one of those 13 entries has `status === "pass"`. No criterion here is `human:`-marked;
   `status: "blocked-on-founder"` should never legitimately appear.
7. For every entry, `artifact` is non-null and re-hashing the file at that path with SHA-256 equals
   the recorded `artifactSha256`.
8. `manifest.commit` is an ancestor of (or equal to) the commit W6b's own verifier is currently
   checking.
9. No drift in any of this tranche's evidence paths since `manifest.commit`:
   ```
   git diff --name-only <manifest.commit>...<candidate> --
     apps/daemon/src/mcp-routes.ts apps/daemon/src/mcp-oauth.ts
     apps/daemon/src/routes/deploy.ts apps/daemon/src/deploy.ts
     apps/daemon/src/routes/media.ts apps/daemon/src/media/index.ts
     apps/daemon/src/integrations/elevenlabs-voices.ts
     apps/daemon/src/brand-routes.ts apps/daemon/src/brands/prefetch.ts apps/daemon/src/brands/safe-fetch.ts
     apps/daemon/src/routes/static-resource.ts apps/daemon/src/design-systems/shadcn-import.ts
     apps/daemon/src/design-systems/source-context.ts apps/daemon/src/design-systems/github-import.ts
     apps/daemon/src/routes/plugins/marketplaces.ts apps/daemon/src/routes/plugins/index.ts
     apps/daemon/src/plugins/marketplaces.ts apps/daemon/src/plugins/plugin-asset-cache.ts
     apps/daemon/src/connectors/routes.ts apps/daemon/src/connectors/composio.ts
     apps/daemon/src/community-pets-sync.ts
     apps/daemon/src/routes/live-artifact.ts apps/daemon/src/live-artifacts/refresh.ts
     apps/daemon/src/routes/chat.ts apps/daemon/src/connectionTest.ts apps/daemon/src/byok-tools.ts
     apps/daemon/tests/*.test.ts
     docs/security/external-fetch-attribution.json
     docs/security/daemon-threat-model.md
     docs/security/external-fetch-implementation-review.json
     docs/security/external-fetch-red/**
     docs/plans/waves/DECISIONS.md
     scripts/waves/verify-w9-external-fetch.ts
   ```
   must be empty.
10. `manifest.gateIntegrityPinned` is readable directly; if `false`, W6b additionally needs an
    external approval receipt for this PRD/verifier pair before treating the pin's absence as
    legitimate rather than merely unremarked.

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by
`scripts/waves/verify-w9-external-fetch.ts`.

| ID | Criterion | Verification |
|---|---|---|
| CXF-1 | Route/call-site snapshot frozen at baseCommit, drift-checked against HEAD, duplicate-checked, classifier self-verified | AST scan of the 10 frozen registration functions at `baseCommit` (`git show`) and at HEAD, self-consistent with `FROZEN_CALLER_INFLUENCE_FLOORS`' key set (31 routes); any duplicate `{method,path}` among the frozen set at either point is a hard fail; gated on all exposure- and guard-classifier self-probes passing. **No live daemon boot cross-check in this draft — see the flagged scope reduction in S9XF-1.** |
| CXF-2 | Existing SSRF-relevant test suites are green | Real vitest JSON-reporter run of a frozen glob (`aihubmix-asset-ssrf`, `marketplace-install-ssrf`, `brand-safe-fetch`, `brand-prefetch`, `brands-prefetch-abort`, `plugin-asset-cache`, `deploy`, `deploy-routes`, `byok-tools`, `connectors-routes`, `connectors-service`, `connectionTest`-suffixed files if any exist); zero failed, zero pending/skipped, zero `skip`/`only`/`todo` markers |
| CXF-3 | Attribution matrix exists and covers exactly the frozen route set | `docs/security/external-fetch-attribution.json` parses as JSON; exactly one row per frozen `{method,path}` (31), no orphans, no gaps, no duplicates |
| CXF-4 | Every row is fully, structurally attributed | Every field clears the placeholder floor; `authn` names the row's exposure class; `inputValidation` names the row's mechanically-derived guard status; `acceptedRisk.decisionRef` resolves to a unique, fully-structured, route-bound, non-self-accepted `### W9XF-ACCEPT-*` entry in `DECISIONS.md@baseCommit`; evidence reports attributed/unattributed/known-vulnerable counts |
| CXF-5 | Every `testRef`/`control.testRef` names a real, currently-passing, globally-route-unique test; new controls carry independently-replayed red evidence | Same mechanism as `W9-ingest-tranche.md`'s C9-5, ported: exact `fullName` equality, one global citation map, AST-derived "new" decision, detached-worktree replay through Vitest's own Node API for a genuinely new control, paired positive+negative control in-file |
| CXF-6 | Every P0-tier row's SSRF guard is explicitly, mechanically resolved | For every row with `riskScore.tier === 'P0'`: `control.mechanism` matches the anchored `GUARDED mechanism=... fn=... pinsConnection=...` grammar exactly, `fn` matches the guard the reachability scan actually found on that route, `control.testRef` passes CXF-5's full bar, and the same file's real-transport coverage shows a paired accept-control/reject-control — or a verified `acceptedRisk` |
| CXF-7 | Threat-model doc extended, mechanically cited, P0-complete | `docs/security/daemon-threat-model.md` carries a "Wave 9 — External fetch" section; every `[CXF-N]` bullet's cited test is an exact match; each P0-tier route requires its own bullet naming exactly that one route key |
| CXF-8 | Full risk-score formula enforced per row | AST-derived `exposure` (ported straight-line dominance grammar, self-probe-verified) matches exactly; `impact >= FROZEN_CALLER_INFLUENCE_FLOORS[route]`; `score === exposure+impact`; `tier === tierFor(score)` |
| CXF-9 | Gates | `pnpm guard` and `pnpm typecheck` exit 0 on the current tree |
| CXF-10 | Adversarial review of the implementation is on record, non-spoofable | `docs/security/external-fetch-implementation-review.json`: `reviewedCommit` a strict ancestor of `HEAD`; owned-path diff between `reviewedCommit` and `HEAD` empty; `reviewer` distinct from every author in `baseCommit..reviewedCommit`; `verdict === "APPROVE"` |

Plus the three named infra checks: **GATE-INTEGRITY** (advisory self-hash pin — absence is also
`manifest.gateIntegrityPinned`, a top-level field), **LEASE** (`git diff --name-only
<baseCommit>...HEAD` ⊆ `leases.json@baseCommit`'s `W9-external-fetch.allow`, read via `git show`,
never the working tree — note this entry does not exist in `leases.json` yet; see "Proposed lease"),
**HEAD-DRIFT** (HEAD must not move mid-run).

## Verified baseline (this run, pre-implementation)

This section reports the verifier's **actual output**, from actually running
`pnpm exec tsx scripts/waves/verify-w9-external-fetch.ts` against this worktree — not a predicted
or narrated result. `pnpm guard` and `pnpm typecheck` both exit 0 on this diff (CXF-9 passes
today, since this diff adds only the PRD and the verifier, and the verifier itself typechecks
clean under `scripts/tsconfig.json`).

**6 of 13 criteria pass today, pre-implementation** — exactly the ones that do not require
implementation artifacts to exist: **CXF-1** (route snapshot self-consistent, 9/9 exposure- and
guard-classifier self-probes pass, no duplicates, no drift), **CXF-2** (the existing SSRF-relevant
test glob is fully green), **CXF-8** (the risk formula is internally consistent for all 31 rows),
**CXF-9** (guard + typecheck), **GATE-INTEGRITY** (correctly reports unpinned), and **HEAD-DRIFT**.
**CXF-3 through CXF-7 and CXF-10 fail honestly** (no attribution matrix, threat-model section, or
review record exists yet — expected pre-implementation). **LEASE fails honestly** (no
`W9-external-fetch` entry in `leases.json` yet — expected until this PRD lands and the proposed
lease is granted).

- 31 routes frozen across 10 registration functions in 10 files, confirmed by direct reading of
  every `app.get/post/put/delete/options(...)` call in each file plus the one
  `registerByokToolChatProxy(...)` factory-registration alias (not assumed from any prior count,
  and corrected once already this round after the verifier's own drift check caught a
  mis-scoped row — see the frozen table above).
- Four independently-implemented SSRF guards confirmed, with two (`safe-fetch.ts`,
  `plugin-asset-cache.ts`) connection-pinned and two (`connectionTest.ts`'s
  `assertExternalAssetUrl` family, `shadcn-import.ts`'s `classifyHost`) not.
- Five caller-reachable outbound-fetch call sites confirmed to have **no** SSRF guard today:
  `mcp-oauth.ts` `beginAuth`, `deploy.ts` `requestDeploymentUrl`, `media/index.ts`'s ~40 provider
  functions, `byok-tools.ts`'s provider-base-URL call sites, `elevenlabs-voices.ts`.
- The mechanical guard-tier scan reports **guard-tier 2 (unguarded) for all 9
  `connectionTest.ts`-family routes** (`provider/models`, `test/connection`, all 7
  `proxy/*/stream`), even though those routes' handlers in `routes/chat.ts` do call
  `validateExternalApiBaseUrl` (a local alias for `validateUserProviderBaseUrl`, added to
  `KNOWN_VALIDATING_GUARDS` this round after being found missing). This is a **known, flagged
  limitation, not a bug the reviewer should silently accept**: `ROUTE_TARGET_FILES` maps these
  routes to `connectionTest.ts` (where the guard function is *defined*), but the actual raw
  `fetch(...)` calls for the streamed provider responses live inline in `routes/chat.ts` itself,
  in the same handler functions as the guard call — the per-file worst-case aggregation this
  tranche's guard-tier scanner uses cannot distinguish "this route's own handler is guarded" from
  "an unrelated diagnostic helper elsewhere in a large multi-route file is not," and `chat.ts` is
  an 85 KB file serving many routes outside this tranche's frozen set. The result is conservative
  (fail-safe: it will force real attribution work for these 9 rows rather than silently trusting
  the guard exists) but not fully accurate, and is called out again in "Adversarial review" below.
- `apps/daemon/tests/aihubmix-asset-ssrf.test.ts`, `marketplace-install-ssrf.test.ts`,
  `brand-safe-fetch.test.ts`, `brand-prefetch.test.ts`, `brands-prefetch-abort.test.ts`,
  `plugin-asset-cache.test.ts` all exist and boot/exercise real transport — confirmed by reading
  every test title in each file; none cover the five unguarded call sites above. The full frozen
  glob (11 files, including `deploy`/`deploy-routes`/`byok-tools`/`connectors-routes`/
  `connectors-service`) ran green this round via the verifier's own CXF-2 check, not merely
  assumed from reading test titles.
- `docs/plans/waves/DECISIONS.md` carries zero `### W9XF-ACCEPT-*` entries at `baseCommit`,
  confirmed by direct regex scan.
- `docs/security/external-fetch-attribution.json`,
  `docs/security/external-fetch-implementation-review.json`: do not exist yet (CXF-3 through CXF-7
  and CXF-10 fail honestly, as expected pre-implementation).
- The `mishmash-w9-ingest-tranche` proof manifest exists at
  `~/.claude/goal-state/mishmash-w9-ingest-tranche/proof/manifest.json` and its own criteria cover
  `apps/daemon/src/routes/library.ts`/`library-store.ts` — cited as the basis for this tranche's
  exclusion of those files, not re-verified here (this tranche does not read or depend on that
  manifest at run time; it only avoids re-attributing the same files, a scope decision, not a
  runtime dependency).

## Proposed lease for the implementation (TEXT ONLY — not written to `leases.json` by this PRD)

This is the lease the implementing agent should be granted **when this document and its verifier
are frozen and a `/goal` run is authorized**. It is recorded here as prose/JSON-shaped text for the
orchestrator to transcribe into `docs/plans/waves/leases.json` at that time — this PRD does not
edit `leases.json` itself, per the wave program's own rule that the expansion step only produces
the PRD and the verifier.

```jsonc
"W9-external-fetch": {
  "slug": "mishmash-w9-external-fetch-tranche",
  "allow": [
    "apps/daemon/src/mcp-oauth.ts",
    "apps/daemon/src/deploy.ts",
    "apps/daemon/src/media/index.ts",
    "apps/daemon/src/integrations/elevenlabs-voices.ts",
    "apps/daemon/src/byok-tools.ts",
    "apps/daemon/src/design-systems/shadcn-import.ts",
    "apps/daemon/src/routes/chat.ts",
    "apps/daemon/tests/mcp-oauth-*.test.ts",
    "apps/daemon/tests/deploy-check-link-*.test.ts",
    "apps/daemon/tests/media-provider-baseurl-ssrf.test.ts",
    "apps/daemon/tests/elevenlabs-voices-ssrf.test.ts",
    "apps/daemon/tests/byok-proxy-baseurl-ssrf.test.ts",
    "apps/daemon/tests/design-systems-import-ssrf.test.ts",
    "apps/daemon/tests/external-fetch-*.test.ts",
    "docs/security/**",
    "scripts/waves/verify-w9-external-fetch.ts",
    "docs/plans/waves/DECISIONS.md"
  ],
  "deny": [
    "docs/plans/waves/W9-external-fetch-tranche.md",
    "scripts/waves/verify-w9-external-fetch.ts"
  ],
  "note": "PROPOSED, not yet granted. `apps/daemon/src/brands/safe-fetch.ts`, `plugins/plugin-asset-cache.ts`, and `connectionTest.ts` are deliberately NOT leased for modification — per the same ruling the ingest tranche used for library-tokens.ts et al. (W9-ingest-tranche.md ruling 1), attribution without modification suffices for the already-guarded rows; any proven necessity requires a separate exact-file amendment on main before modification, never an implementation-branch edit. `apps/daemon/src/routes/chat.ts` IS leased (unlike the three above) because this document's own verifier run found its guard-tier scan cannot currently verify the 9 connectionTest.ts-family routes are guarded end-to-end (see 'Adversarial review' below) — the implementer may need to restructure where `validateExternalApiBaseUrl` is called relative to the raw fetch, or the reviewer may accept the existing shape as sufficient control without a code change; either way the file must be in-lease so a fix is possible if the review requires one. `scripts/waves/verify-w9-external-fetch.ts` appears in BOTH allow (so the file exists for `pnpm guard`/`pnpm typecheck` to see) and deny (so the implementer cannot rewrite the gate itself) — the same pattern the LEASE criterion's globToRegExp matching resolves by deny taking precedence over allow, exactly as `verify-w9-ingest.ts`'s own LEASE check implements it. `docs/plans/waves/W9-external-fetch-tranche.md` is similarly denied so the implementer cannot loosen its own frozen success criteria mid-implementation; a genuine defect found during implementation escalates to a reviewed gate amendment on `main`, the same amend-on-proof pattern `leases.json`'s own history uses repeatedly (see W0, W1, W4, W9-ingest's amendment notes)."
}
```

## Adversarial review

**Not yet performed.** This document is a first draft. Per `W5-W11-gated.md`'s expansion gate, it
must be reviewed by a reviewer who did not author it and will not implement it, and both this
document and `scripts/waves/verify-w9-external-fetch.ts` must be frozen on `main` before any
`/goal` run against this slug begins. Known residuals the author flags proactively, so a reviewer
does not have to rediscover them:

- The intra-file call-graph reachability walk in S9XF-1 is **bounded to same-file (and the named
  1-hop import edges)**, not full whole-program taint analysis. A fetch call site reachable only
  through a chain the PRD did not name (e.g. a helper re-exported from a third file) would be
  invisible to CXF-1's mechanical scan even though it is real. The named edges were derived from
  this round's own research (four parallel research passes over every file with a `fetch`/`axios`/
  `http(s).request`/undici match in `apps/daemon/src`), not assumed complete by construction — a
  reviewer should re-run the same grep sweep independently before approving the frozen file/edge
  list.
- `POST /api/brands/:id/extract-from-html`'s row is explicitly flagged in the frozen table as
  "reachability not independently re-verified this round" — the author read enough of
  `brand-routes.ts` to be confident the OTHER four brand routes reach `fetchExternalBrandAsset`, but
  did not fully trace whether `extract-from-html` (which accepts caller-supplied HTML directly,
  rather than fetching a starting URL) also triggers second-order sub-resource fetches. The
  mechanical scan is the real authority here; this table entry may need its impact floor corrected
  in the reviewed version if the scan finds it does not reach a fetch call site at all (in which
  case it should be dropped from the frozen route set, not silently kept as a padding row).
- **The guard-tier classifier's file-level aggregation genuinely breaks down for the
  `POST /api/proxy/:provider/stream` family (7 rows) plus `provider/models`/`test/connection` (9
  rows total) — this was found by actually running the verifier this round, not merely
  anticipated.** All 9 routes' handlers in `apps/daemon/src/routes/chat.ts` call
  `validateExternalApiBaseUrl` (a local alias for `validateUserProviderBaseUrl`, confirmed by direct
  reading) before their own `fetch(...)` calls — a real guard, in the same function as the fetch.
  But `ROUTE_TARGET_FILES` maps these routes to `connectionTest.ts` (where the guard is *defined*,
  not where these 9 routes' own fetches live), so the mechanical scan reports guard-tier 2
  (unguarded) for all 9 today. Re-pointing them at `routes/chat.ts` instead does not fix this: that
  file is 85 KB and serves many routes this tranche does not attribute, so a file-level worst-case
  aggregate would just import a different, equally wrong signal from unrelated handlers in the same
  file. This tranche's per-route guard-tier mechanism, as designed, needs a genuine per-function (not
  per-file) target for `routes/chat.ts` specifically — a design gap, not an oversight, and flagged
  here rather than silently shipped. Until fixed, these 9 rows will conservatively require real
  `control`/`acceptedRisk` attribution work regardless of whether the underlying code is already
  safe, which is fail-safe (VERIFICATION-CONTRACT.md's "never silently assumed safe") but not
  reviewer-satisfying evidence quality — a reviewer may reasonably require this fixed (a per-function
  ROUTE_TARGET_FILES variant, or a small `routes/chat.ts`-specific carve-out in
  `scanFileFetchProfile`) before approving CXF-6 as sound for this cluster.
- Unlike the ingest tranche's classifier, this document's exposure classifier is a **port** of the
  ingest tranche's proven functions, generalized to scan multiple registration functions — it HAS
  now been exercised this round (9/9 self-probes pass, CXF-1 and CXF-8 both pass against the real
  tree, and the 31-route frozen table is self-consistent), which is further along than the ingest
  tranche's own PRD was at this identical pre-implementation stage. The guard-tier classifier (new
  this tranche, not ported) has also been exercised and found the real, above-noted limitation —
  arguably stronger evidence than an untested claim would be, but the limitation is real and open.
- `S9XF-4`'s `GUARDED` grammar and `S9XF-3`'s replay/citation machinery are new anchored grammars,
  not reused verbatim strings — they follow the same anti-gaming shape the ingest tranche's
  ceremony arrived at after multiple rounds, but have not themselves been through that ceremony. A
  reviewer should specifically probe them for the same class of gap the ingest tranche's ceremony
  found in its own first attempts (unbound substring matches, permissive prose patterns, recursive-
  descent guard detection that finds a guard call inside dead code).
