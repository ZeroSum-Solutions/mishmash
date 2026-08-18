# MishMash Academy — Team Onboarding Homework Program (final)

## Goal
An education website — itself built inside MishMash (dogfooding) — that trains the team to produce client-grade websites in MishMash. Structure: a **one-week build sprint** (10 websites, one per client category) followed by a **week-2 assessment tail** (capstone finish, cohort review, retention check, first supervised client contribution). Time: 15 hours is the floor; planned 20.5h; P80 expectation ~25h until the pilot rebases it. Graduation = **ready for supervised client production**; independent status after the retention check plus one supervised real-client contribution.

## Part 1 — The build sprint

### The operating loop (taught once, repeated in all 10 assignments)
**Brief → pick references → state design intent (2 sentences) → build → inspect at 375 / 768 / 1440 px → diagnose defects → revise → submit with evidence.**
The evidence artifact contract is fixed for every assignment: screenshots at the three widths, a defect log (what you found, what you fixed), a keyboard-nav pass note, a reduced-motion check note, and — on any repair round — before/after screenshots.

Each assignment opens with a 10–15 min **micro-drill** isolating the day's new feature (e.g. "fix this broken mobile header," "reconcile these two design systems"). Drills are versioned artifacts like the copy packs and the A9 seed — each carries a version id, its expected result, an answer key, and a reset path; a failed drill routes to the lesson's worked example, not to the build. Drill vs build failure is a signal, not a verdict — tool failure and unclear instructions are always candidate causes, and the support path exists for exactly that.

### The 10 client categories
All builds are **marketing sites / functional shells** — catalog and listings are UI with mock data, forms present but stubbed, no payments. Baselines are verified to exist in the 199-template gallery; per-assignment suitability is confirmed at build time. If Devin has lead/revenue data, the list gets ranked against it first.
1. **Agency / studio** — lexingtonthemes-aubergine
2. **SaaS product landing** — aceternity-ai-saas or cruip-stellar
3. **E-commerce storefront (shell)** — nextjstemplates-nextmerce
4. **Restaurant / hospitality** — deliberately no baseline exists: adapt from an adjacent local-business template (themefisher-cleaner / glasto). Clients rarely match a template; this teaches that.
5. **Portfolio / personal brand** — cruip-devfolio or aceternity-sidefolio
6. **Health & wellness clinic** — adapt from themefisher-cleaner; closest to real potential clients
7. **Professional services (legal / accounting / consulting)** — themefisher-finprox restyled
8. **Home services / trades** — lexingtonthemes-rosewood
9. **Nonprofit / community** — cruip-community
10. **Real estate (capstone)** — brief only; quartiere exists but the brief demands going beyond it, plus a written note on reference choices, compromises, and QA evidence.

Every bundled template ships an agent-readable SKILL.md — lesson 1 teaches "ask the agent what this template is."

### Skills ladder (drill + build per assignment)
- A1 Agency: guided create; prompt-only changes; chip rail. 60m
- A2 SaaS: visual-quality basics taught first (type scale, spacing, hierarchy, contrast), then switch the design system and judge the result. 75m
- A3 E-comm: custom header — nav, mobile, sticky states. 90m
- A4 Restaurant: custom footer + second page + internal links on an adapted baseline. 75m
- A5 Portfolio: clone a live site with the workbench browser; provenance lesson (record source, replace protected branding/content, state how yours diverges); iterate into your own. 105m
- A6 Clinic: mix and match — sections from two templates into one coherent site. 105m
- A7 Professional services: design-library transplant ("I love this bento grid — wire it in"). 90m
- A8 Home services: capture web inspiration (browser panel + clipper), board it, use it. 90m
- A9 Nonprofit: full remix of a provided **versioned seed project** (seed carries a version id, documented starting state, one-command reset). 90m
- A10 Capstone: brief only. 150m

**Copy packs** per assignment: fictional businesses, licensed or generated imagery with alt text, versioned. Copywriting itself is not assessed — stated explicitly, so "client-ready" is not misread as including content judgment.

