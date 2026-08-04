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

**Execution status, 2026-08-03 (live).** Every item below was dispatched as an
isolated worktree agent under the repo's red-spec-first bug workflow, then
adversarially reviewed (reviewer ≠ author) before landing via `zs-land`.

| Item | Disposition |
|---|---|
| BUG-3 | **LANDED — PR #42** (`831d03e2b`). Allowlist already deleted by #39; this closed the remaining gap (per-model "(needs API key)" hint matching the storyboard idiom). react-reviewer APPROVE. |
| final.mp4 clobber | **LANDED — PR #43** (`3a374d41e`). Per-run `final-<id>-<uuid>.mp4`; `Storyboard.finalOutput` persisted under the write lock. typescript-reviewer APPROVE. |
| MCP spawn-injection https gap | **LANDED — PR #44** (`6da960b35`). https-or-loopback enforced at the token↔URL pairing; per-pairing withholding + `mcp_spawn_token_refused` diagnostic. security-reviewer APPROVE after 2 fixes (fail-closed on missing url; IPv4-mapped-IPv6 canonical form). |
| render.ts cancelTimer tie | **LANDING — PR #45** (`c523af00c`). Two racing timers collapsed into one settle-once gate. typescript-reviewer APPROVE (verified the red spec fails against pre-fix code). |
| BUG-10 | **LANDED — PR #52** (`21b3f4682`). Typed taxonomy (invalid-credential / rate-limited / upstream-error) at the shared provider boundary. typescript-reviewer APPROVE after 1 fix (the Google 400-body sniff ran against every provider, incl. OpenRouter-proxied backends). Secret-leakage audit clean. |
| BUG-5 / BUG-6 | **LANDED — PR #53** (`2435edb2e`). Three review rounds. Round 1: both reviewers BLOCK, 9 findings. Round 2: BLOCK again — the verification pass found a regression the fix round itself introduced (`loadingMore` stuck forever after a superseding load), proved the tie test guarded nothing by reverting the fix and watching it still pass, and benchmarked the `a.id ASC` tiebreaker as an 85–195× slowdown at offset 250k (temp B-tree). Round 3 fixed all four with EXPLAIN plans, benchmarks, and revert-and-rerun proofs; the index now covers the full sort key. CI then caught two obsolete specs asserting the old gated-off Library behavior — updated to the new truth. |
| BUG-7 | ~~Dead `/brands` round-trip~~ **Already closed by PR #39** (squash `6bd161f10`, 2026-08-02) — verified 2026-08-03: BrandsTab deleted, redirect kept, `EntryShell.brands-removal.test.tsx` green on main |
| OBS-2 | ~~Storyboard detail route~~ **Already closed by PR #39** (same squash) — verified 2026-08-03: `/storyboard/:id` parse/build in router.ts, StoryboardSection navigation/back/unknown-id fallback, OBS-2 tests green on main |

**Recorded follow-ups** — surfaced by review, deliberately out of scope of the PR that
found them, now filed as issues so they outlive this plan:

