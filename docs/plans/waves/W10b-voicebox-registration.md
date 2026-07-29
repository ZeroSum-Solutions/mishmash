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
§7 gives the exact proposed entry, verbatim, for the orchestrator to add before implementation
starts; the verifier's `LEASE` check fails closed until that lands, by design (see §8).

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
     published package name and work on any platform with that runtime installed. §5 scopes this
     out explicitly.
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

Exactly one file, one additive change:

- `apps/daemon/src/mcp-config.ts` — one new object literal appended inside `MCP_TEMPLATES`, in the
  `utilities` section (alongside `filesystem` / `github` / `fetch` / `a11y`):

  ```ts
  {
    id: 'voicebox',
    label: 'VoiceBox',
    description:
      'Local text-to-speech and voice-cloning MCP from your local VoiceBox app (jamiepine/voicebox — Tauri + Bun + Python, unrelated to Meta’s "Voicebox" research model). Exposes voicebox.speak (speak text in a cloned or preset voice profile), plus voicebox.transcribe, voicebox.list_captures and voicebox.list_profiles. Requires the VoiceBox app running locally on 127.0.0.1:17493 — this only connects to it; Open Design does not install, launch, or manage it.',
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
  deliberately avoids the word the C10B-4 scope-creep scan bans (see that criterion's mechanism)
  so the citation itself can never trip the scanner it is standing next to.

No other file changes. Not `packages/contracts/**` (no new category — W1's lease). Not
`apps/web/**` (no new UI; the picker already groups by an existing category). Not
`apps/daemon/src/mcp-routes.ts` (existing route already serves the full template array). Not
`apps/daemon/src/cli.ts` (unrelated, pre-existing capability). Not `docs/plans/waves/leases.json`
or `docs/plans/waves/DECISIONS.md` (both HARD DENY for this wave's own scope — nothing here needs
an accepted-risk record; there is no risk being accepted, only a template being added).

## Success criteria

All five are mechanical; none require human judgment (VERIFICATION-CONTRACT.md §3 R7 does not
apply — nothing here is marked `human:`).

| ID | Assertion |
|---|---|
| **C10B-1** | `apps/daemon/src/mcp-config.ts` at HEAD defines, inside the `MCP_TEMPLATES` array literal, exactly one object whose `id` property is the string `'voicebox'`, with non-empty `label` and `homepage` string properties. |
| **C10B-2** | That object's `transport` is exactly `'http'`; its `url`, parsed as a URL, has protocol `http:`, hostname `127.0.0.1`, port `17493`, and pathname `/mcp`; its `category` is exactly `'utilities'`; its `authMode` is either absent or exactly `'none'` (never `'oauth'` — the endpoint is loopback, matching `inferMcpAuthModeForUrl`'s own loopback rule in the same file). |
| **C10B-3** | No extra surface: `git diff --name-only <baseCommit>...HEAD` is a subset of the proposed `"W10b"` lease (§7) — read mechanically from `docs/plans/waves/leases.json`, never hand-approved. Independently and more precisely for the one product file in that lease: every `MCP_TEMPLATES` object present at `baseCommit`, keyed by its `id`, is still present at HEAD with **byte-identical** source text — the change adds the one `voicebox` object and changes nothing else in the array (no reordering, no incidental edits to a neighboring template). |
| **C10B-4** | No voiceover-workflow scope creep: the `id: 'voicebox'` object literal's own source text (i.e. the template's declared fields — `description`, `example`, etc. — not any accompanying comment) matches none of, case-insensitive: `voiceover`, `storyboard`, `timeline`, a `merge` within 20 characters of `video`\|`project`, a `script` within 20 characters of `track`, `elevenlabs`, `fishaudio`, or `senseaudio`. Scoped to the object literal itself (not the whole diff) so a citation comment explaining the ruling — which necessarily discusses the thing that was refused — can never trip this check; that citation is C10B-5's job, not C10B-4's. The registered template may describe what VoiceBox's tools do; it may not describe or imply a design-workflow voiceover pipeline. |
| **C10B-5** | Documentation record: at least one comment line *added* to `apps/daemon/src/mcp-config.ts` between `baseCommit` and HEAD contains the literal substring `NM-25`, so the entry is self-explaining without needing this PRD open. |

### Why these five and not more

The task framing anticipated "registration present, correct transport/config shape, no extra
surface added, documentation record" — four themes, mapped above to C10B-1/2/3/5. C10B-4 is the
one addition: the founder ruling's entire point was refusing a bigger surface, so the refusal
itself gets an independent, mechanical check rather than resting on C10B-1..3's positive
assertions alone. A criterion asserting only what *should* exist can pass even when something
extra sneaked in beside it; C10B-3 (isolation) and C10B-4 (forbidden content) are deliberately
two different failure modes, not one restated twice.

No criterion asserts VoiceBox's server is reachable, spawns any process, or opens a network
socket — see "Explicitly out of scope." No criterion asserts `pnpm guard`/`pnpm typecheck` pass on
their own; per `VERIFICATION-CONTRACT.md`'s own opening finding, a green gate is necessary but
never sufficient by itself, so it is not listed as one of the five (the verifier still must pass
repo typecheck itself, as delivery hygiene on the verifier's own source — see §8).

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
    "apps/daemon/src/mcp-config.ts",
    "scripts/waves/verify-w10b.ts"
  ],
  "note": "Registration-only per NM-25 (docs/plans/waves/NM-REGISTER.md): one additive McpTemplate entry in MCP_TEMPLATES. No route, UI, CLI, or packages/contracts change is needed or permitted — GET /api/mcp/servers already serves the full MCP_TEMPLATES array verbatim and the 'utilities' picker category already exists. scripts/waves/verify-w10b.ts is included so a review-round fix to the verifier itself, if one is ever needed, is not blocked by its own lease — same reasoning as the W9-ingest entry's inclusion of scripts/waves/verify-w9-ingest.ts. docs/plans/waves/W10b-voicebox-registration.md is deliberately NOT included, matching every other wave's lease (no wave holds write access to its own governing PRD)."
}
```

No overlap with any currently-defined lease: `apps/daemon/src/mcp-config.ts` does not appear in
any `allow`/`deny` list for W-C, W0, W7, W1, W2, W4, W9-ingest, or W3 (checked directly against
`docs/plans/waves/leases.json` this session).

## Verified baseline (this run, pre-implementation)

Ran `pnpm exec tsx scripts/waves/verify-w10b.ts` on branch `feat/w10b-voicebox-registration`
immediately after writing the verifier, before any implementation exists. Expected and confirmed:
RED, nonzero exit — C10B-1 and C10B-2 fail because no `voicebox` template exists yet; C10B-3's
`LEASE` sub-check fails closed because `leases.json` has no `"W10b"` key yet (§7 is not yet
landed); C10B-4 and C10B-5 report against an empty diff. This is the intended fail-closed state,
not a bug — see the run tail in the authoring session's report. Once implementation lands and §7's
lease entry is added to `leases.json`, re-running the same command with no other changes is the
sole gate.

## Open questions for adversarial review

1. **Template id.** I used `id: 'voicebox'` because it matches VoiceBox's own README/`.mcp.json`
   example verbatim, and `McpServerConfig.id` is scoped to `mcp-config.json`'s own `servers` list
   (not the `od mcp` CLI namespace, which is unrelated) — collision risk is effectively zero. Flag
   if a reviewer wants a namespaced id instead (e.g. `voicebox-speak`).
2. **Optional `X-Voicebox-Client-Id` header field.** Left unregistered (not a `headerFields`
   entry) because it is optional at the protocol level (ground fact 4) and adding a form field is
   a UX nicety, not part of "registered." Flag if a reviewer wants it pinned one way as part of
   the frozen shape rather than left to the implementing agent.
3. **`leases.json` has no `"W10b"` key yet.** Structural consequence of the HARD DENY on that file
   for this authoring step — the same shape `mishmash-w9-ingest-tranche`'s own verifier documented
   for *its* PRD file during *its* authoring branch. C10B-3 will read fail-closed until the
   orchestrator lands §7's entry; that is the intended sequencing, not a defect in this PRD.
