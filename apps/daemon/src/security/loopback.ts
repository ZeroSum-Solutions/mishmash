// Issue #46: one shared loopback predicate with explicit, documented variants.
//
// The repo had four hand-rolled "is this loopback" checks that differed subtly
// (mcp-config.ts, connectors/routes.ts, http/local-daemon-request.ts, and the
// contracts-level isLoopbackApiHost). Security-relevant predicates that gate
// credential egress must not drift independently, so the daemon-side call
// sites now route through this module.
//
// Two variants exist, and each call site must choose deliberately:
//
// - LEXICAL (this module): pure string classification of the hostname itself.
//   `app.localhost` is NOT loopback here even though it resolves to 127.0.0.1
//   — a lexical guard whose verdict is consumed later (e.g. a bearer token
//   written into a child's MCP config) must not trust DNS, or a rebinding
//   TOCTOU reopens the hole the guard closed (PR #44 review, finding 2).
//
// - RESOLVED: `validateBaseUrlResolved` in apps/daemon/src/connectionTest.ts,
//   layered on contracts' `isLoopbackApiHost` + a DNS lookup, pinned by
//   apps/daemon/tests/connection-test.test.ts. Use it only where the daemon
//   itself performs the connection immediately after the check.
//
// The canonical lexical primitive is contracts' `isLoopbackApiHost` (pure TS,
// pinned by PR #36's specs). This wrapper adds only the spellings and input
// coercion the prior daemon variants collectively accepted:
//
// - `0:0:0:0:0:0:0:1` — the expanded ::1 (never produced by `new URL()`, but
//   accepted by the former connectors/routes + local-daemon-request checks
//   for raw, non-URL-parsed callers).
// - non-string input coerces to `false` instead of throwing (the former
//   local-daemon-request signature accepted `unknown`).
//
// `isLoopbackPeerAddress` in http/local-daemon-request.ts stays separate on
// purpose: it classifies socket peer ADDRESSES (always IP literals, never
// hostnames), a different input domain than a URL hostname.

import { isLoopbackApiHost } from '@open-design/contracts/api/connectionTest';

export function isLexicalLoopbackHost(hostname: unknown): boolean {
  if (typeof hostname !== 'string' || !hostname) return false;
  // Contracts' isLoopbackApiHost already normalizes brackets, case, and FQDN
  // trailing dots; the expanded-::1 spelling is the one form it does not know.
  const stripped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (stripped.toLowerCase().replace(/\.+$/, '') === '0:0:0:0:0:0:0:1') return true;
  return isLoopbackApiHost(hostname);
}
