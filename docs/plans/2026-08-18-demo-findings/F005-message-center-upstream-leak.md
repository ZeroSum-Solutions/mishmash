# F005 — Message center serves upstream Open Design announcements, not team messages

| Field | Value |
|---|---|
| Captured | 2026-08-18, live team demo (screenshot) |
| Reported by | Devin |
| Type | **Defect (fork leak)** + feature redirect |
| Area | `apps/web/src/message-center-client.ts` · `apps/daemon/src/routes/vela.ts` · `apps/web/src/components/MessageCenter.tsx` |
| Severity | **High** — vendor marketing shown to Devin's team and any client under MishMash branding |
| Effort | **S** to cut the feed (P0, unattended-executable tonight) · **M**, blocked, to rebuild as a team inbox (P1, see §4.2) |
| Status | 🔬 Root cause confirmed; P0 re-specified for unattended execution (see Revisions) |

---

## 1. Raw note (verbatim)

> CAN WE MAKE SURE THat the message center does not have anything routed from open design and
> is only messages from our team amounsgt eachother and tasks we create?

**Screenshot evidence** (`~/Desktop/Screenshot 2026-08-18 at 6.41.30 PM.png`) — two messages
under a header reading *"MishMash updates, platform announcements, and account notices"*:

| Date | Title | Body |
|---|---|---|
| Aug 14, 2026 | Turn ideas into designs with DeepSeek Harness | *"DeepSeek Harness is now integrated with **Open Design**…"* |
| Aug 14, 2026 | Open Design Now Features Built-in Image Generation | *"**Open Design** now supports Seedream 5.0 Pro, GPT Image 2.0…"* |

---

## 2. Root cause

**The message center is a live proxy to the upstream vendor's API.** It is not MishMash
content and never was.

The screenshot cited above was re-checked against the file on disk this session (it exists —
an earlier audit pass flagged it as missing, which was a tooling/path error on that pass's
part, not a fact about the file). Its contents match this write-up verbatim: header *"MishMash
updates, platform announcements, and account notices."*, "Deepseek Harness" / *"Turn ideas into
designs with DeepSeek Harness"*, and "Image" / *"Open Design Now Features Built-in Image
Generation"*. The two-message count and both headlines are confirmed, not assumed.

```
apps/daemon/src/routes/vela.ts:49
  const AMR_API_UPSTREAM_ORIGIN = 'https://amr-api.open-design.ai';
```

`apps/web/src/message-center-client.ts` polls that origin through two proxy paths:

| Mode | Path | Daemon handler |
|---|---|---|
| Logged in | `/api/integrations/vela/message-center` (`ACCOUNT_PROXY`, client.ts:21) | `proxyVelaMessageCenterRequest` (`vela.ts:184`), registered at `vela.ts:434` |
| **Anonymous** | `/api/integrations/vela/api-proxy/api/v1/message-center` (`ANONYMOUS_PROXY`, client.ts:22) | the **generic** `proxyAmrApiRequest` (`vela.ts:432`) — this is not a message-center-specific handler, it forwards *any* `/api/v1/*` suffix to the vendor |

Note the second: **even without an account, MishMash pulls the upstream feed**, and it does so
through the same general-purpose AMR passthrough that the rest of the legitimate Vela/AMR
integration depends on — there is no separate anonymous-message-center code path to delete.
Local storage keys are still branded upstream too —
`open-design.message-center.anonymous-messages.v1`.

`pullMessageCenter()` (`message-center-client.ts:58-91`) pages through up to
`MAX_MESSAGE_CENTER_PAGES = 20` pages (a real code constant, `message-center-client.ts:26` —
not a measured/stale count) of whatever that host returns and renders it verbatim. The upstream
vendor controls the content; MishMash controls only the frame around it.

The credentialed path's target is not hardcoded to the vendor host — `readVelaControlApiContext`
(`apps/daemon/src/integrations/vela.ts:529-557`) resolves `apiUrl` from `VELA_API_URL` env or a
stored profile, and only **defaults** to `https://amr-api.open-design.ai` when neither is set.
In this deployment the default is what's active, so the correction above doesn't change the
severity — it changes what "cut the feed" has to mean: the fix must stop the message-center
handler from calling **whatever origin AMR is configured for**, not special-case one hostname.

