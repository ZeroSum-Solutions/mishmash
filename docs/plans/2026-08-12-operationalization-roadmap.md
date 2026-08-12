# MishMash operationalization roadmap

**Status:** Approved direction; implementation is gated below  
**Date:** 2026-08-12  
**Owners:** Product, engineering, operations, security, and counsel where named

## Outcome

Turn the current local-first, web-only MishMash fork into a fast, lightweight,
team-operable product without risking project data or representing unfinished
commercial, legal, or multi-tenant foundations as production-ready.

This plan deliberately separates:

- work that is safe to execute now;
- product and platform work that needs measured acceptance evidence;
- decisions that require counsel, hosting, or commercial sign-off.

Internal pricing research, contract drafts, credentials, customer data, and
host-specific recovery details are not part of this public repository.

## Current evidence

### Foundations already present

- The product is a Next/React web application served by the local daemon; the
  daemon serves the exported web build directly (`apps/daemon/src/server.ts:2637`).
- Workspace usage accounting has a real daemon aggregation path and a shared
  API contract (`apps/daemon/src/runtimes/usage-tracking.ts:407`,
  `packages/contracts/src/api/workspace-usage.ts:14`). This is telemetry, not a
  sellable credit ledger or billing admission system.
- Provider-specific CLI environment configuration exists
  (`apps/daemon/src/app-config.ts:407`). It is a local application preference,
  not tenant-isolated BYO-AI credential custody.
- Accessibility work has a declared WCAG 2.2 AA engineering floor
  (`craft/accessibility-baseline.md:35`) and automated audit/routing components.
- The project has an application-aware backup/restore command and a local
  SQLite/WAL data model.

### Confirmed gaps or risks

- Browser source maps are enabled in production
  (`apps/web/next.config.ts:166`) and the daemon serves the static export. A
  previously generated export was about 79 MB, of which about 58 MB was source
  maps. A fresh baseline is required before treating those figures as current.
- Project-file refreshes walk and sort the project tree before applying `since`
  (`apps/daemon/src/projects.ts:191`), while the web client does not send a
  `since` cursor (`apps/web/src/providers/registry.ts:1505`). Large imported
  projects and edit storms therefore have an avoidable O(project files) path.
- Excalidraw is statically imported and prewarmed after an idle callback or
  600 ms fallback (`apps/web/src/components/SketchEnginePrewarm.tsx:1`). The
  prewarmer is unconditionally mounted by the file workspace
  (`apps/web/src/components/FileWorkspace.tsx:3227`).
- Postgres is a deliberate resolver stub; SQLite is the only reachable daemon
  database (`apps/daemon/src/storage/daemon-db.ts:1`). Project storage exposes
  an adapter, but current routes do not use it
  (`apps/daemon/src/storage/project-storage.ts:1`). Multi-replica and object
  storage claims are therefore out of scope until those seams are real.
- No persisted organization, membership, project-grant, reseller, end-client,
  maintenance-mode, commercial credit, cancellation, or global suppression
  model is present in the current database schema.

## Approved product decisions

These decisions are the working defaults. A later written owner decision may
replace them.

1. **One shared backend, two experiences.** Developer Studio and Customer
   Builder share projects and artifacts but have explicit capability boundaries.
2. **Project-grant authorization.** Do not model every human as only
   owner/editor/viewer. Use internal operator, reseller organization admin/member,
   and end-client maintenance user, each constrained by project grants.
3. **Remote terminal is privileged.** PTY and arbitrary agent-tool execution are
   internal-operator capabilities, disabled for reseller and end-client roles.
4. **Credits are admission control.** Usage telemetry may inform the ledger, but
   a request must reserve estimated units before expensive work begins, reconcile
   actual use afterward, and stop cleanly at configured limits.
5. **BYO-AI is isolated custody.** Provider credentials must be scoped to the
   organization or project, encrypted through the selected host's secret system,
   redacted from diagnostics, and revocable. Local `agentCliEnv` is not the hosted
   design.
6. **Maintenance mode is a product boundary.** It permits content, image, and
   narrowly defined style changes. New pages, structural regeneration, broad
   code edits, provider administration, and terminal access require an explicit
   upgrade or internal handoff.
7. **Accessibility floor is WCAG 2.2 AA.** Product surfaces and generated sites
   must pass automated gates plus keyboard and screen-reader acceptance checks.
8. **Single writer first.** The first hosted cutover is one daemon instance on a
   persistent volume. Multi-replica/Postgres/object-storage work is a later
   migration after route parity and restore testing.
9. **Self-contained starter set first.** Preserve a small offline-capable template
   set. Moving large media to lazy object delivery is a separate product and
   licensing decision with an explicit cache/offline contract.
10. **Legal gates remain real gates.** Approval of this roadmap does not approve
    contract language, scraping behavior, auto-renewal terms, outbound-email
    operations, asset licenses, or jurisdiction-specific compliance.

