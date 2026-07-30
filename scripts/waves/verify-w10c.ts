// verify-w10c.ts -- wave mishmash-w10c-toolbox (Toolbox reliability, NM-19)
// completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w10c.ts [--repo <path>]
// Exit 0 only when every C10C criterion (C10C-1..C10C-8) reads exactly
// "pass", GATE-INTEGRITY/LEASE/HEAD-DRIFT all pass, and the tree is clean.
// C10C-8 is human:-marked and may legitimately resolve "blocked-on-founder"
// per VERIFICATION-CONTRACT.md §3 R7 -- see the FIX ROUND 3 note below for
// why it was reinstated after being removed in an earlier round. The
// commit-bound proof manifest is written to the wave's goal-state proof
// directory either way.
//
// ===========================================================================
// FIX ROUND 1 -- this file was rewritten to close 8 numbered findings from an
// independent adversarial review of the prior draft. Each fix is tagged
// [R1-F<n>] at its point of use; docs/plans/waves/W10c-toolbox.md carries the
// full satisfiability/decoy argument for each. Summary:
//   F1 (package-relative paths + NodeNext dynamic-import requirement) --
//     every `pnpm --filter <pkg> exec ...` invocation now uses a path
//     relative to that PACKAGE's own root (confirmed live: `pnpm --filter
//     @open-design/e2e exec pwd` prints .../e2e), not the repo root. Any
//     runtime code in this file that needs apps/web/src/runtime/
//     design-toolbox.ts loads it via a DYNAMIC import() with a computed
//     specifier (via pathToFileURL), never a static import declaration --
//     confirmed live that a static import fails e2e's own NodeNext typecheck
//     (TS2835) while the dynamic form typechecks clean under this file's own
//     NodeNext project AND executes correctly under tsx.
//   F2/F3/F4 (C10C-2/3/4 checked import/title shape only, not behavior) --
//     each of these criteria now has TWO independent lines of evidence: (a)
//     this verifier's OWN direct execution of the real production code
//     (dynamic-imported design-toolbox.ts / apps/daemon/src/skills.ts,
//     called for real, against a real live registry -- for C10C-3 via a
//     freshly-booted isolated daemon, matching the "boot the daemon, make
//     the real request, assert the real response" instruction) as the
//     PRIMARY, unfakeable-by-a-delegated-file proof; (b) structural checks on
//     the required delegated artifact that bind to the EXACT exported name
//     (not a local-alias substring), require it to be CALLED (not just
//     imported), require the pinned phantom-fixture string to appear as a
//     genuine AST string-literal NODE (not merely present in raw text, which
//     a comment would also satisfy), and -- for C10C-2 specifically -- cross
//     check a runtime marker each per-action test must emit (captured via
//     Playwright's JSON reporter's confirmed-live results[].stdout[].text
//     schema) against this verifier's own freshly-computed expected value.
//   F5 (C10C-1's AST authority accepted an ambiguous/decoy declaration and
//     ignored extra object-literal members) -- the AST layer now requires a
//     UNIQUE top-level exported const declaration, rejects any object-literal
//     member outside the 5 real DesignToolboxAction fields (methods,
//     accessors, __proto__, shorthand, computed names all rejected), and
//     scans for push/splice/Object.assign/defineProperty/setPrototypeOf
//     mutation calls against the binding. On top of that, a RUNTIME layer
//     dynamically imports the real module and requires the actual executed
//     export to exactly match the AST reading -- closing the decoy-shape
//     problem from a second, independent direction regardless of how
//     thorough the AST enumeration is. The i18n cross-check is now scoped to
//     the unique `Dict` interface specifically, and en.ts coverage is
//     computed as an expected-key-set diff, not just an empty-string scan.
//   F6 (C10C-5 decoy argument falsely claimed order-detection) -- this file's
//     own header comment and the PRD text were corrected; multisetDiff never
//     claimed to detect ordering and does not.
//   F7 (C10C-7 spoofable: model unchecked, reviewer identity exact-string-only,
//     owned-path list incomplete) -- model is now validated non-empty;
//     reviewer-identity matching handles the "Name <email>" combined form and
//     whitespace via reviewerIdentityCandidates(); the owned-path list now
//     includes all 8 lease-allowed content files.
//   F8 (founder question 1 left as a soft, non-blocking open question when
//     repository authority makes it blocking) -- ORIGINALLY promoted to a
//     formal C10C-8 criterion (human:-marked, DECISIONS.md-gated). The
//     orchestrator has since ruled on all three of this PRD's open founder
//     questions directly (Orchestrator ruling under delegated founder
//     authority, 2026-07-28 -- see docs/plans/waves/W10c-toolbox.md §9):
//     ruling 1 is NO new toolbox-action HTTP/CLI capability, which closes the
//     question C10C-8 existed to gate -- C10C-8 is therefore REMOVED (a
//     criterion that would now trivially and permanently read "pass" is not
//     measuring anything); ruling 2 is YES, extend the exhaustive walk to
//     NextStepActions.tsx as a second catalogue consumer, with the two
//     consumers' featured/non-featured partition asserted explicitly -- C10C-2
//     below is extended accordingly (two required for-of loops, one per
//     consumer, 2x the per-action spec count, a dedicated partition check);
//     ruling 3 is KEEP scripts/check-toolbox-skill-refs.test.ts as a floor --
//     no code change here, it was never touched by this file.
// ===========================================================================
// FIX ROUND 3 -- a confirmation review REJECTED the round-2 draft with 7
// findings; the orchestrator additionally ruled that removing C10C-8 in
// round 2 was wrong and it must be reinstated. Each fix is tagged [R3-F<n>]:
//   F7/finding-7 (C10C-8 wrongly removed) -- REINSTATED. The
//     `### W10C-CAPABILITY-DECISION` block that landed on main via
//     docs/plans/waves/DECISIONS.md is a real, fail-able invariant: C10C-8
//     now reads it at baseCommit (never HEAD, since a wave branch cannot
//     reach the docs lane -- leases.json denies DECISIONS.md to W10c),
//     parses Decision/Decider/Date/Rationale, and checks the decider against
//     baseCommit's own commit authors. This proves the ruling landed through
//     the review lane that produced baseCommit -- it does NOT and cannot
//     cryptographically verify anyone's authority; the criterion text below
//     says so explicitly. Modeled on the W9-agent-spawn "C9S-8" mechanism
//     described in DECISIONS.md's W9AS-PARK record (the one part of that
//     package the reviewer found sound).
//   F2/F3 (unbound-import class) -- hasDestructuredBindingNamed and
//     hasNamedImportOfExactExport verified a PROPERTY/exported name existed
//     but threw away the LOCAL identifier the import actually binds to, and
//     countCallsToExactIdentifier then matched calls by the exported name's
//     TEXT -- so `const { findDesignToolboxSkill: _unused } = await
//     import(...)` (import present, never called) plus an unrelated local
//     `function findDesignToolboxSkill() {...}` (a lookalike decoy) passed
//     both checks by calling the decoy. findDestructuredImportBinding /
//     findNamedImportBinding now return the actual LOCAL NAME the import
//     produces, and every call-count check below counts calls to THAT local
//     name. In the non-adversarial case (no alias) this is a no-op, since an
//     unaliased import's local name equals its exported name. C10C-4 also
//     gained the PRD-required SKILL_ID_ALIASES import+reference check, and
//     the decorative "some ts.createSourceFile call exists somewhere" check
//     was replaced by usesCompilerApiForRealExtraction, which requires the
//     createSourceFile call's OWN RETURN VALUE to be bound to a variable
//     that is then passed as the first argument to a real ts.forEachChild
//     call -- a genuine, connected data-flow chain, not two decorative,
//     unrelated calls. C10C-3's raw regex checks for createSmokeSuite /
//     .with.toolsDev were replaced with real AST CallExpression checks.
//   F4/finding-4 (alias-mediated mutation) -- C10C-1's static
//     scanForMutationCalls only sees calls whose arguments directly contain
//     the DESIGN_TOOLBOX_ACTIONS identifier, so aliasing an array element
//     into a local variable before calling Object.defineProperty/
//     setPrototypeOf on it (or on one of its elements) dodges the scan
//     entirely. inspectRuntimeActionsShape now inspects the ACTUAL RUNTIME
//     VALUE returned by the dynamic import: exact own keys (no extras),
//     every field a plain enumerable DATA property (get/set accessor
//     descriptors are rejected outright, regardless of what value they
//     currently return), and Object.prototype/Array.prototype identity on
//     both the array and every element -- this is now the AUTHORITATIVE
//     check; the static scan stays only as cheap defense-in-depth.
//   F5/finding-5 (fail-closed safety, program-wide carry-forward) -- EVERY
//     probe fetch in this file (including C10C-3's second, previously-raw
//     `fetch(...)` call, now routed through fetchLiveSkillsOverHttp) sets
//     redirect:'manual' and re-validates origin/status before trusting a
//     response. withIsolatedDaemon's teardown no longer trusts a single
//     `tools-dev stop` exit code: it captures the daemon's own reported PID
//     at boot, parses the stop result's `status`/`stop.remainingPids`
//     fields, independently polls (process.kill(pid, 0)) to CONFIRM no
//     survivor remains, and -- since the sidecar is spawned with
//     detached:true (its PID is also its process-group id) -- escalates to
//     a process-GROUP SIGTERM/SIGKILL if anything survives. A `partial` stop
//     or an unconfirmed survivor now FAILS the calling criterion instead of
//     being silently ignored; this is exactly the bug DECISIONS.md's
//     W9AS-PARK record identifies (trusting a group leader's exit event
//     while a descendant in the same group survives).
//   F1/finding-1 (C10C-2 must prove the second consumer RENDERS the split)
//     -- deriving the non-featured id set as the complement of the featured
//     set proved a fact about the verifier's own arithmetic, not about
//     NextStepActions.tsx. C10C-2 now parses NextStepActions.tsx's OWN real
//     source and requires it to import FEATURED_DESIGN_TOOLBOX_ACTION_IDS
//     and compute its non-featured set via a `.filter(...)` referencing
//     that same import, requires the four pinned testid fragments to exist
//     as genuine `data-testid` JSX-attribute literal values in that file,
//     and replaces the old "selector text appears somewhere in the loop"
//     plus "some .click() appears somewhere in the loop" (two independent,
//     unbound facts that let one loop drive both surfaces or neither) with
//     countClickChainsReferencing, which requires each `.click()` call's own
//     RECEIVER subtree to contain the relevant selector fragment. The marker
//     parser also now validates the reported action id (capture group 1)
//     equals the id under test, not just extracting the value.
//   F6/finding-6 (whitespace-only reviewer) -- `if (!reviewer)` passed a
//     whitespace-only string (truthy, non-empty length) through to
//     identityMatchesAnyAuthor, which then matched no author -- so a
//     whitespace reviewer field silently passed. Both C10C-7's reviewer
//     check and C10C-8's decider check now reject a string that is empty
//     AFTER trimming, not just a falsy/missing one.
// ===========================================================================
// FIX ROUND 4 -- W10c was PARKED after round 3's REJECT (DECISIONS.md's
// W10C-PARK record), then RE-EXPANDED under founder-authorized re-expansion
// (2026-07-29: "i give my ok to unlock any founder gated portions... so
// there are no gates" -- a fresh authorized round, not a continuation of the
// capped 3-round arc). This round closes every one of W10C-PARK's five
// numbered findings, and applies the program-wide binding rule that decided
// the parking of three sibling waves (W10a, W10b, W9as): a criterion
// proving a binding/wiring/consumption claim by counting or matching
// identifiers in source is unsound by construction and must become a
// runtime-truth mechanism or a mutation-probe ("mutate the claimed binding,
// prove the check goes red"). Each fix is tagged [R4-F<n>] at its point of
// use:
//   F5/finding-5 (teardown, the deciding finding for the THIRD wave running
//     -- W9as, then W10c round 3, now closed here) -- confirmTeardown no
//     longer trusts a single tracked pid or `tools-dev stop`'s own report at
//     all. It is rebuilt on the exact semantics of killGroupFailClosed in
//     scripts/waves/verify-w9-filesystem.ts (the sibling wave DECISIONS.md
//     names as having gotten this right): a real group-wide `ps` scan
//     (processGroupSurvivors) is the only thing ever trusted; `ps` itself
//     failing is treated as an UNCONFIRMED survivor set, never as proof of a
//     clean exit; a missing boot pid is a hard failure (there is no group id
//     to scan), never a silent success; escalation signals the process
//     GROUP (never a leader-only or individually-tracked-PID-only signal)
//     and re-confirms via the same group-wide scan; and
//     withIsolatedDaemon's temp data directory is now removed ONLY when
//     teardown is independently confirmed, never unconditionally.
//   F2/F3/finding-2/finding-3 (C10C-3(b)/C10C-4(b) unbound-import class,
//     SAME defect surviving a THIRD round per DECISIONS.md's W10C-PARK
//     record: "countCallsToExactIdentifier counts obj._unused() as a call
//     to an imported binding named _unused; SKILL_ID_ALIASES is satisfied
//     by a bare property-name occurrence; the compiler-API check ties
//     createSourceFile to forEachChild rather than to reading the real
//     toolbox source") -- the identifier-count/reference/connectivity
//     checks this class depends on are REMOVED, not re-patched a fourth
//     time. In their place: withPoisonedFile backs up the real production
//     function (findDesignToolboxSkill / findSkillById), splices a poison
//     return-statement immediately after its own unique signature text,
//     reruns the exact same delegated test file, and requires its
//     positive-control assertion (and, for C10C-4, every per-action
//     coverage assertion) to flip RED under poison -- proof the assertion
//     is genuinely bound to the real function, something no amount of
//     identifier counting can prove, since the space of source shapes that
//     produce a given runtime behavior is unbounded (DECISIONS.md's
//     W9AS-PARK record) but a poisoned function can only be observed
//     through a REAL call. The SKILL_ID_ALIASES reference check and the
//     createSourceFile/forEachChild connectivity check are DROPPED outright
//     rather than replaced: SKILL_ID_ALIASES has no runtime observable
//     given today's zero-live-alias baseline (C10C-4(a) already exercises
//     it on every call regardless), and the connectivity claim is subsumed
//     by the mutation probe (which does not care how ids were extracted,
//     only whether the assertion depends on the real function) plus the
//     pre-existing exact-title coverage check (which already fails on a
//     stale/hardcoded id snapshot the moment C10C-1 derives a new id).
//     Import-presence checks (does the file import this exact export name)
//     are KEPT -- an import specifier's presence has no runtime observable
//     and was never the part of this class that failed.
//   F1/finding-1 (C10C-2 behavioral false green -- the side-panel loop
//     required only a click on chat-plus-trigger plus ANY textContent call,
//     never the "Design toolbox" click, the action-row click, or a read
//     bound to chat-composer-input; the reported marker was compared
//     without being bound to the observed text at all) -- closed with a
//     bounded, single-loop-body structural extension (NOT a whole-file
//     identifier-occurrence scan, so this is not a re-run of the F2/F3
//     defect class): countTextContentChainsReferencing binds the required
//     read to the chat-composer-input selector the same way
//     countClickChainsReferencing already bound clicks;
//     countClickChainsReferencingIdentifier proves at least one click
//     target depends on the loop's own per-action iteration variable (the
//     action-row click, which has no fixed string to bind to);
//     collectObservedReadVariableNames + consoleLogArgumentsReferenceAnyIdentifier
//     trace the marker's console.log(...) argument back to a variable
//     genuinely derived from the required DOM read; and
//     consoleLogArgumentsReferenceIdentifierDirectly rejects the literal
//     shape the finding named -- a marker computed directly from the
//     dynamic-imported findDesignToolboxSkill binding. Applied identically
//     to both the side-panel and next-step loops. A full mutation-probe
//     alternative (poisoning the legacy UI click-handling/composer-insertion
//     code in ChatComposer.tsx/DesignToolboxPanel to create an observable
//     DOM-vs-resolver divergence) was considered and deliberately NOT built:
//     that code is pre-existing, out of this wave's leased surface, and
//     poisoning it correctly would require deep familiarity with a
//     2800+-line file this wave does not otherwise touch, for a
//     pre-implementation verifier-authoring round. The chosen fix is
//     proportionate: Playwright's `.click()`/`.textContent()` are already
//     real DOM interactions against a real running app (unlike the pure
//     AST-freezing pattern that killed W10a/W10b/W9as), and the dataflow
//     trace closes the specific gap the finding named without claiming more
//     than it proves.
//   F4/finding-4 (C10C-1 Layer C incomplete -- "array numeric-property
//     descriptors are never inspected, symbol keys lost via
//     getOwnPropertyNames/keys") -- completed, not replaced, per
//     DECISIONS.md's own instruction ("C10C-1's live-value inspection is
//     genuinely runtime but incomplete... needs completing, not
//     replacing"). inspectStringArrayRuntimeShapeDeep adds an explicit
//     per-index Object.getOwnPropertyDescriptor scan (forEach/every both
//     INVOKE a getter to read a value, so neither can detect one stashed at
//     a numeric index -- only an explicit descriptor scan can) and an
//     Object.getOwnPropertySymbols scan (Object.getOwnPropertyNames/keys
//     never enumerate symbol-keyed own properties at all). Applied to the
//     outer DESIGN_TOOLBOX_ACTIONS array, every element's own symbol keys,
//     and -- newly, per the finding's second half ("only preferredSkillIds
//     receives nested-array validation, not the production-relevant
//     categoryHints and searchTerms") -- all three array-valued
//     DesignToolboxAction fields, not just preferredSkillIds.
// ===========================================================================
// FIX ROUND 5 -- round 4 (the first round of the founder-authorized
// re-expansion arc) REJECTED with 10 findings (8 HIGH, 2 MEDIUM). Every
// finding is closed below; tagged [R5-F<n>] at its point of use.
//   F1/F9 (mutation-probe soundness -- NOT SOUND): the round-4 probes
//     accepted a crashed suite or empty reporter output as "flipped red"
//     (an empty assertionResults[] trivially satisfies "not passed"; a pure
//     probe reproduced accepted=true against an empty reporter). Fixed with
//     requireAttributableFailure: a poison run must produce a PARSEABLE
//     report, numTotalTests > 0, the NAMED test present, status==="failed",
//     AND a non-empty failureMessages[] -- anything short of that is a
//     PROBE FAILURE (fail-closed), never accepted as red. Anchoring moved
//     from raw-text occurrence counting to DECLARATION-SCOPED AST location
//     (locateTopLevelFunctionBodyInsertionPoint), immune to harmless
//     signature reformatting and to a decoy comment/string containing the
//     function name (both confirmed live). Restoration is now signal-safe
//     (process.once('exit'/'SIGINT'/'SIGTERM', ...) triggers synchronous
//     restore) and independently BYTE-IDENTICAL VERIFIED on every exit path
//     this process's own control flow can observe, dominating whatever the
//     probe callback itself reported.
//   F2/ruling-b (C10C-2 marker not bound to chat-composer-input, SCOPE NOT
//     LEGITIMATE / BINDING NOT SOUND): collectObservedReadVariableNames
//     previously collected a variable from ANY textContent/innerText read,
//     independently of the separate bound-presence check
//     (countTextContentChainsReferencing) -- a decoy could perform the real
//     chat-composer-input read into an unused variable (satisfying
//     presence) while logging an UNRELATED locator seeded with the expected
//     value (satisfying "marker derived from an observed read"). Fixed by
//     binding the collector to the SAME fragment via the SAME receiver-walk
//     discipline countClickChainsReferencing already uses, so both checks
//     describe the identical read. The reviewer separately ruled the prior
//     "no probe here, would require leasing legacy UI files" reasoning
//     invalid -- poisoning findDesignToolboxSkill is already done elsewhere
//     in this file and is already in-lease; C10C-2 now ALSO runs that exact
//     mutation probe against the real Playwright suite and requires every
//     marker in both consumers to flip to "__NONE__".
//   F3/F5 (teardown fail-open on required paths, Playwright-side cleanup):
//     a `tools-dev start` that timed out or exited nonzero AFTER partially
//     spawning a process left `started=false`, skipping confirmTeardown
//     entirely and deleting the data dir. Fixed: the `started` guard is
//     removed -- confirmTeardown now runs on EVERY exit path, unconditionally.
//     Separately, confirmTeardown previously ignored `stop`'s own exit/status
//     entirely (a failed/unparseable/partial self-report could still resolve
//     "ok" whenever the later scan was empty); confirmTeardown now requires
//     BOTH a clean self-report (exit 0, parseable, status "stopped" or
//     "not-running") AND an independently confirmed empty group -- either
//     one failing fails the whole teardown, even though escalation still
//     runs for real process hygiene regardless. The Playwright-side cleanup
//     weakness in e2e/lib/playwright/suite.ts / e2e/lib/tools-dev/runtime.ts
//     is confirmed real but OUT OF SCOPE for this verifier+PRD-only wave
//     (shared e2e infra, not owned by W10c's lease) -- documented in the PRD.
//   F4 (target-visibility unproved and vacuous): an exit-zero `ps` with
//     empty/malformed output previously returned `[]` (a clean-looking
//     empty survivor list) rather than being classified as untrustworthy,
//     and no control ever proved the scan mechanism could see the TARGET's
//     own session before trusting a later "empty" reading. Ported (adapted)
//     from scripts/waves/verify-w9-filesystem.ts@0d6bf026f:
//     classifyProcessTableScan (self-visibility control: this verifier's
//     own known-alive pid must appear in the enumeration or the scan is
//     untrustworthy) + evaluateTargetVisibility (a POSITIVE control,
//     captured at boot time before any signal: while the target is
//     independently confirmed alive via process.kill(pid,0), the SAME ps
//     scan must ALSO show a row for its pgid). Validated LIVE, not just via
//     the synthetic self-probe table: a real spawned sentinel plus a
//     PATH-shimmed `ps` that filters out its pgid fooled the old
//     self-visibility-only logic (ok:true despite the target's whole
//     session being invisible) and was correctly rejected by the new
//     target-visibility-gated logic.
//   F6 (dropped compiler-source-connectivity check REGRESSED, not
//     subsumed): a suite can hardcode today's action ids while genuinely
//     calling findSkillById and pass every mutation/title check, since
//     poisoning findSkillById alone cannot prove the coverage SET tracks
//     live source content. Fixed with a REGISTRY-CONTENT mutation probe
//     (withRegistryContentMutationProbe): appends one synthetic,
//     real-resolving action to DESIGN_TOOLBOX_ACTIONS's own array literal
//     (AST-located, modeled on the real first element's own text) in a
//     transient copy and requires a NEW passing coverage title for it to
//     appear -- a hardcoded suite can never produce a title for an id that
//     did not exist when it was authored. Validated live against the real
//     production file (correctly resolves the seeded skill id, restores
//     byte-identical) -- this validation also caught and fixed a real
//     off-by-one bug in the splice itself: the array's last element already
//     ends with a trailing comma, so unconditionally prepending another one
//     produced a SPARSE-ARRAY HOLE (`[a, b, , c]`) instead of a new element;
//     the splice now checks for an existing trailing comma first.
//   F7 (C10C-1 Layer C still admits alias mutation via non-canonical
//     numeric-looking keys): `/^\d+$/` wrongly classified "01" as a numeric
//     index, excluding it from the extra-own-properties check while the
//     `0..length-1` descriptor loop (which only ever produces canonical
//     "0","1",...) never visits it either -- a property installed at
//     exactly that key evaded both. Fixed with isCanonicalArrayIndexKey
//     (String(Number(k)) === k), the correct ECMAScript array-index test.
//   F8 (transitive commit-binding incomplete): `tools-dev` self-checks only
//     its own bundled source hash, while it and the daemon it boots
//     transitively resolve gitignored packages/*  `dist/` output (platform,
//     sidecar, sidecar-proto) with no rebuild/hash validation -- a stale or
//     hand-edited dist could drive lifecycle/runtime evidence invisibly to
//     git. Fixed, ported from verify-w9-filesystem.ts@0d6bf026f's INVARIANT
//     2: ensureFirstPartyPackagesRebuiltFromHead rebuilds every
//     `packages/*` workspace member unconditionally (not a narrower
//     per-path dependency closure, which INVARIANT 2's own history shows
//     silently reopens the gap for a THIRD evidence path later), memoized
//     once per verifier process, called from both the isolated-daemon boot
//     path and C10C-6's guard/typecheck check.
//   Verifier fingerprints (lesson battery): the poison splices' own
//     identifying comment text ("w10c-verifier-mutation-probe: ...") is
//     removed entirely (a bare return statement needs no explanatory
//     comment baked into the poisoned file), and the reverse-poison dummy
//     value's id string no longer contains "w10c"/"mutation-probe" that a
//     hostile test could pattern-match on to detect it is being probed
//     specifically. The shared proof-directory/env-var naming convention
//     (WAVE_SLUG, PLAYWRIGHT_JSON_OUTPUT_NAME) is left as-is -- it is
//     program-wide shared infrastructure, not W10c-specific, and the
//     crash-as-red closure above already closes the exploit path a decoy
//     could otherwise use such a fingerprint for (detecting "I am being
//     probed" and crashing on purpose no longer helps it, since a crash is
//     now a PROBE FAILURE, not an accepted red).
//   F10 (phantom/red-spec attribution incomplete): C10C-3 previously
//     poisoned only the positive path; C10C-4's own oracle never exercised
//     its phantom id at all, and neither delegated negative-control test
//     was mutation-bound. Fixed: both C10C-3 and C10C-4 now run a SECOND,
//     independent REVERSE-poison probe (findDesignToolboxSkill/findSkillById
//     forced to always return a truthy dummy) requiring the NEGATIVE
//     control test to show an attributable failure; C10C-4(a)'s oracle now
//     also calls findSkillById with the same phantom literal C10C-4(b) uses
//     and requires it to resolve to undefined, mirroring C10C-3(a)'s
//     existing paired positive+negative shape.
// ===========================================================================
//
// Anti-gaming compliance notes (verifier defect catalog):
//   1. This file writes no generated script/JS content to disk itself -- no
//      runner-script generation, no fixture-file writes. `node --check` has
//      nothing generated to validate.
//   2. Object/array spreads inside DESIGN_TOOLBOX_ACTIONS are banned at any
//      depth (hasSpreadDeep / per-element scans), and the runtime cross-check
//      (Layer B) catches any residual divergence a spread-based decoy could
//      still produce even if it dodged the AST ban.
//   3. Every id-set comparison in this file is a multiset/occurrence-count
//      comparison (multisetDiff), never bare Set difference.
//   4. Every "must be rejected" check is paired with a positive control per
//      criterion (C10C-1 Layer A+B agreement, C10C-3/C10C-4's paired
//      positive+negative oracle calls and pinned test titles).
//   5. Every TS source extraction below uses the TypeScript compiler API
//      (ts.createSourceFile + AST walks), never a regex/string scan of TS
//      source.
//   6. Every "does this test bind to real production code" check resolves
//      to the EXACT exported name (never a local-alias substring) and
//      requires an actual CALL site, not just an import.
//   7. N/A here (no JSX under test).
//   8. Every count this file asserts on is derived at verifier runtime from
//      the repo, never hardcoded.
//   9. Dynamic import()/require of design-toolbox.ts by a future test file
//      is exactly the pattern this verifier requires and structurally
//      checks for (a string-literal fragment inside the import() argument
//      subtree); the verifier's own runtime oracles additionally make the
//      BEHAVIORAL claim independent of how faithfully any delegated file's
//      loading mechanism is captured statically.
//  10. Every runtime probe in this file uses redirect:'manual', validates
//      the URL's origin against the discovered daemon's own loopback origin
//      immediately before each request, and hard-fails if the discovered
//      port is 7456 or 51012 -- it never requests either port. Daemon
//      teardown kills by the exact PID `tools-dev` itself reports owns the
//      listener (via `tools-dev stop daemon --namespace <ns>`, which targets
//      that namespace's own tracked process, not a wrapper shell).
//  11. Every criterion carries satisfiability + decoy arguments in
//      docs/plans/waves/W10c-toolbox.md; this file is the mechanical half.
//  12. This run is expected to exit non-zero pre-implementation.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type TypeScriptModule from 'typescript';

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx === -1 ? undefined : argv[idx + 1];
}

