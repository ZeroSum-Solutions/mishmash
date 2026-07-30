---
name: deck-open-slide-canvas
en_name: "Write an Architecture Review like a World-Class Staff Engineer"
zh_name: "像世界级 Staff Engineer 一样写架构评审"
description: |
  MishMash's architecture review: the local daemon + agent-runtime design, the tradeoffs, and the decision to lock. Built as a decision-grade product management deck for staff eng, tech leads, security.
en_description: |
  MishMash's architecture review: the local daemon + agent-runtime design, the tradeoffs, and the decision to lock. Built as a decision-grade product management deck for staff eng, tech leads, security.
zh_description: |
  像世界级 Staff Engineer 一样写架构评审——一份可商业交付的产品管理 Deck，围绕真实主题、证据链与决策目标组织。
tags:
  - "product-management"
  - "pm-feature-business-case-deck"
  - "product"
  - "roadmap"
  - "architecture"
  - "decision-deck"
  - "commercial-slide-agent"
  - "deck-open-slide-canvas"
triggers:
  - "pm-feature-business-case-deck"
  - "product-management"
  - "Write an Architecture Review like a World-Class Staff Engineer"
  - "像世界级 Staff Engineer 一样写架构评审"
  - "product"
  - "roadmap"
  - "architecture"
  - "html deck"
  - "html slides"
emoji: "🎨"
category: slides
scenario: design
aspect_hint: "1920×1080 (16:9)"
featured: 35
recommended: 9
example_id: sample-deck-open-slide-canvas
example_name: "1920 Free Canvas · Sea Indigo"
example_format: markdown
example_tagline: "Locked 1920×1080 + free composition"
example_desc: "Sea Indigo palette + one large-type question slide + corner badges"
example_source_url: "https://github.com/1weiho/open-slide"
example_source_label: "1weiho/open-slide"
od:
  mode: deck
  surface: web
  featured: 0.17
  upstream: "https://github.com/nexu-io/html-anything"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt_i18n:
    zh-CN: "用「1920 画布自由 Deck」模板把我的内容做成一套「锁死 1920×1080 画布, React 组件级自由组合, 不绑模板」。保持模板的视觉签名，使用真实内容和数据，避免 lorem ipsum 和占位图片。"
  category: "product-management"
  scenario: "product"
  example_prompt: "Create \"Write an Architecture Review like a World-Class Staff Engineer\" as a decision-grade Product management deck in this template's own visual system. Subject: MishMash's architecture review: the local daemon + agent-runtime design, the tradeoffs, and the decision to lock. Audience: staff eng, tech leads, security. First ask only for missing essentials: audience, decision target, source-of-truth materials, deadline, and must-keep numbers. Then produce the slide plan, written slides, visual direction, speaker-ready structure, and a critic pass against this rubric: can cross-functional reviewers agree on the next irreversible step."
---

[Template: Open-Slide 1920 Canvas Deck]
[Intent] For scenarios that don't want to be locked into a template (personal portfolios, unconventional talks, art/design-course decks). Provides a fixed 1920×1080 canvas + a strict type/color constraint, letting the agent freely lay out each slide by content, the way you'd compose a React component. Inspired by 1weiho/open-slide.

[Hard technical spec]
- Canvas: each slide is strictly `width: 1920px; height: 1080px;`, fit to the viewport with `transform: scale(...)` (default `scale(0.7)` centered).
- **Overflow is strictly forbidden**: every slide's content must fit within 1920×1080 — no scrollbars allowed.
- Type scale (px): `2xs:18 · xs:22 · sm:28 · md:36 · lg:48 · xl:64 · 2xl:88 · 3xl:120 · 4xl:160 · 5xl:220`.
- Padding: pick one of 96 / 128 / 160.
- Every slide has `<section class="slide" data-slide-id="<n>">`.

[Palette — pick 1 per deck, don't change it mid-deck]
- 🌫 **Ash & Lime** — bg `#f1efea`, ink `#161616`, accent `#c5e803`.
- 🌌 **Sea Indigo** — bg `#0a0e1a`, ink `#f5f5f7`, accent `#5ac8fa`.
- 🧉 **Mate Mocha** — bg `#1a1411`, ink `#f5e9d6`, accent `#d97757`.
- 🌸 **Pearl Rose** — bg `#fdf6f3`, ink `#1a1015`, accent `#ff5d8f`.

[Layout freedom — this is the core idea]
- No forced template — each slide picks its own layout based on **the nature of its content**: cover / question / quote / image-text / 3-column / 5-column / list / data card / full-bleed image.
- But every slide **must follow one rule**: there is exactly 1 visual focal point (visual hierarchy) — one quote, one number, one image — never "emphasize everything".
- Don't cram in two equally-weighted blocks of text; if you genuinely need parallel content, use a 3-column equal-weight grid.

[Fonts]
- Latin: `Inter Tight` (display) + `Inter` (body); or `Source Serif Pro` (for an editorial feel).
- CJK: `Noto Sans SC` (sans style) or `Noto Serif SC` (editorial style); don't mix sans + serif.
- Mono: `JetBrains Mono` for data / timestamps.

[Design details]
- No decorative emoji (emoji within actual content is fine); no multi-color rainbow; use only one accent color.
- No generic SVG icon libraries like lucide/feather (write your own inline SVG).
- Add keyboard ← / → navigation + hash sync; fixed corner badges: bottom-right `№N/M`, bottom-left deck title.
- Must use the user's real content; lorem ipsum is strictly forbidden.
- Single-file HTML; Tailwind CDN; no external image links.
