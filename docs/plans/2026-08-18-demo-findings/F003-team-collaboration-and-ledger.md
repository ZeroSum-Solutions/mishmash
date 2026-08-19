# F003 — Team collaboration: shared projects, named identity, change ledger, live chat, live cursors

| Field | Value |
|---|---|
| Captured | 2026-08-18, live team demo |
| Reported by | Devin |
| Area | **Architecture** — identity, persistence, realtime transport, security model |
| Severity | **High** value · **High** risk — this is the largest change in the log |
| Effort | **XL** — genuinely phased; P0 alone is substantial |
| Status | 📝 Captured → 🔬 Scoped → 🛠 Repaired for unattended execution |

---

## 1. Raw note (verbatim)

> hey, so we're also gonna have to devise a way, two things. We're also gonna have to devise
> a way so that each member of the team can work on the same project and also see the whole
> history of each project's conversation. I would like it if everyone was tagged by name.
> Alex will be Alex, Megan will be Megan, or make a little monster as an icon, and then Dev
> and just label me as Dev. Any updates on these websites should be there for all of us to
> see. And we should also have a way, basically like a ledger, so we can go back and see who
> has changed what. We gotta make a live chat so we can talk, i wanna see in the chat thread
> editing the site live who made what changes. I don't know what I'm saying anymore. And
> also, if you can show cursors that are in there as well, if that's a thing, just color code
> the cursors.

**Six distinct asks**, separated because they have very different costs:

| # | Ask | Depends on |
|---|---|---|
| A1 | Multiple people work on the same project | Identity |
| A2 | Everyone sees the full conversation history of each project | Identity + shared access |
| A3 | Everyone tagged by name — Alex, Megan, **Dev** — with a monster icon | Identity |
| A4 | A ledger: go back and see who changed what | Identity + audit persistence |
| A5 | Live chat between teammates, with site edits attributed inline in the thread | Realtime transport |
| A6 | Live color-coded cursors — *"if that's a thing"* | Realtime presence |

> *"if that's a thing"* — yes, it is. It is also the most expensive item here and the least
> valuable of the six. Sequenced last deliberately.

---

## 2. Current state — the hard truth

**MishMash is single-user by construction. There is no concept of a person anywhere in it.**

This is not a missing feature; it is an absent dimension. Verified against the current `main`
checkout (commands below are exactly reproducible):

### No identity in the data model

Schema from `apps/daemon/src/db.ts` (`migrate()`, the function that creates every core table):

| Table | File:line | Identity columns | Note |
|---|---|---|---|
| `projects` | `apps/daemon/src/db.ts:65-74` | **none** | No owner, no members |
| `conversations` | `apps/daemon/src/db.ts:85-95` | **none** | No participants |
| `messages` | `apps/daemon/src/db.ts:120-142` | `role`, `agent_id`, `agent_name` | `role` is `user`/`assistant`; `agent_*` identifies the **AI agent**, never the human |
| `preview_comments` | `apps/daemon/src/db.ts:148-169` | **none** | Comments are anonymous |

There is no `user_id`, `author_id`, or `created_by` on any table the migration creates —
verified by reading the full `migrate()` body, not just the four collaboration-relevant
tables above.

**Verify (re-run this before trusting the table above — schemas drift):**
```bash
cd ~/projects/mishmash
sed -n '/^function migrate/,/^}/p' apps/daemon/src/db.ts | grep -A2 "CREATE TABLE IF NOT EXISTS \(projects\|conversations\|messages\|preview_comments\) "
```

### No auth — and the "allowed origin" mechanism is not where it looks like it is

`apps/daemon/src/security/loopback.ts` and `apps/daemon/src/security/privileged-routes.json`
exist and do what the name suggests: `loopback.ts` is a pure lexical "is this hostname
loopback" predicate (`isLexicalLoopbackHost`), used to gate which routes trust a
locally-originated request. There are no accounts, sessions, or roles anywhere in the daemon.

**Correction to the original draft of this finding:** the origin-allowlist env vars do **not**
live in `security/`, and they don't even both live in the daemon:

