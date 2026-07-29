# Wave 10c — Toolbox reliability (NM-19)

**Slug:** `mishmash-w10c-toolbox` · **Branch:** `feat/w10c-toolbox`
**Gates on:** W0 (landed) · **Loop:** `loop:red-green-review` (`VERIFICATION-CONTRACT.md` §6)
**Verifier:** `scripts/waves/verify-w10c.ts`
**Write lease:** `docs/plans/waves/leases.json` → `waves["W10c"]` — see **Proposed lease** below. Not yet
present in `leases.json`; this section is the PRD-text proposal the orchestrator transcribes after
this document freezes, mirroring how `W9-ingest`'s lease entry was added after its PRD landed.

**Status: EXPANSION, PRE-IMPLEMENTATION — FIX ROUND 3.** Per `docs/plans/waves/W5-W11-gated.md`
"The expansion gate", this document and `scripts/waves/verify-w10c.ts` are frozen and independently
reviewed *before* any implementation begins. Writing implementation code from this document, or
from the `W5-W11-gated.md` skeleton it expands, is a hard reject.

**Round-1 review REJECTED the prior draft** on 8 numbered findings: package-relative invocation
paths that made C10C-2/3/4 impossible for a conforming implementer to satisfy without editing the
frozen verifier (finding 1); C10C-2/3/4 checking only import/title *shape* rather than the claimed
runtime behavior, admitting a no-op-test decoy (findings 2-4); C10C-1's AST authority accepting an
ambiguous/decoy declaration and ignoring extra object-literal members (finding 5); a false
"reordering is detected" claim in C10C-5's decoy argument (finding 6); C10C-7's reviewer-identity
match and owned-path list being incomplete (finding 7); and founder question 1 being left as a soft
open question when repository authority makes it blocking (finding 8). Every finding is closed
below; the fixes are cited inline as `[R1-F<n>]`. Every fact marked "verified directly in this tree"
below — including the round-1 fixes — was checked by reading or running the actual source, not
assumed from prose (e.g. the NodeNext dynamic-import workaround in §2 was confirmed by actually
running `tsc` against a probe file, not reasoned about abstractly).

**Same round (round 1), three orchestrator rulings folded in.** After the finding-closure pass
above, the orchestrator ruled on this document's three open founder questions, under founder
authority delegated to the orchestrator for this project — binding, not advisory. Full text in
**§9 Recorded rulings**; summary: (1) no new toolbox-action HTTP/CLI capability; (2)
`NextStepActions.tsx` **is** in scope for the exhaustive walk — `C10C-2` is extended to cover both
consumers, asserting their partition of the 16 actions explicitly rather than ignoring the second
surface; (3) `scripts/check-toolbox-skill-refs.test.ts` is kept, untouched, as a floor — no file
change, prose-only note. **Round 2 removed `C10C-8`** on the reasoning that ruling (1) closed the
question `C10C-8` existed to gate, so a criterion that would now trivially and permanently read
`pass` was not measuring anything. **Round 3 corrected this: it was wrong.** See below.

**Round-3 review REJECTED the round-2 draft** on 7 numbered findings, plus a coordinator correction
that round 2's removal of `C10C-8` was itself an error. Every finding is closed below; the fixes are
cited inline as `[R3-F<n>]`. Summary:
- **`C10C-8` is REINSTATED** (finding 7 + coordinator correction). Round 2's reasoning conflated two
  different questions: "does the capability question need a mechanical gate to be *decided*"
  (no — the orchestrator's ruling decided it) and "does the fact that it *was* decided, on the
  record, through the review lane, need a mechanical gate" (yes — that fact is exactly the kind of
  externally-verifiable invariant this program's criteria exist to check, and the
  `### W10C-CAPABILITY-DECISION` block that landed in `docs/plans/waves/DECISIONS.md` via the merged
  `main` tip is real and fail-able: it can be deleted, malformed, or (structurally, though the lease
  already prevents it) forged by this very branch). `C10C-8` no longer asks "should there be a new
  capability" — it asks "did that question's answer land through the review lane that produced
  `baseCommit`," reading `DECISIONS.md` at `baseCommit` (never `HEAD` — a wave branch cannot reach
  the docs lane at all; see §5). This is **not** a claim that anyone's authority was cryptographically
  verified — the criterion text says so explicitly, and §5/§9 below say so again.
