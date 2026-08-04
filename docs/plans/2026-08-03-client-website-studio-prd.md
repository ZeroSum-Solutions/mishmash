# Client Website Studio PRD

Status: W6a-P freeze candidate; frozen only when commit-bound manifest passes

Owner: MishMash

PRD authoring branch: `codex/design-interface-product-program`

Authoring base: `main@67dc91bab9da95ad7f6bf3da0238535296d17352`

Historical draft snapshot, not dispatch authority: `origin/main@941be4f15fe9a0fef0a76b53cd3b1aab1e6bb7bd`; workspace-canvas, the founder-waived W4 landing, and the W6a-P founder decision are present

Dispatch authority: the fresh preflight and final approval receipts whose hashes are pinned by the separately granted `waves["W6a-P"]` lease entry

Date: 2026-08-03

## 1. Purpose

MishMash will add a guided Client Website workflow that turns a structured business brief, owned source material, and inspiration references into a normal MishMash project. The output uses the existing editor, versions, design systems, Library, agent runs, and deployment adapters.

This program does not create a second editor, site runtime, design catalog, telemetry stack, or publishing subsystem.

## 2. Audit ruling

The notes were audited against the live codebase and reviewed adversarially by Grok 4.5. Grok returned `VERDICT: REVISE` because the original notes implied capabilities that MishMash does not safely or honestly provide today.

The PRD adopts these rulings:

| Product note | Ruling | PRD treatment |
|---|---|---|
| Stylistically and functionally aligned website | EXTEND | Generate a normal project from an approved brief and references. The target, client brief, and project design system remain the design authority. |
| Edit every aspect | EXTEND with corrected claim | Support the existing content, media, link, container, style, layout, spacing, border, version, and agent-edit paths. Surface unsupported targeting cases. Do not claim universal editability. |
| Manual changes or agent-generated options | EXTEND | Use agent runs, HTML versions, restore, and GenUI choices. Do not create another editor. |
| Easy Update | NEW | Add a review-first update packet with proposed placements, diffs, per-proposal decisions, atomic apply, and rollback. Never auto-deploy. |
| Hosting and one fee | DECISION, rejected for MVP | Keep current customer-owned Vercel and Cloudflare deployment. Do not claim managed hosting or one-fee hosting. |
| Website performance and visitor reporting | NEW, gated | Define a separate privacy brief after deployment is stable. Do not reuse MishMash telemetry. Do not promise visitor identity or inferred demographics. |
| Similar-company and competitor research | EXTEND | Use cited research and reference review. Do not score undefined “success,” copy trade dress, or use competitor prose as source copy. |
| Business/person name and site type | EXTEND | Persist in `ClientWebsiteBrief`. |
| Import an owned website selectively | EXTEND | Record ownership or license, allowed use, and take/leave instructions. Use existing brand and Library intake in MVP. |
| Inspiration URLs with annotations | EXTEND | Persist URL and annotation as reference metadata. Fetch only through existing approved paths. |
| Pinterest-like moodboards | NEW | Add boards and pins that reference existing Library items, uploads, and Design Browser captures. Arbitrary remote pin capture is out of MVP. |
| Clickable vibe presets | EXISTING | Reuse the existing visual style catalog and question form. |
| Requested pages and advice | EXTEND | Store requested and recommended pages. Require confirmation before generation. |
| Color schemes and this-or-that | EXTEND | Reuse Palette/Tweaks, design-system revisions, GenUI choices, and HTML versions. Persist the decision history. |
| DJ's choice / House Music | NEW | Add a versioned decision policy that selects from existing design inputs and explains its choice. It is a process policy, not a MishMash house aesthetic. |
| Temporary copy without source copy | EXTEND with hard gate | Generate original, labeled placeholder copy from category topics and structure. Block production deployment until placeholders are replaced or explicitly approved. |

## 3. Existing foundations

The implementation must reuse these live surfaces:

- Manual editing and versions in `apps/web/src/components/FileViewer.tsx`, `ManualEditPanel.tsx`, and `apps/daemon/src/routes/project/index.ts`.
- Visual style choices in `apps/web/src/runtime/visual-style-catalog.ts` and `QuestionForm.tsx`.
- Palette and global tweaks in `PaletteTweaks.tsx` and `design-templates/tweaks/`.
- Design-system routes in `apps/daemon/src/routes/design-systems.ts`.
- Brand extraction in `apps/daemon/src/brand-routes.ts` and `apps/daemon/src/brands/`.
- Design Browser references and captures in `DesignBrowserPanel.tsx`.
- Research search in `apps/daemon/src/research/`.
- Library ingestion and source provenance in `apps/daemon/src/library*` and `apps/daemon/src/routes/library.ts`. Generic Library rights and license fields do not exist yet.
- GenUI `form`, `choice`, and `confirmation` artifacts in `apps/daemon/src/routes/genui.ts`.
- Agent runs in `apps/daemon/src/routes/runs.ts`.
- Vercel and Cloudflare deployment in `apps/daemon/src/deploy.ts` and `apps/daemon/src/routes/deploy.ts`.

## 4. Goals

### G1. Durable website brief

Persist the information required to generate and revise a client website without relying on chat history.

### G2. Rights-aware source and inspiration model

Record where every reusable source came from, what the user permits, and whether the item is owned, licensed, reference-only, or unknown.

### G3. Guided generation into the existing project model

Turn an approved brief into ordinary versioned project files that open in the existing FileViewer workflow.

### G4. Reversible preference and variation workflow

Let users compare bounded options, record decisions, restore prior versions, and request alternatives.

### G5. Review-first Easy Update

Turn new accolades, photos, and business changes into explicit proposals that the user controls.

### G6. Preserve current deployment ownership

Deploy through the existing customer-owned provider configuration. Keep managed hosting, billing, and site analytics behind separate decision gates.

## 5. Non-goals

- A new visual editor, source-code IDE, or component runtime.
- A Webflow-like motion timeline, keyframe editor, or per-element GSAP timing interface.
- Managed multi-tenant hosting, domain ownership, quotas, overages, or one-fee commercial packaging.
- Customer-site analytics in the MVP.
- Arbitrary URL crawling, browser capture, or pinning outside the current safe paths.
- Automatic competitor ranking by “success.”
- Competitor copy, assets, layout, or trade dress copied into generated sites.
- A second vibe catalog, brand extractor, research engine, deployment route, or telemetry system.
- Automatic deployment after generation or Easy Update.
- Silent placement or overwrite of user content.
- Universal “edit every aspect” marketing claims.

## 6. Product model

### 6.1 ClientWebsiteBrief

```ts
type ClientWebsiteBriefStatus = "draft" | "ready" | "generating" | "generated" | "archived";

interface ClientWebsiteBrief {
  id: string;
  projectId?: string;
  version: number;
  status: ClientWebsiteBriefStatus;
  displayName: string;
  siteType: string;
  requestedPages: WebsitePageRequest[];
  recommendedPages: WebsitePageRecommendation[];
  sourceReferences: WebsiteSourceReference[];
  inspirationReferences: InspirationReference[];
  activeDesignSystemId?: string;
  inspirationDesignSystemIds: string[];
  visualStyleIds: string[];
  decisionLog: WebsiteDecision[];
  houseMusicPolicyVersion?: string;
  placeholderCopyPolicy: "block-production";
  createdAt: string;
  updatedAt: string;
}
```

The final contract may refine field names, but it must preserve these semantics. A draft brief exists before its project. Generation creates the normal project and assigns `projectId` in the same successful transaction that moves the brief into `generated`; a failed generation leaves `projectId` unset and the brief recoverable.

### 6.2 Reference rights

```ts
type ReferenceRights = "owned" | "licensed" | "reference-only" | "unknown";
type AllowedUse = "copy" | "image" | "brand-token" | "structure" | "topic" | "visual-reference";

interface WebsiteSourceReference {
  id: string;
  sourceType: "url" | "library-item" | "upload" | "design-browser-capture";
  sourceValue: string;
  rights: ReferenceRights;
  allowedUse: AllowedUse[];
  ownershipAttestedAt?: string;
  takeInstructions: string[];
  leaveInstructions: string[];
  capturedAt?: string;
  contentHash?: string;
}
```

Generation must refuse `copy` and `image` reuse when rights are `reference-only` or `unknown`.

### 6.3 Inspiration boards

An `InspirationBoard` belongs to one project. An `InspirationPin` references an existing Library item, upload, or Design Browser capture. Pins support notes, tags, order, and provenance. A text-only external URL may be stored as an annotation, but creating a pin must not fetch it in MVP.

### 6.4 Decisions and variations

MVP variations use named HTML file versions and existing GenUI choice responses. A decision records the compared version IDs, chosen version, optional rejection notes, and timestamp. Non-HTML whole-project versioning is out of scope.

### 6.5 Easy Update packet

An `EasyUpdatePacket` contains typed inputs and generated proposals. Each proposal names target files and sections, includes a preview or diff, and has `pending`, `accepted`, `rejected`, or `alternative-requested` state. Apply is atomic. Rollback restores the pre-apply HTML versions. Deployment is a separate user action.

