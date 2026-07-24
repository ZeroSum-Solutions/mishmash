---
name: data-report
zh_name: "数据可视化报告"
en_name: "Data Visualization Report"
emoji: "📊"
description: "Turns CSV, Excel, or JSON data into a polished visual report page."
zh_description: "把 CSV/Excel/JSON 数据转成漂亮的可视化报告页"
en_description: "Turns CSV, Excel, or JSON data into a polished visual report page."
category: data
scenario: finance
aspect_hint: "Desktop long-scroll page"
featured: 10
tags: ["data", "report", "chart", "数据", "报告"]
example_id: sample-data-weekly-report
example_name: "Data Report · Weekly Report"
example_format: csv
example_tagline: "KPI cards + Chart.js charts + table"
example_desc: "9 months of growth data auto-rendered into a visual report, with inline Chart.js"
od:
  mode: prototype
  surface: web
  platform: desktop
  scenario: finance
  upstream: "https://github.com/nexu-io/html-anything"
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: false
  example_prompt: "Use the Data Visualization Report template to turn my CSV, Excel, or JSON data into a polished visual report page. Preserve the template's visual signature, use real content and data, and avoid lorem ipsum or placeholder images."
  example_prompt_i18n:
    zh-CN: "用「数据可视化报告」模板把我的内容做成一份「把 CSV/Excel/JSON 数据转成漂亮的可视化报告页」。保持模板的视觉签名，使用真实内容和数据，避免 lorem ipsum 和占位图片。"
---

[Template: Data Visualization Report]
- Header: report title + time range + a data-source note.
- KPI card grid: 3-5 of the most important metrics, each card showing the value + YoY change + a mini trend line.
- Main chart area: at least 2 charts (bar / line / pie / scatter), using Chart.js or ECharts (loaded via jsdelivr CDN), with data parsed from the user's input.
- **Chart containers must have a fixed height**: wrap each `<canvas>` in an outer `<div style="position:relative;height:NNNpx">` (KPI mini-charts ~40px, main charts ~240–280px). With Chart.js's `responsive:true, maintainAspectRatio:false`, if the parent container has no explicit height, it falls into a ResizeObserver infinite loop and the chart grows without bound until the browser locks up. **Never** set a `height=` attribute directly on the canvas as layout — that's only an initial value.
- Data table: an excerpt of the user's raw data, using `<table>` + modern styling (zebra stripes, hover, sticky header).
- Insight block: 3-5 text insights, each starting with an emoji, like a product weekly report.
- Bottom collapsible "methodology" section.
- Restrained, professional palette: 1 primary color + a neutral scale, charts drawn from the palette.
- **Must parse the actual data the user provides**, never fabricate it.
