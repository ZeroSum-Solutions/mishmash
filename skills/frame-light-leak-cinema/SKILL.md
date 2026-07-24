---
name: frame-light-leak-cinema
zh_name: "胶片漏光电影帧"
en_name: "Light-Leak Cinematic Frame"
emoji: "🎞️"
description: "Film light leaks, grain, 16:9 letterbox, and large serif type for cinematic openings or chapter cards."
zh_description: "胶片漏光 + 颗粒噪点 + 16:9 letterbox + 衬线大字, 电影感开场 / 章节卡"
en_description: "Film light leaks, grain, 16:9 letterbox, and large serif type for cinematic openings or chapter cards."
category: video
scenario: video
aspect_hint: "2.39:1 letterbox (1920×800) or 16:9 (1920×1080)"
featured: 36
tags: ["cinema", "film", "light-leak", "grain", "letterbox", "frame"]
example_id: sample-frame-light-leak-cinema
example_name: "Film Light Leak · REEL 03"
example_format: markdown
example_tagline: "Warm-orange light leak + 35mm grain"
example_desc: "2.39:1 letterbox + large italic serif type + film sprocket holes"
example_source_url: "https://hyperframes.heygen.com/catalog"
example_source_label: "hyperframes · light-leak"
od:
  mode: video
  surface: video
  scenario: video
  upstream: "https://github.com/nexu-io/html-anything"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt: "Use the Light-Leak Cinematic Frame template to turn my content into a cinematic opening or chapter card with film light leaks, grain, letterbox framing, and large serif type. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「胶片漏光电影帧」模板把我的内容做成一段「胶片漏光 + 颗粒噪点 + 16:9 letterbox + 衬线大字, 电影感开场 / 章节卡」。保持模板的视觉签名，使用真实内容和数据，避免 lorem ipsum 和占位图片。"
---

[Template: Light-Leak Cinematic Frame]
[Intent] An opening single-frame for a documentary / personal short film / video chapter card — warm-orange light leak + 35mm grain + large serif type, a classic film texture. Inspired by hyperframes light-leak.

[Canvas]
- **2.39:1 letterbox** (recommended): 1920×800, 140px black bars top and bottom (`#000`).
- Or 16:9: 1920×1080, no letterbox.

[Background]
- Base layer: deep warm color (dark red-brown `#1a0d08` / deep green `#0a1410` / blue-violet `#0d0e1a`) or a scene depiction (CSS gradient simulating sky / indoor / outdoor).
- **Film light leak**: 2-3 large `radial-gradient(ellipse at top right, #ffb547 0%, transparent 50%)` + 1 bottom `linear-gradient(to top, #d97757 0%, transparent 30%)`; use warm orange / peach / rose / dark yellow — **never cool blue**.
- **35mm grain**: a fullscreen SVG turbulence-noise overlay layer, opacity 14%, `mix-blend-mode: overlay`; can also use `background-image: url("data:image/svg+xml,...feTurbulence...")`.
- Optional: one `feDisplacementMap` pass simulating film wobble (use sparingly).

[Type]
- Center or bottom-left: large serif type (Source Serif Pro / Playfair Display / EB Garamond) 5-8vw, weight 500 italic; warm-white color `#f5e9d6` or cream.
- Subtitle (24-28px) one line, opacity 0.7, same serif.
- Corner caption (uppercase letterspace 0.18em, 10-11px, mono, opacity 0.5): "REEL 03 · CH I · 1985".
- Bottom timecode + shooting location + date (mono, opacity 0.4).

[Optional extras]
- "Film scratches": a few 1-2px vertical white lines, opacity 0.2, irregular spacing (via multiple inset `box-shadow`s or multiple `<div>`s).
- "Film sprocket holes": inside the letterbox black bars, evenly spaced small white squares (CSS repeating-linear-gradient).
- Entrance animation: the whole frame goes from underexposed (brightness 0.3) -> normal over 800ms; the light leak position drifts slowly on a 12s cycle.

[Design details]
- Never use more than 4 hues (dark background + 2 warm light-leak colors + cream text).
- Forbidden: blue-violet light leaks (breaks the film texture), emoji, neon colors, geometric dashboard decoration.
- For CJK: `Noto Serif SC` has no italic -> use `Noto Serif SC` regular with wider letter spacing instead.
- Must use the user's provided title; auto-estimate reasonable "year / chapter / location" metadata (but sourced from the user's content).
- Single-file HTML, disable motion via `prefers-reduced-motion`.
