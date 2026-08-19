Finding F007

## 1. Factual accuracy

1. The screenshot path is not literal: F007 names `...6.59.51 PM.png`, but the real filename contains U+202F before `PM`: `...6.59.51 PM.png`; the documented path fails as written. [F007:23](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F007-filter-standardization-and-section-facets.md:23)

2. F007’s **352-template** count matches the current validator, but the shared F001 contract still requires **353**. The repository scan counts directories containing `SKILL.md` and currently reports 352; F001’s inventory and success criterion are stale. [validator:224](/Users/zero-suminc./projects/mishmash/scripts/validate-design-catalog.ts:224), [F001:38](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F001-conversational-template-advisor.md:38), [F001:211](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F001-conversational-template-advisor.md:211)

3. “323 of 352 SKILL.md files mention sections” is wrong: case-insensitive word matching returns **324**. More importantly, mentioning “section” does not identify which controlled section types exist. [F007:103](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F007-filter-standardization-and-section-facets.md:103)

4. The claimed slug counts use unsafe substring matching:

   - Claimed `nav = 1`; exact slug-token matches are **0**. The substring hit is `lexington-navy`, which is a site named Navy, not a nav template. [lexington-navy:2](/Users/zero-suminc./projects/mishmash/design-templates/lexington-navy/SKILL.md:2)
   - Claimed `form = 6`; exact slug-token matches are **1**. The six substring hits include unrelated `peoples-platform`, `performance-run-fitness`, `transform-data-hero`, and `video-shortform`. [peoples-platform:3](/Users/zero-suminc./projects/mishmash/design-templates/html-ppt-zhangzara-peoples-platform/SKILL.md:3), [performance-run-fitness:3](/Users/zero-suminc./projects/mishmash/design-templates/performance-run-fitness/SKILL.md:3), [video-shortform:3](/Users/zero-suminc./projects/mishmash/design-templates/video-shortform/SKILL.md:3)
   - Therefore R8’s assertion that slug matches are “highest confidence” is false unless token boundaries and false-positive tests are specified. [F007:135](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F007-filter-standardization-and-section-facets.md:135)

5. The evidence counts **12 grid templates**, but `grid` is absent from the proposed section vocabulary. The evidence and executable taxonomy contradict each other. [F007:96](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F007-filter-standardization-and-section-facets.md:96), [F007:132](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F007-filter-standardization-and-section-facets.md:132)

6. `design-systems/` has **151 catalogue entries with `DESIGN.md`**, not 152. The extra directory is `_schema`, which the runtime skips because it has no `DESIGN.md`. [F007:229](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F007-filter-standardization-and-section-facets.md:229), [design-system loader:269](/Users/zero-suminc./projects/mishmash/apps/daemon/src/design-systems/index.ts:269)

7. The shared schema is inconsistent:

   - F007 specifies `sections[]`; F001’s authoritative addendum says `section` singular. [F007:132](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F007-filter-standardization-and-section-facets.md:132), [F001:386](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F001-conversational-template-advisor.md:386)
   - F007 derives theme from `palette.background`, but F001 defines `palette[]` entries with roles; `background` is a role value, not a property. [F007:235](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F007-filter-standardization-and-section-facets.md:235), [F001:133](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F001-conversational-template-advisor.md:133), [F001:287](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F001-conversational-template-advisor.md:287)
   - F001 names the field `motion_level`; F007 does not pin whether the shared field is `motion` or `motion_level`. [F001:142](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F001-conversational-template-advisor.md:142)

8. The a11y panel does not “score exactly” R5. Its fixed dimensions are contrast, focus, headings, and alt text; its role description also mentions focus order and target sizes, but not the complete dropdown keyboard/label contract claimed by F007. [F007:126](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F007-filter-standardization-and-section-facets.md:126), [panel.ts:117](/Users/zero-suminc./projects/mishmash/apps/daemon/src/prompts/panel.ts:117), [panel.ts:166](/Users/zero-suminc./projects/mishmash/apps/daemon/src/prompts/panel.ts:166)

