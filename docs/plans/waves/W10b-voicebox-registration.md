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
NOT in the implementation lease** (round-1 adversarial review finding 1, fixed — see "Round 1
adversarial review" below): the verifier's authority comes from being outside what the implementer
can write, not from a self-hash pin, and that only holds under the sequencing stated in "Proposed
write lease."

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
apply — nothing here is marked `human:`). **This table reflects round-1 adversarial-review fixes**
(finding numbers below refer to "Round 1 adversarial review"); the pre-fix version is superseded,
not merely amended in place, because several mechanisms changed shape, not just wording.

| ID | Assertion |
|---|---|
| **C10B-1** | Parsing `MCP_TEMPLATES` at HEAD with the TypeScript compiler API finds **zero anomalies** across the *entire* array (findings 2/3): no spread element, no element that isn't a plain object literal, no object literal whose `id` isn't a literal string, and no duplicate `id` anywhere in the array — and, once the array is safe to reason about, exactly one element has `id === 'voicebox'`. Any anomaly fails this criterion closed; it does not fall through to a looser check. |
| **C10B-2** | That element's `transport` is exactly `'http'`; its `url` is exactly the string `'http://127.0.0.1:17493/mcp'` — full-string equality, not component checks (finding 5: component checks silently allowed credentials/query/fragment through) — so `http://user:pass@127.0.0.1:17493/mcp?x#y` is rejected outright, not partially accepted; its `category` is exactly `'utilities'`; its `authMode` is exactly `'none'`, present not absent (finding 5); it has **no `headerFields` property at all** (round-1 ruling — pins `X-Voicebox-Client-Id` absent by construction, not merely unfilled). |
| **C10B-3** | No extra surface, proven three independent ways (findings 1/2/3): (a) `git diff --name-only <baseCommit>...HEAD` is a subset of the `"W10b"` lease read from `leases.json@baseCommit`, and that lease's `allow` list is asserted to be *exactly* `["apps/daemon/src/mcp-config.ts"]` — a widened lease fails this criterion, not just an out-of-lease diff; (b) both `baseCommit`'s and HEAD's `MCP_TEMPLATES` arrays pass C10B-1's zero-anomaly analysis; (c) the file's text **outside** the `MCP_TEMPLATES` array literal's own span (before its `[`, after its `]`) is byte-identical between `baseCommit` and HEAD — closing the "new export/function/hook elsewhere in the file" gap an array-only diff cannot see; (d) every pre-existing array entry, keyed by `id`, is byte-identical between `baseCommit` and HEAD; (e) exactly one `id` is new, and it is `'voicebox'`. |
| **C10B-4** | No voiceover-workflow scope creep, by exact match instead of denylist (finding 4: a finite blocklist is always evadable by paraphrase — "narration audio," string concatenation, a newline mid-phrase, all defeat a regex scan). The `id: 'voicebox'` element's `label`, `description`, `example`, and `homepage` are each **byte-for-byte identical** to the frozen strings in "Implementation surface" above (mirrored verbatim as `verify-w10b.ts`'s `FROZEN` constant). There is no wording these fields may take other than the one already reviewed. |
| **C10B-5** | Documentation record, proven via real comment tokens, not raw diff text (finding 6: a string literal containing "NM-25" used to satisfy this). Using the TypeScript scanner in comment-preserving mode (`skipTrivia: false`), at least one comment token (`//` or `/* */`, never a string-literal token) present at HEAD but **absent** at `baseCommit` contains the literal substring `NM-25`. |

### Why these five and not more

The task framing anticipated "registration present, correct transport/config shape, no extra
surface added, documentation record" — four themes, mapped above to C10B-1/2/3/5. C10B-4 is the
one addition: the founder ruling's entire point was refusing a bigger surface, so the refusal
itself gets an independent, mechanical check rather than resting on C10B-1..3's positive
assertions alone. A criterion asserting only what *should* exist can pass even when something
extra sneaked in beside it; C10B-3 (isolation) and C10B-4 (frozen content) are deliberately two
different failure modes, not one restated twice.

No criterion asserts VoiceBox's server is reachable, spawns any process, or opens a network
socket — see "Explicitly out of scope." No criterion asserts `pnpm guard`/`pnpm typecheck` pass on
their own; per `VERIFICATION-CONTRACT.md`'s own opening finding, a green gate is necessary but
never sufficient by itself, so it is not listed as one of the five. (The verifier's own source must
still pass repo typecheck, as delivery hygiene on this PRD's authoring step — confirmed via
`pnpm exec tsc -p scripts/tsconfig.json --noEmit` during authoring; that is a requirement on this
file, not a wave-completion criterion.)

## Definition of "green"

The wave is green when a single `pnpm exec tsx scripts/waves/verify-w10b.ts` run against a clean
tree (`treeDirty: false`) reports `status: "pass"` for C10B-1 through C10B-5 in
`~/.claude/goal-state/mishmash-w10b-voicebox/proof/manifest.json`, with `exitCode: 0` overall. No
other wave depends on this one; nothing consumes W10b's manifest the way W3's C3-4 consumes
W9-ingest's.

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
  "note": "Registration-only per NM-25 (docs/plans/waves/NM-REGISTER.md): one additive McpTemplate entry in MCP_TEMPLATES. No route, UI, CLI, or packages/contracts change is needed or permitted — GET /api/mcp/servers already serves the full MCP_TEMPLATES array verbatim and the 'utilities' picker category already exists. Round-1 adversarial review finding 1 (fixed): scripts/waves/verify-w10b.ts is deliberately EXCLUDED from this lease, unlike the W9-ingest precedent's inclusion of its own verifier -- an implementer-writable verifier can be weakened and still pass its own lease check, so the verifier's authority here comes from being outside what the implementer can write. This requires a specific landing sequence: this lease row and the frozen verify-w10b.ts must both be merged to main FIRST; the implementation branch is then cut (or rebased) so its baseCommit already contains both. Under that sequence baseCommit-relative diff checking is sufficient and no separate self-hash/gate-integrity pin is needed. C10B-3 additionally asserts this allow list is exactly one entry, apps/daemon/src/mcp-config.ts -- a widened lease fails closed too. docs/plans/waves/W10b-voicebox-registration.md is deliberately NOT included either, matching every other wave's lease (no wave holds write access to its own governing PRD)."
}
```

No overlap with any currently-defined lease: `apps/daemon/src/mcp-config.ts` does not appear in
any `allow`/`deny` list for W-C, W0, W7, W1, W2, W4, W9-ingest, or W3 (checked directly against
`docs/plans/waves/leases.json` this session).

## Verified baseline (this run, pre-implementation)

Ran `pnpm exec tsx scripts/waves/verify-w10b.ts` on branch `feat/w10b-voicebox-registration`,
re-confirmed after the round-1 fixes below, before any implementation exists. Expected and
confirmed: RED, nonzero exit, exactly **1/6 passing — only the `HEAD-DRIFT` infra check** — with
`treeDirty: false`. C10B-1/2/4 fail because no `voicebox` template exists yet; C10B-3 fails closed
on both grounds (no `"W10b"` key in `leases.json@baseCommit` yet, and zero new `MCP_TEMPLATES`
entries); C10B-5 fails because `apps/daemon/src/mcp-config.ts` has not changed at all between
`baseCommit` and HEAD, so no new comment exists to find. This is the intended fail-closed state,
not a bug — see the run tail in the authoring session's report. Once implementation lands and the
proposed lease entry is added to `leases.json`, re-running the same command with no other changes
is the sole gate.

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
