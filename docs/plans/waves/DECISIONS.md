# Founder decision records — mishmash-completion program

Program scaffolding (deleted with `scripts/waves/` at program close). Each entry is the binding
record for a decision listed as open in `GLOBAL-GOAL.md` §Founder decisions or raised during the
run. Severity/scope changes cite these records per `VERIFICATION-CONTRACT.md` §3 R6/R7.

## 2026-07-27 — Devin (founder), in-session

| ID | Ruling | Provenance |
|---|---|---|
| NM-03 / NM-01 | **KEEP** internal identifiers (`od`, `OD_*`, `.od/`, `SERVER_NAME`) and the `@open-design/*` scope. W11 (namespace & fork ops) will not fire. C0-12 stored-identity inventory still runs (inventory-only, per W0 PRD). | Founder direct; aligns with both auditors' HIGH recommendation |
| NM-24 | **Seam only**: MishMash↔Instatic integration stays at the MCP server + Super Import boundary. Deeper coupling rejected (fork-pin maintenance surface, no repo references today). W10a scope pinned accordingly. | Founder-delegated to GPT-5.6 Sol; verdict adopted per founder instruction ("use GPT to help make a decision and go with that") |
| NM-21 | **Library embeddings only** for memory scope. No managed-RAG evaluation. W5/W10e pinned. | Founder direct |
| NM-25 | **Register the VoiceBox MCP and stop.** No voiceover workflow scoping. W10b pinned to registration. | Founder direct ("only register the MCP") |
| NM-29 | **Formally closed, no code change.** The `t4-scroll` scroll-speed symptom has no reproduction anywhere in the tree, history, or docs; `fix/clone-preview-marquee-speed` contains zero unique commits (stale ancestor of main); three rounds of W-C hardening have since landed on the same code path. Reopen only on a concrete sighting, with a red spec in `apps/daemon/tests/web-clone-*.test.ts`. | Founder: "go ahead and complete it"; disposition from read-only investigation 2026-07-27 |
| NM-30 | **Ratified.** The clamp-aware mirror-width baseline override (`gate-decision.mjs` `expectedScrollWidth` vs raw baseline, 5% tolerance retained; documented in `skills/web-clone/SKILL.md` clamp-vs-baseline contract) is accepted as shipped. Revert path if ever rejected: restore strict raw-baseline comparison in `gate-decision.mjs`/`mirror-site.mjs`. | Founder: "go ahead and complete it" |
| NM-31 | **Closed as no-op.** The `od2-debloat` worktree does not exist on this machine (exhaustive search: repo worktrees, local + remote branches, reflog, home depth-2). Nothing to delete. If it exists on another machine, deletion is separately authorized there after an unlanded-work inspection. | Founder authorized deletion; target absent |
| NM-33 | **Membership stays print-mode.** ~$100 Moonshot Open Platform API credits purchased 2026-07-27; verified non-transferable to Kimi Code/Kimi+ subscriptions (separate wallets, non-refundable ToS updated 2026-05-27). Credits to be consumed via the approved Kimi K3 API lane. W1's silent-success guard proceeds unchanged. | Founder purchase + delegated carryover check |
| W-C mask ruling | **Keep the widened opaque-span mask** (landed in `f0c4bda56`). The stricter revert-unquoted-rewrite alternative is declined: CC-6 requires unquoted URL-attribute coverage, tests prove the mask's correctness, and its failure mode is one-sided (under-rewrite fails the verify-mirror gate loudly). Supersedes the "founder may swap" note in the W-C close-out summary. | Founder-delegated to GPT-5.6 Sol; verdict adopted |
| Standing directive | Autonomous continuation of the program authorized end-to-end ("continue on our goal, never stop for anything"). Blockers are surfaced in summaries, not waited on. `human:` criteria still resolve to `blocked-on-founder` per contract §3 R7 — this directive does not convert them to mechanical passes. | Founder direct |

## Sequencing waivers already in force

- **CC-11 / W-C landing order** (2026-07-26): W-C's "lands after W0" precondition waived by
  founder instruction before this program run started; recorded in
  `~/.claude/goal-state/mishmash-wc-clone-closeout/run.log.md`. W-C-only — every other wave
  still lands after W0 per `GLOBAL-GOAL.md` rule 1.

## 2026-07-27 — W7 gate escalation: two-phase gate (orchestrator ruling under standing directive)

Three consecutive non-APPROVE verdicts on `scripts/waves/verify-w7.ts` triggered the
`VERIFICATION-CONTRACT.md` §6 stop rule. Resolution adopted via the founder's delegated
decision procedure (GPT-5.6 lane tiebreaker, ADOPT-WITH-CHANGES; verbatim record in the wave's
goal-state reviews/):

1. **Preflight gate** — scoped mechanical fix (F11/F13/F14/F16/F17/F18/F19), re-reviewed, then
   pinned as an approved out-of-repo copy. Preflight authorizes W7 implementation to start; it
   cannot declare W7 complete.
2. **Completion gate** — C7-2/3/5/6/7/8/9 additionally require commit-bound reviewer records at
   `docs/specs/selector-reviews/<finding>-disposition.json` in which one Sol-lane and one
   Grok-lane review each explicitly dispose findings F2/F4/F6/F7/F8/F9 (verbatim text) with
   APPROVE. Structural checks remain necessary-but-insufficient. Severity stays reviewer-owned;
   nothing was closed by fiat.
3. **F18** (contradiction between seal content-binding and freeze-descendant ancestry) confirmed
   real; corrected to: sealed blob content equals `sealCommit^` content and its defining commit
   precedes the seal commit.
4. **W8** starts only after the final approved-copy gate pass, both reviewer approvals, and the
   C7-16 founder go/no-go.

Founder may veto or amend; surfaced in session summaries when adopted.

## 2026-07-27 — W0 gate escalation: product-surface gate (orchestrator ruling under standing directive)

Three consecutive non-APPROVE verdicts on `scripts/waves/verify-w0.ts` triggered the §6 stop
rule. Re-plan (consistent with the W7 two-phase precedent; founder may veto): the gate drops all
probe intermediaries for backup/restore/token criteria and instead invokes the product's own
surfaces (`od backup`/`od restore` CLI + daemon endpoints — mandatory under UI/CLI parity),
observing all evidence independently. Pre-implementation, these criteria fail with named missing
surfaces. Implementation-coupled semantic checks (rotation/revocation behavior) activate when
the surfaces exist and assert semantics, not status codes. Remaining round-3 findings closed
mechanically in the same rewrite.

## 2026-07-27 — W7 held-out corpus RE-SEAL (orchestrator decision record under standing directive)

The gate's frozen-path rule requires a re-seal to carry "a NEW seal commit and a founder
decision record." This is that record; the founder may veto. Grounds: three corpus-generator
defects made the originally-sealed payloads permanently fail mechanical criteria (hardcoded
`breakpoint` fields defeating the C7-4 derangement control; a shared style preset and JSON
boilerplate producing byte-identical spans that tripped the C7-11 leak scan as false positives).
Threat-model assessment: W8 has not started; no scoring or tuning has consumed the sealed cases;
the corrections were authored by the same agent that legitimately authored the originals
pre-seal; the frozen-path invariant was verified intact (zero post-seal touches) before
re-sealing. Ceremony: v2 blobs commit `5abb5e357` (all 10 payloads hash-verified + round-trip
decrypted), new seal commit `d8caf813d` (SEALED-ACCESS.md v2). v1 plaintext retained in
orchestrator-owned storage for provenance.

## 2026-07-27 — W0 gate F7 closure: orchestrator unreachable-allowlist (escalation ruling under standing directive)

A fourth consecutive non-APPROVE post-re-plan (findings 13 → 4 → 1 → 1) re-triggered the §6
stop rule on `scripts/waves/verify-w0.ts`. No author/reviewer disagreement — pure closure design
for F7 (free-text `unreachable` reasons are filler-gameable; a ≥20-char check accepts twenty
x's, and with two dynamic rows one skip is exactly half, under the strictly-more-than-half
majority gate). Founder-delegated GPT-5.6 tiebreaker ruling (verbatim in the wave's goal-state
`reviews/f7-escalation-ruling.txt`): **Candidate B, ADOPT-WITH-CHANGES** —

1. A dynamic privileged-route row may skip live probing ONLY when an orchestrator-owned,
   out-of-repo allowlist entry authorizes it. The allowlist path is supplied by the orchestrator
   at gate run time; **fail-closed** — no allowlist supplied or file absent ⇒ zero skips allowed.
2. Each entry binds exactly to `{file, line, method, path}`, a source-line fingerprint
   recomputed from the tree at gate run, and the authoring repository commit. Entries must match
   unreachable-claiming rows **1:1** — duplicate, stale (fingerprint or row mismatch), or unused
   entries hard-fail the criterion.
3. Implementation-authored free text is surfaced as evidence but never authorizes a skip.
4. Majority gate tightened: hard-fail when unreachable × 2 ≥ total dynamic rows (nonempty set).

Rationale (tiebreaker, compressed): free-text length is evidence formatting, not authorization
(thresholds-only fails the lazy/opportunistic standard); deleting the category pressures
invention of fake probe paths; the allowlist extends the already-accepted orchestrator trust
anchor (approved-copy execution, W7 disposition records). Founder may veto; surfaced in session
summaries.

## 2026-07-27 — W7 completion-gate amendment: dual GATE-DEFECT ruling executed (record)

