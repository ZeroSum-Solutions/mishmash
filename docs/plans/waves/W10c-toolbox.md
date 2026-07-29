# Wave 10c — Toolbox reliability (NM-19)

**Slug:** `mishmash-w10c-toolbox` · **Branch:** `feat/w10c-toolbox`
**Gates on:** W0 (landed) · **Loop:** `loop:red-green-review` (`VERIFICATION-CONTRACT.md` §6)
**Verifier:** `scripts/waves/verify-w10c.ts`
**Write lease:** `docs/plans/waves/leases.json` → `waves["W10c"]` — see **Proposed lease** below. Not yet
present in `leases.json`; this section is the PRD-text proposal the orchestrator transcribes after
this document freezes, mirroring how `W9-ingest`'s lease entry was added after its PRD landed.

**Status: EXPANSION, PRE-IMPLEMENTATION — FIX ROUND 1.** Per `docs/plans/waves/W5-W11-gated.md`
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
- **A second, independent consumer exists:** `apps/web/src/components/NextStepActions.tsx` (the
  assistant "next step" card) imports the same `DESIGN_TOOLBOX_ACTIONS` and
  `findDesignToolboxSkill`, splitting the 16 actions across two feature rows
  (`FEATURED_DESIGN_TOOLBOX_ACTION_IDS`) and a cascading "More → Design toolbox" flyout (the other
  14). This wave scopes its exhaustive walk to `DesignToolboxPanel` — the single-panel, searchable,
  title="Design toolbox" surface the skeleton's "side panel" language matches — not to
  `NextStepActions`' split hover-flyout. See **Open founder questions**, Q2.
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
  of it. This matters for the UI/CLI-parity criterion (§C10C-5) and for **C10C-8** (formerly a soft
  open question, now a formal founder-decision gate — `[R1-F8]`, see below) — the **skill registry
  data** already has CLI parity; the **toolbox action catalogue** (ids, preferred-skill mapping,
  composed prompts) has none today.
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
- UI/CLI parity of the skill-registry data source the toolbox's resolution depends on (C10C-5).
- Standard gates: `pnpm guard` / `pnpm typecheck` (C10C-6).
- Adversarial review of the implementation on record (C10C-7).
- A formal, mechanically-tracked founder decision on toolbox-action-application UI/CLI parity
  (C10C-8 — `[R1-F8]`; see §Open founder questions).

**Explicitly out of scope** (see also §Open founder questions):
- Extending the exhaustive walk to `NextStepActions.tsx`'s split rendering of the same catalogue (Q2).
- Retiring or rewriting the existing `scripts/check-toolbox-skill-refs.test.ts` guard (Q3) — the
  proposed lease permits either keeping it as a cheap floor or hardening it, but does not mandate
  either.
- Any change to `apps/daemon/src/skills.ts`'s resolution algorithm, `SKILL_ID_ALIASES`, or any
  `skills/*/SKILL.md` frontmatter. This wave tests the existing algorithm; it does not change it.
- Actually building a new toolbox-action-application HTTP/CLI capability — that is gated by C10C-8's
  founder decision, not decided by this PRD (`[R1-F8]`).
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

### C10C-2 — Per-action end-to-end walk from the Design Toolbox side panel, table-driven, cross-checked against a fresh runtime oracle

**Criterion.** Pinned artifact: `e2e/ui/design-toolbox-actions.test.ts` (Playwright, exact path —
`[R1-F1]`). Required shape, exactly:

1. At module scope (or in a `beforeAll`), load the real catalogue via the dynamic-import pattern
   from §2: `const { DESIGN_TOOLBOX_ACTIONS } = await import(pathToFileURL(path.resolve(...,
   'apps/web/src/runtime/design-toolbox.ts')).href);` — never a static `import` declaration
   (`[R1-F1]`, avoids the confirmed TS2835 failure).