- `OD_ALLOWED_ORIGINS` is read in `apps/daemon/src/origin-validation.ts:52` — a daemon-side
  module, but a different file from `security/loopback.ts`.
- `OD_ALLOWED_DEV_ORIGINS` is read in `apps/web/next.config.ts:138` and
  `apps/web/sidecar/server.ts:326` — the **Next.js dev server's own** cross-origin check, a
  different app entirely. It never reaches the daemon.

So "the security model" is actually two independent boundaries in two different apps, plus the
loopback predicate in a third file. This matters for P1 (§3.2, R8): a new realtime channel has
to be threaded through whichever of these actually gates its transport, not "the existing
loopback/origin security model" as if it were one thing.

### How the team reaches it today

`.env.mishmash-team.local` sets `OD_ALLOWED_DEV_ORIGINS` and `OD_ALLOWED_ORIGINS` to admit the
tailnet hostname. Combined with the running daemon (`apps/daemon/src/cli.ts:1361` documents
`--port` defaulting to `7456`, confirmed live at `apps/daemon/dist/cli.js --port 7456`) published
by Tailscale at `https://devins-macbook-pro.tail908c18.ts.net:7443` (tailnet-only, per the
session this finding was captured in — not re-verifiable from the repo alone), the current
arrangement is:

> **Everyone on the tailnet shares Devin's laptop daemon as the same anonymous user.**

So A1 and A2 are, mechanically, *already true* — the team can open the same project and see
its history. What is missing is **who did what**, which is A3–A6, and all of it needs identity.

### No bidirectional realtime substrate — but a one-way pattern to extend, not duplicate

No WebSocket server, no CRDT, no Yjs/Liveblocks. **Correction:** the original draft of this
finding claimed "Nothing in `apps/daemon/src/http/` implements a bidirectional realtime
transport for peer state" and left it there. That's true as far as it goes, but it undersells
what already exists one directory over, and P1 (R8) should build on it rather than treat
realtime transport as greenfield:

`apps/daemon/src/plugins/events.ts` is a working, production, in-memory pub/sub ring buffer —
`record()` / `snapshot(since)` / `subscribe(fn)` — wired to a real SSE endpoint at
`apps/daemon/src/routes/plugins/index.ts:159-169` (`GET /api/plugins/events`, replays a
`since`-filtered backlog then streams live events with standard `text/event-stream` headers),
with a matching CLI precedent at `apps/daemon/src/cli.ts:4058-4174`
(`od plugin events tail -f|snapshot|stats|purge`). It is one-way (server→client) and
in-memory-only (a daemon restart drops it), so it does not by itself satisfy A5/A6 — but the
*pattern* (append → fan out to live subscribers → SSE) is exactly the shape R4's persistent
ledger and R8's realtime channel need. See §3.2, R8.

### Naming collisions the next PR must not walk into

Two names this finding uses casually — "attribution" and "member" — are already taken in this
codebase for something unrelated:

- **"Attribution"** already means *install/referral* attribution, not *authorship*
  attribution: `apps/daemon/src/routes/attribution.ts` and
  `packages/contracts/src/api/attribution.ts` implement a "how did this install get
  credited" claim flow (`AttributionClaimSource` = `mac_where_froms` /
  `windows_zone_identifier` / etc., an `ATTRIBUTION_CLAIM_PATH` route, and — confusingly — its
  own internal concept called a "ledger" for pending installer claims). Do not name the new
  authorship/audit ledger module, route, or contract file `attribution*`; use `project-events`
  or `ledger` and keep it in its own files.
- **"Member"** already means a *grouped preview-comment selection element*, not a person:
  `PreviewCommentMember` in `packages/contracts/src/api/comments.ts:46-54` (`elementId`,
  `selector`, `label`, …) is unrelated to team identity. Name the new team-identity type
  something that doesn't collide — e.g. `TeamMember` — so a reader (or a grep) can't confuse
  the two.
