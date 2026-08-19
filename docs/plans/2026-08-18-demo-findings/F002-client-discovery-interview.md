# F002 — Native client discovery interview: 3 tiers, sendable, embeddable, project-starting

| Field | Value |
|---|---|
| Captured | 2026-08-18, live team demo |
| Reported by | Devin |
| Area | Intake · chat question-forms · sharing · project scaffold · site embeds |
| Severity | **High** — reported from a live demo; timing numbers below are self-reported (n=2), not independently logged |
| Effort | **L**, phased P0 / P1 / P2 |
| Status | 📝 Captured → 🔬 Scoped → 🛠️ Repaired for unattended execution (2026-08-18) |
| Source artifact | [`assets/F002-questionnaire-v1-full.txt`](assets/F002-questionnaire-v1-full.txt) (135 lines, archived from `~/Downloads/website-questionnaire 2.txt`) |

---

## 1. Raw note (verbatim)

> there should be a question answer session for clients we should be able to send directly
> from mishmash. and also, if we should be albe to use this inside of the mishmash sites,
> say if i wanted to make myself a website ect then we should have the option to kick off a
> project, maybe a couple versions. we just used this question answer and it took one
> teammate 20 mins and the other 30 mins, so i think this is exxelent for people who havent
> refined their buisiness idea yet or we really need good solid anwers from.
> `/Users/zero-suminc./Downloads/website-questionnaire 2.txt` . i think that we should have
> 2 more versions of this as well, so 3 total, the first one which is 25-30mins, second
> 15-20mins and the shortest version 5-10mins. i think that would be helpful.

**Live evidence from the demo:** two teammates completed the existing interview in
**20 min** and **30 min** respectively. n=2, but observed rather than estimated.

---

> **Repair note (2026-08-18):** the repository has no independent run log or timer
> artifact backing the 20/30-minute figures above — they are self-reported from the demo,
> not instrumented. Treat them as a starting hypothesis, not a settled baseline. Success
> criterion 2 in §4.5 requires re-measuring across ≥3 real runs per tier before any tier
> label is trusted.

## 2. What exists today

### The interview

A **copy-paste prompt** that lives entirely outside the product. Its own instructions:

> 1. Go to claude.ai or chatgpt.com (free accounts work fine) … 3. Paste it into the chat
> and hit send … 5. At the end it writes a summary. Copy that and send it back to me.

It is well built. The conversational rules are the valuable part and must survive
productisation intact:

- One or two questions per message, never more — *"the most important rule"*
- Never paste the checklist at the user; turn it into your own questions
- React to each answer before asking the next
- Follow interesting threads off-script
- Push back on vague answers for `REQUIRED` fields; accept a genuine *"I don't know"*
- Don't announce sections; no *"Section 3 of 9"*
- Gate the summary on five `REQUIRED` items: HQ city+state, full service-area list,
  certifications named individually, exact phone, exact email
- Summary uses 12 fixed headers and, **for anything that might become website copy**,
  *"my actual words"* — the source does not require verbatim capture for every field,
  only copy-bound material ([`assets/F002-questionnaire-v1-full.txt:128`](assets/F002-questionnaire-v1-full.txt))
- **Invent nothing.** Under `OPEN ITEMS AND MISSING INFO`, list everything skipped,
  answered "I don't know" to, or answered vaguely

### The product

