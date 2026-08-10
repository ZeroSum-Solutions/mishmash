#!/usr/bin/env node
// Static hardening check for design-templates/scroll-film-hero/example.html.
//
// Verifies the five non-negotiable hardening properties a scroll-film
// template must ship (see .claude/skills/scroll-film-studio/SKILL.md):
//   (a) prefers-reduced-motion: a CSS media query AND a JS matchMedia gate
//       that early-returns BEFORE any motion-library init call.
//   (b) noscript/js-class-gate: a non-trivial <noscript> backstop (a real
//       CSS rule affecting visibility/height, not placeholder text) AND at
//       least one CSS rule scoped under a `.js` selector that sets an
//       initial hidden state — proving hidden states apply only once JS
//       confirms motion is safe.
//   (c) zero external resource loads: no http(s):// in any src=/href=/url()
//       reference; only data: URIs, in-page #fragments, and mailto: links.
//   (d) resize/refresh handling: a resize AND an orientationchange listener
//       whose own call body (not just "somewhere in the file") invokes
//       ScrollTrigger.refresh().
//   (e) a viewport <meta> tag.
//   (f) no unscoped hidden state: no rule OUTSIDE a `.js` selector (and
//       outside the reduced-motion backstop block, whose job is to UNDO
//       hidden states) sets opacity:0 or visibility:hidden as an
//       initial/default state — that would break the no-JS render.
//
// No dependencies — node:fs and hand-rolled scanning only. All regex
// matching runs on comment-stripped text so a defect hidden in a comment
// can't produce a false pass. Exit 0 when every check passes.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'design-templates/scroll-film-hero/example.html');

if (!existsSync(TARGET)) {
  console.error(`FAIL: target file not found: ${path.relative(ROOT, TARGET)}`);
  process.exit(1);
}

const rawHtml = readFileSync(TARGET, 'utf8');

// ---------------------------------------------------------------------------
// Comment stripping — applied before every regex check so a defect that
// only "passes" because it's sitting inside a comment is caught, and a
// legitimate rule that only "fails" because a nearby comment confuses a
// naive regex is not falsely flagged.
// ---------------------------------------------------------------------------
function stripBlockComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '');
}
// Strips `// ...` to end of line, but a `//` immediately preceded by `:`
// (as in `https://`) is protected — this file has no such literals in JS,
// but the guard costs nothing and prevents a real URL from being read as
// a comment.
function stripLineComments(s: string): string {
  return s.replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function stripHtmlComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, '');
}

const html = stripHtmlComments(rawHtml);

function extractFirst(text: string, re: RegExp): string {
  const m = text.match(re);
  return m ? (m[1] ?? '') : '';
}
function extractAll(text: string, re: RegExp): string[] {
  return [...text.matchAll(re)].map((m) => m[1] ?? '');
}

// The head-level synchronous gate script and the body motion script are
// both inline <script> tags (no src=) — concatenate in document order so
// "gate before init" checks see the real execution order.
const scriptBodies = extractAll(html, /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi);
const styleBodyRaw = extractFirst(html, /<style[^>]*>([\s\S]*?)<\/style>/i);
const noscriptBodyRaw = extractFirst(html, /<noscript[^>]*>([\s\S]*?)<\/noscript>/i);

const js = stripLineComments(stripBlockComments(scriptBodies.join('\n')));
const css = stripBlockComments(styleBodyRaw);
const noscriptContent = stripBlockComments(noscriptBodyRaw);

type CheckResult = { id: string; label: string; pass: boolean; detail: string };

const results: CheckResult[] = [];
function check(id: string, label: string, pass: boolean, detail: string): void {
  results.push({ id, label, pass, detail });
}

