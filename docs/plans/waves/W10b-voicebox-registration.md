# Wave 10b — VoiceBox MCP registration

**Slug:** `mishmash-w10b-voicebox` — the `W5-W11-gated.md` Wave-10 slice table's shorthand
`w10b-voicebox` names this same wave; the `mishmash-<wave>-<topic>` form used here matches every
other wave's own "**Slug:**" line (`mishmash-w9-ingest-tranche`, `mishmash-w4-project-covers`, …)
and the existing `~/.claude/goal-state/` directory naming (`mishmash-w0-substrate`,
`mishmash-w1-routing-truth`, …). Stated explicitly here so nothing downstream has to guess.

**Gates on:** founder ruling — **resolved 2026-07-27** (`docs/plans/waves/NM-REGISTER.md`, NM-25).
**Loop:** `loop:red-green-review` (`VERIFICATION-CONTRACT.md` §6; `W5-W11-gated.md` Wave 10 header).
**Verifier:** `scripts/waves/verify-w10b.ts` — run `pnpm exec tsx scripts/waves/verify-w10b.ts`.
**Write lease:** no `"W10b"` key exists yet in `docs/plans/waves/leases.json` — this document does
not add one (`leases.json` is HARD DENY for the expansion-authoring step that produced this PRD).
The "Proposed write lease" section below gives the exact entry, verbatim, for the orchestrator to
add before implementation starts; the verifier's lease check inside C10B-3 fails closed until that
lands, by design (see "Verified baseline" below). **`scripts/waves/verify-w10b.ts` is deliberately
NOT in the implementation lease's `allow` list and IS in its `deny` list, alongside this PRD**
(round-1 adversarial review finding 1; sharpened in round 3, finding 3 — see "Round 1 adversarial
review" and "Round 3 adversarial review" below): the verifier's PRIMARY authority comes from being
outside what the implementer can write, under the sequencing stated in "Proposed write lease."
`GATE-INTEGRITY` (a round-3 addition, mirroring the sibling-wave shape) is an independent
defense-in-depth self-hash layer on top of that, not a replacement for it.

This document is an **expansion**, not an implementation. Per the NM-41C gate
(`W5-W11-gated.md` lines 8–24), it is written and frozen *before* any implementation work starts,
and is reviewed by a reviewer who did not write it and will not implement it, before it is
unfrozen for a `/goal` run.

---

## Founder-pinned scope (verbatim, binding)

> Register the VoiceBox MCP and stop. No voiceover workflow scoping.

Corroborated directly in `docs/plans/waves/NM-REGISTER.md`, which the file's own header declares
authoritative over "the assessment body, either auditor's raw output, or any wave PRD":

> NM-25 | VoiceBox MCP tether (MCP already exists) | W10b | **Resolved 2026-07-27** — register the
> MCP and stop; W10b shrinks to registration only

This is deliberately the smallest wave in the program. `W5-W11-gated.md`'s own Wave-10 section
records why there was ever a bigger version to cut:

> NM-25 VoiceBox — already ships an MCP server (…). Registering it is trivial; the real question is
> *product shape* — a `speak` tool with no studio UX adds a tool, not a capability. Either scope
> "design-workflow voiceover" (script → timed track → merge into a video project, relating to the
> existing ElevenLabs/FishAudio/SenseAudio BYOK lanes) or cut the item honestly.

The founder cut it honestly. This PRD implements the cut, not the workflow. Every criterion below
exists to make "register and stop" checkable by a machine, not to re-open the bigger idea.

## Ground facts (verified directly, this session)

1. **The registration mechanism already exists; no new code path is needed.**
   `apps/daemon/src/mcp-config.ts:567` defines `MCP_TEMPLATES`, documented in its own header
   comment as "Built-in templates surfaced in the Settings 'Add MCP server' picker. Picking one
   fills the form with defaults; the resulting `McpServerConfig` flows through the same
   persistence path as a fully-custom entry." `apps/daemon/src/mcp-routes.ts:156` (`GET
   /api/mcp/servers`) already returns `{ servers: cfg.servers, templates: MCP_TEMPLATES }`
   verbatim — appending one array entry is immediately live through the existing route. No route
   change, no new endpoint.
2. **A near-identical precedent already exists in the same array.** The `figma-use` template
   (`mcp-config.ts:947–958`) is `transport: 'http'`, `authMode: 'none'`,
   `url: 'http://localhost:38451/mcp'` — a loopback HTTP server the *user* starts themselves,
   described entirely through the template's `description` prose; no code assumes the external
   process is running. VoiceBox registration is the same shape: an external, user-run, loopback
   HTTP MCP server.
3. **`utilities` is an existing category**, already in `McpTemplateCategory`
   (`mcp-config.ts:62–70`) and already rendered by the picker's `CATEGORY_ORDER`
   (`apps/web/src/components/McpClientSection.tsx:266–270`, hint text: "Filesystem, fetch, GitHub
   and similar generic tools"). No new category is required or should be added — a new category
   would touch `packages/contracts/src/api/mcp.ts` (W1's lease, per `leases.json`) and
   `McpClientSection.tsx`'s `CATEGORY_ORDER` for zero net capability.
4. **VoiceBox is a third-party, open-source app**, not an Open Design or MishMash surface:
   `~/projects/tools/third-party/voicebox` (git remote `https://github.com/jamiepine/voicebox`,
   "The open-source AI voice studio," MIT-adjacent per its own `LICENSE`), read directly and
   read-only for this PRD — this repository never depends on that one. Its own
   `backend/mcp_server/README.md` (read directly) documents:
   - Mounted at `http://127.0.0.1:17493/mcp`, Streamable HTTP transport, inside the same
     `uvicorn` process as the rest of the app. Its own checked-in `.mcp.json` and README both
     give the *same* "preferred" install snippet:
     ```json
     { "mcpServers": { "voicebox": { "url": "http://127.0.0.1:17493/mcp",
       "headers": { "X-Voicebox-Client-Id": "claude-code" } } } }
     ```
   - Four tools: `voicebox.speak`, `voicebox.transcribe`, `voicebox.list_captures`,
     `voicebox.list_profiles`. The wave skeleton and the completion assessment name only `speak`;
     the full tool list is discovered by the MCP handshake at connect time, is not something a
     `McpTemplate` declares, and is therefore not a criterion here.
   - A stdio fallback also ships (`voicebox-mcp`), but its documented command is a **hardcoded
     macOS packaged-app path** (`/Applications/Voicebox.app/Contents/MacOS/voicebox-mcp`) — unlike
     every `command`-based template already in `MCP_TEMPLATES`, which invoke `npx`/`uvx` against a
     published package name and work on any platform with that runtime installed. The "Explicitly
     out of scope" section below scopes this out explicitly.
   - `X-Voicebox-Client-Id` selects a **per-client voice binding**. VoiceBox's own resolution
     order (explicit `profile` arg → this header → a global default) means the header is optional
     for a tool call to succeed at all — it is not required for "registered."
5. **"Managed in Settings → MCP"** (`docs/plans/2026-07-26-mishmash-completion-assessment.md:85`)
   refers to *VoiceBox's own* Settings screen (its README: "Bindings are managed via
   `GET|PUT /mcp/bindings` or in the app under Settings → MCP") — i.e. the VoiceBox app, not
   MishMash. MishMash has no knowledge of VoiceBox today; that gap is what this wave closes, and
   only that gap.

## Scope

Register VoiceBox as one additional built-in `McpTemplate` entry in `MCP_TEMPLATES` — HTTP
transport, `utilities` category, no managed OAuth. Nothing else.

## Explicitly out of scope

- **Any "design-workflow voiceover" capability** — script → timed track → merge into a video or
  design project, or wiring into the existing ElevenLabs/FishAudio/SenseAudio BYOK voice lanes
  named in `W5-W11-gated.md`. The founder ruling cut this by name; it is not deferred to a later
  wave, it is refused.
- **The stdio transport / `voicebox-mcp` binary.** Non-portable hardcoded macOS `.app` bundle
  path (ground fact 4) — registering it as a template default would mean shipping a path that is
  wrong on most machines. HTTP is VoiceBox's own documented "preferred" transport and is the only
  one registered.
- **A new `McpTemplateCategory` value.** `utilities` already fits and already renders (ground
  fact 3).
- **Any new HTTP route, CLI subcommand, or UI component.** The existing `GET /api/mcp/servers` +
  the existing Settings "Add MCP server" picker already serve every template generically (ground
  fact 1). `od mcp` (`apps/daemon/src/cli.ts`) is a *different, pre-existing* capability — Open
  Design's own outbound stdio MCP proxy for external coding agents to pull MishMash project data —
  and is not touched, extended, or given a parallel "list templates" subcommand by this wave.
- **Verifying VoiceBox's own server is installed, running, or reachable on this machine.** That is
  a third-party app's liveness, not this repository's concern. The template is inert configuration
  until a user adds/enables it, exactly like every other entry in the picker.
- **Auto-enabling the server for any user.** Registration adds a *picker option*; it does not
  write a `McpServerConfig` into anyone's `mcp-config.json`. The user still clicks "Add," same as
  every other template.

## Implementation surface

Exactly one file, one additive change. **The object literal below is FROZEN, byte-for-byte**
(round-1 adversarial review finding 4 — see "Round 1 adversarial review"): `verify-w10b.ts`'s
`FROZEN` constant is a hand-synced copy of `label`/`description`/`example`/`homepage`/`transport`/
`authMode`/`category`/`url` below, and C10B-2/C10B-4 assert exact equality against it. There is no
wording this entry may take other than the one written here.