| Capability | Where | State |
|---|---|---|
| Renderable question forms in chat | `apps/daemon/src/question-form-detect.ts` (`questionFormBodyIsRenderable`, [:16-35](../../../apps/daemon/src/question-form-detect.ts)) + `apps/web/src/artifacts/question-form.ts` (`parseForm`, [:287-306](../../../apps/web/src/artifacts/question-form.ts)) | **Exists, but the two parsers are NOT actually in sync.** The daemon accepts only an object with a non-empty `questions[]`; the web parser additionally accepts a bare top-level JSON array, proven by its own regression test (`apps/web/tests/artifacts/question-form.test.ts:222`, *"parses the deliveryFormat/container array payload"*). The daemon module's own comment already flags this as a known drift risk and prescribes the fix: keep both in sync, or promote a shared parser into `packages/contracts`. R1 below must close this before it can claim to "run the interview over the existing `<question-form>` contract." |
| Interactive agent surfaces | `apps/daemon/src/genui/` — `form` kind, request/respond/prefill/revoke/timeout | Exists |
| Onboarding recommender | `apps/web/src/onboarding/recommendation.ts` (verified 233 lines) | Thin — `ProductType` is only `product_ui \| marketing \| internal_tool \| general`, mapped to starter options |
| **Answers → project seeding** | `CreateProjectRequest.brief: GuidedCreateBrief` in `packages/contracts/src/api/projects.ts:307-361`; folded server-side by `normalizeGuidedBrief`/`buildGuidedBriefSection` in `apps/daemon/src/routes/project/index.ts:~1727`; exposed today as `od project create --brief-file / --screens / --fidelity / --iterations / --pages / --product / --audience / --use-case / --direction` (`apps/daemon/src/cli.ts:~6918-6926`) | **Exists already, PRD C8's guided-create flow.** `iterations` is already a validated 1-3 field with newline/control-character sanitization tests (`apps/daemon/tests/project-create-guided-brief.test.ts:80,100`). This is a real answers→project path — just not one this questionnaire's output maps into. R6/R12 below must extend it, not invent a parallel one. |
| Sharing / public links | `apps/daemon/src/deploy/cloudflare-pages-helpers.ts:79` (`publicDeployment`/deploy links) backing a working project-detail "Share menu" UI flow proven by `e2e/ui/project-management-flows.test.ts:2101` (*"share menu copies the current share link for uploaded html artifacts"*) | **A real share flow already exists for published project artifacts.** `apps/daemon/src/routes/social-share.ts` (926 B) builds Open Graph-style share payloads for it. `apps/daemon/src/routes/open-design-public-metadata.ts` (2.5 K) is **not** a sharing surface at all — it serves the repo's own GitHub release/star-count and Discord presence stats; the original finding misclassified it. None of this is a client-facing *interview invite* flow — that part of G2 below still stands. |
| Publishing | `apps/daemon/src/deploy/cloudflare-pages-helpers.ts` | Exists |
| Site embed for external intake | *(searched `apps/daemon/src/routes/`, `apps/web/src/` for "embed")* | Every existing hit is about embedding previews/decks/CSS **inside** the MishMash app, not embedding a MishMash-hosted widget into an externally published site. No existing capability found — R11 is genuinely new work. |

So the product already has: the **rendering primitive** for an in-chat interview (with a
real parser gap to close), and a **real, tested answers→project path** (`GuidedCreateBrief`)
that this questionnaire simply doesn't feed yet. What's missing is the interview *engine*,
a client-facing send/return channel, a schema that maps this questionnaire's output into
(or alongside) `GuidedCreateBrief`, and the embed.

---

## 3. The gap

**G1 — The interview happens in a competitor's product.** Every run sends the client to
claude.ai or chatgpt.com and returns an unstructured paste. MishMash gets none of the
signal, none of the session, and none of the relationship.

**G2 — No client-facing delivery channel for an interview invite.** *"send directly from
mishmash"* has no implementation. A share flow exists for **published artifacts**
(see table above), which is a useful adjacent pattern to reuse for link tokens/expiry
conventions, but there is no equivalent for *inviting a client into an interview session*
they haven't started yet.

**G3 — This questionnaire's output has no schema, and doesn't reach the project-seeding
path that already exists.** The 12 headers impose order but every value is free text, and
nothing maps that text into `GuidedCreateBrief` (or a new compatible type) so a project can
be seeded deterministically. This is narrower than "no answers→project path" — that path
exists (see table above) and R6 must extend it, not build a parallel one.

**G4 — No embed.** It cannot be dropped into a MishMash-built site as an intake widget,
which is what *"use this inside of the mishmash sites"* asks for. Confirmed: no existing
capability does this today.

