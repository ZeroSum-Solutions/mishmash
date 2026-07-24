# presenter-mode-reveal · Presenter Mode Template

A full-deck template built specifically for **tech talks that need speaker notes**. The core selling point is a genuinely usable **draggable-card presenter view**: current-slide iframe preview + next-slide iframe preview + large-type speaker notes + a timer, all four cards freely draggable/resizable, all bundled into `runtime.js` with zero dependencies.

## When to use it

- Tech talks (30-60 min)
- Product-launch keynotes
- Course lectures
- Any formal talk where you **need notes to work from but can't read off the page**

## Quick start

```bash
cp -r templates/full-decks/presenter-mode-reveal examples/my-talk
open examples/my-talk/index.html
```

## Keyboard shortcuts

| Key | Action |
|---|---|
| `S` | Opens the presenter window (a new popup; the current page stays put) |
| `T` | Cycle themes (5 presets) |
| `←` `→` | Change slide |
| `Space` / `PgDn` | Next slide |
| `F` | Fullscreen |
| `O` | Overview thumbnails |
| `R` | Reset the timer (presenter view only) |
| `Esc` | Close all overlays |

## Switching themes

The template ships 5 presets suited to presenting, set on the `<html data-themes="...">` attribute:

```html
<html lang="en" data-themes="tokyo-night,dracula,catppuccin-mocha,nord,corporate-clean">
```

Press `T` to cycle through them. Swap in any theme from `assets/themes/*.css`.

## Rules for writing speaker notes

**Write 150–300 words in the `<aside class="notes">` on every slide.** Three hard rules:

1. **It's a cue, not a script** — bold the key point, break transitions into their own paragraph, list out the numbers clearly
2. **150–300 words per slide** — paced for roughly 2–3 minutes per slide
3. **Write it the way you'd say it out loud** — read it back to yourself; if it's awkward to say, rewrite it

Example:
```html
<aside class="notes">
  <p>Hi everyone — today I want to talk about <strong>a problem a lot of people overlook</strong>...</p>
  <p>Here's my claim up front: <em>building a deck and presenting a deck are two different jobs</em>.</p>
  <p>I'll back that up with 3 examples...</p>
</aside>
```

Supported inline tags:
- `<strong>` — highlight (orange)
- `<em>` — italic emphasis (blue)
- `<code>` — monospace
- `<p>` — paragraph break (aim for 30-60 seconds of talking per paragraph)

## File structure

```
presenter-mode-reveal/
├── index.html       # 6 example slides, each with a full speaker-notes script
├── style.css        # scoped .tpl-presenter-mode-reveal styles
└── README.md        # this file
```

## Modifying / extending

- **Add a slide**: duplicate any `<section class="slide">` block, change the content and `<aside class="notes">`
- **Change theme**: edit the `data-themes` list, or change `<link id="theme-link" href="...">` directly
- **Change styling**: only touch `style.css` — don't touch the root `assets/base.css`
- **Add motion**: add `data-anim="fade-up"` etc. to an element (see `references/animations.md`)

## The 4 cards in the presenter window

Pressing `S` opens a window containing:

- 🔵 **CURRENT** — a preview iframe of the current slide (loaded in `?preview=N` mode, pixel-perfect, sharing the same CSS/theme/fonts as the audience view)
- 🟣 **NEXT** — a preview of the next slide, to help you prep the transition
- 🟠 **SPEAKER SCRIPT** — large-type speaker notes, scrollable
- 🟢 **TIMER** — elapsed time + slide number + Prev/Next/Reset buttons

Card controls:
- **Drag the card header** (the colored-dot + title bar at the top) → moves the card
- **Drag the card's bottom-right corner** → resizes it
- Position + size are saved to localStorage automatically and restored next time
- The "Reset layout" button at the bottom restores the default card arrangement

Buttery-smooth slide changes: the iframe loads once, and subsequent slide changes switch the internal slide via `postMessage` — **no reload, no flicker**. The two windows stay in sync in both directions via `BroadcastChannel`.

## Notes

- **The audience never sees `.notes` content** — it defaults to `display:none` in CSS and is only visible in the presenter view
- **Never write anything meant only for yourself directly on the slide body** — all prompts must live inside `<aside class="notes">`
- **Dual-screen presenting**: open `index.html`, press S to pop out the presenter window, drag the audience window to the projector/external display and hit F for fullscreen, and keep the presenter window on your own screen
