# Daemon threat model

**Program scaffolding context:** written for wave W0
(`docs/plans/waves/W0-substrate.md`, NM-21C). Verified mechanically by
`scripts/waves/verify-w0.ts` C0-8: every caller class below must appear in a
heading, and every bullet under "Defenses and mitigations" must carry a
`[C0-N]` tag citing the exact `fullName` of a test that PASSED in the
verifier's own run of the daemon suite. An unenforced defense claim is a
`VERIFICATION-CONTRACT.md` §3 R5 violation, so a bullet with no passing test
behind it is a documented gap instead (see "Known gaps" below), never a
defense claim.

## Caller classes

The daemon binds to loopback (127.0.0.1) by default. Every caller reaching
`/api/*` falls into one of these classes.

### Web UI

The bundled Next.js frontend (`apps/web`), served same-origin from the
daemon's own port (or a `tools-dev` proxy). Same-origin requests always
carry a loopback `Origin` header the daemon recognizes.

### od CLI

`apps/daemon/src/cli.ts` (`od …`). Resolves the daemon's base URL
(`daemon-url.ts`) and issues plain `fetch()` calls with no `Origin` header at
all — Node's `fetch` never sets one for non-browser callers. The daemon
treats an absent `Origin` header as a trusted local caller (see
`apps/daemon/src/http/local-daemon-request.ts`) — this is a deliberate
design choice, not an oversight, and it is also the exact caller shape
`POST /api/backup` / `POST /api/restore` and the `od backup` / `od restore`
CLI must both succeed against per this wave's UI/CLI parity requirement.

### Clipper extension

The browser extension (`chrome-extension://…` / `moz-extension://…`
origin). A web page cannot forge this origin, but origin alone is not
identity — any *installed* extension, paired or not, can present it. The
capability-token system (`apps/daemon/src/library-tokens.ts`,
`apps/daemon/src/security/library-token-lifecycle.ts`) binds a minted token
to the specific origin it was issued to, so origin-shape plus a
origin-bound token together stand in for identity. See `[C0-5]`/`[C0-6]`.

### External agent

A code agent (Claude, Codex, …) driving `od` from inside a chat run, or an
MCP client. Reaches the daemon the same way the CLI does (loopback, no
`Origin` header) or through a scoped tool token
(`apps/daemon/src/tool-tokens.ts`, `authorizeToolRequest`) for the
`/api/tools/*` surface — out of this wave's scope beyond noting it exists.

### Malicious local process

