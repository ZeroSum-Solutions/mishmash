#!/usr/bin/env python3
"""Render Codex pet state videos from an atlas using ffmpeg."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

CELL_WIDTH = 192
CELL_HEIGHT = 208
STATES = {
    "idle": (0, [280, 110, 110, 140, 140, 320]),
    "running-right": (1, [120, 120, 120, 120, 120, 120, 120, 220]),
    "running-left": (2, [120, 120, 120, 120, 120, 120, 120, 220]),
    "waving": (3, [140, 140, 140, 280]),
    "jumping": (4, [140, 140, 140, 140, 280]),
    "failed": (5, [140, 140, 140, 140, 140, 140, 140, 240]),
    "waiting": (6, [150, 150, 150, 150, 150, 260]),
    "running": (7, [120, 120, 120, 120, 120, 220]),
    "review": (8, [150, 150, 150, 150, 150, 280]),
}


def checker(size: tuple[int, int], square: int = 16) -> Image.Image:
    image = Image.new("RGB", size, "#ffffff")
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], square):
        for x in range(0, size[0], square):
            if (x // square + y // square) % 2:
                draw.rectangle((x, y, x + square - 1, y + square - 1), fill="#e8e8e8")
    return image


def shell_quote_for_concat(path: Path) -> str:
    return "'" + str(path).replace("'", "'\\''") + "'"


# Same default OD_MEDIA_JOB_MAX_DURATION_MS this repo's daemon resolves
# (apps/daemon/src/media/jobs.ts) — kept in sync manually, since this script
# runs stand-alone under a Codex-agent skill harness with no import path
# back into the TypeScript daemon source.
DEFAULT_OD_MEDIA_JOB_MAX_DURATION_MS = 30 * 60 * 1000


def render_state_via_od_media_job(
    frame_paths: list[Path],
    durations_ms: list[int],
    output: Path,
    scale: int,
) -> bool:
    """Hands the frame sequence to `od media job encode --preset
    frames-to-mp4` instead of invoking ffmpeg directly (W7-R2-20, INV-7.6):
    the daemon's job substrate then owns the process-group SIGTERM/SIGKILL
    escalation and the three OD_MEDIA_JOB_MAX_* limits, instead of this
    script's own unbounded subprocess.run. Returns True on success (the
    output file was written); False on any failure, so the caller falls
    back to the bounded direct-ffmpeg path rather than silently producing
    nothing.
    """
    frames_payload = [
        {"path": str(path), "durationMs": duration_ms}
        for path, duration_ms in zip(frame_paths, durations_ms, strict=True)
    ]
    command = [
        "od",
        "media",
        "job",
        "encode",
        "--preset",
        "frames-to-mp4",
        "--frames",
        json.dumps(frames_payload),
        "--output",
        str(output),
        "--overwrite",
        "--scale",
        f"{CELL_WIDTH * scale}x{CELL_HEIGHT * scale}",
        "--wait",
        "--json",
    ]
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
    except (subprocess.CalledProcessError, OSError):
        return False
    try:
        json.loads(result.stdout.splitlines()[-1]) if result.stdout.strip() else None
    except (json.JSONDecodeError, IndexError):
        pass
    return output.exists()


def render_state(
    atlas: Image.Image,
    state: str,
    row: int,
    durations: list[int],
    output_dir: Path,
    loops: int,
    scale: int,
    ffmpeg: str,
) -> None:
    with tempfile.TemporaryDirectory(prefix=f"codex-pet-{state}-") as temp_raw:
        temp = Path(temp_raw)
        frame_paths: list[Path] = []
        for column in range(len(durations)):
            crop = atlas.crop(
                (
                    column * CELL_WIDTH,
                    row * CELL_HEIGHT,
                    (column + 1) * CELL_WIDTH,
                    (row + 1) * CELL_HEIGHT,
                )
            ).convert("RGBA")
            bg = checker((CELL_WIDTH, CELL_HEIGHT))
            bg.paste(crop, (0, 0), crop)
            frame_path = temp / f"{state}-{column:02d}.png"
            bg.save(frame_path)
            frame_paths.append(frame_path)

        concat_path = temp / f"{state}.ffconcat"
        lines = ["ffconcat version 1.0"]
        sequence: list[tuple[Path, int]] = []
        for _ in range(loops):
            sequence.extend(zip(frame_paths, durations, strict=True))
        for frame_path, duration_ms in sequence:
            lines.append(f"file {shell_quote_for_concat(frame_path)}")
            lines.append(f"duration {duration_ms / 1000:.3f}")
        lines.append(f"file {shell_quote_for_concat(sequence[-1][0])}")
        concat_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

        output = output_dir / f"{state}.mp4"

        # W7-R2-20 (INV-7.6): hand heavy encode work off to the daemon's
        # media-job substrate when `od` is reachable — this script runs
        # stand-alone under a Codex-agent skill harness unrelated to the
        # MishMash daemon process, so `shutil.which` is load-bearing here,
        # not decorative; never assume `od` is on PATH.
        durations_ms = [d for _, d in sequence]
        frame_paths_for_od = [p for p, _ in sequence]
        if shutil.which("od") and render_state_via_od_media_job(frame_paths_for_od, durations_ms, output, scale):
            return

        # Fallback: `od` is not on PATH (or the handoff failed). Still bound
        # this ffmpeg child to the same duration ceiling the daemon's job
        # substrate would apply, so an unbounded encode is never the only
        # limit left on this path — this is a `subprocess.run(timeout=...)`
        # floor only, not the daemon's process-group SIGTERM/SIGKILL
        # escalation (disclosed gap, W7C PR body "Adjacent issues").
        timeout_ms = int(
            os.environ.get("OD_MEDIA_JOB_MAX_DURATION_MS", DEFAULT_OD_MEDIA_JOB_MAX_DURATION_MS)
        )
        print(
            f"od not on PATH — running ffmpeg directly, bounded by a "
            f"{timeout_ms}ms timeout (OD_MEDIA_JOB_MAX_DURATION_MS)"
        )
        command = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_path),
            "-vf",
            f"scale={CELL_WIDTH * scale}:{CELL_HEIGHT * scale}:flags=lanczos,format=yuv420p",
            "-movflags",
            "+faststart",
            str(output),
        ]
        subprocess.run(command, check=True, timeout=timeout_ms / 1000)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("atlas")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--loops", type=int, default=4)
    parser.add_argument("--scale", type=int, default=2)
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg") or "ffmpeg")
    args = parser.parse_args()

    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    with Image.open(Path(args.atlas).expanduser().resolve()) as opened:
        atlas = opened.convert("RGBA")

    for state, (row, durations) in STATES.items():
        render_state(
            atlas,
            state,
            row,
            durations,
            output_dir,
            args.loops,
            args.scale,
            args.ffmpeg,
        )
    print(f"wrote videos to {output_dir}")


if __name__ == "__main__":
    main()
