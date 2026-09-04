// W2H.1c red spec — D-17 dialogue round 3, blocking finding 2. What makes the
// producer injection idempotent.
//
// `injectBeforeBodyClose` skipped the injection whenever the response text
// CONTAINED the marker: `if (html.includes(marker)) return html;`. The marker is
// an attribute name, so any document that merely mentions it — in a comment, in
// a script string literal, in prose — was served with no producer at all. The
// route's own rule is that every powered HTML response carries one; without it
// the host watchdog waits out its window and tells the user a preview that
// rendered perfectly did not render.
//
// GPT-5.6 round 3: "a 2.5 MiB (or any) powered document that merely CONTAINS
// the marker text (e.g. inside a comment) receives no producer, contradicting
// 'every powered HTML response' and manufacturing a false 'Preview did not
// render'."
//
// The rule these cases pin: the producer is present when a `<script>` element
// carrying the marker attribute is present as markup — nowhere else — so a
// decoy cannot suppress it and a real one is never duplicated.
import type http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

const MARKER = 'data-od-preview-paint-producer';
const PRODUCER_ELEMENT = `<script ${MARKER}>`;

/** How many producer script elements the served document carries. */
function producerElementCount(html: string): number {
  return html.split(PRODUCER_ELEMENT).length - 1;
}

describe('a marker decoy cannot suppress the preview paint producer', () => {
  let server: http.Server;
  let baseUrl: string;
  const projectId = 'proj-preview-marker-decoy';

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;

    const dir = path.join(process.env.OD_DATA_DIR!, 'projects', projectId);
    await mkdir(dir, { recursive: true });

    // A real oversized preview: past HTML_PREVIEW_BRIDGE_MAX_BYTES, so the
    // optional rewrites are skipped and only the producer path runs.
    await writeFile(
      path.join(dir, 'huge-comment-decoy.html'),
      Buffer.from(
        `<!doctype html><html><body><!-- ${MARKER} --><main>Large Preview</main>` +
          `${'x'.repeat(Math.ceil(2.5 * 1024 * 1024))}</body></html>`,
      ),
    );
    await writeFile(
      path.join(dir, 'literal-decoy.html'),
      Buffer.from(
        `<!doctype html><html><body><script>var m = "${MARKER}";</script>` +
          '<main>Preview</main></body></html>',
      ),
    );
    await writeFile(
      path.join(dir, 'already-producing.html'),
      Buffer.from(
        `<!doctype html><html><body><script ${MARKER}></script>` +
          '<main>Preview</main></body></html>',
      ),
    );
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const poweredUrl = (name: string) => `${baseUrl}/api/projects/${projectId}/powered/${name}`;

  it('injects the producer into a 2.5 MiB document that mentions the marker in a comment', async () => {
    const res = await fetch(poweredUrl('huge-comment-decoy.html'));
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html.length).toBeGreaterThan(2.5 * 1024 * 1024);
    expect(
      producerElementCount(html),
      'commented-out marker text is not a producer; the document must still get one',
    ).toBe(1);
  });

  it('injects the producer into a document that mentions the marker in a script literal', async () => {
    const res = await fetch(poweredUrl('literal-decoy.html'));
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(
      producerElementCount(html),
      'marker text inside a string literal is script data, not a producer element',
    ).toBe(1);
  });

  it('does not add a second producer to a document that already carries one', async () => {
    const res = await fetch(poweredUrl('already-producing.html'));
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(
      producerElementCount(html),
      'a document that already carries the producer element keeps exactly one',
    ).toBe(1);
  });
});
