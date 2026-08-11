---
name: taskora-saas-hero
description: |
  Full-viewport dark SaaS hero for the fictional project-management platform
  **Taskora**. A muted looping video fills the black backdrop behind a
  glassmorphism floating pill navbar, a massive headline that italicizes the
  word "Workflow" in a serif face, a "Trusted by" badge with a blue-gradient
  star, and a white "Book a Free Demo" CTA. Below the fold-line sits a
  light-mode product-shot mock of the Taskora dashboard — stat cards, a
  revenue bar chart, and a deals table — that grows into view on scroll.
  Everything degrades to a static poster frame and fully rendered charts
  under reduced motion.
tags:
  - "landing-page"
  - "motionsites"
  - "saas"
  - "hero-section"
  - "dark-mode"
  - "video-background"
  - "dashboard-mockup"
triggers:
  - "taskora"
  - "saas hero"
  - "dark hero section"
  - "video background hero"
  - "glassmorphism navbar"
  - "dashboard preview"
  - "product screenshot mockup"
  - "project management landing page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=2"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Taskora — SaaS Hero Section as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any dashboard data or footage to swap in."
---

# Taskora — SaaS Hero Section

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Full-viewport dark SaaS hero for the fictional project-management platform
**Taskora**. A muted looping video fills the black backdrop behind a
glassmorphism floating pill navbar, a massive headline that italicizes the
word "Workflow" in a serif face, a "Trusted by" badge with a blue-gradient
star, and a white "Book a Free Demo" CTA. Below the fold-line sits a
light-mode product-shot mock of the Taskora dashboard — stat cards, a
revenue bar chart, and a deals table — that grows into view on scroll.
Everything degrades to a static poster frame and fully rendered charts
under reduced motion.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name,
   headline, dashboard numbers, and footage. Match existing asset
   dimensions when swapping the background video.
3. **Preserve the design system.** The palette, type pairing, glass
   navbar, and motion in the build spec below are the identity — do not
   substitute fonts, recolor the palette, or strip the dashboard mockup.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. If a section is missing, design it from scratch in
   this template's own vocabulary.
5. **Keep motion accessible.** Every animation must stay behind
   `prefers-reduced-motion`, as the build spec requires.

## Build spec

### Palette

All chromatic and gradient colors live on `:root` so the recolor tooling can
retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#050505` | Hero background, CTA text color |
| `--fg` | `#ffffff` | Headline, CTA fill, navbar logo/links |
| `--muted` / `--muted-2` | `#9ca3af` / `#6b7280` | Subhead and secondary UI copy |
| `--glass-bg` / `--glass-border` | `rgba(255,255,255,0.08)` / `rgba(255,255,255,0.14)` | Navbar and mobile-menu glassmorphism |
| `--accent` / `--accent-2` | `#3b82f6` / `#22d3ee` | The chromatic pair — badge star, logo mark, revenue-chart bars |
| `--success` / `--danger` | `#16a34a` / `#ef4444` | Stat trend pills (up/down) in the dashboard mock |
| `--panel-bg` / `--panel-surface` / `--panel-fg` | `#f9f9fa` / `#ffffff` / `#101114` | The light-mode dashboard shell, cards, and text |

The badge's star icon, the navbar/sidebar logo marks, and the revenue-chart
bars all fill with `linear-gradient(…, var(--accent), var(--accent-2))`, so
a client recolor changes the brand hue everywhere at once. The hero's
top-to-bottom overlay (`rgba(0,0,0,0.6)` fading to `var(--bg)`) stays partly
literal since black is neutral scaffolding, not a brand accent.

### Typography

Four Google Fonts, matching the prompt's pairing exactly:

- **Instrument Serif** (italic only) — exclusively the word "Workflow" in
  the headline, `font-style: italic`, weight 400.
