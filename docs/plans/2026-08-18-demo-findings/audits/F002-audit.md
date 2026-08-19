FINDING: F002

Audited local `main` at `a38cee700edc`. It is two commits ahead and one behind `origin/main`; the entire findings directory is untracked, so a clean worktree will not contain F002, F001, or the supporting asset.

## 1. Factual accuracy

- **Live validation is unverifiable.** “Validated on live users” and the 20/30-minute runs exist only as assertions inside F002; the repository contains no independent run record or evidence artifact ([F002:8](</Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F002-client-discovery-interview.md:8>), [F002:27](</Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F002-client-discovery-interview.md:27>)).

- **“Off by 2–3×” is unsupported.** Claimed: 2–3×. Real values: the stated 10–15-minute band versus the observed 20–30-minute band is 2× at corresponding endpoints; arbitrary cross-pairings range from 1.33× to 3× ([asset:8](</Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/assets/F002-questionnaire-v1-full.txt:8>), [F002:85](</Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F002-client-discovery-interview.md:85>)).

- **“The current questionnaire is the 25–30 min tier” is not established.** One of the document’s own two observations is 20 minutes; only the two-run median is 25, and the document later requires at least three runs per tier ([F002:27](</Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F002-client-discovery-interview.md:27>), [F002:183](</Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F002-client-discovery-interview.md:183>)).

- **The question-form parsers are not actually synchronized.** Claimed: one deliberately mirrored contract. Real: the daemon accepts only an object containing `questions[]`, while the web parser also accepts a top-level array ([question-form-detect.ts:16](</Users/zero-suminc./projects/mishmash/apps/daemon/src/question-form-detect.ts:16>), [question-form.ts:302](</Users/zero-suminc./projects/mishmash/apps/web/src/artifacts/question-form.ts:302>)). The existing array-payload regression test proves the web-only behavior ([question-form.test.ts:222](</Users/zero-suminc./projects/mishmash/apps/web/tests/artifacts/question-form.test.ts:222>)).

- **The sharing inventory is materially incomplete and partly misclassified.** `open-design-public-metadata.ts` exposes GitHub release/repository and Discord metadata, not sharing ([open-design-public-metadata.ts:24](</Users/zero-suminc./projects/mishmash/apps/daemon/src/routes/open-design-public-metadata.ts:24>)). The repo already has deployed-artifact public links and a Share-menu UI flow ([cloudflare-pages-helpers.ts:79](</Users/zero-suminc./projects/mishmash/apps/daemon/src/deploy/cloudflare-pages-helpers.ts:79>), [project-management-flows.test.ts:2101](</Users/zero-suminc./projects/mishmash/e2e/ui/project-management-flows.test.ts:2101>)). There is still no interview-return channel, but “Sharing lives in these two files” is false.

- **“No answers→project path” is false literally.** `CreateProjectRequest` already accepts a structured `GuidedCreateBrief`; the daemon validates and folds it into `pendingPrompt`, and `od project create` exposes matching flags ([projects.ts:307](</Users/zero-suminc./projects/mishmash/packages/contracts/src/api/projects.ts:307>), [project/index.ts:1727](</Users/zero-suminc./projects/mishmash/apps/daemon/src/routes/project/index.ts:1727>), [cli.ts:6922](</Users/zero-suminc./projects/mishmash/apps/daemon/src/cli.ts:6922>)). The missing claim should be limited to this questionnaire’s schema and mapping.

- **F001 dependencies are prospective, not current.** `apps/daemon/src/design/site-archetypes.ts` does not exist; F001 merely proposes it ([F001:149](</Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F001-conversational-template-advisor.md:149>)). F001 R3 does not define identifier vocabulary, and F001 R4 expects `{ archetype, category, audience, tone[], must_have[], constraints }`, not a `ClientBrief` or the three F002 headers claimed to be “exactly its inputs” ([F001:155](</Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F001-conversational-template-advisor.md:155>), [F002:143](</Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F002-client-discovery-interview.md:143>)). The risk-table claim that “F001 R4 consumes” a shared `ClientBrief` is false ([F002:177](</Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F002-client-discovery-interview.md:177>)).