- **`od chat` is already a registered CLI subcommand** (`apps/daemon/src/cli.ts:900`,
  handler `runChat` at `apps/daemon/src/cli.ts:8388`) for **"Side Chat"** — forking a new
  *agent* conversation that seeds from another conversation's context. It has nothing to do
  with teammates messaging each other. R9's team chat needs its own CLI verb; see §3.2.

### The one thing that already exists

`messages.agent_name` means the UI **already renders a per-message name badge**. The display
surface for "tagged by name" is partly built — it is being fed an agent's name because a
human's name does not exist to feed it.

---

## 3. PRD

### 3.1 The decision that gates everything

> **Does the team keep sharing one daemon on Devin's laptop, or does MishMash become a
> multi-tenant service?**
>
> - **Shared-daemon.** Identity becomes a *lightweight local profile* — each teammate picks a
>   name on first connect, stored per-browser, stamped onto everything they do. Cheap. Honest.
>   Delivers A1–A5. Its ceiling: it is **attribution, not authentication** — anyone on the
>   tailnet can claim to be anyone. Fine for a trusted three-person team on a private tailnet;
>   not fine for clients.
> - **Multi-tenant service.** Real accounts, real auth, per-user data scoping, and a daemon
>   that stops being local-first. That is a different product, and it collides with the
>   local-first architecture the whole repo is built on.
>
> **DECISION FOR TONIGHT'S RUN: shared-daemon with named profiles.** This finding's original
> draft flagged this as "must be answered before any implementation" and then, two sentences
> later, told the rest of the PRD to assume it anyway — a contradiction an unattended agent
> cannot resolve on its own. Resolving that contradiction in favor of the author's own stated
> recommendation (not inventing a new answer): **P0–P2 below execute under the shared-daemon
> assumption, full stop.** This is provisional, not a closed architectural decision — surface
> it in the morning-review list (§3.4) for Devin's explicit sign-off before this trust model is
> ever extended to anyone outside the three-person tailnet. It does not block tonight's run.

### 3.2 Requirements

Every capability below closes **all four** surfaces in the same PR, per `AGENTS.md`
"Capability exposure (UI/CLI dual-track)": an HTTP endpoint in
`apps/daemon/src/routes/`, a DTO in `packages/contracts/src/api/` (re-exported from
`packages/contracts/src/index.ts`, matching the existing pattern at line 6/10 for
`attribution`/`anomalies`), a web surface in `apps/web/src/`, and an `od <capability>`
subcommand registered in `SUBCOMMAND_MAP` (`apps/daemon/src/cli.ts:900`) supporting
`--json`. A PR that lands only some of the four is unmergeable per that rule — treat the
table below as the closure checklist, not a suggestion.

| Capability | HTTP route (new file) | Contract DTO (new file) | Web surface | CLI verb |
|---|---|---|---|---|
| Members (R1, R2) | `apps/daemon/src/routes/members.ts` | `packages/contracts/src/api/members.ts` (export `TeamMember`, not `Member` — see §2 collision note) | Member picker on first connect + profile switcher | `od members` (`list`, `whoami`, `set`) — unused verb, confirmed no collision |
| Ledger (R3, R4, R5) | `apps/daemon/src/routes/project-events.ts` | `packages/contracts/src/api/project-events.ts` — **not** `attribution.ts` (see §2 collision note) | Per-project ledger timeline | `od ledger` (`tail -f`, `snapshot`, `list`) — unused verb, confirmed no collision |
| Team chat (R8, R9, R10) | `apps/daemon/src/routes/team-chat.ts` | `packages/contracts/src/api/team-chat.ts` | Team chat panel, distinct from the agent `ChatPane` | `od team-chat` (`od chat` is taken — see §2) |
| Presence/cursors (R11, R12) | `apps/daemon/src/routes/presence.ts` | `packages/contracts/src/api/presence.ts` | Presence dots (R12) + cursor overlay (R11) | `od presence` (`list`) — unused verb, confirmed no collision |

#### P0 — identity + ledger (delivers A1, A2, A3, A4)