2. `for (const action of DESIGN_TOOLBOX_ACTIONS) { test(`toolbox action ${JSON.stringify(action.id)}
   resolves and applies from the side panel`, async ({ page }) => { ... }); }` — one real Playwright
   `test()` call generated per catalogue entry, titled **exactly** `` `toolbox action "${action.id}"
   resolves and applies from the side panel` `` (pinned so the verifier can locate each row
   unambiguously — `[R1-F1]`'s "state exactly what must exist" instruction).
3. Each test body: navigates into a real project's chat composer (real tools-dev daemon/web via
   `@/playwright/suite`, real `skills/` directory); clicks `page.getByTestId('chat-plus-trigger')`;
   clicks the `role="menuitem"` row named `"Design toolbox"`; clicks the `role="menuitem"` row whose
   accessible name is that action's localized title; reads
   `await page.getByTestId('chat-composer-input').textContent()`; parses out any `@<name>` token
   from the read text as `resolvedName` (or `null` if none); and — the mechanical anti-decoy
   requirement `[R1-F2]` — `console.log(`W10C_RESOLVED ${action.id} ${resolvedName ?? '__NONE__'}`)`
   with the **actually-observed** value before the test ends.

The verifier:
- Confirms the file exists at the pinned path; fails with a named-missing-file detail otherwise.
- **Structural (AST) checks, `[R1-F2]`:** zero `test.skip`/`.only`/`.fixme`/`.todo` anywhere; a
  dynamic `import()` call whose argument subtree contains a string literal referencing
  `design-toolbox.ts` by path fragment (the computed-specifier form from §2 cannot be resolved to
  an exact file path statically, so the verifier requires this weaker-but-real structural signal
  instead of claiming false precision); a `for...of` loop over that imported binding whose body
  contains a `test(` call; and — scoped **specifically to that loop body's test callback**, not
  merely present anywhere in the file — at least one call whose callee property name is `click` and
  at least one call whose callee property name is `textContent` (or `innerText`).
- **Runs the suite for real** via `pnpm --filter @open-design/e2e exec playwright test -c
  playwright.config.ts ui/design-toolbox-actions.test.ts --reporter=json` (package-relative path —
  `[R1-F1]`) and requires: `run.specs.length` **exactly equals** the C10C-1-derived action count
  (no fewer — a dropped row fails; no more — an extraneous/no-op row fails, closing `[R1-F2]`'s "one
  no-op test whose title contains all action IDs" decoy, which now also fails structurally since its
  single title cannot match the pinned exact-title format for more than one id); every derived
  action id maps to **exactly one** spec whose title equals the pinned exact format for that id
  (not "contains" — exact string equality, so a single title cannot straddle two ids); every matched
  spec is `ok === true`.
- **`[R1-F2]`'s primary fix — an independent, freshly-computed runtime oracle, not a trust of the
  delegated file's self-report:** for each derived action, the verifier itself dynamically imports
  `design-toolbox.ts` (`findDesignToolboxSkill`) and `apps/daemon/src/skills.ts` (`listSkills`),
  calls `listSkills([repoRoot/skills])` once to get the real, live `SkillInfo[]` (pure filesystem
  read — deterministic and daemon-independent, so it is a valid stand-in for "what the real running
  app would see" without needing to share the Playwright suite's own separately-booted daemon
  process), and computes `expected = findDesignToolboxSkill(action, liveSkills)?.name ?? '__NONE__'`
  for every action. It then parses every matched spec's `results[].stdout[].text` entries (the
  confirmed-live schema path from §2) for a line matching `^W10C_RESOLVED (\S+) (.+)$`, and requires
  the captured value to **exactly equal** the independently-computed `expected` for that action. A
  test whose body never performs a real click/read cannot fabricate a correct marker across all 16
  actions without independently discovering the same 16 different real answers the verifier itself
  computes fresh each run — combined with the required `.click(`/`.textContent(` calls inside the
  loop body (previous bullet) and the requirement that the run must actually pass (not hang/error on
  a bogus selector), this closes the decorative-decoy class `[R1-F2]` named.

**Satisfiability.** A legitimate implementation writes the one required loop, using the confirmed
dynamic-import pattern and the confirmed selectors from §2 (`chat-plus-trigger`, the `"Design
toolbox"` menuitem, per-action menuitems by accessible name, `chat-composer-input`), and reports the
value it actually read. This produces 16 real passing rows today whose marker values match the
verifier's own oracle, because both sides compute the same deterministic function over the same
`skills/` directory.

**Decoy.** An implementer who pastes today's 16 ids into a local literal array instead of importing
the real catalogue is caught by the required dynamic-import-referencing-`design-toolbox.ts` check.
A single no-op test whose title lists every id is caught structurally (the pinned exact-title format
cannot match more than one id per spec, and the exact-count check requires 16 distinct specs). A
test that fabricates a plausible-looking `W10C_RESOLVED` line without actually clicking/reading is
caught by (a) the required `.click(`/`.textContent(` call-presence check inside the loop body and
(b) the marker value having to agree with the verifier's own fresh computation for all 16 actions
simultaneously — hardcoding 16 correct answers today does not survive the next skill rename, which
changes the verifier's oracle output but not a hardcoded marker.

