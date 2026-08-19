FINDING: F001

## 1. Factual accuracy

- **Catalog count is stale.** Claimed: **353 templates**. Actual: **352 template directories/SKILL.md files**; F007 also records 352 (`docs/plans/2026-08-18-demo-findings/F007-filter-standardization-and-section-facets.md:201`). All success criteria using 353 are wrong.
- **`template.json` is not per-template metadata.** Claimed: every template has `template.json + SKILL.md`. Actual: **352 `SKILL.md`, only 281 `template.json`**. The repository requires `SKILL.md` plus rendering files; `template.json` is specifically documented for vendored entries (`design-templates/AGENTS.md:28-35`, `design-templates/AGENTS.md:39-44`).
- **Preview inventory is overstated.** R1 requires every index row to point to `example.html` and a thumbnail, but only **344/352** templates have root `example.html`, and there are **zero root thumbnail files**. The current preview route has a six-step fallback chain and can still return 404 (`apps/daemon/src/routes/static-resource.ts:522-533`, `apps/daemon/src/routes/static-resource.ts:642-646`).
- **The sample’s palette/type description is false.** Claimed: color exists only as a hex embedded in frontmatter description and typography has no roles. Actual: Almond Hours has a dedicated, role-labelled exact palette and explicit display/body/nav typography assignments (`design-templates/almond-hours-h65/SKILL.md:76-94`). It is unstructured Markdown, but it is not confined to the description and does contain roles.
- **The literal poetry query does not return “nothing.”** Executing the current matcher over the live catalog returns `helix-strata-h76` from the generic word `business`; that template explicitly carries the trigger at `design-templates/helix-strata-h76/SKILL.md:3-14`. The matcher surfaces one trigger at score 3 (`packages/contracts/src/api/catalogue-match.ts:143-194`).
- **The current-state inventory omits the capability this PRD should extend.** MishMash already has shared contracts, `POST /api/catalogue/match`, the home-composer UI, and `od catalogue match --prompt|--prompt-file --json` (`packages/contracts/src/api/catalogue-match.ts:21-50`, `apps/daemon/src/routes/catalogue-match.ts:82-110`, `apps/web/src/components/CatalogueMatchSuggestions.tsx:37-112`, `apps/daemon/src/cli.ts:1897-1982`). Clicking an existing suggestion already assigns the selected template without replacing the brief (`apps/web/src/components/HomeView.tsx:1565-1579`).
- **The cited NL→IR “pattern” does not exist as described.** `evals/selector/nl-to-ir/` contains only `goldens.json` and `parser.ts`; there is no scorer, floors file, or eval manifest. The parser explicitly says it is an unimplemented stub and always throws (`evals/selector/nl-to-ir/parser.ts:1-18`, `evals/selector/nl-to-ir/parser.ts:77-86`).
- **`apps/daemon/src/tools/connectors.ts` is not a generic daemon-tool registry.** It only lists and executes connected connector tools (`apps/daemon/src/tools/connectors.ts:64-137`). “Add `design.advise_templates` alongside it” does not identify a real registration/execution path, especially for BYOK versus CLI-agent runtimes.
- **The Refero rights claim is inapplicable.** The existing rights model verifies local catalog-relative directories against local `.catalog/rights.json`, `RIGHTS.md`, realpaths, and tree hashes (`apps/daemon/src/design-library/rights.ts:136-185`, `apps/daemon/src/design-library/rights.ts:217-256`). It cannot directly authorize transient remote Refero results.
- **Calling the bearer token “public” is unsafe and contradicts the repository.** MishMash treats bearer tokens as posting credentials requiring owner-only storage (`apps/daemon/src/mcp-tokens.ts:176-199`). The current MCP contract supports persisted headers or daemon-managed OAuth, not automatic ZS-Vault environment-variable indirection (`packages/contracts/src/api/mcp.ts:15-45`, `apps/daemon/src/mcp-config.ts:368-402`).

## 2. Repo-rule compliance

As written, this would be unmergeable:

