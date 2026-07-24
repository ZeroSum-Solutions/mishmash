# Complexity grading and clone scoring

Used for the pre-clone assessment, post-clone acceptance check, and explaining to Jane "how far this site can actually be cloned".

## Clone modes

| Mode | Goal | Applicable scenarios |
|---|---|---|
| Faithful clone | Preserve the original source / layout / interaction as closely as possible | Legal source found, single-file site, learning a complex frontend technique |
| Visual clone | Looks close in appearance, internal implementation can differ | No source, commercial site, content site, componentized rebuild |
| Content overhaul | Keep the original site's pacing and visual grammar, swap in Jane's own content | Turning a reference site into your own site, brand page, product intro |
| Technical teardown | Don't rush to rebuild — confirm the real implementation first | WebGL/Canvas/complex interaction, conflicting AI analyses |

## Complexity L1-L6

| Level | Type | Typical signals | Usual reproducible fidelity | Default boundary |
|---|---|---|---|---|
| L1 | Static HTML/CSS | Little JS, no framework, few pages | 90-98% | Near pixel-level possible; asset copyright is a separate concern |
| L2 | CMS/corporate content site | Multi-page, CMS-generated, forms/news/regional sites | 70-90% | Frontend reproducible, CMS backend not cloned |
| L3 | React/Vue/Next content frontend | Hydration, chunks, routing, content from an API | 65-90% | Data/API can be stood in with a local JSON substitute |
| L4 | Animation-heavy brand site | GSAP, Lenis, complex scroll, video masking | 50-80% | Primary visuals reproducible, micro-interactions often approximated |
| L5 | WebGL/Canvas/Three.js | Shaders, physics, post-processing, GPU resources | 30-95% | Can be high-fidelity with source; without source, teardown first and decide |
| L6 | SaaS/e-commerce/login-gated business system | Accounts, payments, orders, permissions, search/recommendations | Presentation layer only | Server-side business logic not cloned by default |

## Pre-clone assessment template

```markdown
## Pre-clone assessment
- Complexity level:
- Recommended mode: faithful clone / visual clone / content overhaul / technical teardown
- Parts that can be high-fidelity:
- Parts that need approximation or substitution:
- Parts that will not be cloned:
- Main risks: license / assets / login state / API / performance / WebGL / responsive
```

## Post-clone scoring

0-5 points per item. Only give a score that's backed by source, screenshots, or actual browser run results.

| Dimension | 5 points | 3 points | 1 point |
|---|---|---|---|
| Source evidence | Real source or complete static assets found, key conclusions have file/line refs | Runtime recon and asset capture done | Mostly eyeballed and inferred |
| Structural fidelity | Information architecture, section order, breakpoints all match | Main sections match, some merging/trimming in details | Only the rough style is kept |
| Visual fidelity | Fonts, spacing, colors, image ratios closely match | Primary visuals close, some local ratios differ | Clearly looks like a different design |
| Motion/interaction | Scroll, hover, video, Canvas/WebGL behavior closely match | Only core interactions kept | Largely static |
| Responsive | Verified on desktop/tablet/mobile with no layout breaks | Verified at 1-2 widths | Mobile is clearly broken |
| Functional completeness | Nav, forms, media, external links, local run all work | Main browsing paths work | Multiple dead links or errors |
| Content replacement | Already swapped to Jane's content, replacement map is clear | Partially reworked, original-site leftovers remain | Large amounts of original copy/branding remain |
| Legal/deployment risk | License clear, tracking removed, asset boundaries documented | Risk documented but not fully resolved | Risk unclear |

Suggested output:

```markdown
## Clone score
- Source evidence: /5
- Structural fidelity: /5
- Visual fidelity: /5
- Motion/interaction: /5
- Responsive: /5
- Functional completeness: /5
- Content replacement: /5
- Legal/deployment risk: /5
- Overall:
```

## Original vs. clone comparison table

```markdown
| Module | Original behavior | Clone implementation | Difference / tradeoff | Evidence |
|---|---|---|---|---|
| Hero |  |  |  | screenshot / file:line |
| Nav |  |  |  |  |
| Core motion |  |  |  |  |
| Content sections |  |  |  |  |
| Mobile |  |  |  |  |
```