---

### C10C-3 — Phantom-ID red spec: verifier-proven at runtime directly, plus a required, structurally-bound delegated artifact

**Criterion.** Two independent lines of evidence, both required — `[R1-F3]`'s fix is that the first
one no longer depends on trusting the second:

**(a) The verifier's own direct runtime proof (the primary evidence — "boot the isolated daemon,
make the real request, assert the real response," executed by the verifier itself, not delegated):**
the verifier boots one isolated, namespaced, daemon-only tools-dev runtime (same mechanism as
C10C-5 — temp `OD_DATA_DIR`, no fixed port, never 7456/51012, torn down by exact PID in a `finally`
block regardless of outcome), fetches the real, live `skills` array from that daemon's
`GET /api/skills` (fail-closed: `redirect: 'manual'`, origin re-validated immediately before the
request), dynamically imports the real `findDesignToolboxSkill` from `design-toolbox.ts` (§2
pattern), and asserts **directly, in the verifier's own process**: a real action (the first entry of
the C10C-1-derived catalogue) resolves to a non-null skill against that live list; a synthetic
action-shaped object with `preferredSkillIds: ['w10c-red-spec-phantom-skill-id']`,
`categoryHints: []`, `searchTerms: ['w10c-red-spec-unmatchable-search-term']` resolves to `null`
against the same live list. This is a real execution of real production code against a real,
freshly-served registry — independent of any checked-in test file's honesty.