const WAVE_SLUG = 'mishmash-w10c-toolbox';

function emergencyExit(errorMessage: string): never {
  try {
    const manifest = {
      wave: 'W10c',
      commit: 'unknown',
      treeDirty: true,
      baseCommit: 'unknown',
      wroteOk: false,
      gateIntegrityPinned: false,
      toolchain: { node: process.version, pnpm: 'unknown' },
      criteria: [
        {
          id: 'INIT-FAILURE',
          command: 'module init',
          assertion: 'the verifier can initialize before any criterion runs',
          artifact: null,
          artifactSha256: null,
          exitCode: 1,
          status: 'fail',
          durationMs: 0,
          detail: errorMessage,
        },
      ],
    };
    fs.writeFileSync(
      path.join(os.tmpdir(), 'verify-w10c-emergency-manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
  } catch {
    /* truly nothing more we can do */
  }
  console.error(`verify-w10c: FATAL during init: ${errorMessage}`);
  process.exit(1);
}

let repoRoot: string;
let proofDir: string;
let ts: typeof TypeScriptModule;
try {
  repoRoot = path.resolve(argValue('--repo') ?? process.cwd());
  proofDir = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'proof');
  fs.mkdirSync(proofDir, { recursive: true });
  ts = createRequire(path.join(repoRoot, 'package.json'))('typescript') as typeof TypeScriptModule;
} catch (err) {
  emergencyExit(`init failed: ${String((err as Error)?.stack ?? err)}`);
}

function sh(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): { status: number; stdout: string; stderr: string; processError: boolean } {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? repoRoot,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 10 * 60_000,
    env: opts.env ?? process.env,
  });
  const processError = !!result.error || !!result.signal;
  if (result.error) {
    return { status: 1, stdout: result.stdout ?? '', stderr: `${result.stderr ?? ''}\n${String(result.error)}`, processError: true };
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '', processError };
}

function sha256Bytes(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function sha256File(absPath: string): string {
  return sha256Bytes(fs.readFileSync(absPath));
}

type Verdict = 'pass' | 'fail' | 'blocked-on-founder';

interface CriterionResult {
  id: string;
  command: string;
  assertion: string;
  artifact: string | null;
  artifactSha256: string | null;
  exitCode: number;
  status: Verdict;
  durationMs: number;
  detail?: string | undefined;
}

function artifactFor(id: string, content: string): { artifact: string | null; artifactSha256: string | null } {
  const primary = path.join(proofDir, `${id}.txt`);
  const tryWrite = (target: string): { artifact: string; artifactSha256: string } | null => {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      return { artifact: target, artifactSha256: sha256Bytes(fs.readFileSync(target)) };
    } catch {
      return null;
    }
  };
  const primaryResult = tryWrite(primary);
  if (primaryResult) return primaryResult;
  const fallbackResult = tryWrite(path.join(os.tmpdir(), 'verify-w10c-fallback-proof', `${id}.txt`));
  if (fallbackResult) return fallbackResult;
  console.error(`verify-w10c: artifact write failed for ${id} on both primary and fallback paths`);
  return { artifact: null, artifactSha256: null };
}

const results: CriterionResult[] = [];
function record(
  id: string,
  command: string,
  assertion: string,
  ok: boolean | 'blocked-on-founder',
  evidence: string,
  opts: { detail?: string | undefined; durationMs?: number } = {},
): void {
  const verdict: Verdict = ok === 'blocked-on-founder' ? 'blocked-on-founder' : ok ? 'pass' : 'fail';
  try {
    const { artifact, artifactSha256 } = artifactFor(
      id,
      `# ${id}\n# assertion: ${assertion}\n# verdict: ${verdict}\n${opts.detail ? `# detail: ${opts.detail}\n` : ''}\n${evidence}\n`,
    );
    const effectiveVerdict: Verdict = artifact === null && verdict === 'pass' ? 'fail' : verdict;
    results.push({
      id,
      command,
      assertion,
      artifact,
      artifactSha256,
      exitCode: effectiveVerdict === 'pass' ? 0 : 1,
      status: effectiveVerdict,
      durationMs: opts.durationMs ?? 0,
      detail: artifact === null ? `${opts.detail ? `${opts.detail}; ` : ''}artifact write failed -- forced fail` : opts.detail,
    });
  } catch (err) {
    results.push({
      id,
      command,
      assertion,
      artifact: null,
      artifactSha256: null,
      exitCode: 1,
      status: 'fail',
      durationMs: opts.durationMs ?? 0,
      detail: `record() itself failed: ${String(err)}`,
    });
  }
}

async function checkCriterion(id: string, fn: () => Promise<void> | void): Promise<void> {
  const startedAt = Date.now();
  const startIndex = results.length;
  try {
    await fn();
    const durationMs = Date.now() - startedAt;
    for (let i = startIndex; i < results.length; i++) {
      const r = results[i];
      if (r) r.durationMs = durationMs;
    }
    if (results.length === startIndex) {
      record(id, '', '', false, '', { detail: 'criterion function completed without recording a result', durationMs });
    }
  } catch (err) {
    record(id, '', '', false, String((err as Error)?.stack ?? err), {
      detail: `criterion check crashed: ${String(err)}`,
      durationMs: Date.now() - startedAt,
    });
  }
}

// -----------------------------------------------------------------------
// Git context -- local refs only, no fetch/push.
// -----------------------------------------------------------------------
function gitOrFail(args: string[], why: string): string {
  const r = sh('git', args);
  if (r.status !== 0 || r.stdout.trim().length === 0) {
    throw new Error(`git ${args.join(' ')} failed (${why}): exit=${r.status} stdout=${r.stdout.trim().slice(0, 200) || '<empty>'}`);
  }
  return r.stdout.trim();
}
function resolveMainRefLocal(): string {
  for (const ref of ['origin/main', 'main']) {
    const verify = sh('git', ['rev-parse', '--verify', ref]);
    if (verify.status === 0 && verify.stdout.trim()) return ref;
  }
  throw new Error('could not resolve "origin/main" or "main" locally (no network ref-check -- this verifier never fetches)');
}
function writeEmergencyManifest(errorMessage: string, partialResults: CriterionResult[] = []): void {
  const manifest = {
    wave: 'W10c',
    commit: 'unknown',
    treeDirty: true,
    baseCommit: 'unknown',
    wroteOk: false,
    gateIntegrityPinned: false,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: [
      ...partialResults,
      {
        id: 'GIT-RESOLUTION',
        command: 'git rev-parse HEAD / git merge-base',
        assertion: 'HEAD and baseCommit resolve to real, non-empty commits before any criterion runs',
        artifact: null,
        artifactSha256: null,
        exitCode: 1,
        status: 'fail',
        durationMs: 0,
        detail: errorMessage,
      },
    ],
  };
  let wrote = false;
  try {
    fs.mkdirSync(proofDir, { recursive: true });
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, path.join(proofDir, 'manifest.json'));
    wrote = true;
  } catch {
    /* fall through to guarded fallback */
  }
  if (!wrote) {
    try {
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w10c-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
    } catch {
      /* last resort: stderr only */
    }
  }
  console.error(`verify-w10c: FATAL, emergency manifest written=${wrote}: ${errorMessage}`);
}
function resolveGitContextOrExit(): { headSha: string; baseCommit: string } {
  try {
    const resolvedHeadSha = gitOrFail(['rev-parse', 'HEAD'], 'resolving HEAD commit');
    const mainRef = resolveMainRefLocal();
    const mainSha = gitOrFail(['rev-parse', mainRef], 'resolving main ref');
    const resolvedBaseCommit = gitOrFail(['merge-base', mainSha, resolvedHeadSha], 'computing baseCommit');
    return { headSha: resolvedHeadSha, baseCommit: resolvedBaseCommit };
  } catch (err) {
    writeEmergencyManifest(String((err as Error)?.stack ?? err));
    process.exit(1);
  }
}
const { headSha, baseCommit } = resolveGitContextOrExit();
function readFileAtCommit(commit: string, relPath: string): string {
  const r = sh('git', ['show', `${commit}:${relPath}`]);
  if (r.status !== 0) throw new Error(`git show ${commit}:${relPath} failed (exit=${r.status}): ${r.stdout.slice(0, 300)}`);
  return r.stdout;
}
function isAncestor(ancestor: string, descendant: string): boolean {
  return sh('git', ['merge-base', '--is-ancestor', ancestor, descendant]).status === 0;
}
function resolveCommit(sha: string): boolean {
  return sh('git', ['cat-file', '-e', `${sha}^{commit}`]).status === 0;
}
function commitAuthorsBetween(fromExclusive: string, toInclusive: string): Set<string> {
  const r = sh('git', ['log', '--format=%an%x00%ae', `${fromExclusive}..${toInclusive}`]);
  const out = new Set<string>();
  if (r.status !== 0) return out;
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\x00');
    if (parts[0]) out.add(parts[0].trim().toLowerCase());
    if (parts[1]) out.add(parts[1].trim().toLowerCase());
  }
  return out;
}
// [R1-F7] Handles a combined "Name <email>" identity string and surrounding
// whitespace: returns every candidate substring (the whole trimmed string,
// plus the name-only and email-only parts when a "<...>" suffix is present)
// so a caller can check each against an authors set built from bare
// name/email entries -- a single exact-string comparison previously let
// "Jane Doe <jane@example.com>" dodge a match against a bare "jane doe" or
// "jane@example.com" author entry.
function reviewerIdentityCandidates(raw: string): string[] {
  const trimmed = raw.trim().toLowerCase();
  const candidates = new Set<string>([trimmed]);
  const m = /^(.*)<([^>]+)>$/.exec(trimmed);
  if (m) {
    const namePart = (m[1] ?? '').trim();
    const emailPart = (m[2] ?? '').trim();
    if (namePart) candidates.add(namePart);
    if (emailPart) candidates.add(emailPart);
  }
  return [...candidates].filter((c) => c.length > 0);
}
function identityMatchesAnyAuthor(raw: string, authors: Set<string>): boolean {
  return reviewerIdentityCandidates(raw).some((c) => authors.has(c));
}

const gateIntegrityPinned = fs.existsSync(path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'approved-gate.sha256'));

// =========================================================================
// Two-phase manifest write.
// =========================================================================
interface ManifestShape {
  wave: string;
  commit: string;
  treeDirty: boolean;
  baseCommit: string;
  wroteOk: boolean;
  gateIntegrityPinned: boolean;
  toolchain: { node: string; pnpm: string };
  criteria: CriterionResult[];
}
function buildManifest(wroteOk: boolean, treeDirty: boolean): ManifestShape {
  return {
    wave: 'W10c',
    commit: headSha,
    treeDirty,
    baseCommit,
    wroteOk,
    gateIntegrityPinned,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: results,
  };
}
function writeManifestFile(manifest: ManifestShape): { written: boolean; sha256: string } {
  const manifestPath = path.join(proofDir, 'manifest.json');
  try {
    const content = JSON.stringify(manifest, null, 2);
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, manifestPath);
    return { written: true, sha256: sha256Bytes(content) };
  } catch (err) {
    console.error(`verify-w10c: FAILED to write manifest.json: ${String(err)}`);
    return { written: false, sha256: '' };
  }
}
{
  const placeholderWrite = writeManifestFile(buildManifest(false, true));
  if (!placeholderWrite.written) {
    writeEmergencyManifest('initial wroteOk:false placeholder manifest write failed -- aborting before any criterion runs');
    process.exit(1);
  }
}

// =========================================================================
// TypeScript-compiler-API extraction + structural-binding helpers.
// =========================================================================

