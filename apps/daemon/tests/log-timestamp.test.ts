// W8C item 1: every daemon log line, when the process boots through
// `startDaemonRuntime`, must carry a leading `[<ISO-8601 UTC>]` token. The
// wrap point is `apps/daemon/src/log-timestamp.ts`'s `installUtcLogTimestamps`,
// installed once at the top of `startDaemonRuntime` (see
// `daemon-startup.ts:118`). This file is new on this branch, so the two
// tests below split the claim in two:
//   - "today, a raw console call carries no prefix at all" is TRUE on base
//     BY CONSTRUCTION (nothing wraps `console` today) — see the note on
//     that test below; it stays green on both base and branch.
//   - "after installing the wrap, a call through the wrapped target carries
//     the prefix, and installing twice does not double it" needs the new
//     module and is RED on base (the module does not exist yet — a real
//     import-resolution failure, not a manufactured one; see 8C-red-spec.txt).
import { describe, expect, it } from 'vitest';

// A fake Console-shaped target (per the brief's suggested pattern) instead of
// monkey-patching the real global `console`, so this test cannot leak a
// wrapped `console.warn` into any other test file sharing the process.
let capturedCalls: unknown[][];

function makeTarget() {
  capturedCalls = [];
  const record = (...args: unknown[]) => capturedCalls.push(args);
  return {
    log: record,
    info: record,
    warn: record,
    error: record,
    debug: record,
  } as unknown as Console;
}

describe('installUtcLogTimestamps', () => {
  it('VERIFIED on base: a raw console.warn call today carries no timestamp prefix', () => {
    // This is true on base by construction -- nothing wraps `console` yet,
    // so calling it directly is exactly what every one of the ~1000 existing
    // call sites already does. Kept as a companion assertion (not the red
    // itself) so the fix's behavioural delta is visible by contrast: the
    // NEXT test shows the same call, through the wrap, gaining a prefix.
    const target = makeTarget();
    target.warn('x', { y: 1 });
    expect(capturedCalls).toEqual([['x', { y: 1 }]]);
  });

  it('prefixes every wrapped call with a bracketed ISO-8601 UTC token and never double-prefixes', async () => {
    // RED on base: `../src/log-timestamp.js` does not exist yet -- this
    // dynamic import rejects with a module-not-found error. That failure is
    // scoped to this one test (the file's other test still runs and passes),
    // and is disclosed plainly in the red-spec proof rather than treated as
    // the whole story.
    const { installUtcLogTimestamps } = await import('../src/log-timestamp.js');

    const target = makeTarget();
    installUtcLogTimestamps(target);
    target.warn('x', { y: 1 });

    expect(capturedCalls).toHaveLength(1);
    const [prefix, ...rest] = capturedCalls[0]!;
    expect(typeof prefix).toBe('string');
    expect(prefix as string).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]$/);
    expect(rest).toEqual(['x', { y: 1 }]);

    // Calling install twice on the same target must not double-wrap: one
    // more call still gets exactly one prefix token.
    installUtcLogTimestamps(target);
    target.error('again');
    expect(capturedCalls).toHaveLength(2);
    const [secondPrefix, ...secondRest] = capturedCalls[1]!;
    expect(secondPrefix as string).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]$/);
    expect(secondRest).toEqual(['again']);
  });
});
