# Wave 10c — Toolbox reliability (NM-19)

**Slug:** `mishmash-w10c-toolbox` · **Branch:** `feat/w10c-toolbox`
**Gates on:** W0 (landed) · **Loop:** `loop:red-green-review` (`VERIFICATION-CONTRACT.md` §6)
**Verifier:** `scripts/waves/verify-w10c.ts`
**Write lease:** `docs/plans/waves/leases.json` → `waves["W10c"]` — see **Proposed lease** below. Not yet
present in `leases.json`; this section is the PRD-text proposal the orchestrator transcribes after
this document freezes, mirroring how `W9-ingest`'s lease entry was added after its PRD landed.

**Status: EXPANSION, PRE-IMPLEMENTATION.** Per `docs/plans/waves/W5-W11-gated.md` "The expansion
gate", this document and `scripts/waves/verify-w10c.ts` are frozen and independently reviewed
*before* any implementation begins. Writing implementation code from this document, or from the
`W5-W11-gated.md` skeleton it expands, is a hard reject. Every fact below marked "verified directly
in this tree" was checked by reading the actual source at the commit this PRD was authored against
(`feat/w10c-toolbox`, freshly cut from `main`), not assumed from the skeleton's prose.

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
  categoryHints, searchTerms }`, and `findDesignToolboxSkill(action, skills)` — the resolution
  function every consumer calls. It is deliberately framework-free ("Keep this module free of
  React and composer-internal state so both surfaces can import the same source of truth" — the
  module's own header comment), so it is importable from plain Node, not only from a browser bundle.
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
  *specific expected* skill.
- **The side panel is `DesignToolboxPanel`**, a component defined locally inside
  `apps/web/src/components/ChatComposer.tsx` (not separately exported). It is instantiated twice —
  once inside `ComposerPlusMenu`'s `renderToolbox` slot, once as a standalone popover
  (`composer-toolbox-standalone`) driven by the composer's imperative handle — both times with
  `actions={DESIGN_TOOLBOX_ACTIONS}` and `skills={skills}` (the live skill list fetched from
  `/api/skills`). Clicking a row calls `onPickAction` → `applyDesignToolboxAction(action)` →
  `findDesignToolboxSkill(action, skills)`, then `applyDesignToolboxPrompt`: if a skill resolved,
  the composer draft is prefixed with an `@<skill.name>` mention token and the skill is staged for
  the turn (`stageSkillForCurrentTurn`); if resolution returned `null`, the draft gets the bare
  prompt text with **no** mention token and **nothing** staged. This resolved/unresolved
  distinction is the observable, DOM-visible signal a red spec can assert on without needing to
  read React internals.
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
  `.badge` / `.description"` **per id, explicitly** (not templated) — 48 keys today, confirmed
  `48 = 16 × 3` by direct extraction. `designToolboxActionTitle()` etc. build the lookup key with
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
  of it. This matters for the UI/CLI-parity criterion (§C10C-5) and for the open founder question
  about the toolbox *catalogue* itself (§Open founder questions, Q1) — the **skill registry data**
  already has CLI parity; the **toolbox action catalogue** (ids, preferred-skill mapping, composed
  prompts) has none today.