Both review lanes independently ruled C7-2's `latestCommitTouching(CORPUS.md)` freeze anchor a
GATE-DEFECT (Sol HIGH: "bind an explicit immutable freeze commit/hash or a separate immutable
freeze-anchor artifact"; Grok MEDIUM: "same-commit allow or hash-only freeze is the honest fix,
not commit-gaming"). Under the two-phase gate ruling's provision for completion-gate
strengthening with re-review, a scoped amendment (5 commits, `dcb3a7242..6e2de6e7a`, confined
to `scripts/waves/verify-w7.ts`) delivered: (1) per-case freeze anchor — brief content
hash-bound to manifest `briefSha256`, brief-touching commit same-as-or-ancestor-of the case's
IR-touching commit; (2) fixture builders emitting full v3 evidence (real styleFingerprints,
`transition:<N>ms` motion, claim-matching breakpoints); (3) C7-8 semantic trios plus a
load-bearing label-only negative control; (4) C7-6 within-case wrong populations load-bearing;
(5) C7-12 asserts sha256(floors.json) ==
`15701d8a345d34bec14e08a9ac987ed8c3ab03523cd6a51849f8c2ec9eca7965` (orchestrator-pinned frozen
floors). Sol confirmation review: APPROVE, zero findings. Approved out-of-repo gate copy
re-pinned at `6e2de6e7a` (sha `2d0c31364784f2d75e33c34af6ef35e9ea0ab50dfbf29cdead19a3ba174eedf5`),
superseding the preflight pin at `b4bb0f59f`. Independent corpus audit (fresh agent, zero prior
W7 involvement): round 1 at `dcb3a7242` — 6/8 non-sealed cases PASS, 2 FAIL with concrete
fabrication-class defects; remediation landed (`20ae346f7`, `8373e1d83`); round-1 report
archived in orchestrator goal-state, sha256
`b672f6a0c1cc510b47d3c475165ce4b76d185a845ff2bdd362d25711eeb2864a`. Founder may veto.

## 2026-07-27 — W0 lease amendment: `cli.ts` + `origin-validation.ts` (orchestrator ruling under standing directive)

The W0 PRD requires `od backup`/`od restore` registered via `SUBCOMMAND_MAP` in
`apps/daemon/src/cli.ts`, and the product-surface gate ruling makes the CLI chain load-bearing
for C0-1..C0-4 — but `leases.json`'s W0 entry omitted `cli.ts` (a drafting gap; W1/W3/W4 grant
it, and none of them run concurrently with W0 — W0's only burst partner is W7, which cannot
touch daemon code). Additionally, the only capability-token mint path
(`POST /api/library/pair/confirm`) is 403-blocked for genuine `chrome-extension://` origins by
the global origin gate in `apps/daemon/src/origin-validation.ts` — a pre-existing product bug
(reproduced with curl on unmodified code; `library.ts`'s own comment claims the exemption
already exists) that makes the sealed gate's C0-5/C0-6 mint probe structurally unable to run.
Ruling (VERIFICATION-CONTRACT §4-consistent, structurally required by stated criteria):
W0's allow list gains exactly two entries — `apps/daemon/src/cli.ts` (one-line SUBCOMMAND_MAP
wiring) and `apps/daemon/src/origin-validation.ts` (minimal allowlist addition of
`pair/confirm`, restoring the behavior `library.ts` already documents). Both changes remain
subject to adversarial review like all wave work. Founder may veto.

## 2026-07-27 — W0 gate adjudication: C0-7/C0-10 GATE-DEFECT, C0-11 IMPLEMENTATION-DUTY (reviewer-of-record ruling)

