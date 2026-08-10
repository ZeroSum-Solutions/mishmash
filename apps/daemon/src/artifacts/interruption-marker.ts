// Issue #37: interrupting a generation turn mid-stream can SIGTERM the agent
// between (or inside) its chunked file writes, persisting an HTML artifact
// that is silently truncated — broken in the preview, yet indistinguishable
// from a completed artifact in the Design Files panel.
//
// The invariant this module supports, enforced at the run-terminal chokepoint
// in server.ts: a canceled run must not leave a truncated HTML artifact
// unmarked. Marking is deliberately SYNCHRONOUS (adversarial review of the
// first cut): the append must land before finish() publishes the terminal SSE
// frame, otherwise a client observing 'end' can read the artifact unmarked —
// or a follow-up run can rewrite the file to a healthy state before a
// detached append lands, stamping a false marker onto a completed artifact.
// On the user-cancel path the child has already exited when the finalize hook
// runs (cancel() waits for child exit before finish()), so the sync write
// cannot race the agent; the caller skips marking when the child is still
// alive (daemon-shutdown cancellation). The direct appendFileSync is a
// deliberate entry in filesystem/legacy-write-inventory.json — the async
// write gateway cannot run inside the sync one-shot finalize hook.
//
// Deliberately NOT rollback (partial content has value — the issue's repro
// artifact was hand-repaired later) and NOT a whole-file rewrite (appending
// preserves every byte the agent managed to write). Complete-looking files
// are left byte-identical, so an interrupt that lands after a finished edit
// does not graffiti a healthy artifact.

import fs from 'node:fs';

export const INTERRUPTED_ARTIFACT_MARKER_PREFIX = '<!-- od:interrupted-generation';

// Reading is bounded: generated single-file artifacts are small (tens of KB);
// anything larger is skipped rather than slurped at the terminal chokepoint.
const MAX_MARKABLE_BYTES = 4 * 1024 * 1024;

// A generated single-file HTML artifact ends with a closing </html>. A stream
// cut mid-write (the issue's repro ended inside an inline <script>) does not.
// Valid HTML may legally omit </html>, so this is a heuristic — acceptable
// because it only runs for artifacts a *canceled* run touched, and the marker
// says "may be truncated", not "is broken".
export function htmlArtifactLooksTruncated(content: string): boolean {
  return !content.toLowerCase().includes('</html>');
}

// The marker comment appended to a truncated artifact. Machine-detectable via
// INTERRUPTED_ARTIFACT_MARKER_PREFIX (a future UI badge can grep for it) and
// human-readable for anyone opening the file.
function interruptionMarkerFor(runId: string): string {
  return (
    `\n${INTERRUPTED_ARTIFACT_MARKER_PREFIX} run=${runId} — ` +
    'generation was interrupted before this artifact finished; content may be truncated -->\n'
  );
}

// From the paths a canceled run touched (RunArtifactDiff.touchedPaths), return
// the HTML artifacts that look cut off mid-stream and do not already carry a
// marker. Sync and read-only, best-effort per file — an unreadable or vanished
// file is skipped, never thrown.
export function findTruncatedRunHtmlArtifacts(touchedPaths: readonly string[]): string[] {
  const truncated: string[] = [];
  for (const filePath of touchedPaths) {
    const lower = filePath.toLowerCase();
    if (!lower.endsWith('.html') && !lower.endsWith('.htm')) continue;
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > MAX_MARKABLE_BYTES) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes(INTERRUPTED_ARTIFACT_MARKER_PREFIX)) continue; // already marked
      if (!htmlArtifactLooksTruncated(content)) continue;
      truncated.push(filePath);
    } catch {
      // Best-effort: detection must never break run finalization.
    }
  }
  return truncated;
}

export interface MarkInterruptedRunArtifactsInput {
  // Absolute paths the canceled run created or modified (RunArtifactDiff.touchedPaths).
  touchedPaths: readonly string[];
  runId: string;
}

// Stamp truncated-looking HTML artifacts from a canceled run with the marker
// comment, synchronously (see the module docblock for why sync). Best-effort
// per file — a failed append is skipped, never thrown. Returns the paths that
// were marked.
export function markInterruptedRunArtifacts(input: MarkInterruptedRunArtifactsInput): string[] {
  const marked: string[] = [];
  for (const filePath of findTruncatedRunHtmlArtifacts(input.touchedPaths)) {
    try {
      fs.appendFileSync(filePath, interruptionMarkerFor(input.runId));
      marked.push(filePath);
    } catch {
      // Best-effort: marking must never break run finalization.
    }
  }
  return marked;
}
