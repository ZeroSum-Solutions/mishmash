# Wave 0 — Substrate: recovery, boundary, baselines

**Slug:** `mishmash-w0-substrate`
**Gates on:** nothing (start immediately)
**Parallel with:** W-C (clone close-out), W7 (Selector spike) — no file overlap
**Blocks:** W1, W3, W4, W9 (and therefore everything downstream)
**Loop:** `loop:red-green-review`

## Why this wave exists

Both adversarial auditors independently put recovery and threat-boundary work first. The
reasoning is concrete, not ceremonial:

- There is **no verified backup/restore** for a local-first product holding ~1.1 GB of
  irreplaceable user state (SQLite, projects, Library assets, memory, config). Every later
  wave either migrates data, enriches it, or exposes it.
- The daemon is **privileged** and the clipper's capability-token machinery **exists but is
  bypassed** — any `chrome-extension://`/`moz-extension://` origin is accepted for ingest, and
  loopback calls without an `Origin` header skip browser-origin checks. W3 exposes the Library
  ingest surface; hardening must precede exposure.
- **No scale baseline exists** against the real 987 MB project store, so no later wave can
  prove it did not make things worse.
- **UI/CLI parity is repo policy** (`AGENTS.md` → Capability exposure), and nothing mechanically
  enforces it. Every feature wave will need that harness.

## Scope

> **IDs below cite [`NM-REGISTER.md`](NM-REGISTER.md).** Revision 2 renumbered these: the first
> draft used raw audit numbering, in which "NM-36" meant *daemon threat model* here and *data
> migration map* in the audit it came from. A literal agent would have built the wrong item.

**NM-25C — Backup and restore.**
Atomic snapshot and restore-to-fresh-root covering: SQLite database, `PROJECTS_DIR`, Library
assets, memory markdown, app config, MCP config/tokens. Restore must be verified by *actually
restoring into a clean data root* and diffing, not by asserting the archive exists. Secrets
(connector credentials, BYOK keys, MCP tokens) must be classified explicitly: either excluded
with a documented gap, or included with the archive marked sensitive. Must respect the
`RUNTIME_DATA_DIR` contract in `AGENTS.md` — no new data-root conventions.

**NM-21C — Daemon threat model + wire the existing capability tokens.**
Document caller classes (web UI, `od` CLI, clipper extension, external agents, malicious local
process, malicious web page). For the clipper ingest path: bind a capability token to an
extension identity rather than trusting any extension origin. Add tests for DNS-rebinding,
CSRF, and no-`Origin` local callers. **Do not** build a new pairing system — wire up the
machinery already in the tree.

**NM-27C (measure only) — Scale baseline.**
Benchmark against the current store: cold daemon start, project-list render, `DesignsTab` fan-out,
memory high-water, and search. Record numbers as a committed baseline file. The `Promise.all`
fan-out fix is **W4's** job; this wave only establishes the yardstick.

**NM-33C — UI/CLI parity harness — via a capability manifest, not a name match.**
The first draft proposed matching `SUBCOMMAND_MAP` names against HTTP routes. Sol showed why that
cannot work: `SUBCOMMAND_MAP` (`cli.ts:332`) maps only top-level names to handlers, and the route
inventory (`route-registration-guard.ts:23`) records only method/path. **Neither knows which
endpoint a subcommand actually calls**, whether a capability is user-facing, or whether `--json`
is real. A stub `od foo --json` printing `{}` plus an unrelated `GET /api/foo` returning 200
satisfies a naming heuristic completely.

Build instead a **capability manifest**: `{capability, uiEntryPoint, cliInvocation, httpMethod +
path, outputSchema, parityApplicable + reason}`. The harness **probes it end-to-end** — invoke the
CLI form, invoke the UI's endpoint, assert both reach the same handler and return the same
contract shape. Seed from the real inventory (**340 HTTP method registrations across 35 route
files + 6 bootstrap routes** — Sol's AST count, not the assessment's earlier 239).

**NM-26C (inventory only) — Rebrand / stored-data compatibility map.**
Before any wave touches identity, freeze what stored state would break under a rename: `.od/`
paths, `OD_*` env vars, MCP server names, project JSON keys, connector credential records,
sidecar stamps. **Inventory only** — no migration is executed here, and the founder may well rule
"keep the identifiers" (both auditors recommend it). The point is that if W11 ever fires, or any
path rewrite happens, the blast radius is already known rather than discovered live.

