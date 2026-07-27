import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Capture-hardening (docket mishmash-docket-1-7): today's incident had a
// second failure mode beyond incomplete capture -- the finishing pass's
// plain-HTTP re-fetch got wholesale 403'd by SiteGround bot protection, which
// *also* started 403-ing headless-fingerprint browsers partway through the
// day (see the rescue's reference implementation,
// .od/projects/157a2e1f.../RECON-v2/browser-mirror-headful.mjs, and its
// NOTES.md). skills/web-clone/scripts/lib/bot-wall.mjs generalizes the
// bot-wall detection mirror-site.mjs already had (an HTML-body challenge-page
// check) to also recognize a specific known bot-mitigation response header
// name (SiteGround's `sg-captcha`, Cloudflare's `cf-mitigated`/`cf-chl-*`),
// and gives the operator an explicit escalation instruction: re-run with
// --headful (real, visible Chrome + AutomationControlled mask + in-page
// fetch()) rather than ever falling back to a plain HTTP re-fetch for
// same-origin assets. Pure status/header/body classification -- no
// fs/network/browser -- so it's unit-testable without Playwright.
//
// Round-2 fix (adversarial review finding F8): the first version treated a
// BARE 403/202 status as sufficient on its own, and matched any header
// *value* containing "challenge"/"captcha" -- both false-positive magnets
// (an ordinary auth 403, a legitimate `202 {"accepted":true}`, or a custom
// `x-note: challenge accepted` header all got misclassified as a bot wall).
// The classifier now requires a known challenge body OR a known challenge
// header *name*; status is no longer a sufficient signal by itself. The
// tests below cover both directions: real challenges still detected, and
// the exact false positives the review found are no longer detected.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const botWallScriptPath = path.join(
  repoRoot,
  'skills',
  'web-clone',
  'scripts',
  'lib',
  'bot-wall.mjs',
);

async function loadBotWall() {
  return (await import(pathToFileURL(botWallScriptPath).href)) as {
    looksLikeBotWallBody: (body: string) => boolean;
    looksLikeBotWallResponse: (input: {
      status?: number;
      headers?: Record<string, string>;
      body?: string;
    }) => boolean;
    headfulEscalationGuidance: (input: { url?: string; status?: number }) => string;
  };
}

describe('bot-wall detection (P... capture-hardening)', () => {
  it('recognizes a 403 response carrying an sg-captcha header as a bot-wall challenge', async () => {
    const { looksLikeBotWallResponse } = await loadBotWall();

    const detected = looksLikeBotWallResponse({
      status: 403,
      headers: { 'sg-captcha': 'challenge', 'content-type': 'text/html' },
      body: '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>',
    });

    expect(detected).toBe(true);
  });

  it('recognizes a 202 challenge-title response with no special header', async () => {
    const { looksLikeBotWallResponse } = await loadBotWall();

    const detected = looksLikeBotWallResponse({
      status: 202,
      headers: { 'content-type': 'text/html' },
      body: '<!doctype html><html><head><title>Just a moment...</title></head></html>',
    });

    expect(detected).toBe(true);
  });

  it('recognizes known challenge-page body signatures directly', async () => {
    const { looksLikeBotWallBody } = await loadBotWall();

    expect(looksLikeBotWallBody('<div id="sgcaptcha-wrapper">solve this</div>')).toBe(true);
    expect(looksLikeBotWallBody('<script>window.__CF$cv$params=1</script><div id="cf-browser-verification">')).toBe(
      true,
    );
  });

  // F8: a bare 403/202 with no header or body signal is NOT sufficient --
  // an ordinary authorization failure returns 403, and a legitimate
  // async-accepted endpoint returns 202, all the time, for reasons that
  // have nothing to do with bot walls.
  it('(F8) does NOT flag a bare 403 with no other signal (ordinary auth failure)', async () => {
    const { looksLikeBotWallResponse } = await loadBotWall();

    expect(looksLikeBotWallResponse({ status: 403, headers: { 'content-type': 'text/plain' }, body: 'Forbidden' })).toBe(
      false,
    );
  });

  it('(F8) does NOT flag a bare 202 with no other signal (legitimate async-accepted response)', async () => {
    const { looksLikeBotWallResponse } = await loadBotWall();

    const detected = looksLikeBotWallResponse({
      status: 202,
      headers: { 'content-type': 'application/json' },
      body: '{"accepted":true}',
    });

    expect(detected).toBe(false);
  });

  it('(F8) does NOT flag a 200 response whose header VALUE merely contains the word "challenge"', async () => {
    const { looksLikeBotWallResponse } = await loadBotWall();

    const detected = looksLikeBotWallResponse({
      status: 200,
      headers: { 'content-type': 'text/html', 'x-note': 'challenge accepted' },
      body: '<!doctype html><html><body>ok</body></html>',
    });

    expect(detected).toBe(false);
  });

  it('does not flag an ordinary 404 with a plain body', async () => {
    const { looksLikeBotWallResponse } = await loadBotWall();

    const detected = looksLikeBotWallResponse({
      status: 404,
      headers: { 'content-type': 'text/plain' },
      body: 'Not Found',
    });

    expect(detected).toBe(false);
  });

  it('does not flag an ordinary 200 page', async () => {
    const { looksLikeBotWallResponse } = await loadBotWall();

    const detected = looksLikeBotWallResponse({
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: '<!doctype html><html><head><title>Welcome</title></head><body>Hi</body></html>',
    });

    expect(detected).toBe(false);
  });

  it('emits guidance telling the operator to re-run with --headful, never a plain HTTP re-fetch', async () => {
    const { headfulEscalationGuidance } = await loadBotWall();

    const guidance = headfulEscalationGuidance({ url: 'https://designbybrandin.com/favicon.ico', status: 202 });

    expect(guidance).toContain('--headful');
    expect(guidance.toLowerCase()).toContain('plain http');
  });
});