**(b) A required, structurally-bound delegated artifact:** `e2e/tests/design-toolbox-phantom-id.test.ts`
(Vitest, exact path — `[R1-F1]`), required shape:
- Imports `createSmokeSuite` from `@/vitest/suite` and calls it, then calls `.with.toolsDev(...)`
  (structural presence check — real daemon boot, matching `e2e/AGENTS.md`'s pure-inspect default).
- Loads `findDesignToolboxSkill` via the same dynamic-import pattern as C10C-2 (structural check:
  dynamic `import()` whose argument subtree contains a string literal referencing
  `design-toolbox.ts`; the bound property name in the destructuring pattern must be exactly
  `findDesignToolboxSkill`, not a substring match on any local alias — `[R1-F4]`'s exact-name fix
  applied here too), and that bound identifier must actually be **called** (a `CallExpression`
  whose callee is that exact identifier) at least twice.
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
breaking them. (b) is satisfied by a straightforward Vitest file following the pinned shape, calling
the real function against real live data fetched from its own booted daemon — the same shape
`e2e/tests/tools-dev/automations-routines.test.ts` already demonstrates for real HTTP against a real
daemon.

**Decoy.** `[R1-F3]`: a stub that hand-returns `null`/non-null without calling
`findDesignToolboxSkill` at all cannot affect (a), which the verifier computes independently of
anything in the delegated file — this closes the round-1 finding that the entire criterion
previously depended on trusting an uncalled import. For (b) specifically: an uncalled import is
caught by the call-presence check; a phantom literal hidden in a comment is caught by the AST
string-literal-node check; two trivially-passing tests with plausible titles but empty bodies would
still make (a) — the primary evidence — correctly reflect reality, and would additionally fail (b)'s
"actually called at least twice" structural bar.

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
  `import` — the cross-app boundary in §2) and parses it with the TypeScript compiler API
  (`import ts from 'typescript'`; a real `ts.createSourceFile`/`ts.forEachChild` call, positively
  confirmed by the verifier's own AST scan — never a regex/string scan) to extract the same
  `{id, preferredSkillIds}[]` shape as C10C-1.
- Imports `listSkills`, `findSkillById`, and `SKILL_ID_ALIASES` from `../src/skills.js` (the daemon's
  own `.js`-extensioned internal-import convention — a plain static import, no dynamic-import
  workaround needed here per §2) — and the imports must use the **exact original exported names**
  (`element.propertyName?.text ?? element.name.text` on each `ImportSpecifier`, never a substring
  match on the local binding — `[R1-F4]`'s fix: `import { listSkills as findSkillByIdDecoration }`
  no longer passes, because the checked value is the *original* exported name `listSkills`, not the
  local alias). Both `findSkillById` and `listSkills` must additionally be **called** somewhere in
  the file (a `CallExpression` whose callee is exactly that identifier) — `[R1-F4]`'s "never
  requires imports or calls" fix.
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
substring-on-local-binding check is gone. A test that regex-scans `design-toolbox.ts` is caught by
the positive-evidence compiler-API-call check. "One title containing every action ID" is caught by
the pinned exact per-action title format, which cannot describe more than one id. A phantom literal
hidden in a comment is caught by the AST string-literal-node check. And regardless of any gap in (b),
(a) — the verifier's own direct call against the real registry — independently and correctly reports
whether every `preferredSkillIds` entry actually resolves, so the criterion cannot pass on a
decorative (b) alone.

---

### C10C-5 — UI/CLI parity of the skill-registry data source

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
Tears the daemon down by the exact PID the boot step reported, in a `finally` block, regardless of
outcome.

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

### C10C-8 — Founder decision on record: does toolbox-action-application need its own UI/CLI capability?

**`[R1-F8]`: this criterion did not exist in the round-1 draft, where the same question was left as
a soft, non-blocking "open question" (former Q1). Round 1 ruled that blocking, per repository
authority (`AGENTS.md` → "Capability exposure (UI/CLI dual-form)": "Every user-facing capability
must be reachable through both the web UI and the `od` CLI... If a capability is UI-only, it cannot
be composed into those external agents"), and required either action HTTP/CLI criteria with a
matching lease, or an explicit maintainer/founder exemption, before freeze. Building new production
HTTP/CLI surface is a product decision this PRD-expansion pass has no authority to make unilaterally
(exactly the kind of question §Open founder questions exists to surface, not resolve) — so this
criterion makes the required decision itself the mechanically-tracked gate, using the same
`DECISIONS.md`-read (never write) pattern `W9-ingest-tranche.md`'s `acceptedRisk.decisionRef`
already establishes as this program's sanctioned mechanism for exactly this situation
(`VERIFICATION-CONTRACT.md` §3 R7).**

**`human:` marked — legitimately resolves to `blocked-on-founder`, per R7.**

**Criterion.** The verifier reads `docs/plans/waves/DECISIONS.md` at `HEAD` (not `baseCommit` — the
decision may land on `main`, and therefore into this wave's history, at any point up through
implementation, unlike an already-landed accepted-risk record read at a fixed `baseCommit`) and
searches for a heading matching exactly `### W10C-CAPABILITY-DECISION`.

- **Heading absent:** `status = "blocked-on-founder"` — the legitimate, expected pre-decision state
  (R7: "does not block the autonomous loop; it blocks landing").
- **Heading present, more than once:** `status = "fail"` (ambiguous — a duplicate heading id is
  unresolvable everywhere, mirroring `W9-ingest-tranche.md`'s DECISIONS.md ruling).
- **Heading present exactly once:** parse the block up to the next `## `/`### ` heading or EOF for
  `- Decision: `, `- Decider: `, `- Date: `, `- Rationale: ` fields. `status = "pass"` only if all
  hold: `Decision` is exactly `build-now` or `exempt` (trimmed); `Decider` is present and — using
  the same `[R1-F7]` identity-matching helper as C10C-7 — distinct from every commit author across
  `baseCommit..HEAD`; `Date` is present; `Rationale` is present and at least 20 characters after
  trimming (rejects a placeholder). Otherwise `status = "fail"` (a malformed attempt at the record
  is a real defect, not a legitimate pending state).

**Satisfiability.** The founder (or a delegate acting on the founder's explicit instruction) adds
one heading block to `DECISIONS.md`, choosing either `build-now` (which then requires a follow-up
PRD amendment adding the actual capability criteria and a lease amendment — out of this fix round's
scope, and correctly so: this PRD-expansion pass has no authority to design that surface
unilaterally) or `exempt` (closing the question outright, matching the review's explicitly-offered
second valid path: "an explicit maintainer/founder exemption"). Either way the `Decider` is someone
other than whoever implements this wave, mirroring `W9-ingest-tranche.md`'s existing pattern.

**Decoy.** An implementer authoring their own `Decider: <self>` entry to wave the requirement
through is caught by the same author-distinctness check C10C-7 uses. A record citing the wrong
heading text, or missing a required field, is caught by the exact-heading and field-presence checks
and resolves to `fail`, not a silent pass. A record that exists but is malformed does **not** get
the benefit of `blocked-on-founder`'s "legitimate pending state" — only a genuinely absent heading
does; a botched one is scored as a real failure so it cannot be used to argue "we tried" without
actually producing a valid record.

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
    "docs/plans/waves/w10c-toolbox-implementation-review.json",
    "docs/plans/waves/DECISIONS.md"
  ],
  "deny": [
    "docs/plans/waves/W10c-toolbox.md",
    "scripts/waves/verify-w10c.ts",
    "docs/plans/waves/leases.json",
    "docs/security/**"
  ],
  "note": "Toolbox reliability (NM-19). No apps/daemon/src/** production code expected -- the
    daemon suite addition binds to existing listSkills()/findSkillById()/SKILL_ID_ALIASES without
    modifying them. i18n files are granted narrowly in case C10C-1's cross-check surfaces a real
    id/key mismatch that needs fixing; design-toolbox.ts is granted for the same amend-on-proof
    reason. DECISIONS.md added to allow (round-1 fix, R1-F8) mirroring W9-ingest's precedent --
    C10C-8's founder decision record may be committed on this branch, with the SAME
    distinct-author enforcement (Decider != any commit author) W9-ingest's acceptedRisk pattern
    uses, so an implementer cannot author their own exemption. HOUSE RULE: this wave's own PRD and
    verifier are in deny -- gate integrity is bound by the orchestrator-held approved copy +
    approved-gate.sha256 (GATE-INTEGRITY criterion), not by trusting the implementing branch not
    to edit its own gate."
}
```

Nothing in `apps/daemon/src/**`, `apps/web/src/components/**` (other than the two narrow grants
above), or any other wave's files is leased. If implementation proves a wider grant necessary (the
"amend-on-proof" pattern `W9-ingest-tranche.md` and `leases.json`'s `W1`/`W4` amendments both use),
that is a lease amendment recorded against `main`, not a unilateral implementation-branch edit.

## 7. Definition of "green"

`manifest.criteria[].id` must equal exactly `{C10C-1, C10C-2, C10C-3, C10C-4, C10C-5, C10C-6,
C10C-7, C10C-8, GATE-INTEGRITY, LEASE, HEAD-DRIFT}` — 11 ids, no fewer, no more, no duplicates.
Ten of the eleven must read `status === "pass"`. **C10C-8 is the sole exception, per R7**: it may
legitimately read `status === "blocked-on-founder"` (heading genuinely absent) without that
counting as an implementation defect — but the wave is not "fully landable" until it too reads
`pass`. `manifest.treeDirty === false`, `manifest.commit` matching the verified `HEAD`, every
artifact hash-matched. Nothing in the current wave program gates on this wave's manifest
(`W5-W11-gated.md`'s Wave 10 table lists no downstream dependent for `w10c-toolbox`), so there is no
external "definition of green" consumer analogous to W9-ingest's relationship with W3 — this
section exists for internal completeness only.

## 8. Verified baseline (this run, pre-implementation, post round-1 fixes)

- `DESIGN_TOOLBOX_ACTIONS`: 16 entries, 31 unique `preferredSkillIds` values, **zero phantoms
  today** by either the old directory-existence method or the real frontmatter-based registry
  resolution. Layer A (AST) and Layer B (runtime import) agree exactly; `Dict` is the sole
  interface with matching signatures; `en.ts` has full, non-empty coverage. **C10C-1 is expected
  to already pass** — and, per `[R1-F5]`'s hardening, this is a *meaningfully stronger* pass than
  before: it now also actively rejects the decoy-declaration, extra-property, and mutation-call
  shapes round 1 demonstrated the prior version would silently admit.
- i18n: 48 `chat.designToolbox.action.*` keys declared in `Dict`, all 48 non-empty in `en.ts`,
  exactly matching the 16 action ids × 3 keys.
- `scripts/check-toolbox-skill-refs.test.ts`: exists, passes, wired into `pnpm guard` (confirmed in
  the 102/102 green run) — but checks directory existence, not real registry resolution (§2, §3).
- `apps/web/tests/components/ChatComposer.design-toolbox.test.tsx`: exists, exercises 2 of 16
  actions against hand-authored fixture skills, not the live registry.
- `e2e/ui/design-toolbox-actions.test.ts`, `e2e/tests/design-toolbox-phantom-id.test.ts`,
  `apps/daemon/tests/design-toolbox-skill-refs.test.ts`,
  `docs/plans/waves/w10c-toolbox-implementation-review.json`: **do not exist** — the delegated-file
  halves of C10C-2/C10C-3/C10C-4 and all of C10C-7 fail honestly. **C10C-2/C10C-3/C10C-4's own
  verifier-side runtime oracles (§(a) in each) run regardless and are expected to already report
  the underlying claim as true** (the real functions, called directly by the verifier, do resolve
  correctly today) — but each criterion's overall `status` still requires the delegated artifact
  half too, so C10C-2/3/4 still read `fail` overall pre-implementation. This is the concrete answer
  to the coordinator's "reconsider the 5-of-10 baseline" instruction: C10C-2/3/4 are now AND-gated
  (oracle **and** artifact), so neither half alone can carry the criterion, and — unlike the prior
  draft — a criterion that is already fully mechanically true today (C10C-1, C10C-5) is now
  additionally hardened to be *falsifiable* against the specific decoy shapes round 1 demonstrated,
  not merely coincidentally true.
- `docs/plans/waves/DECISIONS.md` has no `### W10C-CAPABILITY-DECISION` heading yet (confirmed by
  direct read) — **C10C-8 reads `blocked-on-founder`**, the legitimate pre-decision state, not
  `fail`.
- `leases.json` has no `"W10c"` entry — LEASE fails honestly.
- `pnpm guard` / `pnpm typecheck`: both green on this tree today.
- `od skills list --json` / `GET /api/skills`: confirmed live in this session to return matching
  168-id multisets from the same isolated daemon — **C10C-5 is expected to already pass**, and its
  decoy argument no longer overclaims order-detection (`[R1-F6]`).

It is therefore expected and correct that this verifier's first run reports a **mixed** scoreboard:
C10C-1, C10C-5, C10C-6, GATE-INTEGRITY, HEAD-DRIFT `pass`; C10C-8 `blocked-on-founder`; C10C-2,
C10C-3, C10C-4, C10C-7, LEASE `fail` — with an overall **non-zero exit**. This is what "clean-red"
means for this wave: an accurate, evidence-backed, non-crashing report of current reality, not a
demand that every single criterion returns false, and — per this round's fix — not a report where
any currently-green criterion is green merely because the check is too weak to fail on a shaped
decoy.

## 9. Open founder questions

Per `VERIFICATION-CONTRACT.md` and this program's operating rules, these are surfaced, not resolved
by this PRD. Q1 is now a **formal, mechanically-tracked gate (C10C-8)**, not a soft bullet a reader
could miss — round 1 ruled this blocking (`[R1-F8]`). Q2 and Q3 were explicitly confirmed
non-blocking by round 1 and are unchanged.

1. **Formalized as C10C-8 above.** Should "apply a design-toolbox action" become a first-class
   `od`/HTTP capability, or is the toolbox correctly understood as a UI-only *recommendation layer*
   over capabilities that already have CLI parity (staging a skill, composing a prompt)? This PRD
   does not build that surface and does not decide the question; C10C-8 requires the decision be
   recorded in `DECISIONS.md` (either `build-now`, which then needs a follow-up PRD amendment, or
   `exempt`) before the wave can read fully `pass`.
2. **Does the exhaustive per-action walk need to also cover `NextStepActions.tsx`?** That component
   shares the exact same `DESIGN_TOOLBOX_ACTIONS`/`findDesignToolboxSkill` data and resolution logic
   as the primary `DesignToolboxPanel`, but renders it through a different UI (2 featured rows +
   14 behind "More → Design toolbox," a cascading hover flyout rather than a single searchable
   panel). §4 scopes this wave's C10C-2 to `DesignToolboxPanel` as "the side panel" the skeleton
   names — round 1 confirmed this scoping is correctly non-blocking ("NM-19 names the singular side
   panel"). Should a future wave (or an amendment to this one, before it lands) add an equivalent
   per-action walk for `NextStepActions`, given it is a second, independently-clickable path to the
   same 16 actions that this wave's criteria do not exercise at all?
3. **Should `scripts/check-toolbox-skill-refs.test.ts` be retired now that C10C-4 supersedes it
   with real registry resolution, or kept as a cheap defense-in-depth floor check?** Round 1
   confirmed this is correctly non-blocking ("retaining the old guard as a cheap floor is an
   implementation-policy choice"). The proposed lease (§6) permits either — it is not itself a
   criterion. Keeping both means two guards with different resolution semantics coexist (one
   directory-based, one registry-based); retiring the old one removes that duplication but loses a
   zero-dependency, sub-5ms check that runs inside `pnpm guard` without booting anything.