The i18n subtitle at `apps/web/src/i18n/locales/en.ts:743` says *"MishMash updates, platform
announcements, and account notices"* — so the UI actively **claims upstream's marketing as
MishMash's own**. The empty-state body at `en.ts:751` (`messageCenter.emptyBody`, *"New platform
messages will appear here."*) makes the same promise and also has to change. That is the part
that would be embarrassing in front of a client.

**Traffic is continuous, not open-gated.** `<MessageCenter>` is mounted unconditionally in
`apps/web/src/components/EntryShell.tsx:1216` and `apps/web/src/components/ProjectView.tsx:8867`
— it is always in the tree, badge and all, not lazily rendered behind the panel. Its sync effect
(`MessageCenter.tsx:121-132`) fires on mount, every 60 seconds via `setInterval`, and on every
`visibilitychange` to `visible` — regardless of whether the panel is open. "Opens" is the wrong
mental model for when a request fires; "the app is running" is the right one.

**Read receipts are not universally sent upstream.** `markRead`/`markAllRead`
(`MessageCenter.tsx:167-195`) call `markAccountMessageRead`/`markAllAccountMessagesRead`
(`message-center-client.ts:93-101`) — which hit the vendor — **only when `account` is true**.
Anonymous read state stays in `localStorage` (`writeAnonymousState`, `message-center-client.ts:36-43`)
and is never reported upstream. §3 below is corrected accordingly.

### Why the existing neutrality gate did not catch this

The repo already runs `scripts/product-neutrality.test.ts` inside `pnpm guard`, and it works —
but `collectProductNeutralityViolationsFromSource` (`scripts/guard.ts:611-672`) scans **source
text** for two specific patterns: a named-orchestrator-example regex and an opt-in forbidden-term
list. These strings exist in no source file; they arrive at runtime over HTTPS from a third
party. **A source-scanning gate cannot catch remote content by construction.** That is a real
gap, but it is narrower than "the neutrality strategy" — see R5 below, which used to claim this
finding closes remote-content neutrality as a class. It doesn't, and is rewritten to stop
claiming that.

---

## 3. Secondary concern — resolved by the P0 redesign below, not left open

Every message-center sync (continuous, per above — not just "on open") sends a request to
whatever AMR is configured for, **when the account path is used**; the anonymous path never
reported reads upstream even before this fix. Once R1 lands (message-center backed locally,
zero upstream calls in either mode), this concern is closed as a side effect for the
message-center surface specifically. It does **not** touch the rest of the AMR/Vela
integration (login, wallet/billing, model catalog) — those still talk to the vendor by design,
and whether *that* should also stop is the open question in §5, unchanged.

---

## 4. PRD

### 4.1 P0 — cut the feed (unattended-executable tonight)

**Design decision carried into this rewrite** (mechanical, not a product judgment call — see
"what's still open" below for the one thing that *is* a judgment call): keep the message-center
capability wired on **all four surfaces** — HTTP route, contract DTO, web UI, `od` CLI — and
swap its backing from "proxy to vendor" to "local, always-empty, first-party." Do **not** delete
the route or the CLI subcommand. The previous version of this PRD said "remove the
message-center calls" via a short list of named functions; that list only covered the
credentialed path (`isAllowedMessageCenterRequest`, `proxyVelaMessageCenterRequest`, the
`/api/integrations/vela/message-center/*splat` handler) and left the anonymous path live,
because anonymous traffic never went through those functions — it goes through the *generic*
`proxyAmrApiRequest` (`vela.ts:432`), which the rest of AMR needs and must not be touched (see
§5). Deleting the named credentialed-path functions alone would also orphan `od message-center`
(`apps/daemon/src/cli.ts:907`, `cli.ts:1479-1558`) and the `message-center` row in
`scripts/waves/capability-manifest.json:148-169` — `pnpm guard` runs a real parity check over
exactly that manifest/CLI pair (`apps/daemon/tests/capability-manifest-guard-check.test.ts`) and
would catch the break, but only after the damage (a dangling CLI command) was already done.
Keeping the same route shape and CLI, and only changing what answers them, avoids all of that.