## 7. User flows

### 7.1 New client website

1. User selects Client Website.
2. User enters business identity, site type, pages, and optional source site.
3. The system records permission and take/leave rules before using source copy or images.
4. User adds references and annotations from existing safe sources.
5. User chooses existing vibe cards and design systems, or selects House Music.
6. The system proposes page recommendations and temporary-copy status.
7. User confirms the brief.
8. The agent generates a normal project with HTML files and source metadata.
9. The project opens in the existing FileViewer edit path.

### 7.2 This or that

1. The system presents a bounded pair of existing palette, type, layout-version, or design-system options.
2. The user chooses one, rejects both, or asks for alternatives.
3. The GenUI response and brief decision log persist the result.
4. The selected option applies through existing design-system, tweak, or version APIs.

No step may introduce a motion timeline or per-element GSAP authoring control.

### 7.3 House Music

House Music v1 is a versioned process policy:

- Use the target, client brief, and active project design system in that order.
- Select from the existing visual style catalog and current project references.
- Prefer clear information hierarchy, readable typography, accessible contrast, responsive layouts, and restrained motion.
- Do not invent metrics, credentials, clients, awards, or testimonials.
- Do not reuse competitor copy, assets, or distinctive trade dress.
- Show the chosen direction and rationale. Let the user override it.
- Pin the policy version on the brief so future policy changes do not rewrite prior decisions.

Policy ID: `house-music/v1`.

Canonical policy path: `docs/policies/house-music/v1.md`.

### 7.4 Easy Update

1. User uploads or enters accolades, photos, and business changes.
2. The system classifies the inputs and proposes placements.
3. User reviews file and section targets, preview/diff, and provenance.
4. User accepts, rejects, or requests an alternative for each proposal.
5. The system applies accepted proposals in one transaction and records pre-apply versions.
6. User may roll back. The site is not deployed automatically.

## 8. Temporary copy policy

- Temporary copy must be original text generated from the brief and category topics.
- Research sources may inform topic coverage and information structure, not phrasing.
- Temporary fields must carry machine-readable placeholder metadata.
- Preview deployment may warn and continue.
- Production deployment must fail while placeholders remain unless the user records explicit approval for each remaining placeholder.
- The UI and CLI must report the blocking placeholder paths.

## 9. Architecture

### 9.1 Capability closure

Every new user-facing capability must ship together across:

1. Pure DTOs in `packages/contracts`.
2. Daemon HTTP routes and persistence.
3. Web UI.
4. `od` CLI with `--json` and `--prompt-file` where input can be long.
5. `SUBCOMMAND_MAP` and capability-manifest parity.
6. Focused tests and the wave verifier.

### 9.2 Proposed domains

- `packages/contracts/src/api/client-websites.ts`
- `apps/daemon/src/routes/client-websites.ts`
- `apps/daemon/src/client-websites/`
- `apps/web/src/components/client-websites/`
- `od website ...` CLI namespace
- `docs/policies/house-music/v1.md`
- `apps/daemon/src/backup/manifest.ts` and `apps/daemon/src/backup/create.ts` because C6A-06 establishes foundation-record backup/restore, C6A-08 adds boards and pins, and C6A-19 adds update packets
- `apps/daemon/src/deploy.ts` and `apps/daemon/src/routes/deploy.ts` for the placeholder production gate, after the W6a-S merge-base lease and live-worktree overlap gates pass

The exact file split may change after red tests, but the domain must remain cohesive. The web app cannot import daemon source.

### 9.3 Persistence

Persist briefs, references, boards, pins, decisions, and Easy Update packets under the resolved daemon data root through the existing database layer. Do not place runtime state in the repository or recompute a data root. Each owning tranche must add its records to backup and restore before exposing that tranche; W6a-E must then prove the aggregate record set, including rights attestations, round-trips into one fresh data root.

### 9.4 External operations

- MVP site import uses existing brand and Library paths.
- MVP research uses the existing research provider path.
- MVP deploy uses existing provider adapters and customer credentials.
- External failures must leave the brief and project in a recoverable state.
- Secrets must remain in the existing credential/config boundary, never project metadata, logs, prompts, or argv.

## 10. Security, privacy, and licensing

- Rights and allowed use are required before copy or image reuse.
- Reference-only and unknown sources may inform visual review but cannot supply copy or assets.
- Inspiration pins do not create a new network fetch surface.
- Arbitrary capture requires a separate threat model covering SSRF, DNS rebinding, redirects, private networks, resource limits, timeouts, workers, iframes, queues, and deletion.
- Customer-site analytics must use a separate site identity, store, consent model, retention policy, export path, and deletion path. It cannot reuse MishMash product telemetry.
- Default analytics, if later approved, is aggregate visits, sessions, referrers, devices, time, performance, and approximate geography. No identity or inferred demographics by default.
- GSAP remains code-generation infrastructure. The existing global motion multiplier is the visual-control ceiling without written Webflow consent.

## 11. Commercial and gated decisions

These decisions do not block the MVP because the MVP adopts the safe default shown below.

| Decision | MVP ruling | Future gate |
|---|---|---|
| Hosting ownership | Customer-owned Vercel or Cloudflare account | Managed hosting requires tenancy, domain, abuse, support, SLA, quota, rollback, and credential architecture. |
| One-fee claim | Prohibited | Requires measured model, research, hosting, analytics, support, and overage economics. |
| Rights storage | Brief/reference records in Client Website domain | Promoting rights fields into generic Library requires a separate migration and compatibility decision. |
| House Music ownership | Checked-in `house-music/v1` process policy | Visual doctrine changes require an explicit product decision and new version. |
| Placeholder deploy gate | Hard block for production, warning for preview | Any relaxation requires an explicit decision and audit trail. |
| Site analytics | Deferred | Requires privacy/controller/retention/DPA brief and deploy integration design. |
| Arbitrary remote capture | Deferred | Requires W6b security PRD and independent threat review. |

## 12. W6a acceptance criteria

This PRD expands the existing W6a `client-website` skeleton. It does not reuse the occupied W0 through W5 names. Every criterion below has one owner in Section 13.

### C6A-01 Program freeze

The checked-in W6a PRD contains the note classification, safe defaults, non-goals, criterion map, proposed leases, verifier names, model-routing rules, and an adversarial register whose rows contain non-empty `id`, `severity`, `file`, `claim`, `repro`, and `disposition` fields. `verify-w6a-plan.ts` parses the register and fails if any required section, register field, criterion owner, immutable approval/preflight receipt, prerequisite-evidence field, or receipt/artifact hash is missing or inconsistent. The plan becomes frozen only when the commit-bound W6a-P proof manifest passes this exact contract.

### C6A-02 Brief surface parity

The same brief can be created, read, updated, validated, and archived through HTTP, web UI, and `od website`. CLI JSON round-trips without losing fields, and long instructions accept `--prompt-file <path|->`.

### C6A-03 Durable onboarding

Business identity, site type, requested pages, confirmed recommendations, source permissions, take/leave instructions, inspiration annotations, selected style IDs, design systems, decisions, and policy version survive a daemon restart.

### C6A-04 Rights enforcement with paired controls

The verifier submits two otherwise identical sources. `owned` with an attestation and `copy` permission succeeds. `reference-only` is refused with the rights-specific error code. The refusal path must not create project copy or image files.

### C6A-05 Source import safe-fetch closure

Owned-site import routes through the existing safe-fetch boundary. A loopback or private-range URL is refused for the SSRF-specific reason, while a controlled public fixture succeeds. The negative and positive controls use the same intake route.

### C6A-06 Foundation backup and restore

Backup followed by restore into a fresh data root round-trips every record introduced by W6a-F: briefs, source and inspiration references, rights and ownership attestations, decisions, selected style and design-system IDs, and House Music policy IDs and hashes. The verifier compares normalized rows and source hashes. This criterion does not claim coverage for boards, pins, or Easy Update packets before their owning tranches land.

### C6A-07 House Music stability

Selecting House Music pins the content hash and ID from `docs/policies/house-music/v1.md`. Reopening and regenerating the same brief uses the same policy defaults. A new policy file cannot alter existing briefs without an explicit brief migration.

### C6A-08 Inspiration board closure

HTTP, web, and CLI create a board, add three valid existing artifact references, annotate and reorder them, restart the daemon, and read the same order and metadata. Backup followed by restore into a fresh data root must also reproduce the boards, pins, order, annotations, tags, and provenance exactly.

### C6A-09 No board fetch surface

Creating, annotating, reordering, or removing a pin produces zero outbound network calls under a test-wide dispatcher intercept that records every HTTP and HTTPS attempt, including indirect calls. A nonexistent Library or Design Browser capture ID fails. A text-only URL annotation persists without fetching. The same intercept must fail the test if its positive-control request is not observed.

### C6A-10 Existing design-choice reuse

An AST check proves the Client Website UI imports the canonical `visual-style-catalog.ts` and invokes existing Palette/Tweaks or design-system APIs. The W6a diff may not add another module exporting a style-catalog-shaped collection or another general-purpose editor entry point.

