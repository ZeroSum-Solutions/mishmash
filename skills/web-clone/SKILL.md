---
name: web-clone
en_name: Website Clone
description: >
  Website cloning / reproduction methodology. USE WHEN the user says clone
  website, reproduce site, copy this site, make one like this, reproduce a
  specific page effect, port this site over and make it mine, clone a
  specific interaction/WebGL/Canvas/Three.js effect. Provides a portable
  decision tree of "get the real source first -> pick a path -> reverse
  engineer -> build the project -> swap content", covering three main
  branches (static sites / React-Vue-Next content sites / WebGL-Canvas
  heavy-frontend sites), and forces verification of any executable code
  from a secondhand AI analysis.
triggers:
  - "clone website"
  - "reproduce site"
metadata:
  author: jane (xiaoer)
  version: "1.6.0"
  use_case: Personal local site cloning/learning, distilled from a website-clones hub
od:
  mode: prototype
  scenario: web-clone
  surface: web
  design_system:
    requires: false
---

# Web Clone · Website Cloning Methodology

Turn "clone a website" into a repeatable process. In Open Design, work inside the current project directory by default: `NOTES.md`, `RECON/`, `CLONE_REPORT.md`, `CLONE_AUDIT.md`, and the final previewable `index.html` should all be written inside the current project unless the user explicitly names an external working directory.

**Open Design environment prep (check before running anything under `scripts/`)**:
- This skill's scripts are staged into the project at `.od-skills/<plugin-dir>/scripts/` (the exact path is in the skill frontmatter). Commands in this doc that read `node scripts/xxx.mjs` resolve against that path, e.g. `node .od-skills/<plugin-dir>/scripts/recon-site.mjs ...`; outputs such as `RECON/`, `assets/` still go to the project root.
- The scripts depend on Playwright. Before first running them in a project, run `npm install -D playwright` once (at the project root); if Chrome is installed locally the scripts auto-use `channel:"chrome"` and no browser download is needed — otherwise run `npx playwright install chromium`. **Never skip the scripts and eyeball it instead just because "the environment isn't set up"** — installing the dependency takes a minute.

## Rule #1: Real source code above all — never trust AI-guessed code

> Any AI-generated "clone analysis / build blueprint" — **the prose conceptual skeleton can be a reference, but its executable code blocks default to fabricated** and must be checked line-by-line against real source code, or copying it verbatim will break.

**Evidence (the marbles case)**: an AI analysis doc took the original site's real architecture — "solve ray-sphere intersection analytically, encode the optical result into a displacement map, and hand it to SVG's `feDisplacementMap` to distort the real DOM" — and fabricated it into "ray-marching + SDF + treating the DOM as a texture sample". Two completely different implementations; copying the fabricated one cannot reproduce the effect and is N times slower. See `references/marbles-case.md`.

So the first move is always: **get the real source code**.

## Decision tree (follow in order, don't skip steps)

### Step 0 · Build the standard project skeleton first

```bash
node scripts/init-clone.mjs <site-name> --url <original-site-URL> --in-place
```

This script creates `NOTES.md`, `RECON/screenshots/` inside the current project, so you never miss a deliverable by hand.

### Step 1 · Search GitHub for the source first — don't rush to scrape

```bash
unset SSL_CERT_FILE   # macOS quirk, unset before running bash
# search by site/product name
SSL_CERT_FILE=/etc/ssl/cert.pem gh api "search/repositories?q=<keyword>" \
  | jq -r '.items[] | "\(.full_name) ⭐\(.stargazers_count) \(.description)"' | head -10
# the URL slug of a vercel.app/netlify.app/github.io site is often the repo name / deployer username
```
- Single-file site (github.io / plain HTML) -> just fetch raw: `curl -sL https://raw.githubusercontent.com/<user>/<repo>/main/index.html`
- **Found the source and the license allows it -> skip to Step 4 and clone directly.** Lesson learned: searching GitHub first saves 30 minutes of detours.