// ---------------------------------------------------------------------------
// Small balanced-bracket helpers — used to extract a whole call expression
// (so nested callbacks are included) rather than trusting a regex to guess
// where a statement ends.
// ---------------------------------------------------------------------------
function findMatchingParen(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}
function findMatchingBrace(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// (a) prefers-reduced-motion: CSS media query + JS matchMedia gate that
//     early-returns before any motion-library init call.
// ---------------------------------------------------------------------------
const reducedMotionCssRe = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/i;
const hasReducedMotionCss = reducedMotionCssRe.test(css);

const reducedMotionJsRe = /matchMedia\(\s*['"`][^'"`]*prefers-reduced-motion[^'"`]*reduce[^'"`]*['"`]\s*\)/i;
const hasReducedMotionJs = reducedMotionJsRe.test(js);

// The gate must actually SHORT-CIRCUIT before motion init: find the first
// occurrence of a reduced-motion (or js-class) gate followed shortly by a
// `return`, and confirm it precedes the first motion-library init call.
const gateWithReturnRe =
  /(?:matchMedia\([^)]*prefers-reduced-motion[^)]*\)[^;]*\.matches|!\s*html\.classList\.contains\(\s*['"]js['"]\s*\))[\s\S]{0,160}?\breturn\b/;
const gateMatch = js.match(gateWithReturnRe);
const initMarkerRes = [/loadScript\(/, /gsap\.registerPlugin/, /new\s+Lenis\(/];
let earliestInitIdx = Infinity;
for (const re of initMarkerRes) {
  const idx = js.search(re);
  if (idx !== -1) earliestInitIdx = Math.min(earliestInitIdx, idx);
}
const gateIdx = gateMatch ? (gateMatch.index ?? -1) : -1;
const earlyReturnBeforeInit = gateIdx !== -1 && gateIdx < earliestInitIdx;

check(
  'a',
  'prefers-reduced-motion (CSS media query + JS matchMedia gate)',
  hasReducedMotionCss && hasReducedMotionJs,
  `css=${hasReducedMotionCss} js=${hasReducedMotionJs}`,
);
check(
  'a2',
  'reduced-motion/js-class gate early-returns before motion-library init',
  earlyReturnBeforeInit,
  earlyReturnBeforeInit
    ? `gate at char ${gateIdx} precedes first init marker at char ${earliestInitIdx}`
    : `gateIdx=${gateIdx} earliestInitIdx=${earliestInitIdx === Infinity ? 'none found' : earliestInitIdx}`,
);

// ---------------------------------------------------------------------------
// (b) noscript non-trivial backstop + .js-scoped initial hidden-state rule
// ---------------------------------------------------------------------------
const hasNoscript = /<noscript[\s>]/i.test(rawHtml);
// Non-trivial = contains an actual CSS declaration touching visibility or
// layout height, not just a dummy selector. A placeholder like
// `.js-only{display:none !important;}` with nothing else does NOT satisfy
// this on its own unless it also carries enough real content — the length
// floor plus the property-name requirement together rule out one-line
// no-op stand-ins.
const noscriptHasRealRule =
  /\{[^}]*\b(opacity|visibility|display|height|min-height|clip-path|transform)\s*:\s*[^;{}]+;[^}]*\}/i.test(
    noscriptContent,
  ) && noscriptContent.replace(/\s+/g, '').length > 40;

const jsScopedRuleRe = /((?:^|[},])\s*[^{}]*\.js[^{}]*)\{([^{}]*)\}/g;
let jsGateFound = false;
let m: RegExpExecArray | null;
while ((m = jsScopedRuleRe.exec(css))) {
  const selector = m[1] ?? '';
  const body = m[2] ?? '';
  if (!/\.js\b/.test(selector)) continue;
  if (
    /(opacity\s*:\s*0\b|visibility\s*:\s*hidden|display\s*:\s*none|clip-path\s*:\s*inset\(0 0 100% 0\)|transform\s*:\s*translateY)/i.test(
      body,
    )
  ) {
    jsGateFound = true;
    break;
  }
}
check(
  'b',
  'noscript is a real backstop (non-trivial rule) + .js-scoped initial hidden-state pattern',
  hasNoscript && noscriptHasRealRule && jsGateFound,
  `noscript=${hasNoscript} nonTrivialRule=${noscriptHasRealRule} jsGatedHiddenRule=${jsGateFound}`,
);

// ---------------------------------------------------------------------------
// (c) zero external URLs — only data: / # / mailto: allowed
// ---------------------------------------------------------------------------
const refRe = /(?:\bsrc|\bhref)\s*=\s*"([^"]*)"|url\(\s*(['"]?)([^'")]*)\2\s*\)/gi;
const externalRefs: string[] = [];
let r: RegExpExecArray | null;
while ((r = refRe.exec(html))) {
  const value = (r[1] ?? r[3] ?? '').trim();
  if (value === '') continue;
  if (/^https?:\/\//i.test(value)) externalRefs.push(value);
}
check(
  'c',
  'zero external URLs in src/href/url()',
  externalRefs.length === 0,
  externalRefs.length === 0 ? 'no http(s):// references found' : `found: ${externalRefs.join(', ')}`,
);

// ---------------------------------------------------------------------------
// (d) resize AND orientationchange handlers whose own call body invokes
//     ScrollTrigger.refresh() — not just "refresh appears somewhere".
// ---------------------------------------------------------------------------
type HandlerCheck = { found: boolean; invokesRefresh: boolean };

function handlerInvokesRefresh(eventName: string): HandlerCheck {
  const callRe = new RegExp(`addEventListener\\(\\s*['"]${eventName}['"]`);
  const startMatch = js.match(callRe);
  if (!startMatch || startMatch.index === undefined) return { found: false, invokesRefresh: false };
  const callStart = startMatch.index;
  const openParenIdx = js.indexOf('(', callStart);
  if (openParenIdx === -1) return { found: true, invokesRefresh: false };
  const closeParenIdx = findMatchingParen(js, openParenIdx);
  if (closeParenIdx === -1) return { found: true, invokesRefresh: false };
  const callBody = js.slice(openParenIdx, closeParenIdx + 1);
  return { found: true, invokesRefresh: /\.refresh\s*\(/.test(callBody) };
}
const resizeCheck = handlerInvokesRefresh('resize');
const orientationCheck = handlerInvokesRefresh('orientationchange');
check(
  'd',
  'resize AND orientationchange handlers each invoke ScrollTrigger.refresh() in their own call body',
  resizeCheck.found && resizeCheck.invokesRefresh && orientationCheck.found && orientationCheck.invokesRefresh,
  `resize: found=${resizeCheck.found} refreshInBody=${resizeCheck.invokesRefresh}; ` +
    `orientationchange: found=${orientationCheck.found} refreshInBody=${orientationCheck.invokesRefresh}`,
);

// ---------------------------------------------------------------------------
// (e) viewport meta tag
// ---------------------------------------------------------------------------
const hasViewportMeta = /<meta\s+name=["']viewport["']\s+content=["'][^"']+["']/i.test(html);
check('e', 'viewport <meta> tag present', hasViewportMeta, `present=${hasViewportMeta}`);

// ---------------------------------------------------------------------------
// (f) no unscoped hidden-state rule outside `.js` — reject any rule whose
//     selector does NOT contain `.js` but whose body sets opacity:0 or
//     visibility:hidden as an initial/default state. The reduced-motion
//     backstop block exists specifically to UNDO hidden states (restore
//     visibility with values like opacity:1), so it's excluded from this
//     scan by construction — its declarations never match the blacklist
//     below, which only looks for the "0"/"hidden" hiding direction, not
//     the restoring direction.
// ---------------------------------------------------------------------------
function stripMatchingMediaBlock(text: string, queryRe: RegExp): string {
  const idx = text.search(queryRe);
  if (idx === -1) return text;
  const openBraceIdx = text.indexOf('{', idx);
  if (openBraceIdx === -1) return text;
  const closeBraceIdx = findMatchingBrace(text, openBraceIdx);
  if (closeBraceIdx === -1) return text;
  return text.slice(0, idx) + text.slice(closeBraceIdx + 1);
}
const cssForHazardScan = stripMatchingMediaBlock(css, /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/i);

const hazardRe = /opacity\s*:\s*0\b(?!\.)|visibility\s*:\s*hidden/i;
const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
const unscopedHazards: string[] = [];
let ruleMatch: RegExpExecArray | null;
while ((ruleMatch = ruleRe.exec(cssForHazardScan))) {
  const selector = (ruleMatch[1] ?? '').trim();
  const body = ruleMatch[2] ?? '';
  if (/\.js\b/.test(selector)) continue; // properly gated
  if (hazardRe.test(body)) {
    unscopedHazards.push(`${selector.slice(0, 60)} { ${body.trim().slice(0, 60)} }`);
  }
}
check(
  'f',
  'no unscoped opacity:0/visibility:hidden initial state outside a .js selector',
  unscopedHazards.length === 0,
  unscopedHazards.length === 0 ? 'no unscoped hazards found' : `found: ${unscopedHazards.join(' | ')}`,
);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
let allPass = true;
for (const res of results) {
  const status = res.pass ? 'PASS' : 'FAIL';
  if (!res.pass) allPass = false;
  console.log(`[${status}] (${res.id}) ${res.label} — ${res.detail}`);
}
console.log(allPass ? '\nAll hardening checks passed.' : '\nOne or more hardening checks failed.');
process.exit(allPass ? 0 : 1);