### C6A-11 Normal project output and enumerated edits

The same approved brief can start generation through HTTP, web UI, and `od website generate`; all three surfaces return the same generation and project identifiers. CLI JSON round-trips without losing fields, and long generation instructions accept `--prompt-file <path|->`. Generation creates ordinary MishMash HTML project files that open in FileViewer. Focused tests exercise content, media, link, container, style, layout, spacing, and border edits, plus agent edit, HTML version creation, and exact-byte restore.

### C6A-12 Honest unsupported-edit failure

A generated fixture element that cannot be resolved through the live `data-od-id` or `data-od-label` targeting path returns a visible unsupported-edit error, writes no source bytes, and creates no version. The PRD does not call this a source-map failure.

### C6A-13 Variations

A request for three alternatives produces three named HTML versions. The GenUI response records the compared versions and selected version. Restoring each version reproduces its exact stored bytes.

### C6A-14 Placeholder schema

`packages/contracts` defines the placeholder metadata format used by generation, UI, CLI, preflight, and the verifier. The same parser reads a generated fixture and reports file, field or element, status, and approval record.

### C6A-15 Placeholder deploy behavior

A preview deployment with placeholders emits the same structured warning through HTTP, web UI, and CLI. A production deployment fails through all three surfaces with the placeholder-specific error and exact file and field or element locations. Replacing or explicitly approving every placeholder makes the same production preflight pass. CLI JSON preserves every blocking location.

### C6A-16 Deployment-ownership copy scan

An AST/JSX string smoke scan over user-facing runtime and CLI-help files checks the phrases `one fee`, `one monthly price`, `hosting included`, `flat fee hosting`, `we host`, `managed hosting`, `edit every aspect`, `who visited`, and `clone what works`. The W6a runtime diff introduces zero matching claims. Plans, tests, and negative-control fixtures are excluded. This enumerated scan is not proof against rephrasing; the independent Opus review must separately inspect the complete W6a user-facing copy diff for equivalent claims.

### C6A-17 Customer-analytics isolation

Generated fixture HTML and generator templates contain no PostHog, analytics SDK initialization, or customer-event injection added by W6a. The verifier checks the generated corpus and template sources. It does not claim to prove all possible runtime egress.

### C6A-18 GSAP control ceiling

The W6a route inventory is unchanged for motion-authoring routes. An AST check over added W6a components finds no exported timeline, keyframe, easing, or duration editor. W6a does not modify the existing global motion multiplier.

### C6A-19 Easy Update decisions

The same update packet can be created, reviewed, decided, and applied through HTTP, web UI, and `od website update`. CLI JSON preserves proposal IDs, states, target files, and errors, and long update material accepts `--prompt-file <path|->`. A packet with three changes produces three explicit proposals. Accepting two and rejecting one lands only the accepted proposals. Backup followed by restore into a fresh data root reproduces the packet, proposals, decisions, target files, errors, and provenance. No deployment route is called.

### C6A-20 Easy Update atomic failure

A forced failure after the first proposed write leaves every target file at its pre-apply bytes, preserves pre-apply versions, and records the packet as failed. A repeat without failure applies all accepted proposals once.

### C6A-21 End-to-end recovery matrix

The integration verifier covers four external failures: owned-site brand fetch failure, research provider failure, agent-run crash during generation, and deployment-provider failure. Each case preserves the brief, leaves project files recoverable, reports a domain-specific error, and permits retry without duplicate records. In the same integration run, one populated aggregate fixture spanning foundation records, boards and pins, decisions, generated project state, and Easy Update packets must back up and restore into a fresh data root with normalized row equality and matching source hashes. This is composition proof over the tranche-owned restore behaviors, not a second owner for C6A-06, C6A-08, or C6A-19.

### C6A-22 Program proof closure

Every W6a criterion has a non-empty proof artifact and a review verdict from a model other than the implementer. The W6a evidence index is registered in the program verification contract before W6a is called complete.

### C6A-23 Deterministic token application and rollback

The guided flow extracts deterministic `DesignTokens` through the existing brand engine, shows the proposed tokens before apply, and applies the confirmed tokens to a user-selected existing reference through the existing design-system apply action. A forced apply failure leaves the target reference, active design-system revision, and project files at their exact pre-apply state. Retrying after the failure applies once.

### C6A-24 Document and upload token entry

HTTP, web UI, and `od website tokens` each accept an owned document reference and an owned uploaded asset as token inputs without routing through arbitrary URL capture. The resulting token proposal records source provenance and rights, requires confirmation, and enters the same C6A-23 apply path. CLI long input accepts `--prompt-file <path|->`.

### Lease criteria

Each executable W6a tranche owns a criterion named `C6A-<tranche>-LEASE`. Its verifier reads `docs/plans/waves/leases.json` at the merge base and fails when the changed-path set exceeds the granted allowlist. Prose in this PRD never substitutes for the lease.

## 13. W6a execution map

| Tranche | `/goal` slug | Gates | Loop | Criteria | Verifier |
|---|---|---|---|---|---|
| W6a-P Plan freeze | `mishmash-w6a-plan-freeze` | Founder decision landed; exact approval and preflight contract green with receipt hashes pinned in the separately granted `waves["W6a-P"]` lease entry; W2 retained gate accepted; W3 ancestry recorded without claiming independent proof; W4 accepted through the exact 15/15 or founder-waived 13/15 path below; W5 status recorded but may be `not-landed`; active-lane audit clear | audit → Grok review → draft → Fable review → revise → commit-bound freeze gate | C6A-01, C6A-P-LEASE | `scripts/waves/verify-w6a-plan.ts` |
| W6a-F Foundation | `mishmash-w6a-foundation` | W5 landed, which transitively requires W3 and W1; W4 landed; workspace-canvas change remains landed; lease granted on fresh main | red specs → DeepSeek implementation → Opus review → mechanical proof | C6A-02 through C6A-07, C6A-F-LEASE | `scripts/waves/verify-w6a-foundation.ts` |
| W6a-B Boards | `mishmash-w6a-boards` | W6a-F landed; board lease granted | red specs → DeepSeek implementation → Opus review → mechanical proof | C6A-08, C6A-09, C6A-B-LEASE | `scripts/waves/verify-w6a-boards.ts` |
| W6a-G Guided generation | `mishmash-w6a-generation` | W6a-F and W6a-B landed; generation lease granted | red specs → DeepSeek implementation → visual check → Opus review → mechanical proof | C6A-10 through C6A-13, C6A-17, C6A-18, C6A-23, C6A-24, C6A-G-LEASE | `scripts/waves/verify-w6a-generation.ts` |
| W6a-S Placeholder safety | `mishmash-w6a-placeholder-safety` | W6a-G landed; merge-base lease scan and live-worktree overlap report are both clear for exact deploy paths; W6a-S lease granted | red specs → DeepSeek implementation → Opus review → mechanical proof | C6A-14 through C6A-16, C6A-S-LEASE | `scripts/waves/verify-w6a-placeholder-safety.ts` |
| W6a-U Easy Update | `mishmash-w6a-easy-update` | W6a-G landed; update lease granted | red specs → DeepSeek implementation → failure injection → Opus review → mechanical proof | C6A-19, C6A-20, C6A-U-LEASE | `scripts/waves/verify-w6a-easy-update.ts` |
| W6a-E Integration | `mishmash-w6a-integration` | W6a-S and W6a-U landed; fresh integration lease | failure matrix → browser run → Opus review → program proof gate | C6A-21, C6A-22, C6A-E-LEASE | `scripts/waves/verify-w6a-integration.ts` |

W6a-S and W6a-U may execute in parallel only after W6a-G lands and only when their granted leases are disjoint. All earlier tranches are serial because they require shared registration files. No tranche can be marked complete before UI, HTTP, CLI, persistence, tests, and lease closure land together.

W6b arbitrary capture, customer-site analytics, managed hosting, and W8 Selector remain separate programs. They do not inherit W6a scope.

## 14. Proposed lease grants

These are proposed allowlists, not active authority. The orchestrator grants each entry by updating `docs/plans/waves/leases.json` on fresh main only after the tranche gates pass. Each verifier reads the granted entry from its merge base.

### W6a-P

- `docs/plans/2026-08-03-client-website-studio-prd.md`
- `docs/plans/waves/W6a-client-website.md`
- `scripts/waves/verify-w6a-plan.ts`

The W6a-P ceremony order is exact and non-circular:

1. The founder-decision commit is already landed on `origin/main`.
2. Off-main, create the reviewed plan candidate commit containing the PRD, this dispatch contract,
   and `verify-w6a-plan.ts`; complete the final Fable review and approval receipt against that
   commit.
3. Immediately before the lease grant, fetch `origin/main` and generate the dispatch preflight.
   Its `originMain` is this **pre-lease audited commit**.
