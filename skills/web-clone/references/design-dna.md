# Design DNA · Structured design-identity layer (for visual clone / content overhaul modes only)

Turns "capture the feel of that site" from a vague impression into a **versionable, reusable, comparable JSON spec**.
Used in the "visual clone" and "content overhaul" modes — after recon, before building the project,
produce an additional `design-dna.json` so Step 6, "swap in the user's own content", has something
to work from: **keep the DNA, swap the content**.

> Method and schema adapted from [zanwei/design-dna](https://github.com/zanwei/design-dna) (MIT), trimmed to web-clone's needs.

## ⚠️ Applicability boundary (read this first)

Design DNA's generation philosophy is **"approximate style"** — it produces "a new site with a
consistent feel", not a byte-for-byte copy. This runs in the **opposite direction** from
web-clone's rule #1, "real source above all / byte-for-byte faithful". So:

| Mode | Use DNA? |
|---|---|
| Faithful clone (real source obtained / single-file native site / byte-for-byte WebGL reproduction) | **No.** Real source is the ground truth — don't let DNA dilute it into "approximate" |
| Visual clone (reproduce the look but simplify the implementation) | **Yes.** DNA is the primary deliverable of this path |
| Content overhaul (keep the information architecture + pacing + visual grammar, swap in Jane's content) | **Yes.** DNA defines "what to keep"; the content can change freely |

In one sentence: **DNA is for "make my own site", not for "port an identical copy".**

## Three-axis structure

The DNA JSON has three layers, corresponding to "measurable / perceived / special rendering":

1. **`design_system`** — measurable tokens: color / typography / spacing / layout / shape / elevation / iconography / motion / components
2. **`design_style`** — subjective perception: aesthetic (mood/genre/era) / visual_language / composition / imagery / interaction_feel / brand_voice_in_ui
3. **`visual_effects`** — rendering beyond ordinary CSS: background / particles / 3d / shader / scroll / text / cursor / image / glass-neu / canvas / svg

`design_system` maps directly to CSS variables; `design_style` guides subjective decisions; `visual_effects` decides whether to reach for Canvas/WebGL/GSAP, and hands off to this skill's "WebGL reverse-engineering branch".

## Three-step workflow

1. **Structure** — check the schema first (below, or the skeleton `dna-scaffold.mjs` generates) to decide which dimensions to fill in; irrelevant ones can be dropped.
2. **Analyze** — extract from the recon deliverables:
   - Colors: `<label>-recon.json`'s `cssVariables` (values starting with `--`) plus `sections[].style`'s `backgroundColor` / `color`; pick primary by area coverage, accent by what's used on CTAs.
   - Fonts: the `fonts` array plus `sections[].style.fontFamily`, split into heading / body / mono.
   - Spacing/layout: measure pacing and max width from screenshots plus `sections[].rect`.
   - Effects: `frameworks.three/gsap/lenis` + `canvases` + `counts.canvas` -> fill in `visual_effects.overview.primary_technology` and the various enabled flags.
   - Style/perception: judge mood, genre, composition, and whitespace by eye from the three screenshot sizes (1440/768/390).
   - **Fill in every field with a real value, don't leave empty strings** — if a field can't be determined, mark it `TODO` and note what evidence is missing.
3. **Generate** — parse the DNA -> generate CSS custom properties -> make subjective calls per `design_style` -> pick an implementation tier by `effect_intensity` (lightweight=CSS/SVG/vanilla; medium=Canvas2D/GSAP/Lottie; heavy=Three.js/GLSL/Pixi) -> output the page -> pour in the user's own content. **Prefer real images pulled from the original site (via `asset-harvest.mjs`) over AI-repainted approximations.**

## Scaffold

```bash
node scripts/dna-scaffold.mjs \
  --recon RECON/original-recon.json \
  --out   RECON/design-dna.json
```

The script outputs the full DNA skeleton, **best-effort prefilling** fonts, CSS color variables,
and framework/effect signals from recon; the remaining fields are left as `""` (to be completed
manually during Analyze). It also runs without `--recon`, producing a plain empty skeleton.

## Full DNA JSON schema (adapted from design-dna, MIT)

```json
{
  "meta": { "name": "", "description": "", "source_references": "", "created_at": "" },

  "design_system": {
    "color": {
      "palette_type": "monochromatic | complementary | analogous | triadic | split-complementary",
      "primary":   { "hex": "", "role": "" },
      "secondary": { "hex": "", "role": "" },
      "accent":    { "hex": "", "role": "" },
      "neutral":   { "scale": "", "usage": "" },
      "semantic":  { "success": "", "warning": "", "error": "", "info": "" },
      "surface":   { "background": "", "card": "", "elevated": "" },
      "contrast_strategy": "high contrast | subtle layers | dark-on-light dominant"
    },
    "typography": {
      "type_scale": {
        "display":    { "size": "", "weight": "", "line_height": "", "tracking": "" },
        "heading_1":  { "size": "", "weight": "", "line_height": "", "tracking": "" },
        "heading_2":  { "size": "", "weight": "", "line_height": "", "tracking": "" },
        "heading_3":  { "size": "", "weight": "", "line_height": "", "tracking": "" },
        "body":       { "size": "", "weight": "", "line_height": "", "tracking": "" },
        "body_small": { "size": "", "weight": "", "line_height": "", "tracking": "" },
        "caption":    { "size": "", "weight": "", "line_height": "", "tracking": "" },
        "overline":   { "size": "", "weight": "", "line_height": "", "tracking": "" }
      },
      "font_families": { "heading": "", "body": "", "mono": "" },
      "font_style_notes": ""
    },
    "spacing": { "base_unit": "", "scale": "", "content_density": "compact | comfortable | spacious", "section_rhythm": "" },
    "layout":  { "grid_system": "", "max_content_width": "", "columns": "", "gutter": "", "breakpoints": "", "alignment_tendency": "strict grid | centered | asymmetric | mixed" },
    "shape":   { "border_radius": { "small": "", "medium": "", "large": "", "pill": "" }, "border_usage": "none | subtle 1px | bold borders | only on inputs", "divider_style": "" },
    "elevation": { "shadow_style": "none | soft diffused | hard drop | layered", "levels": { "low": "", "medium": "", "high": "" }, "depth_cues": "shadows | overlapping layers | blur/glass | color intensity" },
    "iconography": { "style": "", "stroke_weight": "", "size_scale": "", "preferred_set": "" },
    "motion": { "easing": "", "duration_scale": { "micro": "", "normal": "", "macro": "" }, "entrance_pattern": "", "exit_pattern": "", "philosophy": "minimal functional | playful bouncy | cinematic | none" },
    "components": { "button_style": "", "input_style": "", "card_style": "", "navigation_pattern": "", "modal_style": "", "list_style": "", "component_notes": "" }
  },

  "design_style": {
    "aesthetic": { "mood": [], "visual_metaphor": "", "era_influence": "", "genre": "", "personality_traits": [], "adjectives": [] },
    "visual_language": { "complexity": "minimal | moderate | rich | maximal", "ornamentation": "none | subtle accents | decorative | heavily ornamented", "whitespace_usage": "", "visual_weight_distribution": "", "focal_strategy": "single hero element | distributed interest | progressive reveal", "contrast_level": "", "texture_usage": "" },
    "composition": { "hierarchy_method": "scale contrast | color weight | spatial isolation | typographic hierarchy", "balance_type": "symmetric | asymmetric | radial | mosaic", "flow_direction": "", "grouping_strategy": "", "negative_space_role": "" },
    "imagery": { "photo_treatment": "", "illustration_style": "", "graphic_elements": "", "pattern_usage": "", "image_shape": "" },
    "interaction_feel": { "feedback_style": "", "hover_behavior": "", "transition_personality": "snappy | smooth glide | bouncy elastic | fade-subtle", "loading_style": "", "microinteraction_density": "" },
    "brand_voice_in_ui": { "tone": "", "formality": "", "cta_style": "direct imperative | friendly invitation | urgent scarcity | subtle suggestion", "empty_state_approach": "", "error_tone": "" }
  },

  "visual_effects": {
    "overview": { "effect_intensity": "none | subtle-accent | moderate | heavy-immersive", "performance_tier": "lightweight | medium | heavy", "fallback_strategy": "", "primary_technology": "CSS only | Canvas 2D | WebGL/Three.js | GSAP | Lottie | SVG SMIL | Pixi.js" },
    "background_effects": { "type": "gradient-animation | noise-field | mesh-gradient | video-bg | generative-art | none", "description": "", "technology": "", "params": { "color_palette": "", "speed": "", "density": "", "opacity": "", "blend_mode": "" } },
    "particle_systems": { "enabled": false, "type": "floating-dots | confetti | snow | fireflies | connected-nodes | custom", "description": "", "technology": "", "params": { "count": "", "shape": "", "size_range": "", "movement_pattern": "", "color_behavior": "", "interaction": "mouse-repel | mouse-attract | click-burst | none", "spawn_area": "" } },
    "3d_elements": { "enabled": false, "type": "hero-model | product-viewer | scene-bg | text-extrusion | abstract-geometry", "description": "", "technology": "", "params": { "renderer": "", "lighting": "", "camera": "", "materials": "", "geometry": "", "post_processing": [], "interaction_model": "" } },
    "shader_effects": { "enabled": false, "type": "noise-distortion | wave | morph | color-shift | custom-GLSL", "description": "", "technology": "", "params": { "uniforms": "", "vertex_manipulation": "", "fragment_output": "", "noise_type": "perlin | simplex | worley | fbm", "distortion": "" } },
    "scroll_effects": { "parallax": { "enabled": false, "layers": "", "depth_range": "", "speed_curve": "" }, "scroll_triggered_animations": { "enabled": false, "trigger_points": "", "animation_type": "fade-up | scale-in | clip-reveal | counter | draw-SVG", "scrub_behavior": "" }, "scroll_morphing": { "enabled": false, "description": "" } },
    "text_effects": { "type": "split-letter-animate | typewriter | glitch | gradient-fill | 3d-extrude | none", "description": "", "technology": "", "params": { "split_strategy": "by-char | by-word | by-line", "animation_per_unit": "", "stagger": "", "effect_style": "" } },
    "cursor_effects": { "enabled": false, "type": "custom-cursor | magnetic-buttons | spotlight | trail | none", "description": "", "params": { "shape": "", "size": "", "blend_mode": "", "trail": "", "interaction_zone": "" } },
    "image_effects": { "type": "hover-distortion | reveal-clip | parallax-tilt | rgb-shift | none", "description": "", "technology": "", "params": { "filter_pipeline": "", "hover_transform": "", "reveal_animation": "", "distortion_type": "barrel | wave | liquid | glitch" } },
    "glassmorphism_neumorphism": { "enabled": false, "style": "glass | neumorphic-light | neumorphic-dark | frosted-layers | none", "params": { "blur_radius": "", "transparency": "", "border_treatment": "", "shadow_type": "", "light_source_angle": "" } },
    "canvas_drawings": { "enabled": false, "type": "generative-lines | interactive-blobs | data-visualization | pattern-fill | none", "description": "", "technology": "", "params": { "draw_method": "", "animation_loop": "", "color_scheme": "", "responsiveness": "", "interaction": "" } },
    "svg_animations": { "enabled": false, "type": "path-draw | morph-shapes | logo-reveal | decorative-loop | none", "description": "", "params": { "animation_method": "", "path_morphing": "", "stroke_animation": "", "filter_effects": "" } },
    "composite_notes": ""
  }
}
```

## Division of labor with the WebGL reverse-engineering branch

- For a site whose `visual_effects` mark `heavy-immersive` / `WebGL/Three.js` / `shader_effects.enabled=true`, **don't use DNA to "approximate" that effect** — that's the job of `effect-extraction.md` + `reverse-engineering.md`, which reverse-engineer the real implementation.
- On such sites, DNA only owns the design layer **outside** the effect (colors/typography/layout/ordinary motion); the effect itself goes through reverse-engineering or gets delegated to web-shader-extractor.