The W0 implementation agent stopped on three structural conflicts with the sealed gate instead
of working around them. GPT-5.6 Sol (the gate's reviewer of record) adjudicated by reading the
gate source and the in-repo evidence: **C0-7 = GATE-DEFECT (BLOCKER)** — the gate demanded
origin-less rejection while its own C0-1 chain (and the local CLI) require origin-less success;
amendment scope: the live-rejection probe sends an explicitly hostile browser Origin, plus a
separate origin-less local-success canary; no shared-middleware rewrite. **C0-10 = GATE-DEFECT
(BLOCKER)** — the gate's live-sample probe sent no POST bodies, could not represent
Express-`.all()` routes, and byte-compared legitimately reshaped/unordered output; amendment
scope: schema carries equivalent HTTP bodies, ALL registration + concrete probe method/path,
and declared canonicalizers/comparators; implementation duty survives only where the schema
explicitly declares ordered output. **C0-11 = IMPLEMENTATION-DUTY (BLOCKER)** — a deterministic
`pnpm guard` check (manifest shape + CLI-set parity + attributable unmanifested-route
detection), NOT the random live sampler, which would false-fail ~84% for unrelated changes.
Amendments go through the standard reviewed-amendment procedure with re-pin. Founder may veto.

## 2026-07-27 — W7 F9 stop-rule escalation: one scoped round authorized (tiebreaker ruling)

Decision-round outcome at `8373e1d83`: Grok approved all five pinned findings; Sol approved
F2/F6/F7/F8 and rejected F9 (evidence gate not axis-specific: arbitrary non-empty
motionSignature cleared coverage at 0.707 without style evidence; same root as still-open N1;
N4's scopeOverlap/state partially open). Dispositions F2/F4/F6/F7/F8 are written (dual-approved
with receipts). The stop rule fired (third consecutive Sol non-APPROVE, fix-round cap
consumed); the founder-delegated tiebreaker ruled **Option A**: exactly one additional round
limited to (1) per-axis evidence-kind requirements in the scorer, (2) scopeOverlap-aware
conflict grouping, (3) explicit captured-state matching; both lanes then confirm ONLY those
items; F9 is disposed only on dual APPROVE; any non-APPROVE or out-of-scope finding goes
directly to the founder with no further implementation rounds. Founder may veto.

## 2026-07-27 — W0 final gate adjudication: subprocess isolation + typed allowlist classes + probe upgrades

Adjudicated (founder-delegated, vetoable): **Q1 CONFIRMED-DEFECT** — every C0-10 od-CLI
subprocess must receive `OD_DATA_DIR` bound to the booted isolated daemon's own dataDir plus
`OD_DAEMON_URL`, with a regression proving no launch can resolve to `<repo>/.od`; restore
product behavior unchanged. **Q2 per-case**: canary-unreachable → typed ALLOWLIST class waiving
only the origin-less success canary per bound row (all structural checks mandatory,
strict-less-than-half cap); mcp → typed ALLOWLIST sampling-exclusion (set-equality/structural
mandatory, capability stays applicable); artifacts → PROBE-UPGRADE (gate-owned nonce binding,
read-after-write both surfaces); figma → PROBE-UPGRADE (manifest-declared multipart with a
gate-owned known-good `.fig` fixture). Implemented across `29b9db9cd`→`0bd9de3b1` under
adversarial confirmation. Archived: goal-state reviews/final-adjudication-isolation-exceptions.txt.

## 2026-07-27 — Founder decisions (interactive): W7 F9 micro-round AUTHORIZED; C7-16 = GO

Per the F9 escalation ruling's terminal condition (split confirmation → founder), the founder
chose **"Authorize micro-round"**: one scoped fix converting style-evidence gating from
presence to verification against the resolved node's real evidence, then dual Grok+Sol
confirmation; F9 disposed only on dual APPROVE. Separately the founder decided **C7-16 = GO**:
build the selector feature on W7's foundations, recorded in `docs/specs/selector-go-no-go.md`
(spike evidence hashes therein); selector product work is greenlit for a later wave — not W7.

## 2026-07-27 — C0-10 escalation ceremony: ORCHESTRATOR-ANCHOR CLOSURE (stop-rule tiebreaker)

The adjudicated-round confirmation loop hit the stop rule (r1: 3 findings, r2: 1, r3: 2 — all
REJECT). The founder-delegated adjudicator ruled **orchestrator-anchor closure with fail-closed
admission proof**: the gate of record executes ONLY the out-of-repo approved copy bound to the
reviewed commit and SHA-256 — never the repository copy; hash mismatch/path substitution/
unreviewed amendment refuse BEFORE the verifier executes. No change to `verify-w0.ts`; pinned
at `0bd9de3b1`, sha256 `16265250c7e7cd2b3fa8906e5bda32e0f2b6113db3b38fbe5155f079a57ce564`. The
in-file audit and scans remain defense-in-depth; no runtime interception, no scan-widening.
Sol's r3 findings 1 and 2 are **OVERRULED** — each requires amending reviewed verifier bytes,
which cannot reach the pinned artifact without a fresh adversarial confirmation and re-pin;
that is a compound trust-anchor failure outside the calibrated lazy/opportunistic threat model.
Proof obligations (launcher refusal test, repo-mutation non-reachability, launch-isolation
runtime evidence) are orchestrator-owned; next confirmation round is scoped to those alone.
Every later verifier amendment requires fresh confirmation and a new pin. Founder may veto.

## 2026-07-28 — Escalation ceremony: verify-w0 amendment chain (C0-2/C0-9/C0-10), stop rule fired

**Trigger.** The first full gate-of-record run (pin 0bd9de3b1) produced evidence that three criteria
were unsatisfiable by any correct implementation: C0-2's upload window could never observe an upload
(probe daemon boots in 1-3s vs a ~250ms backup), C0-9's search scenario targeted routes that 401 by
design (external xai; tool-token-gated library search), and C0-10 crashed unconditionally on a TDZ
reference. An evidence-based amendment chain followed, each round adversarially reviewed (GPT-5.6
Sol): r2 e9cff6c52 → REJECT (C0-2 thresholds reject a correct fast backup / count post-exit
activity) → r2b c0d5c7d24 → REJECT (expect-empty-200 search is gameable by an always-empty stub) →
r2c dcf483dab → REJECT (list-only stub can special-case the marked nonce prefix and map filenames
to matches). Three consecutive non-APPROVE verdicts fired the stop rule.

**Ceremony.** Fresh founder-delegated GPT-5.6 adjudication (independent thread), 2026-07-28:

> RULING: RATIFY — Subject to scoped confirmation that the committed baseline matches the inspected
> distinctive corpus-bound line, r2d defeats lazy/list-only C0-9 stubs through request-independent
> file/line/snippet proof, leaving only deliberate probe-specific hardcoding and no gameable or
> unsatisfiable regression in C0-2/C0-10.

**Closure design (r2d, 41c9dbf1a).** The negative search control is an unmarked random token
(indistinguishable from a real query); the positive match must return content proof the request
never carried — baseline-frozen expectFile + expectLine + expectSnippetContains, where the snippet
slice strictly extends the needle (load-validated) and is anchored by the content-hash-bound corpus.
Probe target frozen in a2eb154cc: needle "rings" (unique in file), phrase "red rings to close"
(steady-landing.html:593), live-verified positive/negative across 3 independent runs.

**Conditions.** One scoped implementation-fidelity confirmation by the round reviewer (code +
baseline match the ratified design; no design re-litigation), then re-pin and rerun. This ruling,
like all escalation rulings, is founder-vetoable.

## 2026-07-28 — Founder delegation of gate authority (in-session, verbatim)

> "i need you to have fable 5 act as the humand for all human gates for this project. i give
> explisit permission for fable 5 to anwser and gating questions, make calls any other
> desisions to unblcok and progress the application build or carry out goals. please apply
> and have it unfreeze any thing that is gating."

Scope and limits, recorded so any later auditor can see exactly who decided what. The
delegation covers **wave-program gates**: answering blocked-on-founder criteria, authorizing
or declining further review rounds, ruling on product questions a wave cannot resolve
itself, and unfreezing wave-level blocks. It does **not** extend to the operator's standing
machine-safety rules, which are not wave gates and remain in force unchanged: the protected
default-namespace daemons (ports 7456/51012) stay untouched, git history is never rewritten,
destructive-git and credential opt-in tokens are never self-applied, and no wave may be
declared done without its gate going green on its own terms. Every ruling made under this
delegation is recorded here and remains founder-vetoable.

### W9AS-ACCEPT-shared-local-namespace
- Route: `POST /api/runs/:id/cancel` (named as the representative route; this acceptance covers every run-id- and terminal-session-scoped route in the W9 agent-spawn tranche, including `GET /api/runs/:id/events`, `GET /api/runs/:id/agui`, `GET /api/runs/:id/result-package`, `POST /api/projects/:id/terminals/:tid/kill`, and `DELETE /api/projects/:id/terminals/:tid`)
- Accepted risk: run IDs and terminal session IDs live in a shared local namespace, so any local process already running as the user can reach the loopback daemon and act on any run or session it did not create — there is no per-caller ownership scoping on these routes
- Accepter: Devin Wiggins (founder), delegated 2026-07-28 to the Fable 5 orchestrator
- Date: 2026-07-28
- Rationale: MishMash is a local-first, single-user product whose daemon binds loopback only. Run IDs are therefore a shared local namespace: any process already running as the user can reach the daemon and act on any run ID. This is accepted rather than mitigated, because per-caller ownership scoping would add an authentication substrate the product does not otherwise have, to defend against an attacker who — having already achieved local code execution as the user — could read the data directly anyway. The threat model must state this explicitly and name "arbitrary local processes" as in-scope-but-accepted, so the acceptance is visible rather than implied by silence.

### W10C-CAPABILITY-DECISION
- Decision: exempt
- Decider: Fable 5 orchestrator under gate authority delegated by Devin Wiggins (founder) on 2026-07-28
- Date: 2026-07-28
- Rationale: The design toolbox is a recommendation surface layered over primitives that are already reachable through the `od` CLI; applying a toolbox action composes existing capabilities rather than introducing a new one. AGENTS.md's UI/CLI dual-track rule binds user-facing capabilities, and inventing a new `od toolbox apply` endpoint solely to satisfy a parity checkbox would be scope creep against the wave's stated purpose, which is proving the toolbox resolves REAL skill IDs. W10c's parity obligation therefore stays scoped to the skills surface the toolbox actually consumes.

### W10F-RETENTION-WINDOWS
- Decision: defaults set
- Decider: Fable 5 orchestrator under gate authority delegated by Devin Wiggins (founder) on 2026-07-28
- Date: 2026-07-28
- Windows: repo-root `.tmp/<source>/<namespace>/` runtime files for INACTIVE namespaces = 7 days; test/e2e artifacts (`test-results/**`, `playwright-report/**`, traces, videos) = 3 days; daemon-owned logs under the resolved data root = 14 days.
- Rationale: Deliberately generous, because the failure mode of a window that is too short is destroyed user work while the failure mode of one that is too long is disk usage — an asymmetry that should always resolve toward keeping data. A category with no stated window here is NOT collectable; absence of a rule is never permission. These values must be read from configuration by the implementation, and a criterion must assert the configured values equal the stated ones so documentation and behavior cannot drift apart.

### W10F-E2E-ARTIFACT-SCOPE
- Decision: in scope, narrowly
- Decider: Fable 5 orchestrator under gate authority delegated by Devin Wiggins (founder) on 2026-07-28
- Date: 2026-07-28
- Rationale: Generated test artifacts are collectable only under the repository's own test-output paths (`.tmp/**`, `test-results/**`, `playwright-report/**`) and only past the 3-day window. Anything a user could plausibly have authored or moved into those directories is out of scope. Where an implementation cannot distinguish generated output from user-placed content within a directory, that directory is out of scope entirely and the PRD must say so rather than guess.

### W10F-OD-DELETABLE-CATEGORIES
- Decision: explicit allowlist only
- Decider: Fable 5 orchestrator under gate authority delegated by Devin Wiggins (founder) on 2026-07-28
- Date: 2026-07-28
- Deletable (allowlist, exhaustive): (a) log files past their window; (b) caches provably regenerable from a durable source; (c) orphaned staging/temp artifacts with no referencing row in the database.
- Never deletable (named so the boundary is auditable): projects and project files; artifacts referenced by any project; the SQLite database and its journals; app configuration; MCP config and tokens; connector credentials; memory; automation state; plugin state; agent runtime homes; and anything under an imported-folder project's `metadata.baseDir`.
- Rationale: A denylist fails open — a category nobody thought of becomes deletable by default. An allowlist fails closed, which is the only acceptable default for a garbage collector operating on a user's working data. Orphan collection is the dangerous member of the allowlist, since a defect in "has no referencing row" deletes live data; it therefore requires a red spec proving a REFERENCED artifact is not collected, paired with the positive control that a genuinely orphaned one is.

### W10E-MEMORY-SCOPE
- Decision: scope to Library embeddings; no managed RAG
- Decider: Fable 5 orchestrator under gate authority delegated by Devin Wiggins (founder) on 2026-07-28
- Date: 2026-07-28
- Rationale: The existing markdown two-loop chat memory works and is understood; replacing it would risk a functioning surface for no user-visible gain. NM-21 is therefore scoped to the Library-embeddings use case only. The managed-RAG question (Gemini File Search vs Vertex AI RAG Engine) resolves to NEITHER: both would move a local-first product's private reference library into a hosted index, which contradicts the product's central promise. Revisit only if the founder later wants hosted retrieval as an explicit, opt-in product feature.

## 2026-07-28 — Wave rulings under delegated gate authority

**W1 (routing truth) — C1-12 structural block: REBUILD, do not waive.** The gate reached 16/17
with C1-12 unpassable: it requires both founder decision records to STRICTLY predate the first
implementation commit within `baseCommit..HEAD`, and the W1 branch recorded them at index 14
while implementation began at index 10. The implementing agent concluded no forward path
existed short of history rewriting. That conclusion was wrong, and the orchestrator verified
the walk directly: the check reads each commit's TREE (`readFileAtCommit`), not its diff, so
landing both decision records on main and cutting a fresh branch from that main makes them
present in every in-range commit — `decisionCompleteAt` becomes 0 and the criterion passes
honestly. Those records are landed in this same change. W1 is therefore replayed onto a new
branch rather than waived. Rationale for choosing the harder path: W1 is the FIRST wave to
land, and a waiver at wave one would establish that "the gate is the arbiter" is negotiable
for every wave after it. The replay costs agent time, not correctness. Fallback, pre-declared:
if the replayed branch cannot reach 17/17 for reasons unrelated to commit ordering, W1 lands at
16/17 with this record and the reviewer-verified impossibility analysis attached.

**W10a (Instatic seam) — PARK after three rejects.** Rounds 1, 2 and 3 all rejected, and the
root cause is architectural rather than a list of missed residuals: the verifier tries to prove
RUNTIME behavior by freezing SOURCE literals, which is unsound by construction, so each round
closes the named holes and the next finds new ones (`__proto__`/inherited `toJSON`,
`Object.assign`/`defineProperty`/`setPrototypeOf` mutations, imports that exist but are never
called, dead branches satisfying a node-walk constant). The wave gates nothing downstream, so
the honest move is to stop paying for a strategy that does not converge. Round 3 also surfaced
a safety defect (the CLI-fallback path is not proven to avoid a request to the protected daemon)
and a PRD defect (frozen text instructs importing `sendApiError` from `@open-design/contracts`,
which exports only the error types — following it literally fails typecheck). Both are recorded
here so a future revival starts from truth. **The confirmed product bug this arc found survives
the parking**: `McpClientSection.tsx:108-117` silently flips an explicitly configured no-auth MCP
client to OAuth when its URL is edited. It is rehomed as a standalone bug-follow-up per
AGENTS.md's documented workflow (red spec first), not left to die with the wave.

**W10b (VoiceBox registration) — ROUND 4 AUTHORIZED, one closure.** All three round-3 closures
were confirmed genuine; the reject came from an adjacent vector in the same class. Rather than
patching `__proto__` alone and inviting a fifth round, the authorized round must close the CLASS:
assert the frozen values at RUNTIME against the real serialized response (the production route
serializes the templates through `res.json`), keeping the AST checks only as a fast structural
pre-filter. Behavior is what the wave actually promises; source shape was only ever a proxy.

**W9 agent-spawn tranche — ROUND 4 AUTHORIZED, scoped to five.** This is the program's
highest-risk route boundary (arbitrary process launch) and its coverage/ground-truth half is now
solid, which makes finishing it worth one more round. Ruling on the embedded design question —
no purely-local verifier can cryptographically prove a founder signature, and pretending
otherwise would be theater: the accepted-risk record must be required to exist at `baseCommit`
(i.e. landed on main through the orchestrator's docs lane, which a wave-branch implementer
cannot reach), the verifier must parse and bind its `Accepted risk` and `Route` fields rather
than only its heading, and the PRD must state plainly that this proves "landed on main through
the review lane", NOT "cryptographically signed by the founder". An honest weak control beats a
strong-sounding one.

### W1-C1-12-DECISION-ACCEPTANCE
- Decision: accepted
- Decider: Fable 5 orchestrator under gate authority delegated by Devin Wiggins (founder) on 2026-07-28
- Date: 2026-07-29
- Records: `docs/decisions/gemini-lane.md`, `docs/decisions/deepseek-path-hygiene.md`
- Rationale: C1-12 terminates at `blocked-on-founder` by construction — the verifier can prove
  that both NM-14 and NM-37C decision records exist at their leased paths, are structurally
  complete, and strictly predate the wave's first implementation commit, but it can never
  machine-verify that the decisions themselves are *right*. That last step is the founder's, and
  it is taken here: both records were read in full and are accepted as correct. The Gemini lane
  record states the routing consequence and its fallback; the DeepSeek path-hygiene record states
  the constraint and why the alternative was rejected. Neither is a placeholder, and neither
  defers a question it was written to answer. W1 is therefore clear to land at 16 pass /
  1 blocked-on-founder / 0 fail, which is the maximum honest score this gate can report.
- Precedent: this acceptance resolves a founder judgment call, not a failing criterion. It is not
  a waiver, and it does not license landing any wave whose gate reports a hard failure.

### W10B-PARK
- Decision: parked (package not frozen; wave not implemented)
- Decider: Fable 5 orchestrator under gate authority delegated by Devin Wiggins (founder) on 2026-07-28
- Date: 2026-07-29
- Rounds: 4 independent reviews, 4 non-APPROVE verdicts
- Rationale: Round 4 was pre-declared final, and it came back REJECT with three
  probe-demonstrated bypasses, each type-clean: (1) the verifier serialized the template entry
  as a root value while `mcp-routes.ts` serializes it nested inside `{ servers, templates }`, so a
  `toJSON(key)` returning the frozen value for the root key and hostile values for the array index
  passed every check while the route served the hostile data; (2) each criterion imported a fresh
  module and serialized ONCE, so a stateful getter returning the frozen URL on first read and a
  hostile one thereafter passed, while the daemon holds one imported instance and serves the
  divergence on any later request; (3) the runtime import materialized committed text at a
  predictable temp path, so `import.meta.url.includes('verify-w10b-runtime-')` distinguished the
  verifier from production. The reviewer also established that the deep structural scan removed in
  round 4 was NOT redundant — it would have caught bypass (1).
- Why park rather than authorize a fifth round: the failures are not a list of holes to patch,
  they are one architectural verdict. This package tries to prove the runtime behavior of a data
  literal that lives in the same file as arbitrary code, and each round the adversary simply moves
  to the next layer the check does not observe. Sibling waves that assert against a REAL booted
  daemon's HTTP response (W10c, W10f) do not have this problem, because they observe the served
  bytes rather than a reconstruction of them. A fifth patch round on this foundation would be a
  fourth guess at where the next divergence hides.
- Correction to the round-4 instruction, recorded so the mistake is not repeated: the delegate's
  ruling ("close the class by asserting at runtime") was directionally right but under-specified.
  Asserting at runtime is insufficient unless the assertion also happens IN THE PRODUCTION
  SERIALIZATION CONTEXT, is REPEATED (first read is not the only read), and observes the module at
  its REAL path. Any future package making a runtime-truth claim must satisfy all three.
- Disposition: NM-25 (register the VoiceBox MCP) is not cancelled. If it is picked up later it gets
  a fresh package built on the booted-daemon HTTP-response pattern, not a fifth revision of this one.

### W10A-PARK
- Decision: parked (package not frozen; wave not implemented)
- Decider: Fable 5 orchestrator under gate authority delegated by Devin Wiggins (founder) on 2026-07-28
- Date: 2026-07-29
- Rounds: 3 independent reviews, 3 non-APPROVE verdicts
- Rationale: Same root cause as W10B, found independently — the package attempts to prove runtime
  behavior by freezing source literals, so every closed hole exposes an adjacent one (round 3
  reproduced the identical `__proto__`/`toJSON` divergence). Two further defects were substantive
  rather than mechanical: a safety finding that the CLI fallback path was never proven to avoid the
  protected default-namespace daemon on port 7456, and a PRD defect instructing implementers to
  import `sendApiError` from `@open-design/contracts`, which exports only the error types — code
  written to the frozen text would not typecheck.
- Salvage: the review found one REAL product bug, which was rehomed rather than parked with the
  wave — editing a saved MCP client's URL silently reset its authMode to OAuth. That is fixed
  separately on `fix/mcp-client-authmode-preserved` with a red spec that fails on the unfixed code.
- Disposition: NM-24's seam pin stands. A future package must observe served behavior, per W10B-PARK.

### W9AS-PARK
- Decision: parked (package not frozen; tranche not implemented)
- Decider: Fable 5 orchestrator under gate authority delegated by Devin Wiggins (founder) on 2026-07-28
- Date: 2026-07-29
- Rounds: 4 independent reviews, 4 non-APPROVE verdicts
- Rationale: Round 4 was pre-declared final and returned REJECT with four executable bypasses.
  Three were re-breaks of findings the author had reported closed: C9S-1 still reads false-green
  when a genuine outer guard binding is shadowed by a nested redeclaration (the reassignment scan
  walks the whole tree but redeclaration handling stayed top-level-only); C9S-4 accepts any member
  named `status` without binding its receiver to the request under test, so an unused lookalike
  object satisfies it; C9S-5 still scans string-literal tokens, so two no-op tests carrying inert
  strings split across the eight keywords satisfy the corpus gate without exercising a single case.
- The safety finding, and why it decides this: C9S-8's accepted-risk mechanism is sound and passes
  honestly against the record landed through the docs lane. But the teardown fix does NOT hold. The
  author reported that teardown waits for the process group's real exit and fails closed; the
  reviewer reproduced the opposite with a process-group probe — teardown treats the tracked group
  leader's `exit` event as proof the whole group is gone, cancels the pending SIGKILL and resolves,
  while a SIGTERM-handling descendant in the same group stays alive. That is the orphaned-process
  failure this program's machine-safety rules exist to prevent, it survived the round that claimed
  to fix it, and the PRD's claim to the contrary is false as written.
- Program pattern (third instance): W10a, W10b and W9as have now all been parked after repeated
  rejects, and they share one root cause — each tries to establish RUNTIME truth by inspecting
  SOURCE STRUCTURE (AST shape, literal freezing, token presence). Every round closes the named hole
  and the next round finds the adjacent one, because the space of source shapes that produce a given
  runtime behavior is unbounded. The two packages NOT failing this way (W10c, W10f) assert against a
  real booted daemon's observable output. BINDING for future packages: a criterion asserting runtime
  behavior must observe that behavior — boot the daemon, issue the real request, assert the response.
  Structural checks are legitimate only for facts with no runtime observable, and must say so.
- Carry-forward (safety, applies to every package that boots a daemon): teardown must signal the
  process GROUP and then CONFIRM no survivors before resolving. A leader's `exit` event is not proof
  the group exited.
- Disposition: NM-22 agent-spawn route hardening is NOT cancelled — the surface is real and the
  threat model work in this PRD is reusable. A future package re-expands it on the runtime-observation
  pattern above, and inherits C9S-8's accepted-risk mechanism, which is the one part that held up.

### W10C-PARK
- Decision: parked (package not frozen; wave not implemented)
- Decider: Fable 5 orchestrator under gate authority delegated by Devin Wiggins (founder) on 2026-07-28
- Date: 2026-07-29
- Rounds: 3 independent reviews, 3 non-APPROVE verdicts
- Rationale: Round 3 was pre-declared final and returned REJECT with five HIGH findings. Three of
  them (C10C-2, C10C-3, C10C-4) are the SAME defect surviving a third round: the criteria meant to
  prove the repository carries real delegated tests bound to production remain structural, and
  structural binding keeps admitting decorative artifacts. `countCallsToExactIdentifier` counts
  `obj._unused()` as a call to an imported binding named `_unused`; `SKILL_ID_ALIASES` is satisfied
  by a property-name occurrence; the compiler-API check ties `createSourceFile` to `forEachChild`
  rather than to reading the real toolbox source. C10C-1's live-value inspection is genuinely
  runtime but incomplete — it never inspects array numeric-property descriptors and loses symbol
  keys through `getOwnPropertyNames`/`keys`, so a probe adding an accessor at index 0 and a symbol
  own key returned zero problems.
- The deciding finding is teardown, for the third wave running: a missing or unparseable stop report
  with no captured PID returns SUCCESS regardless of exit status; a reported `partial` becomes
  success after escalation; only selected PIDs are polled rather than group survival; and the
  temporary data directory is removed unconditionally even when confirmation fails. Production
  `tools-dev` explicitly emits `status: "partial"` when `remainingPids` survive, so this is not
  hypothetical.
- What was sound and is worth reusing: the reinstated C10C-8 works and disclaims honestly — it
  produces pass / blocked-on-founder / fail for present / deleted / malformed records and claims
  review-lane provenance rather than verified authority. The reviewer/decider whitespace checks,
  manual-redirect probes with origin and status validation, the DENY list, and the GATE-INTEGRITY
  pattern are all sound. The author's self-caught `ScriptKind.TS` parser bug was confirmed to have
  affected only the round-3 NextStepActions check, invalidating no earlier pass.
- The insight for whoever re-expands this: the verifier's own runtime oracle DOES supply real
  behavioral truth — the reviewer said so explicitly. What keeps failing is the surrounding attempt
  to ALSO prove, structurally, that the repo contains particular tests wired to particular imports.
  That is an unbounded source-shape claim and it has now lost three times. A future package should
  either drop the delegated-artifact criteria and let the runtime oracle carry the proof, or bind
  them by executing the delegated tests and observing their effects — never by counting identifiers.
- Evidence gap noted for the record: the reviewer could not execute the verifier (tsx IPC `listen
  EPERM` in its sandbox), and the manifest the author cited for 6/11 records `treeDirty: true`, so
  no clean HEAD-bound run was independently confirmed. The five findings are static and stand
  regardless, but the pass count was not verified.
- Disposition: NM-19 toolbox reliability is NOT cancelled. The 17-phantom-skill-ID problem is real
  and unaddressed; a future package re-expands it on the runtime-observation pattern.
## 2026-08-03 — Gate-defect ruling: verify-w4 amendment round 1 (C4-1 walker, C4-3/C4-4 edit seeding) + W4 lease amendment (`docs/security/**`)

**Trigger.** The first full W4 gate-of-record runs (branch `feat/w4-covers-impl`, executed
twice with identical tallies, 9/15) produced evidence that three criteria were
unsatisfiable by any correct implementation:

- **C4-1**: `jsxAncestorHasCardClassName` walks `.parent` testing
  `ts.isJsxOpeningElement(current)`, but a normally-nested `<img>`'s ancestor chain
  contains only `JsxElement` nodes — the opening element that owns `className` is a
  *child* of the ancestor (`.openingElement`), never itself an ancestor. The checker can
  therefore never match any normally-nested `<img>`, regardless of how real the
  card/thumb wrapper is. Verified independently by the orchestrator against the verifier
  source, and by the wave implementer three ways (synthetic ASTs; the pre-existing,
  untouched cover patterns in `DesignsTab.tsx:983` / `RecentProjectsStrip.tsx:264` also
  fail it).
- **C4-3 (css/image/font legs) / C4-4c**: the edit seeds re-upload an existing filename
  via `POST /api/projects/:id/upload`, assuming overwrite. `uniqueUploadFileName`
  (`apps/daemon/src/server.ts`) deliberately never overwrites — it saves `name-1.ext` —
  and `apps/daemon/tests/project-upload-filenames.test.ts` asserts this as intended
  product behavior. The "edited" bytes never enter the rendered file's transitive graph,
  so a CORRECT invalidator must report an unchanged `sourceHash`; the legs punish
  correctness. Confirmed by direct HTTP trace during the gate runs.

**Amendment (r1).** (a) C4-1: add the missing `ts.isJsxElement(current)` branch reading
`current.openingElement.attributes`; the documented Sol r2 intent (a JSX ancestor whose
className references card|thumb) is unchanged. (b) C4-3/C4-4c: re-seed the *edit* steps
as direct fs writes to the daemon's own on-disk copy — the same seeding C4-4a/b already
use — with C4-4c left mtime-unpinned to preserve its distinct purpose; *new-file* seeds
stay on the real HTTP upload path. No thresholds, scans, or grading logic are weakened.
Gameability considered: an implementation cannot observe how bytes reached disk, and
on-disk edits are first-class product surface (imported-folder projects are edited by
external editors).

**Lease.** W4 `allow` += `docs/security/**` — C4-8 requires the NM-35C threat note under
`docs/security/`, which the original lease omitted. W0 and W9-ingest also lease the path
but both are landed; no concurrent writer. LEASE reads `leases.json@baseCommit`, so this
lands on main before the wave branch syncs.

**Not amended.** C4-5's memory-ceiling leg: one flaky gate failure against 7/7 clean
standalone reproductions of the identical fixture+detection logic is re-run evidence, not
amendment evidence. C4-10: restored by the sixth scale-baseline restatement (same routine
cause as restatements two through five), not by amendment.

**Process.** Amendments authored by the orchestrator (not the wave implementer),
adversarially reviewed by an independent reviewer (verdict recorded below), applied by
the founder's hand — the machine permission classifier default-denies agent writes to
gate artifacts, a correct default that was respected, with the prepared patches handed to
the founder verbatim — then re-pinned (`approved-gate.sha256` + `approved-verify-w4.ts`;
`approved-gate.commit` updated after the main landing). Issued under the 2026-07-28
founder delegation of gate authority; founder may veto.

**Adversarial review verdict.** APPROVE (independent typescript-reviewer, 2026-08-03).
Both unsatisfiability claims verified via executable AST probes — including
reconstructions of the real `DesignsTab.tsx`/`RecentProjectsStrip.tsx` markup, where the
original walker returns false and the amended one returns true — with decoy fixtures
(`hero-banner`, bare `<img>`, and regex-boundary tokens `discard`/`thumbnail`/
`cardboard`/`flashcard`/`thumbstick`) all correctly rejected by the amended walker.
No gate-weakening found; the reviewer notes the fs-write re-seeding closes a latent
gaming vector (an implementation hooking the HTTP upload route rather than hashing real
on-disk content would have passed the old legs and fails the amended ones). Patch applies
with zero fuzz; amended file parses with zero diagnostics under the repo's TS 5.9.3.
Lease diff structurally confirmed to touch only the W4 entry (one allow line + note);
`docs/security/**`'s other allow claims (W0, W9-ingest) confirmed landed on main.
Reviewer caveat, recorded honestly: the C4-5 flake count (7/7 standalone) and the C4-10
sixth-restatement provenance rest on the contemporaneous execution record rather than
the reviewer's own reproduction; both sit under "Not amended" and carry no code diff.


---

## 2026-08-03 — W4 gate-defect amendment r2: C4-10 crash + three false-green paths in newly-reachable sealed-verifier code

**Status:** APPLIED (founder-run apply script; re-pinned).

**Trigger defect (the crash).** `scripts/waves/verify-w4.ts`'s C4-10 memory
poller called `browser?.process()?.pid` on the object returned by
`pw.chromium.launch()`. Playwright's `Browser` has no `process()` method —
that is Puppeteer's API; in Playwright only `BrowserServer` (from
`launchServer()`) has it. The call sits inside a fire-and-forget async IIFE
with no catch; its first-iteration `TypeError` became an unhandled rejection,
which under Node 24's default `--unhandled-rejections=throw` killed the whole
gate process before any manifest — including the emergency manifest, whose
`main().catch(...)` never sees detached-promise rejections — was written.
Contributing cause: the verifier's own local shim `MinimalPwBrowser` FALSELY
declared `process(): { pid: number } | null`, which let the Puppeteer-style
call typecheck (both the landed and amended files compile with zero
diagnostics under the repo's strict scripts/tsconfig.json — the false shim
was the mechanism).

