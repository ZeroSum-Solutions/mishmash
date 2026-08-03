# Completion execution plan — finish and push all unfinished work

**Created:** 2026-08-03 · **Owner:** Devin (founder) · **Driver:** Claude Code session
**Directive:** Devin, 2026-08-03 — "completely finish and push all the unfinished work,
including the deferred bugs," plus fix the in-app browser defects, to reach a state he
can show a team.
**Sources of truth:** `docs/plans/waves/NM-REGISTER.md` (item IDs),
`docs/plans/waves/README.md` (wave map/gates), `docs/decisions/unpark-2026-08-03.md`
(today's merge train), the `mishmash-video-program` goal-run summary (deferred bug
list), this session's verifier sweep, and the live browser-bug investigation below.

## Where main stands (evidence, 2026-08-03)

- 39 PRs merged, 0 open. Today's merge train landed every remaining wave branch;
  `feat/w1-routing-truth` confirmed superseded (not merged, deliberately not deleted).
- Verifier spot-sweep: W0, W1, W2, W7, W-C, W9-ingest exit clean. W8 fails with
  "Selector product surface not implemented yet." W9-external-fetch, W9-agent-spawn,
  W10a, W10c fail only pre-landing lease checks — PRDs landed, implementations not
  started. The per-wave proof manifests under `~/.claude/goal-state/mishmash-*/proof/`
  remain the gate of record.
- The storyboard/video program is complete (14/14, PR #36 + #39, full CI green).

## Workstream 1 — Browser defects (first, founder priority)

Two distinct root-caused defects, both reproduced live this session:

**B1 — Design Browser blank pane (web Studio).** The feature was built and verified
against the removed Electron shell (`design-browser-task-handoff.md`). In the web
Studio `isOpenDesignHostAvailable()` is always false, so `DesignBrowserPanel` renders
a plain cross-origin `<iframe>`. Frame-permitting sites render (verified:
example.com). Sites sending `X-Frame-Options` / CSP `frame-ancestors` — most of the
curated reference list — silently show a white void (captured console: "Refused to
display 'https://gsap.com/' in a frame because it set 'X-Frame-Options' to
'sameorigin'"). Capture/DOM tooling is additionally `desktopHostAvailable`-gated off.
There is zero e2e coverage of this surface.

Fix shape (red spec first, repo bug workflow):
1. Daemon frame-embeddability preflight (narrow endpoint; response headers only;
   honors the pinned loopback carve-out from PR #36 — no general external-fetch
   surface, that is W9-external-fetch's scope).
2. Blocked-site UX: explicit banner state in the panel ("this site refuses
   embedding") with working actions — Open in Browser (exists) and, when the capture
   lane lands, Capture snapshot. No more silent white pane.
3. Gate or wire the desktop-only affordances so web mode never shows dead controls.
4. Add the missing e2e spec for the panel (launcher → navigate → blocked/allowed
   states).
Full remote-capture (screenshot proxy for blocked sites) belongs to W6b
(NM-22C capture isolation service) — do not smuggle it in here.

**B2 — issue #38, preview lifecycle.** Generated-app previews are owned by the
agent's shell and die with the turn; the agent reports "live" without a
reachability check; Next.js infers the workspace root from a stray
`~/package-lock.json` (confirmed present, no sibling package.json) and exhausts
file watchers (EMFILE). Fix shape per the issue's acceptance criteria:
1. Daemon-managed preview process lifecycle (survives the tool call; stop/status
   surfaced; UI/CLI dual-track per AGENTS.md).
2. Reachability verification before any "preview is live" claim.
3. Scope Next workspace discovery to the generated app (pin root in the generated
   config; do not rely on the operator's home directory being clean).
4. Founder note: the stray `~/package-lock.json` (14 KB, 2026-07-27) looks like an
   accident; deleting it is Devin's call and mitigates globally, but the product fix
   above must not depend on it.

## Workstream 2 — Deferred bugs (video-program run, each its own red spec + PR)

| Item | Scope |
|---|---|
| BUG-5 / BUG-6 | Library pagination + its hidden UI |
| BUG-7 | Dead `/brands` round-trip |
| BUG-10 | Provider-error taxonomy (invalid key must not read as generic upstream 400) |
| OBS-2 | Storyboard detail route |
| MCP spawn-injection https gap | Enforce https-or-loopback on token-bearing MCP spawn URLs (`mcp-config.ts`, `run-tool-bundle.ts`, `server.ts`); contract specs pinned in PR #36 |
| final.mp4 clobber | Per-run output naming or lock |
| render.ts cancelTimer tie | Deterministic deadline behavior |
| BUG-3 | Needs a per-route capability-surface decision first (founder or delegated) — then implement |

## Workstream 3 — Wave program to done

Dependency-ordered; every wave keeps the repo's loops (red-green-review,
reviewer ≠ author, verifier + proof manifest per VERIFICATION-CONTRACT.md).

1. **Reconcile the master tracker** (`mishmash-completion` 8/14): t7 (W1+W2) and
   t8 (W4 verifier/W9-ingest) look land-complete per today's merges — verify and
   close their statuses against proof manifests.
2. **W4 gate ruling — needs Devin's one line.** `FOUNDER-DECISION-NEEDED.md`
   (2026-07-28) offers A (one more scoped fidelity round on the 4 residual verifier
   bypasses — reviewer-recommended) or B (overrule + pin). Devin's 2026-08-03
   "finish everything" directive is treated as **authorizing option A** unless he
   objects. Then: re-freeze the stale scale-baseline digest → W4 implementation →
   land.
3. **W3 library dark-launch** (gates: W4 ✓-pending + W9-ingest ✓ landed today).
   NM-07 is an epic (7 gates / 6 files), includes BUG-5/6 overlap — coordinate with
   Workstream 2 so pagination lands once.
4. **W5–W11 expansion gate (NM-41C):** each skeleton needs an independently-reviewed
   PRD expansion frozen before implementation. Order by product value:
   W6a (Client Website flow) → W6b (capture isolation; unblocks B1's capture lane;
   gated on W-C ✓ + W9-external-fetch) → W8 (Selector build — the flagship epic;
   W7 foundations are green) → remaining W9 tranches (re-expand on the
   runtime-observation pattern the decision log binds) → W10 slices (a/b/c/f
   re-expansions per their park records; d/g scoped fresh).
5. **Program gate:** write `scripts/waves/verify-program.ts` (t11) and run it over
   all wave manifests.
6. **W11 stays deferred by default** (NM-01/NM-03 founder ruling already recorded).

## Workstream 4 — Housekeeping

- ENV-1: rotate the invalid `GOOGLE_API_KEY` (Devin; ZS Vault).
- Branch/worktree cleanup decision: delete superseded `feat/w1-routing-truth` +
  ten merged worktrees under `mishmash-worktrees/` (needs Devin's explicit OK —
  destructive-git rule).
- Close the loop: update the master tracker, refresh the stale cross-session memory
  record (main is unfrozen; video program complete), and record this plan's
  completion state.

## Sequencing and landing discipline

- WS-1 B1 → B2 first (founder priority, demo-visible), WS-2 items in parallel as
  isolated PRs, WS-3 serially behind its gates.
- One feature = one branch = one squashed PR; `pnpm guard` + `pnpm typecheck` +
  package-scoped tests before every land; adversarial review per repo policy on
  wave landings; auto-land via `zs-land` (owned repo) only on green.
- This plan sequences to done; W8 and the W5–W11 expansions are epics — they land
  wave by wave, not in one push.
