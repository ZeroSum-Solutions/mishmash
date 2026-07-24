---
name: card-twitter
zh_name: "Twitter 分享卡"
en_name: "Twitter Share Card"
emoji: "🐦"
description: "Twitter quote or data card designed to pair with a post."
zh_description: "推特金句 / 数据卡, 适合配推文"
en_description: "Twitter quote or data card designed to pair with a post."
category: card
scenario: marketing
aspect_hint: "1600×900 (16:9)"
tags: ["twitter", "x", "quote", "金句"]
example_id: sample-twitter-quote
example_name: "Twitter Card · Quote"
example_format: text
example_tagline: "16:9 dark quote card, screenshot straight into a tweet"
example_desc: "A high-contrast quote template, with a grid pattern + gradient glow background"
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
  example_prompt: "Use the Twitter Share Card template to turn my content into a Twitter quote or data card designed to pair with a post. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「Twitter 分享卡」模板把我的内容做成一份「推特金句 / 数据卡, 适合配推文」。保持模板的视觉签名，使用真实内容和数据，避免 lorem ipsum 和占位图片。"
---

[Template: Twitter Share Card]
- Container `w-[1600px] h-[900px]`, pick dark or light based on the content's mood.
- One central hero quote (text-6xl, font-semibold, capped at 2-3 lines).
- Author byline below + avatar placeholder + handle.
- Small tag top-left (type: "Insight" / "Data" / "Quote").
- Brand watermark bottom-right.
- The whole card has a subtle texture (grid pattern / noise / dot pattern).
- Meant to be screenshotted and posted directly with a tweet — visually simple and punchy.
