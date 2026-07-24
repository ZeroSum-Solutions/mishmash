---
name: frame-macos-notification
zh_name: "macOS 通知横幅"
en_name: "macOS Notification Banner"
emoji: "🔔"
description: "Realistic macOS notification banner with app icon, title, and body, suited to video overlays or product teasers."
zh_description: "拟真 macOS 通知 banner + app icon + 标题正文, 适合 video overlay / 产品发布预告"
en_description: "Realistic macOS notification banner with app icon, title, and body, suited to video overlays or product teasers."
category: card
scenario: video
aspect_hint: "1920×1080 video or a 480×120 banner"
featured: 41
tags: ["macos", "notification", "banner", "overlay", "frame"]
example_id: sample-frame-macos-notification
example_name: "macOS Notification · New Feature Launch"
example_format: markdown
example_tagline: "Big Sur frosted-glass banner"
example_desc: "App icon + title + two-line body, for video corner overlays"
example_source_url: "https://hyperframes.heygen.com/catalog"
example_source_label: "hyperframes · macos-notification"
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
  example_prompt: "Use the macOS Notification Banner template to turn my content into a realistic macOS notification banner for a video overlay or product teaser. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「macOS 通知横幅」模板把我的内容做成一段「拟真 macOS 通知 banner + app icon + 标题正文, 适合 video overlay / 产品发布预告」。保持模板的视觉签名，使用真实内容和数据，避免 lorem ipsum 和占位图片。"
---

[Template: macOS Notification Banner]
[Intent] Render an announcement / message / prompt as a macOS Big Sur+-style notification banner, suited to video corner overlays, product-launch teasers, or social cards. Inspired by hyperframes macos-notification.

[Canvas] Two use cases:
- Video overlay 1920×1080, notification placed top-right, transparent elsewhere.
- Standalone banner 480×120, centered output.

[Banner structure]
- Outer frame: 14px corner radius (macOS Big Sur standard), 480×120 (or taller 480×180 with body text), 12-16px padding.
- Background: **frosted glass** effect — `background: rgba(245,245,247,0.78)` + `backdrop-filter: blur(40px) saturate(180%)`; dark variant `rgba(28,28,30,0.78)`.
- Border: 1px `rgba(0,0,0,0.06)` (light) / `rgba(255,255,255,0.08)` (dark); add a 1px bright highlight `rgba(255,255,255,0.5)` at the top.
- Shadow: `0 10px 40px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08)`.

[Content]
- Left: **app icon** (44×44, 10px corner radius, CSS gradient + one emoji or monogram letter, **no external image links**).
- Middle:
  - Top row: app name (SF Pro 13px, weight 600) + `now` or a specific time (12px, opacity 0.6) — justified to both ends.
  - Title (15px, weight 600, truncated to 1 line).
  - Body (13px, weight 400, truncated to 1-2 lines, line-height 1.35).
- Right (optional): action button "Open" or "Reply" (capsule shape, light-gray background).

[Fonts]
- Primary: `SF Pro Text` -> fallback `Inter` / `system-ui`; for CJK use `PingFang SC` / `Noto Sans SC`.

[Optional extras]
- Stacked notifications: the first one in front, the next 2 recede behind it (scale 0.96 + opacity 0.6 + translateY).
- Entrance animation: slide in from off-screen right `transform: translateX(110%)->0`, 200ms ease-out; can be disabled via `prefers-reduced-motion`.
- Top-right control chip "Clear" (shown on hover, opacity 0 by default).

[Design details]
- Light mode: white frosted background; dark mode (recommended for video): near-black frosted background.
- Icons must not use external emoji image links — use unicode emoji or draw geometry in CSS.
- Must use the user's provided content; title + body must come clearly from the user's input.
- Single-file HTML; note that `backdrop-filter` needs the `-webkit-` prefix in Safari.