## Execution sequence

### Phase 0 — Recovery and repository truth

**State:** completed locally on 2026-08-12; retain evidence outside Git.

- Create and restore-verify an application-aware backup.
- Create and verify a Git bundle containing every local branch and tag.
- Snapshot the complete runtime data root while the daemon is stopped; confirm
  file-count and checksum parity and run the application's SQLite integrity check.
- Keep the unresolved MotionSites branch parked. It contains explicit `DO NOT
  LAND` checkpoints and additional template/media candidates that require visual,
  provenance, and license review.
- Retire only branches whose production change is present on `main` or whose test
  was intentionally superseded. Never use commit-count comparison as proof.

**Exit evidence:** recoverable bundle; restore report; checksum parity; clean
working tree; healthy daemon after restart.

### Phase 1 — Performance baseline and low-risk weight reduction

1. Produce a checked-in performance ledger from a clean Node 24 build:
   - exported JS/CSS/map bytes, raw and compressed;
   - route/capability chunk attribution;
   - 20 cold daemon starts with readiness time and startup RSS;
   - project-file API tests at 1k, 10k, and 50k files;
   - mobile Lighthouse plus real iOS Safari and Android Chrome runs.
2. Stop serving production browser source maps:
   - upload maps to the selected symbolication service when configured;
   - strip maps from the static export before the daemon can serve it;
   - add a CI assertion that the served export contains zero `.map` files.
3. Split the web shell at route and capability boundaries. Load marketplace,
   settings, project, theater, file workspace, and editor graphs only on intent.
4. Make Excalidraw JS, CSS, fonts, and canvas intent-loaded. Disable prewarming on
   phones, background tabs, data-saver connections, and low-memory devices; remove
   prewarming entirely if measurement shows no worthwhile benefit.
5. Add an indexed per-project file metadata path seeded once and updated by
   watcher deltas. Preserve periodic and reconnect reconciliation for missed
   events.
6. Measure daemon startup stages. Move non-readiness-critical recovery and heavy
   optional capability loading after listen, without reporting ready until writes
   are safe.
7. Classify local disk data before cleanup:
   - regenerable: dependencies, build exports, stale test/tool scratch;
   - durable: database/WAL, projects, runs, user templates, brands, design systems,
     credentials, and imported external roots.
   Apply a TTL/quota only to confirmed regenerable scratch.

**Initial budgets to ratify after the fresh baseline:**

| Surface | Target |
| --- | --- |
| Daemon ready | p50 <= 1.5 s; p95 <= 3 s over 20 cold starts |
| Startup RSS | <= 250 MB before browser/render/agent workers |
| Project files, 10k corpus | p95 <= 1 s cold; <= 200 ms warm |
| One watcher delta | p95 <= 100 ms; <= 100 KB response; no full rewalk |
| Initial web shell | <= 500 KB gzip JS; <= 150 KB gzip CSS |
| Project/chat cumulative | <= 900 KB gzip JS; no chunk > 250 KB gzip |
| Static export | zero served source maps |
| Mobile p75 | LCP <= 2.5 s; INP <= 200 ms; CLS <= 0.1 |

**Exit evidence:** reproducible ledger, budgeted CI, real-device receipts, and no
optional editor/render/export package fetched before user intent.

### Phase 2 — Team identity, authorization, and audit foundation

1. Write threat model and data classification before exposing the daemon.
2. Add organizations, users, memberships, project grants, sessions, invitations,
   and immutable audit events.
3. Implement the three audience families from Decision 2, default-deny at API
   boundaries, with negative authorization tests for every privileged route.
4. Put identity and TLS at the gateway, but revalidate authorization in the
   daemon. Do not rely on hidden URLs or client-side controls.
5. Add rate limits, CSRF/session protections, secure headers, structured security
   events, secret redaction, and short-lived/revocable sessions.
6. Publish a team onboarding runbook: shallow/partial clone, Node 24/pnpm setup,
   local data-root rules, backup/restore, development commands, and escalation
   ownership.

**Exit evidence:** cross-tenant isolation tests, privilege-negative tests, audit
records for sensitive actions, session revocation, and a clean-laptop onboarding
rehearsal by someone other than the implementer.

### Phase 3 — Commercial credits and BYO-AI

1. Define immutable credit ledger entries, reservations, reconciliation,
   idempotency keys, refunds, adjustments, and operator-visible audit history.
2. Add preflight estimation and a hard admission circuit breaker before expensive
   model, browser, render, or media work.
3. Treat current workspace usage as observability input only; do not mutate it
   into the accounting source of truth.
4. Build hosted BYO-AI credential records against the selected secret manager.
   Never return secret values after creation; provide test, rotate, and revoke.
5. Enforce organization/project scope, provider allowlists, usage attribution,
   diagnostic redaction, and deletion/offboarding behavior.

