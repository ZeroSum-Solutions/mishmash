F005 — Message center upstream leak

## 1. Factual accuracy

- Screenshot evidence is unverifiable: `~/Desktop/Screenshot 2026-08-18 at 6.41.30 PM.png` does not exist, so the dates, titles, bodies, count, and client-facing severity cannot be confirmed.
- `MessageCenter.tsx` is not a repository path; the real file is `apps/web/src/components/MessageCenter.tsx:37`.
- The listed R1 symbols cover only the credentialed route. Anonymous messages travel through the general `proxyAmrApiRequest` and `/api/integrations/vela/api-proxy/*splat`, not `proxyVelaMessageCenterRequest` (`apps/daemon/src/routes/vela.ts:111-117`, `apps/daemon/src/routes/vela.ts:432-443`). Deleting only the three named targets leaves the anonymous upstream endpoint live.
- “Logged in polls that origin” is not universally true: the credentialed route uses configurable `VELA_API_URL` or stored `apiUrl`; `amr-api.open-design.ai` is only the default (`apps/daemon/src/integrations/vela.ts:529-557`).
- “Every message-center open sends a request” is incomplete: synchronization also starts while closed, repeats every 60 seconds, and runs on visibility changes (`apps/web/src/components/MessageCenter.tsx:121-136`).
- “Whatever the team reads is reported upstream” is false for anonymous users. Read receipts are sent only when `account` is true; otherwise read state stays in localStorage (`apps/web/src/components/MessageCenter.tsx:167-195`, `apps/web/src/message-center-client.ts:36-43`).
- “No user-facing task model exists; the closest is routines” is overbroad. The repository has a `TaskStatus` contract and visible Todo/Pet task surfaces, although none is the requested team-assignable CRUD model (`packages/contracts/src/tasks.ts:1-20`, `apps/web/src/components/ChatPane.tsx:3414-3441`, `apps/web/src/components/ToolCard.tsx:292-365`).
- `runtimes/defs/amr.js` is stale as a source path; the real source is `apps/daemon/src/runtimes/defs/amr.ts:29`.

## 2. Repo-rule compliance

- P0 deletes the HTTP handler while retaining the web panel, but `od message-center` remains registered and calls that handler (`apps/daemon/src/cli.ts:900-908`, `apps/daemon/src/cli.ts:1479-1558`). This violates the same-endpoint UI/CLI rule (`AGENTS.md:167-175`) and breaks an existing capability manifest entry (`scripts/waves/capability-manifest.json:148-169`).
- Message-center DTOs currently live in the web client, not `packages/contracts` (`apps/web/src/message-center-client.ts:1-19`). Any retained/replacement local inbox API needs shared contract types under the rule at `AGENTS.md:156-174`.
- R6–R8 specify new user-facing team messaging, task, and ledger-notification capabilities but omit their HTTP endpoints, contract types, `od` commands, `--json` behavior, and `SUBCOMMAND_MAP` registration. They are unmergeable as a web-only plan (`AGENTS.md:169-175`).
- The proposed Playwright location is invalid. Playwright owns flat `e2e/ui/*.test.ts` files, while `e2e/specs/*.spec.ts` is the non-UI Vitest lane (`e2e/AGENTS.md:9-12`, `e2e/AGENTS.md:159-166`); the functional Playwright configuration restricts `testDir` to `./ui` (`e2e/playwright.config.ts:30-39`).

## 3. Executability unattended

- Scope is unresolved: the document calls P0 standalone but also instructs P1 to be built with F003. F003 explicitly says its shared-daemon versus multi-tenant decision must precede implementation (`F003-team-collaboration-and-ledger.md:95-113`).
- R2 does not define what “on upgrade” means, whether removal is one-time, or the ordering needed to prevent a stale-content flash. Current code hydrates cached messages before rendering (`apps/web/src/components/MessageCenter.tsx:114-119`).
- R3/R4 provide no approved replacement subtitle or empty-state copy. The existing body independently promises “New platform messages” and must also change (`apps/web/src/i18n/locales/en.ts:743-751`).
- R5 is not falsifiable as a class-level guarantee. The current neutrality gate matches named-orchestrator syntax and optional literal terms; a test for one origin cannot detect arbitrary remote first-party feeds (`scripts/guard.ts:611-672`).
- Success criterion 1 lacks an executable capture method and ignores `/api/integrations/vela/status`, which the component calls before pulling messages (`apps/web/src/message-center-client.ts:51-55`, `apps/web/src/components/MessageCenter.tsx:65-77`) and which can initiate live billing work (`apps/daemon/src/routes/vela.ts:354-400`).
- The grep’s “expect none” cannot pass while legitimate AMR remains: retained source references exist in `apps/daemon/src/integrations/vela.ts:106`, `apps/daemon/src/integrations/vela.ts:541`, `apps/daemon/src/integrations/vela-wallet.ts:13`, and `apps/daemon/src/langfuse-trace.ts:452`.
- No success criteria cover R6–R8, and “meaningful,” “checkpoints,” task status semantics, persistence, CRUD behavior, and notification selection remain undecided.

## 4. Missing work

- Update or replace existing web-client, component, daemon-route, and CLI tests that explicitly assert the upstream routes (`apps/web/tests/message-center-client.test.ts:24-54`, `apps/web/tests/components/MessageCenter.test.tsx:69-110`, `apps/daemon/tests/integrations/vela.routes.test.ts:1506-1600`, `apps/daemon/tests/message-center-cli.test.ts:101-248`).
- Add the required red specification and package-scoped web/daemon tests; root checks alone are insufficient (`AGENTS.md:296-308`).
- Define exact cache migration for all three existing keys and prove no transient hydration (`apps/web/src/message-center-client.ts:23-49`).
- Update both typed i18n declarations and English values for every new P1 string, not only the subtitle (`AGENTS.md:279-281`, `apps/web/src/i18n/types.ts:1082-1097`).
- Preserve dialog labeling, modal semantics, Escape behavior, and focus restoration, and add keyboard/accessibility criteria for new message/task controls (`apps/web/src/components/MessageCenter.tsx:200-207`, `apps/web/tests/components/MessageCenter.test.tsx:389-395`).

## 5. Risk of silent damage

- Following the “zero origin grep hits” instruction could remove unrelated AMR login, wallet, analytics, and tracing behavior despite the stated narrow scope.
- Following the named deletion list leaves the anonymous general proxy capable of serving the same feed.
- Leaving status polling or the 60-second/visibility effects in place can preserve outbound AMR activity while the UI appears empty.
- Clearing cache after hydration can briefly display vendor messages.
- Removing the route without updating CLI and capability metadata silently breaks headless consumers and parity gates.

Before execution, the author must decide whether tonight removes the capability across HTTP/UI/CLI or retains a local empty capability across all three, explicitly exclude or resolve P1/F003, and rewrite the anonymous-route, cache-migration, contract, and verification plan accordingly.

VERDICT: NOT-READY