4. The orchestrator creates a separate, single-parent lease/hash commit whose parent is that
   pre-lease audited commit, whose diff changes exactly `docs/plans/waves/leases.json`, and whose
   `waves["W6a-P"]` entry has exactly the three-file allowlist above plus
   `approvalReceiptSha256`, `dispatchPreflightReceiptSha256`, `reviewAttemptSha256`, and
   `reviewAttemptResultSha256`.
5. Create W6a-P from the lease/hash commit, transplant the exact three reviewed blobs, commit them,
   and run `verify-w6a-plan.ts`. W6a-P cannot edit `DECISIONS.md`, `leases.json`, the gated
   skeleton, or the program verification contract.

The founder decision and lease/hash grant are therefore separate orchestrator commits. The
approval, preflight, one-shot marker, and terminal-result hashes are known before the lease commit
and do not hash a receipt that claims to have audited the lease commit itself.

#### W6a-P immutable receipt contract

This subsection is the single receipt schema for the PRD, dispatch contract, and verifier. Alternate field names, paths, or generic model assertions do not satisfy it.

The founder-authorized final Fable confirmation is a permanent one-shot operation. After every
local check that can run without Fable has passed—including reviewed-commit, clean-worktree,
reviewed-file, prompt-byte, reviewer-separation, Claude executable/version, sanitized environment,
and live OAuth checks—the runner atomically creates this exact marker
with `O_CREAT | O_EXCL | O_NOFOLLOW`, fsyncs the file, and fsyncs its parent directory immediately
before invoking Claude:

`~/.claude/goal-state/mishmash-w6a-plan-freeze/reviews/final-fable-attempt.json`

```jsonc
{
  "schemaVersion": 1,
  "attemptId": "<UUID v4>",
  "startedAt": "<RFC-3339 timestamp>",
  "reviewedCommit": "<40-hex commit containing all three reviewed plan files>",
  "planAuthor": "<non-empty identity>",
  "reviewer": "<non-empty identity distinct from planAuthor after trim and case-fold>",
  "model": "Fable 5",
  "route": "Claude Code OAuth",
  "reviewedFileSha256": {
    "docs/plans/2026-08-03-client-website-studio-prd.md": "<sha256>",
    "docs/plans/waves/W6a-client-website.md": "<sha256>",
    "scripts/waves/verify-w6a-plan.ts": "<sha256>"
  },
  "reviewPromptPath": "reviews/final-fable-prompt.md",
  "reviewPromptSha256": "<sha256>",
  "sanitizedArgv": ["-p", "--model", "fable", "--output-format", "json"]
}
```

Marker existence permanently spends the authorization. Every later or concurrent runner invocation
must fail before invoking Claude; the marker is never removed, replaced, renamed, quarantined, or
rolled back, including after a crash, timeout, invalid response, write failure, or `REVISE` verdict.
After the marker exists, no code path may perform another Fable invocation for W6a-P.

For every post-marker outcome, the runner exclusively creates, fsyncs, and parent-directory-fsyncs
this canonical terminal result:

`~/.claude/goal-state/mishmash-w6a-plan-freeze/reviews/final-fable-attempt-result.json`

```jsonc
{
  "schemaVersion": 1,
  "attemptId": "<same UUID v4 as final-fable-attempt.json>",
  "completedAt": "<RFC-3339 timestamp>",
  "outcome": "<APPROVE|REVISE|INVALID>",
  "terminalVerdict": "<APPROVE|REVISE|null>",
  "problems": ["<zero or more terminal validation or invocation problems>"],
  "reviewAttemptPath": "reviews/final-fable-attempt.json",
  "reviewAttemptSha256": "<sha256>",
  "reviewPromptPath": "reviews/final-fable-prompt.md",
  "reviewPromptSha256": "<sha256>",
  "rawResultPath": "<reviews/final-fable-raw-result.json|null>",
  "rawResultSha256": "<sha256|null>",
  "oauthInvocationPath": "<reviews/final-fable-oauth-invocation.json|null>",
  "oauthInvocationSha256": "<sha256|null>",
  "sessionTranscriptPath": "<canonical ~/.claude/projects/.../<session_id>.jsonl path|null>",
  "sessionTranscriptSha256": "<sha256|null>"
}
```

`completedAt` must not predate the marker's `startedAt`. `APPROVE` and `REVISE` require the same
`terminalVerdict` and an empty `problems` array; `INVALID` requires at least one problem. Each
nullable path/hash pair is two strings when that artifact is available and two JSON `null` values
when a post-marker failure prevents its capture. The canonical prompt, raw result, sanitized
OAuth invocation receipt, and attempt result are published for `APPROVE` and non-`APPROVE` outcomes
whenever their bytes are available; they are never hidden in a temporary attempt directory. A
terminal `REVISE`, `INVALID`, missing or invalid attempt result, or any invocation/publication
failure after marker creation parks W6a-P with no retry. Only an exact `APPROVE` outcome may create
the approval receipt below.

The approval receipt is exactly:

`~/.claude/goal-state/mishmash-w6a-plan-freeze/proof/final-fable-approval.json`

```jsonc
{
  "schemaVersion": 1,
  "reviewedCommit": "<40-hex commit containing all three reviewed plan files>",
  "planAuthor": "<non-empty identity>",
  "reviewer": "<non-empty identity distinct from planAuthor after trim and case-fold>",
  "model": "Fable 5",
  "route": "Claude Code OAuth",
  "verdict": "APPROVE",
  "blockingFindings": [],
  "reviewedFileSha256": {
    "docs/plans/2026-08-03-client-website-studio-prd.md": "<sha256>",
    "docs/plans/waves/W6a-client-website.md": "<sha256>",
    "scripts/waves/verify-w6a-plan.ts": "<sha256>"
  },
  "reviewPromptPath": "reviews/final-fable-prompt.md",
  "reviewPromptSha256": "<sha256>",
  "reviewAttemptPath": "reviews/final-fable-attempt.json",
  "reviewAttemptSha256": "<sha256>",
  "reviewAttemptResultPath": "reviews/final-fable-attempt-result.json",
  "reviewAttemptResultSha256": "<sha256>",
  "rawResultPath": "reviews/final-fable-raw-result.json",
  "rawResultSha256": "<sha256>",
  "oauthInvocationPath": "reviews/final-fable-oauth-invocation.json",
  "oauthInvocationSha256": "<sha256>",
  "sessionTranscriptPath": "~/.claude/projects/<canonical-project-path>/<raw session_id>.jsonl",
  "sessionTranscriptSha256": "<sha256>"
}
```

`reviewAttemptPath`, `reviewAttemptResultPath`, `reviewPromptPath`, `rawResultPath`, and
`oauthInvocationPath` resolve beneath
`~/.claude/goal-state/mishmash-w6a-plan-freeze/reviews/`; absolute paths, `..`, symlinks escaping
that directory, and alternate files fail closed. `sessionTranscriptPath` must resolve by realpath
to the canonical Claude file `~/.claude/projects/.../<raw session_id>.jsonl`; its basename must be
the raw result's exact `session_id` plus `.jsonl`, and it may not be a copied substitute.
`reviewedCommit` may differ from W6a-P HEAD, but each of the three reviewed-file hashes and blob
bytes must be identical at `reviewedCommit` and W6a-P HEAD. The reviewer must differ from the plan
author.

The review prompt is the UTF-8, LF-only expansion of this exact template. Replace only the four
angle-bracketed values with the approval receipt's lowercase hexadecimal values; every other byte
is literal:

```text
You are the final independent adversarial reviewer for the W6a plan freeze.

Perform a read-only inspection of the three exact committed blobs bound below and verify their claims against the live codebase. Do not trust summaries, receipts, prior verdicts, or the binding block itself as semantic evidence.

Review scope is limited to these two separately enumerated items:
1. F5R-01 through F5R-05 and regressions introduced by their closure.
2. Prerequisite compatibility only: verify the exact PRD W6A_W4_FOUNDER_WAIVER_TUPLE. It may waive only C4-5 and C4-10; it may not waive or change any other W4 criterion, change any other part of W4, or authorize any other wave.

APPROVE only if every blocker is closed and the documented landing ceremony is executable as written. REVISE if any blocker remains, any claimed closure is unsupported, the prerequisite-compatibility item exceeds that exact scope, or the ceremony is not executable.

BEGIN W6A REVIEW BINDING
reviewedCommit: <40-hex reviewedCommit>
docs/plans/2026-08-03-client-website-studio-prd.md: <reviewedFileSha256 value>
docs/plans/waves/W6a-client-website.md: <reviewedFileSha256 value>
scripts/waves/verify-w6a-plan.ts: <reviewedFileSha256 value>
END W6A REVIEW BINDING

End with exactly one terminal line: VERDICT: APPROVE or VERDICT: REVISE.
```

The bytes begin with `You` and end with exactly one LF immediately after the period in
`VERDICT: REVISE.` There is no byte-order mark, leading blank line, trailing blank line, arbitrary
prefix, suffix, or other interpolation. The verifier independently constructs this expansion,
requires byte-for-byte equality before hashing it as `reviewPromptSha256`, and rejects any missing,
duplicate, reordered, value-mismatched, or additional byte.