### Step 2 · No source found -> browser reconnaissance (probes)

Use available browser automation or Playwright to run probes and extract signals (framework / `window.THREE` / canvas count / smooth-scroll library / fonts / scrollHeight). Take screenshots at 1440/768/390 plus recon JSON, saved to `RECON/`.

Prefer the built-in scripts for standard recon:

```bash
node scripts/recon-site.mjs \
  --url <original-site-URL> \
  --out RECON \
  --label original

# Scrolls the full page in a real browser and pulls every image/font/media asset the
# page actually uses (including third-party CDN and hotlink-protected assets) to
# local disk, generating assets/fonts/fonts.css (self-hosted @font-face) plus a
# URL->local-path mapping.
node scripts/asset-harvest.mjs \
  --url <original-site-URL> \
  --recon RECON/original-recon.json \
  --out assets \
  --manifest RECON/asset-manifest.json

node scripts/network-capture.mjs \
  --url <original-site-URL> \
  --out RECON/network \
  --label original

node scripts/route-crawl.mjs \
  --url <original-site-URL> \
  --out RECON/routes \
  --label original \
  --max-pages 25 \
  --max-depth 2

node scripts/interaction-probe.mjs \
  --url <original-site-URL> \
  --out RECON/interactions \
  --label original

node scripts/sourcemap-hunt.mjs \
  --recon RECON/original-recon.json \
  --out RECON/sourcemaps
```

> Logged-in private sites need the browser context already logged in on the current machine; for localhost / logged-out public sites, prefer the Playwright probes.

### Step 2.5 · Grade complexity first — don't overpromise blindly

Based on the recon results, write a "pre-clone assessment": complexity L1-L6, recommended mode (faithful clone / visual clone / content overhaul), expected reproducible scope, and what will explicitly not be cloned. Grading and scoring rules are in `references/assessment.md`.

