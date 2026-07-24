---
name: ppt-keynote
zh_name: "Keynote 风格 PPT"
en_name: "Keynote-style Slides"
emoji: "🎬"
description: "Apple Keynote-quality slides, one card per screen, with keyboard left/right navigation."
zh_description: "苹果 Keynote 级别幻灯片, 一屏一卡, 键盘左右切换"
en_description: "Apple Keynote-quality slides, one card per screen, with keyboard left/right navigation."
category: slides
scenario: marketing
aspect_hint: "16:9 (1280×720)"
featured: 19
tags: ["slides", "deck", "presentation", "幻灯片", "演讲"]
example_id: sample-ppt-html-anything
example_name: "Keynote Deck · Product Intro"
example_format: markdown
example_tagline: "7 slides explaining the product"
example_desc: "An Apple Keynote-style product introduction, ←/→ to navigate"
od:
  mode: deck
  surface: web
  scenario: marketing
  upstream: "https://github.com/nexu-io/html-anything"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt: "Use the Keynote-style Slides template to turn my content into Apple Keynote-quality slides with one card per screen and keyboard left/right navigation. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「Keynote 风格 PPT」模板把我的内容做成一套「苹果 Keynote 级别幻灯片, 一屏一卡, 键盘左右切换」。保持模板的视觉签名，使用真实内容和数据，避免 lorem ipsum 和占位图片。"
---

[Template: Keynote-style Slides]
- Each slide is a `<section class="slide">`, 1280 wide by 720 tall overall, centered on screen, gradient background.
- Keep each slide's content minimal: a large title + 1-3 lines of supporting text; or a single data chart; or one quote.
- Type sizes: title `text-7xl font-semibold tracking-tight`, subtitle `text-2xl text-neutral-500`.
- The first slide is the cover (topic + speaker / date); the last slide is "Thanks." or a call to action.
- A small indicator top-right: current slide / total slides.
- Add JavaScript listening for ArrowLeft / ArrowRight / spacebar to switch slides; also maintain the URL hash (#/3).
- Fade-in animation between slides.
- Keep generous whitespace, align data cards to a grid layout, restrained color use.