- **R1 · Make the message-center backend local-only.** Replace the body of the
  `/api/integrations/vela/message-center/*splat` handler (`vela.ts:434-448`, currently calling
  `proxyVelaMessageCenterRequest`) so it answers `GET .../messages` with
  `{ messages: [], nextCursor: null, unreadCount: 0 }` and `POST .../read`,
  `.../read-all` with a local no-op success — no `https`/`http` request, no `context.apiUrl`,
  no vendor call, regardless of login state. Then, separately, stop the **anonymous** path
  (`ANONYMOUS_PROXY` in `message-center-client.ts:22`) from resolving through
  `AMR_API_PROXY_PREFIX`/`proxyAmrApiRequest` at all — point it at the same local endpoint the
  account path now uses (or an equivalent unauthenticated local route), since there is no
  account/control-key gate left to enforce once the answer is always empty. `AMR_API_UPSTREAM_ORIGIN`,
  `proxyAmrApiRequest`, and the rest of `vela.ts` stay untouched — they serve the legitimate AMR
  runtime, which is out of scope (§5).
- **R2 · Remove the stale-cache hydration path, don't just clear it later.**
  `MessageCenter.tsx:114-119` hydrates `messages`/`readIds` state from
  `open-design.message-center.anonymous-*` localStorage **synchronously on mount**, before the
  (now-empty) network sync resolves — on an existing install with cached vendor messages, this
  is a real flash of upstream content on every load, not a hypothetical. Delete that effect
  entirely; there is nothing worth hydrating once the feed is local-only and always empty. Purge
  the three keys (`open-design.message-center.anonymous-messages.v1`,
  `...-read-ids.v1`, and the legacy `...-started-at.v1`) unconditionally on mount, before the
  first render that could read them, so no code path can display cached vendor content even for
  one tick.
- **R3 · Honest empty state.** With the backend now always returning zero messages, the panel
  shows its existing empty-state UI (`MessageCenter.tsx:216-224`-ish, driven by
  `messageCenter.emptyAllTitle`/`emptyBody`) — no code change needed there beyond the copy fix
  in R4, since the component already renders an empty list correctly.
- **R4 · Fix the subtitle and empty-body copy.** Both currently promise vendor content.
  Replace, in both `apps/web/src/i18n/types.ts:1086` and `apps/web/src/i18n/locales/en.ts:743`
  (and `:751` for the empty body) — types.ts first, per the repo's i18n key rule:
  - `messageCenter.subtitle`: `"Messages from your team and the tasks you create."`
  - `messageCenter.emptyBody`: `"Team messages and tasks will appear here."`

  These describe the panel's purpose (matching Devin's raw note) without claiming content that
  doesn't exist yet — P1 (§4.2) is what actually populates it, and is explicitly gated below.
- **R5 · Regression test for this specific leak.** Add a test that fails if the message-center
  handler or client ever issues an HTTP request to a non-local origin again — e.g. a daemon test
  asserting the `/api/integrations/vela/message-center/*` and rewritten anonymous-proxy handlers
  never call out (extend `apps/daemon/tests/integrations/vela.routes.test.ts`, which already has
  an upstream-forwarding assertion at its `ALL /api/integrations/vela/message-center/*` describe
  block starting line 1506 — that test currently *asserts* forwarding happens and needs to be
  rewritten to assert it does not), plus the Playwright network-capture test in the verification
  block below. This is a **targeted regression test for one surface**, not a general "remote
  content can't be rendered as first-party" gate — `product-neutrality.test.ts` stays a
  source-scanner and this doesn't extend it to catch some future, different remote-content leak
  elsewhere in the app. Don't claim more than that in the PR description.

**Required companion changes (previously missing, now explicit):**