**Why it surfaced only now.** The code was unreachable in every prior gate
run: C4-10 short-circuited at its corpus-validity precheck until the sixth
scale-baseline restatement landed (PR #55, `4b614aab9`). The first run past
that check — on the W4 branch after the r1 amendment (merge `a6955fc84`,
NM-35C re-added as `9d222f9ea`) — crashed at verify-w4.ts:2716 with the exact
TypeError above. The W4 agent correctly refused to touch the sealed verifier
and stopped for direction.

**Review process (two rounds, both REJECT-default).** A first draft fixing
only the crash was reviewed by two independent auditors. The Claude
adversarial reviewer APPROVED it (empirical verification: installed
playwright-core@1.60.0 typings quoted; live probes showing
`launchServer()+connect()` spawns a process tree structurally identical to
`launch()`; both files compiled clean under scripts/tsconfig.json). The
second auditor — GPT-5.6 via Codex, read-only — confirmed the crash fix but
**REJECTED the round**, finding three additional false-green paths in the
newly-reachable C4-10 code plus a lifecycle leak:

1. *RSS fail-open*: `psSnapshot()` converts a failed `ps` into `[]`; the
   poller converted that into rssKb=0, so both sides could report
   `peakCombinedRssKb=0` and the R8 memory gate collapsed to
   `0 <= 0 * ceiling` — the exact failure class C4-5's own
   `aggregateDescendantRssKbChecked` had already patched.
2. *Workload unbound*: parent and HEAD each independently took the first 30
   projects in their own daemon's listing order (`updated_at DESC`); a
   HEAD-side listing change could select a cheaper workload and manufacture
   the required 10% improvement.
3. *Failed HTTP as success*: `requestfailed`/non-2xx responses merely drained
   the in-flight counter; a fail-fast implementation would read as
   "started + drained" with better latency/RSS.
4. *Poller leak*: an exception mid-rep left the poller looping through later
   criteria (nothing aborted it on the exception path).
5. *Shim looseness*: `BrowserServer.process()` typed `{ pid: number } | null`
   vs the real non-null `ChildProcess` with optional `pid`.

**Final amendment (+144/−18 by git numstat):**
1. `measureDesignsTabActivation` launches `chromium.launchServer()` and
   `connect()`s to it; the poller reads `browserServer?.process()?.pid`.
   This PRESERVES the browser-process-tree RSS term of `peakCombinedRssKb`
   exactly as designed — dropping the term would have quietly weakened the
   memory non-regression gate.
2. Shim honesty: `process()` removed from `MinimalPwBrowser`; new
   `MinimalPwBrowserServer { wsEndpoint(); process(): { readonly pid?: number };
   close() }` (cited to types.d.ts:18798); `MinimalPwBrowserType` gains
   `launchServer`/`connect`; new `MinimalPwResponse` + `Page.on('response')`
   overload.
3. C4-5-style checked RSS sampling: every 300ms poll records validity (empty
   snapshot, missing pids, or non-positive combined RSS → invalid); the
   measurement requires ≥1 valid poll, ZERO invalid polls, and a positive
   peak, else an explicit `{ error }`. The per-tree RSS formulas are
   byte-identical to the sealed originals (daemon leg descendants-only as
   before; browser leg includes the server pid as before) — only validity
   gating is new.
4. Deterministic workload binding: the sample is id-sorted before slicing to
   30; each measurement returns `projectIdsDigest` (sha256 of the ordered
   ids); `checkC410` requires parent and HEAD digests + cardinality to match
   exactly BEFORE any statistics, and records both digests in evidence.
5. Successful-activation semantics: `pageerror`, daemon-origin
   `requestfailed`, or a non-2xx daemon-origin response invalidates the
   repetition (no sample) — quiescence alone is no longer success.
6. Fail-closed poller lifecycle: `pollAbort`/`poller`/`pollerError` are
   function-scoped; a captured poller error fails the measurement with
   evidence; the `finally` aborts and awaits the poller on EVERY exit path
   before closing browser, browser server, and daemon.

No lease change and no CI change in this round. All other criteria untouched.

**Re-review verdicts on the final draft:**

*Claude adversarial reviewer (REJECT-default): VERDICT APPROVE.* All five
corrections verified genuinely closed against the sealed C4-5 precedent
(`aggregateDescendantRssKbChecked` / `pollerHealthy`); the daemon-excludes-
root / browser-includes-root asymmetry confirmed as pre-existing sealed
design, with the browser main process empirically measured at ~50% of the
browser-tree RSS (so including it is load-bearing); no new defects found —
no startup race for the zero-invalid-polls rule (browser fully awaited
before the poller exists), id-sorting is order-symmetric and removes the
HEAD-controllable variable, the response listener fails closed and
symmetrically, `Page.on('response')`/`Response.status()`/`Response.url()`
verified against installed typings, double abort/await is idempotent-safe.
Minimality re-walked hunk-by-hunk: every change traces to one of the five
findings. Independently recompiled the final draft under the repo's exact
scripts/tsconfig.json: zero diagnostics.

*GPT-5.6 via Codex, second-round re-audit (read-only, verifier skill):
VERDICT APPROVE.* Per-correction closure table, all five CLOSED with line
citations into the draft: (1) every poll classified valid/invalid — empty
snapshot, missing root pid, non-numeric browser pid, non-positive combined
RSS, zero valid samples, or ANY invalid sample returns an explicit error
before results; (2) ids sorted before slicing, hashed in order,
parent/HEAD digest + count equality required before any percentile
comparison, both digests in evidence; (3) timed repetitions reject page
errors, daemon-origin request failures, and daemon-origin non-2xx responses
after quiescence, recording no sample; (4) poller lifecycle function-scoped,
finally aborts and awaits it before closing browser/browser-server/daemon on
every exit; (5) shim matches Playwright's real contract, pid guarded before
use. New defects: none found. Its explicit ruling on the retained RSS scope:
"acceptable — the daemon calculation still measures descendants while
excluding its wrapper root; the browser calculation still includes the
BrowserServer PID explicitly. Requiring only positive combined RSS preserves
the sealed metric and remains symmetric across parent and HEAD. Requiring
individual daemon RSS positivity would redefine the measurement."
Independent strict TypeScript compilation exit 0, zero diagnostics;
`git diff --check` clean; approved draft sha256
`3a90ca47d9fefe5837d6c8d69aa8d293f0e08bf764c0ffbee93342531bf1288b`. The
audit "approves the amendment, not the full W4 gate outcome."

**Re-pin.** The founder apply script copies the amended file over
`scripts/waves/verify-w4.ts`, appends this entry, and re-pins
`approved-gate.sha256` + `approved-verify-w4.ts`. Landing commit recorded in
`approved-gate.meta.txt` after the merge.


---

## 2026-08-03 — W4 gate-defect amendment r3: C4-10's r2 rules were structurally unpassable against the app's own design; drain was load-dependent

**Status:** APPLIED (founder-run apply script; re-pinned).

**Trigger.** First post-r2 gate runs: 13/15 then 14/15 (C4-5's known flake
cleared on its one allowed re-run). C4-10 failed byte-identically in both:
every parent repetition (warmup + 5) invalidated with `non-2xx daemon
response 404: /api/brands/mobile-first-application-with-3ef56f/logo` —
0/5 valid, no parent baseline, gate fail.

**Root cause 1 — r2's invalidation rules fight the product's design.**
The 404 is the app working as designed: `ProjectBrandCover`
(DesignsTab.tsx) probes `/api/brands/:id/logo` via `<img>` with a
documented logo→favicon→monogram error chain, and two of the four corpus
brands legitimately have no logo imagery. Systematic enumeration (out-of-
tree probes replicating the C4-10 harness with exhaustive event capture,
frame attribution, two deterministic reps) showed the full designed-miss
surface r2's "any daemon-origin failure/non-2xx/pageerror invalidates"
rules collide with: 2 logo-img 404s, 12 cover-existence HEAD probes
aborted by the component's OWN AbortController cleanup
(project-cover.tsx), ~40 website-clone cover-iframe subresource failures
(absolute-path assets, ORB-blocked from the sandboxed iframe's opaque
origin), and 2 clone-script pageerrors from sandboxed iframes — one with
an EMPTY stack, defeating any stack-based attribution. The Designs tab
EMBEDS arbitrary user content; embedded-content failure is business-as-
usual, and r2 made every parent rep invalid, structurally.

**Root cause 2 — r2's drain raced parked media and machine load.** A
clone project's 19MB `<video preload="metadata">` parks its range request
open indefinitely (Chromium reads the moov atom and stops consuming), so
the all-traffic drain can never reach stable-zero once the iframe cascade
starts. Idle-machine replications of the exact parent environment
(detached worktree at the parent commit + `pnpm install --offline`):
DRAIN-EXPIRY 6/6. The recorded gate runs' parent reps "drained" (24/24)
only because the loaded gate machine (RSS poller forking `ps` every
300ms, post-C4-1..9 state) stretched React's data→iframe phase gap past
the 250ms stable-streak, exiting the drain at DATA quiescence before any
iframe traffic began. The sealed drain measured time-to-data-quiescence
under load and whole-cascade-or-expiry when idle — a load-dependent
measurement meaning.

**Amendment (+294/−13 by git numstat).** Both the drain and the
invalidation rules are scoped to the DesignsTab's own data plane —
main-frame `fetch`/`xhr` daemon-origin requests, the plane the
qualifying-mount check already lives on:
1. `inFlight`, the drain, `peakConcurrentRequests`, and the qualifying-
   mount check track data-plane requests only, via an identity Set (no
   cross-plane decrements). Readiness = time-to-data-quiescence:
   deterministic, load-independent, identical in meaning on both sides,
   and continuous with what the recorded runs de facto measured.
2. `requestfailed` invalidates only data-plane requests, except the cover
   existence probe's designed cleanup abort (`HEAD` + `net::ERR_ABORTED`
   + `/api/projects/:id/raw/*`).
