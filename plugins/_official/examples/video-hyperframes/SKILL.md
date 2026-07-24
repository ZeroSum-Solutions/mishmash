---
name: video-hyperframes
zh_name: "Hyperframes 视频脚本"
en_name: "Hyperframes Video"
emoji: "🎞️"
description: "Hyperframes / Remotion-compatible continuous frame animation with autoplay support."
zh_description: "Hyperframes / Remotion 兼容的连续帧动画, 可自动播放"
en_description: "Hyperframes / Remotion-compatible continuous frame animation with autoplay support."
category: video
scenario: video
aspect_hint: "1920×1080 (16:9)"
recommended: 5
tags: ["video", "hyperframes", "remotion", "视频"]
example_id: sample-hyperframes-workflow
example_name: "Hyperframes · AI Workflow Video"
example_format: markdown
example_tagline: "8 auto-playing frames, with progress bar + metadata"
example_desc: "A cinematic animation script, ready to feed directly into Remotion to produce an mp4"
example_source_url: "https://github.com/heygen-com/hyperframes"
example_source_label: "heygen-com/hyperframes"
od:
  mode: video
  surface: video
  scenario: video
  featured: 0.13
  upstream: "https://github.com/nexu-io/html-anything"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt: "Use the Hyperframes Video template to turn my content into a Hyperframes / Remotion-compatible continuous frame animation with autoplay support. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「Hyperframes 视频脚本」模板把我的内容做成一段「Hyperframes / Remotion 兼容的连续帧动画, 可自动播放」。保持模板的视觉签名，使用真实内容和数据，避免 lorem ipsum 和占位图片。"
---

[Template: Hyperframes Video Frames]
- Output N consecutive `<section class="frame">` elements, each `w-[1920px] h-[1080px]`; N is determined by the information density of [the user's content] (a short script starts at 6-10 frames, a longer script should have more — each frame carries only one shot/concept).
- Each frame expresses one shot/concept: text + visual composition (centered composition / golden ratio / rule of thirds).
- Each frame carries a hidden marker at the bottom `<!-- frame:N duration:3000 transition:fade -->` for downstream Remotion / Hyperframes render scripts to read.
- Add a JavaScript autoplay block at the top: advance to the next frame every 3 seconds, also supporting click / arrow-key control; show a progress bar in the corner.
- Frame 1 is the hook (a data point / something counterintuitive / a question), frames 2-N are the argument, and the last frame is the conclusion + CTA.
- Type should be huge (text-9xl), one line at most — don't cram in more.
- Use one consistent cinematic palette (dark background + 1 neon accent color).
- End the output with a short comment block `<!-- HYPERFRAMES_META: ... -->` containing JSON metadata for each frame's duration / transition / sceneSummary, for later conversion to Remotion.
