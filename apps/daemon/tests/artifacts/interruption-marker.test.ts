// Red spec for issue #37: interrupting a generation turn mid-stream persists
// the in-progress HTML artifact as a silently truncated file — nothing in the
// file distinguishes it from a completed artifact.
//
// The invariant under test: after a canceled run, every HTML artifact the run
// touched that looks truncated (no closing </html>) gets a visible marker
// appended synchronously, complete artifacts are left byte-identical, and
// marking is idempotent because a marked file is no longer detected.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import {
  INTERRUPTED_ARTIFACT_MARKER_PREFIX,
  findTruncatedRunHtmlArtifacts,
  htmlArtifactLooksTruncated,
  markInterruptedRunArtifacts,
} from '../../src/artifacts/interruption-marker.js';

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'od-interruption-marker-'));
}

const TRUNCATED_HTML = [
  '<!DOCTYPE html>',
  '<html>',
  '<body>',
  '<script>',
  // Verbatim cut point from issue #37's repro artifact.
  "document.getElementById('print-card').add",
].join('\n');

const COMPLETE_HTML = '<!DOCTYPE html>\n<html><body>done</body></html>\n';

test('htmlArtifactLooksTruncated: mid-stream cut is truncated, closed document is not', () => {
  assert.equal(htmlArtifactLooksTruncated(TRUNCATED_HTML), true);
  assert.equal(htmlArtifactLooksTruncated(COMPLETE_HTML), false);
  // Case-insensitive close tag still counts as complete.
  assert.equal(htmlArtifactLooksTruncated('<HTML><BODY>x</BODY></HTML>'), false);
});

test('a truncated HTML artifact from a canceled run is detected for marking', () => {
  const root = tmpProject();
  const artifact = path.join(root, 'tier-two-bingo-card.html');
  fs.writeFileSync(artifact, TRUNCATED_HTML);

  assert.deepEqual(findTruncatedRunHtmlArtifacts([artifact]), [artifact]);
});

test('marking appends a visible marker that names the run and preserves partial content', () => {
  const root = tmpProject();
  const artifact = path.join(root, 'partial.html');
  fs.writeFileSync(artifact, TRUNCATED_HTML);

  const marked = markInterruptedRunArtifacts({ touchedPaths: [artifact], runId: 'run-123' });

  assert.deepEqual(marked, [artifact]);
  const after = fs.readFileSync(artifact, 'utf8');
  assert.ok(after.startsWith(TRUNCATED_HTML), 'existing partial content is preserved');
  assert.ok(after.includes(INTERRUPTED_ARTIFACT_MARKER_PREFIX), 'marker comment is appended');
  assert.ok(after.includes('run-123'), 'marker names the interrupted run');
});

test('a complete HTML artifact touched by a canceled run is left byte-identical', () => {
  const root = tmpProject();
  const artifact = path.join(root, 'finished.html');
  fs.writeFileSync(artifact, COMPLETE_HTML);

  const marked = markInterruptedRunArtifacts({ touchedPaths: [artifact], runId: 'run-123' });

  assert.deepEqual(marked, []);
  assert.equal(fs.readFileSync(artifact, 'utf8'), COMPLETE_HTML);
});

test('marking is idempotent: a second cancel does not stack markers', () => {
  const root = tmpProject();
  const artifact = path.join(root, 'partial.html');
  fs.writeFileSync(artifact, TRUNCATED_HTML);

  markInterruptedRunArtifacts({ touchedPaths: [artifact], runId: 'run-1' });
  const second = markInterruptedRunArtifacts({ touchedPaths: [artifact], runId: 'run-2' });

  assert.deepEqual(second, []);
  const after = fs.readFileSync(artifact, 'utf8');
  const occurrences = after.split(INTERRUPTED_ARTIFACT_MARKER_PREFIX).length - 1;
  assert.equal(occurrences, 1);
});

test('non-HTML artifacts and missing files are skipped without throwing', () => {
  const root = tmpProject();
  const image = path.join(root, 'logo.png');
  fs.writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const gone = path.join(root, 'deleted.html');

  assert.deepEqual(markInterruptedRunArtifacts({ touchedPaths: [image, gone], runId: 'run-1' }), []);
  assert.deepEqual(fs.readFileSync(image), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});