- **R3 overstates the source’s verbatim rule.** Claimed: every field carries the client’s verbatim words “per the summary rule.” Real: the questionnaire requires actual words only for material that might become website copy ([asset:128](</Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/assets/F002-questionnaire-v1-full.txt:128>), [F002:133](</Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F002-client-discovery-interview.md:133>)).

## 2. Repo-rule compliance

- **P0 is unmergeable as specified.** It names daemon engine code and a domain type, but no `/api/*` interview endpoints, request/response DTOs under `packages/contracts/src/api/`, web entry surface, or `od interview …` command registered in `SUBCOMMAND_MAP`. All are mandatory in the same PR ([AGENTS.md:169](</Users/zero-suminc./projects/mishmash/AGENTS.md:169>), [AGENTS.md:172](</Users/zero-suminc./projects/mishmash/AGENTS.md:172>), [AGENTS.md:174](</Users/zero-suminc./projects/mishmash/AGENTS.md:174>)).

- **P1 and P2 have the same closure failure.** Send, resume/return, embed, and variants are separate user-facing capabilities, yet none has the required contract/API/web/CLI matrix, `--json`, or relevant `--prompt-file` path ([AGENTS.md:173](</Users/zero-suminc./projects/mishmash/AGENTS.md:173>)).

- **R5 places shared vocabulary on the wrong side of the app boundary.** A web UI and shared `ClientBrief` cannot import vocabulary from daemon-private `src`; shared DTOs and enums must live in pure contracts ([AGENTS.md:154](</Users/zero-suminc./projects/mishmash/AGENTS.md:154>), [AGENTS.md:156](</Users/zero-suminc./projects/mishmash/AGENTS.md:156>)).

- **The Playwright verification target is invalid.** Playwright’s configured `testDir` is `e2e/ui`, while `specs/**/*.spec.ts` is the Vitest tree ([playwright.config.ts:30](</Users/zero-suminc./projects/mishmash/e2e/playwright.config.ts:30>), [vitest.config.ts:15](</Users/zero-suminc./projects/mishmash/e2e/vitest.config.ts:15>)). UI Playwright files must be flat `e2e/ui/*.test.ts` and import the repository suite fixture ([e2e/AGENTS.md:161](</Users/zero-suminc./projects/mishmash/e2e/AGENTS.md:161>)). The listed command would not prove the requirement.

## 3. Executability unattended

- Four author decisions remain explicitly open: storage architecture, variant semantics, quick-tier upgrade, and embed audience ([F002:206](</Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/F002-client-discovery-interview.md:206>)). R10 additionally says privacy decisions must precede R8, so P1 is deliberately blocked.

- R5 and R6 have an unstated ordering dependency on unimplemented F001 artifacts and an incompatible F001 brief shape.

- The nightly scope is undefined: P0/P1/P2 are presented as phases, but success criteria omit falsifiable acceptance for R8–R12.

- The timing criterion requires nine real human runs. An unattended agent cannot generate real-user evidence or legitimately relabel tiers from synthetic conversations.

- “Drop FAQ depth,” “vague,” “confidence,” “acknowledge,” and “graceful ‘I don’t know’” lack executable definitions. The current UI considers any trimmed non-empty string valid, so `"my main line"` passes its required-field check unless a new server-side validator is specified ([QuestionForm.tsx:404](</Users/zero-suminc./projects/mishmash/apps/web/src/components/QuestionForm.tsx:404>), [QuestionForm.tsx:1565](</Users/zero-suminc./projects/mishmash/apps/web/src/components/QuestionForm.tsx:1565>)).

- R1’s rules conflict: “I don’t know” must be accepted, but R4 forbids completion while any required item is missing. Certifications also need an explicit valid `none` state because the source says to confirm none and continue ([asset:27](</Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/assets/F002-questionnaire-v1-full.txt:27>), [asset:47](</Users/zero-suminc./projects/mishmash/docs/plans/2026-08-18-demo-findings/assets/F002-questionnaire-v1-full.txt:47>)).