- **The unbound-import class (findings 2, 3) is closed.** Two prior structural checks each verified
  a *name* was imported/destructured while a separate check counted calls to that *name's text* —
  so an implementation that destructures `{ findDesignToolboxSkill: _unused }` (import present,
  never called) alongside an unrelated local `function findDesignToolboxSkill() {...}` (a decoy
  sharing the original name) passed both checks by calling the decoy. The verifier now captures the
  actual **local identifier** each import/destructure produces and binds every call-count check to
  that identifier, never to the exported/property name's text. `C10C-4` additionally gained the
  PRD-required `SKILL_ID_ALIASES` import+reference check (previously specified in this document but
  never actually checked), and both `C10C-3`/`C10C-4`'s remaining raw regex/text-presence checks
  (`createSmokeSuite`, `.with.toolsDev`, "some `ts.createSourceFile`/`ts.forEachChild` call exists
  anywhere") were replaced with real, connected AST checks.
- **Alias-mediated mutation (finding 4) is closed.** `C10C-1`'s static mutation-call scan only sees
  calls whose *arguments* directly contain the `DESIGN_TOOLBOX_ACTIONS` identifier text — aliasing an
  element into a local variable before calling `Object.defineProperty`/`setPrototypeOf` on it dodges
  that scan entirely. A new runtime layer inspects the actual **property descriptors and prototypes**
  of the dynamically-imported live value — own keys, accessor-vs-data-property shape, prototype
  identity — which cannot be dodged by aliasing, because it inspects the *executed result*, not the
  *call sites* that produced it.
- **Safety is now fail-closed program-wide (finding 5), not negotiable.** Every probe fetch in this
  file sets `redirect: 'manual'` and validates origin/status before trusting a response. Isolated
  daemon teardown no longer trusts `tools-dev stop`'s own report: it independently confirms no
  survivor pid remains (polling, not a single point-in-time check) and escalates via **process-group**
  signaling if anything survives — the exact gap a sibling wave (`W9-agent-spawn`) was parked over
  today, per `DECISIONS.md`'s `W9AS-PARK` record.
- **`C10C-2` now proves the second consumer actually RENDERS the split (finding 1).** The
  featured/non-featured partition was previously re-derived as the complement of the featured set by
  the verifier's own arithmetic — a fact about the verifier, not about `NextStepActions.tsx`. The
  criterion now additionally parses that file's own real source and requires it to structurally
  implement the split, requires its four pinned `data-testid` fragments to exist as genuine JSX
  literals in that file, binds every required `.click()` call to its own selector-chain (not two
  independent unbound facts that let one loop drive both surfaces or neither), and validates the
  runtime marker's *reported id*, not just its extracted value.
- **`C10C-7` now rejects a whitespace-only reviewer identity (finding 6).** A whitespace-only string
  is truthy (non-empty `.length`), so the prior `if (!reviewer)` check let it through, after which it
  matched no commit author and silently passed. Both `C10C-7` and the reinstated `C10C-8` now reject
  any identity that normalizes to nothing after trimming.

---

## 1. Why this wave exists

`W5-W11-gated.md`'s Wave 10 section states the finding directly:

> NM-19 toolbox exhaustive walk — all 16 actions end-to-end from the side panel, table-driven
> against **real skill IDs** (a phantom ID must fail the test), with action→skill mapping
> assertions moved into the daemon suite. Today only a repo-root guard exists, and a prior run
> found **17 phantom skill IDs** — this surface has lied before, so "exhaustive" needs a per-action
> row, not an adjective.

The prior incident is on record in `docs/plans/2026-07-25-mishmash-gap-fix.md`: the Design Toolbox
recommended 17 skills that did not exist, closed by task T3 (triage) + T5 (a repo-root guard,
`scripts/check-toolbox-skill-refs.test.ts`). That guard is real and wired into `pnpm guard`
(confirmed: it ran as part of `pnpm guard` in this tree, 102/102 tests green), but it checks the
**wrong thing** — see §3. This wave closes the actual gap: an exhaustive, table-driven,
runtime-derived, real-registry-bound test surface, so the toolbox cannot silently rot back into
lying without a red test somewhere in the tree.

## 2. Ground facts (verified directly in this tree)

- **The action catalogue is one module:** `apps/web/src/runtime/design-toolbox.ts`. It exports
  `DESIGN_TOOLBOX_ACTIONS: DesignToolboxAction[]`, each entry `{ id, icon, preferredSkillIds,
  categoryHints, searchTerms }` (exactly these five fields — the `DesignToolboxAction` interface),
  and `findDesignToolboxSkill(action, skills)` — the resolution function every consumer calls. It
  is deliberately framework-free ("Keep this module free of React and composer-internal state so
  both surfaces can import the same source of truth" — the module's own header comment), so it is
  importable from plain Node, not only from a browser bundle.
- **The count today is 16, matching the skeleton's claim — no discrepancy to record.** Verified by
  listing `DESIGN_TOOLBOX_ACTIONS`: `auto-match, asset-search, icon-workflow, image-replace,
  reference-extract, motion, motion-polish, transition-motion, plan-outline, threejs-scene,
  anti-ai-polish, visual-polish, image-gen, chart-gen, logo-gen, video-gen`. Per this PRD's own
  rule (C10C-1), the verifier **re-derives this count at runtime** rather than trusting this
  document; if a future run of the verifier disagrees with 16, the derived count is authoritative,
  not this paragraph.
- **The resolution algorithm has three fallback tiers**, in order: (1) an exact `id`/`name` match
  against `action.preferredSkillIds`; (2) a skill whose `category` is in `action.categoryHints`;
  (3) a skill matching any of `action.searchTerms` via `skillMatchesQuery`. **This fallback chain
  is the actual mechanism behind the historical lie**: a fully-phantom `preferredSkillIds` list
  does not surface as a visible failure, because tier 2/3 silently recovers *some* skill. The
  toolbox can look "fine" in manual QA while never attaching the *intended* skill. A test that only
  asserts "some skill resolved" cannot catch this; the per-action assertion must check the
  *specific expected* skill, computed the same way the production code computes it.
- **A second, independent consumer exists, and it is IN SCOPE per orchestrator ruling (§9,
  ruling 2).** `apps/web/src/components/NextStepActions.tsx` (the assistant "next step" card)
  imports the same `DESIGN_TOOLBOX_ACTIONS`/`FEATURED_DESIGN_TOOLBOX_ACTION_IDS`/
  `findDesignToolboxSkill`, splitting the 16 actions across two always-visible featured rows
  (`data-testid="next-step-toolbox-action-<id>"`, only `auto-match`/`visual-polish` today, shown
  only in the `default` next-step variant) and a cascading "More → Design toolbox" flyout holding
  the other 14 (`data-testid="next-step-toolbox-sub-action-<id>"`, reached via
  `next-step-toolbox-more` → `next-step-more-toolbox`). Both click paths ultimately call
  `ChatPane.tsx`'s `handleToolboxAction` → `composerRef.current.applyDesignToolboxAction(id)` — the
  **exact same imperative method** `DesignToolboxPanel`'s own row click invokes internally
  (verified by reading both call sites), so the two consumers converge on identical composer-draft
  behavior once an id reaches the composer; only the click *path* to trigger it differs. `C10C-2`
  (§5) now walks both consumers and mechanically asserts the featured/non-featured **partition**
  of the runtime-derived 16-action set (no gap, no overlap) — the "assert the intended difference
  explicitly" instruction in ruling 2, rather than silently ignoring the second surface. Reaching
  `NextStepActions`' default-variant featured rows requires a completed run with a turn deliverable
  (`showNextStepActions` in `AssistantMessage.tsx`); the required test uses the same
  fake-agent-runtime + real-daemon pattern `e2e/ui/real-daemon-run.test.ts` already establishes for
  driving a run to completion, not a new mechanism.
- **Skill IDs are frontmatter `name`, not directory name — with an alias table.**
  `apps/daemon/src/skills.ts:listSkills()` sets `id = data.name (frontmatter) || entry.name
  (directory)`, first-root-wins on collision. `SKILL_ID_ALIASES` (currently one entry:
  `{"taste-skill": "design-taste-frontend"}`) forwards deprecated ids so old references outlive a
  rename. **Ten of the 170 directories under `skills/` today have a directory name that does not
  match their own frontmatter `name`** (verified: `brutalist-skill`→`industrial-brutalist-ui`,
  `gpt-tasteskill`→`gpt-taste`, `image-to-code-skill`→`image-to-code`,
  `minimalist-skill`→`minimalist-ui`, `output-skill`→`full-output-enforcement`,
  `redesign-skill`→`redesign-existing-projects`, `soft-skill`→`high-end-visual-design`,
  `stitch-skill`→`stitch-design-taste`, `taste-skill-v1`→`design-taste-frontend-v1`,
  `taste-skill`→`design-taste-frontend`, the last aliased). None of these ten collide with a
  current `preferredSkillIds` entry, so today's toolbox has zero phantoms by either method — but
  this mismatch class is exactly what the **existing** repo-root guard cannot see (next bullet).
- **The existing guard checks the wrong resolution algorithm.**
  `scripts/check-toolbox-skill-refs.test.ts` (wired into `pnpm guard`, confirmed passing, 4 tests)
  parses `design-toolbox.ts` with a regex (`ACTION_BLOCK`/`QUOTED`) and calls `skillExists(id) =
  existsSync(skills/<id>/SKILL.md)` — **directory existence**, not the daemon's actual
  `listSkills()`/`findSkillById()`/alias resolution. Two concrete gaps this leaves open: (a) a
  `preferredSkillIds` entry naming a real skill's **directory** (not its frontmatter `name`) passes
  this guard today but would only resolve at runtime if `SKILL_ID_ALIASES` happens to cover it —
  nine of the ten mismatches above have no alias and would silently fail to resolve at the real
  registry while still passing the guard; (b) the guard never runs the actual side-panel
  click-through or the actual `findDesignToolboxSkill` tiered fallback, so it cannot catch a
  phantom masked by tier-2/3 recovery (the historical failure mode, previous bullet).
- **The only existing behavioral test is a jsdom component test covering 2 of 16 actions with
  hand-authored fixture skills.** `apps/web/tests/components/ChatComposer.design-toolbox.test.tsx`
  (305 lines) renders the real `ChatComposer` + `DesignToolboxPanel` component tree via Testing
  Library, but supplies its own inline `DESIGN_TASTE_SKILL`/`GSAP_SKILL`/`CREATIVE_DIRECTOR_SKILL`
  objects as the `skills` prop rather than the real, live registry — exactly the kind of stand-in
  data this wave's "against REAL skill IDs" language rules out as sufficient. It exercises the
  `anti-ai-polish` and `auto-match` actions only.
- **The i18n key set is a second, independently-declared source of the action-id list.**
  `apps/web/src/i18n/types.ts` spells out `"chat.designToolbox.action.<id>.title"` /
  `.badge` / `.description"` **per id, explicitly, as members of the `Dict` interface** (not
  templated) — 48 keys today, confirmed `48 = 16 × 3` by direct extraction.
  `designToolboxActionTitle()` etc. build the lookup key with
  `` `chat.designToolbox.action.${action.id}.title` as keyof Dict ``, an `as`-cast that bypasses
  compile-time checking — so `types.ts`/`en.ts` and `design-toolbox.ts` can drift without a
  type error. Every one of the 48 keys currently has a non-empty English value in
  `apps/web/src/i18n/locales/en.ts` (verified: zero empty-string matches). This gives the verifier
  a second, independently-parseable source to cross-check the action-id set against (§C10C-1).
- **The CLI already proxies the web HTTP route for skill listing.** `od skills list` /
  `od skills show <id>` (`apps/daemon/src/cli.ts:runSkills` → `runLibraryList('skills', args)`)
  literally `fetch(`${base}/api/skills`)` / `fetch(`${base}/api/skills/${id}`)` against
  whatever daemon `--daemon-url` (or discovery) resolves to — the same `GET /api/skills` /
  `GET /api/skills/:id` routes the web UI calls
  (`apps/daemon/src/routes/static-resource.ts:164,180`, both backed by `listAllSkills()` /
  `findSkillById()`). There is exactly one listing implementation; the CLI is a thin HTTP client
  of it. This matters for the UI/CLI-parity criterion (§C10C-5, scoped exactly to this listing
  surface per orchestrator ruling 1 — §9) — the **skill registry data** already has CLI parity; the
  **toolbox action catalogue** (ids, preferred-skill mapping, composed prompts) does not, and per
  ruling 1 this wave does not build that parity, since the catalogue is not itself a user-facing
  capability under `AGENTS.md`'s dual-track rule.
- **`apps/daemon/tests/` may not import `apps/web/src/**`, and vice versa** (`AGENTS.md` →
  "Boundary constraints": "App packages must not import another app's private `src/` or `tests/`
  implementation as a shared helper. In particular, `apps/web/**` must not import
  `apps/daemon/src/**`"). The existing repo-root guard's own header comment explains why it
  text-parses `design-toolbox.ts` instead of importing it: a real ES import from `scripts/` pulls
  `apps/web` source into the scripts TypeScript project, whose `moduleResolution: NodeNext` then
  rejects the app's extensionless relative imports (`design-toolbox.ts` itself only imports
  *types* — `Dict`, `IconName`, `SkillSummary`, at its own lines 6-8 — but NodeNext requires an
  explicit extension on relative specifiers even for `import type`). The same constraint applies to
  a new `apps/daemon/tests/*.test.ts` file: it may freely import `apps/daemon/src/skills.ts`
  (same app, already `.js`-extensioned internally, legal), but it must **read** `design-toolbox.ts`
  as text and parse it, not `import` it.
- **`[R1-F1]` `e2e/` may reach into app internals for cross-app checks, but a *static* import of
  `design-toolbox.ts` still fails e2e's own typecheck — confirmed by actually running it, not
  assumed.** `e2e/AGENTS.md` permits cross-app reads ("E2E tests may validate cross-app/resource
  consistency, but must not treat one app's private implementation as a shared helper for another
  app" — reading `apps/web/src/**` from the neutral `e2e/` package is not the forbidden app-to-app
  case). But `e2e/tsconfig.json` **also** sets `moduleResolution: NodeNext`. Running `pnpm --filter
  @open-design/e2e exec tsc --noEmit` against a probe file containing `import {
  DESIGN_TOOLBOX_ACTIONS } from '../../apps/web/src/runtime/design-toolbox'` fails with **TS2835**
  at `design-toolbox.ts`'s own lines 6-8, exactly like the scripts-project case above — and
  `e2e`'s `typecheck` script is part of root `pnpm typecheck` (C10C-6), so a static import in a
  future test file would make this wave's own gate criterion fail once implemented. **The required
  workaround, empirically confirmed in this session:** load the module via a **dynamic** `import()`
  whose argument is a *computed* expression (built with `node:url`'s `pathToFileURL` over a
  `path.resolve(...)` call), never a static `import … from '…'` declaration. TypeScript does not
  apply NodeNext's extension check to a dynamic `import()` call whose argument is not a string
  literal: `tsc -p scripts/tsconfig.json --noEmit` against a probe using exactly this pattern
  reports zero errors, and `tsx` (which the verifier itself runs under, and which Vitest/Playwright
  also use to transform TS) resolves and executes it correctly — confirmed live: 16 actions read
  back, `findDesignToolboxSkill` a real callable function, `apps/daemon/src/skills.ts`'s
  `listSkills`/`findSkillById` likewise loadable the same way (168 skills, real/phantom resolution
  both correct). §C10C-2 and §C10C-3 require this exact pattern; §C10C-4's daemon-suite file does
  **not** need it (`apps/daemon/tests/` importing `apps/daemon/src/skills.ts` with a `.js`
  extension already typechecks cleanly under the daemon's own NodeNext config, matching that
  package's existing internal-import convention).
- **`[R1-F1]` `pnpm --filter <pkg> exec <cmd> <file>` runs with CWD set to that package's own root
  — the file argument must be package-relative, not repo-relative.** Confirmed by direct probe:
  `pnpm --filter @open-design/e2e exec pwd` prints `.../e2e`, so `pnpm --filter @open-design/e2e
  exec playwright test -c playwright.config.ts ui/design-toolbox-actions.test.ts` (not
  `e2e/ui/design-toolbox-actions.test.ts`) is the correct invocation; the same applies to `pnpm
  --filter @open-design/e2e exec vitest run tests/design-toolbox-phantom-id.test.ts` and `pnpm
  --filter @open-design/daemon exec vitest run tests/design-toolbox-skill-refs.test.ts`. All three
  exact invocations were run live in this session against throwaway probe files placed at the
  pinned paths below and confirmed to locate and execute them correctly; the verifier uses these
  exact package-relative forms (§C10C-2/3/4).
- **`[R1-F2]/[R1-F3]` The Design Toolbox panel's real entry point in the shipped UI, concretely,
  with a dead second path — every selector below was read directly from the component source, not
  guessed.** Only `ComposerPlusMenu`'s `renderToolbox` slot is reachable from production code
  today: the "+" trigger carries `data-testid="chat-plus-trigger"` (`ChatComposer.tsx:2822`); its
  flyout contains a `role="menuitem"` row whose accessible name is exactly `"Design toolbox"`
  (`chat.designToolbox.title`/`.tooltip` both resolve to that string in `en.ts`) that opens the
  panel; each action row inside is a `role="menuitem"` button whose accessible name is the action's
  localized title (`ToolboxItemRow`/`PlusSubmenuRow` set no `data-testid` for these rows — a spec
  must target them by role+accessible-name). The composer's editable draft carries
  `data-testid="chat-composer-input"` (`LexicalComposerInput.tsx:661`'s default, unoverridden at
  its `ChatComposer.tsx:2736` call site) and its rendered text content contains any inserted
  `@<skill.name>` mention token verbatim. **The second instantiation — the standalone popover
  behind `ChatComposerHandle.openDesignToolbox()` (`ChatComposer.tsx:1094`, class
  `composer-toolbox-standalone`) — has zero production callers**: grepped across
  `apps/web/src/components/*.tsx` (excluding tests), only `ChatComposer.tsx` itself references
  `openDesignToolbox`; its own source comment calls it "Legacy... Currently unused by callers." A
  conforming Playwright spec drives the plus-menu path above, never this dead imperative handle.
- **`[R1-F2]` Playwright's JSON reporter captures per-test `console.log` output, confirmed live.** A
  throwaway two-test probe run through `pnpm --filter @open-design/e2e exec playwright test -c
  playwright.config.ts <file> --reporter=json` (with `PLAYWRIGHT_JSON_OUTPUT_NAME` set) produced
  `suites[].specs[].tests[].results[].stdout[].text` entries containing the exact `console.log`
  text from each test body. §C10C-2 relies on this exact, confirmed schema path for its runtime
  marker cross-check — not an assumption about Playwright's reporter internals.
- **`pnpm guard` and `pnpm typecheck` are both green on this tree today** (verified by running
  both: guard 102/102, typecheck clean across every workspace project) — the baseline this wave's
  own gate criterion (§C10C-6) starts from is already satisfied and stays satisfied by any
  test-only addition.
- **Isolated e2e daemon lifecycle already exists as reusable infrastructure.**
  `e2e/lib/vitest/suite.ts:createSmokeSuite(name)` + `suite.with.toolsDev(async ({ runtime, status,
  webUrl }) => { ... })` owns one isolated tools-dev daemon/web/data root per call (confirmed
  pattern in `e2e/tests/tools-dev/automations-routines.test.ts`). A future implementation's
  `e2e/tests/design-toolbox-phantom-id.test.ts` (§C10C-3) is expected to use this fixture rather
  than hand-rolling daemon lifecycle management; `e2e/ui/**` Playwright specs (§C10C-2) get the
  same isolation for free through `@/playwright/suite`'s worker-scoped tools-dev fixture.
- **`[R3-F7]` `docs/plans/waves/DECISIONS.md` carries a real `### W10C-CAPABILITY-DECISION` record,
  landed via the merged `main` tip.** Verified by reading it directly at this wave's `baseCommit`
  (`1fb8ae892d0...`, after merging `origin/main`): `Decision: exempt`, `Decider: Fable 5 orchestrator
  under gate authority delegated by Devin Wiggins (founder) on 2026-07-28`, `Date: 2026-07-28`, and a
  non-empty `Rationale`. The same file also carries a `### W9AS-PARK` record documenting exactly the
  fail-open teardown bug §5's `C10C-3`/`C10C-5` fixes below close (`[R3-F5]`): "teardown treats the
  tracked group leader's `exit` event as proof the whole group is gone... while a SIGTERM-handling
  descendant in the same group stays alive." `C10C-8` (§5) reads this file **at `baseCommit`, never
  `HEAD`** — the proposed lease (§6) denies `DECISIONS.md` to this wave, and a wave branch cannot
  reach the docs lane at all, so `baseCommit` is a fixed point this wave's own commits structurally
  cannot influence.
- **`[R3-F1]` `ts.createSourceFile` must be called with `ScriptKind.TSX` for a `.tsx` file, or its
  JSX syntax is never recognized as JSX at all — confirmed by actually hitting this bug against the
  real `NextStepActions.tsx` in this session.** `ts.isJsxAttribute`/`ts.isJsxExpression` etc. only
  match nodes produced by a JSX-aware parse; parsing a `.tsx` file with `ScriptKind.TS` (this file's
  own `parseTs` helper's original, un-conditioned default) silently produces an AST where JSX
  constructs are absent or malformed, so a `data-testid` literal check against that AST would fail
  for **every** implementation, correct or not — an unsatisfiability bug, not a strictness one.
  `parseTs` now branches on the `.tsx` extension.
- **`[R3-F5]` The daemon sidecar `tools-dev` spawns is `detached: true`, and its reported `pid`
  therefore doubles as its own process-group id.** Confirmed by reading
  `tools/dev/src/index.ts`'s `spawnSidecarRuntime`/`spawnDaemonRuntime` (`child_process.spawn(...,
  { detached: true, ... })`, POSIX `setsid()` under the hood) — this is what makes
  `process.kill(-pid, signal)` a safe, real "signal the whole group" primitive for teardown, not a
  guess. The pid itself is reported at `DaemonStatusSnapshot.pid` (`packages/sidecar-proto/src/index.ts`,
  `pid?: number | null`), surfaced both by `tools-dev start daemon --json`'s
  `<result>.daemon.status.pid` and `tools-dev status daemon --json`'s top-level `.pid`. `tools-dev
  stop daemon --namespace <ns> --json`'s result shape is `{ daemon: { status:
  'stopped'|'not-running'|'partial', stop: { alreadyStopped, forcedPids, matchedPids,
  remainingPids, stoppedPids }, via } }` (`stopApp`/`stoppedByGracefulResult`,
  `tools/dev/src/index.ts:697-730`) — none of this was previously being read by the verifier's own
  `stop` invocation, which additionally never passed `--json` at all.
- **`[R3-F2]` `apps/daemon/src/skills.ts` exports `SKILL_ID_ALIASES`** (the deprecated-id forward
  table, §2 above) as a named export alongside `listSkills`/`findSkillById` — this wave's PRD always
  intended the daemon suite to import it (§C10C-4), but the verifier never actually checked for that
  import until this round.

## 3. Threat model

This is **not** a security-boundary wave — no untrusted network input, no cross-origin actor, no
auth boundary changes. `VERIFICATION-CONTRACT.md`'s security-tranche machinery (route exposure
tiers, `authn`/`authz` attribution) does not apply. The risk this wave defends against is a
**silent capability lie**: the toolbox advertises 16 working "pick a skill for me" actions, and the
actual failure mode is that one silently stops doing what it claims without anything in the tree
turning red. Concretely, three ways this can happen, none of which the current guard catches:

1. **A skill is renamed or deleted** (any contributor editing `skills/<id>/SKILL.md`'s frontmatter
   `name`, or removing the directory). `preferredSkillIds` entries pointing at the old id become
   phantom. The fallback chain (categoryHints → searchTerms) usually still resolves *some* skill,
   so the action keeps "working" in the sense of doing something, while never doing the thing it
   was designed to do — the exact shape of the 17-phantom-ID incident.
2. **A new action is added to `design-toolbox.ts` without matching i18n keys**, or vice versa. The
   `as keyof Dict` cast at every `designToolboxAction*()` call site means this is a silent runtime
   string lookup miss (renders `undefined`/the raw key), not a compile error.
3. **A `preferredSkillIds` entry names a directory instead of a frontmatter `name`** (the ten
   mismatches in §2). The existing directory-existence guard cannot distinguish this from a
   correctly-named entry; the real registry can, but nothing exercises that path end-to-end today.

A round-1-specific fourth risk, now load-bearing for how the criteria below are built: **a
delegated test file's self-reported pass/fail is not, by itself, evidence of the claimed behavior**
— a file can exist, pass its own typecheck, and report green while its bodies are no-ops. Round 1
found exactly this gap in the prior draft. The fix is not "trust the file harder"; it is to give
the **verifier itself** an independent, freshly-computed runtime oracle for every claim that has
one (§C10C-1, §C10C-3, §C10C-4 all now execute the real production code directly, not just check
that a delegated file imported it), and to reserve AST/structural checks for facts that have no
runtime observable (file exists, no `skip`/`only`, an import resolves to a specific real file).

The defense is not privilege attribution — it is **mechanical, runtime re-derivation** (never trust
a hardcoded action list, a hand-authored skill fixture, or a delegated file's self-report alone)
plus **paired positive/negative controls** so a broken harness cannot silently report success by
testing nothing.

## 4. Scope

**In scope:**
- A runtime-derived, cross-validated inventory of the toolbox action catalogue (C10C-1).
- An exhaustive, table-driven, real-daemon-backed end-to-end walk of all (runtime-derived) actions
  from `DesignToolboxPanel` (C10C-2).
- A phantom-ID red spec proving resolution genuinely fails closed against the real, live skill
  registry, paired with a positive control (C10C-3).
- Action→skill mapping assertions moved into the daemon suite, using the real registry resolution
  algorithm (not directory existence) (C10C-4).
- UI/CLI parity of the skill-registry data source the toolbox's resolution depends on — deliberately
  scoped to that data source, per orchestrator ruling 1 (§9) (C10C-5).
- Standard gates: `pnpm guard` / `pnpm typecheck` (C10C-6).
- Adversarial review of the implementation on record (C10C-7).
- The exhaustive per-action walk covers **both** consumers of the shared catalogue —
  `DesignToolboxPanel` and `NextStepActions.tsx` — asserting their featured/non-featured partition
  explicitly, per orchestrator ruling 2 (§9) (C10C-2, extended).

**Explicitly out of scope** (resolved by orchestrator ruling, §9 — not open questions anymore):
- Building a new `od`/HTTP capability for "apply a toolbox action" itself — ruling 1: the toolbox
  is a recommendation layer over already-CLI-reachable primitives, not a new capability; no scope
  expansion.
- Retiring or rewriting the existing `scripts/check-toolbox-skill-refs.test.ts` guard — ruling 3:
  kept as a cheap floor, untouched by this wave (also outside this wave's two-file authoring limit).
- Any change to `apps/daemon/src/skills.ts`'s resolution algorithm, `SKILL_ID_ALIASES`, or any
  `skills/*/SKILL.md` frontmatter. This wave tests the existing algorithm; it does not change it.
- NM-27 (gallery/archive taxonomy), NM-21 (memory scope), or any other Wave 10 slice — those are
  separate gated runs per `W5-W11-gated.md`'s Wave 10 table.

## 5. Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3 (red-before-green, no boundary mocks, no
counting criteria, negative controls, no doc-only closures, reviewer-owned severity, human
judgment declared not disguised, benchmark protocol N/A here, mechanical leases). Verified by
`scripts/waves/verify-w10c.ts`. Every file path, selector, title string, and marker format named
below is the **exact, complete contract** — a conforming implementation satisfies each criterion by
matching these literally, not by inferring intent.

### C10C-1 — Action inventory is runtime-derived, structurally hardened, and cross-checked against the actual runtime export

**Criterion.** Two independent layers, both required:

**Layer A (structural, AST-only — no runtime observable exists for these facts, so the check stays
static per §3's fourth risk):**
- `DESIGN_TOOLBOX_ACTIONS` must be a **unique** identifier in the file: the verifier scans the
  entire AST for every `VariableDeclaration` named `DESIGN_TOOLBOX_ACTIONS`, at any scope, and
  fails if there is not **exactly one**. `[R1-F5]` closes the prior gap where the first
  depth-first match — possibly an unrelated, unused, inner-scope decoy — silently won.
- That one declaration must be a top-level (module-scope) `const` inside a `VariableStatement`
  carrying an `export` modifier, with an `ArrayLiteralExpression` initializer.
- Every element of the array must be a plain `ObjectLiteralExpression` whose **only** members are
  `PropertyAssignment`s named `id`, `icon`, `preferredSkillIds`, `categoryHints`, or `searchTerms`
  (the exact `DesignToolboxAction` field set) — any other member kind (`ShorthandPropertyAssignment`,
  `MethodDeclaration`, `GetAccessorDeclaration`, `SetAccessorDeclaration`, `SpreadAssignment`) or
  any other property name (including `__proto__` or `toJSON`) is a hard failure. `[R1-F5]` closes
  the prior gap where extra members were silently ignored rather than rejected.
- `id` and each `preferredSkillIds` element must be a plain `StringLiteral` or
  `NoSubstitutionTemplateLiteral`; a `SpreadElement` anywhere inside `preferredSkillIds` is a hard
  failure.
- The whole file is scanned for any `CallExpression` that could mutate the binding after
  declaration — `.push(`, `.splice(`, `.unshift(`, `.shift(`, `.pop(`, `.sort(`, `.reverse(`,
  `.copyWithin(`, `.fill(` called with `DESIGN_TOOLBOX_ACTIONS` (or a subscript of it) as the
  receiver, or `Object.assign(`, `Object.defineProperty(`, `Object.defineProperties(`,
  `Object.setPrototypeOf(` called with `DESIGN_TOOLBOX_ACTIONS` (or an element of it) as an
  argument — any match is a hard failure. `[R1-F5]` (the coordinator's explicit "must catch
  `Object.assign`/`defineProperty`/`setPrototypeOf`/`push` mutations" instruction).

**Layer B (runtime, the authoritative cross-check — `[R1-F5]`'s primary fix, not merely an
add-on):** the verifier dynamically imports the **actual production module**
(`await import(pathToFileURL(path.resolve(repoRoot, 'apps/web/src/runtime/design-toolbox.ts')).href)`
— the exact pattern confirmed in §2) and reads the real, executed `DESIGN_TOOLBOX_ACTIONS` export
at runtime, defensively (`Array.isArray`, `Object.prototype.hasOwnProperty.call` on each element
for `id`/`preferredSkillIds`, `Array.isArray` + `every(x => typeof x === 'string')` on
`preferredSkillIds` — never a bare property-access trust chain that a prototype trick could
redirect). It then requires the **runtime-read** `{id, preferredSkillIds}[]` to **exactly** match
the **Layer-A AST-derived** reading: same ids (multiset), and for each id, the identical
`preferredSkillIds` sequence (order matters — it is the tier-1 match priority the resolution
algorithm actually walks). Any divergence — whatever caused it: a getter computing something
different from its static-looking initializer, a mutation Layer A's scan missed, an ambiguous
declaration Layer A resolved to the wrong node — fails the criterion. This is a genuine execution
of the real function/data, not an inference from source shape, closing `[R1-F5]`'s core complaint
(and, as a side effect, closing the "decoy declaration" attack from a second, independent
direction: even if a decoy fooled the AST uniqueness/scoping check, the runtime import always
resolves the *actual* ES module export, so a Layer-A/Layer-B mismatch surfaces the decoy anyway).

**Layer C (runtime property-descriptor/prototype shape — `[R3-F4]`, closes alias-mediated
mutation):** Layer A's static mutation-call scan (below) only sees calls whose *arguments* directly
contain the `DESIGN_TOOLBOX_ACTIONS` identifier — aliasing an array element into a local variable
before calling `Object.defineProperty`/`Object.setPrototypeOf` on it dodges that scan entirely
without dodging execution. Layer C inspects the **actual runtime value** Layer B already loaded:
`Object.getPrototypeOf(DESIGN_TOOLBOX_ACTIONS) === Array.prototype`, zero extra own array
properties beyond numeric indices/`length`, and — for every element — `Object.getPrototypeOf(el)
=== Object.prototype`, zero own keys outside the five real `DesignToolboxAction` fields, and every
one of those keys a plain **data** property (`Object.getOwnPropertyDescriptors(el)` — any `get`/`set`
accessor is rejected outright, *regardless of the value it currently evaluates to*, because a getter
that happens to return the honest value today is still not the same shape as an honest literal and
can silently diverge tomorrow). This closes the exact gap round 3 named: a static call-site scan
cannot see through an alias; a runtime descriptor inspection does not need to, because it inspects
the *result*, not the code that produced it.

**i18n cross-check (structural, AST-only, `[R1-F5]` hardened):** the verifier parses
`apps/web/src/i18n/types.ts`, locates the **unique**, top-level `interface Dict { ... }`
declaration (fails if zero or more than one `Dict` interface exists in the file), and — scanning
`PropertySignature`s **only inside that interface's own member list**, never any other
interface/type-literal in the file — extracts the set of distinct `<id>` values in
`"chat.designToolbox.action.<id>.{title,badge,description}"` keys, requiring all three keys present
per id. `[R1-F5]` closes the prior gap where a decoy interface anywhere in the file could pad or
substitute for `Dict`'s real membership. The two derived id sets (Layer-B's runtime-verified action
ids vs. the `Dict`-scoped i18n ids) must be exactly equal (multiset, both non-empty). Separately,
the verifier parses `apps/web/src/i18n/locales/en.ts` for `PropertyAssignment`s whose key matches
the same pattern and requires, for **every** id/kind pair the `Dict` walk found complete, a
matching `en.ts` assignment with a non-empty string value — **presence is checked, not just
non-emptiness of what happens to be found** (`[R1-F5]`'s "a wholly missing English assignment is
not a C10C-1 failure" gap: the verifier now computes the full expected key set from `Dict` and
diffs it against what `en.ts` actually supplies, rather than only scanning `en.ts` forward for
empties).

The derived count is logged as evidence; no assertion anywhere in this criterion mentions a
specific number.

**Satisfiability.** A legitimate implementation keeps `design-toolbox.ts` and `i18n/types.ts` in
sync (any action add/remove ships with its three `Dict` i18n keys, non-empty in `en.ts`, in the
same change), writes plain object literals with only the five real fields, and never mutates the
exported array after declaration. This is already true today (verified: 16 actions, 48 matching
keys, Layer A and Layer B agree exactly, `Dict` is the sole matching interface, `en.ts` has full
coverage) — this criterion is expected to already pass pre-implementation on the honest source; it
exists to make that fact *mechanically checked*, including against classes of tampering the honest
source never exhibits, going forward.

**Decoy.** A shaped fake that hardcodes `assert(actions.length === 16)` in its own test would pass
today by coincidence but silently stop catching drift the moment a 17th action is added without its
i18n keys, or an action is deleted while its i18n keys are left behind — closed by exact multiset
equality, not a hardcoded count. A decoy declaring `DESIGN_TOOLBOX_ACTIONS` twice — once as a
real, dynamically-built export somewhere reachable, once as an unused static-looking literal
elsewhere to fool an AST-only reader — is caught by the uniqueness requirement (Layer A fails
outright on 2 declarations) **and, even if uniqueness were somehow satisfied, by the Layer-A/Layer-B
runtime cross-check**, since the dynamic import always resolves to whatever ES actually exports. A
decoy that mutates the array via `Object.assign(DESIGN_TOOLBOX_ACTIONS[0], {...})` after the literal
declaration is caught by both the explicit mutation-call scan (Layer A) and the runtime/AST value
mismatch it produces (Layer B) — two independent controls over the same attack. A decoy interface
named e.g. `DecoyDict` padding the i18n side with extra ids is irrelevant because only `Dict`'s own
members are read.

---

### C10C-2 — Per-action end-to-end walk from BOTH catalogue consumers, table-driven, cross-checked against a fresh runtime oracle, with an explicit consumer-partition assertion

**`[R1-F2]` + orchestrator ruling 2 (§9):** this criterion closes both the round-1 finding (shape-only
checking) and the ruling that the exhaustive walk must cover `NextStepActions.tsx` as well as
`DesignToolboxPanel`, asserting the two consumers' featured/non-featured split explicitly rather
than ignoring the second surface.

**Criterion.** Pinned artifact: `e2e/ui/design-toolbox-actions.test.ts` (Playwright, exact path —
`[R1-F1]`). Required shape, exactly:

1. At module scope (or in a `beforeAll`), load the real catalogue via the dynamic-import pattern
   from §2: `const { DESIGN_TOOLBOX_ACTIONS, FEATURED_DESIGN_TOOLBOX_ACTION_IDS } = await
   import(pathToFileURL(path.resolve(..., 'apps/web/src/runtime/design-toolbox.ts')).href);` —
   never a static `import` declaration (`[R1-F1]`, avoids the confirmed TS2835 failure).
2. **Consumer A — `DesignToolboxPanel`:** `for (const action of DESIGN_TOOLBOX_ACTIONS) {
   test(`toolbox action ${JSON.stringify(action.id)} resolves and applies from the side panel`,
   async ({ page }) => { ... }); }` — one real Playwright `test()` call per catalogue entry, titled
   **exactly** `` `toolbox action "${action.id}" resolves and applies from the side panel` ``. Body:
   navigates into a real project's chat composer (real tools-dev daemon/web via `@/playwright/suite`,
   real `skills/` directory); clicks `page.getByTestId('chat-plus-trigger')`; clicks the
   `role="menuitem"` row named `"Design toolbox"`; clicks the `role="menuitem"` row whose accessible
   name is that action's localized title; reads `await
   page.getByTestId('chat-composer-input').textContent()`; parses out any `@<name>` token as
   `resolvedName` (or `null`); emits `console.log(`W10C_RESOLVED ${action.id} ${resolvedName ??
   '__NONE__'}`)` with the **actually-observed** value.
3. **Consumer B — `NextStepActions.tsx` (orchestrator ruling 2):** `for (const action of
   DESIGN_TOOLBOX_ACTIONS) { test(`next-step action ${JSON.stringify(action.id)} resolves and
   applies from the assistant next-step card`, async ({ page }) => { ... }); }` — one real Playwright
   `test()` call per catalogue entry, titled **exactly** `` `next-step action "${action.id}" resolves
   and applies from the assistant next-step card` ``. Body: drives a real project through a
   completed run producing a turn deliverable (the fake-agent-runtime + real-daemon pattern
   `e2e/ui/real-daemon-run.test.ts` already establishes — `showNextStepActions` in
   `AssistantMessage.tsx` requires `runSucceeded && hasTurnDeliverable` for the default variant); if
   `action.id` is in the runtime-read `FEATURED_DESIGN_TOOLBOX_ACTION_IDS`, clicks
   `page.getByTestId(`next-step-toolbox-action-${action.id}`)` directly; otherwise clicks
   `page.getByTestId('next-step-toolbox-more')` then `page.getByTestId('next-step-more-toolbox')`
   then `page.getByTestId(`next-step-toolbox-sub-action-${action.id}`)`; reads the same
   `chat-composer-input` text; emits `console.log(`W10C_NEXTSTEP_RESOLVED ${action.id}
   ${resolvedName ?? '__NONE__'}`)` — a **distinct marker prefix** so the verifier can unambiguously
   attribute each of the 32 total marker lines to its consumer.

The verifier:
- Confirms the file exists at the pinned path; fails with a named-missing-file detail otherwise.
- **The explicit partition assertion (ruling 2's "assert the intended difference" instruction):**
  reads `FEATURED_DESIGN_TOOLBOX_ACTION_IDS` from the same dynamically-imported module C10C-1 Layer
  B already loads, checks its **runtime shape** the same way C10C-1's Layer C does (plain
  `Array.prototype` array of plain strings, no extra own keys — `[R3-F4]`), and requires — as its
  own named check, independent of whether the delegated file exists yet — that `featuredIds` is a
  non-empty subset of the C10C-1-derived action set, that `featuredIds ∪ nonFeaturedIds` (the
  derived set minus `featuredIds`) exactly equals the derived set with **zero overlap and zero gap**
  (multiset), computed fresh at runtime, never hardcoded as "2 featured, 14 non-featured."
- **`[R3-F1]` The cross-file structural proof (finding 1's fix — the check above proves a fact about
  the verifier's own arithmetic, not about `NextStepActions.tsx`):** the verifier separately parses
  `apps/web/src/components/NextStepActions.tsx`'s **own real source** (with `ScriptKind.TSX` — a
  `.tsx` file parsed as plain `.ts` never recognizes its own JSX at all, an empirically-confirmed
  bug this round fixed in the verifier's shared `parseTs` helper) and requires, as facts about THAT
  file specifically:
  - It imports `FEATURED_DESIGN_TOOLBOX_ACTION_IDS` by exact name from a `design-toolbox`-referencing
    module, and contains a `.filter(...)` call whose callback body calls `.includes(...)` on that
    same imported binding's own local identifier — i.e. the exact shape
    `DESIGN_TOOLBOX_ACTIONS.filter((action) => !FEATURED_DESIGN_TOOLBOX_ACTION_IDS.includes(action.id))`
    already used to derive `NON_FEATURED_TOOLBOX_ACTIONS` today (confirmed by direct reading this
    round). A verifier-side re-derivation of the complement proves nothing about this file; this
    check proves the file's own logic does the split.
  - All four pinned `data-testid` fragments — `next-step-toolbox-action-`, `next-step-toolbox-more`,
    `next-step-more-toolbox`, `next-step-toolbox-sub-action-` — exist as genuine JSX `data-testid`
    attribute literal values (including inside a template literal's static parts) somewhere in the
    file's own AST, not merely asserted by this document's prose.
- **`[R3-F1]` Structural (AST) checks, `[R1-F2]` + `[R3-F1]`, applied to BOTH consumer loops
  independently, on the delegated e2e spec file:** zero `test.skip`/`.only`/`.fixme`/`.todo`
  anywhere; a dynamic `import()` call whose argument subtree contains a string literal referencing
  `design-toolbox.ts` by path fragment; **two** distinct `for...of` loops over that imported
  binding, one whose body contains a `test(` call referencing `chat-plus-trigger`-shaped
  interaction, one whose body contains a `test(` call referencing a `next-step-toolbox`-shaped
  `getByTestId` call. Within each loop, `.click()` is no longer checked as an unbound "some `.click(`
  call exists somewhere in the loop" fact (round 3's finding: that, paired with an equally unbound
  "the selector fragment appears somewhere," let one loop drive both surfaces, or neither, while
  computing markers from the imported resolver) — every required `.click()` is now **bound to its
  own selector-chain receiver**: the side-panel loop must contain a `.click()` call whose own
  `page.getByTestId(...)`-shaped receiver subtree contains `"chat-plus-trigger"`; the next-step loop
  must contain **three** such selector-bound `.click()` calls — one referencing
  `"next-step-toolbox-more"` (opens the More menu), one referencing `"next-step-more-toolbox"`
  (opens the toolbox submenu), and one referencing `"next-step-toolbox-action"` or
  `"next-step-toolbox-sub-action"` (the actual per-action click, direct or via the submenu) —
  proving the loop's source demonstrates both the direct-featured path and the multi-step
  non-featured "More" navigation, not just one arbitrary click. Both loops still separately require
  at least one `.textContent(`/`.innerText(` call.
- **Runs the suite for real** via `pnpm --filter @open-design/e2e exec playwright test -c
  playwright.config.ts ui/design-toolbox-actions.test.ts --reporter=json` (package-relative path —
  `[R1-F1]`) and requires: `run.specs.length` **exactly equals** `2 × derivedActionCount` (16 side-panel
  + 16 next-step, both counts C10C-1-derived, never hardcoded); every derived action id maps to
  **exactly one** side-panel spec (pinned title format) and **exactly one** next-step spec (pinned
  title format), both `ok === true` — a single no-op test spanning multiple ids cannot satisfy either
  pinned exact-title format.
- **The independent, freshly-computed runtime oracle (`[R1-F2]`'s primary fix, shared by both
  consumers since resolution is the same deterministic function regardless of click path):** the
  verifier dynamically imports `design-toolbox.ts` (`findDesignToolboxSkill`) and
  `apps/daemon/src/skills.ts` (`listSkills`), calls `listSkills([repoRoot/skills])` once (pure
  filesystem read — deterministic, daemon-independent, a valid stand-in for "what the real running
  app would see"), and computes `expected = findDesignToolboxSkill(action, liveSkills)?.name ??
  '__NONE__'` per action. It parses every side-panel spec's captured stdout for
  `^W10C_RESOLVED (\S+) (.+)$` and every next-step spec's for `^W10C_NEXTSTEP_RESOLVED (\S+) (.+)$`
  (the confirmed-live `results[].stdout[].text` schema, §2), requiring both captured values to
  **exactly equal** the same independently-computed `expected` for that action. **`[R3-F1]`: the
  marker's reported id (capture group 1) must equal the action id under test, not merely match the
  marker's regex SHAPE** — round 3's finding: previously only the extracted *value* (group 2) was
  ever inspected, so a spec that emitted a syntactically-valid marker reporting the WRONG id (e.g.
  always the first action's) still passed. A test whose body never performs a real click/read
  cannot fabricate a correct, correctly-id'd marker across 16 actions — let alone 32, across two
  independently-titled, independently-selector-bound loops — without independently discovering the
  same real answers the verifier computes fresh each run.

**Satisfiability.** A legitimate implementation writes the two required loops, using the confirmed
dynamic-import pattern and the confirmed selectors from §2 for both consumers (`chat-plus-trigger` /
`"Design toolbox"` menuitem / per-action menuitems for the side panel;
`next-step-toolbox-action-<id>` / `next-step-toolbox-more` / `next-step-more-toolbox` /
`next-step-toolbox-sub-action-<id>` for the next-step card, selecting the right one via the same
runtime-read `FEATURED_DESIGN_TOOLBOX_ACTION_IDS` the partition check uses), and reports the values
it actually reads. Since `NextStepActions.tsx`'s click ultimately calls the exact same
`composerRef.current.applyDesignToolboxAction(id)` imperative method `DesignToolboxPanel` uses
internally (verified in §2 by reading both call sites), both consumers converge on the same
resolved-skill outcome for a given action, so both marker sets agree with the single shared oracle.

**Decoy.** An implementer who pastes today's 16 ids into a local literal array instead of importing
the real catalogue is caught by the required dynamic-import-referencing-`design-toolbox.ts` check,
for either loop. A single no-op test whose title lists every id is caught structurally in either
consumer (the pinned exact-title formats cannot match more than one id per spec, and the exact-count
check requires 32 distinct specs, not "at least 16"). A test that fabricates a plausible-looking
marker line without actually clicking/reading is caught by (a) the per-loop `.click(`/`.textContent(`
call-presence check and (b) the marker value having to agree with the verifier's own fresh
computation for all 16 actions across BOTH consumers simultaneously. An implementation that covers
`DesignToolboxPanel` only and silently skips `NextStepActions` — the exact shape ruling 2 was
written to prevent — is caught by the exact `2 × derivedActionCount` spec-count requirement and the
per-consumer pinned-title coverage check, both of which fail outright at 16 specs instead of 32. An
implementation that hardcodes "2 featured ids" instead of reading `FEATURED_DESIGN_TOOLBOX_ACTION_IDS`
at runtime is caught the moment that constant changes, by the partition check's own fresh read.
**`[R3-F1]`:** a spec whose next-step loop clicks only the direct-featured selector and reports a
plausible marker for non-featured ids too (without actually driving the "More" navigation) is caught
by the three-distinct-selector-bound-click-chain requirement; a spec that emits a marker reporting
the wrong action's id (e.g. copy-pasted from the first iteration) is caught by the marker-id
validation, which now checks the reported id, not just the value; and a `NextStepActions.tsx` that
silently drops the real `.filter(...).includes(...)` split in favor of some other partition logic
(even one that happens to produce the same runtime result today) is caught by the cross-file
structural check, independent of whether the runtime partition currently agrees.

---

### C10C-3 — Phantom-ID red spec: verifier-proven at runtime directly, plus a required, structurally-bound delegated artifact

**Criterion.** Two independent lines of evidence, both required — `[R1-F3]`'s fix is that the first
one no longer depends on trusting the second:

**(a) The verifier's own direct runtime proof (the primary evidence — "boot the isolated daemon,
make the real request, assert the real response," executed by the verifier itself, not delegated):**
the verifier boots one isolated, namespaced, daemon-only tools-dev runtime (same mechanism as
C10C-5 — temp `OD_DATA_DIR`, no fixed port, never 7456/51012), fetches the real, live `skills`
array from that daemon's `GET /api/skills` through the **single hardened fetch path**
(`fetchLiveSkillsOverHttp`: `redirect: 'manual'`, origin re-validated immediately before the
request, status-checked — `[R3-F5]`; reused here, not duplicated, so the criterion has exactly one
fetch implementation to reason about instead of a second, previously-raw `fetch(...)` call this
round replaced), dynamically imports the real `findDesignToolboxSkill` from `design-toolbox.ts` (§2
pattern), and asserts **directly, in the verifier's own process**: a real action (the first entry of
the C10C-1-derived catalogue) resolves to a non-null skill against that live list; a synthetic
action-shaped object with `preferredSkillIds: ['w10c-red-spec-phantom-skill-id']`,
`categoryHints: []`, `searchTerms: ['w10c-red-spec-unmatchable-search-term']` resolves to `null`
against the same live list. This is a real execution of real production code against a real,
freshly-served registry — independent of any checked-in test file's honesty. **`[R3-F5]` Teardown is
independently confirmed, not trusted from `tools-dev stop`'s own report:** the verifier captures the
daemon's own reported pid at boot (`DaemonStatusSnapshot.pid`, §2), calls `tools-dev stop daemon
--namespace <ns> --json` (previously invoked without `--json` at all — its result was never actually
read), polls `process.kill(pid, 0)` against both that pid and every pid `stop` itself reports as
still-remaining until confirmed dead, and — because the sidecar is spawned `detached: true` (§2, pid
doubles as process-group id) — escalates to a **process-group** `SIGTERM` then `SIGKILL` if anything
survives, polling again after each. A `partial` stop or an unconfirmed survivor after full
escalation now fails this criterion outright (`teardownOk` folded into the overall verdict); it is
never silently ignored. This is the exact class of bug `DECISIONS.md`'s `W9AS-PARK` record documents
a sibling wave being parked over: trusting a tracked leader's exit report while a descendant in the
same process group survives. Only then is the temp `OD_DATA_DIR` removed.

**(b) A required, structurally-bound delegated artifact:** `e2e/tests/design-toolbox-phantom-id.test.ts`
(Vitest, exact path — `[R1-F1]`), required shape:
- Contains a real `createSmokeSuite(...)` `CallExpression` (imported from `@/vitest/suite`) and a
  real `.with.toolsDev(...)` chained `CallExpression` — **`[R3-F2]` both are now AST-bound checks**
  (a `CallExpression` walk that matches the exact chained-property shape), not the raw
  `/createSmokeSuite/`/`/\.with\.toolsDev/` text-regex scans this round replaced, which a comment or
  an unrelated identically-spelled chain could also satisfy.
- Loads `findDesignToolboxSkill` via the same dynamic-import pattern as C10C-2 (structural check:
  dynamic `import()` whose argument subtree contains a string literal referencing
  `design-toolbox.ts`). **`[R3-F2]` The destructured binding must be named exactly
  `findDesignToolboxSkill` for its ORIGINAL property, and the verifier now captures the actual LOCAL
  identifier that binding produces** (which can differ from `findDesignToolboxSkill` under an alias,
  e.g. `const { findDesignToolboxSkill: _unused } = await import(...)`) **and requires that LOCAL
  identifier — not the property name's text — to be called at least twice.** This closes the
  unbound-import class round 3 found: previously, an aliased-away (never-called) import of the real
  function, plus an unrelated local `function findDesignToolboxSkill() {...}` sharing the original
  name, passed both the binding-presence check and the call-count check by calling the decoy — the
  call count was being measured against the wrong identifier. A normal, non-adversarial import (no
  alias) is unaffected: its local name already equals the property name.
- Contains the literal string `w10c-red-spec-phantom-skill-id` as a genuine AST `StringLiteral`/
  `NoSubstitutionTemplateLiteral` **node value** somewhere in the file — not merely present in the
  raw text (`[R1-F3]`'s "the phantom literal may appear only in a comment" fix: the verifier
  collects every string-literal node's text via `ts.forEachChild` and checks set membership, never
  a substring scan of the whole file which would match inside a `//` or `/* */` comment).
- Two test titles, **exactly**: `"positive control: a real action resolves via
  findDesignToolboxSkill"` and `"phantom red spec: an unresolvable action returns null via
  findDesignToolboxSkill"` (pinned exact strings, closing `[R1-F1]`'s discoverability gap).
- Zero `skip`/`only`/`fixme`/`todo`.

The verifier runs this file for real (`pnpm --filter @open-design/e2e exec vitest run
tests/design-toolbox-phantom-id.test.ts --reporter=json` — package-relative, `[R1-F1]`) and requires
both pinned titles present and `passed`, zero failed tests overall, and every structural check above
satisfied.

**Satisfiability.** (a) is satisfied automatically by the verifier's own code once the real
production functions and a real daemon exist — no implementation action required beyond not
breaking them; teardown confirmation is entirely the verifier's own responsibility and does not
depend on the implementation at all. (b) is satisfied by a straightforward Vitest file following the
pinned shape, calling the real function (through its own normal, unaliased local binding) against
real live data fetched from its own booted daemon — the same shape
`e2e/tests/tools-dev/automations-routines.test.ts` already demonstrates for real HTTP against a real
daemon.

**Decoy.** `[R1-F3]`: a stub that hand-returns `null`/non-null without calling
`findDesignToolboxSkill` at all cannot affect (a), which the verifier computes independently of
anything in the delegated file — this closes the round-1 finding that the entire criterion
previously depended on trusting an uncalled import. For (b) specifically: an uncalled import is
caught by the call-presence check, now bound to the actual local identifier the import produces
(`[R3-F2]`) so an aliased-away import plus a same-named local lookalike no longer passes; a phantom
literal hidden in a comment is caught by the AST string-literal-node check; a decorative-looking
`createSmokeSuite`/`.with.toolsDev` mention inside an unrelated string or comment is caught by the
AST-bound chained-call check (`[R3-F2]`); two trivially-passing tests with plausible titles but empty
bodies would still make (a) — the primary evidence — correctly reflect reality, and would
additionally fail (b)'s "actually called at least twice" structural bar. `[R3-F5]`: a `tools-dev
stop` that reports `stopped` while a descendant process in the same group survives is caught by the
independent pid-liveness poll, which does not trust the reported status string at all.

---

### C10C-4 — Action→skill mapping: verifier-proven at runtime directly against the real registry, plus a required, exact-binding delegated artifact in the daemon suite

**Criterion.** Two independent lines of evidence, both required — mirrors C10C-3's structure:

**(a) The verifier's own direct runtime proof:** the verifier dynamically imports
`apps/daemon/src/skills.ts` (`listSkills`, `findSkillById`) and calls
`listSkills([repoRoot/skills])` to get the real, live `SkillInfo[]` (no daemon boot needed — this
claim is specifically about in-process function-call fidelity, matching what the delegated daemon
test itself must do). Using the C10C-1 Layer-B runtime-verified action list, it calls
`findSkillById(liveSkills, id)` for **every** `preferredSkillIds` entry of **every** action and
requires every one to resolve (`!== undefined`) — matching today's verified zero-phantom baseline.
This is a direct execution of the real registry-resolution algorithm, not an inference from source
text.

**(b) A required, structurally-bound delegated artifact:** `apps/daemon/tests/design-toolbox-skill-refs.test.ts`
(Vitest, exact path — `[R1-F1]`), required shape:
- Reads `apps/web/src/runtime/design-toolbox.ts` as **text** (`fs.readFileSync`, never an ES
  `import` — the cross-app boundary in §2) and parses it with the TypeScript compiler API. **`[R3-F2]`
  This is now a real, DATA-FLOW-BOUND check**, not "some call to `ts.createSourceFile` or
  `ts.forEachChild` exists somewhere in the file" (round 3's finding: two decorative, unconnected
  calls each independently satisfied that check without ever actually walking the parsed source) —
  the verifier requires a variable declaration whose initializer is a direct `ts.createSourceFile(
  ...)` call, AND a `ts.forEachChild(X, ...)` call whose first argument is an Identifier referencing
  that same bound variable: a genuine, connected `createSourceFile → forEachChild` chain, to extract
  the same `{id, preferredSkillIds}[]` shape as C10C-1.
- Imports `listSkills`, `findSkillById`, and `SKILL_ID_ALIASES` from `../src/skills.js` (the daemon's
  own `.js`-extensioned internal-import convention — a plain static import, no dynamic-import
  workaround needed here per §2) — and the imports must use the **exact original exported names**
  (`element.propertyName?.text ?? element.name.text` on each `ImportSpecifier`, never a substring
  match on the local binding — `[R1-F4]`'s fix: `import { listSkills as findSkillByIdDecoration }`
  no longer passes, because the checked value is the *original* exported name `listSkills`, not the
  local alias). **`[R3-F2]` `SKILL_ID_ALIASES`'s import is now actually checked** (previously
  specified in this document's prose but never enforced by the verifier). `findSkillById` and
  `listSkills` must additionally be **called**, and `SKILL_ID_ALIASES` **referenced**, somewhere in
  the file — and, per round 3's unbound-import fix, every one of these checks is now bound to the
  actual LOCAL identifier each import produces (captured from the `ImportSpecifier`'s `.name`, which
  can differ from the original exported name under an alias), never to the exported name's text —
  `[R1-F4]`'s original "never requires imports or calls" fix, closed the rest of the way against
  alias-based evasion.
- Contains the literal string `w10c-daemon-suite-phantom-skill-id` as a genuine AST string-literal
  node value (same anti-comment fix as C10C-3).
- Does not import `apps/web/**` (the cross-app boundary check, unchanged from the original design).
- Two pinned test titles for the paired control: exactly `"positive control: a real skill id
  resolves via findSkillById"` and `"phantom red specs: an unresolvable skill id returns undefined
  via findSkillById"`.
- One test per action for coverage, titled exactly `` `preferredSkillIds for action "${id}" resolve
  via findSkillById` `` per derived action id.
- Zero `skip`/`only`/`fixme`/`todo`.

The verifier runs this file for real (`pnpm --filter @open-design/daemon exec vitest run
tests/design-toolbox-skill-refs.test.ts --reporter=json` — package-relative, `[R1-F1]`), requires
the two pinned pairing titles `passed`, requires every C10C-1-derived action id's pinned coverage
title `passed` (exact match, not substring — `[R1-F4]`'s "one title containing every action ID"
decoy no longer has anywhere to hide), and requires zero failed overall.

**Satisfiability.** (a) is satisfied automatically once `apps/daemon/src/skills.ts` and
`skills/**/SKILL.md` exist as they do today — no implementation action required. (b) is a
straightforward Vitest file importing real daemon production code by its real exported names and
text-parsing the web source exactly as `scripts/check-toolbox-skill-refs.test.ts` already
demonstrates is possible without a cross-app import violation — the changes from that existing
guard are (i) TS-compiler-API parsing instead of regex, (ii) `findSkillById` instead of
`existsSync`, (iii) exact-name-bound, called imports, and (iv) living in `apps/daemon/tests/`
instead of `scripts/`, per the wave brief's explicit instruction.

**Decoy.** `[R1-F4]`: `import { listSkills as findSkillByIdDecoration } from '../src/skills.js'`
without ever calling it is caught by the exact-original-name + call-presence checks — the prior
substring-on-local-binding check is gone. **`[R3-F2]`: `import { findSkillById: _unused } from
'../src/skills.js'` (import present, aliased away, never called) plus an unrelated local
`function findSkillById() {...}` sharing the original name is now caught too** — the call-count
check is bound to the LOCAL identifier the import actually produces (`_unused`), not to the text
`findSkillById`, so calls to the local lookalike no longer satisfy it. A test that regex-scans
`design-toolbox.ts`, or that calls `ts.createSourceFile`/`ts.forEachChild` decoratively without
connecting the two, is caught by the data-flow-bound compiler-API check (`[R3-F2]`). An import that
omits `SKILL_ID_ALIASES` entirely — previously undetectable — now fails the criterion directly
(`[R3-F2]`). "One title containing every action ID" is caught by the pinned exact per-action title
format, which cannot describe more than one id. A phantom literal hidden in a comment is caught by
the AST string-literal-node check. And regardless of any gap in (b), (a) — the verifier's own direct
call against the real registry — independently and correctly reports whether every
`preferredSkillIds` entry actually resolves, so the criterion cannot pass on a decorative (b) alone.

---

### C10C-5 — UI/CLI parity of the skill-registry data source

**Scope note (orchestrator ruling 1, §9):** this criterion is deliberately scoped to the skills
**listing** surface the toolbox's resolution actually consumes, not to "applying a toolbox action"
itself. The ruling held that the toolbox is a UI recommendation layer over already-CLI-reachable
primitives (staging a skill, composing a prompt) and adds no new user-facing *capability* under
`AGENTS.md`'s dual-track rule — so there is no companion HTTP/CLI surface for this criterion to
parity-check, and none is added. This is a closed decision, not a scope gap to reopen.

**Criterion.** The verifier boots an isolated, namespaced, daemon-only tools-dev runtime (`pnpm
tools-dev start daemon --namespace <fresh> --json` — `start`, not `run`: `run` blocks in the
foreground until interrupted, confirmed by reading `tools-dev`'s own CLI registration
("Start apps and keep this command alive until interrupted"), which is unusable for a script that
needs to probe-then-exit; `start` returns once the daemon is confirmed running, which the verifier
uses directly), a temp `OD_DATA_DIR`, no fixed port — the daemon self-assigns and the verifier
discovers the assigned URL from `start`'s own JSON output (falling back to a `status daemon --json`
call), never ports 7456/51012 (hard-checked before any request). It fetches `GET /api/skills`
directly over HTTP (`redirect: 'manual'`, URL re-validated against the discovered loopback origin
immediately before the request, fail-closed on any mismatch or 3xx), separately invokes the real
`od skills list --json` CLI (`node --import tsx apps/daemon/src/cli.ts skills list --json
--daemon-url <discovered-url>` — explicit `--daemon-url` on every invocation so the CLI can never
fall back to IPC/tools-dev discovery and reach a *different*, possibly-default-namespace daemon),
and asserts the two responses' skill `id` **multisets** (occurrence-counted, never
`Set`-deduplicated) are identical — an added, removed, or duplicated id on either side is visible.
**`[R3-F5]`** Tears the daemon down using the same shared, fail-closed `withIsolatedDaemon` helper
C10C-3 uses (§C10C-3's teardown-confirmation description applies verbatim here: captured boot pid,
`tools-dev stop --json` actually read, independent pid-liveness polling, process-group escalation on
survival, `teardownOk` folded into this criterion's own overall verdict) — in a `finally` block,
regardless of outcome, and never trusting a single reported exit status.

**Satisfiability.** `od skills list` (`apps/daemon/src/cli.ts:runSkills` →
`runLibraryList('skills', ...)`) already `fetch()`es `${base}/api/skills` directly — it is a thin
HTTP client of the exact route the web UI calls, both backed by the single `listAllSkills()` /
`listSkills()` implementation (§2, ground fact). This criterion is expected to already pass
pre-implementation, confirmed by actually running it in this session (isolated port discovered
live, both surfaces returned 168 matching ids); it exists to lock the parity down as a mechanical
regression guard, the same class of "already true, now checked" criterion `verify-w9-ingest.ts`'s
C9-2 represents for its own wave.

**Decoy.** `[R1-F6]`: a CLI-side reformatting or filtering layer added later (e.g. a legacy
compatibility remap that silently drops an id, or collapses two distinct entries into one) is
caught by the occurrence-counted multiset comparison — a `Set`-based check would miss a case where
the CLI returns the right *distinct* ids but the wrong *count* of one. **This criterion makes no
claim about response ordering** — `multisetDiff` deliberately discards order and only reports
additions, removals, and per-id count mismatches; the prior draft's decoy argument incorrectly
claimed reordering was also detected, which round 1 correctly flagged as false. There is no
ordering contract on `GET /api/skills`/`od skills list` for this criterion to test, so none is
claimed.

---

### C10C-6 — Standard gates green

**Criterion.** `pnpm guard` and `pnpm typecheck` both exit 0 on the current tree.

**Satisfiability.** Both are already green on this tree (verified: guard 102/102, typecheck clean
across every workspace project, including after adding the probe files used to confirm §2's
dynamic-import and package-relative-path facts, which were removed before this commit) and stay
green through test-only additions that follow the repo's existing TypeScript-first,
boundary-respecting conventions documented in §2.

**Decoy.** N/A in the R4 sense (this is not a rejection criterion) — but note per
`VERIFICATION-CONTRACT.md` §3 R3, this is not a "counting" criterion: it does not accept a partial
guard run or a filtered subset; it is the same two whole-repo commands every other wave's
equivalent criterion (`CC-9`, `C9-9`) runs.

---

### C10C-7 — Adversarial review of the implementation is on record, non-spoofable

**Criterion.** `docs/plans/waves/w10c-toolbox-implementation-review.json` exists (read at `HEAD`)
and parses as `{reviewer: string, model: string, reviewedCommit: string, verdict: string}`. The
verifier checks:
- `model` is present and a non-empty (post-trim) string — `[R1-F7]`'s fix: previously parsed but
  never validated.
- `reviewedCommit` resolves to a real commit and is a **strict ancestor** of `HEAD` (never `HEAD`
  itself — the same "cannot contain its own SHA" reasoning `W9-ingest-tranche.md` §S9-6 documents).
- `git diff --name-only reviewedCommit HEAD` over this wave's **complete** owned
  implementation/evidence path list is **empty**: `e2e/ui/design-toolbox-actions.test.ts`,
  `e2e/tests/design-toolbox-phantom-id.test.ts`, `apps/daemon/tests/design-toolbox-skill-refs.test.ts`,
  `apps/web/src/runtime/design-toolbox.ts`, `apps/web/src/i18n/types.ts`,
  `apps/web/src/i18n/locales/en.ts`, `apps/web/tests/components/ChatComposer.design-toolbox.test.tsx`,
  and `scripts/check-toolbox-skill-refs.test.ts` — `[R1-F7]`'s fix: the prior list omitted the last
  two (both lease-allowed, both able to change post-review while the criterion stayed green).
- `reviewer` is distinct from every commit author across `baseCommit..reviewedCommit`. `[R1-F7]`'s
  fix: identity matching now handles the combined `"Name <email>"` form and surrounding whitespace —
  the verifier trims `reviewer`, and if it matches `/^(.*)<([^>]+)>$/`, additionally extracts and
  separately checks the trimmed name-only and email-only parts against the authors set (which
  itself already contains bare names and bare emails from `git log --format=%an%x00%ae`) — so
  `"Jane Doe <jane@example.com>"` is caught if either "jane doe" or "jane@example.com" is an author,
  not only if the combined string happens to match verbatim.
- **`[R3-F6]` `reviewer` must be non-empty AFTER trimming, not just truthy.** Round 3's finding: a
  whitespace-only string (e.g. `" "`) is truthy (non-empty `.length`), so the prior `if (!reviewer)`
  presence check let it through; it then matched no commit author (whitespace is not anyone's name
  or email) and the criterion silently passed with no real reviewer identity on record. The verifier
  now derives `reviewer` as `null` unless the raw string is non-empty after `.trim()`, so a
  whitespace-only value is rejected at the same point a missing one already was.
- `verdict === "APPROVE"`.

**Satisfiability.** Commit the complete implementation as some real commit P; a distinct reviewer
reviews P; the review record naming P is committed afterward (even as `HEAD` itself, adding only
that one file) — P's SHA is already stable by construction, so there is no chicken-and-egg problem.

**Decoy.** A review record naming `HEAD` itself is rejected by the strict-ancestor check. A review
record whose `reviewedCommit` predates a later fix to any of the eight owned paths — including the
two `[R1-F7]` added — is rejected by the empty-diff check. A same-author "review" is rejected by the
author-distinctness check across the full `baseCommit..reviewedCommit` range; writing the reviewer
field as `"Name <email>"` specifically to dodge a bare-string match no longer works (`[R1-F7]`). An
empty or placeholder `model` field is now itself a failure.

---

### C10C-8 — `human:` The capability-decision record itself landed through the review lane

**`[R1-F8]` originally added `C10C-8`** as a `human:`-marked, `DECISIONS.md`-gated criterion
(mirroring `W9-ingest-tranche.md`'s `acceptedRisk.decisionRef` pattern) specifically because the
underlying question — does applying a toolbox action need its own `od`/HTTP capability under
`AGENTS.md`'s dual-track rule — was genuinely open and this PRD-expansion pass had no authority to
resolve it unilaterally.

**Round 2 removed it, reasoning the orchestrator's direct ruling on that question (§9, ruling 1)
closed the gate `C10C-8` existed for.** **Round 3 reinstates it — this was wrong, per the
orchestrator's own correction.** The mistake was conflating two different claims: "has the
capability question been *decided*" (yes, by the ruling — that's a fact about this PRD's own frozen
prose, and this PRD cannot mechanically verify its own prose) and "has that decision *landed on the
record, through the review lane, at a point this wave cannot influence*" (a genuinely external,
mechanically-checkable fact, once the ruling was transcribed into `docs/plans/waves/DECISIONS.md` —
which it since was, via the merged `main` tip: the `### W10C-CAPABILITY-DECISION` block confirmed in
§2). A criterion that would trivially and permanently read `pass` *by construction of this
document's own text* is not measuring anything (round 2's instinct was correct there); a criterion
that reads the actual, external, review-lane-gated record is a different thing entirely, and **is**
measuring something — exactly the invariant the reviewer's finding-7 named: "the exact
`W10C-CAPABILITY-DECISION` / `Decision: exempt` block already exists on main and IS a fail-able
invariant."

**Criterion.** `human:`-marked per `VERIFICATION-CONTRACT.md` §3 R7 — this criterion legitimately
resolves `blocked-on-founder`, not `fail`, when the record has not yet landed (an unanswered
question, not a defect). The verifier reads `docs/plans/waves/DECISIONS.md` **at `baseCommit`, never
`HEAD`** (`git show <baseCommit>:docs/plans/waves/DECISIONS.md` — the proposed lease, §6, denies this
file to W10c, and a wave branch cannot reach the docs lane at all regardless of lease wording, so
`baseCommit` is a fixed point this wave's own commits structurally cannot influence):
- If the file cannot be read at `baseCommit`, or no `### W10C-CAPABILITY-DECISION` heading exists in
  it: **`blocked-on-founder`** — the capability question has not yet landed through the review lane.
- If the heading exists, the verifier parses its block (everything up to the next `### ` heading or
  EOF) for `- Decision: <...>`, `- Decider: <...>`, `- Date: <...>`, `- Rationale: <...>` bullet
  lines and requires:
  - `Decision` is exactly `exempt` or `build-now` (case-insensitive) — the two legitimate answers to
    the underlying question; anything else is malformed.
  - `Decider`, `Date`, and `Rationale` are all present and non-empty. **`[R3-F6]`** `Decider` is
    additionally rejected if it normalizes to nothing after trimming (the same whitespace-only-string
    bug class C10C-7's `reviewer` check closes).
  - **`[R3-F7]` `Decider` is checked against commit authors**, mirroring C10C-7's reviewer-distinctness
    pattern exactly: it must not match any author of this wave's own commits (`baseCommit..HEAD`,
    via the same `commitAuthorsBetween`/`identityMatchesAnyAuthor` machinery C10C-7 uses) — so an
    implementer cannot self-attribute founder/orchestrator decision authority under their own commit
    identity while implementing this wave.
  - A record present but failing any of the above resolves **`fail`** (a defect in a landed record),
    not `blocked-on-founder` (which is reserved for "not yet landed at all").
- **The criterion's own assertion text states plainly — and this document repeats it, because it is
  the whole point of the round-3 correction — that a passing `C10C-8` proves the capability-decision
  record landed through the review lane that produced `baseCommit`. It does NOT, and cannot, prove
  that any particular person actually holds founder or delegated-orchestrator authority; that is a
  human, off-repository fact this mechanism was never capable of verifying and does not claim to.**

**Satisfiability.** Already satisfied today: the merged `main` tip's `### W10C-CAPABILITY-DECISION`
block (§2) has `Decision: exempt`, a non-empty `Decider`/`Date`/`Rationale`, and a `Decider` string
("Fable 5 orchestrator under gate authority delegated by Devin Wiggins (founder) on 2026-07-28")
that does not match any git author identity, let alone this wave's own. Confirmed by actually
running the verifier against this tree's `baseCommit` this round: `C10C-8` reads `pass`.

**Decoy.** Deleting the `DECISIONS.md` record (or reverting past it) is caught by the missing-heading
`blocked-on-founder` branch — not a silent pass, and not a hard `fail` either, correctly reflecting
"the question genuinely has not been decided on the record" rather than "someone broke something." A
malformed `Decision` value, or a `Decider`/`Date`/`Rationale` left blank, is caught by the field
checks and resolves `fail`. A wave implementer who edits `DECISIONS.md` directly to fabricate a
favorable record cannot do so at all without violating the LEASE check (`DECISIONS.md` stays in
`deny`, §6) — and even setting the lease aside, `C10C-8` reads at `baseCommit`, a point strictly
before any of this wave's own commits, so no commit this wave makes could ever be reflected in what
`C10C-8` reads. A `Decider` value that happens to equal this wave's own implementing identity (e.g. a
self-serving "I, the implementer, hereby rule...") is caught by the author-distinctness check. The
manifest's expected criteria set (§7) includes `C10C-8` again.

---

### Infra: GATE-INTEGRITY, LEASE, HEAD-DRIFT

Mirrors `verify-w9-ingest.ts` exactly (`VERIFICATION-CONTRACT.md` §3 R9, §7 "Gate integrity" theme):

- **GATE-INTEGRITY** — advisory self-hash pin. The verifier hashes its own file
  (`scripts/waves/verify-w10c.ts`) and compares against
  `~/.claude/goal-state/mishmash-w10c-toolbox/approved-gate.sha256` if present. Absent (the normal
  pre-approval state): records `pass` with `gateIntegrityPinned: false` in the manifest — advisory,
  not a block, because the **primary** control is the LEASE check below (which reads
  `leases.json@baseCommit`, not the working tree, so the wave cannot widen its own lease) plus this
  PRD + verifier both being in the proposed lease's **deny** list (next section) — a second,
  independent mechanical control an implementation branch cannot route around merely by not
  editing the verifier file, since editing either denied file at all is itself a LEASE violation.
  Present: fails if the current hash disagrees (the verifier was modified after orchestrator
  approval).
- **LEASE** — `git diff --name-only <baseCommit>...HEAD` must be a subset of
  `leases.json@baseCommit`'s `waves["W10c"].allow` globs, minus `.deny` (deny always wins), read via
  `git show <baseCommit>:docs/plans/waves/leases.json` — never the working tree, so the wave cannot
  widen its own lease by editing the file mid-run. **Expected to fail on `main` today and on this
  PRD-authoring commit**, because no `"W10c"` entry exists in `leases.json` yet — this is correct,
  intentional clean-red behavior, not a bug: the lease entry is added by the orchestrator after this
  PRD freezes, exactly as `W9-ingest`'s entry was added after its own PRD landed.
- **HEAD-DRIFT** — `git rev-parse HEAD` re-resolved at the end of the run must equal the value
  resolved at the start. Guards against a concurrent writer moving the branch mid-verification.

## 6. Proposed lease

**PRD text only — not yet enacted in `leases.json`.** The orchestrator transcribes this into
`docs/plans/waves/leases.json` → `waves["W10c"]` after this document freezes. Format matches the
`$comment` in `leases.json` and mirrors the other wave entries' `{slug, allow, deny, note}` shape.

```jsonc
"W10c": {
  "slug": "mishmash-w10c-toolbox",
  "allow": [
    "e2e/ui/design-toolbox-*.test.ts",
    "e2e/tests/design-toolbox-*.test.ts",
    "apps/daemon/tests/design-toolbox-*.test.ts",
    "apps/web/src/runtime/design-toolbox.ts",
    "apps/web/tests/components/ChatComposer.design-toolbox.test.tsx",
    "apps/web/src/i18n/types.ts",
    "apps/web/src/i18n/locales/en.ts",
    "scripts/check-toolbox-skill-refs.test.ts",
    "docs/plans/waves/w10c-toolbox-implementation-review.json"
  ],
  "deny": [
    "docs/plans/waves/W10c-toolbox.md",
    "scripts/waves/verify-w10c.ts",
    "docs/plans/waves/leases.json",
    "docs/plans/waves/DECISIONS.md",
    "docs/security/**"
  ],
  "note": "Toolbox reliability (NM-19). No apps/daemon/src/** production code expected -- the
    daemon suite addition binds to existing listSkills()/findSkillById()/SKILL_ID_ALIASES without
    modifying them. i18n files are granted narrowly in case C10C-1's cross-check surfaces a real
    id/key mismatch that needs fixing; design-toolbox.ts is granted for the same amend-on-proof
    reason. scripts/check-toolbox-skill-refs.test.ts is NOT modified by this wave (orchestrator
    ruling 3, kept as a floor) -- it stays in allow only because it was already allow-listed pre-
    ruling and no criterion forbids touching it if a future amendment needs to; nothing in this
    PRD requires editing it. DECISIONS.md is in deny -- this wave (C10C-8, reinstated round 3)
    READS it via `git show <baseCommit>:...`, which the LEASE check does not gate at all (LEASE
    only restricts the working-tree DIFF between baseCommit and HEAD); the wave never needs, and
    is never granted, WRITE access to it. Keeping it in deny is a second, independent guarantee on
    top of the baseCommit-read design: even if a wave branch commit somehow touched this file, that
    would itself be a LEASE violation, and C10C-8 would still be reading the pre-wave baseCommit
    content regardless. HOUSE RULE: this wave's own PRD and verifier are in deny -- gate integrity
    is bound by the orchestrator-held approved copy + approved-gate.sha256 (GATE-INTEGRITY
    criterion), not by trusting the implementing branch not to edit its own gate."
}
```

Nothing in `apps/daemon/src/**`, `apps/web/src/components/**` (other than the two narrow grants
above), or any other wave's files is leased. If implementation proves a wider grant necessary (the
"amend-on-proof" pattern `W9-ingest-tranche.md` and `leases.json`'s `W1`/`W4` amendments both use),
that is a lease amendment recorded against `main`, not a unilateral implementation-branch edit.

## 7. Definition of "green"

`manifest.criteria[].id` must equal exactly `{C10C-1, C10C-2, C10C-3, C10C-4, C10C-5, C10C-6,
C10C-7, C10C-8, GATE-INTEGRITY, LEASE, HEAD-DRIFT}` — 11 ids, no fewer, no more, no duplicates
(`C10C-8` was reinstated in round 3 after being wrongly removed in round 2 — see its criterion
section above for why). Every one of the eleven must read `status === "pass"` for a true wave pass.
`C10C-8` is the sole `human:`-marked criterion in this wave and may legitimately resolve
`blocked-on-founder` per `VERIFICATION-CONTRACT.md` §3 R7 if the `DECISIONS.md` record it reads has
not landed at the `baseCommit` a given run resolves against — in practice, on this tree today (the
record already landed via the merged `main` tip), it resolves `pass`, not `blocked-on-founder`.
`manifest.treeDirty === false`, `manifest.commit` matching the verified `HEAD`, every artifact
hash-matched. Nothing in the current wave program gates on this wave's manifest (`W5-W11-gated.md`'s
Wave 10 table lists no downstream dependent for `w10c-toolbox`), so there is no external "definition
of green" consumer analogous to W9-ingest's relationship with W3 — this section exists for internal
completeness only.

