# Decision: Gemini lane — Antigravity vs. a first-class BYOK lane (NM-14)

**Status:** Pending founder sign-off
**Date:** 2026-07-28 (drafted during W1 routing-truth implementation)
**human:** blocked-on-founder — VERIFICATION-CONTRACT.md §3 R7. This is not this
agent's call to make; recorded here so it is decided deliberately instead of
silently invented.

## Context

The W1 wave PRD (`docs/plans/waves/W1-routing-truth.md`, NM-14) asks: is
Gemini-via-Antigravity plus BYOK Google sufficient, or is a first-class
Gemini CLI (BYOK) lane wanted? Two backlog items motivated this:

- **D4 (Antigravity wired)** — already done. `apps/daemon/src/runtimes/defs/antigravity.ts`
  defines a full runtime adapter for Google's `agy` binary: plain-stream
  output, per-run model selection routed through `agy`'s own
  `settings.json` (no `--model` flag exists upstream — issue google-antigravity/antigravity-cli#35),
  and (as of this wave) a serialized spawn lock so concurrent non-default-model
  runs cannot race the shared settings file. This is Google's own agentic CLI,
  and it is fully live.
- **D5 (a standalone first-class Gemini CLI lane)** — as originally written,
  obsolete. Verified directly against this tree: there is no `apps/daemon/src/runtimes/defs/gemini.ts`
  or any other standalone Gemini CLI runtime def — `agentSearchDirs`/`AGENT_BIN_ENV_KEYS`
  (`apps/daemon/src/runtimes/executables.ts`) list every other supported CLI
  (`claude`, `codex`, `deepseek`, `kimi`, …) but no `gemini` entry. Separately,
  the legacy standalone `gemini` CLI (Google's original open-source tool,
  distinct from `agy`/Antigravity) lost individual-tier Code Assist
  authentication upstream and can no longer authenticate on that tier — the
  exact reason D5's original framing no longer applies.

Beyond the CLI lane, BYOK access to Gemini models already exists independently:
`apps/web/src/state/config.ts`'s `KNOWN_PROVIDERS` includes Google as a BYOK
protocol, so a user who wants to hit Gemini models directly with their own API
key already can, without any CLI adapter at all.

## What "a first-class Gemini BYOK lane" would mean here

Read narrowly, NM-14's second option is not "add Google to the existing BYOK
provider list" (already true — see above). It would mean a **new, dedicated
runtime adapter** comparable to `defs/claude.ts` / `defs/codex.ts`: a distinct
agent id, its own model catalog, its own auth probe, wired through
`SUBCOMMAND_MAP`-adjacent capability surfaces — i.e. new product surface area,
not a config tweak.

## Recommendation (not a ruling)

**Antigravity + the existing BYOK Google provider is sufficient; do not build
a first-class standalone Gemini CLI lane at this time.** Reasoning:

1. The concrete motivating gap (D5) is gone: the legacy CLI's own auth path
   for the tier this product would target is broken upstream, independent of
   anything in this codebase. Building a new adapter against a CLI that can't
   authenticate for most users is a dead end today.
2. Antigravity already covers "run Gemini models through an agentic CLI, with
   local tool use" — the actual capability D5 was gesturing at.
3. BYOK Google already covers "call Gemini models directly with my own key,
   no local CLI needed."
4. A third lane would be net-new maintenance surface (adapter code, model
   catalog upkeep, auth-probe logic, its own W1-style routing-truth
   guarantees) for a capability gap that, on the evidence above, does not
   currently exist.

This recommendation is **not implemented**. No first-class Gemini CLI runtime
def has been added under this decision. If the founder's answer is "yes,
build it anyway" (e.g. the standalone CLI's auth situation changes, or a
specific capability Antigravity/BYOK cannot deliver is identified), that is
new scope for a future wave, not this one.

## Decision

Decision: Pending — no founder ruling has been recorded yet. Until one is
recorded here, no first-class Gemini CLI BYOK lane is to be implemented, and
Antigravity + BYOK Google remain the only Gemini access paths in this product.

## Consequences of leaving this pending

- No behavior changes as a result of this document. `defs/antigravity.ts` and
  the BYOK Google provider are unaffected.
- A future agent picking up NM-14 must re-read this file for the founder's
  actual ruling before writing a new Gemini CLI adapter, rather than treating
  the recommendation above as authorization.