function hasSpreadDeep(node: TypeScriptModule.Node): boolean {
  let found = false;
  function visit(n: TypeScriptModule.Node): void {
    if (found) return;
    if (ts.isSpreadAssignment(n) || ts.isSpreadElement(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return found;
}
function stringLiteralValue(node: TypeScriptModule.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}
function propertyName(name: TypeScriptModule.PropertyName): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  if (ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}
// [R3-F1] .tsx files must parse with ScriptKind.TSX, or JSX syntax
// (<div data-testid=...>) is never recognized as JSX at all -- discovered
// empirically: parsing NextStepActions.tsx with the hardcoded ScriptKind.TS
// this function previously always used meant ts.isJsxAttribute could never
// match anything, making the testid-literal check permanently unsatisfiable
// regardless of how correct a real implementation's source was.
function parseTs(fileName: string, sourceText: string): TypeScriptModule.SourceFile {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
}
// Collects every string-literal / no-substitution-template-literal NODE
// VALUE in the file -- used to prove a pinned fixture string is a genuine
// AST literal, never merely present in a comment (which a raw .includes()
// scan would wrongly accept). [R1-F3]
function collectAllStringLiteralValues(sf: TypeScriptModule.SourceFile): Set<string> {
  const out = new Set<string>();
  function visit(n: TypeScriptModule.Node): void {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.add(n.text);
    ts.forEachChild(n, visit);
  }
  visit(sf);
  return out;
}
function containsBannedTestMarker(sf: TypeScriptModule.SourceFile): string[] {
  const hits: string[] = [];
  function visit(node: TypeScriptModule.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      ['test', 'it', 'describe'].includes(node.expression.expression.text) &&
      ['skip', 'only', 'fixme', 'todo'].includes(node.expression.name.text)
    ) {
      hits.push(`${node.expression.expression.text}.${node.expression.name.text}(...)`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return hits;
}
function countCallsToExactIdentifier(sf: TypeScriptModule.SourceFile, exactName: string): number {
  let count = 0;
  function visit(node: TypeScriptModule.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === exactName) count++;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === exactName) count++;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return count;
}
// [R1-F1] Dynamic import() with a computed (non-string-literal) argument
// cannot be resolved to an exact file path by pure syntax, so this checks
// the weaker-but-real structural signal the PRD names: the import() call's
// argument subtree contains a string-literal fragment naming the target
// file, AND the call is a genuine dynamic import (ImportKeyword callee).
function hasDynamicImportReferencingFile(sf: TypeScriptModule.SourceFile, fileNameFragment: string): boolean {
  let found = false;
  function visit(node: TypeScriptModule.Node): void {
    if (found) return;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg) {
        let hit = false;
        function inner(n: TypeScriptModule.Node): void {
          if (hit) return;
          if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text.includes(fileNameFragment)) hit = true;
          ts.forEachChild(n, inner);
        }
        inner(arg);
        if (hit) found = true;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}
interface ImportBinding {
  found: boolean;
  localName: string | null;
}
// [R3-F2/F3] Does an ObjectBindingPattern anywhere in the file destructure a
// property named exactly `exactPropertyName`, and if so, what LOCAL
// IDENTIFIER does that binding actually produce? A destructure can rename
// away from the original property (`{ findDesignToolboxSkill: _unused }`),
// in which case `localName` is `_unused` -- callers MUST count calls to
// `localName`, never to `exactPropertyName` itself, or an unrelated local
// function sharing the property's original name silently absorbs the call
// count instead of the real import.
function findDestructuredImportBinding(sf: TypeScriptModule.SourceFile, exactPropertyName: string): ImportBinding {
  let result: ImportBinding = { found: false, localName: null };
  function visit(node: TypeScriptModule.Node): void {
    if (result.found) return;
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const effectiveName = node.propertyName ? propertyName(node.propertyName) : ts.isIdentifier(node.name) ? node.name.text : null;
      if (effectiveName === exactPropertyName && ts.isIdentifier(node.name)) {
        result = { found: true, localName: node.name.text };
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return result;
}
// [R3-F2/F3] Real ES `import { a, b as c } from '...'` -- checks the
// ORIGINAL exported name (propertyName ?? name) for presence, but returns
// the LOCAL identifier (`name.text`) the import actually binds in this
// file's scope, which callers must count calls against. For a normal,
// non-aliased import (no `as` clause) localName === exactExportedName, so
// this is a no-op change for the common case; only an adversarial alias
// makes the two diverge, which is exactly when the distinction matters.
function findNamedImportBinding(sf: TypeScriptModule.SourceFile, exactExportedName: string, moduleSpecifierFragment: string): ImportBinding {
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const spec = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(spec) || !spec.text.includes(moduleSpecifierFragment)) continue;
    const clause = stmt.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const el of clause.namedBindings.elements) {
      const originalName = el.propertyName ? el.propertyName.text : el.name.text;
      if (originalName === exactExportedName) return { found: true, localName: el.name.text };
    }
  }
  return { found: false, localName: null };
}
// [R4-F3] countIdentifierReferences (whole-file identifier-occurrence
// counting, previously used for the SKILL_ID_ALIASES "referenced" check)
// and usesCompilerApiForRealExtraction (createSourceFile-to-forEachChild
// connectivity) were REMOVED in this round -- both were structural-binding
// checks of the exact class DECISIONS.md's W10C-PARK record names as having
// failed three straight review rounds. SKILL_ID_ALIASES has no runtime
// observable given today's zero-live-alias baseline (removing the check
// costs nothing C10C-4(a)'s direct execution doesn't already cover, since
// every findSkillById call unconditionally consults SKILL_ID_ALIASES via
// resolveSkillId); the compiler-API connectivity claim is now subsumed by
// the mutation probe in C10C-4 (poisoning findSkillById requires every
// per-action coverage test to flip red, which already proves genuine
// binding regardless of how ids were extracted) and by the pre-existing
// exact-title coverage check (a hardcoded/stale id snapshot fails outright
// the moment C10C-1 derives a new id with no matching passing title).
// Locates every `for (const X of <binding referencing iterableNameSubstring>)`
// loop whose body directly contains a `test(...)` call -- required shape for
// C10C-2's table-driven per-action generation. Returns ALL matches (plural),
// not just the first: [R1-F2]/orchestrator-ruling-2 extended C10C-2 to require
// TWO such loops in the same file (one per catalogue consumer), and the two
// must be told apart by what each loop body actually references, not by
// assuming the first match is "the" loop.
function findAllForOfLoopsGeneratingTests(sf: TypeScriptModule.SourceFile, iterableNameSubstring: string): TypeScriptModule.ForOfStatement[] {
  const found: TypeScriptModule.ForOfStatement[] = [];
  function subtreeReferencesName(node: TypeScriptModule.Node): boolean {
    let hit = false;
    function inner(n: TypeScriptModule.Node): void {
      if (hit) return;
      if (ts.isIdentifier(n) && n.text.includes(iterableNameSubstring)) hit = true;
      ts.forEachChild(n, inner);
    }
    inner(node);
    return hit;
  }
  function bodyHasTestCall(node: TypeScriptModule.Node): boolean {
    let hit = false;
    function inner(n: TypeScriptModule.Node): void {
      if (hit) return;
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'test') hit = true;
      ts.forEachChild(n, inner);
    }
    inner(node);
    return hit;
  }
  function visit(node: TypeScriptModule.Node): void {
    if (ts.isForOfStatement(node) && subtreeReferencesName(node.expression) && bodyHasTestCall(node.statement)) {
      found.push(node);
      return; // do not descend into a matched loop looking for a nested match
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}
function subtreeHasMethodCall(node: TypeScriptModule.Node, methodNames: string[]): boolean {
  let found = false;
  function visit(n: TypeScriptModule.Node): void {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && methodNames.includes(n.expression.name.text)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return found;
}
// Does any string-literal/template-literal NODE inside this subtree contain
// `fragment`? Used to tell C10C-2's two required for-of loops apart by which
// consumer's selectors each one actually references (e.g. "chat-plus-trigger"
// vs. "next-step-toolbox"), rather than assuming loop order.
function subtreeContainsStringLiteralFragment(node: TypeScriptModule.Node, fragment: string): boolean {
  let found = false;
  function inner(n: TypeScriptModule.Node): void {
    if (found) return;
    if (
      (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) &&
      n.text.includes(fragment)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, inner);
  }
  inner(node);
  return found;
}
// [R3-F2/F3] Real AST check for a chained method call like `X.with.toolsDev(
// ...)`: a CallExpression whose callee, walked backwards through nested
// PropertyAccessExpressions, matches `propertyChain` exactly -- replaces a
// raw regex/text scan (`/\.with\.toolsDev/.test(source)`) that a comment or
// unrelated identically-spelled chain would also satisfy.
function hasChainedMethodCall(sf: TypeScriptModule.SourceFile, propertyChain: string[]): boolean {
  let found = false;
  function visit(node: TypeScriptModule.Node): void {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      let cur: TypeScriptModule.Expression = node.expression;
      let matched = true;
      for (let i = propertyChain.length - 1; i >= 0; i--) {
        if (!ts.isPropertyAccessExpression(cur) || cur.name.text !== propertyChain[i]) {
          matched = false;
          break;
        }
        cur = cur.expression;
      }
      if (matched) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}
// [R3-F1] Counts `.click()` CallExpressions whose RECEIVER subtree (e.g. the
// `page.getByTestId('X')` in `page.getByTestId('X').click()`) contains
// `fragment` -- binds the click to the selector, rather than treating "a
// selector fragment appears somewhere in the loop" and "some .click() call
// appears somewhere in the loop" as two independent, unbound facts that a
// loop driving a DIFFERENT surface (or no surface) could also satisfy.
function countClickChainsReferencing(node: TypeScriptModule.Node, fragment: string): number {
  let count = 0;
  function visit(n: TypeScriptModule.Node): void {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'click') {
      if (subtreeContainsStringLiteralFragment(n.expression.expression, fragment)) count++;
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return count;
}
// [R4-F1] Same binding pattern as countClickChainsReferencing, applied to
// .textContent()/.innerText() instead of .click() -- closes the round-3
// final finding's literal wording: "requires... any textContent call; it
// never requires... reading chat-composer-input as the PRD specifies."
// Binds the read to its own selector-chain receiver, exactly like clicks.
function countTextContentChainsReferencing(node: TypeScriptModule.Node, fragment: string): number {
  let count = 0;
  function visit(n: TypeScriptModule.Node): void {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['textContent', 'innerText'].includes(n.expression.name.text)) {
      if (subtreeContainsStringLiteralFragment(n.expression.expression, fragment)) count++;
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return count;
}
// [R4-F1] Does `node`'s subtree contain any Identifier equal to `name`?
// Generic version of the name-matching helper `findAllForOfLoopsGeneratingTests`
// uses locally, exposed here for reuse by the click/dataflow binding checks
// below.
function subtreeReferencesIdentifierByName(node: TypeScriptModule.Node, name: string): boolean {
  let found = false;
  function inner(n: TypeScriptModule.Node): void {
    if (found) return;
    if (ts.isIdentifier(n) && n.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(n, inner);
  }
  inner(node);
  return found;
}
// [R4-F1] Extracts the loop's own bound iteration-variable name from
// `for (const action of ...)` -- used to prove the per-action row click's
// selector target actually depends on the CURRENT action (a dynamic
// accessible name built from `action`), not a hardcoded/fixed string a
// bounded string-literal-fragment check like countClickChainsReferencing
// cannot see, since there is no fixed literal to bind to.
function findForOfIterationVariableName(loop: TypeScriptModule.ForOfStatement): string | null {
  const init = loop.initializer;
  if (ts.isVariableDeclarationList(init) && init.declarations.length === 1) {
    const decl = init.declarations[0]!;
    if (ts.isIdentifier(decl.name)) return decl.name.text;
  }
  return null;
}
// [R4-F1] Counts `.click()` calls whose receiver subtree references
// `identifierName` (the loop's own iteration variable) -- proves at least
// one click target in the loop depends on the CURRENT action under test,
// which the two fixed-string-literal click-chain checks (chat-plus-trigger,
// "Design toolbox") cannot prove on their own, since the per-action row's
// accessible name is necessarily built from the loop variable, not a fixed
// literal.
function countClickChainsReferencingIdentifier(node: TypeScriptModule.Node, identifierName: string): number {
  let count = 0;
  function visit(n: TypeScriptModule.Node): void {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'click') {
      if (subtreeReferencesIdentifierByName(n.expression.expression, identifierName)) count++;
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return count;
}
// [R4-F1] Collects the names of every locally-declared variable in `node`
// whose OWN initializer subtree contains a .textContent()/.innerText()
// call -- i.e. every "observed DOM read" this loop body produces. Paired
// with consoleLogReferencesAnyIdentifier below, this proves the marker a
// test emits is DATA-FLOW CONNECTED to an actual DOM read within the same
// loop body, closing the round-3 final finding's second half verbatim:
// "Marker output is likewise compared without binding it to the observed
// text... [loops] can therefore calculate markers directly from the
// imported resolver while one or both consumers remain unexercised." This
// is a bounded, single-loop-body dataflow trace -- not the whole-file
// identifier-occurrence-counting pattern DECISIONS.md's W10C-PARK record
// names as the repeatedly-failing defect class; it is scoped to proving one
// small, already-required loop body performs a real read-then-report, the
// same "make the real request, assert the real response" shape applied to
// a UI surface (a click is the request, the observed DOM text is the
// response).
// [R5-F2] `fragment` is REQUIRED and must match the read's OWN RECEIVER
// subtree (e.g. `page.getByTestId('chat-composer-input')`), exactly like
// countTextContentChainsReferencing's binding -- round-4's review found
// that when this collector accepted a read bound to ANY locator, and the
// bound-read-presence check (countTextContentChainsReferencing) ran as a
// SEPARATE, independent fact, a decoy could perform the real
// chat-composer-input read into an unused variable (satisfying the
// presence check) while separately reading an UNRELATED locator seeded
// with the expected value into the variable it actually logs (satisfying
// the marker-references-an-observed-read check) -- two true facts about
// the loop body that, taken together, prove nothing about what was
// actually reported. Binding this collector to the SAME fragment the
// presence check requires makes the two checks describe the SAME read,
// closing the decoupling.
function collectObservedReadVariableNames(node: TypeScriptModule.Node, fragment: string): Set<string> {
  const names = new Set<string>();
  function visit(n: TypeScriptModule.Node): void {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['textContent', 'innerText'].includes(n.expression.name.text) && subtreeContainsStringLiteralFragment(n.expression.expression, fragment)) {
      // Walk up through await/parenthesized wrappers only -- if this exact,
      // fragment-bound call (or its awaited/parenthesized form) is DIRECTLY
      // a variable's initializer, that variable is a genuine observed read;
      // anything else (passed straight to console.log, assigned into an
      // object property, etc.) is handled by the direct-reference checks
      // elsewhere and is not claimed here.
      let cur: TypeScriptModule.Node = n;
      while (cur.parent && (ts.isAwaitExpression(cur.parent) || ts.isParenthesizedExpression(cur.parent))) {
        cur = cur.parent;
      }
      if (cur.parent && ts.isVariableDeclaration(cur.parent) && ts.isIdentifier(cur.parent.name) && cur.parent.initializer === cur) {
        names.add(cur.parent.name.text);
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return names;
}
// [R4-F1] Does any console.log(...) call's argument subtree reference at
// least one of `names`? Used with collectObservedReadVariableNames to prove
// a marker is derived from an observed-read variable, not fabricated.
function consoleLogArgumentsReferenceAnyIdentifier(node: TypeScriptModule.Node, names: Set<string>): boolean {
  if (names.size === 0) return false;
  let found = false;
  function visit(n: TypeScriptModule.Node): void {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'console' && n.expression.name.text === 'log') {
      for (const arg of n.arguments) {
        if ([...names].some((nm) => subtreeReferencesIdentifierByName(arg, nm))) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return found;
}
// [R4-F1] Does any console.log(...) call's argument subtree reference
// `identifierName` DIRECTLY? Used to reject the exact shape the round-3
// finding named: a marker "calculate[d]... directly from the imported
// resolver" -- if the loop's own dynamic-import-destructured local binding
// for findDesignToolboxSkill appears inside a console.log argument, the
// marker is provably NOT solely derived from the required DOM read.
function consoleLogArgumentsReferenceIdentifierDirectly(node: TypeScriptModule.Node, identifierName: string): boolean {
  let found = false;
  function visit(n: TypeScriptModule.Node): void {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'console' && n.expression.name.text === 'log') {
      for (const arg of n.arguments) {
        if (subtreeReferencesIdentifierByName(arg, identifierName)) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return found;
}
// [R3-F1] Collects every literal string fragment that appears as (or inside
// a template literal forming) a JSX `data-testid` attribute value anywhere
// in the file -- used to prove a required testid literally exists in
// NextStepActions.tsx's own source, not merely asserted by the verifier's
// own arithmetic.
function collectJsxTestIdLiteralValues(sf: TypeScriptModule.SourceFile): Set<string> {
  const out = new Set<string>();
  function collectLiteralsIn(n: TypeScriptModule.Node): void {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      out.add(n.text);
    }
    ts.forEachChild(n, collectLiteralsIn);
  }
  function visit(node: TypeScriptModule.Node): void {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'data-testid' && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) {
        out.add(node.initializer.text);
      } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        collectLiteralsIn(node.initializer.expression);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}
// [R3-F1] Cross-file structural proof: does NextStepActions.tsx's OWN real
// source (a) import FEATURED_DESIGN_TOOLBOX_ACTION_IDS by exact name from a
// design-toolbox-referencing module, and (b) compute a non-featured set via
// a `.filter(...)` CallExpression whose callback body references that same
// imported local binding through a `.includes(` call? This is a fact about
// a DIFFERENT file than the one the verifier itself derives the partition
// from -- proving the split is actually implemented there, not tautologically
// re-derived by the verifier and merely asserted against a fixed spec file.
function nextStepPartitionIsStructurallyReal(sf: TypeScriptModule.SourceFile): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const featuredImport = findNamedImportBinding(sf, 'FEATURED_DESIGN_TOOLBOX_ACTION_IDS', 'design-toolbox');
  if (!featuredImport.found || !featuredImport.localName) {
    problems.push('NextStepActions.tsx does not import FEATURED_DESIGN_TOOLBOX_ACTION_IDS by exact name from a design-toolbox module');
    return { ok: false, problems };
  }
  const localName = featuredImport.localName;
  let hasFilterOverBinding = false;
  function visit(node: TypeScriptModule.Node): void {
    if (hasFilterOverBinding) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'filter' &&
      node.arguments[0]
    ) {
      const callback = node.arguments[0];
      let referencesIncludesOnBinding = false;
      function innerVisit(n: TypeScriptModule.Node): void {
        if (referencesIncludesOnBinding) return;
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === 'includes' &&
          ts.isIdentifier(n.expression.expression) &&
          n.expression.expression.text === localName
        ) {
          referencesIncludesOnBinding = true;
          return;
        }
        ts.forEachChild(n, innerVisit);
      }
      innerVisit(callback);
      if (referencesIncludesOnBinding) hasFilterOverBinding = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!hasFilterOverBinding) {
    problems.push(`NextStepActions.tsx imports FEATURED_DESIGN_TOOLBOX_ACTION_IDS as "${localName}" but has no .filter(...) callback calling "${localName}.includes(...)" to derive the non-featured set`);
  }
  return { ok: problems.length === 0, problems };
}

// -----------------------------------------------------------------------
// C10C-1 structural (Layer A) extraction.
// -----------------------------------------------------------------------
const ALLOWED_ACTION_FIELDS = new Set(['id', 'icon', 'preferredSkillIds', 'categoryHints', 'searchTerms']);
interface ExtractedAction {
  id: string;
  preferredSkillIds: string[];
}
interface ExtractActionsResult {
  ok: boolean;
  actions: ExtractedAction[];
  errors: string[];
}
function findTopLevelNamedVariableDeclarations(sf: TypeScriptModule.SourceFile, name: string): TypeScriptModule.VariableDeclaration[] {
  const out: TypeScriptModule.VariableDeclaration[] = [];
  function visit(node: TypeScriptModule.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) out.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}
function isExportedTopLevelConst(decl: TypeScriptModule.VariableDeclaration, sf: TypeScriptModule.SourceFile): boolean {
  const declList = decl.parent;
  if (!ts.isVariableDeclarationList(declList)) return false;
  const stmt = declList.parent;
  if (!ts.isVariableStatement(stmt)) return false;
  if (stmt.parent !== sf) return false;
  const hasExport = (ts.getModifiers(stmt) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const isConst = (declList.flags & ts.NodeFlags.Const) !== 0;
  return hasExport && isConst;
}
// [R1-F5] Requires: exactly one DESIGN_TOOLBOX_ACTIONS declaration in the
// whole file, top-level + exported + const; every array element a plain
// object literal whose ONLY members are the 5 real DesignToolboxAction
// fields as direct PropertyAssignments (no methods/accessors/shorthand/
// computed names/spread, no __proto__/toJSON or any other extra key).
function extractDesignToolboxActionsLayerA(sourceText: string, fileName: string): ExtractActionsResult {
  const errors: string[] = [];
  const actions: ExtractedAction[] = [];
  const sf = parseTs(fileName, sourceText);
  const decls = findTopLevelNamedVariableDeclarations(sf, 'DESIGN_TOOLBOX_ACTIONS');
  if (decls.length === 0) return { ok: false, actions: [], errors: ['no DESIGN_TOOLBOX_ACTIONS declaration found anywhere in the file'] };
  if (decls.length > 1) return { ok: false, actions: [], errors: [`DESIGN_TOOLBOX_ACTIONS is declared ${decls.length} times in this file -- must be unique`] };
  const decl = decls[0]!;
  if (!isExportedTopLevelConst(decl, sf)) return { ok: false, actions: [], errors: ['DESIGN_TOOLBOX_ACTIONS is not a top-level `export const` declaration'] };
  if (!decl.initializer || !ts.isArrayLiteralExpression(decl.initializer)) return { ok: false, actions: [], errors: ['DESIGN_TOOLBOX_ACTIONS initializer is not an array literal'] };
  for (const el of decl.initializer.elements) {
    if (ts.isSpreadElement(el)) {
      errors.push('spread element directly inside the DESIGN_TOOLBOX_ACTIONS array -- banned');
      continue;
    }
    if (!ts.isObjectLiteralExpression(el)) {
      errors.push(`non-object-literal element in DESIGN_TOOLBOX_ACTIONS (kind=${ts.SyntaxKind[el.kind]})`);
      continue;
    }
    let id: string | null = null;
    let preferredSkillIds: string[] | null = null;
    let elementBad = false;
    for (const prop of el.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        errors.push(`an action element has a non-PropertyAssignment member (kind=${ts.SyntaxKind[prop.kind]}) -- methods/accessors/shorthand/spread are banned`);
        elementBad = true;
        continue;
      }
      const name = propertyName(prop.name);
      if (name === null || !ALLOWED_ACTION_FIELDS.has(name)) {
        errors.push(`an action element has a disallowed property "${name ?? '<computed>'}" -- only id/icon/preferredSkillIds/categoryHints/searchTerms are allowed`);
        elementBad = true;
        continue;
      }
      if (name === 'id') {
        id = stringLiteralValue(prop.initializer);
      } else if (name === 'preferredSkillIds') {
        if (ts.isArrayLiteralExpression(prop.initializer)) {
          const vals: string[] = [];
          let arrBad = false;
          for (const item of prop.initializer.elements) {
            if (ts.isSpreadElement(item)) {
              arrBad = true;
              break;
            }
            const v = stringLiteralValue(item);
            if (v === null) {
              arrBad = true;
              break;
            }
            vals.push(v);
          }
          if (!arrBad) preferredSkillIds = vals;
        }
      }
    }
    if (elementBad) continue;
    if (id === null) {
      errors.push('an action element is missing a literal string "id"');
      continue;
    }
    if (preferredSkillIds === null) {
      errors.push(`action "${id}" is missing a literal-string-array "preferredSkillIds"`);
      continue;
    }
    actions.push({ id, preferredSkillIds });
  }
  return { ok: errors.length === 0 && actions.length > 0, actions, errors };
}
const MUTATION_ARRAY_METHODS = new Set(['push', 'splice', 'unshift', 'shift', 'pop', 'sort', 'reverse', 'copyWithin', 'fill']);
const MUTATION_OBJECT_METHODS = new Set(['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf']);
// [R1-F5] Scans the whole file for calls that could mutate the exported
// binding after declaration.
function scanForMutationCalls(sf: TypeScriptModule.SourceFile, identifierName: string): string[] {
  const hits: string[] = [];
  function subtreeReferencesIdentifier(expr: TypeScriptModule.Node): boolean {
    let hit = false;
    function inner(n: TypeScriptModule.Node): void {
      if (hit) return;
      if (ts.isIdentifier(n) && n.text === identifierName) hit = true;
      ts.forEachChild(n, inner);
    }
    inner(expr);
    return hit;
  }
  function visit(node: TypeScriptModule.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        if (MUTATION_ARRAY_METHODS.has(callee.name.text) && subtreeReferencesIdentifier(callee.expression)) {
          hits.push(`${identifierName}...${callee.name.text}(...)`);
        }
        if (
          MUTATION_OBJECT_METHODS.has(callee.name.text) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'Object' &&
          node.arguments.some((a) => subtreeReferencesIdentifier(a))
        ) {
          hits.push(`Object.${callee.name.text}(... ${identifierName} ...)`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return hits;
}
// [R3-F4] Inspects the ACTUAL RUNTIME VALUE (own keys, property descriptors,
// prototypes) of the dynamically-imported DESIGN_TOOLBOX_ACTIONS array and
// each of its elements. This is authoritative over scanForMutationCalls,
// which only sees calls whose ARGUMENTS directly contain the identifier
// text -- aliasing an element into a local variable before calling
// Object.defineProperty/setPrototypeOf on it dodges that scan entirely, but
// cannot dodge this: whatever code path produced the final shape, the
// runtime shape either matches an honest plain literal or it does not. A
// getter that currently RETURNS the honest value is still rejected here,
// because the check is against descriptor SHAPE (get/set vs a plain `value`
// data property), never against the value a getter happens to evaluate to.
interface RuntimeShapeCheck {
  ok: boolean;
  problems: string[];
}
// [R5-F7] Canonical array-index test, replacing `/^\d+$/`. Per the ECMAScript
// spec, an "array index" string key must equal `ToString(ToUint32(k))` with
// no leading zeros (String(Number(k)) === k) and be < 2^32-1 -- `/^\d+$/`
// wrongly accepts "01" (and any other leading-zero digit string) as
// numeric, which caused two live bugs: the "extra own properties" filters
// below EXCLUDED "01" from the extras check (treating it as a harmless
// index), while the separate `0..length-1` descriptor loop never visits
// "01" either (bracket-indexing by a NUMBER only ever produces "0","1",...,
// never "01") -- so a property installed at exactly that key evaded BOTH
// checks. A direct probe confirmed this: `Object.defineProperty(arr, '01',
// {value:'poison', enumerable:true, ...})` produced `filteredExtras=[]` and
// `problems=[]` under the old regex.
function isCanonicalArrayIndexKey(k: string): boolean {
  if (k === '' || k === '-0') return false;
  const n = Number(k);
  return Number.isInteger(n) && n >= 0 && n < 4294967295 && String(n) === k;
}
// [R4-F4] Full runtime inspection of a plain string array (used for
// preferredSkillIds/categoryHints/searchTerms and for
// FEATURED_DESIGN_TOOLBOX_ACTION_IDS): Array.prototype identity, zero extra
// own STRING-keyed properties, zero own SYMBOL-keyed properties, and every
// index up to `.length` inspected as its OWN property descriptor. This
// closes the round-3 final finding verbatim: "array numeric-property
// descriptors are never inspected, symbol keys lost via
// getOwnPropertyNames/keys" -- `Array.prototype.forEach`/`.every()` both
// INVOKE a getter to read a value, so neither can detect one stashed at a
// numeric index; only an explicit per-index `getOwnPropertyDescriptor` scan
// can. Object.getOwnPropertyNames/Object.keys likewise never enumerate
// symbol-keyed own properties (that requires getOwnPropertySymbols
// specifically), so a symbol own key is invisible to every check this file
// used before this round.
function inspectStringArrayRuntimeShapeDeep(value: unknown, label: string): RuntimeShapeCheck {
  const problems: string[] = [];
  if (!Array.isArray(value)) return { ok: false, problems: [`${label} runtime export is not an Array instance`] };
  if (Object.getPrototypeOf(value) !== Array.prototype) problems.push(`${label} prototype is not Array.prototype`);
  const ownNames = Object.getOwnPropertyNames(value).filter((k) => k !== 'length' && !isCanonicalArrayIndexKey(k));
  if (ownNames.length > 0) problems.push(`${label} has extra own string-keyed properties beyond numeric indices/length: ${ownNames.join(', ')}`);
  const ownSymbols = Object.getOwnPropertySymbols(value);
  if (ownSymbols.length > 0) problems.push(`${label} has ${ownSymbols.length} own SYMBOL-keyed propert${ownSymbols.length === 1 ? 'y' : 'ies'}, which a plain array literal never has`);
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, i);
    if (!d) {
      problems.push(`${label}[${i}] has no own property descriptor (sparse array element)`);
      continue;
    }
    if (typeof d.get === 'function' || typeof d.set === 'function') {
      problems.push(`${label}[${i}] is a runtime ACCESSOR (getter/setter) at its numeric index -- rejected regardless of the value it currently returns; forEach()/every() invoke the getter and cannot see this`);
      continue;
    }
    if (!d.enumerable) problems.push(`${label}[${i}] is non-enumerable at runtime`);
    if (typeof d.value !== 'string') problems.push(`${label}[${i}] is not a plain string data value at runtime`);
  }
  return { ok: problems.length === 0, problems };
}
function inspectRuntimeActionsShape(value: unknown): RuntimeShapeCheck {
  const problems: string[] = [];
  if (!Array.isArray(value)) return { ok: false, problems: ['DESIGN_TOOLBOX_ACTIONS runtime export is not an Array instance'] };
  if (Object.getPrototypeOf(value) !== Array.prototype) problems.push('DESIGN_TOOLBOX_ACTIONS prototype is not Array.prototype');
  const arrayOwnKeys = Object.getOwnPropertyNames(value).filter((k) => k !== 'length' && !isCanonicalArrayIndexKey(k));
  if (arrayOwnKeys.length > 0) problems.push(`DESIGN_TOOLBOX_ACTIONS has extra own properties beyond numeric indices/length: ${arrayOwnKeys.join(', ')}`);
  // [R4-F4] Symbol-keyed own properties on the outer array itself, and a
  // per-index descriptor scan proving no element slot is a getter/setter
  // masquerading as a plain object via forEach's own dereference.
  const arrayOwnSymbols = Object.getOwnPropertySymbols(value);
  if (arrayOwnSymbols.length > 0) problems.push(`DESIGN_TOOLBOX_ACTIONS has ${arrayOwnSymbols.length} own SYMBOL-keyed propert${arrayOwnSymbols.length === 1 ? 'y' : 'ies'}`);
  for (let i = 0; i < value.length; i++) {
    const arrD = Object.getOwnPropertyDescriptor(value, i);
    if (!arrD) {
      problems.push(`DESIGN_TOOLBOX_ACTIONS[${i}] has no own property descriptor (sparse array element)`);
      continue;
    }
    if (typeof arrD.get === 'function' || typeof arrD.set === 'function') {
      problems.push(`DESIGN_TOOLBOX_ACTIONS[${i}] is a runtime ACCESSOR (getter/setter) at its numeric index -- rejected regardless of the value it currently returns`);
      continue;
    }
    if (!arrD.enumerable) problems.push(`DESIGN_TOOLBOX_ACTIONS[${i}] is non-enumerable at runtime`);
  }
  value.forEach((el, idx) => {
    if (typeof el !== 'object' || el === null) {
      problems.push(`element ${idx} is not a plain object`);
      return;
    }
    if (Object.getPrototypeOf(el) !== Object.prototype) {
      problems.push(`element ${idx} ("${(el as Record<string, unknown>).id ?? '?'}") has a non-Object.prototype prototype -- possible inherited toJSON/valueOf injection`);
    }
    // [R4-F4] symbol-keyed own properties on the element itself --
    // Object.keys(Object.getOwnPropertyDescriptors(el)) below only ever
    // enumerates STRING keys; a symbol own key needs its own scan.
    const elOwnSymbols = Object.getOwnPropertySymbols(el as object);
    if (elOwnSymbols.length > 0) problems.push(`element ${idx} has ${elOwnSymbols.length} own SYMBOL-keyed propert${elOwnSymbols.length === 1 ? 'y' : 'ies'}`);
    const descriptors = Object.getOwnPropertyDescriptors(el as object);
    const ownKeys = Object.keys(descriptors);
    const unexpectedKeys = ownKeys.filter((k) => !ALLOWED_ACTION_FIELDS.has(k));
    if (unexpectedKeys.length > 0) problems.push(`element ${idx} has unexpected own key(s) at runtime: ${unexpectedKeys.join(', ')}`);
    for (const key of ownKeys) {
      const d = descriptors[key]!;
      if (typeof d.get === 'function' || typeof d.set === 'function') {
        problems.push(`element ${idx} property "${key}" is a runtime ACCESSOR (getter/setter), not a plain data property -- rejected regardless of the value it currently returns`);
        continue;
      }
      if (!d.enumerable) problems.push(`element ${idx} property "${key}" is non-enumerable at runtime`);
      // [R4-F4] extended from preferredSkillIds-only to all three
      // array-valued fields -- categoryHints/searchTerms were never
      // inspected at runtime before this round, only preferredSkillIds was.
      if (key === 'preferredSkillIds' || key === 'categoryHints' || key === 'searchTerms') {
        const deep = inspectStringArrayRuntimeShapeDeep(d.value, `element ${idx}.${key}`);
        if (!deep.ok) problems.push(...deep.problems);
      }
      if (key === 'id' && typeof d.value !== 'string') problems.push(`element ${idx} id is not a plain string data value at runtime`);
    }
  });
  return { ok: problems.length === 0, problems };
}
// [R3-F4] Sibling check for FEATURED_DESIGN_TOOLBOX_ACTION_IDS (consumed by
// C10C-2's partition proof) -- same class of attack, smaller surface: now
// delegates to the deep array inspector (R4-F4) for full descriptor/symbol
// coverage, not just Array-ness + string-ness.
function inspectRuntimeStringArrayShape(value: unknown, label: string): RuntimeShapeCheck {
  return inspectStringArrayRuntimeShapeDeep(value, label);
}
// [R1-F5] i18n cross-check scoped specifically to the unique `Dict` interface.
function findUniqueInterface(sf: TypeScriptModule.SourceFile, name: string): TypeScriptModule.InterfaceDeclaration[] {
  const out: TypeScriptModule.InterfaceDeclaration[] = [];
  function visit(node: TypeScriptModule.Node): void {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) out.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}
interface I18nExtraction {
  ok: boolean;
  error?: string;
  complete: Set<string>;
  incomplete: string[];
}
function extractDesignToolboxI18nIdsFromDict(sourceText: string, fileName: string): I18nExtraction {
  const sf = parseTs(fileName, sourceText);
  const dicts = findUniqueInterface(sf, 'Dict');
  if (dicts.length !== 1) {
    return { ok: false, error: `found ${dicts.length} "Dict" interface declaration(s), expected exactly 1`, complete: new Set(), incomplete: [] };
  }
  const pattern = /^chat\.designToolbox\.action\.([a-zA-Z0-9-]+)\.(title|badge|description)$/;
  const seen = new Map<string, Set<string>>();
  for (const member of dicts[0]!.members) {
    if (!ts.isPropertySignature(member)) continue;
    const name = member.name;
    const text = ts.isStringLiteral(name) ? name.text : null;
    const m = text ? pattern.exec(text) : null;
    if (m && m[1] && m[2]) {
      if (!seen.has(m[1])) seen.set(m[1], new Set());
      seen.get(m[1])!.add(m[2]);
    }
  }
  const complete = new Set<string>();
  const incomplete: string[] = [];
  for (const [id, kinds] of seen) {
    if (kinds.size === 3) complete.add(id);
    else incomplete.push(`${id} (has: ${[...kinds].sort().join(',')})`);
  }
  return { ok: true, complete, incomplete };
}
function extractEnToolboxKeyValues(sourceText: string, fileName: string): { present: Set<string>; empty: string[] } {
  const sf = parseTs(fileName, sourceText);
  const pattern = /^chat\.designToolbox\.action\.([a-zA-Z0-9-]+)\.(title|badge|description)$/;
  const present = new Set<string>();
  const empty: string[] = [];
  function visit(node: TypeScriptModule.Node): void {
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name && pattern.test(name)) {
        const value = stringLiteralValue(node.initializer);
        if (value === null || value.trim().length === 0) empty.push(name);
        else present.add(name);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return { present, empty };
}

function multisetDiff(a: string[], b: string[]): { onlyInA: string[]; onlyInB: string[]; countMismatch: string[] } {
  const countA = new Map<string, number>();
  const countB = new Map<string, number>();
  for (const x of a) countA.set(x, (countA.get(x) ?? 0) + 1);
  for (const x of b) countB.set(x, (countB.get(x) ?? 0) + 1);
  const onlyInA: string[] = [];
  const onlyInB: string[] = [];
  const countMismatch: string[] = [];
  const allKeys = new Set([...countA.keys(), ...countB.keys()]);
  for (const k of allKeys) {
    const ca = countA.get(k) ?? 0;
    const cb = countB.get(k) ?? 0;
    if (ca > 0 && cb === 0) onlyInA.push(k);
    else if (cb > 0 && ca === 0) onlyInB.push(k);
    else if (ca !== cb) countMismatch.push(`${k} (${ca} vs ${cb})`);
  }
  return { onlyInA, onlyInB, countMismatch };
}
function boundedIncludes(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-zA-Z0-9_-])${escaped}($|[^a-zA-Z0-9_-])`).test(haystack);
}
// Exact-sequence comparison for two {id, preferredSkillIds}[] lists (order
// of preferredSkillIds matters -- it is the tier-1 match priority).
function actionListsExactlyEqual(a: ExtractedAction[], b: ExtractedAction[]): { equal: boolean; detail: string } {
  const byIdA = new Map(a.map((x) => [x.id, x.preferredSkillIds] as const));
  const byIdB = new Map(b.map((x) => [x.id, x.preferredSkillIds] as const));
  const diff = multisetDiff(
    a.map((x) => x.id),
    b.map((x) => x.id),
  );
  const problems: string[] = [];
  if (diff.onlyInA.length) problems.push(`ids only in AST-derived reading: ${diff.onlyInA.join(', ')}`);
  if (diff.onlyInB.length) problems.push(`ids only in runtime-imported reading: ${diff.onlyInB.join(', ')}`);
  if (diff.countMismatch.length) problems.push(`id occurrence-count mismatches: ${diff.countMismatch.join(', ')}`);
  for (const [id, seqA] of byIdA) {
    const seqB = byIdB.get(id);
    if (!seqB) continue;
    if (seqA.length !== seqB.length || seqA.some((v, i) => v !== seqB[i])) {
      problems.push(`preferredSkillIds sequence mismatch for "${id}": AST=[${seqA.join(',')}] runtime=[${seqB.join(',')}]`);
    }
  }
  return { equal: problems.length === 0, detail: problems.join('\n') };
}

// -----------------------------------------------------------------------
// [R1-F5] Layer B: dynamically import the REAL production module and read
// the actually-executed export -- a genuine runtime execution, not an
// inference from source shape.
// -----------------------------------------------------------------------
const DESIGN_TOOLBOX_SRC_REL = 'apps/web/src/runtime/design-toolbox.ts';
const DAEMON_SKILLS_SRC_REL = 'apps/daemon/src/skills.ts';
const SKILLS_ROOT_REL = 'skills';
const NEXT_STEP_ACTIONS_SRC_REL = 'apps/web/src/components/NextStepActions.tsx'; // [R3-F1]

async function loadDesignToolboxModule(): Promise<{ ok: true; mod: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const abs = path.join(repoRoot, DESIGN_TOOLBOX_SRC_REL);
    const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
    return { ok: true, mod };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.stack ?? err) };
  }
}
async function loadDaemonSkillsModule(): Promise<{ ok: true; mod: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const abs = path.join(repoRoot, DAEMON_SKILLS_SRC_REL);
    const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
    return { ok: true, mod };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.stack ?? err) };
  }
}
function safeExtractRuntimeActions(value: unknown): { ok: boolean; actions: ExtractedAction[]; error?: string } {
  if (!Array.isArray(value)) return { ok: false, actions: [], error: 'DESIGN_TOOLBOX_ACTIONS runtime export is not an array' };
  const actions: ExtractedAction[] = [];
  for (const el of value) {
    if (typeof el !== 'object' || el === null) return { ok: false, actions: [], error: 'a runtime action element is not an object' };
    const rec = el as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(rec, 'id') || !Object.prototype.hasOwnProperty.call(rec, 'preferredSkillIds')) {
      return { ok: false, actions: [], error: 'a runtime action element is missing id/preferredSkillIds as own properties' };
    }
    const id = rec.id;
    const pref = rec.preferredSkillIds;
    if (typeof id !== 'string') return { ok: false, actions: [], error: 'a runtime action id is not a string' };
    if (!Array.isArray(pref) || !pref.every((x) => typeof x === 'string')) {
      return { ok: false, actions: [], error: `runtime preferredSkillIds for "${id}" is not a string array` };
    }
    actions.push({ id, preferredSkillIds: pref as string[] });
  }
  return { ok: true, actions };
}
async function liveSkillsList(): Promise<{ ok: true; skills: unknown[] } | { ok: false; error: string }> {
  const loaded = await loadDaemonSkillsModule();
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const listSkills = loaded.mod.listSkills;
  if (typeof listSkills !== 'function') return { ok: false, error: 'apps/daemon/src/skills.ts does not export a callable listSkills' };
  try {
    const skills = (await (listSkills as (roots: string[]) => Promise<unknown[]>)([path.join(repoRoot, SKILLS_ROOT_REL)])) as unknown[];
    return { ok: true, skills };
  } catch (err) {
    return { ok: false, error: `listSkills() threw: ${String((err as Error)?.stack ?? err)}` };
  }
}

// =========================================================================
// Vitest / Playwright JSON reporter runners. [R1-F1]: file arguments are
// PACKAGE-relative (the caller passes the path relative to that package's
// own root), matching `pnpm --filter <pkg> exec ...`'s actual CWD -- verified
// live in this session against throwaway probe files at every pinned path.
// =========================================================================
interface VitestAssertionResult {
  fullName: string;
  status: string;
  failureMessages?: string[]; // [R5] required for assertion-identity checks (finding 1/9/10)
}
interface VitestSuiteJson {
  numTotalTests: number; // [R5] 0 with an empty assertionResults[] is the module-eval-crash signature
  numFailedTests: number;
  numPassedTests: number;
  testResults: { assertionResults: VitestAssertionResult[]; status: string; message: string }[];
}
function runVitestFile(pkgFilter: string, packageRelativeFile: string, outName: string): { status: number; data: VitestSuiteJson | null; raw: string } {
  const outPath = path.join(proofDir, `${outName}.json`);
  const r = sh('pnpm', ['--filter', pkgFilter, 'exec', 'vitest', 'run', packageRelativeFile, '--reporter=json', `--outputFile=${outPath}`], { timeoutMs: 10 * 60_000 });
  let data: VitestSuiteJson | null = null;
  try {
    data = JSON.parse(fs.readFileSync(outPath, 'utf8')) as VitestSuiteJson;
  } catch {
    data = null;
  }
  return { status: r.status, data, raw: `${r.stdout}\n${r.stderr}`.slice(0, 20_000) };
}
// [R4-F2/F3] Mutation-probe primitive: replaces the countCallsToExactIdentifier
// /findDestructuredImportBinding-based "must be called >=N times" checks
// that failed three straight review rounds (DECISIONS.md's W10C-PARK record:
// "the criteria meant to prove the repository carries real delegated tests
// bound to production remain structural, and structural binding keeps
// admitting decorative artifacts"). Per that record's own instruction to a
// future re-expansion -- "bind them by executing the delegated tests and
// observing their effects -- never by counting identifiers" -- this backs
// up a REAL production source file, splices a poison string immediately
// after a unique, exact anchor (the function's own signature text, verified
// unique before writing), runs the caller's probe, and ALWAYS restores the
// original byte-for-byte content in a finally block regardless of outcome.
// This never leaves a committed change: the mutation exists only for the
// duration of one synchronous vitest run, and the LEASE/treeDirty checks
// that run afterward would themselves catch an unrestored file.
//
// [R5-F9] Round-4 review found the raw-text occurrence count did not prove
// the anchor was a DECLARATION rather than comment/template text, and that
// harmless signature reformatting would make the frozen verifier
// false-red. Fixed with DECLARATION-SCOPED anchoring: locates the unique,
// top-level `function <name>(...) { ... }` declaration via the TypeScript
// compiler API and splices immediately after its own body's opening brace,
// using that node's real character offset -- never a text match.
function locateTopLevelFunctionBodyInsertionPoint(sourceText: string, fileName: string, functionName: string): { ok: true; insertPos: number } | { ok: false; error: string } {
  const sf = parseTs(fileName, sourceText);
  const matches: TypeScriptModule.Block[] = [];
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === functionName && stmt.body) {
      matches.push(stmt.body);
    }
  }
  if (matches.length !== 1) {
    return { ok: false, error: `expected exactly 1 top-level function declaration named "${functionName}" in ${fileName}, found ${matches.length} -- refusing to poison an ambiguous target` };
  }
  return { ok: true, insertPos: matches[0]!.getStart(sf) + 1 }; // +1: just past the body's opening '{'
}
// [R5-F9] Crash-recovery: registers exit/SIGINT/SIGTERM handlers so a
// termination of THIS verifier process between poison and restore still
// restores the file synchronously before the process actually exits (Node
// runs 'exit' listeners and lets a signal handler run synchronous code
// before the process dies). This cannot help against SIGKILL or a native
// crash -- no runtime can run cleanup code after that -- which is why the
// caller ALSO verifies byte-identical restoration below, independent of
// whether this function's own try/finally executed cleanly, and treats any
// mismatch as a hard failure regardless of the probe's own outcome.
// [R5-F6/F9] Shared low-level primitive: write `computeMutated(original)`'s
// content, run `fn`, ALWAYS restore, ALWAYS verify byte-identical
// restoration regardless of outcome. Factored out so every mutation probe
// in this file (poison-a-function-body, and the registry-content
// append-an-action probe below) shares the exact same crash-recovery +
// restore-verification discipline rather than three independent copies of
// it drifting apart.
function withMutatedFileContent<T>(absPath: string, computeMutated: (original: string) => { ok: true; content: string } | { ok: false; error: string }, fn: () => T): { ok: true; result: T } | { ok: false; error: string } {
  const original = fs.readFileSync(absPath, 'utf8');
  const mutation = computeMutated(original);
  if (!mutation.ok) return { ok: false, error: mutation.error };

  let restored = false;
  const safeRestore = (): void => {
    if (restored) return;
    try {
      fs.writeFileSync(absPath, original);
      restored = true;
    } catch {
      /* best effort; the byte-identical verification below is authoritative */
    }
  };
  const onExit = (): void => safeRestore();
  const onSignal = (): void => {
    safeRestore();
    process.exit(1);
  };
  fs.writeFileSync(absPath, mutation.content);
  process.once('exit', onExit);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  let outcome: { ok: true; result: T } | { ok: false; error: string };
  try {
    outcome = { ok: true, result: fn() };
  } catch (err) {
    outcome = { ok: false, error: `mutation-probe callback threw: ${String((err as Error)?.stack ?? err)}` };
  } finally {
    safeRestore();
    process.removeListener('exit', onExit);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }

  // [R5-F9] Byte-identical restore verification DOMINATES: a persistently
  // mutated production file is a hard failure regardless of what the probe
  // callback itself reported, on every exit path this function's own
  // control flow can observe.
  let postRestore: string;
  try {
    postRestore = fs.readFileSync(absPath, 'utf8');
  } catch (err) {
    return { ok: false, error: `RESTORE VERIFICATION FAILED for ${absPath}: could not re-read after restore: ${String(err)}` };
  }
  if (postRestore !== original) {
    return { ok: false, error: `RESTORE VERIFICATION FAILED for ${absPath}: content differs from the pre-mutation original after restore -- treated as a hard failure regardless of probe outcome` };
  }
  return outcome;
}
function withPoisonedFunctionBody<T>(absPath: string, functionName: string, poisonStatement: string, fn: () => T): { ok: true; result: T } | { ok: false; error: string } {
  return withMutatedFileContent(
    absPath,
    (original) => {
      const target = locateTopLevelFunctionBodyInsertionPoint(original, absPath, functionName);
      if (!target.ok) return { ok: false, error: target.error };
      return { ok: true, content: original.slice(0, target.insertPos) + poisonStatement + original.slice(target.insertPos) };
    },
    fn,
  );
}
// [R5-F6] Registry-CONTENT mutation probe, closing round-4 finding 6: "a
// suite can hardcode today's IDs while calling findSkillById and pass
// everything" -- the round-3 `usesCompilerApiForRealExtraction`
// connectivity check this was meant to replace only proved createSourceFile
// fed forEachChild, never that the delegated file's per-action COVERAGE SET
// actually tracks the live file. Appends one synthetic action (modeled on
// the real first element's own source text, substituting only `id` and
// `preferredSkillIds`, so every other field stays a syntactically valid
// literal without needing to know the IconName enum) to
// DESIGN_TOOLBOX_ACTIONS's own array literal in a transient copy, and
// requires a NEW passing test titled for that synthetic id to appear in
// the rerun -- a suite that hardcoded today's ids can never produce a title
// for an id that did not exist when it was authored, regardless of how
// faithfully it calls findSkillById.
function locateDesignToolboxActionsArrayCloseBracket(sourceText: string, fileName: string): { ok: true; insertPos: number; firstElementText: string } | { ok: false; error: string } {
  const sf = parseTs(fileName, sourceText);
  const decls = findTopLevelNamedVariableDeclarations(sf, 'DESIGN_TOOLBOX_ACTIONS');
  if (decls.length !== 1) return { ok: false, error: `expected exactly 1 DESIGN_TOOLBOX_ACTIONS declaration, found ${decls.length}` };
  const decl = decls[0]!;
  if (!decl.initializer || !ts.isArrayLiteralExpression(decl.initializer)) return { ok: false, error: 'DESIGN_TOOLBOX_ACTIONS initializer is not an array literal' };
  const arr = decl.initializer;
  if (arr.elements.length === 0) return { ok: false, error: 'DESIGN_TOOLBOX_ACTIONS array is empty -- no element to model the synthetic probe entry on' };
  const first = arr.elements[0]!;
  return { ok: true, insertPos: arr.getEnd() - 1, firstElementText: sourceText.slice(first.getStart(sf), first.getEnd()) };
}
function withRegistryContentMutationProbe<T>(absPath: string, newActionId: string, resolvableSkillId: string, fn: () => T): { ok: true; result: T } | { ok: false; error: string } {
  return withMutatedFileContent(
    absPath,
    (original) => {
      const target = locateDesignToolboxActionsArrayCloseBracket(original, absPath);
      if (!target.ok) return { ok: false, error: target.error };
      let synthetic = target.firstElementText;
      synthetic = synthetic.replace(/id\s*:\s*(['"`])(?:(?!\1).)*\1/, `id: ${JSON.stringify(newActionId)}`);
      synthetic = synthetic.replace(/preferredSkillIds\s*:\s*\[[^\]]*\]/, `preferredSkillIds: [${JSON.stringify(resolvableSkillId)}]`);
      if (!synthetic.includes(newActionId) || !synthetic.includes(resolvableSkillId)) {
        return { ok: false, error: 'could not substitute id/preferredSkillIds into the synthetic action element -- refusing to run an unverified mutation' };
      }
      // The array's own last element commonly already ends with a trailing
      // comma before ']' (confirmed in design-toolbox.ts) -- unconditionally
      // prepending another comma would produce `..., , {synthetic}]`, a
      // SPARSE-ARRAY HOLE (JS: `[a, b, , c]` leaves index 2 `undefined`),
      // silently dropping a real action from the array rather than adding
      // one. Only add a separating comma when one is not already there.
      const before = original.slice(0, target.insertPos);
      const needsComma = !/,\s*$/.test(before);
      return { ok: true, content: before + (needsComma ? ',' : '') + `\n  ${synthetic}` + original.slice(target.insertPos) };
    },
    fn,
  );
}
// [R5-F1/F9/F10] Assertion-IDENTITY check for a poison-run's vitest JSON
// report -- replaces the round-4 "is the named test still reported as
// passed" boolean, which round-4's own review demonstrated accepts a
// crashed suite or empty reporter output as "flipped red" (an empty
// `assertionResults` trivially satisfies "not passed"). A mutation probe's
// verdict must distinguish PROBE FAILURE (the poison run produced no
// evidence at all -- crash, unparseable output, zero total tests, or the
// named test missing from results entirely) from a genuine ATTRIBUTABLE
// FAILURE (the named test is present, `status === 'failed'`, and carries a
// non-empty `failureMessages` array). Only the latter counts as "flipped
// red"; the former is fail-closed exactly like every other unconfirmed
// state in this file.
interface AttributableFailureCheck {
  ok: boolean;
  detail: string;
}
function requireAttributableFailure(run: { status: number; data: VitestSuiteJson | null; raw: string }, expectedTitleSuffix: string): AttributableFailureCheck {
  if (!run.data) {
    return { ok: false, detail: `PROBE FAILURE: poison run produced no parseable reporter output (exit=${run.status}) -- a missing/unparseable report is never accepted as evidence of a red assertion` };
  }
  if (run.data.numTotalTests === 0) {
    const crashMessages = run.data.testResults.map((t) => t.message).filter(Boolean).join('; ').slice(0, 500);
    return { ok: false, detail: `PROBE FAILURE: poison run reported zero total tests (suite likely crashed during collection/module-eval${crashMessages ? `: ${crashMessages}` : ''}) -- a crashed suite is never accepted as evidence of a red assertion` };
  }
  const allTests = run.data.testResults.flatMap((t) => t.assertionResults);
  const match = allTests.find((t) => t.fullName.endsWith(expectedTitleSuffix));
  if (!match) {
    return { ok: false, detail: `PROBE FAILURE: no test titled exactly "...${expectedTitleSuffix}" appeared anywhere in the poison run's results -- absence (e.g. a mid-run crash before reaching it) is never accepted as evidence of a red assertion` };
  }
  if (match.status !== 'failed') {
    return { ok: false, detail: `mutation probe FAILED: test "...${expectedTitleSuffix}" reported status="${match.status}" under poison, expected "failed" -- this specific assertion did not flip red` };
  }
  if (!match.failureMessages || match.failureMessages.length === 0) {
    return { ok: false, detail: `PROBE FAILURE: test "...${expectedTitleSuffix}" reported status="failed" but carries no failureMessages -- a failure with no attributable assertion evidence is not accepted` };
  }
  return { ok: true, detail: `attributable failure confirmed for "...${expectedTitleSuffix}": ${match.failureMessages[0]?.split('\n')[0]}` };
}
interface PwResult {
  status: string;
  stdout?: { text?: string }[];
}
interface PwTest {
  results: PwResult[];
}
interface PwSpec {
  title: string;
  ok: boolean;
  tests: PwTest[];
}
interface PwSuite {
  specs?: PwSpec[];
  suites?: PwSuite[];
}
interface PwJson {
  suites?: PwSuite[];
}
function collectPwSpecs(suite: PwSuite | undefined, out: PwSpec[]): void {
  if (!suite) return;
  for (const s of suite.specs ?? []) out.push(s);
  for (const child of suite.suites ?? []) collectPwSpecs(child, out);
}
// [R1-F2] Also collects every captured console.log line from every result's
// `stdout` array (confirmed-live schema, §2) so callers can cross-check a
// per-test runtime marker.
function pwSpecStdoutLines(spec: PwSpec): string[] {
  const lines: string[] = [];
  for (const t of spec.tests) {
    for (const r of t.results) {
      for (const entry of r.stdout ?? []) {
        if (entry.text) lines.push(...entry.text.split('\n'));
      }
    }
  }
  return lines;
}
function runPlaywrightFile(packageRelativeFile: string, outName: string): { status: number; specs: PwSpec[]; raw: string } {
  const outPath = path.join(proofDir, `${outName}.json`);
  const r = sh('pnpm', ['--filter', '@open-design/e2e', 'exec', 'playwright', 'test', '-c', 'playwright.config.ts', packageRelativeFile, '--reporter=json'], {
    timeoutMs: 20 * 60_000,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: outPath },
  });
  const specs: PwSpec[] = [];
  try {
    const data = JSON.parse(fs.readFileSync(outPath, 'utf8')) as PwJson;
    for (const suite of data.suites ?? []) collectPwSpecs(suite, specs);
  } catch {
    /* specs stays empty -- caller treats that as evidence failure */
  }
  return { status: r.status, specs, raw: `${r.stdout}\n${r.stderr}`.slice(0, 20_000) };
}

// =========================================================================
// Shared isolated-daemon-boot helper (C10C-3, C10C-5). Never ports
// 7456/51012; teardown targets the exact namespaced process `tools-dev`
// itself tracks, never a wrapper shell.
// =========================================================================
interface DaemonBootOk {
  ok: true;
  daemonUrl: string;
}
interface DaemonBootFail {
  ok: false;
  detail: string;
  rawEvidence: string;
}
// [R5-F4] Reference implementation ported (adapted) from
// scripts/waves/verify-w9-filesystem.ts@0d6bf026f (`evaluateTargetVisibility`
// + `classifyProcessTableScan` + their synthetic self-probe batteries), the
// commit round-4's review cited directly. Round-4's own teardown rewrite
// only proved self-visibility (this verifier's own pid appears in the `ps`
// enumeration) -- it never proved the scan mechanism could see the TARGET's
// session at all. A session-scoped `ps` (or an equivalent blind spot) could
// pass self-visibility every time while showing zero rows for the daemon's
// session, regardless of whether it actually has survivors -- reading as a
// trustworthy "confirmed empty" when it never observed the target once.
interface ProcessTableScanResult {
  /** True only when the scan itself is TRUSTWORTHY (exit 0, this verifier's
   * own known-alive pid is visible somewhere in the output, every row
   * parsed) -- never merely "found zero matching rows." `survivors` is only
   * meaningful when this is true. */
  ok: boolean;
  survivors: string[];
  detail: string;
}
/** Pure, deterministic classification over a `ps -Ao pid=,pgid=,comm=`-shaped
 * invocation's raw exit status + stdout, separated from the actual `ps` call
 * so its trustworthiness logic can be exercised with SYNTHETIC input
 * (`PROCESS_TABLE_SELF_PROBES`). Exit-zero-but-empty output, and exit-zero
 * output whose rows fail to parse, are NOT proof the group is empty -- they
 * are proof the SCAN ITSELF is broken, and the two must never be conflated.
 * The self-visibility control: this verifier's own process (`selfPid`,
 * definitely alive) must appear SOMEWHERE in the same enumeration, or
 * enumeration itself is untrustworthy. */
function classifyProcessTableScan(status: number, stdout: string, selfPid: number, targetPgid: number): ProcessTableScanResult {
  if (status !== 0) {
    return { ok: false, survivors: [], detail: `ps scan itself failed (exit=${status}) -- treated as unconfirmed, not as proof of a clean exit` };
  }
  const survivors: string[] = [];
  const malformed: string[] = [];
  let sawSelf = false;
  let rowCount = 0;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rowCount++;
    const parts = trimmed.split(/\s+/);
    const rowPid = Number(parts[0]);
    const rowPgid = Number(parts[1]);
    if (parts.length < 3 || !Number.isFinite(rowPid) || !Number.isFinite(rowPgid)) {
      malformed.push(trimmed.slice(0, 160));
      continue;
    }
    if (rowPid === selfPid) sawSelf = true;
    if (rowPgid === targetPgid) survivors.push(`pid=${rowPid} pgid=${rowPgid} comm=${parts.slice(2).join(' ')}`);
  }
  if (malformed.length > 0) {
    return {
      ok: false,
      survivors: [],
      detail: `ps output contained ${malformed.length} unparseable row(s) out of ${rowCount} -- enumeration integrity not confirmed, treated as a scan failure, never as proof of an empty group: ${malformed.slice(0, 3).join(' | ')}`,
    };
  }
  if (!sawSelf) {
    return {
      ok: false,
      survivors: [],
      detail: `ps output (exit=0, ${rowCount} row(s)) never included this verifier's own pid=${selfPid} -- a process KNOWN to be alive right now -- so enumeration itself is broken (self-visibility control failed), treated as a scan failure, never as proof of an empty group`,
    };
  }
  return { ok: true, survivors, detail: `ps scan trustworthy: self pid=${selfPid} visible among ${rowCount} row(s), 0 malformed` };
}
const PROCESS_TABLE_SELF_PROBES: Array<{ name: string; status: number; stdout: string; expectOk: boolean; expectSurvivorCount?: number }> = [
  { name: 'well-formed output, self visible, no target-pgid match', status: 0, stdout: '    1     1 launchd\n 4242   999 node\n  555   555 sh\n', expectOk: true, expectSurvivorCount: 0 },
  { name: 'well-formed output, self visible, target-pgid HAS a survivor', status: 0, stdout: '    1     1 launchd\n 4242   999 node\n 6001   777 hermes-agent\n', expectOk: true, expectSurvivorCount: 1 },
  { name: 'exit-zero but EMPTY output (enumeration silently produced nothing)', status: 0, stdout: '', expectOk: false },
  { name: 'exit-zero, well-formed OTHER rows, but self pid missing entirely', status: 0, stdout: '    1     1 launchd\n  555   555 sh\n', expectOk: false },
  { name: 'exit-zero, garbage/malformed rows', status: 0, stdout: 'not-a-pid not-a-pgid garbage\n 4242   999 node\n', expectOk: false },
  { name: 'nonzero exit (ps itself failed)', status: 1, stdout: '', expectOk: false },
];
let processTableSelfProbeResult: { pass: boolean; report: string[]; passCount: number; total: number } | null = null;
function runProcessTableSelfProbes(): { pass: boolean; report: string[]; passCount: number; total: number } {
  if (processTableSelfProbeResult) return processTableSelfProbeResult;
  const SELF_PID = 4242;
  const TARGET_PGID = 777;
  const report: string[] = [];
  let passCount = 0;
  for (const c of PROCESS_TABLE_SELF_PROBES) {
    const result = classifyProcessTableScan(c.status, c.stdout, SELF_PID, TARGET_PGID);
    const okMatches = result.ok === c.expectOk;
    const survivorMatches = c.expectSurvivorCount === undefined || (result.ok && result.survivors.length === c.expectSurvivorCount);
    if (okMatches && survivorMatches) {
      passCount++;
      report.push(`PASS ${c.name}: ok=${result.ok} survivors=${result.survivors.length}`);
    } else {
      report.push(`FAIL ${c.name}: expected ok=${c.expectOk}${c.expectSurvivorCount !== undefined ? ` survivors=${c.expectSurvivorCount}` : ''}, got ok=${result.ok} survivors=${result.survivors.length} detail=${result.detail}`);
    }
  }
  processTableSelfProbeResult = { pass: passCount === PROCESS_TABLE_SELF_PROBES.length, report, passCount, total: PROCESS_TABLE_SELF_PROBES.length };
  return processTableSelfProbeResult;
}
function processGroupSurvivorsChecked(pgid: number): ProcessTableScanResult {
  const r = sh('ps', ['-Ao', 'pid=,pgid=,comm='], { timeoutMs: 15_000 });
  return classifyProcessTableScan(r.status, r.stdout, process.pid, pgid);
}
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
interface TargetVisibilityResult {
  ok: boolean;
  detail: string;
}
/** [R5-F4] Positive control: while the target is independently
 * (kernel-level, `process.kill(pid, 0)`) confirmed alive, the SAME
 * `ps`-based scan mechanism must ALSO show a row for that exact pgid --
 * trivially true for a healthy target, since `detached: true` (the sidecar
 * is spawned this way) makes the leader its own pgid. A later "zero
 * survivors" result is trusted as "confirmed empty" ONLY when this
 * positive control passed. Must be evaluated BEFORE any stop/kill signal --
 * ours or `tools-dev`'s own graceful stop -- is sent, while the target is
 * still whatever it currently is; `withIsolatedDaemon` captures this
 * snapshot immediately after learning the boot pid, not at teardown time
 * (by teardown time `tools-dev stop` may have already, successfully,
 * killed the target, which would make "was it alive AND visible" trivially
 * false for the NORMAL HEALTHY case if evaluated fresh at that point). */
function evaluateTargetVisibility(targetAliveAtStart: boolean, preKillScan: ProcessTableScanResult | null): TargetVisibilityResult {
  if (!targetAliveAtStart) {
    return { ok: false, detail: 'target-visibility not established: the target was not independently confirmed alive (process.kill(pid,0)) when this snapshot was captured -- a later "confirmed empty" verdict cannot be trusted without this positive control' };
  }
  if (!preKillScan || !preKillScan.ok || preKillScan.survivors.length === 0) {
    return {
      ok: false,
      detail: `target-visibility FAILED: process.kill(pid,0) confirmed the target alive, but the ps-based scan for its own pgid found ${!preKillScan || !preKillScan.ok ? `an untrustworthy scan (${preKillScan?.detail ?? 'no scan performed'})` : 'zero rows'} -- the scan mechanism may be blind to this target's session (e.g. a session-scoped ps, or a shim that filters this pgid -- the "pgid-blind-shim" exploit class)`,
    };
  }
  return { ok: true, detail: `target-visibility confirmed: ${preKillScan.survivors.length} row(s) for the target's own pgid seen while it was independently confirmed alive` };
}
const TARGET_VISIBILITY_SELF_PROBES: Array<{ name: string; targetAliveAtStart: boolean; preKillScan: ProcessTableScanResult | null; expectOk: boolean }> = [
  { name: 'normal healthy case: target alive, scan sees its own pgid row', targetAliveAtStart: true, preKillScan: { ok: true, survivors: ['pid=999 pgid=999 node'], detail: 'ok' }, expectOk: true },
  { name: 'pgid-blind-shim exploit: target alive, self visible, but 0 target rows', targetAliveAtStart: true, preKillScan: { ok: true, survivors: [], detail: 'trustworthy: self visible, 0 target rows' }, expectOk: false },
  { name: 'target alive, but the pre-kill scan itself was untrustworthy', targetAliveAtStart: true, preKillScan: { ok: false, survivors: [], detail: 'malformed rows' }, expectOk: false },
  { name: 'target already not alive when the snapshot was captured -- no positive control possible', targetAliveAtStart: false, preKillScan: null, expectOk: false },
];
let targetVisibilitySelfProbeResult: { pass: boolean; report: string[]; passCount: number; total: number } | null = null;
function runTargetVisibilitySelfProbes(): { pass: boolean; report: string[]; passCount: number; total: number } {
  if (targetVisibilitySelfProbeResult) return targetVisibilitySelfProbeResult;
  const report: string[] = [];
  let passCount = 0;
  for (const c of TARGET_VISIBILITY_SELF_PROBES) {
    const result = evaluateTargetVisibility(c.targetAliveAtStart, c.preKillScan);
    if (result.ok === c.expectOk) {
      passCount++;
      report.push(`PASS ${c.name}: ok=${result.ok}`);
    } else {
      report.push(`FAIL ${c.name}: expected ok=${c.expectOk}, got ok=${result.ok} detail=${result.detail}`);
    }
  }
  targetVisibilitySelfProbeResult = { pass: passCount === TARGET_VISIBILITY_SELF_PROBES.length, report, passCount, total: TARGET_VISIBILITY_SELF_PROBES.length };
  return targetVisibilitySelfProbeResult;
}
async function waitForGroupEmptyChecked(pgid: number, timeoutMs: number, intervalMs = 200): Promise<ProcessTableScanResult> {
  const deadline = Date.now() + timeoutMs;
  let last = processGroupSurvivorsChecked(pgid);
  while (Date.now() < deadline) {
    if (last.ok && last.survivors.length === 0) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    last = processGroupSurvivorsChecked(pgid);
  }
  return last;
}
// [R4-F5, upgraded R5-F4] The daemon sidecar `tools-dev` spawns is
// detached:true (POSIX setsid()), so its reported pid doubles as its own
// process-group id. Gated by BOTH self-probe batteries first (a survivor
// scan is never trusted for a real verdict in a run where the
// classification logic cannot classify its own known fixtures correctly),
// then never trusts a "zero survivors" reading unless the CALLER-SUPPLIED
// `targetVisibility` positive control (captured at boot time, before any
// signal) already passed.
async function killGroupFailClosed(pgid: number, targetVisibility: TargetVisibilityResult): Promise<{ ok: boolean; detail: string }> {
  const selfProbes = runProcessTableSelfProbes();
  const targetVisibilityProbes = runTargetVisibilitySelfProbes();
  const selfProbeSummary = `process-table self-probes ${selfProbes.passCount}/${selfProbes.total} pass, target-visibility self-probes ${targetVisibilityProbes.passCount}/${targetVisibilityProbes.total} pass`;
  if (!selfProbes.pass || !targetVisibilityProbes.pass) {
    const failures = [...selfProbes.report, ...targetVisibilityProbes.report].filter((l) => l.startsWith('FAIL'));
    return { ok: false, detail: `${selfProbeSummary} -- refusing to trust any survivor scan this run: ${failures.join(' | ')}` };
  }
  try {
    process.kill(-pgid, 'SIGTERM');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
      return { ok: false, detail: `${selfProbeSummary}; ${targetVisibility.detail}; SIGTERM to group -${pgid} failed: ${String(err)}` };
    }
  }
  let scan = await waitForGroupEmptyChecked(pgid, 8_000);
  if (!(scan.ok && scan.survivors.length === 0)) {
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
        return { ok: false, detail: `${selfProbeSummary}; ${targetVisibility.detail}; SIGKILL to group -${pgid} failed: ${String(err)}` };
      }
    }
    scan = await waitForGroupEmptyChecked(pgid, 5_000);
  }
  if (!scan.ok) {
    return { ok: false, detail: `${selfProbeSummary}; ${targetVisibility.detail}; SCAN UNTRUSTWORTHY -- teardown NOT confirmed, never treated as an empty group: ${scan.detail}` };
  }
  if (scan.survivors.length > 0) {
    return { ok: false, detail: `${selfProbeSummary}; ${targetVisibility.detail}; process group -${pgid} has survivors after kill+wait: ${scan.survivors.join('; ')}` };
  }
  if (!targetVisibility.ok) {
    return { ok: false, detail: `${selfProbeSummary}; ${targetVisibility.detail}; post-kill scan shows zero survivors, but that result is NOT TRUSTED without a passing target-visibility positive control -- teardown NOT confirmed` };
  }
  return { ok: true, detail: `${selfProbeSummary}; ${targetVisibility.detail}; process group -${pgid} confirmed empty (${scan.detail})` };
}
// [R5-F8] Transitive commit-binding: `tools-dev`, the daemon it boots, and
// the CLI all resolve gitignored `packages/*` `dist/` output at runtime
// (e.g. @open-design/platform, sidecar, sidecar-proto) -- `tools-dev`'s own
// bundle freshness is self-checked (`assertFreshToolBuildFromMeta`), but
// nothing previously rebuilt or hash-validated those TRANSITIVE first-party
// packages, so a stale or hand-edited gitignored dist could drive
// lifecycle/runtime evidence without appearing in any git diff -- exactly
// the "no evidence from gitignored/mutable artifacts" rule this program
// binds every wave to. Fix, ported from verify-w9-filesystem.ts@0d6bf026f's
// INVARIANT 2 (which widened from a single package's dependency closure to
// the full workspace after finding a SECOND evidence path -- `pnpm
// typecheck` -- consumed packages the narrower rebuild missed): rebuild
// EVERY `packages/*` workspace member unconditionally
// (`pnpm --filter './packages/*' run build`, all 14 today), memoized to run
// once per verifier process. Called from both the isolated-daemon boot path
// and C10C-6's guard/typecheck check -- the union of every evidence path
// this verifier actually runs, with no per-path tracking to go stale.
let firstPartyPackagesRebuiltFromHead: Promise<void> | null = null;
function ensureFirstPartyPackagesRebuiltFromHead(): Promise<void> {
  if (!firstPartyPackagesRebuiltFromHead) {
    firstPartyPackagesRebuiltFromHead = (async () => {
      const r = sh('pnpm', ['--filter', './packages/*', 'run', 'build'], { timeoutMs: 5 * 60_000 });
      if (r.status !== 0) {
        throw new Error(
          `rebuilding every first-party packages/* workspace member from the current checkout failed (exit=${r.status}) -- refusing to trust any evidence path that could consume their gitignored dist output: ${(r.stderr || r.stdout).slice(-2000)}`,
        );
      }
    })();
  }
  return firstPartyPackagesRebuiltFromHead;
}
// [R5-F3] Fail-closed teardown confirmation, restructured so EVERY exit
// path -- including a `tools-dev start` that timed out or exited nonzero
// AFTER partially spawning a process -- consumes it. Requires BOTH,
// conjunctively: (a) `tools-dev stop`'s OWN self-report is clean (exit 0,
// parseable JSON, `daemon.status` is exactly "stopped" or "not-running" --
// never "partial" or anything else: a partial/failed/unparseable
// self-report is a hard failure regardless of what a later scan finds, per
// the explicit "partial/failed stop NEVER resolves success" requirement),
// AND (b) the target-visibility-gated group-wide `ps` scan independently
// confirms the process group empty. Escalation (SIGTERM/SIGKILL via
// killGroupFailClosed) still runs whenever the post-stop scan finds
// survivors, purely for real process hygiene -- but escalation succeeding
// can never upgrade a bad self-report to "ok".
interface StopParsedShape {
  daemon?: { status?: string; stop?: { remainingPids?: number[] } };
}
function parseJsonTail<J>(stdout: string): J | null {
  const start = stdout.indexOf('{');
  if (start === -1) return null;
  try {
    return JSON.parse(stdout.slice(start)) as J;
  } catch {
    return null;
  }
}
async function confirmTeardown(namespace: string, knownPid: number | null, targetVisibility: TargetVisibilityResult): Promise<{ ok: boolean; detail: string }> {
  const stopResult = sh('pnpm', ['tools-dev', 'stop', 'daemon', '--namespace', namespace, '--json'], { timeoutMs: 60_000 });
  const stopParsed = parseJsonTail<StopParsedShape>(stopResult.stdout);
  const reportedStatus = stopParsed?.daemon?.status ?? null;
  const selfReportClean = stopResult.status === 0 && stopParsed !== null && (reportedStatus === 'stopped' || reportedStatus === 'not-running');

  if (knownPid === null) {
    // Nothing was ever captured as a boot pid. Only a legitimate "nothing
    // to tear down" case if the self-report independently agrees; a status
    // that reports something we failed to capture cannot be confirmed.
    return selfReportClean
      ? { ok: true, detail: `no boot pid was ever captured for namespace "${namespace}" and tools-dev independently agrees (status="${reportedStatus}") -- nothing to tear down` }
      : { ok: false, detail: `TEARDOWN UNCONFIRMED: no boot pid was ever captured for namespace "${namespace}", so no process group can be scanned, AND the self-report was not clean (exit=${stopResult.status}, status=${reportedStatus ?? 'unparseable'})` };
  }

  const postStopScan = processGroupSurvivorsChecked(knownPid);
  let groupConfirmedEmpty: boolean;
  let groupDetail: string;
  if (postStopScan.ok && postStopScan.survivors.length === 0) {
    groupConfirmedEmpty = targetVisibility.ok;
    groupDetail = targetVisibility.ok
      ? `post-stop group-wide ps scan confirmed process group -${knownPid} empty`
      : `post-stop scan shows zero survivors but the target-visibility positive control did not pass -- NOT TRUSTED: ${targetVisibility.detail}`;
  } else {
    const escalated = await killGroupFailClosed(knownPid, targetVisibility);
    groupConfirmedEmpty = escalated.ok;
    groupDetail = `post-stop scan found survivor(s) or was untrustworthy (${postStopScan.detail}); escalation: ${escalated.detail}`;
  }

  const ok = selfReportClean && groupConfirmedEmpty;
  return {
    ok,
    detail: `tools-dev stop: exit=${stopResult.status} status="${reportedStatus}" selfReportClean=${selfReportClean}; ${groupDetail}`,
  };
}
async function withIsolatedDaemon<T>(
  label: string,
  fn: (daemonUrl: string) => Promise<T>,
): Promise<{ boot: DaemonBootOk | DaemonBootFail; result: T | null; teardownOk: boolean; teardownDetail: string }> {
  const namespace = `verify-w10c-${label}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-w10c-data-'));
  let bootedPid: number | null = null;
  // [R5-F4] Captured immediately after learning the boot pid, BEFORE any
  // stop/kill signal (ours or tools-dev's own graceful stop) can be sent --
  // see evaluateTargetVisibility's doc comment for why this must not be
  // deferred to teardown time.
  let targetVisibilitySnapshot: TargetVisibilityResult = { ok: false, detail: 'no boot pid was ever captured -- target-visibility positive control never established' };

  async function bootAndRun(): Promise<{ boot: DaemonBootOk | DaemonBootFail; result: T | null }> {
    await ensureFirstPartyPackagesRebuiltFromHead(); // [R5-F8]
    // `start`, not `run`: `tools-dev run` blocks in the foreground until
    // interrupted (confirmed by reading its own CLI registration text,
    // "Start apps and keep this command alive until interrupted"); `start`
    // returns once the daemon is confirmed running, which this script needs.
    const startResult = sh('pnpm', ['tools-dev', 'start', 'daemon', '--namespace', namespace, '--json'], {
      timeoutMs: 3 * 60_000,
      env: { ...process.env, OD_DATA_DIR: tempDataDir },
    });
    // [R5-F3] Discover a pid REGARDLESS of startResult.status -- a timeout
    // or nonzero exit does not prove nothing was spawned; a partially-booted
    // daemon can outlive a failed wrapper CLI invocation.
    //
    // [R5-F4, live discovery this round] `daemon.pid` (top-level, from
    // `spawnDaemonRuntime`'s own `spawned.pid` -- tools/dev/src/index.ts)
    // and `daemon.status.pid` (nested, the daemon's OWN self-reported pid
    // via its status/IPC) are TWO DIFFERENT PIDS -- confirmed live this
    // round: `daemon.pid=66866` (ppid=1, pgid=66866 -- the actual detached
    // process-group leader `tools-dev` itself spawned) vs
    // `daemon.status.pid=66867` (ppid=66866, pgid=66866 -- an inner child
    // whose OWN pgid is INHERITED, not its own pid). This was a LATENT bug
    // in every prior round: teardown captured `daemon.status.pid` and
    // group-scanned/signaled `-66867`, a process-group id that never had
    // any members, making every prior round's "confirmed empty" scan
    // vacuously true regardless of real teardown state -- exactly the class
    // of bug the target-visibility positive control (`[R5-F4]`) exists to
    // catch, and it did: a real run this round correctly reported
    // target-visibility FAILED (alive but zero rows for that pgid) rather
    // than silently passing. `tools-dev stop`'s own `stop.matchedPids`
    // confirms production code itself tracks and stops BOTH pids
    // (`[66867, 66866]`), so this file now captures the CORRECT one --
    // `daemon.pid` -- for group-scan/signal purposes.
    let daemonUrl: string | null = null;
    const startParsed = parseJsonTail<{ daemon?: { pid?: number | null; status?: { url?: string; pid?: number | null } } }>(startResult.stdout);
    daemonUrl = startParsed?.daemon?.status?.url ?? null;
    bootedPid = startParsed?.daemon?.pid ?? startParsed?.daemon?.status?.pid ?? null;
    if (!daemonUrl || bootedPid === null) {
      // `tools-dev status daemon --json` only ever returns the INNER
      // self-reported shape (confirmed live: identical to `daemon.status`
      // above, no separate outer pid field) -- this fallback path can only
      // recover the inner pid, which is a known-degraded case: if it
      // targets a non-leader pid, the target-visibility control above
      // (re-evaluated below once bootedPid is known) will correctly fail
      // closed rather than silently misreporting a scan of an empty group
      // as "confirmed."
      const statusResult = sh('pnpm', ['tools-dev', 'status', 'daemon', '--namespace', namespace, '--json'], { timeoutMs: 30_000 });
      const statusParsed = parseJsonTail<{ url?: string; pid?: number | null }>(statusResult.stdout);
      daemonUrl = daemonUrl ?? statusParsed?.url ?? null;
      bootedPid = bootedPid ?? statusParsed?.pid ?? null;
    }
    if (bootedPid !== null) {
      const aliveNow = isPidAlive(bootedPid);
      const scanNow = aliveNow ? processGroupSurvivorsChecked(bootedPid) : null;
      targetVisibilitySnapshot = evaluateTargetVisibility(aliveNow, scanNow);
    }
    if (startResult.status !== 0) {
      return { boot: { ok: false, detail: `tools-dev start failed with exit ${startResult.status}`, rawEvidence: `${startResult.stdout}\n${startResult.stderr}` }, result: null };
    }
    if (!daemonUrl) {
      return { boot: { ok: false, detail: 'could not discover the isolated daemon URL from tools-dev output', rawEvidence: startResult.stdout }, result: null };
    }
    const parsedUrl = new URL(daemonUrl);
    const forbiddenPorts = new Set(['7456', '51012']);
    if (forbiddenPorts.has(parsedUrl.port)) {
      return { boot: { ok: false, detail: `discovered daemon port ${parsedUrl.port} is a forbidden default-namespace port -- refusing to probe it`, rawEvidence: '' }, result: null };
    }
    if (!['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)) {
      return { boot: { ok: false, detail: `discovered daemon hostname "${parsedUrl.hostname}" is not a loopback address -- refusing to probe it`, rawEvidence: '' }, result: null };
    }
    const result = await fn(daemonUrl);
    return { boot: { ok: true, daemonUrl }, result };
  }

  let outcome: { boot: DaemonBootOk | DaemonBootFail; result: T | null } = {
    boot: { ok: false, detail: 'bootAndRun did not complete', rawEvidence: '' },
    result: null,
  };
  let teardownOk = true;
  let teardownDetail = '';
  try {
    outcome = await bootAndRun();
  } finally {
    // [R5-F3] ALWAYS attempt confirmation -- the `started` flag guard is
    // removed entirely. `tools-dev status`/`stop` are asked regardless of
    // what `start` itself reported, so a boot that timed out or exited
    // nonzero after partially spawning a process is still confirmed
    // torn-down, never silently skipped.
    const confirmed = await confirmTeardown(namespace, bootedPid, targetVisibilitySnapshot);
    teardownOk = confirmed.ok;
    teardownDetail = confirmed.detail;
    // Only remove the temp data dir once teardown is independently
    // confirmed -- an unconfirmed teardown leaves it in place for
    // post-mortem inspection instead of destroying potential evidence.
    // Scratch verifier state under os.tmpdir(), never user data.
    if (teardownOk) {
      try {
        fs.rmSync(tempDataDir, { recursive: true, force: true });
      } catch {
        /* best effort cleanup only */
      }
    }
  }
  return { ...outcome, teardownOk, teardownDetail };
}
// [R3-F5] Fail-closed, redirect:'manual', re-validated-origin GET for
// /api/skills -- the SINGLE hardened fetch path every C10C-3/C10C-5 probe
// must go through (never a raw, ad hoc `fetch(...)` call), returning both
// the id list (for parity/multiset checks) and the raw skill records (for
// callers, like C10C-3's oracle, that need real objects to pass into
// findDesignToolboxSkill).
async function fetchLiveSkillsOverHttp(daemonUrl: string): Promise<{ ok: true; ids: string[]; skills: unknown[] } | { ok: false; error: string }> {
  try {
    const base = new URL(daemonUrl);
    const skillsUrl = new URL('/api/skills', daemonUrl);
    if (skillsUrl.origin !== base.origin) throw new Error('constructed URL origin drifted from the discovered daemon origin');
    const resp = await fetch(skillsUrl, { redirect: 'manual' });
    if (resp.status >= 300 && resp.status < 400) throw new Error(`unexpected redirect (status ${resp.status}) -- refusing to follow`);
    if (resp.status !== 200) throw new Error(`GET /api/skills returned status ${resp.status}`);
    const body = (await resp.json()) as { skills?: { id?: string }[] };
    const skills = body.skills ?? [];
    return { ok: true, ids: skills.map((s) => String(s.id ?? '')), skills };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

// =========================================================================
// Main
// =========================================================================
const I18N_TYPES_REL = 'apps/web/src/i18n/types.ts';
const I18N_EN_REL = 'apps/web/src/i18n/locales/en.ts';
const E2E_UI_SPEC_REL = 'e2e/ui/design-toolbox-actions.test.ts';
const E2E_UI_SPEC_PKG_REL = 'ui/design-toolbox-actions.test.ts'; // [R1-F1]
const E2E_PHANTOM_SPEC_REL = 'e2e/tests/design-toolbox-phantom-id.test.ts';
const E2E_PHANTOM_SPEC_PKG_REL = 'tests/design-toolbox-phantom-id.test.ts'; // [R1-F1]
const DAEMON_SUITE_SPEC_REL = 'apps/daemon/tests/design-toolbox-skill-refs.test.ts';
const DAEMON_SUITE_SPEC_PKG_REL = 'tests/design-toolbox-skill-refs.test.ts'; // [R1-F1]
const REVIEW_RECORD_REL = 'docs/plans/waves/w10c-toolbox-implementation-review.json';
const CHAT_COMPOSER_JSDOM_TEST_REL = 'apps/web/tests/components/ChatComposer.design-toolbox.test.tsx';
const REPO_ROOT_GUARD_REL = 'scripts/check-toolbox-skill-refs.test.ts';

// [R1-F7] Complete owned-path list. [R3-F1] added NEXT_STEP_ACTIONS_SRC_REL
// -- it is now a real dependency of C10C-2's cross-file structural proof, so
// C10C-7's stale-review check must cover it too.
const OWNED_IMPLEMENTATION_PATHS = [
  E2E_UI_SPEC_REL,
  E2E_PHANTOM_SPEC_REL,
  DAEMON_SUITE_SPEC_REL,
  DESIGN_TOOLBOX_SRC_REL,
  I18N_TYPES_REL,
  I18N_EN_REL,
  CHAT_COMPOSER_JSDOM_TEST_REL,
  REPO_ROOT_GUARD_REL,
  NEXT_STEP_ACTIONS_SRC_REL,
];

let derivedActionIds: string[] | null = null; // set by C10C-1, consumed by C10C-2/C10C-4

async function main(): Promise<void> {
  // -----------------------------------------------------------------------
  // C10C-1
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-1', async () => {
    const srcAbs = path.join(repoRoot, DESIGN_TOOLBOX_SRC_REL);
    const typesAbs = path.join(repoRoot, I18N_TYPES_REL);
    const enAbs = path.join(repoRoot, I18N_EN_REL);
    if (!fs.existsSync(srcAbs)) {
      record('C10C-1', '', 'DESIGN_TOOLBOX_ACTIONS structurally sound, runtime-cross-checked, and i18n-complete', false, '', { detail: `${DESIGN_TOOLBOX_SRC_REL} does not exist` });
      return;
    }
    const source = fs.readFileSync(srcAbs, 'utf8');
    const sf = parseTs(srcAbs, source);
    const layerA = extractDesignToolboxActionsLayerA(source, srcAbs);
    const mutationHits = scanForMutationCalls(sf, 'DESIGN_TOOLBOX_ACTIONS');
    const structuralProblems: string[] = [...layerA.errors];
    if (mutationHits.length) structuralProblems.push(`mutation call(s) against DESIGN_TOOLBOX_ACTIONS found: ${mutationHits.join(', ')}`);

    if (!layerA.ok) {
      record('C10C-1', `TypeScript-AST parse of ${DESIGN_TOOLBOX_SRC_REL}`, 'DESIGN_TOOLBOX_ACTIONS is a unique, top-level, exported, literal-only array (Layer A)', false, structuralProblems.join('\n'));
      return;
    }

    // Layer B -- runtime cross-check.
    const runtimeMod = await loadDesignToolboxModule();
    if (!runtimeMod.ok) {
      record('C10C-1', 'dynamic import() of the real design-toolbox.ts module', 'the module loads and executes at runtime', false, '', { detail: runtimeMod.error });
      return;
    }
    // [R3-F4] Runtime property-descriptor/prototype shape check -- the
    // authoritative defense against alias-mediated mutation (see FIX ROUND 3
    // header note); run BEFORE the more lenient safeExtractRuntimeActions,
    // which only checks hasOwnProperty and would happily accept a shape this
    // check rejects (extra keys, accessor descriptors, foreign prototypes).
    const shapeCheck = inspectRuntimeActionsShape(runtimeMod.mod.DESIGN_TOOLBOX_ACTIONS);
    if (!shapeCheck.ok) structuralProblems.push(`runtime shape check failed:\n${shapeCheck.problems.join('\n')}`);

    const runtimeActions = safeExtractRuntimeActions(runtimeMod.mod.DESIGN_TOOLBOX_ACTIONS);
    if (!runtimeActions.ok) {
      record('C10C-1', '', 'the runtime-executed DESIGN_TOOLBOX_ACTIONS export matches the AST-derived reading', false, structuralProblems.join('\n'), { detail: runtimeActions.error });
      return;
    }
    const crossCheck = actionListsExactlyEqual(layerA.actions, runtimeActions.actions);
    if (!crossCheck.equal) {
      structuralProblems.push(`Layer A / Layer B mismatch:\n${crossCheck.detail}`);
    }

    if (!fs.existsSync(typesAbs) || !fs.existsSync(enAbs)) {
      record('C10C-1', '', 'i18n cross-check sources exist', false, structuralProblems.join('\n'), { detail: `missing ${!fs.existsSync(typesAbs) ? I18N_TYPES_REL : ''} ${!fs.existsSync(enAbs) ? I18N_EN_REL : ''}`.trim() });
      return;
    }
    const i18n = extractDesignToolboxI18nIdsFromDict(fs.readFileSync(typesAbs, 'utf8'), typesAbs);
    if (!i18n.ok) {
      record('C10C-1', `TypeScript-AST parse of ${I18N_TYPES_REL}`, 'exactly one "Dict" interface declaration exists', false, structuralProblems.join('\n'), { detail: i18n.error });
      return;
    }
    const enExtract = extractEnToolboxKeyValues(fs.readFileSync(enAbs, 'utf8'), enAbs);
    const idDiff = multisetDiff(
      runtimeActions.actions.map((a) => a.id),
      [...i18n.complete],
    );
    const problems: string[] = [...structuralProblems];
    if (idDiff.onlyInA.length) problems.push(`actions with no complete (title+badge+description) Dict key triple: ${idDiff.onlyInA.join(', ')}`);
    if (idDiff.onlyInB.length) problems.push(`Dict key triples with no matching action: ${idDiff.onlyInB.join(', ')}`);
    if (idDiff.countMismatch.length) problems.push(`id count mismatches: ${idDiff.countMismatch.join(', ')}`);
    if (i18n.incomplete.length) problems.push(`incomplete Dict key triples: ${i18n.incomplete.join(', ')}`);
    if (enExtract.empty.length) problems.push(`empty-string en.ts values: ${enExtract.empty.join(', ')}`);
    const expectedKeys = [...i18n.complete].flatMap((id) => [
      `chat.designToolbox.action.${id}.title`,
      `chat.designToolbox.action.${id}.badge`,
      `chat.designToolbox.action.${id}.description`,
    ]);
    const missingFromEn = expectedKeys.filter((k) => !enExtract.present.has(k));
    if (missingFromEn.length) problems.push(`keys declared in Dict but missing (or empty) in en.ts: ${missingFromEn.join(', ')}`);

    if (problems.length === 0) derivedActionIds = runtimeActions.actions.map((a) => a.id);
    record(
      'C10C-1',
      `AST parse of ${DESIGN_TOOLBOX_SRC_REL}/${I18N_TYPES_REL}/${I18N_EN_REL} + dynamic import() of ${DESIGN_TOOLBOX_SRC_REL}`,
      'unique top-level exported literal-only DESIGN_TOOLBOX_ACTIONS (Layer A), no mutation calls, exactly matching its own runtime-executed export (Layer B) whose OWN KEYS/DESCRIPTORS/PROTOTYPE are an honest plain array of plain data-property objects (no accessor, no extra key, no foreign prototype), exactly matching the unique Dict interface, exactly matching non-empty en.ts values',
      problems.length === 0,
      `derived action count: ${runtimeActions.actions.length}\nderived ids: ${[...new Set(runtimeActions.actions.map((a) => a.id))].sort().join(', ')}\n${problems.join('\n')}`,
    );
  });

  // -----------------------------------------------------------------------
  // C10C-2 -- [orchestrator ruling 2] extended to cover BOTH catalogue
  // consumers (DesignToolboxPanel + NextStepActions.tsx), asserting their
  // featured/non-featured partition of the derived action set explicitly.
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-2', async () => {
    if (!derivedActionIds || derivedActionIds.length === 0) {
      record('C10C-2', '', 'per-action walk covers exactly the C10C-1-derived action set for both consumers', false, '', { detail: 'C10C-1 did not produce a derived action-id set; cannot verify per-action coverage' });
      return;
    }

    // Independent runtime oracle + the explicit consumer-partition check
    // (orchestrator ruling 2's "assert the intended difference" instruction).
    // Computed regardless of whether the delegated spec file exists yet --
    // the partition is a fact about the catalogue itself, not about the test.
    const toolboxMod = await loadDesignToolboxModule();
    const skillsResult = await liveSkillsList();
    if (!toolboxMod.ok || !skillsResult.ok) {
      record('C10C-2', '', 'this verifier can independently compute the expected resolution for every action and the featured/non-featured partition', false, '', {
        detail: !toolboxMod.ok ? toolboxMod.error : !skillsResult.ok ? skillsResult.error : 'unknown oracle failure',
      });
      return;
    }
    const findDesignToolboxSkill = toolboxMod.mod.findDesignToolboxSkill;
    const actionsRuntime = safeExtractRuntimeActions(toolboxMod.mod.DESIGN_TOOLBOX_ACTIONS);
    if (typeof findDesignToolboxSkill !== 'function' || !actionsRuntime.ok) {
      record('C10C-2', '', 'this verifier can independently compute the expected resolution for every action', false, '', { detail: 'findDesignToolboxSkill is not callable or DESIGN_TOOLBOX_ACTIONS is malformed at runtime' });
      return;
    }
    const runtimeActionsByFullObj = toolboxMod.mod.DESIGN_TOOLBOX_ACTIONS as { id: string }[];
    const expectedByAction = new Map<string, string>();
    for (const action of runtimeActionsByFullObj) {
      const resolved = (findDesignToolboxSkill as (a: unknown, s: unknown[]) => { name?: unknown } | null)(action, skillsResult.skills);
      expectedByAction.set(action.id, resolved && typeof resolved.name === 'string' ? resolved.name : '__NONE__');
    }

    const partitionProblems: string[] = [];
    const featuredRaw = toolboxMod.mod.FEATURED_DESIGN_TOOLBOX_ACTION_IDS;
    const featuredShape = inspectRuntimeStringArrayShape(featuredRaw, 'FEATURED_DESIGN_TOOLBOX_ACTION_IDS'); // [R3-F4]
    if (!featuredShape.ok) {
      partitionProblems.push(...featuredShape.problems);
    } else {
      const featuredIds = featuredRaw as string[];
      if (featuredIds.length === 0) partitionProblems.push('FEATURED_DESIGN_TOOLBOX_ACTION_IDS is empty');
      const nonFeaturedIds = derivedActionIds.filter((id) => !featuredIds.includes(id));
      const partitionDiff = multisetDiff([...featuredIds, ...nonFeaturedIds], derivedActionIds);
      if (partitionDiff.onlyInA.length) partitionProblems.push(`featured+non-featured union has id(s) not in the derived set: ${partitionDiff.onlyInA.join(', ')}`);
      if (partitionDiff.onlyInB.length) partitionProblems.push(`derived set has id(s) covered by NEITHER featured nor non-featured: ${partitionDiff.onlyInB.join(', ')}`);
      if (partitionDiff.countMismatch.length) partitionProblems.push(`featured/non-featured partition count mismatch (overlap or duplicate): ${partitionDiff.countMismatch.join(', ')}`);
    }
    // [R3-F1] Cross-file structural proof: the above is a fact about the
    // verifier's OWN arithmetic (complement of the featured set). Proving
    // the SECOND CONSUMER actually renders that split requires parsing
    // NextStepActions.tsx's own real source and checking it, not the
    // verifier's derived set, structurally implements the partition and
    // exposes the four pinned testid fragments as genuine JSX literals.
    const nextStepSrcAbs = path.join(repoRoot, NEXT_STEP_ACTIONS_SRC_REL);
    if (!fs.existsSync(nextStepSrcAbs)) {
      partitionProblems.push(`${NEXT_STEP_ACTIONS_SRC_REL} does not exist -- cannot prove the second consumer structurally implements the featured/non-featured split`);
    } else {
      const nextStepSource = fs.readFileSync(nextStepSrcAbs, 'utf8');
      const nextStepSf = parseTs(nextStepSrcAbs, nextStepSource);
      const structuralPartition = nextStepPartitionIsStructurallyReal(nextStepSf);
      if (!structuralPartition.ok) partitionProblems.push(...structuralPartition.problems.map((p) => `[${NEXT_STEP_ACTIONS_SRC_REL}] ${p}`));
      const testIdValues = collectJsxTestIdLiteralValues(nextStepSf);
      for (const fragment of ['next-step-toolbox-action-', 'next-step-toolbox-more', 'next-step-more-toolbox', 'next-step-toolbox-sub-action-']) {
        if (![...testIdValues].some((v) => v.includes(fragment))) {
          partitionProblems.push(`[${NEXT_STEP_ACTIONS_SRC_REL}] no data-testid literal containing "${fragment}" found in its own source`);
        }
      }
    }

    const specAbs = path.join(repoRoot, E2E_UI_SPEC_REL);
    if (!fs.existsSync(specAbs)) {
      record('C10C-2', '', 'exhaustive, table-driven, real-daemon-backed per-action walk from BOTH catalogue consumers, with an explicit partition assertion and a fresh runtime oracle', false, partitionProblems.join('\n'), { detail: `${E2E_UI_SPEC_REL} does not exist` });
      return;
    }

    const source = fs.readFileSync(specAbs, 'utf8');
    const sf = parseTs(specAbs, source);
    const banned = containsBannedTestMarker(sf);
    const hasDynImport = hasDynamicImportReferencingFile(sf, 'design-toolbox');
    const allLoops = findAllForOfLoopsGeneratingTests(sf, 'TOOLBOX_ACTIONS');
    const sidePanelLoop = allLoops.find((l) => subtreeContainsStringLiteralFragment(l.statement, 'chat-plus-trigger'));
    const nextStepLoop = allLoops.find((l) => subtreeContainsStringLiteralFragment(l.statement, 'next-step-toolbox'));
    // [R4-F1] The dynamic-import-destructured local name findDesignToolboxSkill
    // is bound to in THIS spec file (if any) -- reused by both loop checks
    // below to reject a marker computed directly from the resolver instead
    // of from an observed DOM read (the round-3 final finding's exact
    // wording: "calculate markers directly from the imported resolver").
    const resolverBindingInSpec = findDestructuredImportBinding(sf, 'findDesignToolboxSkill');

    const structuralProblems: string[] = [...partitionProblems];
    if (banned.length) structuralProblems.push(`banned skip/only/fixme/todo markers: ${banned.join(', ')}`);
    if (!hasDynImport) structuralProblems.push('no dynamic import() call referencing "design-toolbox" found (a static import declaration fails this package\'s NodeNext typecheck -- see PRD §2)');
    if (!sidePanelLoop) {
      structuralProblems.push('no for-of loop over a TOOLBOX_ACTIONS-like binding referencing "chat-plus-trigger" (the DesignToolboxPanel consumer loop) was found');
    } else {
      // [R4-F1] closes the round-3 final finding verbatim: the side-panel
      // loop previously required only a click on chat-plus-trigger plus ANY
      // textContent call -- never a click on "Design toolbox", never a
      // click on the per-action row, never a textContent bound to
      // chat-composer-input specifically, and never a marker traced back to
      // that read. All five are now bound checks, not unbound "somewhere in
      // the loop" facts.
      const loopVar = findForOfIterationVariableName(sidePanelLoop);
      if (countClickChainsReferencing(sidePanelLoop.statement, 'chat-plus-trigger') < 1) {
        structuralProblems.push('the side-panel test loop has no .click() call whose OWN selector-chain references "chat-plus-trigger"');
      }
      if (countClickChainsReferencing(sidePanelLoop.statement, 'Design toolbox') < 1) {
        structuralProblems.push('the side-panel test loop has no .click() call whose OWN selector-chain references the "Design toolbox" menuitem');
      }
      if (!loopVar || countClickChainsReferencingIdentifier(sidePanelLoop.statement, loopVar) < 1) {
        structuralProblems.push('the side-panel test loop has no .click() call whose selector target depends on the loop\'s own action variable (the per-action row click)');
      }
      if (countTextContentChainsReferencing(sidePanelLoop.statement, 'chat-composer-input') < 1) {
        structuralProblems.push('the side-panel test loop has no .textContent(...)/.innerText(...) call whose OWN selector-chain references "chat-composer-input"');
      }
      const observedVars = collectObservedReadVariableNames(sidePanelLoop.statement, 'chat-composer-input');
      if (!consoleLogArgumentsReferenceAnyIdentifier(sidePanelLoop.statement, observedVars)) {
        structuralProblems.push('the side-panel test loop\'s marker console.log(...) call does not reference any variable derived from a .textContent()/.innerText() read -- cannot prove the marker reflects what was actually observed');
      }
      if (resolverBindingInSpec.found && resolverBindingInSpec.localName && consoleLogArgumentsReferenceIdentifierDirectly(sidePanelLoop.statement, resolverBindingInSpec.localName)) {
        structuralProblems.push(`the side-panel test loop's marker console.log(...) call references the imported findDesignToolboxSkill binding ("${resolverBindingInSpec.localName}") directly -- markers must be derived from the observed DOM read, not computed directly from the resolver`);
      }
    }
    if (!nextStepLoop) {
      structuralProblems.push('no for-of loop over a TOOLBOX_ACTIONS-like binding referencing "next-step-toolbox" (the NextStepActions consumer loop required by orchestrator ruling 2) was found');
    } else {
      // [R3-F1] require THREE distinct, selector-bound click chains proving
      // the real multi-step "More" navigation structure confirmed against
      // NextStepActions.tsx's own source (next-step-toolbox-more opens the
      // More menu, next-step-more-toolbox opens the toolbox submenu, then
      // either next-step-toolbox-action-<id> (featured/direct) or
      // next-step-toolbox-sub-action-<id> (non-featured/submenu) is
      // clicked) -- not one unbound .click() call that could belong to
      // either surface or neither.
      const moreTriggerClicks = countClickChainsReferencing(nextStepLoop.statement, 'next-step-toolbox-more');
      const moreSubmenuClicks = countClickChainsReferencing(nextStepLoop.statement, 'next-step-more-toolbox');
      const directOrSubActionClicks =
        countClickChainsReferencing(nextStepLoop.statement, 'next-step-toolbox-action') + countClickChainsReferencing(nextStepLoop.statement, 'next-step-toolbox-sub-action');
      if (moreTriggerClicks < 1) structuralProblems.push('the next-step test loop has no .click() call bound to the "next-step-toolbox-more" trigger selector');
      if (moreSubmenuClicks < 1) structuralProblems.push('the next-step test loop has no .click() call bound to the "next-step-more-toolbox" submenu selector');
      if (directOrSubActionClicks < 1) structuralProblems.push('the next-step test loop has no .click() call bound to a "next-step-toolbox-action-"/"next-step-toolbox-sub-action-" selector');
      // [R4-F1] same textContent-binding + marker-dataflow closure applied
      // to the next-step loop for consistency -- round-3's finding named
      // only the side-panel loop explicitly, but the underlying gap
      // (unbound textContent presence, marker not traced to an observed
      // read) was identical in both loops.
      if (countTextContentChainsReferencing(nextStepLoop.statement, 'chat-composer-input') < 1) {
        structuralProblems.push('the next-step test loop has no .textContent(...)/.innerText(...) call whose OWN selector-chain references "chat-composer-input"');
      }
      const nextStepObservedVars = collectObservedReadVariableNames(nextStepLoop.statement, 'chat-composer-input');
      if (!consoleLogArgumentsReferenceAnyIdentifier(nextStepLoop.statement, nextStepObservedVars)) {
        structuralProblems.push('the next-step test loop\'s marker console.log(...) call does not reference any variable derived from a .textContent()/.innerText() read -- cannot prove the marker reflects what was actually observed');
      }
      if (resolverBindingInSpec.found && resolverBindingInSpec.localName && consoleLogArgumentsReferenceIdentifierDirectly(nextStepLoop.statement, resolverBindingInSpec.localName)) {
        structuralProblems.push(`the next-step test loop's marker console.log(...) call references the imported findDesignToolboxSkill binding ("${resolverBindingInSpec.localName}") directly -- markers must be derived from the observed DOM read, not computed directly from the resolver`);
      }
    }

    const run = runPlaywrightFile(E2E_UI_SPEC_PKG_REL, 'C10C-2-playwright'); // [R1-F1] package-relative
    const coverageProblems: string[] = [];
    const sidePanelTitle = (id: string) => `toolbox action "${id}" resolves and applies from the side panel`;
    const nextStepTitle = (id: string) => `next-step action "${id}" resolves and applies from the assistant next-step card`;
    const sidePanelMarkerRe = /^W10C_RESOLVED (\S+) (.+)$/;
    const nextStepMarkerRe = /^W10C_NEXTSTEP_RESOLVED (\S+) (.+)$/;

    function checkOneConsumer(titleFor: (id: string) => string, markerRe: RegExp, label: string): void {
      for (const id of derivedActionIds!) {
        const expectedTitle = titleFor(id);
        const matching = run.specs.filter((s) => s.title === expectedTitle);
        if (matching.length === 0) {
          coverageProblems.push(`[${label}] no spec titled exactly "${expectedTitle}"`);
          continue;
        }
        if (matching.length > 1) {
          coverageProblems.push(`[${label}] ${matching.length} specs titled exactly "${expectedTitle}" -- expected exactly 1`);
          continue;
        }
        const spec = matching[0]!;
        if (!spec.ok) {
          coverageProblems.push(`[${label}] spec for "${id}" did not pass`);
          continue;
        }
        const lines = pwSpecStdoutLines(spec);
        // [R3-F1] the marker's reported id (capture group 1) must equal the
        // id under test, not merely match the marker's regex SHAPE -- a
        // spec that emits a syntactically-valid marker for the WRONG id
        // (e.g. always the first action) previously still passed here,
        // since only the value (group 2) was ever inspected.
        let matchedMarker: RegExpExecArray | null = null;
        for (const l of lines) {
          const exec = markerRe.exec(l.trim());
          if (exec && exec[1] === id) {
            matchedMarker = exec;
            break;
          }
        }
        if (!matchedMarker) {
          coverageProblems.push(`[${label}] no marker REPORTING id "${id}" found in captured stdout (a marker present for a different id does not count)`);
          continue;
        }
        const observed = matchedMarker[2] ?? '';
        const expected = expectedByAction.get(id) ?? '__NONE__';
        if (observed !== expected) {
          coverageProblems.push(`[${label}] action "${id}": observed marker "${observed}" != independently-computed expected "${expected}"`);
        }
      }
    }
    checkOneConsumer(sidePanelTitle, sidePanelMarkerRe, 'side-panel');
    checkOneConsumer(nextStepTitle, nextStepMarkerRe, 'next-step');

    const expectedTitles = new Set<string>();
    for (const id of derivedActionIds) {
      expectedTitles.add(sidePanelTitle(id));
      expectedTitles.add(nextStepTitle(id));
    }
    const extraneous = run.specs.filter((s) => !expectedTitles.has(s.title));
    if (extraneous.length) coverageProblems.push(`extraneous spec(s) not matching either pinned per-action title format: ${extraneous.map((s) => s.title).join(' | ')}`);
    const expectedSpecCount = derivedActionIds.length * 2;
    if (run.specs.length !== expectedSpecCount) coverageProblems.push(`spec count ${run.specs.length} != expected ${expectedSpecCount} (2 x derived action count, one per consumer)`);

    const honestOk = run.status === 0 && run.specs.length > 0 && structuralProblems.length === 0 && coverageProblems.length === 0;

    // [R5-F2, reviewer ruling b] MUTATION PROBE. The round-4 reviewer ruled
    // the earlier "no probe here -- would require leasing/committing
    // legacy UI files" reasoning invalid: poisoning findDesignToolboxSkill
    // is ALREADY done elsewhere in this file (C10C-3/C10C-4), is ALREADY
    // in-lease (design-toolbox.ts), and requires touching no legacy
    // ChatComposer.tsx/DesignToolboxPanel code at all -- a behavioral bind
    // without the scope concern that held C10C-2 back before. Under poison
    // (always null), the REAL running web+daemon runtime
    // `@/playwright/suite`'s worker-scoped fixture boots FRESH per run (a
    // cold boot, not relying on dev-server hot-reload) imports the SAME
    // poisoned module, so a genuinely click-through-then-read test must
    // observe the marker "__NONE__" for EVERY action in BOTH consumers.
    // Only runs once the honest run above is already fully green. Failure
    // modes are kept attributable per action+consumer, and a
    // crashed/incomplete poisoned rerun (zero or wrong-count specs) is a
    // PROBE FAILURE, never silently accepted as evidence.
    const mutationProbeProblems: string[] = [];
    if (honestOk) {
      const designToolboxAbs = path.join(repoRoot, DESIGN_TOOLBOX_SRC_REL);
      const poisoned = withPoisonedFunctionBody(designToolboxAbs, 'findDesignToolboxSkill', '\n  return null;', () => runPlaywrightFile(E2E_UI_SPEC_PKG_REL, 'C10C-2-playwright-mutation-probe'));
      if (!poisoned.ok) {
        mutationProbeProblems.push(`mutation probe could not run: ${poisoned.error}`);
      } else {
        const poisonedRun = poisoned.result;
        if (poisonedRun.specs.length !== expectedSpecCount) {
          mutationProbeProblems.push(`PROBE FAILURE: poisoned rerun produced ${poisonedRun.specs.length} spec(s) (playwright exit=${poisonedRun.status}), expected ${expectedSpecCount} -- a crashed/incomplete/timed-out rerun is never accepted as evidence of a red assertion`);
        } else {
          function checkOneConsumerUnderPoison(titleFor: (id: string) => string, markerRe: RegExp, label: string): void {
            for (const id of derivedActionIds!) {
              const expectedTitle = titleFor(id);
              const spec = poisonedRun.specs.find((s) => s.title === expectedTitle);
              if (!spec) {
                mutationProbeProblems.push(`[${label}] mutation probe: PROBE FAILURE -- no spec titled exactly "${expectedTitle}" in the poisoned rerun`);
                continue;
              }
              const lines = pwSpecStdoutLines(spec);
              let matchedMarker: RegExpExecArray | null = null;
              for (const l of lines) {
                const exec = markerRe.exec(l.trim());
                if (exec && exec[1] === id) {
                  matchedMarker = exec;
                  break;
                }
              }
              if (!matchedMarker) {
                mutationProbeProblems.push(`[${label}] mutation probe: PROBE FAILURE -- no marker reporting id "${id}" in the poisoned rerun's captured stdout (absence is never accepted as evidence of a red assertion)`);
                continue;
              }
              const observedUnderPoison = matchedMarker[2] ?? '';
              if (observedUnderPoison !== '__NONE__') {
                mutationProbeProblems.push(`[${label}] mutation probe FAILED: action "${id}" still reported marker "${observedUnderPoison}" (expected "__NONE__") with findDesignToolboxSkill poisoned to always return null -- this consumer's marker is not genuinely bound to the resolver's real output`);
              }
            }
          }
          checkOneConsumerUnderPoison(sidePanelTitle, sidePanelMarkerRe, 'side-panel');
          checkOneConsumerUnderPoison(nextStepTitle, nextStepMarkerRe, 'next-step');
        }
      }
    }

    const allOk = honestOk && mutationProbeProblems.length === 0;
    record(
      'C10C-2',
      `pnpm --filter @open-design/e2e exec playwright test -c playwright.config.ts ${E2E_UI_SPEC_PKG_REL} --reporter=json (honest, then with findDesignToolboxSkill poisoned to always return null)`,
      "every C10C-1-derived action id has exactly one passing, exact-titled test in EACH of the two catalogue consumers (DesignToolboxPanel + NextStepActions), the featured/non-featured partition holds exactly AND is structurally proven against NextStepActions.tsx's own real source, each surface's test loop binds .click()/.textContent() calls to their own selector-chain with the marker traced to the SAME chat-composer-input-bound read (not two independent unbound facts), both consumers' reported runtime markers equal this verifier's own freshly-computed expected resolution, AND a mutation probe proves every marker in both consumers is genuinely, behaviorally bound to findDesignToolboxSkill's real output (poisoning it to always return null flips every marker to \"__NONE__\")",
      allOk,
      `derived action count: ${derivedActionIds.length} (expected spec count: ${expectedSpecCount})\nplaywright exit: ${run.status}\nspecs found: ${run.specs.length}\n${[...structuralProblems, ...coverageProblems].join('\n')}\nmutation probe: ${mutationProbeProblems.join('; ') || 'ok (every marker flipped to __NONE__ under poison)'}\n\n${run.raw}`,
    );
  });

  // -----------------------------------------------------------------------
  // C10C-3
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-3', async () => {
    const PHANTOM_LITERAL = 'w10c-red-spec-phantom-skill-id';

    // (a) Verifier's own direct runtime proof -- primary evidence.
    const oracle = await withIsolatedDaemon('c10c3', async (daemonUrl) => {
      // [R3-F5] single hardened fetch (redirect:'manual', origin-revalidated)
      // reused for both the liveness smoke-test and the actual resolution
      // inputs -- no separate raw `fetch(...)` call.
      const httpSkills = await fetchLiveSkillsOverHttp(daemonUrl);
      if (!httpSkills.ok) return { ok: false as const, detail: `HTTP probe failed: ${httpSkills.error}` };
      const toolboxMod = await loadDesignToolboxModule();
      if (!toolboxMod.ok) return { ok: false as const, detail: `could not load design-toolbox.ts: ${toolboxMod.error}` };
      const findDesignToolboxSkill = toolboxMod.mod.findDesignToolboxSkill;
      if (typeof findDesignToolboxSkill !== 'function') return { ok: false as const, detail: 'findDesignToolboxSkill is not callable at runtime' };
      const realActions = safeExtractRuntimeActions(toolboxMod.mod.DESIGN_TOOLBOX_ACTIONS);
      if (!realActions.ok || realActions.actions.length === 0) return { ok: false as const, detail: 'could not read a real action from DESIGN_TOOLBOX_ACTIONS' };
      const realAction = (toolboxMod.mod.DESIGN_TOOLBOX_ACTIONS as unknown[])[0];
      const positive = (findDesignToolboxSkill as (a: unknown, s: unknown[]) => unknown)(realAction, httpSkills.skills);
      const phantomAction = { id: 'w10c-oracle-phantom-action', preferredSkillIds: [PHANTOM_LITERAL], categoryHints: [], searchTerms: ['w10c-red-spec-unmatchable-search-term'] };
      const negative = (findDesignToolboxSkill as (a: unknown, s: unknown[]) => unknown)(phantomAction, httpSkills.skills);
      const positiveOk = positive !== null && positive !== undefined;
      const negativeOk = negative === null || negative === undefined;
      return {
        ok: positiveOk && negativeOk,
        detail: `positive control resolved=${positiveOk} (value=${JSON.stringify(positive)}); phantom resolved-to-null=${negativeOk} (value=${JSON.stringify(negative)})`,
      };
    });

    const oracleOk = oracle.boot.ok && oracle.result?.ok === true && oracle.teardownOk; // [R3-F5] a teardown failure fails the criterion
    const oracleEvidence = oracle.boot.ok
      ? `daemon url: ${oracle.boot.daemonUrl}\n${oracle.result?.detail ?? 'no result'}\nteardown: ok=${oracle.teardownOk} ${oracle.teardownDetail}`
      : `boot failed: ${oracle.boot.detail}\n${oracle.boot.rawEvidence.slice(0, 4000)}\nteardown: ok=${oracle.teardownOk} ${oracle.teardownDetail}`;

    // (b) Required, structurally-bound delegated artifact.
    const specAbs = path.join(repoRoot, E2E_PHANTOM_SPEC_REL);
    if (!fs.existsSync(specAbs)) {
      record('C10C-3', '', "verifier's own runtime proof (a) AND a required, structurally-bound delegated artifact (b)", false, oracleEvidence, { detail: `oracle ok=${oracleOk}; ${E2E_PHANTOM_SPEC_REL} does not exist` });
      return;
    }
    const source = fs.readFileSync(specAbs, 'utf8');
    const sf = parseTs(specAbs, source);
    const banned = containsBannedTestMarker(sf);
    // [R3-F2/F3] real AST call-expression checks, not raw regex/text scans.
    const hasSmokeSuiteCall = countCallsToExactIdentifier(sf, 'createSmokeSuite') >= 1;
    const hasToolsDevChain = hasChainedMethodCall(sf, ['with', 'toolsDev']);
    const hasDynImport = hasDynamicImportReferencingFile(sf, 'design-toolbox');
    const literals = collectAllStringLiteralValues(sf);
    const hasPhantomLiteral = literals.has(PHANTOM_LITERAL);
    const structuralProblems: string[] = [];
    if (banned.length) structuralProblems.push(`banned skip/only/fixme/todo markers: ${banned.join(', ')}`);
    if (!hasSmokeSuiteCall) structuralProblems.push('no real createSmokeSuite(...) CallExpression found (AST-bound)');
    if (!hasToolsDevChain) structuralProblems.push('no real .with.toolsDev(...) chained CallExpression found (AST-bound)');
    if (!hasDynImport) structuralProblems.push('no dynamic import() call referencing "design-toolbox" found');
    if (!hasPhantomLiteral) structuralProblems.push(`the pinned literal "${PHANTOM_LITERAL}" was not found as a genuine string-literal AST node (a comment does not count)`);

    const run = runVitestFile('@open-design/e2e', E2E_PHANTOM_SPEC_PKG_REL, 'C10C-3-vitest'); // [R1-F1]
    const allTests = run.data ? run.data.testResults.flatMap((t) => t.assertionResults) : [];
    const positiveTitle = 'positive control: a real action resolves via findDesignToolboxSkill';
    const negativeTitle = 'phantom red spec: an unresolvable action returns null via findDesignToolboxSkill';
    const positivePassed = allTests.some((t) => t.fullName.endsWith(positiveTitle) && t.status === 'passed');
    const negativePassed = allTests.some((t) => t.fullName.endsWith(negativeTitle) && t.status === 'passed');
    const runProblems: string[] = [];
    if (!positivePassed) runProblems.push(`no passing test titled exactly "${positiveTitle}"`);
    if (!negativePassed) runProblems.push(`no passing test titled exactly "${negativeTitle}"`);
    if ((run.data?.numFailedTests ?? 1) !== 0) runProblems.push(`${run.data?.numFailedTests ?? 'unknown'} failed test(s) in the suite`);

    // [R4-F2, hardened R5] MUTATION PROBE, replacing the identifier-count
    // binding checks that failed three review rounds running. Only runs
    // once the honest run already reports the relevant control passing (no
    // point poisoning a suite that is not even green). Uses
    // withPoisonedFunctionBody (declaration-scoped AST anchoring, signal-safe
    // restore, byte-identical verification -- [R5-F9]) and
    // requireAttributableFailure (assertion-identity: a crashed/empty poison
    // run is a PROBE FAILURE, never accepted as "flipped red" -- [R5-F1/F9]).
    // TWO independent probes, closing round-4 finding 10 ("C10C-3 poisons
    // only the positive path"): forward-poison (always null) must flip the
    // POSITIVE control red; reverse-poison (always a truthy dummy) must flip
    // the NEGATIVE control red. A decoy bound to only one direction is now
    // caught by the other.
    const mutationProbeProblems: string[] = [];
    const designToolboxAbs = path.join(repoRoot, DESIGN_TOOLBOX_SRC_REL);
    if (positivePassed) {
      const poisoned = withPoisonedFunctionBody(designToolboxAbs, 'findDesignToolboxSkill', '\n  return null;', () =>
        runVitestFile('@open-design/e2e', E2E_PHANTOM_SPEC_PKG_REL, 'C10C-3-vitest-mutation-probe-forward'),
      );
      if (!poisoned.ok) {
        mutationProbeProblems.push(`forward mutation probe (always-null) could not run: ${poisoned.error}`);
      } else {
        const attributable = requireAttributableFailure(poisoned.result, positiveTitle);
        if (!attributable.ok) mutationProbeProblems.push(`forward mutation probe (always-null): ${attributable.detail}`);
      }
    }
    if (negativePassed) {
      const poisoned = withPoisonedFunctionBody(
        designToolboxAbs,
        'findDesignToolboxSkill',
        '\n  return { id: "zz9f3a2c1e", name: "zz9f3a2c1e" } as unknown as SkillSummary;',
        () => runVitestFile('@open-design/e2e', E2E_PHANTOM_SPEC_PKG_REL, 'C10C-3-vitest-mutation-probe-reverse'),
      );
      if (!poisoned.ok) {
        mutationProbeProblems.push(`reverse mutation probe (always-truthy) could not run: ${poisoned.error}`);
      } else {
        const attributable = requireAttributableFailure(poisoned.result, negativeTitle);
        if (!attributable.ok) mutationProbeProblems.push(`reverse mutation probe (always-truthy): ${attributable.detail}`);
      }
    }

    const delegatedOk = run.status === 0 && structuralProblems.length === 0 && runProblems.length === 0 && mutationProbeProblems.length === 0;
    const allOk = oracleOk && delegatedOk;
    record(
      'C10C-3',
      `verifier-internal daemon boot + direct call to findDesignToolboxSkill; pnpm --filter @open-design/e2e exec vitest run ${E2E_PHANTOM_SPEC_PKG_REL} --reporter=json (three times: honest, then findDesignToolboxSkill poisoned always-null, then poisoned always-truthy)`,
      "the verifier's own oracle proves the phantom-ID/positive-control behavior at runtime AND its isolated daemon's teardown is independently confirmed (never trusted from a single exit report), AND the required delegated artifact exists and passes with the pinned paired titles honestly, AND two independent mutation probes prove BOTH the positive-control AND the negative-control assertions are genuinely, attributably bound to the real production findDesignToolboxSkill",
      allOk,
      `oracle ok=${oracleOk}\n${oracleEvidence}\n\ndelegated file structural: ${structuralProblems.join('; ') || 'none'}\ndelegated file run: ${runProblems.join('; ') || 'none'}\nmutation probes: ${mutationProbeProblems.join('; ') || 'ok (both directions produced attributable failures under poison)'}\nvitest exit=${run.status}\n\n${run.raw}`,
    );
  });

  // -----------------------------------------------------------------------
  // C10C-4
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-4', async () => {
    const PHANTOM_LITERAL = 'w10c-daemon-suite-phantom-skill-id';

    // (a) Verifier's own direct runtime proof. [R5-F10] extended with a
    // phantom-id negative check -- round-4 finding 10's second half:
    // "C10C-4's own oracle never exercises its phantom ID." Mirrors
    // C10C-3(a)'s paired positive+negative shape exactly.
    let oracleOk = false;
    let oracleEvidence = '';
    let liveSkillsForProbes: { id: string }[] | null = null;
    if (!derivedActionIds || derivedActionIds.length === 0) {
      oracleEvidence = 'C10C-1 did not produce a derived action-id set; oracle cannot run';
    } else {
      const skillsMod = await loadDaemonSkillsModule();
      const toolboxMod = await loadDesignToolboxModule();
      if (!skillsMod.ok || !toolboxMod.ok) {
        oracleEvidence = `module load failed: ${!skillsMod.ok ? skillsMod.error : ''} ${!toolboxMod.ok ? toolboxMod.error : ''}`.trim();
      } else {
        const listSkills = skillsMod.mod.listSkills;
        const findSkillById = skillsMod.mod.findSkillById;
        if (typeof listSkills !== 'function' || typeof findSkillById !== 'function') {
          oracleEvidence = 'listSkills/findSkillById are not callable at runtime';
        } else {
          const liveSkills = (await (listSkills as (roots: string[]) => Promise<unknown[]>)([path.join(repoRoot, SKILLS_ROOT_REL)])) as { id: string }[];
          liveSkillsForProbes = liveSkills;
          const actionsRuntime = safeExtractRuntimeActions(toolboxMod.mod.DESIGN_TOOLBOX_ACTIONS);
          if (!actionsRuntime.ok) {
            oracleEvidence = 'could not read runtime DESIGN_TOOLBOX_ACTIONS for the mapping check';
          } else {
            const unresolved: string[] = [];
            for (const action of actionsRuntime.actions) {
              for (const skillId of action.preferredSkillIds) {
                const resolved = (findSkillById as (skills: unknown[], id: string) => unknown)(liveSkills, skillId);
                if (resolved === undefined) unresolved.push(`${action.id} -> "${skillId}"`);
              }
            }
            const phantomResolved = (findSkillById as (skills: unknown[], id: string) => unknown)(liveSkills, PHANTOM_LITERAL);
            const phantomOk = phantomResolved === undefined;
            oracleOk = unresolved.length === 0 && phantomOk;
            oracleEvidence = `positive: ${unresolved.length === 0 ? 'all preferredSkillIds entries resolved' : `unresolved entries: ${unresolved.join(', ')}`} against ${liveSkills.length} live skills; negative: phantom "${PHANTOM_LITERAL}" resolved-to-undefined=${phantomOk} (value=${JSON.stringify(phantomResolved)})`;
          }
        }
      }
    }

    // (b) Required, structurally-bound delegated artifact.
    const specAbs = path.join(repoRoot, DAEMON_SUITE_SPEC_REL);
    if (!fs.existsSync(specAbs)) {
      record('C10C-4', '', "verifier's own runtime proof (a) AND a required, structurally-bound delegated artifact in the daemon suite (b)", false, oracleEvidence, { detail: `oracle ok=${oracleOk}; ${DAEMON_SUITE_SPEC_REL} does not exist` });
      return;
    }
    const source = fs.readFileSync(specAbs, 'utf8');
    const sf = parseTs(specAbs, source);
    const banned = containsBannedTestMarker(sf);
    // [R4-F3] "does the file import this exact export name" stays a
    // structural check (a fact about an import specifier, not a claim about
    // what code executes) -- what round 3 lost on was the CALL-COUNT checks
    // (findSkillByIdCalls/listSkillsCalls) and the SKILL_ID_ALIASES
    // reference-count count, both removed below in favor of mutation
    // probes.
    const listSkillsBinding = findNamedImportBinding(sf, 'listSkills', '/skills');
    const findSkillByIdBinding = findNamedImportBinding(sf, 'findSkillById', '/skills');
    const literals = collectAllStringLiteralValues(sf);
    const hasPhantomLiteral = literals.has(PHANTOM_LITERAL);
    const noWebImport = !/from\s+['"][^'"]*apps\/web\//.test(source);

    const structuralProblems: string[] = [];
    if (banned.length) structuralProblems.push(`banned skip/only/fixme/todo markers: ${banned.join(', ')}`);
    if (!findSkillByIdBinding.found) structuralProblems.push('no import of the exact export name "findSkillById" from a "/skills" module found');
    if (!listSkillsBinding.found) structuralProblems.push('no import of the exact export name "listSkills" from a "/skills" module found');
    if (!hasPhantomLiteral) structuralProblems.push(`the pinned literal "${PHANTOM_LITERAL}" was not found as a genuine string-literal AST node`);
    if (!noWebImport) structuralProblems.push('file appears to import apps/web/** directly -- the cross-app boundary requires reading design-toolbox.ts as text, not importing it');

    const run = runVitestFile('@open-design/daemon', DAEMON_SUITE_SPEC_PKG_REL, 'C10C-4-vitest'); // [R1-F1]
    const allTests = run.data ? run.data.testResults.flatMap((t) => t.assertionResults) : [];
    const positiveTitle = 'positive control: a real skill id resolves via findSkillById';
    const negativeTitle = 'phantom red specs: an unresolvable skill id returns undefined via findSkillById';
    const positivePassed = allTests.some((t) => t.fullName.endsWith(positiveTitle) && t.status === 'passed');
    const negativePassed = allTests.some((t) => t.fullName.endsWith(negativeTitle) && t.status === 'passed');
    const coverageProblems: string[] = [];
    if (!positivePassed) coverageProblems.push(`no passing test titled exactly "${positiveTitle}"`);
    if (!negativePassed) coverageProblems.push(`no passing test titled exactly "${negativeTitle}"`);
    if (derivedActionIds) {
      for (const id of derivedActionIds) {
        const expectedTitle = `preferredSkillIds for action "${id}" resolve via findSkillById`;
        if (!allTests.some((t) => t.fullName.endsWith(expectedTitle) && t.status === 'passed')) {
          coverageProblems.push(`no passing test titled exactly "${expectedTitle}"`);
        }
      }
    }
    if ((run.data?.numFailedTests ?? 1) !== 0) coverageProblems.push(`${run.data?.numFailedTests ?? 'unknown'} failed test(s) in the suite`);

    // [R4-F3, hardened R5] MUTATION PROBES, replacing the identifier-count
    // binding checks that failed three review rounds running. Uses
    // requireAttributableFailure -- assertion-identity, fail-closed on any
    // crash/empty-report [R5-F1]. THREE independent probes:
    //   (1) forward-poison findSkillById -> undefined: positive control AND
    //       EVERY per-action coverage test must each show an attributable
    //       failure.
    //   (2) reverse-poison findSkillById -> always a truthy dummy: the
    //       NEGATIVE control must show an attributable failure -- closes
    //       round-4 finding 10 ("its negative delegated test likewise is
    //       not mutation-bound").
    //   (3) REGISTRY-CONTENT probe [R5-F6]: append one synthetic,
    //       real-resolving action to DESIGN_TOOLBOX_ACTIONS in a transient
    //       copy and require a NEW passing coverage title for it to appear
    //       -- closes finding 6 ("a suite can hardcode today's IDs while
    //       calling findSkillById and pass everything... coverage must be
    //       sensitive to the REGISTRY CONTENT, not just the resolver call").
    // Each only runs once its own honest baseline is already green, to
    // avoid probing a suite that is not even wired up yet.
    const mutationProbeProblems: string[] = [];
    const skillsAbs = path.join(repoRoot, DAEMON_SKILLS_SRC_REL);
    if (positivePassed) {
      const poisoned = withPoisonedFunctionBody(skillsAbs, 'findSkillById', '\n  return undefined;', () =>
        runVitestFile('@open-design/daemon', DAEMON_SUITE_SPEC_PKG_REL, 'C10C-4-vitest-mutation-probe-forward'),
      );
      if (!poisoned.ok) {
        mutationProbeProblems.push(`forward mutation probe (always-undefined) could not run: ${poisoned.error}`);
      } else {
        const posAttr = requireAttributableFailure(poisoned.result, positiveTitle);
        if (!posAttr.ok) mutationProbeProblems.push(`forward mutation probe, positive control: ${posAttr.detail}`);
        if (derivedActionIds) {
          for (const id of derivedActionIds) {
            const attr = requireAttributableFailure(poisoned.result, `preferredSkillIds for action "${id}" resolve via findSkillById`);
            if (!attr.ok) mutationProbeProblems.push(`forward mutation probe, action "${id}": ${attr.detail}`);
          }
        }
      }
    }
    if (negativePassed) {
      const poisoned = withPoisonedFunctionBody(
        skillsAbs,
        'findSkillById',
        '\n  return { id: "zz9f3a2c1e" } as unknown as SkillInfo;',
        () => runVitestFile('@open-design/daemon', DAEMON_SUITE_SPEC_PKG_REL, 'C10C-4-vitest-mutation-probe-reverse'),
      );
      if (!poisoned.ok) {
        mutationProbeProblems.push(`reverse mutation probe (always-truthy) could not run: ${poisoned.error}`);
      } else {
        const negAttr = requireAttributableFailure(poisoned.result, negativeTitle);
        if (!negAttr.ok) mutationProbeProblems.push(`reverse mutation probe, negative control: ${negAttr.detail}`);
      }
    }
    if (positivePassed && liveSkillsForProbes && liveSkillsForProbes.length > 0) {
      const REGISTRY_PROBE_ACTION_ID = 'w10c-registry-content-probe-action';
      const resolvableSkillId = liveSkillsForProbes[0]!.id;
      const designToolboxAbs = path.join(repoRoot, DESIGN_TOOLBOX_SRC_REL);
      const mutated = withRegistryContentMutationProbe(designToolboxAbs, REGISTRY_PROBE_ACTION_ID, resolvableSkillId, () =>
        runVitestFile('@open-design/daemon', DAEMON_SUITE_SPEC_PKG_REL, 'C10C-4-vitest-registry-content-probe'),
      );
      if (!mutated.ok) {
        mutationProbeProblems.push(`registry-content mutation probe could not run: ${mutated.error}`);
      } else {
        const expectedTitle = `preferredSkillIds for action "${REGISTRY_PROBE_ACTION_ID}" resolve via findSkillById`;
        const mutatedTests = mutated.result.data ? mutated.result.data.testResults.flatMap((t) => t.assertionResults) : [];
        const newTestPassed = mutatedTests.some((t) => t.fullName.endsWith(expectedTitle) && t.status === 'passed');
        if (!mutated.result.data || mutated.result.data.numTotalTests === 0) {
          mutationProbeProblems.push('registry-content mutation probe: PROBE FAILURE -- rerun produced no parseable/non-empty reporter output');
        } else if (!newTestPassed) {
          mutationProbeProblems.push(`registry-content mutation probe FAILED: no passing test titled exactly "${expectedTitle}" appeared after appending a real, resolvable synthetic action to DESIGN_TOOLBOX_ACTIONS -- the delegated file's coverage set does not track the live file's content (may be hardcoding today's ids)`);
        }
      }
    }

    const delegatedOk = run.status === 0 && structuralProblems.length === 0 && coverageProblems.length === 0 && mutationProbeProblems.length === 0;
    const allOk = oracleOk && delegatedOk;
    record(
      'C10C-4',
      `verifier-internal direct call to findSkillById(listSkills(...)) incl. phantom negative; pnpm --filter @open-design/daemon exec vitest run ${DAEMON_SUITE_SPEC_PKG_REL} --reporter=json (honest, then three independent mutation probes: findSkillById poisoned always-undefined, findSkillById poisoned always-truthy, DESIGN_TOOLBOX_ACTIONS content-mutated with a new resolvable action)`,
      "the verifier's own oracle proves every preferredSkillIds entry resolves via the real registry AND that its own phantom id resolves to undefined, AND the required delegated daemon-suite artifact imports listSkills/findSkillById by exact export name and passes with per-action + paired coverage honestly, AND three independent mutation probes prove the positive control, every per-action coverage assertion, the negative control, AND the coverage SET's live dependence on the real DESIGN_TOOLBOX_ACTIONS content are all genuinely, attributably bound to production",
      allOk,
      `oracle ok=${oracleOk}\n${oracleEvidence}\n\ndelegated file structural: ${structuralProblems.join('; ') || 'none'}\ndelegated file coverage: ${coverageProblems.join('; ') || 'none'}\nmutation probes: ${mutationProbeProblems.join('; ') || 'ok (all three probes produced attributable/expected results)'}\nvitest exit=${run.status}\n\n${run.raw}`,
    );
  });

  // -----------------------------------------------------------------------
  // C10C-5 -- UI/CLI parity, via the shared isolated-daemon helper.
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-5', async () => {
    const outcome = await withIsolatedDaemon('c10c5', async (daemonUrl) => {
      const httpSkills = await fetchLiveSkillsOverHttp(daemonUrl);
      const cliResult = sh(process.execPath, ['--import', 'tsx', path.join(repoRoot, 'apps/daemon/src/cli.ts'), 'skills', 'list', '--json', '--daemon-url', daemonUrl], {
        cwd: path.join(repoRoot, 'apps/daemon'),
        timeoutMs: 60_000,
      });
      let cliIds: string[] = [];
      let cliProblem: string | null = null;
      if (cliResult.status !== 0) {
        cliProblem = `od skills list --json exited ${cliResult.status}: ${cliResult.stderr.slice(0, 2000)}`;
      } else {
        try {
          const parsed = JSON.parse(cliResult.stdout) as { skills?: { id?: string }[] };
          cliIds = (parsed.skills ?? []).map((s) => String(s.id ?? ''));
        } catch (err) {
          cliProblem = `could not parse CLI JSON output: ${String(err)}`;
        }
      }
      const problems: string[] = [];
      if (!httpSkills.ok) problems.push(`HTTP probe failed: ${httpSkills.error}`);
      if (cliProblem) problems.push(`CLI probe failed: ${cliProblem}`);
      let httpCount = 0;
      const cliCount = cliIds.length;
      if (httpSkills.ok && !cliProblem) {
        httpCount = httpSkills.ids.length;
        if (httpSkills.ids.length === 0) problems.push('HTTP /api/skills returned zero skills -- cannot prove parity against an empty set');
        const diff = multisetDiff(httpSkills.ids, cliIds);
        if (diff.onlyInA.length) problems.push(`ids present via HTTP but not CLI: ${diff.onlyInA.join(', ')}`);
        if (diff.onlyInB.length) problems.push(`ids present via CLI but not HTTP: ${diff.onlyInB.join(', ')}`);
        if (diff.countMismatch.length) problems.push(`id occurrence-count mismatches: ${diff.countMismatch.join(', ')}`);
      }
      return { ok: problems.length === 0, evidence: `http id count: ${httpCount}\ncli id count: ${cliCount}\n${problems.join('\n')}` };
    });
    if (!outcome.boot.ok) {
      record('C10C-5', 'pnpm tools-dev start daemon --namespace <fresh>', 'the HTTP and CLI skill-id multisets are exactly identical for the same isolated daemon, and its teardown is independently confirmed', false, `${outcome.boot.rawEvidence}\nteardown: ok=${outcome.teardownOk} ${outcome.teardownDetail}`, {
        detail: outcome.boot.detail,
      });
      return;
    }
    record(
      'C10C-5',
      `GET ${outcome.boot.daemonUrl}/api/skills  vs  od skills list --json --daemon-url ${outcome.boot.daemonUrl}`,
      'the HTTP and CLI skill-id multisets are exactly identical for the same isolated daemon, and its teardown is independently confirmed (never trusted from a single exit report -- [R3-F5])',
      (outcome.result?.ok ?? false) && outcome.teardownOk,
      `daemon url: ${outcome.boot.daemonUrl}\n${outcome.result?.evidence ?? 'no result'}\nteardown: ok=${outcome.teardownOk} ${outcome.teardownDetail}`,
    );
  });

  // -----------------------------------------------------------------------
  // C10C-6
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-6', async () => {
    // [R5-F8] `pnpm typecheck` is a second, independent evidence path that
    // can consume packages/*'s gitignored .d.ts output (type declarations
    // downstream packages resolve via their own package.json "types"
    // field) -- rebuilt from head first, same memoized call the isolated
    // daemon boot path uses, so this criterion's own evidence cannot be
    // produced against stale/mutated dist either.
    let rebuildError: string | null = null;
    try {
      await ensureFirstPartyPackagesRebuiltFromHead();
    } catch (err) {
      rebuildError = String((err as Error)?.message ?? err);
    }
    const guard = rebuildError ? { status: 1, stdout: '' } : sh('pnpm', ['guard'], { timeoutMs: 5 * 60_000 });
    const typecheck = rebuildError ? { status: 1, stdout: '', stderr: '' } : sh('pnpm', ['typecheck'], { timeoutMs: 10 * 60_000 });
    record(
      'C10C-6',
      "pnpm --filter './packages/*' run build (first-party workspace rebuild) && pnpm guard && pnpm typecheck",
      'the first-party packages/* workspace rebuild succeeds, and both guard and typecheck exit 0 on the current (freshly rebuilt) tree',
      !rebuildError && guard.status === 0 && typecheck.status === 0,
      `rebuild error: ${rebuildError ?? 'none'}\nguard exit=${guard.status}\ntypecheck exit=${typecheck.status}\n\n${guard.stdout.slice(-4000)}\n\n${typecheck.stdout.slice(-4000)}\n${typecheck.stderr.slice(-4000)}`,
    );
  });

  // -----------------------------------------------------------------------
  // C10C-7
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-7', () => {
    let raw: string;
    try {
      raw = readFileAtCommit(headSha, REVIEW_RECORD_REL);
    } catch (err) {
      record('C10C-7', `git show ${headSha}:${REVIEW_RECORD_REL}`, 'implementation review record exists, committed, non-spoofable', false, '', { detail: `could not read ${REVIEW_RECORD_REL} at HEAD: ${String(err)}` });
      return;
    }
    let review: { reviewer?: unknown; model?: unknown; reviewedCommit?: unknown; verdict?: unknown };
    try {
      review = JSON.parse(raw) as typeof review;
    } catch (err) {
      record('C10C-7', '', 'review record parses as JSON', false, raw.slice(0, 2000), { detail: `JSON parse failed: ${String(err)}` });
      return;
    }
    // [R3-F6] a whitespace-only string is truthy (non-empty .length), so
    // `if (!reviewer)` alone let it through -- it then matched no author in
    // identityMatchesAnyAuthor and silently passed. Reject anything that
    // normalizes to nothing after trim, not just falsy/missing.
    const reviewerRaw = typeof review.reviewer === 'string' ? review.reviewer : null;
    const reviewer = reviewerRaw !== null && reviewerRaw.trim().length > 0 ? reviewerRaw : null;
    const model = typeof review.model === 'string' ? review.model.trim() : null;
    const reviewedCommit = typeof review.reviewedCommit === 'string' ? review.reviewedCommit : null;
    const verdict = typeof review.verdict === 'string' ? review.verdict : null;
    const problems: string[] = [];
    if (!reviewer) problems.push('"reviewer" is missing, not a string, or empty/whitespace-only after trim');
    if (!model) problems.push('"model" is missing, not a string, or empty after trim'); // [R1-F7]
    if (!reviewedCommit) problems.push('"reviewedCommit" is missing or not a string');
    if (verdict !== 'APPROVE') problems.push(`"verdict" is "${String(verdict)}", expected "APPROVE"`);
    if (reviewedCommit) {
      if (!resolveCommit(reviewedCommit)) {
        problems.push(`"reviewedCommit" (${reviewedCommit}) does not resolve to a real commit`);
      } else if (reviewedCommit === headSha) {
        problems.push('"reviewedCommit" equals HEAD -- must be a strict ancestor (a commit cannot review itself)');
      } else if (!isAncestor(reviewedCommit, headSha)) {
        problems.push(`"reviewedCommit" (${reviewedCommit}) is not an ancestor of HEAD (${headSha})`);
      } else {
        const diffResult = sh('git', ['diff', '--name-only', reviewedCommit, headSha, '--', ...OWNED_IMPLEMENTATION_PATHS]); // [R1-F7] complete list
        const changedSinceReview = diffResult.stdout.trim().split('\n').filter(Boolean);
        if (changedSinceReview.length > 0) problems.push(`implementation/evidence changed AFTER reviewedCommit -- review is stale for: ${changedSinceReview.join(', ')}`);
      }
      if (reviewer) {
        const authorsInRange = commitAuthorsBetween(baseCommit, reviewedCommit);
        if (identityMatchesAnyAuthor(reviewer, authorsInRange)) problems.push(`"reviewer" ("${reviewer}") matches a commit author in baseCommit..reviewedCommit (checked as name, email, and combined "Name <email>" form) -- not distinguishable from the implementation`); // [R1-F7]
      }
    }
    record(
      'C10C-7',
      `read ${REVIEW_RECORD_REL}@HEAD; model presence + reviewedCommit ancestry + owned-path (8 files) empty-diff + author-distinctness checks`,
      'model non-empty; reviewedCommit is a real, strict ancestor of HEAD whose complete owned-path diff to HEAD is empty; reviewer distinct from every baseCommit..reviewedCommit author (name/email/combined form); verdict is APPROVE',
      problems.length === 0,
      problems.join('\n') || `reviewer=${reviewer} model=${model} reviewedCommit=${reviewedCommit} verdict=${verdict}`,
    );
  });

  // -----------------------------------------------------------------------
  // C10C-8 -- [R3-F7] REINSTATED. Removing this in round 2 was wrong (the
  // orchestrator's own correction): the `### W10C-CAPABILITY-DECISION` block
  // that landed on main via docs/plans/waves/DECISIONS.md is a real,
  // fail-able invariant if deleted, malformed, or not actually present at a
  // point this wave's own commits cannot influence. human:-marked per
  // VERIFICATION-CONTRACT.md §3 R7: a record that has not yet landed
  // legitimately resolves "blocked-on-founder" (the founder/orchestrator
  // has not yet ruled), never "pass"; a record that HAS landed but is
  // malformed resolves "fail" (a defect in a landed artifact, not an
  // unanswered question). Modeled on the W9-agent-spawn "C9S-8" mechanism
  // DECISIONS.md's W9AS-PARK record describes -- the one part of that
  // package the reviewer found sound.
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-8', () => {
    const DECISIONS_REL = 'docs/plans/waves/DECISIONS.md';
    let raw: string;
    try {
      // [R3-F7] read at baseCommit, NEVER HEAD: leases.json denies
      // DECISIONS.md to W10c and a wave branch cannot reach the docs lane
      // at all, so baseCommit is a fixed point this wave's own commits
      // structurally cannot have influenced.
      raw = readFileAtCommit(baseCommit, DECISIONS_REL);
    } catch (err) {
      record(
        'C10C-8',
        `git show ${baseCommit}:${DECISIONS_REL}`,
        'human: a well-formed W10C-CAPABILITY-DECISION record exists at baseCommit, proving the capability question landed through the review lane that produced baseCommit -- this does NOT and cannot cryptographically verify anyone\'s authority, only that the record\'s presence and shape are real at a point this wave cannot influence',
        'blocked-on-founder',
        '',
        { detail: `could not read ${DECISIONS_REL} at baseCommit (${baseCommit}): ${String(err)}` },
      );
      return;
    }
    const headingToken = '### W10C-CAPABILITY-DECISION';
    const startIdx = raw.indexOf(headingToken);
    if (startIdx === -1) {
      record(
        'C10C-8',
        `git show ${baseCommit}:${DECISIONS_REL}`,
        'human: a well-formed W10C-CAPABILITY-DECISION record exists at baseCommit, proving the capability question landed through the review lane (not that anyone\'s authority was cryptographically verified)',
        'blocked-on-founder',
        raw.slice(0, 1000),
        { detail: `no "${headingToken}" heading found at baseCommit -- the capability question has not yet landed through the review lane` },
      );
      return;
    }
    const afterHeading = raw.slice(startIdx + headingToken.length);
    const nextHeadingRel = afterHeading.search(/^###\s/m);
    const block = nextHeadingRel === -1 ? afterHeading : afterHeading.slice(0, nextHeadingRel);
    const blockLines = block.split('\n').map((l) => l.trim());
    function extractField(fieldName: string): string | null {
      const re = new RegExp(`^-\\s*${fieldName}:\\s*(.*)$`, 'i');
      for (const line of blockLines) {
        const m = re.exec(line);
        if (m) return (m[1] ?? '').trim();
      }
      return null;
    }
    const decisionRaw = extractField('Decision');
    const deciderRaw = extractField('Decider');
    const dateRaw = extractField('Date');
    const rationaleRaw = extractField('Rationale');

    const problems: string[] = [];
    const decision = decisionRaw ? decisionRaw.toLowerCase() : null;
    if (decision !== 'exempt' && decision !== 'build-now') {
      problems.push(`"Decision" is "${decisionRaw ?? '<missing>'}", expected exactly "exempt" or "build-now"`);
    }
    // [R3-F6] same whitespace-only-identity bug class as C10C-7's reviewer
    // check: reject a Decider that normalizes to nothing after trim.
    const decider = deciderRaw && deciderRaw.trim().length > 0 ? deciderRaw : null;
    if (!decider) problems.push('"Decider" is missing or empty/whitespace-only after trim');
    if (!dateRaw || dateRaw.trim().length === 0) problems.push('"Date" is missing or empty');
    if (!rationaleRaw || rationaleRaw.trim().length === 0) problems.push('"Rationale" is missing or empty');

    if (decider) {
      // [R3-F7] "decider checked against commit authors": mirrors C10C-7's
      // reviewer-distinctness pattern -- the decider identity must not
      // match any author of THIS WAVE's own commits (baseCommit..HEAD), so
      // an implementer cannot self-attribute founder/orchestrator decision
      // authority under their own commit identity.
      const waveAuthors = commitAuthorsBetween(baseCommit, headSha);
      if (identityMatchesAnyAuthor(decider, waveAuthors)) {
        problems.push(`"Decider" ("${decider}") matches an author of this wave's own commits (baseCommit..HEAD) -- not distinguishable from the implementation`);
      }
    }

    record(
      'C10C-8',
      `git show ${baseCommit}:${DECISIONS_REL}; parse "${headingToken}" block; decider vs. baseCommit..HEAD commit-author distinctness`,
      'human: Decision/Decider/Date/Rationale are all present and non-empty (Decider non-whitespace-after-trim), Decision is exactly "exempt" or "build-now", and Decider is distinguishable from every baseCommit..HEAD commit author. This proves the capability-decision record landed through the review lane that produced baseCommit -- it does NOT and cannot cryptographically verify anyone\'s authority.',
      problems.length === 0,
      problems.join('\n') || `decision=${decisionRaw} decider=${decider} date=${dateRaw} rationale=${(rationaleRaw ?? '').slice(0, 200)}`,
    );
  });

  // =======================================================================
  // GATE-INTEGRITY / LEASE / HEAD-DRIFT
  // =======================================================================
  await checkCriterion('GATE-INTEGRITY', () => {
    const selfPath = process.argv[1] ? path.resolve(process.argv[1]) : path.join(repoRoot, 'scripts/waves/verify-w10c.ts');
    let selfSha256: string;
    try {
      selfSha256 = sha256File(selfPath);
    } catch (err) {
      record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check; the PRIMARY control is the LEASE deny-list on this file plus the PRD, not this pin', false, '', { detail: `could not hash self at ${selfPath}: ${String(err)}` });
      return;
    }
    const approvedHashPath = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'approved-gate.sha256');
    if (!gateIntegrityPinned) {
      record(
        'GATE-INTEGRITY',
        '',
        'defense-in-depth self-hash check',
        true,
        `sha256: ${selfSha256}\nUNPINNED -- no approved-gate.sha256 present. This is advisory; the primary control is the LEASE check's deny-list on this file and the PRD (docs/plans/waves/W10c-toolbox.md), which a diff-based check enforces regardless of pin timing. See manifest.gateIntegrityPinned=false.`,
      );
      return;
    }
    const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
    const gateOk = approved === selfSha256;
    record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check', gateOk, `sha256: ${selfSha256}\napproved: ${approved}\nPINNED`, { detail: gateOk ? undefined : 'verify-w10c.ts modified since orchestrator approval' });
  });

  function globToRegExp(glob: string): RegExp {
    let re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    re = re.replace(/\*\*/g, ' GLOBSTAR ');
    re = re.replace(/\*/g, '[^/]*');
    re = re.replace(/ GLOBSTAR /g, '.*');
    return new RegExp(`^${re}$`);
  }
  await checkCriterion('LEASE', () => {
    let leasesRaw: { waves: Record<string, { allow: string[]; deny?: string[] }> };
    try {
      const leasesText = readFileAtCommit(baseCommit, 'docs/plans/waves/leases.json');
      leasesRaw = JSON.parse(leasesText) as typeof leasesRaw;
    } catch (err) {
      record('LEASE', `git show ${baseCommit}:docs/plans/waves/leases.json`, 'no writes outside the W10c lease, read from baseCommit', false, '', { detail: `could not read/parse leases.json at baseCommit: ${String(err)}` });
      return;
    }
    const lease = leasesRaw.waves['W10c'];
    if (!lease) {
      record('LEASE', '', 'no writes outside the W10c lease, read from baseCommit', false, '', { detail: 'no "W10c" entry in leases.json@baseCommit -- expected pre-orchestrator-transcription; see W10c-toolbox.md §6 "Proposed lease"' });
      return;
    }
    const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
    const diffNames = diffResult.stdout.trim().split('\n').filter(Boolean);
    if (diffResult.status !== 0) {
      record('LEASE', '', '', false, diffResult.stdout, { detail: `git diff exited ${diffResult.status}` });
      return;
    }
    const allowRe = lease.allow.map(globToRegExp);
    const denyRe = (lease.deny ?? []).map(globToRegExp);
    const violations = diffNames.filter((f) => !allowRe.some((re) => re.test(f)) || denyRe.some((re) => re.test(f)));
    record(
      'LEASE',
      `git diff --name-only ${baseCommit}...HEAD subset-of leases.json[W10c] read via git show ${baseCommit}:docs/plans/waves/leases.json`,
      'no writes outside the W10c lease, read from baseCommit so the wave cannot widen its own lease',
      violations.length === 0,
      violations.join('\n') || (diffNames.length === 0 ? 'no diff between baseCommit and HEAD' : `all ${diffNames.length} changed files inside the lease`),
    );
  });

  const headShaFinal = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  await checkCriterion('HEAD-DRIFT', () => {
    record('HEAD-DRIFT', 'git rev-parse HEAD (re-resolved at end)', 'HEAD must not move during the run', headShaFinal === headSha, `initial=${headSha} final=${headShaFinal}`, { detail: headShaFinal === headSha ? undefined : 'HEAD moved during the run' });
  });

  // -----------------------------------------------------------------------
  // Final integrity re-check + manifest write.
  // -----------------------------------------------------------------------
  for (const r of results) {
    if (!r.artifact || !r.artifactSha256) continue;
    try {
      const currentHash = sha256File(r.artifact);
      if (currentHash !== r.artifactSha256) {
        r.status = 'fail';
        r.detail = `${r.detail ? `${r.detail}; ` : ''}TAMPER DETECTED`;
      }
    } catch {
      r.status = 'fail';
      r.detail = `${r.detail ? `${r.detail}; ` : ''}artifact disappeared before final integrity re-check`;
    }
  }

  const treeDirtyResult = sh('git', ['status', '--porcelain=v1']);
  const treeDirty = treeDirtyResult.status !== 0 || treeDirtyResult.stdout.trim().length > 0;
  const finalManifest = buildManifest(true, treeDirty);
  const { written: manifestWritten, sha256: manifestSha256 } = writeManifestFile(finalManifest);

  const nonPass = results.filter((r) => r.status !== 'pass');
  const blockedOnFounder = results.filter((r) => r.status === 'blocked-on-founder');
  console.log(`\nverify-w10c: ${results.length - nonPass.length}/${results.length} criteria pass (${blockedOnFounder.length} blocked-on-founder, treeDirty=${treeDirty}, gateIntegrityPinned=${gateIntegrityPinned})`);
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id}${r.detail ? ` (${r.detail})` : ''}`);
  if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md §2)');
  console.log(`MANIFEST_SHA256=${manifestSha256}`);
  process.exit(nonPass.length === 0 && !treeDirty && manifestWritten ? 0 : 1);
}

main().catch((err) => {
  writeEmergencyManifest(`unhandled error in main(): ${String((err as Error)?.stack ?? err)}`, results);
  process.exit(1);
});