9. “All 14 surfaces” is not app-wide. Definite omitted filter surfaces include `MessageCenter`, `PluginsView`, `TasksView`, `MarketplaceView`, `LibrarySection`, `TypefacesSection`, `ConnectorsBrowser`, `LibraryPicker`, and `TabLauncherMenu`. [MessageCenter:21](/Users/zero-suminc./projects/mishmash/apps/web/src/components/MessageCenter.tsx:21), [PluginsView:929](/Users/zero-suminc./projects/mishmash/apps/web/src/components/PluginsView.tsx:929), [TasksView:921](/Users/zero-suminc./projects/mishmash/apps/web/src/components/TasksView.tsx:921), [MarketplaceView:31](/Users/zero-suminc./projects/mishmash/apps/web/src/components/MarketplaceView.tsx:31), [LibrarySection:949](/Users/zero-suminc./projects/mishmash/apps/web/src/components/LibrarySection.tsx:949), [TypefacesSection:115](/Users/zero-suminc./projects/mishmash/apps/web/src/components/TypefacesSection.tsx:115), [ConnectorsBrowser:849](/Users/zero-suminc./projects/mishmash/apps/web/src/components/ConnectorsBrowser.tsx:849), [LibraryPicker:177](/Users/zero-suminc./projects/mishmash/apps/web/src/components/LibraryPicker.tsx:177), [TabLauncherMenu:226](/Users/zero-suminc./projects/mishmash/apps/web/src/components/workspace/TabLauncherMenu.tsx:226)

## 2. Repo-rule compliance

1. The section/facet capability is UI-only as planned. It needs a shared contract, `/api/design-templates` facet exposure/query behavior, the web surface, and filtering through the registered `od design-templates` CLI with `--json`, all in this PR. The current contract exposes only `category` and `scenario`; the endpoint returns that shape, and the CLI only lists/shows/previews without facet flags. [AGENTS.md:167](/Users/zero-suminc./projects/mishmash/AGENTS.md:167), [registry.ts:158](/Users/zero-suminc./projects/mishmash/packages/contracts/src/api/registry.ts:158), [static-resource.ts:257](/Users/zero-suminc./projects/mishmash/apps/daemon/src/routes/static-resource.ts:257), [cli.ts:900](/Users/zero-suminc./projects/mishmash/apps/daemon/src/cli.ts:900), [cli.ts:9046](/Users/zero-suminc./projects/mishmash/apps/daemon/src/cli.ts:9046)

2. R1 puts a new shared React primitive in app-global `primitives.css`; repository guidance says a missing shared primitive belongs in `packages/components` with colocated CSS Modules. [F007:117](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F007-filter-standardization-and-section-facets.md:117), [AGENTS.md:262](/Users/zero-suminc./projects/mishmash/AGENTS.md:262), [AGENTS.md:271](/Users/zero-suminc./projects/mishmash/AGENTS.md:271), [packages/AGENTS.md:9](/Users/zero-suminc./projects/mishmash/packages/AGENTS.md:9)

3. The Playwright verification path is unmergeable. `e2e/specs/` is the Vitest business-spec lane; Playwright files belong flat under `e2e/ui/`, and the Playwright config sets `testDir: './ui'`. `specs/filters.spec.ts` therefore would not run under the listed command. [F007:167](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F007-filter-standardization-and-section-facets.md:167), [e2e/AGENTS.md:7](/Users/zero-suminc./projects/mishmash/e2e/AGENTS.md:7), [e2e/AGENTS.md:159](/Users/zero-suminc./projects/mishmash/e2e/AGENTS.md:159), [playwright.config.ts:30](/Users/zero-suminc./projects/mishmash/e2e/playwright.config.ts:30)

## 3. Executability unattended

1. F007 depends on F001 artifacts that do not exist: no `design-templates/index.json` and no `scripts/build-design-index.ts` are present. The document must either make landed F001 R1/R2 a hard prerequisite or absorb their complete implementation and verification.

2. The taxonomy is not executable: Style is an ellipsis plus “roughly 25–30”; Mood is an ellipsis; Scenario has no canonical replacement map; Density and Motion say only “measured”; Theme lacks luminance thresholds and precedence among overlapping `light`, `warm-paper`, and `high-contrast`. [F007:218](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F007-filter-standardization-and-section-facets.md:218)

3. R15 does not define a DTO, endpoint, state-transfer format, or acceptance scenario for either advisor-to-filter or filter-to-advisor conversion. [F007:248](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F007-filter-standardization-and-section-facets.md:248)

4. “Measurably lower than 94” is not a meaningful gate: 93 passes, and the command ignores colocated CSS Modules outside `apps/web/src/styles`, so moving styles can pass without consolidating anything. [F007:151](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F007-filter-standardization-and-section-facets.md:151), [AGENTS.md:266](/Users/zero-suminc./projects/mishmash/AGENTS.md:266)

5. “Nearby” empty-state suggestions have no distance function or falsifiable oracle; “non-trivial set” has no minimum; taxonomy enumeration only proves values are accepted, not that advisor rankings are correct. [F007:144](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F007-filter-standardization-and-section-facets.md:144), [F007:258](/Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F007-filter-standardization-and-section-facets.md:258)

