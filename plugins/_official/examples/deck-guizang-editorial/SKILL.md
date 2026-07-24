---
name: deck-guizang-editorial
en_name: "Write an Annual Marketing Plan like a World-Class CMO"
description: |
  Open Design's FY26 marketing plan: brand-to-pipeline — audience, offer, channel mix, and the launch calendar that ties creative to growth. Built as a decision-grade marketing & GTM deck for CMO, growth lead, founder.
en_description: |
  Open Design's FY26 marketing plan: brand-to-pipeline — audience, offer, channel mix, and the launch calendar that ties creative to growth. Built as a decision-grade marketing & GTM deck for CMO, growth lead, founder.
tags:
  - "marketing-gtm"
  - "annual-marketing-plan"
  - "marketing"
  - "launch"
  - "campaign"
  - "pipeline"
  - "decision-deck"
  - "commercial-slide-agent"
  - "deck-guizang-editorial"
triggers:
  - "annual-marketing-plan"
  - "marketing-gtm"
  - "Write an Annual Marketing Plan like a World-Class CMO"
  - "launch"
  - "campaign"
  - "pipeline"
  - "html deck"
  - "html slides"
emoji: "🖋️"
category: slides
scenario: marketing
aspect_hint: "16:9 landscape, page-turn"
featured: 49
recommended: 1
example_id: sample-guizang-editorial
example_name: "Guizang Editorial Ink · chapter cover"
example_format: markdown
example_tagline: "Classic ink palette + serif display"
example_desc: "L02 Act Divider chapter cover + L03 Big Numbers Grid, paper-print feel"
example_source_url: "https://github.com/op7418/guizang-ppt-skill"
example_source_label: "op7418/guizang-ppt-skill"
od:
  mode: deck
  surface: web
  featured: 0.01
  upstream: "https://github.com/nexu-io/html-anything"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  category: "marketing-gtm"
  scenario: "marketing"
  example_prompt: "Create \"Write an Annual Marketing Plan like a World-Class CMO\" as a decision-grade Marketing & GTM deck in this template's own visual system. Subject: Open Design's FY26 marketing plan: brand-to-pipeline — audience, offer, channel mix, and the launch calendar that ties creative to growth. Audience: CMO, growth lead, founder. First ask only for missing essentials: audience, decision target, source-of-truth materials, deadline, and must-keep numbers. Then produce the slide plan, written slides, visual direction, speaker-ready structure, and a critic pass against this rubric: can the plan connect creative choices to measurable growth."
---

[Template: Guizang Editorial Ink Deck (Editorial × E-Ink)]
[Intent]Narrative, opinion, sharing, personal-voice writing. Ink-on-paper print feel, not a tech look. Inspired by op7418/guizang-ppt-skill Style A.

[Palette — pick 1 of 5, never change the hex values, never mix palettes]
- 🖋 **Ink Classic Monocle** — ink `#0a0a0b`, paper `#f1efea`, paper-tint `#e8e5de`, ink-tint `#18181a`. Default / general business / tech.
- 🌊 **Indigo Porcelain** — ink `#0a1f3d`, paper `#f1f3f5`, paper-tint `#e4e8ec`, ink-tint `#152a4a`. Tech / research / data.
- 🌿 **Forest Ink** — ink `#1a2e1f`, paper `#f5f1e8`, paper-tint `#ece7da`, ink-tint `#253d2c`. Nature / sustainability / culture.
- 🍂 **Kraft Paper** — ink `#2a1e13`, paper `#eedfc7`, paper-tint `#e0d0b6`, ink-tint `#3a2a1d`. Nostalgic / humanities / literary.
- 🌙 **Dune** — ink `#1f1a14`, paper `#f0e6d2`, paper-tint `#e3d7bf`, ink-tint `#2d2620`. Art / design / fashion.

[Layouts — a reusable pool of 10 cassette-style templates; **the count is set by [user content]**, cover every point in full; short content starts at 6-12 slides, longer content should run more (the same layout can repeat across chapters)]
- **L01 Hero Cover** — centered large hero typography + kicker + subtitle + lead paragraph + metadata row at the bottom.
- **L02 Act Divider** — kicker + 8.5-10vw giant headline + one line of intro; chapter switches may invert ink ↔ paper.
- **L03 Big Numbers Grid** — 3×2 data cards (label / big number / note).
- **L04 Quote + Image** — left kicker + headline + body + callout; right 16:10 image (baseline-aligned, not top-aligned).
- **L05 Image Grid** — 3×2 or 3×1 equal-height image grid (26vh or 22vh); heights must match exactly.
- **L06 Pipeline / Flow** — a horizontal group of numbered steps, each: №X + title + description; supports stepping through by keyboard.
- **L07 Hero Question** — a single question filling the screen at 7vw, line breaks at semantic points, minimal surroundings.
- **L08 Big Quote** — a giant 5.8vw serif quote + English translation + attribution + date.
- **L09 Before / After** — 1:1 split; left column at opacity .55 (old/before); right column at full brightness (new/after).
- **L10 Mixed Media** — 8:4 ratio; left long-form text (kicker / headline / body / callout) + right 3:4 portrait image as support.

[Design details]
- **Forbidden**: gradients / drop-shadow / rounded corners / circular decoration / blur / SVG icon libraries / emoji decoration.
- **Fonts**: `Playfair Display` (Latin) / `Noto Serif SC` (CJK) for display; `Inter` / `Noto Sans SC` for body; numerals/figures may occasionally use an italic serif.
- **Magazine-feel details**: kicker at 11px uppercase, letter-spacing 0.12em; folio in the bottom-right corner `01 / 12`; a thin hairline rule at the top + a masthead logo / topic.
- **Not allowed**: fabricated data, Lorem ipsum, placeholder image URLs. Draw every image with inline CSS / SVG (color blocks + simple line art).
- Keyboard ← / → to navigate; hash sync; single-file HTML.
