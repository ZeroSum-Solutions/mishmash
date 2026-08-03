import type { Express, Request, Response as ExpressResponse } from 'express';

import {
  frameEmbeddingVerdictFromHeaders,
  isBlockedExternalApiHostname,
  isLoopbackApiHost,
  type DesignBrowserFrameCheckVerdict,
} from '@open-design/contracts';

import { fetchExternalBrandAsset } from '../brands/safe-fetch.js';

const FRAME_CHECK_TIMEOUT_MS = 8_000;

export type DesignBrowserRoutesDeps = {
  /** Injectable for tests; production uses the SSRF-guarded external fetch. */
  fetchExternal?: (url: string, init?: RequestInit) => Promise<Response>;
};

function isNonPublicTarget(parsed: URL): boolean {
  const host = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  return isLoopbackApiHost(host) || isBlockedExternalApiHostname(host);
}

export function registerDesignBrowserRoutes(app: Express, deps: DesignBrowserRoutesDeps = {}): void {
  const fetchExternal = deps.fetchExternal ?? fetchExternalBrandAsset;

  app.post('/api/design-browser/frame-check', async (req: Request, res: ExpressResponse) => {
    const url = (req.body as { url?: unknown } | null | undefined)?.url;
    if (typeof url !== 'string' || url.length === 0) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      res.status(400).json({ error: 'invalid url' });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.status(400).json({ error: 'unsupported protocol' });
      return;
    }

    // Loopback/private targets are the user's own services: the outbound guard
    // refuses them and local pages do not send framing headers, so embed as-is.
    if (isNonPublicTarget(parsed)) {
      const verdict: DesignBrowserFrameCheckVerdict = { verdict: 'skipped-local', finalUrl: url };
      res.json(verdict);
      return;
    }

    let response: Response;
    try {
      response = await fetchExternal(url, {
        method: 'GET',
        signal: AbortSignal.timeout(FRAME_CHECK_TIMEOUT_MS),
        headers: { accept: 'text/html,*/*;q=0.8' },
      });
    } catch {
      const verdict: DesignBrowserFrameCheckVerdict = {
        verdict: 'unknown',
        finalUrl: url,
        reason: 'fetch-failed',
      };
      res.json(verdict);
      return;
    }

    // Headers are all we need; drop the body without downloading it.
    if (response.body) await response.body.cancel().catch(() => {});

    const finalUrl = response.url || url;
    const headerVerdict = frameEmbeddingVerdictFromHeaders({
      xFrameOptions: response.headers.get('x-frame-options'),
      contentSecurityPolicy: response.headers.get('content-security-policy'),
    });
    const verdict: DesignBrowserFrameCheckVerdict = headerVerdict.blocked
      ? { verdict: 'blocked', finalUrl, blockedBy: headerVerdict.blockedBy, header: headerVerdict.header }
      : { verdict: 'embeddable', finalUrl };
    res.json(verdict);
  });
}