**G5 — One length, and the label is imprecise.** The file claims *"Takes about 10-15
minutes."* Observed (n=2, self-reported): 20 and 30 minutes. At corresponding endpoints
that's roughly **2×** the stated band, not the 2–3× the original note implied (arbitrary
cross-pairing of the two ranges produces figures from 1.3× to 3×, which overstates the
mismatch). The direction of the finding still holds — the label is wrong — but the
magnitude claim needs re-measurement, not restatement. The current questionnaire is a
**candidate** for the 25–30 min `full` tier; it is not yet an established one, since one of
the two observed runs (20 min) falls in the `standard` band and the PRD's own success
criteria correctly require ≥3 runs per tier before any label is trusted.

**G6 — Vertical lock-in.** The content is local-trades shaped: BICSI, FOA, CommScope,
Panduit, EPA, OSHA, state contractor licence, *"trucks"*, service radius, emergency hours.
For a poet, a SaaS, or a restaurant it misfires — including Devin's own stated case,
*"if i wanted to make myself a website."*

---

## 4. PRD

### 4.1 Goals

- **G-1** Run the interview natively in MishMash, preserving its conversational quality.
- **G-2** Three tiers: Full (25–30 min), Standard (15–20 min), Quick (5–10 min).
- **G-3** Send an interview to a client from inside MishMash and get results back.
- **G-4** Emit a **structured** brief that maps into the project-seeding path that already
  exists (`GuidedCreateBrief`) rather than producing another free-text paste.
- **G-5** Start a project — optionally a few variants — straight from a completed brief.
- **G-6** Embed the interview in MishMash-built sites as an intake widget.

### 4.2 Non-goals

- Not a general form builder.
- Not a CRM. It captures a brief and starts a project; it does not manage a pipeline.
- Not a replacement for `GuidedCreateBrief` — this PRD extends the existing project-seeding
  contract, it does not fork it.

### 4.3 Requirements

Every requirement below that ships a user-facing capability closes **all four** surfaces
in the same PR, per `AGENTS.md` "Capability exposure (UI/CLI dual-track)": an HTTP endpoint
under `apps/daemon/src/routes/`, a DTO in `packages/contracts/src/api/`, a web surface
under `apps/web/src/`, and an `od <capability>` subcommand registered in `SUBCOMMAND_MAP`
(`apps/daemon/src/cli.ts:900`) supporting `--json` and, wherever the surface accepts
free-text/prompt input, `--prompt-file <path|->`. A requirement that ships only one or two
of the four is not done — do not stage them across PRs (the one founder-ratified exception,
Interface Program WX-wave splitting, does not apply here).

#### P0 — native interview + structured brief

- **R1 · Interview engine.** `apps/daemon/src/interview/` running the interview as a
  conversation over the `<question-form>` contract. **Before this ships, reconcile the
  daemon/web parser mismatch** documented in §2 (`question-form-detect.ts` vs
  `question-form.ts`) — either make the daemon accept the same array-payload shape the web
  parser already accepts, or promote one shared parser into `packages/contracts` per the
  daemon module's own comment. The behavioural rules in §2 are **engine constraints, not
  prompt suggestions** — one-or-two questions per turn, acknowledge before advancing, no
  section announcements, `REQUIRED` push-back, graceful *"I don't know"*. Port them
  verbatim into the system prompt and assert the one-or-two rule in tests.
  - **Executable definition, "I don't know" vs the `REQUIRED` gate (resolves the literal
    conflict between R1 and R4):** the client may answer "I don't know" to a `REQUIRED`
    field and the conversation may still end. That answer is recorded verbatim and the item
    is added to `openItems[]`. What R4's gate blocks is not *ending the conversation* — it
    blocks the resulting `ClientBrief.status` from being `'complete'`. A brief with any
    `REQUIRED` item unanswered or vague is `status: 'needs-info'`. R6 (brief → project)
    requires `status: 'complete'` by default and an explicit `--force-incomplete` /
    equivalent UI confirmation to seed a project from a `'needs-info'` brief.
  - **Dual-track closure for R1:** `POST /api/interviews/:id/turns` (daemon route,
    `InterviewTurnRequest`/`InterviewTurnResponse` DTOs in
    `packages/contracts/src/api/interviews.ts`), a chat-pane surface in `apps/web/src/`
    that renders it over the existing `QuestionFormView`, and `od interview run <tier>
    [--prompt-file <path|->] [--json]` in `SUBCOMMAND_MAP`.
