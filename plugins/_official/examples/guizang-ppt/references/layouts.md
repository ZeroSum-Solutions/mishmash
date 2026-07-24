# Page Layout Library

This document collects the 10 most commonly used page layout skeletons. Each is a complete, paste-ready `<section class="slide ...">...</section>` code block; just swap in your copy/images to use it.

---

## ⚠️ Read before generating (Pre-flight)

### A. Class names must come from template.html

Every class layouts.md uses (`h-hero` / `h-xl` / `h-sub` / `h-md` / `lead` / `meta-row` / `stat-card` / `stat-label` / `stat-nb` / `stat-unit` / `stat-note` / `pipeline-section` / `pipeline-label` / `pipeline` / `step` / `step-nb` / `step-title` / `step-desc` / `grid-2-7-5` / `grid-2-6-6` / `grid-2-8-4` / `grid-3-3` / `grid-6` / `grid-3` / `grid-4` / `frame` / `frame-img` / `img-cap` / `callout` / `callout-src` / `kicker`) is predefined in the `<style>` block of `assets/template.html`.

**Do not invent new class names**. If you must customize, write it inline with `style="..."`. If you're unsure whether a class exists before generating, grep template.html to confirm.

### B. Image ratio rules (very important)

**Always use a standard ratio**, never the source image's odd ratio like `aspect-ratio: 2592/1798`:

| Scenario | Recommended ratio | How to write it |
|------|---------|------|
| Lead image + text, main image | 16:10 or 4:3 | `aspect-ratio:16/10; max-height:54vh` |
| Image grid (multi-image comparison) | uniform | **fixed `height:26vh`, not aspect-ratio** |
| Small image left + text right | 1:1 or 3:2 | `aspect-ratio:1/1; max-width:40vw` |
| Full-screen hero visual | 16:9 | `aspect-ratio:16/9; max-height:64vh` |
| Image + text mix, small inset | 3:2 | `aspect-ratio:3/2; max-width:30vw` |

The image must be wrapped in `<figure class="frame-img">`; the inner `<img>` automatically gets `object-fit:cover + object-position:top center`, cropping only the bottom, never the top/left/right.

### C. Image positioning guidelines (avoid images piling at the very bottom of the page, hidden by the browser toolbar)