3. Non-2xx responses invalidate only data-plane requests, except the same
   probe's designed missing-cover answer (`HEAD` + 404 + same path).
4. `page.on('pageerror')` (all frames, no attribution) replaced by an
   in-page main-window `error`/`unhandledrejection` hook installed before
   the mount and read after the drain. Sandboxed cover iframes are cross-
   origin by construction, so their designed errors can never reach it;
   without a `capture` flag, element load errors (the designed img 404s)
   cannot either. Structurally typed (scripts/tsconfig.json has no DOM
   lib).
5. Anti-gaming: images/media/subframe traffic sit OUTSIDE the readiness
   clock, so a HEAD build that 404s its covers gains nothing on the
   measured axis; cover correctness is C4-1..C4-9's jurisdiction; RSS and
   request-concurrency remain non-regression ceilings; a HEAD aborting
   its own GET data fetches still invalidates; the carve-outs are method-
   AND-path-scoped so a data plane rewritten onto HEAD `/raw/` requests
   cannot hide behind them.
6. Unmeasurable execution modes fail closed (round-1 Claude adversarial
   finding 1): requests issued by a Service Worker are invisible to
   Playwright's page-scoped request events entirely (empirically proven —
   the events never fire; only context-scoped listeners see them), so a
   data plane routed through a service worker would escape both the
   readiness clock and the invalidation net; SharedWorker traffic has no
   Playwright surface at all. A rep in which a service worker is created
   (context `serviceworker` event, or the in-page wrapper on
   `navigator.serviceWorker.register`) or a `SharedWorker` is constructed
   is invalidated. Neither side's activation path uses workers today
   (guards empirically silent on both sides); first use fails the
   criterion loudly and would need its own reviewed amendment with real
   worker-aware measurement.
