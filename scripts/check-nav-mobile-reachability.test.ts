import assert from "node:assert/strict";
import test from "node:test";

import { findNavMobileReachabilityViolations } from "./check-nav-mobile-reachability.ts";

// Minimal reproduction of the real defect this checker exists to catch
// (see design-templates/AGENTS.md-adjacent evidence in the follow-up
// issue): a five-link <nav> whose only non-"Contact" links vanish below
// 760px, with no hamburger, disclosure, or any other affordance in the
// document. This is the exact selector/media-query shape shipped in the
// generated artifact.
const HALDEN_ROE_FIXTURE = `<!doctype html>
<html>
<head>
<style>
.nav{ display: flex; gap: 16px; }
.nav a{ font-size: 12px; }
@media (max-width: 760px){ .nav a:not(.nav__last){ display: none; } }
</style>
</head>
<body>
<header class="site-head">
  <a class="wordmark" href="#top">Halden &amp; Roe</a>
  <nav class="nav" aria-label="Sections">
    <a href="#works">Works</a>
    <a href="#approach">Approach</a>
    <a href="#services">Services</a>
    <a href="#clients">Clients</a>
    <a href="#contact" class="nav__last">Contact</a>
  </nav>
</header>
</body>
</html>`;

test("flags the shipped defect: nav collapses to one link below 760px with no replacement", () => {
  const violations = findNavMobileReachabilityViolations(HALDEN_ROE_FIXTURE);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.totalLinks, 5);
  assert.equal(violations[0]?.reachableLinks, 1);
  assert.equal(violations[0]?.tier, 1);
});

test("passes once a disclosure affordance is added, same hiding CSS otherwise unchanged", () => {
  const fixed = HALDEN_ROE_FIXTURE.replace(
    "<a class=\"wordmark\" href=\"#top\">Halden &amp; Roe</a>",
    "<a class=\"wordmark\" href=\"#top\">Halden &amp; Roe</a>\n" +
      "  <button class=\"nav-toggle\" aria-expanded=\"false\" aria-controls=\"mobile-menu\">Menu</button>",
  );
  assert.deepEqual(findNavMobileReachabilityViolations(fixed), []);
});

test("passes when the nav has only two links regardless of what CSS does to them", () => {
  const html = `<style>@media (max-width: 760px){ .nav a{ display: none; } }</style>
<nav class="nav"><a href="#a">A</a><a href="#b">B</a></nav>`;
  assert.deepEqual(findNavMobileReachabilityViolations(html), []);
});

test("passes when the hiding rule still leaves two or more links reachable", () => {
  const html = `<style>@media (max-width: 760px){ .nav a:not(.k1):not(.k2){ display: none; } }</style>
<nav class="nav">
  <a href="#a">A</a><a href="#b">B</a>
  <a href="#c" class="k1">C</a><a href="#d" class="k2">D</a>
</nav>`;
  assert.deepEqual(findNavMobileReachabilityViolations(html), []);
});

test("catches the mobile-first authoring direction (hidden by default, restored at min-width)", () => {
  const html = `<style>
.nav-links{ display:none; }
@media (min-width: 768px){ .nav-links{ display:flex; } }
</style>
<nav class="nav-links">
  <a href="#a">A</a><a href="#b">B</a><a href="#c">C</a>
</nav>`;
  const violations = findNavMobileReachabilityViolations(html);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.reachableLinks, 0);
  assert.equal(violations[0]?.tier, 2);
});

test("passes the mobile-first shape once any generic replacement signal is present in the document", () => {
  const html = `<style>
.nav-links{ display:none; }
@media (min-width: 768px){ .nav-links{ display:flex; } }
</style>
<nav class="nav-links">
  <a href="#a">A</a><a href="#b">B</a><a href="#c">C</a>
</nav>
<button class="hamburger" aria-label="Menu"></button>`;
  assert.deepEqual(findNavMobileReachabilityViolations(html), []);
});

test("checkbox-hack menus count as a replacement mechanism", () => {
  const html = `<style>@media (max-width: 760px){ .nav a:not(.first){ display: none; } }</style>
<input type="checkbox" id="menu-check">
<label for="menu-check">Menu</label>
<nav class="nav">
  <a href="#a" class="first">A</a><a href="#b">B</a><a href="#c">C</a>
</nav>`;
  assert.deepEqual(findNavMobileReachabilityViolations(html), []);
});

test("<details>-based menus count as a replacement mechanism", () => {
  const html = `<style>@media (max-width: 760px){ .nav a:not(.first){ display: none; } }</style>
<details><summary>Menu</summary><a href="#x">X</a></details>
<nav class="nav">
  <a href="#a" class="first">A</a><a href="#b">B</a><a href="#c">C</a>
</nav>`;
  assert.deepEqual(findNavMobileReachabilityViolations(html), []);
});

test("ignores unrelated display:none rules outside any @media, and pseudo-element selectors", () => {
  const html = `<style>
.nav-links::-webkit-scrollbar{ display:none; }
.totally-unrelated{ display:none; }
</style>
<nav class="nav-links">
  <a href="#a">A</a><a href="#b">B</a><a href="#c">C</a>
</nav>`;
  assert.deepEqual(findNavMobileReachabilityViolations(html), []);
});

test("ignores a desktop-range max-width query outside the mobile/tablet band", () => {
  const html = `<style>@media (max-width: 1400px){ .nav a{ display: none; } }</style>
<nav class="nav"><a href="#a">A</a><a href="#b">B</a><a href="#c">C</a></nav>`;
  assert.deepEqual(findNavMobileReachabilityViolations(html), []);
});
