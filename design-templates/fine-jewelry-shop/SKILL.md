---
name: fine-jewelry-shop
description: |
  A luxury jewelry mobile-app concept for the fictional brand **Azure Vale**, shown centered inside a realistic iPhone mockup on a warm off-white page. A brand-orange hero fills the top of the screen with a pavé-ring hero photo, awards counter, and a slide-in mobile menu; a white product card below shows the Aura Crush ring with a mount-in reveal, price, and an arrow CTA. Built with semantic HTML, vanilla CSS, and eleven staggered mount-in keyframe animations.
tags:
  - "landing-page"
  - "motionsites"
  - "ecommerce"
  - "mobile-app"
  - "luxury"
  - "jewelry"
triggers:
  - "azure vale"
  - "fine jewelry"
  - "jewelry shop"
  - "luxury ecommerce"
  - "iphone mockup"
  - "mobile app concept"
  - "product card"
  - "ring"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=fine-jewelry-shop"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Azure Vale — a luxury fine-jewelry mobile app concept shown inside a realistic iPhone mockup — as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — the phone-frame chrome, hero palette, awards counter, product card, and mount-in stagger animations are part of the identity. Ask only for the missing essentials first: brand name, real product copy, and any imagery to swap in."
---

# Azure Vale — Fine Jewelry Mobile App Concept

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single realistic iPhone mockup (375×812) centered on a warm off-white page. The
phone's screen holds two stacked sections: a brand-orange hero that fills roughly
three-quarters of the height, and a white product card fixed at 220px tall. A
hamburger button opens a full-height slide-in drawer with five staggered nav links.
Eleven elements mount in with a staggered scroll-free reveal on page load.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, product name,
   copy, price, and photography. Keep the hero photo's crop and the product photo's
   crop when swapping — both are positioned with exact percentage offsets tuned to
   this composition.
3. **Preserve the design system.** The phone-frame chrome, the brand-orange /
   brand-peach / brand-dark palette, the type scale, and the eleven-step stagger
   sequence are the identity — do not substitute the frame proportions, recolor the
   palette, or drop the stagger timing.
4. **Extend by duplicating the product card pattern** for additional products,
   never by importing a card layout from another template.
5. **Keep motion accessible.** Every stagger and drawer transition sits behind
   `prefers-reduced-motion`, as the build spec below requires.

## Build spec

### Palette (recolor-compatible tokens on `:root`)

| Token | Value | Role |
| --- | --- | --- |
| `--page-bg` | `#f5f5f0` | Warm off-white page background behind the phone |
| `--brand-orange` | `#E96B00` | Hero background, menu drawer fill |
| `--brand-peach` | `#F6BB7E` | Glow accents (radial-gradient stops) |
| `--brand-dark` | `#0B2122` | Price / label text on the white card |

Both radial-gradient glows (`.hero-glow-bg`, `.hero-glow`) reference `var(--brand-peach)`
so MishMash's recolor pass can retint them.

### Typography

Body copy: **Archivo** (Google Fonts, weights 300/400/500/700) at weight 300,
substituting for the prompt's non-Google "Test Founders Grotesk Light" — the
nearest available Google grotesque at a comparable light weight. The logo
("Azure" / "Vale", weight 700) substitutes for the prompt's non-Google
"NimbusSanExt" the same way, using Archivo Bold instead of loading a second
webfont family for a two-word wordmark.

### Layout, top to bottom

1. **Phone frame** — 375×812px, `border-radius: 55px`, black body with 12px
   padding, dual drop-shadow plus an inset white/10 border highlight. Side
   buttons (silent switch, two volume buttons, power button) are decorative
   `aria-hidden` divs. A 126×36px Dynamic Island pill sits centered at the top.
2. **Nav** — absolutely positioned over the hero, `padding: 56px 16px 0`. Logo
   wordmark on the left (two stacked lines); a 40×40px hamburger button on the
   right that crossfades/rotates its Menu icon into an X icon.
3. **Hero** — `flex: 1 1 auto`, solid `--brand-orange` background, two vertical
   grid lines at 33%/66% width, a 600×600px blurred peach glow, and the hero
   photo pinned to the bottom edge at 132% width (deliberately overflowing the
   frame). An awards counter (`[12+]`) sits bottom-left; a three-line uppercase
   label ("Awards / Celebrate / Innovation") sits bottom-right.
4. **Product card** — fixed 220px white panel. Product name + material subtitle
   top-left, centered product photo at 70% width, price block bottom-left, and
   a 72×68px black arrow button anchored to the bottom-right corner.
5. **Mobile menu overlay** — a full-screen blurred backdrop plus an 80%-width
   (max 280px) drawer sliding in from the left, filled with `--brand-orange`.
   Five links (Search, Catalog, About, Profile, Favorites) stagger in with
   50ms-spaced delays starting at 80ms.

### Motion inventory

- **Mount-in stagger** — three keyframe families (`stagger-up` translateY+fade
  0.7s, `stagger-scale` scale 0.92→1 + fade 0.8s, `stagger-fade` pure fade
  0.8s), all `cubic-bezier(0.16, 1, 0.3, 1)`. Eleven elements fire in sequence
  on load at `100ms + 120ms × index` delays (grid lines → logo → menu button →
  hero image → awards left → awards right → card → product text → product
  photo → price row → arrow button).
- **Menu icon crossfade** — Menu/X icons rotate + scale + fade, 300ms
  `cubic-bezier(0.77, 0, 0.18, 1)`.
- **Drawer slide** — backdrop fade 500ms `ease`; drawer `translateX` 500ms
  `cubic-bezier(0.77, 0, 0.18, 1)`; nav links stagger in on open at 50ms
  intervals from an 80ms base.
- **Hover/focus** — arrow button darkens on hover/focus-visible; menu links
  nudge 2px and dim to 80% opacity.
- All of the above collapse to their end state instantly under
  `@media (prefers-reduced-motion: reduce)`.

### Accessibility

- Hamburger button is a real `<button>` with `aria-expanded` / `aria-controls`;
  the drawer is a labeled `<nav>` with a focus trap (Tab/Shift+Tab wrap) and
  Escape-to-close, returning focus to the toggle on close.
- Opening the drawer moves focus to its first link; clicking a link, the
  backdrop, or Escape all close it.
- The arrow CTA and menu toggle both carry `aria-label`s describing their
  action, and both show a visible focus ring.

### De-branding note

The source prompt names a real jewelry retailer ("Blue Nile") and a real Chanel
fine-jewelry line ("Coco Crush ring") — the vendored product photo even carried
a "© CHANEL" engraving baked into the ring's pixels. This build renames the
brand to the fictional **Azure Vale** (preserving the two-stacked-word wordmark
treatment) and the product to the fictional **Aura Crush ring** (preserving the
"[Name] Crush ring" structure), and the engraving was removed from the vendored
image pixel data.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="fine-jewelry-shop" type="text/html" title="Azure Vale — Fine Jewelry Mobile App Concept">
<!doctype html>
<html>...</html>
</artifact>
```