**NM-28 — Current daemon failure inventory.**
The de-bloat run recorded 20 pre-existing failures; the suite has since been greened and made a
merge gate. Re-measure on current `main` and either close the item or reopen it with the real
list. Do not carry a stale number forward.

## Explicitly out of scope

Fixing the `Promise.all` fan-out (W4). Exposing the Library (W3). Any route hardening beyond the
clipper/ingest boundary (W9). Any rebrand work (W2).

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-w0.ts`.

| ID | Criterion | Verification |
|---|---|---|
| C0-1 | Backup produces a restorable archive **with real contents** | Snapshot → restore into a fresh `OD_DATA_DIR` → daemon boots → **and** `PRAGMA integrity_check` = ok, content-hash equality on ≥20 sampled project files, and an HTTP fetch of a restored asset returns a body whose sha256 matches source. Counts alone passed with 0-byte assets |
| C0-2 | The snapshot is **atomic under concurrent mutation** | Run the backup while a writer loop mutates SQLite and project files. Restored state must be referentially consistent — no row referencing a missing file, no file newer than the snapshot. Use SQLite online-backup, not a file copy |
| C0-3 | Restore integrity is proven, not asserted | Deliberate corruption of one archive entry makes the verifier exit non-zero — asserted for a DB page, a project file, **and** a manifest entry, not just one |
| C0-4 | Secret handling is explicit **and complete** | A required-vs-optional data inventory lists every class; the policy (excluded-and-listed / included-and-flagged) is asserted per class. "Exclude everything sensitive" must fail the required-class check — the first draft's policy test passed by excluding all of it |
| C0-5 | Clipper ingest requires a capability token **bound to an identity** | Red spec: arbitrary `chrome-extension://` origin without a token → rejected; valid bound token → accepted. `routes/library.ts:301` currently trusts any extension origin |
| C0-6 | Tokens are **non-transferable and revocable** | Cross-extension replay rejected; revocation takes effect immediately; rotation invalidates the prior token. Possession of a string anyone can read from local storage is not identity |
| C0-7 | Origin-less callers cannot reach **any** privileged route | Frozen privileged-route inventory committed first; the test iterates **every** row. Testing one chosen route while others stay open was the hole |
| C0-8 | Threat model documented, **each defense citing a test** | `docs/security/daemon-threat-model.md` enumerates caller classes; every defense bullet names the test ID that enforces it. An unenforced defense claim is a §3 R5 violation — this repo has already shipped lying docs once |
| C0-9 | Scale baseline committed **under the R8 protocol** | `docs/testing/scale-baseline-2026-07.md`: fixed corpus, warmup policy, ≥5 reps, p50 + p95 + peak RSS, and the **minimum improvement threshold** later waves must beat. Versioned |
| C0-10 | Parity harness probes behavior, not names | Capability manifest committed; harness invokes both surfaces and asserts same handler + same contract shape. **Red control:** a stub `od foo --json` printing `{}` next to an unrelated `GET /api/foo` must **fail** the harness |
| C0-11 | Parity harness wired into `pnpm guard` | Adding a capability to one surface only fails `pnpm guard` (proven with a temporary fixture, then reverted) |
| C0-12 | Rebrand/stored-data compatibility inventory frozen | `docs/security/stored-identity-inventory.md` enumerates every stored surface a rename would break, with record counts. Inventory only — no migration executed |
| C0-13 | Daemon failure inventory current | Report listing current failures (or "none") against a **defined command matrix** — unit, integration, and e2e each named. "None" reached by excluding e2e is not none |
| C0-14 | Repo gates pass | `pnpm guard` exit 0; `pnpm typecheck` exit 0; daemon + web package tests green, zero `skip`/`only`/`todo` added |

## Adversarial review

GPT-5.6 Sol, focused on: can the restore path lose data silently? Does the capability token
actually bind to an identity or just to *possession*? Can the parity harness be satisfied by a
stub CLI subcommand that does not reach the same endpoint? Does the threat model claim defenses
the code does not implement (the lying-docs failure mode already seen in this repo today)?

## Notes for the executor

- `AGENTS.md` → **Daemon data directory contract** is binding. Derive every path from
  `RUNTIME_DATA_DIR`; do not invent path conventions or add filesystem examples to docs.
- A legacy data-directory copier already exists (`OD_LEGACY_DATA_DIR` is a sanctioned migration
  source) — read it before writing new copy logic.
- Tests live in package-level `tests/` siblings to `src/`, never inside `src/`.