The raw result is the exact JSON emitted by the Claude Code OAuth invocation. It must satisfy all
of these checks: `subtype === "success"`; `is_error === false`; `stop_reason === "end_turn"`;
`terminal_reason === "completed"`; `result` is a string whose terminal machine verdict is
`VERDICT: APPROVE`; `session_id` is a non-empty canonical Claude session ID;
`permission_denials` is an empty array; and
`modelUsage["claude-fable-5"].canonicalModel === "claude-fable-5"` with
`modelUsage["claude-fable-5"].provider === "firstParty"`. A generic top-level `model` field is not
evidence of this route.

The canonical session transcript SHA-256 must match `sessionTranscriptSha256`. Parse the leading
semantic version from invocation `claudeVersion`—for example, `2.1.221` from
`2.1.221 (Claude Code)`. Any JSONL row carrying `sessionId`, `cwd`, or `version` must match the raw
`session_id`, invocation `cwd`, or parsed leading semantic version respectively. Every user and
assistant row must carry and match all three fields. Queue, attachment, and other auxiliary rows
may omit them, but may not carry a conflicting value. The string user-prompt content must equal the
review-prompt bytes exactly; assistant rows must report model `claude-fable-5`; and the final
assistant `end_turn` text must equal the raw result's `result` string byte-for-byte.

The OAuth invocation receipt at `reviews/final-fable-oauth-invocation.json` is exactly:

```jsonc
{
  "schemaVersion": 1,
  "claudeExecutable": "<absolute executable path>",
  "claudeVersion": "<non-empty version string>",
  "authStatus": {
    "loggedIn": true,
    "authMethod": "claude.ai",
    "apiProvider": "firstParty",
    "subscriptionType": "<max-or-pro>"
  },
  "cwd": "<absolute reviewed-candidate worktree root>",
  "attemptPath": "reviews/final-fable-attempt.json",
  "attemptSha256": "<same sha256 as reviewAttemptSha256>",
  "stdinPath": "reviews/final-fable-prompt.md",
  "stdinSha256": "<same sha256 as reviewPromptSha256>",
  "sanitizedArgv": ["-p", "--model", "fable", "--output-format", "json"],
  "credentialEnvAbsent": {
    "ANTHROPIC_API_KEY": true,
    "ANTHROPIC_AUTH_TOKEN": true,
    "ANTHROPIC_BASE_URL": true,
    "CLAUDE_CODE_USE_BEDROCK": true,
    "CLAUDE_CODE_USE_VERTEX": true,
    "OPENROUTER_API_KEY": true
  },
  "exitCode": 0,
  "rawResultSha256": "<same sha256 as final-fable-approval.json>"
}
```

The verifier hashes the marker, attempt result, raw result, and invocation receipt bytes; checks
those hashes against the approval receipt; validates the raw-result and transcript fields above;
and requires `attemptPath`/`attemptSha256` and `stdinPath`/`stdinSha256` to equal the approval's
marker and prompt path/hash pairs. `claudeExecutable` must equal the realpath of live
`command -v claude`; `claudeVersion` must equal live `claude --version`; `sanitizedArgv` must equal
the five strings above with no extra argument; and all six `credentialEnvAbsent` keys must exist,
be exactly `true`, and be independently absent for the recorded invocation. Any alternate binary,
route flag, credential host, prompt, or session invalidates the approval even when the prose verdict
says APPROVE.

At verification time, the verifier must run the live canonical `claudeExecutable` with exactly
`auth status --json`, require exit zero and valid JSON, and require `loggedIn === true`,
`authMethod === "claude.ai"`, `apiProvider === "firstParty"`, and `subscriptionType` equal to
`"max"` or `"pro"`. The invocation receipt's `authStatus` object records exactly those four
sanitized fields and must equal the four-field projection of that live result. Raw auth output,
tokens, account identifiers, and all other auth fields must not be persisted. This live check
supplements rather than replaces the transcript and credential-environment proofs above.

The dispatch preflight is exactly:

`~/.claude/goal-state/mishmash-w6a-plan-freeze/proof/dispatch-preflight.json`

```jsonc
{
  "schemaVersion": 1,
  "fetchedAt": "<RFC-3339 timestamp>",
  "fetchCommand": ["git", "fetch", "--prune", "origin", "main"],
  "fetchExitCode": 0,
  "originMain": "<freshly fetched pre-lease 40-hex commit>",
  "activeWorktrees": [
    { "path": "<absolute path>", "head": "<40-hex>", "branch": "<ref or detached>", "changedPaths": ["<repo-relative path>"] }
  ],
  "activePlanPathIntersections": ["<worktree>:<one of the three W6a-P lease paths>"],
  "founderDecision": {
    "decisionCommit": "941be4f15fe9a0fef0a76b53cd3b1aab1e6bb7bd",
    "decisionPath": "docs/plans/waves/DECISIONS.md",
    "decisionHeading": "W6a-P stop-rule escalation: one final confirmation and same-session `/goal`",
    "decisionBlobSha256": "2f68aaee08405e8de8b55515f9aab9473f4e4a2a3167fbbe1916dad4bef025ef",
    "decisionSectionSha256": "ecc2957947ad39159e45e6323f4697a89bed229d5531165231312da5a9a7ea19"
  },
  "w2": {
    "status": "landed-with-retained-gate",
    "baseCommit": "1ac53c1591fd853cae6891e81637248acecac3cb",
    "candidateCommit": "fe1a34584fb0c4d615fcc4919c715e6136d6ef03",
    "landedCommit": "8c1b6225b54a0ff8471c765c76e772058600cd7d",
    "approvedGateCommitPath": "~/.claude/goal-state/mishmash-w2-brand-honesty/approved-gate.commit",
    "approvedGateCommitFileSha256": "54a206112d2dae369852b7696e501ca2588a342a2db2386a6002d139090f35e5",
    "approvedGateSha256Path": "~/.claude/goal-state/mishmash-w2-brand-honesty/approved-gate.sha256",
    "approvedGateSha256FileSha256": "c94d89dccfc89881d55315d4035def0defd66961fd6cb749251c4d8f46f69241",
    "approvedVerifierPath": "~/.claude/goal-state/mishmash-w2-brand-honesty/approved-verify-w2.ts",
    "approvedVerifierSha256": "c866b0838cb95277a5e0f435346d640ebc81e3af05af1555e44c90d2ebd87e85",
    "transcriptPath": "~/.claude/goal-state/mishmash-w2-brand-honesty/proof/gate-of-record-fe1a34584-run4.txt",
    "transcriptSha256": "b5ba0749396171e1df860c6577edcefdebb411ce99e9839f452ca542560a81e7",
    "candidateChangedPathCount": 129,
    "landingExtraPaths": [
      "tools/pack/tests/launcher-payload.test.ts",
      "tools/pack/tests/mac-identity.test.ts",
      "tools/pack/tests/mac-lifecycle.test.ts",
      "tools/pack/tests/win-identity.test.ts"
    ]
  },
  "w3": {
    "status": "landed-without-goal-proof",
    "landedCommit": "2435edb2e282242ccea8fb2f0ae7d214738a4e26"
  },
  "w4": {
    "status": "landed-verified",
    "candidateCommit": "<40-hex>",
    "baseCommit": "<40-hex>",
    "landedCommit": "<40-hex>",
    "landingParentCommit": "<sole 40-hex parent of landedCommit>",
    "landingExtraPaths": ["<explicit path changed only by landedCommit>"],
    "manifestPath": "~/.claude/goal-state/mishmash-w4-project-covers/proof/manifest.json",
    "manifestSha256": "<sha256>",
    "manifestSchemaSha256": "<sha256 of verifier-frozen canonical schema>",
    "criteriaIds": [
      "C4-1", "C4-2", "C4-3", "C4-4", "C4-5", "C4-6", "C4-7", "C4-8",
      "C4-9", "C4-10", "C4-11", "C4-12", "GATE-INTEGRITY", "LEASE", "HEAD-DRIFT"
    ],
    "changedFiles": [
      {
        "path": "<candidate changed path>",
        "candidateBlobSha256": "<sha256>",
        "landedBlobSha256": "<same sha256>",
        "originMainBlobSha256": "<same sha256>"
      }
    ]
  },
  "w5": {
    "status": "not-landed",
    "landedCommit": null,
    "foundationBlocked": true
  }
}
```

The `w4` object above is the `landed-verified` path. The following sentinel-bounded block is the
sole canonical source for the alternate founder-waived tuple. Its contents are one valid JSON
object. Placeholders remain dynamic only where the hash-bound manifest supplies candidate
changed-file paths and their identical blob hashes.