## 8. Verified baseline (this run, pre-implementation, post round-3 fixes)

- `DESIGN_TOOLBOX_ACTIONS`: 16 entries, 31 unique `preferredSkillIds` values, **zero phantoms
  today** by either the old directory-existence method or the real frontmatter-based registry
  resolution. Layer A (AST) and Layer B (runtime import) agree exactly; `Dict` is the sole
  interface with matching signatures; `en.ts` has full, non-empty coverage. **C10C-1 is expected
  to already pass** — and, per `[R1-F5]`'s hardening, this is a *meaningfully stronger* pass than
  before: it now also actively rejects the decoy-declaration, extra-property, and mutation-call
  shapes round 1 demonstrated the prior version would silently admit.
- i18n: 48 `chat.designToolbox.action.*` keys declared in `Dict`, all 48 non-empty in `en.ts`,
  exactly matching the 16 action ids × 3 keys.
- `FEATURED_DESIGN_TOOLBOX_ACTION_IDS`: 2 entries (`auto-match`, `visual-polish`) today, both a
  subset of the 16 derived actions; the 14 remaining actions are exactly `DESIGN_TOOLBOX_ACTIONS`
  minus the featured set (`NON_FEATURED_TOOLBOX_ACTIONS`'s own filter, read directly in
  `NextStepActions.tsx`) — the partition C10C-2 now asserts holds cleanly today, confirmed by
  direct inspection.
