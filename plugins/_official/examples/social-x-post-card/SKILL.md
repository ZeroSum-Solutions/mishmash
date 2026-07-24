---
name: social-x-post-card
zh_name: "X (Twitter) 帖子卡"
en_name: "X / Twitter Post Card"
emoji: "𝕏"
description: "Realistic X post card with engagement metrics (likes, reposts, views), suited to video overlays or shareable image cards."
zh_description: "拟真 X 推文卡片 + 互动数据 (likes/reposts/views), 适配视频叠加或图卡分享"
en_description: "Realistic X post card with engagement metrics (likes, reposts, views), suited to video overlays or shareable image cards."
category: card
scenario: marketing
aspect_hint: "1280×720 or 1080×1080"
featured: 44
tags: ["twitter", "x", "social", "card", "overlay"]
example_id: sample-social-x-post-card
example_name: "X Post Card · AlchainHust Quote"
example_format: markdown
example_tagline: "X dark mode + engagement metrics"
example_desc: "A quote tweet + 12.3K likes / 1.2K reposts + verified badge"
example_source_url: "https://hyperframes.heygen.com/catalog"
example_source_label: "hyperframes · x-post"
od:
  mode: prototype
  surface: web
  platform: desktop
  scenario: marketing
  upstream: "https://github.com/nexu-io/html-anything"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt: "Use the X / Twitter Post Card template to turn my content into a realistic X post card with engagement metrics for a video overlay or shareable image card. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「X (Twitter) 帖子卡」模板把我的内容做成一份「拟真 X 推文卡片 + 互动数据 (likes/reposts/views), 适配视频叠加或图卡分享」。保持模板的视觉签名，使用真实内容和数据，避免 lorem ipsum 和占位图片。"
---

[Template: X (Twitter) Post Card]
[Intent] Render a tweet (or the user's own quote) as a highly realistic X post card, for use in video overlays, tweet sharing, or knowledge capture. Inspired by hyperframes x-post.

[Canvas] 1280×720 or 1080×1080, dark background `#0f1419` or light background `#ffffff` (matching X's theme); card centered, soft shadow.

[Card structure]
- Outer frame: 16px corner radius, 1px border `#2f3336` (dark) / `#eff3f4` (light), 16px padding.
- Top row: avatar (48×48 circle, CSS gradient placeholder) + display name + `@username` handle + verified blue checkmark + timestamp (mono, 12px, gray).
- Body: 17-22px, weight 400; links in X blue `#1d9bf0`; hashtags same color; mentions same color; 0.6em paragraph spacing.
- Optional: a quoted-tweet card (nested small card, gray background, 12px corner radius).
- Optional: 1 image (CSS gradient + description placeholder, no external image links), 16:9 ratio, 12px corner radius.
- Engagement row: 4 icons + numbers (reply / repost / quote / like), icons as inline SVG (X's official style), gray, color-shift on hover.
- Top-right: single-line SVG X logo.
- View count row: 👁️ + number (small text).

[Fonts]
- Latin: `Chirp` (X's font) -> fallback `Inter` or `Segoe UI`.
- CJK: `Noto Sans SC` / `PingFang SC`.
- Numbers: same as the primary font, not mono.

[Design details]
- Light palette: bg `#fff`, text `#0f1419`, secondary `#536471`, border `#eff3f4`, accent `#1d9bf0`.
- Dark palette (recommended for video overlays): bg `#000`, text `#e7e9ea`, secondary `#71767b`, border `#2f3336`, accent `#1d9bf0`.
- Number formatting: 1.2K / 4.5M (never raw numbers like 1234).
- Content must come from the user's input; never fabricate a tweet.
- If the user's input is data -> auto-summarize it into a "quote" tweet (≤280 characters).
- Single-file HTML; icons inline SVG; no external image URLs of any kind.
- Optional: add a subtle radial highlight `radial-gradient(...)` behind the card for better readability in video overlays.
