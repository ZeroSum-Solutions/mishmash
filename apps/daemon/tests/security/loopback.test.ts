// Issue #46: the repo grew four hand-rolled "is this loopback" predicates that
// differ subtly. This spec pins the ONE shared lexical helper the daemon call
// sites now route through: every genuine loopback spelling any of the prior
// variants accepted must be accepted here, and non-loopback hosts (including
// `*.localhost` names that only RESOLVE to loopback) must be rejected —
// resolution is the deliberately separate `validateBaseUrlResolved` variant.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { isLexicalLoopbackHost } from '../../src/security/loopback.js';

test('accepts every genuine loopback spelling the prior variants accepted', () => {
  const loopback = [
    'localhost',
    'LOCALHOST',
    'localhost.', // FQDN trailing dot
    'localhost..', // multi trailing dot (mcp-config normalizeHost behavior)
    '127.0.0.1',
    '127.5.5.5', // whole 127/8
    '::1',
    '[::1]', // WHATWG URL hostname keeps brackets for IPv6
    '0:0:0:0:0:0:0:1', // expanded ::1 (connectors/routes + local-daemon-request)
    '::ffff:127.0.0.1', // IPv4-mapped, dotted (mcp-config)
    '::ffff:7f00:1', // IPv4-mapped, hex groups — URL-canonical form (mcp-config)
    '[::ffff:7f00:1]',
  ];
  for (const host of loopback) {
    assert.equal(isLexicalLoopbackHost(host), true, `${host} is loopback`);
  }
});

test('rejects non-loopback hosts, including names that merely resolve to loopback', () => {
  const notLoopback = [
    'app.localhost', // resolves to 127.0.0.1 but is NOT lexically loopback
    'localhost.evil.com',
    '127.evil.com', // not a dotted quad
    '128.0.0.1',
    '126.255.255.255',
    '10.0.0.1',
    '0.0.0.0',
    '::2',
    '::ffff:10.0.0.1', // mapped, but not loopback
    'example.com',
    '',
  ];
  for (const host of notLoopback) {
    assert.equal(isLexicalLoopbackHost(host), false, `${host} is not loopback`);
  }
});

test('coerces non-string input safely (local-daemon-request accepted unknown)', () => {
  assert.equal(isLexicalLoopbackHost(undefined), false);
  assert.equal(isLexicalLoopbackHost(null), false);
  assert.equal(isLexicalLoopbackHost(42 as unknown), false);
});
