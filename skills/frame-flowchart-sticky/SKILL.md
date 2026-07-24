---
name: frame-flowchart-sticky
zh_name: "便利贴流程图帧"
en_name: "Sticky Flowchart Frame"
emoji: "📝"
description: "SVG curve connectors, sticky-note nodes, and cursor interaction with a whiteboard-brainstorm feel."
zh_description: "SVG 曲线连接 + 便利贴节点 + 光标交互, 像白板 brainstorm"
en_description: "SVG curve connectors, sticky-note nodes, and cursor interaction with a whiteboard-brainstorm feel."
category: video
scenario: operations
aspect_hint: "1920×1080 (16:9)"
featured: 45
tags: ["flowchart", "diagram", "sticky", "whiteboard", "frame"]
example_id: sample-frame-flowchart-sticky
example_name: "Sticky Note Flowchart · User Onboarding"
example_format: markdown
example_tagline: "SVG curves + 4-color sticky notes"
example_desc: "6-node onboarding flow, handwriting font + whiteboard-paper background"
example_source_url: "https://hyperframes.heygen.com/catalog"
example_source_label: "hyperframes · flowchart"
od:
  mode: video
  surface: video
  scenario: operations
  upstream: "https://github.com/nexu-io/html-anything"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt: "Use the Sticky Flowchart Frame template to turn my content into a whiteboard-brainstorm frame with SVG curve connectors, sticky-note nodes, and cursor interaction. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「便利贴流程图帧」模板把我的内容做成一段「SVG 曲线连接 + 便利贴节点 + 光标交互, 像白板 brainstorm」。保持模板的视觉签名，使用真实内容和数据，避免 lorem ipsum 和占位图片。"
---

[Template: Sticky Flowchart Frame]
[Intent] Turn a process / system / workflow into a "whiteboard + sticky notes" look, suited to onboarding videos, ops-process explainers, and system-architecture walkthroughs. Inspired by hyperframes flowchart.

[Canvas] 1920×1080. Background: beige whiteboard paper `#f4ede1` or cool-gray whiteboard `#f0f2f4`; add a very faint hex grid `rgba(0,0,0,0.04)` for a whiteboard feel.

[Nodes (Sticky Notes)]
- Each node = a 240×180px sticky note, randomly assigned one of 4 colors: yellow `#fcd34d` / peach `#fca5a5` / mint `#a7f3d0` / sky `#a5b4fc`.
- Notes have a slight, inconsistent rotation `transform: rotate(±2deg)`, a drop shadow `drop-shadow(0 6px 14px rgba(0,0,0,0.12))`, and decorative tape at the top via `linear-gradient(...)`.
- Node content: 1 emoji or single-line SVG icon + a large title (16-20px) + one line of description (12px).
- Node font: `Kalam` / `Caveat` / `Patrick Hand` handwriting-style fonts (for Chinese, use `霞鹜文楷` / `LXGW WenKai Screen`).

[Connectors (SVG)]
- Connect nodes with `<path>` Bezier curves, stroke `#2a2a2a`, width 2.5, `stroke-linecap: round`, `stroke-dasharray: 0` (solid) or `8 6` (dashed = conditional branch).
- Arrow ends via `marker-end`, small black triangular arrowheads.
- Complex nodes can loop or branch: 2 lines out of the same node (fork) or 2 lines into one node (merge).

[Optional interaction]
- Top caption (sans, 12px uppercase): "FLOW · MIGRATION · 2026".
- Hover a node: lift its shadow + scale 1.05, via CSS transition.
- A "cursor" decoration (`<svg>` arrow + name tag) floating next to a node, simulating a Figma collaboration cursor.

[Design details]
- At least 5 nodes, at most 12.
- Don't center-align every node — aim for a whiteboard "stuck on by hand" feel, while keeping connectors clear and non-crossing.
- Forbidden: fullscreen dark background, neon colors, corporate-dashboard style.
- Font must not be Inter / serif — it must feel handwritten.
- Single-file HTML, no external icon libraries (use inline SVG).
- Must use the user's real process content; node text comes directly from the user's input.
