---
name: automotive-ai-landing
description: |
  Scroll-scrubbed cinematic hero for **AUREN**, a fictional private AI-driver
  waitlist landing page. A full-viewport pinned hero plays a night-driving
  video that expands from a small floating clip into a fullscreen shot as the
  user scrolls, cross-fading through an assembled wordmark-and-title beat, an
  IntersectionObserver-style story sequence (two headline words flying past
  in 3D, a reactive-looking audio waveform, and a hand-drawn route with
  checkpoint stamps), before settling on a persistent email waitlist form.
  Dark near-black-to-cool-blue palette, Orbitron display type over Inter
  Tight body copy, one self-contained page, no scroll below the hero.
tags:
  - "landing-page"
  - "motionsites"
  - "hero"
  - "video-background"
  - "automotive"
  - "scroll-scrubbed"
  - "waitlist"
triggers:
  - "auren"
  - "automotive ai"
  - "ai driver landing page"
  - "car ai hero"
  - "scroll scrubbed video hero"
  - "waitlist landing page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=automotive-ai"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build AUREN — a private AI-driver waitlist landing page — as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — the scroll-scrubbed hero video sequence, the Orbitron display type, and the story-beat/waveform/route motion are part of the identity. Ask only for the missing essentials first: real brand name, hero copy, and driving footage to swap in."
---

# AUREN — Private AI Driver Landing

> Rebuilt from a licensed MotionSites prompt as a self-contained page.

Single-viewport, scroll-driven hero for **AUREN**, a fictional private
AI-driving assistant. The entire page is one pinned `<section>`: scrolling
scrubs a timeline that plays a fullscreen "mega" video, collapses it into a
small floating clip, assembles a corner logo and headline out of that
collapse, then expands a second video to fullscreen and scrubs it through a
sequence of story beats — two headline words flying past in 3D, a pulsing
audio waveform, two feature captions, and a hand-drawn delivery route with
animated checkpoint stamps — before resting on a translucent email waitlist
form pinned to the corner. No sections below the fold; the scroll runway
itself is the content.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, hero
   headline, body copy, story-beat words, and driving footage (or a static
   fallback frame sized and positioned the same way — full-bleed,
   `object-fit: cover`).
3. **Preserve the design system.** The scroll-scrubbed collapse/expand
   choreography, the Orbitron display type, the glass-pill header, and the
   waveform/route motion in the build spec below are the identity — do not
   flatten the scroll timeline into a static hero or restyle the CTAs off
   their pill treatment.
4. **Extend by duplicating patterns**, never by importing chrome from
   another template. If content is needed below the hero, design it fresh
   in this template's own vocabulary — the hero timeline itself should stay
   exactly this scoped.
5. **Keep motion accessible.** Every scrub, flyby, and fade collapses under
   `prefers-reduced-motion` — preserve that branch when extending the page.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="automotive-ai-landing" type="text/html" title="AUREN — Private AI Driver Landing">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished page, not the source prompt.

### Palette & type

- **Palette:** near-black page (`#0c0d0f` background, `#f0f1f3` text)
  throughout the chrome; the hero gradient runs `#03070A` to `#AAC2CE`
  (near-black to a cool pale blue), held on chromatic root tokens
  `--accent-a` / `--accent-b` so MishMash's recolor pass can retint the
  hero surface while the shipped render stays pixel-identical to the
  source. Glass surfaces use `rgba(240, 241, 243, 0.15)` with a 10px
  backdrop blur; the story scrim is a layered near-black gradient
  (`rgba(12, 13, 15, …)`) — left literal per the neutral-scaffolding rule
  since it is not a brand-accent surface.
- **Type:** **Orbitron** (uppercase display — hero title, mega wordmark,
  story words), **Inter Tight** (body — nav, description, captions, form),
  **JetBrains Mono** declared as a root token but unused in the resting
  page, matching the source prompt's own unused declaration. All three via
  Google Fonts CDN, matching the source's exact font stack — no
  substitution needed.

### Section-by-section layout

1. **Fixed header** — a glass logo pill (inline "Auren" wordmark SVG) left;
   right cluster with a glass nav pill (Service / About / Contact, hidden
   below 640px), a glass hamburger button, and a solid light "Log In" pill.
