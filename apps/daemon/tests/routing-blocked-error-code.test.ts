// Amendment 2, item 1 (WR wave) -- the HTTP half.
//
// `ROUTING_BLOCKED` landed in packages/contracts/src/errors.ts with Amendment 1
// but nothing emitted it: the daemon kept reporting a routing refusal as
// 'FORBIDDEN', the code reserved for authorization failures. The two are
// genuinely different -- a blocked dispatch means the caller was entitled to
// the operation and POLICY refused it -- and conflating them tells an operator
// to go fix permissions for a problem that lives in routing-policy.json.
//
// The dispatch sites report over SSE, where no HTTP status is involved
// (routing-dispatch-server.test.ts covers that path end to end). This file
// covers the other half: `statusForError` answers 500 for any code missing from
// its table, so a code declared in the shared contract with no mapping is a
// latent "policy refused your request" -> "the server crashed" bug for the
// first endpoint that ever returns it over HTTP.

import { describe, expect, it } from 'vitest';

import { statusForError } from '../src/http/response.js';

describe('ROUTING_BLOCKED maps to a status that means "policy refused", not "server broke"', () => {
  it('is 422, not the unmapped-code 500 default', () => {
    expect(statusForError({ code: 'ROUTING_BLOCKED', message: 'no candidate lane' })).toBe(422);
  });

  it('stays distinct from the authorization refusal it used to be reported as', () => {
    const routing = statusForError({ code: 'ROUTING_BLOCKED', message: 'no candidate lane' });
    const authorization = statusForError({ code: 'FORBIDDEN', message: 'not your project' });

    expect(authorization).toBe(403);
    expect(routing).not.toBe(authorization);
  });
});
