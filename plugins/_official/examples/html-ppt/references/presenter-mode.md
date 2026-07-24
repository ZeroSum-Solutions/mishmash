# Presenter Mode Guide

This document explains how to build a **presentation with speaker notes and a presenter mode** using the html-ppt skill.

## When to use presenter mode

**Default to presenter mode** whenever the user's request involves any of the following:

- Mentions "**talk**", "**presenting**", "**speaker notes**", "**presenter view**"
- Needs a "**30-minute / 45-minute / 1-hour**" talk
- Says "I'm going to present xxx to my team", "I need to give a tech talk", "I need to do a roadshow pitch"
- Emphasizes "**don't want to forget my lines**", "**worried about stumbling**", "**need a prompter**"

If the user only wants a "static, good-looking deck" (e.g. an image-card post, a product catalog, report slides they won't personally present), presenter mode is **not needed**.

## Two approaches

### ✅ Recommended: use the `presenter-mode-reveal` template directly

```bash
cp -r templates/full-decks/presenter-mode-reveal examples/my-talk
```

This template already has every required element preset:
- Supports the S key to toggle presenter view
- 5 themes cyclable with the T key (tokyo-night / dracula / catppuccin-mocha / nord / corporate-clean)
- Arrow keys to change slides
- Every slide ships with 150–300 words of example speaker notes
- Keyboard hints shown at the bottom

Just edit the content directly.

### 🔧 Advanced: add presenter mode to any existing template

html-ppt's **S-key presenter view is built into `runtime.js`, and every full-deck template supports it automatically**. You only need to do two things:

1. **Add `<aside class="notes">`** (or `<div class="notes">`) to the end of each slide, and write the speaker notes inside it
2. **Confirm the HTML imports `assets/runtime.js`**

```html
<section class="slide">
  <h2>Your title</h2>
  <p>Content...</p>
  <aside class="notes">
    <p>What you'll say while presenting, 150-300 words...</p>
  </aside>
</section>
```

## The 3 hard rules for writing speaker notes

This is the core of the whole methodology. When AI helps a user write speaker notes, it must follow these:

### Rule 1: Not a script — a "cue signal"

❌ **Wrong** (reads like it's being recited):
```
Hi everyone, welcome to today's talk. Today I'm going to walk you through the work our team has
done over the past three months. First, let's look at the background. Over the past three
months, we ran into the following problems...
```

✅ **Right** (a cue signal + bolded core points):
```
<p>Welcome! Today I'll cover our team's <strong>work from the past 3 months</strong>.</p>
<p>Starting with <em>context</em> — three months ago we hit <strong>three core problems</strong>:
high latency, costs blowing up, poor stability.</p>
<p>Next I'll walk through how we fixed each one.</p>
```

**The difference**: the correct version bolds the key words and puts transition lines in their own paragraph — a glance is enough to pick it back up.

### Rule 2: 150–300 words per slide

- **Under 150 words**: not enough of a cue — you'll stall halfway through
- **Over 300 words**: there's no way you can scan it in time
- **2–3 minutes per slide** is the most comfortable pace

### Rule 3: Write it in spoken language, not written language

| ❌ Written | ✅ Spoken |
|---|---|
| Therefore | So |
| The aforementioned approach | This approach |
| However | But / Though |
| Undertake optimization | Optimize it |
| We will proceed to | We'll / next up |
| In summary | So, basically |

**How to check**: read it back after writing it — it should sound like speech.

## The required HTML structure

```html
<!DOCTYPE html>
<html lang="en" data-themes="tokyo-night,dracula,corporate-clean">
<head>
  <meta charset="utf-8">
  <title>...</title>
  <link rel="stylesheet" href="../../../assets/fonts.css">
  <link rel="stylesheet" href="../../../assets/base.css">
  <link rel="stylesheet" id="theme-link" href="../../../assets/themes/tokyo-night.css">
  <link rel="stylesheet" href="../../../assets/animations/animations.css">
  <link rel="stylesheet" href="style.css">
</head>
<body>
<div class="deck">

  <section class="slide" data-title="Cover">
    <h1>Your title</h1>
    <p>Subtitle</p>
    <aside class="notes">
      <p>Notes paragraph 1 (with <strong>bolded keywords</strong>).</p>
      <p>Notes paragraph 2 (transition line in its own paragraph).</p>
      <p>Notes paragraph 3 (a natural close, leading into the next slide).</p>
    </aside>
  </section>

  <!-- more slides... -->

</div>
<script src="../../../assets/runtime.js"></script>
</body>
</html>
```

## What the presenter view shows

Pressing `S` **pops out a separate presenter window** (the original page stays in audience view). The presenter window is **4 independent draggable cards**:

```
 Audience window (original page)      Presenter window (draggable cards)
┌─────────────────┐   ┌─────────────────────┬──────────────────┐
│                 │   │ 🔵 CURRENT         │ 🟣 NEXT            │
│  Normal slide   │   │ ━━━━━━━━━━━━━━━━ │ ━━━━━━━━━━━━━ │
│  fullscreen     │◄►│                   │  iframe preview   │
│                 │   │  iframe preview   │  (next slide)      │
│                 │   │  (current slide)  ├──────────────────┤
│                 │   │                   │ 🟠 SPEAKER SCRIPT  │
│                 │   │                   │ ━━━━━━━━━━━━━ │
│                 │   ├─────────────────────┤  [large-type notes]│
│                 │   │ 🟢 TIMER           │  [scrollable]      │
│                 │   │ ⏱ 12:34   3 / 8 │                   │
│                 │   │ [← Prev][Next →]  │                   │
└─────────────────┘   └─────────────────────┴──────────────────┘
       ↑ slide changes sync both ways via BroadcastChannel ↑
```

Card interaction rules:
- **Drag the card header** (the top bar with the colored dot and title) → moves the card
- **Drag the triangular handle in the card's bottom-right corner** → resizes the card
- **Position/size are saved to localStorage automatically** and restored next time
- The "Reset layout" button at the bottom restores the default arrangement

Card contents:
- 🔵 **CURRENT** — a **pixel-perfect preview** of the current slide (an iframe loads the same HTML file in `?preview=N` mode — color mismatches aren't possible)
- 🟣 **NEXT** — a preview of the next slide, equally pixel-perfect
- 🟠 **SPEAKER SCRIPT** — the speaker notes, 18px type, supports inline styles like `<strong>` (bold orange), `<em>` (blue emphasis), `<code>`
- 🟢 **TIMER** — a timer that never loses focus, with slide-change buttons

Two-window sync: press ← → in either window to change slides, and the other window syncs automatically (BroadcastChannel).

Smooth slide changes: the iframe loads only once; subsequent slide changes use `postMessage` to switch the visible slide, **no reload, no flicker**.

## Keyboard shortcuts (presenter mode)

| Key | Action |
|---|---|
| `S` | Opens the presenter window (a new popup; the original page stays in audience view) |
| `←` `→` / Space / PgDn | Change slide (even from within presenter view) |
| `T` | Switch theme |
| `R` | Reset the timer (presenter view only) |
| `F` | Fullscreen |
| `O` | Overview |
| `Esc` | Close all overlays |

## Standard workflow for dual-screen presenting

1. Open `index.html`, press `S` → the presenter window pops out
2. Drag the **audience window** (the original page) to the projector / external display, press `F` for fullscreen
3. Keep the **presenter window** (the popup) on the screen in front of you
4. Press ← → in either window to change slides — both sides stay in sync
5. Read the speaker notes + next slide + timer in the presenter window

> 💡 **Why the previews are pixel-perfect**: each preview is an `<iframe>` that loads the exact same deck HTML file, just with a `?preview=N` parameter added to the URL. When `runtime.js` detects that parameter, it renders only slide N and hides all chrome. **The iframe uses the exact same CSS, theme, fonts, and viewport as the audience view** — colors and layout are guaranteed to match. The outer wrapper uses CSS `transform: scale()` to shrink the 1920×1080 canvas to the card's dimensions, scaling proportionally with no distortion.

> 💡 **Why there's no flicker**: the iframe loads once and stays resident; on a slide change, the presenter window tells the iframe to switch to slide N via `postMessage({type:'preview-goto', idx:N})`. The runtime.js inside the iframe only toggles the `.is-active` class — **no reload, no white-screen flash**.

## Common mistakes

### ❌ Writing speaker notes somewhere visible on the slide

```html
<!-- Wrong: the audience will see this text -->
<p style="font-size:12px;color:gray">
  Talk about xxx here, then yyy...
</p>
```

✅ Right:
```html
<aside class="notes">
  <p>Talk about xxx here, then yyy...</p>
</aside>
```

The `.notes` class defaults to `display:none`, visible only in presenter view.

### ❌ Forgetting to import runtime.js

No `<script src="../../../assets/runtime.js"></script>` = no S key, no presenter view, no slide navigation.

### ❌ Writing speaker notes in written language

Read aloud, it sounds like an AI robot. **Always read it back after writing it**.

### ❌ 50 words per slide

Not enough of a cue — you'll still forget your lines.

### ❌ 500 words per slide

Your eyes can't scan that fast — might as well not have written it.

## A standard prompt for generating speaker notes with AI

> "Write **150-300 words** of speaker notes for each slide, placed inside `<aside class="notes">`.
> Requirements:
> 1. Use **spoken** language, not written language (so/but/next, not therefore/however/in summary)
> 2. Bold the **core keywords** with `<strong>`
> 3. Put transition lines in their own paragraph (1-3 sentences each)
> 4. It should read like speech, not like something being recited
> 5. End with a natural transition into the next slide"

## Recommended pairings

- **Theme**: `tokyo-night` (dark, the default pick for tech talks), `corporate-clean` (light, business presentations), `dracula` (dark alternative)
- **Fonts**: Noto Sans SC + JetBrains Mono by default, no need to change
- **Motion**: use sparingly — `fade-up` / `rise-in` feel the most natural; avoid flashy ones like `glitch-in` / `confetti-burst`
- **Slide count**: a 30-minute talk = 8–12 slides; 45 minutes = 12–16 slides; 1 hour = 16–22 slides