| Issue | From | Scope |
|---|---|---|
| [#46](https://github.com/wiggdevin/mishmash/issues/46) | PR #44 | Consolidate the four hand-rolled loopback predicates behind one helper (lexical vs DNS-resolving variants made explicit) |
| [#47](https://github.com/wiggdevin/mishmash/issues/47) | PR #43 | Per-run naming for concat-mode's `.storyboard-concat-<id>.txt` (residual same-storyboard race) |
| [#48](https://github.com/wiggdevin/mishmash/issues/48) | PR #44 | Coverage for the `mcp_spawn_token_refused` SSE wiring; collapse its duplicate warn |
| [#49](https://github.com/wiggdevin/mishmash/issues/49) | PR #43 | Retention sweep for accumulated per-run assemble outputs; define stale-`finalOutput` behavior |
| [#50](https://github.com/wiggdevin/mishmash/issues/50) | PR #42 | `group.ready` is an auto-select gate, not a display predicate; plus an option-level no-key test |

## Workstream 3 — Wave program to done

Dependency-ordered; every wave keeps the repo's loops (red-green-review,
reviewer ≠ author, verifier + proof manifest per VERIFICATION-CONTRACT.md).

1. **Reconcile the master tracker** (`mishmash-completion` 8/14): t7 (W1+W2) and
   t8 (W4 verifier/W9-ingest) look land-complete per today's merges — verify and
   close their statuses against proof manifests.
2. **W4 gate ruling — RESOLVED 2026-08-03.** Devin authorized option A explicitly
   ("yes please do it all for w4"). The fidelity round had in fact already been
   executed: confirmation #3 returned **APPROVE** at `37df4641e`
   ("the intermittent-polling bypass is closed load-bearingly"), and the unpark merge
   train landed that verifier blob on main. Remaining preconditions:
   - **Scale-baseline re-freeze:** canonical walk recomputed 2026-08-03 →
     `2828f6176a44c8f50e1ebc32ad44d953ef2b512085f48e580fbfd514b10832c7`
     (2,849 files / 1,142,043,038 bytes — unchanged; matches the digest the
     confirmation reviewer independently computed, i.e. zero drift since the fifth
     freeze). **RESTATED 2026-08-03** (sixth restatement written to
     `docs/testing/scale-baseline-2026-07.json` while Devin was active at the
     keyboard; digest re-verified unchanged immediately after the edit). C4-10's
     fail-fast digest precheck is unblocked.
   - **W4 implementation** on `feat/w4-covers-impl` (worktree
     `.claude/worktrees/w4-impl`), 7 commits / 31 files / ~2,350 lines. **NOT LANDABLE
     YET** — two independent gates both came back negative:

     **(a) Real verifier run, 2026-08-03: 10/15 pass**, treeDirty=false,
     MANIFEST_SHA256=`50f0da5777638d7f6f22d2b14699f241df9d56c6103b5646fb8f419b26614964`.
     GATE-INTEGRITY / LEASE / HEAD-DRIFT pass. Failures: C4-1 (no card surface renders
     an `<img>` against a cover URL), C4-3 (invalidation is entry-hash-only, not
     transitive), C4-4 (not content-driven in both directions), C4-8 (NM-35C note
     missing), C4-10 (corpus digest — founder-blocked, see above).
     **Note:** the implementing agent self-reported C4-1/C4-3/C4-4 as PASS from
     reproduction rather than a gate run. Always run the gate; treat it as the oracle.
     **Also note:** that agent's claim that C4-8 was lease-blocked is FALSE —
     `docs/security/**` is leased to W0 and W9-ingest (both landed) and the run's own
     LEASE check passed.

     **(b) Adversarial security review: BLOCK, 6 findings — and the two CRITICAL ones
     PASS THE SEALED VERIFIER.** This is the load-bearing lesson of the wave: a green
     gate is not sufficient evidence.
     1. **CRITICAL — arbitrary local-file disclosure.** The renderer's dead proxy +
        host-resolver rules constrain only the network stack, not `file://`. Hostile
        project HTML can reference or self-navigate to any local file the daemon can
        read; the screenshot bakes it into a cover the daemon then serves over HTTP.
        C4-6's canary only watches an HTTP listener, so the gate blesses it.
     2. **HIGH/CRITICAL — path traversal** on `GET /api/projects/:id/cover`: raw
        `req.params.id` reaches `path.join` with no `isSafeId`/existence check
        (the sibling POST handler does it correctly). Untested by gate or specs.
     3. HIGH — `playwright` added to apps/daemon but CI's `daemon_full_tests` has no
        Chromium provisioning (passed locally only on a warm e2e browser cache);
        `deploy/Dockerfile` is Alpine/musl and can't run downloaded Chromium.
     4. MEDIUM-HIGH — the new `/raw/*` CSP (`connect-src 'none'`) may break same-origin
        `fetch()` in the file viewer's primary multi-file preview path.
     5. MEDIUM — `execFileSync('ps')` polling blocks the daemon event loop (150ms × up
        to 4 concurrent jobs).
     6. MEDIUM — no orphan reaper if the daemon dies mid-render (contrast
        `previews.ts`'s process-group discipline).

     Confirmed solid by the same review: the iframe→`<img>` swap genuinely satisfies
     S4-5; DesignsTab's bounded fan-out avoids the stale-response/loading-flag bug class
     the library PR hit; the FIFO limiter is leak-free; `hash.ts` is content-driven with
     its own containment check.

     **(c) Remediation round complete, 2026-08-03 (11 commits on the branch, pushed).**
     Security findings: 1 fixed (project-root-scoped loopback file server +
     realpath containment + route-allowlist, with a planted-secret regression test);
     2 fixed (isSafeId + existence on GET /cover, regression test); 5 fixed
     (promisified execFile + re-entrancy guard); 6 fixed (PID-marker registry +
     startup sweep guarded against PID reuse). 3 verified-not-fixed (CI has no
     Chromium provisioning; Dockerfile is musl — outside the W4 lease, reported).
     4 kept as-is deliberately: the sealed verifier requires `connect-src 'none'`
     verbatim, a real product-vs-security tension recorded for a joint ruling.
     Gate re-run twice, identical: **9/15**,
     MANIFEST_SHA256=`3bdb1b876e230335485c975dd9aceb2b42dc858bdf3a194a4c9eee92951c1105`.
     The three persistent implementation-side failures were proven **unsatisfiable by
     any correct implementation**: C4-1 (verifier's ancestor walk tests
     JsxOpeningElement against a parent chain that only ever contains JsxElement —
     confirmed independently by the orchestrator from source), C4-3/C4-4c (verifier
     "edits" re-upload same-named files; the product's `uniqueUploadFileName`
     deliberately saves `name-1.ext` instead of overwriting, per its own test). C4-5
     failed only its memory-ceiling leg, flaky (7/7 clean standalone reproductions).
     C4-8 needs `docs/security/**` added to W4's lease (LEASE reads
     leases.json@baseCommit — the earlier "lease-blocked is FALSE" note in (a) was
     itself wrong; the agent proved it empirically by watching LEASE go red). C4-10 is
     unblocked by the sixth baseline restatement.
     **Gate-defect amendment round opened per the W0 escalation-ceremony precedent:**
     patches + ruling drafted in the session scratchpad (`w4-amendment/`), independent
     adversarial review launched. The machine permission classifier default-denies
     agent writes to `verify-w4.ts` / `leases.json` — respected; application is the
     founder's hand via `apply-w4-amendment.sh` after the review verdict.
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

- Master tracker reconciled 2026-08-03: t7 (W1+W2) closed against the unpark merge
  train + the verifier sweep on merged main; t8 recorded as verifiers-complete, with
  W4 *product* implementation split out as separate in-flight work.
- Stray `~/package-lock.json` (the Next.js workspace-root confuser behind B2's EMFILE)
  moved to `~/Inbox/deletions/package-lock.json.from-home-2026-08-03` — staged, not
  deleted, per the reviewed-deletions convention.
- ENV-1: **RESOLVED 2026-08-03.** Stored vault key probed `API_KEY_INVALID`; root cause
  was the key having been deleted upstream (AI Studio key list was empty). New key minted
  in Devin's real Chrome (devszerosum@gmail.com, project `posture-ai-499202` / Posture AI),
  smoke-tested 200 in memory, saved via `zsvault edit google_api_key --value-stdin`
  (committed + pushed), stored value re-read and re-probed 200. Persistence verified:
  `export GOOGLE_API_KEY=` present in `~/.config/zs-api-keys.env` and resolves in a fresh
  login shell. Dev servers were already stopped, so the next `pnpm tools-dev` start
  inherits the new key. Clipboard cleared after save. Runbook (now historical):
  `~/Inbox/notes/handoffs/ENV-1-google-api-key-rotation.md`.
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