- **R1 · Local member profile.** A `TeamMember` concept: `id`, `display_name`, `color`,
  `avatar_url`. Seeded with **Alex**, **Megan**, **Dev**. On first connect from an
  unrecognised browser, prompt for which member you are; persist the choice in
  `localStorage`.
  - **Names are exactly as Devin specified**: `Alex`, `Megan`, `Dev` — not "Devin", not
    "Devin Wiggins".
- **R2 · Monster avatars.** Generate a distinct monster icon per member, each with a
  distinct colour. That colour is the member's identity colour and is reused verbatim by the
  ledger, the chat, and (P2) their cursor. Generate via Higgsfield (subscription image-gen
  lane) — three deterministic assets, committed under `design-templates/` or an equivalent
  static asset path, not regenerated at runtime.
- **R3 · Author dimension.** A migration adding `author_member_id` to `messages`
  (`apps/daemon/src/db.ts:120`) and `preview_comments` (`apps/daemon/src/db.ts:148`), and
  `created_by_member_id` to `projects` (`apps/daemon/src/db.ts:65`). Existing rows backfill
  to a `legacy` member (a fourth seeded `TeamMember` row, distinct from the three real ones,
  `display_name: 'Legacy'`) so history stays readable rather than being falsely attributed to
  a real person.
- **R4 · Change ledger.** A `project_events` table — append-only, never `UPDATE`d or
  `DELETE`d: `id`, `project_id`, `member_id`, `kind`, `target` (file path / conversation id /
  setting key), `summary`, `diff_ref`, `created_at`. Every mutating action writes one row.
  - **Ledger depth is a requirement, not an open question.** The original draft left "every
    keystroke, or meaningful checkpoints?" as an unresolved open question while separately
    recommending checkpoints. For an unattended run, an unresolved question is a blocker;
    the recommendation is not new information, so adopting it here closes the gap without
    inventing an answer: **`kind` is checkpoint-grained** — one row per file save, per agent
    run completion, per setting change, per comment, per member-attributed chat message.
    Keystroke-level and mid-edit deltas are explicitly out of scope.
  - Covers agent runs too: when an agent edits a file, the ledger records **which member's
    turn caused it** — that is what makes "who changed what" true rather than "the AI did it."
  - **P0 turn-visibility requirement (does not require solving concurrency):** when a member
    starts a conversation turn, write a `turn.started` ledger row before dispatching to the
    agent, and a `turn.ended` row on completion. This makes "who is mid-turn right now"
    derivable from the ledger (last `turn.started` with no matching `turn.ended`) without
    deciding whether simultaneous turns queue, lock, or interleave — that question is
    deferred; see §4, "DECISION REQUIRED" item 1.
- **R5 · Ledger UI.** A per-project timeline: who, what, when, filterable by member, with the
  change inspectable. This is A4, and it is the highest-value item in the finding — it is the
  one that survives even if the team never uses live cursors.
- **R6 · Attribution everywhere.** Name + monster + colour on every message, comment, and
  ledger row.
- **R7 · i18n.** Every new string added to `apps/web/src/i18n/types.ts` (`Dict`) first, then
  `apps/web/src/i18n/locales/en.ts`; `pnpm i18n:check` exits 0.

#### P1 — live chat with inline edit attribution (A5)

- **R8 · Realtime transport.** Extend the SSE pub/sub pattern already proven at
  `apps/daemon/src/plugins/events.ts` + `apps/daemon/src/routes/plugins/index.ts:159-169`
  (record → fan out to live subscribers → `text/event-stream`), not a from-scratch
  WebSocket. Concretely: a `project_events` broadcaster mirroring that module's
  `record`/`snapshot(since)`/`subscribe` shape, but persisting to the R4 SQLite table instead
  of an in-memory-only ring buffer, exposed at `GET /api/projects/:id/events/stream`. Team
  chat messages (R9) ride the same stream as a distinct `kind`, or a sibling stream using the
  identical pattern; client→server writes are a normal `POST`, not a second transport. This
  must pass through **both** origin checks named in §2 (`OD_ALLOWED_ORIGINS` in
  `apps/daemon/src/origin-validation.ts` for the daemon API, and `OD_ALLOWED_DEV_ORIGINS` in
  `apps/web/next.config.ts` / `apps/web/sidecar/server.ts` for the web dev server) — do not
  add a third, parallel allowlist.
