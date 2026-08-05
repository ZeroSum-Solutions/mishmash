# MishMash Model Routing System — Frameworks, Models, Routing, Ingestion

*v3.0 — 2026-08-05. v1 was adversarially reviewed by GPT-5.6 Sol (Codex, code-level) and Grok 4.5 (OpenRouter); all HIGH findings verified against the repo and dispositioned in §7. Sol's confirmation pass on v2 graded 7 RESOLVED / 7 PARTIAL / 2 new HIGHs; v2.1 patches both new HIGHs (fail-closed data-classification routing; rights-clean fidelity stats replacing SSIM-vs-kit-preview) and the sharpest PARTIALs (side-effect redispatch limits, wave identity in P0, routing-key fallback, baseline rules). Grounding: verified routing research brief (NotebookLM `748b81ef`), MishMash architecture + design-asset explorations (this session), Client Website Studio PRD (2026-08-03) incl. its §15 model-routing table and §21 stop-rule state, `docs/design-authority.json`, `~/Desktop/Design Assets/RIGHTS.md` + `catalog.json`. Tags: `[PUBLISHED]` = byte-verified research; `[REPO]` = verified in code/filesystem this session; unmarked = engineering judgment.*

---

## 0. What exists vs. what we're building

**Exists** `[REPO]`: daemon composes prompt (project + design system + template + craft rules) → spawns ONE user-selected runtime CLI per chat run (26 runtime defs); same-agent single retry before any side effect (`run-retry-policy.ts`); post-run aggregate usage recording (`usage-tracking.ts`, cost often estimated/unavailable); static **HTML-only** deploy adapter to customer Vercel/Cloudflare (`deploy.ts` rejects non-HTML entries and Vercel production targets); 151 bundled design-system packages (2.0 shape); 112 templates with `od.mode`; extraction atoms (`figma-extract`, `design-extract`, `token-map`); an adversarially-audited eval harness pattern (`evals/selector`); a wave/lease governance system currently in a stop-rule state for the Client Website program (PRD §21).

**Not building**: a learned router (commercial routers often fail to beat simple baselines `[PUBLISHED]`; routers plateau far below oracle `[PUBLISHED]`); a mid-run model switcher (unsafe across stateful CLI sessions `[REPO]`); managed hosting (PRD non-goal).

**Building**, in order: (1) a deterministic dispatch-time routing policy with telemetry and admission control; (2) verifier-gated, run-boundary cascades; (3) a real multi-stage orchestration graph (which does **not** exist today — current granularity is one prompt → one CLI run `[REPO]`); (4) a rights-laned design-kit ingestion bridge; (5) framework deploy lanes beyond static HTML.

---

## 1. Build taxonomy → frameworks (corrected)

**Design-authority constraint first** `[REPO]`: MishMash disclaims operator frontend defaults; source-of-truth order is (1) cloned target's own CSS when reproducing, (2) client brief, (3) selected design-system package. So the stacks below are **greenfield generation defaults**, always subordinate to that order — never a "universal stack."

Two website lanes, because the deploy reality differs `[REPO]`:

| Build class | Lane | Stack | Deploy | Status |
|---|---|---|---|---|
| **Full websites — campaign/landing/brand** (most marketing work incl. film/sports/agency one-pagers) | **A: MishMash-native static** | Single/multi-file HTML+CSS+JS artifacts from templates (`saas-landing`, `web-prototype`, `webgl-experience`...), tokens from the design system, motion via `motion` **and/or GSAP — generating GSAP code is permitted** (`docs/decisions/gsap-licensing.md`, Accepted 2026-07-25) `[REPO]` | **Works today**: existing HTML adapter → customer Vercel/Cloudflare `[REPO]` | Ship now |
| **Full websites — larger/multi-page/CMS-backed** | **B: Framework project** | Next.js 16 App Router + Tailwind v4 + shadcn/ui + Motion, static-first (SSG/ISR) | **New work**: framework deploy adapter (Vercel CLI or git-connected project; the current adapter cannot build Next.js `[REPO]`) | Phase 5 |
| **Web apps** (SaaS, portals, booking) | B | + RSC + TanStack Query v5 + Supabase (house org) | Same new adapter + Supabase provisioning | Phase 5 |
| **CRM dashboards** | B | Next.js + shadcn admin composition (TanStack Table, shadcn charts) + Supabase RLS. No heavy admin frameworks | Same | Phase 5 |
| **Mobile applications** | **C: Native** | React Native + Expo (EAS) + Expo Router. **Token bridge is a subset transform** — Style Dictionary from `design-tokens.json` → RN theme (color/spacing/type/radius only; layout/motion/shadows do NOT round-trip). NativeWind v4 targets Tailwind 3.4; v5 (Tailwind v4) is pre-release — so tokens go through Style Dictionary, not `tailwind-v4.css` reuse | EAS (stores); Expo web preview via lane A | Phase 5+, new infrastructure |

**Conversion architecture** (Grok F20): lane A/B ship-gates include Lighthouse CI budgets (CWV), SEO metadata checks, axe accessibility, link/form smoke tests — deterministic, part of §3 L3. Vertical range is served by the design-system layer *plus* per-brief craft lanes (WebGL/scroll-cinema templates) — the framework stays boring so the design layer can be bold.

---

