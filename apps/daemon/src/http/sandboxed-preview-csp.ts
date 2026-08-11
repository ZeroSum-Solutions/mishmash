/**
 * Shared CSP for sandboxed-iframe preview surfaces that render
 * externally-styled HTML (design-library preview-asset, library asset
 * /file serving). These surfaces show single-file mockups and captures
 * whose styling comes from CDN runtime JIT (cdn.tailwindcss.com),
 * external fonts, and hotlinked images, so external https subresources
 * are allowed (Devin approved this egress 2026-08-10, MM-019/MM-020).
 * Consumers embed these documents ONLY in sandboxed iframes without
 * `allow-same-origin` (opaque origin).
 *
 * `connect-src` deliberately excludes `'self'`: CSP is computed from the
 * DOCUMENT URL, not the iframe's opaque sandbox origin, so `'self'` would
 * let a scripted `fetch('/api/...')` inside previewed HTML reach this
 * loopback daemon's own API. Sibling subresources (CSS/img/script/font)
 * load via their own `-src` directives, none of which need `connect-src`.
 *
 * This is NOT the policy for agent-generated project raw files —
 * `projectRawFileCsp` in `server.ts` stays strict and network-free.
 * Tighten or loosen this policy in one place only; the per-route tests
 * pin the exact header string.
 */
export const SANDBOXED_PREVIEW_CSP = [
  "default-src 'self' data: blob:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline' https:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
  "connect-src https:",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');