- The public-link architecture is undecided and cannot be inferred from the existing daemon: it binds to loopback, and origin-less local CLI callers are trusted ([daemon-threat-model.md:15](</Users/zero-suminc./projects/mishmash/docs/security/daemon-threat-model.md:15>), [daemon-threat-model.md:24](</Users/zero-suminc./projects/mishmash/docs/security/daemon-threat-model.md:24>)). An anonymous internet client requires a new hosted trust boundary, not merely a tokenized route on the local daemon.

## 4. Missing work

- No persisted interview/session/token model, schema version, SQLite migration, resume cursor, project-deletion cascade, retention deletion, token revocation, or idempotency design is specified. Existing projects only persist prompt and metadata JSON ([db.ts:63](</Users/zero-suminc./projects/mishmash/apps/daemon/src/db.ts:63>)).

- `CreateProjectRequest.brief` is already occupied by `GuidedCreateBrief`, including `iterations: 1–3`; F002 must define whether it extends, discriminates, or uses a new field, and preserve existing callers/tests ([projects.ts:325](</Users/zero-suminc./projects/mishmash/packages/contracts/src/api/projects.ts:325>), [projects.ts:346](</Users/zero-suminc./projects/mishmash/packages/contracts/src/api/projects.ts:346>), [project-create-guided-brief.test.ts:80](</Users/zero-suminc./projects/mishmash/apps/daemon/tests/project-create-guided-brief.test.ts:80>)).

- Brief-created projects must explicitly set `skipDiscoveryBrief`; otherwise the newly created project can immediately ask another discovery form ([project/index.ts:1724](</Users/zero-suminc./projects/mishmash/apps/daemon/src/routes/project/index.ts:1724>)).

- A TypeScript `ClientBrief` does not provide the promised runtime schema validation. Versioned runtime validation and serialization/error contracts are absent.

- Accessibility acceptance is absent for the long stepped interview, validation errors, focus restoration, resume state, anonymous client page, and embed. Existing question-form tests already protect keyboard access and readable required markers and would need extension rather than replacement ([QuestionForm.test.tsx:283](</Users/zero-suminc./projects/mishmash/apps/web/tests/components/QuestionForm.test.tsx:283>), [QuestionForm.test.tsx:432](</Users/zero-suminc./projects/mishmash/apps/web/tests/components/QuestionForm.test.tsx:432>)).

- Missing coverage includes contract tests, route authorization/expiry/resume tests, CLI parity tests, web component tests, project-create compatibility tests, public-link abuse tests, embed isolation tests, and a real UI E2E path.

## 5. Risk of silent damage

- Exact phone/email and all answers can enter model prompts and optional conversation/tool telemetry; the privacy policy explicitly allows prompts, responses, and tool content to be transmitted when enabled ([PRIVACY.md:48](</Users/zero-suminc./projects/mishmash/PRIVACY.md:48>), [PRIVACY.md:86](</Users/zero-suminc./projects/mishmash/PRIVACY.md:86>)). No client consent, PII redaction, or telemetry exclusion is specified.

- Verbatim anonymous-client text will be folded into project prompts, creating a prompt-injection path. The existing guided-brief route has explicit newline/control-character sanitization tests that F002 does not preserve ([project-create-guided-brief.test.ts:100](</Users/zero-suminc./projects/mishmash/apps/daemon/tests/project-create-guided-brief.test.ts:100>)).

- URL tokens can leak through browser history, logs, referrers, analytics, and screenshots; token hashing, entropy, expiry, rotation, one-time use, and rate limits are unspecified. A public model-backed link also creates an unbounded inference-cost/abuse surface.

- Replayed completion requests can silently create duplicate projects or variants because no idempotency key or atomic completion transition is required.

- Requiring service areas and certifications for poetry/SaaS preserves the very vertical lock-in R5 claims to remove and can trap non-trade users in a non-completable interview.

Before execution, the author must decide: the authoritative hosted/public architecture and data owner; PII retention/consent/telemetry policy; canonical versioned session and brief schemas; F001 dependency/order; exact required-field and incomplete-terminal semantics; variant and embed semantics; and the complete API/UI/CLI/test matrix.

VERDICT: NOT-READY