- **R2 · Three tiers.**

  | Tier | Target (working hypothesis, re-measure per success criterion 2) | Source |
  |---|---|---|
  | `full` | 25–30 min | The existing questionnaire, **re-labelled** from its wrong 10–15 min claim |
  | `standard` | 15–20 min | Derived: drop FAQ depth and Practical Details; keep all five `REQUIRED` |
  | `quick` | 5–10 min | Derived: `REQUIRED` items + services + ideal customer + look/feel + primary CTA |

  Every tier must still gate on the five `REQUIRED` items — a shorter interview collects
  less, never less *reliably*. **Executable definition of "vague" (closes the audit's
  gap):** a `REQUIRED` answer is vague when, after normalization (trim + collapse
  whitespace), it matches a small deny-list of non-answers (e.g. `"my main line"`,
  `"n/a"`, single-character strings) OR fails a field-specific format check (phone: at
  least 10 digits after stripping formatting; email: contains `@` and a `.` after it).
  This is a real gap today: `QuestionForm.tsx`'s `questionAnswerIsPresent`
  (`apps/web/src/components/QuestionForm.tsx:1565`) only checks for a non-empty trimmed
  string, so `"my main line"` currently passes required-field validation
  (`apps/web/src/components/QuestionForm.tsx:404-412`). R1's engine must apply the
  stricter check server-side; it cannot rely on the existing client-side presence check.
- **R3 · Structured brief schema.** `ClientBrief` in `packages/contracts/src/api/`
  (contracts is pure TypeScript with no daemon/browser dependencies — this is a hard
  boundary, not a style choice), typed from the 12 summary headers, **with runtime schema
  validation** (e.g. a Zod schema colocated with the type, matching the repo's
  validate-at-boundaries convention) — a TypeScript interface alone does not validate
  anything at the API boundary. Each field carries `value`, and `verbatim` **only where the
  source interview requires it** — the source's own rule is "my actual words for anything
  that might become website copy," not for every field
  (`assets/F002-questionnaire-v1-full.txt:128`) — plus `confidence`. Plus a first-class
  `openItems[]` for everything skipped, unknown, vague, or still-to-send (logo, photos,
  brand guidelines).
