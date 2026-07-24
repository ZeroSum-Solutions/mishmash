---
name: ppt-keynote
en_name: "Present an Operating-Model Redesign like a Strategy Engagement Lead"
zh_name: "像战略项目负责人一样讲运营模式重设计"
description: |
  An operating-model redesign for a scaling logistics firm — the diagnosis, the target model, and the transition roadmap. Built as a decision-grade consulting deck for client sponsor, ops leaders.
en_description: |
  An operating-model redesign for a scaling logistics firm — the diagnosis, the target model, and the transition roadmap. Built as a decision-grade consulting deck for client sponsor, ops leaders.
zh_description: |
  像战略项目负责人一样讲运营模式重设计——一份可商业交付的咨询交付 Deck，围绕真实主题、证据链与决策目标组织。
tags:
  - "consulting"
  - "consulting-final-deck"
  - "strategy"
  - "consulting-deliverable"
  - "client"
  - "decision-deck"
  - "commercial-slide-agent"
  - "ppt-keynote"
triggers:
  - "consulting-final-deck"
  - "consulting"
  - "Present an Operating-Model Redesign like a Strategy Engagement Lead"
  - "像战略项目负责人一样讲运营模式重设计"
  - "consulting-deliverable"
  - "strategy"
  - "client"
  - "html deck"
  - "html slides"
emoji: "🎬"
category: slides
scenario: marketing
aspect_hint: "16:9 (1280×720)"
featured: 19
example_id: sample-ppt-html-anything
example_name: "Keynote Deck · Product Intro"
example_format: markdown
example_tagline: "7 slides explaining the product"
example_desc: "An Apple Keynote-style product introduction, ←/→ to navigate"
od:
  mode: deck
  surface: web
  upstream: "https://github.com/nexu-io/html-anything"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt_i18n:
    zh-CN: "用「Keynote 风格 PPT」模板把我的内容做成一套「苹果 Keynote 级别幻灯片, 一屏一卡, 键盘左右切换」。保持模板的视觉签名，使用真实内容和数据，避免 lorem ipsum 和占位图片。"
  category: "consulting"
  scenario: "strategy"
  example_prompt: "Create \"Present an Operating-Model Redesign like a Strategy Engagement Lead\" as a decision-grade Consulting deck in this template's own visual system. Subject: An operating-model redesign for a scaling logistics firm — the diagnosis, the target model, and the transition roadmap. Audience: client sponsor, ops leaders. First ask only for missing essentials: audience, decision target, source-of-truth materials, deadline, and must-keep numbers. Then produce the slide plan, written slides, visual direction, speaker-ready structure, and a critic pass against this rubric: would a client know what to do Monday morning."
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
