/**
 * Design Browser frame-check contract.
 *
 * The web Studio embeds external sites in a plain cross-origin `<iframe>`
 * (the Electron `<webview>` host was removed from this fork). Sites that send
 * `X-Frame-Options` or a CSP `frame-ancestors` directive refuse that embed and
 * the browser renders an empty frame with no scriptable error. The daemon
 * therefore preflights the response headers server-side and the panel renders
 * an explicit blocked state instead of a silent blank pane.
 */

export type DesignBrowserFrameCheckRequest = {
  url: string;
};

export type DesignBrowserFrameCheckVerdict =
  | { verdict: 'embeddable'; finalUrl: string }
  | {
      verdict: 'blocked';
      finalUrl: string;
      blockedBy: 'x-frame-options' | 'csp-frame-ancestors';
      /** The offending header value, for diagnostics/telemetry. */
      header: string;
    }
  | { verdict: 'unknown'; finalUrl: string; reason: 'fetch-failed' }
  /** Loopback/non-public targets are embedded without a preflight: they are the
   *  user's own services and the daemon's outbound fetch guard refuses them. */
  | { verdict: 'skipped-local'; finalUrl: string };

export type FrameEmbeddingHeaders = {
  xFrameOptions: string | null;
  contentSecurityPolicy: string | null;
};

type HeaderVerdict =
  | { blocked: false }
  | { blocked: true; blockedBy: 'x-frame-options' | 'csp-frame-ancestors'; header: string };

/**
 * Decide embeddability from response headers the way browsers do:
 * a CSP `frame-ancestors` directive, when present, replaces `X-Frame-Options`
 * entirely; otherwise `X-Frame-Options` decides. The Studio's embedding origin
 * is a local dev/daemon origin that no real-world allowlist names, so any
 * `frame-ancestors` source list without `*` and any XFO value other than a
 * browser-ignored/invalid one blocks the embed.
 */
export function frameEmbeddingVerdictFromHeaders(headers: FrameEmbeddingHeaders): HeaderVerdict {
  const cspPolicies = (headers.contentSecurityPolicy ?? '')
    .split(',')
    .map((policy) => policy.trim())
    .filter(Boolean);
  const frameAncestorsDirectives: string[] = [];
  for (const policy of cspPolicies) {
    for (const directive of policy.split(';')) {
      const trimmed = directive.trim();
      if (/^frame-ancestors(\s|$)/i.test(trimmed)) frameAncestorsDirectives.push(trimmed);
    }
  }

  if (frameAncestorsDirectives.length > 0) {
    // Every policy carrying the directive must allow us (CSP composes as an
    // intersection). `*` is the only source that can match a local origin.
    const allowsAll = frameAncestorsDirectives.every((directive) => {
      const sources = directive.replace(/^frame-ancestors/i, '').trim().split(/\s+/).filter(Boolean);
      return sources.includes('*');
    });
    if (allowsAll) return { blocked: false };
    return {
      blocked: true,
      blockedBy: 'csp-frame-ancestors',
      header: frameAncestorsDirectives.join('; '),
    };
  }

  const xfo = (headers.xFrameOptions ?? '').trim();
  if (xfo) {
    // Servers occasionally send a comma-joined list; any recognized blocking
    // token blocks. Unrecognized values are ignored by browsers.
    const tokens = xfo.split(',').map((token) => token.trim().toUpperCase()).filter(Boolean);
    const blocksUs = tokens.some(
      (token) => token === 'DENY' || token === 'SAMEORIGIN' || token.startsWith('ALLOW-FROM'),
    );
    if (blocksUs) return { blocked: true, blockedBy: 'x-frame-options', header: xfo };
  }

  return { blocked: false };
}
