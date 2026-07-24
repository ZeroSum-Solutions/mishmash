# Complex-site clone playbooks

For L4-L6 sites, aimed at turning "looks complex" into an executable path.

## L4 animation-heavy brand sites

1. `recon-site.mjs` to capture three screenshot sizes, sections, and video/canvas counts.
2. Record scroll-library signals: GSAP / Lenis / ScrollTrigger / Locomotive.
3. Split the page into five categories: hero, scroll storytelling, video masking, hover, transitions.
4. Prioritize reproducing pacing and visual grammar; micro-interactions can be approximated, but the difference must be noted in `CLONE_REPORT.md`.
5. Use `visual-diff.mjs` to score the hero and key scroll-position screenshots.

## L5 WebGL / Canvas / Three.js

1. Look for real source, source maps, or a public repo first; reverse-engineer the bundle only if none can be found.
2. `recon-site.mjs` to record canvas size, count, and framework signals.
3. `sourcemap-hunt.mjs` to try downloading source maps.
4. Break it into technical pillars: rendering, shaders, post-processing, physics, interaction, audio, resource loading.
5. Don't guess at complex shaders — build a minimal runnable scene first, then add materials, lighting, and post-processing one at a time.
6. Interaction verification must use real browser interaction or screenshot/video evidence, not just reading the code.

## L6 SaaS / e-commerce / login-gated business systems

Default to cloning only the presentation layer and demoable flows; don't promise real accounts, payments, orders, or permissions.

1. For logged-in public pages, confirm authorization and privacy boundaries first.
2. `network-capture.mjs` to save XHR/fetch responses as fixtures.
3. Split endpoints into: content endpoints, search/filter, user-state, transaction/write.
4. Content endpoints can be stood in with local JSON; transaction/write endpoints only need mocked success/failure states.
5. Preserve empty, loading, error, and insufficient-permission states — don't just build the happy path.
6. `audit-clone.mjs` to scan external links, original-brand leftovers, and tracking scripts.

## Multi-page / CMS / corporate sites

1. Capture the sitemap, nav, footer, and main templates first.
2. Clone only representative templates: home, list page, detail page, search/filter page, contact page.
3. Generate repeated content from data files instead of hand-writing every page.
4. Don't clone the CMS backend; if edit capability is needed, substitute local JSON/Markdown.

## Success criteria

- Complete original-site evidence: screenshots, recon JSON, network manifest, asset manifest.
- The clone runs locally with console/page errors at zero or clearly explained.
- `CLONE_REPORT.md` has structure, visual, interaction, responsive, and functional-boundary scores.
- `CLONE_AUDIT.md` shows no tracking scripts, no original-brand leftovers, and no unexplained leftover foreign-language text or external-link risk.
- Boundaries are clearly stated for anything genuinely out of reach: real backends, proprietary APIs, copyrighted assets.