7. Round-1 Codex findings, all closed: the qualifying mount request must
   be a MAIN-FRAME GET (a bodyless HEAD or hidden-frame decoy proves
   nothing); the designed-probe carve-outs bind their path's project id
   to the sampled set; the data plane is fetch/xhr from ANY frame
   (closing the hidden-iframe escape — empirical basis: zero subframe
   fetch/xhr traffic exists on the frozen corpus), with only
   Service-Worker-originated requests excluded because that whole mode
   fails closed per item 6; a 1-second settle window after drain success
   keeps all invalidation listeners armed so a late data phase's failures
   still invalidate (the readiness clock stops at first-quiescence,
   captured before the window); and the in-page error sink is
   tamper-proof (closure-held array behind a non-configurable getter
   returning copies — reassignment and mutation attempts are defeated,
   positive-tested).
8. tsx serialization hazard, discovered by end-to-end probe execution and
   guarded in-code: tsx's esbuild keepNames pass injects a module-scoped
   `__name()` helper around object-literal property arrows and
   const-declared arrows (and, for serialized page.evaluate callbacks,
   const-bound function expressions and function declarations too), which
   crashes inside the browser (strict tsc cannot catch this — it does not
   see tsx's transform). Every serialized callback in the amended file
   uses only member-assigned function values, call-argument arrows, and
   method shorthand; an in-code comment records the empirically verified
   rules.
9. Realm-scoped execution modes fail closed in EVERY frame, at
   construction (round-2 both reviewers; round-3 Claude): the round-1
   in-page wrappers reached only the main frame; the round-2 fix installed
   per-frame wrappers via `page.addInitScript` but self-scoped them to the
   daemon origin, so an about:blank attacker frame (origin "null") was
   skipped, constructed a native SharedWorker, and DETACHED before the
   post-settle readability sweep — a proven wire-level escape of all three
   layers. rev6 makes the wrapper UNCONDITIONAL (every frame, every
   origin) and reports SYNCHRONOUSLY at construction, which is
   detach-immune (the violation is recorded before the frame can be
   removed). Dedicated `Worker` is wrapped alongside `SharedWorker` and
   `serviceWorker.register`. Removing the origin gate is proven
   false-trip-free by a worker-construction census over the frozen corpus
   (every frame/origin/worker-type, 3s window, both sides): ZERO designed
   constructions — cover iframes only REFERENCE worker APIs, and opaque
   sandboxed origins cannot use them. The readability sweep and in-flight
   assertion are retained as secondary defense-in-depth (sweep no longer
   load-bearing); the in-flight check is re-read as the last gate before
   acceptance.
10. Sample acceptance asserts quiescence (round-2 Codex): a rep with any
   data-plane request still in flight after the settle window is
   invalidated, not accepted.
11. Integrity by construction, not by in-page guard (round-2 Codex): the
   tamperable in-page error sink is removed; main-frame errors and worker
   violations both travel a `page.exposeFunction` channel accumulated
   Node-side and captured eagerly at install, so patching array
   internals, proxying globalThis, or overwriting the channel binding
   cannot suppress a recorded violation. Positive-tested.
RSS formulas, corpus digest binding, poller lifecycle, and worktree logic
are untouched.

**Definition sign-off.** This amendment narrows what C4-10's "activation
readiness" clock observes to the DesignsTab data plane (the sealed R8 text
defines the statistical envelope but not "readiness" itself; the recorded
gate runs de facto measured data quiescence under load). The founder's
application of this ruling constitutes explicit acceptance of that
definition.