- **R9 · Team chat thread** per project, distinct from the agent conversation (`od chat` /
  `apps/daemon/src/cli.ts:8388`), so talking to each other is never confused with prompting
  the agent. CLI verb: `od team-chat` (see closure table above — `od chat` is taken).
- **R10 · Inline edit events.** Ledger entries stream into the chat thread as they happen —
  *"Megan changed the hero headline"* — which is exactly Devin's *"i wanna see in the chat
  thread editing the site live who made what changes."* R4's ledger is the event source, so
  A4 and A5 share one spine (and one SSE stream, per R8).

#### P2 — presence (A6)

- **R11 · Live cursors**, colour-coded per member using R2's colours, broadcast over the same
  R8 stream as a high-frequency, non-persisted event kind (cursor positions do **not** get
  written to `project_events` — that table is append-only audit history, not ephemeral UI
  state).
- **R12 · Presence indicators** — who is viewing which file right now. Cheaper than cursors
  and probably 80% of the value; ship it first and see whether cursors are still wanted.

### 3.3 Risks

| Risk | Mitigation |
|---|---|
| **Attribution ≠ authentication.** Anyone on the tailnet can pick any name | State it plainly in the UI. Acceptable for a trusted team; **must not** be extended to client access without real auth |
| Local-first architecture assumes one writer | P0 is additive (stamping rows), not concurrent editing. Concurrent *editing* is not in scope — flag loudly if it becomes an expectation |
| Two people prompting the same agent conversation simultaneously | R4's `turn.started`/`turn.ended` rows make it *visible*; whether to serialise or allow interleaving is explicitly deferred — see §4, DECISION REQUIRED item 1 |
| Ledger becomes noise | Checkpoint-grained `kind` (locked in R4) + filters from day one |
| Realtime transport widens the attack surface on a tailnet-exposed daemon | R8 reuses both existing origin allowlists (daemon + web); security review before P1 ships |
| New route/contract files collide in name with existing unrelated modules | Closed by the closure table in §3.2 — `project-events`/`team-chat`/`TeamMember`, never `attribution`/`Member`/`od chat` |
| Cursors are expensive and least valuable | Sequenced last (P2); R12 offered as the cheap substitute |

### 3.4 Success criteria

Every criterion below is machine-checkable by the paired command. None require a person to
look at a screen and judge it — that judgment, where it exists at all, is moved to the
**Morning review** list at the end of this section, which does not block the run.

1. **Three members seeded, each with a distinct icon and colour.**
   ```bash
   # Requires a running daemon (e.g. `pnpm tools-dev start`). `od daemon status --json`
   # hits GET /api/daemon/status, which returns `dataDir: paths.RUNTIME_DATA_DIR`
   # (apps/daemon/src/routes/daemon.ts:39) — read the real data dir from the daemon
   # itself rather than guessing a path.
   DATA_DIR=$(node apps/daemon/dist/cli.js daemon status --json \
     | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).dataDir))")
   sqlite3 "$DATA_DIR/app.sqlite" \
     "SELECT display_name, color, avatar_url FROM team_members WHERE display_name IN ('Alex','Megan','Dev');"
   # Expect 3 rows, 3 distinct color values, 3 distinct avatar_url values.
   ```
2. **Every new message, comment, and file change is attributed to a named member.**
   Automated: a Vitest daemon test creates a message/comment/ledger-triggering action as each
   seeded member and asserts the resulting row's `author_member_id`/`member_id` matches.
3. **The ledger answers "who changed what, and when," filterable by member.**
   Automated: `GET /api/projects/:id/events?member_id=<id>` returns only rows for that member;
   asserted in the same daemon test as #2.