- `apps/daemon/src/mcp-config.ts` — one new object literal appended inside `MCP_TEMPLATES`, in the
  `utilities` section (alongside `filesystem` / `github` / `fetch` / `a11y`), with a citation
  comment placed *inside* the array (before its closing `]`, after the new object — see the note
  on C10B-3 below for why placement matters) and **no `headerFields` property** (round-1 ruling —
  `X-Voicebox-Client-Id` and `headerFields` generally are pinned absent, not merely unfilled):

  ```ts
  {
    id: 'voicebox',
    label: 'VoiceBox',
    description:
      'Local text-to-speech and voice-cloning MCP from your local VoiceBox app (jamiepine/voicebox on GitHub -- Tauri + Bun + Python, unrelated to the Meta Voicebox research model). Exposes voicebox.speak (speak text in a cloned or preset voice profile), plus voicebox.transcribe, voicebox.list_captures and voicebox.list_profiles. Requires the VoiceBox app running locally on 127.0.0.1:17493 -- this only connects to it; Open Design does not install, launch, or manage it.',
    transport: 'http',
    authMode: 'none',
    category: 'utilities',
    homepage: 'https://github.com/jamiepine/voicebox',
    example: 'Speak "Build complete." using my default VoiceBox voice profile.',
    url: 'http://127.0.0.1:17493/mcp',
  },
  // NM-25 (docs/plans/waves/NM-REGISTER.md): founder-ruled registration only. Scope frozen at
  // docs/plans/waves/W10b-voicebox-registration.md — do not extend without a new founder ruling.
  ```

  The trailing comment is deliberate (C10B-5) — a future reader hitting this entry should not
  need to rediscover the ruling to know the minimalism here is intentional, not unfinished. It
  deliberately avoids the word "voiceover" (see C10B-4's mechanism) so the citation itself can
  never collide with the frozen-text check it is standing next to. It must be placed *inside* the
  `MCP_TEMPLATES` array's own closing `]` — C10B-3 (round-1 finding 2 fix) requires every file byte
  **outside** the array's span to be byte-identical to `baseCommit`, so a comment placed after the
  whole `const MCP_TEMPLATES = [...]` statement would itself fail that check.

  **The object literal above must be exactly what it appears to be** (round-3 finding 1; mechanism
  replaced in round 4 after round-3 REJECTED the round-3 version of this guarantee — see "Round 3
  verdict" and "Round 4 fix" below). Rounds 1–3 tried to enforce this by banning source *shapes*
  one at a time — property spread, computed property name, duplicate property name, then (round 3)
  also methods/getters/setters, all "at any nesting depth" — and round 3's own reviewer broke that
  approach with a shape none of those bans named: a literal `__proto__: { toJSON: () => (...) }`
  property, which the ECMAScript grammar (Annex B.3.1) special-cases to set the object's
  `[[Prototype]]` rather than create an own property, so `JSON.stringify` (exactly what
  `apps/daemon/src/mcp-routes.ts:151`'s `res.json` uses to serve `MCP_TEMPLATES`) resolves an
  *inherited* `toJSON` and emits attacker-controlled data while every direct-property, first-match
  AST check still saw the frozen-looking literals and reported zero anomalies. As of round 4,
  C10B-1/2/4 no longer read source shape for this guarantee at all: they import HEAD's real,
  committed module as an actual ES module and assert that the *actually-served* value — the
  `id === 'voicebox'` entry, round-tripped through `JSON.stringify`/`JSON.parse` exactly as
  `res.json` would send it — is byte-for-byte identical to the frozen fields below, with no extra
  or missing key. Any mechanism that would make a later property silently win at runtime (spread,
  computed-key smuggling, `__proto__`/inherited `toJSON`, an own `toJSON` method, a getter/setter,
  or a post-declaration `Object.defineProperty`/`Object.setPrototypeOf` mutation) now fails this
  check by definition, because the check observes the effect, not the syntax that produced it —
  see "Round 4 fix" below for the full mechanism and why it closes the class rather than one more
  instance of it.

No other file changes. Not `packages/contracts/**` (no new category — W1's lease). Not
`apps/web/**` (no new UI; the picker already groups by an existing category). Not
`apps/daemon/src/mcp-routes.ts` (existing route already serves the full template array). Not
`apps/daemon/src/cli.ts` (unrelated, pre-existing capability). Not `docs/plans/waves/leases.json`
or `docs/plans/waves/DECISIONS.md` (both HARD DENY for this wave's own scope — nothing here needs
an accepted-risk record; there is no risk being accepted, only a template being added). Not
`scripts/waves/verify-w10b.ts` — see "Round 1 adversarial review," finding 1: this file is
frozen/external, not part of the implementer's lease.

## Success criteria

All five are mechanical; none require human judgment (VERIFICATION-CONTRACT.md §3 R7 does not
apply — nothing here is marked `human:`). **This table reflects round-1, round-3, round-4, round-5,
and round-6 adversarial-review fixes** (finding numbers refer to "Round 1 adversarial review," "Round
3 adversarial review," "Round 3 verdict," "Round 4 fix," "Round 5 fix," "Round 5 REJECT," and "Round
6 fix" below); the pre-fix versions are superseded, not merely amended in place, because several
mechanisms changed shape, not just wording — most recently C10B-1/2/4's move from round 5's FIXED,
source-legible 3-reads-per-criterion pattern to round 6's randomized-per-run read horizon. Six infra
checks — `LEASE` (folded into C10B-3), `GATE-INTEGRITY`, `SCANNER-SELFTEST`, `WIRE-SELFTEST` (round
5, replaces round 4's `RUNTIME-SELFTEST`), `TEARDOWN-ARTIFACTS-SELFTEST` (new in round 6), and
`DAEMON-TEARDOWN` (new in round 5) — are not numbered PRD criteria (matching how
`scripts/waves/verify-w9-ingest.ts` treats its own `LEASE`/`HEAD-DRIFT`/`GATE-INTEGRITY` checks) but
still gate the verifier's overall exit code; see "Definition of green."

| ID | Assertion |
|---|---|
| **C10B-1** | Proven at RUNTIME against a REAL booted daemon (round 5; round 4's temp-file-import version of this criterion was itself REJECTED — see "Round 4 fix," "Round 4 REJECT," "Round 5 fix," and "Round 5 REJECT" below). The verifier boots `apps/daemon/src/server.ts` completely unmodified, from this repository's own working tree, in an isolated namespace (fresh generic-named `OD_DATA_DIR`, OS-assigned ephemeral port, its own process group, first-party workspace deps rebuilt from HEAD before boot — see "Round 6 fix"), and issues a RANDOMIZED-PER-RUN number of independent real `GET /api/mcp/servers` requests against it (a burst of 5-14 reads, freshly drawn from `crypto.randomInt()` at run time, plus one further read after an independently randomized 250-2499ms delay — round 6 fix #1, closing round 5's fixed-3-reads bypass). Each read requires exactly one wire-observed array element whose real `.id` property equals `'voicebox'`, with an own-enumerable key set of exactly `{id, label, description, example, homepage, transport, authMode, category, url}` — no more and no fewer — on EVERY read of the randomized schedule. Missing registration, an ambiguous (duplicate) `id`, or an extra/missing wire-observed key on any read all fail this criterion closed. **Honest bound (round 6, replacing round 5's "structurally closed" overclaim):** randomizing the horizon converts a bypass that always defeated a fixed-count check into one that only sometimes defeats a given run, with odds unpredictable to the candidate code — it does not, and by information-theoretic necessity cannot, rule out a getter honest for an arbitrarily large or time-delayed hardcoded threshold; no finite verification run can. |
| **C10B-2** | Proven at RUNTIME against the same real booted daemon and the same randomized-horizon repeated `GET /api/mcp/servers` observation C10B-1 establishes: on every read, `transport` is exactly `'http'`; `url` is exactly the string `'http://127.0.0.1:17493/mcp'` — full-string equality, not component checks (finding 5: component checks silently allowed credentials/query/fragment through) — so `http://user:pass@127.0.0.1:17493/mcp?x#y` is rejected outright, not partially accepted; `category` is exactly `'utilities'`; `authMode` is exactly `'none'`, present not absent (finding 5); and no `headerFields` key is present in the actual HTTP response body (round-1 ruling — pins `X-Voicebox-Client-Id` absent by construction, not merely unfilled). Because these are wire-observed values from a real network round trip through production's own `res.json`, not any verifier-reconstructed serialization, a property spread, `__proto__`/inherited `toJSON`, an accessor, or a post-declaration mutation that would otherwise override them is caught automatically — round 4 tried to prove this same guarantee with a verifier-owned proxy for production and lost three ways (see "Round 4 REJECT"); round 5 removes the proxy by observing the real thing instead of reconstructing it; round 6 makes the number and timing of those real observations unpredictable to candidate code (see C10B-1's honest bound, which applies here too). |
| **C10B-3** | No extra surface, proven several independent ways (round-1 findings 1/2/3; round-3 findings 1/3) — **unchanged since round 4**, per the founder's carve-out that a structural/AST check may remain only for facts with no runtime observable (this one is inherently a two-commit TEXT comparison): (a) `git diff --name-only <baseCommit>...HEAD` is a subset of the `"W10b"` lease read from `leases.json@baseCommit`, whose `allow` list is asserted to be *exactly* `["apps/daemon/src/mcp-config.ts"]` **and** whose `deny` list is asserted to contain both this PRD and `scripts/waves/verify-w10b.ts` — a widened `allow` or a missing `deny` entry fails this criterion, not just an out-of-lease diff; (b) both `baseCommit`'s and HEAD's `MCP_TEMPLATES` arrays are structurally identifiable by id (every element a plain object literal with a literal string `id`, no duplicate `id` across the array) — the frozen-value correctness of the `voicebox` entry itself is proven at runtime by C10B-1/2/4, not by this structural scan; (c) the file's text **outside** the `MCP_TEMPLATES` array literal's own span (before its `[`, after its `]`) is byte-identical between `baseCommit` and HEAD; (d) every pre-existing array entry, keyed by `id`, is byte-identical between `baseCommit` and HEAD; (e) exactly one `id` is new, and it is `'voicebox'`. |
| **C10B-4** | No voiceover-workflow scope creep, by exact match instead of denylist (finding 4: a finite blocklist is always evadable by paraphrase — "narration audio," string concatenation, a newline mid-phrase, all defeat a regex scan). Proven at RUNTIME against the real booted daemon, on the same randomized-horizon repeated wire observation C10B-1/2 use: `label`, `description`, `example`, and `homepage` are each **byte-for-byte identical** to the frozen strings in "Implementation surface" above (mirrored verbatim as `verify-w10b.ts`'s `FROZEN` constant), as actually received over a real HTTP response body, not as read from source or reconstructed in-process. There is no wording these fields may take other than the one already reviewed, and no source-shape trick (spread, `__proto__`/inherited `toJSON`, accessor, post-declaration mutation) can present different wording over the wire without this criterion catching it on one of its randomized-count reads. |
| **C10B-5** | Documentation record, proven via real comment tokens, never text inside a string or template literal at any interpolation depth (round-1 finding 6; round-3 finding 2 — a hand-rolled scanner loop previously misclassified template-tail text as a comment once a `${...}` substitution was involved). `collectComments()` walks the parsed AST to record every string/template-literal token's exact span, then finds comment-shaped text in the raw source and discards any match whose start falls inside one of those spans — so text can only count as a comment if it is genuinely outside every literal the parser found. At least one comment present at HEAD but **absent** at `baseCommit` contains the literal substring `NM-25`. `SCANNER-SELFTEST` (an infra check, not a numbered criterion) proves this mechanism against the exact round-2 false-positive shapes. Unaffected by round 4, 5, or 6 — this criterion answers a two-commit comment-provenance question with no runtime observable and was never part of any REJECT finding. |

**No criterion's scope changed in round 5 or round 6.** The five themes are identical to round 1:
registration present, correct transport/config shape, no extra surface, no scope creep, documentation
record. Round 5 replaced HOW C10B-1/2/4 are proven (verifier-reconstructed serialization → real
booted daemon's real HTTP response); round 6 replaced HOW MANY TIMES and WHEN those real observations
happen (fixed 3 reads → randomized-per-run horizon) and closed five further mechanism-level residuals
(fingerprints, commit-binding, self-hash, cleanup ordering, target-visibility). Neither round added,
removed, or widened what any criterion asserts, and nothing in either round's mechanism reaches past
NM-25's registration-only boundary (see "Round 5 fix" and "Round 6 fix" for why booting the real
daemon as a verification tool, and rebuilding its first-party workspace dependencies before doing so,
are not themselves a scope expansion of the product surface). No criterion was cut for NM-25 scope in
either round — none of the inherited criteria ever exceeded registration-only, and neither round
introduced any that would.

### Why these five and not more

The task framing anticipated "registration present, correct transport/config shape, no extra
surface added, documentation record" — four themes, mapped above to C10B-1/2/3/5. C10B-4 is the
one addition: the founder ruling's entire point was refusing a bigger surface, so the refusal
itself gets an independent, mechanical check rather than resting on C10B-1..3's positive
assertions alone. A criterion asserting only what *should* exist can pass even when something
extra sneaked in beside it; C10B-3 (isolation) and C10B-4 (frozen content) are deliberately two
different failure modes, not one restated twice.

No criterion asserts **VoiceBox's** server is reachable, spawns any process related to VoiceBox, or
opens a network socket to anything outside this repository's own daemon — see "Explicitly out of
scope," which is unchanged by round 5. As of round 5, the verifier itself DOES boot an isolated copy
of this repository's own daemon and open loopback sockets to it — that is the verification
mechanism (see "Round 5 fix"), not a wave-completion criterion, not a VoiceBox contact, and not a
product capability; it is the same category of thing `pnpm tools-dev` already does for local
development, run here in a disposable, isolated, always-torn-down namespace for observation only. No
criterion asserts `pnpm guard`/`pnpm typecheck` pass on their own; per `VERIFICATION-CONTRACT.md`'s
own opening finding, a green gate is necessary but never sufficient by itself, so it is not listed
as one of the five. (The verifier's own source must still pass repo typecheck, as delivery hygiene
on this PRD's authoring step — confirmed via `pnpm exec tsc -p scripts/tsconfig.json --noEmit`
during authoring; that is a requirement on this file, not a wave-completion criterion.)

## Definition of "green"

The wave is green when a single `pnpm exec tsx scripts/waves/verify-w10b.ts` run against a clean
tree (`treeDirty: false`) reports `status: "pass"` for C10B-1 through C10B-5, plus the six infra
checks `GATE-INTEGRITY` (round 6: always-active self-vs-HEAD tamper-evidence, not only once pinned),
`SCANNER-SELFTEST`, `WIRE-SELFTEST` (round 5, replaces round 4's `RUNTIME-SELFTEST`),
`TEARDOWN-ARTIFACTS-SELFTEST` (new in round 6), `DAEMON-TEARDOWN` (new in round 5, now gated on a
target-visibility positive control per round 6), and `HEAD-DRIFT` (LEASE is folded into C10B-3, not a
separate manifest entry), in `~/.claude/goal-state/mishmash-w10b-voicebox/proof/manifest.json`, with
`exitCode: 0` overall. `GATE-INTEGRITY`'s self-vs-HEAD sub-check passes trivially whenever the tree is
honestly dirty (expected during authoring — the overall run already fails via `treeDirty` in that
case) and fails only when the tree claims clean while the executing bytes diverge from HEAD (the
assume-unchanged/skip-worktree tamper scenario it exists to catch); its approved-hash sub-check passes
trivially (recorded `gateIntegrityPinned: false`) until the orchestrator places
`~/.claude/goal-state/mishmash-w10b-voicebox/approved-gate.sha256`, and once pinned must match this
file's own sha256 exactly. `DAEMON-TEARDOWN` records `status: "not-exercised"` (counts as `!==
"pass"`, never a silent green) only in the unreached case where the isolated daemon never finished
spawning at all, so nothing was left running either way; whenever a process was actually spawned —
whether the boot completed or failed partway through — `DAEMON-TEARDOWN` reports the REAL confirmed
process-group teardown result (target-visibility positive control included), and a failed, partial,
or unconfirmed teardown fails the run. No other wave depends on this one; nothing consumes W10b's
manifest the way W3's C3-4 consumes W9-ingest's.

## Proposed write lease (text only — `leases.json` is HARD DENY for this document)

Verbatim JSON for the orchestrator to add as `waves["W10b"]` in
`docs/plans/waves/leases.json` (schema per that file's existing entries: `slug`, `allow`,
optional `deny`, `note`):

```json
"W10b": {
  "slug": "mishmash-w10b-voicebox",
  "allow": [
    "apps/daemon/src/mcp-config.ts"
  ],
  "deny": [
    "docs/plans/waves/W10b-voicebox-registration.md",
    "scripts/waves/verify-w10b.ts"
  ],
  "note": "Registration-only per NM-25 (docs/plans/waves/NM-REGISTER.md): one additive McpTemplate entry in MCP_TEMPLATES. No route, UI, CLI, or packages/contracts change is needed or permitted -- GET /api/mcp/servers already serves the full MCP_TEMPLATES array verbatim and the 'utilities' picker category already exists. Round-1 finding 1 (sharpened round-3 finding 3): scripts/waves/verify-w10b.ts is EXCLUDED from allow and explicitly DENIED, alongside this PRD -- unlike the W9-ingest precedent's inclusion of its own verifier in allow, an implementer-writable verifier can be weakened and still pass its own lease check, so the verifier's authority comes from being outside what the implementer can write, reinforced by an explicit deny rather than mere omission. This requires a specific landing sequence: this lease row and the frozen verify-w10b.ts must both be merged to main FIRST; the implementation branch is then cut (or rebased) so its baseCommit already contains both. Under that sequence baseCommit-relative diff checking is sufficient. C10B-3 mechanically asserts allow is exactly one entry (apps/daemon/src/mcp-config.ts) and deny contains both denied paths -- a widened allow or a dropped deny entry fails closed too. GATE-INTEGRITY (round-3) is an additional, independent defense-in-depth self-hash layer on top of this lease, not a substitute for it: once the orchestrator places approved-gate.sha256 alongside this file, any further modification to verify-w10b.ts is caught even in a scenario where lease enforcement itself were somehow bypassed."
}
```

No overlap with any currently-defined lease: `apps/daemon/src/mcp-config.ts` does not appear in
any `allow`/`deny` list for W-C, W0, W7, W1, W2, W4, W9-ingest, or W3 (checked directly against
`docs/plans/waves/leases.json` this session).

## Verified baseline (round 6, this run, pre-implementation)

Ran `pnpm exec tsx scripts/waves/verify-w10b.ts` on branch `feat/w10b-voicebox-registration`, twice
in a row against the clean, committed tree (`treeDirty: false`), after the round-6 fix below, before
any implementation exists. Both runs: RED, nonzero exit, same character — **6/11 passing —
`GATE-INTEGRITY`, `SCANNER-SELFTEST`, `WIRE-SELFTEST`, `TEARDOWN-ARTIFACTS-SELFTEST`,
`DAEMON-TEARDOWN`, and `HEAD-DRIFT`** — differing only in the randomized read-horizon schedule each
run drew (different `crypto.randomInt()` burst counts and tail delays each time, by design — see
"Round 6 fix" #1). This shape changed from round 5's "5/10" with `TEARDOWN-ARTIFACTS-SELFTEST` added
as a sixth infra check in round 6; `GATE-INTEGRITY` now ALSO passes its always-active self-vs-HEAD
sub-check on a clean tree (it correctly FAILED that same sub-check during authoring, while the tree
was still honestly dirty — see "Round 6 fix" #4). All six infra checks are self-contained and do not
depend on VoiceBox being registered, so they correctly pass before implementation too.
`TEARDOWN-ARTIFACTS-SELFTEST` and `WIRE-SELFTEST` exercise only synthetic fixtures (real on-disk temp
files for the former, a throwaway in-process HTTP server for the latter), never this repository's
actual `mcp-config.ts` or the real booted daemon. C10B-1/2/4 fail because the real isolated daemon
boots successfully (first-party workspace deps freshly rebuilt from HEAD per "Round 6 fix" #3) against
the real, unmodified `mcp-config.ts` and correctly observes zero wire-served elements with
`id === 'voicebox'` on the first read of the randomized-horizon burst each criterion takes; C10B-3
fails closed on both grounds (no `"W10b"` key in `leases.json@baseCommit` yet, and zero new
`MCP_TEMPLATES` entries); C10B-5 fails because `apps/daemon/src/mcp-config.ts` has not changed at all
between `baseCommit` and HEAD, so no new comment exists to find. This is the intended fail-closed
state, not a bug. Both runs independently confirmed: zero process-group survivors after teardown (with
a passed target-visibility positive control both times), no leftover temp directories, and the
default-namespace daemons on ports 7456/51012 unaffected (same PIDs/process-group ids before and after
every run in this authoring session, checked directly via `ps`/`lsof`). Total wall-clock per run was
roughly a minute (dominated by the ~10s first-party workspace rebuild plus the randomized burst/tail
delays across three criteria), materially slower than round 5's ~5s but still well within a normal
interactive verification budget. Once implementation lands and the proposed lease entry is added to
`leases.json`, re-running the same command with no other changes is the sole gate (plus, at the
orchestrator's discretion, pinning `approved-gate.sha256` for `GATE-INTEGRITY`'s defense-in-depth
layer). As an authoring-time sanity check (never committed, reverted immediately via
`git checkout --`, confirmed byte-identical to the pre-edit file by sha256), the exact frozen object
was added to `apps/daemon/src/mcp-config.ts` and the verifier re-run against the dirty working tree:
C10B-1/2/4 correctly went GREEN (the real booted daemon served the real registered entry, matching
FROZEN on every read of that run's randomized-horizon schedule) while C10B-3/5 correctly stayed RED
(they read `HEAD` via `git show`, which does not see an uncommitted working-tree edit — confirming
C10B-1/2/4 observe the working tree while C10B-3/5 observe committed history, exactly as designed, and
that a true positive does make C10B-1/2/4 pass rather than the mechanism being unsatisfiable by any
implementation).

### Round 5 baseline (superseded by round 6 above, kept for history)

Ran `pnpm exec tsx scripts/waves/verify-w10b.ts` on branch `feat/w10b-voicebox-registration`, twice
in a row, after the round-5 fix below, before any implementation exists. Both runs: RED, nonzero
exit, byte-identical shape — exactly **5/10 passing — `GATE-INTEGRITY` (unpinned),
`SCANNER-SELFTEST`, `WIRE-SELFTEST`, `DAEMON-TEARDOWN`, and `HEAD-DRIFT`** — with `treeDirty: true`
in this authoring session specifically because the round-5 verifier rewrite itself was uncommitted at
the moment these runs were taken. This round-5 mechanism was subsequently REJECTED on confirmation
review — see "Round 5 REJECT" and "Round 6 fix" below.

### Round 4 baseline (superseded by round 5/6 above, kept for history)

Ran `pnpm exec tsx scripts/waves/verify-w10b.ts` on branch `feat/w10b-voicebox-registration`,
re-confirmed after the round-4 fix below, before any implementation exists. Expected and
confirmed: RED, nonzero exit, exactly **4/9 passing — `GATE-INTEGRITY` (unpinned),
`SCANNER-SELFTEST`, `RUNTIME-SELFTEST`, and `HEAD-DRIFT`** — with `treeDirty: false`. (This shape
changed from round 1's "1/6, only `HEAD-DRIFT`" once `GATE-INTEGRITY` and `SCANNER-SELFTEST` were
added in round 3, and from round 3's "3/8" once `RUNTIME-SELFTEST` was added in round 4.)
C10B-1/2/4 failed because no `voicebox` template existed yet; C10B-3 failed closed on both grounds
(no `"W10b"` key in `leases.json@baseCommit` yet, and zero new `MCP_TEMPLATES` entries); C10B-5
failed because `apps/daemon/src/mcp-config.ts` had not changed at all between `baseCommit` and HEAD.
This round-4 mechanism was subsequently REJECTED on confirmation review — see "Round 4 REJECT" and
"Round 5 fix" below.

## Round 1 adversarial review

**Verdict: REJECT** (6 findings). Fixed in this revision; all six are closed below. Per
`VERIFICATION-CONTRACT.md` §6's round cap, this was fix round 1 of 2 before founder escalation.

What round 1 confirmed **good** (carried forward unchanged): grounding accuracy (`utilities`
category, `figma-use` precedent, `GET /api/mcp/servers` route behavior, VoiceBox
README/`.mcp.json` corroboration), fail-closed exit/`treeDirty` handling, no cooked/executable
template content, the verifier never contacting a daemon, the exactly-two-files diff range, and a
clean `tsc`.

| # | Finding (summary) | Fix |
|---|---|---|
| 1 | Frozen verifier was implementer-mutable (in its own proposed lease, no self-hash binding) | Lease narrowed to `apps/daemon/src/mcp-config.ts` only (see "Proposed write lease"); C10B-3 now also asserts the lease's `allow` list is *exactly* that one entry. Verifier's header comment states the required landing sequence. |
| 2 | C10B-3's byte comparison covered only `MCP_TEMPLATES` object literals — new exports/functions/hooks elsewhere in the file passed unchanged | C10B-3 now additionally requires the file's text **outside** the array literal's own span to be byte-identical between `baseCommit` and HEAD (`splitAroundArray` in the verifier) |
| 3 | `Map.set` silently collapsed duplicate ids; spreads/calls/non-literal ids were silently skipped | Replaced the array walk with `analyzeTemplateArray`, which fails closed (non-empty `problems`) on any spread, any non-object-literal element, any object literal without a literal string `id`, and any duplicate `id` across the whole array — every criterion checks `problems.length === 0` before trusting the parsed result |
| 4 | C10B-4's denylist regex was evadable by paraphrase ("narration audio," concatenation, etc.) | Denylist removed entirely. C10B-4 now asserts byte-exact equality of `label`/`description`/`example`/`homepage` against the one frozen string per field (`FROZEN` constant in the verifier, mirrored verbatim in "Implementation surface" above) |
| 5 | C10B-2 checked URL components separately (missed credentials/query/fragment) and accepted absent `authMode` | URL check is now full-string equality against `'http://127.0.0.1:17493/mcp'`; `authMode` must be exactly `'none'` (present, not absent) |
| — | *(round-1 ruling, not a numbered finding)* Leave `X-Voicebox-Client-Id` unregistered and pin its absence | C10B-2 now also asserts **no `headerFields` property at all** on the object |
| 6 | C10B-5 accepted any added line containing "NM-25," including inside a string literal | Rewritten to use the TypeScript scanner's own comment tokens (`skipTrivia: false`) — a string literal can never satisfy this; the match must be a real `//`/`/* */` comment, newly added |

**Rulings applied, verbatim reasoning:**
- *Template id:* kept `id: 'voicebox'` — matches VoiceBox's own configuration; a namespaced id like
  `voicebox-speak` would misleadingly narrow a four-tool server. (Resolves former open question 1.)
- *`X-Voicebox-Client-Id`:* left unregistered, absence now pinned by C10B-2 — optional, and the
  global-default fallback keeps registration functional; adding the field would be an unrequested
  UX extension. (Resolves former open question 2.)
- *Lease sequencing:* lease narrowed to the one product file; verifier bound externally. The
  orchestrator must land the lease row (and this frozen verifier) on `main` first, then cut/rebase
  the implementation branch so `baseCommit` already contains both — under that sequence,
  `baseCommit`-relative diff checking is correct as designed. (Sharpens former open question 3 into
  a stated requirement rather than leaving it open.)

No open questions remain from round 1. Round-2 review follows this revision.

## Round 2 adversarial review

**Verdict: REJECT.** Round 2 confirmed the real, committed `MCP_TEMPLATES` array (39 entries, 39
unique literal ids at the time of review) is satisfiable and that a legitimate implementation
(the exact frozen object plus a real `NM-25` comment) produces zero analyzer problems and passes
all five intended checks — but it also constructed a **concrete false-green**: a type-valid object
literal carrying the frozen direct properties (`id`, `label`, URL, `authMode`, …) followed by
`...evilOverride` — a property spread returning an alternate `id`, an `evil.invalid` URL, `authMode:
'oauth'`, `headerFields`, and a `` `${0}// NM-25` `` decoy. Because JavaScript object literals are
last-write-wins, the RUNTIME object had none of the frozen values, while the round-1 verifier's
static, first-match property reader saw only the frozen-looking literals and reported zero
problems — a complete false-green across C10B-1 through C10B-5 simultaneously. Findings, verbatim
summary (full log: the round-2 verdict handed to this authoring session):

| # | Verdict | Gap |
|---|---|---|
| 1 | NOT FIXED | The verifier's authority rested solely on lease exclusion, with no orchestrator-owned approved-copy/hash binding — an implementer executing their own branch's `HEAD` copy of the verifier could change both the verifier and its own lease assertion. |
| 2 | FIXED-WITH-DEFECT | The outside-array byte-identical check was real, but a property spread inside the NEW object (not outside the array) could still smuggle content the check never inspected. |
| 3 | FIXED-WITH-DEFECT | Array-level spreads/non-object elements/missing-id/duplicate-id were closed, but `SpreadAssignment` *properties* (object spreads) inside an object literal were never checked — "any spread" was array-level only, not object-level. |
| 4 | FIXED-WITH-DEFECT | The four frozen fields compared equal for the DIRECT AST properties, but a later spread could still replace those values at runtime. |
| 5 | FIXED-WITH-DEFECT | Direct-property URL/authMode/headerFields checks were exact and correct, but `hasOwnProp` (like `findStringProp`) never accounted for a spread that could yield a different URL/authMode/headerFields at runtime. |
| 6 | FIXED-WITH-DEFECT | Ordinary strings and no-substitution templates were correctly excluded, but the raw `scanner.scan()` loop, run without template-substitution context tracking, misclassified template-tail text following a `${...}` as a real comment (confirmed on `` `${0}// NM-25` `` and a block-comment-lookalike variant) — combined with the spread gap, C10B-5 could pass on a fabricated "comment" too. |

Regression check (round 2): `pnpm exec tsc -p scripts/tsconfig.json --noEmit` exited 0; fail-closed
init/placeholder/`treeDirty`/exit behavior intact; static-only (no daemon/network contact,
`git`/`pnpm --version` subprocesses only); no generated executable verifier content; worktree
clean; `73f9774c2`'s parent was exactly `b951fe864`; the full range contained exactly the two
deliverable files; `leases.json` untouched. All of this carried forward into round 3 unchanged.

## Round 3 adversarial review

**Founder-authorized final round** (2026-07-28) — scoped strictly to the three closures below.
After this revision: one confirmation review, then the gate either freezes or the wave parks.

1. **Deep spread ban.** `findDeepStructuralAnomalies()` (`scripts/waves/verify-w10b.ts`) walks the
   *entire* `MCP_TEMPLATES` subtree — every object literal, at every nesting depth, including
   inside any array-valued field — and fails closed on: `SpreadElement` (array spread) anywhere;
   any object-literal member that is not a plain `PropertyAssignment` (i.e. `SpreadAssignment`,
   `ShorthandPropertyAssignment`, method/getter/setter members are all rejected); a computed or
   non-literal property name; or a property name repeated within one object literal. The last
   three are not literally "spread," but are the identical vulnerability class the round-2 demo
   exploited (a later property silently overrides an earlier frozen-looking one at runtime,
   invisible to a first-match extractor) and are closed by the same mechanism rather than left as
   an equally-trivial adjacent bypass — see "Implementation surface" above for the corresponding
   requirement on the frozen object itself. Verified against the exact round-2 false-green
   construction (property spread after frozen literals) plus five further synthetic probes
   (computed-key override, duplicate-key override, spread nested inside a nested array field,
   array-spread nested inside a nested array, and a clean legitimate entry that must still pass) —
   all six behaved correctly in a scratchpad self-test exercising the real algorithm against
   synthetic source, never touching this repository's actual `mcp-config.ts` (hard-denied product
   code).
2. **Scanner fix.** `collectComments()` no longer hand-rolls a stateful scanner loop. It walks the
   already-correctly-parsed AST once to record the exact `[start,end)` span of every
   string/template-piece/regex literal token — the parser resolved template-substitution
   boundaries correctly, which is precisely the thing a manual re-scan got wrong — then finds
   comment-shaped text in the raw source with a simple regex and discards any match whose start
   falls inside one of those literal spans. `SCANNER-SELFTEST` (new infra check, not a numbered
   criterion — the two-file constraint means the fixture lives in-process rather than as a third
   file) runs eight cases on every verifier invocation, including the exact two round-2
   false-positive shapes (`` `${0}// NM-25` `` and `` `before ${0} /* NM-25 */ after` ``), a
   no-substitution-template control, a plain-string control, a real-comment-adjacent-to-a-template
   control, and a nested-template-substitution case one level deeper than round 2 demonstrated.
3. **GATE-INTEGRITY.** New infra check mirroring `scripts/waves/verify-w9-ingest.ts`'s own
   `GATE-INTEGRITY` shape exactly: self-hashes the file currently executing
   (`process.argv[1]`) and compares it against an orchestrator-placed
   `~/.claude/goal-state/mishmash-w10b-voicebox/approved-gate.sha256`. Absent (the state for every
   run in this authoring session, and for any run before the orchestrator pins one), it passes with
   `gateIntegrityPinned: false` recorded in the manifest; present, it must match exactly. This is
   explicitly **defense in depth, not the primary control** — the primary control remains C10B-3's
   lease-subset check, which already keeps this file out of the implementer's own diff. Per the
   founder's instruction, the proposed lease's `deny` list (see "Proposed write lease" above) now
   also names both this file and this PRD explicitly, and C10B-3 mechanically asserts that `deny`
   list is present, not merely that `allow` omits them.

**Verification performed:** re-ran the byte-for-byte PRD/verifier frozen-string comparison (still
exact after the PRD edits above); ran a second scratchpad self-test (22 assertions, all synthetic,
never touching repo files) covering the exact round-2 false-green demo, the two adjacent
vulnerability-class variants (computed key, duplicate key), two deep-nesting variants, a legitimate
entry, all eight scanner fixture cases, `GATE-INTEGRITY`'s unpinned/pinned-match/pinned-mismatch
shapes, and the lease allow-exact/deny-required shape — all 22 passed. `pnpm exec tsc -p
scripts/tsconfig.json --noEmit` exits 0. This verifier writes no generated script content (only
`manifest.json` and plain-text proof artifacts), so `node --check` does not apply to anything it
produces.

No open questions remained at authoring time. This PRD and verifier were presented for round-3
confirmation review — see "Round 3 verdict" immediately below for the actual outcome.

## Round 3 verdict

**REJECT.** All three round-3 closures above (deep spread ban, scanner fix, `GATE-INTEGRITY`) were
independently re-verified by the round-3 reviewer and confirmed genuine — they were not the reject
reason. The reject reason was a **new vector neither round 1 nor round 2 had probed**:

> **BLOCKER — runtime serialization override still false-passes.** The walker accepts every
> uniquely named `PropertyAssignment` and does not constrain initializer shapes
> (`verify-w10b.ts:500`); direct field checks then ignore prototype behavior (`verify-w10b.ts:458`).
> A probe using all exact `FROZEN` values plus `__proto__: { toJSON: () => ({ evil runtime
> fields… }) }` produced zero structural anomalies, all eight frozen comparisons equal,
> `hasOwnHeaderFields: false`, and zero TypeScript diagnostics — yet `JSON.stringify` emitted the
> evil URL, OAuth mode, header fields, and description. This is product-relevant because the route
> serializes `MCP_TEMPLATES` through `res.json` (`mcp-routes.ts:151`). It violates the PRD's
> "exactly what it appears to be" requirement (PRD:172) and false-greens C10B-1/2/4.
>
> VERDICT: REJECT because a type-valid `__proto__`/inherited-`toJSON` property-assignment shape
> still converts an apparently frozen template into attacker-controlled runtime JSON while every
> relevant verifier check passes.

Root cause: `id: 'voicebox'` and every other frozen field really were present as own properties on
the object literal in round 3's fixed version — round 3's `findDeepStructuralAnomalies()` correctly
saw a well-formed, uniquely-named `PropertyAssignment` for each of them and reported zero anomalies,
exactly as designed. What round 3's AST scan could not see is that `__proto__: { toJSON: () =>
(...) }`, written as an ordinary-looking property assignment, is special-cased by the ECMAScript
grammar (Annex B.3.1: "`__proto__` Property Names in Object Initializers") to set the object's
`[[Prototype]]` rather than create an own property — and that `JSON.stringify` (what
`apps/daemon/src/mcp-routes.ts:151`'s `res.json` uses to serve `MCP_TEMPLATES`) calls a `toJSON`
method found via the prototype chain exactly as it would call an own one, discarding every other
property on the object in favor of whatever that method returns. A static, source-shape-based
reader has no way to know this without also reimplementing the object-literal grammar's own
special cases and the exact algorithm `JSON.stringify` uses to look up `toJSON` — which is itself
just one more shape to enumerate, alongside spread, computed keys, duplicate keys, and accessors.
Round 2 and round 3 each closed one shape; round 3's reviewer found the next one. A denylist of
shapes was never going to terminate.

## Round 4 fix (founder-authorized final round)

**Founder ruling (binding, verbatim in substance):** do not patch the `__proto__` case as one more
structural check. Close the entire CLASS of literal-vs-runtime divergence by proving the frozen
expectations at RUNTIME — import the real production module (or exercise the real route on an
isolated daemon) and assert the actually-serialized values (`JSON.stringify` output, or the HTTP
response body) against the frozen expected serialization. A structural/AST check may remain only
for facts with no runtime observable. If this change makes some structural checks redundant,
remove them rather than keep two sources of truth. The runtime assertion must be robust by
construction to `__proto__`/inherited `toJSON`, accessors, methods, `Object.assign`/
`defineProperty`/`setPrototypeOf` mutations, and dead branches satisfying node-walk constants —
sibling wave packages were rejected for the same class of finding.

**Mechanism.** `verify-w10b.ts`'s `importRealTemplatesAtHead()` materializes HEAD's committed text
for `apps/daemon/src/mcp-config.ts` into a throwaway `.mts` file and dynamically `import()`s it as
a REAL ES module — not a text/AST read. `findVoiceboxRuntimeEntries()` locates the runtime array
element(s) whose real `.id` property equals `'voicebox'` (ordinary JS property access, following
the prototype chain exactly like any other reader). `serializeAsWireWould()` round-trips that
element through `JSON.stringify` then `JSON.parse` — precisely the transformation Express's
`res.json` performs and a wire client would undo — and `compareFrozenFields()` compares the result
against `FROZEN` field-by-field, with C10B-1 additionally asserting the wire-serialized own-key set
is exactly `FROZEN`'s key set (no extra, no missing). C10B-1/2/4 each independently perform this
import (a fresh cache-busted `import()` per call, per this file's pre-existing "every criterion
re-reads/re-scans, never shares state" principle), and this repo's own
`apps/daemon/src/mcp-config.ts` has zero non-Node-builtin imports and does no I/O or port binding
at module-evaluation time (confirmed this session by reading the file), so the import is exactly as
safe as the rest of the verifier's "no daemon, no port" contract — the daemon-route alternative the
founder also authorized was not needed here.

**Why this closes the CLASS, not one instance.** `JSON.stringify` is the actual mechanism Node uses
to decide what gets served; asserting against its real output — on the real, fully-evaluated
object, after every top-level module statement has already run — means the check no longer asks
"does the source look safe," it asks "is the data that would actually leave this process correct."
That question is insensitive to *how* a divergence would be produced:
- **`__proto__`/inherited `toJSON`** (round 3's vector): `JSON.stringify` resolves an inherited
  `toJSON` exactly like an own one — the runtime check observes exactly this, because it calls
  `JSON.stringify` too.
- **An own `toJSON` method**: same mechanism, no `__proto__` needed — also observed directly.
- **A property spread overriding earlier fields** (round 2's vector): last-write-wins is a runtime
  fact about the object's actual properties, which `JSON.stringify` serializes as they really are.
- **Getters/accessors**: `JSON.stringify` invokes them during property enumeration (absent a
  `toJSON`) — the returned value, not the source text, is what gets compared.
- **`Object.defineProperty`/`Object.setPrototypeOf` after the array literal**: since the whole
  module is actually executed by a real `import()`, any top-level mutation has already run by the
  time `MCP_TEMPLATES` is read back — there is no "before" state to be fooled by.
- **Dead branches satisfying node-walk constants**: a real `import()` only ever executes the branch
  JavaScript actually takes; there is no walk to fool.

`RUNTIME-SELFTEST` (new infra check, mirroring `SCANNER-SELFTEST`'s established in-process-fixture
pattern) proves this against eight synthetic module sources run through the exact same pipeline
C10B-1/2/4 use: a clean legitimate entry (must still pass), the exact round-3
`__proto__`/inherited-`toJSON` vector, an own `toJSON` method, the round-2 spread-override vector
(regression), a getter/accessor override, a post-declaration `Object.defineProperty` mutation, a
post-declaration `Object.setPrototypeOf` mutation, and a dead-branch-lookalike ternary. All eight
behaved correctly this session (see "Verification performed" below) — the seven attack-shape
fixtures were all detected as divergent, and the clean fixture stayed clean.

**Structural checks removed as redundant.** `findDeepStructuralAnomalies()` (round 3's per-object
spread/computed-key/duplicate-key/accessor scan across the whole `MCP_TEMPLATES` subtree) and
`hasOwnProp()` (used only by the old static `headerFields`-absence check) are **removed**, not kept
alongside the runtime check. Both existed solely to protect a static, first-match property reader
(`findStringProp`) from exactly the class of divergence the runtime check now observes directly and
unconditionally; keeping them would be two sources of truth for the same fact, one of which is
demonstrably incomplete (that incompleteness is the round-3 finding itself). `findStringProp` is
retained, but only for locating each array element's literal `id` — a fact `analyzeTemplateArray`
still needs for C10B-3's baseCommit-vs-HEAD byte-diffing, which is answered per the founder's own
carve-out: it is inherently a two-commit TEXT comparison with no runtime equivalent (there is no
single execution whose output could tell you "did this OTHER, unrelated array entry's source text
change between two commits"), so it correctly stays AST/text-based. `TemplateBlock.node` (the
`ObjectLiteralExpression` handle the removed static checks used) is also removed, since nothing
reads it anymore.

**What did NOT change.** C10B-3 and C10B-5 keep their pre-round-4 mechanisms untouched — neither
was implicated in the round-3 finding, and both answer questions (cross-commit text diffing;
comment-token provenance) that have no meaningful runtime-observable restatement. `GATE-INTEGRITY`
is unaffected. The frozen object literal in "Implementation surface" above is unchanged byte-for-
byte; only how its correctness is PROVEN changed.

**Verification performed:** `pnpm exec tsc -p scripts/tsconfig.json --noEmit` exits 0 (no
diagnostics — confirmed after all round-4 edits, including the dynamic `import()` calls and the new
`RUNTIME-SELFTEST` fixtures). `pnpm exec tsx scripts/waves/verify-w10b.ts` against the
pre-implementation tree (no `voicebox` entry exists yet) reports RED, exit 1, `treeDirty: false`,
with the correct 4/9 shape recorded in "Round 4 baseline" above — critically, `RUNTIME-SELFTEST`
itself passes pre-implementation (it never touches the real `mcp-config.ts`), proving the mechanism
detects all seven attack shapes correctly even before any implementation exists to protect. The
merge from `main` (bringing in unrelated docs-only lease/decision-record commits) was clean, with
no conflicts, and the `baseCommit...HEAD` diff still contains exactly the two deliverable files
(this PRD and `scripts/waves/verify-w10b.ts`).

No open questions remained at authoring time. This PRD and verifier were presented for round-4
confirmation review — see "Round 4 REJECT" immediately below for the actual outcome.

## Round 4 REJECT

**REJECT.** The round-4 mechanism above was independently re-verified by the round-4 confirmation
reviewer to be genuinely stronger on wire-value divergence than round 3's AST scan — but the
reviewer constructed three NEW, type-clean bypasses, all in the same class as round 3's: a
verifier-owned RECONSTRUCTION of what production serves is not the same fact as what production
actually serves, and each of the three closed a gap between that reconstruction and reality that no
prior round had probed.

> 1. **BLOCKER — the verifier does not serialize in the production route's context.**
>    `serializeAsWireWould()` serialized the entry as the root value, while production serializes
>    `{ servers, templates: MCP_TEMPLATES }`. A type-clean probe introduced `toJSON(key)` through a
>    spread, returning FROZEN for root key `''` but evil fields for array key `'0'`: TypeScript
>    reported zero diagnostics, every verifier comparison passed, yet the route-shaped serialization
>    emitted the evil URL, OAuth mode, and description.
> 2. **BLOCKER — one fresh snapshot per criterion does not prove persistent runtime behavior.**
>    C10B-1, C10B-2, and C10B-4 each imported a fresh module and serialized once. A type-clean
>    stateful `url` getter returned the frozen URL on its first serialization and an evil URL
>    thereafter; every criterion saw a new first read and passed, while the daemon retains one
>    imported `MCP_TEMPLATES` instance and serves the divergent value on a later request.
> 3. **BLOCKER — the temporary copy is not semantically the real production module and executes
>    candidate code unsandboxed.** The helper wrote committed text under a predictable
>    `verify-w10b-runtime-*` temporary path and imported that URL; production imports `./mcp-config.js`
>    from its real location. A zero-diagnostic
>    `import.meta.url.includes('verify-w10b-runtime-') ? FROZEN.url : evilUrl` probe passed the
>    verifier but evaluated differently in production.
>
> VERDICT: REJECT because type-clean implementations can still pass while real route output diverges
> by serialization context, repeated access, or the temporary module location.

Every other round-4 check was independently reconfirmed genuine (deep spread ban, scanner fix,
`GATE-INTEGRITY`, C10B-3/C10B-5's static carve-outs, the clean-implementation selftest fixture,
`treeDirty`/exit/init fail-closed handling, the exactly-two-files diff range). The reviewer also
established that round 3's `findDeepStructuralAnomalies()` (removed in round 4 as "redundant") was
NOT redundant — it would have caught bypass (1). The founder's delegated ruling (recorded in
`docs/plans/waves/DECISIONS.md`'s `W10B-PARK` entry) is that round 4's own instruction ("close the
class by asserting at runtime") was directionally right but under-specified: asserting at runtime is
insufficient unless the assertion ALSO holds in the production serialization context, is REPEATED
(first read is not the only read), and observes the module at its REAL path — and that patching
`__proto__` (or these three) as one more named case would be a fourth guess at where the next
divergence hides, not a structural fix. The wave was parked (`W10B-PARK`) rather than a fifth round
authorized against the same reconstruction-based foundation, with NM-25 explicitly not cancelled: "if
it is picked up later it gets a fresh package built on the booted-daemon HTTP-response pattern, not
a fifth revision of this one."

## Round 5 fix (founder-authorized re-expansion round, 2026-07-29)

**Why round 5 does not patch round 4.** Every round-4 bypass shares one root cause with rounds 1-3's
own failures, named explicitly in `docs/plans/waves/DECISIONS.md`'s `W10B-PARK` /`W9AS-PARK` /
`W10A-PARK` entries: trying to prove RUNTIME truth by having the verifier ITSELF reconstruct what
production would do (an AST read in rounds 1-3; a temp-file import + manual `JSON.stringify` in
round 4) is unsound by construction, because the space of ways a reconstruction can diverge from the
real thing is unbounded — each round closes the named gap and an adversarial reviewer finds the
next. The binding program-wide rule this park record states is: *"a criterion asserting runtime
behavior must observe that behavior — boot the daemon, issue the real request, assert the response."*
Round 5 does exactly that, for the first time in this wave's history, rather than tightening the
round-4 reconstruction one more time.

**Mechanism.** `bootIsolatedDaemon()` (`scripts/waves/verify-w10b.ts`) boots
`apps/daemon/src/server.ts` — completely unmodified, imported from its real location in this
repository's own working tree, never a materialized copy — as a genuine `detached: true` child
process with its own process group, an isolated `OD_DATA_DIR`, and an OS-assigned `port: 0`
(independently re-checked against the protected default-namespace ports `{7456, 51012}` before any
request is issued; boot refuses and tears down immediately if the OS ever hands back one of those
two exact ports). `fetchMcpServersWire()` issues a real `GET /api/mcp/servers` — the exact route
`apps/daemon/src/mcp-routes.ts:151-157` serves via `res.json({ servers: cfg.servers, templates:
MCP_TEMPLATES })` — and parses the real HTTP response body, never calling `JSON.stringify` itself on
any reconstructed value. `observeVoiceboxWireEntryRepeated()` issues this real request three
independent times per criterion against the SAME long-lived daemon process (nine total real reads
across C10B-1/2/4's shared use of one boot), each independently compared to `FROZEN`.
`DAEMON-TEARDOWN` (new infra check) confirms, via `killGroupFailClosed` — adapted unchanged in
mechanism from the reference implementation in `scripts/waves/verify-w9-filesystem.ts` — that the
isolated daemon's entire process group is empty before the run can be green, escalating SIGTERM →
SIGKILL and independently re-scanning the real system process table rather than trusting a leader's
`exit` event.

**Why this closes all three round-4 bypasses structurally, not by naming them.** Round 4's bypasses
all exploited a gap between "what the verifier's proxy computes" and "what production actually
serves." Round 5 has no proxy for C10B-1/2/4 to have a gap from:

- **Bypass (1), serialization context:** there is no verifier-reconstructed root-value serialization
  anymore. The HTTP response body IS production's real `res.json` output, with `templates` nested
  exactly where `mcp-routes.ts` puts it — a `toJSON(key)` keyed on the array index sees the SAME key
  production's real serialization gives it, on every read, because it IS that serialization.
- **Bypass (2), single-read snapshot:** the daemon process is booted once and stays alive for the
  run. Every one of the nine real HTTP reads across C10B-1/2/4 is an independent round trip against
  that one long-lived module instance — a getter or counter honest only on an early read fails on a
  later independent one, because there is no "fresh import per criterion" left to reset it.
- **Bypass (3), temp-path module identity:** there is no temp path anywhere in the C10B-1/2/4 path.
  The daemon imports its own `./mcp-config.js` from its own real location under
  `apps/daemon/src/`, exactly as `pnpm tools-dev` boots it — `import.meta.url` inside
  `mcp-config.ts`, if anything ever inspected it, shows this repository's real path, indistinguishable
  from a genuine local launch. Round 4's own throwaway-file mechanism is removed from the file
  entirely, not just from the C10B-1/2/4 path — nothing in this verifier materializes a copy of
  `mcp-config.ts` anywhere, for any check, as of round 5.

**`WIRE-SELFTEST` (renamed from round 4's `RUNTIME-SELFTEST`).** Proves the OBSERVATION mechanism
itself — fetch, parse, compare — has no blind spot, against the same eight fixtures round 4 used
(clean entry; the round-3 `__proto__`/inherited-`toJSON` vector; an own `toJSON` method; the round-2
spread-override vector; a getter/accessor; a post-declaration `Object.defineProperty` mutation; a
post-declaration `Object.setPrototypeOf` mutation; a dead-branch-lookalike ternary). Round 5 builds
each fixture as a REAL in-process JS object (`Object.create`, `Object.defineProperty`, a getter, a
spread — the same mechanisms hostile source would use, applied directly; `JSON.stringify` cannot
tell the difference between an object built inline and one produced by compiling and importing a
module) and serves it through a genuine `node:http` server's `res.end(JSON.stringify({ servers: [],
templates: [entry] }))` — the same nesting shape as production — fetched twice over a real loopback
socket through the identical `fetchMcpServersWire()` / `findVoiceboxWireEntries()` /
`compareFrozenFields()` pipeline C10B-1/2/4 use. This is deliberately NOT a claim that the fixtures
are equivalent to compiling hostile source through the real `apps/daemon` module graph — that broader
claim is what C10B-1/2/4 make, using the real daemon. `WIRE-SELFTEST`'s narrower claim (the
fetch+parse+compare pipeline itself has no blind spot) does not need Express or the real module
graph to be true, and using a bare `node:http` server keeps the fixture self-contained without
depending on `express` being resolvable from the verifier's own module resolution root. Also
deliberately in-process (no subprocess, no process group) — the fixtures never claim to BE
production, unlike `bootIsolatedDaemon()`, so they do not need process-group teardown machinery; a
plain `server.close()` suffices.

**What did NOT change in round 5.** C10B-3 and C10B-5 keep their round-4 (and round-3, for C10B-5)
mechanisms untouched — neither was implicated in the round-4 REJECT, and both answer questions
(cross-commit text diffing; comment-token provenance) with no meaningful runtime-observable
restatement, which is exactly the founder's stated carve-out for keeping a structural/AST check.
`GATE-INTEGRITY` and `SCANNER-SELFTEST` are unaffected. The frozen object literal in "Implementation
surface" above is unchanged byte-for-byte; only how C10B-1/2/4's correctness is PROVEN changed, for
the second time.

**No criterion cut for NM-25 scope.** Round 5 replaces a verification MECHANISM, not the wave's
scope. All five numbered criteria assert exactly the same five things round 1 named (registration
present, transport/config shape, no extra surface, no scope creep, documentation record); nothing was
added, widened, or removed. Booting an isolated copy of THIS repository's own daemon as a
verification tool is not a VoiceBox capability and does not touch anything past NM-25's
registration-only boundary — see "Definition of green" for why this is not treated as a
wave-completion criterion opening a network socket.

**Verification performed:** `pnpm exec tsc -p scripts/tsconfig.json --noEmit` exits 0 (no
diagnostics). `pnpm exec tsx scripts/waves/verify-w10b.ts` run twice in a row against the
pre-implementation tree (no `voicebox` entry exists yet) reports RED both times, byte-identical
5/10 shape (see "Verified baseline" above), with `WIRE-SELFTEST` passing both times (its 8 fixtures
never touch the real `mcp-config.ts`) and `DAEMON-TEARDOWN` passing both times with an independently
`ps`-confirmed empty process group and zero leftover temp directories after each run. The
default-namespace daemons on ports 7456/51012 (this machine's protected PIDs at authoring time)
were confirmed unaffected — same PID/process-group identity — before and after both runs. As an
authoring-time-only sanity check, the exact frozen object was added to `apps/daemon/src/mcp-config.ts`
(never committed, reverted via `git checkout --` immediately after, confirmed byte-identical to the
pre-edit file by sha256): C10B-1/2/4 correctly went GREEN against the real booted daemon serving the
real registered entry, proving the mechanism is satisfiable by a genuine implementation and not merely
"always red." This PRD and verifier are presented for round-5 confirmation review.

## Round 5 REJECT

**REJECT**, but the round-5 core was independently CONFIRMED VALID, not re-architected: the
confirmation reviewer verified that C10B-1/2/4 now fetch the actual `GET /api/mcp/servers` response
production generates rather than re-stringifying a reconstructed entry, that the round-4
`toJSON(key)` root-vs-array-key bypass has no direct survivor, that the diff range is exactly the two
deliverable files with `leases.json`/`DECISIONS.md`/`docs/security/**` untouched, that NM-25 scope is
respected, and that `apps/daemon/src/mcp-config.ts` is byte-identical across worktree/HEAD/parent
(satisfiability-proof residue clean). Six findings nonetheless kept the verdict at REJECT, four of
them BLOCKER:

1. **BLOCKER — single-read snapshot analogue survives.** The daemon is genuinely one long-lived
   process, but the verifier performed a FIXED, predictable nine sequential reads (three per
   criterion) with no delay or randomized horizon. A zero-diagnostic `get url()` returning the frozen
   URL for reads 1-9 and an evil URL on read 10 passed every check.
2. **BLOCKER — verifier-identity analogue survives.** The exact `import.meta.url`-based temp-path
   vector was closed (the daemon imports its real source path through the real `server.ts`), but the
   daemon still received unmistakable verifier fingerprints: `OD_DATA_DIR` always began the literal
   substring `w10b-daemon-data-`, and the boot entrypoint always lived under a `w10b-daemon-boot-*`
   directory as `boot.mjs`. A zero-diagnostic initializer keyed on `process.env.OD_DATA_DIR?.includes(
   "w10b-daemon-data-")` would pass under verification and diverge during a normal launch.
3. **Non-blocking — serialization context's original bypass IS closed.** C10B-1/2/4 fetch the real
   response; the former root-vs-array-key `toJSON(key)` bypass has no direct survivor. Narrower
   observation, not a blocker: the verifier did not validate `Content-Type` or `servers`/exact
   top-level keys, but since the route is outside the implementation lease this was not treated as
   blocking.
4. **BLOCKER — transitive commit-binding is absent.** `apps/daemon/src/server.ts` statically imports
   first-party `@open-design/*` packages whose exports resolve to gitignored `dist/*.mjs` bundles,
   never rebuilt by the verifier. A stale or hand-edited package artifact could execute during daemon
   import without appearing in `treeDirty` or being bound to HEAD.
5. **BLOCKER — FROZEN is committed but not fully tamper-evident in the executing run.** `GATE-INTEGRITY`
   explicitly passed while unpinned, and the executing file was never compared to
   `git show HEAD:scripts/waves/verify-w10b.ts` — final binding relied only on `git status`, which an
   `assume-unchanged`/`skip-worktree` flag can fool while the actually-executing bytes redefine
   `FROZEN` (independent of `mcp-config.ts`, so C10B-3's lease-diff check never sees it).
6. **BLOCKER — cleanup ordering fails on multiple paths.** Normal shutdown, boot failure, and the boot
   timeout all deleted `bootDir`/`dataDir` even when `killGroupFailClosed()` returned `ok: false`;
   `node --check` failure and a spawn-with-no-pid both returned without removing either directory even
   though nothing was ever spawned; probe fetches had no timeout, so a hanging route could block the
   run from ever reaching teardown; there was no outer signal handler protecting the daemon's lifetime
   if the verifier itself were interrupted.
7. **BLOCKER — DAEMON-TEARDOWN does not establish enumeration trust.** No pre-teardown assertion
   confirmed the target PID/PGID was visible through the same `ps` mechanism before trusting a
   post-kill "zero rows" result as proof of a clean exit — a session-scoped or PATH-shimmed `ps`
   returning exit 0 with empty/self-only output would read as "confirmed empty" regardless of whether
   the target was actually gone.

Also noted: the empty-array `.every()` vacuity concern had no additional surviving issue; red-spec
attributability was adequate; the PRD was found not fully honest about proof strength, claiming the
three round-4 bypasses were closed "structurally" despite findings 1-2 above, and citing a
`DECISIONS.md` `W10B-PARK` entry that was not yet present in the file at review time (the file
contained only the round-4 authorization).

`VERDICT: REJECT because predictable verifier fingerprints, a fixed nine-read horizon, unpinned
ignored build inputs, and fail-open teardown enumeration still permit concrete false greens and
unconfirmed process leakage.`

Per the founder-authorized autonomous fix-round policy for this fresh review arc (this was
non-APPROVE #1), an autonomous fix round was authorized without re-litigating the confirmed-valid
core. Closed below.

## Round 6 fix (founder-authorized autonomous fix round)

Closes all six round-5 findings. Full per-fix rationale lives in `scripts/waves/verify-w10b.ts`'s own
header comment (search `ROUND 6`); this section summarizes each fix and states the honest bound where
one applies.

**1. READ-HORIZON.** `observeVoiceboxWireEntryRepeated()` draws a FRESH burst-read count
(`crypto.randomInt(5, 15)`, i.e. 5-14 reads) and a FRESH long-tail delay (`crypto.randomInt(250,
2500)` ms) at RUN TIME for every criterion invocation, interleaves unpredictable real traffic
(`GET /api/mcp/install-info`, a pre-existing side-effect-free route) between reads, and always ends
with one more read after the independently randomized delay. `crypto.randomInt()` is OS-entropy-backed,
deliberately preferred over the seedable `Math.random()` PRNG for the stronger unpredictability
property this check wants; both, along with `Date.now()`, are ordinary permitted APIs in this
program-scaffolding CLI script, which is not one of `apps/daemon`'s product Workflow-automation
scripts and answers to none of their separate determinism constraints. **Honest bound:** this converts
round 5's bypass — which ALWAYS defeated a fixed, source-legible read count deterministically — into
one that only SOMETIMES defeats a given run, with odds unpredictable to the candidate code. It does
NOT, and by information-theoretic necessity cannot, close the residual of a getter honest for an
arbitrarily large or arbitrarily time-delayed hardcoded threshold; no finite verification run,
randomized or not, can distinguish that from a genuinely honest implementation. The success-criteria
table's wording for C10B-1/2 states this bound explicitly, replacing round 5's "structurally closed"
overclaim.

**2. VERIFIER FINGERPRINTS.** Temp-dir prefixes for both `OD_DATA_DIR` and the boot-script directory
changed from `w10b-daemon-data-`/`w10b-daemon-boot-` to a generic `od-` prefix (matching this
product's own internal `OD_*`/`.od/`/`od` naming convention, per the founder's NM-03 ruling to keep
those identifiers, rather than inventing a verifier-neutral scheme from nothing); the generated
entrypoint filename changed from `boot.mjs` to `main.mjs`. Swept and confirmed clean: `OD_BIND_HOST`
is a legitimate config value any real launch could set; `OD_API_TOKEN`/`OD_WEB_PORT` deletions are
indistinguishable from a real deployment that never set them; the bound port is always OS-assigned,
never fixed/guessable; `apps/daemon/src/mcp-config.ts`'s confirmed-narrow import surface
(`node:fs/promises`, `node:fs`, `node:crypto`, `node:path` only, re-confirmed this round) has no
plausible path to inspect its own process's argv or listening port. **Disclosed, not closed:** the
boot mechanism (a generated single-file `tsx` launcher) remains structurally distinguishable from a
`pnpm tools-dev` launch by anything that can see argv globally — no `--od-stamp-*` flags, no IPC
socket. Closing that would mean routing an isolated verifier through the full sidecar control plane,
which is disproportionate for a registration-only wave and was not done.

**3. TRANSITIVE COMMIT-BINDING.** `ensureDaemonWorkspaceDepsRebuiltFromHead()` forces a fresh
`pnpm --filter "@open-design/daemon^..." run build` (the 10-package first-party closure
`apps/daemon/src/server.ts` transitively imports, confirmed via `pnpm --filter ... list`) before any
daemon boot, memoized once per verifier process (~10s wall clock on this tree, confirmed this
session). Rebuild rather than hash-pin: unconditionally commit-binds every run's live boot rather than
merely detecting and refusing a stale dist.

**4. SELF-HASH.** `GATE-INTEGRITY` now ALWAYS compares the executing file's own bytes against
`git show HEAD:scripts/waves/verify-w10b.ts`, independent of `git status --porcelain`. A mismatch
while the tree independently claims to be clean is a tamper alarm (the assume-unchanged/skip-worktree
scenario finding 5 named) and fails the check; a mismatch while the tree honestly reports itself dirty
is recorded as an informational difference, since the overall run already fails via `treeDirty` in
that case regardless. Confirmed this session: during authoring (dirty tree), this sub-check correctly
recorded the expected-mismatch case; nothing in this authoring session ever exercised the tamper-alarm
branch, since no `assume-unchanged`/`skip-worktree` flag was ever set. The pre-existing approved-hash
comparison (once `approved-gate.sha256` is pinned) is unchanged and layers on top.

**5. CLEANUP ORDERING.** `finalizeArtifacts()` is now the single, shared implementation for every exit
path that owns daemon-boot artifacts: deletes `paths` ONLY when the teardown result is `ok: true`; on
any unconfirmed/failed teardown, RETAINS every path and names them in the returned detail.
`cleanupNeverSpawnedArtifacts()` is the separate, unconditional-delete path used only when no process
was ever spawned (`node --check` failure, spawn-with-no-pid) — nothing could have leaked in those
cases. `TEARDOWN-ARTIFACTS-SELFTEST` (new infra check) proves both branches against REAL on-disk temp
directories created for the test: a confirmed-ok result deletes them; an unconfirmed/failed result
retains them and names the retained path in its detail. Probe fetches now carry a bounded
`AbortSignal.timeout(10_000)` (`safeProbeFetch`) so a hanging route cannot block the run from reaching
teardown; the verifier's own process registers `SIGINT`/`SIGTERM` handlers that best-effort tear down
any currently-tracked live daemon before exiting, in case the verifier itself is interrupted mid-run.

**6. TARGET-VISIBILITY ENUMERATION.** `killGroupFailClosed()` is rewritten, ported from
`scripts/waves/verify-w9-filesystem.ts` commit `0d6bf026f` (the landed target-visibility reference
this round's authorization named — confirmed landed and read in full before designing this fix, per
instruction). It now: gates on synthetic-input self-probes for both the process-table classifier
(`PROCESS_TABLE_SELF_PROBES`) and the target-visibility evaluator (`TARGET_VISIBILITY_SELF_PROBES`)
before trusting any real scan; establishes, BEFORE sending any signal, that the target is
independently alive (`process.kill(pid,0)`) AND that the same `ps`-based scan shows a row for that
exact pgid while alive (the positive control); requires BOTH zero post-kill survivors AND a passed
positive control before declaring "confirmed empty." `ps` exit-nonzero, empty output, malformed rows,
or a missing self-visibility row are all an untrustworthy scan (RUN FAILURE), never proof of a clean
exit — a scan that never proved it could see the target's session is never trusted for the negative
result either, even reporting zero rows.

**Verification performed:** `pnpm exec tsc -p scripts/tsconfig.json --noEmit` exits 0 (no
diagnostics). `pnpm guard` (102/102) and repo-wide `pnpm typecheck` both exit 0. `pnpm exec tsx
scripts/waves/verify-w10b.ts` run twice against the clean, committed pre-implementation tree reports
RED both times with the same 6/11 character (see "Verified baseline" above), with different
randomized read schedules each run (confirming the horizon randomization is genuinely per-run, not a
fixed constant read at startup and reused). `TEARDOWN-ARTIFACTS-SELFTEST` passed both times against
real on-disk fixtures. `DAEMON-TEARDOWN` passed both times with a confirmed target-visibility positive
control. Zero process-group survivors and zero leftover temp directories after every run this session
(both pre- and post-commit); the default-namespace daemons on ports 7456/51012 were confirmed
unaffected (same PID/process-group identity) before and after every run. As an authoring-time-only
sanity check (never committed, reverted via `git checkout --`, confirmed byte-identical to the
pre-edit file by sha256), the exact frozen object was added to `apps/daemon/src/mcp-config.ts`:
C10B-1/2/4 correctly went GREEN against the real booted daemon, on every read of that run's randomized
schedule, proving the new mechanism remains satisfiable by a genuine implementation and not merely
"always red." This PRD and verifier are presented for the next confirmation review.