- **Manrope** (400–800) — the "Trusted by" badge, the subhead, and (since
  the prompt leaves the rest of the headline's face unassigned) the
  headline's non-italic text at weight 800, `clamp(2.75rem, 7vw, 5rem)`.
- **Cabin** (500/600) — the "Book a Free Demo" CTA only.
- **Inter** / **Inter Tight** — navbar links and every label, value, and
  table cell inside the dashboard mock.

### Layout

1. **Floating navbar** — a fixed, centered glassmorphism pill
   (`backdrop-filter: blur(18px)`) holding the Taskora logo mark + wordmark
   on the left, `Home / Features / Company / Contact` centered, and
   `Sign Up` (text) + `Sign In` (white pill) on the right. Under 780px the
   links and auth buttons collapse into a hamburger button that expands a
   glassmorphism dropdown (`grid-template-rows: 0fr → 1fr`) below the pill.
2. **Hero content** — centered column over the video:
   - **Badge**: pill with a blue-gradient star SVG + "Trusted by +30,000
     clients globally".
   - **Headline (`<h1>`)**: "Simplify Your *Workflow*. Stay Focused." with
     "Workflow" wrapped in `<em>` for the serif-italic treatment.
   - **Subhead**: "Taskora helps teams manage projects, tasks, and
     deadlines with clarity." in muted gray.
   - **CTA**: white pill, black text, "Book a Free Demo".
3. **Dashboard preview** — a `<figure role="img" aria-label="…">` wrapping
   an `aria-hidden` mock (the fake data has no independent meaning for
   assistive tech beyond "product screenshot"): a light `#F9F9FA` panel
   with a 68px icon sidebar, a header (search field, bell, avatar stack),
   three stat cards (Total Sales / Operating Expenses / Gross Profit, each
   with a trend pill and a 6-bar mini chart), a 12-bar gradient revenue
   chart, and a 4-row deals table (Deal Name, Company, Amount, Date, Owner,
   Stage). The prompt's example company ("Amazon.com") is de-branded to
   fictional deal companies (Lumecart, Northbridge Retail, Solace
   Analytics, Vale & Co) with letter-monogram logos.

### Motion inventory

- **Load-in fade-up**: badge, headline, subhead, CTA, and the dashboard
  shot each animate `opacity 0 → 1` / `translateY(24px) → 0` over 800ms via
  `IntersectionObserver`, staggered `0.05s → 0.52s`, easing
  `cubic-bezier(0.23, 1, 0.32, 1)`.
- **Dashboard chart grow-in**: the mini bar charts (stat cards) and the
  12-bar revenue chart sit at a near-zero height until the dashboard mock
  scrolls into view, then transition to their real heights (`height`
  700–900ms) exactly once.
- **CTA hover/active**: `scale(1.035)` + brighter shadow on hover (220ms),
  `scale(0.98)` on active (140ms). Never scales from 0.
- **Navbar toggle**: hamburger lines rotate into an X; the mobile dropdown
  expands via a `grid-template-rows` transition (260ms) rather than
  `height: auto`, so it animates smoothly without JS height measurement.
- **Ambient loop**: the background video autoplays, loops, and stays muted
  via HTML attributes; a small inline script calls `.play()` defensively.
- **`prefers-reduced-motion: reduce`**: all fade-ups render fully visible
  with no transform, the CTA's hover/active transforms are disabled, the
  navbar/menu transitions are removed, every chart bar jumps straight to
  its final height with no transition, and the `<video>` is hidden and
  paused in favor of its vendored poster-frame `<img>` — a fully static
  page.

### Assets

- `assets/hero-bg.mp4` — the source CloudFront MP4 (1720×1204, ~9.4MB)
  downscaled to 720p muted H.264 (~410KB, ~10s loop) with `ffmpeg`.
- `assets/hero-poster.jpg` — a frame extracted from the transcoded video,
  used as the `<video poster>` and as the reduced-motion `<img>` fallback.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="taskora-saas-hero" type="text/html" title="Taskora — SaaS Hero Section">
<!doctype html>
<html>...</html>
</artifact>
```