- `scripts/check-toolbox-skill-refs.test.ts`: exists, passes, wired into `pnpm guard` (confirmed in
  the 102/102 green run) — checks directory existence, not real registry resolution (§2, §3).
  **Untouched by this wave** (orchestrator ruling 3, §9) — C10C-4 supersedes its semantics with a
  real-registry-resolution check, but superseding is not a reason to delete a fast, free,
  zero-dependency floor; it stays exactly as-is.
- `apps/web/tests/components/ChatComposer.design-toolbox.test.tsx`: exists, exercises 2 of 16
  actions against hand-authored fixture skills, not the live registry.
- `e2e/ui/design-toolbox-actions.test.ts`, `e2e/tests/design-toolbox-phantom-id.test.ts`,
  `apps/daemon/tests/design-toolbox-skill-refs.test.ts`,
  `docs/plans/waves/w10c-toolbox-implementation-review.json`: **do not exist** — the delegated-file
  halves of C10C-2/C10C-3/C10C-4 and all of C10C-7 fail honestly. **C10C-2's own consumer-partition
  check and C10C-3/C10C-4's own verifier-side runtime oracles run regardless and are expected to
  already report their underlying claims as true** (the real functions, called directly by the
  verifier, do resolve correctly today, and the featured/non-featured partition already holds) —
  but each criterion's overall `status` still requires the delegated artifact half too (and, for
  C10C-2 as of this update, BOTH consumers' full 32-spec coverage), so C10C-2/3/4 still read `fail`
  overall pre-implementation. This is the concrete answer to the coordinator's "reconsider the
  5-of-10 baseline" instruction from round 1: C10C-2/3/4 are AND-gated (oracle **and** artifact), so
  neither half alone can carry the criterion, and a criterion that is already fully mechanically
  true today (C10C-1, C10C-5) is additionally hardened to be *falsifiable* against the specific
  decoy shapes round 1 demonstrated, not merely coincidentally true.