1. R6 defines neither an HTTP endpoint nor a shared API DTO, despite the mandatory HTTP/contracts boundary (`AGENTS.md:169-174`).
2. No `od` advisor command is specified, registered in `SUBCOMMAND_MAP`, or required to support `--json` and `--prompt-file`; the existing `catalogue` command should be evolved or an explicit replacement designed (`AGENTS.md:171-176`, `apps/daemon/src/cli.ts:900-945`).
3. R8/R8a creates a new project-start capability without specifying its shared request/response contract, HTTP endpoint, or CLI mirror. Current creation accepts one `skillId`, while project metadata has one `templateId` (`packages/contracts/src/api/projects.ts:307-332`, `packages/contracts/src/api/projects.ts:99-128`).
4. The proposed Playwright file/command violates test ownership. `specs/*.spec.ts` is Vitest business-chain territory; Playwright files must be flat `e2e/ui/*.test.ts` (`e2e/AGENTS.md:7-18`, `e2e/AGENTS.md:159-166`). Playwright’s config only searches `./ui`, so the listed `specs/template-advisor.spec.ts` command will not prove the feature (`e2e/playwright.config.ts:30-41`).

## 3. Executability unattended

- Success criterion 4 explicitly requires a human to judge the top six. That cannot complete tonight unattended.
- Result count, Refero weighting, and external-platform recommendation behavior remain open decisions; the latter explicitly says “Devin’s call.”
- R3 leaves eight archetypes unspecified. The cited design authority defines precedence and retained/disclaimed tooling, not small-business archetype content (`AGENTS.md:390-428`, `docs/design-authority.json:4-44`).
- R4 gives no extraction implementation, provider/runtime, scorer, floors, or accuracy threshold; its claimed precedent is an unimplemented stub.
- Confidence grading is undefined. Under the stated P0 sources, a repository scan found only **190/352** SKILL files with three distinct six-digit hexes, **84** `template.json` files with at least two CDN fonts, and **45** SKILL files with both display/body role language. The ≥85% medium/high criterion cannot be reached honestly without expanding extraction beyond R1 or pulling P2 work forward.
- GenUI persistence requires a `pluginSnapshotId` for every requested surface (`apps/daemon/src/genui/store.ts:42-51`, `apps/daemon/src/genui/store.ts:113-136`). The advisor is not defined as a plugin, and the PRD never decides whether to generalize GenUI or create a plugin snapshot.
- Addendum B makes F001 dependent on F007: every ranked facet must simultaneously become a filter facet. No PR ordering or atomic delivery boundary is defined.
- “Generated at build time” has no owner or build integration. The repo forbids a root aggregate build, while verification only runs the generator manually (`AGENTS.md:134-138`).

## 4. Missing work

- Define a backward-compatible persisted selection schema covering directions, per-section provenance, chosen slugs, and existing single `skillId`/`templateId` projects.
- Reconcile this work with the existing `/api/catalogue/match` capability instead of silently introducing a parallel recommender.
- Define thumbnail generation/fallbacks for all eight templates without root `example.html`.
- Add keyboard navigation, focus management, labelled groups, selection announcements, validation/error states, and accessible whole-direction versus per-section semantics.
- Update existing matcher contract, daemon-route, home-suggestion, GenUI-renderer, prompt-composition, project/CLI, and capability-manifest tests (`packages/contracts/tests/catalogue-match.test.ts:62-194`, `apps/daemon/tests/routes/catalogue-match.test.ts:65-117`, `apps/web/tests/components/CatalogueMatchSuggestions.test.tsx:41-115`, `apps/web/tests/components/GenUISurfaceRenderer.test.tsx:19-62`, `scripts/waves/capability-manifest.json:190-209`).
- Specify Refero authentication, mock-server testing, remote-result provenance, licensing classification, cache/expiry behavior, and the conversion—if any—from remote reference to local rights-ledger entry.

## 5. Risk of silent damage

- R2 checks membership/vocabulary/hex validity but not source hashes or exact regeneration, so a stale index can remain valid while templates change.
- Changing `CatalogueMatch.score` from explicitly unbounded to 0–1 is an API-semantic break not covered by a migration/versioning plan (`packages/contracts/src/api/catalogue-match.ts:30-39`).
- The existing home matcher could continue issuing and applying lexical suggestions beside the new advisor, producing duplicate or contradictory recommendations.
- A partial confirm flow could create a project but fail to persist section provenance, or persist the GenUI response without creating the project; no transactional/idempotency requirement covers retries.
- Refero failures are required to degrade silently, making a broken integration indistinguishable from “no useful references” and leaving no operational proof.
- Shared taxonomy changes can silently alter F007 filters and current catalog ordering without any listed cross-consumer regression test.

The following must be decided first: whether this extends `/api/catalogue/match` or creates a replacement; the complete HTTP/contracts/UI/CLI boundary; the persisted multi-selection model; the eight archetypes and extraction/confidence rules; F007 delivery ordering; Refero authentication/rights semantics; and a fully automated acceptance oracle replacing the human gate.

VERDICT: NOT-READY