**Exit evidence:** concurrency-safe ledger tests, no negative balance or duplicate
charge under retries, clean over-limit refusal, secret rotation/revocation, and no
credential material in logs or diagnostics exports.

### Phase 4 — Product channels and maintenance handoff

1. Implement Customer Builder as a capability-scoped experience over the shared
   project model.
2. Add explicit image-upload consent at every AI-image submission boundary and
   retain the minimum necessary consent record.
3. Implement maintenance-mode policy in both API and UI; include upgrade/handoff
   paths for structural requests.
4. Build reseller organization management, client invitations, project handoff,
   billing ownership indicators, and offboarding export.
5. Add cancellation flows at launch; terms, renewal copy, notice windows, and
   retention behavior require counsel approval before production.
6. Keep competitor research to permitted public evidence and abstract design
   patterns. Any per-customer automated collection requires access-policy,
   provenance, rate-limit, retention, and counsel gates.
7. Treat outbound email as a separately gated service with verified sender setup,
   consent/lawful-basis records, unsubscribe handling, a global suppression list,
   rate controls, and operational monitoring.

**Exit evidence:** role-specific end-to-end tests, maintenance boundary tests,
consent records, client handoff/offboarding rehearsal, and signed counsel and
operations checklists for every enabled regulated channel.

### Phase 5 — Hosting and migration

1. Resolve the hosting target's OS/architecture, persistent-volume and snapshot
   semantics, single-instance guarantees, SSE/proxy timeouts, PTY and child-process
   support, native dependencies, secret manager, egress, cold-start limits, and
   backup/restore facilities.
2. If the target cannot run trusted local agent CLIs, PTYs, browser/render workers,
   and native media dependencies safely, use a split architecture: hosted
   web/API/identity plus a registered trusted worker. Do not conceal this as a
   lift-and-shift.
3. Inventory every imported project's external `baseDir`; materialize or remap it
   during migration instead of copying only the primary data root.
4. Rehearse a fenced single-writer cutover:
   - block new writes and runs;
   - take a WAL-safe backup/snapshot;
   - checksum the complete data set;
   - restore and run integrity/path checks;
   - verify create -> run -> artifact -> download and SSE reconnect;
   - cut over the stable URL with a tested rollback snapshot.
5. Do not enable multi-replica, Postgres, or object storage until all routes use
   the adapters, shadow/read parity passes, consistency semantics are defined,
   and restore tests succeed.

**Exit evidence:** RPO 0 during fenced cutover, 100% checksum manifest match,
clean SQLite integrity check, zero unresolved project paths, rollback <= 15
minutes, and a 30-minute SSE/network-switch soak.

## Counsel and owner decision register

The following items block production enablement but do not block engineering
prototypes behind local feature flags:

| Decision | Required owner | Blocking scope |
| --- | --- | --- |
| Pricing, included usage, overage, refunds | Product and finance | Paid launch |
| Contract, reseller, hosting, transfer, cancellation language | Counsel | Customer/reseller contracting |
| Automated competitor research policy | Counsel and security | Per-customer collection |
| Outbound email basis, consent, suppression, sender operation | Counsel and operations | Managed outreach |
| AI image consent copy and retention | Counsel and product | Customer AI-image upload |
| Template/media provenance and redistribution | Rights owner and counsel | New catalog publication |
| Hosting target and trust boundary | Engineering, security, operations | Remote access and migration |
| Maintenance limits and upgrade policy | Product and support | Customer handoff |

Draft legal templates and benchmarking notes are inputs for counsel, not approved
terms and not evidence of compliance.

## Workstream ownership and change discipline

- Each phase uses an isolated branch/worktree and owns explicit paths.
- Performance work lands as small measured changes: source-map handling, lazy
  capability loading, file indexing, then startup isolation.
- Identity/authorization lands before reseller, end-client, billing, or remote
  exposure work.
- Migration adapters land behind shadow verification and rollback controls.
- Every pull request states the fixed baseline, changed budget, commands run,
  expected result, and unavailable evidence.
- Destructive cache cleanup, branch deletion, history rewriting, data migration,
  public deployment, and licensed-asset publication always retain a recoverable
  checkpoint and exact target list.

## Definition of operationally sound

MishMash is operationally sound when:

- a new team member can set up, run, test, back up, and restore it from the
  runbook;
- CI enforces bundle, accessibility, authorization, and data-safety budgets;
- optional capabilities do not tax the initial shell or daemon readiness path;
- every remote user action is authenticated, authorized, attributable, and
  revocable;
- commercial usage cannot begin without a successful reservation and cannot
  exceed configured policy silently;
- maintenance users cannot escape their project or capability boundary;
- a clean-host restore and rollback rehearsal passes with evidence; and
- counsel- and rights-gated features remain disabled until their signed gates are
  attached to the release record.