<!-- W6A_W4_FOUNDER_WAIVER_TUPLE_START -->
{
  "status": "landed-founder-waived",
  "candidateCommit": "db109f25bc50170d1851c38021374df1c50fb8f4",
  "baseCommit": "dda322ba4232deb75420ff59124b1e77e816f102",
  "landedCommit": "2941cfcc76eba068cd74665c6b21537683efda70",
  "landingParentCommit": "dda322ba4232deb75420ff59124b1e77e816f102",
  "landingExtraPaths": ["docs/plans/waves/DECISIONS.md"],
  "manifestPath": "~/.claude/goal-state/mishmash-w4-project-covers/proof/manifest.json",
  "manifestSha256": "8fd153f39050a1ca25cce59514dcfad933ee42438c0e468daf80b71401eb5783",
  "manifestSchemaSha256": "06e56b4434f3eb40c3354ac2a2670f9e4e9d7e1694e38b7b129cbe35acf5941f",
  "criteriaIds": [
    "C4-1", "C4-2", "C4-3", "C4-4", "C4-5", "C4-6", "C4-7", "C4-8",
    "C4-9", "C4-10", "C4-11", "C4-12", "GATE-INTEGRITY", "LEASE", "HEAD-DRIFT"
  ],
  "changedFiles": [
    {
      "path": "<candidate changed path>",
      "candidateBlobSha256": "<sha256>",
      "landedBlobSha256": "<same sha256>",
      "originMainBlobSha256": "<same sha256>"
    }
  ],
  "founderWaiver": {
    "criteriaIds": ["C4-5", "C4-10"],
    "decisionHeading": "W4-C4-5-C4-10-WAIVER",
    "decisionPath": "docs/plans/waves/DECISIONS.md",
    "decisionCommit": "2941cfcc76eba068cd74665c6b21537683efda70",
    "decisionBlobSha256": "0fb231f8319f0b20badd76ed43bee06a9f83826fc353892ee8409589368ce4d9"
  }
}
<!-- W6A_W4_FOUNDER_WAIVER_TUPLE_END -->

No extra or missing key is accepted in these receipt objects. `fetchedAt` is RFC 3339 and may not
be more than 30 seconds in the future. The lease/hash commit must be created within ten minutes of
`fetchedAt`; a stale preflight requires a new preflight and a replacement single-parent lease/hash
commit before the W6a-P branch is created. If W5 has already landed, the only alternate W5 tuple
is `status: "landed"`, a 40-hex `landedCommit` ancestral to the pre-lease `originMain`, and
`foundationBlocked: false`.

`activeWorktrees` is the exact inventory of every other live worktree returned by
`git worktree list --porcelain`; it excludes only the W6a-P verifier's current root because that
worktree did not exist when the preflight was created. Entries are sorted by canonical absolute
`path`; each has exact `head`, full branch ref or literal `detached`, and a sorted, duplicate-free
`changedPaths` union of committed divergence, unstaged changes, staged changes, and untracked files.
`activePlanPathIntersections` is the sorted exact intersection of that complete inventory with the
three W6a-P lease paths. At verification the same inventory is recomputed after excluding only the
current W6a-P root; any added, removed, moved, re-headed, re-branched, or changed worktree, or any
intersection mismatch, fails the gate.

`founderDecision` has exactly the five keys and values shown. `decisionCommit` must be an ancestor
of the preflight `originMain`, the later single-parent lease commit, and freshly fetched current
`origin/main`. The verifier hashes the raw `decisionPath` blob at `decisionCommit` and requires
`decisionBlobSha256`.

Canonical decision-section extraction takes the bytes from the unique matching H2 heading through the byte immediately before the next H2 heading, or through EOF when no later H2 exists; it then trims all trailing whitespace and appends exactly one LF. The verifier hashes and compares only those normalized bytes at the decision commit, preflight `originMain`, lease commit, and fresh current `origin/main`.

Later unrelated decision sections may change the whole file but may not alter, duplicate, or remove
this founder-decision section.

At W6a-P verification, fetch `origin/main` independently and define `leaseCommit` as the merge
base of W6a-P HEAD and fresh `origin/main`. The verifier must prove all of the following:

- `leaseCommit` is the single-parent commit containing the merge-base `waves["W6a-P"]` grant.
- The preflight's `originMain` equals `leaseCommit^` exactly; it is not required, and must not be
  expected, to equal post-lease fresh `origin/main`.
- `git diff-tree --no-commit-id --name-only -r leaseCommit` returns exactly
  `docs/plans/waves/leases.json`.
- `leaseCommit` is an ancestor of fresh current `origin/main`.
- The W2 landing, W3 landing, current W4 artifact/blob conditions, full other-worktree inventory,
  intersections, and all other prerequisite checks are recomputed against fresh current
  `origin/main`; the historical receipt does not waive current drift checks.
- W6a-P HEAD contains byte-identical copies of all three blobs approved at `reviewedCommit`, even
  when the two commit IDs differ.
- A fetch or preflight-validation failure still writes non-empty C6A-01 and C6A-P-LEASE proof
  artifacts plus a commit-bound failure manifest before exiting non-zero. It may leave receipt
  hashes marked missing or invalid, but it may not exit before materializing the failed checks.

- **W2:** `status: "landed-with-retained-gate"`; candidate base
  `1ac53c1591fd853cae6891e81637248acecac3cb`, approved candidate
  `fe1a34584fb0c4d615fcc4919c715e6136d6ef03`, and squash landing
  `8c1b6225b54a0ff8471c765c76e772058600cd7d`. Exact retained bytes and SHA-256 for
  `approved-gate.commit` (`54a206112d2dae369852b7696e501ca2588a342a2db2386a6002d139090f35e5`),
  `approved-gate.sha256` (`c94d89dccfc89881d55315d4035def0defd66961fd6cb749251c4d8f46f69241`),
  and `approved-verify-w2.ts` (`c866b0838cb95277a5e0f435346d640ebc81e3af05af1555e44c90d2ebd87e85`).
  The content of `approved-gate.sha256` must equal the approved verifier hash. It also pins the
  retained clean gate-of-record transcript
  `proof/gate-of-record-fe1a34584-run4.txt` at
  `b5ba0749396171e1df860c6577edcefdebb411ce99e9839f452ca542560a81e7`; that transcript must report
  exactly `15 pass, 0 blocked-on-founder, 0 fail`, `treeDirty=false`, exactly 15 `[PASS]` rows, and
  no failing row. Semantic squash binding requires exactly 129 candidate changed paths from
  `base...candidate`; every candidate blob must be byte-identical at the approved candidate and
  squash landing `8c1b6225b54a0ff8471c765c76e772058600cd7d`; the squash landing must be an
  ancestor of freshly fetched `originMain`. W2 does not require those blobs to remain
  byte-identical at current `originMain`, because later landed waves may legitimately modify them.
  The landing commit's own diff may contain exactly these four additional paths and no others:
  `tools/pack/tests/launcher-payload.test.ts`, `tools/pack/tests/mac-identity.test.ts`,
  `tools/pack/tests/mac-lifecycle.test.ts`, and `tools/pack/tests/win-identity.test.ts`. The stale
  mutable W2 `proof/manifest.json` is explicitly not evidence and must not be read to promote or
  reject W2. Commit `0e5d499314649e51cbfa896f5e0ff4bb0c2b6ce4` records the later unpark decision
  only; it is not the W2 candidate, landing, or proof commit.
- **W3:** `status: "landed-without-goal-proof"` and exact landed commit
  `2435edb2e282242ccea8fb2f0ae7d214738a4e26`, which must be an ancestor of fresh `originMain`.
  This is ancestry evidence only. W6a-P must never call W3 independently verified; W5's expansion
  must reconcile the missing goal proof before W5 can land.
- **W4:** exactly one of two paths is accepted. `status: "landed-verified"` retains the existing
  rule: all 15 unique manifest rows—C4-1 through C4-12, GATE-INTEGRITY, LEASE, and HEAD-DRIFT—must
  have `status: "pass"` and `exitCode: 0`. `status: "landed-founder-waived"` must equal the exact
  constant tuple above. Its hash-bound canonical manifest must have `treeDirty === false`,
  `commit === candidateCommit`, `baseCommit` equal to the receipt, all 15 unique IDs, C4-5 and
  C4-10 each at `status: "fail"` and `exitCode: 1`, and the other 13 rows at `status: "pass"` and
  `exitCode: 0`. On either path, every row must carry a non-empty artifact path and SHA-256; the
  verifier resolves each canonical artifact under the W4 proof root, requires non-empty bytes,
  and rehashes it. The receipt does not duplicate manifest criterion rows.

  On the waived path, `founderWaiver` has exactly the five keys shown. `decisionCommit` must equal
  `landedCommit`; the raw bytes of `decisionPath` at that commit must hash to
  `decisionBlobSha256` and contain the unique `decisionHeading`. That immutable record binds the
  accepted evidence only to C4-5 and C4-10: C4-5's external 400 ms polling race produced
  `validSamples=1, invalidSamples=0, totalSamples=1, rssGrowthKb=0`, while seven independent
  reproductions and `apps/daemon/tests/covers/renderer.test.ts` proved the memory limit; C4-10's
  same-corpus run recorded parent/head p50 415/418 ms, p95 510/424 ms, peak RSS
  3,035,424/2,141,840 KB, and peak concurrency 32/24. No other failing, missing, empty, or
  unhashable row is waivable, and this ruling cannot authorize another wave or future W4 change.

  For both paths, the verifier validates the frozen manifest schema hash and proves `baseCommit`
  is an ancestor of `candidateCommit`;
  `landedCommit` has exactly one parent equal to `landingParentCommit`; that parent lacks or differs
  from the candidate's final blob for at least one candidate path; and the landed commit's own
  changed-path set equals the candidate changed-path set union the explicit, sorted, duplicate-free
  `landingExtraPaths`. Every candidate path must be introduced or changed by `landedCommit` relative
  to `landingParentCommit`. `landedCommit` must be an ancestor of fresh current `originMain`, and
  every candidate path appears once in `changedFiles` with bytes and SHA-256 identical at
  `candidateCommit`, `landedCommit`, and fresh current `originMain`. These conditions support a
  real squash landing without allowing a later unchanged ancestor to be relabeled as W4.
