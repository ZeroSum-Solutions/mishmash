---
name: deck-swiss-international
zh_name: "瑞士国际主义 Deck"
en_name: "Swiss International Deck"
emoji: "🟦"
description: "16-column grid, one saturated accent, and 22 locked layouts (Klein Blue, Lemon, Mint, Safety Orange)."
zh_description: "16 列网格 + 单一饱和 accent + 22 个锁死版面 (Klein Blue / Lemon / Mint / Safety Orange)"
en_description: "16-column grid, one saturated accent, and 22 locked layouts (Klein Blue, Lemon, Mint, Safety Orange)."
category: slides
scenario: marketing
aspect_hint: "16:9 landscape, page-turn"
featured: 1
recommended: 1
tags: ["swiss", "grid", "international", "ikb", "editorial", "facts"]
example_id: sample-swiss-international
example_name: "Swiss International · product roadmap"
example_format: markdown
example_tagline: "Klein Blue IKB + 16-column grid"
example_desc: "S01 Cover + S06 KPI Tower two-page preview, IKB full-bleed title + 4-bar KPI"
example_source_url: "https://github.com/op7418/guizang-ppt-skill"
example_source_label: "op7418/guizang-ppt-skill"
od:
  mode: deck
  surface: web
  scenario: marketing
  featured: 0.001
  upstream: "https://github.com/nexu-io/html-anything"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt: "Use the Swiss International Deck template to turn my content into a 16-column-grid deck with one saturated accent and 22 locked layouts. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「瑞士国际主义 Deck」模板把我的内容做成一套「16 列网格 + 单一饱和 accent + 22 个锁死版面 (Klein Blue / Lemon / Mint / Safety Orange)」。保持模板的视觉签名，使用真实内容和数据，避免 lorem ipsum 和占位图片。"
---

【Template: Swiss International Deck】
【Intent】Fact, product, analysis, and methodology writing. Extremely cool, rational, academic — no hand-drawn elements / noise / decoration whatsoever. Inspired by op7418/guizang-ppt-skill Style B.

【Theme】**Pick exactly 1 of the 4 sets below, never mix them, never change the hex values**:
- 🔵 **Klein Blue (IKB)** — accent `#002FA7`, paper `#fafaf8`, ink `#0a0a0a`. Business / AI / design scenarios.
- 🟡 **Lemon Yellow** — accent `#FFD500`, paper `#f7f5ee` (pale cream), ink `#0a0a0a`. Youth / retail / sports. Text must be black (never white).
- 🟢 **Lemon Green / Neon** — accent `#C5E803`, paper `#f7f5ee`, ink `#0a0a0a`. Sustainability / tech startups / Gen-Z brands. Text must be black.
- 🟠 **Safety Orange** — accent `#FF6B35`, paper `#f7f5ee`, ink `#0a0a0a`. Industrial / automotive / urgent messaging. Text in white + bold ≥ 600.

【Layouts — a reusable pool of 22 layouts; do not invent new layouts or reshape existing ones; **the count is set by the content** — cover 【user content】in full (short content starts at 6-10 slides, longer content should run well beyond that; the same layout can repeat across chapters)】
- **S01 Cover** — full-bleed accent + breathing ASCII dot matrix + reversed-white title + metadata chrome (date / № / topic).
- **S02 Vertical Timeline** — a dashed axis with dots on the left; nodes on the right = year + KPI + description.
- **S03 Statement** — a centered 9.6vw giant statement + generous whitespace on the left + a hairline at the bottom + a caption.
- **S04 Six Cells** — a 2×3 grid, each cell: icon + number + short title + one-line description.
- **S05 Three Sub-cards** — a hero title on the left + three horizontally stacked gray cards on the right.
- **S06 KPI Tower** — 4 columns of blue bars at varying heights; an icon atop each bar; a big number + label at the base.
- **S07 H-Bar Chart** — horizontal ranked bars, width reflects the data, the number is labeled at the end.
- **S08 Duo Compare** — a vertical divider; Before on the left / After on the right.
- **S09 Closing Manifesto** — an IKB block + ASCII dot matrix + manifesto on the left; a white background + 3 bullet points on the right.
- **S10 Dot Matrix Statement** — a centered manifesto + a geometric dot matrix / ring matrix in the corner.
- **S11 Horizontal Timeline** — a headline up top, a hairline axis in the middle, evenly spaced nodes, step names below each node.
- **S12 Manifesto + Ink Banner** — a headline + explanation in the top half; a full-width black banner + small reversed-white text in the bottom half.
- **S13 Three Forces Cards** — an ink hero block on the left; three gray cards on the right, each: a big number + text.
- **S14 Loop Diagram** — numbered steps on the left; an SVG concentric-ring diagram on the right; a "LOOP" label at the center.
- **S15 Image Matrix + Hero Stat** — a 4×3 grid of equal-height cards (12 items) + a big summary number + label at the bottom.
- **S16 Multi-card Brief** — a 3×2 grid of micro-cards; main copy top-left, a footnote bottom-right, one card highlighted with the accent.
- **S17 System Diagram** — a headline + 3 paragraphs of description on the left; an SVG of three concentric circles + external labels on the right.
- **S18 Why Now** — 3 columns, each: a category label + headline + description + a number at the bottom (the last column carries the accent).
- **S19 Four Cards** — an accent hairline at the top + headline + 4 equal-width cards (metadata / title / body).
- **S20 Stacked KPI Ledger** — vertical rows + hairline dividers; a big number on the left / label in the middle / icon on the right.
- **S21 Tech Spec Sheet** — a title block on the left / 3 KPI hairlines in the middle / bars of varying height on the right / data at the bottom.
- **S22 Image Hero** — a full-width image covering the top 60% + a white title block overlaid; explanation + a 3-column KPI row in the bottom 40%.

【Design details — absolute hard rules】
- **Right angles only**: `border-radius: 0` throughout. Any rounded corner is an immediate violation.
- **1px hairline borders**, black or accent color; shadows / gradients / blur are strictly forbidden.
- **16-column grid**: `grid-template-columns: repeat(16, 1fr); gap: 0`.
- **Fonts**: Inter Tight (Latin display) / Inter (body) / Noto Sans SC (CJK) / JetBrains Mono (data); serif and decorative fonts are strictly forbidden.
- **Extreme size contrast**: cover uses 9.6vw display, body 14-16px, labels 11px uppercase, letter-spacing 0.08em.
- **Keyboard ← / → to navigate + hash sync**; folio locked in place: `№N/N` bottom-right, topic label bottom-left.
- **No fabrication**: numbers must come from user input; bar-chart heights = real data scaled proportionally.
- Output a single-file HTML with no external image URLs; render decorative geometry (ASCII matrix / concentric circles) in pure CSS or inline SVG.