- **`apps/daemon/tests/` may not import `apps/web/src/**`, and vice versa** (`AGENTS.md` →
  "Boundary constraints": "App packages must not import another app's private `src/` or `tests/`
  implementation as a shared helper. In particular, `apps/web/**` must not import
  `apps/daemon/src/**`"). The existing repo-root guard's own header comment explains why it
  text-parses `design-toolbox.ts` instead of importing it: a real ES import from `scripts/` pulls
  `apps/web` source into the scripts TypeScript project, whose `moduleResolution: node16` then
  rejects the app's extensionless relative imports. The same constraint applies to a new
  `apps/daemon/tests/*.test.ts` file: it may freely import `apps/daemon/src/skills.ts` (same app,
  legal), but it must **read** `design-toolbox.ts` as text and parse it, not `import` it. `e2e/`
  is a separate top-level package and is explicitly permitted to reach into app internals for
  cross-app consistency checks (`e2e/AGENTS.md`: "E2E tests may validate cross-app/resource
  consistency, but must not treat one app's private implementation as a shared helper for another
  app" — reaching into one app's `src/` from the neutral `e2e/` package is not the forbidden
  app-to-app case), so `e2e/ui/**` and `e2e/tests/**` may `import` `design-toolbox.ts` directly.
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

The defense is not privilege attribution — it is **mechanical, runtime re-derivation** (never trust
a hardcoded action list or a hand-authored skill fixture) plus **paired positive/negative controls**
so a broken harness cannot silently report success by testing nothing.

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

**Explicitly out of scope** (see also §Open founder questions):
- Building a new `od`/HTTP capability for "apply a toolbox action" itself (Q1).
- Extending the exhaustive walk to `NextStepActions.tsx`'s split rendering of the same catalogue (Q2).
- Retiring or rewriting the existing `scripts/check-toolbox-skill-refs.test.ts` guard (Q3) — the
  proposed lease permits either keeping it as a cheap floor or hardening it, but does not mandate
  either.
- Any change to `apps/daemon/src/skills.ts`'s resolution algorithm, `SKILL_ID_ALIASES`, or any
  `skills/*/SKILL.md` frontmatter. This wave tests the existing algorithm; it does not change it.
- NM-27 (gallery/archive taxonomy), NM-21 (memory scope), or any other Wave 10 slice — those are
  separate gated runs per `W5-W11-gated.md`'s Wave 10 table.

## 5. Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3 (red-before-green, no boundary mocks, no
counting criteria, negative controls, no doc-only closures, reviewer-owned severity, human
judgment declared not disguised, benchmark protocol N/A here, mechanical leases). Verified by
`scripts/waves/verify-w10c.ts`.

### C10C-1 — Action inventory is runtime-derived and cross-validated; never hardcoded

**Criterion.** The verifier parses `apps/web/src/runtime/design-toolbox.ts`'s
`DESIGN_TOOLBOX_ACTIONS` array literal using the TypeScript compiler API (never regex/string
scanning of the source), extracting each element's `id` and `preferredSkillIds` as syntactic string
literals. Any `SpreadAssignment` (object spread) or `SpreadElement` (array spread) anywhere inside
the literal — at any depth — is a hard parse failure, not a silently-skipped element. Independently,
the verifier parses `apps/web/src/i18n/types.ts` (same compiler-API approach) for the set of
distinct `<id>` values in `"chat.designToolbox.action.<id>.{title,badge,description}"` property
signatures, requiring all three keys present per id. The two derived id **sets** must be exactly
equal (set equality, not "≥N" or a hardcoded 16) and both non-empty. The derived count is logged as
evidence; the assertion itself never mentions a specific number.

**Satisfiability.** A legitimate implementation keeps `design-toolbox.ts` and `i18n/types.ts` in
sync (any action add/remove ships with its three i18n keys in the same change). This is already
true today (verified: 16 actions, 48 matching keys) — this criterion is expected to already pass
pre-implementation; it exists to make that fact *mechanically checked* going forward rather than
incidentally true.

**Decoy.** A shaped fake that hardcodes `assert(actions.length === 16)` in its own test would pass
today by coincidence but silently stop catching drift the moment a 17th action is added without
its i18n keys, or an action is deleted while its i18n keys are left behind. Because this verifier
re-derives both sets from source and requires exact set equality, either direction of drift fails.
A fake that builds the action array via `[...baseActions, extraAction]` (object/array spread) is
rejected outright by the spread ban, independent of whether its *effective* id set happens to be
correct — spreads defeat the AST literal projection this criterion relies on, so they are banned
categorically rather than trusted to resolve correctly.

---

### C10C-2 — Per-action end-to-end walk from the Design Toolbox side panel, table-driven

