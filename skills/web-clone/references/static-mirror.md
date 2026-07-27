# 1:1 faithful cloning of static-build sites: full asset mirroring

> Applies to: **Astro / Vite SSG / Hugo / Eleventy / any site whose client runtime output ships as downloadable static assets** — even a WebGL/Canvas/gaussian-splatting heavy frontend.
> Does not apply to: true server-side rendering / data-driven SPAs (business data sits behind an API) -> use `network-capture.mjs` for an API stand-in instead of this doc.

## Core insight (why this achieves 1:1)

For this class of site, "**the real source isn't on GitHub**", but **the deployed static assets are the ground truth**: HTML + bundled JS + CSS + runtime-fetched binaries (`.sog`/`.buf`/`.wasm`/`.riv`/fonts/images/video). Mirroring these **as-is** and serving them from a web root runs the **real code + real assets**, not a rebuild — so it's byte-for-byte 1:1, including the original site's bugs and quirks.

This extends the "real source above all" rule to static sites: **for a static site, "get the real source" = "mirror the entire deployed asset set".**

> ⚠️ Decision-tree pitfall: don't jump to "find the source theme in a theme marketplace" just because you see `astro:true` — that only holds for sites **built on an off-the-shelf open-source theme**. **A customized Astro site (e.g. Lusion's oryzo.ai) has no theme to buy**; the right move is the full mirror described in this doc.

## Why it must be "real browser, full-page scroll capture" — grep / wget alone won't do it

- Binaries like `.buf`/`.sog`/`.riv` are **fetched by the JS runtime as scroll progress advances**, and the URLs are often **dynamically assembled** in code -> grepping the bundle won't find them all, and `wget --mirror` won't discover them either (it only follows static HTML links).
- The only reliable method: **load in a real browser and scroll from top to bottom**, recording every **request that actually fires**, then mirror based on that "actual request list".

## One-shot script
```bash
node scripts/mirror-site.mjs \
  --url https://<site>/ \
  --out current-project-dir \
  [--headful]
```
Output:
- `<out>/site/…`: mirrored **same-origin** assets (paths preserved; directory URLs saved as `index.html`)
- `<out>/own-asset-urls.txt`: same-origin asset manifest
- `<out>/third-party.json`: third-party hosts + hints for **webfont CSS that needs self-hosting** (Typekit/Google)
- `<out>/mirror-manifest.json`: every request + its status
- `<out>/mirror-baseline-metrics.json`: per-viewport capture-time metrics (scrollWidth/Height, runtime globals, canvas/image/video counts) — feed this to `verify-mirror.mjs --baseline`

The script captures at three viewports (1440/768/390) using a real browser, scrolling the full page at each and saving response bodies directly during load. `--headful` launches a real, visible Chrome (`channel:"chrome"`, `--disable-blink-features=AutomationControlled`, `navigator.webdriver` masked) instead of headless, and fetches missed assets via genuine in-page `fetch()` — re-run with this the moment a headless run prints a bot-wall escalation notice. **Never fall back to a plain HTTP re-fetch (`curl`, a bare script) for same-origin assets** — that gets 403'd more readily than even a headless browser.

### What the script now finishes on its own

These stages used to be printed as a "Next:" line for a human to action, and in practice were often skipped — leaving a mirror whose HTML still pointed at the origin, or was silently incomplete. They now run automatically at the end of `mirror-site.mjs`:

1. **Bot-wall detection.** If the captured `index.html` is a challenge/captcha interstitial, or a response anywhere during capture carries a 403/202 challenge status, a challenge-page body, or a captcha-style header, the run reports it and — for the root document — stops with exit code 2 instead of reporting a successful clone of a bot wall. Either way it prints the `--headful` escalation instruction.
2. **Recursive asset fetch.** A scroll-through only downloads what the page actually requests, so lazy-loaded media, hover-state sprites, `srcset` variants the viewport never selected, and unused `@font-face` formats are referenced but absent. The references are read back off the mirror (same primitive as `rewrite-mirror.mjs`'s `collectSameOriginRefs`, see `lib/asset-discovery.mjs`) and fetched via genuine in-page `fetch()`, repeating until a round makes no further progress. A challenge page returned for a binary asset is rejected rather than saved as a broken image.
3. **URL rewrite.** Absolute same-origin references become relative local paths — but only when the mirrored file actually exists, so a missing asset stays an honest remote link instead of a guaranteed 404.
4. **Scroll-animation overflow clamp.** See `clamp-scroll-animation-overflow.mjs`.

Re-runnable standalone: `node scripts/rewrite-mirror.mjs --out <mirror-dir> [--dry-run]`.

### Verify before calling it done

`mirror-site.mjs` finishing is not the same as the clone being done. After the manual wrap-up below, run the mandatory gate:
```bash
node scripts/verify-mirror.mjs --site current-project-dir/site --baseline current-project-dir/mirror-baseline-metrics.json
```
This must exit 0 before the clone may be reported complete or served to the user — see SKILL.md's "Mandatory recipe" section.

## Manual wrap-up after mirroring (to get it running offline, 1:1)

Same-origin assets are handled above. **Third parties still need manual work, per `third-party.json`**:

1. **Self-host domain-locked webfonts (most commonly Adobe Typekit)**
   A Typekit kit locks its authorized domain, so a remote `@import` may stop rendering once the domain changes -> self-host it:
   ```bash
   # (1) download the kit CSS (direct connection — Typekit is often blocked by a proxy, so don't go through one)
   curl -sL -A "Mozilla/5.0 …Chrome…" -e "https://<site>/" "https://use.typekit.net/<kit>.css" -o site/typekit/kit.css
   # (2) extract the use.typekit.net/af/... font URLs from kit.css's @font-face src, and download each into site/typekit/fonts/
   #     each font has 3 suffixes: /l=woff2  /d=woff  /a=otf (trust the file's magic bytes — wOF2/wOFF/0x00010000 — not the filename)
   # (3) write local @font-face rules (relative url + keep the format hint), see below
   ```
   Local `@font-face`:
   ```css
   @font-face{ font-family:"<same-name>"; src:url("./fonts/x.woff2") format("woff2"),
     url("./fonts/x.woff") format("woff"), url("./fonts/x.otf") format("opentype");
     font-display:swap; font-weight:<original-range>; }
   ```
   Then update the reference to point locally — **note that Typekit is often the first line of the main CSS, `@import"https://use.typekit.net/<kit>.css"`, not an HTML `<link>`**:
   ```bash
   perl -0pi -e 's{\@import"https://use\.typekit\.net/<kit>\.css"}{\@import"/typekit/kit-local.css"}g' site/_astro/<main>.css
   ```

2. **Strip tracking**: Cloudflare beacon / GA / pixels — precisely remove the `<script>` tags.

3. **Public CDNs (Rive wasm@unpkg / third-party players)**: public CDNs support cross-origin loading, so they work fine served locally while online -> fine to leave online (they'll break offline — note this in NOTES). To go fully offline, mirror these too and rewrite the injection points.

4. **Vimeo/YouTube embeds**: iframes play online but don't work offline -> usually not core above-the-fold content, just note it in NOTES.

## Serve + verify
```bash
cd current-project-dir/site
python3 -m http.server 8124      # must run from site/ as the web root, or root-relative paths (/_astro /models …) won't resolve
```
This is in addition to, not instead of, `verify-mirror.mjs` above — that gate must already exit 0. Then follow SKILL.md Step 5: 0 console errors in the browser + `visual-diff.mjs` pixel comparison against the original. For heavy WebGL sites, remember to **scroll to each section for a screenshot** as comparison (a static full-page screenshot won't catch GL frames triggered by scroll).

## Worked example: oryzo.ai (Lusion, L6)
- 135 same-origin assets (HTML+bundle+CSS + 25x `.buf` geometry/camera-animation files + 2x `.sog` gaussian splats + a sorting wasm + `.riv` + MSDF + fonts + 80+ images)
- The only rewrite needed: Typekit `@import` -> locally self-hosted halyard, plus removing the Cloudflare beacon
- Result: `scrollHeight` matches exactly, **0 console errors**, hero pixel diff **36/1.3M (5/5)**
- Left online: the Vimeo gallery video + the unpkg Rive wasm (non-core)
- Full record: `current-project-dir/oryzo-clone/` (NOTES.md + TEARDOWN.md)
