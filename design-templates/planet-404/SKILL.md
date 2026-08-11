---
name: planet-404
description: |
  Full-page 404 error screen for a fictional hosting company, "NEXOVA."
  A single viewport-tall layout: a looping cinematic video of Earth seen
  from orbit fills the background; a translucent nav bar with a four-petal
  logo mark sits on top; a centered hero stacks two light-weight subtitle
  lines, a giant glowing "404," and a glassmorphic "Return to Main Page"
  pill; a six-column footer (four link columns plus a newsletter/social
  column) rests against the planet's lit horizon. A slide-down mobile menu,
  a real newsletter form with an inline success state, and a
  prefers-reduced-motion fallback round out the interaction.
tags:
  - "landing-page"
  - "motionsites"
  - "404"
  - "error-page"
  - "hosting"
  - "video-background"
triggers:
  - "404 page"
  - "error page"
  - "not found page"
  - "planet 404"
  - "nexova"
  - "hosting 404"
  - "earth background 404"
  - "space themed error page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=404-planet"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build the NEXOVA 404 Planet page as a self-contained page in this template's own visual system. Follow the build spec below exactly — the orbital video backdrop, the giant glowing 404, the liquid-glass button, and the six-column footer are part of the identity. Ask only for the missing essentials first: brand name, real nav/footer links, and a replacement background clip."
---

# NEXOVA — 404 Planet

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Full-page 404 for a fictional hosting company, "NEXOVA." The whole page is one
flex column stacked on top of a full-bleed looping video of Earth from orbit:
a nav bar, a centered hero with the 404 message, and a footer that sits low
enough to rest against the planet's glowing horizon line.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, nav
   labels, footer links, and background clip. Keep image/video crop and
   aspect when swapping the orbital footage for another clip.
3. **Preserve the design system.** The palette, type scale, spacing rhythm,
   and motion in the build spec below are the identity — do not substitute
   fonts, recolor the emerald/cyan accent, or strip the glass effects.
4. **Extend by duplicating sections**, never by importing a layout from
   another template.
5. **Keep motion accessible.** The background video pauses and the mobile
   menu's stagger reduces to an instant swap under
   `prefers-reduced-motion`, as the build spec requires.

## Build spec

The finished page, described from what actually ships in `example.html`.

### Palette tokens (`:root`)

- `--emerald-400: #34d399` and `--cyan-500: #06b6d4` — the one chromatic
  accent pair, used as `linear-gradient(to right, var(--emerald-400),
  var(--cyan-500))` on the "LOG IN" pill and the newsletter "Send It" button.
  Recoloring these two vars re-tints every gradient surface on the page.
- Everything else (near-black scaffolding, white text, glass overlays) is
  literal — it is neutral chrome over a video, not a brand surface.

### Typography

Prompt specifies "Helvetica Now Var," a commercial variable font not on
Google Fonts. Substituted with **Inter** (weights 300–900) as the closest
free equivalent with the same wide weight range (light 300 subtitles through
black 900 for the "404" numerals). Loaded via the Google Fonts CDN link in
`<head>`.

### Layout, top to bottom

1. **Background video** — `assets/earth-orbit-bg.mp4` (720p, muted, ~10s
   loop, no audio track), `position: absolute; inset: 0; object-fit: cover`
   behind everything, with `assets/earth-orbit-poster.jpg` as the `poster`
   fallback frame.
2. **Nav bar** — logo (inline four-petal SVG mark + "NEXOVA" wordmark),
   center link row (`Domain / Servers / Cloud / Managed / Email / Privacy`,
   hidden below 1024px), a gradient "LOG IN" pill with an arrow icon (hidden
   below 1024px), and a hamburger button (shown below 1024px) that
   cross-fades between menu/close icons.
3. **Mobile menu** — a `backdrop-filter: blur` panel with a separate
   click-to-close backdrop; links stagger in with a 50ms-per-item delay,
   opening state closes on Escape, backdrop click, link click, or a resize
   past 1024px.
4. **Hero** — two `font-weight: 300` subtitle lines, a giant `clamp`-free
   `font-weight: 900` "404" (80px mobile → 260px at 1024px) with a soft
   white text-shadow glow, and a `liquid-glass` pill button ("Return to Main
   Page") with a hairline gradient border built from a masked `::before`.
5. **Footer** — a responsive grid (2 cols mobile → 4 at 768px → 6 at
   1024px): four link columns (Servers, Domains, Help Us, About) plus a
   two-column newsletter/social block. The newsletter is a real `<form>`
   with a visually-hidden `<label>`, `type="email"`, and `autocomplete`; JS
   intercepts `submit`, validates, hides the form, and shows an inline
   success message. Six social links use hand-drawn inline SVGs (no icon
   font, no emoji).

### Motion inventory

- Nav link/button color and login-button lift on hover/focus
  (`transition`, no transform-from-zero).
- Hamburger ↔ close icon cross-fade + rotation, 300ms.
- Mobile menu: backdrop opacity fade (400ms) + panel link stagger
  (`transition-delay` 350ms + 50ms per item, `translateY(12px) → 0`,
  400ms ease-out on open; instant on close after a 500ms unmount timer).
- "Return to Main Page" button lifts 2px on hover/focus.
- Newsletter button hover brightness bump; submit swaps the form for an
  inline checkmark success line.
- Background video loops continuously; JS pauses it and drops `autoplay`
  under `prefers-reduced-motion`, and a matching `@media` block collapses
  every CSS transition/animation duration to near-zero.

### Accessibility affordances

- Hamburger button carries `aria-expanded`/`aria-controls`/`aria-label`
  that update with state; Escape closes the menu and returns focus to the
  toggle; opening moves focus to the first menu link.
- Focus-visible outline (cyan) on every interactive element.
- Newsletter `<input>` has a real (visually-hidden) `<label>`, `required`,
  and browser validation surfaced via `reportValidity()` before the
  intercepted submit swaps in the success state.
- All decorative icons are `aria-hidden`; all icon-only links carry
  `aria-label`.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="planet-404" type="text/html" title="NEXOVA — 404 Planet">
<!doctype html>
<html>...</html>
</artifact>
```