Any other process running as the same OS user, with no browser sandbox and
no `Origin` header of its own choosing (it can set an `Origin` header to
literally anything, since it isn't a browser enforcing same-origin policy).
This is the class the daemon's current threat model does **not** defend
against at the HTTP layer, because it is indistinguishable from the `od CLI`
/ `external agent` classes at the network level — both are unauthenticated
loopback connections with no `Origin` header. See "Known gaps" below; this
is documented as an accepted limitation, not silently ignored.

### Malicious web page

A page loaded in the user's ordinary browser, attempting to reach the
loopback daemon via `fetch`/`XHR`/`<img>`/DNS-rebinding. The browser
*always* attaches a real `Origin` header for such cross-origin requests
(`https://evil.example.com`, or `null` for a sandboxed context) — it cannot
spoof a loopback or extension origin. `[C0-7]` covers this class directly.

## Defenses and mitigations

Every bullet cites the exact test `fullName` (as reported by the daemon
Vitest suite's JSON reporter) that enforces it — recomputed by the verifier
against the current run, not asserted from memory.

- [C0-1] A backup archive's contents are real and byte-identical to the source, verified by restoring into a fresh data root and re-fetching every sampled file over the daemon's own HTTP API: `backup/restore engine round-trips real projects: restored DB rows resolve to byte-identical files via HTTP (C0-1)`
- [C0-2] The snapshot is atomic under concurrent mutation (SQLite's real online-backup API, not a file copy; a file uploaded after backup completion never appears in the restored snapshot): `backup/restore engine is atomic under a concurrent writer: a post-backup file never appears in the restored snapshot (C0-2)`
- [C0-3] Restore verifies per-class integrity and refuses a corrupted archive, naming the specific corrupted class: `backup/restore engine rejects a corrupted sqlite-database entry, naming the class, and does not touch the destination (C0-3)`
- [C0-4] Secret classes (MCP server tokens, connector OAuth credentials, local BYOK provider keys) never appear anywhere in the archive; app-config is archived only after those keys are stripped from it (full classification in docs/security/backup-secret-inventory.json): `backup/restore engine excludes secret classes from the archive and strips BYOK keys from the archived app-config (C0-4)`
- [C0-5] Clipper ingest (POST /api/library/ingest) requires a capability token bound to the presenting extension's own origin, not just an extension-shaped Origin header: `POST /api/library/ingest — capability token identity binding (C0-5/C0-6) (C0-5/accept) accepts a paired extension origin presenting its own bound token`
- [C0-6] Tokens are non-transferable: a token replayed from an origin other than the one it was minted for is rejected: `POST /api/library/ingest — capability token identity binding (C0-5/C0-6) (C0-6/replay) rejects a token replayed from a DIFFERENT extension origin than it was minted for`
- [C0-6] Revocation takes effect immediately, on independent per-token lifecycles: `library token revoke / rotate (C0-6) (C0-6/revoke) revocation takes effect immediately: the revoked token is rejected on its very next use`
- [C0-6] Rotation invalidates the old token while a freshly issued token for the same identity keeps working: `library token revoke / rotate (C0-6) (C0-6/rotate) rotation invalidates the prior token AND issues a working new one bound to the same identity`
- [C0-7] Privileged routes (inventoried in apps/daemon/src/security/privileged-routes.json) reject a request carrying a non-loopback Origin header — the malicious web page / DNS-rebinding class, which cannot forge a loopback origin: `POST /api/backup + POST /api/restore (C0-7) rejects a cross-origin (non-loopback) backup request`

## Known gaps

- **Malicious local process, HTTP-layer.** A local process with no `Origin`
  header is indistinguishable from the `od CLI` / `external agent` classes
  at the network layer, and the daemon's existing design
  (`apps/daemon/src/http/local-daemon-request.ts`) treats an absent
  `Origin` header as trusted for exactly that reason — `POST /api/backup`
  and `POST /api/restore` (this wave's own new routes) must accept that
  exact shape of request to satisfy the CLI/HTTP parity requirement (`od
  backup create` / `od restore` and their HTTP counterparts are both
  Origin-less loopback callers). This is true of all 24 pre-existing
  `requireLocalDaemonRequest`-guarded routes in the codebase today, not a
  regression introduced by this wave; closing it product-wide would need a
  new, stricter guard applied consistently across every privileged route,
  most of which are outside this wave's write lease
  (`docs/plans/waves/leases.json`, W0). See the wave's completion report for
  the full reproduction and file list.
- **`POST /api/library/pair/confirm` and the zero-config extension
  allowlist — FIXED.** `apps/daemon/src/origin-validation.ts`'s
  `isZeroConfigClipperLibraryRequest` originally only auto-trusted
  `GET /library/clipper-probe` and `POST/OPTIONS /library/ingest` from an
  extension-shaped origin, not `/library/pair/confirm` — so a genuine
  cross-origin `chrome-extension://…` pairing request was rejected by the
  global `/api` origin gate before it ever reached
  `registerLibraryRoutes`'s handler, even though the route's own comment
  always documented the exemption. Closed by a W0 lease amendment
  (`docs/plans/waves/DECISIONS.md`, 2026-07-27): the allowlist now covers
  `POST`/`OPTIONS /library/pair/confirm` too, on the same reasoning as
  `/library/ingest` (an extension-shaped `Origin` header cannot be forged
  by a web page; the route's real authorization is the short-lived pairing
  code inside `confirmPairing`, not the origin check). `[C0-5]`/`[C0-6]`
  above are now verified against the real end-to-end bootstrap transport, not
  a workaround:
  `POST /api/library/pair/confirm — real cross-origin bootstrap transport > (C0-5/mint) a genuine not-yet-paired chrome-extension Origin header can mint a token via pair/confirm`.

## Wave 9

Library-ingest route-hardening tranche (`docs/plans/waves/W9-ingest-tranche.md`).
`registerLibraryRoutes` (`apps/daemon/src/routes/library.ts`) exposes 23
`GET`/`POST`/`DELETE`/`OPTIONS` registrations under `/api/library/*` and
`/api/tools/library/*`; the complete mechanically-generated attribution for
every one of them — owner, authentication class, authorization, input
validation, and size/rate-limit resolution — lives in
`docs/security/library-ingest-attribution.json`, one row per route, never
duplicated here. This section covers only the three routes this tranche's own
risk-ranking (score `exposure + impact`) rates P0: routes with no route-level
authorization gate of their own (`exposure === 3`) whose impact floor pushes
the combined score to 5 or 6.

Every gap this section closes had no dedicated volume or rate control on this
route surface at all before this tranche (ground fact: "There is no request-
or byte-volume control on any `/api/library/*` route"). The remaining 20
routes are either already loopback- or token-gated, or — for the five reads
that previously relied solely on the global `/api` origin middleware (asset
detail, raw bytes, the Figma sidecar, the element sidecar, and the live
events feed) — are now explicitly loopback-gated via
`requireLocalDaemonRequest`, matching this file's own documented split
("reads ride the daemon's loopback binding ... like the rest of `/api`").
Both classes of change, and the read-only routes that remain intentionally
gate-free by design (the pre-pairing `clipper-probe` probe, and every
`OPTIONS` preflight), are attributed in the JSON matrix; this section's own
bullets are reserved for the mechanically-verified P0 rows.

- [C9-6] POST /api/library/pair/confirm closes the pairing-code brute-force window this tranche's ground facts identified (a 6-digit code with no attempt counter, reachable pre-pairing from any extension-shaped origin): a bounded per-process pairing-attempt counter (5 attempts / 60s, pairConfirmAttemptOk in routes/library.ts) rejects any confirm attempt past the limit with 429: `the pair confirm attempt past the 5 attempt limit gets 429`
- [C9-6] POST /api/library/ingest closes the clipper/token caller class's previously-uncapped dataUrl/text payload gap (LIBRARY_UPLOAD_MAX_BYTES applies only to manual-upload, and a URL-sourced fetch's own cap does not apply to dataUrl/text bodies): an explicit byte-volume cap (5,000,000 bytes, CLIPPER_INGEST_MAX_BYTES in routes/library.ts) rejects an oversized clipper payload with 413: `a clipper ingest payload past the 5000000 byte limit: reject with 413`
- [C9-6] GET /api/library/assets closes its per-caller reconcile-trigger exposure (the route's own reconcile-on-list throttle, RECONCILE_THROTTLE_MS, is program-wide, not per-caller, and the route itself carries no gate of its own): a bounded per-origin request-rate limit (20 requests / 10s, assetsListOk in routes/library.ts) rejects a caller over the limit with 429: `a library assets list request past the 20 request limit gets 429`

## Wave 4

Local project covers (`docs/plans/waves/W4-project-covers.md`). This wave
touches two DOM-embedding surfaces that render untrusted, user-authored
project HTML inline in the workspace: the design-grid card thumbnail
(`apps/web/src/components/project-cover.tsx`, `DesignsTab.tsx`,
`RecentProjectsStrip.tsx`) and DesignsTab's separate live-artifact preview
tile (`apps/web/src/components/DesignsTab.tsx:788-800`).

### NM-35C — deliberate `allow-same-origin` omission on the live-artifact iframe

`DesignsTab.tsx`'s live-artifact thumbnail mounts the project's own rendered
HTML in a real, live `<iframe sandbox="allow-scripts" ...>`
(`DesignsTab.tsx:792-799`, `src={liveArtifactPreviewUrl(p.id, artifact.id)}`).
The sandbox token list is `allow-scripts` alone — `allow-same-origin` is
**deliberately not granted**, and must never be added back without a
documented threat-model change here. The two tokens combine dangerously:
`allow-scripts` alone lets the framed document execute JavaScript, but
because the iframe has no `allow-same-origin`, the browser treats its
origin as opaque (`null`) — script inside the frame can run, but it cannot
read or write the parent document, cannot access the parent's cookies,
storage, or same-origin fetch credentials, and cannot claim the daemon's
own origin for its outbound requests. Granting `allow-same-origin`
alongside `allow-scripts` on a frame whose `src` serves attacker-controlled
project content would let that script escape the sandbox entirely: it could
reach into the parent document via `window.top`, read `localStorage`/
`document.cookie` under the daemon's real origin, and issue same-origin
`fetch()` calls carrying the operator's own session — i.e. exactly the
"script + parent-origin access" combination the sandbox attribute exists to
prevent. The omission is intentional and load-bearing, not an oversight.

`project-cover.tsx`'s `HtmlProjectCoverFrame` (the OTHER embedding surface
this wave introduces, covering the design-grid card thumbnail and the
recent-projects strip) goes further and avoids the iframe question
entirely: it never mounts a live document at all. It points a plain
`<img src=... />` at the daemon's own pre-rendered, pre-cropped PNG
(`GET /api/projects/:id/cover`) and falls back to a static glyph via
`onError` when no cover exists yet. Browsers never parse image bytes as
HTML/script regardless of what the URL resolves to, so this surface carries
no `sandbox`/`allow-same-origin` question at all — the constraint above
applies specifically to the still-live `DesignsTab.tsx` iframe.