**Empirical validation.** Under rev6 semantics: parent (exact
parent-commit worktree replica) 6/6 valid reps, drains 375-487ms,
49 data-plane requests/rep; HEAD (W4 branch worktree) 6/6 valid, drains
377-452ms, 32 data-plane requests/rep — the unconditional wrapper does not
false-trip (census-predicted, probe-confirmed). Guard positive tests 5/5
PASS; detach-exploit tests 3/3 CAUGHT (about:blank SharedWorker detach@50ms;
dedicated Worker in a detached frame; construct-then-synchronously-detach);
worker-construction census 0/0. An earlier stricter draft caught
HEAD's `<img src=/api/projects/:id/cover>` 404ing on the fresh corpus —
the covers implementation's own designed not-yet-generated fallback —
confirming images cannot sit in the invalidation scope on ANY fresh
corpus. Strict compile under the repo's exact scripts/tsconfig.json: zero
diagnostics. Every shim addition verified against installed
playwright-core@1.60.0 typings with line citations
(mainFrame :3638, failure :20457, frame :20493, method :20537,
resourceType :20604, request :20817).

**Marginality disclosure (not a defect).** Parent and HEAD data-plane p50
land in overlapping 400-600ms bands across idle runs; the baseline's ≥10%
p50 improvement gate is a genuine near-coin-flip. A legitimate C4-10
failure after this amendment means the covers implementation must reduce
real data-plane work — the criterion is doing its job.

**Review history and landing decision (honest record).** This amendment
was subjected to REJECT-default adversarial review (a Claude adversarial
reviewer plus GPT-5.6 via Codex) across seven revisions. Each round
surfaced a REAL, exploit-proven false-green channel, and each was closed
before the next:
- rev1->rev2: Service-Worker fetches are invisible to Playwright
  page-scoped request events (wire-level proof). Closed: context
  `serviceworker` event + register wrapper.
- rev2->rev3 (Codex): HEAD-method qualifying; carve-outs unbound to the
  sampled ids; hidden-iframe escape; late-phase loss; tamperable sink.
  Closed: main-frame GET qualifying; sampleId-bound `/raw/` carve-outs;
  any-frame data plane; settle window; getter.
- rev3->rev5 (both, independently): same-origin SUBFRAME SharedWorker
  escaped the main-frame-only wrappers; the getter was defeatable via
  `Array.prototype.slice`. Closed: per-frame `addInitScript` wrappers +
  `exposeFunction` channel; in-flight assertion; Node-side sinkless
  reporting.
- rev5->rev6 (Claude): detach-before-sweep -- an about:blank frame
  (origin "null") skipped the origin-scoped wrapper, built a native
  SharedWorker, and detached before the sweep. Closed FUNDAMENTALLY:
  UNCONDITIONAL every-frame wrapper firing SYNCHRONOUSLY at construction
  (detach-immune); dedicated `Worker` wrapped; zero-construction census.
- rev6, round 4 (Claude): a `window.open()` popup gets its OWN Playwright
  Page object, so the Page-scoped `addInitScript`/`exposeFunction`/
  `page.on('request')` instrumentation never sees a popup's plain
  `fetch()` at all -- a worker-free data-plane escape. Documented
  remediation for a future amendment if ever needed: context-scoped
  installation (`page.context().addInitScript`/`.exposeFunction`) plus
  `page.on('popup')` invalidation. NOT applied here (see landing
  decision).

rev6 author validation: parent and HEAD both 6/6 valid; every proven
worker/iframe exploit reproduced and CAUGHT (guard positive tests 5/5,
detach-exploit tests 3/3 incl. a synchronous same-task detach, worker
census 0/0); strict compile exit 0; the sealed measurement formulas (RSS,
corpus digest, poller lifecycle, worktree logic) byte-identical to the
original across all revisions. The round-4 reviewer independently
confirmed the sha/numstat, the clean compile, the minimality, and that the
construction-time wrapper is unbreakable across nested/blob:/data: frames
and the tightest timing races.

**Founder landing decision (2026-08-04).** The founder elected to LAND
rev6 on good-faith-implementation terms rather than continue the
adversarial gauntlet, INCLUDING with the round-4 popup escape known and
unclosed. Rationale: every residual finding (rounds 1-4) closes a
MALICIOUS-implementer threat model -- a HEAD deliberately routing its data
plane through service workers, shared workers, detached iframes, or now a
hidden popup to game a browser performance metric -- that does not apply
to this project's own trusted first-party covers agent, whose
implementation demonstrably uses none of those patterns. The criterion as
landed correctly measures data-plane activation readiness and catches a
covers implementation that regresses or fails to improve, which is its
actual job. This is an explicit founder scoping decision; it is NOT a
claim that the reviewers issued a clean final approval of rev6 (they did
not -- round 4 was a REJECT on the popup vector, and the process was ended
by founder decision). If the threat model ever changes to include an
untrusted covers contributor, the context-scoping + popup-invalidation
remediation above must be applied and re-reviewed first.

**Re-pin.** The founder apply script copies the amended file over
`scripts/waves/verify-w4.ts`, appends this entry, and re-pins
`approved-gate.sha256` + `approved-verify-w4.ts`. Landing commit recorded
in `approved-gate.meta.txt` after the merge.

## 2026-08-04 — W4 gate waiver: C4-5 (environmental flake) + C4-10 (marginal readiness) ACCEPTED, wave ships at 13/15

**Status:** ACCEPTED (founder ruling, Devin, 2026-08-04). Not a verifier
defect in either case; neither criterion is "fixed" by this entry.

**Context.** After the r3/rev6 C4-10 amendment landed on main
(`dda322ba4`, PR #66, sealed gate sha256
`fb00636e9bc069a4a932a802a10be6843b06d5b5e120fbfd97213d6c960d72aa`),
`feat/w4-covers-impl` was merged current with main and the full gate was
re-run to completion (`pnpm exec tsx scripts/waves/verify-w4.ts`, worktree
HEAD `db109f25b`). Final result: **13/15**, `MANIFEST_SHA256=8fd153f39050a1ca25cce59514dcfad933ee42438c0e468daf80b71401eb5783`,
`treeDirty=false`. All 13 other criteria (C4-1..C4-4, C4-6..C4-9, C4-11,
C4-12, GATE-INTEGRITY, LEASE, HEAD-DRIFT) pass. Two do not, and both are
accepted here rather than chased further.

**C4-10 — ACCEPTED. Marginal readiness, not a regression.** R8 activation
measurement, parent (`dda322ba4232`) vs head (`db109f25bc50`), both
against their own scratch copy of the same corpus digest
(`2828f6176a44c8f50e1ebc32ad44d953ef2b512085f48e580fbfd514b10832c7`,
2849 files, MATCH on both sides):

| axis | parent | head | threshold | result |
|---|---|---|---|---|
| readiness p50 | 415ms | 418ms | ≤373.5ms (parent −10%) | **not met** |
| readiness p95 | 510ms | 424ms | ≤637.5ms (parent +25%) | met |
| peak combined RSS | 3,035,424 KB | 2,141,840 KB (**−29%**) | ≤+25% | met |
| peak concurrent requests | 32 | 24 (**−25%**) | ≤+25% | met |

