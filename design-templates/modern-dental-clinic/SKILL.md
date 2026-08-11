---
name: modern-dental-clinic
description: |
  Full-viewport video-hero landing page for the fictional dental practice
  **Halcyon Dental Studio**, built as a single self-contained HTML file with
  inline CSS and vanilla JS. A muted, looping video of a giant tooth sculpture
  being polished fills the entire screen; a large blurred-in display headline,
  a two-avatar social-proof cluster, a bottom-left patient figure with a
  card-shaped reassurance badge, and a rotating "book your consultation" badge
  carry the page. Inter across five weights, a slide-down nav with an
  accessible mobile overlay menu, and a reduced-motion-safe entrance sequence
  (fade, blur, slide, float, spin) make up the full interactive experience.
tags:
  - "landing-page"
  - "motionsites"
  - "dental"
  - "healthcare"
  - "video-hero"
  - "clinic"
triggers:
  - "dental clinic"
  - "dentist"
  - "dental practice"
  - "dental landing page"
  - "healthcare landing"
  - "video hero"
  - "full-screen hero"
  - "clinic website"
  - "smile"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=modern-dental-clinic"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Halcyon Dental Studio — Full-Screen Video Hero as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, layout, and motion are part of the identity. Ask only for the missing essentials first: the real practice name, real copy and credentials, and any video/imagery to swap in."
---

# Halcyon Dental Studio — Full-Screen Video Hero

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.
> The upstream prompt named its practice "SmileLab"; this build replaces that
> with an original fictional practice name and softens the prompt's specific
> loyalty statistic to non-numeric copy — see "Healthcare safety notes" below.
> Verified against the prompt's Dribbble preview screenshot per the batch's
> fidelity standard — see "Verified against the preview" below for the
> comparison record.