- **R6 · Update the four tests that currently assert the upstream behavior**, or they fail for
  the right reason and block the PR — which is correct, but plan for it:
  `apps/web/tests/message-center-client.test.ts:24-54` (asserts the anonymous pull URL contains
  `/api-proxy/`), `apps/web/tests/components/MessageCenter.test.tsx:69-110` (asserts vendor-style
  messages render and CTA URLs open `open-design.ai`), `apps/daemon/tests/integrations/vela.routes.test.ts`
  around its message-center describe block (asserts upstream forwarding with auth header), and
  `apps/daemon/tests/message-center-cli.test.ts:101-248` (drives the CLI against a stub upstream
  server). Each needs to assert the new local-empty behavior instead of deleting coverage.
- **R7 · Add the contract DTO.** `MessageCenterMessage`/`MessageCenterPage`
  (`message-center-client.ts:3-19`) currently live in the web client only, not in
  `packages/contracts/src/api/` — every other daemon/web-shared shape does (see the sibling files
  under that directory, e.g. `automations.ts`, `anomalies.ts`). Move the DTO there and import it
  from both the web client and the daemon route handler, per `AGENTS.md`'s "Capability exposure"
  and "Boundary constraints" sections (shared API DTOs belong in `packages/contracts`).
- **R8 · Confirm — don't just hope — that CLI/manifest parity survives.** Because R1 keeps the
  route path, method set, and response shape identical (just swaps the implementation), the
  `scripts/waves/capability-manifest.json` `message-center` entry and `od message-center` in
  `cli.ts` should need no edits. Verify this explicitly (command below) rather than assuming it —
  if the response shape changes at all (e.g. `unreadCount` type), update the manifest entry in
  the same PR.
- **R9 · Existing accessibility/dialog behavior must not regress.** P0 changes the data source,
  not the dialog. `apps/web/tests/components/MessageCenter.test.tsx:389-395` (Escape closes the
  panel and restores trigger focus) must continue to pass unmodified — it is proof nothing about
  the modal semantics moved.

### 4.2 P1 — rebuild as the team inbox (what Devin actually asked for)

**⚠️ DECISION REQUIRED (blocks R10–R12) — do not start P1 unattended.**

This is F003 territory, and F003 itself says its core architecture question — shared-daemon
with per-browser named profiles vs. a real multi-tenant service
(`F003-team-collaboration-and-ledger.md:95-113`) — must be answered before *any* implementation,
including this one. F003 carries a recommendation (shared-daemon with named profiles), but a
recommendation is not the same as Devin's sign-off, and building R10 (team messages attributed
to a named member) on top of an unconfirmed identity model risks building the wrong data shape
twice. **Do not build P1 tonight.** P0 above is fully self-contained and does not depend on this
answer.

When F003's identity decision is confirmed, note before resuming:

- **R10 · Team messages.** Members message each other; each message attributed to a named
  member with their monster icon and colour (F003 R1/R2/R6).
- **R11 · Tasks.** *"tasks we create"* — **a new concept, confirmed absent, not just
  under-specified.** The repo has `TaskStatus` (`packages/contracts/src/tasks.ts:1-20`) and the
  `TodoWrite` UI (`ChatPane.tsx:3405-3441`, `ToolCard.tsx:292-365`) — both are real, user-facing,
  but neither is what R11 needs: `TaskStatus` tracks one agent *run's* lifecycle
  (queued/running/succeeded/…), and `TodoWrite` is a single chat turn's ephemeral scratch
  checklist, cleared when the conversation's todo snapshot changes. Neither persists across runs,
  neither has an assignee, neither links to a project. R11 needs an actual new entity: title,
  assignee (a member), project link, status, created_by — schema and CRUD surface, not a rename
  of something that exists. `routines` (scheduled agent prompts) is a different concept and
  should still not be overloaded.
- **R12 · Ledger notifications.** Meaningful project events from F003's ledger (R4) surface
  here — *"Megan changed the hero headline"* — so the inbox answers "what happened while I was
  away" without becoming a firehose. Checkpoints only, per F003 Q4.