2. **Pinned hero (`position: sticky` inside a 2200vh scroll-stage spacer)**
   — the entire page. Layered absolutely inside it, in z-order:
   - Mega video clip (starts fullscreen, collapses to a small floating clip)
   - Corner logo mark + hero title ("Hands Off.") that assemble out of the
     mega collapse
   - Hero description paragraph and the email waitlist block (form + caption)
   - A huge right-aligned "Auren" mega-wordmark that fades out early
   - Two feature captions (voice control, route planning), each with a dot
     marker
   - A second video clip that expands from the same floating slot to
     fullscreen
   - A dark gradient story scrim
   - Two flying story words ("Effortless.", "Anywhere.")
   - An animated 27-bar audio waveform (SVG)
   - A hand-drawn route path with three stamped checkpoints (SVG)

### Motion inventory

The entire hero motion is one scroll-scrubbed timeline (vanilla port of the
source's GSAP + ScrollTrigger sequence — same constants, same offsets, same
easing curves, ported to `requestAnimationFrame` + `position: sticky`):

- **Mega phase** (first ~45% of the 2200vh runway): mega video scrub-plays
  to its midpoint, holds, then collapses via `cubic-bezier` power2.inOut
  from fullscreen to the floating clip slot while its border-radius eases
  16px → 12px. The "Auren" mega-wordmark fades and blurs out (power2.in,
  0 → 24px blur) over the same span. The corner logo and hero title then
  emerge with a `back.out(1.2)` overshoot (scale 0.4 → 1, blur 12px → 0).
- **Hero Phase A** (short expand span): the second video clip expands from
  the floating slot back to fullscreen (linear/`ease: none`, matching
  scroll 1:1) while the assembled logo/title fade and blur back out
  (0 → 24px) and the description/email block fade to 0.
- **Hero Phase B** (remaining runway): the second video scrub-plays;
  a scrim fades in; the two story words fly in from -120px Z / 12px blur
  with a `power1.out` ease-in / `power1.in` ease-out symmetric flyby; the
  waveform's 27 bars animate `scaleY` on a `Math.sin` dance envelope with a
  22%-edge fade-in/out envelope; captions fade+rise 20px (`power1.out` in,
  `power1.in` out); the route path draws via `stroke-dashoffset` over a
  28%-span linear sweep; three checkpoint badges pop in with a staggered
  `back.out(1.7)` scale.
- `prefers-reduced-motion: reduce` neutralizes the entire timeline in JS (a
  `reduced` flag gates every scale/blur/3D-translateZ/back-ease branch so
  elements cut straight to their end state with no overshoot or blur), plus
  a CSS rule removes the waitlist button's press transition.

### Accessibility affordances

- Nav uses a real `<nav aria-label="Site sections">`; the hamburger and
  login controls are real `<button>`s with an `aria-label` on the
  hamburger's icon-only button.
- The waitlist form has a visible-but-`sr-only` `<label for="waitlist-email">`,
  `type="email"`, `autocomplete="email"`, and `required`; submit is
  intercepted (no live `action`), disables the button, swaps its label to
  "Added", rewrites the caption, and announces success through a
  `role="status" aria-live="polite"` region.
- All interactive controls (`menu-btn`, `login-btn`, `email-input`,
  `email-send`) carry a visible `:focus-visible` outline using the
  chromatic `--accent-b` token — additive only, it does not touch the
  resting appearance.
- Decorative SVG marks (`corner-logo`, waveform, route) are `aria-hidden`;
  the header logo SVG carries `aria-label="Auren"` instead of alt text.

### De-branding note

No real trademarks were found. The brand ("Auren"), the wordmark and corner
logomark (both original abstract oval marks, not any real automaker's
badge), and the waitlist copy are fictional/generic — nothing required
renaming. The two vendored driving-video clips (a foggy night highway POV
and a low-angle exterior shot of a person leaning out of the car) were
inspected frame-by-frame at pixel level for embedded real-world marks: the
steering-wheel hub, dashboard, and door badges are all unbranded or
illegibly small/blurred at the source's 720p resolution — no readable
marque badge, model name, or manufacturer emblem is identifiable in either
clip.

### Assets

- `assets/mega-loop.mp4` — vendored fullscreen driving clip (1.2MB, 720p
  H.264, 5s, muted).
- `assets/hero-loop.mp4` — vendored secondary driving clip (0.76MB, 720p
  H.264, 5s, muted).

Both were already present on disk from the prior build pass; verified
non-empty and playable via `ffprobe` before reuse — not re-downloaded or
re-transcoded.

### Fonts

Orbitron, Inter Tight, and JetBrains Mono via Google Fonts CDN — all three
match the source prompt's exact font stack; no substitution was needed.