## 2. Model assignments (with program-governance alignment)

**PRD §15 governs in-program dispatch** `[REPO]`: Grok 4.5 → **prepaid Nous Portal**; Fable 5 → Claude Code OAuth only; `deepseek-v4-flash` → direct DeepSeek endpoint (slug rechecked at dispatch); Gemini visual review → `agy`; Opus 5 code adversary → Claude OAuth; mechanical verification → deterministic scripts, not models. **"No Anthropic model may use API credits, Nous, or OpenRouter for this program."** The routing policy file encodes these as hard constraints. (This session's Grok-via-OpenRouter review predates this alignment; future in-program Grok calls go through Nous.)

**Lane realism** (Grok F2): subscription lanes (Claude Max, Codex, `agy`) are **rate-limited pools with session caps, not free meters**. The router treats them as preferred-but-exhaustible: observed throttles (429s, stream stalls) advance the chain subscription → prepaid (Nous, Moonshot) → metered (DeepSeek direct, OpenRouter) under L4 caps.

Verified anchors: Opus 5 $5/$25 · Sonnet 5 $2/$10→$3/$15 after 2026-08-31 · Haiku 4.5 $1/$5 · Fable 5 $10/$50 · GPT-5.6 Sol $5/$30, Terra $2/$12, Luna $0.20/$1.20 · Gemini 3.1 Pro $2/$12 doubling >200k · Grok 4.5 $2/$6 · DeepSeek V4-Flash $0.14/$0.28 cache-miss (budget at cache-miss; one-shot ingestion earns few cache hits — Grok F5) · Kimi K3 1M ctx — all `[PUBLISHED]`; Claude 4.6+ long-context flat `[PUBLISHED]`.

| Task class | Primary | Burst/alt | Cheap | Notes |
|---|---|---|---|---|
| Art direction, IA, brief analysis | Opus 5 (high) | Gemini 3.1 Pro via `agy` | — | **Provisional**: design capability is unbenchmarked anywhere in the verified set (Grok F4). The §3 eval loop exists to replace this judgment with our own data. |
| Long-horizon autonomous builds | Fable 5 (OAuth only, per PRD) | Opus 5 | — | House lane policy + PRD §15. |
| Section/component codegen | Sonnet 5 | GPT-5.6 Terra | Kimi K3 (prepaid) | SWE-bench cost-bend: ~75–76% at $0.07–0.55/task `[PUBLISHED]` — a *coding* proxy only, not a design proxy (Grok F3). |
| Mechanical/batch (variants, remaps, page multiplication) | Haiku 4.5 | GPT-5.6 Luna | DeepSeek V4-Flash direct | Machine-checkable output → cascade covers risk. |
| Token distill (derived JSON only — see §4 rights) | DeepSeek V4-Flash | Kimi K3 | — | Operates on token bags, never kit source. |
| DESIGN.md prose | Sonnet 5 | Opus 5 review | — | |
| Code adversary / review panel | Opus 5 (per PRD §15) + GPT-5.6 Sol | Grok 4.5 via Nous | Haiku triage | **Merge rule** (Grok F11): any-veto on deterministic-check failures; for stochastic findings, two-of-three agreement escalates to human. |
| Long-context ops | Sonnet/Opus 5 (1M flat `[PUBLISHED]`) | Kimi K3 | DeepSeek V4-Flash | Route by pricing structure; never use long context as retrieval (multi-needle degrades `[PUBLISHED]`) — chunk + targeted queries. |
| Research (verticals, site-blueprint) | Gemini via `agy` | WebSearch | — | Grounding economics `[PUBLISHED]`. |
| Visual QA (advisory) | Gemini via `agy` (per PRD §15) | Opus 5 vision | — | Advisory ship-report only — never a cascade trigger (§3). |

---

## 3. The routing system (rebuilt on the real architecture)

### 3.1 Honest boundaries (from Sol's review, verified)

- **Binding point = dispatch time.** The router selects `(runtime, model flag, effort, lane, prompt composition)` **before spawn**. It cannot bind an agent CLI's inner loop (subagents, self-chosen models) — mitigation: per-runtime model pinning flags and settings where supported, plus post-run usage reconciliation that flags runs whose observed usage diverges from the routed intent.
- **No mid-run switching.** Cross-runtime escalation happens only at **run boundaries** with clean re-dispatch: project files snapshotted before the run (backup manifest infra per PRD §9.3), rollback on abandonment, fresh context on escalation. The existing one-same-agent-retry-before-side-effects policy `[REPO]` stays the only intra-run retry. **Scope limit (Sol v2 #3): snapshots cover project files only.** Runs that perform external side effects (DB migrations, git pushes, network calls, Supabase changes) are marked non-redispatchable in the policy — escalation for those requires human acknowledgment, never automatic re-run.
- **Budgets are admission control, not mid-run meters.** Usage arrives post-run, sometimes estimated `[REPO]`. So L4 enforces: pre-run estimated-cost ceiling per stage (deny dispatch if lane meter + estimate exceeds cap), per-build and per-day caps checked at every dispatch, stream-level heuristics (context-growth alarm, wall-clock ceiling, retry ceiling) to kill runaway runs, and post-run reconciliation with a conservative headroom margin against provider billing lag (Grok F15).
- **Routing key** (Sol #5): `od.mode` is too coarse (most web things are `prototype`). Key = **template id** × **build-class from ClientWebsiteBrief** (the PRD's durable brief object) × **stage** (§3.3) × **tokenizer-estimated context of the composed prompt** (not file-plan size — Grok F10) × **lane meters**.

### 3.2 Layers

- **L1 Reliability** — per-runtime observed-failure cooldowns (spawn errors, auth probe failures, stream-detected throttles), lane-ordered fallback chains, exponential backoff. Built on what CLIs actually expose — not LiteLLM API-health semantics (Grok F8); `litellm-models.json` stays a metadata source only.
- **L2 Policy** — versioned `routing-policy.json` (the §2 table + PRD §15 constraints as hard rules) + a `check-context-isolation`-style test that fails on unknown stages, missing constraints, or drift `[REPO pattern]`. Both Sonnet prices carried with an effective date. **Data classification is part of the policy** (Sol v2-HIGH-1): every dispatch carries a sensitivity class (client-confidential / internal / public); each class has a provider allowlist, and fallback is **fail-closed** — if all allowed lanes for a class are exhausted, the run stops and surfaces to the human; it never falls through to a provider outside the class allowlist. Client-confidential briefs/code default to subscription lanes only unless the client's own agreement says otherwise.
- **L3 Gates, two classes** (resolves Grok F9/F13, Sol #12):
  - **Deterministic (cascade triggers)**: TS compile, ESLint, `design.md lint`, `tokens.schema.ts`, link/form smoke, axe accessibility, Lighthouse CI budgets, screenshot SSIM against per-build baselines, Supabase migration dry-run + RLS tests for app builds (Grok F21). Cheap→mid→frontier escalation only on these.
  - **Stochastic (advisory ship-report)**: vision-model conformance vs DESIGN.md, review-panel prose findings. Reported to the human ship gate; never auto-escalate. Gate-tax budget: verifier spend capped per build.
- **L4 Budget governor** — as §3.1; metered-lane hard kill-switch; variation fan-out capped by remaining build budget (Grok F24).
- **L5 Telemetry** — SQLite (daemon's existing DB layer; WAL, single-writer through the daemon process — Grok F26): stage, template, design system, routed vs observed model, tokens, cache hits, latency, cost (estimated flag), gate outcomes, escalations. Weekly policy review: stage escalation rate above its alarm → fix the table. This dataset is the only path to ever justifying learned routing `[PUBLISHED]`.

### 3.3 The orchestration graph is new work

Today: one brief → one run `[REPO]`. The multi-stage pipeline (art-direction → token freeze → shared shell + **primitive extraction** → section fan-out → **consolidation pass** → review panel → ship gate) is a new orchestration capability, phased after the policy layer. Corrections baked in:

| Stage | Parallel? | Discipline |
|---|---|---|
| Brief → art direction → token freeze | Serial | Frozen tokens are versioned; any change revs the freeze and **invalidates dependent sections** (compensation saga — Grok F14). |
| Shared shell + primitives | Serial | Buttons/cards/nav/spacing generated ONCE here; sections import, never redefine (Grok F23, Sol #11). |
| Section/page fan-out | Parallel, **file-leased** | Adopt the wave/lease allowlist pattern from the PRD `[REPO]`: each section run gets an exact-file allowlist; shell/routes/lockfiles are lease-protected. Consolidation pass dedupes drift before review. |
| Variations (G4) | Parallel, capped N | Shared frozen prompt prefix → cache write once, read N (cache economics `[PUBLISHED]`). |
| Review panel | Parallel | Merge rule per §2. |
| Deploy | Serial, human-gated | PRD non-goal: no auto-deploy. Deploy security: sandboxed build, diff review, secrets stay in the credential boundary `[REPO]` (Grok F17). |

### 3.4 Capability closure (Sol #13)

Routing ships as a full MishMash capability, not a private module: DTOs in `packages/contracts` (routing decision, policy, telemetry row), daemon routes (`/api/routing/*`), web UI (decision + "why this model" + override + lane meters), `od route` CLI (`--json`), policy+telemetry in backup/restore, capability-manifest parity, focused tests + wave verifier.

### 3.5 Governance (Sol #14)

The Client Website program is in a stop-rule state with lease-gated tranches `[REPO]`. This plan is **pre-lease input**: implementation enters through the wave system on fresh main after gates clear — it does not bypass W3→W5→W6a ordering. Files this plan touches that intersect existing leases (`registry.ts`, contracts, CLI) get their own lease map before any tranche starts.

---

## 4. Design-kit ingestion (rights-first rebuild)

**Canonical counts from `catalog.json`** (Sol #10): 273 collections → **12 `own-code`**, **45 `licensed-source-review`** (UI8), **216 `human-local-only`**, remainder pending. (Directory census differs from catalog kinds; catalog is canonical.)

**Rights lanes** `[REPO — RIGHTS.md hard lines]`:

| Rights state | What the pipeline may do |
|---|---|
| `own-code` (12) | Full automated extraction, any lane, packages may live anywhere. |
| `licensed-source-review` (45, UI8) | **Local deterministic extraction only** — kit source never uploaded to any third-party API (no DeepSeek/Kimi/OpenRouter on source; "never re-hosted" `[REPO]`). LLM-assisted steps operate ONLY on derived token bags (numbers/names = written design decisions, the ledger's sanctioned travel format). Kit markup/components are **not** copied into packages. **Output packages land in the local user-import store (daemon data root), never the MishMash git repo** (hard line 1: nothing from the library enters its tree `[REPO]`). Each kit gated on the per-item receipt reconciliation the ledger requires (TODO Devin — this is a real precondition). |
| `human-local-only` (216) | **Excluded from extraction entirely.** Inspiration/reference viewing feeds human-written evidence notes only. Never model inputs, never token sources (screenshot-to-third-party-API = re-hosting `[REPO]`). |
| `blocked-pending-license` | Quarantine. |

**Pipeline (per eligible kit):** classify from catalog → sandboxed unpack/parse (container with resource limits, `--ignore-scripts`, zip-bomb/symlink guards, no builds except allowlisted kits — Sol #9/Grok F30) → deterministic CSS/computed-token extraction (`design-extract` atom) → LLM distill on the derived token bag only → `DESIGN.md` prose (Sonnet 5) → verify: schema + lint + preview render + **token-level fidelity stats** (extracted palette/type-scale/spacing coverage measured against the kit's computed-CSS statistics — pure numbers, no image comparison; screenshot-vs-kit-preview matching is OFF the table because the rights ledger forbids pixel-matching references `[REPO]`, and Sol's v2 pass flagged SSIM-vs-kit-preview as operationalizing exactly that) + human sample review of previews (local viewing is permitted) → register in the local store with `evidence.md` provenance (source, rights, receipt ref, scorer version). Durable queue with checkpoints, content-hash dedupe, idempotent registration.

**Selection story** (Grok F31): every package manifest carries vertical/mood/density tags + an embedding index so a ClientWebsiteBrief retrieves candidate systems — ingestion without retrieval just moves the bottleneck.

**Realistic first wave** (Sol #10): 12 own-code + licensed kits *as receipts are reconciled* — tens, not "60+". The 22 `.fig` kits are a **staffed ops session** (manual Figma open → clipper/`figma-extract`), scheduled explicitly, not hidden in a phase.

---

## 4b. The Craft System — how we actually get good at award-tier sites

*Added 2026-08-05 from the audited teardown of 154 sites in the design-inspiration library (`~/Inbox/notes/design-inspo-stack-teardown-2026-08-05.md`, NotebookLM `738b790e`). Numbers below are `[MEASURED]` = within-sample signature counts from that study, with its stated limits (convenience sample, static-fetch detection, platform-varying sensitivity). Everything else is craft judgment.*

**Read the census weakly.** Static homepage fetch with no JS execution **systematically under-counts exactly the stack this section prioritizes** (GSAP, Lenis, WebGL, Barba are all easier to see on Webflow than in a bundled Next build). So prevalence figures below are directional evidence that a technique is *in the working vocabulary of sites we admire* — they are **not** a ranking of what matters, and they must not be used to justify build order on their own. Where I sequence work below, the reason is engineering dependency, not census rank.

**The working thesis (judgment, not a finding): the framework is not the differentiator.** 43% of that library is a no-code builder and 27% a JS meta-framework `[MEASURED]`. What appears to separate the standouts is a **craft layer — layout, type, motion, compositing, media** — that is largely portable across stacks. If that thesis is right, we systematize the craft layer once and apply it to every lane. **We should test it rather than assume it** (§4b.8).

### 4b.1 Add a Motion & Craft token layer to design-systems 2.0

Today's packages carry color, type, spacing, radius. **None of the 151 bundled systems carries a motion, layout, or media contract** `[REPO]` — so all of it is re-improvised per build and cannot be graded. Extend `design-systems/_schema/tokens.schema.ts`. **Tokens need semantics, not just names** — each below specifies unit, resolution time, and conflict behavior:

**Motion tokens**
| Token | Unit / type | Resolved | Conflict rule |
|---|---|---|---|
| `easing.{entrance,exit,emphasis}` | cubic-bezier 4-tuple | build-time → CSS var | — |
| `duration.{instant..cinematic}` | ms integer scale | build-time → CSS var | reduced-motion clamps all to ≤1 frame |
| `stagger.{tight,base,loose}` | ms per item + max total | build-time | total capped; overflow drops stagger to 0 |
| `scrub.{range,pin}` | **vh integer + boolean** (page choreography, so it lives in a `section` scope, not global) | runtime | if `pin` and View Transition both active on a route change, **pin loses** |
| `reveal.primitive` | enum `clip-inset\|translate-mask\|blur-in` | build-time | one per system; components may not introduce another |
| `texture.{grain,blend}` | opacity float + `mix-blend-mode` enum | build-time | — |

**Layout & compositing tokens** (the dimension I originally missed)
`grid.{columns,gutter,margin}` per breakpoint · `breakout.{full-bleed,wide,prose}` named escape widths · `zRhythm` overlap/stack depth scale · `measure` target line-length in ch · `paintBudget` max simultaneously-promoted layers + max stacked blur/filter passes.

**Media art-direction tokens**
`crop.{ratio,focalPolicy}` · `artDirection` per-breakpoint source slots (not just `srcset` density) · `posterPolicy` (poster is LCP, video deferred) · `motionMediaCeiling` max concurrently-playing video elements.

**Typographic craft tokens** (beyond the scale)
`opticalSizing` · `orphanWidowPolicy` · `trackingByScale` (display tracks tighter than body) · `numerals` (tabular in data UI).

**Interaction affordance tokens**
`focusRing` (visible, non-suppressible) · `pressState` · `hitTarget` min px · `cursorPolicy`.

**Resolution rule that makes this gradeable:** generated components may not contain raw durations, easings, blur radii, z-indices, or grid values — they must reference tokens. That is an AST-checkable assertion (walk generated CSS/TSX for literal values in those properties), which is what turns "no drift" from rhetoric into a lint rule.

### 4b.2 Build the Tier-0 craft primitives once

Framework-agnostic, vanilla-first, drop into the **existing static-HTML lane** — which already deploys to customer Vercel today `[REPO]`. Ordered by measured prevalence and effort:

| Primitive | In-library prevalence `[MEASURED]` | Notes |
|---|---|---|
| Smooth scroll (Lenis wrapper) | 47% — the only library crossing Webflow/Framer/custom alike | Must gate on `prefers-reduced-motion` and touch |
| Mask/clip reveal | `clip-path` 45%, `mask` 34% | Cheaper and more "editorial" than opacity fades |
| Scroll-scrubbed pinned section | ScrollTrigger 21%, sticky 24% | Bind progress to position, not a boolean trigger. GSAP ScrollTrigger is available — code generation is licensed `[REPO]`; pin exact versions per the decision doc |
| Fluid type scale (`clamp()`) | only 15% | Easy edge over the library |
| Marquee / ticker | 36% | 10 lines of CSS; velocity-reactive variant off Lenis |
| Grain / noise overlay | only 8% | Two lines; kills the flat-AI-gradient look |
| Lerped custom cursor | 35% | `pointer: fine` only |
| Kinetic split-text headline | SplitText 16% | Keep source text in DOM for a11y |
| Route transition | Barba 12%, **View Transitions only 3%** | Use View Transitions — replaces Barba's machinery |
| Background video discipline | 51% — most-used device | Poster is LCP; video deferred; no audio track |

**Two deliberate ahead-of-library bets:** CSS **View Transitions** (3% adoption) and CSS **scroll-driven animations** (8%) `[MEASURED]`. Both delete JavaScript. Standardizing on them makes our output lighter *and* more current than most of the reference set.

### 4b.3 Make "one impossible moment" a required brief field

The pattern across every standout: exactly **one** thing that shouldn't be possible in a browser, with everything else restrained. Amateur output applies five effects at 60% quality.

Add `signatureMoment` to the ClientWebsiteBrief: `{ kind: webgl-hero | shader-transition | cursor-composite | scroll-cinema | kinetic-type | none, rationale }`. It drives three things at once — art direction, **budget**, and **routing** (a `webgl-hero` routes the frontier tier plus an R3F specialist path; `none` routes cheap).

**Guard against it becoming checkbox WebGL:** the enum alone incentivizes picking the expensive option. Pair it with a **restraint assertion** — exactly one signature moment per site, and the rubric (§4b.8) scores *restraint elsewhere* as its own dimension. A site with three "signature" moments fails on restraint regardless of how well each is executed. `none` is a legitimate, often correct answer.

**Anti-convergence rule — added from the falsification test.** Two builders given the same open brief, working independently with no knowledge of each other, chose the *identical* signature moment: a scroll-linked SVG contour line that draws itself. Left alone, model priors will template the one gesture across every client site, destroying the differentiation the field exists to create. So: `signatureMoment` is **chosen by a human at art direction**, not proposed by the model, and the brief carries an exclusion list of the last N devices already shipped. Track shipped signature moments in telemetry so the exclusion list is real data rather than memory.

### 4b.4 WebGL is a priced premium tier, not a default

Only **4 of 154 sites** carry confirmed WebGL renderer calls `[MEASURED]`. Treat it as an explicit upsell with its own lane: React Three Fiber on Lane B, or Spline for designer-driven work. Always ship a static fallback and gate on device capability + reduced-motion. Do not let it become the default hero.

### 4b.5 Extend the deterministic ship gates for craft

These techniques break exactly the things our L3 gates measure, so wire them together (§3.2):

- **CWV budget** — background video + preloader + smooth scroll is a Lighthouse disaster if unmanaged. Assert poster-as-LCP, video not render-blocking.
- **Reduced-motion assertion** — every motion token must have a fallback path; fail the build if any animation lacks one.
- **Preloader ceiling** — 34% of the library ships one `[MEASURED]` and most are pure cost. Gate: must be driven by real asset-decode promises, must be skippable, must exit under a configured ceiling.
- **No-JS content visibility** — **added from the falsification test**, which caught this live: content must be present and readable with JavaScript disabled. Scroll reveals may only animate *from a visible baseline*, never *into existence*. Lane A's build rendered an almost entirely blank page in any context where the IntersectionObserver never fired (full-page capture, JS off, some crawlers, print). Ship CSS with content visible by default; let JS add the reveal.
- **A11y on kinetic type** — split-text must preserve readable text for screen readers.
- **Token conformance (AST)** — no raw durations, easings, blur radii, z-indices, or grid values in generated components.
- **Paint budget** — assert promoted-layer count and stacked-filter passes stay within `paintBudget`.
- **Typographic measure** — body line-length within the system's `measure` range at every breakpoint.
- **Focus visibility** — no `outline: none` without a compliant replacement; every interactive element keyboard-reachable.

**These gates prove safety, performance and system-conformance — they do NOT prove craft.** Passing lint is not the same as being good, and this plan should never imply otherwise. Craft judgment is handled separately in §4b.8.

### 4b.6 Structure, never surface

What transfers from a reference is **section order, pacing, scroll rhythm, type-scale ratio, motion timing** — never imagery, copy, or palette. This is simultaneously the rights rule already binding the asset library (`RIGHTS.md`: learnings travel as written notes, references are "not inputs to be traced, redrawn 1:1, or pixel-matched") `[REPO]`, the PRD's reference-rights model `[REPO]`, and simply better design practice. It also settles the ingestion-fidelity question from §4: we grade extraction on **token-level statistics**, never on pixel-matching a licensed kit's preview.

### 4b.7 What this changes about lane priority

Most Tier-0 craft needs **no framework** — it is vanilla CSS/JS over frozen tokens, so it can ship in Lane A now. **But the boundary is narrower than I first wrote.** Craft that depends on framework lifecycle does *not* transfer for free: cross-route View Transitions, shared app-shell layout, hydration-boundary-safe scroll pinning, CMS-driven section sequencing, and commerce overlays all need Lane B. Building those twice is real waste.

So the correct sequencing is: **tokens and single-page primitives first** (genuine, reusable, no rework), **route- and lifecycle-dependent craft deferred to Lane B** rather than prototyped in vanilla and re-done. Where a primitive has both a vanilla and a framework form (transitions especially), write the token contract once and implement per lane against it.

### 4b.7b Adopt `emilkowalski/skills` as the craft-taste layer

[`github.com/emilkowalski/skills`](https://github.com/emilkowalski/skills) — **25,199★, MIT, pushed 2026-08-02** `[REPO-VERIFIED via GitHub API 2026-08-05]`. Eight skills by Emil Kowalski (Sonner, Vaul; ex-Vercel/Linear), the author of [animations.dev](https://animations.dev/) — an interactive animation course with 11,632 enrolled designers/engineers `[PUBLISHED — animations.dev, fetched 2026-08-05]`.

**Why this matters more than a normal dependency:** its thesis is exactly the gap this plan identified — *"Agents don't have great taste… an `ease-in` easing for an enter animation when it's supposed to be `ease-out`… all these small things compound."* That is the §4b problem stated by a domain expert, with the fixes enumerated.

**Striking corroboration:** MishMash's own `AGENTS.md` "UI animation philosophy" already encodes Emil's rules nearly verbatim — the identical `cubic-bezier(0.23, 1, 0.32, 1)` default, "built-in `ease` is too weak," "`ease-in` is forbidden for UI," asymmetric enter/exit (~200ms/~140ms), and "never animate from `scale(0)`, start at `scale(0.9)`" `[REPO]`. The house philosophy and this library are already the same doctrine. Adopting it makes that doctrine *machine-applicable* rather than prose an agent may skim.

| Skill | Use in our system |
|---|---|
| `emil-design-eng` (27KB) | The core taste reference — load during art direction and section codegen |
| `review-animations` + `STANDARDS.md` (10KB) | **Direct source for the §4b.1 motion token values.** Ships the frequency table (100+/day → never animate), the easing decision order, duration bands per element type (button 100–160ms, tooltip 125–200ms, dropdown 150–250ms, modal 200–500ms, UI ceiling 300ms), and the physicality rules |
| `improve-animations` + `AUDIT.md` | Codebase-wide motion audit producing prioritized, self-contained plans — maps onto our advisory ship-report (§4b.8) |
| `find-animation-opportunities` | Notably also says **what not to animate** — the restraint half |
| `animation-vocabulary` (13KB) | Reverse-lookup glossary (vague description → exact term). Useful as a **routing-key vocabulary** so a brief's motion intent resolves to a named technique instead of a paraphrase |
| `apple-design` | Apple HIG motion/interface principles distilled for web |
| `pick-ui-library` | Stops agents hand-rolling a toast or installing an abandoned package |
| `prototype` + `PICKER.md` | Builds several variants of a UI piece with a switcher — matches our variation fan-out (§3.3) |

**Adoption — DONE 2026-08-05.** Vendored as **`zs-skills/skills/engineering/motion-craft`** (symlinked to `~/.claude/skills/motion-craft`), pinned to upstream commit **`da80201b64de7d608a6dc5f723797ce6c65b692b`** (2026-08-02). 13 files, verified byte-identical to the pin by sha256; LICENSE preserved verbatim; scanned clear against all three store bans; `lint: OK`, quality gate OK; `lane: experimental` pending curator promotion. Pin record, path map, integrity manifest and a deliberately human-only update procedure live in that skill's `UPSTREAM.md` — **no auto-update**, because the specific duration and easing values are exactly what we depend on. Use `STANDARDS.md` as the seed values for the motion tokens in §4b.1 — **this replaces my invented duration scale with expert-sourced bands.** Two boundaries: (1) its guidance is *app/product UI*-weighted, while much of our work is *marketing/editorial*, where longer cinematic durations are legitimate — keep `--dur-cinema` as a marketing-only token outside the 300ms UI ceiling; (2) it is taste guidance, not a license to expand visual motion-authoring UI (the GSAP constraint in §6.7 still binds).

### 4b.8 Judging craft — the part lint cannot do

Everything in §4b.5 is falsifiable engineering. **Craft is not**, and a plan that pretends otherwise will ship compliant, boring sites. So make the subjective judgment explicit and structured instead of hiding it behind a gate:

- **A named rubric**, scored 1–5 per dimension, versioned with the design system: *spatial composition · type hierarchy & pacing · motion restraint (is there exactly one signature moment?) · compositing quality · media art direction · overall coherence*. Store scores in telemetry alongside cost — this is the dataset that eventually answers "which model actually designs best," which no published benchmark currently does `[PUBLISHED: unmeasured]`.
- **Reference-pair comparison, not absolute scoring.** Present the build beside two reference-tier sites from the same vertical; reviewer ranks. Ranking is far more reliable than asking "is this award-tier?"
- **Human is the final judge. This is now empirically grounded, not just caution.** In the falsification test, **Gemini 3.1 Pro and Grok 4.5 returned opposite verdicts on identical screenshots, both at "high confidence"** — reading the same hero negative space as "masterful" vs "reads unfinished," and the same accent usage as "fails the restraint test (2/5)" vs "exactly one standout (5/5)." Grok was self-consistent across two runs, so this is genuine inter-model disagreement, not noise. **A single vision model wired as a craft gate would have been a coin flip decided by vendor choice.** Vision scoring stays advisory. Add one rule: **panel disagreement itself routes to human review** — divergence is the signal.
- **Model panels find weaknesses; they do not rank.** The same test showed real convergent signal underneath the disagreement — 2 of 3 judges independently flagged accent-diffusion on one build and weak product illustration on the other. Use panels to surface candidate weaknesses for a human to weigh; never to pick a winner.
- **Falsify the §4b thesis — DONE (pilot), see §4b.9.**

I am deliberately not defining a numeric pass bar here. Any threshold I invented would be arbitrary, and arbitrary thresholds presented as standards are how "systematized craft" becomes checkbox mediocrity.

### 4b.9 Falsification test — RESULT (run 2026-08-05, pilot)

Full protocol and artifacts: `~/Inbox/plans/craft-falsification/` (`RESULT.md`, `BRIEF.md`, `TOKENS.md`, both builds, 8 blind screenshots, raw judge verdicts).

**Design.** Identical frozen brief + identical frozen tokens. Two independent builder agents, run in parallel, **neither told it was a comparison**. Lane A = one self-contained static HTML file, zero dependencies, hand-written motion. Lane B = Next.js 16 App Router + TypeScript + CSS Modules, componentized, static export. Screenshots captured at a real 1440×900 viewport with scrolling (so scroll-linked states fired), then anonymized and randomized before judging.

**Verdicts (blind):**

| Judge | Winner | Confidence |
|---|---|---|
| Gemini 3.1 Pro | Lane B (Next.js) | High |
| Grok 4.5 — run 1 | **Lane A (static)** | High |
| Grok 4.5 — run 2 | **Lane A (static)** | High |
| GPT-5.6 Sol | **Lane A (static)** | Medium |

**3 of 4 favoured the static lane.** A single 29KB HTML file with no dependencies was judged equal or better than a componentized Next.js build from the same brief and tokens.

**Verdict on the thesis: SURVIVES, weakly.** Framework choice did not determine craft outcome, which confirms §4b's priority order — build craft primitives in the static lane first (P2.5 before P5); Lane B earns its place on CMS/app/commerce needs, not visual ambition.

**The honest limit:** n = 1 brief, 1 build per lane, so **builder skill and effort are fully confounded with lane.** I cannot separate "the static lane suffices" from "that builder did better work." (Lane B actually spent *more* effort — 181k tokens/75 tool calls vs 156k/55 — and still lost 3–1, which mildly strengthens the read without fixing the confound.) **This is a pilot, not proof.** The real version — several briefs × randomized builders per lane — stays on the roadmap, and no strong claim should be made until it runs.

Two additional findings from the same run are folded into §4b.3 (anti-convergence: both builders independently chose the identical signature moment) and §4b.5 (no-JS content-visibility gate: Lane A rendered blank without scroll events).

## 5. Phases (rebuilt)

- **P0 Governance + closure scaffold** — obtain an authorized wave identity with exact criteria and a verifier contract for this program (Sol v2 #14); lease map vs. active waves; contracts/routes/CLI/UI skeletons for the routing capability. Also: routing-key fallback defined for non-brief work (general chat = runtime default + template id; ingestion and mobile get their own stage keys — Sol v2 #5), and screenshot-baseline rules written (baseline = first frontier-passed render, versioned with the token freeze, with negative controls — Sol v2 #12). *Gate: wave verifier passes; no lease collisions.*
- **P1 Policy + telemetry (advisory)** — `routing-policy.json` + policy test + telemetry rows + lane meters; router recommends, human confirms. *Gate: every run logs a complete row incl. routed-vs-observed model.*
- **P2 Dispatch routing + admission control + deterministic gates** — router decides by default (override in UI); pre-run cost ceilings; L3 deterministic gates wired for lane-A websites. *Gate: escalation/pass rates visible; selector-eval floors unchanged.*
- **P3 Run-boundary cascade + variations** — snapshot/rollback re-dispatch; capped variation fan-out with shared-prefix caching. *Gate: cost-per-build and wall-clock vs P1 baseline; roll back what's slower or costlier.*
- **P4 Orchestration graph** — stages of §3.3 as leased runs; primitive-extraction + consolidation passes; review panel. *Gate: measured end-to-end build quality/cost vs P2.*
- **P2.5 Craft system (§4b).** Craft token layer (motion + layout/compositing + media + typographic + interaction) in the design-systems schema; single-page Tier-0 primitives in the static lane; `signatureMoment` + restraint assertion; craft ship-gates incl. AST token-conformance, paint budget, measure, focus visibility. **Starts with the §4b.8 falsification test** (matched Lane-A vs Lane-B builds, blind-ranked) so we learn whether the craft-layer thesis holds before scaling the library. *Gate: all deterministic craft gates green on a reference build, rubric scores recorded in telemetry, and the falsification test has produced a result either way. Route/lifecycle-dependent craft is explicitly deferred to P5, not prototyped twice.*
- **P5 Framework deploy lanes + ingestion bridge** — Next.js deploy adapter (Vercel CLI/git project); Expo lane; rights-laned ingestion first wave. *Gates: a lane-B site deploys to customer Vercel with CWV budgets green; N packages pass fidelity floors with receipts on file.*
- **P6 (conditional) learned routing** — only if telemetry shows the static table measurably leaving money/quality on the table `[PUBLISHED burden of proof]`.

---

## 6. Open questions

1. **"Agenda notebook"** — none exists by that name; used canonical (`748b81ef`) + "Premium Design Systems" (`afa954fa`). Confirm.
2. **"CRN dashboards"** read as CRM.
3. **UI8 receipt reconciliation** is a blocking precondition for the licensed ingestion lane — needs Devin's purchase-list export (RIGHTS.md TODO `[REPO]`).
4. **Design-capability ranking** stays provisional until the L3/L5 loop produces our own data.
5. **Framework deploy adapter approach** — Vercel CLI vs git-connected project: decide at P5 with a spike; both preserve customer ownership (PRD §11).
6. **Nous Portal Grok availability** — PRD §15 assigns Grok via Nous; confirm the model is currently served there at P0 (fallback: OpenRouter is globally OK-listed but in-program requires a PRD amendment).
7. ~~GSAP licensing gate~~ — **RESOLVED, and earlier drafts of this plan were wrong.** `docs/decisions/gsap-licensing.md` is **Accepted (2026-07-25)** `[REPO]`: GSAP is free for commercial use including all plugins, and *generating GSAP code is explicitly permitted* (the licensor's own FAQ blesses AI tools doing exactly that). I previously described it as an unresolved gate that had to open before ScrollTrigger could be a default — that was incorrect and would have needlessly weakened §4b. The actual constraint is narrow and unrelated to codegen: **do not expand visual motion-authoring UI** beyond the existing global `--motion` multiplier in `design-templates/tweaks` (no timeline/keyframe editor, no per-element easing or duration UI), and pin exact GSAP versions since the licence is unilaterally amendable. ScrollTrigger, SplitText and Flip are all usable in generated output today.

## 7. Adversarial review outcomes (v1 → v2)

14 Sol findings (code-level) + 33 Grok findings. All HIGHs verified and dispositioned; the load-bearing corrections:

| Finding | Disposition in v2 |
|---|---|
| Deploy adapter is static-HTML-only, rejects production (Sol #1) | Two-lane website strategy (§1); framework adapter is explicit new work (P5). |
| Router boundary doesn't exist; one prompt → one run (Sol #2) | Routing binds at dispatch; orchestration graph is separate phased work (§3.1, §3.3). |
| Cross-runtime cascade unsafe mid-run (Sol #3) | Run-boundary-only escalation with snapshot/rollback (§3.1). |
| Budgets unenforceable mid-run (Sol #4, Grok F15) | Admission control + heuristic kills + reconciliation with headroom (§3.1). |
| Routing key ambiguous (Sol #5, Grok F10) | Template id × brief build-class × tokenizer estimate (§3.1). |
| Stack violates design authority (Sol #6, Grok F19) | Reframed as greenfield default subordinate to authority order; craft lanes kept (§1). |
| NativeWind/Tailwind-v4 wrong (Sol #7) | Style Dictionary subset bridge; NativeWind v5 pre-release flagged (§1). |
| Rights breaches in ingestion (Sol #8, Grok F18/F32) | Rights-laned pipeline; no source to third-party APIs; local store only; receipts gate (§4). |
| Ingestion security/scale (Sol #9/#10, Grok F28/F30) | Sandbox + queue + honest counts + staffed `.fig` session (§4). |
| Fan-out collisions (Sol #11, Grok F23) | Serial primitives + file leases + consolidation pass (§3.3). |
| Visual gates nondeterministic (Grok F9/F13, Sol #12) | Deterministic-vs-advisory gate split; gate-tax cap (§3.2). |
| Capability closure + governance (Sol #13/#14) | §3.4, §3.5; PRD §15 lane constraints adopted, Grok→Nous in-program. |