A single full-viewport hero landing page: no scroll, no second scene. A
looping video of a giant polished-tooth sculpture fills the screen behind a
slide-down nav, a large three-line display headline ("Restore / Your True /
Smile"), a bottom-left patient photo with a card-shaped reassurance badge,
and a rotating "book your consultation" badge near the video's base.
Everything below the headline and avatar cluster is deliberately hidden on
small screens, matching the source prompt's mobile layout exactly.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace the brand and copy.** Swap the `Halcyon Dental` wordmark, the
   nav links, the headline, the subtext, and the loyalty badge for the
   user's real practice name, services, and voice. Do not reintroduce a
   specific outcome statistic or credential claim without the practice's own
   verified numbers — see "Healthcare safety notes."
3. **Preserve the design system.** The calm-blue palette, the Inter type
   scale, the full-screen no-scroll structure, and the motion choreography
   below are the identity — do not add a light theme, swap fonts, or turn
   this into a multi-section scrolling page without deliberately redesigning
   the layout.
4. **Swap the media deliberately.** `assets/dental-hero-loop.mp4` (with
   `assets/dental-hero-poster.jpg` as its poster/reduced-motion fallback) is
   the full-bleed background; `assets/hero-patient-figure.png` is the
   transparent-background bottom-left figure. Replace with real vendored
   media of matching aspect ratio and re-transcode video to the same
   loop-fit budget (≤10 MB, muted, ≤720p).
5. **Extend by duplicating the hero's vocabulary**, never by importing a
   section from another template. If the user wants more content (services,
   testimonials, footer), design new sections in this page's own type scale
   and palette rather than pasting one in from elsewhere.
6. **Keep motion accessible.** Every animation stays behind
   `prefers-reduced-motion`, as the build spec below requires.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="modern-dental-clinic" type="text/html" title="Halcyon Dental Studio — Full-Screen Video Hero">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished `example.html`.

### Palette

| Token | Value | Use |
| --- | --- | --- |
| `--accent` | `#5f9ad1` | Chromatic brand accent — page background under the video, mobile blend gradient, avatar ring, nav CTA icon glyph |
| `--accent-deep` | `#3d8cd5` | Stat badge number/caption text |
| `--accent-lime` | `#ebfa73` | Nav CTA icon circle, logo tooth-mark stroke, consultation badge fill |
| `--ink` / `--ink-dim` | `#fff` / `rgba(255,255,255,.6)` | Primary / secondary text on the video |

The mobile top-blend gradient resolves through a `var()` stop on `--accent`,
so recoloring that one token recolors the page background and the blend seam
together. All exact color values are copied verbatim from the source
prompt's "KEY COLORS" section and cross-checked against its preview
screenshot.

### Type

**Inter** (300/400/500/600/700), the exact family the source prompt
specified — no substitution needed, loaded from Google Fonts.

### Layout

One `<section class="hero">`, `100svh`, `overflow: hidden`, no page scroll:

1. **Media layer** — absolutely positioned `<video>` (autoplay/muted/loop/
   playsinline, poster'd) covering the section on desktop; repositioned to
   the bottom 70% of the viewport on mobile via a `top:30%/height:70%` rule,
   with a `.hero-blend` gradient div blending the solid `--accent` top into
   the video below. No extra scrim/overlay sits over the video — the source
   design relies on the video's own dark tones for contrast, confirmed
   against the preview screenshot.
2. **Nav** — logo (inline SVG tooth-outline mark in `--accent-lime` +
   "Halcyon Dental" wordmark), centered desktop link row
   (About/Results/Pricing/Reviews/Blog), a white pill "Contacts" CTA with a
   lime icon circle, and a hamburger toggle that is the only nav element
   visible under 768px.
3. **Mobile menu overlay** — fixed, blurred `--accent/.95` backdrop,
   staggered link entrance, a bottom CTA pill, top-right close button.
4. **Headline** — three-line display headline ("Restore / Your True /
   Smile"), left-aligned from 768px up, with a two-avatar + "+2k" cluster
   inline with the word "Smile" (avatars hidden under 768px) and a subtext
   paragraph (hidden under 768px).
5. **Bottom-left figure** — hidden under 768px; a white card-shaped
   reassurance badge ("Here / for every patient", asymmetric corner radius
   evoking the source's hand-held sign shape) overlapping the transparent
   patient PNG, both entering with a slide-up.
6. **Consultation badge** — hidden under 768px; a lime circular badge near
   the video's chrome base with black curved SVG `textPath` copy ("Book
   your consultation") rotating continuously around a static center arrow
   icon. Not described in the prompt's text payload but clearly present in
   its preview screenshot, so it was added to match — see "Verified against
   the preview."

### Motion inventory

- **Video fade-in** — `.hero-video`, opacity 0→1 over 1.2s on load.
- **Nav slide-down** — `.hero-nav` drops in from `-20px` over 0.7s.
- **Headline blur-in** — `.hero-heading-wrap` resolves from `blur(12px)`/
  opacity 0 to sharp/opaque over 0.9s.
- **Figure slide-up** — `.hero-figure-wrap` rises from `30px` over 0.9s at
  an 0.8s delay.
- **Figure float** — `.hero-figure-img` bobs `±8px` on an 6s ease-in-out
  loop, starting after the slide-up settles (1.7s delay) so the two
  transforms never fight (they live on parent/child elements).
- **Nav toggle morph** — the hamburger/close glyphs cross-fade and rotate
  over 0.3s, driven by `[aria-expanded]`.
- **Mobile menu** — backdrop and links cross-fade/slide in on open with a
  60ms-per-item stagger; CTA follows at 400ms. Closes on Escape, on
  clicking the backdrop, on the close button, or on any link, and returns
  focus into the dialog (deferred one frame past the class toggle so the
  still-`visibility:hidden` close button doesn't silently swallow the
  `focus()` call).
- **Consultation badge fade-in** — `.consult-badge`, opacity 0→1 over 1.2s
  at a 1s delay.
- **Consultation badge spin** — `.consult-badge-ring` rotates a full turn
  every 16s, linear, infinite; the center arrow icon is a separate
  non-rotating element.

All motion is vanilla CSS keyframes/transitions plus a small vanilla-JS menu
controller — no GSAP, no WebGL. Every animated property collapses to a
static, fully visible end state under `@media (prefers-reduced-motion:
reduce)`; the video element is swapped for its poster image and the JS
additionally pauses/un-autoplays the video when the media query matches on
load.

### Accessibility affordances

- Skip link jumps straight to the headline.
- Nav toggle carries `aria-expanded`, `aria-controls`, and a label that
  flips between "Open menu"/"Close menu".
- Mobile menu is `role="dialog" aria-modal="true"`, traps `Tab`/`Shift+Tab`
  focus within itself while open, closes and returns focus to the toggle on
  `Escape`, on a scrim click, on the close button, or on any link.
- Decorative media (background video/poster, avatar thumbnails, patient
  figure PNG) carry empty `alt`/`aria-hidden` so screen readers skip
  straight to the real copy; the reassurance badge's own text is real,
  readable content (not `aria-hidden`).
- The consultation badge is a real `<a aria-label="Book your consultation">`
  — its decorative rotating SVG text and arrow icon are `aria-hidden`, but
  the link itself has a proper accessible name and a visible focus ring.
- Full keyframe/transition set neutralizes under `prefers-reduced-motion:
  reduce`; the background video is replaced by its static poster image in
  that mode rather than merely slowing down.

### Assets vendored

All five files were already vendored to `assets/` from an earlier attempt at
this template and verified valid before reuse (correct JPEG/PNG/MP4 headers,
non-zero size, dimensions matching the source prompt's descriptions) — no new
downloads were needed:

| File | Role | Size |
| --- | --- | --- |
| `dental-hero-loop.mp4` | Full-bleed background loop (h264, 1280×720, 10s, silent) | 643 KB |
| `dental-hero-poster.jpg` | Video poster + reduced-motion fallback | 85 KB |
| `hero-patient-figure.png` | Transparent-background bottom-left figure | 87 KB |
| `avatar-patient-1.jpg` | Social-proof avatar 1 | 9 KB |
| `avatar-patient-2.jpg` | Social-proof avatar 2 | 8 KB |

### Healthcare safety notes

Per the healthcare-vertical duty for this batch, the practice and its
patients are entirely fictional and no regulatory, credential, or clinical
outcome claim is made:

- **Practice name invented.** The source prompt's nav wordmark was
  "SmileLab" — close enough to real smile-focused dental/aligner brand names
  to be worth avoiding. Renamed to "Halcyon Dental" (and "Halcyon Dental
  Studio" in metadata/copy). The logo mark itself is redrawn from the
  preview screenshot's tooth-outline icon (an original trace, not a copy of
  any real clinic's logo).
- **Loyalty statistic softened.** The source prompt specified a hard
  numeric claim — "98% loyal dental patients" — shown as a card-shaped badge
  over the patient figure. That reads as an outcome/retention statistic for
  a clinic that does not exist, so the copy was replaced with non-numeric,
  plainly illustrative text in the same visual slot: "Here / for every
  patient." The card's shape, position, size, and two-line layout (bold
  word + small caption) are preserved exactly from the preview; only the
  unverifiable percentage and its wording changed, kept to the same line
  count so the composition doesn't shift.
- **No practitioner names, licensure, or regulatory claims** appear
  anywhere on the page — the source prompt didn't include any, and none
  were added.
- **No real dental-brand trademarks** (implant systems, aligner brands,
  equipment makers) appear in the prompt's copy, the preview screenshot, or
  the vendored video/images; none needed replacing beyond the practice name
  above. The video's giant-tooth-sculpture concept is generic dental
  iconography, not a branded product.

### Verified against the preview

`get_prompt` returned a Dribbble-hosted `preview_url` screenshot of the
actual rendered design. It was downloaded to session scratch (never into
this repo), read visually, and compared side by side against a 1440×900
headless render of this `example.html`, then iterated until only the items
below remained.

**What the prompt's text payload omitted but the screenshot proved out:**

- The background video is a real, obtainable clip — a giant polished-tooth
  sculpture with workers polishing it on scaffolding — not an abstract
  placeholder. Confirmed by extracting frames from the already-vendored
  `dental-hero-loop.mp4`: it is that exact footage, so no video swap was
  needed.
- A circular "Book your consultation" badge with rotating curved text and a
  center arrow sits near the video's chrome base. The text payload never
  mentioned it; it was added from the screenshot (lime fill, black text/
  icon, continuous rotation, `prefers-reduced-motion`-safe).
- The bottom-left stat isn't bare text — it sits on a white card with an
  asymmetric corner radius (a hand-held-sign silhouette). Added a matching
  card behind the (softened) badge copy.
- The nav logo is a lime-colored tooth **outline** (hollow stroke), not the
  white-filled shape with a blue inner ellipse the text payload described.
  Redrawn to match the screenshot: a two-root tooth silhouette, stroked in
  `--accent-lime`.

**What was fixed to match the text payload's exact values** once the
stricter fidelity pass was applied: `tracking-tight` letter-spacing
(`-0.025em`, was approximated as `-0.01em`/`-0.02em`), the headline's exact
non-monotonic breakpoint sizes (`72px → 60px → 90px → 100px` at
`640/1024/1280px`, previously flattened into a single `clamp()`), the nav/
mobile CTA's uniform `px-5 py-3` padding and black label text (previously
asymmetric padding and the near-black brand-ink color), the CTA icon glyph
color (`--accent`, previously the wrong deeper blue token), the avatar
group's `0.1em` bottom margin, the subtext's `1.25` line-height, and the
CTA label itself ("Contacts" verbatim — an earlier pass had "corrected" it
to "Contact," which the fidelity standard treats as an unauthorized
copyedit).

**Removed:** an invented dark gradient scrim over the video for text
contrast. Nothing in the prompt text or the screenshot shows one — the
source design relies on the video's own tones for legibility — so adding it
would have been an uninstructed "improvement."

**Still off, and why:** the avatar photos (`avatar-patient-1.jpg`,
`avatar-patient-2.jpg`, vendored by an earlier attempt at this template)
don't visually match the two women in the preview pixel-for-pixel — this
build reused them per the task's explicit reuse instruction rather than
re-fetching. The outer rounded-card-on-gradient-canvas framing visible
around the whole screenshot was judged to be Dribbble's own presentation
chrome (the prompt text is explicit about `h-screen w-full`, i.e. true
full-bleed, and the image is hosted on `cdn.dribbble.com`, a portfolio
CDN, not `motionsites.ai`) and was deliberately not reproduced as page
chrome.