- **R4 · `REQUIRED` gate.** The brief cannot be marked `status: 'complete'` while any of
  the five is missing or vague (see R2's definition of vague). Enforced in code — a
  dedicated server-side validator, not the existing client-side `questionAnswerIsPresent`
  check, and not left to model discretion.
- **R5 · Archetype-aware question sets.** Question content varies by site archetype.
  **`apps/daemon/src/design/site-archetypes.ts` does not exist yet** — F001 only proposes
  it (`F001-conversational-template-advisor.md:149`). This is a real ordering dependency,
  not a same-session parallel build: **R5 cannot ship before F001 R3 ships**, and the
  shared vocabulary itself must live in `packages/contracts` (not daemon-private `src/`),
  because both `apps/web` (for archetype-aware UI copy) and the shared `ClientBrief` type
  need to reference it, and `apps/web` is forbidden from importing `apps/daemon/src/**`
  (`AGENTS.md` "Boundary constraints"). If F001 R3 has not landed when this phase starts,
  ship `local-trade` only and track the archetype expansion as a follow-up once the
  dependency clears — do not block all of P0 on it. Ship `local-trade` (today's content,
  unchanged) plus at least `poetry`/creative and one software/SaaS set once the vocabulary
  exists, so §G6 is closed rather than documented.
- **R6 · Brief → project, extending the existing path.** A completed brief starts a
  project **through the existing `CreateProjectRequest.brief: GuidedCreateBrief` contract**
  (`packages/contracts/src/api/projects.ts:307-361`), not a new one. Concretely: either (a)
  add a `ClientBrief`-to-`GuidedCreateBrief` mapping function that populates `product`,
  `audience`, `useCase`, and `direction` from the interview's `SERVICES`, `TARGET
  CUSTOMER`, and `VISUAL DIRECTION` sections, or (b) extend `GuidedCreateBrief` with a
  discriminated `source: 'interview'` variant carrying the full `ClientBrief`. Either
  choice must preserve every existing `GuidedCreateBrief` caller and the sanitization
  behavior already under test (`apps/daemon/tests/project-create-guided-brief.test.ts:100`,
  newline/control-character stripping) — anonymous client text is untrusted input and must
  go through the same sanitization before it reaches a prompt. **Where F001's advisor is
  available it may additionally receive the mapped `{ audience, tone[], must_have[],
  constraints }` shape F001 R4 actually defines** (`F001-conversational-template-advisor.md:155`)
  — F001 R4 does *not* consume a `ClientBrief` and does not accept `VISUAL DIRECTION` /
  `SERVICES` / `TARGET CUSTOMER` as direct inputs; a mapping layer is required in both
  directions, not a shared type.
- **R7 · i18n** for all new user-facing strings; `pnpm i18n:check` green.

#### P1 — send to a client

- **DECISION REQUIRED (blocks R8, R9, R10):** Where do client answers live — in the
  daemon (making the share link a real hosted service with real PII duties against a
  loopback-bound daemon that currently treats any local caller without an `Origin` header
  as trusted, per `docs/security/daemon-threat-model.md:15-24`), or does an anonymous
  client-facing link need a genuinely separate hosted trust boundary that posts a
  completed brief back to the daemon? These are different architectures with different
  security postures. Do not build R8 until this is answered — scope P0 to ship and prove
  itself without it.
- **R8 · Sendable interview link.** Generate a per-client tokenised link from inside
  MishMash; the client completes the interview in a browser with no MishMash account.
  Blocked on the decision above. Dual-track closure: `POST /api/interviews/:id/invite`
  DTO in `packages/contracts/src/api/interviews.ts`, an invite-management panel in
  `apps/web/src/`, and `od interview invite <id> [--json]`.
- **R9 · Return path.** Completion notifies the owner and lands the `ClientBrief` on the
  project. Partial progress is resumable — a 30-minute interview will be abandoned midway
  and resumed later. Require an idempotency key on the completion transition so a replayed
  completion request cannot create a duplicate project or duplicate variants.
  - **DECISION REQUIRED (blocks the "quick" tier's UX, non-blocking for the rest of P1):**
    should `quick` auto-upgrade — start someone at 5–10 min and offer to keep going when
    they're engaged? Ship `quick` as a fixed-length tier first; treat auto-upgrade as a
    follow-up once the decision is made.
- **R10 · Privacy.** The brief holds client PII — exact phone, exact email, business
  address. `PRIVACY.md:48-86` documents an opt-in "Conversation and tool content" channel
  that can transmit prompts, responses, and tool payloads to the telemetry relay when
  enabled — an anonymous client's PII must be excluded from that channel by default, not
  merely "considered." Retention, access scope, link expiry (entropy, hashing, rotation,
  one-time use, rate limits), and consent copy shown to the anonymous client must all be
  settled **before** R8 ships, against `PRIVACY.md` and `docs/security/`. A public link
  that collects a phone number is a different risk class from an in-app form.

#### P2 — embed + variants

- **R11 · Site embed.** Ship the interview as an embeddable widget for MishMash-built
  sites, so a published site can run intake for its owner. No existing embed mechanism was
  found that covers this (searched `apps/daemon/src/routes/` and `apps/web/src/` for
  "embed" — every hit embeds MishMash-internal content, none embed a MishMash surface into
  an external site), so this is genuinely new infrastructure, not an extension.
  - **DECISION REQUIRED (blocks R11):** who is the default audience of the embed — your
    clients collecting *their* customers' briefs, or you collecting your clients' briefs?
    The copy, and possibly the auth model, differ. Do not build the copy/auth default until
    this is answered; the technical embed mechanism (iframe/script tag delivery) can be
    scoped independently.
  - Dual-track closure once unblocked: embed-config endpoint + DTO, an embed-settings panel
    in `apps/web/src/`, and `od interview embed <project-id> [--json]`.
- **R12 · Multiple project versions.** *"maybe a couple versions"* — one brief generates
  N project variants.
  - **DECISION REQUIRED (blocks R12):** how many is "a couple," and do variants differ by
    F001 **direction** or by copy? This also collides with an *existing* field:
    `GuidedCreateBrief.iterations` (`packages/contracts/src/api/projects.ts:352`) is
    already a validated 1–3 integer, but its current meaning (per
    `apps/daemon/src/prompts/guided-brief.ts:163-164`) is "produce N distinct variations,"
    generic to fidelity/scope — not "N variants differing by F001 direction." R12 must
    either reuse `iterations` with its existing semantics, or explicitly extend it with a
    `variantAxis: 'direction' | 'copy'` field and update its prompt-building logic. Do not
    invent a second, differently-named field that means almost the same thing.

### 4.4 Risks

| Risk | Mitigation |
|---|---|
| Model drifts into reading the checklist aloud — the failure the prompt fights hardest | Assert one-or-two-questions-per-turn in tests; the source prompt calls this *"the most important rule"* |
| Shorter tiers become lower quality, not just shorter | Every tier keeps the same `REQUIRED` gate (R2, R4) |
| Tier time labels are guesses again | Re-measure. Success criteria below require observed medians from ≥3 real runs per tier, tracked as a morning-review item, not an overnight-blocking one (see §4.5) |
| PII in a publicly reachable link | R10 blocks R8 until settled; the storage-architecture decision above blocks R8 independently |
| `ClientBrief` and F001's brief shape drift | They are genuinely different shapes today (`ClientBrief` vs F001 R4's `{ archetype, category, audience, tone[], must_have[], constraints }`). R6 defines an explicit mapping function in both directions instead of claiming one shared type — do not let the mapping function's field list quietly drift out of sync with either schema; cover it with a contract test asserting every mapped field round-trips. |
| `question-form` parser is mirrored across the app boundary but has already drifted | Confirmed drift today (daemon rejects a bare-array payload the web parser accepts, per the regression test at `apps/web/tests/artifacts/question-form.test.ts:222`). R1 must close this before building on top of the contract, not treat it as a future risk. |
| `GuidedCreateBrief.iterations` and R12's "N variants" mean different things today | R12 explicitly reuses or extends the existing field (see R12) rather than shipping a parallel one. |

### 4.5 Success criteria (measurable)

All of the following must be provable by a command an unattended agent can run tonight.
Criteria that inherently need a human (real client timing, subjective "does this feel
like a conversation") are moved to the **Morning review** list below and do not block
the run.

1. All three tiers run natively, end to end, without leaving MishMash — proven by an
   automated conversation-harness test per tier (scripted/mocked model turns) that drives
   the engine from first question to a `status: 'complete'` or `'needs-info'` brief.
2. **Structural tier-shape assertions run unattended:** each tier's question set size and
   content are asserted against fixtures (e.g. `quick` question count ≤ N, `full` retains
   every section the `standard`/`quick` derivations drop items from). Real-user timing
   validation against the 25–30/15–20/5–10 min bands is a **Morning review** item (below),
   not a criterion this run can satisfy — no unattended process can generate a genuine
   human timing sample.
3. A completed interview emits a `ClientBrief` passing its **runtime** schema validation
   (not just TypeScript compilation), with every skipped/vague answer present in
   `openItems[]`.
4. The `REQUIRED` gate provably blocks `status: 'complete'`: a test supplying `"my main
   line"` for phone (using R2's vague-answer definition) yields `status: 'needs-info'`,
   not `'complete'`.
5. A `'complete'` brief starts a project with zero re-typing, proven by an integration
   test asserting the created project's `pendingPrompt`/`metadata` contains every mapped
   `ClientBrief` field via the R6 mapping function.
6. At least the `local-trade` archetype question set ships in P0. If F001 R3 has landed
   by the time this phase runs, at least the `poetry`/creative set ships too, and a test
   asserts it contains no trade-specific terms (`BICSI`, `trucks`, `service radius`) drawn
   from the `local-trade` set's own fixture — otherwise this criterion is deferred with the
   ordering dependency noted in R5, not silently dropped.
7. `pnpm guard`, `pnpm typecheck`, `pnpm i18n:check` exit 0.
8. Every P0 capability shipped this run has all four dual-track surfaces: grep the diff
   for a matching route file under `apps/daemon/src/routes/`, a DTO under
   `packages/contracts/src/api/`, a component/page under `apps/web/src/`, and a
   `SUBCOMMAND_MAP` entry in `apps/daemon/src/cli.ts`. A capability missing any one of the
   four fails this criterion.

**Morning review (human-judgment, non-blocking):**

- Run the shipped `full`/`standard`/`quick` tiers as a real person and confirm the
  conversation still feels natural (one-or-two-question rule, no checklist-reading) —
  the automated harness in criterion 1 checks structure, not tone.
- Time ≥3 real runs per tier and update the tier labels in R2's table if the observed
  median falls outside the stated band, per the original finding's own fix.
- Confirm the `needs-info` vs `complete` distinction (R1's executable definition) reads
  clearly in the UI to a non-technical reviewer.

### 4.6 Verification

```bash
cd ~/projects/mishmash
pnpm guard && pnpm typecheck && pnpm i18n:check
pnpm --filter @open-design/daemon test
pnpm --filter @open-design/e2e exec playwright test -c e2e/playwright.config.ts e2e/ui/client-interview-flow.test.ts
```

The Playwright target above is a **flat file directly under `e2e/ui/`** importing
`test`/`expect` from `@/playwright/suite`, matching `testDir: './ui'` in
`e2e/playwright.config.ts:30` and the flat-file rule in `e2e/AGENTS.md`. The original
finding's `specs/client-interview.spec.ts` path does not exist in Playwright's config —
`e2e/specs/` is the Vitest tree (`e2e/vitest.config.ts:19`, `include: ['specs/**/*.spec.ts', ...]`)
and would not run under `playwright test` at all. The daemon route/contract/gate tests
(R1, R3, R4, R6 mapping) belong in `apps/daemon/tests/`, not `apps/daemon/src/`, per
`AGENTS.md` "Boundary constraints."

---

## 5. Open questions for Devin

These are the four **DECISION REQUIRED** items called out inline in §4.3. Repeated here
for visibility; do not start the blocked requirement without an answer.

1. **Where do client answers live (blocks R8, R9, R10)?** In your daemon (which makes the
   share link a real service with real PII duties against a currently-loopback-only trust
   model), or does the link need a genuinely separate hosted trust boundary that posts a
   brief back? This decides R8's entire architecture.
2. **How many variants is "a couple" (blocks R12)?** This also decides whether R12 reuses
   the existing `GuidedCreateBrief.iterations` field (already 1–3, already validated) or
   needs a new `variantAxis` field alongside it. Say the word if you meant 2, or meant
   variants of copy rather than direction.
3. **Should `quick` auto-upgrade (blocks the auto-upgrade UX only, not the rest of P1)?**
   Start someone at 5–10 min and offer to keep going when they're engaged — cheap to add
   once the fixed-length tiers exist, and it hedges the tier choice for a client who
   doesn't know how much they have to say.
4. **Who is the default audience of the embed (blocks R11)** — your clients collecting
   *their* customers' briefs, or you collecting your clients' briefs? The copy, and
   possibly the auth model, differ.

---

## Revisions

- 2026-08-18 — captured live during team demo; grounded against code the same session.
  Source questionnaire archived to `assets/`.
- 2026-08-18 — **repaired for unattended execution**, per `docs/plans/2026-08-18-demo-findings/audits/F002-audit.md`
  (verdict: NOT-READY). Every factual correction below was independently re-verified
  against the current repo before being applied; none of the audit's claims were found
  wrong.
  - Fixed the question-form parser claim: the daemon (`question-form-detect.ts`) and web
    (`question-form.ts`) parsers are **not** in sync today — the web parser accepts a bare
    array payload the daemon rejects, proven by an existing regression test. R1 now
    requires reconciling this before building on the contract.
  - Fixed the sharing inventory: `open-design-public-metadata.ts` serves GitHub/Discord
    stats, not sharing. A real share-link flow already exists for published artifacts
    (`cloudflare-pages-helpers.ts` + a tested "Share menu" UI flow) and is now cited
    correctly; it still doesn't cover an interview-invite channel, so G2 is narrowed
    rather than removed.
  - Fixed the false "no answers→project path" claim: `CreateProjectRequest.brief:
    GuidedCreateBrief` already exists end-to-end (contract, daemon route, CLI flags, and
    sanitization tests). G3 and R6 were rewritten to require extending this path, not
    building a parallel one.
  - Fixed R5's dependency on `apps/daemon/src/design/site-archetypes.ts`: that file does
    not exist yet — F001 only proposes it — so R5 now states an explicit ordering
    dependency on F001 R3, and the app-boundary rule that shared vocabulary must live in
    `packages/contracts`, not daemon-private `src/`.
  - Fixed the false claim that F001 R4 "consumes" a shared `ClientBrief`: F001 R4's actual
    output shape (`{ archetype, category, audience, tone[], must_have[], constraints }`)
    is different from `ClientBrief`. R6 and the risk table now require an explicit mapping
    function instead of asserting a shared type.
  - Fixed R3's overstated verbatim rule: the source only requires the client's actual
    words for copy-bound material, not every field.
  - Fixed the "off by 2–3×" framing in G5 to the accurate ~2× at corresponding endpoints,
    and downgraded "the current questionnaire IS the 25–30 min tier" to a working
    hypothesis pending the ≥3-run measurement the PRD itself already required.
  - Closed the dual-track UI/CLI closure gap: every P0/P1/P2 requirement now names its
    HTTP endpoint, contract DTO, web surface, and `od` subcommand explicitly, per
    `AGENTS.md` "Capability exposure."
  - Fixed the Playwright verification command: `specs/client-interview.spec.ts` does not
    exist in Playwright's config (`specs/` is the Vitest tree); replaced with a flat
    `e2e/ui/*.test.ts` target importing `@/playwright/suite`.
  - Replaced the human-timing-gated success criterion with an automated structural oracle
    the run can actually satisfy overnight, and moved the real-human-timing verification
    to a new, explicitly non-blocking "Morning review" list, per the no-human-gates rule.
  - Added an executable definition for "vague" (closing a real validation gap:
    `QuestionForm.tsx`'s current required-field check accepts any non-empty string, so
    `"my main line"` would pass unless R2/R4 specify the stricter server-side check) and
    for the R1/R4 "I don't know" vs completion-gate conflict.
  - Flagged the previously-undocumented collision between R12's "N variants" and the
    already-existing, already-validated `GuidedCreateBrief.iterations` field.
  - Converted the four genuinely-unmade decisions (storage architecture, variant count,
    quick-tier auto-upgrade, embed audience) into explicit `DECISION REQUIRED (blocks Rn)`
    markers scoped to only the requirements they block, so P0 can proceed unattended
    without them.
  - Re-verified every numeric claim carried over from the original (233-line
    `recommendation.ts`, 926 B `social-share.ts`, 2.5 K `open-design-public-metadata.ts`,
    135-line questionnaire asset) against the live repo; all four were already correct and
    are kept.