- `leases.json` has no `"W10c"` entry — LEASE fails honestly.
- `pnpm guard` / `pnpm typecheck`: both green on this tree today.
- `od skills list --json` / `GET /api/skills`: confirmed live in this session to return matching
  skill-id multisets from the same isolated daemon, with teardown independently confirmed by the
  round-3-hardened `withIsolatedDaemon` (no survivor pid, protected-daemon ports 7456/51012
  untouched, verified after every run) — **C10C-5 is expected to already pass**, and its decoy
  argument no longer overclaims order-detection (`[R1-F6]`); its scope is deliberately limited to
  this listing surface per orchestrator ruling 1.
- `docs/plans/waves/DECISIONS.md`'s `### W10C-CAPABILITY-DECISION` block, read at this run's
  `baseCommit`: `Decision: exempt`, non-empty `Decider`/`Date`/`Rationale`, `Decider` distinct from
  every `baseCommit..HEAD` commit author — **C10C-8 is expected to already pass** (confirmed live
  this round: it does).

**This round's fixes were confirmed by actually running the verifier against this tree, twice** (the
second run after fixing a real bug the first run's own output surfaced — `parseTs` was parsing
`NextStepActions.tsx` with `ScriptKind.TS` instead of `ScriptKind.TSX`, so its JSX was never
recognized as JSX at all and the new `data-testid`-literal check could not have passed for *any*
implementation, correct or not; fixed and reconfirmed clean). Both runs, and the confirming re-run
after fixing `parseTs`, report the identical scoreboard below; `typecheck` is clean; the
default-namespace daemon (ports 7456/51012) was confirmed still running, untouched, after each run;
no `verify-w10c-*`-namespaced process or temp data directory was left behind.