### Cadence
Week 1 (protected paid hours — see Decisions): Mon orientation + A1–A2 · Tue A3–A4 · Wed A5–A6 · Thu A7–A8 · Fri A9 + capstone start. Each day opens with a 15-min repair round on yesterday's critique.
Week 2 (also protected): Mon capstone finish · Tue cohort review · retention check day 7–14 (one unseen brief, no lesson access, 60m) · then one supervised contribution on a real client project.
**Calibration pilot before launch** — a thin slice, not just the easy start: one person runs A1 (early), A5 (the fragile clone path), a 45-min capstone-lite, one grading pass and one redo cycle (~4h). Published timeboxes rebase on their actuals.

### Assessment
- **Pass gate = the rubric**, applied on submit by critic agents, adjudicated by Devin. Per-assignment Definition of Done: brief compliance, responsive at the three contract widths, coherent header/footer (heuristics enumerated per assignment in the lesson), provided copy in place, keyboard-usable nav, reduced-motion respected, one intentional interaction that improves comprehension or task completion. All criteria must pass; results are criterion-level, never a bare fail. Evaluator calibration: every assignment's lesson includes one graded exemplar pair (a passing build and a failing build with the rubric filled in).
- **Stretch = the blind critic**: fresh critic agent, submission vs unmodified baseline, sides randomized, labels stripped, findings evidence-linked. Beating the baseline is celebrated, not required. A4 (adapted baseline) and A10 (no baseline) are rubric-only. Ambiguous or flipped verdicts route to Devin.
- **Redo = instruction**: prioritized repair brief (top 3 defects), one bounded repair round, one retry. After a failed retry: a 30-min live pairing session with Devin or a lead, assignment marked "completed with support." Three or more supported completions delays graduation and triggers targeted retraining — no one silently exits the program.
- Critic runs trigger **on submit**; the Academy workspace automation owns the runs; Devin owns adjudication. Humans deep-review milestone builds (A5, A10) plus escalations.
- Submissions: MishMash project `academy/<person>/<A#>` in a shared workspace; progress tracker on the site.

## Part 2 — The Academy website itself (dogfooded)
- Built as a MishMash project in its own namespace; taught app version **frozen and stamped** on every lesson, screenshot, and video; an update owner re-captures media when the UI meaningfully changes.
- Chassis: cruip-docs restyled; design system: a shadcn-based system from the design library (final pick verified at build time).
- IA: **Start here** (environment preflight + diagnostic; reset/recovery steps; support path) · Home (how the program works) · 10 lesson pages (goal, drill + answer key, steps, video, DoD, worked example, "what went wrong" example) · **Feature atlas** (annotated real screenshots: workbench, chip rail, design browser, clipper, template gallery, design library, cloning, od CLI) · Progress tracker (per-person; storage behavior defined; trainee progress separate from assessor state) · Brief packs · FAQ/glossary from CONTEXT.md.
- Media: real screenshots via scripted Playwright; per-lesson 2–4 min screen recordings with captions, transcript, narrated decision points, and a finished exemplar; annotations keyboard- and mobile-accessible.
- Contingency: known-good fixture projects per lesson and a manual fallback for every fragile workflow (clone fails → import the provided capture; browser panel fails → use provided screenshots).

## Part 3 — Build approach (starts post-demo)
- Dynamic workflows + ultracode: media capture, lesson builds, and critics fan out in parallel; worktrees only if repo code changes are needed.
- Gauntlet loop on the Academy site, judge semantics fixed: **visual/content judge** = blind preference pick vs Framer Academy screenshots; **usability judge** = a fresh agent that has never seen the site must complete Lesson 1 end-to-end using only what is on screen (pass/fail by task completion, with step count and dead ends logged). Both must pass. Escalation bound: if 3 consecutive rounds change neither verdict, the state goes to Devin. **Final acceptance is Devin's** — Approve / Request changes / Reject; the loop serves that gate, it does not replace it.
- Real generation runs on Claude Code / Codex subscriptions, never a metered API.

## Decisions needed from Devin
1. Protected paid hours — for BOTH weeks (build sprint + assessment tail). The plan assumes yes.
2. Category list vs actual lead/revenue data, if any exists.
3. Update owner for Academy media after launch.
4. Who besides Devin can adjudicate/pair (a lead), so grading does not bottleneck on one person.