**Criterion.** A Playwright UI spec at `e2e/ui/design-toolbox-actions.test.ts` boots a real
tools-dev daemon + web runtime (via the standard `@/playwright/suite` worker-scoped fixture) with
the real `skills/` directory, opens a project's composer, opens the Design Toolbox panel
(`DesignToolboxPanel`, reached via the composer's plus-menu toolbox affordance), and — **iterating
over an imported, non-literal source** (`import { DESIGN_TOOLBOX_ACTIONS } from
'../../apps/web/src/runtime/design-toolbox'`, referenced directly in the loop/`test()`-generation
construct, never copy-pasted into a separate literal array) — for every action:

1. Clicks the row (located by its localized title, itself read from
   `chat.designToolbox.action.<id>.title` at runtime, never a copy-pasted string).
2. Independently computes the expected resolution by calling the real, imported
   `findDesignToolboxSkill(action, liveSkills)` against the same daemon's live `/api/skills`
   response (not a hardcoded per-action expectation table).
3. Asserts the composer draft's observable state matches: if resolution is non-null, the draft
   contains `@<resolved skill name>`; if null, the draft contains no mention token attributable to
   this action.

The verifier **runs this spec for real** (not just checks it exists) and requires: every
runtime-derived action id (§C10C-1's set) has exactly one corresponding test result, all passing;
zero `test.skip`/`.only`/`.fixme` markers anywhere in the file; the passing-test count exactly
equals the C10C-1-derived count (no fewer — a silently-dropped row is a failure; no more — a
duplicated row is also a failure, multiset comparison per `VERIFICATION-CONTRACT.md`'s anti-gaming
rule against Set-based diffing). The verifier also statically confirms (AST) that the file contains
an `ImportDeclaration` naming `DESIGN_TOOLBOX_ACTIONS` (or an identifier containing
`TOOLBOX_ACTIONS`) whose module specifier resolves to the real `design-toolbox.ts` path, and that
this imported binding is referenced by an iteration construct (`for...of`, `.forEach`, `.map`, or
equivalent) — never merely present as an unused import.

**Satisfiability.** A legitimate implementation writes one loop (or `for` block generating one
`test(...)` per action) driven by the real imported catalogue and a real per-run daemon fetch —
exactly the shape `e2e/tests/tools-dev/automations-routines.test.ts` already uses for
`suite.with.toolsDev`. This produces 16 real passing rows today and stays correct as the catalogue
changes, because the row *source* is the same binding the verifier re-derives from.

**Decoy.** An implementer who pastes today's 16 ids into a local literal array — producing 16
green rows right now — is caught the next time an action is added or removed: my verifier's own
independent AST-derivation of `design-toolbox.ts` (§C10C-1) will disagree with the file's declared
loop source (the import-binding check), and the exact-count comparison against the *current*
derived set will fail once the two diverge. A decoy that renders a fake, always-resolving skill
name regardless of the real registry is caught because the verifier's own expected value comes
from calling the real `findDesignToolboxSkill` against the real daemon's live response — not from
trusting the test's self-reported pass — so a test asserting a wrong-but-self-consistent value
still shows a mismatch against the verifier's independently-computed expectation surfaced in the
JSON reporter's per-test output the verifier reads.

---

### C10C-3 — Phantom-ID red spec with a paired positive control

**Criterion.** A Vitest e2e smoke test at `e2e/tests/design-toolbox-phantom-id.test.ts` (using
`createSmokeSuite` + `suite.with.toolsDev`, per `e2e/AGENTS.md`'s "pure inspect by default" default
for non-UI chains) imports the real `findDesignToolboxSkill` from `design-toolbox.ts` and fetches
the real, live `skills` array from the running daemon's `GET /api/skills`. It then asserts, in the
**same test run**:

- **Positive control:** a real action from `DESIGN_TOOLBOX_ACTIONS` (e.g. `auto-match`) resolves to
  a non-null skill via `findDesignToolboxSkill`.
- **Negative (the red spec):** a synthetic action-shaped object whose `preferredSkillIds` is
  `['w10c-red-spec-phantom-skill-id']`, whose `categoryHints` is `[]`, and whose `searchTerms`
  contains only a token guaranteed not to match any real skill (verified against the live registry
  at test time, not assumed) resolves to `null` via the **same** real function against the **same**
  live registry.

Both assertions must be present and passing; a single assertion that happens to satisfy both shapes
does not count (`VERIFICATION-CONTRACT.md` §3 R4's pairing requirement). The verifier statically
confirms the file imports `findDesignToolboxSkill` from the real `design-toolbox.ts` module path
(import-binding check, not a local reimplementation) and runs the file for real via Vitest's JSON
reporter, requiring both named assertions `passed`.

**Satisfiability.** A legitimate implementation calls the real production resolver against real,
live registry data fetched from the daemon this run boots — the same shape
`e2e/tests/tools-dev/automations-routines.test.ts` already uses for real HTTP against a real
daemon. The phantom id and search term are namespaced (`w10c-red-spec-...`) specifically so they
cannot accidentally collide with a real skill added later.

**Decoy.** A stub that hand-returns `null` for a hardcoded string without calling the real
`findDesignToolboxSkill` is caught by the import-binding check (defect class: an unused or
lookalike local function passing checks — `VERIFICATION-CONTRACT.md` binds every check to
production code via import/call binding). A test that only asserts the negative case (no positive
control) is rejected outright — R4 requires both, because an unrelated harness break (e.g. the
fetch to `/api/skills` silently returning `[]`) would make the negative case pass **for the wrong
reason**, and only the positive control catches that.

---

### C10C-4 — Action→skill mapping assertions live in the daemon suite, against the real registry

**Criterion.** A new Vitest suite at `apps/daemon/tests/design-toolbox-skill-refs.test.ts`:

1. Reads `apps/web/src/runtime/design-toolbox.ts` as **text** (`fs.readFileSync`, never an ES
   `import` — the cross-app boundary rule in §2 forbids it) and parses it with the TypeScript
   compiler API (`import ts from 'typescript'`; `ts.createSourceFile`) to extract the same
   `{id, preferredSkillIds}[]` shape as C10C-1 — never a regex/string scan.
2. Imports `listSkills`, `findSkillById`, and `SKILL_ID_ALIASES` directly from
   `apps/daemon/src/skills.ts` (same-app import, legal) and calls `listSkills(realSkillsRoot)`
   against the repository's real `skills/` directory to get the true, live `SkillInfo[]`.
3. For **every** action, for **every** `preferredSkillIds` entry, asserts
   `findSkillById(liveSkills, id) !== undefined` — the real registry resolution (frontmatter
   `name`, alias forwarding), never `fs.existsSync(skills/<id>/SKILL.md)`. This is the exact
   defect the existing repo-root guard has (§2, §3 item 3).
4. Includes its own paired positive/negative case (R4): a real id resolves via `findSkillById`; a
   synthetic phantom id (`w10c-daemon-suite-phantom-skill-id`, namespaced distinctly from C10C-3's
   to keep the two suites' fixtures independently traceable) does not.

The verifier: confirms the file exists at the pinned path; statically confirms it imports
`typescript` and calls a `ts.createSourceFile`/`ts.forEachChild`-shaped extraction (positive
evidence of compiler-API use, per the defect catalog's "use the TypeScript compiler API" rule) and
imports `findSkillById`/`listSkills` from `../src/skills` (import-binding check, defect class 6);
runs the suite for real via the JSON reporter, requiring zero failed / zero
`skip`/`only`/`todo`; independently re-parses `design-toolbox.ts` itself (the same C10C-1
extraction) and cross-checks that the daemon suite's reported per-action test titles cover
**exactly** that independently-derived action set — a daemon suite that only checks a subset (e.g.
10 of 16) is caught here even if all 10 of its own assertions pass; and confirms the paired
positive/negative titles are present and distinct (never one omnibus assertion satisfying both
regex shapes).

**Satisfiability.** A legitimate implementation is a straightforward Vitest file importing real
daemon production code and text-parsing the web source exactly as
`scripts/check-toolbox-skill-refs.test.ts` already demonstrates is possible without a cross-app
import violation — the only change is (a) TS-compiler-API parsing instead of regex, (b)
`findSkillById` instead of `existsSync`, and (c) living in `apps/daemon/tests/` instead of
`scripts/`, per the wave brief's explicit instruction to move this assertion into the daemon suite.

**Decoy.** A test that reimplements a local `listSkills`-lookalike (e.g. its own `existsSync`-based
helper renamed to look like a real check) is caught by the import-binding requirement: the
verifier's static check requires the actual import specifier to resolve to
`apps/daemon/src/skills.ts` (or its compiled sibling), not merely a same-named local function. A
test that regex-scans `design-toolbox.ts` (reproducing the exact defect this criterion exists to
fix) is caught by the positive-evidence compiler-API check failing to find the required
`ts.createSourceFile`/`ts.forEachChild` call shape. A test covering only a hand-picked subset of
actions is caught by the verifier's own independent cross-check against its C10C-1 derivation.

---

### C10C-5 — UI/CLI parity of the skill-registry data source

**Criterion.** The verifier boots an isolated, namespaced, daemon-only tools-dev runtime (`pnpm
tools-dev run daemon --namespace <fresh>`, a temp `OD_DATA_DIR`, no fixed port — the daemon
self-assigns and the verifier discovers the assigned URL via `pnpm tools-dev status daemon
--namespace <fresh> --json`; never ports 7456/51012), fetches `GET /api/skills` directly over HTTP
(`redirect: 'manual'`, URL validated against the discovered loopback origin before the request,
fail-closed on any mismatch), separately invokes the real `od skills list --json` CLI
(`node --import tsx apps/daemon/src/cli.ts skills list --json --daemon-url <discovered-url>` —
explicit `--daemon-url` on every invocation so the CLI can never fall back to IPC/tools-dev
discovery and reach a *different*, possibly-default-namespace daemon), and asserts the two
responses' skill `id` **multisets** (occurrence-counted, never `Set`-deduplicated — duplicates or
reordering must be visible) are identical. Tears the daemon down by the exact PID
`tools-dev status --json` reported, in a `finally` block, regardless of assertion outcome.

**Satisfiability.** `od skills list` (`apps/daemon/src/cli.ts:runSkills` →
`runLibraryList('skills', ...)`) already `fetch()`es `${base}/api/skills` directly — it is a thin
HTTP client of the exact route the web UI calls, both backed by the single `listAllSkills()` /
`listSkills()` implementation (§2, ground fact). This criterion is expected to already pass
pre-implementation; it exists to lock the parity down as a mechanical regression guard, the same
class of "already true, now checked" criterion `verify-w9-ingest.ts`'s C9-2 represents for its own
wave.

**Decoy.** A CLI-side reformatting, filtering, or caching layer added later (e.g. a legacy
compatibility remap that silently drops or renames an id before printing) is caught by the exact
multiset diff — occurrence-count comparison means a silently-dropped duplicate or a reordering
cannot pass as "the same set." A verifier that used `Set` equality instead would miss a case where
the CLI returns the right *distinct* ids but the wrong *count* of one (e.g. deduping a legitimate
duplicate the HTTP path preserves) — this criterion uses the occurrence-counted comparison
specifically to avoid that class of false pass.

---

### C10C-6 — Standard gates green

**Criterion.** `pnpm guard` and `pnpm typecheck` both exit 0 on the current tree.

**Satisfiability.** Both are already green on this tree (verified: guard 102/102, typecheck clean
across every workspace project) and stay green through test-only additions that follow the repo's
existing TypeScript-first, boundary-respecting conventions documented in §2.

**Decoy.** N/A in the R4 sense (this is not a rejection criterion) — but note per
`VERIFICATION-CONTRACT.md` §3 R3, this is not a "counting" criterion: it does not accept a partial
guard run or a filtered subset; it is the same two whole-repo commands every other wave's
equivalent criterion (`CC-9`, `C9-9`) runs.

---

### C10C-7 — Adversarial review of the implementation is on record, non-spoofable

**Criterion.** `docs/plans/waves/w10c-toolbox-implementation-review.json` exists and parses as
`{reviewer: string, model: string, reviewedCommit: string, verdict: string}`. The verifier checks:
`reviewedCommit` resolves to a real commit and is a **strict ancestor** of `HEAD` (never `HEAD`
itself — the same "cannot contain its own SHA" reasoning `W9-ingest-tranche.md` §S9-6 documents);
`git diff --name-only reviewedCommit HEAD` over this wave's owned implementation/evidence paths
(the four pinned test files below + `apps/web/src/runtime/design-toolbox.ts` if touched) is
**empty** (the review covers the final state, not a stale mid-review snapshot); `reviewer` is
distinct from every commit author across `baseCommit..reviewedCommit` (case-insensitive
name/email match); `verdict === "APPROVE"`.

**Satisfiability.** Commit the complete implementation as some real commit P; a distinct reviewer
reviews P; the review record naming P is committed afterward (even as `HEAD` itself, adding only
that one file) — P's SHA is already stable by construction, so there is no chicken-and-egg problem.

**Decoy.** A review record naming `HEAD` itself is rejected by the strict-ancestor check (it would
let the record spoof reviewing a state that includes its own addition). A review record whose
`reviewedCommit` predates a later fix to one of the owned files is rejected by the empty-diff
check — a review is not evidence for code written after it. A same-author "review" is rejected by
the author-distinctness check across the full `baseCommit..reviewedCommit` range, not merely
`HEAD`'s own tip author, closing the trivial dodge of committing the review from a different-named
later commit while the underlying work still traces to the same person.

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
  "note": "Toolbox reliability (NM-19). No apps/daemon/src/** production code expected — the
    daemon suite addition binds to existing listSkills()/findSkillById()/SKILL_ID_ALIASES without
    modifying them. i18n files are granted narrowly in case C10C-1's cross-check surfaces a real
    id/key mismatch that needs fixing; design-toolbox.ts is granted for the same amend-on-proof
    reason. HOUSE RULE: this wave's own PRD and verifier are in deny — gate integrity is bound by
    the orchestrator-held approved copy + approved-gate.sha256 (GATE-INTEGRITY criterion), not by
    trusting the implementing branch not to edit its own gate."
}
```

Nothing in `apps/daemon/src/**`, `apps/web/src/components/**` (other than the two narrow grants
above), or any other wave's files is leased. If implementation proves a wider grant necessary (the
"amend-on-proof" pattern `W9-ingest-tranche.md` and `leases.json`'s `W1`/`W4` amendments both use),
that is a lease amendment recorded against `main`, not a unilateral implementation-branch edit.

## 7. Definition of "green"

`manifest.criteria[].id` must equal exactly `{C10C-1, C10C-2, C10C-3, C10C-4, C10C-5, C10C-6,
C10C-7, GATE-INTEGRITY, LEASE, HEAD-DRIFT}` — 10 ids, no fewer, no more, no duplicates — each
`status === "pass"`, `manifest.treeDirty === false`, `manifest.commit` matching the verified `HEAD`,
every artifact hash-matched. No criterion here is `human:`-marked (`VERIFICATION-CONTRACT.md` §3
R7); none should legitimately resolve `blocked-on-founder`. Nothing in the current wave program
gates on this wave's manifest (`W5-W11-gated.md`'s Wave 10 table lists no downstream dependent for
`w10c-toolbox`), so there is no external "definition of green" consumer analogous to W9-ingest's
relationship with W3 — this section exists for internal completeness only.

## 8. Verified baseline (this run, pre-implementation)

- `DESIGN_TOOLBOX_ACTIONS`: 16 entries, 31 unique `preferredSkillIds` values, **zero phantoms today**
  by either the old directory-existence method or the real frontmatter-based registry resolution.
- i18n: 48 `chat.designToolbox.action.*` keys declared in `types.ts`, all 48 non-empty in `en.ts`,
  exactly matching the 16 action ids × 3 keys.
- `scripts/check-toolbox-skill-refs.test.ts`: exists, passes, wired into `pnpm guard` (confirmed in
  the 102/102 green run) — but checks directory existence, not real registry resolution (§2, §3).
- `apps/web/tests/components/ChatComposer.design-toolbox.test.tsx`: exists, exercises 2 of 16
  actions against hand-authored fixture skills, not the live registry.
- `e2e/ui/design-toolbox-actions.test.ts`, `e2e/tests/design-toolbox-phantom-id.test.ts`,
  `apps/daemon/tests/design-toolbox-skill-refs.test.ts`,
  `docs/plans/waves/w10c-toolbox-implementation-review.json`: **do not exist** — C10C-2, C10C-3,
  C10C-4, C10C-7 fail honestly.
- `leases.json` has no `"W10c"` entry — LEASE fails honestly.
- `pnpm guard` / `pnpm typecheck`: both green on this tree today.
- `od skills list --json` / `GET /api/skills`: structurally the same code path (verified by
  reading `runLibraryList`), so C10C-5 is expected to already be mechanically satisfiable once the
  verifier runs the live check, matching the "already true, now checked" pattern noted in C10C-5's
  own satisfiability argument.

It is therefore expected and correct that this verifier's first run reports a **mixed** scoreboard
(some criteria already green because the underlying production behavior already holds, most red
because the test artifacts do not exist yet) with an overall **non-zero exit** — this is what
"clean-red" means for this wave, not a demand that every single criterion returns false.

## 9. Open founder questions

Per `VERIFICATION-CONTRACT.md` and this program's operating rules, these are surfaced, not resolved:

1. **Should "apply a design-toolbox action" become a first-class `od`/HTTP capability?**
   `AGENTS.md` → "Capability exposure (UI/CLI dual-track)" reads as mandatory: "Every user-facing
   capability must be reachable through both the web UI and the `od` CLI... If a capability is
   UI-only, it cannot be composed into those external agents." Today, picking a toolbox action and
   getting its resolved skill + composed follow-up prompt is 100% web-UI-only — there is no HTTP
   endpoint or `od` subcommand for it at all (only the underlying skill *listing* has CLI parity,
   §C10C-5). Is the toolbox correctly understood as a UI-only *recommendation layer* over
   capabilities that already have CLI parity (staging a skill, composing a prompt), and therefore
   exempt — or does AGENTS.md's rule require a new `od toolbox apply <action-id> [--project <id>]
   --json` surface (and a matching `/api/*` endpoint) before this wave can be considered to fully
   close NM-19's "toolbox reliability" framing? This wave's proposed criteria do **not** build that
   surface; C10C-5 only locks down the parity that already exists.
2. **Does the exhaustive per-action walk need to also cover `NextStepActions.tsx`?** That component
   shares the exact same `DESIGN_TOOLBOX_ACTIONS`/`findDesignToolboxSkill` data and resolution logic
   as the primary `DesignToolboxPanel`, but renders it through a different UI (2 featured rows +
   14 behind "More → Design toolbox," a cascading hover flyout rather than a single searchable
   panel). §4 scopes this wave's C10C-2 to `DesignToolboxPanel` as "the side panel" the skeleton
   names. Should a future wave (or an amendment to this one, before it lands) add an equivalent
   per-action walk for `NextStepActions`, given it is a second, independently-clickable path to the
   same 16 actions that this wave's criteria do not exercise at all?
3. **Should `scripts/check-toolbox-skill-refs.test.ts` be retired now that C10C-4 supersedes it
   with real registry resolution, or kept as a cheap defense-in-depth floor check?** The proposed
   lease (§6) permits either — it is not itself a criterion. Keeping both means two guards with
   different resolution semantics coexist (one directory-based, one registry-based); retiring the
   old one removes that duplication but loses a zero-dependency, sub-5ms check that runs inside
   `pnpm guard` without booting anything.