It is therefore expected and correct that this verifier's run reports a **mixed** scoreboard:
C10C-1, C10C-5, C10C-6, C10C-8, GATE-INTEGRITY, HEAD-DRIFT `pass`; C10C-2, C10C-3, C10C-4, C10C-7,
LEASE `fail` — 6/11, with an overall **non-zero exit**. This is what "clean-red" means for this
wave: an accurate, evidence-backed, non-crashing report of current reality, not a demand that every
single criterion returns false, and not a report where any currently-green criterion is green
merely because the check is too weak to fail on a shaped decoy.

## 9. Recorded rulings (formerly "Open founder questions")

This section previously surfaced three open founder questions without resolving them, per
`VERIFICATION-CONTRACT.md`'s "never resolve silently" posture. **The orchestrator has since ruled on
all three**, under founder authority explicitly delegated to the orchestrator for this project —
binding answers, cited below and throughout this document as "Orchestrator ruling under delegated
founder authority, 2026-07-28." The original questions are kept for traceability; they are no
longer open.

1. **Should "apply a design-toolbox action" become a first-class `od`/HTTP capability?**
   **RULING (Orchestrator ruling under delegated founder authority, 2026-07-28): NO.** The toolbox
   is a recommendation layer over primitives that are already CLI-reachable (staging a skill,
   composing a prompt); `AGENTS.md`'s dual-track rule binds user-facing *capabilities*, and this
   adds no new capability. Building one would be scope creep this wave does not undertake.
   `C10C-5`'s parity obligation stays scoped to the skills-listing surface the toolbox actually
   consumes (§C10C-5's scope note). This ruling was transcribed into
   `docs/plans/waves/DECISIONS.md`'s `### W10C-CAPABILITY-DECISION` record (`Decision: exempt`) via
   the merged `main` tip (§2). **`C10C-8` (§5) is reinstated, not to re-decide this question — the
   ruling above is final and this document does not reopen it — but to mechanically verify that the
   decision landed on the record, through the review lane, at a point (`baseCommit`) this wave's own
   commits cannot influence.** Round 2 removed `C10C-8` on the theory that the ruling itself closed
   the question with no further mechanical record needed; round 3 corrected that (see C10C-8's
   criterion section, §5, for the full reasoning) — the ruling closes the *question*, but whether
   that closure actually landed through the review lane is exactly the kind of externally-verifiable
   fact this program's criteria exist to check, and now is checked.
2. **Does the exhaustive per-action walk need to also cover `NextStepActions.tsx`?**
   **RULING (Orchestrator ruling under delegated founder authority, 2026-07-28): YES.** The wave's
   whole premise is that "exhaustive" means a per-action row, not an adjective, and a second
   consumer rendering the same shared data is exactly where drift hides. `C10C-2` is extended
   (§5) to cover both consumers, and — because the two render sets legitimately differ (2 featured
   rows always visible vs. 14 behind "More → Design toolbox") — the criterion asserts that
   intended difference explicitly (the featured/non-featured partition check) rather than picking
   one consumer and ignoring the other.
3. **Should `scripts/check-toolbox-skill-refs.test.ts` be retired now that C10C-4 supersedes it?**
   **RULING (Orchestrator ruling under delegated founder authority, 2026-07-28): KEEP IT**, as a
   cheap floor. It runs inside `pnpm guard`, costs nothing, and fails fast; a stronger check
   arriving (`C10C-4`) does not make a weaker fast one harmful. This wave does not touch that file
   — it is outside the two-file authoring limit for this PRD-expansion pass in any case. §8 records
   that C10C-4 supersedes its semantics while the floor remains, exactly as ruled.
