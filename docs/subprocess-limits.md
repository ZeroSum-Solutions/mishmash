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
| Video import size / duration | `OD_VIDEO_IMPORT_MAX_BYTES`, `OD_VIDEO_IMPORT_TIMEOUT_MS` | 2147483648 (2 GiB), 1800000 (30 min) | A Vimeo video-import download (Part 8 F-05). Both the declared `Content-Length` and the streamed byte count are checked against the byte limit; a breach or a timeout ends the job `failed`, naming the limit, and removes the staging temp file. |

`ffprobe` and `ffmpeg` children of the Remotion finishing pass are spawned
through `apps/daemon/src/storyboards/remotion/spawn-with-timeout.ts`. On expiry
they get `SIGTERM`, escalating to `SIGKILL` after `KILL_ESCALATION_MS` (2000) —
an abandoned encoder would otherwise keep burning CPU after the request has
already failed. Previews, cover rendering, and connection tests follow the
same escalate-after-timeout shape through their own call sites. Media jobs
(below) follow it too, but through the media-job substrate's own limit/kill,
not `spawn-with-timeout.ts` — see "Media jobs" for that path.

A run stopped by one of these budgets reports cause `timeout` or
`inactivity_timeout` and shows as **Timed out** in the chat.

## Media jobs

Heavy encode/download work — the client's complaint was a 77s 1080p ffmpeg
re-encode killed at exit 137 with no limit documented and no message — runs as
a background `media_tasks` job (`apps/daemon/src/media/jobs.ts`) instead of
inside the turn (INV-7.6). `POST /api/projects/:id/media/jobs` creates an
`encode` (ffmpeg, preset-selected) or `download` (https URL) job; progress and
the terminal state are read through the same `POST /api/media/tasks/:id/wait`
/ `GET /api/projects/:id/media/tasks` surfaces every other media task uses, so
a caller never needs a fourth polling shape. `POST /api/media/tasks/:id/cancel`
ends a running job with `SIGTERM`, escalating to `SIGKILL` after
`KILL_ESCALATION_MS`, targeting the child's own process group so a forked
ffmpeg helper cannot outlive the daemon's decision to stop it.

Every job is bounded by three env-resolved limits (INV-7.14), read at request
time (so a changed env value takes effect on the next job, not the next daemon
restart) and served verbatim by `GET /api/media/jobs/limits` and `od media
--help`:

| Env var | Default | What it covers |
| --- | --- | --- |
| `OD_MEDIA_JOB_MAX_DURATION_MS` | 1800000 (30 min) | Wall-clock ceiling for one encode/download child. A breach sends the kill above and ends the task `failed` with `error.code: 'LIMIT_EXCEEDED'`, naming the env var and its resolved value. |
| `OD_MEDIA_JOB_MAX_OUTPUT_BYTES` | 2147483648 (2 GiB) | Ceiling on a download's output. Enforced twice: a declared `Content-Length` over the limit rejects before any byte is read, and the streamed byte count is checked as it arrives (the enforcement path when `Content-Length` is absent or understated). |
| `OD_MEDIA_JOB_MAX_CONCURRENT` | 2 | How many encode/download jobs may run at once. A job started while the limit is already saturated ends immediately: the create request itself answers HTTP 429 with `error.code: 'LIMIT_EXCEEDED'` naming `maxConcurrent`. |

Two call sites that used to spawn ffmpeg directly, unbounded, now run through
this substrate (W7-R2-20):

- `apps/daemon/src/storyboards/assemble.ts`'s concat finish mode runs as a
  `concat-copy` media job against the storyboard-media project. The
  `POST /api/storyboards/:id/assemble` route still awaits the job to a
  terminal state and returns synchronously, exactly as before this track —
  its JSON body gains an additive `taskId` so the run is also visible and
  cancellable through the normal wait/cancel routes while it's in flight.
- `skills/hatch-pet/scripts/render_animation_videos.py`'s frame-to-video step
  calls `od media job encode --preset frames-to-mp4 --wait` when `od` is on
  PATH. That script runs stand-alone under a Codex-agent skill harness
  unrelated to the MishMash daemon, so when `od` is NOT on PATH it falls back
  to invoking ffmpeg directly, bounded only by a `subprocess.run(...,
  timeout=OD_MEDIA_JOB_MAX_DURATION_MS / 1000)` floor — not the process-group
  SIGTERM→SIGKILL escalation above. That fallback path is a disclosed gap, not
  full parity with the job substrate.

The daemon's own media-task terminal TTL — how long a `done`/`failed`/
`interrupted` task snapshot stays readable after it ends, including across a
daemon restart via `reconcileMediaTasksOnBoot` — is
`TASK_TTL_AFTER_DONE_MS` (`apps/daemon/src/media/task-store.ts:41-42,141-151`),
10 minutes. A `/wait` or list read for a task past that TTL 404s. Separately,
the client/server poll-timeout clamp: the web client's own per-call `/wait`
request caps at 20s (`registry.ts`'s `waitForMediaTask`), against the server's
25s clamp on the same route (`routes/media.ts`); the CLI's
`pollUntilDoneOrBudget` uses a 4s per-call timeout. None of these three numbers
need to match each other — each is just how long ONE poll call waits before
the caller loops again — but a caller that hits the 20s web clamp against the
25s server clamp will occasionally see the request return `timeoutMs`
early with no new progress, which is expected, not a bug.

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
