---
name: doc-kami-parchment
en_name: "Kami Parchment Document"
emoji: "📜"
description: "Warm parchment canvas (#f5f4ed), monochrome ink-blue accent (#1B365D), one serif family, and editorial-grade typography."
en_description: "Warm parchment canvas (#f5f4ed), monochrome ink-blue accent (#1B365D), one serif family, and editorial-grade typography."
category: doc
scenario: personal
aspect_hint: "A4 / Letter, long page"
featured: 48
recommended: 3
tags: ["kami", "parchment", "serif", "editorial", "report", "letter", "one-pager"]
example_id: sample-kami-parchment
example_name: "Kami Parchment · One-Pager"
example_format: markdown
example_tagline: "Warm parchment + monochrome ink-blue + single serif"
example_desc: "A single-page MishMash Studio Issue №26 editorial-grade one-pager"
example_source_url: "https://github.com/tw93/kami"
example_source_label: "tw93/kami"
od:
  mode: prototype
  surface: web
  platform: desktop
  scenario: personal
  featured: 0.04
  upstream: "https://github.com/nexu-io/html-anything"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt: "Use the Kami Parchment Document template to turn my content into a warm parchment document with monochrome ink-blue accents, one serif family, and editorial-grade typography. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
---

[Template: Kami Parchment Document]
[Intent]Serious typeset documents: one-pager / long report / letter / resume / financial report / changelog / portfolio. Inspired by tw93/kami. The goal is "reads like paper that's been properly typeset," not a dashboard, not a webpage.

[Hard visual signature — do not change]
- **Canvas**: warm parchment `#f5f4ed` (never pure white `#fff`). Secondary background `#efeee5`.
- **Ink**: primary text `#1f1d18` (near-black warm gray, not pure black `#000`). Secondary text `#6b665b`.
- **Sole accent color**: ink-blue `#1B365D` — every accent (links, tag outlines, key numbers, the left rule on quotes) uses this one color only; multiple accent colors are forbidden.
- **Fonts**: one serif per language, never mixed within a document:
  - Latin: `Charter` (fallback: `Source Serif Pro`, `Iowan Old Style`)
  - CJK: `TsangerJinKai02 W04` (fallback: `Noto Serif SC`)
  - Japanese: `YuMincho` (fallback: `Noto Serif JP`)
  - Body 400, Heading 500 (never 700/800/900).
- **Line height**: headings 1.1–1.3, tight body copy 1.4–1.45, reading-length body copy 1.5–1.55.
- **Never**: drop-shadow / blur / border-radius ≥ 8px / gradients / neon colors / rgba (use solid hex).
- **Details**: tags use a solid-hex background block (rgba doesn't render well in WeasyPrint); single-stroke geometric icons; a 1px hairline `#d4d1c5` rule at the edge, kept short of the full bleed.

[Optional document types — pick based on user content]
- **One-Pager** — logotype at top (Charter italic) + title + lede + a 3-column list of points + footer metadata.
- **Long Doc** — cover page (big title + subtitle + author + date) → table of contents (kicker + page no.) → chapters (folio in the top corner + section rule + body) → footnotes + a colophon at the end.
- **Letter** — letterhead address + date + recipient + body (left-aligned, 1.5em paragraph spacing) + signature line + a signature placeholder rule.
- **Portfolio** — a project hero (big title + sub) + one full-width image (drawn as a CSS block placeholder) + project description + a role / timeline / stack metadata row.
- **Resume** — name at the top (large) + a one-line tagline + a contact row + main sections: experience (company / dates / title / bullets) + skills + education.
- **Slides** — keynote-style, page count set by [user content] (short content starts at 6 pages, longer content should run more), each page fills the parchment canvas, big title + lede + a page-number folio, restrained enough to feel "printed."
- **Equity Report** — company name + ticker + Q × year + a key-metrics row (revenue / margin / yoy) + body analysis + a chart (single-color SVG line).
- **Changelog** — version number (large Charter italic) + date + a change list (Added / Changed / Fixed), separated by a single rule.

[Design principles]
- "Composed pages, not dashboards." Don't stack KPI cards, don't stack emoji icons, no hero gradients.
- "Ring or whisper only, no hard drop shadows." Shadows may only be a hairline outline like `0 0 0 1px #d4d1c5`.
- Text hierarchy comes from **serif contrast + size + whitespace**, never from color.
- Single-file HTML using the Tailwind CDN; add proper spacing between mixed-script runs; no hotlinked images — use a paper-tint block + 1px ink outline as a placeholder.
