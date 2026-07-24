---
name: frame-logo-outro
zh_name: "品牌 Logo 收尾帧"
en_name: "Logo Outro Frame"
emoji: "🎬"
description: "Segmented logo assembly, glow bloom, and tagline reveal for video outros or brand closing frames."
zh_description: "Logo 分块组装入场 + glow bloom + tagline 揭示, 适合视频片尾 / 品牌闭幕"
en_description: "Segmented logo assembly, glow bloom, and tagline reveal for video outros or brand closing frames."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
featured: 40
recommended: 8
tags: ["logo", "outro", "branding", "end-card", "frame"]
example_id: sample-frame-logo-outro
example_name: "Logo Outro · HTML Anything"
example_format: markdown
example_tagline: "Midnight Indigo + glow bloom"
example_desc: "Logo assembly + brand name + tagline + CTA, for video outros"
example_source_url: "https://hyperframes.heygen.com/catalog"
example_source_label: "hyperframes · logo-outro"
od:
  mode: video
  surface: video
  scenario: video
  featured: 0.16
  upstream: "https://github.com/nexu-io/html-anything"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt: "Use the Logo Outro Frame template to turn my content into a video outro or brand closing frame with segmented logo assembly, glow bloom, and tagline reveal. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「品牌 Logo 收尾帧」模板把我的内容做成一段「Logo 分块组装入场 + glow bloom + tagline 揭示, 适合视频片尾 / 品牌闭幕」。保持模板的视觉签名，使用真实内容和数据，避免 lorem ipsum 和占位图片。"
---

[Template: Logo Outro Frame]
[Intent] A brand-reveal frame for the end of a video — segmented logo assembly + glow bloom + tagline rising into view + CTA. Inspired by hyperframes logo-outro.

[Canvas] 1920×1080, black `#08090c` or a deep brand color background; add a subtle vignette `radial-gradient(...)` to brighten the center.

[Layout]
- **Center logo**: drawn with CSS / inline SVG; composed of 4-8 geometric pieces (circle / square / triangle / hairline).
  - Entrance animation: each piece slides in from off-screen (±100px, different directions) + scale 1.4->1.0 + opacity 0->1, staggered 80ms; total duration 1.2s.
  - Once the entrance finishes, apply a glow bloom to the whole logo: `filter: drop-shadow(0 0 24px <accent>40)`; simultaneously a shimmer sweeps across the logo via `mask-image` (500ms).
- **Brand name**: positioned 6-8% below the logo, large type (Inter Tight / SF Pro Display, 48-72px, weight 700, letter-spacing -0.02em), entrance: typewriter or fade-up after the logo bloom (starting at 1.4s).
- **Tagline**: one line below the brand name (24-28px, weight 400, opacity 0.7), fade in (1.8s).
- **Bottom CTA + metadata**: a two-line bottom row, e.g. `htmlanything.dev · @htmlanything · 2026`, 11px uppercase letter-spacing 0.16em, opacity 0.4, separated by a hairline.

[Palette — pick 1 of 4, don't mix]
- 🌌 **Midnight Indigo** — bg `#08090c`, accent `#7c5cff` (neon violet-blue glow).
- 🌅 **Solar Amber** — bg `#0e0a08`, accent `#ffb547` (warm amber).
- 🌿 **Forest Mint** — bg `#0a1410`, accent `#5fb38a` (mint green).
- ⚪ **Bone & Ink** — bg `#f1efea`, accent `#0a0a0b` (no neon, editorial style, glow replaced with shadow).

[Design details]
- **Never**: use an external logo image link; the logo must be drawn purely with CSS / inline SVG geometry.
- Entrance animation via `@keyframes` + `animation-delay`; can be disabled via `prefers-reduced-motion`.
- Fonts: Latin `Inter Tight` / `SF Pro Display` / `Manrope`; CJK `Noto Sans SC` weight 700.
- Must use the user's provided brand name + tagline; if none is given, fall back to "HTML Anything" / "Anything -> beautiful HTML".
- Single-file HTML; once the whole animation completes, freeze it (don't loop — this is a video ending frame).
- Optional 5px top ribbon (accent color) for extra brand recognition.