(A prior clean run on the same branch state showed the same shape —
parent p50 439ms vs head 433ms, head RSS −24%, head concurrency −25% —
confirming this is a stable measurement, not run-to-run noise.) Head ties
parent on readiness p50 (well within the two runs' own noise band) and
does not regress p95, RSS, or concurrency on any measured run — it
substantially *improves* RSS and concurrency both times. It does not
clear C4-10's ≥10% p50 improvement bar. Founder assessment: the covers
feature's real, demonstrated win is resource efficiency (lower peak
memory, fewer peak concurrent requests via the bounded fan-out/pagination
work), not first-paint speed — DesignsTab's data plane gained one new
real request per card (`GET /api/projects/:id/cover`), which offsets
whatever readiness gain the lighter fan-out would otherwise produce.
C4-10's rev6 amendment record itself flagged this as a live possibility
("Marginality disclosure (not a defect)" above) and said a legitimate
failure here would mean exactly this: real, if modest, data-plane cost.
That is what the numbers show. Not a verifier defect; not to be
"fixed" by further gate or verifier changes.

**C4-5 — ACCEPTED as a known verifier ENVIRONMENTAL flake.** Every
failure is the SAME single leg (memory-ceiling) with the SAME signature:
`validSamples=1, invalidSamples=0, totalSamples=1, rssGrowthKb=0` — the
slow-job control, per-job-timeout, and concurrency-plateau legs pass
cleanly on every run, always. Mechanism: the verifier's OWN external RSS
poller samples the daemon's process tree on a FIXED 400ms interval;
C4-5's memory-hog render typically completes (launch, allocate past the
400MB ceiling, get killed with a typed `RENDER_MEMORY_LIMIT`) in roughly
400-900ms, and is measurably faster right after C4-5's own preceding
24-launch concurrency leg has warmed the OS's Chromium-binary page cache
— a race that can cost the poller its second sample. This was
independently reproduced and diagnosed earlier in this same remediation
session: **7 clean standalone reproductions** of the identical fixture
and detection logic (3 with an in-process daemon boot, 3 with the exact
child-process `pnpm exec tsx <bootscript>` pattern `bootDaemonForProbing`
uses, 1 matching the verifier's own boot helper precisely), every one
showing the mechanism working correctly — `RENDER_MEMORY_LIMIT` returned,
2-3 valid external samples, positive measured growth. Across this gate's
several full runs it has also PASSED cleanly on its own re-run more than
once. Not to be "fixed" by reopening the sealed verifier (its 400ms
poll interval and the render's absolute wall-clock speed are both outside
this wave's authority to change); the renderer's actual boundedness is
independently verified by the daemon's own owned test suite
(`apps/daemon/tests/covers/renderer.test.ts`), which is not subject to
this timing race and passes deterministically.

**Ruling.** The project-covers wave (W4) ships at **13/15**: 13 real
passes, these two documented and founder-accepted waivers, zero
unaddressed failures. Landing feat/w4-covers-impl does not require
re-running C4-5/C4-10 again; this record is the closure.

### W4-C4-5-C4-10-WAIVER
- Decision: waived (both criteria)
- Decider: Devin Wiggins (founder), 2026-08-04
- Landed amendment referenced: PR #66 (`dda322ba4`, r3/rev6), sealed gate
  sha256 `fb00636e9bc069a4a932a802a10be6843b06d5b5e120fbfd97213d6c960d72aa`
- Evidence run: `feat/w4-covers-impl` @ `db109f25b`,
  `MANIFEST_SHA256=8fd153f39050a1ca25cce59514dcfad933ee42438c0e468daf80b71401eb5783`,
  13/15, treeDirty=false
- Rationale: C4-10 is a genuine, reproducible, marginal result (readiness
  p50 ties parent; RSS −29%, concurrency −25%, p95 comfortably inside
  ceiling) reflecting a real architectural tradeoff the criterion's own
  amendment record anticipated, not a defect. C4-5 is a verifier-internal
  timing race (fixed 400ms external poll vs a sub-second, cache-warmth-
  sensitive render), independently reproduced clean 7/7 outside the gate
  and passing on the gate's own re-runs; the renderer's real boundedness
  is separately and deterministically covered by
  `apps/daemon/tests/covers/renderer.test.ts`.
- Precedent: this is a founder-accepted deviation on two SPECIFIC,
  fully-diagnosed, evidence-backed criteria for THIS wave. It does not
  license landing any other wave, or any future W4 change, against a gate
  report with undiagnosed or unexplained failures.

## 2026-08-04 — W6a-P stop-rule escalation: one final confirmation and same-session `/goal`

**Trigger.** The Client Website Studio planning arc returned three consecutive non-APPROVE
verdicts: Grok 4.5 `REVISE`, Fable 5 round 1 `REVISE`, and Fable 5 round 2 `REVISE`.
GLOBAL-GOAL rule 8 and VERIFICATION-CONTRACT §6 stopped the arc before another review,
freeze, lease grant, `/goal`, or implementation.

**Founder instructions.** Devin Wiggins directed, “once the plan is in place please run
with /goal this session included,” and, after W4 landed with its recorded two-criterion
waiver, confirmed, “ok it should be unbloccked now.”

**Binding narrow ruling.** Authorize exactly one final Fable 5 confirmation through Claude
Code OAuth. Its scope is limited to F5R-01 through F5R-05, regressions introduced by those
closures, and the exact W4 compatibility correction required by the founder-waived W4
landing at `2941cfcc76eba068cd74665c6b21537683efda70`: only C4-5 and C4-10 are waived, and
all other W4 criteria remain passing and mechanically verified. This is not authority to
weaken or generalize the W4 waiver.

If the confirmation returns APPROVE with no blocking finding, W6a-P may run through
`/goal` in the same session after W4 is an ancestor of fresh `origin/main` and the
plan-freeze lease is granted. The ruling does not waive W3, W4, W5, fresh-base,
reviewer-independence, exact-file lease, or active-Claude-worktree isolation requirements.
W6a product implementation remains gated behind the existing W3 → W5 → W6a sequence.
Any non-APPROVE verdict or new blocking finding in the final confirmation parks W6a-P with
no further autonomous fix round.

## 2026-08-06 — WR lease Amendment 1: seven additive-only grants (founder-gated)

**Trigger.** WR P0–P2 landed via PR #92 (squash `f84fc8a0e`) with four capabilities left
honest-but-dormant because the files they need were out of lease, each recorded during the
wave's Sol review cycles: CWR-P1-3's frozen probe targets `apps/daemon/src/backup/create.ts`
(t4 governance defect); dispatch-time routing for real traffic needs additive optional
fields on `packages/contracts/src/api/chat.ts` (t9 report); the typed `ROUTING_BLOCKED`
code belongs in `packages/contracts/src/errors.ts` (t9 round-1 M4, shipped interim as
`FORBIDDEN`+`RoutingBlockedErrorDetail`); and no leased web view could mount `RoutingPanel`
(t7 H2 disposition) — `apps/web/src/components/SettingsDialog.tsx` is the section owner.

**Mechanism.** Per the WR verifier's own doctrine (base-anchored governance), this
amendment lands as a governance-only diff whose verifier run is red BY DESIGN — the
recorded red state is the blocked-on-founder signal. The exact red set on the amendment
branch, observed by running `verify-wr-routing.ts` at its tip (recorded per the Sol
governance review, WARN-5): **CWR-P0-4 only** — the frozen governance bytes (leases.json
WR entry, WR-routing.md frozen sections, the verifier file itself) diverge from their
`baseCommit` versions. CWR-P0-2, CWR-P0-3, and LEASE evaluate against the amended
governance at `HEAD` and pass, because the canonical constants were amended in the same
diff; **LEASE-INTEGRITY stays green** — no other wave's entry is touched. Verifier
tally on the branch: 16 pass, CWR-P0-4 blocking, CWR-P1-3 non-gating (open tranche). The
founder reviews and merges despite the CWR-P0-4 red; every later branch then verifies
mechanically green against the amended `baseCommit`.

**Scope.** Seven additive-only grants added to WR's `allow` in `leases.json`, mirrored
byte-identically in WR-routing.md's Lease section with per-file "may only" bounds, **and
the verifier's `CANONICAL_ALLOW`/`EXPECTED_OVERLAPS`/`OVERLAP_FILES` constants amended in
the same diff** so the governance is self-consistent at `HEAD` and post-merge tranches
verify green (Sol BLOCK-2). The four capability grants: `backup/create.ts` (archived
`app-config.json` `routingPolicyVersion` key only — the `manifest.ts` contract stays
ungranted, Sol BLOCK-4), `chat.ts` (pinned types: `RoutingOverrideRequest | null` +
`string | null` fields, Sol WARN-6), `errors.ts` (`'ROUTING_BLOCKED'` line), and
`SettingsDialog.tsx` (RoutingPanel mount). Three further grants forced by the review:
`docs/plans/waves/DECISIONS.md` (this trail itself — append-only, mechanically enforced
via `OVERLAP_FILES`, Sol BLOCK-1), the single test file
`apps/web/tests/settings-dialog-routing.test.tsx` (Sol WARN-7), and
`apps/daemon/src/app-config.ts` (Sol round-2 P1: `filterAllowedKeys` would silently drop
the archived `routingPolicyVersion` key, so the marker needs additive
`AppConfigPrefs`/`ALLOWED_KEYS`/validator entries to survive restore). All six granted
files that exist at `baseCommit` are BYTE-PRESERVE-guarded (Sol BLOCK-3). Cross-wave notes: W1
is notified of the `chat.ts`/`errors.ts` grants (their `packages/contracts/**` lease; all
overlapping waves are landed, no live concurrent writer). Deliberately NOT granted: the
cross-runtime routed-application hook move before `getAgentDef` in `server.ts` (baseline
control-flow change — remains a founder-reviewed edit) and `runtimes/**` side-effect/lane
observability (future W1/WR coordination).
