# Initialization prompt — paste this into a fresh context window

Copy everything in the fenced block below as your first message in a new session.

---

```
/goal ~/projects/mishmash/docs/plans/waves/GLOBAL-GOAL.md --slug mishmash-completion

Before planning, read in this order:
1. docs/plans/waves/GLOBAL-GOAL.md — the program PRD and its 11 non-negotiable operating rules
2. docs/plans/waves/VERIFICATION-CONTRACT.md — BINDING. The verifier, the proof manifest, the
   nine anti-gaming rules, the write leases, the loops. Where a wave criterion conflicts with
   it, that file wins. Read it before any criterion looks satisfiable to you.
3. docs/plans/waves/README.md — wave map, bursts, adversarial policy
4. docs/plans/waves/NM-REGISTER.md — the ONLY valid source of NM item IDs
5. docs/plans/2026-07-26-mishmash-completion-assessment.md — READ THE ADDENDUM FIRST; it
   supersedes the body wherever they disagree (two adversarial audits corrected the body,
   including retracting claims I originally marked "verified DONE")
6. AGENTS.md — repo law. Non-obvious constraints that have already bitten: UI/CLI dual-track
   parity is mandatory; the daemon data directory contract forbids inventing path conventions;
   tests live in package-level tests/ siblings, never under src/; pnpm tools-dev is the only
   lifecycle entry point; no root pnpm test/build aliases.

FIRST TASK, before any wave work: write scripts/waves/verify-w0.ts, verify-wc.ts, and
verify-w7.ts. A wave whose verifier does not exist cannot report progress, because a criterion
is passed by a checked-in probe with a commit-bound artifact or it is not passed at all. Two
independent reviewers found that self-certification was the plan's single biggest hole.

Then start Burst 1 — three waves in parallel under the leases in docs/plans/waves/leases.json:
- docs/plans/waves/W0-substrate.md         (lands FIRST; owns pnpm guard + daemon tests)
- docs/plans/waves/W-C-clone-closeout.md   (skills/web-clone/ + web-clone-*.test.ts only)
- docs/plans/waves/W7-selector-foundations.md (docs/specs/ + evals/ only — pure specification)

None of these need a founder decision. W-C and W7 execute in parallel but MERGE ONLY AFTER W0
lands, rebased onto post-W0 main with their verifiers re-run. Do not start Burst 2 until W0
lands. Do not start W5-W11 from their skeletons at all — each needs an independently reviewed
PRD expansion, frozen before implementation.

Operating rules I want enforced, not just acknowledged:
- Spot-check load-bearing numbers before acting on them. Planning docs have been wrong three
  times already: the backlog said 1,806 rebrand hits (real 301), the assessment said 602 imports
  (real 760) and 239 endpoints (real 340). This applies to reviewer claims too — two of this
  plan's "disjoint file" assertions were false and I only found that by opening the files.
- Reviewer is never the author. Adversarial review before every landing, GPT-5.6 Sol by default;
  add Grok 4.5 for specification work (W7). A reviewer timeout or unparsable verdict is a
  REJECT, never a pass.
- Stop and escalate on three consecutive non-APPROVE verdicts, or a non-decreasing HIGH count
  across three rounds. (The older "new HIGHs in new places" phrasing was gameable — an agent
  just disputes what counts as "new.")
- Severity belongs to the reviewer. You may not downgrade a finding, move a failing test into
  "known limitations", or reclassify scope to land. That needs me.
- A comment or doc asserting a guarantee the code does not enforce is a hard reject. Fix the
  behavior, then narrow the claim.
- Documentation never closes a behavioral finding. If egress still happens, "documented as
  deliberate" is not done.
- Freeze rather than execute anything destructive outside the working tree. Restoring a backup
  into a fresh OD_DATA_DIR under a sanctioned data root is NOT destructive — do not refuse C0-1
  on those grounds.

Surface the open founder decisions listed in GLOBAL-GOAL.md early so I can answer them while
Burst 1 runs — but do not block on them. Criteria marked `human:` should reach
"blocked-on-founder" and keep going; every wave must be able to hit "all mechanical criteria
green, N founder items pending" without me in the loop.
```

---

## What this program assumes you already know

Carried from the planning session (2026-07-26), so a fresh context does not rediscover it:

**Already done — do not redo:** CodeGraph indexing (`.codegraph/` fresh); "No design system" is
already the default; Vercel deploy integration exists (~2,300 lines, BYOK + Cloudflare alternate);
Archive plumbing exists (`od project archive`, `/api/projects/:id/archive`); the design-system
manifests, MCP tool titles, OAuth consent name, social-share text, clipper UI copy, and brand
SVGs are all already MishMash.

**Bigger than the backlog says:** the model-picker mismatch has three independent mechanisms;
route surface is 340 registrations, not 239; the `@open-design` scope is 760 imports across 20
packages.

**Smaller than the backlog says:** reference intake is a *complete built system* behind
`LIBRARY_UI_VISIBLE = false`; brand extraction is a working deterministic engine; VoiceBox already
ships an MCP server; thumbnails have capture infrastructure and lack only lifecycle.

**Two "disjoint" claims in this very plan were false** — both found by reviewers, both then
verified by opening the files. `apps/web/src/components/EntryShell.tsx` carries W2's newsletter
URL (line 228) *and* W1's model picker (lines 119/2672/3023–3182).
`apps/web/src/providers/registry.ts` carries W4's `fetchProjectFiles` (1457) and W3's
`fetchLibraryAssets` (2563). Treat any future "these waves don't overlap" claim as a hypothesis.

**Traps that already caught someone:**
- The Library flag says "intentionally hidden for this release" and router tests *assert* it stays
  hidden — it is a product-readiness decision, not a forgotten boolean.
- `docs/FORK-PIN.md` pins this fork at `b9f550854` with cherry-picks as the only update lane —
  which is why the namespace rename is deferred by default.
- `brands/prefetch.ts:940` hardcodes `screenshot = null` because the old capture path was
  SSRF-prone. Do not "fix" it by reintroducing unconstrained headless Chrome.
- `project-cover.tsx` renders untrusted project HTML in `sandbox="allow-scripts"` **without**
  `allow-same-origin` — that is deliberate and correct. Do not "harden" it into breaking.
- The `mishmatch-*` goal-state runs are a **different product** (zs-acquisition-engine / zs-crm /
  zs-workbench). Their open items are not MishMash's.

**External repos vetted for specific items** (licenses and activity verified 2026-07-26):
`dembrandt` (MIT, is itself an MCP server) for brand extraction; `langfuse` (MIT non-ee) for cost
— though in-app aggregation is preferred first for a local-first product; `sharp` (Apache-2.0)
for hero-crop thumbnails; `karakeep` (**AGPL** — companion service only, never forked) for
bookmark import; `rrweb` (MIT) for scroll/interaction fidelity. Nothing integrable exists for the
Selector — it is a first-party build.