6. The checkout itself is unsafe for unattended execution: `main@a38cee7` is ahead 2/behind 1 relative to `origin/main`, with a modified `apps/web/next-env.d.ts` and the findings directory untracked. The execution baseline/worktree must be resolved before coding.

## 4. Missing work

- The static index covers repo templates only, while the live endpoint merges runtime-owned user templates before built-ins; derived example cards are also synthesized at runtime. The plan does not define indexing, fallback, or facet inheritance for either group. [server.ts:936](/Users/zero-suminc./projects/mishmash/apps/daemon/src/server.ts:936), [skills.ts:215](/Users/zero-suminc./projects/mishmash/apps/daemon/src/skills.ts:215), [skills.ts:257](/Users/zero-suminc./projects/mishmash/apps/daemon/src/skills.ts:257)

- Index lifecycle is unspecified: committed versus generated, deterministic ordering, atomic write, stale-index detection, daemon loading, contract serialization, and guard wiring.

- R16 does not decide whether to rewrite existing `SKILL.md` data or normalize only in the index. Renaming `live` would break the existing Live filter, which explicitly checks `skill.scenario === 'live'`. [ExamplesTab.tsx:99](/Users/zero-suminc./projects/mishmash/apps/web/src/components/ExamplesTab.tsx:99)

- Eight templates lack top-level `example.html`, and 89 of the 344 that have one contain no `<section>` element; no fallback or confidence rule covers them.

- Accessibility needs an explicit native-select or ARIA combobox/listbox contract: arrow/Home/End/Escape behavior, focus restoration, multi-select announcements, removable-chip labels, result-count status, and clear-all focus behavior.

- Existing tests encode pill-specific selectors and zero-count hiding semantics and will need deliberate migration. R14’s “every taxonomy value surfaces” directly conflicts with the current test requiring empty categories to remain absent. [TemplatesSection.test.tsx:187](/Users/zero-suminc./projects/mishmash/apps/web/tests/components/TemplatesSection.test.tsx:187), [TemplatesSection.test.tsx:206](/Users/zero-suminc./projects/mishmash/apps/web/tests/components/TemplatesSection.test.tsx:206), [DesignSystemsTab.test.tsx:367](/Users/zero-suminc./projects/mishmash/apps/web/tests/components/DesignSystemsTab.test.tsx:367), [filter-pill.test.ts:63](/Users/zero-suminc./projects/mishmash/apps/web/tests/styles/filter-pill.test.ts:63), [plugins-home-section.test.tsx:243](/Users/zero-suminc./projects/mishmash/apps/web/tests/components/plugins-home-section.test.tsx:243)

- The verification list omits package-scoped web, daemon, contracts, and component tests/builds required for the touched surfaces. [AGENTS.md:291](/Users/zero-suminc./projects/mishmash/AGENTS.md:291)

## 5. Risk of silent damage

- Removing global `.filter-pill` or `.subtab-pill` CSS during a partial migration can restyle still-unmigrated Examples, Memory, Designs, Routines, Settings, and Pet controls. [composio.css:2895](/Users/zero-suminc./projects/mishmash/apps/web/src/styles/viewer/composio.css:2895), [drawer.css:390](/Users/zero-suminc./projects/mishmash/apps/web/src/styles/workspace/drawer.css:390)

- A generic stateful filter component can silently destroy surface-specific behavior: interdependent count scoping in `ExamplesTab`, invalid-selection fallback in `TemplatesSection`, and stale-request/pagination protection in `LibrarySection`. [ExamplesTab.tsx:301](/Users/zero-suminc./projects/mishmash/apps/web/src/components/ExamplesTab.tsx:301), [TemplatesSection.tsx:374](/Users/zero-suminc./projects/mishmash/apps/web/src/components/TemplatesSection.tsx:374), [LibrarySection.tsx:215](/Users/zero-suminc./projects/mishmash/apps/web/src/components/LibrarySection.tsx:215)

- Parsing runtime user-template HTML without a specified non-executing, bounded parser risks script execution, network access, or memory exhaustion.

- A stale static index can silently hide newly added, user-installed, or derived templates from facets while the unfiltered catalogue continues to display them.

Before execution, decide the canonical shared schema and complete vocabularies/thresholds; establish whether F001 is a landed prerequisite; define built-in/user/derived index behavior; enumerate the actual filter scope; and add the required contract/API/CLI/test closure.

VERDICT: NOT-READY