- **W5:** structured `status: "landed" | "not-landed"`, optional landed commit, and
  `foundationBlocked`. `not-landed` with `foundationBlocked: true` blocks W6a-F, but it does not
  block W6a-P from freezing the plan. W6a-F still requires W5 landed on fresh `originMain`.

The W6a-P proof manifest carries a `receipts` object containing exactly eight validated hashes:
`approvalReceiptSha256`, `dispatchPreflightReceiptSha256`, `reviewAttemptSha256`,
`reviewAttemptResultSha256`, `reviewPromptSha256`, `rawResultSha256`,
`oauthInvocationSha256`, and `sessionTranscriptSha256`. Its criteria array still
carries the non-empty, hash-matched C6A-01 and C6A-P-LEASE artifacts required by
`VERIFICATION-CONTRACT.md`; the approval and preflight receipt artifacts and the eight receipt hashes
do not replace criterion artifacts.

### W6a-F

- `packages/contracts/src/api/client-websites.ts`
- `packages/contracts/src/index.ts`
- `apps/daemon/src/client-websites/**`
- `apps/daemon/src/routes/client-websites.ts`
- `apps/daemon/src/db.ts`
- `apps/daemon/src/server.ts`
- `apps/daemon/src/cli.ts`
- `apps/daemon/src/backup/manifest.ts`
- `apps/daemon/src/backup/create.ts`
- `apps/daemon/tests/client-websites/**`
- `apps/web/src/components/client-websites/**`
- `apps/web/tests/components/client-websites/**`
- `apps/web/src/i18n/types.ts`
- `apps/web/src/i18n/locales/en.ts`
- `docs/policies/house-music/v1.md`
- `scripts/waves/capability-manifest.json`
- `scripts/waves/verify-w6a-foundation.ts`

`apps/web/src/providers/registry.ts` remains outside W6a-F unless a red reachability spec proves it indispensable after W3 lands. Any addition requires an exact-file lease amendment on fresh main.

### W6a-B

- `packages/contracts/src/api/inspiration-boards.ts`
- `packages/contracts/src/index.ts`
- `apps/daemon/src/inspiration-boards/**`
- `apps/daemon/src/routes/inspiration-boards.ts`
- `apps/daemon/src/db.ts`
- `apps/daemon/src/server.ts`
- `apps/daemon/src/cli.ts`
- `apps/daemon/src/backup/manifest.ts`
- `apps/daemon/src/backup/create.ts`
- `apps/daemon/tests/inspiration-boards/**`
- `apps/web/src/components/inspiration-boards/**`
- `apps/web/tests/components/inspiration-boards/**`
- `apps/web/src/i18n/types.ts`
- `apps/web/src/i18n/locales/en.ts`
- `scripts/waves/capability-manifest.json`
- `scripts/waves/verify-w6a-boards.ts`

### W6a-G

- `packages/contracts/src/api/client-websites.ts`
- `packages/contracts/src/index.ts`
- `apps/daemon/src/client-websites/**`
- `apps/daemon/src/routes/client-websites.ts`
- `apps/daemon/src/prompts/client-website.ts`
- `apps/daemon/src/cli.ts`
- `apps/daemon/tests/client-websites/**`
- `apps/web/src/components/client-websites/**`
- `apps/web/tests/components/client-websites/**`
- `e2e/ui/client-website*.test.ts`
- `scripts/waves/capability-manifest.json`
- `scripts/waves/verify-w6a-generation.ts`

Existing editor, visual catalog, Palette/Tweaks, GenUI, project version, and design-system files are amend-on-proof only. A red spec must establish that a named file must change before the orchestrator adds it to this lease.

### W6a-S

- `packages/contracts/src/api/client-websites.ts`
- `apps/daemon/src/client-websites/placeholders.ts`
- `apps/daemon/src/deploy.ts`
- `apps/daemon/src/routes/deploy.ts`
- `apps/daemon/src/cli.ts`
- `apps/daemon/tests/client-websites/placeholders*.test.ts`
- `apps/daemon/tests/deploy-routes.test.ts`
- `apps/web/src/components/client-websites/**`
- `apps/web/tests/components/client-websites/**`
- `scripts/waves/verify-w6a-placeholder-safety.ts`

Before this lease is granted, the orchestrator must write `~/.claude/goal-state/mishmash-w6a-placeholder-safety/proof/dispatch-preflight.json` with two machine-readable inputs: a merge-base scan proving no other unlanded `leases.json` allowlist intersects `apps/daemon/src/deploy.ts` or `apps/daemon/src/routes/deploy.ts`, and a live `git worktree list` plus changed-path report proving no active worktree owns either path. An overlap is cleared only when its branch is an ancestor of fresh `origin/main` or `DECISIONS.md` records the exact paths and releasing authority. `verify-w6a-placeholder-safety.ts` fails if the recorded inputs, W6a-S lease, or exact-path clearance is missing.

### W6a-U

- `packages/contracts/src/api/client-websites.ts`
- `apps/daemon/src/client-websites/easy-update/**`
- `apps/daemon/src/routes/client-websites.ts`
- `apps/daemon/tests/client-websites/easy-update/**`
- `apps/web/src/components/client-websites/easy-update/**`
- `apps/web/tests/components/client-websites/easy-update/**`
- `apps/daemon/src/cli.ts`
- `apps/daemon/src/backup/manifest.ts`
- `apps/daemon/src/backup/create.ts`
- `scripts/waves/capability-manifest.json`
- `scripts/waves/verify-w6a-easy-update.ts`

Project-version files are amend-on-proof only. W6a-U must not lease or call deployment code.

### W6a-E

- `e2e/tests/client-website/**`
- `e2e/ui/client-website*.test.ts`
- `docs/plans/waves/VERIFICATION-CONTRACT.md`
- `scripts/waves/verify-w6a-integration.ts`

Any production fix discovered by integration requires an exact-file lease amendment on fresh main before modification.

## 15. Model routing

- Product and architecture adversary: Grok 4.5 through the prepaid Nous Portal.
- Long-horizon PRD review: Fable 5 through Claude Code OAuth only.
- Scoped implementation: `deepseek-v4-flash` through the direct approved DeepSeek endpoint. The exact slug was live-probed on 2026-08-03 and must be rechecked at dispatch time.
- Visual review: Gemini through the subscription `agy` lane when screenshots are involved.
- Code adversary: Opus 5 through Claude Code OAuth only.
- Mechanical verification: deterministic scripts and tests, not model judgment.

No Anthropic model may use API credits, Nous, or OpenRouter for this program.

## 16. Concurrency and landing contract

- The current Codex worktree and `codex/design-interface-product-program` branch are PRD-authoring surfaces only.
- This product PRD stays at `docs/plans/2026-08-03-client-website-studio-prd.md` under the project plan-routing convention. The tranche `/goal` contract and verifier pointer live under `docs/plans/waves/`; they become frozen only when the commit-bound W6a-P manifest passes. This is the explicit exception to the GLOBAL-GOAL wave-PRD location rule.
- Implementation tranches start in fresh isolated worktrees from current `origin/main` after their gates and lease grants pass.
- Program landings use one integrating writer and the existing cherry-pick/merge procedure. They do not merge this PRD-authoring branch wholesale.
- Do not modify the root MishMash worktree or any `.claude/worktrees/*` directory.
- Historical review snapshot: `feat/design-library-kit-preview-descriptions` had landed at `origin/main@d87fc4a04`; `origin/main@2696032fd` contained `feat/workspace-canvas-button`; `origin/main@2941cfcc7` contains the founder-waived W4 landing; and `origin/main@941be4f15` contains the W6a-P founder decision. These facts explain the draft but are not dispatch authority.
- Dispatch authority comes only from the fresh approval and preflight receipts hash-pinned in the separately granted `waves["W6a-P"]` lease entry. The preflight must refresh `origin/main`, worktrees, branch ancestry, active diffs, W2/W4 gates, and W3/W5 audit state; a stale historical SHA cannot satisfy it.
- The GLOBAL-GOAL product sequence remains binding: W3, then W5, then W6a. W6a-P is plan freeze only, so a structured `W5: not-landed` preflight does not block W6a-P. It does block W6a-F: no product implementation starts until W5 is an ancestor of fresh `origin/main`, which transitively closes the W3 and W1 gates and must reconcile W3's `landed-without-goal-proof` status.
- W8 implementation contends for CLI, contracts, server, and capability-manifest paths. W6a and W8 cannot hold those files concurrently.
- Before every tranche, refresh worktree, process, branch, active-diff, origin/main, and lease evidence.
- A branch is released when it is an ancestor of fresh `origin/main`, or when a checked overlap probe proves its changed paths are disjoint from the proposed W6a lease and the orchestrator records that release.