**Mode-selection discipline (the default when the user hasn't confirmed)**: when the user says "clone/reproduce this website", the default is **faithful clone** — fidelity is the primary goal in this scenario. Never unilaterally downgrade to a visual clone, swap in placeholder branding, or replace real photography with layout blocks just because "the original is a commercial site / has copyrighted content" — the user will immediately notice "the images weren't pulled, the fonts are wrong, the colors don't match". The correct move is to **do the faithful clone properly first** (real images, real fonts, real color values, all in place), write any copyright/trademark risk into the "replace-before-deploy checklist" in NOTES.md, and leave the actual swap to Step 6, at the user's discretion. Only switch to visual clone / content overhaul once the user explicitly wants "my own site / rebranded". Likewise, **never skip the scripted recon just because "the target is a risk-sensitive SPA"** — `recon-site.mjs`/`asset-harvest.mjs` use a real browser; run them first, and only downgrade (with an honest note) if they genuinely fail.

**If the mode is "visual clone" or "content overhaul"** -> also produce a structured design identity `design-dna.json`, turning "the feel of that site" into a versionable, comparable token spec, so Step 6's "keep the DNA, swap the content" has something to work from:

```bash
node scripts/dna-scaffold.mjs \
  --recon RECON/original-recon.json \
  --out   RECON/design-dna.json \
  --name  "<site-name>"
```

The script best-effort prefills fonts/color candidates/framework effect signals from recon; the rest needs manual analysis. The three-axis structure (design_system / design_style / visual_effects), full schema, and applicability boundaries are in `references/design-dna.md`.
> ⚠️ **Don't use DNA on the "faithful clone" branch**: real source code is the ground truth — don't let an "approximate style" DNA dilute the byte-for-byte rule.

### Step 3 · Pick the path based on recon results

| Recon result | Path to take |
|---|---|
| Static HTML/CSS, no framework | `wget --mirror` to mirror it -> strip tracking scripts -> edit copy |
| React / Vue / Next (content-driven) | Rebuild the template (e.g. `ai-website-cloner-template`, Node 24+), pour in content |
| SPA / SaaS / data-driven page | Run `network-capture.mjs` first to save API fixtures -> stand in a local JSON/mock server |
| Multi-page marketing site / product site | Run `route-crawl.mjs` first to map routes -> extract a template per page type -> uniformly swap content |
| Complex interactive site | Run `interaction-probe.mjs` first to record hover/click/scroll/canvas-drag state -> fill in interactions by state, don't just screenshot the fold |
| **WebGL / Canvas / Three.js heavy frontend** | **Deep-reverse the real source (see below) -> faithful clone, or find a similar open-source 3D template and swap content**. Single-file native sites can often be kept byte-for-byte = the most faithful clone. **When real source can't be found, fall back to runtime frame capture + a baseline gate**, discipline in `references/effect-extraction.md` (can delegate to web-shader-extractor) |
| **Static-build site (Astro/Vite SSG/Hugo) with heavy WebGL** | **`mirror-site.mjs` fully mirrors the deployed assets -> self-host fonts + strip tracking -> serve locally from a static web root = real source, 1:1 faithful clone**. For static sites, "get the real source" = "mirror the whole deployed asset set". Recipe in `references/static-mirror.md`. Example: oryzo.ai (Lusion, L6, gaussian splatting, hero pixel diff 5/5) |
| Site built on an off-the-shelf open-source theme (Astro/Hugo theme) | Find the source theme in the matching theme marketplace (**only for sites literally using a stock theme**; customized sites go to the full-mirror row above, not this one) |

L4-L6 complex sites should follow `references/complex-playbooks.md`, not the ordinary marketing-site flow.

### Mandatory recipe for the static-mirror path: capture → finish → verify

A clone built via `mirror-site.mjs` is not done until it clears a mechanical gate — a stalled or partial capture must never be reported as a finished clone or served to the user. Three steps, in order, every time:

1. **Capture** — `node scripts/mirror-site.mjs --url <URL> --out <dir>`. Start headless (the default). If a headless run reports a bot-wall signature (a challenge-page body signature such as a "Just a moment" title, or a specific known bot-mitigation response header name — SiteGround's `sg-captcha`, Cloudflare's `cf-mitigated`/`cf-chl-*` — see `lib/bot-wall.mjs`; a bare 403/202 status alone is deliberately NOT treated as sufficient, since ordinary auth failures and legitimate async-accepted responses use those same codes), it prints an explicit escalation instruction: re-run the **exact same command with `--headful` added**. Headful launches a real, visible Chrome (`channel:"chrome"`, `--disable-blink-features=AutomationControlled`, `navigator.webdriver` masked) and retrieves missed assets via genuine in-page `fetch()` — real cookies/fingerprint/Referer are what clears a challenge that already 403'd a headless session. (If real Chrome itself fails to launch, `lib/playwright-loader.mjs` falls back to Playwright's bundled Chromium in headful mode and prints an explicit warning — it never silently claims real Chrome ran when it didn't.) **Never fall back to a plain HTTP re-fetch (`curl`, a bare `fetch`/`axios` script, etc.) for same-origin assets** — that is what got a mirror wholesale 403'd in the incident this hardening responds to; a plain HTTP client is *less* trusted by these bot walls than even a headless browser, let alone a headful in-page fetch.
2. **Finish** — self-host third-party fonts, strip tracking, per `references/static-mirror.md`'s manual wrap-up. `rewrite-mirror.mjs` (absolute → local references) and `clamp-scroll-animation-overflow.mjs` (scroll-linked overflow) already ran automatically at the end of the capture step; this is the remaining manual work.
3. **Verify** — `node scripts/verify-mirror.mjs --site <dir>/site --baseline <dir>/mirror-baseline-metrics.json`. **This gate MUST exit 0 before the clone may be reported complete or served to the user.** It serves the mirror on an ephemeral local port, headless-loads it at each captured viewport with a stepped scroll pass, and fails on: any same-origin failed/404 request, any request that leaked back to the mirror's original live origin (the mirror is silently still proxying the live site), any broken image, `scrollWidth`/`scrollHeight` drifting more than 5% from the capture-time baseline, or a runtime global/count (`window.Lenis`, `window.THREE`, canvas/image/video counts) the baseline recorded that the clone doesn't reproduce. A failing gate means the clone is not finished — go back to step 1 or 2, do not report completion around it.
   **Clamp vs. baseline contract:** the scroll-animation-overflow clamp (step 2) deliberately makes a clamped mirror's `scrollWidth` *different* from the raw live-page baseline — that is the fix working, not drift (a site with this bug reads e.g. `6025px` live/unclamped vs. `~1441px` clamped, at a 1440px viewport). When `mirror-site.mjs` applies the clamp, it re-measures the clamped local mirror once per viewport and records that as `expectedScrollWidth` on the baseline entry; the gate checks a clamped mirror against THAT value instead of the raw baseline. When nothing was clamped, no `expectedScrollWidth` is recorded and the gate checks (and can still fail) against the raw baseline exactly as before. See `lib/gate-decision.mjs`'s docblock for the full contract.

### Step 4 · Build the project in the current workspace

```bash
# The current Open Design project directory is the clone workspace.
pwd
# Git source: clone into source/ or place directly in the current directory; single-file: drop it in.
# Keep one read-only baseline copy of the original source as index-original.html
# Check the Node version (package.json engines), nvm use the right version, pin .nvmrc
```

### Step 5 · Strip tracking + write metadata + verify

- **Strip tracking**: Google Analytics (`gtag` / `googletagmanager`), pixels, heatmaps — remove precisely, line by line (the GA block is usually near the top of `<head>`).
- **Open Design preview adaptation**: before delivery, project-root asset references must be rewritten to relative paths, or `/reference-assets/...` will resolve against the Open Design app root inside the file preview instead of the bare HTML:

```bash
node scripts/od-preview-rewrite.mjs --project .
```

- **Write NOTES.md** (required): complexity, clone mode, original-vs-clone comparison, fidelity score, known gaps. Template in `references/deliverables.md`.
- **Complex sites: write TEARDOWN.md** (technical teardown). Every conclusion must cite a real source line number.
- **Post-clone scoring**: score structure / visual / interaction / responsive / content-swap / functional completeness per `references/assessment.md`. Scores must be backed by screenshots, source, and run results.
- **Real browser verification** (hard requirement — never say "should work" from reading code alone): start a local server -> open in browser -> capture console (no JS/WebGL compile errors allowed) -> screenshot against the original. Honestly note anything that couldn't be verified (e.g. a synthetic PointerEvent with `isTrusted=false` can't trigger a drag — write that down truthfully, don't fake a "drag succeeded").

After the clone is complete, run recon on the clone site once more and generate an automatic comparison report:

```bash
node scripts/recon-site.mjs \
  --url http://127.0.0.1:<port>/ \
  --out RECON \
  --label clone

node scripts/route-crawl.mjs \
  --url http://127.0.0.1:<port>/ \
  --out RECON/routes-clone \
  --label clone \
  --max-pages 25 \
  --max-depth 2

node scripts/interaction-probe.mjs \
  --url http://127.0.0.1:<port>/ \
  --out RECON/interactions-clone \
  --label clone

node scripts/compare-recon.mjs \
  --original RECON/original-recon.json \
  --clone RECON/clone-recon.json \
  --visual-diff RECON/visual-diff-1440.json \
  --original-routes RECON/routes/original-route-map.json \
  --clone-routes RECON/routes-clone/clone-route-map.json \
  --original-interactions RECON/interactions/original-interactions.json \
  --clone-interactions RECON/interactions-clone/clone-interactions.json \
  --out CLONE_REPORT.md

node scripts/visual-diff.mjs \
  --original RECON/screenshots/original-1440.png \
  --clone RECON/screenshots/clone-1440.png \
  --out RECON/visual-diff-1440.json \
  --diff RECON/screenshots/visual-diff-1440.png

# --recon + --strict: hard gates on font/image/color fidelity, exits 2 on a real
# defect — fix and rerun; do not deliver until it passes.
node scripts/audit-clone.mjs \
  --project . \
  --brand "<original site brand name>" \
  --recon RECON/original-recon.json \
  --strict \
  --out CLONE_AUDIT.md
```

## Asset and color fidelity (hard gates — violating these = a failed clone)

The most common way a clone goes wrong isn't structure — it's **wrong fonts, missing images, eyeballed colors**. The following three rules are non-negotiable and `audit-clone.mjs --recon --strict` checks them mechanically:

1. **Fonts must be self-hosted real font files — no system-font approximations.**
   Original-site font files are almost always on a third-party CDN (Typekit / Google Fonts / the brand's own CDN) with hotlink protection — so they must be pulled with `asset-harvest.mjs --url` (real browser network stack), not a bare curl. The `assets/fonts/fonts.css` output already rewrites @font-face to local paths; the page just does `<link rel="stylesheet" href="assets/fonts/fonts.css">`, then copies `font-family` verbatim from the recon JSON's `palette.*.fontFamily` / `fontFaces[].family` values. Writing a `-apple-system` / `"Helvetica Neue"` fallback chain in place of the original site's custom font is an automatic fail.
2. **Images must be real local files — no gradient/SVG placeholders standing in.**
   `asset-harvest.mjs --url` scrolls the full page and pulls every lazy-loaded image, srcset variant, and CSS background image per `asset-manifest.json` (originalUrl -> localPath) into `assets/images/`. When building the page, swap in references mechanically per the manifest; if a specific image fails to download, fall back to `--recon` or fish it out of the `RECON/network` capture — only use a placeholder as a last resort, and note it in NOTES.md.
3. **Colors must be copied from recon's computed values — no eyeballing.**
   `RECON/original-recon.json`'s `palette` (computed backgroundColor/color/borderColor for body/header/nav/main/footer/buttons) and `rootVariables` are the answer key; `original-summary.md` also has a summary. Copy these values directly into CSS variables — if the footer is `rgb(17,17,17)`, write `#111111`, not an eyeballed `#0a0a0a` that "looks about right".
4. **Scroll feel must match — don't settle for default native scrolling.**
   Recon's `frameworks` (lenis / gsap detection) plus `motion` (`htmlScrollBehavior` / scroll-snap rule count / sticky·fixed element count) is the original site's scroll recipe: if the original uses an inertial smooth-scroll library, match it (Lenis, etc.) or an equivalent; if it has `scroll-snap`, reproduce the snap; align sticky nav, parallax, and scroll-triggered animation one by one. When verifying, use `interaction-probe.mjs`'s scroll-sequence screenshots against the original — mid-scroll states (sticky-nav shadow, animation trigger points) should match too.

### Step 6 · Swap in the user's own content

The goal is always "make the user's own site", not port over an identical copy. The three things to swap: text (`index.html`/`data/*.json`/`content/*.md`), media (`public`/`assets`), and brand colors (CSS variables / Tailwind theme). Write REPLACE_GUIDE.md if the structure is non-trivial.

**If a `design-dna.json` was produced (visual/overhaul mode)**: this step is where it pays off — **keep the DNA, swap the content**. Turn `design_system` into CSS custom properties, make subjective calls per `design_style`, and pick an implementation tier by `visual_effects.effect_intensity` (lightweight CSS / medium Canvas+GSAP / heavy Three.js); prefer real images pulled by `asset-harvest.mjs` over AI-repainted approximations. Generation flow in `references/design-dna.md`.

## Reverse-engineering a WebGL/Canvas heavy frontend (the core craft)

Break the interactive site into **technical pillars** and locate the real implementation for each, citing line numbers: rendering (WebGL/shader algorithm), compositing (SVG filter / multiple canvases / post-processing), physics, interaction, audio. Only then check any secondhand analysis against it.

**Three disciplines when reverse-engineering an effect** (to prevent "polish it as you extract it, and it ends up neither looking right nor explainable"):
1. **Grade the evidence**: tag every conclusion `SOURCE` (real source/source-map/runtime dump/frame capture), `PARTIAL` (name/fragment only, unproven), or `GUESS` (visual fit/magic number). **Untagged = GUESS; it must be upgraded to SOURCE before you copy it.**
2. **No compensation**: never mask a timing/coordinate/state bug by tweaking brightness/speed/position/noise; a fitted value stays tagged GUESS, with a note on what evidence would upgrade it.
3. **Baseline-first gate**: first build a "minimal, faithful RAW REPLAY" using the real draw calls/shaders/uniforms -> pass a frame-by-frame comparison -> **only then** is engineering refactor allowed.
See `references/effect-extraction.md` (includes runtime-capture fallback and when to delegate to web-shader-extractor) for details.

**Transferable advanced patterns** (worth keeping in your back pocket):
- **Displacement-map refraction of the DOM**: an offscreen WebGL pass computes a "displacement map" (RG = displacement, B = Fresnel), then SVG's `<filter><feDisplacementMap scale=N>` uses it to distort the real, live, interactive HTML — it refracts the actual DOM, and WebGL never touches DOM pixels directly. This is the soul of the marbles effect, and something Three.js's `MeshPhysicalMaterial(transmission)` cannot do (it can only give you "the look of a glass sphere", not "refract the entire web page").

For the full method plus a line-by-line teardown of marbles' real architecture -> `references/reverse-engineering.md`, `references/marbles-case.md`.

## License and attribution (check before cloning)

```bash
SSL_CERT_FILE=/etc/ssl/cert.pem gh api repos/<u>/<r> | jq '.license'  # + look for a LICENSE file + read the README
```

| License | What's allowed |
|---|---|
| MIT / Apache / BSD / Unlicense | Modify and ship it, keep attribution |
| **NONE (no LICENSE file / unstated)** | **All rights reserved by default**. Local learning/cloning only, must attribute the original author, **do not redeploy publicly without permission**. Don't treat "it's public on GitHub" as free-to-use |
| Proprietary / explicitly forbidden | Read-only study, do not copy or deploy |

⚠️ Don't equate "it's public on GitHub" or "gh api couldn't find it right away" with MIT — actually verify.

## Deliverable spec
- Every sub-project root: `NOTES.md` (source info/tech stack/license/replacement map/how to run)
- Complex interactive sites, add: `TEARDOWN.md` (technical teardown, with line numbers)
- When reporting externally or evaluating skill quality, add: `CLONE_REPORT.md` (full original-vs-clone comparison)
- Before shipping, add: `CLONE_AUDIT.md` (tracking scripts, original brand/language leftovers, TODOs, external-link risk)
- `RECON/screenshots/`: original-vs-clone comparison images
- If the user has an external clone index, update it as needed; there's no requirement to maintain a global hub README inside the Open Design project.

## Built-in scripts
- `scripts/init-clone.mjs`: initializes the clone project skeleton and `NOTES.md`.
- `scripts/recon-site.mjs`: opens the page with Playwright and scrolls the full page, collecting framework/resource/DOM-structure/console errors, computed colors for key sections (`palette`), @font-face rules, and a manifest of actually-loaded fonts/images, plus three tiers of screenshots.
- `scripts/asset-harvest.mjs`: real browser network stack, scrolls the full page to capture and download every image/font/media asset actually used (including third-party CDN and hotlink-protected assets), generating self-hosted `assets/fonts/fonts.css` @font-face plus an originalUrl->localPath asset manifest.
- `scripts/network-capture.mjs`: captures XHR/fetch requests and saves JSON/text responses, for SPA/SaaS local fixtures.
- `scripts/mirror-site.mjs`: real browser, multi-viewport (1440/768/390) full-page scroll, captures every real request and saves response bodies directly during load -> mirrors same-origin assets by path (including JS-runtime-fetched `.sog/.buf/.wasm/.riv`/fonts), for a 1:1 faithful clone of static-build sites (Astro/Vite SSG/Hugo). Runs recursive in-page `fetch()` rounds for assets the markup/CSS references but no request ever fired for, detects bot-wall responses and prints `--headful` escalation guidance, and writes `mirror-baseline-metrics.json` for the `verify-mirror.mjs` gate. See `references/static-mirror.md` and the "Mandatory recipe" section above.
- `scripts/rewrite-mirror.mjs`: points a mirrored site at its own downloaded assets — rewrites absolute same-origin URLs to local relative paths, but only when the mirrored file actually exists. Runs automatically at the end of `mirror-site.mjs`; also runnable standalone.
- `scripts/clamp-scroll-animation-overflow.mjs`: scopes a horizontal `overflow-x: clip` to Salient/WPBakery scroll-linked parallax rows (`data-scroll-animation="true" data-scroll-animation-movement="transform_x"`) whose stale in-view flag can inflate a mirrored document's `scrollWidth` far beyond its viewport on first paint. Runs automatically at the end of `mirror-site.mjs`; also runnable standalone.
- `scripts/verify-mirror.mjs`: the mandatory pass/fail gate for a finished mirror (see "Mandatory recipe" above) — serves the mirror locally, headless-loads it at each captured viewport, and fails on any same-origin resource failure, broken image, `scrollWidth`/`scrollHeight` drift beyond 5% vs the capture-time baseline, or a missing baseline-recorded runtime global/count. Exit 0 only on a full pass.
- `scripts/route-crawl.mjs`: crawls internal links on the same site, saving screenshots/titles/H1s/structure signals per route, solving the problem of only cloning the homepage of a multi-page site.
- `scripts/interaction-probe.mjs`: automatically performs scroll, hover, safe click, and canvas drag, saving before/after interaction state, screenshots, network, and console evidence.
- `scripts/sourcemap-hunt.mjs`: looks for source maps inside JS chunks and saves them when found.
- `scripts/compare-recon.mjs`: reads original-vs-clone recon JSON, route maps, and interaction evidence, and generates `CLONE_REPORT.md`.
- `scripts/visual-diff.mjs`: uses a browser canvas to compute screenshot pixel differences, outputting a visual score and a diff image.
- `scripts/audit-clone.mjs`: scans for tracking scripts, original-brand leftovers, leftover Japanese text, TODOs, and external URL risk; with `--recon --strict` also validates font self-hosting/image localization/key-section color exactness verbatim, exiting 2 on a real defect.
- `scripts/od-preview-rewrite.mjs`: rewrites project-root asset references in HTML/CSS/SVG (e.g. `/reference-assets/main.css`) to relative paths, so Open Design's file preview and exported zip still load assets under nested routes.
- `scripts/dna-scaffold.mjs`: generates a `design-dna.json` design-identity skeleton from recon JSON (fonts/color candidates/framework effect signals, best-effort prefilled), for use in "visual clone / content overhaul" mode. See `references/design-dna.md`.

## Capability boundary (default stance)
- **Can do high-fidelity**: static marketing pages, corporate sites, content-driven React/Vue/Next frontends, animated sites where the source is directly available.
- **Can visually reproduce but will simplify**: CMS backend data, complex scroll storytelling, multi-breakpoint layouts, WebGL/Canvas effects, third-party embeds.
- **Does not promise a complete clone by default**: login, payments, checkout, search/recommendations, permission systems, server-side business logic, proprietary APIs, copyright-restricted material. Build only a demoable frontend stand-in when needed.
- **When doing a content overhaul**: preserve the original site's information architecture, pacing, motion, and visual grammar as the priority, and swap in the user's own copy, images, brand colors, and business messaging.

## Flagship example
`./marbles-clone/` — a native WebGL + SVG filter + custom-physics glass-marbles site, a byte-for-byte faithful clone with a full TEARDOWN, the example for the "WebGL heavy-frontend branch".