- **Dual-track applies here too.** R10–R12 are *new* user-facing capabilities, so
  `AGENTS.md`'s "Capability exposure" three-step closure is mandatory and literal for them: HTTP
  endpoint + contract DTO + web UI + `od` CLI subcommand (with `--json`), landed in the same PR.
  P0 above doesn't trigger this rule because it adds nothing — it keeps all four existing
  surfaces and only swaps an implementation. P1 does add something, so it does trigger it.
- No success criteria exist yet for R10–R12; write them, including the a11y/keyboard coverage
  for whatever new controls appear, once the identity decision is confirmed and the schema is
  designed.

### 4.3 Success criteria (P0 only — this is what tonight's run is graded on)

1. **No request is ever issued, from either the credentialed or anonymous code path, to any
   origin other than the daemon's own base URL, when the message-center panel loads, on the
   60-second interval, or on a visibility change.** Verified by network capture (Playwright
   `page.on('request')`/`page.route('**/*')` across the full lifecycle, not a point-in-time
   check gated on "the panel is open") — see the verify command below. This replaces the
   previous, stricter-than-achievable wording ("no request to `amr-api.open-design.ai` when the
   message center opens") — that host is still legitimately called by `/api/integrations/vela/status`
   for wallet/billing data (`vela.ts:354-400`), which is unrelated AMR functionality this finding
   explicitly does not touch (§5). The new wording only constrains message-center traffic.
2. No message referencing Open Design, DeepSeek Harness, or Seedream appears — on a fresh
   profile *and* on an existing one with stale cache (guards R2). Verified by the same Playwright
   test seeding the three legacy localStorage keys before load.
3. `messageCenter.subtitle` and `messageCenter.emptyBody` equal the exact strings in R4 — assert
   both, not just "the subtitle changed."
4. The R5/R6 regression tests (daemon route test, web client test, component test, CLI test) are
   all green and each one is a genuine behavior assertion (empty response / no upstream call),
   not a deleted or skipped test.
5. `pnpm guard`, `pnpm typecheck`, `pnpm i18n:check` exit 0 — this includes the real
   capability-manifest/CLI parity check inside `pnpm guard` (R8), so a silent CLI break shows up
   here, not just in manual testing.

### 4.4 Verification

```bash
cd ~/projects/mishmash

# 1. Message-center-specific code no longer targets an upstream/proxy origin.
#    Scoped to the message-center surface, not a blanket check — AMR_API_UPSTREAM_ORIGIN and
#    amr-api.open-design.ai remain legitimate in vela.ts/vela-wallet.ts/langfuse-trace.ts for the
#    rest of the AMR integration (§5); a bare grep for the string across apps/ and packages/
#    will always show hits there and is not a valid pass/fail signal.
grep -n "proxyAmrApiRequest\|AMR_API_UPSTREAM_ORIGIN\|context.apiUrl" apps/daemon/src/routes/vela.ts | grep -i "message-center"
# expect no output — the message-center handler body must not reference these

grep -n "AMR_API_PROXY_PREFIX\|api-proxy" apps/web/src/message-center-client.ts
# expect no output — ANONYMOUS_PROXY must no longer route through the generic AMR proxy prefix

# 2. Root checks.
pnpm guard && pnpm typecheck && pnpm i18n:check

# 3. Package-scoped tests that were updated/added for this fix.
pnpm --filter @open-design/web test -- message-center-client MessageCenter
pnpm --filter @open-design/daemon test -- vela.routes message-center-cli

# 4. Network-capture end-to-end proof. Playwright UI tests are flat files under e2e/ui/ and
#    import test/expect from '@/playwright/suite' — NOT e2e/specs/ (that's the Vitest lane) and
#    NOT a bare `playwright test <path>` invocation. Write this as a new file, e.g.:
#    e2e/ui/message-center-no-upstream.test.ts
#    It must: seed the three legacy anonymous-* localStorage keys with vendor-shaped content,
#    load the app, wait past one sync cycle, and assert zero captured requests whose URL matches
#    the configured AMR origin/api-proxy prefix — for both a fresh profile and the seeded-cache
#    profile (criterion 2). Model the mocking approach on e2e/ui/amr-login-pill.test.ts, which
#    already intercepts /api/integrations/vela/* via page.route.
pnpm --filter @open-design/e2e exec playwright test message-center-no-upstream.test.ts
```

---

## 5. Open question for Devin

**Is the rest of the Vela/AMR integration staying?** P0 cuts only the message-center feed. The
AMR runtime is wired well beyond it (`apps/daemon/src/runtimes/defs/amr.ts:29`,
`VELA_RUNTIME_KEY`, `VELA_LINK_URL`, `apps/web/src/components/AmrArtifactUpgradeHomeCard.tsx`).
If the intent is broader — *no upstream vendor surface anywhere in MishMash* — that is a bigger
sweep and should be its own finding. I have scoped F005 narrowly to what the screenshot shows and
what you asked for.

---

## Revisions

- 2026-08-18 — captured from demo screenshot; upstream origin and proxy paths confirmed in
  source the same session. No code changed.
- 2026-08-18 (repair pass) — re-verified every factual claim against the repo and rewrote P0 for
  unattended execution. Changes:
  - **Corrected a wrong audit claim**: the cited screenshot does exist
    (`~/Desktop/Screenshot 2026-08-18 at 6.41.30 PM.png`) and its content (headlines, subtitle,
    message count) matches this document verbatim — re-opened and re-read this session. An
    earlier audit pass reported it missing; that was a path/tooling error on that pass, not a
    fact about the evidence, and this document's original claims stand.
  - Fixed the component path to `apps/web/src/components/MessageCenter.tsx` (was bare
    `MessageCenter.tsx`) and `apps/daemon/src/runtimes/defs/amr.ts` (was the stale `.js` path).
  - **Found and closed a real scope gap**: the original R1 named three credentialed-path
    functions to delete, but anonymous traffic never goes through them — it goes through the
    generic `proxyAmrApiRequest`, which also serves the legitimate AMR runtime. Deleting only the
    named functions would have left anonymous users still pulling the vendor feed. R1 is rewritten
    around a "keep all four surfaces, swap the backing to local-empty" design that closes both
    paths without touching the generic AMR proxy.
  - Corrected "every message-center open sends a request" — the component is always mounted and
    syncs on a 60s interval plus visibility changes, independent of the panel's open state.
  - Corrected "whatever the team reads is reported upstream" — false for anonymous users; read
    receipts only leave the machine when logged in. Fixed in §2/§3.
  - Corrected success criterion 1, which as originally written could never pass while the AMR
    login/wallet integration keeps calling the same host for unrelated billing data — narrowed to
    message-center traffic specifically.
  - Added the CLI-orphan/capability-manifest risk the original PRD missed entirely (R8), the
    missing contract DTO requirement (R7, per `AGENTS.md` dual-track rules), the four existing
    tests that assert the old upstream behavior and will need rewriting (R6), and the
    cache-hydration race that could flash stale vendor content even after R2's original wording
    (R2, rewritten).
  - Replaced the invalid verify command (`playwright test specs/message-center-neutrality.spec.ts`
    — `specs/` is the Vitest lane, not Playwright, and that file didn't exist) with a real,
    flat `e2e/ui/*.test.ts` file path importing from `@/playwright/suite`.
  - Narrowed R5 from an implied general "remote content can't pose as first-party" gate to what
    is actually being shipped: a targeted regression test for this one surface.
  - Gave R4 concrete final copy instead of leaving it as "rewrite this" with no answer to test
    against.
  - Softened R7 (now R11)'s "no task model exists" to name what does exist (`TaskStatus`,
    `TodoWrite`) and explain precisely why neither satisfies the requirement, instead of
    asserting a flat absence.
  - Split P1 out as explicitly blocked: marked **DECISION REQUIRED (blocks R10–R12)** on F003's
    shared-daemon-vs-multi-tenant identity question, and stated plainly that P1 is not part of
    tonight's unattended scope. P0 (§4.1) is scoped to stand alone and is what success criteria
    §4.3 grade.
  - No stale/unverified numeric claims found beyond the `MAX_MESSAGE_CENTER_PAGES = 20` code
    constant, which is a real, current value read from source, not a measured count — left as is
    with its provenance noted.