## 17. Verification and program evidence

Every tranche creates its verifier before implementation and runs the relevant subset of:

```bash
pnpm guard
pnpm typecheck
pnpm --filter @open-design/contracts build
pnpm --filter @open-design/web test
pnpm --filter @open-design/daemon test
pnpm exec tsx scripts/waves/verify-w6a-<tranche>.ts
git diff --check
```

Visible behavior requires a browser-driven check and screenshots. Rejection and security checks require positive and negative controls. Red evidence is captured against the parent commit, then green evidence at the implementation commit.

W6a tranche manifests grade C6A criteria locally. W6a-E must add the C6A evidence index to `docs/plans/waves/VERIFICATION-CONTRACT.md` before the global program can claim W6a completion. Until then, W6a results do not satisfy any existing G-criterion automatically.

## 18. Recovery matrix

W6a-E verifies these bounded external failures:

1. Owned-site brand fetch fails before source extraction.
2. Tavily research fails before reference enrichment.
3. Agent run crashes after brief approval but before generation completes.
4. Deployment provider fails after local preflight but before a deployment record reports success.

Each failure must preserve the approved brief, avoid duplicate records, leave project files and versions recoverable, report a domain-specific error in UI and CLI, and permit a bounded retry.

## 19. Stop conditions

All rules in `docs/plans/waves/VERIFICATION-CONTRACT.md` and `GLOBAL-GOAL.md` remain binding. In particular, three consecutive non-APPROVE reviews or a non-decreasing HIGH finding count triggers the program stop rule.

Stop the affected tranche and request a decision if:

- Its gate or merge-base lease is absent.
- W6a-P is asked to freeze before W4 lands, or W6a-F is asked to start before W5 lands.
- It requires modifying another active session's owned files before release.
- It adds arbitrary network capture to boards or briefs.
- It requires customer-site analytics or managed provider credentials.
- It needs a GSAP visual-authoring surface beyond the current global control.
- A rights model cannot distinguish source reuse from reference-only influence.
- Two implementation attempts fail the same criterion.
- The independent code adversary finds a blocking correctness, security, privacy, licensing, or data-integrity defect.

## 20. Adversarial finding register

The W6a-P verifier parses this table. A finding can be closed only by a PRD change or a recorded decision; reviewer prose alone is not closure.

| id | severity | file | claim | repro | disposition |
|---|---|---|---|---|---|
| G45-01 | high | `docs/plans/2026-08-03-client-website-studio-prd.md` §2, §5, §11 | The notes overclaimed universal editing, one-fee hosting, and visitor identity. | Inspect live editor, deploy, and PostHog surfaces; compare them with the original notes. | Closed by corrected claims and explicit MVP deferrals. |
| G45-02 | high | `docs/plans/2026-08-03-client-website-studio-prd.md` §6.2, §10 | Competitor and inspiration material lacked enforceable reuse rights. | Submit otherwise identical owned and reference-only fixtures through the generation contract. | Closed by C6A-04 paired controls and reference-only restrictions. |
| G45-03 | high | `docs/plans/2026-08-03-client-website-studio-prd.md` §5, §10 | Arbitrary remote capture would reopen an SSRF and sandbox boundary. | Search the W6a route and board diff for new remote-fetch entry points and run C6A-05 and C6A-09 controls. | Closed by excluding arbitrary capture and binding owned URL import to safe-fetch. |
| G45-04 | high | `docs/plans/2026-08-03-client-website-studio-prd.md` §8, §12 | Temporary copy could reach production without user approval. | Run preview and production preflight against the same placeholder fixture. | Closed by C6A-14 and C6A-15. |
| F5-01 | high | `docs/plans/2026-08-03-client-website-studio-prd.md` §12, §13 | The first draft reused occupied W0 through W5 namespaces. | Compare tranche names with `docs/plans/waves/leases.json`. | Closed by unique W6a-P/F/B/G/S/U/E slugs and verifiers. |
| F5-02 | high | `docs/plans/2026-08-03-client-website-studio-prd.md` §13, §14, §16 | The first draft lacked mechanically checked leases and active-lane gates. | Diff each proposed changed path against the merge-base lease and live worktree report. | Closed by per-tranche lease criteria and dispatch gates. |
| F5-03 | high | `docs/plans/2026-08-03-client-website-studio-prd.md` §12, §13 | Criteria were not mapped to one tranche and verifier. | Parse the Section 13 criteria column and assert every C6A ID has exactly one owner. | Closed by the execution map and C6A-22. |
| F5-04 | high | `docs/plans/2026-08-03-client-website-studio-prd.md` §9.3, §12 | Rights and new records lacked backup and restore proof. | Backup each tranche's populated fixture, then restore the aggregate fixture into a fresh data root and compare normalized rows and hashes. | Closed by foundation coverage in C6A-06, board/pin coverage in C6A-08, update-packet coverage in C6A-19, and aggregate composition proof in C6A-21. |
| F5-05 | high | `docs/plans/2026-08-03-client-website-studio-prd.md` §12, §14 | Placeholder safety could collide with deploy work. | Read W6a-S dispatch preflight and compare exact deploy paths with leases and live worktrees. | Closed by the W6a-S machine-readable dispatch gate. |
| F5-06 | medium | `docs/plans/2026-08-03-client-website-studio-prd.md` §12 | Several negative criteria were unfalsifiable or used the wrong editor targeting model. | Run AST, dispatcher, phrase, corpus, route-inventory, and `data-od-*` paired controls. | Closed by C6A-09, C6A-10, C6A-12, C6A-16, C6A-17, and C6A-18. |
| F5R-01 | high | `docs/plans/2026-08-03-client-website-studio-prd.md` §12, §14 | W6a-G could not satisfy UI, HTTP, and CLI closure within its lease. | Compare C6A-11 and C6A-24 with the W6a-G allowlist and capability manifest. | Closed by adding contracts, CLI, manifest, and explicit parity criteria. |
| F5R-02 | high | `docs/plans/2026-08-03-client-website-studio-prd.md` §13, §14 | The deploy-hardening owner was not a machine-readable entity. | Search leases, decisions, branches, and verifiers for the named owner. | Closed by replacing the social gate with exact-path merge-base and live-worktree evidence. |
| F5R-03 | high | `docs/plans/waves/leases.json` W3; this PRD §13, §14 | W6a-F collided with W3 on `registry.ts`, CLI, and tests. | Intersect the W3 allowlist with the proposed W6a-F allowlist. | Closed by W5/W3 serialization and removal of `registry.ts`; remaining shared files are temporal, not concurrent. |
| F5R-04 | medium-high | `docs/plans/waves/GLOBAL-GOAL.md` §State; this PRD §13, §16 | The draft silently put W6a ahead of W3 and W5. | Compare GLOBAL-GOAL order with W6a-F gates. | Closed by preserving W3 to W5 to W6a order. |
| F5R-05 | medium | `docs/plans/waves/W5-W11-gated.md` W6a; this PRD §12 | The draft dropped token apply, document/upload entry, and failed-apply rollback. | Compare the W6a skeleton criteria spine with C6A owners. | Closed by C6A-23 and C6A-24. |

## 21. Stop-rule escalation state

This review arc received `REVISE` from Grok 4.5, `REVISE` from the first Fable 5 review, and `REVISE` from the second Fable 5 review. Under GLOBAL-GOAL rule 8 and VERIFICATION-CONTRACT §6, the third consecutive non-APPROVE verdict stopped the arc even though all second-review findings now have draft dispositions above.

The exact founder decision bound by the preflight authorizes one final Fable 5 OAuth confirmation
pass, then same-session W6a-P `/goal` only after the W4 and lease gates clear. Its review scope is
F5R-01 through F5R-05, regressions caused by their closures, plus exactly the PRD block bounded by
`W6A_W4_FOUNDER_WAIVER_TUPLE_START` and `W6A_W4_FOUNDER_WAIVER_TUPLE_END`. The W4 block is a
separately authorized prerequisite-compatibility item, not an F5R-02/F5R-04 regression. Review of
that item is limited to C4-5 and C4-10 and may not waive, reopen, or authorize any other criterion,
change, or wave. The one confirmation remains unspent until invoked against the final reviewed
three-file candidate. A non-APPROVE verdict or new blocking finding parks W6a-P without another
autonomous fix round; no W3, W4, W5, lease, reviewer-independence, or worktree-isolation gate is
waived.
