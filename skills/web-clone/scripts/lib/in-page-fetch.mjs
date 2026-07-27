#!/usr/bin/env node
// in-page-fetch.mjs -- retrieves one asset via a genuine in-page fetch() call
// instead of a standalone HTTP client.
//
// A bot wall keyed on cookies/TLS fingerprint/Referer answers a bare HTTP
// client -- and even a browser-context-level request API that isn't run
// through the page's own JS engine -- with a 403/202 challenge long before it
// would challenge the exact same request fired from inside a page it just
// rendered. This is the technique that recovered the designbybrandin.com
// mirror after its finishing pass's plain-HTTP re-fetch got 403'd wholesale
// (see SKILL.md's bot-wall escalation ladder): `page.evaluate(fetch(...))`
// runs with the real page's cookies, fingerprint, and Referer chain.
//
// Chunks the base64 conversion so a multi-MB asset (a hero video) doesn't
// blow the call stack via a spread into `String.fromCharCode`.
//
// Playwright-dependent (takes a live `page`) -- not unit tested directly;
// lib/bot-wall.mjs (the classification this calls) is unit tested on its own.

import { looksLikeBotWallResponse } from "./bot-wall.mjs";

/**
 * @param {import('playwright').Page} page - a live page already navigated to
 *   the target origin (its cookies/session are what make this work).
 * @param {string} url - absolute URL to fetch.
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, status?: number, contentType?: string, body?: Buffer, error?: string }>}
 */
export async function fetchInPage(page, url, { timeoutMs = 60000 } = {}) {
  let evalResult;
  try {
    evalResult = await page.evaluate(
      async ({ target, timeoutMs: innerTimeoutMs }) => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), innerTimeoutMs);
          const response = await fetch(target, {
            credentials: "include",
            cache: "no-cache",
            referrer: location.href,
            signal: controller.signal,
          });
          const buf = await response.arrayBuffer();
          clearTimeout(timer);
          const bytes = new Uint8Array(buf);
          const chunkSize = 0x8000;
          let binary = "";
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
          }
          const headers = {};
          for (const [key, value] of response.headers.entries()) headers[key] = value;
          return {
            ok: response.ok,
            status: response.status,
            contentType: response.headers.get("content-type") || "",
            headers,
            bytesB64: binary ? btoa(binary) : "",
          };
        } catch (error) {
          return { ok: false, status: 0, error: String(error) };
        }
      },
      { target: url, timeoutMs },
    );
  } catch (error) {
    return { ok: false, error: error.message };
  }

  if (!evalResult.ok) {
    return { ok: false, status: evalResult.status, contentType: evalResult.contentType, error: evalResult.error };
  }

  const body = evalResult.bytesB64 ? Buffer.from(evalResult.bytesB64, "base64") : Buffer.alloc(0);
  // A challenge answers 200 for the interstitial page itself just as often as
  // it answers 403/202 for the blocked request, so check the body/headers
  // even on an `ok` response before trusting it as the real asset.
  if (
    looksLikeBotWallResponse({
      status: evalResult.status,
      headers: evalResult.headers,
      body: body.toString("utf8", 0, Math.min(body.length, 4096)),
    })
  ) {
    return { ok: false, status: evalResult.status, contentType: evalResult.contentType, error: "bot-wall-challenge" };
  }

  return { ok: true, status: evalResult.status, contentType: evalResult.contentType, body };
}
