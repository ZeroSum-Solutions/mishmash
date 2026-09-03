# Subprocess limits

**Parent:** [`architecture.md`](architecture.md)

A turn can spawn long-running child processes — the agent CLI itself, a media
render, an image generation. Every one of those is bounded, either by a MishMash
budget or by the operating system. This page is the single list of those bounds
and of the error each one produces, so a run that dies mid-step is never a
silent kill.

The failure alert (chat) and `od run info <runId>` both name the step and the
cause behind a run that hit one of these. The mapping from a daemon cause to its
user-facing name lives in `apps/web/src/runtime/amr-guidance.ts`.

## MishMash budgets

Every budget below is read from the daemon's process environment at use time.
Values are milliseconds.

| Bound | Env var | Default | What it covers |
| --- | --- | --- | --- |
| Agent inactivity | `OD_CHAT_RUN_INACTIVITY_TIMEOUT_MS` | 600000 (10 min), capped at 24 h | The stall watchdog. The agent produced no new output for this long. A runtime def may set a tighter per-agent default; the env var wins. |
| ACP request | `OD_ACP_TIMEOUT_MS` | per call site | One ACP JSON-RPC request to an agent that speaks the agent-client protocol. |
| ACP stage | `OD_ACP_STAGE_TIMEOUT_MS` | per call site | One startup stage (initialize, authenticate, session/new) of an ACP agent. |
| Remotion finishing pass | `OD_REMOTION_FINISH_MAX_MS` | 900000 (15 min), floor 60000 | One budget shared by every stage of a storyboard finish: audio probe/convert, whisper install and transcribe, bundle, `selectComposition`, `renderMedia`. Each stage draws from the same remaining pool. |
| Codex image generation | `OD_CODEX_IMAGEGEN_TIMEOUT_MS` | 300000 (5 min) | One `codex` image-generation subprocess. |
| Critique round / total | `OD_CRITIQUE_PER_ROUND_TIMEOUT_MS`, `OD_CRITIQUE_TOTAL_TIMEOUT_MS` | per call site | The critique loop. |

`ffprobe` and `ffmpeg` children of the Remotion finishing pass are spawned
through `apps/daemon/src/storyboards/remotion/spawn-with-timeout.ts`. On expiry
they get `SIGTERM`, escalating to `SIGKILL` after `KILL_ESCALATION_MS` (2000) —
an abandoned encoder would otherwise keep burning CPU after the request has
already failed. Several other daemon subprocesses (media, previews, cover
rendering, connection tests) follow the same escalate-after-timeout shape.

A run stopped by one of these budgets reports cause `timeout` or
`inactivity_timeout` and shows as **Timed out** in the chat.

## Limits MishMash does not set

**Memory has no MishMash budget.** A heavy encode or a large download is bounded
only by the machine. When the kernel's OOM killer (Linux) or the memory monitor
(macOS) ends a child, the process dies on `SIGKILL`, which is reported either as
the signal name or as **exit code 137** (128 + 9) when a shell or a reaped
process group renders it. `apps/daemon/src/run-failure-classification.ts` maps
both shapes to the same cause, so 137 never falls into the anonymous
`exit_code` bucket.

MishMash does send `SIGKILL` itself, but only as the escalation step of a
timeout or a cancellation it already started — never unprompted. A kill with no
preceding MishMash timeout is therefore the operating system.

**This applies to the agent's own process.** A subprocess the agent spawns
inside its turn — the ffmpeg encode in the report is the example — dies without
the daemon ever seeing it; the agent notices the failed command and reports it
in its own words, which the failure alert shows verbatim under the named cause.
The run-level classification only fires when the agent process itself is killed.

A run that ends that way reports cause `signal_killed` and shows as **Stopped by
your system**, with copy that names the exit code and the likely causes; this
page documents the limits behind it. It is not a MishMash bug report; it is a
machine that ran out of headroom.

What to do about it:

- Split the heavy step. Encode in segments, download in parts.
- Lower the output size. A 1080p re-encode of a long clip is the common trigger.
- Close other memory-heavy applications and re-run.
- Raise the container's memory limit when running the daemon under Docker.

**Disk has no MishMash budget either.** A child that fills the volume fails with
its own error text, which the alert shows verbatim under the named cause.

## Where a killed run's evidence goes

- Per-run event log: the daemon mirrors the SSE stream to a JSONL file whose
  path derives from the resolved data root (see **Daemon data directory
  contract** in the root `AGENTS.md`). `ChatRunStatusResponse.eventsLogPath`
  reports it for a given run.
- `od run info <runId>` prints the step, the cause, whether files changed, and
  the resume command. `--json` gives the raw record.
- `od anomalies` holds the anomaly log, which records daemon-side 5xx/timeout
  observations. See the **Anomaly log** section of the root `AGENTS.md`.
