# Wave 9 — External-fetch tranche (route hardening, SSRF)

**Slug:** `mishmash-w9-external-fetch-tranche`
**Gates on:** W0 (landed)
**Relationship to sibling W9 tranches:** `W5-W11-gated.md`'s Wave 9 section orders the rolling
program by threat boundary — agent spawn → filesystem → deploy (BYOK tokens) → **external fetch
(SSRF)** → Library ingest → imports → long tail. Library ingest was pulled out as its own gated
slug (`mishmash-w9-ingest-tranche`) and has already landed; this document does not assume agent
spawn, filesystem, or deploy(BYOK) have landed, does not depend on their artifacts, and does not
re-attribute anything Library ingest already attributed (`apps/daemon/src/routes/library.ts`,
`library-store.ts` are out of scope here, except one narrow routed finding — see "Explicitly out of
scope" and S9XF-7).
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

**Status: CONFIRM-ROUND FIX 2 COMPLETE (fixing the confirm round's 5 findings — CR-1 through CR-4
BLOCKING, CR-5 LOW — see "Confirm-round dispositions" below), not yet re-confirmed or re-reviewed.**
Per the NM-41C gate (`W5-W11-gated.md` lines 8–24), this document is written and
frozen *before* any implementation work starts, and is reviewed by a reviewer who did not write it
and will not implement it, before it is unfrozen for a `/goal` run. **Round 1 returned REJECT with 7
blocking findings** (full text staged at review time; disposed one-by-one in "Round 1 dispositions"
below, in the same spirit as `W9-ingest-tranche.md`'s AUTHOR-FLAGGED/DISPOSITIONS section, though
this document does not carry that sibling's full multi-round ceremony history — this is round 2, not
round 8). The reviewer confirmed the underlying inventory research (the five named unguarded
families, the `connectionTest.ts` DNS-validation/connection TOCTOU distinction) as real; every
finding was about how the package *proves* things, plus one real inventory gap. Round 2 fixed all
7 in place. Per program-wide guidance recorded in `docs/plans/waves/DECISIONS.md`
(W9AS-PARK/W10A-PARK/W10B-PARK, after three sibling packages were parked for the same root cause):
**a criterion asserting runtime behavior must observe that behavior — boot the daemon, issue the
real request, assert on the response; structural (AST) checks are legitimate only for facts with no
runtime observable, and must say so.** Finding 2 was exactly that failure mode; the fix (detailed in
S9XF-4/CXF-6 below) boots a real isolated daemon and issues a live HTTP probe rather than adding more
AST conditions. Round 2 also absorbed one additional cross-tranche finding routed in mid-round
(S9XF-7/CXF-11, `fetchRemoteBytes`'s transfer bound) and three coordinator rulings on open design
questions — see "Round 2 rulings" below. **A subsequent independent confirm-round pass returned NOT
CONFIRMED against the round-2 verifier, twice, with 5 findings the first time** (CR-1..CR-4
BLOCKING on CXF-11's negative-control arithmetic, the interception self-check's scope, and
process-control evidence/teardown; CR-5 LOW on PRD wording) — **this fix round (round 2 of the
confirm loop) closes all 5; see "Confirm-round dispositions" below for the finding-by-finding
record.** This document does not claim any review or confirm outcome beyond what is recorded in
"Round 1 dispositions", "Round 2 rulings", and "Confirm-round dispositions". An agent may not begin
implementation from this page until re-review/re-confirmation happens and the document + verifier
are frozen on `main`.

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
| `registerXaiRoutes` | `apps/daemon/src/routes/xai.ts` |

`apps/daemon/src/routes/design-systems.ts` (`registerDesignSystemRoutes`) is **deliberately not** in
this table — see the correction noted at S9XF-2's frozen table below; it was in an earlier pass of
this document and was removed after actually running the verifier against it, not left in on an
unchecked assumption. `registerXaiRoutes` was **added in round 2** (finding 1) — entirely absent
from round 1's table, which is exactly how `POST /api/xai/search` escaped a hand-curated list. See
S9XF-1's mechanical discovery pass below, added specifically so a future miss like this one cannot
happen silently again.

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
HEAD — is a hard fail, same rule as the ingest tranche's S9-1, but scoped to the 33 rows this tranche actually
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

**Mechanical discovery, added round 2 (finding 1).** Round 1's CXF-1 only checked whether the
hand-curated `FROZEN_CALLER_INFLUENCE_FLOORS` table's own keys still existed in source —
self-consistency, never discovery — which is exactly how `POST /api/xai/search` escaped: nothing
would ever have noticed a route this document never typed in. `discoverFetchReachingRoutes` walks
**every** `.ts` file under `apps/daemon/src/routes/` (a real directory glob via `fs.readdirSync`,
not a hand-typed list, so a brand-new route file is picked up automatically) plus
`mcp-routes.ts`/`brand-routes.ts`/`connectors/routes.ts`, extracts every literal
`app.METHOD('/path', ...)` registration in each file (not scoped to one named function — a file can
define more than one registration function), and decides fetch-reachability with a bounded,
GENERIC algorithm that never consults `ROUTE_TARGET_FILES` or any other hand-curated per-route
table: a same-file call-graph BFS from the handler through named function/const-arrow declarations,
plus exactly one generic import hop — for each relative import the file itself declares, if the
handler's reachable call names include an imported binding AND that binding's own file shows any
fetch reachability, the route counts as reaching fetch. Any discovered route absent from the frozen
set is a hard CXF-1 failure naming the exact route. **This mechanism found a SECOND real miss on
its own, unprompted**: `POST /api/xai/oauth/complete` (now added to the frozen table, S9XF-2) — direct
evidence the fix generalizes past the one route the reviewer happened to name. It also produced two
coarse-grained false positives (`GET /api/projects/:id/design-system-package-audit`,
`POST /api/projects/:id/files`) from its own deliberate simplification (a same-file call graph plus
ONE generic import hop is not full call-graph precision) — both independently read end-to-end,
confirmed to reach no outbound fetch, and recorded in `DISCOVERY_FALSE_POSITIVE_ROUTES` with a
stated reason each, never a blanket ignore. `apps/daemon/src/routes/library.ts` is additionally
excluded at the FILE level (`DISCOVERY_EXCLUDED_FILES`) — it is owned end-to-end by the landed
ingest tranche, and discovery finding its already-attributed ingest route is not a gap in this
tranche's coverage, it is a scope boundary already documented in "Explicitly out of scope."

**Scope reduction, flagged explicitly:** the ingest tranche's S9-1 cross-checks its route set
against a **live daemon boot's own `routeInventory`** as a third, independent verification method
beyond baseCommit and HEAD source reads. CXF-1 itself still does **not** do this — it remains a
two-way check (baseCommit source AST vs. HEAD source AST) plus the new discovery pass above, not a
live-daemon cross-check. This is a genuine, disclosed scope reduction, not an oversight papered
over: a live boot would catch a route registered dynamically (not as a literal
`app.METHOD('/literal/path', ...)` call either scanner can see) or mounted through middleware
neither walks. **This gap is now cheaper to close than round 1 disclosed**: CXF-6's own
`bootIsolatedDaemon` (S9XF-4 below, added this round for finding 2) already boots the real
production daemon and exposes its `routeInventory` on the ready signal
(`buildIsolatedDaemonRunnerScript`) — a reviewer requiring CXF-1 to consume it is asking for reuse
of infrastructure that already exists in this file, not new construction.

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

  **The full frozen table** (`FROZEN_CALLER_INFLUENCE_FLOORS`, **33 routes** — see "Ground facts":
  this count is the frozen route count for this tranche, verified against the file set above by
  actually running the verifier this round, not assumed from any prior estimate. **This table has
  been corrected twice now, both times by actually running the verifier and reading its output,
  never by re-reasoning from memory:**
  - Round 1 (self-caught): an earlier pass had a `POST /api/design-systems/generation-jobs` row
    citing `shadcn-import.ts`/`source-context.ts`/`github-import.ts` — but `generation-jobs` only
    calls `designSystemGenerationJobs.start(...)`, an AI-generation job-queue abstraction with no
    traced outbound-fetch reachability. The REAL shadcn/GitHub import entry points are
    `POST /api/design-systems/import/shadcn` and `POST /api/design-systems/import/github`, both
    registered in `apps/daemon/src/routes/static-resource.ts`'s `registerStaticResourceRoutes`.
  - **Round 2 (reviewer-caught, finding 1 + finding 3): two defects.** First, `POST
    /api/xai/search` (`routes/xai.ts:253`) was entirely absent — CXF-1 only checked whether the
    curated table's own keys still existed in source, never discovered new ones. Fixed two ways:
    the missed route was added, AND CXF-1 was given a genuine mechanical whole-tree discovery pass
    (`discoverFetchReachingRoutes`, S9XF-1 below) that does not consult the curated tables at all —
    running it found a SECOND real miss on its own, `POST /api/xai/oauth/complete`
    (`exchangeCodeForToken` against the hardcoded `XAI_OAUTH_TOKEN_ENDPOINT`, impact 0), now also
    added; and two coarse-grained false positives from the discovery algorithm's own cross-file
    over-approximation (`GET /api/projects/:id/design-system-package-audit`,
    `POST /api/projects/:id/files` — both independently read end-to-end and confirmed to reach no
    outbound fetch), recorded as justified exclusions in `DISCOVERY_FALSE_POSITIVE_ROUTES`, never a
    blanket ignore. Second, three impact floors (`check-link`, both `media/generate` routes, both
    `live-artifacts/refresh` routes) were frozen at `3` while literally matching this section's own
    impact-`2` definition ("a persisted, caller-editable configuration field") — corrected to `2`
    below, so the table stops contradicting its own stated rule.

  | Route | Reaches (file) | Impact floor | Rationale |
  |---|---|---|---|
  | `POST /api/mcp/oauth/start` | `mcp-oauth.ts` `beginAuth` | 3 | caller-supplied `serverUrl` in body |
  | `POST /api/projects/:id/deployments/:deploymentId/check-link` | `deploy.ts` `requestDeploymentUrl` | 2 | caller-configurable custom domain / stored deployment record — a persisted config field, not a same-request value (corrected from 3, round 2 finding 3) |
  | `POST /api/projects/:id/media/generate` | `media/index.ts` (~40 provider fns) | 2 | persisted, caller-editable `credentials.baseUrl` (corrected from 3, round 2 finding 3) |
  | `POST /api/tools/media/generate` | `media/index.ts` (same fns) | 2 | same |
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
  | `POST /api/live-artifacts/:artifactId/refresh` | `live-artifacts/refresh.ts` | 2 | url set on the artifact by an earlier, separate create call, only referenced by ID here — a persisted config field, not a same-request value (corrected from 3, round 2 finding 3); route is `requireLocalDaemonRequest`-gated (mechanically confirmed exposure 0) |
  | `POST /api/tools/live-artifacts/refresh` | same | 2 | same correction; tool-token gated (mechanically confirmed exposure 1) |
  | `POST /api/provider/models` | `connectionTest.ts` family | 2 | persisted BYOK `baseUrl` |
  | `POST /api/test/connection` | `connectionTest.ts` family | 2 | same |
  | `POST /api/proxy/anthropic/stream` | `connectionTest.ts` family | 2 | same |
  | `POST /api/proxy/openai/stream` | same | 2 | same |
  | `POST /api/proxy/azure/stream` | same | 2 | same |
  | `POST /api/proxy/google/stream` | same | 2 | same |
  | `POST /api/proxy/ollama/stream` | same | 2 | same |
  | `POST /api/proxy/senseaudio/stream` | same (`registerByokToolChatProxy` factory, not a direct `app.post`) | 2 | same |
  | `POST /api/proxy/aihubmix/stream` | same | 2 | same |
  | `POST /api/xai/search` | `routes/xai.ts` (same file) | 2 | persisted `provider.baseUrl`, stored bearer credential attached — round 2, finding 1 |
  | `POST /api/xai/oauth/complete` | `routes/xai.ts` → `integrations/xai-oauth.ts` `completeXAIAuth`/`exchangeCodeForToken` | 0 | target host is the hardcoded `XAI_OAUTH_TOKEN_ENDPOINT`, set at flow start, never caller input at completion — found by CXF-1's own new discovery pass, round 2 finding 1 |

  **The exact P0 count this run reports is in "Verified baseline" below — read that section's live
  numbers, not a hand-computed guess here.** Impact-floor corrections and the exposure-classifier
  bug fix (S9XF-2 below) both shift which rows land P0 relative to round 1's draft; restating a
  specific count in this prose risks going stale the next time either input changes. What stays
  true regardless of the exact count: tier is `exposure + impact`, never "has a control yet" — a
  route with a real DNS-pinned guard (`fetchExternalBrandAsset`/`safeExternalFetch`) can still be
  P0, and will resolve cleanly through `control` once implemented, the same separation of concerns
  the ingest tranche's S9-2 established. CXF-6's per-P0-row control requirement and the
  threat-model bullet requirement key off the row's mechanically-verified tier, not this table.

**S9XF-3 — Mechanically-generated attribution matrix, structured, six required fields per
`VERIFICATION-CONTRACT.md` §6.** A companion file, `docs/security/external-fetch-attribution.json`,
one row per frozen route (exactly 33, no orphans/gaps/duplicates), each row carrying `owner`,
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

**S9XF-7 — `fetchRemoteBytes`'s transfer bound (CXF-11), added round 2 — a routed cross-tranche
finding, not this tranche's own inventory.** An independent review of the landed `W9-ingest-tranche`
found, while auditing a neighbouring claim, that `fetchRemoteBytes`
(`apps/daemon/src/routes/library.ts:112`) checks the caller's **declared** `Content-Length` before
fetching, then fully materializes the body via `await resp.arrayBuffer()` — line 124 — **before** the
real length is ever checked at line 125. A response that omits or lies about `Content-Length` is
buffered without bound before the existing post-hoc check can ever fire. The coordinator ruled this
out of the ingest tranche's scope (already landed, would need a gate amendment there) and into this
one, since this PRD had not yet frozen. It is a narrow, single-function carve-out into a file this
tranche otherwise treats as entirely out of scope (see "Explicitly out of scope" below) — it does
**not** reopen any other part of `library.ts`'s attribution, which remains the landed ingest
tranche's own.

The fix must bound the **transfer** as it streams — enforcing the limit while reading and aborting
once the running total crosses `MAX_REMOTE_BYTES`, never a re-check performed only after the whole
body is already resident in memory. CXF-11 asserts this at RUNTIME: it boots a real isolated
instance of the actual production daemon (the same `bootIsolatedDaemon` CXF-6 uses) and issues a
real `POST /api/library/ingest` request whose target is a response that genuinely streams past
`MAX_REMOTE_BYTES` while declaring no `Content-Length` — never by inspecting source for the presence
of a streaming API. Per Ruling 1 (`docs/plans/waves/W9-external-fetch-tranche.md`'s "Round 2
rulings" below), the **only** deviation from real production code is the transport: `globalThis.fetch`
is stubbed to intercept two EXACT sentinel URLs for CXF-11 itself (the oversized leak probe, and a
second, genuinely in-bounds 12 KiB ok probe through the identical code path — the POSITIVE CONTROL,
see below) and return a genuine `ReadableStream`-backed `Response` for each — **the same shared
runner/stub also intercepts every URL under CXF-6's accept-probe prefix (intentional, Ruling 3;
corrected in "Confirm-round dispositions", CR-5) since CXF-6 and CXF-11 share one `bootIsolatedDaemon`
mechanism, not two exact URLs in total**; route dispatch, the SSRF pre-check
(`assertPublicBrandUrl`, evaluated for real against a real public IP literal — no DNS, no bypass), and
`fetchRemoteBytes` itself all execute as real production code. The assertion is the OBSERVABLE
CONSEQUENCE — how many bytes the stream actually delivered before the transfer stopped growing,
measured via a loopback-only telemetry side-channel, never "a streaming API was called."

CXF-11 requires both a NEGATIVE control and a POSITIVE control in the same run, not the negative
control alone. A criterion whose only exercised case is "reject an oversized transfer" cannot
distinguish a genuinely discriminating fix from a measurement mechanism that always reports
"unbounded" (or, symmetrically, a fix so aggressive it cancels every transfer regardless of size) —
either bug would make the negative-control case look identical from outside. The positive control
sends the SAME `POST /api/library/ingest` request against a second sentinel that streams a small,
genuinely in-bounds total (12 KiB, also declaring no `Content-Length`, through the identical
route/guard/`fetchRemoteBytes` path) and requires it to complete untouched — full expected byte
count delivered, no cancellation, and the real daemon route returning `200` with a registered asset.
Only when BOTH controls behave as expected in the same probe run does CXF-11 pass.

## Explicitly out of scope

- **`apps/daemon/src/routes/library.ts`, `library-store.ts`, `library.ts`, `library-tokens.ts`,
  `library-sync.ts`** — owned and already attributed by the landed `mishmash-w9-ingest-tranche`.
  Re-deriving these here would duplicate ownership and risk a lease conflict; this tranche cites
  the ingest tranche's own manifest as evidence that URL-based library ingest is already covered,
  and does not re-score it. **Narrow exception, round 2 (S9XF-7/CXF-11):** `fetchRemoteBytes`'s
  transfer-bounding behavior (not the rest of the function, not the route's auth/attribution, not
  any other symbol in the file) is in scope here, as a routed cross-tranche finding the coordinator
  moved into this PRD because it had not yet frozen. The lease's `allow` list reflects this exact
  narrowness — see "Proposed lease" below.
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
   CXF-6, CXF-7, CXF-8, CXF-9, CXF-10, CXF-11, GATE-INTEGRITY, LEASE, HEAD-DRIFT}` — 14 IDs, no
   fewer, no more, no duplicates. (**Round 2 addition:** CXF-11, S9XF-7's routed `fetchRemoteBytes`
   transfer-bound finding.)
6. Every one of those 14 entries has `status === "pass"`. No criterion here is `human:`-marked;
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
     apps/daemon/src/routes/library.ts
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
| CXF-1 | Route/call-site snapshot frozen at baseCommit, drift-checked against HEAD, duplicate-checked, classifier self-verified, AND mechanically re-derived (not merely self-consistent) | AST scan of the 11 frozen registration functions at `baseCommit` (`git show`) and at HEAD, self-consistent with `FROZEN_CALLER_INFLUENCE_FLOORS`' key set (33 routes); any duplicate `{method,path}` among the frozen set at either point (same file or different, round-2 fix) is a hard fail; gated on all exposure- and guard-classifier self-probes passing; **round-2 addition** — `discoverFetchReachingRoutes` independently walks every route-registration file and fails on any fetch-reaching route outside the frozen set, modulo a small, individually-justified false-positive exclusion list. **No live daemon `routeInventory` cross-check in CXF-1 itself — see the flagged scope reduction in S9XF-1** (the infrastructure to close this now exists via CXF-6's `bootIsolatedDaemon`, not yet wired into CXF-1). |
| CXF-2 | Existing SSRF-relevant test suites are green | Real vitest JSON-reporter run of a glob (legacy exact filenames PLUS, round-2 addition, the lease's new prefix patterns `mcp-oauth-*`/`deploy-check-link-*`/`external-fetch-*` so a leased new test file is actually discoverable); zero failed, zero pending/skipped, zero `skip`/`only`/`todo` markers; **round-2 addition** — `.only(` is now source-scanned directly (the vitest reporter never surfaces it as a distinct status) |
| CXF-3 | Attribution matrix exists and covers exactly the frozen route set | `docs/security/external-fetch-attribution.json` parses as JSON; exactly one row per frozen `{method,path}` (33), no orphans, no gaps, no duplicates. **Round-2 reorder**: now runs before CXF-8, which reads its output |
| CXF-4 | Every row is fully, structurally attributed | Every field clears the placeholder floor; `authn` names the row's exposure class; `inputValidation` names the row's mechanically-derived guard status; `acceptedRisk.decisionRef` resolves to a unique, fully-structured, route-bound, non-self-accepted `### W9XF-ACCEPT-*` entry in `DECISIONS.md@baseCommit`, EVERY field of which (not only Route) is placeholder-checked and bound to its OWN heading span, never a neighbour's (round-2 fix, finding 6); `Accepter` is additionally checked against a non-founder-identity denylist; evidence reports attributed/unattributed/known-vulnerable counts |
| CXF-5 | Every `testRef`/`control.testRef` names a real, currently-passing, globally-route-unique test; new controls carry independently-replayed red evidence | Same mechanism as `W9-ingest-tranche.md`'s C9-5, ported: exact `fullName` equality, one global citation map, AST-derived "new" decision, detached-worktree replay through Vitest's own Node API for a genuinely new control. **Round-2 fixes**: association terms exclude generic path segments (`api`/`tools`/`projects`/`assets`/`v1`/`v2` — finding 4b); a control in a file that did not exist at all at baseCommit is now correctly treated as new and forced through replay, never silently exempted (finding 4d); replay's own process tree is tracked and confirmed-stopped, never a bare blocking spawn (finding 7) |
| CXF-6 | Every P0-tier row's SSRF guard is REAL, observed live — not inferred from source shape | **Redesigned, round 2 (findings 2a + 5a); extended, round 2 (Ruling 3).** Boots a real isolated instance of the actual production daemon (`bootIsolatedDaemon`, dynamically imports `apps/daemon/src/server.ts`'s own `startServer`); for every P0 row's `control`, the GUARDED grammar + fn-binding pre-check must ALSO carry a `control.probe` (`ProbeSpec`) that is EXECUTED against the live daemon with the caller-controlled field pointed at a loopback canary — passes only when the canary sees ZERO connections AND the daemon's response status is one the row declared as a refusal — **AND** the same field pointed at a stubbed-but-legitimately-public positive-control sentinel (`globalThis.fetch` intercepts only that one sentinel URL; route/guard/handler are real production code) must be shown to actually reach the stub, proving the guard discriminates rather than blanket-denying (Ruling 3: rules out "the canary saw zero connections because nothing was ever let through, guard or not"); a probe-infra self-check runs even pre-implementation, now including an EMPIRICAL proof that fetch-stub interception actually works (Ruling 1 condition 1 — POST `/api/library/ingest` against the sentinel, never assumed from source; confirm-round fix 2/CR-2: this proof is now a shared `proveStubInterception` helper CXF-11 also calls, independently, in its own daemon run) before any accept-probe result is trusted; the daemon's process-GROUP teardown (confirm-round fix 2/CR-3, CR-4: self-contained, fail-closed group signaling — no longer `@open-design/platform`-backed) must independently confirm zero survivors or CXF-6 fails outright, never merely logged — or a verified `acceptedRisk`. The ACCEPT-side real-transport signal for a controlled row's `testRef` is CXF-5's own requirement that it names a real passing test; this criterion supplies BOTH the REJECT-side signal and (round 2) the discriminating ACCEPT-side signal CXF-5 cannot. |
| CXF-7 | Threat-model doc extended, mechanically cited, P0-complete | `docs/security/daemon-threat-model.md` carries a "Wave 9 — External fetch" section; every P0-tier route requires its own bullet naming exactly that one route key AND citing exactly its expected reference (`control.testRef` if controlled, else primary `testRef`) — **round-2 fix (finding 5b)**: matching is now exact backtick-token equality, never substring `.includes()` (which made "exactly one bullet" structurally unsatisfiable for any route whose key is a literal prefix of a sibling route, e.g. all five `POST /api/brands...` rows); citation-checking was also entirely absent before this round |
| CXF-8 | Full risk-score formula enforced per row, bound to the MATRIX'S OWN declared riskScore | **Round-2 fix (finding 3): no longer tautological.** Previously recomputed score/tier from its own internal frozen-constants map and compared that computation against itself, never reading the attribution file at all — a row could omit or falsify `riskScore` entirely and still pass. Now reads each attribution ROW's own declared `riskScore.{exposure,impact,score,tier}` and checks it against the mechanically-computed exposure/impact-floor/tier; also carries the exposure-classifier dead-code fix (finding 2b: a straight-line inline `isLocalSameOrigin` veto, as opposed to `requireLocalDaemonRequest` middleware, now correctly scores exposure `0` instead of unconditionally `3`) |
| CXF-9 | Gates | `pnpm guard` and `pnpm typecheck` exit 0 on the current tree |
| CXF-10 | Adversarial review of the implementation is on record, non-spoofable | `docs/security/external-fetch-implementation-review.json`: `reviewedCommit` a strict ancestor of `HEAD`; owned-path diff between `reviewedCommit` and `HEAD` empty (round-2: the owned-path list now includes `routes/chat.ts` and every `apps/daemon/tests/*.test.ts`, both omitted before — finding 6b); `reviewer` AND `model` both placeholder- and non-founder-denylist-checked (round 1 checked neither meaningfully); `reviewer` distinct from every author in `baseCommit..reviewedCommit`; **round-2 addition** — the review record itself must NOT have existed at `reviewedCommit` (proves it was authored strictly afterward, not bundled with the state it claims to review); `verdict === "APPROVE"` |
| CXF-11 | `fetchRemoteBytes` (`apps/daemon/src/routes/library.ts:112`) bounds the TRANSFER as it streams, not only via a post-materialization re-check | **New, round 2 (S9XF-7, routed cross-tranche finding, Ruling 1); positive control added same round; negative-control arithmetic and interception gating hardened, confirm-round fix 2 (CR-1/CR-2).** Boots the same real isolated production daemon and issues a real `POST /api/library/ingest` request whose target is a genuine `ReadableStream`-backed `Response` that streams past `MAX_REMOTE_BYTES` while declaring no `Content-Length` — `globalThis.fetch` is stubbed for two exact sentinel URLs used by CXF-11 itself (the oversized leak probe and the in-bounds ok probe); the SAME shared runner/stub also intercepts CXF-6's accept-probe prefix (not this criterion's concern, but a true fact about the shared mechanism — see CR-5 below); the route, the SSRF pre-check (`assertPublicBrandUrl`, evaluated for real against a real public IP literal), and `fetchRemoteBytes` itself are unmodified production code (Ruling 1 condition 1, empirically proven in CXF-11's OWN daemon run via the same `proveStubInterception` self-check CXF-6 uses — CR-2: previously this proof ran only inside CXF-6's boot and never gated CXF-11 at all). If that self-check fails, both transfer probes are SKIPPED and CXF-11 fails outright (also avoids letting the ok-probe sentinel fall through to a real network call). Passes only when BOTH: the negative control shows the stream actually FLOWED (`bytesEnqueued > 0`, ruling out a pre-fetch rejection reading as "bounded"), stayed within `MAX_REMOTE_BYTES` plus a bounded slack, AND was terminated by the bound — `sawCancel === true` AND the daemon's own response status is NOT `200` (CR-1: a silent "truncated-200" — bytes stayed under the ceiling but the transfer was neither cancelled nor rejected — is a required-failing outcome, not merely "stayed under some ceiling"; a run against the CURRENT unfixed production code is itself the negative-control demonstration, Ruling 1 condition 3 — it must fail, and does); AND a second, genuinely in-bounds 12 KiB transfer through the SAME sentinel-stub/route/guard/`fetchRemoteBytes` code path proves FULL DELIVERY (exact byte count, no cancellation, HTTP `200`) in the SAME run — the POSITIVE CONTROL that proves the mechanism discriminates rather than always reporting unbounded or a fix that cancels everything indiscriminately. |

Plus the three named infra checks: **GATE-INTEGRITY** (advisory self-hash pin — absence is also
`manifest.gateIntegrityPinned`, a top-level field), **LEASE** (`git diff --name-only
<baseCommit>...HEAD` ⊆ `leases.json@baseCommit`'s `W9-external-fetch.allow`, read via `git show`,
never the working tree — note this entry does not exist in `leases.json` yet; see "Proposed lease"),
**HEAD-DRIFT** (HEAD must not move mid-run).

## Verified baseline (round 2, this run, pre-implementation)

This section reports the verifier's **actual output**, from actually running
`pnpm exec tsx scripts/waves/verify-w9-external-fetch.ts` against this worktree after the round-1
fix pass AND after absorbing CXF-11 (S9XF-7) — not a predicted or narrated result. `pnpm guard` and
`pnpm typecheck` both exit 0 on this diff (CXF-9 passes today; the verifier itself typechecks clean).

**5 of 14 criteria pass today, pre-implementation** (unchanged count from round 2's first pass —
CXF-11 is a genuinely new 14th criterion, and it fails today as expected, so the pass count did not
move). The 5 that pass are exactly the ones that do not require implementation artifacts to exist:
**CXF-1** (route snapshot self-consistent, 11/11 exposure- and guard-classifier self-probes pass, no
duplicates at either scope, no drift, AND the mechanical discovery pass finds zero fetch-reaching
routes outside the frozen set), **CXF-2** (the existing SSRF-relevant test glob, prefix-aware and
`.only`-scanned, is fully green), **CXF-9** (guard + typecheck), **GATE-INTEGRITY** (correctly
reports unpinned), and **HEAD-DRIFT**. **CXF-3 through CXF-8 and CXF-10 fail honestly** (no
attribution matrix, threat-model section, or review record exists yet — expected
pre-implementation). **LEASE fails honestly** (no `W9-external-fetch` entry in `leases.json` yet).
**CXF-11 fails honestly too — this is the required negative-control demonstration, not a defect —
and its own positive control (an ordinary in-bounds transfer, same run) passes, proving the failure
is discriminating rather than vacuous (see "Round 2 rulings" and the captured evidence below).**

**CXF-6's isolated-daemon-boot + live-probe infrastructure, INCLUDING the round-2 fetch-stub
seam, is confirmed real and working, not merely written.** Real captured evidence, this run:
```
probe-infra self-check: GET /api/mcp/install-info -> status=200 (boot+HTTP round-trip OK)
probe-infra self-check: fetch-stub interception proven=true (POST /api/library/ingest with a stub-sentinel url; status=200) -- if false, no per-row accept-probe result below can be trusted
teardown: ok=true observed=[37940,37946,37978] stopped=[37978,37946,37940] forced=[] remaining=[]
```
CXF-6 still fails overall today (no attribution matrix to probe against, as expected
pre-implementation), but both the mechanism finding 2 required (boot the daemon, issue the real
request, assert on the response) AND Ruling 1's stub-interception proof are not aspirational text —
they ran, for real, this round.

**CXF-11 fails against the CURRENT unfixed `fetchRemoteBytes` (the required negative-control proof,
Ruling 1 condition 3), AND in the SAME run its positive control — an ordinary in-bounds transfer
through the identical code path — completes untouched, proving the mechanism discriminates rather
than vacuously failing (or vacuously passing) regardless of input.** Real captured evidence, this run:
```
[SEAM: transport stubbed for one sentinel leak-probe URL only -- route /api/library/ingest, its SSRF pre-check, and fetchRemoteBytes are real production code] MAX_REMOTE_BYTES=26214400 slack=4194304 hardCap=36700160 bytesEnqueued=36700160 sawCancel=false cancelledAtBytes=null streamClosedAtHardCap=true daemonResponseStatus=502
UNBOUNDED: the stream was pulled to (or past) the hard safety cap without the consumer stopping near MAX_REMOTE_BYTES -- this run, against the CURRENT unfixed production code, is the negative-control demonstration Ruling 1 condition 3 requires: a criterion that does not fail here would itself be broken
[SEAM: transport stubbed for one sentinel ok-probe URL only -- same route/guard/fetchRemoteBytes code path as the leak probe above] expectedBytes=12288 bytesEnqueued=12288 sawCancel=false streamClosed=true daemonResponseStatus=200 assetId=a3290d91-4dc7-4c21-b687-f38bec9aebc6
POSITIVE CONTROL PASSED: the ordinary in-bounds transfer completed untouched (full expected byte count delivered, no cancellation, HTTP 200) in the same run as the negative control -- proves the mechanism discriminates rather than always reporting unbounded or cancelling everything
teardown: ok=true observed=[83689,83690,83722,84175,84174,84173,84153] stopped=[84175,84174,84173,84153,83722,83690,83689] forced=[] remaining=[]
```
`bytesEnqueued` reached the full 35 MiB hard safety cap (`MAX_REMOTE_BYTES` 25 MiB + a 10 MiB margin
this verifier imposes so an unbounded implementation cannot hang the run) without the consumer ever
stopping near the real 25 MiB limit — the exact unbounded-buffering behavior the finding named,
observed at runtime, not inferred from source. In the SAME run, a second, genuinely small (12 KiB)
transfer through the identical sentinel-stub/route/guard/`fetchRemoteBytes` path delivered exactly
its expected byte count, was never cancelled, and the daemon's own `/api/library/ingest` response
came back `200` with a real registered asset id — the ordinary-transfer case is untouched by whatever
made the oversized case fail, which is the property that rules out a vacuously-always-fails (or
vacuously-always-passes) measurement mechanism.

- **34 route-registration files** now scanned by the mechanical discovery pass (round-2 addition,
  finding 1) across the whole `apps/daemon/src/routes/` tree plus the three named extras; it found
  18 fetch-reaching routes, all inside the frozen set, plus 2 justified false-positive exclusions —
  see S9XF-1.
- 33 routes frozen across 11 registration functions in 11 files (up from 31 at round 1 — round 2
  added `POST /api/xai/search`, the route the reviewer named, AND `POST /api/xai/oauth/complete`,
  which this tranche's own new discovery pass found on its own).
- Four independently-implemented SSRF guards confirmed, with two (`safe-fetch.ts`,
  `plugin-asset-cache.ts`) connection-pinned and two (`connectionTest.ts`'s
  `assertExternalAssetUrl` family, `shadcn-import.ts`'s `classifyHost`) not.
- Six caller-reachable outbound-fetch call sites confirmed to have **no** SSRF guard today (the
  five the reviewer confirmed as real, plus `routes/xai.ts`'s `POST /api/xai/search`, added this
  round): `mcp-oauth.ts` `beginAuth`, `deploy.ts` `requestDeploymentUrl`, `media/index.ts`'s ~40
  provider functions, `byok-tools.ts`'s provider-base-URL call sites, `elevenlabs-voices.ts`,
  `routes/xai.ts`'s `POST /api/xai/search`.
- The mechanical guard-tier scan still reports **guard-tier 2 (unguarded) for all 9
  `connectionTest.ts`-family routes** (`provider/models`, `test/connection`, all 7
  `proxy/*/stream`), even though those routes' handlers in `routes/chat.ts` do call
  `validateExternalApiBaseUrl` (a local alias for `validateUserProviderBaseUrl`, added to
  `KNOWN_VALIDATING_GUARDS` in round 1). This remains a **known, flagged limitation**:
  `ROUTE_TARGET_FILES` maps these routes to `connectionTest.ts` (where the guard function is
  *defined*), but the actual raw `fetch(...)` calls for the streamed provider responses live inline
  in `routes/chat.ts` itself, in the same handler functions as the guard call — the per-file
  worst-case aggregation this tranche's STRUCTURAL guard-tier scanner uses cannot distinguish "this
  route's own handler is guarded" from "an unrelated diagnostic helper elsewhere in a large
  multi-route file is not." **This is exactly the class of gap CXF-6's new live probe exists to
  catch regardless of the structural scanner's blind spot once P0 rows are attributed with a real
  `control.probe`** — the runtime check does not depend on `ROUTE_TARGET_FILES` being precise,
  only on the declared probe actually reaching the route. The structural scan result stays
  conservative (fail-safe) in the meantime; see "Adversarial review" below.
- `apps/daemon/tests/aihubmix-asset-ssrf.test.ts`, `marketplace-install-ssrf.test.ts`,
  `brand-safe-fetch.test.ts`, `brand-prefetch.test.ts`, `brands-prefetch-abort.test.ts`,
  `plugin-asset-cache.test.ts` all exist and boot/exercise real transport — confirmed by reading
  every test title in each file; none cover the six unguarded call sites above. The full frozen
  glob (11 files, including `deploy`/`deploy-routes`/`byok-tools`/`connectors-routes`/
  `connectors-service`) ran green this round via the verifier's own CXF-2 check, not merely
  assumed from reading test titles.
- `docs/plans/waves/DECISIONS.md` carries zero `### W9XF-ACCEPT-*` entries at `baseCommit`,
  confirmed by direct regex scan.
- `docs/security/external-fetch-attribution.json`,
  `docs/security/external-fetch-implementation-review.json`: do not exist yet (CXF-3 through CXF-8
  and CXF-10 fail honestly, as expected pre-implementation).
- The `mishmash-w9-ingest-tranche` proof manifest exists at
  `~/.claude/goal-state/mishmash-w9-ingest-tranche/proof/manifest.json` and its own criteria cover
  `apps/daemon/src/routes/library.ts`/`library-store.ts` — cited as the basis for this tranche's
  exclusion of those files, not re-verified here (this tranche does not read or depend on that
  manifest at run time; it only avoids re-attributing the same files, a scope decision, not a
  runtime dependency). **CXF-11 (S9XF-7) is the sole, narrow exception** — it probes
  `fetchRemoteBytes`'s transfer-bounding behavior directly, independent of the ingest tranche's own
  attribution, per the coordinator's routing decision.

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
    "apps/daemon/src/routes/library.ts",
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
  "note": "PROPOSED, not yet granted. `apps/daemon/src/brands/safe-fetch.ts`, `plugins/plugin-asset-cache.ts`, and `connectionTest.ts` are deliberately NOT leased for modification — per the same ruling the ingest tranche used for library-tokens.ts et al. (W9-ingest-tranche.md ruling 1), attribution without modification suffices for the already-guarded rows; any proven necessity requires a separate exact-file amendment on main before modification, never an implementation-branch edit. `apps/daemon/src/routes/chat.ts` IS leased (unlike the three above) because this document's own verifier run found its guard-tier scan cannot currently verify the 9 connectionTest.ts-family routes are guarded end-to-end (see 'Adversarial review' below) — the implementer may need to restructure where `validateExternalApiBaseUrl` is called relative to the raw fetch, or the reviewer may accept the existing shape as sufficient control without a code change; either way the file must be in-lease so a fix is possible if the review requires one. `apps/daemon/src/routes/library.ts` IS leased (round 2, S9XF-7/CXF-11) DESPITE library.ts being the landed ingest tranche's own file everywhere else in this document — narrowly, so the implementer can fix `fetchRemoteBytes`'s transfer-bounding defect CXF-11 asserts; this does not reopen the rest of the file's attribution, which stays the ingest tranche's. `scripts/waves/verify-w9-external-fetch.ts` appears in BOTH allow (so the file exists for `pnpm guard`/`pnpm typecheck` to see) and deny (so the implementer cannot rewrite the gate itself) — the same pattern the LEASE criterion's globToRegExp matching resolves by deny taking precedence over allow, exactly as `verify-w9-ingest.ts`'s own LEASE check implements it. `docs/plans/waves/W9-external-fetch-tranche.md` is similarly denied so the implementer cannot loosen its own frozen success criteria mid-implementation; a genuine defect found during implementation escalates to a reviewed gate amendment on `main`, the same amend-on-proof pattern `leases.json`'s own history uses repeatedly (see W0, W1, W4, W9-ingest's amendment notes)."
}
```

## Round 1 dispositions

Round 1 (GPT-5.6 Sol) returned **REJECT** with 7 blocking findings. The reviewer explicitly
confirmed the underlying inventory research (the five originally-named unguarded families, the
`connectionTest.ts` DNS-validation/connection TOCTOU distinction) as real; every finding was about
how the package *proves* things, plus one real inventory gap (finding 1). All 7 are disposed below,
each against the reviewer's own cited file:line, per program-wide guidance recorded in
`docs/plans/waves/DECISIONS.md` (W9AS-PARK/W10A-PARK/W10B-PARK): a criterion asserting runtime
behavior must observe that behavior; structural checks are legitimate only for facts with no
runtime observable.

1. **Inventory incomplete, not mechanically derived** (`POST /api/xai/search` absent;
   `routes/xai.ts:253,268,317`). Fixed two ways: the missed route was added to the frozen table
   (impact 2, S9XF-2); and CXF-1 gained a genuine mechanical whole-tree discovery pass
   (`discoverFetchReachingRoutes`) that walks every route-registration file and fails on any
   fetch-reaching route outside the frozen set, independent of the curated tables. Running that
   pass found a SECOND real miss on its own — `POST /api/xai/oauth/complete` — direct evidence the
   fix generalizes past the one route named. The duplicate-registration check's same-file blind
   spot (`dupCheck.get(key) !== target.file`) was also fixed to flag on any repeat, same file or
   not.
2. **Runtime protection inferred from gameable source shape.** Two sub-defects, fixed differently
   on purpose. (a) Guard classification (whether a P0 row's control actually fires) is now
   RUNTIME-OBSERVED: CXF-6 boots the real production daemon (`bootIsolatedDaemon`) and issues a
   live HTTP probe with the caller-controlled field pointed at a loopback canary, passing only when
   the canary sees zero connections and the response status is a declared refusal — per the binding
   rule, this was NOT closed by adding more AST conditions. (b) Exposure classification's dead-code
   bug (`classifyRouteExposure`'s final fallback read `isLocalSameOriginReachable(body) ? 3 : 3` —
   both branches identical, so the reachability check could never change the outcome) is a genuine
   coding defect in a mechanism the program has never required to become runtime (the ingest
   tranche's own exposure classifier is the reused precedent) — fixed with a new positive grammar
   case (`matchLocalSameOriginGuard`) for the real shape (`routes/media.ts:619`,
   `routes/xai.ts:253`), not new AST conditions layered onto the gameable part.
3. **CXF-8 tautological.** It recomputed score/tier from its own internal frozen-constants map and
   compared that computation against itself — a row's `riskScore` was never read. Now reads each
   attribution row's own declared `riskScore` and checks it against the mechanical verdict; CXF-3
   was reordered to run first so `attribution` exists when CXF-8 needs it. The frozen-floor
   contradiction (`check-link`/both `media/generate`/both `live-artifacts/refresh` rows frozen at
   impact 3 while matching the stated impact-2 definition verbatim) is corrected to 2 in S9XF-2's
   table — **a scoring judgment call, flagged for the coordinator's confirmation, not silently
   asserted as the only possible reading; see the report accompanying this round.**
4. **Endpoint-test lane unsatisfiable as leased, cheaply bypassed.** `discoverSsrfTestFiles` now
   matches the lease's own new prefix patterns (`mcp-oauth-*`/`deploy-check-link-*`/
   `external-fetch-*`) in addition to the legacy exact filenames. `routeAssociationTerms` now
   excludes generic path segments (`api`/`tools`/`projects`/`assets`/`v1`/`v2`) that previously let
   any test containing "api" satisfy any row. `.only(` is now source-scanned directly. CXF-5's
   new-control check no longer skips the entire replay requirement when the containing file did not
   exist at all at baseCommit (it used to silently exempt a genuinely brand-new file, the opposite
   of the rule's intent).
5. **CXF-6/CXF-7 didn't implement their stated evidence; CXF-7 unsatisfiable.** CXF-6 is
   redesigned per finding 2 above. CXF-7's route-key matching is now exact backtick-token equality,
   never substring `.includes()` (which made "exactly one bullet" impossible for `POST /api/brands`,
   a literal prefix of its own five nested sibling routes); citation-checking (the bullet must also
   cite the row's expected reference) was added — it did not exist before. **The "paired
   accept/reject" evidence is now split across two criteria** (CXF-5's real-passing-test requirement
   supplies "accept," CXF-6's live probe supplies "reject") rather than built as one self-contained
   pair inside CXF-6 — **a design choice made because a live "accept" probe would need a reachable
   real public host, which an isolated verifier should not depend on; flagged for the coordinator's
   confirmation, not silently asserted as the only possible reading.**
6. **Review/accepter identities spoofable.** Accepted-risk block parsing is now bounded to its own
   heading span (`parseAcceptedRiskBlocks`, ported from the W9-agent-spawn reference the DECISIONS.md
   record names as sound), never sliced to end-of-file; every field (not only `Route`) is
   placeholder-checked; `Accepter` is checked against a non-founder-identity denylist. CXF-10 now
   placeholder- and denylist-checks both `reviewer` and `model` (round 1 checked neither
   meaningfully), expands the owned-path list to include `routes/chat.ts` and every test file, and
   requires the review record itself to be ABSENT at `reviewedCommit` (proving it was authored
   strictly afterward, never bundled with the state it claims to review).
7. **Replay teardown violated the binding safety rule.** The replay runner is no longer a blocking
   `sh()` call — `spawnWithProcessTreeTracking` polls the full descendant process tree WHILE the
   process runs (not a single snapshot taken after the fact, which would miss a grandchild
   outliving an already-reaped parent), and `confirmProcessTreeStopped` requires zero remaining
   PIDs via `@open-design/platform`'s own `stopProcesses` (SIGTERM-then-SIGKILL escalation, ported
   from `verify-w10f.ts`, the pattern DECISIONS.md names as proven). A failed/partial teardown now
   fails the replay outright and PRESERVES the temp worktree (never deletes evidence out from under
   a failure). `git worktree remove`'s result is checked, not discarded. The same infrastructure
   backs CXF-6's own daemon teardown, verified live this round (see "Verified baseline").

## Round 2 rulings (coordinator, confirmed)

Three items were escalated to the coordinator rather than decided unilaterally — the two flagged
judgment calls in "Round 1 dispositions" above (findings 3 and 5a) and the CXF-11 probe-design
question raised while absorbing S9XF-7. All three are now ruled.

**Ruling 1 — CXF-11 probe design (stub `globalThis.fetch` inside the real booted daemon):
approved, with five conditions, all implemented and empirically verified this round (see "Verified
baseline"):**
1. *The stub must be the ONLY deviation, proven empirically, not assumed.* CXF-6's probe-infra
   self-check now fires `POST /api/library/ingest` against the sentinel accept-probe URL and reads
   `fetch-stub interception proven=true` back over the telemetry side-channel BEFORE trusting any
   other accept-probe result — real evidence this round, not a source-reading assumption.
2. *Assert the observable consequence, not an API call.* CXF-11 measures `bytesEnqueued` on a
   demand-driven `ReadableStream` (`pull()` only fires when the consumer asks for more), so the
   number is a direct measure of what `fetchRemoteBytes` actually consumed, whether or not it calls
   an explicit `cancel()`.
3. *Ship a negative control.* This round's own run, against the CURRENT unfixed
   `fetchRemoteBytes`, is that negative control — CXF-11 failed, with `bytesEnqueued` reaching the
   full hard safety cap (see "Verified baseline" for the captured evidence). A synthetic buggy
   stand-in was considered and rejected as weaker evidence than the real defect the finding named.
4. *State the seam plainly.* Both CXF-6's and CXF-11's recorded evidence text open with an explicit
   `[SEAM: ...]` marker naming exactly what is stubbed and confirming the route/guard/handler are
   real production code.
5. *Ship a positive control in the SAME run, not only a negative control.* A criterion that only
   ever exercises the oversized/reject case cannot distinguish a genuinely discriminating fix from a
   measurement mechanism that always reports "unbounded" (or a fix that overzealously cancels every
   transfer, in-bounds or not) — either bug would be indistinguishable from the outside using the
   negative control alone. CXF-11 sends a second sentinel through the identical
   route/guard/`fetchRemoteBytes` path — a genuinely in-bounds 12 KiB transfer, also declaring no
   `Content-Length` — and requires it to complete untouched (full expected byte count, no
   cancellation, real `200` from the daemon) in the SAME probe run as the negative control. This
   round's own run demonstrates both: the oversized transfer failed/bounded AND the ordinary transfer
   passed untouched (see "Verified baseline" for the captured evidence of both).

**Ruling 2 — Finding 3 (impact 3→2 correction): direction confirmed. Coverage-loss disclosure, as
required:**

Computed by reading each affected route's actual auth gate directly (`grep`/`Read` against
`apps/daemon/src/routes/deploy.ts` and `routes/media.ts`, not a hand-computed guess) and applying
`score = exposure + impact` before and after the correction:

| Route | Exposure (mechanism) | Impact before → after | Score before → after | Tier before → after |
|---|---|---|---|---|
| `POST /api/projects/:id/deployments/:deploymentId/check-link` | 3 (no gate found in `deploy.ts`) | 3 → 2 | 6 → 5 | P0 → **P0 (no change)** |
| `POST /api/projects/:id/media/generate` | 0 (`isLocalSameOrigin` veto) | 3 → 2 | 3 → 2 | P2 → **P2 (no change)** |
| `POST /api/tools/media/generate` | 1 (`authorizeToolRequest`) | 3 → 2 | 4 → 3 | **P1 → P2 (drops)** |
| `POST /api/live-artifacts/:artifactId/refresh` | 0 (`requireLocalDaemonRequest`) | 3 → 2 | 3 → 2 | P2 → **P2 (no change)** |
| `POST /api/tools/live-artifacts/refresh` | 1 (`authorizeToolRequest`) | 3 → 2 | 4 → 3 | **P1 → P2 (drops)** |

Three of the five rows do not change tier at all — `check-link` stays P0 either way (6→5, both
inside the P0 5–6 band), and the two `isLocalSameOrigin`/`requireLocalDaemonRequest`-gated rows stay
P2 either way. **Two rows genuinely drop, both tool-token-gated: `POST /api/tools/media/generate`
and `POST /api/tools/live-artifacts/refresh`, P1 → P2.** The concrete consequence: S9XF-4's live
SSRF probe requirement (CXF-6) applies only to P0 rows, so these two lose the requirement for a live
runtime proof that their guard fires against an escaping target, falling back to CXF-5's
cited-passing-test-only bar. Both routes are reachable by anything holding a valid tool token, not
only the trusted local UI, and both carry caller-editable-baseUrl-class SSRF exposure — this is
disclosed for the coordinator's own judgment on whether the P0/P1 threshold or the tool-token
exposure floor needs amending, not decided here.

**Ruling 3 — Finding 5a (accept/reject split): accepted, with CXF-6 now carrying a positive
control in the same probe (implemented this round, see CXF-6's row above and "Verified
baseline").** The stubbed-transport seam Ruling 1 approved resolved the original objection (a live
public accept target being impractical for an isolated verifier) — the positive control uses the
same seam, not a real public host.

## Confirm-round dispositions (fix round 2)

The **confirm round** (an independent verifier-audit pass, distinct from the implementer-facing
"Round 1"/"Round 2" review above) returned **NOT CONFIRMED**, 5 findings against
`scripts/waves/verify-w9-external-fetch.ts` (CR-1 through CR-4 BLOCKING, CR-5 LOW). All 5 are
disposed below, each against the confirm round's own cited file:line. This is fix round 2 against
that confirm pass — the program's stop rule escalates this wave after two consecutive
non-CONFIRM/non-APPROVE verdicts, so this round closes every finding rather than leaving any open.

1. **CR-1 (BLOCKING) — CXF-11's `bounded` predicate checked only an upper byte ceiling, so a
   pre-fetch rejection delivering zero bytes, or a fix that silently truncates and still returns
   `200`, would both false-green.** Fixed: `bounded` now requires three signals jointly —
   `flowed` (`leak.bytesEnqueued > 0`, so a zero-delivery rejection cannot pass), the pre-existing
   ceiling check (`stayedUnderCeiling`), and `terminatedByBound` (`leak.sawCancel === true` **AND**
   the daemon's own response status is **not** `200` — a silent "truncated-200" is now a structurally
   failing outcome, not merely absent from the old check). The positive control already required
   exact byte count + `200` + no cancellation; unchanged.
2. **CR-2 (BLOCKING) — the empirical fetch-interception self-check (`stubInterceptionProven`) gated
   only CXF-6; CXF-11 booted its own daemon and never consumed it, which is the root cause of CR-1's
   zero-delivery false-green (an unproven stub reading all-zero telemetry could still pass on
   arithmetic alone).** Fixed: the self-check is now a shared `proveStubInterception(daemon)`
   function, called independently by BOTH CXF-6 and CXF-11 in each criterion's OWN booted daemon —
   never inherited from a sibling criterion's boot. If CXF-11's own self-check fails, both transfer
   probes are SKIPPED (not merely failed) and the criterion fails outright; skipping also prevents
   the ok-probe sentinel URL from falling through to a REAL live network call if the stub seam is
   broken.
3. **CR-3 (BLOCKING) — boot/teardown process-control verdicts imported
   `packages/platform/dist/index.mjs`, a gitignored (`.gitignore`'s `dist/` line), untracked bundle
   checked only for existence, not commit-bound.** Fixed by removing the import entirely (no file in
   `packages/platform` — `dist` or `src` — is imported anywhere in the verifier now), per the confirm
   round's own instruction that this is a verifier-side wrap/replace, not a product change. The
   verifier now manages every subprocess it spawns itself, self-contained (see CR-4).
4. **CR-4 (BLOCKING) — teardown failed open (`packages/platform/src/process.ts` converts process-
   enumeration errors into an empty `[]` snapshot, so "no survivors" could mean "`ps` silently
   failed") and only individually-tracked PIDs were signalled, never the process GROUP.** Fixed
   verifier-side, matching `scripts/waves/verify-w9-filesystem.ts`'s `killGroupFailClosed` semantics
   exactly (that file's own docblock has the full rationale): every daemon/replay-runner subprocess
   now spawns `detached: true` (own process group, pgid === its own pid on POSIX); teardown signals
   the WHOLE GROUP (`process.kill(-pgid, signal)`), escalates SIGTERM → SIGKILL on GROUP EMPTINESS
   confirmed via a fresh group-wide `ps -Ao pid=,pgid=,comm=` scan (never leader-liveness alone); and
   a failed `ps` invocation returns a non-empty sentinel survivor entry, so every `.length === 0`
   check treats a broken scan as "still has survivors" — fails the run, never silently reads as
   "nothing survived". **Product-side implementation criterion, recorded per the confirm round's
   instruction rather than fixed in product code (out of scope — implementation has not started):**
   when `packages/platform` is eventually touched by product work, `stopProcesses` should gain a
   process-group-aware variant, and `listProcessSnapshots`'s enumeration-failure branch should surface
   the failure to its caller instead of silently returning `[]`; this verifier's own teardown no
   longer depends on either, so this is a code-quality/defense-in-depth note for whoever next owns
   `packages/platform`, not a gate on this tranche.
5. **CR-5 (LOW) — the PRD's "exactly two sentinel URLs" wording overclaimed: the stub also
   intercepts every CXF-6 accept-prefix URL (intentional per Ruling 3).** Corrected in "Explicitly
   out of scope"/S9XF-7's prose above and in CXF-11's success-criteria row: the stub is now described
   as two EXACT sentinel URLs for CXF-11 itself, plus every URL under CXF-6's accept-probe prefix via
   the same shared runner — not "exactly two" in total.

**Verification performed this round:** the verifier was run at least twice against this tree;
`pnpm guard` and `pnpm typecheck` both exit 0; the process-group teardown's happy path showed zero
survivors on both runs; a controlled sub-test with `ps` shadowed to fail confirmed the fail-closed
path actually fails the run rather than reading a broken scan as "no survivors" (see the run's own
report for the captured evidence line and exact commit shas — this document does not restate
per-run output, matching "Verified baseline"'s own convention of only recording an actually-executed
run's real captured text). Protected default-namespace daemons (ports 7456/51012, PIDs matching that
namespace) were confirmed untouched, both before and after.

## Adversarial review

**Round 1 returned REJECT** (7 blocking findings, disposed above). Round 2 also absorbed one
additional routed finding (S9XF-7/CXF-11) and three coordinator rulings (see "Round 2 rulings"
above). **The subsequent confirm round returned NOT CONFIRMED twice** (5 findings the first time;
disposed in "Confirm-round dispositions" above, fix round 2) — none of the review/confirm passes
above constitute a green light to implement; it has not yet been re-reviewed/re-confirmed. Per
`W5-W11-gated.md`'s expansion gate, this document must be reviewed by a
reviewer who did not author it and will not implement it, and both this document and
`scripts/waves/verify-w9-external-fetch.ts` must be frozen on `main` before any `/goal` run against
this slug begins. Known residuals the author flags proactively, so a reviewer does not have to
rediscover them:

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
  tree, and the 33-route frozen table is self-consistent), which is further along than the ingest
  tranche's own PRD was at this identical pre-implementation stage. The guard-tier classifier (new
  this tranche, not ported) has also been exercised and found the real, above-noted limitation —
  arguably stronger evidence than an untested claim would be, but the limitation is real and open.
- `S9XF-4`'s `GUARDED` grammar and `S9XF-3`'s replay/citation machinery are new anchored grammars,
  not reused verbatim strings — they follow the same anti-gaming shape the ingest tranche's
  ceremony arrived at after multiple rounds, but have not themselves been through that ceremony. A
  reviewer should specifically probe them for the same class of gap the ingest tranche's ceremony
  found in its own first attempts (unbound substring matches, permissive prose patterns, recursive-
  descent guard detection that finds a guard call inside dead code).
