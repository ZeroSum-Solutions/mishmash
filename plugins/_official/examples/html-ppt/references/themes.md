# Themes catalog

Every theme is a short CSS file in `assets/themes/` that overrides tokens
defined in `assets/base.css`. Switch themes by changing the `href` of
`<link id="theme-link">` or by pressing **T** if the deck has a
`data-themes="a,b,c"` attribute on `<body>` or `<html>`.

All themes define the same variables: `--bg`, `--bg-soft`, `--surface`,
`--surface-2`, `--border`, `--text-1/2/3`, `--accent`, `--accent-2/3`,
`--good`, `--warn`, `--bad`, `--grad`, `--grad-soft`, `--radius*`, `--shadow*`,
`--font-sans`, `--font-display`.

## Light & calm

| name | description | when to use |
|---|---|---|
| `minimal-white` | Minimal, restrained, premium. Inter, strong type hierarchy, very low shadow. | Internal reports, 1:1 tech reviews, serious content that shouldn't compete for attention |
| `editorial-serif` | Magazine-style Playfair serif + cream background. | Brand storytelling, text-dense long-form talks |
| `soft-pastel` | A soft three-color macaron gradient. | Product launches, consumer-facing, lighthearted topics |
| `xiaohongshu-white` | White background + warm-red accent + serif headline. | Image-card posts, lifestyle/aesthetic content |
| `solarized-light` | The classic low-glare palette. | Long workshops, teaching sessions |
| `catppuccin-latte` | Catppuccin, light mode. | Developer- and geek-friendly tech talks |

## Bold & statement

| name | description | when to use |
|---|---|---|
| `sharp-mono` | Pure black and white + Archivo Black + hard shadows. | Manifestos, high-impact visuals |
| `neo-brutalism` | Thick outlines, hard shadows, bright yellow accent. | Startup pitches, bold and unapologetic tone |
| `bauhaus` | Geometric shapes + red/yellow/blue primaries. | Design talks, art-history/product-aesthetics topics |
| `swiss-grid` | Swiss grid + a Helvetica feel + a 12-column underlay. | Serious typography, the design industry |
| `memphis-pop` | Memphis-pop dot background + big headline type. | Young, trendy, brand collaborations |

## Cool & dark

| name | description | when to use |
|---|---|---|
| `catppuccin-mocha` | Catppuccin, dark mode. | Internal developer talks, long viewing sessions |
| `dracula` | The classic Dracula purple-red palette. | Code-dense tech talks |
| `tokyo-night` | Tokyo Night blue-night palette. | Cooler-toned tech talks, infrastructure |
| `nord` | Nordic cool blue and white. | Infrastructure, cloud products |
| `gruvbox-dark` | A warm, retro dark palette. | Terminal / vim / *nix communities |
| `rose-pine` | Rosé Pine, a soft dark palette. | The design/dev crossover, aesthetically-minded technical talks |
| `arctic-cool` | A light blue/teal/slate-gray palette. | Business analysis, finance, cool and rational tones |

## Warm & vibrant

| name | description | when to use |
|---|---|---|
| `sunset-warm` | An orange/coral/amber three-color gradient. | Lifestyle, awards, upbeat emotional tone |

## Effect-heavy

| name | description | when to use |
|---|---|---|
| `glassmorphism` | Frosted glass + a multicolor light-bloom background. | Apple-style keynotes, product-feature showcases |
| `aurora` | An aurora gradient + blur + saturation boost. | Cover / CTA / closing pages |
| `rainbow-gradient` | White background + a flowing rainbow-gradient accent. | Upbeat, festive, celebratory pages |
| `blueprint` | Engineering-blueprint look + grid underlay + a monospaced-adjacent typeface. | System architecture, engineering blueprints |
| `terminal-green` | Green-screen terminal + monospace + glowing text. | CLI / black-hat / retro-punk |

## v2 additions

### Light & professional

| name | description | when to use |
|---|---|---|
| `corporate-clean` | Pure white + navy accent + Inter + conservative borders. | Board reports, B2B sales, finance and insurance |
| `pitch-deck-vc` | A YC-style white background + blue-purple gradient accent + generous whitespace. | Fundraising roadshows, seed rounds, VC meetings |
| `academic-paper` | Paper-white + serif body + black ink + blue links. | Academic reports, research talks, conference papers |
| `japanese-minimal` | Ivory white + vermilion accent + extreme whitespace + Noto Serif. | Brand refreshes, artisan storytelling, zen-inflected narratives |
| `engineering-whiteprint` | White background + graph-paper grid + navy ink lines + monospace type. | System design, API docs, architecture white papers |

### Bold & editorial

| name | description | when to use |
|---|---|---|
| `magazine-bold` | Cream background + oversized Playfair serif + an orange spot color. | Column articles, cover stories, brand magazines |
| `news-broadcast` | White background + a red vertical bar + uppercase Oswald + hard shadows. | Breaking-news style, press releases, data broadcasts |
| `midcentury` | Cream background + mustard/teal/burnt-orange + sharp geometry. | Design history, home-aesthetics content, retro branding |
| `retro-tv` | Warm cream + CRT scanlines + an amber-orange accent. | Nostalgic storytelling, '80s/'90s-themed content |

### Effect-heavy / dramatic

| name | description | when to use |
|---|---|---|
| `cyberpunk-neon` | Pure black + neon pink/teal/yellow + glow + JetBrains Mono. | Hacker culture, underground themes, cyber talks |
| `vaporwave` | Deep purple + a pink/teal/blue gradient + hazy light bloom. | Music, trend-forward art, A E S T H E T I C |
| `y2k-chrome` | A chrome-silver gradient + rainbow accent + large radii + Space Grotesk. | Y2K nostalgia, fashion brands, Gen-Z |

## How to apply

```html
<link rel="stylesheet" id="theme-link" href="../assets/themes/aurora.css">
```

Or enable `T`-cycling by listing themes on the body:

```html
<body data-themes="minimal-white,aurora,catppuccin-mocha" data-theme-base="../assets/themes/">
```

## How to extend

Copy an existing theme, rename it, and override only the variables you want to
change. Keep each theme under ~200 lines. Prefer adjusting tokens to adding
new selectors.