**Wrong approaches** (already learned the hard way, don't repeat):
- Using `align-self:end` in a non-grid container: `align-self` has no effect outside flex/grid, and the image falls to the end of the document flow and piles at the bottom.
- Using `position:absolute + bottom:0` to "pin" the image to the bottom: it gets covered by the bottom `.foot` and `#nav` dots.
- Writing only `height:N vh` for a single image with no `max-height`: it overflows the viewport on low-resolution screens.

**Right approach**:
- Image + text mixes **must use the grid structure `.frame.grid-2-7-5`** (or `.grid-2-6-6` / `.grid-2-8-4`).
- The grid container defaults to `align-items:start` (already set in the template), so the image naturally sticks to the top of the cell.
- If you need "the image's bottom aligned with the left-column callout": **give the left column flex column + `justify-content:space-between`** (so the callout sticks to the bottom of the left column on its own), and **just keep the right-column figure at align-items:start**: do not add `align-self:end`.
- It's recommended that every grid parent add inline `style="padding-top:6vh"` to give the title area breathing room.

### D. Theme color and theme rhythm

- Pick one theme color from the 5 presets in `references/themes.md`; custom hex values are not allowed.
- The theme rhythm (which of light / dark / hero light / hero dark each page uses) has hard rules in the "Theme rhythm planning" section below; read it before generating.
- Decide both things before picking layouts, to avoid rework.

---

## 0. Base structure (the same for every slide)

```html
<section class="slide [light|dark|hero light|hero dark]">
  <div class="chrome">
    <div>Section label · sub-label</div>
    <div>ACT · page / total pages</div>
  </div>
  <!-- main content -->
  <div class="foot">
    <div>Page caption · Page Description</div>
    <div>— · —</div>
  </div>
</section>
```

- Non-hero pages should add a `light` or `dark` theme; hero pages add `hero light` or `hero dark` (participating in WebGL theme interpolation).
- `chrome` and `foot` are the optional but recommended four-corner metadata, top/bottom and left/right.
- **Hero pages are for section covers / openings / closings / transitions**; non-hero pages are for body content.

### ⚠️ chrome and kicker must not say the same thing

This is the most common content-duplication problem. The two are on completely different semantic dimensions:

| Location | Role | Nature of content | Example |
|------|------|---------|------|
| `.chrome` top-left | **magazine masthead / nav metadata** | a stable "section name" or "chapter category," can be the same across pages | "Act II · Workflow" / "Data · Result" / "lukew.com · 2026.04" |
| `.chrome` top-right | **page number + act number** | fixed format | "Act II · 15 / 25" |
| `.kicker` | **the one-of-a-kind lead-in for this page** | the "small prefix" of the headline, like the line above a magazine headline, different on every page | "BUT" / "One person. What did they build." / "Phase 01 · Design Stage" |

**Counter-example** (already learned the hard way): chrome says "Design First" and kicker says "Phase 01 · Design Stage": the meaning repeats, and the reader instantly senses AI generation.

**Right approach**: chrome is the **section label** (stable, reusable across pages), kicker is the **hook for this page** (a short line, dramatic); the two complement each other and don't translate into each other.

### ⚠️ Theme rhythm planning (must read · do before generating)

**Core mechanism**: every page's `<section>` must carry one of `light` / `dark` / `hero light` / `hero dark`. The JS infers the theme from the class to decide whether the body gets `light-bg`, which switches whether the dark or light WebGL canvas is in front. No theme, or a custom name, = fallback error.

#### Default theme by layout

| Layout | Default theme | Reason |
|---|---|---|
| 1. Cover | `hero dark` | opening ceremony, strong impact on a dark base |
| 2. Act divider | `hero dark` and `hero light` **must alternate** | breathing rhythm |
| 3. Big numbers (data) | `light` | numbers need a paper-white base; you can occasionally insert `dark` when several acts fire in a row |
| 4. Lead image + text | **alternate `light` / `dark`** | the workhorse of body rhythm |
| 5. Image grid | `light` | screenshots need a light base |
| 6. Pipeline | `light` | flowcharts need clarity |
| 7. Question page | `hero dark` | strong visual impact by default |
| 8. Big quote | **`dark` preferred**, occasionally `light` | the ceremony of a quote relies on a dark base |
| 9. Comparison page | `light` | two columns need clarity |
| 10. Image + text mix | **alternate `light` / `dark`** | rhythm |

#### Rhythm hard rules (self-check with grep after generating)

- ❌ **Forbidden**: 3+ consecutive pages on the same theme (including stacked light and stacked dark)
- ❌ **Forbidden**: an 8+ page deck without at least 1 `hero dark` + 1 `hero light`
- ❌ **Forbidden**: a whole deck with only `light` body pages and no `dark` body page at all: it looks flat and breathless
- ✅ **Recommended**: insert 1 hero page every 3-4 pages (cover / divider / question / big quote)

#### 8-page rhythm template (ready to apply directly)

| Page | Theme | Layout | Notes |
|---|---|---|---|
| 1 | `hero dark` | Cover | opening |
| 2 | `light` | Big numbers | data thrown out |
| 3 | `dark` | Lead image + text | comparison/story |
| 4 | `light` | Pipeline | process |
| 5 | `hero light` | Act divider | breathing |
| 6 | `dark` | Lead image + text or big quote | |
| 7 | `hero dark` | Question page | suspenseful close |
| 8 | `light` | Big quote / ending | wrap-up |

**Draw this table and align it first, then start writing slides**. Skipping the planning and pasting skeletons straight = all light.

---

## Layout 1: Hero Cover

```html
<section class="slide hero dark">
  <div class="chrome">
    <div>A Talk · 2026.04.22</div>
    <div>Vol.01</div>
  </div>
  <div class="frame" style="display:grid; gap:4vh; align-content:center; min-height:80vh">
    <div class="kicker">Private Salon · Guizang</div>
    <h1 class="h-hero">One-Person Company</h1>
    <h2 class="h-sub">The Org AI Folded</h2>
    <p class="lead" style="max-width:60vw">
      One AI-native creator — shipped 110K lines of code in 64 days, kept posting across 9 platforms the whole time, and barely changed their daily routine.
    </p>
    <div class="meta-row">
      <span>Guizang</span><span>·</span><span>Indie creator / author of CodePilot</span>
    </div>
  </div>
  <div class="foot">
    <div>A talk about AI · organizations · the individual</div>
    <div>— 2026 —</div>
  </div>
</section>
```

**Key points**:
- Use `hero dark` so the WebGL background shows through across most of the area
- `h-hero` is the largest size (10vw), used here as the title hero visual
- Use `min-height:80vh + align-content:center` to vertically center the content as a whole
- No need to write a page number in `.chrome`; the cover is self-contained

---

## Layout 2: Act Divider

```html
<section class="slide hero light">
  <div class="chrome">
    <div>Act I · The Numbers</div>
    <div>Act I · 01 / 25</div>
  </div>
  <div class="frame" style="display:grid; gap:6vh; align-content:center; min-height:80vh">
    <div class="kicker">Act I</div>
    <h1 class="h-hero" style="font-size:8.5vw">The Numbers</h1>
    <p class="lead" style="max-width:55vw">
      Look at the numbers first, talk method second.
    </p>
  </div>
  <div class="foot">
    <div>Act I lead-in</div>
    <div>— · —</div>
  </div>
</section>
```

**Key points**:
- Minimalist; just kicker + big title + one line of intro
- The covers of two acts can alternate `hero light` / `hero dark` to create rhythm
- The `h-hero` size can be tuned from 10vw down to 8.5vw to fit length

---

## Layout 3: Big Numbers Grid

```html
<section class="slide light">
  <div class="chrome">
    <div>The last 64 days · Dev diary</div>
    <div>Act I / Dev · 02 / 25</div>
  </div>
  <div class="frame" style="padding-top:6vh">
    <div class="kicker">One person. What did they build.</div>
    <h2 class="h-xl">The last 64 days</h2>
    <p class="lead" style="margin-bottom:5vh">From zero to open-sourcing CodePilot.</p>

    <div class="grid-6" style="margin-top:6vh">
      <div class="stat-card">
        <div class="stat-label">Duration</div>
        <div class="stat-nb">64 <span class="stat-unit">days</span></div>
        <div class="stat-note">Zero to now</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Lines of Code</div>
        <div class="stat-nb">110K+</div>
        <div class="stat-note">Written line by line to 110K+</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">GitHub Stars</div>
        <div class="stat-nb">5,166</div>
        <div class="stat-note">One open-source repo</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Downloads</div>
        <div class="stat-nb">41K+</div>
        <div class="stat-note">Installed on tens of thousands of machines</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">AI Providers</div>
        <div class="stat-nb">19</div>
        <div class="stat-note">Cross-platform integrations</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Commits</div>
        <div class="stat-nb">608+</div>
        <div class="stat-note">No collaborators</div>
      </div>
    </div>
  </div>
  <div class="foot">
    <div>Project · CodePilot　|　github.com/codepilot</div>
    <div>Act I · Dev Numbers</div>
  </div>
</section>
```

**Key points**:
- A 3×2 or 4×2 grid is most stable (see `.grid-6`)
- Each `stat-card` has a fixed structure: label (small English) → nb (big number) → note (annotation)
- Numbers should be 2-3 characters (too long overflows); use K / M shorthand
- Leave 5vh+ of buffer above so the title area catches the eye first

---

## Layout 4: Lead Image + Text (Quote + Image)

```html
<section class="slide light">
  <div class="chrome">
    <div>Identity Twist · The Twist</div>
    <div>03 / 25</div>
  </div>
  <div class="frame grid-2-7-5" style="padding-top:6vh">
    <!-- Left column: title + body + callout, flex column keeps the callout pinned to the column's bottom -->
    <div style="display:flex; flex-direction:column; justify-content:space-between; gap:3vh">
      <div>
        <div class="kicker">BUT</div>
        <h2 class="h-xl" style="white-space:nowrap; font-size:7.2vw">
          I'm not a programmer.
        </h2>
        <p class="lead" style="margin-top:3vh">
          Haven't written a line of code since graduating. The last decade was UI design and AI VFX.
        </p>
      </div>
      <div class="callout">
        "Three years ago, this<br>
        would have taken a ten-person team a year."
        <div class="callout-src">— one observer's take</div>
      </div>
    </div>
    <!-- Right column: image at a standard 16/10 ratio + max-height, no align-self:end -->
    <figure class="frame-img" style="aspect-ratio:16/10; max-height:56vh">
      <img src="images/codepilot.png" alt="CodePilot product screenshot">
      <figcaption class="img-cap">CodePilot · product screenshot</figcaption>
    </figure>
  </div>
  <div class="foot">
    <div>Page 03 · I'm not a programmer</div>
    <div>— · —</div>
  </div>
</section>
```

**Key points**:
- Use `grid-2-7-5` (left 7 parts, right 5 parts); `align-items:start` is already preset in the template
- The **left column** uses flex column + `justify-content:space-between`: title at the top, callout naturally at the bottom
- The **right-column image** **should not get `align-self:end`**. That slides the image to the bottom of the cell, hidden by the browser toolbar on low-resolution screens
- The image must use a **standard ratio 16/10 or 4/3 + `max-height:56vh`**; don't use the source image's odd ratio (like `2592/1798`)

---

## Layout 5: Image Grid (multi-image comparison)

```html
<section class="slide light">
  <div class="chrome">
    <div>Platform following, verified</div>
    <div>Act I / Ops · 05 / 27</div>
  </div>
  <div class="frame" style="padding-top:5vh">
    <div class="kicker">Proof · Follower count</div>
    <h2 class="h-xl">10 platforms · 6 screenshots</h2>

    <div class="grid-3-3" style="margin-top:4vh">
      <figure class="frame-img" style="height:26vh">
        <img src="images/twitter.png" alt="Twitter 289K">
        <figcaption class="img-cap">Twitter · 289K</figcaption>
      </figure>
      <figure class="frame-img" style="height:26vh">
        <img src="images/threads.png" alt="Threads 137K">
        <figcaption class="img-cap">Threads · 137K</figcaption>
      </figure>
      <figure class="frame-img" style="height:26vh">
        <img src="images/newsletter.png" alt="Newsletter 96K">
        <figcaption class="img-cap">Newsletter · 96K</figcaption>
      </figure>
      <figure class="frame-img" style="height:26vh">
        <img src="images/youtube.png" alt="YouTube 26K">
        <figcaption class="img-cap">YouTube · 26K</figcaption>
      </figure>
      <figure class="frame-img" style="height:26vh">
        <img src="images/instagram.png" alt="Instagram 19K">
        <figcaption class="img-cap">Instagram · 19K</figcaption>
      </figure>
      <figure class="frame-img" style="height:26vh">
        <img src="images/tiktok.png" alt="TikTok 10K">
        <figcaption class="img-cap">TikTok · 10K</figcaption>
      </figure>
    </div>
  </div>
  <div class="foot">
    <div>Screenshots taken · 2026.04</div>
    <div>Page 05 · Follower proof</div>
  </div>
</section>
```

**Key points**:
- Key: every `frame-img` must hard-set `height:NNvh` (not `aspect-ratio`), or the grid breaks
- The image automatically gets `object-fit:cover + object-position:top`, cropping only the bottom
- Use `.grid-3-3` (3×2) or `.grid-3` (3×1) to carry it

---

## Layout 6: Two-Column Pipeline

```html
<section class="slide light">
  <div class="chrome">
    <div>My workflow · Workflow</div>
    <div>Act II · 15 / 27</div>
  </div>
  <div class="frame">
    <div class="kicker">Pipeline</div>
    <h2 class="h-xl">Two pipelines</h2>

    <!-- Group 1: text side -->
    <div class="pipeline-section">
      <div class="pipeline-label">Text side · Text Pipeline</div>
      <div class="pipeline">
        <div class="step">
          <div class="step-nb">01</div>
          <div class="step-title">Draft</div>
          <div class="step-desc">AI drafts the first pass</div>
        </div>
        <div class="step">
          <div class="step-nb">02</div>
          <div class="step-title">Polish</div>
          <div class="step-desc">AI polishes out the AI smell</div>
        </div>
        <div class="step">
          <div class="step-nb">03</div>
          <div class="step-title">Morph</div>
          <div class="step-desc">AI reshapes it per platform</div>
        </div>
        <div class="step">
          <div class="step-nb">04</div>
          <div class="step-title">Illustrate</div>
          <div class="step-desc">AI generates the infographic</div>
        </div>
        <div class="step">
          <div class="step-nb">05</div>
          <div class="step-title">Distribute</div>
          <div class="step-desc">One click ships to 9 platforms</div>
        </div>
      </div>
    </div>

    <!-- Group 2: video side -->
    <div class="pipeline-section">
      <div class="pipeline-label">Visual · Video side · Video Pipeline</div>
      <div class="pipeline">
        <div class="step">
          <div class="step-nb">06</div>
          <div class="step-title">Cut</div>
          <div class="step-desc">AI helps edit the cut</div>
        </div>
        <div class="step">
          <div class="step-nb">07</div>
          <div class="step-title">Wrap</div>
          <div class="step-desc">AI helps package it</div>
        </div>
        <div class="step">
          <div class="step-nb">08</div>
          <div class="step-title">Cover</div>
          <div class="step-desc">AI generates the cover art</div>
        </div>
      </div>
    </div>
  </div>
  <div class="foot">
    <div>Page 15 · My content factory</div>
    <div>Workflow</div>
  </div>
</section>
```

**Key points**:
- Use `.pipeline-section` to group + `.pipeline-label` as the group title
- Between two groups, use a 3.6vh gap + a fine top divider line (already preset in the CSS)
- Each step has the fixed structure nb → title → desc
- Step count is unlimited, but a single row should be ≤5; otherwise move to a second pipeline

---

## Layout 7: Suspenseful Close / Question Page (Hero Question)

```html
<section class="slide hero dark">
  <div class="chrome">
    <div>A question for you</div>
    <div>24 / 27</div>
  </div>
  <div class="frame" style="display:grid; gap:8vh; align-content:center; min-height:80vh">
    <div class="kicker">The Question</div>
    <h1 class="h-hero" style="font-size:7vw; line-height:1.15">
      In your company,<br>
      which roles were never<br>
      supposed to be done by people?
    </h1>
    <p class="lead" style="max-width:50vw">
      This isn't a technology question. It's an architecture question.
    </p>
  </div>
  <div class="foot">
    <div>Page 24 · The Question</div>
    <div>— · —</div>
  </div>
</section>
```

**Key points**:
- The more whitespace on a hero page the better; put only one question
- Tune the `h-hero` size to the length (7vw suits 3 lines, 10vw suits 1 line)
- Break lines manually with `<br>` to keep the breaks at semantic points
- The tail can give one more `lead` line as the punchline

---

## Layout 8: Big Quote Page (serif quote)

```html
<section class="slide light">
  <div class="chrome">
    <div>The Takeaway</div>
    <div>18 / 25</div>
  </div>
  <div class="frame" style="display:grid; gap:5vh; align-content:center; min-height:80vh">
    <div class="kicker">Quote</div>
    <blockquote style="font-family:var(--serif-zh); font-weight:700; font-size:5.8vw; line-height:1.2; letter-spacing:-.01em; max-width:72vw">
      "No handoff.<br>Everyone builds."
    </blockquote>
    <p class="lead" style="max-width:55vw; opacity:.65">
      Without the handoff, everyone builds.<br>
      And that makes all the difference.
    </p>
    <div class="meta-row">
      <span>— Luke Wroblewski</span><span>·</span><span>2026.04.16</span>
    </div>
  </div>
  <div class="foot">
    <div>Page 18 · Takeaway</div>
    <div>— · —</div>
  </div>
</section>
```

**Key points**:
- Whitespace across the whole page; put only one big quote + attribution
- Use inline style on the `<blockquote>` to enlarge it on its own (5-6vw); don't use `h-hero` (that name belongs to the page main title)
- Follow it with the English original (lead · opacity:.65) to create hierarchy
- Pair with `meta-row` for the attribution · date

---

## Layout 9: Side-by-Side Comparison (A vs B · Old vs New)

```html
<section class="slide light">
  <div class="chrome">
    <div>Old vs New · The Shift</div>
    <div>12 / 25</div>
  </div>
  <div class="frame" style="padding-top:5vh">
    <div class="kicker">Before / After · The paradigm shift</div>
    <h2 class="h-xl" style="margin-bottom:4vh">From handoff to co-building</h2>

    <div class="grid-2-6-6" style="gap:5vw 4vh">
      <!-- Left column: old -->
      <div style="padding:3vh 2vw; border-left:3px solid currentColor; opacity:.55">
        <div class="kicker" style="opacity:.9">Before · Old model</div>
        <h3 class="h-md" style="margin-top:2vh">Design → build → handoff</h3>
        <ul style="margin-top:3vh; padding-left:1.2em; display:flex; flex-direction:column; gap:1.4vh; font-family:var(--sans-zh); font-size:max(14px,1.1vw); line-height:1.55">
          <li>Designer builds the comp in Figma</li>
          <li>Developer stares at the file, translates pixels</li>
          <li>Round after round of PR back-and-forth to align</li>
          <li>Non-technical people can't touch the code</li>
        </ul>
      </div>
      <!-- Right column: new -->
      <div style="padding:3vh 2vw; border-left:3px solid currentColor">
        <div class="kicker" style="opacity:.9">After · New model</div>
        <h3 class="h-md" style="margin-top:2vh">Same tool · parallel · co-built</h3>
        <ul style="margin-top:3vh; padding-left:1.2em; display:flex; flex-direction:column; gap:1.4vh; font-family:var(--sans-zh); font-size:max(14px,1.1vw); line-height:1.55">
          <li>All three roles work in Intent at once</li>
          <li>agents.md serves as shared context</li>
          <li>The agent handles alignment / conflicts / animation</li>
          <li>Anyone can safely contribute code</li>
        </ul>
      </div>
    </div>
  </div>
  <div class="foot">
    <div>Page 12 · The paradigm shift</div>
    <div>Before / After</div>
  </div>
</section>
```

**Key points**:
- Use `.grid-2-6-6` (1:1) to split left and right in half
- The left column at `opacity:.55` visually weakens the "old"; the right column at full brightness emphasizes the "new"
- Both columns use `border-left:3px solid` + `padding-left` for a blockquote feel
- Each column has a uniform structure: `kicker` → `h-md` → `<ul>` bullets, consistent rhythm

---

## Layout 10: Image + Text Mix (Lead Image + Side Text)

```html
<section class="slide light">
  <div class="chrome">
    <div>Design First</div>
    <div>08 / 16</div>
  </div>
  <div class="frame grid-2-8-4" style="padding-top:6vh">
    <!-- Left column: long-form body + quote -->
    <div>
      <div class="kicker">Phase 01 · Design stage</div>
      <h2 class="h-xl" style="margin-top:1vh; margin-bottom:3vh">Design first · 2 weeks</h2>

      <p class="lead" style="margin-bottom:3vh">
        Finished visual exploration and the design system in Figma — grid / typography / color variables / reusable components — with a few rounds of feedback on the desktop and mobile comps.
      </p>

      <p style="font-family:var(--sans-zh); font-size:max(14px,1.15vw); line-height:1.75; opacity:.78; margin-bottom:2.4vh">
        Within two weeks, the visual style, rough structure, and directional content were all locked in. This is a solid, traditional design process — nothing new here yet.
      </p>

      <div class="callout" style="margin-top:3vh">
        "This phase was pretty standard.<br>Just a solid Web design process."
        <div class="callout-src">— Luke Wroblewski</div>
      </div>
    </div>
    <!-- Right column: supporting image · portrait or square -->
    <figure class="frame-img" style="aspect-ratio:3/4; max-height:60vh">
      <img src="images/figma.png" alt="Figma design system">
      <figcaption class="img-cap">Figma · Design System</figcaption>
    </figure>
  </div>
  <div class="foot">
    <div>Page 08 · Design First</div>
    <div>~ 2 weeks</div>
  </div>
</section>
```

**Key points**:
- `.grid-2-8-4` (8:4) lets the body dominate and the image play a supporting role
- The left column holds multiple information levels: kicker → big title → lead → body paragraph → callout (quote)
- The right-column image uses a **vertical 3:4** or square 1:1 to avoid competing with the left-column text for attention
- This layout suits scenarios with **a higher amount of page information** (unlike Layout 4 with just one quote)

---

## Appendix: Common grid templates

| Class | Ratio | Use |
|---|---|---|
| `.grid-2-6-6` | 6:6 (1:1) | split in half |
| `.grid-2-7-5` | 7:5 | text-dominant + supporting image |
| `.grid-2-8-4` | 8:4 (2:1) | long text + small image/data |
| `.grid-3` | 1:1:1 | 3 items side by side (cases/screenshots) |
| `.grid-3-3` | 3×2 | 6-image matrix |
| `.grid-6` | 3×2 | 6 data cards |

Every grid reserves `gap: 3vw 4vh` (horizontal 3vw, vertical 4vh), which you can override individually.

---

## Page rhythm suggestion

For a 25-30 page talk, the following rhythm is recommended:

1. **Hero Cover** (page 1)
2. **Act Divider** (act 1 opening, hero light or hero dark)
3. **Big Numbers** (throw out hard data for impact)
4. **Quote + Image** (cover the identity twist / hook)
5. **Image Grid** (supporting evidence)
6. **Hero Question** (act close, leave suspense)
7. ... acts 2 and 3 follow the same rhythm ...
8. **Hero Close** (last page, a question or thanks)

Hero pages and non-hero pages should alternate at a **2-3 : 1 ratio**; don't run more than 3 consecutive non-hero pages, nor more than 2 consecutive hero pages.
