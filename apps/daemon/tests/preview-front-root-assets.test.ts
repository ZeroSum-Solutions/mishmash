import { afterEach, describe, expect, it } from 'vitest';

import type { PreviewInfo } from '@open-design/contracts';

import { announcePreviewOnRequestHost } from '../src/preview-origin.js';

/**
 * What the announcement has to admit about the front it was read through
 * (issue #158, decision D-14).
 *
 * A preview page asks for its own assets by site root (`/_nuxt/entry.js`),
 * and the daemon answers those from the referring preview — but only for
 * requests that reach the daemon. Under `tools-dev` the front is the Next dev
 * server, which forwards `/api`, `/artifacts` and `/frames` and nothing else
 * (`apps/web/next.config.ts`), so a root-absolute asset stops there and the
 * page half-renders. The daemon knows which of those two it is, because
 * `tools-dev` hands it the web front's port, so the announcement carries the
 * answer instead of leaving the panel to present the link as unconditionally
 * working.
 */

const SESSION: PreviewInfo = {
  id: 'pv1',
  projectId: 'p1',
  pid: 4242,
  port: 8125,
  url: 'http://127.0.0.1:8125/',
  command: ['npm', 'run', 'dev'],
  cwd: '/tmp/p1',
  startedAt: 1700000000000,
  status: 'ready',
} as PreviewInfo;

function announced(headers: Record<string, string>): Record<string, unknown> {
  return announcePreviewOnRequestHost(SESSION, headers) as unknown as Record<string, unknown>;
}

describe('a preview announcement names what its front can serve', () => {
  const previousWebPort = process.env.OD_WEB_PORT;

  afterEach(() => {
    if (previousWebPort === undefined) delete process.env.OD_WEB_PORT;
    else process.env.OD_WEB_PORT = previousWebPort;
  });

  it('says the development front cannot serve root-absolute assets', () => {
    // The tools-dev shape: the browser is on the Next dev server, whose
    // /api/* rewrite hands the daemon its own upstream Host.
    process.env.OD_WEB_PORT = '17622';
    expect(announced({ origin: 'http://localhost:17622', host: '127.0.0.1:17621' })
      .frontServesRootAbsoluteAssets).toBe(false);
    // Same read on a same-origin GET, where a browser sends Referer, not Origin.
    expect(announced({ referer: 'http://localhost:17622/projects/p1', host: '127.0.0.1:17621' })
      .frontServesRootAbsoluteAssets).toBe(false);
  });

  it('says the daemon front can, in the runtime where the daemon IS the front', () => {
    delete process.env.OD_WEB_PORT;
    expect(announced({ host: '127.0.0.1:7456' }).frontServesRootAbsoluteAssets).toBe(true);
    expect(announced({ origin: 'https://devins-macbook-pro.tail908c18.ts.net:7443', host: '127.0.0.1:7456' })
      .frontServesRootAbsoluteAssets).toBe(true);
  });

  it('says a caller that reached the daemon directly can, dev front or not', () => {
    // `od preview list` talks to the daemon's own port; nothing is in front.
    process.env.OD_WEB_PORT = '17622';
    expect(announced({ host: '127.0.0.1:17621' }).frontServesRootAbsoluteAssets).toBe(true);
  });

  it('fails closed when a development front is running and the caller cannot be placed', () => {
    process.env.OD_WEB_PORT = '17622';
    expect(announced({}).frontServesRootAbsoluteAssets).toBe(false);
  });

  it('leaves the announced URL alone', () => {
    process.env.OD_WEB_PORT = '17622';
    expect(announced({ origin: 'http://localhost:17622', host: '127.0.0.1:17621' }).url)
      .toBe('http://localhost:17622/api/projects/p1/previews/pv1/proxy/');
  });
});