4. **Pre-existing history is marked `legacy`, never misattributed to a real person.**
   ```bash
   # $DATA_DIR from criterion #1's `od daemon status --json` read.
   sqlite3 "$DATA_DIR/app.sqlite" "SELECT COUNT(*) FROM messages WHERE author_member_id IS NULL;"
   # Expect 0 — every row is either a real member or the seeded 'legacy' member.
   ```
5. **Two members editing the same project concurrently both see the other's changes and
   correct attribution — automated, not a human watching two browser windows.** Replace the
   original "two browsers" criterion with a scripted two-client check: two isolated Playwright
   browser **contexts** (not two manual windows) against the one worker-scoped tools-dev
   daemon (`e2e/lib/playwright/suite.ts`), each with a different seeded `TeamMember` set in
   `localStorage`, both pointed at the same project. Assert context B's SSE stream (R8)
   receives an event with context A's `member_id` after context A performs a tracked action.
6. `pnpm guard`, `pnpm typecheck`, `pnpm i18n:check` exit 0.

**Morning review (non-blocking — does not gate tonight's run):**
- Do the Higgsfield-generated monster avatars actually look distinct and on-brand? (R2 —
  automated check only verifies three distinct files/colors exist, not that they look good.)
- Sign off on the shared-daemon-not-multi-tenant decision (§3.1) before extending this trust
  model past the three-person tailnet.
- Does the checkpoint-grained ledger (R4) feel like the right resolution, or too coarse/fine
  in practice?

### 3.5 Verification

```bash
cd ~/projects/mishmash
pnpm guard && pnpm typecheck && pnpm i18n:check

# Daemon-side unit/integration coverage for the new tables/routes.
# Name the new test files explicitly so this stays scoped as the feature grows;
# do not rely on the bare `pnpm --filter @open-design/daemon test` running everything
# as a proxy for "the new feature passed."
pnpm --filter @open-design/daemon test tests/team-members.test.ts
pnpm --filter @open-design/daemon test tests/project-events-ledger.test.ts

# Playwright UI test — FLAT file under e2e/ui/, imports from '@/playwright/suite',
# matching e2e/playwright.config.ts's `testDir: './ui'` (confirmed at
# e2e/playwright.config.ts:31 — e2e/specs/ is the Vitest tree and Playwright never
# looks there; the original draft's `specs/collaboration-attribution.spec.ts` path
# would not run at all).
pnpm --filter @open-design/e2e exec playwright test -c playwright.config.ts \
  ui/collaboration-attribution.test.ts --project=chromium
```

---

## 4. Open questions for Devin

Genuinely unresolved items only — each scoped so it does **not** block tonight's P0–P2 run.

1. **DECISION REQUIRED (does not block P0–P2; blocks a future concurrency-control phase).**
   What happens if two people prompt the same conversation at once — queue the turns, lock
   the conversation, or let them interleave? R4 ships turn-visibility (`turn.started` /
   `turn.ended` ledger rows) tonight without deciding this; it will come up "the first
   afternoon all three of you are in," per the original note, so it needs an answer before
   P1 chat makes concurrent prompting more likely, not before P0 ships.
2. **DECISION REQUIRED (does not block P0–P2; blocks any future client-facing access).**
   Should clients ever see a project? If yes, that reopens §3.1 (shared-daemon stops being
   viable) and connects to F002's client-facing share link. Out of scope for this finding's
   P0–P2.
3. Shared-daemon vs. multi-tenant (§3.1) is provisionally resolved for tonight's run in favor
   of shared-daemon, per Devin's own recommendation in the original draft — not a new
   invented answer. Needs explicit sign-off before it's treated as final; see the Morning
   review list in §3.4.

---

## Revisions

- 2026-08-18 — captured live during team demo; schema and security model verified against the
  running daemon the same session.
- 2026-08-18 (repair pass, no `F003-audit.md` existed — corrections below are from direct
  repo verification, not an audit handoff):
  - Fixed the Playwright verify command: `specs/collaboration-attribution.spec.ts` does not
    exist and would not run — `e2e/specs/` is the Vitest tree and
    `e2e/playwright.config.ts:31` scopes Playwright's `testDir` to `./ui` only. Replaced with
    the real, flat `e2e/ui/*.test.ts` invocation matching the pattern documented at
    `docs/testing/e2e-coverage/status.md:167`.
  - Added the explicit dual-track closure table (§3.2) mapping every capability to its route
    file, contract file, web surface, and CLI verb, per `AGENTS.md`'s UI/CLI dual-track rule
    — the original draft named the rule's *existence* (implicitly, via R5/R8's UI mentions)
    but never assigned concrete file paths or CLI verbs an agent could act on unattended.
  - Corrected the security-model description: `OD_ALLOWED_ORIGINS` is consumed in
    `apps/daemon/src/origin-validation.ts:52`, not in `security/loopback.ts` as the original
    phrasing implied; `OD_ALLOWED_DEV_ORIGINS` is consumed in `apps/web/next.config.ts:138`
    and `apps/web/sidecar/server.ts:326` — the web app's dev-origin check, not the daemon at
    all. R8 now names both.
  - Corrected "no realtime substrate is a from-scratch build": there is a working one-way SSE
    pub/sub precedent at `apps/daemon/src/plugins/events.ts` +
    `apps/daemon/src/routes/plugins/index.ts:159-169` with a matching CLI at
    `apps/daemon/src/cli.ts:4058-4174`. R8 now names it as the pattern to extend.
  - Flagged three naming collisions the original draft's vocabulary would have walked into:
    `attribution` (already means install/referral attribution —
    `apps/daemon/src/routes/attribution.ts`, `packages/contracts/src/api/attribution.ts`,
    which even has its own unrelated internal "ledger" concept), `Member`
    (`PreviewCommentMember` in `packages/contracts/src/api/comments.ts:46` is a
    preview-comment selection element, not a person), and `od chat`
    (already registered at `apps/daemon/src/cli.ts:900` for agent Side Chat forking, handler
    `runChat` at line 8388).
  - Resolved the "keystroke-level vs. checkpoint" ledger-depth open question into a locked
    R4 requirement (checkpoint-grained), using the original draft's own stated recommendation
    rather than inventing a new answer — an unresolved question is a blocker for an
    unattended run; a stated-but-unadopted recommendation is not new information withheld.
  - Rewrote success criterion #5: "two browsers, two different members... both see the
    other's changes" requires a human watching two windows and cannot complete overnight.
    Replaced with a scripted two-Playwright-context check against the shared worker-scoped
    tools-dev daemon, asserting on the R8 SSE stream directly.
  - Split every remaining criterion with a plausible human-judgment component (avatar
    aesthetics, final sign-off on the shared-daemon trust model, ledger granularity feel)
    into a separate non-blocking "Morning review" list, per the no-human-gates rule.
  - Resolved the self-contradiction in the original §3.1 ("must be answered before any
    implementation" immediately followed by "the rest of this PRD assumes it"): tonight's run
    proceeds under the shared-daemon assumption as a provisional decision, explicitly flagged
    for morning sign-off rather than treated as either fully open (blocking) or fully closed
    (silently unreviewed).
  - Re-scoped the two DECISION REQUIRED open questions (concurrent-turn handling,
    client-facing access) to name exactly which future phase each blocks, confirming neither
    blocks tonight's P0–P2.
  - No numeric claims (file/row/test counts) were present in the original draft to begin
    with; none were introduced in this pass — every fact above is either a file:line citation
    or a paired verify command.
  - Success criteria #1 and #4's verify commands now resolve the SQLite data directory
    through `od daemon status --json` (confirmed route: `GET /api/daemon/status` returns
    `dataDir: paths.RUNTIME_DATA_DIR` at `apps/daemon/src/routes/daemon.ts:39`) instead of a
    guessed `require('./dist/daemon-paths.js')` import whose export shape was never checked.
