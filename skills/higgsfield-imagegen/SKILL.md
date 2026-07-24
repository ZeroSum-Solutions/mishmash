---
name: higgsfield-imagegen
description: |
  Generate real photographic or illustrative imagery (hero shots, product photos, backgrounds, OG images) for a site or deck build using the locally-authenticated higgsfield CLI.
triggers:
  - "generate an image"
  - "hero image"
  - "product photo"
  - "og image"
  - "background texture"
od:
  mode: utility
  category: image-generation
---

# Higgsfield Image Generation

Use this when a build needs real photographic or illustrative imagery a hero
section, product card, background texture, or OG/social preview actually
needs a rendered photo, not a shape. Do not use it for icons, logos,
wordmarks, or anything a CSS gradient or inline SVG can express more
cheaply and crisply.

## Canonical commands

Create and wait for a job, then download the result into the project's
assets directory (paths below are relative to the agent's cwd):

```bash
higgsfield generate create gpt_image_2 \
  --prompt "studio product photo of a ceramic mug, soft daylight" \
  --aspect-ratio 1:1 --quality low --resolution 1k \
  --wait --wait-timeout 5m

# create/wait prints a hosted CDN URL, not a local file — fetch it:
curl -sS -o public/assets/mug-hero.png "<printed-url>"
```

`higgsfield model get <job_type>` lists accepted params per model before you
build a command. `higgsfield model list --image` lists every image model.

## Model guidance

- **Default for drafts:** `gpt_image_2` with `--quality low --resolution 1k`
  (~0.5 credits) — fast and cheap, good enough for a first pass.
- **Better models exist** when a draft needs to become final art:
  `nano_banana_pro`, `seedream_v5_pro`, or `gpt_image_2` at
  `--quality high --resolution 2k`/`4k`. Only reach for these on explicit
  request or a final polish pass, not by default.

## Aspect ratio guidance

- Hero / banner: `16:9` (widest option available; closest match to a
  1.91:1 OG image too).
- Card / thumbnail: `1:1` or `4:3`.
- OG / social preview: `16:9` — no model here supports the exact 1.91:1
  spec, so crop or letterbox after download if pixel-exact matters.

## Hard rules

- Reference generated files in HTML with relative paths from the assets
  directory (`assets/hero.png`, not the CDN URL or an absolute filesystem
  path) so the build stays portable.
- Cost discipline: generate 1-3 images per site/deck draft, not one per
  section. Reuse or crop an existing generation before creating a new one.

## Failure handling

If a command errors with an auth failure, stop and tell the user to run
`higgsfield auth login` themselves — do not retry, do not loop, and do not
attempt to work around missing auth.
