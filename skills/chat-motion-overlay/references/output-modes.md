# Output Modes

Use user-facing delivery choices and let the skill map them to concrete artifacts.

## MOV (transparent background, drop directly into Jianying / Premiere / FCP as an overlay)

Use this when the clip should be layered in editors such as Premiere, Final Cut, Jianying, or CapCut.

```bash
npx remotion render src/index.ts ChatMotionOverlay out/chat-motion-overlay.mov --image-format=png --pixel-format=yuva444p10le --codec=prores --prores-profile=4444
```

## WebM (transparent background, suited to web/browser playback)

Use this when the clip should play in browser or web composition contexts.

```bash
npx remotion render src/index.ts ChatMotionOverlay out/chat-motion-overlay.webm --image-format=png --pixel-format=yuva420p --codec=vp9
```

## JSON data (suited to programmatic processing / custom rendering)

Use this when another system should consume the scene structure directly.

- Run `scripts/build_chat_overlay_spec.py`
- Keep the resulting JSON as the transport artifact

## Remotion project / Hyperframe project (suited to continued editing and assembly)

Use this when the user wants to keep composing downstream rather than receiving a final video.

- Run `scripts/prepare_chat_overlay_bundle.py`
- Deliver the generated bundle directory

## Visual Rules

- `container: none` should keep only bubbles and avatars on a transparent root.
- `container: none` only supports `deviceFrame: none`; do not pair bubble-only overlays with `iphone-dynamic-island`.
- App containers should keep their own screen background but never add a global background outside the content region.
- `deviceFrame: iphone-dynamic-island` adds phone hardware while preserving transparent outer space.
